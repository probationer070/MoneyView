"""News loop. Each docstring names the mutation its test catches."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from apps.api.services.news_feed import loop
from apps.api.services.news_feed.pacer import NewsBlocked
from apps.api.services.risk import store

NOW = datetime(2026, 10, 26, 22, 0, tzinfo=UTC)


@pytest.fixture
def steps(monkeypatch):
    log: list[str] = []
    monkeypatch.setattr(loop, "sweep_news", lambda now, **kw: log.append("macro"))
    monkeypatch.setattr(loop, "drain_alert_queue", lambda now: log.append("queue"))
    monkeypatch.setattr(loop, "run_daily_sweep", lambda now, **kw: log.append("daily"))
    return log


def test_run_news_once_order_and_isolation(steps, monkeypatch):
    """Catches steps out of order, a raising step stopping the later ones, or AssertionError swallowed."""
    def boom(now):
        steps.append("queue")
        raise RuntimeError("x")

    monkeypatch.setattr(loop, "drain_alert_queue", boom)
    loop.run_news_once(NOW)
    assert steps == ["macro", "queue", "daily"]

    steps.clear()

    def blocked(now):
        raise NewsBlocked("blocked", NOW)

    monkeypatch.setattr(loop, "drain_alert_queue", blocked)
    loop.run_news_once(NOW)
    assert steps == ["macro", "daily"]

    def guard(now):
        raise AssertionError("network")

    monkeypatch.setattr(loop, "drain_alert_queue", guard)
    with pytest.raises(AssertionError):
        loop.run_news_once(NOW)


def test_macro_sweep_waits_twelve_hours(steps):
    """Catches a macro sweep every pass, or one that never resumes after 12 h."""
    store.set_state("news_swept_at", (NOW - timedelta(hours=11)).isoformat())
    loop.run_news_once(NOW)
    assert "macro" not in steps

    steps.clear()
    store.set_state("news_swept_at", (NOW - timedelta(hours=13)).isoformat())
    loop.run_news_once(NOW)
    assert "macro" in steps


def test_daily_sweep_runs_only_when_due(steps):
    """Catches a daily sweep run after the day is done, or never run."""
    loop.run_news_once(NOW)
    assert "daily" in steps

    steps.clear()
    store.set_state("news_daily_done:2026-10-26", "1")
    loop.run_news_once(NOW)
    assert "daily" not in steps
