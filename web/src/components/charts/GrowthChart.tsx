import { useId, useState, type KeyboardEvent } from "react";
import type { TimelineView } from "../../api/types";
import { DAY_MS, formatDate, formatMonth, formatNumber, plural, toTime } from "../../lib/format";
import { sampleAt, type Moment, type Sample } from "../../lib/samples";
import { MomentIcon } from "../Moments";
import { clamp, timeScale, useScrub, useWidth, yearTicks, type Handle, type ScrubPhase } from "./scale";

const H = 200;
const PAD = { l: 4, r: 4, t: 38, b: 42 };

/**
 * Article length over time (the "river"), drawn from the sampled versions. The part up to the
 * playhead is filled; the future is a dashed outline. Under the axis, one tick per month with
 * edits (length grows with the number of edits; red when edits were undone). Moments sit on the
 * curve. Drag anywhere to travel; arrow keys step between months with edits.
 */
export function GrowthChart({
  samples,
  total,
  timeline,
  start,
  end,
  t,
  compare,
  moments,
  activeMoment,
  onScrub,
  onKey,
  onMoment,
}: {
  samples: Sample[];
  total: number;
  timeline: TimelineView;
  start: number;
  end: number;
  t: number;
  compare?: { a: number; b: number };
  moments: Moment[];
  activeMoment?: string;
  onScrub: (h: Handle, t: number, phase: ScrubPhase) => void;
  onKey: (e: KeyboardEvent<HTMLElement>) => void;
  onMoment: (m: Moment) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const uid = useId().replace(/:/g, "");
  const x = timeScale(start, end, PAD.l, W - PAD.r);
  const scrub = useScrub({ x, compare, onScrub, onKey });
  const [hover, setHover] = useState<number | null>(null);

  const maxWords = Math.max(1, ...samples.map((s) => s.words));
  const base = H - PAD.b;
  const y = (w: number) => PAD.t + (base - PAD.t) * (1 - w / (maxWords * 1.12));
  const wordsAt = (tt: number) => (sampleAt(samples, tt) ?? samples[0])?.words ?? 0;

  let line = "";
  if (samples.length) {
    line = `M${x(start).toFixed(1)},${y(samples[0].words).toFixed(1)}`;
    for (let k = 1; k < samples.length; k++) line += `H${x(samples[k - 1].t + DAY_MS).toFixed(1)}V${y(samples[k].words).toFixed(1)}`;
    line += `H${x(end).toFixed(1)}`;
  }
  const area = line ? `${line}V${base}H${x(start).toFixed(1)}Z` : "";

  const lo = compare ? Math.min(compare.a, compare.b) : start;
  const hi = compare ? Math.max(compare.a, compare.b) : t;
  const maxEdits = Math.max(1, ...timeline.months.map((m) => m.edits));
  const monthOf = (tt: number) => new Date(tt).toISOString().slice(0, 7);
  const hoverMonth = hover !== null ? timeline.months.find((m) => m.month === monthOf(hover)) : undefined;
  const loading = samples.length < total;

  return (
    <div
      ref={ref}
      className="growth"
      style={{ height: H }}
      tabIndex={0}
      role="slider"
      aria-label="Article timeline. Drag to travel in time; arrow keys step between months with edits, Shift+arrow by a year."
      aria-valuemin={start}
      aria-valuemax={end}
      aria-valuenow={compare ? compare.b : t}
      aria-valuetext={formatDate(new Date(compare ? compare.b : t).toISOString())}
      {...scrub}
      onPointerMove={(e) => {
        scrub.onPointerMove(e);
        const r = e.currentTarget.getBoundingClientRect();
        setHover(clamp(x.invert(e.clientX - r.left), start, end));
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={W} height={H} className="growth-svg" aria-hidden="true">
        <defs>
          <clipPath id={`past-${uid}`}>
            <rect x={x(lo)} y={0} width={Math.max(0, x(hi) - x(lo))} height={H} />
          </clipPath>
          <linearGradient id={`grad-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" className="growth-stop-top" />
            <stop offset="100%" className="growth-stop-bottom" />
          </linearGradient>
        </defs>
        {yearTicks(x).map((tk) => (
          <g key={tk}>
            <line className="growth-grid" x1={x(tk)} x2={x(tk)} y1={PAD.t - 6} y2={base} />
            <text className="growth-year" x={x(tk)} y={base + 31} textAnchor="middle">
              {new Date(tk).getUTCFullYear()}
            </text>
          </g>
        ))}
        {samples.length > 0 && (
          <>
            {[0.5, 1].map((f) => (
              <line key={f} className="growth-grid" x1={x.x0} x2={x.x1} y1={y(maxWords * f)} y2={y(maxWords * f)} />
            ))}
            <text className="growth-max" x={x.x0 + 2} y={y(maxWords) - 6}>
              {formatNumber(maxWords)} words
            </text>
            <path d={area} className="growth-area-future" />
            <path d={line} className="growth-line-future" />
          </>
        )}
        {compare && <rect className="growth-band" x={x(lo)} y={PAD.t - 8} width={Math.max(0, x(hi) - x(lo))} height={base - PAD.t + 8} />}
        {samples.length > 0 && (
          <g clipPath={`url(#past-${uid})`}>
            <path d={area} fill={`url(#grad-${uid})`} />
            <path d={line} className="growth-line" />
          </g>
        )}
        <line className="growth-axis" x1={x.x0} x2={x.x1} y1={base} y2={base} />
        {timeline.months.map((m) => {
          const tx = x(toTime(`${m.month}-15`));
          const len = 3 + 10 * Math.sqrt(m.edits / maxEdits);
          const past = compare ? true : toTime(`${m.month}-01`) <= t;
          return (
            <g key={m.month} className={past ? undefined : "growth-future"}>
              <line className={m.reverts > 0 ? "growth-tick growth-tick-revert" : "growth-tick"} x1={tx} x2={tx} y1={base + 4} y2={base + 4 + len} />
              {m.reverts > 0 && <circle className="growth-revert" cx={tx} cy={base + 7 + len} r={1.8} />}
            </g>
          );
        })}
        {hover !== null && <line className="growth-hover" x1={x(hover)} x2={x(hover)} y1={PAD.t - 6} y2={base} />}
        {compare ? (
          <>
            <PlayLine x={x(compare.a)} tone="a" />
            <PlayLine x={x(compare.b)} tone="b" />
          </>
        ) : (
          <PlayLine x={x(t)} tone="b" />
        )}
      </svg>

      {samples.length > 0 &&
        moments.map((m) => {
          const past = compare ? m.t >= lo && m.t <= hi : m.t <= t;
          return (
            <button
              key={m.id}
              type="button"
              tabIndex={-1}
              className={`pin pin-${m.kind}${past ? "" : " pin-future"}${m.id === activeMoment ? " pin-active" : ""}`}
              style={{ left: x(m.t), top: clamp(y(wordsAt(m.t)) - 26, 2, base - 24) }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onMoment(m)}
              aria-label={`${m.title}: ${m.detail}`}
            >
              <MomentIcon kind={m.kind} size={11} />
              <span className="pin-tip" aria-hidden="true">
                <span className="pin-tip-date">{formatMonth(new Date(m.t).toISOString())}</span>
                <span className="pin-tip-title">{m.title}</span>
                <span className="pin-tip-detail">{m.detail}</span>
              </span>
            </button>
          );
        })}

      {compare ? (
        <>
          <HandleLabel x={x(compare.a)} width={W} text={`A · ${formatMonth(new Date(compare.a).toISOString())}`} tone="a" />
          <HandleLabel x={x(compare.b)} width={W} text={`B · ${formatMonth(new Date(compare.b).toISOString())}`} tone="b" />
        </>
      ) : (
        <HandleLabel x={x(t)} width={W} text={formatMonth(new Date(t).toISOString())} tone="b" />
      )}

      {hover !== null && (
        <div className="growth-tip" style={{ left: clamp(x(hover), 90, W - 90), top: base + 40 }}>
          {formatDate(new Date(hover).toISOString())}
          {samples.length > 0 && ` · ${formatNumber(wordsAt(hover))} words`}
          {hoverMonth && ` · ${plural(hoverMonth.edits, "edit")} that month`}
        </div>
      )}

      {loading && (
        <div className="growth-loading" role="status">
          Reading versions… {samples.length}/{total}
        </div>
      )}
    </div>
  );
}

function PlayLine({ x, tone }: { x: number; tone: "a" | "b" }) {
  return (
    <g className={`playline playline-${tone}`}>
      <line x1={x} x2={x} y1={24} y2={H - PAD.b + 14} />
      <circle cx={x} cy={H - PAD.b + 14} r={3.5} />
    </g>
  );
}

function HandleLabel({ x, width, text, tone }: { x: number; width: number; text: string; tone: "a" | "b" }) {
  return (
    <div className={`handle-label handle-${tone}`} style={{ left: clamp(x, 44, width - 44) }} aria-hidden="true">
      {text}
    </div>
  );
}
