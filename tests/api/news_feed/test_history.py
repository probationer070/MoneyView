"""Past-date news search, range reads and the status API. Each docstring names the mutation it catches."""
from __future__ import annotations

from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schemas import NewsArticle
from apps.api.services.db import get_db
from apps.api.services.news_feed import daily, history
from apps.api.services.news_feed.history import history_window, search_history
from apps.api.services.news_feed.pacer import NewsBlocked, PacerStatus, get_pacer
from apps.api.services.news_feed.rss import FeedItem
from apps.api.services.news_service import NewsService
from apps.api.services.risk import store

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
D = date(2016, 1, 27)
NAMES = {"AAPL": "Apple"}
KO = "애플"   # Korean name used for AAPL in these tests


class FakeGoogle:
    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.items: dict[str, list[FeedItem]] = {}
        self.errors: dict[str, BaseException] = {}

    def queries(self) -> list[str]:
        return [c[0] for c in self.calls]

    def __call__(self, query, lang, kind, *, after=None, before=None):
        self.calls.append((query, lang, kind, after, before))
        if lang in self.errors:
            raise self.errors[lang]
        return self.items.get(lang, [])


def item(n: int, lang: str = "en", day: str = "2016-01-27") -> FeedItem:
    return FeedItem(f"{lang} title {n}", f"https://x/{lang}/{n}", "Src", day, f"{day}T10:00:00+00:00", f"g{n}")


@pytest.fixture
def fake_google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(history, "google_news", fake)
    monkeypatch.setattr(history, "_queries", lambda: SimpleNamespace(ko_names={"AAPL": KO}))
    return fake


def _rows():
    with get_db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM news_history_searches").fetchall()]


def test_window_is_five_days_inclusive():
    """Catches a window of +-1 or +-3 days."""
    assert history_window(date(2016, 1, 27)) == (date(2016, 1, 25), date(2016, 1, 29))


def test_first_search_requests_once_per_language_and_saves_everything(fake_google):
    """Catches a missing language, wrong bounds, or items not stored with lang and published_at."""
    fake_google.items = {"en": [item(1), item(2)], "ko": [item(3, "ko")]}
    result = search_history("aapl", D, now=NOW, names=NAMES)
    assert fake_google.calls == [
        ("Apple AAPL", "en", "interactive", date(2016, 1, 24), date(2016, 1, 30)),
        (f"{KO} 주가", "ko", "interactive", date(2016, 1, 24), date(2016, 1, 30)),
    ]
    assert result.status == "searched_now"
    assert (result.start, result.end) == (date(2016, 1, 25), date(2016, 1, 29))
    assert {(a.ticker, a.lang, a.published_at) for a in result.articles} == {
        ("AAPL", "en", "2016-01-27T10:00:00+00:00"), ("AAPL", "ko", "2016-01-27T10:00:00+00:00")}
    assert len(result.articles) == 3
    assert [(s.lang, s.status, s.found) for s in result.searched] == [("en", "searched_now", 2), ("ko", "searched_now", 1)]


def test_second_identical_search_sends_nothing(fake_google):
    """Catches a missing cache lookup (the second search would call Google again)."""
    search_history("AAPL", D, now=NOW, names=NAMES)
    fake_google.calls.clear()
    result = search_history("AAPL", D, now=NOW, names=NAMES)
    assert fake_google.calls == []
    assert result.status == "cached"
    assert {s.status for s in result.searched} == {"cached"}


def test_hundred_items_marks_truncated(fake_google):
    """Catches truncated computed as > 100, or never set."""
    fake_google.items = {"en": [item(n) for n in range(100)], "ko": [item(1, "ko")]}
    result = search_history("AAPL", D, now=NOW, names=NAMES)
    assert result.truncated is True
    assert {s.lang: s.truncated for s in result.searched} == {"en": True, "ko": False}
    assert {r["lang"]: r["truncated"] for r in _rows()} == {"en": 1, "ko": 0}


def test_blocked_returns_retry_after_and_records_no_row(fake_google):
    """Catches a row inserted on a block (the search would then read as cached)."""
    retry = datetime(2026, 10, 26, tzinfo=UTC)
    fake_google.errors = {"en": NewsBlocked("daily_limit", retry), "ko": NewsBlocked("daily_limit", retry)}
    result = search_history("AAPL", D, now=NOW, names=NAMES)
    assert result.status == "daily_limit"
    assert result.retry_after == retry
    assert _rows() == []


def test_failed_search_can_run_again(fake_google):
    """Catches a row inserted on a failed fetch (the retry would be answered from cache)."""
    fake_google.errors = {"en": RuntimeError("boom"), "ko": RuntimeError("boom")}
    first = search_history("AAPL", D, now=NOW, names=NAMES)
    assert first.status == "failed"
    assert _rows() == []
    fake_google.errors = {}
    fake_google.calls.clear()
    second = search_history("AAPL", D, now=NOW, names=NAMES)
    assert len(fake_google.calls) == 2
    assert second.status == "searched_now"


def test_query_without_company_name_uses_ticker(fake_google):
    """Catches dropping .strip() (the query would start with a space)."""
    search_history("XYZ", date(2020, 3, 2), now=NOW, names={"XYZ": ""})
    assert fake_google.queries() == ["XYZ"]     # no Korean name for XYZ


def test_response_includes_previously_stored_articles_in_window(fake_google):
    """Catches articles limited to this search's items, or not bounded to the window."""
    svc = NewsService()
    for url, day in (("https://old/in", "2016-01-26"), ("https://old/out", "2016-02-10")):
        svc.save_article(NewsArticle(ticker="AAPL", headline=url, url=url, published_date=day))
    result = search_history("AAPL", D, now=NOW, names=NAMES)
    assert [a.url for a in result.articles] == ["https://old/in"]


@pytest.fixture
def client():
    with TestClient(app) as c:
        with get_db() as conn:
            conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight)"
                         " VALUES ('AAPL', 'Apple', '', 'core', 0.0)")
        yield c


def test_feed_range_filters_and_orders_nulls_last(client):
    """Catches an exclusive range, a missing ticker bound, NULLS FIRST, or published_at not returned."""
    svc = NewsService()
    rows = [("a", "2016-01-27", "2016-01-27T09:00:00+00:00"), ("b", "2016-01-27", None),
            ("c", "2016-01-27", "2016-01-27T11:00:00+00:00"), ("d", "2016-01-25", None),
            ("e", "2016-01-24", None), ("f", "2016-01-30", None), ("g", "2016-01-29", None)]
    for name, day, at in rows:
        svc.save_article(NewsArticle(ticker="AAPL", headline=name, url=f"https://x/{name}",
                                     published_date=day, published_at=at))
    body = client.get("/api/v1/news/feed", params={"ticker": "AAPL", "from": "2016-01-25", "to": "2016-01-29"}).json()
    assert [a["headline"] for a in body] == ["g", "c", "a", "b", "d"]
    assert body[1]["published_at"] == "2016-01-27T11:00:00+00:00"
    assert client.get("/api/v1/news/feed", params={"from": "bad"}).status_code == 422


def test_status_reports_block_count_and_daily_progress(client, monkeypatch):
    """Catches pacer fields not passed through, or the daily block ignoring marks and the done flag."""
    monkeypatch.setattr(get_pacer(), "status",
                        lambda: PacerStatus("2026-10-26T00:00:00+00:00", "daily_limit", 500, 500), raising=False)
    day = daily.session_day(datetime.now(UTC))
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight)"
                     " VALUES ('MSFT', 'Microsoft', '', 'core', 0.0)")
    store.set_state(f"news_daily:{day.isoformat()}:AAPL", "1")
    data = client.get("/api/v1/news/status").json()["data"]
    assert (data["blocked_reason"], data["requests_today"], data["daily_cap"]) == ("daily_limit", 500, 500)
    assert data["blocked_until"].startswith("2026-10-26T00:00:00")
    assert data["daily"] == {"session_day": day.isoformat(), "done": 1, "remaining": 1, "complete": False}
    store.set_state(f"news_daily:{day.isoformat()}:MSFT", "1")
    store.set_state(f"news_daily_done:{day.isoformat()}", "1")
    assert client.get("/api/v1/news/status").json()["data"]["daily"]["complete"] is True


def test_history_route_404_for_unknown_ticker(client, fake_google):
    """Catches the route searching Google for a ticker outside the watchlist."""
    r = client.post("/api/v1/news/history", json={"ticker": "ZZZZ", "date": "2016-01-27"})
    assert r.status_code == 404
    assert fake_google.calls == []
    assert client.post("/api/v1/news/history", json={"ticker": "AAPL", "date": "27/01/2016"}).status_code == 422


def test_history_route_returns_200_with_blocked_status(client, fake_google):
    """Catches a block mapped to HTTP 503 instead of a 200 with status and retry_after."""
    retry = datetime(2026, 10, 26, tzinfo=UTC)
    fake_google.errors = {"en": NewsBlocked("blocked", retry), "ko": NewsBlocked("blocked", retry)}
    r = client.post("/api/v1/news/history", json={"ticker": "AAPL", "date": "2016-01-27"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["status"] == "blocked" and data["retry_after"].startswith("2026-10-26")


@pytest.mark.parametrize("en, ko, expect", [
    ("ok", "blocked", "blocked"),
    ("ok", "failed", "failed"),
    ("cached", "failed", "failed"),
    ("failed", "blocked", "failed"),
    ("cached", "ok", "searched_now"),
])
def test_overall_status_shows_a_problem_in_any_language(fake_google, en, ko, expect):
    """Catches an overall status that hides a Korean block or failure behind an English success
    (or behind an English cache hit), or that does not pick the first problem in en, ko order."""
    retry = datetime(2026, 10, 26, tzinfo=UTC)
    outcome = {"blocked": NewsBlocked("blocked", retry), "failed": RuntimeError("boom")}
    start, end = history_window(D)
    for lang, kind in (("en", en), ("ko", ko)):
        if kind == "cached":
            history._record("AAPL", lang, start, end, NOW, 0, False)
        elif kind in outcome:
            fake_google.errors[lang] = outcome[kind]
    assert search_history("AAPL", D, now=NOW, names=NAMES).status == expect


def test_concurrent_identical_searches_send_once(monkeypatch):
    """Catches two identical searches both missing the cache and both asking Google."""
    import threading
    import time

    calls: list[str] = []

    def slow_google(query, lang, kind, *, after=None, before=None):
        calls.append(lang)
        time.sleep(0.2)
        return [item(1, lang)]

    monkeypatch.setattr(history, "google_news", slow_google)
    monkeypatch.setattr(history, "_queries", lambda: SimpleNamespace(ko_names={"AAPL": KO}))
    results: list = []
    threads = [threading.Thread(target=lambda: results.append(search_history("AAPL", D, now=NOW, names=NAMES)),
                                daemon=True) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert sorted(calls) == ["en", "ko"]
    assert sorted(r.status for r in results) == ["cached", "searched_now"]


def test_status_not_complete_while_tickers_remain(client):
    """Catches `complete` read from the done flag alone: a ticker added after the day was flagged
    done would be left unswept while the status says the day is complete."""
    day = daily.session_day(datetime.now(UTC))
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight)"
                     " VALUES ('MSFT', 'Microsoft', '', 'core', 0.0)")
    store.set_state(f"news_daily:{day.isoformat()}:AAPL", "1")
    store.set_state(f"news_daily_done:{day.isoformat()}", "1")      # MSFT added after the sweep
    daily_status = client.get("/api/v1/news/status").json()["data"]["daily"]
    assert (daily_status["remaining"], daily_status["complete"]) == (1, False)
