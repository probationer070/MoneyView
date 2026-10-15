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


def test_rerunning_init_db_on_a_database_without_the_table_restores_it():
    """Regression guard, not a test of either schema block. Re-running init_db on a database that
    lacks the table must restore it. With both blocks present, the primary CREATE in
    _CREATE_SCHEMA_SQL does the work, so this test alone cannot tell the two blocks apart; the
    compatibility-path test below pins the fallback on its own.
    """
    with get_db() as conn:
        present = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "cleanup_pending" in present, "setup: cleanup_pending must exist before the DROP"
        conn.execute("DROP TABLE cleanup_pending")
    db_service.init_db()
    with get_db() as conn:
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "cleanup_pending" in tables, "init_db did not add cleanup_pending to an existing database"


def test_the_compatibility_path_alone_creates_the_pending_table():
    """Calls _ensure_schema_compatibility directly on a database without the table (the fixture has
    already run init_db). This does NOT reproduce the legacy init_db path, the one where the create
    script stops at the universe_key error: that path crashes earlier, at db.py:897
    (corporate_quote_facts), a pre-existing defect outside this task. This test pins the fallback
    block by itself.
    """
    with get_db() as conn:
        conn.execute("DROP TABLE cleanup_pending")
        db_service._ensure_schema_compatibility(conn)
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "cleanup_pending" in tables, "_ensure_schema_compatibility did not create cleanup_pending"


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
