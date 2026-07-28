"""Pure analysis over performance events.

CONTRACT: no I/O, no globals, no locks, no wall-clock reads, no HTTP concepts.
Every function takes list[PerformanceEvent] and returns a DTO. Filtering happens
in the route layer before these functions are called (spec 02.3).
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import datetime

from apps.api.models.schema_parts.dev_monitor import PerformanceEvent
from apps.api.models.schema_parts.perf_analysis import (
    CacheReport,
    CacheRow,
    CollapsedNode,
    RequestIndex,
    RequestSummaryRow,
    RequestWaterfall,
    ScopeBreakdown,
    ScopeRow,
    SpanNode,
    TickerCostRow,
    TickerCostTable,
)

EPSILON_MS = 1.0
WATERFALL_SPAN_CAP = 2000
SYNTHETIC_ROOT_ID = "__synthetic_root__"
CV_UNIFORM_MAX = 0.15
CV_SKEWED_MIN = 0.5


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
        # `partial` means a span we expected to close that did not (spec 04.9),
        # so only a start event can be partial. A point-in-time event (a cache
        # hit/miss) is emitted once, complete, and simply has no duration --
        # treating it as unfinished made baseline criterion 3 unreachable for
        # every scenario that touches the cache. "start" is set at exactly the
        # three start-event emit sites (dev_monitor.perf_timer, middleware's
        # api.request_start and page_load.*).
        partial=event.duration_ms is None and event.status == "start",
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


def _creates_cycle(span: Span, parent: Span, by_id: dict[str, Span]) -> bool:
    """True if attaching `span` under `parent` would put span in its own
    ancestry (a<->b mutual cycles, and a self-parenting a.parent_id == a.id).

    Walks the static parent_id chain -- not the children lists being built --
    so a cycle elsewhere in the graph can't make this walk loop forever
    either. Bounded by the span count: a parent_id chain visiting more
    distinct spans than exist must already be revisiting one, i.e. is itself
    a cycle, so treat exceeding the bound the same as finding span again.
    """
    current = parent
    steps = 0
    limit = len(by_id) + 1
    while current is not None:
        if current.id == span.id:
            return True
        if steps >= limit:
            return True
        steps += 1
        current = by_id.get(current.parent_id) if current.parent_id is not None else None
    return False


def _build_tree(spans: list[Span]) -> tuple[Span, bool]:
    """Return (root, partial). Orphans and cycle-broken spans attach to a
    synthetic root."""
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
        if _creates_cycle(span, parent, by_id):
            # This project has shipped a self-parenting-span bug before (in
            # contextvar propagation). Linking would make the recursive tree
            # walks loop forever, so break the cycle instead: treat span as
            # orphaned and attach it directly under the (synthetic) root.
            span.orphaned = True
            partial = True
            roots.append(span)
            continue
        parent.children.append(span)

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


def _assign_self_ms(span: Span) -> bool:
    """self_ms = total_ms minus the sum of direct children's total_ms.
    Returns True if overlap was detected in this span or any descendant, so
    the caller can surface it on RequestWaterfall.overlap_detected.

    A partial child (total_ms is None) contributes 0 to that sum: we have no
    measurement for it, and treating it as 0 keeps the parent's own self_ms
    computable instead of forcing None to propagate up from every partial
    descendant. This can overstate the parent's self_ms by the partial
    child's real (unknown) duration -- the child's own partiality is still
    visible on the child node itself, so the diagnostic isn't lost, just not
    double-charged to every ancestor. self_ms is None only when the span's
    own total_ms is None (spec 04.3).

    A child with a NEGATIVE total_ms also contributes 0 -- and is flagged
    clock_skew=True directly, since a negative duration is itself the skew --
    rather than being subtracted, which would otherwise inflate the parent's
    self_ms past its own total.

    When the (non-negative) children_total still exceeds the parent's own
    total_ms, that is ordinary async-sibling overlap: fan-out children that
    run concurrently each report their own wall-clock duration, so their sum
    can legitimately exceed the parent's wall-clock span. That is the
    dominant real trigger for a negative raw self-time, not a bogus
    duration. self_ms is clamped to 0 in that case and overlap_detected is
    flagged rather than silently absorbed (spec 04.9). The synthetic
    multi-root wrapper is excluded from that flag: its total_ms is a max()
    over unrelated top-level spans, not a real duration to compare against,
    so summed children legitimately exceeding it is not "overlap".
    """
    order: list[Span] = []
    stack = [span]
    while stack:
        current = stack.pop()
        order.append(current)
        stack.extend(current.children)

    overlap = False
    # reversed(order) is post-order: a parent's children are all processed
    # before it, which is what lets it subtract their settled total_ms.
    for current in reversed(order):
        if current.total_ms is None:
            current.self_ms = None
            continue

        children_total = 0.0
        for child in current.children:
            total = child.total_ms
            if total is None:
                continue
            if total < 0:
                child.clock_skew = True
                continue
            children_total += total

        raw_self = current.total_ms - children_total
        if current.id != SYNTHETIC_ROOT_ID and raw_self < -EPSILON_MS:
            overlap = True
        current.self_ms = round(max(0.0, raw_self), 1)
    return overlap


def _assign_offsets(span: Span, root_start_ms: float, parent_span: Span | None) -> None:
    # Explicit stack, pre-order: a child clamps against its parent's
    # offset_ms, so the parent must be assigned before its children pop.
    stack: list[tuple[Span, Span | None]] = [(span, parent_span)]
    while stack:
        current, parent = stack.pop()
        raw_offset = _start_ms(current) - root_start_ms
        parent_offset = parent.offset_ms if parent else 0.0
        if parent is not None and parent.total_ms is None:
            # Partial parent (still in flight, or its start was evicted from the
            # ring buffer): there is no known window to clamp into. Enforce only
            # the lower bound -- a child can't be reported before its parent
            # starts -- rather than collapsing every child to a zero-width
            # window and flagging ordinary partial-parent structure as clock
            # skew (spec 04.9: partial is a diagnostic, not skew).
            clamped = max(parent_offset, raw_offset)
        else:
            parent_limit = parent.total_ms if parent else (current.total_ms or 0.0)
            clamped = max(parent_offset, min(raw_offset, parent_offset + parent_limit))
        # OR, not overwrite: a child's clock_skew may already have been set by
        # _assign_self_ms (a negative total_ms) and must survive this pass.
        current.clock_skew = current.clock_skew or (abs(clamped - raw_offset) > EPSILON_MS)
        current.offset_ms = round(max(0.0, clamped), 1)
        for child in current.children:
            stack.append((child, current))


def _to_node(span: Span) -> SpanNode:
    """Build the DTO tree bottom-up with an explicit stack.

    Deliberately not recursive: the comprehension form cost two Python frames
    per level (the call plus the comprehension's own frame), so a ~670-deep
    span chain exhausted the default 1000-frame stack and raised
    RecursionError instead of truncating -- the exact outcome truncation
    exists to prevent. Depth is now bounded by the heap. Keyed on id() because
    Span is a mutable dataclass and is not hashable.
    """
    order: list[Span] = []
    stack = [span]
    while stack:
        current = stack.pop()
        order.append(current)
        stack.extend(current.children)

    built: dict[int, SpanNode] = {}
    # reversed(order) guarantees every child is built before its parent: a
    # parent is always appended before the children it pushes.
    for current in reversed(order):
        node = SpanNode(
            id=current.id,
            parent_id=current.parent_id,
            operation=current.operation,
            scope=current.scope,
            status=current.status,
            total_ms=current.total_ms,
            self_ms=current.self_ms,
            offset_ms=current.offset_ms,
            clock_skew=current.clock_skew,
            orphaned=current.orphaned,
            ticker=current.ticker,
            table=current.table,
            component=current.component,
            rows=current.rows,
            bytes=current.bytes,
            series_points=current.series_points,
            cache_state=current.cache_state,
            children=[built[id(child)] for child in current.children],
        )
        # The collapsed marker lives in the DTO so the UI cannot render an elided
        # subtree as "no children" (spec 04.10).
        if current.collapsed is not None:
            count, total_ms, scope = current.collapsed
            node.children.append(
                CollapsedNode(collapsed_count=count, total_ms=total_ms, deepest_scope=scope)
            )
        built[id(current)] = node
    return built[id(span)]


def _depth_map(span: Span, depth: int, acc: list[tuple[int, Span]]) -> None:
    # reversed() on push so the pop order matches the recursive form's DFS
    # sequence exactly -- _truncate consumes acc in order, so this is a
    # behavioural requirement, not a style choice.
    stack = [(span, depth)]
    while stack:
        current, current_depth = stack.pop()
        acc.append((current_depth, current))
        for child in reversed(current.children):
            stack.append((child, current_depth + 1))


def _subtree_size(span: Span) -> int:
    return 1 + sum(_subtree_size(child) for child in span.children)


def _truncate(root: Span, cap: int) -> bool:
    """Collapse subtrees until the tree fits under cap (spec 04.10 step 4:
    "repeat until under the cap").

    Pass 1 collapses whole leaf-sibling groups first -- detail deep in a
    bushy tree is the least informative at a glance, so it goes first, and
    collapsing only leaves keeps every non-leaf ancestor's own structure
    intact. But a tree isn't always bushy: long parent-child chains (e.g.
    each of many tickers contributing its own deep, mostly-linear span chain
    rather than a wide fan-out) have no leaf-sibling group of size >= 2
    anywhere, so pass 1 alone can leave the tree over cap. Pass 2 falls back
    to collapsing whole child subtrees -- leaf or not -- deepest first,
    repeating until the actual node count is at or under the cap. Each
    collapsed group leaves exactly one marker behind per span.
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

    while remaining > cap:
        nodes = []
        _depth_map(root, 0, nodes)
        removed_this_pass = 0
        for _, span in sorted(nodes, key=lambda pair: pair[0], reverse=True):
            if remaining <= cap:
                break
            if not span.children:
                continue
            drop = []
            dropped_size = 0
            for child in span.children:
                if remaining - dropped_size <= cap:
                    break
                dropped_size += _subtree_size(child)
                drop.append(child)
            if not drop:
                continue
            dropped_ids = set(id(child) for child in drop)
            span.children = [child for child in span.children if id(child) not in dropped_ids]
            prior_count, prior_ms, prior_scope = span.collapsed or (0, 0.0, drop[0].scope)
            span.collapsed = (
                prior_count + dropped_size,
                round(prior_ms + sum(child.total_ms or 0.0 for child in drop), 1),
                prior_scope,
            )
            remaining -= dropped_size
            removed_this_pass += dropped_size
        if removed_this_pass == 0:
            break  # nothing left to collapse; stop rather than spin forever
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
    overlap_detected = _assign_self_ms(root)
    _assign_offsets(root, _start_ms(root), None)
    truncated = _truncate(root, WATERFALL_SPAN_CAP)
    node = _to_node(root)  # _to_node emits CollapsedNode markers from span.collapsed
    route = next((event.route for event in events if event.route), None)
    return RequestWaterfall(
        request_id=request_id,
        route=route,
        total_ms=root.total_ms,
        span_count=len(spans),
        partial=partial,
        truncated=truncated,
        overlap_detected=overlap_detected,
        root=node,
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

    if root.id == SYNTHETIC_ROOT_ID:
        # Multiple independent top-level spans (e.g. several requests sharing
        # one buffer): the denominator is total measured wall time across
        # them, not root.total_ms -- that's a max() over unrelated spans, not
        # a real duration to compare against (mirrors the exemption
        # _assign_self_ms already applies for the same reason).
        known_child_totals = [child.total_ms for child in root.children if child.total_ms is not None]
        total_known = len(known_child_totals) > 0
        root_total = sum(known_child_totals) if total_known else 0.0
    else:
        total_known = root.total_ms is not None
        root_total = root.total_ms if total_known else 0.0

    sum_self = sum(sum(values) for values in totals.values())
    if total_known:
        raw_unattributed = root_total - sum_self
        overlap_detected = raw_unattributed < -EPSILON_MS
        unattributed = round(max(0.0, raw_unattributed), 1)
    else:
        # An in-flight/partial root (or a synthetic root none of whose
        # children have a known duration) has no measured total to compare
        # against. "Unmeasured" must not become "measured zero" feeding the
        # overlap comparison (spec 04.9).
        overlap_detected = False
        unattributed = 0.0

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
        # A request can have more than one parent-less span when its true
        # root was evicted from the ring buffer, leaving an orphan fragment
        # alongside the real root (spec 04.9). These are fragments of one
        # request's tree, not separate requests, so the fallback total is the
        # MAX known total among them -- the largest fragment is the closest
        # approximation to the request's real duration, not an arbitrary
        # first-in-input-order pick.
        known_root_totals = [
            span.total_ms for span in spans if span.parent_id is None and span.total_ms is not None
        ]
        fallback_total_ms = max(known_root_totals) if known_root_totals else None
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
                total_ms=(api_event.duration_ms if api_event else fallback_total_ms),
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
    miss_counts: dict[str, int] = {}
    miss_costs: dict[str, list[float]] = {}
    fill_costs: dict[str, list[float]] = {}
    for event in events:
        if event.scope != "cache":
            continue
        component = event.component or "unknown"
        if event.status == "cache_hit":
            hits[component] = hits.get(component, 0) + 1
        elif event.status == "cache_miss":
            miss_counts[component] = miss_counts.get(component, 0) + 1
            # An unmeasured miss (duration_ms is None) still counts as a miss,
            # but must not be folded into the cost average as a 0.0ms miss --
            # that would silently understate avg_miss_cost_ms and the time
            # saved by every hit (spec 04.9: unmeasured is not measured-zero).
            if event.duration_ms is not None:
                miss_costs.setdefault(component, []).append(event.duration_ms)
        # Matched on operation, not status: a fill is timed with perf_timer so that the
        # provider fetch nests beneath it rather than beside it, and perf_timer's
        # terminal carries success/slow. duration_ms is the span total, which is the
        # whole fill -- exactly what a later hit avoids.
        elif event.operation == "cache.populate" and event.duration_ms is not None:
            fill_costs.setdefault(component, []).append(event.duration_ms)

    rows: list[CacheRow] = []
    for component in sorted(set(hits) | set(miss_counts) | set(fill_costs)):
        hit_count = hits.get(component, 0)
        miss_count = miss_counts.get(component, 0)
        # A populate span measures the fetch a miss triggered; a duration on the miss
        # event itself only measures miss *detection*, which is near-zero and would
        # understate what a hit saves. Prefer the fill whenever it was measured.
        fills = fill_costs.get(component, [])
        known_costs = fills or miss_costs.get(component, [])
        total = hit_count + miss_count
        avg_miss = round(statistics.fmean(known_costs), 1) if known_costs else 0.0
        rows.append(
            CacheRow(
                component=component,
                hits=hit_count,
                misses=miss_count,
                fills=len(fills),
                hit_rate=round(hit_count / total, 4) if total else 0.0,
                avg_miss_cost_ms=avg_miss,
                estimated_time_saved_ms=round(hit_count * avg_miss, 1),
            )
        )
    return CacheReport(caches=rows)
