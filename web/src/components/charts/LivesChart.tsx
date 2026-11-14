import { useState, type KeyboardEvent } from "react";
import type { BadgeLevel } from "../../api/types";
import { formatDate, formatMonth } from "../../lib/format";
import { levelAt, type Life, type Sample } from "../../lib/samples";
import { BADGE_META } from "../Badge";
import { clamp, timeScale, useScrub, useWidth, yearTicks, type Handle, type ScrubPhase } from "./scale";

const ROW = 22;
const TOP = 28;
const BOTTOM = 24;

/**
 * One row per paragraph: when it appeared, each time its text changed (white notches), when it
 * was removed. The part up to the playhead is coloured by the badge the paragraph had then.
 * Click a label to open the paragraph; drag on the chart to travel.
 */
export function LivesChart({
  samples,
  lives,
  start,
  end,
  t,
  compare,
  selectedId,
  onSelect,
  onScrub,
  onKey,
}: {
  samples: Sample[];
  lives: Life[];
  start: number;
  end: number;
  t: number;
  compare?: { a: number; b: number };
  selectedId: number | null;
  onSelect: (id: number) => void;
  onScrub: (h: Handle, t: number, phase: ScrubPhase) => void;
  onKey: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const labelW = W < 640 ? 112 : 200;
  const chartW = Math.max(120, W - labelW);
  const x = timeScale(start, end, 6, chartW - 6);
  const scrub = useScrub({ x, compare, onScrub, onKey });
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const height = TOP + lives.length * ROW + BOTTOM;
  const lo = compare ? Math.min(compare.a, compare.b) : start;
  const hi = compare ? Math.max(compare.a, compare.b) : t;
  const refT = hi;

  if (!lives.length) return <div className="lives-empty muted small">Reading versions…</div>;

  return (
    <div className="lives" ref={ref}>
      <div className="lives-scroll" style={{ height: Math.min(height, 340) }}>
        <div className="lives-inner" style={{ height }}>
          <div className="lives-labels" style={{ width: labelW, paddingTop: TOP }}>
            {lives.map((l) => {
              const level = levelAt(samples, l.id, refT);
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`lives-label${level ? "" : " gone"}${hoverRow === l.id || selectedId === l.id ? " hot" : ""}`}
                  style={{ height: ROW }}
                  title={l.label}
                  onMouseEnter={() => setHoverRow(l.id)}
                  onMouseLeave={() => setHoverRow(null)}
                  onClick={() => onSelect(l.id)}
                >
                  <span className={`swatch${level ? ` mix-${level}` : ""}`} aria-hidden="true" />
                  <span className="lives-text">{l.label}</span>
                </button>
              );
            })}
          </div>
          <div
            className="lives-chart"
            tabIndex={0}
            role="slider"
            aria-label="Paragraph lives. Drag to travel in time; arrow keys step between months with edits."
            aria-valuemin={start}
            aria-valuemax={end}
            aria-valuenow={refT}
            aria-valuetext={formatDate(new Date(refT).toISOString())}
            {...scrub}
          >
            <svg width={chartW} height={height} aria-hidden="true">
              {yearTicks(x, 48).map((tk) => (
                <g key={tk}>
                  <line className="growth-grid" x1={x(tk)} x2={x(tk)} y1={TOP - 4} y2={height - BOTTOM} />
                  <text className="growth-year" x={x(tk)} y={height - 7} textAnchor="middle">
                    {new Date(tk).getUTCFullYear()}
                  </text>
                </g>
              ))}
              {compare && <rect className="growth-band" x={x(lo)} y={TOP - 6} width={Math.max(0, x(hi) - x(lo))} height={lives.length * ROW + 6} />}
              {lives.map((l, i) => {
                const yy = TOP + i * ROW + ROW / 2;
                const stop = l.removed ?? end;
                const s = clamp(lo, l.born, stop);
                const e = clamp(hi, l.born, stop);
                const level: BadgeLevel | null = levelAt(samples, l.id, refT);
                return (
                  <g key={l.id} onMouseEnter={() => setHoverRow(l.id)} onMouseLeave={() => setHoverRow(null)}>
                    {(hoverRow === l.id || selectedId === l.id) && <rect className="lives-hot" x={0} y={yy - ROW / 2} width={chartW} height={ROW} />}
                    <rect className="lives-span" x={x(l.born)} y={yy - 4} width={Math.max(2, x(stop) - x(l.born))} height={8} rx={4} />
                    <circle className="lives-born" cx={x(l.born)} cy={yy} r={2.5} />
                    {e > s && (
                      <rect
                        className={`lives-past${level ? ` mix-${level}` : " lives-past-gone"}`}
                        x={x(s)}
                        y={yy - 4}
                        width={Math.max(2, x(e) - x(s))}
                        height={8}
                        rx={4}
                      >
                        <title>{level ? BADGE_META[level].name : "Removed"}</title>
                      </rect>
                    )}
                    {l.changes.map((c) => (
                      <line key={c} className="lives-change" x1={x(c)} x2={x(c)} y1={yy - 4} y2={yy + 4} />
                    ))}
                    {l.removed !== null && <line className="lives-removed" x1={x(l.removed)} x2={x(l.removed)} y1={yy - 6} y2={yy + 6} />}
                  </g>
                );
              })}
              {compare ? (
                <>
                  <LifeLine x={x(compare.a)} height={height} width={chartW} label="A" tone="a" />
                  <LifeLine x={x(compare.b)} height={height} width={chartW} label="B" tone="b" />
                </>
              ) : (
                <LifeLine x={x(t)} height={height} width={chartW} label={formatMonth(new Date(t).toISOString())} tone="b" />
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function LifeLine({ x, height, width, label, tone }: { x: number; height: number; width: number; label: string; tone: "a" | "b" }) {
  const w = label.length * 6.4 + 14;
  // The pill stays inside the chart, which scrolls and so clips anything outside it.
  const cx = clamp(x, w / 2, width - w / 2);
  return (
    <g className={`playline playline-${tone}`}>
      <line x1={x} x2={x} y1={TOP - 8} y2={height - BOTTOM + 4} />
      <rect className="playline-pill" x={cx - w / 2} y={TOP - 23} width={w} height={16} rx={8} />
      <text className="playline-text" x={cx} y={TOP - 12} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}
