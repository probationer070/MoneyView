"""
Benchmark local SQLite workloads for MoneyView.

The benchmark is local-only and safe by default:
- read benchmarks use the configured local DB
- write benchmarks use a temporary DB under data/cache/benchmarks
- no writes are made to data/processed/moneyview.db
"""

from __future__ import annotations

import argparse
import gc
import json
import sqlite3
import statistics
import sys
import time
from contextlib import suppress
from dataclasses import asdict, dataclass
from pathlib import Path
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / "data" / "processed" / "moneyview.db"
DEFAULT_WORK_DIR = ROOT / "data" / "cache" / "benchmarks"


@dataclass
class BenchmarkResult:
    name: str
    iterations: int
    total_ms: float
    avg_ms: float
    median_ms: float
    min_ms: float
    max_ms: float
    rows: int = 0
    notes: str = ""


def _time_call(name: str, iterations: int, func) -> BenchmarkResult:
    durations: list[float] = []
    rows = 0
    for _ in range(iterations):
        start = time.perf_counter()
        rows = int(func() or 0)
        durations.append((time.perf_counter() - start) * 1000)

    return BenchmarkResult(
        name=name,
        iterations=iterations,
        total_ms=round(sum(durations), 3),
        avg_ms=round(statistics.mean(durations), 3),
        median_ms=round(statistics.median(durations), 3),
        min_ms=round(min(durations), 3),
        max_ms=round(max(durations), 3),
        rows=rows,
    )


def _connect_readonly(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def _run_read_benchmarks(db_path: Path, iterations: int) -> list[BenchmarkResult]:
    if not db_path.exists():
        return [
            BenchmarkResult(
                name="read:local-db",
                iterations=0,
                total_ms=0,
                avg_ms=0,
                median_ms=0,
                min_ms=0,
                max_ms=0,
                notes=f"DB not found: {db_path}",
            )
        ]

    results: list[BenchmarkResult] = []
    with _connect_readonly(db_path) as conn:
        if _table_exists(conn, "stocks"):
            ticker_row = conn.execute("SELECT ticker FROM stocks LIMIT 1").fetchone()
            ticker = str(ticker_row["ticker"]) if ticker_row else ""
            results.append(
                _time_call(
                    "read:stocks-count",
                    iterations,
                    lambda: conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0],
                )
            )
            if ticker:
                results.append(
                    _time_call(
                        "read:stocks-latest-by-ticker",
                        iterations,
                        lambda: len(
                            conn.execute(
                                "SELECT date, close, volume FROM stocks WHERE ticker=? ORDER BY date DESC LIMIT 260",
                                (ticker,),
                            ).fetchall()
                        ),
                    )
                )

        if _table_exists(conn, "indices"):
            results.append(
                _time_call(
                    "read:indices-count",
                    iterations,
                    lambda: conn.execute("SELECT COUNT(*) FROM indices").fetchone()[0],
                )
            )

        if _table_exists(conn, "indicators"):
            results.append(
                _time_call(
                    "read:indicators-count",
                    iterations,
                    lambda: conn.execute("SELECT COUNT(*) FROM indicators").fetchone()[0],
                )
            )
            results.append(
                _time_call(
                    "read:indicators-by-category",
                    iterations,
                    lambda: len(
                        conn.execute(
                            "SELECT category, code, value, date FROM indicators WHERE category IS NOT NULL LIMIT 500"
                        ).fetchall()
                    ),
                )
            )

        if _table_exists(conn, "watchlist"):
            results.append(
                _time_call(
                    "read:watchlist-all",
                    iterations,
                    lambda: len(conn.execute("SELECT ticker, sector, group_name FROM watchlist").fetchall()),
                )
            )

    return results


def _run_write_benchmark(work_dir: Path, rows: int, iterations: int) -> BenchmarkResult:
    work_dir.mkdir(parents=True, exist_ok=True)
    temp_db = work_dir / f"sqlite-write-benchmark-{uuid4().hex}.db"
    try:
        with sqlite3.connect(str(temp_db)) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute(
                """
                CREATE TABLE benchmark_prices (
                    ticker TEXT NOT NULL,
                    date TEXT NOT NULL,
                    open REAL,
                    high REAL,
                    low REAL,
                    close REAL,
                    volume INTEGER,
                    dividends REAL DEFAULT 0.0,
                    stock_splits REAL DEFAULT 0.0,
                    UNIQUE(ticker, date)
                )
                """
            )
            payload = [
                (
                    "BENCH",
                    f"2025-01-{(idx % 28) + 1:02d}-{idx}",
                    100.0 + idx,
                    101.0 + idx,
                    99.0 + idx,
                    100.5 + idx,
                    1000 + idx,
                    0.0,
                    0.0,
                )
                for idx in range(rows)
            ]

            result = _time_call(
                "write:temp-insert-schema-b",
                iterations,
                lambda: _insert_payload(conn, payload),
            )
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.execute("PRAGMA journal_mode=DELETE")
        return result
    finally:
        _remove_sqlite_artifacts(temp_db)


def _remove_sqlite_artifacts(db_path: Path) -> None:
    for suffix in ("", "-wal", "-shm"):
        artifact = Path(str(db_path) + suffix)
        for _ in range(50):
            try:
                artifact.unlink()
                break
            except FileNotFoundError:
                break
            except PermissionError:
                gc.collect()
                time.sleep(0.05)


def _insert_payload(conn: sqlite3.Connection, payload: list[tuple]) -> int:
    conn.execute("DELETE FROM benchmark_prices")
    conn.executemany(
        """
        INSERT OR REPLACE INTO benchmark_prices
        (ticker, date, open, high, low, close, volume, dividends, stock_splits)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        payload,
    )
    conn.commit()
    return len(payload)


def run_sqlite_benchmarks(db_path: Path, work_dir: Path, iterations: int, write_rows: int) -> list[BenchmarkResult]:
    db_path = db_path if db_path.is_absolute() else ROOT / db_path
    work_dir = work_dir if work_dir.is_absolute() else ROOT / work_dir
    return [
        *_run_read_benchmarks(db_path=db_path, iterations=iterations),
        _run_write_benchmark(work_dir=work_dir, rows=write_rows, iterations=max(1, min(iterations, 5))),
    ]


def _print_results(results: list[BenchmarkResult]) -> None:
    print("MoneyView SQLite benchmark")
    for item in results:
        print(
            f"- {item.name}: iterations={item.iterations}, rows={item.rows}, "
            f"avg_ms={item.avg_ms}, median_ms={item.median_ms}, min_ms={item.min_ms}, max_ms={item.max_ms}"
        )
        if item.notes:
            print(f"  note: {item.notes}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark local MoneyView SQLite workloads.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB to read from.")
    parser.add_argument("--work-dir", type=Path, default=DEFAULT_WORK_DIR, help="Scratch directory for write benchmark DB.")
    parser.add_argument("--iterations", type=int, default=20, help="Read benchmark iterations.")
    parser.add_argument("--write-rows", type=int, default=1000, help="Rows per write benchmark iteration.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of text.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    results = run_sqlite_benchmarks(
        db_path=args.db,
        work_dir=args.work_dir,
        iterations=max(1, args.iterations),
        write_rows=max(1, args.write_rows),
    )
    if args.json:
        print(json.dumps([asdict(item) for item in results], indent=2))
    else:
        _print_results(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
