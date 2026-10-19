"""Backfill, live evaluation and rules-change handling for the risk engine (spec 2026-10-19 sections 4.4-4.6, 7).

State keys in risk_state, per rules version <v>:
- `backfill:<v>`: "running" | "done" | "degraded" | "failed". "degraded" (ruling R26) is a finished
  backfill that ran with an engine warning series empty or with sweep failures: live evaluation runs as
  for "done", and the next run_backfill purges the version (live alerts too) and recomputes it, after
  which live days replay from the fixed live_start.
- `live_start:<v>`: the first day evaluated live (YYYY-MM-DD). Backfill covers eval_start up to the day before.
- `coverage_wait:<YYYY-MM-DD>`: UTC ISO timestamp when waiting for that day's bars began. Kept only for
  the newest candidate day; waits for older days are deleted.

Backfill and live run the same pure `evaluate_range`. A live day runs it over the inputs truncated to
that day with start = end = day and the open alert rebuilt from the store, so its windows match the
backfill's exactly.
"""
from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timedelta

import pandas as pd

from apps.api.core.logger import setup_logger
from apps.api.services.risk import store, sweep
from apps.api.services.risk.constants import WARNING_FRED_SERIES
from apps.api.services.risk.inputs import RiskInputs, coverage, load_inputs
from apps.api.services.risk.rules import LoadedRules, get_rules
from packages.core_finance.risk_signals.alerts import AlertRecord, OpenAlert, ThemeStint
from packages.core_finance.risk_signals.config import RiskRules
from packages.core_finance.risk_signals.decks import candidates, crash_deck, forward_returns, primary_theme
from packages.core_finance.risk_signals.evaluate import DayResult, EvaluationResult, evaluate_range
from packages.core_finance.risk_signals.indices import price_shapes

logger = setup_logger(__name__)

RULES_CHANGED = "rules_changed"
BACKFILL_COMPLETE = frozenset({"done", "degraded"})  # live evaluation runs; backfill alerts are visible
_NO_LIMIT = -1  # SQLite LIMIT -1 = every row
_WAIT = "coverage_wait:"
_STINT_FIELDS = ("fwd5", "fwd10", "fwd20", "max_dd10")
_CARD_FIELDS = ("fwd5", "fwd10", "fwd20")


# ---------------------------------------------------------------- evaluable day


def evaluable_day(inputs: RiskInputs, day: date, now: datetime, rules: RiskRules, *,
                  record_wait: bool = True) -> tuple[bool, float]:
    """(ok, coverage). ^SOX and RSP bars are always required; the coverage share is waived once
    `coverage_wait:<day>` is more than wait_hours old. A day that is not ok records its wait start
    when `record_wait`."""
    share = coverage(inputs.closes, inputs.themes, day, rules)
    stamp = pd.Timestamp(day)
    has_bars = stamp in inputs.sox.index and stamp in inputs.rsp.index
    if has_bars and share >= rules.coverage.min_share:
        return True, share
    key = f"{_WAIT}{day.isoformat()}"
    started = store.get_state(key)
    if started is None:
        if record_wait:
            store.set_state(key, now.isoformat())
        return False, share
    waited = now - datetime.fromisoformat(started)
    return has_bars and waited > timedelta(hours=rules.coverage.wait_hours), share


def _latest_evaluable(inputs: RiskInputs, days: list[date], now: datetime, rules: RiskRules) -> date | None:
    """Newest ok day of `days`. Only the newest candidate's wait is recorded, and waits for older days
    are deleted: the newest day's waiver releases every pending day before it."""
    if not days:
        return None
    newest = days[-1]
    store.delete_states_below(_WAIT, newest.isoformat())
    for day in reversed(days):
        if evaluable_day(inputs, day, now, rules, record_wait=day == newest)[0]:
            return day
    return None


def _calendar(inputs: RiskInputs) -> list[date]:
    return [ts.date() for ts in pd.DatetimeIndex(inputs.sox.dropna().index).sort_values()]


# ---------------------------------------------------------------- persistence helpers


def _dd(levels: pd.DataFrame, theme: str, day: date, rules: RiskRules) -> float | None:
    """Drawdown versus the 20-day high on `day`, percent; None when the window is not valid."""
    if theme not in levels.columns:
        return None
    value = price_shapes(levels[theme], rules.price.window).dd.get(pd.Timestamp(day))
    return None if value is None or pd.isna(value) else float(value) * 100


def _settled(level: pd.Series, day: date) -> dict[str, float | None]:
    """forward_returns, but max_dd10 only once its whole 10-row window has passed (fwd10 known)."""
    out = forward_returns(level, day)
    if out["fwd10"] is None:
        out["max_dd10"] = None
    return out


def _stint_outcome(levels: pd.DataFrame, theme: str, joined: date) -> dict[str, float | None]:
    if theme not in levels.columns:
        return {k: None for k in _STINT_FIELDS}
    return _settled(levels[theme], joined)


def _write_stints(alert_id: int, stints: list[ThemeStint], levels: pd.DataFrame, rules: RiskRules) -> None:
    for stint in stints:
        store.upsert_stint(alert_id, stint, _dd(levels, stint.theme, stint.joined, rules),
                           _stint_outcome(levels, stint.theme, stint.joined))


def _write_cards(alert_id: int, snapshot: str, inputs: RiskInputs, day: date, rules: RiskRules) -> None:
    store.replace_cards(alert_id, snapshot, "crash", crash_deck(inputs.closes, day, rules), day)
    store.replace_cards(alert_id, snapshot, "candidate", candidates(inputs.closes, inputs.sox, day, rules), day)


def _open_new(alert: OpenAlert | AlertRecord, start_result: DayResult, version: str, origin: str,
              levels: pd.DataFrame, inputs: RiskInputs, rules: RiskRules) -> int:
    dd_on_start = {t: _dd(levels, t, alert.start, rules) or 0.0 for t in alert.trigger}
    alert_id = store.insert_alert(alert.start, alert.trigger, version, origin,
                                  primary_theme(alert.trigger, dd_on_start), start_result.w1_proxy)
    _write_cards(alert_id, "start", inputs, alert.start, rules)
    return alert_id


def _truncate(inputs: RiskInputs, day: date) -> RiskInputs:
    ts = pd.Timestamp(day)
    return replace(inputs, closes=inputs.closes.loc[:ts], sox=inputs.sox.loc[:ts], rsp=inputs.rsp.loc[:ts],
                   fred={k: v.loc[:ts] for k, v in inputs.fred.items()})


def _evaluate(inputs: RiskInputs, rules: RiskRules, start: date, end: date,
              state: OpenAlert | None = None) -> EvaluationResult:
    return evaluate_range(inputs.closes, inputs.sox, inputs.rsp, inputs.shares, inputs.themes, inputs.fred,
                          rules, start=start, end=end, state=state)


def _rebuild(stored: store.StoredAlert) -> OpenAlert:
    return OpenAlert(
        start=stored.start_date,
        trigger=stored.trigger,
        stints=[ThemeStint(s.theme, s.via, s.joined_date, s.left_date, s.last_ref or s.joined_date)
                for s in stored.stints],
    )


def _fill_outcomes(version: str, levels: pd.DataFrame, closes: pd.DataFrame) -> None:
    """Fill None outcome fields of every stint and start card of `version` that are now known."""
    for origin in ("backfill", "live"):
        for alert in store.list_alerts(version, origin, _NO_LIMIT):
            for s in alert.stints:
                if all(getattr(s, k) is not None for k in _STINT_FIELDS):
                    continue
                got = _stint_outcome(levels, s.theme, s.joined_date)
                merged = {k: getattr(s, k) if getattr(s, k) is not None else got[k] for k in _STINT_FIELDS}
                if merged != {k: getattr(s, k) for k in _STINT_FIELDS}:
                    stint = ThemeStint(s.theme, s.via, s.joined_date, s.left_date, s.last_ref or s.joined_date)
                    store.upsert_stint(alert.id, stint, s.dd20_at_join, merged)
            for (snapshot, deck), cards in alert.cards.items():
                if snapshot != "start":
                    continue
                for card in cards:
                    if card.ticker not in closes.columns or all(
                            getattr(card, k) is not None for k in _CARD_FIELDS):
                        continue
                    got = forward_returns(closes[card.ticker], alert.start_date)
                    merged = {k: getattr(card, k) if getattr(card, k) is not None else got[k] for k in _CARD_FIELDS}
                    if merged != {k: getattr(card, k) for k in _CARD_FIELDS}:
                        store.update_card_outcomes(alert.id, "start", deck, card.ticker, merged)


def _on_calendar(inputs: RiskInputs) -> pd.DataFrame:
    """Closes on the ^SOX calendar, the row basis of forward returns."""
    return inputs.closes.reindex(pd.DatetimeIndex(inputs.sox.dropna().index).sort_values())


# ---------------------------------------------------------------- rules change


def apply_rules_change(now: datetime, *, loaded: LoadedRules | None = None) -> None:
    """Close open alerts of other versions (only before this version starts live), then purge their
    backfill alerts and risk_daily rows. Live alerts of old versions are kept."""
    version = (loaded or get_rules()).version
    others = sorted(store.versions() - {version})
    if store.get_state(f"live_start:{version}") is None:
        for old in others:
            alert = store.open_alert(old)
            while alert is not None:
                release = store.last_evaluated(old) or alert.start_date
                store.close_alert(alert.id, release, RULES_CHANGED)
                logger.info("risk.rules_changed_close alert=%s version=%s release=%s", alert.id, old, release)
                alert = store.open_alert(old)
    for old in others:
        store.purge_version(old)


# ---------------------------------------------------------------- backfill


def _persist_backfill(res: EvaluationResult, inputs: RiskInputs, version: str, end: date,
                      rules: RiskRules, now: datetime) -> None:
    by_day = {r.day: r for r in res.days}
    alerts: list[OpenAlert | AlertRecord] = [*res.closed, *([res.open] if res.open is not None else [])]
    for alert in alerts:
        alert_id = _open_new(alert, by_day[alert.start], version, "backfill", res.levels, inputs, rules)
        _write_stints(alert_id, alert.stints, res.levels, rules)
        release = alert.release if isinstance(alert, AlertRecord) else None
        _write_cards(alert_id, "latest", inputs, release or end, rules)
        if release is not None:
            store.close_alert(alert_id, release, alert.reason)
    stamp = now.isoformat()
    for day in res.days:
        store.save_day(day, version, "backfill", coverage(inputs.closes, inputs.themes, day.day, rules), stamp)


def run_backfill(now: datetime, *, inputs: RiskInputs | None = None, loaded: LoadedRules | None = None) -> None:
    loaded = loaded or get_rules()
    rules, version = loaded.rules, loaded.version
    key = f"backfill:{version}"
    try:
        apply_rules_change(now, loaded=loaded)
        if store.get_state(key) == "done":
            return
        store.set_state(key, "running")
        # include_live: a "degraded" version has live alerts and days; they are replayed from live_start.
        store.purge_version(version, include_live=True)
        # Both sweeps skip tickers they have finished, so a rerun only does what is left.
        tickers = sweep.watchlist_and_benchmarks()
        deep = sweep.ensure_deep_history(tickers, history_start=rules.history_start, today=now.date())
        facts = sweep.ensure_quote_facts(tickers, now)
        if inputs is None:  # loaded after the sweeps; inputs passed in are used as given
            inputs = load_inputs(now=now, loaded=loaded)

        live_key = f"live_start:{version}"
        if store.get_state(live_key) is None:
            latest = _latest_evaluable(inputs, _calendar(inputs), now, rules)
            if latest is None:
                raise ValueError("no evaluable trading day")
            store.set_state(live_key, latest.isoformat())
        live_start = date.fromisoformat(store.get_state(live_key))
        end = live_start - timedelta(days=1)
        res = _evaluate(inputs, rules, rules.eval_start, end)
        last = res.days[-1].day if res.days else end
        _persist_backfill(res, inputs, version, last, rules, now)
        _fill_outcomes(version, res.levels, _on_calendar(inputs))
        missing = [s for s in WARNING_FRED_SERIES if s not in inputs.fred or inputs.fred[s].empty]
        sweep_failed = [*deep.failed, *facts.failed]
        state = "degraded" if missing or sweep_failed else "done"
        store.set_state(key, state)
        logger.info("risk.backfill_%s version=%s days=%s alerts=%s missing_fred=%s sweep_failed=%s", state,
                    version, len(res.days), len(res.closed) + (res.open is not None), missing, sweep_failed)
    except AssertionError:  # the test network guard raises it; recording "failed" would hide that
        raise
    except Exception:  # noqa: BLE001 - a failed backfill is recorded and retried, never raised
        logger.exception("risk.backfill_failed version=%s", version)
        store.set_state(key, "failed")


# ---------------------------------------------------------------- live


def evaluate_pending(now: datetime, *, inputs: RiskInputs | None = None,
                     loaded: LoadedRules | None = None) -> list[int]:
    """Evaluate every pending trading day in order with origin "live"; return ids of alerts opened."""
    loaded = loaded or get_rules()
    rules, version = loaded.rules, loaded.version
    if store.get_state(f"backfill:{version}") not in BACKFILL_COMPLETE:
        return []
    if inputs is None:
        inputs = load_inputs(now=now, loaded=loaded)
    live_start = date.fromisoformat(store.get_state(f"live_start:{version}"))
    last = store.last_evaluated(version)
    pending = [d for d in _calendar(inputs) if d >= live_start and (last is None or d > last)]
    until = _latest_evaluable(inputs, pending, now, rules)
    opened: list[int] = []
    res = None
    day_inputs = inputs
    for day in (d for d in pending if until is not None and d <= until):
        day_inputs = _truncate(inputs, day)
        stored = store.open_alert(version)
        res = _evaluate(day_inputs, rules, day, day, _rebuild(stored) if stored is not None else None)
        result = res.days[0]
        # One transaction per day, risk_daily last: a failure leaves the day pending with no partial alert.
        with store.transaction():
            alert_id = None
            if stored is None and res.open is not None:
                alert_id = _open_new(res.open, result, version, "live", res.levels, day_inputs, rules)
            elif stored is not None:
                alert_id = stored.id
            if alert_id is not None:
                alert = res.closed[0] if res.closed else res.open
                _write_stints(alert_id, alert.stints, res.levels, rules)
                _write_cards(alert_id, "latest", day_inputs, day, rules)
                if res.closed:
                    store.close_alert(alert_id, res.closed[0].release, res.closed[0].reason)
            store.save_day(result, version, "live", coverage(inputs.closes, inputs.themes, day, rules),
                           now.isoformat())
        if stored is None and alert_id is not None:
            opened.append(alert_id)
    if res is not None:
        _fill_outcomes(version, res.levels, _on_calendar(day_inputs))
    return opened
