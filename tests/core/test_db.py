from datetime import datetime, timezone

from core.config import load_settings
from core.db import connect, sql_ts
from pipeline import create_tables


def test_connection_is_utc_and_tuned():
    with connect() as con, con.cursor() as cur:
        cur.execute("SELECT @@session.time_zone AS tz, @@session.mhnsw_ef_search AS ef")
        assert cur.fetchone() == {"tz": "+00:00", "ef": load_settings().db_vector_search_depth}


def test_schema_applies_twice():
    create_tables.main()
    create_tables.main()
    with connect() as con, con.cursor() as cur:
        cur.execute("SHOW TABLES")
        names = {next(iter(r.values())) for r in cur.fetchall()}
    assert {"article", "article_vector", "article_history", "paragraph", "article_outline",
            "text_vector", "paragraph_signal", "coverage_gap", "llm_cache", "category_link",
            "article_category"} <= names


def test_sql_ts_keeps_microseconds():
    assert sql_ts(datetime(2008, 8, 8, 8, 8, 8, 1, tzinfo=timezone.utc)) == "2008-08-08 08:08:08.000001"
