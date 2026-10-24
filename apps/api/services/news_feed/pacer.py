"""The single gate every Google News request passes through.

One pacer serializes sends, spaces them with a random gap, stops everything after a
block until the next 00:00 UTC, and enforces a daily request cap. State lives in
`risk_state`, so a restart keeps the block, the day count and the last send time.
"""

from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from apps.api.services.news_feed.rss import FeedItem, FeedResult, fetch_feed, search_url
from apps.api.services.risk.store import get_state, set_state

Kind = Literal["bulk", "interactive"]

BULK_GAP = (20.0, 60.0)
INTERACTIVE_GAP = (3.0, 8.0)
DAILY_CAP = 500

BLOCKED_UNTIL_KEY = "news_blocked_until"
BLOCKED_REASON_KEY = "news_blocked_reason"
LAST_REQUEST_KEY = "news_last_request_at"


def _count_key(day: datetime) -> str:
    return f"news_requests:{day.strftime('%Y-%m-%d')}"


def next_utc_midnight(now: datetime) -> datetime:
    start = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return start + timedelta(days=1)


class NewsBlocked(RuntimeError):
    def __init__(self, reason: Literal["blocked", "daily_limit"], retry_after: datetime) -> None:
        super().__init__(f"Google News {reason}; retry after {retry_after.isoformat()}")
        self.reason = reason
        self.retry_after = retry_after


@dataclass(frozen=True)
class PacerStatus:
    blocked_until: str | None
    blocked_reason: str | None
    requests_today: int
    daily_cap: int


class Pacer:
    def __init__(
        self,
        *,
        fetch: Callable[[str], FeedResult] = fetch_feed,
        clock: Callable[[], datetime],
        sleep: Callable[[float], None] = time.sleep,
        rng: random.Random | None = None,
    ) -> None:
        self._fetch = fetch
        self._clock = clock
        self._sleep = sleep
        self._rng = rng or random.Random()
        self._cond = threading.Condition()
        self._busy = False
        self._interactive_waiting = 0

    def _requests_today(self, now: datetime) -> int:
        return int(get_state(_count_key(now)) or 0)

    def _blocked_until(self, now: datetime) -> datetime | None:
        raw = get_state(BLOCKED_UNTIL_KEY)
        if not raw:
            return None
        until = datetime.fromisoformat(raw)
        return until if now < until else None

    def _check_open(self) -> None:
        now = self._clock()
        until = self._blocked_until(now)
        if until is not None:
            raise NewsBlocked("blocked", until)
        if self._requests_today(now) >= DAILY_CAP:
            raise NewsBlocked("daily_limit", next_utc_midnight(now))

    def request(self, url: str, kind: Kind) -> FeedResult:
        self._check_open()
        interactive = kind == "interactive"
        with self._cond:
            if interactive:
                self._interactive_waiting += 1
            try:
                while self._busy or (not interactive and self._interactive_waiting > 0):
                    self._cond.wait()
            finally:
                if interactive:
                    self._interactive_waiting -= 1
            self._busy = True
        try:
            return self._send(url, kind)
        finally:
            with self._cond:
                self._busy = False
                self._cond.notify_all()

    def _send(self, url: str, kind: Kind) -> FeedResult:
        self._check_open()
        gap = INTERACTIVE_GAP if kind == "interactive" else BULK_GAP
        wanted = self._rng.uniform(*gap)
        last = get_state(LAST_REQUEST_KEY)
        elapsed = (self._clock() - datetime.fromisoformat(last)).total_seconds() if last else wanted
        self._sleep(max(0.0, wanted - elapsed))
        self._check_open()

        try:
            result = self._fetch(url)
        finally:
            now = self._clock()
            set_state(_count_key(now), str(self._requests_today(now) + 1))
            set_state(LAST_REQUEST_KEY, now.isoformat())
        if result.status == "blocked":
            retry_after = next_utc_midnight(now)
            set_state(BLOCKED_UNTIL_KEY, retry_after.isoformat())
            set_state(BLOCKED_REASON_KEY, "blocked")
            raise NewsBlocked("blocked", retry_after)
        return result

    def status(self) -> PacerStatus:
        now = self._clock()
        until = self._blocked_until(now)
        return PacerStatus(
            blocked_until=until.isoformat() if until else None,
            blocked_reason=get_state(BLOCKED_REASON_KEY) if until else None,
            requests_today=self._requests_today(now),
            daily_cap=DAILY_CAP,
        )


_pacer: Pacer | None = None
_pacer_lock = threading.Lock()


def get_pacer() -> Pacer:
    global _pacer
    with _pacer_lock:
        if _pacer is None:
            _pacer = Pacer(clock=lambda: datetime.now(UTC))
        return _pacer


def google_news(
    query: str,
    lang: Literal["en", "ko"],
    kind: Kind,
    *,
    after: date | None = None,
    before: date | None = None,
) -> list[FeedItem]:
    result = get_pacer().request(search_url(query, lang, after=after, before=before), kind)
    if result.status == "failed":
        raise RuntimeError(result.detail)
    return result.items
