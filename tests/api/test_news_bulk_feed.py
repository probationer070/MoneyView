import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.services import db as db_service
from apps.api.services.acquisition.state import record_success

NOW = datetime(2026, 7, 31, 14, 0, tzinfo=timezone.utc)


def _insert(ticker, headline, published_date, url):
    with db_service.get_db() as conn:
        conn.execute(
            "INSERT INTO news (ticker, headline, url, source, published_date, sentiment,"
            " importance, hash) VALUES (?, ?, ?, ?, ?, 'neutral', 1, ?)",
            (ticker, headline, url, "s", published_date, url),
        )


def test_every_requested_ticker_is_a_key_even_with_no_news(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert("AAPL", "Apple headline", "2026-07-31", "u1")

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=AAPL,MSFT").json()["data"]

    assert set(payload["tickers"]) == {"AAPL", "MSFT"}
    assert payload["tickers"]["MSFT"]["articles"] == []


def test_last_checked_at_distinguishes_checked_empty_from_never_checked(tmp_path, monkeypatch):
    """The two states a tile must not conflate: MSFT was checked and had nothing, GOOGL
    was never checked at all. Without this the tile cannot say which."""
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    record_success("news", "MSFT", now=NOW, covered_from=NOW.date(), covered_to=NOW.date())

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=MSFT,GOOGL").json()["data"]

    assert payload["tickers"]["MSFT"]["last_checked_at"] is not None
    assert payload["tickers"]["GOOGL"]["last_checked_at"] is None


def test_articles_are_newest_first_with_undated_last(tmp_path, monkeypatch):
    """An undated article must never displace a dated one from a three-item tile."""
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert("AAPL", "undated", "", "u0")
    _insert("AAPL", "older", "2026-07-28", "u1")
    _insert("AAPL", "newest", "2026-07-31", "u2")

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=AAPL&per_ticker=3").json()["data"]

    assert [a["headline"] for a in payload["tickers"]["AAPL"]["articles"]] == [
        "newest", "older", "undated",
    ]


def test_per_ticker_limit_is_applied(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    for day in range(1, 6):
        _insert("AAPL", f"h{day}", f"2026-07-0{day}", f"u{day}")

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=AAPL&per_ticker=2").json()["data"]

    assert len(payload["tickers"]["AAPL"]["articles"]) == 2


def test_a_lowercase_ticker_is_normalised(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert("AAPL", "Apple headline", "2026-07-31", "u1")

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=aapl").json()["data"]

    assert payload["tickers"]["AAPL"]["articles"][0]["headline"] == "Apple headline"
