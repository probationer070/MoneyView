from datetime import UTC, date, datetime

import pytest

from apps.api.services import db as db_service
from apps.api.services.acquisition.boundaries import Daily
from apps.api.services.acquisition.freshness import needs_acquisition
from apps.api.services.acquisition.state import (
    AcquisitionStatus,
    read_state,
    record_check,
    record_retired,
    record_success,
)

NOW = datetime(2026, 7, 27, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Point db_service._DB_PATH at a temp file so these tests never touch the
    real project database, and so a fresh clone/CI run has acquisition_state
    without needing init_db() run by hand."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()


def test_status_enum_is_the_single_definition_site():
    """Consolidated deliberately: a second definition site is how "retired" and
    "retire" end up both existing. StrEnum keeps `== "ok"` true and lets SQLite bind
    the member directly, so nothing downstream needs `.value`."""
    assert AcquisitionStatus.OK == "ok"
    assert {member.value for member in AcquisitionStatus} == {
        "never_acquired", "ok", "empty", "failed", "retired",
    }


def test_unknown_subject_reads_as_never_acquired():
    """`never_acquired` and "acquired, found nothing" must be distinguishable: it is
    what lets a read report an explicit state instead of an empty list the UI cannot
    tell apart from "this stock has no data"."""
    state = read_state("equity_bars", "TEST_UNKNOWN_TICKER")
    assert state.status == AcquisitionStatus.NEVER_ACQUIRED
    assert state.last_checked_at is None
    assert state.covered_to is None


def test_record_check_marks_the_ask_without_claiming_success():
    record_check("equity_bars", "TEST_CHECK", now=NOW, status=AcquisitionStatus.EMPTY, detail="no bars")
    state = read_state("equity_bars", "TEST_CHECK")
    assert state.last_checked_at == NOW
    assert state.last_success_at is None
    assert state.status == AcquisitionStatus.EMPTY
    assert state.detail == "no bars"


def test_record_success_sets_coverage_and_both_timestamps():
    record_success(
        "equity_bars", "TEST_OK", now=NOW,
        covered_from=date(2016, 7, 27), covered_to=date(2026, 7, 24),
    )
    state = read_state("equity_bars", "TEST_OK")
    assert state.status == AcquisitionStatus.OK
    assert state.last_checked_at == NOW
    assert state.last_success_at == NOW
    assert state.covered_from == date(2016, 7, 27)
    assert state.covered_to == date(2026, 7, 24)


def test_a_delta_widens_coverage_forward_without_discarding_the_backfilled_head():
    """A delta calls record_success with covered_from = the delta's own start, which is
    ten years later than the backfill's. Plain assignment would move covered_from
    forward to it -- the state row would then claim the series begins in 2026 while ten
    years of rows sit in `stocks`, and the next corporate-action refetch (which starts
    at covered_from) would rewrite only the tail, leaving the head on the old adjustment
    factor. MIN() is what keeps the head."""
    record_success(
        "equity_bars", "TEST_WIDEN", now=NOW,
        covered_from=date(2016, 7, 27), covered_to=date(2026, 7, 24),
    )
    later = datetime(2026, 7, 28, 9, 0, tzinfo=UTC)
    record_success(
        "equity_bars", "TEST_WIDEN", now=later,
        covered_from=date(2026, 7, 25), covered_to=date(2026, 7, 27),
    )
    state = read_state("equity_bars", "TEST_WIDEN")
    assert state.covered_from == date(2016, 7, 27)
    assert state.covered_to == date(2026, 7, 27)


def test_a_short_late_provider_response_never_narrows_recorded_coverage():
    """The other direction: coverage records what exists, and rows are never deleted, so
    a later success returning less than a previous one must not retract covered_to.
    Without MAX(), a provider serving a truncated window once would make the next delta
    re-ask for days already stored and mark the tail as uncovered."""
    record_success(
        "equity_bars", "TEST_NARROW", now=NOW,
        covered_from=date(2016, 1, 1), covered_to=date(2026, 7, 24),
    )
    later = datetime(2026, 7, 28, 9, 0, tzinfo=UTC)
    record_success(
        "equity_bars", "TEST_NARROW", now=later,
        covered_from=date(2020, 1, 1), covered_to=date(2026, 7, 20),
    )
    state = read_state("equity_bars", "TEST_NARROW")
    assert state.covered_from == date(2016, 1, 1)
    assert state.covered_to == date(2026, 7, 24)


def test_a_later_failed_check_preserves_the_earlier_success():
    """A failed refresh must never blank a working panel: reads keep serving the last
    good rows, and staleness stays derivable from last_success_at."""
    record_success(
        "equity_bars", "TEST_KEEP", now=NOW,
        covered_from=date(2016, 1, 1), covered_to=date(2026, 7, 24),
    )
    later = datetime(2026, 7, 28, 9, 0, tzinfo=UTC)
    record_check("equity_bars", "TEST_KEEP", now=later, status="failed", detail="429")
    state = read_state("equity_bars", "TEST_KEEP")
    assert state.last_checked_at == later
    assert state.last_success_at == NOW
    assert state.covered_to == date(2026, 7, 24)
    assert state.status == "failed"


def test_record_retired_does_not_advance_the_freshness_clock():
    """Retiring is not an ask. record_check would stamp last_checked_at, and freshness
    reads nothing else -- so a remove then re-add inside one boundary window would be
    silently skipped and the ticker would hold no bars until the next boundary."""
    record_check("equity_bars", "TEST_RETIRE", now=NOW, status=AcquisitionStatus.EMPTY)
    record_retired("equity_bars", "TEST_RETIRE")
    state = read_state("equity_bars", "TEST_RETIRE")
    assert state.status == AcquisitionStatus.RETIRED
    assert state.last_checked_at == NOW


def test_record_retired_on_a_never_seen_subject_leaves_it_needing_acquisition():
    """The INSERT branch must land last_checked_at NULL. Otherwise the concrete failure:
    a new ticker whose background acquire raised before writing state, deleted, then
    re-added the same day -- acquisition skipped, zero bars, nothing asking again."""
    record_retired("equity_bars", "TEST_RETIRE_NEW")
    state = read_state("equity_bars", "TEST_RETIRE_NEW")
    assert state.status == AcquisitionStatus.RETIRED
    assert state.last_checked_at is None
    assert needs_acquisition(state, Daily(at_hour=0), NOW) is True


def test_record_retired_preserves_prior_success_and_coverage():
    """Rows are retained on retire, so what describes them must be retained too: a
    re-add plans a delta from covered_to instead of refetching ten years."""
    record_success(
        "equity_bars", "TEST_RETIRE_OK", now=NOW,
        covered_from=date(2016, 1, 1), covered_to=date(2026, 7, 24),
    )
    record_retired("equity_bars", "TEST_RETIRE_OK")
    state = read_state("equity_bars", "TEST_RETIRE_OK")
    assert state.status == AcquisitionStatus.RETIRED
    assert state.last_success_at == NOW
    assert state.covered_from == date(2016, 1, 1)
    assert state.covered_to == date(2026, 7, 24)
