"""Item 10: separate CPU from wait time within a span.

`external.*` spans time a provider call end to end, which answers "this took 400ms" but
not "400ms of what". Waiting on a socket and building a DataFrame from the response are
both inside that number, and they call for opposite fixes -- fewer round trips versus
cheaper parsing. `duration_ms - cpu_ms` splits them.

The measurement is only sound when the span owns its thread for its whole extent.
`time.thread_time()` counts the *thread's* CPU, so if the span wraps an `await`, every
other coroutine scheduled on that thread during the wait is charged to this span. Those
spans report `cpu_ms=None` rather than a number that looks measured and is not.
"""
from __future__ import annotations

import asyncio
import time

from apps.api.core import dev_monitor
from apps.api.core.dev_monitor import perf_timer
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent
from apps.api.services.perf_analysis import external_cpu_wait_split, normalize_spans


def _enable(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR", "true")
    monkeypatch.setenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", str(tmp_path))
    dev_monitor.reset_dev_monitor_sink()
    return dev_monitor.get_dev_monitor_sink()


def _burn_cpu(seconds: float) -> None:
    deadline = time.perf_counter() + seconds
    while time.perf_counter() < deadline:
        pass


def test_a_cpu_bound_span_reports_nearly_all_of_its_duration_as_cpu(monkeypatch, tmp_path):
    sink = _enable(monkeypatch, tmp_path)

    with perf_timer(scope="external", operation="external.parse"):
        _burn_cpu(0.05)

    event = next(e for e in sink.recent(limit=50) if e.operation == "external.parse")
    assert event.cpu_ms is not None
    # Busy-looping is CPU by construction. Loose bound: the box is shared and the
    # thread can be descheduled, so this asserts the split is real, not a ratio.
    assert event.cpu_ms > event.duration_ms * 0.5
    assert event.cpu_ms <= event.duration_ms


def test_a_sleeping_span_reports_almost_no_cpu(monkeypatch, tmp_path):
    """The case the split exists for: elapsed time that is not work.

    `time.sleep` blocks the thread without consuming its CPU, which is what a socket
    read does. Wait time is `duration_ms - cpu_ms`.
    """
    sink = _enable(monkeypatch, tmp_path)

    with perf_timer(scope="external", operation="external.fetch"):
        time.sleep(0.05)

    event = next(e for e in sink.recent(limit=50) if e.operation == "external.fetch")
    assert event.cpu_ms is not None
    assert event.duration_ms >= 50.0
    assert event.cpu_ms < 10.0


def test_a_span_on_the_event_loop_thread_reports_no_cpu_rather_than_a_contaminated_one(
    monkeypatch, tmp_path
):
    """The guard. thread_time cannot attribute CPU per-span once tasks interleave.

    Here a second task burns CPU on the same thread while the timed span is awaiting.
    thread_time would charge that work to this span, so cpu_ms must be None -- this
    track has twice shipped a criterion that read green for a reason unrelated to what
    it measured, and a wrong number is worse than an absent one.
    """
    sink = _enable(monkeypatch, tmp_path)

    async def scenario() -> None:
        async def noisy_neighbour() -> None:
            _burn_cpu(0.05)

        with perf_timer(scope="external", operation="external.awaited"):
            neighbour = asyncio.create_task(noisy_neighbour())
            await asyncio.sleep(0.01)
            await neighbour

    asyncio.run(scenario())

    event = next(e for e in sink.recent(limit=50) if e.operation == "external.awaited")
    assert event.cpu_ms is None


def _external_event(operation: str, ms: float, cpu_ms: float | None) -> PerformanceEvent:
    return PerformanceEvent(
        id=operation,
        request_id="req-1",
        level="info",
        scope="external",
        operation=operation,
        status="success",
        duration_ms=ms,
        cpu_ms=cpu_ms,
    )


def test_the_span_carries_cpu_ms_through_from_the_event():
    spans = normalize_spans([_external_event("external.fetch", 100.0, 12.5)])

    assert spans[0].cpu_ms == 12.5


def test_the_split_reports_cpu_and_wait_over_the_external_spans_that_measured_them():
    events = [
        _external_event("external.fetch_a", 100.0, 10.0),
        _external_event("external.fetch_b", 60.0, 20.0),
    ]

    split = external_cpu_wait_split(events)

    assert split.cpu_ms == 30.0
    assert split.wait_ms == 130.0
    assert split.measured_spans == 2
    assert split.unmeasured_spans == 0


def test_the_split_counts_unmeasured_spans_instead_of_reading_their_cpu_as_zero():
    """A span with cpu_ms=None was never measured -- folding it in as 0 CPU would
    report its whole duration as wait, which is a claim, not a measurement. It is
    excluded from both totals and counted, so the report can say what fraction of
    external time the split actually covers.
    """
    events = [
        _external_event("external.measured", 100.0, 25.0),
        _external_event("external.on_the_loop", 900.0, None),
    ]

    split = external_cpu_wait_split(events)

    assert split.cpu_ms == 25.0
    assert split.wait_ms == 75.0
    assert split.measured_spans == 1
    assert split.unmeasured_spans == 1


def test_the_split_ignores_spans_from_other_scopes():
    events = [
        _external_event("external.fetch", 100.0, 10.0),
        PerformanceEvent(
            id="db", request_id="req-1", level="info", scope="db",
            operation="db.query", status="success", duration_ms=500.0, cpu_ms=400.0,
        ),
    ]

    split = external_cpu_wait_split(events)

    assert split.cpu_ms == 10.0
    assert split.measured_spans == 1
