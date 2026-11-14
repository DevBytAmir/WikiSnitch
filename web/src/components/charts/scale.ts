import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

/** Width used until an element has been measured (and in tests, where nothing is laid out). */
export const DEFAULT_WIDTH = 720;

/**
 * The rendered width of an element, so an SVG can be drawn at 1:1 scale: text and dots keep their
 * size on a phone and on a wide screen alike, instead of the whole drawing being stretched.
 */
export function useWidth<T extends Element>(fallback = DEFAULT_WIDTH): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(Math.max(240, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface TimeScale {
  (t: number): number;
  invert: (x: number) => number;
  t0: number;
  t1: number;
  x0: number;
  x1: number;
}

/** A linear map from time (ms) to pixels. */
export function timeScale(t0: number, t1: number, x0: number, x1: number): TimeScale {
  const k = (x1 - x0) / (t1 - t0 || 1);
  const f = ((t: number) => x0 + (t - t0) * k) as TimeScale;
  f.invert = (x: number) => t0 + (x - x0) / k;
  f.t0 = t0;
  f.t1 = t1;
  f.x0 = x0;
  f.x1 = x1;
  return f;
}

/** 1 January of each year that fits with at least `minGap` pixels between labels. */
export function yearTicks(x: TimeScale, minGap = 52): number[] {
  const y0 = new Date(x.t0).getUTCFullYear() + 1;
  const y1 = new Date(x.t1).getUTCFullYear();
  const pxPerYear = (x.x1 - x.x0) / Math.max(1, (x.t1 - x.t0) / (365.25 * 86_400_000));
  const step = [1, 2, 5, 10].find((s) => s * pxPerYear >= minGap) ?? 10;
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) if (y % step === 0) out.push(Date.UTC(y, 0, 1));
  return out;
}

export type ScrubPhase = "start" | "move" | "end";
export type Handle = "t" | "a" | "b";

/**
 * Drag (or click) on a time axis to move a playhead, or the nearer of two compare handles.
 * The caller decides what each phase means: "move" is cheap and frequent, "end" commits.
 */
export function useScrub({
  x,
  compare,
  onScrub,
  onKey,
}: {
  x: TimeScale;
  compare?: { a: number; b: number };
  onScrub: (handle: Handle, t: number, phase: ScrubPhase) => void;
  onKey?: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const dragging = useRef<{ handle: Handle; t: number } | null>(null);
  const toT = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return clamp(x.invert(e.clientX - r.left), x.t0, x.t1);
  };
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      const t = toT(e);
      const handle: Handle = compare ? (Math.abs(x(t) - x(compare.a)) < Math.abs(x(t) - x(compare.b)) ? "a" : "b") : "t";
      dragging.current = { handle, t };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onScrub(handle, t, "start");
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (!dragging.current) return;
      dragging.current.t = toT(e);
      onScrub(dragging.current.handle, dragging.current.t, "move");
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const d = dragging.current;
      dragging.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (d) onScrub(d.handle, d.t, "end");
    },
    onPointerCancel(e: PointerEvent<HTMLElement>) {
      const d = dragging.current;
      dragging.current = null;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (d) onScrub(d.handle, d.t, "end");
    },
    onKeyDown: onKey,
  };
}
