"""A thin database wrapper that records every statement it runs, for the *Show SQL* panel."""

from __future__ import annotations

import re
from collections.abc import Iterator, Sequence
from contextlib import closing

from core.db import connect


def _display_sql(sql: str) -> str:
    """The statement as shown to readers: one line, with ``?`` for parameters, so no values leak."""
    statement = re.sub(r"\s+", " ", sql).strip()
    return statement.replace("%s", "?").replace("%%", "%")


class Db:
    """One request's connection. ``statements`` collects what was run, label and text."""

    def __init__(self, con):
        self.con = con
        self.statements: list[dict] = []

    def query(self, label: str, sql: str, params: Sequence = ()) -> list[dict]:
        """Run a statement and return all rows."""
        self.statements.append({"label": label, "statement": _display_sql(sql)})
        with closing(self.con.cursor()) as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())

    def one(self, label: str, sql: str, params: Sequence = ()) -> dict | None:
        """Run a statement and return the first row, or ``None``."""
        self.statements.append({"label": label, "statement": _display_sql(sql)})
        with closing(self.con.cursor()) as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone()


def get_db() -> Iterator[Db]:
    """FastAPI dependency: a ``Db`` for the request, closed afterwards."""
    con = connect()
    try:
        yield Db(con)
    finally:
        con.close()
