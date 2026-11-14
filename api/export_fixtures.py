"""Write one JSON file per contract case from the fixture test database.

The web app develops and tests against these files, so it can run without the API. They are real
responses of the real application, with a fake embedder and a fake answer model, so they are
repeatable. It refuses to run against any database whose name does not end in ``_test``.

    python -m api.export_fixtures [--out web/fixtures] [--prepare]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

os.environ["EMBEDDER"] = "fake"

from fastapi.testclient import TestClient  # noqa: E402

from api.app import app  # noqa: E402
from api.llm import FakeLlm  # noqa: E402
from api.routes.ask import get_ask_llm, get_question_embedder  # noqa: E402
from core.config import load_settings  # noqa: E402
from core.embedder import EmbedderUnavailable  # noqa: E402

QUESTION = (
    "Milloin Testisota alkoi vuonna 1939 ja siinä kuoli noin 70 000 sotilasta "
    "pohjoisen rajan taisteluissa?"
)
OLD_QUESTION = QUESTION.replace("70 000", "25 000")
REPLY = "Sota alkoi 1939 [1]."

GET = "GET"
POST = "POST"

CASES = [
    ("health", GET, "/api/health", None, "llm"),
    ("articles", GET, "/api/articles", None, "llm"),
    ("article-fi-9001", GET, "/api/articles/fi/9001", None, "llm"),
    ("article-fi-9001-asof-2006", GET, "/api/articles/fi/9001?as_of=2006-06-01", None, "llm"),
    ("article-fi-9003", GET, "/api/articles/fi/9003", None, "llm"),
    ("article-en-8001", GET, "/api/articles/en/8001", None, "llm"),
    ("timeline-fi-9001", GET, "/api/articles/fi/9001/timeline", None, "llm"),
    ("history-fi-9001-1", GET, "/api/paragraphs/fi/9001/1/history", None, "llm"),
    ("history-fi-9001-2", GET, "/api/paragraphs/fi/9001/2/history", None, "llm"),
    ("history-fi-9001-3", GET, "/api/paragraphs/fi/9001/3/history", None, "llm"),
    ("history-fi-9001-5", GET, "/api/paragraphs/fi/9001/5/history", None, "llm"),
    ("crosslang-fi-9001-1", GET, "/api/paragraphs/fi/9001/1/crosslang", None, "llm"),
    ("crosslang-fi-9001-4", GET, "/api/paragraphs/fi/9001/4/crosslang", None, "llm"),
    ("crosslang-fi-9002-1", GET, "/api/paragraphs/fi/9002/1/crosslang", None, "llm"),
    ("review-fi-9001", GET, "/api/articles/fi/9001/review", None, "llm"),
    ("ask-generated", POST, "/api/ask", {"question": QUESTION}, "llm"),
    ("ask-extractive", POST, "/api/ask", {"question": QUESTION}, "no_llm"),
    ("ask-no-answer", POST, "/api/ask", {"question": "zzz qqq xxx"}, "llm"),
    ("ask-asof-2012", POST, "/api/ask", {"question": OLD_QUESTION, "as_of": "2012-01-01"}, "llm"),
    ("error-404", GET, "/api/articles/fi/99999", None, "llm"),
    ("error-409", GET, "/api/articles/fi/9003/timeline", None, "llm"),
    ("error-503", POST, "/api/ask", {"question": QUESTION}, "embedder_down"),
]


class DownEmbedder:
    """An embedder that always fails, to record the 503 response."""

    model = "down"

    def embed(self, texts):
        raise EmbedderUnavailable("down")


def apply_overrides(mode: str) -> None:
    """Choose the answer model and embedder for a case: ``llm``, ``no_llm`` or ``embedder_down``."""
    app.dependency_overrides.clear()
    if mode == "embedder_down":
        app.dependency_overrides[get_question_embedder] = lambda: DownEmbedder()
    llm = None if mode == "no_llm" else FakeLlm(REPLY)
    app.dependency_overrides[get_ask_llm] = lambda: llm


def clear_llm_cache() -> None:
    """Forget cached model answers, so every export gives the model's fake reply again."""
    from core.db import connect

    con = connect()
    try:
        with con.cursor() as cursor:
            cursor.execute("DELETE FROM llm_cache")
        con.commit()
    finally:
        con.close()


def export(out: Path) -> list[Path]:
    """Call every case and write its JSON response to ``out``. Returns the files written."""
    out.mkdir(parents=True, exist_ok=True)
    clear_llm_cache()
    written = []
    with TestClient(app, raise_server_exceptions=False) as client:
        for name, method, url, body, mode in CASES:
            apply_overrides(mode)
            response = client.post(url, json=body) if method == POST else client.get(url)
            path = out / f"{name}.json"
            payload = json.dumps(response.json(), indent=2, ensure_ascii=False) + "\n"
            path.write_text(payload, encoding="utf-8")
            written.append(path)
    app.dependency_overrides.clear()
    return written


def main(argv: list[str] | None = None) -> int:
    """Command line. ``--prepare`` first rebuilds the test database and loads the fixtures."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="web/fixtures", type=Path)
    parser.add_argument("--prepare", action="store_true", help="recreate and load the test database first")
    args = parser.parse_args(argv)

    if not load_settings().db_name.endswith("_test"):
        print("Refusing to run: DB_NAME must end with _test (fixture database only).", file=sys.stderr)
        return 1
    if args.prepare:
        from pipeline.create_tables import recreate_test_database
        from pipeline.load_fixtures import main as load_fixtures

        recreate_test_database()
        load_fixtures()
    for path in export(args.out):
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
