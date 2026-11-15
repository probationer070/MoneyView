"""Both Ke paths use the resolver's assumptions through one CAPM function (plan 2026-11-16 S2a).

Each `check_*` takes the statement-metrics module so tests/api/test_statement_metrics_assumptions_mutations.py
can run it against an in-memory mutated copy and require it to FAIL.
"""
import pandas as pd
import pytest

from apps.api.models.schemas import CorporateMetrics
from apps.api.services import corporate_statement_metrics as real_module
from apps.api.services.market_assumptions import (
    Assumptions,
    AssumptionsMissing,
    AssumptionsRefused,
    capm_cost_of_equity_pct,
)
from tests.api.seed_assumptions import SEED_ASSUMPTIONS

BILLION = 1_000_000_000.0
LIVE = Assumptions(
    risk_free_rate=3.0, risk_free_source="FRED DGS10", risk_free_as_of="2026-11-13",
    equity_risk_premium=7.0, erp_source="Damodaran", erp_as_of="2026-11-01",
    crp_non_mature=0.8, crp_as_of="2026-11-16",
)
BETA = 1.2
LIVE_KE = 3.0 + BETA * 7.0 + 0.8  # 12.2


def _fallback():
    return CorporateMetrics(
        ticker="TEST", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64,
        governance=74, esg_penalty=22,
    )


def _bundle(currency="KRW"):
    years = ["2023-12-31", "2024-12-31", "2025-12-31"]
    frame = lambda rows: pd.DataFrame(rows, index=pd.to_datetime(years)).T
    income = frame({
        "Total Revenue": [100 * BILLION, 110 * BILLION, 120 * BILLION],
        "Operating Income": [20 * BILLION, 22 * BILLION, 24 * BILLION],
        "Pretax Income": [18 * BILLION, 20 * BILLION, 22 * BILLION],
        "Tax Provision": [4 * BILLION, 4.4 * BILLION, 4.8 * BILLION],
        "Interest Expense": [2 * BILLION] * 3,
    })
    balance = frame({"Total Debt": [50 * BILLION] * 3, "Stockholders Equity": [150 * BILLION] * 3})
    empty = pd.DataFrame()
    return {
        "ticker": "TEST", "income": income, "balance": balance, "cashflow": empty,
        "quarterly_income": empty, "quarterly_balance": empty, "quarterly_cashflow": empty,
        "info": {"beta": BETA, "financialCurrency": currency}, "fetched_at": None,
    }


def _statement(mod, assumptions):
    return mod.yahoo_statement_metrics(
        "TEST", _fallback(), bundle_loader=lambda t, e: _bundle(), assumptions=assumptions
    )


def _audit(mod, assumptions):
    return mod.metric_audit_for_ticker(
        "TEST", _fallback(), has_saved_metrics=False, bundle_loader=lambda t, e: _bundle(), assumptions=assumptions
    )


def _audit_inputs(audit):
    return {item.field: item for item in audit.wacc.inputs_used}


def check_statement_path_ke_uses_assumptions(mod):
    # mutations A: statement path (yahoo_statement_metrics) back to the 4.2 / 5.5 literals
    assert _statement(mod, LIVE).cost_of_equity == pytest.approx(LIVE_KE, abs=1e-3)


def check_audit_path_ke_uses_assumptions(mod):
    # mutation B: audit path (metric_audit_for_ticker) back to the 4.2 / 5.5 literals
    ke = _audit_inputs(_audit(mod, LIVE))["cost_of_equity"]
    assert ke.value == pytest.approx(LIVE_KE / 100, abs=1e-6)


def check_audit_rows_carry_the_assumptions(mod):
    # mutation: the audit rows keep their own literal / "Model policy input" source
    inputs = _audit_inputs(_audit(mod, LIVE))
    assert inputs["risk_free_rate"].value == pytest.approx(0.03)
    assert inputs["risk_free_rate"].source == "FRED DGS10"
    assert inputs["equity_risk_premium"].value == pytest.approx(0.07)
    assert inputs["equity_risk_premium"].source == "Damodaran"


def check_refusal_has_no_wacc(mod):
    # mutation: the refusal branch computes with 4.2 / 5.5 (or returns the fallback numbers)
    metrics = _statement(mod, AssumptionsMissing(missing=("risk_free",)))
    assert metrics is not None
    assert metrics.wacc is None
    assert metrics.cost_of_equity is None
    assert metrics.wacc_refusal.code == "assumptions_missing"
    assert metrics.wacc_refusal.missing == ["risk_free"]


def check_audit_refuses_without_assumptions(mod):
    with pytest.raises(AssumptionsRefused) as raised:
        _audit(mod, AssumptionsMissing(missing=("erp",)))
    assert raised.value.missing == ("erp",)


CHECKS = [
    check_statement_path_ke_uses_assumptions,
    check_audit_path_ke_uses_assumptions,
    check_audit_rows_carry_the_assumptions,
    check_refusal_has_no_wacc,
    check_audit_refuses_without_assumptions,
]


@pytest.mark.parametrize("check", CHECKS, ids=lambda c: c.__name__)
def test_statement_metrics_check(check):
    check(real_module)


def test_capm_function_example_from_the_plan():
    a = Assumptions(4.1, "FRED DGS10", "2026-11-13", 5.8, "owner", "2026-11-16", 0.8, "2026-11-16")
    assert capm_cost_of_equity_pct(a, 1.2, 0.8) == pytest.approx(11.86)


def test_seed_assumptions_give_todays_numbers():
    assert _statement(real_module, SEED_ASSUMPTIONS).cost_of_equity == pytest.approx(4.2 + BETA * 5.5 + 0.8, abs=1e-3)


# ---- route level: the Ke and the echo come from the same resolver result ----

from datetime import datetime, timezone  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.main import app  # noqa: E402
from apps.api.routes import corporate as corporate_route  # noqa: E402
from apps.api.services.db import get_db  # noqa: E402

client = TestClient(app)


def _live_rows():
    today = datetime.now(timezone.utc).date().isoformat()
    with get_db() as conn:
        conn.execute("INSERT INTO fred_cache VALUES ('DGS10', ?, 3.0, 'x')", (today,))
        conn.execute("INSERT INTO market_assumptions VALUES ('equity_risk_premium', 7.0, '2026-12-01', 'Damodaran', 'x')")


def check_route_ke_equals_the_echoed_inputs(monkeypatch):
    # mutation: the statement path is fed the seed instead of the resolver result the echo reports
    _live_rows()
    monkeypatch.setattr(corporate_route, "_get_yahoo_statement_bundle", lambda t, e: _bundle())
    body = client.get("/api/v1/corporate/metrics/TEST").json()
    echo = body["assumptions"]
    assert (echo["risk_free_rate"], echo["equity_risk_premium"]) == (3.0, 7.0)
    assert body["cost_of_equity"] == pytest.approx(echo["risk_free_rate"] + BETA * echo["equity_risk_premium"] + echo["crp"], abs=1e-3)


def check_route_refuses_without_assumptions(monkeypatch):
    # mutation: the DCF route falls back to the seed numbers when the resolver has nothing
    with get_db() as conn:
        conn.execute("DELETE FROM market_assumptions WHERE key = 'risk_free_fallback'")
    monkeypatch.setattr(corporate_route, "_get_yahoo_statement_bundle", lambda t, e: _bundle())
    metrics = client.get("/api/v1/corporate/metrics/TEST")
    assert metrics.status_code == 200
    body = metrics.json()
    assert body["wacc"] is None and body["cost_of_equity"] is None and body["assumptions"] is None
    assert body["wacc_refusal"] == {"code": "assumptions_missing", "missing": ["risk_free"]}
    dcf = client.post("/api/v1/corporate/dcf/TEST", json={
        "revenue_growth_rate": 0.05, "operating_margin": 0.2, "tax_rate": 0.2, "wacc": 0.1,
        "terminal_growth_rate": 0.02, "forecast_years": 5,
    })
    assert dcf.status_code == 200
    assert dcf.json() == {"status": "unavailable", "reason": "assumptions_missing",
                          "wacc_refusal": {"code": "assumptions_missing", "missing": ["risk_free"]}}


def test_route_ke_equals_the_echoed_inputs(monkeypatch):
    check_route_ke_equals_the_echoed_inputs(monkeypatch)


def test_route_refuses_without_assumptions(monkeypatch):
    check_route_refuses_without_assumptions(monkeypatch)
