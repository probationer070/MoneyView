from datetime import UTC, datetime

from apps.api.services.acquisition.boundaries import Daily


def test_most_recent_instant_is_today_when_now_is_past_the_hour():
    boundary = Daily(at_hour=0)
    now = datetime(2026, 7, 27, 9, 30, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 27, 0, 0, tzinfo=UTC)


def test_most_recent_instant_is_yesterday_when_now_is_before_the_hour():
    boundary = Daily(at_hour=8)
    now = datetime(2026, 7, 27, 3, 0, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 26, 8, 0, tzinfo=UTC)


def test_boundary_instant_itself_counts_as_passed():
    """At exactly the boundary the new window has begun; anything acquired before it
    is stale. An off-by-one here means a whole day of staleness served as fresh."""
    boundary = Daily(at_hour=0)
    now = datetime(2026, 7, 27, 0, 0, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 27, 0, 0, tzinfo=UTC)


def test_business_days_boundary_skips_back_over_the_weekend():
    """2026-07-27 is a Monday; 2026-07-26 Sunday, 2026-07-25 Saturday."""
    boundary = Daily(at_hour=12, business_days=True)
    now = datetime(2026, 7, 27, 6, 0, tzinfo=UTC)  # Monday, before the hour
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 24, 12, 0, tzinfo=UTC)


def test_business_days_boundary_returns_today_when_today_is_a_weekday_past_the_hour():
    boundary = Daily(at_hour=12, business_days=True)
    now = datetime(2026, 7, 27, 18, 0, tzinfo=UTC)  # Monday, after the hour
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 27, 12, 0, tzinfo=UTC)


def test_naive_datetime_is_rejected():
    """A naive datetime is the bug this design exists to remove: `date.today()` flips at
    local midnight and differs between a KST laptop and a UTC container."""
    boundary = Daily(at_hour=0)
    try:
        boundary.most_recent_instant(datetime(2026, 7, 27, 9, 30))
    except ValueError as error:
        assert "timezone-aware" in str(error)
    else:
        raise AssertionError("a naive datetime must be rejected")


def test_out_of_range_hour_or_minute_is_rejected_at_construction():
    """A boundary is declared once in the registry and then silently governs every
    freshness decision for that class. `Daily(at_hour=24)` would raise deep inside
    `replace()` at the first acquisition, far from the typo. Fail at declaration."""
    for kwargs in ({"at_hour": 24}, {"at_hour": -1}, {"at_hour": 0, "at_minute": 60}):
        try:
            Daily(**kwargs)
        except ValueError as error:
            assert "0" in str(error)
        else:
            raise AssertionError(f"{kwargs} must be rejected at construction")


def test_valid_boundary_extremes_are_accepted():
    assert Daily(at_hour=23, at_minute=59).at_hour == 23
    assert Daily(at_hour=0, at_minute=0).at_minute == 0
