"""Routes for the article list, the article reader, the edit timeline and the review queue."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api.db import Db, get_db
from api.errors import ApiError
from api.models import ArticleList, ArticleView, ReviewView, Timeline
from api.params import parse_as_of, parse_lang
from api.services import articles, review, timeline

router = APIRouter()


@router.get("/api/articles", response_model=ArticleList)
def list_articles(
    q: str = "", history_only: bool = False, limit: int = 50, db: Db = Depends(get_db)
) -> ArticleList:
    """Articles, history set first. ``q`` searches titles then text; ``limit`` is 1 to 200."""
    if not 1 <= limit <= 200:
        raise ApiError(400, "bad_request", "limit must be between 1 and 200.")
    return articles.list_articles(db, q, history_only, limit)


@router.get("/api/articles/{lang}/{page_id}", response_model=ArticleView)
def get_article(
    lang: str, page_id: int, as_of: str | None = None, db: Db = Depends(get_db)
) -> ArticleView:
    """One article. With ``as_of`` the text and badges are those of that moment."""
    parse_lang(lang)
    moment = parse_as_of(as_of)
    return articles.get_article(db, lang, page_id, moment)


@router.get("/api/articles/{lang}/{page_id}/timeline", response_model=Timeline)
def get_timeline(lang: str, page_id: int, db: Db = Depends(get_db)) -> Timeline:
    """Edits and reverts per month, for articles with edit history."""
    parse_lang(lang)
    return timeline.get_timeline(db, lang, page_id)


@router.get("/api/articles/{lang}/{page_id}/review", response_model=ReviewView)
def get_review(lang: str, page_id: int, db: Db = Depends(get_db)) -> ReviewView:
    """Paragraphs that need attention, most urgent first, and what the other languages have extra."""
    parse_lang(lang)
    return review.get_review(db, lang, page_id)
