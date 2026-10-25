"""Deferred cache cleanup: what is deleted, when, and what never is
(spec 2026-10-15 §2; tests §4.2, §4.3, §4.4, §4.6, §4.7; plan Review Focus 1, 2, 3, 5).
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from apps.api.services import watchlist_cleanup
from apps.api.services.corporate_metrics_service import DEFAULT_COMPANIES
from apps.api.services.db import get_db

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
GRACE = timedelta(days=watchlist_cleanup.CLEANUP_GRACE_DAYS)
DAY = timedelta(days=1)
CLASSES = watchlist_cleanup.PER_TICKER_DATA_CLASSES
FULL = {"stocks": 2, "news": 1, "corporate_statements": 1, "corporate_quote_facts": 1,
        "acquisition_state": len(CLASSES), "risk_state": 1}
# What a cleanup leaves behind: corporate_statements is kept (owner decision, 2026-10-15).
GONE = {"stocks": 0, "news": 0, "corporate_statements": 1, "corporate_quote_facts": 0, "acquisition_state": 0,
        "risk_state": 0}


def seed_caches(ticker: str) -> None:
    with get_db() as conn:
        for day in ("2026-09-01", "2026-09-02"):
            conn.execute("INSERT INTO stocks (ticker, date, close) VALUES (?, ?, 1.0)", (ticker, day))
        conn.execute("INSERT INTO news (ticker, headline, url, hash) VALUES (?, 'headline', ?, ?)",
                     (ticker, f"https://example.test/{ticker}", f"hash-{ticker}"))
        conn.execute("INSERT INTO corporate_statements (ticker, statement_type, frequency, period_end, line_item, "
                     "value, fetched_at) VALUES (?, 'income', 'annual', '2025-12-31', 'revenue', 1.0, "
                     "'2026-09-01T00:00:00+00:00')", (ticker,))
        conn.execute("INSERT INTO corporate_quote_facts (ticker, market_cap, fetched_at) "
                     "VALUES (?, 1.0, '2026-09-01T00:00:00+00:00')", (ticker,))
        for data_class in CLASSES:
            conn.execute("INSERT INTO acquisition_state (data_class, subject, status) VALUES (?, ?, 'ok')",
                         (data_class, ticker))
        conn.execute("INSERT INTO risk_state (key, value) VALUES (?, '2026-09-01')", (f"deep_history:{ticker}",))


def cache_counts(ticker: str) -> dict[str, int]:
    marks = ", ".join("?" for _ in CLASSES)
    with get_db() as conn:
        def count(sql: str, *extra) -> int:
            return conn.execute(sql, (ticker, *extra)).fetchone()[0]
        return {
            "stocks": count("SELECT COUNT(*) FROM stocks WHERE ticker = ?"),
            "news": count("SELECT COUNT(*) FROM news WHERE ticker = ?"),
            "corporate_statements": count("SELECT COUNT(*) FROM corporate_statements WHERE ticker = ?"),
            "corporate_quote_facts": count("SELECT COUNT(*) FROM corporate_quote_facts WHERE ticker = ?"),
            "acquisition_state": count(
                f"SELECT COUNT(*) FROM acquisition_state WHERE subject = ? AND data_class IN ({marks})", *CLASSES),
            "risk_state": count("SELECT COUNT(*) FROM risk_state WHERE key = 'deep_history:' || ?"),
        }


def pend(ticker: str, at: datetime) -> None:
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, ticker, now=at)


def pending() -> dict[str, str]:
    with get_db() as conn:
        return {r["ticker"]: r["removed_at"] for r in conn.execute("SELECT ticker, removed_at FROM cleanup_pending")}


CASE_SQL = ("INSERT INTO valuation_case (case_name, ticker, as_of_date, base_year, target_year, riskfree_rate, "
            "wacc_initial, wacc_stable, marginal_tax_rate, roic_stable, shares_basic) "
            "VALUES (?, ?, '2026-01-01', 2026, 2031, 0.03, 0.09, 0.08, 0.21, 0.12, 10.0)")
TAKEN = "2026-09-01T00:00:00+00:00"

REFERENCES = {
    "watchlist": lambda c, t: c.execute("INSERT INTO watchlist (ticker, name) VALUES (?, 'x')", (t,)),
    "corporate_companies": lambda c, t: c.execute(
        "INSERT INTO corporate_companies (ticker, name) VALUES (?, 'x')", (t,)),
    "corporate_metrics": lambda c, t: c.execute("INSERT INTO corporate_metrics (ticker) VALUES (?)", (t,)),
    "indices": lambda c, t: c.execute(
        "INSERT INTO indices (name, ticker, date, close) VALUES ('Index', ?, '2026-09-01', 1.0)", (t,)),
    "valuation_case": lambda c, t: c.execute(CASE_SQL, (f"case-{t}", t)),
    "investment_decision": lambda c, t: c.execute(
        "INSERT INTO investment_decision (ticker, decided_at, action, memo, figures_source) "
        "VALUES (?, '2026-09-01T00:00:00Z', 'watch', 'memo', 'live')", (t,)),
    "snapshot_v1": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots (snapshot_date, snapshot_taken_at, ticker) "
        "VALUES ('2026-09-01', ?, ?)", (TAKEN, t)),
    "snapshot_v2": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots_v2 (snapshot_date, universe_key, snapshot_taken_at, ticker) "
        "VALUES ('2026-09-01', 'u', ?, ?)", (TAKEN, t)),
    "snapshot_v2_benchmark": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots_v2 (snapshot_date, universe_key, snapshot_taken_at, ticker, "
        "benchmark_ticker) VALUES ('2026-09-01', 'u', ?, 'ZZOTHER', ?)", (TAKEN, t)),
    "snapshot_v3": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots_v3 (snapshot_version, snapshot_date, universe_key, "
        "snapshot_taken_at, ticker) VALUES ('v', '2026-09-01', 'u', ?, ?)", (TAKEN, t)),
    "snapshot_v3_benchmark": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots_v3 (snapshot_version, snapshot_date, universe_key, "
        "snapshot_taken_at, ticker, benchmark_ticker) VALUES ('v', '2026-09-01', 'u', ?, 'ZZOTHER', ?)",
        (TAKEN, t)),
}


# --- §4.2: grace period under a fake clock --------------------------------------------------------

def test_one_day_before_the_grace_period_nothing_is_deleted_and_one_day_after_it_is():
    seed_caches("ZZA")
    pend("ZZA", T0)

    watchlist_cleanup.run_cleanup(T0 + GRACE - DAY)
    assert cache_counts("ZZA") == FULL, "caches were deleted before the grace period ended"

    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == GONE, "caches survived past the grace period"
    assert "ZZA" not in pending(), "a fully cleaned ticker kept its pending record"


def test_a_removal_exactly_the_grace_period_old_is_due():
    seed_caches("ZZA")
    pend("ZZA", T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE)
    assert cache_counts("ZZA") == GONE, "a removal exactly CLEANUP_GRACE_DAYS old must be due"


def test_other_tickers_caches_survive_a_cleanup():
    seed_caches("ZZA")
    seed_caches("ZZB")
    pend("ZZA", T0)
    pend("ZZB", T0 + GRACE)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == GONE
    assert cache_counts("ZZB") == FULL, "a ticker that is not yet due lost its caches"


def test_a_second_removal_restarts_the_grace_period():
    seed_caches("ZZA")
    pend("ZZA", T0)
    pend("ZZA", T0 + 20 * DAY)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == FULL, "the grace period must run from the latest removal"


# --- §4.3: a referenced ticker is never cleaned ---------------------------------------------------

@pytest.mark.parametrize("reference", sorted(REFERENCES))
def test_a_ticker_something_still_refers_to_is_never_cleaned(reference):
    ticker = "ZZREF"
    seed_caches(ticker)
    with get_db() as conn:
        REFERENCES[reference](conn, ticker)
        watchlist_cleanup.record_pending(conn, ticker, now=T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts(ticker) == FULL, f"{reference} refers to {ticker}, but its caches were deleted"
    assert ticker not in pending(), f"{reference} refers to {ticker}, but its pending record was kept"


def test_a_default_company_is_never_cleaned():
    ticker = sorted(DEFAULT_COMPANIES)[0]
    seed_caches(ticker)
    pend(ticker, T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts(ticker) == FULL, f"default company {ticker} lost its caches"


def test_a_reference_in_another_case_still_protects_the_ticker():
    seed_caches("ZZL")
    with get_db() as conn:
        conn.execute(CASE_SQL, ("lower-case case", "zzl"))
    pend("ZZL", T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZL") == FULL, "valuation_case.ticker='zzl' must protect the ZZL caches"


# --- §4.4: cleanup never touches user records or snapshots ---------------------------------------

def _row_counts_outside_the_cleanup_tables() -> dict[str, int]:
    # The four pinned cache tables are written out, not read from CLEANUP_TABLES: deriving the skip set
    # from the module under test would let a mutation of that tuple hide the table it adds.
    # corporate_statements is NOT skipped: it is a protected table that a cleanup must never change.
    skip = {"stocks", "news", "corporate_quote_facts", "acquisition_state", "risk_state", "cleanup_pending",
            "sqlite_sequence"}
    with get_db() as conn:
        tables = [r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables if t not in skip}


def test_the_cleanup_tables_are_exactly_the_five_refetchable_caches():
    # risk_state holds only one refetchable entry per ticker, its deep_history marker (test below).
    assert {table for table, _ in watchlist_cleanup.CLEANUP_TABLES} == {
        "stocks", "news", "corporate_quote_facts", "acquisition_state", "risk_state",
    }, "CLEANUP_TABLES must list only caches that are re-fetched on demand"
    assert "statements" not in CLASSES, "the statements data class must never be cleaned"


def test_corporate_statements_and_their_state_survive_a_cleanup():
    seed_caches("ZZS")
    with get_db() as conn:
        # OR IGNORE: a mutation that puts 'statements' back into CLASSES makes seed_caches write this row
        # first, and the failure must then come from the cleanup deleting it, not from this insert.
        conn.execute("INSERT OR IGNORE INTO acquisition_state (data_class, subject, status) "
                     "VALUES ('statements', 'ZZS', 'ok')")
    pend("ZZS", T0)

    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)

    assert cache_counts("ZZS") == GONE, "a due ticker's stocks, news, quote facts or acquisition classes survived"
    with get_db() as conn:
        statement_rows = conn.execute("SELECT COUNT(*) FROM corporate_statements WHERE ticker = 'ZZS'").fetchone()[0]
        statement_state = conn.execute(
            "SELECT COUNT(*) FROM acquisition_state WHERE data_class = 'statements' AND subject = 'ZZS'").fetchone()[0]
    assert statement_rows == 1, "the corporate_statements history was deleted"
    assert statement_state == 1, "the statements acquisition state was deleted"
    assert "ZZS" not in pending(), "a fully cleaned ticker kept its pending record"


def test_a_ticker_with_only_statements_is_never_a_candidate():
    with get_db() as conn:
        conn.execute("INSERT INTO corporate_statements (ticker, statement_type, frequency, period_end, line_item, "
                     "value, fetched_at) VALUES ('ZZO', 'income', 'annual', '2025-12-31', 'revenue', 1.0, "
                     "'2026-09-01T00:00:00+00:00')")
    watchlist_cleanup.run_cleanup(T0)
    assert pending() == {}, "a statements-only ticker was recorded as a cleanup candidate"


def test_a_cleanup_run_never_changes_any_other_table():
    seed_caches("KEEP")
    seed_caches("ZZA")
    with get_db() as conn:
        for reference in ("watchlist", "corporate_metrics", "corporate_companies", "valuation_case",
                          "investment_decision", "snapshot_v1", "snapshot_v2", "snapshot_v3", "indices"):
            REFERENCES[reference](conn, "KEEP")
        # ZZA's own sync tombstone and a global index_bars row: neither is ever a cleanup target.
        conn.execute("INSERT INTO watchlist_removed (ticker, removed_at, removed_by) "
                     "VALUES ('ZZA', '2026-09-01T00:00:00.000Z', 'PC-A-0001')")
        conn.execute("INSERT INTO record_sync (kind, uid, updated_at, updated_by) "
                     "VALUES ('corporate_metrics', 'KEEP', '2026-09-01T00:00:00.000Z', 'PC-A-0001')")
        conn.execute("INSERT INTO acquisition_state (data_class, subject, status) VALUES ('index_bars', 'ZZA', 'ok')")
    pend("ZZA", T0)
    before = _row_counts_outside_the_cleanup_tables()

    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)

    assert cache_counts("ZZA") == GONE
    assert _row_counts_outside_the_cleanup_tables() == before, "cleanup changed a table it must never touch"
    assert cache_counts("KEEP") == FULL, "a referenced ticker lost caches"
    with get_db() as conn:
        index_bars = conn.execute("SELECT COUNT(*) FROM acquisition_state WHERE data_class = 'index_bars'").fetchone()[0]
    assert index_bars == 1, "the global index_bars state row was deleted"


def test_market_wide_news_is_never_a_candidate_and_never_deleted():
    with get_db() as conn:
        conn.execute("INSERT INTO news (ticker, headline, url, hash) VALUES (NULL, 'market', 'https://m', 'h-null')")
        conn.execute("INSERT INTO news (ticker, headline, url, hash) VALUES ('', 'blank', 'https://b', 'h-blank')")
    seed_caches("ZZA")
    pend("ZZA", T0)
    watchlist_cleanup.run_cleanup(T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    with get_db() as conn:
        unattributed = conn.execute("SELECT COUNT(*) FROM news WHERE ticker IS NULL OR ticker = ''").fetchone()[0]
    assert unattributed == 2, "market-wide news rows were deleted"
    assert set(pending()) <= {"ZZA"}, f"an unattributed news row became a candidate: {pending()}"


# --- §4.6: the first run records and deletes nothing ----------------------------------------------

def test_the_first_run_records_pending_times_and_deletes_nothing():
    seed_caches("ZZA")
    seed_caches("ZZB")
    deleted = watchlist_cleanup.run_cleanup(T0)
    assert deleted == {}, "the first run deleted caches"
    assert cache_counts("ZZA") == FULL and cache_counts("ZZB") == FULL, "the first run deleted caches"
    assert pending() == {"ZZA": T0.isoformat(), "ZZB": T0.isoformat()}, "the first run did not record 'now'"

    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == GONE, "the recorded first-run time was not used as the removal time"


def test_a_pending_record_of_a_referenced_ticker_is_dropped():
    pend("ZZA", T0)
    with get_db() as conn:
        REFERENCES["watchlist"](conn, "ZZA")
    watchlist_cleanup.run_cleanup(T0 + DAY)
    assert "ZZA" not in pending(), "a referenced ticker kept a stale pending record"


# --- §4.7: a failure in one table does not stop the rest -------------------------------------------

def test_a_failure_in_one_table_does_not_stop_the_rest(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger=watchlist_cleanup.__name__)
    tables = watchlist_cleanup.CLEANUP_TABLES
    monkeypatch.setattr(watchlist_cleanup, "CLEANUP_TABLES", (tables[0], ("no_such_table", "ticker = ?"), *tables[1:]))
    seed_caches("ZZA")
    seed_caches("ZZB")
    pend("ZZA", T0)
    pend("ZZB", T0)

    deleted = watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)

    assert cache_counts("ZZA") == GONE, "one failing table stopped the other tables of ZZA"
    assert cache_counts("ZZB") == GONE, "one failing ticker stopped the next ticker"
    assert deleted["ZZB"]["stocks"] == 2
    assert set(pending()) == {"ZZA", "ZZB"}, "a ticker with a failed table must stay pending for a retry"
    assert "cleanup.failed ticker=ZZA table=no_such_table" in caplog.text


def test_each_deleted_batch_is_logged(caplog):
    caplog.set_level(logging.INFO, logger=watchlist_cleanup.__name__)
    seed_caches("ZZA")
    pend("ZZA", T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert "cleanup.deleted ticker=ZZA table=stocks rows=2" in caplog.text
    assert f"cleanup.deleted ticker=ZZA table=acquisition_state rows={len(CLASSES)}" in caplog.text


# --- Review Focus 3 and 5 --------------------------------------------------------------------------

def test_a_ticker_re_added_before_its_delete_transaction_keeps_its_caches():
    seed_caches("ZZA")
    pend("ZZA", T0)
    with get_db() as conn:  # re-added after run_cleanup would have built its due list
        REFERENCES["watchlist"](conn, "ZZA")
    assert watchlist_cleanup.delete_ticker_caches("ZZA") == {}
    assert cache_counts("ZZA") == FULL, "a ticker re-added before its delete transaction lost its caches"
    assert "ZZA" not in pending()


def test_a_failing_reference_query_deletes_nothing(monkeypatch):
    monkeypatch.setattr(watchlist_cleanup, "_REFERENCE_QUERIES",
                        (*watchlist_cleanup._REFERENCE_QUERIES, "SELECT ticker FROM no_such_table"))
    seed_caches("ZZA")
    pend("ZZA", T0)
    with pytest.raises(sqlite3.OperationalError, match="no_such_table"):
        watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == FULL, "a run that could not read every reference deleted caches"
    watchlist_cleanup.run_cleanup_logged()  # must not raise


# --- Fix round 1: a malformed removal time, a naive one, and normalised backfill keys ----------------

def test_a_malformed_removal_time_skips_only_that_ticker_and_restarts_its_clock(caplog):
    caplog.set_level(logging.WARNING, logger=watchlist_cleanup.__name__)
    seed_caches("ZZA")
    seed_caches("ZZB")
    with get_db() as conn:
        conn.execute("INSERT INTO cleanup_pending (ticker, removed_at) VALUES ('ZZA', 'garbage')")
    pend("ZZB", T0)
    now = T0 + GRACE + DAY

    watchlist_cleanup.run_cleanup(now)  # must not raise

    assert cache_counts("ZZB") == GONE, "a malformed row stopped the other tickers"
    assert cache_counts("ZZA") == FULL, "a malformed removal time deleted caches"
    assert datetime.fromisoformat(pending()["ZZA"]) == now, "the malformed row's clock was not restarted"
    assert "cleanup.bad_pending ticker=ZZA" in caplog.text
    assert "garbage" not in caplog.text, "the raw malformed value was logged"
    watchlist_cleanup.run_cleanup(now + GRACE - DAY)
    assert cache_counts("ZZA") == FULL, "the restarted clock deleted caches early"
    watchlist_cleanup.run_cleanup(now + GRACE)
    assert cache_counts("ZZA") == GONE, "the restarted clock never came due"


def test_a_removal_time_without_an_offset_is_read_as_utc():
    seed_caches("ZZN")
    with get_db() as conn:
        conn.execute("INSERT INTO cleanup_pending (ticker, removed_at) VALUES ('ZZN', '2026-09-01T00:00:00')")
    boundary = datetime(2026, 9, 1, tzinfo=timezone.utc) + GRACE

    watchlist_cleanup.run_cleanup(boundary - timedelta(hours=1))
    assert cache_counts("ZZN") == FULL, "a naive removal time was due before 30 UTC days"
    watchlist_cleanup.run_cleanup(boundary)
    assert cache_counts("ZZN") == GONE, "a naive removal time was not due at 30 UTC days"


def test_the_backfill_records_one_normalised_key_per_ticker():
    seed_caches("zza")
    seed_caches("ZZA")
    watchlist_cleanup.run_cleanup(T0)
    assert pending() == {"ZZA": T0.isoformat()}, "the backfill recorded two pending rows for one ticker"


def test_a_cleanup_deletes_only_the_tickers_deep_history_marker():
    """Mutation caught: the risk_state entry dropped from CLEANUP_TABLES (a re-added ticker would never
    refetch deep history after its bars were deleted), or a WHERE clause that deletes other risk_state keys."""
    seed_caches("ZZA")
    seed_caches("ZZB")
    with get_db() as conn:
        conn.execute("INSERT INTO risk_state (key, value) VALUES ('backfill:abcd1234', 'done')")
        conn.execute("INSERT INTO risk_state (key, value) VALUES ('coverage_wait:2026-09-01', 'x')")
    pend("ZZA", T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    with get_db() as conn:
        keys = {r["key"] for r in conn.execute("SELECT key FROM risk_state")}
    keys.discard("news_publisher_backfill_done")  # written by the db.py migration on every fresh DB
    assert keys == {"deep_history:ZZB", "backfill:abcd1234", "coverage_wait:2026-09-01"}
