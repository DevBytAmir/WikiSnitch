"""Load the edit history of the history set at paragraph level.

For each article this builds the paragraph lineage from its versions and stores whole versions
in ``article_history`` and every paragraph state in ``paragraph``. Rows get Wikipedia's real edit
times through ``system_versioning_insert_history``, so MariaDB's own history matches the
article's. An article that is already loaded is skipped, so the command can be repeated.
"""

import argparse
import time
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path

import pyarrow.parquet as pq

from core.config import load_settings
from core.db import connect, sql_ts, utc
from core.lineage import Lineage, Version, build_lineage
from pipeline.load_articles import read_hero_page_ids

# Upper bound for the text sent in one insert, to stay under the server's packet limit.
MAX_BATCH_BYTES = 8_000_000

HISTORY_SQL = (
    "INSERT INTO article_history (page_id, title, rev_id, user, anonymous, comment, minor, sha1, "
    "len, undone, text, row_start, row_end) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
)
HISTORY_CURRENT_SQL = (
    "INSERT INTO article_history (page_id, title, rev_id, user, anonymous, comment, minor, sha1, "
    "len, undone, text, row_start) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
)
PARAGRAPH_SQL = (
    "INSERT INTO paragraph (lang, page_id, para_id, kind, section, text, text_hash, citations, "
    "numbers, rev_id, user, anonymous, comment, undone, row_start, row_end) "
    "VALUES ('fi',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
)
PARAGRAPH_CURRENT_SQL = (
    "INSERT INTO paragraph (lang, page_id, para_id, kind, section, text, text_hash, citations, "
    "numbers, rev_id, user, anonymous, comment, undone, row_start) "
    "VALUES ('fi',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
)
OUTLINE_SQL = (
    "INSERT INTO article_outline (lang, page_id, pos, heading, para_id) VALUES ('fi',%s,%s,%s,%s)"
)


def _send(cur, sql: str, rows: Sequence[tuple], text_of: Callable[[tuple], str]) -> None:
    """Insert rows in batches whose text stays under ``MAX_BATCH_BYTES``."""
    batch: list[tuple] = []
    size = 0
    for row in rows:
        n = len(text_of(row).encode("utf-8"))
        if batch and size + n > MAX_BATCH_BYTES:
            cur.executemany(sql, batch)
            batch, size = [], 0
        batch.append(row)
        size += n
    if batch:
        cur.executemany(sql, batch)


def _set_insert_history(con, value: int) -> None:
    """Turn ``system_versioning_insert_history`` on or off for this connection."""
    with con.cursor() as cur:
        cur.execute(f"SET system_versioning_insert_history = {value}")


def store_lineage(con, page_id: int, title: str, versions: Sequence[Version], lineage: Lineage) -> None:
    """Store one article: its versions, paragraph states and reading order, in one transaction.

    Closed rows are inserted with an explicit end time, which needs insert-history mode. Rows
    that are still current are inserted without one. Does nothing if the article is already stored.
    """
    with con.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM article_history FOR SYSTEM_TIME ALL WHERE page_id=%s LIMIT 1", (page_id,)
        )
        if cur.fetchone():
            return
    ordered = sorted(versions, key=lambda x: (x.timestamp, x.rev_id))
    times = lineage.times
    last = len(ordered) - 1
    try:
        _set_insert_history(con, 1)
        with con.cursor() as cur:
            closed, current = [], []
            for k, ver in enumerate(ordered):
                row = (
                    page_id, title[:255], ver.rev_id,
                    ver.user[:255] if ver.user is not None else None,
                    ver.anonymous, ver.comment, ver.minor, ver.sha1,
                    len(ver.text.encode("utf-8")), lineage.undone[k], ver.text, sql_ts(times[k]),
                )
                if k < last:
                    closed.append((*row, sql_ts(times[k + 1])))
                else:
                    current.append(row)
            _send(cur, HISTORY_SQL, closed, lambda r: r[10])
            _send(cur, HISTORY_CURRENT_SQL, current, lambda r: r[10])

            ended, alive = [], []
            for s in lineage.states:
                row = (
                    page_id, s.para_id, s.kind, s.section[:255] if s.section is not None else None,
                    s.text, s.text_hash, s.citations, s.numbers, s.rev_id,
                    s.user[:255] if s.user is not None else None,
                    s.anonymous, s.comment, s.undone, sql_ts(s.start),
                )
                if s.end is None:
                    alive.append(row)
                else:
                    ended.append((*row, sql_ts(s.end)))
            _send(cur, PARAGRAPH_SQL, ended, lambda r: r[4])
            _send(cur, PARAGRAPH_CURRENT_SQL, alive, lambda r: r[4])

            outline = [
                (page_id, pos, i.heading[:255] if i.heading is not None else None, i.para_id)
                for pos, i in enumerate(lineage.outline)
            ]
            if outline:
                cur.executemany(OUTLINE_SQL, outline)
        _set_insert_history(con, 0)
        con.commit()
    except BaseException:
        con.rollback()
        try:
            _set_insert_history(con, 0)
        except Exception:
            pass
        raise


def _data_files(data_dir: Path) -> list[Path]:
    """The version files of dataset M, in order."""
    return sorted((data_dir / "m").glob("versions-*.parquet"))


def read_versions(data_dir: Path, page_ids: set[int]) -> Iterator[tuple[int, str, list[Version]]]:
    """Yield ``(page id, title, versions)`` one article at a time, versions in time order.

    Each file is filtered to the wanted pages while reading and freed before the next, to keep
    memory low. The title is the one from the latest version.
    """
    wanted = sorted(page_ids)
    for path in _data_files(data_dir):
        table = pq.read_table(path, filters=[("page_id", "in", wanted)])
        groups: dict[int, list[Version]] = {}
        titles: dict[int, tuple] = {}
        for row in table.to_pylist():
            ver = Version(
                row["rev_id"], utc(row["timestamp"]), row["user"], bool(row["anonymous"]),
                row["comment"], bool(row["minor"]), row["sha1"], row["text"],
            )
            groups.setdefault(row["page_id"], []).append(ver)
            key = (ver.timestamp, ver.rev_id)
            if row["page_id"] not in titles or key > titles[row["page_id"]][0]:
                titles[row["page_id"]] = (key, row["title"])
        del table
        for page_id in sorted(groups):
            versions = sorted(groups[page_id], key=lambda x: (x.timestamp, x.rev_id))
            yield page_id, titles[page_id][1], versions


def _all_page_ids(data_dir: Path) -> set[int]:
    """Every page id that has versions in dataset M."""
    ids: set[int] = set()
    for path in _data_files(data_dir):
        ids.update(pq.read_table(path, columns=["page_id"]).column("page_id").to_pylist())
    return ids


def main(argv: list[str] | None = None) -> None:
    """Command line: ``python -m pipeline.load_history [--all | --page PAGE_ID]``.

    The default is the history set listed in ``db/hero_articles.tsv``.
    """
    parser = argparse.ArgumentParser(prog="python -m pipeline.load_history")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--page", type=int)
    args = parser.parse_args(argv)

    settings = load_settings()
    if args.page is not None:
        page_ids = {args.page}
    elif args.all:
        page_ids = _all_page_ids(settings.data_dir)
    else:
        page_ids = read_hero_page_ids()

    con = connect(settings)
    total = time.perf_counter()
    count = 0
    try:
        for page_id, title, versions in read_versions(settings.data_dir, page_ids):
            with con.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM article_history FOR SYSTEM_TIME ALL WHERE page_id=%s LIMIT 1",
                    (page_id,),
                )
                if cur.fetchone():
                    continue
            started = time.perf_counter()
            lineage = build_lineage(versions)
            store_lineage(con, page_id, title, versions, lineage)
            count += 1
            print(f"{page_id} {title} {len(versions)} {len(lineage.states)} "
                  f"{time.perf_counter() - started:.1f}s", flush=True)
    finally:
        con.close()
    print(f"total {count} articles {time.perf_counter() - total:.1f}s")


if __name__ == "__main__":
    main()
