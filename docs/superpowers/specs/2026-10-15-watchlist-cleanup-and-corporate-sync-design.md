# Watchlist delete cleanup and corporate table sync (design)

Oct 15, 2026. The source is `docs/architecture/database-relationships.md` §6, gaps G1 and G2. The owner approved this design in chat.

## Background

- **G1.**
  - `DELETE /portfolio/watchlist/{ticker}` (`apps/api/routes/portfolio.py:310-330`) deletes the `watchlist` row and retires the `equity_bars` subject.
  - Every other row keyed by that ticker stays: market bars, news, statements, quote facts, `acquisition_state`, `corporate_metrics` and snapshot rows.
  - The comparison registry (`apps/api/services/corporate_comparison.py:947-1016`) unions `watchlist`, `corporate_companies` and `indices`, so a removed ticker can keep appearing as a comparison candidate.
- **G2.**
  - `corporate_metrics` holds the owner's slider assumptions per ticker. The corporate page PUTs them on change: the debounced effect in `apps/web/app/corporate/page.tsx` calls `save_corporate_metrics` in `routes/corporate.py`.
  - `corporate_companies` holds companies added by hand (`POST /corporate/companies`).
  - Both are user-authored, and neither is in the records-sync registry (`KINDS` in `apps/api/services/records_sync/kinds.py`), so the second PC never receives them.

## Decisions (owner)

| # | Decision |
|---|---|
| D1 | Deleting a watchlist ticker hides it at once. Its upstream caches are deleted later, after a 30-day grace period, and only if no other table still refers to the ticker. |
| D2 | This cleanup never deletes snapshot history, decisions, valuation cases or `corporate_metrics` (the owner's assumptions). Re-adding the ticker restores its assumptions. |
| D3 | `corporate_metrics` and `corporate_companies` become records-sync kinds keyed by ticker. They are merged by the existing whole-record rule: the later edit wins. |
| D4 | Neither corporate table gets a delete feature, so no deletion travels for them. |

## 1. Hide on delete

- The comparison registry drops a ticker that is not in `watchlist`.
- The exceptions stay: tickers in `corporate_companies`, in `indices`, or among the built-in default companies (`DEFAULT_COMPANIES`, `corporate_metrics_service.py:59`). Seed and manual companies remain comparable by design.
- No other read path changes. The detail pages for a removed ticker still work from cache while the cache exists.

## 2. Deferred cleanup

### 2.1 What is cleaned

The cleanup deletes the ticker's rows in four cache tables (`CLEANUP_TABLES`):
- market bars (`stocks`);
- `news` rows attributed to the ticker;
- `corporate_quote_facts`;
- `acquisition_state` rows whose subject is the ticker, for the per-ticker data classes other than `statements`.

`corporate_statements` and the `statements` acquisition state are kept and never deleted (owner decision, 2026-10-15). Yahoo returns only a recent window of quarters and the store accumulates older ones, so a deletion would lose that history permanently.

Correction to the earlier premise that every cleaned table can be rebuilt. Bars and quote facts are re-fetched from Yahoo on demand. News for a cleaned ticker cannot be re-fetched beyond Google News' recent window, so older news for that ticker is lost once cleaned. The owner accepts this (2026-10-15).

### 2.2 When a ticker is unreferenced

A ticker is eligible only if none of these refer to it:
- `watchlist`;
- `corporate_companies`;
- `indices`;
- `DEFAULT_COMPANIES`;
- `valuation_case.ticker`;
- `investment_decision.ticker`;
- any comparison snapshot table (v3 and the legacy v1/v2);
- `corporate_metrics`.

`corporate_metrics` counts as a reference so that the owner's assumptions keep their statements available. It is never deleted itself.

`corporate_metrics` is saved on every slider change. So a ticker the owner ever adjusted keeps its caches. This is intended: the owner's assumptions stay usable. The tickers that get cleaned are the ones only viewed, never adjusted.

### 2.3 Grace period

- **Recording the removal.** When a ticker leaves the watchlist, its removal time is recorded. The store is one of these two; the plan picks one and states why:
  - a `dataset_metadata` row `cleanup_pending:<TICKER>` holding the UTC ISO timestamp;
  - a new table `cleanup_pending(ticker PRIMARY KEY, removed_at TEXT NOT NULL)`.
- **Eligibility.** A ticker becomes eligible 30 days (`CLEANUP_GRACE_DAYS = 30`) after its recorded removal time.
- **Re-adding.** Re-adding the ticker to the watchlist clears its pending record.
- **Peer removals.** When a peer's watchlist tombstone removes the ticker locally, the removal is recorded the same way. Each PC therefore cleans independently.
- **Tickers removed before this ships.** These have no record. The first cleanup run records "now" for every unreferenced ticker it finds, so nothing is deleted on the first day.

### 2.4 Running

- The cleanup runs once at API startup, and once per day on the existing scheduler.
- The startup run is skipped when `DISABLE_STARTUP_JOBS` is set, matching the existing startup jobs.
- Each deleted batch logs `cleanup.deleted ticker=… table=… rows=…`.
- A failure in one ticker or table is logged and does not stop the others or the API.
- Deletes run in one transaction per ticker.

## 3. Sync for the corporate tables

- **New kinds.** Add `corporate_metrics` and `corporate_companies` to `records_sync/kinds.py`:
  - `uid_column="ticker"`, the pattern `event_category_visibility` uses with `category_id`;
  - `columns` = every non-key column;
  - `updated_at` is the stamp the existing merge reads.
- **Merge.** Whole-record merge, later edit wins, as for the other kinds.
- **Older peers.** An older peer file without these kinds must still load. A peer file that carries them must not break an older reader; the older reader should just ignore them (memory: new sync children must be optional). The plan checks how unknown kinds are handled today and adds a test either way.
- **Applying.** `corporate_metrics` rows written by sync apply as the owner's assumptions on the receiving PC.

## 4. Tests

Each test is mutation-verified per CLAUDE.md §8.

1. A deleted watchlist ticker leaves the comparison registry at once. A manual company and a default company stay.
2. Cleanup, under a fake clock: at 29 days nothing is deleted; at 31 days the cache rows go.
3. A ticker still referenced by a valuation case, a decision, a snapshot or `corporate_metrics` is never cleaned.
4. No cleanup run touches snapshot rows, decisions, cases or `corporate_metrics`.
5. Re-adding within 30 days clears the pending record, and the caches stay.
6. The first run records pending times and deletes nothing.
7. A failure in one table does not stop the rest (inject an error).
8. Sync:
   - a `corporate_metrics` edit on PC A arrives on PC B;
   - when both PCs edited, the later edit wins;
   - the same holds for `corporate_companies`.
9. An older peer file without the new kinds loads, and the existing kinds still merge.

## Out of scope

- G3–G11 from the database document.
- Deleting rows from `corporate_companies` or `corporate_metrics`.
- Any frontend change beyond what the registry change implies.

## Order

This is backend-only and touches no frontend file. Branch from `renewal` after the design-system and corporate one-screen branches merge, or earlier on its own branch if the owner wants it sooner.
