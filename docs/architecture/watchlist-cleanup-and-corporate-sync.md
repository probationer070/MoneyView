# Watchlist cleanup and corporate sync

Status: on `feat/watchlist-cleanup-corporate-sync` (2026-10-15). Plan:
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

## What is cleaned, and what is kept

`watchlist_cleanup.CLEANUP_TABLES` lists four tables. A ticker's rows in them are deleted:

- `stocks` (daily bars);
- `news` rows attributed to the ticker (market-wide news with a NULL or empty ticker is never touched);
- `corporate_quote_facts`;
- `acquisition_state` rows for the ticker, for the per-ticker data classes except `statements`.

Kept, never deleted:

- `corporate_statements` and the `statements` acquisition state (`KEPT_DATA_CLASSES`). Yahoo returns only a
  recent window of quarters, and the store accumulates older ones. Deleting them would lose that history
  permanently, so the owner decided on 2026-10-15 that they are not cleaned.
- `corporate_metrics`, `corporate_companies`, snapshots, decisions, valuation cases, `indices`, and the
  `watchlist` and `watchlist_removed` rows.

Not every cleaned table can be rebuilt. Bars and quote facts are re-fetched from Yahoo on demand. News for a
cleaned ticker cannot be re-fetched beyond Google News' recent window, so older news for that ticker is
lost once cleaned. The owner accepts this.

## Cleanup run and grace period

- A ticker's cleaned rows are deleted `CLEANUP_GRACE_DAYS` = 30 days after `removed_at`, and only if no
  reference names the ticker (see the reference list below).
- One transaction per ticker, one savepoint per table. A failed table is rolled back and logged; the ticker
  stays pending for a retry. A bad or naive `removed_at` skips that ticker and restarts its clock.
- Runs at startup (gated by the existing startup-jobs gate) and once a day (`CLEANUP_INTERVAL_SECONDS`).
- Re-adding a ticker inside the grace period clears its pending row. Nothing has been deleted yet, so its
  caches are all still there.
- `list_companies` no longer loops over the seed file, so a deleted ticker leaves the company list at once.

## Reference list (a referenced ticker is never cleaned)

`watchlist_cleanup._REFERENCE_QUERIES`: `watchlist`, `corporate_companies`, `corporate_metrics`, `indices`,
`valuation_case`, `investment_decision`, `corporate_comparison_snapshots` (v1, v2, v3, incl. benchmark
ticker), plus `DEFAULT_COMPANIES`. A failing reference query aborts the run: it deletes nothing.

## New records-sync kinds

`KIND_CORPORATE_METRICS` and `KIND_CORPORATE_COMPANIES` in `records_sync/kinds.py`, both
`uid_column=ticker`, never deleted (no tombstones). First-sync stamp comes from `updated_at`; an untouched
`add_company` default metrics row is stamped as a seed so it never outranks a real adjustment.
Write paths: `PUT /corporate/metrics/{ticker}`, `POST /corporate/companies`, each then runs records sync.
New logical references: `record_sync(kind, uid)` -> `corporate_metrics.ticker` / `corporate_companies.ticker`;
`cleanup_pending.ticker` -> rows of that ticker in the four cleaned tables (deferred deletion).

## Rollout

Do this in one sitting for the two PCs.

1. Close MoneyView on both PCs.
2. Update PC 1, start it, and check Corporate.
3. Update PC 2 the same day.
4. Check the sync status on each PC: neither should report a skipped peer file with "unknown kind".
5. A ticker adjusted on both PCs keeps the later adjustment, so note any values you care about first.
6. Nothing is deleted for 30 days. The first run records existing orphans as "now".

Until both PCs are updated, use only the updated one. A record changed on both PCs during the gap keeps the
later change, and the other change is overwritten. An older PC skips the whole peer records file that
carries the new kinds, so cases, decisions, events and settings from the updated PC also stop reaching it
until it is updated.

## Expected merge conflicts with `feat/macro-signal-engine` (PR #67)

PR #67 touches the same two files. Expected conflicts and how to resolve them:

- `db.py`: keep the `cleanup_pending` CREATE from this branch, then close the schema string with
  `""" + _SIGNAL_SCHEMA_SQL`. In `_ensure_schema_compatibility`, keep both blocks.
- `main.py` lifespan: `signal_cycle` stays inside `if not startup_jobs_disabled:`. The
  `watchlist_cleanup_cycle` append stays outside that block, after the startup syncs.

## Edits owed to database-relationships.md after both branches merge

- Header: 26 -> 27 tables. Add section 2.9 "Cleanup Bookkeeping" with `cleanup_pending`.
- Section 2.4: `corporate_metrics` and `corporate_companies` become synced (`uid_column=ticker`, never deleted).
- Logical references: 22 -> 25 (L23, L24, L25 above).
- Writers table: corporate rows add records-sync apply; add a `cleanup_pending` row; the four cleaned tables
  add "deleted by the watchlist cleanup" (not `indices`, and not `corporate_statements`).
- Section 5 watchlist delete bullet: records `cleanup_pending`, 30-day deletion of the four cleaned tables.
- Section 6: G1 and G2 resolved 2026-10-15. Correction to G1: the registry never kept a removed ticker; the
  leak was `list_companies`' seed-file loop, now removed. `corporate_statements` is kept, not cleaned.
