"""A small rate limit kept in memory, so one visitor cannot run up the cost of the answer model.

Each visitor may make ``limit`` calls in any window of ``window_seconds``. A limit of 0 turns it
off. The counts live in this process only and are lost on a restart, which is fine for a safety
net. Behind a reverse proxy on the same machine the visitor is the address in
``X-Forwarded-For``; from anywhere else that header is ignored, because anyone could fake it.
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable

from fastapi import Request

_LOOPBACK = {"127.0.0.1", "::1"}


class RateLimiter:
    """Sliding window: at most ``limit`` calls per ``window_seconds`` for each key."""

    def __init__(
        self,
        limit: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 10_000,
    ) -> None:
        self.limit = limit
        self.window = window_seconds
        self._clock = clock
        self._max_keys = max_keys
        self._calls: dict[str, deque[float]] = {}

    def check(self, key: str) -> float:
        """Record a call and return 0.0, or return how many seconds to wait if over the limit.

        A refused call is not recorded, so waiting the returned time is always enough.
        """
        if self.limit <= 0:
            return 0.0
        now = self._clock()
        calls = self._calls.get(key)
        if calls is None:
            if len(self._calls) >= self._max_keys:
                self._forget_idle(now)
            calls = self._calls[key] = deque()
        while calls and now - calls[0] >= self.window:
            calls.popleft()
        if len(calls) >= self.limit:
            return self.window - (now - calls[0])
        calls.append(now)
        return 0.0

    def _forget_idle(self, now: float) -> None:
        """Drop every key whose calls have all expired. If none have, start over."""
        idle = [k for k, calls in self._calls.items() if not calls or now - calls[-1] >= self.window]
        for key in idle:
            del self._calls[key]
        if len(self._calls) >= self._max_keys:
            self._calls.clear()


def client_key(request: Request) -> str:
    """Who is calling: the proxied visitor's address, or the direct peer's address."""
    peer = request.client.host if request.client else "unknown"
    if peer in _LOOPBACK:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return peer
