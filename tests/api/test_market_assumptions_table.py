"""market_assumptions table, seed and the /metrics echo (plan 2026-11-16-wacc-ke-live-premia section 1, S1)."""
import sqlite3
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schemas import CorporateMetrics
from apps.api.routes import corporate as corporate_route
from apps.api.services import market_assumptions as ma
from apps.api.services.db import get_db, init_db

client = TestClient(app)


def _insert(conn, key="equity_risk_premium", value=5.5, as_of="2026-12-01", source="owner"):
    conn.execute(
        "INSERT INTO market_assumptions (key, value, as_of, source, updated_at) VALUES (?, ?, ?, ?, 'x')",
        (key, value, as_of, source),
    )


def _rows():
    with get_db() as conn:
        return [tuple(r) for r in conn.execute(
            "SELECT key, value, as_of, source FROM market_assumptions ORDER BY key, as_of")]


def test_seed_rows_and_idempotent_reinit():
    # mutation: seed written as INSERT OR REPLACE
    seed = [
        ("crp_non_mature", 0.8, "2026-11-16", "owner"),
        ("equity_risk_premium", 5.5, "2026-11-16", "owner"),
        ("risk_free_fallback", 4.2, "2026-11-16", "owner"),
    ]
    assert _rows() == seed
    with get_db() as conn:
        conn.execute("UPDATE market_assumptions SET value = 5.0, source = 'edited' WHERE key = 'equity_risk_premium'")
    init_db()
    init_db()
    rows = _rows()
    assert len(rows) == 3
    assert ("equity_risk_premium", 5.0, "2026-11-16", "edited") in rows


def test_check_rejects_out_of_range_and_unknown_key():
    # mutation: CHECK constraints dropped
    with get_db() as conn:
        with pytest.raises(sqlite3.IntegrityError):
            _insert(conn, value=50.0)
        with pytest.raises(sqlite3.IntegrityError):
            _insert(conn, key="made_up_key")
        with pytest.raises(sqlite3.IntegrityError):
            _insert(conn, source="")


def test_primary_key_rejects_duplicate_key_as_of():
    # mutation: PRIMARY KEY (key, as_of) dropped
    with get_db() as conn:
        with pytest.raises(sqlite3.IntegrityError):
            _insert(conn, as_of="2026-11-16")


def test_metrics_echo_equals_resolver_output(monkeypatch):
    # mutation: route echoes module constants instead of the resolver result
    today = datetime.now(timezone.utc).date().isoformat()
    with get_db() as conn:
        conn.execute("INSERT INTO market_assumptions VALUES ('equity_risk_premium', 5.9, '2026-11-20', 'Damodaran', 'x')")
        conn.execute("INSERT INTO fred_cache VALUES ('DGS10', ?, 4.37, 'x')", (today,))
        expected = ma.resolve_assumptions(conn, datetime.now(timezone.utc))
    monkeypatch.setattr(
        corporate_route, "_metrics_for_ticker",
        lambda ticker, **kw: CorporateMetrics(ticker=ticker, crp=0.8),
    )
    body = client.get("/api/v1/corporate/metrics/AAPL").json()
    assert body["assumptions"] == {
        "risk_free_rate": expected.risk_free_rate, "risk_free_source": "FRED DGS10",
        "risk_free_as_of": expected.risk_free_as_of, "equity_risk_premium": 5.9, "erp_source": "Damodaran",
        "erp_as_of": "2026-11-20", "crp": 0.8, "crp_basis": "non_mature_rule", "stale": [],
    }
    assert body["assumptions"]["risk_free_rate"] == 4.37
    assert body["wacc_refusal"] is None


def test_metrics_echo_for_mature_market_reporter_has_zero_crp(monkeypatch):
    monkeypatch.setattr(
        corporate_route, "_metrics_for_ticker",
        lambda ticker, **kw: CorporateMetrics(ticker=ticker, crp=0.0),
    )
    a = client.get("/api/v1/corporate/metrics/AAPL").json()["assumptions"]
    assert (a["crp"], a["crp_basis"]) == (0.0, "mature_market_rule")


def test_metrics_with_missing_assumptions_returns_refusal_flag_not_a_number(monkeypatch):
    monkeypatch.setattr(
        corporate_route, "_metrics_for_ticker",
        lambda ticker, **kw: CorporateMetrics(ticker=ticker),
    )
    with get_db() as conn:
        conn.execute("DELETE FROM market_assumptions WHERE key = 'risk_free_fallback'")
    body = client.get("/api/v1/corporate/metrics/AAPL").json()
    assert body["assumptions"] is None
    assert body["wacc_refusal"] == {"code": "assumptions_missing", "missing": ["risk_free"]}
