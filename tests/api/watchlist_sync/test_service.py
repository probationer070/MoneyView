"""Two or three simulated PCs sharing one sync folder (spec §3, Testing: simulated PCs)."""

import json
import sqlite3

import pytest

from apps.api.services import db as db_service
from apps.api.services import watchlist_seed
from apps.api.services.db import get_db
from apps.api.services.watchlist_sync import files, service, store
from apps.api.services.watchlist_sync.model import BASELINE_TS, SyncState, Tombstone, next_stamp


class PC:
    def __init__(self, tmp_path, name, monkeypatch):
        self.name = name
        self.db = tmp_path / f"{name}.db"
        self.monkeypatch = monkeypatch
        self.use()
        db_service.init_db()

    def use(self):
        self.monkeypatch.setattr(db_service, "_DB_PATH", self.db)
        self.monkeypatch.setattr(store, "host_name", lambda: self.name)
        return self

    def sync(self):
        self.use()
        service.run_sync("test")
        return self

    def rows(self):
        self.use()
        with get_db() as conn:
            return {r["ticker"]: dict(r) for r in conn.execute("SELECT ticker, group_name, weight, updated_at, updated_by FROM watchlist")}

    def tombstones(self):
        self.use()
        with get_db() as conn:
            return {r["ticker"]: (r["removed_at"], r["removed_by"]) for r in conn.execute("SELECT * FROM watchlist_removed")}

    def add(self, ticker, group="custom", weight=0.1):
        self.use()
        with get_db() as conn:
            pc_id = service.local_pc_id(conn)
            conn.execute("INSERT OR REPLACE INTO watchlist (ticker, name, sector, group_name, weight) VALUES (?, ?, '', ?, ?)",
                         (ticker, ticker, group, weight))
            store.stamp_row(conn, ticker, pc_id)
        return self.sync()

    def delete(self, ticker):
        self.use()
        with get_db() as conn:
            pc_id = service.local_pc_id(conn)
            store.record_removal(conn, ticker, pc_id)
            conn.execute("DELETE FROM watchlist WHERE ticker = ?", (ticker,))
        return self.sync()


@pytest.fixture
def cloud(tmp_path, monkeypatch):
    root = tmp_path / "cloud"
    root.mkdir()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(root))
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"custom": {"targets": [{"ticker": "SEED", "name": "Seed", "sector": "", "weight": 0.0}]}}), encoding="utf-8")
    monkeypatch.setattr(watchlist_seed, "SEED_JSON", seed)
    return root


def test_an_add_on_one_pc_reaches_the_other(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.add("NVDA")
    b.sync()
    assert "NVDA" in b.rows()


def test_a_delete_on_one_pc_removes_it_on_the_other(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("NVDA"); b.sync()
    b.delete("NVDA")
    a.sync()
    assert "NVDA" not in a.rows()


def test_edits_to_different_tickers_on_both_pcs_both_survive(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("AAA"); b.add("BBB")
    a.sync(); b.sync()
    assert {"AAA", "BBB"} <= set(a.rows()) and {"AAA", "BBB"} <= set(b.rows())


def test_first_sync_is_a_union_and_invents_no_deletions(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    for pc, ticker in ((a, "ONLY-A"), (b, "ONLY-B")):
        pc.use()
        with get_db() as conn:
            conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES (?, ?, '', 'custom', 0.0)", (ticker, ticker))
    a.sync(); b.sync(); a.sync()
    assert {"ONLY-A", "ONLY-B"} <= set(a.rows()) and {"ONLY-A", "ONLY-B"} <= set(b.rows())
    assert a.rows()["ONLY-A"]["updated_at"] == BASELINE_TS
    assert a.tombstones() == {} and b.tombstones() == {}


def test_a_fresh_pc_with_peers_takes_their_merged_list_not_the_defaults(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("AAA"); b.add("BBB")
    fresh = PC(tmp_path, "PC-NEW", monkeypatch).sync()
    assert {"AAA", "BBB"} <= set(fresh.rows())
    assert "SEED" not in fresh.rows(), "defaults are not seeded when a readable peer exists"


def test_a_fresh_pc_without_peers_gets_the_seed_at_the_baseline(tmp_path, monkeypatch, cloud):
    fresh = PC(tmp_path, "PC-NEW", monkeypatch).sync()
    assert fresh.rows()["SEED"]["updated_at"] == BASELINE_TS


def test_an_empty_merged_peer_state_leaves_a_fresh_pc_empty(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch).sync()   # empty, no peers: seeds SEED
    assert set(a.rows()) == {"SEED"}
    a.delete("SEED")                                # A's file now holds no rows, one tombstone
    fresh = PC(tmp_path, "PC-NEW", monkeypatch).sync()
    assert fresh.rows() == {}


def test_imported_tombstones_are_republished_to_a_third_pc(tmp_path, monkeypatch, cloud):
    a, b, c = (PC(tmp_path, n, monkeypatch) for n in ("PC-A", "PC-B", "PC-C"))
    a.add("NVDA"); b.sync(); c.sync()
    b.delete("NVDA")
    a.sync()
    b.use()
    with get_db() as conn:
        b_id = service.local_pc_id(conn)
    files.own_file_path(cloud, b_id).unlink()
    c.sync()
    assert "NVDA" not in c.rows()


def test_an_off_then_on_edit_keeps_its_real_time_and_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("NVDA", group="custom"); b.sync()
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR")
    b.use()
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
        conn.execute("UPDATE watchlist SET group_name = 'total' WHERE ticker = 'NVDA'")
        store.stamp_row(conn, "NVDA", pc_id)
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(cloud))
    b.sync(); a.sync()
    assert a.rows()["NVDA"]["group_name"] == "total"


def test_the_seed_merge_does_not_revive_a_ticker_deleted_on_another_pc(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync(); a.sync()
    b.delete("SEED")
    a.sync()
    a.use()
    watchlist_seed.ensure_watchlist_bootstrapped(watchlist_seed.SEED_JSON)
    assert "SEED" not in a.rows()


def test_a_failed_publish_keeps_the_local_change_and_retries(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch).sync()

    def refuse(*args, **kwargs):
        raise PermissionError("simulated publish failure")

    monkeypatch.setattr(service, "write_own_file", refuse)
    a.add("NVDA")
    assert "NVDA" in a.rows()
    assert "simulated publish failure" in service.current_status().last_error

    # Restore just this patch: monkeypatch.undo() would also undo conftest's autouse guards.
    monkeypatch.setattr(service, "write_own_file", files.write_own_file)
    a.sync()
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
    published = json.loads(files.own_file_path(cloud, pc_id).read_text(encoding="utf-8"))
    assert "NVDA" in {row["ticker"] for row in published["watchlist"]}
    assert service.current_status().last_error is None


def test_status_lists_peers_and_only_the_last_attempts_skips(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    bad = cloud / "MoneyView" / "watchlist.PC-BROKEN-0000.json"
    bad.write_text("{", encoding="utf-8")
    a.sync()
    status = service.current_status()
    assert [p.pc_id for p in status.peers][0].startswith("PC-B-")
    assert [s.name for s in status.skipped_files] == [bad.name]
    bad.unlink()
    a.sync()
    assert service.current_status().skipped_files == []


def test_a_missing_folder_is_recorded_and_changes_nothing(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch).sync()
    before = a.rows()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "gone"))
    a.sync()
    assert a.rows() == before
    assert "does not exist" in service.current_status().last_error


def test_both_pcs_converge_on_identical_state(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()                              # A seeds SEED; B takes it from A
    a.add("AAA", weight=0.1); b.add("AAA", weight=0.2); a.delete("SEED")
    b.add("BBB"); a.add("CCC"); b.sync(); b.delete("CCC")
    for _ in range(2):
        a.sync(); b.sync()
    assert a.rows() == b.rows()
    assert a.tombstones() == b.tombstones()


def test_sync_off_does_nothing(tmp_path, monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    a = PC(tmp_path, "PC-A", monkeypatch)
    with get_db() as conn:
        conn.execute(
            "INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES (?, ?, '', 'custom', 0.0)",
            ("UNSTAMPED", "UNSTAMPED"),
        )
    service.run_sync("test")
    assert service.current_status().enabled is False
    assert not (tmp_path / "MoneyView").exists()
    with get_db() as conn:
        marker = conn.execute(
            "SELECT 1 FROM dataset_metadata WHERE dataset_name = 'watchlist_sync_enabled_at'"
        ).fetchone()
        row = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'UNSTAMPED'").fetchone()
    assert marker is None
    assert row["updated_at"] is None


def test_ensure_watchlist_bootstrapped_prefers_peers_over_the_seed_on_a_truly_fresh_pc(tmp_path, monkeypatch, cloud):
    """`ensure_watchlist_bootstrapped` is the real call site (apps/api/routes/portfolio.py) --
    unlike the other tests here, which drive `service.run_sync` through `PC.sync()` directly and
    so never exercise this wrapper's own precedence. A fresh PC that has never synced must still
    prefer its peers' content over the seed when `ensure_watchlist_bootstrapped` is the entry
    point, not just when `run_sync` is called directly."""
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("AAA"); b.add("BBB")
    fresh = PC(tmp_path, "PC-NEW", monkeypatch)
    fresh.use()
    watchlist_seed.ensure_watchlist_bootstrapped(watchlist_seed.SEED_JSON)
    assert {"AAA", "BBB"} <= set(fresh.rows())
    assert "SEED" not in fresh.rows(), "defaults are not seeded when a readable peer exists"


def test_ensure_first_sync_runs_before_read_local_state_on_every_run(tmp_path, monkeypatch, cloud):
    """Controller requirement carried from the Task 4 review: `run_sync` must call
    `store.ensure_first_sync` BEFORE `store.read_local_state` on EVERY run, not only the
    first. A raw-SQL row inserted with no timestamps must still be baseline-stamped and
    published on the very next sync, and the sync must not record an error while doing it."""
    a = PC(tmp_path, "PC-A", monkeypatch).sync()
    a.use()
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
        conn.execute(
            "INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES (?, ?, '', 'custom', 0.0)",
            ("UNSTAMPED", "UNSTAMPED"),
        )
    a.sync()
    assert a.rows()["UNSTAMPED"]["updated_at"] == BASELINE_TS
    assert a.rows()["UNSTAMPED"]["updated_by"] == pc_id
    published = json.loads(files.own_file_path(cloud, pc_id).read_text(encoding="utf-8"))
    published_row = next(row for row in published["watchlist"] if row["ticker"] == "UNSTAMPED")
    assert published_row["updated_at"] == BASELINE_TS
    assert published_row["updated_by"] == pc_id
    assert service.current_status().last_error is None


def test_a_concurrent_local_write_is_not_silently_lost_during_run_sync(tmp_path, monkeypatch, cloud):
    """I1: the read-merge-apply block opens with `BEGIN IMMEDIATE`, holding SQLite's write lock for
    the whole snapshot-then-apply window. Without it, a second connection could commit a new row
    between `read_local_state` and `apply_state`; `apply_state` re-reads `current` from the DB, so
    that freshly committed row would show up there but not in the older `merged` snapshot, and get
    silently DELETEd as if it were a row that had disappeared.

    The racing writer uses a short `timeout` rather than the default so it fails fast instead of
    waiting out the busy timeout: with the lock held by the same connection/thread as `run_sync`,
    a long wait would just be a slow, deterministic deadlock, not a useful assertion.
    """
    a = PC(tmp_path, "PC-A", monkeypatch).sync()
    a.use()
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)

    real_merge_states = service.merge_states
    blocked = {"value": False}

    def racing_merge_states(states):
        try:
            race_conn = sqlite3.connect(str(db_service._DB_PATH), timeout=0.2)
            try:
                race_conn.execute(
                    "INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES ('RACE', 'RACE', '', 'custom', 0.0)"
                )
                store.stamp_row(race_conn, "RACE", pc_id)
                race_conn.commit()
            finally:
                race_conn.close()
        except sqlite3.OperationalError as error:
            if "database is locked" not in str(error):
                raise
            blocked["value"] = True
        return real_merge_states(states)

    monkeypatch.setattr(service, "merge_states", racing_merge_states)
    a.sync()
    monkeypatch.setattr(service, "merge_states", real_merge_states)

    assert blocked["value"], "the concurrent writer must be held off by BEGIN IMMEDIATE, not merely lucky"

    # Once run_sync's transaction has closed, the same write must succeed and stick -- the lock
    # only serialises the critical section, it does not wedge the database.
    with get_db() as conn:
        conn.execute(
            "INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES ('RACE', 'RACE', '', 'custom', 0.0)"
        )
        store.stamp_row(conn, "RACE", pc_id)
    assert "RACE" in a.rows()


def test_a_pc_that_joins_through_peers_is_marked_bootstrapped(tmp_path, monkeypatch, cloud):
    """I2: a PC whose empty table is filled entirely from a peer (no local bootstrap ran) must
    still be marked bootstrapped. Otherwise a later attempt where every peer file happens to be
    unreadable looks exactly like a genuinely fresh PC, and the seed defaults get inserted and
    spread back out to every other PC through this one's own published file.

    The peer's file is fabricated directly (rather than driven through a second simulated PC's own
    `run_sync`) so it can hold exactly what this test needs: an empty watchlist and a tombstone for
    an unrelated ticker, never "SEED" itself. A "SEED" tombstone would get copied into the fresh
    PC's own local table during its first sync and, by outranking a later BASELINE_TS reseed, would
    hide this exact bug regardless of whether the fix is present.
    """
    peer_pc_id = "PC-PEER-0000"
    peer_state = SyncState(
        rows={},
        removed={"TEMP": Tombstone(ticker="TEMP", removed_at=next_stamp(), removed_by=peer_pc_id)},
    )
    files.write_own_file(cloud, peer_pc_id, peer_state, next_stamp())

    fresh = PC(tmp_path, "PC-NEW", monkeypatch).sync()  # empty local table, one peer: merged empty
    assert fresh.rows() == {}

    # The only peer fresh has ever seen becomes unreadable: the next sync finds no readable peer.
    files.own_file_path(cloud, peer_pc_id).write_text("{", encoding="utf-8")

    fresh.use()
    fresh.sync()
    assert fresh.rows() == {}, "a PC already bootstrapped through a peer must not reseed just because that peer went unreadable"
