import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.valuation_case import create_case
from tests.api.test_case_fork import _parent_payload

client = TestClient(app)


@pytest.fixture()
def parent_id() -> int:
    return create_case(_parent_payload())


def _post(case_id: int, body: dict):
    return client.post(f"/api/v1/valuation/cases/{case_id}/simulate", json=body)


def test_a_clean_simulation_returns_the_distribution(parent_id):
    response = _post(parent_id, {
        "runs": 1000, "seed": 42,
        "distributions": {"case": {"wacc_stable": {
            "shape": "uniform", "low": 0.073, "high": 0.075}}},
    })
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["seed"] == 42
    assert data["p10"] < data["p90"]
    assert data["runs_valid"] + data["runs_refused"] == data["runs_requested"]


def test_simulating_an_unknown_case_is_a_404():
    response = _post(999999, {"runs": 1000, "distributions": {
        "case": {"wacc_stable": {"shape": "normal", "mean": 0.074, "sd": 0.001}}}})
    assert response.status_code == 404
    assert response.json()["detail"].startswith("no_case:")


@pytest.mark.parametrize("body,prefix", [
    ({"runs": 5, "distributions": {"case": {"wacc_stable": {
        "shape": "normal", "mean": 0.074, "sd": 0.001}}}}, "invalid_runs:"),
    ({"runs": 1000, "distributions": {"case": {"wacc_stable": {
        "shape": "lognormal", "mean": 0.074, "sd": 0.001}}}}, "unknown_shape:"),
    ({"runs": 1000, "distributions": {"case": {"nope": {
        "shape": "normal", "mean": 1.0, "sd": 0.1}}}}, "unknown_field:"),
    ({"runs": 1000, "distributions": {}}, "no_distributions:"),
])
def test_a_refused_request_carries_its_prefix(parent_id, body, prefix):
    """The prefix IS the code: a caller branches on it without parsing prose."""
    response = _post(parent_id, body)
    assert response.status_code == 422
    assert response.json()["detail"].startswith(prefix)


def test_a_refused_SAMPLE_is_a_200_not_an_error(parent_id):
    """A bad draw is data about the model, not a failed request. This is the
    line between request validation and sampling refusal."""
    response = _post(parent_id, {
        "runs": 2000, "seed": 42,
        "distributions": {"case": {"terminal_growth": {
            "shape": "uniform", "low": 0.020, "high": 0.200}}},
    })
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["runs_refused"] > 0
    assert data["refusals"][0]["code"]
    assert data["refusals"][0]["message"]


def test_a_malformed_body_is_a_422_from_the_schema(parent_id):
    """FastAPI's own schema error, whose detail is a LIST rather than a prefixed
    string -- assert the status, not a prefix."""
    assert _post(parent_id, {"runs": 1000, "distributions": "nope"}).status_code == 422
    assert _post(parent_id, {"distributions": {"case": {}}}).status_code == 422
