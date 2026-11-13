"""MariaDB connection and timestamp helpers."""

from datetime import datetime, timezone

import pymysql
import pymysql.cursors

from core.config import Settings, load_settings


def connect(settings: Settings | None = None) -> pymysql.connections.Connection:
    """Open a connection that returns dict rows, works in UTC and searches vectors to the
    configured depth. Transactions are explicit: nothing is committed automatically."""
    settings = settings or load_settings()
    con = pymysql.connect(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        database=settings.db_name,
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )
    with con.cursor() as cur:
        cur.execute("SET time_zone = '+00:00'")
        cur.execute("SET mhnsw_ef_search = %s", (settings.db_vector_search_depth,))
    return con


def utc(value: datetime | None) -> datetime | None:
    """Return the value as an aware UTC datetime. A naive value is taken to be UTC already."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def sql_ts(value: datetime) -> str:
    """Format a datetime as a MariaDB ``TIMESTAMP(6)`` literal in UTC, keeping microseconds."""
    return utc(value).strftime("%Y-%m-%d %H:%M:%S.%f")
