# Development Todo

Purpose: track the active implementation plan for performance, portfolio UX, valuation streaming, and stock-price reliability work across `apps/web` and `apps/api`.

Status snapshot: as of 2026-04-19, the next delivery slice is centered on stock-price autofill, API transport-progress visibility, and closing the remaining observability gaps around live server execution.

## Active Tracks

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses




### Corporate Diagnostics Graph Rendering Investigation

Problem:
- In `apps/web/app/corporate/page.tsx`, the "Bottom-up Beta + WACC U-Curve" graph renders correctly, but "Company Status Diagnosis", "Hurdle Rate Decomposition", "4-Quadrant Value Driver Matrix", and "Risk-Return Minard Chart" do not appear graphically even though their underlying data series are present.
- The raw dataset export path already includes `healthRadar`, `regionalMinard`, `valueMatrix`, and `riskReturn`, which indicates the issue is likely after data preparation rather than at data import time.
- Because these charts are part of the same `CorporateDiagnosticsSection`, the failure needs to be compared directly against the working beta/WACC rendering path.

Current findings:
- `CorporateDiagnosticsSection` mounts all five graph components from the same parent section, and all five receive props from `apps/web/app/corporate/page.tsx`.
- The working chart, `BetaWaccCurveGraph`, uses two simple Cartesian Recharts primitives: `BarChart` and `LineChart`, each wrapped in `ResponsiveChart`.
- The four non-rendering charts use more specialized chart primitives and compositions:
- `CompanyStatusGraph`: `RadarChart`
- `HurdleRateDecompositionGraph`: `ComposedChart`
- `ValueDriverMatrixGraph`: `ScatterChart`
- `RiskReturnMinardGraph`: `AreaChart`
- The confirmed rendering difference was layout, not data shape: `BetaWaccCurveGraph` places each `ResponsiveChart` directly as a stretched grid child, so the wrapper measures a non-zero height and renders.
- The four broken panels wrapped `ResponsiveChart` inside a fixed-height parent `div`, but did not give the `ResponsiveChart` wrapper its own height, so the wrapper measured `0px` tall and returned `null` permanently.
- The issue was therefore a `ResponsiveChart` sizing contract mismatch rather than a missing data import or a chart-type-specific Recharts bug.

Target outcome:
- Identify the exact implementation difference that prevents the four diagnostics charts from rendering while `BetaWaccCurveGraph` works in the same dashboard.
- Narrow the root cause to one of:
- chart-type compatibility or runtime errors in the individual graph components
- chart wrapper/layout behavior that affects certain Recharts primitives but not `BarChart` and `LineChart`
- invalid or incomplete prop/domain configuration for the non-rendering charts
- Document the confirmed cause and define the smallest behavior-preserving fix before refactoring the chart section further.

Execution checklist:
- [x] Compare `CorporateDiagnosticsSection` prop wiring for the working and non-working diagnostics charts
- [x] Compare `BetaWaccCurveGraph.tsx` against `CompanyStatusGraph.tsx`, `HurdleRateDecompositionGraph.tsx`, `ValueDriverMatrixGraph.tsx`, and `RiskReturnMinardGraph.tsx` to isolate implementation differences
- [x] Verify whether the four non-rendering charts throw client-side runtime errors or fail silently under the current `ResponsiveChart` wrapper
- [x] Confirm whether the issue is chart-type-specific by testing whether the non-rendering components appear with simplified chart primitives or reduced configuration
- [x] Implement the narrowest fix once the rendering fault is confirmed
- [x] Run targeted frontend verification for the affected corporate graph components and/or E2E coverage for the diagnostics section

Engineering notes:
- Treat this first as a rendering-path investigation, not a data-fetch investigation; the source arrays are already created in `page.tsx` and exported in the raw dataset bundle.
- Keep the working `BetaWaccCurveGraph` path as the baseline reference because it proves the section layout, dynamic import registration, and `ResponsiveChart` usage can succeed in the same route.
- Prefer finding one concrete rendering fault over applying broad chart rewrites across all diagnostics panels.

### Corporate Selected Company Session Persistence

Problem:
- In `apps/web/app/corporate/page.tsx`, the selected company resets to `AAPL` whenever the user leaves the Corporate tab and later returns.
- The page already persists assumption payloads per ticker in `localStorage`, but the route initializes from `initialAssumptions.ticker` on every mount instead of restoring the last active ticker for the current session.
- This causes tab navigation to lose the current company context even though the per-ticker assumption data itself still exists.

Current findings:
- The initial assumptions state is created from `window.localStorage.getItem(STORAGE_KEY)`, but it always reads the entry for `initialAssumptions.ticker`.
- `selectTicker()` restores the selected ticker from the per-ticker `localStorage` map only at the moment of manual selection; it does not persist the active ticker identity separately for later route remounts.
- The existing `readSessionCache` / `writeSessionCache` helpers already provide a route-local `sessionStorage` mechanism that matches the requested lifecycle better than `localStorage`.
- The requested behavior is session-scoped, not durable across full app restarts, so the active ticker should not be promoted into long-term persistence.

Target outcome:
- Corporate Analysis keeps the currently selected ticker when the user navigates to another tab and returns during the same app/browser session.
- A cold start still defaults to `Apple` / `AAPL`.
- Existing per-ticker assumption persistence remains intact and continues to use `localStorage`.
- Only the active ticker identity becomes session-persistent.

Execution checklist:
- [x] Add a dedicated session-storage key for the active corporate ticker under `apps/web/app/corporate/`
- [x] Update Corporate page initialization to restore the session-selected ticker before falling back to `initialAssumptions.ticker`
- [x] Persist the active ticker to session storage whenever `selectTicker()` changes the company
- [x] Clear any mismatch risk by falling back to `defaultAssumptionsFor(restoredTicker)` when a restored ticker has no stored assumption row yet
- [x] Keep `localStorage` assumption persistence behavior unchanged except for using the restored active ticker as the initial lookup target
- [x] Run narrow verification for the Corporate page and confirm tab navigation preserves the selected company while a fresh app launch resets to `AAPL`

Engineering notes:
- Use `sessionStorage`, not `localStorage`, for the active ticker identity because the requirement is "persist during the session, reset on app restart."
- Do not replace the per-ticker assumption map in `localStorage`; that storage still serves a different purpose and should remain independent from active-tab selection state.
- Keep the change local to the Corporate route unless another route needs the same session key later.








## Cross-Cutting Follow-ups

Checklist:
- [x] Update `docs/architecture/` if DCF transport, cache strategy, page-level refresh ownership, or API transport observability changes materially


## Verification Targets

Checklist:
- [x] `apps/web`: targeted component and page tests for refresh-gated loading states and portfolio allocation interactions
