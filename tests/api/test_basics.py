from datetime import datetime, timezone

import pytest

from api.errors import ApiError
from api.params import parse_as_of
from core.config import SNAPSHOT


def dt(*args):
    return datetime(*args, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, SNAPSHOT),
        ("", SNAPSHOT),
        ("2015-06-01", dt(2015, 6, 1)),
        ("2015-06-01 12:30", dt(2015, 6, 1, 12, 30)),
        ("2015-06-01T12:30:00Z", dt(2015, 6, 1, 12, 30)),
        ("2015-06-01T14:30:00+02:00", dt(2015, 6, 1, 12, 30)),
        ("2030-01-01", SNAPSHOT),
    ],
)
def test_parse_as_of(value, expected):
    assert parse_as_of(value) == expected


@pytest.mark.parametrize("value", ["garbage", "2015-13-01", "01.06.2015", "2015"])
def test_parse_as_of_rejects(value):
    with pytest.raises(ApiError) as error:
        parse_as_of(value)
    assert (error.value.status, error.value.code) == (400, "bad_request")


def test_unknown_route_uses_error_body(client):
    assert client.get("/api/nope").json() == {
        "error": {"code": "not_found", "message": "Not found."}
    }


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["snapshot"] == "2026-10-01T00:00:00Z"
    assert body["counts"]["history_articles"] >= 2
    assert body["embedder"] is True


def test_internal_error_hides_details(client):
    from api.app import app

    def broken_route():
        raise RuntimeError("secret")

    app.add_api_route("/api/test-internal-error", broken_route)
    response = client.get("/api/test-internal-error")
    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal", "message": "Internal error."}
    }
    assert "secret" not in response.text


def test_health_reports_exactly_the_documented_counts(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok" and set(body["counts"]) == {
        "articles", "history_articles", "paragraph_states", "vectors"}


def test_health_reports_unreachable_embedder(client, monkeypatch):
    monkeypatch.setenv("EMBEDDER", "ollama")
    monkeypatch.setenv("EMBED_BASE_URL", "http://127.0.0.1:9")
    assert client.get("/api/health").json()["embedder"] is False
