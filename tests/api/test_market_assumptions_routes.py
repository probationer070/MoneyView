"""GET/PUT /api/v1/market-assumptions (plan 2026-11-16-wacc-ke-live-premia, S4)."""
import re
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.routes import market_assumptions as route
from apps.api.services import market_assumptions as ma
from apps.api.services.db import get_db

client = TestClient(app)
URL = "/api/v1/market-assumptions"


class _FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _frozen_clock(monkeypatch):
    monkeypatch.setattr(route, "datetime", _FrozenDateTime)


def _put(**over):
    body = {"key": "equity_risk_premium", "value": 5.2, "as_of": "2026-11-17", "source": "Damodaran Nov 2026"}
    body.update(over)
    return client.put(URL, json=body)


def _count():
    with get_db() as conn:
        return conn.execute("SELECT COUNT(*) FROM market_assumptions").fetchone()[0]


def test_get_shape():
    # mutation: GET returns no history
    data = client.get(URL).json()
    assert data["current"]["equity_risk_premium"] == 5.5
    assert data["current"]["erp_source"] == "owner"
    assert data["current"]["erp_as_of"] == "2026-11-16"
    assert "stale" in data["current"]
    assert data["missing"] == []
    assert {h["key"] for h in data["history"]} == {"risk_free_fallback", "equity_risk_premium", "crp_non_mature"}


def test_put_appends_and_resolver_sees_it():
    # mutation: PUT updates the seed row instead of inserting
    before = _count()
    res = _put()
    assert res.status_code == 200
    assert res.json()["value"] == 5.2
    assert _count() == before + 1
    with get_db() as conn:
        resolved = ma.resolve_assumptions(conn, datetime(2026, 12, 1))
        seed = conn.execute(
            "SELECT value FROM market_assumptions WHERE key='equity_risk_premium' AND as_of='2026-11-16'").fetchone()
    assert resolved.equity_risk_premium == 5.2 and resolved.erp_as_of == "2026-11-17"
    assert seed["value"] == 5.5
    assert client.get(URL).json()["current"]["equity_risk_premium"] == 5.2


@pytest.mark.parametrize("over", [
    {"key": "beta"},
    {"value": 1.9},          # mutation: ERP range check removed
    {"value": 12.1},
    {"key": "crp_non_mature", "value": -0.1},
    {"key": "risk_free_fallback", "value": 15.5},
    {"as_of": "2026/12/01"},
    {"as_of": "2026-13-40"},
    {"as_of": "20261201"},
    {"as_of": "2026-12-03"},  # mutation: future check removed
    {"source": "  "},
])
def test_validation_422(over):
    before = _count()
    assert _put(**over).status_code == 422
    assert _count() == before


def test_duplicate_is_409_and_row_unchanged():
    # mutation: INSERT OR REPLACE / missing 409
    assert _put().status_code == 200
    res = _put(value=6.0)
    assert res.status_code == 409
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM market_assumptions WHERE key='equity_risk_premium' AND as_of='2026-11-17'").fetchone()
    assert row["value"] == 5.2
    assert _put(as_of="2026-11-16").status_code == 409  # the seed row itself


def test_no_update_or_delete_statement_issued(monkeypatch):
    # mutation: add_assumption uses UPDATE ... on conflict
    seen = []
    from apps.api.services import db as db_service

    class Spy(db_service.InstrumentedConnection):
        def execute(self, sql, *a, **k):
            seen.append(sql.strip().split()[0].upper())
            return super().execute(sql, *a, **k)

    monkeypatch.setattr(db_service, "InstrumentedConnection", Spy)
    _put()
    _put()
    client.get(URL)
    assert "INSERT" in seen
    assert "UPDATE" not in seen and "DELETE" not in seen


def test_put_uses_insert_only_in_source():
    import inspect
    src = inspect.getsource(ma.add_assumption)
    assert not re.search(r"(UPDATE|DELETE|REPLACE)", src)
