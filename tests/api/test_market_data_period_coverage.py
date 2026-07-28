from datetime import date, timedelta

from apps.api.services.market_data import MarketDataService


def _row(row_date: date) -> dict:
    return {
        "date": row_date.isoformat(),
        "open": 1.0,
        "high": 1.0,
        "low": 1.0,
        "close": 1.0,
        "volume": 1,
    }


def test_rows_cover_period_rejects_fresh_one_year_cache_for_five_year_request(monkeypatch):
    service = MarketDataService()
    latest = date(2026, 4, 8)
    rows = [_row(latest - timedelta(days=offset)) for offset in range(365)]
    monkeypatch.setattr(service, "_previous_trading_day", lambda today=None: latest)

    assert service._rows_are_fresh(rows)
    assert not service._rows_cover_period(rows, 1825)


def test_rows_cover_period_accepts_five_year_span():
    service = MarketDataService()
    latest = date(2026, 4, 8)
    rows = [_row(latest - timedelta(days=offset)) for offset in range(1826)]

    assert service._rows_cover_period(rows, 1825)


class _SpyConnection:
    """Records each executed statement's bound ticker values."""

    def __init__(self, rows_by_ticker: dict[str, list]):
        self._rows_by_ticker = rows_by_ticker
        self.ticker_batches: list[list[str]] = []

    def execute(self, sql: str, params):
        tickers = [value for value in params[:-1]]
        self.ticker_batches.append(tickers)
        matched = [row for ticker in tickers for row in self._rows_by_ticker.get(ticker, [])]
        return _SpyCursor(matched)


class _SpyCursor:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


def test_index_read_uses_single_ticker_so_sqlite_can_order_from_the_index():
    """`ORDER BY date DESC` is satisfiable from idx_indices_ticker_date only for a
    single-value IN. A multi-value IN forces `USE TEMP B-TREE FOR ORDER BY`, measured
    at 8.9 ms/call versus 0.2 ms -- 40x, and the slowest query in the app. The alias
    values match zero rows in practice, so the canonical ticker must be tried alone.
    """
    service = MarketDataService()
    connection = _SpyConnection({"^GSPC": [_row(date(2026, 4, 8))]})

    rows = service._select_ohlcv_rows(connection, "^GSPC", "indices", 90)

    assert rows, "canonical ticker rows should be returned"
    assert connection.ticker_batches == [["^GSPC"]], (
        "aliases must not widen the IN clause when the canonical ticker has rows"
    )


def test_index_read_falls_back_to_aliases_for_legacy_display_name_rows():
    """Older databases stored display names ('S&P 500') as the ticker. The fast path
    must not silently return empty for them."""
    service = MarketDataService()
    connection = _SpyConnection({"S&P 500": [_row(date(2026, 4, 8))]})

    rows = service._select_ohlcv_rows(connection, "^GSPC", "indices", 90)

    assert rows, "legacy display-name rows should still be found"
    assert connection.ticker_batches[0] == ["^GSPC"], "canonical is tried first"
    assert "S&P 500" in connection.ticker_batches[1], "aliases retried on an empty result"


def test_stock_read_never_widens_beyond_the_requested_ticker():
    """Stocks have no aliases; the fallback must not introduce a second query."""
    service = MarketDataService()
    connection = _SpyConnection({"AAPL": [_row(date(2026, 4, 8))]})

    service._select_ohlcv_rows(connection, "AAPL", "stocks", 90)

    assert connection.ticker_batches == [["AAPL"]]
