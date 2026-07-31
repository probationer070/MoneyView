"""One declaration per data class; the runner reads this table and holds no per-class
logic. Adding a macro series or another index is a row, not a pipeline.

Statements, market cap and news are now declared alongside the two bar classes. Macro
rates and the derived valuation ratios arrive in later phases as further rows.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from apps.api.services.acquisition.boundaries import Boundary, Daily, Hourly, Weekly


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

# Weekly bounds staleness to seven days. It does NOT model filing cadence -- filings are
# quarterly and irregular per company. A filing-aware boundary replaces this later.
_WEEKLY_UTC = Weekly(weekday=0, at_hour=0)

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
    "statements": DataClass(
        name="statements",
        scope=Scope.PER_TICKER,
        boundary=_WEEKLY_UTC,
        store="corporate_statements",
        calendar="us_equity",
    ),
    # Daily, not intraday: every price input in MoneyView is a daily bar, so a sub-daily
    # market cap would be the only intraday input and would make WACC move within a day
    # while nothing else did.
    "market_cap": DataClass(
        name="market_cap",
        scope=Scope.PER_TICKER,
        boundary=_DAILY_UTC,
        store="corporate_quote_facts",
        calendar="us_equity",
    ),
    # Hourly is a rate-limit decision as much as a freshness one: the refresh button is
    # the control most likely to be pressed repeatedly, and the boundary is what bounds
    # the provider load that results.
    "news": DataClass(
        name="news",
        scope=Scope.PER_TICKER,
        boundary=Hourly(at_minute=0),
        store="news",
        calendar="us_equity",
    ),
}


def get_data_class(name: str) -> DataClass:
    if name not in REGISTRY:
        raise KeyError(f"unknown data class: {name!r}; declared: {sorted(REGISTRY)}")
    return REGISTRY[name]
