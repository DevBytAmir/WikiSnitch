from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.app import app


@pytest.fixture
def client():
    """A client for the real application. Server errors come back as responses, not exceptions."""
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
