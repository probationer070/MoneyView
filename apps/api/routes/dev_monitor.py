from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from apps.api.core.dev_monitor import emit_performance_event, get_current_request_id, get_dev_monitor_sink, is_dev_monitor_enabled
from apps.api.models.schemas import APIMeta, APIResponse, ClientPerformanceEventRequest, PerformanceEvent, PerformanceEventListResponse, PerformanceSummary

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
    return APIResponse(data=event, meta=_response_meta())
