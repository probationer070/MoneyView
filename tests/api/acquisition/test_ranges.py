from datetime import date

from apps.api.services.acquisition.ranges import plan_range
from apps.api.services.acquisition.state import AcquisitionState

TODAY = date(2026, 7, 27)


def _state(**overrides) -> AcquisitionState:
    base = dict(data_class="equity_bars", subject="AAPL")
    return AcquisitionState(**{**base, **overrides})


def test_no_coverage_plans_a_ten_year_backfill():
    plan = plan_range(_state(), today=TODAY)
    assert plan is not None
    assert plan.start == date(2016, 7, 27)
    assert plan.reason == "backfill"


def test_existing_coverage_plans_a_delta_from_the_day_after_covered_to():
    plan = plan_range(_state(covered_to=date(2026, 7, 24)), today=TODAY)
    assert plan is not None
    assert plan.start == date(2026, 7, 25)
    assert plan.reason == "delta"


def test_end_is_exclusive_and_one_day_past_today():
    """yfinance treats `end` as exclusive. Passing today would silently drop today's
    bar; every range must add a day."""
    plan = plan_range(_state(covered_to=date(2026, 7, 24)), today=TODAY)
    assert plan is not None
    assert plan.end_exclusive == date(2026, 7, 28)


def test_coverage_already_current_plans_nothing():
    assert plan_range(_state(covered_to=TODAY), today=TODAY) is None


def test_full_refetch_overrides_existing_coverage():
    """A split or dividend rewrites adjusted history retroactively, so the whole series
    must be refetched rather than appended to."""
    plan = plan_range(_state(covered_to=date(2026, 7, 24)), today=TODAY, full_refetch=True)
    assert plan is not None
    assert plan.start == date(2016, 7, 27)
    assert plan.reason == "corporate_action"


def test_full_refetch_starts_at_covered_from_when_the_stored_series_is_older():
    """The stored series starts at `today - 10y` as of the day of the ORIGINAL backfill,
    which drifts later every day. A refetch fixed at today's `today - 10y` therefore
    leaves the head of the series holding the OLD adjustment factor while everything
    after it gets the NEW one -- the exact mixed-adjustment corruption this path exists
    to prevent -- and record_success's MIN() then keeps claiming the older covered_from,
    so the state row asserts a continuous, consistently-adjusted series over rows that
    are not."""
    plan = plan_range(
        _state(covered_from=date(2016, 1, 1), covered_to=date(2026, 7, 24)),
        today=TODAY,
        full_refetch=True,
    )
    assert plan is not None
    assert plan.start == date(2016, 1, 1)
    assert plan.reason == "corporate_action"


def test_full_refetch_never_narrows_the_backfill_depth():
    """The other direction: a subject whose stored coverage is SHORTER than ten years
    must still be refetched to the full backfill depth, not truncated to what happens to
    be stored."""
    plan = plan_range(
        _state(covered_from=date(2020, 1, 1), covered_to=date(2026, 7, 24)),
        today=TODAY,
        full_refetch=True,
    )
    assert plan is not None
    assert plan.start == date(2016, 7, 27)
