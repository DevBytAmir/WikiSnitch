import json

import pytest

from core.db import connect
from core.embedder import FakeEmbedder
from db.fixtures import data
from eval.benchmark import (
    Question,
    _groups,
    _markdown,
    _paragraph_rows,
    _percentile,
    _ranked_topics,
    _write_threshold,
)

SUMMARY = {"questions": 1, "hit@1": 1.0, "hit@5": 1.0, "hit@10": 1.0, "mrr": 1.0}
RESULTS = {m: {"all": SUMMARY} for m in ("article", "article, same articles", "paragraph")}


def test_ranked_topics_deduplicates_language_versions():
    rows = [
        {"lang": "fi", "page_id": 1, "wikidata_id": "Q1", "distance": 0.1},
        {"lang": "en", "page_id": 2, "wikidata_id": "Q1", "distance": 0.2},
        {"lang": "sv", "page_id": 3, "wikidata_id": "Q2", "distance": 0.3},
    ]
    assert [row["page_id"] for row in _ranked_topics(rows)] == [1, 3]


def test_groups_reports_topic_ranks():
    questions = [
        Question("en", "q1", "one", "en", "Q1", 1),
        Question("fi", "q2", "two", "fi", "Q2", 2),
    ]
    assert _groups([(questions[0], 1), (questions[1], 6)]) == {
        "all": {"questions": 2, "hit@1": 0.5, "hit@5": 0.5, "hit@10": 1.0, "mrr": 7 / 12},
        "en": {"questions": 1, "hit@1": 1.0, "hit@5": 1.0, "hit@10": 1.0, "mrr": 1.0},
        "fi": {"questions": 1, "hit@1": 0.0, "hit@5": 0.0, "hit@10": 1.0, "mrr": 1 / 6},
    }


def test_paragraph_search_finds_the_paragraph_whose_text_is_the_question():
    vector = FakeEmbedder().embed([data.P1B])[0]
    with connect() as con, con.cursor() as cur:
        rows = _paragraph_rows(cur, vector)
    assert (rows[0]["lang"], rows[0]["page_id"], rows[0]["para_id"]) == ("fi", 9001, 1)
    assert rows[0]["distance"] == pytest.approx(0, abs=1e-6)


def test_paragraph_search_returns_one_row_per_topic():
    vector = FakeEmbedder().embed([data.P1B])[0]
    with connect() as con, con.cursor() as cur:
        rows = _paragraph_rows(cur, vector)
    topics = [row["wikidata_id"] or (row["lang"], row["page_id"]) for row in rows]
    assert len(topics) == len(set(topics))


def test_percentile_interpolates_between_values():
    assert _percentile([0.9, 0.5, 0.7, 0.6, 0.8], 0.05) == pytest.approx(0.52)
    assert _percentile([0.4], 0.05) == 0.4


def test_percentile_of_nothing_is_an_error():
    with pytest.raises(ValueError, match="ask_min"):
        _percentile([], 0.05)


def test_write_threshold_changes_only_ask_min(tmp_path):
    path = tmp_path / "thresholds.json"
    path.write_text('{"same_claim": 0.66, "ask_min": 0.5}\n', encoding="utf-8")
    _write_threshold(path, 0.5491)
    assert json.loads(path.read_text(encoding="utf-8")) == {"same_claim": 0.66, "ask_min": 0.549}


def test_report_states_full_coverage_and_both_ask_min_values():
    report = _markdown(RESULTS, 0.549, 0.522, (29460, 29460), updated=False)
    assert "cover all 29,460 articles" in report and "same search" in report
    assert "is `0.549`" in report and "configured `ask_min` is `0.522` (left unchanged)" in report


def test_report_warns_when_coverage_is_partial():
    report = _markdown(RESULTS, 0.5, 0.5, (153, 29460), updated=True)
    assert "cover 153 of 29,460 articles" in report and "(updated to the measured value)" in report
