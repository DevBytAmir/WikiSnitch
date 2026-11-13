"""Application settings.

Every environment-specific value comes from ``.env`` or from the real environment, which wins.
The code holds no defaults for them: a missing value stops start-up with a message that names
it. ``.env.example`` lists every setting. The answer model is optional and stays empty when
unused.
"""

import os
from dataclasses import MISSING, dataclass, fields
from dataclasses import field as dc_field
from datetime import datetime, timezone
from pathlib import Path

SNAPSHOT = datetime(2026, 10, 1, tzinfo=timezone.utc)
MIN_PARAGRAPH_CHARS = 40
MIN_EMBED_CHARS = 80

ROOT = Path(__file__).resolve().parent.parent


class MissingSettingError(RuntimeError):
    """Raised when a required setting is absent from both the environment and ``.env``."""


@dataclass(frozen=True)
class Settings:
    """All settings. Secrets are left out of ``repr`` so they never reach a log line."""

    db_host: str
    db_port: int
    db_user: str
    db_password: str = dc_field(repr=False)
    db_root_password: str = dc_field(repr=False)
    db_name: str
    db_vector_search_depth: int
    embedder: str
    embed_base_url: str
    embed_model: str
    embed_dimensions: int
    data_dir: Path
    embed_api_key: str = dc_field(default="", repr=False)
    llm_ask_base_url: str = ""
    llm_ask_model: str = ""
    llm_ask_api_key: str = dc_field(default="", repr=False)
    llm_assess_base_url: str = ""
    llm_assess_model: str = ""
    llm_assess_api_key: str = dc_field(default="", repr=False)


def _read_env_file(path: Path) -> dict[str, str]:
    """Read ``NAME=value`` lines, ignoring blank lines and ``#`` comments."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def load_settings() -> Settings:
    """Build the settings from the environment, then ``.env``.

    Raises ``MissingSettingError`` listing every required setting that is absent or empty.
    """
    file_values = _read_env_file(ROOT / ".env")
    coerce = {"db_port": int, "db_vector_search_depth": int, "embed_dimensions": int, "data_dir": Path}
    values: dict[str, object] = {}
    missing: list[str] = []
    for field in fields(Settings):
        name = field.name.upper()
        raw = os.environ.get(name, file_values.get(name))
        required = field.default is MISSING
        if raw is None or (required and raw == ""):
            if required:
                missing.append(name)
            continue
        values[field.name] = coerce.get(field.name, str)(raw)
    if missing:
        raise MissingSettingError(
            f"Missing settings: {', '.join(missing)}. Copy .env.example to .env and fill them in."
        )
    return Settings(**values)
