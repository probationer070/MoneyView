from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from apps.api.core.logger import setup_logger

logger = setup_logger(__name__)

ASGIApp = Callable[[dict, Callable[[], Awaitable[dict]], Callable[[dict], Awaitable[None]]], Awaitable[None]]
KNOWN_SIZE_THRESHOLDS = (25, 50, 75, 100)


def _header_map(headers: list[tuple[bytes, bytes]]) -> dict[str, str]:
    return {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in headers}


def _request_id_from_scope(scope: dict) -> str:
    headers = _header_map(scope.get("headers", []))
    return headers.get("x-request-id", "")


def _transport_kind(content_type: str, total_bytes: int | None) -> str:
    if content_type.startswith("text/event-stream"):
        return "sse"
    if total_bytes is not None:
        return "known_size"
    return "chunked"


def log_transport_phase(
    *,
    request_id: str,
    method: str,
    path: str,
    phase: str,
    elapsed_ms: float,
    bytes_sent: int | None = None,
    chunk_count: int | None = None,
    completed: bool = False,
) -> None:
    logger.info(
        "transport.phase method=%s path=%s phase=%s elapsed_ms=%.1f bytes_sent=%s chunk_count=%s completed=%s",
        method,
        path,
        phase,
        elapsed_ms,
        bytes_sent if bytes_sent is not None else "",
        chunk_count if chunk_count is not None else "",
        completed,
        extra={
            "request_id": request_id,
            "method": method,
            "path": path,
            "phase": phase,
            "bytes_sent": bytes_sent,
            "chunk_count": chunk_count,
            "completed": completed,
            "transport_kind": "sse",
            "elapsed_ms": round(elapsed_ms, 1),
        },
    )


class TransportProgressMiddleware:
    """Log truthful transport progress for known-size and streaming HTTP responses."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "")
        request_id = _request_id_from_scope(scope)
        started_at = time.perf_counter()
        status_code = 200
        content_type = ""
        total_bytes: int | None = None
        bytes_sent = 0
        chunk_count = 0
        emitted_thresholds: set[int] = set()
        final_completion_logged = False

        async def send_wrapper(message):
            nonlocal status_code, content_type, total_bytes, bytes_sent, chunk_count, final_completion_logged

            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = _header_map(message.get("headers", []))
                content_type = headers.get("content-type", "")
                raw_content_length = headers.get("content-length")
                total_bytes = int(raw_content_length) if raw_content_length and raw_content_length.isdigit() else None
            elif message["type"] == "http.response.body":
                body = message.get("body", b"") or b""
                more_body = message.get("more_body", False)
                if body:
                    bytes_sent += len(body)
                    chunk_count += 1

                elapsed_ms = (time.perf_counter() - started_at) * 1000
                transport_kind = _transport_kind(content_type, total_bytes)

                if total_bytes and total_bytes > 0 and bytes_sent > 0:
                    progress_pct = min(round((bytes_sent / total_bytes) * 100, 1), 100.0)
                    thresholds = [threshold for threshold in KNOWN_SIZE_THRESHOLDS if progress_pct >= threshold and threshold not in emitted_thresholds]
                    if thresholds:
                        threshold = thresholds[-1]
                        emitted_thresholds.update(thresholds)
                        logger.info(
                            "transport.progress method=%s path=%s status=%s bytes_sent=%s total_bytes=%s progress_pct=%.1f elapsed_ms=%.1f completed=%s",
                            method,
                            path,
                            status_code,
                            bytes_sent,
                            total_bytes,
                            progress_pct,
                            elapsed_ms,
                            not more_body,
                            extra={
                                "request_id": request_id,
                                "method": method,
                                "path": path,
                                "status_code": status_code,
                                "bytes_sent": bytes_sent,
                                "total_bytes": total_bytes,
                                "progress_pct": progress_pct,
                                "chunk_count": chunk_count,
                                "completed": not more_body,
                                "transport_kind": transport_kind,
                                "elapsed_ms": round(elapsed_ms, 1),
                                "progress_threshold": threshold,
                            },
                        )
                elif bytes_sent > 0 and (chunk_count == 1 or chunk_count % 5 == 0 or not more_body):
                    logger.info(
                        "transport.progress method=%s path=%s status=%s bytes_sent=%s chunk_count=%s elapsed_ms=%.1f completed=%s",
                        method,
                        path,
                        status_code,
                        bytes_sent,
                        chunk_count,
                        elapsed_ms,
                        not more_body,
                        extra={
                            "request_id": request_id,
                            "method": method,
                            "path": path,
                            "status_code": status_code,
                            "bytes_sent": bytes_sent,
                            "chunk_count": chunk_count,
                            "completed": not more_body,
                            "transport_kind": transport_kind,
                            "elapsed_ms": round(elapsed_ms, 1),
                        },
                    )

                if not more_body and bytes_sent > 0 and not final_completion_logged:
                    final_completion_logged = True
                    progress_pct = (
                        min(round((bytes_sent / total_bytes) * 100, 1), 100.0)
                        if total_bytes and total_bytes > 0
                        else None
                    )
                    logger.info(
                        "transport.progress method=%s path=%s status=%s bytes_sent=%s total_bytes=%s progress_pct=%s chunk_count=%s elapsed_ms=%.1f completed=%s",
                        method,
                        path,
                        status_code,
                        bytes_sent,
                        total_bytes if total_bytes is not None else "",
                        progress_pct if progress_pct is not None else "",
                        chunk_count,
                        elapsed_ms,
                        True,
                        extra={
                            "request_id": request_id,
                            "method": method,
                            "path": path,
                            "status_code": status_code,
                            "bytes_sent": bytes_sent,
                            "total_bytes": total_bytes,
                            "progress_pct": progress_pct,
                            "chunk_count": chunk_count,
                            "completed": True,
                            "transport_kind": transport_kind,
                            "elapsed_ms": round(elapsed_ms, 1),
                        },
                    )

            await send(message)

        await self.app(scope, receive, send_wrapper)
