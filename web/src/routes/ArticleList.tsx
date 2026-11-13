import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { ArticleListItem } from "../api/types";
import { Async, useApi } from "../components/Async";
import { LANGUAGE_NAME } from "../components/CrossLangTab";
import { Icon } from "../components/Icon";
import { Eyebrow, LangTag, Segmented } from "../components/ui";
import { formatNumber } from "../lib/format";

export const SEARCH_DEBOUNCE_MS = 250;

type Sort = "history" | "versions" | "az";
const SORTS: readonly Sort[] = ["history", "versions", "az"];
const parseSort = (s: string | null): Sort => (SORTS.includes(s as Sort) ? (s as Sort) : "history");

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function sorted(list: ArticleListItem[], sort: Sort): ArticleListItem[] {
  // "history": the API's own order (history articles first, then by title).
  if (sort === "history") return list;
  const copy = [...list];
  if (sort === "versions") copy.sort((a, b) => (b.versions ?? -1) - (a.versions ?? -1));
  else copy.sort((a, b) => a.title.localeCompare(b.title, "fi"));
  return copy;
}

function Row({ a }: { a: ArticleListItem }) {
  return (
    <li className="article-row">
      <div className="row-main">
        <div className="row-title-line">
          <Link to={`/a/${a.lang}/${a.page_id}`} className="row-title">
            {a.title}
          </Link>
          <span className="lang-tags">
            <LangTag lang={a.lang} />
            {a.languages.map((l) => (
              <span key={`${l.lang}-${l.page_id}`} className="lang-tag lang-tag-other" title={l.title}>
                {l.lang.toUpperCase()}
              </span>
            ))}
          </span>
        </div>
        <div className="row-sub">
          {LANGUAGE_NAME[a.lang]}
          {a.languages.length > 0 && ` · also ${a.languages.map((l) => l.title).join(" · ")}`}
        </div>
      </div>
      <div className={`row-history${a.has_history ? "" : " row-history-none"}`}>
        {a.has_history ? (
          <span>
            history: <b>{formatNumber(a.versions ?? 0)}</b> {a.versions === 1 ? "version" : "versions"}
          </span>
        ) : (
          <span>no history</span>
        )}
      </div>
      <Icon name="chevron-right" size={16} className="row-chevron" />
    </li>
  );
}

export function ArticleList() {
  // Search and sort live in the URL, so Back from an article returns to the same list.
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = parseSort(params.get("sort"));
  const setParam = (name: string, value: string, fallback: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === fallback) next.delete(name);
        else next.set(name, value);
        return next;
      },
      { replace: true },
    );
  const setQ = (value: string) => setParam("q", value, "");
  const setSort = (value: Sort) => setParam("sort", value, "history");
  const query = useDebounced(q.trim(), SEARCH_DEBOUNCE_MS);
  const list = useApi(() => (query ? api.articles(query) : api.articles()), [query]);
  const rows = useMemo(() => (list.data ? sorted(list.data.articles, sort) : []), [list.data, sort]);

  return (
    <section id="articles" className="list-section wrap">
      <div className="list-head">
        <div>
          <Eyebrow>The dataset</Eyebrow>
          <h2 className="section-title">Articles</h2>
        </div>
        <div className="list-tools">
          <label className="search">
            <Icon name="search" size={15} className="search-icon" />
            <input
              type="search"
              aria-label="Search articles"
              placeholder="Search titles, e.g. sota or presidentti"
              value={q}
              maxLength={200}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button type="button" className="search-clear" onClick={() => setQ("")} aria-label="Clear search">
                <Icon name="x" size={13} />
              </button>
            )}
          </label>
          <Segmented<Sort>
            label="Sort articles"
            value={sort}
            onChange={setSort}
            options={[
              { value: "history", label: "History first" },
              { value: "versions", label: "Most edited" },
              { value: "az", label: "A–Z" },
            ]}
          />
        </div>
      </div>
      <Async state={list}>
        {(data) =>
          data.articles.length === 0 ? (
            <div className="list-empty card">
              <p className="empty-title">No articles match "{query}".</p>
              <p className="muted">
                Titles are searched in every language. Questions search inside every paragraph, so asking may
                still find it.
              </p>
              {query && (
                <Link to={`/ask?q=${encodeURIComponent(query)}`} className="btn btn-primary">
                  Ask “{query}” instead <Icon name="arrow-right" size={14} />
                </Link>
              )}
            </div>
          ) : (
            <div className="table card">
              <div className="table-head" aria-hidden="true">
                <span>Article</span>
                <span>Edit history</span>
                <span />
              </div>
              <ul className="article-list">
                {rows.map((a) => (
                  <Row key={`${a.lang}-${a.page_id}`} a={a} />
                ))}
              </ul>
            </div>
          )
        }
      </Async>
    </section>
  );
}
