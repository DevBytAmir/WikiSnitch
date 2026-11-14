"""Cross-language comparison: where else a paragraph's claim appears, and whether it agrees.

For a paragraph this finds the closest paragraphs in the same topic's articles in the other
languages, classifies each as the same claim, related or not found, compares the numbers when the
claim is the same, and optionally asks the answer model for a short verdict.
"""

from __future__ import annotations

from datetime import datetime

from api import queries
from api.db import Db
from api.errors import ApiError
from api.history_cache import badge_at, load_page_history
from api.llm import Llm, LlmUnavailable, cached_complete
from api.models import (
    Assessment,
    Badge,
    CrossLangArticle,
    CrossLangElsewhere,
    CrossLangMatch,
    CrossLangTarget,
    CrossLangThresholds,
    CrossLangView,
    NumberDifferences,
    ParagraphSummary,
)
from api.prompts import ASSESS_SYSTEM, build_assess_user, parse_assessment
from api.services.articles import FALLBACK_SAVED, UNKNOWN, as_badge, signal_badge, wikipedia_url
from core.config import MIN_EMBED_CHARS, SNAPSHOT
from core.db import sql_ts, utc
from core.numbers import diff_numbers
from core.thresholds import Thresholds, load_thresholds

TOO_SHORT = "This paragraph is too short to compare."
ELSEWHERE_LIMIT = 3


def _source_row(db: Db, lang: str, page_id: int, para_id: int, moment: datetime) -> tuple[dict, Badge, bool]:
    """The paragraph being compared, its badge and whether its article has edit history.

    For a past ``moment`` (Finnish history articles only) the paragraph and its badge are those of
    that moment. Raises 404 for an unknown article or paragraph.
    """
    if db.one("The article", queries.ARTICLE, (lang, page_id)) is None:
        raise ApiError(404, "not_found", f"No article {lang}/{page_id}.")
    missing = ApiError(404, "not_found", f"No paragraph {para_id} in {lang}/{page_id}.")

    past = False
    if moment < SNAPSHOT and lang == "fi":
        past = db.one("Has history", queries.CURRENT_VERSION, (page_id,)) is not None

    if past:
        row = db.one("The paragraph at that moment", queries.CROSSLANG_SOURCE_AS_OF,
                     (sql_ts(moment), page_id, para_id))
        if row is None:
            raise missing
        history = load_page_history(db, page_id)
        value = badge_at(history, para_id, moment, load_thresholds())
        return row, as_badge(value), True

    row = db.one("The paragraph", queries.CROSSLANG_SOURCE, (lang, page_id, para_id))
    if row is None:
        raise missing
    badge = signal_badge(row) or UNKNOWN
    has_history = lang == "fi" and db.one(
        "Has history", queries.CURRENT_VERSION, (page_id,)
    ) is not None
    if badge is UNKNOWN and has_history:
        history = load_page_history(db, page_id)
        value = badge_at(history, para_id, SNAPSHOT, load_thresholds())
        badge = as_badge(value)
    return row, badge, has_history


def _verdict(similarity: float, th: Thresholds) -> str:
    """``same_claim`` and ``related`` from the calibrated cut-offs, otherwise ``not_found``."""
    if similarity >= th.same_claim:
        return "same_claim"
    if similarity >= th.related:
        return "related"
    return "not_found"


def _snapshot(article: dict) -> str:
    """The date of the article version that was loaded, which is what the comparison used."""
    saved = utc(article["date_modified"]) if article["date_modified"] else FALLBACK_SAVED
    return saved.strftime("%Y-%m-%d")


def _assess(db: Db, llm: Llm | None, source: tuple[str, str], lang: str, target_text: str) -> Assessment | None:
    """The model's verdict on two passages, or ``None`` if there is no model, it fails or its
    reply is not a valid verdict. Results are cached, so a pair is only ever asked once."""
    if llm is None:
        return None
    user = build_assess_user(source[0], source[1], lang, target_text)
    try:
        reply = cached_complete(db, llm, "assess", ASSESS_SYSTEM, user)
    except LlmUnavailable:
        return None
    parsed = parse_assessment(reply)
    if parsed is None:
        return None
    return Assessment(label=parsed[0], explanation=parsed[1], model=llm.model)


def _target(
    db: Db, lang: str, wikidata_id: str | None, vector: str | None, numbers: str, th: Thresholds,
    llm: Llm | None, source: tuple[str, str],
) -> CrossLangTarget:
    """The comparison with one other language.

    Verdicts: ``no_article`` (no article on the topic), ``not_found``, ``related`` and
    ``same_claim``. Only a same claim gets a number comparison, because wording that matches but
    numbers that differ is exactly what an editor wants to see. When nothing matches in the
    counterpart, up to ``ELSEWHERE_LIMIT`` close paragraphs from other articles are offered.
    """
    counterpart = (
        db.one("Same topic in " + lang, queries.COUNTERPART, (wikidata_id, lang))
        if wikidata_id
        else None
    )
    if counterpart is None:
        article, matches, verdict = None, [], "no_article"
        rows: list[dict] = []
    else:
        article = CrossLangArticle(
            page_id=counterpart["page_id"],
            title=counterpart["title"],
            wikipedia_url=wikipedia_url(lang, counterpart["rev_id"]),
            snapshot=_snapshot(counterpart),
        )
        rows = (
            db.query("Same claim in the counterpart article", queries.CROSSLANG_MATCHES,
                     (vector, lang, counterpart["page_id"]))
            if vector is not None
            else []
        )
        matches = [
            CrossLangMatch(
                para_id=r["para_id"], section=r["section"], text=r["text"],
                similarity=round(1 - float(r["distance"]), 3),
            )
            for r in rows
        ]
        verdict = _verdict(matches[0].similarity, th) if matches else "not_found"

    differences = None
    if verdict == "same_claim":
        only_source, only_target = diff_numbers(numbers, rows[0]["numbers"] or "")
        differences = NumberDifferences(only_in_source=only_source, only_in_target=only_target)

    assessment = None
    if verdict in ("same_claim", "related"):
        assessment = _assess(db, llm, source, lang, matches[0].text)

    elsewhere: list[CrossLangElsewhere] = []
    if vector is not None and verdict in ("not_found", "no_article"):
        excluded = counterpart["page_id"] if counterpart else 0
        found = db.query("Also covered in other articles", queries.CROSSLANG_ELSEWHERE,
                         (vector, lang, lang, excluded))
        for r in found:
            similarity = round(1 - float(r["distance"]), 3)
            if similarity < th.related:
                continue
            elsewhere.append(
                CrossLangElsewhere(page_id=r["page_id"], title=r["title"], para_id=r["para_id"],
                                   text=r["text"], similarity=similarity)
            )
            if len(elsewhere) == ELSEWHERE_LIMIT:
                break

    return CrossLangTarget(
        lang=lang, article=article, verdict=verdict, matches=matches,
        number_differences=differences, assessment=assessment, elsewhere=elsewhere,
    )


def crosslang(
    db: Db, lang: str, page_id: int, para_id: int, moment: datetime, llm: Llm | None = None
) -> CrossLangView:
    """Compare a paragraph with the other languages' articles on the same topic.

    A paragraph shorter than ``MIN_EMBED_CHARS`` has no vector and is reported as too short.
    """
    row, badge, has_history = _source_row(db, lang, page_id, para_id, moment)
    header = db.one("The article", queries.ARTICLE, (lang, page_id))
    wikidata_id = header["wikidata_id"]

    vector = None
    if len(row["text"]) >= MIN_EMBED_CHARS:
        found = db.one("Stored vector of the paragraph", queries.SOURCE_VECTOR,
                       (bytes(row["text_hash"]),))
        vector = found["v"] if found else None

    th = load_thresholds()
    langs = [x for x in ("en", "sv") if x != lang] + (["fi"] if lang != "fi" else [])
    targets = [
        _target(db, t, wikidata_id, vector, row["numbers"] or "", th, llm, (lang, row["text"]))
        for t in langs
    ]

    source = ParagraphSummary(
        para_id=row["para_id"],
        section=row["section"],
        text=row["text"],
        kind=row["kind"],
        citations=None if row["citations"] is None else int(row["citations"]),
        has_history=has_history,
        badge=badge,
    )
    return CrossLangView(
        source=source,
        targets=targets,
        thresholds=CrossLangThresholds(
            same_claim=th.same_claim, related=th.related, calibrated=th.calibrated
        ),
        note=TOO_SHORT if vector is None else None,
        sql=db.statements,
    )
