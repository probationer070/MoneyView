from datetime import datetime, timedelta, timezone

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


import asyncio  # noqa: E402
import logging  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402

from apps.api.services.signals import engine, schedule, store  # noqa: E402


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
        asyncio.run(schedule.signal_cycle(interval_seconds=0))
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
        asyncio.run(schedule.signal_cycle(interval_seconds=0))
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
