# Portfolio Comparison Todo

Purpose: track the active follow-up work for the Portfolio comparison surface and keep the next implementation slice clear.

Status snapshot: as of 2026-04-12, the core Portfolio comparison foundation is in place: snapshots, partial weights, sector grouping, benchmark controls, table-first comparison metrics, modal chart upgrades, and E2E coverage. The remaining work is focused on smaller UX and persistence follow-ups from `guideline/suggestion.md`.

Latest requested follow-up context:
- open two PowerShell windows and display logs for both the API server and Next.js server (`next-server` v`16.2.3`), and make sure those logs are also saved
- persist `Holding Start Date` and `Return End Date`
- display Attribution Effects (`bps`) as percentages
- provide a clearer way to review the list of saved snapshots
- reduce startup friction so the app can be run with one short command instead of the current long Quick Start invocation
- expand Market Overview so it has drill-down detail comparable to the Portfolio page's per-stock detail experience

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

- None currently tracked for Market Overview detail.

## Completed This Sprint

- [x] Priority 1: remove or demote misleading portfolio-level averages from the snapshot summary
- [x] Priority 2: add per-stock `ROIC - WACC`, `DCF Upside %`, and `Expected Return vs Market` columns to table view
- [x] Priority 3: apply color rules and extreme-value validation to the new comparison metrics
- [x] Priority 4: make table view the primary comparison surface with sticky headers and responsive overflow handling
- [x] Priority 5: add key metric cards inside the stock modal
- [x] Portfolio UI: add `Apply to Snapshot` toggle in the allocation section with default `OFF`.
- [x] Stock modal: add large metric cards for `ROIC - WACC`, `DCF Upside %`, and `Expected Return vs Market`.
- [x] Market Overview detail: make market cards and table rows open a shared detail modal from both graph and table views.
- [x] Market Overview detail: keep the root route thin by moving market detail rendering into `apps/web/components/market/MarketOverviewClient.tsx`.
- [x] Market Overview detail: add a frontend detail surface with headline metrics, trend sections, metadata, and interpretation notes.
- [x] Market Overview detail: extend backend payloads with index detail history, daily volume summary, daily indicators, and monthly indicators.
- [x] Market Overview tests: add deterministic mocked coverage for market detail open and close flows in both card and table views.
- [x] Market Overview detail payload: add explicit freshness status and fallback metadata so the modal can distinguish fresh cached data, refreshed live data, and degraded or stale data.
- [x] Market Overview detail payload: expose a true backend `last_updated` timestamp instead of relying only on the latest OHLCV date.
- [x] Market Overview detail model: deepen the index-specific context with breadth, participation, or market-regime signals when those backend inputs become available.
- [x] Market Overview detail model: extend beyond indices so FX, commodity, and crypto detail sections are instrument-aware instead of reusing the current index-first interpretation copy.
- [x] Market Overview detail model: validate whether FX, commodity, and crypto need dedicated indicator sets or whether the current shared technical block is sufficient.
- [x] Market Overview live verification: run the upgraded market detail flow against the real local API and confirm instrument-aware detail behaves correctly outside deterministic mocks.
- [x] Market Overview chart UX: replace the sparkline-only detail charts with fuller OHLCV plus volume charting comparable in depth to the Portfolio stock modal.
- [x] Market Overview verification: confirm the new detail flow works on mobile width and that missing, partial, or stale data degrades to explicit warnings instead of empty fields.
- [x] Market Overview backend tests: add focused service tests for market detail freshness metadata, fallback paths, and instrument metadata shaping.

## Deferred


## Risks

- A wrapper that hides PowerShell execution-policy details may still fail on some Windows setups if it is not implemented as a compatible `.cmd` or npm entry point.
- Duplicating startup logic across multiple launchers will drift quickly; the short command should delegate into one canonical script.
- If dependency installation, auto-port selection, and browser opening are bundled unclearly, the short command may become convenient but less predictable for debugging.
- Market instruments do not all behave like stocks, so a copied Portfolio modal may mislead users unless the copy and fields are instrument-aware.
- If the market detail payload does not carry explicit freshness and fallback metadata, the frontend may show polished detail with weak explanatory value.
- A modal that becomes too dense may hurt the scan-first purpose of Market Overview; summary cards must remain the primary surface.


## Verification

- [x] `npm.cmd run test:e2e -- tests/e2e/market-overview.live.spec.ts`
- [x] `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts tests/e2e/portfolio-snapshot-history.spec.ts tests/e2e/corporate-comparison.spec.ts`
- [x] Run the new short startup command from repo root in a fresh PowerShell session.
- [x] Confirm backend and frontend both start successfully through the wrapper and that the wrapper does not fork startup logic away from `scripts/start_local.ps1`.
- [x] Confirm `README.md` instructions match the actual command surface and fallback guidance.
- [x] `npm.cmd run test:e2e -- tests/e2e/market-overview.spec.ts`
- [x] Add targeted mocked coverage for Market Overview detail open and close flows in both card and table modes.
- [x] Add deterministic mocked coverage for mobile-width market detail rendering and explicit warnings for stale or partial detail payloads.
- [x] `pytest -q tests/api/test_market_index_detail.py`
