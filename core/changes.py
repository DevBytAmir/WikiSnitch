"""Classify each state of a paragraph by what changed since the one before it."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from core.lineage import State
from core.numbers import diff_numbers
from core.thresholds import Thresholds
from core.vectors import cosine

# created: the first state. restored: the text returned to an earlier one. numbers: a number or year
# changed. meaning: the embedding moved by more than the meaning threshold. wording: anything else,
# including every undone edit.
ChangeType = Literal["created", "wording", "meaning", "numbers", "restored"]


@dataclass(frozen=True)
class Change:
    """What one state changed, with the cosine similarity to the previous live state."""

    type: ChangeType
    similarity_to_previous: float | None
    numbers_added: list[str]
    numbers_removed: list[str]


def describe_changes(
    states: Sequence[State], vectors: Mapping[bytes, Sequence[float]], th: Thresholds
) -> list[Change]:
    """One ``Change`` per state, in order. Undone states never count as the previous state.

    Numbers are checked before similarity because an embedding barely moves when a date changes.
    """
    changes: list[Change] = []
    live: list[State] = []
    for state in states:
        if state.undone:
            changes.append(Change("wording", None, [], []))
            continue
        if not live:
            changes.append(Change("created", None, [], []))
            live.append(state)
            continue
        previous = live[-1]
        a = vectors.get(previous.text_hash)
        b = vectors.get(state.text_hash)
        similarity = cosine(a, b) if a is not None and b is not None else None
        removed, added = diff_numbers(previous.numbers, state.numbers)
        if any(s.text_hash == state.text_hash for s in live):
            changes.append(Change("restored", similarity, [], []))
        elif removed or added:
            changes.append(Change("numbers", similarity, added, removed))
        elif similarity is not None and similarity < th.meaning_change:
            changes.append(Change("meaning", similarity, [], []))
        else:
            changes.append(Change("wording", similarity, [], []))
        live.append(state)
    return changes
