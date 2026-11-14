import dataclasses
import hashlib
from datetime import datetime, timezone

import pytest

from core.db import connect
from core.lineage import Version, build_lineage
from pipeline import check_lineage
from pipeline.check_lineage import check_article
from pipeline.load_history import store_lineage

# 40-79 characters: lineage keeps them, embedding skips them, so other tests that count
# texts waiting for a vector are not affected by these articles.
P1 = "Talvisota alkoi kun joukot ylittivät rajan monessa kohdassa."
P2 = "Kaupungin vanha satama rakennettiin uudelleen sodan jälkeen."
P3 = "Rauhansopimus allekirjoitettiin Moskovassa maaliskuussa."


def v(rev, day, *paragraphs):
    text = "\n".join(paragraphs)
    sha1 = hashlib.md5(text.encode("utf-8")).hexdigest()[:31]
    stamp = datetime(2005, 3, day, 10, tzinfo=timezone.utc)
    return Version(rev, stamp, "A", False, None, False, sha1, text)


@pytest.fixture
def con():
    connection = connect()
    yield connection
    connection.close()


def test_fixture_history_rebuilds_every_version(con):
    with con.cursor() as cur:
        assert check_article(cur, 9001) == (16, 16, [])
        assert check_article(cur, 9002) == (1, 1, [])


def test_every_n_checks_every_nth_version(con):
    with con.cursor() as cur:
        assert check_article(cur, 9001, every=5) == (16, 4, [])


def test_missing_state_is_reported(con):
    versions = [v(1, 1, P1, P2), v(2, 2, P1, P2, P3), v(3, 3, P2, P3)]
    lineage = build_lineage(versions)
    broken = dataclasses.replace(lineage, states=[s for s in lineage.states if s.text != P3])
    store_lineage(con, 90601, "Rikki", versions, broken)
    with con.cursor() as cur:
        assert check_article(cur, 90601) == (3, 3, [2, 3])


def test_main_prints_one_line_per_article_and_exit_code(capsys):
    assert check_lineage.main(["--page", "9001"]) == 0
    out = capsys.readouterr().out.splitlines()
    assert out[0] == "9001 Testisota 16 0"
    assert out[-1] == "1 articles, 16 versions (16 checked), 0 mismatches"


def test_main_fails_on_mismatch_and_on_unknown_page(con):
    versions = [v(1, 1, P1), v(2, 2, P1, P3)]
    lineage = build_lineage(versions)
    broken = dataclasses.replace(lineage, states=[s for s in lineage.states if s.text != P3])
    store_lineage(con, 90602, "Rikki", versions, broken)
    assert check_lineage.main(["--page", "90602"]) == 1
    assert check_lineage.main(["--page", "90699"]) == 1
