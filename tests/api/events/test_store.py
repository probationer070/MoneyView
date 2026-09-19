"""SQL for user events, category rows and visibility. `_isolated_db` gives each test its own file."""

from apps.api.models.schemas import MarketEventInput
from apps.api.services.db import get_db
from apps.api.services.events import store
from apps.api.services.events.categories import CategoryRow


def _input(**overrides):
    return MarketEventInput(**{"label": "Bought AAPL", "category": "geopolitical", "start_date": "2026-03-02", **overrides})


def test_a_user_event_round_trips_with_user_origin_and_prefixed_id():
    with get_db() as conn:
        created = store.insert_user_event(conn, _input(source="", note="first lot"))
        listed = store.list_user_events(conn)

    assert created.id.startswith("user-") and created.origin == "user"
    assert created.source is None, "a blank source is stored as absent, not as an empty citation"
    assert listed == [created]


def test_a_deleted_user_event_id_is_never_reused():
    # AUTOINCREMENT: without it SQLite reuses the largest rowid after that row is deleted, so a
    # new event could take the id of one the page still shows as deleted.
    with get_db() as conn:
        first = store.insert_user_event(conn, _input())
        assert store.delete_user_event(conn, int(first.id.removeprefix("user-")))
        second = store.insert_user_event(conn, _input())

    assert second.id != first.id


def test_update_and_delete_report_a_missing_row():
    with get_db() as conn:
        assert store.update_user_event(conn, 999, _input()) is None
        assert store.delete_user_event(conn, 999) is False


def test_an_override_upsert_keeps_the_field_it_was_not_given():
    with get_db() as conn:
        store.upsert_category_override(conn, "fomc", label=None, color="#0000FF")
        store.upsert_category_override(conn, "fomc", label="Rates", color=None)
        rows = store.list_category_rows(conn)

    assert rows == [CategoryRow(id="fomc", kind="override", label="Rates", color="#0000FF")]


def test_deleting_a_user_category_removes_its_visibility_row():
    with get_db() as conn:
        store.insert_user_category(conn, "user-mine", "Mine", "#4589E5")
        store.set_visibility(conn, "user-mine", False)
        store.delete_user_category(conn, "user-mine")

        assert store.list_category_rows(conn) == []
        assert store.list_visibility(conn) == {}


def test_visibility_is_an_upsert():
    with get_db() as conn:
        store.set_visibility(conn, "fomc", False)
        store.set_visibility(conn, "fomc", True)

        assert store.list_visibility(conn) == {"fomc": True}


def test_events_in_a_category_are_counted():
    with get_db() as conn:
        store.insert_user_event(conn, _input(category="user-mine"))
        store.insert_user_event(conn, _input(category="user-mine"))
        store.insert_user_event(conn, _input(category="geopolitical"))

        assert store.count_user_events_in_category(conn, "user-mine") == 2
