import { useEffect, useRef, useState } from "react";
import type { ArticleView, TimelineView } from "../api/types";
import { downloadFile, fileSlug, toCsv } from "../lib/download";
import { formatDate, isoDay } from "../lib/format";
import { Icon } from "./Icon";

const LICENSE = "Text from Wikipedia, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)";

/** "Get data": the version shown as JSON, the monthly edit counts as CSV, a link to this view. */
export function DataMenu({ data, timeline }: { data: ArticleView; timeline: TimelineView | null | undefined }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const a = data.article;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const name = `${fileSlug(a.title)}-${a.lang}`;
  const saveText = () => {
    const body = {
      article: a.title,
      lang: a.lang,
      page_id: a.page_id,
      as_of: a.as_of,
      rev_id: a.rev_id,
      source: a.wikipedia_url,
      license: LICENSE,
      paragraphs: data.blocks.flatMap((b) =>
        b.type === "paragraph"
          ? [
              {
                para_id: b.paragraph.para_id,
                section: b.paragraph.section,
                kind: b.paragraph.kind,
                text: b.paragraph.text,
                citations: b.paragraph.citations,
                badge: b.paragraph.badge.level,
                badge_label: b.paragraph.badge.label,
              },
            ]
          : [],
      ),
    };
    downloadFile(`${name}-${isoDay(a.as_of)}.json`, JSON.stringify(body, null, 2), "application/json");
    setOpen(false);
  };
  const saveTimeline = () => {
    if (!timeline) return;
    const rows = [["month", "edits", "reverts", "reverts_of_anonymous"], ...timeline.months.map((m) => [m.month, m.edits, m.reverts, m.reverts_of_anonymous])];
    downloadFile(`${name}-edits-per-month.csv`, toCsv(rows), "text/csv");
    setOpen(false);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Icon name="download" size={15} /> Get data <Icon name="chevron-down" size={13} className={open ? "flip" : undefined} />
      </button>
      {open && (
        <div className="menu-pop">
          <button type="button" className="menu-item" onClick={saveText}>
            <span className="menu-kind">JSON</span>
            <span>
              <span className="menu-title">Text as of {formatDate(a.as_of)}</span>
              <span className="menu-sub">Paragraphs with their badges</span>
            </span>
          </button>
          {timeline && (
            <button type="button" className="menu-item" onClick={saveTimeline}>
              <span className="menu-kind">CSV</span>
              <span>
                <span className="menu-title">Edits per month</span>
                <span className="menu-sub">Edits and reverts for the whole history</span>
              </span>
            </button>
          )}
          <div className="menu-sep" />
          <button type="button" className="menu-item" onClick={copyLink}>
            <span className="menu-kind">
              <Icon name={copied ? "check" : "link"} size={13} />
            </span>
            <span className="menu-title">{copied ? "Link copied" : "Copy link to this view"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
