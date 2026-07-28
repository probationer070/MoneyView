import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import CorporateMetrics
from apps.api.services import db as db_service
from apps.api.services.corporate_statement_metrics import (
    WACC_QUALITY_RULES,
    WACC_SANITY_RULE,
    WACC_WARNING_RULES,
    YAHOO_STATEMENT_CACHE_TTL_SECONDS,
    _YAHOO_STATEMENT_CACHE,
    get_yahoo_statement_bundle,
    metric_audit_for_ticker,
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


def test_yahoo_statement_bundle_returns_none_for_known_provider_missing_data(monkeypatch):
    class MissingDataTicker:
        @property
        def financials(self):
            raise ValueError("provider returned malformed statement payload")

    _YAHOO_STATEMENT_CACHE.clear()
    monkeypatch.setitem(sys.modules, "yfinance", SimpleNamespace(Ticker=lambda ticker: MissingDataTicker()))

    assert get_yahoo_statement_bundle("KNOWNMISS", "audit") is None


def test_yahoo_statement_bundle_does_not_hide_unexpected_provider_bug(monkeypatch):
    class BuggyTicker:
        @property
        def financials(self):
            raise RuntimeError("unexpected provider bug")

    _YAHOO_STATEMENT_CACHE.clear()
    monkeypatch.setitem(sys.modules, "yfinance", SimpleNamespace(Ticker=lambda ticker: BuggyTicker()))

    try:
        get_yahoo_statement_bundle("BUGGY", "audit")
    except RuntimeError as exc:
        assert str(exc) == "unexpected provider bug"
    else:
        raise AssertionError("unexpected provider bugs should not be converted to missing data")


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


# The comparison fan-out's cost is set by two cache parameters that must be derived from the
# workload, not chosen. Both were wrong (300s / 48) and each alone forced a 0% hit rate across
# a full baseline run -- 587 misses, 0 hits (ERROR-LOG 2026-07-26). These two tests pin the
# derivation so a later "tidy up the magic numbers" cannot silently restore a 0% cache.

# Measured wall-clock of one serial 138-ticker sweep of /corporate/comparison?mode=live.
MEASURED_FULL_SWEEP_SECONDS = 357

# The watchlist the sweep walks. The cache must hold a whole sweep with room to spare.
MEASURED_WATCHLIST_SIZE = 139


def test_statement_cache_ttl_outlives_one_full_sweep():
    """A TTL shorter than the fan-out it guards has a zero hit rate by construction:
    ticker #1 expires before ticker #138 is fetched, so the next request misses on all
    138 again. 300s against a 357s sweep did exactly that."""
    assert YAHOO_STATEMENT_CACHE_TTL_SECONDS > MEASURED_FULL_SWEEP_SECONDS


def test_statement_cache_holds_a_full_sweep_without_evicting_itself():
    """Capacity defeats any TTL, however long. At maxsize 48 a 139-ticker sweep evicts its
    own first ~90 entries before finishing, so raising the TTL to 86400s still measured 0
    hits. The cache must outlive the sweep that fills it."""
    _YAHOO_STATEMENT_CACHE.clear()
    try:
        for index in range(MEASURED_WATCHLIST_SIZE):
            _YAHOO_STATEMENT_CACHE[f"TICKER{index}"] = {"fetched_at": datetime.now(timezone.utc)}

        assert "TICKER0" in _YAHOO_STATEMENT_CACHE, (
            f"the sweep evicted its own first entry: maxsize={_YAHOO_STATEMENT_CACHE.maxsize} "
            f"is below the {MEASURED_WATCHLIST_SIZE}-ticker watchlist it has to hold"
        )
        assert len(_YAHOO_STATEMENT_CACHE) == MEASURED_WATCHLIST_SIZE
    finally:
        _YAHOO_STATEMENT_CACHE.clear()
