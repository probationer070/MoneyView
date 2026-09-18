"""Pure merge rules for watchlist peer sync (spec §1). No I/O.

Every change is ordered by a key. The larger key wins:
    add_key    = (updated_at, updated_by)    for a watchlist row
    remove_key = (removed_at, removed_by)    for a tombstone
Timestamps use one fixed format, so comparing them as strings orders them in time. Authors travel
with the change and are never rewritten, which keeps the winner stable however files are republished.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable

BASELINE_TS = "1970-01-01T00:00:00.000Z"
TS_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z")
_TS_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


def format_ts(moment: datetime) -> str:
    utc = moment.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


_clock_lock = threading.Lock()
_last_issued = BASELINE_TS


def next_stamp(now: datetime | None = None, after: str | None = None) -> str:
    """A timestamp strictly greater than any this process issued before, and than `after`.

    Two edits within one millisecond on one PC would otherwise share a key while holding different
    contents, and the winner would depend on read order. `after` is the stamp of the version the
    user saw: a local change must outrank it even when a peer's clock is ahead of this PC's.
    """
    global _last_issued
    with _clock_lock:
        candidate = format_ts(now or datetime.now(timezone.utc))
        # Never below BASELINE_TS, so SEED_TS (year 0000, which strptime cannot parse) is never parsed.
        floor = max(_last_issued, after or BASELINE_TS)
        if candidate <= floor:
            previous = datetime.strptime(floor, _TS_FORMAT).replace(tzinfo=timezone.utc)
            candidate = format_ts(previous + timedelta(milliseconds=1))
        _last_issued = candidate
        return candidate


@dataclass(frozen=True)
class SyncRow:
    ticker: str
    name: str
    sector: str
    group_name: str
    weight: float
    updated_at: str
    updated_by: str

    def add_key(self) -> tuple[str, str]:
        return (self.updated_at, self.updated_by)

    def order_key(self) -> tuple:
        # Content breaks an exact (timestamp, author) tie, so the choice never depends on read order.
        return (self.updated_at, self.updated_by, self.name, self.sector, self.group_name, self.weight)


@dataclass(frozen=True)
class Tombstone:
    ticker: str
    removed_at: str
    removed_by: str

    def remove_key(self) -> tuple[str, str]:
        return (self.removed_at, self.removed_by)


@dataclass(frozen=True)
class SyncState:
    rows: dict[str, SyncRow] = field(default_factory=dict)
    removed: dict[str, Tombstone] = field(default_factory=dict)


def merge_states(states: Iterable[SyncState]) -> SyncState:
    best_rows: dict[str, SyncRow] = {}
    best_removed: dict[str, Tombstone] = {}
    for current in states:
        for row in current.rows.values():
            held = best_rows.get(row.ticker)
            if held is None or row.order_key() > held.order_key():
                best_rows[row.ticker] = row
        for tomb in current.removed.values():
            held_tomb = best_removed.get(tomb.ticker)
            if held_tomb is None or tomb.remove_key() > held_tomb.remove_key():
                best_removed[tomb.ticker] = tomb
    present = {
        ticker: row
        for ticker, row in best_rows.items()
        if not (ticker in best_removed and best_removed[ticker].remove_key() > row.add_key())
    }
    # Every tombstone is kept, including ones a newer add has made ineffective (spec §1).
    return SyncState(rows=present, removed=best_removed)
