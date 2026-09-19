"""The user's own events, from SQLite. Their category is resolved by the registry (step 6)."""

from __future__ import annotations

from datetime import date

from apps.api.models.schemas import MarketEvent
from apps.api.services.db import get_db
from apps.api.services.events import store
from apps.api.services.events.sources import event_overlaps


class UserEventSource:
    name = "user events"

    def events(self, start: date | None, end: date | None) -> list[MarketEvent]:
        with get_db() as conn:
            events = store.list_user_events(conn)
        return [event for event in events if event_overlaps(event, start, end)]
