"""Past-date news search: five days around a date, one Google request per language.

A finished search is recorded in `news_history_searches`, so asking again for the same
window sends nothing. A block or a failed fetch records nothing and can be retried.
Identical searches running at once share a lock, so the second reads the first one's record.
"""
from __future__ import annotations

import sqlite3
import threading
from datetime import date, datetime, timedelta
from typing import Mapping

from apps.api.models.schemas import NewsArticle
from apps.api.models.schema_parts.news import HistoryStatus, NewsHistoryLang, NewsHistoryResponse
from apps.api.services.db import get_db
from apps.api.services.news_feed.pacer import NewsBlocked, google_news
from apps.api.services.news_service import NewsService
from apps.api.services.risk.news import _queries

WINDOW_DAYS = 2
RESULT_CAP = 100
_PROBLEMS = ("blocked", "daily_limit", "failed")

# One lock per (ticker, start, end). The dict only grows by the windows asked for in this process.
_search_locks: dict[tuple[str, date, date], threading.Lock] = {}
_search_locks_guard = threading.Lock()


def _search_lock(ticker: str, start: date, end: date) -> threading.Lock:
    with _search_locks_guard:
        return _search_locks.setdefault((ticker, start, end), threading.Lock())


def history_window(d: date) -> tuple[date, date]:
    return d - timedelta(days=WINDOW_DAYS), d + timedelta(days=WINDOW_DAYS)


def _cached(ticker: str, lang: str, start: date, end: date) -> sqlite3.Row | None:
    with get_db() as conn:
        return conn.execute(
            'SELECT found, truncated FROM news_history_searches'
            ' WHERE ticker = ? AND lang = ? AND start = ? AND "end" = ?',
            (ticker, lang, start.isoformat(), end.isoformat()),
        ).fetchone()


def _record(ticker: str, lang: str, start: date, end: date, now: datetime, found: int, truncated: bool) -> None:
    with get_db() as conn:
        conn.execute(
            'INSERT OR REPLACE INTO news_history_searches'
            ' (ticker, lang, start, "end", searched_at, found, truncated) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (ticker, lang, start.isoformat(), end.isoformat(), now.isoformat(), found, int(truncated)),
        )


def search_history(
    ticker: str,
    d: date,
    *,
    now: datetime,
    names: Mapping[str, str] | None = None,
) -> NewsHistoryResponse:
    ticker = ticker.upper()
    start, end = history_window(d)
    name = (names or {}).get(ticker, "")
    queries = {"en": f"{name} {ticker}".strip()}
    ko_name = _queries().ko_names.get(ticker)
    if ko_name:
        queries["ko"] = f"{ko_name} 주가"

    service = NewsService()
    searched: list[NewsHistoryLang] = []
    retry_after: datetime | None = None
    with _search_lock(ticker, start, end):
        for lang, query in queries.items():
            row = _cached(ticker, lang, start, end)
            if row is not None:
                searched.append(NewsHistoryLang(lang=lang, status="cached", found=row["found"],
                                                truncated=bool(row["truncated"])))
                continue
            try:
                items = google_news(query, lang, "interactive",
                                    after=start - timedelta(days=1), before=end + timedelta(days=1))
            except NewsBlocked as error:
                retry_after = retry_after or error.retry_after
                searched.append(NewsHistoryLang(lang=lang, status=error.reason, found=0, truncated=False))
                continue
            except RuntimeError:
                searched.append(NewsHistoryLang(lang=lang, status="failed", found=0, truncated=False))
                continue
            for it in items:
                service.save_article(NewsArticle(
                    ticker=ticker, headline=it.title, url=it.url, source=it.source,
                    published_date=it.published_date, published_at=it.published_at, lang=lang, topic="",
                ))
            truncated = len(items) == RESULT_CAP
            _record(ticker, lang, start, end, now, len(items), truncated)
            searched.append(NewsHistoryLang(lang=lang, status="searched_now", found=len(items), truncated=truncated))

    # A problem in any language shows (the first, en before ko); "cached" only when all are.
    problems = [s.status for s in searched if s.status in _PROBLEMS]
    status: HistoryStatus
    if problems:
        status = problems[0]
    elif all(s.status == "cached" for s in searched):
        status = "cached"
    else:
        status = "searched_now"
    articles = service.get_news(ticker=ticker, from_date=start.isoformat(), to_date=end.isoformat(), limit=500)
    return NewsHistoryResponse(
        ticker=ticker, start=start, end=end, status=status, retry_after=retry_after,
        truncated=any(s.truncated for s in searched), searched=searched, articles=articles,
    )
