"""Read and write the local statement and quote-fact stores.

`load_statement_bundle` rebuilds exactly the dict shape the metric layer already consumes,
so moving statements onto disk changes no metric code.
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone

import pandas as pd

from apps.api.models.schemas import NewsArticle
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
                   (ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (ticker, facts.market_cap, facts.shares_outstanding, facts.currency, facts.beta,
             facts.sector, facts.industry, datetime.now(timezone.utc).isoformat()),
        )


def news_coverage(articles: list[NewsArticle]) -> tuple[date, date]:
    published = []
    for article in articles:
        if not article.published_date:
            continue
        try:
            published.append(date.fromisoformat(article.published_date))
        except ValueError:
            # A provider date we cannot parse is not a date. Guessing one would put a
            # fabricated range into the coverage record.
            continue
    if not published:
        today = datetime.now(timezone.utc).date()
        return today, today
    return min(published), max(published)


def save_news(ticker: str, articles: list[NewsArticle]) -> None:
    # Same rule as save_statements: the subject parameter is authoritative, not
    # article.ticker. acquisition_state is keyed by subject and the bulk read upper-cases,
    # so a disagreement stores rows nobody can read while the state table reports OK.
    ticker = ticker.upper()
    with get_db() as conn:
        conn.executemany(
            """INSERT OR IGNORE INTO news
                   (ticker, headline, url, source, published_date, sentiment, importance, hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    ticker,
                    article.headline,
                    article.url,
                    article.source,
                    article.published_date,
                    article.sentiment.value,
                    article.importance,
                    hashlib.md5(f"{article.headline}{article.url}".encode()).hexdigest(),
                )
                for article in articles
            ],
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
    frame = pd.DataFrame(values, index=line_items)
    # Columns must be Timestamps, not the TEXT period_end SQLite hands back. The metric
    # layer reads the period off the column label with getattr(col, "year", 0), so a str
    # column silently yields year 0, every row is dropped as pre-2000, and every
    # statement-derived metric falls back while the audit still claims Yahoo provenance.
    frame.columns = pd.to_datetime(frame.columns)
    return frame


def load_statement_bundle(ticker: str) -> dict[str, object] | None:
    ticker = ticker.upper()
    with get_db() as conn:
        rows = conn.execute(
            """SELECT statement_type, frequency, period_end, line_item, value, fetched_at
               FROM corporate_statements WHERE ticker = ?""",
            (ticker,),
        ).fetchall()
        facts = conn.execute(
            "SELECT market_cap, shares_outstanding, currency, beta FROM corporate_quote_facts WHERE ticker = ?",
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
        "beta": facts["beta"] if facts else None,
    }
    # The newest write, not whatever row SQLite happened to return first: the query has
    # no ORDER BY, so rows[0] was arbitrary and the reported age could be any of them.
    bundle["fetched_at"] = max(datetime.fromisoformat(row["fetched_at"]) for row in rows)
    return bundle
