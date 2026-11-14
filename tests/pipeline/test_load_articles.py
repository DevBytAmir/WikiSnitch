import functools
import hashlib
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import pytest

from core.db import connect
from pipeline import download as dl
from pipeline.load_articles import (
    _paragraph_keys,
    store_article_rows,
    store_markdown_article,
)

MARKDOWN = """# Johdanto
Tämä on ensimmäinen kappale, ja se on riittävän pitkä kappale.
Lyhyt.
## Historia
- Tämä listan kohta on myös riittävän pitkä kuvaamaan tapahtumia.
1. Numeroitu kohta, jonka pituus on myös yli neljäkymmentä merkkiä.
| taulukko | rivi |
Viimeinen kappale 1917 ja 1918 tapahtumista ja muusta pitkästä asiasta.
"""


@pytest.fixture
def con():
    connection = connect()
    yield connection
    connection.close()


@pytest.fixture
def served(tmp_path):
    root = tmp_path / "served"
    root.mkdir()
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(root))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield root, f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def _publish(root, tag, files):
    (root / tag).mkdir(parents=True)
    for name, data in files.items():
        (root / tag / name).write_bytes(data)
    sums = "".join(
        f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in files.items()
    )
    (root / tag / "SHA256SUMS").write_text(sums, encoding="utf-8")


def test_markdown_article_paragraphs_and_outline(con):
    count = store_markdown_article(con, "en", 90101, 5, MARKDOWN, None)
    assert count == 4
    with con.cursor() as cur:
        cur.execute(
            "SELECT para_id, kind, section, text, numbers FROM paragraph "
            "WHERE lang='en' AND page_id=90101 ORDER BY para_id"
        )
        rows = cur.fetchall()
        cur.execute(
            "SELECT pos, heading, para_id FROM article_outline "
            "WHERE lang='en' AND page_id=90101 ORDER BY pos"
        )
        outline = cur.fetchall()
    assert [(r["para_id"], r["kind"], r["section"]) for r in rows] == [
        (1, "p", "Johdanto"),
        (2, "li", "Historia"),
        (3, "li", "Historia"),
        (4, "p", "Historia"),
    ]
    assert rows[3]["numbers"] == "1917,1918"
    assert rows[0]["text"] == "Tämä on ensimmäinen kappale, ja se on riittävän pitkä kappale."
    assert [(r["pos"], r["heading"], r["para_id"]) for r in outline] == [
        (0, "Johdanto", None),
        (1, None, 1),
        (2, "Historia", None),
        (3, None, 2),
        (4, None, 3),
        (5, None, 4),
    ]


def test_markdown_article_twice_is_a_no_op(con):
    assert store_markdown_article(con, "en", 90102, 5, MARKDOWN, None) == 4
    assert store_markdown_article(con, "en", 90102, 5, MARKDOWN, None) == 0
    with con.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM paragraph WHERE lang='en' AND page_id=90102")
        assert cur.fetchone()["n"] == 4
        cur.execute("SELECT COUNT(*) AS n FROM article_outline WHERE lang='en' AND page_id=90102")
        assert cur.fetchone()["n"] == 6


def test_missing_date_uses_snapshot_default(con):
    store_markdown_article(con, "sv", 90103, 5, MARKDOWN, None)
    store_markdown_article(
        con, "sv", 90104, 5, MARKDOWN, datetime(2024, 5, 6, 7, 8, 9, tzinfo=timezone.utc)
    )
    with con.cursor() as cur:
        cur.execute("SELECT row_start FROM paragraph WHERE lang='sv' AND page_id=90103 LIMIT 1")
        assert cur.fetchone()["row_start"] == datetime(2025, 8, 1)
        cur.execute("SELECT row_start FROM paragraph WHERE lang='sv' AND page_id=90104 LIMIT 1")
        assert cur.fetchone()["row_start"] == datetime(2024, 5, 6, 7, 8, 9)


def test_download_skips_verified_file(served, tmp_path):
    root, base_url = served
    tag = "s-2026-10"
    payload = {"a.bin": b"alpha" * 1000, "b.bin": b"beta" * 1000}
    _publish(root, tag, payload)
    dest = tmp_path / "dest"
    assert dl.download(list(payload), tag, dest, base_url=base_url) == 2
    mtime = (dest / "a.bin").stat().st_mtime_ns
    assert dl.download(list(payload), tag, dest, base_url=base_url) == 0
    assert (dest / "a.bin").stat().st_mtime_ns == mtime
    assert (dest / "a.bin").read_bytes() == payload["a.bin"]


def test_download_rejects_bad_checksum(served, tmp_path, monkeypatch):
    root, base_url = served
    tag = "s-2026-10"
    _publish(root, tag, {"a.bin": b"alpha" * 1000})
    (root / tag / "SHA256SUMS").write_text(f"{'0' * 64}  a.bin\n", encoding="utf-8")
    with pytest.raises(ValueError):
        dl.download(["a.bin"], tag, tmp_path / "dest", base_url=base_url)
    assert not (tmp_path / "dest" / "a.bin").exists()

    monkeypatch.setattr(dl, "BASE_URL", base_url)
    monkeypatch.setattr(dl, "DATASETS", {"s": (tag, ["a.bin"])})
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    with pytest.raises(SystemExit) as exit_info:
        dl.main(["s"])
    assert exit_info.value.code == 1
    assert not (tmp_path / "data" / "s" / "a.bin").exists()


def test_article_rows_accept_dataset_date_strings(con):
    store_article_rows(con, [{"lang": "fi", "page_id": 90999, "rev_id": 1, "wikidata_id": None,
                              "title": "Päivä", "url": "https://fi.wikipedia.org/?curid=90999",
                              "date_modified": "2025-08-16T04:18:02Z", "text": "x"}])
    with con.cursor() as cur:
        cur.execute("SELECT date_modified FROM article WHERE lang='fi' AND page_id=90999")
        assert str(cur.fetchone()["date_modified"]) == "2025-08-16 04:18:02"


def test_counterparts_selected_by_wikidata_id(con):
    assert _paragraph_keys(con, {9001, 9002}, False) == [("en", 8001), ("sv", 7001)]
    assert _paragraph_keys(con, {9002}, False) == []
    with con.cursor() as cur:
        cur.execute(
            "SELECT lang, page_id, COUNT(*) AS n FROM paragraph "
            "WHERE (lang='en' AND page_id=8001) OR (lang='sv' AND page_id=7001) "
            "GROUP BY lang, page_id"
        )
        counts = {(r["lang"], r["page_id"]): r["n"] for r in cur.fetchall()}
    assert counts[("en", 8001)] > 0
    assert counts[("sv", 7001)] > 0
