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


def test_seeded_narrative_three_p_tags_match_source_exactly():
    """Every three_p tag, on every narrative, in both cases -- checked against a
    literal expected mapping written independently of the seed module's own
    constants, mirroring the confidence test above.

    The three placeholder inputs -- base_margin, sales_to_capital_early,
    sales_to_capital_late -- are self-described in their own claim text as
    uncalibrated ("Placeholder. ... Calibrate against
    SpaceX2026IPOUpdated.xlsx.") and cannot honestly sit at Probable on a
    Possible -> Plausible -> Probable scale. Every confirmed or derived input
    stays at Probable; only those three placeholders are Plausible."""
    ensure_valuation_cases_seeded()

    expected = {
        (PRE_CASE_NAME, "launch"): {
            "base_revenue": "probable",
            "base_margin": "plausible",
            "tam_target": "probable",
            "market_share_target": "probable",
            "margin_target": "probable",
            "sales_to_capital_early": "plausible",
            "sales_to_capital_late": "plausible",
        },
        (PRE_CASE_NAME, "connectivity"): {
            "base_revenue": "probable",
            "base_margin": "plausible",
            "tam_target": "probable",
            "market_share_target": "probable",
            "margin_target": "probable",
            "sales_to_capital_early": "plausible",
            "sales_to_capital_late": "plausible",
        },
        (PRE_CASE_NAME, "ai"): {
            "base_revenue": "probable",
            "base_margin": "plausible",
            "revenue_target": "probable",
            "margin_target": "probable",
            "sales_to_capital_early": "plausible",
            "sales_to_capital_late": "plausible",
        },
        (PRE_CASE_NAME, "expansion"): {
            "base_revenue": "probable",
            "base_margin": "plausible",
            "revenue_target": "probable",
            "margin_target": "probable",
            "sales_to_capital_early": "plausible",
            "sales_to_capital_late": "plausible",
        },
        (POST_CASE_NAME, "launch"): {
            "base_revenue": "probable",
            "base_margin": "plausible",
            "tam_target": "probable",
            "market_share_target": "probable",
            "margin_target": "probable",
            "sales_to_capital_early": "plausible",
            "sales_to_capital_late": "plausible",
        },
        (POST_CASE_NAME, "connectivity"): {
            "base_revenue": "probable",
            "base_margin": "plausible",
            "tam_target": "probable",
            "market_share_target": "probable",
            "margin_target": "probable",
            "sales_to_capital_early": "plausible",
            "sales_to_capital_late": "plausible",
        },
        (POST_CASE_NAME, "ai"): {
            "base_revenue": "probable",
            "base_margin": "plausible",
            "revenue_target": "probable",
            "margin_target": "probable",
            "sales_to_capital_early": "plausible",
            "sales_to_capital_late": "plausible",
        },
        (POST_CASE_NAME, "expansion"): {
            "base_revenue": "probable",
            "base_margin": "plausible",
            "revenue_target": "probable",
            "margin_target": "probable",
            "sales_to_capital_early": "plausible",
            "sales_to_capital_late": "plausible",
        },
    }

    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        for segment in load_case(_case_id(name))["segments"]:
            actual = {n["input_field"]: n["three_p"] for n in segment["narratives"]}
            assert actual == expected[(name, segment["name"])], f"{name}/{segment['name']}"


def test_below_probable_lists_exactly_the_placeholder_inputs_for_post_case():
    """The whole point of storing three_p: an uncalibrated placeholder input has
    to actually show up in below_probable, or the honesty mechanism is silently
    empty. Exactly the three placeholder fields per segment, four segments."""
    ensure_valuation_cases_seeded()
    below = _run(POST_CASE_NAME)["below_probable"]

    pairs = {(item["segment"], item["input_field"]) for item in below}
    expected_pairs = {
        (segment, field)
        for segment in ("launch", "connectivity", "ai", "expansion")
        for field in ("base_margin", "sales_to_capital_early", "sales_to_capital_late")
    }
    assert pairs == expected_pairs
    assert len(below) == 12
    assert all(item["three_p"] == "plausible" for item in below)


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


def test_seeded_terminal_roic_is_the_shared_literal():
    """roic_stable = 0.33, a single literal shared by both cases rather than a
    per-case erosion policy -- see the seed module's docstring for why a shared
    value tracks the "prospectus barely moved EV" finding better than a
    per-case one did.

    Expectations are literal, not recomputed from the seed module -- a test that
    re-derives its expectation from the code under test cannot catch a wrong value.
    """
    ensure_valuation_cases_seeded()
    pre = load_case(_case_id(PRE_CASE_NAME))
    post = load_case(_case_id(POST_CASE_NAME))
    assert pre["roic_stable"] == pytest.approx(0.33)
    assert post["roic_stable"] == pytest.approx(0.33)


def test_seeded_terminal_roic_sits_below_the_marginal_return():
    """The shared literal must satisfy the engine's two-sided consistency guard
    for both cases, and by a real margin -- an erosion rule that lands at or
    above the marginal return is not erosion.

    marginal values are capital-weighted (post: 118.875 NOPAT / 320.0 capital;
    pre: 113.25 NOPAT / 228.273809... capital at the lowered 1.6/1.6/1.05/1.5
    sales-to-capital values)."""
    ensure_valuation_cases_seeded()
    for name, marginal in (
        (PRE_CASE_NAME, 113.25 / (70 / 1.6 + 120 / 1.6 + 80 / 1.05 + 50 / 1.5)),
        (POST_CASE_NAME, 0.371484375),
    ):
        data = _run(name)
        assert data["marginal_roic_target_year"] == pytest.approx(marginal, abs=1e-9)
        assert load_case(_case_id(name))["roic_stable"] < marginal


def test_run_reports_both_reinvestment_rates_for_the_seeded_cases():
    """The discontinuity the whole change exists to make visible."""
    ensure_valuation_cases_seeded()
    data = _run(POST_CASE_NAME)
    assert data["terminal_reinvestment_rate"] > 0
    assert data["reinvestment_rate_target_year"] > 0
    assert data["explicit_reinvestment_rate_at_stable_growth"] > 0
    assert data["terminal_reinvestment_rate"] < 1
