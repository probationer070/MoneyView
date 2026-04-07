"""
Phase 5 portfolio maths primitives.

This module intentionally returns domain-level numeric outputs and does not
include any chart-specific shaping logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

import numpy as np


@dataclass(frozen=True)
class BrinsonEffects:
    allocation: np.ndarray
    selection: np.ndarray
    interaction: np.ndarray


def brinson_fachler_arithmetic(
    portfolio_weights: np.ndarray,
    benchmark_weights: np.ndarray,
    portfolio_returns: np.ndarray,
    benchmark_returns: np.ndarray,
    benchmark_total_return: float,
) -> BrinsonEffects:
    """
    Arithmetic Brinson-Fachler attribution per segment i:

    Allocation_i = (w_p_i - w_b_i) * (r_b_i - r_b_total)
    Selection_i  = w_b_i * (r_p_i - r_b_i)
    Interaction_i= (w_p_i - w_b_i) * (r_p_i - r_b_i)
    """
    weight_diff = portfolio_weights - benchmark_weights
    return_diff = portfolio_returns - benchmark_returns

    allocation = weight_diff * (benchmark_returns - benchmark_total_return)
    selection = benchmark_weights * return_diff
    interaction = weight_diff * return_diff
    return BrinsonEffects(
        allocation=allocation,
        selection=selection,
        interaction=interaction,
    )


def aggregate_weighted_return(weights: np.ndarray, returns: np.ndarray) -> float:
    if len(weights) == 0 or len(returns) == 0:
        return 0.0
    return float(np.dot(weights, returns))


def aggregate_sector_returns(
    sectors: list[str],
    weights: np.ndarray,
    returns: np.ndarray,
) -> Dict[str, dict]:
    """
    Aggregate holdings into sector-level weights and weighted-average returns.
    """
    sector_weight_sum: Dict[str, float] = {}
    sector_weighted_return_sum: Dict[str, float] = {}

    for sector, weight, ret in zip(sectors, weights, returns):
        sector_weight_sum[sector] = sector_weight_sum.get(sector, 0.0) + float(weight)
        sector_weighted_return_sum[sector] = (
            sector_weighted_return_sum.get(sector, 0.0) + float(weight * ret)
        )

    aggregated: Dict[str, dict] = {}
    for sector, weight_sum in sector_weight_sum.items():
        weighted_return_sum = sector_weighted_return_sum.get(sector, 0.0)
        sector_return = weighted_return_sum / weight_sum if weight_sum != 0 else 0.0
        aggregated[sector] = {
            "weight": float(weight_sum),
            "return": float(sector_return),
        }
    return aggregated


def calculate_portfolio_beta(
    portfolio_returns: np.ndarray,
    benchmark_returns: np.ndarray,
) -> float:
    if len(portfolio_returns) < 2 or len(benchmark_returns) < 2:
        return 0.0

    cov_matrix = np.cov(portfolio_returns, benchmark_returns, ddof=1)
    benchmark_var = cov_matrix[1, 1]
    if benchmark_var == 0:
        return 0.0
    return float(cov_matrix[0, 1] / benchmark_var)


def historical_var(
    returns: np.ndarray,
    confidence_level: float = 0.95,
    horizon_days: int = 1,
) -> float:
    if len(returns) == 0:
        return 0.0

    alpha = 1.0 - confidence_level
    quantile = float(np.quantile(returns, alpha))
    loss = max(0.0, -quantile)
    if horizon_days > 1:
        loss *= np.sqrt(horizon_days)
    return float(loss)


def historical_expected_shortfall(
    returns: np.ndarray,
    confidence_level: float = 0.95,
    horizon_days: int = 1,
) -> float:
    if len(returns) == 0:
        return 0.0

    alpha = 1.0 - confidence_level
    cutoff = float(np.quantile(returns, alpha))
    tail = returns[returns <= cutoff]
    if len(tail) == 0:
        loss = max(0.0, -cutoff)
    else:
        loss = max(0.0, -float(np.mean(tail)))

    if horizon_days > 1:
        loss *= np.sqrt(horizon_days)
    return float(loss)
