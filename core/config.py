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
from typing import TypeVar

SNAPSHOT = datetime(2026, 10, 1, tzinfo=timezone.utc)
MIN_PARAGRAPH_CHARS = 40
MIN_EMBED_CHARS = 80

ROOT = Path(__file__).resolve().parent.parent


class MissingSettingError(RuntimeError):
    """Raised when a required setting is absent from both the environment and ``.env``."""


@dataclass(frozen=True, kw_only=True)
class EmbeddingSettings:
    """How to reach the embedding model.

    On its own this is all that a machine without a database needs, such as a rented GPU that
    only embeds texts. Secrets are left out of ``repr`` so they never reach a log line.
    """

    embedder: str
    embed_base_url: str
    embed_model: str
    embed_dimensions: int
    embed_api_key: str = dc_field(default="", repr=False)


@dataclass(frozen=True, kw_only=True)
class Settings(EmbeddingSettings):
    """All settings: the database, where datasets live, the embedding model and the answer model."""

    db_host: str
    db_port: int
    db_user: str
    db_password: str = dc_field(repr=False)
    db_root_password: str = dc_field(repr=False)
    db_name: str
    db_vector_search_depth: int
    data_dir: Path
    web_origin: str
    ask_rate_limit: int
    ask_rate_window_seconds: int
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


_COERCE = {
    "db_port": int,
    "db_vector_search_depth": int,
    "embed_dimensions": int,
    "ask_rate_limit": int,
    "ask_rate_window_seconds": int,
    "data_dir": Path,
}
_S = TypeVar("_S", bound=EmbeddingSettings)


def _load(settings_class: type[_S]) -> _S:
    """Fill a settings class from the environment, then ``.env``.

    Raises ``MissingSettingError`` listing every required setting that is absent or empty.
    """
    file_values = _read_env_file(ROOT / ".env")
    values: dict[str, object] = {}
    missing: list[str] = []
    for field in fields(settings_class):
        name = field.name.upper()
        raw = os.environ.get(name, file_values.get(name))
        required = field.default is MISSING
        if raw is None or (required and raw == ""):
            if required:
                missing.append(name)
            continue
        values[field.name] = _COERCE.get(field.name, str)(raw)
    if missing:
        raise MissingSettingError(
            f"Missing settings: {', '.join(missing)}. Copy .env.example to .env and fill them in."
        )
    return settings_class(**values)


def load_settings() -> Settings:
    """Every setting. Needs the database settings as well as the embedding ones."""
    return _load(Settings)


def load_embedding_settings() -> EmbeddingSettings:
    """Only the embedding settings, for machines that have no database."""
    return _load(EmbeddingSettings)
