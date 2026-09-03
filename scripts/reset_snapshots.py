"""Clear every snapshot table, so the new dedupe rule starts from an empty slate.

All three are named deliberately. `_v3` holds 880 rows and is the live table, but
`corporate_comparison_snapshots` still holds 139 v1 rows; clearing only the live
one would leave those behind and the "clean start" would be false.

This is irreversible -- snapshot rows are point-in-time records that cannot be
regenerated, because their inputs have moved. Back the database up first.
"""
from __future__ import annotations

import sqlite3

SNAPSHOT_TABLES = (
    "corporate_comparison_snapshots",
    "corporate_comparison_snapshots_v2",
    "corporate_comparison_snapshots_v3",
)


def reset_snapshots(conn: sqlite3.Connection) -> dict[str, int]:
    """Delete every row from each snapshot table. Returns rows deleted per table."""
    deleted: dict[str, int] = {}
    for table in SNAPSHOT_TABLES:
        deleted[table] = conn.execute(f"DELETE FROM {table}").rowcount
    return deleted


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import shutil
    from pathlib import Path

    from apps.api.services.db import get_db, get_db_path

    source = get_db_path()
    backup = source.with_suffix(".db.pre-snapshot-reset")
    shutil.copy2(source, backup)
    print(f"backed up -> {backup}")
    with get_db() as connection:
        for name, count in reset_snapshots(connection).items():
            print(f"  {name}: {count} rows deleted")
