import hashlib
from datetime import datetime, timezone

import pytest

from core.db import connect, sql_ts
from core.lineage import Version, build_lineage
from core.rows import fetch_states
from pipeline.load_history import store_lineage


def t(stamp: str) -> datetime:
    return datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def v(rev, ts, *paragraphs, user="A", anonymous=False):
    text = "\n".join(paragraphs)
    sha1 = hashlib.md5(text.encode("utf-8")).hexdigest()[:31]
    return Version(rev, t(ts), user, anonymous, None, False, sha1, text)


T1 = "2005-03-01 10:00:00"
T2 = "2005-03-02 12:00:00"
T3 = "2005-03-03 12:05:00"

P1 = "Talvisota alkoi marraskuun lopussa kun neuvostojoukot ylittivät rajan monessa kohdassa yhtä aikaa."
P2 = "Kaupungin vanha satama rakennettiin uudelleen sodan jälkeen ja kauppa kasvoi nopeasti koko rannikolla sekä saaristossa."
P2_EDITED = "Kaupungin vanha satama korjattiin uudelleen sodan jälkeen ja kauppa kasvoi hitaasti koko rannikolla sekä saaristossa."


@pytest.fixture
def con():
    connection = connect()
    yield connection
    connection.close()


def store(con, page_id, versions):
    lineage = build_lineage(versions)
    store_lineage(con, page_id, "Koe", versions, lineage)
    return lineage


def test_states_round_trip(con):
    versions = [v(1, T1, P1, P2), v(2, T2, P1, P2_EDITED), v(3, T3, P1)]
    L = store(con, 90001, versions)
    with con.cursor() as cur:
        got = fetch_states(cur, "fi", 90001)
    assert [(s.para_id, s.text, s.start, s.end, s.undone) for s in got] == [
        (s.para_id, s.text, s.start, s.end, s.undone) for s in L.states
    ]


def test_as_of_returns_the_paragraphs_of_that_version(con):
    versions = [v(1, T1, P1, P2), v(2, T2, P1, P2_EDITED), v(3, T3, P1)]
    L = store(con, 90002, versions)
    with con.cursor() as cur:
        cur.execute(
            "SELECT text FROM paragraph FOR SYSTEM_TIME AS OF TIMESTAMP %s "
            "WHERE lang='fi' AND page_id=90002 ORDER BY para_id",
            (sql_ts(L.times[1]),),
        )
        assert [r["text"] for r in cur.fetchall()] == [P1, P2_EDITED]


def test_store_twice_is_a_no_op(con):
    versions = [v(1, T1, P1, P2), v(2, T2, P1, P2_EDITED)]
    L = store(con, 90003, versions)
    store_lineage(con, 90003, "Koe", versions, L)
    with con.cursor() as cur:
        cur.execute("SELECT COUNT(*) n FROM article_history FOR SYSTEM_TIME ALL WHERE page_id=90003")
        assert cur.fetchone()["n"] == len(versions)
        cur.execute("SELECT COUNT(*) n FROM paragraph FOR SYSTEM_TIME ALL WHERE page_id=90003")
        assert cur.fetchone()["n"] == len(L.states)


def test_blank_latest_version_leaves_no_current_paragraph(con):
    store(con, 90004, [v(1, T1, P1), v(2, T2)])
    with con.cursor() as cur:
        cur.execute("SELECT COUNT(*) n FROM paragraph WHERE page_id=90004")
        assert cur.fetchone()["n"] == 0
        cur.execute("SELECT COUNT(*) n FROM paragraph FOR SYSTEM_TIME ALL WHERE page_id=90004")
        assert cur.fetchone()["n"] == 1


def test_large_article_is_sent_in_batches(con, monkeypatch):
    calls = []

    class Wrapped:
        def __init__(self, cur):
            self._cur = cur

        def executemany(self, sql, args):
            if "INSERT INTO article_history" in sql:
                calls.append(len(args))
            return self._cur.executemany(sql, args)

        def __getattr__(self, name):
            return getattr(self._cur, name)

        def __enter__(self):
            self._cur.__enter__()
            return self

        def __exit__(self, *exc):
            return self._cur.__exit__(*exc)

    real_cursor = con.cursor
    monkeypatch.setattr(con, "cursor", lambda *a, **k: Wrapped(real_cursor(*a, **k)))
    big = "lyhyt rivi\n" * 30_000
    versions = [v(i, f"2005-03-{i // 24 + 1:02d} {i % 24:02d}:00:00", P1, big + str(i)) for i in range(1, 41)]
    store(con, 90005, versions)
    assert len(calls) >= 2
    assert sum(calls) == 40
    with con.cursor() as cur:
        cur.execute("SELECT COUNT(*) n FROM article_history FOR SYSTEM_TIME ALL WHERE page_id=90005")
        assert cur.fetchone()["n"] == 40


def test_outline_matches_lineage(con):
    heading = "== Historia =="
    versions = [v(1, T1, heading, P1, P2), v(2, T2, heading, P1, P2_EDITED)]
    L = store(con, 90006, versions)
    assert any(i.heading for i in L.outline)
    with con.cursor() as cur:
        cur.execute("SELECT heading, para_id FROM article_outline WHERE lang='fi' AND page_id=90006 ORDER BY pos")
        assert [(r["heading"], r["para_id"]) for r in cur.fetchall()] == [
            (i.heading, i.para_id) for i in L.outline
        ]


def test_paragraph_over_64kb_is_stored_whole(con):
    huge = " ".join(f"sana{i}" for i in range(40_000))
    versions = [v(1, T1, huge)]
    store_lineage(con, 90099, "Iso", versions, build_lineage(versions))
    with con.cursor() as cur:
        cur.execute("SELECT text FROM paragraph WHERE lang='fi' AND page_id=90099")
        assert cur.fetchone()["text"] == huge
