<div align="center">

# WikiSnitch

### Wikipedia, with a memory

Select a paragraph of a Finnish Wikipedia article and see how its claim changed over its edit history,
which edits were vandalism that got undone, and what the English and Swedish articles say about it.
Ask a question and get an answer cited to paragraphs, each with a trust badge.

[![CI](https://img.shields.io/github/actions/workflow/status/DevBytAmir/WikiSnitch/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=202122&color=3366cc)](https://github.com/DevBytAmir/WikiSnitch/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/DevBytAmir/WikiSnitch?style=for-the-badge&label=Version&labelColor=202122&color=3366cc)](https://github.com/DevBytAmir/WikiSnitch/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-72777d?style=for-the-badge&labelColor=202122)](LICENSE)
<br/>
[![MariaDB](https://img.shields.io/badge/MariaDB-12.3-003545?style=for-the-badge&labelColor=202122&logo=mariadb&logoColor=white)](#how-it-uses-mariadb)
[![Python](https://img.shields.io/badge/Python-3.12-3776ab?style=for-the-badge&labelColor=202122&logo=python&logoColor=white)](pyproject.toml)
[![TypeScript](https://img.shields.io/badge/TypeScript-React%20%2B%20Vite-3178c6?style=for-the-badge&labelColor=202122&logo=typescript&logoColor=white)](web/package.json)
[![Junction 2026](https://img.shields.io/badge/Junction-2026-72777d?style=for-the-badge&labelColor=202122)](#credits-and-licensing)

</div>

---

## Table of Contents

1. [What it does](#what-it-does)
2. [How it uses MariaDB](#how-it-uses-mariadb)
3. [The data](#the-data)
4. [Retrieval benchmark](#retrieval-benchmark)
5. [Quick start](#quick-start)
6. [Configuration](#configuration)
7. [Embedding on another machine](#embedding-on-another-machine)
8. [API](#api)
9. [Project structure](#project-structure)
10. [Testing](#testing)
11. [Releases](#releases)
12. [Credits and licensing](#credits-and-licensing)

## What it does

Readers cannot tell whether a sentence on Wikipedia has stood for ten years or was rewritten last week,
and editors have no quick way to find the claims that need attention. WikiSnitch answers both, paragraph by
paragraph.

- **Through time.** Every paragraph keeps its identity across thousands of edits. Select one to see when it
  appeared, every change to its wording, how far its meaning moved, when a number or date changed, and which
  edits were vandalism that was undone, with a link to the exact Wikipedia revision for each state.
- **Time machine.** Play an article's history, step between changes or jump to a date, over a chart of its
  length, of each paragraph's life, or of its edits and reverts per month. Compare any two dates.
- **Across languages.** The closest paragraph in the English and Swedish articles on the same topic, how close
  it is, and whether the numbers agree. Meaning can match while a date does not, so numbers are compared
  separately.
- **Trust badge.** Every paragraph is *stable*, *changed recently*, *disputed* or *new*, with the reasons.
- **Ask.** A question in Finnish, Swedish or English gets an answer cited to specific paragraphs, each with its
  badge. Add a date and the answer comes from Wikipedia as it stood then. Without an answer model, or when
  nothing is close enough, it shows the closest passages or says so, and never guesses.
- **Review queue** for editors: the paragraphs that changed recently, are disputed or unsourced, or disagree
  with the other languages.
- **Show SQL** on every screen: the exact MariaDB statements behind what you see.

Similarity measures meaning, not truth. WikiSnitch never claims which of two texts is right.

## How it uses MariaDB

| Feature | Where |
|:---|:---|
| System-versioned tables | `paragraph` and `article_history` are `WITH SYSTEM VERSIONING`. One row per paragraph, and MariaDB keeps every earlier state. |
| Real edit times | History is loaded with `system_versioning_insert_history`, so MariaDB's own timeline matches Wikipedia's. |
| Vector search | `text_vector` holds one `VECTOR(1024)` per distinct paragraph text, with a cosine `VECTOR INDEX`. |
| Both at once | "What did Wikipedia say about this in 2012?" is one statement: a vector search joined to `paragraph FOR SYSTEM_TIME AS OF`. |
| Window functions | Reverts are found with `LAG` over `FOR SYSTEM_TIME ALL`. |

The query behind *Ask* for a past date, shortened:

```sql
SELECT v.distance, p.lang, p.page_id, p.para_id, p.text
FROM (
  SELECT text_hash, VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
  FROM text_vector
  WHERE lang = 'fi'
  ORDER BY distance
  LIMIT 200
) v
JOIN paragraph FOR SYSTEM_TIME AS OF TIMESTAMP ? AS p
  ON p.text_hash = v.text_hash AND p.lang = 'fi' AND p.undone = 0
ORDER BY v.distance
```

Every statement the API runs lives in [`api/queries.py`](api/queries.py), and the interface shows them.

Three things we found that may help others:

- A current row's `row_end` reads back as `2106-02-07 06:28:15.999999`, so filtering current rows with
  `row_end IS NULL` silently returns nothing.
- `TEXT` is too small for some real paragraph states (one is 266 KB). History tables need `MEDIUMTEXT`.
- Searching the vector index first and joining afterwards is what makes the search fast. Joining the paragraphs
  before sorting by distance cannot use the index: on the full data it took 140 to 170 seconds per question,
  against 2 to 4 seconds.

## The data

| | |
|:---|---:|
| Articles | 29,460 (Finnish 19,285, English 5,254, Swedish 4,921) |
| History set | 50 articles, 31,848 versions, 2003 to 2026 |
| Paragraph states in the history set | 44,091, of which 6,743 came from edits that were later undone |
| Paragraph vectors | 236,131 (bge-m3, 1024 dimensions) |

Text and edit history come from [MariaDB's Wikipedia datasets](#credits-and-licensing). 208,468 of the paragraph
vectors were embedded in 33.5 minutes on one rented GPU. They are kept as checksummed Parquet files outside this
repository, so they need not be embedded again.

## Retrieval benchmark

MariaDB's own 37 Finland history questions, asking which article a search finds in its top 5 or 10. Paragraph
vectors find the exact paragraph, which citations, per-claim history and cross-language checks need, but they
are not better at finding the article overall:

<div align="center">

| Language | Article vectors, top 5 | Paragraph vectors, top 5 | Article vectors, top 10 | Paragraph vectors, top 10 |
|:---|:---:|:---:|:---:|:---:|
| All (37) | 76% | 70% | 89% | 86% |
| English (13) | 69% | **85%** | 85% | **100%** |
| Swedish (11) | 82% | 82% | 100% | 91% |
| Finnish (13) | **77%** | 46% | **85%** | 69% |

</div>

The full table, with top 1 and the mean reciprocal rank, is in [`eval/benchmark.md`](eval/benchmark.md). The
similarity thresholds were calibrated on 60 hand-labelled paragraph pairs ([`eval/calibration.tsv`](eval/calibration.tsv)).

## Quick start

You need Docker or Podman, [uv](https://docs.astral.sh/uv/) with Python 3.12, Node 22 or newer, and
[Ollama](https://ollama.com/) with the embedding model for questions (`ollama pull bge-m3`).

```bash
make setup        # creates .env from .env.example, starts MariaDB, installs dependencies, creates the tables
make load-hero    # downloads the datasets and loads the 50 history articles (needs Ollama; about an hour)
make dev          # API on http://localhost:8000

cd web
npm install
npm run dev       # web app on http://localhost:5173
```

With Podman, run `make COMPOSE="podman compose" setup`.

To try the interface without any data, run `npm run dev:fixtures` in `web/`. It serves recorded API responses
and needs neither the API nor the database. `make dev-fixtures` instead starts the API on a small fixture
database.

## Configuration

Everything that depends on the machine is read from `.env` or from the environment, which wins. There are no
defaults in the code: a missing setting stops start-up with a message that names it. `.env.example` lists
every setting.

| Setting | Meaning |
|:---|:---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `DB_NAME` | The MariaDB container; `docker-compose.yml` reads the same values |
| `DB_VECTOR_SEARCH_DEPTH` | Candidates the vector index examines per search |
| `EMBEDDER` | `ollama`, `openai` (any OpenAI-compatible `/embeddings` API) or `fake` (tests) |
| `EMBED_BASE_URL`, `EMBED_MODEL`, `EMBED_API_KEY`, `EMBED_DIMENSIONS` | The embedding service. The dimensions must match the `VECTOR` column |
| `LLM_ASK_*`, `LLM_ASSESS_*` | Optional answer model for *Ask* and for cross-language verdicts: base URL, model, key |
| `DATA_DIR` | Where downloaded datasets live (git-ignored) |
| `WEB_ORIGIN` | The address the API accepts browser requests from |
| `ASK_RATE_LIMIT`, `ASK_RATE_WINDOW_SECONDS` | How many questions one visitor may ask in each window. Every question can cost money on the answer model, so a visitor over the limit gets a 429 answer. 0 turns the limit off |

The answer model key is read by the API only and never reaches the browser.

## Embedding on another machine

Embedding every paragraph is a one-off job that a rented GPU does in minutes. It needs no database and only
the `EMBED_*` settings:

```bash
python -m pipeline.export_texts --out texts.parquet                              # on the machine with the database
python -m pipeline.embed_file --in texts.parquet --out vectors/ [--base-url URL]   # anywhere
python -m pipeline.import_vectors vectors/                                       # back on the database machine
```

`embed_file` writes numbered parts of 2,000 vectors, resumes after a stop, retries a failing server and splits
batches rather than losing work, and records any text that keeps failing in `failed.txt`.

## API

Interactive documentation is served at `/docs`. Every error has the same body, `{"error": {"code", "message"}}`.

| Endpoint | Returns |
|:---|:---|
| `GET /api/health` | Status, data snapshot date, whether the embedder is reachable, row counts |
| `GET /api/articles` | Articles with search; history articles first |
| `GET /api/articles/{lang}/{page_id}?as_of=` | An article with a trust badge per paragraph, now or at an earlier date |
| `GET /api/articles/{lang}/{page_id}/timeline` | Edits and reverts per month |
| `GET /api/articles/{lang}/{page_id}/review` | The review queue |
| `GET /api/paragraphs/{lang}/{page_id}/{para_id}/history` | Every state of a paragraph with diffs |
| `GET /api/paragraphs/{lang}/{page_id}/{para_id}/crosslang` | What the other languages say |
| `POST /api/ask` | An answer cited to paragraphs |

## Project structure

```
api/        FastAPI application; all SQL in queries.py
core/       Settings, database connection, text cleaning, embedders, paragraph lineage, badges
db/         The schema and the fixture articles
eval/       Threshold calibration, retrieval benchmark, dataset measurements
pipeline/   Download, load, embed, signals, vector files for remote embedding
tests/      Python tests; they run in their own database and never need a network
web/        React, TypeScript and Vite interface, with recorded fixtures
```

## Testing

```bash
make test                 # lint and all Python tests
cd web && npm test        # web tests
cd web && npm run build   # typecheck and production build
```

The Python tests run in their own database, `wikisnitch_test`, rebuilt from fixture articles with a known edit
history at the start of every run. They use a deterministic fake embedder, so they need no embedding service,
no real data and no network. They also refuse to touch any database whose name does not end in `_test`. GitHub
Actions runs the same commands on every pull request and every push to `main`.

## Releases

Versions follow [Semantic Versioning](https://semver.org/) and every release has a signed tag. What changed in
each is in [`CHANGELOG.md`](CHANGELOG.md), and on the [releases page](https://github.com/DevBytAmir/WikiSnitch/releases).

| Version | Adds |
|:---:|:---|
| `0.6.0` | The web app and CI |
| `0.5.0` | Threshold calibration and the retrieval benchmark |
| `0.4.0` | The HTTP API |
| `0.3.0` | The data pipeline |
| `0.2.0` | The core library |
| `0.1.0` | The foundation: project setup and the MariaDB schema |

## Credits and licensing

The code is released under the [MIT License](LICENSE).

Article text comes from Wikipedia and is shared under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Every article page links to the exact version it
shows.

Built for the MariaDB challenge at Junction 2026 with:

- MariaDB's Wikipedia datasets and demos, all MIT-licensed:
  [`mariadb-wikipedia-datasets`](https://github.com/MariaDB/mariadb-wikipedia-datasets),
  [`mariadb-vector-wikipedia-rag`](https://github.com/MariaDB/mariadb-vector-wikipedia-rag) (the article vectors and
  the 37 test questions) and
  [`mariadb-system-versioning-wikipedia`](https://github.com/MariaDB/mariadb-system-versioning-wikipedia) (the edit
  history and the revert detection we adapted).
- [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3) for embeddings (MIT).
- [Verda](https://verda.com/) for the GPU that embedded the paragraphs and for the inference API behind *Ask*.

Built by [@DevBytAmir](https://github.com/DevBytAmir), [@gesk-u](https://github.com/gesk-u) and
[@amberward423](https://github.com/amberward423).
