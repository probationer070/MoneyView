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


def calculate_equity_value(
    enterprise_value: float,
    net_debt: float = 0.0,
    non_operating_assets: float = 0.0,
) -> float:
    """
    Bridge enterprise value to equity value.

    Equity Value = Enterprise Value - Net Debt + Non-operating Assets
    """
    return enterprise_value - net_debt + non_operating_assets


def calculate_net_debt(
    total_debt: float | None,
    cash_and_equivalents: float | None,
) -> float | None:
    """
    Net Debt = Total Debt - Cash and Equivalents

    None if either input is missing. A missing cash balance is not a zero cash
    balance, and returning total debt unadjusted would overstate net debt by the
    entire cash position -- a real number handed to a bridge that should report a
    missing input.

    A negative result is valid and must be preserved: a company holding more cash
    than debt raises equity value above enterprise value.
    """
    if total_debt is None or cash_and_equivalents is None:
        return None
    return float(total_debt) - float(cash_and_equivalents)


def calculate_intrinsic_value_per_share(
    equity_value: float,
    diluted_shares_outstanding: float,
) -> float:
    """
    Intrinsic equity value per diluted share.

    Raises ValueError when share count is unavailable or invalid.
    """
    if diluted_shares_outstanding <= 0:
        raise ValueError(
            f"Diluted shares outstanding must be greater than zero. "
            f"Got {diluted_shares_outstanding:.4f}."
        )
    return equity_value / diluted_shares_outstanding


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


# Why a cell of the sensitivity grid carries no valuation. Both are states of the model,
# not errors: the Gordon growth formula has no value at these points, and a grid that
# sweeps around a base assumption is built to reach them.
WACC_NOT_POSITIVE = "wacc_not_positive"
WACC_NOT_ABOVE_TERMINAL_GROWTH = "wacc_not_above_terminal_growth"

# Steps either side of the base assumption, on both axes. Symmetric and shared so the
# corners of the grid are a uniform 2pp move in the WACC-minus-growth spread, which is
# what the table is read for.
SENSITIVITY_OFFSETS = (-0.01, -0.005, 0.0, 0.005, 0.01)


def sensitivity_axis(base: float) -> list[float]:
    """One axis of the sensitivity grid, centred on `base`.

    Rounded because these values are rendered as headers and matched against cell
    coordinates: 0.09 + 0.005 is 0.09500000000000001 in binary floating point.
    """
    return [round(base + offset, 10) for offset in SENSITIVITY_OFFSETS]


def sensitivity_cell(
    explicit_fcff:   list[float],
    wacc:            float,
    terminal_growth: float,
) -> dict:
    """Value one (WACC, terminal growth) point of a sensitivity grid.

    Returns multi_stage_dcf's keys plus `undefined_reason`, which is None for a cell
    that has a valuation.

    Where the model has no value, every number is None -- including `pv_explicit`,
    which is arithmetically computable at a negative discount rate. A cell is
    reported whole or not at all: half a valuation under a heading that reads like a
    whole one is the failure this grid exists to expose. Nor is the denominator
    floored at some epsilon, which would report a large finite value at precisely
    the point where the honest answer is that there is none.

    Terminal cash flow is derived per cell, since CF_{n+1} = CF_n x (1+g) moves with
    the axis.
    """
    if wacc <= 0:
        return _undefined_cell(WACC_NOT_POSITIVE)
    if wacc <= terminal_growth:
        return _undefined_cell(WACC_NOT_ABOVE_TERMINAL_GROWTH)

    valued = multi_stage_dcf(
        explicit_fcff=explicit_fcff,
        terminal_cf=explicit_fcff[-1] * (1 + terminal_growth),
        wacc=wacc,
        terminal_growth=terminal_growth,
    )
    return {**valued, "undefined_reason": None}


def _undefined_cell(reason: str) -> dict:
    return {
        "pv_explicit":      None,
        "pv_terminal":      None,
        "enterprise_value": None,
        "terminal_value":   None,
        "tv_share_pct":     None,
        "undefined_reason": reason,
    }


def sensitivity_grid(
    explicit_fcff:         list[float],
    base_wacc:             float,
    base_terminal_growth:  float,
) -> dict:
    """WACC x terminal-growth sensitivity grid around a base valuation.

    The explicit forecast does not depend on either axis, so the same cash flows are
    revalued at every point and only the discounting and terminal leg move.

    Cells are row-major with WACC on the outer axis. `is_base` marks the centre by
    position rather than by comparing floats, and the centre cell reproduces the
    valuation at the base assumptions exactly.
    """
    wacc_values = sensitivity_axis(base_wacc)
    terminal_growth_values = sensitivity_axis(base_terminal_growth)
    centre = SENSITIVITY_OFFSETS.index(0.0)

    cells: list[dict] = []
    for row, wacc in enumerate(wacc_values):
        for column, terminal_growth in enumerate(terminal_growth_values):
            cells.append({
                "wacc":            wacc,
                "terminal_growth": terminal_growth,
                "is_base":         row == centre and column == centre,
                **sensitivity_cell(explicit_fcff, wacc, terminal_growth),
            })

    return {
        "wacc_values":            wacc_values,
        "terminal_growth_values": terminal_growth_values,
        "cells":                  cells,
    }
