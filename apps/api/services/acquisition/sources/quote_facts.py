"""Fetch quote-derived facts: market cap, shares outstanding, currency.

A separate data class from statements because the frequencies differ -- a filing is
quarterly, a market cap moves with the market.

Market cap is acquired, never derived from price x shares outstanding. Measured on
2026-07-28, the balance-sheet share count is absent for ETFs, historical rather than
current, aggregates share classes (GOOGL 2.06x, BRK-B ~972x), and counts ordinary shares
rather than ADRs (TSM 5.0x). It fails silently with plausible numbers.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class QuoteFacts:
    ticker: str
    market_cap: float | None
    shares_outstanding: float | None
    currency: str
    # WACC's levered beta reads this; without it the cost of equity silently falls back to
    # a beta re-derived from the fallback metrics' unlevered beta.
    beta: float | None = None
    sector: str = ""
    industry: str = ""


def _default_ticker_factory(symbol: str):
    import yfinance as yf

    return yf.Ticker(symbol)


def _optional_float(raw) -> float | None:
    # A missing figure must stay missing: 0.0 would be a real number to a WACC weight.
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def fetch_quote_facts(
    ticker: str,
    *,
    ticker_factory: Callable[[str], object] | None = None,
) -> QuoteFacts | None:
    handle = (ticker_factory or _default_ticker_factory)(ticker)
    try:
        info = handle.info or {}
    except (AttributeError, KeyError, TypeError, ValueError):
        return None

    market_cap = _optional_float(info.get("marketCap"))
    shares_outstanding = _optional_float(info.get("sharesOutstanding"))
    if market_cap is None and shares_outstanding is None:
        return None

    return QuoteFacts(
        ticker=ticker,
        market_cap=market_cap,
        shares_outstanding=shares_outstanding,
        currency=str(info.get("currency") or ""),
        beta=_optional_float(info.get("beta")),
        sector=str(info.get("sector") or ""),
        industry=str(info.get("industry") or ""),
    )
