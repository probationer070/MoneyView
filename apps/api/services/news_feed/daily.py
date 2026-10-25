"""Daily stock-news sweep and the queue of alert tickers waiting for news.

One sweep per US-session day (the day rolls over at 21:00 UTC, after the US close). Each
watchlist ticker is marked in `risk_state` when done, so a restart resumes where it stopped.
A Google block ends the sweep; the rest waits for the next loop pass. A shutdown stop
(`NewsStopped`) propagates without marking the ticker.
"""
from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Callable, Literal, Sequence

from apps.api.models.schemas import NewsArticle
from apps.api.services.acquisition.runner import acquire_point_in_time
from apps.api.services.acquisition.sources.news import fetch_news
from apps.api.services.acquisition.store import news_coverage, save_news
from apps.api.services.news_feed.pacer import NewsBlocked, NewsStopped, get_pacer, google_news
from apps.api.services.news_service import NewsService
from apps.api.services.risk import store
from apps.api.services.risk.news import _queries, sweep_news

logger = logging.getLogger(__name__)

US_CLOSE_UTC = time(21, 0)
QUEUE_KEY = "news_alert_queue"
KEEP_DAYS = 7
# Guards the queue's read-modify-write: the risk cycle queues while the news loop drains.
_QUEUE_LOCK = threading.Lock()


def session_day(now: datetime) -> date:
    return now.date() if now.time() >= US_CLOSE_UTC else now.date() - timedelta(days=1)


@dataclass
class DailyReport:
    session_day: date
    done: int
    remaining: int
    stopped: Literal["complete", "blocked", "daily_limit"]


def _mark(day: date, ticker: str) -> str:
    return f"news_daily:{day.isoformat()}:{ticker}"


def _done_key(day: date) -> str:
    return f"news_daily_done:{day.isoformat()}"


def daily_due(now: datetime) -> bool:
    return store.get_state(_done_key(session_day(now))) is None


def _default_watchlist() -> list[tuple[str, str]]:
    from apps.api.routes.news import _watchlist_names

    return list(_watchlist_names().items())


def _save_korean(ticker: str, ko_name: str) -> None:
    service = NewsService()
    for item in google_news(f"{ko_name} 주가", "ko", "bulk"):
        service.save_article(NewsArticle(
            ticker=ticker, headline=item.title, url=item.url, source=item.source,
            published_date=item.published_date, published_at=item.published_at, lang="ko", topic="",
        ))


def run_daily_sweep(
    now: datetime,
    *,
    watchlist: Callable[[], list[tuple[str, str]]] | None = None,
    clock: Callable[[], datetime] | None = None,
) -> DailyReport:
    """`now` fixes the session day; each ticker's check is stamped with `clock()` at its own
    fetch, since a pass can run for hours."""
    clock = clock or (lambda: datetime.now(UTC))
    day = session_day(now)
    rows = sorted((str(t).upper(), name) for t, name in (watchlist or _default_watchlist)())
    ko_names = _queries().ko_names
    todo = [(t, n) for t, n in rows if store.get_state(_mark(day, t)) is None]
    stopped: Literal["complete", "blocked", "daily_limit"] = "complete"

    for ticker, name in todo:
        try:
            # A block or stop reaches here without a recorded check: nothing was sent.
            acquire_point_in_time(
                "news", ticker, now=clock(),
                fetcher=lambda subject, _name=name: fetch_news(subject, company_name=_name, kind="bulk"),
                saver=save_news, coverage=news_coverage,
            )
            if ticker in ko_names:
                _save_korean(ticker, ko_names[ticker])
        except (AssertionError, NewsStopped):
            raise
        except NewsBlocked as error:
            logger.warning("news.daily_blocked ticker=%s error=%s", ticker, error)
            stopped = error.reason
            break
        except Exception as error:  # noqa: BLE001 - retried tomorrow
            logger.warning("news.daily_failed ticker=%s error=%s", ticker, error)
        store.set_state(_mark(day, ticker), "1")

    remaining = sum(1 for t, _ in rows if store.get_state(_mark(day, t)) is None)
    if remaining == 0:
        store.set_state(_done_key(day), "1")
    cutoff = (day - timedelta(days=KEEP_DAYS)).isoformat()
    store.delete_states_below("news_daily:", cutoff)
    store.delete_states_below("news_daily_done:", cutoff)
    return DailyReport(day, len(rows) - remaining, remaining, stopped)


def _read_queue() -> list[str]:
    raw = store.get_state(QUEUE_KEY)
    return list(json.loads(raw)) if raw else []


def queue_alert_tickers(tickers: Sequence[str]) -> None:
    with _QUEUE_LOCK:
        merged = list(dict.fromkeys(_read_queue() + [str(t).upper() for t in tickers]))
        store.set_state(QUEUE_KEY, json.dumps(merged))


def _labels(ticker: str) -> set[str]:
    labels = {f"{ticker}:en"}
    if ticker in _queries().ko_names:
        labels.add(f"{ticker}:ko")
    return labels


def drain_alert_queue(now: datetime) -> None:
    """Sweep the queued tickers, then remove from the queue only those attempted. The queue is
    read again at the end because the risk cycle may have queued more during the sweep."""
    with _QUEUE_LOCK:
        queue = _read_queue()
    if not queue:
        return
    day = session_day(now)
    rest = [t for t in queue if store.get_state(_mark(day, t)) is None]
    attempted = [t for t in queue if t not in rest]
    if rest:
        report = sweep_news(now, tickers=rest, include_topics=False)
        failed = set(report.failed)
        if get_pacer().status().blocked_until is not None:
            # The sweep stopped at the block: a ticker whose every feed failed was never sent.
            attempted += [t for t in rest if not _labels(t) <= failed]
        else:
            attempted += rest
    with _QUEUE_LOCK:
        left = [t for t in _read_queue() if t not in attempted]
        if left:
            store.set_state(QUEUE_KEY, json.dumps(left))
        else:
            store.delete_state(QUEUE_KEY)
