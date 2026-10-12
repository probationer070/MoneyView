"""When to run: once at startup if this ISO week (KST) has no snapshot, and again after
Saturday 08:51 KST, once the US Friday close is in the data.

A desktop app is not always on, so this is a catch-up check run hourly rather than a
wall-clock trigger: a machine woken on Sunday still gets the week's run.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timedelta

from apps.api.services.signals import engine, store

logger = logging.getLogger(__name__)
_SATURDAY = 5
_RUN_TIME = time(8, 51)


def weekly_cutoff(now_utc: datetime) -> datetime:
    local = now_utc.astimezone(engine.KST)
    saturday = local.date() - timedelta(days=local.weekday()) + timedelta(days=_SATURDAY)
    return datetime.combine(saturday, _RUN_TIME, tzinfo=engine.KST)


def is_due(now_utc: datetime, week_run_at: datetime | None) -> bool:
    if week_run_at is None:
        return True
    cutoff = weekly_cutoff(now_utc)
    return now_utc >= cutoff > week_run_at


async def signal_cycle(interval_seconds: float = 3600.0) -> None:
    while True:
        try:
            now = engine.utc_now()
            snapshot = store.load_snapshot(store.iso_week(now.astimezone(engine.KST).date()))
            if is_due(now, datetime.fromisoformat(snapshot.run_at) if snapshot else None):
                await asyncio.to_thread(engine.run)
        except Exception:
            logger.exception("Signal cycle failed; retrying next interval.")
        await asyncio.sleep(interval_seconds)
