"""Cover the lifespan branch that pytest itself never takes.

tests/conftest.py sets MONEYVIEW_DISABLE_STARTUP_JOBS for the whole session, so
every other test in the suite exercises only the gated path. These tests drive
apps/api/main.py's lifespan directly with the variable cleared, which is the
shape production runs in.
"""

from __future__ import annotations

import asyncio
import threading
import time

import pytest

from apps.api import main as api_main


def _drive_lifespan(monkeypatch, env_value):
    """Run one full lifespan cycle with the startup cycle stubbed out.

    Returns (started, shutdown_seconds): whether stock_prewarm_cycle launched -- the
    only startup cycle the gate covers now that corporate_snapshot_cycle is gone
    (Task 8: snapshots become manual-only) -- and how long shutdown took while the
    prewarm worker was still blocked.
    """
    started: list[str] = []
    release = threading.Event()

    async def fake_stock_prewarm_cycle():
        started.append("stock_prewarm")
        # The real cycle's shape: a threadpool worker that task.cancel() cannot
        # reach. release is set only after shutdown has been timed, so the
        # measurement happens while the worker is genuinely still running.
        await asyncio.to_thread(release.wait, 30)

    monkeypatch.setattr(api_main, "stock_prewarm_cycle", fake_stock_prewarm_cycle)
    if env_value is None:
        monkeypatch.delenv("MONEYVIEW_DISABLE_STARTUP_JOBS", raising=False)
    else:
        monkeypatch.setenv("MONEYVIEW_DISABLE_STARTUP_JOBS", env_value)

    async def drive():
        async with api_main.lifespan(api_main.app):
            # One scheduling turn, so create_task'd coroutines reach their first
            # await and record themselves before shutdown begins.
            await asyncio.sleep(0.05)
            body_done = time.perf_counter()
        shutdown_seconds = time.perf_counter() - body_done
        release.set()
        return shutdown_seconds

    shutdown_seconds = asyncio.run(drive())
    return started, shutdown_seconds


@pytest.mark.parametrize("env_value", [None, "", "0", "false", "no", "off"])
def test_startup_cycles_run_unless_the_gate_is_explicitly_set(monkeypatch, env_value):
    """A stray or falsy variable must not silently disable warming in production."""
    started, _ = _drive_lifespan(monkeypatch, env_value)

    assert started == ["stock_prewarm"]


@pytest.mark.parametrize("env_value", ["1", "true", "TRUE", "yes"])
def test_the_gate_stops_both_live_data_cycles(monkeypatch, env_value):
    started, _ = _drive_lifespan(monkeypatch, env_value)

    assert started == []


def test_shutdown_does_not_wait_for_the_uncancellable_prewarm_worker(monkeypatch):
    """The gather() added on shutdown must not turn an uncancellable threadpool
    worker into a hang.

    task.cancel() on a task awaiting asyncio.to_thread raises CancelledError at
    the await point immediately, even though the executor thread survives -- so
    awaiting the cancellations returns promptly. If that ever stops holding, the
    API would block on shutdown for as long as a prewarm takes.
    """
    started, shutdown_seconds = _drive_lifespan(monkeypatch, None)

    assert "stock_prewarm" in started
    assert shutdown_seconds < 1.0, (
        f"shutdown took {shutdown_seconds:.2f}s while a to_thread worker was blocked "
        f"for 30s -- it is now waiting on the worker"
    )
