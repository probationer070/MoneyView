"""Schema for records peer sync: additive columns, the record_sync table (spec §3)."""

import sqlite3

import pytest

from apps.api.services import db as db_service
from apps.api.services.db import get_db

UID_TABLES = ("valuation_case", "investment_decision", "user_event")


def test_every_synced_table_has_a_nullable_sync_uid():
    with get_db() as conn:
        for table in UID_TABLES:
            columns = {r["name"]: r for r in conn.execute(f"PRAGMA table_info({table})")}
            assert "sync_uid" in columns, table
            assert columns["sync_uid"]["notnull"] == 0, f"{table}.sync_uid must be nullable"


def test_sync_uid_is_unique_per_table():
    with get_db() as conn:
        conn.execute("INSERT INTO user_event (label, category, start_date, sync_uid) VALUES ('A', 'fomc', '2026-01-01', 'dup')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO user_event (label, category, start_date, sync_uid) VALUES ('B', 'fomc', '2026-01-02', 'dup')")


def test_two_rows_may_both_have_no_uid_yet():
    # NULLs are distinct in a SQLite unique index, which is what makes the backfill possible.
    with get_db() as conn:
        conn.execute("INSERT INTO user_event (label, category, start_date) VALUES ('A', 'fomc', '2026-01-01')")
        conn.execute("INSERT INTO user_event (label, category, start_date) VALUES ('B', 'fomc', '2026-01-02')")
        assert conn.execute("SELECT COUNT(*) FROM user_event WHERE sync_uid IS NULL").fetchone()[0] == 2


def test_the_record_sync_table_exists_with_its_composite_key():
    with get_db() as conn:
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(record_sync)")}
        keys = [r["name"] for r in conn.execute("PRAGMA table_info(record_sync)") if r["pk"]]
    assert columns == {"kind", "uid", "updated_at", "updated_by", "removed_at", "removed_by"}
    assert sorted(keys) == ["kind", "uid"]


def test_an_old_database_gains_the_columns_without_losing_rows(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    raw.execute("CREATE TABLE user_event (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, "
                "category TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, source TEXT, "
                "note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z')")
    raw.execute("INSERT INTO user_event (label, category, start_date) VALUES ('kept', 'fomc', '2026-01-01')")
    raw.commit()
    raw.close()
    monkeypatch.setattr(db_service, "_DB_PATH", path)

    db_service.init_db()

    with get_db() as conn:
        row = conn.execute("SELECT label, sync_uid FROM user_event").fetchone()
    assert (row["label"], row["sync_uid"]) == ("kept", None)
