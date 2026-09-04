import sqlite3
from pathlib import Path

import pytest

from apps.api.services import db as db_service
from apps.api.services.db import get_db
from scripts import reset_snapshots as reset_module
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
        "INSERT INTO corporate_comparison_snapshots "
        "(snapshot_date, snapshot_taken_at, ticker) "
        "VALUES ('2026-04-23', '2026-04-23T00:00:00+00:00', 'MSFT')"
    )
    conn.execute(
        "INSERT INTO corporate_comparison_snapshots_v2 "
        "(snapshot_date, universe_key, snapshot_taken_at, ticker) "
        "VALUES ('2026-04-23', 'u', '2026-04-23T00:00:00+00:00', 'MSFT')"
    )
    conn.execute(
        "INSERT INTO corporate_comparison_snapshots_v3 "
        "(snapshot_version, snapshot_date, universe_key, snapshot_taken_at, ticker) "
        "VALUES ('v1', '2026-04-23', 'u', '2026-04-23T00:00:00+00:00', 'MSFT')"
    )


def test_reset_clears_every_snapshot_table_not_only_v3():
    """Clearing only _v3 would leave v1 rows behind and the clean start would be
    false. (Row counts deliberately not quoted here: the live database held 139
    v1 and 880 _v3 rows when this was written, and _v3 was silently emptied a day
    later -- see ERROR-LOG.md 2026-09-04. A measured figure restated in a comment
    becomes a claim about the present that nothing keeps true.)"""
    with get_db() as conn:
        _seed(conn)
        deleted = reset_snapshots(conn)
        assert set(deleted) == EXPECTED_SNAPSHOT_TABLES, deleted
        assert deleted["corporate_comparison_snapshots"] == 1
        assert deleted["corporate_comparison_snapshots_v2"] == 1
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


def _point_the_guard_at_this_test_database(monkeypatch) -> Path:
    """Make the isolated test database look like the real one to the guard.

    `_isolated_db` already repoints `db._DB_PATH` at tmp_path, so the guard's
    comparison is the only thing standing between an ad-hoc caller and the
    developer's own file. Pointing `_REAL_DB` here exercises that comparison
    without going anywhere near `data/processed/moneyview.db`.
    """
    real = Path(str(db_service._DB_PATH)).resolve()
    monkeypatch.setattr(reset_module, "_REAL_DB", real)
    return real


def test_reset_refuses_the_real_database_without_an_explicit_opt_in(monkeypatch):
    """The reason this function exists to be guarded: on 2026-09-03 it was called
    against the developer's real database outside `__main__`, and 880 snapshot
    rows across 20 versions were deleted with no backup and no error. Point-in-time
    rows cannot be regenerated. `__main__` backs up; a direct caller skips exactly
    that. See ERROR-LOG.md 2026-09-04."""
    _point_the_guard_at_this_test_database(monkeypatch)
    with get_db() as conn:
        _seed(conn)
        with pytest.raises(RuntimeError, match="real database"):
            reset_snapshots(conn)
        # The refusal must happen BEFORE any delete, not partway through.
        for table in EXPECTED_SNAPSHOT_TABLES:
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 1, table


def test_reset_backs_up_the_real_database_before_clearing_it(monkeypatch):
    """The backup used to live in `__main__`, which is the one path a careless
    caller does not take. Moving it into the function means the opt-in cannot be
    exercised without leaving a recoverable copy behind."""
    real = _point_the_guard_at_this_test_database(monkeypatch)
    with get_db() as conn:
        _seed(conn)
        # The backup captures COMMITTED state, which is what a reset destroys.
        # `__main__` starts a fresh connection with nothing pending; commit here
        # so the test models that rather than an open transaction.
        conn.commit()
        reset_snapshots(conn, allow_real_database=True)
        assert conn.execute(
            "SELECT COUNT(*) FROM corporate_comparison_snapshots_v3"
        ).fetchone()[0] == 0

    backups = sorted(real.parent.glob(real.name + ".pre-snapshot-reset-*"))
    assert len(backups) == 1, backups
    copy = sqlite3.connect(f"file:{backups[0].as_posix()}?mode=ro", uri=True)
    try:
        for table in EXPECTED_SNAPSHOT_TABLES:
            assert copy.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 1, table
    finally:
        copy.close()


def test_a_second_reset_does_not_overwrite_the_first_backup(monkeypatch):
    """A fixed backup filename silently clobbers the previous one. That cost a
    forensic artifact on 2026-09-04: re-running the reset overwrote the copy taken
    before the incident being investigated."""
    real = _point_the_guard_at_this_test_database(monkeypatch)
    with get_db() as conn:
        _seed(conn)
        conn.commit()
        reset_snapshots(conn, allow_real_database=True)
        _seed(conn)
        conn.commit()
        reset_snapshots(conn, allow_real_database=True)

    backups = sorted(real.parent.glob(real.name + ".pre-snapshot-reset-*"))
    assert len(backups) == 2, backups


def test_an_ordinary_database_needs_no_opt_in(monkeypatch):
    """The guard must not make the function unusable everywhere else: every other
    caller, including the test above, works on a throwaway file and must not have
    to pass a flag that exists for one specific path."""
    monkeypatch.setattr(reset_module, "_REAL_DB", Path("/nonexistent/moneyview.db"))
    with get_db() as conn:
        _seed(conn)
        deleted = reset_snapshots(conn)
        assert deleted["corporate_comparison_snapshots_v3"] == 1


def test_the_guard_points_at_this_repository_s_real_database():
    """Every other test here monkeypatches `_REAL_DB`, so none of them can see it
    being pointed somewhere harmless. Repointed at a path that never exists, the
    guard silently never fires against the developer's own file and the whole
    suite stays green -- a guard wearing an attribution it has not earned.

    The expected path is derived from THIS file's location, not read back from
    the module, so the assertion is a comparison and not `f(x) == f(x)`.
    """
    expected = Path(__file__).resolve().parents[2] / "data" / "processed" / "moneyview.db"
    assert reset_module._REAL_DB == expected.resolve(), reset_module._REAL_DB
