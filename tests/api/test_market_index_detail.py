from __future__ import annotations

from datetime import date, timedelta

from apps.api.models.schemas import MarketDataQuality, StockOHLCV
from apps.api.services import db as db_service
from apps.api.services.market_data import MarketDataService


def _insert_index_rows(db_path, ticker: str, name: str, latest: date, count: int) -> None:
    monkey_rows = []
    for offset in range(count):
        row_date = latest - timedelta(days=offset)
        close = 100.0 + offset
        monkey_rows.append(
            (
                name,
                ticker,
                row_date.isoformat(),
                close - 1,
                close + 1,
                close - 2,
                close,
                1_000 + offset,
                0.0,
                0.0,
            )
        )

    with db_service.get_db() as conn:
        conn.executemany(
            """INSERT INTO indices
               (name, ticker, date, open, high, low, close, volume, dividends, stock_splits)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            monkey_rows,
        )


def test_get_stock_ohlcv_with_metadata_returns_fresh_cache_metadata(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    latest = date(2026, 4, 8)
    _insert_index_rows(db_path, "^GSPC", "S&P 500", latest, 35)

    service = MarketDataService()
    monkeypatch.setattr(service, "_previous_trading_day", lambda today=None: latest)

    bars, metadata = service._get_stock_ohlcv_with_metadata("^GSPC", period="1mo", table="indices")

    assert len(bars) == 30
    assert metadata.source == "cache"
    assert metadata.freshness_status == "fresh_cache"
    assert metadata.used_live_refresh is False
    assert metadata.used_stale_cache_fallback is False
    assert metadata.latest_trading_date == latest.isoformat()
    assert metadata.last_updated is not None
    assert metadata.last_updated.endswith("Z")
    assert "cached history" in metadata.detail_note


def test_get_stock_ohlcv_with_metadata_returns_stale_cache_fallback_when_live_refresh_fails(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    latest = date(2026, 4, 1)
    _insert_index_rows(db_path, "^GSPC", "S&P 500", latest, 12)

    service = MarketDataService()
    monkeypatch.setattr(service, "_previous_trading_day", lambda today=None: date(2026, 4, 8))
    monkeypatch.setattr(service, "_fetch_live_ohlcv", lambda ticker, period: [])

    bars, metadata = service._get_stock_ohlcv_with_metadata("^GSPC", period="1mo", table="indices")

    assert len(bars) == 12
    assert metadata.source == "cache_fallback"
    assert metadata.freshness_status == "stale_cache"
    assert metadata.used_live_refresh is False
    assert metadata.used_stale_cache_fallback is True
    assert metadata.latest_trading_date == latest.isoformat()
    assert "fell back to the latest cached history" in metadata.detail_note


def test_get_stock_ohlcv_reuses_recent_live_fetch_for_adjacent_endpoints(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    MarketDataService._provider_fetch_cache.clear()

    service = MarketDataService()
    calls: list[tuple[str, str]] = []
    live_rows = [
        StockOHLCV(date="2026-04-09", open=99, high=102, low=98, close=101, volume=1_000),
        StockOHLCV(date="2026-04-10", open=101, high=104, low=100, close=103, volume=1_200),
    ]

    def fake_fetch(ticker: str, period: str = "5y"):
        calls.append((ticker, period))
        return live_rows

    monkeypatch.setattr(service, "_fetch_live_ohlcv", fake_fetch)

    first = service.get_stock_ohlcv("AAPL", period="5y")
    second = service.get_stock_ohlcv("AAPL", period="5y")

    assert [bar.close for bar in first] == [101, 103]
    assert [bar.close for bar in second] == [101, 103]
    assert calls == [("AAPL", "5y")]
    assert first is not second


def test_get_index_detail_shapes_instrument_metadata(monkeypatch):
    service = MarketDataService()
    sample_bars = [
        StockOHLCV(date="2026-04-10", open=100, high=105, low=99, close=103, volume=1000),
        StockOHLCV(date="2026-04-11", open=103, high=108, low=102, close=107, volume=1200),
    ]
    sample_quality = MarketDataQuality(
        source="fresh_cache",
        freshness_status="fresh_cache",
        used_live_refresh=False,
        used_stale_cache_fallback=False,
        requested_period="5y",
        last_updated="2026-04-16T08:00:00Z",
        latest_trading_date="2026-04-11",
        detail_note="Test detail quality payload.",
    )
    monkeypatch.setattr(
        service,
        "_get_stock_ohlcv_with_metadata",
        lambda ticker, period="5y", table="indices": (sample_bars, sample_quality),
    )

    gold = service.get_index_detail("GC=F")
    fx = service.get_index_detail("KRW=X")
    crypto = service.get_index_detail("BTC-USD")

    assert gold.instrument_type == "commodity"
    assert gold.unit_label == "USD per ounce"
    assert gold.base_asset is None
    assert gold.quote_asset is None

    assert fx.instrument_type == "fx"
    assert fx.base_asset == "USD"
    assert fx.quote_asset == "KRW"
    assert fx.unit_label == "KRW per USD"

    assert crypto.instrument_type == "crypto"
    assert crypto.base_asset == "BTC"
    assert crypto.quote_asset == "USD"
    assert crypto.unit_label == "USD per BTC"
    assert crypto.data_quality.last_updated == "2026-04-16T08:00:00Z"


def test_build_market_regime_context_summarizes_breadth_and_cross_asset_signals(monkeypatch):
    service = MarketDataService()

    def _quote(delta_pct: float):
      return type("Quote", (), {"delta": type("Delta", (), {"delta_pct": delta_pct})()})()

    quotes = {
        "^GSPC": _quote(0.8),
        "^DJI": _quote(-0.2),
        "^IXIC": _quote(1.1),
        "^KS200": _quote(0.4),
        "GC=F": _quote(-0.5),
        "CL=F": _quote(0.3),
        "NG=F": _quote(-0.1),
        "KRW=X": _quote(-0.3),
        "BTC-USD": _quote(2.0),
    }

    def fake_get_stock_ohlcv(ticker: str, period: str = "1mo", table: str = "indices"):
        latest = date(2026, 4, 11)
        delta = quotes[ticker].delta.delta_pct
        prev_close = 100.0
        last_close = prev_close * (1 + (delta / 100))
        return [
            StockOHLCV(date=(latest - timedelta(days=1)).isoformat(), open=prev_close, high=prev_close, low=prev_close, close=prev_close, volume=1),
            StockOHLCV(date=latest.isoformat(), open=prev_close, high=last_close, low=prev_close, close=last_close, volume=1),
        ]

    monkeypatch.setattr(service, "get_stock_ohlcv", fake_get_stock_ohlcv)
    regime = service._build_market_regime_context()

    assert regime.regime_label == "risk_on"
    assert regime.equity_advancers == 3
    assert regime.equity_decliners == 1
    assert regime.equity_index_count == 4
    assert regime.breadth_ratio == 0.75
    assert regime.risk_on_signals == 5
    assert regime.risk_off_signals == 0
