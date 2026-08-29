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

from datetime import date

from apps.api.services.conservative_case import (
    CompanyBaseline,
    build_conservative_case,
    conservative_case_name,
)
from apps.api.services.corporate_metrics_service import metrics_for_ticker
from apps.api.services.corporate_statement_metrics import (
    DEFAULT_RISK_FREE_RATE,
    get_yahoo_statement_bundle,
    statement_baseline,
)
from apps.api.services.equity_bridge import load_equity_bridge
from apps.api.services.industry_benchmark_store import latest_vintage, resolve_for_ticker
from apps.api.services.valuation_case import create_case, list_cases

_BILLION = 1_000_000_000.0

# `Input sheet!B24` in both of Damodaran's SpaceX workbooks, and what the two
# seeded reference cases use. A jurisdiction constant, not a company one -- the
# industry benchmark supplies the EFFECTIVE rate, which the engine ramps toward
# this.
DEFAULT_MARGINAL_TAX_RATE = 0.25


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


def generate_conservative_case_for_ticker(
    ticker: str,
    *,
    as_of: str | None = None,
    base_year: int | None = None,
    riskfree_rate: float = DEFAULT_RISK_FREE_RATE,
    marginal_tax_rate: float = DEFAULT_MARGINAL_TAX_RATE,
    bundle_loader=get_yahoo_statement_bundle,
) -> tuple[int | None, str | None]:
    """One call from a bare ticker to a stored conservative case.

    The seam between `generate_conservative_case`, which takes its four inputs
    injected so it can be tested without I/O, and a caller that only has a
    ticker. Assembles those four and delegates; every refusal reason comes back
    unchanged from the layer that raised it.

    `bundle_loader` threads through all three loaders, so a single injection
    makes the whole path offline-testable. Note what does NOT catch a missed
    injection: the default `get_yahoo_statement_bundle` reads the local store
    and never opens a socket, so `tests/conftest.py`'s network guard cannot see
    one. Worse, `metrics_for_ticker` does not refuse on a miss -- it falls back
    through `load_fallback_metrics` to a generic `default_metrics` -- so a
    dropped wire there still produces a stored, runnable case, silently
    computed against defaults. The endpoint assertion in
    `test_the_ticker_wrapper_produces_a_stored_runnable_case` is what catches
    it. `load_equity_bridge` and `statement_baseline` both hard-refuse, so only
    the metrics wire is invisible.

    `base_year` defaults to the current calendar year. It sets the case's
    10-year horizon and appears in `as_of_date`, so pin it explicitly wherever
    reproducibility across a year boundary matters. Note that `case_name` is
    `conservative_<TICKER>_<vintage>` and is NOT keyed by `base_year`, so
    calling this either side of a year boundary for the same ticker and vintage
    does not produce two cases -- the second refuses with
    `not_storable: ... already exists`. That is a safe failure, but it is a
    refusal rather than the differing case the horizon change would imply.
    """
    metrics = metrics_for_ticker(ticker, bundle_loader=bundle_loader)
    bridge = load_equity_bridge(ticker, bundle_loader=bundle_loader)

    return generate_conservative_case(
        ticker,
        as_of=as_of,
        base_year=base_year if base_year is not None else date.today().year,
        riskfree_rate=riskfree_rate,
        marginal_tax_rate=marginal_tax_rate,
        metrics=metrics,
        statement_source=statement_baseline(ticker, bundle_loader=bundle_loader),
        net_debt=bridge.net_debt.value,
        shares=bridge.diluted_shares_outstanding.value,
    )


def find_conservative_case_id(ticker: str, *, as_of: str | None = None) -> int | None:
    """The id of `ticker`'s already-stored conservative case, or None.

    Exists so a repeat request can return the existing case instead of the
    duplicate-name refusal `create_case` would raise. It resolves the vintage
    the same way the generator does, so the two always agree about which case
    is "the" conservative case for a ticker.
    """
    vintage = latest_vintage(as_of)
    if vintage is None:
        return None
    wanted = conservative_case_name(ticker, vintage)
    return next(
        (case["id"] for case in list_cases() if case["case_name"] == wanted), None
    )
