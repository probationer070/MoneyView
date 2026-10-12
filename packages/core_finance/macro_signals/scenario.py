"""Heuristic scenario probabilities from subjective likelihood ratios.

P(s | signals) ∝ P0(s) × Π LR_i(s)^w_i, recomputed from the fixed prior every week.
Never chained from last week's result: a signal that stays on for weeks would otherwise
be counted once per week and drive one scenario towards certainty.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence


@dataclass(frozen=True)
class ActiveSignal:
    rule_id: str
    lr: Mapping[str, float]
    weight: float


def bounded_normalize(raw: Mapping[str, float], floor: float, cap: float) -> dict[str, float]:
    """Normalize to sum 1 with every value in [floor, cap].

    Clipping and then renormalizing pushes values back out of bounds. Instead, pin the
    violators at the bound and spread the remaining mass over the free scenarios in
    proportion to `raw`. Overshoots are pinned first: pinning a cap frees mass that can lift
    a would-be floor violator, while pinning a floor only shrinks the free values, so no new
    overshoot can appear afterwards.
    """
    n = len(raw)
    if not (n * floor <= 1.0 <= n * cap):
        raise ValueError(f"bounds [{floor}, {cap}] are infeasible for {n} scenarios")
    fixed: dict[str, float] = {}
    while True:
        free = [k for k in raw if k not in fixed]
        if not free:
            return {k: fixed[k] for k in raw}
        mass = 1.0 - sum(fixed.values())
        total = sum(raw[k] for k in free)
        probs = {k: mass * raw[k] / total for k in free}
        over = [k for k in free if probs[k] > cap]
        if over:
            fixed.update({k: cap for k in over})
            continue
        under = [k for k in free if probs[k] < floor]
        if under:
            fixed.update({k: floor for k in under})
            continue
        return {k: fixed[k] if k in fixed else probs[k] for k in raw}


def posterior(prior: Mapping[str, float], signals: Sequence[ActiveSignal],
              floor: float, cap: float) -> dict[str, float]:
    raw = {s: p * math.prod(sig.lr[s] ** sig.weight for sig in signals) for s, p in prior.items()}
    return bounded_normalize(raw, floor, cap)


def contributions(prior: Mapping[str, float], signals: Sequence[ActiveSignal],
                  floor: float, cap: float) -> dict[str, dict[str, float]]:
    """Per signal: the probability it adds to each scenario, against the same run without it."""
    full = posterior(prior, signals, floor, cap)
    out: dict[str, dict[str, float]] = {}
    for sig in signals:
        without = posterior(prior, [o for o in signals if o is not sig], floor, cap)
        out[sig.rule_id] = {s: full[s] - without[s] for s in prior}
    return out
