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


def test_timeout_is_forwarded_as_fifteen_seconds_by_default(monkeypatch):
    seen = {}

    def fake_get(url, params=None, **kwargs):
        seen["timeout"] = kwargs.get("timeout")
        return FakeResponse(200, {"observations": []})

    monkeypatch.setattr(fred_module.requests, "get", fake_get)
    assert FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01") == []
    assert seen["timeout"] == 15.0


class NonJsonResponse:
    status_code = 200
    text = "<html>maintenance</html>"

    def json(self):
        raise ValueError("Expecting value: line 1 column 1 (char 0)")


def test_connection_failure_raises_with_no_context_holding_the_key(monkeypatch):
    def boom(url, params, timeout):
        raise requests.ConnectionError(f"Max retries exceeded with url: /x?api_key={KEY}")

    monkeypatch.setattr(fred_module.requests, "get", boom)
    with pytest.raises(FredFetchError) as info:
        FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01")
    assert info.value.__context__ is None


def test_non_json_200_body_raises_malformed_without_key_or_cause(monkeypatch):
    monkeypatch.setattr(fred_module.requests, "get", lambda url, params, timeout: NonJsonResponse())
    with pytest.raises(FredFetchError) as info:
        FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01")
    assert str(info.value) == "DGS10: malformed response"
    assert info.value.__cause__ is None and info.value.__context__ is None


def test_payload_without_observations_key_raises_not_empty(monkeypatch):
    monkeypatch.setattr(fred_module.requests, "get",
                        lambda url, params, timeout: FakeResponse(200, {"error_code": 400}))
    with pytest.raises(FredFetchError) as info:
        FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01")
    assert str(info.value) == "DGS10: malformed response"


@pytest.mark.parametrize("payload", [
    [],
    {"observations": {}},
    {"observations": [{"date": "2026-01-01"}]},
    {"observations": [{"date": "2026-01-01", "value": "n/a"}]},
    {"observations": [{"value": "1.0"}]},
])
def test_malformed_payloads_raise_instead_of_returning_rows_or_raw_errors(payload):
    with pytest.raises(FredFetchError, match="malformed response"):
        parse_observations(payload)


def test_non_finite_values_are_skipped_like_missing_dots():
    payload = {"observations": [
        {"date": "2026-01-01", "value": "nan"}, {"date": "2026-01-02", "value": "2.0"},
        {"date": "2026-01-03", "value": "inf"}, {"date": "2026-01-04", "value": "-inf"}]}
    assert parse_observations(payload) == [("2026-01-02", 2.0)]


def test_empty_observations_list_is_no_data_not_malformed():
    assert parse_observations({"observations": []}) == []


def test_a_key_straddling_the_200_character_cut_leaks_no_prefix(monkeypatch):
    # The key starts at character 190 and ends past 200, so truncating before redacting would
    # keep its first ten characters and the full-key replace would miss them.
    body = "a" * 190 + KEY + "b" * 50
    monkeypatch.setattr(fred_module.requests, "get",
                        lambda url, params, timeout: FakeResponse(500, text=body))
    with pytest.raises(FredFetchError) as info:
        FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01")
    message = str(info.value)
    assert message.startswith("DGS10: HTTP 500 ")
    assert all(KEY[:n] not in message for n in range(4, len(KEY) + 1))
