from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from core.config import load_settings
from core.db import connect
from core.embedder import EmbedderUnavailable, FakeEmbedder, OllamaEmbedder
from pipeline import embed_file as embed_file_module
from pipeline.embed_file import embed_file
from pipeline.import_vectors import import_vectors
from pipeline.load_articles import store_markdown_article

VECTOR_DIM = load_settings().embed_dimensions


class CountingEmbedder(FakeEmbedder):
    def __init__(self):
        super().__init__()
        self.calls = 0

    def embed(self, texts):
        self.calls += 1
        return super().embed(texts)


class FailingEmbedder(CountingEmbedder):
    def __init__(self, fail_on_call: int | None = None):
        super().__init__()
        self.fail_on_call = fail_on_call

    def embed(self, texts):
        self.calls += 1
        if self.fail_on_call == self.calls:
            raise RuntimeError("simulated interruption")
        return FakeEmbedder.embed(self, texts)


def _source(path: Path, texts: list[str]) -> None:
    pq.write_table(
        pa.table(
            {
                "text_hash": pa.array([bytes([n]) * 16 for n in range(len(texts))], type=pa.binary(16)),
                "lang": ["fi"] * len(texts),
                "is_current": [True] * len(texts),
                "text": texts,
            }
        ),
        path,
    )


def test_export_embed_import_round_trip(tmp_path: Path):
    source = tmp_path / "texts.parquet"
    vectors = tmp_path / "vectors"
    _source(source, ["one", "two"])
    assert embed_file(source, vectors, FakeEmbedder()) == 2
    parts = sorted(vectors.glob("vectors-*.parquet"))
    assert len(parts) == 1
    table = pq.read_table(parts[0])
    assert table.column_names == ["text_hash", "embedding"]
    assert all(len(vector) == VECTOR_DIM for vector in table["embedding"])


def test_embed_file_resumes(tmp_path: Path):
    source = tmp_path / "texts.parquet"
    vectors = tmp_path / "vectors"
    _source(source, ["one", "two"])
    first_embedder = CountingEmbedder()
    first = embed_file(source, vectors, first_embedder)
    assert first == 2
    second_embedder = CountingEmbedder()
    assert embed_file(source, vectors, second_embedder) == 0
    assert first_embedder.calls == 1 and second_embedder.calls == 0
    assert len(list(vectors.glob("vectors-*.parquet"))) == 1


def test_embed_file_crash_leaves_no_partial_part_and_resumes(tmp_path: Path):
    source = tmp_path / "texts.parquet"
    vectors = tmp_path / "vectors"
    _source(source, [str(number) for number in range(65)])
    with pytest.raises(RuntimeError, match="interruption"):
        embed_file(source, vectors, FailingEmbedder(fail_on_call=3))
    assert list(vectors.glob("vectors-*.parquet")) == []
    assert list(vectors.glob("*.tmp")) == []
    assert embed_file(source, vectors, FakeEmbedder()) == 65
    assert len(list(vectors.glob("vectors-*.parquet"))) == 1


def test_embed_file_uses_highest_existing_part_number(tmp_path: Path):
    source = tmp_path / "texts.parquet"
    vectors = tmp_path / "vectors"
    _source(source, ["one", "two"])
    vectors.mkdir()
    pq.write_table(
        pa.table(
            {
                "text_hash": pa.array([b"0" * 16], type=pa.binary(16)),
                "embedding": pa.array([[0.0] * VECTOR_DIM], type=pa.list_(pa.float32(), VECTOR_DIM)),
            }
        ),
        vectors / "vectors-00003.parquet",
    )
    (vectors / "vectors-00002.parquet").write_bytes(b"removed")
    (vectors / "vectors-00002.parquet").unlink()
    embed_file(source, vectors, FakeEmbedder())
    assert (vectors / "vectors-00004.parquet").exists()


def test_import_rejects_wrong_dimension(tmp_path: Path):
    vectors = tmp_path / "vectors"
    vectors.mkdir()
    vectors = vectors / "vectors-00001.parquet"
    pq.write_table(
        pa.table({"text_hash": pa.array([b"0" * 16]), "embedding": [[0.0, 1.0]]}),
        vectors,
    )
    from pipeline.import_vectors import import_vectors

    with pytest.raises(ValueError, match="1024"):
        import_vectors(vectors)


class FlakyEmbedder(FakeEmbedder):
    """Fails like a crashing Ollama: the first `failures` calls, and always on texts in `bad`."""

    def __init__(self, failures: int = 0, bad: frozenset[str] = frozenset()):
        super().__init__()
        self.failures = failures
        self.bad = bad
        self.calls = 0

    def embed(self, texts):
        self.calls += 1
        if self.calls <= self.failures or self.bad & set(texts):
            raise EmbedderUnavailable("Ollama returned HTTP 400")
        return super().embed(texts)


def test_transient_failures_are_retried_without_losing_work(tmp_path: Path):
    source, vectors = tmp_path / "texts.parquet", tmp_path / "vectors"
    _source(source, [f"text {n}" for n in range(40)])
    waits = []
    assert embed_file(source, vectors, FlakyEmbedder(failures=3), sleep=waits.append) == 40
    assert waits == [2.0, 4.0, 8.0]
    assert not (vectors / "failed.txt").exists()


def test_a_text_that_always_fails_is_skipped_and_recorded(tmp_path: Path):
    source, vectors = tmp_path / "texts.parquet", tmp_path / "vectors"
    _source(source, [f"text {n}" for n in range(40)])
    assert embed_file(source, vectors, FlakyEmbedder(bad=frozenset({"text 7"})), sleep=lambda _: None) == 39
    failed = (vectors / "failed.txt").read_text().split()
    assert len(failed) == 1
    stored = set()
    for part in vectors.glob("vectors-*.parquet"):
        stored |= {bytes(h).hex() for h in pq.read_table(part)["text_hash"].to_pylist()}
    assert len(stored) == 39 and failed[0] not in stored
    assert embed_file(source, vectors, FakeEmbedder(), sleep=lambda _: None) == 1


def test_import_stores_the_configured_model_and_looks_up_language_and_currency(tmp_path: Path):
    text = (
        "Satamakaupungin kauppiaat avasivat uuden markkinahallin keväällä, ja ostajat saapuivat "
        "sinne jonoina jo ensimmäisenä aamuna."
    )
    with connect() as con:
        store_markdown_article(con, "sv", 90601, 1, f"# Koe\n\n{text}", None)
        with con.cursor() as cur:
            cur.execute("SELECT text_hash FROM paragraph WHERE lang='sv' AND page_id=90601")
            text_hash = bytes(cur.fetchone()["text_hash"])
        part = tmp_path / "vectors-00001.parquet"
        pq.write_table(
            pa.table(
                {
                    "text_hash": pa.array([text_hash], type=pa.binary(16)),
                    "embedding": pa.array([[0.5] * VECTOR_DIM], type=pa.list_(pa.float32(), VECTOR_DIM)),
                }
            ),
            part,
        )
        assert import_vectors(part) == 1
        con.commit()  # end this connection's snapshot so it sees the import's committed rows
        with con.cursor() as cur:
            cur.execute("SELECT lang, is_current, model FROM text_vector WHERE text_hash=%s", (text_hash,))
            row = cur.fetchone()
    assert row == {"lang": "sv", "is_current": 1, "model": load_settings().embed_model}


def test_base_url_option_overrides_the_configured_address(monkeypatch):
    monkeypatch.setenv("EMBEDDER", "ollama")
    monkeypatch.setenv("EMBED_BASE_URL", "http://configured:11434")
    assert embed_file_module._embedder("http://gpu-box:11434").url == "http://gpu-box:11434"
    configured = embed_file_module._embedder(None)
    assert isinstance(configured, OllamaEmbedder) and configured.url == "http://configured:11434"
