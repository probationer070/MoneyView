"""risk_cycle. Each docstring names the mutation its test catches."""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.risk import schedule, store
from apps.api.services.risk.rules import get_rules
from packages.core_finance.risk_signals.decks import CrashCard

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
V = get_rules().version


class _Inputs:
    fred_errors = ["BAA10Y: timeout"]


@pytest.fixture
def calls(monkeypatch):
    log: list = []
    monkeypatch.setattr(schedule, "sweep_bars", lambda now: log.append("sweep"))

    def backfill(now, **kw):
        log.append(("backfill", kw))

    def load(**kw):
        log.append("load")
        return _Inputs()

    def evaluate(now, **kw):
        log.append(("evaluate", kw))
        return []

    monkeypatch.setattr(schedule, "run_backfill", backfill)
    monkeypatch.setattr(schedule, "load_inputs", load)
    monkeypatch.setattr(schedule, "evaluate_pending", evaluate)
    monkeypatch.setattr(schedule, "sweep_news", lambda now, **kw: log.append(("news", kw)))
    return log


def test_run_once_order(calls):
    """Catches steps run out of order, backfill given pre-loaded inputs, or evaluate not given the loaded inputs."""
    schedule.run_once(NOW)

    assert [c if isinstance(c, str) else c[0] for c in calls] == ["sweep", "backfill", "load", "evaluate", "news"]
    assert "inputs" not in calls[1][1]
    assert isinstance(calls[3][1]["inputs"], _Inputs)
    assert store.get_state("fred_errors") == '["BAA10Y: timeout"]'


def test_news_skipped_within_12h(calls):
    """Catches a news sweep on every pass, and one that never resumes after 12 h."""
    store.set_state("news_swept_at", (NOW - timedelta(hours=11)).isoformat())
    schedule.run_once(NOW)
    assert not any(isinstance(c, tuple) and c[0] == "news" for c in calls)

    store.set_state("news_swept_at", (NOW - timedelta(hours=13)).isoformat())
    schedule.run_once(NOW)
    assert any(isinstance(c, tuple) and c[0] == "news" for c in calls)


def test_new_alert_triggers_ticker_news(calls, monkeypatch):
    """Catches ticker news fetched for no alert, the wrong deck, or more than the top 10."""
    aid = store.insert_alert(date(2026, 10, 19), ("ai_semis",), V, "live", "ai_semis", False)
    store.replace_cards(aid, "latest", "crash", [
        CrashCard(f"T{i}", -20.0 + i, date(2026, 9, 25), 10.0, 8.0, [8.0]) for i in range(12)], date(2026, 10, 19))
    store.set_state("news_swept_at", NOW.isoformat())
    monkeypatch.setattr(schedule, "evaluate_pending", lambda now, **kw: [aid])

    assert schedule.run_once(NOW) == [aid]

    news = [c[1] for c in calls if isinstance(c, tuple) and c[0] == "news"]
    assert news == [{"tickers": [f"T{i}" for i in range(10)]}]


def test_step_exception_does_not_stop_later_steps(calls, monkeypatch):
    """Catches an exception in one step aborting the steps after it."""
    def boom(*a, **k):
        raise RuntimeError("x")

    for name in ("sweep_bars", "run_backfill", "load_inputs"):
        monkeypatch.setattr(schedule, name, boom)
    schedule.run_once(NOW)
    assert calls == [("news", {})]


def test_assertion_error_propagates(calls, monkeypatch):
    """Catches the network guard's AssertionError being swallowed."""
    def guard(now):
        raise AssertionError("network")

    monkeypatch.setattr(schedule, "sweep_bars", guard)
    with pytest.raises(AssertionError):
        schedule.run_once(NOW)


def test_cycle_not_started_when_jobs_disabled(monkeypatch):
    """Catches the lifespan creating risk_cycle despite MONEYVIEW_DISABLE_STARTUP_JOBS."""
    started: list = []

    async def fake_cycle(*a, **k):
        started.append(1)

    monkeypatch.setattr(schedule, "risk_cycle", fake_cycle)
    with TestClient(app):
        pass
    assert started == []
