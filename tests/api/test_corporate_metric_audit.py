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


def test_metric_audit_marks_missing_roic_when_yahoo_years_do_not_overlap(tmp_path, monkeypatch):
    _init_test_db(tmp_path, monkeypatch)
    from apps.api.routes import corporate as corporate_route

    monkeypatch.setattr(
        corporate_route,
        "_get_yahoo_statement_bundle",
        lambda ticker, endpoint: _make_bundle(
            income_rows={
                "2025-12-31": {
                    "Operating Income": 100.0,
                    "Pretax Income": 100.0,
                    "Tax Provision": 15.0,
                    "Interest Expense": 5.0,
                },
            },
            balance_rows={
                "2024-12-31": {
                    "Total Debt": 20.0,
                    "Stockholders Equity": 80.0,
                    "Cash And Cash Equivalents": 10.0,
                },
            },
            info={},
        ),
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/metrics/AAPL/audit")
    assert response.status_code == 200

    payload = response.json()
    assert payload["ticker"] == "AAPL"
    assert payload["source_mode"] == "yahoo_finance"
    assert payload["growth"]["quality"] == "invalid"
    assert payload["growth"]["method"] == "stable_cagr"
    assert payload["growth"]["confidence"] < 0.5
    assert payload["growth"]["calculation_version"] == "growth_v2_stable_cagr"
    assert payload["roic"]["quality"] == "missing"
    assert payload["roic"]["reason"] == "No overlapping Yahoo statement years were available to compute ROIC."
    assert payload["roic"]["method"] == "stable_invested_capital"
    assert payload["roic"]["confidence"] < 0.5
    assert payload["roic"]["calculation_version"] == "roic_v3_stable_invested_capital"
    assert payload["wacc"]["quality"] == "estimated"
    assert payload["wacc"]["method"] == "latest_capital_structure"
    assert payload["wacc"]["warnings"] == ["Market capitalization was unavailable, so debt and equity weights fall back to statement debt ratio."]
    assert payload["wacc"]["calculation_version"] == "wacc_v2_latest_capital_structure"
    assert payload["spread"]["quality"] == "missing"
    assert payload["spread"]["reason"] == "ROIC - WACC inherits the lower-confidence state of the two source metrics."
    assert payload["spread"]["method"] == "roic_minus_wacc"
    assert payload["spread"]["warnings"] == ["ROIC - WACC inherits the lower-confidence state of ROIC and WACC."]
    assert payload["spread"]["calculation_version"] == "spread_v1_roic_minus_wacc"
    assert payload["dcf"]["quality"] == "missing"
    assert payload["dcf"]["method"] == "dcf_summary_placeholder"


def test_metric_audit_marks_invalid_when_average_invested_capital_is_non_positive(tmp_path, monkeypatch):
    _init_test_db(tmp_path, monkeypatch)
    from apps.api.routes import corporate as corporate_route

    monkeypatch.setattr(
        corporate_route,
        "_get_yahoo_statement_bundle",
        lambda ticker, endpoint: _make_bundle(
            income_rows={
                "2025-12-31": {
                    "Operating Income": 100.0,
                    "Pretax Income": 100.0,
                    "Tax Provision": 15.0,
                    "Interest Expense": 5.0,
                },
            },
            balance_rows={
                "2024-12-31": {
                    "Total Debt": 300000.0,
                    "Stockholders Equity": 400000.0,
                    "Cash And Cash Equivalents": 600000.0,
                },
                "2025-12-31": {
                    "Total Debt": 300000.0,
                    "Stockholders Equity": 400000.0,
                    "Cash And Cash Equivalents": 600000.0,
                },
            },
            info={},
        ),
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/metrics/AAPL/audit")
    assert response.status_code == 200

    payload = response.json()
    assert payload["roic"]["quality"] == "invalid"
    assert payload["roic"]["reason"] == "Invested capital is too small; ROIC denominator unstable."
    assert "Invested capital is too small; ROIC denominator unstable." in payload["roic"]["warnings"]
    assert payload["growth"]["quality"] == "invalid"
    avg_capital = next(item for item in payload["roic"]["inputs_used"] if item["field"] == "average_invested_capital")
    assert avg_capital["value"] is None
    assert payload["spread"]["quality"] == "invalid"


def test_metric_audit_marks_suspicious_when_average_invested_capital_is_too_small_relative_to_nopat(tmp_path, monkeypatch):
    _init_test_db(tmp_path, monkeypatch)
    from apps.api.routes import corporate as corporate_route

    monkeypatch.setattr(
        corporate_route,
        "_get_yahoo_statement_bundle",
        lambda ticker, endpoint: _make_bundle(
            income_rows={
                "2025-12-31": {
                    "Operating Income": 20000000.0,
                    "Pretax Income": 20000000.0,
                    "Tax Provision": 3000000.0,
                    "Interest Expense": 50000.0,
                },
            },
            balance_rows={
                "2024-12-31": {
                    "Total Debt": 500000.0,
                    "Stockholders Equity": 1000000.0,
                    "Cash And Cash Equivalents": 1500000.0,
                },
                "2025-12-31": {
                    "Total Debt": 500000.0,
                    "Stockholders Equity": 1000000.0,
                    "Cash And Cash Equivalents": 1500000.0,
                },
            },
            info={"beta": 1.05},
        ),
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/metrics/AAPL/audit")
    assert response.status_code == 200

    payload = response.json()
    assert payload["roic"]["quality"] == "suspicious"
    assert payload["roic"]["reason"] == "Average invested capital is unusually small relative to NOPAT."
    assert "Average invested capital is unusually small relative to NOPAT." in payload["roic"]["warnings"]
    assert payload["growth"]["quality"] == "invalid"
    assert payload["spread"]["quality"] == "suspicious"
    assert payload["roic"]["inputs_used"]
    assert payload["wacc"]["inputs_used"]
    assert payload["spread"]["inputs_used"]
