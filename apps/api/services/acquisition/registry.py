"""One declaration per data class; the runner reads this table and holds no per-class
logic. Adding a macro series or another index is a row, not a pipeline.

Phase 1 declares only the two bar classes. Statements, macro rates, news and the
derived valuation ratios arrive in later phases as further rows.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from apps.api.services.acquisition.boundaries import Boundary, Daily


class Scope(str, Enum):
    PER_TICKER = "per_ticker"
    GLOBAL = "global"


@dataclass(frozen=True)
class DataClass:
    name: str
    scope: Scope
    boundary: Boundary
    store: str
    calendar: str
    depends_on: tuple[str, ...] = field(default_factory=tuple)


# 00:00 UTC sits 3-4 hours after the US close (21:00 UTC in winter, 20:00 in summer),
# so the previous session's bars are settled and published by then in both DST halves.
_DAILY_UTC = Daily(at_hour=0)

REGISTRY: dict[str, DataClass] = {
    "equity_bars": DataClass(
        name="equity_bars",
        scope=Scope.PER_TICKER,
        boundary=_DAILY_UTC,
        store="stocks",
        calendar="us_equity",
    ),
    # Index subjects span calendars -- ^GSPC is us_equity, ^KS200 krx, CL=F cme_energy,
    # BTC-USD continuous -- so `calendar` here is the default and is resolved per subject
    # when a later phase needs session-accurate handling.
    "index_bars": DataClass(
        name="index_bars",
        scope=Scope.GLOBAL,
        boundary=_DAILY_UTC,
        store="indices",
        calendar="per_subject",
    ),
}


def get_data_class(name: str) -> DataClass:
    if name not in REGISTRY:
        raise KeyError(f"unknown data class: {name!r}; declared: {sorted(REGISTRY)}")
    return REGISTRY[name]
