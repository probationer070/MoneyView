import pytest

from packages.core_finance.segment_valuation import (
    CaseSpec,
    SegmentSpec,
    discount_factors,
    margin_path,
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


def test_margin_starts_at_base_and_ends_at_target():
    path = margin_path(_launch(), n=10)
    assert path[0] == pytest.approx(-0.10)
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


def test_reinvestment_rejects_non_positive_sales_to_capital():
    spec = SegmentSpec(
        name="s",
        base_revenue=10.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=0.0,
        sales_to_capital_late=1.0,
        revenue_target=20.0,
    )
    with pytest.raises(ValueError, match="sales_to_capital"):
        reinvestment([12.0], spec)


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
        roic_stable=0.12,
        cash=24.7,
        debt=22.9,
        ipo_proceeds=75.0,
        shares_basic=12.535,
        shares_new=0.556,
    )
    defaults.update(overrides)
    return CaseSpec(**defaults)


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
    with pytest.raises(ValueError, match="roic_stable"):
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


def test_equity_bridge_matches_the_shared_dcf_helper():
    """The reuse in the design is an identity, not a coincidence."""
    from packages.core_finance.dcf import calculate_equity_value

    case = _case()
    result = run_case(case, [_launch()])
    assert result.equity_value == pytest.approx(
        calculate_equity_value(
            enterprise_value=result.enterprise_value,
            net_debt=case.debt - case.cash,
            non_operating_assets=case.ipo_proceeds,
        )
    )


def test_value_per_share_uses_basic_plus_new_shares():
    case = _case()
    result = run_case(case, [_launch()])
    assert result.value_per_share_diluted == pytest.approx(
        result.equity_value / (case.shares_basic + case.shares_new)
    )
    assert result.value_per_share_basic == pytest.approx(
        result.equity_value / case.shares_basic
    )
