import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import StockPriceLookup
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


def _db_path() -> Path:
    temp_root = Path(r"E:\MoneyView\data\processed")
    temp_root.mkdir(parents=True, exist_ok=True)
    return temp_root / f"test-stock-price-{next(tempfile._get_candidate_names())}.db"


def test_get_stock_price_lookup_returns_fetching_on_cold_miss(monkeypatch):
    db_path = _db_path()
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


def test_get_stock_price_lookup_returns_stale_cache_and_schedules_refresh(monkeypatch):
    db_path = _db_path()
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


def test_get_stock_price_lookup_returns_not_found_after_failed_background_refresh(monkeypatch):
    db_path = _db_path()
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
