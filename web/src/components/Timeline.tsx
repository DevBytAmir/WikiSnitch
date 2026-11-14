import type { KeyboardEvent } from "react";
import type { TimelineView } from "../api/types";
import { formatDate, lastDayOf } from "../lib/format";
import { useWidth } from "./charts/scale";

export { lastDayOf };

const H = 116;
const PAD = { l: 6, r: 6, t: 18, b: 22 };

const monthIndex = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
};

/**
 * Edits per month for the whole article: bar height is the square root of the edits, a red dot
 * marks months with reverts, and a line marks the date shown. Months after that date are drawn
 * faded, so the chart reads as "the past so far". Clicking a month shows the page at its end.
 */
export function TimelineChart({
  data,
  asOf,
  onPick,
  compare,
}: {
  data: TimelineView;
  asOf: string;
  onPick: (date: string) => void;
  /** In compare mode: the two dates being compared, drawn as A and B instead of the as-of line. */
  compare?: { a: string; b: string };
}) {
  const [ref, W] = useWidth<HTMLElement>();
  const { months, totals } = data;
  const caption = `${totals.versions} versions, ${totals.reverts} reverts, ${formatDate(totals.first)}–${formatDate(totals.last)}`;
  if (months.length === 0) return <p className="timeline-caption muted">{caption}</p>;

  const first = monthIndex(months[0].month);
  const last = Math.max(monthIndex(months[months.length - 1].month), monthIndex(asOf.slice(0, 7)));
  const span = last - first + 1;
  const slot = (W - PAD.l - PAD.r) / span;
  const barW = Math.max(1.5, slot * 0.78);
  const maxRoot = Math.sqrt(Math.max(1, ...months.map((m) => m.edits)));
  const plotH = H - PAD.t - PAD.b;
  const baseY = H - PAD.b;
  const x = (ym: string) => PAD.l + (monthIndex(ym) - first) * slot;
  const xMid = (ym: string) => x(ym) + slot / 2;
  const shownMonth = monthIndex(asOf.slice(0, 7));

  const firstYear = Math.floor(first / 12);
  const lastYear = Math.floor(last / 12);
  const step = Math.max(1, Math.ceil((lastYear - firstYear + 1) / Math.max(2, Math.floor(W / 64))));
  const years: number[] = [];
  for (let y = firstYear; y <= lastYear; y += step) years.push(y);

  // One tab stop for the chart (the month shown); the arrow keys move between months.
  const shownYm = asOf.slice(0, 7);
  const focusYm = [...months].reverse().find((m) => m.month <= shownYm)?.month ?? months[0].month;
  const key = (ym: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPick(lastDayOf(ym));
      return;
    }
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const all = [...(e.currentTarget.ownerSVGElement?.querySelectorAll<SVGGElement>("g.month") ?? [])];
    all[all.indexOf(e.currentTarget) + step]?.focus();
  };

  const marker = (ym: string, label: string, cls: string) => {
    const mx = xMid(ym);
    return (
      <g className={cls} aria-hidden="true">
        <line className={`${cls}-line`} x1={mx} x2={mx} y1={PAD.t - 4} y2={baseY} />
        <rect className={`${cls}-flag`} x={mx - 9} y={1} width={18} height={13} rx={2} />
        <text className={`${cls}-text`} x={mx} y={11} textAnchor="middle">
          {label}
        </text>
      </g>
    );
  };

  return (
    <figure className="timeline" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Edits per month">
        {[0.5, 1].map((f) => (
          <line key={f} className="grid" x1={PAD.l} x2={W - PAD.r} y1={baseY - plotH * f} y2={baseY - plotH * f} />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={baseY} y2={baseY} className="axis" />
        {years.map((y) => {
          const tx = PAD.l + (y * 12 - first) * slot;
          if (tx < PAD.l - 1) return null;
          return (
            <g key={y} aria-hidden="true">
              <line className="tick" x1={tx} x2={tx} y1={baseY} y2={baseY + 4} />
              <text x={tx} y={H - 5} className="tick-label" textAnchor={tx > W - 30 ? "end" : "start"}>
                {y}
              </text>
            </g>
          );
        })}
        {months.map((m) => {
          const h = Math.max(1.5, (Math.sqrt(m.edits) / maxRoot) * plotH);
          const bx = x(m.month);
          const future = !compare && monthIndex(m.month) > shownMonth;
          return (
            <g
              key={m.month}
              className={`month${future ? " future" : ""}`}
              role="button"
              tabIndex={m.month === focusYm ? 0 : -1}
              aria-label={`${m.month}: ${m.edits} edits, ${m.reverts} reverts`}
              onClick={() => onPick(lastDayOf(m.month))}
              onKeyDown={key(m.month)}
            >
              <rect className="hit" x={bx - slot * 0.11} y={PAD.t} width={Math.max(slot, 4)} height={plotH} />
              <rect className="bar" x={bx} y={baseY - h} width={barW} height={h}>
                <title>{`${m.month}: ${m.edits} edits`}</title>
              </rect>
              {m.reverts > 0 && (
                <circle className="revert-dot" cx={bx + barW / 2} cy={baseY - h - 4} r={2.6}>
                  <title>{`${m.reverts} reverts (${m.reverts_of_anonymous} of anonymous edits)`}</title>
                </circle>
              )}
            </g>
          );
        })}
        {compare ? (
          <>
            {marker(compare.a.slice(0, 7), "A", "cmp-a")}
            {marker(compare.b.slice(0, 7), "B", "cmp-b")}
          </>
        ) : (
          <>
            <line className="asof-line" x1={xMid(asOf.slice(0, 7))} x2={xMid(asOf.slice(0, 7))} y1={PAD.t - 4} y2={baseY} />
            <circle className="asof-knob" cx={xMid(asOf.slice(0, 7))} cy={PAD.t - 6} r={4} aria-hidden="true" />
          </>
        )}
      </svg>
      <figcaption className="timeline-caption muted">{caption}</figcaption>
    </figure>
  );
}
