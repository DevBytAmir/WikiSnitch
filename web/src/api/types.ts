// Mirrors the response models of the API (api/models.py) field for field. All text fields are
// plain, untrusted text: render them as text, never as HTML.

export type Lang = "fi" | "sv" | "en";

export interface SqlStatement {
  label: string;
  statement: string;
}

export interface ErrorBody {
  error: { code: string; message: string };
}

export type BadgeLevel = "stable" | "changed_recently" | "disputed" | "new" | "unknown";

export interface Badge {
  level: BadgeLevel;
  label: string;
  reasons: string[];
}

export interface ParagraphSummary {
  para_id: number;
  section: string | null;
  text: string;
  kind: "p" | "li";
  citations: number | null;
  has_history: boolean;
  badge: Badge;
}

export interface Health {
  status: string;
  snapshot: string;
  embedder: boolean;
  answer_model: boolean;
  counts: { articles: number; history_articles: number; paragraph_states: number; vectors: number };
}

export interface LanguageLink {
  lang: Lang;
  page_id: number;
  title: string;
}

export interface ArticleListItem {
  lang: Lang;
  page_id: number;
  title: string;
  wikidata_id: string | null;
  has_history: boolean;
  versions: number | null;
  languages: LanguageLink[];
}

export interface ArticleList {
  articles: ArticleListItem[];
  sql: SqlStatement[];
}

export interface ArticleHeader {
  lang: Lang;
  page_id: number;
  title: string;
  wikidata_id: string | null;
  rev_id: number | null;
  as_of: string;
  saved_at: string | null;
  saved_by: string | null;
  wikipedia_url: string;
  has_history: boolean;
  first_version: string | null;
  languages: LanguageLink[];
}

export type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; paragraph: ParagraphSummary };

export interface ArticleView {
  article: ArticleHeader;
  blocks: Block[];
  sql: SqlStatement[];
}

export interface TimelineMonth {
  month: string;
  edits: number;
  reverts: number;
  reverts_of_anonymous: number;
}

export interface TimelineView {
  months: TimelineMonth[];
  totals: { versions: number; reverts: number; first: string; last: string };
  sql: SqlStatement[];
}

export type ChangeType = "created" | "wording" | "meaning" | "numbers" | "restored";

export interface DiffOp {
  op: "equal" | "insert" | "delete";
  text: string;
}

export interface HistoryState {
  rev_id: number;
  from: string;
  to: string | null;
  user: string | null;
  anonymous: boolean;
  comment: string | null;
  text: string;
  citations: number;
  reverted: boolean;
  change: {
    type: ChangeType;
    similarity_to_previous: number | null;
    numbers_added: string[];
    numbers_removed: string[];
    diff: DiffOp[];
  };
  wikipedia_url: string;
}

export interface HistoryMetrics {
  first_seen: string;
  first_author: string | null;
  last_substantive_change: string;
  states: number;
  substantive_changes: number;
  reverted_states: number;
  citations_first_added: string | null;
  total_drift: number | null;
}

export interface HistoryView {
  paragraph: ParagraphSummary;
  metrics: HistoryMetrics;
  states: HistoryState[];
  sql: SqlStatement[];
}

export type Verdict = "same_claim" | "related" | "not_found" | "no_article";

export type AssessmentLabel =
  | "agrees"
  | "differs"
  | "source_has_more"
  | "target_has_more"
  | "contradicts";

export interface CrossLangMatch {
  para_id: number;
  section: string | null;
  text: string;
  similarity: number;
}

export interface CrossLangElsewhere {
  page_id: number;
  title: string;
  para_id: number;
  text: string;
  similarity: number;
}

export interface CrossLangTarget {
  lang: Lang;
  article: { page_id: number; title: string; wikipedia_url: string; snapshot: string } | null;
  verdict: Verdict;
  matches: CrossLangMatch[];
  number_differences: { only_in_source: string[]; only_in_target: string[] } | null;
  assessment: { label: AssessmentLabel; explanation: string; model: string } | null;
  elsewhere: CrossLangElsewhere[];
}

export interface CrossLangView {
  source: ParagraphSummary;
  targets: CrossLangTarget[];
  thresholds: { same_claim: number; related: number; calibrated: boolean };
  note: string | null;
  sql: SqlStatement[];
}

export type ReviewReasonCode =
  | "meaning_changed_recently"
  | "disputed"
  | "unsourced"
  | "differs_from_en"
  | "differs_from_sv"
  | "numbers_changed_recently";

export interface ReviewView {
  needs_attention: {
    paragraph: ParagraphSummary;
    reasons: { code: ReviewReasonCode; detail: string }[];
    score: number;
  }[];
  missing_here: {
    lang: Lang;
    para_id: number;
    section: string | null;
    text: string;
    nearest_similarity: number;
  }[];
  sql: SqlStatement[];
}

export interface AskRequest {
  question: string;
  as_of: string | null;
  lang: Lang | null;
}

export interface Citation {
  n: number;
  lang: Lang;
  page_id: number;
  para_id: number;
  title: string;
  text: string;
  similarity: number;
  badge: Badge;
  wikipedia_url: string;
}

export interface AskView {
  mode: "generated" | "extractive" | "no_answer";
  as_of: string;
  answer: string | null;
  citations: Citation[];
  retrieval: { candidates: number; best_similarity: number | null; threshold: number };
  sql: SqlStatement[];
}
