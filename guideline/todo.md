# Development Todo

Purpose: track the active implementation plan for performance, portfolio UX, valuation streaming, stock-price reliability work, and the frontend design-spec refactor across `apps/web` and `apps/api`.

Status snapshot: as of 2026-04-24, the active frontend track is the design-spec implementation defined under `docs/design/`, with earlier refresh-reliability work largely completed and now in follow-up mode.

## Active Tracks

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses

### Page Refresh Reliability Plan

Problem:
- A browser refresh is a full React/Next.js remount, so all `useState`, refs, in-memory React Query cache, active modals, input text, refresh tokens, and pending async state are lost.
- Corporate Analysis currently restores selected assumptions and last successful heavy calculation outputs only when they were explicitly written to browser storage.
- Functionality appears to break after refresh when a feature depends on ephemeral state that was never rehydrated, or when cached results belong to a stale ticker or snapshot but the page renders them as if they were current.
- This is different from tab navigation. Tab navigation may remount the route inside the same browser session, while full refresh also recreates the app runtime and requires every required state value to be reconstructed from URL, backend, `localStorage`, or `sessionStorage`.

Current findings:
- `apps/web/app/corporate/page.tsx` initializes active assumptions from `ACTIVE_TICKER_SESSION_KEY` plus the per-ticker `localStorage` assumption map.
- Heavy zones are intentionally refresh-gated: DCF, comparison, metric history, quarterly statements, and OHLCV fetch only when their requested snapshot and refresh token are both present.
- Last successful heavy-zone results are stored in `sessionStorage`, but refresh tokens are not stored by design, so reload should render cached or idle state rather than auto-fetch.
- Source-data caches are single-entry per zone. If the user refreshes after switching ticker, the old cached result can still be present and must be clearly marked stale or ignored when the ticker and snapshot do not match.
- Session storage is appropriate for continuity during a browser session, but it is not a durable persistence layer and will not survive a new browser session.

Target outcome:
- Refreshing the page never leaves controls unusable or in a misleading state.
- Page reload reconstructs all user-visible state from one of four explicit sources: route or search params, backend state, `localStorage`, or `sessionStorage`.
- Heavy calculation zones remain idle-first and manual-refresh-gated after reload.
- Cached results are shown only with their snapshot and stale status, and ticker or snapshot mismatches are either filtered out or visibly labeled stale.
- A cold start still has deterministic defaults and does not depend on previous in-memory state.

Resolution plan:
- [x] Inventory each Corporate page state value and classify it as URL-owned, backend-owned, durable browser-owned, session browser-owned, or intentionally ephemeral.
- [x] Add reload-focused tests that select a non-default ticker, refresh the browser page, and assert the selected ticker and assumptions are restored.
- [x] Add reload-focused tests for stale heavy-zone caches: cache AAPL source data, switch to MSFT, refresh, and assert stale or mismatch messaging or filtered rendering is correct.
- [x] Ensure cache readers validate the cached snapshot before using data in ticker-specific sections; render stale state explicitly when preserving old data is useful.
- [x] Keep refresh tokens ephemeral so reload does not silently trigger heavy DCF, comparison, or source-data requests.
- [x] Persist only state that is required for post-refresh continuity; avoid promoting temporary UI details like open modals or search text unless there is a clear UX requirement.
- [ ] Update architecture docs only if this changes the page-level cache ownership model rather than just tightening Corporate route behavior.

Engineering notes:
- Do not solve this by auto-fetching every heavy zone on mount; that would undo the refresh-gated performance design.
- Prefer snapshot-aware cache helpers over ad hoc `sessionStorage` reads in render logic as this pattern repeats across Corporate and Portfolio analysis zones.
- Treat `sessionStorage` failures as non-fatal because browser storage can be unavailable or corrupted.
- If durable cross-session continuity is required later, move the relevant state to backend persistence or carefully scoped `localStorage`; do not overload the current session cache.

## Cross-Cutting Follow-ups

Checklist:
- [x] Update `docs/architecture/` if DCF transport, cache strategy, page-level refresh ownership, or API transport observability changes materially

## Verification Targets

Checklist:
- [x] `apps/web`: targeted component and page tests for refresh-gated loading states and portfolio allocation interactions

## Design Specification Implementation

Sources:
- `docs/design/MoneyView_Design_Tokens.md`
- `docs/design/MoneyView_Component_System.md`
- `docs/design/MoneyView_Page_Wireframes.md`
- `docs/design/MoneyView_Interaction_Rules.md`
- `docs/design/MoneyView_Chart_System.md`
- `docs/design/MoneyView_Spec_Addendum.md`

Implementation rules carried into this checklist:
- Additive token migration only. Do not remove existing variables until Phase 5 cleanup.
- New UI work uses semantic tokens on day one.
- Route pages own fetch and refresh orchestration; presentational components stay thin.
- Modal surfaces are subset drill-downs; canonical deep-detail routes remain valid.

### Phase 1 - Foundations

Done:
- [x] Add semantic token aliases to `apps/web/app/globals.css`
- [x] Implement foundation primitives in `apps/web/components/ui/`: `PageHeader`, `SectionHeader`, `Card`, `KPIBlock`, `DenseTable`, `ModalShell`
- [x] Implement state primitives in `apps/web/components/ui/`: `StatusBadge`, `EmptyState`, `ErrorState`, `LoadingState`
- [x] Implement action primitives in `apps/web/components/ui/`: `ActionButton`, `IconButton`

Remaining foundation follow-ups:
- [x] Add missing component-system primitives if still required by the redesign: `FilterBar`, `ToggleGroup`, `Tabs`, `InlineField`
- [x] Audit new primitives for raw color, border, spacing, and type values that should resolve through semantic tokens
- [x] Confirm canonical export and ownership boundaries for `components/ui/`, `components/data/`, and `components/charts/`

### Phase 2 - Core Page Scaffolds

Market Overview (`apps/web/app/page.tsx`, `apps/web/components/market/MarketOverviewClient.tsx`):
- [x] Use `PageHeader` and card/table scaffold patterns
- [x] Use `DenseTable` for the compact market table view
- [x] Extract a dedicated `SparklineCard` from `MarketOverviewClient.tsx` so the card view matches the component-system spec
- [x] Verify market drill-down behavior against the modal-vs-route policy in the addendum

Portfolio (`apps/web/app/portfolio/page.tsx`, `apps/web/app/portfolio/components/`):
- [x] Split the page into analysis, holdings, and allocation zones
- [x] Integrate `PortfolioSnapshotSummary` and `PortfolioAllocationEditor` into the scaffold
- [x] Move all snapshot-history modal rendering to `app/portfolio/components/SnapshotHistoryModal.tsx` so there is one source of truth
- [x] Confirm holdings card/table toggle, modal trigger flow, and snapshot-context presentation match the wireframe

Corporate Analysis (`apps/web/app/corporate/page.tsx`, `apps/web/app/corporate/components/`):
- [x] Preserve the left/right modeling-desk layout with assumptions on the left and diagnostics on the right
- [x] Integrate `CorporateAssumptionsPanel` and `CorporateComparisonTable`
- [x] Audit KPI, graph, and table click targets so all intended audit surfaces open `CalculationDetailModal`
- [x] Confirm bottom comparison controls own universe, benchmark, sort, and refresh behavior at the section boundary

Monte Carlo (`apps/web/app/monte-carlo/page.tsx`, `apps/web/app/monte-carlo/components/`):
- [x] Keep a shared page shell and tabbed lab workflow
- [x] Extract a reusable `MonteCarloRunPanel` or equivalent shared input-results wrapper from repeated sub-tab layouts
- [x] Standardize run, cancel, progress, result-summary, and export placement across all five simulation tabs

News Feed (`apps/web/app/news/page.tsx`):
- [x] Apply `PageHeader` and readable card-list presentation
- [x] Extract a `NewsFeedList` boundary if feed layout and item rendering remain page-local
- [x] Audit headline, metadata, and highlight treatment against the Reader-mode wireframe

### Phase 3 - Deep Components And Chart System

Implemented or present in the repo:
- [x] `MetricGrid`
- [x] `ComparisonTable`
- [x] `DataQualityPanel`
- [x] `HistogramPanel`
- [x] `HeatmapPanel`
- [x] `PercentileBandPanel`
- [x] `PortfolioSnapshotSummary`
- [x] `PortfolioAllocationEditor`
- [x] `CorporateAssumptionsPanel`
- [x] `CorporateComparisonTable`

Remaining deep-component work:
- [x] Add `TimelineList` for timeline-style portfolio or news history surfaces if the wireframe requires it
- [x] Add `OHLCVChartCard` as a reusable chart wrapper, or explicitly document `TVChart` as the spec-compliant substitute
- [x] Ensure `apps/web/lib/chartConfig.ts` fully centralizes shared chart defaults, tooltip styling, numeric formatting, and color assignment rules
- [x] Audit all new charts for loading, empty, error, and stale-state handling consistent with the interaction rules
- [x] Add targeted tests for non-trivial local-state owners such as allocation editing, comparison sorting, and modal-driven drill-downs

### Phase 4 - Modal Depth

Current surface status:
- [x] `StockDetailModal` exists in `apps/web/app/portfolio/components/StockDetailModal.tsx`
- [x] `CalculationDetailModal` exists in `apps/web/app/corporate/components/CalculationDetailModal.tsx`
- [x] `SnapshotHistoryModal` scaffold exists in `apps/web/app/portfolio/components/SnapshotHistoryModal.tsx`

Remaining modal work:
- [x] Bring `StockDetailModal` fully in line with the wireframe: metric summary, OHLCV view, snapshot context, history timeline, and filtered news
- [x] Bring `CalculationDetailModal` fully in line with the wireframe: formula explanation, result summary, data lineage, supporting rows, collapsible raw datasets, and export affordances
- [x] Bring `SnapshotHistoryModal` fully in line with the wireframe: grouped dates, review actions, and locked benchmark or universe review context
- [ ] Verify focus trap, Escape close, backdrop close, and responsive modal sizing across all three modal types
- [ ] Add internal loading and error-state coverage for each modal surface

### Phase 5 - Polish And Definition Of Done

Cross-tab UX audit:
- [ ] Apply consistent loading, empty, error, and stale-state patterns across Market Overview, Portfolio, Corporate, Monte Carlo, and News
- [ ] Audit progressive disclosure levels: summary on page, analytics in expanded sections, audit detail in modals
- [ ] Audit explicit refresh behavior so heavy analysis never auto-runs silently on mount

Design-system audit:
- [ ] Remove ad hoc spacing values where token-based spacing should be used
- [ ] Remove raw font-size usage where the type scale should be used
- [ ] Confirm default cards stay flat by default and rely on border and spacing emphasis rather than shadows
- [ ] Confirm Korean-market delta color semantics remain red-up and blue-down everywhere

Chart audit:
- [ ] Standardize tooltip styling from shared config across all Recharts surfaces
- [ ] Standardize axis label sizing and numeric formatting across all chart families
- [ ] Verify chart empty and error states plus export affordances follow the chart-system spec

Responsive and accessibility audit:
- [ ] Test desktop-primary behavior at `1280px`
- [ ] Test tablet degradation at `768px`
- [ ] Test mobile degradation at `375px`, especially for Market Overview and News
- [ ] Verify Corporate and Monte Carlo remain usable, even if not fully optimized, on narrower widths
- [ ] Check keyboard navigation, focus order, aria labels, and modal accessibility behavior

Verification gate before closing the design refactor track:
- [ ] `npm.cmd run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm.cmd run build`
- [ ] Run targeted page and component tests covering loading, empty, error, refresh-gated, and modal drill-down behavior
