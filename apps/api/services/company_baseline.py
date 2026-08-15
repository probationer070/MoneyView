"""Build a CompanyBaseline for one ticker, and generate its conservative case.

The adapter the final whole-branch review found missing: without it,
`build_conservative_case` had no caller and the feature had no entry point.

THIS FILE OWNS THE UNITS BOUNDARY. Everywhere else in the feature, rates are
fractions and money is billions, matching both the segment engine and
Damodaran's dataset. Two conversions happen here and nowhere else:

    statement currency -> billions   (revenue, and the equity-bridge terms)
    CorporateMetrics percent -> fraction   (roic, wacc, growth)

`base_margin` and `current_sales_to_capital` are ratios of two raw-currency
figures and are therefore already dimensionless. Scaling them would be a
1e9 error that no downstream guard would catch, because both would still be
plausible floats.

Every missing input refuses with a reason. A baseline built on a substituted
zero produces a confident valuation from data that does not exist.
"""

from __future__ import annotations

from apps.api.services.conservative_case import CompanyBaseline, build_conservative_case
from apps.api.services.industry_benchmark_store import resolve_for_ticker
from apps.api.services.valuation_case import create_case

_BILLION = 1_000_000_000.0


def build_company_baseline(
    ticker: str,
    *,
    metrics,
    statement_source: dict,
    net_debt: float | None,
    shares: float | None,
) -> tuple[CompanyBaseline | None, str | None]:
    """Assemble a baseline, or refuse with a reason. Exactly one is non-None.

    `statement_source` is the raw-currency dict `statement_baseline` returns,
    taken as an argument rather than fetched so the unit conversion is testable
    with no bundle, no database and no network.
    """
    revenue = statement_source.get("revenue_by_year") or {}
    operating_income = statement_source.get("operating_income_by_year") or {}
    invested_capital = statement_source.get("invested_capital_by_year") or {}

    # Each series is checked on its own before they are intersected, so an
    # absent series is named for what it is. Intersecting first would report
    # every absence as "no_revenue" and send the reader to the wrong statement.
    if not revenue:
        return None, f"no_revenue: {ticker} has no usable revenue in its stored statements"
    if not operating_income:
        return None, f"no_operating_income: {ticker} has no operating income in its stored statements"
    if not invested_capital:
        return None, f"no_invested_capital: {ticker} has no invested capital in its stored statements"

    years = sorted(set(revenue) & set(operating_income) & set(invested_capital))
    if not years:
        # A margin taken from one year over a revenue from another measures
        # nothing, so there is no year to anchor a baseline on.
        return None, (
            f"no_shared_year: {ticker} has revenue in {sorted(revenue)}, operating "
            f"income in {sorted(operating_income)} and invested capital in "
            f"{sorted(invested_capital)}, with no year common to all three"
        )

    latest = years[-1]
    latest_revenue = float(revenue[latest])
    if latest_revenue <= 0:
        return None, (
            f"no_revenue: {ticker}'s FY{latest} revenue is {latest_revenue}, "
            f"which cannot anchor a growth path"
        )
    latest_capital = float(invested_capital[latest])
    if latest_capital <= 0:
        return None, f"no_invested_capital: {ticker}'s FY{latest} invested capital is {latest_capital}"

    if shares is None or shares <= 0:
        return None, f"no_shares: {ticker} has no diluted share count in its statements"
    if net_debt is None:
        # A missing balance is not a zero balance -- the argument in
        # `calculate_net_debt`'s docstring in dcf.py.
        return None, f"no_net_debt: {ticker}'s net debt is unknown, not zero"

    return CompanyBaseline(
        base_revenue=latest_revenue / _BILLION,
        # Dimensionless: a ratio of two raw-currency figures. NOT scaled.
        base_margin=float(operating_income[latest]) / latest_revenue,
        current_roic=float(metrics.roic) / 100.0,
        # Dimensionless for the same reason. NOT scaled.
        current_sales_to_capital=latest_revenue / latest_capital,
        current_growth=float(metrics.growth) / 100.0,
        current_wacc=float(metrics.wacc) / 100.0,
        # `net_debt` already arrives in billions from `load_equity_bridge`,
        # which scales through `equity_bridge._scaled`. One convention, one
        # place: do not divide again here.
        cash=max(-float(net_debt), 0.0),
        debt=max(float(net_debt), 0.0),
        shares=float(shares),
        source_years=tuple(years),
    ), None


def generate_conservative_case(
    ticker: str,
    *,
    as_of: str | None = None,
    base_year: int,
    riskfree_rate: float,
    marginal_tax_rate: float,
    metrics,
    statement_source: dict | None,
    net_debt: float | None,
    shares: float | None,
) -> tuple[int | None, str | None]:
    """Resolve, build, and store a conservative case. Exactly one is non-None.

    Dependencies are injected rather than fetched so this is testable without a
    network. The caller wires `statement_baseline` and `load_equity_bridge`.
    """
    benchmark, vintage, reason = resolve_for_ticker(ticker, as_of=as_of)
    if benchmark is None:
        return None, reason
    if statement_source is None:
        return None, f"no_statements: {ticker} has no stored statement bundle"

    baseline, reason = build_company_baseline(
        ticker, metrics=metrics, statement_source=statement_source,
        net_debt=net_debt, shares=shares,
    )
    if baseline is None:
        return None, reason

    payload = build_conservative_case(
        ticker, baseline, benchmark, vintage=vintage,
        riskfree_rate=riskfree_rate, marginal_tax_rate=marginal_tax_rate,
        base_year=base_year,
    )
    try:
        return create_case(payload), None
    except ValueError as exc:
        # Covers both a duplicate case_name and any engine guard the generated
        # inputs trip. Both are legitimate refusals, not faults.
        return None, f"not_storable: {exc}"
