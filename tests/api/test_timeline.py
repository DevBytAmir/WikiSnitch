import pytest


def test_timeline_months_and_totals(client):
    r = client.get("/api/articles/fi/9001/timeline")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"months", "totals", "sql"}
    assert body["totals"] == {"versions": 16, "reverts": 4, "first": "2005-03-01", "last": "2026-09-02"}
    by_month = {m["month"]: m for m in body["months"]}
    assert by_month["2007-01"] == {
        "month": "2007-01", "edits": 2, "reverts": 1, "reverts_of_anonymous": 1,
    }
    assert [m["month"] for m in body["months"]] == sorted(by_month)
    assert body["sql"] and all("%s" not in s["statement"] for s in body["sql"])


@pytest.mark.parametrize("path", ["fi/9003", "en/8001"])
def test_timeline_no_history_409(client, path):
    r = client.get(f"/api/articles/{path}/timeline")
    assert r.status_code == 409
    error = r.json()["error"]
    assert error["code"] == "no_history"
    assert error["message"] == "This article was loaded without edit history."


def test_timeline_unknown_article_404(client):
    r = client.get("/api/articles/fi/99999/timeline")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_timeline_bad_lang_400(client):
    r = client.get("/api/articles/xx/9001/timeline")
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"


def test_timeline_sql_is_shown_as_written(client):
    statements = [s["statement"] for s in client.get("/api/articles/fi/9001/timeline").json()["sql"]]
    assert any("'%Y-%m'" in s for s in statements) and not any("%%" in s for s in statements)
