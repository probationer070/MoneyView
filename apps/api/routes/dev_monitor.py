from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from apps.api.core.dev_monitor import emit_performance_event, get_current_request_id, get_dev_monitor_event_limit, get_dev_monitor_sink, is_dev_monitor_enabled, reset_events_suppressed, set_events_suppressed
from apps.api.models.schemas import APIMeta, APIResponse, ClientPerformanceEventRequest, PerformanceEvent, PerformanceEventListResponse, PerformanceSummary
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

router = APIRouter()


def _require_dev_monitor() -> None:
    if not is_dev_monitor_enabled():
        raise HTTPException(status_code=404, detail="Not found")


def _response_meta() -> APIMeta:
    return APIMeta(
        last_updated_at=datetime.now(timezone.utc).isoformat(),
        request_id=get_current_request_id() or "",
    )


@router.get("/log-stream")
async def stream_dev_log_events(request: Request, once: bool = Query(default=False)):
    _require_dev_monitor()

    async def event_stream():
        sink = get_dev_monitor_sink()
        sequence = 0
        while True:
            if await request.is_disconnected():
                break
            sequence, events = sink.events_after(sequence)
            for event in events:
                yield f"data: {event.model_dump_json()}\n\n"
            if once and events:
                break
            await asyncio.sleep(0.25)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/performance/recent", response_model=APIResponse[PerformanceEventListResponse])
async def get_recent_performance_events(limit: int = Query(default=500, ge=1, le=500)):
    _require_dev_monitor()
    events = get_dev_monitor_sink().recent(limit=limit)
    return APIResponse(data=PerformanceEventListResponse(events=events, limit=limit), meta=_response_meta())


@router.get("/performance/slow", response_model=APIResponse[PerformanceEventListResponse])
async def get_slow_performance_events(limit: int = Query(default=100, ge=1, le=500)):
    _require_dev_monitor()
    events = get_dev_monitor_sink().slow(limit=limit)
    return APIResponse(data=PerformanceEventListResponse(events=events, limit=limit), meta=_response_meta())


@router.get("/performance/errors", response_model=APIResponse[PerformanceEventListResponse])
async def get_error_performance_events(limit: int = Query(default=100, ge=1, le=500)):
    _require_dev_monitor()
    events = get_dev_monitor_sink().errors(limit=limit)
    return APIResponse(data=PerformanceEventListResponse(events=events, limit=limit), meta=_response_meta())


@router.get("/performance/summary", response_model=APIResponse[PerformanceSummary])
async def get_performance_summary():
    _require_dev_monitor()
    summary = get_dev_monitor_sink().summary()
    return APIResponse(data=summary, meta=_response_meta())


@router.post("/performance/client-event", response_model=APIResponse[PerformanceEvent])
async def post_client_performance_event(payload: ClientPerformanceEventRequest):
    _require_dev_monitor()
    # Dev routes are uninstrumented so the dashboard does not record its own fetches
    # (spec 06.9), but this endpoint exists precisely to persist the browser's spans.
    # Opt back in for this one deliberate emit, or every frontend span is discarded.
    suppression_token = set_events_suppressed(False)
    try:
        event = emit_performance_event(
            PerformanceEvent(
                request_id=get_current_request_id(),
                level=payload.level,
                scope=payload.scope,
                operation=payload.operation,
                status=payload.status,
                duration_ms=payload.duration_ms,
                ticker=payload.ticker,
                route=payload.route,
                method=payload.method,
                provider=payload.provider,
                component=payload.component,
                warning_code=payload.warning_code,
                error_code=payload.error_code,
                message=payload.message,
                metadata=payload.metadata,
            )
        )
    finally:
        reset_events_suppressed(suppression_token)
    return APIResponse(data=event, meta=_response_meta())


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
