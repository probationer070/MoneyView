import pandas as pd
import pytest

from apps.api.models.schema_parts.corporate import BridgeSource
from apps.api.services.equity_bridge import load_equity_bridge

BILLION = 1_000_000_000.0


def _bundle(*, balance=None, income=None, quarterly_balance=None, info=None):
    """A statement bundle shaped exactly like acquisition.store.load_statement_bundle.

    Columns are Timestamps and newest-first, which is what the real loader produces;
    a test using string columns would pass against code that never handles real data.
    """
    empty = pd.DataFrame()
    return {
        "ticker": "TEST",
        "income": income if income is not None else empty,
        "balance": balance if balance is not None else empty,
        "cashflow": empty,
        "quarterly_income": empty,
        "quarterly_balance": quarterly_balance if quarterly_balance is not None else empty,
        "quarterly_cashflow": empty,
        "info": info if info is not None else {},
        "fetched_at": None,
    }


def _frame(rows: dict[str, list[float | None]], periods: list[str]) -> pd.DataFrame:
    frame = pd.DataFrame(rows, index=pd.to_datetime(periods)).T
    return frame


def _loader(bundle):
    return lambda ticker, endpoint: bundle


def test_net_debt_is_total_debt_less_cash_scaled_to_billions():
    bundle = _bundle(
        balance=_frame(
            {
                "Total Debt": [100 * BILLION],
                "Cash Cash Equivalents And Short Term Investments": [40 * BILLION],
            },
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(60.0)
    assert bridge.net_debt.quality == "ok"
    assert bridge.net_debt.source == BridgeSource.TOTAL_DEBT_LESS_CASH
    assert bridge.net_debt.as_of == "2025-09-30"


def test_a_newer_quarterly_period_beats_the_annual_one():
    # A balance sheet is a point-in-time snapshot, so the newest one wins -- unlike the
    # per-year maps the metric layer builds for multi-year ratios.
    bundle = _bundle(
        balance=_frame(
            {"Total Debt": [100 * BILLION], "Cash And Cash Equivalents": [10 * BILLION]},
            ["2024-12-31"],
        ),
        quarterly_balance=_frame(
            {"Total Debt": [80 * BILLION], "Cash And Cash Equivalents": [10 * BILLION]},
            ["2025-09-30"],
        ),
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(70.0)
    assert bridge.net_debt.as_of == "2025-09-30"


def test_net_debt_uses_one_balance_sheet_date_when_the_two_series_end_differently():
    # The store pads absent (line_item, period) cells with NaN, so a ticker whose debt
    # line stops before its cash line is ordinary. Resolving the newest debt and the
    # newest cash independently pairs June debt with September cash: 100 - 40 = 60,
    # understating net debt by the cash that accrued in between, at quality "ok", with
    # only the debt date in as_of. Both terms must come off 2025-06-30: 100 - 20 = 80.
    bundle = _bundle(
        quarterly_balance=_frame(
            {
                "Total Debt": [None, 100 * BILLION],
                "Cash And Cash Equivalents": [40 * BILLION, 20 * BILLION],
            },
            ["2025-09-30", "2025-06-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(80.0)
    assert bridge.net_debt.as_of == "2025-06-30"
    assert bridge.net_debt.quality == "ok"


def test_net_debt_is_missing_when_no_period_carries_both_terms():
    # Never pair across dates: if debt is reported only for one period and cash only for
    # another, there is no balance sheet on which the subtraction is defined.
    bundle = _bundle(
        quarterly_balance=_frame(
            {
                "Total Debt": [None, 100 * BILLION],
                "Cash And Cash Equivalents": [40 * BILLION, None],
            },
            ["2025-09-30", "2025-06-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value is None
    assert bridge.net_debt.quality == "missing"


def test_net_debt_falls_back_to_the_net_debt_line_at_estimated_quality():
    # Recovering total debt as NetDebt + cash and then netting cash back out is just
    # NetDebt, so this branch does rely on Yahoo's undocumented definition. It must be
    # labelled a fallback, not reported as ok.
    bundle = _bundle(
        balance=_frame(
            {"Net Debt": [55 * BILLION], "Cash And Cash Equivalents": [10 * BILLION]},
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(55.0)
    assert bridge.net_debt.quality == "estimated"
    assert bridge.net_debt.source == BridgeSource.NET_DEBT_PLUS_CASH


def test_net_debt_is_missing_when_cash_is_absent():
    bundle = _bundle(balance=_frame({"Total Debt": [100 * BILLION]}, ["2025-09-30"]))
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value is None
    assert bridge.net_debt.quality == "missing"


def test_net_debt_is_negative_for_a_cash_rich_balance_sheet():
    bundle = _bundle(
        balance=_frame(
            {
                "Total Debt": [10 * BILLION],
                "Cash Cash Equivalents And Short Term Investments": [60 * BILLION],
            },
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(-50.0)


def test_net_debt_prefers_the_broader_cash_label_when_both_are_present():
    # _CASH_LABELS orders "Cash Cash Equivalents And Short Term Investments" before
    # "Cash And Cash Equivalents" because the former is the broader measure the bridge
    # wants. Both labels must be present at once to prove the order is honoured --
    # a test with only one label present would pass even if the tuple were reversed.
    bundle = _bundle(
        balance=_frame(
            {
                "Total Debt": [20 * BILLION],
                "Cash Cash Equivalents And Short Term Investments": [15 * BILLION],
                "Cash And Cash Equivalents": [3 * BILLION],
            },
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    # 20 - 15 = 5 if the broader label wins; 20 - 3 = 17 if the order were reversed.
    assert bridge.net_debt.value == pytest.approx(5.0)


def test_non_operating_assets_degrade_to_estimated_when_absent():
    # This term degrades rather than going missing: omitting it understates equity value
    # by a bounded, usually immaterial amount, where substituting net debt would not be.
    bundle = _bundle(
        balance=_frame(
            {"Total Debt": [10 * BILLION], "Cash And Cash Equivalents": [5 * BILLION]},
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.non_operating_assets.value is None
    assert bridge.non_operating_assets.quality == "estimated"


def test_non_operating_assets_is_ok_when_investments_and_advances_present():
    # No test previously covered the ok-quality success path at all.
    bundle = _bundle(
        balance=_frame(
            {"Investments And Advances": [12 * BILLION]},
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.non_operating_assets.value == pytest.approx(12.0)
    assert bridge.non_operating_assets.quality == "ok"
    assert bridge.non_operating_assets.source == BridgeSource.INVESTMENTS_ADVANCES
    assert bridge.non_operating_assets.as_of == "2025-09-30"


def test_non_operating_assets_prefers_investments_and_advances_over_long_term_equity_investment():
    # _INVESTMENT_LABELS orders "Investments And Advances" before "Long Term Equity
    # Investment". Both labels must be present at once to prove the order is honoured.
    bundle = _bundle(
        balance=_frame(
            {
                "Investments And Advances": [8 * BILLION],
                "Long Term Equity Investment": [2 * BILLION],
            },
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    # 8.0 if the first label wins; 2.0 if the order were reversed.
    assert bridge.non_operating_assets.value == pytest.approx(8.0)


def test_diluted_shares_prefer_the_income_statement_over_shares_outstanding():
    bundle = _bundle(
        income=_frame({"Diluted Average Shares": [15 * BILLION]}, ["2025-09-30"]),
        info={"sharesOutstanding": 99 * BILLION},
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.diluted_shares_outstanding.value == pytest.approx(15.0)
    assert bridge.diluted_shares_outstanding.quality == "ok"
    assert bridge.diluted_shares_outstanding.source == BridgeSource.DILUTED_AVERAGE_SHARES


def test_diluted_shares_fall_back_to_shares_outstanding_at_estimated_quality():
    # sharesOutstanding is basic, not diluted, and the field promises diluted.
    bundle = _bundle(info={"sharesOutstanding": 15 * BILLION})
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.diluted_shares_outstanding.value == pytest.approx(15.0)
    assert bridge.diluted_shares_outstanding.quality == "estimated"
    assert bridge.diluted_shares_outstanding.source == BridgeSource.SHARES_OUTSTANDING


def test_a_ticker_with_nothing_stored_returns_three_missing_inputs():
    # Not None for the bridge itself: callers must never branch on two levels of absence.
    bridge = load_equity_bridge("TEST", bundle_loader=lambda ticker, endpoint: None)
    assert bridge.net_debt.quality == "missing"
    assert bridge.non_operating_assets.quality == "missing"
    assert bridge.diluted_shares_outstanding.quality == "missing"


def test_a_zero_value_is_data_not_absence():
    bundle = _bundle(
        balance=_frame(
            {"Total Debt": [0.0], "Cash And Cash Equivalents": [5 * BILLION]},
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(-5.0)
    assert bridge.net_debt.quality == "ok"


def test_every_emitted_source_is_a_bridge_source_member():
    # No free-form provenance string can reach the UI.
    bundle = _bundle(
        balance=_frame(
            {"Total Debt": [10 * BILLION], "Cash And Cash Equivalents": [5 * BILLION]},
            ["2025-09-30"],
        ),
        info={"sharesOutstanding": 2 * BILLION},
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    for meta in (bridge.net_debt, bridge.non_operating_assets, bridge.diluted_shares_outstanding):
        assert meta.source in set(BridgeSource)
