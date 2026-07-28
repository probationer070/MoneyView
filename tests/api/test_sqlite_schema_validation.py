import sqlite3
import gc
import time
from contextlib import suppress
from pathlib import Path
from uuid import uuid4

from scripts.validate_sqlite_schema import validate_sqlite_schema
from apps.api.services import db as db_service


def _workspace_db_path() -> Path:
    cache_dir = Path("data/cache/schema_validation_tests")
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{uuid4().hex}.db"


def _remove_sqlite_file(path: Path) -> None:
    for _ in range(10):
        try:
            path.unlink()
            return
        except FileNotFoundError:
            return
        except PermissionError:
            pass
        gc.collect()
        time.sleep(0.05)


def _create_valid_local_schema(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(
            """
            CREATE TABLE indicators (
                id INTEGER PRIMARY KEY,
                category TEXT NOT NULL,
                name TEXT NOT NULL,
                code TEXT NOT NULL,
                value REAL,
                unit TEXT DEFAULT '',
                date TEXT NOT NULL,
                source TEXT DEFAULT '',
                cycle TEXT DEFAULT '',
                description TEXT DEFAULT ''
            );
            CREATE TABLE stocks (
                id INTEGER PRIMARY KEY,
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume INTEGER,
                dividends REAL DEFAULT 0.0,
                stock_splits REAL DEFAULT 0.0
            );
            CREATE TABLE indices (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume INTEGER
            );
            CREATE TABLE watchlist (
                id INTEGER PRIMARY KEY,
                ticker TEXT NOT NULL,
                name TEXT DEFAULT '',
                sector TEXT DEFAULT '',
                group_name TEXT DEFAULT 'custom'
            );
            CREATE TABLE dataset_metadata (
                dataset_name TEXT PRIMARY KEY,
                last_updated_at TEXT NOT NULL,
                source TEXT DEFAULT ''
            );
            """
        )


def test_validate_sqlite_schema_accepts_current_local_schema_with_warnings():
    db_path = _workspace_db_path()
    try:
        _create_valid_local_schema(db_path)

        result = validate_sqlite_schema(db_path)

        assert result.ok
        assert any("indices" in warning for warning in result.warnings)
    finally:
        _remove_sqlite_file(db_path)


def test_validate_sqlite_schema_strict_mode_fails_recommended_columns():
    db_path = _workspace_db_path()
    try:
        _create_valid_local_schema(db_path)

        result = validate_sqlite_schema(db_path, strict=True)

        assert not result.ok
        assert any("Strict mode" in error for error in result.errors)
    finally:
        _remove_sqlite_file(db_path)


def test_validate_sqlite_schema_fails_missing_required_column():
    db_path = _workspace_db_path()
    try:
        _create_valid_local_schema(db_path)
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute("CREATE TABLE broken_indicators AS SELECT category, name, code, value, unit, date, cycle, description FROM indicators")
            conn.execute("DROP TABLE indicators")
            conn.execute("ALTER TABLE broken_indicators RENAME TO indicators")

        result = validate_sqlite_schema(db_path)

        assert not result.ok
        assert "Table 'indicators' missing column 'source'" in result.errors
    finally:
        _remove_sqlite_file(db_path)


def test_init_db_creates_the_statement_and_quote_fact_stores():
    with db_service.get_db() as conn:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }

    assert {"corporate_statements", "corporate_quote_facts"} <= tables


def test_corporate_statements_is_keyed_by_line_item_within_a_period():
    """One row per line item per period per statement, so a refetch replaces rather than
    duplicates -- the same INSERT OR REPLACE contract the bars table relies on."""
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_statements
                   (ticker, statement_type, frequency, period_end, line_item, value, fetched_at)
               VALUES ('AAPL', 'income', 'annual', '2025-09-30', 'Total Revenue', 1.0, '2026-07-28T00:00:00+00:00')"""
        )
        conn.execute(
            """INSERT OR REPLACE INTO corporate_statements
                   (ticker, statement_type, frequency, period_end, line_item, value, fetched_at)
               VALUES ('AAPL', 'income', 'annual', '2025-09-30', 'Total Revenue', 2.0, '2026-07-28T01:00:00+00:00')"""
        )
        rows = conn.execute(
            "SELECT value FROM corporate_statements WHERE ticker='AAPL'"
        ).fetchall()

    assert [row["value"] for row in rows] == [2.0]
