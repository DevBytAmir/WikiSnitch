import pytest
from starlette.requests import Request

from api.app import app
from api.rate_limit import RateLimiter, client_key
from api.routes.ask import get_ask_limiter


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def request(peer: str, forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "headers": headers, "client": (peer, 5000)})


def test_calls_up_to_the_limit_are_allowed_and_the_next_is_refused():
    limiter = RateLimiter(3, 60, clock=Clock())
    assert [limiter.check("a") for _ in range(3)] == [0.0, 0.0, 0.0]
    assert limiter.check("a") == pytest.approx(60)


def test_the_wait_shrinks_as_time_passes_and_the_window_reopens():
    clock = Clock()
    limiter = RateLimiter(1, 60, clock=clock)
    limiter.check("a")
    clock.now += 45
    assert limiter.check("a") == pytest.approx(15)
    clock.now += 15
    assert limiter.check("a") == 0.0


def test_a_refused_call_does_not_extend_the_wait():
    clock = Clock()
    limiter = RateLimiter(1, 60, clock=clock)
    limiter.check("a")
    clock.now += 30
    limiter.check("a")
    clock.now += 30
    assert limiter.check("a") == 0.0


def test_visitors_are_counted_separately():
    limiter = RateLimiter(1, 60, clock=Clock())
    assert limiter.check("a") == 0.0
    assert limiter.check("b") == 0.0
    assert limiter.check("a") > 0


def test_a_limit_of_zero_turns_the_limit_off():
    limiter = RateLimiter(0, 60, clock=Clock())
    assert all(limiter.check("a") == 0.0 for _ in range(100))


def test_memory_stays_bounded_when_many_visitors_come():
    clock = Clock()
    limiter = RateLimiter(1, 60, clock=clock, max_keys=100)
    for n in range(250):
        limiter.check(f"visitor-{n}")
        clock.now += 1
    assert len(limiter._calls) <= 100


def test_the_forwarded_address_is_trusted_only_from_the_local_proxy():
    assert client_key(request("127.0.0.1", "203.0.113.9, 10.0.0.1")) == "203.0.113.9"
    assert client_key(request("::1", "203.0.113.9")) == "203.0.113.9"
    assert client_key(request("198.51.100.4", "203.0.113.9")) == "198.51.100.4"
    assert client_key(request("127.0.0.1")) == "127.0.0.1"


def test_ask_answers_429_with_the_standard_error_body_after_the_limit(client):
    limiter = RateLimiter(2, 60)
    app.dependency_overrides[get_ask_limiter] = lambda: limiter
    try:
        statuses = [client.post("/api/ask", json={"question": "Milloin talvisota alkoi?"}).status_code for _ in range(3)]
        refused = client.post("/api/ask", json={"question": "Milloin talvisota alkoi?"})
    finally:
        app.dependency_overrides.pop(get_ask_limiter, None)
    assert statuses == [200, 200, 429]
    assert refused.status_code == 429
    error = refused.json()["error"]
    assert error["code"] == "rate_limited" and "Try again in" in error["message"]


def test_other_endpoints_are_not_limited(client):
    limiter = RateLimiter(1, 60)
    app.dependency_overrides[get_ask_limiter] = lambda: limiter
    try:
        assert all(client.get("/api/health").status_code == 200 for _ in range(5))
    finally:
        app.dependency_overrides.pop(get_ask_limiter, None)
