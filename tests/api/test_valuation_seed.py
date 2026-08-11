"""The seeded SpaceX cases, checked against Damodaran's spreadsheets.

Expectations here are literal, transcribed from
`guideline/sop/todo3-spreadsheet-values.md`, never re-derived from the seed
module's own constants -- a test that reads its expectation out of the code
under test cannot catch a wrong value.
"""

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

# Value of operating assets, `Valuation output!B32` in each workbook.
SOURCE_EV_PRE = 1216.061156
SOURCE_EV_POST = 1224.448006


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
                    "initial_growth",
                )
                if segment[f] is not None
            }
            assert {n["input_field"] for n in segment["narratives"]} == stated


def test_every_seeded_input_is_confirmed_except_the_one_derivation():
    """Reading the spreadsheets turned every seeded input into a transcription.
    The single exception is the post-prospectus launch share: the workbook gives
    a 40.0 revenue target, and 40% is that divided by the blog's $100bn TAM."""
    ensure_valuation_cases_seeded()
    derived = set()
    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        for segment in load_case(_case_id(name))["segments"]:
            for narrative in segment["narratives"]:
                assert narrative["confidence"] in ("confirmed", "derived")
                if narrative["confidence"] == "derived":
                    derived.add((name, segment["name"], narrative["input_field"]))
    assert derived == {(POST_CASE_NAME, "launch", "market_share_target")}


def test_claims_the_source_only_assumed_stay_below_probable():
    """`confidence` and `three_p` are orthogonal, and this is what makes that
    worth storing separately. Every value below is confirmed -- it is the number
    Damodaran used -- yet the claim each one makes is weak:

    - `base_margin` (all eight segments): typed constants that do not reconcile
      with the source's own base-year EBIT.
    - expansion's `revenue_target` and `margin_target`: a placeholder for
      optionality, assumed outright, and DOUBLED between the workbooks (50 ->
      100) while todo3 records it as "assumed unchanged".
    - post-prospectus launch `market_share_target`: this model's own
      decomposition, contradicting todo3's "unchanged at 70%".
    """
    ensure_valuation_cases_seeded()
    below = _run(POST_CASE_NAME)["below_probable"]

    pairs = {(item["segment"], item["input_field"]) for item in below}
    assert pairs == {
        ("launch", "base_margin"),
        ("connectivity", "base_margin"),
        ("ai", "base_margin"),
        ("expansion", "base_margin"),
        ("expansion", "revenue_target"),
        ("expansion", "margin_target"),
        ("launch", "market_share_target"),
    }
    assert len(below) == 7
    assert all(item["three_p"] == "plausible" for item in below)


def test_seeded_target_year_totals_match_the_spreadsheets():
    """`Input sheet!B26:B29` and `B30:B33`, summed. Note both post-prospectus
    totals moved when the spreadsheets were read: revenue 400 -> 420 (todo3
    records launch's target as unchanged at 70; the workbook cuts it to 40, and
    doubles expansion from 50 to 100) and EBIT 158.5 -> 160."""
    ensure_valuation_cases_seeded()
    pre, post = _run(PRE_CASE_NAME), _run(POST_CASE_NAME)
    assert pre["revenue"][-1] == pytest.approx(320.0, abs=1e-6)
    assert pre["ebit"][-1] == pytest.approx(155.0, abs=1e-6)
    assert post["revenue"][-1] == pytest.approx(420.0, abs=1e-6)
    assert post["ebit"][-1] == pytest.approx(160.0, abs=1e-6)


def test_seeded_base_revenue_matches_the_spreadsheets():
    """`Input sheet!B8:B10`. The pre-case total also reconciles with todo3
    section 6's two independent trailing-multiple derivations, both $15.60bn."""
    ensure_valuation_cases_seeded()
    assert _run(PRE_CASE_NAME)["base_revenue_total"] == pytest.approx(15.600, abs=1e-9)
    assert _run(POST_CASE_NAME)["base_revenue_total"] == pytest.approx(18.674, abs=1e-9)


def test_post_prospectus_bridge_uses_prospectus_balance_sheet():
    """`Input sheet!B17`, `B14` and `B18`, to the dollar rather than rounded."""
    ensure_valuation_cases_seeded()
    bridge = _run(POST_CASE_NAME)["equity_bridge"]
    assert bridge["cash"] == pytest.approx(24.747)
    assert bridge["debt"] == pytest.approx(22.896)
    assert bridge["ipo_proceeds"] == pytest.approx(75.0)


def test_seeded_terminal_roic_is_the_spreadsheet_value():
    """`Input sheet!B56` is 0.15 in both workbooks -- an override on the
    template's default of "terminal return = cost of capital". It was 0.33 here
    until the spreadsheets were read, which was the largest single divergence in
    the build: terminal value is ~87% of enterprise value."""
    ensure_valuation_cases_seeded()
    assert load_case(_case_id(PRE_CASE_NAME))["roic_stable"] == pytest.approx(0.15)
    assert load_case(_case_id(POST_CASE_NAME))["roic_stable"] == pytest.approx(0.15)


def test_seeded_terminal_roic_sits_far_below_the_marginal_return():
    """And is reported rather than rejected. Capital-weighted marginal returns,
    computed here from the transcribed inputs alone:

        post  160.0 x 0.75 / (40/4 + 120/5 + 160/2.5 + 100/5) = 120/118
        pre   155.0 x 0.75 / (70/2 + 120/5 +  80/1.5 + 50/3)  = 116.25/129

    Against roic_stable 0.15 those imply +578% and +501% capital intensity. A
    guard rejecting that stood here until 2026-08-11 and rejected both cases;
    see `packages/core_finance/segment_valuation.py`.
    """
    ensure_valuation_cases_seeded()
    for name, marginal in (
        (PRE_CASE_NAME, 116.25 / 129.0),
        (POST_CASE_NAME, 120.0 / 118.0),
    ):
        data = _run(name)
        assert data["marginal_roic_target_year"] == pytest.approx(marginal, abs=1e-12)
        assert data["terminal_capital_intensity_change"] == pytest.approx(
            marginal / 0.15 - 1, abs=1e-12
        )
        assert data["enterprise_value"] > 0


def test_run_reports_both_reinvestment_rates_for_the_seeded_cases():
    """The discontinuity the whole change exists to make visible."""
    ensure_valuation_cases_seeded()
    data = _run(POST_CASE_NAME)
    assert data["terminal_reinvestment_rate"] > 0
    assert data["reinvestment_rate_target_year"] > 0
    assert data["explicit_reinvestment_rate_at_stable_growth"] > 0
    assert data["terminal_reinvestment_rate"] < 1


def test_no_segment_anchors_its_year_one_growth():
    """`initial_growth` is unset everywhere, because the source does not anchor.
    S5's year-1 growth is 58.6% (launch), 63.6% (connectivity) and 326.6% (AI)
    against 2025 actuals of 7.6%, 49.8% and 22.2%. The anchor was this model's
    inference from todo3 R3's `[C]` "slowed near-term growth"; the workbooks
    show that slowdown is real but comes from cutting launch's 2036 target, not
    from pinning year 1."""
    ensure_valuation_cases_seeded()
    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        for segment in load_case(_case_id(name))["segments"]:
            assert segment["initial_growth"] is None, f"{name}/{segment['name']}"
            fields = {n["input_field"] for n in segment["narratives"]}
            assert "initial_growth" not in fields


def test_the_sales_to_capital_slope_reverses_between_the_cases():
    """`Input sheet!B36:C39`. This is what closed the pre/post enterprise-value
    direction question, and no blog post mentions it.

    April has the late ratio at or BELOW the early one -- capital intensity
    rising with scale. June has it at or ABOVE. So the June revision lowered the
    early ratios (which todo3 I2 records) and raised the late ones (which it
    does not). Every earlier attempt to reach the source's rising EV by tuning a
    single "lowering magnitude" was working on the wrong parameter.
    """
    ensure_valuation_cases_seeded()
    pre = {s["name"]: s for s in load_case(_case_id(PRE_CASE_NAME))["segments"]}
    post = {s["name"]: s for s in load_case(_case_id(POST_CASE_NAME))["segments"]}

    expected_pre = {"launch": (4.0, 2.0), "connectivity": (10.0, 5.0),
                    "ai": (2.5, 1.5), "expansion": (3.0, 3.0)}
    expected_post = {"launch": (3.0, 4.0), "connectivity": (3.0, 5.0),
                     "ai": (1.5, 2.5), "expansion": (5.0, 5.0)}

    for name, (early, late) in expected_pre.items():
        assert pre[name]["sales_to_capital_early"] == pytest.approx(early), name
        assert pre[name]["sales_to_capital_late"] == pytest.approx(late), name
        assert pre[name]["sales_to_capital_late"] <= pre[name]["sales_to_capital_early"], name
    for name, (early, late) in expected_post.items():
        assert post[name]["sales_to_capital_early"] == pytest.approx(early), name
        assert post[name]["sales_to_capital_late"] == pytest.approx(late), name
        assert post[name]["sales_to_capital_late"] >= post[name]["sales_to_capital_early"], name


def test_early_sales_to_capital_still_carries_the_confirmed_lowering():
    """todo3 I2's `[C]` claim survives contact with the spreadsheet: the
    years-1-5 ratios did fall for all three revenue-earning segments."""
    ensure_valuation_cases_seeded()
    pre = {s["name"]: s for s in load_case(_case_id(PRE_CASE_NAME))["segments"]}
    post = {s["name"]: s for s in load_case(_case_id(POST_CASE_NAME))["segments"]}
    for name in ("launch", "connectivity", "ai"):
        assert pre[name]["sales_to_capital_early"] > post[name]["sales_to_capital_early"], name


def test_enterprise_value_tracks_the_spreadsheets():
    """The first test here to assert an explicit-period-sensitive number against
    an independently sourced expectation, rather than a sum of input literals.

    The post case lands within 0.5% of the source and the pre case within 2.5%.
    The asymmetry is the point: terminal value is ~87% of post-prospectus value
    and depends only on the target year, which now matches exactly, so the
    remaining error is almost entirely in the explicit period -- where this
    engine's decaying growth curve still differs from the source's gap-closing
    interpolation. The pre workbook is also the hand-edited one, with a
    different waypoint rule per segment.

    These bounds are a regression guard, not a target. Tightening them is the
    job of the revenue-shape work; if it lands, they should be tightened.
    """
    ensure_valuation_cases_seeded()
    pre_ev = _run(PRE_CASE_NAME)["enterprise_value"]
    post_ev = _run(POST_CASE_NAME)["enterprise_value"]
    assert pre_ev == pytest.approx(SOURCE_EV_PRE, rel=0.025)
    assert post_ev == pytest.approx(SOURCE_EV_POST, rel=0.005)


def test_the_pre_post_enterprise_value_direction_is_still_inverted():
    """Recorded, not asserted as correct. The source has enterprise value RISING
    1216.06 -> 1224.45 (+0.69%); this engine still has it falling, because the
    pre case carries the larger explicit-period error (+2.0% vs -0.4%).

    Every confirmed input now matches the spreadsheets, so the residual is the
    revenue path shape and nothing else. This test exists to fail loudly when
    the shape work lands -- at which point it should be inverted, not deleted.
    """
    ensure_valuation_cases_seeded()
    pre_ev = _run(PRE_CASE_NAME)["enterprise_value"]
    post_ev = _run(POST_CASE_NAME)["enterprise_value"]
    assert SOURCE_EV_POST > SOURCE_EV_PRE
    assert post_ev < pre_ev
