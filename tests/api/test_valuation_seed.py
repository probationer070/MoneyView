"""The seeded SpaceX cases, checked against Damodaran's spreadsheets.

Expectations here are literal, transcribed from
`guideline/sop/todo3-spreadsheet-values.md`, never re-derived from the seed
module's own constants -- a test that reads its expectation out of the code
under test cannot catch a wrong value.
"""

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.valuation_case import create_case, list_cases, load_case
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
                    "initial_growth", "waypoint_gap_fraction",
                )
                if segment[f] is not None
            }
            assert {n["input_field"] for n in segment["narratives"]} == stated


def test_only_inputs_the_workbooks_do_not_state_are_tagged_derived():
    """`confirmed` is defined as "this value is a cell in one of the workbooks".
    Three kinds of input are not, and must not claim to be:

    - `tam_target`: neither workbook carries a TAM. They carry a single typed
      revenue target; the TAM comes from todo3 quoting the blog posts.
    - `market_share_target`: the quotient of that revenue target and that TAM.
    - the PRE case's `waypoint_gap_fraction`: S5 states its waypoint as an input
      (`Valuation output!G3` is `=B3+($L$3-B3)*(1/3)`), but S4 states none --
      its launch row is `=F3+($L$3-F3)*(1/6)`, the last step of a straight line,
      so 0.5 is an emergent property rather than a number Damodaran typed.

    Written as a literal set: a test that recomputes this from the seed module
    cannot catch a wrong tag.
    """
    ensure_valuation_cases_seeded()
    derived = set()
    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        for segment in load_case(_case_id(name))["segments"]:
            for narrative in segment["narratives"]:
                assert narrative["confidence"] in ("confirmed", "derived")
                if narrative["confidence"] == "derived":
                    derived.add((name, segment["name"], narrative["input_field"]))

    assert derived == {
        (case, seg, field)
        for case in (PRE_CASE_NAME, POST_CASE_NAME)
        for seg in ("launch", "connectivity")
        for field in ("tam_target", "market_share_target")
    } | {
        (PRE_CASE_NAME, seg, "waypoint_gap_fraction")
        for seg in ("launch", "connectivity", "ai")
    }


def test_the_post_case_waypoint_is_confirmed_because_it_is_a_cell():
    """The other side of the test above: without it, `derived` could spread to
    every tag in the seed and still pass."""
    ensure_valuation_cases_seeded()
    checked = 0
    for segment in load_case(_case_id(POST_CASE_NAME))["segments"]:
        claims = {n["input_field"]: n for n in segment["narratives"]}
        if segment["waypoint_gap_fraction"] is not None:
            assert claims["waypoint_gap_fraction"]["confidence"] == "confirmed"
            checked += 1
    assert checked == 3


def test_claims_the_source_only_assumed_stay_below_probable():
    """`confidence` and `three_p` are orthogonal, and this is what makes them
    worth storing separately. Every value below is the number Damodaran used,
    yet the claim each one makes is weak:

    - `base_margin`, all eight segments: typed constants that do not reconcile
      with the source's own base-year EBIT.
    - expansion's `revenue_target` and `margin_target`, both cases: a
      placeholder for optionality, assumed outright, and DOUBLED between the
      workbooks (50 -> 100) while todo3 records it as "assumed unchanged".
    - post-prospectus launch `market_share_target`: 40% contradicts todo3's
      "unchanged at 70%", so its claim is weak as well as derived.

    BOTH cases are checked. Until 2026-08-11 this ran only the post case, and
    the pre case's four segments could carry any three_p at all -- flipping the
    pre expansion's revenue_target to "probable" passed.
    """
    ensure_valuation_cases_seeded()

    common = {
        (seg, "base_margin")
        for seg in ("launch", "connectivity", "ai", "expansion")
    } | {("expansion", "revenue_target"), ("expansion", "margin_target")}

    for name, expected in (
        (PRE_CASE_NAME, common),
        (POST_CASE_NAME, common | {("launch", "market_share_target")}),
    ):
        below = _run(name)["below_probable"]
        pairs = {(item["segment"], item["input_field"]) for item in below}
        assert pairs == expected, name
        assert len(below) == len(expected), name
        assert all(item["three_p"] == "plausible" for item in below), name


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
    rising with scale. June has it at or ABOVE.

    Stated precisely, because the summary version overreaches: of the three
    earning segments the early ratio fell in all three (which todo3 I2 records)
    and the late ratio rose in launch and AI but is UNCHANGED at 5 for
    connectivity. Expansion moves the other way entirely, 3 -> 5 in both blocks.
    So "lowered the early, raised the late" is the shape of the change, not a
    statement true of every cell. Every earlier attempt to reach the source's
    rising EV by tuning a single "lowering magnitude" was working on the wrong
    parameter regardless.
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


def test_post_prospectus_reproduces_the_spreadsheet_exactly():
    """Not "within a tolerance" -- to the cent, through HTTP.

    Every input is transcribed, the gap-closing revenue curve reproduces the
    source's own path, and the effective-tax ramp reproduces its tax row. What
    is left is arithmetic both sides do identically.
    """
    ensure_valuation_cases_seeded()
    data = _run(POST_CASE_NAME)
    assert data["enterprise_value"] == pytest.approx(SOURCE_EV_POST, abs=1e-3)
    assert data["equity_value"] == pytest.approx(1301.299006, abs=1e-3)
    assert data["value_per_share_diluted"] == pytest.approx(97.827655, abs=1e-4)


def test_pre_prospectus_tracks_the_spreadsheet_once_its_error_is_corrected():
    """S4 cannot be reproduced, and should not be: it contains a formula error.

    `Valuation output!D15:L15` computes launch's reinvestment as the change in
    TOTAL revenue (row 7) over launch's sales-to-capital ratio, instead of the
    change in launch's own revenue (row 3). Only year 1 is right. Over the ten
    years that overstates launch reinvestment 119682.5 against a correct
    24712.5 -- nearly 5x -- which suppresses FCFF and pushes S4's enterprise
    value down to the published 1216.06. S5 has the same row reading row 3
    throughout; the error was fixed between the two workbooks.

    This engine computes it correctly, so it reproduces the CORRECTED April
    valuation, ~1270.8. The residual against that is the within-block
    interpolation: S4 uses a constant 0.2 fraction in its first block and a
    straight line in its second, where S5 (and this engine) use 0.2/0.3/0.4/0.5
    in both. Reproducing S4 exactly would need per-segment, per-block shape
    configuration for a workbook that has no single rule.
    """
    ensure_valuation_cases_seeded()
    pre_ev = _run(PRE_CASE_NAME)["enterprise_value"]
    assert pre_ev == pytest.approx(1270.8, rel=0.01)
    # And explicitly NOT the published figure: this engine is above it by about
    # the discounted value of the overstated reinvestment.
    assert pre_ev > SOURCE_EV_PRE
    assert pre_ev - SOURCE_EV_PRE == pytest.approx(64.1, abs=1.0)


def test_the_pre_post_direction_agrees_with_the_corrected_source():
    """The long-running divergence, closed -- in the engine's favour.

    As published, the source has enterprise value RISING 1216.06 -> 1224.45
    (+0.69%), and todo3's headline reads that as a 277-page prospectus barely
    moving value. Corrected for S4's reinvestment error, the April valuation is
    ~1270.8 and value FALLS about 3.6%. This engine has always shown a fall.

    So the direction this model was repeatedly "wrong" about was right, and the
    source's rise is an artifact of a formula error in the April spreadsheet.
    """
    ensure_valuation_cases_seeded()
    pre_ev = _run(PRE_CASE_NAME)["enterprise_value"]
    post_ev = _run(POST_CASE_NAME)["enterprise_value"]
    assert post_ev < pre_ev
    assert post_ev / pre_ev - 1 == pytest.approx(-0.036, abs=0.01)


def test_the_seeded_waypoints_are_the_ones_each_workbook_uses():
    """S5 applies 1/3 to all four segments. S4 does not: launch and
    connectivity sit at 0.5 and AI at 1/3, transcribed per segment rather than
    smoothed to one value."""
    ensure_valuation_cases_seeded()
    pre = {s["name"]: s["waypoint_gap_fraction"]
           for s in load_case(_case_id(PRE_CASE_NAME))["segments"]}
    post = {s["name"]: s["waypoint_gap_fraction"]
            for s in load_case(_case_id(POST_CASE_NAME))["segments"]}
    assert pre == pytest.approx(
        {"launch": 0.5, "connectivity": 0.5, "ai": 1 / 3, "expansion": None}
    )
    assert post == pytest.approx(
        {"launch": 1 / 3, "connectivity": 1 / 3, "ai": 1 / 3, "expansion": None}
    )


def test_the_effective_tax_rate_is_seeded_and_ramps():
    """`Input sheet!B23` is 0.10 in both workbooks, and B63 is "No", so the rate
    converges to the 0.25 marginal by year 10 rather than holding. Worth 19.4 of
    enterprise value on the post case -- the single largest remaining error
    before it was added."""
    ensure_valuation_cases_seeded()
    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        assert load_case(_case_id(name))["effective_tax_rate"] == pytest.approx(0.10)
    data = _run(POST_CASE_NAME)
    rates = [tax / ebit for tax, ebit in zip(data["tax"], data["ebit"])]
    assert rates[:5] == pytest.approx([0.10] * 5)
    assert rates[5:] == pytest.approx([0.13, 0.16, 0.19, 0.22, 0.25])


def test_a_case_that_could_never_run_is_rejected_at_write_time():
    """Both combinations below make `run_case` raise, so without a write-time
    check a POST returns 201 and every subsequent /run returns 422 -- the case
    is permanently stored and permanently unrunnable."""
    base = {
        "case_name": "unrunnable", "ticker": None, "as_of_date": "2026-01-01",
        "base_year": 2026, "target_year": 2036, "riskfree_rate": 0.04,
        "wacc_initial": 0.09, "wacc_stable": 0.08, "wacc_converge_from": 6,
        "marginal_tax_rate": 0.25, "nol_balance": 0.0, "roic_stable": 0.15,
        "terminal_growth": None, "effective_tax_rate": None, "cash": 0.0,
        "debt": 0.0, "ipo_proceeds": 0.0, "shares_basic": 1.0, "shares_new": 0.0,
        "parent_case_id": None,
    }
    segment = {
        "name": "core", "base_revenue": 10.0, "base_margin": 0.0,
        "tam_target": None, "market_share_target": None, "revenue_target": 100.0,
        "margin_target": 0.2, "sales_to_capital_early": 1.0,
        "sales_to_capital_late": 1.5, "ramp_start_year": 1,
        "initial_growth": None, "waypoint_gap_fraction": None,
        "narratives": [
            {"input_field": f, "claim": "c", "evidence_source": None,
             "confidence": "assumed", "three_p": "possible"}
            for f in ("base_revenue", "base_margin", "revenue_target",
                      "margin_target", "sales_to_capital_early",
                      "sales_to_capital_late")
        ],
    }

    both = {**segment, "initial_growth": 0.5, "waypoint_gap_fraction": 0.5}
    both["narratives"] = both["narratives"] + [
        {"input_field": f, "claim": "c", "evidence_source": None,
         "confidence": "assumed", "three_p": "possible"}
        for f in ("initial_growth", "waypoint_gap_fraction")
    ]
    with pytest.raises(ValueError, match="different revenue curves"):
        create_case({**base, "segments": [both]})

    short = {**segment, "waypoint_gap_fraction": 0.5}
    short["narratives"] = short["narratives"] + [
        {"input_field": "waypoint_gap_fraction", "claim": "c",
         "evidence_source": None, "confidence": "assumed", "three_p": "possible"}
    ]
    with pytest.raises(ValueError, match="10-year horizon"):
        create_case({**base, "target_year": 2038, "segments": [short]})

    assert not [c for c in list_cases() if c["case_name"] == "unrunnable"]
