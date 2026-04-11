# Corporate Target Metrics And Safe Sync Todo

Purpose: track the implemented work for target-stock comparison and safe watchlist sync, identify the current follow-up work, and define the next execution slice.

Status snapshot: as of 2026-04-11, the core comparison, safe sync, allocation editing, shared-types alignment, Phase 2 snapshot policy alignment, hardened shared e2e startup path, expanded-universe comparison, Portfolio snapshot surfacing, broader deterministic e2e coverage, CAPM-reference comparison enrichment, and intraday snapshot versioning are complete. The remaining work is now centered on stricter Watchlist-vs-Portfolio boundary enforcement and ongoing product-choice cleanup.

Selected product direction from `guideline/suggestion.md`:
- comparison: persisted snapshots by default plus live calculation option
- portfolio weights: partial weights with implied cash
- watchlist and portfolio should continue separating tracking concerns from investment-testing concerns
- target snapshot policy: auto-generate daily at `00:00 KST`, keep manual refresh, and retain about `1 year` of history by default
- comparison universe: expand beyond current watchlist holdings
- deterministic e2e mocking: extend beyond current high-churn pages toward all major pages
- Portfolio page: surface the latest comparison snapshot directly on the page

## Done

## Current Behavior

## Current Processing

- [x] Review whether destructive `Import JSON` should remain user-visible as-is or require stronger warning/copy.
- [x] Mirror the comparison and sync-status contracts into `packages/shared-types`.
- [x] Decide whether target-stock comparison should continue to compute values on read or begin persisting snapshots for audit/history.
- [x] Decide whether saved watchlist weights should be auto-normalized on write or left as partial weights with implied cash.
- [x] Review whether the current DCF-implied expected return method is sufficient or whether a separate CAPM-style expected return should be added alongside it.
- [x] Decide whether comparison snapshots should remain one-per-day replaceable rows or evolve into multiple intraday versions.
- [ ] Tighten the product boundary recommended in `guideline/suggestion.md`:
  Watchlist = tracking/lightweight comparison
  Portfolio = weighted testing + cash + snapshots + history
- [x] Rechecked `guideline/suggestion.md` and confirmed the selected direction is:
  expand comparison universe beyond watchlist-only
  extend deterministic e2e mocking to all major pages over time
  surface latest snapshot summary directly on the Portfolio page

## Next

- [x] Surface the latest comparison snapshot directly on the Portfolio page:
  top summary card
  live-mode switch
  save-current-as-snapshot action
- [x] Add Portfolio-page entry points from the latest snapshot summary for the currently implemented slice:
  open full comparison view
  snapshot timeline/history remains Phase 3
- [x] Phase 3: add snapshot timeline/history UI for backtesting and indicator validation.
- [x] Phase 3: expose snapshot history specifically in Portfolio-oriented UI, consistent with the Watchlist-vs-Portfolio split recommended in `guideline/suggestion.md`.
- [x] Expand deterministic e2e mocking beyond portfolio/corporate:
  Dashboard
  History / Snapshot timeline
  Watchlist surface via the existing `/portfolio` holdings workflow
- [x] Add shared page fixtures for broader deterministic e2e coverage:
  snapshot fixture
  partial-weight portfolio fixture
  benchmark-universe fixture
- [x] Add CAPM-style reference return alongside the existing DCF-implied expected return in the comparison payload and UI.
- [x] Preserve multiple intraday snapshot versions for the same KST business date while keeping latest-version reads as the default behavior.

## Risks To Watch

- [ ] `Import JSON` still overwrites the DB watchlist intentionally; this is not the safe path.
- [x] Comparison rows are now persisted into daily snapshot rows and can still be recomputed live on demand.
- [x] Snapshot cadence/retention are now aligned to the selected `00:00 KST` and `1 year` policy.
- [x] Snapshot creation now has a startup/background daily job path in addition to manual refresh.
- [x] Comparison now exposes DCF-implied stock return as the primary spread method plus CAPM-style reference return in the same payload.
- [x] Comparison payloads now surface snapshot-based portfolio history through the new multi-day timeline flow.
- [x] Comparison payloads now surface portfolio snapshot history through the new comparison-history timeline flow.
- [x] Portfolio now surfaces an always-visible latest snapshot summary card with snapshot/live switching and manual save-current-as-snapshot action.
- [x] Portfolio now includes an actual snapshot timeline/history UI behind the summary card entry point.
- [x] Comparison snapshots now keep multiple same-day intraday versions instead of overwriting the prior save.
- [ ] Watchlist vs Portfolio separation is improved, but the stricter split is not fully enforced yet.
- [x] New comparison payload is now mirrored in `packages/shared-types`.
- [ ] Deterministic e2e mocks reduce backend timing risk, but they also mean those targeted specs are not end-to-end integration coverage of live backend behavior.
- [x] Deterministic e2e coverage is broader and more stable now for the currently implemented major surfaces:
  dashboard
  portfolio watchlist workflow
  portfolio snapshot history
  corporate comparison

## Last Verification

- [x] `pytest tests/core_finance/test_expected_return.py tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py`
- [x] `python scripts/export_schema.py`
- [x] `pytest tests/api/test_portfolio_attribution.py tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py tests/core_finance/test_expected_return.py`
- [x] `pytest tests/api/test_corporate_comparison.py tests/api/test_watchlist_resync.py tests/core_finance/test_expected_return.py`
- [x] `npm.cmd run lint -- app/portfolio/page.tsx app/corporate/page.tsx components/providers/AppProvider.tsx tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts`
- [x] `pytest tests/api/test_corporate_comparison.py`
- [x] `python scripts/export_schema.py`
- [x] `npm.cmd run lint -- app/corporate/page.tsx app/portfolio/page.tsx tests/e2e/helpers/mockApi.ts tests/e2e/fixtures/shared.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/market-overview.spec.ts tests/e2e/portfolio-snapshot-history.spec.ts`
