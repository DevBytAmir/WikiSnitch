"""The history of one paragraph: every state, what changed and the metrics."""

from __future__ import annotations

from api import queries
from api.db import Db
from api.diff import word_diff
from api.errors import ApiError
from api.history_cache import badge_at, load_page_history
from api.models import (
    Badge,
    DiffOp,
    HistoryMetrics,
    HistoryState,
    HistoryView,
    ParagraphSummary,
    StateChange,
)
from api.services.articles import UNKNOWN, wikipedia_url
from core.badges import compute_metrics
from core.changes import describe_changes
from core.config import SNAPSHOT
from core.thresholds import load_thresholds


def _round(value: float | None) -> float | None:
    """Round to three decimals for the response, keeping ``None``."""
    return None if value is None else round(value, 3)


def _diffs(states, changes) -> list[list[dict]]:
    """The word diff of each state against the last live state before it.

    The first state has none. An undone state is compared with the state just before it, so the
    vandalism is visible, but it never becomes the base for the next comparison.
    """
    result: list[list[dict]] = []
    live = None
    for index, (state, change) in enumerate(zip(states, changes)):
        if change.type == "created":
            result.append([])
        elif state.undone:
            result.append(word_diff(states[index - 1].text, state.text) if index else [])
        else:
            result.append(word_diff(live.text, state.text))
        if not state.undone:
            live = state
    return result


def _metrics(states, changes, vectors) -> HistoryMetrics:
    """The summary numbers, with plain values when every state was undone."""
    undone = sum(1 for s in states if s.undone)
    try:
        m = compute_metrics(states, changes, vectors, SNAPSHOT)
    except ValueError:
        return HistoryMetrics(
            first_seen=states[0].start,
            first_author=states[0].user,
            last_substantive_change=states[0].start,
            states=len(states),
            substantive_changes=0,
            reverted_states=undone,
            citations_first_added=None,
            total_drift=None,
        )
    return HistoryMetrics(
        first_seen=m.first_seen,
        first_author=m.first_author,
        last_substantive_change=m.last_substantive_change,
        states=m.states,
        substantive_changes=m.substantive_changes,
        reverted_states=m.undone_states,
        citations_first_added=m.citations_first_added,
        total_drift=_round(m.total_drift),
    )


def paragraph_history(db: Db, lang: str, page_id: int, para_id: int) -> HistoryView:
    """The full history of a paragraph, oldest state first, with the current badge.

    Raises 404 for an unknown article or paragraph, and 409 for an article without edit history.
    """
    if db.one("The article", queries.ARTICLE, (lang, page_id)) is None:
        raise ApiError(404, "not_found", f"No article {lang}/{page_id}.")
    has_history = lang == "fi" and db.one(
        "Has history", queries.CURRENT_VERSION, (page_id,)
    ) is not None
    history = load_page_history(db, page_id) if has_history else None
    if history is None or not history.states:
        raise ApiError(409, "no_history", "This article was loaded without edit history.")
    states = history.states.get(para_id)
    if not states:
        raise ApiError(404, "not_found", f"No paragraph {para_id} in {lang}/{page_id}.")

    th = load_thresholds()
    changes = describe_changes(states, history.vectors, th)
    diffs = _diffs(states, changes)

    items = [
        HistoryState(
            rev_id=s.rev_id,
            **{"from": s.start},
            to=s.end,
            user=s.user,
            anonymous=s.anonymous,
            comment=s.comment,
            text=s.text,
            citations=s.citations,
            reverted=s.undone,
            change=StateChange(
                type=c.type,
                similarity_to_previous=_round(c.similarity_to_previous),
                numbers_added=list(c.numbers_added),
                numbers_removed=list(c.numbers_removed),
                diff=[DiffOp(**op) for op in d],
            ),
            wikipedia_url=wikipedia_url("fi", s.rev_id),
        )
        for s, c, d in zip(states, changes, diffs)
    ]

    live = [s for s in states if not s.undone]
    latest = live[-1] if live else states[-1]
    if live and states[-1].end is None:
        value = badge_at(history, para_id, SNAPSHOT, th)
        badge = Badge(level=value.level, label=value.label, reasons=list(value.reasons))
    else:
        badge = UNKNOWN
    summary = ParagraphSummary(
        para_id=para_id,
        section=latest.section,
        text=latest.text,
        kind=latest.kind,
        citations=latest.citations,
        has_history=True,
        badge=badge,
    )
    return HistoryView(
        paragraph=summary,
        metrics=_metrics(states, changes, history.vectors),
        states=items,
        sql=db.statements,
    )
