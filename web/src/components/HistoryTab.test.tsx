import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { api, ApiFailure } from "../api/client";
import type { HistoryState, HistoryView } from "../api/types";
import p1 from "../../fixtures/history-fi-9001-1.json";
import p5 from "../../fixtures/history-fi-9001-5.json";
import { DriftChart } from "./DriftChart";
import { HistoryBody, HistoryTab, NO_HISTORY_MESSAGE, STATE_LIMIT } from "./HistoryTab";
import { WordDiff } from "./WordDiff";

vi.mock("../api/client", async (orig) => {
  const real = await orig<typeof import("../api/client")>();
  return { ...real, api: { ...real.api, history: vi.fn() } };
});

const H1 = p1 as HistoryView; // numbers change in 2015
const H5 = p5 as HistoryView; // disputed: two undone states

test("metrics and reasons shown", () => {
  render(<HistoryBody data={H5} />);
  expect(screen.getByText("Disputed")).toBeInTheDocument();
  const reasons = document.querySelector(".history .reasons") as HTMLElement;
  for (const r of H5.paragraph.badge.reasons) expect(within(reasons).getByText(r)).toBeInTheDocument();
  const figures = screen.getByText("First seen").closest("dl")!;
  expect(figures).toHaveTextContent("8 Aug 2008, Cecilia");
  expect(figures).toHaveTextContent("Substantive changes0");
  expect(figures).toHaveTextContent("Undone edits2");
  expect(document.querySelector(".citations")).toHaveTextContent("No citations");
});

test("numbers change shows removed and added values", () => {
  render(<HistoryBody data={H1} />);
  const row = document.querySelector('[data-rev="109"]') as HTMLElement;
  expect(within(row).getByText("numbers change")).toBeInTheDocument();
  expect(row).toHaveTextContent("Numbers: removed 25000; added 70000");
});

test("undone states collapsed by default and expandable", () => {
  render(<HistoryBody data={H5} />);
  expect(document.querySelector('[data-rev="113"]')).toBeNull();
  expect(document.querySelector('[data-rev="115"]')).toBeNull();
  const buttons = screen.getAllByRole("button", { name: "1 undone edit" });
  expect(buttons).toHaveLength(2); // each between its restored neighbours
  fireEvent.click(buttons[0]);
  expect(buttons[0]).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelector('[data-rev="115"]')).not.toBeNull();
});

test("more than 50 states are capped", () => {
  const base = H1.states[2];
  const states: HistoryState[] = Array.from({ length: 120 }, (_, i) => ({
    ...base,
    rev_id: 1000 + i,
    from: new Date(Date.UTC(2000, 0, 1) + i * 86_400_000).toISOString(),
    to: null,
    change: { ...base.change, type: i === 0 ? "created" : "wording" },
  }));
  render(<HistoryBody data={{ ...H1, states }} />);
  expect(document.querySelectorAll("li.state")).toHaveLength(STATE_LIMIT);
  fireEvent.click(screen.getByRole("button", { name: "Show all 120" }));
  expect(document.querySelectorAll("li.state")).toHaveLength(120);
});

test("chart has one mark per non-undone state", () => {
  const { container } = render(<DriftChart states={H5.states} />);
  expect(container.querySelectorAll(".mark")).toHaveLength(H5.states.filter((s) => !s.reverted).length);
  expect(container.querySelectorAll(".undone-tick")).toHaveLength(2);
  expect(container.querySelector(".mark title")?.textContent).toBe("8 Aug 2008: created");
});

test("word diff renders three operations", () => {
  const { container } = render(
    <WordDiff ops={[{ op: "equal", text: "noin" }, { op: "delete", text: "25 000" }, { op: "insert", text: "70 000" }]} />,
  );
  expect(container.querySelector("del")).toHaveTextContent("−25 000");
  expect(container.querySelector("ins")).toHaveTextContent("+70 000");
  expect(container.textContent).toBe("noin −25 000 +70 000");
});

test("no_history message", async () => {
  vi.mocked(api.history).mockImplementation(async () => {
    throw new ApiFailure(409, "no_history", "No history.");
  });
  render(<HistoryTab lang="fi" pageId={9003} paraId={1} />);
  expect(await screen.findByText(NO_HISTORY_MESSAGE)).toBeInTheDocument();
});
