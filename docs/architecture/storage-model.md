# MoneyView Storage Model

This document is the canonical home for MoneyView's local persistence, cache, seed, and source-of-truth rules.

## 1. Storage Layers

MoneyView uses a local-first storage model with three main storage classes:

1. SQLite for canonical persistent application state
2. filesystem cache/log artifacts under `data/`
3. seed/import-export artifacts used for controlled bootstrap or sync flows

The default SQLite path is `data/processed/moneyview.db`, resolved from `DB_PATH` when that environment variable is present.

## 2. SQLite As The Canonical Persistent Store

SQLite is the authoritative persistent store for MoneyView's local runtime.

### 2.1 Connection And Session Rules

The database layer in `apps/api/services/db.py` applies these SQLite settings on each connection:

- `PRAGMA journal_mode=WAL`
- `PRAGMA cache_size=-65536`
- `PRAGMA synchronous=NORMAL`
- `PRAGMA foreign_keys=ON`
- `PRAGMA temp_store=MEMORY`

The backend also runs periodic WAL truncation during runtime and attempts a final WAL truncate during shutdown.

### 2.2 Schema Initialization And Compatibility

`init_db()` creates the canonical schema and then applies additive compatibility migrations for older local DB files. The migration approach is intentionally local and additive:

- create missing tables if absent
- add newly required columns to legacy tables
- preserve older local DBs without destructive migration by default
- seed required singleton/default rows such as `portfolio_preferences`

## 3. Canonical Tables And Ownership

### 3.1 Market And Data Tables

**`indices`**
- stores index OHLCV-style records
- keyed by `ticker` and `date`
- used for market overview and index history flows

**`stocks`**
- stores stock OHLCV-style records with corporate-action columns
- keyed by `ticker` and `date`
- supports portfolio, detail, and market-data workflows

**`indicators`**
- stores macro/economic indicator series
- keyed by `code` and `date`
- supports macro and economic views

**`news`**
- stores crawled or fetched news items
- includes headline, URL, source, published date, sentiment, and importance

### 3.2 Portfolio And Watchlist Tables

**`watchlist`**
- canonical mutable store for user portfolio/watchlist membership
- stores `ticker`, `name`, `sector`, `group_name`, and `weight`
- this is the primary source of truth for holdings and saved allocation weights

**`portfolio_preferences`**
- singleton table for persisted portfolio workspace preferences
- currently stores:
  `total_investment_amount`
  `transaction_fee_rate`
  `updated_at`

### 3.3 Metadata And Local Coordination Tables

**`dataset_metadata`**
- stores local metadata such as freshness and sync/import status
- currently used for watchlist bootstrap/sync coordination
- example dataset markers include:
  `watchlist_state`
  `watchlist_sync_status`

### 3.4 Corporate Analysis Tables

**`corporate_metrics`**
- stores persisted metrics and overrides for corporate analysis
- contains values such as growth, ROIC, WACC, debt ratio, beta inputs, FCFF, and qualitative scoring inputs

**`corporate_companies`**
- stores manually added companies for corporate analysis
- acts as a local registry extension beyond default companies and watchlist rows

### 3.5 Corporate Comparison Snapshot Tables

MoneyView contains snapshot-table evolution in the schema:

- `corporate_comparison_snapshots`
- `corporate_comparison_snapshots_v2`
- `corporate_comparison_snapshots_v3`

The active canonical snapshot store is:

**`corporate_comparison_snapshots_v3`**
- stores snapshot-versioned corporate comparison rows
- primary key is `(snapshot_version, ticker)`
- supports:
  snapshot version history
  same-day multiple versions
  universe-aware snapshot keys
  saved benchmark/custom-ticker context
  both DCF-implied and CAPM-style expected-return views

Older snapshot tables remain part of compatibility history, but new behavior is modeled around `v3`.

## 4. Watchlist Ownership Model

The watchlist workflow follows an explicit local-first ownership model.

### 4.1 Canonical Mutable Store

SQLite `watchlist` is the canonical mutable store for:

- ticker membership
- display metadata
- saved allocation weight

The Portfolio page reads watchlist data from the API, which in turn reads SQLite. User mutations persist back into SQLite.

### 4.2 Bootstrap Source

`apps/api/services/webscrap/stock_targets.json` is the bootstrap/import-export artifact.

Bootstrap behavior is:

1. if `watchlist` already has rows, keep SQLite as authority
2. if `watchlist` is empty and no managed watchlist state exists, seed from JSON when possible
3. if JSON is absent and DB-derived regeneration is not possible, seed from built-in defaults

### 4.3 Managed State Flag

After user mutation or explicit sync/import actions, `dataset_metadata` records watchlist state so the backend does not silently reseed deleted defaults later.

### 4.4 Sync Model

**Safe sync: DB to JSON**
- exports the SQLite-backed watchlist into `stock_targets.json`
- preserves user-managed weights
- records sync metadata in `dataset_metadata`

**Destructive import: JSON to DB**
- clears and replaces `watchlist` with JSON contents
- requires explicit user action
- records import metadata in `dataset_metadata`

## 5. Corporate Comparison Snapshot Storage

Corporate comparison snapshots are persisted in `corporate_comparison_snapshots_v3`.

### 5.1 Snapshot Semantics

Each snapshot version stores:

- `snapshot_version`
- `snapshot_date`
- `universe_key`
- `comparison_universe`
- `benchmark_ticker`
- `custom_tickers`
- `snapshot_taken_at`
- `snapshot_source`
- risk-free and equity-risk-premium values
- per-row valuation and expected-return metrics

### 5.2 Retention And Cadence

The current snapshot policy is:

- cadence: `daily_kst_0000`
- retention: `365` days
- same-day manual refreshes create new versions instead of overwriting earlier ones

### 5.3 Snapshot Sources

Observed snapshot sources include:

- `scheduled_kst_daily`
- `manual_refresh`

### 5.4 Snapshot Read Behavior

- snapshot mode prefers the current KST business-date snapshot for the requested universe
- if today's snapshot is missing, the backend may materialize it on demand
- if refresh fails and an older snapshot exists, the response may fall back to the latest available snapshot and mark it stale

## 6. File-Based Runtime Artifacts

### 6.1 Discovery File

**`data/cache/moneyview_port.json`**
- written by the launcher for frontend backend-port discovery
- also written by the backend in fallback standalone-port-selection logic
- used by frontend server-side code to find the local API port

Typical contents include:

- `port`
- `host`
- `apiBaseUrl`
- `generatedAt`
- `generatedBy`
- `logs.apiServer`
- `logs.nextServer`

### 6.2 Runtime Logs

**`data/cache/logs/api-server.log`**
- persistent plain-text log output for the FastAPI server process

**`data/cache/logs/next-server.log`**
- persistent plain-text log output for the Next.js server process

These are runtime artifacts, not canonical business data.

### 6.3 Other Local Data Areas

**`data/raw/`**
- raw extracts and source-side local artifacts

**`data/processed/`**
- processed local data, including SQLite by default

**`data/cache/`**
- runtime coordination and cache artifacts

## 7. Persistent Vs Transient Boundaries

### 7.1 Persisted

Persisted local state includes:

- watchlist rows and saved weights
- portfolio preferences
- corporate metrics overrides
- manually added corporate companies
- comparison snapshots
- ingested market/index/indicator/news rows
- local sync/freshness metadata

### 7.2 Transient

Transient or request-scoped outputs include:

- DCF summary/report responses unless separately persisted by another workflow
- attribution outputs
- most report payloads generated on demand
- worker-local Monte Carlo results
- frontend chart arrays and view-model transforms

## 8. Source-Of-Truth Rules

- SQLite is the canonical persistent source of truth for mutable app state.
- `stock_targets.json` is a seed/import-export artifact, not the primary mutable store after initialization.
- `dataset_metadata` records local coordination facts, not user-facing business objects.
- Snapshot history is canonical in `corporate_comparison_snapshots_v3`.
- Frontend state and worker memory are transient unless explicitly persisted through backend APIs.

## 9. Practical Review Checklist

When storage behavior changes, review these questions:

- Did canonical ownership move between SQLite, file artifacts, and transient state?
- Did a route begin mutating a table that was previously read-only?
- Did retention, cadence, or versioning behavior change for snapshots?
- Did watchlist bootstrap or sync semantics change?
- Did a new runtime cache/log/discovery file become important to system behavior?
