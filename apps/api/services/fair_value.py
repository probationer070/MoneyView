"""From a bare ticker to a stored fair-value case and its summary (spec 2026-10-26 §4-§5).

The I/O seam around `fair_value_case.build_fair_value_case`, as `company_baseline` is for the
conservative case. Every loader takes `bundle_loader`, so the whole path is testable offline.
"""

from __future__ import annotations

from datetime import date

from apps.api.services.acquisition.store import load_price_bars
from apps.api.services.company_baseline import (
    DEFAULT_MARGINAL_TAX_RATE,
    build_company_baseline,
    find_conservative_case_id,
)
from apps.api.services.corporate_metrics_service import metrics_for_ticker_with_provenance
from apps.api.services.corporate_statement_metrics import (
    DEFAULT_RISK_FREE_RATE,
    get_yahoo_statement_bundle,
    statement_baseline,
)
from apps.api.services.equity_bridge import load_equity_bridge
from apps.api.services.fair_value_case import (
    FairValueRefused,
    build_fair_value_case,
    company_revenue_cagr,
    fair_value_case_name,
    growth_for_revenue_target,
    implied_growth,
)
from apps.api.services.industry_benchmark_store import industry_row_for_ticker
from apps.api.services.valuation_case import CaseNotFound, create_case, list_cases, load_case, run_stored_case

_ENDPOINT = "fair_value"


def generate_fair_value_case_for_ticker(
    ticker: str,
    *,
    as_of: str | None = None,
    base_year: int | None = None,
    riskfree_rate: float = DEFAULT_RISK_FREE_RATE,
    marginal_tax_rate: float = DEFAULT_MARGINAL_TAX_RATE,
    bundle_loader=get_yahoo_statement_bundle,
) -> tuple[int | None, bool, str | None, str | None]:
    """`(case_id, created, vintage, None)` or `(None, False, None, reason)`.

    A case already stored under the same name is returned with `created=False`, so a repeat
    request is safe. Refusal reasons keep their prefix (spec §4).
    """
    ticker = ticker.upper()
    industry, vintage, reason = industry_row_for_ticker(ticker, as_of=as_of)
    if industry is None:
        return None, False, None, reason

    bundle = bundle_loader(ticker, _ENDPOINT)
    if bundle is None:
        return None, False, None, f"no_statements: {ticker} has no stored statement bundle"
    info = bundle.get("info") or {}
    reported, priced = str(info.get("financialCurrency") or ""), str(info.get("currency") or "")
    if reported and priced and reported != priced:
        return None, False, None, (
            f"currency_mismatch: {ticker} reports in {reported} and trades in {priced}; "
            f"a value per share would mix the two"
        )

    # Statements and their growth history first: with a single year of revenue the metrics
    # computation fails too, and "no growth history" is the cause, not "fallback metrics".
    statement_source = statement_baseline(ticker, bundle_loader=bundle_loader)
    if statement_source is None:
        return None, False, None, f"no_statements: {ticker} has no stored statement bundle"
    growth = company_revenue_cagr(statement_source.get("revenue_by_year") or {})
    if growth is None:
        return None, False, None, (
            f"no_growth_history: {ticker} needs two fiscal years of positive revenue for a growth rate"
        )
    metrics, real = metrics_for_ticker_with_provenance(ticker, bundle_loader=bundle_loader)
    if not real:
        return None, False, None, (
            f"default_metrics: {ticker}'s WACC is the generic fallback, not a measurement"
        )
    bridge = load_equity_bridge(ticker, bundle_loader=bundle_loader)
    baseline, reason = build_company_baseline(
        ticker, metrics=metrics, statement_source=statement_source,
        net_debt=bridge.net_debt.value, shares=bridge.diluted_shares_outstanding.value,
    )
    if baseline is None:
        return None, False, None, reason

    latest_year = baseline.source_years[-1]
    name = fair_value_case_name(ticker, vintage, latest_year)
    existing = next((c["id"] for c in list_cases() if c["case_name"] == name), None)
    if existing is not None:
        return existing, False, vintage, None
    try:
        payload = build_fair_value_case(
            ticker, baseline, industry, vintage=vintage, latest_year=latest_year,
            company_growth=growth, riskfree_rate=riskfree_rate, marginal_tax_rate=marginal_tax_rate,
            base_year=base_year if base_year is not None else date.today().year,
        )
        return create_case(payload), True, vintage, None
    except FairValueRefused as exc:
        return None, False, None, str(exc)
    except ValueError as exc:
        # An engine guard the generated inputs trip: a refusal, not a fault.
        return None, False, None, f"not_storable: {exc}"


def _value_per_share(case_id: int | None) -> float | None:
    if case_id is None:
        return None
    try:
        return run_stored_case(case_id)["value_per_share_diluted"]
    except (ValueError, CaseNotFound):
        return None


def fair_value_summary(ticker: str, case_id: int, *, created: bool, vintage: str) -> dict:
    """The spec §5 response for a stored fair-value case."""
    ticker = ticker.upper()
    value = _value_per_share(case_id)
    bars = [bar for bar in load_price_bars(ticker, limit=5) if bar.get("close")]
    price, price_date = (float(bars[-1]["close"]), str(bars[-1]["date"])[:10]) if bars else (None, None)
    gap = (value - price) / price * 100 if value is not None and price else None

    case = load_case(case_id)
    segment = case["segments"][0]
    # The model's own year 1-5 growth, and the one today's price implies on the same path with every
    # other input held: the disagreement Damodaran argues about, stated as one number each.
    growth = growth_for_revenue_target(segment["base_revenue"], segment["revenue_target"], case["riskfree_rate"])
    implied, implied_note = (implied_growth(case, price) if price else (None, "no_price: no stored close"))
    assumptions = [
        {"field": n["input_field"], "value": case.get(n["input_field"]), "claim": n["claim"]}
        for n in case.get("narratives", [])
    ] + [
        {"field": n["input_field"], "value": segment.get(n["input_field"]), "claim": n["claim"]}
        for n in segment.get("narratives", [])
    ]
    return {
        "ticker": ticker,
        "case_id": case_id,
        "created": created,
        "vintage": vintage,
        "value_per_share": value,
        "price": price,
        "price_date": price_date,
        "gap_pct": gap,
        "floor_value_per_share": _value_per_share(find_conservative_case_id(ticker)),
        "growth_1_5": growth,
        "implied_growth_1_5": implied,
        "implied_growth_note": implied_note,
        "assumptions": assumptions,
    }
