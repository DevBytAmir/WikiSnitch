import type { DiffOp } from "../api/types";

/** Insertions underlined green with "+", deletions struck red with "−": not colour alone. */
export function DiffSpans({ ops }: { ops: DiffOp[] }) {
  return (
    <>
      {ops.map((o, i) => {
        const sep = i > 0 ? " " : "";
        if (o.op === "insert")
          return (
            <span key={i}>
              {sep}
              <ins>
                <span className="diff-mark" aria-hidden="true">
                  +
                </span>
                {o.text}
              </ins>
            </span>
          );
        if (o.op === "delete")
          return (
            <span key={i}>
              {sep}
              <del>
                <span className="diff-mark" aria-hidden="true">
                  −
                </span>
                {o.text}
              </del>
            </span>
          );
        return (
          <span key={i}>
            {sep}
            {o.text}
          </span>
        );
      })}
    </>
  );
}

export function WordDiff({ ops }: { ops: DiffOp[] }) {
  return (
    <p className="word-diff">
      <DiffSpans ops={ops} />
    </p>
  );
}
