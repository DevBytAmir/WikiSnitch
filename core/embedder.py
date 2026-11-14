"""Text embedders.

The provider is chosen by configuration (``EMBEDDER``), so the same code runs against a local
server or a hosted service:

* ``ollama``: an Ollama server at ``EMBED_BASE_URL``.
* ``openai``: any service with an OpenAI-compatible ``/embeddings`` endpoint, hosted or local.
* ``fake``: deterministic vectors for tests, no server needed.
"""

from __future__ import annotations

import hashlib
import math
import random
from typing import TYPE_CHECKING, Any, Protocol

import requests

if TYPE_CHECKING:
    from core.config import Settings


class EmbedderUnavailable(Exception):
    """The embedding service cannot be reached, refused the request or answered unexpectedly."""


class Embedder(Protocol):
    """Anything that turns texts into vectors, naming the model and the vector length."""

    model: str
    dimensions: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class _HttpEmbedder:
    """Shared behaviour of the HTTP providers: batching, errors and the dimension check.

    A provider supplies the request path, the request body and how to read the reply.
    """

    name = "embedding service"

    def __init__(
        self,
        base_url: str,
        model: str,
        dimensions: int,
        *,
        api_key: str = "",
        batch: int = 32,
        timeout: float = 600,
    ) -> None:
        self.url = base_url.rstrip("/")
        self.model = model
        self.dimensions = dimensions
        self.api_key = api_key
        self.batch = batch
        self.timeout = timeout

    def _path(self) -> str:
        raise NotImplementedError

    def _body(self, chunk: list[str]) -> dict[str, Any]:
        raise NotImplementedError

    def _read(self, reply: dict[str, Any]) -> list[list[float]]:
        raise NotImplementedError

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def _embed_chunk(self, chunk: list[str]) -> list[list[float]]:
        try:
            response = requests.post(
                f"{self.url}{self._path()}",
                json=self._body(chunk),
                headers=self._headers(),
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise EmbedderUnavailable(f"{self.name} unreachable at {self.url}") from exc
        if response.status_code != 200:
            raise EmbedderUnavailable(f"{self.name} returned HTTP {response.status_code}")
        try:
            return self._read(response.json())
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise EmbedderUnavailable(f"{self.name} sent an unexpected reply") from exc

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one vector per text, in order.

        Raises ``EmbedderUnavailable`` if the service fails, returns the wrong number of
        vectors, or returns vectors that are not ``dimensions`` long.
        """
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self.batch):
            vectors.extend(self._embed_chunk(texts[start : start + self.batch]))
        if len(vectors) != len(texts):
            raise EmbedderUnavailable(
                f"{self.name} returned {len(vectors)} vectors for {len(texts)} texts"
            )
        for vector in vectors:
            if len(vector) != self.dimensions:
                raise EmbedderUnavailable(
                    f"{self.name} returned a vector of length {len(vector)}, "
                    f"expected {self.dimensions}"
                )
        return vectors


class OllamaEmbedder(_HttpEmbedder):
    """Embeds texts with an Ollama server. The server truncates texts that are too long."""

    name = "Ollama"

    def _path(self) -> str:
        return "/api/embed"

    def _body(self, chunk: list[str]) -> dict[str, Any]:
        return {
            "model": self.model,
            "input": chunk,
            "truncate": True,
            "options": {"num_ctx": 8192, "num_batch": 8192},
        }

    def _read(self, reply: dict[str, Any]) -> list[list[float]]:
        return reply["embeddings"]


class OpenAICompatibleEmbedder(_HttpEmbedder):
    """Embeds texts with any service that offers an OpenAI-style ``/embeddings`` endpoint."""

    name = "Embedding API"

    def _path(self) -> str:
        return "/embeddings"

    def _body(self, chunk: list[str]) -> dict[str, Any]:
        return {"model": self.model, "input": chunk}

    def _read(self, reply: dict[str, Any]) -> list[list[float]]:
        items = sorted(reply["data"], key=lambda item: item["index"])
        return [item["embedding"] for item in items]


class FakeEmbedder:
    """A deterministic embedder for tests: texts that share words get similar vectors.

    It needs no network and no model, and the same text always gives the same vector.
    """

    model = "fake"

    def __init__(self, dim: int = 1024) -> None:
        self.dimensions = dim

    def _token_vector(self, token: str) -> list[float]:
        seed = int.from_bytes(hashlib.md5(token.encode("utf-8")).digest()[:8], "big")
        rng = random.Random(seed)
        return [rng.gauss(0, 1) for _ in range(self.dimensions)]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        total = [0.0] * self.dimensions
        for token in text.lower().split():
            for i, value in enumerate(self._token_vector(token)):
                total[i] += value
        norm = math.sqrt(sum(x * x for x in total))
        if norm == 0:
            unit = [0.0] * self.dimensions
            unit[0] = 1.0
            return unit
        return [x / norm for x in total]


def get_embedder(settings: Settings) -> Embedder:
    """The embedder that ``settings.embedder`` names. Raises ``ValueError`` for an unknown name."""
    provider = settings.embedder
    if provider == "fake":
        return FakeEmbedder(settings.embed_dimensions)
    if provider == "ollama":
        return OllamaEmbedder(
            settings.embed_base_url, settings.embed_model, settings.embed_dimensions
        )
    if provider == "openai":
        return OpenAICompatibleEmbedder(
            settings.embed_base_url,
            settings.embed_model,
            settings.embed_dimensions,
            api_key=settings.embed_api_key,
        )
    raise ValueError(f"Unknown EMBEDDER {provider!r}; use ollama, openai or fake.")
