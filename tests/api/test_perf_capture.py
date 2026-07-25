from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path

from fastapi.testclient import TestClient
from starlette.concurrency import run_in_threadpool

from apps.api.core import dev_monitor
from apps.api.main import app
from apps.api.core.dev_monitor import (
    ActiveDevMonitorSink,
    emit_performance_event,
    get_current_span_id,
    get_dev_monitor_event_limit,
    perf_timer,
)
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent
from apps.api.models.schemas import CorporateMetrics
from apps.api.services import corporate_metrics_service
from apps.api.services import db as db_service
from apps.api.services.portfolio.cache_service import CacheService


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


def test_event_limit_defaults_to_twenty_thousand(monkeypatch):
    monkeypatch.delenv("MONEYVIEW_DEV_MONITOR_EVENT_LIMIT", raising=False)
    assert get_dev_monitor_event_limit() == 20_000


def test_event_limit_reads_env_and_falls_back_on_garbage(monkeypatch):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_EVENT_LIMIT", "500")
    assert get_dev_monitor_event_limit() == 500
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_EVENT_LIMIT", "not-a-number")
    assert get_dev_monitor_event_limit() == 20_000


def test_sink_sizes_deques_from_event_limit(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_EVENT_LIMIT", "5")
    sink = ActiveDevMonitorSink(log_path=tmp_path / "perf.jsonl", synchronous=True)
    for index in range(10):
        sink.emit(_event(f"op{index}"))
    assert len(sink.recent(limit=100)) == 5


def _enable(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(tmp_path))
    dev_monitor.reset_dev_monitor_sink()
    return dev_monitor.get_dev_monitor_sink()


def test_perf_timer_auto_parents_nested_spans(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    with perf_timer(scope="calculation", operation="outer"):
        with perf_timer(scope="db", operation="inner"):
            pass
    events = {event.operation: event for event in sink.recent(limit=50)}
    assert events["inner"].parent_id == events["outer"].id


def test_explicit_parent_id_overrides_context(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    with perf_timer(scope="calculation", operation="outer"):
        with perf_timer(scope="db", operation="inner", parent_id="explicit-parent"):
            pass
    inner = next(event for event in sink.recent(limit=50) if event.operation == "inner")
    assert inner.parent_id == "explicit-parent"


def test_span_context_resets_after_exception(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    with perf_timer(scope="calculation", operation="outer"):
        try:
            with perf_timer(scope="db", operation="raiser"):
                raise ValueError("boom")
        except ValueError:
            pass
        with perf_timer(scope="db", operation="sibling"):
            pass
    events = {event.operation: event for event in sink.recent(limit=50) if event.duration_ms is not None}
    assert events["sibling"].parent_id == events["outer"].id


def test_original_exception_propagates(monkeypatch, tmp_path):
    _enable(monkeypatch, tmp_path)
    try:
        with perf_timer(scope="db", operation="raiser"):
            raise ValueError("boom")
    except ValueError as error:
        assert str(error) == "boom"
    else:
        raise AssertionError("expected ValueError to propagate")


def test_emit_start_terminal_carries_closes_span_id(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    with perf_timer(scope="calculation", operation="fanout.comparison", emit_start=True):
        pass
    events = sink.recent(limit=50)
    start = next(event for event in events if event.status == "start")
    terminal = next(event for event in events if event.duration_ms is not None)
    assert terminal.metadata["closes_span_id"] == start.id


def test_emit_start_error_path_carries_closes_span_id(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    try:
        with perf_timer(scope="calculation", operation="fanout.comparison", emit_start=True):
            raise ValueError("boom")
    except ValueError:
        pass
    events = sink.recent(limit=50)
    start = next(event for event in events if event.status == "start")
    terminal = next(event for event in events if event.status == "error")
    assert terminal.metadata["closes_span_id"] == start.id


def test_span_parent_survives_threadpool(monkeypatch, tmp_path):
    """FastAPI runs sync handlers in a threadpool; contextvars must propagate.

    Failure mode is silent: spans lose their parent and appear as orphans,
    which reads as missing data rather than as a bug.
    """
    sink = _enable(monkeypatch, tmp_path)

    def sync_handler_body():
        assert get_current_span_id() is not None
        with perf_timer(scope="db", operation="inner"):
            pass

    async def scenario():
        with perf_timer(scope="api", operation="outer"):
            await run_in_threadpool(sync_handler_body)

    asyncio.run(scenario())
    events = {event.operation: event for event in sink.recent(limit=50)}
    assert events["inner"].parent_id == events["outer"].id


def test_emit_performance_event_defaults_parent_from_current_span(monkeypatch, tmp_path):
    # Correction 1: events that bypass perf_timer entirely (raw PerformanceEvent
    # construction, as done by InstrumentedCursor SQL spans and emit_cache_event)
    # must still pick up the enclosing span as their parent.
    sink = _enable(monkeypatch, tmp_path)
    with perf_timer(scope="calculation", operation="outer") as _metadata:
        bare_event = emit_performance_event(_event("bare"))
    events = {event.operation: event for event in sink.recent(limit=50)}
    assert bare_event.parent_id == events["outer"].id


def test_emit_performance_event_keeps_explicit_parent_id(monkeypatch, tmp_path):
    # Correction 1: an explicit parent_id on the event must win over the contextvar.
    _enable(monkeypatch, tmp_path)
    with perf_timer(scope="calculation", operation="outer"):
        explicit_event = PerformanceEvent(
            level="info",
            scope="db",
            operation="explicit",
            status="success",
            duration_ms=1.0,
            parent_id="explicit-parent",
        )
        emitted = emit_performance_event(explicit_event)
    assert emitted.parent_id == "explicit-parent"


def test_middleware_terminal_event_carries_closes_span_id_and_bytes(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    with TestClient(app) as client:
        client.get("/api/v1/dev/performance/summary")
    events = sink.recent(limit=200)
    start = next(event for event in events if event.operation == "api.request_start")
    complete = next(event for event in events if event.operation == "api.request_complete")
    assert complete.metadata["closes_span_id"] == start.id
    assert isinstance(complete.metadata["bytes"], int)


def test_streaming_response_reports_null_bytes(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    with TestClient(app) as client:
        client.get("/api/v1/dev/log-stream?once=true")
    complete = next(
        event
        for event in sink.recent(limit=200)
        if event.operation == "api.request_complete" and "log-stream" in (event.route or "")
    )
    assert complete.metadata["bytes"] is None


def _fake_metrics_for_ticker(ticker: str, **_kwargs: object) -> CorporateMetrics:
    return CorporateMetrics(
        ticker=ticker,
        growth=6,
        roic=18,
        wacc=10,
        debt_ratio=18,
        unlevered_beta=1.05,
        crp=0.8,
        reinvestment=34,
        fcff=92,
        innovation=82,
        market_share=64,
        governance=74,
        esg_penalty=22,
    )


def test_comparison_fanout_emits_per_ticker_spans(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("AAPL", "Apple", "Technology", "core", 0.4),
        )
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("MSFT", "Microsoft", "Technology", "core", 0.2),
        )
    monkeypatch.setattr(corporate_metrics_service, "metrics_for_ticker", _fake_metrics_for_ticker)
    monkeypatch.setattr(corporate_metrics_service, "latest_market_price", lambda ticker: 100.0)

    client = TestClient(app)
    client.get("/api/v1/corporate/comparison?mode=live")

    events = sink.recent(limit=20_000)
    fanout = [event for event in events if event.operation == "fanout.comparison"]
    metrics_spans = [event for event in events if event.operation == "ticker.metrics"]
    assert fanout, "fanout.comparison span missing"
    assert metrics_spans, "no per-ticker metrics spans emitted"
    assert all(span.ticker for span in metrics_spans)
    terminal = next(event for event in fanout if event.duration_ms is not None)
    assert isinstance(terminal.metadata.get("fanout_size"), int)


def test_comparison_fanout_spans_reach_per_request_view(monkeypatch, tmp_path):
    # Fix round 1: perf_timer used to emit every span with request_id=None, so
    # request-scoped views (list_requests / waterfall/{request_id}) silently
    # dropped the fan-out spans even though they were captured in the buffer.
    sink = _enable(monkeypatch, tmp_path)
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("AAPL", "Apple", "Technology", "core", 0.4),
        )
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("MSFT", "Microsoft", "Technology", "core", 0.2),
        )
    monkeypatch.setattr(corporate_metrics_service, "metrics_for_ticker", _fake_metrics_for_ticker)
    monkeypatch.setattr(corporate_metrics_service, "latest_market_price", lambda ticker: 100.0)

    client = TestClient(app)
    client.get("/api/v1/corporate/comparison?mode=live")

    events = sink.recent(limit=20_000)
    complete = next(event for event in events if event.operation == "api.request_complete")
    request_id = complete.request_id
    assert request_id, "api.request_complete carried no request_id"

    scoped = [event for event in events if event.request_id == request_id]
    assert any(event.operation == "fanout.comparison" for event in scoped), (
        "fanout.comparison span did not carry the ambient request_id"
    )
    assert any(event.operation == "ticker.metrics" for event in scoped), (
        "ticker.metrics span did not carry the ambient request_id"
    )


def test_perf_timer_explicit_request_id_overrides_ambient(monkeypatch, tmp_path):
    # Fix round 1: an explicitly passed request_id must win over the ambient
    # contextvar, mirroring how parent_id already behaves.
    sink = _enable(monkeypatch, tmp_path)
    token = dev_monitor.set_current_request_id("ambient-request")
    try:
        with perf_timer(
            scope="calculation",
            operation="explicit_request_id_probe",
            request_id="explicit-request",
        ):
            pass
    finally:
        dev_monitor.reset_current_request_id(token)

    event = next(event for event in sink.recent(limit=50) if event.operation == "explicit_request_id_probe")
    assert event.request_id == "explicit-request"


def test_attribution_fanout_emits_series_spans(monkeypatch, tmp_path):
    # CacheService._attribution_cache is a class-level TTLCache shared across the
    # whole process and not reset between tests. If an earlier test already cached
    # a result under this exact payload's cache key, build_attribution would return
    # early on the cache hit and no fan-out/series spans would be emitted -- a false
    # failure unrelated to instrumentation. Clear it explicitly rather than relying
    # on test collection order or inventing a "unique" payload.
    CacheService._attribution_cache.clear()
    sink = _enable(monkeypatch, tmp_path)
    payload = {
        "tickers": ["AAPL", "MSFT"],
        "weights": [0.5, 0.5],
        "benchmark": "^GSPC",
        "period": "1y",
        "currency": "USD",
        "attribution_method": "brinson_fachler_arithmetic",
        "allow_synthetic_fallback": True,
        "allow_benchmark_proxy": True,
    }
    client = TestClient(app)
    client.post("/api/v1/portfolio/attribution", json=payload)
    events = sink.recent(limit=20_000)
    assert any(event.operation == "fanout.attribution" for event in events)
    series = [event for event in events if event.operation == "ticker.series"]
    assert series, "no ticker.series spans emitted"
    terminal = next(event for event in series if event.duration_ms is not None)
    assert isinstance(terminal.metadata.get("series_points"), int)
