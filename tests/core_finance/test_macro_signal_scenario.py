"""Scenario probabilities: bounded normalization, posterior, per-signal contributions."""
import math
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest

from packages.core_finance.macro_signals.scenario import (
    ActiveSignal, bounded_normalize, contributions, posterior,
)

PRIOR = {"a": 0.35, "b": 0.45, "c": 0.20}
FLOOR, CAP = 0.05, 0.85
# The spec's initial likelihood ratios for every B-direction rule (manual ones included).
B_LRS = {
    "b_tnx_sticky": (0.7, 1.2, 1.5), "b_core_cpi_hot": (0.8, 1.2, 1.2), "b_hy_wide": (0.6, 1.1, 1.8),
    "b_brent_spike": (0.7, 1.2, 1.4), "b_fed_hike": (0.8, 1.2, 1.2),
    "m_capex_reaction": (0.7, 1.2, 1.5), "m_iran_strike": (0.7, 1.3, 1.3),
}


def sig(rule_id, lr, weight=1.0):
    return ActiveSignal(rule_id, dict(zip("abc", lr)), weight)


ALL_B = [sig(k, v) for k, v in B_LRS.items()]


def test_no_signals_returns_the_prior():
    assert posterior(PRIOR, [], FLOOR, CAP) == pytest.approx(PRIOR, abs=1e-12)


@pytest.mark.parametrize("signals", [[], ALL_B, ALL_B[:2], [sig("x", (3.0, 0.1, 0.1))]])
def test_result_sums_to_one(signals):
    assert math.isclose(sum(posterior(PRIOR, signals, FLOOR, CAP).values()), 1.0, abs_tol=1e-9)


def test_all_b_signals_stay_inside_the_bounds():
    """The spec's clip-then-renormalize gives A = 0.048 here; this is the C1 correction."""
    result = posterior(PRIOR, ALL_B, FLOOR, CAP)
    assert all(FLOOR - 1e-12 <= p <= CAP + 1e-12 for p in result.values()), result


def test_bounded_normalize_pins_the_cap_and_spreads_the_rest_proportionally():
    assert bounded_normalize({"a": 0.98, "b": 0.01, "c": 0.01}, FLOOR, CAP) == pytest.approx(
        {"a": 0.85, "b": 0.075, "c": 0.075})


def test_near_moves_less_than_triggered():
    lr = B_LRS["b_hy_wide"]
    near = posterior(PRIOR, [sig("b_hy_wide", lr, 0.5)], FLOOR, CAP)
    full = posterior(PRIOR, [sig("b_hy_wide", lr, 1.0)], FLOOR, CAP)
    assert 0 < near["c"] - PRIOR["c"] < full["c"] - PRIOR["c"]


def test_contribution_is_the_change_from_removing_that_signal():
    signals = [sig("b_hy_wide", B_LRS["b_hy_wide"]), sig("a_x", (1.5, 0.9, 0.6))]
    contrib = contributions(PRIOR, signals, FLOOR, CAP)
    with_all = posterior(PRIOR, signals, FLOOR, CAP)
    without = posterior(PRIOR, signals[1:], FLOOR, CAP)
    assert contrib["b_hy_wide"] == pytest.approx({s: with_all[s] - without[s] for s in "abc"})
    assert contrib["b_hy_wide"]["c"] > 0


def test_infeasible_bounds_are_refused():
    with pytest.raises(ValueError):
        bounded_normalize({"a": 1, "b": 1, "c": 1}, 0.4, 0.85)


def test_pinning_cascades_until_every_value_is_in_bounds():
    """Pinning the cap leaves b above the floor-pinned c, so c's pin needs a later pass."""
    assert bounded_normalize({"a": 0.9, "b": 0.09, "c": 0.01}, FLOOR, CAP) == pytest.approx(
        {"a": 0.85, "b": 0.10, "c": 0.05})


def test_bounds_exactly_at_feasibility_are_accepted():
    assert bounded_normalize({"a": 1, "b": 3}, 0.5, 0.5) == pytest.approx({"a": 0.5, "b": 0.5})


def test_cap_too_low_for_the_scenario_count_is_refused():
    with pytest.raises(ValueError):
        bounded_normalize({"a": 1, "b": 1, "c": 1}, FLOOR, 0.3)
