"""Two or three simulated PCs sharing one sync folder for records peer sync (spec §3)."""

import json
import sqlite3

import pytest

from apps.api.services import db as db_service
from apps.api.services.db import get_db
from apps.api.services.events import store as events_store
from apps.api.services.records_sync import files, service, store
from apps.api.services.peer_sync.model import BASELINE_TS, SEED_TS
from apps.api.services.watchlist_sync import files as watchlist_files
from apps.api.services.watchlist_sync import service as watchlist_service
from apps.api.services.watchlist_sync import store as watchlist_store


class PC:
    def __init__(self, tmp_path, name, monkeypatch):
        self.name = name
        self.db = tmp_path / f"{name}.db"
        self.monkeypatch = monkeypatch
        self.use()
        db_service.init_db()

    def use(self):
        self.monkeypatch.setattr(db_service, "_DB_PATH", self.db)
        self.monkeypatch.setattr(watchlist_store, "host_name", lambda: self.name)
        return self

    def sync(self):
        self.use()
        service.run_records_sync("test")
        return self

    def pc_id(self):
        self.use()
        with get_db() as conn:
            return watchlist_store.get_or_create_pc_id(conn)

    def local_state(self):
        self.use()
        with get_db() as conn:
            return store.read_local_state(conn)

    def tombstones(self):
        self.use()
        with get_db() as conn:
            return {
                (r["kind"], r["uid"]): (r["removed_at"], r["removed_by"])
                for r in conn.execute(
                    "SELECT kind, uid, removed_at, removed_by FROM record_sync WHERE removed_at IS NOT NULL"
                )
            }

    def _stamp_new(self, conn, kind, local_id, pc_id):
        store.backfill_uids(conn)
        uid = store.uid_of(conn, kind, local_id)
        store.stamp(conn, kind, uid, pc_id)
        return uid

    # -- valuation_case --------------------------------------------------

    def add_case(self, case_name, ticker="AAPL"):
        self.use()
        with get_db() as conn:
            pc_id = watchlist_store.get_or_create_pc_id(conn)
            case_cursor = conn.execute(
                "INSERT INTO valuation_case (case_name, ticker, as_of_date, base_year, target_year, "
                "riskfree_rate, wacc_initial, wacc_stable, wacc_converge_from, marginal_tax_rate, "
                "nol_balance, roic_stable, terminal_growth, effective_tax_rate, cash, debt, "
                "ipo_proceeds, shares_basic, shares_new) VALUES (?, ?, '2026-01-01', 2026, 2031, "
                "0.03, 0.09, 0.08, 5, 0.21, 0.0, 0.12, 0.02, 0.18, 1.0, 0.0, 0.0, 10.0, 0.0)",
                (case_name, ticker),
            )
            case_id = case_cursor.lastrowid
            segment_cursor = conn.execute(
                "INSERT INTO segment (case_id, name, base_revenue, base_margin, tam_target, "
                "market_share_target, revenue_target, margin_target, sales_to_capital_early, "
                "sales_to_capital_late, ramp_start_year, initial_growth, waypoint_gap_fraction) "
                "VALUES (?, 'core', 100.0, 0.2, NULL, NULL, 200.0, 0.25, 2.0, 2.5, 1, 0.2, 0.5)",
                (case_id,),
            )
            segment_id = segment_cursor.lastrowid
            conn.execute(
                "INSERT INTO segment_narrative (segment_id, input_field, claim, evidence_source, "
                "confidence, three_p) VALUES (?, 'revenue_target', 'claim text', NULL, 'assumed', 'plausible')",
                (segment_id,),
            )
            self._stamp_new(conn, "valuation_case", case_id, pc_id)
        return self.sync()

    def cases(self):
        self.use()
        with get_db() as conn:
            return {r["case_name"]: dict(r) for r in conn.execute("SELECT * FROM valuation_case")}

    # -- investment_decision ----------------------------------------------

    def add_decision(self, ticker, action="buy", memo="test memo"):
        self.use()
        with get_db() as conn:
            pc_id = watchlist_store.get_or_create_pc_id(conn)
            cursor = conn.execute(
                "INSERT INTO investment_decision (ticker, decided_at, action, memo, figures_source) "
                "VALUES (?, '2026-01-01T00:00:00.000Z', ?, ?, 'live')",
                (ticker, action, memo),
            )
            self._stamp_new(conn, "investment_decision", cursor.lastrowid, pc_id)
        return self.sync()

    def decisions(self):
        self.use()
        with get_db() as conn:
            return {r["sync_uid"]: dict(r) for r in conn.execute("SELECT * FROM investment_decision")}

    # -- user_event ---------------------------------------------------------

    def add_event(self, label, category="fomc", start_date="2026-01-01"):
        self.use()
        with get_db() as conn:
            pc_id = watchlist_store.get_or_create_pc_id(conn)
            cursor = conn.execute(
                "INSERT INTO user_event (label, category, start_date) VALUES (?, ?, ?)",
                (label, category, start_date),
            )
            self._stamp_new(conn, "user_event", cursor.lastrowid, pc_id)
        return self.sync()

    def delete_event(self, uid):
        self.use()
        with get_db() as conn:
            pc_id = watchlist_store.get_or_create_pc_id(conn)
            store.record_removal(conn, "user_event", uid, pc_id)
            conn.execute("DELETE FROM user_event WHERE sync_uid = ?", (uid,))
        return self.sync()

    def events(self):
        self.use()
        with get_db() as conn:
            return {r["label"]: dict(r) for r in conn.execute("SELECT * FROM user_event")}

    # -- event_category -----------------------------------------------------

    def add_category(self, category_id, kind="user", label="Cat", color="#fff"):
        self.use()
        with get_db() as conn:
            pc_id = watchlist_store.get_or_create_pc_id(conn)
            conn.execute(
                "INSERT INTO event_category (id, kind, label, color) VALUES (?, ?, ?, ?)",
                (category_id, kind, label, color),
            )
            store.stamp(conn, "event_category", category_id, pc_id)
        return self.sync()

    def categories(self):
        self.use()
        with get_db() as conn:
            return {r["id"]: dict(r) for r in conn.execute("SELECT * FROM event_category")}

    # -- event_category_visibility --------------------------------------------

    def add_visibility(self, category_id, visible=1):
        self.use()
        with get_db() as conn:
            pc_id = watchlist_store.get_or_create_pc_id(conn)
            conn.execute(
                "INSERT INTO event_category_visibility (category_id, visible) VALUES (?, ?)",
                (category_id, visible),
            )
            store.stamp(conn, "event_category_visibility", category_id, pc_id)
        return self.sync()

    def visibilities(self):
        self.use()
        with get_db() as conn:
            return {
                r["category_id"]: dict(r)
                for r in conn.execute("SELECT * FROM event_category_visibility")
            }

    # -- portfolio_preferences (singleton) -------------------------------------

    def set_preferences(self, amount):
        self.use()
        with get_db() as conn:
            pc_id = watchlist_store.get_or_create_pc_id(conn)
            conn.execute(
                "UPDATE portfolio_preferences SET total_investment_amount = ? WHERE singleton_id = 1",
                (amount,),
            )
            uid = store.uid_of(conn, "portfolio_preferences", 1)
            store.stamp(conn, "portfolio_preferences", uid, pc_id)
        return self.sync()

    def preferences(self):
        self.use()
        with get_db() as conn:
            return dict(conn.execute("SELECT * FROM portfolio_preferences WHERE singleton_id = 1").fetchone())


@pytest.fixture
def cloud(tmp_path, monkeypatch):
    root = tmp_path / "cloud"
    root.mkdir()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(root))
    return root


def test_a_case_created_on_one_pc_appears_on_the_other_with_segments_and_narratives(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.add_case("Growth Case")
    b.sync()

    assert "Growth Case" in b.cases()
    b.use()
    with get_db() as conn:
        case_id = conn.execute(
            "SELECT id FROM valuation_case WHERE case_name = 'Growth Case'"
        ).fetchone()["id"]
        segments = conn.execute("SELECT * FROM segment WHERE case_id = ?", (case_id,)).fetchall()
        assert len(segments) == 1
        narratives = conn.execute(
            "SELECT * FROM segment_narrative WHERE segment_id = ?", (segments[0]["id"],)
        ).fetchall()
        assert len(narratives) == 1


def test_a_deletion_propagates(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add_event("NVDA-EVENT")
    b.sync()
    uid = b.events()["NVDA-EVENT"]["sync_uid"]
    b.delete_event(uid)
    a.sync()
    assert "NVDA-EVENT" not in a.events()


def test_imported_tombstones_are_republished_to_a_third_pc(tmp_path, monkeypatch, cloud):
    a, b, c = (PC(tmp_path, n, monkeypatch) for n in ("PC-A", "PC-B", "PC-C"))
    a.add_event("NVDA-EVENT")
    b.sync(); c.sync()
    uid = b.events()["NVDA-EVENT"]["sync_uid"]
    b.delete_event(uid)
    a.sync()
    b_id = b.pc_id()
    files.own_file_path(cloud, b_id).unlink()
    c.sync()
    assert "NVDA-EVENT" not in c.events()


def test_both_pcs_converge_on_identical_state(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.add_event("AAA")
    b.sync()
    uid = b.events()["AAA"]["sync_uid"]
    b.add_event("BBB")
    a.sync()
    b.delete_event(uid)
    a.add_event("CCC")
    for _ in range(2):
        a.sync(); b.sync()
    assert a.local_state() == b.local_state()
    assert a.tombstones() == b.tombstones()


def test_first_sync_is_a_union_and_invents_no_deletions(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    for pc, label in ((a, "ONLY-A"), (b, "ONLY-B")):
        pc.use()
        with get_db() as conn:
            conn.execute(
                "INSERT INTO user_event (label, category, start_date) VALUES (?, 'fomc', '2026-01-01')",
                (label,),
            )
    a.sync(); b.sync(); a.sync()

    assert {"ONLY-A", "ONLY-B"} <= set(a.events()) and {"ONLY-A", "ONLY-B"} <= set(b.events())
    a_uid = a.events()["ONLY-A"]["sync_uid"]
    assert a_uid is not None, "backfill_uids must assign a uid before the record can be published"
    with get_db() as conn:
        row = conn.execute(
            "SELECT updated_at FROM record_sync WHERE kind = 'user_event' AND uid = ?", (a_uid,)
        ).fetchone()
    assert row["updated_at"] == BASELINE_TS
    assert a.tombstones() == {} and b.tombstones() == {}


def test_an_unreadable_peer_file_is_reported_not_read_as_empty(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch)
    a.add_event("Keep")
    before = a.events()
    (cloud / "MoneyView").mkdir(exist_ok=True)
    bad = cloud / "MoneyView" / "records.PC-BROKEN-0000.json"
    bad.write_text("{", encoding="utf-8")

    a.sync()

    assert a.events() == before
    assert [s.name for s in service.current_status().skipped_files] == [bad.name]

    bad.unlink()
    a.sync()
    assert service.current_status().skipped_files == [], "only the last attempt's skips are reported"


def test_a_missing_folder_is_recorded_and_changes_nothing(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch)
    a.add_event("Keep")
    before = a.events()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "gone"))

    a.sync()

    assert a.events() == before
    assert "does not exist" in service.current_status().last_error


def test_a_failed_publish_keeps_the_local_change_and_retries(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch).sync()

    def refuse(*args, **kwargs):
        raise PermissionError("simulated publish failure")

    monkeypatch.setattr(service, "write_own_file", refuse)
    a.add_event("NVDA-EVENT")
    assert "NVDA-EVENT" in a.events()
    assert "simulated publish failure" in service.current_status().last_error

    # Restore just this patch: monkeypatch.undo() would also undo conftest's autouse guards.
    monkeypatch.setattr(service, "write_own_file", files.write_own_file)
    a.sync()
    pc_id = a.pc_id()
    published = json.loads(files.own_file_path(cloud, pc_id).read_text(encoding="utf-8"))
    labels = {
        r["payload"]["label"] for r in published["records"] if r["kind"] == "user_event"
    }
    assert "NVDA-EVENT" in labels
    assert service.current_status().last_error is None


def test_sync_off_does_nothing(tmp_path, monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    a = PC(tmp_path, "PC-A", monkeypatch)
    with get_db() as conn:
        conn.execute(
            "INSERT INTO user_event (label, category, start_date) VALUES ('UNSTAMPED', 'fomc', '2026-01-01')"
        )

    service.run_records_sync("test")

    assert service.current_status().enabled is False
    assert not (tmp_path / "MoneyView").exists()
    with get_db() as conn:
        marker = conn.execute("SELECT 1 FROM record_sync").fetchone()
        row = conn.execute("SELECT sync_uid FROM user_event WHERE label = 'UNSTAMPED'").fetchone()
    assert marker is None
    assert row["sync_uid"] is None


def test_a_records_sync_failure_does_not_stop_watchlist_sync(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch)
    a.use()

    def boom(trigger):
        raise RuntimeError("records boom")

    real_run_records_sync = service.run_records_sync
    monkeypatch.setattr(service, "run_records_sync", boom)
    watchlist_service.run_sync("test")
    monkeypatch.setattr(service, "run_records_sync", real_run_records_sync)

    assert watchlist_service.current_status().last_error is None
    assert watchlist_service.current_status().last_sync_at is not None
    pc_id = a.pc_id()
    assert watchlist_files.own_file_path(cloud, pc_id).exists()


def test_a_watchlist_sync_failure_does_not_stop_records_sync(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch)
    a.use()

    def boom(trigger, seed_json=None):
        raise RuntimeError("watchlist boom")

    real_run_sync = watchlist_service.run_sync
    monkeypatch.setattr(watchlist_service, "run_sync", boom)
    service.run_records_sync("test")
    monkeypatch.setattr(watchlist_service, "run_sync", real_run_sync)

    assert service.current_status().last_error is None
    assert service.current_status().last_sync_at is not None
    pc_id = a.pc_id()
    assert files.own_file_path(cloud, pc_id).exists()


def test_a_concurrent_local_write_is_not_silently_lost_during_records_sync(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch).sync()
    a.use()
    with get_db() as conn:
        pc_id = watchlist_store.get_or_create_pc_id(conn)

    real_merge = service.merge_record_states
    blocked = {"value": False}

    def racing_merge(states):
        try:
            race_conn = sqlite3.connect(str(db_service._DB_PATH), timeout=0.2)
            try:
                race_conn.execute(
                    "INSERT INTO user_event (label, category, start_date, sync_uid) VALUES "
                    "('RACE', 'fomc', '2026-01-01', 'race-uid')"
                )
                store.stamp(race_conn, "user_event", "race-uid", pc_id)
                race_conn.commit()
            finally:
                race_conn.close()
        except sqlite3.OperationalError as error:
            if "database is locked" not in str(error):
                raise
            blocked["value"] = True
        return real_merge(states)

    monkeypatch.setattr(service, "merge_record_states", racing_merge)
    a.sync()
    monkeypatch.setattr(service, "merge_record_states", real_merge)

    assert blocked["value"], "the concurrent writer must be held off by BEGIN IMMEDIATE, not merely lucky"

    with get_db() as conn:
        conn.execute(
            "INSERT INTO user_event (label, category, start_date, sync_uid) VALUES "
            "('RACE', 'fomc', '2026-01-01', 'race-uid')"
        )
        store.stamp(conn, "user_event", "race-uid", pc_id)
    assert "RACE" in a.events()


def test_a_category_created_while_peer_files_are_being_read_is_not_lost(tmp_path, monkeypatch, cloud):
    """A category has its uid the instant it is inserted (its own id -- event_category does not
    generate one), and nothing stamps it until the sync that follows. If backfill_uids and
    ensure_first_sync ran in an earlier transaction than read_local_state/apply_state, a category
    created in the gap -- while read_peer_files does its (unlocked) cloud-folder I/O -- would have
    a uid and no record_sync row: invisible to read_local_state, and deleted by apply_state as
    absent from the merged state."""
    a = PC(tmp_path, "PC-A", monkeypatch)
    a.use()

    real_read_peer_files = service.read_peer_files

    def racing_read_peer_files(root, own_pc_id):
        with get_db() as conn:
            events_store.insert_user_category(conn, "cat-race", "Race Cat", "#000")
        return real_read_peer_files(root, own_pc_id)

    monkeypatch.setattr(service, "read_peer_files", racing_read_peer_files)
    service.run_records_sync("test")
    monkeypatch.setattr(service, "read_peer_files", real_read_peer_files)

    assert "cat-race" in a.categories()


def test_a_decision_round_trips(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.add_decision("AAPL")
    b.sync()
    assert "AAPL" in {row["ticker"] for row in b.decisions().values()}


def test_a_user_event_round_trips(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.add_event("FOMC Meeting")
    b.sync()
    assert "FOMC Meeting" in b.events()


def test_a_category_round_trips(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.add_category("cat-x", label="Cat X")
    b.sync()
    assert "cat-x" in b.categories()
    assert b.categories()["cat-x"]["label"] == "Cat X"


def test_a_visibility_round_trips(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.add_visibility("cat-y", visible=0)
    b.sync()
    assert "cat-y" in b.visibilities()
    assert b.visibilities()["cat-y"]["visible"] == 0


def test_a_preferences_round_trips(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.set_preferences(12345.0)
    b.sync()
    assert b.preferences()["total_investment_amount"] == 12345.0


def test_an_unsaved_default_preferences_row_never_outranks_a_real_saved_value(tmp_path, monkeypatch, cloud):
    """A saved a real amount before peer sync ever ran on it, so its own updated_at column is
    non-empty and record_sync stamps it BASELINE_TS on first sync -- same as any other kind. B
    never touched preferences: its row is still init_db's never-saved default, own updated_at ''.
    If ensure_first_sync stamped that default BASELINE_TS too, both would tie at (BASELINE_TS,
    higher pc_id) and B's meaningless default could win the pc_id tiebreak over A's real setting.
    Stamping the never-saved default at SEED_TS (below BASELINE_TS) keeps it from ever winning."""
    a = PC(tmp_path, "PC-A", monkeypatch)
    b = PC(tmp_path, "PC-B", monkeypatch)
    a.use()
    with get_db() as conn:
        conn.execute(
            "UPDATE portfolio_preferences SET total_investment_amount = 50000.0, "
            "updated_at = '2020-01-01T00:00:00.000Z' WHERE singleton_id = 1"
        )

    a_id, b_id = a.pc_id(), b.pc_id()
    assert b_id > a_id, "precondition: B's pc_id must sort higher than A's for the bug to bite"

    for _ in range(2):
        a.sync(); b.sync()

    assert a.preferences()["total_investment_amount"] == 50000.0
    assert b.preferences()["total_investment_amount"] == 50000.0


def test_ensure_first_sync_runs_before_read_local_state_on_every_run(tmp_path, monkeypatch, cloud):
    """Controller requirement carried from the Task 5 review: `run_records_sync` must call
    `store.ensure_first_sync` BEFORE `store.read_local_state` on EVERY run. A raw-SQL row that
    already has a sync_uid but no record_sync row must still be baseline-stamped and kept, not
    silently deleted by `apply_state` because `read_local_state` never saw it."""
    a = PC(tmp_path, "PC-A", monkeypatch).sync()
    a.use()
    with get_db() as conn:
        pc_id = watchlist_store.get_or_create_pc_id(conn)
        conn.execute(
            "INSERT INTO user_event (label, category, start_date, sync_uid) VALUES "
            "('RAW', 'fomc', '2026-01-01', 'raw-uid')"
        )

    a.sync()

    assert "RAW" in a.events()
    with get_db() as conn:
        row = conn.execute(
            "SELECT updated_at, updated_by FROM record_sync WHERE kind = 'user_event' AND uid = 'raw-uid'"
        ).fetchone()
    assert row["updated_at"] == BASELINE_TS
    assert row["updated_by"] == pc_id
    assert service.current_status().last_error is None
