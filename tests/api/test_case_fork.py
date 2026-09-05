import copy

import pytest

from apps.api.services.case_fork import ForkRefused, effective_changes, fork_case
from apps.api.services.valuation_case import load_case


def _parent_payload() -> dict:
    """A minimal storable case. Narratives are required for every stated
    narrated field -- that is `_validate_narratives`, not this feature."""
    return {
        "case_name": "parent_case",
        "ticker": "TESTCO",
        "as_of_date": "2026-01-01",
        "base_year": 2025,
        "target_year": 2035,
        "riskfree_rate": 0.042,
        "wacc_initial": 0.090,
        "wacc_stable": 0.074,
        "wacc_converge_from": 5,
        "marginal_tax_rate": 0.25,
        "effective_tax_rate": 0.15,
        "nol_balance": 0.0,
        "roic_stable": 0.120,
        "terminal_growth": 0.030,
        "cash": 100.0,
        "debt": 50.0,
        "ipo_proceeds": 0.0,
        "shares_basic": 100.0,
        "shares_new": 0.0,
        "segments": [
            {
                "name": "Core",
                "base_revenue": 1000.0,
                "base_margin": 0.20,
                "revenue_target": 2000.0,
                "margin_target": 0.28,
                "sales_to_capital_early": 2.0,
                "sales_to_capital_late": 3.0,
                "ramp_start_year": 1,
                "narratives": [
                    # three_p is NOT NULL with CHECK(three_p IN
                    # ('possible','plausible','probable')) -- see db.py:568.
                    {"input_field": f, "claim": f"parent claim for {f}",
                     "evidence_source": "test", "confidence": "assumed",
                     "three_p": "probable"}
                    for f in ("base_revenue", "base_margin", "revenue_target",
                              "margin_target", "sales_to_capital_early",
                              "sales_to_capital_late")
                ],
            }
        ],
    }


def _two_segment_payload() -> dict:
    """The one-segment fixture cannot observe a bug that applies a segment
    override to EVERY segment."""
    payload = _parent_payload()
    payload["case_name"] = "two_segment_parent"
    second = copy.deepcopy(payload["segments"][0])
    second["name"] = "Adjacent"
    second["base_revenue"] = 400.0
    second["margin_target"] = 0.18
    payload["segments"].append(second)
    return payload


@pytest.fixture()
def parent_id() -> int:
    from apps.api.services.valuation_case import create_case
    return create_case(_parent_payload())


def test_a_fork_copies_every_unmentioned_field(parent_id):
    """The test that validates the FORK rather than its HTTP status: a field the
    request never mentions must arrive unchanged."""
    child_id = fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.081}})

    child = load_case(child_id)
    assert child["wacc_stable"] == pytest.approx(0.081)
    assert child["terminal_growth"] == pytest.approx(0.030)
    assert child["roic_stable"] == pytest.approx(0.120)
    assert child["segments"][0]["margin_target"] == pytest.approx(0.28)
    assert child["parent_case_id"] == parent_id
    assert child["case_name"] == "child_case"


def test_the_parent_is_not_mutated(parent_id):
    before = load_case(parent_id)
    fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.081}})
    after = load_case(parent_id)
    assert after["wacc_stable"] == before["wacc_stable"]
    assert after["parent_case_id"] is None


def test_an_override_equal_to_the_parent_is_not_a_change(parent_id):
    """Sending the value the parent already holds is not a change. Counting it
    would inflate changed_input_count and consume the attribution cap for an
    assumption nobody moved."""
    parent = load_case(parent_id)
    assert parent["wacc_stable"] == pytest.approx(0.074)

    with pytest.raises(ForkRefused, match="no_effective_change"):
        fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.074}})


def test_an_empty_override_set_is_refused(parent_id):
    with pytest.raises(ForkRefused, match="no_effective_change"):
        fork_case(parent_id, "child_case", {})


def test_a_changed_narrated_field_needs_a_new_claim(parent_id):
    """Inheriting the parent's claim would leave a stored sentence describing how
    a DIFFERENT number was derived, and `_validate_narratives` would not notice:
    the field is still stated and still claimed."""
    with pytest.raises(ForkRefused, match="must be an object carrying a claim"):
        fork_case(parent_id, "child_case",
                  {"segments": {"Core": {"margin_target": 0.31}}})


def test_a_narrated_change_with_a_claim_replaces_the_parents(parent_id):
    child_id = fork_case(parent_id, "child_case", {
        "segments": {"Core": {"margin_target": {
            "value": 0.31,
            "claim": "services mix reaches 30% by 2030",
            "evidence_source": "own estimate",
            "confidence": "assumed",
            "three_p": "plausible",
        }}},
    })

    segment = load_case(child_id)["segments"][0]
    assert segment["margin_target"] == pytest.approx(0.31)
    claims = {n["input_field"]: n["claim"] for n in segment["narratives"]}
    assert claims["margin_target"] == "services mix reaches 30% by 2030"
    # Untouched narrated fields keep the parent's wording.
    assert claims["base_revenue"] == "parent claim for base_revenue"


def test_an_unchanged_field_keeps_the_parents_claim_even_if_a_new_one_is_sent(parent_id):
    """A value the caller did not move is not a change, so its narrative is not
    rewritten either. Storing the new claim would put a fresh sentence on a field
    /diff reports as unchanged."""
    child_id = fork_case(parent_id, "child_case", {
        "case": {"wacc_stable": 0.081},
        "segments": {"Core": {"margin_target": {
            "value": 0.28,  # identical to the parent
            "claim": "restated wording for an assumption nobody moved",
            "three_p": "probable",
        }}},
    })

    segment = load_case(child_id)["segments"][0]
    assert segment["margin_target"] == pytest.approx(0.28)
    claims = {n["input_field"]: n["claim"] for n in segment["narratives"]}
    assert claims["margin_target"] == "parent claim for margin_target"


def test_a_narrated_change_without_three_p_is_refused(parent_id):
    """three_p is NOT NULL with a CHECK on three values. Defaulting it would have
    the API state an epistemic confidence the caller never gave."""
    with pytest.raises(ForkRefused, match="three_p"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"margin_target": {
                "value": 0.31, "claim": "services mix reaches 30% by 2030",
            }}},
        })


def test_an_invalid_three_p_is_refused_before_sqlite_sees_it(parent_id):
    """The column has CHECK(three_p IN ('possible','plausible','probable')). A
    value outside it must be refused by name, not surface as an IntegrityError
    from three layers down."""
    with pytest.raises(ForkRefused, match="three_p"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"margin_target": {
                "value": 0.31, "claim": "services mix reaches 30% by 2030",
                "three_p": "certain",
            }}},
        })


def test_a_claim_on_an_unnarrated_field_is_refused(parent_id):
    with pytest.raises(ForkRefused, match="unexpected_narrative"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"ramp_start_year": {"value": 2, "claim": "x"}}},
        })


def test_an_unknown_field_is_refused(parent_id):
    with pytest.raises(ForkRefused, match="unknown_field"):
        fork_case(parent_id, "child_case", {"case": {"not_a_column": 1.0}})


def test_an_unknown_segment_is_refused(parent_id):
    """Silently ignoring it would let a typo look like an applied change that
    did nothing."""
    with pytest.raises(ForkRefused, match="unknown_segment"):
        fork_case(parent_id, "child_case", {"segments": {"Cor": {"margin_target": 0.31}}})


def test_a_fork_the_engine_rejects_is_refused_in_the_engines_words(parent_id):
    """The runnability gate applies to forks unchanged: driving roic_stable below
    the terminal growth makes the case unrunnable, and a stored-but-unrunnable
    case is exactly what that gate exists to prevent."""
    with pytest.raises(ValueError, match="case is not valuable"):
        fork_case(parent_id, "child_case", {"case": {"roic_stable": 0.001}})


def test_effective_changes_reports_canonical_keys(parent_id):
    parent = load_case(parent_id)
    changes = effective_changes(parent, {
        "case": {"wacc_stable": 0.081},
        "segments": {"Core": {"margin_target": {
            "value": 0.31, "claim": "c", "three_p": "possible"}}},
    })
    assert set(changes) == {"case.wacc_stable", "segment.Core.margin_target"}
    assert changes["case.wacc_stable"] == (pytest.approx(0.074), pytest.approx(0.081))


def test_two_fields_on_one_segment_are_two_players(parent_id):
    """A segment is not a player; each changed scalar is."""
    parent = load_case(parent_id)
    changes = effective_changes(parent, {
        "segments": {"Core": {
            "margin_target": {"value": 0.31, "claim": "c1", "three_p": "possible"},
            "sales_to_capital_late": {"value": 3.5, "claim": "c2", "three_p": "possible"},
        }},
    })
    assert set(changes) == {
        "segment.Core.margin_target",
        "segment.Core.sales_to_capital_late",
    }


def test_a_segment_override_touches_only_the_named_segment():
    """An end-to-end guard, not an isolating one: it does NOT prove `fork_case`
    keys overrides by segment name on its own. The crosstalk mutation alone (the
    segment loop reading every segment's overrides) leaves this test green,
    because the `changes` skip added for the discard rule re-derives correct
    scoping from `effective_changes` and filters the crosstalk out before it is
    applied -- confirmed by mutation testing. The test that isolates keying is
    `test_effective_changes_compares_against_the_named_segments_value`, since
    `by_name[segment_name]` in `effective_changes` is where keying is actually
    enforced."""
    from apps.api.services.valuation_case import create_case
    parent_id = create_case(_two_segment_payload())

    child_id = fork_case(parent_id, "child_case", {
        "segments": {"Adjacent": {"margin_target": {
            "value": 0.24, "claim": "adjacent mix improves", "three_p": "possible",
        }}},
    })

    by_name = {s["name"]: s for s in load_case(child_id)["segments"]}
    assert by_name["Adjacent"]["margin_target"] == pytest.approx(0.24)
    assert by_name["Core"]["margin_target"] == pytest.approx(0.28)
    core_claims = {n["input_field"]: n["claim"] for n in by_name["Core"]["narratives"]}
    assert core_claims["margin_target"] == "parent claim for margin_target"


def test_effective_changes_compares_against_the_named_segments_value():
    """Keying is enforced here, not in `fork_case`: `by_name[segment_name]` picks
    which stored value an override is measured against. Compared against the
    wrong segment, an assumption nobody moved is counted as a change and the
    diff's baseline is a number from a different segment."""
    from apps.api.services.valuation_case import create_case
    parent = load_case(create_case(_two_segment_payload()))
    assert parent["segments"][0]["margin_target"] == pytest.approx(0.28)   # Core
    assert parent["segments"][1]["margin_target"] == pytest.approx(0.18)   # Adjacent

    unchanged = effective_changes(parent, {"segments": {"Adjacent": {
        "margin_target": {"value": 0.18, "claim": "c", "three_p": "possible"},
    }}})
    assert unchanged == {}

    moved = effective_changes(parent, {"segments": {"Adjacent": {
        "margin_target": {"value": 0.24, "claim": "c", "three_p": "possible"},
    }}})
    assert set(moved) == {"segment.Adjacent.margin_target"}
    assert moved["segment.Adjacent.margin_target"] == (
        pytest.approx(0.18), pytest.approx(0.24))
