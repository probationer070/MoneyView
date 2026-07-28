from types import SimpleNamespace

import pandas as pd
import pytest

from apps.api.services.acquisition.sources.statements import StatementRow, fetch_statements


def _frame(rows: dict[str, list[float | None]], periods: list[str]) -> pd.DataFrame:
    return pd.DataFrame(rows, index=periods).T


def _fake_ticker(**frames):
    empty = pd.DataFrame()
    return SimpleNamespace(
        financials=frames.get("financials", empty),
        balance_sheet=frames.get("balance_sheet", empty),
        cashflow=frames.get("cashflow", empty),
        quarterly_financials=frames.get("quarterly_financials", empty),
        quarterly_balance_sheet=frames.get("quarterly_balance_sheet", empty),
        quarterly_cashflow=frames.get("quarterly_cashflow", empty),
    )


def test_annual_income_rows_carry_type_frequency_and_period():
    frame = _frame({"Total Revenue": [100.0, 90.0]}, ["2025-09-30", "2024-09-30"])
    rows = fetch_statements("AAPL", ticker_factory=lambda _: _fake_ticker(financials=frame))

    assert StatementRow("AAPL", "income", "annual", "2025-09-30", "Total Revenue", 100.0) in rows
    assert StatementRow("AAPL", "income", "annual", "2024-09-30", "Total Revenue", 90.0) in rows


def test_quarterly_frames_are_tagged_quarterly():
    frame = _frame({"Total Revenue": [25.0]}, ["2026-06-30"])
    rows = fetch_statements("AAPL", ticker_factory=lambda _: _fake_ticker(quarterly_financials=frame))

    assert [row.frequency for row in rows] == ["quarterly"]


def test_missing_values_are_none_not_zero():
    """A line item the provider did not report is unknown, not zero. Storing 0.0 would
    feed a real number into a formula that should have reported missing input."""
    frame = _frame({"Total Revenue": [float("nan")]}, ["2025-09-30"])
    rows = fetch_statements("AAPL", ticker_factory=lambda _: _fake_ticker(financials=frame))

    assert [row.value for row in rows] == [None]


def test_an_empty_balance_sheet_yields_no_rows_and_does_not_raise():
    """ETFs return an entirely empty balance sheet -- SPY does. That is a normal case."""
    rows = fetch_statements("SPY", ticker_factory=lambda _: _fake_ticker())

    assert rows == []


def test_all_six_frames_are_read():
    frame = _frame({"Line": [1.0]}, ["2025-12-31"])
    rows = fetch_statements(
        "AAPL",
        ticker_factory=lambda _: _fake_ticker(
            financials=frame, balance_sheet=frame, cashflow=frame,
            quarterly_financials=frame, quarterly_balance_sheet=frame, quarterly_cashflow=frame,
        ),
    )

    assert {(row.statement_type, row.frequency) for row in rows} == {
        ("income", "annual"), ("balance", "annual"), ("cashflow", "annual"),
        ("income", "quarterly"), ("balance", "quarterly"), ("cashflow", "quarterly"),
    }


def test_a_frame_that_raises_a_provider_error_is_skipped_not_fatal():
    """A malformed payload from one frame costs that frame, not the whole ticker."""
    good = _frame({"Total Revenue": [100.0]}, ["2025-09-30"])

    class PartlyBroken:
        financials = good
        balance_sheet = pd.DataFrame()
        cashflow = pd.DataFrame()
        quarterly_financials = pd.DataFrame()
        quarterly_balance_sheet = pd.DataFrame()

        @property
        def quarterly_cashflow(self):
            raise KeyError("provider returned a malformed payload")

    rows = fetch_statements("AAPL", ticker_factory=lambda _: PartlyBroken())

    assert [row.line_item for row in rows] == ["Total Revenue"]


def test_an_unexpected_error_is_not_swallowed():
    """An error outside the provider-shaped tuple is our bug. Swallowing it turns a real
    defect into a FAILED acquisition status, and because failure advances last_checked_at
    that becomes a silent seven-day data gap under the Weekly boundary."""

    class Bug:
        @property
        def financials(self):
            raise RuntimeError("a real bug in our code, not a provider payload")

    with pytest.raises(RuntimeError):
        fetch_statements("AAPL", ticker_factory=lambda _: Bug())
