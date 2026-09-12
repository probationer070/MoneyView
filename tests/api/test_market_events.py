"""Market events are asserted facts, so the loader's job is to refuse unsourced ones.

These dates cannot be derived from price data -- a military operation's start is a claim
about the world, not a computation over bars -- so the only thing standing between the chart
and an authoritative-looking line at a made-up date is the requirement that every event cite
where it came from. That requirement is the feature, and it is what these tests pin.
"""

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.services.market_events import MARKET_EVENTS_JSON, load_market_events


def _write_events(path: Path, events: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"events": events}, indent=2), encoding="utf-8")


def _event(**overrides) -> dict:
    base = {
        "id": "test-event",
        "label": "Test event",
        "category": "geopolitical",
        "start_date": "2026-02-28",
        "end_date": None,
        "source": "https://example.com/timeline",
        "note": "",
    }
    base.update(overrides)
    return base


def test_the_committed_file_carries_the_iran_operation_start(tmp_path):
    """The fact the feature exists for. Pinned here because a chart marking the wrong day
    is worse than a chart marking nothing -- every read taken off it would be wrong, and
    nothing about the line would look amiss."""
    events = load_market_events()

    iran = [event for event in events if "iran" in event.id.lower()]
    assert len(iran) == 1, f"expected exactly one Iran event, got {[e.id for e in iran]}"
    assert iran[0].start_date == "2026-02-28"
    assert iran[0].source, "an asserted date with no source is exactly what this forbids"


def test_an_event_without_a_source_is_refused(tmp_path):
    """Loudly, not by skipping it. A skipped event is a line that silently does not appear,
    which reads as 'nothing happened then' -- a false statement the reader cannot detect."""
    path = tmp_path / "market_events.json"
    _write_events(path, [_event(source="")])

    with pytest.raises(ValueError) as excinfo:
        load_market_events(path)

    assert "source" in str(excinfo.value)
    assert "test-event" in str(excinfo.value), "the message must name which event is unsourced"


def test_an_event_with_an_unparseable_date_is_refused(tmp_path):
    """A typo in a committed date would otherwise place the line somewhere arbitrary, or
    nowhere, with no error -- the chart cannot tell a bad date from a quiet day."""
    path = tmp_path / "market_events.json"
    _write_events(path, [_event(start_date="28-02-2026")])

    with pytest.raises(ValueError) as excinfo:
        load_market_events(path)

    assert "start_date" in str(excinfo.value) or "date" in str(excinfo.value)


def test_a_well_formed_event_round_trips(tmp_path):
    path = tmp_path / "market_events.json"
    _write_events(path, [_event(id="ok-1", label="Something", start_date="2026-03-02")])

    events = load_market_events(path)

    assert len(events) == 1
    assert events[0].id == "ok-1"
    assert events[0].start_date == "2026-03-02"
    assert events[0].end_date is None


def test_a_missing_file_yields_no_events_rather_than_raising(tmp_path):
    """A chart with no events is a normal state; a chart that 500s because a file is absent
    is not. This is the one failure mode that must stay quiet."""
    assert load_market_events(tmp_path / "absent.json") == []


def test_the_route_serves_the_committed_events():
    response = TestClient(app).get("/api/v1/market/events")

    assert response.status_code == 200
    payload = response.json()
    assert any(event["start_date"] == "2026-02-28" for event in payload), payload
    assert all(event["source"] for event in payload), "the route must not serve an unsourced event"


def test_the_committed_file_is_where_the_service_says_it_is():
    """The loader's default path and the committed file must be the same file. If they drift,
    every test above passes against a file nothing reads."""
    assert MARKET_EVENTS_JSON.exists(), f"{MARKET_EVENTS_JSON} does not exist"
    assert json.loads(MARKET_EVENTS_JSON.read_text(encoding="utf-8"))["events"]
