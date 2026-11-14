import type { HistoryState } from "../api/types";
import { formatDate } from "../lib/format";

export const SNAPSHOT_ISO = "2026-10-01T00:00:00Z";
const W = 340;
const H = 132;
const PAD = { l: 30, r: 10, t: 12, b: 24 };

/**
 * One mark per non-undone state at 1 − similarity to the previous state (how far its meaning
 * moved); numbers changes are squares, because similarity barely reacts to them. Undone states
 * are small ticks on the axis: shown, but not counted.
 */
export function DriftChart({ states }: { states: HistoryState[] }) {
  if (states.length === 0) return null;
  const t0 = Date.parse(states[0].from);
  const t1 = Math.max(Date.parse(SNAPSHOT_ISO), t0 + 1);
  const x = (iso: string) => PAD.l + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const maxDrift = Math.max(0.2, ...states.filter((s) => !s.reverted).map(drift));
  const y = (d: number) => H - PAD.b - (d / maxDrift) * (H - PAD.t - PAD.b);
  const axisY = H - PAD.b;

  return (
    <svg className="drift-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Change of meaning over time">
      <line x1={PAD.l} x2={W - PAD.r} y1={y(maxDrift / 2)} y2={y(maxDrift / 2)} className="grid" />
      <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t} y2={PAD.t} className="grid" />
      <line x1={PAD.l} x2={W - PAD.r} y1={axisY} y2={axisY} className="axis" />
      <text x={PAD.l - 5} y={PAD.t + 3} className="tick-label" textAnchor="end">
        {maxDrift.toFixed(1)}
      </text>
      <text x={PAD.l - 5} y={axisY + 3} className="tick-label" textAnchor="end">
        0
      </text>
      <text x={PAD.l} y={H - 6} className="tick-label">
        {new Date(t0).getUTCFullYear()}
      </text>
      <text x={W - PAD.r} y={H - 6} className="tick-label" textAnchor="end">
        2026
      </text>
      {states.map((s, i) => {
        const cx = x(s.from);
        const title = `${formatDate(s.from)}: ${s.reverted ? "undone edit" : s.change.type}`;
        if (s.reverted)
          return (
            <line key={i} className="undone-tick" x1={cx} x2={cx} y1={axisY - 4} y2={axisY + 4}>
              <title>{title}</title>
            </line>
          );
        const cy = y(drift(s));
        const stem = <line className="stem" x1={cx} x2={cx} y1={axisY} y2={cy} />;
        if (s.change.type === "numbers")
          return (
            <g key={i} className="mark mark-numbers">
              {stem}
              <rect x={cx - 4} y={cy - 4} width={8} height={8}>
                <title>{title}</title>
              </rect>
              <text x={cx + 6} y={cy - 6} className="tick-label mark-label">
                numbers
              </text>
            </g>
          );
        return (
          <g key={i} className={`mark mark-${s.change.type}`}>
            {stem}
            <circle cx={cx} cy={cy} r={4}>
              <title>{title}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

function drift(s: HistoryState): number {
  if (s.change.type === "created" || s.change.similarity_to_previous === null) return 0;
  return Math.max(0, 1 - s.change.similarity_to_previous);
}
