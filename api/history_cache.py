"""A small in-memory cache of one article's paragraph states and vectors.

Badges are computed from a paragraph's history. Loading that history takes a few queries, so
the last ``CACHE_SIZE`` articles are kept. The cache lives as long as the process and is not
invalidated when data changes: restart the API after reloading data.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np

from api import queries
from api.db import Db
from core.badges import Badge, compute_badge, compute_metrics
from core.changes import describe_changes
from core.lineage import State
from core.rows import state_from_row
from core.thresholds import Thresholds
from core.vectors import from_sql

CACHE_SIZE = 64


@dataclass(frozen=True)
class PageHistory:
    """The states of every paragraph of an article, by paragraph id, and its text vectors by hash."""

    states: dict[int, list[State]]
    vectors: dict[bytes, list[float]]


_cache: dict[int, PageHistory] = {}


def clear_cache() -> None:
    """Forget every cached article (used by tests)."""
    _cache.clear()


def load_page_history(db: Db, page_id: int) -> PageHistory:
    """The history of an article, from the cache or the database. The oldest entry makes room."""
    cached = _cache.get(page_id)
    if cached is not None:
        return cached

    rows = db.query("Paragraph states of the article", queries.PAGE_STATES, (page_id,))
    states: dict[int, list[State]] = {}
    for row in rows:
        state = state_from_row(row)
        states.setdefault(state.para_id, []).append(state)

    hashes = sorted({s.text_hash for items in states.values() for s in items})
    vectors: dict[bytes, list[float]] = {}
    if hashes:
        statement = queries.VECTORS_BY_HASH.format(marks=queries.marks(len(hashes)))
        for row in db.query("Stored vectors of those texts", statement, hashes):
            vectors[bytes(row["text_hash"])] = np.asarray(from_sql(row["v"]), dtype=np.float64)

    history = PageHistory(states, vectors)
    if len(_cache) >= CACHE_SIZE:
        _cache.pop(next(iter(_cache)))
    _cache[page_id] = history
    return history


def badge_at(history: PageHistory, para_id: int, moment: datetime, th: Thresholds) -> Badge:
    """The badge a paragraph had at ``moment``, using only the states that existed by then."""
    states = [s for s in history.states.get(para_id, []) if s.start <= moment]
    if not states or all(s.undone for s in states):
        return Badge("unknown", "No history available", [])
    changes = describe_changes(states, history.vectors, th)
    metrics = compute_metrics(states, changes, history.vectors, moment)
    return compute_badge(metrics, changes, states, moment)
