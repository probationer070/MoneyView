import sqlite3
from datetime import date

import pytest

from apps.api.services import db as db_service
from apps.api.services.db import get_db
from apps.api.services.signals import store
from apps.api.services.signals.store import ResultRow
from packages.core_finance.macro_signals.rules import Observation


def row(rule_id="b_hy_wide", state="near"):
    return ResultRow(rule_id, state, 3.3, "2026-10-09", 3.5, "n", {"a": -0.01, "b": 0.0, "c": 0.01})


def save(week, probs=(0.3, 0.5, 0.2), results=(row(),), run_at="2026-10-10T00:00:00+00:00"):
    store.save_snapshot(iso_week=week, run_at=run_at, rules_version="v1",
                        probs=dict(zip("abc", probs)), results=list(results))


def test_iso_week_format():
    assert store.iso_week(date(2026, 10, 10)) == "2026-W41"
    assert store.iso_week(date(2027, 1, 1)) == "2026-W53"


def test_same_week_overwrites_instead_of_adding_a_row():
    save("2026-W41", results=[row("a"), row("b")])
    save("2026-W41", probs=(0.2, 0.6, 0.2), results=[row("c")])
    with get_db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM signal_snapshots").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM signal_results").fetchone()[0] == 1
    snap = store.load_snapshot("2026-W41")
    assert snap.probs == {"a": 0.2, "b": 0.6, "c": 0.2}
    assert [r.rule_id for r in snap.results] == ["c"]
    assert snap.results[0].contribution == {"a": -0.01, "b": 0.0, "c": 0.01}


def test_history_is_oldest_first_and_limited():
    for w in ("2026-W39", "2026-W40", "2026-W41"):
        save(w)
    assert [h.iso_week for h in store.history(2)] == ["2026-W40", "2026-W41"]
    assert store.previous_snapshot("2026-W41").iso_week == "2026-W40"
    assert store.latest_snapshot().iso_week == "2026-W41"


def test_manual_inputs_are_per_week_and_overwrite():
    store.put_manual_input("m_breadth", "2026-W41", "near", "x", "t1")
    store.put_manual_input("m_breadth", "2026-W41", "triggered", "y", "t2")
    assert store.get_manual_inputs("2026-W41")["m_breadth"].state == "triggered"
    assert store.get_manual_inputs("2026-W42") == {}


def test_iso_week_pads_single_digit_weeks():
    assert store.iso_week(date(2026, 2, 2)) == "2026-W06"


def test_empty_database_reads_return_none_and_empty():
    assert store.latest_snapshot() is None
    assert store.load_snapshot("2026-W41") is None
    assert store.previous_snapshot("2026-W41") is None
    assert store.history(5) == []


def test_results_come_back_in_the_order_they_were_saved():
    save("2026-W41", results=[row("b_hy_wide"), row("a_tnx_relief")])
    assert [r.rule_id for r in store.load_snapshot("2026-W41").results] == ["b_hy_wide", "a_tnx_relief"]


def test_a_result_saved_without_contribution_loads_as_none():
    save("2026-W41", results=[ResultRow("m_breadth", "triggered", None, None, None, "", None)])
    assert store.load_snapshot("2026-W41").results[0].contribution is None


def test_cache_rewrite_replaces_the_stored_value():
    store.save_cache("PAYEMS", [Observation(date(2026, 9, 1), 1.0)], "t1")
    store.save_cache("PAYEMS", [Observation(date(2026, 9, 1), 2.0)], "t2")
    assert store.load_cache("PAYEMS", date(2026, 1, 1)) == [Observation(date(2026, 9, 1), 2.0)]


def test_cache_load_starts_at_the_requested_date():
    store.save_cache("PAYEMS", [Observation(date(2025, 12, 1), 1.0), Observation(date(2026, 1, 1), 2.0)], "t1")
    assert store.load_cache("PAYEMS", date(2026, 1, 1)) == [Observation(date(2026, 1, 1), 2.0)]


def test_signal_tables_come_from_the_create_script():
    conn = sqlite3.connect(":memory:")
    conn.executescript(db_service._CREATE_SCHEMA_SQL)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    conn.close()
    assert {"signal_snapshots", "signal_results", "signal_manual_inputs", "fred_cache"} <= names


def test_compatibility_path_recreates_missing_signal_tables():
    with get_db() as conn:
        for table in ("signal_results", "signal_manual_inputs", "signal_snapshots", "fred_cache"):
            conn.execute(f"DROP TABLE {table}")
        db_service._ensure_schema_compatibility(conn)
        names = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"signal_snapshots", "signal_results", "signal_manual_inputs", "fred_cache"} <= names


def test_database_rejects_states_outside_the_allowed_set():
    with pytest.raises(sqlite3.IntegrityError):
        store.put_manual_input("m_breadth", "2026-W41", "stale", "", "t1")
    with pytest.raises(sqlite3.IntegrityError):
        save("2026-W41", results=[row(state="bogus")])


def test_a_failed_rerun_leaves_the_previous_snapshot_intact():
    save("2026-W41", results=[row("a"), row("b")], run_at="t1")
    before = store.load_snapshot("2026-W41")
    with pytest.raises(sqlite3.IntegrityError):
        save("2026-W41", probs=(0.2, 0.6, 0.2), results=[row("c", state="bogus")], run_at="t2")
    assert store.load_snapshot("2026-W41") == before
