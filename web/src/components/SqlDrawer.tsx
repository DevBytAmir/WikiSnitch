import { useEffect, useState, type ReactNode } from "react";
import { lastSql, onSql } from "../api/client";
import type { SqlStatement } from "../api/types";
import { Icon } from "./Icon";

/** "Show SQL": the MariaDB statements behind the most recent response. */
export function SqlDrawer() {
  const [open, setOpen] = useState(false);
  const [sql, setSql] = useState<SqlStatement[]>(lastSql);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => onSql(setSql), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const copy = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
    } catch {
      setCopied(null);
    }
  };

  return (
    <>
      <button type="button" className="sql-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="code-xml" size={16} className="sql-toggle-icon" />
        {open ? "Hide SQL" : "Show SQL"}
      </button>
      {open && (
        <aside className="sql-drawer" aria-label="SQL statements">
          <div className="sql-drawer-head">
            <div>
              <div className="sql-eyebrow">Queries behind this view</div>
              <h2>SQL behind this view</h2>
              <p>The MariaDB statements of the most recent response, parameters shown as ?.</p>
            </div>
            <button type="button" className="sql-close" onClick={() => setOpen(false)} aria-label="Close SQL">
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="sql-drawer-body">
            {sql.length === 0 ? (
              <p className="sql-empty">No query has run on this page yet.</p>
            ) : (
              sql.map((s, i) => (
                <section key={`${i}-${s.label}`} className="sql-item">
                  <div className="sql-item-head">
                    <h3>{s.label}</h3>
                    <button type="button" className="sql-copy" onClick={() => copy(i, s.statement)}>
                      <Icon name={copied === i ? "check" : "copy"} size={13} />
                      {copied === i ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre>
                    <SqlHighlight sql={s.statement} />
                  </pre>
                </section>
              ))
            )}
          </div>
        </aside>
      )}
    </>
  );
}

const TOKEN =
  /(--[^\n]*)|('(?:[^']|'')*')|\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|ON|AND|OR|NOT|ORDER BY|GROUP BY|HAVING|LIMIT|AS|IS|NULL|IN|USING|SET|WITH|DESC|ASC|BETWEEN|CASE|WHEN|THEN|ELSE|END|DISTINCT|UNION|ALL|FOR SYSTEM_TIME|OVER|PARTITION BY|LIKE|MATCH|AGAINST|INSERT|INTO|VALUES|UPDATE|DELETE)\b|\b(VEC_[A-Za-z_]+|COUNT|SUM|MAX|MIN|AVG|COALESCE|GROUP_CONCAT|DATE_FORMAT|SHA2|CONCAT)\b|(\?)/g;

/** Colours keywords, functions, strings and parameters. Text stays exactly as given. */
function SqlHighlight({ sql }: { sql: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of sql.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(sql.slice(last, at));
    const cls = m[1] ? "sql-comment" : m[2] ? "sql-string" : m[3] ? "sql-kw" : m[4] ? "sql-fn" : "sql-param";
    out.push(
      <span key={at} className={cls}>
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  if (last < sql.length) out.push(sql.slice(last));
  return out;
}
