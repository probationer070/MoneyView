"""SQLite side of sync: additive schema, durable pc_id, first-sync baseline, apply (spec §1)."""

import sqlite3

from apps.api.services import db as db_service
from apps.api.services.db import get_db
from apps.api.services.watchlist_sync import store
from apps.api.services.peer_sync.model import BASELINE_TS, SyncRow, SyncState, Tombstone


def _insert(ticker, group="custom", weight=0.1):
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES (?, ?, '', ?, ?)",
                     (ticker, ticker, group, weight))


def test_the_new_columns_and_table_exist():
    with get_db() as conn:
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(watchlist)")}
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"updated_at", "updated_by"} <= columns
    assert "watchlist_removed" in tables


def test_an_old_database_gains_the_columns_without_losing_rows(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    raw.execute("CREATE TABLE watchlist (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE, "
                "name TEXT DEFAULT '', sector TEXT DEFAULT '', group_name TEXT DEFAULT 'custom', weight REAL DEFAULT 0.0)")
    raw.execute("INSERT INTO watchlist (ticker, weight) VALUES ('AAPL', 0.4)")
    raw.commit()
    raw.close()
    monkeypatch.setattr(db_service, "_DB_PATH", path)

    db_service.init_db()

    with get_db() as conn:
        row = conn.execute("SELECT ticker, weight, updated_at, updated_by FROM watchlist").fetchone()
    assert (row["ticker"], row["weight"], row["updated_at"], row["updated_by"]) == ("AAPL", 0.4, None, None)


def test_pc_id_is_generated_once_and_survives_a_rename(monkeypatch):
    monkeypatch.setattr(store, "host_name", lambda: "DESKTOP ONE")
    with get_db() as conn:
        first = store.get_or_create_pc_id(conn)
    monkeypatch.setattr(store, "host_name", lambda: "RENAMED-PC")
    with get_db() as conn:
        second = store.get_or_create_pc_id(conn)

    assert first == second
    assert first.startswith("DESKTOP-ONE-") and len(first) == len("DESKTOP-ONE-") + 4


def test_first_sync_stamps_untimestamped_rows_with_the_baseline_and_keeps_real_ones():
    _insert("AAPL")
    _insert("NVDA")
    with get_db() as conn:
        conn.execute("UPDATE watchlist SET updated_at = '2026-09-17T01:00:00.000Z', updated_by = 'PC-X-0000' WHERE ticker = 'NVDA'")
        store.ensure_first_sync(conn, "PC-ME-00ff")
        rows = {r["ticker"]: (r["updated_at"], r["updated_by"]) for r in conn.execute("SELECT * FROM watchlist")}
        tombs = conn.execute("SELECT COUNT(*) FROM watchlist_removed").fetchone()[0]

    assert rows["AAPL"] == (BASELINE_TS, "PC-ME-00ff")
    assert rows["NVDA"] == ("2026-09-17T01:00:00.000Z", "PC-X-0000")
    assert tombs == 0, "first sync never invents deletions"


def test_ensure_first_sync_stamps_new_null_rows_on_every_call_but_the_marker_is_written_once():
    """R3: a NULL updated_at is by definition a change never stamped, so it is the correct key
    whenever one is found -- even after the marker already exists. The marker itself is written
    only the first time."""
    _insert("AAPL")
    with get_db() as conn:
        store.ensure_first_sync(conn, "PC-ME-00ff")
        marker_before = conn.execute(
            "SELECT last_updated_at FROM dataset_metadata WHERE dataset_name = ?", (store.ENABLED_DATASET,)
        ).fetchone()["last_updated_at"]

    _insert("NVDA")
    with get_db() as conn:
        store.ensure_first_sync(conn, "PC-ME-00ff")
        row = conn.execute("SELECT updated_at, updated_by FROM watchlist WHERE ticker = 'NVDA'").fetchone()
        marker_after = conn.execute(
            "SELECT last_updated_at FROM dataset_metadata WHERE dataset_name = ?", (store.ENABLED_DATASET,)
        ).fetchone()["last_updated_at"]

    assert (row["updated_at"], row["updated_by"]) == (BASELINE_TS, "PC-ME-00ff")
    assert marker_after == marker_before


def test_apply_state_writes_rows_tombstones_and_deletes_absent_rows_keeping_authors():
    _insert("AAPL")
    _insert("OLD")
    with get_db() as conn:
        # A local tombstone that the merge has since superseded with a newer one by another
        # author: apply_state must overwrite it, not leave the older one in place.
        conn.execute(
            "INSERT INTO watchlist_removed (ticker, removed_at, removed_by) VALUES (?, ?, ?)",
            ("TSLA", "2026-09-18T09:00:00.000Z", "PC-A-0001"),
        )
    merged = SyncState(
        rows={
            "AAPL": SyncRow("AAPL", "Apple", "Tech", "total", 0.3, "2026-09-18T10:00:00.000Z", "PC-B-0002"),
            # No local row for MSFT: apply_state's insert path, not its update path.
            "MSFT": SyncRow("MSFT", "Microsoft", "Tech", "custom", 0.2, "2026-09-18T11:00:00.000Z", "PC-C-0003"),
        },
        removed={
            "OLD": Tombstone("OLD", "2026-09-18T10:00:00.000Z", "PC-B-0002"),
            "TSLA": Tombstone("TSLA", "2026-09-18T12:00:00.000Z", "PC-D-0004"),
        },
    )
    with get_db() as conn:
        store.apply_state(conn, merged)
        state = store.read_local_state(conn)

    assert state == merged
    assert state.rows["MSFT"].updated_by == "PC-C-0003"
    assert state.removed["TSLA"] == Tombstone("TSLA", "2026-09-18T12:00:00.000Z", "PC-D-0004")


def test_stamp_row_and_record_removal_use_this_pc():
    _insert("AAPL")
    with get_db() as conn:
        store.stamp_row(conn, "AAPL", "PC-ME-00ff")
        store.record_removal(conn, "MSFT", "PC-ME-00ff")
        state = store.read_local_state(conn)
    assert state.rows["AAPL"].updated_by == "PC-ME-00ff" and state.rows["AAPL"].updated_at > BASELINE_TS
    assert state.removed["MSFT"].removed_by == "PC-ME-00ff"


def test_apply_state_writes_theme_and_read_returns_it():
    """Mutation: dropping theme from the INSERT / ON CONFLICT DO UPDATE in apply_state -> the stored
    theme stays "" and this round trip fails. The insert path and the update path are both covered."""
    _insert("AAPL")
    merged = SyncState(rows={
        "AAPL": SyncRow("AAPL", "AAPL", "", "custom", 0.1, "2026-09-18T10:00:00.000Z", "PC-B-0002", theme="ai_semis"),
        "NVDA": SyncRow("NVDA", "NVDA", "", "custom", 0.1, "2026-09-18T10:00:00.000Z", "PC-B-0002", theme="crypto"),
    })
    with get_db() as conn:
        store.apply_state(conn, merged)
        state = store.read_local_state(conn)

    assert state.rows["AAPL"].theme == "ai_semis"
    assert state.rows["NVDA"].theme == "crypto"
    assert state == merged


def test_an_older_themeless_peer_row_does_not_erase_a_newer_local_theme():
    """Uses the service's own path: merge_states over local and peer state, then apply_state.
    Mutation: dropping theme from order_key means the same-author rows tie on everything but
    content, so the themeless peer row can win and the theme is erased."""
    _insert("AAPL")
    with get_db() as conn:
        conn.execute("UPDATE watchlist SET theme = 'ai_semis', updated_at = '2026-09-18T12:00:00.000Z', "
                     "updated_by = 'PC-ME-00ff' WHERE ticker = 'AAPL'")
        local = store.read_local_state(conn)
    peer = SyncState(rows={"AAPL": SyncRow("AAPL", "AAPL", "", "custom", 0.1,
                                           "2026-09-18T10:00:00.000Z", "PC-B-0002")})

    from apps.api.services.peer_sync.model import merge_states
    with get_db() as conn:
        store.apply_state(conn, merge_states([local, peer]))
        theme = conn.execute("SELECT theme FROM watchlist WHERE ticker = 'AAPL'").fetchone()["theme"]

    assert theme == "ai_semis"
