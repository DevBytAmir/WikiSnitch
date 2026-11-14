"""The article list and the article view, now or as of an earlier moment."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from api import queries
from api.db import Db
from api.errors import ApiError
from api.history_cache import PageHistory, badge_at, load_page_history
from api.models import (
    ArticleHeader,
    ArticleList,
    ArticleListItem,
    ArticleView,
    Badge,
    HeadingBlock,
    LanguageLink,
    ParagraphBlock,
    ParagraphSummary,
)
from core.clean import blocks, text_hash
from core.config import SNAPSHOT
from core.db import sql_ts, utc
from core.lineage import outline_for
from core.thresholds import Thresholds, load_thresholds

FALLBACK_SAVED = datetime(2025, 8, 1, tzinfo=timezone.utc)
UNKNOWN = Badge(level="unknown", label="No history available", reasons=[])


def wikipedia_url(lang: str, rev_id: int | None) -> str:
    """Link to the exact revision of the article that the text came from (for credit)."""
    return f"https://{lang}.wikipedia.org/?oldid={rev_id}"


def as_badge(value) -> Badge:
    """A badge computed by ``core.badges`` as the response model."""
    return Badge(level=value.level, label=value.label, reasons=list(value.reasons))


def _languages(db: Db, rows: list[dict]) -> dict[str, list[LanguageLink]]:
    """For each article, the same topic in the other languages, found by Wikidata item."""
    ids = sorted({r["wikidata_id"] for r in rows if r["wikidata_id"]})
    links: dict[str, list[dict]] = {}
    if ids:
        statement = queries.LANGUAGES_BY_WIKIDATA.format(marks=queries.marks(len(ids)))
        for row in db.query("Same topic in other languages", statement, ids):
            links.setdefault(row["wikidata_id"], []).append(row)
    result: dict[str, list[LanguageLink]] = {}
    for row in rows:
        key = f'{row["lang"]}/{row["page_id"]}'
        result[key] = [
            LanguageLink(lang=o["lang"], page_id=o["page_id"], title=o["title"])
            for o in links.get(row["wikidata_id"], [])
            if o["lang"] != row["lang"]
        ]
    return result


def _escape_like(value: str) -> str:
    """Escape ``\\``, ``%`` and ``_`` so a search text is matched literally by ``LIKE``."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_articles(db: Db, q: str, history_only: bool, limit: int) -> ArticleList:
    """Articles with history first. A search shows title prefixes first, then full-text matches."""
    only = 1 if history_only else 0
    q = q.strip()
    if not q:
        rows = db.query("Articles, history first", queries.LIST_ARTICLES, (only, limit))
    else:
        rows = db.query(
            "Titles starting with the search text",
            queries.SEARCH_PREFIX,
            (_escape_like(q), only, limit),
        )
        if len(rows) < limit:
            seen = {(r["lang"], r["page_id"]) for r in rows}
            found = db.query(
                "Titles and text matching the search text",
                queries.SEARCH_FULLTEXT,
                (q, only, q, limit),
            )
            rows += [r for r in found if (r["lang"], r["page_id"]) not in seen]
            rows = rows[:limit]

    versions: dict[int, int] = {}
    history_ids = sorted({r["page_id"] for r in rows if r["lang"] == "fi" and r["has_history"]})
    if history_ids:
        statement = queries.VERSIONS_BY_PAGE.format(marks=queries.marks(len(history_ids)))
        for row in db.query("Versions per article", statement, history_ids):
            versions[row["page_id"]] = int(row["versions"])
    languages = _languages(db, rows)

    articles = []
    for row in rows:
        has_history = bool(row["has_history"])
        articles.append(
            ArticleListItem(
                lang=row["lang"],
                page_id=row["page_id"],
                title=row["title"],
                wikidata_id=row["wikidata_id"],
                has_history=has_history,
                versions=versions.get(row["page_id"]) if has_history else None,
                languages=languages[f'{row["lang"]}/{row["page_id"]}'],
            )
        )
    return ArticleList(articles=articles, sql=db.statements)


def require_history(db: Db, lang: str, page_id: int) -> dict:
    """The article's header row, for endpoints that only make sense with edit history.

    Raises 404 for an unknown article and 409 for one that was loaded without edit history, which
    is every article that is not Finnish and every Finnish one outside the history set.
    """
    header = db.one("The article", queries.ARTICLE, (lang, page_id))
    if header is None:
        raise ApiError(404, "not_found", f"No article {lang}/{page_id}.")
    if lang != "fi" or db.one("Has history", queries.CURRENT_VERSION, (page_id,)) is None:
        raise ApiError(409, "no_history", "This article was loaded without edit history.")
    return header


def signal_badge(row: dict) -> Badge | None:
    """The precomputed badge of an outline row, or ``None`` if the paragraph has none."""
    if row["badge"] is None:
        return None
    reasons = row["badge_reasons"]
    if isinstance(reasons, (str, bytes)):
        reasons = json.loads(reasons)
    return Badge(level=row["badge"], label=row["badge_label"], reasons=list(reasons or []))


def _current_history_view(
    db: Db, lang: str, page_id: int, header: dict, languages: list[LanguageLink]
) -> ArticleView:
    version = db.one("Current version", queries.CURRENT_VERSION, (page_id,))
    span = db.one("Version span", queries.VERSION_SPAN, (page_id,))
    rows = db.query("Reading order and paragraphs", queries.OUTLINE, (lang, page_id))

    history: PageHistory | None = None
    th: Thresholds | None = None
    items: list[HeadingBlock | ParagraphBlock] = []
    for row in rows:
        if row["heading"] is not None:
            items.append(HeadingBlock(text=row["heading"]))
            continue
        if row["text"] is None:
            continue
        badge = signal_badge(row)
        if badge is None:
            if history is None:
                history = load_page_history(db, page_id)
                th = load_thresholds()
            badge = as_badge(badge_at(history, row["para_id"], SNAPSHOT, th))
        items.append(
            ParagraphBlock(
                paragraph=ParagraphSummary(
                    para_id=row["para_id"],
                    section=row["section"],
                    text=row["text"],
                    kind=row["kind"],
                    citations=None if row["citations"] is None else int(row["citations"]),
                    has_history=True,
                    badge=badge,
                )
            )
        )

    rev_id = version["rev_id"] if version else header["rev_id"]
    first = span["first_version"] if span else None
    article = ArticleHeader(
        lang=lang,
        page_id=page_id,
        title=header["title"],
        wikidata_id=header["wikidata_id"],
        rev_id=rev_id,
        as_of=SNAPSHOT,
        saved_at=utc(version["saved_at"]) if version else None,
        saved_by=version["user"] if version else None,
        wikipedia_url=wikipedia_url(lang, rev_id),
        has_history=True,
        first_version=utc(first) if first else None,
        languages=languages,
    )
    return ArticleView(article=article, blocks=items, sql=db.statements)


def _past_view(
    db: Db, page_id: int, header: dict, languages: list[LanguageLink], moment: datetime
) -> ArticleView:
    version = db.one("Version of the article at that moment", queries.VERSION_AS_OF,
                     (sql_ts(moment), page_id))
    if version is None:
        raise ApiError(
            404, "not_yet_created",
            f"This article did not exist yet on {moment:%Y-%m-%d}.",
        )
    parsed = blocks(version["text"])
    rows = db.query("Paragraphs at that moment", queries.PARAGRAPHS_AS_OF,
                    (sql_ts(moment), page_id))
    by_id = {r["para_id"]: r for r in rows}
    alive = [(r["para_id"], bytes(r["text_hash"])) for r in rows]
    text_by_hash: dict[bytes, str] = {}
    for block in parsed:
        if block.kind != "h":
            text_by_hash.setdefault(text_hash(block.text), block.text)

    history = load_page_history(db, page_id) if rows else None
    th = load_thresholds()
    items: list[HeadingBlock | ParagraphBlock] = []
    for item in outline_for(parsed, alive):
        if item.heading is not None:
            items.append(HeadingBlock(text=item.heading))
            continue
        row = by_id[item.para_id]
        items.append(
            ParagraphBlock(
                paragraph=ParagraphSummary(
                    para_id=item.para_id,
                    section=row["section"],
                    text=text_by_hash[bytes(row["text_hash"])],
                    kind=row["kind"],
                    citations=None if row["citations"] is None else int(row["citations"]),
                    has_history=True,
                    badge=as_badge(badge_at(history, item.para_id, moment, th)),
                )
            )
        )

    article = ArticleHeader(
        lang="fi",
        page_id=page_id,
        title=header["title"],
        wikidata_id=header["wikidata_id"],
        rev_id=version["rev_id"],
        as_of=moment,
        saved_at=utc(version["saved_at"]),
        saved_by=version["user"],
        wikipedia_url=wikipedia_url("fi", version["rev_id"]),
        has_history=True,
        first_version=None,
        languages=languages,
    )
    return ArticleView(article=article, blocks=items, sql=db.statements)


def _plain_view(
    db: Db, lang: str, page_id: int, header: dict, languages: list[LanguageLink]
) -> ArticleView:
    rows = db.query("Reading order and paragraphs", queries.OUTLINE, (lang, page_id))
    items: list[HeadingBlock | ParagraphBlock] = []
    for row in rows:
        if row["heading"] is not None:
            items.append(HeadingBlock(text=row["heading"]))
        elif row["text"] is not None:
            items.append(
                ParagraphBlock(
                    paragraph=ParagraphSummary(
                        para_id=row["para_id"],
                        section=row["section"],
                        text=row["text"],
                        kind=row["kind"],
                        citations=None,
                        has_history=False,
                        badge=UNKNOWN,
                    )
                )
            )
    saved = utc(header["date_modified"]) if header["date_modified"] else FALLBACK_SAVED
    article = ArticleHeader(
        lang=lang,
        page_id=page_id,
        title=header["title"],
        wikidata_id=header["wikidata_id"],
        rev_id=header["rev_id"],
        as_of=saved,
        saved_at=saved,
        saved_by=None,
        wikipedia_url=wikipedia_url(lang, header["rev_id"]),
        has_history=False,
        first_version=None,
        languages=languages,
    )
    return ArticleView(article=article, blocks=items, sql=db.statements)


def get_article(db: Db, lang: str, page_id: int, moment: datetime) -> ArticleView:
    """The article as it is now, or as it was at ``moment``.

    The present view uses the stored badges. A past view rebuilds the text with
    ``FOR SYSTEM_TIME AS OF`` and computes the badges as of that moment. An article without
    edit history is shown with unknown badges. Raises 404 for an unknown article, or one that
    did not exist yet at ``moment``.
    """
    header = db.one("The article", queries.ARTICLE, (lang, page_id))
    if header is None:
        raise ApiError(404, "not_found", f"No article {lang}/{page_id}.")
    languages = _languages(db, [header])[f"{lang}/{page_id}"]

    has_history = False
    if lang == "fi":
        has_history = db.one("Has history", queries.CURRENT_VERSION, (page_id,)) is not None
    if not has_history:
        return _plain_view(db, lang, page_id, header, languages)
    if moment >= SNAPSHOT:
        return _current_history_view(db, lang, page_id, header, languages)
    return _past_view(db, page_id, header, languages, moment)
