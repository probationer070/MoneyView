"""risk_cycle. Each docstring names the mutation its test catches."""
from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.news_feed import daily
from apps.api.services.risk import schedule, store
from apps.api.services.risk.rules import get_rules
from packages.core_finance.risk_signals.decks import CrashCard

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
V = get_rules().version


@pytest.fixture
def calls(monkeypatch):
    log: list = []
    monkeypatch.setattr(schedule, "sweep_bars", lambda now: log.append("sweep"))
    monkeypatch.setattr(schedule, "sweep_indices", lambda now: log.append("indices"))

    def backfill(now, **kw):
        log.append(("backfill", kw))

    def evaluate(now, **kw):
        log.append(("evaluate", kw))
        return []

    monkeypatch.setattr(schedule, "run_backfill", backfill)
    monkeypatch.setattr(schedule, "evaluate_pending", evaluate)
    return log


def test_run_once_order(calls):
    """Catches steps run out of order, the market-index sweep dropped from the cycle, or backfill or
    evaluate given pre-loaded inputs (a full-history load that would bypass the live window's trimmed read)."""
    schedule.run_once(NOW)

    assert [c if isinstance(c, str) else c[0] for c in calls] == ["sweep", "indices", "backfill", "evaluate"]
    assert "inputs" not in calls[2][1]
    assert "inputs" not in calls[3][1]


def test_risk_cycle_sends_no_news_requests(calls, monkeypatch):
    """Catches a news sweep left in the risk cycle: any Google request raises AssertionError here."""
    def forbidden(*a, **k):
        raise AssertionError("risk cycle sent a news request")

    monkeypatch.setattr("apps.api.services.news_feed.pacer.google_news", forbidden)
    monkeypatch.setattr("apps.api.services.news_feed.google_news", forbidden)
    monkeypatch.setattr("apps.api.services.webscrap.Crawler.StockNewsCrawler.google_news", forbidden)
    schedule.run_once(NOW)


def test_new_alert_queues_its_tickers(calls, monkeypatch):
    """Catches tickers queued for no alert, the wrong deck, or more than the top 10."""
    aid = store.insert_alert(date(2026, 10, 19), ("ai_semis",), V, "live", "ai_semis", False)
    store.replace_cards(aid, "latest", "crash", [
        CrashCard(f"T{i}", -20.0 + i, date(2026, 9, 25), 10.0, 8.0, [8.0]) for i in range(12)], date(2026, 10, 19))
    monkeypatch.setattr(schedule, "evaluate_pending", lambda now, **kw: [aid])

    assert schedule.run_once(NOW) == [aid]

    assert daily._read_queue() == [f"T{i}" for i in range(10)]


def test_step_exception_does_not_stop_later_steps(calls, monkeypatch):
    """Catches an exception in one step aborting the steps after it."""
    def boom(*a, **k):
        raise RuntimeError("x")

    for name in ("sweep_bars", "sweep_indices", "run_backfill", "evaluate_pending"):
        monkeypatch.setattr(schedule, name, boom)
    schedule.run_once(NOW)
    assert calls == []


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
