"""DCF, comparison, decision, baseline and fair value read the resolver; refusal is handled (plan 2026-11-16 S2b).

Each `check_*` takes the module under test so tests/api/test_s2b_assumptions_mutations.py can run it against an
in-memory mutated copy and require it to FAIL (guideline/sop/test-verification.md).
"""
import inspect

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schema_parts.corporate import (
    BridgeInputMeta,
    BridgeSource,
    ValuationAssumptions,
    WaccRefusal,
)
from apps.api.models.schemas import CorporateMetrics
from apps.api.services import corporate_comparison as real_comparison
from apps.api.services import corporate_dcf as real_dcf
from apps.api.services import corporate_statement_metrics as csm
from apps.api.services import investment_decision as real_decision
from apps.api.services.db import get_db
from apps.api.services.equity_bridge import EquityBridge
from apps.api.services.market_assumptions import Assumptions, AssumptionsMissing, AssumptionsRefused

LIVE = Assumptions(
    risk_free_rate=3.0, risk_free_source="FRED DGS10", risk_free_as_of="2026-11-13",
    equity_risk_premium=7.0, erp_source="Damodaran", erp_as_of="2026-11-01",
    crp_non_mature=0.8, crp_as_of="2026-11-16",
)
MISSING = AssumptionsMissing(missing=("risk_free", "erp"))
client = TestClient(app)


def _metrics(wacc=10.0, refused=False):
    return CorporateMetrics(
        ticker="TEST", growth=6, roic=18, wacc=None if refused else wacc, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22,
        wacc_refusal=WaccRefusal(missing=["risk_free"]) if refused else None,
    )


def _bridge():
    meta = lambda v, s: BridgeInputMeta(value=v, source=s, quality="ok", as_of="2025-09-30")
    return EquityBridge(
        net_debt=meta(60.0, BridgeSource.TOTAL_DEBT_LESS_CASH),
        non_operating_assets=meta(5.0, BridgeSource.INVESTMENTS_ADVANCES),
        diluted_shares_outstanding=meta(15.0, BridgeSource.DILUTED_AVERAGE_SHARES),
    )


def _params():
    return ValuationAssumptions(
        revenue_growth_rate=0.06, operating_margin=0.25, tax_rate=0.21, wacc=0.10,
        terminal_growth_rate=0.02, fcff=100.0, esg_penalty=22.0,
    )


# --- DCF ---------------------------------------------------------------------------------------------------

def check_dcf_breakdown_equals_the_echo(mod):
    _, _, full = mod._build_dcf_outputs(
        ticker="TEST", params=_params(), current_price_loader=lambda t: 100.0, metrics_loader=lambda t: _metrics(),
        risk_free_rate=LIVE.rf_fraction, equity_risk_premium=LIVE.erp_fraction, country_risk_premium=0.008,
        bridge_loader=lambda t: _bridge(), assumptions=LIVE,
    )
    b = full.wacc_breakdown
    assert (b.risk_free_rate, b.equity_risk_premium) == (pytest.approx(0.03), pytest.approx(0.07))
    assert (b.risk_free_source, b.risk_free_as_of) == ("FRED DGS10", "2026-11-13")
    assert (b.erp_source, b.erp_as_of) == ("Damodaran", "2026-11-01")


def check_dcf_breakdown_without_assumptions_is_legacy_null(mod):
    _, _, full = mod._build_dcf_outputs(
        ticker="TEST", params=_params(), current_price_loader=lambda t: 100.0, metrics_loader=lambda t: _metrics(),
        risk_free_rate=0.042, equity_risk_premium=0.055, country_risk_premium=0.008, bridge_loader=lambda t: _bridge(),
    )
    b = full.wacc_breakdown
    assert (b.risk_free_source, b.risk_free_as_of, b.erp_source, b.erp_as_of) == (None, None, None, None)


def check_dcf_builders_have_no_premium_default(mod):
    for name in ("build_dcf_summary", "build_dcf_full_report", "build_bulk_dcf_reports"):
        default = inspect.signature(getattr(mod, name)).parameters["equity_risk_premium"].default
        assert default is inspect.Parameter.empty, f"{name} still defaults equity_risk_premium to {default!r}"
    assert not hasattr(mod, "DEFAULT_EQUITY_RISK_PREMIUM")


def check_bulk_reports_carry_the_echo(mod):
    """The injected report builder takes no assumptions keyword; the bulk wrapper stamps the echo on its result."""
    def report_builder(ticker, params, **kwargs):
        return mod._build_dcf_outputs(
            ticker=ticker, params=params, bridge_loader=lambda t: _bridge(), **kwargs)[2]

    result = mod.build_bulk_dcf_reports(
        ["AAA"], current_price_loader=lambda t: 100.0, metrics_loader=lambda t: _metrics(),
        valuation_params_builder=lambda m: _params(), report_builder=report_builder,
        risk_free_rate=LIVE.rf_fraction, equity_risk_premium=LIVE.erp_fraction, assumptions=LIVE,
    )
    assert result.skipped == []
    b = result.reports[0].wacc_breakdown
    assert (b.risk_free_source, b.risk_free_as_of, b.erp_source, b.erp_as_of) == (
        "FRED DGS10", "2026-11-13", "Damodaran", "2026-11-01")


# --- comparison --------------------------------------------------------------------------------------------

def check_snapshot_identity_changes_with_erp(mod):
    args = dict(universe_key="u", snapshot_date="2026-11-16", risk_free_rate=0.042)
    assert mod._snapshot_version_id(**args, equity_risk_premium=0.055) != mod._snapshot_version_id(
        **args, equity_risk_premium=0.07
    )


def check_comparison_snapshot_refuses_without_wacc(mod):
    with pytest.raises(AssumptionsRefused) as raised:
        mod._dcf_snapshot(
            ticker="TEST", metrics=_metrics(refused=True), price_loader=lambda t: 100.0,
            risk_free_rate=0.042, equity_risk_premium=0.055, bridge_loader=lambda t: _bridge(),
            currency_check=lambda t: None,
        )
    assert raised.value.missing == ("risk_free",)


# --- decisions ---------------------------------------------------------------------------------------------

def _decision_row(decision_id):
    with get_db() as conn:
        return dict(conn.execute("SELECT * FROM investment_decision WHERE id = ?", (decision_id,)).fetchone())


def _figures_ok(ticker):
    return {"price_at_decision": 100.0, "dcf_value": 90.0, "dcf_implied_return": 1.0, "roic": 10.0, "wacc": 8.0,
            "source": "test"}


def check_decision_stores_the_resolvers_as_of(mod, monkeypatch):
    monkeypatch.setattr(mod, "_resolve_now", lambda: LIVE)
    row = _decision_row(mod.record_decision(ticker="AAA", action="buy", memo="m", figures_loader=_figures_ok))
    assert row["risk_free_rate"] == pytest.approx(0.03) and row["equity_risk_premium"] == pytest.approx(0.07)
    assert row["assumptions_as_of"] == "2026-11-01"  # the older of rf (2026-11-13) and ERP (2026-11-01)


def check_decision_with_explicit_rates_has_no_as_of(mod, monkeypatch):
    monkeypatch.setattr(mod, "_resolve_now", lambda: pytest.fail("the resolver must not be read"))
    row = _decision_row(mod.record_decision(
        ticker="AAA", action="buy", memo="m", figures_loader=_figures_ok, risk_free_rate=0.05, equity_risk_premium=0.06))
    assert row["risk_free_rate"] == 0.05 and row["assumptions_as_of"] is None


def check_decision_with_missing_assumptions_keeps_the_memo(mod, monkeypatch):
    monkeypatch.setattr(mod, "_resolve_now", lambda: MISSING)
    row = _decision_row(mod.record_decision(ticker="AAA", action="buy", memo="why", figures_loader=_figures_ok))
    assert row["memo"] == "why" and row["price_at_decision"] is None
    assert row["risk_free_rate"] is None and row["assumptions_as_of"] is None
    assert "assumptions_missing" in row["figures_unavailable_reason"]


def check_default_loader_refusal_is_recorded_not_raised(mod, monkeypatch):
    def refuse(ticker, **_):
        raise AssumptionsRefused(("erp",))

    monkeypatch.setattr(mod, "_resolve_now", lambda: LIVE)
    monkeypatch.setattr(mod, "_default_figures_loader", refuse)
    row = _decision_row(mod.record_decision(ticker="AAA", action="buy", memo="m"))
    assert row["price_at_decision"] is None and "assumptions_missing" in row["figures_unavailable_reason"]


def check_legacy_null_decision_still_reads():
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO investment_decision (ticker, decided_at, action, memo, risk_free_rate, equity_risk_premium, "
            "figures_source, sync_uid) VALUES ('OLD', '2026-01-01T00:00:00+00:00', 'watch', 'old', 0.042, 0.055, 'x', 'u1')"
        )
        decision_id = cursor.lastrowid
    one = client.get(f"/api/v1/decisions/{decision_id}")
    assert one.status_code == 200, one.text
    assert one.json()["data"]["assumptions_as_of"] is None
    assert one.json()["data"]["risk_free_rate"] == 0.042  # frozen, never re-read from the resolver
    listed = client.get("/api/v1/decisions")
    assert listed.status_code == 200, listed.text
    assert [r["assumptions_as_of"] for r in listed.json()["data"]] == [None]


# --- baseline and fair value ---------------------------------------------------------------------------------

def _no_assumptions_on_file():
    with get_db() as conn:
        conn.execute("DELETE FROM market_assumptions")


def check_fair_value_refuses_without_assumptions(mod):
    _no_assumptions_on_file()
    case_id, created, vintage, reason = mod.generate_fair_value_case_for_ticker("FAIR", bundle_loader=lambda t, e: None)
    assert (case_id, created, vintage) == (None, False, None)
    assert reason.startswith("assumptions_missing:") and "risk_free" in reason


def check_baseline_refuses_without_assumptions(mod):
    _no_assumptions_on_file()
    case_id, reason = mod.generate_conservative_case_for_ticker("FAIR", bundle_loader=lambda t, e: None)
    assert case_id is None and reason.startswith("assumptions_missing:") and "risk_free" in reason


def check_fair_value_route_says_why_without_assumptions():
    _no_assumptions_on_file()
    response = client.post("/api/v1/valuation/fair-value/FAIR")
    assert response.status_code == 422 and response.json()["detail"].startswith("assumptions_missing:")


# --- history -------------------------------------------------------------------------------------------------

def _history_bundle(currency):
    years = pd.to_datetime(["2023-12-31", "2024-12-31", "2025-12-31"])
    frame = lambda rows: pd.DataFrame(rows, index=years).T
    income = frame({"Total Revenue": [100e9, 110e9, 120e9], "Operating Income": [20e9, 22e9, 24e9]})
    empty = pd.DataFrame()
    return {"ticker": "TEST", "income": income, "balance": empty, "cashflow": empty, "quarterly_income": empty,
            "quarterly_balance": empty, "quarterly_cashflow": empty, "info": {"financialCurrency": currency}}


def check_history_crp_is_null_not_a_default(mod):
    loader = lambda t, e: _history_bundle("KRW")
    assert mod.yahoo_metric_history("TEST", bundle_loader=loader, assumptions=MISSING)["country_risk_premium"] is None
    assert mod.yahoo_metric_history("TEST", bundle_loader=loader, assumptions=LIVE)["country_risk_premium"] == 0.8
    usd = lambda t, e: _history_bundle("USD")
    assert mod.yahoo_metric_history("TEST", bundle_loader=usd, assumptions=MISSING)["country_risk_premium"] == 0.0


# --- the tests that run against the real modules ---------------------------------------------------------------

def test_dcf_breakdown_equals_the_echo():
    check_dcf_breakdown_equals_the_echo(real_dcf)


def test_dcf_breakdown_without_assumptions_is_legacy_null():
    check_dcf_breakdown_without_assumptions_is_legacy_null(real_dcf)


def test_dcf_builders_have_no_premium_default():
    check_dcf_builders_have_no_premium_default(real_dcf)


def test_bulk_reports_carry_the_echo():
    check_bulk_reports_carry_the_echo(real_dcf)


def test_snapshot_identity_changes_with_erp():
    check_snapshot_identity_changes_with_erp(real_comparison)


def test_comparison_snapshot_refuses_without_wacc():
    check_comparison_snapshot_refuses_without_wacc(real_comparison)


def test_decision_stores_the_resolvers_as_of(monkeypatch):
    check_decision_stores_the_resolvers_as_of(real_decision, monkeypatch)


def test_decision_with_explicit_rates_has_no_as_of(monkeypatch):
    check_decision_with_explicit_rates_has_no_as_of(real_decision, monkeypatch)


def test_decision_with_missing_assumptions_keeps_the_memo(monkeypatch):
    check_decision_with_missing_assumptions_keeps_the_memo(real_decision, monkeypatch)


def test_default_loader_refusal_is_recorded_not_raised(monkeypatch):
    check_default_loader_refusal_is_recorded_not_raised(real_decision, monkeypatch)


def test_legacy_null_decision_still_reads():
    check_legacy_null_decision_still_reads()


def test_fair_value_refuses_without_assumptions():
    from apps.api.services import fair_value
    check_fair_value_refuses_without_assumptions(fair_value)


def test_baseline_refuses_without_assumptions():
    from apps.api.services import company_baseline
    check_baseline_refuses_without_assumptions(company_baseline)


def test_fair_value_route_says_why_without_assumptions():
    check_fair_value_route_says_why_without_assumptions()


def test_history_crp_is_null_not_a_default():
    check_history_crp_is_null_not_a_default(csm)
