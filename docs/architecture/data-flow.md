# MoneyView Data Flow

This document is the canonical calculate-process and workflow-pipeline reference for MoneyView. It explains how user actions, API requests, backend orchestration, finance computation, persistence, cache, and frontend rendering connect across the major product workflows.

## 1. Reading Guide

Each workflow below is described using the same lens:

- trigger
- input/source-of-truth
- backend or worker execution path
- persistence or cache impact
- response/output
- frontend ownership

The goal is to make the runtime understandable end to end, not to restate endpoint lists.

## 2. Cross-Cutting Pipeline Rules

These rules apply across most MoneyView workflows:

- frontend state is not the canonical persistent store unless a backend API explicitly writes it
- SQLite is the canonical persistent store for mutable app state
- the backend owns canonical API responses and persistence orchestration
- frontend adapters may reshape response payloads for charts, but they do not redefine the underlying calculations
- browser workers are allowed for exploratory simulation flows that do not require backend persistence

## 3. Portfolio Attribution Pipeline

### 3.1 Trigger

The Portfolio page needs holdings, weights, attribution results, and risk metrics for the current watchlist and benchmark configuration.

### 3.2 End-To-End Flow

1. The frontend loads holdings through `GET /api/v1/portfolio/watchlist`.
2. The route ensures watchlist bootstrap when local state is empty.
3. The backend reads SQLite `watchlist` rows and enriches them with latest close, delta, and sparkline information through `MarketDataService`.
4. The frontend receives `List[PortfolioStock]` and decides the effective portfolio weighting model:
   saved positive weights when present
   equal-weight basket only when no positive saved weights exist
5. The frontend sends `AttributionRequest` to `POST /api/v1/portfolio/attribution`.
6. The route delegates to `PortfolioAnalyticsService.build_attribution`.
7. `CacheService` computes a deterministic attribution cache key and returns a cached result if one exists.
8. `DataProvider.scalar_return` loads close-series data from SQLite-backed tables and converts them into per-ticker scalar returns.
9. If required data is missing and `allow_synthetic_fallback=true`, `DataProvider` generates deterministic synthetic returns; otherwise the request fails closed.
10. `DataProvider.sector_map` resolves sector metadata from SQLite `watchlist`.
11. `BenchmarkService.sector_profile` resolves benchmark sector weights and returns using either:
    user-provided benchmark weights
    or an explicitly opted-in equal-sector proxy when `allow_benchmark_proxy=true`
12. `AttributionEngine.calculate_sector_breakdowns` aggregates sector weights/returns and applies arithmetic Brinson-Fachler attribution.
13. `RiskEngine.calculate` builds aligned return series, computes beta, historical VaR, and expected shortfall, and records whether synthetic fallback affected risk inputs.
14. Pydantic models package totals, active return, effects, sector breakdowns, risk metrics, cache metadata, and data-quality flags into `AttributionResult`.
15. `PortfolioAnalyticsService` stores the computed result in its cache and returns it to the route.
16. The frontend receives `APIResponse[AttributionResult]`.
17. Frontend adapters map sector breakdowns, allocation weights, and risk summaries into chart-specific arrays for waterfall, donut, and other visualizations.

### 3.3 Persistence And Cache Impact

- reads `watchlist`, `stocks`, and/or `indices`
- may use deterministic in-process attribution/report cache
- does not persist attribution output as canonical SQLite business state

### 3.4 Ownership Summary

- watchlist truth: SQLite
- price/return loading: backend `DataProvider`
- attribution math: backend `AttributionEngine`
- risk metrics: backend `RiskEngine`
- chart reshaping: frontend

## 4. Watchlist Mutation And Ownership Pipelines

## 4.1 Watchlist Upsert

1. The frontend sends `POST /api/v1/portfolio/watchlist` with `WatchlistItem`.
2. The route normalizes ticker, name, sector, group, and weight.
3. SQLite `watchlist` is updated through an upsert.
4. `mark_watchlist_state("user_mutation")` records that watchlist state is now user-managed.
5. The frontend invalidates watchlist and attribution queries and re-renders from the updated DB-backed state.

Persistence impact:
- writes `watchlist`
- writes `dataset_metadata`

## 4.2 Watchlist Delete

1. The frontend sends `DELETE /api/v1/portfolio/watchlist/{ticker}`.
2. The backend checks that the ticker exists.
3. The exact row is deleted from SQLite `watchlist`.
4. The backend records `user_mutation` watchlist state so deleted defaults are not silently reseeded later.
5. The frontend refreshes from the DB-backed response path.

Persistence impact:
- deletes from `watchlist`
- writes `dataset_metadata`

## 4.3 Watchlist Bootstrap

1. A route such as `GET /api/v1/portfolio/watchlist` calls `ensure_watchlist_bootstrapped`.
2. If `watchlist` already has rows, bootstrap exits immediately.
3. If managed watchlist state already exists in `dataset_metadata`, bootstrap exits to avoid overwriting user intent.
4. If local JSON exists, `stock_targets.json` is used as the preferred seed.
5. If JSON is absent but DB-derived watchlist regeneration is possible, JSON may be regenerated from DB-like sources.
6. If neither JSON nor regenerated DB content is available, built-in default watchlist items are used.
7. Seed rows are inserted into SQLite `watchlist`.
8. `dataset_metadata` records the bootstrap source so future requests understand local state provenance.

Persistence impact:
- may write `watchlist`
- may write `dataset_metadata`
- may write `stock_targets.json` during regeneration

## 4.4 Safe Sync: DB To JSON

1. The frontend sends `POST /api/v1/portfolio/watchlist/sync`.
2. The backend reads the current SQLite `watchlist`.
3. The backend groups rows by `group_name` and writes `stock_targets.json`.
4. The backend records `watchlist_db_sync` metadata in `dataset_metadata`.
5. The frontend refreshes watchlist and sync-status UI.

Persistence impact:
- reads `watchlist`
- writes `stock_targets.json`
- writes `dataset_metadata`

## 4.5 Destructive Import: JSON To DB

1. The frontend requires explicit user confirmation.
2. The frontend sends `POST /api/v1/portfolio/watchlist/resync`.
3. The backend parses `stock_targets.json`.
4. Existing SQLite `watchlist` rows are deleted.
5. JSON rows are inserted into SQLite `watchlist`.
6. The backend records `manual_json_resync` state and sync metadata in `dataset_metadata`.
7. The frontend refreshes from the newly replaced DB-backed state.

Persistence impact:
- deletes from `watchlist`
- inserts into `watchlist`
- reads `stock_targets.json`
- writes `dataset_metadata`

## 5. Report Summary And Export Pipeline

### 5.1 Trigger

The frontend requests a canonical portfolio report summary or export artifact.

### 5.2 End-To-End Flow

1. The frontend sends either:
   `POST /api/v1/report/summary`
   or `POST /api/v1/report/export`
2. The route delegates to `PortfolioAnalyticsService`.
3. `build_report` converts the report request into an attribution request.
4. `build_report` reuses `build_attribution`, which means report generation inherits the same attribution pipeline, validations, benchmark logic, risk calculations, and data-quality metadata.
5. `CacheService` computes a report cache key using the request plus attribution cache key.
6. If a cached report payload exists, it is returned directly.
7. Otherwise `PortfolioAnalyticsService` builds:
   an executive summary
   canonical `ReportPayload`
   markdown content generated by `ReportRenderer.build_markdown`
8. For export flows, `ReportRenderer.build_export` formats the canonical payload as:
   JSON
   Markdown
   CSV
   HTML
9. The route returns `APIResponse[ReportPayload]` or `APIResponse[ReportExportResponse]`.
10. The frontend downloads the returned content or opens the HTML export for browser print-to-PDF.

### 5.3 Persistence And Cache Impact

- reuses attribution reads
- may use in-process report cache
- does not persist report artifacts as canonical SQLite records

### 5.4 Ownership Summary

- canonical report payload: backend
- export formatting: backend `ReportRenderer`
- file download / print action: frontend

## 6. Corporate DCF Pipeline

### 6.1 Trigger

The user selects a ticker in Corporate Analysis and changes valuation assumptions.

### 6.2 End-To-End Flow

1. The frontend loads `GET /api/v1/corporate/companies` for company search and registry state.
2. The user selects a ticker or adds a company.
3. The frontend loads `GET /api/v1/corporate/metrics/{ticker}` to obtain effective metrics and basis-specific assumptions.
4. Optional supporting requests load:
   `GET /api/v1/corporate/metrics/{ticker}/audit`
   `GET /api/v1/corporate/metrics/{ticker}/history`
   `GET /api/v1/corporate/metrics/{ticker}/quarterly-statements`
   `GET /api/v1/detail/{ticker}/ohlcv`
5. The page restores active ticker and previously successful heavy-zone payloads from browser continuity state when available:
   per-ticker assumptions may come from `localStorage`
   active ticker and last successful heavy-zone payloads may come from `sessionStorage`
6. The page keeps fast-changing form state frontend-owned while debouncing DCF requests.
7. Heavy DCF execution remains explicit-refresh-owned. Reload may reuse cached or stale results for continuity, but it must not silently re-run heavy DCF work because refresh tokens are intentionally ephemeral.
8. The frontend sends either:
   `POST /api/v1/corporate/dcf/{ticker}`
   `POST /api/v1/corporate/dcf/{ticker}/report`
   or `POST /api/v1/corporate/dcf/{ticker}/stream`
9. The route reads effective metrics through backend helpers and loads current market price through market-data services.
10. Backend DCF orchestration in `apps/api/services/corporate_dcf.py` assembles valuation assumptions, summary values, and full-report content.
11. For the streaming route, the backend emits `phase1`, `phase2`, and `complete` SSE events instead of waiting for one monolithic response.
12. The frontend merges backend-returned valuation output with its local assumption state and supporting chart/detail datasets.
13. KPI cards, diagnostics, and calculation-detail views render from the combined result set.
14. Audit-driven UI badges and calculation-detail audit tables use the separate metric-audit payload so the displayed ROIC, WACC, and spread can surface source quality, warnings, and fallback state explicitly.

### 6.3 Persistence And Cache Impact

- reads `corporate_metrics`, `corporate_companies`, and price/provider inputs
- does not persist DCF request results as canonical SQLite records
- persistence only occurs when metrics overrides or companies are explicitly saved through separate routes
- browser continuity state may cache last successful heavy-zone payloads, but that cache is frontend-owned and non-canonical

### 6.4 Ownership Summary

- live assumption state: frontend
- browser continuity cache and stale-label behavior: frontend
- valuation execution: backend
- canonical DCF response payload: backend
- final visualization composition: frontend

## 7. Corporate Comparison And Snapshot Pipelines

## 7.1 Live Comparison Pipeline

1. The frontend loads `GET /api/v1/corporate/comparison?mode=live`.
2. The route ensures watchlist bootstrap when needed.
3. `build_corporate_comparison_response` resolves the comparison universe:
   `portfolio_plus_benchmark`
   `watchlist_plus_benchmark`
   `custom`
4. `_resolve_comparison_universe_rows` reads watchlist rows and company registry data.
5. For `portfolio_plus_benchmark`, the backend uses saved positive-weight holdings and falls back to equal-weight watchlist holdings only when no positive weights exist.
6. For `watchlist_plus_benchmark`, all watchlist rows are included, including zero-weight names.
7. For `custom`, requested custom tickers are combined with the selected benchmark ticker.
8. For each row, backend helpers load metrics and current price.
9. The backend derives:
   `ROIC - WACC`
   DCF-derived value
   DCF-implied return
   CAPM-style expected return
   market expected return
   expected return spread
10. The response is returned as `CorporateComparisonResponse` in live mode.
11. The frontend sorts, filters, highlights rows, and may restore the last successful comparison payload from browser continuity state, but it does not own the formulas.
12. Reload remains idle-first for heavy comparison work. Cached comparison results may be shown for continuity, but a new heavy comparison request only happens after explicit refresh intent.

Persistence impact:
- reads `watchlist`, `corporate_metrics`, `corporate_companies`
- reads live price/provider inputs
- no snapshot rows written in live mode
- browser `sessionStorage` may hold the last successful comparison payload for same-session continuity, but it is not canonical persistence

## 7.2 Snapshot Read Pipeline

1. The frontend loads `GET /api/v1/corporate/comparison?mode=snapshot`.
2. The backend computes the universe key from:
   `comparison_universe`
   `benchmark_ticker`
   `custom_tickers`
3. The backend looks for the latest snapshot version for the current KST business date and universe key in `corporate_comparison_snapshots_v3`.
4. If found, the backend loads all rows for that snapshot version and returns them.
5. If not found, the backend attempts to materialize today's snapshot from live data and persist it.
6. If snapshot creation fails but an older snapshot exists, the backend may return the latest available snapshot and mark it stale.
7. The frontend receives snapshot metadata including snapshot version, as-of date, source, and stale/fresh state.

Persistence impact:
- reads `corporate_comparison_snapshots_v3`
- may write a new snapshot version if today's snapshot does not exist

## 7.3 Explicit Snapshot Refresh Pipeline

1. The frontend sends `POST /api/v1/corporate/comparison/snapshot`.
2. The backend computes the live comparison payload.
3. A new `snapshot_version` is generated from date, universe key, and timestamp.
4. Rows are written into `corporate_comparison_snapshots_v3`.
5. Old rows beyond the retention window are deleted.
6. The response returns the newly saved snapshot metadata and rows.

Persistence impact:
- inserts snapshot rows into `corporate_comparison_snapshots_v3`
- deletes retained-outdated rows

## 7.4 Snapshot History Pipeline

1. The frontend loads `GET /api/v1/corporate/comparison/history`.
2. The backend queries `corporate_comparison_snapshots_v3` for the selected universe key.
3. The query collapses same-day versions to the latest version for each date while still counting versions per day.
4. Aggregate history points such as average expected-return spread, average ROIC minus WACC, and average DCF value are returned.
5. The frontend renders snapshot history lists or trend views.

Persistence impact:
- reads `corporate_comparison_snapshots_v3`

## 7.5 Snapshot Version Drill-Down And Delete Pipeline

Drill-down:
1. The frontend requests `GET /api/v1/corporate/comparison/snapshot-version`.
2. The backend loads all rows for one `snapshot_version`.
3. The frontend uses this saved context for row views and stock-modal drill-down instead of transient current controls.

Delete:
1. The frontend sends `DELETE /api/v1/corporate/comparison/snapshot-version`.
2. The backend deletes all rows matching the selected `snapshot_version`.
3. The frontend refreshes its saved snapshot list and history views.

Persistence impact:
- reads or deletes from `corporate_comparison_snapshots_v3`

## 8. Monte Carlo Simulation-Lab Pipelines

The current Simulation Lab is primarily a frontend-owned worker workflow, not a persisted backend reporting workflow.

Cross-cutting rule for this section:

- raw worker output is not a render-ready contract by itself
- `apps/web/app/monte-carlo/page.tsx` owns normalization before React state is committed
- warnings generated during normalization are part of the page-level result contract and must remain visible in the UI
- chart sections consume validated view models and guard states, not unchecked worker payloads

## 8.1 Worker Lifecycle Pipeline

1. The page `apps/web/app/monte-carlo/page.tsx` mounts.
2. The page creates one shared worker from `apps/web/app/monte-carlo/workers/simulation.worker.ts`.
3. Page-level state owns:
   active tab
   request ids
   progress
   cancellation
   current input payloads
   current results
4. The worker receives typed messages for:
   `run-path`
   `run-valuation`
   `run-correlation`
   `cancel`
5. The worker tracks cancelled request ids and suppresses stale results.
6. The page normalizes worker payloads before storing user-visible results:
   invalid rows may be dropped
   non-finite numbers may be removed or downgraded
   mismatched arrays may be trimmed or rejected
   recoverable issues are surfaced as warnings instead of staying silent

Persistence impact:
- none by default

## 8.2 Path Simulation Pipeline

1. The user configures path-simulation inputs in the page.
2. The page sends `run-path` with a new `requestId` to the worker.
3. The worker calls `runSharedMonteCarloSimulation` in `simulation-core.ts`.
4. The engine computes:
   sample paths
   percentile path summary
   terminal return distribution
   risk metrics
   histogram
   normal-fit rows
   CDF comparison rows
5. Progress messages are sent back to the page while the run is active.
6. The final result is posted back as a `result` message.
7. The page validates and normalizes the raw result.
8. The page stores the normalized result, warning list, and any degraded-state markers.
9. Shared tab-ready view models are derived from the normalized result rather than the raw worker payload.

Persistence impact:
- none

## 8.3 Shared Reuse For Risk And Distribution Tabs

1. The path-simulation result is stored at page level.
2. `Risk Analysis` and `Return Distribution` tabs do not trigger separate worker engines.
3. Those tabs reuse the same shared result for:
   terminal distribution
   VaR/CVaR and downside metrics
   percentile cone summaries
   normal-fit and distribution overlays
4. Reused charts must still pass through chart guards so incomplete normalized subsets produce explicit `empty` or `invalid-data` states rather than blank panels.

Persistence impact:
- none

## 8.4 Valuation Monte Carlo Pipeline

1. The user edits valuation inputs in the Corporate Valuation tab.
2. The page may first call `GET /api/v1/stock/{ticker}/price` to auto-fill current price.
3. The page sends `run-valuation` to the shared worker.
4. The worker executes `runValuationMonteCarlo` from `valuation-core.ts`.
5. The valuation engine simulates fair values using growth, discount-rate, and target-PER uncertainty.
6. The worker emits progress updates and finally posts a `valuation-result` message.
7. The page normalizes the valuation payload, removing invalid fair-value points and recording any partial-recovery warnings.
8. The page renders fair-value distribution, percentile bands, undervaluation probability, and related valuation summaries from the normalized payload plus warning state.

Persistence impact:
- optional stock price lookup reads backend data
- worker valuation outputs themselves are not persisted

## 8.5 Correlation Model Pipeline

1. The user edits multi-asset expected returns, volatilities, and correlation matrix inputs.
2. The page sends `run-correlation` to the shared worker.
3. The worker executes `runCorrelationMonteCarlo` from `correlation-core.ts`.
4. The engine computes:
   Cholesky-decomposed correlated scenarios
   efficient-frontier samples
   heatmap data
   Spearman sensitivity outputs
   covariance and optimal-summary views
5. The worker posts progress and then a `correlation-result`.
6. The page validates summary values, frontier points, sensitivity rows, and correlation-matrix shape before state commit.
7. Invalid points are dropped or the affected panel is marked invalid, with warnings retained when recovery was partial.
8. The page renders the correlation and efficient-frontier views through guard-aware chart sections.

Persistence impact:
- none

## 8.6 Cancellation Behavior

1. The page can send a `cancel` message for the active request id.
2. The worker records the request id as cancelled.
3. If cancellation is detected mid-run, the worker exits without posting a final result.
4. The page resets local status/progress state accordingly.

Persistence impact:
- none

## 9. Stock Price Lookup Pipeline

This flow supports Monte Carlo valuation price autofill and other quick lookup UX.

1. The frontend calls `GET /api/v1/stock/{ticker}/price`.
2. `MarketDataService.get_stock_price_lookup` resolves cache/provider status.
3. The route returns:
   `200` when a price is ready
   `202` when the lookup is still fetching
   `404` when the ticker cannot be resolved
4. The frontend retries while status is `fetching` and the ticker/request is still current.
5. On success, the page may auto-fill current price unless the user has already manually overridden it.

Persistence impact:
- uses backend market-data cache/provider path
- does not persist the autofill result as business state by itself

## 10. Data-Quality Decision Points

Several workflows have explicit data-quality branches:

- attribution can use deterministic synthetic returns only when `allow_synthetic_fallback=true`
- benchmark sector weights can use a proxy only when `allow_benchmark_proxy=true`
- comparison snapshot mode can mark a snapshot stale if the latest available snapshot is older than the current KST business date
- stock price lookup can return cache, fetching, fallback, or not-found states
- market detail endpoints expose freshness metadata through `MarketIndexDetail`

These quality signals are part of the calculate process and should not be treated as incidental UI-only metadata.

## 11. Ownership Summary By Workflow

- Portfolio attribution:
  backend-owned calculation, frontend-owned visualization
- Watchlist sync/resync:
  backend-owned persistence mutation, frontend-owned confirmation and refresh UX
- Corporate DCF:
  backend-owned valuation execution, frontend-owned local assumption editing and display composition
- Corporate comparison:
  backend-owned universe resolution and valuation formulas, frontend-owned sort/filter/review presentation
- Monte Carlo Simulation Lab:
  frontend-owned worker execution and state transitions, backend only involved for optional stock-price lookup
- Report export:
  backend-owned canonical payload and export rendering, frontend-owned file delivery
