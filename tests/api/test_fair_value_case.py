"""The Damodaran-style fair-value case builder (spec 2026-10-26-damodaran-fair-value-design.md §3).

Each docstring names the mutation its test catches. Expected values are re-derived here from the
spec's formulas, not read back from the builder.
"""

import math

import pytest

from apps.api.services.conservative_case import CompanyBaseline
from apps.api.services.fair_value_case import (
    GROWTH_CAP,
    GROWTH_FLOOR,
    IMPLIED_GROWTH_HIGH,
    IMPLIED_GROWTH_LOW,
    FairValueRefused,
    build_fair_value_case,
    company_revenue_cagr,
    fair_value_case_name,
    growth_for_revenue_target,
    implied_growth,
)
from apps.api.services.valuation_case import _specs_from_payload
from packages.core_finance.industry_benchmark import IndustryRow
from packages.core_finance.segment_valuation import run_case

RF = 0.0456

BASELINE = CompanyBaseline(
    base_revenue=400.0, base_margin=0.32, current_roic=0.40, current_sales_to_capital=2.5,
    current_growth=0.06, current_wacc=0.10, cash=60.0, debt=100.0, shares=15.0,
    source_years=(2022, 2023, 2024, 2025),
)

INDUSTRY = IndustryRow("Computers/Peripherals", 36, {
    "revenue_growth": 0.0671086957, "operating_margin": 0.224848747,
    "after_tax_roc": 0.4476035274, "effective_tax_rate": 0.1535453935,
    "unlevered_beta": 1.3245870397, "debt_to_capital": 0.0442031038,
    "cost_of_capital": 0.0970707313, "sales_to_capital": 3.6197887498,
    "reinvestment_rate": 0.2136889975,
})


def _build(company_growth=0.05, industry=INDUSTRY, baseline=BASELINE):
    return build_fair_value_case(
        "AAPL", baseline, industry, vintage="2026-01-01", latest_year=2025,
        company_growth=company_growth, riskfree_rate=RF, marginal_tax_rate=0.25, base_year=2026,
    )


def _expected_revenue_target(base, g):
    revenue = base * (1 + g) ** 5
    for t in range(6, 11):
        revenue *= 1 + g + (RF - g) * (t - 5) / 5
    return revenue


def test_revenue_cagr_spans_the_last_three_years():
    """Catches a CAGR over the whole history, over one year only, or with the wrong exponent."""
    assert company_revenue_cagr({2021: 50.0, 2022: 80.0, 2023: 100.0, 2024: 110.0, 2025: 133.1}) == pytest.approx(
        (133.1 / 80.0) ** (1 / 3) - 1)
    assert company_revenue_cagr({2024: 100.0, 2025: 110.0}) == pytest.approx(0.10)


def test_revenue_cagr_refuses_too_little_or_non_positive_history():
    """Catches a growth rate invented from one year, or from a non-positive start."""
    assert company_revenue_cagr({2025: 100.0}) is None
    assert company_revenue_cagr({2024: 0.0, 2025: 100.0}) is None


def test_growth_blends_company_and_industry_then_fades_to_riskfree():
    """Catches the blend dropped (company or industry alone), the 6-10 fade missing, or the fade
    ending somewhere other than the riskfree rate."""
    payload = _build(company_growth=0.05)
    g = (0.05 + 0.0671086957) / 2
    assert payload["segments"][0]["revenue_target"] == pytest.approx(_expected_revenue_target(400.0, g), rel=1e-12)


@pytest.mark.parametrize("company_growth, expected", [(0.90, GROWTH_CAP), (-0.60, GROWTH_FLOOR)])
def test_growth_is_clamped(company_growth, expected):
    """Catches the clamp removed, or applied to the company figure before blending."""
    payload = _build(company_growth=company_growth)
    assert payload["segments"][0]["revenue_target"] == pytest.approx(
        _expected_revenue_target(400.0, expected), rel=1e-12)


def test_margin_capital_wacc_and_tax_follow_the_spec():
    """Catches the margin not halfway to the industry, the company's own sales-to-capital or WACC
    used as the stable value, or the tax ramp aimed at the wrong rate."""
    payload = _build()
    segment = payload["segments"][0]
    # The company's 32% is above the industry's 22.5%: a leader keeps its margin (spec §3).
    assert segment["margin_target"] == pytest.approx(0.32)
    assert segment["sales_to_capital_early"] == segment["sales_to_capital_late"] == pytest.approx(3.6197887498)
    assert payload["wacc_initial"] == pytest.approx(0.10)
    assert payload["wacc_stable"] == pytest.approx(0.0970707313)
    assert payload["wacc_converge_from"] == 6
    assert payload["effective_tax_rate"] == pytest.approx(0.1535453935)
    assert payload["marginal_tax_rate"] == 0.25
    assert payload["roic_stable"] == pytest.approx(0.4476035274)
    assert payload["terminal_growth"] is None
    assert (payload["cash"], payload["debt"], payload["shares_basic"]) == (60.0, 100.0, 15.0)
    assert payload["case_name"] == fair_value_case_name("AAPL", "2026-01-01", 2025) == "damodaran_AAPL_2026-01-01_FY2025"


def test_a_margin_below_the_industry_moves_halfway_up_to_it():
    """Catches a laggard handed the full industry margin, or held at its own."""
    laggard = CompanyBaseline(**{**BASELINE.__dict__, "base_margin": 0.10})
    payload = _build(baseline=laggard)
    assert payload["segments"][0]["margin_target"] == pytest.approx((0.10 + 0.224848747) / 2)


def test_the_model_growth_is_recovered_from_its_revenue_target():
    """Catches the reported growth drifting from the one that built the revenue target."""
    payload = _build(company_growth=0.05)
    segment = payload["segments"][0]
    g = (0.05 + 0.0671086957) / 2
    assert growth_for_revenue_target(segment["base_revenue"], segment["revenue_target"], RF) == pytest.approx(g, abs=1e-9)


def test_the_price_implied_growth_round_trips():
    """Catches the solve aimed at the wrong value (basic, enterprise), a growth path that differs
    from the model's (no fade), or a bisection that stops early."""
    payload = _build(company_growth=0.05)
    value = run_case(*_specs_from_payload(payload)).value_per_share_diluted
    g = (0.05 + 0.0671086957) / 2
    growth, note = implied_growth(payload, value)
    assert note is None
    assert growth == pytest.approx(g, abs=1e-6)
    higher, _ = implied_growth(payload, value * 1.5)
    assert higher > g


def test_a_price_out_of_reach_says_so_instead_of_inventing_a_growth():
    """Catches a bound returned as if it were the answer."""
    payload = _build()
    value = run_case(*_specs_from_payload(payload)).value_per_share_diluted
    growth, note = implied_growth(payload, value * 1000)
    assert growth is None and note.startswith("above_range:") and str(IMPLIED_GROWTH_HIGH) in note
    growth, note = implied_growth(payload, value / 1000)
    assert growth is None and note.startswith("below_range:") and str(IMPLIED_GROWTH_LOW) in note


def test_an_industry_earning_at_or_below_its_cost_of_capital_grows_at_zero_in_perpetuity():
    """Catches the terminal block refused (no value at all) or growing at a return below the cost
    of capital (value destroyed by growth) instead of zero growth, which is the value of
    Damodaran's no-excess-return default."""
    poor = IndustryRow("Utility", 40, {**INDUSTRY.values, "after_tax_roc": 0.05, "cost_of_capital": 0.07})
    payload = _build(industry=poor)
    assert payload["roic_stable"] == pytest.approx(0.05)
    assert payload["terminal_growth"] == 0.0
    run_case(*_specs_from_payload(payload))  # storable


def test_the_terminal_return_is_capped_at_the_implied_marginal_return():
    """Catches the industry ROC carried as the terminal return when the case's own margin and
    sales-to-capital imply less on new capital: the engine refuses that case (75 of the real
    watchlist did, AEP among them), the same reason the conservative builder takes the lower."""
    thin = IndustryRow("Utility", 40, {**INDUSTRY.values, "operating_margin": 0.10, "sales_to_capital": 0.5,
                                         "after_tax_roc": 0.12, "cost_of_capital": 0.06})
    payload = _build(industry=thin, baseline=CompanyBaseline(**{**BASELINE.__dict__, "base_margin": 0.10}))
    implied = 0.10 * (1 - 0.25) * 0.5
    assert implied < 0.12
    assert payload["roic_stable"] == pytest.approx(implied)
    assert payload["terminal_growth"] == 0.0  # 3.75% on new capital is below the 6% cost of capital
    run_case(*_specs_from_payload(payload))  # storable, not refused


def test_the_payload_is_storable_and_runs():
    """Catches a payload the engine refuses (missing narrative, inconsistent fields)."""
    result = run_case(*_specs_from_payload(_build()))
    assert result.value_per_share_diluted > 0 and math.isfinite(result.value_per_share_diluted)


@pytest.mark.parametrize("column", ["revenue_growth", "operating_margin", "after_tax_roc",
                                    "effective_tax_rate", "cost_of_capital", "sales_to_capital"])
def test_a_missing_or_implausible_industry_column_refuses(column):
    """Catches a missing industry average replaced by a default instead of refusing."""
    for bad in (None, 999.0):
        industry = IndustryRow("X", 40, {**INDUSTRY.values, column: bad})
        with pytest.raises(FairValueRefused) as refused:
            _build(industry=industry)
        assert str(refused.value).startswith("industry_column:") and column in str(refused.value)
