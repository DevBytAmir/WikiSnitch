import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BadgeLevel } from "../api/types";
import { BADGE_META, BADGE_ORDER, BadgeDot } from "./Badge";
import { Icon, type IconName } from "./Icon";
import { Meter } from "./ui";

const SECTIONS = [
  ["features", "What you can do"],
  ["badges", "Badges"],
  ["similarity", "Similarity"],
  ["undone", "Undone edits"],
  ["data", "Where the data comes from"],
] as const;

/** How WikiSnitch works: what each feature does, then the four things needed to read what is shown (badges, similarity, undone edits and the data), with a few small illustrations. */
export function Help() {
  return (
    <div className="help wrap-narrow">
      <h1 className="help-title">How to read WikiSnitch</h1>
      <p className="lead">
        WikiSnitch shows how Wikipedia articles change over time and what the other language versions say. This page
        lists what you can do, then explains the four things you need to read what you see.
      </p>

      <nav aria-label="Contents" className="toc">
        <div className="toc-title">Contents</div>
        <ol>
          {SECTIONS.map(([id, label], i) => (
            <li key={id}>
              <a
                href={`#${id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth" });
                }}
              >
                <span className="toc-n">{i + 1}</span>
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <ol className="help-points">
        <Point id="features" title="What you can do">
          <FeatureList />
          <p className="muted small">
            The time machine, Compare, Through time and Review need edit history, which only the Finnish history set
            has.
          </p>
        </Point>
        <Point id="badges" title="Badges">
          <p>
            Each paragraph has a badge, worked out from its edit history. The first rule that fits wins.{" "}
            <strong>Disputed</strong>: in the last 24 months, edits to it by two or more named users were undone.{" "}
            <strong>New</strong>: it first appeared less than six months ago. <strong>Changed recently</strong>: its
            meaning or one of its numbers changed in the last twelve months. <strong>Stable</strong>: none of these;
            the label gives the year of its last real change. <strong>Unknown</strong>: there is no edit history for
            this text, which is the case for all Swedish and English text and for Finnish articles outside the
            history set.
          </p>
          <BadgeTable />
          <RuleSimulator />
        </Point>
        <Point id="similarity" title="Similarity">
          <p>
            Similarity measures how close two texts are in meaning. It does not say whether either text is right. It
            reacts only weakly when a number changes or a "not" is added, so number changes are checked and flagged
            separately.
          </p>
          <SimilarityExample />
        </Point>
        <Point id="undone" title="Undone edits">
          <p>
            Edits that were undone, such as vandalism and its revert, are shown in the history but left out of every
            figure, chart and badge.
          </p>
          <UndoneExample />
        </Point>
        <Point id="data" title="Where the data comes from">
          <p>
            The text comes from Wikipedia through MariaDB's Wikipedia datasets. Finnish articles in the history set
            have every version up to 1 October 2026. Swedish and English text, and other Finnish articles, are the
            current text as of August 2025, without history.
          </p>
          <div className="wikitable-wrap">
            <table className="wikitable">
              <thead>
                <tr>
                  <th>Text</th>
                  <th>Covers</th>
                  <th>Badges</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Finnish history set</b>
                  </td>
                  <td>Every version up to 1 Oct 2026</td>
                  <td>All badges</td>
                </tr>
                <tr>
                  <td>
                    <b>Other Finnish articles</b>
                  </td>
                  <td>Text as of August 2025</td>
                  <td>Unknown</td>
                </tr>
                <tr>
                  <td>
                    <b>Swedish and English</b>
                  </td>
                  <td>Text as of August 2025</td>
                  <td>Unknown</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Text from Wikipedia is shared under{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="license noreferrer">
              CC BY-SA 4.0
            </a>
            . Every article page links to the version it shows.{" "}
            <Link to="/">Browse the articles</Link> or <Link to="/ask">ask a question</Link>.
          </p>
        </Point>
      </ol>
    </div>
  );
}

function Point({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <li id={id} className="help-point">
      <h2>{title}</h2>
      {children}
    </li>
  );
}

const FEATURES: { icon: IconName; name: string; how: ReactNode }[] = [
  { icon: "file-text", name: "Read", how: "Open an article and select any paragraph. A panel opens beside it." },
  {
    icon: "list-tree",
    name: "Through time",
    how: "A panel tab: every version of the paragraph, when its meaning or a number changed, and which edits were undone.",
  },
  {
    icon: "book-open",
    name: "Across languages",
    how: "A panel tab: the closest paragraph in the Swedish and English articles, how close it is, and any numbers that differ.",
  },
  {
    icon: "chart-area",
    name: "Time machine",
    how: (
      <>
        Play the history (<kbd>Space</kbd>), step between changes (<kbd>←</kbd> <kbd>→</kbd>), or pick a date to
        read the page as it was then.
      </>
    ),
  },
  {
    icon: "git-compare",
    name: "Compare",
    how: (
      <>
        Switch the time machine to Compare and pick two dates, or a preset such as “First vs latest”. Each paragraph
        is marked <span className="status-chip status-added">Added</span>{" "}
        <span className="status-chip status-removed">Removed</span> or{" "}
        <span className="status-chip status-changed">Rewritten</span>, and changed numbers show as{" "}
        <span className="number-chip"># 1939 → 1940</span>.
      </>
    ),
  },
  {
    icon: "scan-eye",
    name: "Ask",
    how: "Ask in Finnish, Swedish or English. The answer cites paragraphs, each with its badge. Add a date to ask Wikipedia as it stood then.",
  },
  {
    icon: "list-checks",
    name: "Review",
    how: "For editors, from an article's Review button: paragraphs worth a closer look, and text the other languages have that this one may lack.",
  },
  {
    icon: "arrow-up-right",
    name: "Get data",
    how: "Download the version shown as JSON or the edits per month as CSV, or copy a link to the exact view.",
  },
  {
    icon: "code-xml",
    name: "Show SQL",
    how: "The button at the bottom right lists the MariaDB queries behind what you see, ready to copy.",
  },
];

function FeatureList() {
  return (
    <dl className="features">
      {FEATURES.map((f) => (
        <div key={f.name} className="feature">
          <dt>
            <Icon name={f.icon} size={15} /> {f.name}
          </dt>
          <dd>{f.how}</dd>
        </div>
      ))}
    </dl>
  );
}

function BadgeTable() {
  return (
    <div className="wikitable-wrap">
      <table className="wikitable">
        <thead>
          <tr>
            <th>Badge</th>
            <th>Rule, first match wins</th>
          </tr>
        </thead>
        <tbody>
          {BADGE_ORDER.map((l) => (
            <tr key={l}>
              <td className="nowrap">
                <span className={`badge-name tone-${l}`}>
                  <BadgeDot level={l} /> {BADGE_META[l].name}
                </span>
              </td>
              <td>{BADGE_META[l].rule}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tick what is true for a paragraph and see which rule wins. */
function RuleSimulator() {
  const [history, setHistory] = useState(true);
  const [war, setWar] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [changed, setChanged] = useState(true);
  const result: BadgeLevel = !history ? "unknown" : war ? "disputed" : fresh ? "new" : changed ? "changed_recently" : "stable";
  const qs: { label: string; v: boolean; set: (v: boolean) => void; off?: boolean }[] = [
    { label: "It has edit history", v: history, set: setHistory },
    { label: "Edits by two or more named users were undone in the last 24 months", v: war, set: setWar, off: !history },
    { label: "It first appeared less than six months ago", v: fresh, set: setFresh, off: !history },
    { label: "Its meaning or a number changed in the last twelve months", v: changed, set: setChanged, off: !history },
  ];
  return (
    <div className="simulator">
      <div className="simulator-form">
        <div className="simulator-title">Try it</div>
        <p className="muted small">Tick what is true for a paragraph and see its badge.</p>
        <ul>
          {qs.map((q) => (
            <li key={q.label}>
              <label className={q.off ? "is-off" : undefined}>
                <input type="checkbox" checked={q.v} disabled={q.off} onChange={() => q.set(!q.v)} /> {q.label}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="simulator-result" aria-live="polite">
        <span className={`dot-big dot-${result}`} aria-hidden="true">
          {BADGE_META[result].glyph}
        </span>
        <span className={`simulator-name tone-${result}`}>{BADGE_META[result].name}</span>
      </div>
    </div>
  );
}

const BASE = "Kansainliitto ratkaisi asian vuonna 1921 Suomen eduksi.";
const VARIANTS = [
  { id: "reword", label: "Reworded", text: "Vuonna 1921 Kansainliitto päätti kiistan Suomen hyväksi.", sim: 0.91, note: "Same meaning, new words: a high score." },
  {
    id: "number",
    label: "Number changed",
    text: "Kansainliitto ratkaisi asian vuonna 1920 Suomen eduksi.",
    sim: 0.98,
    note: "The score barely moves, so number changes get their own flag.",
    flag: "1921 → 1920",
  },
  { id: "not", label: "“Not” added", text: "Kansainliitto ei ratkaissut asiaa vuonna 1921 Suomen eduksi.", sim: 0.94, note: "The meaning flipped, but the score stayed high." },
  { id: "other", label: "Unrelated", text: "Hakkapeliitat tunnettiin nopeista hyökkäyksistään.", sim: 0.17, note: "A different topic: a low score." },
];

function SimilarityExample() {
  const [id, setId] = useState("number");
  const v = VARIANTS.find((x) => x.id === id) ?? VARIANTS[0];
  return (
    <div className="example">
      <div className="example-tabs" role="group" aria-label="Example change">
        {VARIANTS.map((x) => (
          <button key={x.id} type="button" aria-pressed={x.id === id} className={`btn btn-xs${x.id === id ? " btn-primary" : ""}`} onClick={() => setId(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="example-grid">
        <div className="example-text">
          <div className="example-label">Text A</div>
          <p>{BASE}</p>
        </div>
        <div className="example-text">
          <div className="example-label">Text B</div>
          <p key={v.id} className="fade">
            {v.text}
          </p>
        </div>
        <div className="example-score">
          <div className="example-label">Similarity of meaning</div>
          <div className="example-value">{v.sim.toFixed(2)}</div>
          <Meter value={v.sim} />
          {v.flag && <span className="number-chip"># {v.flag}</span>}
        </div>
      </div>
      <p className="example-note">
        {v.note} <span className="muted small">(Illustrative values.)</span>
      </p>
    </div>
  );
}

function UndoneExample() {
  return (
    <div className="example example-undone">
      <div>
        <div className="example-label">Edit history</div>
        <ol className="mini-history">
          <li>
            <span className="mini-dot mini-add" aria-hidden="true" /> An editor added a paragraph
          </li>
          <li>
            <span className="mini-dot mini-undone" aria-hidden="true" />
            <s>Someone replaced a sentence with nonsense</s> <span className="chip chip-disputed">undone</span>
          </li>
          <li className="muted">
            <Icon name="undo-2" size={12} className="tone-disputed" /> Reverted a few minutes later
          </li>
          <li>
            <span className="mini-dot mini-numbers" aria-hidden="true" /> Another editor fixed a year: 1920 → 1921
          </li>
        </ol>
      </div>
      <div>
        <div className="example-label">What the figures count</div>
        <svg viewBox="0 0 300 90" className="mini-chart" role="img" aria-label="The chart skips the undone edit">
          <path d="M0,70 H90 V40 H300" className="mini-line" />
          <path d="M140,40 V12 H150 V40" className="mini-ignored" />
          <text x="156" y="18" className="mini-ignored-text">
            ignored
          </text>
          <line x1="0" x2="300" y1="80" y2="80" className="mini-axis" />
        </svg>
        <p className="small">Two real changes are counted. The vandalism and its revert are not.</p>
      </div>
    </div>
  );
}
