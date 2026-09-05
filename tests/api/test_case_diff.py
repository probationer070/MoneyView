import math

import pytest

from apps.api.services.case_diff import METRIC, SHAPLEY_INPUT_CAP, DiffRefused, diff_case
from apps.api.services.case_fork import fork_case
from apps.api.services.valuation_case import (
    create_case,
    load_case,
    run_case_payload,
    run_stored_case,
)
from tests.api.test_case_fork import _parent_payload


@pytest.fixture()
def parent_id() -> int:
    return create_case(_parent_payload())


def test_a_case_with_no_parent_cannot_be_diffed(parent_id):
    """A root case has nothing to be attributed against. Returning an empty
    waterfall would present 'no differences' where the truth is 'no comparison
    exists'."""
    with pytest.raises(DiffRefused, match="no_parent"):
        diff_case(parent_id)


def test_contributions_conserve_the_difference_against_the_real_engine(parent_id):
    """Proves the module is wired into MoneyView's actual valuation engine, not
    merely correct in isolation."""
    child_id = fork_case(parent_id, "child_case", {
        "case": {"wacc_stable": 0.081, "terminal_growth": 0.025},
    })

    result = diff_case(child_id)

    parent_value = run_stored_case(parent_id)["value_per_share_diluted"]
    child_value = run_stored_case(child_id)["value_per_share_diluted"]
    assert result["parent_value_per_share_diluted"] == pytest.approx(parent_value)
    assert result["case_value_per_share_diluted"] == pytest.approx(child_value)

    total = sum(c["contribution"] for c in result["contributions"])
    assert math.isclose(total, result["total_difference"], rel_tol=1e-7, abs_tol=1e-9)
    assert math.isclose(
        result["parent_value_per_share_diluted"] + total,
        result["case_value_per_share_diluted"],
        rel_tol=1e-7, abs_tol=1e-9,
    )


def test_the_response_names_its_method_and_input_count(parent_id):
    child_id = fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.081}})
    result = diff_case(child_id)
    assert result["method"] == "shapley"
    assert result["changed_input_count"] == 1
    assert result["metric"] == "value_per_share_diluted"


def test_only_changed_inputs_appear(parent_id):
    """One override, one contribution. A zero row for an untouched assumption
    would imply it was examined."""
    child_id = fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.081}})
    result = diff_case(child_id)
    assert [c["input"] for c in result["contributions"]] == ["case.wacc_stable"]
    assert result["contributions"][0]["from"] == pytest.approx(0.074)
    assert result["contributions"][0]["to"] == pytest.approx(0.081)


def test_contributions_come_back_in_canonical_order(parent_id):
    """Mathematical order-independence and a stable response list are different
    guarantees; this is the second one."""
    child_id = fork_case(parent_id, "child_case", {
        "case": {"wacc_stable": 0.081, "terminal_growth": 0.025},
        "segments": {"Core": {"margin_target": {
            "value": 0.31, "claim": "c", "three_p": "possible"}}},
    })
    first = [c["input"] for c in diff_case(child_id)["contributions"]]
    second = [c["input"] for c in diff_case(child_id)["contributions"]]
    assert first == second
    assert first[-1].startswith("segment."), "case.* keys sort before segment.*"


def test_too_many_changed_inputs_is_refused_not_downgraded(monkeypatch):
    """Refusing is content. Falling back to sequential would return the same
    response shape computed by a different, order-dependent method -- and a
    reader comparing two diffs could not tell."""
    import apps.api.services.case_diff as case_diff

    monkeypatch.setattr(case_diff, "SHAPLEY_INPUT_CAP", 1)
    parent = create_case(_parent_payload())
    child_id = fork_case(parent, "child_case", {
        "case": {"wacc_stable": 0.081, "terminal_growth": 0.025},
    })
    with pytest.raises(DiffRefused, match="too_many_changed_inputs"):
        case_diff.diff_case(child_id)


def test_the_cap_is_a_named_constant():
    assert SHAPLEY_INPUT_CAP == 12


def test_two_inputs_get_the_shapley_split_not_a_sequential_walk(parent_id):
    """Conservation does NOT distinguish Shapley from a sequential walk: a
    one-at-a-time walk telescopes, so its contributions sum to the same total.
    Measured 2026-09-05 -- a WORKING sequential attribution passes every other
    test in this file. What separates them is the interaction term: Shapley
    halves it, a sequential walk gives all of it to whichever input went second.
    """
    parent = load_case(parent_id)
    child_id = fork_case(parent_id, "child_case", {
        "case": {"wacc_stable": 0.081, "terminal_growth": 0.025},
    })
    a, b = "case.wacc_stable", "case.terminal_growth"
    base = {a: 0.074, b: 0.030}

    def value(**moved) -> float:
        return run_case_payload(parent, {**base, **moved})[METRIC]

    v0 = value()
    va = value(**{a: 0.081})
    vb = value(**{b: 0.025})
    vab = value(**{a: 0.081, b: 0.025})

    # Positive control. On a fixture with no interaction the two methods
    # COINCIDE and every assertion below would hold for either, proving
    # nothing. Measured 0.66/share here, 10.5% of the total move.
    interaction = vab - va - vb + v0
    assert abs(interaction) > 0.1

    shapley_a = 0.5 * (va - v0) + 0.5 * (vab - vb)
    shapley_b = 0.5 * (vb - v0) + 0.5 * (vab - va)
    got = {c["input"]: c["contribution"] for c in diff_case(child_id)["contributions"]}
    assert got[a] == pytest.approx(shapley_a, rel=1e-9)
    assert got[b] == pytest.approx(shapley_b, rel=1e-9)
    # Named explicitly so the distinction is the test's subject, not a side
    # effect: the sequential walk's answer for `a` is (va - v0).
    assert got[a] != pytest.approx(va - v0, rel=1e-6)
