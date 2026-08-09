import pytest

from apps.api.services.valuation_case import (
    CaseNotFound,
    NARRATED_FIELDS,
    create_case,
    list_cases,
    load_case,
    run_stored_case,
)
from tests.api.valuation_fixtures import _case_payload, _narrative


def test_create_and_load_round_trips_every_field():
    case_id = create_case(_case_payload())
    loaded = load_case(case_id)
    assert loaded["case_name"] == "test_case"
    assert loaded["ticker"] is None
    assert loaded["segments"][0]["market_share_target"] == pytest.approx(0.70)
    assert len(loaded["segments"][0]["narratives"]) == len(NARRATED_FIELDS) - 1


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
