"""
Reconstruct the local MoneyView SQLite database schema.

Default mode is non-destructive and prints the plan. Use --apply to rebuild the
target database. When rebuilding an existing DB, a timestamped backup is created
under data/cache/db_backups unless --no-backup is supplied.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apps.api.services.db import _CREATE_SCHEMA_SQL, _configure  # noqa: E402
from scripts.validate_sqlite_schema import validate_sqlite_schema  # noqa: E402


DEFAULT_DB_PATH = ROOT / "data" / "processed" / "moneyview.db"
DEFAULT_BACKUP_DIR = ROOT / "data" / "cache" / "db_backups"


def _backup_db(db_path: Path, backup_dir: Path) -> Path | None:
    if not db_path.exists():
        return None

    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_dir / f"{db_path.stem}-{timestamp}{db_path.suffix}"
    shutil.copy2(db_path, backup_path)
    return backup_path


def reconstruct_db(db_path: Path, backup_dir: Path, apply: bool, backup: bool, validate: bool) -> int:
    db_path = db_path if db_path.is_absolute() else ROOT / db_path
    backup_dir = backup_dir if backup_dir.is_absolute() else ROOT / backup_dir

    print("SQLite DB reconstruction")
    print(f"Target DB: {db_path}")
    print(f"Apply: {apply}")
    print(f"Backup existing DB: {backup}")

    if not apply:
        print("\nDry run only. Re-run with --apply to rebuild the DB schema.")
        if db_path.exists():
            print("Existing DB will be backed up before replacement unless --no-backup is used.")
        return 0

    db_path.parent.mkdir(parents=True, exist_ok=True)

    backup_path = None
    if backup:
        backup_path = _backup_db(db_path, backup_dir)
        if backup_path:
            print(f"Backup created: {backup_path}")

    if db_path.exists():
        db_path.unlink()

    with sqlite3.connect(str(db_path), check_same_thread=False) as conn:
        _configure(conn)
        conn.executescript(_CREATE_SCHEMA_SQL)
        conn.commit()

    print("Reconstructed SQLite schema.")

    if validate:
        result = validate_sqlite_schema(db_path, strict=True)
        if result.warnings:
            print("\nValidation warnings:")
            for warning in result.warnings:
                print(f"  - {warning}")
        if result.errors:
            print("\nValidation errors:")
            for error in result.errors:
                print(f"  - {error}")
            return 1
        print("Strict schema validation passed.")

    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reconstruct the local MoneyView SQLite DB schema.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Target SQLite DB path.")
    parser.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUP_DIR, help="Directory for DB backups.")
    parser.add_argument("--apply", action="store_true", help="Actually reconstruct the DB. Omit for dry run.")
    parser.add_argument("--no-backup", action="store_true", help="Do not back up an existing DB before replacement.")
    parser.add_argument("--no-validate", action="store_true", help="Skip strict schema validation after reconstruction.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    return reconstruct_db(
        db_path=args.db,
        backup_dir=args.backup_dir,
        apply=args.apply,
        backup=not args.no_backup,
        validate=not args.no_validate,
    )


if __name__ == "__main__":
    raise SystemExit(main())
