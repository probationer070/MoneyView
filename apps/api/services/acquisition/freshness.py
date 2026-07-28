"""The freshness question.

The rule is "have I asked since the last boundary?", never "do I hold a bar dated
>= X". The latter cannot be satisfied on a market holiday, because no bar exists for
one, so it triggers a refetch on every request all day, roughly ten days a year. It
also retries delisted tickers forever. This rule tracks our own action instead of the
market's output, so neither can defeat it.
"""
from __future__ import annotations

from datetime import datetime

from apps.api.services.acquisition.boundaries import Boundary
from apps.api.services.acquisition.state import AcquisitionState


def needs_acquisition(state: AcquisitionState, boundary: Boundary, now: datetime) -> bool:
    if state.last_checked_at is None:
        return True
    return state.last_checked_at < boundary.most_recent_instant(now)
