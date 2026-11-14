"""The edit timeline of an article: edits and reverts per month."""

from __future__ import annotations

from api import queries
from api.db import Db
from api.models import Timeline, TimelineMonth, TimelineTotals
from api.services.articles import require_history
from core.db import utc


def get_timeline(db: Db, lang: str, page_id: int) -> Timeline:
    """Monthly edit and revert counts with totals.

    Raises 404 for an unknown article and 409 for one without edit history.
    """
    require_history(db, lang, page_id)

    rows = db.query("Edits and reverts per month", queries.TIMELINE_MONTHS, (page_id,))
    span = db.one("First and last version", queries.TIMELINE_SPAN, (page_id,))
    months = [
        TimelineMonth(
            month=row["month"],
            edits=int(row["edits"]),
            reverts=int(row["reverts"] or 0),
            reverts_of_anonymous=int(row["reverts_of_anonymous"] or 0),
        )
        for row in rows
    ]
    totals = TimelineTotals(
        versions=sum(m.edits for m in months),
        reverts=sum(m.reverts for m in months),
        first=utc(span["first_version"]).strftime("%Y-%m-%d"),
        last=utc(span["last_version"]).strftime("%Y-%m-%d"),
    )
    return Timeline(months=months, totals=totals, sql=db.statements)
