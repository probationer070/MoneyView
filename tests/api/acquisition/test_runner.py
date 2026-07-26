from datetime import UTC, date, datetime

import pytest

from apps.api.models.schemas import StockOHLCV
from apps.api.services import db as db_service
from apps.api.services.acquisition.ranges import FetchRange
from apps.api.services.acquisition.runner import acquire
from apps.api.services.acquisition.state import read_state, record_success

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
    assert calls[0].start == date(2016, 7, 27)


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
