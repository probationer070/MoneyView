"""Pure analysis over performance events.

CONTRACT: no I/O, no globals, no locks, no wall-clock reads, no HTTP concepts.
Every function takes list[PerformanceEvent] and returns a DTO. Filtering happens
in the route layer before these functions are called (spec 02.3).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from apps.api.models.schema_parts.dev_monitor import PerformanceEvent
from apps.api.models.schema_parts.perf_analysis import (
    CollapsedNode,
    RequestWaterfall,
    SpanNode,
)

EPSILON_MS = 1.0
WATERFALL_SPAN_CAP = 2000
SYNTHETIC_ROOT_ID = "__synthetic_root__"


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
    terminals: list[tuple[str, int, PerformanceEvent]] = []

    for order, event in enumerate(events):
        closes = span_closes(event)
        if closes is not None:
            terminals.append((closes, order, event))
            continue
        spans[event.id] = _span_from(event, order)

    for start_id, order, terminal in terminals:
        start_span = spans.get(start_id)
        if start_span is None:
            # Start event evicted from the ring buffer: keep the terminal as its
            # own span rather than dropping the measurement.
            orphan = _span_from(terminal, order)
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
    """self_ms = total_ms minus the sum of direct children's total_ms.

    A partial child (total_ms is None) contributes 0 to that sum: we have no
    measurement for it, and treating it as 0 keeps the parent's own self_ms
    computable instead of forcing None to propagate up from every partial
    descendant. This can overstate the parent's self_ms by the partial
    child's real (unknown) duration -- the child's own partiality is still
    visible on the child node itself, so the diagnostic isn't lost, just not
    double-charged to every ancestor. self_ms is None only when the span's
    own total_ms is None (spec 04.3).
    """
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
    node = _to_node(root)  # _to_node emits CollapsedNode markers from span.collapsed
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
