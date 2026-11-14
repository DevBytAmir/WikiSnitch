import { expect, test } from "vitest";
import type { ArticleView, TimelineView } from "../api/types";
import before from "../../fixtures/article-fi-9001-asof-2006.json";
import after from "../../fixtures/article-fi-9001.json";
import timeline from "../../fixtures/timeline-fi-9001.json";
import { toTime } from "./format";
import { changesSince, lifelines, previousVersion, sampleAt, sampleDays, storyMoments, toSample } from "./samples";

const T = timeline as TimelineView;
const A = before as ArticleView;
const B = after as ArticleView;
const START = toTime("2005-03-01T10:00:00Z");
const samples = [toSample("2006-05-31", A), toSample("2007-01-31", B)];

test("sample days are the month ends with edits, thinned evenly with first and last kept", () => {
  expect(sampleDays(T)).toEqual(T.months.map((m) => m.month).map((ym) => ({ "2005-03": "2005-03-31", "2006-05": "2006-05-31", "2007-01": "2007-01-31", "2008-08": "2008-08-31", "2010-02": "2010-02-28", "2015-06": "2015-06-30", "2020-01": "2020-01-31", "2026-04": "2026-04-30", "2026-08": "2026-08-31", "2026-09": "2026-09-30" })[ym]));
  const thin = sampleDays(T, 4);
  expect(thin).toHaveLength(4);
  expect(thin[0]).toBe("2005-03-31");
  expect(thin[3]).toBe("2026-09-30");
  expect(sampleDays(null)).toEqual([]);
});

test("sampleAt picks the latest sample at or before a time", () => {
  expect(sampleAt(samples, toTime("2006-12-01"))?.day).toBe("2006-05-31");
  expect(sampleAt(samples, toTime("2026-01-01"))?.day).toBe("2007-01-31");
  expect(sampleAt(samples, toTime("2005-01-01"))).toBeUndefined();
});

test("lifelines: born, changed, in the later version's order", () => {
  const lives = lifelines(samples, START);
  expect(lives.map((l) => l.id)).toEqual(B.blocks.flatMap((b) => (b.type === "paragraph" ? [b.paragraph.para_id] : [])));
  const p1 = lives.find((l) => l.id === 1)!;
  expect(p1.born).toBe(START);
  expect(p1.changes).toHaveLength(1); // 25 000 → 70 000
  expect(p1.removed).toBeNull();
  const p5 = lives.find((l) => l.id === 5)!;
  expect(p5.born).toBeGreaterThan(toTime("2006-05-31"));
});

test("moments include the creation, the number change and the latest edit, in time order", () => {
  const ms = storyMoments(samples, T, START);
  expect(ms[0]).toMatchObject({ kind: "created", t: START });
  expect(ms.find((m) => m.kind === "number")).toMatchObject({ detail: "25 000 → 70 000", paraId: 1, day: "2007-01-31" });
  expect(ms[ms.length - 1]).toMatchObject({ kind: "latest", day: null });
  expect(ms.map((m) => m.t)).toEqual([...ms.map((m) => m.t)].sort((x, y) => x - y));
});

test("changes since the previous version skip versions with the same text", () => {
  // The latest text equals the 2007 sample, so it is compared with 2006.
  expect(previousVersion(samples, toTime("2026-10-01"), B)?.day).toBe("2006-05-31");
  const c = changesSince(samples[0], B);
  expect(c.changes.get(1)).toMatchObject({ kind: "changed", numbers: { removed: ["25 000"], added: ["70 000"] } });
  expect(c.changes.get(5)).toEqual({ kind: "added" });
  expect(previousVersion(samples, toTime("2006-06-01"), A)).toBeUndefined();
});
