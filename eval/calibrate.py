"""Calibrate the similarity thresholds from a hand-labelled sheet of paragraph pairs.

Each pair is labelled ``same`` (the same claim), ``related`` or ``different``. For each threshold the
cut-off that gives the best F1 score is chosen: ``same_claim`` separates ``same`` from the rest, and
``related`` separates ``same`` and ``related`` from ``different``. Other values in the thresholds
file, such as ``ask_min``, are kept.

    python -m eval.calibrate [--in eval/calibration.tsv] [--out eval/thresholds.json]
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict
from pathlib import Path

from core.thresholds import DEFAULT_PATH, Thresholds

LABELS = frozenset({"same", "related", "different"})
# Fewer labelled pairs than this would make the cut-offs depend on a handful of examples.
MIN_LABELS = 40


def _f1(rows: list[tuple[float, bool]], threshold: float) -> float:
    """F1 score of predicting "positive" when the similarity is at least ``threshold``."""
    true_positive = sum(score >= threshold and expected for score, expected in rows)
    false_positive = sum(score >= threshold and not expected for score, expected in rows)
    false_negative = sum(score < threshold and expected for score, expected in rows)
    if true_positive == 0:
        return 0.0
    return 2 * true_positive / (2 * true_positive + false_positive + false_negative)


def _best_threshold(rows: list[tuple[float, bool]]) -> float:
    """The similarity with the best F1 score. On a tie the higher one wins, the stricter cut-off."""
    candidates = sorted({score for score, _ in rows} | {0.0, 1.0}, reverse=True)
    scored = [(score, _f1(rows, score)) for score in candidates]
    return max(scored, key=lambda item: (item[1], item[0]))[0]


def read_labels(path: Path) -> list[dict[str, str]]:
    """Read the labelled rows of the sheet. Rows without a label are skipped.

    Raises ``ValueError`` for an unknown label or a missing or out-of-range similarity.
    """
    with Path(path).open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))
    labelled = []
    for row in rows:
        label = row.get("label", "").strip().lower()
        if not label:
            continue
        if label not in LABELS:
            raise ValueError(f"Unknown label {label!r}; expected same, related or different.")
        try:
            similarity = float(row["similarity"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("Every labelled row needs a numeric similarity.") from error
        if not 0 <= similarity <= 1:
            raise ValueError("Similarity must be between 0 and 1.")
        labelled.append({"label": label, "similarity": similarity})
    return labelled


def calibrate_rows(rows: list[dict[str, str | float]]) -> Thresholds:
    """Choose ``same_claim`` and ``related`` from labelled rows.

    Raises ``ValueError`` with fewer than ``MIN_LABELS`` rows, an unknown label, or when the two
    cut-offs come out inverted.
    """
    labelled = [{"label": str(row["label"]).strip().lower(), "similarity": float(row["similarity"])} for row in rows]
    if len(labelled) < MIN_LABELS:
        raise ValueError(f"At least {MIN_LABELS} labelled rows are required.")
    if any(row["label"] not in LABELS for row in labelled):
        raise ValueError("Labels must be same, related or different.")

    same_rows = [(row["similarity"], row["label"] == "same") for row in labelled]
    related_rows = [(row["similarity"], row["label"] in {"same", "related"}) for row in labelled]
    same_claim = _best_threshold(same_rows)
    related = _best_threshold(related_rows)
    if related > same_claim:
        raise ValueError("The related threshold cannot exceed same_claim.")
    return Thresholds(calibrated=True, same_claim=same_claim, related=related)


def calibrate_file(input_path: Path, output_path: Path = DEFAULT_PATH) -> Thresholds:
    """Calibrate from a sheet and write the result into the thresholds file, keeping its other keys."""
    thresholds = calibrate_rows(read_labels(input_path))
    output_path = Path(output_path)
    existing = {}
    if output_path.exists():
        existing = json.loads(output_path.read_text(encoding="utf-8"))
    existing.update(
        {
            "calibrated": thresholds.calibrated,
            "same_claim": thresholds.same_claim,
            "related": thresholds.related,
        }
    )
    output_path.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")
    return thresholds


def main() -> None:
    """Command line: calibrate from the sheet and print the thresholds as JSON."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="input_path", type=Path, default=Path("eval/calibration.tsv"))
    parser.add_argument("--out", dest="output_path", type=Path, default=DEFAULT_PATH)
    args = parser.parse_args()
    thresholds = calibrate_file(args.input_path, args.output_path)
    print(json.dumps(asdict(thresholds), sort_keys=True))


if __name__ == "__main__":
    main()
