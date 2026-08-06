import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import CorporateMetrics
from apps.api.services import db as db_service
from apps.api.services.acquisition.sources.statements import StatementRow
from apps.api.services.acquisition.store import save_statements
from apps.api.services.corporate_statement_metrics import (
    WACC_QUALITY_RULES,
    WACC_SANITY_RULE,
    WACC_WARNING_RULES,
    get_yahoo_statement_bundle,
    metric_audit_for_ticker,
    yahoo_statement_metrics,
)


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


def _fallback_metrics() -> CorporateMetrics:
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
        growth_avg_legacy=5.0,
        growth_cagr_v2=6.0,
        roic_legacy=17.0,
        roic_stable_v2=18.0,
    )


def test_wacc_policy_rules_expose_named_sanity_and_quality_data():
    assert WACC_SANITY_RULE.name == "wacc_percent"
    assert WACC_SANITY_RULE.minimum == 0.0
    assert WACC_SANITY_RULE.maximum == 40.0
    assert [rule.name for rule in WACC_WARNING_RULES] == ["missing_market_cap"]
    assert [rule.name for rule in WACC_QUALITY_RULES] == [
        "missing_capital_structure_inputs",
        "wacc_outside_sanity_range",
    ]


def test_metric_audit_uses_saved_metric_fallback_when_provider_bundle_is_missing():
    audit = metric_audit_for_ticker(
        "aapl",
        _fallback_metrics(),
        has_saved_metrics=True,
        bundle_loader=lambda ticker, endpoint: None,
    )

    assert audit.ticker == "AAPL"
    assert audit.source_mode == "corporate_metrics"
    assert audit.growth.quality == "estimated"
    assert audit.growth.method == "fallback_growth_assumption"
    assert audit.growth.source == "SQLite corporate_metrics fallback"
    assert audit.growth.calculation_version == "growth_v2_stable_cagr"
    assert audit.roic.quality == "estimated"
    assert audit.roic.method == "stable_invested_capital"
    assert audit.roic.source == "SQLite corporate_metrics fallback"
    assert audit.roic.calculation_version == "roic_v3_stable_invested_capital"
    assert audit.wacc.quality == "estimated"
    assert audit.wacc.method == "latest_capital_structure"
    assert audit.spread.quality == "estimated"
    assert audit.spread.value == 8.0
    assert audit.dcf is not None
    assert audit.dcf.quality == "missing"


def test_metric_audit_uses_default_model_fallback_when_provider_and_saved_metrics_are_missing():
    audit = metric_audit_for_ticker(
        "aapl",
        _fallback_metrics(),
        has_saved_metrics=False,
        bundle_loader=lambda ticker, endpoint: None,
    )

    assert audit.ticker == "AAPL"
    assert audit.source_mode == "default_model"
    assert audit.growth.source == "Deterministic default model fallback"
    assert audit.roic.source == "Deterministic default model fallback"
    assert audit.wacc.source == "Deterministic default model fallback"
    assert audit.growth.warnings == [
        "Yahoo statement inputs were unavailable, so the UI is using saved or deterministic fallback assumptions."
    ]
    assert audit.roic.inputs_used[0].field == "final_roic_value"
    assert audit.roic.inputs_used[0].value == 18.0
    assert audit.spread.inputs_used[0].field == "roic"
    assert audit.spread.inputs_used[1].field == "wacc"
    assert audit.growth.calculation_version == "growth_v2_stable_cagr"
    assert audit.roic.calculation_version == "roic_v3_stable_invested_capital"


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


def test_metric_audit_surfaces_fallback_tax_rate_and_keeps_unified_payload(tmp_path, monkeypatch):
    _init_test_db(tmp_path, monkeypatch)
    from apps.api.routes import corporate as corporate_route

    monkeypatch.setattr(
        corporate_route,
        "_get_yahoo_statement_bundle",
        lambda ticker, endpoint: _make_bundle(
            income_rows={
                "2024-12-31": {
                    "Total Revenue": 1_000_000.0,
                    "Operating Income": 100_000.0,
                    "Pretax Income": -10_000.0,
                    "Tax Provision": 5_000.0,
                    "Interest Expense": 5_000.0,
                },
                "2025-12-31": {
                    "Total Revenue": 1_100_000.0,
                    "Operating Income": 120_000.0,
                    "Pretax Income": 0.0,
                    "Tax Provision": 7_000.0,
                    "Interest Expense": 5_000.0,
                },
            },
            balance_rows={
                "2024-12-31": {
                    "Total Debt": 2_000_000.0,
                    "Stockholders Equity": 8_000_000.0,
                },
                "2025-12-31": {
                    "Total Debt": 2_200_000.0,
                    "Stockholders Equity": 8_200_000.0,
                },
            },
            info={"beta": 1.05},
        ),
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/metrics/AAPL/audit")
    assert response.status_code == 200

    payload = response.json()
    assert set(payload) >= {"growth", "roic", "wacc", "dcf"}
    assert payload["roic"]["quality"] == "estimated"
    assert payload["roic"]["method"] == "stable_invested_capital"
    assert payload["roic"]["warnings"][0] == "ROIC uses recent average rather than a single fiscal year."
    assert "No valid positive statement tax rate found." in payload["roic"]["warnings"]
    tax_rate = next(item for item in payload["roic"]["inputs_used"] if item["field"] == "tax_rate")
    assert tax_rate["source"] == "fallback_default"


def test_bundle_comes_from_the_local_store_and_never_the_network():
    """The architectural invariant: metric computation never acquires. The suite's
    _forbid_network guard fails any test that reaches out, so this passing IS the proof."""
    save_statements("LOCAL", [StatementRow("LOCAL", "income", "annual", "2025-09-30", "Total Revenue", 42.0)])

    bundle = get_yahoo_statement_bundle("LOCAL", "audit")

    assert bundle["income"].loc["Total Revenue", "2025-09-30"] == 42.0


def test_stored_statements_actually_drive_the_metric_layer(tmp_path, monkeypatch):
    """The seam the other store tests miss: they assert on the frame, not on what the
    metric layer makes of it.

    load_statement_bundle labels frame columns with period_end, which SQLite returns as
    TEXT. _safe_statement_year does getattr(col, "year", 0), so a str column yields 0,
    every row is dropped as older than YAHOO_STATEMENT_START_YEAR, and every
    statement-derived metric silently falls back -- while the audit still reports
    source_mode="yahoo_finance". Frame-level round-trip assertions pass throughout.
    """
    _init_test_db(tmp_path, monkeypatch)

    rows = []
    for year, revenue, operating in ((2024, 1_000_000.0, 100_000.0), (2025, 1_100_000.0, 120_000.0)):
        period = f"{year}-12-31"
        for item, value in (
            ("Total Revenue", revenue),
            ("Operating Income", operating),
            ("Pretax Income", operating),
            ("Tax Provision", operating * 0.25),
        ):
            rows.append(StatementRow("SEAM", "income", "annual", period, item, value))
        for item, value in (("Total Debt", 2_000_000.0), ("Stockholders Equity", 8_000_000.0)):
            rows.append(StatementRow("SEAM", "balance", "annual", period, item, value))
    save_statements("SEAM", rows)

    fallback = CorporateMetrics(
        ticker="SEAM", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74,
        esg_penalty=22,
    )

    # No bundle_loader argument: this must exercise the production default.
    metrics = yahoo_statement_metrics("SEAM", fallback)

    assert metrics is not None, "stored statements produced no metrics at all"
    # Revenue grew 10% across the two stored years. If the columns were unreadable this
    # would silently be the fallback's 6.
    assert metrics.growth == pytest.approx(10.0, abs=0.5)


def test_a_ticker_with_nothing_stored_returns_none():
    assert get_yahoo_statement_bundle("NEVERSTORED", "audit") is None


def test_the_same_stored_data_yields_identical_metrics_twice():
    """Reproducibility, stated in the spec: given identical locally stored acquisition
    data, metric computation always produces identical outputs regardless of process
    restart, network availability, or execution time. Within one process the strongest
    available check is that two computations over unchanged storage agree exactly."""
    save_statements("REPRO", [
        StatementRow("REPRO", "income", "annual", "2025-09-30", "Total Revenue", 100.0),
        StatementRow("REPRO", "income", "annual", "2024-09-30", "Total Revenue", 90.0),
    ])

    first = get_yahoo_statement_bundle("REPRO", "audit")
    second = get_yahoo_statement_bundle("REPRO", "audit")

    assert first["income"].equals(second["income"])
    assert first["info"] == second["info"]
