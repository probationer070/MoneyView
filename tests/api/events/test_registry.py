"""The registry merges sources and resolves every event's category (spec §1 steps 5-6)."""

import json
from datetime import date

import pytest

from apps.api.models.schemas import EventCategory, MarketEvent
from apps.api.services.events.registry import EventRegistry, default_registry
from apps.api.services.events.sources import FileEventSource
from apps.api.services.events.validation import EventDataError
from tests.api.events.test_rules import QUAD, FakeCalendar

CATEGORIES = {
    "geopolitical": EventCategory(id="geopolitical", label="Geopolitical", color="#E8A028", origin="builtin"),
    "uncategorized": EventCategory(id="uncategorized", label="Uncategorized", color="#9DA5A2", origin="builtin"),
    "user-mine": EventCategory(id="user-mine", label="Mine", color="#4589E5", origin="user"),
}


def _event(**overrides):
    base = {
        "id": "test-event", "label": "Test event", "category": "geopolitical",
        "start_date": "2026-02-28", "end_date": None, "source": "https://example.com/timeline", "note": "",
    }
    base.update(overrides)
    return base


def _file(tmp_path, events, name="events.json"):
    path = tmp_path / name
    path.write_text(json.dumps({"events": events}), encoding="utf-8")
    return path


class StubSource:
    def __init__(self, name, events):
        self.name = name
        self._events = [MarketEvent(**event) for event in events]

    def events(self, start, end):
        return list(self._events)


def _registry(*sources):
    return EventRegistry(sources, lambda: CATEGORIES)


# --- file source ---------------------------------------------------------------------------

def test_a_file_event_is_served_as_builtin_even_if_the_file_claims_otherwise(tmp_path):
    [event] = FileEventSource(_file(tmp_path, [_event(origin="user")])).events(None, None)

    assert event.origin == "builtin"


def test_an_unsourced_file_event_is_refused_naming_the_event(tmp_path):
    with pytest.raises(EventDataError) as excinfo:
        FileEventSource(_file(tmp_path, [_event(source="")])).events(None, None)

    assert "source" in str(excinfo.value)
    assert "test-event" in str(excinfo.value)


@pytest.mark.parametrize("override", [{"start_date": "28-02-2026"}, {"end_date": "2026-02-01"}, {"label": " "}])
def test_a_malformed_file_event_is_refused(tmp_path, override):
    with pytest.raises(EventDataError, match="test-event"):
        FileEventSource(_file(tmp_path, [_event(**override)])).events(None, None)


def test_the_range_keeps_events_that_overlap_it(tmp_path):
    source = FileEventSource(_file(tmp_path, [
        _event(id="before", start_date="2026-01-10"),
        _event(id="spanning", start_date="2026-01-20", end_date="2026-02-05"),
        _event(id="inside", start_date="2026-02-10"),
        _event(id="after", start_date="2026-03-10"),
    ]))

    assert [e.id for e in source.events(date(2026, 2, 1), date(2026, 2, 28))] == ["spanning", "inside"]


# --- registry ------------------------------------------------------------------------------

def test_the_registry_merges_sources_sorted_by_date_then_id():
    registry = _registry(
        StubSource("a", [_event(id="b-late", start_date="2026-03-02"), _event(id="z-early", start_date="2026-01-02")]),
        StubSource("b", [_event(id="a-late", start_date="2026-03-02")]),
    )

    assert [e.id for e in registry.events()] == ["z-early", "a-late", "b-late"]


def test_a_duplicate_id_across_sources_is_refused_naming_both():
    registry = _registry(StubSource("first", [_event()]), StubSource("second", [_event()]))

    with pytest.raises(EventDataError) as excinfo:
        registry.events()

    assert "first" in str(excinfo.value) and "second" in str(excinfo.value)


def test_register_adds_a_source_without_other_changes():
    registry = _registry(StubSource("a", [_event(id="one")]))
    registry.register(StubSource("b", [_event(id="two", start_date="2026-03-01")]))

    assert [e.id for e in registry.events()] == ["one", "two"]


@pytest.mark.parametrize("category", ["no-such-category", "user-mine"])
def test_a_builtin_event_naming_an_unresolved_or_user_category_is_refused(category):
    registry = _registry(StubSource("file x", [_event(category=category)]))

    with pytest.raises(EventDataError, match=category):
        registry.events()


def test_a_rule_event_naming_an_unknown_category_is_refused():
    registry = _registry(StubSource("rule x", [_event(origin="rule", category="quad-witching")]))

    with pytest.raises(EventDataError, match="quad-witching"):
        registry.events()


def test_a_user_event_whose_category_is_gone_falls_back_to_uncategorized():
    registry = _registry(StubSource("user", [_event(id="user-1", origin="user", category="quad-witching", source=None)]))

    [event] = registry.events()

    assert event.category == "uncategorized"
    assert event.missing_category == "quad-witching"


def test_a_user_event_in_an_existing_category_is_unchanged():
    registry = _registry(StubSource("user", [_event(id="user-1", origin="user", category="user-mine", source=None)]))

    [event] = registry.events()

    assert (event.category, event.missing_category) == ("user-mine", None)


# --- default registry over a folder --------------------------------------------------------

def _events_dir(tmp_path, *, rules=None, categories=None):
    (tmp_path / "categories.json").write_text(json.dumps({"categories": categories or [
        {"id": "geopolitical", "label": "Geopolitical", "color": "#E8A028"},
        {"id": "quad-witching", "label": "Quadruple witching", "color": "#7C5CFF"},
        {"id": "uncategorized", "label": "Uncategorized", "color": "#9DA5A2"},
    ]}), encoding="utf-8")
    if rules is not None:
        (tmp_path / "rules.json").write_text(json.dumps({"rules": rules}), encoding="utf-8")
    return tmp_path


def test_every_event_file_and_rule_in_the_folder_is_a_source(tmp_path):
    folder = _events_dir(tmp_path, rules=[QUAD])
    _file(folder, [_event(id="iran")], name="geopolitical.json")

    events = default_registry(folder, FakeCalendar()).events(date(2026, 1, 1), date(2026, 3, 31))

    assert [e.id for e in events] == ["iran", "quad-witching-2026-03-20"]


def test_a_folder_with_no_event_files_yields_no_events(tmp_path):
    assert default_registry(_events_dir(tmp_path), FakeCalendar()).events() == []
