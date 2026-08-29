import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.db import get_db
from tests.api.valuation_fixtures import _case_payload, _narrative

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
    """A terminal growth above the riskfree rate is a rejected model, not a
    crash. Rejected at creation now, not at run: the write-time engine gate
    (task 1) catches this before the row is ever stored, so there is no
    case_id to run against any more."""
    payload = _case_payload(case_name="uncapped", terminal_growth=0.09)
    response = client.post("/api/v1/valuation/cases", json=payload)
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


def test_create_rejects_initial_growth_at_or_below_negative_one():
    """Pydantic's Field(gt=-1) on SegmentInput.initial_growth is the bound a real
    client hits, separate from SegmentSpec's own <= -1 rejection in the engine.
    The narrative is included so a 422 here proves the numeric constraint fired,
    not the narrative rule -- without it this would pass for the wrong reason."""
    payload = _case_payload(case_name="growth_at_floor")
    payload["segments"][0]["initial_growth"] = -1.0
    payload["segments"][0]["narratives"].append(_narrative("initial_growth"))
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422
    # FastAPI's own request validation, not the narrative rule: detail is a list
    # of Pydantic error objects, and this one names the field via `loc` and the
    # bound via `type`, not a plain string -- unlike the narrative rule's 422s.
    errors = response.json()["detail"]
    assert any(
        error["type"] == "greater_than" and "initial_growth" in error["loc"]
        for error in errors
    )


def test_run_of_a_legacy_unvaluable_row_is_a_422():
    """The write-time gate governs writes only; it cannot retroactively fix a
    row written before it existed, and there is no migration that sweeps for
    one. This stands in for such a row: since no supported path can create an
    unvaluable case any more, this inserts one directly via `get_db()`,
    bypassing `create_case` (and its narrative/engine gates) entirely -- which
    is exactly what a legacy row is. Regression coverage for
    `apps/api/routes/valuation.py`'s `except ValueError -> 422` branch on
    `/run`, which the write-time gate otherwise drives to zero hits across the
    whole suite.
    """
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO valuation_case (case_name, as_of_date, base_year,"
            " target_year, riskfree_rate, wacc_initial, wacc_stable,"
            " marginal_tax_rate, roic_stable, shares_basic) VALUES"
            " (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "legacy_unvaluable", "2026-08-09", 2026, 2036,
                0.0456, 0.0837, 0.0825, 0.25,
                0.03,  # roic_stable, terminal_growth left NULL -> defaults to
                       # riskfree_rate 0.0456; 0.03 fails to exceed its magnitude.
                12.535,
            ),
        )
        case_id = int(cursor.lastrowid)
        conn.execute(
            "INSERT INTO segment (case_id, name, base_revenue, base_margin,"
            " tam_target, market_share_target, margin_target,"
            " sales_to_capital_early, sales_to_capital_late) VALUES"
            " (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (case_id, "launch", 4.1, -0.10, 100.0, 0.70, 0.45, 1.0, 1.5),
        )

    response = client.post(f"/api/v1/valuation/cases/{case_id}/run")
    assert response.status_code == 422
    assert "terminal growth" in response.json()["detail"]


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
