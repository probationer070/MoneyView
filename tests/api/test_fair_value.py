"""Ticker -> stored fair-value case -> summary, and the route (spec 2026-10-26 §4-§5).

Each docstring names the mutation its test catches. The bundle is injected, so no network is reached.
"""

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services import fair_value
from apps.api.services.db import get_db
from apps.api.services.fair_value import fair_value_summary, generate_fair_value_case_for_ticker
from apps.api.services.industry_benchmark_store import store_vintage
from apps.api.services.valuation_case import load_case, run_stored_case
from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

client = TestClient(app)


def _bundle(revenue=None, info=None):
    revenue = revenue or {2023: 80e9, 2024: 90e9, 2025: 100e9}
    years = sorted(revenue)
    idx = [pd.Timestamp(f"{y}-12-31") for y in years]

    def frame(rows):
        return pd.DataFrame(rows, index=idx).T

    return {
        "income": frame({"Total Revenue": [revenue[y] for y in years],
                         "Operating Income": [revenue[y] * 0.3 for y in years]}),
        "balance": frame({"Stockholders Equity": [28e9 for _ in years],
                          "Total Debt": [6e9 for _ in years],
                          "Cash And Cash Equivalents": [1e9 for _ in years],
                          "Diluted Average Shares": [1e9 for _ in years]}),
        "cashflow": frame({"Free Cash Flow": [1.0 for _ in years]}),
        "quarterly_income": frame({"Total Revenue": [revenue[y] for y in years]}),
        "quarterly_balance": frame({"Stockholders Equity": [28e9 for _ in years]}),
        "quarterly_cashflow": frame({"Free Cash Flow": [1.0 for _ in years]}),
        "info": info if info is not None else
        {"marketCap": 200e9, "sharesOutstanding": 1e9, "currency": "USD", "financialCurrency": "USD"},
    }


@pytest.fixture
def seeded():
    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES ('FAIR', 1.0, 1.0, 'USD', 1.0, 'Technology', 'Semiconductors', '2026-01-01')"
        )
        conn.execute("INSERT INTO stocks (ticker, date, close) VALUES ('FAIR', '2026-10-23', 150.0)")


def _generate(bundle=None):
    payload = bundle or _bundle()
    return generate_fair_value_case_for_ticker("FAIR", base_year=2026, bundle_loader=lambda t, e: payload)


def test_a_ticker_becomes_a_stored_runnable_fair_value_case_once(seeded):
    """Catches the case not stored, not runnable, or stored again on a repeat request."""
    case_id, created, vintage, reason = _generate()
    assert reason is None, reason
    assert (created, vintage) == (True, "2026-01-01")
    assert run_stored_case(case_id)["value_per_share_diluted"] > 0
    assert load_case(case_id)["case_name"] == "damodaran_FAIR_2026-01-01_FY2025"
    again = _generate()
    assert again == (case_id, False, "2026-01-01", None)


def test_the_growth_comes_from_the_statements_three_year_cagr(seeded):
    """Catches growth taken from metrics.growth (a hard-coded fallback) instead of the statements."""
    case_id, *_ = _generate(_bundle(revenue={2022: 50e9, 2023: 80e9, 2024: 90e9, 2025: 100e9}))
    claim = next(n["claim"] for n in load_case(case_id)["segments"][0]["narratives"] if n["input_field"] == "revenue_target")
    assert f"{(100 / 50) ** (1 / 3) - 1:.4f}" in claim


def test_statements_in_another_currency_than_the_price_refuse(seeded):
    """Catches an ADR valued with TWD statements over a USD price (TSM came out at $4,078)."""
    bundle = _bundle(info={"marketCap": 1.0, "sharesOutstanding": 1.0, "currency": "USD", "financialCurrency": "TWD"})
    case_id, created, vintage, reason = _generate(bundle)
    assert case_id is None and reason.startswith("currency_mismatch:")


def test_an_unreported_statement_currency_does_not_refuse(seeded):
    """Catches rows fetched before financial_currency existed being refused wholesale."""
    case_id, *_rest, reason = _generate(_bundle(info={"marketCap": 1.0, "sharesOutstanding": 1.0, "currency": "USD"}))
    assert reason is None and case_id is not None


def test_fallback_metrics_refuse(seeded, monkeypatch):
    """Catches a WACC from the generic fallback table valued as if it were measured."""
    real = fair_value.metrics_for_ticker_with_provenance
    monkeypatch.setattr(fair_value, "metrics_for_ticker_with_provenance",
                        lambda ticker, **kw: (real(ticker, **kw)[0], False))
    case_id, created, vintage, reason = _generate()
    assert case_id is None and reason.startswith("default_metrics:")


def test_one_year_of_revenue_refuses(seeded):
    """Catches a growth rate invented from a single year."""
    case_id, created, vintage, reason = _generate(_bundle(revenue={2025: 100e9}))
    assert case_id is None and reason.startswith("no_growth_history:")


def test_the_summary_compares_value_with_the_latest_close(seeded):
    """Catches the gap measured against the wrong price or the wrong way round, and the
    assumptions list missing the claims behind the numbers."""
    case_id, created, vintage, _ = _generate()
    summary = fair_value_summary("FAIR", case_id, created=created, vintage=vintage)
    value = run_stored_case(case_id)["value_per_share_diluted"]
    assert summary["value_per_share"] == pytest.approx(value)
    assert (summary["price"], summary["price_date"]) == (150.0, "2026-10-23")
    assert summary["gap_pct"] == pytest.approx((value - 150.0) / 150.0 * 100)
    from apps.api.services.industry_benchmark_store import industry_row_for_ticker
    industry_growth = industry_row_for_ticker("FAIR")[0].values["revenue_growth"]
    assert summary["growth_1_5"] == pytest.approx(((100 / 80) ** 0.5 - 1 + industry_growth) / 2, abs=1e-9)
    case = load_case(case_id)
    from apps.api.services.fair_value_case import implied_growth
    assert summary["implied_growth_1_5"] == pytest.approx(implied_growth(case, 150.0)[0], abs=1e-9)
    assert (summary["implied_growth_1_5"] > summary["growth_1_5"]) == (value < 150.0)
    fields = {a["field"] for a in summary["assumptions"]}
    assert {"revenue_target", "margin_target", "wacc_stable", "roic_stable"} <= fields
    assert all(a["claim"] for a in summary["assumptions"])


def test_the_route_returns_the_summary_or_the_refusal(seeded, monkeypatch):
    """Catches the route swallowing a refusal or answering 200 without a value."""
    bundle = _bundle()
    original = generate_fair_value_case_for_ticker
    monkeypatch.setattr(fair_value, "generate_fair_value_case_for_ticker",
                        lambda ticker: original(ticker, base_year=2026, bundle_loader=lambda t, e: bundle))
    ok = client.post("/api/v1/valuation/fair-value/FAIR")
    assert ok.status_code == 200, ok.text
    assert ok.json()["data"]["value_per_share"] > 0
    refused = client.post("/api/v1/valuation/fair-value/NOSUCH")
    assert refused.status_code == 422 and refused.json()["detail"].startswith("no_industry")
