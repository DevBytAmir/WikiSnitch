"""Embed a file of texts without a database, so the work can run on any machine.

Input is the Parquet file from ``pipeline.export_texts``. Output is a folder of numbered
``vectors-*.parquet`` parts of ``PART_SIZE`` vectors each. A stopped run resumes where it left
off, and a text that keeps failing is recorded in ``failed.txt`` instead of stopping the run.
Only the embedding settings are needed, not the database ones.
"""

from __future__ import annotations

import argparse
import os
import time
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from core.config import load_embedding_settings
from core.embedder import Embedder, EmbedderUnavailable, get_embedder

BATCH = 32
PART_SIZE = 2_000
RETRIES = 5
RETRY_WAIT = 2.0
FAILED_FILE = "failed.txt"


def _embedder(base_url: str | None) -> Embedder:
    """The configured embedder, optionally pointed at another server address."""
    settings = load_embedding_settings()
    if base_url:
        settings = replace(settings, embed_base_url=base_url)
    return get_embedder(settings)


def _part_paths(path: Path) -> list[Path]:
    """The numbered vector parts already written to a folder."""
    return sorted(path.glob("vectors-*.parquet")) if path.is_dir() else []


def _next_part_number(parts: list[Path]) -> int:
    """One more than the highest part number, or 1 for an empty folder."""
    numbers = [int(part.stem.split("-")[1]) for part in parts]
    return max(numbers, default=0) + 1


def _read_existing(path: Path) -> set[bytes]:
    """The text hashes that already have a vector in the output folder."""
    existing: set[bytes] = set()
    for part in _part_paths(path):
        table = pq.read_table(part, columns=["text_hash"])
        existing.update(bytes(text_hash) for text_hash in table["text_hash"])
    return existing


def embed_file(
    input_path: Path,
    output_path: Path,
    embedder: Embedder | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    """Embed the texts in ``input_path`` that have no vector in ``output_path`` yet.

    Returns how many texts were embedded. Work is written as it goes, one part at a time, so a
    crash costs at most one part. ``sleep`` can be replaced in tests to avoid real waiting.
    """
    source = pq.read_table(input_path)
    required = {"text_hash", "text"}
    missing = required - set(source.column_names)
    if missing:
        raise ValueError(f"Input is missing columns: {', '.join(sorted(missing))}")
    existing = _read_existing(output_path)
    hashes = [bytes(value) for value in source["text_hash"]]
    texts = source["text"].to_pylist()
    pending = [(text_hash, text) for text_hash, text in zip(hashes, texts) if text_hash not in existing]
    worker = embedder or _embedder(None)
    expected_dim = worker.dimensions
    output_path.mkdir(parents=True, exist_ok=True)
    next_part = _next_part_number(_part_paths(output_path))
    failed: list[bytes] = []
    for part_start in range(0, len(pending), PART_SIZE):
        part_pending = pending[part_start : part_start + PART_SIZE]
        part_vectors: dict[bytes, list[float]] = {}
        for start in range(0, len(part_pending), BATCH):
            chunk = part_pending[start : start + BATCH]
            part_vectors.update(_embed_resilient(worker, chunk, expected_dim, failed, sleep))
        if part_vectors:
            _write_part(output_path / f"vectors-{next_part:05d}.parquet", part_vectors, expected_dim)
            next_part += 1
    if failed:
        with (output_path / FAILED_FILE).open("a", encoding="utf-8") as handle:
            handle.writelines(f"{text_hash.hex()}\n" for text_hash in failed)
    return len(pending) - len(failed)


def _embed_resilient(
    worker: Embedder,
    chunk: list[tuple[bytes, str]],
    expected_dim: int,
    failed: list[bytes],
    sleep: Callable[[float], None],
) -> dict[bytes, list[float]]:
    """Embed one chunk, surviving a server that sometimes fails.

    A failed request is retried with growing waits. If it still fails the chunk is split in two,
    down to single texts, and a text that fails alone is added to ``failed`` and skipped. Without
    this, one fault in the model server would discard a whole part. A reply of the wrong size
    raises ``ValueError``, because that is a configuration error and retrying cannot fix it.
    """
    for attempt in range(RETRIES):
        try:
            vectors = worker.embed([text for _, text in chunk])
            break
        except EmbedderUnavailable:
            if attempt < RETRIES - 1:
                sleep(RETRY_WAIT * 2**attempt)
    else:
        if len(chunk) == 1:
            failed.append(chunk[0][0])
            return {}
        middle = len(chunk) // 2
        result = _embed_resilient(worker, chunk[:middle], expected_dim, failed, sleep)
        result.update(_embed_resilient(worker, chunk[middle:], expected_dim, failed, sleep))
        return result
    if len(vectors) != len(chunk) or any(len(vector) != expected_dim for vector in vectors):
        raise ValueError(f"Embedder must return {expected_dim}-dimensional vectors.")
    return {text_hash: vector for (text_hash, _), vector in zip(chunk, vectors)}


def _write_part(path: Path, vectors: dict[bytes, list[float]], dimensions: int) -> None:
    """Write one part atomically: to a temporary file first, then rename it into place."""
    table = pa.table(
        {
            "text_hash": pa.array(list(vectors), type=pa.binary(16)),
            "embedding": pa.array(list(vectors.values()), type=pa.list_(pa.float32(), dimensions)),
        }
    )
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    pq.write_table(table, temporary_path)
    os.replace(temporary_path, path)


def main() -> None:
    """Command line: ``python -m pipeline.embed_file --in FILE --out FOLDER [--base-url URL]``."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="input_path", type=Path, required=True)
    parser.add_argument("--out", dest="output_path", type=Path, required=True)
    parser.add_argument("--base-url", dest="base_url", help="override EMBED_BASE_URL")
    args = parser.parse_args()
    print(f"embedded {embed_file(args.input_path, args.output_path, _embedder(args.base_url))} texts")


if __name__ == "__main__":
    main()
