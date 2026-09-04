"""Clear every snapshot table, so the new dedupe rule starts from an empty slate.

All three are named deliberately. `_v3` is the live table, but
`corporate_comparison_snapshots` still holds v1 rows; clearing only the live one
would leave those behind and the "clean start" would be false.

This is irreversible -- snapshot rows are point-in-time records that cannot be
regenerated, because their inputs have moved.

`reset_snapshots` therefore refuses the real database unless a caller says so in
so many words, and backs it up itself when they do. Both guards exist because
neither did on 2026-09-03, when this function was called against
`data/processed/moneyview.db` from outside `__main__` and deleted 880 snapshot
rows across 20 versions with no backup and no error, unnoticed for a day. The
backup used to live in `__main__` -- which is exactly the path such a caller
skips. See ERROR-LOG.md 2026-09-04.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SNAPSHOT_TABLES = (
    "corporate_comparison_snapshots",
    "corporate_comparison_snapshots_v2",
    "corporate_comparison_snapshots_v3",
)

# The developer's own database, resolved from this file's location rather than
# from `db._DB_PATH`: that module attribute is monkeypatched to a temporary file
# under pytest, so reading it here would make the guard evaporate in precisely
# the runs most likely to call this function.
_REAL_DB = (Path(__file__).resolve().parent.parent / "data" / "processed" / "moneyview.db").resolve()


def _database_path(conn: sqlite3.Connection) -> Path | None:
    """The file `conn` is attached to, or None for an in-memory database."""
    for _seq, name, filename in conn.execute("PRAGMA database_list").fetchall():
        if name == "main":
            return Path(filename).resolve() if filename else None
    return None


def _back_up(path: Path) -> Path:
    """Copy the database beside itself, under a name no later run can reuse.

    Uses SQLite's own backup API rather than a file copy: the database is in WAL
    mode, so copying the file alone can miss committed pages still in the -wal
    sidecar. The source is a SEPARATE read-only connection, not the caller's:
    backing up through a connection that holds an open write transaction blocks
    on a lock until the backup gives up. That also fixes what the backup means --
    it captures the database as COMMITTED on disk, which is the state a reset
    destroys and the state worth restoring.

    The timestamp carries microseconds because a fixed name silently clobbers the
    previous backup, which cost a forensic artifact on 2026-09-04 when re-running
    the reset overwrote the copy taken before the incident being investigated.
    """
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%f")
    destination = path.with_name(f"{path.name}.pre-snapshot-reset-{stamp}")
    source = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    copy = sqlite3.connect(str(destination))
    try:
        source.backup(copy)
    finally:
        copy.close()
        source.close()
    print(f"backed up -> {destination}")
    return destination


def reset_snapshots(
    conn: sqlite3.Connection, *, allow_real_database: bool = False
) -> dict[str, int]:
    """Delete every row from each snapshot table. Returns rows deleted per table.

    Refuses the real database unless `allow_real_database=True`, and backs it up
    before deleting when it is allowed. Any other database -- a test's temporary
    file, an in-memory connection -- is cleared without ceremony.
    """
    path = _database_path(conn)
    if path is not None and path == _REAL_DB:
        if not allow_real_database:
            raise RuntimeError(
                f"refusing to clear snapshots in the real database at {path}.\n"
                "These rows are point-in-time records and cannot be regenerated. "
                "If you mean it, call reset_snapshots(conn, allow_real_database=True) "
                "-- which backs the database up first -- or run this module as a "
                "script: python scripts/reset_snapshots.py"
            )
        _back_up(path)

    deleted: dict[str, int] = {}
    for table in SNAPSHOT_TABLES:
        deleted[table] = conn.execute(f"DELETE FROM {table}").rowcount
    return deleted


if __name__ == "__main__":  # pragma: no cover - operator entry point
    from apps.api.services.db import get_db

    with get_db() as connection:
        for name, count in reset_snapshots(connection, allow_real_database=True).items():
            print(f"  {name}: {count} rows deleted")
