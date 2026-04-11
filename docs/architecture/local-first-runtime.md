# Local-First Runtime Architecture

## Purpose

MoneyView is developed and validated as a local-first financial analytics app before any Docker, cloud database, Redis, or production deployment work.

The local runtime must support:

- repeatable backend and frontend startup
- SQLite-backed data storage
- local data ingestion and validation
- local report generation
- local performance testing
- a future Windows desktop packaging path

This document defines the practical architecture for that workflow.

## Priority Order

1. Run and test everything locally.
2. Validate SQLite against real MoneyView workloads.
3. Keep data retrieval flexible and reproducible.
4. Use Python/NumPy first for analytics performance.
5. Keep visualization simple and minimal.
6. Consider `.exe` packaging before Docker deployment.
7. Treat Docker, PostgreSQL/TimescaleDB, Redis, WebSockets, and Rust as future upgrades only after measured need.

## Current Local Runtime

```text
apps/web Next.js UI
  -> FastAPI REST API
  -> apps/api services
  -> packages/core_finance Python/NumPy primitives
  -> SQLite database at data/processed/moneyview.db
  -> local runtime cache files under data/cache
```

Runtime components:

- `apps/api`: FastAPI backend, service orchestration, schemas, validation, reporting.
- `apps/web`: Next.js frontend, chart rendering, table rendering, browser downloads, and web-worker simulation flows.
- `packages/core_finance`: reusable Python finance calculations.
- `packages/shared-types`: generated TypeScript contracts from backend Pydantic schemas.
- `data/raw`: raw source extracts and downloaded vendor data.
- `data/processed`: normalized local database files such as SQLite.
- `data/cache`: runtime coordination and cache files, including dynamic port information.
- `config`: local environment templates and local-only secrets.

## Local Run Workflow

Backend from project root:

```powershell
python -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend from `apps/web`:

```powershell
npm.cmd install
npm.cmd run dev
```

Or start both local services through the Windows launcher:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1
```

Validate launcher prerequisites without starting services:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -CheckOnly
```

Primary URLs:

- Frontend: `http://localhost:3000`
- Portfolio: `http://localhost:3000/portfolio`
- API docs: `http://127.0.0.1:8000/docs`
- API health: `http://127.0.0.1:8000/api/v1/health`

The frontend supports dynamic backend port discovery through `data/cache/moneyview_port.json`. Server-rendered pages must use the same discovery path rather than assuming port `8000`.

## Local Validation Commands

Run backend tests:

```powershell
pytest -q
```

Run frontend lint and typecheck:

```powershell
cd apps\web
npm.cmd run lint
npx.cmd tsc --noEmit
```

Run production build check:

```powershell
cd apps\web
npm.cmd run build
```

Regenerate shared schema artifacts after public Pydantic schema changes:

```powershell
python scripts/export_schema.py
npx json2ts packages/shared-types/generated/portfolio.schema.json > packages/shared-types/generated/portfolio.ts
```

Validate the local SQLite schema:

```powershell
python scripts/validate_sqlite_schema.py
```

Run strict SQLite schema validation when preparing a schema migration:

```powershell
python scripts/validate_sqlite_schema.py --strict
```

Dry-run local ingestion sources without writing SQLite:

```powershell
python scripts/ingest_dry_run.py
```

Preview DB reconstruction without modifying the current DB:

```powershell
python scripts/reconstruct_sqlite_db.py
```

Reconstruct the local DB schema with a timestamped backup:

```powershell
python scripts/reconstruct_sqlite_db.py --apply
```

Benchmark local SQLite read/write workloads:

```powershell
python scripts/benchmark_sqlite.py
```

Benchmark Python/NumPy finance workloads:

```powershell
python scripts/benchmark_finance.py
```

## SQLite Position

SQLite is the default local database for the current phase.

SQLite is acceptable for:

- single-user local development
- historical OHLCV storage
- macro/economic indicator storage
- watchlist data
- portfolio attribution inputs
- report generation
- deterministic regression tests

SQLite should be reconsidered if MoneyView needs:

- multiple concurrent users
- high-frequency tick-level ingestion
- heavy concurrent writes
- cloud-hosted shared dashboards
- multi-process live quote streaming
- long-term operational analytics across very large datasets

Until those needs are measured, PostgreSQL/TimescaleDB is a future option, not a current requirement.

## Canonical Local Data Schemas

### Macro and Economic Data

Use this schema for macroeconomic indicators, non-corporate indices, and general economic series:

```text
category | name | code | value | unit | date | source | cycle | description
```

Rules:

- `date` must be normalized to a parseable date string.
- `source` must identify the provider or file origin.
- `cycle` should identify frequency where available, such as daily, monthly, quarterly, or annual.
- Missing values must be explicit `NULL`/`None`, not placeholder strings.

### Financial Asset Data

Use this schema for corporate stock prices, crypto assets, commodities, ETFs, and tradable index series:

```text
Date | Open | High | Low | Close | Volume | Dividends | Stock Splits
```

Rules:

- `Date` must be normalized to a parseable date string.
- `Open`, `High`, `Low`, and `Close` must be numeric.
- `Volume` must be numeric and non-negative where provided.
- `Dividends` and `Stock Splits` must default to `0.0` when absent.
- Corporate actions must be retained so total-return logic can be audited.

## Data Ingestion Policy

Local ingestion should follow this path:

```text
external source
  -> data/raw
  -> validation and normalization
  -> data/processed/moneyview.db
  -> API/service reads
```

Ingestion rules:

- Keep API keys and secrets in `config/.env`.
- Keep `config/.env.example` safe and commit only empty template values.
- Add dry-run modes before mutating SQLite where practical.
- Quarantine malformed rows instead of silently coercing them.
- Prefer deterministic fixtures for tests.
- Record source, frequency, and retrieval date where possible.

## Visualization Policy

The UI should stay simple, clean, and minimal.

Base palette:

```text
#FBFBFB
#E0E4D6
#60CAAD
#444444
#9DA5A2
#B6CCBB
#A7C7AF
```

Rules:

- Minimize D3.js usage.
- Prefer Recharts, lightweight-charts, and simple React components for most visualizations.
- Use D3 only when the chart truly requires custom layout control.
- Keep chart density readable; do not overfit every Minard-style encoding into every chart.
- Provide table views for sections where raw numbers matter.
- Preserve the red-up and blue-down delta convention where price change direction is shown.

## Performance Policy

Use Python/NumPy first.

Reason:

- Passing large Pandas DataFrames across a Python/Rust boundary can add meaningful serialization and deserialization overhead.
- Rust should be introduced only when profiling proves a bottleneck that NumPy cannot handle adequately.

Benchmark before rewriting:

- DCF calculations
- beta regression
- Monte Carlo simulations
- Brinson-Fachler attribution
- historical VaR and expected shortfall
- local SQLite query patterns

Current implementation note:

- Portfolio attribution and corporate comparison are backend/API-driven.
- Monte Carlo `Simulation Lab` is currently frontend worker-driven and stays local to the browser session unless an export path is used.

Rust/PyO3 or WASM remains a future optimization path, not a default implementation choice.

## Desktop Packaging Path

The realistic packaging path is staged.

### Stage 1: Local Developer Runtime

- Run backend and frontend separately.
- Validate SQLite and local data ingestion.
- Keep tests and lint clean.

### Stage 2: Local Launcher

Use `scripts/start_local.ps1` as the Windows local launcher. It:

- starts FastAPI on an available local port
- writes `data/cache/moneyview_port.json`
- starts or opens the frontend
- checks API health
- prints clear local URLs

### Stage 3: Desktop Shell Feasibility

Evaluate packaging options:

- Tauri shell around the local web UI
- Electron shell around the local web UI
- PyInstaller for backend plus static frontend assets
- simple `.bat`/PowerShell launcher as an interim executable-like workflow

### Stage 4: Installer or `.exe`

Only after Stage 2 and Stage 3 are stable:

- bundle backend runtime
- bundle frontend build
- include SQLite database bootstrap or migration scripts
- include safe config template
- avoid bundling secrets

## Docker Position

Docker is not the current development target.

Docker may be useful later for:

- reproducible deployment
- CI service orchestration
- PostgreSQL/Redis evaluation
- cloud deployment

Docker should not block local validation, SQLite benchmarking, or desktop packaging feasibility work.

## Next Implementation Tasks

1. Establish benchmark threshold targets for SQLite and finance workloads.
2. Extend Graph/Table toggles from the portfolio pilot to market and corporate sections.
3. Evaluate desktop shell packaging options for the local launcher workflow.

## Non-Goals

- No PostgreSQL/TimescaleDB migration in this phase.
- No Redis requirement in this phase.
- No Docker-first workflow.
- No Rust rewrite without profiling.
- No full `.exe` installer before the local launcher is stable.
- No broad D3-based visual redesign.
