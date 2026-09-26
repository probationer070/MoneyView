"""
Expected return helpers for market-vs-stock comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Sequence


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
    )


# Spec 2.4. Stable codes, never matched by text. The service checks the first two (it owns
# the price and the bridge); this module checks the rest, in this order.
IMPLIED_RETURN_REFUSAL_CODES: frozenset[str] = frozenset({
    "no_price",
    "bridge_unresolved",
    "non_positive_fcff",
    "non_positive_market_ev",
    "below_model_range",
    "above_model_range",
})

# The terminal denominator floor the comparison DCF applies; inside the solver's bracket it
# is never active, because the bracket starts this far above g.
_TERMINAL_SPREAD_FLOOR = 0.005
_RATE_CEILING = 10.0
_BISECTION_STEPS = 64


@dataclass(frozen=True)
class ImpliedReturn:
    """An annual rate, or the code saying why there is none. Exactly one is set."""

    rate: float | None
    refusal: str | None


def enterprise_present_value(fcff_path: Sequence[float], terminal_growth: float, rate: float) -> float:
    """Five-year FCFF plus a Gordon terminal value, discounted at `rate` (decimal).

    The comparison DCF's own formula: `_dcf_snapshot` values the business with this at
    WACC, and the implied return solves it for the market's EV.
    """
    explicit = sum(cash_flow / (1 + rate) ** year for year, cash_flow in enumerate(fcff_path, start=1))
    terminal_value = fcff_path[-1] * (1 + terminal_growth) / max(rate - terminal_growth, _TERMINAL_SPREAD_FLOOR)
    return explicit + terminal_value / (1 + rate) ** len(fcff_path)


def calculate_market_implied_return(
    fcff_path: Sequence[float], terminal_growth: float, market_ev: float
) -> ImpliedReturn:
    """The annual discount rate at which `enterprise_present_value` equals `market_ev`.

    Cash flows and terminal growth are held fixed; only the rate varies. A non-positive
    cash flow is refused first: with every cash flow positive, PV is strictly decreasing
    in the rate, so the root is unique, and without that guarantee it may not be.
    """
    if not isfinite(terminal_growth) or terminal_growth + _TERMINAL_SPREAD_FLOOR >= _RATE_CEILING:
        # Not one of the six refusals: those describe the market data. This describes a
        # caller passing a g the comparison DCF can never produce (it is bounded to
        # [-0.10, WACC - 0.005]), which would empty or poison the bracket.
        raise ValueError(
            f"terminal_growth must be finite and below {_RATE_CEILING - _TERMINAL_SPREAD_FLOOR}; "
            f"got {terminal_growth!r}"
        )
    # isfinite first: `nan <= 0` is False, so a NaN would otherwise pass as positive.
    if not fcff_path or any(not isfinite(cash_flow) or cash_flow <= 0 for cash_flow in fcff_path):
        return ImpliedReturn(None, "non_positive_fcff")
    if not isfinite(market_ev) or market_ev <= 0:
        return ImpliedReturn(None, "non_positive_market_ev")
    low = terminal_growth + _TERMINAL_SPREAD_FLOOR
    high = _RATE_CEILING
    if market_ev > enterprise_present_value(fcff_path, terminal_growth, low):
        return ImpliedReturn(None, "below_model_range")
    if market_ev < enterprise_present_value(fcff_path, terminal_growth, high):
        return ImpliedReturn(None, "above_model_range")
    for _ in range(_BISECTION_STEPS):
        mid = (low + high) / 2
        if enterprise_present_value(fcff_path, terminal_growth, mid) > market_ev:
            low = mid
        else:
            high = mid
    return ImpliedReturn((low + high) / 2, None)
