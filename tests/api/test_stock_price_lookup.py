import sys
from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import StockOHLCV, StockPriceLookup
from apps.api.services import db as db_service
from apps.api.services.market_data import MarketDataService


def _insert_stock_rows(ticker: str, latest: date, count: int) -> None:
    rows = []
    for offset in range(count):
        row_date = latest - timedelta(days=offset)
        close = 200.0 + offset
        rows.append(
            (
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
            """INSERT INTO stocks
               (ticker, date, open, high, low, close, volume, dividends, stock_splits)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )


def _reset_market_data_state() -> None:
    MarketDataService._inflight_refreshes.clear()
    MarketDataService._refresh_failures.clear()
    MarketDataService._provider_fetch_cache.clear()


def test_get_stock_price_lookup_returns_fetching_on_cold_miss(monkeypatch, tmp_path):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _reset_market_data_state()

    service = MarketDataService()
    scheduled: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        service,
        "_refresh_ohlcv_in_background",
        lambda ticker, period="1mo", table="stocks": scheduled.append((ticker, period, table)),
    )

    lookup = service.get_stock_price_lookup("AAPL")

    assert lookup.status == "fetching"
    assert lookup.price is None
    assert lookup.retry_after_seconds == 2
    assert lookup.freshness_status == "cache_miss"
    assert scheduled == [("AAPL", "1mo", "stocks")]


def test_get_stock_price_lookup_returns_stale_cache_and_schedules_refresh(monkeypatch, tmp_path):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _reset_market_data_state()

    latest = date(2026, 4, 1)
    _insert_stock_rows("AAPL", latest, 10)

    service = MarketDataService()
    monkeypatch.setattr(service, "_previous_trading_day", lambda today=None: date(2026, 4, 8))
    scheduled: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        service,
        "_refresh_ohlcv_in_background",
        lambda ticker, period="1mo", table="stocks": scheduled.append((ticker, period, table)),
    )

    lookup = service.get_stock_price_lookup("AAPL")

    assert lookup.status == "ok"
    assert lookup.price == 200.0
    assert lookup.as_of_date == latest.isoformat()
    assert lookup.source == "cache_fallback"
    assert lookup.freshness_status == "stale_cache"
    assert scheduled == [("AAPL", "1mo", "stocks")]


def test_get_stock_price_lookup_returns_not_found_after_failed_background_refresh(monkeypatch, tmp_path):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _reset_market_data_state()

    service = MarketDataService()
    key = service._refresh_key("AAPL", "1mo", "stocks")
    MarketDataService._refresh_failures[key] = {
        "failed_at": "2026-04-18T00:00:00Z",
        "detail_note": "Live provider fetch failed after all retries for this cold cache miss.",
    }
    monkeypatch.setattr(
        service,
        "_refresh_ohlcv_in_background",
        lambda ticker, period="1mo", table="stocks": None,
    )

    lookup = service.get_stock_price_lookup("AAPL")

    assert lookup.status == "not_found"
    assert lookup.source == "live_fetch_failed"
    assert lookup.price is None


def test_get_latest_stock_price_prefers_live_quote_over_cached_close(monkeypatch):
    service = MarketDataService()
    monkeypatch.setattr(service, "_fetch_live_quote_price", lambda ticker: 212.34)
    monkeypatch.setattr(service, "get_stock_ohlcv", lambda ticker, period="1mo", table="stocks": [])

    assert service.get_latest_stock_price("aapl") == 212.34


def test_get_latest_stock_price_falls_back_to_ohlcv_close(monkeypatch):
    service = MarketDataService()
    monkeypatch.setattr(service, "_fetch_live_quote_price", lambda ticker: None)
    monkeypatch.setattr(
        service,
        "get_stock_ohlcv",
        lambda ticker, period="1mo", table="stocks": [
            StockOHLCV(date="2026-04-30", open=99.0, high=101.0, low=98.0, close=100.0, volume=1_000),
        ],
    )

    assert service.get_latest_stock_price("aapl") == 100.0


def test_corporate_latest_market_price_reads_only_stored_bars(monkeypatch):
    """Changed 2026-07-31: this asserted delegation to get_latest_stock_price, which
    fetches a live quote and refreshes stale bars from the provider. That put a network
    call inside metric computation, so a comparison or DCF was not reproducible and a
    snapshot of it was not the evidence it claimed to be. The metric layer now reads the
    stored close only."""
    from apps.api.services import corporate_metrics_service

    calls: list[str] = []

    class StubMarketDataService:
        def get_latest_stored_price(self, ticker: str) -> float:
            calls.append(ticker)
            return 212.34

        def get_latest_stock_price(self, ticker: str, *, period: str = "1mo") -> float:
            raise AssertionError("metric computation must not request a live quote")

    monkeypatch.setattr(corporate_metrics_service, "_MKT", StubMarketDataService())

    assert corporate_metrics_service.latest_market_price("AAPL") == 212.34
    assert calls == ["AAPL"]


def test_get_latest_stored_price_never_touches_the_network(tmp_path, monkeypatch):
    """The seam test the branch was missing. Every other price test injects a stub at the
    loader boundary, so the suite's network guard stays silent at exactly the point the
    violation lived. This one calls the real method with the real bars table."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    with db_service.get_db() as conn:
        for day, close in (("2026-07-29", 100.0), ("2026-07-30", 123.45)):
            conn.execute(
                """INSERT INTO stocks (ticker, date, open, high, low, close, volume)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                ("AAPL", day, close, close, close, close, 1_000),
            )

    # No monkeypatching of the fetch path: if this reaches out, _forbid_network fails it.
    assert MarketDataService().get_latest_stored_price("aapl") == 123.45


def test_get_latest_stored_price_is_zero_when_nothing_is_stored(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    assert MarketDataService().get_latest_stored_price("NOTHINGSTORED") == 0.0


def test_stock_price_endpoint_returns_202_for_fetching_lookup(monkeypatch):
    from apps.api.routes import stock as stock_route

    monkeypatch.setattr(
        stock_route,
        "_mkt",
        type(
            "StubMarketDataService",
            (),
            {
                "get_stock_price_lookup": lambda self, ticker: StockPriceLookup(
                    ticker=ticker.upper(),
                    status="fetching",
                    source="cache_miss",
                    freshness_status="cache_miss",
                    retry_after_seconds=2,
                    detail_note="No cached price was available, so a background fetch has been started.",
                )
            },
        )(),
    )

    client = TestClient(app)
    response = client.get("/api/v1/stock/aapl/price")

    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["data"]["ticker"] == "AAPL"
    assert payload["data"]["status"] == "fetching"


def test_prewarm_configured_tickers_schedules_unique_symbols(monkeypatch):
    _reset_market_data_state()
    service = MarketDataService()
    monkeypatch.setenv("MONEYVIEW_PREWARM_TICKERS", "AAPL, msft, AAPL, ^GSPC")

    scheduled: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        service,
        "_refresh_ohlcv_in_background",
        lambda ticker, period="1mo", table="stocks": scheduled.append((ticker, period, table)),
    )

    tickers = service.prewarm_configured_tickers()

    assert tickers == ["AAPL", "MSFT", "^GSPC"]
    assert scheduled == [
        ("AAPL", "1mo", "stocks"),
        ("MSFT", "1mo", "stocks"),
        ("^GSPC", "1mo", "indices"),
    ]
