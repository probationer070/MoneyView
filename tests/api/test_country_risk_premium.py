"""Country risk premium by reporting currency (plan 2026-11-02-corporate-explainers §6.5, D3).

The fixed Korea 0.8% used to enter every ticker's cost of equity, US companies included. Now a
US, Canadian or euro-area reporter carries 0 and anything else keeps 0.8%. The DCF's WACC breakdown
carries the ticker's own premium as a fraction, like the ERP beside it; it used to receive 0.8.
"""
import pandas as pd
import pytest

from apps.api.models.schema_parts.corporate import BridgeInputMeta, BridgeSource, ValuationAssumptions
from apps.api.models.schemas import CorporateMetrics
from apps.api.services.corporate_dcf import _build_dcf_outputs
from apps.api.services.corporate_statement_metrics import country_risk_premium_for, yahoo_statement_metrics
from apps.api.services.equity_bridge import EquityBridge

BILLION = 1_000_000_000.0


@pytest.mark.parametrize(
    ("currency", "expected"),
    [("USD", 0.0), ("usd", 0.0), ("CAD", 0.0), ("EUR", 0.0), ("KRW", 0.8), ("TWD", 0.8), ("", 0.8), (None, 0.8)],
)
def test_premium_by_reporting_currency(currency, expected):
    assert country_risk_premium_for(currency) == expected


def _fallback():
    return CorporateMetrics(
        ticker="TEST", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64,
        governance=74, esg_penalty=22,
    )


def _frame(rows, periods):
    return pd.DataFrame(rows, index=pd.to_datetime(periods)).T


def _metrics(currency):
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
    balance = _frame({"Total Debt": [50 * BILLION] * 3, "Stockholders Equity": [150 * BILLION] * 3}, years)
    empty = pd.DataFrame()
    bundle = {
        "ticker": "TEST", "income": income, "balance": balance, "cashflow": empty,
        "quarterly_income": empty, "quarterly_balance": empty, "quarterly_cashflow": empty,
        "info": {"beta": 1.2, "financialCurrency": currency}, "fetched_at": None,
    }
    metrics = yahoo_statement_metrics("TEST", _fallback(), bundle_loader=lambda t, e: bundle)
    assert metrics is not None
    return metrics


@pytest.mark.parametrize(("currency", "crp"), [("USD", 0.0), ("KRW", 0.8)])
def test_the_premium_reaches_ke_and_wacc(currency, crp):
    metrics = _metrics(currency)
    assert metrics.crp == crp
    assert metrics.cost_of_equity == pytest.approx(4.2 + 1.2 * 5.5 + crp, abs=1e-3)


def test_a_us_reporter_has_a_lower_wacc_by_the_premium_times_the_equity_weight():
    us, kr = _metrics("USD"), _metrics("KRW")
    equity_weight = 1 - us.debt_ratio / 100
    assert kr.wacc - us.wacc == pytest.approx(0.8 * equity_weight, abs=0.01)


def _bridge():
    meta = lambda value, source: BridgeInputMeta(value=value, source=source, quality="ok", as_of="2025-09-30")  # noqa: E731
    return EquityBridge(
        net_debt=meta(60.0, BridgeSource.TOTAL_DEBT_LESS_CASH),
        non_operating_assets=meta(5.0, BridgeSource.INVESTMENTS_ADVANCES),
        diluted_shares_outstanding=meta(15.0, BridgeSource.DILUTED_AVERAGE_SHARES),
    )


@pytest.mark.parametrize(("crp", "fraction"), [(0.0, 0.0), (0.8, 0.008)])
def test_the_dcf_breakdown_carries_the_tickers_own_premium_as_a_fraction(crp, fraction):
    metrics = _fallback().model_copy(update={"crp": crp})
    params = ValuationAssumptions(
        revenue_growth_rate=0.06, operating_margin=0.25, tax_rate=0.21,
        wacc=0.10, terminal_growth_rate=0.02, fcff=100.0, esg_penalty=22.0,
    )
    _, _, report = _build_dcf_outputs(
        ticker="TEST", params=params,
        current_price_loader=lambda t: 100.0,
        metrics_loader=lambda t: metrics,
        risk_free_rate=0.042, equity_risk_premium=0.055,
        country_risk_premium=None,
        bridge_loader=lambda t: _bridge(),
    )
    assert report.wacc_breakdown.country_risk_premium == pytest.approx(fraction)
