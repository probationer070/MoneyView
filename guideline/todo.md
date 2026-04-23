# Development Todo

Purpose: track the active implementation plan for performance, portfolio UX, valuation streaming, and stock-price reliability work across `apps/web` and `apps/api`.

Status snapshot: as of 2026-04-19, the next delivery slice is centered on stock-price autofill, API transport-progress visibility, and closing the remaining observability gaps around live server execution.

## Active Tracks

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses

### Page Refresh Reliability Plan

Problem:
- A browser refresh is a full React/Next.js remount, so all `useState`, refs, in-memory React Query cache, active modals, input text, refresh tokens, and pending async state are lost.
- Corporate Analysis currently restores selected assumptions and last successful heavy calculation outputs only when they were explicitly written to browser storage.
- Functionality appears to break after refresh when a feature depends on ephemeral state that was never rehydrated, or when cached results belong to a stale ticker/snapshot but the page renders them as if they were current.
- This is different from tab navigation. Tab navigation may remount the route inside the same browser session, while full refresh also recreates the app runtime and requires every required state value to be reconstructed from URL, backend, `localStorage`, or `sessionStorage`.

Current findings:
- `apps/web/app/corporate/page.tsx` initializes active assumptions from `ACTIVE_TICKER_SESSION_KEY` plus the per-ticker `localStorage` assumption map.
- Heavy zones are intentionally refresh-gated: DCF, comparison, metric history, quarterly statements, and OHLCV fetch only when their requested snapshot and refresh token are both present.
- Last successful heavy-zone results are stored in `sessionStorage`, but refresh tokens are not stored by design, so reload should render cached/idle state rather than auto-fetch.
- Source-data caches are single-entry per zone. If the user refreshes after switching ticker, the old cached result can still be present and must be clearly marked stale or ignored when the ticker/snapshot does not match.
- Session storage is appropriate for continuity during a browser session, but it is not a durable persistence layer and will not survive a new browser session.

Target outcome:
- Refreshing the page never leaves controls unusable or in a misleading state.
- Page reload reconstructs all user-visible state from one of four explicit sources: route/search params, backend state, `localStorage`, or `sessionStorage`.
- Heavy calculation zones remain idle-first and manual-refresh-gated after reload.
- Cached results are shown only with their snapshot and stale status, and ticker/snapshot mismatches are either filtered out or visibly labeled stale.
- A cold start still has deterministic defaults and does not depend on previous in-memory state.

Resolution plan:
- [x] Inventory each Corporate page state value and classify it as URL-owned, backend-owned, durable browser-owned, session browser-owned, or intentionally ephemeral.
- [x] Add reload-focused tests that select a non-default ticker, refresh the browser page, and assert the selected ticker and assumptions are restored.
- [x] Add reload-focused tests for stale heavy-zone caches: cache AAPL source data, switch to MSFT, refresh, and assert stale/mismatch messaging or filtered rendering is correct.
- [x] Ensure cache readers validate the cached snapshot before using data in ticker-specific sections; render stale state explicitly when preserving old data is useful.
- [x] Keep refresh tokens ephemeral so reload does not silently trigger heavy DCF/comparison/source-data requests.
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
