// Fixture mode: maps a request to one of the JSON files in web/fixtures/.
// The files are real responses of the API, exported by `python -m api.export_fixtures`, so the
// web app can be built and tested without the API running.

export interface FixtureRequest {
  path: string; // after the /api base, e.g. "/articles/fi/9001"
  params: URLSearchParams;
  body?: { question?: string; as_of?: string | null; lang?: string | null };
}

// Either a fixture file (name without ".json") or an inline error body for
// cases that have no exported file.
export type FixtureHit =
  | { file: string; status: number }
  | { status: number; inline: { error: { code: string; message: string } } };

const ok = (file: string): FixtureHit => ({ file, status: 200 });
const err = (status: 404 | 409 | 503): FixtureHit => ({ file: `error-${status}`, status });

const HISTORY_ARTICLES = new Set(["fi/9001", "fi/9002"]);
const KNOWN_ARTICLES = new Set(["fi/9001", "fi/9002", "fi/9003", "en/8001", "sv/7001", "en/8003"]);

export function fixtureFor(req: FixtureRequest): FixtureHit {
  const p = req.path.split("/").filter(Boolean);
  const asOf = req.params.get("as_of");

  if (p[0] === "health") return ok("health");
  if (p[0] === "ask") return askFixture(req.body ?? {});

  if (p[0] === "articles") {
    if (p.length === 1) return ok("articles");
    const key = `${p[1]}/${p[2]}`;
    if (!KNOWN_ARTICLES.has(key)) return err(404);
    const sub = p[3];
    if (sub === undefined) {
      if (key === "fi/9001") return asOf !== null && asOf < "2007" ? ok("article-fi-9001-asof-2006") : ok("article-fi-9001");
      if (key === "fi/9003" || key === "en/8001") return ok(`article-${p[1]}-${p[2]}`);
      return err(404);
    }
    if (!HISTORY_ARTICLES.has(key)) return err(409);
    if (key === "fi/9001" && (sub === "timeline" || sub === "review")) return ok(`${sub}-fi-9001`);
    return err(404);
  }

  if (p[0] === "paragraphs") {
    const key = `${p[1]}/${p[2]}`;
    const name = `${p[4]}-${p[1]}-${p[2]}-${p[3]}`;
    if (p[4] === "history") {
      if (!KNOWN_ARTICLES.has(key)) return err(404);
      if (!HISTORY_ARTICLES.has(key)) return err(409);
      return HISTORY_FILES.has(name) ? ok(name) : err(404);
    }
    if (p[4] === "crosslang") return CROSSLANG_FILES.has(name) ? ok(name) : err(404);
  }
  return err(404);
}

const HISTORY_FILES = new Set(["history-fi-9001-1", "history-fi-9001-2", "history-fi-9001-3", "history-fi-9001-5"]);
const CROSSLANG_FILES = new Set(["crosslang-fi-9001-1", "crosslang-fi-9001-4", "crosslang-fi-9002-1"]);

// In fixture mode a question can pick a mode by its first word, so every
// variant can be seen in the browser: "#extractive", "#no-answer", "#down".
function askFixture(body: NonNullable<FixtureRequest["body"]>): FixtureHit {
  const q = (body.question ?? "").trim();
  if (q === "" || q.length > 500)
    return { status: 422, inline: { error: { code: "empty_question", message: "Enter a question of up to 500 characters." } } };
  if (q.startsWith("#down")) return err(503);
  if (q.startsWith("#extractive")) return ok("ask-extractive");
  if (q.startsWith("#no-answer")) return ok("ask-no-answer");
  if (body.as_of) return ok("ask-asof-2012");
  return ok("ask-generated");
}
