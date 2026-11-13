import hashlib
import random
from datetime import datetime, timedelta, timezone

from core.clean import blocks
from core.lineage import Version, alive_at, build_lineage


def t(stamp: str) -> datetime:
    return datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def v(rev, ts, *paragraphs, user="A", anonymous=False, sha1=None):
    text = "\n".join(paragraphs)
    if sha1 is None:
        sha1 = hashlib.md5(text.encode("utf-8")).hexdigest()
    stamp = ts if isinstance(ts, datetime) else t(ts)
    return Version(rev, stamp, user, anonymous, None, False, sha1, text)


T1 = "2005-03-01 10:00:00"
T2 = "2005-03-02 12:00:00"
T3 = "2005-03-02 12:05:00"

P1 = "Talvisota alkoi marraskuun lopussa kun neuvostojoukot ylittivät rajan monessa kohdassa yhtä aikaa."
P2 = "Kaupungin vanha satama rakennettiin uudelleen sodan jälkeen ja kauppa kasvoi nopeasti koko rannikolla sekä saaristossa."
P2_EDITED = "Kaupungin vanha satama korjattiin uudelleen sodan jälkeen ja kauppa kasvoi hitaasti koko rannikolla sekä saaristossa."
P3 = "Järven rannalla kasvaa koivuja kuusia ja mäntyjä joiden alla marjat kypsyvät elokuussa runsaasti."
JUNK = "hahaha tämä on ihan pelkkää roskaa lol lol lol kukaan ei lue tätä sivua koskaan oikeasti"

LONG = (
    "Kirkon torni nousi korkealle kylän ylle ja sen kellot soivat joka sunnuntai aamulla "
    "kun ihmiset kulkivat pitkin kapeaa polkua kohti mäkeä jossa vanha hautausmaa lepäsi "
    "hiljaa tammien ja kuusien varjossa"
)
_LONG_WORDS = LONG.split()
LONG_FIRST_70_PERCENT = " ".join(_LONG_WORDS[: round(len(_LONG_WORDS) * 0.7)])
LONG_REST = " ".join(_LONG_WORDS[round(len(_LONG_WORDS) * 0.7):])

_SYLLABLES = ["ka", "lo", "mi", "su", "ta", "ve", "ri", "no", "pä", "hy", "jo", "ki", "le", "mö",
              "sa", "tu", "va", "ne", "rö", "li"]


def _word(rng: random.Random) -> str:
    return "".join(rng.choice(_SYLLABLES) for _ in range(rng.randint(2, 4)))


def _sentence(rng: random.Random) -> str:
    while True:
        s = " ".join(_word(rng) for _ in range(rng.randint(8, 14))).capitalize() + "."
        if len(s) >= 40:
            return s


def random_history(rng: random.Random, n_versions: int) -> list[Version]:
    pool = [_sentence(rng) for _ in range(40)]
    paras = rng.sample(pool, rng.randint(3, 8))
    texts = [list(paras)]
    stamp = t("2005-01-01 00:00:00")
    stamps = [stamp]
    for _ in range(n_versions - 1):
        cur = list(texts[-1])
        if rng.random() < 0.1:
            cur = list(rng.choice(texts))
        else:
            op = rng.choice(["insert", "delete", "edit", "move", "blank", "duplicate"])
            if op == "insert" or not cur:
                cur.insert(rng.randint(0, len(cur)), rng.choice(pool))
            elif op == "delete":
                cur.pop(rng.randrange(len(cur)))
            elif op == "edit":
                i = rng.randrange(len(cur))
                words = cur[i].split()
                words[rng.randrange(len(words))] = _word(rng)
                cur[i] = " ".join(words)
            elif op == "move":
                cur.insert(rng.randint(0, len(cur) - 1), cur.pop(rng.randrange(len(cur))))
            elif op == "blank":
                cur = []
            else:
                cur.insert(rng.randint(0, len(cur)), rng.choice(cur))
        stamp += rng.choice([timedelta(0), timedelta(seconds=1), timedelta(minutes=5),
                             timedelta(days=3), timedelta(days=30)])
        texts.append(cur)
        stamps.append(stamp)
    versions = [v(k + 1, s, *paras) for k, (s, paras) in enumerate(zip(stamps, texts))]
    rng.shuffle(versions)
    return versions


def test_unchanged_paragraph_is_one_state():
    L = build_lineage([v(1, T1, P1, P2), v(2, T2, P1, P2)])
    assert [(s.para_id, s.start, s.end) for s in L.states] == [(1, t(T1), None), (2, t(T1), None)]


def test_edit_keeps_id_and_closes_state():
    L = build_lineage([v(1, T1, P1, P2), v(2, T2, P1, P2_EDITED)])
    s = [x for x in L.states if x.para_id == 2]
    assert [(x.text, x.end) for x in s] == [(P2, t(T2)), (P2_EDITED, None)] and s[1].rev_id == 2


def test_insert_above_does_not_touch_others():
    L = build_lineage([v(1, T1, P1, P2), v(2, T2, P3, P1, P2)])
    assert sorted((s.para_id, s.text) for s in L.states) == [(1, P1), (2, P2), (3, P3)]
    assert [i.para_id for i in L.outline] == [3, 1, 2]


def test_delete_ends_state():
    L = build_lineage([v(1, T1, P1, P2), v(2, T2, P1)])
    assert [s.end for s in L.states if s.para_id == 2] == [t(T2)]


def test_vandalism_and_revert():
    L = build_lineage([v(1, T1, P1, P2), v(2, T2, P1, JUNK, anonymous=True), v(3, T3, P1, P2)])
    assert L.undone == [False, True, False]
    p2 = [s for s in L.states if s.para_id == 2]
    assert [(s.text, s.undone) for s in p2] == [(P2, False), (P2, False)]
    assert p2[0].end == t(T2) and p2[1].start == t(T3)
    junk = [s for s in L.states if s.text == JUNK]
    assert len(junk) == 1 and junk[0].undone and junk[0].para_id == 3 and junk[0].end == t(T3)


def test_blank_and_restore_keeps_ids():
    L = build_lineage([v(1, T1, P1, P2), v(2, T2), v(3, T3, P1, P2)])
    assert {s.para_id for s in L.states} == {1, 2} and len(L.states) == 4


def test_old_restore_outside_window_is_not_undone():
    L = build_lineage([v(1, "2005-01-01 00:00:00", P1), v(2, "2005-06-01 00:00:00", P1, P2),
                       v(3, "2006-01-01 00:00:00", P1)])
    assert L.undone == [False, False, False]


def test_duplicate_text_matched_in_order():
    L = build_lineage([v(1, T1, P1, P1), v(2, T2, P1, P1, P2)])
    assert [i.para_id for i in L.outline] == [1, 2, 3]
    assert len([s for s in L.states if s.text == P1]) == 2


def test_move_is_not_a_change():
    L = build_lineage([v(1, T1, P1, P2, P3), v(2, T2, P3, P1, P2)])
    assert len(L.states) == 3 and [i.para_id for i in L.outline] == [3, 1, 2]


def test_split_keeps_id_on_closer_half():
    L = build_lineage([v(1, T1, LONG), v(2, T2, LONG_FIRST_70_PERCENT, LONG_REST)])
    assert [s.text for s in L.states if s.para_id == 1] == [LONG, LONG_FIRST_70_PERCENT]


def test_same_second_versions_are_ordered():
    L = build_lineage([v(1, T1, P1), v(2, T1, P1, P2)])
    assert L.times[1] - L.times[0] == timedelta(microseconds=1)


def test_short_blocks_ignored_and_section_tracked():
    L = build_lineage([v(1, T1, "== Tausta ==", "lyhyt", P1)])
    assert [(s.text, s.section) for s in L.states] == [(P1, "Tausta")]


def test_empty_history():
    assert build_lineage([]).states == []


def test_reconstruction_property():
    """For random edit scripts, every version is rebuilt exactly from the states."""
    rng = random.Random(20261113)
    for _ in range(200):
        versions = random_history(rng, n_versions=25)
        L = build_lineage(versions)
        for k, ver in enumerate(sorted(versions, key=lambda x: (x.timestamp, x.rev_id))):
            want = sorted(b.text for b in blocks(ver.text) if b.kind != "h" and len(b.text) >= 40)
            assert sorted(s.text for s in alive_at(L.states, L.times[k])) == want
        for pid in {s.para_id for s in L.states}:
            spans = sorted((s.start, s.end or datetime.max.replace(tzinfo=timezone.utc))
                           for s in L.states if s.para_id == pid)
            assert all(a[1] <= b[0] for a, b in zip(spans, spans[1:]))


def test_quick_revert_to_an_old_text_is_undone():
    L = build_lineage([v(1, "2005-01-01 00:00:00", P1, P2),
                       v(2, "2007-01-10 09:00:00", P1, JUNK, anonymous=True),
                       v(3, "2007-01-10 09:05:00", P1, P2)])
    assert L.undone == [False, True, False]
