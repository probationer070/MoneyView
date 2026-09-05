import math

import pytest

from apps.api.services.case_diff import METRIC, SHAPLEY_INPUT_CAP, DiffRefused, diff_case
from apps.api.services.case_fork import fork_case
from apps.api.services.valuation_case import (
    _CASE_COLUMNS,
    _SEGMENT_COLUMNS,
    create_case,
    list_cases,
    load_case,
    run_case_payload,
    run_stored_case,
)
from apps.api.services.valuation_seed import ensure_valuation_cases_seeded
from tests.api.test_case_fork import _parent_payload, _two_segment_payload


@pytest.fixture()
def parent_id() -> int:
    return create_case(_parent_payload())


def _direct_child_payload(parent: dict, **case_overrides) -> dict:
    """Build a `create_case` payload for a child that copies `parent`'s stored
    columns without going through `fork_case` -- the same door `POST
    /valuation/cases` and `valuation_seed.py` use to set `parent_case_id`
    directly, bypassing the reconstruction guarantees `fork_case` provides."""
    payload = {
        field: parent[field] for field in _CASE_COLUMNS
        if field not in ("case_name", "parent_case_id")
    }
    payload["parent_case_id"] = parent["id"]
    payload.update(case_overrides)
    payload["segments"] = [
        {**{field: segment[field] for field in _SEGMENT_COLUMNS},
         "narratives": segment["narratives"]}
        for segment in parent["segments"]
    ]
    return payload


def test_a_case_with_no_parent_cannot_be_diffed(parent_id):
    """A root case has nothing to be attributed against. Returning an empty
    waterfall would present 'no differences' where the truth is 'no comparison
    exists'."""
    with pytest.raises(DiffRefused, match="no_parent"):
        diff_case(parent_id)


def test_an_unrunnable_intermediate_coalition_is_refused(parent_id):
    """Parent (roic 0.12 > wacc 0.074) and child (roic 0.20 > wacc 0.15) are each
    runnable and stored. The MIXED coalition -- wacc moved to 0.15, roic left at
    0.12 -- is not: 0.12 does not exceed 0.15, so terminal growth would destroy
    value. `shapley_contributions` evaluates all four coalitions of these two
    changed inputs, including this one nobody stored. Dropping it and computing
    the attribution from the three that ran would silently drop a term and
    break conservation, so this must refuse the whole diff instead of a 500."""
    child_id = fork_case(parent_id, "child_case", {
        "case": {"wacc_stable": 0.15, "roic_stable": 0.20},
    })
    with pytest.raises(DiffRefused, match="unrunnable_coalition"):
        diff_case(child_id)


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


def test_contributions_come_back_in_canonical_order():
    """Mathematical order-independence and a stable response list are different
    guarantees; this is the second one. Asserts the exact list -- a plain
    `sorted(changes)` (alphabetical) happens to agree with canonical order on
    segment name, but disagrees on case-column order: 'terminal_growth' sorts
    alphabetically before 'wacc_stable', while canonical order is column
    position (`_CASE_COLUMNS.index`), where wacc_stable (7) precedes
    terminal_growth (12). A two-segment fixture is needed so the
    segment-name-then-column rule is exercised, not just case-before-segment."""
    parent_id = create_case(_two_segment_payload())
    child_id = fork_case(parent_id, "child_case", {
        "case": {"wacc_stable": 0.081, "terminal_growth": 0.025},
        "segments": {
            "Adjacent": {"sales_to_capital_late": {
                "value": 3.5, "claim": "c", "three_p": "possible"}},
            "Core": {"margin_target": {
                "value": 0.31, "claim": "c", "three_p": "possible"}},
        },
    })
    assert _CASE_COLUMNS.index("wacc_stable") < _CASE_COLUMNS.index("terminal_growth")

    first = [c["input"] for c in diff_case(child_id)["contributions"]]
    second = [c["input"] for c in diff_case(child_id)["contributions"]]
    assert first == second
    assert first == [
        "case.wacc_stable",
        "case.terminal_growth",
        "segment.Adjacent.sales_to_capital_late",
        "segment.Core.margin_target",
    ]


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
    base = {a: parent["wacc_stable"], b: parent["terminal_growth"]}

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


def test_a_directly_created_child_that_drops_a_segment_is_refused():
    """`diff_case` rebuilds a child's overrides by diffing stored columns
    against the parent's -- it does not, on its own, check that reapplying
    those diffs to the parent reproduces the child. A child created directly
    (not through `fork_case`) can differ in SHAPE, not just value: `POST
    /valuation/cases` accepts `parent_case_id`, and `valuation_seed.py` already
    creates children that way. Dropping a segment here means the reconstructed
    change set, replayed against the two-segment parent, lands on a value the
    one-segment child never had -- an exact-looking number about a case that
    does not exist."""
    parent_id = create_case(_two_segment_payload())
    parent = load_case(parent_id)

    payload = _direct_child_payload(parent, case_name="not_a_real_fork", wacc_stable=0.081)
    payload["segments"] = payload["segments"][:1]  # drop "Adjacent"
    child_id = create_case(payload)

    with pytest.raises(DiffRefused, match="not_a_fork"):
        diff_case(child_id)


def test_a_directly_created_child_identical_to_its_parent_has_no_effective_change():
    """`no_effective_change` is unreachable through `fork_case` (it refuses
    before persisting), but reachable through the same direct-child door as
    the shape mismatch above: nothing stops a directly created child from
    storing the same values as its parent."""
    parent_id = create_case(_two_segment_payload())
    parent = load_case(parent_id)

    payload = _direct_child_payload(parent, case_name="identical_child")
    child_id = create_case(payload)

    with pytest.raises(DiffRefused, match="no_effective_change"):
        diff_case(child_id)


def test_an_unnarrated_segment_field_diffs_without_a_spurious_claim():
    """`ramp_start_year` is the only unnarrated settable segment field.
    Dropping the `if field in NARRATED_FIELDS` conditional in
    `_as_bare_scalars` would wrap it through the narrated-field object branch
    too, tripping `unexpected_narrative` and crashing a fork that legitimately
    changed it. Needs `base_revenue=0.0`: `segment_valuation.py` rejects
    `ramp_start_year > 1` when `base_revenue > 0`."""
    payload = _parent_payload()
    payload["case_name"] = "zero_base_parent"
    payload["segments"][0]["base_revenue"] = 0.0
    parent_id = create_case(payload)

    child_id = fork_case(parent_id, "child_case", {
        "segments": {"Core": {"ramp_start_year": 2}},
    })

    result = diff_case(child_id)
    assert [c["input"] for c in result["contributions"]] == ["segment.Core.ramp_start_year"]
    assert result["contributions"][0]["from"] == pytest.approx(1)
    assert result["contributions"][0]["to"] == pytest.approx(2)


def test_the_seeded_pair_is_refused_by_the_cap_not_a_500():
    """The only parent/child pair the product actually ships. Before excluding
    `ticker`/`as_of_date` from the reconstructed override set, this 500'd with
    `ForkRefused: not_a_number: as_of_date must be a number, got str` -- the
    cap refusal was never reached at all."""
    ensure_valuation_cases_seeded()
    cases = {case["case_name"]: case["id"] for case in list_cases()}
    child_id = cases["spacex_2026_06_post_prospectus"]

    with pytest.raises(DiffRefused, match="too_many_changed_inputs") as exc_info:
        diff_case(child_id)
    # Measured 2026-09-05, after the fix: the seeded post-prospectus case
    # changes 25 inputs against its pre-prospectus parent.
    assert "25 inputs changed" in str(exc_info.value)


def test_a_directly_created_child_differing_in_as_of_date_diffs_on_the_numeric_field_only():
    """`as_of_date` is case identity, not an attributable input -- excluded from
    the reconstructed override set alongside `ticker`. A child that differs
    from its parent in `as_of_date` AND one numeric field must diff
    successfully, attributing only the numeric change."""
    parent_id = create_case(_parent_payload())
    parent = load_case(parent_id)

    payload = _direct_child_payload(
        parent, case_name="date_shifted_child",
        as_of_date="2027-01-01", wacc_stable=0.081,
    )
    child_id = create_case(payload)

    result = diff_case(child_id)
    assert [c["input"] for c in result["contributions"]] == ["case.wacc_stable"]
    assert result["changed_input_count"] == 1


def test_a_null_on_either_side_is_refused_as_unattributable():
    """Several numeric columns are nullable. A child holding NULL where its
    parent holds a number HAS changed, but Shapley needs a value at both ends of
    every coalition, so there is no interval to attribute across. Before this
    guard the pair surfaced as `not_a_number: ... got NoneType` -- blaming the
    caller's input for a property of the two STORED cases."""
    parent_id = create_case(_parent_payload())
    parent = load_case(parent_id)
    payload = _direct_child_payload(parent, case_name="null_child", wacc_stable=0.081)
    payload["effective_tax_rate"] = None
    child_id = create_case(payload)

    with pytest.raises(DiffRefused, match="not_attributable"):
        diff_case(child_id)


def test_a_segment_name_containing_a_dot_diffs_rather_than_500ing():
    """The canonical key is `segment.<name>.<column>` and a segment NAME may
    contain dots -- `conservative_case` names a segment `ticker.lower()`, and
    this repo ships `.KS` tickers, so `005930.ks` is a real segment name. A
    left-hand split reads that name as `005930` and raises KeyError, which is
    neither a ValueError the metric closure catches nor a refusal the route
    maps: it is a 500."""
    payload = _parent_payload()
    payload["segments"][0]["name"] = "005930.ks"
    parent_id = create_case(payload)
    child_id = fork_case(parent_id, "dotted_child", {
        "segments": {"005930.ks": {"margin_target": {
            "value": 0.31, "claim": "c", "three_p": "possible"}}},
    })

    result = diff_case(child_id)
    assert [c["input"] for c in result["contributions"]] == [
        "segment.005930.ks.margin_target"
    ]
    assert result["contributions"][0]["to"] == pytest.approx(0.31)
