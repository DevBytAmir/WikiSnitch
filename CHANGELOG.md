# Changelog

All notable changes to WikiSnitch are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- README with what the project does, how it uses MariaDB, the data and the benchmark results, how
  to run it, every setting, the API, the project structure, testing, releases and credits.
- A limit on how many questions one visitor can ask (`ASK_RATE_LIMIT` in each
  `ASK_RATE_WINDOW_SECONDS`), so that a script cannot run up the cost of the answer model. A
  visitor over the limit gets a 429 answer with the number of seconds to wait. The visitor is
  identified behind the web server by the forwarded address, which is trusted only from the
  same machine.

## [0.6.0] - 2026-11-14

### Added

- Web app project (React, TypeScript, Vite) with a typed client for every endpoint of the API, and
  a fixture mode that serves real exported responses from `web/fixtures`, so the interface can be
  built and tested without the API running.
- Interface foundations: light and dark theme that follows the system, word-level comparison of
  two versions, CSV download, the sampling of an article at many dates that the time machine
  needs, and shared parts (icons, labels, trust badges with their rules, word diff, drift
  chart, loading and error states).
- The paragraph panel: select a paragraph to see "Through time" (every state with its author, a
  word diff, the type of each change, how far the meaning drifted and a link to the exact
  revision) and "Across languages" (the closest paragraph in each other language, how close it
  is and whether the numbers agree). Paragraphs show their trust badge in the margin.
- Time machine for an article: play its history, step between changes or jump to a date, over a
  chart of its length, each paragraph's life (coloured by the badge it had then) or its edits per
  month. The story of the page as moments, a side rail with the version in numbers, and a
  comparison of two dates that lines the paragraphs up by identity.
- "Show SQL" drawer on every screen with the statements behind what is shown, a data menu to
  download what is on screen, and a help page that lists what can be done and explains badges,
  similarity, undone edits and where the data comes from, with small interactive examples.
- Pages: the article list with search and sorting kept in the address (so Back returns to the same
  list), the article reader with the time machine and the paragraph panel, a date comparison
  mode, and the review queue for editors with the paragraphs that need attention.
- The Ask page: a question in Finnish, Swedish or English with an optional language and date,
  shown as the four steps of answering (read the question, search the archive, pick the evidence,
  write with citations) followed by the answer with
  numbered citations, each with its trust badge and a link to the article version. Without a
  model the closest passages are shown, and when nothing is close enough it says so. With a past
  date it shows what changed in the evidence between then and today.
- The home page hero: an engraved seal under a moon that turns through its phases, with a network
  of numbered boxes through it that can be dragged and spring back. Motion stops for readers who
  prefer reduced motion. The images are loaded from `public/hero` so the browser can start
  fetching them early.
- Favicons in three sizes, and on the home page the hero images start downloading at once,
  alongside the app's code, instead of after it has loaded.
- Back and Forward return to where the reader was on the page, waiting for its data to load
  first. A new page starts at the top, and a change of the address that only changes the date,
  the selection or the search does not scroll.
- The application shell: top bar with the WikiSnitch logo, a home page with the dataset in numbers
  and the article list, routes for the list, the article reader, the review queue, the Ask page
  and the help page, and the stylesheet for the Wikipedia look in light and dark themes. Tests
  cover that every area shows a message with a Retry button when the service is down, that the
  keyboard reaches every paragraph and the panel, that every badge has visible text, and that
  nothing renders raw HTML, because Wikipedia text is untrusted.
- Continuous integration on GitHub: every pull request and every push to `main` sets up the
  project with `make setup` (the same `.env.example` and database container as a laptop), runs
  lint and the Python tests, and typechecks, tests and builds the web app.

### Fixed

- The history load runs on Windows: `tzdata` is now a dependency, because pyarrow cannot read
  the time-zoned timestamps of dataset M without it.

## [0.5.0] - 2026-11-14

### Added

- Scripts that measure the datasets (versions per article, distinct paragraphs, overlap
  between languages, paragraph sizes) and so size the embedding job, with how to run them.
- Threshold calibration: a script makes a sheet of paragraph pairs for a person to label (same,
  related, different), and another chooses the cut-offs with the best F1 score, refusing to
  calibrate from fewer than 40 labels and keeping the other thresholds.
- A sheet of 60 labelled paragraph pairs (4 same, 17 related, 39 different) and the thresholds
  calibrated from it: same claim from a similarity of 0.662, related from 0.439. The file also
  holds the lowest similarity at which *Ask* answers (0.522) and the similarity below which a
  change counts as a change of meaning (0.9).
- Retrieval benchmark on MariaDB's 37 Finland history questions: which article a search finds
  through MariaDB's one vector per article and through our vector per paragraph, with hit rates
  at 1, 5 and 10 and a report that states how many articles have paragraph vectors. The
  calibrated `ask_min` is only changed when asked to with `--update-ask-min`.
- Benchmark results on all 29,460 articles: finding the right article in the top 5 works for 70%
  of the questions through paragraph vectors and 76% through article vectors. Paragraphs are
  better for English questions (85% against 69%) and worse for Finnish ones (46% against 77%).

## [0.4.0] - 2026-11-14

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
- Review queue: the paragraphs of an article ordered by how much they need an editor's attention
  (changed recently, disputed, unsourced, at odds with another language), with the reasons, and
  the paragraphs of other languages that nothing in the Finnish article covers.
- Ask: a question in any language is matched against the paragraph vectors and answered with
  cited passages, each with its trust badge. Below the similarity cut-off the model is not
  called. A past date answers from Wikipedia as it stood then. Without a model, or if it fails,
  the passages are shown instead.
- Cross-language comparison: for a paragraph, the closest paragraphs in the English and Swedish
  (and Finnish) articles on the same topic, classified as the same claim, related or not found
  by calibrated thresholds, a comparison of the numbers when the claim is the same, and an
  optional short verdict from the answer model that is cached and validated.
- Contract test: every endpoint's real response, success and error, is validated against its
  response model, and every route must have a case. A script exports those responses as JSON
  fixtures, so the web app can be built and tested without the API running.

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

[Unreleased]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DevBytAmir/WikiSnitch/releases/tag/v0.1.0
