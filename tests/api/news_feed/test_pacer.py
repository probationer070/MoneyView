from __future__ import annotations

import random
import threading
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from apps.api.services.news_feed import pacer as pacer_module
from apps.api.services.news_feed.pacer import (
    DAILY_CAP,
    NewsBlocked,
    Pacer,
    google_news,
    next_utc_midnight,
)
from apps.api.services.news_feed.rss import FeedResult
from apps.api.services.risk.store import get_state, set_state

START = datetime(2026, 10, 25, 12, 0, 0, tzinfo=UTC)


class FakeClock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


@pytest.fixture
def pacer_env():
    def build(clock=None, responses=None, fetch=None, cap_already=0, fetch_seconds=0.0):
        clock = clock or FakeClock(START)
        calls = SimpleNamespace(times=[], urls=[], ends=[], clock=clock)
        queue = list(responses) if responses is not None else None

        def fake_fetch(url):
            calls.times.append(clock())
            calls.urls.append(url)
            calls.ends.append(clock() + timedelta(seconds=fetch_seconds))
            clock.advance(fetch_seconds)
            if fetch is not None:
                return fetch(url)
            if queue:
                return queue.pop(0)
            return FeedResult("ok", [])

        if cap_already:
            set_state(f"news_requests:{clock().strftime('%Y-%m-%d')}", str(cap_already))
        pacer = Pacer(fetch=fake_fetch, clock=clock, sleep=clock.advance, rng=random.Random(7))
        return pacer, calls

    return build


def test_bulk_gaps_are_random_and_within_20_60(pacer_env):
    p, calls = pacer_env()
    for i in range(6):
        p.request(f"u{i}", "bulk")
    gaps = [(b - a).total_seconds() for a, b in zip(calls.times, calls.times[1:])]
    assert all(20 <= g <= 60 for g in gaps) and len({round(g, 3) for g in gaps}) > 1


def test_interactive_gap_is_3_8_even_right_after_bulk(pacer_env):
    p, calls = pacer_env()
    p.request("bulk", "bulk")
    p.request("click", "interactive")
    assert 3 <= (calls.times[1] - calls.times[0]).total_seconds() <= 8


def test_first_request_after_restart_waits_from_stored_last_request(pacer_env):
    p, calls = pacer_env()
    p.request("a", "bulk")
    p2, calls2 = pacer_env(clock=calls.clock)
    p2.request("b", "interactive")
    assert (calls2.times[0] - calls.times[0]).total_seconds() >= 3


def test_block_stops_every_request_until_next_utc_midnight(pacer_env):
    p, calls = pacer_env(responses=[FeedResult("blocked", [], "429")])
    with pytest.raises(NewsBlocked) as first:
        p.request("a", "bulk")
    assert first.value.reason == "blocked"
    assert first.value.retry_after == next_utc_midnight(calls.clock())
    with pytest.raises(NewsBlocked):
        p.request("b", "interactive")
    assert len(calls.times) == 1


def test_block_lifts_at_next_utc_midnight(pacer_env):
    p, calls = pacer_env(responses=[FeedResult("blocked", [], "429")])
    with pytest.raises(NewsBlocked):
        p.request("a", "bulk")
    calls.clock.now = next_utc_midnight(calls.clock()) - timedelta(seconds=1)
    with pytest.raises(NewsBlocked):
        p.request("b", "bulk")
    calls.clock.now = next_utc_midnight(calls.clock())
    p.request("c", "bulk")
    assert calls.urls == ["a", "c"]


def test_block_survives_restart(pacer_env):
    p, calls = pacer_env(responses=[FeedResult("blocked", [], "429")])
    with pytest.raises(NewsBlocked):
        p.request("a", "bulk")
    p2, calls2 = pacer_env(clock=calls.clock)
    with pytest.raises(NewsBlocked) as again:
        p2.request("b", "interactive")
    assert again.value.reason == "blocked" and calls2.urls == []
    assert p2.status().blocked_reason == "blocked"


def test_status_reports_no_block_and_count(pacer_env):
    p, _ = pacer_env()
    p.request("a", "bulk")
    s = p.status()
    assert (s.blocked_until, s.blocked_reason, s.requests_today, s.daily_cap) == (
        None,
        None,
        1,
        DAILY_CAP,
    )


def test_gap_is_measured_from_end_of_previous_fetch(pacer_env):
    p, calls = pacer_env(fetch_seconds=10.0)
    for i in range(6):
        p.request(f"u{i}", "bulk")
    gaps = [(b - a).total_seconds() for a, b in zip(calls.ends, calls.times[1:])]
    assert all(g >= 20 for g in gaps)


def test_status_reports_daily_limit_as_block_until_midnight(pacer_env):
    p, calls = pacer_env(cap_already=DAILY_CAP)
    s = p.status()
    assert s.blocked_until == next_utc_midnight(calls.clock()).isoformat()
    assert s.blocked_reason == "daily_limit" and s.requests_today == DAILY_CAP


def test_status_stored_block_wins_over_daily_limit(pacer_env):
    p, calls = pacer_env(responses=[FeedResult("blocked", [], "429")], cap_already=DAILY_CAP - 1)
    with pytest.raises(NewsBlocked):
        p.request("a", "bulk")
    assert p.status().blocked_reason == "blocked"


def test_daily_cap_counts_all_kinds_and_refuses_at_500(pacer_env):
    p, calls = pacer_env(cap_already=499)
    p.request("a", "interactive")
    with pytest.raises(NewsBlocked) as e:
        p.request("b", "bulk")
    assert e.value.reason == "daily_limit" and len(calls.times) == 1


def test_count_resets_at_utc_midnight(pacer_env):
    p, calls = pacer_env(cap_already=DAILY_CAP)
    with pytest.raises(NewsBlocked) as e:
        p.request("a", "bulk")
    assert e.value.retry_after == next_utc_midnight(calls.clock())
    calls.clock.now = next_utc_midnight(calls.clock())
    p.request("b", "bulk")
    assert calls.urls == ["b"] and p.status().requests_today == 1


def test_interactive_waiting_goes_before_bulk_waiting(pacer_env):
    release = threading.Event()

    def slow(url):
        if url == "first":
            assert release.wait(5)
        return FeedResult("ok", [])

    p, calls = pacer_env(fetch=slow)
    threads = [threading.Thread(target=p.request, args=("first", "bulk"), daemon=True)]
    threads[0].start()
    deadline = time.monotonic() + 5
    while not calls.urls and time.monotonic() < deadline:
        time.sleep(0.005)
    # several bulk waiters queue first, so an interactive that only wins by luck is rare
    bulks = [f"bulk{i}" for i in range(8)]
    for name in bulks:
        threads.append(threading.Thread(target=p.request, args=(name, "bulk"), daemon=True))
        threads[-1].start()
        time.sleep(0.02)
    threads.append(threading.Thread(target=p.request, args=("interactive", "interactive"), daemon=True))
    threads[-1].start()
    while p._interactive_waiting < 1 and time.monotonic() < deadline:
        time.sleep(0.005)
    release.set()
    for t in threads:
        t.join(5)
    assert calls.urls[:2] == ["first", "interactive"]
    assert sorted(calls.urls[2:]) == bulks


def test_concurrent_requests_are_serialized(pacer_env):
    lock = threading.Lock()
    state = {"inside": 0, "max": 0}

    def tracked(url):
        with lock:
            state["inside"] += 1
            state["max"] = max(state["max"], state["inside"])
        time.sleep(0.03)
        with lock:
            state["inside"] -= 1
        return FeedResult("ok", [])

    p, calls = pacer_env(fetch=tracked)
    threads = [threading.Thread(target=p.request, args=(f"u{i}", "interactive"), daemon=True) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(5)
    assert len(calls.urls) == 4 and state["max"] == 1


def test_pacer_lets_assertion_error_through(pacer_env):
    def boom(url):
        raise AssertionError("net")

    p, _ = pacer_env(fetch=boom)
    with pytest.raises(AssertionError):
        p.request("a", "bulk")
    # the failed send must not leave the pacer stuck busy
    assert p._busy is False


def test_google_news_raises_runtime_error_on_failed(monkeypatch):
    stub = Pacer(
        fetch=lambda url: FeedResult("failed", [], "HTTP 500"),
        clock=FakeClock(START),
        sleep=lambda s: None,
    )
    monkeypatch.setattr(pacer_module, "_pacer", stub)
    with pytest.raises(RuntimeError, match="HTTP 500") as e:
        google_news("kospi", "en", "interactive")
    assert not isinstance(e.value, NewsBlocked)


def test_google_news_returns_items_and_builds_dated_url(monkeypatch):
    from datetime import date

    from apps.api.services.news_feed.rss import FeedItem

    item = FeedItem("t", "u", "s", "2026-10-24", None, "g")
    seen = []

    def fetch(url):
        seen.append(url)
        return FeedResult("ok", [item])

    stub = Pacer(fetch=fetch, clock=FakeClock(START), sleep=lambda s: None)
    monkeypatch.setattr(pacer_module, "_pacer", stub)
    assert google_news("kospi", "en", "bulk", after=date(2026, 10, 1)) == [item]
    assert "after%3A2026-10-01" in seen[0]
    assert get_state("news_requests:2026-10-25") == "1"


def _stamp_last_request(at: datetime) -> None:
    set_state(pacer_module.LAST_REQUEST_KEY, at.isoformat())


def test_interactive_overtakes_a_bulk_request_waiting_its_gap(monkeypatch):
    """Catches a bulk request that holds the send slot while it waits its 20-60 s gap: an
    interactive request arriving mid-gap would then go after it and wait the rest of the bulk
    gap. Real time with shrunk gaps, because the overtaking happens while the bulk waits."""
    monkeypatch.setattr(pacer_module, "BULK_GAP", (2.0, 2.0))
    monkeypatch.setattr(pacer_module, "INTERACTIVE_GAP", (0.5, 0.5))
    sent: list[tuple[str, datetime]] = []

    def fetch(url):
        sent.append((url, datetime.now(UTC)))
        return FeedResult("ok", [])

    p = Pacer(fetch=fetch, clock=lambda: datetime.now(UTC))
    last_end = datetime.now(UTC)
    _stamp_last_request(last_end)            # a fetch has just ended
    bulk = threading.Thread(target=p.request, args=("bulk", "bulk"), daemon=True)
    bulk.start()
    time.sleep(0.2)                          # the bulk request is now waiting its gap
    click = threading.Thread(target=p.request, args=("click", "interactive"), daemon=True)
    click.start()
    click.join(5)
    bulk.join(5)
    assert [url for url, _ in sent] == ["click", "bulk"]
    click_gap = (sent[0][1] - last_end).total_seconds()
    assert 0.45 <= click_gap < 1.2           # its own gap from the last fetch end, not the bulk one
    assert (sent[1][1] - sent[0][1]).total_seconds() >= 1.95   # the bulk gap restarts from that fetch


def test_stop_flag_wakes_a_request_waiting_its_gap(monkeypatch):
    """Catches a gap wait that ignores the stop flag (shutdown would wait out the gap), or a stop
    reported as a block or a failure instead of NewsStopped."""
    news_stopped = getattr(pacer_module, "NewsStopped")
    monkeypatch.setattr(pacer_module, "BULK_GAP", (30.0, 30.0))
    p = Pacer(fetch=lambda url: FeedResult("ok", []), clock=lambda: datetime.now(UTC))
    _stamp_last_request(datetime.now(UTC))
    errors: list[BaseException] = []

    def run():
        try:
            p.request("u", "bulk")
        except BaseException as error:  # noqa: BLE001 - recorded for the assertion
            errors.append(error)

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    time.sleep(0.2)
    began = time.monotonic()
    pacer_module.STOP.set()
    worker.join(5)
    assert not worker.is_alive() and time.monotonic() - began < 2
    assert len(errors) == 1 and type(errors[0]) is news_stopped
    assert not isinstance(errors[0], (NewsBlocked, RuntimeError))
    assert get_state("news_requests:" + datetime.now(UTC).strftime("%Y-%m-%d")) is None
