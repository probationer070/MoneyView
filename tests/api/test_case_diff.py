import math

import pytest

from apps.api.services.case_diff import SHAPLEY_INPUT_CAP, DiffRefused, diff_case
from apps.api.services.case_fork import fork_case
from apps.api.services.valuation_case import create_case, run_stored_case
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
