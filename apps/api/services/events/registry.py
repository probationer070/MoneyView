"""The event registry: merges every source and resolves each event's category.

Extending by data (no code): add an events/<name>.json file, a rules.json entry using an
existing kind, or a category in categories.json. Extending by code (no edits to existing code):
`EventRegistry.register(source)` or `register_rule_kind(name, generator)`.

Category resolution for events (spec §1, steps 5-6):
  - a built-in or rule event must name a built-in category, or this raises -- a committed
    mistake that tests catch before merge
  - a user event whose category no longer exists is served as `uncategorized` with
    `missing_category` set, because the user cannot fix a data file and a `git pull` must not
    break their events
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Callable, Iterable, Mapping

from apps.api.models.schemas import EventCategory, MarketEvent
from apps.api.services.events.categories import REQUIRED_CATEGORY, load_builtin_categories, resolve_categories
from apps.api.services.events.rules import RuleEventSource, TradingCalendar, exchange_calendar
from apps.api.services.events.sources import EventSource, FileEventSource
from apps.api.services.events.validation import EventDataError

EVENTS_DIR = Path(__file__).resolve().parent
CATEGORIES_FILE = "categories.json"
RULES_FILE = "rules.json"


def _events_dir(events_dir: Path | None) -> Path:
    # Read the module attribute at call time, so tests can point it at a temporary folder.
    return events_dir if events_dir is not None else EVENTS_DIR


class EventRegistry:
    def __init__(self, sources: Iterable[EventSource], categories: Callable[[], Mapping[str, EventCategory]]):
        self._sources = list(sources)
        self._categories = categories

    def register(self, source: EventSource) -> None:
        self._sources.append(source)

    def events(self, start: date | None = None, end: date | None = None) -> list[MarketEvent]:
        categories = self._categories()
        produced_by: dict[str, str] = {}
        merged: list[MarketEvent] = []
        for source in self._sources:
            for event in source.events(start, end):
                if event.id in produced_by:
                    raise EventDataError(
                        f"event id {event.id!r} is produced by both {produced_by[event.id]} and {source.name}"
                    )
                produced_by[event.id] = source.name
                merged.append(_resolve_category(event, categories, source.name))
        merged.sort(key=lambda event: (event.start_date, event.id))
        return merged


def _resolve_category(event: MarketEvent, categories: Mapping[str, EventCategory], source_name: str) -> MarketEvent:
    category = categories.get(event.category)
    if event.origin == "user":
        if category is not None:
            return event
        return event.model_copy(update={"category": REQUIRED_CATEGORY, "missing_category": event.category})
    if category is None or category.origin != "builtin":
        raise EventDataError(
            f"{event.origin} event {event.id!r} from {source_name} names category {event.category!r}, "
            f"which is not a built-in category in {CATEGORIES_FILE}"
        )
    return event


def builtin_sources(events_dir: Path | None = None, calendar: TradingCalendar | None = None) -> list[EventSource]:
    folder = _events_dir(events_dir)
    sources: list[EventSource] = [
        FileEventSource(path)
        for path in sorted(folder.glob("*.json"))
        if path.name not in {CATEGORIES_FILE, RULES_FILE}
    ]
    rules_path = folder / RULES_FILE
    if rules_path.exists():
        rules = json.loads(rules_path.read_text(encoding="utf-8")).get("rules", [])
        if rules:
            active_calendar = calendar if calendar is not None else exchange_calendar()
            sources.extend(RuleEventSource(rule, active_calendar, where=str(rules_path)) for rule in rules)
    return sources


def resolved_categories(events_dir: Path | None = None) -> dict[str, EventCategory]:
    builtins = load_builtin_categories(_events_dir(events_dir) / CATEGORIES_FILE)
    return resolve_categories(builtins, [], {})


def default_registry(events_dir: Path | None = None, calendar: TradingCalendar | None = None) -> EventRegistry:
    return EventRegistry(
        builtin_sources(events_dir, calendar),
        lambda: resolved_categories(events_dir),
    )
