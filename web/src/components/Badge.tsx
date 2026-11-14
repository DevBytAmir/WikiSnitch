import type { Badge as BadgeData, BadgeLevel } from "../api/types";

/** Name, symbol and rule for each badge level, as computed in core/badges.py. The first rule that fits wins. */
export const BADGE_META: Record<BadgeLevel, { name: string; glyph: string; rule: string }> = {
  disputed: {
    name: "Disputed",
    glyph: "!",
    rule: "In the last 24 months, edits to it by two or more named users were undone.",
  },
  new: { name: "New", glyph: "✦", rule: "It first appeared less than six months ago." },
  changed_recently: {
    name: "Changed recently",
    glyph: "✎",
    rule: "Its meaning or one of its numbers changed in the last twelve months.",
  },
  stable: {
    name: "Stable",
    glyph: "✓",
    rule: "None of the above. The label gives the year of its last real change.",
  },
  unknown: {
    name: "Unknown",
    glyph: "?",
    rule: "There is no edit history for this text: all Swedish and English text, and Finnish articles outside the history set.",
  },
};

export const BADGE_ORDER: BadgeLevel[] = ["disputed", "new", "changed_recently", "stable", "unknown"];

/**
 * Symbol plus a text label, so colour is never the only signal. In the article margin the
 * label of a stable paragraph shows on hover and focus; everywhere else it is always shown.
 */
export function Badge({ badge, showLabel = false }: { badge: BadgeData; showLabel?: boolean }) {
  return (
    <span className={`badge badge-${badge.level}${showLabel ? " badge-open" : ""}`} title={badge.label}>
      <span className="badge-dot" aria-hidden="true">
        {BADGE_META[badge.level].glyph}
      </span>
      <span className="badge-label">{badge.label}</span>
    </span>
  );
}

/** The coloured symbol alone, for legends and summaries that print the badge name next to it. */
export function BadgeDot({ level }: { level: BadgeLevel }) {
  return (
    <span className={`dot dot-${level}`} aria-hidden="true">
      {BADGE_META[level].glyph}
    </span>
  );
}

/** One line per badge level: symbol, name, and the rule as a tooltip. */
export function BadgeLegend({ levels = BADGE_ORDER.slice(0, 4) }: { levels?: BadgeLevel[] }) {
  return (
    <ul className="badge-legend" aria-label="Badge legend">
      {levels.map((l) => (
        <li key={l} title={BADGE_META[l].rule}>
          <BadgeDot level={l} />
          {BADGE_META[l].name}
        </li>
      ))}
    </ul>
  );
}

export type BadgeCounts = Record<BadgeLevel, number>;

export function countBadges(levels: BadgeLevel[]): BadgeCounts {
  const c: BadgeCounts = { disputed: 0, new: 0, changed_recently: 0, stable: 0, unknown: 0 };
  for (const l of levels) c[l] += 1;
  return c;
}

/** A stacked bar of badge levels with counts underneath. */
export function BadgeMix({ counts }: { counts: BadgeCounts }) {
  const total = BADGE_ORDER.reduce((n, k) => n + counts[k], 0);
  if (total === 0) return null;
  return (
    <div className="badge-mix">
      <div className="badge-mix-bar" aria-hidden="true">
        {BADGE_ORDER.map((k) =>
          counts[k] ? <span key={k} className={`mix-${k}`} style={{ width: `${(counts[k] / total) * 100}%` }} /> : null,
        )}
      </div>
      <ul className="badge-mix-legend">
        {BADGE_ORDER.filter((k) => counts[k]).map((k) => (
          <li key={k} title={BADGE_META[k].rule}>
            <span className={`swatch mix-${k}`} aria-hidden="true" />
            <b>{counts[k]}</b> {BADGE_META[k].name.toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}
