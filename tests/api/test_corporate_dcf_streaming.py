import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import CorporateMetrics
from apps.api.routes import corporate as corporate_route


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
