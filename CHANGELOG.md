# Changelog

All notable changes to WikiSnitch are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- MIT licence, ignore rules for secrets, data files, caches and build output, and the
  Python 3.12 version pin.
- Python project with uv, Makefile targets, a MariaDB 12.3 container and an environment
  template. Database, embedding and vector search settings live in `.env`, not in the code;
  `make setup` creates it from `.env.example`.
