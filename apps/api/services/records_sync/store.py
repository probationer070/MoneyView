"""SQLite side of records peer sync (spec §3): uid backfill, local state, whole-tree apply,
stamps and tombstones. Every function takes an open connection and never opens its own, so a
caller can hold one transaction across several of them.
"""

from __future__ import annotations

import secrets
import sqlite3

from apps.api.services.peer_sync.model import BASELINE_TS, SEED_TS, next_stamp
from apps.api.services.records_sync.kinds import KIND_PREFERENCES, KINDS, PARENT_UID_KEY, ChildSpec, Kind
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


def _locator(kind: Kind, uid: str) -> tuple[str, tuple]:
    """The WHERE clause and its parameters that find a kind's local row by its cross-PC uid."""
    if kind.singleton_uid is not None:
        return f"{kind.uid_column} = 1", ()
    return f"{kind.uid_column} = ?", (uid,)


def _delete_by_uid(conn: sqlite3.Connection, kind: Kind, uid: str) -> None:
    where, params = _locator(kind, uid)
    conn.execute(f"DELETE FROM {kind.table} WHERE {where}", params)


def ensure_first_sync(conn: sqlite3.Connection, pc_id: str) -> None:
    """Stamp every existing record that has no record_sync row yet with the baseline, on every
    call: an unstamped record must never be published with an empty author (watchlist's Ruling
    R3, for the same reason).

    A portfolio_preferences row whose own updated_at column is still '' (init_db's never-saved
    default, on every fresh database) is stamped at SEED_TS instead: BASELINE_TS would let that
    default tie -- and possibly outrank, on the pc_id tiebreak -- a real setting saved on another
    PC before sync existed there, whose own updated_at is non-empty and so still gets BASELINE_TS.
    """
    for kind in KINDS.values():
        for uid, row in _local_rows(conn, kind):
            stamp = SEED_TS if kind.name == KIND_PREFERENCES and row["updated_at"] == "" else BASELINE_TS
            conn.execute(
                "INSERT OR IGNORE INTO record_sync (kind, uid, updated_at, updated_by) VALUES (?, ?, ?, ?)",
                (kind.name, uid, stamp, pc_id),
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


def _lineage_uid(conn: sqlite3.Connection, kind: Kind, row: sqlite3.Row) -> str | None:
    """The uid of the row this row's lineage column points at, or None."""
    parent_id = row[kind.lineage_column]
    if parent_id is None:
        return None
    parent = conn.execute(f"SELECT {kind.uid_column} FROM {kind.table} WHERE id = ?", (parent_id,)).fetchone()
    return parent[0] if parent is not None else None


def _payload_of_row(conn: sqlite3.Connection, kind: Kind, row: sqlite3.Row) -> dict:
    if kind.children:
        payload: dict = {"case": {c: row[c] for c in kind.columns}}
        if kind.lineage_column:
            payload["case"][PARENT_UID_KEY] = _lineage_uid(conn, kind, row)
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


def _resolve_natural_key_clashes(kind: Kind, incoming: dict[str, Record]) -> dict[str, str]:
    """For a kind with a UNIQUE natural_key column: when two incoming uids want the same value,
    the one with the larger order_key() keeps it and the rest are renamed. Both copies are kept.
    Returns {uid: new value} for every loser -- on every sync, not only the one that first
    repairs the clash, since the merged state always carries the original values."""
    if kind.natural_key is None:
        return {}

    groups: dict[str, list[str]] = {}
    for uid, record in incoming.items():
        groups.setdefault(_natural_key_value(kind, record.payload), []).append(uid)

    used = set(groups)
    resolved: dict[str, str] = {}
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
    return resolved


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


def _write_record(conn: sqlite3.Connection, kind: Kind, uid: str, payload: dict, exists: bool) -> None:
    """UPDATE an existing row in place, keeping its local id (a local fork's parent_case_id points
    at it), or INSERT a new one; then insert its children, which the caller has already cleared."""
    row = payload["case"] if kind.children else payload
    columns = list(kind.columns)
    values = [row[c] for c in columns]
    if exists:
        where, params = _locator(kind, uid)
        conn.execute(
            f"UPDATE {kind.table} SET {', '.join(f'{c} = ?' for c in columns)} WHERE {where}",
            values + list(params),
        )
    else:
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
    if kind.children:
        record_id = _local_row(conn, kind, uid)["id"]
        for child in kind.children:
            for child_row in payload[child.key]:
                _insert_child(conn, child, record_id, child_row)


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
    """Make the local tables equal the merged state. A valuation case is replaced whole -- all its
    columns and all its segments and narratives, never a field at a time -- but its row is updated
    in place, keeping its local id, because a local fork's parent_case_id points at that id.
    Returns the renames this apply actually performed: a clash already repaired on an earlier sync
    is not reported again."""
    renamed: list[str] = []
    for kind in KINDS.values():
        absent = [uid for uid in _local_uids(conn, kind) if (kind.name, uid) not in state.records]
        incoming = {uid: record for (k, uid), record in state.records.items() if k == kind.name}

        resolved = _resolve_natural_key_clashes(kind, incoming)

        to_write: dict[str, dict] = {}
        existing: set[str] = set()
        for uid, record in incoming.items():
            payload = _with_natural_key(kind, record.payload, resolved[uid]) if uid in resolved else record.payload
            local_row = _local_row(conn, kind, uid)
            if uid in resolved and (local_row is None or local_row[kind.natural_key] != resolved[uid]):
                renamed.append(resolved[uid])
            local_payload = _payload_of_row(conn, kind, local_row) if local_row is not None else None
            if local_payload == payload:
                continue
            to_write[uid] = payload
            if local_row is not None:
                existing.add(uid)

        # Two passes, not one uid at a time: a natural_key value can MOVE between two surviving
        # uids (X="Alpha" -> "Beta", Y="Beta" -> "Gamma") without ever clashing within the
        # incoming batch. Writing one uid at a time would then depend on order -- X written first
        # collides with Y's still-present old value. Pass 1 parks every row about to be updated
        # under a unique temporary name (its own uid), deletes every absent row, and clears the
        # children of every row about to be updated; pass 2 then writes the real values.
        for uid in existing:
            if kind.natural_key is not None:
                where, params = _locator(kind, uid)
                conn.execute(f"UPDATE {kind.table} SET {kind.natural_key} = ? WHERE {where}", (uid, *params))
        for uid in absent:
            if kind.lineage_column:
                # A local fork of a case about to be deleted must let go of it first; the lineage
                # pass below leaves it NULL, because its parent is no longer present.
                conn.execute(
                    f"UPDATE {kind.table} SET {kind.lineage_column} = NULL WHERE {kind.lineage_column} IN "
                    f"(SELECT id FROM {kind.table} WHERE {kind.uid_column} = ?)",
                    (uid,),
                )
            _delete_by_uid(conn, kind, uid)
        for uid in existing:
            if kind.children:
                record_id = _local_row(conn, kind, uid)["id"]
                for child in kind.children:
                    # Grandchildren go with it: segment_narrative.segment_id is ON DELETE CASCADE.
                    conn.execute(f"DELETE FROM {child.table} WHERE {child.parent_column} = ?", (record_id,))
        for uid, payload in to_write.items():
            _write_record(conn, kind, uid, payload, exists=uid in existing)

        # Lineage last, once every row of the kind is in place: a fork can arrive in the same
        # batch as its parent, in either order. The parent's uid resolves to THIS PC's local id,
        # or to NULL when the parent is not present here.
        if kind.lineage_column:
            for uid, record in incoming.items():
                conn.execute(
                    f"UPDATE {kind.table} SET {kind.lineage_column} = "
                    f"(SELECT id FROM {kind.table} WHERE {kind.uid_column} = ?) WHERE {kind.uid_column} = ?",
                    (record.payload["case"][PARENT_UID_KEY], uid),
                )

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
