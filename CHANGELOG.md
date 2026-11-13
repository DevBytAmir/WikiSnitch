# Changelog

All notable changes to WikiSnitch are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Settings loaded from the environment or `.env` with no defaults in code: a missing value
  stops start-up and is named in the message. Secrets are hidden from `repr`. The database
  connection is always UTC and uses the configured vector search depth.
- Text cleaning: wikitext and Markdown become headings, paragraphs and list items with
  citation counts, and each distinct text gets a stable MD5 identity.

## [0.1.0] - 2026-11-14

### Added

- MIT licence, ignore rules for secrets, data files, caches and build output, and the
  Python 3.12 version pin.
- Python project with uv, Makefile targets, a MariaDB 12.3 container and an environment
  template. Database, embedding and vector search settings live in `.env`, not in the code;
  `make setup` creates it from `.env.example`.
- MariaDB schema: system-versioned `paragraph` and `article_history` tables, a cosine vector
  index on `text_vector`, and tables for signals, coverage gaps and cached answers.

[Unreleased]: https://github.com/DevBytAmir/WikiSnitch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DevBytAmir/WikiSnitch/releases/tag/v0.1.0
