"""*Ask*: answer a question from paragraphs of the articles, with cited passages.

The question is embedded and matched against the paragraph vectors in MariaDB. Below the
``ask_min`` similarity the model is not called at all. Otherwise the best passages go to the
answer model as quoted data, and only citations that really exist are kept. Without a model,
or if it fails, the passages themselves are the answer.
"""

from __future__ import annotations

from datetime import datetime

from api import queries
from api.db import Db
from api.errors import ApiError
from api.history_cache import badge_at, load_page_history
from api.llm import Llm, LlmUnavailable, cached_complete
from api.models import AskRetrieval, AskView, Badge, Citation
from api.prompts import ASK_SYSTEM, Passage, build_ask_user, clean_answer
from api.services.articles import UNKNOWN, signal_badge, wikipedia_url
from core.config import SNAPSHOT
from core.db import sql_ts
from core.embedder import Embedder
from core.thresholds import load_thresholds
from core.vectors import to_sql

NO_ANSWER_TEXT = "The Wikipedia articles in this dataset do not appear to cover this question."
MAX_QUESTION = 500
PER_ARTICLE = 2
PER_TOPIC = 3
TOTAL = 8


def _retrieve(db: Db, vector: list[float], lang: str | None, moment: datetime) -> list[dict]:
    """The paragraphs nearest to the question, best first.

    For the present these are current paragraphs of any language, or of ``lang``. For a past
    ``moment`` they are the Finnish paragraphs as they stood then. Either way the vector index is
    searched first and the paragraphs joined afterwards.
    """
    if moment < SNAPSHOT:
        return db.query(
            "Nearest paragraphs as they stood then",
            queries.ASK_RETRIEVE_AS_OF,
            [to_sql(vector), sql_ts(moment)],
        )
    if lang is None:
        statement = queries.ASK_RETRIEVE.format(lang_filter="", paragraph_lang_filter="")
        params = [to_sql(vector)]
    else:
        statement = queries.ASK_RETRIEVE.format(
            lang_filter=queries.ASK_LANG_FILTER,
            paragraph_lang_filter=queries.ASK_PARAGRAPH_LANG_FILTER,
        )
        params = [to_sql(vector), lang, lang]
    return db.query("Nearest current paragraphs", statement, params)


def _select(rows: list[dict]) -> list[dict]:
    """Choose up to ``TOTAL`` passages: at most ``PER_ARTICLE`` from one article and ``PER_TOPIC``
    from one topic, so one article or one topic in three languages cannot fill the answer."""
    per_article: dict[tuple[str, int], int] = {}
    per_topic: dict[str, int] = {}
    chosen: list[dict] = []
    for row in rows:
        key = (row["lang"], row["page_id"])
        topic = row["wikidata_id"]
        if per_article.get(key, 0) >= PER_ARTICLE:
            continue
        if topic is not None and per_topic.get(topic, 0) >= PER_TOPIC:
            continue
        per_article[key] = per_article.get(key, 0) + 1
        if topic is not None:
            per_topic[topic] = per_topic.get(topic, 0) + 1
        chosen.append(row)
        if len(chosen) == TOTAL:
            break
    return chosen


def _citation(n: int, row: dict, badge: Badge | None = None) -> Citation:
    """A numbered citation. The badge comes from the row unless one is given."""
    return Citation(
        n=n,
        lang=row["lang"],
        page_id=row["page_id"],
        para_id=row["para_id"],
        title=row["title"],
        text=row["text"],
        similarity=round(1 - float(row["distance"]), 3),
        badge=badge if badge is not None else (signal_badge(row) or UNKNOWN),
        wikipedia_url=wikipedia_url(row["lang"], row["rev_id"]),
    )


def ask(
    db: Db,
    embedder: Embedder,
    llm: Llm | None,
    question: str,
    lang: str | None,
    moment: datetime = SNAPSHOT,
) -> AskView:
    """Answer ``question`` as of ``moment``, optionally from one language only.

    The result is one of three modes: ``generated`` (model answer with its real citations),
    ``extractive`` (no model, a failing model or no valid citations: the passages are shown) and
    ``no_answer`` (nothing is similar enough, or the model says the passages do not answer it).
    Raises 422 for an empty or over-long question.
    """
    question = question.strip()
    if not question or len(question) > MAX_QUESTION:
        raise ApiError(422, "empty_question", "Enter a question of up to 500 characters.")

    rows = _retrieve(db, embedder.embed([question])[0], lang, moment)

    thresholds = load_thresholds()
    threshold = thresholds.ask_min
    best = round(1 - float(rows[0]["distance"]), 3) if rows else None
    retrieval = AskRetrieval(candidates=len(rows), best_similarity=best, threshold=threshold)
    selected = _select(rows)
    if moment < SNAPSHOT:
        ranked = []
        for i, row in enumerate(selected, 1):
            history = load_page_history(db, row["page_id"])
            b = badge_at(history, row["para_id"], moment, thresholds)
            ranked.append(
                _citation(i, row, Badge(level=b.level, label=b.label, reasons=list(b.reasons)))
            )
    else:
        ranked = [_citation(i, row) for i, row in enumerate(selected, 1)]

    def view(mode: str, answer: str | None, citations: list[Citation]) -> AskView:
        return AskView(
            mode=mode,
            as_of=moment,
            answer=answer,
            citations=citations,
            retrieval=retrieval,
            sql=db.statements,
        )

    if best is None or best < threshold:
        return view("no_answer", NO_ANSWER_TEXT, ranked)
    if llm is None:
        return view("extractive", None, ranked)

    passages = [
        Passage(n=i, lang=r["lang"], title=r["title"], section=r["section"], text=r["text"])
        for i, r in enumerate(selected, 1)
    ]
    try:
        reply = cached_complete(db, llm, "ask", ASK_SYSTEM, build_ask_user(question, passages))
    except LlmUnavailable:
        return view("extractive", None, ranked)
    if reply.strip() == "NO_ANSWER":
        return view("no_answer", NO_ANSWER_TEXT, ranked)
    text, used = clean_answer(reply.strip(), len(passages))
    if not used:
        return view("extractive", None, ranked)
    return view("generated", text, [ranked[n - 1] for n in used])
