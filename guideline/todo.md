# Portfolio Comparison Todo

Purpose: track the active follow-up work for the Portfolio comparison surface and keep the next implementation slice clear.

Status snapshot: as of 2026-04-12, the core Portfolio comparison foundation is in place: snapshots, partial weights, sector grouping, benchmark controls, table-first comparison metrics, modal chart upgrades, and E2E coverage. The remaining work is focused on smaller UX and persistence follow-ups from `guideline/suggestion.md`.

Selected product direction from `guideline/suggestion.md`:
- comparison: persisted snapshots by default plus live calculation option
- portfolio weights: partial weights with implied cash
- watchlist and portfolio should continue separating tracking concerns from investment-testing concerns
- target snapshot policy: auto-generate daily at `00:00 KST`, keep manual refresh, and retain about `1 year` of history by default
- comparison universe: expand beyond current watchlist holdings
- deterministic e2e mocking: extend beyond current high-churn pages toward all major pages
- Portfolio page: surface the latest comparison snapshot directly on the page
- Portfolio page focus: stock price volatility and actual investment-testing workflow, with allocation controls demoted to a secondary testing tool
- remove or strongly demote portfolio-level average metrics when they are distorted by extreme outliers
- make table view the core stock-comparison dashboard using persisted per-stock snapshot metrics
- validate extreme per-stock values and replace nonsensical outputs with `N/A` or explicit data warnings

## Active Next

- [ ] Portfolio add flow: evaluate optional `Add to Watchlist only` checkbox without re-coupling portfolio and watchlist ownership.
- [ ] Mobile table behavior: default to the key comparison columns and collapse lower-priority columns on small screens.
- [ ] Snapshot persistence: continue storing benchmark choice in the snapshot payload for historical consistency.
- [ ] Stock modal: evaluate a future `Snapshot History` drill-down for metric trend review.
- [ ] Snapshot-aware modal behavior: verify selected-date rendering path when the page is in snapshot-oriented review mode.
- [ ] Tooltip/help pass: improve benchmark, preset, and methodology clarity across the Portfolio surface.
- [ ] Performance: serve latest snapshot via Redis or indexed DB view (target <1s load) only if measured local indexed DB/SQLite reads are insufficient.

## Completed This Sprint

- [x] Priority 1: remove or demote misleading portfolio-level averages from the snapshot summary
- [x] Priority 2: add per-stock `ROIC - WACC`, `DCF Upside %`, and `Expected Return vs Market` columns to table view
- [x] Priority 3: apply color rules and extreme-value validation to the new comparison metrics
- [x] Priority 4: make table view the primary comparison surface with sticky headers and responsive overflow handling
- [x] Priority 5: add key metric cards inside the stock modal
- [x] Portfolio UI: add `Apply to Snapshot` toggle in the allocation section with default `OFF`.
- [x] Stock modal: add large metric cards for `ROIC - WACC`, `DCF Upside %`, and `Expected Return vs Market`.

## Deferred

- [ ] Leave sparkline or metric-history expansion for a later pass.

## Risks

- [ ] Portfolio/watchlist separation can regress if manual add flows silently write to both stores by default.
- [ ] Benchmark-default changes can invalidate user assumptions if snapshot metadata or preset labels are not explicit.
- [ ] Debounce can improve typing performance but can also make calculations feel stale unless loading feedback is visible.
- [ ] Modal chart enhancements must stay aligned with the current charting stack and avoid introducing unstable chart state.
- [ ] Table-view widening can reduce usability unless sticky headers, overflow behavior, and mobile column priorities are handled together.
- [ ] Per-stock snapshot metrics can still mislead if extreme outliers are colored as valid values instead of being filtered or flagged.
- [ ] Removing averages changes the visual hierarchy of the snapshot summary and may require follow-up copy updates to keep the section understandable.

## Verification

- [x] `npm.cmd run test:e2e -- tests/e2e/market-overview.live.spec.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts tests/e2e/portfolio-snapshot-history.spec.ts tests/e2e/corporate-comparison.spec.ts`
