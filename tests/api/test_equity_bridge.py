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
