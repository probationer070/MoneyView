"""Read and write the local statement and quote-fact stores.

`load_statement_bundle` rebuilds exactly the dict shape the metric layer already consumes,
so moving statements onto disk changes no metric code.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pandas as pd

from apps.api.services.acquisition.sources.quote_facts import QuoteFacts
from apps.api.services.acquisition.sources.statements import StatementRow
from apps.api.services.db import get_db

_BUNDLE_KEYS: tuple[tuple[str, str, str], ...] = (
    ("income", "income", "annual"),
    ("balance", "balance", "annual"),
    ("cashflow", "cashflow", "annual"),
    ("quarterly_income", "income", "quarterly"),
    ("quarterly_balance", "balance", "quarterly"),
    ("quarterly_cashflow", "cashflow", "quarterly"),
)


def statement_coverage(rows: list[StatementRow]) -> tuple[date, date]:
    periods = sorted(date.fromisoformat(row.period_end) for row in rows)
    return periods[0], periods[-1]


def save_statements(ticker: str, rows: list[StatementRow]) -> None:
    # The subject is the authority, not row.ticker: acquisition_state is keyed by subject,
    # and load_statement_bundle normalises the same way. If the two disagreed, rows would be
    # stored under a key that can never be read back while the state table said OK.
    ticker = ticker.upper()
    fetched_at = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.executemany(
            """INSERT OR REPLACE INTO corporate_statements
                   (ticker, statement_type, frequency, period_end, line_item, value, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (ticker, row.statement_type, row.frequency, row.period_end,
                 row.line_item, row.value, fetched_at)
                for row in rows
            ],
        )


def save_quote_facts(ticker: str, facts: QuoteFacts) -> None:
    ticker = ticker.upper()
    with get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_quote_facts
                   (ticker, market_cap, shares_outstanding, currency, fetched_at)
               VALUES (?, ?, ?, ?, ?)""",
            (ticker, facts.market_cap, facts.shares_outstanding, facts.currency,
             datetime.now(timezone.utc).isoformat()),
        )


def _frame(rows: list, statement_type: str, frequency: str) -> pd.DataFrame:
    selected = [row for row in rows if row["statement_type"] == statement_type
                and row["frequency"] == frequency]
    if not selected:
        return pd.DataFrame()
    # Newest period first: metric code reads column 0 as the latest period.
    periods = sorted({row["period_end"] for row in selected}, reverse=True)
    line_items = sorted({row["line_item"] for row in selected})
    values = {
        period: [
            next((row["value"] for row in selected
                  if row["line_item"] == item and row["period_end"] == period), None)
            for item in line_items
        ]
        for period in periods
    }
    return pd.DataFrame(values, index=line_items)


def load_statement_bundle(ticker: str) -> dict[str, object] | None:
    ticker = ticker.upper()
    with get_db() as conn:
        rows = conn.execute(
            """SELECT statement_type, frequency, period_end, line_item, value, fetched_at
               FROM corporate_statements WHERE ticker = ?""",
            (ticker,),
        ).fetchall()
        facts = conn.execute(
            "SELECT market_cap, shares_outstanding, currency FROM corporate_quote_facts WHERE ticker = ?",
            (ticker,),
        ).fetchone()

    if not rows:
        return None

    bundle: dict[str, object] = {"ticker": ticker}
    for key, statement_type, frequency in _BUNDLE_KEYS:
        bundle[key] = _frame(rows, statement_type, frequency)
    bundle["info"] = {
        "marketCap": facts["market_cap"] if facts else None,
        "sharesOutstanding": facts["shares_outstanding"] if facts else None,
        "currency": facts["currency"] if facts else "",
    }
    bundle["fetched_at"] = datetime.fromisoformat(rows[0]["fetched_at"])
    return bundle
