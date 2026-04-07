# System Overview

MoneyView is a local-first financial analytics app.

## Runtime Components

- `apps/api`: FastAPI backend for data access, finance calculations, attribution, reporting, and validation.
- `apps/web`: Next.js frontend for interaction, visualization, and browser-driven downloads/print.
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

## Boundary Rules

- Backend Pydantic models are the source of truth for API contracts.
- Frontend TypeScript types are generated/mirrored from backend schema exports.
- No core financial formulas in `apps/web`.
- Report rendering that must be reproducible belongs behind `apps/api`.
- Frontend chart adapters may reshape domain payloads for Recharts.

