# Development Todo

Purpose: track the active implementation plan for MoneyView development-only observability, while preserving completed corporate metric and whole-code optimization evidence.

Status snapshot: as of 2026-05-03, the ROIC/Growth implementation track and whole-code optimization O1-O5 work are complete and verified. The active work is now the MoneyView Dev Monitor plan from `guideline/suggestion.md`.

Planning sources:
- `guideline/suggestion.md` - primary source for the active dev-monitor plan.
- `guideline/file-structure.md` - ownership boundaries for backend core, API services, frontend app code, shared types, and docs.
- `docs/architecture/api-transport-observability.md` - existing request/transport logging basis.
- `guideline/finance-logic.md`
- `guideline/CQRS Architecture.md`
- `guideline/python-dataClass.md`
- `guideline/Refactoring for Solving Complicate Spaghetti codes.md`

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses.

## Active Track - MoneyView Dev Monitor

Principles:
- The monitor is development-only and must be disabled by default unless `MONEYVIEW_DEV_MONITOR=true`.
- Do not add remote telemetry, cloud logging, user analytics, production monitoring, or third-party tracing tools.
- Keep route handlers thin: HTTP endpoints live in `apps/api/routes`, orchestration/instrumentation lives in `apps/api/services` or `apps/api/core`, reusable finance logic remains in `packages/core_finance`, and monitor UI lives in `apps/web`.
- Do not log secrets, credentials, raw large financial payloads, cookies, authorization headers, or full provider responses.
- Preserve existing request/transport observability as the foundation instead of replacing it wholesale.
- Prefer small, reversible instrumentation slices with targeted tests before broader monitor UI work.

Existing basis already present:
- [x] `apps/api/core/middleware.py` assigns `request.state.request_id` and returns the `X-Request-ID` response header.
- [x] `apps/api/core/middleware.py` logs request completion and request failure with method, path, status, duration, client IP, and request ID.
- [x] `apps/api/core/transport_progress.py` logs truthful known-size and SSE transport progress.
- [x] `apps/api/core/logger.py` writes readable console lines and persistent JSON logs to `data/cache/logs/api-server.log` unless `API_LOG_PATH` overrides the path.
- [x] `apps/api/routes/diagnostic.py` exposes a local log-tail diagnostic endpoint for existing API log visibility.
- [x] `docs/architecture/api-transport-observability.md` documents the current request/transport logging behavior and verification baseline.

### D1 - Backend Event Foundation

Design/specification status:
- [x] D1 backend foundation design documented in `docs/architecture/dev-monitor-backend-foundation.md`.
- [x] Shared backend `PerformanceEvent` model specified in `docs/architecture/dev-monitor-backend-foundation.md`.
- [x] Dev-monitor feature flag behavior specified in `docs/architecture/dev-monitor-backend-foundation.md`.
- [x] Backend event sink design specified in `docs/architecture/dev-monitor-backend-foundation.md`.
- [x] `perf_timer` behavior and slow-operation classification specified in `docs/architecture/dev-monitor-backend-foundation.md`.
- [x] Existing request ID middleware reuse specified in `docs/architecture/dev-monitor-backend-foundation.md`.
- [x] Existing API log compatibility and regression baseline specified in `docs/architecture/dev-monitor-backend-foundation.md`.

Design reference:
- `docs/architecture/dev-monitor-backend-foundation.md`

Implementation pending:
- [x] Implement the shared backend `PerformanceEvent` model for dev-monitor events with timestamp, request ID, parent ID, level, scope, operation, status, duration, ticker, route, method, table, provider, component, warning/error codes, message, and metadata.
- [x] Implement the dev-monitor feature flag helper that treats `MONEYVIEW_DEV_MONITOR=true` as enabled and keeps all `/api/v1/dev/*` surfaces disabled by default.
- [x] Implement the backend event sink that can emit to terminal, JSONL file, and an in-memory bounded recent-event buffer when the monitor is enabled.
- [x] Add a `perf_timer` helper for consistent duration measurement and slow-operation classification.
- [x] Reuse the existing request ID middleware instead of introducing a second request identity path.
- [x] Keep existing API log output stable while adding monitor events; current transport/request logging tests remain the regression baseline.

Implementation details:
- `docs/architecture/dev-monitor-backend-foundation.md`
  - added the D1 backend foundation design note covering model shape, ownership, feature-flag behavior, sink behavior, timing helper semantics, request ID reuse, sanitization rules, and verification expectations
- `apps/api/models/schema_parts/dev_monitor.py`
  - added the shared backend `PerformanceEvent` Pydantic model
  - normalized ticker and HTTP method casing
  - enforced timezone-aware UTC timestamps and compact optional-string normalization
- `apps/api/models/schemas.py`
  - re-exported `PerformanceEvent` from the stable API schema surface
- `apps/api/core/dev_monitor.py`
  - added `is_dev_monitor_enabled()` with `MONEYVIEW_DEV_MONITOR=true` as the only enabled state
  - added the backend sink abstraction with no-op and active implementations
  - active sink now writes to terminal, JSONL, and an in-memory bounded recent-event buffer
  - added metadata sanitization for secrets and non-JSON-safe values
  - added request-context helpers for correlating downstream events to the active request ID
  - added `perf_timer(...)` for consistent duration measurement, slow classification, and error emission
  - added helper emitters later used by D2 for cache and data-quality events
- `apps/api/core/middleware.py`
  - reused the existing `X-Request-ID` / `request.state.request_id` path as the only request identity source
  - added feature-flagged request lifecycle event emission without changing default disabled behavior
  - preserved the existing request log message shape and response header behavior
- `apps/api/core/logger.py`
  - existing logger pipeline was intentionally kept stable; D1 did not replace the console or `api-server.log` behavior

Verification notes:
- Added D1-focused regression coverage in `tests/api/test_dev_monitor_foundation.py`
- Confirmed the existing request/transport log regression baseline still passes in `tests/api/test_transport_progress.py`

### D2 - Backend Instrumentation

- [x] Wrap API request lifecycle events into monitor events for `api.request_start`, `api.request_complete`, and `api.request_error`.
- [x] Add database operation timing around repository/service database calls, capturing table, operation type, row count when available, request ID, duration, and status.
- [x] Add provider timing around yfinance fetches, including ticker, provider, operation, cache status where known, retry count where known, missing fields, duration, and error state.
- [x] Add cache events for lookup, hit, miss, stale, write, TTL, cache age, source, fallback use, and ticker where applicable.
- [x] Add metric/calculation timing for ROIC, WACC, ROIC minus WACC, DCF upside, expected-vs-market, volatility, beta, VaR, CVaR, attribution effects, and Monte Carlo backend execution.
- [x] Add data-quality warning events for invalid or suspicious financial data, including existing ROIC/WACC warning codes from the audit path.
- [x] Add page-load group events for market overview, portfolio, corporate metrics, corporate comparison, Monte Carlo, and news-feed request groups.

Implementation details:
- `apps/api/core/middleware.py`
  - request lifecycle monitor events now emit `api.request_start`, `api.request_complete`, and `api.request_error`
  - page-load group events now emit `page_load.market_overview`, `page_load.portfolio`, `page_load.corporate_metrics`, `page_load.corporate_comparison`, `page_load.monte_carlo`, and `page_load.news_feed` based on the API path
  - the request ID is stored in dev-monitor request context for downstream DB/cache/provider event correlation
- `apps/api/services/db.py`
  - SQLite connections now use instrumented connection/cursor wrappers
  - `execute` and `fetch*` paths emit `scope="db"` events with parsed operation type, table name, row count when available, duration, status, and request ID
- `apps/api/services/market_data.py`
  - local OHLCV cache lookup, hit, miss, stale, fallback, and write paths now emit `scope="cache"` monitor events
  - provider TTL cache hit/miss/stale/write paths now emit cache events with TTL and cache-age metadata
  - yfinance quote and OHLCV history fetches now emit `scope="external"` timing events with ticker, provider, retry count, and missing-field metadata where available
- `apps/api/services/corporate_statement_metrics.py`
  - Yahoo statement bundle cache now emits cache lookup/hit/miss/write events
  - Yahoo statement provider loads now emit provider timing events
  - metric audit execution now emits timed `scope="metric"` and `scope="calculation"` events for growth, ROIC, WACC, and spread
  - audit warning paths now emit `scope="data_quality"` events derived from growth/ROIC/WACC/spread warnings
- `apps/api/services/portfolio/cache_service.py`
  - attribution and report TTL caches now emit cache hit/miss/write events
- `apps/api/services/portfolio/portfolio_service.py`
  - attribution orchestration now emits calculation timing for the full attribution build, attribution effects, and risk metric generation
- `apps/api/services/corporate_comparison.py`
  - comparison-side DCF upside and expected-vs-market calculations now emit timed calculation/metric events
- `apps/api/routes/monte_carlo.py`
  - Monte Carlo backend execution now emits calculation timing
  - volatility, beta-adjacent risk outputs, VaR, and CVaR generation now emit metric timing

Verification notes:
- Added focused monitor regression coverage in `tests/api/test_dev_monitor_foundation.py`
- Confirmed existing logging regression baseline still passes in `tests/api/test_transport_progress.py`
- Confirmed related behavior still passes in `tests/api/test_corporate_metric_audit.py` and `tests/api/test_portfolio_attribution.py`
- `tests/api/test_stock_price_lookup.py` still has an environment-specific `E:\\MoneyView\\...` temp-path assumption and was not changed as part of D2

### D3 - Dev APIs

- [x] Add `GET /api/v1/dev/log-stream` as an SSE stream of live `PerformanceEvent` records.
- [x] Add `GET /api/v1/dev/performance/recent?limit=500` for recent in-memory events.
- [x] Add `GET /api/v1/dev/performance/slow?limit=100` for threshold-filtered slow operations.
- [x] Add `GET /api/v1/dev/performance/errors?limit=100` for recent error events.
- [x] Add `GET /api/v1/dev/performance/summary` for active requests, average API latency, p95 API latency, slow operation count, error count, and cache hit rate.
- [x] Add `POST /api/v1/dev/performance/client-event` for frontend page load, chart render, worker timing, and UI error events.
- [x] Add API tests proving all dev endpoints are unavailable when `MONEYVIEW_DEV_MONITOR` is disabled and available only when it is enabled.

Implementation details:
- `apps/api/routes/dev_monitor.py`
  - added the D3 dev-monitor route family under `/api/v1/dev`
  - `GET /log-stream` now serves live `PerformanceEvent` SSE records from the in-memory sink
  - `GET /performance/recent` returns recent ring-buffer events
  - `GET /performance/slow` returns threshold-classified slow events
  - `GET /performance/errors` returns recent error events
  - `GET /performance/summary` returns active request count, average API latency, p95 API latency, slow operation count, error count, and cache hit rate
  - `POST /performance/client-event` accepts frontend-originated monitor events and emits them through the same backend sink
  - all D3 routes now return `404` when `MONEYVIEW_DEV_MONITOR` is disabled, keeping `/api/v1/dev/*` effectively absent by default
- `apps/api/main.py`
  - mounted the dev-monitor router at `/api/v1/dev`
- `apps/api/routes/__init__.py`
  - exported the dev-monitor router for app registration
- `apps/api/core/dev_monitor.py`
  - extended the active sink with summary aggregation over recent events
  - added sequenced recent-event storage for SSE streaming
  - added `events_after(...)` and `summary()` helpers used by the D3 routes
- `apps/api/models/schema_parts/dev_monitor.py`
  - added `PerformanceEventListResponse` for recent/slow/error responses
  - added `PerformanceSummary` for summary aggregation responses
  - added `ClientPerformanceEventRequest` for frontend-originated event intake
- `apps/api/models/schemas.py`
  - re-exported the D3 dev-monitor response/request models from the stable schema surface

Verification notes:
- Added D3 API coverage in `tests/api/test_dev_monitor_foundation.py`
- Verified dev endpoints return `404` when `MONEYVIEW_DEV_MONITOR` is disabled
- Verified recent, slow, errors, summary, SSE stream, and client-event endpoints return usable responses when enabled
- Re-ran existing backend regression coverage in `tests/api/test_transport_progress.py`, `tests/api/test_corporate_metric_audit.py`, and `tests/api/test_portfolio_attribution.py`

### D4 - Frontend Monitor Shell

- [x] Create `apps/web/app/dev/monitor/page.tsx` behind the same development-only behavior expected by the backend.
- [x] Add a `usePerformanceStream` hook for `/api/v1/dev/log-stream` with reconnect, connection state, pause, resume, clear, and capped local buffer behavior.
- [x] Add monitor controls for pause/resume, clear, export visible events, scope filter, ticker filter, route filter, slow-only filter, error-only filter, and operation search.
- [x] Add the initial monitor layout with header, KPI row, live log stream, and empty/loading/error states.
- [x] Ensure the page does not expose production telemetry assumptions or user-facing analytics language.

D4 implementation details:
- [x] Added the frontend monitor shell in `apps/web/app/dev/monitor/page.tsx` with `PageHeader`, KPI cards, a filter bar, visible/buffered counts, and a monospace live-event table.
- [x] Kept the page aligned with backend dev-only behavior by treating backend `404` responses as "monitor disabled" and showing a local-only empty state instructing developers to enable `MONEYVIEW_DEV_MONITOR=true`.
- [x] Added `apps/web/lib/devMonitor.ts` for typed dev-monitor frontend contracts and fetch helpers for recent events, slow events, error events, summary, and the SSE stream URL.
- [x] Added `apps/web/hooks/usePerformanceStream.ts` to manage the `/api/v1/dev/log-stream` `EventSource`, including reconnect backoff, connection state, pause/resume controls, clear behavior, deduplicated event merging, and a capped local buffer.
- [x] Reused the shared API URL builder in `apps/web/lib/api.ts` so the stream and fetch helpers resolve against the same dynamic backend base URL logic as the rest of the web app.
- [x] Kept the copy development-focused: the page describes local event observability, backend activity, and development runtime behavior rather than production telemetry or user analytics.

D4 verification notes:
- [x] Frontend lint passed from `apps/web`: `npm.cmd run lint -- app/dev/monitor/page.tsx hooks/usePerformanceStream.ts lib/devMonitor.ts lib/api.ts`.

### D5 - Visualization Panels

- [x] Add operation latency bars for recent operation durations, status, scope, and duration.
- [x] Add per-ticker fetch latency bars with ticker, provider, operation, duration, cache status, and status.
- [x] Add grouped page-load timeline rows by request/page and step duration.
- [x] Add metric calculation latency panels for ROIC, WACC, DCF, attribution, and related quality/warning metadata.
- [x] Add a data-quality warning panel showing ticker, metric, warning code, message, source, timestamp, request ID, and audit link where available.
- [x] Add a slow operations table that uses the same threshold definitions as the backend.

D5 implementation details:
- [x] Extended `apps/web/app/dev/monitor/page.tsx` with operation latency bars derived from recent timed events, including scope, status, and duration presentation from the active local buffer.
- [x] Added per-ticker fetch latency bars in the same page for ticker-scoped cache/provider events, surfacing ticker, provider/source label, operation, cache status, event status, and duration.
- [x] Added grouped page-load timeline panels by reconstructing recent request groups from `page_load` events and related request-scoped timed steps, so developers can inspect per-request page timing flow without adding new backend routes.
- [x] Added metric timing panels for ROIC, WACC, DCF, and attribution paths, combining recent `metric`/`calculation` timing events with related `data_quality` warning counts and warning-code chips.
- [x] Added a data-quality warning panel for recent `data_quality` events, showing ticker, inferred metric label, warning code, message, source/component context, timestamp, request ID, and `metadata.audit_link` when present.
- [x] Added a slow-operations table backed by `GET /api/v1/dev/performance/slow`, with the threshold explainer rendered from the same frontend helper values as the backend definitions (`api >= 1000 ms`, non-API scopes `>= 250 ms`).
- [x] Added `slowThresholdMsForScope(...)` to `apps/web/lib/devMonitor.ts` so D5 display logic can stay aligned with the backend slow-event classification rule.

D5 verification notes:
- [x] Frontend lint passed from `apps/web`: `npm.cmd run lint -- app/dev/monitor/page.tsx lib/devMonitor.ts`.

### D6 - Frontend Event Capture

- [x] Instrument page load timing for monitor-relevant MoneyView screens.
- [x] Instrument React Query request timing where it can be captured without rewriting query ownership.
- [x] Instrument chart render timing and chart failure events around chart-heavy views.
- [x] Instrument Monte Carlo worker timing.
- [x] Send frontend events through `POST /api/v1/dev/performance/client-event` only when the monitor is enabled.

D6 implementation details:
- [x] Extended `apps/web/lib/api.ts` with a frontend dev-monitor emitter, enabled-state probe cache, and optional `monitor` metadata on `fetchApi(...)`, so client performance events are only posted after the frontend confirms the backend dev-monitor endpoints are available.
- [x] Added `apps/web/hooks/useDevMonitorPageLoad.ts` and mounted it in the main monitor-relevant client surfaces: `apps/web/components/market/MarketOverviewClient.tsx`, `apps/web/app/news/page.tsx`, `apps/web/app/corporate/page.tsx`, `apps/web/app/portfolio/page.tsx`, and `apps/web/app/monte-carlo/page.tsx`.
- [x] Instrumented page-owned React Query calls by passing monitor metadata through `fetchApi(...)` in the market detail modal query, corporate analysis queries, portfolio queries, news feed query, and portfolio stock-detail modal queries, avoiding a React Query abstraction rewrite while still capturing request timing.
- [x] Instrumented shared chart wrappers in `apps/web/components/ui/ResponsiveChart.tsx` and `apps/web/components/charts/TVChart.tsx` to emit chart render timing events, including local chart metadata such as rendered size, point counts, and line-series counts.
- [x] Instrumented chart failure paths in `apps/web/components/ui/ErrorBoundary.tsx` so React render failures inside chart-heavy views emit `chart.render_error` events with local route and failure metadata before showing the fallback UI.
- [x] Instrumented the Monte Carlo worker lifecycle in `apps/web/app/monte-carlo/page.tsx`, emitting `worker.*` start, success, error, and canceled events for path, valuation, and correlation runs with duration and scenario metadata.
- [x] Kept the frontend event path development-only by letting the client emitter cache `404` from `/api/v1/dev/performance/summary` or `/api/v1/dev/performance/client-event`, which suppresses future client-event posts until the monitor is enabled again.

D6 verification notes:
- [x] Frontend lint passed from `apps/web`: `npm.cmd run lint -- lib/api.ts hooks/useDevMonitorPageLoad.ts components/ui/ErrorBoundary.tsx components/ui/ResponsiveChart.tsx components/charts/TVChart.tsx app/news/page.tsx components/market/MarketOverviewClient.tsx app/corporate/page.tsx app/portfolio/page.tsx app/portfolio/components/StockDetailModal.tsx app/monte-carlo/page.tsx`.

### D7 - Polish And Safety Gates

- [x] Add JSONL export for visible monitor events.
- [x] Add reconnect indicator and paused-state affordances.
- [x] Add daily JSONL performance file rotation under `logs/performance/YYYY-MM-DD.jsonl` or a repo-approved runtime cache/log path.
- [x] Add retention guidance for local performance logs, defaulting to short local retention and no production persistence.
- [x] Verify no secrets, raw large financial payloads, cookies, or authorization headers are logged by default.
- [x] Run targeted backend tests first, then frontend build and targeted Playwright coverage once monitor UI exists.

D7 implementation details:
- [x] Updated `apps/web/app/dev/monitor/page.tsx` so visible-event export now writes newline-delimited JSON (`.jsonl`) instead of a pretty-printed JSON array, matching the local sink format used by the backend.
- [x] Added stronger stream-state affordances in the same page: a reconnecting banner when the SSE stream is retrying and a paused-state card that explains local buffering behavior and offers a dedicated resume action.
- [x] Updated `apps/api/core/dev_monitor.py` so the default performance sink writes daily files under `data/cache/logs/performance/YYYY-MM-DD.jsonl` instead of a single ever-growing `dev-monitor.jsonl` file.
- [x] Added short local retention handling in `apps/api/core/dev_monitor.py` with a default `7`-day window and optional override through `MONEYVIEW_DEV_MONITOR_RETENTION_DAYS`; daily log cleanup runs against date-named JSONL files in the same performance-log directory.
- [x] Extended `tests/api/test_dev_monitor_foundation.py` with coverage for daily log-path resolution, retention defaults, old-file cleanup, and the existing metadata sanitization path that strips blocked keys such as `authorization`.
- [x] Updated `docs/architecture/dev-monitor-backend-foundation.md` to document the rotated daily JSONL path, short local retention expectation, and the rule that dev-monitor files remain local development artifacts rather than production telemetry storage.
- [x] Added targeted frontend coverage in `apps/web/tests/e2e/dev-monitor.spec.ts` for the monitor shell using mocked dev endpoints, including visible-event rendering, pause/resume affordance, and JSONL export.

D7 verification notes:
- [x] Targeted backend tests passed first: `pytest -q tests/api/test_dev_monitor_foundation.py tests/api/test_transport_progress.py` -> `21 passed`.
- [x] Frontend lint passed from `apps/web`: `npm.cmd run lint -- app/dev/monitor/page.tsx tests/e2e/dev-monitor.spec.ts`.
- [x] Frontend build passed from `apps/web`: `npm.cmd run build`. The initial sandboxed run hit the known local harness `spawn EPERM`, and the escalated rerun completed successfully.
- [x] Targeted Playwright coverage passed from `apps/web`: `npm.cmd run test:e2e -- tests/e2e/dev-monitor.spec.ts`. The initial sandboxed run hit local `spawn EPERM`; the escalated rerun passed with `1 passed`.

## Archived Completed Optimization Basis

This archive preserves why the prior plan is no longer active. Do not re-add these items to the active checklist unless a new regression or measured bottleneck reopens the work.

### Corporate Metric Implementation Track

- [x] Stable and legacy metric variants coexist in backend, frontend contracts, and E2E mocks.
- [x] Unified corporate audit payload includes `growth`, `roic`, `wacc`, `spread`, and `dcf` entries with method, quality, confidence, warnings, and calculation-version metadata.
- [x] Targeted regression passed on 2026-04-30: `pytest tests/core_finance/test_corporate_statement_metric_helpers.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py --basetemp=E:\MoneyView\pytest-codex-regression` -> 22 passed.

### Whole-Code Optimization O1-O5

- [x] O1 measurement baseline completed before optimization work was marked done.
- [x] O2 backend ownership cleanup and hot-path refactors completed, keeping routes as HTTP boundaries, services as orchestration/cache/data-access owners, and reusable finance rules in `packages/core_finance`.
- [x] O2A CQRS read/write separation review and O2A.1 calculation planning completed; durable read-model ownership is documented in `docs/architecture/cqrs-read-write-separation.md`.
- [x] O2B first selected refactor candidate completed for `apps/api/services/corporate_statement_metrics.py`; named predicates, named rules, and value objects reduced duplicated conditions and hidden policy.
- [x] O3 frontend render splits, selected dynamic loading, React Query cache audit, high-risk render regression coverage, command/query UI separation slice, and named predicate extraction completed.
- [x] O4 cache ownership documentation, browser session-cache guardrails, cache-size/TTL defaults review, generated-artifact exclusions, and read-model registry documentation completed.
- [x] O5 verification gates completed on 2026-05-03.

### O5 Verification Evidence

- [x] Backend API/service gate: initial sandboxed run hit the known Windows pytest temp cleanup `PermissionError: [WinError 5]`; escalated rerun passed with `pytest tests/api/test_corporate_metric_audit.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_comparison.py tests/api/test_market_index_detail.py tests/api/test_stock_price_lookup.py tests/api/test_portfolio_attribution.py -q --basetemp=E:\MoneyView\pytest-o5-backend-api-2` -> 51 passed.
- [x] Core-finance gate passed after the API/service tests: `pytest tests/core_finance -q --basetemp=E:\MoneyView\pytest-o5-core-finance` -> 42 passed.
- [x] Frontend build gate passed from `apps/web`: `npm.cmd run build`.
- [x] Frontend Playwright gate: initial sandboxed command hit local harness `spawn EPERM`; escalated rerun passed with `npm.cmd run test:e2e -- tests/e2e/high-risk-render-regression.spec.ts tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts tests/e2e/refresh-idle-state.spec.ts` -> 21 passed.
- [x] Contract gate found no pending `apps/api/models` or `packages/shared-types` contract diff beyond existing typed E2E helper/API test coverage.
- [x] Focused contract API tests passed after Windows temp cleanup rerun: `pytest tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py tests/api/test_corporate_comparison.py -q --basetemp=E:\MoneyView\pytest-o5-contract-api-2` -> 32 passed.
- [x] Benchmark harness smoke test passed: `pytest tests/api/test_benchmark_scripts.py -q --basetemp=E:\MoneyView\pytest-o5-measurement-gate` -> 3 passed.

### Measurement Evidence

- [x] Finance/runtime benchmark passed: `python scripts\benchmark_finance.py --iterations 3 --monte-carlo-runs 500 --vector-size 1000 --seed 7`.
- [x] Representative finance/runtime averages: `core_finance:monte-carlo-npv-500` 4.845ms, `market:technical-indicators-1000` 1.195ms, `corporate:stable-growth-5-years` 0.023ms, and `corporate:roic-records-5-years` 0.038ms.
- [x] API benchmark passed: `python scripts\benchmark_api.py --iterations 2`.
- [x] Representative API averages: corporate metrics 4.406ms, DCF 2.75ms, live comparison 5.29ms, portfolio attribution 11.234ms, technicals 4.158ms, and Monte Carlo detail 9.578ms, all status 200.
- [x] SQLite benchmark passed: `python scripts\benchmark_sqlite.py --iterations 3 --write-rows 25`.
- [x] Representative SQLite averages: latest stock lookup 0.239ms, indicators-by-category 0.512ms, watchlist read 0.088ms, and temp insert write 0.064ms.

### Characterization And Ownership Evidence

- [x] CQRS projection correctness is covered for `corporate_comparison_snapshots_v3`, including scheduled snapshots, manual refresh materialization, custom-universe metadata, live mode behavior, history queries, version drill-down, deletion, timelines, KST business dates, retention cleanup, same-day versions, and v3 index/schema bootstrap.
- [x] Stale-read behavior is documented and tested through `build_corporate_comparison_response()` with `allow_stale_snapshot=True`, `snapshot_is_stale`, and snapshot date/version/source/cadence/universe metadata.
- [x] CQRS focused test rerun passed: `pytest tests/api/test_corporate_comparison.py -q --basetemp=E:\MoneyView\pytest-o5-cqrs-gate-2` -> 12 passed.
- [x] Spaghetti-refactor characterization passed: `pytest tests/core_finance/test_corporate_statement_metric_helpers.py tests/core_finance/test_expected_return.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py tests/api/test_market_index_detail.py tests/api/test_stock_price_lookup.py -q --basetemp=E:\MoneyView\pytest-o5-spaghetti-gate-2` -> 49 passed.
- [x] `packages/core_finance/corporate_statement_metrics.py` centralizes numeric policy in named rule/value objects such as `TAX_RATE_RULE`, `INVESTED_CAPITAL_RULE`, `ROIC_SANITY_RULE`, `REVENUE_RULE`, and `GROWTH_CAGR_RULE`.
- [x] `packages/core_finance/expected_return.py` exposes `ExpectedReturnInputs`, `ExpectedReturnResult`, and `calculate_expected_return_result(...)`; `apps/api/services/corporate_comparison.py` consumes the typed result.
- [x] Checked hot files had no blanket `except Exception` matches: `apps\api\services\corporate_statement_metrics.py`, `apps\api\services\market_data.py`, `packages\core_finance\risk_analysis.py`, `packages\core_finance\corporate_statement_metrics.py`, and `packages\core_finance\expected_return.py`.
