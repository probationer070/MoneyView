"""Spearman rank correlation, on numpy alone.

`scipy.stats.spearmanr` would do this in one line, but scipy is not a dependency
of this repository -- it is absent from pyproject.toml, and
`segment_valuation.py` says so where it hand-rolls its own solver for the same
reason. Adding a dependency for eleven lines is the wrong trade.

Spearman rather than Pearson because the valuation engine is nonlinear and
monotonic: Pearson understates a strong but curved relationship and would rank a
strongly nonlinear driver below a weakly linear one.
"""
from __future__ import annotations

import numpy as np


def _average_ranks(values: np.ndarray) -> np.ndarray:
    """Ranks 1..n, with tied values sharing their average rank.

    Ties are not a corner case here: a sampled INTEGER field (`ramp_start_year`,
    `wacc_converge_from`) is rounded before use, so a run of 10,000 samples over
    a three-year band holds thousands of ties. Ranking those by position would
    invent an ordering the data does not have, and the coefficient would then
    depend on the order the samples happened to arrive in.
    """
    order = np.argsort(values, kind="mergesort")
    positional = np.empty(values.shape[0], dtype=float)
    positional[order] = np.arange(1.0, values.shape[0] + 1.0)

    _, inverse, counts = np.unique(values, return_inverse=True, return_counts=True)
    totals = np.zeros(counts.shape[0], dtype=float)
    np.add.at(totals, inverse, positional)
    return (totals / counts)[inverse]


def spearman(x: np.ndarray, y: np.ndarray) -> float | None:
    """Rank correlation of `x` and `y`. None when either is constant.

    None rather than 0.0: a constant input is not measurable, whereas 0.0 would
    assert it was measured and found unrelated. Those are different claims.
    """
    if x.shape != y.shape:
        raise ValueError(f"x and y must have the same shape, got {x.shape} and {y.shape}")

    rx = _average_ranks(x)
    ry = _average_ranks(y)
    rx = rx - rx.mean()
    ry = ry - ry.mean()
    denominator = np.sqrt((rx ** 2).sum() * (ry ** 2).sum())
    if denominator == 0:
        return None
    return float((rx * ry).sum() / denominator)
