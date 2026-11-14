from datetime import datetime, timezone

import pytest

from core.db import connect
from core.embedder import FakeEmbedder
from core.vectors import from_sql
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
