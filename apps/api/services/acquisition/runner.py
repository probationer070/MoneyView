"""Acquisition orchestration.

Reads the registry, asks the freshness question, plans a range, fetches, persists, and
records what happened. Holds no per-class logic: adding a data class is a registry row.

No acquisition failure ever propagates into a request. Precedent: the telemetry sink's
failure policy in perf spec 03.8.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from apps.api.core.logger import setup_logger
from apps.api.services.acquisition.freshness import needs_acquisition
from apps.api.services.acquisition.ranges import plan_range
from apps.api.services.acquisition.registry import get_data_class
from apps.api.services.acquisition.sources.bars import fetch_bars, latest_action_date
from apps.api.services.acquisition.state import (
    AcquisitionStatus,
    read_state,
    record_check,
    record_retired,
    record_success,
)

logger = setup_logger(__name__)


@dataclass(frozen=True)
class AcquisitionResult:
    data_class: str
    subject: str
    fetched_rows: int
    reason: str
    skipped: bool


def _default_saver(ticker: str, rows) -> None:
    from apps.api.services.market_data import MarketDataService

    MarketDataService()._save_ohlcv_rows(ticker, rows)


def acquire(
    data_class_name: str,
    subject: str,
    *,
    now: datetime,
    fetcher=fetch_bars,
    action_probe=latest_action_date,
    saver=None,
) -> AcquisitionResult:
    declared = get_data_class(data_class_name)
    state = read_state(data_class_name, subject)

    if not needs_acquisition(state, declared.boundary, now):
        return AcquisitionResult(data_class_name, subject, 0, "fresh", skipped=True)

    today = now.date()

    # A split or dividend rewrites adjusted history retroactively, so a delta append
    # would mix pre- and post-adjustment prices. Detect it and refetch the whole series.
    full_refetch = False
    try:
        action_date = action_probe(subject)
    except Exception as error:  # noqa: BLE001 - a probe failure must not block acquisition
        logger.warning("acquisition.action_probe_failed subject=%s error=%s", subject, error)
        action_date = None
    if action_date is not None and state.covered_to is not None and action_date > state.covered_to:
        full_refetch = True

    fetch_range = plan_range(state, today=today, full_refetch=full_refetch)
    if fetch_range is None:
        record_check(data_class_name, subject, now=now, status=state.status or AcquisitionStatus.EMPTY)
        return AcquisitionResult(data_class_name, subject, 0, "current", skipped=True)

    try:
        rows = fetcher(subject, fetch_range)
    except Exception as error:  # noqa: BLE001 - never propagate into a caller
        logger.warning("acquisition.fetch_failed subject=%s error=%s", subject, error)
        record_check(data_class_name, subject, now=now, status=AcquisitionStatus.FAILED, detail=str(error))
        return AcquisitionResult(data_class_name, subject, 0, fetch_range.reason, skipped=False)

    if not rows:
        # Asked and found nothing: a holiday, a gap, or a delisting. Recording the ask
        # is what stops it being retried on every request for the rest of the day.
        record_check(data_class_name, subject, now=now, status=AcquisitionStatus.EMPTY)
        return AcquisitionResult(data_class_name, subject, 0, fetch_range.reason, skipped=False)

    (saver or _default_saver)(subject, rows)
    # Coverage records what EXISTS, not what was requested. If the provider lags and
    # returns bars only through Wednesday while `today` is Friday, recording
    # covered_to=today would claim coverage that is not there -- the next delta would
    # start Saturday and Thursday and Friday would be lost permanently, with nothing
    # ever asking for them again.
    covered_to = max(date.fromisoformat(row.date[:10]) for row in rows)
    record_success(
        data_class_name, subject, now=now,
        covered_from=fetch_range.start, covered_to=covered_to,
    )
    return AcquisitionResult(data_class_name, subject, len(rows), fetch_range.reason, skipped=False)


def schedule_acquisition(data_class: str, subject: str) -> None:
    """Enqueue acquisition without blocking the caller.

    Phase 1 runs it on a daemon thread. That is sufficient for a local-first
    single-process app and keeps the write path non-blocking; a scheduled warmer for the
    whole registry arrives with the later phases.
    """
    import threading
    from datetime import UTC, datetime

    def _run() -> None:
        try:
            acquire(data_class, subject, now=datetime.now(UTC))
        except Exception as error:  # noqa: BLE001 - a background failure must stay contained
            logger.warning("acquisition.scheduled_failed subject=%s error=%s", subject, error)

    threading.Thread(target=_run, name=f"acquire-{subject}", daemon=True).start()


def retire_subject(data_class: str, subject: str) -> None:
    """Stop refreshing a subject. Rows are retained: storage is cheap and re-adding the
    ticker is then free."""
    record_retired(data_class, subject)
