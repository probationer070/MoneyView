"""
Dry-run local CSV/JSON ingestion without mutating SQLite.

Validates source files against MoneyView's local-first canonical schemas and
prints row-count summaries plus malformed-file details.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
STOCKS_DIR = SRC / "stocks"
INDICES_DIR = SRC / "indices"
WATCHLIST_JSON = ROOT / "apps" / "api" / "services" / "webscrap" / "stock_targets.json"

SCHEMA_A_COLUMNS = ("category", "name", "code", "value", "unit", "date", "source", "cycle", "description")
SCHEMA_B_COLUMNS = ("Date", "Open", "High", "Low", "Close", "Volume", "Dividends", "Stock Splits")


@dataclass
class IngestGroupReport:
    name: str
    files: int = 0
    rows: int = 0
    valid_files: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class IngestDryRunReport:
    groups: list[IngestGroupReport]

    @property
    def errors(self) -> list[str]:
        return [error for group in self.groups for error in group.errors]

    @property
    def warnings(self) -> list[str]:
        return [warning for group in self.groups for warning in group.warnings]


def _read_csv_header_and_count(path: Path) -> tuple[list[str], int]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration:
            return [], 0
        return header, sum(1 for _ in reader)


def _missing_columns(header: list[str], required: tuple[str, ...]) -> list[str]:
    header_set = {column.strip() for column in header}
    return [column for column in required if column not in header_set]


def _scan_schema_b_files(paths: list[Path], group_name: str) -> IngestGroupReport:
    report = IngestGroupReport(name=group_name)
    for path in paths:
        report.files += 1
        try:
            header, rows = _read_csv_header_and_count(path)
        except UnicodeDecodeError as exc:
            report.errors.append(f"{path}: cannot decode as UTF-8-SIG ({exc})")
            continue
        except OSError as exc:
            report.errors.append(f"{path}: cannot read file ({exc})")
            continue

        missing = _missing_columns(header, SCHEMA_B_COLUMNS)
        if missing:
            report.errors.append(f"{path}: missing Schema B columns: {', '.join(missing)}")
            continue

        report.valid_files += 1
        report.rows += rows
    return report


def _scan_macro_files(paths: list[Path]) -> IngestGroupReport:
    report = IngestGroupReport(name="macro/economic Schema A CSV")
    for path in paths:
        report.files += 1
        try:
            header, rows = _read_csv_header_and_count(path)
        except UnicodeDecodeError as exc:
            report.errors.append(f"{path}: cannot decode as UTF-8-SIG ({exc})")
            continue
        except OSError as exc:
            report.errors.append(f"{path}: cannot read file ({exc})")
            continue

        missing = _missing_columns(header, SCHEMA_A_COLUMNS)
        if missing:
            report.warnings.append(f"{path}: skipped; not Schema A ({', '.join(missing)} missing)")
            continue

        report.valid_files += 1
        report.rows += rows
    return report


def _scan_watchlist(path: Path) -> IngestGroupReport:
    report = IngestGroupReport(name="watchlist JSON")
    report.files = 1 if path.exists() else 0
    if not path.exists():
        report.warnings.append(f"{path}: watchlist JSON not found")
        return report

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        report.errors.append(f"{path}: cannot parse JSON ({exc})")
        return report

    if not isinstance(payload, dict):
        report.errors.append(f"{path}: expected top-level object")
        return report

    rows = 0
    for group_name, group_payload in payload.items():
        if not isinstance(group_payload, dict):
            report.warnings.append(f"{path}: group {group_name!r} is not an object; skipped")
            continue
        targets = group_payload.get("targets", [])
        if not isinstance(targets, list):
            report.warnings.append(f"{path}: group {group_name!r} targets is not a list; skipped")
            continue
        rows += sum(1 for item in targets if isinstance(item, dict) and item.get("ticker"))

    report.valid_files = 1
    report.rows = rows
    return report


def collect_ingestion_dry_run(src_root: Path = SRC, watchlist_json: Path = WATCHLIST_JSON) -> IngestDryRunReport:
    stocks_dir = src_root / "stocks"
    indices_dir = src_root / "indices"
    stock_files = sorted(stocks_dir.glob("*/prices.csv")) if stocks_dir.exists() else []
    index_files = sorted(indices_dir.glob("*.csv")) if indices_dir.exists() else []
    excluded_roots = {stocks_dir.resolve(), indices_dir.resolve()}

    macro_files: list[Path] = []
    for path in sorted(src_root.rglob("*.csv")) if src_root.exists() else []:
        try:
            resolved_parent = path.parent.resolve()
        except OSError:
            continue
        if any(resolved_parent == root or root in resolved_parent.parents for root in excluded_roots):
            continue
        if path.name == "crawling_log.csv":
            continue
        macro_files.append(path)

    return IngestDryRunReport(
        groups=[
            _scan_schema_b_files(stock_files, "stock Schema B CSV"),
            _scan_schema_b_files(index_files, "index Schema B CSV"),
            _scan_macro_files(macro_files),
            _scan_watchlist(watchlist_json),
        ]
    )


def print_report(report: IngestDryRunReport, show_warnings: bool) -> None:
    print("MoneyView ingestion dry run")
    for group in report.groups:
        print(
            f"- {group.name}: files={group.files}, valid_files={group.valid_files}, "
            f"rows={group.rows}, errors={len(group.errors)}, warnings={len(group.warnings)}"
        )

    if show_warnings and report.warnings:
        print("\nWarnings:")
        for warning in report.warnings:
            print(f"  - {warning}")

    if report.errors:
        print("\nErrors:")
        for error in report.errors:
            print(f"  - {error}")

    print("\nNo SQLite writes were performed.")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dry-run local ingestion sources without writing SQLite.")
    parser.add_argument("--src", type=Path, default=SRC, help="Source data root.")
    parser.add_argument("--watchlist", type=Path, default=WATCHLIST_JSON, help="Watchlist JSON path.")
    parser.add_argument("--show-warnings", action="store_true", help="Print every warning.")
    parser.add_argument("--fail-on-warnings", action="store_true", help="Exit non-zero when warnings exist.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    src_root = args.src if args.src.is_absolute() else ROOT / args.src
    watchlist_json = args.watchlist if args.watchlist.is_absolute() else ROOT / args.watchlist
    report = collect_ingestion_dry_run(src_root=src_root, watchlist_json=watchlist_json)
    print_report(report, show_warnings=args.show_warnings)
    if report.errors or (args.fail_on_warnings and report.warnings):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
