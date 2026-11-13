import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, test, vi } from "vitest";
import { api, ApiFailure } from "../api/client";
import type { AskView } from "../api/types";
import generated from "../../fixtures/ask-generated.json";
import extractive from "../../fixtures/ask-extractive.json";
import noAnswer from "../../fixtures/ask-no-answer.json";
import asof2012 from "../../fixtures/ask-asof-2012.json";
import { AskPage } from "./AskPage";

// Each test sets its own implementation; see the note in ArticlePage.test.tsx about resets.
vi.mock("../api/client", async (orig) => {
  const real = await orig<typeof import("../api/client")>();
  return { ...real, api: { ...real.api, ask: vi.fn() } };
});
const ask = vi.mocked(api.ask);

const show = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/ask" element={<AskPage />} />
      </Routes>
    </MemoryRouter>,
  );

test("generated answer with citation buttons", async () => {
  ask.mockResolvedValue(generated as AskView);
  show("/ask?q=Milloin%20Testisota%20alkoi%3F");
  expect(await screen.findByText(/Sota alkoi 1939/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Citation 1" })).toBeInTheDocument();
  const item = document.getElementById("cite-now-1")!;
  expect(within(item).getByRole("link", { name: "Testisota" })).toHaveAttribute("href", "/a/fi/9001?p=1");
  expect(item).toHaveTextContent("0.90 similarity of meaning");
  expect(item).toHaveTextContent("Stable since 2015");
});

test("extractive mode", async () => {
  ask.mockResolvedValue(extractive as AskView);
  show("/ask?q=x");
  expect(await screen.findByRole("heading", { name: "Passages that may answer this" })).toBeInTheDocument();
  expect(screen.getByText("No answer model is available, so no summary was written.")).toBeInTheDocument();
  expect(document.querySelectorAll("li.citation")).toHaveLength(5);
});

test("no_answer mode", async () => {
  ask.mockResolvedValue(noAnswer as AskView);
  show("/ask?q=x");
  expect(await screen.findByText((noAnswer as AskView).answer!)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Closest passages" })).toBeInTheDocument();
});

test("no_answer with no candidates says nothing could be searched", async () => {
  const empty = noAnswer as AskView;
  ask.mockResolvedValue({
    ...empty,
    citations: [],
    retrieval: { ...empty.retrieval, candidates: 0, best_similarity: null },
  });
  show("/ask?q=what%20do%20you%20know%20about%20Finland&lang=fi");
  expect(
    await screen.findByText("No Finnish paragraphs could be searched, so there was nothing to compare the question with."),
  ).toBeInTheDocument();
  expect(ask).toHaveBeenLastCalledWith("what do you know about Finland", undefined, "fi");
  expect(screen.getByText(/Try “Any language”/)).toBeInTheDocument();
  expect(screen.getByText("No paragraphs to compare")).toBeInTheDocument();
  expect(screen.queryByText(empty.answer!)).not.toBeInTheDocument();
  expect(screen.queryByText(/closest paragraph scored/)).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Closest passages" })).not.toBeInTheDocument();
  expect(screen.queryByText("Why these passages?")).not.toBeInTheDocument();
});

test("citation button focuses the citation", async () => {
  ask.mockResolvedValue(generated as AskView);
  show("/ask?q=x");
  fireEvent.click(await screen.findByRole("button", { name: "Citation 1" }));
  const item = document.getElementById("cite-now-1")!;
  expect(document.activeElement).toBe(item);
  expect(item).toHaveClass("citation-highlight");
});

test("as_of shows two columns", async () => {
  ask.mockImplementation(async (_q: string, asOf?: string) => (asOf ? asof2012 : generated) as AskView);
  show("/ask?q=x&as_of=2012-01-01");
  expect(await screen.findByRole("heading", { name: "As of 1 Jan 2012" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  expect(await screen.findAllByText(/Sota alkoi 1939/)).toHaveLength(2);
  expect(ask).toHaveBeenCalledWith("x", "2012-01-01");
  expect(ask).toHaveBeenCalledWith("x");
  expect(document.getElementById("cite-asof-1")!.querySelector("a")).toHaveAttribute(
    "href",
    "/a/fi/9001?p=1&as_of=2012-01-01",
  );
});

test("503 message", async () => {
  let calls = 0;
  ask.mockImplementation(async () => {
    calls += 1;
    if (calls === 1) throw new ApiFailure(503, "embedder_unavailable", "Down");
    return generated as AskView;
  });
  show("/ask?q=x");
  expect(await screen.findByText("Search is unavailable right now.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText(/Sota alkoi 1939/)).toBeInTheDocument();
});

test("422 message", async () => {
  ask.mockImplementation(async () => {
    throw new ApiFailure(422, "empty_question", "Too long");
  });
  show("/ask?q=x");
  expect(await screen.findByText("Enter a question of up to 500 characters.")).toBeInTheDocument();
});

test("empty question cannot be submitted", () => {
  show("/ask");
  const submit = screen.getByRole("button", { name: "Ask" });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Question"), { target: { value: "   " } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Milloin?" } });
  expect(submit).toBeEnabled();
  expect(screen.getByText("8/500")).toBeInTheDocument();
});
