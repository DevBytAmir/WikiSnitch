import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { api, ApiFailure } from "../api/client";
import type { ArticleView } from "../api/types";
import before from "../../fixtures/article-fi-9001-asof-2006.json";
import after from "../../fixtures/article-fi-9001.json";
import { CompareView } from "./CompareView";

vi.mock("../api/client", async (orig) => {
  const real = await orig<typeof import("../api/client")>();
  return { ...real, api: { ...real.api, article: vi.fn() } };
});
const article = vi.mocked(api.article);

const show = (a: string, b: string, onSelect = vi.fn()) =>
  render(
    <MemoryRouter>
      <CompareView lang="fi" pageId={9001} a={a} b={b} selectedId={null} onSelect={onSelect} onParagraphs={() => {}} />
    </MemoryRouter>,
  );

test("lines up two versions by paragraph and marks what changed", async () => {
  article.mockImplementation(async (_l, _p, asOf?: string) => ((asOf ?? "") < "2007" ? before : after) as ArticleView);
  const onSelect = vi.fn();
  show("2026-10-01", "2006-06-01", onSelect); // dates in either order
  expect(await screen.findByText(/^Between 1 Jun 2006 and 1 Oct 2026, the article grew/)).toBeInTheDocument();
  expect(article).toHaveBeenCalledWith("fi", 9001, "2006-06-01");
  expect(article).toHaveBeenCalledWith("fi", 9001, "2026-10-01");
  const rewritten = document.querySelector('[data-cmp-para="1"]') as HTMLElement;
  expect(rewritten).toHaveClass("cmp-changed");
  expect(rewritten).toHaveTextContent("# 25 000 → 70 000");
  expect(rewritten.querySelector("del")).toHaveTextContent("25");
  expect(rewritten.querySelector("ins")).toHaveTextContent("70");
  expect(document.querySelectorAll(".cmp-added").length).toBeGreaterThan(0);
  fireEvent.click(rewritten);
  expect(onSelect).toHaveBeenCalledWith(1);
});

test("an article that did not exist yet on the first date counts as empty", async () => {
  article.mockImplementation(async (_l, _p, asOf?: string) => {
    if ((asOf ?? "") < "2005") throw new ApiFailure(404, "not_yet_created", "Not yet.");
    return after as ArticleView;
  });
  show("2001-01-01", "2026-10-01");
  expect(await screen.findByText(/the article did not exist yet on 1 Jan 2001/)).toBeInTheDocument();
  expect(document.querySelectorAll(".cmp-added")).toHaveLength(document.querySelectorAll("[data-cmp-para]").length);
});
