"""Routes for one paragraph: its history."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api.db import Db, get_db
from api.models import HistoryView
from api.params import parse_lang
from api.services import history

router = APIRouter()


@router.get("/api/paragraphs/{lang}/{page_id}/{para_id}/history", response_model=HistoryView)
def paragraph_history(lang: str, page_id: int, para_id: int, db: Db = Depends(get_db)) -> HistoryView:
    """Every state of a paragraph with who changed it, what changed and how far the meaning moved."""
    parse_lang(lang)
    return history.paragraph_history(db, lang, page_id, para_id)
