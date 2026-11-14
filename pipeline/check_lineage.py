"""Check that the stored paragraphs rebuild every stored version of an article.

For each history article and every Nth version k, the paragraphs MariaDB returns for
`paragraph FOR SYSTEM_TIME AS OF times[k]` must equal the paragraphs of that version's
text, cleaned again from `article_history`. Exit code 1 on any mismatch.

    python -m pipeline.check_lineage [--page ID] [--every N]
"""

import argparse
import sys

from core.clean import blocks
from core.config import MIN_PARAGRAPH_CHARS, load_settings
from core.db import connect, sql_ts, utc

ARTICLES_SQL = "SELECT page_id, title FROM article_history"
VERSIONS_SQL = (
    "SELECT rev_id, row_start FROM article_history FOR SYSTEM_TIME ALL "
    "WHERE page_id = %s ORDER BY row_start"
)
TEXT_SQL = (
    "SELECT text FROM article_history FOR SYSTEM_TIME ALL WHERE page_id = %s AND row_start = %s"
)
AS_OF_SQL = (
    "SELECT text FROM paragraph FOR SYSTEM_TIME AS OF TIMESTAMP %s "
    "WHERE lang = 'fi' AND page_id = %s"
)


def expected_paragraphs(wikitext: str) -> list[str]:
    """The paragraph texts lineage keeps from one version, sorted."""
    return sorted(
        b.text for b in blocks(wikitext) if b.kind != "h" and len(b.text) >= MIN_PARAGRAPH_CHARS
    )


def check_article(cur, page_id: int, every: int = 1) -> tuple[int, int, list[int]]:
    """Returns (versions, versions checked, rev_ids whose paragraphs do not match)."""
    cur.execute(VERSIONS_SQL, (page_id,))
    versions = cur.fetchall()
    checked = 0
    mismatched: list[int] = []
    for k in range(0, len(versions), every):
        moment = sql_ts(utc(versions[k]["row_start"]))
        cur.execute(TEXT_SQL, (page_id, moment))
        want = expected_paragraphs(cur.fetchone()["text"])
        cur.execute(AS_OF_SQL, (moment, page_id))
        got = sorted(row["text"] for row in cur.fetchall())
        checked += 1
        if got != want:
            mismatched.append(versions[k]["rev_id"])
    return len(versions), checked, mismatched


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pipeline.check_lineage")
    parser.add_argument("--page", type=int)
    parser.add_argument("--every", type=int, default=1)
    args = parser.parse_args(argv)
    if args.every < 1:
        parser.error("--every must be at least 1")

    con = connect(load_settings())
    articles = versions = checked = mismatches = 0
    try:
        with con.cursor() as cur:
            if args.page is None:
                cur.execute(ARTICLES_SQL + " ORDER BY page_id")
            else:
                cur.execute(ARTICLES_SQL + " WHERE page_id = %s", (args.page,))
            for article in cur.fetchall():
                n, c, bad = check_article(cur, article["page_id"], args.every)
                print(f"{article['page_id']} {article['title']} {n} {len(bad)}", flush=True)
                if bad:
                    shown = " ".join(str(rev) for rev in bad[:10])
                    print(f"  mismatch at rev_id {shown}{' …' if len(bad) > 10 else ''}",
                          file=sys.stderr, flush=True)
                articles += 1
                versions += n
                checked += c
                mismatches += len(bad)
    finally:
        con.close()

    print(f"{articles} articles, {versions} versions ({checked} checked), {mismatches} mismatches")
    if articles == 0:
        print("no history article found", file=sys.stderr)
        return 1
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
