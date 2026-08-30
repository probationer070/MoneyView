import pytest

from packages.core_finance.price_signals import (
    drawdown_from_peak,
    pe_change,
    trailing_pe_series,
    volume_ratio,
)


def test_drawdown_measures_from_the_running_peak():
    # peak 174.40 at index 2, last close 120.00 -> -31.1926...%
    closes = [100.0, 150.0, 174.40, 130.0, 120.0]
    pct, peak, index = drawdown_from_peak(closes)
    assert peak == 174.40
    assert index == 2
    assert pct == pytest.approx(-0.311926605504587, rel=1e-12)


def test_a_series_at_its_peak_has_zero_drawdown():
    pct, peak, index = drawdown_from_peak([10.0, 20.0, 30.0])
    assert pct == 0.0
    assert peak == 30.0
    assert index == 2


def test_drawdown_refuses_an_empty_series():
    assert drawdown_from_peak([]) is None


def test_volume_ratio_is_recent_mean_over_baseline_mean():
    # recent 2 -> mean 300; baseline 4 -> mean 200
    assert volume_ratio([100, 100, 300, 300], recent=2, baseline=4) == pytest.approx(1.5)


def test_volume_ratio_refuses_a_zero_baseline():
    """A zero baseline MEAN would divide to infinity. A plausible-looking number
    is worse than no number -- the argument dcf.py:196 makes for the terminal
    spread."""
    assert volume_ratio([0, 0, 0, 0], recent=2, baseline=4) is None


def test_volume_ratio_tolerates_individual_zero_volume_days():
    """Only the baseline MEAN has to be positive. A halted or zero-volume day
    inside the window must not refuse the whole signal: over a 252-day baseline
    that would make the ratio almost never computable on real data.

    recent 2 -> mean 5.0; baseline 4 -> mean 2.5; ratio 2.0
    """
    assert volume_ratio([0, 0, 5, 5], recent=2, baseline=4) == pytest.approx(2.0)


def test_volume_ratio_refuses_when_the_window_exceeds_the_data():
    assert volume_ratio([100, 200], recent=2, baseline=10) is None


def test_trailing_pe_uses_the_eps_of_each_close_s_period():
    closes = [("2024-12-31", 100.0), ("2025-12-31", 120.0)]
    eps = {"2024": 5.0, "2025": 6.0}
    assert trailing_pe_series(closes, eps) == [("2024-12-31", 20.0), ("2025-12-31", 20.0)]


def test_a_non_positive_eps_yields_no_pe_for_that_period():
    """A loss-making year has no meaningful PE. Emitting a negative one would
    read as 'cheap' in any comparison that sorts ascending."""
    closes = [("2024-12-31", 100.0), ("2025-12-31", 120.0)]
    eps = {"2024": 0.0, "2025": -3.0}
    assert trailing_pe_series(closes, eps) == []


def test_pe_change_is_the_fractional_move_across_the_series():
    series = [("2024-12-31", 34.0), ("2025-12-31", 22.1)]
    assert pe_change(series) == pytest.approx(-0.35)


def test_pe_change_refuses_a_single_point():
    assert pe_change([("2025-12-31", 22.0)]) is None
