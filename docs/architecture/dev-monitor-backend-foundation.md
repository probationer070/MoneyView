# Dev Monitor Backend Foundation

This note defines the D1 backend foundation for the MoneyView development monitor. It is a design and ownership document only. It does not implement the monitor.

## Scope

D1 covers five backend foundations:

- one shared `PerformanceEvent` backend model
- one feature-flag helper for `MONEYVIEW_DEV_MONITOR`
- one backend event sink that can fan out to terminal, JSONL, and recent-memory storage
- one timing helper for consistent duration capture and slow-operation classification
- one compatibility rule that preserves the current request and transport logging behavior

This note intentionally does not define the D3 API payload shapes in full, frontend monitor rendering, or broad instrumentation rollout.

## Ownership

- `apps/api/models/schema_parts/dev_monitor.py`
  - owns the backend `PerformanceEvent` schema and dev-monitor summary models that later dev routes can return
- `apps/api/models/schemas.py`
  - re-exports `PerformanceEvent` only when it becomes part of `/api/v1/dev/*` responses
- `apps/api/core/dev_monitor.py`
  - owns the feature flag helper, sink configuration, recent-event buffer, event sanitization, and `perf_timer`
- `apps/api/core/middleware.py`
  - remains the owner of request ID assignment and request lifecycle interception
- `apps/api/core/logger.py`
  - remains the owner of the existing console and `api-server.log` behavior
- `apps/api/routes/dev_monitor.py`
  - deferred to D3; it will stay thin and call `apps/api/core/dev_monitor.py`

This keeps HTTP concerns in routes, backend-local instrumentation in `apps/api/core`, and API-facing schemas in `apps/api/models`.

## Event Model

The backend should standardize on one Pydantic model that all monitor emitters use before any dev API is added.

Recommended model shape:

```python
class PerformanceEvent(BaseModel):
    id: str
    timestamp: datetime
    request_id: str | None = None
    parent_id: str | None = None
    level: Literal["debug", "info", "warn", "error"]
    scope: Literal[
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
    operation: str
    status: Literal[
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
```

Field contract:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | `str` | yes | Stable event identifier for buffering, replay, and SSE deduplication. |
| `timestamp` | `datetime` | yes | UTC event creation time, serialized as ISO 8601 with timezone. |
| `request_id` | `str \| None` | no | Request correlation ID from `request.state.request_id` and `X-Request-ID`. |
| `parent_id` | `str \| None` | no | Parent event ID for grouped operations such as request lifecycle or page-load spans. |
| `level` | literal | yes | Logging severity: `debug`, `info`, `warn`, or `error`. |
| `scope` | literal | yes | Functional area that owns the event, such as `api`, `db`, `external`, `cache`, `metric`, or `system`. |
| `operation` | `str` | yes | Stable machine-readable operation name such as `api.request_complete` or `db.select_watchlist`. |
| `status` | literal | yes | Outcome classification such as `start`, `success`, `error`, `slow`, `warning`, `cache_hit`, or `cache_miss`. |
| `duration_ms` | `float \| None` | no | Elapsed time in milliseconds for measured operations. |
| `ticker` | `str \| None` | no | Ticker symbol when the event is tied to one security or one dominant symbol. |
| `route` | `str \| None` | no | HTTP route or logical request path, usually from the FastAPI request URL path. |
| `method` | `str \| None` | no | HTTP method for request-scoped events, such as `GET` or `POST`. |
| `table` | `str \| None` | no | Database table or read-model name for storage-related operations. |
| `provider` | `str \| None` | no | External provider name such as `yfinance`, `fred`, or `ecos`. |
| `component` | `str \| None` | no | Logical backend or frontend component label when an operation is component-owned. |
| `warning_code` | `str \| None` | no | Compact symbolic warning code, especially for data-quality or fallback warnings. |
| `error_code` | `str \| None` | no | Compact symbolic error code, not a raw stack trace. |
| `message` | `str \| None` | no | Short human-readable detail suitable for logs and monitor UI. |
| `metadata` | `dict[str, Any]` | yes | Small JSON-serializable operational details such as row count, cache age, retry count, or stale reason. |

Required field rule:

- Always present: `id`, `timestamp`, `level`, `scope`, `operation`, `status`, `metadata`
- Optional-by-context: all other fields

Normalization rules:

- `request_id`, `parent_id`, `ticker`, `route`, `method`, `table`, `provider`, `component`, `warning_code`, `error_code`, and `message` should be omitted or `null` when not applicable.
- `ticker` should be normalized to uppercase when it represents a public market symbol.
- `method` should be uppercase.
- `duration_ms` should be rounded consistently for serialization, with raw timing precision kept only in local calculation before emission.
- `metadata` must stay small and JSON-serializable; it must not contain secrets, raw provider payloads, cookies, authorization headers, or large statement payloads.

Design decisions:

- Keep `id` even though the D1 checklist does not name it explicitly. The source plan in `guideline/sop/suggestion.md` includes it, and D3 SSE plus frontend buffering need a stable event key.
- Store `timestamp` as UTC and serialize to ISO 8601 with timezone.
- Use snake_case in Python even though the original note uses mixed casing. If dev APIs later want camelCase for TypeScript, convert at the API boundary or in shared-type generation.
- Keep `metadata` JSON-serializable only. Allowed values should be scalars, lists, and nested dictionaries of the same. Do not attach raw provider payloads, cookies, headers, or large DataFrames.
- Keep field meanings narrow:
  - `operation`: stable machine-readable name such as `api.request_complete` or `db.select_watchlist`
  - `message`: short human-readable detail
  - `warning_code` and `error_code`: compact symbolic codes, not stack traces

## Feature Flag

D1 should add one helper:

```python
def is_dev_monitor_enabled() -> bool:
    return os.getenv("MONEYVIEW_DEV_MONITOR", "").strip().lower() == "true"
```

Behavior rules:

- Enabled only when the environment variable is exactly `true` after trim and lowercase normalization.
- Missing, empty, `false`, `1`, `yes`, and all other values mean disabled.
- When disabled:
  - no `/api/v1/dev/*` routes are mounted or they return `404`
  - the event sink becomes a no-op
  - existing request and transport logging still works exactly as it does now

Prefer `404` for disabled dev routes so the surfaces are absent rather than merely forbidden.

## Event Sink

D1 should introduce one sink abstraction instead of scattering direct writes across middleware and services.

Recommended interface:

```python
class DevMonitorSink:
    def emit(self, event: PerformanceEvent) -> None: ...
    def recent(self, limit: int = 500) -> list[PerformanceEvent]: ...
    def slow(self, limit: int = 100) -> list[PerformanceEvent]: ...
    def errors(self, limit: int = 100) -> list[PerformanceEvent]: ...
```

Fan-out targets when enabled:

- terminal: concise readable event line for local live inspection
- JSONL file: one event per line for later replay and D3 summary endpoints
- bounded in-memory deque: recent event access for low-latency dev APIs

Recommended D1 defaults:

- recent buffer size: `2000`
- slow threshold default: `1000ms` for `scope="api"` and `250ms` for all other scopes
- default JSONL path: `data/cache/logs/performance/YYYY-MM-DD.jsonl`
- default local retention: keep short local history only, targeting `7` days unless `MONEYVIEW_DEV_MONITOR_RETENTION_DAYS` overrides it

Compatibility rules:

- Do not replace the current root logger pipeline.
- Do not rewrite `api-server.log` into `PerformanceEvent` lines.
- Treat the dev-monitor sink as an additional output path that coexists with the current logger.
- Keep transport and request log message formats stable so `tests/api/test_transport_progress.py` remains the regression baseline.

## Timing Helper

D1 should provide one timer helper that standardizes event duration capture and slow classification.

Recommended shape:

```python
@contextmanager
def perf_timer(
    *,
    scope: str,
    operation: str,
    request_id: str | None = None,
    parent_id: str | None = None,
    slow_threshold_ms: float | None = None,
    **event_fields,
):
    ...
```

Behavior rules:

- Use `time.perf_counter()` for duration measurement.
- Emit a `start` event only for long-lived or grouped operations where start visibility matters, such as request lifecycle or SSE/page-load groups.
- For ordinary short operations, emitting a single completion event is acceptable if it still includes duration and status.
- On success:
  - emit `status="success"` by default
  - upgrade to `status="slow"` when duration exceeds the threshold
- On failure:
  - emit `status="error"`
  - set `level="error"`
  - attach a compact `message` and optional `error_code`
  - re-raise the exception

This keeps instrumentation consistent without forcing every callsite to manually compute elapsed time and severity.

## Request Identity

The current request ID path stays canonical:

- `apps/api/core/middleware.py` creates `request.state.request_id`
- `X-Request-ID` remains the response header
- new monitor events reuse that same value

No second correlation identifier should be introduced in D1. If child operations need grouping, use `parent_id` on events instead of another request-scoped ID system.

## Request Lifecycle Mapping

The existing middleware is the correct owner for initial API monitor events.

Recommended mapping:

- before `call_next(request)`: emit `api.request_start`
- after successful response: emit `api.request_complete`
- inside the exception path: emit `api.request_error`

Expected event fields:

- `request_id`
- `route`
- `method`
- `status`
- `duration_ms`
- `message` for failures
- `metadata.client_ip` only if kept local and already considered acceptable in current logs

This mapping should coexist with the existing logger calls rather than replace them in D1.

## Sanitization Rules

The sink must sanitize before writing any target:

- never log authorization headers, cookies, tokens, credentials, or raw provider responses
- never log full SQL payloads or large financial statement payloads
- keep `message` short and scrub obvious secrets
- keep `metadata` bounded to small operational facts such as row count, cache status, retry count, and stale age
- treat dev-monitor JSONL files as local development artifacts only; do not persist them for production telemetry, remote analytics, or long-term audit storage

If a value would make the event materially large or sensitive, reduce it to a code, count, boolean, or short summary first.

## D1 File Plan

The expected implementation footprint for D1, when coding starts later, is:

- `apps/api/models/schema_parts/dev_monitor.py`
- `apps/api/models/schemas.py`
- `apps/api/core/dev_monitor.py`
- `apps/api/core/middleware.py`
- `apps/api/core/logger.py`
- targeted backend tests under `tests/api/`

D1 should avoid touching `apps/web` and should avoid introducing `packages/shared-types` changes until a dev route actually exposes these payloads to the frontend.

## Verification Plan

Targeted D1 verification should cover:

- feature flag disabled:
  - sink is a no-op
  - dev routes are unavailable
  - existing request/transport log tests still pass unchanged
- feature flag enabled:
  - a request emits monitor events with the existing request ID
  - the JSONL sink writes one JSON object per line
  - the recent buffer enforces its cap
  - `perf_timer` classifies slow and error cases consistently

The current regression baseline remains `tests/api/test_transport_progress.py`.

## Non-Goals

D1 should not do the following:

- no frontend monitor page
- no SSE dev stream endpoint
- no summary aggregation endpoint
- no provider-wide instrumentation rollout outside the shared foundation
- no daily file rotation yet; that belongs to D7
- no third-party telemetry or production monitoring integration

## Exit Criteria

D1 is ready for implementation when the coding work can proceed without reopening architecture questions about:

- where the model lives
- how the feature flag behaves
- how events are emitted and stored
- how timing and slow classification work
- how monitor events coexist with the current logger and request ID middleware
