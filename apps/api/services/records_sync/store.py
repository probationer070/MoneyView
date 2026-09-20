"""SQLite side of records peer sync (spec §3): uid backfill, local state, whole-tree apply,
stamps and tombstones. Every function takes an open connection and never opens its own, so a
caller can hold one transaction across several of them.
"""

from __future__ import annotations

import secrets
import sqlite3

from apps.api.services.peer_sync.model import BASELINE_TS, next_stamp
from apps.api.services.records_sync.kinds import KINDS, ChildSpec, Kind
from apps.api.services.records_sync.merge import Record, RecordState, RecordTombstone


def backfill_uids(conn: sqlite3.Connection) -> int:
    """Give every row of a generated-uid table a sync_uid, once. Returns how many were filled."""
    filled = 0
    for kind in KINDS.values():
        if not kind.generates_uid:
            continue
        rows = conn.execute(f"SELECT id FROM {kind.table} WHERE {kind.uid_column} IS NULL").fetchall()
        for row in rows:
            conn.execute(
                f"UPDATE {kind.table} SET {kind.uid_column} = ? WHERE id = ?",
                (secrets.token_hex(16), row["id"]),
            )
            filled += 1
    return filled


def _local_rows(conn: sqlite3.Connection, kind: Kind) -> list[tuple[str, sqlite3.Row]]:
    """Every existing local row of a kind's table, paired with its cross-PC uid."""
    if kind.singleton_uid is not None:
        row = conn.execute(f"SELECT * FROM {kind.table} WHERE {kind.uid_column} = 1").fetchone()
        return [(kind.singleton_uid, row)] if row is not None else []
    return [
        (row[kind.uid_column], row)
        for row in conn.execute(f"SELECT * FROM {kind.table}")
        if row[kind.uid_column] is not None
    ]


def _local_uids(conn: sqlite3.Connection, kind: Kind) -> list[str]:
    return [uid for uid, _ in _local_rows(conn, kind)]


def _local_row(conn: sqlite3.Connection, kind: Kind, uid: str) -> sqlite3.Row | None:
    if kind.singleton_uid is not None:
        return conn.execute(f"SELECT * FROM {kind.table} WHERE {kind.uid_column} = 1").fetchone()
    return conn.execute(f"SELECT * FROM {kind.table} WHERE {kind.uid_column} = ?", (uid,)).fetchone()


def _delete_by_uid(conn: sqlite3.Connection, kind: Kind, uid: str) -> None:
    if kind.singleton_uid is not None:
        conn.execute(f"DELETE FROM {kind.table} WHERE {kind.uid_column} = 1")
    else:
        conn.execute(f"DELETE FROM {kind.table} WHERE {kind.uid_column} = ?", (uid,))


def ensure_first_sync(conn: sqlite3.Connection, pc_id: str) -> None:
    """Stamp every existing record that has no record_sync row yet with the baseline, on every
    call: an unstamped record must never be published with an empty author (watchlist's Ruling
    R3, for the same reason)."""
    for kind in KINDS.values():
        for uid in _local_uids(conn, kind):
            conn.execute(
                "INSERT OR IGNORE INTO record_sync (kind, uid, updated_at, updated_by) VALUES (?, ?, ?, ?)",
                (kind.name, uid, BASELINE_TS, pc_id),
            )


def _read_child_rows(conn: sqlite3.Connection, child: ChildSpec, parent_id: int) -> list[dict]:
    items = []
    for row in conn.execute(
        f"SELECT * FROM {child.table} WHERE {child.parent_column} = ? ORDER BY rowid", (parent_id,)
    ):
        item = {c: row[c] for c in child.columns}
        for grandchild in child.children:
            item[grandchild.key] = _read_child_rows(conn, grandchild, row["id"])
        items.append(item)
    return items


def _payload_of_row(conn: sqlite3.Connection, kind: Kind, row: sqlite3.Row) -> dict:
    if kind.children:
        payload: dict = {"case": {c: row[c] for c in kind.columns}}
        for child in kind.children:
            payload[child.key] = _read_child_rows(conn, child, row["id"])
        return payload
    return {c: row[c] for c in kind.columns}


def read_local_state(conn: sqlite3.Connection) -> RecordState:
    """The local database, shaped as a RecordState. record_sync can hold both an add and a remove
    for the same (kind, uid) at once (a re-add locally, or a merged state where an add newer than
    its tombstone kept the record while the tombstone -- ineffective or not -- is kept too, spec
    §5). Presence is decided by comparing keys, the same rule merge.py uses: a record is present
    unless its remove_key is strictly greater than its add_key -- never by "removed_at is not
    null" alone, which would treat every re-added-after-delete record as absent."""
    records: dict[tuple[str, str], Record] = {}
    for kind in KINDS.values():
        for uid, row in _local_rows(conn, kind):
            sync = conn.execute(
                "SELECT updated_at, updated_by, removed_at, removed_by FROM record_sync WHERE kind = ? AND uid = ?",
                (kind.name, uid),
            ).fetchone()
            if sync is None or sync["updated_at"] is None:
                continue
            record = Record(
                kind.name, uid, sync["updated_at"], sync["updated_by"], _payload_of_row(conn, kind, row)
            )
            if sync["removed_at"] is not None:
                tombstone = RecordTombstone(kind.name, uid, sync["removed_at"], sync["removed_by"])
                if tombstone.remove_key() > record.add_key():
                    continue
            records[(kind.name, uid)] = record
    removed = {
        (row["kind"], row["uid"]): RecordTombstone(row["kind"], row["uid"], row["removed_at"], row["removed_by"])
        for row in conn.execute(
            "SELECT kind, uid, removed_at, removed_by FROM record_sync WHERE removed_at IS NOT NULL"
        )
    }
    return RecordState(records=records, removed=removed)


def _natural_key_value(kind: Kind, payload: dict) -> object:
    return payload["case"][kind.natural_key] if kind.children else payload[kind.natural_key]


def _with_natural_key(kind: Kind, payload: dict, value: str) -> dict:
    if kind.children:
        case = dict(payload["case"])
        case[kind.natural_key] = value
        return {**payload, "case": case}
    resolved = dict(payload)
    resolved[kind.natural_key] = value
    return resolved


def _resolve_natural_key_clashes(kind: Kind, incoming: dict[str, Record]) -> tuple[dict[str, str], list[str]]:
    """For a kind with a UNIQUE natural_key column: when two incoming uids want the same value,
    the one with the larger order_key() keeps it and the rest are renamed. Returns {uid: new
    value} for every loser, and the flat list of renames for the caller to report."""
    if kind.natural_key is None:
        return {}, []

    groups: dict[str, list[str]] = {}
    for uid, record in incoming.items():
        groups.setdefault(_natural_key_value(kind, record.payload), []).append(uid)

    used = set(groups)
    resolved: dict[str, str] = {}
    renames: list[str] = []
    for value, uids in sorted(groups.items()):
        if len(uids) < 2:
            continue
        ranked = sorted(uids, key=lambda u: incoming[u].order_key())
        for loser in ranked[:-1]:
            base = f"{value} (from {incoming[loser].updated_by})"
            candidate = base
            suffix = 2
            while candidate in used:
                candidate = f"{base} ({suffix})"
                suffix += 1
            used.add(candidate)
            resolved[loser] = candidate
            renames.append(candidate)
    return resolved, renames


def _insert_child(conn: sqlite3.Connection, child: ChildSpec, parent_id: int, payload: dict) -> None:
    columns = list(child.columns) + [child.parent_column]
    values = [payload[c] for c in child.columns] + [parent_id]
    cursor = conn.execute(
        f"INSERT INTO {child.table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
        values,
    )
    for grandchild in child.children:
        for row in payload[grandchild.key]:
            _insert_child(conn, grandchild, cursor.lastrowid, row)


def _insert_record(conn: sqlite3.Connection, kind: Kind, uid: str, payload: dict) -> None:
    if kind.children:
        columns = list(kind.columns)
        values = [payload["case"][c] for c in columns]
        if kind.generates_uid:
            columns = columns + [kind.uid_column]
            values = values + [uid]
        cursor = conn.execute(
            f"INSERT INTO {kind.table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
            values,
        )
        for child in kind.children:
            for row in payload[child.key]:
                _insert_child(conn, child, cursor.lastrowid, row)
        return

    columns = list(kind.columns)
    values = [payload[c] for c in columns]
    if kind.singleton_uid is not None:
        columns = columns + [kind.uid_column]
        values = values + [1]
    elif kind.generates_uid:
        columns = columns + [kind.uid_column]
        values = values + [uid]
    # A natural-identity kind (event_category, event_category_visibility) already carries its
    # uid_column in kind.columns, so nothing more to add.
    conn.execute(
        f"INSERT INTO {kind.table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
        values,
    )


def _upsert_added(conn: sqlite3.Connection, kind: str, uid: str, updated_at: str, updated_by: str) -> None:
    """Write the add half of record_sync only. Never touches removed_at/removed_by: a present
    record can also carry a tombstone (an add newer than its tombstone, or a local re-add), and
    that tombstone must survive to be republished (spec §5 keeps every tombstone)."""
    conn.execute(
        """INSERT INTO record_sync (kind, uid, updated_at, updated_by) VALUES (?, ?, ?, ?)
           ON CONFLICT(kind, uid) DO UPDATE SET updated_at = excluded.updated_at,
               updated_by = excluded.updated_by""",
        (kind, uid, updated_at, updated_by),
    )


def _upsert_removed(conn: sqlite3.Connection, kind: str, uid: str, removed_at: str, removed_by: str) -> None:
    """Write the remove half of record_sync only. Never touches updated_at/updated_by, for the
    same reason: a tombstone older than the record it was applied alongside must not erase that
    record's stamp."""
    conn.execute(
        """INSERT INTO record_sync (kind, uid, removed_at, removed_by) VALUES (?, ?, ?, ?)
           ON CONFLICT(kind, uid) DO UPDATE SET removed_at = excluded.removed_at,
               removed_by = excluded.removed_by""",
        (kind, uid, removed_at, removed_by),
    )


def apply_state(conn: sqlite3.Connection, state: RecordState) -> list[str]:
    """Make the local tables equal the merged state. A valuation case is replaced whole: its row
    and all its segments and narratives, never a field at a time. Returns the renames it had to
    perform to resolve a natural_key clash."""
    renamed: list[str] = []
    for kind in KINDS.values():
        for uid in _local_uids(conn, kind):
            if (kind.name, uid) not in state.records:
                _delete_by_uid(conn, kind, uid)

        incoming = {uid: record for (k, uid), record in state.records.items() if k == kind.name}
        if not incoming:
            continue

        resolved, kind_renames = _resolve_natural_key_clashes(kind, incoming)
        renamed.extend(kind_renames)

        to_insert: dict[str, dict] = {}
        for uid, record in incoming.items():
            payload = _with_natural_key(kind, record.payload, resolved[uid]) if uid in resolved else record.payload
            local_row = _local_row(conn, kind, uid)
            local_payload = _payload_of_row(conn, kind, local_row) if local_row is not None else None
            if local_payload == payload:
                continue
            to_insert[uid] = payload

        # Two passes, not one uid at a time: a natural_key value can MOVE between two surviving
        # uids (X="Alpha" -> "Beta", Y="Beta" -> "Gamma") without ever clashing within the
        # incoming batch. Deleting and inserting one uid at a time would then depend on order --
        # X inserted first collides with Y's still-present old value. Deleting every row that is
        # about to be rewritten first, before any insert, removes that ordering dependence.
        for uid in to_insert:
            if _local_row(conn, kind, uid) is not None:
                _delete_by_uid(conn, kind, uid)
        for uid, payload in to_insert.items():
            _insert_record(conn, kind, uid, payload)

    for (kind_name, uid), record in state.records.items():
        _upsert_added(conn, kind_name, uid, record.updated_at, record.updated_by)
    for (kind_name, uid), tomb in state.removed.items():
        _upsert_removed(conn, kind_name, uid, tomb.removed_at, tomb.removed_by)

    return renamed


def _causal_stamp(conn: sqlite3.Connection, kind: str, uid: str) -> str:
    """A stamp for a local change to (kind, uid) that outranks the version and the tombstone the
    user saw, even when those came from a peer whose clock runs ahead of this PC's."""
    row = conn.execute(
        "SELECT updated_at, removed_at FROM record_sync WHERE kind = ? AND uid = ?", (kind, uid)
    ).fetchone()
    seen = [value for value in (row and row["updated_at"], row and row["removed_at"]) if value]
    return next_stamp(after=max(seen, default=None))


def stamp(conn: sqlite3.Connection, kind: str, uid: str, pc_id: str) -> None:
    """Record a local add/edit of (kind, uid). Does not clear removed_at/removed_by: a local
    re-add already outranks its own tombstone by key (the causal stamp's `after` is the greater
    of the record's and the tombstone's current stamp), and the tombstone must survive to be
    republished (spec §5 keeps every tombstone, including ones a newer add makes ineffective)."""
    _upsert_added(conn, kind, uid, _causal_stamp(conn, kind, uid), pc_id)


def record_removal(conn: sqlite3.Connection, kind: str, uid: str, pc_id: str) -> None:
    """Call before (or after) deleting the local row: the tombstone outranks the version being
    removed, even when that version came from a peer whose clock runs ahead of this PC's. Does
    not touch updated_at/updated_by, for the same reason `stamp` does not touch removed_at/by."""
    _upsert_removed(conn, kind, uid, _causal_stamp(conn, kind, uid), pc_id)


def uid_of(conn: sqlite3.Connection, kind: str, local_id) -> str | None:
    """The uid for a local row, so a write path can stamp what it just wrote. For a singleton
    kind, the uid is the fixed singleton_uid. For a natural-identity kind, the local id already
    is the uid (uid_column is the table's own primary key). Only a generated-uid kind needs an
    actual lookup, from its surrogate integer id to its sync_uid."""
    spec = KINDS[kind]
    if spec.singleton_uid is not None:
        return spec.singleton_uid
    if spec.generates_uid:
        row = conn.execute(f"SELECT {spec.uid_column} FROM {spec.table} WHERE id = ?", (local_id,)).fetchone()
        return row[0] if row else None
    return local_id
