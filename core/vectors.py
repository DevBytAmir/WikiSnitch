"""Vectors as Python lists and as the JSON text that MariaDB reads and writes."""

import json
from collections.abc import Sequence

import numpy as np


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity of two vectors, or 0.0 if either has zero length."""
    x = np.asarray(a, dtype=np.float64)
    y = np.asarray(b, dtype=np.float64)
    norm = float(np.linalg.norm(x) * np.linalg.norm(y))
    if norm == 0.0:
        return 0.0
    return float(x @ y) / norm


def to_sql(vector: Sequence[float]) -> str:
    """Format a vector for ``VEC_FromText``."""
    return json.dumps(list(vector))


def from_sql(text: str) -> list[float]:
    """Parse the text that ``VEC_ToText`` returns."""
    return [float(x) for x in json.loads(text)]
