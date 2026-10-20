"""Backfill, live evaluation and rules-change handling for the risk engine (spec 2026-10-19 sections 4.4-4.6, 7).

State keys in risk_state, per rules version <v>:
- `backfill:<v>`: "running" | "done" | "degraded" | "failed". "degraded" (ruling R26) is a finished
  backfill that ran with an engine warning series empty or with sweep failures: live evaluation runs as
  for "done". Each later run_backfill sweeps and reloads; while the condition holds nothing is touched.
  Once it clears, the version is purged (live alerts too) and recomputed once, and live days replay
  from the fixed live_start (spec section 7 exception).
- `replayed_through:<v>`: the last evaluated day before that one rebuild. Alerts the replay opens with a
  start on or before it existed already and are not reported as opened.
- `live_start:<v>`: the first day evaluated live (YYYY-MM-DD). Backfill covers eval_start up to the day before.
- `coverage_wait:<YYYY-MM-DD>`: UTC ISO timestamp when waiting for that day's bars began. Recorded only
  for the newest candidate day; waits before the oldest pending day are deleted.

Backfill and live run the same pure `evaluate_range`. A live day runs it over the inputs truncated to
that day with start = end = day and the open alert and surge state rebuilt from the store. Live days
read only a trailing window of bars (`live_window_start`, surge spec section 5); every judgement is a
ratio, so the window gives the full history's flags and dates, and its numbers to rel 1e-9.

Surge (surge spec sections 3.2-3.4, 4, 7): every evaluated day stores its movers; events store `shown`
(the banner on their start day, never recomputed), the start day's components and leaders, and get
fwd5/10/20 and max_runup10 filled once known. `surge_state` keeps each series' last confirmation.
"""
from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from apps.api.core.logger import setup_logger
from apps.api.services.risk import store, sweep
from apps.api.services.risk.constants import WARNING_FRED_SERIES
from apps.api.services.risk.inputs import RiskInputs, coverage, load_inputs
from apps.api.services.risk.rules import LoadedRules, get_rules
from packages.core_finance.risk_signals.alerts import AlertRecord, OpenAlert, ThemeStint
from packages.core_finance.risk_signals.config import RiskRules
from packages.core_finance.risk_signals.decks import (
    _base_and_window, candidates, crash_deck, forward_returns, primary_theme,
)
from packages.core_finance.risk_signals.evaluate import DayResult, EvaluationResult, evaluate_range
from packages.core_finance.risk_signals.indices import _members_by_theme, price_shapes, theme_indices
from packages.core_finance.risk_signals.surge import SOX, SurgeEvent, SurgeState

logger = setup_logger(__name__)

RULES_CHANGED = "rules_changed"
BACKFILL_COMPLETE = frozenset({"done", "degraded"})  # live evaluation runs; backfill alerts are visible
_NO_LIMIT = -1  # SQLite LIMIT -1 = every row
_WAIT = "coverage_wait:"
_STINT_FIELDS = ("fwd5", "fwd10", "fwd20", "max_dd10")
_CARD_FIELDS = ("fwd5", "fwd10", "fwd20")
_SURGE_FIELDS = ("fwd5", "fwd10", "fwd20", "max_runup10")
_COARSE_DAYS = 3 * 366  # a live load first reads about 3 years, enough to count the window's rows


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
    """Newest ok day of `days`. Only the newest candidate's wait is recorded. Waits for days before the
    oldest pending day are stale and deleted; an older pending day keeps its own wait, so it is waived
    on its own clock even after newer days appear."""
    if not days:
        return None
    newest = days[-1]
    store.delete_states_below(_WAIT, days[0].isoformat())
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
              state: OpenAlert | None = None, surge_state: SurgeState | None = None) -> EvaluationResult:
    return evaluate_range(inputs.closes, inputs.sox, inputs.rsp, inputs.shares, inputs.themes, inputs.fred,
                          rules, start=start, end=end, state=state, surge_state=surge_state)


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


# ---------------------------------------------------------------- surge persistence


def _surge_levels(res: EvaluationResult, inputs: RiskInputs) -> pd.DataFrame:
    """The level each surge series is measured on: theme indices plus ^SOX, on the calendar."""
    return res.levels.assign(**{SOX: inputs.sox.reindex(res.levels.index)})


def _leaders(px: pd.DataFrame, members: dict[str, list[str]], series: str, day: date,
             rules: RiskRules) -> list[dict]:
    """The surge.leaders members of `series` with the highest return over breadth.window calendar rows
    to `day` (the return breadth counts), ties to the first ticker. ^SOX members are the semis themes'
    members. `px` is `_on_calendar(inputs)`, `members` is `_members_by_theme` of the inputs."""
    names = (sorted({t for th in rules.semis_themes for t in members.get(th, [])}) if series == SOX
             else members.get(series, []))
    i, w = px.index.get_loc(pd.Timestamp(day)), rules.surge.breadth.window
    if i < w or not names:
        return []
    r5 = (px.iloc[i][names] / px.iloc[i - w][names] - 1).dropna()
    ranked = sorted(r5.items(), key=lambda kv: (-kv[1], kv[0]))[: rules.surge.leaders]
    return [{"ticker": str(t), "return5_pct": float(v) * 100} for t, v in ranked]


def _members(inputs: RiskInputs) -> dict[str, list[str]]:
    return _members_by_theme(inputs.closes, inputs.shares, inputs.themes)


def _insert_surge(event: SurgeEvent, start_day: DayResult, version: str, origin: str, px: pd.DataFrame,
                  members: dict[str, list[str]], rules: RiskRules) -> int:
    return store.insert_surge_event(
        version, origin, event.theme, event.start, shown=start_day.surge_shown[event.theme],
        components=start_day.surge[event.theme], leaders=_leaders(px, members, event.theme, event.start, rules),
        last_high=event.last_high, end=event.end, end_reason=event.end_reason,
        overheated_on=event.overheated_on)


def _surge_outcome(level: pd.Series, day: date) -> dict[str, float | None]:
    """fwd5/10/20 as forward_returns; max_runup10 = the highest close of the next 10 rows over the
    start close, percent, only once its whole window has passed (fwd10 known), like max_dd10."""
    out = forward_returns(level, day)
    runup = None
    found = _base_and_window(level, day)
    if found is not None and out["fwd10"] is not None:
        base, v, pos = found
        win = v[pos + 1 : pos + 11]
        win = win[~np.isnan(win)]
        runup = (float(win.max()) - base) / base * 100 if len(win) else None
    return {"fwd5": out["fwd5"], "fwd10": out["fwd10"], "fwd20": out["fwd20"], "max_runup10": runup}


def _fill_surge_outcomes(version: str, levels: pd.DataFrame) -> None:
    """Fill the None outcome fields of every surge event of `version` that are now known."""
    for e in store.list_surge(version, None, None, _NO_LIMIT):
        have = {k: getattr(e, k) for k in _SURGE_FIELDS}
        if e.theme not in levels.columns or all(v is not None for v in have.values()):
            continue
        got = _surge_outcome(levels[e.theme], e.start_date)
        merged = {k: have[k] if have[k] is not None else got[k] for k in _SURGE_FIELDS}
        if merged != have:
            store.fill_surge_outcome(e.id, merged)


def _save_last_confirms(version: str, state: SurgeState) -> None:
    for series, day in state.last_confirm.items():
        store.set_last_confirm(version, series, day)


def _stored_surge_state(version: str, first: date) -> tuple[SurgeState, dict[str, int]]:
    """The open events and last confirmations from the store, and the open events' ids by series.
    A confirmation before `first` (the window's first day) is more than live_window_rows > event.gap
    rows back, so it cannot block a start; it is left out because run_surge looks rows up by date."""
    stored = store.open_surge_events(version)
    events = {s.theme: SurgeEvent(s.theme, s.start_date, None, None, s.last_high_date, s.overheated_on)
              for s in stored}
    confirms = {t: d for t, d in store.last_confirms(version).items() if d >= first}
    return SurgeState(events, confirms), {s.theme: s.id for s in stored}


def _persist_surge_live(res: EvaluationResult, result: DayResult, ids: dict[str, int], version: str,
                        inputs: RiskInputs, rules: RiskRules) -> None:
    for e in res.surge_closed:
        store.update_surge_event(ids[e.theme], end=e.end, end_reason=e.end_reason, last_high=e.last_high,
                                 overheated_on=e.overheated_on)
    for series, e in res.surge_state.open.items():
        if series in result.surge_started:
            _insert_surge(e, result, version, "live", _on_calendar(inputs), _members(inputs), rules)
        else:
            store.update_surge_event(ids[series], end=None, end_reason=None, last_high=e.last_high,
                                     overheated_on=e.overheated_on)
    _save_last_confirms(version, res.surge_state)


# ---------------------------------------------------------------- live window


def _rows_back(cal: pd.DatetimeIndex, day: date, rows: int) -> date:
    return cal[max(int(cal.searchsorted(pd.Timestamp(day))) - rows, 0)].date()


def live_window_start(inputs: RiskInputs, rules: RiskRules, first_day: date,
                      open_alert: store.StoredAlert | None, open_surges: list[store.StoredSurge]) -> date:
    """First day of the trailing window a live run from `first_day` on needs (surge spec section 5).
    The earliest of:
    - per trigger theme with a level in the last live_window_rows calendar rows to `first_day`, its live_window_rows-th
      valid index row back from `first_day` (a theme with a <min_members gap goes back that much more);
    - the open alert's earliest stint last_ref, and its start minus price.window rows (its stints'
      join-day drawdown is rewritten every live day);
    - the open surge events' earliest start minus event.high_window rows.
    Returns the inputs' first day, and logs the theme, when a theme has fewer valid rows than that in `inputs`.

    Accepted gap: movers' RSI runs on each ticker's own closes inside the window, so a ticker with a
    very gappy history can differ from a full run by more than rel 1e-9. It is a display value only."""
    cal = pd.DatetimeIndex(inputs.sox.dropna().index).sort_values()
    first = cal[0].date()
    n = rules.surge.live_window_rows
    levels = theme_indices(inputs.closes.reindex(cal), inputs.shares, inputs.themes, rules.min_members)
    upto = levels.loc[: pd.Timestamp(first_day)]
    bounds = []
    for theme in levels.columns:
        if theme in rules.excluded_themes or not upto[theme].iloc[-n:].notna().any():
            continue
        valid = upto[theme].dropna().index
        if len(valid) < n:  # the caller then reads the whole history
            logger.info("risk.live_window_young_theme theme=%s valid_rows=%s", theme, len(valid))
            return first
        bounds.append(valid[-n].date())
    if open_alert is not None:
        bounds.append(min(s.last_ref or s.joined_date for s in open_alert.stints))
        bounds.append(_rows_back(cal, open_alert.start_date, rules.price.window))
    if open_surges:
        bounds.append(_rows_back(cal, min(s.start_date for s in open_surges), rules.surge.event.high_window))
    return max(min(bounds, default=first), first)


def _since(inputs: RiskInputs, day: date) -> RiskInputs:
    """`load_inputs(since=day)` in memory: closes, ^SOX and RSP from `day`; FRED untouched."""
    ts = pd.Timestamp(day)
    return replace(inputs, closes=inputs.closes.loc[ts:], sox=inputs.sox.loc[ts:], rsp=inputs.rsp.loc[ts:])


# ---------------------------------------------------------------- rules change


def apply_rules_change(now: datetime, *, loaded: LoadedRules | None = None) -> None:
    """Close open alerts and surge events of other versions (only before this version starts live),
    then purge their backfill rows. Live alerts and live surge events of old versions are kept, closed
    with reason rules_changed on that version's last evaluated day."""
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
            for event in store.open_surge_events(old):
                end = store.last_evaluated(old) or event.start_date
                store.update_surge_event(event.id, end=end, end_reason=RULES_CHANGED,
                                         last_high=event.last_high_date, overheated_on=event.overheated_on)
                logger.info("risk.rules_changed_close surge=%s version=%s end=%s", event.id, old, end)
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
    px, members = _on_calendar(inputs), _members(inputs)
    for event in [*res.surge_closed, *res.surge_state.open.values()]:
        _insert_surge(event, by_day[event.start], version, "backfill", px, members, rules)
    _save_last_confirms(version, res.surge_state)
    stamp = now.isoformat()
    for day in res.days:
        with store.transaction():
            store.save_movers(version, day.day, day.movers, inputs.themes)
            store.save_day(day, version, "backfill", coverage(inputs.closes, inputs.themes, day.day, rules),
                           stamp)


def run_backfill(now: datetime, *, inputs: RiskInputs | None = None, loaded: LoadedRules | None = None) -> None:
    loaded = loaded or get_rules()
    rules, version = loaded.rules, loaded.version
    key = f"backfill:{version}"
    prior = None
    rebuilding = False
    try:
        apply_rules_change(now, loaded=loaded)
        prior = store.get_state(key)
        if prior == "done":
            return
        if prior != "degraded":
            store.set_state(key, "running")
            store.purge_version(version, include_live=True)  # no live rows unless a rebuild failed midway
        # Both sweeps skip tickers they have finished, so a rerun only does what is left.
        tickers = sweep.watchlist_and_benchmarks()
        deep = sweep.ensure_deep_history(tickers, history_start=rules.history_start, today=now.date())
        facts = sweep.ensure_quote_facts(tickers, now)
        if inputs is None:  # loaded after the sweeps; inputs passed in are used as given
            inputs = load_inputs(now=now, loaded=loaded)
        missing = [s for s in WARNING_FRED_SERIES if s not in inputs.fred or inputs.fred[s].empty]
        sweep_failed = [*deep.failed, *facts.failed]
        state = "degraded" if missing or sweep_failed else "done"
        if prior == "degraded":
            if state == "degraded":  # still degraded: leave the alerts, days and state as they are
                logger.info("risk.backfill_still_degraded version=%s missing_fred=%s sweep_failed=%s",
                            version, missing, sweep_failed)
                return
            # Cleared: rebuild once. Live alerts and days are purged and replayed from live_start.
            replayed = store.last_evaluated(version)
            if replayed is not None:
                store.set_state(f"replayed_through:{version}", replayed.isoformat())
            rebuilding = True
            store.set_state(key, "running")
            store.purge_version(version, include_live=True)

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
        _fill_surge_outcomes(version, _surge_levels(res, inputs))
        store.set_state(key, state)
        logger.info("risk.backfill_%s version=%s days=%s alerts=%s missing_fred=%s sweep_failed=%s", state,
                    version, len(res.days), len(res.closed) + (res.open is not None), missing, sweep_failed)
    except AssertionError:  # the test network guard raises it; recording "failed" would hide that
        raise
    except Exception:  # noqa: BLE001 - a failed backfill is recorded and retried, never raised
        logger.exception("risk.backfill_failed version=%s", version)
        # A degraded version that failed before its rebuild began still has its live alerts intact.
        store.set_state(key, "degraded" if prior == "degraded" and not rebuilding else "failed")


# ---------------------------------------------------------------- live


def _load_live(now: datetime, loaded: LoadedRules, since: date | None) -> RiskInputs:
    """A live load: fetch the engine FRED series and keep their errors in risk_state `fred_errors`
    (read by /latest)."""
    inputs = load_inputs(now=now, loaded=loaded, since=since, fetch_fred=True)
    store.set_state("fred_errors", json.dumps(inputs.fred_errors))
    return inputs


def evaluate_pending(now: datetime, *, inputs: RiskInputs | None = None,
                     loaded: LoadedRules | None = None) -> list[int]:
    """Evaluate every pending trading day in order with origin "live"; return ids of alerts opened.
    Without `inputs` it loads its own: first the last _COARSE_DAYS only, the whole history only when
    that is too short to count the window's rows (both fetch FRED and store `fred_errors`)."""
    loaded = loaded or get_rules()
    rules, version = loaded.rules, loaded.version
    if store.get_state(f"backfill:{version}") not in BACKFILL_COMPLETE:
        return []
    live_start = date.fromisoformat(store.get_state(f"live_start:{version}"))
    last = store.last_evaluated(version)
    coarse = None
    if inputs is None:
        coarse = (last or live_start) - timedelta(days=_COARSE_DAYS)
        inputs = _load_live(now, loaded, coarse)
    pending = [d for d in _calendar(inputs) if d >= live_start and (last is None or d > last)]
    until = _latest_evaluable(inputs, pending, now, rules)
    if until is not None:
        stored_alert, stored_surges = store.open_alert(version), store.open_surge_events(version)
        start = live_window_start(inputs, rules, pending[0], stored_alert, stored_surges)
        if coarse is not None and coarse > rules.history_start and start <= _calendar(inputs)[0]:
            # the coarse load was too short to count the window's rows: read the whole history
            inputs = _load_live(now, loaded, None)
            start = live_window_start(inputs, rules, pending[0], stored_alert, stored_surges)
        inputs = _since(inputs, start)
    replay_key = f"replayed_through:{version}"
    raw = store.get_state(replay_key)
    replayed = date.fromisoformat(raw) if raw else None
    opened: list[int] = []
    res = None
    day_inputs = inputs
    for day in (d for d in pending if until is not None and d <= until):
        day_inputs = _truncate(inputs, day)
        stored = store.open_alert(version)
        surge_state, surge_ids = _stored_surge_state(version, _calendar(day_inputs)[0])
        res = _evaluate(day_inputs, rules, day, day, _rebuild(stored) if stored is not None else None,
                        surge_state)
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
            _persist_surge_live(res, result, surge_ids, version, day_inputs, rules)
            store.save_movers(version, day, result.movers, inputs.themes)
            store.save_day(result, version, "live", coverage(inputs.closes, inputs.themes, day, rules),
                           now.isoformat())
        if stored is None and alert_id is not None and (replayed is None or res.open.start > replayed):
            opened.append(alert_id)
    if replayed is not None and (store.last_evaluated(version) or date.min) >= replayed:
        store.delete_state(replay_key)  # the replay has passed every day evaluated before the rebuild
    if res is not None:
        _fill_outcomes(version, res.levels, _on_calendar(day_inputs))
        _fill_surge_outcomes(version, _surge_levels(res, day_inputs))
    return opened
