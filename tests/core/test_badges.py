from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.badges import compute_badge, compute_metrics
from core.changes import describe_changes
from core.clean import text_hash
from core.config import SNAPSHOT
from core.embedder import FakeEmbedder
from core.lineage import State
from core.numbers import numbers_field
from core.thresholds import Thresholds, load_thresholds
from core.vectors import cosine

TH = Thresholds()
EMB = FakeEmbedder(dim=256)
BASE = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon"
WORDING = BASE.replace("pi", "piii")
OTHER = "one two three four five six seven eight nine ten lambda mu nu xi omicron pi rho sigma tau upsilon"


def d(y, m, dd):
    return datetime(y, m, dd, tzinfo=timezone.utc)


def st(text, start, *, undone=False, anonymous=False, citations=0, user="Aino", rev=1):
    return State(
        para_id=1, kind="paragraph", section=None, text=text, text_hash=text_hash(text),
        citations=citations, numbers=numbers_field(text), rev_id=rev, user=user,
        anonymous=anonymous, comment=None, undone=undone, start=start, end=None,
    )


def vecs(states):
    texts = sorted({s.text for s in states})
    return {text_hash(t): v for t, v in zip(texts, EMB.embed(texts))}


def run(states, vectors=None):
    vectors = vecs(states) if vectors is None else vectors
    changes = describe_changes(states, vectors, TH)
    return changes, vectors


def badge_for(states, now=SNAPSHOT):
    changes, vectors = run(states)
    return compute_badge(compute_metrics(states, changes, vectors, now), changes, states, now)


def test_created():
    states = [st(BASE, d(2010, 1, 1))]
    changes, _ = run(states)
    assert [c.type for c in changes] == ["created"]
    assert changes[0].similarity_to_previous is None
    assert changes[0].numbers_added == [] and changes[0].numbers_removed == []


def test_wording_change():
    states = [st(BASE, d(2010, 1, 1)), st(WORDING, d(2011, 1, 1))]
    changes, vectors = run(states)
    sim = cosine(vectors[states[0].text_hash], vectors[states[1].text_hash])
    assert sim > 0.90
    assert changes[1].type == "wording"
    assert changes[1].similarity_to_previous == sim


def test_numbers_change_wins_over_similarity():
    a = BASE + " 25 000"
    b = BASE + " 70 000"
    states = [st(a, d(2010, 1, 1)), st(b, d(2011, 1, 1))]
    changes, vectors = run(states)
    assert cosine(vectors[states[0].text_hash], vectors[states[1].text_hash]) > 0.90
    assert changes[1].type == "numbers"
    assert changes[1].numbers_removed == ["25000"]
    assert changes[1].numbers_added == ["70000"]


def test_meaning_change_below_threshold():
    states = [st(BASE, d(2010, 1, 1)), st(OTHER, d(2011, 1, 1))]
    changes, vectors = run(states)
    assert cosine(vectors[states[0].text_hash], vectors[states[1].text_hash]) < 0.90
    assert changes[1].type == "meaning"
    assert changes[1].numbers_added == [] and changes[1].numbers_removed == []


def test_restored_after_undone():
    states = [
        st(BASE, d(2010, 1, 1)),
        st(OTHER, d(2011, 1, 1), undone=True),
        st(BASE, d(2011, 1, 2)),
    ]
    changes, _ = run(states)
    assert [c.type for c in changes] == ["created", "wording", "restored"]
    assert changes[1].similarity_to_previous is None


def test_undone_state_not_counted():
    states = [
        st(BASE, d(2010, 1, 1)),
        st(OTHER, d(2011, 1, 1), undone=True, anonymous=True),
        st(WORDING, d(2012, 1, 1)),
    ]
    changes, vectors = run(states)
    metrics = compute_metrics(states, changes, vectors, SNAPSHOT)
    assert metrics.substantive_changes == 0
    assert metrics.undone_states == 1
    assert metrics.states == 3


def test_missing_vector_gives_none_and_wording():
    states = [st(BASE, d(2010, 1, 1)), st(OTHER, d(2011, 1, 1))]
    vectors = {states[0].text_hash: vecs(states)[states[0].text_hash]}
    changes, _ = run(states, vectors)
    assert changes[1].type == "wording"
    assert changes[1].similarity_to_previous is None


def disputed_states(anonymous):
    return [
        st(BASE, d(2010, 1, 1)),
        st(OTHER, d(2026, 3, 1), undone=True, anonymous=anonymous, user="Greta"),
        st(BASE + " x", d(2026, 3, 2)),
        st(OTHER, d(2026, 5, 1), undone=True, anonymous=anonymous, user="Greta"),
        st(BASE + " x", d(2026, 5, 2)),
    ]


def test_badge_disputed():
    badge = badge_for(disputed_states(False))
    assert badge.level == "disputed"
    assert badge.label == "Disputed"
    assert badge.reasons[0] == "2 edits by named users were undone in the last 24 months"
    assert badge.reasons[-1] == "No citations"


def test_badge_disputed_ignores_anonymous():
    assert badge_for(disputed_states(True)).level != "disputed"


def test_badge_new():
    badge = badge_for([st(BASE, d(2026, 8, 1), citations=1)])
    assert badge.level == "new"
    assert badge.label == "New since August 2026"
    assert badge.reasons[-1] == "1 citation"


def test_badge_changed_recently():
    states = [st(BASE, d(2010, 1, 1)), st(OTHER, d(2026, 4, 2), citations=3)]
    badge = badge_for(states)
    assert badge.level == "changed_recently"
    assert badge.label == "Changed April 2026"
    assert "Meaning changed on 2026-04-02" in badge.reasons
    assert badge.reasons[-1] == "3 citations"


def test_badge_stable():
    states = [
        st(BASE + " 25 000", d(2010, 1, 1)),
        st(BASE + " 70 000", d(2015, 6, 15)),
        st(BASE + " 70 000 more", d(2020, 1, 1)),
    ]
    badge = badge_for(states)
    assert badge.level == "stable"
    assert badge.label == "Stable since 2015"
    assert badge.reasons == [
        "Numbers changed on 2015-06-15: removed 25000, added 70000",
        "No substantive change since 2015-06-15",
        "No citations",
    ]


def test_badge_unknown():
    badge = compute_badge(None, [], [], SNAPSHOT)
    assert badge.level == "unknown"
    assert badge.label == "No history available"
    assert badge.reasons == []


def test_badge_order_disputed_beats_new():
    states = [
        st(BASE, d(2026, 8, 1)),
        st(OTHER, d(2026, 8, 10), undone=True, user="Greta"),
        st(BASE + " x", d(2026, 8, 11)),
        st(OTHER, d(2026, 9, 1), undone=True, user="Greta"),
        st(BASE + " x", d(2026, 9, 2)),
    ]
    assert d(2026, 8, 1) >= SNAPSHOT - timedelta(days=183)
    assert badge_for(states).level == "disputed"


def test_thresholds_default_when_file_missing(tmp_path: Path):
    assert load_thresholds(tmp_path / "missing.json") == Thresholds()
    assert load_thresholds().calibrated is False
