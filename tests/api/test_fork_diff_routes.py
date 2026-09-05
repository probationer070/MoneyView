import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.valuation_case import create_case, list_cases, load_case
from apps.api.services.valuation_seed import ensure_valuation_cases_seeded
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
    assert response.json()["detail"].startswith("no_case:")
    assert "no valuation case" in response.json()["detail"]


def test_a_string_overrides_envelope_is_a_422(parent_id):
    """`overrides` typed as a scalar rather than an object. Before the envelope
    was typed this reached `.get("case")` on a str and 500'd with
    AttributeError. FastAPI's own schema error is a LIST-shaped `detail`, not a
    prefixed string, so only the status is asserted."""
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "c1", "overrides": "nope"},
    )
    assert response.status_code == 422


def test_a_string_case_overrides_is_a_422(parent_id):
    """`overrides.case` typed as a scalar rather than an object. Before the
    envelope was typed this reached `.items()` on a str and 500'd with
    AttributeError."""
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "c2", "overrides": {"case": "nope"}},
    )
    assert response.status_code == 422


def test_a_string_segment_overrides_is_a_422(parent_id):
    """`overrides.segments.Core` typed as a scalar rather than an object. The
    route 422s this today via `ForkOverrides.segments: dict[str, dict[str,
    Any]]`; nothing pinned it before. Without that inner typing this reaches
    `.items()` on a str in `effective_changes` and 500s with AttributeError."""
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "c3", "overrides": {"segments": {"Core": "nope"}}},
    )
    assert response.status_code == 422


def test_a_fractional_float_on_an_integer_field_is_a_422_not_a_500(parent_id):
    """`wacc_converge_from` is an INTEGER column; `6.5` must be refused at the
    schema/service boundary with a 422, never reach the engine as a 500."""
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case", "overrides": {"case": {"wacc_converge_from": 6.5}}},
    )
    assert response.status_code == 422
    assert response.json()["detail"].startswith("not_a_number:")


def test_a_typoed_overrides_key_is_a_422_not_a_silent_no_op(parent_id):
    """`overides` (missing an `r`) is not a field `ForkRequest` knows. Without
    `extra=\"forbid\"` this is silently dropped and the caller is told their
    fork changes nothing -- the exact mislabeling `no_effective_change` exists
    to prevent."""
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "typo", "overides": {"case": {"wacc_stable": 0.081}}},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "no_effective_change" not in str(detail)


def test_an_unknown_top_level_key_is_a_422_not_silently_dropped(parent_id):
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "extra",
              "overrides": {"case": {"wacc_stable": 0.081}}, "bogus": 1},
    )
    assert response.status_code == 422


def test_an_unknown_key_inside_overrides_is_a_422(parent_id):
    """Targets `ForkOverrides`'s own `extra=\"forbid\"` specifically -- the two
    tests above put the unknown key at the TOP level of the request body, which
    `ForkRequest`'s `extra=\"forbid\"` catches on its own and would stay green
    even if `ForkOverrides` silently ignored an unknown key one level down."""
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "extra2",
              "overrides": {"case": {"wacc_stable": 0.081}, "bogus_in_overrides": 1}},
    )
    assert response.status_code == 422


def test_a_blank_case_name_is_a_422(parent_id):
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "   ", "overrides": {"case": {"wacc_stable": 0.081}}},
    )
    assert response.status_code == 422


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
    assert inputs == {"case.wacc_stable"}
    assert not {"other", "residual", "interaction", "unexplained"} & inputs


def test_diffing_an_unknown_case_is_a_404_with_its_prefix(parent_id):
    """Mirrors `test_forking_an_unknown_case_is_a_404`: only the fork route's
    404 was pinned to its `no_case:` prefix before this test existed."""
    response = client.get("/api/v1/valuation/cases/999999/diff")
    assert response.status_code == 404
    assert response.json()["detail"].startswith("no_case:")
    assert "no valuation case" in response.json()["detail"]


def test_diffing_a_root_case_is_a_422(parent_id):
    response = client.get(f"/api/v1/valuation/cases/{parent_id}/diff")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("no_parent:")


def test_an_unrunnable_coalition_is_a_422_at_the_route(parent_id):
    """Parent (roic 0.12 > wacc 0.074) and child (roic 0.20 > wacc 0.15) are each
    runnable; the mixed coalition the diff must evaluate is not. Reproduced from
    a real 500 before this fix."""
    created = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case",
              "overrides": {"case": {"wacc_stable": 0.15, "roic_stable": 0.20}}},
    ).json()["data"]["id"]

    response = client.get(f"/api/v1/valuation/cases/{created}/diff")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("unrunnable_coalition:")


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


def test_the_seeded_pair_is_a_422_not_a_500_at_the_route():
    """The only parent/child pair the product ships, at the route: must be a
    422 carrying `too_many_changed_inputs:`, never the 500 a stray TEXT column
    used to produce."""
    ensure_valuation_cases_seeded()
    cases = {case["case_name"]: case["id"] for case in list_cases()}
    child_id = cases["spacex_2026_06_post_prospectus"]

    response = client.get(f"/api/v1/valuation/cases/{child_id}/diff")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("too_many_changed_inputs:")
