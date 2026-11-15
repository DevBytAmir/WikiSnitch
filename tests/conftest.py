"""Test configuration: tests run against their own database and never reach real services."""

import os

os.environ["DB_NAME"] = os.environ.get("TEST_DB_NAME", "wikisnitch_test")
os.environ["EMBEDDER"] = "fake"
# Tests ask many questions in a minute; the rate limit has its own tests.
os.environ["ASK_RATE_LIMIT"] = "0"
# Never reach a real answer model from tests, whatever .env says.
for _name in ("LLM_ASK_BASE_URL", "LLM_ASSESS_BASE_URL", "LLM_ASK_API_KEY", "LLM_ASSESS_API_KEY"):
    os.environ[_name] = ""

import core.thresholds  # noqa: E402

# Tests use the built-in defaults, never the calibrated eval/thresholds.json.
core.thresholds.DEFAULT_PATH = core.thresholds.ROOT / "eval" / "thresholds.tests-use-defaults.json"

import pytest  # noqa: E402

from pipeline.create_tables import recreate_test_database  # noqa: E402
from pipeline.load_fixtures import main as load_fixtures  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def fresh_database():
    """Drop the test database, rebuild it from the schema and load the fixture articles once per
    test run."""
    recreate_test_database()
    load_fixtures()
