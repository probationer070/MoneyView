````markdown
# MoneyView Dev Monitor — Functional Detail Plan

## Purpose

Add a development-only observability system to MoneyView that shows:

- structured backend logs
- real-time operation latency
- per-ticker data collection time
- database query time
- metric calculation time
- API response time
- frontend chart/render timing
- data-quality warnings
- slow operation detection

This feature is for local debugging, performance analysis, and data-quality auditing.

---

# 1. Feature Scope

## Included

### Backend observability
- API request start/end timing
- SQLite query timing
- yfinance fetch timing
- cache hit/miss logging
- ROIC/WACC calculation timing
- DCF calculation timing
- attribution calculation timing
- Monte Carlo backend timing
- data normalization timing
- missing-field and invalid-metric warnings

### Frontend observability
- React Query request timing
- page load timing
- chart render timing
- Monte Carlo worker timing
- chart failure events
- frontend validation failures

### Real-time display
- terminal logs
- JSONL file logs
- in-memory recent event buffer
- SSE streaming
- `/dev/monitor` dashboard

---

## Excluded for now

- remote telemetry
- cloud logging
- user analytics
- production monitoring
- authentication-based admin dashboard
- distributed tracing tools such as OpenTelemetry, Jaeger, or Grafana

---

# 2. Feature Flag

The monitor must be development-only.

## Environment variable

```env
MONEYVIEW_DEV_MONITOR=true
````

## Behavior

If disabled:

```text
/api/v1/dev/* → disabled or 404
/dev/monitor → disabled page or 404
performance events → file/terminal only if explicitly enabled
```

Recommended:

```text
Default = disabled
Development launcher = enabled
Production/Tauri release = disabled
```

---

# 3. Core Data Model

## 3.1 PerformanceEvent

All logging and visualization should use one shared event model.

```ts
type PerformanceEvent = {
  id: string;
  timestamp: string;

  requestId?: string;
  parentId?: string;

  level: "debug" | "info" | "warn" | "error";

  scope:
    | "api"
    | "db"
    | "external"
    | "cache"
    | "normalization"
    | "metric"
    | "calculation"
    | "page_load"
    | "worker"
    | "chart"
    | "data_quality"
    | "system";

  operation: string;

  status:
    | "start"
    | "success"
    | "error"
    | "slow"
    | "invalid"
    | "cache_hit"
    | "cache_miss"
    | "warning"
    | "canceled";

  durationMs?: number;

  ticker?: string;
  route?: string;
  method?: string;
  table?: string;
  provider?: string;
  component?: string;

  message?: string;
  warningCode?: string;
  errorCode?: string;

  metadata?: Record<string, unknown>;
};
```

---

# 4. Backend Functional Requirements

## 4.1 Request ID Middleware

Every API request must receive a request ID.

### Behavior

For every request:

```text
create request_id
attach request_id to request.state
add request_id to response header
emit api.request_start
emit api.request_complete
```

### Response header

```http
X-Request-ID: req_20260502_141231_a8f2
```

---

## 4.2 API Timing

Each route should emit:

```text
api.request_start
api.request_complete
api.request_error
```

### Captured fields

* route path
* HTTP method
* status code
* duration
* request ID
* response size if available
* error message if failed

---

## 4.3 Database Timing

Every repository/database operation should be wrapped in a timer.

### Required metadata

* table name
* operation type

  * select
  * insert
  * update
  * delete
  * upsert
* rows returned or affected
* duration
* request ID

### Example event

```json
{
  "scope": "db",
  "operation": "select_watchlist",
  "table": "watchlist",
  "durationMs": 12.4,
  "status": "success",
  "metadata": {
    "rows": 37
  }
}
```

---

## 4.4 External Provider Timing

Every yfinance call should emit one event per ticker and data type.

### Required operations

```text
fetch_quote
fetch_history
fetch_income_statement
fetch_balance_sheet
fetch_cashflow
fetch_info
fetch_news
```

### Required metadata

* ticker
* provider
* duration
* cache hit/miss
* missing fields
* retry count if applicable
* error if failed

### Example

```json
{
  "scope": "external",
  "operation": "fetch_balance_sheet",
  "ticker": "AAPL",
  "provider": "yfinance",
  "durationMs": 842,
  "status": "success",
  "metadata": {
    "cache": "miss",
    "rows": 4,
    "missingFields": []
  }
}
```

---

## 4.5 Cache Logging

Cache access should emit:

```text
cache.lookup
cache.hit
cache.miss
cache.write
cache.stale
```

### Required metadata

* cache key
* ticker if applicable
* cache age
* TTL
* source
* fallback used

---

## 4.6 Metric Calculation Logging

Each important metric must emit a timing event.

### Metrics to log

* ROIC
* WACC
* ROIC - WACC
* DCF upside
* Expected vs Market
* Volatility
* Beta
* VaR
* CVaR
* attribution effects

### Required metadata

* ticker
* metric name
* duration
* quality
* calculation version
* warnings

### Example

```json
{
  "scope": "metric",
  "operation": "calculate_roic",
  "ticker": "TSLA",
  "durationMs": 4.2,
  "status": "invalid",
  "metadata": {
    "quality": "invalid",
    "reason": "near_zero_invested_capital",
    "calculationVersion": "roic_v2_average_invested_capital"
  }
}
```

---

## 4.7 Data Quality Logging

ROIC/WACC validation should emit warnings.

### Warning examples

```text
missing_operating_income
missing_total_debt
missing_total_equity
missing_cash
near_zero_invested_capital
negative_invested_capital
invalid_tax_rate
beta_out_of_range
cost_of_debt_unavailable
currency_mismatch
```

### UI behavior

These warnings should appear in:

* `/dev/monitor`
* calculation audit modal
* terminal logs
* JSONL logs

---

## 4.8 Page Load Group Logging

Backend should support grouped traces.

### Example groups

```text
market_overview_load
portfolio_load
corporate_metrics_load
corporate_comparison_load
monte_carlo_run
news_feed_load
```

### Required behavior

A group should contain multiple child events.

Example:

```text
portfolio_load
├─ get_watchlist
├─ get_latest_metrics
├─ get_attribution
├─ get_news
└─ response_complete
```

---

# 5. Frontend Functional Requirements

## 5.1 Dev Monitor Route

Create:

```text
apps/web/app/dev/monitor/page.tsx
```

### Page sections

```text
Header
KPI Row
Live Operation Latency
Per-Ticker Fetch Latency
Page Load Timeline
Metric Calculation Latency
Slow Operations
Data Quality Warnings
Live Log Stream
```

---

## 5.2 SSE Client Hook

Create:

```text
apps/web/app/dev/monitor/hooks/usePerformanceStream.ts
```

### Responsibilities

* connect to `/api/v1/dev/log-stream`
* append incoming events
* reconnect on disconnect
* expose connection state
* pause/resume stream
* clear local buffer
* cap event count

### Hook API

```ts
type UsePerformanceStreamResult = {
  events: PerformanceEvent[];
  connectionStatus: "connecting" | "connected" | "disconnected" | "error";
  pause: () => void;
  resume: () => void;
  clear: () => void;
  isPaused: boolean;
};
```

---

## 5.3 Monitor Controls

The monitor page should support:

* pause stream
* resume stream
* clear logs
* export visible events
* filter by scope
* filter by ticker
* filter by route
* show slow only
* show errors only
* search operation name

---

# 6. Visualization Requirements

## 6.1 KPI Row

Display:

* active requests
* average API latency
* p95 API latency
* slow operations count
* error count
* cache hit rate
* latest event time

---

## 6.2 Operation Latency Bar Chart

Purpose:

Show most recent operation durations.

### Data

```ts
type OperationLatencyRow = {
  label: string;
  scope: string;
  durationMs: number;
  status: "success" | "slow" | "error";
};
```

### Display

Horizontal bars sorted by latest or duration.

---

## 6.3 Per-Ticker Fetch Latency Bar Chart

Purpose:

Identify slow yfinance tickers.

### Data

```ts
type TickerFetchLatencyRow = {
  ticker: string;
  operation: string;
  provider: string;
  durationMs: number;
  cacheStatus: "hit" | "miss" | "stale" | "unknown";
  status: "success" | "slow" | "error";
};
```

### Display

* ticker label
* operation label
* duration
* cache badge
* status badge

---

## 6.4 Page Load Timeline

Purpose:

Show where full page loading time is spent.

### Data

```ts
type PageLoadTimelineRow = {
  page: string;
  step: string;
  durationMs: number;
  requestId?: string;
  status: "success" | "slow" | "error";
};
```

### Display

Grouped timeline per request/page.

---

## 6.5 Metric Calculation Latency

Purpose:

Show calculation costs for ROIC/WACC/DCF/Attribution.

### Data

```ts
type MetricCalculationRow = {
  ticker?: string;
  metric: string;
  durationMs: number;
  quality?: string;
  warnings?: string[];
};
```

---

## 6.6 Data Quality Warning Panel

Purpose:

Make invalid financial data visible.

### Display fields

* ticker
* metric
* warning code
* message
* source
* timestamp
* request ID
* link to audit if available

---

## 6.7 Live Log Stream

Purpose:

Show raw event sequence.

### Display

Monospace compact rows:

```text
time | level | scope | operation | ticker | duration | status
```

---

# 7. Backend Dev APIs

## 7.1 SSE Stream

```text
GET /api/v1/dev/log-stream
```

Streams live `PerformanceEvent`.

---

## 7.2 Recent Events

```text
GET /api/v1/dev/performance/recent?limit=500
```

Returns recent ring-buffer events.

---

## 7.3 Slow Operations

```text
GET /api/v1/dev/performance/slow?limit=100
```

Returns events above threshold.

---

## 7.4 Errors

```text
GET /api/v1/dev/performance/errors?limit=100
```

Returns recent errors.

---

## 7.5 Summary

```text
GET /api/v1/dev/performance/summary
```

Returns aggregate stats.

Example:

```json
{
  "activeRequests": 2,
  "avgApiLatencyMs": 842,
  "p95ApiLatencyMs": 2100,
  "slowOperations": 4,
  "errors": 1,
  "cacheHitRate": 0.62
}
```

---

## 7.6 Client Event Intake

```text
POST /api/v1/dev/performance/client-event
```

Used for frontend events:

* chart render time
* worker time
* page load time
* UI error

---

# 8. File Logging Requirements

## 8.1 Location

```text
logs/performance/YYYY-MM-DD.jsonl
```

## 8.2 Format

Each line is one event.

```jsonl
{"timestamp":"...","scope":"api","operation":"request_complete","durationMs":1842}
{"timestamp":"...","scope":"external","operation":"fetch_balance_sheet","ticker":"AAPL","durationMs":842}
```

## 8.3 Retention

Recommended:

```text
retain 14 days
rotate daily
cap file size if necessary
```

---

# 9. Slow Threshold Defaults

```ts
const SLOW_THRESHOLDS_MS = {
  api: 3000,
  db: 100,
  external: 1500,
  cache: 50,
  normalization: 300,
  metric: 500,
  calculation: 1000,
  page_load: 5000,
  worker: 3000,
  chart: 500,
};
```

---

# 10. Implementation Steps

## Phase 1 — Backend Event Foundation

* Add `PerformanceEvent` model
* Add request ID middleware
* Add `log_event`
* Add `perf_timer`
* Add terminal formatted output
* Add JSONL file output
* Add in-memory ring buffer

---

## Phase 2 — Backend Instrumentation

Add timers around:

* API routes
* repository functions
* yfinance fetch functions
* cache lookup/write
* financial statement normalization
* ROIC/WACC calculation
* DCF calculation
* attribution
* Monte Carlo backend execution

---

## Phase 3 — Dev APIs

Add:

* `/api/v1/dev/log-stream`
* `/api/v1/dev/performance/recent`
* `/api/v1/dev/performance/slow`
* `/api/v1/dev/performance/errors`
* `/api/v1/dev/performance/summary`
* `/api/v1/dev/performance/client-event`

---

## Phase 4 — Frontend Monitor Shell

Add:

* `/dev/monitor`
* `usePerformanceStream`
* monitor header
* KPI row
* live log stream
* filters

---

## Phase 5 — Visualization Panels

Add:

* OperationLatencyBars
* TickerFetchLatencyBars
* PageLoadTimeline
* MetricCalculationBars
* DataQualityWarnings
* SlowOperationsTable

---

## Phase 6 — Frontend Event Capture

Instrument:

* page load timing
* React Query timing
* chart render timing
* Monte Carlo worker timing
* chart error boundaries

---

## Phase 7 — Polish

Add:

* pause/resume
* export JSONL
* clear buffer
* reconnect indicator
* slow-only filter
* error-only filter
* ticker filter
* route filter

---

# 11. Acceptance Criteria

The feature is complete when:

* every API request has a request ID
* API route duration is visible in terminal and `/dev/monitor`
* DB query time is visible
* yfinance per-ticker fetch time is visible
* ROIC/WACC calculation timing and warnings are visible
* slow operations are automatically flagged
* `/dev/monitor` shows real-time bar charts
* logs are saved as JSONL
* the monitor can be disabled by environment variable
* no secrets or large raw financial payloads are logged by default

---

# 12. Final Functional Rule

Every important operation must answer:

```text
What ran?
When did it run?
How long did it take?
Which ticker/table/route was involved?
Did it use cache?
Did it succeed?
Was it slow?
Did it produce suspicious data?
Where can I inspect the details?
```

```
```
