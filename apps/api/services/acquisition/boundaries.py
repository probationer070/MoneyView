"""Freshness boundaries.

A boundary is the instant a held copy becomes invalid. It is deliberately not a TTL:
daily data changes once a day, so a 300-second TTL permits 288 refetches per day for
one actual change while still being able to serve data from *before* that change.

Pure by design -- `now` is a parameter, never a clock read -- so the date arithmetic
where the bugs live is exhaustively testable without a database or a network.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol


class Boundary(Protocol):
    def most_recent_instant(self, now: datetime) -> datetime:
        """The latest boundary instant at or before `now`."""


@dataclass(frozen=True)
class Daily:
    """Invalid once the next occurrence of `at_hour:at_minute` UTC passes.

    `business_days=True` steps back over Saturday and Sunday. It deliberately does not
    consult a market-holiday calendar: because freshness asks "have I asked since the
    boundary?" rather than "do I hold a bar dated >= X", a holiday simply means the
    provider returns nothing and we do not ask again until the next boundary. A holiday
    calendar would change which instant we ask *at*, never whether the rule is correct.
    """

    at_hour: int
    at_minute: int = 0
    business_days: bool = False

    def __post_init__(self) -> None:
        # A boundary is declared once and then silently governs every freshness decision
        # for its class, so a typo must fail at declaration rather than deep inside
        # `replace()` at the first acquisition, far from its cause.
        if not 0 <= self.at_hour <= 23:
            raise ValueError(f"at_hour must be 0-23, got {self.at_hour}")
        if not 0 <= self.at_minute <= 59:
            raise ValueError(f"at_minute must be 0-59, got {self.at_minute}")

    def most_recent_instant(self, now: datetime) -> datetime:
        if now.tzinfo is None:
            raise ValueError("Boundary comparisons require a timezone-aware datetime (UTC)")
        candidate = now.replace(
            hour=self.at_hour, minute=self.at_minute, second=0, microsecond=0
        )
        if candidate > now:
            candidate -= timedelta(days=1)
        if self.business_days:
            while candidate.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
                candidate -= timedelta(days=1)
        return candidate


@dataclass(frozen=True)
class Weekly:
    """Invalid once the next occurrence of `weekday` at `at_hour:at_minute` UTC passes.

    This is a freshness policy, not a model of anything's publication cadence. Statements
    are filed quarterly and irregularly per company; Weekly simply bounds how stale a held
    copy may be to seven days, until a filing-aware boundary exists. Nothing may read it as
    "this data changes weekly".

    `weekday` follows Python: Monday is 0, Sunday is 6.
    """

    weekday: int
    at_hour: int = 0
    at_minute: int = 0

    def __post_init__(self) -> None:
        if not 0 <= self.weekday <= 6:
            raise ValueError(f"weekday must be 0-6 (Monday is 0), got {self.weekday}")
        if not 0 <= self.at_hour <= 23:
            raise ValueError(f"at_hour must be 0-23, got {self.at_hour}")
        if not 0 <= self.at_minute <= 59:
            raise ValueError(f"at_minute must be 0-59, got {self.at_minute}")

    def most_recent_instant(self, now: datetime) -> datetime:
        if now.tzinfo is None:
            raise ValueError("Boundary comparisons require a timezone-aware datetime (UTC)")
        candidate = now.replace(
            hour=self.at_hour, minute=self.at_minute, second=0, microsecond=0
        )
        candidate -= timedelta(days=(candidate.weekday() - self.weekday) % 7)
        if candidate > now:
            candidate -= timedelta(days=7)
        return candidate
