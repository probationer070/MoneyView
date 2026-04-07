"""
Validate the local MoneyView SQLite schema.

Usage:
    python scripts/validate_sqlite_schema.py
    python scripts/validate_sqlite_schema.py --db data/processed/moneyview.db --strict

Default mode fails only on missing required local-runtime tables/columns.
Strict mode also fails on recommended canonical columns that are currently
allowed for backward-compatible local development.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / os.getenv("DB_PATH", "data/processed/moneyview.db")


@dataclass(frozen=True)
class ColumnSpec:
    name: str
    affinity: str | None = None
    required: bool = True


@dataclass(frozen=True)
class TableSpec:
    name: str
    columns: tuple[ColumnSpec, ...]
    description: str
    required: bool = True


@dataclass
class SchemaCheckResult:
    errors: list[str]
    warnings: list[str]

    @property
    def ok(self) -> bool:
        return not self.errors


SCHEMA_SPECS: tuple[TableSpec, ...] = (
    TableSpec(
        name="indicators",
        description="Schema A: macro/economic data",
        columns=(
            ColumnSpec("category", "TEXT"),
            ColumnSpec("name", "TEXT"),
            ColumnSpec("code", "TEXT"),
            ColumnSpec("value", "REAL"),
            ColumnSpec("unit", "TEXT"),
            ColumnSpec("date", "TEXT"),
            ColumnSpec("source", "TEXT"),
            ColumnSpec("cycle", "TEXT"),
            ColumnSpec("description", "TEXT"),
        ),
    ),
    TableSpec(
        name="stocks",
        description="Schema B: financial asset OHLCV with corporate actions",
        columns=(
            ColumnSpec("ticker", "TEXT"),
            ColumnSpec("date", "TEXT"),
            ColumnSpec("open", "REAL"),
            ColumnSpec("high", "REAL"),
            ColumnSpec("low", "REAL"),
            ColumnSpec("close", "REAL"),
            ColumnSpec("volume", "INTEGER"),
            ColumnSpec("dividends", "REAL"),
            ColumnSpec("stock_splits", "REAL"),
        ),
    ),
    TableSpec(
        name="indices",
        description="Schema B variant: index OHLCV",
        columns=(
            ColumnSpec("name", "TEXT"),
            ColumnSpec("ticker", "TEXT"),
            ColumnSpec("date", "TEXT"),
            ColumnSpec("open", "REAL"),
            ColumnSpec("high", "REAL"),
            ColumnSpec("low", "REAL"),
            ColumnSpec("close", "REAL"),
            ColumnSpec("volume", "INTEGER"),
            ColumnSpec("dividends", "REAL", required=False),
            ColumnSpec("stock_splits", "REAL", required=False),
        ),
    ),
    TableSpec(
        name="watchlist",
        description="local portfolio/watchlist metadata",
        columns=(
            ColumnSpec("ticker", "TEXT"),
            ColumnSpec("name", "TEXT", required=False),
            ColumnSpec("sector", "TEXT", required=False),
            ColumnSpec("group_name", "TEXT", required=False),
        ),
    ),
    TableSpec(
        name="dataset_metadata",
        description="local dataset freshness metadata",
        required=False,
        columns=(
            ColumnSpec("dataset_name", "TEXT"),
            ColumnSpec("last_updated_at", "TEXT"),
            ColumnSpec("source", "TEXT", required=False),
        ),
    ),
)


def _normalize_type(sqlite_type: str | None) -> str:
    return (sqlite_type or "").upper().strip()


def _affinity_matches(actual_type: str, expected_affinity: str | None) -> bool:
    if expected_affinity is None:
        return True

    actual = _normalize_type(actual_type)
    expected = expected_affinity.upper()
    if not actual:
        return False
    if expected == "INTEGER":
        return "INT" in actual
    if expected == "REAL":
        return any(token in actual for token in ("REAL", "FLOA", "DOUB", "NUM"))
    if expected == "TEXT":
        return any(token in actual for token in ("TEXT", "CHAR", "CLOB", "VARCHAR"))
    return expected in actual


def _table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {str(row[0]).lower() for row in rows}


def _columns_for_table(conn: sqlite3.Connection, table_name: str) -> dict[str, str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row[1]).lower(): str(row[2]) for row in rows}


def validate_sqlite_schema(db_path: Path, strict: bool = False) -> SchemaCheckResult:
    errors: list[str] = []
    warnings: list[str] = []

    if not db_path.exists():
        return SchemaCheckResult(errors=[f"SQLite DB not found: {db_path}"], warnings=warnings)

    with sqlite3.connect(str(db_path)) as conn:
        table_names = _table_names(conn)

        for spec in SCHEMA_SPECS:
            if spec.name.lower() not in table_names:
                message = f"Missing table '{spec.name}' ({spec.description})"
                if spec.required:
                    errors.append(message)
                else:
                    warnings.append(f"{message} (recommended for local data freshness checks)")
                continue

            actual_columns = _columns_for_table(conn, spec.name)
            for column in spec.columns:
                actual_type = actual_columns.get(column.name.lower())
                if actual_type is None:
                    message = f"Table '{spec.name}' missing column '{column.name}'"
                    if column.required:
                        errors.append(message)
                    else:
                        warnings.append(f"{message} (recommended for canonical Schema B completeness)")
                    continue

                if not _affinity_matches(actual_type, column.affinity):
                    errors.append(
                        f"Table '{spec.name}' column '{column.name}' type '{actual_type}' "
                        f"does not match expected affinity '{column.affinity}'"
                    )

    if strict and warnings:
        errors.extend(f"Strict mode: {warning}" for warning in warnings)

    return SchemaCheckResult(errors=errors, warnings=warnings)


def _print_result(db_path: Path, result: SchemaCheckResult, strict: bool) -> None:
    mode = "strict" if strict else "default"
    print(f"SQLite schema validation ({mode})")
    print(f"DB: {db_path}")

    if result.warnings:
        print("\nWarnings:")
        for warning in result.warnings:
            print(f"  - {warning}")

    if result.errors:
        print("\nErrors:")
        for error in result.errors:
            print(f"  - {error}")
        return

    print("\nSchema validation passed.")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate MoneyView local SQLite schema.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Path to SQLite DB file.")
    parser.add_argument("--strict", action="store_true", help="Treat recommended-column warnings as failures.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    db_path = args.db if args.db.is_absolute() else ROOT / args.db
    result = validate_sqlite_schema(db_path=db_path, strict=args.strict)
    _print_result(db_path, result, strict=args.strict)
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
