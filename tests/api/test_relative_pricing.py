"""/relative-pricing: the company's own figures at its industry's multiples (spec 2026-11-01 §12).

Every loader is a fake, so nothing touches data/processed/moneyview.db. The equity bridge is the
real `load_equity_bridge`, reading a fake statement bundle, so net debt and shares follow the
same unit conversion production uses.
"""
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services import relative_pricing as service
from apps.api.services.relative_pricing import RelativePricingRefused, relative_pricing
from packages.core_finance.industry_benchmark import IndustryRow
from packages.core_finance.relative_pricing import (
    ev_sales_value_per_share,
    pb_value_per_share,
    pe_value_per_share,
    value_range,
)

VINTAGE = "2026-01-01"
PRICE = 10.0
YEARS = [pd.Timestamp("2024-12-31"), pd.Timestamp("2025-12-31")]


def _frame(rows: dict[str, list[float]]) -> pd.DataFrame:
    return pd.DataFrame(rows, index=YEARS).T


def _bundle(*, revenue=(8.0, 10.0), eps=(1.2, 1.5), equity=(45.0, 40.0),
            debt=(6.0, 6.0), cash=(2.0, 2.0), shares=(2.0, 2.0)):
    """Latest year: revenue 10bn, EPS 1.5, equity 40bn, net debt 4bn, 2bn diluted shares."""
    income = _frame({
        "Total Revenue": [v * 1e9 for v in revenue],
        "Diluted EPS": list(eps),
        "Diluted Average Shares": [v * 1e9 for v in shares],
    })
    balance = _frame({
        "Total Debt": [v * 1e9 for v in debt],
        "Cash Cash Equivalents And Short Term Investments": [v * 1e9 for v in cash],
        "Stockholders Equity": [v * 1e9 for v in equity],
    })
    return {"ticker": "TESTCO", "income": income, "balance": balance, "info": {}}


def _industry(firms=70, **multiples):
    values = {"ev_sales": 3.0, "trailing_pe": 20.0, "aggregate_pe": 20.0, "price_to_book": 1.2}
    values.update(multiples)
    return IndustryRow("Software", firms, values)


def _run(*, industry=None, industry_result=None, bundle=None, sector="Technology",
         bars=None, currency=None, ticker="TESTCO"):
    if industry_result is None:
        industry_result = (industry or _industry(), VINTAGE, None)
    if bars is None:
        bars = [{"date": "2026-10-30", "close": PRICE}]
    return relative_pricing(
        ticker,
        bundle_loader=lambda t, endpoint: _bundle() if bundle is None else bundle,
        industry_loader=lambda t: industry_result,
        price_loader=lambda t, limit=None: bars,
        sector_loader=lambda t: sector,
        currency_check=lambda t: currency,
    )


def _row(result, basis):
    return next(row for row in result["rows"] if row["basis"] == basis)


# Pure arithmetic, hand-computed.

def test_ev_sales_value_per_share_is_multiple_times_revenue_less_net_debt_over_shares():
    assert ev_sales_value_per_share(3.0, 10.0, 4.0, 2.0) == pytest.approx(13.0)


def test_pe_value_per_share_is_multiple_times_eps():
    assert pe_value_per_share(20.0, 1.5) == pytest.approx(30.0)


def test_pb_value_per_share_is_multiple_times_book_over_shares():
    assert pb_value_per_share(1.2, 50.0, 5.0) == pytest.approx(12.0)


def test_the_range_is_low_median_high_of_the_valued_multiples():
    # The mean of 13, 30, 12 is 18.33; the median is 13. The range reports the median.
    assert value_range([13.0, 30.0, 12.0]) == {"low": 12.0, "mid": 13.0, "high": 30.0}


def test_there_is_no_range_when_no_multiple_was_valued():
    assert value_range([]) is None


# The service path.

def test_a_non_financial_ticker_is_priced_on_ev_sales_and_pe():
    result = _run()

    assert result["financial"] is False
    assert [row["basis"] for row in result["rows"]] == ["ev_sales", "trailing_pe"]
    ev, pe = result["rows"]
    # EV/Sales: (3 x 10bn revenue - 4bn net debt) / 2bn shares = 13.00.
    assert ev["industry_multiple"] == 3.0
    assert ev["company_figure"] == pytest.approx(10.0)
    assert ev["value_per_share"] == pytest.approx(13.0)
    assert ev["gap_pct"] == pytest.approx(30.0)
    assert ev["refusal"] is None
    # P/E: 20 x 1.5 = 30.00.
    assert pe["company_figure"] == pytest.approx(1.5)
    assert pe["value_per_share"] == pytest.approx(30.0)
    assert pe["gap_pct"] == pytest.approx(200.0)
    assert pe["refusal"] is None
    assert result["range"] == pytest.approx({"low": 13.0, "mid": 21.5, "high": 30.0})
    assert result["price"] == PRICE
    assert result["price_date"] == "2026-10-30"
    assert result["vintage"] == VINTAGE
    assert result["industry"] == "Software"
    assert result["industry_firms"] == 70


def test_a_financial_ticker_is_priced_on_pe_and_pb_and_never_on_ev_sales():
    result = _run(sector="Financial Services")

    assert result["financial"] is True
    assert [row["basis"] for row in result["rows"]] == ["trailing_pe", "price_to_book"]
    pb = _row(result, "price_to_book")
    # P/B: 1.2 x 40bn book equity / 2bn shares = 24.00.
    assert pb["company_figure"] == pytest.approx(40.0)
    assert pb["value_per_share"] == pytest.approx(24.0)
    assert pb["gap_pct"] == pytest.approx(140.0)
    assert _row(result, "trailing_pe")["value_per_share"] == pytest.approx(30.0)
    assert result["range"] == pytest.approx({"low": 24.0, "mid": 27.0, "high": 30.0})


def test_a_latest_loss_is_refused_and_not_valued_from_an_older_profitable_year():
    result = _run(bundle=_bundle(eps=(1.5, -0.4)))

    pe = _row(result, "trailing_pe")
    assert pe["value_per_share"] is None, "the old profitable year was used to value the company"
    assert pe["refusal"].startswith("no_positive_earnings:")
    assert pe["company_figure"] == pytest.approx(-0.4)
    # The other multiple still stands on its own figures.
    assert _row(result, "ev_sales")["value_per_share"] == pytest.approx(13.0)
    assert result["range"] == pytest.approx({"low": 13.0, "mid": 13.0, "high": 13.0})


def test_a_value_at_or_below_zero_after_net_debt_is_refused_as_non_positive():
    # Net debt 38bn against 3 x 10bn of sales: (30 - 38) / 2 = -4.00 per share.
    result = _run(bundle=_bundle(debt=(40.0, 40.0)))

    ev = _row(result, "ev_sales")
    assert ev["value_per_share"] is None, "a negative equity value was reported as a price"
    assert ev["refusal"].startswith("non_positive_value:")
    assert _row(result, "trailing_pe")["value_per_share"] == pytest.approx(30.0)


@pytest.mark.parametrize("multiple", [60.0, None])
def test_an_industry_multiple_out_of_band_or_missing_refuses_only_that_row(multiple):
    result = _run(industry=_industry(ev_sales=multiple))

    ev = _row(result, "ev_sales")
    assert ev["refusal"].startswith("no_multiple: ev_sales:")
    assert ev["value_per_share"] is None
    assert _row(result, "trailing_pe")["value_per_share"] == pytest.approx(30.0)
    assert result["range"] == pytest.approx({"low": 30.0, "mid": 30.0, "high": 30.0})


def test_a_currency_mismatch_refuses_the_whole_ticker():
    with pytest.raises(RelativePricingRefused, match=r"^currency_mismatch: TESTCO reports in TWD"):
        _run(currency="TESTCO reports in TWD and trades in USD; a value per share would mix the two")


def test_a_thin_industry_refuses_the_whole_ticker():
    with pytest.raises(RelativePricingRefused, match=r"^thin_industry: Software: 5 firms"):
        _run(industry=_industry(firms=5))


def test_no_vintage_refuses_the_whole_ticker():
    with pytest.raises(RelativePricingRefused, match=r"^no_vintage:"):
        _run(industry_result=(None, None, "no_vintage: no industry benchmark data has been loaded"))


@pytest.mark.parametrize("bars", [[], [{"date": "2026-10-30", "close": None}]])
def test_no_stored_close_refuses_the_whole_ticker(bars):
    with pytest.raises(RelativePricingRefused, match=r"^no_price: no stored close for TESTCO"):
        _run(bars=bars)



def test_a_zero_close_is_not_a_price():
    # A 0.0 close would divide the gap by zero (HTTP 500); it is refused like no close at all.
    with pytest.raises(RelativePricingRefused, match=r"^no_price: no stored close for TESTCO"):
        _run(bars=[{"date": "2026-10-30", "close": 0.0}])


# Route.

client = TestClient(app)


def test_the_route_answers_200_with_the_service_payload(monkeypatch):
    monkeypatch.setattr(service, "relative_pricing", lambda ticker: {"ticker": "TESTCO", "rows": [], "range": None})
    response = client.get("/api/v1/valuation/relative-pricing/testco")
    assert response.status_code == 200
    assert response.json()["data"] == {"ticker": "TESTCO", "rows": [], "range": None}


def test_the_route_answers_422_with_the_prefix_for_a_currency_mismatch(monkeypatch):
    def refuse(ticker):
        raise RelativePricingRefused("currency_mismatch: TSM reports in TWD and trades in USD")

    monkeypatch.setattr(service, "relative_pricing", refuse)
    response = client.get("/api/v1/valuation/relative-pricing/TSM")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("currency_mismatch:")


def test_the_route_answers_409_for_no_vintage(monkeypatch):
    def refuse(ticker):
        raise RelativePricingRefused("no_vintage: no industry benchmark data has been loaded")

    monkeypatch.setattr(service, "relative_pricing", refuse)
    response = client.get("/api/v1/valuation/relative-pricing/TESTCO")
    assert response.status_code == 409
    assert response.json()["detail"].startswith("no_vintage:")


def test_the_pe_row_uses_the_aggregate_multiple_not_the_simple_average():
    # Damodaran's Trailing PE (80) is a simple average of firm PEs; the aggregate (30) is the
    # multiple the P/E row must apply. 30 x 1.5 = 45.00, not 80 x 1.5 = 120.00.
    result = _run(industry=_industry(trailing_pe=80.0, aggregate_pe=30.0))

    pe = _row(result, "trailing_pe")
    assert pe["industry_multiple"] == 30.0
    assert pe["value_per_share"] == pytest.approx(45.0)


def test_a_missing_aggregate_multiple_refuses_the_pe_row_only():
    result = _run(industry=_industry(aggregate_pe=None))

    pe = _row(result, "trailing_pe")
    assert pe["value_per_share"] is None
    assert pe["refusal"].startswith("no_multiple:")
    assert _row(result, "ev_sales")["value_per_share"] == pytest.approx(13.0)
