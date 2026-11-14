"""The edit timeline of an article: edits and reverts per month."""

from __future__ import annotations

from api import queries
from api.db import Db
from api.errors import ApiError
from api.models import Timeline, TimelineMonth, TimelineTotals
from core.db import utc


def get_timeline(db: Db, lang: str, page_id: int) -> Timeline:
    """Monthly edit and revert counts with totals.

    Raises 404 for an unknown article and 409 for one without edit history.
    """
    header = db.one("The article", queries.ARTICLE, (lang, page_id))
    if header is None:
        raise ApiError(404, "not_found", f"No article {lang}/{page_id}.")
    if lang != "fi" or db.one("Has history", queries.CURRENT_VERSION, (page_id,)) is None:
        raise ApiError(409, "no_history", "This article was loaded without edit history.")

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
