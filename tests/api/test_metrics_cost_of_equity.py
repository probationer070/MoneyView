"""The metrics response carries the levered beta and Ke its WACC was built with.

Plan 2026-11-02-corporate-explainers §6.3 (P3): the Corporate Ke card showed a Ke from a different
ERP and tax rate than the WACC beside it. The card now shows these two fields, so they must be the
WACC's own inputs, which the WACC identity below pins.
"""
import pandas as pd
import pytest

from apps.api.models.schemas import CorporateMetrics
from apps.api.services.corporate_statement_metrics import yahoo_statement_metrics

BILLION = 1_000_000_000.0


def _fallback():
    return CorporateMetrics(
        ticker="TEST", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64,
        governance=74, esg_penalty=22,
    )


def _frame(rows, periods):
    return pd.DataFrame(rows, index=pd.to_datetime(periods)).T


def _metrics(beta: float):
    years = ["2023-12-31", "2024-12-31", "2025-12-31"]
    income = _frame(
        {
            "Total Revenue": [100 * BILLION, 110 * BILLION, 120 * BILLION],
            "Operating Income": [20 * BILLION, 22 * BILLION, 24 * BILLION],
            "Pretax Income": [18 * BILLION, 20 * BILLION, 22 * BILLION],
            "Tax Provision": [4 * BILLION, 4.4 * BILLION, 4.8 * BILLION],
            "Interest Expense": [2 * BILLION, 2 * BILLION, 2 * BILLION],
        },
        years,
    )
    balance = _frame(
        {"Total Debt": [50 * BILLION] * 3, "Stockholders Equity": [150 * BILLION] * 3},
        years,
    )
    empty = pd.DataFrame()
    bundle = {
        "ticker": "TEST", "income": income, "balance": balance, "cashflow": empty,
        "quarterly_income": empty, "quarterly_balance": empty, "quarterly_cashflow": empty,
        "info": {"beta": beta}, "fetched_at": None,
    }
    metrics = yahoo_statement_metrics("TEST", _fallback(), bundle_loader=lambda t, e: bundle)
    assert metrics is not None
    return metrics


@pytest.mark.parametrize("beta", [0.6, 1.3, 2.4])
def test_ke_is_the_capm_ke_with_the_wacc_beta(beta):
    metrics = _metrics(beta)
    assert metrics.levered_beta == pytest.approx(beta)
    # r_f 4.2% + beta x ERP 5.5% + CRP 0.8%, in percent.
    assert metrics.cost_of_equity == pytest.approx(4.2 + beta * 5.5 + 0.8, abs=1e-3)


@pytest.mark.parametrize("beta", [0.6, 1.3, 2.4])
def test_the_reported_ke_is_the_ke_inside_the_wacc(beta):
    metrics = _metrics(beta)
    debt_weight = metrics.debt_ratio / 100
    cost_of_debt = 2 / 50  # interest 2B on debt 50B
    rebuilt = (1 - debt_weight) * metrics.cost_of_equity + debt_weight * cost_of_debt * 100 * (1 - metrics.tax_rate)
    assert metrics.wacc == pytest.approx(rebuilt, abs=0.01)


def test_metrics_not_built_from_statements_carry_no_ke():
    assert _fallback().cost_of_equity is None
    assert _fallback().levered_beta is None
