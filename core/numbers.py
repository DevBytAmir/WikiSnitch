"""Years and other numbers in a text, normalised so that formatting does not matter."""

import re

_NUMBER_RE = re.compile(r"\d{1,3}(?:[\u00a0\u202f .,]\d{3})+(?!\d)|\d+")
_FIELD_LIMIT = 1000


def extract_numbers(text: str) -> list[str]:
    """Distinct numbers of two or more digits, sorted by value.

    ``25 000``, ``25,000`` and ``25000`` (also with a non-breaking space) are the same number.
    """
    values = set()
    for match in _NUMBER_RE.finditer(text):
        digits = "".join(ch for ch in match.group() if ch.isdecimal())
        if len(digits) >= 2:
            values.add(digits)
    return sorted(values, key=int)


def numbers_field(text: str) -> str:
    """The numbers as one comma-separated string that fits the 1000-character database column,
    cut at the last whole number that fits."""
    kept: list[str] = []
    length = 0
    for value in extract_numbers(text):
        needed = length + len(value) if not kept else length + 1 + len(value)
        if needed > _FIELD_LIMIT:
            break
        length = needed
        kept.append(value)
    return ",".join(kept)


def diff_numbers(a_field: str, b_field: str) -> tuple[list[str], list[str]]:
    """Numbers only in the first field, and numbers only in the second, each sorted by value."""
    a = {value for value in a_field.split(",") if value}
    b = {value for value in b_field.split(",") if value}
    return sorted(a - b, key=int), sorted(b - a, key=int)
