import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { HistoryState, HistoryView, Lang } from "../api/types";
import { dayAfter, formatDate, formatSimilarity, plural, safeWikipediaUrl } from "../lib/format";
import { Async, useApi } from "./Async";
import { Badge } from "./Badge";
import { DriftChart } from "./DriftChart";
import { Icon } from "./Icon";
import { Eyebrow, Meter } from "./ui";
import { WordDiff } from "./WordDiff";

export const STATE_LIMIT = 50;
export const NO_HISTORY_MESSAGE =
  "Edit history is not available for this text. History exists for Finnish articles in the history set.";

const TYPE_LABEL: Record<HistoryState["change"]["type"], string> = {
  created: "created",
  wording: "wording",
  meaning: "meaning change",
  numbers: "numbers change",
  restored: "restored",
};

export function HistoryTab({ lang, pageId, paraId }: { lang: Lang; pageId: number; paraId: number }) {
  const history = useApi(() => api.history(lang, pageId, paraId), [lang, pageId, paraId]);
  if (history.state === "error" && history.error?.code === "no_history") return <p className="empty-note">{NO_HISTORY_MESSAGE}</p>;
  // "View the page then": the article on the first whole day a version was visible.
  const pageThen = (from: string) => `/a/${lang}/${pageId}?as_of=${dayAfter(from)}&p=${paraId}`;
  return <Async state={history}>{(data) => <HistoryBody data={data} pageThen={pageThen} />}</Async>;
}

export function HistoryBody({ data, pageThen }: { data: HistoryView; pageThen?: (from: string) => string }) {
  const { paragraph: p, metrics: m } = data;
  const citations =
    p.citations === null || p.citations === 0
      ? "No citations"
      : `${p.citations} ${p.citations === 1 ? "citation" : "citations"}` +
        (m.citations_first_added ? `, first added ${formatDate(m.citations_first_added)}` : "");

  return (
    <div className="history">
      <div className="history-badge">
        <Badge badge={p.badge} showLabel />
      </div>
      {p.badge.reasons.length > 0 && (
        <ul className="reasons">
          {p.badge.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <dl className="figures">
        <div>
          <dt>First seen</dt>
          <dd>
            {formatDate(m.first_seen)}, {m.first_author ?? "anonymous"}
          </dd>
        </div>
        <div>
          <dt>Last substantive change</dt>
          <dd>{formatDate(m.last_substantive_change)}</dd>
        </div>
        <div>
          <dt>Substantive changes</dt>
          <dd>{m.substantive_changes}</dd>
        </div>
        <div className={m.reverted_states > 0 ? "figure-alert" : undefined}>
          <dt>Undone edits</dt>
          <dd>{m.reverted_states}</dd>
        </div>
      </dl>
      <p className="citations">
        <Icon name="file-text" size={13} /> {citations}
      </p>
      {m.total_drift !== null && (
        <p className="drift-total" title="How close the current text is in meaning to the first version. It does not say whether either text is right.">
          <span className="drift-total-label">Since its first version</span>
          <Meter value={1 - m.total_drift} />
          <span>{formatSimilarity(1 - m.total_drift)} similarity of meaning</span>
        </p>
      )}
      <Eyebrow>Change of meaning, version by version</Eyebrow>
      <DriftChart states={data.states} />
      <Eyebrow>Every version of this paragraph · newest first</Eyebrow>
      <StateList states={data.states} pageThen={pageThen} />
    </div>
  );
}

type Row = { kind: "state"; s: HistoryState } | { kind: "undone"; key: number; states: HistoryState[] };

function StateList({ states, pageThen }: { states: HistoryState[]; pageThen?: (from: string) => string }) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const newestFirst = [...states].reverse();
  const shown = showAll ? newestFirst : newestFirst.slice(0, STATE_LIMIT);

  const rows: Row[] = [];
  shown.forEach((s, i) => {
    const last = rows[rows.length - 1];
    if (!s.reverted) rows.push({ kind: "state", s });
    else if (last?.kind === "undone") last.states.push(s);
    else rows.push({ kind: "undone", key: i, states: [s] });
  });

  return (
    <>
      <ol className="states">
        {rows.map((r) =>
          r.kind === "state" ? (
            <StateRow key={`s${r.s.rev_id}-${r.s.from}`} s={r.s} pageThen={pageThen} />
          ) : (
            <li key={`u${r.key}`} className="undone-group">
              <span className="state-dot dot-undone" aria-hidden="true" />
              <button
                type="button"
                className="undone-toggle"
                aria-expanded={open.has(r.key)}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.key)) next.delete(r.key);
                    else next.add(r.key);
                    return next;
                  })
                }
              >
                {r.states.length} undone {r.states.length === 1 ? "edit" : "edits"}
              </button>
              {open.has(r.key) && (
                <ol className="states states-undone">
                  {r.states.map((s) => (
                    <StateRow key={`s${s.rev_id}-${s.from}`} s={s} />
                  ))}
                </ol>
              )}
            </li>
          ),
        )}
      </ol>
      {!showAll && states.length > STATE_LIMIT && (
        <button type="button" className="btn btn-sm show-all" onClick={() => setShowAll(true)}>
          Show all {states.length}
        </button>
      )}
    </>
  );
}

function StateRow({ s, pageThen }: { s: HistoryState; pageThen?: (from: string) => string }) {
  const c = s.change;
  const url = safeWikipediaUrl(s.wikipedia_url);
  const kind = s.reverted ? "undone" : c.type;
  return (
    <li className={`state state-${kind}${s.reverted ? " state-undone" : ""}`} data-rev={s.rev_id}>
      <span className={`state-dot dot-${kind}`} aria-hidden="true" />
      <div className="state-head">
        <span className="state-date">
          {formatDate(s.from)} – {formatDate(s.to)}
        </span>
        {pageThen && !s.reverted && (
          <Link to={pageThen(s.from)} className="state-jump">
            View the page then <Icon name="arrow-up-right" size={11} />
          </Link>
        )}
      </div>
      <div className="state-title">
        <span className={`type-tag type-${kind}`}>{s.reverted ? "undone" : TYPE_LABEL[c.type]}</span>{" "}
        <span className="state-user">{s.anonymous || s.user === null ? "anonymous" : s.user}</span>
        {c.similarity_to_previous !== null && c.type !== "restored" && (
          <span className="muted"> · {formatSimilarity(c.similarity_to_previous)} similarity of meaning</span>
        )}
      </div>
      {s.comment && <p className="comment">“{s.comment}”</p>}
      {(c.numbers_removed.length > 0 || c.numbers_added.length > 0) && (
        <p className="numbers">
          Numbers: removed {c.numbers_removed.join(", ") || "none"}; added {c.numbers_added.join(", ") || "none"}
        </p>
      )}
      <WordDiff ops={c.diff} />
      <div className="state-foot">
        {s.citations > 0 && <span className="muted small">{plural(s.citations, "citation")}</span>}
        {url && (
          <a href={url} target="_blank" rel="noreferrer">
            This version on Wikipedia
          </a>
        )}
      </div>
    </li>
  );
}
