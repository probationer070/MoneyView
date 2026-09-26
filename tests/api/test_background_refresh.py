"""Stale OHLCV served at once, with the live refresh moved off the request (spreads)."""
import threading
from datetime import date, timedelta

import pytest

from apps.api.services import market_data as market_data_module
from apps.api.services import market_spreads
from apps.api.services.market_data import MarketDataService

STALE_END = date(2026, 1, 2)


def _row(row_date: date, close: float = 10.0) -> dict:
    return {"date": row_date.isoformat(), "open": close, "high": close, "low": close,
            "close": close, "volume": 1}


def _stale_service(monkeypatch, fill):
    """A service whose cache holds 100 stale rows, and whose live fetch is `fill`."""
    service = MarketDataService()
    rows = [_row(STALE_END - timedelta(days=offset)) for offset in range(100)]
    monkeypatch.setattr(service, "_select_ohlcv_rows", lambda conn, ticker, table, days: rows)
    monkeypatch.setattr(service, "_rows_are_fresh", lambda rows: False)
    monkeypatch.setattr(service, "_fill_ohlcv_cache", fill)
    return service


class _BlockingFill:
    """A live fetch that does not return until the test releases it."""

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = 0
        self._lock = threading.Lock()

    def __call__(self, ticker, *, period, table, reason):
        with self._lock:
            self.calls += 1
        self.started.set()
        assert self.release.wait(timeout=10), "the test never released the fetch"
        return []


def test_background_refresh_returns_the_stale_cache_without_waiting_for_the_fetch(monkeypatch):
    fill = _BlockingFill()
    service = _stale_service(monkeypatch, fill)

    bars = service.get_stock_ohlcv("BOTZ", period="5y", refresh="background")

    # Returned while the fetch is still blocked: the request did not wait for it.
    assert not fill.release.is_set()
    assert bars[-1].date == STALE_END.isoformat()
    assert fill.started.wait(timeout=5), "the refresh was never started"
    fill.release.set()


def test_only_one_background_refresh_runs_per_ticker_at_a_time(monkeypatch):
    """Every page load during the slow fetch must not start another one."""
    fill = _BlockingFill()
    service = _stale_service(monkeypatch, fill)

    service.get_stock_ohlcv("BOTZ", period="5y", refresh="background")
    assert fill.started.wait(timeout=5)
    service.get_stock_ohlcv("BOTZ", period="5y", refresh="background")
    service.get_stock_ohlcv("BOTZ", period="5y", refresh="background")
    assert fill.calls == 1
    fill.release.set()


def test_a_finished_refresh_lets_the_next_stale_read_refresh_again(monkeypatch):
    """The in-flight marker is cleared when the fetch ends, even if it failed."""
    calls = []
    done = threading.Event()

    def failing_fill(ticker, *, period, table, reason):
        calls.append(ticker)
        done.set()
        raise RuntimeError("provider down")

    service = _stale_service(monkeypatch, failing_fill)
    service.get_stock_ohlcv("BOTZ", period="5y", refresh="background")
    assert done.wait(timeout=5)
    for _ in range(50):
        if not market_data_module._BACKGROUND_REFRESHES:
            break
        threading.Event().wait(0.02)
    done.clear()
    service.get_stock_ohlcv("BOTZ", period="5y", refresh="background")
    assert done.wait(timeout=5)
    assert calls == ["BOTZ", "BOTZ"]


def test_the_default_still_refreshes_inline(monkeypatch):
    """Every other caller keeps today's behaviour."""
    calls = []

    def fill(ticker, *, period, table, reason):
        calls.append(ticker)
        return []

    service = _stale_service(monkeypatch, fill)
    service.get_stock_ohlcv("BOTZ", period="5y")
    assert calls == ["BOTZ"], "the inline refresh must have run before the call returned"


def test_a_cache_miss_still_fetches_inline_even_in_background_mode(monkeypatch):
    """With nothing cached there is nothing to show, so the fetch cannot be deferred."""
    service = MarketDataService()
    monkeypatch.setattr(service, "_select_ohlcv_rows", lambda conn, ticker, table, days: [])
    live = [_row(date(2026, 9, 25))]
    monkeypatch.setattr(
        service, "_fill_ohlcv_cache",
        lambda ticker, *, period, table, reason: service._rows_to_ohlcv(live),
    )

    bars = service.get_stock_ohlcv("BOTZ", period="5y", refresh="background")
    assert [bar.date for bar in bars] == ["2026-09-25"]


def test_spreads_read_their_bars_with_a_background_refresh():
    seen = []

    class _Market:
        def get_stock_ohlcv(self, ticker, period, table, refresh="inline"):
            seen.append(refresh)
            return []

    market_spreads._closes_by_date(_Market(), "BOTZ")
    assert seen == ["background"]


@pytest.fixture(autouse=True)
def _no_refresh_left_behind():
    yield
    market_data_module._BACKGROUND_REFRESHES.clear()
