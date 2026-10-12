from datetime import date, datetime, timezone

from apps.api.services.db import get_db
from apps.api.services.signals import store
from apps.api.services.signals.fetch import SeriesFetcher, fred_source_from_env
from apps.api.services.webscrap.Collector.FREDCollector import FREDCollector
from packages.core_finance.macro_signals.rules import Observation

NOW = lambda: datetime(2026, 10, 10, tzinfo=timezone.utc)
START = date(2026, 1, 1)


def test_each_series_is_fetched_once_per_run():
    calls = []

    def source(series_id, start):
        calls.append(series_id)
        return [Observation(date(2026, 10, 9), 1.0)]

    fetcher = SeriesFetcher(source, now=NOW)
    fetcher.get_series("DGS10", START)
    fetcher.get_series("DGS10", START)
    assert calls == ["DGS10"]


def test_a_successful_fetch_is_written_to_the_cache(fixture_source):
    SeriesFetcher(fixture_source(), now=NOW).get_series("PAYEMS", START)
    assert store.load_cache("PAYEMS", START)[-1] == Observation(date(2026, 9, 1), 160150.0)


def test_failed_fetch_falls_back_to_cached_observations(fixture_source):
    SeriesFetcher(fixture_source(), now=NOW).get_series("PAYEMS", START)
    result = SeriesFetcher(fixture_source(missing={"PAYEMS"}), now=NOW).get_series("PAYEMS", START)
    assert result.from_cache and "fixture missing" in result.error
    assert result.observations[-1].value == 160150.0


def test_no_key_reports_it_and_uses_the_cache():
    result = SeriesFetcher(None, now=NOW).get_series("DGS10", START)
    assert result.error == "FRED_API_KEY is not set" and result.observations == []


def test_no_key_serves_the_cached_observations(fixture_source):
    SeriesFetcher(fixture_source(), now=NOW).get_series("PAYEMS", START)
    result = SeriesFetcher(None, now=NOW).get_series("PAYEMS", START)
    assert result.from_cache and result.error == "FRED_API_KEY is not set"
    assert result.observations[-1].value == 160150.0


def test_cache_rows_record_the_fetch_time(fixture_source):
    SeriesFetcher(fixture_source(), now=NOW).get_series("PAYEMS", START)
    with get_db() as conn:
        stamps = {r["fetched_at"] for r in conn.execute("SELECT fetched_at FROM fred_cache WHERE series_id = 'PAYEMS'")}
    assert stamps == {"2026-10-10T00:00:00+00:00"}


def test_blank_key_is_treated_as_no_key(monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "   ")
    assert fred_source_from_env() is None


def test_key_from_env_fetches_through_the_collector(monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "k" * 32)
    seen = {}

    def fake_fetch(self, series_id, start_date, timeout=15.0):
        seen.update(series_id=series_id, start=start_date)
        return [("2026-10-09", 5.5)]

    monkeypatch.setattr(FREDCollector, "fetch_observations", fake_fetch)
    source = fred_source_from_env()
    assert source("DGS10", date(2026, 1, 1)) == [Observation(date(2026, 10, 9), 5.5)]
    assert seen == {"series_id": "DGS10", "start": "2026-01-01"}
