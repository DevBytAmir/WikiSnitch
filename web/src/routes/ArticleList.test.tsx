import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, ApiFailure } from "../api/client";
import type { ArticleList as ArticleListData } from "../api/types";
import { ArticleList, SEARCH_DEBOUNCE_MS } from "./ArticleList";

vi.mock("../api/client", async (orig) => {
  const real = await orig<typeof import("../api/client")>();
  return { ...real, api: { ...real.api, articles: vi.fn() } };
});
const articles = vi.mocked(api.articles);

const DATA: ArticleListData = {
  articles: [
    { lang: "fi", page_id: 9001, title: "Testisota", wikidata_id: "Q9001", has_history: true, versions: 16,
      languages: [{ lang: "en", page_id: 8001, title: "Test War" }, { lang: "sv", page_id: 7001, title: "Testkriget" }] },
    { lang: "fi", page_id: 9003, title: "Ilman historiaa", wikidata_id: "Q9003", has_history: false, versions: null,
      languages: [] },
  ],
  sql: [],
};

const show = () => render(<MemoryRouter><ArticleList /></MemoryRouter>);

beforeEach(() => articles.mockReset());
afterEach(() => vi.useRealTimers());

test("renders history articles with version counts", async () => {
  articles.mockResolvedValue(DATA);
  show();
  const row = (await screen.findByRole("link", { name: "Testisota" })).closest("li")!;
  expect(row).toHaveTextContent("history: 16 versions");
  expect(row).toHaveTextContent("EN");
  expect(row).toHaveTextContent("SV");
  expect(screen.getByRole("link", { name: "Testisota" })).toHaveAttribute("href", "/a/fi/9001");
  expect(screen.getByRole("link", { name: "Ilman historiaa" }).closest("li")).toHaveTextContent("no history");
});

test("typing searches after the debounce", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  articles.mockResolvedValue(DATA);
  show();
  await screen.findByRole("link", { name: "Testisota" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search articles" }), { target: { value: "Test" } });
  await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50));
  expect(articles).not.toHaveBeenCalledWith("Test");
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(articles.mock.calls.filter((c) => c[0] === "Test")).toHaveLength(1);
});

test("empty state", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  articles.mockImplementation(async (q?: string) => (q === "zzz" ? { articles: [], sql: [] } : DATA));
  show();
  fireEvent.change(screen.getByRole("searchbox", { name: "Search articles" }), { target: { value: "zzz" } });
  await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS));
  expect(await screen.findByText('No articles match "zzz".')).toBeInTheDocument();
});

test("error state has Retry", async () => {
  articles.mockRejectedValueOnce(new ApiFailure(503, "embedder_unavailable", "Down")).mockResolvedValue(DATA);
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("link", { name: "Testisota" })).toBeInTheDocument();
  expect(articles).toHaveBeenCalledTimes(2);
});

test("search and sort are kept in the URL", async () => {
  articles.mockResolvedValue(DATA);
  let url = "";
  function Url() {
    const l = useLocation();
    url = l.pathname + l.search;
    return null;
  }
  render(
    <MemoryRouter initialEntries={["/?q=Test&sort=az"]}>
      <ArticleList />
      <Url />
    </MemoryRouter>,
  );
  expect(screen.getByRole("searchbox", { name: "Search articles" })).toHaveValue("Test");
  expect(screen.getByRole("radio", { name: "A–Z" })).toHaveAttribute("aria-checked", "true");
  await screen.findByRole("link", { name: "Testisota" });
  expect(articles).toHaveBeenCalledWith("Test");
  fireEvent.click(screen.getByRole("radio", { name: "Most edited" }));
  expect(url).toBe("/?q=Test&sort=versions");
  fireEvent.click(screen.getByRole("radio", { name: "History first" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search articles" }), { target: { value: "" } });
  expect(url).toBe("/");
});
