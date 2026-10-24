"""Acquiring news for the whole watchlist goes through the Google News pacer.

Spacing, the block stop and the daily cap live in the pacer (apps/api/services/news_feed),
so the route no longer sleeps. What the route still owns: asking as an interactive caller,
and, once the pacer reports a block, not asking again for the rest of the batch.
Each docstring names the mutation its test catches.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from apps.api.routes import news as news_routes
from apps.api.services import db as db_service
from apps.api.services.news_feed import NewsBlocked
from apps.api.services.news_feed.rss import FeedItem

NOW = datetime(2026, 10, 25, 14, 30, tzinfo=timezone.utc)


def _seed(names: dict[str, str]) -> None:
    with db_service.get_db() as conn:
        for ticker, name in names.items():
            conn.execute(
                "INSERT INTO watchlist (ticker, name, sector, group_name, weight)"
                " VALUES (?, ?, '', 'core', 0.0)",
                (ticker, name),
            )


def _feed_item(title: str) -> FeedItem:
    return FeedItem(title=title, url=f"https://x/{title}", source="Reuters",
                    published_date="2026-10-25", published_at="2026-10-25T10:00:00Z", guid=title)


def test_acquire_uses_interactive_kind(monkeypatch):
    """Catches a user-pressed refresh that queues as bulk behind a sweep (or a hard-coded kind)."""
    kinds: list[str] = []

    def fake_google_news(query, lang, kind, **_):
        kinds.append(kind)
        return [_feed_item("one")]

    monkeypatch.setattr(
        "apps.api.services.webscrap.Crawler.StockNewsCrawler.google_news", fake_google_news)
    _seed({"AAA": "Alpha"})

    results = news_routes.acquire_news_batch(["AAA"], now=NOW)

    assert kinds == ["interactive"]
    assert results == [{"ticker": "AAA", "status": "acquired", "articles": 1, "detail": None}]


def test_block_fails_the_rest_without_fetching():
    """Catches a batch that keeps calling the fetcher after the pacer reported a block,
    and one that reports the blocked ticker (or a later one) as anything but failed."""
    _seed({"AAA": "Alpha", "BBB": "Beta", "CCC": "Gamma", "DDD": "Delta"})
    retry_after = datetime(2026, 10, 26, 0, 0, tzinfo=timezone.utc)
    calls: list[str] = []

    def fetcher(ticker, company_name=""):
        calls.append(ticker)
        if ticker == "BBB":
            raise NewsBlocked("blocked", retry_after)
        return []

    results = news_routes.acquire_news_batch(["AAA", "BBB", "CCC", "DDD"], now=NOW, fetcher=fetcher)

    assert calls == ["AAA", "BBB"]
    detail = f"blocked until {retry_after.isoformat()}"
    assert [(r["ticker"], r["status"], r["detail"]) for r in results] == [
        ("AAA", "empty", None),
        ("BBB", "failed", detail),
        ("CCC", "failed", detail),
        ("DDD", "failed", detail),
    ]


def test_routes_news_has_no_sleep():
    """Catches a sleep put back in the route: pacing belongs to the pacer alone."""
    source = Path(news_routes.__file__).read_text(encoding="utf-8")
    assert "time.sleep" not in source


def test_the_cap_still_guards_a_single_request():
    """Chunking is the client's job; the endpoint keeps its own bound."""
    assert news_routes.MAX_ACQUIRE_TICKERS == 100
