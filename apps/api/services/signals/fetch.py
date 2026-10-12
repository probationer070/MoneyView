"""FRED access for one engine run: each series once, the cache when FRED is unreachable."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable

from apps.api.services.signals import store
from apps.api.services.webscrap.Collector.FREDCollector import FREDCollector, FredFetchError
from packages.core_finance.macro_signals.rules import Observation

SeriesSource = Callable[[str, date], list[Observation]]


@dataclass(frozen=True)
class FetchedSeries:
    observations: list[Observation]
    error: str | None
    from_cache: bool


def fred_source_from_env() -> SeriesSource | None:
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        return None
    collector = FREDCollector(key)

    def source(series_id: str, start: date) -> list[Observation]:
        rows = collector.fetch_observations(series_id, start.isoformat())
        try:
            return [Observation(date.fromisoformat(d), v) for d, v in rows]
        except ValueError:
            raise FredFetchError(f"{series_id}: malformed date") from None
    return source


class SeriesFetcher:
    def __init__(self, source: SeriesSource | None, *, now: Callable[[], datetime]):
        self._source = source
        self._now = now
        self._memo: dict[str, FetchedSeries] = {}

    def get_series(self, series_id: str, start: date) -> FetchedSeries:
        if series_id not in self._memo:
            self._memo[series_id] = self._fetch(series_id, start)
        return self._memo[series_id]

    def _fetch(self, series_id: str, start: date) -> FetchedSeries:
        if self._source is None:
            return self._from_cache(series_id, start, "FRED_API_KEY is not set")
        try:
            observations = self._source(series_id, start)
        except FredFetchError as exc:
            return self._from_cache(series_id, start, str(exc))
        store.save_cache(series_id, observations, self._now().isoformat(timespec="seconds"))
        return FetchedSeries(observations, None, False)

    def _from_cache(self, series_id: str, start: date, reason: str) -> FetchedSeries:
        return FetchedSeries(store.load_cache(series_id, start), reason, True)
