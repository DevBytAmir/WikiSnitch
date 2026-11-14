"""Similarity thresholds that decide what counts as the same claim, a related one or a change of
meaning.

The values are calibrated against hand-labelled pairs and kept in ``eval/thresholds.json``. When
that file is missing, the built-in defaults apply and ``calibrated`` is false.
"""

import json
from dataclasses import dataclass, fields
from pathlib import Path

from core.config import ROOT


@dataclass(frozen=True)
class Thresholds:
    """Cosine similarity cut-offs. ``ask_min`` is the lowest score at which *Ask* answers."""

    calibrated: bool = False
    same_claim: float = 0.75
    related: float = 0.60
    ask_min: float = 0.45
    meaning_change: float = 0.90


DEFAULT_PATH = ROOT / "eval" / "thresholds.json"


def load_thresholds(path: Path | None = None) -> Thresholds:
    """Read the thresholds file, ignoring unknown keys. Missing file means the defaults."""
    path = Path(path) if path is not None else DEFAULT_PATH
    if not path.exists():
        return Thresholds()
    data = json.loads(path.read_text(encoding="utf-8"))
    names = {f.name for f in fields(Thresholds)}
    return Thresholds(**{k: v for k, v in data.items() if k in names})
