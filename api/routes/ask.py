"""Route for asking a question."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api.db import Db, get_db
from api.errors import ApiError
from api.llm import Llm, get_llm
from api.models import AskRequest, AskView
from api.params import parse_as_of
from api.services import ask
from core.config import SNAPSHOT, load_settings
from core.embedder import Embedder, get_embedder

router = APIRouter()


def get_ask_llm() -> Llm | None:
    """The answer model for *Ask*, or ``None`` if none is configured (a test can replace this)."""
    return get_llm("ask", load_settings())


def get_question_embedder() -> Embedder:
    """The embedder for questions (a test can replace this)."""
    return get_embedder(load_settings())


@router.post("/api/ask", response_model=AskView)
def post_ask(
    body: AskRequest,
    db: Db = Depends(get_db),
    embedder: Embedder = Depends(get_question_embedder),
    llm: Llm | None = Depends(get_ask_llm),
) -> AskView:
    """Answer a question with cited passages, now or as of an earlier date (Finnish only)."""
    moment = parse_as_of(body.as_of)
    if moment < SNAPSHOT and body.lang not in (None, "fi"):
        raise ApiError(400, "bad_request", "Past answers are available for Finnish articles only.")
    return ask.ask(db, embedder, llm, body.question, body.lang, moment)
