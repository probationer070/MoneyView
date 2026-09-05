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


def test_a_blank_claim_is_refused_as_narrative_required(parent_id):
    """The object-vs-scalar shape rule above is a different guarantee from the
    claim REQUIREMENT itself: a request that already takes the object form can
    still carry a claim of only whitespace. Deleting the `if not claim:` block
    leaves this narrated override storing an empty claim on a changed field."""
    with pytest.raises(ForkRefused, match="narrative_required"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"margin_target": {
                "value": 0.31, "claim": "   ", "three_p": "possible",
            }}},
        })


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


def test_a_non_numeric_bare_scalar_is_refused(parent_id):
    """`wacc_stable` is unnarrated, so its override arrives as a bare value.
    The model can't catch this -- a leaf is legitimately `Any` -- so the check
    lives in `_unwrap`. Without it this reaches the engine and raises
    `TypeError: str - float`."""
    with pytest.raises(ForkRefused, match="not_a_number"):
        fork_case(parent_id, "child_case", {"case": {"wacc_stable": "abc"}})


def test_a_non_numeric_object_value_is_refused(parent_id):
    """`margin_target` is narrated, so its override arrives as an object; the
    same check applies to `raw["value"]`."""
    with pytest.raises(ForkRefused, match="not_a_number"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"margin_target": {
                "value": "abc", "claim": "c", "three_p": "possible",
            }}},
        })


def test_a_bool_value_is_refused_not_silently_coerced(parent_id):
    """`isinstance(True, int)` is True in Python, so without excluding `bool`
    first, `True` would silently become `1.0` -- a stored assumption nobody
    typed."""
    with pytest.raises(ForkRefused, match="not_a_number"):
        fork_case(parent_id, "child_case", {"case": {"wacc_stable": True}})


def test_a_bool_value_would_be_silently_runnable_without_the_guard(parent_id):
    """`wacc_stable: True` is caught, but only because 1.0 happens to break the
    engine's runnability gate -- that proves the gate fired, not that the bool
    guard did. `nol_balance` isolates the guard itself: the parent's value is
    0.0, so `nol_balance: True` becoming 1.0 is perfectly runnable and nothing
    downstream would object. Without `isinstance(value, bool)`, this fork would
    SUCCEED and store `1.0` -- the silent coercion the docstring warns about."""
    with pytest.raises(ForkRefused, match="not_a_number"):
        fork_case(parent_id, "child_case", {"case": {"nol_balance": True}})


def test_a_whole_number_float_on_an_integer_field_forks_and_stores_an_int(parent_id):
    """JSON does not distinguish `6` from `6.0` -- a client that sends the
    latter means the former. `wacc_converge_from` is an INTEGER column
    (db.py:501); a float reaching it 500s downstream, so `6.0` must be
    accepted and stored as `6`."""
    child_id = fork_case(parent_id, "child_case", {"case": {"wacc_converge_from": 6.0}})
    assert load_case(child_id)["wacc_converge_from"] == 6


def test_a_fractional_float_on_an_integer_field_is_refused(parent_id):
    """`6.5` is a number but not a year -- refused rather than truncated."""
    with pytest.raises(ForkRefused, match="not_a_number"):
        fork_case(parent_id, "child_case", {"case": {"wacc_converge_from": 6.5}})


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


def test_a_narrated_override_with_no_value_is_refused(parent_id):
    """Without the `"value" not in raw` guard, `raw["value"]` is a `KeyError`
    three layers down -- a 500, where spec Section 4.5 mandates a
    `narrative_required:` 422."""
    with pytest.raises(ForkRefused, match="narrative_required"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"margin_target": {
                "claim": "x", "three_p": "possible",
            }}},
        })


def test_an_invalid_confidence_is_refused_before_sqlite_sees_it(parent_id):
    """The column has an identical CHECK(confidence IN
    ('confirmed','derived','assumed')) to three_p's -- but unlike three_p,
    confidence IS defaulted when omitted. A SUPPLIED value outside the three
    names must still be refused by name here, not surface as sqlite's raw
    CHECK constraint message."""
    with pytest.raises(ForkRefused, match="narrative_required"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"margin_target": {
                "value": 0.31, "claim": "services mix reaches 30% by 2030",
                "three_p": "possible", "confidence": "certain",
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


def test_ticker_is_not_a_settable_field(parent_id):
    """`ticker` is a TEXT column (db.py) that identifies the case rather than
    values it -- a fork is the same company, so it is not an attributable
    input. Reaching `_as_number` with a string used to 500 the whole request;
    it must be refused with the ordinary `unknown_field:` prefix instead."""
    with pytest.raises(ForkRefused, match="unknown_field"):
        fork_case(parent_id, "child_case", {"case": {"ticker": "OTHER"}})


def test_as_of_date_is_not_a_settable_field(parent_id):
    with pytest.raises(ForkRefused, match="unknown_field"):
        fork_case(parent_id, "child_case", {"case": {"as_of_date": "2027-01-01"}})


def test_parent_case_id_is_not_a_settable_field(parent_id):
    """Spec Section 4.3 declares `parent_case_id` immutable, and the id below is
    a REAL other case rather than a dangling 999 on purpose. With a dangling id,
    removing the guard fails on a FOREIGN KEY constraint -- which would prove
    only that SQLite enforces referential integrity, not that the guard does
    anything. With a real one, removing the guard lets the fork SUCCEED and
    quietly repoint its own parent, and `/diff` would then attribute against a
    case it never came from."""
    from apps.api.services.valuation_case import create_case

    other = _parent_payload()
    other["case_name"] = "another_root_case"
    other_id = create_case(other)

    with pytest.raises(ForkRefused, match="unknown_field"):
        fork_case(parent_id, "child_case", {"case": {"parent_case_id": other_id}})


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


def test_effective_changes_reports_the_named_segments_value_as_the_baseline():
    """Split from the test above deliberately: sharing one test hid this
    assertion behind that one, so a mis-keyed lookup was only ever observed
    through the discard, never through the baseline it corrupts. The baseline is
    what /diff subtracts against, so it needs its own failure."""
    from apps.api.services.valuation_case import create_case
    parent = load_case(create_case(_two_segment_payload()))

    moved = effective_changes(parent, {"segments": {"Adjacent": {
        "margin_target": {"value": 0.24, "claim": "c", "three_p": "possible"},
    }}})
    assert set(moved) == {"segment.Adjacent.margin_target"}
    assert moved["segment.Adjacent.margin_target"] == (
        pytest.approx(0.18), pytest.approx(0.24))


def test_a_supplied_empty_confidence_is_refused_not_defaulted(parent_id):
    """An ABSENT confidence defaults to "assumed"; a supplied empty string is a
    value the caller typed. Coercing it to the default would store a confidence
    level nobody chose, which is the same objection that keeps three_p
    undefaulted."""
    with pytest.raises(ForkRefused, match="confidence"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"margin_target": {
                "value": 0.31, "claim": "c", "three_p": "possible",
                "confidence": "",
            }}},
        })
