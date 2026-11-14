import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/** Also read by the inline script in index.html, which applies the choice before first paint. */
const STORAGE_KEY = "wikisnitch-theme";
const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (private mode); the theme still applies for this visit.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore<Theme>(subscribe, current, () => "light");
  const toggle = useCallback(() => setTheme(current() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
}
