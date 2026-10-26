"""IPO new shares and the offering-price comparison (Damodaran, "Revisiting the SpaceX Valuation:
A Post-Prospectus Update!", 2026-06-04). Each docstring names the mutation its test catches.

The source sheet solves the new share count circularly -- proceeds divided by the value per share it
is computing at the same time. That fixed point has a closed form,

    new = proceeds * shares_basic / (equity_value - proceeds),

so the engine reproduces `Valuation output!B43` instead of carrying it as a transcribed number.
"""

import math
from dataclasses import replace

import pytest

from packages.core_finance.refusals import EngineRefusal
from packages.core_finance.segment_valuation import run_case
from tests.core_finance.test_segment_valuation_spacex import post_prospectus, pre_prospectus

EQUITY_POST = 1301.2990065  # Valuation output!B42, asserted in test_segment_valuation_spacex
SHARES_BASIC_POST = 12.5353


def _post(**changes):
    case, segments = post_prospectus()
    return run_case(replace(case, **changes), segments)


def test_new_shares_solved_from_proceeds_reproduce_the_sheet():
    """Catches the solve dropped (no new shares), the wrong fixed point (proceeds / pre-money value
    per share), or the transcribed count still being required."""
    result = _post(shares_new=0.0)
    assert result.shares_new_effective == pytest.approx(0.76665438, abs=1e-8)
    assert result.value_per_share_diluted == pytest.approx(97.8276552, abs=1e-6)


def test_an_offering_price_sets_the_new_shares_and_the_comparison():
    """Catches the offer price ignored, the implied value counted on basic shares only, or the
    premium measured the wrong way round. $135 is the price the post quotes; it calls the result
    "about $1.8 trillion"."""
    result = _post(shares_new=0.0, offering_price=135.0)
    new = 75.0 / 135.0
    assert result.shares_new_effective == pytest.approx(new, abs=1e-12)
    per_share = EQUITY_POST / (SHARES_BASIC_POST + new)
    assert result.value_per_share_diluted == pytest.approx(per_share, abs=1e-6)
    assert result.offering_implied_value == pytest.approx(135.0 * (SHARES_BASIC_POST + new), abs=1e-6)
    assert result.offering_implied_value == pytest.approx(1767.27, abs=0.01)
    assert result.offering_premium_pct == pytest.approx((135.0 / result.value_per_share_diluted - 1) * 100, abs=1e-9)
    assert result.offering_premium_pct == pytest.approx(35.81, abs=0.01)


def test_an_explicit_new_share_count_is_used_as_given():
    """Catches the solve overriding a count the user typed."""
    result = _post(shares_new=1.0)
    assert result.shares_new_effective == 1.0
    assert result.value_per_share_diluted == pytest.approx(EQUITY_POST / (SHARES_BASIC_POST + 1.0), abs=1e-6)
    assert result.offering_implied_value is None and result.offering_premium_pct is None


def test_no_proceeds_means_no_new_shares_and_no_comparison():
    """Catches a solve that invents shares when nothing is raised."""
    case, segments = pre_prospectus()
    result = run_case(case, segments)
    assert result.shares_new_effective == 0.0
    assert result.offering_implied_value is None and result.offering_premium_pct is None


def test_the_solve_does_not_overflow_near_the_float_limit():
    """Catches proceeds x basic computed first: at 5e307 it overflows to inf shares and values
    every share at 0.0 instead of a finite number."""
    case, segments = post_prospectus()
    result = run_case(replace(case, shares_new=0.0, cash=5e307, ipo_proceeds=5e307), segments)
    assert math.isfinite(result.shares_new_effective) and result.value_per_share_diluted > 0


def test_a_typed_count_and_an_offering_price_together_are_refused():
    """Catches one input silently winning over the other."""
    with pytest.raises(EngineRefusal) as refused:
        _post(shares_new=0.5, offering_price=135.0)
    assert refused.value.code == "conflicting_share_inputs"


@pytest.mark.parametrize("price", [0.0, -1.0])
def test_a_non_positive_offering_price_is_refused(price):
    """Catches a zero price dividing by zero or a negative one minting negative shares."""
    with pytest.raises(EngineRefusal) as refused:
        _post(shares_new=0.0, offering_price=price)
    assert refused.value.code == "non_positive_rate"


def test_a_non_positive_pre_money_equity_cannot_be_solved():
    """Catches the closed form dividing by zero or returning negative shares when existing holders'
    value (equity before the proceeds) is not positive: debt 2000 against an EV near 1224."""
    with pytest.raises(EngineRefusal) as refused:
        _post(shares_new=0.0, debt=2000.0)
    assert refused.value.code == "offering_not_solvable"
