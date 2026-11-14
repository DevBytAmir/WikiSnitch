"""Load vectors made by ``pipeline.embed_file`` into ``text_vector``.

The input is one Parquet file, or a folder of ``vectors-*.parquet`` parts. Vectors whose text
already has one are ignored, and a vector of the wrong length is refused.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pyarrow.parquet as pq

from core.config import load_settings
from core.db import connect
from core.vectors import to_sql

BATCH = 500


def import_vectors(input_path: Path) -> int:
    """Insert the vectors and return how many were new.

    ``lang`` and ``is_current`` are looked up from the paragraphs. The model name is the
    configured ``EMBED_MODEL``, and every vector must be ``EMBED_DIMENSIONS`` long.
    """
    settings = load_settings()
    dimensions = settings.embed_dimensions
    paths = sorted(input_path.glob("vectors-*.parquet")) if input_path.is_dir() else [input_path]
    if not paths:
        raise ValueError(f"No vector parts found in {input_path}.")
    required = {"text_hash", "embedding"}
    with connect(settings) as con, con.cursor() as cur:
        inserted = 0
        for path in paths:
            parquet = pq.ParquetFile(path)
            missing = required - set(parquet.schema_arrow.names)
            if missing:
                raise ValueError(f"Input is missing columns: {', '.join(sorted(missing))}")
            for batch in parquet.iter_batches(batch_size=BATCH, columns=["text_hash", "embedding"]):
                rows = []
                for text_hash, embedding in zip(batch.column("text_hash"), batch.column("embedding")):
                    values = list(map(float, embedding))
                    if len(values) != dimensions:
                        raise ValueError(
                            f"Expected {dimensions} values per embedding, got {len(values)}."
                        )
                    raw_hash = bytes(text_hash)
                    rows.append((raw_hash, raw_hash, raw_hash, settings.embed_model, to_sql(values)))
                cur.executemany(
                    "INSERT IGNORE INTO text_vector (text_hash, lang, is_current, model, embedding) "
                    "SELECT %s, COALESCE((SELECT MIN(lang) FROM paragraph WHERE text_hash=%s), 'fi'), "
                    "EXISTS (SELECT 1 FROM paragraph WHERE text_hash=%s AND row_end > '2038-01-01'), "
                    "%s, VEC_FromText(%s)",
                    rows,
                )
                inserted += cur.rowcount
                con.commit()
        return inserted


def main() -> None:
    """Command line: ``python -m pipeline.import_vectors PATH``."""
    parser = argparse.ArgumentParser()
    parser.add_argument("vectors", type=Path)
    args = parser.parse_args()
    print(f"imported {import_vectors(args.vectors)} vectors")


if __name__ == "__main__":
    main()
