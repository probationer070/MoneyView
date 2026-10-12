from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.signals import engine

client = TestClient(app)
FIXED_NOW = datetime(2026, 10, 10, 0, 0, tzinfo=timezone.utc)   # 09:00 KST Saturday


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch, fixture_source):
    monkeypatch.setattr(engine, "utc_now", lambda: FIXED_NOW)
    monkeypatch.setattr(engine, "default_source", lambda: fixture_source())


def test_run_returns_a_snapshot_with_labels_and_evidence():
    response = client.post("/api/v1/signals/run")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["iso_week"] == "2026-W41" and data["failures"] == []
    sticky = next(r for r in data["results"] if r["rule_id"] == "b_tnx_sticky")
    assert sticky["state"] == "triggered" and sticky["label_en"] == "10Y yield sticky"
    assert sticky["label_ko"] == "10년물 고착"
    assert sticky["observed_at"] == "2026-10-09" and sticky["threshold"] == 5.5
    assert data["run_at"].endswith("+00:00")


def test_run_without_a_key_is_200_and_all_auto_rules_stale(monkeypatch):
    monkeypatch.setattr(engine, "default_source", lambda: None)
    response = client.post("/api/v1/signals/run")
    assert response.status_code == 200
    data = response.json()["data"]
    assert {r["state"] for r in data["results"]} == {"stale"}
    assert data["probs"] == pytest.approx({"a": 0.35, "b": 0.45, "c": 0.20})
    assert len(data["failures"]) == 6 and all("FRED_API_KEY is not set" in f for f in data["failures"])


def test_latest_and_history():
    assert client.get("/api/v1/signals/latest").json()["data"] is None
    client.post("/api/v1/signals/run")
    assert client.get("/api/v1/signals/latest").json()["data"]["iso_week"] == "2026-W41"
    history = client.get("/api/v1/signals/history", params={"weeks": 26}).json()["data"]
    assert [h["iso_week"] for h in history] == ["2026-W41"]
    assert client.get("/api/v1/signals/history", params={"weeks": 0}).status_code == 422


def test_rules_endpoint_exposes_thresholds_and_lrs():
    data = client.get("/api/v1/signals/rules").json()["data"]
    sticky = next(r for r in data["rules"] if r["id"] == "b_tnx_sticky")
    assert sticky["threshold"] == 5.5 and sticky["lr"] == {"a": 0.7, "b": 1.2, "c": 1.5}
    assert len(data["version"]) == 12


def test_manual_put_recomputes_the_snapshot():
    before = client.post("/api/v1/signals/run").json()["data"]["probs"]
    response = client.put("/api/v1/signals/manual/m_iran_strike", json={"state": "triggered", "note": "news"})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["snapshot"]["probs"]["b"] > before["b"]


def test_manual_input_saved_before_the_first_run_is_used_by_it():
    saved = client.put("/api/v1/signals/manual/m_breadth", json={"state": "triggered", "note": ""})
    assert saved.json()["data"]["snapshot"] is None
    data = client.post("/api/v1/signals/run").json()["data"]
    assert next(r for r in data["results"] if r["rule_id"] == "m_breadth")["state"] == "triggered"


def test_manual_put_refuses_unknown_rules_states_and_extra_fields():
    assert client.put("/api/v1/signals/manual/b_hy_wide", json={"state": "near"}).status_code == 404
    assert client.put("/api/v1/signals/manual/m_nope", json={"state": "near"}).status_code == 404
    assert client.put("/api/v1/signals/manual/m_breadth", json={"state": "stale"}).status_code == 422
    assert client.put("/api/v1/signals/manual/m_breadth",
                      json={"state": "near", "prob_a": 1}).status_code == 422
