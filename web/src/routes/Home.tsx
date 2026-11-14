import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useApi } from "../components/Async";
import { Icon } from "../components/Icon";
import { SealMoon } from "../components/SealMoon";
import { Eyebrow } from "../components/ui";
import { formatNumber } from "../lib/format";
import { ArticleList } from "./ArticleList";

/** Landing page: what WikiSnitch is, the dataset in numbers, and the article list. */
export function Home() {
  // The figures are a bonus: if health fails, the hero simply goes without them.
  const health = useApi(() => api.health(), []);
  const counts = health.data?.counts;

  return (
    <div className="home">
      <section className="hero wrap">
        <div className="hero-copy rise">
          <Eyebrow>Wikipedia, with a memory</Eyebrow>
          <h1 className="hero-title">
            Watch Wikipedia evolve through time.
          </h1>
          <p className="hero-lead">
            WikiSnitch keeps the edit history of Finnish Wikipedia articles. See which paragraphs are settled and
            which are fought over, replay how a page changed, compare a claim with the Swedish and English articles,
            and ask questions that are answered only from cited paragraphs.
          </p>
          <div className="hero-actions">
            <a href="#articles" className="btn btn-primary btn-lg">
              <Icon name="book-open" size={16} /> Browse articles
            </a>
            <Link to="/ask" className="btn btn-lg">
              <Icon name="message" size={16} /> Ask the archive
            </Link>
          </div>
          {counts && (
            <dl className="hero-stats">
              <Stat value={formatNumber(counts.history_articles)} label="Finnish articles with every version kept" />
              <Stat value={formatNumber(counts.paragraph_states)} label="paragraph versions, undone edits included" />
              <Stat value={formatNumber(counts.articles)} label="articles in Finnish, Swedish and English" />
            </dl>
          )}
        </div>
        <SealMoon />
      </section>

      <section className="wrap" aria-label="How WikiSnitch works">
        <ol className="steps">
          <Step n={1} title="Pick an article">
            Every paragraph wears a badge worked out from its edit history, so settled facts and contested ones
            look different at a glance.
          </Step>
          <Step n={2} title="Travel through time">
            Pick any date or press play and the page is shown as it stood then. Compare two dates, or open one
            paragraph and see every version of it.
          </Step>
          <Step n={3} title="Ask, with receipts">
            Questions are answered from retrieved paragraphs only. Every answer cites its sources, each with its
            badge, and can be asked as of a past date.
          </Step>
        </ol>
      </section>

      <ArticleList />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="hero-stat-value">{value}</dd>
      <dd className="hero-stat-label">{label}</dd>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="step card">
      <div className="step-head">
        <span className="step-n" aria-hidden="true">
          {n}
        </span>
        <span className="step-title">{title}</span>
      </div>
      <p>{children}</p>
    </li>
  );
}
