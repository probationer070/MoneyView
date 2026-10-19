"""Scheduled data refresh for the risk engine: daily bars, deep history and quote facts.

Before this module nothing scheduled ever refreshed bars. Every function here is
sequential and paced, logs and records a per-ticker failure instead of raising, and lets
AssertionError through: a provider never raises it, a test's network guard does, and
swallowing it would hide a test that reached the network (same reasoning as
acquisition.runner.acquire_point_in_time).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Sequence

from apps.api.core.logger import setup_logger
from apps.api.services.acquisition import runner
from apps.api.services.acquisition.ranges import FetchRange
from apps.api.services.acquisition.runner import acquire, acquire_point_in_time
from apps.api.services.acquisition.sources.bars import fetch_bars, latest_action_date
from apps.api.services.acquisition.sources.quote_facts import fetch_quote_facts
from apps.api.services.acquisition.state import AcquisitionStatus, read_state
from apps.api.services.acquisition.store import save_quote_facts
from apps.api.services.db import get_db
from apps.api.services.risk import store
from apps.api.services.risk.constants import BENCHMARK_TICKERS

logger = setup_logger(__name__)

PACE_SECONDS = 0.5


@dataclass(frozen=True)
class SweepReport:
    """attempted: tickers worked on; fetched: tickers that got new rows from the provider;
    failed: tickers whose work failed, in order. `failed` is a list (the brief's type), so
    it needs default_factory; the dataclass is frozen but the list itself is not -- callers
    must not mutate it."""

    attempted: int = 0
    fetched: int = 0
    failed: list[str] = field(default_factory=list)


def _watchlist_plus_benchmarks() -> list[str]:
    with get_db() as conn:
        listed = [row["ticker"] for row in conn.execute("SELECT ticker FROM watchlist ORDER BY ticker")]
    return list(dict.fromkeys([*listed, *BENCHMARK_TICKERS]))


def sweep_bars(
    now: datetime,
    *,
    tickers: Sequence[str] | None = None,
    fetcher=fetch_bars,
    action_probe=latest_action_date,
    sleep=time.sleep,
) -> SweepReport:
    targets = list(tickers) if tickers is not None else _watchlist_plus_benchmarks()
    attempted = fetched = 0
    failed: list[str] = []
    reached_provider = False
    for ticker in targets:
        if reached_provider:
            sleep(PACE_SECONDS)
        reached_provider = False
        attempted += 1
        try:
            result = acquire("equity_bars", ticker, now=now, fetcher=fetcher, action_probe=action_probe)
        except AssertionError:
            raise
        except Exception as error:  # noqa: BLE001 - one ticker must not stop the sweep
            logger.warning("risk.sweep_bars_failed ticker=%s error=%s", ticker, error)
            failed.append(ticker)
            reached_provider = True
            continue
        reached_provider = result.reason != "fresh"
        if result.fetched_rows > 0:
            fetched += 1
        elif not result.skipped and read_state("equity_bars", ticker).status == AcquisitionStatus.FAILED:
            # acquire() swallows fetch errors into a FAILED state row; surface it here.
            failed.append(ticker)
    return SweepReport(attempted, fetched, failed)


def _first_bar_date(ticker: str) -> date | None:
    with get_db() as conn:
        row = conn.execute("SELECT MIN(date) FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
    return date.fromisoformat(row[0][:10]) if row and row[0] else None


def ensure_deep_history(
    tickers: Sequence[str],
    *,
    history_start: date,
    today: date,
    fetcher=fetch_bars,
    saver=None,
    sleep=time.sleep,
) -> SweepReport:
    attempted = fetched = 0
    failed: list[str] = []
    reached_provider = False
    for ticker in tickers:
        key = f"deep_history:{ticker.upper()}"
        if store.get_state(key) is not None:
            continue
        attempted += 1
        first = _first_bar_date(ticker)
        if first is not None and first <= history_start:
            store.set_state(key, today.isoformat())
            continue
        if reached_provider:
            sleep(PACE_SECONDS)
        reached_provider = True
        fetch_range = FetchRange(history_start, first or today + timedelta(days=1), "deep_history")
        try:
            rows = fetcher(ticker, fetch_range)
            if rows:
                (saver or runner._default_saver)(ticker, rows)
        except AssertionError:
            raise
        except Exception as error:  # noqa: BLE001 - not marked, so the next run retries it
            logger.warning("risk.deep_history_failed ticker=%s error=%s", ticker, error)
            failed.append(ticker)
            continue
        if rows:
            fetched += 1
        # No rows is still marked: the ticker was listed later than history_start.
        store.set_state(key, today.isoformat())
    return SweepReport(attempted, fetched, failed)


def _missing_shares(ticker: str) -> bool:
    with get_db() as conn:
        row = conn.execute(
            "SELECT shares_outstanding FROM corporate_quote_facts WHERE ticker = ?", (ticker.upper(),)
        ).fetchone()
    return row is None or row[0] is None


def ensure_quote_facts(
    tickers: Sequence[str],
    now: datetime,
    *,
    fetcher=fetch_quote_facts,
    sleep=time.sleep,
) -> SweepReport:
    attempted = fetched = 0
    failed: list[str] = []
    reached_provider = False
    for ticker in tickers:
        if not _missing_shares(ticker):
            continue
        if reached_provider:
            sleep(PACE_SECONDS)
        reached_provider = False
        attempted += 1
        try:
            result = acquire_point_in_time(
                "market_cap", ticker, now=now,
                fetcher=fetcher,
                saver=save_quote_facts,
                coverage=lambda facts: (now.date(), now.date()),
            )
        except AssertionError:
            raise
        except Exception as error:  # noqa: BLE001 - one ticker must not stop the run
            logger.warning("risk.quote_facts_failed ticker=%s error=%s", ticker, error)
            failed.append(ticker)
            reached_provider = True
            continue
        reached_provider = result.reason != "fresh"
        if result.fetched_rows > 0:
            fetched += 1
        elif result.reason == "failed":
            failed.append(ticker)
    return SweepReport(attempted, fetched, failed)
