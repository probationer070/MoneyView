from datetime import date, datetime, timezone

from apps.api.services.signals import store
from apps.api.services.signals.fetch import SeriesFetcher
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
