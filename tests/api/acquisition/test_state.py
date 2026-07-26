from datetime import UTC, date, datetime

from apps.api.services.acquisition.state import (
    AcquisitionStatus,
    read_state,
    record_check,
    record_success,
)

NOW = datetime(2026, 7, 27, 9, 0, tzinfo=UTC)


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
