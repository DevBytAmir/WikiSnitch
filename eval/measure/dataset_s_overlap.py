"""Overlap between the languages of dataset S.

Counts articles and Wikidata items per language, topics present in all three languages, and
which history-set articles have an English and a Swedish counterpart.

Run with: uv run --no-project --with duckdb python eval/measure/dataset_s_overlap.py REFERENCE_DIR
REFERENCE_DIR is a folder holding checkouts of ``mariadb-vector-wikipedia-rag`` (dataset S) and
``mariadb-system-versioning-wikipedia`` (the article list).
"""

import sys

import duckdb

ref = sys.argv[1]
d = f"{ref}/mariadb-vector-wikipedia-rag/data"
con = duckdb.connect()
con.execute(f"CREATE VIEW a AS SELECT * FROM read_parquet(['{d}/articles-fi.parquet','{d}/articles-sv.parquet','{d}/articles-en.parquet'])")
con.execute(f"CREATE VIEW hero AS SELECT * FROM read_csv('{ref}/mariadb-system-versioning-wikipedia/data/articles.tsv', delim='\t', header=true)")
print(con.execute("SELECT lang, count(*), count(wikidata_id), round(avg(length(text))), max(length(text)) FROM a GROUP BY 1").fetchall())
print("trilingual topics:", con.execute("SELECT count(*) FROM (SELECT wikidata_id FROM a WHERE wikidata_id IS NOT NULL GROUP BY 1 HAVING count(DISTINCT lang)=3)").fetchone())
print("dup wikidata per lang:", con.execute("SELECT lang, count(*) FROM (SELECT lang, wikidata_id FROM a WHERE wikidata_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) GROUP BY 1").fetchall())
q = """SELECT h.page_id, h.title, f.wikidata_id IS NOT NULL in_s,
 (SELECT count(*) FROM a e WHERE e.lang='en' AND e.wikidata_id=f.wikidata_id) en,
 (SELECT count(*) FROM a e WHERE e.lang='sv' AND e.wikidata_id=f.wikidata_id) sv,
 length(f.text) fi_len
FROM hero h LEFT JOIN a f ON f.lang='fi' AND f.page_id=h.page_id ORDER BY 2"""
rows = con.execute(q).fetchall()
print("hero:", len(rows), "in S:", sum(1 for r in rows if r[2]), "with en:", sum(1 for r in rows if r[3]), "with sv:", sum(1 for r in rows if r[4]), "all3:", sum(1 for r in rows if r[3] and r[4]))
for r in rows:
    if not (r[3] and r[4]):
        print("  missing:", r)
# paragraph counts (blank-line split, >=200 chars) per language
for lang in ("fi","sv","en"):
    print(lang, "paragraphs>=200ch in trilingual topics:", con.execute(f"""
      SELECT count(*), round(avg(length(p))) FROM (SELECT unnest(string_split(text, '\n\n')) p FROM a WHERE lang='{lang}'
        AND wikidata_id IN (SELECT wikidata_id FROM a WHERE wikidata_id IS NOT NULL GROUP BY 1 HAVING count(DISTINCT lang)=3)) WHERE length(p)>=200""").fetchone())
    print(lang, "paragraphs>=200ch all:", con.execute(f"SELECT count(*) FROM (SELECT unnest(string_split(text, '\n\n')) p FROM a WHERE lang='{lang}') WHERE length(p)>=200").fetchone())
print(con.execute("SELECT text FROM a WHERE lang='en' AND title='Winter War'").fetchone()[0][:1500])
