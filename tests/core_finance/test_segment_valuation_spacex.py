"""Damodaran's two SpaceX cases as engine acceptance gates.

Every input below is a cell in one of his two spreadsheets, transcribed in
`guideline/sop/todo3-spreadsheet-values.md`:

    S4  SpaceX2026IPO.xlsx          valued 2026-04-01  (pre-prospectus)
    S5  SpaceX2026IPOUpdated.xlsx   valued 2026-06-01  (post-prospectus)

This case data also lives in `apps/api/services/valuation_seed.py`, and the
duplication is deliberate. These gates test the engine, which lives in
`packages/core_finance` and must not import from `apps/api` -- the dependency
runs one way (guideline/sop/file-structure.md:42). Importing the seed here would
invert it, and dropping these gates in favour of the seed's would leave the
engine with no acceptance test at its own commit. The two copies must agree;
`tests/api/test_valuation_seed.py` asserts the same numbers from the other side.

Enterprise value IS asserted here, unlike before -- against the source's own
figure, with a recorded tolerance. Everything that used to be a `[V]` guess is
now a transcription, so a comparison against the source finally means something.
"""

import pytest

from packages.core_finance.segment_valuation import (
    CaseSpec,
    SegmentSpec,
    marginal_roic,
    run_case,
)

# Value of operating assets, `Valuation output!B32` in each workbook.
SOURCE_EV_PRE = 1216.061156
SOURCE_EV_POST = 1224.448006

# `Input sheet!B8:B10`. The workbooks carry one revenue row per segment, so the
# split is transcribed, not apportioned. The pre-case total of 15.600 also
# matches todo3 section 6's two trailing-multiple derivations exactly
# (1250/80.13 and 1750/112.18); the post case's 18.674 does not, because the
# prospectus disclosed xAI revenue that the April valuation had to guess at.
BASE_REVENUE_PRE = {"launch": 4.100, "connectivity": 11.400, "ai": 0.100, "expansion": 0.0}
BASE_REVENUE_POST = {"launch": 4.086, "connectivity": 11.387, "ai": 3.201, "expansion": 0.0}

# `Valuation output!B8:B11`, identical in both workbooks.
BASE_MARGIN = {"launch": 0.08, "connectivity": 0.10, "ai": -0.05, "expansion": 0.0}


def _segment(name, base_revenue, *, margin_target, s2c_early, s2c_late,
             waypoint=None, **endpoint):
    return SegmentSpec(
        name=name,
        base_revenue=base_revenue[name],
        base_margin=BASE_MARGIN[name],
        margin_target=margin_target,
        sales_to_capital_early=s2c_early,
        sales_to_capital_late=s2c_late,
        # `Valuation output` row 6: zero through year 5, first revenue in year 6.
        ramp_start_year=6 if name == "expansion" else 1,
        # Unset deliberately. S5's year-1 growth is 58.6% / 63.6% / 326.6%
        # against 2025 actuals of 7.6% / 49.8% / 22.2% -- the source does not
        # anchor year-1 growth to the observed rate.
        initial_growth=None,
        # `Valuation output` row 3: close 20/30/40/50% of the remaining gap to
        # a waypoint, land on it in year 5, repeat toward the target.
        waypoint_gap_fraction=waypoint,
        **endpoint,
    )


def pre_prospectus() -> tuple[CaseSpec, list[SegmentSpec]]:
    case = CaseSpec(
        base_year=2026, target_year=2036,
        riskfree_rate=0.0420, wacc_initial=0.08024591576065232, wacc_stable=0.0800,
        wacc_converge_from=6, marginal_tax_rate=0.25,
        # `Input sheet!B23`, ramping to the marginal rate by year 10.
        effective_tax_rate=0.10,
        # `Input sheet!B65` is "No", so the 250 in B66 never enters the model.
        nol_balance=0.0,
        # `Input sheet!B56`, an override on the template's default of
        # "terminal return = cost of capital".
        roic_stable=0.15,
        cash=0.0, debt=0.0, ipo_proceeds=0.0,
        shares_basic=2.416667, shares_new=0.0,
    )
    b = BASE_REVENUE_PRE
    segments = [
        _segment("launch", b, tam_target=100.0, market_share_target=0.70,
                 margin_target=0.40, s2c_early=4.0, s2c_late=2.0, waypoint=0.5),
        _segment("connectivity", b, tam_target=160.0, market_share_target=0.75,
                 margin_target=0.60, s2c_early=10.0, s2c_late=5.0, waypoint=0.5),
        # 50%, not 45%. `Input sheet!B32` is 0.5. todo3 section 3 footnote 1
        # instructed treating 45% as the value actually used and the blog's 50%
        # as a text error, pending the spreadsheet -- the blog was right.
        _segment("ai", b, revenue_target=80.0, margin_target=0.50,
                 s2c_early=2.5, s2c_late=1.5, waypoint=1 / 3),
        _segment("expansion", b, revenue_target=50.0, margin_target=0.30,
                 s2c_early=3.0, s2c_late=3.0),
    ]
    return case, segments


def post_prospectus() -> tuple[CaseSpec, list[SegmentSpec]]:
    case = CaseSpec(
        base_year=2026, target_year=2036,
        riskfree_rate=0.0456, wacc_initial=0.0837450225998141, wacc_stable=0.0825,
        wacc_converge_from=6, marginal_tax_rate=0.25, nol_balance=0.0,
        effective_tax_rate=0.10, roic_stable=0.15,
        cash=24.747, debt=22.896, ipo_proceeds=75.0,
        # `Valuation output!B43` minus `Input sheet!B21`: 13301.95438 -
        # 12535.3. The source solves this circularly, dividing proceeds by the
        # value per share it is simultaneously computing; this engine does not
        # iterate, so the solved count is transcribed.
        shares_basic=12.5353, shares_new=0.76665438,
    )
    b = BASE_REVENUE_POST
    segments = [
        # 40% share, not 70%: `Input sheet!B26` cuts launch's 2036 revenue from
        # 70.0 to 40.0, and 40.0 / the blog's confirmed $100bn TAM is 40%. todo3
        # section 3 records this target as unchanged across both valuations.
        _segment("launch", b, tam_target=100.0, market_share_target=0.40,
                 margin_target=0.45, s2c_early=3.0, s2c_late=4.0, waypoint=1 / 3),
        _segment("connectivity", b, tam_target=160.0, market_share_target=0.75,
                 margin_target=0.60, s2c_early=3.0, s2c_late=5.0, waypoint=1 / 3),
        _segment("ai", b, revenue_target=160.0, margin_target=0.25,
                 s2c_early=1.5, s2c_late=2.5, waypoint=1 / 3),
        # Doubled from 50.0 (`Input sheet!B29`). todo3 tags this "assumed
        # unchanged" in both valuations; the spreadsheet shows it was not.
        _segment("expansion", b, revenue_target=100.0, margin_target=0.30,
                 s2c_early=5.0, s2c_late=5.0),
    ]
    return case, segments


def test_pre_prospectus_target_year_totals():
    """`Input sheet!B26:B29` sum to 320.0; times B30:B33, 155.0."""
    result = run_case(*pre_prospectus())
    assert result.revenue[-1] == pytest.approx(320.0, abs=1e-6)
    assert result.ebit[-1] == pytest.approx(155.0, abs=1e-6)


def test_post_prospectus_target_year_totals():
    """`Input sheet!B26:B29` sum to 420.0; times B30:B33, 160.0.

    todo3 section 3 gives 400.0 and 158.5 -- wrong on both counts, because it
    records launch's target as unchanged at 70 (the workbook cuts it to 40) and
    expansion's as unchanged at 50 (the workbook doubles it to 100).
    """
    result = run_case(*post_prospectus())
    assert result.revenue[-1] == pytest.approx(420.0, abs=1e-6)
    assert result.ebit[-1] == pytest.approx(160.0, abs=1e-6)


def test_pre_prospectus_revenue_matches_the_forward_multiple():
    """Independent corroboration: todo3 section 6 quotes a 3.91x forward
    EV/Sales at a $1.25T price, and 1250 / 3.91 = 319.7."""
    result = run_case(*pre_prospectus())
    assert result.revenue[-1] == pytest.approx(1250 / 3.91, rel=0.002)


def test_base_revenue_matches_the_spreadsheets():
    """The pre case reconciles with todo3 section 6's two trailing-multiple
    derivations; the post case does not, and should not."""
    pre = run_case(*pre_prospectus())
    post = run_case(*post_prospectus())
    assert pre.base_revenue_total == pytest.approx(15.600, abs=1e-9)
    assert pre.base_revenue_total == pytest.approx(1250 / 80.13, abs=0.05)
    assert pre.base_revenue_total == pytest.approx(1750 / 112.18, abs=0.05)
    assert post.base_revenue_total == pytest.approx(18.674, abs=1e-9)


def test_offsetting_changes_barely_move_target_year_ebit():
    """todo3 section 3's central finding survives the spreadsheet, with
    different numbers: target-year revenue rises 31% but EBIT only 3.2%,
    because AI's revenue doubling and the launch margin uplift are almost
    exactly cancelled by AI's margin collapse and launch's revenue cut."""
    pre = run_case(*pre_prospectus())
    post = run_case(*post_prospectus())
    assert post.revenue[-1] / pre.revenue[-1] == pytest.approx(420 / 320, abs=1e-9)
    assert abs(post.ebit[-1] / pre.ebit[-1] - 1) < 0.05


def test_expansion_segment_contributes_nothing_before_2032():
    """todo3 R5: the real-option proxy ramps only after year 6. `Valuation
    output` row 6 puts its first revenue in year 6 (2032), not year 7."""
    result = run_case(*post_prospectus())
    expansion = next(s for s in result.segments if s.name == "expansion")
    assert expansion.revenue[:5] == [0.0] * 5
    assert expansion.ebit[:5] == [0.0] * 5
    assert expansion.reinvestment[:5] == [0.0] * 5
    assert expansion.revenue[5] == pytest.approx(20.0)
    assert expansion.revenue[-1] == pytest.approx(100.0)


def test_post_prospectus_marginal_roic():
    """Capital-weighted: sum(NOPAT_i) / sum(capital_i), where NOPAT_i =
    revenue_i x margin_i x (1 - tau) and capital_i = revenue_i /
    sales_to_capital_late_i. Every input is now a transcription:

        launch       NOPAT = 40  x 0.45 x 0.75 = 13.5   capital = 40/4   = 10.0
        connectivity NOPAT = 120 x 0.60 x 0.75 = 54.0   capital = 120/5  = 24.0
        ai           NOPAT = 160 x 0.25 x 0.75 = 30.0   capital = 160/2.5 = 64.0
        expansion    NOPAT = 100 x 0.30 x 0.75 = 22.5   capital = 100/5  = 20.0
        total NOPAT = 120.0, total capital = 118.0
        marginal_roic = 120 / 118 = 1.016949...
    """
    case, segments = post_prospectus()
    assert marginal_roic(segments, case.marginal_tax_rate) == pytest.approx(
        120.0 / 118.0, abs=1e-12
    )


def test_pre_prospectus_marginal_roic():
    """Same formula at the April sales-to-capital values (4 / 10 / 2.5 / 3,
    late block 2 / 5 / 1.5 / 3):

        launch       NOPAT = 70  x 0.40 x 0.75 = 21.0   capital = 70/2   = 35.0
        connectivity NOPAT = 120 x 0.60 x 0.75 = 54.0   capital = 120/5  = 24.0
        ai           NOPAT = 80  x 0.50 x 0.75 = 30.0   capital = 80/1.5 = 53.333...
        expansion    NOPAT = 50  x 0.30 x 0.75 = 11.25  capital = 50/3   = 16.666...
        total NOPAT = 116.25, total capital = 129.0
        marginal_roic = 116.25 / 129 = 0.901162...

    LOWER than the post case, the opposite of what the pre-spreadsheet fixtures
    had. The April model's late-block ratios sit at or below its early ones;
    June's sit at or above.
    """
    case, segments = pre_prospectus()
    assert marginal_roic(segments, case.marginal_tax_rate) == pytest.approx(
        116.25 / 129.0, abs=1e-12
    )


def test_terminal_roic_is_far_below_the_marginal_return_and_still_runs():
    """0.15 against marginal returns of 1.017 and 0.901 implies +578% and +501%
    capital intensity. A guard rejecting that stood in the engine until
    2026-08-11 and rejected both of these cases -- the source it exists to
    reproduce. It is now reported instead."""
    for builder, marginal in ((pre_prospectus, 116.25 / 129.0),
                              (post_prospectus, 120.0 / 118.0)):
        result = run_case(*builder())
        assert result.terminal_capital_intensity_change == pytest.approx(
            marginal / 0.15 - 1, abs=1e-12
        )
        assert result.enterprise_value > 0


# `Valuation output` rows 3-5, column C..L, post-prospectus workbook, in $bn.
SOURCE_POST_REVENUE = {
    "launch": [6.48026667, 9.35338667, 12.03496533, 14.04614933, 16.05733333,
               20.84586667, 26.59210667, 31.955264, 35.977632, 40.0],
    "connectivity": [18.62786667, 27.31690667, 35.42667733, 41.50900533,
                     47.59133333, 62.07306667, 79.45114667, 95.670688,
                     107.835344, 120.0],
    "ai": [13.65426667, 26.19818667, 37.90584533, 46.68658933, 55.46733333,
           76.37386667, 101.46170667, 124.877024, 142.438512, 160.0],
}


def test_post_prospectus_revenue_path_matches_the_spreadsheet_year_by_year():
    """Not just the endpoint. The gap-closing curve reproduces every cell of
    `Valuation output` rows 3-5, which is what makes the enterprise-value match
    below a reproduction rather than a coincidence of the terminal block."""
    result = run_case(*post_prospectus())
    by_name = {s.name: s for s in result.segments}
    for name, expected in SOURCE_POST_REVENUE.items():
        assert by_name[name].revenue == pytest.approx(expected, abs=1e-6), name


def test_post_prospectus_tax_rate_path_matches_the_spreadsheet():
    """`Valuation output` row 13: flat at the 10% effective rate through year 5,
    then linear to the 25% marginal rate by year 10."""
    result = run_case(*post_prospectus())
    rates = [tax / ebit for tax, ebit in zip(result.tax, result.ebit)]
    assert rates == pytest.approx([0.10] * 5 + [0.13, 0.16, 0.19, 0.22, 0.25])


def test_post_prospectus_reproduces_the_spreadsheet_exactly():
    """The whole point. Enterprise value, both components, and value per share,
    to the cent against `Valuation output` B31/B30/B32/B44."""
    result = run_case(*post_prospectus())
    assert result.pv_explicit == pytest.approx(161.8819499, abs=1e-6)
    assert result.pv_terminal == pytest.approx(1062.5660566, abs=1e-6)
    assert result.enterprise_value == pytest.approx(SOURCE_EV_POST, abs=1e-6)
    assert result.equity_value == pytest.approx(1301.2990065, abs=1e-6)
    assert result.value_per_share_diluted == pytest.approx(97.8276552, abs=1e-6)


def test_pre_prospectus_tracks_the_spreadsheet_once_its_error_is_corrected():
    """S4 contains a formula error and is not reproduced as published.

    `Valuation output!D15:L15` computes launch's reinvestment as the change in
    TOTAL revenue (row 7) over launch's sales-to-capital ratio, rather than the
    change in launch's own revenue (row 3). Year 1 alone is correct. Over ten
    years that gives launch reinvestment of 119682.5 against a correct 24712.5,
    suppressing FCFF and holding S4's published enterprise value down to
    1216.06. S5's row 15 reads row 3 in every column -- fixed between the two.

    Corrected, the April valuation is ~1270.8, and this engine lands within 1%
    of that. The residual is the within-block interpolation: S4 uses a constant
    0.2 fraction in its first block and a straight line in its second, where S5
    and this engine use 0.2/0.3/0.4/0.5 in both.
    """
    result = run_case(*pre_prospectus())
    assert result.enterprise_value == pytest.approx(1270.8, rel=0.01)
    assert result.enterprise_value > SOURCE_EV_PRE


def test_the_pre_post_direction_agrees_with_the_corrected_source():
    """As published the source has enterprise value rising 1216.06 -> 1224.45.
    Corrected for S4's reinvestment error it falls, ~1270.8 -> 1224.45. This
    engine has always shown a fall, and now agrees with the corrected source
    rather than diverging from the published one."""
    pre = run_case(*pre_prospectus())
    post = run_case(*post_prospectus())
    assert post.enterprise_value < pre.enterprise_value
    assert post.enterprise_value / pre.enterprise_value - 1 == pytest.approx(
        -0.036, abs=0.01
    )
