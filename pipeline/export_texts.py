"""Export every text that still needs a vector, so it can be embedded on another machine.

The file has the columns ``text_hash``, ``lang``, ``is_current`` and ``text``. Embed it with
``python -m pipeline.embed_file`` and load the result with ``python -m pipeline.import_vectors``.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from core.config import MIN_EMBED_CHARS, load_settings
from core.db import connect
from pipeline.embed import PENDING_SQL


def export_texts(output_path: Path) -> int:
    """Write the pending texts to a Parquet file and return how many there are.

    The selection is the one ``pipeline.embed`` uses, so both agree on what is pending.
    """
    with connect(load_settings()) as con, con.cursor() as cur:
        cur.execute(PENDING_SQL, (MIN_EMBED_CHARS,))
        rows = cur.fetchall()
    table = pa.table(
        {
            "text_hash": [bytes(row["text_hash"]) for row in rows],
            "lang": [row["lang"] for row in rows],
            "is_current": [bool(row["is_current"]) for row in rows],
            "text": [row["text"] for row in rows],
        },
        schema=pa.schema(
            [
                ("text_hash", pa.binary(16)),
                ("lang", pa.string()),
                ("is_current", pa.bool_()),
                ("text", pa.string()),
            ]
        ),
    )
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, output_path)
    return len(rows)


def main() -> None:
    """Command line: ``python -m pipeline.export_texts [--out texts.parquet]``."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("texts.parquet"))
    args = parser.parse_args()
    print(f"exported {export_texts(args.out)} texts to {args.out}")


if __name__ == "__main__":
    main()
