"""Daily stock sweep and alert queue. Each docstring names the mutation its test catches."""
from __future__ import annotations

from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest

from apps.api.models.schemas import NewsArticle
from apps.api.services.acquisition.state import read_state
from apps.api.services.db import get_db
from apps.api.services.news_feed import daily
from apps.api.services.news_feed.daily import (
    daily_due,
    drain_alert_queue,
    queue_alert_tickers,
    run_daily_sweep,
    session_day,
)
from apps.api.services.news_feed.pacer import NewsBlocked
from apps.api.services.news_feed.rss import FeedItem
from apps.api.services.risk import store
from apps.api.services.risk.store import get_state

NOW = datetime(2026, 10, 26, 22, 0, tzinfo=UTC)
DAY = date(2026, 10, 26)


def dt(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


class FakeGoogle:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, str]] = []   # (ticker, query, lang, kind)
        self._raise: dict[int, BaseException] = {}
        self._block_at: int | None = None

    def reset(self) -> None:
        self.calls.clear()
        self._raise.clear()
        self._block_at = None

    def raise_on_call(self, number: int, error) -> None:
        self._raise[number] = error

    def block_on_call(self, number: int) -> None:
        self._block_at = number

    def tickers(self) -> list[str]:
        return [c[0] for c in self.calls]

    def _hit(self, ticker, query, lang, kind) -> None:
        self.calls.append((ticker, query, lang, kind))
        number = len(self.calls)
        if number == self._block_at:
            raise NewsBlocked("blocked", datetime(2026, 10, 27, tzinfo=UTC))
        if number in self._raise:
            raise self._raise[number]

    def fetch_news(self, ticker, company_name="", *, crawler=None, limit=None, kind="interactive"):
        self._hit(ticker, "", "en", kind)
        return [NewsArticle(ticker=ticker, headline=f"{ticker} headline", url=f"https://x/{ticker}",
                            source="s", published_date="2026-10-26")]

    def google_news(self, query, lang, kind, **kw):
        ticker = next((t for t, n in daily._queries().ko_names.items() if query.startswith(n)), "?")
        self._hit(ticker, query, lang, kind)
        return [FeedItem(f"{ticker} 기사", f"https://k/{ticker}", "출처", "2026-10-26",
                         "2026-10-26T01:00:00+00:00", f"g-{ticker}")]


@pytest.fixture
def fake_google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(daily, "fetch_news", fake.fetch_news)
    monkeypatch.setattr(daily, "google_news", fake.google_news)
    return fake


@pytest.fixture
def watchlist3():
    return lambda: [("CCC", "Ccc Inc"), ("AAA", "Aaa Inc"), ("BBB", "Bbb Inc")]


def test_session_day_switches_at_21_utc():
    """Catches a day boundary at midnight (or any hour other than 21:00 UTC)."""
    assert session_day(dt("2026-10-26T20:59:00Z")) == date(2026, 10, 25)
    assert session_day(dt("2026-10-26T21:00:00Z")) == date(2026, 10, 26)


def test_daily_sweep_covers_every_ticker_once_and_marks_the_day(fake_google, watchlist3):
    """Catches a skipped ticker, a repeated ticker, an unsorted order, or a day never marked done."""
    report = run_daily_sweep(NOW, watchlist=watchlist3)
    assert fake_google.tickers() == ["AAA", "BBB", "CCC"]
    assert (report.session_day, report.done, report.remaining, report.stopped) == (DAY, 3, 0, "complete")
    assert get_state(f"news_daily_done:{DAY}") == "1"

    fake_google.reset()
    run_daily_sweep(NOW, watchlist=watchlist3)
    assert fake_google.calls == []


def test_daily_sweep_resumes_after_interruption(fake_google, watchlist3):
    """Catches per-ticker marks not written as the sweep goes (a crash restarts from AAA)."""
    fake_google.raise_on_call(3, KeyboardInterrupt)        # crash while fetching CCC
    with pytest.raises(KeyboardInterrupt):
        run_daily_sweep(NOW, watchlist=watchlist3)
    fake_google.reset()
    run_daily_sweep(NOW, watchlist=watchlist3)
    assert fake_google.tickers() == ["CCC"]


def test_daily_sweep_stops_on_block_and_leaves_rest(fake_google, watchlist3):
    """Catches a block that does not stop the sweep, marks the blocked ticker done, or sets the day done."""
    fake_google.block_on_call(2)
    report = run_daily_sweep(NOW, watchlist=watchlist3)
    assert fake_google.tickers() == ["AAA", "BBB"]
    assert (report.done, report.remaining, report.stopped) == (1, 2, "blocked")
    assert get_state(f"news_daily:{DAY}:AAA") == "1"
    assert get_state(f"news_daily:{DAY}:BBB") is None
    assert daily_due(NOW)

    fake_google.reset()
    run_daily_sweep(NOW, watchlist=watchlist3)
    assert fake_google.tickers() == ["BBB", "CCC"]


def test_daily_sweep_reports_daily_limit(watchlist3, monkeypatch):
    """Catches the stop reason being fixed to 'blocked' instead of the NewsBlocked reason."""
    def limited(*a, **k):
        raise NewsBlocked("daily_limit", datetime(2026, 10, 27, tzinfo=UTC))

    monkeypatch.setattr(daily, "fetch_news", limited)
    assert run_daily_sweep(NOW, watchlist=watchlist3).stopped == "daily_limit"


def test_non_block_failure_marks_ticker_done(fake_google, watchlist3):
    """Catches a failing ticker holding the sweep (not marked done) or aborting it."""
    fake_google.raise_on_call(1, RuntimeError("boom"))    # AAA: the news fetch fails inside the runner
    fake_google.raise_on_call(5, RuntimeError("boom"))    # NVDA: the Korean feed raises in the sweep itself
    report = run_daily_sweep(NOW, watchlist=lambda: [("AAA", "a"), ("BBB", "b"), ("CCC", "c"), ("NVDA", "n"), ("ZZZ", "z")])
    assert fake_google.tickers() == ["AAA", "BBB", "CCC", "NVDA", "NVDA", "ZZZ"]
    assert (report.done, report.remaining, report.stopped) == (5, 0, "complete")


def test_daily_sweep_records_acquisition_state(fake_google, watchlist3):
    """Catches the fetch bypassing acquire_point_in_time (no freshness state, no save)."""
    run_daily_sweep(NOW, watchlist=watchlist3)
    assert read_state("news", "AAA").last_success_at is not None
    with get_db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM news WHERE ticker = 'AAA'").fetchone()[0] == 1


def test_korean_feed_only_for_ko_names(fake_google):
    """Catches a Korean request for tickers without a Korean name, or a missing/mislabelled one."""
    run_daily_sweep(NOW, watchlist=lambda: [("AAA", "Aaa"), ("NVDA", "NVIDIA")])
    ko = [c for c in fake_google.calls if c[2] == "ko"]
    assert ko == [("NVDA", "엔비디아 주가", "ko", "bulk")]
    with get_db() as conn:
        row = conn.execute("SELECT lang, topic, ticker FROM news WHERE headline = ?", ("NVDA 기사",)).fetchone()
    assert (row["lang"], row["topic"], row["ticker"]) == ("ko", "", "NVDA")


def test_daily_sweep_uses_bulk_kind(fake_google):
    """Catches daily requests sent with the interactive gap."""
    run_daily_sweep(NOW, watchlist=lambda: [("AAA", "Aaa"), ("NVDA", "NVIDIA")])
    assert {c[3] for c in fake_google.calls} == {"bulk"}


def test_daily_due_once_per_session_day(fake_google, watchlist3):
    """Catches a done flag that is not keyed by session day (due never, or always)."""
    assert daily_due(NOW)
    run_daily_sweep(NOW, watchlist=watchlist3)
    assert not daily_due(NOW)
    assert not daily_due(dt("2026-10-27T20:00:00Z"))
    assert daily_due(dt("2026-10-27T21:00:00Z"))


def test_done_flag_not_set_before_the_loop(fake_google, watchlist3):
    """Catches the day flagged done before the tickers are swept (an interruption leaves it done)."""
    fake_google.raise_on_call(2, KeyboardInterrupt)
    with pytest.raises(KeyboardInterrupt):
        run_daily_sweep(NOW, watchlist=watchlist3)
    assert daily_due(NOW)


def test_old_marks_are_deleted(fake_google, watchlist3):
    """Catches per-ticker marks accumulating forever."""
    store.set_state("news_daily:2026-10-10:AAA", "1")
    store.set_state("news_daily:2026-10-24:AAA", "1")
    run_daily_sweep(NOW, watchlist=watchlist3)
    assert get_state("news_daily:2026-10-10:AAA") is None
    assert get_state("news_daily:2026-10-24:AAA") == "1"


def test_queue_merges_uppercases_and_dedupes():
    """Catches an overwrite instead of a merge, lower-case tickers, or duplicates."""
    queue_alert_tickers(["aaa", "bbb"])
    queue_alert_tickers(["BBB", "ccc"])
    assert daily._read_queue() == ["AAA", "BBB", "CCC"]


def test_alert_queue_skips_tickers_already_swept_today(monkeypatch):
    """Catches queued tickers fetched again after the daily sweep already did them."""
    sent: list = []
    monkeypatch.setattr(daily, "sweep_news", lambda now, **kw: sent.append(kw) or SimpleNamespace(failed=[]))
    monkeypatch.setattr(daily, "get_pacer",
                        lambda: SimpleNamespace(status=lambda: SimpleNamespace(blocked_until=None)))
    store.set_state(f"news_daily:{DAY}:AAA", "1")
    queue_alert_tickers(["AAA", "BBB"])
    drain_alert_queue(NOW)
    assert sent == [{"tickers": ["BBB"], "include_topics": False}]
    assert get_state("news_alert_queue") is None


def test_alert_queue_keeps_unattempted_tickers_on_block(monkeypatch):
    """Catches the whole queue being cleared when the sweep stops at a block."""
    monkeypatch.setattr(daily, "sweep_news", lambda now, **kw: SimpleNamespace(failed=["BBB:en", "CCC:en"]))
    monkeypatch.setattr(daily, "get_pacer",
                        lambda: SimpleNamespace(status=lambda: SimpleNamespace(blocked_until="2026-10-27T00:00:00")))
    queue_alert_tickers(["AAA", "BBB", "CCC"])
    drain_alert_queue(NOW)
    assert daily._read_queue() == ["BBB", "CCC"]


def test_alert_queue_drops_failed_tickers_when_not_blocked(monkeypatch):
    """Catches a plainly failing ticker staying queued forever."""
    monkeypatch.setattr(daily, "sweep_news", lambda now, **kw: SimpleNamespace(failed=["BBB:en"]))
    monkeypatch.setattr(daily, "get_pacer",
                        lambda: SimpleNamespace(status=lambda: SimpleNamespace(blocked_until=None)))
    queue_alert_tickers(["AAA", "BBB"])
    drain_alert_queue(NOW)
    assert get_state("news_alert_queue") is None


def test_ticker_queued_while_the_queue_drains_survives(monkeypatch):
    """Catches the drain writing back its stale copy of the queue (or deleting the key), which
    loses a ticker the risk cycle queued while the sweep ran."""
    def sweep(now, **kw):
        queue_alert_tickers(["NEW"])          # the risk cycle queues during the minutes-long sweep
        return SimpleNamespace(failed=[])

    monkeypatch.setattr(daily, "sweep_news", sweep)
    monkeypatch.setattr(daily, "get_pacer",
                        lambda: SimpleNamespace(status=lambda: SimpleNamespace(blocked_until=None)))
    queue_alert_tickers(["AAA"])
    drain_alert_queue(NOW)
    assert daily._read_queue() == ["NEW"]


def test_concurrent_enqueues_are_not_lost(monkeypatch):
    """Catches an unguarded read-modify-write of the queue: two writers both read the old queue
    and the second write drops the first one's ticker."""
    import threading
    import time

    real_read = daily._read_queue

    def slow_read():
        value = real_read()
        time.sleep(0.1)                       # widen the read-to-write window
        return value

    monkeypatch.setattr(daily, "_read_queue", slow_read)
    start = threading.Barrier(2)

    def enqueue(ticker):
        start.wait(5)
        queue_alert_tickers([ticker])

    threads = [threading.Thread(target=enqueue, args=(t,), daemon=True) for t in ("AAA", "BBB")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(5)
    assert sorted(real_read()) == ["AAA", "BBB"]


def test_blocked_ticker_leaves_acquisition_state_untouched(fake_google, watchlist3):
    """Catches a refused fetch recorded as a FAILED check: the tile would read "no recent news,
    last checked HH:MM" although nothing was asked."""
    fake_google.block_on_call(2)
    run_daily_sweep(NOW, watchlist=watchlist3)
    with get_db() as conn:
        row = conn.execute("SELECT * FROM acquisition_state WHERE data_class = 'news' AND subject = 'BBB'").fetchone()
    assert row is None
    assert read_state("news", "AAA").last_success_at is not None


def test_korean_block_keeps_the_english_check(fake_google):
    """Catches a Korean-feed block rewinding the English fetch's check time (the ticker would look
    never asked although its English feed was just fetched)."""
    fake_google.block_on_call(2)               # NVDA: English ok, then the Korean feed is blocked
    report = run_daily_sweep(NOW, watchlist=lambda: [("NVDA", "NVIDIA")])
    assert report.stopped == "blocked" and get_state(f"news_daily:{DAY}:NVDA") is None
    state = read_state("news", "NVDA")
    assert state.last_checked_at is not None and state.last_checked_at == state.last_success_at


def test_each_ticker_is_stamped_with_its_own_fetch_time(fake_google, watchlist3):
    """Catches every ticker stamped with the pass start time: a ticker swept three hours into the
    pass would look three hours old and Refresh would not skip it for the hour after (N-D13)."""
    times = iter([datetime(2026, 10, 26, 22, m, tzinfo=UTC) for m in (10, 20, 30)])
    run_daily_sweep(NOW, watchlist=watchlist3, clock=lambda: next(times))
    assert [read_state("news", t).last_checked_at.minute for t in ("AAA", "BBB", "CCC")] == [10, 20, 30]
    assert get_state(f"news_daily_done:{DAY}") == "1"      # the session day still comes from `now`


def test_stop_ends_the_sweep_without_marking_the_ticker(watchlist3, monkeypatch):
    """Catches a shutdown stop counted as a plain failure (the ticker would be marked done and its
    news never fetched today) or as a block, or recorded as a check."""
    from apps.api.services.news_feed import pacer

    news_stopped = getattr(pacer, "NewsStopped")
    calls: list[str] = []

    def fetch(ticker, company_name="", **kw):
        calls.append(ticker)
        if ticker == "BBB":
            raise news_stopped("stopping")
        return []

    monkeypatch.setattr(daily, "fetch_news", fetch)
    with pytest.raises(news_stopped):
        run_daily_sweep(NOW, watchlist=watchlist3)
    assert calls == ["AAA", "BBB"]
    assert get_state(f"news_daily:{DAY}:AAA") == "1"
    assert get_state(f"news_daily:{DAY}:BBB") is None
    assert read_state("news", "BBB").last_checked_at is None
    assert daily_due(NOW)
