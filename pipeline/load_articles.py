"""Load dataset S: articles in three languages, their ready-made article vectors, the category
tree, and the current paragraphs of the articles that have no edit history.

Every step skips what is already loaded, so the command can be repeated.
"""

import argparse
import csv
import time
from collections.abc import Iterable, Iterator
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq

from core.clean import markdown_blocks, text_hash
from core.config import MIN_PARAGRAPH_CHARS, ROOT, load_settings
from core.db import connect, sql_ts, utc
from core.numbers import numbers_field
from core.vectors import to_sql

HERO_TSV = ROOT / "db" / "hero_articles.tsv"
DEFAULT_ROW_START = datetime(2025, 8, 1, tzinfo=timezone.utc)
LANGS = ("fi", "sv", "en")
ARTICLE_BATCH = 500
VECTOR_BATCH = 200
MAX_BATCH_BYTES = 8_000_000
# The model that made the dataset's ready-made article vectors. This is a fact about that data, so
# it is not a setting. Our own paragraph vectors use the model in ``EMBED_MODEL``.
MODEL = "bge-m3"

ARTICLE_SQL = (
    "INSERT IGNORE INTO article (lang, page_id, rev_id, wikidata_id, title, url, date_modified, text) "
    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)"
)
PARAGRAPH_SQL = (
    "INSERT INTO paragraph (lang, page_id, para_id, kind, section, text, text_hash, citations, "
    "numbers, rev_id, user, anonymous, comment, undone, row_start) "
    "VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s,NULL,0,NULL,0,%s)"
)
OUTLINE_SQL = (
    "INSERT INTO article_outline (lang, page_id, pos, heading, para_id) VALUES (%s,%s,%s,%s,%s)"
)


def parse_date(value: str | datetime) -> datetime:
    """Parse an ISO 8601 timestamp, accepting a trailing ``Z``. A datetime is returned as is."""
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def read_hero_page_ids(path: Path = HERO_TSV) -> set[int]:
    """Finnish page ids of the history set: the articles whose full edit history is loaded."""
    text = path.read_text(encoding="utf-8")
    lines = [line for line in text.splitlines() if not line.startswith("#")]
    return {int(row["page_id"]) for row in csv.DictReader(lines, delimiter="\t")}


def store_article_rows(con, rows: Iterable[dict]) -> int:
    """Insert articles in size-limited batches, ignoring ones already stored. Returns new rows."""
    inserted = 0
    batch: list[dict] = []
    size = 0
    with con.cursor() as cur:
        for row in rows:
            batch.append(row)
            size += len(row["text"].encode("utf-8"))
            if len(batch) >= ARTICLE_BATCH or size >= MAX_BATCH_BYTES:
                inserted += _insert_articles(cur, batch)
                batch, size = [], 0
        if batch:
            inserted += _insert_articles(cur, batch)
    con.commit()
    return inserted


def _insert_articles(cur, batch: list[dict]) -> int:
    """Insert one batch of articles and return how many were new."""
    cur.executemany(
        ARTICLE_SQL,
        [
            (
                r["lang"],
                r["page_id"],
                r["rev_id"],
                r["wikidata_id"],
                r["title"],
                r["url"],
                sql_ts(parse_date(r["date_modified"])) if r["date_modified"] else None,
                r["text"],
            )
            for r in batch
        ],
    )
    return cur.rowcount


def store_markdown_article(
    con, lang: str, page_id: int, rev_id: int, text: str, date_modified: datetime | None
) -> int:
    """Store an article's current text as paragraphs with a reading order, and return how many.

    Used for articles without edit history: each paragraph gets one state that starts when the
    article was last modified (``system_versioning_insert_history`` lets us set that time).
    Does nothing if the article already has paragraphs.
    """
    with con.cursor() as cur:
        cur.execute(
            "SELECT (SELECT COUNT(*) FROM paragraph WHERE lang=%s AND page_id=%s) "
            "+ (SELECT COUNT(*) FROM article_outline WHERE lang=%s AND page_id=%s) AS n",
            (lang, page_id, lang, page_id),
        )
        if cur.fetchone()["n"]:
            return 0

        row_start = sql_ts(utc(date_modified) or DEFAULT_ROW_START)
        section = None
        para_id = 0
        pos = 0
        paragraphs = []
        outline = []
        for block in markdown_blocks(text):
            if block.kind == "h":
                section = block.text[:255]
                outline.append((lang, page_id, pos, section, None))
                pos += 1
            elif len(block.text) >= MIN_PARAGRAPH_CHARS:
                para_id += 1
                paragraphs.append(
                    (
                        lang,
                        page_id,
                        para_id,
                        block.kind,
                        section,
                        block.text,
                        text_hash(block.text),
                        numbers_field(block.text),
                        rev_id,
                        row_start,
                    )
                )
                outline.append((lang, page_id, pos, None, para_id))
                pos += 1
        try:
            cur.execute("SET system_versioning_insert_history = 1")
            if paragraphs:
                cur.executemany(PARAGRAPH_SQL, paragraphs)
            cur.execute("SET system_versioning_insert_history = 0")
            if outline:
                cur.executemany(OUTLINE_SQL, outline)
        except Exception:
            con.rollback()
            raise
        finally:
            cur.execute("SET system_versioning_insert_history = 0")
    con.commit()
    return len(paragraphs)


def store_vectors(con, lang: str, rows: Iterable[dict]) -> int:
    """Insert the dataset's article vectors, ignoring ones already stored. Returns new rows."""
    sql = (
        "INSERT IGNORE INTO article_vector (lang, page_id, model, truncated, embedding) "
        "VALUES (%s,%s,%s,%s,VEC_FromText(%s))"
    )
    inserted = 0
    batch: list[tuple] = []
    with con.cursor() as cur:
        for row in rows:
            batch.append(
                (lang, row["page_id"], MODEL, bool(row.get("truncated", False)),
                 to_sql(row["embedding"]))
            )
            if len(batch) >= VECTOR_BATCH:
                cur.executemany(sql, batch)
                inserted += cur.rowcount
                con.commit()
                batch = []
        if batch:
            cur.executemany(sql, batch)
            inserted += cur.rowcount
    con.commit()
    return inserted


def load_paragraphs(con, hero_page_ids: set[int], include_all: bool = False) -> int:
    """Store paragraphs for the articles chosen by ``_paragraph_keys``. Returns paragraphs stored."""
    keys = _paragraph_keys(con, hero_page_ids, include_all)
    total = 0
    for lang, page_id in keys:
        with con.cursor() as cur:
            cur.execute(
                "SELECT rev_id, text, date_modified FROM article WHERE lang=%s AND page_id=%s",
                (lang, page_id),
            )
            row = cur.fetchone()
        total += store_markdown_article(
            con, lang, page_id, row["rev_id"], row["text"], row["date_modified"]
        )
    return total


def _paragraph_keys(con, hero_page_ids: set[int], include_all: bool) -> list[tuple[str, int]]:
    """Which ``(language, page id)`` articles need current-text paragraphs.

    By default the Swedish and English counterparts of the history set (same Wikidata item). With
    ``include_all``, every article except the history set, which has its own history load.
    """
    hero = sorted(hero_page_ids)
    with con.cursor() as cur:
        if include_all:
            if not hero:
                cur.execute("SELECT lang, page_id FROM article ORDER BY lang, page_id")
            else:
                cur.execute(
                    "SELECT lang, page_id FROM article WHERE NOT (lang='fi' AND page_id IN "
                    f"({','.join(['%s'] * len(hero))})) ORDER BY lang, page_id",
                    hero,
                )
            return [(r["lang"], r["page_id"]) for r in cur.fetchall()]
        if not hero:
            return []
        cur.execute(
            "SELECT DISTINCT wikidata_id FROM article WHERE lang='fi' AND wikidata_id IS NOT NULL "
            f"AND page_id IN ({','.join(['%s'] * len(hero))})",
            hero,
        )
        wikidata = [r["wikidata_id"] for r in cur.fetchall()]
        if not wikidata:
            return []
        cur.execute(
            "SELECT lang, page_id FROM article WHERE lang IN ('sv','en') "
            f"AND wikidata_id IN ({','.join(['%s'] * len(wikidata))}) ORDER BY lang, page_id",
            wikidata,
        )
        return [(r["lang"], r["page_id"]) for r in cur.fetchall()]


def store_category_links(con, rows: Iterable[dict]) -> int:
    """Store the category tree as ``(parent, child)`` pairs."""
    sql = "INSERT IGNORE INTO category_link (parent, child) VALUES (%s,%s)"
    return _insert_pairs(con, sql, ((r["parent"], r["child"]) for r in rows))


def store_fi_article_categories(con, rows: Iterable[dict]) -> int:
    """Store which categories each Finnish article is in."""
    sql = "INSERT IGNORE INTO article_category (lang, page_id, category) VALUES ('fi',%s,%s)"
    return _insert_pairs(con, sql, ((r["page_id"], r["category"]) for r in rows))


def copy_categories_to_counterparts(con) -> int:
    """Give each Swedish and English article the categories of the Finnish article on the same
    Wikidata item. Returns the rows added."""
    with con.cursor() as cur:
        cur.execute(
            "INSERT IGNORE INTO article_category (lang, page_id, category) "
            "SELECT a.lang, a.page_id, c.category FROM article a "
            "JOIN article fi ON fi.lang='fi' AND fi.wikidata_id = a.wikidata_id "
            "JOIN article_category c ON c.lang='fi' AND c.page_id = fi.page_id "
            "WHERE a.lang IN ('sv','en') AND a.wikidata_id IS NOT NULL"
        )
        inserted = cur.rowcount
    con.commit()
    return inserted


def _insert_pairs(con, sql: str, pairs: Iterable[tuple]) -> int:
    """Run an insert for each tuple in batches, commit, and return the rows added."""
    inserted = 0
    batch: list[tuple] = []
    with con.cursor() as cur:
        for pair in pairs:
            batch.append(pair)
            if len(batch) >= ARTICLE_BATCH:
                cur.executemany(sql, batch)
                inserted += cur.rowcount
                batch = []
        if batch:
            cur.executemany(sql, batch)
            inserted += cur.rowcount
    con.commit()
    return inserted


def _parquet_rows(path: Path) -> Iterator[dict]:
    """Stream a Parquet file as dicts without loading all of it."""
    for batch in pq.ParquetFile(path).iter_batches(batch_size=ARTICLE_BATCH):
        yield from batch.to_pylist()


def _tsv_rows(path: Path) -> Iterator[dict]:
    """Stream a tab-separated file with a header row as dicts."""
    with path.open(encoding="utf-8", newline="") as handle:
        yield from csv.DictReader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)


def _report(label: str, count: int, started: float) -> None:
    """Print one progress line with the elapsed time."""
    print(f"{label}: {count} in {time.perf_counter() - started:.1f} s", flush=True)


def main(argv: list[str] | None = None) -> None:
    """Command line: ``python -m pipeline.load_articles [--paragraphs counterparts|all]``."""
    parser = argparse.ArgumentParser(prog="python -m pipeline.load_articles")
    parser.add_argument("--paragraphs", choices=["counterparts", "all"], default="counterparts")
    args = parser.parse_args(argv)

    settings = load_settings()
    data = settings.data_dir / "s"
    con = connect(settings)
    try:
        for lang in LANGS:
            started = time.perf_counter()
            count = store_article_rows(
                con, ({**row, "lang": lang} for row in _parquet_rows(data / f"articles-{lang}.parquet"))
            )
            _report(f"articles {lang}", count, started)

        for lang in LANGS:
            started = time.perf_counter()
            count = store_vectors(con, lang, _parquet_rows(data / f"vectors-bge-m3-{lang}.parquet"))
            _report(f"vectors {lang}", count, started)

        started = time.perf_counter()
        count = store_category_links(con, _tsv_rows(data / "category-links-fi.tsv"))
        _report("category links", count, started)

        started = time.perf_counter()
        count = store_fi_article_categories(con, _tsv_rows(data / "article-categories-fi.tsv"))
        count += copy_categories_to_counterparts(con)
        _report("article categories", count, started)

        started = time.perf_counter()
        count = load_paragraphs(
            con, read_hero_page_ids(), include_all=args.paragraphs == "all"
        )
        _report(f"paragraphs ({args.paragraphs})", count, started)
    finally:
        con.close()


if __name__ == "__main__":
    main()
