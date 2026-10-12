import asyncio
import inspect
import logging
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from apps.api.services.signals import engine, schedule, store
from apps.api.services.signals.schedule import is_due, weekly_cutoff

KST = timezone(timedelta(hours=9))


def kst(*args):
    return datetime(*args, tzinfo=KST).astimezone(timezone.utc)


def test_cutoff_is_saturday_08_51_kst_of_the_same_iso_week():
    assert weekly_cutoff(kst(2026, 10, 7, 12)) == kst(2026, 10, 10, 8, 51)
    assert weekly_cutoff(kst(2026, 10, 11, 23, 59)) == kst(2026, 10, 10, 8, 51)


def test_monday_just_after_midnight_kst_belongs_to_the_new_week():
    # 00:30 KST Monday is still Sunday in UTC; the week must follow Seoul, not UTC.
    assert weekly_cutoff(kst(2026, 10, 12, 0, 30)) == kst(2026, 10, 17, 8, 51)


def test_no_snapshot_this_week_is_due_at_once():
    assert is_due(kst(2026, 10, 5, 0, 30), None) is True


def test_a_run_before_the_cutoff_is_redone_after_it():
    assert is_due(kst(2026, 10, 10, 9, 0), kst(2026, 10, 9, 20)) is True


def test_not_due_before_the_cutoff_or_after_a_post_cutoff_run():
    assert is_due(kst(2026, 10, 10, 8, 0), kst(2026, 10, 9, 20)) is False
    assert is_due(kst(2026, 10, 11, 12), kst(2026, 10, 10, 9, 0)) is False



def _cycle_env(monkeypatch, now, snapshot_run_at):
    monkeypatch.setattr(engine, "utc_now", lambda: now)
    snapshot = None if snapshot_run_at is None else SimpleNamespace(run_at=snapshot_run_at.isoformat())
    monkeypatch.setattr(store, "load_snapshot", lambda week: snapshot)


def test_cycle_runs_the_engine_when_due(monkeypatch):
    _cycle_env(monkeypatch, kst(2026, 10, 10, 9, 0), kst(2026, 10, 9, 20))
    calls = []

    def fake_run(*args, **kwargs):
        calls.append(1)
        raise asyncio.CancelledError  # not an Exception: stops the loop after the first call

    monkeypatch.setattr(engine, "run", fake_run)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(asyncio.wait_for(schedule.signal_cycle(interval_seconds=0), timeout=2))
    assert calls == [1]


def test_cycle_does_not_run_the_engine_when_not_due(monkeypatch):
    _cycle_env(monkeypatch, kst(2026, 10, 11, 12), kst(2026, 10, 10, 9, 0))
    calls = []

    async def stop_after_one_pass():
        task = asyncio.create_task(schedule.signal_cycle(interval_seconds=0))
        await asyncio.sleep(0.05)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    monkeypatch.setattr(engine, "run", lambda *a, **k: calls.append(1))
    asyncio.run(stop_after_one_pass())
    assert calls == []


def test_a_failed_run_is_logged_without_the_key_and_the_loop_continues(monkeypatch, caplog):
    _cycle_env(monkeypatch, kst(2026, 10, 10, 9, 0), None)
    calls = []

    def flaky_run(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("FRED unavailable")
        raise asyncio.CancelledError

    monkeypatch.setattr(engine, "run", flaky_run)
    monkeypatch.setenv("FRED_API_KEY", "SECRET-KEY-123")
    caplog.set_level(logging.ERROR, logger=schedule.logger.name)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(asyncio.wait_for(schedule.signal_cycle(interval_seconds=0), timeout=2))
    assert calls == [1, 1]
    assert "Signal cycle failed" in caplog.text
    assert "SECRET-KEY-123" not in caplog.text


def test_cancelling_the_cycle_stops_it_cleanly(monkeypatch):
    _cycle_env(monkeypatch, kst(2026, 10, 11, 12), kst(2026, 10, 10, 9, 0))

    async def run_and_cancel():
        task = asyncio.create_task(schedule.signal_cycle(interval_seconds=3600))
        await asyncio.sleep(0)
        task.cancel()
        await task

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run_and_cancel())


def test_exactly_at_the_cutoff_a_pre_cutoff_run_is_redone():
    assert is_due(kst(2026, 10, 10, 8, 51), kst(2026, 10, 9, 20)) is True


def test_a_run_stamped_exactly_at_the_cutoff_is_not_redone():
    assert is_due(kst(2026, 10, 10, 9, 0), kst(2026, 10, 10, 8, 51)) is False


def test_a_missing_snapshot_after_the_cutoff_is_due_at_startup():
    # The app starts on Sunday after the Saturday run was missed (machine was off).
    assert is_due(kst(2026, 10, 11, 12), None) is True


def test_the_cycle_looks_up_the_kst_week_not_the_utc_week(monkeypatch):
    # Monday 00:30 KST is Sunday 15:30 UTC; the snapshot to check is the new week's.
    monkeypatch.setattr(engine, "utc_now", lambda: kst(2026, 10, 12, 0, 30))
    weeks = []

    def load(week):
        weeks.append(week)
        return None

    monkeypatch.setattr(store, "load_snapshot", load)
    monkeypatch.setattr(engine, "run", lambda *a, **k: (_ for _ in ()).throw(asyncio.CancelledError()))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(asyncio.wait_for(schedule.signal_cycle(interval_seconds=0), timeout=2))
    assert weeks == ["2026-W42"]


def test_the_cycle_waits_the_interval_between_checks(monkeypatch):
    _cycle_env(monkeypatch, kst(2026, 10, 11, 12), kst(2026, 10, 10, 9, 0))
    checks = []
    not_due = SimpleNamespace(run_at=kst(2026, 10, 10, 9, 0).isoformat())
    monkeypatch.setattr(store, "load_snapshot", lambda week: checks.append(week) or not_due)

    async def one_interval():
        task = asyncio.create_task(schedule.signal_cycle(interval_seconds=3600))
        await asyncio.sleep(0.1)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    asyncio.run(one_interval())
    assert len(checks) == 1


def test_the_engine_run_does_not_block_the_event_loop(monkeypatch):
    import threading

    _cycle_env(monkeypatch, kst(2026, 10, 10, 9, 0), None)
    released_in_time = []

    def slow_run(*args, **kwargs):
        # Blocks like the real run (FRED fetch under _RUN_LOCK). The loop-side coroutine
        # below must be able to set `release` while this is still running.
        released_in_time.append(release.wait(timeout=2))
        raise asyncio.CancelledError

    release = threading.Event()
    monkeypatch.setattr(engine, "run", slow_run)

    async def main():
        task = asyncio.create_task(schedule.signal_cycle(interval_seconds=0))
        await asyncio.sleep(0.05)
        release.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    asyncio.run(main())
    assert released_in_time == [True]


def test_lifespan_starts_the_signal_cycle_only_when_startup_jobs_are_enabled(monkeypatch):
    from apps.api import main as api_main

    started = []

    async def fake_cycle(*args, **kwargs):
        started.append(1)
        await asyncio.Event().wait()

    async def fake_prewarm():
        return None

    async def drive(env_value):
        started.clear()
        monkeypatch.setattr(schedule, "signal_cycle", fake_cycle)
        monkeypatch.setattr(api_main, "stock_prewarm_cycle", fake_prewarm)
        if env_value is None:
            monkeypatch.delenv("MONEYVIEW_DISABLE_STARTUP_JOBS", raising=False)
        else:
            monkeypatch.setenv("MONEYVIEW_DISABLE_STARTUP_JOBS", env_value)
        async with api_main.lifespan(api_main.app):
            await asyncio.sleep(0.05)
        return list(started)

    assert asyncio.run(drive(None)) == [1]
    assert asyncio.run(drive("1")) == []


def test_the_default_cadence_is_hourly():
    default = inspect.signature(schedule.signal_cycle).parameters["interval_seconds"].default
    assert default == 3600.0


class _Clock:
    """Feeds one timestamp per loop pass (utc_now is read once per pass). When the
    script runs out, it cancels the loop, so each test stops itself."""

    def __init__(self, times):
        self._times = iter(times)
        self.current = None

    def __call__(self):
        try:
            self.current = next(self._times)
        except StopIteration:
            raise asyncio.CancelledError from None
        return self.current


def _drive_fred_retry(monkeypatch, times, failures_per_run, snapshots):
    """snapshots: week -> run_at (UTC). Each engine.run stamps the week's snapshot with the
    clock's current time and returns the next scripted failures list."""
    clock = _Clock(times)
    runs = []
    script = iter(failures_per_run)

    def fake_run(*args, **kwargs):
        runs.append(clock.current)
        week = store.iso_week(clock.current.astimezone(engine.KST).date())
        snapshots[week] = clock.current
        return SimpleNamespace(failures=next(script))

    monkeypatch.setattr(engine, "utc_now", clock)
    monkeypatch.setattr(engine, "run", fake_run)
    monkeypatch.setattr(
        store, "load_snapshot",
        lambda week: SimpleNamespace(run_at=snapshots[week].isoformat()) if week in snapshots else None,
    )
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(schedule.signal_cycle(interval_seconds=0))
    return runs


def test_a_post_cutoff_run_with_fred_errors_is_retried_on_the_next_check(monkeypatch):
    # W41 snapshot is from Friday, so Saturday 09:00 is the first due check.
    snapshots = {"2026-W41": kst(2026, 10, 9, 20)}
    times = [kst(2026, 10, 10, 9), kst(2026, 10, 10, 10), kst(2026, 10, 10, 11)]
    runs = _drive_fred_retry(monkeypatch, times, [["DGS10: HTTP 503"], ["DGS10: HTTP 503"], []], snapshots)
    assert runs == times


def test_a_retry_that_succeeds_stops_further_runs_that_week(monkeypatch):
    snapshots = {"2026-W41": kst(2026, 10, 9, 20)}
    times = [kst(2026, 10, 10, 9), kst(2026, 10, 10, 10), kst(2026, 10, 10, 11), kst(2026, 10, 10, 12),
             kst(2026, 10, 11, 9)]
    runs = _drive_fred_retry(monkeypatch, times, [["DGS10: HTTP 503"], []], snapshots)
    assert runs == [kst(2026, 10, 10, 9), kst(2026, 10, 10, 10)]


def test_fred_errors_are_not_retried_into_the_next_week(monkeypatch):
    # W42 already has a Monday snapshot, so it is not due before its own Saturday cutoff.
    snapshots = {"2026-W41": kst(2026, 10, 9, 20), "2026-W42": kst(2026, 10, 12, 9)}
    times = [kst(2026, 10, 10, 9), kst(2026, 10, 12, 12), kst(2026, 10, 12, 13)]
    runs = _drive_fred_retry(monkeypatch, times, [["DGS10: HTTP 503"]], snapshots)
    assert runs == [kst(2026, 10, 10, 9)]


def test_the_fred_error_strings_are_logged_as_a_warning(monkeypatch, caplog):
    snapshots = {"2026-W41": kst(2026, 10, 9, 20)}
    times = [kst(2026, 10, 10, 9), kst(2026, 10, 10, 10)]
    caplog.set_level(logging.WARNING, logger=schedule.logger.name)
    _drive_fred_retry(monkeypatch, times, [["DGS10: HTTP 503 upstream"], []], snapshots)
    assert "DGS10: HTTP 503 upstream" in caplog.text
    assert "WARNING" in caplog.text


def test_a_pre_cutoff_run_with_fred_errors_is_not_retried_before_the_cutoff(monkeypatch):
    # Monday 09:00 KST: the first run of W42 fails, and the 10:00 check is still before the
    # Saturday cutoff, so only the normal is_due rule may decide, and it does not fire.
    times = [kst(2026, 10, 12, 9), kst(2026, 10, 12, 10)]
    runs = _drive_fred_retry(monkeypatch, times, [["x"], []], {})
    assert runs == [kst(2026, 10, 12, 9)]


def _week_snapshot(auto_states, run_at):
    """A stored week whose automatic rules carry the given states (rule id -> state)."""
    results = [SimpleNamespace(rule_id=rule_id, state=state) for rule_id, state in auto_states.items()]
    return SimpleNamespace(run_at=run_at.isoformat(), results=results)


def _all_auto_stale(run_at):
    from apps.api.services.signals.models import get_rules

    return _week_snapshot({r.id: "stale" for r in get_rules().file.rules if r.kind != "manual"}, run_at)


def test_startup_reruns_a_week_whose_auto_rules_are_all_stale(monkeypatch):
    # Wednesday, before the cutoff: is_due is False, but every automatic rule is stale
    # (typically because FRED_API_KEY was missing), so a restart with the key set must refresh.
    now = kst(2026, 10, 7, 12)
    monkeypatch.setattr(engine, "utc_now", lambda: now)
    monkeypatch.setattr(store, "load_snapshot", lambda week: _all_auto_stale(kst(2026, 10, 5, 0, 30)))
    calls = []

    def fake_run(*args, **kwargs):
        calls.append(1)
        raise asyncio.CancelledError

    monkeypatch.setattr(engine, "run", fake_run)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(asyncio.wait_for(schedule.signal_cycle(interval_seconds=0), timeout=2))
    assert calls == [1]


def test_startup_does_not_rerun_a_week_with_one_auto_rule_judged(monkeypatch):
    from apps.api.services.signals.models import get_rules

    now = kst(2026, 10, 7, 12)
    monkeypatch.setattr(engine, "utc_now", lambda: now)
    auto_ids = [r.id for r in get_rules().file.rules if r.kind != "manual"]
    states = {rule_id: "stale" for rule_id in auto_ids}
    states[auto_ids[0]] = "not_triggered"
    monkeypatch.setattr(store, "load_snapshot", lambda week: _week_snapshot(states, kst(2026, 10, 5, 0, 30)))
    calls = []

    async def stop_after_one_pass():
        task = asyncio.create_task(schedule.signal_cycle(interval_seconds=0))
        await asyncio.sleep(0.05)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    monkeypatch.setattr(engine, "run", lambda *a, **k: calls.append(1))
    asyncio.run(stop_after_one_pass())
    assert calls == []


def test_the_all_stale_rerun_applies_only_to_the_first_check(monkeypatch):
    now = kst(2026, 10, 7, 12)
    monkeypatch.setattr(engine, "utc_now", lambda: now)
    monkeypatch.setattr(store, "load_snapshot", lambda week: _all_auto_stale(kst(2026, 10, 5, 0, 30)))
    calls = []

    def fake_run(*args, **kwargs):
        calls.append(1)   # the snapshot stays all-stale and no retry is pending
        return SimpleNamespace(failures=[])

    async def stop_after_several_passes():
        task = asyncio.create_task(schedule.signal_cycle(interval_seconds=0))
        await asyncio.sleep(0.05)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    monkeypatch.setattr(engine, "run", fake_run)
    asyncio.run(stop_after_several_passes())
    assert calls == [1]
