import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, ApiFailure } from "../api/client";
import type { ArticleView, DiffOp, Lang, ParagraphSummary, TimelineView } from "../api/types";
import { diffStats, numberDifferences, wordDiff } from "../lib/diff";
import { countWords, formatDate, formatMonth, formatNumber, plural, signed } from "../lib/format";
import { Async, useApi } from "./Async";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { lastDayOf } from "./Timeline";
import { Eyebrow } from "./ui";
import { WordDiff } from "./WordDiff";

type Status = "added" | "removed" | "changed" | "same";

interface Row {
  kind: "row";
  status: Status;
  para: ParagraphSummary;
  before?: string;
  diff?: DiffOp[];
  added?: number;
  removed?: number;
  numbers: { removed: string[]; added: string[] };
}
type Item = Row | { kind: "heading"; text: string };

/** The article at a date, or null when it did not exist yet. */
async function versionAt(lang: Lang, pageId: number, day: string): Promise<ArticleView | null> {
  try {
    return await api.article(lang, pageId, day);
  } catch (e) {
    if (e instanceof ApiFailure && e.code === "not_yet_created") return null;
    throw e;
  }
}

const paragraphsOf = (v: ArticleView | null) =>
  v ? v.blocks.flatMap((b) => (b.type === "paragraph" ? [b.paragraph] : [])) : [];

/** Line up two versions by paragraph id, in the order of the later one; removed paragraphs stay where they were. */
function lineUp(A: ArticleView | null, B: ArticleView | null): Item[] {
  const aParas = paragraphsOf(A);
  const bIds = new Set(paragraphsOf(B).map((p) => p.para_id));
  const aById = new Map(aParas.map((p) => [p.para_id, p]));
  const removedAfter = new Map<number | null, ParagraphSummary[]>();
  let prevKept: number | null = null;
  for (const p of aParas) {
    if (bIds.has(p.para_id)) prevKept = p.para_id;
    else removedAfter.set(prevKept, [...(removedAfter.get(prevKept) ?? []), p]);
  }
  const removedRows = (key: number | null): Row[] =>
    (removedAfter.get(key) ?? []).map((p) => ({ kind: "row", status: "removed", para: p, numbers: { removed: [], added: [] } }));

  const out: Item[] = [...removedRows(null)];
  for (const b of B?.blocks ?? []) {
    if (b.type === "heading") {
      out.push({ kind: "heading", text: b.text });
      continue;
    }
    const p = b.paragraph;
    const old = aById.get(p.para_id);
    if (!old) out.push({ kind: "row", status: "added", para: p, numbers: { removed: [], added: [] } });
    else if (old.text === p.text) out.push({ kind: "row", status: "same", para: p, numbers: { removed: [], added: [] } });
    else {
      const diff = wordDiff(old.text, p.text);
      out.push({
        kind: "row",
        status: "changed",
        para: p,
        before: old.text,
        diff,
        ...diffStats(diff),
        numbers: numberDifferences(old.text, p.text),
      });
    }
    out.push(...removedRows(p.para_id));
  }
  return out;
}

export function CompareView({
  lang,
  pageId,
  a,
  b,
  selectedId,
  onSelect,
  onParagraphs,
}: {
  lang: Lang;
  pageId: number;
  a: string;
  b: string;
  selectedId: number | null;
  onSelect: (paraId: number) => void;
  /** Reports every paragraph on either date, so the panel can open any of them. */
  onParagraphs: (ps: ParagraphSummary[]) => void;
}) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const both = useApi(() => Promise.all([versionAt(lang, pageId, from), versionAt(lang, pageId, to)]), [lang, pageId, from, to]);
  useEffect(() => {
    if (!both.data) return;
    const [A, B] = both.data;
    const seen = new Map<number, ParagraphSummary>();
    for (const p of [...paragraphsOf(A), ...paragraphsOf(B)]) seen.set(p.para_id, p);
    onParagraphs([...seen.values()]);
  }, [both.data, onParagraphs]);

  return (
    <Async state={both}>
      {([A, B]) => <CompareBody A={A} B={B} from={from} to={to} selectedId={selectedId} onSelect={onSelect} />}
    </Async>
  );
}

function CompareBody({
  A,
  B,
  from,
  to,
  selectedId,
  onSelect,
}: {
  A: ArticleView | null;
  B: ArticleView | null;
  from: string;
  to: string;
  selectedId: number | null;
  onSelect: (paraId: number) => void;
}) {
  const items = useMemo(() => lineUp(A, B), [A, B]);
  const [showSame, setShowSame] = useState(false);
  const rows = items.filter((i): i is Row => i.kind === "row");
  const n = (s: Status) => rows.filter((r) => r.status === s).length;
  const wordsA = paragraphsOf(A).reduce((s, p) => s + countWords(p.text), 0);
  const wordsB = paragraphsOf(B).reduce((s, p) => s + countWords(p.text), 0);
  const numberRows = rows.filter((r) => r.numbers.added.length + r.numbers.removed.length > 0).length;

  const story: string[] = [];
  if (!A) story.push(`the article did not exist yet on ${formatDate(from)}; by ${formatDate(to)} it had ${plural(wordsB, "word")}`);
  else if (Math.abs(wordsB - wordsA) < 3) story.push(`the article stayed about the same length (${plural(wordsB, "word")})`);
  else story.push(`the article ${wordsB > wordsA ? "grew" : "shrank"} from ${formatNumber(wordsA)} to ${plural(wordsB, "word")}`);
  const parts = [n("added") && `${plural(n("added"), "paragraph")} added`, n("removed") && `${n("removed")} removed`, n("changed") && `${n("changed")} rewritten`].filter(Boolean);
  if (A && parts.length) story.push(parts.join(", "));
  if (A && !parts.length) story.push("no paragraph text changed");

  const out: ReactNode[] = [];
  let run: Row[] = [];
  const flush = (key: string) => {
    if (!run.length) return;
    if (showSame) run.forEach((r) => out.push(<CompareRow key={`r${r.para.para_id}`} r={r} selected={r.para.para_id === selectedId} onSelect={onSelect} />));
    else
      out.push(
        <button key={`same-${key}`} type="button" className="same-run" onClick={() => setShowSame(true)}>
          <Icon name="chevron-down" size={13} /> {plural(run.length, "unchanged paragraph")}
        </button>,
      );
    run = [];
  };
  items.forEach((it, i) => {
    if (it.kind === "row" && it.status === "same") {
      run.push(it);
      return;
    }
    flush(String(i));
    if (it.kind === "heading") out.push(<h3 key={`h${i}`} className="cmp-heading">{it.text}</h3>);
    else out.push(<CompareRow key={`r${it.para.para_id}-${it.status}`} r={it} selected={it.para.para_id === selectedId} onSelect={onSelect} />);
  });
  flush("end");

  return (
    <div className="compare">
      <div className="card compare-summary">
        <Eyebrow>What changed</Eyebrow>
        <p className="compare-story">
          Between {formatDate(from)} and {formatDate(to)}, {story.join("; ")}.
        </p>
        <div className="tiles">
          <Tile label="Words" value={`${formatNumber(wordsA)} → ${formatNumber(wordsB)}`} sub={signed(wordsB - wordsA)} tone={wordsB >= wordsA ? "add" : "del"} />
          <Tile
            label="Paragraphs"
            value={
              <span className="tile-mix">
                <span className="tone-add">+{n("added")}</span> <span className="tone-del">−{n("removed")}</span>{" "}
                <span className="tone-changed">~{n("changed")}</span>
              </span>
            }
            sub={`${n("same")} unchanged`}
          />
          <Tile label="Numbers changed" value={String(numberRows)} sub="in rewritten paragraphs" tone={numberRows ? "changed" : undefined} />
        </div>
        <label className="check">
          <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> Show unchanged paragraphs
        </label>
      </div>
      <div className="compare-rows">{out.length ? out : <p className="empty-note">The page was empty on both dates.</p>}</div>
    </div>
  );
}

const STATUS_LABEL: Record<Status, string> = { added: "Added", removed: "Removed", changed: "Rewritten", same: "Unchanged" };

function CompareRow({ r, selected, onSelect }: { r: Row; selected: boolean; onSelect: (id: number) => void }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(r.para.para_id);
    }
  };
  const pairs = Math.max(r.numbers.removed.length, r.numbers.added.length);
  return (
    <div
      className={`cmp-row cmp-${r.status}${selected ? " para-selected" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-cmp-para={r.para.para_id}
      onClick={() => onSelect(r.para.para_id)}
      onKeyDown={onKey}
    >
      <div className="cmp-row-head">
        {r.status !== "same" && <span className={`status-chip status-${r.status}`}>{STATUS_LABEL[r.status]}</span>}
        {r.status === "changed" && (
          <span className="muted small">
            <span className="tone-add">+{r.added}</span> <span className="tone-del">−{r.removed}</span> words
          </span>
        )}
        {Array.from({ length: pairs }, (_, i) => (
          <span key={i} className="number-chip">
            # {r.numbers.removed[i] ?? "–"} → {r.numbers.added[i] ?? "–"}
          </span>
        ))}
        <span className="cmp-badge">
          <Badge badge={r.para.badge} showLabel />
        </span>
      </div>
      {r.status === "changed" && r.diff ? (
        <WordDiff ops={r.diff} />
      ) : (
        <p className={`cmp-text${r.status === "removed" ? " struck" : ""}`}>{r.para.text}</p>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "add" | "del" | "changed" }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className={`tile-sub${tone ? ` tone-${tone}` : ""}`}>{sub}</div>}
    </div>
  );
}

/** Beside the comparison: what the edit timeline says about the months in between. */
export function CompareRail({ timeline, a, b, onPickB }: { timeline: TimelineView | null | undefined; a: string; b: string; onPickB: (day: string) => void }) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const months = (timeline?.months ?? []).filter((m) => m.month > from.slice(0, 7) && m.month <= to.slice(0, 7));
  const edits = months.reduce((s, m) => s + m.edits, 0);
  const reverts = months.reduce((s, m) => s + m.reverts, 0);
  const busiest = months.reduce<(typeof months)[number] | undefined>((best, m) => (!best || m.edits > best.edits ? m : best), undefined);
  return (
    <div className="rail">
      <div className="card rail-card">
        <Eyebrow>Edits in between</Eyebrow>
        <div className="rail-stats">
          <div>
            <div className="stat-big">{formatNumber(edits)}</div>
            <div className="stat-label">edits</div>
          </div>
          <div>
            <div className="stat-big tone-disputed">{formatNumber(reverts)}</div>
            <div className="stat-label">reverts</div>
          </div>
        </div>
        {busiest && (
          <button type="button" className="insight" onClick={() => onPickB(lastDayOf(busiest.month))}>
            <span className="insight-icon" aria-hidden="true">
              <Icon name="layers" size={14} />
            </span>
            <span className="insight-body">
              <span className="insight-title">Busiest month in this range</span>
              <span className="insight-main">{formatMonth(busiest.month)}</span>
            </span>
            <span className="insight-meta">{plural(busiest.edits, "edit")}</span>
          </button>
        )}
        <p className="rail-note">Undone edits stay visible in each paragraph's history, but no figure counts them.</p>
      </div>
      <div className="card rail-card">
        <Eyebrow>How to read this</Eyebrow>
        <ul className="rail-list">
          <li>
            <span className="status-chip status-added">Added</span> new on the later date
          </li>
          <li>
            <span className="status-chip status-removed">Removed</span> gone by the later date
          </li>
          <li>
            <span className="status-chip status-changed">Rewritten</span> same paragraph, other words
          </li>
          <li>
            <span className="number-chip"># 1939 → 1940</span> a number or year changed
          </li>
        </ul>
        <p className="rail-note">Select any paragraph to open its full history.</p>
      </div>
    </div>
  );
}
