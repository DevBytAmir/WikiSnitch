"""Totals of dataset M: how much text paragraph-level storage needs.

Counts the distinct lines of the history set, the distinct paragraph texts of all of dataset M,
the share of anonymous and minor edits, empty versions and renamed articles.

Run with: uv run --no-project --with duckdb python eval/measure/dataset_m_totals.py M_DIR REFERENCE_DIR
Arguments as for ``dataset_m_history.py``.
"""

import glob
import sys

import duckdb

m, ref = sys.argv[1], sys.argv[2]
con = duckdb.connect()
con.execute("SET memory_limit='4GB'; SET threads=4; SET preserve_insertion_order=false; SET temp_directory='" + m + "/../tmp_duck'")
files = sorted(glob.glob(f"{m}/versions-*.parquet"))
con.execute(f"CREATE VIEW v AS SELECT * FROM read_parquet({files})")
con.execute(f"CREATE VIEW hero AS SELECT * FROM read_csv('{ref}/mariadb-system-versioning-wikipedia/data/articles.tsv', delim='\t', header=true)")
# hero: all distinct non-empty lines (any length) -> storage of paragraph-level versioning
print("hero distinct lines any length (count, MB):", con.execute("""
  SELECT count(*), round(sum(len)/1e6,1) FROM (SELECT page_id, md5(p) h, any_value(length(p)) len
  FROM (SELECT page_id, unnest(string_split(text, chr(10))) p FROM v WHERE page_id IN (SELECT page_id FROM hero))
  WHERE length(p) > 0 GROUP BY 1,2)""").fetchone())
# all of M: distinct paragraph texts >=150 chars
print("ALL M distinct paragraph texts >=150ch (count, seen>=3 versions, MB, avg chars):", con.execute("""
  SELECT count(*), count(*) FILTER (n>=3), round(sum(len)/1e6), round(avg(len)) FROM (SELECT page_id, md5(p) h, any_value(length(p)) len, count(*) n
  FROM (SELECT page_id, unnest(string_split(text, chr(10))) p FROM v)
  WHERE length(p) >= 150 AND substr(p,1,1) NOT IN ('|','!','{','*','#',':',';','=','<','[') GROUP BY 1,2)""").fetchone())
print("anonymous share, minor share:", con.execute("SELECT round(avg(anonymous::int),3), round(avg(minor::int),3) FROM v").fetchone())
print("null/empty text versions:", con.execute("SELECT count(*) FILTER (text IS NULL), count(*) FILTER (length(text)<50) FROM v").fetchone())
print("title changes (renames):", con.execute("SELECT count(*) FROM (SELECT page_id FROM v GROUP BY 1 HAVING count(DISTINCT title)>1)").fetchone())
