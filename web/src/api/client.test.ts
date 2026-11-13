import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, ApiFailure, lastSql, onSql, TIMEOUT_MS } from "./client";

function mockFetch(status: number, body: unknown, raw = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(raw ? String(body) : JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fixture mode", () => {
  beforeEach(() => vi.stubEnv("VITE_FIXTURES", "1"));

  test("fixture mode returns the article fixture", async () => {
    const a = await api.article("fi", 9001);
    expect(
      a.blocks.flatMap((b) => (b.type === "paragraph" ? [b.paragraph.para_id] : [])),
    ).toEqual([5, 1, 2, 4, 6, 7]);
  });

  test("fixture errors become ApiFailure", async () => {
    await expect(api.history("fi", 9003, 1)).rejects.toMatchObject({ status: 409, code: "no_history" });
    await expect(api.ask("   ")).rejects.toMatchObject({ status: 422, code: "empty_question" });
  });

  test("sql of the last response is recorded", async () => {
    const seen: number[] = [];
    const off = onSql((s) => seen.push(s.length));
    const a = await api.article("fi", 9001);
    off();
    expect(lastSql).toEqual(a.sql);
    expect(seen).toEqual([a.sql.length]);
  });
});

describe("network mode", () => {
  beforeEach(() => vi.stubEnv("VITE_FIXTURES", ""));

  test("error body becomes ApiFailure", async () => {
    mockFetch(404, { error: { code: "not_found", message: "No article." } });
    await expect(api.article("fi", 1)).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  test("network failure and timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(api.health()).rejects.toMatchObject({ status: 0, code: "network" });

    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const pending = api.health();
    const check = expect(pending).rejects.toMatchObject({ status: 0, code: "timeout" });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await check;
  });

  test("non-JSON error body", async () => {
    mockFetch(502, "<html>Bad gateway</html>", true);
    const e = await api.health().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect(e).toMatchObject({ status: 502, code: "bad_response" });
  });

  test("query parameters and the POST body", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ sql: [] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await api.article("fi", 9001, "2015-06-01");
    await api.ask("Milloin?", undefined, "fi");
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("http://localhost:8000/api/articles/fi/9001?as_of=2015-06-01");
    expect(calls[1][1].method).toBe("POST");
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ question: "Milloin?", as_of: null, lang: "fi" });
  });
});

describe("fixture search", () => {
  beforeEach(() => vi.stubEnv("VITE_FIXTURES", "1"));
  test("articles fixture is filtered by title", async () => {
    expect((await api.articles("test")).articles.map((a) => a.title)).toEqual(["Testisota", "Test War", "Testkriget"]);
    expect((await api.articles("zzz")).articles).toEqual([]);
  });
});
