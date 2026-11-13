"""Paragraph lineage: stable paragraph ids and their states across an article's versions.

A paragraph keeps its id through edits, so its whole history can be followed. Each distinct
wording of it is a state with a start and an end time.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from rapidfuzz.distance import Indel

from core.clean import Block, blocks, text_hash
from core.config import MIN_PARAGRAPH_CHARS
from core.numbers import numbers_field

# A rewritten paragraph stays the same paragraph while at least this share of its words survive.
# Below it, the text starts a new identity: better to split one claim than to merge two.
SIMILARITY_CUTOFF = 0.6
# An edit counts as undone when a later version restores an earlier text within these limits.
UNDO_MAX_VERSIONS = 30
UNDO_MAX_AGE = timedelta(days=7)
COMMENT_LIMIT = 500
# Versions that share a timestamp are moved apart by one microsecond to keep them ordered.
_TICK = timedelta(microseconds=1)


@dataclass(frozen=True)
class Version:
    """One saved version of an article, as the dataset provides it."""

    rev_id: int
    timestamp: datetime
    user: str | None
    anonymous: bool
    comment: str | None
    minor: bool
    sha1: str | None
    text: str


@dataclass(frozen=True)
class State:
    """One wording of one paragraph, from ``start`` until ``end`` (``None`` while current)."""

    para_id: int
    kind: str
    section: str | None
    text: str
    text_hash: bytes
    citations: int
    numbers: str
    rev_id: int
    user: str | None
    anonymous: bool
    comment: str | None
    undone: bool
    start: datetime
    end: datetime | None


@dataclass(frozen=True)
class OutlineItem:
    """One row of the reading order: a heading, or the id of a paragraph."""

    heading: str | None
    para_id: int | None


@dataclass(frozen=True)
class Lineage:
    """The result for one article: every state, the time of each version, which versions were
    undone, and the reading order of the latest version."""

    states: list[State]
    times: list[datetime]
    undone: list[bool]
    outline: list[OutlineItem]


def _sorted(versions: Sequence[Version]) -> list[Version]:
    """Versions in time order, ties broken by revision id."""
    return sorted(versions, key=lambda x: (x.timestamp, x.rev_id))


def mark_undone(versions: Sequence[Version]) -> list[bool]:
    """For each version in time order, whether a later version restored the text before it.

    Found by repeated content hashes (``sha1``): when a version repeats an earlier text, every
    version in between was undone, within ``UNDO_MAX_VERSIONS`` and ``UNDO_MAX_AGE``.
    """
    ordered = _sorted(versions)
    undone = [False] * len(ordered)
    last_seen: dict[str, int] = {}
    for j, ver in enumerate(ordered):
        sha1 = ver.sha1
        if j >= 2 and sha1 is not None and sha1 != ordered[j - 1].sha1:
            # sha1[j] differs from sha1[j-1], so the latest earlier occurrence lies below j-1.
            # The age runs from the first undone edit: a stable text months old is often
            # restored minutes after vandalism.
            i = last_seen.get(sha1)
            if (i is not None and j - i <= UNDO_MAX_VERSIONS
                    and ver.timestamp - ordered[i + 1].timestamp <= UNDO_MAX_AGE):
                for k in range(i + 1, j):
                    undone[k] = True
        if sha1 is not None:
            last_seen[sha1] = j
    return undone


def alive_at(states: Sequence[State], moment: datetime) -> list[State]:
    """The states that were current at ``moment``: started by then and not yet ended."""
    return [s for s in states if s.start <= moment and (s.end is None or moment < s.end)]


def _is_paragraph(block: Block) -> bool:
    """Headings and very short lines are not paragraphs."""
    return block.kind != "h" and len(block.text) >= MIN_PARAGRAPH_CHARS


def outline_for(blocks: Sequence[Block], alive: Sequence[tuple[int, bytes]]) -> list[OutlineItem]:
    """Reading order of a version: its headings and the ids of its current paragraphs."""
    by_hash: dict[bytes, list[int]] = {}
    for para_id, h in alive:
        by_hash.setdefault(h, []).append(para_id)
    for ids in by_hash.values():
        ids.sort(reverse=True)
    items = []
    for block in blocks:
        if block.kind == "h":
            items.append(OutlineItem(block.text, None))
        elif _is_paragraph(block):
            ids = by_hash.get(text_hash(block.text))
            if ids:
                items.append(OutlineItem(None, ids.pop()))
    return items


@dataclass
class _Open:
    """A state that has started and not yet ended, with its words for similarity matching."""

    state_index: int
    text_hash: bytes
    words: list[str]


def _match(
    candidates: list[tuple[Block, bytes]],
    alive: list[tuple[int, bytes]],
    open_states: dict[int, _Open],
    ever: dict[bytes, list[int]],
) -> list[int | None]:
    """Give each paragraph of a new version the id of the paragraph it continues, or ``None``.

    Three passes, each only using ids not yet taken: an identical text that is alive now; an
    identical text that existed before (a restored paragraph, preferring one still open);
    then the most similar remaining old paragraph, if at least ``SIMILARITY_CUTOFF`` of the
    words match, best score first and nearest position on a tie.
    """
    assigned: list[int | None] = [None] * len(candidates)
    taken: set[int] = set()

    alive_by_hash: dict[bytes, list[int]] = {}
    for para_id, h in alive:
        alive_by_hash.setdefault(h, []).append(para_id)
    for n, (_, h) in enumerate(candidates):
        for para_id in alive_by_hash.get(h, ()):
            if para_id not in taken:
                assigned[n] = para_id
                taken.add(para_id)
                break

    for n, (_, h) in enumerate(candidates):
        if assigned[n] is not None or h not in ever:
            continue
        fallback = None
        for para_id in ever[h]:
            if para_id in taken:
                continue
            if para_id in open_states:
                fallback = para_id
                break
            if fallback is None:
                fallback = para_id
        if fallback is not None:
            assigned[n] = fallback
            taken.add(fallback)

    new_left = [n for n in range(len(candidates)) if assigned[n] is None]
    old_left = [(pos, para_id) for pos, (para_id, _) in enumerate(alive) if para_id not in taken]
    if new_left and old_left:
        pairs = []
        for n in new_left:
            words = candidates[n][0].text.split()
            for pos, para_id in old_left:
                score = Indel.normalized_similarity(
                    words, open_states[para_id].words, score_cutoff=SIMILARITY_CUTOFF
                )
                if score >= SIMILARITY_CUTOFF:
                    pairs.append((-score, abs(n - pos), n, para_id))
        pairs.sort()
        for _, _, n, para_id in pairs:
            if assigned[n] is None and para_id not in taken:
                assigned[n] = para_id
                taken.add(para_id)
    return assigned


def build_lineage(versions: Sequence[Version]) -> Lineage:
    """Follow every paragraph through every version of an article.

    A paragraph that changes ends one state and starts the next, at the time of the version that
    changed it. A paragraph that disappears ends its state. One that matches nothing gets a new id.
    """
    ordered = _sorted(versions)
    if not ordered:
        return Lineage([], [], [], [])
    times = [ordered[0].timestamp]
    for ver in ordered[1:]:
        times.append(max(ver.timestamp, times[-1] + _TICK))
    undone = mark_undone(ordered)

    records: list[dict] = []
    open_states: dict[int, _Open] = {}
    alive: list[tuple[int, bytes]] = []
    ever: dict[bytes, list[int]] = {}
    next_id = 1
    last_blocks: list[Block] = []
    parsed: dict[str, list[Block]] = {}

    for k, ver in enumerate(ordered):
        moment = times[k]
        # Reverts repeat earlier texts exactly, and parsing dominates the cost.
        last_blocks = parsed.get(ver.text)
        if last_blocks is None:
            last_blocks = parsed[ver.text] = blocks(ver.text)
        section = None
        candidates: list[tuple[Block, bytes]] = []
        sections: list[str | None] = []
        for block in last_blocks:
            if block.kind == "h":
                section = block.text
            elif _is_paragraph(block):
                candidates.append((block, text_hash(block.text)))
                sections.append(section)

        assigned = _match(candidates, alive, open_states, ever)
        new_alive: list[tuple[int, bytes]] = []
        new_open: dict[int, _Open] = {}
        for n, (block, h) in enumerate(candidates):
            para_id = assigned[n]
            if para_id is None:
                para_id = next_id
                next_id += 1
            current = open_states.get(para_id)
            if current is not None and current.text_hash == h:
                new_open[para_id] = current
            else:
                if current is not None:
                    records[current.state_index]["end"] = moment
                records.append(dict(
                    para_id=para_id, kind=block.kind, section=sections[n], text=block.text,
                    text_hash=h, citations=block.citations, numbers=numbers_field(block.text),
                    rev_id=ver.rev_id, user=ver.user, anonymous=ver.anonymous,
                    comment=ver.comment[:COMMENT_LIMIT] if ver.comment is not None else None,
                    undone=undone[k], start=moment, end=None,
                ))
                new_open[para_id] = _Open(len(records) - 1, h, block.text.split())
                ids = ever.setdefault(h, [])
                if para_id in ids:
                    ids.remove(para_id)
                ids.insert(0, para_id)
            new_alive.append((para_id, h))
        for para_id, current in open_states.items():
            if para_id not in new_open:
                records[current.state_index]["end"] = moment
        open_states = new_open
        alive = new_alive

    states = sorted((State(**r) for r in records), key=lambda s: (s.para_id, s.start))
    return Lineage(states, times, undone, outline_for(last_blocks, alive))
