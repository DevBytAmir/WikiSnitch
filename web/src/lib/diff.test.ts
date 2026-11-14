import { expect, test } from "vitest";
import { diffStats, numberDifferences, wordDiff } from "./diff";

test("word diff merges runs of the same operation", () => {
  expect(wordDiff("noin 25 000 sotilasta ylitti rajan", "noin 70 000 sotilasta ylitti rajan")).toEqual([
    { op: "equal", text: "noin" },
    { op: "delete", text: "25" },
    { op: "insert", text: "70" },
    { op: "equal", text: "000 sotilasta ylitti rajan" },
  ]);
  expect(wordDiff("", "uusi kappale")).toEqual([{ op: "insert", text: "uusi kappale" }]);
  expect(wordDiff("sama teksti", "sama teksti")).toEqual([{ op: "equal", text: "sama teksti" }]);
});

test("diff stats count words added and removed", () => {
  expect(diffStats(wordDiff("a b c", "a x y c"))).toEqual({ added: 2, removed: 1 });
});

test("numbers with a thousands space count as one number", () => {
  expect(numberDifferences("noin 25 000 sotilasta vuonna 1939", "noin 70 000 sotilasta vuonna 1939")).toEqual({
    removed: ["25 000"],
    added: ["70 000"],
  });
  expect(numberDifferences("1939 ja 1940", "1940 ja 1939")).toEqual({ removed: [], added: [] });
});
