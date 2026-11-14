import pytest
from fastapi.routing import APIRoute

from api.app import app
from api.llm import FakeLlm
from api.models import (
    ArticleList,
    ArticleView,
    AskView,
    CrossLangView,
    HistoryView,
    ReviewView,
    Timeline,
)
from api.routes.ask import get_ask_llm, get_question_embedder
from core.db import connect
from core.embedder import EmbedderUnavailable

QUESTION = (
    "Milloin Testisota alkoi vuonna 1939 ja siinä kuoli noin 70 000 sotilasta "
    "pohjoisen rajan taisteluissa?"
)
OLD_QUESTION = QUESTION.replace("70 000", "25 000")
NO_ANSWER_QUESTION = "zzz qqq xxx"

ART = "/api/articles/{lang}/{page_id}"
HIST = "/api/paragraphs/{lang}/{page_id}/{para_id}/history"
CROSS = "/api/paragraphs/{lang}/{page_id}/{para_id}/crosslang"

GENERATED = "generated"
EXTRACTIVE = "extractive"
EMBEDDER_DOWN = "embedder_down"


def get(name, template, url, model):
    return (name, "GET", template, url, None, model, None)


def ask(name, question, mode, **body):
    return (name, "POST", "/api/ask", "/api/ask", {"question": question, **body}, AskView, mode)


# (name, method, route template, url, json body, response model, ask mode)
OK_CASES = [
    get("health", "/api/health", "/api/health", None),
    get("articles", "/api/articles", "/api/articles", ArticleList),
    get("articles-q", "/api/articles", "/api/articles?q=Test", ArticleList),
    get("article-fi-9001", ART, "/api/articles/fi/9001", ArticleView),
    get("article-fi-9001-asof-2006", ART, "/api/articles/fi/9001?as_of=2006-06-01", ArticleView),
    get("article-fi-9003", ART, "/api/articles/fi/9003", ArticleView),
    get("article-en-8001", ART, "/api/articles/en/8001", ArticleView),
    get("timeline-fi-9001", ART + "/timeline", "/api/articles/fi/9001/timeline", Timeline),
    *[
        get(f"history-fi-9001-{n}", HIST, f"/api/paragraphs/fi/9001/{n}/history", HistoryView)
        for n in (1, 2, 3, 5)
    ],
    *[
        get(f"crosslang-{key}", CROSS, f"/api/paragraphs/{key}/crosslang", CrossLangView)
        for key in ("fi/9001/1", "fi/9001/4", "fi/9002/1", "fi/9003/1")
    ],
    get("review-fi-9001", ART + "/review", "/api/articles/fi/9001/review", ReviewView),
    ask("ask-generated", QUESTION, GENERATED),
    ask("ask-extractive", QUESTION, EXTRACTIVE),
    ask("ask-no-answer", NO_ANSWER_QUESTION, GENERATED),
    ask("ask-asof-2012", OLD_QUESTION, GENERATED, as_of="2012-01-01"),
]

ERROR_CASES = [
    (*get("404-article", ART, "/api/articles/fi/99999", None)[:5], 404, None),
    (*get("404-paragraph", HIST, "/api/paragraphs/fi/9001/999/history", None)[:5], 404, None),
    (*get("404-crosslang", CROSS, "/api/paragraphs/fi/9001/999/crosslang", None)[:5], 404, None),
    (*get("409-timeline", ART + "/timeline", "/api/articles/fi/9003/timeline", None)[:5], 409, None),
    (*get("400-lang", ART, "/api/articles/xx/9001", None)[:5], 400, None),
    (*get("400-as-of", ART, "/api/articles/fi/9001?as_of=yesterday", None)[:5], 400, None),
    (*ask("422-empty-question", "", GENERATED)[:5], 422, GENERATED),
    (*ask("503-embedder-down", QUESTION, GENERATED)[:5], 503, EMBEDDER_DOWN),
]


class DownEmbedder:
    model = "down"

    def embed(self, texts):
        raise EmbedderUnavailable("down")


def setup_ask(mode):
    if mode is None:
        return
    if mode == EMBEDDER_DOWN:
        app.dependency_overrides[get_question_embedder] = lambda: DownEmbedder()
        mode = GENERATED
    llm = None if mode == EXTRACTIVE else FakeLlm("Sota alkoi 1939 [1].")
    app.dependency_overrides[get_ask_llm] = lambda: llm


class HealthShape:
    @staticmethod
    def model_validate(body):
        assert set(body) == {"status", "snapshot", "embedder", "answer_model", "counts", "sql"}
        assert body["status"] == "ok"
        assert set(body["counts"]) == {"articles", "history_articles", "paragraph_states", "vectors"}
        assert isinstance(body["embedder"], bool) and isinstance(body["answer_model"], bool)
        assert body["sql"] and set(body["sql"][0]) == {"label", "statement"}


@pytest.fixture(autouse=True)
def _clean():
    con = connect()
    try:
        with con.cursor() as cursor:
            cursor.execute("DELETE FROM llm_cache")
        con.commit()
    finally:
        con.close()
    yield
    app.dependency_overrides.clear()


def walk(routes):
    for route in routes:
        inner = getattr(route, "original_router", None)
        if inner is not None:
            yield from walk(inner.routes)
        else:
            yield route


def api_routes():
    found = set()
    for route in walk(app.routes):
        if (
            isinstance(route, APIRoute)
            and route.path.startswith("/api")
            and route.endpoint.__module__.startswith("api.routes")
        ):
            found |= {(m, route.path) for m in route.methods if m in ("GET", "POST")}
    return found


def covered():
    return {(c[1], c[2]) for c in OK_CASES + ERROR_CASES}


def call(client, method, url, body):
    if method == "POST":
        return client.post(url, json=body)
    return client.get(url)


@pytest.mark.parametrize("case", OK_CASES, ids=lambda c: c[0])
def test_ok_body_matches_model(client, case):
    _, method, _, url, body, model, mode = case
    setup_ask(mode)
    r = call(client, method, url, body)
    assert r.status_code == 200, r.text
    (model or HealthShape).model_validate(r.json())


@pytest.mark.parametrize("case", ERROR_CASES, ids=lambda c: c[0])
def test_error_body_shape(client, case):
    _, method, _, url, body, status, mode = case
    setup_ask(mode)
    r = call(client, method, url, body)
    assert r.status_code == status, r.text
    payload = r.json()
    assert set(payload) == {"error"}
    assert set(payload["error"]) == {"code", "message"}
    assert all(isinstance(v, str) and v for v in payload["error"].values())


def test_ask_modes(client):
    seen = {}
    for case in OK_CASES:
        if case[0].startswith("ask-"):
            setup_ask(case[6])
            seen[case[0]] = call(client, case[1], case[3], case[4]).json()["mode"]
    assert seen == {
        "ask-generated": "generated",
        "ask-extractive": "extractive",
        "ask-no-answer": "no_answer",
        "ask-asof-2012": "generated",
    }


def test_every_route_has_a_case():
    routes = api_routes()
    assert len(routes) >= 7
    missing = routes - covered()
    assert not missing, f"routes without a contract case: {sorted(missing)}"
