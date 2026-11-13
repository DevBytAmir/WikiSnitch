const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Now" for Finnish history: the dataset snapshot (SNAPSHOT in core/config.py), never the wall clock. */
export const SNAPSHOT_DATE = "2026-10-01";
export const DAY_MS = 86_400_000;

/** Last day of a "YYYY-MM" month as "YYYY-MM-DD". */
export function lastDayOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Milliseconds since the epoch for a `YYYY-MM-DD` day or an ISO timestamp (UTC). */
export function toTime(isoOrDay: string): number {
  return Date.parse(isoOrDay.length === 10 ? `${isoOrDay}T00:00:00Z` : isoOrDay);
}

/** The `YYYY-MM-DD` day of a time in milliseconds (UTC). */
export function dayOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** "2 Apr 2026" in UTC; null means the current state ("now"). */
export function formatDate(iso: string | null): string {
  if (iso === null) return "now";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Apr 2026" in UTC, for month-level marks. */
export function formatMonth(iso: string): string {
  const d = new Date(iso.length === 7 ? `${iso}-01T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Two decimals, never a percentage; null shows a dash. */
export function formatSimilarity(x: number | null): string {
  return x === null ? "–" : x.toFixed(2);
}

/** "29,460": thousands separators, the way the rest of the English interface writes numbers. */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** "1 version", "16 versions". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** "+12", "−3", "±0" with a real minus sign. */
export function signed(n: number): string {
  return n > 0 ? `+${formatNumber(n)}` : n < 0 ? `−${formatNumber(-n)}` : "±0";
}

/** The `YYYY-MM-DD` day of an ISO timestamp (UTC). */
export function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

/** The day after an ISO timestamp, as `YYYY-MM-DD`: the first whole day a state is visible on. */
export function dayAfter(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return isoDay(iso);
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}

/** Word count of plain text. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The URL itself when it is https and its host is a wikipedia.org subdomain; otherwise null. */
export function safeWikipediaUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.endsWith(".wikipedia.org")) return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  return parsed.href;
}
