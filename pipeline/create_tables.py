"""Create the tables, and rebuild the test database from scratch."""

import re
from pathlib import Path

import pymysql

from core.config import load_settings
from core.db import connect

SCHEMA = Path(__file__).resolve().parent.parent / "db" / "schema.sql"


def apply_schema(con) -> None:
    """Run every statement of ``db/schema.sql``. Safe to repeat: tables are created if missing."""
    lines = SCHEMA.read_text(encoding="utf-8").splitlines()
    text = "\n".join(line for line in lines if not line.lstrip().startswith("--"))
    with con.cursor() as cur:
        for statement in re.split(r";[ \t]*$", text, flags=re.MULTILINE):
            if statement.strip():
                cur.execute(statement)
    con.commit()


def main() -> None:
    """Create the tables in the configured database."""
    con = connect()
    try:
        apply_schema(con)
    finally:
        con.close()


def recreate_test_database() -> None:
    """Drop and create the configured database, grant the application user access, and apply
    the schema. Refuses any database whose name does not end in ``_test``."""
    settings = load_settings()
    if not settings.db_name.endswith("_test"):
        raise RuntimeError(f"refusing to recreate non-test database {settings.db_name!r}")
    root = pymysql.connect(
        host=settings.db_host,
        port=settings.db_port,
        user="root",
        password=settings.db_root_password,
        autocommit=True,
    )
    try:
        with root.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{settings.db_name}`")
            cur.execute(f"CREATE DATABASE `{settings.db_name}`")
            cur.execute(f"GRANT ALL ON `{settings.db_name}`.* TO %s@'%%'", (settings.db_user,))
    finally:
        root.close()
    con = connect(settings)
    try:
        apply_schema(con)
    finally:
        con.close()


if __name__ == "__main__":
    main()
