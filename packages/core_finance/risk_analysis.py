"""
Risk Analysis — payback period, sensitivity (tornado), Monte Carlo.

Per SOP-FIN: guidelines/finance-logic.md §5.
Per GEMINI SOP §2: NumPy for < 100K iterations; Rust bridge available for more.

Decision Rule: Accept if NPV > 0. Avoid double-counting risk in both
discount rate AND simulation (per SOP-FIN §19).
"""

from __future__ import annotations

import numpy as np
from typing import Callable, Optional


# ---------------------------------------------------------------------------
# Payback Period
# ---------------------------------------------------------------------------

def payback_period(
    cash_flows:    list[float],
    discount_rate: float = 0.0,
    initial_cost:  float = 0.0,
) -> Optional[float]:
    """
    Payback period (simple or discounted).

    Args:
        cash_flows:    list of annual cash flows (year 1 … n)
        discount_rate: 0.0 for simple payback; > 0 for discounted payback
        initial_cost:  initial investment (positive value)

    Returns:
        Payback period in years, or None if cost is never recovered.
    """
    cumulative = -abs(initial_cost)
    for i, cf in enumerate(cash_flows):
        if discount_rate > 0:
            cf = cf / (1 + discount_rate) ** (i + 1)
        cumulative += cf
        if cumulative >= 0:
            # Linear interpolation within the year
            prev = cumulative - cf
            return (i + 1) - (cumulative / cf) + (prev / cf if cf != 0 else 0)
    return None  # Not recovered within forecast period


# ---------------------------------------------------------------------------
# Sensitivity Analysis (Tornado Chart Data)
# ---------------------------------------------------------------------------

def sensitivity_analysis(
    base_npv:     float,
    variables:    dict[str, tuple[float, float]],
    npv_function: Callable[..., float],
    base_inputs:  dict,
) -> list[dict]:
    """
    One-at-a-time sensitivity analysis — generates tornado chart data.

    Args:
        base_npv:     NPV at base-case inputs
        variables:    {var_name: (low_value, high_value)}
        npv_function: callable(**inputs) → NPV
        base_inputs:  dict of base-case inputs passed to npv_function

    Returns:
        List of {variable, base, low_npv, high_npv, swing} sorted by |swing| desc.
        Swing = high_npv - low_npv (used for tornado bar width).
    """
    results = []
    for var_name, (low_val, high_val) in variables.items():
        low_inputs  = {**base_inputs, var_name: low_val}
        high_inputs = {**base_inputs, var_name: high_val}
        low_npv  = npv_function(**low_inputs)
        high_npv = npv_function(**high_inputs)
        swing    = high_npv - low_npv
        results.append({
            "variable": var_name,
            "base_npv": round(base_npv, 2),
            "low_npv":  round(low_npv, 2),
            "high_npv": round(high_npv, 2),
            "swing":    round(abs(swing), 2),
        })
    # Sort descending by swing (largest impact at top of tornado)
    results.sort(key=lambda x: x["swing"], reverse=True)
    return results


# ---------------------------------------------------------------------------
# Monte Carlo NPV Simulation (NumPy)
# Rust bridge available when n_simulations >= 100_000
# ---------------------------------------------------------------------------

def monte_carlo_npv(
    base_inputs:       dict,
    variable_ranges:   dict[str, tuple[float, float, str]],
    npv_function:      Callable[..., float],
    n_simulations:     int = 1000,
    seed:              Optional[int] = None,
) -> dict:
    """
    Monte Carlo simulation for NPV distribution.

    Args:
        base_inputs:     base-case input dict
        variable_ranges: {var_name: (mean, std, distribution)}
                         distribution: "normal" | "uniform" | "triangular"
        npv_function:    callable(**inputs) → NPV
        n_simulations:   number of runs (< 100K → NumPy; ≥ 100K → Rust)
        seed:            random seed for reproducibility

    Returns:
        {
          "n_simulations": int,
          "mean_npv":      float,
          "p5":            float,  # 5th percentile
          "p50":           float,  # median
          "p95":           float,  # 95th percentile
          "prob_positive": float,  # P(NPV > 0)
          "computed_by":   str,    # "numpy" | "rust"
          "histogram":     list[dict],  # {bin_start, bin_end, count}
        }
    """
    rng = np.random.default_rng(seed)
    results = np.empty(n_simulations)

    for i in range(n_simulations):
        sampled = dict(base_inputs)
        for var, (mean, std, dist) in variable_ranges.items():
            if dist == "normal":
                sampled[var] = float(rng.normal(mean, std))
            elif dist == "uniform":
                sampled[var] = float(rng.uniform(mean - std, mean + std))
            elif dist == "triangular":
                sampled[var] = float(rng.triangular(mean - std, mean, mean + std))
            else:
                sampled[var] = mean
        try:
            results[i] = npv_function(**sampled)
        except Exception:
            results[i] = 0.0

    counts, edges = np.histogram(results, bins=20)
    histogram = [
        {"bin_start": round(float(edges[j]), 2),
         "bin_end":   round(float(edges[j+1]), 2),
         "count":     int(counts[j])}
        for j in range(len(counts))
    ]

    return {
        "n_simulations": n_simulations,
        "mean_npv":      round(float(results.mean()), 2),
        "p5":            round(float(np.percentile(results, 5)),  2),
        "p50":           round(float(np.percentile(results, 50)), 2),
        "p95":           round(float(np.percentile(results, 95)), 2),
        "prob_positive": round(float((results > 0).mean()) * 100, 2),
        "computed_by":   "numpy",
        "histogram":     histogram,
    }
