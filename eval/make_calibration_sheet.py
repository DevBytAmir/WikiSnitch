"""Make the sheet of paragraph pairs that a person labels to calibrate the thresholds.

For a sample of Finnish paragraphs of history articles it takes three English paragraphs of the same
topic: the closest, the third closest and a random one, so the sheet spans clear matches to clear
misses. The ``label`` column is left empty for the person to fill in with ``same``, ``related`` or
``different``.

    python -m eval.make_calibration_sheet [--out eval/calibration.tsv]
"""

from __future__ import annotations

import argparse
import csv
import random
from pathlib import Path

import numpy as np

from core.config import load_settings
from core.db import connect
from core.vectors import from_sql


def _normalise(matrix: list[list[float]]) -> np.ndarray:
    """Scale each row to unit length, so a dot product is a cosine similarity."""
    values = np.asarray(matrix, dtype=np.float64)
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return values / norms


def load_pairs_input(cur) -> tuple[list[dict], list[dict]]:
    """Finnish source paragraphs (current, from history articles) and English target paragraphs,
    each with its vector. Only current paragraphs are used, never an earlier state."""
    cur.execute(
        "SELECT DISTINCT p.lang, p.page_id, p.para_id, p.text, a.wikidata_id, "
        "VEC_ToText(v.embedding) AS embedding "
        "FROM paragraph p JOIN article a USING (lang, page_id) "
        "JOIN text_vector v USING (text_hash) "
        "WHERE p.lang = 'fi' AND a.wikidata_id IS NOT NULL "
        "AND EXISTS (SELECT 1 FROM article_history h WHERE h.page_id = p.page_id)"
    )
    sources = cur.fetchall()
    cur.execute(
        "SELECT a.lang, a.page_id, a.title, a.wikidata_id, p.para_id, p.text, "
        "VEC_ToText(v.embedding) AS embedding "
        "FROM article a JOIN paragraph p USING (lang, page_id) "
        "JOIN text_vector v USING (text_hash) "
        "WHERE a.lang = 'en'"
    )
    targets = cur.fetchall()
    return sources, targets


def make_sheet(output_path: Path, seed: int = 1, sample_size: int = 20) -> None:
    """Write a tab-separated sheet of ``3 * sample_size`` pairs. The seed makes it repeatable."""
    with connect(load_settings()) as con, con.cursor() as cur:
        sources, targets = load_pairs_input(cur)

    by_topic: dict[str, list[dict]] = {}
    for target in targets:
        if target["wikidata_id"]:
            by_topic.setdefault(target["wikidata_id"], []).append(target)
    rng = random.Random(seed)
    shuffled = sorted(sources, key=lambda s: (s["page_id"], s["para_id"]))
    rng.shuffle(shuffled)
    rows = []
    used = 0
    for source in shuffled:
        if used == sample_size:
            break
        candidates = by_topic.get(source["wikidata_id"], [])
        if len(candidates) < 3:
            continue
        used += 1
        source_vector = _normalise([from_sql(source["embedding"])])[0]
        target_matrix = _normalise([from_sql(target["embedding"]) for target in candidates])
        similarities = target_matrix @ source_vector
        ranked = sorted(zip(similarities.tolist(), candidates), key=lambda item: item[0], reverse=True)
        for similarity, target in (ranked[0], ranked[2], rng.choice(ranked)):
            rows.append(
                {
                    "fi_page_id": source["page_id"],
                    "fi_para_id": source["para_id"],
                    "lang": target["lang"],
                    "page_id": target["page_id"],
                    "para_id": target["para_id"],
                    "similarity": round(similarity, 3),
                    "fi_text": source["text"],
                    "other_text": target["text"],
                    "label": "",
                }
            )
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys() if rows else ["label"], delimiter="\t")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    """Command line: write the sheet to ``--out``."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("eval/calibration.tsv"))
    args = parser.parse_args()
    make_sheet(args.out)


if __name__ == "__main__":
    main()
