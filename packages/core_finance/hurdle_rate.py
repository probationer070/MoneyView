"""
Hurdle Rate & WACC — cost of capital decomposition.

Per SOP-FIN: guidelines/finance-logic.md §2.

k = r_f + β × ERP + CRP

WACC = (E/V)×r_e + (D/V)×r_d×(1−t)
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class HurdleRateComponents:
    risk_free_rate:  float   # r_f (10Y bond − default spread)
    equity_premium:  float   # ERP (implied forward-looking)
    country_premium: float   # CRP = default_spread × (σ_eq/σ_bond)
    beta:            float
    hurdle_rate:     float   # k = r_f + β×ERP + CRP


@dataclass
class WACCComponents:
    cost_of_equity:    float   # r_e = hurdle_rate
    cost_of_debt:      float   # r_d (pre-tax)
    tax_rate:          float
    equity_weight:     float   # E/V  (market value weights)
    debt_weight:       float   # D/V
    wacc:              float


def calculate_crp(
    default_spread:   float,
    equity_vol:       float,
    bond_vol:         float,
) -> float:
    """
    Country Risk Premium.

    CRP = default_spread × (σ_equity / σ_bond)

    Args:
        default_spread: sovereign default spread (e.g. 0.02 for 2%)
        equity_vol:     annualised equity market volatility
        bond_vol:       annualised bond market volatility
    """
    if bond_vol == 0:
        return default_spread
    return default_spread * (equity_vol / bond_vol)


def decompose_hurdle_rate(
    risk_free_rate:  float,
    beta:            float,
    erp:             float,
    crp:             float = 0.0,
) -> HurdleRateComponents:
    """
    Decompose hurdle rate into its components.

    k = r_f + β × ERP + CRP
    """
    hurdle = risk_free_rate + beta * erp + crp
    return HurdleRateComponents(
        risk_free_rate=risk_free_rate,
        equity_premium=erp,
        country_premium=crp,
        beta=beta,
        hurdle_rate=round(hurdle, 6),
    )


def calculate_wacc(
    cost_of_equity: float,
    cost_of_debt:   float,
    tax_rate:       float,
    equity_value:   float,
    debt_value:     float,
) -> WACCComponents:
    """
    Weighted Average Cost of Capital.

    WACC = (E/V)×r_e + (D/V)×r_d×(1−t)

    Uses market values per SOP-FIN guideline.
    """
    total = equity_value + debt_value
    if total == 0:
        raise ValueError("Total value (equity + debt) must be > 0.")

    equity_weight = equity_value / total
    debt_weight   = debt_value   / total
    wacc = equity_weight * cost_of_equity + debt_weight * cost_of_debt * (1 - tax_rate)

    return WACCComponents(
        cost_of_equity=cost_of_equity,
        cost_of_debt=cost_of_debt,
        tax_rate=tax_rate,
        equity_weight=round(equity_weight, 6),
        debt_weight=round(debt_weight, 6),
        wacc=round(wacc, 6),
    )


def wacc_sensitivity(
    cost_of_equity: float,
    cost_of_debt:   float,
    tax_rate:       float,
    equity_value:   float,
    de_ratios:      list[float] | None = None,
) -> list[dict]:
    """
    Compute WACC across a range of D/E ratios — produces the U-curve data.

    Args:
        de_ratios: list of D/E values to simulate (default: 0.0 to 2.0 in 0.1 steps)

    Returns:
        List of {de_ratio, debt_weight, equity_weight, wacc}
    """
    if de_ratios is None:
        de_ratios = [round(i * 0.1, 1) for i in range(0, 21)]  # 0.0 … 2.0

    results = []
    for de in de_ratios:
        debt_value = equity_value * de
        comp = calculate_wacc(
            cost_of_equity, cost_of_debt, tax_rate, equity_value, debt_value
        )
        results.append({
            "de_ratio":     de,
            "debt_weight":  comp.debt_weight,
            "equity_weight": comp.equity_weight,
            "wacc":         comp.wacc,
        })
    return results
