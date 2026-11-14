-- Storage and row counts after `make load-hero`.
-- Run it inside the database container, which already knows the credentials:
--   docker compose exec -T mariadb sh -c 'mariadb -t -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' < eval/measure/storage.sql
-- (with Podman: podman compose exec -T ...). table_rows is InnoDB's estimate; the counts below are exact.

SELECT table_name,
       table_rows,
       ROUND(data_length / 1048576, 1)  AS data_mb,
       ROUND(index_length / 1048576, 1) AS index_mb
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('article_history', 'paragraph', 'article_outline', 'text_vector',
                     'paragraph_signal', 'article', 'article_vector')
ORDER BY data_length DESC;

SELECT 'history articles' AS what, COUNT(DISTINCT page_id) AS n FROM article_history FOR SYSTEM_TIME ALL
UNION ALL SELECT 'versions', COUNT(*) FROM article_history FOR SYSTEM_TIME ALL
UNION ALL SELECT 'undone versions', COUNT(*) FROM article_history FOR SYSTEM_TIME ALL WHERE undone = 1
UNION ALL SELECT 'paragraph states (fi)', COUNT(*) FROM paragraph FOR SYSTEM_TIME ALL WHERE lang = 'fi'
UNION ALL SELECT 'current paragraphs (fi)', COUNT(*) FROM paragraph WHERE lang = 'fi'
UNION ALL SELECT 'counterpart paragraphs (sv, en)', COUNT(*) FROM paragraph WHERE lang <> 'fi'
UNION ALL SELECT 'text vectors', COUNT(*) FROM text_vector
UNION ALL SELECT 'text vectors, current', COUNT(*) FROM text_vector WHERE is_current = 1
UNION ALL SELECT 'article vectors', COUNT(*) FROM article_vector
UNION ALL SELECT 'paragraph signals', COUNT(*) FROM paragraph_signal;
