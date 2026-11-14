from __future__ import annotations

import dataclasses
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from api.db import Db
from api.llm import (
    FakeLlm,
    LlmUnavailable,
    OpenAICompatibleLlm,
    cached_complete,
    get_llm,
)
from core.config import load_settings
from core.db import connect

KEY = "sk-test-123"


@pytest.fixture
def db():
    con = connect()
    try:
        yield Db(con)
    finally:
        con.close()


def _unique(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def test_cache_hit_makes_no_call(db):
    system, user = _unique("system"), _unique("user")
    llm = FakeLlm(reply="first")
    assert cached_complete(db, llm, "ask", system, user) == "first"

    llm.reply = "second"
    assert cached_complete(db, llm, "ask", system, user) == "first"
    assert len(llm.calls) == 1


def test_cache_key_differs_by_model(db):
    system, user = _unique("system"), _unique("user")
    first = FakeLlm(reply="alpha")
    second = FakeLlm(reply="beta")
    second.model = "other-model"

    assert cached_complete(db, first, "ask", system, user) == "alpha"
    assert cached_complete(db, second, "ask", system, user) == "beta"
    assert len(second.calls) == 1


def test_unreachable_raises_unavailable():
    llm = OpenAICompatibleLlm("http://127.0.0.1:9", "model", timeout=1)
    with pytest.raises(LlmUnavailable):
        llm.complete("system", "user")


def test_error_message_has_no_key():
    llm = OpenAICompatibleLlm("http://127.0.0.1:9", "model", api_key=KEY, timeout=1)
    with pytest.raises(LlmUnavailable) as unreachable:
        llm.complete("system", "user")
    assert KEY not in str(unreachable.value)

    class ErrorHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            self.rfile.read(length)
            body = f"upstream rejected key {KEY}".encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), ErrorHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        llm = OpenAICompatibleLlm(f"http://127.0.0.1:{port}", "model", api_key=KEY, timeout=5)
        with pytest.raises(LlmUnavailable) as failed:
            llm.complete("system", "user")
        assert KEY not in str(failed.value)
        assert "HTTP 500" in str(failed.value)
    finally:
        server.shutdown()
        server.server_close()


def test_get_llm_none_without_base_url():
    settings = dataclasses.replace(load_settings(), llm_ask_base_url="", llm_assess_base_url="")
    assert get_llm("ask", settings) is None
    assert get_llm("assess", settings) is None


def test_assess_falls_back_to_ask_settings():
    settings = dataclasses.replace(
        load_settings(),
        llm_ask_base_url="http://ask.invalid/v1",
        llm_ask_model="ask-model",
        llm_ask_api_key=KEY,
        llm_assess_base_url="",
        llm_assess_model="assess-model",
        llm_assess_api_key="",
    )
    llm = get_llm("assess", settings)
    assert llm is not None
    assert llm.model == "ask-model"
    assert llm.base_url == "http://ask.invalid/v1"
    assert llm.api_key == KEY
