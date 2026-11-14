"""Routes for one paragraph: its history and its comparison with the other languages."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api.db import Db, get_db
from api.llm import Llm, get_llm
from api.models import CrossLangView, HistoryView
from api.params import parse_as_of, parse_lang
from api.services import crosslang, history
from core.config import load_settings

router = APIRouter()


def get_assess_llm() -> Llm | None:
    """The model that judges two passages, or ``None`` if none is configured (a test can replace it)."""
    return get_llm("assess", load_settings())


@router.get("/api/paragraphs/{lang}/{page_id}/{para_id}/history", response_model=HistoryView)
def paragraph_history(lang: str, page_id: int, para_id: int, db: Db = Depends(get_db)) -> HistoryView:
    """Every state of a paragraph with who changed it, what changed and how far the meaning moved."""
    parse_lang(lang)
    return history.paragraph_history(db, lang, page_id, para_id)


@router.get("/api/paragraphs/{lang}/{page_id}/{para_id}/crosslang", response_model=CrossLangView)
def paragraph_crosslang(
    lang: str, page_id: int, para_id: int, as_of: str | None = None,
    db: Db = Depends(get_db), llm: Llm | None = Depends(get_assess_llm),
) -> CrossLangView:
    """What the other languages say about this paragraph, as of now or an earlier date."""
    parse_lang(lang)
    return crosslang.crosslang(db, lang, page_id, para_id, parse_as_of(as_of), llm)
