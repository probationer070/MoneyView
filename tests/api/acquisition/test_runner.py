import threading
from datetime import UTC, date, datetime, timezone

import pandas as pd
import pytest

from apps.api.models.schemas import StockOHLCV
from apps.api.services import db as db_service
from apps.api.services.acquisition.ranges import FetchRange
from apps.api.services.acquisition.sources import bars
from apps.api.services.acquisition.sources.quote_facts import QuoteFacts
from apps.api.services.acquisition.runner import acquire, acquire_point_in_time, schedule_acquisition
from apps.api.services.acquisition.state import AcquisitionStatus, read_state, record_success

NOW = datetime(2026, 7, 27, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Point db_service._DB_PATH at a temp file so these tests never touch the
    real project database, and so a fresh clone/CI run has acquisition_state
    without needing init_db() run by hand."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()


def _row(day: str) -> StockOHLCV:
    return StockOHLCV(date=day, open=1.0, high=1.0, low=1.0, close=1.0, volume=1)


def test_first_acquisition_backfills_and_records_coverage():
    calls: list[FetchRange] = []
    saved: list[tuple[str, list[StockOHLCV]]] = []

    def fetcher(ticker, fetch_range, **_):
        calls.append(fetch_range)
        return [_row("2026-07-24")]

    result = acquire(
        "equity_bars", "TEST_RUNNER_NEW", now=NOW,
        fetcher=fetcher, action_probe=lambda ticker, **_: None,
        saver=lambda ticker, rows: saved.append((ticker, rows)),
    )

    assert result.skipped is False
    assert result.reason == "backfill"
    assert calls[0].start == date(2016, 7, 27)
    assert saved == [("TEST_RUNNER_NEW", [_row("2026-07-24")])]
    # The last row is 2026-07-24 even though `today` is 2026-07-27: coverage records
    # what exists, so the next delta re-asks for the 25th onward rather than skipping it.
    assert read_state("equity_bars", "TEST_RUNNER_NEW").covered_to == date(2026, 7, 24)


def test_coverage_records_the_last_real_bar_not_the_requested_end():
    """A lagging provider returns bars only through Wednesday while today is Friday.
    Recording covered_to=today would claim coverage that does not exist, and the next
    delta would start Saturday -- Thursday and Friday lost permanently, with nothing
    ever asking for them again."""
    result = acquire(
        "equity_bars", "TEST_RUNNER_LAG", now=NOW,
        fetcher=lambda ticker, fetch_range, **_: [_row("2026-07-22"), _row("2026-07-23")],
        action_probe=lambda ticker, **_: None, saver=lambda t, r: None,
    )
    assert result.fetched_rows == 2
    assert read_state("equity_bars", "TEST_RUNNER_LAG").covered_to == date(2026, 7, 23)


def test_second_call_within_the_same_boundary_window_is_skipped():
    """Reads never fetch and the runner does not re-ask inside one window: this is what
    turns 966 round trips per request into one per boundary."""
    def fetcher(ticker, fetch_range, **_):
        return [_row("2026-07-24")]

    for _ in range(2):
        result = acquire(
            "equity_bars", "TEST_RUNNER_TWICE", now=NOW,
            fetcher=fetcher, action_probe=lambda ticker, **_: None, saver=lambda t, r: None,
        )
    assert result.skipped is True
    assert result.fetched_rows == 0


def test_a_new_corporate_action_forces_a_full_refetch_not_an_append():
    """A split rewrites adjusted history retroactively, so appending would mix pre- and
    post-split prices into one series and silently corrupt every derived metric."""
    record_success(
        "equity_bars", "TEST_RUNNER_SPLIT", now=datetime(2026, 7, 26, 9, 0, tzinfo=UTC),
        covered_from=date(2016, 1, 1), covered_to=date(2026, 7, 24),
    )
    calls: list[FetchRange] = []

    def fetcher(ticker, fetch_range, **_):
        calls.append(fetch_range)
        return [_row("2026-07-24")]

    result = acquire(
        "equity_bars", "TEST_RUNNER_SPLIT", now=NOW,
        fetcher=fetcher, action_probe=lambda ticker, **_: date(2026, 7, 25),
        saver=lambda t, r: None,
    )
    assert result.reason == "corporate_action"
    # 2016-01-01, not today-10y: the refetch has to reach everything already stored.
    # Starting at today-10y would leave the head of the series on the OLD adjustment
    # factor while the rest is rewritten with the new one -- the mixed-adjustment
    # corruption this path exists to prevent.
    assert calls[0].start == date(2016, 1, 1)


def test_the_second_acquisition_after_a_boundary_fetches_only_the_delta():
    """The reason this subsystem exists: the steady-state update must transfer the two
    days since the last bar, not re-download ten years. Nothing else exercises the delta
    branch through `acquire` -- test_ranges covers plan_range in isolation, so a runner
    that ignored the plan and always backfilled would keep the suite green."""
    calls: list[FetchRange] = []

    def fetcher(ticker, fetch_range, **_):
        calls.append(fetch_range)
        return [_row("2026-07-24")] if fetch_range.reason == "backfill" else [_row("2026-07-27")]

    common = dict(action_probe=lambda ticker, **_: None, saver=lambda t, r: None)
    first = acquire("equity_bars", "TEST_RUNNER_DELTA", now=NOW, fetcher=fetcher, **common)
    # 00:00 UTC the next day is the boundary, so this crosses exactly one.
    later = datetime(2026, 7, 28, 9, 0, tzinfo=UTC)
    second = acquire("equity_bars", "TEST_RUNNER_DELTA", now=later, fetcher=fetcher, **common)

    assert first.reason == "backfill"
    assert second.reason == "delta"
    # covered_to + 1 day, not `today - 10y`: resumes at the first day not already stored.
    assert calls[1].start == date(2026, 7, 25)
    assert calls[1].end_exclusive == date(2026, 7, 29)  # yfinance `end` is exclusive
    state = read_state("equity_bars", "TEST_RUNNER_DELTA")
    assert state.covered_from == date(2016, 7, 27)  # the backfilled head survives the delta
    assert state.covered_to == date(2026, 7, 27)


def test_the_default_fetcher_probe_and_saver_wire_together_end_to_end(monkeypatch):
    """Every other runner test injects all three seams, so the production defaults --
    fetch_bars, latest_action_date, and the saver that writes the `stocks` table reads
    serve from -- are never executed. Only the ticker factory is faked, so no network
    call is made."""
    frame = pd.DataFrame(
        {
            "Open": [1.0], "High": [1.5], "Low": [0.5], "Close": [1.2], "Volume": [100],
            "Dividends": [0.24], "Stock Splits": [0.0],
        },
        index=pd.DatetimeIndex([pd.Timestamp("2026-07-24")], name="Date"),
    )

    class _FakeTicker:
        history_calls: list[dict] = []

        def history(self, **kwargs):
            _FakeTicker.history_calls.append(kwargs)
            return frame

        @property
        def actions(self):
            return pd.DataFrame()

    monkeypatch.setattr(bars, "_default_ticker_factory", lambda symbol: _FakeTicker())
    result = acquire("equity_bars", "TEST_RUNNER_DEFAULTS", now=NOW)

    assert result.fetched_rows == 1
    assert _FakeTicker.history_calls == [
        {"start": "2016-07-27", "end": "2026-07-28", "auto_adjust": True}
    ]
    with db_service.get_db() as conn:
        row = conn.execute(
            "SELECT close, dividends FROM stocks WHERE ticker = ? AND date = ?",
            ("TEST_RUNNER_DEFAULTS", "2026-07-24"),
        ).fetchone()
    # The runner must write to the table `get_stock_ohlcv` reads, or it acquires into a void.
    assert row is not None, "the default saver did not write to `stocks`"
    assert row["close"] == 1.2
    assert row["dividends"] == 0.24
    assert read_state("equity_bars", "TEST_RUNNER_DEFAULTS").covered_to == date(2026, 7, 24)


def test_an_empty_result_records_the_ask_so_it_is_not_retried_all_day():
    """A delisted ticker returns nothing forever. It must be asked once per boundary,
    not once per request."""
    result = acquire(
        "equity_bars", "TEST_RUNNER_EMPTY", now=NOW,
        fetcher=lambda ticker, fetch_range, **_: [],
        action_probe=lambda ticker, **_: None, saver=lambda t, r: None,
    )
    assert result.fetched_rows == 0
    state = read_state("equity_bars", "TEST_RUNNER_EMPTY")
    assert state.status == "empty"
    assert state.last_checked_at == NOW
    assert state.last_success_at is None


def test_a_provider_failure_records_the_ask_and_preserves_prior_success():
    record_success(
        "equity_bars", "TEST_RUNNER_FAIL", now=datetime(2026, 7, 26, 9, 0, tzinfo=UTC),
        covered_from=date(2016, 1, 1), covered_to=date(2026, 7, 24),
    )

    def failing(ticker, fetch_range, **_):
        raise RuntimeError("429 Too Many Requests")

    result = acquire(
        "equity_bars", "TEST_RUNNER_FAIL", now=NOW,
        fetcher=failing, action_probe=lambda ticker, **_: None, saver=lambda t, r: None,
    )
    assert result.fetched_rows == 0
    state = read_state("equity_bars", "TEST_RUNNER_FAIL")
    assert state.status == "failed"
    assert state.covered_to == date(2026, 7, 24)  # prior data still served


def test_a_failure_inside_the_scheduled_thread_stays_contained(monkeypatch):
    """The in-thread guard, not the thread-start guard: a raise inside the background
    run is the common failure, and an unhandled one would kill the thread with a
    traceback on stderr and no record that acquisition was even attempted."""
    subject = "TEST_THREAD_FAIL"
    reached = threading.Event()

    def _explode(data_class, subject_arg, **_):
        reached.set()
        raise RuntimeError("acquisition blew up in the thread")

    # An exception leaving _run reaches threading.excepthook. Recording it is what makes
    # this test fail on an unguarded _run: an escaped thread exception is otherwise only
    # a warning, which a green suite would happily print and ignore.
    escaped: list[object] = []
    monkeypatch.setattr(threading, "excepthook", lambda args: escaped.append(args))
    monkeypatch.setattr("apps.api.services.acquisition.runner.acquire", _explode)

    schedule_acquisition("equity_bars", subject)  # must not raise into the caller

    spawned = [t for t in threading.enumerate() if t.name == f"acquire-{subject}"]
    assert reached.wait(timeout=5), "the patched acquire was never reached"
    for thread in spawned:
        thread.join(timeout=5)
        assert not thread.is_alive()
    assert escaped == [], "the failure escaped _run instead of being contained"


def test_point_in_time_skips_entirely_when_fresh():
    """Idempotence: inside the boundary, no network work and no state change."""
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    record_success("statements", "AAPL", now=now, covered_from=date(2024, 1, 1), covered_to=date(2025, 9, 30))
    calls = []

    result = acquire_point_in_time(
        "statements", "AAPL", now=now,
        fetcher=lambda subject: calls.append(subject) or [],
        saver=lambda subject, rows: calls.append("saved"),
        coverage=lambda rows: (date(2024, 1, 1), date(2025, 9, 30)),
    )

    assert result.skipped is True
    assert result.reason == "fresh"
    assert calls == []


def test_point_in_time_saves_and_records_coverage():
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    saved = {}

    result = acquire_point_in_time(
        "statements", "AAPL", now=now,
        fetcher=lambda subject: ["row"],
        saver=lambda subject, rows: saved.update({subject: rows}),
        coverage=lambda rows: (date(2024, 9, 30), date(2025, 9, 30)),
    )

    assert result.skipped is False
    assert saved == {"AAPL": ["row"]}
    state = read_state("statements", "AAPL")
    assert state.status == AcquisitionStatus.OK
    assert state.covered_to == date(2025, 9, 30)


def test_point_in_time_records_failure_without_touching_stored_data():
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)

    def explode(subject):
        raise RuntimeError("provider down")

    result = acquire_point_in_time(
        "statements", "AAPL", now=now,
        fetcher=explode,
        saver=lambda subject, rows: pytest.fail("saver must not run on a failed fetch"),
        coverage=lambda rows: (date(2024, 1, 1), date(2025, 1, 1)),
    )

    assert result.skipped is False
    state = read_state("statements", "AAPL")
    assert state.status == AcquisitionStatus.FAILED
    assert state.last_success_at is None
    # Advanced deliberately: freshness asks "have I asked", so a delisted ticker is not
    # retried forever. Under Weekly that suppresses retry for up to seven days.
    assert state.last_checked_at == now


def test_an_assertion_error_propagates_instead_of_becoming_a_failed_status():
    """The suite's _forbid_network guard raises AssertionError. If the broad except
    swallowed it into a FAILED row, a test could reach the real network and still go
    green -- the guard's whole value depends on this not happening. No provider raises
    AssertionError, so nothing legitimate is caught by letting it through."""
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)

    def guard_trips(subject):
        raise AssertionError("test made a network call to query1.finance.yahoo.com")

    with pytest.raises(AssertionError, match="network call"):
        acquire_point_in_time(
            "statements", "AAPL", now=now,
            fetcher=guard_trips,
            saver=lambda subject, rows: pytest.fail("saver must not run"),
            coverage=lambda rows: (date(2024, 1, 1), date(2025, 1, 1)),
        )

    assert read_state("statements", "AAPL").status != AcquisitionStatus.FAILED


def test_point_in_time_acquires_again_once_the_boundary_has_passed():
    """The other half of idempotence: fresh means skip, stale means fetch. Without this,
    a boundary that never expires would pass the skip test and silently freeze the data."""
    acquired_at = datetime(2026, 7, 27, 12, 0, tzinfo=timezone.utc)      # Monday
    record_success("statements", "AAPL", now=acquired_at,
                   covered_from=date(2024, 1, 1), covered_to=date(2025, 9, 30))
    calls = []

    # The following Monday: a new Weekly boundary has passed.
    result = acquire_point_in_time(
        "statements", "AAPL", now=datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc),
        fetcher=lambda subject: calls.append(subject) or ["row"],
        saver=lambda subject, rows: None,
        coverage=lambda rows: (date(2024, 1, 1), date(2025, 9, 30)),
    )

    assert result.skipped is False
    assert calls == ["AAPL"]


def test_point_in_time_counts_a_single_dataclass_payload():
    """Quote facts arrive as one frozen dataclass, not a list. Counting must not assume
    __len__ exists."""
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    facts = QuoteFacts("AAPL", 4_000.0, 100.0, "USD")

    result = acquire_point_in_time(
        "market_cap", "AAPL", now=now,
        fetcher=lambda subject: facts,
        saver=lambda subject, payload: None,
        coverage=lambda payload: (now.date(), now.date()),
    )

    assert result.fetched_rows == 1


def test_point_in_time_records_empty_when_the_provider_returns_nothing():
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)

    result = acquire_point_in_time(
        "statements", "AAPL", now=now,
        fetcher=lambda subject: [],
        saver=lambda subject, rows: pytest.fail("saver must not run on an empty fetch"),
        coverage=lambda rows: (date(2024, 1, 1), date(2025, 1, 1)),
    )

    assert result.skipped is False
    assert read_state("statements", "AAPL").status == AcquisitionStatus.EMPTY
