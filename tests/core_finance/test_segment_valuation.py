import pytest

from packages.core_finance.segment_valuation import SegmentSpec, revenue_path


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
