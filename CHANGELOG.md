# Changelog

All notable changes to WikiSnitch are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- API skeleton: one error body for every failure, a request wrapper that records the SQL it
  runs (with `?` for values), validated language and `as_of` parameters, and `GET /api/health`
  with counts and whether the embedder is reachable. The web address allowed by CORS comes
  from `WEB_ORIGIN`. Every embedder can say whether its service is reachable.
- Response models for every endpoint, written to match the API contract with unknown fields
  forbidden, and every SQL statement of the API in one module.
- Answer-model client for any OpenAI-compatible service, configured by the `LLM_*` settings,
  with a cache of answers in the database. Wikipedia text is sent as quoted data, citation
  numbers the model invents are removed, and its JSON verdicts are validated.
- Articles: a list with search (title prefix, then full text), the article reader with a trust
  badge per paragraph, the same topic in other languages, and a view as of any earlier moment
  that rebuilds the text with `FOR SYSTEM_TIME AS OF`. Edit timeline with reverts per month.
- Paragraph history: every state of a paragraph with its author, comment and link to the exact
  revision, a word-level diff against the last live state, the type of each change, how far the
  meaning moved, and which states were undone.

## [0.3.0] - 2026-11-14

### Added

- Table creation from `db/schema.sql`, and a test database that is dropped and rebuilt on every
  test run. It refuses to touch any database whose name does not end in `_test`.
- Dataset download from MariaDB's releases, resumable, with every file checked against its
  SHA-256 checksum and a corrupt file deleted.
- Loading of dataset S: articles in Finnish, Swedish and English, the ready-made article
  vectors, the category tree, and current-text paragraphs for the counterparts of the history
  set (or for every article with `--paragraphs all`). Repeating the load changes nothing.
- Fixture articles with a known edit history (an undone vandal edit, a changed figure, a
  moved paragraph, a disputed one) and counterparts in English and Swedish, for tests and for
  running the app without the real data.
- History load: every paragraph state of an article is stored with Wikipedia's real edit
  times, next to the whole versions, so MariaDB's own history matches the article's. Reading
  a past state is one `FOR SYSTEM_TIME` query.
- Paragraph embedding: one vector per distinct text, current paragraphs first, committed in
  batches so an interrupted run can resume. Every embedder now reports its vector length.
- Paragraph signals: a badge, review reasons and a review priority for every current
  paragraph, the most similar paragraph in English and Swedish, whether the numbers differ
  when the claims match, and the paragraphs of other languages that nothing in the Finnish
  article covers.
- Fixture loader: the test database is filled with the fixture articles on every test run,
  using the fake embedder, so tests of signals, embedding and cross-language selection check
  exact, known answers.
- Vector files for embedding on another machine: export the texts that need vectors, embed
  them with no database and no network to MariaDB (resumable, retrying a failing server, and
  recording texts that keep failing), then import the vectors. Embedding settings can now be
  loaded alone, so a machine that only embeds needs no database settings.
- Lineage check: rebuilds every Nth stored version of an article from its paragraph states
  with `FOR SYSTEM_TIME AS OF` and compares it with the stored text, failing on any mismatch.
  `make load-hero` runs the whole load and this check, and prints the time of each step.
  A SQL report gives table sizes and row counts.

## [0.2.0] - 2026-11-14

### Added

- Settings loaded from the environment or `.env` with no defaults in code: a missing value
  stops start-up and is named in the message. Secrets are hidden from `repr`. The database
  connection is always UTC and uses the configured vector search depth.
- Text cleaning: wikitext and Markdown become headings, paragraphs and list items with
  citation counts, and each distinct text gets a stable MD5 identity.
- Number extraction: years and figures are normalised so that `25 000`, `25,000` and `25000`
  compare equal, and two texts can be compared by the numbers that differ.
- Embedders chosen by configuration: Ollama, any OpenAI-compatible embeddings API (hosted or
  local) or a deterministic fake for tests. Vectors are checked against the configured
  dimensions. Cosine similarity and conversion to and from the database vector format.
- Paragraph lineage: each paragraph keeps one identity through an article's edits, with a
  state for every wording, restored paragraphs recognised, and edits that were later undone
  marked. A rewrite that keeps at least 60% of its words stays the same paragraph.
- Change types for every state of a paragraph (created, wording, meaning, numbers,
  restored), the history metrics behind them, and trust badges (stable, changed recently,
  disputed, new). Similarity thresholds come from a calibration file when it exists.

## [0.1.0] - 2026-11-14

### Added

- MIT licence, ignore rules for secrets, data files, caches and build output, and the
  Python 3.12 version pin.
- Python project with uv, Makefile targets, a MariaDB 12.3 container and an environment
  template. Database, embedding and vector search settings live in `.env`, not in the code;
  `make setup` creates it from `.env.example`.
- MariaDB schema: system-versioned `paragraph` and `article_history` tables, a cosine vector
  index on `text_vector`, and tables for signals, coverage gaps and cached answers.

[Unreleased]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DevBytAmir/WikiSnitch/releases/tag/v0.1.0
