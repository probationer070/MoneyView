import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from tests.api.valuation_fixtures import _case_payload

client = TestClient(app)


def test_create_returns_the_new_case_id():
    response = client.post("/api/v1/valuation/cases", json=_case_payload())
    assert response.status_code == 200
    assert response.json()["data"]["id"] > 0


def test_create_without_a_narrative_is_a_422_naming_the_field():
    payload = _case_payload(case_name="unnarrated")
    payload["segments"][0]["narratives"] = [
        n for n in payload["segments"][0]["narratives"]
        if n["input_field"] != "margin_target"
    ]
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422
    assert "margin_target" in response.json()["detail"]


def test_list_returns_created_cases():
    client.post("/api/v1/valuation/cases", json=_case_payload(case_name="listed"))
    names = [c["case_name"] for c in client.get("/api/v1/valuation/cases").json()["data"]]
    assert "listed" in names


def test_get_returns_segments_and_narratives():
    case_id = client.post(
        "/api/v1/valuation/cases", json=_case_payload(case_name="detailed")
    ).json()["data"]["id"]
    data = client.get(f"/api/v1/valuation/cases/{case_id}").json()["data"]
    assert data["segments"][0]["name"] == "launch"
    assert data["segments"][0]["narratives"][0]["claim"]


def test_get_unknown_case_is_404():
    assert client.get("/api/v1/valuation/cases/9999").status_code == 404


def test_run_returns_paths_bridge_and_spread():
    case_id = client.post(
        "/api/v1/valuation/cases", json=_case_payload(case_name="runnable")
    ).json()["data"]["id"]
    data = client.post(f"/api/v1/valuation/cases/{case_id}/run").json()["data"]
    assert len(data["fcff"]) == 10
    assert data["revenue"][-1] == pytest.approx(70.0)
    assert data["equity_bridge"]["equity_value"] == pytest.approx(data["equity_value"])
    assert data["terminal_spread"] == pytest.approx(0.0825 - 0.0456)


def test_run_of_an_unknown_case_is_404():
    assert client.post("/api/v1/valuation/cases/9999/run").status_code == 404


def test_model_invalid_inputs_are_422_not_500():
    """A terminal growth above the riskfree rate is a rejected model, not a crash."""
    payload = _case_payload(case_name="uncapped", terminal_growth=0.09)
    case_id = client.post("/api/v1/valuation/cases", json=payload).json()["data"]["id"]
    response = client.post(f"/api/v1/valuation/cases/{case_id}/run")
    assert response.status_code == 422
    assert "riskfree" in response.json()["detail"]


def test_create_without_the_equity_bridge_is_a_422():
    """I3: cash, debt, ipo_proceeds and shares_new have no default -- a POST
    that omits the bridge must not silently value a debt-free, cash-free firm
    with no pending raise."""
    payload = _case_payload(case_name="no_bridge")
    for field in ("cash", "debt", "ipo_proceeds", "shares_new"):
        del payload[field]
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422


def test_create_rejects_negative_shares_new():
    """I3: a negative shares_new previously produced a diluted value per share
    above basic, which is impossible."""
    payload = _case_payload(case_name="negative_new_shares", shares_new=-5.0)
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422


def test_run_exposes_the_terminal_consistency_diagnostics():
    case_id = client.post(
        "/api/v1/valuation/cases", json=_case_payload(case_name="diagnostics")
    ).json()["data"]["id"]
    data = client.post(f"/api/v1/valuation/cases/{case_id}/run").json()["data"]
    for key in (
        "marginal_roic_target_year",
        "terminal_reinvestment_rate",
        "reinvestment_rate_target_year",
        "explicit_reinvestment_rate_at_stable_growth",
    ):
        assert key in data, key
        assert isinstance(data[key], float)
