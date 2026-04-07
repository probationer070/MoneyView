"""
Phase 5 portfolio attribution and reporting contract tests.
"""

import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.core.maths import brinson_fachler_arithmetic
from apps.api.main import app
from apps.api.models.schemas import PortfolioInput


def test_brinson_fachler_arithmetic_reconciles_to_active_return():
    wp = np.array([0.5, 0.3, 0.2], dtype=float)
    wb = np.array([0.4, 0.4, 0.2], dtype=float)
    rp = np.array([0.10, 0.06, -0.02], dtype=float)
    rb = np.array([0.08, 0.05, -0.01], dtype=float)
    rb_total = float(np.dot(wb, rb))

    effects = brinson_fachler_arithmetic(
        portfolio_weights=wp,
        benchmark_weights=wb,
        portfolio_returns=rp,
        benchmark_returns=rb,
        benchmark_total_return=rb_total,
    )

    total_effect = float(np.sum(effects.allocation + effects.selection + effects.interaction))
    active_return = float(np.dot(wp, rp) - np.dot(wb, rb))
    assert total_effect == pytest.approx(active_return, abs=1e-12)


def test_brinson_zero_active_return_fixture():
    wp = np.array([0.5, 0.5], dtype=float)
    wb = np.array([0.5, 0.5], dtype=float)
    rp = np.array([0.07, 0.03], dtype=float)
    rb = np.array([0.07, 0.03], dtype=float)
    rb_total = float(np.dot(wb, rb))

    effects = brinson_fachler_arithmetic(wp, wb, rp, rb, rb_total)
    total_effect = float(np.sum(effects.allocation + effects.selection + effects.interaction))
    assert total_effect == pytest.approx(0.0, abs=1e-12)


def test_brinson_equal_weight_benchmark_fixture():
    wp = np.array([0.25, 0.25, 0.25, 0.25], dtype=float)
    wb = np.array([0.25, 0.25, 0.25, 0.25], dtype=float)
    rp = np.array([0.05, 0.01, -0.02, 0.03], dtype=float)
    rb = np.array([0.05, 0.01, -0.02, 0.03], dtype=float)
    rb_total = float(np.dot(wb, rb))

    effects = brinson_fachler_arithmetic(wp, wb, rp, rb, rb_total)
    total_effect = float(np.sum(effects.allocation + effects.selection + effects.interaction))
    assert total_effect == pytest.approx(0.0, abs=1e-12)


def test_brinson_overweight_winning_sector_fixture():
    wp = np.array([0.7, 0.3], dtype=float)
    wb = np.array([0.5, 0.5], dtype=float)
    rp = np.array([0.12, 0.01], dtype=float)
    rb = np.array([0.08, 0.02], dtype=float)
    rb_total = float(np.dot(wb, rb))

    effects = brinson_fachler_arithmetic(wp, wb, rp, rb, rb_total)
    total_effect = float(np.sum(effects.allocation + effects.selection + effects.interaction))
    active_return = float(np.dot(wp, rp) - np.dot(wb, rb))

    assert total_effect == pytest.approx(active_return, abs=1e-12)
    assert total_effect > 0


def test_portfolio_input_merges_duplicates_and_fills_cash():
    payload = PortfolioInput(
        tickers=["AAPL", "aapl", "MSFT"],
        weights=[0.35, 0.15, 0.30],
        allow_cash=True,
        allow_short=False,
    )

    assert "AAPL" in payload.tickers
    assert "CASH" in payload.tickers
    aapl_weight = payload.weights[payload.tickers.index("AAPL")]
    cash_weight = payload.weights[payload.tickers.index("CASH")]

    assert aapl_weight == pytest.approx(0.5)
    assert cash_weight == pytest.approx(0.2)
    assert payload.total_weight == pytest.approx(1.0, abs=1e-9)


def test_post_portfolio_attribution_returns_domain_contract():
    client = TestClient(app)
    response = client.post(
        "/api/v1/portfolio/attribution",
        json={
            "tickers": ["AAPL", "MSFT", "TSLA"],
            "weights": [0.4, 0.4, 0.2],
            "benchmark": "^GSPC",
            "period": "1y",
            "currency": "USD",
            "attribution_method": "brinson_fachler_arithmetic",
            "allow_synthetic_fallback": True,
            "allow_benchmark_proxy": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert set(payload.keys()) == {
        "totals",
        "active_return",
        "effects",
        "sector_breakdowns",
        "risk_metrics",
        "metadata",
    }

    effects = payload["effects"]
    assert effects["allocation"] + effects["selection"] + effects["interaction"] == pytest.approx(
        payload["active_return"],
        abs=1e-8,
    )
    assert payload["metadata"]["method"] == "brinson_fachler_arithmetic"


def test_missing_sector_contract_with_explicit_synthetic_fallback():
    client = TestClient(app)
    response = client.post(
        "/api/v1/portfolio/attribution",
        json={
            "tickers": ["ZZZX", "YYYX"],
            "weights": [0.5, 0.5],
            "benchmark": "^GSPC",
            "period": "1y",
            "currency": "USD",
            "attribution_method": "brinson_fachler_arithmetic",
            "allow_synthetic_fallback": True,
            "allow_benchmark_proxy": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["metadata"]["data_contract"]["currency"] == "USD"
    assert payload["metadata"]["data_quality"]["synthetic_data_used"] is True
    sectors = [row["sector"] for row in payload["sector_breakdowns"]]
    assert "UNCLASSIFIED" in sectors


def test_currency_mismatch_rejected_for_unsupported_currency():
    client = TestClient(app)
    response = client.post(
        "/api/v1/portfolio/attribution",
        json={
            "tickers": ["AAPL", "MSFT"],
            "weights": [0.5, 0.5],
            "benchmark": "^GSPC",
            "period": "1y",
            "currency": "KRW",
            "attribution_method": "brinson_fachler_arithmetic",
            "allow_benchmark_proxy": True,
        },
    )
    assert response.status_code == 422


def test_missing_price_data_rejected_without_explicit_synthetic_fallback():
    client = TestClient(app)
    response = client.post(
        "/api/v1/portfolio/attribution",
        json={
            "tickers": ["ZZZX", "YYYX"],
            "weights": [0.5, 0.5],
            "benchmark": "^GSPC",
            "period": "1y",
            "currency": "USD",
            "attribution_method": "brinson_fachler_arithmetic",
            "allow_benchmark_proxy": True,
        },
    )
    assert response.status_code == 422
    assert "allow_synthetic_fallback=true" in response.json()["detail"]


def test_benchmark_proxy_rejected_without_explicit_opt_in():
    client = TestClient(app)
    response = client.post(
        "/api/v1/portfolio/attribution",
        json={
            "tickers": ["ZZZX", "YYYX"],
            "weights": [0.5, 0.5],
            "benchmark": "^GSPC",
            "period": "1y",
            "currency": "USD",
            "attribution_method": "brinson_fachler_arithmetic",
            "allow_synthetic_fallback": True,
        },
    )
    assert response.status_code == 422
    assert "allow_benchmark_proxy=true" in response.json()["detail"]


def test_as_of_date_changes_request_cache_key():
    client = TestClient(app)
    base_payload = {
        "tickers": ["AAPL", "MSFT", "TSLA"],
        "weights": [0.4, 0.4, 0.2],
        "benchmark": "^GSPC",
        "period": "1y",
        "currency": "USD",
        "attribution_method": "brinson_fachler_arithmetic",
        "allow_synthetic_fallback": True,
        "allow_benchmark_proxy": True,
    }

    r1 = client.post("/api/v1/portfolio/attribution", json={**base_payload, "as_of_date": "2025-12-31"})
    r2 = client.post("/api/v1/portfolio/attribution", json={**base_payload, "as_of_date": "2024-12-31"})
    assert r1.status_code == 200
    assert r2.status_code == 200
    c1 = r1.json()["data"]["metadata"]["cache_key"]
    c2 = r2.json()["data"]["metadata"]["cache_key"]
    assert c1 != c2


def test_post_report_summary_returns_canonical_payload():
    client = TestClient(app)
    response = client.post(
        "/api/v1/report/summary",
        json={
            "tickers": ["AAPL", "MSFT", "TSLA"],
            "weights": [0.4, 0.4, 0.2],
            "filters": {
                "period": "1y",
                "benchmark": "^GSPC",
                "currency": "USD",
            },
            "report_options": {
                "formats": ["html", "pdf", "markdown", "csv", "json"],
                "include_risk_metrics": True,
                "include_sector_table": True,
                "include_methodology": True,
            },
            "attribution_method": "brinson_fachler_arithmetic",
            "allow_synthetic_fallback": True,
            "allow_benchmark_proxy": True,
            "version": "phase5-v1",
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["version"] == "phase5-v1"
    assert "attribution" in payload
    assert "markdown_content" in payload


def test_post_report_export_returns_backend_static_content():
    client = TestClient(app)
    response = client.post(
        "/api/v1/report/export",
        json={
            "request": {
                "tickers": ["AAPL", "MSFT", "TSLA"],
                "weights": [0.4, 0.4, 0.2],
                "filters": {
                    "period": "1y",
                    "benchmark": "^GSPC",
                    "currency": "USD",
                    "date_to": "2025-12-31",
                },
                "attribution_method": "brinson_fachler_arithmetic",
                "allow_synthetic_fallback": True,
                "allow_benchmark_proxy": True,
                "version": "phase5-v1",
            },
            "format": "html",
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["format"] == "html"
    assert data["content_type"] == "text/html"
    assert "<!doctype html>" in data["content"].lower()
