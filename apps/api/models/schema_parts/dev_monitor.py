from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


PerformanceEventLevel = Literal["debug", "info", "warn", "error"]
PerformanceEventScope = Literal[
    "api",
    "db",
    "external",
    "cache",
    "normalization",
    "metric",
    "calculation",
    "page_load",
    "worker",
    "chart",
    "data_quality",
    "system",
]
PerformanceEventStatus = Literal[
    "start",
    "success",
    "error",
    "slow",
    "invalid",
    "cache_hit",
    "cache_miss",
    "warning",
    "canceled",
]


class PerformanceEvent(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    request_id: str | None = None
    parent_id: str | None = None
    level: PerformanceEventLevel
    scope: PerformanceEventScope
    operation: str
    status: PerformanceEventStatus
    duration_ms: float | None = None
    ticker: str | None = None
    route: str | None = None
    method: str | None = None
    table: str | None = None
    provider: str | None = None
    component: str | None = None
    warning_code: str | None = None
    error_code: str | None = None
    message: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("timestamp")
    @classmethod
    def _timestamp_must_be_timezone_aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must be timezone-aware")
        return value.astimezone(timezone.utc)

    @field_validator("ticker")
    @classmethod
    def _normalize_ticker(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        return normalized or None

    @field_validator("method")
    @classmethod
    def _normalize_method(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        return normalized or None

    @field_validator(
        "request_id",
        "parent_id",
        "route",
        "table",
        "provider",
        "component",
        "warning_code",
        "error_code",
        "message",
    )
    @classmethod
    def _strip_optional_strings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("duration_ms")
    @classmethod
    def _normalize_duration(cls, value: float | None) -> float | None:
        if value is None:
            return None
        return round(float(value), 1)


class PerformanceEventListResponse(BaseModel):
    events: list[PerformanceEvent] = Field(default_factory=list)
    limit: int


class PerformanceSummary(BaseModel):
    active_requests: int = 0
    avg_api_latency_ms: float = 0.0
    p95_api_latency_ms: float = 0.0
    slow_operations: int = 0
    errors: int = 0
    cache_hit_rate: float = 0.0


class ClientPerformanceEventRequest(BaseModel):
    level: PerformanceEventLevel = "info"
    scope: PerformanceEventScope
    operation: str
    status: PerformanceEventStatus
    duration_ms: float | None = None
    ticker: str | None = None
    route: str | None = None
    method: str | None = None
    provider: str | None = None
    component: str | None = None
    warning_code: str | None = None
    error_code: str | None = None
    message: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
