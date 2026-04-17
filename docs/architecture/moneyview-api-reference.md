# MoneyView API Reference

This document provides a complete executable mental model of the FastAPI endpoints in `apps/api/routes`. It defines the full technical contract between the frontend React application and the backend data/quant engine.

---

## 0. API Layer Role & Conventions

### 0.1 API Layer Role
- The API layer acts as the **boundary between UI and computation**.
- Responsible for: input validation (Pydantic), orchestration of data and computation, and enforcing response contracts.
- Not responsible for: financial model definition (handled by `core_finance`) or UI-specific formatting.

### 0.2 Request Lifecycle
1. Frontend sends HTTP request.
2. FastAPI validates input via Pydantic.
3. Route delegates to the service layer.
4. Service retrieves data (SQLite / cache / external).
5. Service calls `core_finance` if needed.
6. Result is wrapped in `APIResponse[T]`.
7. Response returned to frontend.

### 0.3 Consistency Model
- Read operations reflect the latest SQLite state.
- No transactional guarantees across multiple endpoints.
- External data fetches may introduce temporal inconsistency.

### 0.4 Heavy Endpoint Definition
Endpoints marked as **Heavy**:
- Involve CPU-intensive NumPy operations.
- May temporarily block the event loop under large workloads.
- Should not be triggered repeatedly in rapid succession by the UI.

### 0.5 Data Dependencies
- **Attribution** depends on: watchlist weights, historical price data.
- **DCF Valuation** depends on: financial metrics, user assumptions.
- **Monte Carlo** depends on: stochastic parameters, optional historical volatility inputs.

### 0.6 Response & Error Conventions
- **Base Path:** `/api/v1`
- **Response Envelope:** Most endpoints return a structured `APIResponse[T]`:
  ```json
  {
    "success": true,
    "data": T,
    "error": null
  }
  ```
- **Error Response Format:**
  ```json
  {
    "success": false,
    "data": null,
    "error": {
      "code": "STRING",
      "message": "Human readable message"
    }
  }
  ```
- **Pagination & Limits:** No pagination is implemented; all results are returned in full. This introduces potential performance issues for large datasets.
- **Timeout / Latency Expectations:**
  - Light endpoints: `< 100ms`
  - Heavy endpoints: `500ms` – several seconds
- **Units & Inputs:**
  - `period` supports: `"1y"`, `"3y"`, `"5y"`, `"10y"`
  - Returns are expressed in decimals (e.g., `0.1` = 10%)
  - Volatility is annualized.
- **Security:** None (local-only app). Assumes a trusted local environment.

---

## 1. Portfolio (`/api/v1/portfolio`)

**Data Storage Clarification:**
- **Source of Truth:** SQLite `watchlist` table is the persistent source.
- **Computed (Non-Persistent):** `/attribution` is calculated dynamically.

### Endpoints

- `GET /watchlist`
  - **Response:** `List[PortfolioStock]`
  - **Purpose:** Retrieves the current canonical watchlist holdings from the local SQLite database.
  - **Cache Behavior:** Uncached; reads directly from SQLite.
  - **Status:** Active
  - **Used By:** Portfolio page, Corporate comparison initialization.

- `GET /stock/{ticker}`
  - **Response:** `APIResponse[StockDetail]`
  - **Purpose:** Retrieves specific holding details (market data and related news) for a single ticker.
  - **Cache Behavior:** Short-lived cache for news/prices.
  - **Status:** Active
  - **Used By:** Portfolio detail drill-down.

- `POST /watchlist`
  - **Request Body:**
    ```json
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "sector": "Technology",
      "group_name": "core",
      "weight": 0.05
    }
    ```
  - **Response:** `WatchlistItem`
  - **Purpose:** Adds a new holding or updates an existing holding's target weight in the database.
  - **Idempotency:** Upserts by ticker (safe to call multiple times).
  - **Status:** Active
  - **Used By:** Portfolio page (Add/Edit holding modals).

- `DELETE /watchlist/{ticker}`
  - **Response:** `APIResponse[OperationStatus]`
  - **Purpose:** Removes a holding from the portfolio.
  - **Idempotency:** Idempotent (No-op if ticker does not exist).
  - **Status:** Active
  - **Used By:** Portfolio page.

- `POST /watchlist/sync`
  - **Response:** `APIResponse[WatchlistSyncResult]`
  - **Purpose:** Safely exports the current DB-backed watchlist into `stock_targets.json`.
  - **Idempotency:** Idempotent (overwrites JSON with identical DB state).
  - **Status:** Active
  - **Used By:** Portfolio settings.

- `POST /watchlist/resync`
  - **Response:** `APIResponse[WatchlistResyncResult]`
  - **Purpose:** Full overwrite of the SQLite database from the seed data (`stock_targets.json`).
  - **Idempotency:** Not idempotent (destructive overwrite).
  - **Status:** Active
  - **Used By:** Portfolio settings (Reset to defaults).

- `GET /watchlist/sync-status`
  - **Response:** `APIResponse[WatchlistSyncStatus]`
  - **Purpose:** Checks the metadata/status of the last watchlist ingestion.
  - **Status:** Active

- `POST /attribution`
  - **Request Body (`AttributionRequest`):**
    ```json
    {
      "tickers": ["AAPL", "MSFT"],
      "weights": [0.5, 0.5],
      "benchmark": "^GSPC",
      "period": "5y",
      "currency": "USD",
      "attribution_method": "brinson_fachler_arithmetic"
    }
    ```
  - **Response:** `APIResponse[AttributionResult]`
  - **Purpose:** Calculates portfolio attribution (Brinson-Fachler), benchmark comparisons, and active return metrics.
  - **Performance Notes:** **Heavy Endpoint**. CPU intensive; fetches historical data for all tickers and runs array-based arithmetic.
  - **Status:** Active
  - **Used By:** Portfolio page (Attribution charts and tables).

---

## 2. Corporate Analysis (`/api/v1/corporate`)

**Data Storage Clarification:**
- **Source of Truth:** User-overridden metrics (`PUT /metrics/{ticker}`) and saved snapshots are stored in SQLite.
- **Computed (Non-Persistent):** DCF results and diagnostic datasets are computed on the fly.

**Snapshot Semantics:**
- Snapshots are point-in-time materializations of computed valuation.
- Versioned by timestamp.
- Immutable once stored.

### Company Management
- `GET /companies` & `POST /companies`
  - **Response:** `List[CorporateCompany]` / `CorporateCompany`
  - **Purpose:** Fetches or adds target companies into the corporate analysis universe.
  - **Status:** Active

### Valuation
- `POST /dcf/{ticker}`
  - **Request Body (`ValuationAssumptions`):**
    ```json
    {
      "revenue_growth_rate": 0.05,
      "operating_margin": 0.20,
      "tax_rate": 0.21,
      "wacc": 0.08,
      "terminal_growth_rate": 0.02
    }
    ```
  - **Response:** `APIResponse[ValuationResult]`
  - **Purpose:** Calculates a Discounted Cash Flow valuation for a specific ticker based on provided hurdle rate and growth assumptions.
  - **Performance Notes:** **Heavy Endpoint**. Involves complex mathematical derivations.
  - **Status:** Active
  - **Used By:** Corporate Analysis page (Valuation tab).

- `GET /metrics/{ticker}` & `PUT /metrics/{ticker}`
  - **Response:** `CorporateMetrics`
  - **Purpose:** Retrieves or overrides the current base financial metrics (EBIT, CapEx, D&A, WACC) for a given company.
  - **Idempotency (`PUT`):** Idempotent (overwrites row with exact fields).
  - **Status:** Active
  - **Used By:** Corporate Analysis page (Assumptions sidebar).

### Diagnostics
- `GET /diagnostic/{ticker}/radar` & `GET /diagnostic/{ticker}/tornado`
  - **Response:** Formatted Recharts Datasets
  - **Purpose:** Provides specialized dataset structures to render the diagnostic Radar charts and Sensitivity (Tornado) charts in the UI.
  - **Status:** Active
  - **Used By:** Corporate Analysis page (Diagnostics tab).

### Snapshots & Comparison
- `GET /comparison` & `POST /comparison/snapshot`
  - **Response:** `APIResponse[CorporateComparisonResponse]`
  - **Purpose:** Computes live cross-stock valuation comparisons or materializes the KST-daily snapshot.
  - **Performance Notes:** **Heavy Endpoint**.
  - **Status:** Active

- `GET /comparison/history` & `GET /comparison/snapshot-version`
  - **Response:** `APIResponse[CorporateComparisonHistoryResponse]`
  - **Purpose:** Retrieves historical valuation snapshots to analyze intrinsic value drift.
  - **Status:** Active

---

## 3. Market Overview (`/api/v1/market`)

- `GET /indices`
  - **Response:** `List[IndexQuote]`
  - **Purpose:** Fetches current quotes for major market indices, commodities, and FX.
  - **Cache Behavior:** Short-lived cache (seconds/minutes) to avoid hitting external APIs.
  - **Status:** Active
  - **Used By:** Global Dashboard / Market Overview cards.

- `GET /index/{ticker}` & `GET /index/{ticker}/detail`
  - **Response:** `List[StockOHLCV]` / `MarketIndexDetail`
  - **Purpose:** Retrieves historical OHLCV pricing and specific detail cards for a given macro index.
  - **Cache Behavior:** Cached per ticker + period.
  - **Status:** Active

---

## 4. Detail (`/api/v1/detail`)

- `GET /{ticker}/ohlcv`
  - **Response:** `List[StockOHLCV]`
  - **Purpose:** Historical price series for rendering standard line/candlestick charts.
  - **Cache Behavior:** Cached per ticker + period.
  - **Status:** Active

- `GET /{ticker}/technicals`
  - **Response:** `TechnicalIndicators`
  - **Purpose:** Returns calculated technical indicators (e.g., SMA, EMA, RSI).
  - **Status:** Active

- `GET /{ticker}/monte-carlo`
  - **Response:** `MonteCarloResult`
  - **Purpose:** Retrieves server-side simulated price paths.
  - **Status:** Legacy
  - **Note:** Replaced by frontend browser-worker implementations in most UI flows.

---

## 5. Monte Carlo Lab (`/api/v1/monte-carlo`)

- `POST /analyze`
  - **Request Body (`MonteCarloRequest`):** Requires simulation constraints (time horizon, volatility, iterations, drift).
  - **Response:** `MonteCarloResponse`
  - **Purpose:** Triggers a backend-side Monte Carlo path simulation and risk analysis.
  - **Performance Notes:** **Heavy Endpoint**. Highly CPU intensive. Recommended only when iterations exceed frontend worker capabilities.
  - **Status:** Hybrid (frontend + backend).

---

## 6. Reports & News (`/api/v1/report` & `/api/v1/news`)

- `POST /report/summary` & `POST /report/export`
  - **Response:** `APIResponse[ReportPayload]`
  - **Purpose:** Generates structured summary reports of the portfolio state for UI consumption or exportable formats.
  - **Status:** Active

- `GET /news/feed` & `POST /news/crawl`
  - **Response:** `List[NewsArticle]`
  - **Purpose:** Retrieves cached financial news or triggers a targeted crawler.
  - **Cache Behavior:** Delayed/Cached. Avoids spamming external APIs.
  - **Status:** Active

---

## 7. Known Limitations

- **External Data Reliability:** Heavily dependent on the uptime and throttling limits of external providers.
- **No Request Deduplication:** In-flight duplicate requests are not deduplicated.
- **No Async Background Job Queue:** Heavy endpoints execute sequentially.
- **No Cancellation:** Long-running requests cannot be aborted midway.
- **No Streaming Responses:** Does not support chunked data streams.
- **Synchronous Bottlenecks:** Heavy endpoints rely on synchronous NumPy execution, which can momentarily block the FastAPI event loop.
