"""Report whether the local database exists, how populated it is, and how to fill it.

Read-only, dependency-free (stdlib only), and safe to run before the API has ever
started: a fresh checkout has no `data/processed/moneyview.db` at all, since `init_db()`
creates it on first API startup rather than at checkout time.

This repository has no bulk "download everything" command. Price bars, statements, and
news are acquired lazily per ticker -- the first time a route asks for a subject, the
acquisition runner (`apps/api/services/acquisition/runner.py`) fetches it and records the
result in `acquisition_state`. This script reports that state; it does not trigger a
fetch itself, so running it never makes a network call and never blocks startup.

Usage (from project root):
    python scripts/check_data_status.py
    python scripts/check_data_status.py --json
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Mirrors apps/api/services/db.py's own resolution exactly, so this script and the API
# agree on which file they mean even when DB_PATH is overridden (tests, alt environments).
_DB_PATH = Path(os.getenv("DB_PATH", "data/processed/moneyview.db"))
DB_PATH = _DB_PATH if _DB_PATH.is_absolute() else ROOT / _DB_PATH

STOCK_TARGETS_JSON = ROOT / "apps" / "api" / "services" / "webscrap" / "stock_targets.json"


def _connect_readonly(path: Path) -> sqlite3.Connection:
    # mode=ro: never creates the file, never opens a WAL/journal, never takes a write
    # lock -- a status check must not compete with, or masquerade as, a real connection.
    uri = f"file:{path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def _count(conn: sqlite3.Connection, table: str, *, distinct: str | None = None) -> int:
    if not _table_exists(conn, table):
        return 0
    column = f"DISTINCT {distinct}" if distinct else "*"
    return conn.execute(f"SELECT COUNT({column}) FROM {table}").fetchone()[0]


def _seed_tickers(seed_path: Path | None = None) -> set[str] | None:
    """Tickers this repo is configured to track, independent of what is cached.

    Read directly from the JSON seed rather than through `watchlist_seed.py`'s loader,
    which can also write a regenerated file -- a status check must never mutate anything.

    `None` means "no readable seed", which is a different fact from an empty seed and is
    what lets the caller omit the comparison rather than report a drift of zero.
    """
    path = seed_path if seed_path is not None else STOCK_TARGETS_JSON
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    tickers: set[str] = set()
    for group in data.values():
        for item in group.get("targets", []):
            ticker = item.get("ticker")
            if ticker:
                tickers.add(str(ticker).upper())
    return tickers


def _watchlist_tickers(conn: sqlite3.Connection) -> set[str]:
    if not _table_exists(conn, "watchlist"):
        return set()
    return {
        str(row[0]).upper()
        for row in conn.execute("SELECT ticker FROM watchlist").fetchall()
        if row[0]
    }


def gather_status(db_path: Path | None = None, seed_path: Path | None = None) -> dict:
    """Everything a launcher needs to describe the database, in one dict.

    `db_path` defaults to the module-level `DB_PATH` (which respects the `DB_PATH` env
    var, matching `apps/api/services/db.py`); `seed_path` defaults to the checked-in
    `stock_targets.json`. Accepting overrides, rather than only reading module globals,
    is what lets tests point this at a throwaway database and seed file without
    monkeypatching module state or shelling out to a subprocess per case.
    """
    path = db_path if db_path is not None else DB_PATH
    if not path.exists():
        return {
            "db_path": str(path),
            "db_exists": False,
            "verdict": "not_created",
        }

    conn = _connect_readonly(path)
    try:
        integrity = conn.execute("PRAGMA quick_check").fetchone()[0]

        watchlist_rows = _count(conn, "watchlist")
        seed_tickers = _seed_tickers(seed_path)
        tracked = len(seed_tickers) if seed_tickers is not None else None

        # The count difference is NOT this number. A machine holding locally-curated
        # tickers can match the seed's row count while still missing several of its
        # tickers, and subtracting the two counts would report no drift at all in exactly
        # the case the merge exists to repair. Compare the sets.
        seed_not_imported = (
            len(seed_tickers - _watchlist_tickers(conn)) if seed_tickers is not None else None
        )

        priced_tickers = _count(conn, "stocks", distinct="ticker")
        statement_tickers = _count(conn, "corporate_statements", distinct="ticker")
        news_rows = _count(conn, "news")
        index_rows = _count(conn, "indices")

        acquisition_by_status: dict[str, int] = {}
        acquisition_by_class: dict[str, int] = {}
        most_recent_check = None
        if _table_exists(conn, "acquisition_state"):
            for row in conn.execute(
                "SELECT status, COUNT(*) AS n FROM acquisition_state GROUP BY status"
            ):
                acquisition_by_status[row["status"]] = row["n"]
            for row in conn.execute(
                "SELECT data_class, COUNT(*) AS n FROM acquisition_state GROUP BY data_class"
            ):
                acquisition_by_class[row["data_class"]] = row["n"]
            most_recent_check = conn.execute(
                "SELECT MAX(last_checked_at) FROM acquisition_state"
            ).fetchone()[0]

        never_acquired = acquisition_by_status.get("never_acquired", 0)
        ok_count = acquisition_by_status.get("ok", 0)

        if watchlist_rows == 0 and priced_tickers == 0:
            verdict = "empty"
        elif tracked and priced_tickers < tracked * 0.5:
            verdict = "partial"
        else:
            verdict = "ready"

        return {
            "db_path": str(path),
            "db_exists": True,
            "db_size_bytes": path.stat().st_size,
            "integrity": integrity,
            "watchlist_rows": watchlist_rows,
            "tracked_tickers": tracked,
            "seed_not_imported": seed_not_imported,
            "priced_tickers": priced_tickers,
            "statement_tickers": statement_tickers,
            "news_rows": news_rows,
            "index_rows": index_rows,
            "acquisition_ok": ok_count,
            "acquisition_never_acquired": never_acquired,
            "acquisition_total": sum(acquisition_by_status.values()),
            "acquisition_by_class": acquisition_by_class,
            "most_recent_check": most_recent_check,
            "verdict": verdict,
        }
    finally:
        conn.close()


def render_text(status: dict) -> str:
    lines: list[str] = []

    if not status["db_exists"]:
        lines.append(f"Database:  NOT CREATED ({status['db_path']})")
        lines.append("           This is expected on a first checkout. The schema is created")
        lines.append("           automatically the first time the API starts.")
        lines.append("           Price, statement, and news data are NOT bulk-downloaded --")
        lines.append("           each ticker's data is fetched the first time you open its")
        lines.append("           page, and cached in SQLite from then on.")
        return "\n".join(lines)

    verdict = status["verdict"]
    verdict_label = {
        "empty": "EMPTY",
        "partial": "PARTIAL",
        "ready": "READY",
    }[verdict]
    size_mb = status["db_size_bytes"] / (1024 * 1024)

    lines.append(f"Database:  {verdict_label}  ({status['db_path']}, {size_mb:.1f} MB, integrity={status['integrity']})")
    tracked = status["tracked_tickers"]
    tracked_str = f"/{tracked}" if tracked is not None else ""
    # Only when the seed holds tickers this database does not: a machine that has already
    # imported everything says nothing extra, and the GET /portfolio/watchlist merge clears
    # this on the next portfolio page load.
    not_imported = status.get("seed_not_imported") or 0
    drift = f"  ({not_imported} in seed not yet imported)" if not_imported else ""
    lines.append(f"Watchlist: {status['watchlist_rows']}{tracked_str} tracked tickers{drift}")
    lines.append(
        f"Cached:    {status['priced_tickers']} tickers priced, "
        f"{status['statement_tickers']} with statements, "
        f"{status['news_rows']} news rows"
    )
    if status["most_recent_check"]:
        lines.append(f"Last sync: {status['most_recent_check']}")

    if verdict == "empty":
        lines.append("")
        lines.append("No market data cached yet. Data is fetched on demand, not in bulk:")
        lines.append("open any ticker page (or hit its API route) to trigger a download for")
        lines.append("that ticker. To pre-fetch a specific set on the next launch, set")
        lines.append("MONEYVIEW_PREWARM_TICKERS=AAPL,MSFT,... before starting the backend.")
    elif verdict == "partial":
        never = status["acquisition_never_acquired"]
        lines.append("")
        lines.append(
            f"{status['priced_tickers']} of {tracked or '?'} tracked tickers have price data "
            f"({never} never acquired). More fills in as you browse; the acquisition runner "
            "fetches a ticker's data on its first request per session."
        )

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON instead of text.")
    args = parser.parse_args()

    status = gather_status()

    if args.json:
        print(json.dumps(status, indent=2))
    else:
        print(render_text(status))

    return 0


if __name__ == "__main__":
    sys.exit(main())
