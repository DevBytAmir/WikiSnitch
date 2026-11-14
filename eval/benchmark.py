"""Compare article and paragraph retrieval on the MariaDB history question set.

The questions are copied from MariaDB/mariadb-vector-wikipedia-rag (MIT). For each question the
benchmark asks which article a search finds: through MariaDB's one vector per article, and through
our vector per paragraph. Results are grouped by Wikidata topic, so language versions count as one
hit. The report is written to ``eval/benchmark.md``.

The calibrated ``ask_min`` in the thresholds file is never changed unless ``--update-ask-min`` is
given, because it decides when *Ask* answers at all.

    python -m eval.benchmark [--update-ask-min]
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path

from core.config import ROOT, load_settings
from core.db import connect
from core.embedder import get_embedder
from core.thresholds import DEFAULT_PATH, load_thresholds
from core.vectors import to_sql

QUESTION_PATH = ROOT / "eval" / "test-questions.tsv"
REPORT_PATH = ROOT / "eval" / "benchmark.md"
LIMIT = 10
ARTICLE_OVERFETCH = 200
PARAGRAPH_OVERFETCH = 200


@dataclass(frozen=True)
class Question:
    """One test question and the article that should be found for it."""

    lang: str
    question: str
    expected_title: str
    article_exists_in: str
    expected_wikidata_id: str | None = None
    expected_page_id: int | None = None


def load_questions(path: Path = QUESTION_PATH) -> list[Question]:
    """Read the questions. The expected topic is filled in later from the database."""
    with Path(path).open(newline="", encoding="utf-8") as handle:
        return [
            Question(
                row["lang"].strip(),
                row["question"].strip(),
                row["expected_fi_title"].strip(),
                row["article_exists_in"].strip(),
            )
            for row in csv.DictReader(handle, delimiter="\t")
        ]


def _topic_key(row: dict) -> str:
    """The Wikidata item of an article, or its language and page id if it has none."""
    return row["wikidata_id"] or f"{row['lang']}:{row['page_id']}"


def _ranked_topics(rows: list[dict], limit: int = LIMIT) -> list[dict]:
    """The best row of each topic, in order, up to ``limit`` topics (language versions merge)."""
    topics: dict[str, dict] = {}
    for row in rows:
        key = _topic_key(row)
        if key not in topics:
            topics[key] = row
        if len(topics) == limit:
            break
    return list(topics.values())


def _article_rows(cur, vector: list[float], limit: int = LIMIT) -> list[dict]:
    """Search MariaDB's article vectors, as their own demo does."""
    cur.execute(
        "SELECT a.lang, a.page_id, a.wikidata_id, a.title, v.distance "
        "FROM (SELECT lang, page_id, "
        "VEC_DISTANCE_COSINE(embedding, VEC_FromText(%s)) AS distance "
        "FROM article_vector ORDER BY distance LIMIT %s) v "
        "JOIN article a USING (lang, page_id) ORDER BY v.distance",
        (to_sql(vector), ARTICLE_OVERFETCH),
    )
    return _ranked_topics(list(cur.fetchall()), limit)


def _article_rows_same_coverage(cur, vector: list[float], limit: int = LIMIT) -> list[dict]:
    """Search the same article vectors, but only articles that have paragraphs, so the comparison
    with the paragraph search is like for like."""
    cur.execute(
        "SELECT a.lang, a.page_id, a.wikidata_id, a.title, "
        "VEC_DISTANCE_COSINE(av.embedding, VEC_FromText(%s)) AS distance "
        "FROM article_vector av JOIN article a USING (lang, page_id) "
        "WHERE EXISTS (SELECT 1 FROM paragraph p WHERE p.lang = av.lang AND p.page_id = av.page_id) "
        "ORDER BY distance LIMIT %s",
        (to_sql(vector), ARTICLE_OVERFETCH),
    )
    return _ranked_topics(list(cur.fetchall()), limit)


def _paragraph_rows(cur, vector: list[float], limit: int = LIMIT) -> list[dict]:
    """Search our paragraph vectors, the way *Ask* does: the vector index first, then the join.

    Joining the paragraphs before sorting by distance cannot use the vector index. On the full
    data that took 140 to 170 seconds per question, against 2 to 4 seconds this way. The index
    is approximate, so the results can differ slightly from an exact scan: the top 10 was
    identical for five of six questions compared. It is the search the app itself runs.
    """
    cur.execute(
        "SELECT p.lang, p.page_id, a.wikidata_id, a.title, p.para_id, p.text, v.distance "
        "FROM (SELECT text_hash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(%s)) AS distance "
        "FROM text_vector WHERE is_current = 1 ORDER BY distance LIMIT %s) v "
        "JOIN paragraph p USING (text_hash) JOIN article a USING (lang, page_id) "
        "WHERE p.row_end > '2038-01-01' "
        "ORDER BY v.distance",
        (to_sql(vector), PARAGRAPH_OVERFETCH),
    )
    return _ranked_topics(list(cur.fetchall()), limit)


def _expected(question: Question, cur) -> Question:
    """The question with its expected Finnish article looked up. Raises ``ValueError`` if missing."""
    cur.execute(
        "SELECT wikidata_id, page_id FROM article WHERE lang = 'fi' AND title = %s",
        (question.expected_title,),
    )
    row = cur.fetchone()
    if row is None:
        raise ValueError(f"Expected article not found: {question.expected_title}")
    return Question(**{**question.__dict__, "expected_wikidata_id": row["wikidata_id"], "expected_page_id": row["page_id"]})


def _rank(question: Question, rows: list[dict]) -> int | None:
    """The 1-based position of the expected topic in the results, or ``None`` if it is absent."""
    for position, row in enumerate(rows, 1):
        if question.expected_wikidata_id and row["wikidata_id"] == question.expected_wikidata_id:
            return position
        if row["lang"] == "fi" and row["page_id"] == question.expected_page_id:
            return position
    return None


def _summary(questions: list[tuple[Question, int | None]]) -> dict[str, float | int]:
    """Hit rates at 1, 5 and 10 and the mean reciprocal rank of a set of ranked questions."""
    ranks = [rank for _, rank in questions]
    return {
        "questions": len(ranks),
        "hit@1": sum(bool(rank and rank <= 1) for rank in ranks) / len(ranks),
        "hit@5": sum(bool(rank and rank <= 5) for rank in ranks) / len(ranks),
        "hit@10": sum(bool(rank and rank <= 10) for rank in ranks) / len(ranks),
        "mrr": sum(1 / rank for rank in ranks if rank) / len(ranks),
    }


def _groups(results: list[tuple[Question, int | None]]) -> dict[str, dict[str, float | int]]:
    """The summary for all questions and for each question language."""
    groups = {lang: [item for item in results if item[0].lang == lang] for lang in ("en", "sv", "fi")}
    groups["all"] = results
    return {name: _summary(items) for name, items in groups.items() if items}


def _percentile(values: list[float], percentile: float) -> float:
    """The percentile (0 to 1) of the values, by linear interpolation. Raises ``ValueError`` if none."""
    if not values:
        raise ValueError("No successful paragraph retrievals; cannot set ask_min.")
    values = sorted(values)
    index = (len(values) - 1) * percentile
    lower = int(index)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (index - lower)


def _write_threshold(path: Path, ask_min: float) -> None:
    """Set ``ask_min`` in the thresholds file and keep every other value."""
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data["ask_min"] = round(ask_min, 3)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _coverage(cur) -> tuple[int, int]:
    """How many articles have at least one paragraph with a vector, and how many articles there are."""
    cur.execute("SELECT COUNT(*) AS n FROM article")
    total = cur.fetchone()["n"]
    cur.execute(
        "SELECT COUNT(DISTINCT p.lang, p.page_id) AS n "
        "FROM paragraph p JOIN text_vector v USING (text_hash)"
    )
    return cur.fetchone()["n"], total


def _markdown(
    results: dict[str, dict[str, dict[str, float | int]]],
    measured_ask_min: float,
    configured_ask_min: float,
    coverage: tuple[int, int],
    updated: bool,
) -> str:
    """The report: how the searches compare, and the measured against the configured ``ask_min``."""
    covered, total = coverage
    if covered == total:
        scope = (
            f"Paragraph vectors cover all {total:,} articles, so **article** and "
            "**article, same articles** are the same search."
        )
    else:
        scope = (
            f"Paragraph vectors cover {covered:,} of {total:,} articles. Compare **paragraph** with "
            "**article, same articles**; the full **article** row searches a larger and harder space."
        )
    lines = [
        "# Retrieval benchmark",
        "",
        "Questions: MariaDB's 37-question Finland history set. A hit is any language version "
        "with the expected `wikidata_id`.",
        "",
        f"Three searches. **article**: MariaDB's one vector per article over all {total:,} articles. "
        "**article, same articles**: the same article vectors, but only over the articles that "
        "have paragraph vectors. **paragraph**: our paragraph vectors.",
        "",
        scope,
        "",
        "| Language | Method | Questions | hit@1 | hit@5 | hit@10 | MRR |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for language in ("all", "en", "sv", "fi"):
        for method in ("article", "article, same articles", "paragraph"):
            summary = results[method].get(language)
            if summary is None:
                continue
            lines.append(
                f"| {language} | {method} | {summary['questions']} | "
                f"{summary['hit@1']:.0%} | {summary['hit@5']:.0%} | "
                f"{summary['hit@10']:.0%} | {summary['mrr']:.2f} |"
            )
    status = "updated to the measured value" if updated else "left unchanged"
    lines.extend(
        [
            "",
            "The 5th percentile of the similarity of successful paragraph matches is "
            f"`{measured_ask_min:.3f}`. The configured `ask_min` is `{configured_ask_min:.3f}` ({status}).",
            "",
        ]
    )
    return "\n".join(lines)


def run(
    questions_path: Path = QUESTION_PATH,
    report_path: Path = REPORT_PATH,
    thresholds_path: Path = DEFAULT_PATH,
    update_ask_min: bool = False,
) -> dict:
    """Run every question through the three searches and write the report.

    Returns the summaries by method and language. The thresholds file is only changed when
    ``update_ask_min`` is true.
    """
    questions = load_questions(questions_path)
    embedder = get_embedder(load_settings())
    with connect(load_settings()) as con, con.cursor() as cur:
        questions = [_expected(question, cur) for question in questions]
        coverage = _coverage(cur)
        article_results = []
        same_results = []
        paragraph_results = []
        successful_similarities = []
        for question in questions:
            vector = embedder.embed([question.question])[0]
            articles = _article_rows(cur, vector)
            paragraphs = _paragraph_rows(cur, vector)
            article_results.append((question, _rank(question, articles)))
            same_results.append((question, _rank(question, _article_rows_same_coverage(cur, vector))))
            paragraph_rank = _rank(question, paragraphs)
            paragraph_results.append((question, paragraph_rank))
            if paragraph_rank is not None:
                topic = question.expected_wikidata_id or f"fi:{question.expected_page_id}"
                successful_similarities.extend(
                    1 - row["distance"] for row in paragraphs if _topic_key(row) == topic
                )
        summaries = {
            "article": _groups(article_results),
            "article, same articles": _groups(same_results),
            "paragraph": _groups(paragraph_results),
        }
    measured = _percentile(successful_similarities, 0.05)
    configured = load_thresholds(thresholds_path).ask_min
    if update_ask_min:
        _write_threshold(thresholds_path, measured)
    report_path.write_text(
        _markdown(summaries, measured, round(measured, 3) if update_ask_min else configured, coverage, update_ask_min),
        encoding="utf-8",
    )
    return summaries


def main() -> None:
    """Command line: run the benchmark and print the summaries."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--questions", type=Path, default=QUESTION_PATH)
    parser.add_argument("--report", type=Path, default=REPORT_PATH)
    parser.add_argument("--thresholds", type=Path, default=DEFAULT_PATH)
    parser.add_argument(
        "--update-ask-min", action="store_true", help="write the measured ask_min to the thresholds file"
    )
    args = parser.parse_args()
    summaries = run(args.questions, args.report, args.thresholds, args.update_ask_min)
    for method, groups in summaries.items():
        for language, summary in groups.items():
            print(method, language, summary)


if __name__ == "__main__":
    main()
