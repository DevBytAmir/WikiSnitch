"""Validation of request parameters."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from api.errors import ApiError
from core.config import SNAPSHOT

LANGUAGES = frozenset({"fi", "sv", "en"})
_DATE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$")


def parse_lang(value: str) -> str:
    """The language code, or a 400 error if it is not fi, sv or en."""
    if value not in LANGUAGES:
        raise ApiError(400, "bad_request", f"Unknown language '{value}'.")
    return value


def parse_as_of(value: str | None) -> datetime:
    """Parse the ``as_of`` parameter into a UTC datetime, never later than the data snapshot.

    Accepts a date, a date and time, or ISO 8601 with a zone. Empty or missing means the snapshot.
    Raises a 400 error for anything else.
    """
    if value is None or value == "":
        return SNAPSHOT

    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            parsed = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        elif _DATE_TIME.fullmatch(value):
            format_string = "%Y-%m-%d %H:%M:%S" if value.count(":") == 2 else "%Y-%m-%d %H:%M"
            parsed = datetime.strptime(value, format_string).replace(tzinfo=timezone.utc)
        else:
            iso_value = value[:-1] + "+00:00" if value.endswith("Z") else value
            parsed = datetime.fromisoformat(iso_value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            else:
                parsed = parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        raise ApiError(400, "bad_request", "as_of must be a date such as 2015-06-01.") from None

    return min(parsed, SNAPSHOT)
