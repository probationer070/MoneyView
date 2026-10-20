"""Hourly risk cycle: sweep bars, backfill if unfinished, evaluate pending days, refresh news."""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from apps.api.services.risk import store
from apps.api.services.risk.evaluator import evaluate_pending, run_backfill
from apps.api.services.risk.news import sweep_news
from apps.api.services.risk.sweep import sweep_bars

logger = logging.getLogger(__name__)
NEWS_INTERVAL = timedelta(hours=12)
DECK_TICKERS = 10


def utc_now() -> datetime:
    return datetime.now(UTC)


def _news_due(now: datetime) -> bool:
    swept = store.get_state("news_swept_at")
    return swept is None or now - datetime.fromisoformat(swept) >= NEWS_INTERVAL


def run_once(now: datetime) -> list[int]:
    """One pass. Each step logs and continues on failure; AssertionError (test network guard) propagates."""
    new_ids: list[int] = []
    try:
        sweep_bars(now)
    except AssertionError:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("risk.cycle sweep_bars failed")
    try:
        run_backfill(now)  # loads its own inputs: its sweeps add deep history
    except AssertionError:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("risk.cycle run_backfill failed")
    try:
        new_ids = list(evaluate_pending(now))  # loads only the recent window; stores fred_errors
    except AssertionError:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("risk.cycle evaluate_pending failed")
    try:
        if _news_due(now):
            sweep_news(now)
    except AssertionError:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("risk.cycle sweep_news failed")
    for alert_id in new_ids:
        try:
            alert = store.get_alert(alert_id)
            cards = alert.cards.get(("latest", "crash"), []) if alert else []
            sweep_news(now, tickers=[c.ticker for c in cards[:DECK_TICKERS]])
        except AssertionError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("risk.cycle alert news failed id=%s", alert_id)
    return new_ids


async def risk_cycle(interval_seconds: float = 3600.0) -> None:
    while True:
        try:
            await asyncio.to_thread(run_once, utc_now())
        except Exception:  # noqa: BLE001
            logger.exception("Risk cycle failed; retrying next interval.")
        await asyncio.sleep(interval_seconds)
