import json
import gc
import time
from contextlib import suppress
from pathlib import Path
from uuid import uuid4

from scripts.ingest_dry_run import collect_ingestion_dry_run
from scripts.reconstruct_sqlite_db import reconstruct_db
from scripts.validate_sqlite_schema import validate_sqlite_schema


def _workspace_dir() -> Path:
    path = Path("data/cache/data_integrity_tests") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _remove_tree(path: Path) -> None:
    for _ in range(10):
        try:
            for child in path.rglob("*"):
                if child.is_file():
                    child.unlink()
            for child in sorted(path.rglob("*"), reverse=True):
                if child.is_dir():
                    child.rmdir()
            path.rmdir()
            return
        except FileNotFoundError:
            return
        except PermissionError:
            gc.collect()
            time.sleep(0.05)


def _write_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = ",".join(header) + "\n"
    content += "\n".join(",".join(row) for row in rows)
    path.write_text(content + "\n", encoding="utf-8")


def test_reconstruct_sqlite_db_creates_strict_valid_schema():
    work_dir = _workspace_dir()
    db_path = work_dir / "moneyview.db"
    try:
        exit_code = reconstruct_db(
            db_path=db_path,
            backup_dir=work_dir / "backups",
            apply=True,
            backup=True,
            validate=True,
        )

        assert exit_code == 0
        result = validate_sqlite_schema(db_path, strict=True)
        assert result.ok
    finally:
        with suppress(PermissionError):
            _remove_tree(work_dir)


def test_ingest_dry_run_counts_valid_local_sources():
    work_dir = _workspace_dir()
    src_root = work_dir / "src"
    watchlist_path = work_dir / "stock_targets.json"
    schema_b = ["Date", "Open", "High", "Low", "Close", "Volume", "Dividends", "Stock Splits"]
    schema_a = ["category", "name", "code", "value", "unit", "date", "source", "cycle", "description"]

    try:
        _write_csv(
            src_root / "stocks" / "AAPL" / "prices.csv",
            schema_b,
            [["2025-01-01", "1", "2", "1", "2", "100", "0", "0"]],
        )
        _write_csv(
            src_root / "indices" / "SPX.csv",
            schema_b,
            [["2025-01-01", "1", "2", "1", "2", "100", "0", "0"]],
        )
        _write_csv(
            src_root / "macro" / "rates.csv",
            schema_a,
            [["macro", "rate", "RATE", "1.5", "%", "2025-01-01", "fixture", "D", ""]],
        )
        watchlist_path.write_text(
            json.dumps({"custom": {"targets": [{"ticker": "AAPL", "name": "Apple"}]}}),
            encoding="utf-8",
        )

        report = collect_ingestion_dry_run(src_root=src_root, watchlist_json=watchlist_path)

        assert not report.errors
        assert sum(group.rows for group in report.groups) == 4
    finally:
        with suppress(PermissionError):
            _remove_tree(work_dir)
