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

- [ ] Define a shared backend `PerformanceEvent` model for dev-monitor events with timestamp, request ID, parent ID, level, scope, operation, status, duration, ticker, route, method, table, provider, component, warning/error codes, message, and metadata.
- [ ] Add a dev-monitor feature flag helper that treats `MONEYVIEW_DEV_MONITOR=true` as enabled and keeps all `/api/v1/dev/*` surfaces disabled by default.
- [ ] Add a backend event sink that can emit to terminal, JSONL file, and an in-memory bounded recent-event buffer when the monitor is enabled.
- [ ] Add a `perf_timer` helper for consistent duration measurement and slow-operation classification.
- [ ] Reuse the existing request ID middleware instead of introducing a second request identity path.
- [ ] Keep existing API log output stable while adding monitor events; current transport/request logging tests remain the regression baseline.

### D2 - Backend Instrumentation

- [ ] Wrap API request lifecycle events into monitor events for `api.request_start`, `api.request_complete`, and `api.request_error`.
- [ ] Add database operation timing around repository/service database calls, capturing table, operation type, row count when available, request ID, duration, and status.
- [ ] Add provider timing around yfinance fetches, including ticker, provider, operation, cache status where known, retry count where known, missing fields, duration, and error state.
- [ ] Add cache events for lookup, hit, miss, stale, write, TTL, cache age, source, fallback use, and ticker where applicable.
- [ ] Add metric/calculation timing for ROIC, WACC, ROIC minus WACC, DCF upside, expected-vs-market, volatility, beta, VaR, CVaR, attribution effects, and Monte Carlo backend execution.
- [ ] Add data-quality warning events for invalid or suspicious financial data, including existing ROIC/WACC warning codes from the audit path.
- [ ] Add page-load group events for market overview, portfolio, corporate metrics, corporate comparison, Monte Carlo, and news-feed request groups.

### D3 - Dev APIs

- [ ] Add `GET /api/v1/dev/log-stream` as an SSE stream of live `PerformanceEvent` records.
- [ ] Add `GET /api/v1/dev/performance/recent?limit=500` for recent in-memory events.
- [ ] Add `GET /api/v1/dev/performance/slow?limit=100` for threshold-filtered slow operations.
- [ ] Add `GET /api/v1/dev/performance/errors?limit=100` for recent error events.
- [ ] Add `GET /api/v1/dev/performance/summary` for active requests, average API latency, p95 API latency, slow operation count, error count, and cache hit rate.
- [ ] Add `POST /api/v1/dev/performance/client-event` for frontend page load, chart render, worker timing, and UI error events.
- [ ] Add API tests proving all dev endpoints are unavailable when `MONEYVIEW_DEV_MONITOR` is disabled and available only when it is enabled.

### D4 - Frontend Monitor Shell

- [ ] Create `apps/web/app/dev/monitor/page.tsx` behind the same development-only behavior expected by the backend.
- [ ] Add a `usePerformanceStream` hook for `/api/v1/dev/log-stream` with reconnect, connection state, pause, resume, clear, and capped local buffer behavior.
- [ ] Add monitor controls for pause/resume, clear, export visible events, scope filter, ticker filter, route filter, slow-only filter, error-only filter, and operation search.
- [ ] Add the initial monitor layout with header, KPI row, live log stream, and empty/loading/error states.
- [ ] Ensure the page does not expose production telemetry assumptions or user-facing analytics language.

### D5 - Visualization Panels

- [ ] Add operation latency bars for recent operation durations, status, scope, and duration.
- [ ] Add per-ticker fetch latency bars with ticker, provider, operation, duration, cache status, and status.
- [ ] Add grouped page-load timeline rows by request/page and step duration.
- [ ] Add metric calculation latency panels for ROIC, WACC, DCF, attribution, and related quality/warning metadata.
- [ ] Add a data-quality warning panel showing ticker, metric, warning code, message, source, timestamp, request ID, and audit link where available.
- [ ] Add a slow operations table that uses the same threshold definitions as the backend.

### D6 - Frontend Event Capture

- [ ] Instrument page load timing for monitor-relevant MoneyView screens.
- [ ] Instrument React Query request timing where it can be captured without rewriting query ownership.
- [ ] Instrument chart render timing and chart failure events around chart-heavy views.
- [ ] Instrument Monte Carlo worker timing.
- [ ] Send frontend events through `POST /api/v1/dev/performance/client-event` only when the monitor is enabled.

### D7 - Polish And Safety Gates

- [ ] Add JSONL export for visible monitor events.
- [ ] Add reconnect indicator and paused-state affordances.
- [ ] Add daily JSONL performance file rotation under `logs/performance/YYYY-MM-DD.jsonl` or a repo-approved runtime cache/log path.
- [ ] Add retention guidance for local performance logs, defaulting to short local retention and no production persistence.
- [ ] Verify no secrets, raw large financial payloads, cookies, or authorization headers are logged by default.
- [ ] Run targeted backend tests first, then frontend build and targeted Playwright coverage once monitor UI exists.

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
