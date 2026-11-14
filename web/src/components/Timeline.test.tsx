import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { TimelineView } from "../api/types";
import fixture from "../../fixtures/timeline-fi-9001.json";
import { lastDayOf, TimelineChart } from "./Timeline";

const DATA = fixture as TimelineView;

test("one bar per month", () => {
  const { container } = render(<TimelineChart data={DATA} asOf="2026-10-01T00:00:00Z" onPick={() => {}} />);
  expect(container.querySelectorAll("rect.bar")).toHaveLength(DATA.months.length);
  const withReverts = DATA.months.filter((m) => m.reverts > 0);
  const dots = container.querySelectorAll("circle.revert-dot");
  expect(dots).toHaveLength(withReverts.length);
  expect(dots[0].querySelector("title")?.textContent).toBe("1 reverts (1 of anonymous edits)");
  expect(container.querySelector("line.asof-line")).not.toBeNull();
});

test("click sets as_of", () => {
  const pick = vi.fn();
  render(<TimelineChart data={DATA} asOf="2026-10-01T00:00:00Z" onPick={pick} />);
  fireEvent.click(screen.getByRole("button", { name: /^2008-08:/ }));
  expect(pick).toHaveBeenCalledWith("2008-08-31");
  fireEvent.keyDown(screen.getByRole("button", { name: /^2010-02:/ }), { key: "Enter" });
  expect(pick).toHaveBeenLastCalledWith("2010-02-28");
  expect(lastDayOf("2024-02")).toBe("2024-02-29");
});

test("caption totals", () => {
  render(<TimelineChart data={DATA} asOf="2026-10-01T00:00:00Z" onPick={() => {}} />);
  expect(screen.getByText("16 versions, 4 reverts, 1 Mar 2005–2 Sep 2026")).toBeInTheDocument();
});
