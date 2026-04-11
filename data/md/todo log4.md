# Corporate Target Metrics And Safe Sync Todo

Purpose: track the implemented work for target-stock comparison and safe watchlist sync, identify the current follow-up work, and define the next execution slice.

Status snapshot: as of 2026-04-11, the core comparison, safe sync, allocation editing, shared-types alignment, Phase 2 snapshot policy alignment, hardened shared e2e startup path, and the first expanded-universe comparison slice are complete. After re-checking `guideline/suggestion.md`, the next work is now centered on Portfolio snapshot surfacing, broader deterministic e2e coverage, and deeper Watchlist-vs-Portfolio product separation.

Selected product direction from `guideline/suggestion.md`:
- comparison: persisted snapshots by default plus live calculation option
- portfolio weights: partial weights with implied cash
- watchlist and portfolio should continue separating tracking concerns from investment-testing concerns
- target snapshot policy: auto-generate daily at `00:00 KST`, keep manual refresh, and retain about `1 year` of history by default
- comparison universe: expand beyond current watchlist holdings
- deterministic e2e mocking: extend beyond current high-churn pages toward all major pages
- Portfolio page: surface the latest comparison snapshot directly on the page

## Done

- [x] Snapshot cadence semantics now use `00:00 KST` business-date boundaries.
- [x] Snapshot retention now uses `365 days` to align with the selected `1 year` policy.
- [x] Backend startup/background snapshot generation now exists in addition to manual refresh and lazy-on-read fallback.
- [x] Shared Playwright startup is now hardened for portfolio/corporate e2e flows:
  dedicated frontend/backend e2e ports
  direct backend interpreter startup
  stale frontend listener cleanup
  non-blocking API startup background work
- [x] Targeted portfolio/corporate Playwright suite now passes under the hardened shared config.
- [x] Corporate comparison now supports expanded universes:
  default `Portfolio + Benchmark`
  optional `Watchlist + Benchmark`
  optional custom universe input
- [x] Persisted comparison snapshots now store universe metadata for reproducible historical comparisons.

## Current Behavior

- [x] Corporate comparison snapshot mode is the default comparison source.
- [x] Snapshot metadata now reports cadence as `daily_kst_0000`.
- [x] Snapshot retention now reports `365` days.
- [x] Background snapshot generation runs at startup and then sleeps until the next KST midnight boundary.
- [x] Portfolio/corporate targeted e2e coverage now shares the same stable Playwright startup config.
- [x] Corporate comparison defaults to `Portfolio + Benchmark`, where Portfolio means saved positive-weight holdings and falls back to equal-weight watchlist holdings only when no positive weights exist.
- [x] Watchlist comparison mode includes zero-weight tracked names, while custom mode supports manual ticker sets plus a selected benchmark.
- [x] Snapshot metadata now exposes `comparison_universe`, `benchmark_ticker`, and `custom_tickers`.

## Current Processing

- [x] Review whether destructive `Import JSON` should remain user-visible as-is or require stronger warning/copy.
- [x] Mirror the comparison and sync-status contracts into `packages/shared-types`.
- [x] Decide whether target-stock comparison should continue to compute values on read or begin persisting snapshots for audit/history.
- [x] Decide whether saved watchlist weights should be auto-normalized on write or left as partial weights with implied cash.
- [ ] Review whether the current DCF-implied expected return method is sufficient or whether a separate CAPM-style expected return should be added alongside it.
- [ ] Decide whether comparison snapshots should remain one-per-day replaceable rows or evolve into multiple intraday versions.
- [ ] Tighten the product boundary recommended in `guideline/suggestion.md`:
  Watchlist = tracking/lightweight comparison
  Portfolio = weighted testing + cash + snapshots + history
- [x] Rechecked `guideline/suggestion.md` and confirmed the selected direction is:
  expand comparison universe beyond watchlist-only
  extend deterministic e2e mocking to all major pages over time
  surface latest snapshot summary directly on the Portfolio page

## Next

- [ ] Surface the latest comparison snapshot directly on the Portfolio page:
  top summary card
  live-mode switch
  save-current-as-snapshot action
- [ ] Add Portfolio-page entry points from the latest snapshot summary:
  open snapshot timeline/history
  open full comparison view
- [ ] Phase 3: add snapshot timeline/history UI for backtesting and indicator validation.
- [ ] Phase 3: expose snapshot history specifically in Portfolio-oriented UI, consistent with the Watchlist-vs-Portfolio split recommended in `guideline/suggestion.md`.
- [ ] Expand deterministic e2e mocking beyond portfolio/corporate:
  Dashboard
  History / Snapshot timeline
  Watchlist page
- [ ] Add shared page fixtures for broader deterministic e2e coverage:
  snapshot fixture
  partial-weight portfolio fixture
  benchmark-universe fixture

## Risks To Watch

- [ ] `Import JSON` still overwrites the DB watchlist intentionally; this is not the safe path.
- [x] Comparison rows are now persisted into daily snapshot rows and can still be recomputed live on demand.
- [x] Snapshot cadence/retention are now aligned to the selected `00:00 KST` and `1 year` policy.
- [x] Snapshot creation now has a startup/background daily job path in addition to manual refresh.
- [ ] The current stock expected return method is explicitly DCF-implied upside, not CAPM expected return.
- [ ] Comparison payloads still do not surface snapshot-based portfolio history or multi-day timeline UX.
- [ ] Portfolio still lacks the suggested always-visible latest snapshot summary card.
- [ ] Watchlist vs Portfolio separation is improved, but the stricter split is not fully enforced yet.
- [x] New comparison payload is now mirrored in `packages/shared-types`.
- [ ] Deterministic e2e mocks reduce backend timing risk, but they also mean those targeted specs are not end-to-end integration coverage of live backend behavior.
- [ ] Deterministic e2e coverage is broader and more stable now, but it has not yet been extended to all major pages recommended in `guideline/suggestion.md`.

## Last Verification

- [x] `pytest tests/core_finance/test_expected_return.py tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py`
- [x] `python scripts/export_schema.py`
- [x] `pytest tests/api/test_portfolio_attribution.py tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py tests/core_finance/test_expected_return.py`
- [x] `pytest tests/api/test_corporate_comparison.py tests/api/test_watchlist_resync.py tests/core_finance/test_expected_return.py`
- [x] `npm.cmd run lint -- app/portfolio/page.tsx app/corporate/page.tsx components/providers/AppProvider.tsx tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts`
- [x] `npm.cmd run lint -- app/corporate/page.tsx tests/e2e/corporate-comparison.spec.ts tests/e2e/helpers/mockApi.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/corporate-comparison.spec.ts`
- [x] `npm.cmd run lint -- playwright.config.ts tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts tests/e2e/helpers/mockApi.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/corporate-comparison.spec.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts`
- [x] Architecture docs updated:
  `docs/architecture/data-flow.md`
  `docs/architecture/system-overview.md`
