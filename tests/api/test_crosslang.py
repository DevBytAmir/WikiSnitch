import pytest

from api.app import app
from api.routes.ask import get_question_embedder
from core.embedder import EmbedderUnavailable


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def crosslang(client, lang, page_id, para_id, query=""):
    return client.get(f"/api/paragraphs/{lang}/{page_id}/{para_id}/crosslang{query}")


def target(body, lang):
    return next(t for t in body["targets"] if t["lang"] == lang)


def test_same_claim_with_number_difference(client):
    body = crosslang(client, "fi", 9001, 1).json()
    en = target(body, "en")
    assert en["verdict"] in ("same_claim", "related")
    assert en["verdict"] == "same_claim"
    assert en["number_differences"] == {"only_in_source": ["70000"], "only_in_target": ["25000"]}
    assert en["article"]["wikipedia_url"].startswith("https://en.wikipedia.org/?oldid=")
    assert en["article"]["snapshot"] == "2025-08-01"
    assert en["assessment"] is None and en["elsewhere"] == []
    assert [t["lang"] for t in body["targets"]] == ["en", "sv"]
    assert body["note"] is None


def test_not_found_lists_nearest(client):
    body = crosslang(client, "fi", 9001, 4).json()
    en = target(body, "en")
    assert en["verdict"] == "not_found"
    assert en["matches"]
    assert all(m["similarity"] < body["thresholds"]["related"] for m in en["matches"])
    assert en["number_differences"] is None


def test_no_article(client):
    body = crosslang(client, "fi", 9003, 1).json()
    sv = target(body, "sv")
    assert sv["verdict"] == "no_article"
    assert sv["article"] is None and sv["matches"] == []
    assert target(body, "en")["verdict"] != "no_article"


def test_swedish_match_for_paragraph_2(client):
    body = crosslang(client, "fi", 9001, 2).json()
    assert target(body, "sv")["verdict"] in ("same_claim", "related")


def test_too_short_paragraph_note(client):
    body = crosslang(client, "fi", 9002, 1).json()
    assert body["note"] == "This paragraph is too short to compare."
    for t in body["targets"]:
        assert t["verdict"] == "no_article" or (
            t["verdict"] == "not_found" and t["matches"] == [] and t["elsewhere"] == []
        )
        assert t["number_differences"] is None


def test_non_finnish_source(client):
    body = crosslang(client, "en", 8001, 1).json()
    assert [t["lang"] for t in body["targets"]] == ["sv", "fi"]
    assert target(body, "fi")["verdict"] in ("same_claim", "related")
    assert body["source"]["badge"]["level"] == "unknown"


def test_past_as_of(client):
    r = crosslang(client, "fi", 9001, 1, "?as_of=2006-06-01")
    assert r.status_code == 200
    assert r.json()["source"]["has_history"] is True


def test_works_with_embedder_down(client):
    class Down:
        model = "down"

        def embed(self, texts):
            raise EmbedderUnavailable("down")

    app.dependency_overrides[get_question_embedder] = lambda: Down()
    assert crosslang(client, "fi", 9001, 1).status_code == 200


def test_thresholds_block_present(client):
    body = crosslang(client, "fi", 9001, 1).json()
    assert body["thresholds"] == {"same_claim": 0.75, "related": 0.6, "calibrated": False}
    assert body["sql"]


def test_unknown_paragraph_404(client):
    r = crosslang(client, "fi", 9001, 999)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert crosslang(client, "fi", 99999, 1).status_code == 404
    assert crosslang(client, "xx", 9001, 1).status_code == 400
