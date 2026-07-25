from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apps.api.models.schema_parts.dev_monitor import PerformanceEvent
from apps.api.services.perf_analysis import (
    build_waterfall,
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
    module_path = (
        Path(__file__).resolve().parents[2] / "apps/api/services/perf_analysis.py"
    )
    source = module_path.read_text(encoding="utf-8")
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
    assert "time" not in imported
    assert "get_dev_monitor_sink" not in source
    assert "datetime.now" not in source
    assert "apps.api.routes" not in source
    assert "apps/api/routes" not in source


def test_evicted_start_gets_distinct_order_from_siblings():
    """The terminal's parent (start) was evicted from the ring buffer: its
    measurement must survive as a partial span, and that span's `order` must be
    the terminal's real input-sequence index, not a value derived from
    dict size, so ties resolve by true input order (spec 07.1 case 10).
    """
    events = [
        ev("fanout", id="t1", parent="s1", ms=100.0, closes_span_id="s1"),
        ev("child", id="c1", parent="s1", ms=20.0),
    ]
    spans = {span.id: span for span in normalize_spans(events)}
    assert set(spans) == {"c1", "t1"}
    assert spans["t1"].total_ms == 100.0
    assert spans["t1"].partial is True
    assert spans["t1"].order != spans["c1"].order
    assert spans["t1"].order == 0
    assert spans["c1"].order == 1


def test_span_node_round_trips_nested_span_and_collapsed_node():
    """SpanNode.model_rebuild() resolves the recursive Union["SpanNode",
    CollapsedNode] forward-ref. Nothing else in the suite imports this module,
    so verify the union actually serializes both branches.
    """
    from apps.api.models.schema_parts.perf_analysis import CollapsedNode, SpanNode

    child = SpanNode(id="child", operation="op", scope="calculation", status="success")
    collapsed = CollapsedNode(collapsed_count=3, total_ms=42.0, deepest_scope="db")
    root = SpanNode(
        id="root",
        operation="root-op",
        scope="api",
        status="success",
        children=[child, collapsed],
    )

    dumped = root.model_dump()
    assert dumped["children"][0]["id"] == "child"
    assert dumped["children"][1]["collapsed_count"] == 3


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
