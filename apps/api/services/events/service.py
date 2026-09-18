"""Write semantics for user events and categories. Routes map the three errors to 404/409/422."""

from __future__ import annotations

import hashlib
import re

from apps.api.models.schemas import EventCategory, EventCategoryInput, EventCategoryPatch, MarketEvent, MarketEventInput
from apps.api.services.db import get_db
from apps.api.services.events import registry, store
from apps.api.services.events.categories import USER_PREFIX, load_builtin_categories
from apps.api.services.events.validation import (
    EventDataError,
    check_color,
    check_date_range,
    check_label,
    check_note,
    check_source,
)


class EventNotFound(LookupError):
    pass


class EventConflict(RuntimeError):
    pass


_USER_EVENT_ID = re.compile(r"user-(\d+)")
_NON_SLUG = re.compile(r"[^a-z0-9]+")


def _validate_event(payload: MarketEventInput) -> None:
    what = "event"
    check_label(payload.label, what=what)
    check_note(payload.note, what=what)
    check_source(payload.source, required=False, what=what)
    check_date_range(payload.start_date, payload.end_date, what=what)
    if payload.category not in registry.resolved_categories():
        raise EventDataError(f"event category {payload.category!r} does not exist")


def _user_event_number(event_id: str) -> int:
    match = _USER_EVENT_ID.fullmatch(event_id)
    if match:
        return int(match.group(1))
    if any(event.id == event_id for event in registry.default_registry().events()):
        raise EventConflict(f"built-in events are edited in their data file; {event_id!r} is not a user event")
    raise EventNotFound(f"no event with id {event_id!r}")


def create_user_event(payload: MarketEventInput) -> MarketEvent:
    _validate_event(payload)
    with get_db() as conn:
        return store.insert_user_event(conn, payload)


def update_user_event(event_id: str, payload: MarketEventInput) -> MarketEvent:
    number = _user_event_number(event_id)
    _validate_event(payload)
    with get_db() as conn:
        updated = store.update_user_event(conn, number, payload)
    if updated is None:
        raise EventNotFound(f"no event with id {event_id!r}")
    return updated


def delete_user_event(event_id: str) -> None:
    number = _user_event_number(event_id)
    with get_db() as conn:
        if not store.delete_user_event(conn, number):
            raise EventNotFound(f"no event with id {event_id!r}")


def create_user_category(payload: EventCategoryInput) -> EventCategory:
    what = "category"
    check_label(payload.label, what=what)
    check_color(payload.color, what=what)
    slug = _NON_SLUG.sub("-", payload.label.strip().lower()).strip("-")
    if not slug:
        if not any(ch.isalnum() for ch in payload.label):
            raise EventDataError("category label must contain a letter or a digit")
        # Non-ASCII labels (e.g. Korean) have no ASCII slug; a stable hash keeps ids ASCII and duplicates detectable.
        slug = hashlib.sha1(payload.label.strip().encode("utf-8")).hexdigest()[:10]
    category_id = f"{USER_PREFIX}{slug}"
    if category_id in registry.resolved_categories():
        raise EventDataError(f"a category with id {category_id!r} already exists")
    with get_db() as conn:
        store.insert_user_category(conn, category_id, payload.label.strip(), payload.color)
    return registry.resolved_categories()[category_id]


def patch_category(category_id: str, patch: EventCategoryPatch) -> EventCategory:
    current = registry.resolved_categories().get(category_id)
    if current is None:
        raise EventNotFound(f"no category with id {category_id!r}")
    fields = patch.model_fields_set
    what = f"category {category_id!r}"
    label = color = None
    if "label" in fields:
        check_label(patch.label or "", what=what)
        label = patch.label.strip()
    if "color" in fields:
        check_color(patch.color or "", what=what)
        color = patch.color
    if "visible" in fields and patch.visible is None:
        raise EventDataError(f"{what} visible must be true or false")

    with get_db() as conn:
        if label is not None or color is not None:
            if current.origin == "builtin":
                store.upsert_category_override(conn, category_id, label=label, color=color)
            else:
                store.update_user_category(conn, category_id, label=label, color=color)
        if "visible" in fields:
            store.set_visibility(conn, category_id, patch.visible)
    return registry.resolved_categories()[category_id]


def reset_category(category_id: str) -> None:
    builtins = load_builtin_categories(registry._events_dir(None) / registry.CATEGORIES_FILE)
    if category_id not in builtins:
        if category_id in registry.resolved_categories():
            raise EventConflict(f"{category_id!r} is a user category and has no file default to reset to")
        raise EventNotFound(f"no built-in category with id {category_id!r}")
    with get_db() as conn:
        store.delete_category_override(conn, category_id)


def delete_user_category(category_id: str) -> None:
    current = registry.resolved_categories().get(category_id)
    if current is None:
        raise EventNotFound(f"no category with id {category_id!r}")
    if current.origin == "builtin":
        raise EventConflict(f"{category_id!r} is a built-in category and cannot be deleted")
    with get_db() as conn:
        used = store.count_user_events_in_category(conn, category_id)
        if used:
            raise EventConflict(f"category {category_id!r} is still used by {used} event{'' if used == 1 else 's'}")
        store.delete_user_category(conn, category_id)
