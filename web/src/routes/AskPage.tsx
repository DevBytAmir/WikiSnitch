import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { AskView, BadgeLevel, Citation, Lang } from "../api/types";
import { ErrorBox, Loading, useApi, type ApiState } from "../components/Async";
import { Badge, BADGE_META, BadgeDot, countBadges } from "../components/Badge";
import { LANGUAGE_NAME } from "../components/CrossLangTab";
import { Icon, type IconName } from "../components/Icon";
import { Eyebrow, LangTag, Meter, Segmented } from "../components/ui";
import { WordDiff } from "../components/WordDiff";
import { wordDiff } from "../lib/diff";
import { downloadFile } from "../lib/download";
import { formatDate, formatNumber, formatSimilarity, plural, safeWikipediaUrl } from "../lib/format";
import { SNAPSHOT_DATE } from "./ArticlePage";

export const MAX_QUESTION = 500;
const NONE = Symbol("no request");
/** The date offered first for "Then vs now". */
const THEN_DEFAULT = "2016-01-01";

type TimeMode = "latest" | "then";

const SUGGESTIONS: { q: string; tag: string; note: string; asOf?: string; lang?: Lang }[] = [
  { q: "Which peace treaty ended the Winter War?", tag: "Any language", note: "Searches Finnish, Swedish and English paragraphs" },
  { q: "Miten Ahvenanmaan kysymys ratkaistiin?", tag: "Then vs now", note: "Asked as of 1 Jan 2010 and today, side by side", asOf: "2010-01-01" },
  { q: "Mitä tapahtui Lapin sodassa?", tag: "Finnish only", note: "Only Finnish paragraphs are searched", lang: "fi" },
  { q: "Kuka oli Suomen ensimmäinen presidentti?", tag: "Fact lookup", note: "A short question with one expected answer" },
  { q: "Why was Porkkala leased to the Soviet Union?", tag: "Across languages", note: "An English question can cite Finnish text" },
  { q: "Mikä oli helmikuun manifesti?", tag: "Then vs now", note: "Asked as of 1 Jan 2008 and today", asOf: "2008-01-01" },
];

interface Asked {
  q: string;
  asOf: string;
  lang: string;
}
// The questions asked in this visit, newest first. Kept in memory only.
let asked: Asked[] = [];

function parseLang(x: string | null): Lang | "" {
  return x === "fi" || x === "sv" || x === "en" ? x : "";
}

function askHref(a: Asked): string {
  const p = new URLSearchParams({ q: a.q });
  if (a.asOf) p.set("as_of", a.asOf);
  if (a.lang) p.set("lang", a.lang);
  return `/ask?${p.toString()}`;
}

export function AskPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const asOf = params.get("as_of") ?? "";
  const lang = parseLang(params.get("lang"));
  const [draft, setDraft] = useState(q);
  const [time, setTime] = useState<TimeMode>(asOf ? "then" : "latest");
  const [draftAsOf, setDraftAsOf] = useState(asOf || THEN_DEFAULT);
  const [draftLang, setDraftLang] = useState<Lang | "">(lang);
  const [history, setHistory] = useState<Asked[]>(asked);

  // Back and forward in the browser change the URL; keep the form in step with it.
  useEffect(() => {
    setDraft(q);
    setTime(asOf ? "then" : "latest");
    if (asOf) setDraftAsOf(asOf);
    setDraftLang(lang);
  }, [q, asOf, lang]);

  const go = (question: string, when: string, language: Lang | "") => {
    const next = new URLSearchParams({ q: question });
    if (when) next.set("as_of", when);
    // A past date searches Finnish history articles only (the API answers 400 otherwise).
    if (language && !(when && language !== "fi")) next.set("lang", language);
    setParams(next);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const question = draft.trim();
    if (!question) return;
    go(question, time === "then" ? draftAsOf : "", draftLang);
  };

  const onAsked = (a: Asked) => {
    asked = [a, ...asked.filter((x) => askHref(x) !== askHref(a))].slice(0, 8);
    setHistory(asked);
  };

  const timeNote =
    time === "latest"
      ? "Answers use the latest text: Finnish to 1 Oct 2026, Swedish and English as of August 2025."
      : `Asked twice: as of ${formatDate(draftAsOf)}, when anything written later is invisible and only Finnish articles with history are searched, and today.`;

  return (
    <div className="ask-page wrap">
      <div className="min0">
        <Eyebrow>Ask · answers cited to paragraphs</Eyebrow>
        <h1 className="page-title">Ask the archive</h1>
        <p className="lead">
          Answers are written only from Wikipedia paragraphs found for your question. Every answer cites its sources,
          each with its badge. If nothing relevant is found, you get no answer instead of a guess.
        </p>

        <form onSubmit={submit} className="ask-form card">
          <label htmlFor="question" className="sr-only">
            Question
          </label>
          <textarea
            id="question"
            value={draft}
            maxLength={MAX_QUESTION}
            rows={2}
            placeholder="e.g. Which peace treaty ended the Winter War?"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="ask-toolbar">
            <label className="select">
              <span className="sr-only">Language of the passages</span>
              <select
                value={time === "then" ? "fi" : draftLang}
                disabled={time === "then"}
                onChange={(e) => setDraftLang(parseLang(e.target.value))}
              >
                <option value="">Any language</option>
                <option value="fi">Finnish only</option>
                <option value="en">English only</option>
                <option value="sv">Swedish only</option>
              </select>
              <Icon name="chevron-down" size={12} className="select-chevron" />
            </label>
            <Segmented<TimeMode>
              small
              label="Time"
              value={time}
              onChange={setTime}
              options={[
                { value: "latest", label: "Latest" },
                {
                  value: "then",
                  label: (
                    <>
                      <Icon name="git-compare" size={12} /> Then vs now
                    </>
                  ),
                },
              ]}
            />
            {time === "then" && (
              <input
                type="date"
                className="date-input"
                aria-label="As of date"
                value={draftAsOf}
                min="2002-01-01"
                max={SNAPSHOT_DATE}
                onChange={(e) => e.target.value && setDraftAsOf(e.target.value)}
              />
            )}
            <span className="counter muted">
              {draft.length}/{MAX_QUESTION}
            </span>
            <button type="submit" className="btn btn-primary" disabled={draft.trim() === ""}>
              Ask <Icon name="arrow-right" size={14} />
            </button>
          </div>
        </form>
        <p className="ask-note muted small">{timeNote}</p>

        {!q && (
          <section className="suggestions" aria-label="Example questions">
            <Eyebrow>Try one of these</Eyebrow>
            <div className="suggestion-grid">
              {SUGGESTIONS.map((s) => (
                <button key={s.q} type="button" className="suggestion card" onClick={() => go(s.q, s.asOf ?? "", s.lang ?? "")}>
                  <span className="chip chip-hl">{s.tag}</span>
                  <span className="suggestion-q">{s.q}</span>
                  <span className="suggestion-note">
                    {s.note} <Icon name="arrow-right" size={13} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {q && <Results key={`${q}|${asOf}|${lang}`} q={q} asOf={asOf} lang={lang} onAsked={onAsked} />}
      </div>

      <div className="ask-side">
        {history.length > 0 && (
          <div className="card rail-card">
            <Eyebrow>Your questions</Eyebrow>
            <ul className="asked">
              {history.map((h) => (
                <li key={askHref(h)}>
                  <Link to={askHref(h)}>{h.q}</Link>
                  <span className="muted small">
                    {h.asOf ? `as of ${formatDate(h.asOf)} and today` : "latest"}
                    {h.lang ? ` · ${LANGUAGE_NAME[h.lang as Lang]} only` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="card rail-card">
          <Eyebrow>Good to know</Eyebrow>
          <ul className="tips">
            <Tip icon="info" title="Similarity is not truth.">
              It measures how close a paragraph is in meaning to your question, not whether it is right.
            </Tip>
            <Tip icon="triangle-alert" title="Badges travel with sources.">
              A disputed or recently changed source is flagged on the answer, so you know what to double-check.
            </Tip>
            <Tip icon="git-compare" title="Ask the past.">
              Pick a date and anything written later is invisible to the search.
            </Tip>
          </ul>
          <Link to="/help" className="more-link">
            How to read badges and similarity <Icon name="arrow-right" size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Tip({ icon, title, children }: { icon: IconName; title: string; children: string }) {
  return (
    <li>
      <Icon name={icon} size={15} className={`tip-icon tip-${icon}`} />
      <span>
        <b>{title}</b> {children}
      </span>
    </li>
  );
}

function Results({ q, asOf, lang, onAsked }: { q: string; asOf: string; lang: Lang | ""; onAsked: (a: Asked) => void }) {
  // A past date searches Finnish history articles only, so a language other than Finnish is dropped.
  const effLang = asOf ? (lang === "fi" ? "fi" : "") : lang;
  const dated = useApi(
    () => (effLang ? api.ask(q, asOf || undefined, effLang) : api.ask(q, asOf || undefined)),
    [q, asOf, effLang],
  );
  const today = useApi(() => (asOf ? api.ask(q) : Promise.reject(NONE)), [q, asOf]);
  useEffect(() => {
    onAsked({ q, asOf, lang: effLang });
    // Record once per question.
  }, [q, asOf, effLang]);

  if (!asOf) {
    return (
      <div className="results">
        <Pipeline state={dated} />
        <AskResult state={dated} column="now" q={q} lang={effLang} />
      </div>
    );
  }
  return (
    <div className="results">
      <Pipeline state={dated} />
      {dated.data && today.data && <ThenVsNow then={dated.data} now={today.data} asOf={asOf} />}
      <div className="ask-columns">
        <div className="min0">
          <div className="column-head">
            <span className="ab ab-a" aria-hidden="true">
              A
            </span>
            <h2>As of {formatDate(asOf)}</h2>
          </div>
          <AskResult state={dated} column="asof" asOf={asOf} q={q} />
        </div>
        <div className="min0">
          <div className="column-head">
            <span className="ab ab-b" aria-hidden="true">
              B
            </span>
            <h2>Today</h2>
          </div>
          <AskResult state={today} column="today" q={q} />
        </div>
      </div>
    </div>
  );
}

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "message", title: "Read the question", body: "Turn it into a search vector" },
  { icon: "search", title: "Search the archive", body: "Find the paragraphs closest in meaning" },
  { icon: "layers", title: "Pick the evidence", body: "Keep passages above the similarity cut-off" },
  { icon: "pen-line", title: "Write with citations", body: "Use only those passages, cite every one" },
];

/** The four steps of answering, lit up while the request runs and filled with what happened after. */
function Pipeline({ state }: { state: ApiState<AskView> }) {
  const [step, setStep] = useState(0);
  const loading = state.state === "loading";
  useEffect(() => {
    if (!loading) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => Math.min(s + 1, 3)), 450);
    return () => clearInterval(id);
  }, [loading]);
  const d = state.data;
  const details = d
    ? [
        d.as_of < `${SNAPSHOT_DATE}T` ? `Searching the text as of ${formatDate(d.as_of)}` : "Searching the latest text",
        d.retrieval.candidates === 0
          ? "No paragraphs to compare"
          : `${formatNumber(d.retrieval.candidates)} closest paragraphs compared`,
        d.retrieval.candidates === 0
          ? "Nothing to keep"
          : d.mode === "no_answer"
          ? `Nothing above the ${formatSimilarity(d.retrieval.threshold)} cut-off`
          : `${plural(d.citations.length, "passage")} kept, best ${formatSimilarity(d.retrieval.best_similarity)}`,
        d.mode === "generated"
          ? `Answer cites ${plural(d.citations.length, "source")}`
          : d.mode === "extractive"
            ? "No answer model: passages only"
            : "No answer written",
      ]
    : [];
  const failed = state.state === "error";
  return (
    <ol className="pipeline" aria-label="How the answer is made">
      {STEPS.map((s, i) => {
        const done = state.state === "ready" || (loading && step > i);
        const active = loading && step === i;
        return (
          <li key={s.title} className={`pipe${done ? " done" : ""}${active ? " active" : ""}${failed && i === 1 ? " failed" : ""}`}>
            <div className="pipe-top">
              <span className="pipe-icon" aria-hidden="true">
                <Icon name={done ? "check" : s.icon} size={13} />
              </span>
              <span className="pipe-n" aria-hidden="true">
                0{i + 1}
              </span>
            </div>
            <div className={`pipe-title${active ? " shimmer-text" : ""}`}>{s.title}</div>
            <div className="pipe-body">{state.state === "ready" && details[i] ? details[i] : s.body}</div>
          </li>
        );
      })}
    </ol>
  );
}

function AskResult({
  state,
  column,
  asOf,
  q,
  lang = "",
}: {
  state: ApiState<AskView>;
  column: string;
  asOf?: string;
  q: string;
  lang?: Lang | "";
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (state.state === "loading") return <Loading text="Searching…" />;
  if (state.state === "error" || !state.data) {
    const code = state.error?.code;
    if (code === "empty_question" || state.error?.status === 422)
      return (
        <p role="alert" className="async-error">
          Enter a question of up to 500 characters.
        </p>
      );
    return (
      <ErrorBox
        message={code === "embedder_unavailable" ? "Search is unavailable right now." : (state.error?.message ?? "Something went wrong.")}
        retry={state.retry}
      />
    );
  }
  const d = state.data;
  const id = (n: number) => `cite-${column}-${n}`;
  if (d.retrieval.candidates === 0) {
    // Nothing was compared, so there is no closest paragraph or score to report.
    // A past date searches Finnish history articles only, whatever the language choice.
    const searched = asOf ? "fi" : lang;
    const which = searched ? `${LANGUAGE_NAME[searched]} paragraphs` : "paragraphs";
    const hint = asOf ? " Try a later date." : lang ? " Try “Any language”." : "";
    return (
      <div className="ask-result" data-mode={d.mode}>
        <div className="card answer-card no-answer">
          <Icon name="x" size={16} className="no-answer-icon" />
          <div>
            <p className="answer-none">
              No {which} could be searched{asOf ? " on that date" : ""}, so there was nothing to compare the question with.
            </p>
            <p className="muted small">Rather than guess, WikiSnitch writes nothing.{hint}</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="ask-result" data-mode={d.mode}>
      {d.mode === "generated" && d.answer && (
        <AnswerCard d={d} q={q} column={column} id={id} onHover={setHover} />
      )}
      {d.mode === "extractive" && (
        <div className="card answer-card">
          <h3>Passages that may answer this</h3>
          <p className="muted">No answer model is available, so no summary was written.</p>
        </div>
      )}
      {d.mode === "no_answer" && (
        <>
          <div className="card answer-card no-answer">
            <Icon name="x" size={16} className="no-answer-icon" />
            <div>
              <p className="answer-none">{d.answer}</p>
              <p className="muted small">
                The closest paragraph scored {formatSimilarity(d.retrieval.best_similarity)}, below the{" "}
                {formatSimilarity(d.retrieval.threshold)} cut-off. Rather than guess, WikiSnitch writes nothing. Try naming a
                person, place or event, or pick a later date.
              </p>
            </div>
          </div>
          <h3 className="sources-title">Closest passages</h3>
        </>
      )}
      {d.mode === "generated" && <h3 className="sources-title">Sources</h3>}
      <ol className="citations-list">
        {d.citations.map((c) => (
          <CitationItem key={c.n} c={c} id={id(c.n)} asOf={asOf} threshold={d.retrieval.threshold} hover={hover === c.n} />
        ))}
      </ol>
      <Retrieval d={d} />
    </div>
  );
}

function trust(citations: Citation[]): { level: BadgeLevel; text: string }[] {
  const c = countBadges(citations.map((x) => x.badge.level));
  const out: { level: BadgeLevel; text: string }[] = [];
  if (c.disputed)
    out.push({
      level: "disputed",
      text: `${c.disputed === 1 ? "One cited paragraph is" : `${c.disputed} cited paragraphs are`} disputed: editors have recently undone each other's edits to it. Check the source before relying on it.`,
    });
  const recent = c.new + c.changed_recently;
  if (recent)
    out.push({
      level: "changed_recently",
      text: `${recent === 1 ? "One cited paragraph" : `${recent} cited paragraphs`} changed or appeared in the last year, so the wording may still be settling.`,
    });
  if (c.unknown)
    out.push({
      level: "unknown",
      text: `${c.unknown === 1 ? "One source has" : `${c.unknown} sources have`} no edit history in the data, so its stability is unknown.`,
    });
  return out;
}

function AnswerCard({
  d,
  q,
  column,
  id,
  onHover,
}: {
  d: AskView;
  q: string;
  column: string;
  id: (n: number) => string;
  onHover: (n: number | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  const counts = countBadges(d.citations.map((c) => c.badge.level));
  const articles = new Set(d.citations.map((c) => `${c.lang}-${c.page_id}`)).size;
  const warnings = trust(d.citations);

  const sources = d.citations
    .map((c) => `[${c.n}] ${c.title} (${LANGUAGE_NAME[c.lang]}), ${formatSimilarity(c.similarity)} similarity of meaning, ${c.badge.label}. ${c.wikipedia_url}`)
    .join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${q}\n\n${d.answer ?? ""}\n\n${sources}\n\nText from Wikipedia, CC BY-SA 4.0.`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  const save = () =>
    downloadFile(
      "wikisnitch-answer.json",
      JSON.stringify(
        { question: q, as_of: d.as_of, mode: d.mode, answer: d.answer, citations: d.citations, retrieval: d.retrieval, license: "Text from Wikipedia, CC BY-SA 4.0" },
        null,
        2,
      ),
      "application/json",
    );

  return (
    <div className="card answer-card">
      <div className="answer-top">
        <Eyebrow>Answer · as of {formatDate(d.as_of)}</Eyebrow>
        <div className="answer-actions">
          <button type="button" className="btn btn-xs btn-ghost" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy with sources"}
          </button>
          <button type="button" className="btn btn-xs btn-ghost" onClick={save}>
            <Icon name="download" size={13} /> JSON
          </button>
        </div>
      </div>
      <Answer text={d.answer ?? ""} citations={d.citations} id={id} onHover={onHover} />
      <div className="trust-line">
        <span>
          Built from <b>{plural(d.citations.length, "passage")}</b> in {plural(articles, "article")}
        </span>
        <span className="trust-chips">
          {(Object.keys(counts) as BadgeLevel[])
            .filter((k) => counts[k])
            .map((k) => (
              <span key={k} className={`chip chip-${k}`}>
                <BadgeDot level={k} /> {counts[k]} {BADGE_META[k].name.toLowerCase()}
              </span>
            ))}
        </span>
        {column === "now" && (
          <Link to={`/ask?${new URLSearchParams({ q, as_of: THEN_DEFAULT }).toString()}`} className="then-link">
            <Icon name="git-compare" size={13} /> How did this answer look in {THEN_DEFAULT.slice(0, 4)}?
          </Link>
        )}
      </div>
      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w.level} className={`warning warning-${w.level}`}>
              <Icon name="triangle-alert" size={15} />
              <span>{w.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Answer({
  text,
  citations,
  id,
  onHover,
}: {
  text: string;
  citations: Citation[];
  id: (n: number) => string;
  onHover: (n: number | null) => void;
}) {
  const known = new Set(citations.map((c) => c.n));
  const parts = text.split(/(\[\d+\])/);
  const jump = (n: number) => {
    const el = document.getElementById(id(n));
    if (!el) return;
    document.querySelectorAll(".citation-highlight").forEach((x) => x.classList.remove("citation-highlight"));
    el.classList.add("citation-highlight");
    el.scrollIntoView?.({ behavior: "smooth", block: "center" });
    el.focus();
  };
  return (
    <p className="answer">
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        if (m && known.has(Number(m[1]))) {
          const n = Number(m[1]);
          return (
            <button
              key={i}
              type="button"
              className="cite-ref"
              onClick={() => jump(n)}
              onMouseEnter={() => onHover(n)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(n)}
              onBlur={() => onHover(null)}
              aria-label={`Citation ${n}`}
            >
              {n}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

function CitationItem({ c, id, asOf, threshold, hover }: { c: Citation; id: string; asOf?: string; threshold: number; hover: boolean }) {
  const href = `/a/${c.lang}/${c.page_id}?p=${c.para_id}${asOf ? `&as_of=${asOf}` : ""}`;
  const wiki = safeWikipediaUrl(c.wikipedia_url);
  return (
    <li id={id} tabIndex={-1} className={`citation${hover ? " is-hover" : ""}`}>
      <div className="citation-head">
        <span className="cite-n" aria-hidden="true">
          {c.n}
        </span>
        <Link to={href} className="citation-title">
          {c.title}
        </Link>
        <LangTag lang={c.lang} />
        <Badge badge={c.badge} showLabel />
        <span className="citation-sim" title="How close this paragraph is in meaning to your question. Not a measure of truth.">
          <Meter value={c.similarity} threshold={threshold} />
          <span>{formatSimilarity(c.similarity)} similarity of meaning</span>
        </span>
      </div>
      <p className="citation-text">{c.text}</p>
      <div className="citation-foot">
        <Icon name="file-text" size={12} />
        <span>{asOf ? `The paragraph as it read on ${formatDate(asOf)}` : "The paragraph as it reads today"}</span>
        {wiki && (
          <a href={wiki} target="_blank" rel="noreferrer">
            This version on Wikipedia <Icon name="arrow-up-right" size={11} />
          </a>
        )}
      </div>
    </li>
  );
}

/** "Why these passages?": the retrieval numbers behind the answer. */
function Retrieval({ d }: { d: AskView }) {
  const r = d.retrieval;
  return (
    <details className="card retrieval">
      <summary>
        <Icon name="search" size={16} />
        <span>
          <span className="retrieval-title">Why these passages?</span>
          <span className="retrieval-sub">
            The closest of {formatNumber(r.candidates)} candidate paragraphs, and where the cut-off fell
          </span>
        </span>
        <Icon name="chevron-down" size={16} className="retrieval-chevron" />
      </summary>
      <div className="retrieval-body">
        <p className="muted small">
          Every candidate is scored by similarity of meaning to the question. Passages at or above{" "}
          <b>{formatSimilarity(r.threshold)}</b> can be used; the best scored <b>{formatSimilarity(r.best_similarity)}</b>.
          At most 2 passages per article, 3 per topic and 8 in total are kept.
        </p>
        <ol className="retrieval-list">
          {d.citations.map((c) => (
            <li key={c.n} className={c.similarity >= r.threshold ? "kept" : "below"}>
              <span className="retrieval-n">{c.n}</span>
              <Meter value={c.similarity} threshold={r.threshold} tone={c.similarity >= r.threshold ? undefined : "muted"} />
              <span className="tabular">{formatSimilarity(c.similarity)}</span>
              <span className="retrieval-what">
                <b>{c.title}</b> <span className="muted">· {LANGUAGE_NAME[c.lang]}</span>
              </span>
              <span className={`chip${c.similarity >= r.threshold ? " chip-ink" : ""}`}>
                {c.similarity >= r.threshold ? "above cut-off" : "below cut-off"}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

const key = (c: Citation) => `${c.lang}-${c.page_id}-${c.para_id}`;

/** With a past date: what changed in the evidence between then and today. */
function ThenVsNow({ then, now, asOf }: { then: AskView; now: AskView; asOf: string }) {
  const thenBy = new Map(then.citations.map((c) => [key(c), c]));
  const nowBy = new Map(now.citations.map((c) => [key(c), c]));
  const onlyNow = now.citations.filter((c) => !thenBy.has(key(c)));
  const onlyThen = then.citations.filter((c) => !nowBy.has(key(c)));
  const changed = now.citations.flatMap((c) => {
    const old = thenBy.get(key(c));
    return old && old.text !== c.text ? [{ old, c }] : [];
  });
  const headline =
    then.mode === "no_answer" && now.mode !== "no_answer"
      ? `On ${formatDate(asOf)} the archive could not answer this at all.`
      : onlyNow.length || onlyThen.length || changed.length
        ? `The evidence changed: ${[
            onlyNow.length && plural(onlyNow.length, "new source"),
            changed.length && `${plural(changed.length, "source")} rewritten`,
            onlyThen.length && `${onlyThen.length} dropped`,
          ]
            .filter(Boolean)
            .join(", ")}.`
        : "The answer rests on the same text on both dates.";
  return (
    <div className="card then-now">
      <Eyebrow>
        Then vs now · {formatDate(asOf)} → today
      </Eyebrow>
      <p className="then-now-headline">{headline}</p>
      {changed.length > 0 && (
        <ul className="then-now-list">
          {changed.map(({ old, c }) => (
            <li key={key(c)}>
              <div className="small">
                <b>{c.title}</b> <span className="muted">· same paragraph, different words</span>
              </div>
              <WordDiff ops={wordDiff(old.text, c.text)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
