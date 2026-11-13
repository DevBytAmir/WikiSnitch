import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { api, ApiFailure } from "../api/client";
import type { ArticleView, Badge, ParagraphSummary } from "../api/types";
import { ArticlePage } from "./ArticlePage";

vi.mock("../api/client", async (orig) => {
  const real = await orig<typeof import("../api/client")>();
  return { ...real, api: { ...real.api, article: vi.fn(), history: vi.fn(() => new Promise(() => {})), crosslang: vi.fn(() => new Promise(() => {})), timeline: vi.fn(() => new Promise(() => {})) } };
});
// Each test sets its own implementation. No beforeEach reset: with vitest 2.1, mockReset or
// mockClear before a rejecting mock makes the not_yet_created test fail although it renders right.
const article = vi.mocked(api.article);

const STABLE: Badge = { level: "stable", label: "Stable since 2015", reasons: ["No citations"] };
const DISPUTED: Badge = { level: "disputed", label: "Disputed", reasons: ["2 edits by named users were undone"] };
const para = (para_id: number, text: string, badge: Badge = STABLE): ParagraphSummary => ({
  para_id, section: null, text, kind: "p", citations: 0, has_history: true, badge,
});

function view(over: Partial<ArticleView["article"]> = {}, blocks?: ArticleView["blocks"]): ArticleView {
  return {
    article: {
      lang: "fi", page_id: 9001, title: "Testisota", wikidata_id: "Q9001", rev_id: 116,
      as_of: "2026-10-01T00:00:00Z", saved_at: "2026-09-02T00:00:00Z", saved_by: "Aino",
      wikipedia_url: "https://fi.wikipedia.org/?oldid=116", has_history: true,
      first_version: "2005-03-01T10:00:00Z", languages: [{ lang: "en", page_id: 8001, title: "Test War" }],
      ...over,
    },
    blocks: blocks ?? [
      { type: "paragraph", paragraph: para(5, "Viides kappale muistotilaisuuksista.", DISPUTED) },
      { type: "heading", text: "Tausta" },
      { type: "paragraph", paragraph: para(1, "Ensimmäinen kappale sodan alusta.") },
    ],
    sql: [],
  };
}

let location = "";
function Spy() {
  const l = useLocation();
  location = l.pathname + l.search;
  return null;
}
const show = (url = "/a/fi/9001") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/a/:lang/:pageId" element={<><ArticlePage /><Spy /></>} />
      </Routes>
    </MemoryRouter>,
  );
const paraEl = (id: number) => document.querySelector(`[data-para-id="${id}"]`) as HTMLElement;

afterEach(() => vi.useRealTimers());

test("renders blocks in order with badges", async () => {
  article.mockResolvedValue(view());
  show();
  await screen.findByRole("heading", { name: "Testisota" });
  const order = [...document.querySelectorAll("[data-para-id], h2")].map((e) => e.getAttribute("data-para-id") ?? e.textContent);
  expect(order).toEqual(["5", "Tausta", "1"]);
  expect(within(paraEl(5)).getByText("Disputed")).toBeInTheDocument();
  expect(within(paraEl(1)).getByText("Stable since 2015")).toBeInTheDocument();
});

test("click selects and opens the panel", async () => {
  article.mockResolvedValue(view());
  show();
  fireEvent.click(await screen.findByText("Ensimmäinen kappale sodan alusta."));
  expect(location).toContain("p=1");
  const panel = screen.getByRole("complementary", { name: "Paragraph insight" });
  expect(within(panel).getByRole("tab", { name: "Through time" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(within(panel).getByRole("tab", { name: "Across languages" }));
  expect(location).toContain("tab=languages");
});

test("Enter selects, Escape closes", async () => {
  article.mockResolvedValue(view());
  show();
  await screen.findByRole("heading", { name: "Testisota" });
  fireEvent.keyDown(paraEl(5), { key: "Enter" });
  expect(location).toContain("p=5");
  expect(screen.getByRole("complementary")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(location).not.toContain("p=");
  expect(screen.queryByRole("complementary")).toBeNull();
});

test("as_of change reloads with the date in the URL", async () => {
  article.mockResolvedValue(view());
  show();
  fireEvent.change(await screen.findByLabelText("As of date"), { target: { value: "2006-06-01" } });
  expect(location).toContain("as_of=2006-06-01");
  await vi.waitFor(() => expect(article).toHaveBeenLastCalledWith("fi", 9001, "2006-06-01"));
});

test("script tag in text is shown as text", async () => {
  const evil = '<script>alert(1)</script> <a href="javascript:alert(2)">klikkaa</a>';
  article.mockResolvedValue(view({}, [{ type: "paragraph", paragraph: para(1, evil) }]));
  show();
  expect(await screen.findByText(evil)).toBeInTheDocument();
  const body = document.querySelector("article")!;
  expect(body.querySelector("script")).toBeNull();
  expect(body.querySelector('a[href^="javascript"]')).toBeNull();
});

test("missing paragraph message", async () => {
  article.mockResolvedValue(view({ as_of: "2006-06-01T00:00:00Z" }));
  show("/a/fi/9001?as_of=2006-06-01&p=7");
  const panel = await screen.findByRole("complementary");
  expect(panel).toHaveTextContent("This paragraph does not exist in the version of 1 Jun 2006.");
  fireEvent.click(within(panel).getByRole("link", { name: "Show the current version" }));
  expect(location).not.toContain("as_of");
  expect(location).toContain("p=7");
});

test("empty page message", async () => {
  article.mockResolvedValue(view({ as_of: "2010-02-02T00:05:00Z" }, []));
  show("/a/fi/9001?as_of=2010-02-02");
  expect(await screen.findByText("The page was empty on 2 Feb 2010.")).toBeInTheDocument();
});

test("date input disabled without history", async () => {
  article.mockResolvedValue(view({ has_history: false, first_version: null, rev_id: null }));
  show();
  expect(await screen.findByLabelText("As of date")).toBeDisabled();
  expect(screen.getByText("No history for this article")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Review" })).toBeNull();
});

test('404 not_yet_created shows "This article did not exist yet on {date}."', async () => {
  article.mockImplementation(async () => {
    throw new ApiFailure(404, "not_yet_created", "Not yet.");
  });
  show("/a/fi/9001?as_of=2001-01-01");
  expect(await screen.findByText("This article did not exist yet on 1 Jan 2001.")).toBeInTheDocument();
});
