"""SQL for user events, category rows and visibility. No validation here: service.py does it."""

from __future__ import annotations

import secrets
import sqlite3

from apps.api.models.schemas import MarketEvent, MarketEventInput
from apps.api.services.events.categories import CategoryRow
from apps.api.services.records_sync import store as records_sync_store
from apps.api.services.records_sync.kinds import KIND_CATEGORY, KIND_USER_EVENT, KIND_VISIBILITY
from apps.api.services.records_sync.service import is_enabled as records_sync_enabled
from apps.api.services.watchlist_sync.store import get_or_create_pc_id

USER_EVENT_PREFIX = "user-"


def _blank_to_none(value: str | None) -> str | None:
    return value.strip() if value and value.strip() else None


def _to_event(row: sqlite3.Row) -> MarketEvent:
    return MarketEvent(
        id=f"{USER_EVENT_PREFIX}{row['id']}",
        label=row["label"],
        category=row["category"],
        start_date=row["start_date"],
        end_date=row["end_date"],
        source=row["source"],
        note=row["note"],
        origin="user",
    )


def list_user_events(conn: sqlite3.Connection) -> list[MarketEvent]:
    return [_to_event(row) for row in conn.execute("SELECT * FROM user_event ORDER BY start_date, id").fetchall()]


def get_user_event(conn: sqlite3.Connection, number: int) -> MarketEvent | None:
    row = conn.execute("SELECT * FROM user_event WHERE id = ?", (number,)).fetchone()
    return _to_event(row) if row else None


def _values(payload: MarketEventInput) -> tuple:
    return (
        payload.label.strip(),
        payload.category,
        payload.start_date,
        payload.end_date,
        _blank_to_none(payload.source),
        payload.note.strip(),
    )


def insert_user_event(conn: sqlite3.Connection, payload: MarketEventInput) -> MarketEvent:
    sync_uid = secrets.token_hex(16)
    cursor = conn.execute(
        "INSERT INTO user_event (label, category, start_date, end_date, source, note, sync_uid) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (*_values(payload), sync_uid),
    )
    records_sync_store.stamp(conn, KIND_USER_EVENT, sync_uid, get_or_create_pc_id(conn))
    return get_user_event(conn, cursor.lastrowid)


def update_user_event(conn: sqlite3.Connection, number: int, payload: MarketEventInput) -> MarketEvent | None:
    cursor = conn.execute(
        "UPDATE user_event SET label = ?, category = ?, start_date = ?, end_date = ?, source = ?, note = ? WHERE id = ?",
        (*_values(payload), number),
    )
    if not cursor.rowcount:
        return None
    uid = records_sync_store.uid_of(conn, KIND_USER_EVENT, number)
    if uid is not None:
        records_sync_store.stamp(conn, KIND_USER_EVENT, uid, get_or_create_pc_id(conn))
    return get_user_event(conn, number)


def delete_user_event(conn: sqlite3.Connection, number: int) -> bool:
    if records_sync_enabled():
        uid = records_sync_store.uid_of(conn, KIND_USER_EVENT, number)
        if uid is not None:
            records_sync_store.record_removal(conn, KIND_USER_EVENT, uid, get_or_create_pc_id(conn))
    return conn.execute("DELETE FROM user_event WHERE id = ?", (number,)).rowcount > 0


def count_user_events_in_category(conn: sqlite3.Connection, category_id: str) -> int:
    return conn.execute("SELECT COUNT(*) FROM user_event WHERE category = ?", (category_id,)).fetchone()[0]


def list_category_rows(conn: sqlite3.Connection) -> list[CategoryRow]:
    rows = conn.execute("SELECT id, kind, label, color FROM event_category ORDER BY created_at, id").fetchall()
    return [CategoryRow(id=row["id"], kind=row["kind"], label=row["label"], color=row["color"]) for row in rows]


def list_visibility(conn: sqlite3.Connection) -> dict[str, bool]:
    rows = conn.execute("SELECT category_id, visible FROM event_category_visibility").fetchall()
    return {row["category_id"]: bool(row["visible"]) for row in rows}


def upsert_category_override(conn: sqlite3.Connection, category_id: str, *, label: str | None, color: str | None) -> None:
    conn.execute(
        """INSERT INTO event_category (id, kind, label, color) VALUES (?, 'override', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label = COALESCE(excluded.label, event_category.label),
             color = COALESCE(excluded.color, event_category.color)""",
        (category_id, label, color),
    )
    records_sync_store.stamp(conn, KIND_CATEGORY, category_id, get_or_create_pc_id(conn))


def delete_category_override(conn: sqlite3.Connection, category_id: str) -> None:
    if records_sync_enabled():
        records_sync_store.record_removal(conn, KIND_CATEGORY, category_id, get_or_create_pc_id(conn))
    conn.execute("DELETE FROM event_category WHERE id = ? AND kind = 'override'", (category_id,))


def insert_user_category(conn: sqlite3.Connection, category_id: str, label: str, color: str) -> None:
    conn.execute("INSERT INTO event_category (id, kind, label, color) VALUES (?, 'user', ?, ?)", (category_id, label, color))
    records_sync_store.stamp(conn, KIND_CATEGORY, category_id, get_or_create_pc_id(conn))


def update_user_category(conn: sqlite3.Connection, category_id: str, *, label: str | None, color: str | None) -> None:
    conn.execute(
        "UPDATE event_category SET label = COALESCE(?, label), color = COALESCE(?, color) WHERE id = ? AND kind = 'user'",
        (label, color, category_id),
    )
    records_sync_store.stamp(conn, KIND_CATEGORY, category_id, get_or_create_pc_id(conn))


def delete_user_category(conn: sqlite3.Connection, category_id: str) -> None:
    if records_sync_enabled():
        pc_id = get_or_create_pc_id(conn)
        records_sync_store.record_removal(conn, KIND_CATEGORY, category_id, pc_id)
        records_sync_store.record_removal(conn, KIND_VISIBILITY, category_id, pc_id)
    conn.execute("DELETE FROM event_category WHERE id = ? AND kind = 'user'", (category_id,))
    conn.execute("DELETE FROM event_category_visibility WHERE category_id = ?", (category_id,))


def set_visibility(conn: sqlite3.Connection, category_id: str, visible: bool) -> None:
    conn.execute(
        """INSERT INTO event_category_visibility (category_id, visible) VALUES (?, ?)
           ON CONFLICT(category_id) DO UPDATE SET visible = excluded.visible""",
        (category_id, int(visible)),
    )
    records_sync_store.stamp(conn, KIND_VISIBILITY, category_id, get_or_create_pc_id(conn))
