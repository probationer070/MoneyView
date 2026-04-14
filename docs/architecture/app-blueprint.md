# MoneyView Application Blueprint

This document is the current handoff blueprint for future AI sessions and human contributors. It describes the implemented system, the intended target architecture, and the next update schedule.

The project priority is local-first development. SQLite, FastAPI, Next.js, and Python/NumPy are the current baseline. Docker, PostgreSQL/TimescaleDB, Redis, WebSockets, and Rust acceleration remain future options unless explicitly requested or justified by measured performance data.

## 1. Technology Stack

### Current Implemented Stack

| Layer | Technology | Status | Purpose |
| --- | --- | --- | --- |
| Frontend | Next.js App Router, React, TypeScript | Active | Dashboard UI, SSR routes, chart/table rendering |
| Visualization | Recharts, lightweight-charts, minimal custom SVG/CSS | Active | Financial charts with simple local-first rendering |
| Backend API | FastAPI | Active | REST API, orchestration, financial calculations |
| Analytics | Python, NumPy, local finance modules | Active | Attribution, risk, DCF, diagnostics, benchmarks |
| Database | SQLite | Active | Local canonical database for development and desktop workflows |
| Cache | Local memory/runtime files under `data/cache` | Active | Local runtime state, benchmark scratch files, port discovery |
| Schema contracts | Pydantic -> generated TypeScript | Active | Backend source of truth and frontend type synchronization |
| Local executor | PowerShell launcher | Active | Starts backend and frontend locally on Windows |

### Target / Optional Future Stack

| Layer | Technology | Trigger |
| --- | --- | --- |
| Rust core | PyO3 or WASM | Only after Python/NumPy benchmarks show a real bottleneck |
| PostgreSQL + TimescaleDB | Server database | Only when SQLite fails measured local/concurrency requirements |
| Redis | Real-time cache | Only when live streaming or multi-client cache pressure requires it |
| WebSocket | Live quote transport | Only after REST polling is insufficient |
| Docker | Deployment packaging | Later, after local runtime is stable |
| Desktop shell | Tauri, Electron, or PyInstaller-based launcher | Packaging feasibility phase |

## 2. Architecture

### Current Local-First Architecture

```text
Browser / Local Desktop Shell Candidate
        |
        v
apps/web Next.js App Router
        |
        | REST, generated TypeScript contracts
        v
apps/api FastAPI
        |
        | Pydantic domain schemas
        v
Python services and NumPy analytics
        |
        v
SQLite: data/processed/moneyview.db
        |
        v
Local data files: data/raw, data/cache
```

Key architecture rules:

- Pydantic models are the schema source of truth.
- TypeScript contracts in `packages/shared-types/generated` are generated artifacts.
- Frontend charts consume frontend adapters, not backend chart-specific payloads.
- Financial formulas belong in backend services or `packages/core_finance`, not in `apps/web`.
- SQLite is the default local database until benchmarks prove otherwise.
- Rust is not the default path. Benchmark Python/NumPy first.

### Current Important Directories

```text
apps/
  api/
    main.py
    routes/
    models/
    services/
      portfolio/
  web/
    app/
    components/
    lib/
packages/
  core_finance/
  shared-types/
    generated/
scripts/
  export_schema.py
  validate_sqlite_schema.py
  reconstruct_sqlite_db.py
  ingest_dry_run.py
  benchmark_sqlite.py
  benchmark_finance.py
  start_local.ps1
docs/
  architecture/
data/
  raw/
  processed/
  cache/
config/
  .env.example
```

## 3. Data Flow

### Local Data Flow

```text
External APIs / local CSV / JSON
        |
        v
data/raw
        |
        v
scripts/ingest_dry_run.py
        |
        | validates canonical schemas without DB writes
        v
scripts/reconstruct_sqlite_db.py --apply
        |
        v
data/processed/moneyview.db
        |
        v
FastAPI route -> service -> Pydantic response
        |
        v
Generated TS contracts + frontend adapters
        |
        v
Graph view / table view / report export
```

### Canonical Local Data Schemas

General macro/economic data:

```text
category, name, code, value, unit, date, source, cycle, description
```

Financial asset data:

```text
Date, Open, High, Low, Close, Volume, Dividends, Stock Splits
```

Current validation commands:

```powershell
python scripts/validate_sqlite_schema.py
python scripts/validate_sqlite_schema.py --strict
python scripts/ingest_dry_run.py
python scripts/reconstruct_sqlite_db.py
python scripts/reconstruct_sqlite_db.py --apply
```

## 4. Frontend Structure

### Current Structure

```text
apps/web/
  app/
    page.tsx                    # Market/root dashboard entry
    portfolio/page.tsx          # Portfolio command center
    detail/[ticker]/page.tsx    # Stock detail route
    news/page.tsx               # News route
    globals.css                 # Palette and base styling tokens
  components/
    charts/
    providers/
    ui/
      ViewToggle.tsx
      ExportButton.tsx
      Sparkline.tsx
    workbenches/
  lib/
    api.ts
    transformers.ts
```

### Current Frontend Progress

- Local palette tokens are standardized in `apps/web/app/globals.css`.
- `ViewToggle` exists and is implemented in the Portfolio holdings section.
- Portfolio page includes skeleton, empty, and error states.
- API base URL resolution supports dynamic backend port discovery for client and SSR paths.
- Generated shared types are consumed by frontend adapters.
- Full lint, TypeScript, and build were passing after the latest UI normalization pass.

### Frontend Rules For Future Agents

- Reuse CSS palette variables; do not introduce unrelated purple/blue gradient systems.
- Minimize D3. Prefer Recharts or simple SVG/CSS unless D3 is clearly necessary.
- Add Graph/Table toggle incrementally to each section.
- Keep delta convention consistent: red for up, blue for down.
- Keep chart components presentation-focused. Data math belongs in backend/core finance.

## 5. Python Backend Structure

### Current Structure

```text
apps/api/
  main.py
  routes/
    portfolio.py
    report.py
    market.py
    corporate.py
    news.py
    detail.py
  models/
    schemas.py
  schemas/
    portfolio.py
  core/
    maths.py
  services/
    db.py
    portfolio_service.py              # compatibility shim
    portfolio/
      data_provider.py
      attribution_engine.py
      risk_engine.py
      benchmark_service.py
      cache_service.py
      report_renderer.py
      portfolio_service.py            # orchestrator
```

### Current Backend Progress

- Portfolio attribution uses arithmetic Brinson-Fachler with reconciliation checks.
- Portfolio service has been decomposed into focused components.
- Synthetic fallback is fail-closed unless `allow_synthetic_fallback=true`.
- Approximate benchmark proxy is fail-closed unless `allow_benchmark_proxy=true`.
- Current attribution contract supports USD, daily returns, and BOP weights.
- Report renderer escapes HTML values and uses safe CSV generation.
- Schema export script writes generated JSON schema and TypeScript artifacts.

### Backend Rules For Future Agents

- Keep `PortfolioAnalyticsService` as an orchestrator only.
- Do not move report rendering, cache logic, data reads, and finance math back into one large class.
- Add data-quality metadata when using any approximate or fallback behavior.
- Reject unsupported contract modes instead of silently pretending they are implemented.
- Update generated shared types after Pydantic schema changes:

```powershell
python scripts/export_schema.py
```

## 6. Rust Core Engine (Performance Layer)

Rust is part of the target architecture, not the current default implementation path.

### Current Policy

- Use Python/NumPy first.
- Measure performance with `scripts/benchmark_finance.py`.
- Introduce Rust only when benchmarks show a workload is too slow for the local app target.
- Avoid unnecessary Pandas/DataFrame serialization into Rust. Serialization cost can erase Rust gains for medium workloads.

### Candidate Future Rust Modules

```text
rust_core/
  src/
    monte_carlo.rs
    beta_regression.rs
    wacc_optimizer.rs
    dcf_engine.rs
    lib.rs
  Cargo.toml
```

Candidate triggers:

- Monte Carlo paths become too slow for interactive use.
- Regression or optimization workloads exceed accepted local latency thresholds.
- Benchmarks prove Python/NumPy cannot meet the target on representative data.

Current benchmark command:

```powershell
python scripts/benchmark_finance.py
python scripts/benchmark_finance.py --json
```

## 7. Modules

### Corporate Health Dashboard (Tab 1)

Target scope:

- Corporate lifecycle and governance diagnostics.
- Hurdle rate decomposition.
- Bottom-up beta and WACC.
- DCF and valuation.
- Risk analysis, sensitivity, and Monte Carlo.

Current status:

- `apps/web/app/corporate/page.tsx` is the canonical Corporate tab route.
- The page now includes ticker search, manual company add, realtime assumption controls, backend DCF integration, KPI cards, diagnostic graph modules, and a calculation-detail modal.
- Corporate metrics persist through SQLite `corporate_metrics` with API-backed company and metric history endpoints.
- The lower section includes a live target-stock comparison workflow with benchmark and custom-universe controls.

Next updates:

1. Add visible data-quality warnings when statement-derived or generated-default assumptions are in use.
2. Add Graph/Table toggle to the first mature corporate section where the table materially improves reviewability.
3. Keep calculation-detail lineage and CSV exports aligned with backend metric endpoints.
4. Extend comparison and diagnostics only after preserving the current ticker-centric workflow.

### View Toggle System (All Tabs)

Target scope:

- Every major data section supports Graph and Table modes.
- Delta is always visible.
- Red means price/value increased; blue means price/value decreased.

Current status:

- `ViewToggle` exists in `apps/web/components/ui/ViewToggle.tsx`.
- Portfolio holdings use the first Graph/Table pilot.

Next updates:

1. Extend `ViewToggle` to Market Overview.
2. Extend `ViewToggle` to Corporate sections.
3. Add table mode to detail technical/fundamental sections where useful.
4. Keep table and graph data from the same normalized adapter payload.

### Market Overview (Tab 2)

Target scope:

- Index, commodity, crypto, and macro indicator monitoring.
- Graph and table modes.
- News feed filtered by asset/keyword.

Current status:

- Root market dashboard exists.
- SSR backend port discovery has been fixed for the root page.
- Market data is REST-first, not WebSocket-first.

Next updates:

1. Add `ViewToggle` to market indicator cards.
2. Add table view with ticker, current value, absolute change, percent change, and source.
3. Add data-quality labels when values come from stale or fallback data.
4. Keep WebSockets out of scope until polling is measured as insufficient.

### Portfolio View (Tab 3)

Target scope:

- User-defined watchlist/portfolio.
- Sector grouping.
- Graph/table holdings view.
- Portfolio attribution, risk metrics, and report export.

Current status:

- Portfolio command center is the most advanced module.
- React Query fetches watchlist and attribution data.
- Skeleton, empty, and error states are implemented.
- Allocation donut and attribution waterfall exist.
- Export button uses backend report/export path.
- Holdings support Graph/Table toggle.
- Portfolio page now supports add/delete watchlist mutations.
- Portfolio page includes snapshot summary controls, snapshot-history access, watchlist JSON export/import, and allocation editing.
- Portfolio page keeps saved snapshot benchmark/universe context locked during history review and surfaces saved per-stock metric drill-down inside the stock modal.
- Portfolio uses saved positive watchlist weights when present and falls back to an equal-weight basket only when no positive saved weights exist.
- If saved weights sum to less than 100%, the remainder is treated as implied cash in attribution/export flows.
- The SQLite `watchlist` table is the source of truth for holdings.
- Watchlist bootstrap seeds once from `stock_targets.json` when present, otherwise from a built-in default list when the DB is empty.
- Automatic bootstrap must not overwrite user-managed watchlist state after add/delete mutations.
- Comparison controls show visible recalculation feedback while debounced benchmark/custom-ticker changes settle.
- Per-stock comparison outliers are filtered to `N/A` and explained in the snapshot review UI instead of being colored as valid metrics.

Next updates:

1. Add table views for attribution and risk summaries.
2. Improve benchmark input UX for explicit benchmark weights.
3. Add visible data-quality warnings for synthetic/proxy behavior.
4. Add local report preview state separate from interactive dashboard state.

### Watchlist Bootstrap Policy

Current rule:

- The local SQLite `watchlist` table is authoritative.
- Each watchlist row stores `ticker`, `name`, `sector`, `group_name`, and `weight`.
- `apps/api/services/webscrap/stock_targets.json` is optional bootstrap input, not a runtime dependency.
- If both the DB watchlist and JSON seed are absent, the backend seeds a small built-in default watchlist once.
- Once the user mutates the watchlist, bootstrap seeding must not repopulate deleted defaults automatically.
- The current portfolio UI reads saved positive watchlist weights when present.
- If no positive saved weights exist, the UI falls back to equal-weight assumptions.
- If positive saved weights total less than 100%, the remainder is modeled as implied cash.

### Monte Carlo View (Tab 4)

Target scope:

- Browser-local scenario analysis and simulation workflows.
- Shared path simulation reused by risk and distribution analysis.
- Separate valuation uncertainty and correlation-model experiments.

Current status:

- `apps/web/app/monte-carlo/page.tsx` is the canonical Monte Carlo route.
- The page is implemented as a five-tab workflow:
  path simulation
  risk analysis
  return distribution
  corporate valuation
  correlation model
- A shared web worker owns path, valuation, and correlation jobs so the UI remains responsive.
- Path, Risk, and Return Distribution share one simulation result; valuation and correlation run as separate worker jobs.
- The current Monte Carlo implementation is frontend-compute-first and does not depend on a dedicated backend simulation API.

Next updates:

1. Add durable presets and import/export for simulation assumptions when that improves repeatability.
2. Introduce backend or Rust acceleration only after benchmark evidence shows the current worker engines are insufficient.
3. Keep output schemas stable if future report/export flows consume Monte Carlo results.
4. Add richer validation and explanatory data-quality labels before expanding model complexity.

### Detail Popup (On Click)

Target scope:

- Clicking any chart element or table row opens a full stock detail popup.
- Detail includes OHLCV, technical indicators, fundamentals, Monte Carlo projection, and news.

Current status:

- Detail currently exists primarily as a route: `apps/web/app/detail/[ticker]/page.tsx`.
- This route is better for local/desktop stability than a complex global modal during early development.

Next updates:

1. Decide whether to keep route-first detail UX or wrap it in a modal shell later.
2. Wire portfolio and market table rows to the detail route.
3. Add a consistent click handler contract for chart elements.
4. Only implement true popup behavior when the route-based flow is stable.

## Key Design Principles

### Less Is More + Minard Style

Charts should stay simple, but each mature chart may encode multiple variables through position, size, color, thickness, and direction. Do not add complexity just to imitate a dense institutional dashboard. The first pass should be readable and testable.

### View Toggle

Every major data section should eventually support Graph and Table views. This is being rolled out incrementally, beginning with Portfolio holdings.

### Click-to-Detail

Every meaningful chart element and table row should eventually navigate to or open the detail experience. Route-first detail is acceptable while local runtime and desktop packaging are still being stabilized.

### Performance-First

The target architecture may use Rust for heavy compute, but the current rule is benchmark first. Python/NumPy remains the implementation default until performance evidence says otherwise.

### Real-Time Ready

The target architecture allows WebSockets and Redis. The current architecture is REST-first with local cache. Add real-time infrastructure only after there is a measured need.

### Modular

Tabs, report rendering, portfolio attribution, data validation, and finance calculations should remain independently testable. Avoid large cross-cutting rewrites.

## Local Commands For Future Sessions

Install frontend dependencies from the web app folder:

```powershell
cd apps\web
npm.cmd install
```

Run backend:

```powershell
python -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8000 --reload
```

Run frontend:

```powershell
cd apps\web
npm.cmd run dev
```

Run local launcher:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -CheckOnly
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1
```

Validate:

```powershell
pytest -q
cd apps\web
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
```

## Current Progress Snapshot

- Phase 5 portfolio attribution and report export: implemented and tested.
- Architecture docs and generated shared types: restored.
- Portfolio service decomposition: implemented.
- Synthetic fallback and benchmark proxy controls: implemented.
- Report HTML escaping: implemented.
- Frontend lint/TypeScript/build cleanup: completed in previous pass.
- Dynamic backend port handling: implemented for client and SSR paths.
- Local-first runtime doc: created.
- SQLite schema validation: implemented.
- DB reconstruction and ingestion dry-run scripts: implemented.
- SQLite and finance benchmark scripts: implemented.
- Windows local launcher: implemented.
- UI palette normalization and first ViewToggle pilot: implemented.
- Corporate Analysis route and diagnostics dashboard: implemented.
- Monte Carlo five-tab worker workflow: implemented.

## Next Update Schedule

### Immediate

1. Extend `ViewToggle` to Market Overview.
2. Add visible data-quality warnings to Portfolio when synthetic or benchmark proxy flags are present.
3. Add strict SQLite migration to bring the current DB fully in line with canonical schema, including `dataset_metadata`.
4. Add benchmark threshold documentation for SQLite and finance workloads.

### Short Term

1. Extend `ViewToggle` to Corporate sections.
2. Add route/table click-through to the detail route where it improves market and corporate review flows.
3. Repair or replace any legacy ingestion script that does not match the dry-run/reconstruction policy.
4. Add report preview mode that is clearly separate from interactive dashboard state.

### Medium Term

1. Add local fixtures and explicit quality labels for corporate lifecycle, governance, WACC, and DCF data.
2. Decide whether Corporate sections need table views in addition to the current graph-first layout.
3. Decide desktop packaging path: Tauri, Electron, or PyInstaller/local web build.
4. Build a local executable proof of concept only after launcher and schema workflows remain stable.

### Later / Conditional

1. Add Rust acceleration only after benchmark failure against documented thresholds.
2. Add WebSocket live quotes only after REST polling is insufficient.
3. Add Redis only when local cache is insufficient.
4. Add PostgreSQL/TimescaleDB only when SQLite no longer fits measured needs.
5. Add Docker only after local development and desktop packaging requirements are stable.

## Agent Handoff Rules

- Do not introduce secrets into the repository. Use `config/.env.example` as the committed template.
- Do not treat Docker, PostgreSQL, Redis, WebSocket, or Rust as current requirements.
- Do not edit generated files manually unless the task is explicitly about generation output. Prefer regenerating them.
- Keep documentation and generated types in sync when schemas change.
- Preserve local-first workflows and Windows PowerShell commands.
- Prefer small, testable updates over broad rewrites.
