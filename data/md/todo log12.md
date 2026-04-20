# Development Todo

Purpose: track the active implementation plan for performance, portfolio UX, valuation streaming, and stock-price reliability work across `apps/web` and `apps/api`.

Status snapshot: as of 2026-04-19, the next delivery slice is centered on stock-price autofill, API transport-progress visibility, and closing the remaining observability gaps around live server execution.

## Active Tracks

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses

### Local Server Log Clarity And API Log Visibility

Problem:
- The local Next.js dev server output is currently mixing framework request lines with server-action noise such as `discoverBackendPort()`, which makes the console harder to scan.
- The API already writes structured logs to `data/cache/logs/api-server.log`, but when the realtime API console is not visible there is no simple plain-text fallback surface for day-to-day debugging.
- API transport observability exists in JSON form today, but the human-readable console format does not yet guarantee short, scan-friendly summaries for route lifecycle, transport phase, and failure states.

Target outcome:
- Local development logs clearly separate `web` and `api` sources so a developer can tell which process emitted each line at a glance.
- Routine noise from `apps/web/app/actions/discovery.ts` is removed or downgraded so `discoverBackendPort()` does not clutter the Next.js server log during normal page loads.
- The API keeps structured JSON logs for persistence, while also producing concise human-readable console summaries for request start, request finish, SSE phase progress, and warnings/errors.
- When the realtime API console cannot be seen, a developer can still inspect recent API activity through a plain-text tail/read view backed by `data/cache/logs/api-server.log`.

Execution checklist:
- [ ] Audit the current local log sources across `apps/web` dev server output, `apps/api/core/logger.py`, `apps/api/core/transport_progress.py`, and `apps/web/app/actions/discovery.ts`
- [ ] Define a readable console log format for API request lifecycle lines, including source, method, path, status, elapsed time, and request id when available
- [ ] Reduce or gate routine `discoverBackendPort()` logging so the web server does not emit low-signal lines on every request in normal development
- [ ] Add an API-side plain-text log tail/read contract that exposes recent `api-server.log` lines without replacing the existing JSON file logging
- [ ] Add a lightweight web-side developer surface or documented local workflow for viewing the recent API log tail when the realtime API console is unavailable
- [ ] Verify the resulting local experience with one normal page load and one streaming DCF request, confirming the emitted text is easy to scan

Engineering notes:
- Keep log formatting ownership inside `apps/api/core`; route handlers should emit facts, not hand-build presentation strings everywhere.
- Preserve the structured JSON log file as the durable source of truth; the readable plain-text view should be derived from it, not maintained as a second independent logging pipeline.
- Avoid adding browser-only polling noise just to surface logs; prefer an explicit developer-only read/tail action or endpoint.
- Keep any web-side log viewer clearly development-scoped so it does not become a user-facing production feature by accident.

### Portfolio Allocation UX, Snapshot Controls, And Corporate Comparison Expansion

Problem:
- The current Portfolio Allocation table still assumes per-row save and delete controls, a separate saved-weight display, and percentage-only editing without an explicit investment amount model.
- The allocation workflow does not currently support range-slider adjustment, double-click manual percentage editing, automatic persistence, or a saved total investment amount that can drive money-based allocation summaries.
- The allocation workspace also lacks a fee-aware final-profit view, so projected portfolio outcome numbers can overstate results by ignoring the requested `0.2%` transaction fee.
- Saved Snapshot List review is read-only today, so stale snapshot versions cannot be cleaned up directly from the Portfolio workflow.
- The stock detail modal does not yet expose editable sector metadata and the Stock News column does not stretch to the full available modal height.
- Corporate Analysis currently leans on table-only comparison for peer review, exposes only the single-stock `View Full Report` action, and needs an explicit verification pass for synchronization with Watchlist Holdings.

Target outcome:
- Portfolio Allocation replaces row-level save and delete controls with automatic persistence, an `input[type="range"]` adjustment path, and double-click manual editing on the Allocation value itself.
- Users can enter a total investment amount, have it saved automatically, and see amount-based allocation summaries driven by that persisted value.
- Final profit in the allocation workspace reflects the requested `0.2%` transaction fee instead of showing a fee-free figure.
- Saved Snapshot List supports direct deletion of individual saved snapshot versions.
- The stock detail modal shows the stock sector, allows editing it, and lets Stock News expand to the full usable height of the modal column.
- Corporate Analysis adds visual peer-comparison tooling for similar stocks plus a bulk “calculate all reports” action instead of only the single-stock `View Full Report`.
- Corporate Analysis and Watchlist Holdings are explicitly verified for synchronization behavior so watchlist-backed comparison inputs remain trustworthy.

Preferred UX:
1. Allocation percentages can be changed with a slider for quick adjustment.
2. Double-clicking the Allocation value switches to manual numeric entry for exact percentages.
3. Allocation edits save automatically after the user stops adjusting rather than requiring per-row save buttons.
4. Total investment amount behaves like a portfolio-level preference and persists automatically.
5. Amount-based summaries make invested capital, implied cash, and fee-aware projected profit visible without extra clicks.
6. Snapshot cleanup happens directly from the Saved Snapshot List rather than forcing backend-only cleanup.
7. Similar-stock comparison in Corporate Analysis is visual first, with the current ticker clearly highlighted against peers.
8. Bulk report calculation for all compared stocks is available from the Corporate Analysis workflow itself.

Execution checklist:
- [x] Identify the current ownership points across `apps/web/app/portfolio/page.tsx`, `apps/web/app/corporate/page.tsx`, `apps/api/routes/portfolio.py`, `apps/api/routes/corporate.py`, and the related backend services/models
- [x] Add or extend backend contracts needed for persisted portfolio preferences, snapshot deletion, sector editing, and bulk corporate report calculation
- [x] Replace row-level save/delete allocation controls with slider-based auto-save allocation editing in the Portfolio table
- [x] Add double-click manual allocation editing and remove the separate Saved Weight requirement from the Portfolio table UI
- [x] Persist a portfolio-level total investment amount and wire it into amount-based allocation summaries
- [x] Calculate fee-aware final profit using the requested `0.2%` transaction fee
- [x] Add delete controls to the Saved Snapshot List and full snapshot-history modal flows
- [x] Expand Stock News to full modal height and add editable Sector handling inside the stock detail modal
- [x] Add similar-stock comparison visualizations in Corporate Analysis
- [x] Add a bulk “calculate reports for all stocks” action in Corporate Analysis
- [x] Verify Corporate Analysis and Watchlist Holdings synchronization with focused API and/or frontend coverage
- [ ] Run narrow verification for changed frontend and backend areas

Engineering notes:
- Keep watchlist ownership in the portfolio backend and avoid duplicating allocation truth in browser-only state.
- Portfolio auto-save should be debounced enough to avoid wasteful request storms while still feeling immediate.
- Similar-stock comparison visuals should reuse existing charting patterns where practical instead of introducing a second visualization stack.
- Watchlist/corporate synchronization verification should check both the company-registry path and the comparison-universe path.

Acceptance criteria:
- Portfolio allocation editing no longer requires row-level Save/Delete buttons in the Portfolio table.
- Users can adjust allocations with a range slider and double-click the Allocation value for exact manual entry.
- Total investment amount persists and drives amount-based allocation summaries.
- Fee-aware final profit is visible and reflects a `0.2%` transaction fee.
- Saved snapshot versions can be deleted from the Portfolio snapshot-review workflow.
- Stock modal shows editable sector metadata and a full-height Stock News section.
- Corporate Analysis includes a visual peer-comparison surface and a bulk all-stocks report calculation action.
- Corporate Analysis remains aligned with current Watchlist Holdings for synchronized comparison inputs.

Definition of done:
- [x] Verified allocation auto-save, slider input, and double-click manual input work together without row-level save buttons
- [x] Verified total investment amount persists across reloads
- [x] Verified projected/final profit includes the `0.2%` fee logic
- [x] Verified snapshot deletion removes the saved version from list and modal history
- [x] Verified sector edits persist and Stock News uses full modal height
- [x] Verified similar-stock visuals and bulk report calculation on Corporate Analysis
- [x] Verified Corporate Analysis reflects current Watchlist Holdings in the intended synchronized paths

Verification note:
- Targeted Playwright coverage passed on 2026-04-20 for `tests/e2e/portfolio-watchlist.spec.ts`, `tests/e2e/portfolio-snapshot-history.spec.ts`, and `tests/e2e/corporate-comparison.spec.ts`.
- Targeted backend pytest coverage for `tests/api/test_watchlist_resync.py` and `tests/api/test_corporate_comparison.py` remains blocked in this environment because `pytest` cannot create or clean its temp directories under `C:\Users\VIP\AppData\Local\Temp\pytest-of-VIP`.
- Re-run attempts on 2026-04-20 with explicit `--basetemp` and `cache_dir` under both `E:\MoneyView\.tmp\...` and `C:\Users\VIP\.codex\memories\...` still failed with `PermissionError: [WinError 5] Access is denied` during pytest temp-directory setup/cleanup, so the backend verification item cannot be marked complete from this session.








## Cross-Cutting Follow-ups

Checklist:
- [x] Update `docs/architecture/` if DCF transport, cache strategy, page-level refresh ownership, or API transport observability changes materially


## Verification Targets

Checklist:
- [x] `apps/web`: targeted component and page tests for refresh-gated loading states and portfolio allocation interactions
