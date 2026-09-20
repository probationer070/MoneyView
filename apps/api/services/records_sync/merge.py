"""Per-record merge (spec §5). Pure: no I/O.

Records and tombstones are ordered by the same change keys watchlist sync uses, per (kind, uid). A
record's payload is replaced whole — never field by field — so a case never mixes one PC's
assumptions with another's segments.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Iterable


@dataclass
class Record:
    kind: str
    uid: str
    updated_at: str
    updated_by: str
    payload: dict

    def add_key(self) -> tuple[str, str]:
        return (self.updated_at, self.updated_by)

    def order_key(self) -> tuple[str, str, str]:
        # Content breaks an exact (timestamp, author) tie, so the winner never depends on read
        # order. sort_keys makes the comparison stable whatever order the JSON arrived in.
        return (self.updated_at, self.updated_by, json.dumps(self.payload, sort_keys=True, default=str))


@dataclass(frozen=True)
class RecordTombstone:
    kind: str
    uid: str
    removed_at: str
    removed_by: str

    def remove_key(self) -> tuple[str, str]:
        return (self.removed_at, self.removed_by)


@dataclass(frozen=True)
class RecordState:
    records: dict[tuple[str, str], Record] = field(default_factory=dict)
    removed: dict[tuple[str, str], RecordTombstone] = field(default_factory=dict)


def merge_record_states(states: Iterable[RecordState]) -> RecordState:
    best: dict[tuple[str, str], Record] = {}
    best_removed: dict[tuple[str, str], RecordTombstone] = {}
    for current in states:
        for key, record in current.records.items():
            held = best.get(key)
            if held is None or record.order_key() > held.order_key():
                best[key] = record
        for key, tomb in current.removed.items():
            held_tomb = best_removed.get(key)
            if held_tomb is None or tomb.remove_key() > held_tomb.remove_key():
                best_removed[key] = tomb
    present = {
        key: record
        for key, record in best.items()
        if not (key in best_removed and best_removed[key].remove_key() > record.add_key())
    }
    # Every tombstone is kept, including ones a newer add has made ineffective.
    return RecordState(records=present, removed=best_removed)
