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


def test_an_old_database_gains_a_complete_schema(tmp_path, monkeypatch):
    """A legacy user_event without sync_uid must not make executescript abort partway and
    silently skip every CREATE TABLE statement after it -- record_sync, event_category and
    event_category_visibility all come later in the script than user_event."""
    path = tmp_path / "old_complete.db"
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
        tables = {
            row["name"]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        row = conn.execute("SELECT label, sync_uid FROM user_event").fetchone()
    assert {"record_sync", "event_category", "event_category_visibility"} <= tables
    assert (row["label"], row["sync_uid"]) == ("kept", None)


def test_each_synced_table_has_a_unique_index_on_sync_uid_alone():
    with get_db() as conn:
        for table in UID_TABLES:
            indexes = conn.execute(f"PRAGMA index_list({table})").fetchall()
            matching = [
                index
                for index in indexes
                if index["unique"]
                and [r["name"] for r in conn.execute(f"PRAGMA index_info({index['name']})")] == ["sync_uid"]
            ]
            assert matching, f"{table} has no unique index on sync_uid alone: {indexes}"


from apps.api.services.peer_sync.model import BASELINE_TS
from apps.api.services.records_sync import store
from apps.api.services.records_sync.merge import Record, RecordState, RecordTombstone

PC = "PC-ME-00ff"
TS = "2026-09-20T10:00:00.000Z"


def _case_payload(name="Case", segments=("core",)):
    return {
        "case": {"case_name": name, "ticker": "AAPL", "as_of_date": "2026-01-01", "base_year": 2026,
                 "target_year": 2031, "riskfree_rate": 0.03, "wacc_initial": 0.09,
                 "wacc_stable": 0.08, "wacc_converge_from": 5, "marginal_tax_rate": 0.21,
                 "nol_balance": 0.0, "roic_stable": 0.12, "terminal_growth": 0.02,
                 "effective_tax_rate": 0.18, "cash": 1.0, "debt": 0.0, "ipo_proceeds": 0.0,
                 "shares_basic": 10.0, "shares_new": 0.0, "parent_uid": None},
        "segments": [{"name": s, "base_revenue": 100.0, "base_margin": 0.2, "tam_target": None,
                      "market_share_target": None, "revenue_target": 200.0, "margin_target": 0.25,
                      "sales_to_capital_early": 2.0, "sales_to_capital_late": 2.5,
                      "ramp_start_year": 1, "initial_growth": 0.2, "waypoint_gap_fraction": 0.5,
                      "narratives": [{"input_field": "revenue_target", "claim": f"why {s}",
                                      "evidence_source": None, "confidence": "assumed",
                                      "three_p": "plausible"}]}
                     for s in segments],
    }


def _insert_local_case(conn, name="Local"):
    # Every NOT NULL column that has no default: case_name, as_of_date, base_year, target_year,
    # riskfree_rate, wacc_initial, wacc_stable, marginal_tax_rate, roic_stable, shares_basic.
    cursor = conn.execute("INSERT INTO valuation_case (case_name, as_of_date, base_year, target_year, "
                          "riskfree_rate, wacc_initial, wacc_stable, wacc_converge_from, "
                          "marginal_tax_rate, roic_stable, terminal_growth, shares_basic) "
                          "VALUES (?, '2026-01-01', 2026, 2031, 0.03, 0.09, 0.08, 5, 0.21, 0.12, 0.02, 10.0)",
                          (name,))
    return int(cursor.lastrowid)


def test_backfill_gives_every_row_a_uid_once(tmp_path):
    with get_db() as conn:
        _insert_local_case(conn, "One")
        _insert_local_case(conn, "Two")
        assert store.backfill_uids(conn) == 2
        uids = [r["sync_uid"] for r in conn.execute("SELECT sync_uid FROM valuation_case ORDER BY id")]
        assert all(uids) and len(set(uids)) == 2
        assert store.backfill_uids(conn) == 0, "a second run must not re-issue uids"
        again = [r["sync_uid"] for r in conn.execute("SELECT sync_uid FROM valuation_case ORDER BY id")]
        assert again == uids


def test_first_sync_stamps_unstamped_records_with_the_baseline():
    with get_db() as conn:
        _insert_local_case(conn, "One")
        store.backfill_uids(conn)
        store.ensure_first_sync(conn, PC)
        row = conn.execute("SELECT updated_at, updated_by FROM record_sync WHERE kind = 'valuation_case'").fetchone()
    assert (row["updated_at"], row["updated_by"]) == (BASELINE_TS, PC)


def test_read_local_state_builds_the_whole_case_tree():
    with get_db() as conn:
        case_id = _insert_local_case(conn, "Tree")
        segment = conn.execute("INSERT INTO segment (case_id, name, base_revenue, base_margin, margin_target, "
                               "sales_to_capital_early, sales_to_capital_late, ramp_start_year, "
                               "initial_growth, waypoint_gap_fraction) "
                               "VALUES (?, 'core', 100.0, 0.2, 0.25, 2.0, 2.5, 1, 0.2, 0.5)", (case_id,))
        conn.execute("INSERT INTO segment_narrative (segment_id, input_field, claim, confidence, three_p) "
                     "VALUES (?, 'revenue_target', 'why', 'assumed', 'plausible')", (int(segment.lastrowid),))
        store.backfill_uids(conn)
        store.ensure_first_sync(conn, PC)
        state = store.read_local_state(conn)

    [record] = [r for r in state.records.values() if r.kind == "valuation_case"]
    assert record.payload["case"]["case_name"] == "Tree"
    assert [s["name"] for s in record.payload["segments"]] == ["core"]
    assert record.payload["segments"][0]["narratives"][0]["claim"] == "why"
    assert "id" not in record.payload["case"] and "case_id" not in record.payload["segments"][0]


def test_apply_state_inserts_a_peer_case_with_local_ids_and_no_orphans():
    incoming = Record("valuation_case", "peer-uid", TS, "PC-B-0002", _case_payload("Peer", ("a", "b")))
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={("valuation_case", "peer-uid"): incoming}))
        case = conn.execute("SELECT id, case_name, sync_uid FROM valuation_case").fetchone()
        segments = conn.execute("SELECT id, case_id, name FROM segment ORDER BY name").fetchall()
        narratives = conn.execute("SELECT segment_id FROM segment_narrative").fetchall()

    assert (case["case_name"], case["sync_uid"]) == ("Peer", "peer-uid")
    assert [s["name"] for s in segments] == ["a", "b"]
    assert {s["case_id"] for s in segments} == {case["id"]}
    assert {n["segment_id"] for n in narratives} == {s["id"] for s in segments}


def test_apply_state_replaces_the_whole_tree_dropping_a_removed_segment():
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", TS, "PC-B-0002", _case_payload("C", ("a", "b")))}))
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", "2026-09-20T10:05:00.000Z", "PC-B-0002",
                                            _case_payload("C", ("a",)))}))
        names = [r["name"] for r in conn.execute("SELECT name FROM segment")]
        assert names == ["a"]
        assert conn.execute("SELECT COUNT(*) FROM segment_narrative").fetchone()[0] == 1


def test_an_updated_case_keeps_its_local_id():
    # A local fork's parent_case_id points at this id; a delete-and-reinsert would give the case a
    # new one (AUTOINCREMENT never reuses it) and break every fork of it.
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", TS, "PC-B-0002", _case_payload("C", ("a", "b")))}))
        before = conn.execute("SELECT id FROM valuation_case WHERE sync_uid = 'u'").fetchone()["id"]
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", "2026-09-20T10:05:00.000Z", "PC-B-0002",
                                            _case_payload("C renamed", ("a",)))}))
        after = conn.execute("SELECT id, case_name FROM valuation_case WHERE sync_uid = 'u'").fetchone()

    assert after["case_name"] == "C renamed", "precondition: the case really was rewritten"
    assert after["id"] == before


def test_deleting_a_parent_case_leaves_its_local_fork_without_a_parent():
    # A peer tombstone can remove a case that a local fork points at. parent_case_id has no
    # ON DELETE clause, so the delete must unlink the fork first or the whole apply rolls back.
    fork = _case_payload("Fork")
    fork["case"]["parent_uid"] = "p"
    fork_record = Record("valuation_case", "f", TS, "PC-B-0002", fork)
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "p"): Record("valuation_case", "p", TS, "PC-B-0002", _case_payload("Parent")),
            ("valuation_case", "f"): fork_record}))
        parent_id = conn.execute("SELECT id FROM valuation_case WHERE sync_uid = 'p'").fetchone()["id"]
        assert conn.execute("SELECT parent_case_id FROM valuation_case WHERE sync_uid = 'f'").fetchone()[0] == parent_id

        store.apply_state(conn, RecordState(
            records={("valuation_case", "f"): fork_record},
            removed={("valuation_case", "p"): RecordTombstone("valuation_case", "p", "2026-09-20T11:00:00.000Z", "PC-B-0002")}))
        rows = {r["sync_uid"]: r["parent_case_id"] for r in conn.execute("SELECT sync_uid, parent_case_id FROM valuation_case")}

    assert rows == {"f": None}


def test_apply_state_deletes_a_record_absent_from_the_merged_state():
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", TS, "PC-B-0002", _case_payload("Gone"))}))
        store.apply_state(conn, RecordState(
            removed={("valuation_case", "u"): RecordTombstone("valuation_case", "u", "2026-09-20T11:00:00.000Z", "PC-B-0002")}))
        assert conn.execute("SELECT COUNT(*) FROM valuation_case").fetchone()[0] == 0
        tomb = conn.execute("SELECT removed_at FROM record_sync WHERE uid = 'u'").fetchone()
    assert tomb["removed_at"] == "2026-09-20T11:00:00.000Z"


def test_an_unchanged_record_is_not_rewritten():
    record = Record("valuation_case", "u", TS, "PC-B-0002", _case_payload("Same"))
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={("valuation_case", "u"): record}))
        before = conn.execute("SELECT id FROM valuation_case").fetchone()["id"]
        store.apply_state(conn, RecordState(records={("valuation_case", "u"): record}))
        after = conn.execute("SELECT id FROM valuation_case").fetchone()["id"]
    assert after == before, "re-applying an identical record must not delete and re-insert it"


def test_a_name_clash_between_two_uids_renames_the_older_and_reports_it():
    older = Record("valuation_case", "old-uid", TS, "PC-A-0001", _case_payload("Shared"))
    newer = Record("valuation_case", "new-uid", "2026-09-20T10:05:00.000Z", "PC-B-0002", _case_payload("Shared"))
    with get_db() as conn:
        renamed = store.apply_state(conn, RecordState(records={
            ("valuation_case", "old-uid"): older, ("valuation_case", "new-uid"): newer}))
        rows = {r["sync_uid"]: r["case_name"] for r in conn.execute("SELECT sync_uid, case_name FROM valuation_case")}
        stamps = {r["uid"]: r["updated_at"] for r in conn.execute("SELECT uid, updated_at FROM record_sync")}

    assert rows["new-uid"] == "Shared"
    assert rows["old-uid"].startswith("Shared (from ")
    assert renamed and "Shared" in renamed[0]
    assert stamps["old-uid"] == TS, "a local repair must not restamp the record as a new authored change"


def test_stamp_and_record_removal_use_this_pc_and_outrank_what_they_replace():
    with get_db() as conn:
        store.stamp(conn, "user_event", "u1", PC)
        first = conn.execute("SELECT updated_at FROM record_sync WHERE uid = 'u1'").fetchone()["updated_at"]
        conn.execute("UPDATE record_sync SET updated_at = '2099-01-01T00:00:00.000Z' WHERE uid = 'u1'")
        store.stamp(conn, "user_event", "u1", PC)
        second = conn.execute("SELECT updated_at FROM record_sync WHERE uid = 'u1'").fetchone()["updated_at"]
        store.record_removal(conn, "user_event", "u1", PC)
        row = conn.execute("SELECT removed_at, removed_by FROM record_sync WHERE uid = 'u1'").fetchone()

    assert first > BASELINE_TS
    assert second > "2099-01-01T00:00:00.000Z", "a local edit must outrank a peer stamp from an ahead clock"
    assert row["removed_at"] > second and row["removed_by"] == PC


def _event_payload(label="Event"):
    return {"label": label, "category": "fomc", "start_date": "2026-01-01", "end_date": None,
            "source": None, "note": "", "created_at": "2026-01-01T00:00:00.000Z"}


def test_apply_state_keeps_a_record_and_its_older_tombstone_side_by_side():
    # A merge can legitimately return both: an add newer than its own tombstone keeps the
    # record present, but every tombstone is kept regardless (spec S5), including one a newer
    # add has made ineffective. Both halves of record_sync must survive the apply.
    record = Record("user_event", "u1", "2026-09-20T12:00:00.000Z", "PC-A-0001", _event_payload("Kept"))
    tomb = RecordTombstone("user_event", "u1", "2026-09-20T11:00:00.000Z", "PC-B-0002")
    with get_db() as conn:
        store.apply_state(conn, RecordState(
            records={("user_event", "u1"): record}, removed={("user_event", "u1"): tomb}))
        sync = conn.execute(
            "SELECT updated_at, updated_by, removed_at, removed_by FROM record_sync WHERE uid = 'u1'"
        ).fetchone()
        exists = conn.execute("SELECT COUNT(*) FROM user_event WHERE sync_uid = 'u1'").fetchone()[0]
        state = store.read_local_state(conn)

    assert (sync["updated_at"], sync["updated_by"]) == ("2026-09-20T12:00:00.000Z", "PC-A-0001")
    assert (sync["removed_at"], sync["removed_by"]) == ("2026-09-20T11:00:00.000Z", "PC-B-0002")
    assert exists == 1, "the record row must still exist locally"
    assert ("user_event", "u1") in state.records, "an add newer than its own tombstone is present"
    assert ("user_event", "u1") in state.removed, "the ineffective tombstone must still be kept"


def test_local_delete_then_re_add_keeps_the_tombstone_and_the_record_outranks_it():
    with get_db() as conn:
        conn.execute("INSERT INTO user_event (label, category, start_date, sync_uid) VALUES "
                     "('E', 'fomc', '2026-01-01', 'u2')")
        store.stamp(conn, "user_event", "u2", PC)
        store.record_removal(conn, "user_event", "u2", PC)
        store.stamp(conn, "user_event", "u2", PC)
        row = conn.execute(
            "SELECT updated_at, removed_at FROM record_sync WHERE uid = 'u2'"
        ).fetchone()
        state = store.read_local_state(conn)

    assert row["removed_at"] is not None, "the tombstone must survive a re-add, to be republished"
    assert row["updated_at"] > row["removed_at"], "the re-add must outrank its own tombstone"
    assert ("user_event", "u2") in state.records, "a re-add that outranks its own tombstone is present"


def test_a_newer_tombstone_still_makes_the_record_absent_from_read_local_state():
    # A row can physically linger locally (e.g. before a delete route gets around to removing
    # it) while record_sync already shows a tombstone newer than the record's own stamp.
    # read_local_state must still report it absent -- presence is decided by record_sync's keys,
    # never by whether a local row happens to exist.
    with get_db() as conn:
        conn.execute("INSERT INTO user_event (label, category, start_date, sync_uid) VALUES "
                     "('E', 'fomc', '2026-01-01', 'u3')")
        store.stamp(conn, "user_event", "u3", PC)
        store.record_removal(conn, "user_event", "u3", PC)
        state = store.read_local_state(conn)

    assert ("user_event", "u3") not in state.records
    assert ("user_event", "u3") in state.removed


def test_apply_state_swaps_case_names_between_two_surviving_uids():
    # local X="Alpha", Y="Beta"; incoming X="Beta", Y="Gamma". No within-batch clash (the two
    # incoming values are distinct), so _resolve_natural_key_clashes renames neither -- but a
    # one-uid-at-a-time delete+insert still depends on order: renaming X to "Beta" first collides
    # with Y's still-present old row. The state is built with X's key first, which is exactly the
    # order that raised IntegrityError under the one-at-a-time apply.
    with get_db() as conn:
        x_id = _insert_local_case(conn, "Alpha")
        y_id = _insert_local_case(conn, "Beta")
        store.backfill_uids(conn)
        x_uid = conn.execute("SELECT sync_uid FROM valuation_case WHERE id = ?", (x_id,)).fetchone()[0]
        y_uid = conn.execute("SELECT sync_uid FROM valuation_case WHERE id = ?", (y_id,)).fetchone()[0]

        store.apply_state(conn, RecordState(records={
            ("valuation_case", x_uid): Record("valuation_case", x_uid, TS, "PC-B-0002", _case_payload("Beta")),
            ("valuation_case", y_uid): Record("valuation_case", y_uid, TS, "PC-B-0002", _case_payload("Gamma")),
        }))
        rows = {r["sync_uid"]: r["case_name"] for r in conn.execute("SELECT sync_uid, case_name FROM valuation_case")}

    assert rows[x_uid] == "Beta"
    assert rows[y_uid] == "Gamma"


def test_uid_of_covers_singleton_generated_and_natural_branches():
    # portfolio_preferences already has its one seeded row (db.py init_db) -- the singleton
    # branch never queries the table anyway, it returns the fixed singleton_uid outright.
    with get_db() as conn:
        conn.execute("INSERT INTO user_event (label, category, start_date, sync_uid) VALUES "
                     "('E', 'fomc', '2026-01-01', 'evt-uid')")
        event_local_id = conn.execute("SELECT id FROM user_event WHERE sync_uid = 'evt-uid'").fetchone()[0]
        conn.execute("INSERT INTO event_category (id, kind, label, color) VALUES ('cat-x', 'user', 'Cat X', '#fff')")

        preferences_uid = store.uid_of(conn, "portfolio_preferences", 1)
        event_uid = store.uid_of(conn, "user_event", event_local_id)
        category_uid = store.uid_of(conn, "event_category", "cat-x")
        missing = store.uid_of(conn, "user_event", 999999)

    assert preferences_uid == "portfolio_preferences"
    assert event_uid == "evt-uid"
    assert category_uid == "cat-x"
    assert missing is None


def test_apply_state_upserts_the_singleton_preferences_row_in_place():
    older = {"total_investment_amount": 5000.0, "transaction_fee_rate": 0.001,
             "updated_at": "2026-01-01T00:00:00.000Z"}
    newer = {"total_investment_amount": 9000.0, "transaction_fee_rate": 0.002,
             "updated_at": "2026-02-01T00:00:00.000Z"}
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("portfolio_preferences", "portfolio_preferences"):
                Record("portfolio_preferences", "portfolio_preferences", TS, "PC-B-0002", older)}))
        first = conn.execute(
            "SELECT total_investment_amount, transaction_fee_rate FROM portfolio_preferences"
        ).fetchone()
        assert (first["total_investment_amount"], first["transaction_fee_rate"]) == (5000.0, 0.001)

        store.apply_state(conn, RecordState(records={
            ("portfolio_preferences", "portfolio_preferences"):
                Record("portfolio_preferences", "portfolio_preferences", "2026-09-20T10:05:00.000Z",
                       "PC-B-0002", newer)}))
        rows = conn.execute(
            "SELECT total_investment_amount, transaction_fee_rate FROM portfolio_preferences"
        ).fetchall()

    assert len(rows) == 1, "the CHECK(singleton_id = 1) row must be updated in place, not duplicated"
    assert (rows[0]["total_investment_amount"], rows[0]["transaction_fee_rate"]) == (9000.0, 0.002)


def _category_payload(category_id, label):
    return {"id": category_id, "kind": "user", "label": label, "color": "#fff",
            "created_at": "2026-01-01T00:00:00.000Z"}


def test_apply_state_inserts_and_deletes_an_event_category_under_its_own_id():
    # Two rows, not one: asserting COUNT(*) == 0 with only ever one row in the table would pass
    # identically for a delete that lost its uid scoping and truncated the whole table.
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("event_category", "cat-x"): Record("event_category", "cat-x", TS, "PC-B-0002",
                                                 _category_payload("cat-x", "Cat X")),
            ("event_category", "cat-y"): Record("event_category", "cat-y", TS, "PC-B-0002",
                                                 _category_payload("cat-y", "Cat Y")),
        }))
        row = conn.execute("SELECT id, label FROM event_category WHERE id = 'cat-x'").fetchone()
        assert row is not None and row["label"] == "Cat X"
        y_rowid_before = conn.execute(
            "SELECT rowid FROM event_category WHERE id = 'cat-y'"
        ).fetchone()[0]

        # cat-y's payload is unchanged from the first call, so a correctly scoped delete leaves
        # its row untouched (rowid stable) -- values alone cannot tell "untouched" apart from
        # "deleted and immediately recreated with the same content", which is why this second
        # call also checks the physical row identity, not just what a SELECT shows afterwards.
        store.apply_state(conn, RecordState(records={
            ("event_category", "cat-y"): Record("event_category", "cat-y", TS, "PC-B-0002",
                                                 _category_payload("cat-y", "Cat Y"))}))
        remaining = conn.execute("SELECT id, label FROM event_category").fetchall()
        y_rowid_after = conn.execute(
            "SELECT rowid FROM event_category WHERE id = 'cat-y'"
        ).fetchone()[0]

    assert [(r["id"], r["label"]) for r in remaining] == [("cat-y", "Cat Y")], \
        "cat-x (absent from the merged state) must be deleted, cat-y must survive untouched"
    assert y_rowid_after == y_rowid_before, \
        "cat-y's own row must never be deleted, even transiently, by a delete scoped to cat-x"


def test_apply_state_inserts_an_event_category_visibility_row_under_category_id():
    payload = {"category_id": "cat-y", "visible": 1}
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("event_category_visibility", "cat-y"):
                Record("event_category_visibility", "cat-y", TS, "PC-B-0002", payload)}))
        row = conn.execute(
            "SELECT category_id, visible FROM event_category_visibility WHERE category_id = 'cat-y'"
        ).fetchone()

    assert row is not None and row["visible"] == 1



# --- F4: case-level narratives are an OPTIONAL child ----------------------------------------

_CASE_CLAIM = {"input_field": "wacc_stable", "claim": "faded to the sector",
               "evidence_source": "damodaran_industry_2026-01-01", "confidence": "derived",
               "three_p": "probable"}


def test_a_case_without_case_narratives_publishes_the_payload_an_older_peer_accepts():
    # An older peer rejects any payload whose keys are not exactly {"case", "segments"}, and
    # skips the whole file. Every case that predates F4 must keep publishing that shape.
    with get_db() as conn:
        _insert_local_case(conn, "Old shape")
        store.backfill_uids(conn)
        store.ensure_first_sync(conn, PC)
        [record] = [r for r in store.read_local_state(conn).records.values()
                    if r.kind == "valuation_case"]
    assert set(record.payload) == {"case", "segments"}


def test_a_peer_case_with_case_narratives_round_trips_and_is_replaced_on_update():
    payload = _case_payload("Narrated")
    payload["narratives"] = [_CASE_CLAIM]
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", TS, "PC-B-0002", payload)}))
        [record] = [r for r in store.read_local_state(conn).records.values()
                    if r.kind == "valuation_case"]
        assert record.payload["narratives"] == [_CASE_CLAIM]

        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", "2026-09-20T10:05:00.000Z",
                                            "PC-B-0002", _case_payload("Narrated"))}))
        assert conn.execute("SELECT COUNT(*) FROM case_narrative").fetchone()[0] == 0
