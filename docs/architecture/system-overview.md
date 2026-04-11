# System Overview

MoneyView is a local-first financial analytics app.

## Runtime Components

- `apps/api`: FastAPI backend for data access, finance calculations, attribution, reporting, and validation.
- `apps/web`: Next.js frontend for interaction, visualization, browser-driven downloads/print, and worker-local simulation flows.
- `packages/core_finance`: reusable Python finance primitives that are not API-specific.
- `packages/shared-types`: generated TypeScript contracts derived from backend Pydantic schemas.
- `data`: local SQLite/data lake/cache storage. Runtime data is not committed.
- `config`: environment templates and local-only secrets.

## Current Phase 5 Flow

```text
watchlist / market DB
  -> PortfolioAnalyticsService orchestrator
  -> DataProvider / BenchmarkService / AttributionEngine / RiskEngine
  -> Pydantic domain response
  -> frontend shared/generated types and chart adapters
  -> Recharts dashboard or report export
```

## Current Screen Ownership

- `Portfolio` is the backend-heavy workflow for watchlist state, saved weights, implied cash, attribution, report export, and persisted comparison snapshots.
- `Corporate Analysis` is the ticker-centric workflow for live assumption tuning, backend DCF requests, diagnostics, and live cross-stock comparison.
- `Simulation Lab` is primarily frontend-compute and worker-driven for path simulation, risk analysis, return distribution, valuation uncertainty, and correlation experiments.

## Watchlist And Comparison Ownership

- SQLite `watchlist` is the canonical mutable store for portfolio holdings and saved allocation weights.
- `stock_targets.json` is a seed/import-export artifact, not the primary mutable allocation store.
- Safe sync is DB to JSON.
- Destructive import is JSON to DB and must remain explicit in the UI.
- Corporate comparison metrics are backend-derived and shared to the frontend through `packages/shared-types`.
- Persisted comparison snapshots live in SQLite `corporate_comparison_snapshots_v3`.
- Snapshot mode is now the default comparison source, while live calculation remains an explicit UI/API option.
- The comparison payload now exposes both a primary DCF-implied expected return and a CAPM-style reference return.
- Snapshot creation cadence is `00:00 KST` semantics with current retention of 365 days.
- Same-day manual refreshes are retained as separate intraday versions; read paths resolve the latest version by default.
- Comparison now supports universe-aware snapshot keys:
  `portfolio_plus_benchmark`
  `watchlist_plus_benchmark`
  `custom`
- Monte Carlo path, valuation, and correlation jobs currently execute in a shared browser worker rather than a dedicated backend simulation API.

## Boundary Rules

- Backend Pydantic models are the source of truth for API contracts.
- Frontend TypeScript types are generated/mirrored from backend schema exports.
- No core financial formulas in `apps/web`.
- Report rendering that must be reproducible belongs behind `apps/api`.
- Frontend chart adapters may reshape domain payloads for Recharts.
- Frontend worker-local simulation logic is acceptable when the workflow is exploratory, browser-contained, and does not require backend persistence.

