"""Mapping between paragraph table rows and lineage states."""

from core.db import utc
from core.lineage import State

STATE_COLUMNS = (
    "para_id, kind, section, text, text_hash, citations, numbers, rev_id, user, "
    "anonymous, comment, undone, row_start, row_end"
)


def state_from_row(row: dict) -> State:
    """Turn a ``paragraph`` row into a ``State``.

    MariaDB marks a current row's end as the far future (year 2106), so ``row_end IS NULL`` never
    matches. Any end from 2038 on means "still current" and becomes ``None``.
    """
    row_end = row["row_end"]
    end = None if row_end is None or row_end.year >= 2038 else utc(row_end)
    return State(
        para_id=row["para_id"],
        kind=row["kind"],
        section=row["section"],
        text=row["text"],
        text_hash=bytes(row["text_hash"]),
        citations=int(row["citations"] or 0),
        numbers=row["numbers"],
        rev_id=row["rev_id"],
        user=row["user"],
        anonymous=bool(row["anonymous"]),
        comment=row["comment"],
        undone=bool(row["undone"]),
        start=utc(row["row_start"]),
        end=end,
    )


def fetch_states(cur, lang: str, page_id: int, para_id: int | None = None) -> list[State]:
    """Every state of an article's paragraphs, or of one paragraph, oldest first.

    Reads ``FOR SYSTEM_TIME ALL``, so earlier states that MariaDB kept are included.
    """
    sql = (
        f"SELECT {STATE_COLUMNS} FROM paragraph FOR SYSTEM_TIME ALL "
        "WHERE lang = %s AND page_id = %s"
    )
    params: list = [lang, page_id]
    if para_id is not None:
        sql += " AND para_id = %s"
        params.append(para_id)
    sql += " ORDER BY para_id, row_start"
    cur.execute(sql, params)
    return [state_from_row(r) for r in cur.fetchall()]
