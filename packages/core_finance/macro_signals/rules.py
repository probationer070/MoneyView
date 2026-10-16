"""Pure evaluation of macro signal rules.

No database and no network: each function takes observations already fetched and
returns a verdict carrying the value, observation date and threshold it was decided on,
so the dashboard can show the evidence beside the state.
"""
from __future__ import annotations

import operator
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal, Sequence

State = Literal["triggered", "near", "not_triggered", "stale"]
Op = Literal[">=", ">", "<", "<="]

_OPS = {">=": operator.ge, ">": operator.gt, "<": operator.lt, "<=": operator.le}

# Unrounded float division turns 100.0 -> 100.25 into 0.24999999999999467, which would
# fail a ">= 0.25" threshold the data meets. 9 places is far below any published precision.
_PLACES = 9


@dataclass(frozen=True)
class Observation:
    date: date
    value: float


@dataclass(frozen=True)
class Evaluation:
    state: State
    value: float | None
    observed_at: date | None
    threshold: float | None
    note: str


@dataclass(frozen=True)
class Condition:
    label: str
    met: bool
    value: float
    observed_at: date


def compare(op: Op, left: float, right: float) -> bool:
    return _OPS[op](left, right)


def upto(observations: Sequence[Observation], as_of: date) -> list[Observation]:
    """Observations dated on or before `as_of`, oldest first."""
    return sorted((o for o in observations if o.date <= as_of), key=lambda o: o.date)


def is_stale(observations: Sequence[Observation], as_of: date, max_age_days: int) -> bool:
    usable = upto(observations, as_of)
    return not usable or (as_of - usable[-1].date).days > max_age_days


def stale(note: str, observed_at: date | None = None) -> Evaluation:
    return Evaluation("stale", None, observed_at, None, note)


def _grade(value, observed_at, op, threshold, near_threshold, note) -> Evaluation:
    if compare(op, value, threshold):
        state: State = "triggered"
    elif near_threshold is not None and compare(op, value, near_threshold):
        state = "near"
    else:
        state = "not_triggered"
    return Evaluation(state, value, observed_at, threshold, note)


def level_streak(observations, as_of, *, op, threshold, days, near_threshold=None, near_days=None):
    usable = upto(observations, as_of)
    if not usable:
        return stale("no observations")
    run = 0
    for obs in reversed(usable):
        if not compare(op, obs.value, threshold):
            break
        run += 1
    latest = usable[-1]
    if run >= days:
        state: State = "triggered"
    elif (near_threshold is not None and compare(op, latest.value, near_threshold)) or (
        near_days is not None and run >= near_days
    ):
        state = "near"
    else:
        state = "not_triggered"
    return Evaluation(state, latest.value, latest.date, threshold,
                      f"{run} consecutive observations {op} {threshold}")


def rolling_mean(observations, as_of, *, window, op, threshold, near_threshold=None):
    usable = upto(observations, as_of)
    if len(usable) < window:
        return stale(f"need {window} observations, have {len(usable)}",
                     usable[-1].date if usable else None)
    recent = usable[-window:]
    mean = round(sum(o.value for o in recent) / window, _PLACES)
    return _grade(mean, recent[-1].date, op, threshold, near_threshold, f"{window}-observation mean")


def _consecutive_months(prev: date, last: date) -> bool:
    return (last.year * 12 + last.month) - (prev.year * 12 + prev.month) == 1


def mom_pct_value(usable: Sequence[Observation]) -> tuple[float, date] | None:
    if len(usable) < 2 or not _consecutive_months(usable[-2].date, usable[-1].date):
        return None
    prev, last = usable[-2], usable[-1]
    return round((last.value / prev.value - 1) * 100, _PLACES), last.date


def mom_diff_value(usable: Sequence[Observation]) -> tuple[float, date] | None:
    if len(usable) < 2 or not _consecutive_months(usable[-2].date, usable[-1].date):
        return None
    return round(usable[-1].value - usable[-2].value, _PLACES), usable[-1].date


def mom_pct(observations, as_of, *, op, threshold, near_threshold=None):
    usable = upto(observations, as_of)
    point = mom_pct_value(usable)
    if point is None:
        return stale("previous month missing", usable[-1].date if usable else None)
    value, observed_at = point
    return _grade(value, observed_at, op, threshold, near_threshold, "month-over-month %")


def level_change(observations, as_of, *, lookback_days, op, threshold, since: date | None = None):
    """`since` (the previous stored snapshot's date) reaches the baseline further back when it is
    earlier than the lookback, so a change missed while the engine was not running is still seen."""
    usable = upto(observations, as_of)
    if not usable:
        return stale("no observations")
    cutoff = as_of - timedelta(days=lookback_days)
    if since is not None:
        cutoff = min(cutoff, since)
    baseline = [o for o in usable if o.date <= cutoff]
    if not baseline:
        return stale(f"no observation on or before {cutoff.isoformat()}", usable[-1].date)
    change = round(usable[-1].value - baseline[-1].value, _PLACES)
    state: State = "triggered" if compare(op, change, threshold) else "not_triggered"
    return Evaluation(state, change, usable[-1].date, threshold,
                      f"change since {baseline[-1].date.isoformat()}")


def compound_all(conditions: Sequence[Condition]) -> Evaluation:
    met = sum(c.met for c in conditions)
    state: State = "triggered" if met == len(conditions) else "near" if met else "not_triggered"
    note = "; ".join(f"{c.label}={c.value:g} ({'met' if c.met else 'not met'})" for c in conditions)
    return Evaluation(state, None, min(c.observed_at for c in conditions), None, note)
