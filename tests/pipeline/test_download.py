import hashlib

import pytest

from pipeline import download as dl

FILES = {"articles-fi.parquet": b"finnish", "vectors-bge-m3-fi.parquet": b"vectors"}


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


@pytest.fixture
def served(monkeypatch):
    """Replace the network: ``served.files`` maps a file name to its bytes and ``served.fetched``
    logs every request. The checksum list is generated from the files."""

    class Server:
        files = dict(FILES)
        fetched: list[str] = []

    server = Server()
    server.fetched = []

    def fake_fetch(url, path, resume):
        name = url.rsplit("/", 1)[1]
        server.fetched.append(name)
        if name == dl.SUMS:
            path.write_text("".join(f"{digest(c)}  {n}\n" for n, c in server.files.items()))
        else:
            path.write_bytes(server.files[name])

    monkeypatch.setattr(dl, "_fetch", fake_fetch)
    return server


def test_parse_sums_accepts_the_binary_marker_and_upper_case_digests():
    text = "ABC123  plain.parquet\nDEF456 *binary.parquet\n\n"
    assert dl._parse_sums(text) == {"plain.parquet": "abc123", "binary.parquet": "def456"}


def test_download_fetches_and_verifies_every_file(served, tmp_path):
    assert dl.download(list(FILES), "tag", tmp_path) == 2
    assert (tmp_path / "articles-fi.parquet").read_bytes() == b"finnish"


def test_download_skips_files_that_already_match_their_checksum(served, tmp_path):
    dl.download(list(FILES), "tag", tmp_path)
    served.fetched.clear()
    assert dl.download(list(FILES), "tag", tmp_path) == 0
    assert served.fetched == [dl.SUMS]


def test_download_deletes_and_rejects_a_file_with_a_wrong_checksum(served, tmp_path, monkeypatch):
    original = dl._fetch

    def corrupting_fetch(url, path, resume):
        original(url, path, resume)
        if path.name == "articles-fi.parquet":
            path.write_bytes(b"corrupted")

    monkeypatch.setattr(dl, "_fetch", corrupting_fetch)
    with pytest.raises(ValueError, match="does not match"):
        dl.download(["articles-fi.parquet"], "tag", tmp_path)
    assert not (tmp_path / "articles-fi.parquet").exists()


def test_download_rejects_a_file_missing_from_the_checksum_list(served, tmp_path):
    with pytest.raises(ValueError, match="not listed"):
        dl.download(["unknown.parquet"], "tag", tmp_path)
