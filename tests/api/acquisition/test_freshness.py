from datetime import UTC, datetime

from apps.api.services.acquisition.boundaries import Daily
from apps.api.services.acquisition.freshness import needs_acquisition
from apps.api.services.acquisition.state import AcquisitionState, AcquisitionStatus

BOUNDARY = Daily(at_hour=0)
NOW = datetime(2026, 7, 27, 9, 0, tzinfo=UTC)  # boundary today was 00:00


def _state(**overrides) -> AcquisitionState:
    base = dict(data_class="equity_bars", subject="AAPL")
    return AcquisitionState(**{**base, **overrides})


def test_never_acquired_needs_acquisition():
    assert needs_acquisition(_state(), BOUNDARY, NOW) is True


def test_asked_after_the_boundary_does_not_need_acquisition():
    asked = datetime(2026, 7, 27, 1, 0, tzinfo=UTC)
    assert needs_acquisition(_state(last_checked_at=asked, status=AcquisitionStatus.OK), BOUNDARY, NOW) is False


def test_asked_before_the_boundary_needs_acquisition():
    asked = datetime(2026, 7, 26, 23, 0, tzinfo=UTC)
    assert needs_acquisition(_state(last_checked_at=asked, status=AcquisitionStatus.OK), BOUNDARY, NOW) is True


def test_asked_and_found_nothing_still_counts_as_asked():
    """The rule that removes the refetch storm. On a market holiday, or for a delisted
    ticker, the provider returns nothing forever. Asking "do I hold a bar dated >= X"
    can never be satisfied and retries every request, all day. Asking "did I ask" is
    satisfied immediately and waits for the next boundary."""
    asked = datetime(2026, 7, 27, 1, 0, tzinfo=UTC)
    state = _state(last_checked_at=asked, last_success_at=None, status=AcquisitionStatus.EMPTY)
    assert needs_acquisition(state, BOUNDARY, NOW) is False


def test_asked_exactly_at_the_boundary_counts_as_asked():
    asked = datetime(2026, 7, 27, 0, 0, tzinfo=UTC)
    assert needs_acquisition(_state(last_checked_at=asked, status=AcquisitionStatus.OK), BOUNDARY, NOW) is False
