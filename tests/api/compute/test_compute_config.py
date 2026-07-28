# tests/api/compute/test_compute_config.py
from apps.api.compute.config import (
    compute_client_mode,
    compute_connect_timeout,
    compute_service_base_url,
    compute_stream_read_timeout,
    compute_timeout,
)
from apps.api.compute.errors import ComputeError


def test_defaults_when_env_unset(monkeypatch):
    for key in (
        "MONEYVIEW_COMPUTE_CLIENT_MODE",
        "MONEYVIEW_COMPUTE_SERVICE_BASE_URL",
        "MONEYVIEW_COMPUTE_CONNECT_TIMEOUT",
        "MONEYVIEW_COMPUTE_TIMEOUT",
        "MONEYVIEW_COMPUTE_STREAM_READ_TIMEOUT",
    ):
        monkeypatch.delenv(key, raising=False)
    assert compute_client_mode() == "inprocess"
    assert compute_service_base_url() == "http://127.0.0.1:8600"
    assert compute_connect_timeout() == 2.0
    assert compute_timeout() == 30.0
    assert compute_stream_read_timeout() == 300.0


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("MONEYVIEW_COMPUTE_CLIENT_MODE", "HTTP")
    monkeypatch.setenv("MONEYVIEW_COMPUTE_TIMEOUT", "12.5")
    assert compute_client_mode() == "http"
    assert compute_timeout() == 12.5


def test_compute_error_carries_status_and_detail():
    err = ComputeError(status_code=422, detail="bad input")
    assert err.status_code == 422
    assert err.detail == "bad input"
    assert "bad input" in str(err)
