"""config/.env is loaded, and a real environment variable still wins (spec §2, Configuration)."""

import os

from apps.api.core.local_env import LOCAL_ENV_PATH, load_local_env

NAME = "MONEYVIEW_TEST_LOCAL_ENV_PROBE"


def _isolate(monkeypatch):
    # setenv then delenv registers an undo that restores "absent", so a value load_dotenv writes
    # directly into os.environ does not leak into later tests.
    monkeypatch.setenv(NAME, "sentinel")
    monkeypatch.delenv(NAME)


def test_the_default_path_is_config_env_at_the_repo_root():
    assert LOCAL_ENV_PATH.parts[-2:] == ("config", ".env")
    assert (LOCAL_ENV_PATH.parent / ".env.example").exists()


def test_a_value_in_the_file_is_loaded(tmp_path, monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SKIP_LOCAL_ENV")
    _isolate(monkeypatch)
    env = tmp_path / ".env"
    env.write_text(f"{NAME}=from-file\n", encoding="utf-8")

    assert load_local_env(env) is True
    assert os.environ[NAME] == "from-file"


def test_a_real_environment_variable_is_not_overridden(tmp_path, monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SKIP_LOCAL_ENV")
    _isolate(monkeypatch)
    monkeypatch.setenv(NAME, "from-environment")
    env = tmp_path / ".env"
    env.write_text(f"{NAME}=from-file\n", encoding="utf-8")

    load_local_env(env)

    assert os.environ[NAME] == "from-environment"


def test_a_missing_file_is_not_an_error(tmp_path, monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SKIP_LOCAL_ENV")
    assert load_local_env(tmp_path / "absent.env") is False


def test_a_value_is_not_loaded_when_skip_local_env_is_set(tmp_path, monkeypatch):
    # conftest already sets MONEYVIEW_SKIP_LOCAL_ENV=1; this test confirms load_local_env
    # honors it instead of just inheriting a value that happens to already be absent.
    monkeypatch.setenv("MONEYVIEW_SKIP_LOCAL_ENV", "1")
    env = tmp_path / ".env"
    env.write_text(f"{NAME}=from-file\n", encoding="utf-8")

    assert load_local_env(env) is False
    assert NAME not in os.environ
