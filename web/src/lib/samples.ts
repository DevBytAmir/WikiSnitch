import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { ArticleView, BadgeLevel, DiffOp, Lang, ParagraphSummary, TimelineView } from "../api/types";
import { numberDifferences, wordDiff } from "./diff";
import { countWords, DAY_MS, formatMonth, lastDayOf, plural, SNAPSHOT_DATE, toTime } from "./format";

// The time machine needs the article at many dates: for the growth curve, the paragraph
// lifelines, the story moments and smooth playback. The API serves one date per request, so the
// page samples the end of the months that had edits (thinned out evenly to MAX_SAMPLES), a few
// requests at a time, and keeps them for the visit. With every edit month sampled the picture is
// exact to the month; with fewer, it is drawn at that resolution and says so.

export const MAX_SAMPLES = 36;
const CONCURRENCY = 3;

export interface Sample {
  day: string;
  t: number;
  view: ArticleView;
  paras: Map<number, ParagraphSummary>;
  order: number[];
  headings: string[];
  words: number;
  /** Identifies the text of this version: equal signatures, equal text. */
  sig: string;
}

/** Month ends with edits, capped at the snapshot and thinned to at most `max`, first and last kept. */
export function sampleDays(t: TimelineView | null | undefined, max = MAX_SAMPLES): string[] {
  const ends = [
    ...new Set(
      (t?.months ?? [])
        .filter((m) => m.edits > 0)
        .map((m) => {
          const e = lastDayOf(m.month);
          return e > SNAPSHOT_DATE ? SNAPSHOT_DATE : e;
        }),
    ),
  ];
  if (ends.length <= max) return ends;
  const out: string[] = [];
  for (let i = 0; i < max; i++) out.push(ends[Math.round((i * (ends.length - 1)) / (max - 1))]);
  return [...new Set(out)];
}

const cache = new Map<string, ArticleView>();
const keyOf = (lang: Lang, pageId: number, day: string) => `${lang}/${pageId}/${day}`;

type Parsed = Pick<Sample, "paras" | "order" | "headings" | "words" | "sig">;
const parsed = new WeakMap<ArticleView, Parsed>();
const samplesBuilt = new WeakMap<ArticleView, Sample>();

function parse(view: ArticleView): Parsed {
  const hit = parsed.get(view);
  if (hit) return hit;
  const paras = new Map<number, ParagraphSummary>();
  const order: number[] = [];
  const headings: string[] = [];
  let words = 0;
  for (const b of view.blocks) {
    if (b.type === "heading") headings.push(b.text);
    else {
      paras.set(b.paragraph.para_id, b.paragraph);
      order.push(b.paragraph.para_id);
      words += countWords(b.paragraph.text);
    }
  }
  const sig = `${order.map((id) => `${id}\u0002${paras.get(id)!.text}`).join("\u0001")}\u0003${headings.join("\u0001")}`;
  const p = { paras, order, headings, words, sig };
  parsed.set(view, p);
  return p;
}

/**
 * The most recent sampled version, at or before `t`, whose text differs from `view`: what
 * "changes since" is measured against. Sampled versions identical to `view` are skipped, so the
 * latest version is compared with the one before its last edits, not with itself.
 */
export function previousVersion(samples: Sample[], t: number, view: ArticleView): Sample | undefined {
  const sig = parse(view).sig;
  for (let k = samples.length - 1; k >= 0; k--) {
    const s = samples[k];
    if (s.t <= t && s.sig !== sig) return s;
  }
  return undefined;
}

export function toSample(day: string, view: ArticleView): Sample {
  const hit = samplesBuilt.get(view);
  if (hit && hit.day === day) return hit;
  const s: Sample = { day, t: toTime(day), view, ...parse(view) };
  samplesBuilt.set(view, s);
  return s;
}

/** Loads the article at each day in the background; returns what has arrived so far, oldest first. */
export function useSamples(lang: Lang, pageId: number, days: string[]): { samples: Sample[]; total: number } {
  const [tick, setTick] = useState(0);
  const sig = `${lang}/${pageId}:${days.join(",")}`;
  useEffect(() => {
    let live = true;
    const todo = days.filter((d) => !cache.has(keyOf(lang, pageId, d)));
    let next = 0;
    const worker = async () => {
      while (live && next < todo.length) {
        const d = todo[next++];
        try {
          cache.set(keyOf(lang, pageId, d), await api.articleVersion(lang, pageId, d));
          if (live) setTick((n) => n + 1);
        } catch {
          // A missing sample only makes the picture coarser; the page itself is unaffected.
        }
      }
    };
    for (let i = 0; i < CONCURRENCY; i++) void worker();
    return () => {
      live = false;
    };
  }, [sig]);
  const samples = useMemo(
    () =>
      days.flatMap((d) => {
        const v = cache.get(keyOf(lang, pageId, d));
        return v ? [toSample(d, v)] : [];
      }),
    [sig, tick],
  );
  return { samples, total: days.length };
}

/** The latest sample at or before `t`. */
export function sampleAt(samples: Sample[], t: number): Sample | undefined {
  let hit: Sample | undefined;
  for (const s of samples) if (s.t <= t) hit = s;
  return hit;
}

/** When a sample's content appeared: just after the previous sample (or at the start for the first). */
const appeared = (samples: Sample[], k: number, start: number) => (k === 0 ? start : samples[k - 1].t + DAY_MS);

export interface Life {
  id: number;
  label: string;
  born: number;
  removed: number | null;
  changes: number[];
}

/** One lifeline per paragraph id: when it appeared, when its text changed, when it went. */
export function lifelines(samples: Sample[], start: number): Life[] {
  if (!samples.length) return [];
  // Order: the latest version's order, with paragraphs that are gone put back after their old neighbour.
  const order = [...samples[samples.length - 1].order];
  for (let k = samples.length - 2; k >= 0; k--) {
    let prev: number | null = null;
    for (const id of samples[k].order) {
      if (!order.includes(id)) order.splice(prev === null ? 0 : order.indexOf(prev) + 1, 0, id);
      prev = id;
    }
  }
  return order.map((id) => {
    const present = samples.map((s) => s.paras.has(id));
    const first = present.indexOf(true);
    const last = present.lastIndexOf(true);
    const changes: number[] = [];
    for (let k = first + 1; k <= last; k++) {
      const a = samples[k - 1].paras.get(id);
      const b = samples[k].paras.get(id);
      if (a && b && a.text !== b.text) changes.push(appeared(samples, k, start));
    }
    const text = samples[last].paras.get(id)?.text ?? "";
    const words = text.split(/\s+/).filter(Boolean);
    return {
      id,
      label: words.length > 9 ? `${words.slice(0, 9).join(" ")}…` : text,
      born: appeared(samples, first, start),
      removed: last < samples.length - 1 ? samples[last].t + DAY_MS : null,
      changes,
    };
  });
}

/** The badge a paragraph had at `t`, from the nearest sample; null when it did not exist then. */
export function levelAt(samples: Sample[], id: number, t: number): BadgeLevel | null {
  return sampleAt(samples, t)?.paras.get(id)?.badge.level ?? null;
}

export type MomentKind = "created" | "section" | "growth" | "number" | "fought" | "removed" | "busiest" | "latest";

export interface Moment {
  id: string;
  kind: MomentKind;
  /** Where the pin sits on the time axis. */
  t: number;
  /** The date to show when the moment is opened (`YYYY-MM-DD`, or null for the latest version). */
  day: string | null;
  title: string;
  detail: string;
  paraId?: number;
}

const snippet = (text: string, n = 7) => {
  const w = text.split(/\s+/).filter(Boolean);
  return w.length <= n ? text : `${w.slice(0, n).join(" ")}…`;
};

/** The story of a page: the handful of moments worth jumping to. */
export function storyMoments(samples: Sample[], timeline: TimelineView, start: number): Moment[] {
  const out: Moment[] = [];
  const first = samples[0];
  out.push({
    id: "created",
    kind: "created",
    t: start,
    day: first?.day ?? null,
    title: "Article created",
    detail: first ? `${plural(first.order.length, "paragraph")}, ${plural(first.words, "word")}` : formatMonth(timeline.totals.first),
  });

  const seenHeadings = new Set(first?.headings ?? []);
  let sections = 0;
  let growth = { k: -1, gain: 0 };
  const numbers: Moment[] = [];
  const removed: Moment[] = [];
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1];
    const b = samples[k];
    const when = appeared(samples, k, start);
    for (const h of b.headings) {
      if (seenHeadings.has(h)) continue;
      seenHeadings.add(h);
      if (sections++ < 3) out.push({ id: `section-${k}-${h}`, kind: "section", t: when, day: b.day, title: "New section", detail: `“${h}”` });
    }
    if (b.words - a.words > growth.gain) growth = { k, gain: b.words - a.words };
    for (const [id, p] of b.paras) {
      const old = a.paras.get(id);
      if (!old || old.text === p.text) continue;
      const nd = numberDifferences(old.text, p.text);
      if (nd.removed.length || nd.added.length)
        numbers.push({
          id: `num-${k}-${id}`,
          kind: "number",
          t: when,
          day: b.day,
          title: "Number changed",
          detail: `${nd.removed[0] ?? "–"} → ${nd.added[0] ?? "–"}`,
          paraId: id,
        });
    }
    for (const [id, p] of a.paras)
      if (!b.paras.has(id)) removed.push({ id: `rm-${k}-${id}`, kind: "removed", t: when, day: b.day, title: "Paragraph removed", detail: `“${snippet(p.text)}”`, paraId: id });
  }
  if (growth.k > 0 && growth.gain >= 20) {
    const b = samples[growth.k];
    out.push({ id: "growth", kind: "growth", t: appeared(samples, growth.k, start), day: b.day, title: "Growth spurt", detail: `+${plural(growth.gain, "word")} by ${formatMonth(b.day)}` });
  }
  out.push(...numbers.slice(-3), ...removed.slice(-2));

  const months = timeline.months;
  const busiest = months.reduce<(typeof months)[number] | undefined>((x, m) => (!x || m.edits > x.edits ? m : x), undefined);
  if (busiest && busiest.edits >= 3)
    out.push({ id: "busiest", kind: "busiest", t: toTime(`${busiest.month}-15`), day: lastDayOf(busiest.month), title: "Busiest month", detail: `${plural(busiest.edits, "edit")} in ${formatMonth(busiest.month)}` });
  const fought = months.reduce<(typeof months)[number] | undefined>((x, m) => (m.reverts > (x?.reverts ?? 0) ? m : x), undefined);
  if (fought && fought.reverts >= 1)
    out.push({
      id: "fought",
      kind: "fought",
      t: toTime(`${fought.month}-15`),
      day: lastDayOf(fought.month),
      title: fought.reverts >= 2 ? "Fought over" : "Edit undone",
      detail: `${plural(fought.reverts, "revert")} in ${formatMonth(fought.month)}`,
    });

  out.push({ id: "latest", kind: "latest", t: toTime(timeline.totals.last), day: null, title: "Latest edit", detail: `${formatMonth(timeline.totals.last)} · ${plural(timeline.totals.versions, "version")} in all` });
  return out.sort((x, y) => x.t - y.t);
}

export type ParaChange = { kind: "added" } | { kind: "changed"; ops: DiffOp[]; numbers: { removed: string[]; added: string[] } };

/** How a version differs from an earlier one, paragraph by paragraph. */
export function changesSince(prev: Sample, view: ArticleView) {
  const now = parse(view);
  const changes = new Map<number, ParaChange>();
  for (const [id, p] of now.paras) {
    const old = prev.paras.get(id);
    if (!old) changes.set(id, { kind: "added" });
    else if (old.text !== p.text) changes.set(id, { kind: "changed", ops: wordDiff(old.text, p.text), numbers: numberDifferences(old.text, p.text) });
  }
  // Paragraphs that are gone, keyed by the paragraph they used to follow (null: the top).
  const removedAfter = new Map<number | null, ParagraphSummary[]>();
  let anchor: number | null = null;
  for (const id of prev.order) {
    if (now.paras.has(id)) anchor = id;
    else removedAfter.set(anchor, [...(removedAfter.get(anchor) ?? []), prev.paras.get(id)!]);
  }
  const newHeadings = new Set(now.headings.filter((h) => !prev.headings.includes(h)));
  return { changes, removedAfter, newHeadings };
}
