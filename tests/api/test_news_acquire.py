import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import NewsArticle
from apps.api.routes.news import acquire_news_batch
from apps.api.services import db as db_service
from apps.api.services.acquisition.state import record_success

NOW = datetime(2026, 7, 31, 14, 30, tzinfo=timezone.utc)


def _seed_watchlist(tickers):
    with db_service.get_db() as conn:
        for ticker in tickers:
            conn.execute(
                "INSERT INTO watchlist (ticker, name, sector, group_name, weight)"
                " VALUES (?, ?, '', 'core', 0.0)",
                (ticker, ticker),
            )


def _article(ticker):
    return NewsArticle(ticker=ticker, headline=f"{ticker} headline",
                       url=f"https://x/{ticker}", source="s", published_date="2026-07-31")


def test_a_stale_ticker_is_acquired(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])

    results = acquire_news_batch(
        ["AAPL"], now=NOW, fetcher=lambda ticker, company_name="": [_article(ticker)]
    )

    assert results == [{"ticker": "AAPL", "status": "acquired", "articles": 1, "detail": None}]


def test_a_fresh_ticker_is_skipped_without_fetching(tmp_path, monkeypatch):
    """Freshness asks 'have I asked since the boundary'. A second press within the hour
    must perform no provider work at all -- that is what makes the button safe to press."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])
    record_success("news", "AAPL", now=NOW, covered_from=NOW.date(), covered_to=NOW.date())

    calls = []
    results = acquire_news_batch(
        ["AAPL"], now=NOW,
        fetcher=lambda ticker, company_name="": calls.append(ticker) or [],
    )

    assert calls == []
    assert results[0]["status"] == "fresh"


def test_one_failing_ticker_does_not_abort_the_batch(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL", "MSFT"])

    def flaky(ticker, company_name=""):
        if ticker == "AAPL":
            raise RuntimeError("provider timeout")
        return [_article(ticker)]

    results = acquire_news_batch(["AAPL", "MSFT"], now=NOW, fetcher=flaky)

    by_ticker = {row["ticker"]: row for row in results}
    assert by_ticker["AAPL"]["status"] == "failed"
    assert "provider timeout" in by_ticker["AAPL"]["detail"]
    assert by_ticker["MSFT"]["status"] == "acquired"


def test_duplicates_collapse_to_one_acquisition(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])

    calls = []
    results = acquire_news_batch(
        ["AAPL", "aapl", "AAPL"], now=NOW,
        fetcher=lambda ticker, company_name="": calls.append(ticker) or [_article(ticker)],
    )

    assert calls == ["AAPL"]
    assert len(results) == 1


def test_the_route_rejects_an_empty_and_an_oversized_request(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])
    client = TestClient(app)

    assert client.post("/api/v1/news/acquire", json={"tickers": []}).status_code == 400
    assert client.post(
        "/api/v1/news/acquire", json={"tickers": [f"T{i}" for i in range(101)]}
    ).status_code == 400


def test_a_ticker_outside_the_watchlist_is_reported_not_crawled(tmp_path, monkeypatch):
    """This is what stops the endpoint becoming a generic crawler. Skipping rather than
    400ing keeps an ordinary remove-during-session race from failing the whole batch."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])

    calls = []
    results = acquire_news_batch(
        ["AAPL", "ZZZZ"], now=NOW,
        fetcher=lambda ticker, company_name="": calls.append(ticker) or [],
    )

    assert calls == ["AAPL"]
    assert [row["ticker"] for row in results] == ["AAPL"]
