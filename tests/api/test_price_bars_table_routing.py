"""load_price_bars must read the table the bars were written to.

MARKET_INDICES tickers are saved to `indices`; a reader hard-wired to `stocks` finds nothing
for SOXX and a frozen stale row for SKYY/BOTZ, so decision outcomes and valuation verdicts
silently stop moving.
"""

from apps.api.models.schema_parts.market import StockOHLCV
from apps.api.services.acquisition.store import load_price_bars
from apps.api.services.market_data import MarketDataService


def _rows(closes):
    return [
        StockOHLCV(date=f"2026-09-{day:02d}", open=c, high=c, low=c, close=c, volume=10)
        for day, c in closes
    ]


def test_an_index_listed_ticker_is_read_from_indices():
    MarketDataService()._save_ohlcv_rows("SOXX", _rows([(1, 100.0), (2, 110.0)]))

    bars = load_price_bars("SOXX")

    assert [(b["date"], b["close"]) for b in bars] == [("2026-09-01", 100.0), ("2026-09-02", 110.0)]
    assert [b["close"] for b in load_price_bars("soxx", limit=1)] == [110.0]


def test_an_ordinary_ticker_is_still_read_from_stocks():
    MarketDataService()._save_ohlcv_rows("AAPL", _rows([(1, 200.0), (2, 210.0)]))

    bars = load_price_bars("AAPL")

    assert [b["close"] for b in bars] == [200.0, 210.0]
