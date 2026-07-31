import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schema_parts.market import StockOHLCV
from apps.api.routes import portfolio as portfolio_routes
from apps.api.services import db as db_service


def test_watchlist_rows_expose_id_for_recency_ordering(tmp_path, monkeypatch):
    """The grid's no-weights fallback shows the most recently added stocks. watchlist has
    no created_at, so insertion order lives only in the autoincrement id."""
    # Mock market data to avoid network calls
    bars = [
        StockOHLCV(date=f"2026-07-{day:02d}", open=10.0, high=11.0, low=9.0, close=10.0 + day, volume=1_000)
        for day in range(1, 21)
    ]
    monkeypatch.setattr(portfolio_routes._mkt, "get_stock_ohlcv", lambda *args, **kwargs: bars)

    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    with db_service.get_db() as conn:
        for ticker in ("AAPL", "MSFT", "NVDA"):
            conn.execute(
                "INSERT INTO watchlist (ticker, name, sector, group_name, weight)"
                " VALUES (?, ?, '', 'core', 0.0)",
                (ticker, ticker),
            )

    rows = TestClient(app).get("/api/v1/portfolio/watchlist").json()

    ids = {row["ticker"]: row["id"] for row in rows}
    assert ids["NVDA"] > ids["MSFT"] > ids["AAPL"]
