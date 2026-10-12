import pytest

from apps.api.services.db import get_db
from apps.api.services.signals import engine, store

from .conftest import AS_OF

EXPECTED = {
    "b_tnx_sticky": "triggered", "b_core_cpi_hot": "triggered", "b_hy_wide": "near",
    "b_brent_spike": "not_triggered", "b_fed_hike": "not_triggered", "a_tnx_relief": "not_triggered",
    "a_brent_relief": "not_triggered", "a_labor_core": "near",
}


def states(snapshot):
    return {r.rule_id: r.state for r in snapshot.results}


def test_fixture_run_judges_every_auto_rule(fixture_source):
    outcome = engine.run(AS_OF, source=fixture_source())
    assert states(outcome.snapshot) == EXPECTED
    assert outcome.failures == []
    assert outcome.snapshot.iso_week == "2026-W41"


def test_with_three_manual_inputs_eleven_results_are_stored(fixture_source):
    for rule_id in ("m_capex_reaction", "m_iran_strike", "m_breadth"):
        store.put_manual_input(rule_id, "2026-W41", "near", "", "t")
    engine.run(AS_OF, source=fixture_source())
    with get_db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM signal_snapshots").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM signal_results").fetchone()[0] == 11


def test_without_manual_input_manual_rules_are_left_out(fixture_source):
    snapshot = engine.run(AS_OF, source=fixture_source()).snapshot
    assert len(snapshot.results) == 8
    store.put_manual_input("m_breadth", "2026-W41", "not_triggered", "", "t")
    with_input = engine.run(AS_OF, source=fixture_source()).snapshot
    assert len(with_input.results) == 9
    assert with_input.probs == pytest.approx(snapshot.probs)   # not_triggered has weight 0


def test_rerunning_the_same_week_keeps_one_snapshot(fixture_source):
    engine.run(AS_OF, source=fixture_source())
    engine.run(AS_OF, source=fixture_source())
    with get_db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM signal_snapshots").fetchone()[0] == 1


def test_a_missing_series_stales_only_its_rules(fixture_source):
    outcome = engine.run(AS_OF, source=fixture_source(missing={"DCOILBRENTEU"}))
    got = states(outcome.snapshot)
    assert got["b_brent_spike"] == "stale" and got["a_brent_relief"] == "stale"
    assert {k: v for k, v in got.items() if "brent" not in k} == {
        k: v for k, v in EXPECTED.items() if "brent" not in k}
    assert any("DCOILBRENTEU" in f for f in outcome.failures)


def test_last_weeks_result_is_never_multiplied_in(fixture_source):
    first = engine.run(AS_OF, source=fixture_source()).snapshot
    store.save_snapshot(iso_week="2026-W40", run_at="2026-10-03T00:00:00+00:00", rules_version="x",
                        probs={"a": 0.85, "b": 0.10, "c": 0.05}, results=[])
    again = engine.run(AS_OF, source=fixture_source()).snapshot
    assert again.probs == pytest.approx(first.probs, abs=1e-12)


def test_rescore_applies_a_manual_input_without_fetching(fixture_source):
    before = engine.run(AS_OF, source=fixture_source()).snapshot
    store.put_manual_input("m_iran_strike", "2026-W41", "triggered", "", "t")
    after = engine.rescore("2026-W41")
    assert after.probs["b"] > before.probs["b"]
    assert after.run_at == before.run_at
    assert states(after)["b_tnx_sticky"] == "triggered"


def test_contributions_are_stored_for_active_signals_only(fixture_source):
    snapshot = engine.run(AS_OF, source=fixture_source()).snapshot
    by_id = {r.rule_id: r for r in snapshot.results}
    assert by_id["b_hy_wide"].contribution["c"] > 0
    assert by_id["b_fed_hike"].contribution is None
