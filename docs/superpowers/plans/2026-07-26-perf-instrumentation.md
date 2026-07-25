# Performance Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument MoneyView's request path at per-ticker granularity, expose a `/dev/performance` analysis dashboard, and produce a reproducible baseline report identifying the top bottlenecks behind four reported slow surfaces.

**Architecture:** Four layers, strictly ordered — Capture (buffered event sink + span context in `apps/api/core/dev_monitor.py`), Analysis (pure functions over `list[PerformanceEvent]` in `apps/api/services/perf_analysis.py`), API (thin routes in `apps/api/routes/dev_monitor.py`), View (`apps/web/app/dev/performance/`). A baseline runner consumes the same analysis functions the routes use, so reports and the dashboard cannot disagree.

**Tech Stack:** Python 3 / FastAPI / Pydantic v2 / SQLite, Next.js 15 / React / TypeScript / TanStack Query, pytest, Playwright.

## Global Constraints

- **This spec changes NO application behavior.** Every change is additive instrumentation, new modules, or new routes. If a task requires altering a finance calculation, a response payload, or existing route semantics, stop and escalate.
- **Ordering constraint (hard):** Task 1 (buffered sink) MUST complete before Tasks 10–11 (fan-out instrumentation). The current write path costs 199.9 µs/event; 690 unbuffered spans add ~138 ms to the request being measured, corrupting the measurement.
- **Analysis purity:** `apps/api/services/perf_analysis.py` must never import `get_dev_monitor_sink`, `os`, `subprocess`, or `datetime.now`. It takes `list[PerformanceEvent]` and returns DTOs. Filtering happens in routes.
- **Everything is gated** behind `is_dev_monitor_enabled()` (`MONEYVIEW_DEV_MONITOR=true`), which is off by default. New endpoints 404 when disabled via the existing `_require_dev_monitor()`.
- **Reserved metadata keys** — read only via typed accessors, never raw dict lookups: `rows`, `bytes`, `series_points`, `cache_state`, `fanout_size`, `closes_span_id`.
- **Diagnostic states are not errors:** `partial`, `truncated`, `clock_skew`, `orphaned`, `overlap_detected` render with neutral/warning styling, never error styling.
- **Test commands:** Python `python -m pytest tests/api/<file> -v` from repo root `E:\MoneyView`. Frontend `cd apps/web && npx playwright test`.
- **Commit style:** Conventional prefixes (`feat:`, `test:`, `docs:`, `fix:`), matching recent history.
- **Spec reference:** `docs/superpowers/specs/2026-07-25-perf-instrumentation/`. Each task cites the section it implements.

---

## File Structure

| Path | Responsibility | Action |
| --- | --- | --- |
| `apps/api/core/dev_monitor.py` | capture: sink, buffering, span context, `perf_timer` | modify |
| `apps/api/core/middleware.py` | request spans: `closes_span_id`, response bytes | modify |
| `apps/api/models/schema_parts/perf_analysis.py` | analysis DTOs | **create** |
| `apps/api/services/perf_analysis.py` | pure analysis functions + metadata accessors | **create** |
| `apps/api/routes/dev_monitor.py` | five analysis endpoints + `_filter_events` | modify |
| `apps/api/routes/corporate.py` | wrap `_metrics_for_ticker`, `_latest_market_price` | modify |
| `apps/api/services/corporate_comparison.py` | `fanout.comparison` span | modify |
| `apps/api/services/portfolio/data_provider.py` | `ticker.series` span | modify |
| `apps/api/services/portfolio/portfolio_service.py` | `fanout.attribution` span | modify |
| `apps/web/lib/devMonitor.ts` | client types + fetchers | modify |
| `apps/web/lib/api.ts` | response `bytes` in monitor metadata | modify |
| `apps/web/app/dev/performance/page.tsx` | dashboard composition | **create** |
| `apps/web/app/dev/performance/SpanWaterfall.tsx` | the only new UI primitive | **create** |
| `apps/web/tests/perf-dashboard.spec.ts` | dashboard state tests | **create** |
| `scripts/benchmark_scenarios.py` | baseline runner | **create** |
| `tests/api/test_perf_capture.py` | capture behavior tests | **create** |
| `tests/api/test_perf_analysis.py` | analysis unit tests | **create** |
| `tests/api/test_perf_routes.py` | endpoint tests | **create** |
| `docs/perf/` | generated baseline reports | **create dir** |

---

## Task 1: Buffered event sink

Implements spec §03.4 and §03.8. **Blocks Tasks 10–11.**

**Files:**
- Modify: `apps/api/core/dev_monitor.py:120-201` (`ActiveDevMonitorSink`)
- Test: `tests/api/test_perf_capture.py` (create)

**Interfaces:**
- Consumes: existing `PerformanceEvent`, `ActiveDevMonitorSink`, module-level `logger`.
- Produces:
  - `ActiveDevMonitorSink(*, log_path: Path, recent_limit: int | None = None, synchronous: bool = False, flush_events: int = 200, flush_interval_ms: int = 500)`
  - `ActiveDevMonitorSink.flush() -> None` (blocking)
  - `ActiveDevMonitorSink.persistence_enabled -> bool` (property)
  - `DevMonitorSink.flush() -> None` (no-op on base/NoOp)

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_perf_capture.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_perf_capture.py -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'synchronous'`

- [ ] **Step 3: Implement the buffered sink**

In `apps/api/core/dev_monitor.py`, replace `ActiveDevMonitorSink.__init__`, `emit`, and `_append_jsonl`. Add `flush()` to the base `DevMonitorSink` as a no-op.

```python
class DevMonitorSink:
    # ... existing methods unchanged ...

    def flush(self) -> None:
        return None


class ActiveDevMonitorSink(DevMonitorSink):
    def __init__(
        self,
        *,
        log_path: Path,
        recent_limit: int | None = None,
        synchronous: bool = False,
        flush_events: int = 200,
        flush_interval_ms: int = 500,
    ):
        self.log_path = log_path
        self._recent_limit = recent_limit if recent_limit is not None else _RECENT_EVENT_LIMIT
        self._recent_events: deque[PerformanceEvent] = deque(maxlen=self._recent_limit)
        self._sequenced_events: deque[tuple[int, PerformanceEvent]] = deque(maxlen=self._recent_limit)
        self._next_sequence = 0
        self._lock = threading.Lock()
        self._pending: list[PerformanceEvent] = []
        self._pending_lock = threading.Lock()
        self._persistence_enabled = True
        self._synchronous = synchronous
        self._flush_events = max(1, flush_events)
        self._flush_interval_s = max(0.01, flush_interval_ms / 1000.0)
        self._wake = threading.Event()
        self._stopping = False
        self._flusher: threading.Thread | None = None
        self._cleanup_old_jsonl_logs()
        if not synchronous:
            self._flusher = threading.Thread(target=self._flush_loop, name="dev-monitor-flush", daemon=True)
            self._flusher.start()

    @property
    def persistence_enabled(self) -> bool:
        return self._persistence_enabled

    def emit(self, event: PerformanceEvent) -> PerformanceEvent:
        sanitized_event = event.model_copy(update={"metadata": _sanitize_metadata(event.metadata)})
        with self._lock:
            self._next_sequence += 1
            self._recent_events.append(sanitized_event)
            self._sequenced_events.append((self._next_sequence, sanitized_event))
        should_flush_now = False
        with self._pending_lock:
            if self._persistence_enabled:
                self._pending.append(sanitized_event)
                should_flush_now = self._synchronous or len(self._pending) >= self._flush_events
        if should_flush_now:
            if self._synchronous:
                self._write_pending()
            else:
                self._wake.set()
        self._emit_terminal(sanitized_event)
        return sanitized_event

    def flush(self) -> None:
        self._write_pending()

    def shutdown(self) -> None:
        self._stopping = True
        self._wake.set()
        self.flush()

    def _flush_loop(self) -> None:
        while not self._stopping:
            self._wake.wait(timeout=self._flush_interval_s)
            self._wake.clear()
            self._write_pending()

    def _write_pending(self) -> None:
        with self._pending_lock:
            if not self._pending or not self._persistence_enabled:
                self._pending.clear()
                return
            batch = self._pending
            self._pending = []
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as handle:
                for event in batch:
                    handle.write(event.model_dump_json())
                    handle.write("\n")
        except OSError as error:
            self._disable_persistence(error)

    def _disable_persistence(self, error: OSError) -> None:
        with self._pending_lock:
            if not self._persistence_enabled:
                return
            self._persistence_enabled = False
            self._pending.clear()
        logger.error(
            "dev.monitor persistence disabled for this session path=%s error=%s",
            self.log_path,
            error,
        )
```

Delete the old `_append_jsonl` method — `_write_pending` replaces it.

Note: `mkdir` sits inside the `try` so a permission error on the directory is caught by the same policy.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_capture.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Verify no existing test regressed**

Run: `python -m pytest tests/api/test_dev_monitor_foundation.py -v`
Expected: PASS. If a test asserting JSONL content fails, it is reading before a flush — add `get_dev_monitor_sink().flush()` before the assertion in that test. Do not weaken the assertion.

- [ ] **Step 6: Register shutdown flush**

In `apps/api/main.py`, find the FastAPI app construction and add a shutdown handler:

```python
@app.on_event("shutdown")
async def _flush_dev_monitor() -> None:
    from apps.api.core.dev_monitor import get_dev_monitor_sink

    sink = get_dev_monitor_sink()
    shutdown = getattr(sink, "shutdown", None)
    if callable(shutdown):
        shutdown()
```

If `apps/api/main.py` already uses a `lifespan` context manager rather than `on_event`, add the same two lines to its shutdown half instead.

- [ ] **Step 7: Run the full API suite**

Run: `python -m pytest tests/api -q`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/core/dev_monitor.py apps/api/main.py tests/api/test_perf_capture.py
git commit -m "feat: buffered dev-monitor event sink with flush and failure policy (spec 03.4, 03.8)"
```

---

## Task 2: Configurable ring buffer limit

Implements spec §03.7.

**Files:**
- Modify: `apps/api/core/dev_monitor.py:21` (constant), `:42-49` (getter neighborhood), `ActiveDevMonitorSink.__init__`
- Test: `tests/api/test_perf_capture.py`

**Interfaces:**
- Produces: `get_dev_monitor_event_limit() -> int` — default 20000, env `MONEYVIEW_DEV_MONITOR_EVENT_LIMIT`. Used by Task 9's routes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_perf_capture.py`:

```python
from apps.api.core.dev_monitor import get_dev_monitor_event_limit


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_perf_capture.py -k event_limit -v`
Expected: FAIL with `ImportError: cannot import name 'get_dev_monitor_event_limit'`

- [ ] **Step 3: Implement the getter and wire it in**

In `apps/api/core/dev_monitor.py`, add beside `_DEFAULT_RETENTION_DAYS`:

```python
_DEFAULT_EVENT_LIMIT = 20_000
```

Add after `get_dev_monitor_retention_days()`:

```python
def get_dev_monitor_event_limit() -> int:
    raw_value = os.getenv("MONEYVIEW_DEV_MONITOR_EVENT_LIMIT", "").strip()
    if not raw_value:
        return _DEFAULT_EVENT_LIMIT
    try:
        return max(1, int(raw_value))
    except ValueError:
        return _DEFAULT_EVENT_LIMIT
```

In `ActiveDevMonitorSink.__init__`, change the limit resolution line to:

```python
        self._recent_limit = recent_limit if recent_limit is not None else get_dev_monitor_event_limit()
```

Leave `_RECENT_EVENT_LIMIT = 2000` in place — `_DEFAULT_LIMIT = 500` still caps the existing `/performance/recent` endpoint, and other callers may reference the old constant.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_capture.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/core/dev_monitor.py tests/api/test_perf_capture.py
git commit -m "feat: configurable dev-monitor event limit, default 20000 (spec 03.7)"
```

---

## Task 3: Span context and `closes_span_id` in `perf_timer`

Implements spec §03.2 and §03.3 (the `perf_timer` half).

**Files:**
- Modify: `apps/api/core/dev_monitor.py:324-390` (`perf_timer`)
- Test: `tests/api/test_perf_capture.py`

**Interfaces:**
- Produces:
  - `get_current_span_id() -> str | None`
  - `perf_timer` now auto-parents to the enclosing span, emits terminal events carrying `metadata["closes_span_id"]` when `emit_start=True`, and assigns the span's own id deterministically.
- Consumed by: Tasks 4, 10, 11 (spans nest automatically), Task 5 (`normalize_spans` pairs on `closes_span_id`).

**Identity rules (do not deviate — Task 5 depends on them):**

| `emit_start` | start event | terminal event | children parent to |
| --- | --- | --- | --- |
| `False` | none | `id = span_id`, `parent_id = enclosing span` | `span_id` |
| `True` | `id = span_id`, `parent_id = enclosing span` | fresh id, `parent_id = span_id`, `metadata.closes_span_id = span_id` | `span_id` |

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_perf_capture.py`:

```python
import asyncio

from starlette.concurrency import run_in_threadpool

from apps.api.core.dev_monitor import get_current_span_id, perf_timer


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_perf_capture.py -k "span or parent or closes or propagates" -v`
Expected: FAIL with `ImportError: cannot import name 'get_current_span_id'`

- [ ] **Step 3: Add the span contextvar**

In `apps/api/core/dev_monitor.py`, beside `_current_request_id` (line 24):

```python
_current_span_id: ContextVar[str | None] = ContextVar("moneyview_dev_monitor_span_id", default=None)
```

Add beside `get_current_request_id()`:

```python
def get_current_span_id() -> str | None:
    return _current_span_id.get()
```

Add `uuid4` to the imports at the top of the file:

```python
from uuid import uuid4
```

- [ ] **Step 4: Rewrite `perf_timer`**

Replace the body of `perf_timer` (`dev_monitor.py:324`) with:

```python
@contextmanager
def perf_timer(
    *,
    scope: str,
    operation: str,
    request_id: str | None = None,
    parent_id: str | None = None,
    slow_threshold_ms: float | None = None,
    level: str = "info",
    emit_start: bool = False,
    message: str | None = None,
    metadata: dict[str, Any] | None = None,
    **event_fields: Any,
) -> Iterator[dict[str, Any]]:
    threshold_ms = slow_threshold_ms if slow_threshold_ms is not None else slow_threshold_ms_for_scope(scope)
    span_id = uuid4().hex
    effective_parent = parent_id if parent_id is not None else _current_span_id.get()
    event_context = {
        "request_id": request_id,
        "parent_id": effective_parent,
        "level": level,
        "scope": scope,
        "operation": operation,
        "message": message,
        "metadata": metadata or {},
        **event_fields,
    }
    start_event: PerformanceEvent | None = None
    if emit_start and is_dev_monitor_enabled():
        start_event = emit_performance_event(
            PerformanceEvent(**event_context, id=span_id, status="start")
        )

    started_at = time.perf_counter()
    mutable_metadata = event_context["metadata"]
    span_token = _current_span_id.set(span_id)

    try:
        yield mutable_metadata
    except Exception as exc:
        duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
        error_metadata = dict(mutable_metadata)
        error_metadata.setdefault("exception_type", type(exc).__name__)
        if start_event is not None:
            error_metadata["closes_span_id"] = span_id
        emit_performance_event(
            PerformanceEvent(
                **_event_payload(
                    event_context,
                    parent_id=span_id if start_event else effective_parent,
                    metadata=error_metadata,
                    level="error",
                    status="error",
                    duration_ms=duration_ms,
                    **({} if start_event else {"id": span_id}),
                    message=message or str(exc),
                )
            )
        )
        raise
    finally:
        _current_span_id.reset(span_token)

    duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
    status = "slow" if duration_ms >= threshold_ms else "success"
    terminal_metadata = dict(mutable_metadata)
    if start_event is not None:
        terminal_metadata["closes_span_id"] = span_id
    emit_performance_event(
        PerformanceEvent(
            **_event_payload(
                event_context,
                parent_id=span_id if start_event else effective_parent,
                metadata=terminal_metadata,
                status=status,
                duration_ms=duration_ms,
                **({} if start_event else {"id": span_id}),
            )
        )
    )
```

Note the `finally` block: the contextvar must reset on both the success and exception paths, and it must reset *before* the terminal event is emitted so the terminal event is not its own child.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_capture.py -v`
Expected: PASS (14 tests)

- [ ] **Step 6: Verify existing behavior holds**

Run: `python -m pytest tests/api -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/core/dev_monitor.py tests/api/test_perf_capture.py
git commit -m "feat: span context propagation and closes_span_id in perf_timer (spec 03.2, 03.3)"
```

---

## Task 4: Middleware `closes_span_id` and response bytes

Implements spec §03.3 (middleware half) and §03.5.2.

**Files:**
- Modify: `apps/api/core/middleware.py:126-155` (complete path), `:177-205` (error path)
- Test: `tests/api/test_perf_capture.py`

**Interfaces:**
- Consumes: `request_event_id` already computed at `middleware.py:105`.
- Produces: `api.request_complete` and `api.request_error` events carrying `metadata["closes_span_id"]` and `metadata["bytes"]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_perf_capture.py`:

```python
from fastapi.testclient import TestClient

from apps.api.main import app


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_perf_capture.py -k "middleware or streaming" -v`
Expected: FAIL with `KeyError: 'closes_span_id'`

- [ ] **Step 3: Add a bytes helper and extend the metadata**

In `apps/api/core/middleware.py`, add near the top-level helpers:

```python
def _response_bytes(response) -> int | None:
    """Response size from Content-Length. None for streaming responses.

    Buffering a StreamingResponse to measure it would change the behaviour
    under measurement, so streams deliberately report no size (spec 03.5.2).
    """
    raw_length = response.headers.get("content-length")
    if raw_length is None:
        return None
    try:
        return int(raw_length)
    except (TypeError, ValueError):
        return None
```

In the **complete** path (`middleware.py:177`), change the `api.request_complete` metadata from:

```python
                        metadata={"client_ip": client_ip, "status_code": response.status_code},
```

to:

```python
                        metadata={
                            "client_ip": client_ip,
                            "status_code": response.status_code,
                            "closes_span_id": request_event_id,
                            "bytes": _response_bytes(response),
                        },
```

In the **error** path (`middleware.py:132`), change the `api.request_error` metadata from:

```python
                            metadata={"client_ip": client_ip, "status_code": 500},
```

to:

```python
                            metadata={
                                "client_ip": client_ip,
                                "status_code": 500,
                                "closes_span_id": request_event_id,
                                "bytes": None,
                            },
```

Leave the two `page_load.*` events unchanged — they are a separate span family and are not terminals of the request span.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_capture.py -v`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/core/middleware.py tests/api/test_perf_capture.py
git commit -m "feat: closes_span_id and response bytes on request spans (spec 03.3, 03.5.2)"
```

---

## Task 5: Analysis DTOs, metadata accessors, and `normalize_spans`

Implements spec §02.4, §04.2, §04.6.

**Files:**
- Create: `apps/api/models/schema_parts/perf_analysis.py`
- Create: `apps/api/services/perf_analysis.py`
- Test: `tests/api/test_perf_analysis.py` (create)

**Interfaces:**
- Produces (consumed by Tasks 6–9 and 13):
  - DTOs: `SpanNode`, `CollapsedNode`, `RequestSummaryRow`, `RequestIndex`, `RequestWaterfall`, `TickerCostRow`, `TickerCostTable`, `ScopeRow`, `ScopeBreakdown`, `CacheRow`, `CacheReport`
  - Accessors: `span_rows`, `span_bytes`, `span_series_points`, `span_cache_state`, `span_fanout_size`, `span_closes`
  - `normalize_spans(events: list[PerformanceEvent]) -> list[Span]` where `Span` is the internal dataclass below.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_perf_analysis.py`:

```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apps.api.models.schema_parts.dev_monitor import PerformanceEvent
from apps.api.services.perf_analysis import (
    normalize_spans,
    span_bytes,
    span_closes,
    span_rows,
)

BASE_TIME = datetime(2026, 7, 26, 12, 0, 0, tzinfo=timezone.utc)


def ev(
    operation: str,
    scope: str = "calculation",
    ms: float | None = None,
    *,
    id: str | None = None,
    parent: str | None = None,
    ticker: str | None = None,
    status: str = "success",
    request_id: str = "req-1",
    offset_ms: float = 0.0,
    **metadata,
) -> PerformanceEvent:
    return PerformanceEvent(
        id=id or f"{operation}-id",
        request_id=request_id,
        parent_id=parent,
        level="info",
        scope=scope,
        operation=operation,
        status=status,
        duration_ms=ms,
        ticker=ticker,
        timestamp=BASE_TIME + timedelta(milliseconds=offset_ms),
        metadata=metadata,
    )


def test_accessors_return_none_on_absent_or_wrong_type():
    event = ev("op", ms=1.0, rows="not-an-int")
    assert span_rows(event) is None
    assert span_bytes(event) is None
    assert span_closes(event) is None
    assert span_rows(ev("op", ms=1.0, rows=7)) == 7


def test_single_event_span_is_normalized():
    spans = normalize_spans([ev("op", ms=10.0, id="a")])
    assert len(spans) == 1
    assert spans[0].id == "a"
    assert spans[0].total_ms == 10.0
    assert spans[0].partial is False


def test_perf_timer_convention_pairs_start_and_terminal():
    """Same operation name, distinguished by closes_span_id."""
    events = [
        ev("fanout", id="s1", status="start"),
        ev("fanout", id="t1", parent="s1", ms=100.0, closes_span_id="s1"),
    ]
    spans = normalize_spans(events)
    assert len(spans) == 1
    assert spans[0].id == "s1"
    assert spans[0].total_ms == 100.0


def test_middleware_convention_pairs_differently_named_events():
    """api.request_start -> api.request_complete: different operation names."""
    events = [
        ev("api.request_start", scope="api", id="s1", status="start"),
        ev("api.request_complete", scope="api", id="t1", parent="s1", ms=250.0, closes_span_id="s1"),
    ]
    spans = normalize_spans(events)
    assert len(spans) == 1
    assert spans[0].id == "s1"
    assert spans[0].total_ms == 250.0
    assert spans[0].scope == "api"


def test_unpaired_start_is_partial_and_has_no_duration():
    spans = normalize_spans([ev("fanout", id="s1", status="start")])
    assert len(spans) == 1
    assert spans[0].total_ms is None
    assert spans[0].partial is True


def test_start_events_never_enter_timing_math():
    events = [
        ev("api.request_start", scope="api", id="s1", status="start"),
        ev("api.request_complete", scope="api", id="t1", parent="s1", ms=250.0, closes_span_id="s1"),
        ev("child", id="c1", parent="s1", ms=40.0),
    ]
    spans = {span.id: span for span in normalize_spans(events)}
    assert set(spans) == {"s1", "c1"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_perf_analysis.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.perf_analysis'`

- [ ] **Step 3: Create the DTO module**

Create `apps/api/models/schema_parts/perf_analysis.py`:

```python
from __future__ import annotations

from datetime import datetime
from typing import Literal, Union

from pydantic import BaseModel, Field


class CollapsedNode(BaseModel):
    """Replaces an elided subtree so the UI cannot render an absence as 'no children'."""

    collapsed_count: int
    total_ms: float
    deepest_scope: str


class SpanNode(BaseModel):
    id: str
    parent_id: str | None = None
    operation: str
    scope: str
    status: str
    total_ms: float | None = None
    self_ms: float | None = None
    offset_ms: float = 0.0
    clock_skew: bool = False
    orphaned: bool = False
    ticker: str | None = None
    table: str | None = None
    component: str | None = None
    rows: int | None = None
    bytes: int | None = None
    series_points: int | None = None
    cache_state: str | None = None
    children: list[Union["SpanNode", CollapsedNode]] = Field(default_factory=list)


class RequestSummaryRow(BaseModel):
    request_id: str
    route: str | None = None
    method: str | None = None
    started_at: datetime
    ended_at: datetime | None = None
    total_ms: float | None = None
    span_count: int
    ticker_count: int
    status: str
    partial: bool = False


class RequestIndex(BaseModel):
    requests: list[RequestSummaryRow] = Field(default_factory=list)
    limit: int
    buffer_used: int
    buffer_limit: int


class RequestWaterfall(BaseModel):
    request_id: str
    route: str | None = None
    total_ms: float | None = None
    span_count: int
    partial: bool = False
    truncated: bool = False
    root: SpanNode


class TickerCostRow(BaseModel):
    ticker: str
    self_ms: float
    span_count: int
    db_ms: float = 0.0
    calculation_ms: float = 0.0
    external_ms: float = 0.0
    cache_hits: int = 0
    cache_misses: int = 0
    rows_read: int = 0
    bytes: int | None = None
    series_points: int | None = None


class TickerCostTable(BaseModel):
    rows: list[TickerCostRow] = Field(default_factory=list)
    ticker_count: int = 0
    total_self_ms: float = 0.0
    p50_ms: float = 0.0
    p95_ms: float = 0.0
    max_ms: float = 0.0
    cv: float = 0.0
    distribution: Literal["uniform", "mixed", "skewed"] = "uniform"


class ScopeRow(BaseModel):
    scope: str
    self_ms: float
    pct_of_total: float
    event_count: int
    slow_count: int


class ScopeBreakdown(BaseModel):
    scopes: list[ScopeRow] = Field(default_factory=list)
    total_ms: float = 0.0
    unattributed_ms: float = 0.0
    overlap_detected: bool = False


class CacheRow(BaseModel):
    """estimated_time_saved_ms assumes a miss would have cost this cache's observed
    average miss cost. Defensible for a TTL cache over stable data; wrong if miss
    costs are bimodal (cold vs. warm SQLite page cache)."""

    component: str
    hits: int
    misses: int
    hit_rate: float
    avg_miss_cost_ms: float
    estimated_time_saved_ms: float


class CacheReport(BaseModel):
    caches: list[CacheRow] = Field(default_factory=list)


SpanNode.model_rebuild()
```

- [ ] **Step 4: Create the analysis module with accessors and `normalize_spans`**

Create `apps/api/services/perf_analysis.py`:

```python
"""Pure analysis over performance events.

CONTRACT: no I/O, no globals, no locks, no wall-clock reads, no HTTP concepts.
Every function takes list[PerformanceEvent] and returns a DTO. Filtering happens
in the route layer before these functions are called (spec 02.3).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from apps.api.models.schema_parts.dev_monitor import PerformanceEvent

EPSILON_MS = 1.0


def _typed(event: PerformanceEvent, key: str, expected: type):
    value = event.metadata.get(key)
    return value if isinstance(value, expected) and not isinstance(value, bool) else None


def span_rows(event: PerformanceEvent) -> int | None:
    return _typed(event, "rows", int)


def span_bytes(event: PerformanceEvent) -> int | None:
    return _typed(event, "bytes", int)


def span_series_points(event: PerformanceEvent) -> int | None:
    return _typed(event, "series_points", int)


def span_cache_state(event: PerformanceEvent) -> str | None:
    return _typed(event, "cache_state", str)


def span_fanout_size(event: PerformanceEvent) -> int | None:
    return _typed(event, "fanout_size", int)


def span_closes(event: PerformanceEvent) -> str | None:
    return _typed(event, "closes_span_id", str)


@dataclass
class Span:
    id: str
    parent_id: str | None
    operation: str
    scope: str
    status: str
    total_ms: float | None
    end_time: datetime
    ticker: str | None = None
    table: str | None = None
    component: str | None = None
    rows: int | None = None
    bytes: int | None = None
    series_points: int | None = None
    cache_state: str | None = None
    partial: bool = False
    order: int = 0
    self_ms: float | None = None
    offset_ms: float = 0.0
    clock_skew: bool = False
    orphaned: bool = False
    collapsed: tuple[int, float, str] | None = None
    children: list["Span"] = field(default_factory=list)


def _span_from(event: PerformanceEvent, order: int) -> Span:
    return Span(
        id=event.id,
        parent_id=event.parent_id,
        operation=event.operation,
        scope=event.scope,
        status=event.status,
        total_ms=event.duration_ms,
        end_time=event.timestamp,
        ticker=event.ticker,
        table=event.table,
        component=event.component,
        rows=span_rows(event),
        bytes=span_bytes(event),
        series_points=span_series_points(event),
        cache_state=span_cache_state(event),
        partial=event.duration_ms is None,
        order=order,
    )


def normalize_spans(events: list[PerformanceEvent]) -> list[Span]:
    """Collapse start/terminal event pairs into one Span each.

    Two emit conventions coexist: perf_timer reuses one operation name for both
    events, middleware uses distinct names. Pairing is done on the explicit
    metadata.closes_span_id, never on name matching (spec 03.3).
    """
    spans: dict[str, Span] = {}
    terminals: list[tuple[str, PerformanceEvent]] = []

    for order, event in enumerate(events):
        closes = span_closes(event)
        if closes is not None:
            terminals.append((closes, event))
            continue
        spans[event.id] = _span_from(event, order)

    for start_id, terminal in terminals:
        start_span = spans.get(start_id)
        if start_span is None:
            # Start event evicted from the ring buffer: keep the terminal as its
            # own span rather than dropping the measurement.
            orphan = _span_from(terminal, len(spans))
            orphan.partial = True
            spans[terminal.id] = orphan
            continue
        start_span.total_ms = terminal.duration_ms
        start_span.status = terminal.status
        start_span.end_time = terminal.timestamp
        start_span.partial = terminal.duration_ms is None
        # Explicit None checks, not `or`: a legitimate 0 must not fall through.
        for attribute, accessor in (
            ("rows", span_rows),
            ("bytes", span_bytes),
            ("series_points", span_series_points),
            ("cache_state", span_cache_state),
        ):
            value = accessor(terminal)
            if value is not None:
                setattr(start_span, attribute, value)

    return list(spans.values())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_analysis.py -v`
Expected: PASS (6 tests)

- [ ] **Step 6: Add the purity guard test**

Append to `tests/api/test_perf_analysis.py`:

```python
import ast
from pathlib import Path


def test_analysis_module_is_pure():
    """Analysis must not acquire I/O, config, subprocess, or clock capabilities.

    If it does, the hand-built-event-list tests in this file stop being trustworthy.
    """
    source = Path("apps/api/services/perf_analysis.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert "os" not in imported
    assert "subprocess" not in imported
    assert "pathlib" not in imported
    assert "get_dev_monitor_sink" not in source
    assert "datetime.now" not in source
```

- [ ] **Step 7: Run the test**

Run: `python -m pytest tests/api/test_perf_analysis.py -v`
Expected: PASS (7 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/api/models/schema_parts/perf_analysis.py apps/api/services/perf_analysis.py tests/api/test_perf_analysis.py
git commit -m "feat: analysis DTOs, typed metadata accessors, and span normalization (spec 04.2, 04.6)"
```

---

## Task 6: `build_waterfall` — tree, self time, degradation, truncation

Implements spec §04.1, §04.3, §04.9, §04.10.

**Files:**
- Modify: `apps/api/services/perf_analysis.py`
- Test: `tests/api/test_perf_analysis.py`

**Interfaces:**
- Consumes: `normalize_spans`, `Span`, DTOs from Task 5.
- Produces: `build_waterfall(events: list[PerformanceEvent], request_id: str) -> RequestWaterfall`, and the internal helpers `_assign_self_ms(spans)`, `_build_tree(spans)` reused by Task 7.
- `WATERFALL_SPAN_CAP: int = 2000`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_perf_analysis.py`:

```python
from apps.api.services.perf_analysis import build_waterfall


def test_self_ms_subtracts_direct_children_at_every_level():
    events = [
        ev("root", id="r", ms=100.0, offset_ms=100),
        ev("mid", id="m", parent="r", ms=60.0, offset_ms=70),
        ev("leaf", id="l", parent="m", ms=25.0, offset_ms=40),
    ]
    waterfall = build_waterfall(events, "req-1")
    root = waterfall.root
    mid = root.children[0]
    leaf = mid.children[0]
    assert root.self_ms == 40.0
    assert mid.self_ms == 35.0
    assert leaf.self_ms == 25.0


def test_orphan_attaches_to_synthetic_root_and_is_flagged():
    events = [
        ev("root", id="r", ms=100.0),
        ev("lost", id="x", parent="evicted-parent", ms=10.0),
    ]
    waterfall = build_waterfall(events, "req-1")
    flattened = _flatten(waterfall.root)
    lost = next(node for node in flattened if node.operation == "lost")
    assert lost.orphaned is True
    assert waterfall.partial is True


def test_children_ordered_by_reconstructed_start_then_input_order():
    events = [
        ev("root", id="r", ms=100.0, offset_ms=100),
        ev("late", id="b", parent="r", ms=10.0, offset_ms=90),
        ev("early", id="a", parent="r", ms=10.0, offset_ms=50),
    ]
    waterfall = build_waterfall(events, "req-1")
    assert [child.operation for child in waterfall.root.children] == ["early", "late"]


def test_child_outside_parent_bounds_is_clamped_and_flagged():
    events = [
        ev("root", id="r", ms=100.0, offset_ms=100),
        ev("skewed", id="s", parent="r", ms=10.0, offset_ms=500),
    ]
    waterfall = build_waterfall(events, "req-1")
    child = waterfall.root.children[0]
    assert child.clock_skew is True
    assert child.offset_ms >= 0.0
    assert child.offset_ms <= (waterfall.root.total_ms or 0.0)


def test_waterfall_truncates_deepest_first_with_collapsed_node():
    events = [ev("root", id="r", ms=5000.0, offset_ms=5000)]
    parent_id = "r"
    for index in range(2_100):
        events.append(ev(f"child{index}", id=f"c{index}", parent=parent_id, ms=1.0, offset_ms=index))
    waterfall = build_waterfall(events, "req-1")
    assert waterfall.truncated is True
    collapsed = [node for node in waterfall.root.children if hasattr(node, "collapsed_count")]
    assert len(collapsed) == 1
    assert collapsed[0].collapsed_count > 0


def test_empty_events_returns_valid_waterfall():
    waterfall = build_waterfall([], "req-missing")
    assert waterfall.span_count == 0
    assert waterfall.root.operation == "(no spans)"


def _flatten(node):
    result = [node]
    for child in node.children:
        if hasattr(child, "collapsed_count"):
            continue
        result.extend(_flatten(child))
    return result
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_perf_analysis.py -k waterfall -v`
Expected: FAIL with `ImportError: cannot import name 'build_waterfall'`

- [ ] **Step 3: Implement the tree builder and `build_waterfall`**

Append to `apps/api/services/perf_analysis.py`:

```python
from apps.api.models.schema_parts.perf_analysis import (
    CollapsedNode,
    RequestWaterfall,
    SpanNode,
)

WATERFALL_SPAN_CAP = 2000
SYNTHETIC_ROOT_ID = "__synthetic_root__"


def _start_ms(span: Span) -> float:
    duration = span.total_ms or 0.0
    return span.end_time.timestamp() * 1000.0 - duration


def _build_tree(spans: list[Span]) -> tuple[Span, bool]:
    """Return (root, partial). Orphans attach to a synthetic root."""
    by_id = {span.id: span for span in spans}
    roots: list[Span] = []
    partial = any(span.partial for span in spans)

    for span in spans:
        if span.parent_id is None:
            roots.append(span)
            continue
        parent = by_id.get(span.parent_id)
        if parent is None:
            span.orphaned = True
            partial = True
            roots.append(span)
            continue
        parent.children.append(span)

    if not roots:
        # Every span claims a parent that exists -- only possible with a cycle.
        # Treat them all as roots rather than returning nothing.
        roots = list(spans)

    if len(roots) == 1 and not roots[0].orphaned:
        root = roots[0]
    else:
        root = Span(
            id=SYNTHETIC_ROOT_ID,
            parent_id=None,
            operation="(request)",
            scope="system",
            status="success",
            total_ms=max((span.total_ms or 0.0) for span in roots),
            end_time=max(span.end_time for span in roots),
        )
        root.children = roots
        partial = partial or len(roots) > 1

    for span in spans:
        span.children.sort(key=lambda child: (_start_ms(child), child.order))
    root.children.sort(key=lambda child: (_start_ms(child), child.order))
    return root, partial


def _assign_self_ms(span: Span) -> None:
    for child in span.children:
        _assign_self_ms(child)
    if span.total_ms is None:
        span.self_ms = None
        return
    children_total = sum(child.total_ms or 0.0 for child in span.children)
    span.self_ms = round(max(0.0, span.total_ms - children_total), 1)


def _assign_offsets(span: Span, root_start_ms: float, parent_span: Span | None) -> None:
    raw_offset = _start_ms(span) - root_start_ms
    parent_limit = (parent_span.total_ms or 0.0) if parent_span else (span.total_ms or 0.0)
    parent_offset = parent_span.offset_ms if parent_span else 0.0
    clamped = max(parent_offset, min(raw_offset, parent_offset + parent_limit))
    span.clock_skew = abs(clamped - raw_offset) > EPSILON_MS
    span.offset_ms = round(max(0.0, clamped), 1)
    for child in span.children:
        _assign_offsets(child, root_start_ms, span)


def _to_node(span: Span) -> SpanNode:
    node = SpanNode(
        id=span.id,
        parent_id=span.parent_id,
        operation=span.operation,
        scope=span.scope,
        status=span.status,
        total_ms=span.total_ms,
        self_ms=span.self_ms,
        offset_ms=span.offset_ms,
        clock_skew=span.clock_skew,
        orphaned=span.orphaned,
        ticker=span.ticker,
        table=span.table,
        component=span.component,
        rows=span.rows,
        bytes=span.bytes,
        series_points=span.series_points,
        cache_state=span.cache_state,
        children=[_to_node(child) for child in span.children],
    )
    # The collapsed marker lives in the DTO so the UI cannot render an elided
    # subtree as "no children" (spec 04.10).
    if span.collapsed is not None:
        count, total_ms, scope = span.collapsed
        node.children.append(
            CollapsedNode(collapsed_count=count, total_ms=total_ms, deepest_scope=scope)
        )
    return node


def _depth_map(span: Span, depth: int, acc: list[tuple[int, Span]]) -> None:
    acc.append((depth, span))
    for child in span.children:
        _depth_map(child, depth + 1, acc)


def _truncate(root: Span, cap: int) -> bool:
    """Collapse deepest leaf-sibling groups until the tree fits under cap.

    Detail deep in the tree is the least informative at a glance, so it goes
    first. Each collapsed group leaves exactly one marker behind.
    """
    nodes: list[tuple[int, Span]] = []
    _depth_map(root, 0, nodes)
    if len(nodes) <= cap:
        return False

    remaining = len(nodes)
    for _, span in sorted(nodes, key=lambda pair: pair[0], reverse=True):
        if remaining <= cap:
            break
        leaf_children = [child for child in span.children if not child.children]
        if len(leaf_children) < 2:
            continue
        keep_count = max(0, len(leaf_children) - (remaining - cap))
        drop = leaf_children[keep_count:]
        if not drop:
            continue
        dropped = set(id(child) for child in drop)
        span.children = [child for child in span.children if id(child) not in dropped]
        span.collapsed = (
            len(drop),
            round(sum(child.total_ms or 0.0 for child in drop), 1),
            drop[0].scope,
        )
        remaining -= len(drop)
    return True


def build_waterfall(events: list[PerformanceEvent], request_id: str) -> RequestWaterfall:
    spans = normalize_spans(events)
    if not spans:
        return RequestWaterfall(
            request_id=request_id,
            route=None,
            total_ms=None,
            span_count=0,
            root=SpanNode(id=SYNTHETIC_ROOT_ID, operation="(no spans)", scope="system", status="success"),
        )

    root, partial = _build_tree(spans)
    _assign_self_ms(root)
    _assign_offsets(root, _start_ms(root), None)
    truncated = _truncate(root, WATERFALL_SPAN_CAP)
    node = _to_node(root)   # _to_node emits CollapsedNode markers from span.collapsed
    route = next((span.operation for span in spans if span.scope == "api"), None)
    return RequestWaterfall(
        request_id=request_id,
        route=next((event.route for event in events if event.route), route),
        total_ms=root.total_ms,
        span_count=len(spans),
        partial=partial,
        truncated=truncated,
        root=node,
    )
```

`Span.collapsed` was already declared in Task 5's dataclass — `_truncate` writes to it and `_to_node` reads it. No further dataclass change is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_analysis.py -v`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/perf_analysis.py tests/api/test_perf_analysis.py
git commit -m "feat: build_waterfall with self-time, orphan/partial handling, and truncation (spec 04.1, 04.9, 04.10)"
```

---

## Task 7: `list_requests` and `breakdown_by_scope`

Implements spec §04.5.1, §04.7.

**Files:**
- Modify: `apps/api/services/perf_analysis.py`
- Test: `tests/api/test_perf_analysis.py`

**Interfaces:**
- Consumes: `normalize_spans`, `_build_tree`, `_assign_self_ms` from Tasks 5–6.
- Produces:
  - `list_requests(events: list[PerformanceEvent], limit: int, buffer_limit: int) -> RequestIndex`
  - `breakdown_by_scope(events: list[PerformanceEvent]) -> ScopeBreakdown`

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_perf_analysis.py`:

```python
from apps.api.services.perf_analysis import breakdown_by_scope, list_requests


def test_breakdown_uses_self_time_and_conserves_total():
    events = [
        ev("root", scope="api", id="r", ms=100.0),
        ev("calc", scope="calculation", id="c", parent="r", ms=60.0),
        ev("query", scope="db", id="d", parent="c", ms=25.0),
    ]
    breakdown = breakdown_by_scope(events)
    by_scope = {row.scope: row.self_ms for row in breakdown.scopes}
    assert by_scope["api"] == 40.0
    assert by_scope["calculation"] == 35.0
    assert by_scope["db"] == 25.0
    assert sum(by_scope.values()) + breakdown.unattributed_ms == 100.0
    assert sum(row.pct_of_total for row in breakdown.scopes) <= 100.0


def test_overlapping_siblings_set_overlap_detected_and_clamp_to_zero():
    events = [
        ev("root", scope="api", id="r", ms=100.0),
        ev("a", scope="db", id="a", parent="r", ms=80.0),
        ev("b", scope="db", id="b", parent="r", ms=80.0),
    ]
    breakdown = breakdown_by_scope(events)
    assert breakdown.overlap_detected is True
    assert breakdown.unattributed_ms == 0.0


def test_rounding_noise_does_not_set_overlap_detected():
    events = [
        ev("root", scope="api", id="r", ms=100.0),
        ev("a", scope="db", id="a", parent="r", ms=100.4),
    ]
    breakdown = breakdown_by_scope(events)
    assert breakdown.overlap_detected is False
    assert breakdown.unattributed_ms == 0.0


def test_list_requests_reports_buffer_occupancy():
    events = [
        ev("api.request_complete", scope="api", id="r1", ms=100.0, request_id="req-a"),
        ev("ticker.metrics", id="t1", parent="r1", ms=10.0, ticker="AAPL", request_id="req-a"),
        ev("api.request_complete", scope="api", id="r2", ms=50.0, request_id="req-b"),
    ]
    index = list_requests(events, limit=10, buffer_limit=20_000)
    assert index.buffer_used == 3
    assert index.buffer_limit == 20_000
    assert {row.request_id for row in index.requests} == {"req-a", "req-b"}
    row_a = next(row for row in index.requests if row.request_id == "req-a")
    assert row_a.ticker_count == 1
    assert row_a.span_count == 2


def test_empty_input_returns_valid_dtos():
    assert breakdown_by_scope([]).total_ms == 0.0
    index = list_requests([], limit=10, buffer_limit=100)
    assert index.requests == []
    assert index.buffer_used == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_perf_analysis.py -k "breakdown or list_requests or rounding" -v`
Expected: FAIL with `ImportError: cannot import name 'breakdown_by_scope'`

- [ ] **Step 3: Implement both functions**

Append to `apps/api/services/perf_analysis.py`:

```python
from apps.api.models.schema_parts.perf_analysis import (
    RequestIndex,
    RequestSummaryRow,
    ScopeBreakdown,
    ScopeRow,
)


def _spans_with_self_ms(events: list[PerformanceEvent]) -> tuple[list[Span], Span | None]:
    spans = normalize_spans(events)
    if not spans:
        return [], None
    root, _ = _build_tree(spans)
    _assign_self_ms(root)
    return spans, root


def breakdown_by_scope(events: list[PerformanceEvent]) -> ScopeBreakdown:
    spans, root = _spans_with_self_ms(events)
    if root is None:
        return ScopeBreakdown()

    totals: dict[str, list[float]] = {}
    counts: dict[str, int] = {}
    slow_counts: dict[str, int] = {}
    for span in spans:
        totals.setdefault(span.scope, []).append(span.self_ms or 0.0)
        counts[span.scope] = counts.get(span.scope, 0) + 1
        if span.status == "slow":
            slow_counts[span.scope] = slow_counts.get(span.scope, 0) + 1

    root_total = root.total_ms or 0.0
    sum_self = sum(sum(values) for values in totals.values())
    raw_unattributed = root_total - sum_self
    overlap_detected = raw_unattributed < -EPSILON_MS
    unattributed = round(max(0.0, raw_unattributed), 1)

    rows = [
        ScopeRow(
            scope=scope,
            self_ms=round(sum(values), 1),
            pct_of_total=round((sum(values) / root_total * 100.0), 1) if root_total else 0.0,
            event_count=counts.get(scope, 0),
            slow_count=slow_counts.get(scope, 0),
        )
        for scope, values in totals.items()
    ]
    rows.sort(key=lambda row: row.self_ms, reverse=True)
    return ScopeBreakdown(
        scopes=rows,
        total_ms=round(root_total, 1),
        unattributed_ms=unattributed,
        overlap_detected=overlap_detected,
    )


def list_requests(events: list[PerformanceEvent], limit: int, buffer_limit: int) -> RequestIndex:
    grouped: dict[str, list[PerformanceEvent]] = {}
    for event in events:
        if event.request_id:
            grouped.setdefault(event.request_id, []).append(event)

    rows: list[RequestSummaryRow] = []
    for request_id, request_events in grouped.items():
        spans = normalize_spans(request_events)
        root_span = next((span for span in spans if span.parent_id is None), None)
        api_event = next(
            (event for event in request_events if event.scope == "api" and event.duration_ms is not None),
            None,
        )
        rows.append(
            RequestSummaryRow(
                request_id=request_id,
                route=next((event.route for event in request_events if event.route), None),
                method=next((event.method for event in request_events if event.method), None),
                started_at=min(event.timestamp for event in request_events),
                ended_at=max(event.timestamp for event in request_events),
                total_ms=(api_event.duration_ms if api_event else (root_span.total_ms if root_span else None)),
                span_count=len(spans),
                ticker_count=len({event.ticker for event in request_events if event.ticker}),
                status=(api_event.status if api_event else "unknown"),
                partial=any(span.partial for span in spans),
            )
        )

    rows.sort(key=lambda row: row.started_at, reverse=True)
    return RequestIndex(
        requests=rows[:limit],
        limit=limit,
        buffer_used=len(events),
        buffer_limit=buffer_limit,
    )
```

Note on the synthetic root: when `_build_tree` fabricates one (multiple roots or an orphan), it is not a member of `spans`, so its time is never counted in the scope totals — only real spans contribute. When the root *is* a real span, its own `self_ms` is included, which is correct: `root.self_ms + sum(children self) == root.total_ms`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_analysis.py -v`
Expected: PASS (18 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/perf_analysis.py tests/api/test_perf_analysis.py
git commit -m "feat: list_requests and breakdown_by_scope with unattributed time (spec 04.5.1, 04.7)"
```

---

## Task 8: `rollup_by_ticker` and `cache_effectiveness`

Implements spec §04.8, §04.11.

**Files:**
- Modify: `apps/api/services/perf_analysis.py`
- Test: `tests/api/test_perf_analysis.py`

**Interfaces:**
- Produces:
  - `rollup_by_ticker(events: list[PerformanceEvent]) -> TickerCostTable`
  - `cache_effectiveness(events: list[PerformanceEvent]) -> CacheReport`

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_perf_analysis.py`:

```python
from apps.api.services.perf_analysis import cache_effectiveness, rollup_by_ticker


def _ticker_events(costs: dict[str, float]) -> list[PerformanceEvent]:
    events = [ev("api.request_complete", scope="api", id="r", ms=sum(costs.values()) + 10.0)]
    for index, (ticker, cost) in enumerate(costs.items()):
        events.append(
            ev(f"ticker.metrics-{index}", id=f"t{index}", parent="r", ms=cost, ticker=ticker, rows=1)
        )
    return events


def test_uniform_distribution_classification():
    table = rollup_by_ticker(_ticker_events({f"T{i}": 20.0 for i in range(10)}))
    assert table.cv < 0.15
    assert table.distribution == "uniform"
    assert table.ticker_count == 10


def test_skewed_distribution_classification():
    costs = {f"T{i}": 5.0 for i in range(10)}
    costs["OUTLIER"] = 400.0
    table = rollup_by_ticker(_ticker_events(costs))
    assert table.cv > 0.5
    assert table.distribution == "skewed"


def test_mixed_distribution_classification():
    costs = {f"T{i}": 10.0 + (i * 4.0) for i in range(10)}
    table = rollup_by_ticker(_ticker_events(costs))
    assert 0.15 <= table.cv <= 0.5
    assert table.distribution == "mixed"


def test_single_ticker_and_zero_mean_are_uniform():
    assert rollup_by_ticker(_ticker_events({"ONLY": 10.0})).distribution == "uniform"
    assert rollup_by_ticker(_ticker_events({"A": 0.0, "B": 0.0})).cv == 0.0
    assert rollup_by_ticker([]).distribution == "uniform"


def test_rollup_splits_self_time_by_scope_and_sums_rows():
    events = [
        ev("api.request_complete", scope="api", id="r", ms=100.0),
        ev("ticker.metrics", scope="calculation", id="c", parent="r", ms=30.0, ticker="AAPL", rows=1),
        ev("db.select", scope="db", id="d", parent="c", ms=12.0, ticker="AAPL", rows=862),
    ]
    table = rollup_by_ticker(events)
    row = next(row for row in table.rows if row.ticker == "AAPL")
    assert row.calculation_ms == 18.0
    assert row.db_ms == 12.0
    assert row.rows_read == 863
    assert row.span_count == 2


def test_cache_effectiveness_formula():
    events = [
        ev("cache.get", scope="cache", id="h1", ms=1.0, status="cache_hit", component="attr"),
        ev("cache.get", scope="cache", id="h2", ms=1.0, status="cache_hit", component="attr"),
        ev("cache.get", scope="cache", id="m1", ms=400.0, status="cache_miss", component="attr"),
        ev("cache.get", scope="cache", id="m2", ms=200.0, status="cache_miss", component="attr"),
    ]
    report = cache_effectiveness(events)
    row = report.caches[0]
    assert row.hits == 2
    assert row.misses == 2
    assert row.hit_rate == 0.5
    assert row.avg_miss_cost_ms == 300.0
    assert row.estimated_time_saved_ms == 600.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_perf_analysis.py -k "distribution or rollup or cache_effectiveness" -v`
Expected: FAIL with `ImportError: cannot import name 'rollup_by_ticker'`

- [ ] **Step 3: Implement both functions**

Append to `apps/api/services/perf_analysis.py`:

```python
import statistics

from apps.api.models.schema_parts.perf_analysis import (
    CacheReport,
    CacheRow,
    TickerCostRow,
    TickerCostTable,
)

CV_UNIFORM_MAX = 0.15
CV_SKEWED_MIN = 0.5


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * fraction) - 1))
    return round(ordered[index], 1)


def _classify(cv: float) -> str:
    if cv < CV_UNIFORM_MAX:
        return "uniform"
    if cv > CV_SKEWED_MIN:
        return "skewed"
    return "mixed"


def rollup_by_ticker(events: list[PerformanceEvent]) -> TickerCostTable:
    spans, root = _spans_with_self_ms(events)
    if root is None:
        return TickerCostTable()

    accumulator: dict[str, TickerCostRow] = {}
    for span in spans:
        if not span.ticker:
            continue
        row = accumulator.setdefault(span.ticker, TickerCostRow(ticker=span.ticker, self_ms=0.0, span_count=0))
        self_ms = span.self_ms or 0.0
        row.self_ms = round(row.self_ms + self_ms, 1)
        row.span_count += 1
        if span.scope == "db":
            row.db_ms = round(row.db_ms + self_ms, 1)
        elif span.scope == "calculation":
            row.calculation_ms = round(row.calculation_ms + self_ms, 1)
        elif span.scope == "external":
            row.external_ms = round(row.external_ms + self_ms, 1)
        if span.cache_state == "hit":
            row.cache_hits += 1
        elif span.cache_state == "miss":
            row.cache_misses += 1
        row.rows_read += span.rows or 0
        if span.bytes is not None:
            row.bytes = (row.bytes or 0) + span.bytes
        if span.series_points is not None:
            row.series_points = (row.series_points or 0) + span.series_points

    rows = sorted(accumulator.values(), key=lambda row: row.self_ms, reverse=True)
    costs = [row.self_ms for row in rows]
    mean_cost = statistics.fmean(costs) if costs else 0.0
    cv = (
        round(statistics.stdev(costs) / mean_cost, 4)
        if len(costs) > 1 and mean_cost > 0
        else 0.0
    )
    return TickerCostTable(
        rows=rows,
        ticker_count=len(rows),
        total_self_ms=round(sum(costs), 1),
        p50_ms=_percentile(costs, 0.5),
        p95_ms=_percentile(costs, 0.95),
        max_ms=round(max(costs), 1) if costs else 0.0,
        cv=cv,
        distribution=_classify(cv),
    )


def cache_effectiveness(events: list[PerformanceEvent]) -> CacheReport:
    hits: dict[str, int] = {}
    miss_costs: dict[str, list[float]] = {}
    for event in events:
        if event.scope != "cache":
            continue
        component = event.component or "unknown"
        if event.status == "cache_hit":
            hits[component] = hits.get(component, 0) + 1
        elif event.status == "cache_miss":
            miss_costs.setdefault(component, []).append(event.duration_ms or 0.0)

    rows: list[CacheRow] = []
    for component in sorted(set(hits) | set(miss_costs)):
        hit_count = hits.get(component, 0)
        misses = miss_costs.get(component, [])
        total = hit_count + len(misses)
        avg_miss = round(statistics.fmean(misses), 1) if misses else 0.0
        rows.append(
            CacheRow(
                component=component,
                hits=hit_count,
                misses=len(misses),
                hit_rate=round(hit_count / total, 4) if total else 0.0,
                avg_miss_cost_ms=avg_miss,
                estimated_time_saved_ms=round(hit_count * avg_miss, 1),
            )
        )
    return CacheReport(caches=rows)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_analysis.py -v`
Expected: PASS (24 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/perf_analysis.py tests/api/test_perf_analysis.py
git commit -m "feat: rollup_by_ticker with CV classification and cache_effectiveness (spec 04.8, 04.11)"
```

---

## Task 9: Analysis endpoints and `_filter_events`

Implements spec §05.1, §05.1.1, §05.2, §05.2.1.

**Files:**
- Modify: `apps/api/routes/dev_monitor.py`
- Test: `tests/api/test_perf_routes.py` (create)

**Interfaces:**
- Consumes: all five analysis functions, `get_dev_monitor_event_limit()`.
- Produces: five endpoints under `/api/v1/dev/performance/`.

**Filter order is fixed and load-bearing:** `request_id` → `route` → `window`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_perf_routes.py`:

```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from apps.api.core import dev_monitor
from apps.api.main import app
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent

ENDPOINTS = [
    "/api/v1/dev/performance/requests",
    "/api/v1/dev/performance/waterfall/req-1",
    "/api/v1/dev/performance/by-ticker",
    "/api/v1/dev/performance/breakdown",
    "/api/v1/dev/performance/cache",
]


def _enable(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(tmp_path))
    dev_monitor.reset_dev_monitor_sink()
    return dev_monitor.get_dev_monitor_sink()


def test_all_endpoints_404_when_disabled(monkeypatch):
    monkeypatch.delenv("MONEYVIEW_DEV_MONITOR", raising=False)
    dev_monitor.reset_dev_monitor_sink()
    with TestClient(app) as client:
        for endpoint in ENDPOINTS:
            assert client.get(endpoint).status_code == 404


def test_empty_buffer_returns_200_with_empty_dto(monkeypatch, tmp_path):
    _enable(monkeypatch, tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/v1/dev/performance/by-ticker")
    assert response.status_code == 200
    assert response.json()["data"]["rows"] == []


def test_unknown_request_id_returns_404(monkeypatch, tmp_path):
    _enable(monkeypatch, tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/v1/dev/performance/waterfall/no-such-id").status_code == 404


def test_parameter_bounds_are_enforced(monkeypatch, tmp_path):
    _enable(monkeypatch, tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/v1/dev/performance/requests?limit=0").status_code == 422
        assert client.get("/api/v1/dev/performance/requests?limit=201").status_code == 422
        assert client.get("/api/v1/dev/performance/by-ticker?window=0").status_code == 422
        assert client.get("/api/v1/dev/performance/by-ticker?window=3601").status_code == 422


def test_requests_endpoint_reports_buffer_occupancy(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_EVENT_LIMIT", "1234")
    sink = _enable(monkeypatch, tmp_path)
    sink.emit(
        PerformanceEvent(
            request_id="req-1", level="info", scope="api",
            operation="api.request_complete", status="success", duration_ms=5.0,
        )
    )
    with TestClient(app) as client:
        payload = client.get("/api/v1/dev/performance/requests").json()["data"]
    assert payload["buffer_limit"] == 1234
    assert payload["buffer_used"] >= 1


def test_filter_order_window_excludes_named_old_request(monkeypatch, tmp_path):
    """window is applied after request_id, so an old named request is excluded."""
    from apps.api.routes.dev_monitor import _filter_events

    old = PerformanceEvent(
        request_id="req-old", level="info", scope="api", operation="api.request_complete",
        status="success", duration_ms=5.0,
        timestamp=datetime.now(timezone.utc) - timedelta(seconds=600),
    )
    assert _filter_events([old], request_id="req-old", route=None, window=None) == [old]
    assert _filter_events([old], request_id="req-old", route=None, window=60) == []


def test_waterfall_ignores_age(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    sink.emit(
        PerformanceEvent(
            request_id="req-old", level="info", scope="api",
            operation="api.request_complete", status="success", duration_ms=5.0,
            timestamp=datetime.now(timezone.utc) - timedelta(seconds=6000),
        )
    )
    with TestClient(app) as client:
        assert client.get("/api/v1/dev/performance/waterfall/req-old").status_code == 200


def test_existing_endpoints_unchanged(monkeypatch, tmp_path):
    _enable(monkeypatch, tmp_path)
    with TestClient(app) as client:
        for endpoint in ["recent", "slow", "errors", "summary"]:
            assert client.get(f"/api/v1/dev/performance/{endpoint}").status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_perf_routes.py -v`
Expected: FAIL — 404s on the new endpoints because they do not exist yet

- [ ] **Step 3: Implement `_filter_events` and the five endpoints**

Add to `apps/api/routes/dev_monitor.py`:

```python
from datetime import timedelta

from apps.api.core.dev_monitor import get_dev_monitor_event_limit
from apps.api.models.schema_parts.perf_analysis import (
    CacheReport,
    RequestIndex,
    RequestWaterfall,
    ScopeBreakdown,
    TickerCostTable,
)
from apps.api.services.perf_analysis import (
    breakdown_by_scope,
    build_waterfall,
    cache_effectiveness,
    list_requests,
    rollup_by_ticker,
)


def _filter_events(
    events: list[PerformanceEvent],
    *,
    request_id: str | None = None,
    route: str | None = None,
    window: int | None = None,
) -> list[PerformanceEvent]:
    """Apply filters in the documented order: request_id, then route, then window.

    The order is observable: window is time-relative, so a specific request older
    than the window is excluded rather than overriding it (spec 05.2.1).
    """
    filtered = events
    if request_id is not None:
        filtered = [event for event in filtered if event.request_id == request_id]
    if route is not None:
        filtered = [event for event in filtered if event.route == route]
    if window is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=window)
        filtered = [event for event in filtered if event.timestamp >= cutoff]
    return filtered


def _buffer_events() -> list[PerformanceEvent]:
    return get_dev_monitor_sink().recent(limit=get_dev_monitor_event_limit())


@router.get("/performance/requests", response_model=APIResponse[RequestIndex])
async def get_performance_requests(limit: int = Query(default=50, ge=1, le=200)):
    _require_dev_monitor()
    events = _buffer_events()
    data = list_requests(events, limit=limit, buffer_limit=get_dev_monitor_event_limit())
    return APIResponse(data=data, meta=_response_meta())


@router.get("/performance/waterfall/{request_id}", response_model=APIResponse[RequestWaterfall])
async def get_performance_waterfall(request_id: str):
    _require_dev_monitor()
    scoped = _filter_events(_buffer_events(), request_id=request_id)
    if not scoped:
        raise HTTPException(status_code=404, detail=f"unknown request_id: {request_id}")
    return APIResponse(data=build_waterfall(scoped, request_id), meta=_response_meta())


@router.get("/performance/by-ticker", response_model=APIResponse[TickerCostTable])
async def get_performance_by_ticker(
    request_id: str | None = Query(default=None),
    route: str | None = Query(default=None),
    window: int = Query(default=300, ge=1, le=3600),
):
    _require_dev_monitor()
    scoped = _filter_events(_buffer_events(), request_id=request_id, route=route, window=window)
    return APIResponse(data=rollup_by_ticker(scoped), meta=_response_meta())


@router.get("/performance/breakdown", response_model=APIResponse[ScopeBreakdown])
async def get_performance_breakdown(request_id: str | None = Query(default=None)):
    _require_dev_monitor()
    scoped = _filter_events(_buffer_events(), request_id=request_id)
    return APIResponse(data=breakdown_by_scope(scoped), meta=_response_meta())


@router.get("/performance/cache", response_model=APIResponse[CacheReport])
async def get_performance_cache(window: int = Query(default=300, ge=1, le=3600)):
    _require_dev_monitor()
    scoped = _filter_events(_buffer_events(), window=window)
    return APIResponse(data=cache_effectiveness(scoped), meta=_response_meta())
```

Note: `/performance/waterfall/{request_id}` intentionally accepts no `window` — inspecting a named request must never depend on how long ago it ran.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_routes.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the full API suite**

Run: `python -m pytest tests/api -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/routes/dev_monitor.py tests/api/test_perf_routes.py
git commit -m "feat: five performance analysis endpoints with documented filter order (spec 05)"
```

---

## Task 10: Instrument the comparison fan-out

Implements spec §03.5, §03.5.1. **Requires Task 1 (buffered sink) to be merged.**

**Files:**
- Modify: `apps/api/routes/corporate.py:79-98` (both loaders)
- Modify: `apps/api/services/corporate_comparison.py:46` (`build_corporate_comparison_response`)
- Test: `tests/api/test_perf_capture.py`

**Interfaces:**
- Consumes: `perf_timer` from Task 3.
- Produces spans: `ticker.metrics` (scope `calculation`, metadata `rows`), `ticker.price` (scope `calculation`, metadata `cache_state`), `fanout.comparison` (scope `calculation`, `emit_start=True`, metadata `fanout_size`).

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_perf_capture.py`:

```python
def test_comparison_fanout_emits_per_ticker_spans(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)
    with TestClient(app) as client:
        client.get("/api/v1/corporate/comparison?mode=live")
    events = sink.recent(limit=20_000)
    fanout = [event for event in events if event.operation == "fanout.comparison"]
    metrics_spans = [event for event in events if event.operation == "ticker.metrics"]
    assert fanout, "fanout.comparison span missing"
    assert metrics_spans, "no per-ticker metrics spans emitted"
    assert all(span.ticker for span in metrics_spans)
    terminal = next(event for event in fanout if event.duration_ms is not None)
    assert isinstance(terminal.metadata.get("fanout_size"), int)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_perf_capture.py -k comparison_fanout -v`
Expected: FAIL with `AssertionError: fanout.comparison span missing`

- [ ] **Step 3: Wrap the two loaders**

In `apps/api/routes/corporate.py`, add the import:

```python
from apps.api.core.dev_monitor import perf_timer
```

Replace `_metrics_for_ticker` (line 79) with:

```python
def _metrics_for_ticker(
    ticker: str,
    growth_basis: str = "cagr",
    roic_basis: str = "recent_average",
    growth_year: Optional[int] = None,
    roic_year: Optional[int] = None,
) -> CorporateMetrics:
    with perf_timer(scope="calculation", operation="ticker.metrics", ticker=ticker) as span_metadata:
        metrics = corporate_metrics_service.metrics_for_ticker(
            ticker,
            growth_basis=growth_basis,
            roic_basis=roic_basis,
            growth_year=growth_year,
            roic_year=roic_year,
        )
        span_metadata["rows"] = 1
        return metrics
```

Replace `_latest_market_price` (line 96) with:

```python
def _latest_market_price(ticker: str) -> float:
    with perf_timer(scope="calculation", operation="ticker.price", ticker=ticker) as span_metadata:
        price = corporate_metrics_service.latest_market_price(ticker)
        span_metadata["cache_state"] = "n/a"
        return price
```

Keep the exact original call arguments. If the original `_metrics_for_ticker` body passes additional keyword arguments beyond those five, preserve them verbatim — this wrap must not change behavior.

- [ ] **Step 4: Wrap the fan-out**

In `apps/api/services/corporate_comparison.py`, add the import:

```python
from apps.api.core.dev_monitor import perf_timer
```

In `_build_comparison_rows` (the function containing the loop at line 287), wrap the loop:

```python
    rows: list[CorporateComparisonRow] = []
    with perf_timer(
        scope="calculation",
        operation="fanout.comparison",
        emit_start=True,
    ) as span_metadata:
        span_metadata["fanout_size"] = len(universe_rows)
        for row in universe_rows:
            ticker = str(row["ticker"] or "").upper().strip()
            if not ticker:
                continue
            metrics = metrics_loader(ticker)
            dcf = _dcf_snapshot(
                ticker=ticker,
                metrics=metrics,
                price_loader=price_loader,
                risk_free_rate=risk_free_rate,
                equity_risk_premium=equity_risk_premium,
            )
            rows.append(
                CorporateComparisonRow(...)   # keep the existing construction verbatim
            )
    return rows
```

Only the indentation and the two `with`/`span_metadata` lines change. The loop body is untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_capture.py -k comparison_fanout -v`
Expected: PASS

- [ ] **Step 6: Verify no behavior changed**

Run: `python -m pytest tests/api/test_corporate_comparison.py tests/api/test_corporate_metric_audit.py -v`
Expected: PASS — comparison output must be byte-identical to before instrumentation.

- [ ] **Step 7: Commit**

```bash
git add apps/api/routes/corporate.py apps/api/services/corporate_comparison.py tests/api/test_perf_capture.py
git commit -m "feat: per-ticker and fan-out spans on the comparison path (spec 03.5.1)"
```

---

## Task 11: Instrument the attribution fan-out

Implements spec §03.5. **Requires Task 1.**

**Files:**
- Modify: `apps/api/services/portfolio/data_provider.py:51` (`load_close_series`)
- Modify: `apps/api/services/portfolio/portfolio_service.py:55-72` (`build_attribution`)
- Test: `tests/api/test_perf_capture.py`

**Interfaces:**
- Produces spans: `ticker.series` (scope `db`, metadata `series_points`, `bytes`), `fanout.attribution` (scope `calculation`, `emit_start=True`, metadata `fanout_size`).

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_perf_capture.py`:

```python
def test_attribution_fanout_emits_series_spans(monkeypatch, tmp_path):
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
    with TestClient(app) as client:
        client.post("/api/v1/portfolio/attribution", json=payload)
    events = sink.recent(limit=20_000)
    assert any(event.operation == "fanout.attribution" for event in events)
    series = [event for event in events if event.operation == "ticker.series"]
    assert series, "no ticker.series spans emitted"
    terminal = next(event for event in series if event.duration_ms is not None)
    assert isinstance(terminal.metadata.get("series_points"), int)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_perf_capture.py -k attribution_fanout -v`
Expected: FAIL with `AssertionError: no ticker.series spans emitted`

- [ ] **Step 3: Wrap `load_close_series`**

In `apps/api/services/portfolio/data_provider.py`, add the import:

```python
from apps.api.core.dev_monitor import perf_timer
```

Wrap the method body (line 51). Keep the existing body verbatim inside the `with`, then annotate before returning:

```python
    def load_close_series(
        self,
        ticker: str,
        period: PeriodEnum,
        date_from: date | None = None,
        as_of_date: date | None = None,
    ) -> np.ndarray:
        with perf_timer(scope="db", operation="ticker.series", ticker=ticker) as span_metadata:
            # ... existing body unchanged, producing `series` ...
            span_metadata["series_points"] = int(series.size)
            span_metadata["bytes"] = int(series.nbytes)
            return series
```

If the existing body has multiple `return` statements, annotate before each, or assign to a local `series` and return once at the end. Do not change what is returned.

- [ ] **Step 4: Wrap the attribution fan-out**

In `apps/api/services/portfolio/portfolio_service.py`, add the import and wrap the ticker loop inside `build_attribution` (line 72):

```python
from apps.api.core.dev_monitor import perf_timer

# inside build_attribution, around the `for ticker in tickers:` loop:
        with perf_timer(
            scope="calculation",
            operation="fanout.attribution",
            emit_start=True,
        ) as span_metadata:
            span_metadata["fanout_size"] = len(tickers)
            for ticker in tickers:
                ...   # existing loop body verbatim, only re-indented
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_perf_capture.py -k attribution_fanout -v`
Expected: PASS

- [ ] **Step 6: Verify attribution output unchanged**

Run: `python -m pytest tests/api/test_portfolio_attribution.py tests/api/compute -v`
Expected: PASS — attribution results and the compute-seam parity tripwire must both still hold.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/portfolio/data_provider.py apps/api/services/portfolio/portfolio_service.py tests/api/test_perf_capture.py
git commit -m "feat: series and fan-out spans on the attribution path (spec 03.5)"
```

---

## Task 12: Frontend client, dashboard, and tests

Implements spec §05.3, §06, §07.4, §07.4.1.

**Files:**
- Modify: `apps/web/lib/api.ts` (response bytes)
- Modify: `apps/web/lib/devMonitor.ts` (types + fetchers)
- Create: `apps/web/app/dev/performance/SpanWaterfall.tsx`
- Create: `apps/web/app/dev/performance/page.tsx`
- Create: `apps/web/tests/perf-dashboard.spec.ts`

**Interfaces:**
- Consumes: the five endpoints from Task 9.
- Produces: `/dev/performance` route.

**Rule:** none of the new fetchers pass `monitor:` to `fetchApi` — instrumenting the dashboard's own requests would pollute the buffer it analyzes.

- [ ] **Step 1: Add response bytes to the client monitor**

In `apps/web/lib/api.ts`, inside the success branch that builds the monitor metadata (around line 277), add the content-length read just before `emitClientPerformanceEvent`:

```typescript
    const rawLength = response.headers.get("content-length");
    const responseBytes = rawLength === null ? null : Number.parseInt(rawLength, 10);
```

and extend the metadata object:

```typescript
      metadata: {
        endpoint,
        status_code: response.status,
        bytes: Number.isFinite(responseBytes as number) ? responseBytes : null,
        ...(monitor.metadata ?? {}),
      },
```

- [ ] **Step 2: Add client types and fetchers**

Append to `apps/web/lib/devMonitor.ts`:

```typescript
export interface CollapsedNode {
  collapsed_count: number;
  total_ms: number;
  deepest_scope: string;
}

export interface SpanNode {
  id: string;
  parent_id: string | null;
  operation: string;
  scope: string;
  status: string;
  total_ms: number | null;
  self_ms: number | null;
  offset_ms: number;
  clock_skew: boolean;
  orphaned: boolean;
  ticker: string | null;
  table: string | null;
  component: string | null;
  rows: number | null;
  bytes: number | null;
  series_points: number | null;
  cache_state: string | null;
  children: Array<SpanNode | CollapsedNode>;
}

export function isCollapsedNode(node: SpanNode | CollapsedNode): node is CollapsedNode {
  return "collapsed_count" in node;
}

export interface RequestSummaryRow {
  request_id: string;
  route: string | null;
  method: string | null;
  started_at: string;
  ended_at: string | null;
  total_ms: number | null;
  span_count: number;
  ticker_count: number;
  status: string;
  partial: boolean;
}

export interface RequestIndex {
  requests: RequestSummaryRow[];
  limit: number;
  buffer_used: number;
  buffer_limit: number;
}

export interface RequestWaterfall {
  request_id: string;
  route: string | null;
  total_ms: number | null;
  span_count: number;
  partial: boolean;
  truncated: boolean;
  root: SpanNode;
}

export interface TickerCostRow {
  ticker: string;
  self_ms: number;
  span_count: number;
  db_ms: number;
  calculation_ms: number;
  external_ms: number;
  cache_hits: number;
  cache_misses: number;
  rows_read: number;
  bytes: number | null;
  series_points: number | null;
}

export interface TickerCostTable {
  rows: TickerCostRow[];
  ticker_count: number;
  total_self_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  cv: number;
  distribution: "uniform" | "mixed" | "skewed";
}

export interface ScopeRow {
  scope: string;
  self_ms: number;
  pct_of_total: number;
  event_count: number;
  slow_count: number;
}

export interface ScopeBreakdown {
  scopes: ScopeRow[];
  total_ms: number;
  unattributed_ms: number;
  overlap_detected: boolean;
}

export interface CacheRow {
  component: string;
  hits: number;
  misses: number;
  hit_rate: number;
  avg_miss_cost_ms: number;
  estimated_time_saved_ms: number;
}

export interface CacheReport {
  caches: CacheRow[];
}

// No `monitor:` option on any of these -- the analysis surface must not
// inject events into the buffer it is analysing.
export async function fetchPerformanceRequests(limit = 50) {
  return fetchApi<RequestIndex>("/dev/performance/requests", { params: { limit } });
}

export async function fetchPerformanceWaterfall(requestId: string) {
  return fetchApi<RequestWaterfall>(`/dev/performance/waterfall/${requestId}`);
}

export async function fetchPerformanceByTicker(options: {
  requestId?: string;
  route?: string;
  window?: number;
} = {}) {
  const params: Record<string, string | number> = {};
  if (options.requestId) params.request_id = options.requestId;
  if (options.route) params.route = options.route;
  if (options.window) params.window = options.window;
  return fetchApi<TickerCostTable>("/dev/performance/by-ticker", { params });
}

export async function fetchPerformanceBreakdown(requestId?: string) {
  const params: Record<string, string | number> = {};
  if (requestId) params.request_id = requestId;
  return fetchApi<ScopeBreakdown>("/dev/performance/breakdown", { params });
}

export async function fetchPerformanceCache(window = 300) {
  return fetchApi<CacheReport>("/dev/performance/cache", { params: { window } });
}
```

Confirm `fetchApi` is already imported at the top of `devMonitor.ts`; the existing fetchers use it.

- [ ] **Step 3: Create the waterfall renderer**

Create `apps/web/app/dev/performance/SpanWaterfall.tsx`:

```tsx
"use client";

import { isCollapsedNode, type CollapsedNode, type SpanNode } from "@/lib/devMonitor";

function Row({ node, rootTotalMs, depth }: { node: SpanNode; rootTotalMs: number; depth: number }) {
  const total = node.total_ms ?? 0;
  const widthPct = rootTotalMs > 0 ? Math.max(0.5, (total / rootTotalMs) * 100) : 0;
  const offsetPct = rootTotalMs > 0 ? Math.max(0, (node.offset_ms / rootTotalMs) * 100) : 0;

  return (
    <div>
      <div className="flex items-center gap-2 text-xs py-0.5">
        <span
          className="truncate text-[var(--text-primary)]"
          style={{ paddingLeft: `${depth * 12}px`, width: "300px" }}
          title={node.operation}
        >
          {node.operation}
          {node.ticker ? ` ${node.ticker}` : ""}
          {node.clock_skew ? (
            <span title="clock skew: bounds clamped to parent" className="text-[var(--text-muted)]"> ~</span>
          ) : null}
          {node.orphaned ? (
            <span title="orphaned: parent span evicted" className="text-[var(--text-muted)]"> ?</span>
          ) : null}
        </span>
        <span className="relative flex-1 h-3 bg-[var(--bg-canvas)]">
          <span
            className="absolute h-3 bg-[var(--text-muted)] opacity-60"
            style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
          />
        </span>
        <span className="tabular-nums text-[var(--text-muted)] w-20 text-right">
          {total.toFixed(1)} ms
        </span>
        <span className="tabular-nums text-[var(--text-muted)] w-20 text-right">
          self {(node.self_ms ?? 0).toFixed(1)}
        </span>
      </div>
      {node.children.map((child, index) =>
        isCollapsedNode(child) ? (
          <Collapsed key={`collapsed-${index}`} node={child} depth={depth + 1} />
        ) : (
          <Row key={child.id} node={child} rootTotalMs={rootTotalMs} depth={depth + 1} />
        )
      )}
    </div>
  );
}

function Collapsed({ node, depth }: { node: CollapsedNode; depth: number }) {
  return (
    <div
      className="text-xs py-0.5 text-[var(--text-muted)]"
      style={{ paddingLeft: `${depth * 12}px` }}
    >
      ⋯ {node.collapsed_count} spans collapsed · {node.total_ms.toFixed(1)} ms ({node.deepest_scope})
    </div>
  );
}

export function SpanWaterfall({ root, totalMs }: { root: SpanNode; totalMs: number }) {
  return <div className="font-mono">{<Row node={root} rootTotalMs={totalMs} depth={0} />}</div>;
}
```

- [ ] **Step 4: Create the dashboard page**

Create `apps/web/app/dev/performance/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { KPIBlock } from "@/components/ui/KPIBlock";
import { DenseTable } from "@/components/ui/DenseTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ActionButton } from "@/components/ui/ActionButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import {
  fetchPerformanceByTicker,
  fetchPerformanceBreakdown,
  fetchPerformanceCache,
  fetchPerformanceRequests,
  fetchPerformanceWaterfall,
} from "@/lib/devMonitor";
import { SpanWaterfall } from "./SpanWaterfall";

function isNotFoundError(error: unknown) {
  return error instanceof Error && error.message.includes("404");
}

export default function PerformanceAnalysisPage() {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  // Auto-refresh is off by default: this page inspects a specific run, and
  // background repolling would churn the ring buffer mid-analysis.
  const common = { refetchOnWindowFocus: false, refetchInterval: false as const };

  const requestsQuery = useQuery({
    queryKey: ["perf-requests"],
    queryFn: () => fetchPerformanceRequests(50),
    ...common,
  });
  const waterfallQuery = useQuery({
    queryKey: ["perf-waterfall", selectedRequestId],
    queryFn: () => fetchPerformanceWaterfall(selectedRequestId as string),
    enabled: Boolean(selectedRequestId),
    ...common,
  });
  const breakdownQuery = useQuery({
    queryKey: ["perf-breakdown", selectedRequestId],
    queryFn: () => fetchPerformanceBreakdown(selectedRequestId ?? undefined),
    ...common,
  });
  const tickerQuery = useQuery({
    queryKey: ["perf-by-ticker", selectedRequestId],
    queryFn: () => fetchPerformanceByTicker({ requestId: selectedRequestId ?? undefined }),
    ...common,
  });
  const cacheQuery = useQuery({
    queryKey: ["perf-cache"],
    queryFn: () => fetchPerformanceCache(300),
    ...common,
  });

  if (requestsQuery.isLoading) return <LoadingState />;

  if (isNotFoundError(requestsQuery.error)) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <PageHeader title="Performance Analysis" subtitle="Where time is spent" />
        <EmptyState
          title="Instrumentation disabled"
          description="Set MONEYVIEW_DEV_MONITOR=true and restart the API server."
        />
      </div>
    );
  }

  if (requestsQuery.error) {
    return <ErrorState message="Failed to load performance data." onRetry={() => requestsQuery.refetch()} />;
  }

  const index = requestsQuery.data;
  const bufferFull = Boolean(index && index.buffer_used >= index.buffer_limit);

  const refreshAll = () => {
    void requestsQuery.refetch();
    void waterfallQuery.refetch();
    void breakdownQuery.refetch();
    void tickerQuery.refetch();
    void cacheQuery.refetch();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <PageHeader title="Performance Analysis" subtitle="Where time is spent" />

      <div className="flex items-center gap-3" data-testid="buffer-status">
        <ActionButton onClick={refreshAll}>Refresh</ActionButton>
        <span className="text-xs text-[var(--text-muted)]">
          buffer {index?.buffer_used ?? 0} / {index?.buffer_limit ?? 0}
        </span>
        {bufferFull ? <StatusBadge variant="stale">buffer full — older events evicted</StatusBadge> : null}
      </div>

      {index && index.requests.length === 0 ? (
        <EmptyState
          title="No requests recorded yet"
          description="Exercise the app, then refresh."
        />
      ) : null}

      <Card>
        <SectionHeader title="Requests" />
        <DenseTable
          columns={[
            { key: "route", header: "route", render: (row) => row.route ?? "-" },
            { key: "total_ms", header: "total_ms", render: (row) => (row.total_ms ?? 0).toFixed(1) },
            { key: "span_count", header: "spans" },
            { key: "ticker_count", header: "tickers" },
            {
              key: "partial",
              header: "state",
              render: (row) =>
                row.partial ? <StatusBadge variant="stale">partial</StatusBadge> : "ok",
            },
          ]}
          rows={index?.requests ?? []}
          onRowClick={(row) => setSelectedRequestId(row.request_id)}
        />
      </Card>

      <Card>
        <SectionHeader title="Scope breakdown" />
        {breakdownQuery.data ? (
          <div className="space-y-1" data-testid="scope-breakdown">
            {breakdownQuery.data.scopes.map((scope) => (
              <div key={scope.scope} className="flex items-center gap-2 text-xs">
                <span className="w-28">{scope.scope}</span>
                <span className="tabular-nums">{scope.self_ms.toFixed(1)} ms</span>
                <span className="tabular-nums text-[var(--text-muted)]">{scope.pct_of_total}%</span>
              </div>
            ))}
            <div className="text-xs text-[var(--text-muted)]">
              unattributed {breakdownQuery.data.unattributed_ms.toFixed(1)} ms
              {breakdownQuery.data.overlap_detected
                ? " — spans overlapped (concurrent execution)"
                : ""}
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionHeader title="Waterfall" />
        {waterfallQuery.data ? (
          <>
            <div className="flex gap-2 mb-2">
              {waterfallQuery.data.partial ? (
                <StatusBadge variant="stale">partial — some spans evicted</StatusBadge>
              ) : null}
              {waterfallQuery.data.truncated ? (
                <span className="text-xs text-[var(--text-muted)]">truncated at 2,000 spans</span>
              ) : null}
            </div>
            <SpanWaterfall
              root={waterfallQuery.data.root}
              totalMs={waterfallQuery.data.total_ms ?? 0}
            />
          </>
        ) : (
          <EmptyState title="Select a request" description="Pick a row above to inspect its shape." />
        )}
      </Card>

      <Card>
        <SectionHeader title="Per-stock cost" />
        {tickerQuery.data ? (
          <div data-testid="per-stock-panel">
            <div className="text-xs mb-1">
              {tickerQuery.data.ticker_count} tickers · {tickerQuery.data.total_self_ms.toFixed(1)} ms total
              {" · "}
              <strong>{tickerQuery.data.distribution}</strong> (cv {tickerQuery.data.cv})
            </div>
            <div className="text-xs text-[var(--text-muted)] mb-2">
              p50 {tickerQuery.data.p50_ms} ms · p95 {tickerQuery.data.p95_ms} ms · max {tickerQuery.data.max_ms} ms
            </div>
            <details>
              <summary className="text-xs cursor-pointer">Full table</summary>
              <DenseTable
                columns={[
                  { key: "ticker", header: "ticker" },
                  { key: "self_ms", header: "self_ms", render: (row) => row.self_ms.toFixed(1) },
                  { key: "db_ms", header: "db_ms", render: (row) => row.db_ms.toFixed(1) },
                  { key: "rows_read", header: "rows" },
                ]}
                rows={tickerQuery.data.rows}
              />
            </details>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionHeader title="Cache effectiveness" />
        <DenseTable
          columns={[
            { key: "component", header: "component" },
            { key: "hits", header: "hits" },
            { key: "misses", header: "misses" },
            { key: "hit_rate", header: "rate", render: (row) => `${(row.hit_rate * 100).toFixed(0)}%` },
            { key: "avg_miss_cost_ms", header: "avg miss" },
            { key: "estimated_time_saved_ms", header: "saved (est)" },
          ]}
          rows={cacheQuery.data?.caches ?? []}
        />
      </Card>
    </div>
  );
}
```

Adjust `DenseTable` prop names to match the real `ColumnDef<T>` shape in `apps/web/components/ui/DenseTable.tsx:4` — read that file first and conform to it rather than to the sketch above. The same applies to `EmptyState`, `ErrorState`, `StatusBadge`, and `ActionButton` prop names.

- [ ] **Step 5: Write the Playwright tests**

Create `apps/web/tests/perf-dashboard.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

const API = "**/api/v1/dev/performance/**";

const EMPTY_INDEX = { requests: [], limit: 50, buffer_used: 0, buffer_limit: 20000 };

function spanNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "root", parent_id: null, operation: "api.request", scope: "api", status: "success",
    total_ms: 100, self_ms: 40, offset_ms: 0, clock_skew: false, orphaned: false,
    ticker: null, table: null, component: null, rows: null, bytes: null,
    series_points: null, cache_state: null, children: [], ...overrides,
  };
}

test("renders the disabled state, not an error, when instrumentation is off", async ({ page }) => {
  await page.route(API, (route) => route.fulfill({ status: 404, body: "{}" }));
  await page.goto("/dev/performance");
  await expect(page.getByText("Instrumentation disabled")).toBeVisible();
  await expect(page.getByText(/MONEYVIEW_DEV_MONITOR=true/)).toBeVisible();
});

test("renders the empty state when the buffer holds nothing", async ({ page }) => {
  await page.route(API, (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ data: EMPTY_INDEX }) })
  );
  await page.goto("/dev/performance");
  await expect(page.getByText("No requests recorded yet")).toBeVisible();
});

test("shows the buffer-full badge as a diagnostic, not an error", async ({ page }) => {
  await page.route(API, (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({ data: { ...EMPTY_INDEX, buffer_used: 20000 } }),
    })
  );
  await page.goto("/dev/performance");
  await expect(page.getByText(/buffer full/)).toBeVisible();
});

test("renders a collapsed node rather than an absence", async ({ page }) => {
  await page.route("**/performance/requests*", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        data: {
          ...EMPTY_INDEX,
          buffer_used: 5,
          requests: [{
            request_id: "req-1", route: "/x", method: "GET", started_at: new Date().toISOString(),
            ended_at: null, total_ms: 100, span_count: 3, ticker_count: 0, status: "success", partial: false,
          }],
        },
      }),
    })
  );
  await page.route("**/performance/waterfall/*", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        data: {
          request_id: "req-1", route: "/x", total_ms: 100, span_count: 3,
          partial: false, truncated: true,
          root: spanNode({
            children: [{ collapsed_count: 27, total_ms: 340, deepest_scope: "db" }],
          }),
        },
      }),
    })
  );
  await page.route(API, (route) => route.fulfill({ status: 200, body: JSON.stringify({ data: EMPTY_INDEX }) }));
  await page.goto("/dev/performance");
  await page.getByText("/x").click();
  await expect(page.getByText(/27 spans collapsed/)).toBeVisible();
  await expect(page.getByText(/truncated at 2,000 spans/)).toBeVisible();
});

test("clock_skew renders a marker and never a negative-width bar", async ({ page }) => {
  await page.route("**/performance/requests*", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        data: {
          ...EMPTY_INDEX, buffer_used: 2,
          requests: [{
            request_id: "req-1", route: "/x", method: "GET", started_at: new Date().toISOString(),
            ended_at: null, total_ms: 100, span_count: 2, ticker_count: 0, status: "success", partial: true,
          }],
        },
      }),
    })
  );
  await page.route("**/performance/waterfall/*", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        data: {
          request_id: "req-1", route: "/x", total_ms: 100, span_count: 2,
          partial: true, truncated: false,
          root: spanNode({
            children: [spanNode({ id: "c", operation: "skewed", parent_id: "root", clock_skew: true, offset_ms: 0, total_ms: 10, self_ms: 10 })],
          }),
        },
      }),
    })
  );
  await page.route(API, (route) => route.fulfill({ status: 200, body: JSON.stringify({ data: EMPTY_INDEX }) }));
  await page.goto("/dev/performance");
  await page.getByText("/x").click();
  await expect(page.getByText(/partial/)).toBeVisible();
  const widths = await page.locator(".absolute.h-3").evaluateAll((nodes) =>
    nodes.map((node) => Number.parseFloat((node as HTMLElement).style.width))
  );
  expect(widths.every((width) => width >= 0)).toBe(true);
});

test("overlap_detected renders a note and a non-negative unattributed value", async ({ page }) => {
  await page.route("**/performance/breakdown*", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        data: {
          scopes: [{ scope: "db", self_ms: 80, pct_of_total: 80, event_count: 2, slow_count: 0 }],
          total_ms: 100, unattributed_ms: 0, overlap_detected: true,
        },
      }),
    })
  );
  await page.route(API, (route) => route.fulfill({ status: 200, body: JSON.stringify({ data: EMPTY_INDEX }) }));
  await page.goto("/dev/performance");
  await expect(page.getByText(/spans overlapped/)).toBeVisible();
  await expect(page.getByText(/unattributed 0\.0 ms/)).toBeVisible();
});

test("per-stock panel leads with distribution and keeps the table collapsed", async ({ page }) => {
  await page.route("**/performance/by-ticker*", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        data: {
          rows: [{ ticker: "AAPL", self_ms: 20, span_count: 2, db_ms: 12, calculation_ms: 8,
                   external_ms: 0, cache_hits: 0, cache_misses: 0, rows_read: 863,
                   bytes: null, series_points: 862 }],
          ticker_count: 138, total_self_ms: 2847, p50_ms: 18.2, p95_ms: 24.1,
          max_ms: 31, cv: 0.09, distribution: "uniform",
        },
      }),
    })
  );
  await page.route(API, (route) => route.fulfill({ status: 200, body: JSON.stringify({ data: EMPTY_INDEX }) }));
  await page.goto("/dev/performance");
  const panel = page.getByTestId("per-stock-panel");
  await expect(panel.getByText("uniform")).toBeVisible();
  await expect(panel.getByText(/p50 18\.2 ms/)).toBeVisible();
  await expect(panel.getByText("AAPL")).toBeHidden();
});

test("the dashboard does not instrument its own requests", async ({ page }) => {
  const clientEvents: string[] = [];
  await page.route("**/performance/client-event", (route) => {
    clientEvents.push(route.request().url());
    return route.fulfill({ status: 200, body: "{}" });
  });
  await page.route(API, (route) => route.fulfill({ status: 200, body: JSON.stringify({ data: EMPTY_INDEX }) }));
  await page.goto("/dev/performance");
  await expect(page.getByText("No requests recorded yet")).toBeVisible();
  expect(clientEvents).toHaveLength(0);
});
```

- [ ] **Step 6: Run the frontend tests**

Run: `cd apps/web && npx playwright test tests/perf-dashboard.spec.ts`
Expected: PASS (8 tests). If selectors miss, adjust the test selectors to the rendered markup — do not weaken an assertion to make it pass.

- [ ] **Step 7: Lint and build**

Run: `cd apps/web && npx eslint app/dev/performance lib/devMonitor.ts && npx next build`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/api.ts apps/web/lib/devMonitor.ts apps/web/app/dev/performance apps/web/tests/perf-dashboard.spec.ts
git commit -m "feat: /dev/performance analysis dashboard with diagnostic-state rendering (spec 05.3, 06)"
```

---

## Task 13: Baseline runner, first report, and doc updates

Implements spec §08.

**Files:**
- Create: `scripts/benchmark_scenarios.py`
- Create: `docs/perf/` (directory, holds generated reports)
- Modify: `guideline/sop/todo.md`
- Test: `tests/api/test_benchmark_scripts.py`

**Interfaces:**
- Consumes: all five analysis functions, `get_dev_monitor_sink().flush()`, `get_dev_monitor_event_limit()`.
- Produces: `docs/perf/YYYY-MM-DD-baseline.md`; exit code non-zero when criteria 1–4 fail.

**Environment metadata is the runner's responsibility** — watchlist size, DB row counts, DB file size, git SHA. None of it may come from an analysis DTO (spec §08.4.1).

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_benchmark_scripts.py`:

```python
def test_benchmark_scenarios_module_exposes_scenarios_and_report():
    import scripts.benchmark_scenarios as runner

    assert set(runner.SCENARIOS) == {
        "portfolio_page_load",
        "comparison_138",
        "attribution_138",
        "single_stock_detail",
        "tab_switch",
    }
    assert callable(runner.render_report)
    assert callable(runner.collect_environment)


def test_report_stamps_every_criterion():
    import scripts.benchmark_scenarios as runner

    report = runner.render_report(
        environment={"watchlist": 138, "stocks_rows": 120647, "db_bytes": 27_000_000,
                     "event_limit": 20000, "compute_mode": "in_process", "git_sha": "abc1234"},
        results=[
            runner.ScenarioResult(
                name="comparison_138", p50_off_ms=3180.0, p50_on_ms=3271.0, p95_on_ms=3410.0,
                iterations=10, breakdown=None, ticker_table=None, orphans=0,
                partial=False, truncated=False, reproducibility_delta_pct=2.0,
            )
        ],
    )
    for criterion in ["criterion 1", "criterion 2", "criterion 3", "criterion 4", "criterion 5"]:
        assert criterion in report.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_benchmark_scripts.py -k benchmark_scenarios -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.benchmark_scenarios'`

- [ ] **Step 3: Implement the runner**

Create `scripts/benchmark_scenarios.py`:

```python
"""Baseline runner for the performance instrumentation spec.

Runs each scenario twice -- MONEYVIEW_DEV_MONITOR off then on -- so overhead is
derived from the difference rather than assumed. Consumes the same public
analysis functions the routes use, so this report and the dashboard cannot
disagree.

Environment metadata (watchlist size, DB counts, git SHA) is collected HERE, not
by the analysis layer, which performs no I/O (spec 08.4.1).

Usage:
    python scripts/benchmark_scenarios.py
    python scripts/benchmark_scenarios.py comparison_138
    python scripts/benchmark_scenarios.py --iterations 5
"""
from __future__ import annotations

import os
import sqlite3
import statistics
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Callable

from fastapi.testclient import TestClient

OVERHEAD_BUDGET_PCT = 3.0
UNATTRIBUTED_BUDGET_PCT = 15.0
REPRODUCIBILITY_BUDGET_PCT = 10.0


@dataclass
class Scenario:
    name: str
    run: Callable[[TestClient], None]
    iterations: int


@dataclass
class ScenarioResult:
    name: str
    p50_off_ms: float
    p50_on_ms: float
    p95_on_ms: float
    iterations: int
    breakdown: object | None
    ticker_table: object | None
    orphans: int
    partial: bool
    truncated: bool
    reproducibility_delta_pct: float

    @property
    def overhead_pct(self) -> float:
        if self.p50_off_ms <= 0:
            return 0.0
        return round((self.p50_on_ms - self.p50_off_ms) / self.p50_off_ms * 100.0, 1)


def _portfolio_page_load(client: TestClient) -> None:
    for endpoint in [
        "/api/v1/portfolio/watchlist",
        "/api/v1/corporate/companies",
        "/api/v1/portfolio/watchlist/sync-status",
        "/api/v1/portfolio/preferences",
    ]:
        client.get(endpoint)


def _comparison_138(client: TestClient) -> None:
    client.get("/api/v1/corporate/comparison?mode=live")


def _attribution_138(client: TestClient) -> None:
    watchlist = client.get("/api/v1/portfolio/watchlist").json()
    tickers = [row["ticker"] for row in watchlist]
    weights = [row["weight"] for row in watchlist]
    client.post(
        "/api/v1/portfolio/attribution",
        json={
            "tickers": tickers, "weights": weights, "benchmark": "^GSPC",
            "period": "5y", "currency": "USD",
            "attribution_method": "brinson_fachler_arithmetic",
            "allow_synthetic_fallback": True, "allow_benchmark_proxy": True,
        },
    )


def _single_stock_detail(client: TestClient) -> None:
    ticker = "AAPL"
    client.get(f"/api/v1/corporate/metrics/{ticker}")
    client.get(f"/api/v1/corporate/metrics/{ticker}/history")
    client.get(f"/api/v1/corporate/metrics/{ticker}/quarterly-statements")
    client.get(f"/api/v1/corporate/metrics/{ticker}/audit")


def _tab_switch(client: TestClient) -> None:
    client.get("/api/v1/market/indices")
    client.get("/api/v1/portfolio/watchlist")
    client.get("/api/v1/corporate/companies")


SCENARIOS: dict[str, Scenario] = {
    "portfolio_page_load": Scenario("portfolio_page_load", _portfolio_page_load, 20),
    "comparison_138": Scenario("comparison_138", _comparison_138, 10),
    "attribution_138": Scenario("attribution_138", _attribution_138, 10),
    "single_stock_detail": Scenario("single_stock_detail", _single_stock_detail, 20),
    "tab_switch": Scenario("tab_switch", _tab_switch, 20),
}


def collect_environment() -> dict:
    """Runner-owned. Analysis performs no I/O and never sees these values."""
    db_path = Path(os.getenv("DB_PATH", "data/processed/moneyview.db"))
    watchlist = stocks_rows = 0
    if db_path.exists():
        connection = sqlite3.connect(str(db_path))
        try:
            watchlist = connection.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0]
            stocks_rows = connection.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
        finally:
            connection.close()
    try:
        git_sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except (subprocess.SubprocessError, OSError):
        git_sha = "unknown"
    return {
        "watchlist": watchlist,
        "stocks_rows": stocks_rows,
        "db_bytes": db_path.stat().st_size if db_path.exists() else 0,
        "event_limit": int(os.getenv("MONEYVIEW_DEV_MONITOR_EVENT_LIMIT", "20000")),
        "compute_mode": os.getenv("MONEYVIEW_COMPUTE_MODE", "in_process"),
        "git_sha": git_sha,
    }


def run_pass(scenario: Scenario, *, instrumented: bool, iterations: int) -> tuple[list[float], list]:
    os.environ["MONEYVIEW_DEV_MONITOR"] = "true" if instrumented else ""
    from apps.api.core import dev_monitor

    dev_monitor.reset_dev_monitor_sink()
    from apps.api.main import app

    samples: list[float] = []
    with TestClient(app) as client:
        scenario.run(client)  # warm-up, untimed
        for _ in range(iterations):
            started = time.perf_counter()
            scenario.run(client)
            samples.append((time.perf_counter() - started) * 1000.0)
    events = []
    if instrumented:
        sink = dev_monitor.get_dev_monitor_sink()
        sink.flush()  # must precede any read of persisted events
        events = sink.recent(limit=dev_monitor.get_dev_monitor_event_limit())
    return samples, events


def _p(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * fraction) - 1))
    return round(ordered[index], 1)


def analyse(events: list) -> dict:
    from apps.api.services.perf_analysis import breakdown_by_scope, rollup_by_ticker

    return {
        "breakdown": breakdown_by_scope(events),
        "ticker_table": rollup_by_ticker(events),
    }


def _stamp(passed: bool) -> str:
    return "PASS" if passed else "FAIL"


def render_report(*, environment: dict, results: list[ScenarioResult]) -> str:
    lines = [
        f"# Performance Baseline — {date.today().isoformat()}",
        "",
        "## Environment",
        f"watchlist: {environment['watchlist']} tickers · stocks: {environment['stocks_rows']} rows · "
        f"db: {environment['db_bytes'] / 1_000_000:.1f} MB",
        f"event limit: {environment['event_limit']} · compute mode: {environment['compute_mode']}",
        f"git: {environment['git_sha']}",
        "",
        "## Overhead (criterion 1: <= 3%)",
        "| scenario | p50 off | p50 on | overhead | |",
        "| --- | --- | --- | --- | --- |",
    ]
    for result in results:
        lines.append(
            f"| {result.name} | {result.p50_off_ms:.1f}ms | {result.p50_on_ms:.1f}ms | "
            f"{result.overhead_pct}% | {_stamp(result.overhead_pct <= OVERHEAD_BUDGET_PCT)} |"
        )

    for result in results:
        lines += ["", f"## Scenario: {result.name}",
                  f"p50 {result.p50_on_ms:.1f} ms · p95 {result.p95_on_ms:.1f} ms · N={result.iterations}"]
        breakdown = result.breakdown
        if breakdown is not None:
            lines += ["", "### Scope breakdown (self time)", "| scope | self_ms | pct |", "| --- | --- | --- |"]
            for scope in breakdown.scopes:
                lines.append(f"| {scope.scope} | {scope.self_ms} | {scope.pct_of_total}% |")
            unattributed_pct = (
                breakdown.unattributed_ms / breakdown.total_ms * 100.0 if breakdown.total_ms else 0.0
            )
            lines.append(
                f"| unattributed | {breakdown.unattributed_ms} | {unattributed_pct:.1f}% | "
                f"criterion 2: {_stamp(unattributed_pct <= UNATTRIBUTED_BUDGET_PCT)}"
            )
        table = result.ticker_table
        if table is not None and table.ticker_count:
            lines += ["", "### Per-stock cost",
                      f"{table.ticker_count} tickers · distribution: {table.distribution} (cv {table.cv})",
                      f"p50 {table.p50_ms} ms · p95 {table.p95_ms} ms · max {table.max_ms} ms"]
        lines += ["", "### Diagnostics",
                  f"orphans: {result.orphans} · partial: {result.partial} · truncated: {result.truncated} "
                  f"— criterion 3: {_stamp(result.orphans == 0 and not result.partial)}",
                  f"reproducibility delta {result.reproducibility_delta_pct}% "
                  f"— criterion 4: {_stamp(result.reproducibility_delta_pct <= REPRODUCIBILITY_BUDGET_PCT)}"]

    lines += ["", "## Ranked bottlenecks (criterion 5)"]
    for result in results:
        table = result.ticker_table
        if table is None or not table.rows:
            continue
        lines.append(f"### {result.name} — {table.distribution}")
        for rank, row in enumerate(table.rows[:5], start=1):
            lines.append(f"{rank}. {row.ticker} — {row.self_ms} ms self ({row.span_count} spans)")
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    selected = [arg for arg in argv if not arg.startswith("--")]
    override = None
    if "--iterations" in argv:
        override = int(argv[argv.index("--iterations") + 1])
    names = selected or list(SCENARIOS)

    environment = collect_environment()
    results: list[ScenarioResult] = []
    for name in names:
        scenario = SCENARIOS[name]
        iterations = override or scenario.iterations
        off_samples, _ = run_pass(scenario, instrumented=False, iterations=iterations)
        on_samples, events = run_pass(scenario, instrumented=True, iterations=iterations)
        repeat_samples, _ = run_pass(scenario, instrumented=True, iterations=iterations)
        analysis = analyse(events)
        first = _p(on_samples, 0.5)
        second = _p(repeat_samples, 0.5)
        delta = round(abs(second - first) / first * 100.0, 1) if first else 0.0
        results.append(
            ScenarioResult(
                name=name,
                p50_off_ms=_p(off_samples, 0.5),
                p50_on_ms=first,
                p95_on_ms=_p(on_samples, 0.95),
                iterations=iterations,
                breakdown=analysis["breakdown"],
                ticker_table=analysis["ticker_table"],
                orphans=sum(1 for event in events if event.parent_id and event.parent_id not in {e.id for e in events}),
                partial=False,
                truncated=False,
                reproducibility_delta_pct=delta,
            )
        )

    report = render_report(environment=environment, results=results)
    output_dir = Path("docs/perf")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{date.today().isoformat()}-baseline.md"
    output_path.write_text(report, encoding="utf-8")
    print(f"wrote {output_path}")

    failed = any(
        result.overhead_pct > OVERHEAD_BUDGET_PCT
        or result.reproducibility_delta_pct > REPRODUCIBILITY_BUDGET_PCT
        or result.orphans > 0
        for result in results
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
```

- [ ] **Step 4: Run the test**

Run: `python -m pytest tests/api/test_benchmark_scripts.py -v`
Expected: PASS

- [ ] **Step 5: Run the actual baseline**

Run: `python scripts/benchmark_scenarios.py`
Expected: writes `docs/perf/<today>-baseline.md` and prints the path. This takes several minutes — two full 138-ticker fan-out passes per scenario plus a reproducibility pass.

Read the generated report. If criterion 1 (overhead ≤ 3%) or criterion 2 (unattributed ≤ 15%) fails, **do not adjust the thresholds** — record the failure and escalate, because the spec states that a failing criterion means the measurement is untrustworthy or the instrumentation has a blind spot.

- [ ] **Step 6: Update the tracking doc**

In `guideline/sop/todo.md`, mark the Performance Instrumentation track items complete and append the headline finding from the report, for example:

```markdown
Baseline recorded <date>: comparison_138 p50 <X> ms, distribution <uniform|mixed|skewed> (cv <Y>).
Top bottleneck: <operation> at <Z> ms self time across <N> calls.
Hand-off to sub-project 2: <structural fix | named outlier tickers>.
```

- [ ] **Step 7: Run the full suite one last time**

Run: `python -m pytest tests/api -q`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add scripts/benchmark_scenarios.py tests/api/test_benchmark_scripts.py docs/perf guideline/sop/todo.md
git commit -m "test: baseline runner with five scenarios and criteria-stamped report (spec 08)"
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec section | Task |
| --- | --- |
| §03.2 span context | 3 |
| §03.3 `closes_span_id` | 3 (perf_timer), 4 (middleware) |
| §03.4 buffered persistence | 1 |
| §03.5 span map | 4, 10, 11 |
| §03.5.1 loader wrapping | 10 |
| §03.5.2 response bytes | 4 (server), 12 (client) |
| §03.6 data volume | 10, 11 |
| §03.7 buffer sizing | 2 |
| §03.8 failure policy | 1 |
| §04.1 self vs total | 6 |
| §04.2 `normalize_spans` | 5 |
| §04.3 time reconstruction | 6 |
| §04.5.1 `buffer_limit` | 7 |
| §04.6 DTOs | 5 |
| §04.7 `unattributed_ms` | 7 |
| §04.8 CV classification | 8 |
| §04.9 degradation | 6 |
| §04.10 truncation | 6 |
| §04.11 cache effectiveness | 8 |
| §05.1–05.2.1 endpoints, filter order | 9 |
| §05.3 frontend client | 12 |
| §06 dashboard | 12 |
| §07.1–07.3 backend tests | 1–11 (inline, TDD) |
| §07.4, §07.4.1 frontend tests | 12 |
| §08 baseline runner | 13 |
| §08.4.1 environment ownership | 13 |

**Known implementation risks flagged for the executor:**

1. **Task 6 `_truncate`** is the most intricate function in the plan. If the deepest-first algorithm proves awkward in practice, a simpler correct approach is acceptable provided the test contract holds: `truncated: true`, exactly one `CollapsedNode` per collapsed sibling group, and correct `collapsed_count` / summed `total_ms`.
2. **Task 12 component props** are sketched from the component inventory, not from reading each file. Read `DenseTable.tsx`, `EmptyState.tsx`, `StatusBadge.tsx`, and `ActionButton.tsx` before writing the page and conform to their real prop shapes.
3. **Tasks 10–11 re-indentation** touches large existing blocks. Verify with `git diff -w` that only indentation changed inside the loop bodies.
4. **Task 13 orphan counting** in `main()` is a simple set-difference; if it produces false positives against paired start/terminal events, reuse `normalize_spans` instead.
