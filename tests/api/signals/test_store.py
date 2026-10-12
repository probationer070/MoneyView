from datetime import date

from apps.api.services.db import get_db
from apps.api.services.signals import store
from apps.api.services.signals.store import ResultRow


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
