"""Background news loop: macro/theme news, alert tickers, then the daily stock sweep."""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from apps.api.services.news_feed.daily import daily_due, drain_alert_queue, run_daily_sweep
from apps.api.services.news_feed.pacer import NewsBlocked
from apps.api.services.risk import store
from apps.api.services.risk.news import sweep_news

logger = logging.getLogger(__name__)
NEWS_INTERVAL = timedelta(hours=12)


def _macro(now: datetime) -> None:
    swept = store.get_state("news_swept_at")
    if swept is None or now - datetime.fromisoformat(swept) >= NEWS_INTERVAL:
        sweep_news(now)


def _daily(now: datetime) -> None:
    if daily_due(now):
        run_daily_sweep(now)


def run_news_once(now: datetime) -> None:
    """Each step logs and continues on failure; AssertionError (test network guard) propagates."""
    for name, step in (("macro", _macro), ("alert_queue", drain_alert_queue), ("daily", _daily)):
        try:
            step(now)
        except AssertionError:
            raise
        except NewsBlocked as error:
            logger.warning("news.loop %s blocked: %s", name, error)
        except Exception:  # noqa: BLE001
            logger.exception("news.loop %s failed", name)


async def news_cycle(interval_seconds: float = 300.0) -> None:
    while True:
        try:
            await asyncio.to_thread(run_news_once, datetime.now(UTC))
        except Exception:  # noqa: BLE001
            logger.exception("News cycle failed; retrying next interval.")
        await asyncio.sleep(interval_seconds)
