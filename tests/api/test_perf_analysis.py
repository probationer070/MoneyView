from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apps.api.models.schema_parts.dev_monitor import PerformanceEvent
from apps.api.services.perf_analysis import (
    WATERFALL_SPAN_CAP,
    breakdown_by_scope,
    build_waterfall,
    cache_effectiveness,
    list_requests,
    normalize_spans,
    rollup_by_ticker,
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
    component: str | None = None,
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
        component=component,
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
    """"late" and "late-tied" share the same reconstructed start (offset_ms=90,
    ms=10.0), so the ordering among them can only come from input order
    (late's order index is smaller), not from a coincidentally-stable sort.
    """
    events = [
        ev("root", id="r", ms=100.0, offset_ms=100),
        ev("late", id="b", parent="r", ms=10.0, offset_ms=90),
        ev("early", id="a", parent="r", ms=10.0, offset_ms=50),
        ev("late-tied", id="c", parent="r", ms=10.0, offset_ms=90),
    ]
    waterfall = build_waterfall(events, "req-1")
    assert [child.operation for child in waterfall.root.children] == [
        "early",
        "late",
        "late-tied",
    ]


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


def test_two_node_parent_cycle_is_broken_and_returns_waterfall():
    """a.parent=b, b.parent=a: linking either span under the other would
    make the recursive tree walks loop forever. Both must survive as
    orphans under the synthetic root rather than raising.
    """
    events = [
        ev("a", id="a", parent="b", ms=10.0),
        ev("b", id="b", parent="a", ms=10.0),
    ]
    waterfall = build_waterfall(events, "req-1")
    assert waterfall.span_count == 2
    assert waterfall.partial is True
    flattened = _flatten(waterfall.root)
    operations = {node.operation for node in flattened if node.operation in {"a", "b"}}
    assert operations == {"a", "b"}


def test_self_parenting_span_is_broken_and_returns_waterfall():
    """a.parent=a: this project has shipped exactly this bug once, in
    contextvar span-context propagation.
    """
    events = [ev("a", id="a", parent="a", ms=10.0)]
    waterfall = build_waterfall(events, "req-1")
    assert waterfall.span_count == 1
    assert waterfall.partial is True
    flattened = _flatten(waterfall.root)
    assert any(node.operation == "a" for node in flattened)


def test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees():
    """Three long chains hanging off root -- no leaf-sibling group anywhere
    has >= 2 members, so the leaf-group pass alone cannot bring the tree
    under cap. This is reachable in the real workload: ~138 tickers each
    contributing their own mostly-linear span chain is closer to this shape
    than to one bushy fan-out.
    """
    events = [ev("root", id="r", ms=10_000.0, offset_ms=10_000)]
    chain_depth = 700
    for chain in range(3):
        parent_id = "r"
        for level in range(chain_depth):
            span_id = f"c{chain}-{level}"
            events.append(
                ev(f"op{chain}-{level}", id=span_id, parent=parent_id, ms=1.0, offset_ms=level)
            )
            parent_id = span_id
    waterfall = build_waterfall(events, "req-1")
    assert waterfall.truncated is True
    flattened = _flatten(waterfall.root)
    assert len(flattened) <= WATERFALL_SPAN_CAP


def test_overlapping_async_children_flag_overlap_without_forcing_self_ms_negative():
    events = [
        ev("root", id="r", ms=100.0, offset_ms=100),
        ev("child-a", id="a", parent="r", ms=80.0, offset_ms=90),
        ev("child-b", id="b", parent="r", ms=80.0, offset_ms=95),
    ]
    waterfall = build_waterfall(events, "req-1")
    assert waterfall.root.self_ms == 0.0
    assert waterfall.overlap_detected is True


def test_negative_child_duration_excluded_from_self_ms_and_flags_clock_skew():
    events = [
        ev("root", id="r", ms=100.0, offset_ms=100),
        ev("bad", id="b", parent="r", ms=-30.0, offset_ms=50),
    ]
    waterfall = build_waterfall(events, "req-1")
    root = waterfall.root
    child = root.children[0]
    assert root.self_ms == 100.0
    assert child.clock_skew is True


def test_partial_child_self_ms_contributes_zero_not_none():
    """Reviewer's exact pinning case: parent totals 100ms; one child never
    terminated (unpaired start, so total_ms is None) but consumed 60ms of
    wall time before the request ended. The partial child contributes 0 to
    the parent's children_total (spec 04.9: excluded from timing math), so
    parent.self_ms is 100.0, not corrupted by the child's real-but-unknown
    duration.
    """
    events = [
        ev("root", id="r", ms=100.0, offset_ms=100),
        ev("unpaired", id="u", parent="r", status="start", offset_ms=60),
    ]
    waterfall = build_waterfall(events, "req-1")
    assert waterfall.root.self_ms == 100.0


def test_partial_parent_does_not_clamp_child_offset_to_clock_skew():
    """An unpaired api.request_start (partial: no total_ms) with two db
    children that do have durations. A partial parent has no known window to
    clamp into, so its children keep their reconstructed offsets rather than
    being collapsed to 0 and flagged as clock skew (spec 04.9: partial is a
    diagnostic, not skew).
    """
    events = [
        ev("api.request_start", scope="api", id="s1", status="start"),
        ev("db.query", id="c1", parent="s1", ms=20.0, offset_ms=50),
        ev("db.query", id="c2", parent="s1", ms=20.0, offset_ms=90),
    ]
    waterfall = build_waterfall(events, "req-1")
    for child in waterfall.root.children:
        assert child.clock_skew is False
        assert child.offset_ms >= 0.0


def test_route_is_none_without_fallback_to_arbitrary_api_span_operation():
    """route must come only from an event's own `route` field. It must never
    fall back to an arbitrary api-scope span's operation name -- Task 9
    filters by route, so a fabricated value would land in a filter field.
    """
    events = [
        ev("api.request_start", scope="api", id="s1", status="start"),
        ev("api.request_complete", scope="api", id="t1", parent="s1", ms=250.0, closes_span_id="s1"),
    ]
    waterfall = build_waterfall(events, "req-1")
    assert waterfall.route is None


def _flatten(node):
    result = [node]
    for child in node.children:
        if hasattr(child, "collapsed_count"):
            continue
        result.extend(_flatten(child))
    return result


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


def test_partial_root_reports_zero_total_without_overlap():
    """A real root with total_ms is None (in-flight request) must not be
    coerced to 0.0 and then compared against sum(self_ms) -- that would flip
    overlap_detected on for an ordinary in-flight request (spec 04.9)."""
    events = [
        ev("root", scope="api", id="r", ms=None),
        ev("calc", scope="calculation", id="c", parent="r", ms=60.0),
    ]
    breakdown = breakdown_by_scope(events)
    assert breakdown.total_ms == 0.0
    assert breakdown.unattributed_ms == 0.0
    assert breakdown.overlap_detected is False
    assert len(breakdown.scopes) > 0


def test_synthetic_root_denominator_sums_independent_top_level_spans():
    """Two unrelated top-level spans (e.g. two requests sharing one buffer)
    build a synthetic root whose total_ms is a max() over them -- not a real
    duration. The denominator must be the sum of the children's own totals
    instead, or this reports bogus overlap on the default (no request_id)
    call path every time the buffer holds more than one request."""
    events = [
        ev("root_a", scope="api", id="ra", ms=100.0),
        ev("root_b", scope="calculation", id="rb", ms=50.0),
    ]
    breakdown = breakdown_by_scope(events)
    assert breakdown.total_ms == 150.0
    assert breakdown.overlap_detected is False
    assert (
        sum(row.self_ms for row in breakdown.scopes) + breakdown.unattributed_ms
        == breakdown.total_ms
    )


def test_list_requests_total_ms_uses_max_across_parentless_fragments():
    """When a request has no completed api-scope event and more than one
    parent-less span (true root evicted from the ring buffer, leaving an
    orphan fragment alongside it), the fallback total must be the MAX known
    total among them, not an arbitrary first-in-input-order pick."""
    events = [
        ev("orphan", id="o1", ms=15.0, request_id="req-1"),
        ev("root", id="r1", ms=500.0, request_id="req-1"),
    ]
    index = list_requests(events, limit=10, buffer_limit=100)
    row = index.requests[0]
    assert row.total_ms == 500.0


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


def test_rollup_counts_cache_hits_and_misses():
    """Nothing in the brief exercises the cache_state hit/miss branches inside
    rollup_by_ticker; later instrumentation tasks are the first real emitters
    of span-level cache_state, so pin the counting behavior here now.
    """
    events = [
        ev("api.request_complete", scope="api", id="r", ms=20.0),
        ev("ticker.metrics-hit", id="h", parent="r", ms=5.0, ticker="AAPL", cache_state="hit"),
        ev("ticker.metrics-miss", id="m", parent="r", ms=5.0, ticker="AAPL", cache_state="miss"),
    ]
    table = rollup_by_ticker(events)
    row = next(row for row in table.rows if row.ticker == "AAPL")
    assert row.cache_hits == 1
    assert row.cache_misses == 1


def test_cache_effectiveness_formula():
    events = [
        ev("cache.get", scope="cache", id="h1", ms=1.0, status="cache_hit", component="attr"),
        ev("cache.get", scope="cache", id="h2", ms=1.0, status="cache_hit", component="attr"),
        ev("cache.get", scope="cache", id="m1", ms=400.0, status="cache_miss", component="attr"),
        ev("cache.get", scope="cache", id="m2", ms=200.0, status="cache_miss", component="attr"),
    ]
    report = cache_effectiveness(events)
    row = report.caches[0]
    assert row.component == "attr"
    assert row.hits == 2
    assert row.misses == 2
    assert row.hit_rate == 0.5
    assert row.avg_miss_cost_ms == 300.0
    assert row.estimated_time_saved_ms == 600.0
