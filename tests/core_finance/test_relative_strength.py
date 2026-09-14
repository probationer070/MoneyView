"""The engine's contract is the join rule, not the arithmetic.

A ratio of returns is easy to get right and easy to confuse with a difference of returns --
the two agree closely over short windows and diverge over long ones, which is the kind of
error no string assertion can see. The tests that matter here are the ones pinning which
dates are used and where the base comes from.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest

from packages.core_finance.relative_strength import relative_strength


def test_an_identical_pair_is_exactly_100_at_every_date():
    """The identity that makes the formula checkable by eye. A difference-of-returns
    implementation also returns 0-centred values here, so this alone does not pin the
    formula -- test_a_ratio_not_a_difference_of_returns does that."""
    series = {"2026-01-05": 10.0, "2026-01-06": 11.0, "2026-01-07": 9.0}

    result = relative_strength(series, series, window_start="2026-01-01")

    assert result.refused_reason is None
    assert [point.value for point in result.points] == [100.0, 100.0, 100.0]


def test_outperformance_reads_above_100_and_underperformance_below():
    a = {"2026-01-05": 100.0, "2026-01-06": 110.0}
    b = {"2026-01-05": 100.0, "2026-01-06": 100.0}

    assert relative_strength(a, b, window_start="2026-01-01").points[-1].value == pytest.approx(110.0)
    assert relative_strength(b, a, window_start="2026-01-01").points[-1].value == pytest.approx(90.909090, rel=1e-4)


def test_a_ratio_not_a_difference_of_returns():
    """Pins the formula itself. A_t/A_0 = 2.0 and B_t/B_0 = 1.25 give a ratio of 160.0;
    a difference of returns would give 100 + (100% - 25%) = 175.0. The two differ only
    once the moves are large, which is why a short fixture would not separate them."""
    a = {"2026-01-05": 50.0, "2026-01-06": 100.0}
    b = {"2026-01-05": 80.0, "2026-01-06": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert result.points[-1].value == pytest.approx(160.0)


def test_a_date_missing_from_either_side_is_omitted_never_forward_filled():
    """A forward-filled spread invents a day the market did not trade and flattens exactly
    the gaps that matter -- the same defect the event-line work hit with a weekend."""
    a = {"2026-01-05": 100.0, "2026-01-06": 110.0, "2026-01-07": 120.0}
    b = {"2026-01-05": 100.0, "2026-01-07": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert [point.date for point in result.points] == ["2026-01-05", "2026-01-07"]


def test_two_series_with_different_start_dates_base_on_the_first_common_date():
    """The join rule. Anchoring each side to its own first observation would index the two
    series to different days and bake that offset into every later value, while passing
    every other test in this file."""
    a = {"2026-01-02": 50.0, "2026-01-03": 100.0, "2026-01-04": 200.0}
    b = {"2026-01-03": 100.0, "2026-01-04": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert result.base_date == "2026-01-03"
    assert [point.date for point in result.points] == ["2026-01-03", "2026-01-04"]
    # Based on 2026-01-03, A doubles and B is flat, so the last value is 200.
    # Had A been based on its own first observation (50.0 on 01-02), it would read 400.
    assert result.points[0].value == pytest.approx(100.0)
    assert result.points[-1].value == pytest.approx(200.0)


def test_dates_before_the_window_start_are_excluded():
    a = {"2026-01-05": 100.0, "2026-01-20": 150.0}
    b = {"2026-01-05": 100.0, "2026-01-20": 100.0}

    result = relative_strength(a, b, window_start="2026-01-10")

    assert result.base_date == "2026-01-20"
    assert [point.date for point in result.points] == ["2026-01-20"]


def test_no_common_date_in_range_refuses_with_a_reason():
    a = {"2026-01-05": 100.0}
    b = {"2026-01-06": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert result.points == []
    assert result.base_date is None
    assert "no overlapping" in result.refused_reason


def test_a_zero_base_refuses_rather_than_dividing():
    """Publishing an infinity would render as a blank or a spike, both of which read as
    data. DeltaBadge.compute already refuses on absent inputs rather than substituting 0."""
    a = {"2026-01-05": 0.0, "2026-01-06": 100.0}
    b = {"2026-01-05": 100.0, "2026-01-06": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert result.points == []
    assert "zero" in result.refused_reason

