from pathlib import Path

import pytest

from eval.calibrate import calibrate_file, calibrate_rows


def rows(labels: list[tuple[float, str]]) -> list[dict[str, str | float]]:
    return [{"similarity": similarity, "label": label} for similarity, label in labels]


def test_thresholds_separate_a_separable_sheet(tmp_path: Path):
    data = [(0.92, "same")] * 15 + [(0.81, "related")] * 15 + [(0.22, "different")] * 15
    thresholds = calibrate_rows(rows(data))
    assert thresholds.calibrated is True
    assert thresholds.related <= thresholds.same_claim
    assert thresholds.same_claim >= 0.81
    assert thresholds.related >= 0.22


def test_refuses_under_40_labels():
    with pytest.raises(ValueError, match="40"):
        calibrate_rows(rows([(0.8, "same")] * 39))


def test_refuses_inverted_thresholds(monkeypatch):
    values = iter([0.8, 0.9])
    monkeypatch.setattr("eval.calibrate._best_threshold", lambda rows: next(values))
    data = [(0.92, "same")] * 20 + [(0.5, "different")] * 20
    with pytest.raises(ValueError, match="exceed"):
        calibrate_rows(rows(data))


def test_calibrate_file_preserves_other_thresholds(tmp_path: Path):
    input_path = tmp_path / "calibration.tsv"
    output_path = tmp_path / "thresholds.json"
    input_path.write_text(
        "similarity\tlabel\n" + "\n".join(["0.9\tsame"] * 20 + ["0.2\tdifferent"] * 20) + "\n",
        encoding="utf-8",
    )
    output_path.write_text('{"ask_min": 0.37, "meaning_change": 0.88}\n', encoding="utf-8")
    calibrate_file(input_path, output_path)
    output = output_path.read_text(encoding="utf-8")
    assert '"ask_min": 0.37' in output
    assert '"meaning_change": 0.88' in output


def test_sheet_queries_return_current_paragraphs():
    from core.db import connect
    from eval.make_calibration_sheet import load_pairs_input

    with connect() as con, con.cursor() as cur:
        sources, targets = load_pairs_input(cur)
    assert {(s["page_id"], s["para_id"]) for s in sources} >= {(9001, 1), (9001, 2)}
    assert {(t["page_id"], t["para_id"]) for t in targets} >= {(8001, 1), (8001, 2)}
