import hashlib
import json
from datetime import datetime, timezone

import pytest

from core.db import connect
from core.lineage import Version, build_lineage
from pipeline import signals
from pipeline.load_history import store_lineage


@pytest.fixture
def con():
    connection = connect()
    yield connection
    connection.close()


def rows(con, page_id=9001):
    with con.cursor() as cur:
        cur.execute(
            "SELECT * FROM paragraph_signal WHERE lang='fi' AND page_id=%s ORDER BY para_id",
            (page_id,),
        )
        return {r["para_id"]: r for r in cur.fetchall()}


def codes(row):
    return [r["code"] for r in json.loads(row["review_reasons"])]


def test_badges_match_fixture_table(con):
    expected = {
        1: ("stable", "Stable since 2015"),
        2: ("changed_recently", "Changed April 2026"),
        4: ("stable", "Stable since 2008"),
        5: ("disputed", "Disputed"),
        6: ("new", "New since August 2026"),
        7: ("new", "New since August 2026"),
    }
    got = rows(con)
    assert set(got) == set(expected)
    for para_id, (level, label) in expected.items():
        assert (got[para_id]["badge"], got[para_id]["badge_label"]) == (level, label)
        assert isinstance(json.loads(got[para_id]["badge_reasons"]), list)


def test_best_en_for_paragraph_1_is_high_and_numbers_differ(con):
    row = rows(con)[1]
    assert row["best_en"] >= 0.75
    assert row["numbers_differ_en"] == 1
    detail = [r for r in json.loads(row["review_reasons"]) if r["code"] == "differs_from_en"][0]
    assert detail["detail"] == (
        "Numbers differ from the English article: here 70000; there 25000"
    )


def test_paragraph_without_counterpart_match_has_null_numbers_differ(con):
    row = rows(con)[4]
    assert row["best_en"] is not None and row["best_en"] < 0.60
    assert row["numbers_differ_en"] is None
    assert row["best_sv"] is not None and row["numbers_differ_sv"] is None


def test_attention_values(con):
    got = rows(con)
    expected = {2: 0.55, 5: 0.45, 1: 0.30, 6: 0.15, 4: 0.0, 7: 0.0}
    for para_id, value in expected.items():
        assert got[para_id]["attention"] == pytest.approx(value, abs=1e-6)


def test_review_reason_codes(con):
    got = rows(con)
    assert codes(got[5]) == ["disputed", "unsourced"]
    assert codes(got[1]) == ["unsourced", "differs_from_en"]
    assert codes(got[2]) == ["meaning_changed_recently", "unsourced"]
    assert codes(got[4]) == []


def test_article_without_current_paragraphs_is_skipped(con):
    para = "Kaupungin vanha satama rakennettiin uudelleen sodan jälkeen ja kauppa kasvoi nopeasti."
    stamps = [datetime(2020, 1, 1, tzinfo=timezone.utc), datetime(2020, 1, 2, tzinfo=timezone.utc)]
    versions = [
        Version(1, stamps[0], "A", False, None, False, hashlib.md5(para.encode()).hexdigest()[:31], para),
        Version(2, stamps[1], "A", False, None, False, "0" * 31, ""),
    ]
    store_lineage(con, 90500, "Tyhjä", versions, build_lineage(versions))
    signals.main(con)
    assert rows(con, 90500) == {}


def test_rerun_is_idempotent(con):
    def snapshot():
        with con.cursor() as cur:
            cur.execute("SELECT * FROM paragraph_signal ORDER BY lang, page_id, para_id")
            signal = cur.fetchall()
            cur.execute("SELECT * FROM coverage_gap ORDER BY fi_page_id, lang, page_id, para_id")
            return signal, cur.fetchall()

    signals.main(con)
    first = snapshot()
    signals.main(con)
    assert snapshot() == first


def test_coverage_gap_lists_english_paragraph_2(con):
    signals.main(con)
    with con.cursor() as cur:
        cur.execute(
            "SELECT page_id, para_id, nearest_similarity FROM coverage_gap "
            "WHERE fi_page_id=9001 AND lang='en'"
        )
        got = {(r["page_id"], r["para_id"]): r["nearest_similarity"] for r in cur.fetchall()}
    assert (8001, 2) in got and got[(8001, 2)] < 0.60
    assert (8001, 1) not in got
