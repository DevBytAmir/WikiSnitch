import type { DiffOp } from "../api/types";

// Client-side comparison of two versions of one paragraph, for the "Compare two dates"
// view. The API computes diffs for paragraph history; this covers the case where the
// web app holds two article versions and lines them up itself.

/** Word-level diff (longest common subsequence), merged into runs. */
export function wordDiff(a: string, b: string): DiffOp[] {
  const A = a.split(/\s+/).filter(Boolean);
  const B = b.split(/\s+/).filter(Boolean);
  const n = A.length;
  const m = B.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const raw: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      raw.push({ op: "equal", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ op: "delete", text: A[i++] });
    } else {
      raw.push({ op: "insert", text: B[j++] });
    }
  }
  while (i < n) raw.push({ op: "delete", text: A[i++] });
  while (j < m) raw.push({ op: "insert", text: B[j++] });

  const merged: DiffOp[] = [];
  for (const p of raw) {
    const last = merged[merged.length - 1];
    if (last && last.op === p.op) last.text += ` ${p.text}`;
    else merged.push({ ...p });
  }
  return merged;
}

/** Words added and removed by a diff. */
export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    const n = o.text.split(/\s+/).filter(Boolean).length;
    if (o.op === "insert") added += n;
    if (o.op === "delete") removed += n;
  }
  return { added, removed };
}

// "25 000" is one number: Finnish groups thousands with a (no-break) space.
const NUMBER_RE = /\d+(?:[   ]\d{3})*(?:[.,]\d+)?/g;

/** Numbers and years that appear in one text and not the other (as a multiset). */
export function numberDifferences(a: string, b: string): { removed: string[]; added: string[] } {
  const pool = [...(b.match(NUMBER_RE) ?? [])];
  const removed: string[] = [];
  for (const x of a.match(NUMBER_RE) ?? []) {
    const k = pool.indexOf(x);
    if (k >= 0) pool.splice(k, 1);
    else removed.push(x);
  }
  return { removed, added: pool };
}
