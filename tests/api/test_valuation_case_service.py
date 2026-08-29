import pytest

from apps.api.services.valuation_case import (
    CaseNotFound,
    _specs_from_payload,
    _to_specs,
    create_case,
    list_cases,
    load_case,
    run_stored_case,
)
from tests.api.valuation_fixtures import _case_payload, _narrative, _segment_payload


def test_create_and_load_round_trips_every_field():
    case_id = create_case(_case_payload())
    loaded = load_case(case_id)
    assert loaded["case_name"] == "test_case"
    assert loaded["ticker"] is None
    assert loaded["segments"][0]["market_share_target"] == pytest.approx(0.70)
    # Field names written out deliberately, not derived from NARRATED_FIELDS: a
    # count check can't tell "right fields, right count" from "wrong fields,
    # right count" -- e.g. a typo'd entry in NARRATED_FIELDS would leave the
    # list length unchanged and this test would keep passing while the real
    # narrative rule silently misfires for the misspelled field.
    assert {n["input_field"] for n in loaded["segments"][0]["narratives"]} == {
        "base_revenue", "base_margin", "tam_target", "market_share_target",
        "margin_target", "sales_to_capital_early", "sales_to_capital_late",
    }


def test_segment_stating_both_revenue_target_and_tam_share_is_rejected():
    """Minor B: `SegmentSpec.target_revenue()` gives revenue_target precedence
    over tam_target x market_share_target, so stating both means one narrated,
    stored number never enters the model."""
    payload = _case_payload(
        case_name="double_stated",
        segments=[_segment_payload(revenue_target=70.0)],
    )
    with pytest.raises(ValueError, match="launch"):
        create_case(payload)


def test_missing_narrative_rejects_the_whole_case():
    payload = _case_payload()
    payload["segments"][0]["narratives"] = [
        n for n in payload["segments"][0]["narratives"]
        if n["input_field"] != "margin_target"
    ]
    with pytest.raises(ValueError, match="margin_target"):
        create_case(payload)


def test_a_rejected_case_leaves_nothing_behind():
    """The narrative rule must not half-write a case."""
    payload = _case_payload(case_name="doomed")
    payload["segments"][0]["narratives"] = []
    with pytest.raises(ValueError):
        create_case(payload)
    assert [c["case_name"] for c in list_cases()] == []


def test_narrative_for_an_absent_field_is_rejected():
    """A claim about tam_target on a segment that sets revenue_target instead is
    a claim about nothing, and silently storing it would rot."""
    payload = _case_payload()
    payload["segments"][0]["narratives"].append(_narrative("revenue_target"))
    with pytest.raises(ValueError, match="revenue_target"):
        create_case(payload)


def test_load_of_an_unknown_case_raises_case_not_found():
    with pytest.raises(CaseNotFound):
        load_case(9999)


def test_run_stored_case_returns_engine_output():
    case_id = create_case(_case_payload())
    result = run_stored_case(case_id)
    assert result["revenue"][-1] == pytest.approx(70.0)
    assert result["terminal_spread"] == pytest.approx(0.0825 - 0.0456)
    assert result["equity_value"] > 0


def test_run_reports_inputs_below_probable_without_refusing():
    payload = _case_payload()
    for narrative in payload["segments"][0]["narratives"]:
        if narrative["input_field"] == "market_share_target":
            narrative["three_p"] = "plausible"
    case_id = create_case(payload)
    result = run_stored_case(case_id)
    assert result["below_probable"] == [
        {"segment": "launch", "input_field": "market_share_target", "three_p": "plausible"}
    ]


def test_duplicate_case_name_is_rejected():
    create_case(_case_payload(case_name="taken"))
    with pytest.raises(ValueError, match="taken"):
        create_case(_case_payload(case_name="taken"))


def test_duplicate_segment_name_is_rejected_with_the_name_in_the_message():
    """UNIQUE(case_id, name) on the segment table, translated to a ValueError
    naming the segment -- not left to escape as a raw sqlite3.IntegrityError."""
    payload = _case_payload(segments=[_segment_payload(), _segment_payload()])
    with pytest.raises(ValueError, match="launch"):
        create_case(payload)


def test_partial_segment_write_rolls_back_completely():
    """The first segment inserts fine; the second violates UNIQUE(case_id, name).
    Proves rollback across a genuinely partial write -- unlike
    test_a_rejected_case_leaves_nothing_behind, where validation rejects the
    case before any insert happens at all."""
    payload = _case_payload(case_name="partial", segments=[_segment_payload(), _segment_payload()])
    with pytest.raises(ValueError):
        create_case(payload)
    assert [c["case_name"] for c in list_cases()] == []


def test_duplicate_narrative_field_on_one_segment_is_rejected():
    """PRIMARY KEY (segment_id, input_field). _validate_narratives cannot catch
    this itself -- `claimed` is a set, so the duplicate collapses and validation
    passes -- so this exercises the database-level guard instead."""
    payload = _case_payload()
    payload["segments"][0]["narratives"].append(_narrative("margin_target"))
    with pytest.raises(ValueError, match="margin_target"):
        create_case(payload)


def test_invalid_confidence_is_rejected_with_the_value_named():
    """CHECK(confidence IN (...)) on segment_narrative. Not caught by
    _validate_narratives, which only checks that a claim is present, not that
    its confidence is one of the allowed literals."""
    payload = _case_payload()
    for narrative in payload["segments"][0]["narratives"]:
        if narrative["input_field"] == "margin_target":
            narrative["confidence"] = "guessed"
    with pytest.raises(ValueError, match="guessed"):
        create_case(payload)


def test_dangling_parent_case_id_is_rejected_not_mislabeled_as_duplicate_name():
    """A foreign-key violation on parent_case_id must not be reported as
    'case name already exists' -- that message names the wrong problem."""
    payload = _case_payload(parent_case_id=9999)
    with pytest.raises(ValueError, match="FOREIGN KEY") as exc_info:
        create_case(payload)
    assert "already exists" not in str(exc_info.value)


def test_missing_required_case_field_is_rejected_with_the_column_named():
    """A NOT NULL violation on the case row (shares_basic here) must not be
    reported as 'case name already exists' either."""
    payload = _case_payload(shares_basic=None)
    with pytest.raises(ValueError, match="shares_basic") as exc_info:
        create_case(payload)
    assert "already exists" not in str(exc_info.value)


def test_initial_growth_requires_a_narrative():
    """It is a stated numeric input, so the narrative rule covers it."""
    payload = _case_payload(case_name="growth_unnarrated")
    payload["segments"][0]["initial_growth"] = 0.0764
    with pytest.raises(ValueError, match="initial_growth"):
        create_case(payload)


def test_initial_growth_round_trips_and_reaches_the_engine():
    payload = _case_payload(case_name="growth_narrated")
    payload["segments"][0]["initial_growth"] = 0.0764
    payload["segments"][0]["narratives"].append(_narrative("initial_growth"))
    case_id = create_case(payload)

    loaded = load_case(case_id)
    assert loaded["segments"][0]["initial_growth"] == pytest.approx(0.0764)

    result = run_stored_case(case_id)
    launch = result["segments"][0]
    assert launch["revenue"][0] / 4.1 - 1 == pytest.approx(0.0764, abs=1e-12)


def test_a_case_whose_roic_cannot_carry_its_terminal_growth_is_rejected():
    """The defect this gate exists for. roic_stable 3% under a 4.56% terminal
    growth stored cleanly and then failed on every single run, forever, while
    the caller was told the case was created."""
    payload = _case_payload(case_name="dead_on_arrival", roic_stable=0.03)
    with pytest.raises(ValueError) as excinfo:
        create_case(payload)
    assert "case is not valuable" in str(excinfo.value)
    assert "must exceed the magnitude of terminal growth" in str(excinfo.value)


def test_a_case_growing_while_destroying_value_is_rejected():
    """A SECOND, different engine guard: positive terminal growth with a
    terminal return below the cost of capital.

    This test is why the gate can claim to delegate. A single-guard test would
    still pass if the implementation had quietly copied that one check into
    this module; two different guards reached through one `run_case` call is
    the cheapest evidence that the engine itself does the rejecting.
    """
    payload = _case_payload(case_name="value_destroying", roic_stable=0.06)
    with pytest.raises(ValueError) as excinfo:
        create_case(payload)
    assert "case is not valuable" in str(excinfo.value)
    assert "must exceed wacc_stable" in str(excinfo.value)


def test_an_unvaluable_case_leaves_nothing_behind():
    """The gate runs before the transaction opens, so a refusal writes no row.

    Without this the gate could reject correctly and still leave a half-written
    case behind, which is the failure mode `test_a_rejected_case_leaves_nothing_behind`
    guards for the narrative rule.
    """
    payload = _case_payload(case_name="doomed_by_engine", roic_stable=0.03)
    with pytest.raises(ValueError):
        create_case(payload)
    assert [c["case_name"] for c in list_cases()] == []


def test_a_valuable_case_still_stores_and_runs():
    """The gate must not reject good input."""
    case_id = create_case(_case_payload())
    assert run_stored_case(case_id)["enterprise_value"] > 0


def test_a_declining_case_is_not_judged_by_the_positive_growth_rule():
    """roic_stable 6% sits below wacc_stable 8.25%, which the engine rejects
    ONLY when terminal growth is positive. At -1% growth that rule does not
    apply, and the case must store.

    This is the counterpart to the value-destroying test: together they show the
    gate rejects where the engine rejects and *only* there, rather than imposing
    a broader rule of its own at the service layer.
    """
    case_id = create_case(_case_payload(
        case_name="declining", roic_stable=0.06, terminal_growth=-0.01,
    ))
    assert run_stored_case(case_id)["enterprise_value"] > 0


def test_write_time_specs_equal_read_time_specs():
    """The invariant the whole gate rests on: the trial validates the same
    representation the later run will see.

    It holds today by construction -- `create_case` inserts `payload.get(column)`
    with no defaults or coercion, and `load_case` returns `dict(row)`
    untransformed -- but that is an argument, not a proof. A future default, a
    generated column, a serialization step or a SQLite type-affinity change
    would break it silently, and the gate would start validating something the
    run path never sees. `CaseSpec` and `SegmentSpec` are both
    `@dataclass(frozen=True)`, so `==` compares field by field.
    """
    payload = _case_payload(case_name="equivalence")
    case_id = create_case(payload)
    assert _specs_from_payload(payload) == _to_specs(load_case(case_id))


def test_write_time_specs_equal_read_time_specs_for_a_fully_populated_payload():
    """The equivalence test above only pins `_case_payload()`'s default shape,
    where every optional field is `None` or absent -- a payload that actually
    populates its optional fields exercises a different set of columns
    entirely and must round-trip identically, or the invariant only holds for
    the sparse case.

    Sets `terminal_growth`, `effective_tax_rate` and `parent_case_id` on the
    case, and `initial_growth` plus `revenue_target` on the segment (dropping
    `tam_target`/`market_share_target`, which conflict with `revenue_target`
    per Minor B in `_validate_narratives`). `revenue_target=70.0` matches the
    default fixture's `tam_target x market_share_target` (100.0 x 0.70), and
    `initial_growth=0.0764` is the value already proven to reach the engine in
    `test_initial_growth_round_trips_and_reaches_the_engine`. `terminal_growth`
    is capped below `riskfree_rate` (4.56%) by `CaseSpec.__post_init__`, so
    0.02 (2%) is used instead of reusing 0.0764 for both.
    """
    parent_id = create_case(_case_payload(case_name="populated_equivalence_parent"))
    payload = _case_payload(
        case_name="populated_equivalence",
        terminal_growth=0.02,
        effective_tax_rate=0.21,
        parent_case_id=parent_id,
        segments=[_segment_payload(
            tam_target=None,
            market_share_target=None,
            revenue_target=70.0,
            initial_growth=0.0764,
        )],
    )
    case_id = create_case(payload)
    assert _specs_from_payload(payload) == _to_specs(load_case(case_id))


def test_a_segment_missing_a_required_field_is_rejected():
    """The presence check covers `SegmentSpec`'s no-default fields too, not
    only `CaseSpec`'s. A missing `sales_to_capital_late` used to reach
    SQLite's NOT NULL constraint and come back as a clean ValueError naming
    the column; it must still do so now that the trial spec build happens
    before that constraint is ever checked, rather than crash with a
    TypeError from SegmentSpec's own null-unsafe __post_init__.
    """
    payload = _case_payload(
        case_name="segment_missing_field",
        segments=[_segment_payload(sales_to_capital_late=None)],
    )
    with pytest.raises(ValueError, match="sales_to_capital_late"):
        create_case(payload)


def test_a_segment_with_ramp_start_year_none_is_rejected_with_a_valueerror():
    """`ramp_start_year` has a non-None default (1), so the old "no default"
    predicate skipped it entirely: `SegmentSpec.__post_init__` still compares
    it unconditionally (`self.ramp_start_year < 1`), so a `None` value used to
    reach that comparison and raise `TypeError` -- a 500, where every other
    missing required field gets a clean, field-named `ValueError` here. The
    corrected predicate (no default, OR a non-`None` default) now catches it
    before the trial spec is built. `pytest.raises(ValueError)` itself proves
    this is not the old `TypeError`: that exception type would not be caught
    and the test would error out instead of passing.
    """
    payload = _case_payload(
        case_name="segment_null_ramp_start_year",
        segments=[_segment_payload(ramp_start_year=None)],
    )
    with pytest.raises(ValueError, match="ramp_start_year"):
        create_case(payload)
