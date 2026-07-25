from __future__ import annotations

import logging
from pathlib import Path

from apps.api.core import dev_monitor
from apps.api.core.dev_monitor import ActiveDevMonitorSink
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent


def _event(operation: str = "op") -> PerformanceEvent:
    return PerformanceEvent(level="info", scope="api", operation=operation, status="success", duration_ms=1.0)


def test_buffered_sink_opens_log_file_once_for_many_events(monkeypatch, tmp_path):
    log_path = tmp_path / "perf.jsonl"
    # flush_events high so only the explicit flush() writes -- keeps the count deterministic
    sink = ActiveDevMonitorSink(log_path=log_path, synchronous=False, flush_events=10_000)

    opens = {"count": 0}
    real_open = Path.open

    def counting_open(self, *args, **kwargs):
        if self == log_path:
            opens["count"] += 1
        return real_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", counting_open)
    for index in range(200):
        sink.emit(_event(f"op{index}"))
    sink.flush()

    assert opens["count"] == 1
    monkeypatch.undo()
    assert len(log_path.read_text(encoding="utf-8").strip().splitlines()) == 200


def test_flush_is_idempotent(tmp_path):
    log_path = tmp_path / "perf.jsonl"
    sink = ActiveDevMonitorSink(log_path=log_path, synchronous=False, flush_events=10_000)
    sink.emit(_event())
    sink.flush()
    sink.flush()
    assert len(log_path.read_text(encoding="utf-8").strip().splitlines()) == 1


def test_synchronous_mode_writes_immediately(tmp_path):
    log_path = tmp_path / "perf.jsonl"
    sink = ActiveDevMonitorSink(log_path=log_path, synchronous=True)
    sink.emit(_event())
    assert log_path.exists()
    assert len(log_path.read_text(encoding="utf-8").strip().splitlines()) == 1


def test_persistence_failure_self_disables_logs_once_and_keeps_ring_buffer(monkeypatch, tmp_path):
    sink = ActiveDevMonitorSink(log_path=tmp_path / "perf.jsonl", synchronous=True)

    def failing_open(self, *args, **kwargs):
        raise OSError(28, "No space left on device")

    logged: list[tuple] = []
    monkeypatch.setattr(Path, "open", failing_open)
    monkeypatch.setattr(dev_monitor.logger, "error", lambda *args, **kwargs: logged.append(args))

    for _ in range(100):
        sink.emit(_event())

    assert sink.persistence_enabled is False
    assert len(logged) == 1
    assert len(sink.recent(limit=500)) == 100
