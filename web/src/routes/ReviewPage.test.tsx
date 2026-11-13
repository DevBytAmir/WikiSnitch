import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { api, ApiFailure } from "../api/client";
import type { ArticleView, ReviewView } from "../api/types";
import review from "../../fixtures/review-fi-9001.json";
import article from "../../fixtures/article-fi-9001.json";
import { NO_HISTORY_REVIEW, ReviewPage } from "./ReviewPage";

// Each test sets its own implementation; see the note in ArticlePage.test.tsx about resets.
vi.mock("../api/client", async (orig) => {
  const real = await orig<typeof import("../api/client")>();
  return { ...real, api: { ...real.api, review: vi.fn(), article: vi.fn() } };
});
const REVIEW = review as ReviewView;

function show(r: () => Promise<ReviewView>) {
  vi.mocked(api.review).mockImplementation(r);
  vi.mocked(api.article).mockResolvedValue(article as ArticleView);
  render(
    <MemoryRouter initialEntries={["/a/fi/9001/review"]}>
      <Routes>
        <Route path="/a/:lang/:pageId/review" element={<ReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("order and reasons", async () => {
  show(async () => REVIEW);
  await screen.findByRole("heading", { name: "Needs attention" });
  const items = [...document.querySelectorAll(".review-item[data-para-id]")];
  expect(items.map((e) => e.getAttribute("data-para-id"))).toEqual(["2", "5", "1", "6"]);
  const first = items[0] as HTMLElement;
  expect(within(first).getByText("Changed April 2026")).toBeInTheDocument();
  for (const r of REVIEW.needs_attention[0].reasons) expect(within(first).getByText(r.detail)).toBeInTheDocument();
  expect(within(first).getByRole("link", { name: "Open this paragraph" })).toHaveAttribute("href", "/a/fi/9001?p=2");
  expect(await screen.findByRole("link", { name: "Testisota" })).toHaveAttribute("href", "/a/fi/9001");
});

test("long paragraph text is cut at 240 characters", async () => {
  const long = { ...REVIEW.needs_attention[0], paragraph: { ...REVIEW.needs_attention[0].paragraph, text: "a".repeat(300) } };
  show(async () => ({ ...REVIEW, needs_attention: [long] }));
  expect(await screen.findByText(`${"a".repeat(240)}…`)).toBeInTheDocument();
});

test("missing_here rendered", async () => {
  show(async () => REVIEW);
  const item = (await screen.findByText(REVIEW.missing_here[0].text)).closest("li") as HTMLElement;
  expect(item).toHaveTextContent("English");
  expect(item).toHaveTextContent("nearest similarity 0.12");
  expect(await within(item).findByRole("link", { name: "Open in Test War" })).toHaveAttribute("href", "/a/en/8001?p=2");
});

test("both empty states", async () => {
  show(async () => ({ needs_attention: [], missing_here: [], sql: [] }));
  expect(await screen.findByText("Nothing needs attention.")).toBeInTheDocument();
  expect(screen.getByText("No coverage gaps found.")).toBeInTheDocument();
});

test("409 message", async () => {
  show(async () => {
    throw new ApiFailure(409, "no_history", "No history.");
  });
  expect(await screen.findByText(NO_HISTORY_REVIEW)).toBeInTheDocument();
});
