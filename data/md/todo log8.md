# Corporate Target Metrics And Safe Sync Todo

Purpose: track the implemented work for target-stock comparison and safe watchlist sync, identify the current follow-up work, and define the next execution slice.

Status snapshot: as of 2026-04-12, the core infrastructure for snapshots, partial weights, sector grouping, benchmark controls, modal chart upgrades, and broader E2E mocking is in place. The next phase follows the newer direction in `guideline/suggestion.md`: remove misleading portfolio-level averages and make the table view the core per-stock comparison dashboard.

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

## Done

## Current Processing

- [x] Normalize the Portfolio tab around the clarified product focus:
  Portfolio = stock-price volatility + expected return comparison + actual investment-testing workflow
- [x] Reduce Portfolio UI complexity by demoting secondary controls and improving explainability.

## Next

- [x] Portfolio UI: convert `Portfolio Allocation Model` into an accordion collapsed by default.
- [x] Portfolio UI: keep weights and cash controls inside the accordion and label them as testing-purpose controls.
- [ ] Portfolio UI: add `Apply to Snapshot` toggle in the allocation section with default `OFF`.
- [x] Portfolio add flow: replace implicit watchlist-linked add behavior with explicit manual ticker input and immediate portfolio save.
- [x] Portfolio add flow: show `Already in Watchlist` state when applicable and default new portfolio allocation to `0%`.
- [ ] Portfolio add flow: evaluate optional `Add to Watchlist only` checkbox without re-coupling portfolio and watchlist ownership.
- [x] Snapshot summary: add benchmark label, tooltip, and quick benchmark-change affordance.
- [x] Benchmark policy: change default benchmark preset to `S&P 500` and keep Korea presets as explicit opt-in alternatives.
- [ ] Snapshot summary: remove or strongly demote portfolio-level `Avg Spread`, `Avg ROIC - WACC`, and `Avg DCF` when those values are driven by distorted outliers.
- [ ] Table view: redesign the holdings table into the core stock-comparison dashboard using persisted snapshot metrics.
- [ ] Table view: add per-stock columns for `ROIC - WACC`, `DCF Upside %`, and `Expected Return vs Market`.
- [ ] Table view: preserve current `Ticker`, `Sector`, `Current Price`, `Volatility (1Y)`, and `Allocation %` coverage in the redesigned layout.
- [ ] Table view: apply per-column color rules so positive comparison metrics read as green, negative as red, and neutral as gray.
- [ ] Table view: support sticky headers and horizontal scroll for wide sector tables.
- [ ] Mobile table behavior: default to the key comparison columns and collapse lower-priority columns on small screens.
- [ ] Value quality: add validation so extreme per-stock values such as `>|500%|` render as `N/A` or `Check Data` instead of polluting the UI.
- [ ] Snapshot persistence: continue storing benchmark choice in the snapshot payload for historical consistency.
- [x] Input performance: add `300-500ms` debounce to ticker search and allocation-related typed inputs where recalculation causes lag.
- [x] Input performance: show compact `Calculating` feedback during debounced recomputation.
- [x] Holdings presentation: group watchlist holdings by sector in both graph view and table view.
- [x] Holdings presentation: add sector filtering and an `All Sectors` reset/toggle.
- [x] Table layout: support collapsible sector blocks and keep the first screen readable without excessive scroll.
- [x] Stock modal: add moving averages `5 / 20 / 60 / 120` with clear labels and colors.
- [x] Stock modal: add `Daily / Monthly` timeframe toggle and ensure monthly mode recalculates MA values from monthly data.
- [x] Stock modal: evaluate `Add to Portfolio` and `Remove from Watchlist` actions inside the modal.
- [ ] Stock modal: add large metric cards for `ROIC - WACC`, `DCF Upside %`, and `Expected Return vs Market`.
- [ ] Stock modal: evaluate a future `Snapshot History` drill-down for metric trend review.
- [ ] Snapshot-aware modal behavior: verify selected-date rendering path when the page is in snapshot-oriented review mode.
- [ ] Tooltip/help pass: improve benchmark, preset, and methodology clarity across the Portfolio surface.
- [ ] Performance: serve latest snapshot via Redis or indexed DB view (target <1s load) only if measured local indexed DB/SQLite reads are insufficient.

## This Sprint Priority

- [ ] Priority 1: remove or demote misleading portfolio-level averages from the snapshot summary
- [ ] Priority 2: add per-stock `ROIC - WACC`, `DCF Upside %`, and `Expected Return vs Market` columns to table view
- [ ] Priority 3: apply color rules and extreme-value validation to the new comparison metrics
- [ ] Priority 4: make table view the primary comparison surface with sticky headers and responsive overflow handling
- [ ] Priority 5: add key metric cards inside the stock modal
- [ ] Priority 6: leave sparkline or metric-history expansion for a later pass

## Risks To Watch

- [ ] Portfolio/watchlist separation can regress if manual add flows silently write to both stores by default.
- [ ] Benchmark-default changes can invalidate user assumptions if snapshot metadata or preset labels are not explicit.
- [ ] Debounce can improve typing performance but can also make calculations feel stale unless loading feedback is visible.
- [ ] Sector grouping can improve scanability but may create hidden holdings if filter state is not obvious.
- [ ] Modal chart enhancements must stay aligned with the current charting stack and avoid introducing unstable chart state.
- [ ] Table-view widening can reduce usability unless sticky headers, overflow behavior, and mobile column priorities are handled together.
- [ ] Per-stock snapshot metrics can still mislead if extreme outliers are colored as valid values instead of being filtered or flagged.
- [ ] Removing averages changes the visual hierarchy of the snapshot summary and may require follow-up copy updates to keep the section understandable.

## Last Verification

- [x] `npm.cmd run test:e2e -- tests/e2e/market-overview.live.spec.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts tests/e2e/portfolio-snapshot-history.spec.ts tests/e2e/corporate-comparison.spec.ts`
