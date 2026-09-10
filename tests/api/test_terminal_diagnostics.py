"""A DCF report should say which bound decided its terminal growth.

`terminal_value_share_pct` has always been on the report and on screen. What no surface
could say is WHY a valuation is 96% terminal value -- whether an economic judgement or the
Gordon denominator's safety bound produced the growth rate. These two fields answer that.

Stage 1: the values below are today's arithmetic. When Stage 2 supplies a ceiling they
change, and the characterisation test here is what makes that change visible rather than
merely asserted.
"""

import pytest

from apps.api.routes import corporate as corporate_route
from apps.api.services.corporate_dcf import build_dcf_full_report
from packages.core_finance.terminal_growth import SAFETY_MARGIN


def _report(ticker: str = "AAPL"):
    metrics = corporate_route._metrics_for_ticker(ticker)
    params = corporate_route._valuation_params_from_metrics(metrics)
    return build_dcf_full_report(
        ticker=ticker,
        params=params,
        current_price_loader=corporate_route._latest_market_price,
        metrics_loader=corporate_route._metrics_for_ticker,
        risk_free_rate=corporate_route.DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=corporate_route.DEFAULT_EQUITY_RISK_PREMIUM,
        country_risk_premium=corporate_route.KOREA_COUNTRY_RISK_PREMIUM,
    )


def test_the_report_states_the_spread_the_terminal_value_turns_on():
    summary = _report().summary

    assert summary.wacc_minus_terminal_growth is not None
    assert summary.wacc_minus_terminal_growth > 0


def test_the_report_names_the_binding_constraint():
    summary = _report().summary

    assert summary.terminal_growth_binding_constraint in {"company", "wacc_safety"}


def test_stage_one_never_reports_a_ceiling_because_none_is_applied():
    """The ceiling arrives in Stage 2. Reporting it here would be a lie about the run."""
    summary = _report().summary

    assert summary.terminal_growth_binding_constraint != "ceiling"


def test_the_spread_equals_the_safety_margin_when_the_safety_bound_binds():
    """Today's defect, characterised: the bound that binds pins the spread at 50bp.

    This is expected to FAIL after Stage 2 for tickers whose growth exceeds the ceiling,
    and that failure is the point -- it is how the change proves itself.
    """
    summary = _report().summary

    if summary.terminal_growth_binding_constraint == "wacc_safety":
        assert summary.wacc_minus_terminal_growth == pytest.approx(SAFETY_MARGIN)
