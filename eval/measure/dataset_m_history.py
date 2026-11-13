"""Size and shape of the edit history in dataset M, and of the 50-article history set.

Reports versions per article, edits in the same second, and how many distinct paragraph texts
the history set has (all, and those seen in at least three versions).

Run with: uv run --no-project --with duckdb python eval/measure/dataset_m_history.py M_DIR REFERENCE_DIR
M_DIR is the folder with dataset M's ``versions-*.parquet``. REFERENCE_DIR is a folder holding a
checkout of MariaDB's ``mariadb-system-versioning-wikipedia`` repository (for the article list).
"""

import glob
import sys

import duckdb

m, ref = sys.argv[1], sys.argv[2]
con = duckdb.connect()
con.execute("SET memory_limit='3GB'; SET threads=4; SET preserve_insertion_order=false")
files = sorted(glob.glob(f"{m}/versions-*.parquet"))
print("files:", len(files))
con.execute(f"CREATE VIEW v AS SELECT * FROM read_parquet({files})")
con.execute(f"CREATE VIEW hero AS SELECT * FROM read_csv('{ref}/mariadb-system-versioning-wikipedia/data/articles.tsv', delim='\t', header=true)")
print("total versions/articles:", con.execute("SELECT count(*), count(DISTINCT page_id), min(timestamp), max(timestamp) FROM v").fetchone())
print("versions per article quantiles (50/90/99/max):", con.execute("SELECT quantile_cont(n,0.5), quantile_cont(n,0.9), quantile_cont(n,0.99), max(n) FROM (SELECT count(*) n FROM v GROUP BY page_id)").fetchone())
print("same-second edits:", con.execute("SELECT count(*) FROM (SELECT page_id, timestamp FROM v GROUP BY 1,2 HAVING count(*)>1)").fetchone())
print("hero versions:", con.execute("SELECT count(*), count(DISTINCT page_id), round(sum(bytes)/1e6) FROM v WHERE page_id IN (SELECT page_id FROM hero)").fetchone())
con.execute("""CREATE TABLE lines AS
  SELECT page_id, md5(p) h, any_value(length(p)) len, count(*) n_versions
  FROM (SELECT page_id, unnest(string_split(text, chr(10))) p FROM v WHERE page_id IN (SELECT page_id FROM hero))
  WHERE length(p) >= 150 AND substr(p,1,1) NOT IN ('|','!','{','*','#',':',';','=','<','[')
  GROUP BY 1,2""")
print("hero distinct paragraph texts (all / seen in >=3 versions), avg chars:", con.execute("SELECT count(*), count(*) FILTER (n_versions>=3), round(avg(len)) FROM lines").fetchone())
print("per article distinct paragraphs quantiles (50/90/max):", con.execute("SELECT quantile_cont(n,0.5), quantile_cont(n,0.9), max(n) FROM (SELECT count(*) FILTER (n_versions>=3) n FROM lines GROUP BY page_id)").fetchone())
for r in con.execute("SELECT h.title, (SELECT count(*) FROM v WHERE v.page_id=h.page_id) versions, count(*) all_paras, count(*) FILTER (n_versions>=3) stable_paras FROM lines l JOIN hero h USING(page_id) GROUP BY h.title, h.page_id ORDER BY 2 DESC LIMIT 12").fetchall():
    print("  ", r)
