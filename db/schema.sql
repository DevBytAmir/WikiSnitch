-- MariaDB mariadb-vector-wikipedia-rag (MIT): article, article_vector, category_link, article_category
CREATE TABLE IF NOT EXISTS article (
  lang          CHAR(2)      NOT NULL,      -- fi, en, sv
  page_id       INT UNSIGNED NOT NULL,      -- Wikipedia's own id, per language
  rev_id        INT UNSIGNED NOT NULL,      -- the version we have
  wikidata_id   VARCHAR(20),                -- same topic across languages, e.g. Q33 = Finland
  title         VARCHAR(255) NOT NULL,
  url           VARCHAR(500) NOT NULL,
  date_modified DATETIME,                   -- when this version was saved
  text          MEDIUMTEXT   NOT NULL,      -- clean Markdown from FineWiki
  PRIMARY KEY (lang, page_id),
  KEY (wikidata_id),
  FULLTEXT (title, text)                    -- for keyword search
) CHARACTER SET utf8mb4;

-- A vector exists only once it is computed: a VECTOR INDEX column must be NOT NULL.
-- "Has a row here" = "is embedded". That is what makes embed.py resumable.
CREATE TABLE IF NOT EXISTS article_vector (
  lang       CHAR(2)      NOT NULL,
  page_id    INT UNSIGNED NOT NULL,
  model      VARCHAR(50)  NOT NULL,         -- which model made this vector
  truncated  BOOL         NOT NULL,         -- article was longer than the model reads
  embedding  VECTOR(1024) NOT NULL,
  PRIMARY KEY (lang, page_id),
  -- M=16 instead of the default 6: with 1024 dimensions, M=6 found only 79% of the true top 10
  -- (see index_recall.py and step 8 of the README in mariadb-vector-wikipedia-rag).
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
);

-- The category tree under "Suomen historia" (Finnish category names, without "Luokka:").
CREATE TABLE IF NOT EXISTS category_link (
  parent  VARCHAR(255) NOT NULL,
  child   VARCHAR(255) NOT NULL,
  PRIMARY KEY (parent, child),
  KEY (child)
) CHARACTER SET utf8mb4;

-- Which categories each article is in. Categories come from Finnish Wikipedia; the Swedish and
-- English articles get the categories of the Finnish article on the same topic (same wikidata_id).
CREATE TABLE IF NOT EXISTS article_category (
  lang      CHAR(2)      NOT NULL,
  page_id   INT UNSIGNED NOT NULL,
  category  VARCHAR(255) NOT NULL,
  PRIMARY KEY (lang, page_id, category),
  KEY (category)
) CHARACTER SET utf8mb4;

-- Whole versions, history set only. MariaDB's time-machine schema, without
-- partitions (they measured 25% more disk and no speed gain at this size)
-- and with the extra key they found necessary.
CREATE TABLE IF NOT EXISTS article_history (
  page_id    INT UNSIGNED NOT NULL,
  title      VARCHAR(255) NOT NULL,
  rev_id     INT UNSIGNED NOT NULL,
  user       VARCHAR(255),
  anonymous  BOOL NOT NULL DEFAULT 0,
  comment    TEXT,
  minor      BOOL NOT NULL DEFAULT 0,
  sha1       CHAR(31),
  len        INT UNSIGNED,
  undone     BOOL NOT NULL DEFAULT 0,       -- a later version restored the text before this one
  text       MEDIUMTEXT COMPRESSED NOT NULL,
  row_start  TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end    TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (page_id),
  KEY (sha1),
  KEY (page_id, row_start)
) WITH SYSTEM VERSIONING;

-- One row per paragraph; MariaDB keeps every earlier state.
CREATE TABLE IF NOT EXISTS paragraph (
  lang       CHAR(2)      NOT NULL,
  page_id    INT UNSIGNED NOT NULL,
  para_id    INT UNSIGNED NOT NULL,         -- stable through edits, per article
  kind       ENUM('p','li') NOT NULL,
  section    VARCHAR(255),
  text       MEDIUMTEXT       NOT NULL,     -- cleaned text
  text_hash  BINARY(16)   NOT NULL,         -- MD5 of the normalised text
  citations  SMALLINT UNSIGNED,             -- <ref> count in the wikitext; NULL for sv, en
  numbers    VARCHAR(1000),                 -- years and numbers in the text, normalised, sorted
  rev_id     INT UNSIGNED NOT NULL,         -- the version that produced this state
  user       VARCHAR(255),
  anonymous  BOOL NOT NULL DEFAULT 0,
  comment    VARCHAR(500),
  undone     BOOL NOT NULL DEFAULT 0,       -- produced by a version that was later undone
  row_start  TIMESTAMP(6) GENERATED ALWAYS AS ROW START INVISIBLE,
  row_end    TIMESTAMP(6) GENERATED ALWAYS AS ROW END INVISIBLE,
  PERIOD FOR SYSTEM_TIME (row_start, row_end),
  PRIMARY KEY (lang, page_id, para_id),
  KEY (text_hash),
  KEY (lang, page_id, row_start)
) WITH SYSTEM VERSIONING;

-- Reading order of the current version (headings and paragraphs).
CREATE TABLE IF NOT EXISTS article_outline (
  lang     CHAR(2)      NOT NULL,
  page_id  INT UNSIGNED NOT NULL,
  pos      SMALLINT UNSIGNED NOT NULL,
  heading  VARCHAR(255),                    -- set for a heading row
  para_id  INT UNSIGNED,                    -- set for a paragraph row
  PRIMARY KEY (lang, page_id, pos)
);

-- One vector per distinct paragraph text, any language, any era.
CREATE TABLE IF NOT EXISTS text_vector (
  text_hash  BINARY(16)   NOT NULL,
  lang       CHAR(2)      NOT NULL,
  is_current BOOL         NOT NULL,         -- the text is in a current paragraph
  model      VARCHAR(50)  NOT NULL,
  embedding  VECTOR(1024) NOT NULL,
  PRIMARY KEY (text_hash),
  VECTOR INDEX (embedding) M=16 DISTANCE=cosine
);

-- Precomputed per current paragraph with history: feeds badges and the queue.
CREATE TABLE IF NOT EXISTS paragraph_signal (
  lang CHAR(2) NOT NULL, page_id INT UNSIGNED NOT NULL, para_id INT UNSIGNED NOT NULL,
  first_seen DATETIME, last_substantive_change DATETIME,
  states INT, substantive_changes INT, undone_states INT, named_reverts_24m INT,
  total_drift FLOAT, citations SMALLINT, citations_first_added DATETIME,
  best_en FLOAT, best_sv FLOAT, numbers_differ_en BOOL, numbers_differ_sv BOOL,
  badge ENUM('stable','changed_recently','disputed','new','unknown') NOT NULL,
  badge_label VARCHAR(100) NOT NULL,
  badge_reasons JSON NOT NULL,              -- list of strings
  review_reasons JSON NOT NULL,             -- list of {code, detail}
  attention FLOAT NOT NULL,
  PRIMARY KEY (lang, page_id, para_id)
);

-- Counterpart paragraphs with no related paragraph in the Finnish article.
CREATE TABLE IF NOT EXISTS coverage_gap (
  fi_page_id INT UNSIGNED NOT NULL,
  lang CHAR(2) NOT NULL, page_id INT UNSIGNED NOT NULL, para_id INT UNSIGNED NOT NULL,
  nearest_similarity FLOAT NOT NULL,
  PRIMARY KEY (fi_page_id, lang, page_id, para_id)
);

-- Answer-model results, so nothing is generated twice.
CREATE TABLE IF NOT EXISTS llm_cache (
  cache_key BINARY(16) NOT NULL PRIMARY KEY,  -- MD5 of kind + model + inputs
  kind VARCHAR(30) NOT NULL, model VARCHAR(100) NOT NULL,
  response JSON NOT NULL, created DATETIME NOT NULL
);
