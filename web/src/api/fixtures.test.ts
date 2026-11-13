import { expect, test } from "vitest";

// Every fixture file that the contract test exports exists and has the envelope of the contract:
// data responses carry sql, errors only {error}.
const files = import.meta.glob<{ default: Record<string, unknown> }>("../../fixtures/*.json", { eager: true });
const NAMES = [
  "health", "articles", "article-fi-9001", "article-fi-9001-asof-2006", "article-fi-9003", "article-en-8001",
  "timeline-fi-9001", "history-fi-9001-1", "history-fi-9001-2", "history-fi-9001-3", "history-fi-9001-5",
  "crosslang-fi-9001-1", "crosslang-fi-9001-4", "crosslang-fi-9002-1", "review-fi-9001", "ask-generated",
  "ask-extractive", "ask-no-answer", "ask-asof-2012", "error-404", "error-409", "error-503",
];

test("every exported fixture exists with the contract envelope", () => {
  for (const name of NAMES) {
    const body = files[`../../fixtures/${name}.json`]?.default;
    expect(body, name).toBeDefined();
    if (name.startsWith("error-")) expect(Object.keys(body!), name).toEqual(["error"]);
    else if (name !== "health") expect(Array.isArray(body!.sql), name).toBe(true);
  }
  expect(Object.keys(files)).toHaveLength(NAMES.length);
});
