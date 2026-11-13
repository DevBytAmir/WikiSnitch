import { fixtureFor, type FixtureRequest } from "./fixtures";
import type {
  ArticleList,
  ArticleView,
  AskView,
  CrossLangView,
  Health,
  HistoryView,
  Lang,
  ReviewView,
  SqlStatement,
  TimelineView,
} from "./types";

export const TIMEOUT_MS = 30_000;

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8000/api";

function fixtureMode(): boolean {
  return import.meta.env.VITE_FIXTURES === "1";
}

// Statements of the most recent successful response (for "Show SQL").
export let lastSql: SqlStatement[] = [];
const sqlListeners = new Set<(sql: SqlStatement[]) => void>();

export function onSql(cb: (sql: SqlStatement[]) => void): () => void {
  sqlListeners.add(cb);
  return () => {
    sqlListeners.delete(cb);
  };
}

function record(body: unknown): void {
  if (typeof body === "object" && body !== null && "sql" in body && Array.isArray(body.sql)) {
    lastSql = body.sql as SqlStatement[];
    sqlListeners.forEach((cb) => cb(lastSql));
  }
}

function failureFrom(status: number, body: unknown): ApiFailure {
  if (typeof body === "object" && body !== null && "error" in body) {
    const e = body.error;
    if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
      return new ApiFailure(status, String(e.code), String(e.message));
    }
  }
  return new ApiFailure(status, "bad_response", `The server answered ${status} with an unexpected body.`);
}

// Fixture files are bundled lazily; only fixture mode ever loads them.
const fixtureFiles = import.meta.glob<{ default: unknown }>("../../fixtures/*.json");

async function fromFixture(req: FixtureRequest): Promise<unknown> {
  const hit = fixtureFor(req);
  let body: unknown;
  if ("inline" in hit) {
    body = hit.inline;
  } else {
    const load = fixtureFiles[`../../fixtures/${hit.file}.json`];
    if (!load) throw new ApiFailure(404, "not_found", `No fixture file ${hit.file}.json.`);
    body = (await load()).default;
  }
  if (hit.status >= 400) throw failureFrom(hit.status, body);
  const q = req.params.get("q")?.toLowerCase();
  if (req.path === "/articles" && q) {
    // The real API searches titles and then text. The fixture only filters titles by substring,
    // which is enough to try the search box.
    const list = body as ArticleList;
    return { ...list, articles: list.articles.filter((a) => a.title.toLowerCase().includes(q)) };
  }
  return body;
}

async function fromNetwork(path: string, params: URLSearchParams, post?: unknown): Promise<unknown> {
  const query = params.toString();
  const url = `${API_BASE}${path}${query ? `?${query}` : ""}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiFailure(0, "timeout", "The server did not answer within 30 seconds."));
    }, TIMEOUT_MS);
  });
  try {
    const request = (async () => {
      let res: Response;
      try {
        res = await fetch(url, {
          method: post === undefined ? "GET" : "POST",
          headers: post === undefined ? undefined : { "Content-Type": "application/json" },
          body: post === undefined ? undefined : JSON.stringify(post),
          signal: controller.signal,
        });
      } catch {
        throw new ApiFailure(0, "network", "Could not reach the server.");
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ApiFailure(res.status, "bad_response", `The server answered ${res.status} with a body that is not JSON.`);
      }
      if (!res.ok) throw failureFrom(res.status, body);
      return body;
    })();
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function call<T>(
  path: string,
  params: Record<string, string | undefined> = {},
  post?: FixtureRequest["body"],
  quiet = false,
): Promise<T> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") search.set(k, v);
  const body = fixtureMode() ? await fromFixture({ path, params: search, body: post }) : await fromNetwork(path, search, post);
  // Background requests stay out of "Show SQL", which shows the query behind what the user asked for.
  if (!quiet) record(body);
  return body as T;
}

export const api = {
  health: () => call<Health>("/health"),
  articles: (q?: string) => call<ArticleList>("/articles", { q }),
  article: (lang: Lang, pageId: number, asOf?: string) =>
    call<ArticleView>(`/articles/${lang}/${pageId}`, { as_of: asOf }),
  /** The article on a date, fetched in the background for the time machine: not recorded for "Show SQL". */
  articleVersion: (lang: Lang, pageId: number, asOf: string) =>
    call<ArticleView>(`/articles/${lang}/${pageId}`, { as_of: asOf }, undefined, true),
  timeline: (lang: Lang, pageId: number) => call<TimelineView>(`/articles/${lang}/${pageId}/timeline`),
  history: (lang: Lang, pageId: number, paraId: number) =>
    call<HistoryView>(`/paragraphs/${lang}/${pageId}/${paraId}/history`),
  crosslang: (lang: Lang, pageId: number, paraId: number, asOf?: string) =>
    call<CrossLangView>(`/paragraphs/${lang}/${pageId}/${paraId}/crosslang`, { as_of: asOf }),
  review: (lang: Lang, pageId: number) => call<ReviewView>(`/articles/${lang}/${pageId}/review`),
  ask: (question: string, asOf?: string, lang?: Lang) =>
    call<AskView>("/ask", {}, { question, as_of: asOf ?? null, lang: lang ?? null }),
};
