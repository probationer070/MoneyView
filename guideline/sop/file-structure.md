# File Structure SOP

Purpose: define the canonical MoneyView repository structure and keep code ownership clear.

## Current Canonical Structure

```text
project-root/
  apps/
    api/                    # FastAPI backend: routes, services, schemas, middleware
    web/                    # Next.js frontend: pages, components, hooks, API client
  packages/
    core_finance/           # Reusable Python finance primitives
    shared-types/           # Shared TypeScript contracts generated or mirrored from API schemas
    simulation-rs/          # Future Rust/PyO3 modules for measured bottlenecks
  data/
    raw/                    # Raw vendor/API extracts, git-ignored
    processed/              # SQLite/DuckDB/parquet processed data, git-ignored
    cache/                  # Runtime cache and local coordination files, git-ignored
  config/
    .env.example            # Safe template only
    .env                    # Local secrets, git-ignored
  guideline/                # Project SOPs and agent guidance
  docs/
    architecture/           # Feature architecture notes
  scripts/                  # ETL, migration, and maintenance scripts
  tests/
    api/                    # API/service tests
    core_finance/           # Finance primitive tests
  README.md
  pyproject.toml
```

## Ownership Rules

- `apps/api/routes`: HTTP concerns only. Keep handlers thin.
- `apps/api/services`: API-specific orchestration, cache behavior, report generation, data access.
- `apps/api/models`: Pydantic request/response schemas.
- `apps/api/core`: middleware, logging, and backend-local math helpers. Prefer `packages/core_finance` for reusable finance formulas.
- `apps/web`: interaction, rendering, chart adapters, mutation controls, and export UI. No core financial formulas.
- `apps/web/app/portfolio/page.tsx`: Portfolio screen composition, local UI state, and React Query invalidation/refetch wiring for holdings and attribution.
- `packages/core_finance`: reusable finance calculations with focused tests.
- `packages/shared-types`: TypeScript contracts that mirror public API payloads.

## Hard Rules

- Never commit secrets. Use `config/.env.example` as the committed template and keep `config/.env` ignored.
- Do not use absolute local paths in source code.
- Data paths must come from environment variables or safe relative defaults.
- Update `docs/architecture/` for substantial architecture changes.
- Update `packages/shared-types` when frontend-consumed API schemas change.
- Keep endpoint-trigger buttons and similar UI refresh controls near the page-level query ownership instead of burying them in presentational chart components.
- Heavy simulations or time-series regressions should remain vectorized Python until profiling proves Rust is needed.
