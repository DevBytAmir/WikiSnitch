import pytest


def codes(item):
    return [r["code"] for r in item["reasons"]]


def test_queue_order(client):
    r = client.get("/api/articles/fi/9001/review")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"needs_attention", "missing_here", "sql"}
    items = body["needs_attention"]
    assert [i["paragraph"]["para_id"] for i in items] == [2, 5, 1, 6]
    assert [i["score"] for i in items] == [0.55, 0.45, 0.30, 0.15]
    ids = {i["paragraph"]["para_id"] for i in items}
    assert 4 not in ids and 7 not in ids
    assert all(i["paragraph"]["has_history"] is True for i in items)
    assert body["sql"] and all("%s" not in s["statement"] for s in body["sql"])


def test_reason_codes(client):
    items = {i["paragraph"]["para_id"]: i for i in client.get("/api/articles/fi/9001/review").json()["needs_attention"]}
    assert "disputed" in codes(items[5])
    assert "differs_from_en" in codes(items[1])


def test_missing_here_lists_english_gap(client):
    missing = client.get("/api/articles/fi/9001/review").json()["missing_here"]
    keys = {(m["lang"], m["para_id"]) for m in missing}
    assert ("en", 2) in keys
    assert ("en", 1) not in keys
    assert len(missing) <= 20


@pytest.mark.parametrize("path", ["fi/9003", "en/8001"])
def test_no_history_409(client, path):
    r = client.get(f"/api/articles/{path}/review")
    assert r.status_code == 409
    error = r.json()["error"]
    assert error["code"] == "no_history"
    assert error["message"] == "This article was loaded without edit history."


def test_unknown_article_404(client):
    r = client.get("/api/articles/fi/99999/review")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
