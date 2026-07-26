import time
import uuid
import logging
from contextvars import Token
from typing import Dict
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from apps.api.core.dev_monitor import (
    emit_performance_event,
    is_dev_monitor_enabled,
    reset_current_request_id,
    reset_current_span_id,
    reset_events_suppressed,
    set_current_request_id,
    set_current_span_id,
    set_events_suppressed,
)
from apps.api.core.logger import setup_logger
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent

logger = setup_logger(__name__)

# Requests under this prefix are not instrumented: they serve the dashboard that reads
# the event buffer, so recording them would pollute the data they return (spec 06.9).
_UNINSTRUMENTED_PATH_PREFIX = "/api/v1/dev"


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


class RateLimiter:
    """In-memory Token Bucket rate limiter per IP/Client."""
    def __init__(self, rate: int, capacity: int):
        self.rate = rate          # Tokens added per second
        self.capacity = capacity  # Max burst tokens
        self.clients: Dict[str, dict] = {}

    def allow_request(self, client_id: str) -> bool:
        now = time.time()
        if client_id not in self.clients:
            self.clients[client_id] = {"tokens": self.capacity, "last_updated": now}
            
        client = self.clients[client_id]
        time_passed = now - client["last_updated"]
        
        # Add tokens based on time passed
        client["tokens"] = min(self.capacity, client["tokens"] + time_passed * self.rate)
        client["last_updated"] = now
        
        if client["tokens"] >= 1:
            client["tokens"] -= 1
            return True
        return False

# Global instance: 10 requests per second, burst 50.
limiter = RateLimiter(rate=10, capacity=50)

class StructuralMiddleware(BaseHTTPMiddleware):
    """Enforces X-Request-ID tracking and Lightweight Rate Limiting."""
    async def dispatch(self, request: Request, call_next):
        # 1. Request ID tracking
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id
        request_token = set_current_request_id(request_id)
        request_event_id: str | None = None
        span_token: Token[str | None] | None = None

        # 2. Rate Limiting (Throttle by IP + Route specific overrides)
        client_ip = request.client.host if request.client else "127.0.0.1"
        path = request.url.path

        # Inject strict limits on computationally heavy endpoints preventing DOS bypasses
        if "corporate/dcf" in path or "corporate/diagnostic" in path:
            # Recreate specific tight limit per client per heavy route (Burst 5)
            strict_id = f"{client_ip}_{path}"
            if not getattr(limiter, f'strict_{strict_id}', None):
                setattr(limiter, f'strict_{strict_id}', RateLimiter(rate=2, capacity=5))
            specific_limiter = getattr(limiter, f'strict_{strict_id}')
            if not specific_limiter.allow_request(client_ip):
                logger.warning(f"Heavy endpoint rate limit exceeded for {client_ip} on {path}")
                return Response("Too Many Requests - Heavy Compute Throttle", status_code=429)
        else:
            if not limiter.allow_request(client_ip):
                logger.warning(f"Global rate limit exceeded for {client_ip}")
                return Response("Too Many Requests", status_code=429)

        # 3. Execution mapping
        start_time = time.time()
        # The dashboard reads the buffer it would otherwise write to, so instrumenting
        # its own fetches makes the request index list the request that fetched it, and
        # a refresh evicts the traffic you opened the page to inspect (spec 06.9).
        # Covers db and cache events raised inside these handlers too, not just the
        # request span -- suppressing only the span would leave those unparented.
        suppression_token = set_events_suppressed(path.startswith(_UNINSTRUMENTED_PATH_PREFIX))
        if is_dev_monitor_enabled():
            request_event = emit_performance_event(
                PerformanceEvent(
                    request_id=request_id,
                    level="info",
                    scope="api",
                    operation="api.request_start",
                    status="start",
                    route=path,
                    method=request.method,
                    metadata={"client_ip": client_ip},
                )
            )
            request_event_id = request_event.id
            # Make the request span the ambient parent for everything downstream.
            # perf_timer does this for its own spans, but the request span is emitted
            # directly, so without this every event emitted outside a perf_timer block
            # (cache events, db.* from InstrumentedCursor) has no parent and becomes
            # its own root, flattening the waterfall (spec 03.2).
            span_token = set_current_span_id(request_event_id)
        try:
            try:
                response = await call_next(request)
            except Exception:
                process_time = time.time() - start_time
                duration_ms = round(process_time * 1000, 1)
                if is_dev_monitor_enabled():
                    emit_performance_event(
                        PerformanceEvent(
                            request_id=request_id,
                            parent_id=request_event_id,
                            level="error",
                            scope="api",
                            operation="api.request_error",
                            status="error",
                            route=request.url.path,
                            method=request.method,
                            duration_ms=duration_ms,
                            message="Unhandled request exception",
                            metadata={
                                "client_ip": client_ip,
                                "status_code": 500,
                                "closes_span_id": request_event_id,
                                "bytes": None,
                            },
                        )
                    )
                logger.exception(
                    "request.failed method=%s path=%s duration_ms=%.1f client_ip=%s",
                    request.method,
                    request.url.path,
                    process_time * 1000,
                    client_ip,
                    extra={
                        "request_id": request_id,
                        "method": request.method,
                        "path": request.url.path,
                        "status_code": 500,
                        "duration_ms": round(process_time * 1000, 1),
                        "client_ip": client_ip,
                    },
                )
                raise

            process_time = time.time() - start_time
            duration_ms = round(process_time * 1000, 1)
            if is_dev_monitor_enabled():
                emit_performance_event(
                    PerformanceEvent(
                        request_id=request_id,
                        parent_id=request_event_id,
                        level="warn" if process_time > 1.0 else "info",
                        scope="api",
                        operation="api.request_complete",
                        status="slow" if process_time > 1.0 else "success",
                        route=request.url.path,
                        method=request.method,
                        duration_ms=duration_ms,
                        metadata={
                            "client_ip": client_ip,
                            "status_code": response.status_code,
                            "closes_span_id": request_event_id,
                            "bytes": _response_bytes(response),
                        },
                    )
                )

            log_level = logging.WARNING if process_time > 1.0 else logging.INFO
            logger.log(
                log_level,
                "request.completed method=%s path=%s status=%s duration_ms=%.1f client_ip=%s",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
                client_ip,
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                    "client_ip": client_ip,
                },
            )

            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            reset_events_suppressed(suppression_token)
            if span_token is not None:
                reset_current_span_id(span_token)
            reset_current_request_id(request_token)
