"""Deferred cleanup of upstream caches for tickers that left the watchlist
(spec docs/superpowers/specs/2026-10-15-watchlist-cleanup-and-corporate-sync-design.md §2).

A ticker leaving the watchlist is recorded in cleanup_pending with the moment it left. Once it has
been pending for CLEANUP_GRACE_DAYS and nothing refers to it any more, its rows in the CLEANUP_TABLES
caches are deleted. User-authored tables and snapshot history are references, never targets.

corporate_statements and their acquisition_state rows (data class 'statements') are KEPT, never
deleted. Yahoo returns only a recent window of quarters, and the store accumulates older quarters, so
deleting them would lose that history permanently (owner decision, 2026-10-15).
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone

from apps.api.services.acquisition.registry import REGISTRY, Scope
from apps.api.services.db import get_db

logger = logging.getLogger(__name__)

CLEANUP_GRACE_DAYS = 30
CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60

# Per-ticker data classes whose state and rows are never cleaned. 'statements' is kept: quarters
# accumulate beyond Yahoo's window, so a deletion would lose history permanently (owner, 2026-10-15).
# The acquisition layer keeps its freshness state for them too.
KEPT_DATA_CLASSES = frozenset({"statements"})

# acquisition_state rows keyed by a ticker. index_bars is GLOBAL: its subjects are index symbols
# whose bars live in `indices`, a reference table.
PER_TICKER_DATA_CLASSES = tuple(sorted(
    name for name, dc in REGISTRY.items() if dc.scope is Scope.PER_TICKER and name not in KEPT_DATA_CLASSES))
_CLASS_LIST = ", ".join(f"'{name}'" for name in PER_TICKER_DATA_CLASSES)

# (table, WHERE clause binding the ticker once). Only caches re-fetched on demand belong here.
# corporate_statements is deliberately absent (see KEPT_DATA_CLASSES).
CLEANUP_TABLES: tuple[tuple[str, str], ...] = (
    ("stocks", "ticker = ?"),
    ("news", "ticker = ?"),
    ("corporate_quote_facts", "ticker = ?"),
    ("acquisition_state", f"subject = ? AND data_class IN ({_CLASS_LIST})"),
)

# Tickers present in a cache table. A NULL or '' news ticker is market-wide news, not attributed
# to any ticker, so it is never a candidate. corporate_statements is not a candidate source: a
# statements-only ticker would be re-recorded as "now" on every run and never come due.
_CANDIDATE_QUERIES: tuple[str, ...] = (
    "SELECT DISTINCT ticker FROM stocks",
    "SELECT DISTINCT ticker FROM news WHERE ticker IS NOT NULL AND ticker <> ''",
    "SELECT ticker FROM corporate_quote_facts",
    f"SELECT DISTINCT subject FROM acquisition_state WHERE data_class IN ({_CLASS_LIST})",
)

# A ticker any of these name is never cleaned (spec §2.2). corporate_metrics counts so the owner's
# assumptions keep their statements available. A failing query is NOT caught: a run that cannot
# see every reference must not delete anything.
_REFERENCE_QUERIES: tuple[str, ...] = (
    "SELECT ticker FROM watchlist",
    "SELECT ticker FROM corporate_companies",
    "SELECT ticker FROM corporate_metrics",
    "SELECT DISTINCT ticker FROM indices",
    "SELECT ticker FROM valuation_case WHERE ticker IS NOT NULL",
    "SELECT ticker FROM investment_decision",
    "SELECT DISTINCT ticker FROM corporate_comparison_snapshots",
    "SELECT DISTINCT ticker FROM corporate_comparison_snapshots_v2",
    "SELECT DISTINCT benchmark_ticker FROM corporate_comparison_snapshots_v2",
    "SELECT DISTINCT ticker FROM corporate_comparison_snapshots_v3",
    "SELECT DISTINCT benchmark_ticker FROM corporate_comparison_snapshots_v3",
)


def _normalize(ticker: object) -> str:
    return str(ticker).upper().strip()


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def record_pending(conn: sqlite3.Connection, ticker: str, now: datetime | None = None) -> None:
    """Record that `ticker` left the watchlist at `now`. A later removal restarts the clock.
    `now` must be timezone-aware; a naive datetime would be read as local time."""
    conn.execute(
        """INSERT INTO cleanup_pending (ticker, removed_at) VALUES (?, ?)
           ON CONFLICT(ticker) DO UPDATE SET removed_at = excluded.removed_at""",
        (_normalize(ticker), _iso(now or datetime.now(timezone.utc))),
    )


def clear_pending(conn: sqlite3.Connection, ticker: str) -> None:
    """The ticker is back on the watchlist: nothing is pending for it."""
    conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (_normalize(ticker),))


def referenced_tickers(conn: sqlite3.Connection) -> set[str]:
    # Imported here: corporate_metrics_service imports watchlist_seed, which imports this module.
    from apps.api.services.corporate_metrics_service import DEFAULT_COMPANIES

    found = {_normalize(ticker) for ticker in DEFAULT_COMPANIES}
    for sql in _REFERENCE_QUERIES:
        found.update(_normalize(row[0]) for row in conn.execute(sql) if row[0])
    return found


def _cache_tickers(conn: sqlite3.Connection) -> set[str]:
    found: set[str] = set()
    for sql in _CANDIDATE_QUERIES:
        found.update(row[0] for row in conn.execute(sql) if row[0])
    return found


def delete_ticker_caches(ticker: str) -> dict[str, int]:
    """Delete one ticker's cache rows in one transaction, one savepoint per table. A failed table
    is rolled back and logged; the others still commit, and the ticker stays pending for a retry.
    Returns {} without deleting when the ticker is referenced again by now."""
    counts: dict[str, int] = {}
    failed: list[str] = []
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if _normalize(ticker) in referenced_tickers(conn):
            conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (ticker,))
            return {}
        for table, where in CLEANUP_TABLES:
            conn.execute("SAVEPOINT cleanup_table")
            try:
                counts[table] = conn.execute(f"DELETE FROM {table} WHERE {where}", (ticker,)).rowcount
            except sqlite3.Error as error:
                conn.execute("ROLLBACK TO SAVEPOINT cleanup_table")
                failed.append(table)
                logger.warning("cleanup.failed ticker=%s table=%s error=%s", ticker, table, error)
            conn.execute("RELEASE SAVEPOINT cleanup_table")
        if not failed:
            conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (ticker,))
    for table, rows in counts.items():
        logger.info("cleanup.deleted ticker=%s table=%s rows=%d", ticker, table, rows)
    return counts


def _parse_removed_at(value: str) -> datetime:
    """A stored removal time as an aware UTC moment. A value without an offset is read as UTC."""
    moment = datetime.fromisoformat(value)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def run_cleanup(now: datetime) -> dict[str, dict[str, int]]:
    """One cleanup pass at `now` (an aware UTC datetime). Returns {ticker: {table: rows deleted}}.
    A malformed removal time skips that ticker for this run and restarts its clock at `now`."""
    grace = timedelta(days=CLEANUP_GRACE_DAYS)
    with get_db() as conn:
        referenced = referenced_tickers(conn)
        pending = {row["ticker"]: row["removed_at"]
                   for row in conn.execute("SELECT ticker, removed_at FROM cleanup_pending")}
        for ticker in [t for t in pending if _normalize(t) in referenced]:
            conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (ticker,))
            del pending[ticker]
        # Any unreferenced cache ticker with no record (removed before this shipped, or by a path
        # that is not hooked) starts its grace period now, so nothing is deleted on first sight.
        known = {_normalize(ticker) for ticker in pending}
        for ticker in sorted({_normalize(ticker) for ticker in _cache_tickers(conn)}):
            if ticker not in referenced and ticker not in known:
                conn.execute("INSERT OR IGNORE INTO cleanup_pending (ticker, removed_at) VALUES (?, ?)",
                             (ticker, _iso(now)))
        due = []
        for ticker, removed_at in sorted(pending.items()):
            try:
                removed = _parse_removed_at(removed_at)
            except (ValueError, TypeError):
                logger.warning("cleanup.bad_pending ticker=%s", ticker)
                conn.execute("UPDATE cleanup_pending SET removed_at = ? WHERE ticker = ?", (_iso(now), ticker))
                continue
            if now - removed >= grace:
                due.append(ticker)
    deleted: dict[str, dict[str, int]] = {}
    for ticker in due:
        try:
            counts = delete_ticker_caches(ticker)
        except Exception as error:  # noqa: BLE001 - one ticker must not stop the others
            logger.warning("cleanup.ticker_failed ticker=%s error=%s", ticker, error)
            continue
        if counts:
            deleted[ticker] = counts
    return deleted


def run_cleanup_logged() -> None:
    """The scheduled entry point. Never raises: cleanup must never take the API down."""
    try:
        deleted = run_cleanup(datetime.now(timezone.utc))
    except Exception as error:  # noqa: BLE001
        logger.warning("cleanup.run_failed error=%s", error)
        return
    logger.info("cleanup.run_finished tickers=%d", len(deleted))
