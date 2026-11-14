import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ScrollMemory } from "./ScrollMemory";

// jsdom has no layout: fake the scroll position, clamped to how tall the page currently is.
const el = document.scrollingElement ?? document.documentElement;
let top = 0;
let maxTop = 5000;
beforeEach(() => {
  top = 0;
  maxTop = 5000;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, maxTop));
    },
  });
});
afterEach(() => {
  delete (el as { scrollTop?: number }).scrollTop;
});

const scrollTo = (y: number) => {
  el.scrollTop = y;
  window.dispatchEvent(new Event("scroll"));
};

function List() {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <Link to="/a/fi/1">Open article</Link>
      <button type="button" onClick={() => setParams({ q: "sota" }, { replace: true })}>
        Search {params.get("q")}
      </button>
    </>
  );
}

function Article() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Back
    </button>
  );
}

const show = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <ScrollMemory />
      <Routes>
        <Route path="/" element={<List />} />
        <Route path="/a/:lang/:pageId" element={<Article />} />
      </Routes>
    </MemoryRouter>,
  );

test("a new page starts at the top", () => {
  show();
  scrollTo(800);
  fireEvent.click(screen.getByText("Open article"));
  expect(el.scrollTop).toBe(0);
});

test("Back returns to the position on the list", async () => {
  show();
  scrollTo(800);
  fireEvent.click(screen.getByText("Open article"));
  scrollTo(300);
  fireEvent.click(screen.getByText("Back"));
  await waitFor(() => expect(el.scrollTop).toBe(800));
  expect(screen.getByText("Open article")).toBeInTheDocument();
});

test("Back waits for the list to load", async () => {
  show();
  scrollTo(800);
  fireEvent.click(screen.getByText("Open article"));
  maxTop = 0; // the list is still loading: the page is too short to scroll
  fireEvent.click(screen.getByText("Back"));
  expect(el.scrollTop).toBe(0);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
    maxTop = 5000; // the list has loaded
  });
  await waitFor(() => expect(el.scrollTop).toBe(800));
});

test("a query string change does not scroll", () => {
  show();
  scrollTo(800);
  fireEvent.click(screen.getByText(/^Search/));
  expect(screen.getByText("Search sota")).toBeInTheDocument();
  expect(el.scrollTop).toBe(800);
});
