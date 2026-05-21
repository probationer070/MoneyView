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
    calculate_fcff,
    calculate_growth_rate,
    calculate_terminal_value,
    calculate_npv,
    calculate_equity_value,
    calculate_intrinsic_value_per_share,
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
