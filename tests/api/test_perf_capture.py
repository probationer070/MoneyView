from __future__ import annotations

import json
import threading
from pathlib import Path

from apps.api.core import dev_monitor
from apps.api.core.dev_monitor import ActiveDevMonitorSink
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent


def _event(operation: str = "op") -> PerformanceEvent:
    return PerformanceEvent(level="info", scope="api", operation=operation, status="success", duration_ms=1.0)


def test_buffered_sink_opens_log_file_once_for_many_events(monkeypatch, tmp_path):
    log_path = tmp_path / "perf.jsonl"
    # flush_events high and flush_interval_ms large so only the explicit flush() writes --
    # keeps the open-count deterministic even if the background thread wakes during the test.
    sink = ActiveDevMonitorSink(log_path=log_path, synchronous=False, flush_events=10_000, flush_interval_ms=600_000)

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


def test_persistence_disables_on_non_os_error_without_crashing_flusher(monkeypatch, tmp_path):
    # UnicodeEncodeError is a ValueError, not an OSError. The failure policy ("disk full,
    # permission denied, encoding error") must cover it too, and the background flusher
    # thread must survive it rather than dying silently.
    sink = ActiveDevMonitorSink(log_path=tmp_path / "perf.jsonl", synchronous=False, flush_events=1, flush_interval_ms=20)

    class _FailingHandle:
        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def write(self, _data):
            raise UnicodeEncodeError("utf-8", "\ud800", 0, 1, "surrogates not allowed")

    def failing_open(self, *args, **kwargs):
        return _FailingHandle()

    logged: list[tuple] = []
    monkeypatch.setattr(Path, "open", failing_open)
    monkeypatch.setattr(dev_monitor.logger, "error", lambda *args, **kwargs: logged.append(args))

    sink.emit(_event())
    sink.flush()

    assert sink.persistence_enabled is False
    assert len(logged) == 1
    assert sink._flusher is not None
    assert sink._flusher.is_alive()


def test_concurrent_emit_and_flush_produce_well_formed_jsonl(tmp_path):
    log_path = tmp_path / "perf.jsonl"
    sink = ActiveDevMonitorSink(log_path=log_path, synchronous=False, flush_events=50, flush_interval_ms=20)

    events_per_thread = 50
    thread_count = 8
    total_events = events_per_thread * thread_count

    def emit_many():
        for index in range(events_per_thread):
            sink.emit(_event(f"op{index}"))

    stop_flushing = threading.Event()

    def flush_repeatedly():
        while not stop_flushing.is_set():
            sink.flush()

    flusher_thread = threading.Thread(target=flush_repeatedly)
    flusher_thread.start()

    emitters = [threading.Thread(target=emit_many) for _ in range(thread_count)]
    for thread in emitters:
        thread.start()
    for thread in emitters:
        thread.join()

    stop_flushing.set()
    flusher_thread.join()
    sink.flush()

    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    for line in lines:
        json.loads(line)  # every line must parse -- concurrent writes must never interleave/corrupt
    assert len(lines) == total_events


def test_shutdown_flushes_pending_events_and_stops_background_thread(tmp_path):
    log_path = tmp_path / "perf.jsonl"
    sink = ActiveDevMonitorSink(log_path=log_path, synchronous=False, flush_events=10_000, flush_interval_ms=600_000)
    sink.emit(_event())

    sink.shutdown()

    assert len(log_path.read_text(encoding="utf-8").strip().splitlines()) == 1
    assert sink._flusher is not None
    assert not sink._flusher.is_alive()
