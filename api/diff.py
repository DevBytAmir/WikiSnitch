"""Word-level differences between two texts."""

from __future__ import annotations

from difflib import SequenceMatcher


def word_diff(old: str, new: str) -> list[dict]:
    """Compare two texts word by word.

    Returns operations in reading order: ``equal``, ``delete`` and ``insert``, each with the
    words concerned. A replaced run is a delete followed by an insert.
    """
    a, b = old.split(), new.split()
    result: list[dict] = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            result.append({"op": "equal", "text": " ".join(a[i1:i2])})
            continue
        if i2 > i1:
            result.append({"op": "delete", "text": " ".join(a[i1:i2])})
        if j2 > j1:
            result.append({"op": "insert", "text": " ".join(b[j1:j2])})
    return result
