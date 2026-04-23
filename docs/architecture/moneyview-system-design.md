# MoneyView System Design

> **Document Scope**
> This document defines the structural and runtime design of MoneyView as it exists today. Read it alongside the Product Overview, Storage Model, API Reference, Quant Engine, and Data Flow documents for full system understanding.

## 0. System Identity

MoneyView is a local-first analytical system, not a distributed application. It should be understood as:

- a single-node system
- a trusted-local, single-user runtime
- a separated UI, API, and computation architecture
- a localhost HTTP application with local persistence and local cache files

## 1. Runtime Architecture

MoneyView runs on one local machine with two primary long-lived processes:

- a Next.js frontend under `apps/web`
- a FastAPI backend under `apps/api`

The runtime also includes browser-worker execution for selected simulation-heavy UI flows and SQLite/file-based local persistence under `data/`.

### 1.1 Internal Boundaries

**Internal Components**
- Next.js frontend
- FastAPI backend
- `packages/core_finance`
- SQLite database
- local cache and log files
- launcher/runtime scripts

**External Dependencies**
- market-data providers
- news/crawling sources
- the local Python and Node toolchains

**Excluded From The System**
- authentication and authorization services
- cloud persistence
- distributed job orchestration
- WebSocket-based real-time streaming
- multi-user shared backend behavior

### 1.2 Process Model

The standard local launcher path is:

1. `run.cmd` forwards `run MoneyView ...` arguments into `scripts/start_local.ps1`.
2. `scripts/start_local.ps1` selects ports, verifies backend/frontend prerequisites, and writes `data/cache/moneyview_port.json`.
3. The launcher opens a dedicated PowerShell window for the FastAPI server.
4. The launcher opens a dedicated PowerShell window for the Next.js server.
5. The frontend reads the backend port from `data/cache/moneyview_port.json` and uses it for local backend discovery.

### 1.3 Startup Responsibilities

At backend startup, the FastAPI lifespan in `apps/api/main.py` performs these responsibilities:

- initialize the SQLite schema with additive compatibility migrations
- start a periodic WAL checkpoint task
- start a corporate comparison snapshot task that ensures the KST-daily snapshot at startup and again at each KST midnight boundary
- start a stock prewarm task for configured tickers

These startup tasks are runtime support tasks, not a distributed scheduler. If the backend process stops, these tasks stop with it.

### 1.4 Shutdown Responsibilities

At backend shutdown, the app cancels its background tasks and attempts a final `PRAGMA wal_checkpoint(TRUNCATE)` on the SQLite database. There is no external supervisor or crash recovery layer.

## 2. Communication Model

### 2.1 Frontend To Backend

- Communication happens over HTTP on localhost.
- The frontend does not access SQLite directly.
- Backend port discovery for SSR/local runtime is file-based through `data/cache/moneyview_port.json`.

### 2.2 Launcher To Frontend Coordination

The launcher writes a JSON payload into `data/cache/moneyview_port.json` that includes:

- backend port
- host
- base API URL
- generation timestamp
- generated-by marker
- log file paths for the API and Next.js processes

The frontend server-side helper under `apps/web/lib/server/backendPort.ts` reads this file and falls back to port `8000` if discovery fails.

### 2.3 In-Process Background Work

The backend uses in-process background loops for:

- periodic WAL truncation
- KST-daily corporate comparison snapshot materialization
- startup stock prewarm scheduling

This is intentionally lightweight local runtime behavior, not a durable queueing system.

## 3. Data Ownership And Persistence Boundaries

### 3.1 Canonical Persistent State

Canonical local state is primarily stored in SQLite at `data/processed/moneyview.db` unless `DB_PATH` overrides the default location.

Important canonical persistent areas include:

- watchlist membership and saved weights
- corporate metrics overrides
- manually added corporate companies
- portfolio workspace preferences
- corporate comparison snapshots
- dataset freshness/sync metadata
- ingested market, index, indicator, and news tables

### 3.2 File-Based Runtime State

File-based runtime state exists for coordination, cache, and logs:

- `data/cache/moneyview_port.json` for backend discovery
- `data/cache/logs/api-server.log`
- `data/cache/logs/next-server.log`
- local cache artifacts under `data/cache/`
- optional raw/processed data artifacts under `data/raw/` and `data/processed/`

### 3.3 Seed And Import-Export Artifacts

`apps/api/services/webscrap/stock_targets.json` is not the canonical mutable store once the app is in use. It serves as:

- a first-run bootstrap source
- an explicit import source for destructive watchlist replacement
- an explicit export target for DB-to-JSON sync

The authoritative mutable watchlist remains SQLite.

### 3.4 Transient Data

The following are computed on demand rather than treated as canonical persisted state:

- DCF request outputs
- portfolio attribution results
- risk metrics returned per request
- most Monte Carlo outputs
- transient frontend-derived chart arrays

## 4. Frontend Design

The frontend is the presentation and interaction layer.

### 4.1 Responsibilities

- page composition and interaction workflows
- chart and table rendering
- cache invalidation and UI loading/error/empty state handling
- browser-worker orchestration for exploratory simulation flows
- report download and print-trigger interactions

### 4.2 Constraints

- no direct database access
- no canonical financial methodology ownership
- no reliance on shared memory with the backend

### 4.3 Frontend Compute Exception

The Simulation Lab uses browser workers for responsiveness. Those worker paths are allowed because they are exploratory, browser-contained flows. They do not replace the backend/Python ownership of canonical finance methodology.

## 5. Backend Design

The backend is the orchestration and local runtime boundary.

### 5.1 Route Layer

`apps/api/routes` owns:

- request parsing
- validation entry points
- response shaping
- status-code behavior
- streaming transport for selected endpoints

### 5.2 Service Layer

`apps/api/services` owns:

- SQLite interaction
- cache and sync behavior
- provider access
- report rendering
- orchestration between persistence and finance calculations

### 5.3 Execution Model

- CPU-bound calculations generally execute synchronously inside the local backend process.
- I/O-bound operations may be handled asynchronously.
- Long-lived heavy-job infrastructure such as an external queue is intentionally absent.

## 6. Reliability, Security, And Scale Limits

### 6.1 Trusted-Local Security Model

MoneyView assumes a trusted local environment:

- no authentication
- no authorization
- no hardened public-network deployment model
- no malicious-local-user protection boundary

It should not be treated as a production-grade public API.

### 6.2 Failure Modes

- External provider failure degrades or fails the specific request.
- Backend failure causes frontend requests to fail until the process is restarted.
- Frontend failure leaves the UI unusable until refreshed or restarted.
- Process crashes require manual restart.
- Background runtime tasks stop when the owning process stops.

### 6.3 Reliability Characteristics

MoneyView currently does not provide:

- retry/backoff infrastructure
- a persistent background job queue
- distributed scheduling
- crash-state replay
- transactional consistency across multiple endpoints
- real-time push transport

### 6.4 Scale Boundaries

MoneyView is designed for:

- single-user local analysis
- moderate local datasets
- interactive but bounded heavy-compute workflows

It is not designed for:

- concurrent multi-user access
- horizontal scaling
- high-frequency real-time ingestion
- cloud-native deployment behavior

## 7. Runtime Rules

- All frontend-backend communication must pass through API boundaries.
- Backend Pydantic models remain the source of truth for public contracts.
- Canonical financial logic must not live in `apps/web`.
- SQLite is the default local persistent store until measured requirements justify something else.
- Browser-worker simulations remain acceptable only for exploratory, non-persisted flows.

## 8. Terminology

- **Module:** A feature-level system such as Portfolio, Corporate Analysis, or Simulation Lab.
- **Engine:** The core computation layer in `packages/core_finance`.
- **Service:** A backend orchestration unit coordinating persistence, providers, and calculations.
- **Adapter:** A frontend transformation layer that reshapes domain payloads for visualization.
- **Bootstrap:** First-time seeding behavior used only when local canonical state is empty.
