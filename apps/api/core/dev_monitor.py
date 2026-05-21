from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from apps.api.core.logger import setup_logger
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent, PerformanceSummary

logger = setup_logger(__name__)

_DEFAULT_PERFORMANCE_LOG_DIRECTORY = Path("data/cache/logs/performance")
_RECENT_EVENT_LIMIT = 2000
_DEFAULT_LIMIT = 500
_DEFAULT_RETENTION_DAYS = 7
_current_request_id: ContextVar[str | None] = ContextVar("moneyview_dev_monitor_request_id", default=None)


def is_dev_monitor_enabled() -> bool:
    return os.getenv("MONEYVIEW_DEV_MONITOR", "").strip().lower() == "true"


def get_dev_monitor_log_path() -> Path:
    configured_path = os.getenv("MONEYVIEW_DEV_MONITOR_LOG_PATH", "").strip()
    current_day = datetime.now(UTC).date().isoformat()
    if not configured_path:
        return _DEFAULT_PERFORMANCE_LOG_DIRECTORY / f"{current_day}.jsonl"
    configured = Path(configured_path)
    if configured.suffix.lower() == ".jsonl":
        return configured
    return configured / f"{current_day}.jsonl"


def get_dev_monitor_retention_days() -> int:
    raw_value = os.getenv("MONEYVIEW_DEV_MONITOR_RETENTION_DAYS", "").strip()
    if not raw_value:
        return _DEFAULT_RETENTION_DAYS
    try:
        return max(1, int(raw_value))
    except ValueError:
        return _DEFAULT_RETENTION_DAYS


def slow_threshold_ms_for_scope(scope: str) -> float:
    return 1000.0 if scope == "api" else 250.0


def set_current_request_id(request_id: str | None) -> Token[str | None]:
    return _current_request_id.set(request_id)


def reset_current_request_id(token: Token[str | None]) -> None:
    _current_request_id.reset(token)


def get_current_request_id() -> str | None:
    return _current_request_id.get()


def _sanitize_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if not metadata:
        return {}
    sanitized: dict[str, Any] = {}
    blocked_tokens = ("authorization", "cookie", "token", "secret", "password", "credential")
    for key, value in metadata.items():
        lowered_key = str(key).lower()
        if any(token in lowered_key for token in blocked_tokens):
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            sanitized[str(key)] = value
        elif isinstance(value, list):
            sanitized[str(key)] = [
                item for item in value if isinstance(item, (str, int, float, bool)) or item is None
            ]
        elif isinstance(value, dict):
            nested: dict[str, Any] = {}
            for nested_key, nested_value in value.items():
                nested_lowered = str(nested_key).lower()
                if any(token in nested_lowered for token in blocked_tokens):
                    continue
                if isinstance(nested_value, (str, int, float, bool)) or nested_value is None:
                    nested[str(nested_key)] = nested_value
            sanitized[str(key)] = nested
    return sanitized


class DevMonitorSink:
    def emit(self, event: PerformanceEvent) -> PerformanceEvent:
        return event

    def recent(self, limit: int = _DEFAULT_LIMIT) -> list[PerformanceEvent]:
        return []

    def slow(self, limit: int = 100) -> list[PerformanceEvent]:
        return []

    def errors(self, limit: int = 100) -> list[PerformanceEvent]:
        return []

    def summary(self) -> PerformanceSummary:
        return PerformanceSummary()

    def events_after(self, last_sequence: int) -> tuple[int, list[PerformanceEvent]]:
        return last_sequence, []


class NoOpDevMonitorSink(DevMonitorSink):
    pass


class ActiveDevMonitorSink(DevMonitorSink):
    def __init__(self, *, log_path: Path, recent_limit: int = _RECENT_EVENT_LIMIT):
        self.log_path = log_path
        self._recent_limit = recent_limit
        self._recent_events: deque[PerformanceEvent] = deque(maxlen=recent_limit)
        self._sequenced_events: deque[tuple[int, PerformanceEvent]] = deque(maxlen=recent_limit)
        self._next_sequence = 0
        self._lock = threading.Lock()
        self._cleanup_old_jsonl_logs()

    def emit(self, event: PerformanceEvent) -> PerformanceEvent:
        sanitized_event = event.model_copy(update={"metadata": _sanitize_metadata(event.metadata)})
        with self._lock:
            self._next_sequence += 1
            self._recent_events.append(sanitized_event)
            self._sequenced_events.append((self._next_sequence, sanitized_event))
            self._append_jsonl(sanitized_event)
        self._emit_terminal(sanitized_event)
        return sanitized_event

    def recent(self, limit: int = _DEFAULT_LIMIT) -> list[PerformanceEvent]:
        bounded_limit = max(0, min(limit, self._recent_limit))
        if bounded_limit == 0:
            return []
        with self._lock:
            return list(self._recent_events)[-bounded_limit:]

    def slow(self, limit: int = 100) -> list[PerformanceEvent]:
        bounded_limit = max(0, min(limit, self._recent_limit))
        if bounded_limit == 0:
            return []
        with self._lock:
            events = [event for event in self._recent_events if event.status == "slow"]
        return events[-bounded_limit:]

    def errors(self, limit: int = 100) -> list[PerformanceEvent]:
        bounded_limit = max(0, min(limit, self._recent_limit))
        if bounded_limit == 0:
            return []
        with self._lock:
            events = [event for event in self._recent_events if event.level == "error" or event.status == "error"]
        return events[-bounded_limit:]

    def summary(self) -> PerformanceSummary:
        with self._lock:
            events = list(self._recent_events)
        api_events = [event for event in events if event.scope == "api" and event.operation == "api.request_complete" and event.duration_ms is not None]
        api_latencies = sorted(float(event.duration_ms) for event in api_events)
        cache_events = [event for event in events if event.scope == "cache" and event.status in {"cache_hit", "cache_miss"}]
        cache_hits = sum(1 for event in cache_events if event.status == "cache_hit")
        active_requests = 0
        for event in events:
            if event.scope == "api" and event.operation == "api.request_start":
                active_requests += 1
            elif event.scope == "api" and event.operation in {"api.request_complete", "api.request_error"}:
                active_requests = max(active_requests - 1, 0)
        avg_latency = round(sum(api_latencies) / len(api_latencies), 1) if api_latencies else 0.0
        p95_latency = 0.0
        if api_latencies:
            index = max(0, int(len(api_latencies) * 0.95) - 1)
            p95_latency = round(api_latencies[index], 1)
        cache_hit_rate = round(cache_hits / len(cache_events), 4) if cache_events else 0.0
        return PerformanceSummary(
            active_requests=active_requests,
            avg_api_latency_ms=avg_latency,
            p95_api_latency_ms=p95_latency,
            slow_operations=sum(1 for event in events if event.status == "slow"),
            errors=sum(1 for event in events if event.level == "error" or event.status == "error"),
            cache_hit_rate=cache_hit_rate,
        )

    def events_after(self, last_sequence: int) -> tuple[int, list[PerformanceEvent]]:
        with self._lock:
            newest_sequence = self._next_sequence
            events = [event for sequence, event in self._sequenced_events if sequence > last_sequence]
        return newest_sequence, events

    def _append_jsonl(self, event: PerformanceEvent) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(event.model_dump_json())
            handle.write("\n")

    def _cleanup_old_jsonl_logs(self) -> None:
        retention_days = get_dev_monitor_retention_days()
        cutoff_day = datetime.now(UTC).date() - timedelta(days=retention_days - 1)
        log_directory = self.log_path.parent
        if not log_directory.exists():
            return
        for candidate in log_directory.glob("*.jsonl"):
            if candidate == self.log_path:
                continue
            try:
                candidate_day = datetime.strptime(candidate.stem, "%Y-%m-%d").date()
            except ValueError:
                continue
            if candidate_day < cutoff_day:
                try:
                    candidate.unlink()
                except OSError:
                    logger.warning("dev.monitor cleanup failed for %s", candidate)

    def _emit_terminal(self, event: PerformanceEvent) -> None:
        duration = f" | duration={event.duration_ms}ms" if event.duration_ms is not None else ""
        request_id = f" | request_id={event.request_id}" if event.request_id else ""
        target = event.route or event.table or event.provider or event.component or "-"
        logger.info(
            "dev.monitor scope=%s operation=%s status=%s target=%s%s%s",
            event.scope,
            event.operation,
            event.status,
            target,
            duration,
            request_id,
        )


_sink: DevMonitorSink = NoOpDevMonitorSink()


def reset_dev_monitor_sink() -> None:
    global _sink
    _sink = NoOpDevMonitorSink()


def get_dev_monitor_sink() -> DevMonitorSink:
    global _sink
    if isinstance(_sink, NoOpDevMonitorSink) and is_dev_monitor_enabled():
        _sink = ActiveDevMonitorSink(log_path=get_dev_monitor_log_path())
    return _sink


def emit_performance_event(event: PerformanceEvent) -> PerformanceEvent:
    return get_dev_monitor_sink().emit(event)


def emit_cache_event(
    *,
    operation: str,
    status: str,
    ticker: str | None = None,
    route: str | None = None,
    component: str | None = None,
    provider: str | None = None,
    duration_ms: float | None = None,
    message: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> PerformanceEvent:
    return emit_performance_event(
        PerformanceEvent(
            request_id=get_current_request_id(),
            level="warn" if status == "warning" else "info",
            scope="cache",
            operation=operation,
            status=status,
            duration_ms=duration_ms,
            ticker=ticker,
            route=route,
            component=component,
            provider=provider,
            message=message,
            metadata=metadata or {},
        )
    )


def emit_data_quality_warning_event(
    *,
    operation: str,
    ticker: str | None = None,
    warning_code: str | None = None,
    message: str | None = None,
    component: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> PerformanceEvent:
    return emit_performance_event(
        PerformanceEvent(
            request_id=get_current_request_id(),
            level="warn",
            scope="data_quality",
            operation=operation,
            status="warning",
            ticker=ticker,
            component=component,
            warning_code=warning_code,
            message=message,
            metadata=metadata or {},
        )
    )


def _event_payload(
    base_context: dict[str, Any],
    *,
    parent_id: str | None,
    metadata: dict[str, Any],
    **overrides: Any,
) -> dict[str, Any]:
    payload = dict(base_context)
    payload["parent_id"] = parent_id
    payload["metadata"] = metadata
    payload.update(overrides)
    return payload


@contextmanager
def perf_timer(
    *,
    scope: str,
    operation: str,
    request_id: str | None = None,
    parent_id: str | None = None,
    slow_threshold_ms: float | None = None,
    level: str = "info",
    emit_start: bool = False,
    message: str | None = None,
    metadata: dict[str, Any] | None = None,
    **event_fields: Any,
) -> Iterator[dict[str, Any]]:
    threshold_ms = slow_threshold_ms if slow_threshold_ms is not None else slow_threshold_ms_for_scope(scope)
    event_context = {
        "request_id": request_id,
        "parent_id": parent_id,
        "level": level,
        "scope": scope,
        "operation": operation,
        "message": message,
        "metadata": metadata or {},
        **event_fields,
    }
    start_event: PerformanceEvent | None = None
    if emit_start and is_dev_monitor_enabled():
        start_event = emit_performance_event(
            PerformanceEvent(
                **event_context,
                status="start",
            )
        )

    started_at = time.perf_counter()
    mutable_metadata = event_context["metadata"]

    try:
        yield mutable_metadata
    except Exception as exc:
        duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
        error_metadata = dict(mutable_metadata)
        error_metadata.setdefault("exception_type", type(exc).__name__)
        emit_performance_event(
            PerformanceEvent(
                **_event_payload(
                    event_context,
                    parent_id=start_event.id if start_event else parent_id,
                    metadata=error_metadata,
                    level="error",
                    status="error",
                    duration_ms=duration_ms,
                    message=message or str(exc),
                )
            )
        )
        raise

    duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
    status = "slow" if duration_ms >= threshold_ms else "success"
    emit_performance_event(
        PerformanceEvent(
            **_event_payload(
                event_context,
                parent_id=start_event.id if start_event else parent_id,
                metadata=dict(mutable_metadata),
                status=status,
                duration_ms=duration_ms,
            )
        )
    )
