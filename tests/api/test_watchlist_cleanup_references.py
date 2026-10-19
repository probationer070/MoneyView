"""Cleanup counts market-spread proxies and risk benchmarks as referenced, so it never deletes their
caches (sub-project 2 of the risk engine, plan Task 1; defect recorded in ERROR-LOG.md 2026-10-19).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apps.api.services import watchlist_cleanup
from apps.api.services.db import get_db

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
GRACE = timedelta(days=watchlist_cleanup.CLEANUP_GRACE_DAYS)


def _referenced() -> set[str]:
    with get_db() as conn:
        return watchlist_cleanup.referenced_tickers(conn)


def test_spread_proxies_are_referenced():
    assert {"BOTZ", "CIBR", "SKYY", "ICLN", "XLE", "ITA", "^GSPC"} <= _referenced()


def test_benchmarks_are_referenced():
    assert {"^SOX", "RSP", "SPY"} <= _referenced()


def test_pending_proxy_is_dropped_on_next_run():
    with get_db() as conn:
        conn.execute("INSERT INTO stocks (ticker, date, close) VALUES ('BOTZ', '2026-09-01', 1.0)")
        watchlist_cleanup.record_pending(conn, "BOTZ", now=T0 - timedelta(days=31))

    watchlist_cleanup.run_cleanup(T0)

    with get_db() as conn:
        pending = {row["ticker"] for row in conn.execute("SELECT ticker FROM cleanup_pending")}
        stocks = conn.execute("SELECT COUNT(*) FROM stocks WHERE ticker = 'BOTZ'").fetchone()[0]
    assert "BOTZ" not in pending, "a referenced proxy kept its pending record"
    assert stocks == 1, "a referenced proxy lost its cache rows"
