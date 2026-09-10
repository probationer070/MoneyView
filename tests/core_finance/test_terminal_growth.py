"""Terminal growth, and which bound decided it.

`WACC - safety_margin` was doing two jobs: keeping the Gordon denominator away from zero,
and standing in for an economic ceiling it was never chosen to represent. Splitting them
starts here, with a function that reports which bound actually bound -- because "why is
this number 3%?" is the question the current implementation cannot answer.
"""

import pytest

from packages.core_finance.terminal_growth import (
    SAFETY_MARGIN,
    TERMINAL_GROWTH_CEILING,
    derive_terminal_growth,
)


def test_company_growth_binds_when_it_is_the_smallest():
    result = derive_terminal_growth(company_growth=0.02, wacc=0.09, ceiling=0.03)

    assert result.rate == pytest.approx(0.02)
    assert result.binding_constraint == "company"


def test_the_ceiling_binds_a_fast_grower():
    result = derive_terminal_growth(company_growth=0.18, wacc=0.09, ceiling=0.03)

    assert result.rate == pytest.approx(0.03)
    assert result.binding_constraint == "ceiling"


def test_the_wacc_safety_bound_binds_when_wacc_is_low():
    """A WACC below the ceiling makes the safety bound the smallest of the three."""
    result = derive_terminal_growth(company_growth=0.18, wacc=0.02, ceiling=0.03)

    assert result.rate == pytest.approx(0.015)
    assert result.binding_constraint == "wacc_safety"


def test_without_a_ceiling_the_result_is_todays_arithmetic():
    """Stage 1 calls it this way, so this pins that Stage 1 changes no valuation."""
    result = derive_terminal_growth(company_growth=0.18, wacc=0.1414, ceiling=None)

    assert result.rate == pytest.approx(0.1414 - 0.005)
    assert result.binding_constraint == "wacc_safety"
    assert result.ceiling is None


def test_the_reported_bounds_are_the_ones_that_were_compared():
    result = derive_terminal_growth(company_growth=0.18, wacc=0.09, ceiling=0.03)

    assert result.company_growth == pytest.approx(0.18)
    assert result.ceiling == pytest.approx(0.03)
    assert result.wacc_safety_bound == pytest.approx(0.085)


def test_a_negative_ceiling_is_honoured_rather_than_floored_at_zero():
    """Spec 5.2: a shrinking industry may drive the ceiling below zero."""
    result = derive_terminal_growth(company_growth=0.05, wacc=0.09, ceiling=-0.01)

    assert result.rate == pytest.approx(-0.01)
    assert result.binding_constraint == "ceiling"


def test_ties_resolve_to_the_more_economic_bound():
    """When the ceiling and the safety bound are exactly equal, the ceiling is the reason.

    Arbitrary only in appearance: reporting `wacc_safety` here would tell a reader the
    arithmetic constrained them when an economic judgement did so equally.

    The values are powers of two so the tie is exact. The obvious decimal choice is not a
    tie at all -- `0.035 - 0.005` is `0.030000000000000002`, so a ceiling of `0.03` wins by
    being strictly smaller and the ordering under test never runs. That was the first
    version of this test, and it passed against both orderings.
    """
    result = derive_terminal_growth(
        company_growth=0.75, wacc=1.0, ceiling=0.5, safety_margin=0.5
    )

    assert result.wacc_safety_bound == 0.5          # exact, not approx -- the tie is the point
    assert result.rate == pytest.approx(0.5)
    assert result.binding_constraint == "ceiling"


def test_the_pinned_constants_are_what_the_plan_says():
    assert SAFETY_MARGIN == 0.005
    assert TERMINAL_GROWTH_CEILING == 0.03
