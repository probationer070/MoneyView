from apps.api.services.db import get_db
from scripts.reset_snapshots import reset_snapshots


# The three tables named as LITERALS, deliberately not `set(SNAPSHOT_TABLES)`:
# comparing the function's output against the same constant it iterates is
# tautological -- shrink the constant and both sides shrink together, so the
# assertion can never fail for the defect this test is named after.
EXPECTED_SNAPSHOT_TABLES = {
    "corporate_comparison_snapshots",
    "corporate_comparison_snapshots_v2",
    "corporate_comparison_snapshots_v3",
}


def _seed(conn):
    conn.execute(
        "INSERT INTO corporate_comparison_snapshots_v3 "
        "(snapshot_version, snapshot_date, universe_key, snapshot_taken_at, ticker) "
        "VALUES ('v1', '2026-04-23', 'u', '2026-04-23T00:00:00+00:00', 'MSFT')"
    )


def test_reset_clears_every_snapshot_table_not_only_v3():
    """Clearing only _v3 would leave v1 rows behind and the clean start would be
    false: the live database holds 139 rows in `corporate_comparison_snapshots`
    and 880 in `_v3`."""
    with get_db() as conn:
        _seed(conn)
        deleted = reset_snapshots(conn)
        assert set(deleted) == EXPECTED_SNAPSHOT_TABLES, deleted
        assert deleted["corporate_comparison_snapshots_v3"] == 1
        for table in EXPECTED_SNAPSHOT_TABLES:
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def test_reset_leaves_non_snapshot_tables_alone():
    """A reset that also emptied `stocks` or `watchlist` would destroy
    re-fetchable market data and hand-curated holdings for no reason."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO watchlist (ticker, name, sector, group_name, weight) "
            "VALUES ('AAPL', 'Apple', 'Technology', 'core', 0.4)"
        )
        reset_snapshots(conn)
        assert conn.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0] == 1
