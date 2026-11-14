import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ArticleHeader, ParagraphSummary, TimelineView } from "../api/types";
import { countWords, dayAfter, formatDate, formatMonth, formatNumber, plural } from "../lib/format";
import { BadgeMix, countBadges } from "./Badge";
import { LANGUAGE_NAME } from "./CrossLangTab";
import { Icon, type IconName } from "./Icon";
import { lastDayOf } from "./Timeline";
import { Eyebrow, LangTag } from "./ui";

/** Beside the article while no paragraph is selected: the version in numbers, history highlights, other languages. */
export function SideRail({
  article: a,
  paragraphs,
  timeline,
  onPick,
}: {
  article: ArticleHeader;
  paragraphs: ParagraphSummary[];
  timeline: TimelineView | null | undefined;
  onPick: (day: string) => void;
}) {
  const words = paragraphs.reduce((n, p) => n + countWords(p.text), 0);
  const counts = countBadges(paragraphs.map((p) => p.badge.level));
  const months = timeline?.months ?? [];
  const busiest = months.reduce<(typeof months)[number] | undefined>((b, m) => (!b || m.edits > b.edits ? m : b), undefined);
  const fought = months.reduce<(typeof months)[number] | undefined>((b, m) => (m.reverts > (b?.reverts ?? 0) ? m : b), undefined);

  return (
    <div className="rail">
      <div className="card rail-card">
        <Eyebrow>At this version</Eyebrow>
        <div className="rail-stats">
          <div>
            <div className="stat-big">{formatNumber(words)}</div>
            <div className="stat-label">words</div>
          </div>
          <div>
            <div className="stat-big">{formatNumber(paragraphs.length)}</div>
            <div className="stat-label">paragraphs</div>
          </div>
        </div>
        <BadgeMix counts={counts} />
        {a.saved_at && (
          <div className="rail-foot">
            Saved {formatDate(a.saved_at)}
            {a.saved_by ? (
              <>
                {" "}
                by <b>{a.saved_by}</b>
              </>
            ) : null}
          </div>
        )}
      </div>

      {timeline && (
        <div className="card rail-card">
          <Eyebrow>Whole history</Eyebrow>
          <ul className="insights">
            <Insight
              icon="file-text"
              title="First version"
              main={formatDate(timeline.totals.first)}
              meta={`${plural(timeline.totals.versions, "version")} since`}
              onClick={() => onPick(dayAfter(timeline.totals.first))}
            />
            {busiest && (
              <Insight
                icon="layers"
                title="Busiest month"
                main={formatMonth(busiest.month)}
                meta={plural(busiest.edits, "edit")}
                onClick={() => onPick(lastDayOf(busiest.month))}
              />
            )}
            {fought && (
              <Insight
                icon="undo-2"
                title="Most reverts in a month"
                main={formatMonth(fought.month)}
                meta={plural(fought.reverts, "revert")}
                onClick={() => onPick(lastDayOf(fought.month))}
              />
            )}
          </ul>
        </div>
      )}

      {a.languages.length > 0 && (
        <div className="card rail-card">
          <Eyebrow>Same topic, other languages</Eyebrow>
          <ul className="rail-langs">
            {a.languages.map((l) => (
              <li key={`${l.lang}-${l.page_id}`}>
                <LangTag lang={l.lang} />
                <Link to={`/a/${l.lang}/${l.page_id}`}>{l.title}</Link>
                <span className="muted small">{LANGUAGE_NAME[l.lang]}</span>
              </li>
            ))}
          </ul>
          <p className="rail-note">Select a paragraph and open “Across languages” to see what the other articles say about it.</p>
        </div>
      )}

      {a.has_history && (
        <div className="card rail-card">
          <Eyebrow>For editors</Eyebrow>
          <p className="rail-text">
            Paragraphs that need attention, and text the other languages have that this article lacks.
          </p>
          <Link to={`/a/${a.lang}/${a.page_id}/review`} className="btn btn-sm">
            <Icon name="list-checks" size={14} /> Open the review queue
          </Link>
        </div>
      )}
    </div>
  );
}

function Insight({ icon, title, main, meta, onClick }: { icon: IconName; title: string; main: ReactNode; meta: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="insight" onClick={onClick}>
        <span className="insight-icon" aria-hidden="true">
          <Icon name={icon} size={14} />
        </span>
        <span className="insight-body">
          <span className="insight-title">{title}</span>
          <span className="insight-main">{main}</span>
        </span>
        <span className="insight-meta">{meta}</span>
      </button>
    </li>
  );
}
