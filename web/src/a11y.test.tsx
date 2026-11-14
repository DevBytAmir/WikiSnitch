import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, ApiFailure } from "./api/client";
import { App } from "./App";

// The whole app against the fixture files; one call is made to fail with 503 where needed.
vi.stubEnv("VITE_FIXTURES", "1");
afterEach(() => vi.restoreAllMocks());

const down = () => new ApiFailure(503, "embedder_unavailable", "The embedding service is not reachable.");
const show = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  );

describe("503 shows a message and Retry, and Retry refetches", () => {
  const areas: [string, string, keyof typeof api, RegExp, string][] = [
    ["list", "/", "articles", /The embedding service is not reachable/, "Testisota"],
    ["article", "/a/fi/9001", "article", /The embedding service is not reachable/, "Tausta"],
    ["panel tab", "/a/fi/9001?p=1", "history", /The embedding service is not reachable/, "Undone edits"],
    ["ask", "/ask?q=Milloin", "ask", /Search is unavailable right now/, "Citation 1"],
    ["review", "/a/fi/9001/review", "review", /The embedding service is not reachable/, "Needs attention"],
  ];
  test.each(areas)("%s", async (_name, url, fn, message, after) => {
    const spy = vi.spyOn(api, fn).mockImplementationOnce(async () => {
      throw down();
    });
    show(url);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    if (fn === "history") {
      // The rest of the page stays usable: the article is still there.
      expect(document.querySelectorAll("[data-para-id]").length).toBeGreaterThan(0);
      expect(within(screen.getByRole("complementary", { name: "Paragraph insight" })).getByRole("alert")).toBe(alert);
    }
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(
      await screen.findAllByText((_, el) => el?.textContent === after || el?.getAttribute("aria-label") === after),
    ).not.toHaveLength(0);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

test("tab order reaches every paragraph and the panel", async () => {
  const user = userEvent.setup();
  show("/a/fi/9001");
  await screen.findByRole("heading", { name: "Testisota" });
  const paraIds = [...document.querySelectorAll("[data-para-id]")].map((e) => e.getAttribute("data-para-id"));
  const reached = new Set<string>();
  for (let i = 0; i < 40 && reached.size < paraIds.length; i++) {
    await user.tab();
    const id = document.activeElement?.getAttribute("data-para-id");
    if (id) reached.add(id);
  }
  expect([...reached].sort()).toEqual([...paraIds].sort());

  await user.keyboard("{Enter}");
  const panel = await screen.findByRole("complementary", { name: "Paragraph insight" });
  expect(panel.contains(document.activeElement)).toBe(true);
  await user.tab();
  expect(panel.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("complementary", { name: "Paragraph insight" })).toBeNull();
});

test("every badge has visible text", async () => {
  show("/a/fi/9001?p=5");
  await screen.findByText("Undone edits");
  const badges = [...document.querySelectorAll(".badge")];
  expect(badges.length).toBeGreaterThan(6);
  for (const b of badges) {
    expect(b.querySelector(".badge-dot")?.textContent?.trim()).not.toBe("");
    expect(b.querySelector(".badge-label")?.textContent?.trim()).not.toBe("");
  }
});

test("no element uses dangerouslySetInnerHTML", () => {
  const sources = import.meta.glob<string>("./**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
  const files = Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path));
  expect(files.length).toBeGreaterThan(10);
  for (const [path, text] of files) {
    expect(text.includes("dangerouslySetInnerHTML"), path).toBe(false);
    expect(/\.innerHTML\s*=/.test(text), path).toBe(false);
  }
});
