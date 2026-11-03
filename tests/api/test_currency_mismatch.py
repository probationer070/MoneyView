"""A value per share is not compared with a price in another currency (ERROR-LOG 2026-11-03).

13 watchlist tickers report in one currency and trade in another (10 CAD, ASML EUR, KEP KRW,
TSM TWD) and nothing converts them. The 5-year DCF valued TSM at 4,500 against a 405 price.
fair_value.py already refused this case as `currency_mismatch`; the 5-year DCF routes, the bulk
report and the comparison table now do too.
"""
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schema_parts.corporate import BridgeInputMeta, BridgeSource, ValuationAssumptions
from apps.api.models.schemas import CorporateMetrics
from apps.api.routes import corporate as corporate_route
from apps.api.services.corporate_comparison import _dcf_snapshot
from apps.api.services.corporate_dcf import _build_dcf_outputs, build_bulk_dcf_reports
from apps.api.services.corporate_statement_metrics import statement_currency_mismatch
from apps.api.services.equity_bridge import EquityBridge
from packages.core_finance.refusals import EngineRefusal

REASON = "TSM reports in TWD and trades in USD; a value per share would mix the two"


def _bundle(reported, priced):
    return lambda ticker, endpoint: {"ticker": ticker, "info": {"financialCurrency": reported, "currency": priced}}


@pytest.mark.parametrize(
    ("reported", "priced", "mismatch"),
    [("TWD", "USD", True), ("cad", "USD", True), ("USD", "USD", False), ("", "USD", False), ("TWD", "", False)],
)
def test_the_check_names_a_mismatch_only_when_both_currencies_are_known_and_differ(reported, priced, mismatch):
    reason = statement_currency_mismatch("tsm", bundle_loader=_bundle(reported, priced))
    assert (reason is not None) is mismatch
    if mismatch:
        assert reason.startswith("TSM reports in ")


def test_no_stored_statements_is_not_a_mismatch():
    assert statement_currency_mismatch("TSM", bundle_loader=lambda t, e: None) is None


def _metrics(ticker="TSM"):
    return CorporateMetrics(
        ticker=ticker, growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22,
    )


def _params():
    return ValuationAssumptions(
        revenue_growth_rate=0.06, operating_margin=0.25, tax_rate=0.21,
        wacc=0.10, terminal_growth_rate=0.02, fcff=100.0, esg_penalty=22.0,
    )


def _bridge():
    meta = lambda value, source: BridgeInputMeta(value=value, source=source, quality="ok", as_of="2025-09-30")  # noqa: E731
    return EquityBridge(
        net_debt=meta(60.0, BridgeSource.TOTAL_DEBT_LESS_CASH),
        non_operating_assets=meta(5.0, BridgeSource.INVESTMENTS_ADVANCES),
        diluted_shares_outstanding=meta(15.0, BridgeSource.DILUTED_AVERAGE_SHARES),
    )


def _outputs(currency_check):
    return _build_dcf_outputs(
        ticker="TSM", params=_params(),
        current_price_loader=lambda t: 405.0, metrics_loader=lambda t: _metrics(t),
        risk_free_rate=0.042, equity_risk_premium=0.055, country_risk_premium=None,
        bridge_loader=lambda t: _bridge(), currency_check=currency_check,
    )


def test_the_dcf_refuses_a_mixed_currency_ticker():
    with pytest.raises(EngineRefusal) as refused:
        _outputs(lambda t: REASON)
    assert refused.value.code == "currency_mismatch"
    assert str(refused.value) == REASON


def test_the_dcf_values_a_single_currency_ticker():
    summary, _, _ = _outputs(lambda t: None)
    assert summary.intrinsic_value_per_share is not None


def test_the_bulk_report_skips_a_mixed_currency_ticker_and_values_the_rest():
    result = build_bulk_dcf_reports(
        ["TSM", "AAPL"],
        current_price_loader=lambda t: 100.0,
        metrics_loader=_metrics,
        valuation_params_builder=lambda m: _params(),
        report_builder=lambda ticker, **_: type("R", (), {"ticker": ticker})(),
        risk_free_rate=0.042,
        currency_check=lambda t: REASON if t == "TSM" else None,
    )
    assert [r.ticker for r in result.reports] == ["AAPL"]
    assert [s.ticker for s in result.skipped] == ["TSM"]
    assert "reports in TWD" in result.skipped[0].reason


def _snapshot(currency_check):
    return _dcf_snapshot(
        ticker="TSM", metrics=_metrics(), price_loader=lambda t: 405.0,
        risk_free_rate=0.042, equity_risk_premium=0.055,
        bridge_loader=lambda t: _bridge(), currency_check=currency_check,
    )


def test_the_comparison_row_is_refused_with_no_value_and_no_implied_return():
    row = _snapshot(lambda t: REASON)
    assert row["dcf_refusal"] == "currency_mismatch"
    assert row["estimated_value"] is None
    assert row["dcf_implied_return"] is None
    assert row["market_implied_return"] is None
    assert row["implied_return_refusal"] == "currency_mismatch"


def test_the_comparison_row_is_valued_when_currencies_match():
    row = _snapshot(lambda t: None)
    assert row["dcf_refusal"] is None
    assert row["estimated_value"] is not None


def test_the_dcf_route_answers_422_currency_mismatch(monkeypatch):
    monkeypatch.setattr(corporate_route, "statement_currency_mismatch", lambda t: REASON)
    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda t: 405.0)
    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", _metrics)
    client = TestClient(app)
    payload = {"revenue_growth_rate": 0.06, "operating_margin": 0.18, "tax_rate": 0.25, "wacc": 0.1,
               "terminal_growth_rate": 0.02, "fcff": 92.0, "esg_penalty": 22.0}
    for path in ("/api/v1/corporate/dcf/TSM", "/api/v1/corporate/dcf/TSM/report", "/api/v1/corporate/dcf/TSM/stream"):
        response = client.post(path, json=payload)
        assert response.status_code == 422, path
        assert response.json()["detail"]["code"] == "currency_mismatch", path


def test_the_bulk_route_skips_a_mixed_currency_ticker(monkeypatch):
    monkeypatch.setattr(corporate_route, "statement_currency_mismatch", lambda t: REASON if t == "TSM" else None)
    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda t: 405.0)
    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", _metrics)
    client = TestClient(app)
    response = client.post("/api/v1/corporate/dcf/reports/bulk", json={"tickers": ["TSM"]})
    assert response.status_code == 200
    skipped = response.json()["data"]["skipped"]
    assert [s["ticker"] for s in skipped] == ["TSM"]
    assert "reports in TWD" in skipped[0]["reason"]
