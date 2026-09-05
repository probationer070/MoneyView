"""Exact Shapley attribution over a set of changed inputs.

Deliberately knows nothing about valuation, cases or SQL: it takes a callable
returning a number. That is what lets it be tested against a linear model whose
answers are computable by hand, and against a nonlinear one where the choice of
method actually shows.

Why Shapley and not something cheaper: the model this attributes over is
nonlinear, so applying changes in sequence gives a different answer per ordering
-- "WACC contributed -12.40" would then be a fact about the implementation's
loop order rather than about WACC. Shapley is the unique attribution that is
both exact (contributions sum to the total difference) and independent of
ordering. It costs 2^k evaluations, which is why the caller caps k.
"""
from __future__ import annotations

from itertools import combinations
from math import factorial
from typing import Callable, Mapping


def shapley_contributions(
    base: Mapping[str, float],
    changed: Mapping[str, float],
    metric: Callable[[dict], float],
) -> dict[str, float]:
    """Exact Shapley value per CHANGED key, in `metric`'s units.

    `base` and `changed` hold the same keys; only those whose values differ are
    players. Returns {} when nothing differs.

    The result satisfies sum(contributions) == metric(changed) - metric(base) to
    floating tolerance -- there is no residual to report, and a caller that finds
    one has a bug rather than a rounding story.
    """
    players = [key for key in base if changed[key] != base[key]]
    if not players:
        return {}

    # metric() is evaluated once per distinct coalition rather than once per
    # permutation: 2^k evaluations instead of k!.
    cache: dict[frozenset[str], float] = {}

    def value(coalition: frozenset[str]) -> float:
        if coalition not in cache:
            inputs = dict(base)
            for key in coalition:
                inputs[key] = changed[key]
            cache[coalition] = metric(inputs)
        return cache[coalition]

    n = len(players)
    contributions: dict[str, float] = {}
    for player in players:
        others = [key for key in players if key != player]
        total = 0.0
        for size in range(len(others) + 1):
            weight = factorial(size) * factorial(n - size - 1) / factorial(n)
            for subset in combinations(others, size):
                coalition = frozenset(subset)
                total += weight * (value(coalition | {player}) - value(coalition))
        contributions[player] = total
    return contributions
