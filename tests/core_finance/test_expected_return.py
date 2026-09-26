import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import math

import pytest

from packages.core_finance.expected_return import (
    ExpectedReturnInputs,
    calculate_capm_expected_return,
    calculate_dcf_implied_return,
    calculate_expected_return_result,
    calculate_market_expected_return,
)


def test_calculate_market_expected_return_adds_risk_free_and_erp():
    assert calculate_market_expected_return(0.042, 0.055) == pytest.approx(0.097)


def test_calculate_capm_expected_return_scales_erp_by_beta():
    assert calculate_capm_expected_return(0.042, 0.055, 1.2) == pytest.approx(0.108)


def test_calculate_dcf_implied_return_uses_intrinsic_value_vs_price():
    assert calculate_dcf_implied_return(100.0, 120.0) == pytest.approx(0.2)


def test_calculate_dcf_implied_return_handles_missing_price():
    assert calculate_dcf_implied_return(0.0, 120.0) == pytest.approx(0.0)


def test_calculate_expected_return_result_returns_stable_value_object():
    result = calculate_expected_return_result(
        ExpectedReturnInputs(
            current_price=100.0,
            intrinsic_value=120.0,
            risk_free_rate=0.042,
            equity_risk_premium=0.055,
            beta=1.2,
        )
    )

    assert result.dcf_implied_return == pytest.approx(0.2)
    assert result.capm_expected_return == pytest.approx(0.108)
    assert result.stock_expected_return == pytest.approx(result.dcf_implied_return)
    assert result.market_expected_return == pytest.approx(0.097)


from packages.core_finance.expected_return import (
    IMPLIED_RETURN_REFUSAL_CODES,
    calculate_market_implied_return,
)
from packages.core_finance.terminal_growth import TERMINAL_GROWTH_CEILING, derive_terminal_growth


def _pv(path, g, r):
    """Independent restatement of the spec's PV(r) (spec 2.1), so no assertion below is
    checked against the function under test."""
    explicit = sum(cf / (1 + r) ** t for t, cf in enumerate(path, start=1))
    terminal = path[-1] * (1 + g) / max(r - g, 0.005)
    return explicit + terminal / (1 + r) ** len(path)


def test_the_refusal_codes_are_exactly_the_specs_six():
    assert IMPLIED_RETURN_REFUSAL_CODES == {
        "no_price", "bridge_unresolved", "non_positive_fcff",
        "non_positive_market_ev", "below_model_range", "above_model_range",
    }


def test_a_flat_perpetuity_solves_to_cash_flow_over_price():
    # With growth 0 and g 0, PV(r) = CF / r exactly, so the IRR is CF / market_ev.
    assert calculate_market_implied_return([10.0] * 5, 0.0, 100.0).rate == pytest.approx(0.10, abs=1e-12)
    assert calculate_market_implied_return([10.0] * 5, 0.0, 50.0).rate == pytest.approx(0.20, abs=1e-12)


def test_the_solved_rate_reprices_market_ev():
    path = [92 * 1.06 ** t for t in range(1, 6)]
    result = calculate_market_implied_return(path, 0.03, 1560.0)
    assert result.refusal is None
    assert abs(_pv(path, 0.03, result.rate) - 1560.0) / 1560.0 < 1e-9
    # Independently bisected by hand for the comparison fixture (fcff 92, growth 6%, g 3%).
    assert result.rate == pytest.approx(0.0989840187, abs=1e-9)


@pytest.mark.parametrize("wacc", [0.06, 0.08, 0.10, 0.12])
@pytest.mark.parametrize("growth", [-0.05, 0.0, 0.06, 0.20])
@pytest.mark.parametrize("multiple", [0.5, 0.9, 1.0, 1.1, 2.0])
def test_the_implied_return_beats_wacc_exactly_when_the_dcf_beats_the_market(wacc, growth, multiple):
    g = derive_terminal_growth(company_growth=growth, wacc=wacc, ceiling=TERMINAL_GROWTH_CEILING).rate
    path = [50 * (1 + growth) ** t for t in range(1, 6)]
    market_ev = _pv(path, g, wacc) * multiple
    result = calculate_market_implied_return(path, g, market_ev)
    assert result.refusal is None
    if multiple < 1:
        assert result.rate > wacc
    elif multiple > 1:
        assert result.rate < wacc
    else:
        assert result.rate == pytest.approx(wacc, abs=1e-9)


def test_a_non_positive_cash_flow_is_refused_before_solving():
    assert calculate_market_implied_return([10.0, 0.0, 10.0, 10.0, 10.0], 0.0, 100.0).refusal == "non_positive_fcff"


def test_growth_at_or_below_minus_one_is_refused_as_non_monotone():
    alternating = [10.0 * (1 - 1.5) ** t for t in range(1, 6)]
    assert calculate_market_implied_return(alternating, 0.0, 100.0).refusal == "non_positive_fcff"


def test_non_positive_market_ev_is_refused():
    assert calculate_market_implied_return([10.0] * 5, 0.0, 0.0).refusal == "non_positive_market_ev"
    assert calculate_market_implied_return([10.0] * 5, 0.0, -5.0).refusal == "non_positive_market_ev"


def test_fcff_refusal_takes_precedence_over_market_ev_refusal():
    assert calculate_market_implied_return([-1.0] * 5, 0.0, -5.0).refusal == "non_positive_fcff"


def test_a_market_ev_above_the_bracket_is_below_model_range():
    ceiling = _pv([10.0] * 5, 0.03, 0.035)
    assert calculate_market_implied_return([10.0] * 5, 0.03, ceiling * 1.01).refusal == "below_model_range"
    at_edge = calculate_market_implied_return([10.0] * 5, 0.03, ceiling)
    assert at_edge.refusal is None and at_edge.rate == pytest.approx(0.035, abs=1e-9)


def test_a_market_ev_below_the_bracket_is_above_model_range():
    floor = _pv([10.0] * 5, 0.0, 10.0)
    assert calculate_market_implied_return([10.0] * 5, 0.0, floor * 0.99).refusal == "above_model_range"


def test_a_refused_result_carries_no_rate():
    result = calculate_market_implied_return([10.0] * 5, 0.0, 0.0)
    assert result.rate is None and result.refusal in IMPLIED_RETURN_REFUSAL_CODES


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_a_non_finite_cash_flow_is_refused_not_solved(bad):
    # nan <= 0 is False: without the finite check a NaN would reach the bisection, make
    # both bracket comparisons False, and come back as a plausible-looking midpoint.
    assert calculate_market_implied_return([10.0, bad, 10.0, 10.0, 10.0], 0.0, 100.0).refusal == "non_positive_fcff"


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_a_non_finite_market_ev_is_refused_not_solved(bad):
    assert calculate_market_implied_return([10.0] * 5, 0.0, bad).refusal == "non_positive_market_ev"


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf, 9.995, 20.0])
def test_an_unusable_terminal_growth_is_a_caller_error(bad):
    # g comes from derive_terminal_growth, bounded to [-0.10, WACC - 0.005]. Anything that
    # empties the bracket or is non-finite is a bug in the caller, not a market outcome.
    with pytest.raises(ValueError, match="terminal_growth"):
        calculate_market_implied_return([10.0] * 5, bad, 100.0)
