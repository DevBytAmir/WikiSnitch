"""Precompute a trust badge and review reasons for every current paragraph with history.

The results go to ``paragraph_signal`` and feed the badges, the review queue and the
cross-language comparison. Paragraphs of the other languages that nothing in the Finnish
article comes close to are recorded in ``coverage_gap``. Recomputing is safe: each article's
rows are replaced.
"""

import json

import numpy as np

from core.badges import compute_badge, compute_metrics
from core.changes import describe_changes
from core.config import SNAPSHOT, load_settings
from core.db import connect, sql_ts
from core.numbers import diff_numbers
from core.rows import fetch_states
from core.thresholds import load_thresholds
from core.vectors import from_sql

# The two languages each Finnish paragraph is compared with.
LANGS = (("en", "English"), ("sv", "Swedish"))

# How much each reason adds to a paragraph's review priority, which runs from 0 to 1.
ATTENTION_CHANGED_RECENTLY = 0.4
ATTENTION_DISPUTED = 0.3
ATTENTION_UNSOURCED = 0.15
ATTENTION_DIFFERS = 0.15

SIGNAL_SQL = (
    "REPLACE INTO paragraph_signal (lang, page_id, para_id, first_seen, last_substantive_change, "
    "states, substantive_changes, undone_states, named_reverts_24m, total_drift, citations, "
    "citations_first_added, best_en, best_sv, numbers_differ_en, numbers_differ_sv, badge, "
    "badge_label, badge_reasons, review_reasons, attention) "
    "VALUES ('fi',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
)


def _ts(value):
    """A datetime as a SQL timestamp, or ``None``."""
    return sql_ts(value) if value is not None else None


def _normalised(vectors) -> np.ndarray:
    """Scale each vector to unit length, so a matrix product gives cosine similarities."""
    m = np.array(vectors, dtype=np.float64)
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return m / norms


def _vectors_for(cur, hashes) -> dict[bytes, list[float]]:
    """The stored vectors for these text hashes. Texts without a vector are left out."""
    hashes = list(hashes)
    if not hashes:
        return {}
    marks = ",".join(["%s"] * len(hashes))
    cur.execute(
        f"SELECT text_hash, VEC_ToText(embedding) v FROM text_vector WHERE text_hash IN ({marks})",
        hashes,
    )
    return {bytes(r["text_hash"]): from_sql(r["v"]) for r in cur.fetchall()}


def _counterpart(cur, lang, wikidata_id):
    """The article in another language on the same Wikidata item, with its paragraphs' numbers
    and a matrix of their unit vectors. ``None`` if there is no such article."""
    if not wikidata_id:
        return None
    cur.execute(
        "SELECT page_id FROM article WHERE lang = %s AND wikidata_id = %s ORDER BY page_id LIMIT 1",
        (lang, wikidata_id),
    )
    row = cur.fetchone()
    if row is None:
        return None
    page_id = row["page_id"]
    cur.execute(
        "SELECT p.para_id, p.numbers, VEC_ToText(v.embedding) v FROM paragraph p "
        "JOIN text_vector v ON v.text_hash = p.text_hash "
        "WHERE p.lang = %s AND p.page_id = %s ORDER BY p.para_id",
        (lang, page_id),
    )
    items = cur.fetchall()
    return {
        "page_id": page_id,
        "para_ids": [r["para_id"] for r in items],
        "numbers": [r["numbers"] or "" for r in items],
        "matrix": _normalised([from_sql(r["v"]) for r in items]) if items else None,
    }


def _latest_substantive(states, changes):
    """The latest live state whose change was in meaning or numbers, with its change."""
    found = [(s, c) for s, c in zip(states, changes) if not s.undone and c.type in ("meaning", "numbers")]
    return found[-1] if found else None


def _attention(level: str, citations: int, differs: bool) -> float:
    """Review priority from 0 to 1: changed or disputed, unsourced, or at odds with a counterpart."""
    score = (
        (ATTENTION_CHANGED_RECENTLY if level == "changed_recently" else 0.0)
        + (ATTENTION_DISPUTED if level == "disputed" else 0.0)
        + (ATTENTION_UNSOURCED if citations == 0 else 0.0)
        + (ATTENTION_DIFFERS if differs else 0.0)
    )
    return round(score, 2)


def _process_article(cur, page_id, wikidata_id, th):
    """Compute the signal rows and coverage gaps of one Finnish article.

    Returns ``None`` if it has no current paragraph, otherwise ``(rows, gaps)``. For each
    paragraph this finds its badge, the most similar paragraph in each other language, whether
    their numbers differ when the claims match, and the reasons to review it.
    """
    states = fetch_states(cur, "fi", page_id)
    current = sorted({s.para_id for s in states if s.end is None})
    if not current:
        return None
    vectors = _vectors_for(cur, {s.text_hash for s in states})
    counterparts = {lang: _counterpart(cur, lang, wikidata_id) for lang, _ in LANGS}

    cur_states = {s.para_id: s for s in states if s.end is None}
    fi_ids = [p for p in current if cur_states[p].text_hash in vectors]
    fi_matrix = _normalised([vectors[cur_states[p].text_hash] for p in fi_ids]) if fi_ids else None
    fi_index = {p: i for i, p in enumerate(fi_ids)}

    sims = {}
    gaps = []
    for lang, _ in LANGS:
        target = counterparts[lang]
        if target is None or target["matrix"] is None or fi_matrix is None:
            continue
        sims[lang] = fi_matrix @ target["matrix"].T
        nearest = sims[lang].max(axis=0)
        for j, value in enumerate(nearest):
            if value < th.related:
                gaps.append((page_id, lang, target["page_id"], target["para_ids"][j], float(value)))

    rows = []
    for para_id in current:
        own = [s for s in states if s.para_id == para_id]
        changes = describe_changes(own, vectors, th)
        try:
            metrics = compute_metrics(own, changes, vectors, SNAPSHOT)
        except ValueError:
            continue
        badge = compute_badge(metrics, changes, own, SNAPSHOT)
        fi_numbers = cur_states[para_id].numbers or ""

        best = {}
        differ = {}
        differs_detail = {}
        for lang, name in LANGS:
            best[lang] = differ[lang] = None
            if lang not in sims or para_id not in fi_index:
                continue
            row = sims[lang][fi_index[para_id]]
            j = int(row.argmax())
            best[lang] = float(row[j])
            if best[lang] < th.same_claim:
                continue
            here, there = diff_numbers(fi_numbers, counterparts[lang]["numbers"][j])
            differ[lang] = bool(here or there)
            if differ[lang]:
                differs_detail[lang] = (
                    f"Numbers differ from the {name} article: here {', '.join(here)}; "
                    f"there {', '.join(there)}"
                )

        reasons = []
        latest = _latest_substantive(own, changes)
        if badge.level == "changed_recently" and latest is not None:
            state, change = latest
            if change.type == "meaning":
                reasons.append(("meaning_changed_recently", f"Meaning changed on {state.start:%Y-%m-%d}"))
            else:
                parts = []
                if change.numbers_removed:
                    parts.append("removed " + ", ".join(change.numbers_removed))
                if change.numbers_added:
                    parts.append("added " + ", ".join(change.numbers_added))
                reasons.append((
                    "numbers_changed_recently",
                    f"Numbers changed on {state.start:%Y-%m-%d}: " + ", ".join(parts),
                ))
        if badge.level == "disputed":
            reasons.append((
                "disputed",
                f"{metrics.named_reverts_24m} edits by named users were undone in the last 24 months",
            ))
        if metrics.citations == 0:
            reasons.append(("unsourced", "No citations"))
        for lang, _ in LANGS:
            if differ[lang]:
                reasons.append((f"differs_from_{lang}", differs_detail[lang]))

        attention = _attention(
            badge.level, metrics.citations, bool(differ["en"] or differ["sv"])
        )
        rows.append((
            page_id, para_id, _ts(metrics.first_seen), _ts(metrics.last_substantive_change),
            metrics.states, metrics.substantive_changes, metrics.undone_states,
            metrics.named_reverts_24m, metrics.total_drift, metrics.citations,
            _ts(metrics.citations_first_added), best["en"], best["sv"],
            differ["en"], differ["sv"], badge.level, badge.label,
            json.dumps(badge.reasons),
            json.dumps([{"code": c, "detail": d} for c, d in reasons]),
            attention,
        ))
    return rows, gaps


def main(con=None) -> None:
    """Recompute the signals of every article that has history.

    Uses the given connection, or opens its own. Reads the thresholds file for the similarity
    cut-offs.
    """
    own = con is None
    if own:
        con = connect(load_settings())
    th = load_thresholds()
    try:
        with con.cursor() as cur:
            cur.execute("DELETE FROM coverage_gap")
            cur.execute("SELECT DISTINCT page_id FROM article_history ORDER BY page_id")
            page_ids = [r["page_id"] for r in cur.fetchall()]
            for page_id in page_ids:
                cur.execute(
                    "SELECT wikidata_id FROM article WHERE lang = 'fi' AND page_id = %s", (page_id,)
                )
                found = cur.fetchone()
                result = _process_article(cur, page_id, found["wikidata_id"] if found else None, th)
                cur.execute("DELETE FROM paragraph_signal WHERE lang = 'fi' AND page_id = %s", (page_id,))
                if result is None:
                    con.commit()
                    continue
                rows, gaps = result
                if rows:
                    cur.executemany(SIGNAL_SQL, rows)
                if gaps:
                    cur.executemany(
                        "REPLACE INTO coverage_gap (fi_page_id, lang, page_id, para_id, "
                        "nearest_similarity) VALUES (%s,%s,%s,%s,%s)",
                        gaps,
                    )
                con.commit()
        con.commit()
    finally:
        if own:
            con.close()


if __name__ == "__main__":
    main()
