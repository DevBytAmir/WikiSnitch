import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { ArticleView, Lang, ReviewReasonCode, ReviewView } from "../api/types";
import { Async, useApi } from "../components/Async";
import { Badge } from "../components/Badge";
import { LANGUAGE_NAME } from "../components/CrossLangTab";
import { Icon } from "../components/Icon";
import { Eyebrow, LangTag, Meter } from "../components/ui";
import { formatSimilarity } from "../lib/format";

export const NO_HISTORY_REVIEW = "Review needs edit history, which this article does not have.";
const PREVIEW = 240;
const LANGS: readonly string[] = ["fi", "sv", "en"];

const REASON_LABEL: Record<ReviewReasonCode, string> = {
  meaning_changed_recently: "meaning changed",
  disputed: "disputed",
  unsourced: "no citation",
  differs_from_en: "differs from English",
  differs_from_sv: "differs from Swedish",
  numbers_changed_recently: "numbers changed",
};

export function ReviewPage() {
  const { lang, pageId } = useParams();
  const id = Number(pageId);
  const valid = lang !== undefined && LANGS.includes(lang) && Number.isInteger(id) && id > 0;
  const l = (valid ? lang : "fi") as Lang;

  const review = useApi(() => (valid ? api.review(l, id) : Promise.reject(new Error("bad address"))), [l, id]);
  // The article header gives the title and the counterpart page ids for "Missing here" links.
  const article = useApi(() => (valid ? api.article(l, id) : Promise.reject(new Error("bad address"))), [l, id]);

  if (!valid) return <p className="wrap empty-page">No such article address.</p>;
  const back = (
    <Link to={`/a/${l}/${id}`} className="backlink">
      <Icon name="arrow-left" size={13} /> Back to the article
    </Link>
  );
  if (review.state === "error" && review.error?.code === "no_history")
    return (
      <div className="wrap review">
        {back}
        <p className="empty-title">{NO_HISTORY_REVIEW}</p>
      </div>
    );
  return (
    <section className="wrap review">
      {back}
      <Eyebrow>For editors · review queue</Eyebrow>
      <h1 className="page-title">
        Review: {article.data ? <Link to={`/a/${l}/${id}`}>{article.data.article.title}</Link> : `${l}/${id}`}
      </h1>
      <p className="lead">
        Paragraphs whose history or other-language counterparts suggest a closer look, and text the Swedish and
        English articles have that this one may lack.
      </p>
      <Async state={review}>{(data) => <ReviewBody data={data} lang={l} pageId={id} header={article.data} />}</Async>
    </section>
  );
}

export function ReviewBody({
  data,
  lang,
  pageId,
  header,
}: {
  data: ReviewView;
  lang: Lang;
  pageId: number;
  header?: ArticleView;
}) {
  const counterpart = (l: Lang) => header?.article.languages.find((x) => x.lang === l);
  return (
    <div className="review-grid">
      <div className="min0">
        <div className="review-head">
          <h2>Needs attention</h2>
          <span className="count">{data.needs_attention.length}</span>
        </div>
        {data.needs_attention.length === 0 ? (
          <p className="empty-note">Nothing needs attention.</p>
        ) : (
          <ol className="review-list">
            {data.needs_attention.map(({ paragraph: p, reasons }) => (
              <li key={p.para_id} className={`review-item card review-${p.badge.level}`} data-para-id={p.para_id}>
                <div className="review-item-top">
                  <Badge badge={p.badge} showLabel />
                  {p.section && <span className="muted small">{p.section}</span>}
                </div>
                <p className="review-text">{p.text.length > PREVIEW ? `${p.text.slice(0, PREVIEW)}…` : p.text}</p>
                <ul className="reasons">
                  {reasons.map((r) => (
                    <li key={`${r.code}-${r.detail}`}>
                      <span className={`reason-code reason-${r.code}`}>{REASON_LABEL[r.code] ?? r.code}</span>{" "}
                      <span>{r.detail}</span>
                    </li>
                  ))}
                </ul>
                <Link to={`/a/${lang}/${pageId}?p=${p.para_id}`} className="more-link">
                  Open this paragraph
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="min0">
        <div className="review-head">
          <h2>Missing here</h2>
          <span className="count">{data.missing_here.length}</span>
        </div>
        {data.missing_here.length === 0 ? (
          <p className="empty-note">No coverage gaps found.</p>
        ) : (
          <ol className="review-list">
            {data.missing_here.map((m) => {
              const other = counterpart(m.lang);
              return (
                <li key={`${m.lang}-${m.para_id}`} className="review-item card missing-item">
                  <p className="caption">
                    <LangTag lang={m.lang} /> {LANGUAGE_NAME[m.lang]}
                    {m.section ? ` · ${m.section}` : ""}
                  </p>
                  <p className="review-text">{m.text}</p>
                  <p className="missing-sim">
                    <Meter value={m.nearest_similarity} tone="muted" />
                    <span className="muted">nearest similarity {formatSimilarity(m.nearest_similarity)}</span>
                  </p>
                  {other && (
                    <Link to={`/a/${m.lang}/${other.page_id}?p=${m.para_id}`} className="more-link">
                      Open in {other.title}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
