import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.valuation_case import create_case, load_case
from tests.api.test_case_diff import _direct_child_payload
from tests.api.test_case_fork import _parent_payload, _two_segment_payload

client = TestClient(app)


@pytest.fixture()
def parent_id() -> int:
    return create_case(_parent_payload())


def test_fork_returns_the_new_case_id(parent_id):
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case", "overrides": {"case": {"wacc_stable": 0.081}}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["id"] != parent_id


def test_forking_an_unknown_case_is_a_404():
    response = client.post(
        "/api/v1/valuation/cases/999999/fork",
        json={"case_name": "child_case", "overrides": {"case": {"wacc_stable": 0.081}}},
    )
    assert response.status_code == 404
    assert "no valuation case" in response.json()["detail"]


def test_a_refused_fork_carries_its_machine_readable_prefix(parent_id):
    """The prefix IS the code: this repo has no {code, detail} envelope, and the
    conservative-case route documents the same convention."""
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case",
              "overrides": {"segments": {"Core": {"margin_target": 0.31}}}},
    )
    assert response.status_code == 422
    assert response.json()["detail"].startswith("narrative_required:")


def test_an_engine_refusal_reaches_the_caller_verbatim(parent_id):
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case", "overrides": {"case": {"roic_stable": 0.001}}},
    )
    assert response.status_code == 422
    assert response.json()["detail"].startswith("case is not valuable:")


def test_a_duplicate_case_name_is_a_conflict_not_an_unrunnable_case(parent_id):
    """`create_case` raises FOUR bare ValueErrors and `fork_case` passes them
    through, so a route that maps by exception type alone answers a name
    collision with the engine's runnability refusal -- naming the wrong problem.
    The status separates them and the prefix survives for a caller to branch on.
    """
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "parent_case", "overrides": {"case": {"wacc_stable": 0.081}}},
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail.startswith("duplicate_case_name:")
    assert "already exists" in detail
    assert "case is not valuable" not in detail


def test_diff_returns_the_waterfall(parent_id):
    created = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case",
              "overrides": {"case": {"wacc_stable": 0.081, "terminal_growth": 0.025}}},
    ).json()["data"]["id"]

    body = client.get(f"/api/v1/valuation/cases/{created}/diff").json()["data"]

    assert body["method"] == "shapley"
    assert body["changed_input_count"] == 2
    assert {c["input"] for c in body["contributions"]} == {
        "case.wacc_stable", "case.terminal_growth"
    }
    total = sum(c["contribution"] for c in body["contributions"])
    assert total == pytest.approx(body["total_difference"], rel=1e-7, abs=1e-9)


def test_the_diff_response_carries_no_residual_row(parent_id):
    """An 'other' bucket is where an unexplained gap goes to look explained."""
    created = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case", "overrides": {"case": {"wacc_stable": 0.081}}},
    ).json()["data"]["id"]

    body = client.get(f"/api/v1/valuation/cases/{created}/diff").json()["data"]
    inputs = {c["input"] for c in body["contributions"]}
    assert not {"other", "residual", "interaction", "unexplained"} & inputs


def test_diffing_a_root_case_is_a_422(parent_id):
    response = client.get(f"/api/v1/valuation/cases/{parent_id}/diff")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("no_parent:")


def test_a_child_that_is_not_a_fork_is_refused_at_the_route(parent_id):
    """The service's `not_a_fork` guard has to reach the caller with its prefix:
    this is the refusal standing between a reader and a 56%-wrong number wearing
    an exact attribution."""
    parent = load_case(create_case(_two_segment_payload()))
    payload = _direct_child_payload(parent, case_name="not_a_real_fork", wacc_stable=0.081)
    payload["segments"] = payload["segments"][:1]
    child_id = create_case(payload)

    response = client.get(f"/api/v1/valuation/cases/{child_id}/diff")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("not_a_fork:")


def test_the_cap_refuses_at_the_route_rather_than_downgrading(monkeypatch):
    """Over the cap the route must return the refusal, not a cheaper attribution
    of the same shape. Measured 2026-09-05: the seeded SpaceX pair changes 26
    inputs and is refused for exactly this reason."""
    from apps.api.services import case_diff

    monkeypatch.setattr(case_diff, "SHAPLEY_INPUT_CAP", 1)
    parent_id = create_case(_parent_payload())
    created = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case",
              "overrides": {"case": {"wacc_stable": 0.081, "terminal_growth": 0.025}}},
    ).json()["data"]["id"]

    response = client.get(f"/api/v1/valuation/cases/{created}/diff")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("too_many_changed_inputs:")
