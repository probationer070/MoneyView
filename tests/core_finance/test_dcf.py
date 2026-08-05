"""
TDD tests for packages/core-finance/dcf.py

Per SOP-SEC-01: Tests written BEFORE implementation.
Cross-checked against Damodaran textbook examples.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from packages.core_finance.dcf import (
    SENSITIVITY_OFFSETS,
    WACC_NOT_ABOVE_TERMINAL_GROWTH,
    WACC_NOT_POSITIVE,
    calculate_fcff,
    calculate_growth_rate,
    calculate_terminal_value,
    calculate_npv,
    calculate_equity_value,
    calculate_net_debt,
    calculate_intrinsic_value_per_share,
    multi_stage_dcf,
    sensitivity_axis,
    sensitivity_cell,
    sensitivity_grid,
)


class TestCalculateFcff:
    """FCFF = EBIT(1-t) + D&A - CapEx - ΔNWC"""

    def test_basic_positive(self):
        # EBIT=1000, t=0.25, D&A=200, CapEx=300, ΔNWC=50
        # FCFF = 1000×0.75 + 200 - 300 - 50 = 750 + 200 - 300 - 50 = 600
        result = calculate_fcff(ebit=1000, tax_rate=0.25,
                                depreciation=200, capex=300, delta_nwc=50)
        assert result == pytest.approx(600.0)

    def test_zero_depreciation(self):
        result = calculate_fcff(ebit=1000, tax_rate=0.30,
                                depreciation=0, capex=0, delta_nwc=0)
        assert result == pytest.approx(700.0)

    def test_negative_nwc_increases_fcff(self):
        # Working capital release (negative ΔNWC) boosts FCFF
        result = calculate_fcff(ebit=500, tax_rate=0.20,
                                depreciation=100, capex=50, delta_nwc=-30)
        # = 500×0.8 + 100 - 50 - (-30) = 400 + 100 - 50 + 30 = 480
        assert result == pytest.approx(480.0)

    def test_full_tax_rate(self):
        result = calculate_fcff(ebit=1000, tax_rate=1.0,
                                depreciation=0, capex=0, delta_nwc=0)
        assert result == pytest.approx(0.0)


class TestCalculateGrowthRate:
    """g = Reinvestment Rate × ROIC"""

    def test_standard(self):
        # Reinvestment rate 40%, ROIC 15% → g = 6%
        result = calculate_growth_rate(reinvestment_rate=0.40, roic=0.15)
        assert result == pytest.approx(0.06)

    def test_zero_roic(self):
        result = calculate_growth_rate(reinvestment_rate=0.50, roic=0.0)
        assert result == pytest.approx(0.0)

    def test_value_destruction(self):
        # ROIC < WACC scenario: growth can still be positive but destroys value
        result = calculate_growth_rate(reinvestment_rate=0.60, roic=0.05)
        assert result == pytest.approx(0.03)


class TestCalculateTerminalValue:
    """TV = CF_{n+1} / (WACC - g)"""

    def test_standard_gordon_growth(self):
        # CF = 100, WACC = 0.10, g = 0.03 → TV = 100 / 0.07 ≈ 1428.57
        tv = calculate_terminal_value(terminal_cf=100, wacc=0.10, growth_rate=0.03)
        assert tv == pytest.approx(1428.57, rel=1e-3)

    def test_zero_growth(self):
        tv = calculate_terminal_value(terminal_cf=200, wacc=0.08, growth_rate=0.0)
        assert tv == pytest.approx(2500.0)

    def test_raises_when_wacc_equals_growth(self):
        with pytest.raises(ValueError, match="WACC must be greater than growth rate"):
            calculate_terminal_value(terminal_cf=100, wacc=0.05, growth_rate=0.05)

    def test_raises_when_growth_exceeds_wacc(self):
        with pytest.raises(ValueError):
            calculate_terminal_value(terminal_cf=100, wacc=0.05, growth_rate=0.08)


class TestCalculateNpv:
    """NPV = Σ CF_t / (1+r)^t"""

    def test_simple_two_periods(self):
        # CF = [110, 121], r = 0.10
        # NPV = 110/1.1 + 121/1.21 = 100 + 100 = 200
        npv = calculate_npv(cash_flows=[110.0, 121.0], discount_rate=0.10)
        assert npv == pytest.approx(200.0, rel=1e-4)

    def test_zero_discount_rate(self):
        npv = calculate_npv(cash_flows=[100.0, 100.0, 100.0], discount_rate=0.0)
        assert npv == pytest.approx(300.0)

    def test_empty_cash_flows(self):
        assert calculate_npv(cash_flows=[], discount_rate=0.1) == 0.0


class TestEquityBridge:
    def test_calculate_equity_value_subtracts_net_debt_and_adds_non_operating_assets(self):
        equity_value = calculate_equity_value(
            enterprise_value=1000.0,
            net_debt=250.0,
            non_operating_assets=40.0,
        )

        assert equity_value == pytest.approx(790.0)

    def test_calculate_intrinsic_value_per_share_divides_by_diluted_shares(self):
        value = calculate_intrinsic_value_per_share(
            equity_value=790.0,
            diluted_shares_outstanding=10.0,
        )

        assert value == pytest.approx(79.0)

    def test_calculate_intrinsic_value_per_share_rejects_invalid_share_count(self):
        with pytest.raises(ValueError, match="Diluted shares outstanding must be greater than zero"):
            calculate_intrinsic_value_per_share(equity_value=790.0, diluted_shares_outstanding=0.0)

    def test_calculate_net_debt_subtracts_cash_from_total_debt(self):
        assert calculate_net_debt(1000.0, 250.0) == 750.0

    def test_calculate_net_debt_is_negative_when_cash_exceeds_debt(self):
        # A cash-rich company has negative net debt, which correctly RAISES equity value
        # above enterprise value. Clamping this at zero would undervalue every such issuer.
        assert calculate_net_debt(100.0, 400.0) == -300.0

    def test_calculate_net_debt_is_none_when_total_debt_is_missing(self):
        assert calculate_net_debt(None, 250.0) is None

    def test_calculate_net_debt_is_none_when_cash_is_missing(self):
        # A missing cash balance is not a zero cash balance. Returning total debt here
        # would hand a real number to the bridge and overstate net debt by all the cash.
        assert calculate_net_debt(1000.0, None) is None

    def test_calculate_net_debt_accepts_a_genuine_zero_cash_balance(self):
        # Zero is data; None is absence. They must not collapse into the same branch.
        assert calculate_net_debt(1000.0, 0.0) == 1000.0


# Five years of a flat 100 forecast. Flat so the arithmetic below stays checkable by hand:
# every cell's explicit leg is the same five cash flows, and only the discounting moves.
FLAT_FCFF = [100.0, 100.0, 100.0, 100.0, 100.0]


class TestSensitivityAxis:
    def test_axis_is_the_base_plus_each_offset(self):
        assert sensitivity_axis(0.09) == pytest.approx([0.08, 0.085, 0.09, 0.095, 0.10])

    def test_axis_centre_is_exactly_the_base(self):
        # The UI marks the base cell by index, but a centre that drifted off the reported
        # assumption would mean the grid is centred on a valuation nobody ran.
        centre = SENSITIVITY_OFFSETS.index(0.0)
        assert sensitivity_axis(0.0925)[centre] == 0.0925

    def test_axis_does_not_carry_binary_float_noise(self):
        # 0.09 + 0.005 is 0.09500000000000001 in binary floating point, and these values
        # are rendered as column headers.
        assert 0.095 in sensitivity_axis(0.09)


class TestSensitivityCell:
    def test_valued_cell_matches_multi_stage_dcf_at_the_same_point(self):
        # The cell is not allowed to be a second implementation of the valuation. If these
        # ever diverge, the grid is describing a model the report does not use.
        cell = sensitivity_cell(FLAT_FCFF, wacc=0.10, terminal_growth=0.03)
        direct = multi_stage_dcf(
            explicit_fcff=FLAT_FCFF,
            terminal_cf=100.0 * 1.03,
            wacc=0.10,
            terminal_growth=0.03,
        )

        assert cell["enterprise_value"] == pytest.approx(direct["enterprise_value"])
        assert cell["tv_share_pct"] == pytest.approx(direct["tv_share_pct"])
        assert cell["undefined_reason"] is None

    def test_terminal_cash_flow_grows_with_the_cell_terminal_growth(self):
        # CF_{n+1} = CF_n x (1+g). A cell that reused the base terminal cash flow would
        # understate every above-base column, so pin the one-year step explicitly.
        cell = sensitivity_cell(FLAT_FCFF, wacc=0.10, terminal_growth=0.03)
        # TV = 103 / 0.07 = 1471.43
        assert cell["terminal_value"] == pytest.approx(1471.43, rel=1e-4)

    def test_cell_is_undefined_when_growth_equals_wacc(self):
        cell = sensitivity_cell(FLAT_FCFF, wacc=0.05, terminal_growth=0.05)

        assert cell["undefined_reason"] == WACC_NOT_ABOVE_TERMINAL_GROWTH
        assert cell["enterprise_value"] is None
        assert cell["terminal_value"] is None
        assert cell["tv_share_pct"] is None

    def test_cell_is_undefined_when_growth_exceeds_wacc(self):
        cell = sensitivity_cell(FLAT_FCFF, wacc=0.04, terminal_growth=0.06)

        assert cell["undefined_reason"] == WACC_NOT_ABOVE_TERMINAL_GROWTH
        assert cell["enterprise_value"] is None

    def test_undefined_cell_is_not_a_clamped_finite_value(self):
        # The service layer floors this denominator at 0.005 (corporate_dcf.py:151), which
        # would report roughly 200x the terminal cash flow at a point where the Gordon
        # model has no value at all. Sweeping a grid is exactly how that region is reached,
        # so the guard has to be an absence, not a large number.
        cell = sensitivity_cell(FLAT_FCFF, wacc=0.05, terminal_growth=0.05)
        clamped = 100.0 * 1.05 / 0.005

        assert cell["terminal_value"] != pytest.approx(clamped)
        assert cell["terminal_value"] is None

    def test_cell_is_undefined_when_wacc_is_not_positive(self):
        # Checked before the Gordon condition: -0.009 is still greater than a -0.1 terminal
        # growth, so the ordering is what stops a negative discount rate being valued.
        cell = sensitivity_cell(FLAT_FCFF, wacc=-0.009, terminal_growth=-0.1)

        assert cell["undefined_reason"] == WACC_NOT_POSITIVE
        assert cell["enterprise_value"] is None

    def test_undefined_cell_reports_no_partial_numbers(self):
        # The explicit leg is computable at a negative discount rate. It is still not
        # reported: half a valuation under a heading that reads like a whole one is the
        # failure mode this grid exists to expose.
        cell = sensitivity_cell(FLAT_FCFF, wacc=-0.009, terminal_growth=-0.1)

        assert cell["pv_explicit"] is None
        assert cell["pv_terminal"] is None

    def test_narrower_spread_concentrates_more_value_in_the_terminal_period(self):
        # The whole point of the grid. Same cash flows, spread 7pp vs 2pp.
        wide = sensitivity_cell(FLAT_FCFF, wacc=0.10, terminal_growth=0.03)
        narrow = sensitivity_cell(FLAT_FCFF, wacc=0.05, terminal_growth=0.03)

        assert narrow["tv_share_pct"] > wide["tv_share_pct"]


class TestSensitivityGrid:
    def test_grid_is_one_cell_per_axis_pair(self):
        grid = sensitivity_grid(FLAT_FCFF, base_wacc=0.09, base_terminal_growth=0.025)

        assert len(grid["wacc_values"]) == len(SENSITIVITY_OFFSETS)
        assert len(grid["terminal_growth_values"]) == len(SENSITIVITY_OFFSETS)
        assert len(grid["cells"]) == len(SENSITIVITY_OFFSETS) ** 2

    def test_cells_are_row_major_with_wacc_on_the_outer_axis(self):
        # The consumer rebuilds a table from a flat list, so the ordering is contract.
        grid = sensitivity_grid(FLAT_FCFF, base_wacc=0.09, base_terminal_growth=0.025)
        width = len(SENSITIVITY_OFFSETS)

        for row, wacc in enumerate(grid["wacc_values"]):
            for column, terminal_growth in enumerate(grid["terminal_growth_values"]):
                cell = grid["cells"][row * width + column]
                assert cell["wacc"] == wacc
                assert cell["terminal_growth"] == terminal_growth

    def test_exactly_one_cell_is_the_base(self):
        grid = sensitivity_grid(FLAT_FCFF, base_wacc=0.09, base_terminal_growth=0.025)
        base_cells = [cell for cell in grid["cells"] if cell["is_base"]]

        assert len(base_cells) == 1
        assert base_cells[0]["wacc"] == 0.09
        assert base_cells[0]["terminal_growth"] == 0.025

    def test_base_cell_reproduces_the_valuation_at_the_base_assumptions(self):
        # If the centre of the grid disagreed with the headline valuation, the table would
        # be contradicting the number it is meant to put a range around.
        grid = sensitivity_grid(FLAT_FCFF, base_wacc=0.09, base_terminal_growth=0.025)
        base_cell = next(cell for cell in grid["cells"] if cell["is_base"])
        direct = multi_stage_dcf(
            explicit_fcff=FLAT_FCFF,
            terminal_cf=100.0 * 1.025,
            wacc=0.09,
            terminal_growth=0.025,
        )

        assert base_cell["enterprise_value"] == pytest.approx(direct["enterprise_value"])

    def test_ordinary_assumptions_leave_every_cell_defined(self):
        grid = sensitivity_grid(FLAT_FCFF, base_wacc=0.09, base_terminal_growth=0.025)

        assert all(cell["undefined_reason"] is None for cell in grid["cells"])

    def test_a_narrow_base_spread_pushes_corner_cells_out_of_the_model(self):
        # The service clamps terminal growth to at most wacc - 0.005, so a 0.5pp spread is
        # the tightest the grid can be centred on -- and the axes then reach 2pp past it in
        # both directions. This is reachable from ordinary inputs, not a contrived case.
        grid = sensitivity_grid(FLAT_FCFF, base_wacc=0.03, base_terminal_growth=0.025)
        undefined = [cell for cell in grid["cells"] if cell["undefined_reason"] is not None]

        assert undefined, "a 0.5pp base spread must reach the undefined region"
        assert all(
            cell["undefined_reason"] == WACC_NOT_ABOVE_TERMINAL_GROWTH for cell in undefined
        )
        # The base cell itself stays valued: the grid is centred on a valuation that ran.
        assert next(cell for cell in grid["cells"] if cell["is_base"])["enterprise_value"] is not None

    def test_terminal_share_rises_along_the_narrowing_diagonal(self):
        # Reading down-left (lower WACC, higher growth) must show concentration increasing
        # monotonically, which is the risk the table is built to surface.
        grid = sensitivity_grid(FLAT_FCFF, base_wacc=0.09, base_terminal_growth=0.025)
        by_point = {(cell["wacc"], cell["terminal_growth"]): cell for cell in grid["cells"]}
        widest = by_point[(0.10, 0.015)]
        base = by_point[(0.09, 0.025)]
        narrowest = by_point[(0.08, 0.035)]

        assert widest["tv_share_pct"] < base["tv_share_pct"] < narrowest["tv_share_pct"]
