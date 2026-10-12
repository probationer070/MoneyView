import logging

import pytest
import requests

from apps.api.services.webscrap.Collector import FREDCollector as fred_module
from apps.api.services.webscrap.Collector.FREDCollector import (
    FREDCollector, FredFetchError, parse_observations,
)

KEY = "abcdef0123456789abcdef0123456789"


class FakeResponse:
    def __init__(self, status, payload=None, text=""):
        self.status_code, self._payload, self.text = status, payload, text

    def json(self):
        return self._payload


def test_parse_drops_missing_dots_and_sorts_ascending():
    payload = {"observations": [
        {"date": "2026-10-02", "value": "5.5"}, {"date": "2026-10-01", "value": "."},
        {"date": "2026-09-30", "value": "5.4"}]}
    assert parse_observations(payload) == [("2026-09-30", 5.4), ("2026-10-02", 5.5)]


def test_fetch_observations_passes_a_timeout_and_asc_order(monkeypatch):
    seen = {}

    def fake_get(url, params, timeout):
        seen.update(params=params, timeout=timeout)
        return FakeResponse(200, {"observations": [{"date": "2026-10-01", "value": "1"}]})

    monkeypatch.setattr(fred_module.requests, "get", fake_get)
    assert FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01") == [("2026-10-01", 1.0)]
    assert seen["timeout"] == 15.0 and seen["params"]["sort_order"] == "asc"


def test_connection_error_message_never_contains_the_key(monkeypatch, caplog):
    def boom(url, params, timeout):
        raise requests.ConnectionError(f"Max retries exceeded with url: /x?api_key={KEY}")

    monkeypatch.setattr(fred_module.requests, "get", boom)
    caplog.set_level(logging.DEBUG)
    with pytest.raises(FredFetchError) as info:
        FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01")
    assert KEY not in str(info.value)
    assert info.value.__cause__ is None and info.value.__suppress_context__
    assert KEY not in caplog.text


def test_http_error_body_is_redacted(monkeypatch):
    monkeypatch.setattr(fred_module.requests, "get",
                        lambda url, params, timeout: FakeResponse(400, text=f"bad api_key {KEY}"))
    with pytest.raises(FredFetchError) as info:
        FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01")
    assert KEY not in str(info.value) and "HTTP 400" in str(info.value)
