import pytest

from api.history_cache import clear_cache


@pytest.fixture(autouse=True)
def _fresh_cache():
    clear_cache()
    yield
    clear_cache()


def _order(body):
    return [
        b["text"] if b["type"] == "heading" else b["paragraph"]["para_id"] for b in body["blocks"]
    ]


def _paragraphs(body):
    return {b["paragraph"]["para_id"]: b["paragraph"] for b in body["blocks"] if b["type"] == "paragraph"}


def test_list_puts_history_articles_first(client):
    body = client.get("/api/articles").json()
    flags = [a["has_history"] for a in body["articles"]]
    assert flags == sorted(flags, reverse=True)
    assert flags[0] is True and False in flags
    assert body["sql"]
    first = body["articles"][0]
    assert set(first) == {"lang", "page_id", "title", "wikidata_id", "has_history", "versions", "languages"}
    by_key = {(a["lang"], a["page_id"]): a for a in body["articles"]}
    assert by_key[("fi", 9001)]["versions"] == 16
    assert by_key[("en", 8001)]["versions"] is None


def test_list_prefix_search(client):
    body = client.get("/api/articles", params={"q": "Test"}).json()
    keys = [(a["lang"], a["page_id"]) for a in body["articles"]]
    assert keys[0] == ("fi", 9001)
    assert len(keys) == len(set(keys))
    assert ("en", 8001) in keys


def test_list_history_only(client):
    body = client.get("/api/articles", params={"history_only": "true"}).json()
    assert body["articles"] and all(a["has_history"] for a in body["articles"])


@pytest.mark.parametrize("limit", [0, 201])
def test_list_limit_bounds(client, limit):
    r = client.get("/api/articles", params={"limit": limit})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"


def test_current_article_blocks_and_badges(client):
    body = client.get("/api/articles/fi/9001").json()
    assert _order(body) == [5, "Tausta", 1, 2, "Seuraukset", 4, 6, 7]
    paras = _paragraphs(body)
    levels = {k: p["badge"]["level"] for k, p in paras.items()}
    assert levels[1] == "stable" and levels[4] == "stable"
    assert levels[5] == "disputed"
    assert levels[6] == "new" and levels[7] == "new"
    assert levels[2] == "changed_recently"
    assert paras[4]["citations"] == 1 and paras[4]["has_history"] is True
    assert paras[1]["section"] == "Tausta" and paras[1]["kind"] == "p"
    article = body["article"]
    assert article["rev_id"] == 116 and article["as_of"] == "2026-10-01T00:00:00Z"
    assert article["saved_by"] == "Aino" and article["saved_at"] == "2026-09-02T00:00:00Z"
    assert article["first_version"] == "2005-03-01T10:00:00Z"
    assert article["wikipedia_url"] == "https://fi.wikipedia.org/?oldid=116"
    assert article["has_history"] is True and article["wikidata_id"] == "Q9001"
    assert set(article) == {
        "lang", "page_id", "title", "wikidata_id", "rev_id", "as_of", "saved_at", "saved_by",
        "wikipedia_url", "has_history", "first_version", "languages",
    }


def test_article_as_of_2006(client):
    body = client.get("/api/articles/fi/9001", params={"as_of": "2006-06-01"}).json()
    assert _order(body) == ["Tausta", 1, 2]
    paras = _paragraphs(body)
    assert paras[1]["text"].startswith("Testisota alkoi") and "25 000" in paras[1]["text"]
    assert "maan tavan, mutta työ" in paras[2]["text"]
    assert body["article"]["rev_id"] == 102
    assert body["article"]["as_of"] == "2006-06-01T00:00:00Z"
    assert body["article"]["saved_at"] == "2006-05-02T12:00:00Z"
    assert body["article"]["saved_by"] == "Björn"
    assert any("FOR SYSTEM_TIME AS OF" in s["statement"] for s in body["sql"])


def test_article_as_of_during_blanking_is_empty(client):
    r = client.get("/api/articles/fi/9001", params={"as_of": "2010-02-02T00:05:00Z"})
    assert r.status_code == 200
    assert r.json()["blocks"] == []
    assert r.json()["article"]["rev_id"] == 107


def test_article_before_creation_is_404_not_yet_created(client):
    r = client.get("/api/articles/fi/9001", params={"as_of": "2004-01-01"})
    assert r.status_code == 404
    assert r.json() == {
        "error": {
            "code": "not_yet_created",
            "message": "This article did not exist yet on 2004-01-01.",
        }
    }


def test_article_without_history_has_unknown_badges(client):
    body = client.get("/api/articles/fi/9003").json()
    assert body["article"]["has_history"] is False
    assert body["article"]["first_version"] is None and body["article"]["saved_by"] is None
    assert body["article"]["saved_at"] == "2025-08-01T00:00:00Z"
    paras = _paragraphs(body)
    assert paras and all(
        p["badge"]["level"] == "unknown" and p["citations"] is None and p["has_history"] is False
        for p in paras.values()
    )
    past = client.get("/api/articles/fi/9003", params={"as_of": "2015-01-01"}).json()
    assert past["article"]["as_of"] == "2025-08-01T00:00:00Z"


def test_english_article(client):
    body = client.get("/api/articles/en/8001").json()
    assert body["article"]["has_history"] is False
    assert body["article"]["wikipedia_url"] == "https://en.wikipedia.org/?oldid=801"
    paras = _paragraphs(body)
    assert len(paras) == 2
    assert all(p["citations"] is None for p in paras.values())


def test_unknown_article_404(client):
    r = client.get("/api/articles/fi/424242")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_languages_listed(client):
    langs = client.get("/api/articles/fi/9001").json()["article"]["languages"]
    assert {(x["lang"], x["page_id"], x["title"]) for x in langs} == {
        ("en", 8001, "Test War"),
        ("sv", 7001, "Testkriget"),
    }
    assert client.get("/api/articles/fi/9002").json()["article"]["languages"] == []


def test_unknown_lang_is_400(client):
    response = client.get("/api/articles/xx/1")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"


def test_sql_field_hides_values(client):
    response = client.get("/api/articles/fi/9001").json()
    assert response["sql"]
    assert all(
        "%s" not in statement["statement"] and "9001" not in statement["statement"]
        for statement in response["sql"]
    )
