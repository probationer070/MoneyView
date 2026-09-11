"""A bar with no settled price must never become a price.

The provider returns NaN for the current day's OHLC before the session settles,
while still reporting a real volume. NaN passes a `float` field, and SQLite
stores NaN as NULL -- so the absence only becomes visible on the way back out,
where `float(row["close"] or 0)` turned it into 0.0 and the watchlist reported a
$0.00 price and a -100% move for 136 of 139 tickers.

The defect class is the one ERROR-LOG keeps recording: a number wearing a basis
it has not earned. These tests pin both ends of the round trip -- a non-finite
bar is never written, and a NULL bar read back from an older database is never
served as a price.
"""

from __future__ import annotations

import math
from datetime import date

from apps.api.models.schema_parts.market import StockOHLCV
from apps.api.services.market_data import MarketDataService


def _row(row_date: str, close, *, volume: int = 1_000) -> dict:
    """A raw sqlite row shape, where an unsettled bar carries volume but no price.

    `_select_ohlcv_rows` reads `ORDER BY date DESC`, so every fixture below is
    NEWEST-FIRST. That ordering is load-bearing: `_latest_row_date` returns the first
    parseable row rather than the maximum, and an oldest-first fixture makes a
    freshness test pass while asserting nothing.
    """
    return {
        "date": row_date,
        "open": close,
        "high": close,
        "low": close,
        "close": close,
        "volume": volume,
        "dividends": 0.0,
        "stock_splits": 0.0,
    }


class _RecordingConnection:
    """Captures the parameter tuples bound to each INSERT."""

    def __init__(self) -> None:
        self.inserts: list[tuple] = []

    def execute(self, sql: str, params=None):
        if params is None:
            # PRAGMA table_info(...) -- report the columns the real schema has.
            return [
                {"name": name}
                for name in (
                    "ticker", "date", "open", "high", "low",
                    "close", "volume", "dividends", "stock_splits",
                )
            ]
        self.inserts.append(params)
        return []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


# --- reading: a NULL close must not be served as 0.0 --------------------------


def test_null_close_row_is_dropped_rather_than_read_as_zero():
    """The exact shape found in the live database on 2026-09-08."""
    rows = [
        _row("2026-09-08", None, volume=35_028_027),
        _row("2026-09-04", 319.97),
    ]

    bars = MarketDataService._rows_to_ohlcv(rows)

    assert [bar.date for bar in bars] == ["2026-09-04"]
    assert bars[-1].close == 319.97


def test_nan_close_row_is_dropped():
    """NaN never reaches sqlite as NaN, but an in-memory series can still carry it."""
    rows = [_row("2026-09-08", float("nan")), _row("2026-09-04", 319.97)]

    bars = MarketDataService._rows_to_ohlcv(rows)

    assert [bar.date for bar in bars] == ["2026-09-04"]


def test_infinite_close_row_is_dropped():
    rows = [_row("2026-09-08", float("inf")), _row("2026-09-04", 319.97)]

    bars = MarketDataService._rows_to_ohlcv(rows)

    assert [bar.date for bar in bars] == ["2026-09-04"]


def test_a_priced_bar_survives_with_its_value_intact():
    """The guard must not cost a legitimate bar, including a legitimately odd one."""
    rows = [_row("2026-09-08", 319.97), _row("2026-09-04", 0.0001)]

    bars = MarketDataService._rows_to_ohlcv(rows)

    assert [bar.date for bar in bars] == ["2026-09-08", "2026-09-04"]
    assert [bar.close for bar in bars] == [319.97, 0.0001]


def test_every_bar_priceless_yields_an_empty_series_not_a_row_of_zeroes():
    rows = [_row("2026-09-08", None), _row("2026-09-07", None)]

    assert MarketDataService._rows_to_ohlcv(rows) == []


# --- writing: a non-finite bar must never be persisted -----------------------


def test_non_finite_bar_is_never_written():
    """`close is not None` would not catch this -- the value is NaN, not None."""
    service = MarketDataService()
    connection = _RecordingConnection()

    rows = [
        StockOHLCV(date="2026-09-04", open=1.0, high=1.0, low=1.0, close=319.97, volume=1),
        StockOHLCV(
            date="2026-09-08",
            open=math.nan, high=math.nan, low=math.nan, close=math.nan,
            volume=35_028_027,
        ),
    ]

    service._save_ohlcv_rows_to_connection(connection, "AAPL", rows)

    written_dates = [params[1] for params in connection.inserts]
    assert written_dates == ["2026-09-04"]


# --- the watchlist row: a missing price is null, never zero ------------------


def test_watchlist_reports_no_price_rather_than_zero_when_every_bar_is_priceless(monkeypatch):
    """The tile renders "—" for a null and "$0.0" for a zero.

    `formatClose` (StockTile.tsx:18) already refuses to invent a stand-in 0, so the
    only reason the grid showed $0.00 was that the API sent one. With every bar
    dropped as priceless the series is empty, and the row must say so.
    """
    from apps.api.routes import portfolio as portfolio_routes

    monkeypatch.setattr(portfolio_routes, "ensure_watchlist_bootstrapped", lambda *_: None)
    monkeypatch.setattr(portfolio_routes._mkt, "get_stock_ohlcv", lambda *a, **k: [])

    class _Cursor:
        @staticmethod
        def fetchall():
            return [{
                "ticker": "AAPL", "name": "Apple", "sector": "Tech",
                "group_name": "core", "weight": 0.0, "id": 1,
            }]

    class _Rows:
        def execute(self, *_):
            return _Cursor()

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(portfolio_routes, "get_db", lambda: _Rows())

    rows = portfolio_routes.get_watchlist()

    assert rows[0].last_close is None
    assert rows[0].delta is None


# --- freshness: a priceless newest bar must not suppress the refetch ---------


def test_a_priceless_newest_bar_does_not_make_the_cache_look_fresh(monkeypatch):
    """The half of this defect that blocks its own recovery.

    `_rows_are_fresh` reads the raw rows, so an unsettled 2026-09-08 bar made the
    cache look current and stopped the service refetching -- leaving the watchlist
    pinned to an older close with nothing to trigger a repair.
    """
    service = MarketDataService()
    monkeypatch.setattr(service, "_previous_trading_day", lambda today=None: date(2026, 9, 8))

    priced_through_friday = [_row("2026-09-04", 319.97)]
    plus_an_unsettled_monday = [_row("2026-09-08", None, volume=35_028_027)] + priced_through_friday

    assert not service._rows_are_fresh(priced_through_friday)
    assert not service._rows_are_fresh(plus_an_unsettled_monday)


def test_a_priced_newest_bar_still_counts_as_fresh(monkeypatch):
    service = MarketDataService()
    monkeypatch.setattr(service, "_previous_trading_day", lambda today=None: date(2026, 9, 8))

    assert service._rows_are_fresh([_row("2026-09-08", 321.40), _row("2026-09-04", 319.97)])
