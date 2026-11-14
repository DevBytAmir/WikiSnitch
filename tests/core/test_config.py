import pytest

from core import config
from core.config import MissingSettingError, load_embedding_settings, load_settings

REQUIRED = {
    "DB_HOST": "db.example",
    "DB_PORT": "3310",
    "DB_USER": "app",
    "DB_PASSWORD": "app-secret",
    "DB_ROOT_PASSWORD": "root-secret",
    "DB_NAME": "appdb",
    "DB_VECTOR_SEARCH_DEPTH": "120",
    "EMBEDDER": "openai",
    "EMBED_BASE_URL": "https://embed.example/v1",
    "EMBED_MODEL": "model-x",
    "EMBED_DIMENSIONS": "768",
    "DATA_DIR": "somewhere",
}
OPTIONAL = [
    "EMBED_API_KEY",
    "LLM_ASK_BASE_URL",
    "LLM_ASK_MODEL",
    "LLM_ASK_API_KEY",
    "LLM_ASSESS_BASE_URL",
    "LLM_ASSESS_MODEL",
    "LLM_ASSESS_API_KEY",
]


@pytest.fixture
def clean_environment(monkeypatch, tmp_path):
    """No inherited settings, and a ``.env`` location that is an empty temporary folder."""
    for name in [*REQUIRED, *OPTIONAL]:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(config, "ROOT", tmp_path)
    return tmp_path


def set_environment(monkeypatch, values=REQUIRED):
    for name, value in values.items():
        monkeypatch.setenv(name, value)


def test_environment_variables_supply_every_setting(clean_environment, monkeypatch):
    set_environment(monkeypatch)
    settings = load_settings()
    assert (settings.db_host, settings.db_port, settings.db_user) == ("db.example", 3310, "app")
    assert settings.db_vector_search_depth == 120
    assert settings.embedder == "openai"
    assert settings.embed_base_url == "https://embed.example/v1"
    assert (settings.embed_model, settings.embed_dimensions) == ("model-x", 768)
    assert str(settings.data_dir) == "somewhere"


def test_env_file_supplies_settings_that_the_environment_lacks(clean_environment):
    lines = ["# a comment", "", *(f"{name}={value}" for name, value in REQUIRED.items())]
    (clean_environment / ".env").write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert load_settings().db_name == "appdb"


def test_environment_overrides_the_env_file(clean_environment, monkeypatch):
    (clean_environment / ".env").write_text("DB_NAME=from_file\n", encoding="utf-8")
    set_environment(monkeypatch)
    assert load_settings().db_name == "appdb"


def test_missing_settings_are_all_named_with_the_fix(clean_environment, monkeypatch):
    set_environment(monkeypatch, {k: v for k, v in REQUIRED.items() if k not in {"DB_HOST", "EMBED_MODEL"}})
    with pytest.raises(MissingSettingError) as error:
        load_settings()
    message = str(error.value)
    assert "DB_HOST" in message and "EMBED_MODEL" in message
    assert ".env.example" in message


def test_an_empty_required_setting_counts_as_missing(clean_environment, monkeypatch):
    set_environment(monkeypatch, {**REQUIRED, "DB_PASSWORD": ""})
    with pytest.raises(MissingSettingError, match="DB_PASSWORD"):
        load_settings()


def test_answer_model_settings_are_optional(clean_environment, monkeypatch):
    set_environment(monkeypatch)
    settings = load_settings()
    assert settings.llm_ask_base_url == "" and settings.llm_assess_api_key == ""
    assert settings.embed_api_key == ""


def test_secrets_are_not_in_repr_or_str(clean_environment, monkeypatch):
    set_environment(monkeypatch, {**REQUIRED, "LLM_ASK_API_KEY": "key-one", "LLM_ASSESS_API_KEY": "key-two", "EMBED_API_KEY": "key-three"})
    text = repr(load_settings()) + str(load_settings())
    for secret in ("app-secret", "root-secret", "key-one", "key-two", "key-three"):
        assert secret not in text


def test_embedding_settings_load_without_any_database_setting(clean_environment, monkeypatch):
    embedding_only = {k: v for k, v in REQUIRED.items() if k.startswith(("EMBED", "EMBEDDER"))}
    set_environment(monkeypatch, embedding_only)
    settings = load_embedding_settings()
    assert settings.embedder == "openai" and settings.embed_dimensions == 768
    assert not hasattr(settings, "db_host")


def test_embedding_settings_still_name_what_is_missing(clean_environment, monkeypatch):
    set_environment(monkeypatch, {"EMBEDDER": "ollama"})
    with pytest.raises(MissingSettingError, match="EMBED_BASE_URL"):
        load_embedding_settings()


def test_full_settings_include_the_embedding_settings(clean_environment, monkeypatch):
    set_environment(monkeypatch)
    settings = load_settings()
    assert settings.embed_model == "model-x" and settings.db_name == "appdb"
