"""Risk sweeps. Each docstring names the mutation its test catches."""
from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from apps.api.models.schemas import StockOHLCV
from apps.api.services.acquisition.sources.quote_facts import QuoteFacts
from apps.api.services.db import get_db
from apps.api.services.risk import store, sweep

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)


def _bar(day: str) -> StockOHLCV:
    return StockOHLCV(date=day, open=1.0, high=2.0, low=0.5, close=1.5, volume=10)


def _no_probe(_ticker):
    return None


class Recorder:
    def __init__(self, fail=()):
        self.calls: list[tuple[str, object]] = []
        self.fail = set(fail)

    def __call__(self, ticker, fetch_range):
        self.calls.append((ticker, fetch_range))
        if ticker in self.fail:
            raise RuntimeError("provider down")
        return [_bar("2026-10-16")]


def _watch(*tickers):
    with get_db() as conn:
        for t in tickers:
            conn.execute("INSERT INTO watchlist (ticker) VALUES (?)", (t,))


def test_sweep_includes_benchmarks():
    """Catches a sweep over the watchlist alone (benchmarks dropped) or benchmarks alone."""
    _watch("NVDA", "AMD")
    rec, sleeps = Recorder(), []
    report = sweep.sweep_bars(NOW, fetcher=rec, action_probe=_no_probe, sleep=sleeps.append)
    assert [c[0] for c in rec.calls] == ["AMD", "NVDA", "^SOX", "RSP", "SPY"]
    assert (report.attempted, report.fetched, report.failed) == (5, 5, [])
    assert sleeps == [0.5] * 4


def test_sweep_fresh_skips_and_no_sleep():
    """Catches treating a fresh result as a provider call (extra fetch or sleep on the second run)."""
    _watch("NVDA")
    sweep.sweep_bars(NOW, fetcher=Recorder(), action_probe=_no_probe, sleep=lambda s: None)
    rec, sleeps = Recorder(), []
    report = sweep.sweep_bars(NOW, fetcher=rec, action_probe=_no_probe, sleep=sleeps.append)
    assert rec.calls == [] and sleeps == []
    assert (report.attempted, report.fetched) == (4, 0)


def test_failed_ticker_reported_not_raised():
    """Catches a sweep that raises on a provider error, or one that leaves the failed ticker out of the report."""
    _watch("NVDA", "AMD")
    rec = Recorder(fail={"AMD"})
    report = sweep.sweep_bars(NOW, fetcher=rec, action_probe=_no_probe, sleep=lambda s: None)
    assert report.failed == ["AMD"]
    assert report.fetched == 4 and report.attempted == 5
    assert [c[0] for c in rec.calls][-1] == "SPY"  # the sweep went on past the failure


def test_assertion_error_propagates_from_deep_history_and_quote_facts():
    """Catches a blanket except that swallows the suite's network guard.

    sweep_bars is not covered: runner.acquire itself swallows a fetcher's AssertionError."""
    def guard(*_a):
        raise AssertionError("network")

    with pytest.raises(AssertionError):
        sweep.ensure_deep_history(["NVDA"], history_start=date(2015, 6, 1), today=date(2026, 10, 19),
                                  fetcher=guard, saver=lambda t, r: None, sleep=lambda s: None)
    with pytest.raises(AssertionError):
        sweep.ensure_quote_facts(["NVDA"], NOW, fetcher=guard, sleep=lambda s: None)


def test_deep_history_fetches_before_first_bar_once():
    """Catches a wrong range end (not the first stored bar), no saving, or no once-only marker."""
    with get_db() as conn:
        conn.execute("INSERT INTO stocks (ticker, date, close) VALUES ('NVDA', '2016-09-15', 1.0)")
    rec, saved = Recorder(), []
    kwargs = dict(history_start=date(2015, 6, 1), today=date(2026, 10, 19), fetcher=rec,
                  saver=lambda t, rows: saved.append((t, len(rows))), sleep=lambda s: None)
    report = sweep.ensure_deep_history(["NVDA"], **kwargs)
    (ticker, rng), = rec.calls
    assert (ticker, rng.start, rng.end_exclusive, rng.reason) == (
        "NVDA", date(2015, 6, 1), date(2016, 9, 15), "deep_history")
    assert saved == [("NVDA", 1)] and (report.attempted, report.fetched) == (1, 1)
    assert store.get_state("deep_history:NVDA") == "2026-10-19"

    sweep.ensure_deep_history(["NVDA"], **kwargs)
    assert len(rec.calls) == 1


def test_deep_history_no_bars_uses_tomorrow_and_empty_result_is_marked():
    """Catches a missing-bars ticker fetching to the wrong end, or an empty result left unmarked (refetched forever)."""
    rec = Recorder()
    rec2 = lambda t, r: (rec.calls.append((t, r)), [])[1]  # noqa: E731
    sweep.ensure_deep_history(["NEW"], history_start=date(2015, 6, 1), today=date(2026, 10, 19),
                              fetcher=rec2, saver=lambda t, r: None, sleep=lambda s: None)
    assert rec.calls[0][1].end_exclusive == date(2026, 10, 20)
    assert store.get_state("deep_history:NEW") == "2026-10-19"


def test_deep_history_failure_not_marked():
    """Catches marking a ticker done after a failed fetch (it would never be retried)."""
    report = sweep.ensure_deep_history(
        ["NVDA"], history_start=date(2015, 6, 1), today=date(2026, 10, 19),
        fetcher=Recorder(fail={"NVDA"}), saver=lambda t, r: None, sleep=lambda s: None)
    assert report.failed == ["NVDA"] and store.get_state("deep_history:NVDA") is None


def test_deep_history_first_bar_old_enough_skips_fetch_but_marks():
    """Catches fetching when stored history already reaches back to history_start."""
    with get_db() as conn:
        conn.execute("INSERT INTO stocks (ticker, date, close) VALUES ('AAPL', '2015-06-01', 1.0)")
    rec = Recorder()
    sweep.ensure_deep_history(["AAPL"], history_start=date(2015, 6, 1), today=date(2026, 10, 19),
                              fetcher=rec, saver=lambda t, r: None, sleep=lambda s: None)
    assert rec.calls == [] and store.get_state("deep_history:AAPL") == "2026-10-19"


def test_quote_facts_only_missing_shares():
    """Catches fetching for tickers that already have shares_outstanding, or skipping a NULL one."""
    with get_db() as conn:
        conn.execute("INSERT INTO corporate_quote_facts (ticker, market_cap, shares_outstanding, currency, fetched_at)"
                     " VALUES ('HAVE', 1.0, 5.0, 'USD', 't')")
        conn.execute("INSERT INTO corporate_quote_facts (ticker, market_cap, shares_outstanding, currency, fetched_at)"
                     " VALUES ('NULLS', 1.0, NULL, 'USD', 't')")
    asked = []

    def fetcher(ticker):
        asked.append(ticker)
        return QuoteFacts(ticker, 100.0, 7.0, "USD")

    report = sweep.ensure_quote_facts(["HAVE", "NULLS", "NONE"], NOW, fetcher=fetcher, sleep=lambda s: None)
    assert asked == ["NULLS", "NONE"] and (report.attempted, report.fetched, report.failed) == (2, 2, [])
    with get_db() as conn:
        got = conn.execute("SELECT shares_outstanding FROM corporate_quote_facts WHERE ticker='NONE'").fetchone()
    assert got[0] == 7.0


def test_quote_facts_failure_reported():
    """Catches a failed quote fetch being counted as success or raised."""
    def fetcher(ticker):
        raise RuntimeError("down")

    report = sweep.ensure_quote_facts(["NONE"], NOW, fetcher=fetcher, sleep=lambda s: None)
    assert report.failed == ["NONE"] and report.fetched == 0
