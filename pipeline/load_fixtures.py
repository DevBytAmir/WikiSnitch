"""Load the fixture articles into the test database: history, paragraphs, vectors and signals.

The vectors come from the deterministic fake embedder, so this needs no embedding server. It
refuses to run against any database whose name does not end in ``_test``.
"""

from core.config import load_settings
from core.db import connect
from core.embedder import FakeEmbedder
from core.lineage import build_lineage
from db.fixtures.data import FI_HISTORY, S_ARTICLES
from pipeline import signals
from pipeline.embed import embed_missing
from pipeline.load_articles import parse_date, store_article_rows, store_markdown_article
from pipeline.load_history import store_lineage

# Articles stored from their current Markdown text, because they have no edit history.
MARKDOWN_ARTICLES = (("en", 8001), ("sv", 7001), ("fi", 9003), ("en", 8003))


def main() -> None:
    """Store every fixture article, embed its paragraphs and compute the signals."""
    settings = load_settings()
    if not settings.db_name.endswith("_test"):
        raise RuntimeError(f"refusing to load fixtures into {settings.db_name!r}")
    con = connect(settings)
    try:
        store_article_rows(con, S_ARTICLES)
        titles = {a["page_id"]: a["title"] for a in S_ARTICLES if a["lang"] == "fi"}
        for page_id, versions in FI_HISTORY.items():
            store_lineage(con, page_id, titles[page_id], versions, build_lineage(versions))
        by_key = {(a["lang"], a["page_id"]): a for a in S_ARTICLES}
        for key in MARKDOWN_ARTICLES:
            row = by_key[key]
            store_markdown_article(
                con, row["lang"], row["page_id"], row["rev_id"], row["text"],
                parse_date(row["date_modified"]),
            )
        embed_missing(con, FakeEmbedder(settings.embed_dimensions))
        signals.main(con)
    finally:
        con.close()


if __name__ == "__main__":
    main()
