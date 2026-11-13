import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ParagraphSummary } from "../api/types";
import { Icon } from "./Icon";

export type PanelTab = "history" | "languages";

/** The panel beside the article for the selected paragraph: "Through time" and "Across languages". */
export function InsightPanel({
  paragraph,
  tab,
  onTab,
  onClose,
  children,
}: {
  paragraph: ParagraphSummary | null;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [paragraph?.para_id]);

  return (
    <aside className="panel" aria-label="Paragraph insight" tabIndex={-1} ref={ref}>
      <div className="panel-head">
        <div className="panel-title">
          <div className="eyebrow">Paragraph{paragraph?.section ? ` · ${paragraph.section}` : ""}</div>
          {paragraph && <p className="panel-snippet">{snippet(paragraph.text)}</p>}
        </div>
        <button type="button" className="icon-btn panel-close" onClick={onClose} aria-label="Close panel">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div role="tablist" className="tabs seg">
        <button
          type="button"
          role="tab"
          className={`seg-item${tab === "history" ? " active" : ""}`}
          aria-selected={tab === "history"}
          onClick={() => onTab("history")}
        >
          Through time
        </button>
        <button
          type="button"
          role="tab"
          className={`seg-item${tab === "languages" ? " active" : ""}`}
          aria-selected={tab === "languages"}
          onClick={() => onTab("languages")}
        >
          Across languages
        </button>
      </div>
      <div role="tabpanel" className="panel-body">
        {children}
      </div>
      <p className="panel-help">
        <Icon name="info" size={13} /> <Link to="/help">How to read badges and similarity</Link>
      </p>
    </aside>
  );
}

/** The first words of a paragraph, so the panel says which one it is about. */
function snippet(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= 12 ? text : `${words.slice(0, 12).join(" ")}…`;
}
