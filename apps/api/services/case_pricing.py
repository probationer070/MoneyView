"""A case priced by its industry's EV/Sales, beside its own DCF (C2's `/pricing`).

The question it answers: does this DCF agree with what the market pays for the case's
industry? The verdict panel cannot answer that. It works per listed ticker and against
the market price, whereas this works per case, from the case's own base revenue, so it
holds for a private company that has no price.

EV/Sales is the one multiple a case can use without extra inputs: every case states its
base-year revenue, and Damodaran publishes EV/Sales for every industry. Both are trailing
figures, so they describe the same period. The comparison is a ratio with no horizon,
the same kind of number as the verdict panel's `dcf_gap`.
"""
from __future__ import annotations

from apps.api.services.industry_benchmark_store import industry_row_for_ticker
from apps.api.services.valuation_case import load_case, run_stored_case
from packages.core_finance.industry_benchmark import column_by_key, screen_row, screen_value

_EV_SALES = column_by_key("ev_sales")


class PricingRefused(Exception):
    """A case that cannot be priced. The message carries a machine-readable prefix."""


def price_case(case_id: int) -> dict:
    """Implied EV at the industry's EV/Sales, the DCF's EV, and the gap between them.

    Raises CaseNotFound, or PricingRefused with a prefix: `no_ticker`, `no_vintage`,
    `no_industry`, `unmapped_industry`, `thin_industry`, `no_ev_sales`,
    `no_base_revenue`, `unrunnable_case`.
    """
    case = load_case(case_id)
    ticker = (case.get("ticker") or "").strip()
    if not ticker:
        raise PricingRefused(
            "no_ticker: this case has no ticker, so no industry can be found for it"
        )

    row, vintage, reason = industry_row_for_ticker(ticker, as_of=case["as_of_date"])
    if row is None:
        raise PricingRefused(reason)
    thin = screen_row(row)
    if thin is not None:
        raise PricingRefused(f"thin_industry: {thin}")
    ev_sales = row.values.get("ev_sales")
    unusable = screen_value(_EV_SALES, ev_sales)
    if unusable is not None:
        raise PricingRefused(f"no_ev_sales: {row.name}: {unusable}")

    base_revenue = sum(
        float(segment["base_revenue"])
        for segment in case["segments"]
        if segment.get("base_revenue") is not None
    )
    if base_revenue <= 0:
        raise PricingRefused(
            "no_base_revenue: the case's segments state no positive base revenue to price"
        )

    try:
        dcf_ev = float(run_stored_case(case_id)["enterprise_value"])
    except ValueError as exc:
        raise PricingRefused(f"unrunnable_case: {exc}") from exc

    implied_ev = float(ev_sales) * base_revenue
    return {
        "case_id": case_id,
        "basis": "ev_sales",
        "vintage": vintage,
        "industry": row.name,
        "industry_firms": row.firms,
        "ev_sales": float(ev_sales),
        "base_revenue_total": base_revenue,
        "implied_enterprise_value": implied_ev,
        "dcf_enterprise_value": dcf_ev,
        "dcf_to_implied": dcf_ev / implied_ev - 1,
        "source": (
            f"Damodaran {vintage} '{row.name}' EV/Sales {float(ev_sales):.2f} "
            f"({row.firms} firms) x base-year revenue {base_revenue:,.1f}"
        ),
    }
