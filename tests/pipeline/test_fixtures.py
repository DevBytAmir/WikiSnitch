from rapidfuzz.distance import Indel

from core.badges import compute_badge, compute_metrics
from core.changes import describe_changes
from core.clean import blocks, markdown_blocks
from core.config import SNAPSHOT
from core.db import connect
from core.embedder import FakeEmbedder
from core.lineage import mark_undone
from core.rows import fetch_states
from core.thresholds import load_thresholds
from core.vectors import cosine
from db.fixtures import data

EMB = FakeEmbedder()


def clean(text):
    return blocks(text)[0].text


def sim(a, b):
    x, y = EMB.embed([a, b])
    return cosine(x, y)


def words(a, b):
    return Indel.normalized_similarity(a.split(), b.split())


def test_fixture_database_matches_the_table():
    with connect() as con, con.cursor() as cur:
        cur.execute("SELECT para_id, text FROM paragraph WHERE lang='fi' AND page_id=9001")
        current = {r["para_id"]: r["text"] for r in cur.fetchall()}
        assert current == {
            1: clean(data.P1B), 2: clean(data.P2C), 4: clean(data.P3A), 5: clean(data.P4A),
            6: clean(data.P5A), 7: clean(data.P3A),
        }
        states = fetch_states(cur, "fi", 9001, 3)
        assert len(states) == 1 and states[0].undone and states[0].anonymous
        assert states[0].end is not None
        cur.execute("SELECT citations FROM paragraph WHERE lang='fi' AND page_id=9001 AND para_id=4")
        assert cur.fetchone()["citations"] == 1
        cur.execute(
            "SELECT heading, para_id FROM article_outline WHERE lang='fi' AND page_id=9001 ORDER BY pos"
        )
        outline = [(r["heading"], r["para_id"]) for r in cur.fetchall()]
        assert outline == [
            (None, 5), ("Tausta", None), (None, 1), (None, 2), ("Seuraukset", None),
            (None, 4), (None, 6), (None, 7),
        ]
        cur.execute(
            "SELECT rev_id FROM article_history FOR SYSTEM_TIME ALL "
            "WHERE page_id=9001 AND undone ORDER BY rev_id"
        )
        assert [r["rev_id"] for r in cur.fetchall()] == [103, 107, 113, 115]
        cur.execute(
            "SELECT COUNT(*) AS n FROM article_history FOR SYSTEM_TIME ALL WHERE page_id=9001"
        )
        assert cur.fetchone()["n"] == 16
        counts = {}
        for lang, page_id in [("fi", 9002), ("fi", 9003), ("en", 8001), ("sv", 7001), ("en", 8003)]:
            cur.execute(
                "SELECT COUNT(*) AS n FROM paragraph WHERE lang=%s AND page_id=%s", (lang, page_id)
            )
            counts[(lang, page_id)] = cur.fetchone()["n"]
        assert counts == {
            ("fi", 9002): 1, ("fi", 9003): 1, ("en", 8001): 2, ("sv", 7001): 1, ("en", 8003): 1,
        }


def test_fixture_texts_have_the_required_properties():
    fi = [data.P1A, data.P1B, data.P2A, data.P2B, data.P2C, data.P3A, data.P4A, data.P4X,
          data.P4Y, data.P5A, data.JUNK]
    for text in fi:
        n = len(clean(text))
        assert 90 <= n <= 160, (n, text)
    assert 55 <= len(data.SHORT) <= 65
    assert len(data.NO_HISTORY) >= 90
    assert data.P3A.count("<ref>") == 1 and len(blocks(data.P3A)) == 1
    assert blocks(data.P3A)[0].citations == 1
    assert data.P1B == data.P1A.replace("25 000", "70 000") != data.P1A
    assert len(data.P2A.split()) >= 25
    a, b = data.P2A.split(), data.P2B.split()
    assert len(a) == len(b) and sum(x != y for x, y in zip(a, b)) == 1
    assert sim(data.P2A, data.P2B) > 0.90
    assert words(data.P2B, data.P2C) >= 0.6
    assert sim(data.P2B, data.P2C) < 0.90
    assert words(data.P4A, data.P4X) >= 0.6 and words(data.P4A, data.P4Y) >= 0.6
    assert not set(data.JUNK.split()) & set(data.P2B.split())
    assert sim(data.P1B, data.E1) >= 0.75
    assert sim(data.P2C, data.S1) >= 0.75
    fi_words = {w.lower() for t in fi for w in t.split()}
    for text in (data.E2, data.EN_8003):
        assert not {w.lower() for w in text.split()} & fi_words
    assert sim(data.P3A, data.E1) < 0.60 and sim(data.P3A, data.E2) < 0.60
    assert "25,000" in data.E1


def test_fixture_versions_mark_the_expected_undone():
    versions = data.FI_HISTORY[9001]
    undone = mark_undone(versions)
    assert [v.rev_id for v, u in zip(versions, undone) if u] == [103, 107, 113, 115]
    assert [v.rev_id for v in versions] == list(range(101, 117))
    assert versions[3].text == versions[1].text
    assert versions[7].text == versions[5].text
    assert versions[13].text == versions[11].text == versions[15].text
    assert {a["lang"] + str(a["page_id"]) for a in data.S_ARTICLES} == {
        "fi9001", "fi9002", "fi9003", "en8001", "sv7001", "en8003",
    }
    assert [b.text for b in markdown_blocks(data.S_ARTICLES[3]["text"])][0] == "Test War"


def test_fixture_badges_match_the_table():
    th = load_thresholds()
    expected = {
        1: ("stable", "Stable since 2015"),
        2: ("changed_recently", "Changed April 2026"),
        4: ("stable", "Stable since 2008"),
        5: ("disputed", "Disputed"),
        6: ("new", "New since August 2026"),
        7: ("new", "New since August 2026"),
    }
    with connect() as con, con.cursor() as cur:
        for para_id, (level, label) in expected.items():
            states = fetch_states(cur, "fi", 9001, para_id)
            texts = sorted({s.text for s in states})
            vectors = {}
            for s in states:
                vectors[s.text_hash] = EMB.embed([s.text])[0]
            changes = describe_changes(states, vectors, th)
            metrics = compute_metrics(states, changes, vectors, SNAPSHOT)
            badge = compute_badge(metrics, changes, states, SNAPSHOT)
            assert (badge.level, badge.label) == (level, label), (para_id, texts)
            if para_id == 1:
                assert [c.type for c in changes] == ["created", "restored", "numbers"]
