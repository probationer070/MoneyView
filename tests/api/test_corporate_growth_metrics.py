import sys
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.services import db as db_service


def _make_frame(rows: dict[str, dict[str, float]]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            pd.Timestamp(period): values
            for period, values in rows.items()
        }
    )


def _make_bundle(*, income_rows: dict[str, dict[str, float]], balance_rows: dict[str, dict[str, float]], info: dict[str, object] | None = None):
    return {
        "ticker": "AAPL",
        "income": _make_frame(income_rows),
        "balance": _make_frame(balance_rows),
        "cashflow": pd.DataFrame(),
        "quarterly_income": pd.DataFrame(),
        "quarterly_balance": pd.DataFrame(),
        "quarterly_cashflow": pd.DataFrame(),
        "info": info or {},
    }


def _init_test_db(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()


def test_metrics_uses_stable_cagr_as_primary_growth(tmp_path, monkeypatch):
    _init_test_db(tmp_path, monkeypatch)
    from apps.api.routes import corporate as corporate_route

    monkeypatch.setattr(
        corporate_route,
        "_get_yahoo_statement_bundle",
        lambda ticker, endpoint: _make_bundle(
            income_rows={
                "2021-12-31": {
                    "Total Revenue": 1000000.0,
                    "Operating Income": 100000.0,
                    "Pretax Income": 100000.0,
                    "Tax Provision": 20000.0,
                    "Interest Expense": 5000.0,
                },
                "2023-12-31": {
                    "Total Revenue": 1210000.0,
                    "Operating Income": 121000.0,
                    "Pretax Income": 121000.0,
                    "Tax Provision": 24000.0,
                    "Interest Expense": 6000.0,
                },
            },
            balance_rows={
                "2022-12-31": {
                    "Total Debt": 2000000.0,
                    "Stockholders Equity": 8000000.0,
                },
                "2023-12-31": {
                    "Total Debt": 2200000.0,
                    "Stockholders Equity": 8200000.0,
                },
            },
            info={"beta": 1.02},
        ),
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/metrics/AAPL")
    assert response.status_code == 200

    payload = response.json()
    assert payload["growth"] == 10.0
    assert payload["growth_cagr_v2"] == 10.0
    assert payload["growth_avg_legacy"] == 21.0
    assert payload["growth_meta"]["quality"] == "ok"
    assert payload["growth_meta"]["metric_role"] == "primary"
    assert payload["growth_meta"]["method"] == "stable_cagr"
    assert payload["growth_meta"]["confidence"] >= 0.9
    assert payload["growth_meta"]["calculation_version"] == "growth_v2_stable_cagr"
    assert payload["roic_stable_v2"] == payload["roic"]
    assert payload["roic_legacy"] is not None
    assert payload["roic_meta"]["calculation_version"] == "roic_v3_stable_invested_capital"
    assert payload["roic_meta"]["method"] == "stable_invested_capital"
    assert payload["roic_meta"]["confidence"] >= 0.8


def test_growth_history_suppresses_outlier_cagr_and_metrics_falls_back(tmp_path, monkeypatch):
    _init_test_db(tmp_path, monkeypatch)
    from apps.api.routes import corporate as corporate_route

    monkeypatch.setattr(
        corporate_route,
        "_get_yahoo_statement_bundle",
        lambda ticker, endpoint: _make_bundle(
            income_rows={
                "2021-12-31": {
                    "Total Revenue": 1000000.0,
                    "Operating Income": 100000.0,
                    "Pretax Income": 100000.0,
                    "Tax Provision": 20000.0,
                    "Interest Expense": 5000.0,
                },
                "2022-12-31": {
                    "Total Revenue": 5000000.0,
                    "Operating Income": 300000.0,
                    "Pretax Income": 300000.0,
                    "Tax Provision": 60000.0,
                    "Interest Expense": 7000.0,
                },
                "2023-12-31": {
                    "Total Revenue": 12000000.0,
                    "Operating Income": 500000.0,
                    "Pretax Income": 500000.0,
                    "Tax Provision": 100000.0,
                    "Interest Expense": 10000.0,
                },
            },
            balance_rows={
                "2022-12-31": {
                    "Total Debt": 2000000.0,
                    "Stockholders Equity": 8000000.0,
                },
                "2023-12-31": {
                    "Total Debt": 2200000.0,
                    "Stockholders Equity": 8200000.0,
                },
            },
            info={"beta": 1.02},
        ),
    )

    client = TestClient(app)

    metrics_response = client.get("/api/v1/corporate/metrics/AAPL")
    assert metrics_response.status_code == 200
    metrics_payload = metrics_response.json()
    assert metrics_payload["growth"] == 6.0
    assert metrics_payload["growth_cagr_v2"] is None
    assert metrics_payload["growth_avg_legacy"] is not None
    assert metrics_payload["growth_meta"]["quality"] == "invalid"
    assert metrics_payload["growth_meta"]["metric_role"] == "fallback"
    assert metrics_payload["growth_meta"]["method"] == "stable_cagr"
    assert metrics_payload["growth_meta"]["reason"] == "Growth CAGR exceeded sanity threshold."

    history_response = client.get("/api/v1/corporate/metrics/AAPL/history")
    assert history_response.status_code == 200
    history_payload = history_response.json()
    assert history_payload["growth_cagr"] is None
    assert history_payload["growth_recent_average"] is not None


def test_metrics_exposes_roic_meta_and_falls_back_when_roic_is_not_decision_grade(tmp_path, monkeypatch):
    _init_test_db(tmp_path, monkeypatch)
    from apps.api.routes import corporate as corporate_route

    monkeypatch.setattr(
        corporate_route,
        "_get_yahoo_statement_bundle",
        lambda ticker, endpoint: _make_bundle(
            income_rows={
                "2024-12-31": {
                    "Total Revenue": 1000000.0,
                    "Operating Income": 100000.0,
                    "Pretax Income": 100000.0,
                    "Tax Provision": 15000.0,
                    "Interest Expense": 5000.0,
                },
                "2025-12-31": {
                    "Total Revenue": 1100000.0,
                    "Operating Income": 120000.0,
                    "Pretax Income": 120000.0,
                    "Tax Provision": 18000.0,
                    "Interest Expense": 5000.0,
                },
            },
            balance_rows={
                "2024-12-31": {
                    "Total Debt": 300000.0,
                    "Stockholders Equity": 400000.0,
                },
                "2025-12-31": {
                    "Total Debt": 300000.0,
                    "Stockholders Equity": 400000.0,
                },
            },
            info={"beta": 1.02},
        ),
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/metrics/AAPL")
    assert response.status_code == 200

    payload = response.json()
    assert payload["roic"] == 18.0
    assert payload["roic_stable_v2"] == payload["roic"]
    assert payload["roic_legacy"] is not None
    assert payload["roic_meta"]["quality"] == "invalid"
    assert payload["roic_meta"]["metric_role"] == "fallback"
    assert payload["roic_meta"]["method"] == "stable_invested_capital"
    assert payload["roic_meta"]["reason"] == "Invested capital is too small; ROIC denominator unstable."
