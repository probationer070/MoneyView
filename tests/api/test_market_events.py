"""The committed events and categories, and the read routes that serve them.

Events are asserted facts, so the loader's job is to refuse unsourced or inconsistent ones.
These tests read the COMMITTED files through the real registry: a mistake in a data file fails
here before it merges.
"""

import re
from datetime import date
from urllib.parse import unquote, urlparse

from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.events.registry import (
    CATEGORIES_FILE,
    EVENTS_DIR,
    builtin_sources,
    default_registry,
    resolved_categories,
)
from apps.api.services.events.sources import FileEventSource

client = TestClient(app)

_MONTHS = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)


def _file_events():
    return [
        event
        for source in builtin_sources()
        if isinstance(source, FileEventSource)
        for event in source.events(None, None)
    ]


def test_the_committed_data_resolves_without_error():
    """Every committed event and rule names a built-in category, ids are unique, and every file
    validates -- the registry raises on any of those, so a clean call is the assertion."""
    assert default_registry().events(), "no committed events at all"


def test_the_committed_file_carries_the_iran_operation_start():
    """A chart marking the wrong day is worse than a chart marking nothing."""
    iran = [event for event in default_registry().events() if "iran" in event.id.lower()]

    assert [event.start_date for event in iran] == ["2026-02-28"]
    assert iran[0].source, "an asserted date with no source is exactly what this forbids"
    assert iran[0].category == "geopolitical"


def test_the_committed_categories_include_the_required_ones_with_hex_colors():
    categories = resolved_categories()

    assert {"fomc", "quad-witching", "geopolitical", "uncategorized"} <= set(categories)
    assert categories["fomc"].color.upper() == "#E54545", "rate decisions were asked for in red"


def test_quad_witching_in_2026_comes_from_the_rule_and_skips_juneteenth():
    events = default_registry().events(date(2026, 1, 1), date(2026, 12, 31))
    quad = [event for event in events if event.category == "quad-witching"]

    assert [event.start_date for event in quad] == ["2026-03-20", "2026-06-18", "2026-09-18", "2026-12-18"]
    assert all(event.origin == "rule" and event.source.startswith("https://") for event in quad)


def test_no_committed_file_source_names_a_different_month_or_year_than_its_event():
    """A source must at least not contradict its own event's date (ERROR-LOG.md 2026-09-13).

    Months are whole words of the URL path, so `mayor` is not May; years are standalone 19xx/20xx.
    Rule events are excluded: their source states a rule, not a date.
    """
    events = _file_events()
    assert events, "no committed file events, so no source was checked"

    for event in events:
        url = urlparse(event.source)
        assert url.scheme == "https", f"{event.id}: source is not an https URL: {event.source!r}"

        dates = [date.fromisoformat(event.start_date)]
        if event.end_date is not None:
            dates.append(date.fromisoformat(event.end_date))
        allowed_months = {_MONTHS[d.month - 1] for d in dates}
        allowed_years = {str(d.year) for d in dates}

        path = unquote(url.path).lower()
        named_months = set(re.split(r"[^a-z]+", path)) & set(_MONTHS)
        named_years = set(re.findall(r"(?<!\d)((?:19|20)\d{2})(?!\d)", path))

        assert named_months <= allowed_months, f"{event.id}: source names {sorted(named_months)}: {event.source}"
        assert named_years <= allowed_years, f"{event.id}: source names {sorted(named_years)}: {event.source}"


def test_the_registry_reads_the_folder_the_categories_file_is_in():
    """If the loader's folder and the committed files drift apart, every test above passes
    against files nothing reads."""
    assert (EVENTS_DIR / CATEGORIES_FILE).exists()


def test_the_events_route_serves_the_committed_events_with_origin():
    response = client.get("/api/v1/market/events")

    assert response.status_code == 200, response.text
    payload = response.json()
    iran = [event for event in payload if event["start_date"] == "2026-02-28"]
    assert iran and iran[0]["origin"] == "builtin"
    assert all(event["source"] for event in payload if event["origin"] != "user")


def test_the_events_route_limits_to_the_requested_range():
    response = client.get("/api/v1/market/events", params={"start": "2026-02-01", "end": "2026-02-28"})

    assert response.status_code == 200, response.text
    assert {event["start_date"][:7] for event in response.json()} == {"2026-02"}


def test_a_malformed_range_is_a_422_naming_the_parameter():
    response = client.get("/api/v1/market/events", params={"start": "20260201"})

    assert response.status_code == 422
    assert "start" in response.text


def test_the_categories_route_serves_resolved_categories():
    response = client.get("/api/v1/market/event-categories")

    assert response.status_code == 200, response.text
    by_id = {category["id"]: category for category in response.json()}
    assert by_id["fomc"] == {
        "id": "fomc", "label": "Fed rate decisions", "color": "#E54545",
        "origin": "builtin", "visible": True, "overridden": False,
    }
