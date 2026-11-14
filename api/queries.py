"""Every SQL statement of the API, in one place so it can be reviewed and shown to readers.

Values are always bound parameters (``%s``), never formatted into the text. Two conventions:
``{marks}`` stands for a list of ``%s`` made by ``marks()`` for an ``IN (...)`` clause, and a literal
percent sign is written ``%%``. The few ``{...}`` fragments in the *Ask* queries are constants of
this module, not user input.
"""

from core.rows import STATE_COLUMNS


def marks(count: int) -> str:
    """``count`` comma-separated ``%s`` placeholders, for an ``IN`` clause."""
    return ", ".join(["%s"] * count)


ARTICLE = """
SELECT lang, page_id, rev_id, wikidata_id, title, date_modified
FROM article
WHERE lang = %s AND page_id = %s
"""

LANGUAGES_BY_WIKIDATA = """
SELECT wikidata_id, lang, page_id, title
FROM article
WHERE wikidata_id IN ({marks})
ORDER BY lang, page_id
"""

CURRENT_VERSION = """
SELECT rev_id, user, row_start AS saved_at
FROM article_history
WHERE page_id = %s
"""

VERSION_SPAN = """
SELECT COUNT(*) AS versions, MIN(row_start) AS first_version
FROM article_history FOR SYSTEM_TIME ALL
WHERE page_id = %s
"""

VERSIONS_BY_PAGE = """
SELECT page_id, COUNT(*) AS versions
FROM article_history FOR SYSTEM_TIME ALL
WHERE page_id IN ({marks})
GROUP BY page_id
"""

VERSION_AS_OF = """
SELECT rev_id, user, text, row_start AS saved_at
FROM article_history FOR SYSTEM_TIME AS OF TIMESTAMP %s
WHERE page_id = %s
"""

PARAGRAPHS_AS_OF = """
SELECT para_id, text_hash, kind, section, citations
FROM paragraph FOR SYSTEM_TIME AS OF TIMESTAMP %s
WHERE lang = 'fi' AND page_id = %s
"""

OUTLINE = """
SELECT o.pos, o.heading, o.para_id, p.kind, p.section, p.text, p.citations,
       s.badge, s.badge_label, s.badge_reasons
FROM article_outline o
LEFT JOIN paragraph p
  ON p.lang = o.lang AND p.page_id = o.page_id AND p.para_id = o.para_id
LEFT JOIN paragraph_signal s
  ON s.lang = o.lang AND s.page_id = o.page_id AND s.para_id = o.para_id
WHERE o.lang = %s AND o.page_id = %s
ORDER BY o.pos
"""

PAGE_STATES = f"""
SELECT {STATE_COLUMNS}
FROM paragraph FOR SYSTEM_TIME ALL
WHERE lang = 'fi' AND page_id = %s
ORDER BY para_id, row_start
"""

VECTORS_BY_HASH = """
SELECT text_hash, VEC_ToText(embedding) AS v
FROM text_vector
WHERE text_hash IN ({marks})
"""

LIST_ARTICLES = """
SELECT a.lang, a.page_id, a.title, a.wikidata_id, (h.page_id IS NOT NULL) AS has_history
FROM article a
LEFT JOIN article_history h ON a.lang = 'fi' AND h.page_id = a.page_id
WHERE %s = 0 OR h.page_id IS NOT NULL
ORDER BY has_history DESC, a.title
LIMIT %s
"""

SEARCH_PREFIX = """
SELECT a.lang, a.page_id, a.title, a.wikidata_id, (h.page_id IS NOT NULL) AS has_history
FROM article a
LEFT JOIN article_history h ON a.lang = 'fi' AND h.page_id = a.page_id
WHERE a.title LIKE CONCAT(%s, '%%') AND (%s = 0 OR h.page_id IS NOT NULL)
ORDER BY has_history DESC, a.title
LIMIT %s
"""

SEARCH_FULLTEXT = """
SELECT a.lang, a.page_id, a.title, a.wikidata_id, (h.page_id IS NOT NULL) AS has_history
FROM article a
LEFT JOIN article_history h ON a.lang = 'fi' AND h.page_id = a.page_id
WHERE MATCH(a.title, a.text) AGAINST (%s) AND (%s = 0 OR h.page_id IS NOT NULL)
ORDER BY MATCH(a.title, a.text) AGAINST (%s) DESC
LIMIT %s
"""

TIMELINE_SPAN = """
SELECT MIN(row_start) AS first_version, MAX(row_start) AS last_version
FROM article_history FOR SYSTEM_TIME ALL
WHERE page_id = %s
"""

# Revert detection from MariaDB mariadb-system-versioning-wikipedia (MIT): a version is a revert
# when its text hash differs from the previous version's but appeared earlier.
TIMELINE_MONTHS = """
SELECT DATE_FORMAT(row_start, '%%Y-%%m') AS month,
       COUNT(*) AS edits,
       SUM(is_revert) AS reverts,
       SUM(is_revert AND undid_anonymous) AS reverts_of_anonymous
FROM (
  SELECT row_start,
         COALESCE((sha1 <> LAG(sha1) OVER (ORDER BY row_start)
                   AND MIN(row_start) OVER (PARTITION BY sha1) < row_start), 0) AS is_revert,
         COALESCE(LAG(anonymous) OVER (ORDER BY row_start), 0) AS undid_anonymous
  FROM article_history FOR SYSTEM_TIME ALL
  WHERE page_id = %s
) AS versions
GROUP BY month
ORDER BY month
"""

ATTENTION = """
SELECT s.para_id, s.badge, s.badge_label, s.badge_reasons, s.review_reasons, s.attention,
       p.kind, p.section, p.text, p.citations
FROM paragraph_signal s
JOIN paragraph p
  ON p.lang = s.lang AND p.page_id = s.page_id AND p.para_id = s.para_id
WHERE s.lang = %s AND s.page_id = %s AND s.attention > 0
ORDER BY s.attention DESC, s.para_id ASC
"""

MISSING_HERE = """
SELECT g.lang, g.para_id, g.nearest_similarity, p.section, p.text
FROM coverage_gap g
JOIN paragraph p
  ON p.lang = g.lang AND p.page_id = g.page_id AND p.para_id = g.para_id
WHERE g.fi_page_id = %s
ORDER BY g.nearest_similarity ASC, g.lang, g.para_id
LIMIT %s
"""

ASK_RETRIEVE = """
SELECT v.distance, p.lang, p.page_id, p.para_id, p.section, p.text, p.rev_id,
       a.title, a.wikidata_id,
       s.badge, s.badge_label, s.badge_reasons
FROM (
  SELECT text_hash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(%s)) AS distance
  FROM text_vector
  WHERE is_current = 1{lang_filter}
  ORDER BY distance
  LIMIT 40
) v
JOIN paragraph p ON p.text_hash = v.text_hash AND p.undone = 0{paragraph_lang_filter}
JOIN article a ON a.lang = p.lang AND a.page_id = p.page_id
LEFT JOIN paragraph_signal s
  ON s.lang = p.lang AND s.page_id = p.page_id AND s.para_id = p.para_id
ORDER BY v.distance
"""

ASK_LANG_FILTER = " AND lang = %s"
ASK_PARAGRAPH_LANG_FILTER = " AND p.lang = %s"

ASK_RETRIEVE_AS_OF = """
SELECT v.distance, p.lang, p.page_id, p.para_id, p.section, p.text, p.rev_id,
       a.title, a.wikidata_id
FROM (
  SELECT text_hash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(%s)) AS distance
  FROM text_vector
  WHERE lang = 'fi'
  ORDER BY distance
  LIMIT 200
) v
JOIN paragraph FOR SYSTEM_TIME AS OF TIMESTAMP %s AS p
  ON p.text_hash = v.text_hash AND p.lang = 'fi' AND p.undone = 0
JOIN article a ON a.lang = p.lang AND a.page_id = p.page_id
ORDER BY v.distance
"""

CROSSLANG_SOURCE = """
SELECT p.para_id, p.kind, p.section, p.text, p.text_hash, p.citations, p.numbers,
       s.badge, s.badge_label, s.badge_reasons
FROM paragraph p
LEFT JOIN paragraph_signal s
  ON s.lang = p.lang AND s.page_id = p.page_id AND s.para_id = p.para_id
WHERE p.lang = %s AND p.page_id = %s AND p.para_id = %s
"""

CROSSLANG_SOURCE_AS_OF = """
SELECT para_id, kind, section, text, text_hash, citations, numbers
FROM paragraph FOR SYSTEM_TIME AS OF TIMESTAMP %s
WHERE lang = 'fi' AND page_id = %s AND para_id = %s
"""

SOURCE_VECTOR = """
SELECT VEC_ToText(embedding) AS v
FROM text_vector
WHERE text_hash = %s
"""

COUNTERPART = """
SELECT page_id, rev_id, title, date_modified
FROM article
WHERE wikidata_id = %s AND lang = %s
ORDER BY page_id
LIMIT 1
"""

CROSSLANG_MATCHES = """
SELECT p.para_id, p.section, p.text, p.numbers,
       VEC_DISTANCE_COSINE(v.embedding, VEC_FromText(%s)) AS distance
FROM paragraph p
JOIN text_vector v ON v.text_hash = p.text_hash
WHERE p.lang = %s AND p.page_id = %s
ORDER BY distance
LIMIT 3
"""

CROSSLANG_ELSEWHERE = """
SELECT v.distance, p.page_id, p.para_id, p.text, a.title
FROM (
  SELECT text_hash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(%s)) AS distance
  FROM text_vector
  WHERE is_current = 1 AND lang = %s
  ORDER BY distance
  LIMIT 20
) v
JOIN paragraph p ON p.text_hash = v.text_hash AND p.lang = %s AND p.undone = 0
JOIN article a ON a.lang = p.lang AND a.page_id = p.page_id
WHERE p.page_id <> %s
ORDER BY v.distance
"""
