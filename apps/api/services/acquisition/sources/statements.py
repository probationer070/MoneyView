"""Fetch company statements and flatten them into normalised rows.

The provider handle is injected so this is testable without a network. Six frames arrive
as pandas DataFrames indexed by line item with period-end columns; they leave as one row
per line item per period, which is what the store holds.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import pandas as pd

_FRAMES: tuple[tuple[str, str, str], ...] = (
    ("financials", "income", "annual"),
    ("balance_sheet", "balance", "annual"),
    ("cashflow", "cashflow", "annual"),
    ("quarterly_financials", "income", "quarterly"),
    ("quarterly_balance_sheet", "balance", "quarterly"),
    ("quarterly_cashflow", "cashflow", "quarterly"),
)


@dataclass(frozen=True)
class StatementRow:
    ticker: str
    statement_type: str
    frequency: str
    period_end: str
    line_item: str
    value: float | None


def _default_ticker_factory(symbol: str):
    import yfinance as yf

    return yf.Ticker(symbol)


def _period_key(column) -> str:
    return str(getattr(column, "date", lambda: column)())[:10]


def fetch_statements(
    ticker: str,
    *,
    ticker_factory: Callable[[str], object] | None = None,
) -> list[StatementRow]:
    handle = (ticker_factory or _default_ticker_factory)(ticker)
    rows: list[StatementRow] = []

    for attribute, statement_type, frequency in _FRAMES:
        try:
            frame = getattr(handle, attribute, None)
        except (AttributeError, KeyError, TypeError, ValueError):
            # A malformed provider payload costs us one frame, not the ticker. Anything
            # outside this tuple is our bug, and must reach the caller as an exception --
            # a swallowed bug becomes a FAILED status and a silent seven-day data gap.
            continue
        if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
            continue
        for column in frame.columns:
            period_end = _period_key(column)
            for line_item, value in frame[column].items():
                # NaN means the provider did not report the line item. Storing 0.0 would
                # hand a real number to a formula that should report a missing input.
                rows.append(
                    StatementRow(
                        ticker=ticker,
                        statement_type=statement_type,
                        frequency=frequency,
                        period_end=period_end,
                        line_item=str(line_item),
                        value=None if pd.isna(value) else float(value),
                    )
                )
    return rows
