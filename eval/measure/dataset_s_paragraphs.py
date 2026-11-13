"""How many paragraphs dataset S has per language, and how long they are.

Counts paragraph lines of at least 150 characters in articles that exist in all three languages
and in all articles, which sizes the embedding job.

Run with: uv run --no-project --with duckdb python eval/measure/dataset_s_paragraphs.py REFERENCE_DIR
REFERENCE_DIR is a folder holding a checkout of ``mariadb-vector-wikipedia-rag`` (dataset S).
"""

import sys

import duckdb

d = f"{sys.argv[1]}/mariadb-vector-wikipedia-rag/data"
con = duckdb.connect()
con.execute(f"CREATE VIEW a AS SELECT * FROM read_parquet(['{d}/articles-fi.parquet','{d}/articles-sv.parquet','{d}/articles-en.parquet'])")
tri = "(SELECT wikidata_id FROM a WHERE wikidata_id IS NOT NULL GROUP BY 1 HAVING count(DISTINCT lang)=3)"
for lang in ("fi","sv","en"):
    for name, w in (("trilingual", f"AND wikidata_id IN {tri}"), ("all", "")):
        print(lang, name, "paragraph lines >=150ch (count, avg chars, max chars):", con.execute(f"""
          SELECT count(*), round(avg(length(p))), max(length(p)) FROM (SELECT unnest(string_split(text, '\n')) p FROM a WHERE lang='{lang}' {w}) WHERE length(p)>=150 AND p NOT LIKE '#%' AND p NOT LIKE '|%'""").fetchone())
