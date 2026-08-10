import pytest

from apps.api.services.valuation_case import (
    CaseNotFound,
    NARRATED_FIELDS,
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
    assert len(loaded["segments"][0]["narratives"]) == len(NARRATED_FIELDS) - 1


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
