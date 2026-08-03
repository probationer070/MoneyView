import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import CorporateDerivedMetricMeta, CorporateMetrics
from apps.api.routes import corporate as corporate_route
from apps.api.services.corporate_dcf import build_bulk_dcf_reports


def _valuation_payload() -> dict[str, float]:
    return {
        "revenue_growth_rate": 0.06,
        "operating_margin": 0.18,
        "tax_rate": 0.25,
        "wacc": 0.1,
        "terminal_growth_rate": 0.02,
        "fcff": 92.0,
        "esg_penalty": 22.0,
        "reinvestment": 34.0,
        "unlevered_beta": 1.05,
        "debt_ratio": 18.0,
    }


def _valuation_payload_with_bridge() -> dict[str, float]:
    payload = _valuation_payload()
    payload.update(
        {
            "net_debt": 100.0,
            "non_operating_assets": 20.0,
            "diluted_shares_outstanding": 10.0,
        }
    )
    return payload


def _mock_metrics(_: str) -> CorporateMetrics:
    return CorporateMetrics(
        ticker="AAPL",
        growth=6.0,
        roic=18.0,
        wacc=10.0,
        debt_ratio=18.0,
        unlevered_beta=1.05,
        crp=0.8,
        reinvestment=34.0,
        fcff=92.0,
        innovation=82.0,
        market_share=64.0,
        governance=74.0,
        esg_penalty=22.0,
    )


def test_dcf_summary_endpoint_omits_full_report_fields(monkeypatch):
    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda ticker: 210.4)
    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", _mock_metrics)
    client = TestClient(app)

    response = client.post("/api/v1/corporate/dcf/AAPL", json=_valuation_payload())

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["ticker"] == "AAPL"
    assert "estimated_value" in payload
    assert payload["estimated_value"] == payload["enterprise_value"]
    assert payload["intrinsic_value_per_share"] is None
    assert payload["valuation_method"] == "enterprise_value_no_share_bridge"
    assert payload["bridge_quality"] == "missing"
    assert payload["upside_pct"] == 0.0
    assert payload["status"] == "Bridge Incomplete"
    assert "wacc_used" in payload
    assert "projection_rows" not in payload
    assert "wacc_breakdown" not in payload


def test_dcf_stream_endpoint_emits_phase1_and_phase2_without_full_report(monkeypatch):
    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda ticker: 210.4)
    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", _mock_metrics)
    client = TestClient(app)

    response = client.post("/api/v1/corporate/dcf/AAPL/stream", json=_valuation_payload())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert "event: phase1" in body
    assert "event: phase2" in body
    assert '"phase":"phase1"' in body
    assert '"phase":"phase2"' in body
    assert "projection_rows" not in body
    assert "wacc_breakdown" not in body


def test_dcf_full_report_endpoint_returns_projection_rows(monkeypatch):
    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda ticker: 210.4)
    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", _mock_metrics)
    client = TestClient(app)

    response = client.post("/api/v1/corporate/dcf/AAPL/report", json=_valuation_payload())

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["summary"]["ticker"] == "AAPL"
    assert len(payload["projection_rows"]) == 5
    assert payload["projection_rows"][0]["year"] == 1
    assert "wacc_breakdown" in payload
    assert payload["assumptions"]["wacc_used"] == 0.1
    assert payload["summary"]["enterprise_value"] == payload["enterprise_value"]
    assert payload["summary"]["intrinsic_value_per_share"] is None
    assert payload["bridge_quality"] == "missing"
    assert payload["summary"]["status"] == "Bridge Incomplete"


def test_dcf_value_does_not_depend_on_current_price(monkeypatch):
    prices = iter([100.0, 300.0])
    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda ticker: next(prices))
    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", _mock_metrics)
    client = TestClient(app)

    first = client.post("/api/v1/corporate/dcf/AAPL", json=_valuation_payload()).json()["data"]
    second = client.post("/api/v1/corporate/dcf/AAPL", json=_valuation_payload()).json()["data"]

    assert first["current_price"] == 100.0
    assert second["current_price"] == 300.0
    assert first["estimated_value"] == second["estimated_value"]
    assert first["enterprise_value"] == second["enterprise_value"]


def test_dcf_full_report_uses_explicit_equity_bridge(monkeypatch):
    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda ticker: 210.4)
    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", _mock_metrics)
    client = TestClient(app)

    response = client.post("/api/v1/corporate/dcf/AAPL/report", json=_valuation_payload_with_bridge())

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["net_debt"] == 100.0
    assert payload["non_operating_assets"] == 20.0
    assert payload["diluted_shares_outstanding"] == 10.0
    assert payload["equity_value"] == 1306.87
    assert payload["intrinsic_value_per_share"] == 130.687
    assert payload["summary"]["estimated_value"] == 130.69
    assert payload["summary"]["intrinsic_value_per_share"] == 130.687
    assert payload["valuation_method"] == "intrinsic_equity_per_share"
    assert payload["bridge_quality"] == "ok"
    assert payload["summary"]["status"] == "Overvalued"


def test_bulk_dcf_service_normalizes_and_deduplicates_tickers():
    seen_tickers: list[str] = []

    def report_builder(
        ticker: str,
        params,
        *,
        current_price_loader,
        metrics_loader,
        risk_free_rate,
        equity_risk_premium,
        country_risk_premium,
    ):
        seen_tickers.append(ticker)
        return {
            "ticker": ticker,
            "price": current_price_loader(ticker),
            "growth": params.revenue_growth_rate,
            "risk_free_rate": risk_free_rate,
        }

    reports = build_bulk_dcf_reports(
        [" aapl ", "AAPL", "", "msft"],
        current_price_loader=lambda ticker: {"AAPL": 210.4, "MSFT": 430.0}[ticker],
        metrics_loader=_mock_metrics,
        valuation_params_builder=corporate_route._valuation_params_from_metrics,
        report_builder=report_builder,
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
        country_risk_premium=0.8,
    )

    assert seen_tickers == ["AAPL", "MSFT"]
    assert [report["ticker"] for report in reports] == ["AAPL", "MSFT"]
    assert reports[0]["price"] == 210.4


def test_valuation_params_from_metrics_accepts_stabilized_metric_metadata():
    params = corporate_route._valuation_params_from_metrics(
        CorporateMetrics(
            ticker="AAPL",
            growth=6.0,
            roic=18.0,
            wacc=10.0,
            debt_ratio=18.0,
            unlevered_beta=1.05,
            crp=0.8,
            reinvestment=34.0,
            fcff=92.0,
            innovation=82.0,
            market_share=64.0,
            governance=74.0,
            esg_penalty=22.0,
            growth_meta=CorporateDerivedMetricMeta(
                method="stable_cagr",
                quality="invalid",
                reason="Stable CAGR unavailable.",
                warnings=["Stable CAGR unavailable."],
                confidence=0.3,
                source="Fallback growth assumption",
                calculation_version="growth_v2_stable_cagr",
                metric_role="fallback",
                as_of=None,
            ),
            roic_meta=CorporateDerivedMetricMeta(
                method="stable_invested_capital",
                quality="estimated",
                reason=None,
                warnings=["Previous-year invested capital unavailable."],
                confidence=0.78,
                source="Stable ROIC from NOPAT over average invested capital",
                calculation_version="roic_v3_stable_invested_capital",
                metric_role="primary",
                as_of="2025-12-31",
            ),
        )
    )

    assert params.revenue_growth_rate == 0.06
    assert params.operating_margin == 0.18
    assert params.terminal_growth_rate == 0.06
