import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packages.core_finance.corporate_statement_metrics import (
    DEFAULT_TAX_RATE,
    MAX_ABS_ROIC,
    GROWTH_CAGR_RULE,
    GROWTH_QUALITY_RULES,
    GrowthQualityContext,
    INVESTED_CAPITAL_RULE,
    REVENUE_RULE,
    ROIC_QUALITY_RULES,
    ROIC_SANITY_RULE,
    ROIC_WARNING_RULES,
    TAX_RATE_RULE,
    assess_growth_quality,
    assess_roic_quality,
    average_invested_capital_result,
    calculate_invested_capital,
    calculate_nopat,
    is_growth_cagr_within_sanity_range,
    is_roic_within_sanity_range,
    is_stable_invested_capital,
    is_valid_revenue_base,
    is_valid_statement_tax_rate,
    stable_growth_payload,
    stable_tax_result,
)


def test_stable_tax_result_uses_median_valid_statement_tax_rate():
    result = stable_tax_result(
        pretax_income_by_year={2021: 100.0, 2022: 100.0, 2023: -50.0, 2024: 100.0},
        tax_expense_by_year={2021: 20.0, 2022: 28.0, 2023: 10.0, 2024: 60.0},
    )

    assert result["tax_rate"] == pytest.approx(0.24)
    assert result["tax_rate_source"] == "median_valid_statement_tax_rate"
    assert result["tax_rate_note"] == "Used median of positive valid tax rates, clamped to realistic range."


def test_named_policy_rules_expose_finance_sanity_bounds():
    assert TAX_RATE_RULE.minimum == pytest.approx(0.15)
    assert INVESTED_CAPITAL_RULE.minimum == 1_000_000.0
    assert REVENUE_RULE.minimum == 1_000_000.0
    assert ROIC_SANITY_RULE.maximum == pytest.approx(3.0)
    assert GROWTH_CAGR_RULE.minimum == pytest.approx(-0.9)
    assert is_valid_statement_tax_rate(0.21) is True
    assert is_stable_invested_capital(2_000_000.0) is True
    assert is_valid_revenue_base(2_000_000.0) is True
    assert is_roic_within_sanity_range(300.0) is True
    assert is_growth_cagr_within_sanity_range(200.0) is True
    assert [rule.name for rule in ROIC_WARNING_RULES] == [
        "non_annual_roic_basis",
        "fallback_tax_rate",
        "current_capital_only",
    ]
    assert [rule.name for rule in ROIC_QUALITY_RULES] == [
        "missing_roic_records",
        "missing_average_invested_capital",
        "non_positive_average_invested_capital",
        "unstable_roic_denominator",
        "outlier_roic",
    ]
    assert [rule.name for rule in GROWTH_QUALITY_RULES] == [
        "insufficient_revenue_history",
        "invalid_year_range",
        "non_positive_revenue_base",
        "outlier_growth_cagr",
    ]


def test_stable_tax_result_falls_back_when_no_valid_positive_tax_rate_exists():
    result = stable_tax_result(
        pretax_income_by_year={2021: -100.0, 2022: 0.0, 2023: 100.0},
        tax_expense_by_year={2021: 20.0, 2022: 10.0, 2023: 70.0},
    )

    assert result["tax_rate"] == DEFAULT_TAX_RATE
    assert result["tax_rate_source"] == "fallback_default"
    assert result["tax_rate_note"] == "No valid positive statement tax rate found."


def test_calculate_nopat_returns_missing_note_when_operating_income_is_unavailable():
    result = calculate_nopat(None, 0.21)

    assert result == {
        "nopat": None,
        "nopat_note": "Missing operating income.",
    }


def test_calculate_invested_capital_rejects_invalid_denominators():
    negative = calculate_invested_capital(equity=-10.0, debt=0.0)
    tiny = calculate_invested_capital(equity=500_000.0, debt=200_000.0)

    assert negative["invested_capital"] is None
    assert negative["invested_capital_note"] == "Invested capital is zero or negative."
    assert tiny["invested_capital"] is None
    assert tiny["invested_capital_note"] == "Invested capital is too small; ROIC denominator unstable."


def test_average_invested_capital_falls_back_to_current_year_when_previous_year_is_unavailable():
    result = average_invested_capital_result(
        current_equity=2_000_000.0,
        current_debt=1_000_000.0,
        previous_equity=None,
        previous_debt=None,
    )

    assert result["invested_capital_ending"] == 3_000_000.0
    assert result["invested_capital_beginning"] is None
    assert result["average_invested_capital"] == 3_000_000.0
    assert result["average_ic_note"] == "Previous invested capital unavailable; used current invested capital."
    assert result["used_previous"] is False


def test_assess_roic_quality_rejects_outlier_roic_values():
    assessment = assess_roic_quality(
        roic_records=[{"year": 2025, "average_invested_capital": 2_000_000.0, "nopat": 10_000_000.0, "used_previous_capital": True}],
        selected_roic_record={"year": 2025, "average_invested_capital": 2_000_000.0, "nopat": 10_000_000.0, "used_previous_capital": True},
        roic_basis="annual",
        tax_result={
            "tax_rate": 0.21,
            "tax_rate_source": "median_valid_statement_tax_rate",
            "tax_rate_note": "Used median of positive valid tax rates, clamped to realistic range.",
        },
        derived_roic=(MAX_ABS_ROIC * 100) + 1.0,
    )

    assert assessment["quality"] == "suspicious"
    assert assessment["reason"] == "ROIC exceeds the configured sanity range."
    assert "ROIC exceeds the configured sanity range." in assessment["warnings"]


def test_assess_roic_quality_uses_highest_priority_matching_policy_rule():
    assessment = assess_roic_quality(
        roic_records=[
            {
                "year": 2025,
                "average_invested_capital": None,
                "average_invested_capital_note": "Invested capital is too small; ROIC denominator unstable.",
                "nopat": 10_000_000.0,
                "used_previous_capital": True,
            }
        ],
        selected_roic_record={
            "year": 2025,
            "average_invested_capital": None,
            "average_invested_capital_note": "Invested capital is too small; ROIC denominator unstable.",
            "nopat": 10_000_000.0,
            "used_previous_capital": True,
        },
        roic_basis="annual",
        tax_result={
            "tax_rate": 0.21,
            "tax_rate_source": "median_valid_statement_tax_rate",
            "tax_rate_note": "Used median of positive valid tax rates, clamped to realistic range.",
        },
        derived_roic=(MAX_ABS_ROIC * 100) + 1.0,
    )

    assert assessment["quality"] == "invalid"
    assert assessment["reason"] == "Invested capital is too small; ROIC denominator unstable."


def test_assess_growth_quality_uses_highest_priority_matching_policy_rule():
    assessment = assess_growth_quality(
        GrowthQualityContext(
            revenue_points=[
                {"year": 2025, "revenue": 1_000_000.0},
                {"year": 2025, "revenue": 5_000_000.0},
            ],
            annual_growth=[],
            recent_average=None,
            first={"year": 2025, "revenue": 1_000_000.0},
            last={"year": 2025, "revenue": 5_000_000.0},
            periods=0,
            revenue_first=1_000_000.0,
            revenue_last=5_000_000.0,
            growth_cagr=500.0,
        )
    )

    assert assessment["growth_cagr"] is None
    assert assessment["growth_note"] == "Invalid year range for CAGR."


def test_stable_growth_payload_returns_valid_cagr():
    result = stable_growth_payload({
        2021: 1_000_000.0,
        2023: 1_210_000.0,
    })

    assert round(float(result["growth_cagr"]), 2) == 10.0
    assert round(float(result["growth_recent_average"]), 2) == 21.0
    assert result["growth_note"] == "Growth calculated using revenue CAGR from available annual statements."


def test_stable_growth_payload_requires_two_valid_revenue_years():
    result = stable_growth_payload({
        2025: 1_100_000.0,
    })

    assert result["growth_cagr"] is None
    assert result["growth_recent_average"] is None
    assert result["growth_note"] == "Need at least two valid revenue years."


def test_stable_growth_payload_rejects_invalid_revenue_base():
    result = stable_growth_payload({
        2021: 500_000.0,
        2023: 1_500_000.0,
    })

    assert result["growth_cagr"] is None
    assert result["growth_note"] == "Need at least two valid revenue years."


def test_stable_growth_payload_rejects_outlier_cagr():
    result = stable_growth_payload({
        2021: 1_000_000.0,
        2022: 5_000_000.0,
        2023: 12_000_000.0,
    })

    assert result["growth_cagr"] is None
    assert result["growth_recent_average"] is not None
    assert result["growth_note"] == "Growth CAGR exceeded sanity threshold."
