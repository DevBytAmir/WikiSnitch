"""``GET /api/health``: whether the service is up, what it can reach, and how much data it has."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api.db import Db, get_db
from core.config import SNAPSHOT, load_settings
from core.embedder import get_embedder

router = APIRouter()


def _count(db: Db, label: str, table: str) -> int:
    """Row count of a table. ``table`` is always a constant of this module, never user input."""
    row = db.one(label, f"SELECT COUNT(*) AS count FROM {table}")
    return int(row["count"]) if row else 0


@router.get("/api/health")
def health(db: Db = Depends(get_db)) -> dict:
    """Status, the data snapshot date, reachability of the embedder, whether an answer model
    is configured, row counts, and the SQL that produced them."""
    settings = load_settings()
    history = db.one(
        "history_articles",
        "SELECT COUNT(*) AS count FROM article_history",
    )
    states = db.one(
        "paragraph_states",
        "SELECT COUNT(*) AS count FROM paragraph FOR SYSTEM_TIME ALL",
    )
    return {
        "status": "ok",
        "snapshot": SNAPSHOT.isoformat().replace("+00:00", "Z"),
        "embedder": get_embedder(settings).reachable(),
        "answer_model": bool(settings.llm_ask_base_url),
        "counts": {
            "articles": _count(db, "articles", "article"),
            "history_articles": int(history["count"]) if history else 0,
            "paragraph_states": int(states["count"]) if states else 0,
            "vectors": _count(db, "vectors", "text_vector"),
        },
        "sql": db.statements,
    }
