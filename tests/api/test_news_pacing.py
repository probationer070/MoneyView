"""Acquiring news for the whole watchlist, without looking like a bot.

Two separate defects meet here.

`MAX_ACQUIRE_TICKERS = 100` is enforced on both `/news/feed/bulk` and `/news/acquire`,
and the watchlist holds 139 rows. So switching the tile grid to All exceeded the cap and
both endpoints returned 400 -- the read as well as the refresh, which is why the grid
reported "Could not load news for the visible stocks" rather than a refresh failure. The
client now sends the tickers in chunks, so the cap constrains one request rather than the
feature.

Pacing is the second. The batch was already sequential by decision, at a measured
0.8-1.0s per crawl, but back-to-back requests to one provider across 139 tickers is the
shape that gets a client classified as automated. A delay is inserted between crawls that
actually reached the provider -- and deliberately not after the ones the hourly freshness
boundary skipped, because a skip made no request and pausing after it would pay the whole
cost of pacing while buying none of its protection.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from apps.api.routes import news as news_routes


@pytest.fixture
def _sleeps(monkeypatch):
    recorded: list[float] = []
    monkeypatch.setattr(news_routes.time, "sleep", lambda seconds: recorded.append(seconds))
    monkeypatch.setattr(news_routes, "NEWS_CRAWL_DELAY_SECONDS", 0.25)
    return recorded


@pytest.fixture
def _watchlist(monkeypatch):
    names = {"AAA": "Alpha", "BBB": "Beta", "CCC": "Gamma"}
    monkeypatch.setattr(news_routes, "_watchlist_names", lambda: names)
    return names


def _outcomes(monkeypatch, by_ticker: dict[str, str]):
    """Drive acquire_point_in_time's verdict per ticker without touching a provider."""

    class _Outcome:
        def __init__(self, reason: str) -> None:
            self.reason = reason
            self.fetched_rows = 1 if reason == "acquired" else 0

    def fake_acquire(data_class, ticker, **_):
        return _Outcome(by_ticker[ticker])

    monkeypatch.setattr(news_routes, "acquire_point_in_time", fake_acquire)
    monkeypatch.setattr(news_routes, "read_state", lambda *a, **k: type("S", (), {"detail": None})())


def test_a_delay_separates_crawls_that_reached_the_provider(monkeypatch, _sleeps, _watchlist):
    _outcomes(monkeypatch, {"AAA": "acquired", "BBB": "acquired", "CCC": "acquired"})

    news_routes.acquire_news_batch(["AAA", "BBB", "CCC"], now=datetime.now(timezone.utc))

    # Between crawls, not after the last one: three fetches need two gaps.
    assert _sleeps == [0.25, 0.25]


def test_a_skipped_ticker_costs_no_delay(monkeypatch, _sleeps, _watchlist):
    """The hourly boundary skips most tickers, and a skip made no request to pace."""
    _outcomes(monkeypatch, {"AAA": "fresh", "BBB": "fresh", "CCC": "fresh"})

    news_routes.acquire_news_batch(["AAA", "BBB", "CCC"], now=datetime.now(timezone.utc))

    assert _sleeps == []


def test_only_the_gaps_between_real_crawls_are_paced(monkeypatch, _sleeps, _watchlist):
    _outcomes(monkeypatch, {"AAA": "acquired", "BBB": "fresh", "CCC": "acquired"})

    news_routes.acquire_news_batch(["AAA", "BBB", "CCC"], now=datetime.now(timezone.utc))

    assert _sleeps == [0.25]


def test_a_failed_crawl_is_paced_like_a_successful_one(monkeypatch, _sleeps, _watchlist):
    """A failure still reached the provider, so it still counts toward the request rate.

    Two pauses, not one: the pause before CCC is paid before the call that reveals CCC is
    fresh. Pacing cannot know the answer in advance without duplicating the boundary
    logic, and paying one unnecessary pause is cheaper than that duplication -- so this
    asserts what the code does rather than the tidier number.
    """
    _outcomes(monkeypatch, {"AAA": "failed", "BBB": "acquired", "CCC": "fresh"})

    news_routes.acquire_news_batch(["AAA", "BBB", "CCC"], now=datetime.now(timezone.utc))

    assert _sleeps == [0.25, 0.25]


def test_one_ticker_is_never_paced(monkeypatch, _sleeps, _watchlist):
    _outcomes(monkeypatch, {"AAA": "acquired"})

    news_routes.acquire_news_batch(["AAA"], now=datetime.now(timezone.utc))

    assert _sleeps == []


def test_the_cap_still_guards_a_single_request():
    """Chunking is the client's job; the endpoint keeps its own bound."""
    assert news_routes.MAX_ACQUIRE_TICKERS == 100
