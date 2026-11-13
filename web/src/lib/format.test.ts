import { expect, test } from "vitest";
import { formatDate, formatSimilarity, safeWikipediaUrl } from "./format";

test("formatDate, formatSimilarity", () => {
  expect(formatDate("2026-04-02T00:00:00Z")).toBe("2 Apr 2026");
  expect(formatDate("2008-08-08T08:08:08.000001Z")).toBe("8 Aug 2008");
  expect(formatDate(null)).toBe("now");
  expect(formatSimilarity(0.834)).toBe("0.83");
  expect(formatSimilarity(null)).toBe("–");
});

test("safeWikipediaUrl", () => {
  expect(safeWikipediaUrl("https://fi.wikipedia.org/?oldid=1")).not.toBeNull();
  for (const bad of [
    "javascript:alert(1)",
    "http://fi.wikipedia.org/x",
    "https://evil.example/wikipedia.org",
    "https://wikipedia.org.evil.example/",
    "https://user@fi.wikipedia.org.evil.example/",
  ])
    expect(safeWikipediaUrl(bad)).toBeNull();
});
