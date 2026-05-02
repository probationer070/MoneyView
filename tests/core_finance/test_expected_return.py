import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest

from packages.core_finance.expected_return import (
    ExpectedReturnInputs,
    calculate_capm_expected_return,
    calculate_dcf_implied_return,
    calculate_expected_return_spread,
    calculate_expected_return_result,
    calculate_market_expected_return,
)


def test_calculate_market_expected_return_adds_risk_free_and_erp():
    assert calculate_market_expected_return(0.042, 0.055) == pytest.approx(0.097)


def test_calculate_capm_expected_return_scales_erp_by_beta():
    assert calculate_capm_expected_return(0.042, 0.055, 1.2) == pytest.approx(0.108)


def test_calculate_dcf_implied_return_uses_intrinsic_value_vs_price():
    assert calculate_dcf_implied_return(100.0, 120.0) == pytest.approx(0.2)


def test_calculate_dcf_implied_return_handles_missing_price():
    assert calculate_dcf_implied_return(0.0, 120.0) == pytest.approx(0.0)


def test_calculate_expected_return_spread_subtracts_market_return():
    assert calculate_expected_return_spread(0.2, 0.097) == pytest.approx(0.103)


def test_calculate_expected_return_result_returns_stable_value_object():
    result = calculate_expected_return_result(
        ExpectedReturnInputs(
            current_price=100.0,
            intrinsic_value=120.0,
            risk_free_rate=0.042,
            equity_risk_premium=0.055,
            beta=1.2,
        )
    )

    assert result.dcf_implied_return == pytest.approx(0.2)
    assert result.capm_expected_return == pytest.approx(0.108)
    assert result.stock_expected_return == pytest.approx(result.dcf_implied_return)
    assert result.market_expected_return == pytest.approx(0.097)
    assert result.expected_return_spread == pytest.approx(0.103)
