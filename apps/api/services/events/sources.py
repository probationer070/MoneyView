"""Event sources: anything that returns events for a date range.

A new kind of source (an economic-calendar API, say) is a class with `name` and `events`,
registered with `EventRegistry.register`. Nothing else changes.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Protocol

from apps.api.models.schemas import MarketEvent
from apps.api.services.events.validation import check_date_range, check_label, check_note, check_source


class EventSource(Protocol):
    name: str

    def events(self, start: date | None, end: date | None) -> list[MarketEvent]: ...


def event_overlaps(event: MarketEvent, start: date | None, end: date | None) -> bool:
    first = event.start_date
    last = event.end_date or event.start_date
    if start is not None and last < start.isoformat():
        return False
    if end is not None and first > end.isoformat():
        return False
    return True


class FileEventSource:
    """One committed JSON file of asserted events. Every event must cite a source."""

    def __init__(self, path: Path):
        self.path = path
        self.name = f"file {path.name}"

    def events(self, start: date | None, end: date | None) -> list[MarketEvent]:
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        events: list[MarketEvent] = []
        for raw in payload.get("events", []):
            # A committed file cannot claim to be a user's event or carry a resolution result.
            event = MarketEvent(**{**raw, "origin": "builtin", "missing_category": None})
            what = f"market event {event.id!r} in {self.path}"
            check_label(event.label, what=what)
            check_note(event.note, what=what)
            check_source(event.source, required=True, what=what)
            check_date_range(event.start_date, event.end_date, what=what)
            if event_overlaps(event, start, end):
                events.append(event)
        return events
