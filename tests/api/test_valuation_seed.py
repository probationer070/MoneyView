import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.valuation_case import list_cases, load_case
from apps.api.services.valuation_seed import (
    POST_CASE_NAME,
    PRE_CASE_NAME,
    ensure_valuation_cases_seeded,
)

client = TestClient(app)


def _case_id(name: str) -> int:
    return next(c["id"] for c in list_cases() if c["case_name"] == name)


def _run(name: str) -> dict:
    return client.post(f"/api/v1/valuation/cases/{_case_id(name)}/run").json()["data"]


def test_seed_creates_both_cases():
    ensure_valuation_cases_seeded()
    names = {c["case_name"] for c in list_cases()}
    assert names == {PRE_CASE_NAME, POST_CASE_NAME}


def test_seed_is_idempotent():
    ensure_valuation_cases_seeded()
    ensure_valuation_cases_seeded()
    assert len(list_cases()) == 2


def test_post_prospectus_case_descends_from_the_pre_case():
    ensure_valuation_cases_seeded()
    post = load_case(_case_id(POST_CASE_NAME))
    assert post["parent_case_id"] == _case_id(PRE_CASE_NAME)


def test_every_seeded_input_carries_a_narrative():
    """The seed obeys the rule it is meant to demonstrate."""
    ensure_valuation_cases_seeded()
    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        for segment in load_case(_case_id(name))["segments"]:
            stated = {
                f for f in (
                    "base_revenue", "base_margin", "tam_target",
                    "market_share_target", "revenue_target", "margin_target",
                    "sales_to_capital_early", "sales_to_capital_late",
                )
                if segment[f] is not None
            }
            assert {n["input_field"] for n in segment["narratives"]} == stated


def test_uncalibrated_inputs_are_marked_assumed():
    """todo3 tags sales-to-capital and base margins as unconfirmed. That has to
    be visible in the data, not just in a comment."""
    ensure_valuation_cases_seeded()
    post = load_case(_case_id(POST_CASE_NAME))
    launch = next(s for s in post["segments"] if s["name"] == "launch")
    by_field = {n["input_field"]: n for n in launch["narratives"]}
    assert by_field["sales_to_capital_early"]["confidence"] == "assumed"
    assert by_field["base_margin"]["confidence"] == "assumed"
    assert by_field["margin_target"]["confidence"] == "confirmed"


def test_seeded_narrative_confidence_tags_match_source_exactly():
    """Every confidence tag, on every narrative, in both cases -- checked against
    a literal expected mapping written independently of the seed module's own
    constants. A test that re-derives its expectations from the code under test
    cannot catch a wrong value; this one is the regression guard for the
    pre-prospectus `ai` segment's `margin_target`, which was shipped `confirmed`
    when the source (todo3 section 3 footnote 1: S1 says 50%, S2 restates as
    45%) makes it `derived`."""
    ensure_valuation_cases_seeded()

    expected = {
        (PRE_CASE_NAME, "launch"): {
            "base_revenue": "derived",
            "base_margin": "assumed",
            "tam_target": "confirmed",
            "market_share_target": "confirmed",
            "margin_target": "confirmed",
            "sales_to_capital_early": "assumed",
            "sales_to_capital_late": "assumed",
        },
        (PRE_CASE_NAME, "connectivity"): {
            "base_revenue": "derived",
            "base_margin": "assumed",
            "tam_target": "confirmed",
            "market_share_target": "confirmed",
            "margin_target": "confirmed",
            "sales_to_capital_early": "assumed",
            "sales_to_capital_late": "assumed",
        },
        (PRE_CASE_NAME, "ai"): {
            "base_revenue": "derived",
            "base_margin": "assumed",
            "revenue_target": "confirmed",
            "margin_target": "derived",
            "sales_to_capital_early": "assumed",
            "sales_to_capital_late": "assumed",
        },
        (PRE_CASE_NAME, "expansion"): {
            "base_revenue": "derived",
            "base_margin": "assumed",
            "revenue_target": "confirmed",
            "margin_target": "confirmed",
            "sales_to_capital_early": "assumed",
            "sales_to_capital_late": "assumed",
        },
        (POST_CASE_NAME, "launch"): {
            "base_revenue": "derived",
            "base_margin": "assumed",
            "tam_target": "confirmed",
            "market_share_target": "confirmed",
            "margin_target": "confirmed",
            "sales_to_capital_early": "assumed",
            "sales_to_capital_late": "assumed",
        },
        (POST_CASE_NAME, "connectivity"): {
            "base_revenue": "derived",
            "base_margin": "assumed",
            "tam_target": "confirmed",
            "market_share_target": "confirmed",
            "margin_target": "confirmed",
            "sales_to_capital_early": "assumed",
            "sales_to_capital_late": "assumed",
        },
        (POST_CASE_NAME, "ai"): {
            "base_revenue": "derived",
            "base_margin": "assumed",
            "revenue_target": "confirmed",
            "margin_target": "confirmed",
            "sales_to_capital_early": "assumed",
            "sales_to_capital_late": "assumed",
        },
        (POST_CASE_NAME, "expansion"): {
            "base_revenue": "derived",
            "base_margin": "assumed",
            "revenue_target": "confirmed",
            "margin_target": "confirmed",
            "sales_to_capital_early": "assumed",
            "sales_to_capital_late": "assumed",
        },
    }

    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        for segment in load_case(_case_id(name))["segments"]:
            actual = {n["input_field"]: n["confidence"] for n in segment["narratives"]}
            assert actual == expected[(name, segment["name"])], f"{name}/{segment['name']}"


def test_seeded_target_year_totals_match_the_confirmed_inputs():
    """The section 6 gates, end to end through HTTP."""
    ensure_valuation_cases_seeded()
    pre, post = _run(PRE_CASE_NAME), _run(POST_CASE_NAME)
    assert pre["revenue"][-1] == pytest.approx(320.0, abs=1e-6)
    assert pre["ebit"][-1] == pytest.approx(151.0, abs=1e-6)
    assert post["revenue"][-1] == pytest.approx(400.0, abs=1e-6)
    assert post["ebit"][-1] == pytest.approx(158.5, abs=1e-6)


def test_seeded_base_revenue_reconciles_with_trailing_multiples():
    ensure_valuation_cases_seeded()
    assert _run(POST_CASE_NAME)["base_revenue_total"] == pytest.approx(15.6, abs=0.05)


def test_post_prospectus_bridge_uses_prospectus_balance_sheet():
    ensure_valuation_cases_seeded()
    bridge = _run(POST_CASE_NAME)["equity_bridge"]
    assert bridge["cash"] == pytest.approx(24.7)
    assert bridge["debt"] == pytest.approx(22.9)
    assert bridge["ipo_proceeds"] == pytest.approx(75.0)
