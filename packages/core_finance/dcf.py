"""
DCF Engine — pure Python / NumPy.

Per SOP-FIN: implements formulas from guidelines/finance-logic.md §4.
Per GEMINI SOP §2: NumPy-first; no Rust unless profiled bottleneck.
"""

from __future__ import annotations

import numpy as np


def calculate_fcff(
    ebit:         float,
    tax_rate:     float,
    depreciation: float,
    capex:        float,
    delta_nwc:    float,
) -> float:
    """
    Free Cash Flow to Firm.

    FCFF = EBIT(1−t) + D&A − CapEx − ΔNWC
    """
    return ebit * (1 - tax_rate) + depreciation - capex - delta_nwc


def calculate_growth_rate(reinvestment_rate: float, roic: float) -> float:
    """
    Sustainable growth rate.

    g = Reinvestment Rate × ROIC

    Value creation rule:
      ROIC > WACC → value creation
      ROIC < WACC → value destruction
    """
    return reinvestment_rate * roic


def calculate_terminal_value(
    terminal_cf:  float,
    wacc:         float,
    growth_rate:  float,
) -> float:
    """
    Gordon Growth Model terminal value.

    TV = CF_{n+1} / (WACC − g)

    Raises ValueError if WACC ≤ growth_rate (model undefined).
    """
    if wacc <= growth_rate:
        raise ValueError(
            f"WACC must be greater than growth rate. "
            f"Got WACC={wacc:.4f}, g={growth_rate:.4f}."
        )
    return terminal_cf / (wacc - growth_rate)


def calculate_npv(cash_flows: list[float], discount_rate: float) -> float:
    """
    Net Present Value of a cash flow series.

    NPV = Σ CF_t / (1 + r)^t  for t = 1 … n
    """
    if not cash_flows:
        return 0.0
    t = np.arange(1, len(cash_flows) + 1, dtype=float)
    cf = np.array(cash_flows, dtype=float)
    return float(np.sum(cf / (1 + discount_rate) ** t))


def multi_stage_dcf(
    explicit_fcff:   list[float],
    terminal_cf:     float,
    wacc:            float,
    terminal_growth: float,
) -> dict:
    """
    Multi-stage DCF valuation.

    Returns:
        {
          "pv_explicit":   float,  # PV of explicit forecast period
          "pv_terminal":   float,  # PV of terminal value
          "enterprise_value": float,
          "terminal_value":   float,
          "tv_share_pct":     float,  # % of EV from terminal value
        }
    """
    n = len(explicit_fcff)
    pv_explicit = calculate_npv(explicit_fcff, wacc)

    tv = calculate_terminal_value(terminal_cf, wacc, terminal_growth)
    pv_terminal = tv / (1 + wacc) ** n

    ev = pv_explicit + pv_terminal
    tv_share  = (pv_terminal / ev * 100) if ev != 0 else 0.0

    return {
        "pv_explicit":      round(pv_explicit, 2),
        "pv_terminal":      round(pv_terminal, 2),
        "enterprise_value": round(ev, 2),
        "terminal_value":   round(tv, 2),
        "tv_share_pct":     round(tv_share, 2),
    }
