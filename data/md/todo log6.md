# Corporate Target Metrics And Safe Sync Todo

Purpose: track the implemented work for target-stock comparison and safe watchlist sync, identify the current follow-up work, and define the next execution slice.

Status snapshot: as of 2026-04-11, the core infrastructure for snapshots, partial weights, and broader E2E mocking is complete. The next phase focuses on the expanded universe UI, specific benchmark integrations, and stricter E2E mocking enforcement as recommended in `guideline/suggestion.md`.

Selected product direction from `guideline/suggestion.md`:
- comparison: persisted snapshots by default plus live calculation option
- portfolio weights: partial weights with implied cash
- watchlist and portfolio should continue separating tracking concerns from investment-testing concerns
- target snapshot policy: auto-generate daily at `00:00 KST`, keep manual refresh, and retain about `1 year` of history by default
- comparison universe: expand beyond current watchlist holdings
- deterministic e2e mocking: extend beyond current high-churn pages toward all major pages
- Portfolio page: surface the latest comparison snapshot directly on the page

## Done

- [x] Mirror the comparison and sync-status contracts into `packages/shared-types`.
- [x] Implement persisted snapshots by default with live calculation option.
- [x] Implement partial weights with implied cash for portfolio testing.
- [x] Surface the latest comparison snapshot directly on the Portfolio page (summary card, live-mode switch, manual save).
- [x] Add Portfolio-page entry points (full comparison view, snapshot history timeline).
- [x] Add snapshot timeline/history UI for backtesting and indicator validation.
- [x] Expand deterministic e2e mocking coverage (Dashboard, History, Watchlist).
- [x] Add shared page fixtures (snapshot, partial-weight, benchmark-universe).
- [x] Add CAPM-style reference return alongside DCF-implied return.
- [x] Support multiple intraday snapshot versions for the same business date.
- [x] Snapshot cadence: `00:00 KST` daily job + 1 year retention policy.
- [x] Review and warning for destructive `Import JSON` functionality.

## Current Processing

- [ ] Tighten the product boundary recommended in `guideline/suggestion.md`:
  Watchlist = tracking/lightweight comparison
  Portfolio = weighted testing + cash + snapshots + history
- [ ] Universe selector UI (dropdown/toggle) for Portfolio and Watchlist views.
- [ ] Implement default benchmarks for Korean users (KOSPI + KOSDAQ + 3–4 sector ETFs).

## Next

- [ ] Database: Add `comparison_universe` field to daily snapshots for historical reproducibility.
- [ ] E2E: Create per-page mock files (e.g., `portfolio_page.mock.ts`, `watchlist_page.mock.ts`) for clean isolation.
- [ ] E2E: Enforce `cy.useDeterministicMock()` custom command across all major page tests.
- [ ] Performance: serve latest snapshot via Redis or indexed DB view (target <1s load).

## Risks To Watch

- [ ] `Import JSON` still overwrites the DB watchlist intentionally; this is not the safe path.
- [ ] Watchlist vs Portfolio separation is improved, but the stricter split is not fully enforced yet.
- [ ] Deterministic e2e mocks reduce backend timing risk but sacrifice live integration coverage in those specific specs.

## Last Verification

- [x] `pytest tests/core_finance/test_expected_return.py tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py`
- [x] `python scripts/export_schema.py`
- [x] `npm.cmd run lint -- app/portfolio/page.tsx app/corporate/page.tsx tests/e2e/helpers/mockApi.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/market-overview.spec.ts tests/e2e/portfolio-snapshot-history.spec.ts`
