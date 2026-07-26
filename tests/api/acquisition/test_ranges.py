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
