"""A ticker deleted from the watchlist leaves the comparison candidates at once; manual and
default companies stay (spec 2026-10-15 §1, test §4.1; plan Narrowed N1).
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.routes import corporate as corporate_route
from apps.api.services.corporate_comparison import load_company_universe_data
from apps.api.services.corporate_metrics_service import DEFAULT_COMPANIES

REMOVED, KEPT, MANUAL = "ZZRM", "ZZKP", "ZZMN"
DEFAULT = sorted(DEFAULT_COMPANIES)[-1]


@pytest.fixture
def client(tmp_path, monkeypatch):
    assert not {REMOVED, KEPT, MANUAL} & set(DEFAULT_COMPANIES), "fixture tickers must not be defaults"
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"custom": {"targets": [
        {"ticker": REMOVED, "name": "Removed Co", "sector": "Tech", "weight": 0.0},
    ]}}), encoding="utf-8")
    monkeypatch.setattr(corporate_route, "_WATCHLIST_JSON", seed)
    monkeypatch.setattr("apps.api.routes.portfolio.schedule_acquisition", lambda data_class, subject: None)
    client = TestClient(app)
    for ticker in (KEPT, REMOVED):
        response = client.post("/api/v1/portfolio/watchlist",
                               json={"ticker": ticker, "name": ticker, "sector": "", "group_name": "custom", "weight": 0.0})
        assert response.status_code == 200, response.text
    assert client.post("/api/v1/corporate/companies",
                       json={"ticker": MANUAL, "name": "Manual Co", "sector": "Private"}).status_code == 200
    assert client.delete(f"/api/v1/portfolio/watchlist/{REMOVED}").status_code == 200
    return client


def test_a_deleted_watchlist_ticker_leaves_the_company_list_at_once(client):
    tickers = {company["ticker"] for company in client.get("/api/v1/corporate/companies").json()}
    assert REMOVED not in tickers, "a deleted watchlist ticker is still offered as a comparison candidate"
    assert {KEPT, MANUAL, DEFAULT} <= tickers, f"a kept, manual or default company disappeared: {sorted(tickers)}"


def test_a_deleted_watchlist_ticker_leaves_the_comparison_registry_at_once(client):
    registry = load_company_universe_data(DEFAULT_COMPANIES).registry
    assert REMOVED not in registry, "a deleted watchlist ticker is still in the comparison registry"
    assert {KEPT, MANUAL, DEFAULT} <= set(registry)
