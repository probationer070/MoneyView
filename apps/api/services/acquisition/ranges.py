"""Which date range to fetch.

Replaces `history(period=...)`, which has no delta capability: the existing
`_rows_cover_period` computes that coverage is short and then discards that information
and refetches the whole period. A steady-state update transfers one row where a full
refetch transfers ~2,520.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from apps.api.services.acquisition.state import AcquisitionState

BACKFILL_YEARS = 10


@dataclass(frozen=True)
class FetchRange:
    start: date
    end_exclusive: date
    reason: str


def _backfill_start(today: date, backfill_years: int) -> date:
    try:
        return today.replace(year=today.year - backfill_years)
    except ValueError:  # 29 February
        return today.replace(year=today.year - backfill_years, day=28)


def plan_range(
    state: AcquisitionState,
    *,
    today: date,
    backfill_years: int = BACKFILL_YEARS,
    full_refetch: bool = False,
) -> FetchRange | None:
    # `end` is exclusive in yfinance: passing `today` drops today's bar silently.
    end_exclusive = today + timedelta(days=1)

    if full_refetch:
        return FetchRange(_backfill_start(today, backfill_years), end_exclusive, "corporate_action")
    if state.covered_to is None:
        return FetchRange(_backfill_start(today, backfill_years), end_exclusive, "backfill")
    if state.covered_to >= today:
        return None
    return FetchRange(state.covered_to + timedelta(days=1), end_exclusive, "delta")
