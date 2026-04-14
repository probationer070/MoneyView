# Data Flow

## Portfolio Attribution

1. The frontend loads holdings from `GET /api/v1/portfolio/watchlist`.
2. The backend bootstraps the SQLite `watchlist` table once from `stock_targets.json` or a built-in default list if local state is empty.
3. The frontend uses saved `watchlist.weight` values when any positive weights exist; otherwise it falls back to an equal-weight portfolio basket.
4. The frontend sends `AttributionRequest` to `POST /api/v1/portfolio/attribution`.
5. The route delegates to `PortfolioAnalyticsService`.
6. `CacheService` checks a deterministic cache key.
7. `DataProvider` loads price series and sector metadata from SQLite.
8. `BenchmarkService` builds user-provided benchmark sector profiles or an explicitly opted-in provider proxy.
9. `AttributionEngine` calculates arithmetic Brinson-Fachler attribution.
10. `RiskEngine` calculates beta, historical VaR, and expected shortfall.
11. Pydantic validates reconciliation and weight invariants.
12. The frontend adapter maps the domain payload into chart-specific arrays.

## Watchlist Mutation

1. The frontend sends `POST /api/v1/portfolio/watchlist` to add a holding or update its saved metadata.
2. The route normalizes the ticker and persists the row directly to SQLite.
3. The backend marks watchlist state as user-managed so bootstrap seeding does not silently restore deleted defaults later.
4. The frontend invalidates watchlist and attribution queries, then re-renders from the DB-backed response.

## Watchlist Delete

1. The frontend sends `DELETE /api/v1/portfolio/watchlist/{ticker}`.
2. The route deletes the exact ticker row from SQLite or returns `404` if it does not exist.
3. The backend marks watchlist state as user-managed.
4. On the next load, the backend keeps the watchlist empty instead of reseeding defaults automatically.

## Watchlist Source Of Truth

The watchlist workflow now has an explicit local-first source-of-truth model.

### Canonical Mutable Store

- SQLite `watchlist` is the primary mutable store for:
  ticker membership
  display metadata
  saved portfolio allocation weight
- The Portfolio page reads from SQLite-backed API responses and writes mutations back to SQLite.
- User-adjusted weights are intended to live in SQLite first, not in JSON seed files.

### Seed And Sync File

- `apps/api/services/webscrap/stock_targets.json` is a seed/import-export artifact.
- The file is still useful for:
  first bootstrap when local watchlist state is empty
  explicit import/replace from file
  explicit export of the current DB-backed watchlist for external editing or inspection
- The file is not the primary mutable allocation store once a local watchlist exists.

## Watchlist Sync Model

Two explicit flows now exist and they are intentionally asymmetric.

### Safe Sync: DB To JSON

1. The frontend sends `POST /api/v1/portfolio/watchlist/sync`.
2. The backend reads the current SQLite `watchlist`.
3. The backend writes the current holdings, metadata, and weights into `stock_targets.json`.
4. The backend records sync metadata in `dataset_metadata`.
5. The frontend refreshes watchlist and sync-status state and reports the last explicit sync source/time.

This is the safe path because it preserves the DB-backed user-managed weights and simply exports them.

### Destructive Import: JSON To DB

1. The frontend warns that import is destructive and requires explicit confirmation.
2. The frontend sends `POST /api/v1/portfolio/watchlist/resync`.
3. The backend replaces SQLite `watchlist` rows with the current `stock_targets.json` contents.
4. The backend records import metadata in `dataset_metadata`.
5. The frontend refreshes from the replaced DB state.

This is intentionally not the safe path. It is an explicit replace-from-file operation.

## Sync Status Metadata

- `GET /api/v1/portfolio/watchlist/sync-status` returns the last explicit sync/import source and timestamp.
- Sync/import metadata is stored in `dataset_metadata`.
- The UI uses this to distinguish:
  safe DB export
  destructive JSON import

## Corporate Comparison Flow

1. The frontend loads `GET /api/v1/corporate/comparison?mode=snapshot|live`.
2. The backend resolves the requested comparison universe:
  `portfolio_plus_benchmark`
  `watchlist_plus_benchmark`
  `custom`
3. In `portfolio_plus_benchmark`, the backend uses saved positive-weight holdings as the portfolio universe and falls back to equal-weight watchlist holdings only when no positive weights exist.
4. In `watchlist_plus_benchmark`, the backend includes all tracked watchlist rows, including zero-weight names.
5. In `custom`, the backend compares the requested custom ticker set plus the selected benchmark ticker.
6. In `snapshot` mode, the backend serves the current KST business-date snapshot from SQLite when available.
7. If the current KST business-date snapshot does not exist yet for the requested universe key, the backend computes the comparison once and persists a `scheduled_kst_daily` snapshot before returning it.
8. In `live` mode, the backend computes the comparison directly from current rows, current prices, and current saved corporate metrics without reading snapshot rows for values.
9. For each ticker, the backend derives:
  `ROIC - WACC`
  DCF-derived value
  DCF-implied stock expected return
  CAPM-style reference expected return
  market expected return
  expected return spread
10. Market expected return is defined in backend finance logic as:
  `risk_free_rate + equity_risk_premium`
11. The primary stock expected return is defined as DCF-implied upside:
  `dcf_value / current_price - 1`
12. A CAPM-style reference return is also exposed using:
  `risk_free_rate + levered_beta x equity_risk_premium`
13. Snapshot metadata includes the resolved `comparison_universe`, `benchmark_ticker`, and `custom_tickers` so historical comparisons stay reproducible.
14. When the user selects a saved snapshot version from history, the frontend routes table rows and stock-modal drill-down requests through that saved snapshot context instead of the transient current controls.
15. The frontend sorts and compares those rows, but the formulas remain backend-owned.

## Corporate Comparison Snapshots

- Snapshots are stored in SQLite `corporate_comparison_snapshots_v3`.
- Snapshot cadence is `daily_kst_0000`.
- Snapshot retention is currently `365` days.
- Snapshot rows persist:
  as-of date
  generation timestamp
  snapshot version id
  snapshot source
  risk-free rate
  equity risk premium
  expected return methods
  all comparison row metrics
- `POST /api/v1/corporate/comparison/snapshot` is the explicit manual refresh path.
- The backend also runs a background snapshot cycle at startup and then again at each KST midnight boundary.
- Manual refresh now creates a new intraday snapshot version for the same KST business date instead of overwriting the prior version.
- Default snapshot reads still resolve to the latest saved version for that date and universe.
- If snapshot refresh fails and an older snapshot exists, snapshot mode may fall back to the latest saved snapshot and mark it stale in response metadata.
- The portfolio UI shows a visible calculating state while debounced benchmark/custom-ticker inputs settle so live recalculation does not feel stale.
- Extreme per-stock comparison values are rendered as `N/A` in the table and called out explicitly in the stock modal so snapshot review does not imply invalid values are trustworthy.

## Corporate Analysis Flow

1. The frontend loads `GET /api/v1/corporate/companies` for ticker search and manual-company registry state.
2. The user selects or adds a ticker in the Corporate Analysis page.
3. The frontend loads `GET /api/v1/corporate/metrics/{ticker}` using the selected growth and ROIC basis settings.
4. The frontend may also load `GET /api/v1/corporate/metrics/{ticker}/history` for annual growth and ROIC basis selection.
5. The frontend loads `GET /api/v1/corporate/metrics/{ticker}/quarterly-statements` and `GET /api/v1/detail/{ticker}/ohlcv` for the calculation-detail modal datasets.
6. Realtime assumption changes remain frontend-owned while the page debounces a backend DCF request to `POST /api/v1/corporate/dcf/{ticker}`.
7. The backend returns fair-value and upside outputs derived from the current debounced assumptions plus market price data.
8. The frontend renders KPI cards, diagnostic graphs, and the calculation-detail modal from the combined frontend-derived and backend-returned values.
9. The lower `Target Stock Comparison` section calls `GET /api/v1/corporate/comparison?mode=live` and remains a live comparison workflow rather than a persisted portfolio snapshot workflow.

## Monte Carlo Flow

1. The frontend mounts `apps/web/app/monte-carlo/page.tsx`.
2. The page creates a shared web worker from `apps/web/app/monte-carlo/workers/simulation.worker.ts`.
3. In `Path Simulation`, the page sends `run-path` to the worker with browser-owned path assumptions.
4. The worker runs the shared Monte Carlo engine from `simulation-core.ts` and emits progress events plus one final result.
5. The frontend reuses that shared result for the `Risk Analysis` and `Return Distribution` tabs without recomputing a separate engine.
6. In `Corporate Valuation`, the page sends `run-valuation` to the same worker, which runs `valuation-core.ts`.
7. In `Correlation Model`, the page sends `run-correlation` to the same worker, which runs `correlation-core.ts`.
8. Progress, cancellation, and final results are page-owned state transitions in the frontend.
9. Monte Carlo results are currently exploratory frontend outputs and are not persisted to SQLite by default.

## Report Export

1. The frontend sends `ReportExportRequest` to `POST /api/v1/report/export`.
2. `PortfolioAnalyticsService` builds the canonical `ReportPayload`.
3. `ReportRenderer` formats the payload as JSON, CSV, Markdown, or print-safe HTML.
4. The frontend downloads the payload or opens the HTML for browser print-to-PDF.

## Data Quality

The attribution API fails closed for missing price series unless `allow_synthetic_fallback=true` is provided. When synthetic fallback is used, the response metadata includes `data_quality.synthetic_data_used`, `data_quality.synthetic_tickers`, and a limitation message.

Provider-derived benchmark sector profiles are equal-sector proxies because true benchmark constituent weights are not available in the local data store. The API requires `allow_benchmark_proxy=true` before using this approximation and records it in `data_quality.benchmark_proxy_used`.

Only USD, daily returns, and beginning-of-period weights are implemented. Monthly returns, EOP weights, and real FX conversion are rejected until implemented.

The current portfolio UI uses saved weights when present and falls back to equal weights otherwise. Direct API callers may still use `allow_cash=true` to submit explicit portfolios whose total weight is below `1.0`.

The current Monte Carlo workflow is worker-local and browser-contained. It is suitable for exploratory analysis, but it is not yet a persisted backend report or batch-simulation service.
