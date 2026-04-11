# Corporate Target Metrics And Safe Sync Todo

Purpose: track the implemented work for target-stock comparison and safe watchlist sync, identify the current follow-up work, and define the next execution slice.

Status snapshot: as of 2026-04-11, the core comparison, safe sync, allocation editing, targeted e2e harness stabilization, shared-types alignment, and the first Phase 2 snapshot foundation are complete. Remaining work is now aligning snapshot policy with `guideline/suggestion.md`, strengthening Watchlist-vs-Portfolio separation, and building history UX.

Selected product direction from `guideline/suggestion.md`:
- comparison: persisted snapshots by default plus live calculation option
- portfolio weights: partial weights with implied cash
- watchlist and portfolio should continue separating tracking concerns from investment-testing concerns
- target snapshot policy from suggestion: auto-generate daily at `00:00 KST`, keep manual refresh, and retain about `1 year` of history by default

## Done

- [x] Confirmed `watchlist` in SQLite is the mutable source of truth for portfolio allocations.
- [x] Confirmed `stock_targets.json` should be treated as seed/import-export state, not the primary mutable weight store.
- [x] Added backend-owned expected return helpers in `packages/core_finance/expected_return.py`.
- [x] Reconfirmed and implemented market expected return as:
  `market_expected_return = risk_free_rate + equity_risk_premium`
- [x] Chose the current stock expected return definition as:
  `stock_expected_return = dcf_implied_upside = dcf_value / current_price - 1`
- [x] Implemented and exposed:
  `expected_return_spread = stock_expected_return - market_expected_return`
- [x] Added comparison response schemas for target-stock cross-section metrics.
- [x] Added backend comparison endpoint for all current target stocks in `apps/api/routes/corporate.py`.
- [x] Comparison response now includes:
  ticker, name, sector, group_name, weight, roic, wacc, roic_minus_wacc, dcf_value, current_price, stock_expected_return, market_expected_return, expected_return_spread.
- [x] Comparison rows now cover the three required metrics:
  `ROIC - WACC`
  `DCF value`
  `Expected stock return vs market expected return`
- [x] Added safe DB-to-JSON sync in `apps/api/services/watchlist_seed.py`.
- [x] Added explicit API sync action in `apps/api/routes/portfolio.py`:
  `POST /api/v1/portfolio/watchlist/sync`
- [x] Kept explicit JSON import/replace path in place:
  `POST /api/v1/portfolio/watchlist/resync`
- [x] Portfolio UI now has separate `Sync JSON` and `Import JSON` actions.
- [x] Portfolio attribution now uses saved watchlist weights when any positive weights exist.
- [x] Portfolio UI now supports editing and saving per-stock allocation weights.
- [x] Corporate UI now shows a comparison table for target stocks with market/stock expected return context.
- [x] Portfolio UI now shows the last explicit sync/import source and timestamp.
- [x] `Import JSON` now has explicit destructive wording and confirmation copy in the UI.
- [x] Corporate comparison now has sort controls for:
  `ROIC - WACC`
  `DCF value`
  `Expected return spread`
- [x] Added backend sync-status endpoint for the portfolio UI.
- [x] Added targeted backend tests for:
  market expected return formula
  DCF-implied return and spread math
  safe DB-to-JSON sync
  corporate comparison endpoint
- [x] Added backend tests for last sync/import status metadata.
- [x] Added frontend Playwright specs for:
  weight editing workflow
  sync/import UI behavior
  corporate comparison rendering/sorting
- [x] Stabilized targeted Playwright coverage for portfolio/corporate pages by mocking page-level API traffic in e2e.
- [x] Verified changed frontend files with targeted lint.

## Current Behavior

- [x] SQLite `watchlist` is the live mutable weight store.
- [x] `Sync JSON` exports current DB-backed holdings and weights into `stock_targets.json`.
- [x] `Import JSON` is still a destructive replace-from-file action for the `watchlist` table.
- [x] Portfolio attribution uses saved weights when present, otherwise falls back to equal weight.
- [x] Corporate comparison uses a backend-derived market expected return and DCF-implied stock return spread.
- [x] Corporate comparison now defaults to a persisted daily snapshot source with explicit live mode available.
- [x] Corporate comparison snapshot metadata now exposes mode, as-of date, generation time, source, cadence, retention, and stale-state flags.
- [x] Current implementation uses a daily snapshot model with manual refresh, but cadence/retention still need final alignment to the `00:00 KST` and `1 year` policy suggested in `guideline/suggestion.md`.

## Current Processing

- [x] Review whether destructive `Import JSON` should remain user-visible as-is or require stronger warning/copy.
- [x] Mirror the comparison and sync-status contracts into `packages/shared-types`.
- [x] Decide whether target-stock comparison should continue to compute values on read or begin persisting snapshots for audit/history.
- [x] Decide whether saved watchlist weights should be auto-normalized on write or left as partial weights with implied cash.
- [ ] Decide whether stock comparison should remain watchlist-driven only or also include `corporate_companies` / `corporate_metrics` rows not currently in watchlist.
- [ ] Review whether the current DCF-implied expected return method is sufficient or whether a separate CAPM-style expected return should be added alongside it.
- [x] Investigate and remove the Playwright timing issue by replacing live page fetch dependence with deterministic request mocking in the targeted specs.
- [ ] Decide whether comparison snapshots should remain one-per-day replaceable rows or evolve into multiple intraday versions.
- [ ] Align snapshot cadence semantics from current `daily_utc` implementation to the recommendation in `guideline/suggestion.md`:
  `00:00 KST` auto-generation
  manual save/refresh still available
- [ ] Align snapshot retention from current `180 days` to the recommendation in `guideline/suggestion.md`:
  default `1 year` retention
  or explicitly choose unlimited retention
- [ ] Tighten the product boundary recommended in `guideline/suggestion.md`:
  Watchlist = tracking/lightweight comparison
  Portfolio = weighted testing + cash + snapshots + history

## Next

- [x] Mirror the new comparison payload in `packages/shared-types` if frontend/backend schema alignment should now be enforced.
- [x] Document the finalized sync/source-of-truth model in `docs/architecture/`.
- [x] Decide whether target-stock comparison should remain computed on read or whether comparison snapshots should be persisted for audit/history.
- [x] Decide whether watchlist weights should auto-normalize on write or remain partial with implied cash.
- [x] Add clearer UI warning/copy for `Import JSON` because it still replaces the DB watchlist.
- [x] Add lightweight sync metadata so the UI can show last sync/import source and timestamp.
- [x] Add ordering/sorting controls to the corporate comparison table for:
  `ROIC - WACC`
  `DCF value`
  `Expected return spread`
- [x] Phase 1: implement partial weights + implied cash as the explicit portfolio model.
- [x] Phase 1: create a clearer Portfolio-vs-Watchlist separation in UI and data ownership.
- [x] Phase 1: show total invested allocation and implied cash in the Portfolio page.
- [x] Phase 1: add optional `auto-normalize to 100%` action without making it the default behavior.
- [x] Phase 1: decide and implement cash treatment in attribution:
  explicit `CASH` row
  return basis of `0%`
- [x] Phase 2: add persisted daily comparison snapshots as the default Portfolio comparison source.
- [x] Phase 2: add manual snapshot save/refresh controls.
- [x] Phase 2: add snapshot-vs-live toggle in the UI.
- [ ] Phase 2 follow-up: switch snapshot cadence semantics from `daily_utc` to explicit `00:00 KST` policy if that remains the chosen product rule.
- [ ] Phase 2 follow-up: switch snapshot retention from `180 days` to `1 year` if that remains the chosen product rule.
- [ ] Phase 2 follow-up: add actual scheduled snapshot generation instead of relying only on lazy-on-read creation plus manual refresh.
- [ ] Phase 3: add snapshot timeline/history UI for backtesting and indicator validation.
- [ ] Phase 3: expose snapshot history specifically in Portfolio-oriented UI, consistent with the Watchlist-vs-Portfolio split recommended in `guideline/suggestion.md`.
- [ ] Decide whether the comparison universe should expand beyond current watchlist holdings.
- [x] Add frontend test coverage for:
  weight editing workflow
  sync/import button behavior
  comparison table rendering
- [x] Add backend regression coverage if `Import JSON` semantics are changed further.
- [ ] Decide whether to expand deterministic e2e mocking to other pages or keep it targeted to high-churn portfolio/corporate flows.
- [ ] Decide whether the Portfolio page should surface the latest comparison snapshot summary directly.

## Risks To Watch

- [ ] `Import JSON` still overwrites the DB watchlist intentionally; this is not the safe path.
- [x] Comparison rows are now persisted into daily snapshot rows and can still be recomputed live on demand.
- [ ] The current snapshot cadence is `daily_utc`, which does not yet match the `00:00 KST` recommendation in `guideline/suggestion.md`.
- [ ] The current snapshot retention is `180 days`, which does not yet match the `1 year` recommendation in `guideline/suggestion.md`.
- [ ] Snapshot creation is currently lazy-on-read plus manual refresh, not a true scheduled daily job yet.
- [ ] The current stock expected return method is explicitly DCF-implied upside, not CAPM expected return.
- [x] Watchlist/portfolio weight policy is now chosen: partial weights with implied cash.
- [x] Portfolio attribution now handles implied cash through an explicit `CASH` row with `0%` return treatment.
- [ ] Comparison payloads still do not surface snapshot-based portfolio history or multi-day timeline UX.
- [ ] Watchlist vs Portfolio separation is improved, but the suggestion’s stricter split is not fully enforced yet.
- [x] New comparison payload is now mirrored in `packages/shared-types`.
- [ ] Deterministic e2e mocks reduce backend timing risk, but they also mean those targeted specs are not end-to-end integration coverage of live backend behavior.

## Last Verification

- [x] `pytest tests/core_finance/test_expected_return.py tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py`
- [x] `python scripts/export_schema.py`
- [x] `pytest tests/api/test_portfolio_attribution.py tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py tests/core_finance/test_expected_return.py`
- [x] `npm.cmd run lint -- app/portfolio/page.tsx app/corporate/page.tsx components/providers/AppProvider.tsx tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts`
- [x] `pytest tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py tests/core_finance/test_expected_return.py`
- [x] `npm.cmd run lint -- app/corporate/page.tsx tests/e2e/corporate-comparison.spec.ts tests/e2e/helpers/mockApi.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/corporate-comparison.spec.ts`
- [x] Architecture docs updated:
  `docs/architecture/data-flow.md`
  `docs/architecture/system-overview.md`
