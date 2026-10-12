from datetime import UTC, date, datetime

import pytest

from apps.api.services.db import get_db
from apps.api.services.signals import engine, store
from apps.api.services.signals.models import get_rules
from packages.core_finance.macro_signals.rules import Evaluation
from packages.core_finance.macro_signals.scenario import ActiveSignal, posterior

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


def test_an_old_latest_observation_stales_its_rule(fixture_source):
    base = fixture_source()

    def source(series_id, start):
        obs = base(series_id, start)
        return [o for o in obs if o.date <= date(2026, 9, 1)] if series_id == "DGS10" else obs

    got = states(engine.run(AS_OF, source=source).snapshot)
    assert got["b_tnx_sticky"] == "stale" and got["a_tnx_relief"] == "stale"


def test_near_counts_half_of_triggered_and_triggered_counts_full(fixture_source):
    loaded = get_rules()
    cfg = loaded.file.scenario
    lr = next(rule.lr.model_dump() for rule in loaded.file.rules if rule.id == "b_hy_wide")
    prior = cfg.prior.model_dump()
    near, _ = engine.score(loaded, {"b_hy_wide": Evaluation("near", None, None, None, "")})
    full, _ = engine.score(loaded, {"b_hy_wide": Evaluation("triggered", None, None, None, "")})
    expected_near = posterior(prior, [ActiveSignal("b_hy_wide", lr, cfg.weights.near)], cfg.floor, cfg.cap)
    expected_full = posterior(prior, [ActiveSignal("b_hy_wide", lr, cfg.weights.triggered)], cfg.floor, cfg.cap)
    assert near == pytest.approx(expected_near) and full == pytest.approx(expected_full)
    assert near["b"] != pytest.approx(full["b"])


def test_rescore_keeps_the_run_time_when_the_clock_moves(fixture_source, monkeypatch):
    monkeypatch.setattr(engine, "utc_now", lambda: datetime(2026, 10, 10, tzinfo=UTC))
    engine.run(AS_OF, source=fixture_source())
    monkeypatch.setattr(engine, "utc_now", lambda: datetime(2026, 10, 11, 12, tzinfo=UTC))
    store.put_manual_input("m_iran_strike", "2026-W41", "triggered", "", "t")
    assert engine.rescore("2026-W41").run_at == "2026-10-10T00:00:00+00:00"


def test_rescore_never_touches_fred(fixture_source, monkeypatch):
    engine.run(AS_OF, source=fixture_source())

    def no_fetch():
        raise AssertionError("rescore must not fetch")

    monkeypatch.setattr(engine, "default_source", no_fetch)
    store.put_manual_input("m_iran_strike", "2026-W41", "triggered", "", "t")
    assert engine.rescore("2026-W41") is not None


def test_kst_date_rolls_over_before_utc(monkeypatch):
    monkeypatch.setattr(engine, "utc_now", lambda: datetime(2026, 10, 11, 16, tzinfo=UTC))
    assert engine.kst_today() == date(2026, 10, 12)
    assert store.iso_week(engine.kst_today()) == "2026-W42"


def test_a_manual_put_on_a_week_judged_under_older_rules_re_judges_every_rule(fixture_source, monkeypatch):
    monkeypatch.setattr(engine, "utc_now", lambda: datetime(2026, 10, 10, 12, tzinfo=UTC))
    monkeypatch.setattr(engine, "default_source", lambda: fixture_source())
    store.save_snapshot(iso_week="2026-W41", run_at="2026-10-09T00:00:00+00:00", rules_version="old-rules",
                        probs={"a": 0.35, "b": 0.45, "c": 0.20}, results=[])
    store.put_manual_input("m_iran_strike", "2026-W41", "triggered", "", "t")
    snapshot = engine.rescore("2026-W41")
    assert snapshot.rules_version == get_rules().version
    assert states(snapshot) == {**EXPECTED, "m_iran_strike": "triggered"}
