"""Evaluator service: backfill, live, coverage wait, rules change, outcomes. Each docstring names the
mutation its test catches. The DB is seeded from tests/fixtures/risk; nothing touches the network."""
from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pandas as pd
import pytest

from apps.api.services import db as db_service
from apps.api.services.db import get_db
from apps.api.services.risk import evaluator, store, sweep
from apps.api.services.risk.inputs import load_inputs
from apps.api.services.risk.rules import LoadedRules, get_rules
from packages.core_finance.risk_signals.decks import forward_returns
from packages.core_finance.risk_signals.evaluate import evaluate_range

FIX = Path(__file__).resolve().parents[2] / "fixtures" / "risk"
NOW = datetime(2026, 10, 19, 1, 0, tzinfo=UTC)
OPEN_DAY = date(2026, 10, 8)
LAST_DAY = date(2026, 10, 16)


def _loaded(version: str, eval_start: date = date(2026, 6, 1)) -> LoadedRules:
    return LoadedRules(get_rules().rules.model_copy(update={"eval_start": eval_start}), version)


def _seed() -> None:
    px = pd.read_csv(FIX / "closes.csv", index_col="date")
    bars = [(t, d, float(v)) for t in px.columns for d, v in px[t].dropna().items()]
    shares = pd.read_csv(FIX / "shares.csv")
    themes = pd.read_csv(FIX / "themes.csv")
    with get_db() as conn:
        conn.executemany("INSERT INTO stocks (ticker, date, close) VALUES (?, ?, ?)", bars)
        conn.executemany(
            "INSERT INTO corporate_quote_facts (ticker, shares_outstanding, fetched_at) VALUES (?, ?, 'fixture')",
            [(r.ticker, float(r.shares)) for r in shares.itertuples()])
        conn.executemany(
            "INSERT INTO watchlist (ticker, name, theme, group_name, weight) VALUES (?, ?, ?, 'custom', 0.0)",
            [(r.ticker, r.ticker, r.theme) for r in themes.itertuples()])
        for f in sorted((FIX / "fred").glob("*.csv")):
            obs = pd.read_csv(f)
            conn.executemany(
                "INSERT INTO fred_cache (series_id, obs_date, value, fetched_at) VALUES (?, ?, ?, 'fixture')",
                [(f.stem, r.date, float(r.value)) for r in obs.itertuples()])


@pytest.fixture(autouse=True)
def _seeded():
    _seed()


@pytest.fixture
def sweeps(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(sweep, "ensure_deep_history",
                        lambda tickers, **kw: calls.append("deep") or sweep.SweepReport())
    monkeypatch.setattr(sweep, "ensure_quote_facts",
                        lambda tickers, now, **kw: calls.append("facts") or sweep.SweepReport())
    return calls


def _inputs(loaded: LoadedRules, through: date | None = None):
    return load_inputs(through=through, fetch_fred=False, loaded=loaded)


def _snapshot(version: str) -> list:
    """Everything persisted for a version, without ids and wall-clock stamps."""
    out = []
    for origin in ("backfill", "live"):
        for a in store.list_alerts(version, origin, 100):
            out.append((a.origin, a.status, a.start_date, a.release_date, a.release_reason, a.primary_theme,
                        a.w1_proxy, a.trigger, a.stints, sorted(a.cards.items())))
    with get_db() as conn:
        days = [tuple(r) for r in conn.execute(
            "SELECT date, origin, warnings_json, confirming_json, sox_confirming, cap_share, bars_coverage "
            "FROM risk_daily WHERE rules_version = ? ORDER BY date", (version,))]
    return [out, days]


def _daily_origin(version: str) -> dict[date, str]:
    with get_db() as conn:
        rows = conn.execute("SELECT date, origin FROM risk_daily WHERE rules_version = ?", (version,)).fetchall()
    return {date.fromisoformat(r["date"]): r["origin"] for r in rows}


def test_backfill_then_live_continue_open_alert(sweeps):
    """Catches: live days not continuing the stored alert (a second alert opens, or the backfill one is
    re-tagged live); last_ref not persisted or not rebuilt (nuclear_uranium/analog stints diverge from the
    one-pass walk); latest cards not refreshed; backfill running past live_start - 1."""
    L = _loaded("test0001")
    inp = _inputs(L)
    store.set_state("live_start:test0001", "2026-10-12")

    evaluator.run_backfill(NOW, inputs=inp, loaded=L)
    assert store.get_state("backfill:test0001") == "done"
    assert store.last_evaluated("test0001") == date(2026, 10, 9)
    [alert] = store.list_alerts("test0001", "backfill", 10)
    assert (alert.start_date, alert.status) == (OPEN_DAY, "open")

    assert evaluator.evaluate_pending(NOW, inputs=inp, loaded=L) == []

    assert store.list_alerts("test0001", "live", 10) == []
    after = store.get_alert(alert.id)
    assert after is not None
    assert (after.origin, after.status) == ("backfill", "open")
    origins = _daily_origin("test0001")
    assert {d: o for d, o in origins.items() if d >= date(2026, 10, 12)} == {
        date(2026, 10, d): "live" for d in (12, 13, 14, 15, 16)}
    assert set(origins.values()) == {"backfill", "live"}

    batch = evaluate_range(inp.closes, inp.sox, inp.rsp, inp.shares, inp.themes, inp.fred, L.rules,
                           start=L.rules.eval_start, end=LAST_DAY)
    want = sorted((s.theme, s.via, s.joined, s.left, s.last_ref) for s in batch.open.stints)
    got = sorted((s.theme, s.via, s.joined_date, s.left_date, s.last_ref) for s in after.stints)
    assert got == want
    assert any(s.last_ref not in (s.joined, LAST_DAY) for s in batch.open.stints)  # not vacuous
    assert after.trigger == batch.open.trigger
    assert {c.as_of for c in after.cards[("latest", "crash")]} == {LAST_DAY}
    assert {c.as_of for c in after.cards[("start", "crash")]} == {OPEN_DAY}


def test_backfill_idempotent(sweeps):
    """Catches a run_backfill that does not return at once on `done` (it would purge and re-insert,
    changing the alert ids) or that changes any persisted value on a second call."""
    L = _loaded("test0001")
    inp = _inputs(L)
    store.set_state("live_start:test0001", "2026-10-12")
    evaluator.run_backfill(NOW, inputs=inp, loaded=L)
    first, ids = _snapshot("test0001"), [a.id for a in store.list_alerts("test0001", "backfill", 10)]

    evaluator.run_backfill(NOW + timedelta(hours=1), inputs=inp, loaded=L)

    assert _snapshot("test0001") == first
    assert [a.id for a in store.list_alerts("test0001", "backfill", 10)] == ids
    assert sweeps == ["deep", "facts"]  # a done backfill does not sweep again
    assert first[0] and first[1]  # not vacuous


def test_restart_mid_backfill_same_result(sweeps, monkeypatch, tmp_path):
    """Catches a backfill that does not purge its version before re-evaluating (a rerun after a crash
    would duplicate the alerts written before the crash), or one that marks itself done on failure."""
    L = _loaded("test0001", eval_start=date(2026, 3, 2))
    real_path = db_service._DB_PATH

    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "clean.db")
    db_service.init_db()
    _seed()
    store.set_state("live_start:test0001", "2026-10-16")
    evaluator.run_backfill(NOW, inputs=_inputs(L), loaded=L)
    clean = _snapshot("test0001")
    assert len(clean[0]) == 2 and len(clean[1]) > 100  # an earlier closed alert, the 10-08 open one

    monkeypatch.setattr(db_service, "_DB_PATH", real_path)  # seeded by the autouse fixture
    store.set_state("live_start:test0001", "2026-10-16")
    real_save, calls = store.save_day, []

    def flaky(*args, **kwargs):
        calls.append(1)
        if len(calls) > 100:
            raise RuntimeError("disk full")
        real_save(*args, **kwargs)

    monkeypatch.setattr(store, "save_day", flaky)
    evaluator.run_backfill(NOW, inputs=_inputs(L), loaded=L)
    assert store.get_state("backfill:test0001") == "failed"
    assert len(_snapshot("test0001")[1]) == 100

    monkeypatch.setattr(store, "save_day", real_save)
    evaluator.run_backfill(NOW, inputs=_inputs(L), loaded=L)
    assert store.get_state("backfill:test0001") == "done"
    assert _snapshot("test0001") == clean


def test_coverage_wait_then_evaluate_after_24h(sweeps):
    """Catches: evaluating a day under min_share before the wait; the wait not recorded; a wait counted
    from each call instead of the first; `>=` instead of more-than wait_hours; the waived day not storing
    its real coverage; the wait waiving a missing RSP bar."""
    L = _loaded("test0001")
    short = date(2026, 10, 16)
    with get_db() as conn:
        themed = [r["ticker"] for r in conn.execute(
            "SELECT ticker FROM watchlist WHERE theme NOT IN ('', 'defensives_other') ORDER BY ticker")]
        conn.executemany("DELETE FROM stocks WHERE ticker = ? AND date = ?",
                         [(t, short.isoformat()) for t in themed[: len(themed) // 5]])
    inp = _inputs(L)
    store.set_state("live_start:test0001", "2026-10-12")
    evaluator.run_backfill(NOW, inputs=inp, loaded=L)

    evaluator.evaluate_pending(NOW, inputs=inp, loaded=L)
    assert store.last_evaluated("test0001") == date(2026, 10, 15)
    assert store.get_state("coverage_wait:2026-10-16") == NOW.isoformat()

    for hours in (23, 24):
        evaluator.evaluate_pending(NOW + timedelta(hours=hours), inputs=inp, loaded=L)
        assert store.last_evaluated("test0001") == date(2026, 10, 15), hours

    evaluator.evaluate_pending(NOW + timedelta(hours=25), inputs=inp, loaded=L)
    day = store.latest_day("test0001")
    assert day.date == short
    assert 0.75 < day.bars_coverage < L.rules.coverage.min_share

    no_rsp = type(inp)(**{**inp.__dict__, "rsp": inp.rsp.drop(pd.Timestamp(short))})
    assert evaluator.evaluable_day(no_rsp, short, NOW + timedelta(hours=48), L.rules)[0] is False


def test_rules_change_closes_old_live_and_rebackfills(sweeps):
    """Catches: closing old alerts after the purge (release_date falls back to the start day); purging old
    live alerts; keeping old backfill alerts or risk_daily rows; the new version not re-backfilling the old
    live days; a backfill that does not run the sweeps; evaluate_pending not returning opened ids."""
    old, new = _loaded("old00000", date(2026, 3, 2)), _loaded("new11111", date(2026, 3, 2))
    inp = _inputs(old)
    store.set_state("live_start:old00000", OPEN_DAY.isoformat())
    evaluator.run_backfill(NOW, inputs=inp, loaded=old)
    assert sweeps == ["deep", "facts"]
    opened = evaluator.evaluate_pending(NOW, inputs=inp, loaded=old)
    [live] = store.list_alerts("old00000", "live", 10)
    assert opened == [live.id] and live.start_date == OPEN_DAY and live.status == "open"
    assert len(store.list_alerts("old00000", "backfill", 10)) == 1

    evaluator.run_backfill(NOW + timedelta(days=1), inputs=inp, loaded=new)

    kept = store.get_alert(live.id)
    assert kept is not None, "the old version's live alert was purged"
    assert (kept.status, kept.release_date, kept.release_reason) == ("released", LAST_DAY, "rules_changed")
    assert store.list_alerts("old00000", "backfill", 10) == []
    assert store.last_evaluated("old00000") is None
    assert store.get_state("live_start:new11111") == LAST_DAY.isoformat()
    redone = store.list_alerts("new11111", "backfill", 10)
    assert [(a.start_date, a.status) for a in redone] == [(OPEN_DAY, "open"), (date(2026, 3, 27), "released")]
    assert store.last_evaluated("new11111") == date(2026, 10, 15)
    assert sweeps == ["deep", "facts", "deep", "facts"]  # every backfill not yet done sweeps


def test_outcomes_filled_later(sweeps):
    """Catches: no outcome pass after live days (start-card fwd5 stays None); writing max_dd10 from a
    partial 10-row window; computing fwd from the wrong base day or series."""
    L = _loaded("test0001")
    early, full = _inputs(L, through=date(2026, 10, 14)), _inputs(L)
    store.set_state("live_start:test0001", "2026-10-12")
    evaluator.run_backfill(NOW, inputs=early, loaded=L)
    evaluator.evaluate_pending(NOW, inputs=early, loaded=L)
    [alert] = store.list_alerts("test0001", "backfill", 10)
    assert all(s.fwd5 is None for s in alert.stints if s.joined_date == OPEN_DAY)
    assert all(c.fwd5 is None for c in alert.cards[("start", "crash")])

    evaluator.evaluate_pending(NOW, inputs=full, loaded=L)

    alert = store.get_alert(alert.id)
    levels = evaluate_range(full.closes, full.sox, full.rsp, full.shares, full.themes, full.fred, L.rules,
                            start=OPEN_DAY, end=OPEN_DAY).levels
    first = [s for s in alert.stints if s.joined_date == OPEN_DAY]
    assert first
    for s in first:
        assert s.fwd5 == pytest.approx(forward_returns(levels[s.theme], OPEN_DAY)["fwd5"]), s.theme
        assert (s.fwd10, s.fwd20, s.max_dd10) == (None, None, None), s.theme
    cards = alert.cards[("start", "crash")]
    assert cards
    for c in cards:
        col = full.closes[c.ticker]
        want = (col[pd.Timestamp("2026-10-15")] / col[pd.Timestamp(OPEN_DAY)] - 1) * 100
        assert c.fwd5 == pytest.approx(want), c.ticker
        assert c.fwd10 is None


def test_failed_live_day_is_retried_whole(sweeps, monkeypatch):
    """Catches a live day whose risk_daily row is written before (or outside one transaction with) its
    alert writes: a failure on the open day would mark the day evaluated with the alert missing or left
    without its start cards, and the retry would not redo it."""
    L = _loaded("test0001")
    inp = _inputs(L)
    store.set_state("live_start:test0001", OPEN_DAY.isoformat())
    evaluator.run_backfill(NOW, inputs=inp, loaded=L)
    backfilled = store.last_evaluated("test0001")
    real, failed = store.replace_cards, []

    def flaky(alert_id, snapshot, deck, cards, as_of):
        if snapshot == "start" and not failed:
            failed.append(as_of)
            raise RuntimeError("disk full")
        real(alert_id, snapshot, deck, cards, as_of)

    monkeypatch.setattr(store, "replace_cards", flaky)
    with pytest.raises(RuntimeError):
        evaluator.evaluate_pending(NOW, inputs=inp, loaded=L)
    assert failed == [OPEN_DAY]
    assert store.last_evaluated("test0001") == backfilled
    assert store.list_alerts("test0001", "live", 10) == []

    opened = evaluator.evaluate_pending(NOW, inputs=inp, loaded=L)

    [alert] = store.list_alerts("test0001", "live", 10)
    assert opened == [alert.id] and alert.start_date == OPEN_DAY
    assert alert.cards[("start", "crash")] and alert.cards[("start", "crash")][0].as_of == OPEN_DAY
    assert store.last_evaluated("test0001") == LAST_DAY
    assert set(_daily_origin("test0001").values()) == {"backfill", "live"}


def test_degraded_backfill_runs_live_then_recomputes_to_done(sweeps, monkeypatch, tmp_path):
    """Ruling R26. Catches: a backfill with an empty warning series frozen as "done"; evaluate_pending
    skipping a degraded version (no live alert); a degraded rerun that returns early instead of purging,
    sweeping and recomputing; live_start moved by the rerun; a rerun that keeps the degraded pass's live
    alerts and days (duplicates, or rows that differ from a clean done run)."""
    L = _loaded("test0001")
    real_path = db_service._DB_PATH
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "clean.db")
    db_service.init_db()
    _seed()
    store.set_state("live_start:test0001", OPEN_DAY.isoformat())
    evaluator.run_backfill(NOW, inputs=_inputs(L), loaded=L)
    assert store.get_state("backfill:test0001") == "done"
    evaluator.evaluate_pending(NOW, inputs=_inputs(L), loaded=L)
    clean = _snapshot("test0001")
    assert any(a[0] == "live" for a in clean[0])  # not vacuous: the live pass opens an alert

    monkeypatch.setattr(db_service, "_DB_PATH", real_path)
    full = _inputs(L)
    no_dgs10 = replace(full, fred={**full.fred, "DGS10": pd.Series(dtype=float)})
    store.set_state("live_start:test0001", OPEN_DAY.isoformat())
    evaluator.run_backfill(NOW, inputs=no_dgs10, loaded=L)
    assert store.get_state("backfill:test0001") == "degraded"
    opened = evaluator.evaluate_pending(NOW, inputs=no_dgs10, loaded=L)
    assert len(opened) == 1 and store.last_evaluated("test0001") == LAST_DAY

    evaluator.run_backfill(NOW + timedelta(hours=1), inputs=full, loaded=L)
    assert store.get_state("backfill:test0001") == "done"
    assert store.get_state("live_start:test0001") == OPEN_DAY.isoformat()
    assert sweeps == ["deep", "facts", "deep", "facts", "deep", "facts"]
    # The one rebuild replays the live days; the alert it reopens existed before, so it is not "opened".
    assert evaluator.evaluate_pending(NOW + timedelta(hours=1), inputs=full, loaded=L) == []
    assert _snapshot("test0001") == clean
    assert store.get_state("replayed_through:test0001") is None
    ids = [a.id for o in ("backfill", "live") for a in store.list_alerts("test0001", o, 10)]
    evaluator.run_backfill(NOW + timedelta(hours=2), inputs=full, loaded=L)  # done: no second rebuild
    assert [a.id for o in ("backfill", "live") for a in store.list_alerts("test0001", o, 10)] == ids


def _ids(version: str) -> list[int]:
    return [a.id for o in ("backfill", "live") for a in store.list_alerts(version, o, 100)]


def test_still_degraded_rerun_touches_nothing(sweeps):
    """Spec section 7. Catches a degraded rerun that purges and replays while the condition still holds
    (alert ids change, live days are re-written), or one that skips the sweeps."""
    L = _loaded("test0001")
    full = _inputs(L)
    no_dgs10 = replace(full, fred={**full.fred, "DGS10": pd.Series(dtype=float)})
    store.set_state("live_start:test0001", OPEN_DAY.isoformat())
    evaluator.run_backfill(NOW, inputs=no_dgs10, loaded=L)
    evaluator.evaluate_pending(NOW, inputs=no_dgs10, loaded=L)
    before, ids = _snapshot("test0001"), _ids("test0001")
    assert any(a[0] == "live" for a in before[0])  # not vacuous: there is a live alert to lose

    for hours in (1, 2):
        evaluator.run_backfill(NOW + timedelta(hours=hours), inputs=no_dgs10, loaded=L)
        assert store.get_state("backfill:test0001") == "degraded"
        assert evaluator.evaluate_pending(NOW + timedelta(hours=hours), inputs=no_dgs10, loaded=L) == []
        assert _ids("test0001") == ids and _snapshot("test0001") == before
    assert sweeps == ["deep", "facts"] * 3


def test_degraded_rerun_failing_before_rebuild_stays_degraded(sweeps, monkeypatch):
    """Catches a degraded rerun whose failure (here a sweep raising) is recorded as "failed": the next
    run would then purge and replay the live alerts although no rebuild happened."""
    L = _loaded("test0001")
    full = _inputs(L)
    no_dgs10 = replace(full, fred={**full.fred, "DGS10": pd.Series(dtype=float)})
    store.set_state("live_start:test0001", OPEN_DAY.isoformat())
    evaluator.run_backfill(NOW, inputs=no_dgs10, loaded=L)
    evaluator.evaluate_pending(NOW, inputs=no_dgs10, loaded=L)
    ids = _ids("test0001")

    def boom(*a, **kw):
        raise RuntimeError("provider down")

    monkeypatch.setattr(sweep, "ensure_quote_facts", boom)
    evaluator.run_backfill(NOW + timedelta(hours=1), inputs=no_dgs10, loaded=L)
    assert store.get_state("backfill:test0001") == "degraded"
    assert _ids("test0001") == ids


def test_older_pending_day_is_waived_on_its_own_clock(sweeps):
    """Catches waits deleted below the newest pending day: D (10-15) waits from NOW, D+1 (10-16) from
    NOW+12h; at NOW+25h D must be evaluated on its own 24-hour wait, not starve behind D+1's."""
    L = _loaded("test0001")
    with get_db() as conn:
        themed = [r["ticker"] for r in conn.execute(
            "SELECT ticker FROM watchlist WHERE theme NOT IN ('', 'defensives_other') ORDER BY ticker")]
        conn.executemany("DELETE FROM stocks WHERE ticker = ? AND date = ?",
                         [(t, d) for t in themed[: len(themed) // 5] for d in ("2026-10-15", "2026-10-16")])
    store.set_state("live_start:test0001", "2026-10-12")
    evaluator.run_backfill(NOW, inputs=_inputs(L), loaded=L)

    evaluator.evaluate_pending(NOW, inputs=_inputs(L, through=date(2026, 10, 15)), loaded=L)
    assert store.last_evaluated("test0001") == date(2026, 10, 14)
    later = NOW + timedelta(hours=12)
    evaluator.evaluate_pending(later, inputs=_inputs(L), loaded=L)
    assert store.last_evaluated("test0001") == date(2026, 10, 14)
    assert _waits() == {"coverage_wait:2026-10-15": NOW.isoformat(), "coverage_wait:2026-10-16": later.isoformat()}

    evaluator.evaluate_pending(NOW + timedelta(hours=25), inputs=_inputs(L), loaded=L)
    assert store.last_evaluated("test0001") == date(2026, 10, 15)


@pytest.mark.parametrize("which", ["ensure_deep_history", "ensure_quote_facts"])
def test_sweep_failure_marks_backfill_degraded(sweeps, monkeypatch, which):
    """Catches a backfill marked "done" although a sweep reported failed tickers, or one sweep's
    report ignored."""
    L = _loaded("test0001")
    monkeypatch.setattr(sweep, which, lambda *a, **kw: sweep.SweepReport(1, 0, ["NVDA"]))
    store.set_state("live_start:test0001", "2026-10-12")
    evaluator.run_backfill(NOW, inputs=_inputs(L), loaded=L)
    assert store.get_state("backfill:test0001") == "degraded"


def test_live_continuation_closes_like_one_pass(sweeps):
    """The backfill leaves the 2026-03-27 alert open at live_start 2026-04-01; live days close it.
    Catches _rebuild dropping the stored last_ref (the quiet-day count restarts at joined, so themes
    leave and the alert releases earlier than the one-pass walk), or a live close that writes a
    different release or stint left dates."""
    L = _loaded("test0001", eval_start=date(2026, 3, 2))
    inp = _inputs(L, through=date(2026, 4, 10))
    store.set_state("live_start:test0001", "2026-04-01")
    evaluator.run_backfill(NOW, inputs=inp, loaded=L)
    [alert] = store.list_alerts("test0001", "backfill", 10)
    assert (alert.start_date, alert.status) == (date(2026, 3, 27), "open")
    assert any(s.last_ref not in (None, s.joined_date) for s in alert.stints)  # last_ref matters

    evaluator.evaluate_pending(NOW, inputs=inp, loaded=L)

    batch = evaluate_range(inp.closes, inp.sox, inp.rsp, inp.shares, inp.themes, inp.fred, L.rules,
                           start=L.rules.eval_start, end=date(2026, 4, 10))
    [record] = [r for r in batch.closed if r.start == date(2026, 3, 27)]
    after = store.get_alert(alert.id)
    assert (after.status, after.release_date, after.release_reason) == ("released", record.release, record.reason)
    assert record.release == date(2026, 4, 7)
    assert sorted((s.theme, s.joined_date, s.left_date) for s in after.stints) == sorted(
        (s.theme, s.joined, s.left) for s in record.stints)
    assert all(a.start_date > record.release for a in store.list_alerts("test0001", "live", 10))


def _waits() -> dict[str, str]:
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM risk_state WHERE key LIKE 'coverage%'").fetchall()
    return {r["key"]: r["value"] for r in rows}


def test_coverage_wait_recorded_only_for_the_newest_day(sweeps):
    """Catches a wait key written for every unevaluable day walked over (10-14 and 10-15 here), or a
    stale wait for an older day left in risk_state."""
    L = _loaded("test0001")
    with get_db() as conn:
        themed = [r["ticker"] for r in conn.execute(
            "SELECT ticker FROM watchlist WHERE theme NOT IN ('', 'defensives_other') ORDER BY ticker")]
        conn.executemany("DELETE FROM stocks WHERE ticker = ? AND date = ?",
                         [(t, d) for t in themed[: len(themed) // 5] for d in ("2026-10-14", "2026-10-15", "2026-10-16")])
    inp = _inputs(L)
    store.set_state("live_start:test0001", "2026-10-12")
    evaluator.run_backfill(NOW, inputs=inp, loaded=L)
    store.set_state("coverage_wait:2026-10-01", "2026-10-01T01:00:00+00:00")

    evaluator.evaluate_pending(NOW, inputs=inp, loaded=L)

    assert store.last_evaluated("test0001") == date(2026, 10, 13)
    assert _waits() == {"coverage_wait:2026-10-16": NOW.isoformat()}


def test_backfill_persists_surge_and_movers(sweeps):
    """Catches: surge events not stored, or with the wrong end/last_high/overheated_on; `shown` taken from
    another day than the start; components not the start day's; leaders not the top 5 members by 5-row
    return (wrong order, wrong window, ^SOX without the semis members); outcomes not filled, max_runup10
    as a drawdown or filled from a partial window; last confirmations not stored; movers missing a day
    or stored without their theme; risk_daily surge columns empty."""
    L = _loaded("test0001")
    inp = _inputs(L)
    end = date(2026, 10, 9)
    store.set_state("live_start:test0001", "2026-10-12")
    evaluator.run_backfill(NOW, inputs=inp, loaded=L)

    batch = evaluate_range(inp.closes, inp.sox, inp.rsp, inp.shares, inp.themes, inp.fred, L.rules,
                           start=L.rules.eval_start, end=end)
    by_day = {d.day: d for d in batch.days}
    events = [*batch.surge_closed, *batch.surge_state.open.values()]
    stored = {(e.theme, e.start_date): e for e in store.list_surge("test0001", None, None, 100)}
    assert events and sorted(stored) == sorted((e.theme, e.start) for e in events)
    cal = inp.sox.index
    px = inp.closes.reindex(cal)
    levels = batch.levels.assign(**{"^SOX": inp.sox})
    semis = set(L.rules.semis_themes)
    settled = 0
    for e in events:
        s = stored[(e.theme, e.start)]
        assert (s.origin, s.end_date, s.end_reason, s.last_high_date, s.overheated_on) == (
            "backfill", e.end, e.end_reason, e.last_high, e.overheated_on), e
        assert s.shown == by_day[e.start].surge_shown[e.theme]
        assert s.components == by_day[e.start].surge[e.theme]
        members = [t for t in px.columns if t in inp.shares and (
            inp.themes.get(t) in semis if e.theme == "^SOX" else inp.themes.get(t) == e.theme)]
        i = cal.get_loc(pd.Timestamp(e.start))
        r5 = (px.iloc[i][members] / px.iloc[i - 5][members] - 1).dropna().sort_values(ascending=False)
        assert [x["ticker"] for x in s.leaders] == list(r5.index[:5])
        assert [x["return5_pct"] for x in s.leaders] == pytest.approx(list(r5.iloc[:5] * 100), rel=1e-12)
        v = levels[e.theme].to_numpy()
        fwd = {h: (v[i + h] / v[i] - 1) * 100 if i + h < len(v) else None for h in (5, 10, 20)}
        runup = (max(v[i + 1 : i + 11]) / v[i] - 1) * 100 if fwd[10] is not None else None
        for h in (5, 10, 20):
            assert getattr(s, f"fwd{h}") == (pytest.approx(fwd[h], rel=1e-12) if fwd[h] is not None else None)
        assert s.max_runup10 == (pytest.approx(runup, rel=1e-12) if runup is not None else None)
        settled += runup is not None and runup > max(fwd[10], 0.0)
    assert settled  # not vacuous: a run-up above both the 10-row return and zero
    assert any(stored[k].max_runup10 is None for k in stored)  # and one still inside its 10-row window
    assert store.last_confirms("test0001") == batch.surge_state.last_confirm

    got = [(m.date, m.rank, m.ticker, m.theme, m.return_pct, m.close, m.return5_pct, m.rsi)
           for m in store.list_movers("test0001", L.rules.eval_start, end)]
    want = [(d.day, m.rank, m.ticker, inp.themes.get(m.ticker, ""), m.return_pct, m.close, m.return5_pct, m.rsi)
            for d in batch.days for m in d.movers]
    assert got == want and len({g[0] for g in got}) == len(batch.days)
    day = store.get_day("test0001", events[0].start)
    assert (day.surge, day.surge_banner, day.surge_cap_share) == (
        by_day[events[0].start].surge, by_day[events[0].start].surge_banner,
        by_day[events[0].start].surge_cap_share)


def test_rules_version_bump_recomputes_once(sweeps):
    """Review Focus 4. A new rules version with the same values rebuilds the old version's alerts,
    surge events and movers once. Catches: the new backfill not persisting surge events or movers;
    surge state carried over from the old version; a second run_backfill recomputing (ids change);
    the old version's backfill surge rows, surge_state or movers left behind."""
    old, new = _loaded("old00000", date(2026, 3, 2)), _loaded("new11111", date(2026, 3, 2))
    inp = _inputs(old)
    store.set_state("live_start:old00000", OPEN_DAY.isoformat())
    evaluator.run_backfill(NOW, inputs=inp, loaded=old)
    evaluator.evaluate_pending(NOW, inputs=inp, loaded=old)

    def alerts(v):
        return sorted((a.start_date, a.release_date, a.release_reason, a.trigger)
                      for o in ("backfill", "live") for a in store.list_alerts(v, o, 100))

    def surges(v):
        return sorted((e.theme, e.start_date, e.end_date, e.end_reason, e.shown, e.last_high_date, e.fwd5,
                       e.fwd10, e.fwd20, e.max_runup10, e.leaders) for e in store.list_surge(v, None, None, 100))

    def movers(v):
        return [(m.date, m.rank, m.ticker) for m in store.list_movers(v, date(2026, 3, 2), LAST_DAY)]

    before = (alerts("old00000"), surges("old00000"), movers("old00000"), store.last_confirms("old00000"))
    assert before[0] and before[1] and before[3]  # not vacuous

    evaluator.run_backfill(NOW + timedelta(days=1), inputs=inp, loaded=new)
    evaluator.evaluate_pending(NOW + timedelta(days=1), inputs=inp, loaded=new)
    after = (alerts("new11111"), surges("new11111"), movers("new11111"), store.last_confirms("new11111"))
    assert after == before
    assert {e.origin for e in store.list_surge("old00000", None, None, 100)} <= {"live"}
    assert store.last_confirms("old00000") == {} and movers("old00000") == []

    ids = (_ids("new11111"), [e.id for e in store.list_surge("new11111", None, None, 100)])
    evaluator.run_backfill(NOW + timedelta(days=2), inputs=inp, loaded=new)
    assert (_ids("new11111"), [e.id for e in store.list_surge("new11111", None, None, 100)]) == ids


POWER = "power_producers"  # surge event 2026-10-06..2026-10-14 in this fixture, new high on 10-07


def test_stored_last_confirm_blocks_a_live_start(sweeps):
    """Catches live days that ignore the stored last confirmations: a confirmation 3 rows before
    power_producers' 10-06 confirm is inside event.gap, so no event may start on 10-06 or 10-07."""
    L = _loaded("test0001")
    inp = _inputs(L)
    store.set_state("live_start:test0001", "2026-10-06")
    evaluator.run_backfill(NOW, inputs=inp, loaded=L)
    assert not store.list_surge("test0001", None, POWER, 10)
    store.set_last_confirm("test0001", POWER, date(2026, 10, 1))

    evaluator.evaluate_pending(NOW, inputs=inp, loaded=L)

    assert store.last_evaluated("test0001") == LAST_DAY
    assert store.list_surge("test0001", None, POWER, 10) == []
    assert store.last_confirms("test0001")[POWER] == date(2026, 10, 7)


def test_live_updates_open_surge_event(sweeps):
    """Catches a live day that does not write an open event's new last_high back to the store (the next
    day would count the stall from the old high)."""
    L = _loaded("test0001")
    inp = _inputs(L, through=date(2026, 10, 9))
    store.set_state("live_start:test0001", "2026-10-07")
    evaluator.run_backfill(NOW, inputs=inp, loaded=L)
    [event] = store.list_surge("test0001", None, POWER, 10)
    assert (event.start_date, event.last_high_date, event.end_date) == (date(2026, 10, 6), date(2026, 10, 6), None)

    evaluator.evaluate_pending(NOW, inputs=inp, loaded=L)

    after = store.get_surge(event.id)
    assert (after.last_high_date, after.end_date, after.origin) == (date(2026, 10, 7), None, "backfill")


def test_live_load_reads_coarse_window_then_full_when_short(sweeps, monkeypatch):
    """Catches a live load that reads the whole history every day (no `since`), or that keeps a coarse
    load too short to count live_window_rows valid rows instead of reloading the full history (this
    fixture has under 400 rows)."""
    L = _loaded("test0001")
    store.set_state("live_start:test0001", "2026-10-12")
    evaluator.run_backfill(NOW, inputs=_inputs(L), loaded=L)
    calls = []

    def recording(**kw):
        calls.append(kw.get("since"))
        return load_inputs(**{**kw, "fetch_fred": False})

    monkeypatch.setattr(evaluator, "load_inputs", recording)
    evaluator.evaluate_pending(NOW, loaded=L)

    assert calls == [date(2026, 10, 9) - timedelta(days=evaluator._COARSE_DAYS), None]
    assert store.last_evaluated("test0001") == LAST_DAY
