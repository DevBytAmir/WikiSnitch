import pytest

from api.diff import word_diff
from api.history_cache import clear_cache


@pytest.fixture(autouse=True)
def _fresh_cache():
    clear_cache()
    yield
    clear_cache()


def test_word_diff():
    assert word_diff("a b c", "a x c") == [
        {"op": "equal", "text": "a"},
        {"op": "delete", "text": "b"},
        {"op": "insert", "text": "x"},
        {"op": "equal", "text": "c"},
    ]
    assert word_diff("", "a b") == [{"op": "insert", "text": "a b"}]
    assert word_diff("a", "a") == [{"op": "equal", "text": "a"}]


def test_history_of_numbers_paragraph(client):
    h = client.get("/api/paragraphs/fi/9001/1/history").json()
    types = [s["change"]["type"] for s in h["states"]]
    assert types == ["created", "restored", "numbers"]
    last = h["states"][-1]["change"]
    assert last["numbers_removed"] == ["25000"] and last["numbers_added"] == ["70000"]
    assert h["states"][-1]["to"] is None and h["metrics"]["substantive_changes"] == 1
    assert h["states"][0]["change"]["diff"] == []
    assert h["sql"]


def test_history_marks_undone_states(client):
    h = client.get("/api/paragraphs/fi/9001/5/history").json()
    undone = [s for s in h["states"] if s["reverted"]]
    assert len(undone) == 2 and all(s["change"]["similarity_to_previous"] is None for s in undone)
    assert h["metrics"]["reverted_states"] == 2 and h["paragraph"]["badge"]["level"] == "disputed"


def test_history_of_removed_paragraph(client):
    h = client.get("/api/paragraphs/fi/9001/3/history").json()
    assert len(h["states"]) == 1 and h["states"][0]["anonymous"] is True
    assert h["states"][0]["reverted"] is True
    assert h["metrics"]["substantive_changes"] == 0 and h["metrics"]["reverted_states"] == 1
    assert h["paragraph"]["badge"]["level"] == "unknown"


def test_history_meaning_change(client):
    h = client.get("/api/paragraphs/fi/9001/2/history").json()
    last = h["states"][-1]["change"]
    assert last["type"] == "meaning" and last["similarity_to_previous"] < 0.9


def test_history_unknown_paragraph_404(client):
    r = client.get("/api/paragraphs/fi/9001/99/history")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert client.get("/api/paragraphs/fi/424242/1/history").status_code == 404


def test_history_no_history_409(client):
    r = client.get("/api/paragraphs/fi/9003/1/history")
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_history"


def test_history_wikipedia_urls(client):
    h = client.get("/api/paragraphs/fi/9001/1/history").json()
    for s in h["states"]:
        assert s["wikipedia_url"] == f"https://fi.wikipedia.org/?oldid={s['rev_id']}"


def test_removed_paragraph_has_unknown_badge(client):
    from datetime import datetime, timezone

    from core.db import connect
    from core.lineage import Version, build_lineage
    from pipeline.load_articles import store_article_rows
    from pipeline.load_history import store_lineage

    text_a = "Tämä kappale poistettiin artikkelista myöhemmin eikä sitä palautettu koskaan takaisin."
    text_b = "Tämä toinen kappale jäi artikkeliin pysyvästi ja on yhä mukana nykyisessä versiossa."
    t1, t2 = (datetime(2010, 1, 1, tzinfo=timezone.utc), datetime(2012, 1, 1, tzinfo=timezone.utc))
    versions = [Version(1, t1, "A", False, None, False, "a" * 31, text_a + "\n" + text_b),
                Version(2, t2, "B", False, None, False, "b" * 31, text_b)]
    con = connect()
    store_article_rows(con, [{"lang": "fi", "page_id": 90777, "rev_id": 2, "wikidata_id": None,
                              "title": "Poisto", "url": "https://fi.wikipedia.org/?curid=90777",
                              "date_modified": "2012-01-01T00:00:00Z", "text": text_b}])
    store_lineage(con, 90777, "Poisto", versions, build_lineage(versions))
    from core.embedder import FakeEmbedder
    from pipeline.embed import embed_missing
    embed_missing(con, FakeEmbedder())
    con.close()
    body = client.get("/api/paragraphs/fi/90777/1/history").json()
    assert body["states"][-1]["to"] is not None and body["paragraph"]["badge"]["level"] == "unknown"
