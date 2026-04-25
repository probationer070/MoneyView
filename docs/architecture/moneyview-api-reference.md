# MoneyView API Reference

This document defines the current FastAPI contract exposed by MoneyView under `apps/api`. It is the canonical reference for route families, request/response behavior, response-envelope conventions, persistence side effects, and known special cases such as streaming or hybrid endpoints.

## 0. API Layer Role And Conventions

### 0.1 API Role

The API layer is the boundary between the frontend and the local backend runtime. It is responsible for:

- request parsing and validation
- response shaping
- orchestration of services and persistence
- exposing canonical typed contracts to the frontend

It is not responsible for:

- defining canonical finance methodology
- frontend chart formatting
- direct UI state management

### 0.2 Request Lifecycle

The common request path is:

1. frontend sends an HTTP request
2. FastAPI validates query/body parameters and Pydantic models
3. the route delegates to a service or backend helper
4. the backend reads SQLite, local cache, or external provider data as needed
5. finance-engine or backend-owned calculation logic runs when required
6. the route returns a typed response to the caller

### 0.3 Base Path

All public routes are exposed under `/api/v1`, including:

- `/api/v1/health`
- `/api/v1/market/*`
- `/api/v1/portfolio/*`
- `/api/v1/detail/*`
- `/api/v1/news/*`
- `/api/v1/corporate/*`
- `/api/v1/diagnostic/*`
- `/api/v1/report/*`
- `/api/v1/monte-carlo/*`
- `/api/v1/stock/*`

### 0.4 Response Envelope Conventions

Most backend-owned domain endpoints return `APIResponse[T]`, typically with:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {}
}
```

Important exceptions:

- `GET /api/v1/portfolio/watchlist` returns `List[PortfolioStock]`
- `GET /api/v1/portfolio/stock/{ticker}` returns a plain `dict`
- `GET /api/v1/market/indices` returns `List[IndexQuote]`
- `GET /api/v1/market/index/{ticker}` returns `List[StockOHLCV]`
- `GET /api/v1/detail/{ticker}/ohlcv` returns `List[StockOHLCV]`
- `GET /api/v1/detail/{ticker}/technicals` returns `TechnicalIndicators`
- `GET /api/v1/detail/{ticker}/monte-carlo` returns `MonteCarloResult`
- `POST /api/v1/monte-carlo/analyze` returns `MonteCarloResponse`
- `GET /api/v1/news/feed` and news crawl endpoints return `List[NewsArticle]`
- `POST /api/v1/corporate/dcf/{ticker}/stream` returns `text/event-stream`, not `APIResponse`

### 0.5 Error Behavior

Typical error behavior includes:

- `422` for validation or business-rule errors raised as `ValueError`
- `404` for resource-not-found cases such as missing snapshot versions or watchlist tickers
- `409` for watchlist sync/resync conflicts such as missing valid JSON seed content
- `202` for stock-price lookup requests that are still fetching

The API assumes a trusted-local environment and does not include authentication or authorization failures.

### 0.6 Heavy Endpoint Definition

Heavy endpoints are routes that may:

- fetch significant historical data
- run synchronous numeric work
- perform multi-row or multi-ticker calculations
- write snapshot materializations

These routes are safe to use, but they should not be hammered repeatedly by the UI without debouncing or explicit user intent.

## 1. Health

### `GET /api/v1/health`

- **Purpose:** Primary health-check endpoint for the local runtime.
- **Response:** plain JSON with `status` and `version`
- **Persistence:** none
- **Consumers:** launcher health checks and local runtime validation

### `GET /api/v1/healthz`

- **Purpose:** Lightweight alternate health-check endpoint.
- **Response:** plain JSON with `status`
- **Persistence:** none
- **Consumers:** compatibility/health tooling

## 2. Portfolio Routes

Base path: `/api/v1/portfolio`

### Storage And Ownership

- SQLite `watchlist` is the canonical mutable store for holdings and saved weights.
- `portfolio_preferences` stores portfolio-level workspace preferences.
- `dataset_metadata` records watchlist sync/import state.
- attribution results are computed on demand and are not persisted as canonical state.

### `GET /watchlist`

- **Response:** `List[PortfolioStock]`
- **Purpose:** Return watchlist rows enriched with latest price, delta badge, and sparkline data.
- **Route-time side effect:** ensures one-time watchlist bootstrap from JSON or built-in defaults when local state is empty
- **Persistence touched:** reads `watchlist`; may write bootstrap rows and bootstrap metadata on first run
- **Classification:** light-to-medium, depending on price fetch/cache state
- **Consumers:** Portfolio page and watchlist-driven workflows

### `GET /preferences`

- **Response:** `APIResponse[PortfolioPreferences]`
- **Purpose:** Return persisted portfolio workspace preferences such as total investment amount and transaction-fee rate.
- **Persistence touched:** reads `portfolio_preferences`
- **Classification:** light
- **Consumers:** Portfolio allocation workspace

### `PUT /preferences`

- **Request body:** `PortfolioPreferences`
- **Response:** `APIResponse[PortfolioPreferences]`
- **Purpose:** Persist portfolio workspace preferences.
- **Persistence touched:** upserts `portfolio_preferences`
- **Classification:** light, mutating
- **Consumers:** Portfolio allocation workspace

### `GET /stock/{ticker}`

- **Response:** plain `dict` containing ticker, price history, and news
- **Purpose:** Return one stock's recent price series and news items for detail workflows.
- **Persistence touched:** reads through market/news services; may use cache/provider-backed data
- **Classification:** medium
- **Consumers:** Portfolio stock detail drill-down

### `POST /watchlist`

- **Request body:** `WatchlistItem`
- **Response:** `WatchlistItem`
- **Purpose:** Add or update a watchlist entry.
- **Persistence touched:** upserts `watchlist`; records managed watchlist state in `dataset_metadata`
- **Classification:** light, mutating
- **Idempotency:** ticker-based upsert
- **Consumers:** Portfolio page add/edit flows

### `POST /watchlist/resync`

- **Response:** `APIResponse[WatchlistResyncResult]`
- **Purpose:** Destructively replace SQLite watchlist rows from `stock_targets.json`.
- **Persistence touched:** clears and repopulates `watchlist`; records sync/import metadata in `dataset_metadata`
- **Classification:** light, mutating, destructive
- **Error behavior:** `409` if no valid watchlist items exist in the JSON file
- **Consumers:** explicit watchlist import/reset workflows

### `POST /watchlist/sync`

- **Response:** `APIResponse[WatchlistSyncResult]`
- **Purpose:** Export the current SQLite-backed watchlist to `stock_targets.json`.
- **Persistence touched:** reads `watchlist`; writes JSON file; records sync metadata in `dataset_metadata`
- **Classification:** light, mutating file artifact
- **Error behavior:** `409` if no watchlist items are available to export
- **Consumers:** explicit watchlist export workflows

### `GET /watchlist/sync-status`

- **Response:** `APIResponse[WatchlistSyncStatus]`
- **Purpose:** Return the last explicit sync/import metadata for the watchlist artifact.
- **Persistence touched:** reads `dataset_metadata`
- **Classification:** light
- **Consumers:** Portfolio settings and sync-status UI

### `DELETE /watchlist/{ticker}`

- **Response:** plain JSON object with deletion status and ticker
- **Purpose:** Delete one watchlist entry by ticker.
- **Persistence touched:** deletes from `watchlist`; records managed watchlist state in `dataset_metadata`
- **Classification:** light, mutating
- **Error behavior:** `404` if the ticker does not exist
- **Consumers:** Portfolio watchlist management

### `POST /attribution`

- **Request body:** `AttributionRequest`
- **Response:** `APIResponse[AttributionResult]`
- **Purpose:** Build portfolio attribution, benchmark comparison, and risk outputs.
- **Persistence touched:** primarily reads cached/local market data and watchlist-driven inputs; does not persist attribution as canonical state
- **Classification:** heavy
- **Error behavior:** `422` on unsupported payloads or invalid attribution assumptions
- **Consumers:** Portfolio attribution charts, tables, and report flows

## 3. Corporate Routes

Base path: `/api/v1/corporate`

### Storage And Ownership

- `corporate_metrics` stores persisted metric overrides
- `corporate_companies` stores manually added companies
- `corporate_comparison_snapshots_v3` stores versioned comparison snapshots
- route-time watchlist bootstrap may occur before comparison/company flows that depend on the watchlist universe

### `GET /companies`

- **Response:** `list[CorporateCompany]`
- **Purpose:** Return the current corporate-analysis company universe, combining defaults, watchlist-backed names, and manually added companies.
- **Route-time side effect:** ensures watchlist bootstrap before company-universe resolution
- **Persistence touched:** reads `watchlist` and `corporate_companies`; may trigger one-time bootstrap writes
- **Classification:** light
- **Consumers:** Corporate ticker search and manual-company workflows

### `POST /companies`

- **Request body:** `CorporateCompany`
- **Response:** `CorporateCompany`
- **Purpose:** Add or update a manually persisted corporate-analysis company.
- **Persistence touched:** upserts `corporate_companies`; seeds default metrics into `corporate_metrics` if absent
- **Classification:** light, mutating
- **Consumers:** Corporate manual-company add flow

### `GET /comparison`

- **Response:** `APIResponse[CorporateComparisonResponse]`
- **Purpose:** Return live or snapshot comparison rows across a selected universe.
- **Query parameters:** `mode`, `comparison_universe`, `benchmark_ticker`, `custom_tickers`
- **Route-time side effect:** ensures watchlist bootstrap when needed
- **Persistence touched:** reads watchlist, metrics, prices, and snapshot tables; in snapshot mode may materialize today's snapshot on demand if missing
- **Classification:** heavy
- **Consumers:** Corporate comparison section and snapshot-backed review flows

### `POST /comparison/snapshot`

- **Response:** `APIResponse[CorporateComparisonResponse]`
- **Purpose:** Force a fresh persisted snapshot version for the selected comparison universe.
- **Persistence touched:** writes a new snapshot version into `corporate_comparison_snapshots_v3`
- **Classification:** heavy, mutating
- **Consumers:** explicit manual snapshot refresh

### `GET /comparison/history`

- **Response:** `APIResponse[CorporateComparisonHistoryResponse]`
- **Purpose:** Return per-day snapshot-history summaries for a selected comparison universe.
- **Persistence touched:** reads `corporate_comparison_snapshots_v3`
- **Classification:** medium
- **Consumers:** snapshot history list and timeline review

### `GET /comparison/snapshot-version`

- **Response:** `APIResponse[CorporateComparisonResponse]`
- **Purpose:** Return one persisted snapshot version by `snapshot_version`.
- **Persistence touched:** reads `corporate_comparison_snapshots_v3`
- **Classification:** light-to-medium
- **Error behavior:** `404` if the snapshot version does not exist
- **Consumers:** snapshot review and historical drill-down

### `DELETE /comparison/snapshot-version`

- **Response:** `APIResponse[CorporateComparisonSnapshotDeleteResult]`
- **Purpose:** Delete one persisted snapshot version.
- **Persistence touched:** deletes from `corporate_comparison_snapshots_v3`
- **Classification:** light, mutating
- **Error behavior:** `404` if the snapshot version does not exist
- **Consumers:** snapshot cleanup workflows

### `GET /comparison/stock-history`

- **Response:** `APIResponse[CorporateComparisonStockHistoryResponse]`
- **Purpose:** Return one stock's saved comparison metrics across the latest snapshot versions by day.
- **Persistence touched:** reads `corporate_comparison_snapshots_v3`
- **Classification:** medium
- **Consumers:** snapshot-backed stock history drill-down

### `POST /dcf/{ticker}`

- **Request body:** `ValuationAssumptions`
- **Response:** `APIResponse[dict]`
- **Purpose:** Return a lightweight non-streaming DCF summary for compatibility paths.
- **Persistence touched:** reads current metrics and market price inputs; no canonical DCF persistence
- **Classification:** heavy
- **Consumers:** Corporate valuation requests that do not need the full report

### `POST /dcf/{ticker}/report`

- **Request body:** `ValuationAssumptions`
- **Response:** `APIResponse[DCFFullReport]`
- **Purpose:** Return the full DCF report for one ticker on explicit request.
- **Persistence touched:** reads current metrics and price inputs; no canonical DCF persistence
- **Classification:** heavy
- **Consumers:** Corporate full-report workflows

### `POST /dcf/reports/bulk`

- **Request body:** `CorporateDcfBatchRequest`
- **Response:** `APIResponse[list[DCFFullReport]]`
- **Purpose:** Compute full DCF reports for a batch of tickers.
- **Persistence touched:** reads `corporate_metrics` and market price inputs
- **Classification:** heavy
- **Consumers:** bulk corporate report workflows

### `POST /dcf/{ticker}/stream`

- **Request body:** `ValuationAssumptions`
- **Response:** `text/event-stream`
- **Purpose:** Stream DCF phase output without sending the full report in one blocking payload.
- **Transport behavior:** emits `phase1`, `phase2`, and `complete` events
- **Persistence touched:** reads current metrics and price inputs; no canonical DCF persistence
- **Classification:** heavy, streaming
- **Consumers:** incremental DCF UX and transport-progress observability

### `GET /metrics/{ticker}`

- **Response:** `CorporateMetrics`
- **Purpose:** Return effective corporate metrics for a ticker, with support for growth/ROIC basis selection.
- **Query parameters:** `growth_basis`, `roic_basis`, `growth_year`, `roic_year`
- **Persistence touched:** reads `corporate_metrics` and Yahoo-derived statement inputs when available
- **Classification:** medium
- **Consumers:** Corporate assumptions and metrics sidebar

### `GET /metrics/{ticker}/audit`

- **Response:** `CorporateMetricAudit`
- **Purpose:** Return auditable ROIC, WACC, and `ROIC - WACC` metadata, including source mode, quality state, warnings, calculation version, and the intermediate inputs used for display/explanation.
- **Query parameters:** `roic_basis`, `roic_year`
- **Persistence touched:** reads `corporate_metrics` and Yahoo-derived statement inputs when available; does not persist audit output
- **Classification:** medium
- **Special cases:**
  - `source_mode` may be `yahoo_finance`, `corporate_metrics`, `default_model`, or `unavailable`
  - metric quality may be `ok`, `estimated`, `stale`, `suspicious`, `invalid`, or `missing`
  - `spread` inherits the lower-confidence state of `roic` and `wacc`
- **Consumers:** Corporate calculation-detail modal, Corporate assumption quality badges, and Portfolio stock-detail audit panels

### `GET /metrics/{ticker}/history`

- **Response:** plain JSON history payload
- **Purpose:** Return annual growth and ROIC basis history derived from Yahoo statement data when available.
- **Persistence touched:** provider/cache-driven read path; does not persist a separate canonical history table
- **Classification:** medium
- **Consumers:** growth/ROIC basis selector workflows

### `GET /metrics/{ticker}/quarterly-statements`

- **Response:** plain JSON payload with quarterly statement rows
- **Purpose:** Return quarterly income statement, balance sheet, and cash-flow rows for the ticker.
- **Persistence touched:** provider/cache-driven read path
- **Classification:** medium
- **Consumers:** calculation-detail modal and statement inspection UI

### `PUT /metrics/{ticker}`

- **Request body:** `CorporateMetrics`
- **Response:** `CorporateMetrics`
- **Purpose:** Persist corporate metrics overrides for a ticker.
- **Persistence touched:** upserts `corporate_metrics`
- **Classification:** light, mutating
- **Consumers:** Corporate metric override flows

### `GET /diagnostic/{ticker}/radar`

- **Response:** `APIResponse[list[dict]]`
- **Purpose:** Return the radar-chart dataset used by Corporate diagnostic views.
- **Persistence touched:** none
- **Classification:** light
- **Consumers:** Corporate diagnostic charts

### `GET /diagnostic/{ticker}/tornado`

- **Response:** `APIResponse[list[dict]]`
- **Purpose:** Return the tornado-style diagnostic dataset used by Corporate views.
- **Persistence touched:** none
- **Classification:** light
- **Consumers:** Corporate diagnostic charts

## 4. Market Routes

Base path: `/api/v1/market`

### `GET /indices`

- **Response:** `List[IndexQuote]`
- **Purpose:** Return the market-overview summary cards for tracked indices/instruments.
- **Persistence touched:** market-data cache and provider-backed history lookup
- **Classification:** medium
- **Consumers:** Market Overview dashboard cards

### `GET /index/{ticker}`

- **Response:** `List[StockOHLCV]`
- **Purpose:** Return OHLCV history for one tracked index or macro instrument.
- **Query parameters:** `period`
- **Persistence touched:** index history cache/SQLite reads with possible live refresh logic inside the market-data service
- **Classification:** medium
- **Consumers:** Market detail charts and historical panels

### `GET /index/{ticker}/detail`

- **Response:** `MarketIndexDetail`
- **Purpose:** Return expanded Market Overview detail, including enriched instrument metadata and data-quality payload.
- **Query parameters:** `period`
- **Persistence touched:** index history cache/SQLite reads with freshness logic
- **Classification:** medium
- **Consumers:** Market Overview detail panels

## 5. Detail Routes

Base path: `/api/v1/detail`

### `GET /{ticker}/ohlcv`

- **Response:** `List[StockOHLCV]`
- **Purpose:** Return historical OHLCV data for a stock detail workflow.
- **Query parameters:** `period`
- **Persistence touched:** stock history cache/SQLite reads with provider-backed refresh behavior
- **Classification:** medium
- **Consumers:** detail route price chart

### `GET /{ticker}/technicals`

- **Response:** `TechnicalIndicators`
- **Purpose:** Compute RSI, MACD, Bollinger Bands, and moving averages from the historical close series.
- **Persistence touched:** reads stock OHLCV data; does not persist technical outputs
- **Classification:** medium compute
- **Consumers:** detail route technical indicators

### `GET /{ticker}/monte-carlo`

- **Response:** `MonteCarloResult`
- **Purpose:** Run a NumPy-based server-side GBM Monte Carlo path summary for a ticker.
- **Query parameters:** `paths`, `horizon_days`
- **Persistence touched:** reads stock OHLCV data; does not persist Monte Carlo results
- **Classification:** heavy
- **Status:** legacy/hybrid
- **Consumers:** legacy or compatibility detail flows; not the primary current simulation UX

## 6. Monte Carlo Routes

Base path: `/api/v1/monte-carlo`

### `POST /analyze`

- **Request body:** `MonteCarloRequest` defined locally in `apps/api/routes/monte_carlo.py`
- **Response:** `MonteCarloResponse`
- **Purpose:** Run a backend-side jump-diffusion Monte Carlo analysis with risk, histogram, valuation, and correlation outputs.
- **Persistence touched:** none
- **Classification:** heavy
- **Status:** hybrid
- **Consumers:** backend Monte Carlo analysis workflows when browser-worker paths are insufficient or a backend response is desired

## 7. Report Routes

Base path: `/api/v1/report`

### `POST /summary`

- **Request body:** `ReportSummaryRequest`
- **Response:** `APIResponse[ReportPayload]`
- **Purpose:** Build the canonical report payload used by export workflows.
- **Persistence touched:** reads portfolio/report inputs; does not persist the report as canonical state
- **Classification:** heavy-to-medium depending on attribution inputs
- **Error behavior:** `422` on invalid report request payloads
- **Consumers:** export preview and report-generation workflows

### `POST /export`

- **Request body:** `ReportExportRequest`
- **Response:** `APIResponse[ReportExportResponse]`
- **Purpose:** Render backend export output for formats such as JSON, CSV, Markdown, or print-safe HTML.
- **Persistence touched:** reads report inputs; generated export payload is returned rather than persisted as canonical state
- **Classification:** medium
- **Error behavior:** `422` on invalid export requests
- **Consumers:** export button and browser print/download flows

## 8. News Routes

Base path: `/api/v1/news`

### `GET /feed`

- **Response:** `List[NewsArticle]`
- **Purpose:** Return news articles filtered by ticker or keyword.
- **Query parameters:** `ticker`, `q`, `limit`, `offset`
- **Persistence touched:** reads from local news persistence/cache
- **Classification:** light
- **Consumers:** news feed and stock-news panels

### `POST /crawl`

- **Response:** `List[NewsArticle]`
- **Purpose:** Trigger a live crawl by keyword and optionally associate it with a ticker.
- **Query parameters:** `query`, `ticker`, `limit`
- **Persistence touched:** crawls and persists news results
- **Classification:** medium, mutating
- **Consumers:** explicit news crawl workflows

### `POST /crawl/stock`

- **Response:** `List[NewsArticle]`
- **Purpose:** Trigger a stock-specific crawl and persist the results.
- **Query parameters:** `ticker`, `company_name`, `limit`, `offset`
- **Persistence touched:** crawls and persists news results
- **Classification:** medium, mutating
- **Consumers:** stock-specific news refresh workflows

## 9. Diagnostic Routes

Base path: `/api/v1/diagnostic`

### `GET /logs/api-tail`

- **Response:** `APIResponse[LogTailResponse]`
- **Purpose:** Return a recent plain-text tail of the persistent API server log.
- **Query parameters:** `lines`
- **Persistence touched:** reads `data/cache/logs/api-server.log`
- **Classification:** light
- **Consumers:** developer observability and local debugging workflows

## 10. Stock Lookup Route

Base path: `/api/v1/stock`

### `GET /{ticker}/price`

- **Response:** `APIResponse[StockPriceLookup]`
- **Purpose:** Return a stock-price lookup result for autofill and quick lookup workflows.
- **Persistence touched:** market-data lookup path and short-lived cache/provider behavior
- **Classification:** light-to-medium
- **Special status codes:**
  - `200` when a price result is ready
  - `202` when the lookup is still fetching
  - `404` when the ticker cannot be resolved
- **Consumers:** stock-price autofill and quick lookup UI

## 11. Persistence Side-Effect Summary

Routes that can mutate SQLite or durable local artifacts include:

- `PUT /api/v1/portfolio/preferences`
- `POST /api/v1/portfolio/watchlist`
- `POST /api/v1/portfolio/watchlist/resync`
- `POST /api/v1/portfolio/watchlist/sync` (mutates JSON artifact and metadata)
- `DELETE /api/v1/portfolio/watchlist/{ticker}`
- `POST /api/v1/corporate/companies`
- `POST /api/v1/corporate/comparison/snapshot`
- `DELETE /api/v1/corporate/comparison/snapshot-version`
- `PUT /api/v1/corporate/metrics/{ticker}`
- `POST /api/v1/news/crawl`
- `POST /api/v1/news/crawl/stock`

Routes that may trigger route-time bootstrap/materialization behavior include:

- `GET /api/v1/portfolio/watchlist`
- `GET /api/v1/corporate/companies`
- `GET /api/v1/corporate/comparison`
- `GET /api/v1/corporate/comparison/history`
- `GET /api/v1/corporate/comparison/stock-history`

## 12. Hybrid And Legacy Notes

- `GET /api/v1/detail/{ticker}/monte-carlo` remains a server-side Monte Carlo endpoint but is no longer the primary current simulation UX.
- `POST /api/v1/monte-carlo/analyze` is active, but the main Simulation Lab still relies heavily on browser-worker execution.
- `POST /api/v1/corporate/dcf/{ticker}/stream` is the primary streaming special case in the API surface.

## 13. Known API Limitations

- No authentication or authorization layer
- No pagination on collection-style endpoints
- No request deduplication for in-flight identical work
- No cancellation support for heavy synchronous calculations
- Heavy endpoints may temporarily block the local backend process
- External provider latency and freshness directly affect response quality
