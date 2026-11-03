"""The company's own figures at its industry's multiples, per share (spec 2026-11-01 §12).

Read-only: nothing is written and nothing is acquired. Every loader is injected so the whole
path runs offline; the defaults read the local store.

Multiples come from the company's own Damodaran industry, never a sector basket. A financial
company is valued on P/E and P/B only, because for a bank the debt is its raw material, not a
claim to subtract (EV/Sales would be meaningless there).

The P/E row is keyed "trailing_pe" (the frontend contract) but reads the AGGREGATE multiple,
`aggregate_pe` (market cap over net income of money-making firms). Damodaran's "Trailing PE"
column is a simple average of firm PEs, which runs 2-3x the aggregate multiple (Computers 81
against 34), so applying it to one company's EPS would overstate the value.
"""

from __future__ import annotations

import pandas as pd

from apps.api.services.acquisition.store import load_price_bars
from apps.api.services.corporate_statement_metrics import (
    EQUITY_LABELS,
    REVENUE_LABELS,
    get_yahoo_statement_bundle,
    statement_currency_mismatch,
)
from apps.api.services.db import get_db
from apps.api.services.equity_bridge import load_equity_bridge
from apps.api.services.industry_benchmark_store import industry_row_for_ticker
from packages.core_finance.industry_benchmark import column_by_key, screen_row, screen_value
from packages.core_finance.relative_pricing import (
    ev_sales_value_per_share,
    pb_value_per_share,
    pe_value_per_share,
    value_range,
)

_BILLION = 1_000_000_000.0
_EPS_LABELS = ("Diluted EPS",)
_FINANCIAL_SECTOR = "Financial Services"


class RelativePricingRefused(Exception):
    """A ticker that cannot be priced against its industry. The message carries a code prefix."""


def _stored_sector(ticker: str) -> str:
    with get_db() as conn:
        row = conn.execute(
            "SELECT sector FROM corporate_quote_facts WHERE ticker = ?", (ticker.upper(),)
        ).fetchone()
    return (row["sector"] or "") if row else ""


def _latest_annual(frame, labels: tuple[str, ...]) -> float | None:
    """The newest annual figure for the first label that reports one, or None.

    NaN padding is dropped before choosing the newest period, so a line that stopped reporting
    early does not hide an older figure that is still the latest one available.
    """
    if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
        return None
    for label in labels:
        if label not in frame.index:
            continue
        series = frame.loc[label].dropna()
        if series.empty:
            continue
        return float(series[max(series.index)])
    return None


def _scaled(value: float | None) -> float | None:
    return None if value is None else value / _BILLION


def _refuse_row(row: dict, reason: str) -> dict:
    row["refusal"] = reason
    return row


def _basis_row(basis: str, industry, figures: dict, price: float) -> dict:
    """One multiple applied to the company's own figure. Refusals are per row, never whole-ticker."""
    # The P/E row keeps the "trailing_pe" basis key but reads the aggregate multiple; see module doc.
    source = "aggregate_pe" if basis == "trailing_pe" else basis
    multiple = industry.values.get(source)
    row = {
        "basis": basis,
        "industry_multiple": multiple,
        "company_figure": None,
        "value_per_share": None,
        "gap_pct": None,
        "refusal": None,
    }
    unusable = screen_value(column_by_key(source), multiple)
    if unusable is not None:
        return _refuse_row(row, f"no_multiple: {unusable}")

    shares = figures["shares"]
    if basis == "ev_sales":
        revenue = figures["revenue"]
        row["company_figure"] = revenue
        if revenue is None:
            return _refuse_row(row, "no_revenue: no annual revenue is stored for this ticker")
        net_debt = figures["net_debt"]
        if net_debt is None:
            return _refuse_row(row, "no_net_debt: the equity bridge has no net debt figure")
        if shares is None or shares <= 0:
            return _refuse_row(row, "no_shares: the equity bridge has no positive diluted share count")
        value = ev_sales_value_per_share(multiple, revenue, net_debt, shares)
        if value <= 0:
            return _refuse_row(
                row,
                f"non_positive_value: at {multiple:.2f}x EV/Sales the enterprise value does not "
                f"cover net debt of {net_debt:.2f}bn, leaving {value:.2f} per share",
            )
    elif basis == "trailing_pe":
        eps = figures["eps"]
        row["company_figure"] = eps
        if eps is None:
            return _refuse_row(row, "no_earnings: no annual diluted EPS is stored for this ticker")
        if eps <= 0:
            return _refuse_row(
                row,
                f"no_positive_earnings: the latest annual diluted EPS is {eps:.2f}, not positive; "
                f"an older profitable year is not used",
            )
        value = pe_value_per_share(multiple, eps)
    else:  # price_to_book
        equity = figures["equity"]
        row["company_figure"] = equity
        if equity is None:
            return _refuse_row(row, "no_book: no annual stockholders' equity is stored for this ticker")
        if equity <= 0:
            return _refuse_row(
                row,
                f"no_positive_book: the latest annual book equity is {equity:.2f}bn, not positive",
            )
        if shares is None or shares <= 0:
            return _refuse_row(row, "no_shares: the equity bridge has no positive diluted share count")
        value = pb_value_per_share(multiple, equity, shares)

    row["value_per_share"] = value
    row["gap_pct"] = (value - price) / price * 100
    return row


def relative_pricing(
    ticker: str,
    *,
    bundle_loader=get_yahoo_statement_bundle,
    bridge_loader=load_equity_bridge,
    industry_loader=industry_row_for_ticker,
    price_loader=load_price_bars,
    sector_loader=_stored_sector,
    currency_check=statement_currency_mismatch,
) -> dict:
    """Value per share at the company's own industry multiples, beside the latest stored close.

    Raises RelativePricingRefused with a prefix: `currency_mismatch`, `no_vintage`, `no_industry`,
    `unmapped_industry`, `thin_industry`, `no_price`. A row that cannot be valued carries its own
    refusal instead of failing the whole response.
    """
    ticker = ticker.upper()
    reason = currency_check(ticker)
    if reason:
        raise RelativePricingRefused(f"currency_mismatch: {reason}")

    industry, vintage, reason = industry_loader(ticker)
    if industry is None:
        raise RelativePricingRefused(reason)
    thin = screen_row(industry)
    if thin is not None:
        raise RelativePricingRefused(f"thin_industry: {thin}")

    # A zero close is not a price: the gap below divides by it.
    bars = [bar for bar in price_loader(ticker, limit=5) if bar.get("close") is not None and float(bar["close"]) > 0]
    if not bars:
        raise RelativePricingRefused(f"no_price: no stored close for {ticker}")
    price = float(bars[-1]["close"])
    price_date = str(bars[-1]["date"])[:10]

    financial = sector_loader(ticker) == _FINANCIAL_SECTOR
    bases = ("trailing_pe", "price_to_book") if financial else ("ev_sales", "trailing_pe")

    bundle = bundle_loader(ticker, "relative_pricing") or {}
    income, balance = bundle.get("income"), bundle.get("balance")
    bridge = bridge_loader(ticker, bundle_loader=bundle_loader)
    figures = {
        "revenue": _scaled(_latest_annual(income, REVENUE_LABELS)),
        "eps": _latest_annual(income, _EPS_LABELS),
        "equity": _scaled(_latest_annual(balance, EQUITY_LABELS)),
        "net_debt": bridge.net_debt.value,
        "shares": bridge.diluted_shares_outstanding.value,
    }

    rows = [_basis_row(basis, industry, figures, price) for basis in bases]
    valued = [row["value_per_share"] for row in rows if row["value_per_share"] is not None]
    return {
        "ticker": ticker,
        "vintage": vintage,
        "industry": industry.name,
        "industry_firms": industry.firms,
        "financial": financial,
        "price": price,
        "price_date": price_date,
        "rows": rows,
        "range": value_range(valued),
    }
