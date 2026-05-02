"""
Expected return helpers for market-vs-stock comparison.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ExpectedReturnInputs:
    """Stable inputs for stock-vs-market expected return calculations."""

    current_price: float
    intrinsic_value: float
    risk_free_rate: float
    equity_risk_premium: float
    beta: float


@dataclass(frozen=True)
class ExpectedReturnResult:
    """Decimal return outputs from one expected-return calculation."""

    dcf_implied_return: float
    capm_expected_return: float
    stock_expected_return: float
    market_expected_return: float
    expected_return_spread: float


def calculate_market_expected_return(risk_free_rate: float, equity_risk_premium: float) -> float:
    """
    Market expected return using a simple additive implied-return model.

    Inputs and output are decimal returns, e.g. 0.042 for 4.2%.
    """
    return float(risk_free_rate + equity_risk_premium)


def calculate_capm_expected_return(
    risk_free_rate: float,
    equity_risk_premium: float,
    beta: float,
) -> float:
    """
    CAPM-style expected return using a beta-scaled equity risk premium.

    Inputs and output are decimal returns, e.g. 0.097 for 9.7%.
    """
    return float(risk_free_rate + (beta * equity_risk_premium))


def calculate_dcf_implied_return(current_price: float, intrinsic_value: float) -> float:
    """
    DCF-implied expected return from intrinsic value versus current price.

    Inputs and output are decimal returns, e.g. 0.15 for 15%.
    """
    if current_price <= 0:
        return 0.0
    return float((intrinsic_value / current_price) - 1.0)


def calculate_expected_return_spread(stock_expected_return: float, market_expected_return: float) -> float:
    """
    Active expected return spread versus the market.

    Inputs and output are decimal returns, e.g. 0.03 for 3%.
    """
    return float(stock_expected_return - market_expected_return)


def calculate_expected_return_result(inputs: ExpectedReturnInputs) -> ExpectedReturnResult:
    """Calculate the full stock-vs-market expected return payload."""
    dcf_implied_return = calculate_dcf_implied_return(inputs.current_price, inputs.intrinsic_value)
    capm_expected_return = calculate_capm_expected_return(
        inputs.risk_free_rate,
        inputs.equity_risk_premium,
        inputs.beta,
    )
    market_expected_return = calculate_market_expected_return(
        inputs.risk_free_rate,
        inputs.equity_risk_premium,
    )
    return ExpectedReturnResult(
        dcf_implied_return=dcf_implied_return,
        capm_expected_return=capm_expected_return,
        stock_expected_return=dcf_implied_return,
        market_expected_return=market_expected_return,
        expected_return_spread=calculate_expected_return_spread(
            dcf_implied_return,
            market_expected_return,
        ),
    )
