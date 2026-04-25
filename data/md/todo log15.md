# Development Todo

Purpose: track the active implementation plan for performance, portfolio UX, valuation streaming, stock-price reliability work, and the frontend design-spec refactor across `apps/web` and `apps/api`.

Status snapshot: as of 2026-04-24, the active frontend track is the design-spec implementation defined under `docs/design/`, with earlier refresh-reliability work largely completed and now in follow-up mode.

## Active Tracks

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses

## Visualization Improvement Plan

Source:
- `guideline/suggestion.md`

Problem:
- The remaining visualization issues are not isolated UI polish gaps. They cut across data auditability, API contract clarity, rendering resilience, and chart-system standardization.
- `guideline/suggestion.md` identifies four concrete problem areas that still need planning-level ownership:
  - ROIC/WACC calculations are not auditable enough in UI surfaces
  - Portfolio table and stock modal metrics still risk showing stale or unexplained `N/A` values
  - Long snapshot and version identifiers can overflow cards, tables, or modals
  - Monte Carlo visualization panels can still fail structurally unless chart inputs and render guards are normalized
- These should be tracked as a dedicated follow-up plan, not mixed into the already-closed design refactor gate.

Target outcome:
- Decision surfaces show only values that are safe to read at-a-glance.
- Suspicious, estimated, stale, or invalid metrics are visibly downgraded or suppressed rather than rendered as normal decision-grade signals.
- Portfolio and Corporate surfaces explain metric absence or suppression with a human-readable reason instead of a silent `N/A`.
- Audit views expose formula path, source inputs, fallback assumptions, warnings, timestamps, and calculation version.
- Snapshot and history surfaces preserve both metric values and their confidence or quality metadata.
- Monte Carlo charts render from validated, normalized contracts with explicit loading, empty, invalid, and error states.

Track A - ROIC/WACC auditability redesign:
- [x] Define a frontend-ready audit contract for ROIC and WACC that includes raw inputs, computed intermediate values, quality status, warnings, source, timestamp, and calculation version
- [x] Add UI entry points for calculation audit access in:
  - Portfolio stock detail modal
  - Corporate Analysis calculation detail modal
  - Portfolio table row actions or equivalent stock drill-down affordance
  - ROIC/WACC metric cards where a low-confidence value should link to audit detail
- [x] Add display rules for metric confidence states: `ok`, `estimated`, `stale`, `suspicious`, `invalid`, `missing`
- [x] Define shared badge, label, and tone rules in `apps/web/components/ui/` so Corporate and Portfolio use the same confidence vocabulary
- [x] Suppress suspicious or invalid ROIC values from primary decision surfaces rather than rendering them as normal dashboard metrics
- [x] Render explicit fallback copy for invalid metrics, for example:
  - `ROIC: N/A`
  - `Reason: Invested capital missing or unstable`
- [x] Render suspicious metrics with visible downgrade state, for example:
  - `ROIC: 124.2% [Suspicious]`
  - audit-link affordance instead of normal positive emphasis
- [x] Ensure Calculation Detail Modal can present:
  - operating income / EBIT
  - tax rate
  - NOPAT
  - total debt
  - total equity
  - cash and equivalents
  - beginning, ending, and average invested capital
  - ROIC and WACC final values
  - warnings
  - calculation version

Track B - Portfolio metric refresh and `N/A` redesign:
- [x] Identify the current source-of-truth mismatch for Portfolio table and stock modal metrics: watchlist response, comparison snapshot, live comparison API, cached stale result, or missing merge logic
- [x] Define a unified per-ticker metric model shared by Watchlist table and Stock Detail Modal
- [x] Add metric-quality-aware rendering for:
  - `ROIC - WACC`
  - `DCF Upside`
  - `Expected vs Market`
  - `Volatility`
- [x] Replace plain `N/A` with reason-bearing states such as:
  - `N/A - Missing ROIC input`
  - `N/A - No latest comparison snapshot`
  - `N/A - Latest live comparison unavailable`
- [x] Define refresh-source priority in UI state ownership:
  - selected saved snapshot
  - latest corporate comparison snapshot
  - live comparison API
  - stale cached result
  - unavailable with reason
- [x] Add low-confidence or excluded status for table sorting and ranking when a metric is invalid or suspicious
- [x] Ensure stock modal and holdings table consume the same enriched metric model so values do not diverge by surface

Track B Follow-up - Portfolio comparison metrics regression analysis:
- [x] Reproduce the current bug in the real Portfolio UI, specifically:
  - `Watchlist Holdings` in `Table` mode shows `ROIC - WACC`, `DCF Upside`, and `Expected vs Market` as `N/A`
  - `StockDetailModal` shows `ROIC - WACC` correctly but still shows `DCF Upside` and `Expected vs Market` as `N/A`
- [x] Trace the exact runtime source path for those three metrics in `apps/web/app/portfolio/page.tsx`:
  - verify `activeComparisonData`
  - verify `comparisonMetricsByTicker`
  - verify whether `EMPTY_COMPARISON_METRICS` is being hit for real holdings
- [x] Compare the selected source branch at runtime:
  - selected saved snapshot via `selectedSnapshotQuery.data`
  - latest comparison result via `portfolioComparisonQuery.data`
  - cached comparison result via `cachedPortfolioComparison`
  - fallback `unavailable` path
- [x] Inspect whether the active comparison rows actually contain values for:
  - `row.roic_minus_wacc`
  - `row.dcf_implied_return`
  - `row.expected_return_spread`
  - `row.current_price`
- [x] Confirm the key-merge contract between the comparison payload and watchlist holdings:
  - ticker normalization and casing
  - benchmark row filtering
  - custom-universe exclusion behavior
  - whether watchlist holdings missing from the active comparison dataset are incorrectly falling into the default `N/A` state
- [x] Inspect, without committing debug logging, the selected-ticker derivation path in `apps/web/app/portfolio/page.tsx` for:
  - raw comparison row
  - derived `PortfolioTickerMetrics`
  - chosen `sourceMode`
  - `reason` for each metric when `displayValue` becomes `N/A`
- [x] Inspect `apps/web/app/portfolio/portfolioMetrics.ts` for over-eager missing-state conversion:
  - `comparisonSourceMode(...)`
  - `buildPortfolioTickerMetrics(...)`
  - `buildUnavailableMetric(...)`
  - `metricNumericValue(...)`
  - any branch that treats valid comparison numbers as missing or suspicious
- [x] Verify whether `StockDetailModal` receives the same `comparisonMetricsByTicker[selectedStock.ticker]` object that the table uses, and document any divergence between:
  - the modal cards
  - the table cells
  - the saved snapshot history blocks inside the modal
- [x] Check whether the issue only appears before `Refresh Analysis`, only in `snapshot` mode, only in `live` mode, or only when reviewing a saved snapshot via `selectedHistoryPoint`
- [x] Compare existing Playwright coverage against the reported regression and identify the missing gap:
  - `ROIC - WACC`
  - `DCF Upside`
  - `Expected vs Market`
  in both:
  - `Watchlist Holdings` table mode
  - `StockDetailModal`
- [x] Do not close this follow-up until the root cause is identified as one of:
  - missing backend values
  - wrong source-priority selection
  - ticker-row merge failure
  - formatter or quality-state bug
  - stale cached result overriding fresher comparison data

Analysis result:
- Root cause identified: wrong source-priority selection combined with page-level idle gating, not missing backend values and not a ticker merge failure.
- `DCF Upside` and `Expected vs Market` in Portfolio depend on `activeComparisonData -> comparisonMetricsByTicker -> PortfolioTickerMetrics`.
- `activeComparisonData` stays `null` until `handleRefreshPortfolioAnalysis()` sets:
  - `portfolioComparisonRequestedSnapshot`
  - `portfolioComparisonHistoryRequestedSnapshot`
  - `portfolioAnalysisRefreshToken`
- Because `portfolioComparisonQuery` is enabled only when both requested snapshot state and refresh token exist, the table and modal fall back to `EMPTY_COMPARISON_METRICS` on first load.
- `ROIC - WACC` appears to work in `StockDetailModal` because the modal also issues `metricAuditQuery` against `/corporate/metrics/{ticker}/audit`, which bypasses the Portfolio comparison idle gate.
- The comparison payload itself already contains `roic_minus_wacc`, `dcf_implied_return`, and `expected_return_spread` in the row model; the missing display is caused by the comparison query never being activated for first-load Portfolio review.

Next implementation patch for the real fix:
- [x] Remove the false `N/A` state for comparison metrics on first-load Portfolio review by auto-hydrating a comparison source for holdings when watchlist data exists
- [x] Keep attribution idle-first if needed, but decouple Portfolio comparison metrics from attribution refresh gating
- [x] Ensure the default source priority is:
  - selected saved snapshot
  - latest portfolio comparison snapshot
  - live comparison result when explicitly selected
  - cached stale comparison result
  - unavailable with reason
- [x] Add Playwright coverage for the actual first-load behavior:
  - before pressing `Refresh Analysis`, metric cards and table should not fall through to misleading bare `N/A` when a latest snapshot or cached comparison exists

Track C - Snapshot and long-text overflow hardening:
- [x] Add reusable overflow-safe utility classes for long identifiers, timestamps, snapshot versions, and source labels
- [x] Apply single-line ellipsis for table cells that hold long identifiers
- [x] Apply wrapped overflow-safe monospace blocks for cards, drawers, and modals that intentionally show raw snapshot or version identifiers
- [x] Prefer human-readable timestamp display in primary UI, with full ISO strings moved into tooltips or audit views
- [x] Audit Portfolio snapshot history, comparison snapshot labels, and calculation audit identifiers for overflow regressions at narrow widths

Track D - Monte Carlo chart rendering recovery and hardening:
- [x] Compare all Monte Carlo chart surfaces against the prior blank-chart resolution pattern in `data/error/corporate-diagnostics-graph-rendering-resolution.txt`
- [x] Define explicit chart data contracts for:
  - simulated paths
  - percentile cone
  - VaR / CVaR distribution
  - terminal value percentiles
  - return histogram
  - CDF comparison
  - fair value distribution
  - efficient frontier
  - Spearman sensitivity
- [x] Normalize worker outputs before setting React state: remove `NaN`, `Infinity`, mismatched lengths, and structurally incomplete arrays
- [x] Add a reusable `ChartGuard` or equivalent chart-validation boundary for Monte Carlo chart panels
- [x] Standardize fixed chart containers so all Recharts surfaces mount with explicit height and do not depend on accidental layout inheritance
- [x] Add explicit `loading`, `empty`, `invalid-data`, and `error` states for each Monte Carlo panel rather than rendering silent blank regions
- [x] Attach warnings to simulation result state when a result is partially recovered or normalized from incomplete worker output

Track E - Hardening and verification:
- [x] Add targeted tests for missing Yahoo fields and suppressed ROIC/WACC visualization states
- [x] Add tests for suspicious denominator cases such as near-zero or negative invested capital
- [x] Add Portfolio tests ensuring table and modal metrics share the same latest metric source and explanation text
- [x] Add overflow tests for long snapshot or version identifiers in table, modal, and history surfaces
- [x] Add Monte Carlo tests for empty arrays, invalid chart values, and degraded-but-visible chart states
- [x] Add API contract assertions where frontend depends on quality metadata, warnings, and calculation version fields

Engineering notes:
- Keep formula correctness, field normalization, denominator validation, and fallback hierarchy in backend services or shared finance packages. Frontend work here is visualization policy, suppression logic, and audit presentation.
- Do not show impossible financial metrics, unexplained `N/A` states, broken charts, or overflowing raw identifiers as if they were normal UI.
- Do not bury critical metric-quality warnings inside chart-only tooltips. Primary surfaces need visible downgrade state when a number is not decision-grade.
- Prefer additive API evolution first: consume quality metadata incrementally if backend ships it in stages rather than blocking on one large rewrite.
- Treat every failure mode as something that must become visible, explainable, bounded, auditable, and recoverable.
