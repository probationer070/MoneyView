"""SQLite side of watchlist peer sync: pc_id, first-sync baseline, local state, stamps, tombstones."""

from __future__ import annotations

import platform
import re
import secrets
import sqlite3

from apps.api.services.watchlist_sync.model import BASELINE_TS, SyncRow, SyncState, Tombstone, next_stamp

PC_ID_DATASET = "watchlist_sync_pc_id"
ENABLED_DATASET = "watchlist_sync_enabled_at"


def host_name() -> str:
    return platform.node()


def get_or_create_pc_id(conn: sqlite3.Connection) -> str:
    """Generated once per data directory and never regenerated, even if the PC is renamed."""
    row = conn.execute("SELECT source FROM dataset_metadata WHERE dataset_name = ?", (PC_ID_DATASET,)).fetchone()
    if row and row["source"]:
        return row["source"]
    name = re.sub(r"[^A-Za-z0-9-]+", "-", host_name()).strip("-") or "PC"
    pc_id = f"{name}-{secrets.token_hex(2)}"
    conn.execute(
        "INSERT OR REPLACE INTO dataset_metadata (dataset_name, last_updated_at, source) VALUES (?, ?, ?)",
        (PC_ID_DATASET, next_stamp(), pc_id),
    )
    return pc_id


def ensure_first_sync(conn: sqlite3.Connection, pc_id: str) -> None:
    """Stamp every row whose `updated_at IS NULL` with the baseline, on every call: a NULL row is
    by definition a change that was never stamped, so the baseline is its correct key whenever one
    is found -- including a stray unstamped insert made after the marker was written. The
    `watchlist_sync_enabled_at` marker itself is written only once, the first time. No tombstones
    are made."""
    conn.execute(
        "UPDATE watchlist SET updated_at = ?, updated_by = ? WHERE updated_at IS NULL",
        (BASELINE_TS, pc_id),
    )
    done = conn.execute("SELECT 1 FROM dataset_metadata WHERE dataset_name = ?", (ENABLED_DATASET,)).fetchone()
    if done:
        return
    conn.execute(
        "INSERT OR REPLACE INTO dataset_metadata (dataset_name, last_updated_at, source) VALUES (?, ?, ?)",
        (ENABLED_DATASET, next_stamp(), pc_id),
    )


def watchlist_is_empty(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0] == 0


def read_local_state(conn: sqlite3.Connection) -> SyncState:
    rows = {
        r["ticker"]: SyncRow(
            ticker=r["ticker"], name=r["name"] or "", sector=r["sector"] or "",
            group_name=r["group_name"] or "custom", weight=float(r["weight"] or 0.0),
            updated_at=r["updated_at"] or BASELINE_TS, updated_by=r["updated_by"] or "",
        )
        for r in conn.execute("SELECT ticker, name, sector, group_name, weight, updated_at, updated_by FROM watchlist")
    }
    removed = {
        r["ticker"]: Tombstone(ticker=r["ticker"], removed_at=r["removed_at"], removed_by=r["removed_by"])
        for r in conn.execute("SELECT ticker, removed_at, removed_by FROM watchlist_removed")
    }
    return SyncState(rows=rows, removed=removed)


def apply_state(conn: sqlite3.Connection, state: SyncState) -> None:
    """Make the local tables equal the merged state. Authors and timestamps are stored as received."""
    current = read_local_state(conn)
    for ticker in current.rows.keys() - state.rows.keys():
        conn.execute("DELETE FROM watchlist WHERE ticker = ?", (ticker,))
    for row in state.rows.values():
        if current.rows.get(row.ticker) == row:
            continue
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight, updated_at, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET name = excluded.name, sector = excluded.sector,
                   group_name = excluded.group_name, weight = excluded.weight,
                   updated_at = excluded.updated_at, updated_by = excluded.updated_by""",
            (row.ticker, row.name, row.sector, row.group_name, row.weight, row.updated_at, row.updated_by),
        )
    for tomb in state.removed.values():
        if current.removed.get(tomb.ticker) == tomb:
            continue
        conn.execute(
            """INSERT INTO watchlist_removed (ticker, removed_at, removed_by) VALUES (?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET removed_at = excluded.removed_at, removed_by = excluded.removed_by""",
            (tomb.ticker, tomb.removed_at, tomb.removed_by),
        )


def stamp_row(conn: sqlite3.Connection, ticker: str, pc_id: str) -> None:
    conn.execute("UPDATE watchlist SET updated_at = ?, updated_by = ? WHERE ticker = ?", (next_stamp(), pc_id, ticker))


def record_removal(conn: sqlite3.Connection, ticker: str, pc_id: str) -> None:
    conn.execute(
        """INSERT INTO watchlist_removed (ticker, removed_at, removed_by) VALUES (?, ?, ?)
           ON CONFLICT(ticker) DO UPDATE SET removed_at = excluded.removed_at, removed_by = excluded.removed_by""",
        (ticker, next_stamp(), pc_id),
    )
