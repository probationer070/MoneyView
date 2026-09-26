"""/pricing: the case's base revenue priced at its industry's EV/Sales, beside the DCF's EV."""
import copy

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services import case_pricing
from apps.api.services.case_pricing import PricingRefused, price_case
from apps.api.services.db import get_db
from apps.api.services.industry_benchmark_store import store_vintage
from apps.api.services.valuation_case import CaseNotFound, create_case, run_stored_case
from packages.core_finance.industry_benchmark import IndustryRow
from tests.api.test_case_fork import _parent_payload

VINTAGE = "2026-01-01"
EV_SALES = 8.0


def _industry(name="Semiconductor", firms=70, ev_sales=EV_SALES):
    return IndustryRow(name, firms, {
        "revenue_growth": 0.1, "operating_margin": 0.3, "after_tax_roc": 0.2,
        "effective_tax_rate": 0.15, "unlevered_beta": 1.3, "debt_to_capital": 0.05,
        "cost_of_capital": 0.09, "sales_to_capital": 1.5, "reinvestment_rate": 0.3,
        "trailing_pe": 30.0, "price_to_book": 6.0, "ev_sales": ev_sales, "stdev_price": 0.4,
    })


def _quote_industry(ticker="TESTCO", industry="Semiconductors"):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker, industry),
        )


def _case(**overrides) -> int:
    payload = _parent_payload()
    payload.update(overrides)
    return create_case(payload)


def test_a_case_is_priced_at_its_industry_ev_sales_beside_its_dcf():
    store_vintage(VINTAGE, [_industry()])
    _quote_industry()
    case_id = _case()

    result = price_case(case_id)

    dcf_ev = run_stored_case(case_id)["enterprise_value"]
    assert result["industry"] == "Semiconductor"
    assert result["vintage"] == VINTAGE
    assert result["industry_firms"] == 70
    assert result["ev_sales"] == EV_SALES
    assert result["base_revenue_total"] == 1000.0
    # Hand arithmetic: 8.0 x 1000 = 8000, in the case's own money units.
    assert result["implied_enterprise_value"] == pytest.approx(8000.0)
    assert result["dcf_enterprise_value"] == pytest.approx(dcf_ev)
    assert result["dcf_to_implied"] == pytest.approx(dcf_ev / 8000.0 - 1)
    for part in (VINTAGE, "Semiconductor", "EV/Sales 8.00", "70 firms", "base-year revenue"):
        assert part in result["source"], (part, result["source"])


def test_the_multiple_is_the_company_s_own_industry_not_its_sector_basket():
    """A sibling in the same sector trades at 20x. The company's own industry is 8x.
    Pricing at a sector average, or at the top of the sector the way the verdict
    panel's P/E row does, would inflate the implied value. So only the company's own
    industry may set the multiple."""
    store_vintage(VINTAGE, [_industry(), _industry(name="Semiconductor Equip", ev_sales=20.0)])
    _quote_industry()
    case_id = _case()

    result = price_case(case_id)

    assert result["industry"] == "Semiconductor"
    assert result["implied_enterprise_value"] == pytest.approx(8000.0)


def test_base_revenue_is_the_sum_of_every_segment():
    store_vintage(VINTAGE, [_industry()])
    _quote_industry()
    payload = _parent_payload()
    second = copy.deepcopy(payload["segments"][0])
    second["name"] = "Adjacent"
    second["base_revenue"] = 400.0
    payload["segments"].append(second)
    case_id = create_case(payload)

    result = price_case(case_id)

    assert result["base_revenue_total"] == 1400.0
    assert result["implied_enterprise_value"] == pytest.approx(11200.0)


def test_the_vintage_is_the_one_in_force_on_the_case_date():
    """A case dated before any stored vintage is refused rather than priced with data
    that did not exist yet -- the same as-of rule the conservative case follows."""
    store_vintage(VINTAGE, [_industry()])
    _quote_industry()
    case_id = _case(as_of_date="2025-06-30")
    with pytest.raises(PricingRefused, match="^no_vintage:"):
        price_case(case_id)


@pytest.mark.parametrize("setup,prefix", [
    ("no_ticker", "no_ticker:"),
    ("no_vintage", "no_vintage:"),
    ("no_quote_industry", "no_industry:"),
    ("unmapped", "unmapped_industry:"),
    ("thin", "thin_industry:"),
    ("no_ev_sales", "no_ev_sales:"),
    ("ev_sales_out_of_bounds", "no_ev_sales:"),
])
def test_what_cannot_be_priced_is_refused_with_a_named_reason(setup, prefix):
    if setup != "no_vintage":
        industry = {
            "thin": _industry(firms=5),
            "no_ev_sales": _industry(ev_sales=None),
            "ev_sales_out_of_bounds": _industry(ev_sales=80.0),
        }.get(setup, _industry())
        store_vintage(VINTAGE, [industry])
    if setup not in ("no_quote_industry", "no_ticker"):
        _quote_industry(industry="Widgets" if setup == "unmapped" else "Semiconductors")
    case_id = _case(ticker=None) if setup == "no_ticker" else _case()

    with pytest.raises(PricingRefused, match=f"^{prefix}"):
        price_case(case_id)


def test_a_case_the_engine_refuses_to_run_is_refused_by_name(monkeypatch):
    store_vintage(VINTAGE, [_industry()])
    _quote_industry()
    case_id = _case()

    def refuse(_case_id):
        raise ValueError("terminal growth above the riskfree rate")

    monkeypatch.setattr(case_pricing, "run_stored_case", refuse)
    with pytest.raises(PricingRefused, match="^unrunnable_case: terminal growth"):
        price_case(case_id)


def test_an_unknown_case_is_not_found():
    with pytest.raises(CaseNotFound):
        price_case(999999)


client = TestClient(app)


def test_the_route_serves_a_priced_case():
    store_vintage(VINTAGE, [_industry()])
    _quote_industry()
    case_id = _case()
    response = client.get(f"/api/v1/valuation/cases/{case_id}/pricing")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["implied_enterprise_value"] == pytest.approx(8000.0)


def test_the_route_refuses_with_its_prefix_and_404s_an_unknown_case():
    case_id = _case(ticker=None)
    refused = client.get(f"/api/v1/valuation/cases/{case_id}/pricing")
    assert refused.status_code == 422
    assert refused.json()["detail"].startswith("no_ticker:")

    missing = client.get("/api/v1/valuation/cases/999999/pricing")
    assert missing.status_code == 404
    assert missing.json()["detail"].startswith("no_case:")
