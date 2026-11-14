"""The shapes of every response, as pydantic models.

They describe the responses exactly: unknown fields are forbidden, so the server cannot add
or rename one without changing the models and the tests that check every endpoint against them.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer


def iso_utc(value: datetime) -> str:
    """A datetime as UTC text with a trailing ``Z``, the only timestamp format of the API."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


Timestamp = Annotated[datetime, PlainSerializer(iso_utc, return_type=str, when_used="always")]

Lang = Literal["fi", "sv", "en"]
BadgeLevel = Literal["stable", "changed_recently", "disputed", "new", "unknown"]


class ApiModel(BaseModel):
    """Base of every response model: extra fields are an error, not silently accepted."""

    model_config = ConfigDict(extra="forbid")


class SqlStatement(ApiModel):
    label: str
    statement: str


class Badge(ApiModel):
    level: BadgeLevel
    label: str
    reasons: list[str]


class ParagraphSummary(ApiModel):
    para_id: int
    section: str | None
    text: str
    kind: Literal["p", "li"]
    citations: int | None
    has_history: bool
    badge: Badge


class LanguageLink(ApiModel):
    lang: Lang
    page_id: int
    title: str


class ArticleListItem(ApiModel):
    lang: Lang
    page_id: int
    title: str
    wikidata_id: str | None
    has_history: bool
    versions: int | None
    languages: list[LanguageLink]


class ArticleList(ApiModel):
    articles: list[ArticleListItem]
    sql: list[SqlStatement]


class ArticleHeader(ApiModel):
    lang: Lang
    page_id: int
    title: str
    wikidata_id: str | None
    rev_id: int | None
    as_of: Timestamp
    saved_at: Timestamp | None
    saved_by: str | None
    wikipedia_url: str
    has_history: bool
    first_version: Timestamp | None
    languages: list[LanguageLink]


class HeadingBlock(ApiModel):
    type: Literal["heading"] = "heading"
    text: str


class ParagraphBlock(ApiModel):
    type: Literal["paragraph"] = "paragraph"
    paragraph: ParagraphSummary


class ArticleView(ApiModel):
    article: ArticleHeader
    blocks: list[HeadingBlock | ParagraphBlock]
    sql: list[SqlStatement]


class TimelineMonth(ApiModel):
    month: str
    edits: int
    reverts: int
    reverts_of_anonymous: int


class TimelineTotals(ApiModel):
    versions: int
    reverts: int
    first: str
    last: str


class Timeline(ApiModel):
    months: list[TimelineMonth]
    totals: TimelineTotals
    sql: list[SqlStatement]


class DiffOp(ApiModel):
    op: Literal["equal", "insert", "delete"]
    text: str


class StateChange(ApiModel):
    type: Literal["created", "wording", "meaning", "numbers", "restored"]
    similarity_to_previous: float | None
    numbers_added: list[str]
    numbers_removed: list[str]
    diff: list[DiffOp]


class HistoryState(ApiModel):
    rev_id: int
    from_: Timestamp = Field(alias="from")
    to: Timestamp | None
    user: str | None
    anonymous: bool
    comment: str | None
    text: str
    citations: int
    reverted: bool
    change: StateChange
    wikipedia_url: str


class HistoryMetrics(ApiModel):
    first_seen: Timestamp
    first_author: str | None
    last_substantive_change: Timestamp
    states: int
    substantive_changes: int
    reverted_states: int
    citations_first_added: Timestamp | None
    total_drift: float | None


class HistoryView(ApiModel):
    paragraph: ParagraphSummary
    metrics: HistoryMetrics
    states: list[HistoryState]
    sql: list[SqlStatement]


ReviewReasonCode = Literal[
    "meaning_changed_recently", "disputed", "unsourced",
    "differs_from_en", "differs_from_sv", "numbers_changed_recently",
]


class ReviewReason(ApiModel):
    code: ReviewReasonCode
    detail: str


class AttentionItem(ApiModel):
    paragraph: ParagraphSummary
    reasons: list[ReviewReason]
    score: float


class MissingParagraph(ApiModel):
    lang: Lang
    para_id: int
    section: str | None
    text: str
    nearest_similarity: float


class ReviewView(ApiModel):
    needs_attention: list[AttentionItem]
    missing_here: list[MissingParagraph]
    sql: list[SqlStatement]


class AskRequest(ApiModel):
    question: str
    as_of: str | None = None
    lang: Lang | None = None


class Citation(ApiModel):
    n: int
    lang: Lang
    page_id: int
    para_id: int
    title: str
    text: str
    similarity: float
    badge: Badge
    wikipedia_url: str


class AskRetrieval(ApiModel):
    candidates: int
    best_similarity: float | None
    threshold: float


class AskView(ApiModel):
    mode: Literal["generated", "extractive", "no_answer"]
    as_of: Timestamp
    answer: str | None
    citations: list[Citation]
    retrieval: AskRetrieval
    sql: list[SqlStatement]


Verdict = Literal["same_claim", "related", "not_found", "no_article"]


class CrossLangArticle(ApiModel):
    page_id: int
    title: str
    wikipedia_url: str
    snapshot: str


class CrossLangMatch(ApiModel):
    para_id: int
    section: str | None
    text: str
    similarity: float


class NumberDifferences(ApiModel):
    only_in_source: list[str]
    only_in_target: list[str]


class Assessment(ApiModel):
    label: Literal["agrees", "differs", "source_has_more", "target_has_more", "contradicts"]
    explanation: str
    model: str


class CrossLangElsewhere(ApiModel):
    page_id: int
    title: str
    para_id: int
    text: str
    similarity: float


class CrossLangTarget(ApiModel):
    lang: Lang
    article: CrossLangArticle | None
    verdict: Verdict
    matches: list[CrossLangMatch]
    number_differences: NumberDifferences | None
    assessment: Assessment | None
    elsewhere: list[CrossLangElsewhere]


class CrossLangThresholds(ApiModel):
    same_claim: float
    related: float
    calibrated: bool


class CrossLangView(ApiModel):
    source: ParagraphSummary
    targets: list[CrossLangTarget]
    thresholds: CrossLangThresholds
    note: str | None
    sql: list[SqlStatement]
