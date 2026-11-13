import { useEffect, useRef, type KeyboardEvent } from "react";
import type { ParagraphSummary } from "../api/types";
import { formatDate } from "../lib/format";
import type { ParaChange } from "../lib/samples";
import { Badge } from "./Badge";
import { DiffSpans } from "./WordDiff";

/**
 * One paragraph of the article. The badge symbol sits in the left margin; a paragraph that is
 * anything but stable also shows its badge label and first reason above the text, so the
 * contested parts of a page stand out while reading. With `change`, what changed since an
 * earlier version is marked in place: a new paragraph is tinted green, a reworded one shows
 * its word diff.
 */
export function Paragraph({
  p,
  selected,
  onSelect,
  change,
  since,
  flash = 0,
}: {
  p: ParagraphSummary;
  selected: boolean;
  onSelect: (paraId: number) => void;
  change?: ParaChange;
  /** The earlier version `change` is measured from, `YYYY-MM-DD`. */
  since?: string;
  /** Changes to a new number when something points at this paragraph: it scrolls into view and glows. */
  flash?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!flash || !el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 140 || r.bottom > window.innerHeight) el.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [flash]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(p.para_id);
    }
  };
  const Tag = p.kind === "li" ? "li" : "p";
  const flagged = p.badge.level !== "stable" && p.badge.level !== "unknown";
  const numbers = change?.kind === "changed" ? change.numbers : undefined;
  const note =
    change && since
      ? change.kind === "added"
        ? `Added since ${formatDate(since)}`
        : numbers && (numbers.removed.length || numbers.added.length)
          ? `${numbers.removed[0] ?? "–"} → ${numbers.added[0] ?? "–"} since ${formatDate(since)}`
          : `Reworded since ${formatDate(since)}`
      : null;
  return (
    <div
      ref={ref}
      className={`para para-${p.badge.level}${flagged ? " para-flagged" : ""}${selected ? " para-selected" : ""}${
        p.kind === "li" ? " para-li" : ""
      }${change ? ` para-${change.kind}-since` : ""}${note ? " para-noted" : ""}`}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      data-para-id={p.para_id}
      onClick={() => onSelect(p.para_id)}
      onKeyDown={onKey}
    >
      {flash > 0 && <span key={flash} className="para-flash" aria-hidden="true" />}
      <Badge badge={p.badge} />
      {note && <span className={`para-change para-change-${change!.kind}`}>{note}</span>}
      {flagged && p.badge.reasons[0] && <span className="para-reason">{p.badge.reasons[0]}</span>}
      <Tag className="para-text">{change?.kind === "changed" ? <DiffSpans ops={change.ops} /> : p.text}</Tag>
    </div>
  );
}

/** A paragraph that was in the earlier version and is gone now: shown struck through, not selectable. */
export function RemovedParagraph({ p, since }: { p: ParagraphSummary; since: string }) {
  return (
    <div className="para-ghost">
      <span className="para-ghost-mark" aria-hidden="true">
        ✂
      </span>
      <span className="para-change para-change-removed">Removed since {formatDate(since)}</span>
      <p className="para-text">
        <del>{p.text}</del>
      </p>
    </div>
  );
}
