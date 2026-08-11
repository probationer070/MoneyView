import pytest

from packages.core_finance.segment_valuation import (
    CaseSpec,
    SegmentSpec,
    _anchored_growth_rates,
    _decaying_growth_rates,
    _hump_amplitude_lower_bound,
    _solve_first_year_growth,
    discount_factors,
    margin_path,
    marginal_roic,
    reinvestment,
    revenue_path,
    run_case,
    tax_path,
    terminal_value,
    wacc_path,
)


def _launch() -> SegmentSpec:
    return SegmentSpec(
        name="launch",
        base_revenue=4.1,
        base_margin=-0.10,
        margin_target=0.45,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        tam_target=100.0,
        market_share_target=0.70,
    )


def test_target_revenue_is_tam_times_share():
    assert _launch().target_revenue() == pytest.approx(70.0)


def test_target_revenue_prefers_explicit_override():
    spec = SegmentSpec(
        name="ai",
        base_revenue=0.1,
        base_margin=-0.50,
        margin_target=0.25,
        sales_to_capital_early=0.6,
        sales_to_capital_late=1.0,
        revenue_target=160.0,
    )
    assert spec.target_revenue() == pytest.approx(160.0)


def test_target_revenue_raises_without_tam_share_or_override():
    spec = SegmentSpec(
        name="broken",
        base_revenue=1.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.0,
    )
    with pytest.raises(ValueError, match="broken"):
        spec.target_revenue()


def test_revenue_path_lands_exactly_on_target():
    path = revenue_path(_launch(), n=10, g_stable=0.0456)
    assert len(path) == 10
    assert path[-1] == pytest.approx(70.0, abs=1e-9)


def test_revenue_growth_decays_monotonically():
    """Front-loaded growth is the whole point of the target-year template.

    Checking the growth *rates* rather than the revenue levels: revenue rises
    every year in any growing path, so asserting on levels would pass even for
    a uniform CAGR, which is exactly the shape this curve exists not to be.
    """
    path = revenue_path(_launch(), n=10, g_stable=0.0456)
    levels = [4.1, *path]
    growths = [levels[i + 1] / levels[i] - 1 for i in range(len(path))]
    assert all(growths[i] > growths[i + 1] for i in range(len(growths) - 1))
    assert growths[-1] == pytest.approx(0.0456, abs=1e-9)


def test_ramped_segment_is_zero_until_ramp_start_then_linear():
    spec = SegmentSpec(
        name="expansion",
        base_revenue=0.0,
        base_margin=0.0,
        margin_target=0.30,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=50.0,
        ramp_start_year=7,
    )
    path = revenue_path(spec, n=10, g_stable=0.0456)
    assert path[:6] == [0.0] * 6
    assert path[6:] == pytest.approx([12.5, 25.0, 37.5, 50.0])


def test_revenue_path_rejects_non_positive_target():
    spec = SegmentSpec(
        name="shrinking",
        base_revenue=100.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.0,
        revenue_target=-5.0,
    )
    with pytest.raises(ValueError, match="positive"):
        revenue_path(spec, n=10, g_stable=0.0456)


def test_revenue_path_rejects_unreachable_growth_bracket():
    """A positive target so small relative to base_revenue that even the most
    negative allowed year-1 growth (-99%) cannot decay revenue down to it
    within the horizon. This drives the bracket check inside
    `_solve_first_year_growth` itself, unlike the non-positive-target case
    above which never reaches that helper.
    """
    spec = SegmentSpec(
        name="collapsing",
        base_revenue=1_000_000.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.0,
        revenue_target=1.0,
    )
    with pytest.raises(ValueError, match="unreachable"):
        revenue_path(spec, n=10, g_stable=0.0456)


def test_revenue_path_rejects_ramp_start_with_existing_revenue():
    spec = SegmentSpec(
        name="incoherent",
        base_revenue=10.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.0,
        revenue_target=50.0,
        ramp_start_year=3,
    )
    with pytest.raises(ValueError) as exc_info:
        revenue_path(spec, n=10, g_stable=0.0456)
    message = str(exc_info.value)
    assert "incoherent" in message
    assert "ramp_start_year=3" in message
    assert "base_revenue=10" in message


def test_revenue_path_rejects_negative_base_revenue_on_ramp_branch():
    spec = SegmentSpec(
        name="negative-ramp",
        base_revenue=-5.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.0,
        revenue_target=50.0,
        ramp_start_year=2,
    )
    with pytest.raises(ValueError, match="base_revenue must not be negative"):
        revenue_path(spec, n=10, g_stable=0.0456)


def test_margin_takes_one_step_in_year_one_and_ends_at_target():
    # margin_t = base_margin + (margin_target - base_margin) * t / n, so year 1
    # (t=1, n=10) is one step of convergence past base_margin, not base_margin
    # itself -- this keeps margin offset from base by the same one step that
    # revenue_path's year-1 growth is offset from base_revenue.
    path = margin_path(_launch(), n=10)
    assert path[0] == pytest.approx(-0.10 + (0.45 - -0.10) * 1 / 10)
    assert path[-1] == pytest.approx(0.45)


def test_margin_converges_linearly():
    path = margin_path(_launch(), n=10)
    steps = [path[i + 1] - path[i] for i in range(len(path) - 1)]
    assert steps == pytest.approx([steps[0]] * len(steps))


def test_reinvestment_is_revenue_delta_over_sales_to_capital():
    spec = SegmentSpec(
        name="s",
        base_revenue=10.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=2.0,
        sales_to_capital_late=4.0,
        revenue_target=20.0,
    )
    revenues = [12.0, 14.0, 15.0, 16.0, 17.0, 18.0]
    result = reinvestment(revenues, spec)
    # Years 1-5 use the early ratio, year 6 the late one.
    assert result == pytest.approx([1.0, 1.0, 0.5, 0.5, 0.5, 0.25])


def test_ramped_segment_books_no_reinvestment_before_ramp_start():
    """todo3 trap 6: capital must not be charged against revenue that does not exist."""
    spec = SegmentSpec(
        name="expansion",
        base_revenue=0.0,
        base_margin=0.0,
        margin_target=0.30,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=50.0,
        ramp_start_year=7,
    )
    revenues = revenue_path(spec, n=10, g_stable=0.0456)
    result = reinvestment(revenues, spec)
    assert result[:6] == [0.0] * 6
    assert all(value > 0 for value in result[6:])


def test_no_tax_while_losses_shield_income():
    """15 of shield against 10/10/10: year 1 fully sheltered, year 2 half, year 3 none."""
    taxes = tax_path([10.0, 10.0, 10.0], marginal_rate=0.25, nol_balance=15.0)
    assert taxes == pytest.approx([0.0, 1.25, 2.5])


def test_losses_accumulate_into_the_shield():
    taxes = tax_path([-5.0, 10.0], marginal_rate=0.25, nol_balance=0.0)
    assert taxes == pytest.approx([0.0, 1.25])


def test_total_tax_equals_marginal_rate_on_income_net_of_shield():
    ebit = [20.0, 30.0, 50.0]
    taxes = tax_path(ebit, marginal_rate=0.25, nol_balance=40.0)
    assert sum(taxes) == pytest.approx(0.25 * (sum(ebit) - 40.0))


def test_wacc_holds_then_converges_linearly_to_stable():
    path = wacc_path(0.0837, 0.0825, n=10, converge_from=6)
    assert path[:5] == pytest.approx([0.0837] * 5)
    assert path[-1] == pytest.approx(0.0825)
    tail = path[4:]
    steps = [tail[i + 1] - tail[i] for i in range(len(tail) - 1)]
    assert steps == pytest.approx([steps[0]] * len(steps))


def test_wacc_rejects_converge_point_outside_the_horizon():
    with pytest.raises(ValueError, match="converge_from"):
        wacc_path(0.0837, 0.0825, n=10, converge_from=11)


def test_discount_factors_are_a_cumulative_product():
    """todo3 trap 1. The `(1+w)^t` form is wrong whenever WACC varies by year.

    Asserted as the recurrence rather than against hardcoded numbers, because
    the recurrence is the property that distinguishes the two formulas -- a
    hardcoded expectation would have to be computed by one of them.
    """
    waccs = wacc_path(0.0837, 0.0825, n=10, converge_from=6)
    factors = discount_factors(waccs)
    assert factors[0] == pytest.approx(1 / (1 + waccs[0]))
    for t in range(1, len(factors)):
        assert factors[t] == pytest.approx(factors[t - 1] / (1 + waccs[t]), abs=1e-12)


def test_cumulative_and_power_forms_diverge_when_wacc_varies():
    """Proves the previous test is load-bearing and not vacuous."""
    waccs = wacc_path(0.0837, 0.0825, n=10, converge_from=6)
    factors = discount_factors(waccs)
    naive = 1 / (1 + waccs[0]) ** len(waccs)
    assert abs(factors[-1] - naive) > 1e-6


def _case(**overrides) -> CaseSpec:
    defaults = dict(
        base_year=2026,
        target_year=2036,
        riskfree_rate=0.0456,
        wacc_initial=0.0837,
        wacc_stable=0.0825,
        wacc_converge_from=6,
        marginal_tax_rate=0.25,
        nol_balance=5.0,
        # _launch()'s marginal return is 0.50625 (1.5 x 0.45 x 0.75). 0.35 sits
        # inside the two-sided consistency guard's admitted band for it: below
        # the ceiling (must not exceed 0.50625) and above the floor
        # (0.50625 / (1 + 0.60) = 0.316406...).
        roic_stable=0.35,
        cash=24.7,
        debt=22.9,
        ipo_proceeds=75.0,
        shares_basic=12.535,
        shares_new=0.556,
    )
    defaults.update(overrides)
    return CaseSpec(**defaults)


def test_case_spec_rejects_negative_cash():
    with pytest.raises(ValueError, match="cash must not be negative"):
        _case(cash=-1.0)


def test_case_spec_rejects_negative_debt():
    with pytest.raises(ValueError, match="debt must not be negative"):
        _case(debt=-1.0)


def test_case_spec_rejects_negative_ipo_proceeds():
    with pytest.raises(ValueError, match="ipo_proceeds must not be negative"):
        _case(ipo_proceeds=-1.0)


def test_case_spec_rejects_negative_shares_new():
    """I3: shares_new = -5.0 previously produced a diluted value per share
    ABOVE basic, which is impossible for a real share count."""
    with pytest.raises(ValueError, match="shares_new must not be negative"):
        _case(shares_new=-5.0)


def test_case_spec_rejects_zero_roic_stable_with_a_value_error():
    """Minor A: the floor guard divides by roic_stable. Unreachable through the
    API (Field(gt=0)) but reachable by any direct library consumer, and
    run_case's contract is that invalid input raises ValueError, not
    ZeroDivisionError."""
    with pytest.raises(ValueError, match="roic_stable must be positive"):
        _case(roic_stable=0.0)


def test_terminal_value_discounts_growth_consistent_reinvestment():
    value = terminal_value(
        ebit_n=100.0,
        marginal_rate=0.25,
        g_stable=0.0456,
        roic_stable=0.12,
        wacc_stable=0.0825,
    )
    reinvestment_rate = 0.0456 / 0.12
    fcff = 100.0 * 1.0456 * 0.75 * (1 - reinvestment_rate)
    assert value == pytest.approx(fcff / (0.0825 - 0.0456))


def test_terminal_growth_above_riskfree_rate_raises():
    """todo3 trap 2 -- the cap is enforced, not warned about."""
    with pytest.raises(ValueError, match="riskfree"):
        _case(terminal_growth=0.06)


def test_terminal_growth_defaults_to_the_riskfree_rate():
    assert _case().effective_terminal_growth() == pytest.approx(0.0456)


def test_roic_at_or_below_wacc_with_positive_growth_raises():
    """todo3 trap 3 -- otherwise terminal growth destroys value."""
    with pytest.raises(ValueError, match="must exceed wacc_stable"):
        terminal_value(
            ebit_n=100.0,
            marginal_rate=0.25,
            g_stable=0.0456,
            roic_stable=0.08,
            wacc_stable=0.0825,
        )


def test_wacc_at_or_below_terminal_growth_raises():
    """todo3 trap 5 -- the denominator is not floored to fake a finite answer."""
    with pytest.raises(ValueError, match="spread"):
        terminal_value(
            ebit_n=100.0,
            marginal_rate=0.25,
            g_stable=0.09,
            roic_stable=0.12,
            wacc_stable=0.0825,
        )


def test_run_case_exposes_the_terminal_spread():
    result = run_case(_case(), [_launch()])
    assert result.terminal_spread == pytest.approx(0.0825 - 0.0456)


def test_equity_bridge_pins_the_identity_against_literal_arithmetic():
    """Pins EV + cash + proceeds - debt as literal arithmetic. Does not compare
    against `calculate_equity_value` itself -- that identity is argued in the
    design spec, not re-derived here."""
    case = _case()
    result = run_case(case, [_launch()])
    assert result.equity_value == pytest.approx(
        result.enterprise_value + 24.7 + 75.0 - 22.9
    )


def test_value_per_share_basic_is_ex_proceeds_diluted_is_post_money():
    """C1. Proceeds and the shares that raised them must move together.

    `value_per_share_diluted` is the post-money number: ipo_proceeds and
    shares_new both in. `value_per_share_basic` answers a different question --
    what existing holders' shares were worth before the raise -- so it must
    exclude ipo_proceeds too, not just the new shares. The old formula divided
    an equity value that INCLUDED ipo_proceeds by shares_basic alone, which
    overstated the per-share value by ipo_proceeds / shares_basic.

    Deliberately does not assert value_per_share_basic < value_per_share_diluted
    in general -- that ordering depends on whether proceeds per new share
    exceed pre-money value per share, which is a fact about the inputs, not an
    identity of the formula. Each side is checked against its own explicit
    formula instead.
    """
    case = _case()
    result = run_case(case, [_launch()])
    assert result.value_per_share_diluted == pytest.approx(
        result.equity_value / (case.shares_basic + case.shares_new)
    )
    assert result.value_per_share_basic == pytest.approx(
        (result.equity_value - case.ipo_proceeds) / case.shares_basic
    )


def test_fcff_equals_ebit_minus_tax_minus_reinvestment():
    """Pins the FCFF identity itself, not just a magic number -- a rewrite that
    treats `tax_path`'s return as a rate instead of an amount (or drops the
    reinvestment term) must fail this."""
    result = run_case(_case(), [_launch()])
    expected = [
        result.ebit[t] - result.tax[t] - result.reinvestment[t]
        for t in range(len(result.fcff))
    ]
    assert result.fcff == pytest.approx(expected)


def test_pv_terminal_equals_terminal_value_discounted_by_the_last_factor():
    """Guards against the `(1+w)^n` mis-implementation `discount_factors`
    exists to prevent, applied to the terminal value specifically."""
    result = run_case(_case(), [_launch()])
    assert result.pv_terminal == pytest.approx(
        result.terminal_value * result.discount_factor[-1]
    )


def test_enterprise_value_is_pv_explicit_plus_pv_terminal():
    result = run_case(_case(), [_launch()])
    assert result.pv_explicit == pytest.approx(
        sum(f * d for f, d in zip(result.fcff, result.discount_factor))
    )
    assert result.enterprise_value == pytest.approx(
        result.pv_explicit + result.pv_terminal
    )


def test_tax_matches_tax_path_on_the_consolidated_ebit():
    case = _case()
    result = run_case(case, [_launch()])
    assert result.tax == pytest.approx(
        tax_path(result.ebit, case.marginal_tax_rate, case.nol_balance)
    )


def test_wacc_and_discount_factor_match_their_own_helpers():
    case = _case()
    result = run_case(case, [_launch()])
    expected_wacc = wacc_path(
        case.wacc_initial, case.wacc_stable, case.horizon, case.wacc_converge_from
    )
    assert result.wacc == pytest.approx(expected_wacc)
    assert result.discount_factor == pytest.approx(discount_factors(expected_wacc))


def test_marginal_roic_is_sales_to_capital_times_margin_after_tax():
    spec = SegmentSpec(
        name="one",
        base_revenue=10.0,
        base_margin=0.0,
        margin_target=0.40,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=100.0,
    )
    # 1.5 x 0.40 x (1 - 0.25) = 0.45
    assert marginal_roic([spec], marginal_tax_rate=0.25) == pytest.approx(0.45)


def test_marginal_roic_is_capital_weighted_not_revenue_weighted():
    """Spec gate 9.

    ROIC is dNOPAT / dCapital, a ratio of aggregates, so combining segments must
    weight by the denominator -- incremental capital -- not by revenue. This
    fixture is deliberately lopsided: a 90/10 revenue split across segments whose
    per-dollar-of-revenue returns differ by 16x, so the three candidate answers
    land far apart and nothing subtle separates them:

        big:   NOPAT = 90 x 0.10 x 0.75 = 6.75    capital = 90 / 1.0 = 90.0
        small: NOPAT = 10 x 0.80 x 0.75 = 6.00    capital = 10 / 2.0 =  5.0

        capital-weighted (correct) = (6.75 + 6.00) / (90.0 + 5.0)
                                    = 12.75 / 95 = 0.1342105263...
        revenue-weighted (shipped bug) = (0.075*90 + 1.200*10) / 100 = 0.1875
        arithmetic mean                = (0.075 + 1.200) / 2         = 0.6375

    where 0.075 = 1.0 x 0.10 x 0.75 and 1.200 = 2.0 x 0.80 x 0.75 are the two
    segments' individual `sales_to_capital_late x margin x (1-tax)` returns.
    All three are far enough apart that this test discriminates all of them.
    """
    big = SegmentSpec(
        name="big", base_revenue=1.0, base_margin=0.0, margin_target=0.10,
        sales_to_capital_early=1.0, sales_to_capital_late=1.0, revenue_target=90.0,
    )
    small = SegmentSpec(
        name="small", base_revenue=1.0, base_margin=0.0, margin_target=0.80,
        sales_to_capital_early=1.0, sales_to_capital_late=2.0, revenue_target=10.0,
    )
    assert marginal_roic([big, small], marginal_tax_rate=0.25) == pytest.approx(
        12.75 / 95
    )


def test_marginal_roic_rejects_an_empty_segment_list():
    with pytest.raises(ValueError, match="at least one segment"):
        marginal_roic([], marginal_tax_rate=0.25)


def test_run_case_reports_the_terminal_reinvestment_rate():
    """Spec gate 5."""
    case = _case()
    result = run_case(case, [_launch()])
    assert result.terminal_reinvestment_rate == pytest.approx(
        case.effective_terminal_growth() / case.roic_stable
    )


def test_run_case_reports_the_reinvestment_rate_target_year():
    """Spec gate 5. The target-year rate at target-year growth -- not directly
    comparable to `terminal_reinvestment_rate`, which is struck at `g_stable`.
    """
    case = _case()
    result = run_case(case, [_launch()])
    nopat = result.ebit[-1] * (1 - case.marginal_tax_rate)
    assert result.reinvestment_rate_target_year == pytest.approx(
        result.reinvestment[-1] / nopat
    )


def test_run_case_reports_the_explicit_reinvestment_rate_at_stable_growth():
    """I3: the rate the explicit period's own economics (marginal ROIC) would
    require at the terminal growth rate -- struck at the SAME growth as
    `terminal_reinvestment_rate`, so the two are directly comparable and differ
    only through roic_stable vs marginal_roic."""
    case = _case()
    result = run_case(case, [_launch()])
    assert result.explicit_reinvestment_rate_at_stable_growth == pytest.approx(
        case.effective_terminal_growth() / result.marginal_roic_target_year
    )


def test_run_case_reports_marginal_roic():
    case = _case()
    segments = [_launch()]
    result = run_case(case, segments)
    assert result.marginal_roic_target_year == pytest.approx(
        marginal_roic(segments, case.marginal_tax_rate)
    )


def test_terminal_roic_above_the_marginal_return_raises():
    """Spec gate 2. _launch()'s marginal return is 1.5 x 0.45 x 0.75 = 0.50625."""
    with pytest.raises(ValueError, match="exceeds the target-year marginal"):
        run_case(_case(roic_stable=0.60), [_launch()])


def test_the_guard_message_names_both_values():
    """A guard that does not say what it compared cannot be acted on."""
    with pytest.raises(ValueError) as excinfo:
        run_case(_case(roic_stable=0.60), [_launch()])
    message = str(excinfo.value)
    assert "60.0000%" in message
    assert "50.6250%" in message


def test_terminal_roic_moderately_below_the_marginal_return_is_accepted():
    """Spec gate 3. Erosion below the target-year marginal return is legitimate:
    0.35 against a 0.50625 marginal return must run.
    """
    result = run_case(_case(roic_stable=0.35), [_launch()])
    assert result.terminal_reinvestment_rate > result.reinvestment_rate_target_year
    assert result.enterprise_value > 0


def test_terminal_roic_exactly_at_the_marginal_return_is_accepted():
    """The ceiling boundary is inclusive: equality is consistent, not
    contradictory.

    I4: computed as a product, not typed as a literal. A user who follows the
    module docstring's own formula -- sales_to_capital_late x margin_target x
    (1 - tau) -- and enters the result is not guaranteed a bit-identical float
    to what `marginal_roic` computes internally. For `_launch()` this product
    is 0.5062500000000001, not the literal 0.50625, and the ceiling must
    tolerate that representation noise rather than reject the exactly-consistent
    value.
    """
    launch = _launch()
    case = _case()
    roic_stable = launch.sales_to_capital_late * launch.margin_target * (
        1 - case.marginal_tax_rate
    )
    result = run_case(_case(roic_stable=roic_stable), [_launch()])
    assert result.marginal_roic_target_year == pytest.approx(0.50625)


def test_terminal_roic_far_below_the_marginal_return_is_reported_not_rejected():
    """There is no floor. 0.12 against a 0.50625 marginal return implies a
    321.9% capital-intensity increase, and the case still runs.

    This was a hard rejection until 2026-08-11. Damodaran's own spreadsheets
    (`guideline/sop/todo3-spreadsheet-values.md`) carry a terminal return of
    0.15 against target-year marginal returns of 1.017 and 0.901 -- +578% and
    +501% -- so a floor at any level near 60% rejects the source this engine
    reproduces. Fading returns to a mature level is the framework's terminal
    assumption, and `terminal_value`'s g / roic_stable reinvestment term is the
    mechanism that carries it.
    """
    result = run_case(_case(roic_stable=0.12), [_launch()])
    assert result.enterprise_value > 0
    assert result.terminal_capital_intensity_change == pytest.approx(
        0.50625 / 0.12 - 1
    )


def test_terminal_capital_intensity_change_is_zero_at_the_marginal_return():
    """The diagnostic's zero point: a terminal return equal to the target-year
    marginal one implies no change in capital per dollar of new revenue."""
    launch = _launch()
    case = _case()
    consistent = launch.sales_to_capital_late * launch.margin_target * (
        1 - case.marginal_tax_rate
    )
    result = run_case(_case(roic_stable=consistent), [launch])
    assert result.terminal_capital_intensity_change == pytest.approx(0.0, abs=1e-9)


def test_terminal_capital_intensity_change_grows_as_the_terminal_return_falls():
    """Monotone in the right direction: a lower terminal return means more
    implied capital per dollar of new revenue, never less."""
    changes = [
        run_case(_case(roic_stable=r), [_launch()]).terminal_capital_intensity_change
        for r in (0.45, 0.35, 0.25, 0.15)
    ]
    assert changes == sorted(changes)
    assert all(c > 0 for c in changes)


def test_terminal_reinvestment_rate_stays_below_one_for_any_admitted_case():
    """Spec gate 8.

    Not a production guard -- the spec argues one would be dead code, because
    `roic_stable > wacc_stable` and `wacc_stable > g_stable` together already
    force `g / roic_stable < 1`. This test checks that argument rather than
    leaving it asserted. Sweeps roic_stable across the admitted range: the
    two-sided consistency guard now bounds it to
    [marginal_roic / 1.6, marginal_roic] = [0.316406..., 0.50625].
    """
    # The relationship only binds for positive growth, so pin that first --
    # otherwise the sweep below could pass vacuously.
    assert _case().effective_terminal_growth() > 0

    for roic in (0.316406250, 0.35, 0.40, 0.45, 0.50625):
        result = run_case(_case(roic_stable=roic), [_launch()])
        assert 0 < result.terminal_reinvestment_rate < 1, roic


def _segment(**overrides) -> dict:
    """Valid SegmentSpec keyword arguments, for boundary tests to perturb."""
    base = dict(
        name="s",
        base_revenue=10.0,
        base_margin=0.0,
        margin_target=0.20,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=100.0,
    )
    base.update(overrides)
    return base


# --- marginal_tax_rate -------------------------------------------------------

def test_marginal_tax_rate_just_below_zero_raises():
    with pytest.raises(ValueError, match="marginal_tax_rate"):
        _case(marginal_tax_rate=-1e-9)


def test_marginal_tax_rate_just_above_one_raises():
    with pytest.raises(ValueError, match="marginal_tax_rate"):
        _case(marginal_tax_rate=1 + 1e-9)


def test_marginal_tax_rate_as_a_percentage_raises():
    """The realistic slip: 25 meaning 25%, which makes (1 - tau) equal -24."""
    with pytest.raises(ValueError, match="decimal fraction"):
        _case(marginal_tax_rate=25.0)


def test_marginal_tax_rate_of_zero_is_accepted():
    assert _case(marginal_tax_rate=0.0).marginal_tax_rate == 0.0


def test_marginal_tax_rate_of_one_is_accepted():
    assert _case(marginal_tax_rate=1.0).marginal_tax_rate == 1.0


# --- nol_balance -------------------------------------------------------------

def test_negative_nol_balance_raises():
    """A negative balance is added to the taxable base by tax_path, producing a
    41.7% effective rate against a 25% marginal rate with no error."""
    with pytest.raises(ValueError, match="nol_balance"):
        _case(nol_balance=-1e-9)


def test_zero_nol_balance_is_accepted():
    assert _case(nol_balance=0.0).nol_balance == 0.0


# --- ramp_start_year ---------------------------------------------------------

def test_ramp_start_year_of_zero_raises():
    with pytest.raises(ValueError, match="ramp_start_year"):
        SegmentSpec(**_segment(ramp_start_year=0))


def test_negative_ramp_start_year_raises():
    with pytest.raises(ValueError, match="ramp_start_year"):
        SegmentSpec(**_segment(ramp_start_year=-1))


def test_ramp_start_year_of_one_is_accepted():
    assert SegmentSpec(**_segment(ramp_start_year=1)).ramp_start_year == 1


# --- sales_to_capital --------------------------------------------------------

def test_zero_sales_to_capital_early_raises():
    with pytest.raises(ValueError, match="sales_to_capital_early"):
        SegmentSpec(**_segment(sales_to_capital_early=0.0))


def test_negative_sales_to_capital_early_raises():
    with pytest.raises(ValueError, match="sales_to_capital_early"):
        SegmentSpec(**_segment(sales_to_capital_early=-1.0))


def test_zero_sales_to_capital_late_raises():
    with pytest.raises(ValueError, match="sales_to_capital_late"):
        SegmentSpec(**_segment(sales_to_capital_late=0.0))


def test_negative_sales_to_capital_late_raises():
    with pytest.raises(ValueError, match="sales_to_capital_late"):
        SegmentSpec(**_segment(sales_to_capital_late=-1.0))


def test_a_small_positive_sales_to_capital_is_accepted():
    assert SegmentSpec(**_segment(sales_to_capital_early=1e-6)).sales_to_capital_early == 1e-6


def test_an_early_ratio_is_validated_even_when_no_year_reaches_it():
    """The gap this closes: a delayed segment never exercises its early ratio, so
    a lazy in-loop check would never fire for it."""
    with pytest.raises(ValueError, match="sales_to_capital_early"):
        SegmentSpec(**_segment(
            base_revenue=0.0, ramp_start_year=7, sales_to_capital_early=-5.0
        ))


def _anchored(**overrides) -> SegmentSpec:
    """A segment with an observed year-1 growth rate, for curve tests."""
    base = dict(
        name="anchored",
        base_revenue=4.1,
        base_margin=-0.10,
        margin_target=0.45,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=70.0,
        initial_growth=0.0764,
    )
    base.update(overrides)
    return SegmentSpec(**base)


def test_anchored_path_starts_at_the_observed_growth_rate():
    """Pinned by construction: sin vanishes at t=1, so `a` cannot move it."""
    spec = _anchored()
    path = revenue_path(spec, n=10, g_stable=0.0456)
    assert path[0] / spec.base_revenue - 1 == pytest.approx(0.0764, abs=1e-12)


def test_anchored_path_ends_at_stable_growth():
    """The reason a logistic was rejected: the explicit period must hand off to
    the perpetuity at the growth rate the perpetuity assumes."""
    path = revenue_path(_anchored(), n=10, g_stable=0.0456)
    assert path[-1] / path[-2] - 1 == pytest.approx(0.0456, abs=1e-12)


def test_anchored_path_still_lands_exactly_on_target():
    path = revenue_path(_anchored(), n=10, g_stable=0.0456)
    assert path[-1] == pytest.approx(70.0, abs=1e-9)


def test_anchored_path_is_slower_in_year_one_than_the_decaying_curve():
    """The whole point. Same endpoints, same base -- only the shape differs."""
    anchored = revenue_path(_anchored(), n=10, g_stable=0.0456)
    decaying = revenue_path(_anchored(initial_growth=None), n=10, g_stable=0.0456)
    assert anchored[0] < decaying[0]
    assert decaying[0] / 4.1 - 1 == pytest.approx(0.638, abs=0.002)


def test_anchored_path_humps_in_the_middle():
    """Slow start plus a fixed endpoint forces a fast middle. That is arithmetic,
    not a modelling choice, and it must not be hidden."""
    path = revenue_path(_anchored(), n=10, g_stable=0.0456)
    levels = [4.1, *path]
    growths = [levels[i + 1] / levels[i] - 1 for i in range(len(path))]
    assert max(growths) == pytest.approx(0.548, abs=0.005)
    assert growths.index(max(growths)) not in (0, len(growths) - 1)


def test_a_segment_already_growing_fast_enough_solves_to_a_dip():
    """Connectivity's shape: linear decay from its observed rate already compounds
    to target, so the hump amplitude solves to about zero rather than erroring."""
    spec = _anchored(name="connectivity", base_revenue=11.4,
                     revenue_target=120.0, initial_growth=0.50)
    path = revenue_path(spec, n=10, g_stable=0.0456)
    levels = [11.4, *path]
    growths = [levels[i + 1] / levels[i] - 1 for i in range(len(path))]
    assert path[-1] == pytest.approx(120.0, abs=1e-9)
    # Near-linear decay from 50% to 4.56%: consecutive steps are near-equal.
    # Measured deviation is 1.12e-3 (the solved amplitude is 0.00164, not exactly
    # zero), so the tolerance is 2e-3 -- tight enough that a real hump fails it.
    steps = [growths[i + 1] - growths[i] for i in range(len(growths) - 1)]
    assert steps == pytest.approx([steps[0]] * len(steps), abs=2e-3)


def test_a_negative_hump_amplitude_is_solvable_not_an_error():
    """A segment whose observed growth overshoots its endpoint needs a dip. The
    bracket must reach below zero, and the trough must stay above -100%."""
    spec = _anchored(base_revenue=10.0, revenue_target=12.0, initial_growth=0.60)
    path = revenue_path(spec, n=10, g_stable=0.0456)
    levels = [10.0, *path]
    growths = [levels[i + 1] / levels[i] - 1 for i in range(len(path))]
    assert path[-1] == pytest.approx(12.0, abs=1e-9)
    assert min(growths) < 0
    assert min(growths) > -1.0


def test_the_hump_bracket_keeps_every_growth_factor_positive():
    """This is the test that actually catches a hardcoded bracket.

    The solver's monotonicity argument holds only while every (1 + g_t) > 0, so
    the lower bound must be computed from min(initial_growth, g_stable). Asserting
    on a solved path does NOT catch a bad bracket: measured with a hardcoded
    -0.99 and initial_growth=-0.50, four growth factors go negative, yet an even
    count multiplies to a positive product, so the bracket check still passes and
    bisection proceeds on a violated precondition -- then converges to the right
    answer anyway, because the true root sits well inside the valid region.

    So test the bound directly rather than its consequences.
    """
    for g_init in (0.50, 0.0, -0.50, -0.90):
        low = _hump_amplitude_lower_bound(g_init, 0.0456)
        rates = _anchored_growth_rates(g_init, low, 10, 0.0456)
        assert all(1 + rate > 0 for rate in rates), g_init


def test_a_declining_segment_still_hits_its_target():
    """End-to-end sanity for a shrinking segment. Note this passes with a broken
    bracket too -- `test_the_hump_bracket_keeps_every_growth_factor_positive` is
    what guards the bracket."""
    spec = _anchored(base_revenue=50.0, revenue_target=30.0, initial_growth=-0.50)
    path = revenue_path(spec, n=10, g_stable=0.0456)
    assert path[-1] == pytest.approx(30.0, abs=1e-9)
    assert all(level > 0 for level in path)


def test_initial_growth_at_or_below_minus_one_raises():
    with pytest.raises(ValueError, match="initial_growth"):
        _anchored(initial_growth=-1.0)


def test_initial_growth_on_a_ramped_segment_raises():
    """A segment with no revenue today has no year-1 growth rate to pin."""
    with pytest.raises(ValueError, match="initial_growth"):
        SegmentSpec(
            name="expansion", base_revenue=0.0, base_margin=0.0,
            margin_target=0.30, sales_to_capital_early=1.0,
            sales_to_capital_late=1.5, revenue_target=50.0,
            ramp_start_year=7, initial_growth=0.10,
        )


def test_initial_growth_with_zero_base_revenue_raises():
    """Isolates the `base_revenue == 0` clause: `ramp_start_year` stays at 1,
    so only a zero base makes this incoherent. Without this test, a regression
    that dropped the `ramp_start_year > 1` clause from the validation would
    still pass every other test in this file."""
    with pytest.raises(ValueError, match="initial_growth.*incoherent"):
        SegmentSpec(
            name="expansion", base_revenue=0.0, base_margin=0.0,
            margin_target=0.30, sales_to_capital_early=1.0,
            sales_to_capital_late=1.5, revenue_target=50.0,
            ramp_start_year=1, initial_growth=0.10,
        )


def test_initial_growth_with_delayed_ramp_start_raises():
    """Isolates the `ramp_start_year > 1` clause: base_revenue is positive, so
    only the delayed start makes this incoherent. This fires at construction --
    `revenue_path`'s own ramp/base_revenue guard would also reject this
    combination, but only once a path is actually built."""
    with pytest.raises(ValueError, match="initial_growth.*incoherent"):
        SegmentSpec(
            name="expansion", base_revenue=10.0, base_margin=0.0,
            margin_target=0.30, sales_to_capital_early=1.0,
            sales_to_capital_late=1.5, revenue_target=50.0,
            ramp_start_year=7, initial_growth=0.10,
        )


def test_initial_growth_none_reproduces_the_existing_path_exactly():
    """Backward compatibility, gated. Every stored case and existing test keeps
    its behaviour. Asserted element-for-element against the decaying curve rather
    than against hardcoded numbers."""
    spec = _anchored(initial_growth=None)
    expected = []
    level = spec.base_revenue
    for rate in _decaying_growth_rates(
        _solve_first_year_growth(70.0 / 4.1, 10, 0.0456), 10, 0.0456
    ):
        level *= 1.0 + rate
        expected.append(level)
    assert revenue_path(spec, n=10, g_stable=0.0456) == pytest.approx(expected, abs=0.0)
