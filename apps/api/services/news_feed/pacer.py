"""The single gate every Google News request passes through.

One pacer serializes sends, spaces them with a random gap, stops everything after a
block until the next 00:00 UTC, and enforces a daily request cap. State lives in
`risk_state`, so a restart keeps the block, the day count and the last send time.

The send slot is held only for the fetch itself. A request waits for its gap on the condition,
so an interactive request that arrives while a bulk request waits its gap goes first, and every
gap is measured from the end of the previous fetch. `STOP` (set on app shutdown) ends any wait
with `NewsStopped`.
"""

from __future__ import annotations

import random
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from apps.api.services.acquisition.errors import ProviderRefused
from apps.api.services.news_feed.rss import FeedItem, FeedResult, fetch_feed, search_url
from apps.api.services.risk.store import get_state, set_state

Kind = Literal["bulk", "interactive"]

BULK_GAP = (20.0, 60.0)
INTERACTIVE_GAP = (3.0, 8.0)
DAILY_CAP = 500

BLOCKED_UNTIL_KEY = "news_blocked_until"
BLOCKED_REASON_KEY = "news_blocked_reason"
LAST_REQUEST_KEY = "news_last_request_at"

# Set by the app lifespan on shutdown. A waiting request notices it within _STOP_POLL seconds.
STOP = threading.Event()
_STOP_POLL = 0.5


def _count_key(day: datetime) -> str:
    return f"news_requests:{day.strftime('%Y-%m-%d')}"


def next_utc_midnight(now: datetime) -> datetime:
    start = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return start + timedelta(days=1)


class NewsBlocked(ProviderRefused, RuntimeError):
    def __init__(self, reason: Literal["blocked", "daily_limit"], retry_after: datetime) -> None:
        super().__init__(f"Google News {reason}; retry after {retry_after.isoformat()}")
        self.reason = reason
        self.retry_after = retry_after


class NewsStopped(ProviderRefused):
    """The app is shutting down; the request was not sent. Neither a block nor a failure."""


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
        sleep: Callable[[float], None] | None = None,
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

    def _pause(self, seconds: float | None) -> None:
        """Wait with the condition released; called holding it. `None` waits for a notify.

        Without an injected sleep this is the condition wait, in slices so `STOP` is seen. An
        injected sleep (a test's fake clock) is called with the lock released instead; the
        caller's loop re-checks everything either way."""
        if self._sleep is None or seconds is None:
            self._cond.wait(_STOP_POLL if seconds is None else min(seconds, _STOP_POLL))
            return
        self._cond.release()
        try:
            self._sleep(max(seconds, 1e-6))   # a fake clock counts whole microseconds
        finally:
            self._cond.acquire()

    def _gap_left(self, wanted: float) -> float:
        last = get_state(LAST_REQUEST_KEY)
        if not last:
            return 0.0
        return wanted - (self._clock() - datetime.fromisoformat(last)).total_seconds()

    def request(self, url: str, kind: Kind) -> FeedResult:
        interactive = kind == "interactive"
        wanted = self._rng.uniform(*(INTERACTIVE_GAP if interactive else BULK_GAP))
        with self._cond:
            if interactive:
                self._interactive_waiting += 1
            try:
                while True:
                    if STOP.is_set():
                        raise NewsStopped("news requests stopped for shutdown")
                    self._check_open()
                    if self._busy or (not interactive and self._interactive_waiting > 0):
                        self._pause(None)   # a fetch is in flight, or a bulk request yields
                        continue
                    left = self._gap_left(wanted)
                    if left > 0:
                        self._pause(left)
                        continue
                    break
            finally:
                if interactive:
                    self._interactive_waiting -= 1
            self._busy = True
        try:
            return self._send(url)
        finally:
            with self._cond:
                self._busy = False
                self._cond.notify_all()

    def _send(self, url: str) -> FeedResult:
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
        today = self._requests_today(now)
        if until is not None:
            reason: str | None = get_state(BLOCKED_REASON_KEY)
        elif today >= DAILY_CAP:
            until, reason = next_utc_midnight(now), "daily_limit"
        else:
            reason = None
        return PacerStatus(
            blocked_until=until.isoformat() if until else None,
            blocked_reason=reason,
            requests_today=today,
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
