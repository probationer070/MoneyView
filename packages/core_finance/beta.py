"""
Beta Engine — Hamada equation, bottom-up approach.

Per SOP-FIN: guidelines/finance-logic.md §3.
β_L = β_U × [1 + (1−t)(D/E)]
"""

from __future__ import annotations

import numpy as np
from typing import List


def unlever_beta(levered_beta: float, tax_rate: float, de_ratio: float) -> float:
    """
    Remove financial leverage effect.

    β_U = β_L / [1 + (1−t)(D/E)]
    """
    return levered_beta / (1 + (1 - tax_rate) * de_ratio)


def relever_beta(unlevered_beta: float, tax_rate: float, de_ratio: float) -> float:
    """
    Add financial leverage effect (Hamada equation).

    β_L = β_U × [1 + (1−t)(D/E)]
    """
    return unlevered_beta * (1 + (1 - tax_rate) * de_ratio)


def bottom_up_beta(
    peers:             List[dict],
    target_tax_rate:   float,
    target_de_ratio:   float,
) -> float:
    """
    Bottom-up beta estimation (Damodaran methodology).

    Steps:
      1. Unlever each peer's β using their own t and D/E
      2. Average the unlevered betas (law of large numbers for error reduction)
      3. Re-lever with the target firm's tax rate and D/E

    Args:
        peers: list of dicts with keys: levered_beta, tax_rate, de_ratio
        target_tax_rate: target firm's marginal tax rate
        target_de_ratio: target firm's D/E ratio

    Returns:
        Relevered beta for the target firm.
    """
    if not peers:
        raise ValueError("bottom_up_beta requires at least one peer.")

    unlevered = [
        unlever_beta(
            p["levered_beta"],
            p["tax_rate"],
            p["de_ratio"],
        )
        for p in peers
    ]
    avg_unlevered = float(np.mean(unlevered))
    return relever_beta(avg_unlevered, target_tax_rate, target_de_ratio)
