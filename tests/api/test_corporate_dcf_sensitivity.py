"""The WACC x terminal-growth sensitivity grid, as wired into the DCF report.

packages/core_finance covers the grid's own arithmetic. What is only testable here is
the seam: that the grid is centred on the valuation the report published, and that it
carries the same equity-bridge rule that decides whether a per-share value exists.
"""

import pytest

from apps.api.models.schema_parts.corporate import (
    BridgeInputMeta,
    BridgeSource,
    ValuationAssumptions,
)
from apps.api.models.schemas import CorporateMetrics
from apps.api.services.corporate_dcf import _build_dcf_outputs
from apps.api.services.equity_bridge import EquityBridge
from packages.core_finance.dcf import (
    SENSITIVITY_OFFSETS,
    WACC_NOT_ABOVE_TERMINAL_GROWTH,
)


def _metrics(ticker="TEST"):
    return CorporateMetrics(
        ticker=ticker, growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64,
        governance=74, esg_penalty=22,
    )


def _params(**overrides):
    base = dict(
        revenue_growth_rate=0.06, operating_margin=0.25, tax_rate=0.21,
        wacc=0.10, terminal_growth_rate=0.02, fcff=100.0, esg_penalty=22.0,
    )
    base.update(overrides)
    return ValuationAssumptions(**base)


def _bridge(net_debt=60.0, non_op=5.0, shares=15.0):
    return EquityBridge(
        net_debt=BridgeInputMeta(
            value=net_debt, source=BridgeSource.TOTAL_DEBT_LESS_CASH,
            quality="ok", as_of="2025-09-30",
        ),
        non_operating_assets=BridgeInputMeta(
            value=non_op, source=BridgeSource.INVESTMENTS_ADVANCES,
            quality="ok", as_of="2025-09-30",
        ),
        diluted_shares_outstanding=BridgeInputMeta(
            value=shares, source=BridgeSource.DILUTED_AVERAGE_SHARES,
            quality="ok", as_of="2025-09-30",
        ),
    )


def _unbridged():
    """A bridge the store could not fill: no net debt and no share count."""
    return EquityBridge(
        net_debt=BridgeInputMeta(),
        non_operating_assets=BridgeInputMeta(),
        diluted_shares_outstanding=BridgeInputMeta(),
    )


def _outputs(params=None, bridge=None):
    return _build_dcf_outputs(
        ticker="TEST",
        params=params or _params(),
        current_price_loader=lambda t: 100.0,
        metrics_loader=lambda t: _metrics(t),
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
        country_risk_premium=0.008,
        bridge_loader=lambda t: bridge if bridge is not None else _bridge(),
    )


def _base_cell(full):
    return next(cell for cell in full.sensitivity.cells if cell.is_base)


def test_the_grid_is_centred_on_the_reported_assumptions():
    _, assumptions, full = _outputs()
    base = _base_cell(full)

    assert base.wacc == pytest.approx(assumptions.wacc_used)
    assert base.terminal_growth == pytest.approx(assumptions.terminal_growth_used)


def test_the_base_cell_reproduces_the_reported_enterprise_value():
    # The table exists to put a range around the headline number. A centre that valued
    # even slightly differently would be contradicting the figure it brackets -- and the
    # two paths really are different code: the report divides by
    # max(wacc - g, 0.005) while the grid goes through calculate_terminal_value.
    #
    # The tolerance is the grid's own rounding step, not slack: multi_stage_dcf publishes
    # 2dp and the report 4dp, so agreement can only be asserted to the coarser of the two.
    _, _, full = _outputs()

    assert _base_cell(full).enterprise_value == pytest.approx(full.enterprise_value, abs=0.01)


def test_the_base_cell_reproduces_the_reported_per_share_value():
    # Same rounding step as above, carried through the bridge: the cell divides an
    # enterprise value already rounded to 2dp by the share count, so the 0.01 becomes
    # 0.01 / diluted shares.
    _, _, full = _outputs()

    assert _base_cell(full).intrinsic_value_per_share == pytest.approx(
        full.intrinsic_value_per_share, abs=0.01 / 15.0
    )


def test_the_reported_terminal_share_is_the_measured_share_of_enterprise_value():
    summary, _, full = _outputs()

    assert summary.terminal_value_share_pct == pytest.approx(
        full.present_value_of_terminal / full.enterprise_value * 100, rel=1e-4
    )
    assert 0.0 < summary.terminal_value_share_pct < 100.0


def test_the_reported_terminal_share_agrees_with_the_base_cell():
    # Two computations of one quantity, on two paths. They are published side by side.
    summary, _, full = _outputs()

    assert _base_cell(full).terminal_value_share_pct == pytest.approx(
        summary.terminal_value_share_pct, rel=1e-3
    )


def test_a_lower_wacc_row_concentrates_more_value_in_the_terminal_period():
    _, _, full = _outputs()
    grid = full.sensitivity
    lowest_wacc = min(grid.wacc_values)
    highest_wacc = max(grid.wacc_values)
    base_growth = _base_cell(full).terminal_growth

    def share_at(wacc):
        return next(
            cell.terminal_value_share_pct
            for cell in grid.cells
            if cell.wacc == wacc and cell.terminal_growth == base_growth
        )

    assert share_at(lowest_wacc) > share_at(highest_wacc)


def test_every_cell_is_suppressed_per_share_when_the_bridge_does_not_resolve():
    # The same rule the headline valuation follows: without a bridge there is no
    # per-share value, so the grid must not offer 25 of them. Enterprise value and the
    # terminal share stay, because neither depends on the bridge -- concentration risk
    # is readable for a ticker whose per-share value is not.
    summary, _, full = _outputs(bridge=_unbridged())

    assert summary.bridge_quality == "missing"
    assert full.intrinsic_value_per_share is None
    assert all(cell.intrinsic_value_per_share is None for cell in full.sensitivity.cells)
    assert all(
        cell.enterprise_value is not None and cell.terminal_value_share_pct is not None
        for cell in full.sensitivity.cells
    )


def test_every_defined_cell_carries_a_per_share_value_when_the_bridge_resolves():
    # The mirror of the test above. Without it, a grid that suppressed everything
    # unconditionally would pass the suppression test and be useless.
    summary, _, full = _outputs()

    assert summary.bridge_quality == "ok"
    assert all(
        cell.intrinsic_value_per_share is not None
        for cell in full.sensitivity.cells
        if cell.undefined_reason is None
    )


def test_a_narrow_spread_leaves_undefined_cells_with_no_values_at_all():
    # terminal_growth is clamped to at most wacc - 0.005, so this is the tightest the
    # grid can be centred, and the axes then reach 2pp past it. Reachable from ordinary
    # request parameters, which is why the undefined region needs handling at all.
    _, _, full = _outputs(_params(wacc=0.03, terminal_growth_rate=0.025))
    undefined = [cell for cell in full.sensitivity.cells if cell.undefined_reason]

    assert undefined, "a 0.5pp base spread must reach the undefined region"
    for cell in undefined:
        assert cell.undefined_reason == WACC_NOT_ABOVE_TERMINAL_GROWTH
        assert cell.enterprise_value is None
        assert cell.terminal_value_share_pct is None
        # A resolved bridge must not manufacture a per-share value out of an absent
        # enterprise value.
        assert cell.intrinsic_value_per_share is None


def test_an_undefined_cell_is_not_the_service_clamp_in_disguise():
    # corporate_dcf.py floors the terminal denominator at 0.005. If the grid inherited
    # that floor, the corner cells would carry a large finite enterprise value instead
    # of none -- a number roughly 200x the terminal cash flow, at points where the
    # Gordon model has no value. This pins that the grid does not take that path.
    _, _, full = _outputs(_params(wacc=0.03, terminal_growth_rate=0.025))
    corner = next(
        cell
        for cell in full.sensitivity.cells
        if cell.wacc == min(full.sensitivity.wacc_values)
        and cell.terminal_growth == max(full.sensitivity.terminal_growth_values)
    )

    assert corner.undefined_reason == WACC_NOT_ABOVE_TERMINAL_GROWTH
    assert corner.enterprise_value is None


def test_the_grid_is_square_and_complete():
    _, _, full = _outputs()
    width = len(SENSITIVITY_OFFSETS)

    assert len(full.sensitivity.wacc_values) == width
    assert len(full.sensitivity.terminal_growth_values) == width
    assert len(full.sensitivity.cells) == width * width
    assert sum(1 for cell in full.sensitivity.cells if cell.is_base) == 1
