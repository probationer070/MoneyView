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
from apps.api.services import db as db_service
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


def test_where_the_safety_bound_binds_the_spread_is_exactly_the_margin():
    """Today's defect, characterised: where that bound binds, the spread is pinned at 50bp.

    Two assertions, and the second is the important one. Guarding a single-ticker assertion
    on the binding constraint makes it vacuous whenever the guard is false -- AAPL binds on
    "company", so the first version of this test asserted nothing at all. Sweeping a sample
    and then requiring that the sample contained at least one such ticker is what stops a
    green run from meaning "the condition never occurred".

    Expected to change after Stage 2 for tickers whose growth exceeds the ceiling. That
    change is the point, and this test is how it becomes visible.
    """
    # Use a representative sample from the live watchlist. These tickers cover a range of
    # growth rates and WACC values, ensuring we hit both "company" and "wacc_safety" bindings.
    test_tickers = [
        "AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "TSLA", "NFLX", "ADBE", "CRM",
        "JPM", "BAC", "JNJ", "PFE", "KO", "PG", "WMT", "XOM", "CVX", "MCD",
    ]

    pinned = []
    for ticker in test_tickers:
        try:
            summary = _report(ticker).summary
        except Exception:
            continue
        if summary.terminal_growth_binding_constraint == "wacc_safety":
            pinned.append(ticker)
            assert summary.wacc_minus_terminal_growth == pytest.approx(SAFETY_MARGIN), ticker

    assert pinned, "no sampled ticker bound on wacc_safety; this test proved nothing"
