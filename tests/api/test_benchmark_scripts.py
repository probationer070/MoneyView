import sqlite3
from contextlib import suppress
from pathlib import Path
from uuid import uuid4

from scripts.benchmark_finance import run_finance_benchmarks
from scripts.benchmark_sqlite import run_sqlite_benchmarks


def _workspace_dir() -> Path:
    path = Path("data/cache/benchmark_tests") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _remove_tree(path: Path) -> None:
    with suppress(FileNotFoundError, PermissionError):
        for child in path.rglob("*"):
            if child.is_file():
                child.unlink()
        for child in sorted(path.rglob("*"), reverse=True):
            if child.is_dir():
                child.rmdir()
        path.rmdir()


def _create_benchmark_db(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(
            """
            CREATE TABLE stocks (
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                close REAL,
                volume INTEGER
            );
            CREATE TABLE indices (
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                close REAL
            );
            CREATE TABLE indicators (
                category TEXT,
                code TEXT,
                value REAL,
                date TEXT
            );
            CREATE TABLE watchlist (
                ticker TEXT,
                sector TEXT,
                group_name TEXT
            );
            INSERT INTO stocks VALUES ('AAPL', '2025-01-01', 100.0, 1000);
            INSERT INTO stocks VALUES ('AAPL', '2025-01-02', 101.0, 1100);
            INSERT INTO indices VALUES ('SPX', '2025-01-01', 5000.0);
            INSERT INTO indicators VALUES ('macro', 'RATE', 1.5, '2025-01-01');
            INSERT INTO watchlist VALUES ('AAPL', 'Technology', 'custom');
            """
        )


def test_sqlite_benchmark_smoke():
    work_dir = _workspace_dir()
    try:
        db_path = work_dir / "moneyview.db"
        _create_benchmark_db(db_path)

        results = run_sqlite_benchmarks(db_path=db_path, work_dir=work_dir, iterations=1, write_rows=5)

        names = {result.name for result in results}
        assert "read:stocks-count" in names
        assert "write:temp-insert-schema-b" in names
        assert all(result.avg_ms >= 0 for result in results)
    finally:
        _remove_tree(work_dir)


def test_finance_benchmark_smoke():
    results = run_finance_benchmarks(iterations=1, monte_carlo_runs=50, vector_size=50, seed=7)

    names = {result.name for result in results}
    assert "core_finance:npv-10-cashflows" in names
    assert any(name.startswith("maths:brinson-fachler") for name in names)
    assert all(result.avg_ms >= 0 for result in results)
