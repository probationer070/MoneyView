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
    with pytest.raises(ForkRefused, match="narrative_required"):
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


def test_a_narrated_change_without_three_p_is_refused(parent_id):
    """three_p is NOT NULL with a CHECK on three values. Defaulting it would have
    the API state an epistemic confidence the caller never gave."""
    with pytest.raises(ForkRefused, match="three_p"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"margin_target": {
                "value": 0.31, "claim": "services mix reaches 30% by 2030",
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
