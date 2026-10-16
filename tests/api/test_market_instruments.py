"""The Market Overview's fourteen instruments, their metadata, and the regime's scored tickers.

Every test stubs get_stock_ohlcv on the service instance, so no test reads a real database or
the network. tests/conftest.py also isolates the database and blocks sockets.
"""

from __future__ import annotations

from datetime import date, timedelta

from apps.api.models.schemas import StockOHLCV
from apps.api.services.market_data import (
    EQUITY_INDEX_TICKERS,
    MARKET_INDICES,
    CROSS_ASSET_SIGNAL_TICKERS,
    MarketDataService,
)

ORDER = ("^GSPC", "^DJI", "^IXIC", "^KS200", "SOXX", "SKYY", "BOTZ", "^TNX", "GC=F", "CL=F", "NG=F", "KRW=X", "BTC-USD", "^VIX")
SECTOR_ETFS = ("SOXX", "SKYY", "BOTZ")

# The deltas of test_market_regime_route.py: risk_on, 3 of 4 equity indices up, 5 signals on.
RISK_ON = {"^GSPC": 0.8, "^DJI": -0.2, "^IXIC": 1.1, "^KS200": 0.4, "GC=F": -0.5, "CL=F": 0.3, "NG=F": -0.1, "KRW=X": -0.3, "BTC-USD": 2.0}


def _two_closes(delta_pct: float) -> list[StockOHLCV]:
    latest = date(2026, 4, 11)
    prev, last = 100.0, 100.0 * (1 + delta_pct / 100)
    return [
        StockOHLCV(date=(latest - timedelta(days=1)).isoformat(), open=prev, high=prev, low=prev, close=prev, volume=1),
        StockOHLCV(date=latest.isoformat(), open=prev, high=last, low=prev, close=last, volume=1),
    ]


def _service_with_bars(monkeypatch, deltas: dict[str, float]) -> tuple[MarketDataService, list[tuple[str, str, str]]]:
    service = MarketDataService()
    requested: list[tuple[str, str, str]] = []

    def fake(ticker, period="5y", table="stocks", refresh="inline"):
        requested.append((ticker, period, table))
        return _two_closes(deltas[ticker]) if ticker in deltas else []

    monkeypatch.setattr(service, "get_stock_ohlcv", fake)
    return service, requested


def test_the_overview_lists_fourteen_instruments_in_display_order():
    assert list(MARKET_INDICES.values()) == list(ORDER)
    names = dict(zip(MARKET_INDICES.values(), MARKET_INDICES.keys()))
    assert names["SOXX"] == "Semiconductors"
    assert names["SKYY"] == "Cloud"
    assert names["BOTZ"] == "AI"
    assert names["^TNX"] == "US 10Y Yield"


def test_new_instruments_carry_their_type_and_unit():
    for ticker in SECTOR_ETFS:
        assert MarketDataService._instrument_metadata_for_ticker(ticker) == {
            "instrument_type": "sector",
            "unit_label": "USD per share",
        }
    assert MarketDataService._instrument_metadata_for_ticker("^TNX") == {
        "instrument_type": "rate",
        "unit_label": "percent yield",
    }


def test_the_regime_reads_only_the_tickers_it_scores(monkeypatch):
    service, requested = _service_with_bars(monkeypatch, RISK_ON)

    service._build_market_regime_context()

    assert {ticker for ticker, _, _ in requested} == set(EQUITY_INDEX_TICKERS) | set(CROSS_ASSET_SIGNAL_TICKERS)


def test_new_instruments_do_not_move_the_regime(monkeypatch):
    service, _ = _service_with_bars(monkeypatch, RISK_ON)
    before = service._build_market_regime_context()

    boosted = dict(RISK_ON, **{ticker: 50.0 for ticker in (*SECTOR_ETFS, "^TNX")})
    service, _ = _service_with_bars(monkeypatch, boosted)
    after = service._build_market_regime_context()

    assert after == before
    assert before.regime_label == "risk_on"


def test_sector_etfs_are_not_equity_indices():
    assert {"SOXX", "SKYY", "BOTZ"}.isdisjoint(EQUITY_INDEX_TICKERS)
