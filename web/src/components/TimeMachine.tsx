import type { KeyboardEvent } from "react";
import type { ArticleHeader, TimelineView } from "../api/types";
import { formatDate, toTime } from "../lib/format";
import type { Life, Moment, Sample } from "../lib/samples";
import { ErrorBox, type ApiState } from "./Async";
import { GrowthChart } from "./charts/GrowthChart";
import { LivesChart } from "./charts/LivesChart";
import type { Handle, ScrubPhase } from "./charts/scale";
import { Icon } from "./Icon";
import { MomentStrip } from "./Moments";
import { TimelineChart } from "./Timeline";
import { Segmented } from "./ui";

export type Speed = "0.5" | "1" | "2" | "4";
export type Mode = "read" | "compare";
export type ChartView = "growth" | "lives" | "edits";

export interface CompareRange {
  a: string;
  b: string;
}

/**
 * "Travel through time": play the history, step between changes, jump to a date, and drag
 * across a chart of the article's whole life: its length (Growth), each paragraph's life
 * (Paragraph lives) or the edits per month (Edits). Below, the story of the page as moments.
 */
export function TimeMachine(p: {
  article: ArticleHeader;
  timeline: ApiState<TimelineView | null>;
  samples: Sample[];
  sampleTotal: number;
  lives: Life[];
  moments: Moment[];
  activeMoment?: string;
  snapshot: string;
  start: number;
  end: number;
  /** The playhead (ms): moves while playing or dragging. */
  t: number;
  /** The date shown, `YYYY-MM-DD`. */
  day: string;
  latest: boolean;
  busy: boolean;
  /** Playing or dragging: the text shown is the nearest sampled version. */
  live: boolean;
  playing: boolean;
  canPlay: boolean;
  onTogglePlay: () => void;
  speed: Speed;
  onSpeed: (s: Speed) => void;
  prev: string | null | undefined;
  next: string | null | undefined;
  onPick: (day: string | null) => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  view: ChartView;
  onView: (v: ChartView) => void;
  cmp: CompareRange;
  /** Compare handles while being dragged (ms); otherwise the committed range. */
  cmpLive: { a: number; b: number } | null;
  onCmp: (r: CompareRange) => void;
  presets: { label: string; range: CompareRange }[];
  onScrub: (h: Handle, t: number, phase: ScrubPhase) => void;
  onKey: (e: KeyboardEvent<HTMLElement>) => void;
  onMoment: (m: Moment) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Who saved the version shown, and when. */
  shown: ArticleHeader;
  /** While travelling: the date of the sampled version on screen. */
  liveDay?: string;
}) {
  const { article: a, mode, cmp } = p;
  const min = a.first_version?.slice(0, 10);
  const compareMs = mode === "compare" ? (p.cmpLive ?? { a: toTime(cmp.a), b: toTime(cmp.b) }) : undefined;
  const tl = p.timeline;

  return (
    <section className="tm card" aria-label="Time machine">
      <div className="tm-top">
        {mode === "read" ? (
          <div className="tm-controls">
            <button
              type="button"
              className="tm-play"
              onClick={p.onTogglePlay}
              disabled={!p.canPlay}
              aria-label={p.playing ? "Pause replay" : "Play history"}
              title={p.playing ? "Pause (Space)" : p.canPlay ? "Play the history (Space)" : "Reading versions…"}
            >
              <Icon name={p.playing ? "pause" : "play"} size={18} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous change"
              title="Previous month with edits (←)"
              disabled={p.prev === undefined}
              onClick={() => p.prev !== undefined && p.onPick(p.prev)}
            >
              <Icon name="skip-back" size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next change"
              title="Next month with edits (→)"
              disabled={p.next === undefined}
              onClick={() => p.next !== undefined && p.onPick(p.next)}
            >
              <Icon name="skip-forward" size={16} />
            </button>
            <Segmented<Speed>
              small
              label="Playback speed"
              value={p.speed}
              onChange={p.onSpeed}
              options={[
                { value: "0.5", label: "½×" },
                { value: "1", label: "1×" },
                { value: "2", label: "2×" },
                { value: "4", label: "4×" },
              ]}
            />
          </div>
        ) : (
          <div className="tm-compare-icon" aria-hidden="true">
            <Icon name="git-compare" size={18} />
          </div>
        )}

        <div className="tm-date">
          {mode === "read" ? (
            <>
              <div className="tm-date-big">
                {formatDate(p.day)}
                {p.latest && !p.live && <span className="chip">latest</span>}
                {p.busy && !p.live && (
                  <span className="tm-busy" role="status">
                    loading…
                  </span>
                )}
              </div>
              <div className="tm-date-sub">
                {p.live
                  ? `travelling · text as of ${formatDate(p.liveDay ?? p.shown.as_of)}`
                  : p.shown.saved_at
                    ? `version saved ${formatDate(p.shown.saved_at)}${p.shown.saved_by ? ` by ${p.shown.saved_by}` : ""}`
                    : "no saved version on this date"}
              </div>
            </>
          ) : (
            <>
              <div className="tm-date-big">
                {formatDate(cmp.a)} <span className="faint">→</span> {formatDate(cmp.b)}
              </div>
              <div className="tm-date-sub">drag A and B on the chart</div>
            </>
          )}
        </div>

        <div className="tm-right">
          {mode === "read" && (
            <label className="tm-jump">
              <span>Jump to</span>
              <input
                type="date"
                aria-label="As of date"
                value={p.day}
                min={min}
                max={p.snapshot}
                onChange={(e) => e.target.value && p.onPick(e.target.value >= p.snapshot ? null : e.target.value)}
              />
            </label>
          )}
          <Segmented<ChartView>
            small
            label="Chart"
            value={p.view}
            onChange={p.onView}
            options={[
              {
                value: "growth",
                title: "Article length over time, with the moments of its story",
                label: (
                  <>
                    <Icon name="chart-area" size={13} /> Growth
                  </>
                ),
              },
              {
                value: "lives",
                title: "When each paragraph appeared, changed and went",
                label: (
                  <>
                    <Icon name="rows-3" size={13} /> Paragraph lives
                  </>
                ),
              },
              {
                value: "edits",
                title: "Edits and reverts per month",
                label: (
                  <>
                    <Icon name="chart-column" size={13} /> Edits
                  </>
                ),
              },
            ]}
          />
          <Segmented<Mode>
            small
            label="Mode"
            value={mode}
            onChange={p.onMode}
            options={[
              {
                value: "read",
                label: (
                  <>
                    <Icon name="book-open" size={13} /> Read
                  </>
                ),
              },
              {
                value: "compare",
                label: (
                  <>
                    <Icon name="git-compare" size={13} /> Compare
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>

      {mode === "compare" && (
        <div className="tm-compare-row">
          <DateField tone="a" label="Compare from" value={cmp.a} min={min} max={p.snapshot} onChange={(v) => p.onCmp({ ...cmp, a: v })} />
          <Icon name="arrow-right" size={14} className="faint" />
          <DateField tone="b" label="Compare to" value={cmp.b} min={min} max={p.snapshot} onChange={(v) => p.onCmp({ ...cmp, b: v })} />
          <span className="tm-sep" aria-hidden="true" />
          <span className="muted small">Try</span>
          {p.presets.map((pr) => (
            <button key={pr.label} type="button" className="btn btn-xs" onClick={() => p.onCmp(pr.range)}>
              {pr.label}
            </button>
          ))}
        </div>
      )}

      <div className="tm-chart">
        {tl.state === "loading" && <div className="timeline-skeleton" aria-hidden="true" />}
        {tl.state === "error" && <ErrorBox message={tl.error?.message ?? "The edit timeline could not be loaded."} retry={tl.retry} />}
        {tl.state === "ready" && tl.data && p.view === "growth" && (
          <GrowthChart
            samples={p.samples}
            total={p.sampleTotal}
            timeline={tl.data}
            start={p.start}
            end={p.end}
            t={p.t}
            compare={compareMs}
            moments={p.moments}
            activeMoment={p.activeMoment}
            onScrub={p.onScrub}
            onKey={p.onKey}
            onMoment={p.onMoment}
          />
        )}
        {tl.state === "ready" && tl.data && p.view === "lives" && (
          <LivesChart
            samples={p.samples}
            lives={p.lives}
            start={p.start}
            end={p.end}
            t={p.t}
            compare={compareMs}
            selectedId={p.selectedId}
            onSelect={p.onSelect}
            onScrub={p.onScrub}
            onKey={p.onKey}
          />
        )}
        {tl.state === "ready" && tl.data && p.view === "edits" && (
          <TimelineChart
            data={tl.data}
            asOf={mode === "compare" ? p.snapshot : p.day}
            onPick={(d) => (mode === "compare" ? p.onCmp({ ...cmp, b: d >= p.snapshot ? p.snapshot : d }) : p.onPick(d >= p.snapshot ? null : d))}
            compare={mode === "compare" ? cmp : undefined}
          />
        )}
      </div>

      <div className="tm-info">
        <span className="tm-now">
          <span className="tm-now-dot" aria-hidden="true" />
          {mode === "compare" ? (
            <span>
              Comparing <b>{formatDate(cmp.a)}</b> with <b>{formatDate(cmp.b)}</b>
            </span>
          ) : p.shown.saved_by ? (
            <span>
              <b>{p.shown.saved_by}</b> · version saved {formatDate(p.shown.saved_at)}
            </span>
          ) : (
            <span>Version of {formatDate(p.shown.as_of)}</span>
          )}
        </span>
        <Legend view={p.view} samples={p.samples.length} />
      </div>

      {mode === "read" && p.view !== "edits" && <MomentStrip moments={p.moments} activeId={p.activeMoment} t={p.t} onMoment={p.onMoment} />}
    </section>
  );
}

function Legend({ view, samples }: { view: ChartView; samples: number }) {
  if (view === "lives")
    return (
      <span className="tm-legend" aria-hidden="true">
        <span>
          <i className="lg-span" /> paragraph, coloured by its badge then
        </span>
        <span>
          <i className="lg-notch" /> text changed
        </span>
        <span>
          <i className="lg-line" /> removed
        </span>
      </span>
    );
  if (view === "edits")
    return (
      <span className="tm-legend" aria-hidden="true">
        <span>
          <i className="lg-bar" /> edits per month
        </span>
        <span>
          <i className="lg-dot" /> month with reverts
        </span>
        <span>click a month to jump</span>
      </span>
    );
  return (
    <span className="tm-legend" aria-hidden="true">
      <span>
        <i className="lg-area" /> words{samples ? `, read at ${samples} dates` : ""}
      </span>
      <span>
        <i className="lg-bar" /> edits in a month
      </span>
      <span>
        <i className="lg-bar lg-bar-red" /> some undone
      </span>
    </span>
  );
}

function DateField({
  tone,
  label,
  value,
  min,
  max,
  onChange,
}: {
  tone: "a" | "b";
  label: string;
  value: string;
  min?: string;
  max: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="date-field">
      <span className={`ab ab-${tone}`} aria-hidden="true">
        {tone.toUpperCase()}
      </span>
      <input type="date" aria-label={label} value={value} min={min} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}
