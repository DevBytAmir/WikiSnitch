import math
import random

import pytest

import core.embedder as embedder_module
from core.config import Settings
from core.embedder import (
    EmbedderUnavailable,
    FakeEmbedder,
    OllamaEmbedder,
    OpenAICompatibleEmbedder,
    get_embedder,
)
from core.vectors import cosine, from_sql, to_sql


class Reply:
    """A stand-in for ``requests.Response``."""

    def __init__(self, body, status_code=200):
        self._body = body
        self.status_code = status_code

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


@pytest.fixture
def posts(monkeypatch):
    """Record every request an embedder makes. Set ``posts.reply`` to control the answer."""

    class Recorder(list):
        reply = None

    recorder = Recorder()

    def fake_post(url, json, headers, timeout):
        recorder.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        return recorder.reply(json)

    monkeypatch.setattr(embedder_module.requests, "post", fake_post)
    return recorder


def settings(**overrides):
    values = {
        "db_host": "h", "db_port": 1, "db_user": "u", "db_password": "p",
        "db_root_password": "r", "db_name": "n", "db_vector_search_depth": 80,
        "embedder": "ollama", "embed_base_url": "http://embed.example/", "embed_model": "m",
        "embed_dimensions": 3, "data_dir": ".",
    }  # fmt: skip
    return Settings(**{**values, **overrides})


def test_fake_embedder_is_deterministic_unit_length_and_sized():
    a, b = FakeEmbedder().embed(["talvisota alkoi 1939", "talvisota alkoi 1939"])
    assert a == b and len(a) == 1024 and abs(sum(x * x for x in a) - 1) < 1e-9


def test_fake_embedder_similarity_follows_token_overlap():
    embedder = FakeEmbedder()
    base, near, far = embedder.embed(
        ["talvisota alkoi marraskuussa 1939", "talvisota alkoi 1939", "aivan muuta asiaa tässä"]
    )
    assert cosine(base, near) > 0.7 > 0.3 > cosine(base, far)


def test_fake_embedder_handles_empty_and_whitespace_texts():
    for vector in FakeEmbedder().embed(["", "   "]):
        assert len(vector) == 1024 and abs(sum(x * x for x in vector) - 1) < 1e-9


def test_cosine_of_a_zero_vector_is_zero():
    assert cosine([0.0, 0.0], [1.0, 0.0]) == 0.0


def test_cosine_matches_the_definition():
    rng = random.Random(5)
    for _ in range(50):
        a = [rng.gauss(0, 1) for _ in range(64)]
        b = [rng.gauss(0, 1) for _ in range(64)]
        expected = sum(x * y for x, y in zip(a, b)) / (
            math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
        )
        assert abs(cosine(a, b) - expected) < 1e-12


def test_every_embedder_reports_its_dimensions():
    assert FakeEmbedder(dim=8).dimensions == 8
    assert OllamaEmbedder("http://embed.example", "m", 3).dimensions == 3
    assert OpenAICompatibleEmbedder("https://api.example/v1", "m", 5).dimensions == 5


def test_vector_text_round_trip():
    assert from_sql(to_sql([0.5, -1.0])) == [0.5, -1.0]


def test_ollama_unreachable_raises_embedder_unavailable():
    with pytest.raises(EmbedderUnavailable):
        OllamaEmbedder("http://127.0.0.1:9", "m", 3, timeout=1).embed(["x"])


def test_ollama_posts_batches_to_api_embed(posts):
    posts.reply = lambda body: Reply({"embeddings": [[0.0, 0.0, 1.0]] * len(body["input"])})
    vectors = OllamaEmbedder("http://embed.example/", "m", 3, batch=2).embed(["a", "b", "c"])
    assert len(vectors) == 3
    assert [p["url"] for p in posts] == ["http://embed.example/api/embed"] * 2
    assert [p["json"]["input"] for p in posts] == [["a", "b"], ["c"]]
    assert posts[0]["json"]["model"] == "m" and posts[0]["headers"] == {}


def test_openai_compatible_sends_the_key_and_orders_by_index(posts):
    posts.reply = lambda body: Reply(
        {"data": [{"index": 1, "embedding": [2.0, 2.0, 2.0]}, {"index": 0, "embedding": [1.0, 1.0, 1.0]}]}
    )
    embedder = OpenAICompatibleEmbedder("https://api.example/v1", "m", 3, api_key="secret")
    assert embedder.embed(["first", "second"]) == [[1.0, 1.0, 1.0], [2.0, 2.0, 2.0]]
    assert posts[0]["url"] == "https://api.example/v1/embeddings"
    assert posts[0]["json"] == {"model": "m", "input": ["first", "second"]}
    assert posts[0]["headers"] == {"Authorization": "Bearer secret"}


def test_openai_compatible_without_a_key_sends_no_authorization(posts):
    posts.reply = lambda body: Reply({"data": [{"index": 0, "embedding": [1.0, 0.0, 0.0]}]})
    OpenAICompatibleEmbedder("https://api.example/v1", "m", 3).embed(["x"])
    assert posts[0]["headers"] == {}


@pytest.mark.parametrize(
    "reply",
    [
        Reply({}, status_code=503),
        Reply({"unexpected": True}),
        Reply(ValueError("not json")),
        Reply({"embeddings": [[1.0, 2.0]]}),
        Reply({"embeddings": []}),
    ],
    ids=["http-error", "wrong-shape", "not-json", "wrong-length", "wrong-count"],
)
def test_bad_replies_raise_embedder_unavailable(posts, reply):
    posts.reply = lambda body: reply
    with pytest.raises(EmbedderUnavailable):
        OllamaEmbedder("http://embed.example", "m", 3).embed(["x"])


def test_get_embedder_selects_the_provider_by_setting():
    assert isinstance(get_embedder(settings(embedder="fake")), FakeEmbedder)
    assert isinstance(get_embedder(settings(embedder="ollama")), OllamaEmbedder)
    hosted = get_embedder(settings(embedder="openai", embed_api_key="k"))
    assert isinstance(hosted, OpenAICompatibleEmbedder) and hosted.api_key == "k"
    assert hosted.url == "http://embed.example" and hosted.model == "m"


def test_get_embedder_uses_the_configured_dimensions_for_the_fake():
    assert len(get_embedder(settings(embedder="fake")).embed(["x"])[0]) == 3


def test_get_embedder_rejects_an_unknown_provider():
    with pytest.raises(ValueError, match="ollama, openai or fake"):
        get_embedder(settings(embedder="other"))
