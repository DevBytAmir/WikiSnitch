import pytest

from api.app import app
from api.llm import FakeLlm
from api.routes.ask import get_ask_llm
from core.db import connect

OLD_QUESTION = (
    "Milloin Testisota alkoi vuonna 1939 ja siinä kuoli noin 25 000 sotilasta "
    "pohjoisen rajan taisteluissa?"
)
NEW_QUESTION = OLD_QUESTION.replace("25 000", "70 000")
JUNK_QUESTION = (
    "Tässä on aivan toisenlaista roskaa ilman mitään sisältöä, eikä tämä liity "
    "artikkelin aiheeseen mitenkään."
)
NO_ANSWER = "The Wikipedia articles in this dataset do not appear to cover this question."


@pytest.fixture(autouse=True)
def _empty_llm_cache():
    con = connect()
    try:
        with con.cursor() as cursor:
            cursor.execute("DELETE FROM llm_cache")
        con.commit()
    finally:
        con.close()


@pytest.fixture(autouse=True)
def _llm():
    llm = FakeLlm()
    llm.reply = "Vastaus [1]."
    app.dependency_overrides[get_ask_llm] = lambda: llm
    yield llm
    app.dependency_overrides.clear()


def ask(client, question, **body):
    return client.post("/api/ask", json={"question": question, **body})


def test_as_of_2012_cites_old_number(client):
    past = ask(client, OLD_QUESTION, as_of="2012-01-01").json()
    assert past["retrieval"]["best_similarity"] >= 0.45
    first = [c for c in past["citations"] if (c["page_id"], c["para_id"]) == (9001, 1)]
    assert first and all("25 000" in c["text"] for c in first)
    assert all(c["wikipedia_url"].startswith("https://fi.wikipedia.org/?oldid=") for c in first)

    now = ask(client, OLD_QUESTION).json()
    current = [c for c in now["citations"] if (c["page_id"], c["para_id"]) == (9001, 1)]
    assert current and all("70 000" in c["text"] for c in current)


def test_as_of_excludes_undone_states(client):
    r = ask(client, JUNK_QUESTION, as_of="2007-01-10T09:02:00Z").json()
    assert all("roskaa" not in c["text"] for c in r["citations"])


def test_as_of_with_other_language_400(client):
    r = ask(client, OLD_QUESTION, as_of="2012-01-01", lang="en")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "bad_request"
    assert "Finnish articles only" in r.json()["error"]["message"]


def test_as_of_with_finnish_language_is_accepted(client):
    r = ask(client, OLD_QUESTION, as_of="2012-01-01", lang="fi")
    assert r.status_code == 200


def test_as_of_sql_contains_for_system_time(client):
    r = ask(client, OLD_QUESTION, as_of="2012-01-01").json()
    assert any("FOR SYSTEM_TIME AS OF" in s["statement"] for s in r["sql"])


def test_as_of_response_echoes_moment(client):
    r = ask(client, OLD_QUESTION, as_of="2012-01-01").json()
    assert r["as_of"] == "2012-01-01T00:00:00Z"


def test_as_of_before_any_article_is_no_answer(client):
    r = ask(client, OLD_QUESTION, as_of="2001-01-01").json()
    assert r["mode"] == "no_answer" and r["answer"] == NO_ANSWER and r["citations"] == []
