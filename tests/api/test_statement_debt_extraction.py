import pandas as pd

from apps.api.services.corporate_statement_metrics import yahoo_statement_metrics
from apps.api.models.schemas import CorporateMetrics

BILLION = 1_000_000_000.0


def _fallback():
    return CorporateMetrics(
        ticker="TEST", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64,
        governance=74, esg_penalty=22,
    )


def _frame(rows, periods):
    return pd.DataFrame(rows, index=pd.to_datetime(periods)).T


def _bundle(balance):
    empty = pd.DataFrame()
    income = _frame(
        {
            "Total Revenue": [100 * BILLION, 110 * BILLION, 120 * BILLION],
            "Operating Income": [20 * BILLION, 22 * BILLION, 24 * BILLION],
            "Pretax Income": [18 * BILLION, 20 * BILLION, 22 * BILLION],
            "Tax Provision": [4 * BILLION, 4.4 * BILLION, 4.8 * BILLION],
        },
        ["2023-12-31", "2024-12-31", "2025-12-31"],
    )
    return {
        "ticker": "TEST", "income": income, "balance": balance, "cashflow": empty,
        "quarterly_income": empty, "quarterly_balance": empty, "quarterly_cashflow": empty,
        "info": {}, "fetched_at": None,
    }


def _debt_ratio(balance):
    metrics = yahoo_statement_metrics(
        "TEST", _fallback(), bundle_loader=lambda t, e: _bundle(balance)
    )
    return metrics.debt_ratio if metrics is not None else None


def test_net_debt_is_not_read_as_total_debt():
    # A cash-rich company: total debt 100B, cash 90B, so Yahoo's Net Debt line reads 10B.
    # Treating that as total debt understates leverage by 90% of the balance sheet, and
    # every WACC weight derived from it is wrong.
    equity = 100 * BILLION
    net_debt_only = _frame(
        {"Net Debt": [10 * BILLION],
         "Cash And Cash Equivalents": [90 * BILLION],
         "Stockholders Equity": [equity]},
        ["2025-12-31"],
    )
    true_total = _frame(
        {"Total Debt": [100 * BILLION],
         "Cash And Cash Equivalents": [90 * BILLION],
         "Stockholders Equity": [equity]},
        ["2025-12-31"],
    )
    assert _debt_ratio(net_debt_only) == _debt_ratio(true_total)


def test_total_debt_is_recovered_from_net_debt_plus_cash():
    # debt_ratio needs GROSS debt, so here the cash term does not cancel -- unlike the
    # equity bridge, where the same two line items produce net debt.
    balance = _frame(
        {"Net Debt": [10 * BILLION],
         "Cash And Cash Equivalents": [90 * BILLION],
         "Stockholders Equity": [100 * BILLION]},
        ["2025-12-31"],
    )
    # gross debt 100B / (100B + 100B equity) = 50%
    assert _debt_ratio(balance) == 50.0


def test_total_debt_is_preferred_when_both_lines_are_present():
    balance = _frame(
        {"Total Debt": [100 * BILLION],
         "Net Debt": [10 * BILLION],
         "Cash And Cash Equivalents": [90 * BILLION],
         "Stockholders Equity": [100 * BILLION]},
        ["2025-12-31"],
    )
    assert _debt_ratio(balance) == 50.0
