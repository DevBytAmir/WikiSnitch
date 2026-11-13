import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { api } from "../api/client";
import { SqlDrawer } from "./SqlDrawer";

// Fixture mode: real client, real lastSql/onSql, no network.
vi.stubEnv("VITE_FIXTURES", "1");

const open = () => fireEvent.click(screen.getByRole("button", { name: "Show SQL" }));

test("empty state", () => {
  render(<SqlDrawer />);
  open();
  expect(screen.getByText("No query has run on this page yet.")).toBeInTheDocument();
});

test("lists the statements of the last response", async () => {
  render(<SqlDrawer />);
  open();
  const a = await act(() => api.article("fi", 9001));
  const drawer = screen.getByRole("complementary", { name: "SQL statements" });
  expect(within(drawer).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(a.sql.map((s) => s.label));
  expect(drawer.querySelectorAll("pre")[0].textContent).toBe(a.sql[0].statement);
  expect(within(drawer).getAllByRole("button", { name: "Copy" })).toHaveLength(a.sql.length);
});

test("updates after another request", async () => {
  render(<SqlDrawer />);
  open();
  await act(() => api.article("fi", 9001));
  const h = await act(() => api.history("fi", 9001, 1));
  const drawer = screen.getByRole("complementary", { name: "SQL statements" });
  expect(within(drawer).getAllByRole("heading", { level: 3 }).map((x) => x.textContent)).toEqual(h.sql.map((s) => s.label));
});

test("copy puts the statement on the clipboard", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<SqlDrawer />);
  open();
  const t = await act(() => api.timeline("fi", 9001));
  await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]));
  expect(writeText).toHaveBeenCalledWith(t.sql[0].statement);
  expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
});
