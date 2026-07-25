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
