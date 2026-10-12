"""Rule evaluation: the boundary values the spec names, and the gaps it does not."""
import sys
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from packages.core_finance.macro_signals.rules import (
    Condition, Observation, compound_all, is_stale, level_change, level_streak, mom_pct,
    rolling_mean,
)

AS_OF = date(2026, 10, 9)


def daily(values, end=AS_OF):
    """One observation per weekday ending at `end`, oldest first. None = FRED's '.' (dropped)."""
    days, d = [], end
    while len(days) < len(values):
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    return [Observation(day, v) for day, v in zip(days, values) if v is not None]


def monthly(pairs):
    return [Observation(date.fromisoformat(d), v) for d, v in pairs]


STICKY = dict(op=">=", threshold=5.50, days=10, near_threshold=5.35, near_days=5)


def test_level_streak_ten_days_at_5_51_triggers():
    ev = level_streak(daily([5.0] + [5.51] * 10), AS_OF, **STICKY)
    assert ev.state == "triggered"
    assert ev.value == 5.51 and ev.observed_at == AS_OF and ev.threshold == 5.50


def test_level_streak_nine_days_is_near():
    assert level_streak(daily([5.0] + [5.51] * 9), AS_OF, **STICKY).state == "near"


def test_level_streak_missing_dot_does_not_break_the_run():
    values = [5.0] + [5.51] * 5 + [None] + [5.51] * 5   # 10 real observations, one '.'
    assert level_streak(daily(values), AS_OF, **STICKY).state == "triggered"


def test_level_streak_below_near_is_not_triggered():
    assert level_streak(daily([5.0] * 12), AS_OF, **STICKY).state == "not_triggered"


def test_level_streak_below_direction_for_relief():
    relief = dict(op="<", threshold=5.00, days=5, near_threshold=5.15)
    assert level_streak(daily([4.9] * 5), AS_OF, **relief).state == "triggered"
    assert level_streak(daily([5.1] * 5), AS_OF, **relief).state == "near"


CORE = dict(op=">=", threshold=0.25, near_threshold=0.20)


def test_mom_pct_0_250_triggers_on_the_boundary():
    ev = mom_pct(monthly([("2026-07-01", 100.0), ("2026-08-01", 100.25)]), AS_OF, **CORE)
    assert ev.state == "triggered"
    assert ev.value == 0.25


def test_mom_pct_0_249_is_near_not_triggered():
    ev = mom_pct(monthly([("2026-07-01", 100.0), ("2026-08-01", 100.249)]), AS_OF, **CORE)
    assert ev.state == "near"


def test_mom_pct_refuses_a_gap_between_months():
    ev = mom_pct(monthly([("2026-06-01", 100.0), ("2026-08-01", 101.0)]), AS_OF, **CORE)
    assert ev.state == "stale"
    assert "previous month" in ev.note


SPIKE = dict(window=5, op=">=", threshold=110.0, near_threshold=105.0)


def test_rolling_mean_exactly_110_triggers():
    assert rolling_mean(daily([90.0] + [110.0] * 5), AS_OF, **SPIKE).state == "triggered"


def test_rolling_mean_109_99_is_near():
    assert rolling_mean(daily([109.99] * 5), AS_OF, **SPIKE).state == "near"


def test_rolling_mean_with_too_few_observations_is_stale():
    assert rolling_mean(daily([120.0] * 4), AS_OF, **SPIKE).state == "stale"


def cond(met):
    return Condition("x", met, 1.0, AS_OF)


def test_compound_both_met_triggers_one_is_near_none_is_not():
    assert compound_all([cond(True), cond(True)]).state == "triggered"
    assert compound_all([cond(True), cond(False)]).state == "near"
    assert compound_all([cond(False), cond(False)]).state == "not_triggered"


def test_level_change_detects_a_hike_against_the_lookback_value():
    obs = [Observation(AS_OF - timedelta(days=d), 4.00) for d in range(10, 2, -1)]
    obs += [Observation(AS_OF - timedelta(days=d), 4.25) for d in (2, 1, 0)]
    ev = level_change(obs, AS_OF, lookback_days=7, op=">", threshold=0.0)
    assert ev.state == "triggered" and ev.value == 0.25


def test_level_change_without_a_baseline_is_stale():
    ev = level_change([Observation(AS_OF, 4.0)], AS_OF, lookback_days=7, op=">", threshold=0.0)
    assert ev.state == "stale"


def test_staleness_uses_the_latest_observation_date():
    obs = [Observation(date(2026, 8, 1), 1.0)]
    assert is_stale(obs, date(2026, 10, 10), 80) is False   # 70 days
    assert is_stale(obs, date(2026, 10, 10), 45) is True
    assert is_stale([], date(2026, 10, 10), 80) is True


def test_observations_after_as_of_are_ignored():
    obs = daily([5.0] * 12) + [Observation(AS_OF + timedelta(days=3), 6.0)]
    assert level_streak(obs, AS_OF, **STICKY).value == 5.0
