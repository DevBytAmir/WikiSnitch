"""Embed every distinct paragraph text that has no vector yet.

One vector is stored per distinct text, whatever the language or era, so a text that appears in
many states or articles is embedded once. Texts of current paragraphs come first. The command
resumes by skipping texts that already have a vector.
"""

import argparse
import statistics
import time

from core.config import MIN_EMBED_CHARS, load_settings
from core.db import connect
from core.embedder import Embedder, get_embedder
from core.vectors import to_sql

BATCH = 32
BENCHMARK_TEXTS = 500

PENDING_SQL = (
    "SELECT p.text_hash, MIN(p.lang) AS lang, MIN(p.text) AS text, "
    "MAX(p.row_end > '2038-01-01') AS is_current "
    "FROM paragraph FOR SYSTEM_TIME ALL p "
    "LEFT JOIN text_vector v USING (text_hash) "
    "WHERE p.undone = 0 AND CHAR_LENGTH(p.text) >= %s AND v.text_hash IS NULL "
    "GROUP BY p.text_hash "
    "ORDER BY is_current DESC"
)
INSERT_SQL = (
    "INSERT IGNORE INTO text_vector (text_hash, lang, is_current, model, embedding) "
    "VALUES (%s,%s,%s,%s,VEC_FromText(%s))"
)
REFRESH_SQL = (
    "UPDATE text_vector v SET is_current = "
    "EXISTS (SELECT 1 FROM paragraph p WHERE p.text_hash = v.text_hash)"
)


def _pending(con, limit: int | None) -> list[dict]:
    """Texts without a vector: one row per distinct text, current ones first.

    Undone states and texts shorter than ``MIN_EMBED_CHARS`` are not worth a vector.
    """
    sql = PENDING_SQL
    args: list[int] = [MIN_EMBED_CHARS]
    if limit is not None:
        sql += " LIMIT %s"
        args.append(limit)
    with con.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall()


def embed_missing(con, embedder: Embedder, limit: int | None = None, batch: int = BATCH) -> int:
    """Embed up to ``limit`` pending texts in batches and return how many vectors were stored.

    Each batch is committed on its own, so an interrupted run loses at most one batch. A batch
    with the wrong number of vectors or the wrong vector length raises ``ValueError`` and is not
    stored. Afterwards ``is_current`` is refreshed for every vector.
    """
    rows = _pending(con, limit)
    dim = embedder.dimensions
    written = 0
    for start in range(0, len(rows), batch):
        chunk = rows[start : start + batch]
        vectors = embedder.embed([row["text"] for row in chunk])
        if len(vectors) != len(chunk) or any(len(vector) != dim for vector in vectors):
            raise ValueError(
                f"embedder returned {len(vectors)} vectors of unexpected length for "
                f"{len(chunk)} texts (expected {dim} values each)"
            )
        with con.cursor() as cur:
            cur.executemany(
                INSERT_SQL,
                [
                    (row["text_hash"], row["lang"], bool(row["is_current"]), embedder.model,
                     to_sql(vector))
                    for row, vector in zip(chunk, vectors)
                ],
            )
            written += cur.rowcount
        con.commit()
    with con.cursor() as cur:
        cur.execute(REFRESH_SQL)
    con.commit()
    return written


def _benchmark(con, embedder: Embedder) -> None:
    """Time the embedder on pending texts without storing anything."""
    texts = [row["text"] for row in _pending(con, BENCHMARK_TEXTS)]
    if not texts:
        print("benchmark: no un-embedded texts")
        return
    started = time.perf_counter()
    for start in range(0, len(texts), BATCH):
        embedder.embed(texts[start : start + BATCH])
    elapsed = max(time.perf_counter() - started, 1e-9)
    print(
        f"benchmark: {len(texts) / elapsed:.1f} texts/s over {len(texts)} texts "
        f"in {elapsed:.1f} s, median length {statistics.median(len(t) for t in texts):.0f} "
        "characters"
    )


def main(argv: list[str] | None = None) -> None:
    """Command line: ``python -m pipeline.embed [--limit N] [--benchmark]``."""
    parser = argparse.ArgumentParser(prog="python -m pipeline.embed")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args(argv)

    settings = load_settings()
    embedder = get_embedder(settings)
    con = connect(settings)
    try:
        if args.benchmark:
            _benchmark(con, embedder)
            return
        started = time.perf_counter()
        count = embed_missing(con, embedder, limit=args.limit)
        elapsed = max(time.perf_counter() - started, 1e-9)
        print(f"embedded {count} texts in {elapsed:.1f} s ({count / elapsed:.1f} texts/s)")
    finally:
        con.close()


if __name__ == "__main__":
    main()
