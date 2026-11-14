import type { KeyboardEvent, ReactNode } from "react";
import type { Lang } from "../api/types";

const LANG_NAME: Record<Lang, string> = { fi: "Finnish", sv: "Swedish", en: "English" };

/** A small uppercase language code, with the language name as its tooltip. */
export function LangTag({ lang, muted = false }: { lang: Lang; muted?: boolean }) {
  return (
    <span className={`lang-tag${muted ? " lang-tag-other" : ""}`} title={LANG_NAME[lang]}>
      {lang.toUpperCase()}
    </span>
  );
}

/** Small uppercase label above a block. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

/**
 * A thin bar for a value from 0 to 1. Decoration only: the number is always printed next to it,
 * so it is hidden from assistive technology.
 */
export function Meter({ value, threshold, tone }: { value: number; threshold?: number; tone?: "muted" }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className={`meter${tone ? ` meter-${tone}` : ""}`} aria-hidden="true">
      <span className="meter-fill" style={{ width: `${Math.max(2, v * 100)}%` }} />
      {threshold !== undefined && <span className="meter-threshold" style={{ left: `${threshold * 100}%` }} />}
    </span>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

/**
 * A row of mutually exclusive options: a radio group drawn as buttons. One tab stop for the
 * group; the arrow keys move between options, as in a native radio group.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  small = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const next = enabled[(i + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[options.indexOf(next)]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={`seg${small ? " seg-sm" : ""}`} onKeyDown={onKey}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.title}
          disabled={o.disabled}
          className={`seg-item${o.value === value ? " active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
