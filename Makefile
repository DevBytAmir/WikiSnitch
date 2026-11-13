COMPOSE ?= docker compose
FIXTURE_ENV = DB_NAME=wikisnitch_test EMBEDDER=fake

.PHONY: setup test dev dev-fixtures db-shell

setup:
	@test -f .env || { cp .env.example .env; echo "created .env from .env.example"; }
	$(COMPOSE) up -d --wait
	uv sync
	uv run python -m pipeline.create_tables

test:
	uv run ruff check .
	uv run pytest -q

dev:
	uv run uvicorn api.app:app --reload --port 8000

dev-fixtures:
	$(FIXTURE_ENV) uv run python -c "from pipeline.create_tables import recreate_test_database; recreate_test_database()"
	$(FIXTURE_ENV) uv run python -m pipeline.load_fixtures
	$(FIXTURE_ENV) uv run uvicorn api.app:app --reload --port 8000

db-shell:
	$(COMPOSE) exec mariadb sh -c 'mariadb -u"$$MARIADB_USER" -p"$$MARIADB_PASSWORD" "$$MARIADB_DATABASE"'
