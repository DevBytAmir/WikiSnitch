import pytest

from api.app import app
from api.llm import FakeLlm, LlmUnavailable
from api.routes.paragraphs import get_assess_llm
from core.db import connect

GOOD = '{"label": "differs", "explanation": "The death toll differs."}'


@pytest.fixture(autouse=True)
def _clean():
    def wipe():
        con = connect()
        try:
            with con.cursor() as cursor:
                cursor.execute("DELETE FROM llm_cache")
            con.commit()
        finally:
            con.close()

    wipe()
    yield
    app.dependency_overrides.clear()
    wipe()


@pytest.fixture
def fake_llm():
    llm = FakeLlm(GOOD)
    app.dependency_overrides[get_assess_llm] = lambda: llm
    return llm


def crosslang(client, para_id):
    return client.get(f"/api/paragraphs/fi/9001/{para_id}/crosslang")


def en(response):
    assert response.status_code == 200
    return next(t for t in response.json()["targets"] if t["lang"] == "en")


def test_assessment_present(client, fake_llm):
    target = en(crosslang(client, 1))
    assert target["assessment"] == {
        "label": "differs", "explanation": "The death toll differs.", "model": "fake",
    }
    assert len(fake_llm.calls) >= 1
    assert "Source (fi): «" in fake_llm.calls[0][1] and "\nTarget (en): «" in fake_llm.calls[0][1]


def test_assessment_cached(client, fake_llm):
    first = en(crosslang(client, 1))
    calls = len(fake_llm.calls)
    assert calls >= 1
    second = en(crosslang(client, 1))
    assert len(fake_llm.calls) == calls
    assert second["assessment"] == first["assessment"]


def test_invalid_json_gives_null(client, fake_llm):
    fake_llm.reply = "not json at all"
    assert en(crosslang(client, 1))["assessment"] is None


def test_unknown_label_gives_null(client, fake_llm):
    fake_llm.reply = '{"label": "maybe", "explanation": "x"}'
    assert en(crosslang(client, 1))["assessment"] is None


def test_model_down_gives_null_and_200(client):
    def down(system, user):
        raise LlmUnavailable("down")

    app.dependency_overrides[get_assess_llm] = lambda: FakeLlm(down)
    assert en(crosslang(client, 1))["assessment"] is None


def test_not_called_for_not_found(client, fake_llm):
    target = en(crosslang(client, 4))
    assert target["verdict"] == "not_found" and target["assessment"] is None
    assert all("Target (en)" not in user for _, user in fake_llm.calls)


def test_explanation_is_cut(client, fake_llm):
    fake_llm.reply = 'Sure: {"label": "agrees", "explanation": "' + "x" * 400 + '"} done'
    assert len(en(crosslang(client, 1))["assessment"]["explanation"]) == 300
