"""The service's job is to turn two cached series into a row that explains itself.

Every row must carry a basis naming both tickers, and a row that cannot be computed must
say why rather than arriving as an empty series indistinguishable from "no movement".
"""

import sys
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schema_parts.market import StockOHLCV
from apps.api.services import market_spreads as spreads_service
from apps.api.services.market_spreads import SPREAD_PAIRS, build_spreads

# Fixed so no fixture depends on the wall clock. A fixture pinned to real dates falls out of
# the trailing window as time passes, and the test then passes having tested nothing.
TODAY = date(2026, 9, 13)
WINDOW_START = (TODAY - timedelta(days=90)).isoformat()


class _StubService:
    """Stands in for MarketDataService. Keyed by ticker so a pair can be given one series
    that overlaps and one that does not."""

    def __init__(self, bars_by_ticker):
        self.bars_by_ticker = bars_by_ticker
        self.requested = []

    def get_stock_ohlcv(self, ticker, period="5y", table=None):
        self.requested.append((ticker, table))
        return self.bars_by_ticker.get(ticker, [])


def _bars(dates_and_closes):
    return [
        StockOHLCV(date=date, open=close, high=close, low=close, close=close, volume=1_000)
        for date, close in dates_and_closes
    ]


def test_every_pair_carries_a_basis_naming_both_tickers():
    """A field called relative strength with no stated formula is unreadable: a ratio of
    returns, a difference of returns and a regression beta are all called that somewhere."""
    bars = _bars([("2026-08-05", 100.0), ("2026-08-06", 110.0)])
    assert bars[0].date >= WINDOW_START, "fixture must stay inside the 90-day window from TODAY"
    stub = _StubService({pair.numerator: bars for pair in SPREAD_PAIRS}
                        | {pair.denominator: bars for pair in SPREAD_PAIRS})

    rows = build_spreads(window_days=90, service=stub, today=TODAY)

    assert len(rows) == len(SPREAD_PAIRS)
    for row in rows:
        assert row["numerator"] in row["basis"]
        assert row["denominator"] in row["basis"]
        assert row["basis"].strip()


def test_latest_is_the_final_series_value_not_a_recomputation():
    """Tiny, and it stops the scalar a reader quotes from drifting away from the last point
    on the chart beside it."""
    bars_a = _bars([("2026-08-05", 100.0), ("2026-08-06", 150.0)])
    bars_b = _bars([("2026-08-05", 100.0), ("2026-08-06", 100.0)])
    assert bars_a[0].date >= WINDOW_START, "fixture must stay inside the 90-day window from TODAY"
    pair = SPREAD_PAIRS[0]
    stub = _StubService({pair.numerator: bars_a, pair.denominator: bars_b})

    rows = build_spreads(window_days=90, service=stub, today=TODAY)
    row = next(row for row in rows if row["id"] == pair.id)

    assert row["latest"] == pytest.approx(row["series"][-1]["value"])
    assert row["latest"] == pytest.approx(150.0)


def test_a_pair_with_no_overlap_is_refused_with_a_reason_and_an_empty_series():
    pair = SPREAD_PAIRS[0]
    stub = _StubService({
        pair.numerator: _bars([("2026-01-05", 100.0)]),
        pair.denominator: _bars([("2026-01-06", 100.0)]),
    })

    rows = build_spreads(window_days=90, service=stub, today=TODAY)
    row = next(row for row in rows if row["id"] == pair.id)

    assert row["series"] == []
    assert row["refused_reason"]
    assert row["latest"] is None


def test_a_refusal_never_arrives_as_an_empty_series_with_no_reason():
    """The pairing that matters: an empty series and a null reason together would be read
    as a flat result rather than an absence."""
    stub = _StubService({})

    rows = build_spreads(window_days=90, service=stub, today=TODAY)

    for row in rows:
        assert bool(row["series"]) != bool(row["refused_reason"]), row


def test_the_reported_window_is_the_one_actually_used():
    """A young ETF must not have its short history presented as comparable to a full one."""
    bars_a = _bars([("2026-06-15", 100.0), ("2026-09-11", 120.0)])
    bars_b = _bars([("2026-06-15", 100.0), ("2026-09-11", 100.0)])
    pair = SPREAD_PAIRS[0]
    stub = _StubService({pair.numerator: bars_a, pair.denominator: bars_b})

    rows = build_spreads(window_days=90, service=stub, today=TODAY)
    row = next(row for row in rows if row["id"] == pair.id)

    assert row["requested_window_days"] == 90
    assert row["actual_window_start"] == "2026-06-15"
    assert row["actual_window_end"] == "2026-09-11"
    assert row["actual_window_days"] == 88
    assert row["observations"] == 2


def test_the_benchmark_is_read_from_the_indices_table_not_stocks():
    """`get_stock_ohlcv` defaults to table="stocks" and ^GSPC lives in `indices`. Getting
    this wrong returns no bars, so the pair refuses with "no overlapping history" -- a
    message that blames the data and hides the bug. Pinned on the argument, not the result."""
    bars = _bars([("2026-01-05", 100.0), ("2026-01-06", 110.0)])
    stub = _StubService({pair.numerator: bars for pair in SPREAD_PAIRS}
                        | {pair.denominator: bars for pair in SPREAD_PAIRS})

    build_spreads(window_days=90, service=stub, today=TODAY)

    assert ("^GSPC", "indices") in stub.requested
    assert ("BOTZ", "stocks") in stub.requested


def test_the_registry_names_every_ticker_the_feature_needs():
    """SPREAD_PAIRS is the source of truth for acquisition. A ticker needed by a pair but
    absent from the registry would never be fetched, and the pair would refuse forever with
    a reason that points at the data rather than at the omission."""
    tickers = {pair.numerator for pair in SPREAD_PAIRS} | {pair.denominator for pair in SPREAD_PAIRS}

    assert {"BOTZ", "CIBR", "SKYY", "ICLN", "XLE", "ITA", "^GSPC"} == tickers
    assert len({pair.id for pair in SPREAD_PAIRS}) == len(SPREAD_PAIRS), "pair ids must be unique"


def test_the_window_is_relative_to_the_injected_reference_date():
    """Pins the fix for a fixture that silently aged out of the window. With the reference
    date injected, the same bars are in-window on any run date; without it, this test would
    depend on when it is run."""
    bars_a = _bars([("2026-08-05", 100.0), ("2026-08-06", 150.0)])
    bars_b = _bars([("2026-08-05", 100.0), ("2026-08-06", 100.0)])
    pair = SPREAD_PAIRS[0]
    stub = _StubService({pair.numerator: bars_a, pair.denominator: bars_b})

    inside = build_spreads(window_days=90, service=stub, today=date(2026, 9, 13))
    outside = build_spreads(window_days=90, service=stub, today=date(2027, 1, 1))

    assert next(r for r in inside if r["id"] == pair.id)["latest"] == pytest.approx(150.0)
    assert next(r for r in outside if r["id"] == pair.id)["refused_reason"]


def _recent_bars():
    """Two bars a few days old, so they are inside the trailing window on ANY run date.

    Derived from today rather than pinned: a fixed date silently falls out of the window as
    time passes, and every assertion below still passes on the refused path, so the test
    would go green having exercised nothing.
    """
    recent = date.today() - timedelta(days=5)
    earlier = date.today() - timedelta(days=6)
    return _bars([(earlier.isoformat(), 100.0), (recent.isoformat(), 110.0)])


def _stub_every_ticker():
    bars = _recent_bars()
    return _StubService({pair.numerator: bars for pair in SPREAD_PAIRS}
                        | {pair.denominator: bars for pair in SPREAD_PAIRS})


def test_the_route_serves_one_row_per_pair_each_with_a_basis(monkeypatch):
    stub = _stub_every_ticker()
    monkeypatch.setattr(spreads_service, "MarketDataService", lambda: stub)

    response = TestClient(app).get("/api/v1/market/spreads")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == len(SPREAD_PAIRS)
    # The precondition that makes the rest meaningful: the computed path ran. Without this,
    # every assertion below is satisfied by a fully refused response.
    assert all(row["refused_reason"] is None for row in payload), payload
    for row in payload:
        assert row["basis"].strip()
        assert row["numerator"] in row["basis"]
        assert (row["refused_reason"] is None) != (row["series"] == [])


def test_the_route_default_window_is_the_engine_default(monkeypatch):
    """One default, stated twice: the route declares `Query(default=90)` and `build_spreads`
    takes `window_days=DEFAULT_WINDOW_DAYS`. Changing either alone would leave the page and
    every direct caller of the service disagreeing about what "the default window" means,
    with nothing on screen to show it.

    Replaces a test in test_relative_strength.py that asserted only `DEFAULT_WINDOW_DAYS > 0`
    and passed with the constant changed from 90 to 1 (ERROR-LOG.md 2026-09-14)."""
    from packages.core_finance.relative_strength import DEFAULT_WINDOW_DAYS

    stub = _stub_every_ticker()
    monkeypatch.setattr(spreads_service, "MarketDataService", lambda: stub)

    response = TestClient(app).get("/api/v1/market/spreads")

    assert response.status_code == 200
    payload = response.json()
    assert payload, "no rows came back, so no window was compared"
    assert {row["requested_window_days"] for row in payload} == {DEFAULT_WINDOW_DAYS}


def test_the_route_accepts_a_window_in_days(monkeypatch):
    stub = _stub_every_ticker()
    monkeypatch.setattr(spreads_service, "MarketDataService", lambda: stub)

    response = TestClient(app).get("/api/v1/market/spreads?window_days=30")

    assert response.status_code == 200
    payload = response.json()
    assert all(row["requested_window_days"] == 30 for row in payload)
    assert all(row["refused_reason"] is None for row in payload), payload


def test_vix_routes_to_the_indices_table_not_stocks():
    """`_table_for_ticker` decides by membership in MARKET_INDICES. A ^VIX missing from that
    dict would be written to and read from `stocks`, so it would silently never join the
    rows the index card list reads."""
    from apps.api.services.market_data import MARKET_INDICES, MarketDataService

    assert "^VIX" in MARKET_INDICES.values()
    assert MarketDataService._table_for_ticker("^VIX") == "indices"
