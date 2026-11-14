"""The answer-model client, a fake for tests, and a database cache of answers.

The client speaks the OpenAI-compatible ``/chat/completions`` protocol, so any hosted or local
service that offers it can answer questions. It is configured by the ``LLM_*`` settings.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from typing import Literal, Protocol

import requests

from api.db import Db
from core.config import Settings


class LlmUnavailable(Exception):
    """The answer model cannot be reached, refused the request or returned no text."""


class Llm(Protocol):
    """Anything that can complete a prompt and names its model."""

    model: str

    def complete(self, system: str, user: str, max_tokens: int = 400) -> str: ...


class OpenAICompatibleLlm:
    """Calls ``{base_url}/chat/completions`` with temperature 0, so answers are repeatable."""

    def __init__(self, base_url: str, model: str, api_key: str = "", timeout: float = 20):
        self.base_url = base_url
        self.model = model
        self.api_key = api_key
        self.timeout = timeout

    def complete(self, system: str, user: str, max_tokens: int = 400) -> str:
        """The model's reply as text. Raises ``LlmUnavailable`` on any failure or an empty reply."""
        try:
            response = requests.post(
                self.base_url.rstrip("/") + "/chat/completions",
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": 0,
                    "max_tokens": max_tokens,
                },
                headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise LlmUnavailable("Answer model unreachable") from exc
        if response.status_code != 200:
            raise LlmUnavailable(f"Answer model returned HTTP {response.status_code}")
        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LlmUnavailable("Answer model returned no text") from exc
        if not isinstance(content, str) or not content.strip():
            raise LlmUnavailable("Answer model returned no text")
        return content.strip()


class FakeLlm:
    """A test double: replies with a fixed string or a function of the prompts, and records calls."""

    model = "fake"

    def __init__(self, reply: str | Callable[[str, str], str] = ""):
        self.reply = reply
        self.calls: list[tuple[str, str]] = []

    def complete(self, system: str, user: str, max_tokens: int = 400) -> str:
        self.calls.append((system, user))
        return self.reply(system, user) if callable(self.reply) else self.reply


def get_llm(role: Literal["ask", "assess"], settings: Settings) -> Llm | None:
    """The client for a role, or ``None`` when no model is configured.

    The ``assess`` role uses its own settings if given, otherwise the ``ask`` ones. With none, the
    app still works: answers are extractive and cross-language assessments are left out.
    """
    if role == "assess" and settings.llm_assess_base_url:
        base_url = settings.llm_assess_base_url
        model = settings.llm_assess_model
        api_key = settings.llm_assess_api_key
    else:
        base_url = settings.llm_ask_base_url
        model = settings.llm_ask_model
        api_key = settings.llm_ask_api_key
    if not base_url:
        return None
    return OpenAICompatibleLlm(base_url, model, api_key)


def cached_complete(db: Db, llm: Llm, kind: str, system: str, user: str) -> str:
    """Complete a prompt, reusing the stored answer if this exact prompt was asked before.

    The key covers the kind, the model and both prompts, so changing any of them asks again.
    """
    key = hashlib.md5("\x00".join([kind, llm.model, system, user]).encode("utf-8")).digest()
    row = db.one("llm cache lookup", "SELECT response FROM llm_cache WHERE cache_key = %s", (key,))
    if row is not None:
        return json.loads(row["response"])["text"]
    text = llm.complete(system, user)
    db.query(
        "llm cache store",
        "INSERT IGNORE INTO llm_cache (cache_key, kind, model, response, created) "
        "VALUES (%s,%s,%s,%s,UTC_TIMESTAMP())",
        (key, kind, llm.model, json.dumps({"text": text})),
    )
    db.con.commit()
    return text
