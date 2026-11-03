"""Fair-value plausibility: implied EV/Sales over the industry's, and the inputs behind a flag.

Each docstring names the mutation its test catches. Nothing here touches the stored database: the
case payload is built in memory and run through the engine.
"""

import pytest

from apps.api.services import fair_value
from apps.api.services.conservative_case import CompanyBaseline
from apps.api.services.fair_value import PLAUSIBILITY_K, fair_value_summary, plausibility
from apps.api.services.fair_value_case import build_fair_value_case, growth_for_revenue_target
from apps.api.services.valuation_case import _specs_from_payload
from packages.core_finance.industry_benchmark import IndustryRow
from packages.core_finance.segment_valuation import run_case

RF = 0.0456
BASE_REVENUE = 400.0

BASELINE = CompanyBaseline(
    base_revenue=BASE_REVENUE, base_margin=0.32, current_roic=0.40, current_sales_to_capital=2.5,
    current_growth=0.06, current_wacc=0.10, cash=60.0, debt=100.0, shares=15.0,
    source_years=(2022, 2023, 2024, 2025),
)

VALUES = {
    "revenue_growth": 0.0671086957, "operating_margin": 0.224848747,
    "after_tax_roc": 0.4476035274, "effective_tax_rate": 0.1535453935,
    "unlevered_beta": 1.3245870397, "debt_to_capital": 0.0442031038,
    "cost_of_capital": 0.0970707313, "sales_to_capital": 3.6197887498,
    "reinvestment_rate": 0.2136889975,
}


def _industry(ev_sales, name="Computers/Peripherals", **over):
    return IndustryRow(name, 36, {**VALUES, "ev_sales": ev_sales, **over})


def _case(industry=None, company_growth=0.15):
    return build_fair_value_case(
        "AAPL", BASELINE, industry or _industry(1.0), vintage="2026-01-01", latest_year=2025,
        company_growth=company_growth, riskfree_rate=RF, marginal_tax_rate=0.25, base_year=2026,
    )


def _result(case):
    return run_case(*_specs_from_payload(case))


def _implied(case):
    return _result(case).enterprise_value / BASE_REVENUE


def test_the_ratio_is_enterprise_value_over_base_revenue_over_the_industry_multiple():
    """Catches market cap used for the numerator, revenue_target for the denominator, or the
    ratio taken the wrong way round."""
    case = _case()
    result = _result(case)
    implied = _implied(case)
    assert result.enterprise_value != result.equity_value  # the two numerators differ here
    assert case["segments"][0]["revenue_target"] != BASE_REVENUE
    out = plausibility(case, result.value_per_share_diluted, _industry(implied / 2.0))
    assert out["implied_ev_sales"] == pytest.approx(result.enterprise_value / 400.0)
    assert out["industry_ev_sales"] == pytest.approx(implied / 2.0)
    assert out["ratio"] == pytest.approx(2.0)
    assert out["k"] == PLAUSIBILITY_K == 3.0
    assert out["industry"] == "Computers/Peripherals"


def test_not_flagged_at_or_below_k_has_no_causes():
    """Catches a flag raised at or below k, or causes computed for an unflagged value."""
    case = _case()
    value = _result(case).value_per_share_diluted
    implied = _implied(case)
    for ratio in (2.0, 3.0):
        out = plausibility(case, value, _industry(implied / ratio))
        assert out["flagged"] is False and out["causes"] == []


def test_flagged_above_k_names_margin_first_when_margin_is_the_bigger_driver():
    """Catches the flag never raised, causes left unsorted, and a cause measured on the wrong input."""
    case = _case()
    result = _result(case)
    value = result.value_per_share_diluted
    out = plausibility(case, value, _industry(_implied(case) / 4.0))
    assert out["flagged"] is True and out["ratio"] == pytest.approx(4.0)
    shares = [c["share_of_value"] for c in out["causes"]]
    assert [c["field"] for c in out["causes"]] == ["margin_target", "growth_1_5"]
    assert shares == sorted(shares, reverse=True) and all(s > 0 for s in shares)

    segment = case["segments"][0]
    margin_cause, growth_cause = out["causes"]
    assert margin_cause["company_value"] == pytest.approx(0.32)
    assert margin_cause["industry_value"] == pytest.approx(0.224848747)
    moved = {**case, "segments": [{**segment, "margin_target": 0.224848747}]}
    assert margin_cause["share_of_value"] == pytest.approx(
        (value - _result(moved).value_per_share_diluted) / value)
    assert growth_cause["company_value"] == pytest.approx(
        growth_for_revenue_target(BASE_REVENUE, segment["revenue_target"], RF))
    assert growth_cause["industry_value"] == pytest.approx(0.0671086957)


def test_causes_are_ordered_by_share_not_by_candidate_order():
    """Catches a fixed order (margin always first): here growth is the bigger driver."""
    # Industry growth far under the company's blended growth, industry margin equal to the company's.
    industry = _industry(1.0, operating_margin=0.32, revenue_growth=-0.05)
    case = _case(_industry(1.0, operating_margin=0.20, revenue_growth=0.25))
    case["segments"][0]["margin_target"] = 0.32 * 0.99  # margin moves a hair
    out = plausibility(case, _result(case).value_per_share_diluted,
                       IndustryRow(industry.name, 36, {**industry.values, "ev_sales": 0.01}))
    assert out["flagged"] is True
    assert [c["field"] for c in out["causes"]][0] == "growth_1_5"


def test_a_cause_whose_company_value_equals_the_industry_value_is_dropped():
    """Catches a no-op input listed as a cause (share 0 or noise)."""
    case = _case()
    value = _result(case).value_per_share_diluted
    out = plausibility(case, value, _industry(_implied(case) / 4.0, operating_margin=0.32))
    assert out["flagged"] is True
    assert [c["field"] for c in out["causes"]] == ["growth_1_5"]


def test_a_commodity_industry_takes_the_riskfree_rate_as_its_growth():
    """Catches the industry's own (cycle) growth used for a commodity industry."""
    case = _case(_industry(1.0, name="Steel"))
    out = plausibility(case, _result(case).value_per_share_diluted,
                       _industry(0.01, name="Steel", revenue_growth=0.46))
    growth = next(c for c in out["causes"] if c["field"] == "growth_1_5")
    assert growth["industry_value"] == pytest.approx(RF)


def test_industry_growth_is_held_inside_the_case_builders_band():
    """Catches an unclamped industry growth (a -30% industry would be tested at -30%, not the -5% floor)."""
    case = _case()
    out = plausibility(case, _result(case).value_per_share_diluted, _industry(0.01, revenue_growth=-0.30))
    growth = next(c for c in out["causes"] if c["field"] == "growth_1_5")
    assert growth["industry_value"] == pytest.approx(-0.05)


def test_none_when_the_industry_multiple_is_missing_or_not_positive():
    """Catches a division by a missing or non-positive industry EV/Sales."""
    case = _case()
    value = _result(case).value_per_share_diluted
    assert plausibility(case, value, _industry(None)) is None
    assert plausibility(case, value, _industry(0.0)) is None
    assert plausibility(case, value, _industry(-1.0)) is None
    row = IndustryRow("X", 1, dict(VALUES))  # no ev_sales key at all
    assert plausibility(case, value, row) is None


def test_none_without_a_value_an_industry_or_a_base_revenue():
    """Catches a plausibility reported for a value that is not shown, or a zero base revenue."""
    case = _case()
    assert plausibility(case, None, _industry(1.0)) is None
    assert plausibility(case, 10.0, None) is None
    empty = {**case, "segments": [{**case["segments"][0], "base_revenue": 0.0}]}
    assert plausibility(empty, 10.0, _industry(1.0)) is None


def test_the_summary_carries_the_plausibility_key(monkeypatch):
    """Catches the summary dropping the key, or computing it from another industry or value."""
    case = _case()
    value = _result(case).value_per_share_diluted
    industry = _industry(_implied(case) / 4.0)
    monkeypatch.setattr(fair_value, "load_case", lambda _id: case)
    monkeypatch.setattr(fair_value, "run_stored_case", lambda _id: {"value_per_share_diluted": value})
    monkeypatch.setattr(fair_value, "find_conservative_case_id", lambda _t: None)
    monkeypatch.setattr(fair_value, "load_price_bars", lambda *a, **k: [{"close": 100.0, "date": "2026-10-23"}])
    monkeypatch.setattr(fair_value, "industry_row_for_ticker", lambda t, **k: (industry, "2026-01-01", None))
    summary = fair_value_summary("AAPL", 1, created=False, vintage="2026-01-01")
    assert summary["plausibility"] == plausibility(case, value, industry)
    assert summary["plausibility"]["flagged"] is True
    assert summary["value_per_share"] == pytest.approx(value)


def test_a_growth_equal_to_the_industrys_after_the_clamp_is_dropped():
    """Catches a bisection-noise share (~1e-16) listed as a cause when the case already grows at
    the industry's clamped rate (a 46% industry caps the case at 25%, the same figure the
    industry value is clamped to)."""
    case = _case(_industry(1.0, revenue_growth=0.46))
    out = plausibility(case, _result(case).value_per_share_diluted, _industry(0.01, revenue_growth=0.46))
    assert out["flagged"] is True
    assert "growth_1_5" not in [c["field"] for c in out["causes"]]
