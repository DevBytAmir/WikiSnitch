"""The review queue of an article: paragraphs that need an editor's attention."""

from __future__ import annotations

import json

from api import queries
from api.db import Db
from api.models import AttentionItem, MissingParagraph, ParagraphSummary, ReviewReason, ReviewView
from api.services.articles import require_history, signal_badge

MISSING_LIMIT = 20


def _reasons(value) -> list[dict]:
    """The stored review reasons as a list, whether the driver returned JSON text or a list."""
    if isinstance(value, (str, bytes)):
        value = json.loads(value)
    return list(value or [])


def get_review(db: Db, lang: str, page_id: int) -> ReviewView:
    """Paragraphs ordered by review priority with their reasons, and up to ``MISSING_LIMIT``
    paragraphs of the other languages that nothing here covers.

    Raises 404 for an unknown article and 409 for one without edit history.
    """
    require_history(db, lang, page_id)

    rows = db.query("Paragraphs needing attention", queries.ATTENTION, (lang, page_id))
    gaps = db.query(
        "Counterpart paragraphs with no match here",
        queries.MISSING_HERE,
        (page_id, MISSING_LIMIT),
    )

    needs_attention = [
        AttentionItem(
            paragraph=ParagraphSummary(
                para_id=row["para_id"],
                section=row["section"],
                text=row["text"],
                kind=row["kind"],
                citations=None if row["citations"] is None else int(row["citations"]),
                has_history=True,
                badge=signal_badge(row),
            ),
            reasons=[ReviewReason(**r) for r in _reasons(row["review_reasons"])],
            score=round(float(row["attention"]), 2),
        )
        for row in rows
    ]
    missing_here = [
        MissingParagraph(
            lang=row["lang"],
            para_id=row["para_id"],
            section=row["section"],
            text=row["text"],
            nearest_similarity=round(float(row["nearest_similarity"]), 3),
        )
        for row in gaps
    ]
    return ReviewView(needs_attention=needs_attention, missing_here=missing_here, sql=db.statements)
