"""The pending-removal store (spec 2026-10-15 §2.3): one row per ticker that left the watchlist,
holding when it left. The per-test database comes from tests/conftest.py's autouse _isolated_db.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apps.api.services import db as db_service
from apps.api.services import watchlist_cleanup
from apps.api.services.db import get_db

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def pending() -> dict[str, str]:
    with get_db() as conn:
        return {r["ticker"]: r["removed_at"] for r in conn.execute("SELECT ticker, removed_at FROM cleanup_pending")}


def test_init_db_creates_the_pending_table():
    with get_db() as conn:
        columns = {r["name"]: r for r in conn.execute("PRAGMA table_info(cleanup_pending)")}
    assert set(columns) == {"ticker", "removed_at"}, f"cleanup_pending is missing or wrong: {sorted(columns)}"
    assert columns["ticker"]["pk"] == 1
    assert columns["removed_at"]["notnull"] == 1


def test_an_existing_database_without_the_table_gains_it_on_init():
    with get_db() as conn:
        conn.execute("DROP TABLE cleanup_pending")
    db_service.init_db()
    with get_db() as conn:
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "cleanup_pending" in tables, "init_db did not add cleanup_pending to an existing database"


def test_a_second_removal_restarts_the_clock_and_the_ticker_is_normalised():
    second = T0 + timedelta(days=20)
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, " zza ", now=T0)
        watchlist_cleanup.record_pending(conn, "ZZA", now=second)
    assert pending() == {"ZZA": second.isoformat()}, "the later removal must replace the earlier one"


def test_clear_pending_removes_only_that_ticker():
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, "ZZA", now=T0)
        watchlist_cleanup.record_pending(conn, "ZZB", now=T0)
        watchlist_cleanup.clear_pending(conn, "zza")
    assert pending() == {"ZZB": T0.isoformat()}


def test_record_pending_without_a_clock_uses_utc_now():
    before = datetime.now(timezone.utc)
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, "ZZA")
    after = datetime.now(timezone.utc)
    recorded = datetime.fromisoformat(pending()["ZZA"])
    assert before <= recorded <= after and recorded.utcoffset() == timedelta(0)
