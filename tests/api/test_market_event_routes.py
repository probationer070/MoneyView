"""Write routes for user events and categories, over the committed built-ins.

Each test gets its own SQLite file (`_isolated_db`), and the committed events folder is read
as-is, except in the removed-category test, which points the registry at a copy.
"""

import json
import shutil

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.events import registry

client = TestClient(app)
EVENTS = "/api/v1/market/events"
CATEGORIES = "/api/v1/market/event-categories"


def _create_event(**overrides):
    return client.post(EVENTS, json={"label": "Bought AAPL", "category": "geopolitical", "start_date": "2026-03-02", **overrides})


def _categories():
    return {category["id"]: category for category in client.get(CATEGORIES).json()}


# --- user events ---------------------------------------------------------------------------

def test_a_created_user_event_is_served_with_user_origin_and_no_source():
    response = _create_event()

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["id"].startswith("user-") and created["origin"] == "user" and created["source"] is None
    served = [event for event in client.get(EVENTS).json() if event["id"] == created["id"]]
    assert served == [created]


@pytest.mark.parametrize("overrides, field", [
    ({"category": "no-such-category"}, "category"),
    ({"start_date": "2026-03-02", "end_date": "2026-03-01"}, "before it starts"),
    ({"start_date": "20260302"}, "start_date"),
    ({"label": "   "}, "label"),
    ({"source": "ftp://example.com"}, "http"),
    ({"origin": "builtin"}, "origin"),
])
def test_an_invalid_user_event_is_a_422_naming_the_problem(overrides, field):
    response = _create_event(**overrides)

    assert response.status_code == 422, response.text
    assert field in response.text


def test_a_user_event_can_be_edited_then_deleted():
    event_id = _create_event().json()["id"]

    edited = client.put(f"{EVENTS}/{event_id}", json={"label": "Sold AAPL", "category": "fomc", "start_date": "2026-03-04"})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["label"], edited.json()["category"]) == ("Sold AAPL", "fomc")

    assert client.delete(f"{EVENTS}/{event_id}").status_code == 204
    assert all(event["id"] != event_id for event in client.get(EVENTS).json())


@pytest.mark.parametrize("event_id", ["us-iran-strikes-begin-2026-02-28", "quad-witching-2026-03-20"])
def test_builtin_and_rule_events_cannot_be_edited_or_deleted(event_id):
    body = {"label": "x", "category": "geopolitical", "start_date": "2026-03-02"}

    assert client.put(f"{EVENTS}/{event_id}", json=body).status_code == 409
    response = client.delete(f"{EVENTS}/{event_id}")
    assert response.status_code == 409
    assert "data file" in response.text


def test_an_unknown_event_id_is_a_404():
    assert client.delete(f"{EVENTS}/user-999").status_code == 404
    assert client.delete(f"{EVENTS}/nothing-like-this").status_code == 404


def test_a_deleted_user_event_id_is_not_given_to_the_next_event():
    first = _create_event().json()["id"]
    client.delete(f"{EVENTS}/{first}")

    assert _create_event().json()["id"] != first


# --- categories ----------------------------------------------------------------------------

def test_a_builtin_color_override_marks_the_category_overridden():
    response = client.patch(f"{CATEGORIES}/fomc", json={"color": "#0000FF"})

    assert response.status_code == 200, response.text
    assert (response.json()["color"], response.json()["overridden"]) == ("#0000FF", True)
    assert _categories()["fomc"]["color"] == "#0000FF", "the override persists"


def test_resetting_restores_the_file_color_and_keeps_visibility():
    client.patch(f"{CATEGORIES}/fomc", json={"color": "#0000FF", "visible": False})

    assert client.delete(f"{CATEGORIES}/fomc/override").status_code == 204

    fomc = _categories()["fomc"]
    assert (fomc["color"], fomc["overridden"], fomc["visible"]) == ("#E54545", False, False)


def test_reset_is_idempotent():
    assert client.delete(f"{CATEGORIES}/fomc/override").status_code == 204
    assert client.delete(f"{CATEGORIES}/fomc/override").status_code == 204


def test_reset_is_a_409_for_a_user_category_and_a_404_for_an_unknown_id():
    client.post(CATEGORIES, json={"label": "My trades", "color": "#4589E5"})

    assert client.delete(f"{CATEGORIES}/user-my-trades/override").status_code == 409
    assert client.delete(f"{CATEGORIES}/no-such/override").status_code == 404


def test_a_user_category_gets_a_user_prefixed_id_and_duplicates_are_refused():
    created = client.post(CATEGORIES, json={"label": "My trades!", "color": "#4589E5"})

    assert created.status_code == 201, created.text
    assert created.json() == {
        "id": "user-my-trades", "label": "My trades!", "color": "#4589E5",
        "origin": "user", "visible": True, "overridden": False,
    }
    duplicate = client.post(CATEGORIES, json={"label": "my trades", "color": "#000000"})
    assert duplicate.status_code == 422
    assert "already exists" in duplicate.text


@pytest.mark.parametrize("body", [{"label": "x", "color": "blue"}, {"label": "!!!", "color": "#000000"}])
def test_an_invalid_new_category_is_a_422(body):
    assert client.post(CATEGORIES, json=body).status_code == 422


def test_patching_an_unknown_category_is_a_404():
    assert client.patch(f"{CATEGORIES}/no-such", json={"visible": False}).status_code == 404


def test_a_builtin_category_cannot_be_deleted():
    assert client.delete(f"{CATEGORIES}/fomc").status_code == 409


def test_a_category_in_use_cannot_be_deleted_and_the_message_counts_its_events():
    client.post(CATEGORIES, json={"label": "My trades", "color": "#4589E5"})
    _create_event(category="user-my-trades")
    _create_event(category="user-my-trades")

    response = client.delete(f"{CATEGORIES}/user-my-trades")

    assert response.status_code == 409
    assert "2 events" in response.text


def test_an_unused_user_category_is_deleted():
    client.post(CATEGORIES, json={"label": "My trades", "color": "#4589E5"})

    assert client.delete(f"{CATEGORIES}/user-my-trades").status_code == 204
    assert "user-my-trades" not in _categories()


def test_visibility_persists_across_requests():
    client.patch(f"{CATEGORIES}/geopolitical", json={"visible": False})

    assert _categories()["geopolitical"]["visible"] is False


def test_a_category_removed_from_the_file_is_not_resurrected_and_its_user_events_fall_back(tmp_path, monkeypatch):
    for path in registry.EVENTS_DIR.glob("*.json"):
        shutil.copy(path, tmp_path / path.name)
    monkeypatch.setattr(registry, "EVENTS_DIR", tmp_path)

    client.patch(f"{CATEGORIES}/geopolitical", json={"color": "#0000FF"})
    event_id = _create_event(category="geopolitical").json()["id"]

    # A later commit removes the category, and the file events that used it.
    categories = json.loads((tmp_path / "categories.json").read_text(encoding="utf-8"))
    categories["categories"] = [c for c in categories["categories"] if c["id"] != "geopolitical"]
    (tmp_path / "categories.json").write_text(json.dumps(categories), encoding="utf-8")
    (tmp_path / "geopolitical.json").unlink()

    assert "geopolitical" not in _categories(), "the stale override must not recreate the category"
    response = client.get(EVENTS)
    assert response.status_code == 200, response.text
    [event] = [e for e in response.json() if e["id"] == event_id]
    assert (event["category"], event["missing_category"]) == ("uncategorized", "geopolitical")
