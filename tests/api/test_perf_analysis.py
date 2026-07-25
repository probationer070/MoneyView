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


def test_terminal_id_differs_from_start_id_and_child_nests_under_start():
    """Task 3's tests never asserted terminal.id != start.id, nor that children
    nest under the start event's id. normalize_spans and the later waterfall walk
    depend on exactly that link, so pin it here.
    """
    events = [
        ev("fanout", id="s1", status="start"),
        ev("fanout", id="t1", parent="s1", ms=100.0, closes_span_id="s1"),
        ev("child", id="c1", parent="s1", ms=20.0),
    ]
    assert events[1].id != events[0].id

    spans = {span.id: span for span in normalize_spans(events)}
    assert set(spans) == {"s1", "c1"}
    assert spans["s1"].total_ms == 100.0
    assert spans["c1"].parent_id == "s1"


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
