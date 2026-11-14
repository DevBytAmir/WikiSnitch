from datetime import datetime, timezone

import pytest

from core.db import connect
from core.embedder import FakeEmbedder
from core.vectors import cosine, from_sql
from db.fixtures import data
from pipeline.embed import embed_missing
from pipeline.load_articles import store_markdown_article

FRESH_DATE = datetime(2026, 1, 1, tzinfo=timezone.utc)
ONE = (
    "Kaupungin kirjasto avattiin uudelleen syksyllä, ja lukijat palasivat paikalle kiitollisina "
    "koko vuoden ajan."
)
TWO = (
    "Rantakadun kauppiaat kertoivat myynnin kasvaneen selvästi, kun uusi silta valmistui "
    "joulukuun alussa."
)
THREE = (
    "Kauppias avasi uuden myymälän vanhan kirkon viereen, ja asiakkaat saapuivat sinne jo "
    "ensimmäisenä päivänä."
)
FOUR = (
    "Koulun oppilaat istuttivat puita pihalle keväällä, ja opettajat kertoivat niiden kasvavan "
    "nopeasti tulevina vuosina."
)
FIVE = (
    "Tuulivoimalat nousivat saaren pohjoisrannalle viime talvena, ja paikalliset asukkaat "
    "seurasivat rakennustöitä innolla."
)
LONG = "Luettelo kohta yksi kaksi kolme neljä viisi. " * 1200


class ThreeValues:
    model = "broken"
    dimensions = 1024

    def embed(self, texts):
        return [[0.1, 0.2, 0.3] for _ in texts]


class TooFew:
    model = "broken"
    dimensions = 1024

    def embed(self, texts):
        return [[1.0] + [0.0] * 1023 for _ in texts[:-1]]


@pytest.fixture
def con():
    connection = connect()
    yield connection
    connection.close()


def _store_fresh(con, page_id, *paragraphs):
    text = "# Koe\n\n" + "\n\n".join(paragraphs)
    store_markdown_article(con, "fi", page_id, 1, text, FRESH_DATE)


def _one_hash(con, sql, args=()):
    with con.cursor() as cur:
        cur.execute(sql, args)
        row = cur.fetchone()
    assert row is not None
    return row["text_hash"]


def _vector_rows(con, text_hash):
    with con.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM text_vector WHERE text_hash=%s", (text_hash,))
        return cur.fetchone()["n"]


def test_rerun_embeds_nothing(con):
    assert embed_missing(con, FakeEmbedder()) == 0


def test_wrong_vector_length_writes_nothing(con):
    _store_fresh(con, 90502, THREE)
    try:
        fresh = _one_hash(
            con, "SELECT text_hash FROM paragraph WHERE lang='fi' AND page_id=90502 AND para_id=1"
        )
        with pytest.raises(ValueError):
            embed_missing(con, ThreeValues())
        con.rollback()
        assert _vector_rows(con, fresh) == 0
    finally:
        con.rollback()
        embed_missing(con, FakeEmbedder())


def test_fewer_vectors_than_texts_writes_nothing(con):
    _store_fresh(con, 90503, FOUR, FIVE)
    try:
        hashes = [
            _one_hash(
                con,
                "SELECT text_hash FROM paragraph WHERE lang='fi' AND page_id=90503 "
                "AND para_id=%s",
                (para_id,),
            )
            for para_id in (1, 2)
        ]
        with pytest.raises(ValueError):
            embed_missing(con, TooFew())
        con.rollback()
        assert [_vector_rows(con, h) for h in hashes] == [0, 0]
    finally:
        con.rollback()
        embed_missing(con, FakeEmbedder())


def test_very_long_text_is_embedded(con):
    _store_fresh(con, 90504, LONG)
    try:
        assert len(LONG) > 50_000
        assert embed_missing(con, FakeEmbedder()) == 1
        long_hash = _one_hash(
            con, "SELECT text_hash FROM paragraph WHERE lang='fi' AND page_id=90504 AND para_id=1"
        )
        with con.cursor() as cur:
            cur.execute(
                "SELECT VEC_ToText(embedding) AS e FROM text_vector WHERE text_hash=%s",
                (long_hash,),
            )
            row = cur.fetchone()
        assert row is not None
        assert len(from_sql(row["e"])) == 1024
    finally:
        embed_missing(con, FakeEmbedder())


def _current_vector(con, lang, page_id, para_id):
    with con.cursor() as cur:
        cur.execute(
            "SELECT VEC_ToText(v.embedding) AS e FROM paragraph p "
            "JOIN text_vector v ON v.text_hash = p.text_hash "
            "WHERE p.lang=%s AND p.page_id=%s AND p.para_id=%s",
            (lang, page_id, para_id),
        )
        row = cur.fetchone()
    assert row is not None
    return from_sql(row["e"])

def test_embeds_each_distinct_text_once(con):
    shared = _one_hash(
        con,
        "SELECT text_hash FROM paragraph WHERE lang='fi' AND page_id=9001 AND para_id=4",
    )
    assert shared == _one_hash(
        con,
        "SELECT text_hash FROM paragraph WHERE lang='fi' AND page_id=9001 AND para_id=7",
    )
    assert _vector_rows(con, shared) == 1

    _store_fresh(con, 90501, ONE, ONE)
    try:
        assert embed_missing(con, FakeEmbedder()) == 1
        fresh = _one_hash(
            con, "SELECT text_hash FROM paragraph WHERE lang='fi' AND page_id=90501 AND para_id=1"
        )
        assert _vector_rows(con, fresh) == 1
    finally:
        embed_missing(con, FakeEmbedder())


def test_undone_and_short_texts_not_embedded(con):
    junk = _one_hash(
        con,
        "SELECT text_hash FROM paragraph FOR SYSTEM_TIME ALL WHERE text=%s AND undone=1",
        (data.JUNK,),
    )
    short = _one_hash(
        con, "SELECT text_hash FROM paragraph WHERE lang='fi' AND page_id=9002 AND para_id=1"
    )
    assert _vector_rows(con, junk) == 0
    assert _vector_rows(con, short) == 0

def test_is_current_flag(con):
    p1a = _one_hash(
        con,
        "SELECT text_hash FROM paragraph FOR SYSTEM_TIME ALL WHERE text=%s",
        (data.P1A,),
    )
    p1b = _one_hash(
        con, "SELECT text_hash FROM paragraph WHERE lang='fi' AND page_id=9001 AND para_id=1"
    )
    with con.cursor() as cur:
        cur.execute("SELECT is_current FROM text_vector WHERE text_hash IN (%s, %s) "
                    "ORDER BY is_current", (p1a, p1b))
        flags = [bool(r["is_current"]) for r in cur.fetchall()]
    assert flags == [False, True]

def test_fixture_counterparts_are_similar(con):
    p1b = _current_vector(con, "fi", 9001, 1)
    p2c = _current_vector(con, "fi", 9001, 2)
    p3a = _current_vector(con, "fi", 9001, 4)
    e1 = _current_vector(con, "en", 8001, 1)
    e2 = _current_vector(con, "en", 8001, 2)
    s1 = _current_vector(con, "sv", 7001, 1)
    assert cosine(p1b, e1) >= 0.75
    assert cosine(p2c, s1) >= 0.75
    assert cosine(p3a, e1) < 0.60
    assert cosine(p3a, e2) < 0.60
