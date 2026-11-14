import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** How long Back waits for a page's data to load before giving up on the old position. */
export const RESTORE_TIMEOUT_MS = 3000;

/** Scroll position per history entry, by router location key. */
const positions = new Map<string, number>();

const scroller = () => document.scrollingElement ?? document.documentElement;

/**
 * A new page starts at the top. Back and Forward return to where the reader was on that page,
 * waiting for its data to load first. A change of query string alone (as_of, selection, search)
 * does not scroll, and neither does a jump to an anchor such as #articles.
 */
export function ScrollMemory() {
  const location = useLocation();
  const navType = useNavigationType();
  const current = useRef(location.key);
  const previous = useRef(location);

  useEffect(() => {
    // The browser would restore before the page's data has loaded, then this component would fight it.
    const before = window.history.scrollRestoration;
    if (before) window.history.scrollRestoration = "manual";
    const save = () => positions.set(current.current, scroller().scrollTop);
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      window.removeEventListener("scroll", save);
      if (before) window.history.scrollRestoration = before;
    };
  }, []);

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = location;
    // Runs before the browser fires any scroll event for the new page, so those are saved under its key.
    current.current = location.key;
    if (last === location) return;
    if (last.pathname === location.pathname && last.search === location.search && last.hash !== location.hash) return;

    const target = navType === "POP" ? positions.get(location.key) : undefined;
    if (target !== undefined) return restore(target);
    if (last.pathname !== location.pathname) scroller().scrollTop = 0;
  }, [location, navType]);

  return null;
}

/** Scroll to `target` once the page is tall enough, unless the reader scrolls first or time runs out. */
function restore(target: number): () => void {
  const el = scroller();
  const until = Date.now() + RESTORE_TIMEOUT_MS;
  let frame = 0;
  const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  const stop = () => {
    cancelAnimationFrame(frame);
    events.forEach((e) => window.removeEventListener(e, stop));
  };
  const tick = () => {
    el.scrollTop = target;
    if (Math.abs(el.scrollTop - target) <= 1 || Date.now() > until) stop();
    else frame = requestAnimationFrame(tick);
  };
  events.forEach((e) => window.addEventListener(e, stop, { passive: true }));
  tick();
  return stop;
}
