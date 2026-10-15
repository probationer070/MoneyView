"""Deferred cleanup of upstream caches for tickers that left the watchlist
(spec docs/superpowers/specs/2026-10-15-watchlist-cleanup-and-corporate-sync-design.md §2).

A ticker leaving the watchlist is recorded in cleanup_pending with the moment it left. Once it has
been pending for CLEANUP_GRACE_DAYS and nothing refers to it any more, its rows in the rebuildable
cache tables are deleted. User-authored tables and snapshot history are references, never targets.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

CLEANUP_GRACE_DAYS = 30
CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60


def _normalize(ticker: object) -> str:
    return str(ticker).upper().strip()


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def record_pending(conn: sqlite3.Connection, ticker: str, now: datetime | None = None) -> None:
    """Record that `ticker` left the watchlist at `now`. A later removal restarts the clock."""
    conn.execute(
        """INSERT INTO cleanup_pending (ticker, removed_at) VALUES (?, ?)
           ON CONFLICT(ticker) DO UPDATE SET removed_at = excluded.removed_at""",
        (_normalize(ticker), _iso(now or datetime.now(timezone.utc))),
    )


def clear_pending(conn: sqlite3.Connection, ticker: str) -> None:
    """The ticker is back on the watchlist: nothing is pending for it."""
    conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (_normalize(ticker),))
