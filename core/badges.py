"""Trust badges and the metrics behind them, computed from a paragraph's history."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from core.changes import Change
from core.lineage import State
from core.vectors import cosine

# A paragraph is new for six months, and a change is recent for a year. Edits by named users that
# were undone count towards a dispute for two years.
NEW_AGE = timedelta(days=183)
RECENT_AGE = timedelta(days=365)
REVERT_AGE = timedelta(days=730)


@dataclass(frozen=True)
class Metrics:
    """Facts about a paragraph's history that the badge and the review queue are built on."""

    first_seen: datetime
    first_author: str | None
    last_substantive_change: datetime
    states: int
    substantive_changes: int
    undone_states: int
    named_reverts_24m: int
    citations: int
    citations_first_added: datetime | None
    total_drift: float | None


@dataclass(frozen=True)
class Badge:
    """A trust level, the text shown for it, and the reasons behind it."""

    level: Literal["stable", "changed_recently", "disputed", "new", "unknown"]
    label: str
    reasons: list[str]


def compute_metrics(
    states: Sequence[State],
    changes: Sequence[Change],
    vectors: Mapping[bytes, Sequence[float]],
    now: datetime,
) -> Metrics:
    """Summarise a paragraph's states. Undone states are counted but never as the live text.

    Raises ``ValueError`` if every state was undone.
    """
    live = [(s, c) for s, c in zip(states, changes) if not s.undone]
    if not live:
        raise ValueError("no non-undone state")
    first, current = live[0][0], live[-1][0]
    substantive = [s.start for s, c in live if c.type in ("meaning", "numbers", "created")]
    a = vectors.get(first.text_hash)
    b = vectors.get(current.text_hash)
    drift = 1 - cosine(a, b) if a is not None and b is not None else None
    cited = [s.start for s, _ in live if s.citations > 0]
    return Metrics(
        first_seen=first.start,
        first_author=first.user,
        last_substantive_change=max(substantive),
        states=len(states),
        substantive_changes=sum(1 for _, c in live if c.type in ("meaning", "numbers")),
        undone_states=sum(1 for s in states if s.undone),
        named_reverts_24m=sum(
            1 for s in states if s.undone and not s.anonymous and s.start >= now - REVERT_AGE
        ),
        citations=current.citations,
        citations_first_added=cited[0] if cited else None,
        total_drift=drift,
    )


def _latest(states: Sequence[State], changes: Sequence[Change], kinds: tuple[str, ...]):
    """The latest live state and change of one of the given kinds, or ``None``."""
    found = [(s, c) for s, c in zip(states, changes) if not s.undone and c.type in kinds]
    return found[-1] if found else None


def compute_badge(
    metrics: Metrics | None,
    changes: Sequence[Change],
    states: Sequence[State],
    now: datetime,
) -> Badge:
    """Pick the badge. Disputed beats new, new beats changed recently, which beats stable.

    Disputed means two or more edits by named users were undone in the last 24 months.
    """
    if metrics is None:
        return Badge("unknown", "No history available", [])

    recent = _latest(states, changes, ("meaning", "numbers"))
    recent_ok = recent is not None and recent[0].start >= now - RECENT_AGE
    if metrics.named_reverts_24m >= 2:
        level, label = "disputed", "Disputed"
    elif metrics.first_seen >= now - NEW_AGE:
        level, label = "new", f"New since {metrics.first_seen:%B %Y}"
    elif recent_ok:
        level, label = "changed_recently", f"Changed {recent[0].start:%B %Y}"
    else:
        level = "stable"
        label = f"Stable since {metrics.last_substantive_change:%Y}"

    reasons: list[str] = []
    if metrics.named_reverts_24m == 1:
        reasons.append("1 edit by a named user was undone in the last 24 months")
    elif metrics.named_reverts_24m:
        reasons.append(
            f"{metrics.named_reverts_24m} edits by named users were undone in the last 24 months"
        )
    numbers = _latest(states, changes, ("numbers",))
    if numbers:
        state, change = numbers
        parts = []
        if change.numbers_removed:
            parts.append("removed " + ", ".join(change.numbers_removed))
        if change.numbers_added:
            parts.append("added " + ", ".join(change.numbers_added))
        reasons.append(f"Numbers changed on {state.start:%Y-%m-%d}: " + ", ".join(parts))
    meaning = _latest(states, changes, ("meaning",))
    if meaning:
        reasons.append(f"Meaning changed on {meaning[0].start:%Y-%m-%d}")
    if level == "stable":
        reasons.append(f"No substantive change since {metrics.last_substantive_change:%Y-%m-%d}")
    n = metrics.citations
    reasons.append("No citations" if n == 0 else "1 citation" if n == 1 else f"{n} citations")
    return Badge(level, label, reasons)
