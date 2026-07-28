from __future__ import annotations

from datetime import datetime
from typing import Literal, Union

from pydantic import BaseModel, Field


class CollapsedNode(BaseModel):
    """Replaces an elided subtree so the UI cannot render an absence as 'no children'."""

    collapsed_count: int
    total_ms: float
    deepest_scope: str


class SpanNode(BaseModel):
    id: str
    parent_id: str | None = None
    operation: str
    scope: str
    status: str
    total_ms: float | None = None
    self_ms: float | None = None
    offset_ms: float = 0.0
    clock_skew: bool = False
    orphaned: bool = False
    ticker: str | None = None
    table: str | None = None
    component: str | None = None
    rows: int | None = None
    bytes: int | None = None
    series_points: int | None = None
    cache_state: str | None = None
    children: list[Union["SpanNode", CollapsedNode]] = Field(default_factory=list)


class RequestSummaryRow(BaseModel):
    request_id: str
    route: str | None = None
    method: str | None = None
    started_at: datetime
    ended_at: datetime | None = None
    total_ms: float | None = None
    span_count: int
    ticker_count: int
    status: str
    partial: bool = False


class RequestIndex(BaseModel):
    requests: list[RequestSummaryRow] = Field(default_factory=list)
    limit: int
    buffer_used: int
    buffer_limit: int


class RequestWaterfall(BaseModel):
    request_id: str
    route: str | None = None
    total_ms: float | None = None
    span_count: int
    partial: bool = False
    truncated: bool = False
    overlap_detected: bool = False
    root: SpanNode


class TickerCostRow(BaseModel):
    ticker: str
    self_ms: float
    span_count: int
    db_ms: float = 0.0
    calculation_ms: float = 0.0
    external_ms: float = 0.0
    cache_hits: int = 0
    cache_misses: int = 0
    rows_read: int = 0
    bytes: int | None = None
    series_points: int | None = None


class TickerCostTable(BaseModel):
    rows: list[TickerCostRow] = Field(default_factory=list)
    ticker_count: int = 0
    total_self_ms: float = 0.0
    p50_ms: float = 0.0
    p95_ms: float = 0.0
    max_ms: float = 0.0
    cv: float = 0.0
    distribution: Literal["uniform", "mixed", "skewed"] = "uniform"


class ScopeRow(BaseModel):
    scope: str
    self_ms: float
    pct_of_total: float
    event_count: int
    slow_count: int


class ScopeBreakdown(BaseModel):
    scopes: list[ScopeRow] = Field(default_factory=list)
    total_ms: float = 0.0
    unattributed_ms: float = 0.0
    overlap_detected: bool = False


class CacheRow(BaseModel):
    """estimated_time_saved_ms assumes a miss would have cost this cache's observed
    average fill cost. Defensible for a TTL cache over stable data; wrong if fill
    costs are bimodal (cold vs. warm SQLite page cache).

    avg_miss_cost_ms is sourced from `cache.populate` spans, which wrap the fetch a
    miss triggers. `fills` is how many timed fills back that average -- a large
    `misses` with `fills == 0` means the cost is unmeasured, not zero."""

    component: str
    hits: int
    misses: int
    fills: int = 0
    hit_rate: float
    avg_miss_cost_ms: float
    estimated_time_saved_ms: float


class CacheReport(BaseModel):
    caches: list[CacheRow] = Field(default_factory=list)


SpanNode.model_rebuild()
