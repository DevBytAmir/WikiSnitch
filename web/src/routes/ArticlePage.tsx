import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { ArticleView, Lang, ParagraphSummary, TimelineView } from "../api/types";
import { Async, Loading, useApi } from "../components/Async";
import { BadgeDot, BadgeLegend } from "../components/Badge";
import type { Handle, ScrubPhase } from "../components/charts/scale";
import { CompareRail, CompareView } from "../components/CompareView";
import { CrossLangTab, LANGUAGE_NAME } from "../components/CrossLangTab";
import { DataMenu } from "../components/DataMenu";
import { HistoryTab } from "../components/HistoryTab";
import { Icon } from "../components/Icon";
import { InsightPanel, type PanelTab } from "../components/InsightPanel";
import { Paragraph, RemovedParagraph } from "../components/Paragraph";
import { SideRail } from "../components/SideRail";
import { TimeMachine, type ChartView, type CompareRange, type Mode, type Speed } from "../components/TimeMachine";
import { LangTag } from "../components/ui";
import {
  DAY_MS,
  dayAfter,
  dayOf,
  formatDate,
  formatNumber,
  isoDay,
  lastDayOf,
  safeWikipediaUrl,
  SNAPSHOT_DATE,
  toTime,
} from "../lib/format";
import {
  changesSince,
  lifelines,
  previousVersion,
  sampleAt,
  sampleDays,
  storyMoments,
  useSamples,
  type Moment,
} from "../lib/samples";

export { SNAPSHOT_DATE };
const LANGS: readonly string[] = ["fi", "sv", "en"];
/** The whole history plays in this long at 1×. */
const PLAY_MS = 24_000;
const YEAR_MS = 365.25 * DAY_MS;

function isLang(x: string | undefined): x is Lang {
  return x !== undefined && LANGS.includes(x);
}

export function ArticlePage() {
  const { lang, pageId } = useParams();
  const [params, setParams] = useSearchParams();
  const asOf = params.get("as_of") ?? undefined;
  const id = Number(pageId);
  const valid = isLang(lang) && Number.isInteger(id) && id > 0;

  const article = useApi(
    () => (isLang(lang) && valid ? api.article(lang, id, asOf) : Promise.reject(new Error("bad address"))),
    [lang, id, asOf],
  );
  // While another date loads, keep showing the last version of the same article instead of a
  // blank page. (A ref, not state: it only remembers what was already rendered.)
  const lastShown = useRef<ArticleView>();
  if (article.data) lastShown.current = article.data;
  const shown = lastShown.current;

  if (!valid) {
    return (
      <div className="wrap empty-page">
        <p className="empty-title">No such article address.</p>
        <Link to="/">Back to all articles</Link>
      </div>
    );
  }
  if (article.state === "error") {
    if (article.error?.code === "not_yet_created") {
      const current = new URLSearchParams(params);
      current.delete("as_of");
      return (
        <div className="wrap empty-page">
          <p className="empty-title">This article did not exist yet on {formatDate(asOf ?? null)}.</p>
          <Link to={{ search: current.toString() }}>Show the current version</Link>
        </div>
      );
    }
    return (
      <div className="wrap page-pad">
        <Async state={article}>{() => null}</Async>
      </div>
    );
  }
  const stale = shown && shown.article.lang === lang && shown.article.page_id === id ? shown : undefined;
  const data = article.data ?? stale;
  if (!data) {
    return (
      <div className="wrap page-pad">
        <Loading />
      </div>
    );
  }
  return <Reader data={data} busy={article.state === "loading"} params={params} setParams={setParams} />;
}

function Reader({
  data,
  busy,
  params,
  setParams,
}: {
  data: ArticleView;
  busy: boolean;
  params: URLSearchParams;
  setParams: ReturnType<typeof useSearchParams>[1];
}) {
  const a = data.article;
  const asOf = params.get("as_of");
  const p = params.get("p");
  const selectedId = p !== null && /^\d+$/.test(p) ? Number(p) : null;
  const tab: PanelTab = params.get("tab") === "languages" ? "languages" : "history";
  const mode: Mode = a.has_history && params.get("mode") === "compare" ? "compare" : "read";
  const committedDay = asOf ?? isoDay(a.as_of);
  const latest = !asOf || asOf >= SNAPSHOT_DATE;

  const update = useCallback(
    (changes: Record<string, string | null>, replace = false) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === null || v === "") next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace },
      ),
    [setParams],
  );
  const close = useCallback(() => update({ p: null, tab: null }), [update]);

  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, close]);

  const timeline = useApi<TimelineView | null>(
    () => (a.has_history ? api.timeline(a.lang, a.page_id) : Promise.resolve(null)),
    [a.lang, a.page_id, a.has_history],
  );

  // The time axis and the sampled versions behind the charts, the moments and playback.
  const start = toTime(a.first_version ?? timeline.data?.totals.first ?? SNAPSHOT_DATE);
  const end = toTime(SNAPSHOT_DATE);
  const days = useMemo(() => sampleDays(timeline.data), [timeline.data]);
  const { samples, total } = useSamples(a.lang, a.page_id, days);
  const lives = useMemo(() => lifelines(samples, start), [samples, start]);
  const moments = useMemo(
    () => (timeline.data && samples.length ? storyMoments(samples, timeline.data, start) : []),
    [samples, timeline.data, start],
  );

  // Month ends with edits: the steps of the previous/next buttons and the arrow keys.
  const ends = useMemo(() => (timeline.data?.months ?? []).filter((m) => m.edits > 0).map((m) => lastDayOf(m.month)), [timeline.data]);
  const step = (from: string, dir: -1 | 1): string | null | undefined => {
    const lastEnd = ends[ends.length - 1];
    const toDay = (d: string | undefined) => (d === undefined ? undefined : d >= lastEnd || d >= SNAPSHOT_DATE ? null : d);
    if (dir < 0) {
      const capped = lastEnd && from > lastEnd ? lastEnd : from;
      return toDay([...ends].reverse().find((e) => e < capped));
    }
    return from >= SNAPSHOT_DATE ? undefined : toDay(ends.find((e) => e > from));
  };

  // The playhead. `live` is set while playing or dragging: the text then comes from the nearest
  // sampled version, so it changes instantly. Letting go commits the date to the URL.
  const [live, setLiveState] = useState<number | null>(null);
  const liveRef = useRef<number | null>(null);
  const lastPaint = useRef(0);
  const setLive = useCallback((v: number | null, force = true) => {
    liveRef.current = v;
    const now = performance.now();
    if (force || now - lastPaint.current > 40) {
      lastPaint.current = now;
      setLiveState(v);
    }
  }, []);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const [view, setView] = useState<ChartView>("growth");
  // A sampled version shown while the exact version for a committed date loads.
  const [held, setHeld] = useState<ArticleView | null>(null);
  useEffect(() => setHeld(null), [data]);

  const committedT = latest ? end : toTime(committedDay);
  const t = live ?? committedT;
  const liveSample = live !== null ? (sampleAt(samples, live) ?? samples[0]) : undefined;
  const shownView = liveSample?.view ?? held ?? data;
  const displayDay = live !== null ? dayOf(Math.min(live, end)) : latest ? SNAPSHOT_DATE : committedDay;

  const commit = (tt: number | null) => {
    const d = tt === null || tt >= end - DAY_MS ? null : dayOf(Math.max(tt, start + DAY_MS));
    if (d !== (asOf && asOf < SNAPSHOT_DATE ? asOf : null)) {
      const s = d === null ? samples[samples.length - 1] : sampleAt(samples, toTime(d));
      setHeld(s?.view ?? null);
    }
    setLive(null);
    update({ as_of: d });
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const pick = useCallback(
    (d: string | null) => {
      setPlaying(false);
      setLive(null);
      update({ as_of: d });
    },
    [update, setLive],
  );

  const canPlay = samples.length >= 2 && mode === "read";
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      commitRef.current(liveRef.current ?? committedT);
      return;
    }
    if (!canPlay) return;
    setLive(latest || committedT >= end - DAY_MS ? start : committedT);
    setPlaying(true);
  };
  const toggleRef = useRef(togglePlay);
  toggleRef.current = togglePlay;

  useEffect(() => {
    if (!playing) return;
    const rate = (end - start) / (PLAY_MS / Number(speed));
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const n = Math.min(end, (liveRef.current ?? start) + dt * rate);
      if (n >= end) {
        setPlaying(false);
        commitRef.current(null);
        return;
      }
      setLive(n, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, start, end, setLive]);

  // Space plays and pauses, unless focus is on something Space already operates.
  useEffect(() => {
    if (!a.has_history || mode !== "read") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.isContentEditable || el.getAttribute("role") || el.closest(".panel, .menu"))) return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a.has_history, mode]);

  // Compare mode.
  const firstDay = a.first_version ? dayAfter(a.first_version) : SNAPSHOT_DATE;
  const clampDay = (d: string) => (d < firstDay ? firstDay : d > SNAPSHOT_DATE ? SNAPSHOT_DATE : d);
  const defaultA = clampDay(!latest ? committedDay : "2021-10-01");
  const cmp: CompareRange = { a: params.get("a") ?? defaultA, b: params.get("b") ?? SNAPSHOT_DATE };
  const [cmpLive, setCmpLive] = useState<{ a: number; b: number } | null>(null);
  const setCmp = (r: CompareRange) => update({ a: clampDay(r.a), b: clampDay(r.b) });
  const fought = timeline.data?.months.reduce<{ month: string; reverts: number } | undefined>((x, m) => (m.reverts > (x?.reverts ?? 0) ? m : x), undefined);
  const presets = [
    { label: "First vs latest", range: { a: firstDay, b: SNAPSHOT_DATE } },
    { label: "Last 12 months", range: { a: clampDay("2025-10-01"), b: SNAPSHOT_DATE } },
    { label: "5 years ago vs now", range: { a: clampDay("2021-10-01"), b: SNAPSHOT_DATE } },
    ...(fought
      ? [{ label: "Around the most reverts", range: { a: clampDay(dayOf(toTime(`${fought.month}-01`) - DAY_MS)), b: clampDay(lastDayOf(fought.month)) } }]
      : []),
  ];
  const changeMode = (m: Mode) => {
    setPlaying(false);
    setLive(null);
    if (m === "compare") update({ mode: "compare", a: defaultA, b: SNAPSHOT_DATE });
    else update({ mode: null, a: null, b: null, as_of: cmp.b >= SNAPSHOT_DATE ? null : cmp.b });
  };

  const onScrub = (h: Handle, tt: number, phase: ScrubPhase) => {
    if (h === "t") {
      if (phase === "start") setPlaying(false);
      if (phase === "end") commit(tt);
      else setLive(tt);
      return;
    }
    const cur = cmpLive ?? { a: toTime(cmp.a), b: toTime(cmp.b) };
    const next = { ...cur, [h]: tt };
    if (phase === "end") {
      setCmpLive(null);
      setCmp({ a: dayOf(next.a), b: dayOf(next.b) });
    } else setCmpLive(next);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const from = mode === "compare" ? cmp.b : displayDay;
    const ft = toTime(from);
    let target: string | null | undefined;
    if (e.key === "ArrowLeft") target = e.shiftKey ? dayOf(Math.max(start + DAY_MS, ft - YEAR_MS)) : step(from, -1);
    else if (e.key === "ArrowRight") target = e.shiftKey ? (ft + YEAR_MS >= end ? null : dayOf(ft + YEAR_MS)) : step(from, 1);
    else if (e.key === "Home") target = firstDay;
    else if (e.key === "End") target = null;
    else return;
    e.preventDefault();
    if (target === undefined) return;
    if (mode === "compare") setCmp({ ...cmp, b: target ?? SNAPSHOT_DATE });
    else pick(target);
  };

  // Moments: jump to the date, and point at the paragraph the moment is about.
  const [flash, setFlash] = useState<{ id: number; n: number } | null>(null);
  const onMoment = (m: Moment) => {
    setPlaying(false);
    setLive(null);
    update({ as_of: m.day, mode: null, a: null, b: null });
    if (m.paraId !== undefined) setFlash({ id: m.paraId, n: Date.now() });
  };
  const activeMoment = mode === "read" ? [...moments].reverse().find((m) => m.t <= t + DAY_MS)?.id : undefined;

  // What changed since the previous version, marked in the text.
  const [mark, setMark] = useState(true);
  const prevVersion = useMemo(() => previousVersion(samples, t, shownView), [samples, t, shownView]);
  const changes = useMemo(() => (mark && prevVersion ? changesSince(prevVersion, shownView) : null), [mark, prevVersion, shownView]);

  // A small player that follows the reader down the page once the time machine is out of view.
  const tmRef = useRef<HTMLDivElement>(null);
  const [tmVisible, setTmVisible] = useState(true);
  useEffect(() => {
    const el = tmRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setTmVisible(e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [a.has_history]);

  const paragraphs = shownView.blocks.flatMap((b) => (b.type === "paragraph" ? [b.paragraph] : []));
  const [cmpParas, setCmpParas] = useState<ParagraphSummary[]>([]);
  const pool = mode === "compare" ? cmpParas : paragraphs;
  const selected: ParagraphSummary | null = pool.find((x) => x.para_id === selectedId) ?? null;
  const select = (pid: number) => update({ p: String(pid) });
  const shownDate = formatDate(shownView.article.as_of);
  const withoutAsOf = new URLSearchParams(params);
  withoutAsOf.delete("as_of");
  const since = prevVersion?.day;

  return (
    <div className="article-page wrap">
      <ArticleHead data={data} timeline={timeline.data} />

      {a.has_history ? (
        <div ref={tmRef}>
          <TimeMachine
            article={a}
            timeline={timeline}
            samples={samples}
            sampleTotal={total}
            lives={lives}
            moments={moments}
            activeMoment={activeMoment}
            snapshot={SNAPSHOT_DATE}
            start={start}
            end={end}
            t={t}
            day={displayDay}
            latest={latest}
            busy={busy}
            live={live !== null}
            playing={playing}
            canPlay={canPlay}
            onTogglePlay={togglePlay}
            speed={speed}
            onSpeed={setSpeed}
            prev={step(committedDay, -1)}
            next={latest ? undefined : step(committedDay, 1)}
            onPick={pick}
            mode={mode}
            onMode={changeMode}
            view={view}
            onView={setView}
            cmp={cmp}
            cmpLive={cmpLive}
            onCmp={setCmp}
            presets={presets}
            onScrub={onScrub}
            onKey={onKey}
            onMoment={onMoment}
            selectedId={selectedId}
            onSelect={select}
            shown={shownView.article}
            liveDay={liveSample?.day}
          />
        </div>
      ) : (
        <NoHistory data={data} />
      )}

      {a.has_history && !tmVisible && mode === "read" && (
        <MiniBar
          day={displayDay}
          t={t}
          start={start}
          end={end}
          playing={playing}
          canPlay={canPlay}
          onTogglePlay={togglePlay}
          onScrub={onScrub}
          onTop={() => tmRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
        />
      )}

      <div className={`article-layout${selectedId !== null ? ` with-panel panel-${tab}` : ""}`}>
        <div className="article-main">
          {mode === "read" ? (
            <>
              <div className="read-head">
                <BadgeLegend />
                {since ? (
                  <label className="check">
                    <input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} /> Highlight changes since{" "}
                    {formatDate(since)}
                  </label>
                ) : (
                  <span className="muted small">
                    Select a paragraph to see every version of it{a.has_history ? ". Space plays the history." : "."}
                  </span>
                )}
              </div>
              <article className={`article-body${busy || held ? " is-busy" : ""}${live !== null ? " is-live" : ""}`} aria-busy={busy}>
                {shownView.blocks.length === 0 ? (
                  <p className="empty-note">The page was empty on {shownDate}.</p>
                ) : (
                  <>
                    {since && changes?.removedAfter.get(null)?.map((g) => <RemovedParagraph key={`rm${g.para_id}`} p={g} since={since} />)}
                    {shownView.blocks.map((b, i) =>
                      b.type === "heading" ? (
                        <div key={`h${i}`} className="h2-row">
                          <h2 className="article-h2">{b.text}</h2>
                          {changes?.newHeadings.has(b.text) && <span className="chip chip-new-section">New section</span>}
                        </div>
                      ) : (
                        <ParaWithGhosts
                          key={`p${b.paragraph.para_id}`}
                          p={b.paragraph}
                          selected={b.paragraph.para_id === selectedId}
                          onSelect={select}
                          changes={changes}
                          since={since}
                          flash={flash?.id === b.paragraph.para_id ? flash.n : 0}
                        />
                      ),
                    )}
                  </>
                )}
              </article>
              {a.has_history && (
                <p className="read-foot muted small">
                  Click any paragraph to see every version of it. Press Space to play or pause the history; drag the chart to
                  travel.
                </p>
              )}
            </>
          ) : (
            <CompareView
              lang={a.lang}
              pageId={a.page_id}
              a={cmp.a}
              b={cmp.b}
              selectedId={selectedId}
              onSelect={select}
              onParagraphs={setCmpParas}
            />
          )}
        </div>
        <div className="article-side">
          {selectedId !== null ? (
            <InsightPanel paragraph={selected} tab={tab} onTab={(tb) => update({ tab: tb })} onClose={close}>
              {selected === null ? (
                <p>
                  This paragraph does not exist in the version of {mode === "compare" ? formatDate(cmp.b) : shownDate}.{" "}
                  <Link to={{ search: withoutAsOf.toString() }}>Show the current version</Link>
                </p>
              ) : tab === "history" ? (
                <HistoryTab lang={a.lang} pageId={a.page_id} paraId={selected.para_id} />
              ) : (
                <CrossLangTab
                  lang={a.lang}
                  pageId={a.page_id}
                  paraId={selected.para_id}
                  asOf={mode === "compare" ? cmp.b : (asOf ?? undefined)}
                />
              )}
            </InsightPanel>
          ) : mode === "compare" ? (
            <CompareRail timeline={timeline.data} a={cmp.a} b={cmp.b} onPickB={(d) => setCmp({ ...cmp, b: d })} />
          ) : (
            <SideRail article={shownView.article} paragraphs={paragraphs} timeline={timeline.data} onPick={pick} />
          )}
        </div>
      </div>
    </div>
  );
}

function ParaWithGhosts({
  p,
  selected,
  onSelect,
  changes,
  since,
  flash,
}: {
  p: ParagraphSummary;
  selected: boolean;
  onSelect: (id: number) => void;
  changes: ReturnType<typeof changesSince> | null;
  since?: string;
  flash: number;
}) {
  const ghosts = since ? changes?.removedAfter.get(p.para_id) : undefined;
  return (
    <>
      <Paragraph p={p} selected={selected} onSelect={onSelect} change={changes?.changes.get(p.para_id)} since={since} flash={flash} />
      {since && ghosts?.map((g) => <RemovedParagraph key={`rm${g.para_id}`} p={g} since={since} />)}
    </>
  );
}

/** The time machine in one line, pinned under the top bar while the big one is scrolled away. */
function MiniBar({
  day,
  t,
  start,
  end,
  playing,
  canPlay,
  onTogglePlay,
  onScrub,
  onTop,
}: {
  day: string;
  t: number;
  start: number;
  end: number;
  playing: boolean;
  canPlay: boolean;
  onTogglePlay: () => void;
  onScrub: (h: Handle, t: number, phase: ScrubPhase) => void;
  onTop: () => void;
}) {
  return (
    <div className="minibar">
      <div className="minibar-inner wrap">
        <button
          type="button"
          className="minibar-play"
          onClick={onTogglePlay}
          disabled={!canPlay}
          aria-label={playing ? "Pause replay" : "Play history"}
        >
          <Icon name={playing ? "pause" : "play"} size={13} />
        </button>
        <span className="minibar-date">{formatDate(day)}</span>
        <input
          type="range"
          aria-label="Timeline"
          min={start}
          max={end}
          step={DAY_MS}
          value={t}
          onPointerDown={() => onScrub("t", t, "start")}
          onChange={(e) => onScrub("t", Number(e.target.value), "move")}
          onPointerUp={(e) => onScrub("t", Number(e.currentTarget.value), "end")}
          onKeyUp={(e) => onScrub("t", Number(e.currentTarget.value), "end")}
        />
        <button type="button" className="btn btn-xs btn-ghost minibar-top" onClick={onTop}>
          Show timeline
        </button>
      </div>
    </div>
  );
}

function ArticleHead({ data, timeline }: { data: ArticleView; timeline: TimelineView | null | undefined }) {
  const a = data.article;
  const wiki = safeWikipediaUrl(a.wikipedia_url);
  const years = timeline ? Number(timeline.totals.last.slice(0, 4)) - Number(timeline.totals.first.slice(0, 4)) : null;
  return (
    <header className="article-head">
      <Link to="/" className="backlink">
        <Icon name="arrow-left" size={13} /> All articles
      </Link>
      <div className="article-titlebar">
        <div className="min0">
          <h1 className="article-title">{a.title}</h1>
          <p className="article-sub">
            <LangTag lang={a.lang} /> {LANGUAGE_NAME[a.lang]} Wikipedia ·{" "}
            {a.has_history && a.first_version
              ? `every version since ${formatDate(a.first_version)}`
              : "text as of August 2025, without edit history"}
          </p>
        </div>
        <div className="article-actions">
          {a.has_history && (
            <Link to={`/a/${a.lang}/${a.page_id}/review`} className="btn">
              <Icon name="list-checks" size={15} /> Review
            </Link>
          )}
          <DataMenu data={data} timeline={timeline} />
          {wiki && (
            <a href={wiki} target="_blank" rel="noreferrer" className="btn btn-ghost">
              This version on Wikipedia <Icon name="arrow-up-right" size={14} />
            </a>
          )}
        </div>
      </div>
      <div className="article-meta">
        <nav className="seg" aria-label="Language versions">
          <span className="seg-item active" aria-current="page">
            <LangTag lang={a.lang} /> {a.has_history ? "with history" : "this text"}
          </span>
          {a.languages.map((l) => (
            <Link key={`${l.lang}-${l.page_id}`} to={`/a/${l.lang}/${l.page_id}`} className="seg-item" title={l.title}>
              <LangTag lang={l.lang} /> {l.title}
            </Link>
          ))}
        </nav>
        {timeline && (
          <dl className="head-stats">
            <div>
              <dd>{formatNumber(timeline.totals.versions)}</dd>
              <dt>versions</dt>
            </div>
            <div>
              <dd>{formatNumber(timeline.totals.reverts)}</dd>
              <dt>reverts</dt>
            </div>
            {years !== null && (
              <div>
                <dd>{years}</dd>
                <dt>years of history</dt>
              </div>
            )}
          </dl>
        )}
      </div>
    </header>
  );
}

/** Instead of the time machine, for text without history: say so, plainly, and point to the Finnish history if there is one. */
function NoHistory({ data }: { data: ArticleView }) {
  const a = data.article;
  const fi = a.lang !== "fi" ? a.languages.find((l) => l.lang === "fi") : undefined;
  return (
    <section className="nohistory card" aria-label="No edit history">
      <BadgeDot level="unknown" />
      <div className="nohistory-text">
        <p>
          <b>No edit history for this text.</b>{" "}
          {a.lang === "fi"
            ? "This Finnish article is outside the history set: this is its text as of August 2025,"
            : `This is the ${LANGUAGE_NAME[a.lang]} text as of August 2025,`}{" "}
          so every paragraph is marked Unknown: there is no way to tell settled text from contested text.{" "}
          {fi && <Link to={`/a/fi/${fi.page_id}`}>See the Finnish article, {fi.title}</Link>}
        </p>
      </div>
      <div className="nohistory-date">
        <label className="tm-jump">
          <span>As of</span>
          <input type="date" aria-label="As of date" value="" disabled readOnly />
        </label>
        <span className="muted small">No history for this article</span>
      </div>
    </section>
  );
}
