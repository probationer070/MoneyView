# Development Todo

Purpose: track the active implementation plan for performance, portfolio UX, valuation streaming, and stock-price reliability work across `apps/web` and `apps/api`.

Status snapshot: as of 2026-04-18, the next delivery slice is centered on removing heavy work from initial page load, simplifying portfolio allocation flows, reducing DCF payload pressure, fixing cold-load price behavior, and improving Simulation Lab ticker-to-price autofill.

## Active Tracks

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses

### 1. Real-time Calculation Optimization

Problem:
- SSR and auto-triggered real-time calculations are slowing initial page response time.
- Expensive `useEffect` fetches and server-render fetches are competing with first paint and interaction readiness.

Target outcome:
- Initial page load renders immediately with placeholders or stale cached results.
- Heavy calculations run only inside explicit "calculation zones" after a user refresh action.
- Previously fetched results remain visible until replaced by a newer successful refresh.

Implementation detail:
1. Audit every page-level SSR `fetch`, client `useEffect`, and React Query auto-fetch path.
2. Classify each request as `lightweight` or `heavy`.
3. Keep only lightweight metadata, shell layout data, and essential identifiers on initial render.
4. Move heavy requests behind a local `isRefreshing` gate or explicit query enable flag.
5. Add a section-level or global `Refresh` button that triggers the calculation/fetch on demand.
6. Show skeletons or placeholders on first load instead of blocking for live data.
7. Cache the last successful result in local UI state or a lightweight client cache such as `sessionStorage` or Zustand.
8. Display a `Last updated` timestamp next to each refresh control.

Execution checklist:
- [x] Audit all page-level SSR `fetch` usage and list each endpoint by route and component owner
- [x] Audit all client `useEffect` and auto-enabled query flows that trigger calculations on mount
- [x] Label each request path as `lightweight` or `heavy` in the implementation notes or follow-up issue
- [x] Remove heavy requests from the initial render path and gate them behind explicit refresh actions
- [x] Introduce calculation-zone state that distinguishes `idle`, `refreshing`, `success`, `error`, and `stale`
- [x] Add section-level or global `Refresh` controls in the page-level query owner
- [x] Render skeletons or placeholders on first load for heavy sections
- [x] Persist last successful results in local state, query cache, or `sessionStorage` where navigation-back behavior matters
- [x] Show `Last updated` timestamps next to refresh controls
- [x] Add targeted tests for initial-load no-fetch behavior and explicit refresh-trigger behavior

Progress notes:
- [x] Corporate Analysis: backend DCF is now refresh-gated, stale-first, and cached in `sessionStorage`
- [x] Corporate Analysis: live comparison is now refresh-gated, stale-first, and cached in `sessionStorage`
- [x] Corporate Analysis: metric history, quarterly statements, and historical price detail now stay idle on first load, reuse stale cached data, and refresh from a single source-data control
- [x] Ticker Detail: DCF workbench and corporate diagnostic workbench are now refresh-gated, stale-first, and cached in `sessionStorage`
- [x] Portfolio: comparison summary, snapshot history, and attribution now use a page-level refresh-gated stale-first analysis zone with `sessionStorage` cache and `Last updated` / stale state messaging
- [x] Playwright coverage now verifies idle-first page load and explicit refresh behavior for both Corporate Analysis and Portfolio
- [x] Portfolio detail fetch review completed: stock detail and stock snapshot-history requests are already gated by modal open / panel open, so no extra initial-load gating is required there right now

Audit notes:
- [x] `apps/web/app/page.tsx`: SSR `/market/indices` is classified as `lightweight` because it is the route’s primary shell dataset and not an expensive calculation zone
- [x] `apps/web/app/news/page.tsx`: client `/news/feed` initial page is classified as `lightweight` content loading; pagination stays user-scroll driven
- [x] `apps/web/app/detail/[ticker]/page.tsx`: SSR `/detail/{ticker}/ohlcv` and `/detail/{ticker}/technicals` are classified as `route-essential heavy data` and intentionally remain route-owned because the page itself is the detail surface
- [x] `apps/web/components/market/MarketOverviewClient.tsx`: market detail fetch is classified as `heavy-on-open` and already gated behind modal open
- [x] `apps/web/app/corporate/page.tsx`: companies and S&P 500 index context are `lightweight`; DCF, comparison, metric history, quarterly statements, and price history are `heavy` and now refresh-gated
- [x] `apps/web/app/portfolio/page.tsx`: watchlist and sync status are `lightweight`; comparison summary, comparison history, and attribution are `heavy` and now refresh-gated; stock detail and stock snapshot history are `heavy-on-open` and already panel/modal gated
- [x] `apps/web/app/monte-carlo/page.tsx`: simulations are `heavy` but already explicit user-trigger work rather than mount-triggered queries

Engineering notes:
- Prefer page-owned refresh orchestration over hiding this logic inside deeply nested chart components.
- Separate `initial shell render` data from `expensive analytics` data in both UI and API contracts.
- If a section can safely render stale data, use stale-first behavior and refresh only when the user requests it.

Acceptance criteria:
- No heavy analytics call is triggered automatically on first load.
- Navigating away and back does not immediately re-trigger heavy calculations if cached data exists.
- Each calculation zone communicates `idle`, `refreshing`, `last updated`, and `stale` states clearly.

Definition of done:
- [x] Verified no heavy analytics call fires automatically on first load
- [x] Verified back-navigation does not immediately re-trigger heavy calculations when cached data exists
- [x] Verified each calculation zone exposes clear loading and freshness state in the UI



### 2. Portfolio Allocation UX Redesign

Problem:
- The current allocation section is too long and makes stock selection cumbersome.

Chosen direction:
- Use a split layout with a stock browser/search panel on the left and a portfolio allocation table on the right.

Target layout:

```text
[ Stock Search Panel ]          [ Portfolio Table ]

Search: [________]             Ticker  Name  Weight %  Action

AAPL  Apple Inc.    [+ Add]    AAPL   Apple  40%      [Save] [Delete]
MSFT  Microsoft     [+ Add]    MSFT   MSFT   60%      [Save] [Delete]
TSLA  Tesla         [Added]
GOOGL Alphabet      [+ Add]
```

Behavior rules:
- Stocks already present in the portfolio are shown as disabled or grayed out with an `Added` state.
- Weight percentage is editable inline in the portfolio table.
- `Save` persists weight changes for that row.
- `Delete` removes the row and re-enables the stock in the search panel.
- Total weight validation is warning-only when the total exceeds `100%`; it should not hard-block row editing.

Implementation detail:
1. Separate `stock discovery/search state` from `portfolio row edit state`.
2. Build the search panel so add/remove state is derived from current portfolio membership, not duplicated local flags.
3. Keep row edits local until `Save` to avoid accidental persistence on every keystroke.
4. Surface a portfolio total summary with a warning treatment when total weight exceeds `100%`.
5. Make sure delete operations immediately update both the table and search results state.

Execution checklist:
- [x] Identify the current portfolio allocation screen owner and split responsibilities between search panel and table
- [x] Build or refactor a dedicated stock search panel with query input and add actions
- [x] Build or refactor a dedicated portfolio table with inline editable weight cells
- [x] Derive `Added` and disabled states from actual portfolio membership rather than duplicated UI flags
- [x] Keep unsaved row edits local until `Save` is clicked
- [x] Implement row-level save behavior or a temporary adapter if the backend only supports batch persistence
- [x] Implement row delete behavior that immediately re-enables stocks in the search panel
- [x] Add total-weight summary and warning treatment when total exceeds `100%`
- [x] Ensure long-list scanning and repeated add/edit/delete actions work without excessive scrolling
- [x] Add targeted UI tests for add, save, delete, duplicate-prevention, and overweight-warning flows

Engineering notes:
- Keep the table as the ownership point for saved portfolio rows and pending weight edits.
- Avoid mixing long-form stock discovery UI with per-row persistence logic in a single monolithic component.
- If the API already supports partial updates, use row-level save. Otherwise, batch save can remain as a temporary fallback, but the UI should still look row-oriented.
- Implemented in `apps/web/app/portfolio/page.tsx` as a split `Portfolio Allocation Workspace` with a left browser/manual-add panel and a right row-oriented allocation table.
- Duplicate prevention is derived from watchlist membership inside the browser result list, so delete immediately re-enables the corresponding add action without separate UI flags.
- Targeted coverage lives in `apps/web/tests/e2e/portfolio-watchlist.spec.ts` and now includes search-panel duplicate prevention, row save/delete persistence, and warning-only overweight editing behavior.

Acceptance criteria:
- Users can search, add, edit weight, save, and delete without scrolling through a long mixed list.
- Duplicate additions are blocked by state derived from the actual portfolio rows.
- Over-100% totals warn clearly but do not block editing.

Definition of done:
- [x] Verified users can complete add/edit/save/delete flows in the split layout
- [x] Verified duplicate additions are blocked correctly
- [x] Verified total weight above `100%` shows a warning without hard-blocking edits



### 3. Back-End DCF Partial Output Streaming

Problem:
- Full DCF output is currently pushed through the real-time path, creating latency and payload overhead.

Target outcome:
- Real-time updates send only summary-level data first.
- Full DCF breakdowns remain server-side until the user explicitly requests them.
- The UI progressively renders results instead of waiting for the full report payload.

Streaming phases:

| Phase | Payload | Trigger |
| --- | --- | --- |
| 1 | Intrinsic value and upside percentage | As soon as core valuation completes |
| 2 | Key assumptions summary | After phase 1 |
| 3 | Full projection tables and intermediate breakdowns | Only on explicit `View Full Report` request |

Implementation detail:
1. Split the DCF response contract into `summary` and `full report` shapes.
2. Push only summary-phase output through SSE or WebSocket updates.
3. Keep WACC breakdown, FCF projection rows, terminal value details, and similar intermediate tables off the live stream.
4. Add a dedicated full-report endpoint or explicit action to retrieve detailed breakdowns on demand.
5. Ensure frontend rendering can consume phase 1 and phase 2 incrementally without assuming phase 3 exists.

Execution checklist:
- [x] Audit the current DCF real-time transport path and identify where full payloads are assembled
- [x] Define separate `summary` and `full report` contracts for DCF results
- [x] Update backend services so summary phases are emitted independently of full report assembly
- [x] Keep WACC breakdown, FCF projections, and terminal-value details off the real-time summary channel
- [x] Add or refactor SSE/WebSocket event types for phase 1 and phase 2 payloads
- [x] Add an explicit `View Full Report` retrieval path for phase 3 data
- [x] Update frontend consumers to render partial summary results without waiting for full tables
- [x] Update `packages/shared-types` for any public DCF payload contract changes
- [x] Add targeted service and transport tests for phased streaming behavior

Engineering notes:
- Shared frontend contracts in `packages/shared-types` must be updated if public payload shapes change.
- Thin routes should orchestrate streaming, but report assembly and phased output logic should remain in backend services.
- Summary payloads should include calculation status, timestamps, and enough identifiers to correlate a full-report request later.

Acceptance criteria:
- Initial valuation summary appears before the full detailed report is available.
- Full DCF tables are not shipped to the client unless the user explicitly requests them.
- Real-time transport payload size is materially reduced for DCF runs.

Definition of done:
- [x] Verified phase 1 renders before full-report retrieval
- [x] Verified full DCF tables are not sent on the default real-time path
- [x] Verified real-time payload size and latency improve measurably versus the current path

Improvement follow-ups:
- [x] Replace the ad-hoc frontend DCF TypeScript interfaces with imports from `packages/shared-types/corporate.ts` so the page, mocks, and route contract cannot drift.
- [x] Replace the remaining hand-written DCF mock payload typing in Playwright helpers with imports from `packages/shared-types/corporate.ts` so test fixtures are checked against the same contract as the UI.
- Add a focused E2E assertion that opens the Backend DCF modal, confirms phase 1 renders before `View Full Report`, then verifies the projection table appears only after the explicit report request.
- Add route-level timing logs around summary assembly and full-report assembly so real latency gains can be tracked from the backend instead of relying only on payload-size comparisons.
- Consider delaying full-report construction until the `/report` endpoint is hit in every path. The current service cleanly separates contracts, but future refactors should avoid accidentally rebuilding phase 3 work inside the live stream path.
- If the corporate page expands, move the SSE parsing and cache merge logic into a dedicated frontend hook so the page component does not keep accumulating transport concerns.




### 4. Stock Price Cold-Load Bug

Problem:
- Stocks with no prior cache entry cannot show prices immediately on first request.

Required analysis:
1. Trace the cold-miss path after `get_stock_ohlcv` fails to find cached data.
2. Identify the actual failure mode:
   - yfinance or upstream provider timeout
   - swallowed exception or silent fallback
   - UI rendering before a pending request resolves
   - race condition between fetch initiation and component state lifecycle

Fix direction:
- Return a frontend-visible `loading` or `fetching` state on cache miss instead of blocking or returning null.
- Pre-warm a configurable baseline list of popular tickers during server startup.
- Add retry logic with exponential backoff for provider fetch failures.
- Log cold misses so repeated uncached symbols can inform the pre-warm list.

Implementation detail:
1. Instrument the cache miss path with explicit logging and outcome labels.
2. Confirm whether the current path is synchronous-blocking, timing out, or returning an empty state too early.
3. Add an immediate cache-miss response contract such as `status=fetching`.
4. Queue or trigger a background fetch to hydrate the cache.
5. Let the frontend poll or subscribe for completion instead of waiting on the first request.

Execution checklist:
- [x] Trace the full cold-miss path starting from `get_stock_ohlcv`
- [x] Document the fallback chain and identify where null, timeout, or silent failure is produced
- [x] Add structured logging for cache misses, provider attempts, retries, failures, and hydrate completion
- [x] Change the cold-miss response contract to an explicit `fetching` or `loading` state
- [x] Move provider fetch work out of the immediate UI-response path where necessary
- [x] Add retry behavior with exponential backoff for transient upstream failures
- [x] Add a configurable server-startup pre-warm list for common tickers
- [x] Ensure the frontend can poll or subscribe for completion after a cold-miss response
- [x] Add targeted tests for cache hit, cold miss, retry, and terminal failure behavior

Engineering notes:
- The cold-miss path should degrade into an observable pending state, not a silent absence of data.
- Startup pre-warm should be configurable and bounded to avoid slowing application boot.
- Logging should be structured enough to distinguish cache miss frequency from provider failure frequency.

Acceptance criteria:
- A first-time ticker request never fails silently.
- Cold misses are visible in logs with enough context to diagnose cause and frequency.
- Frequently requested symbols can be promoted into a configurable pre-warm list.

Definition of done:
- [x] Verified first-time ticker requests return an observable pending or success state, never silent null behavior
- [x] Verified structured logs capture cold misses and provider outcomes
- [x] Verified pre-warm configuration can seed common tickers without blocking startup excessively
- [x] Verified a frontend consumer can poll the cache-first price endpoint after `202 Accepted` and resolve into success or inline failure




### 5. Simulation Lab Auto-populate Stock Price on Ticker Input

Problem:
- In the Corporate Valuation flow, entering a ticker does not auto-fill the current stock price.

Target outcome:
- When the user finishes typing a ticker, the UI performs a fast cache-first lookup and fills the price field automatically when available.
- Users can still override the populated price manually.

Preferred UX:
1. User enters a ticker.
2. `onBlur` or a debounced `onChange` triggers a lightweight lookup.
3. The stock price field shows a loading spinner while the lookup is in flight.
4. On success, the field auto-populates with the current price.
5. On failure, show inline feedback such as `Ticker not found` and keep the field empty.

Backend requirement:
- `/api/v1/stock/{ticker}/price` must be cache-first and fast.
- This endpoint must not hit yfinance or another slow provider inline during a UI interaction.
- If no cache entry exists, return `202 Accepted` with a `fetching` status and allow the frontend to poll or receive a pushed update later.

Implementation detail:
1. Add ticker input event handling in the Corporate Valuation UI.
2. Debounce if using `onChange`; otherwise prefer `onBlur` for lower request volume.
3. Guard against race conditions so a stale response for an older ticker does not overwrite a newer input.
4. Keep manual edits to the price field possible after auto-fill.
5. Normalize API response handling for `success`, `fetching`, and `not found` states.

Execution checklist:
- [x] Identify the ticker and stock-price field owner in the Corporate Valuation UI
- [x] Add `onBlur` or debounced `onChange` lookup behavior for ticker input
- [x] Add loading-spinner presentation inside the stock-price field during lookup
- [x] Populate the price field automatically on successful cached lookup
- [x] Preserve the ability for users to manually override the price value after auto-fill
- [x] Show inline `Ticker not found` or equivalent validation when lookup fails
- [x] Handle `202 Accepted` and `fetching` responses with polling or subscription cleanup on ticker change/unmount
- [x] Guard against stale response races so older ticker lookups cannot overwrite newer input
- [x] Reuse the cache-first price endpoint path introduced by the cold-load fix
- [x] Add targeted tests for success, fetching, invalid ticker, and stale-response race behavior

Engineering notes:
- Reuse the same cache-first backend path needed for the cold-load fix instead of building a second live-fetch code path.
- If the UI uses polling after `202 Accepted`, stop polling once the ticker changes or the component unmounts.
- Inline spinner and error handling should be local to the price field rather than blocking the full form.

Acceptance criteria:
- Entering a valid cached ticker auto-fills the price field quickly.
- Uncached tickers move into a visible `fetching` state rather than appearing broken.
- Invalid tickers surface an inline error without crashing the form or overwriting manual user input.

Definition of done:
- [x] Verified valid cached tickers auto-fill quickly
- [x] Verified uncached tickers move into a visible fetching state
- [x] Verified invalid tickers show inline errors without overwriting user edits



### 6. API Transport Progress Visibility

Problem:
- During actual app execution, the API server console does not make response-transmission progress visible enough.
- Logs may still be written to files, but operators cannot easily tell in real time how much data the server is sending, whether a transport-heavy response is still progressing, or whether it has stalled.

Target outcome:
- The existing logging system continues to write persistent log files.
- The running API server console also shows live transmission progress for response-heavy or streamed endpoints.
- When total payload size is known, the server prints progress as bytes sent plus percentage (`n%`).
- When exact total size is not knowable in advance, the server still exposes meaningful real-time progress signals such as stream phase completion and transmitted chunk counts instead of showing misleading percentages.

Implementation detail:
1. Audit the current API logging pipeline and identify why progress is not surfacing in the live console even though logs exist.
2. Instrument the transport layer, response wrapper, or streaming layer rather than only business handlers.
3. Emit structured progress logs with request ID, route, elapsed time, bytes sent, and percentage when total size is known.
4. For SSE or chunked responses, emit phase-based or chunk-based progress logs if exact total bytes cannot be known beforehand.
5. Preserve file-based logging while also ensuring real-time console visibility.
6. Avoid noisy per-byte logging; throttle progress updates to meaningful intervals or phase boundaries.

Current-state findings:
- `apps/api/core/logger.py` already attaches both a console handler and a file handler.
- `apps/api/core/middleware.py` currently logs request start failure/completion only at the end of the response lifecycle.
- `apps/api/routes/corporate.py` streams DCF SSE phases, but those phase emissions are not currently surfaced as explicit transport-progress logs.
- The practical gap is not missing logging infrastructure; it is missing in-flight progress instrumentation.

Scope and likely file owners:
- `apps/api/core/logger.py`
  - extend structured fields if needed for `bytes_sent`, `total_bytes`, `progress_pct`, `chunk_index`, `chunk_count`, `phase`, and `transport_kind`
- `apps/api/core/middleware.py`
  - keep request lifecycle logging
  - add hooks or wrappers for known-size response progress where feasible
- `apps/api/core/`
  - likely add a dedicated helper such as `transport_progress.py` to avoid bloating middleware
- `apps/api/routes/corporate.py`
  - add explicit phase-completion logging for DCF streaming
- `docs/architecture/`
  - record what “progress” means for known-size vs streaming transports

Planned rollout:
1. Phase 6A: logging-pipeline audit and console visibility confirmation
   - confirm which logger names currently reach console vs file
   - confirm whether Uvicorn/FastAPI handlers are propagating correctly
   - confirm current console output during a normal JSON response and during DCF SSE
2. Phase 6B: streaming progress instrumentation first
   - instrument `POST /api/v1/corporate/dcf/{ticker}/stream`
   - log `phase1 complete`, `phase2 complete`, and `stream complete`
   - include request ID, ticker, elapsed time, and bytes/chunks sent if available
   - this is the safest first target because SSE progress is phase-based and does not require fake percentages
3. Phase 6C: known-size response progress instrumentation
   - identify one concrete non-streaming endpoint with a measurable payload
   - add bytes-sent and percentage logging only when total size can be computed truthfully
   - prefer thresholded updates such as `25%`, `50%`, `75%`, `100%` or a byte interval instead of noisy fine-grained logs
4. Phase 6D: verification and operator-facing examples
   - capture sample console logs
   - verify the same events are written to the file log
   - document fallback behavior for streams where total size is not known

Proposed concrete outputs:
- Known-size response console examples:
  - `transport.progress route=/api/v1/report/export request_id=... bytes_sent=524288 total_bytes=2097152 progress_pct=25.0 elapsed_ms=320`
  - `transport.progress route=/api/v1/report/export request_id=... bytes_sent=2097152 total_bytes=2097152 progress_pct=100.0 elapsed_ms=1180 completed=true`
- Streaming response console examples:
  - `transport.phase route=/api/v1/corporate/dcf/AAPL/stream request_id=... phase=phase1 elapsed_ms=180`
  - `transport.phase route=/api/v1/corporate/dcf/AAPL/stream request_id=... phase=phase2 elapsed_ms=260`
  - `transport.phase route=/api/v1/corporate/dcf/AAPL/stream request_id=... phase=complete elapsed_ms=265 completed=true`

Implementation constraints:
- Do not print fake percentages for SSE just to satisfy the console requirement.
- Do not move route business logic into middleware; keep transport instrumentation generic and route logic thin.
- Do not log every tiny chunk; the console must remain readable during normal development.
- Preserve the existing JSON file logs; console visibility is additive, not a replacement.

Execution checklist:
- [x] Audit `apps/api/core/logger.py` and confirm console/file handler behavior under live server startup
- [x] Audit `apps/api/core/middleware.py` and document exactly where request lifecycle logging stops today
- [x] Choose the first streaming target and first known-size target for instrumentation
- [x] Add a dedicated transport-progress helper under `apps/api/core/` instead of overloading route handlers
- [x] Add phase-completion logging to the DCF SSE route in `apps/api/routes/corporate.py`
- [x] Add known-size progress logging for at least one measurable response path
- [x] Ensure progress logs include request ID, route, elapsed time, and completion status
- [x] Keep file-log persistence and console visibility enabled at the same time
- [x] Throttle progress logs to meaningful phase or threshold boundaries
- [x] Add targeted verification for both a known-size response and a streaming response
- [x] Save at least one real console sample and one file-log sample in `data/error` or docs for comparison

Engineering notes:
- This is an observability requirement, not a replacement for the current logging system.
- Prefer structured logs that can be written to file and echoed to console by separate handlers.
- If exact total payload size is unavailable for a live stream, percentage must not be fabricated; use truthful phase-based progress instead.
- For phased transports like DCF streaming, logs such as `phase1 complete`, `phase2 complete`, and `stream complete` are more correct than fake byte percentages.
- Instrumentation should live close to the response/transport layer so business routes remain thin.
- The first implementation target should be the DCF SSE route because it directly matches the current user pain: live execution without visible progress.
- A second target should be a known-size export or report response so percentage-based progress can be demonstrated truthfully.
- Prefer additive helpers and wrapper functions over invasive refactors to the whole middleware stack on the first pass.

Verification plan:
1. Start the API locally and confirm the existing console handler is active.
2. Trigger one DCF SSE request and verify phase-based progress appears live in the server console before request completion.
3. Trigger one known-size response and verify byte/percentage progress appears live in the server console.
4. Confirm the same progress events are written to `data/cache/logs/api-server.log`.
5. Confirm final request completion logs still appear and are not replaced by progress logs.

Acceptance criteria:
- The API server console visibly reports live transmission progress during real app execution.
- Log files continue to capture the same transport-progress events for later diagnosis.
- Operators can distinguish between a response that is still sending data and a response that has stalled or completed.

Definition of done:
- [x] Verified progress output is visible in the API server console during live requests
- [x] Verified transport-progress logs are also persisted to log files
- [x] Verified percentage logging is used only when total payload size is known
- [x] Verified streaming endpoints fall back to truthful phase/chunk progress instead of misleading percentages




### 7. Portfolio Table Scroll Containment

Problem:
- When the Portfolio Table contains many tickers, the panel grows too tall and leaves the overall window layout feeling oversized or visually blank.
- The table currently expands with content instead of keeping the surrounding workspace stable.

Target outcome:
- The Portfolio Table keeps a stable panel height inside the page layout.
- Long ticker lists scroll inside the table area instead of stretching the full window panel.
- Headers and action controls remain usable while the row list scrolls.

Preferred UX:
1. The portfolio workspace keeps its current split layout.
2. The right-side Portfolio Table gets a bounded height.
3. The row list becomes vertically scrollable when it exceeds that height.
4. The table header remains visible or visually anchored while scrolling if practical.
5. Mobile and narrower desktop layouts still remain usable without clipping controls.

Implementation detail:
1. Identify the Portfolio Table owner in `apps/web/app/portfolio/page.tsx`.
2. Add a scroll container around the row table body or around the full table panel, depending on the current DOM structure.
3. Use a bounded height such as viewport-relative max height instead of a fixed oversized pixel height.
4. Ensure action buttons, total-weight summary, and warning states stay visible and are not pushed off-screen unnecessarily.
5. Verify keyboard, mouse-wheel, and trackpad scrolling work naturally inside the panel.

Execution checklist:
- [x] Identify the Portfolio Table container and current height behavior in `apps/web/app/portfolio/page.tsx`
- [x] Add a bounded-height scroll region for large ticker lists
- [x] Keep the table header and row actions usable while the list scrolls
- [x] Ensure overweight warnings and summary controls remain visible in the surrounding workspace
- [x] Check desktop and narrow-width behavior so the scroll region does not cause clipped controls or double-scroll confusion
- [x] Add focused E2E coverage for a long portfolio list that requires scrolling

Engineering notes:
- Prefer internal panel scrolling over letting the entire page section grow indefinitely.
- Avoid hard-coding a giant pixel height that will still feel wrong on smaller screens.
- If sticky headers are added, keep them visually consistent with the current table styling.
- The page owner should still control layout behavior; do not hide overflow fixes deep inside a presentational row component.

Acceptance criteria:
- A large portfolio list no longer stretches the panel excessively.
- Users can scroll through many tickers inside the Portfolio Table area.
- The page remains readable and stable on both desktop and narrower layouts.

Definition of done:
- [x] Verified long ticker lists scroll inside the Portfolio Table panel
- [x] Verified panel height remains visually bounded instead of expanding indefinitely
- [x] Verified row actions and summary controls remain usable with overflow content






## Cross-Cutting Follow-ups

Checklist:
- [x] Update `docs/architecture/` if DCF transport, cache strategy, page-level refresh ownership, or API transport observability changes materially
- [x] Update `packages/shared-types` for any frontend-consumed API contract changes
- [x] Keep route handlers thin and place orchestration or retry logic in backend services
- [x] Prefer targeted verification for each changed area before broader end-to-end validation
- [x] Record any new cache-status, streaming, or transport-observability contracts in docs close to the owning backend service

## Verification Targets

Checklist:
- [x] `apps/web`: targeted component and page tests for refresh-gated loading states and portfolio allocation interactions
- [x] `apps/web`: targeted tests for ticker autofill behavior
- [x] `apps/api`: targeted service and route tests for cache miss handling, `202 Accepted` response flow, retries, and phased DCF output
- [x] E2E: focused flows for portfolio allocation UX and Simulation Lab ticker autofill once the underlying API contracts stabilize
- [x] Measure before/after impact for heavy-load gating and DCF partial streaming with concrete timings or payload comparisons
- [x] Capture concrete API transport-progress samples for both known-size responses and streaming responses








## DCF Hook Refactor Note

Question:
- What does `extract the SSE parsing and cache-merge logic from /E:/MoneyView/apps/web/app/corporate/page.tsx into a dedicated hook if the page keeps growing` mean?

Meaning:
- The corporate page currently owns too many DCF transport details directly:
  - opening the SSE request
  - parsing streamed `phase1` and `phase2` events
  - merging summary and assumptions into one display shape
  - writing merged results into `sessionStorage`
  - tracking stream status and error state
  - loading the explicit full report
- Right now this works, but as the page gets larger it makes the page component harder to read, harder to test, and easier to break when the transport changes.

What it is for:
- Separation of concerns:
  - `page.tsx` should mainly describe screen state, layout, and user actions.
  - a hook should own DCF transport behavior and cache policy.
- Reuse:
  - if another corporate surface or detail screen later needs the same streamed DCF summary behavior, the hook can be reused instead of copying the same effect and parsing logic.
- Easier testing:
  - the hook can be tested for `phase1`, `phase2`, `complete`, error, abort, and stale-cache behavior without rendering the whole corporate page.
- Safer refactors:
  - if the SSE event format changes, the update is localized to one hook instead of being mixed into page UI code.
- Smaller page component:
  - the current page already owns many concerns: company selection, assumptions, comparison refresh, source-data refresh, modal detail composition, and DCF full-report viewing.
  - moving DCF stream orchestration into a hook lowers local complexity.

What should move out of `apps/web/app/corporate/page.tsx`:
- `streamCorporateDcfSummary(...)`
- `mergeDcfSummary(...)`
- the DCF `useEffect` that starts the stream and handles `phase1` / `phase2` events
- `sessionStorage` read/write details for the DCF cache
- `dcfStreamResult`, `dcfStreamStatus`, `dcfStreamError`, `dcfFullReport`, `dcfFullReportLoading`
- `handleViewFullDcfReport()`

What should stay in the page:
- the active assumptions and snapshot values that decide when the user wants a refresh
- button click handlers that say `refresh DCF now`
- rendering:
  - card text
  - stale badges
  - modal open/close
  - full-report table UI

Recommended hook shape:
- file:
  - `apps/web/app/corporate/hooks/useCorporateDcfStream.ts`
- inputs:
  - `snapshot: DcfRequestSnapshot | null`
  - `refreshToken: string | null`
- outputs:
  - `data: DCFResult | null`
  - `cachedData: DCFResult | null`
  - `lastUpdatedAt: string | null`
  - `status: "idle" | "streaming" | "complete" | "error"`
  - `error: string | null`
  - `fullReport: DCFFullReport | null`
  - `fullReportLoading: boolean`
  - `requestFullReport: () => Promise<void>`
  - `clearFullReport: () => void`

Suggested implementation steps:
1. Move DCF cache helpers into a shared local utility or keep them inside the hook file.
2. Move `streamCorporateDcfSummary(...)` into the hook file.
3. Move `mergeDcfSummary(...)` into the hook file.
4. Inside the hook:
   - initialize cached snapshot/result from `sessionStorage`
   - start the SSE request when `snapshot` and `refreshToken` are both present
   - merge `phase1` and `phase2`
   - persist the merged result into the DCF cache key
   - expose derived `data` and `lastUpdatedAt`
5. Add `requestFullReport()` inside the hook:
   - call `/corporate/dcf/{ticker}/report`
   - manage loading/error state
   - store the returned `DCFFullReport`
6. Replace the page-local DCF state with the hook result.
7. Keep the page UI unchanged as much as possible during the refactor so this stays low-risk.

Suggested return contract example:

```ts
const {
  data: dcfData,
  cachedData: dcfCachedData,
  lastUpdatedAt: dcfLastUpdatedAt,
  status: dcfStatus,
  error: dcfError,
  fullReport: dcfFullReport,
  fullReportLoading,
  requestFullReport,
} = useCorporateDcfStream({
  snapshot: dcfRequestedSnapshot,
  refreshToken: dcfRefreshToken,
});
```

Then the page becomes simpler:
- instead of owning SSE parsing, the page only decides:
  - when to set `dcfRequestedSnapshot`
  - when to set `dcfRefreshToken`
  - when to open the DCF modal
  - when to call `requestFullReport()`

Practical benefit for this repo:
- The current corporate page is already large and mixes:
  - data transport
  - stale cache policy
  - modal state
  - multi-section refresh orchestration
  - heavy rendering
- That is exactly the point where a hook starts paying off. It reduces the chance that a small UI edit accidentally breaks stream handling or cached-result behavior.

Important caution:
- Do not move page-level refresh ownership into deeply nested chart components.
- The hook should stay near the page owner, not buried in a graph component.
- Good ownership split:
  - page owns refresh intent and rendering
  - hook owns DCF transport and cache mechanics

When to actually do it:
- Do it when:
  - more DCF transport states are added
  - another screen needs streamed DCF summary data
  - the page becomes harder to edit safely
  - tests around DCF behavior start feeling too page-coupled
- It is not required just for abstraction. It is useful when page complexity and transport behavior are starting to fight each other.
