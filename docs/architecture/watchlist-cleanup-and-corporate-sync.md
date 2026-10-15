# Watchlist cleanup and corporate sync

Status: shipped on `feat/watchlist-cleanup-corporate-sync` (2026-10-15). Plan:
`docs/superpowers/plans/2026-10-15-watchlist-cleanup-and-corporate-sync.md`. Resolves DB gaps G1 and G2.

This is an addendum. `docs/architecture/database-relationships.md` lives on `feat/design-system-paper`
and is not on this branch. After both branches merge it must be updated as listed under "Edits owed".

## `cleanup_pending` (new table, 27th)

| Column | Meaning |
| --- | --- |
| `ticker` (PK) | Ticker that left the watchlist |
| `removed_at` | UTC ISO time it left |

Class: book. Rebuildable (a missing row is recorded as "now" by the next run). Not synced: each PC cleans
on its own. Owner: `apps/api/services/watchlist_cleanup.py`.
Writers: `record_pending` from the watchlist delete route, the import, and watchlist-sync apply;
`clear_pending` from every add path; the cleanup run.

## Cleanup run and grace period

- A ticker is deleted from the five cache tables (`stocks`, `news`, `corporate_statements`,
  `corporate_quote_facts`, `acquisition_state` per-ticker classes) `CLEANUP_GRACE_DAYS` = 30 days after
  `removed_at`. Nothing else is ever deleted (`CLEANUP_TABLES`).
- One transaction per ticker, one savepoint per table. A failed table is rolled back and logged; the ticker
  stays pending for a retry. A bad or naive `removed_at` skips that ticker and restarts its clock.
- Runs at startup (gated by the existing startup-jobs gate) and once a day (`CLEANUP_INTERVAL_SECONDS`).
- Re-adding a ticker inside the grace period clears its pending row; nothing is lost.
- `list_companies` no longer loops over the seed file, so a deleted ticker leaves the company list at once.

## Reference list (a referenced ticker is never cleaned)

`watchlist_cleanup._REFERENCE_QUERIES`: `watchlist`, `corporate_companies`, `corporate_metrics`, `indices`,
`valuation_case`, `investment_decision`, `corporate_comparison_snapshots` (v1, v2, v3, incl. benchmark
ticker), plus `DEFAULT_COMPANIES`. A failing reference query aborts the run: it deletes nothing.
Market-wide news (NULL or empty ticker) is never a candidate.

## New records-sync kinds

`KIND_CORPORATE_METRICS` and `KIND_CORPORATE_COMPANIES` in `records_sync/kinds.py`, both
`uid_column=ticker`, never deleted (no tombstones). First-sync stamp comes from `updated_at`; an untouched
`add_company` default metrics row is stamped as a seed so it never outranks a real adjustment.
Write paths: `PUT /corporate/metrics/{ticker}`, `POST /corporate/companies`, each then runs records sync.
New logical references: `record_sync(kind, uid)` -> `corporate_metrics.ticker` / `corporate_companies.ticker`;
`cleanup_pending.ticker` -> rows of that ticker in the five cache tables (deferred deletion).

## Rollout

1. Update BOTH PCs the same day, before either runs with sync on.
2. An older reader skips the whole peer records file that carries the new kinds (unknown kind -> file
   rejected), so the other records (cases, decisions, events, settings) also stop syncing from that PC
   until it is updated.
3. Nothing is deleted for 30 days after the update (first run records existing orphans as "now").
4. The first sync merges the newest by `record_sync` stamp; pre-existing rows are ordered by `updated_at`.

## Edits owed to database-relationships.md after both branches merge

- Header: 26 -> 27 tables. Add section 2.9 "Cleanup Bookkeeping" with `cleanup_pending`.
- Section 2.4: `corporate_metrics` and `corporate_companies` become synced (`uid_column=ticker`, never deleted).
- Logical references: 22 -> 25 (L23, L24, L25 above).
- Writers table: corporate rows add records-sync apply; add a `cleanup_pending` row; the cache-table rows add
  "deleted by the watchlist cleanup" (not `indices`).
- Section 5 watchlist delete bullet: records `cleanup_pending`, 30-day deletion.
- Section 6: G1 and G2 resolved 2026-10-15. Correction to G1: the registry never kept a removed ticker; the
  leak was `list_companies`' seed-file loop, now removed.
