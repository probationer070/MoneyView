"""One engine run: rules -> series -> evaluations -> manual merge -> probabilities -> store."""
from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Mapping

from apps.api.services.signals import store
from apps.api.services.signals.fetch import FetchedSeries, SeriesFetcher, fred_source_from_env
from apps.api.services.signals.models import LoadedRules, get_rules
from packages.core_finance.macro_signals import rules as r
from packages.core_finance.macro_signals.scenario import ActiveSignal, contributions, posterior

KST = timezone(timedelta(hours=9))   # Korea has no DST
_LOOKBACK_DAYS = 400                 # covers a 10-day streak and two months of monthly data
_RUN_LOCK = threading.Lock()         # the hourly cycle and POST /run must not interleave
DEFAULT = object()


def utc_now() -> datetime:
    return datetime.now(UTC)


def kst_today() -> date:
    return utc_now().astimezone(KST).date()


def default_source():
    return fred_source_from_env()


@dataclass(frozen=True)
class RunOutcome:
    snapshot: store.StoredSnapshot
    failures: list[str]


def evaluate_rule(rule, fetched: Mapping[str, FetchedSeries], as_of: date) -> r.Evaluation:
    for series_id in rule.series:
        series = fetched[series_id]
        if r.is_stale(series.observations, as_of, rule.max_age_days):
            usable = r.upto(series.observations, as_of)
            reason = series.error or f"latest observation older than {rule.max_age_days} days"
            return r.stale(f"{series_id}: {reason}", usable[-1].date if usable else None)
    obs = fetched[rule.series[0]].observations
    if rule.kind == "level_streak":
        return r.level_streak(obs, as_of, op=rule.op, threshold=rule.threshold, days=rule.days,
                              near_threshold=rule.near_threshold, near_days=rule.near_days)
    if rule.kind == "rolling_mean":
        return r.rolling_mean(obs, as_of, window=rule.window, op=rule.op, threshold=rule.threshold,
                              near_threshold=rule.near_threshold)
    if rule.kind == "mom_pct":
        return r.mom_pct(obs, as_of, op=rule.op, threshold=rule.threshold, near_threshold=rule.near_threshold)
    if rule.kind == "level_change":
        return r.level_change(obs, as_of, lookback_days=rule.lookback_days, op=rule.op, threshold=rule.threshold)
    conditions = []
    for c in rule.conditions:
        usable = r.upto(fetched[c.series].observations, as_of)
        point = r.mom_pct_value(usable) if c.transform == "mom_pct" else r.mom_diff_value(usable)
        if point is None:
            return r.stale(f"{c.series}: previous month missing", usable[-1].date if usable else None)
        value, observed_at = point
        conditions.append(r.Condition(c.label, r.compare(c.op, value, c.threshold), value, observed_at))
    return r.compound_all(conditions)


def score(loaded: LoadedRules, evaluations: Mapping[str, r.Evaluation]):
    cfg = loaded.file.scenario
    weights = {"triggered": cfg.weights.triggered, "near": cfg.weights.near}
    lrs = {rule.id: rule.lr.model_dump() for rule in loaded.file.rules}
    active = [ActiveSignal(rule_id, lrs[rule_id], weights[ev.state])
              for rule_id, ev in evaluations.items() if ev.state in weights and rule_id in lrs]
    prior = cfg.prior.model_dump()
    return posterior(prior, active, cfg.floor, cfg.cap), contributions(prior, active, cfg.floor, cfg.cap)


def _manual(loaded: LoadedRules, week: str) -> dict[str, r.Evaluation]:
    """Only rules the user actually set this week. An unset manual rule is left out, not
    counted as not_triggered: treating silence as 'no' would bias every probability."""
    inputs = store.get_manual_inputs(week)
    return {rule.id: r.Evaluation(inputs[rule.id].state, None, None, None, inputs[rule.id].note)
            for rule in loaded.file.rules if rule.kind == "manual" and rule.id in inputs}


def _save(loaded: LoadedRules, week: str, run_at: str, evaluations: dict[str, r.Evaluation]):
    probs, contrib = score(loaded, evaluations)
    rows = []
    for rule in loaded.file.rules:
        ev = evaluations.get(rule.id)
        if ev is None:
            continue
        rows.append(store.ResultRow(rule.id, ev.state, ev.value,
                                    ev.observed_at.isoformat() if ev.observed_at else None,
                                    ev.threshold, ev.note, contrib.get(rule.id)))
    store.save_snapshot(iso_week=week, run_at=run_at, rules_version=loaded.version, probs=probs, results=rows)
    return store.load_snapshot(week)


def run(as_of: date | None = None, *, source=DEFAULT) -> RunOutcome:
    with _RUN_LOCK:
        loaded = get_rules()
        as_of = as_of or kst_today()
        fetcher = SeriesFetcher(default_source() if source is DEFAULT else source, now=utc_now)
        start = as_of - timedelta(days=_LOOKBACK_DAYS)
        auto = [rule for rule in loaded.file.rules if rule.kind != "manual"]
        series_ids = sorted({s for rule in auto for s in rule.series})
        fetched = {sid: fetcher.get_series(sid, start) for sid in series_ids}
        week = store.iso_week(as_of)
        evaluations = {rule.id: evaluate_rule(rule, fetched, as_of) for rule in auto}
        evaluations.update(_manual(loaded, week))
        snapshot = _save(loaded, week, utc_now().isoformat(timespec="seconds"), evaluations)
        return RunOutcome(snapshot, [f.error for f in fetched.values() if f.error])


def rescore(week: str) -> store.StoredSnapshot | None:
    """Recompute a stored week after a manual input, without touching FRED. run_at is kept:
    it records when the data was fetched, which a manual edit does not change, and the
    Saturday schedule compares against it."""
    with _RUN_LOCK:
        snapshot = store.load_snapshot(week)
        if snapshot is None:
            return None
        loaded = get_rules()
        manual_ids = {rule.id for rule in loaded.file.rules if rule.kind == "manual"}
        evaluations = {
            row.rule_id: r.Evaluation(row.state, row.value,
                                      date.fromisoformat(row.observed_at) if row.observed_at else None,
                                      row.threshold, row.note)
            for row in snapshot.results if row.rule_id not in manual_ids}
        evaluations.update(_manual(loaded, week))
        return _save(loaded, week, snapshot.run_at, evaluations)
