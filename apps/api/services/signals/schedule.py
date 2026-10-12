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
    """Hourly check. A run that reports FRED errors is retried on each later check in the
    same week once the cutoff has passed. A restart after a failed run does not retry (the
    snapshot exists); POST /run repairs it."""
    retry_week: str | None = None
    while True:
        try:
            now = engine.utc_now()
            week = store.iso_week(now.astimezone(engine.KST).date())
            if retry_week != week:
                retry_week = None
            snapshot = store.load_snapshot(week)
            retry = retry_week == week and now >= weekly_cutoff(now)
            if retry or is_due(now, datetime.fromisoformat(snapshot.run_at) if snapshot else None):
                outcome = await asyncio.to_thread(engine.run)
                if outcome.failures:
                    retry_week = week
                    logger.warning("Signal run for %s had FRED errors; retrying on the next check: %s",
                                   week, "; ".join(outcome.failures))
                else:
                    retry_week = None
        except Exception:
            logger.exception("Signal cycle failed; retrying next interval.")
        await asyncio.sleep(interval_seconds)
