"""The cleanup runs once at startup unless MONEYVIEW_DISABLE_STARTUP_JOBS is set, then once per
CLEANUP_INTERVAL_SECONDS (spec 2026-10-15 §2.4). Drives apps/api/main.py's lifespan the way
tests/api/test_startup_jobs_gate.py does.
"""
from __future__ import annotations

import asyncio

import pytest

from apps.api import main as api_main
from apps.api.services import watchlist_cleanup


def _drive(monkeypatch, gate: str | None, interval: float) -> list[str]:
    calls: list[str] = []
    monkeypatch.setattr(watchlist_cleanup, "run_cleanup_logged", lambda: calls.append("cleanup"))
    monkeypatch.setattr(watchlist_cleanup, "CLEANUP_INTERVAL_SECONDS", interval)

    async def no_prewarm():
        return None

    monkeypatch.setattr(api_main, "stock_prewarm_cycle", no_prewarm)
    if gate is None:
        monkeypatch.delenv("MONEYVIEW_DISABLE_STARTUP_JOBS", raising=False)
    else:
        monkeypatch.setenv("MONEYVIEW_DISABLE_STARTUP_JOBS", gate)

    async def drive():
        async with api_main.lifespan(api_main.app):
            await asyncio.sleep(0.2)

    asyncio.run(drive())
    return calls


@pytest.mark.parametrize("gate", [None, "", "0", "false"])
def test_the_cleanup_runs_once_at_startup_unless_gated(monkeypatch, gate):
    calls = _drive(monkeypatch, gate, interval=3600)
    assert calls == ["cleanup"], f"expected exactly one startup cleanup, got {calls}"


@pytest.mark.parametrize("gate", ["1", "true", "yes"])
def test_the_startup_gate_skips_the_startup_run(monkeypatch, gate):
    calls = _drive(monkeypatch, gate, interval=3600)
    assert calls == [], f"MONEYVIEW_DISABLE_STARTUP_JOBS={gate} must skip the startup cleanup, got {calls}"


def test_the_cleanup_repeats_every_interval(monkeypatch):
    calls = _drive(monkeypatch, None, interval=0.02)
    assert len(calls) >= 3, f"the daily loop did not repeat: {calls}"


def test_the_daily_loop_runs_even_when_the_startup_run_is_gated(monkeypatch):
    calls = _drive(monkeypatch, "1", interval=0.02)
    assert len(calls) >= 2, f"the gate must skip only the startup run, got {calls}"


@pytest.mark.parametrize("gate", [None, "1"])
def test_a_raising_cleanup_does_not_stop_the_daily_loop(monkeypatch, gate):
    """The loop must survive a run that raises, at startup or later: one bad run cannot end the
    daily schedule for the life of the process."""
    calls: list[str] = []

    def flaky_cleanup():
        calls.append("cleanup")
        raise RuntimeError("simulated cleanup crash")

    monkeypatch.setattr(watchlist_cleanup, "run_cleanup_logged", flaky_cleanup)
    monkeypatch.setattr(watchlist_cleanup, "CLEANUP_INTERVAL_SECONDS", 0.02)

    async def no_prewarm():
        return None

    monkeypatch.setattr(api_main, "stock_prewarm_cycle", no_prewarm)
    if gate is None:
        monkeypatch.delenv("MONEYVIEW_DISABLE_STARTUP_JOBS", raising=False)
    else:
        monkeypatch.setenv("MONEYVIEW_DISABLE_STARTUP_JOBS", gate)

    async def drive():
        async with api_main.lifespan(api_main.app):
            await asyncio.sleep(0.2)

    asyncio.run(drive())
    assert len(calls) >= 3, f"a raising run stopped the daily loop: {calls}"


def test_the_daily_loop_does_not_block_startup(monkeypatch):
    """If the cycle were awaited inline, lifespan would never reach its body and this bound fails."""
    monkeypatch.setattr(watchlist_cleanup, "run_cleanup_logged", lambda: None)
    monkeypatch.setattr(watchlist_cleanup, "CLEANUP_INTERVAL_SECONDS", 3600)

    async def no_prewarm():
        return None

    monkeypatch.setattr(api_main, "stock_prewarm_cycle", no_prewarm)
    monkeypatch.delenv("MONEYVIEW_DISABLE_STARTUP_JOBS", raising=False)

    async def drive():
        cm = api_main.lifespan(api_main.app)
        await asyncio.wait_for(cm.__aenter__(), timeout=5)
        await cm.__aexit__(None, None, None)

    asyncio.run(drive())


def test_shutdown_cancels_the_loop_without_waiting_for_a_blocked_cleanup(monkeypatch):
    """A cleanup thread still running at shutdown must not hold lifespan exit, and the loop task
    must not survive it."""
    import threading

    release = threading.Event()
    monkeypatch.setattr(watchlist_cleanup, "run_cleanup_logged", lambda: release.wait(30))
    monkeypatch.setattr(watchlist_cleanup, "CLEANUP_INTERVAL_SECONDS", 0.01)

    async def no_prewarm():
        return None

    monkeypatch.setattr(api_main, "stock_prewarm_cycle", no_prewarm)
    monkeypatch.delenv("MONEYVIEW_DISABLE_STARTUP_JOBS", raising=False)

    async def drive():
        cm = api_main.lifespan(api_main.app)
        await cm.__aenter__()
        await asyncio.sleep(0.05)
        try:
            await asyncio.wait_for(cm.__aexit__(None, None, None), timeout=5)
            survivors = [
                t for t in asyncio.all_tasks()
                if not t.done() and "watchlist_cleanup_cycle" in repr(t.get_coro())
            ]
            assert survivors == [], f"the cleanup loop survived shutdown: {survivors}"
        finally:
            # Release the blocked worker here: asyncio.run waits for the default executor on exit.
            release.set()

    asyncio.run(drive())
