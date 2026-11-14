import { useEffect, useRef } from "react";
import { formatMonth } from "../lib/format";
import type { Moment, MomentKind } from "../lib/samples";
import { Icon, type IconName } from "./Icon";

const ICON: Record<MomentKind, IconName> = {
  created: "milestone",
  section: "list-tree",
  growth: "activity",
  number: "hash",
  fought: "swords",
  removed: "scissors",
  busiest: "flame",
  latest: "circle-dot",
};

export function MomentIcon({ kind, size = 13 }: { kind: MomentKind; size?: number }) {
  return <Icon name={ICON[kind]} size={size} />;
}

/** "The story so far": the moments of a page as cards; the current one is highlighted and kept in view. */
export function MomentStrip({
  moments,
  activeId,
  t,
  onMoment,
}: {
  moments: Moment[];
  activeId?: string;
  t: number;
  onMoment: (m: Moment) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    const item = el?.querySelector<HTMLElement>(`[data-moment="${activeId}"]`);
    if (!el || !item || typeof el.scrollTo !== "function") return;
    el.scrollTo({ left: Math.max(0, item.offsetLeft - el.clientWidth / 2 + item.clientWidth / 2), behavior: "smooth" });
  }, [activeId]);
  if (!moments.length) return null;
  return (
    <div className="moments">
      <div className="moments-title">The story so far · {moments.length} moments</div>
      <div className="moments-strip" ref={scroller}>
        {moments.map((m) => (
          <button
            key={m.id}
            type="button"
            data-moment={m.id}
            className={`moment moment-${m.kind}${m.id === activeId ? " active" : ""}${m.t > t ? " upcoming" : ""}`}
            onClick={() => onMoment(m)}
          >
            <span className="moment-icon" aria-hidden="true">
              <MomentIcon kind={m.kind} />
            </span>
            <span className="moment-body">
              <span className="moment-date">{formatMonth(new Date(m.t).toISOString())}</span>
              <span className="moment-title">{m.title}</span>
              <span className="moment-detail">{m.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
