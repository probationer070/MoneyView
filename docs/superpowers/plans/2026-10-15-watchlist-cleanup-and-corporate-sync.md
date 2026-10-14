# Watchlist Cleanup and Corporate Table Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ticker removed from the watchlist drops out of the corporate company list at once, and its rebuildable upstream caches are deleted 30 days later if nothing still refers to it. `corporate_metrics` and `corporate_companies` travel between the two PCs through records sync, and the later edit wins.

**Architecture:** Backend only.
- A new module, `apps/api/services/watchlist_cleanup.py`, owns a new table `cleanup_pending(ticker, removed_at)`. It exposes `record_pending`/`clear_pending` for the watchlist write paths, and `run_cleanup(now)`. The run prunes and backfills pending records, then deletes due tickers' cache rows in one transaction per ticker, with one savepoint per table.
- Every path that removes a watchlist row records a pending time, and every path that adds one clears it. The paths are the delete route, the import, the peer apply and the seed paths. The FastAPI lifespan runs the cleanup once at startup (unless `MONEYVIEW_DISABLE_STARTUP_JOBS` is set) and then once a day in an asyncio loop.
- `records_sync/kinds.py` gains two natural-identity kinds keyed by `ticker`. The write paths `save_metrics` and `add_company` stamp `record_sync`, and their routes trigger `run_records_sync("mutation")`. First sync derives each pre-existing row's stamp from its own `updated_at`, so the later edit wins from day one.

**Tech Stack:** Python 3.11, FastAPI, SQLite (`sqlite3` through `apps/api/services/db.py`), pytest 8 with `fastapi.testclient.TestClient`. No frontend, no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-15-watchlist-cleanup-and-corporate-sync-design.md`. The owner approved it. Read it together with this plan. Where they differ, the "Narrowed or interpreted" table below names the difference and the reason.

---

## Verified facts this plan rests on (file:line on `renewal` @ `0d32d33`; `apps/api` is identical on `feat/corporate-one-screen`)

**Cleanup tables (spec §2.1), pinned:**

| Table | Schema | Ticker column, case, format | Delete clause |
|---|---|---|---|
| `stocks` | `apps/api/services/db.py:234-247` | `ticker`, upper-case. `market_data.py:1047-1110` writes it under the caller's ticker, and every caller upper-cases first (`market_data.py:342,626,643,673`). An index ticker goes to `indices`, not here (`market_data.py:1047`). | `ticker = ?` |
| `news` | `db.py:273-284` | `ticker`, **nullable**. Upper-case through `acquisition/store.py:83-87` (`save_news` upper-cases) and `news_service.py:240` (`crawl_stock_and_save`). `crawl_and_save(query, ticker=None)` (`news_service.py:197-219`) stores **NULL** for market-wide items. | `ticker = ?`. NULL and `''` rows are never candidates (Narrowed N5). |
| `corporate_statements` | `db.py:467-476` | `ticker`, upper-case (`acquisition/store.py:37`) | `ticker = ?` |
| `corporate_quote_facts` | `db.py:485-497` (plus ALTERs `db.py:890-898`) | `ticker` PK, upper-case (`acquisition/store.py:52`) | `ticker = ?` |
| `acquisition_state` | `db.py:452-462` | `subject`, upper-cased by `state._normalize_subject` (`acquisition/state.py:53-60`). `data_class` is one of `REGISTRY` (`acquisition/registry.py:38-83`). | `subject = ? AND data_class IN (<per-ticker classes>)`. The classes are derived from `REGISTRY` (`Scope.PER_TICKER`: `equity_bars`, `statements`, `market_cap`, `news`). `index_bars` is `Scope.GLOBAL` and is never touched. |

**Reference list (spec §2.2), pinned.** A ticker referred to by any of these is never cleaned. Comparison is on `UPPER(TRIM(value))`.

| Reference | Schema / source |
|---|---|
| `watchlist.ticker` | `db.py:290-299` |
| `corporate_companies.ticker` | `db.py:335-341` |
| `corporate_metrics.ticker` | `db.py:318-333` |
| `indices.ticker` | `db.py:218-231` |
| `DEFAULT_COMPANIES` keys | `apps/api/services/corporate_metrics_service.py:59-75` |
| `valuation_case.ticker` (nullable) | `db.py:507-529` |
| `investment_decision.ticker` | `db.py:532-558` |
| `corporate_comparison_snapshots.ticker` (v1) | `db.py:350-373` |
| `corporate_comparison_snapshots_v2.ticker` and `.benchmark_ticker` | `db.py:377-404` |
| `corporate_comparison_snapshots_v3.ticker` and `.benchmark_ticker` | `db.py:408-443` |

**Claims from `database-relationships.md` and the spec, checked against code:**
- The comparison registry `load_company_universe_data` (`corporate_comparison.py:947-1014`) is built fresh from `DEFAULT_COMPANIES` + `watchlist` + `corporate_companies` on every call. `indices` contributes **names only** (`index_names`, `:966-968,1011-1013`), not registry entries. A deleted watchlist ticker therefore **already** leaves the registry at once. The leak is elsewhere: `list_companies` (`corporate_metrics_service.py:303-354`, served by `GET /corporate/companies`) also lists every ticker in the **seed file** (`:314-322`, `source="portfolio"`). When the seed file is empty, `load_watchlist_seed` falls back to `_build_watchlist_items_from_db` (`watchlist_seed.py:244-285`), and that fallback includes **every `corporate_metrics` ticker**. See Narrowed N1.
- **The records-sync merge does not read the table's `updated_at`.** It reads `record_sync.updated_at/updated_by` (`records_sync/store.py:145-157`, `merge.py:108-114`), which `store.stamp` sets (`store.py:365-370`). The table's `updated_at` is only payload. Both corporate write paths set it to `datetime.now(timezone.utc).isoformat()`, so the format is `YYYY-MM-DDTHH:MM:SS.ffffff+00:00`: `add_company` writes one `now` into both tables (`corporate_metrics_service.py:365,395`), and `save_metrics` writes its own (`:471`). Neither writes `record_sync`. See Narrowed N3.
- `uid_column="ticker"` works with the existing merge: `_local_rows`, `_locator`, `_write_record` and `uid_of` (`store.py:33-64,224-248,380-391`) handle a natural-identity kind the way they handle `event_category` (`id`) and `event_category_visibility` (`category_id`). `files._check_payload` (`files.py:266-270`) requires `payload["ticker"] == uid`, and `test_kinds.py:57-62` requires the identity column to be in `columns`.
- **Older peer file → newer reader:** loads. `_parse` (`files.py:273-320`) iterates only the kinds present.
- **Newer peer file → older reader: the older reader skips the whole file.** It does not crash. `_parse` raises `ValueError("unknown kind 'corporate_metrics'")` (`files.py:283-285`). `read_peer_files` reports that file as skipped (`files.py:333-337`) and drops **every** record in it, cases, decisions, events and preferences included. `tests/api/records_sync/test_files.py` `test_an_unknown_kind_is_skipped_and_reported` pins this today. See Rollout notes.
- **There is no scheduler.** The only background loops are `wal_flush_cycle` (`apps/api/main.py:78-86`) and `stock_prewarm_cycle` (`:89-96`), started in `lifespan` (`:99-153`). The startup gate is `MONEYVIEW_DISABLE_STARTUP_JOBS` (`main.py:125-127`), and `tests/conftest.py` sets it for the whole session. See Narrowed N4.
- `PRAGMA user_version` is never set. Migration is `CREATE TABLE IF NOT EXISTS` in `_CREATE_SCHEMA_SQL`, which `init_db` runs on every start (`db.py:666-683`), plus additive steps in `_ensure_schema_compatibility` (`db.py:685-1001`).
- **Pre-existing, not fixed here:** `init_db`'s legacy fallback (`db.py:672-676`) crashes with `no such table: corporate_quote_facts` (`db.py:892`) on a database old enough to take that path. Reproduced in a scratch database on 2026-10-14. The compat copy of the new `CREATE TABLE` (Task 1) follows the `industry_benchmark` pattern anyway.

**Watchlist write paths (grep of `INTO watchlist` / `DELETE FROM watchlist` in `apps/` and `scripts/`):**

| # | Path | Effect | Hook (task) |
|---|---|---|---|
| P1 | `routes/portfolio.py:309-330` `DELETE /watchlist/{ticker}` | removes | `record_pending` (Task 3) |
| P2 | `routes/portfolio.py:178-226` `POST /watchlist` (upsert, also the add route) | adds or edits | `clear_pending` (Task 3) |
| P3 | `routes/portfolio.py:236-266` `POST /watchlist/{ticker}/group` | `UPDATE` only, never adds | none needed |
| P4 | `watchlist_seed.py:59-81` `bootstrap_from_seed` (first run, and the sync bootstrap at `watchlist_sync/service.py:67`) | adds | `clear_pending` per inserted row (Task 3) |
| P5 | `watchlist_seed.py:84-125` `merge_missing_watchlist_items` (on every `GET /watchlist` while sync is off, `portfolio.py:65-69`) | adds | `clear_pending` per inserted row (Task 3) |
| P6 | `watchlist_seed.py:134-162` `resync_watchlist_from_json` (`POST /watchlist/resync`, "the import") | removes all, then adds | `record_pending` for dropped tickers, `clear_pending` for imported ones (Task 3) |
| P7 | `watchlist_sync/store.py:73-96` `apply_state`: delete (`:76-77`, a peer tombstone) and insert (`:78-88`, a peer upsert) | removes or adds | `record_pending` on delete, `clear_pending` on a newly arriving row (Task 3) |
| P8 | `scripts/migrate_data.py:216`, `scripts/benchmark_api.py:72` | adds (offline scripts) | not hooked. Each cleanup run prunes the pending row of any referenced ticker (Task 2), which covers them. |

---

## Narrowed or interpreted (owner-visible)

| # | Spec says | This plan does | Why |
|---|---|---|---|
| N1 | §1 "The comparison registry drops a ticker that is not in `watchlist`" | **No change to `load_company_universe_data`.** It already does this, and Task 5 pins it with a test. The one change is in `list_companies`, which stops listing seed-file tickers directly. Seed tickers still appear through the watchlist they are bootstrapped into, one line earlier (`seed_watchlist_from_json_if_empty`). | The registry is rebuilt from `watchlist` on every call (verified above). The leak is the seed loop in `list_companies`. While sync is on, a deleted seed ticker stays deleted but stays listed. With an empty seed file, the loop lists every `corporate_metrics` ticker. The stored snapshot read path (`mode="snapshot"`) still shows a removed ticker until the next refresh. §1 says "No other read path changes", and D2 protects snapshot history. |
| N2 | §3 "`columns` = every non-key column" | `columns` = **`ticker` plus** every non-key column. | A natural-identity kind must carry its identity column in the payload (`kinds.py:46-51`), and `test_kinds.py:57-62` enforces that. |
| N3 | §3 "`updated_at` is the stamp the existing merge reads" | The merge reads `record_sync.updated_at`. So (a) `save_metrics` and `add_company` call `records_sync_store.stamp` for every owner edit. (b) `ensure_first_sync` stamps a pre-existing row from its own `updated_at`, as `portfolio_preferences` already does (`store.py:67-78`). (c) The default metrics row that `add_company` inserts on its own is stamped `SEED_TS` (new `store.stamp_seed`). At first sync, a metrics row whose `updated_at` equals its company's `updated_at` (written together by `add_company`, never adjusted since) is also stamped `SEED_TS`. | Without (a), an edit keeps the stamp it arrived with, and a peer's older value can win. Without (b), first sync decides by `pc_id` order, not recency. Without (c), adding a company on the PC that has not yet received the other PC's adjustment of that ticker would overwrite the adjustment with defaults, because the default row is "later". |
| N4 | §2.4 "once per day on the existing scheduler" | A new asyncio loop in `lifespan`, beside `wal_flush_cycle`. It runs once at start (skipped when the gate is set), then sleeps `CLEANUP_INTERVAL_SECONDS = 86400` between runs. The daily loop runs even when the gate is set. Each run is in `asyncio.to_thread` and never raises. | No scheduler exists (verified above). The spec gates only the startup run. Under pytest the gated loop just sleeps until the task is cancelled. |
| N5 | §2.1 "`news` rows attributed to the ticker" | Only rows whose `news.ticker` equals the ticker. Rows with NULL or `''` ticker (market-wide items) are never candidates and never deleted. | Attribution for those rows is ambiguous. The brief said to exclude them. |
| N6 | §2.1 "`acquisition_state` rows whose subject is the ticker" | Only rows with a per-ticker `data_class`. `index_bars` rows are never touched. | `index_bars` is `Scope.GLOBAL`. Its bars live in `indices`, which is a reference, not a cleanup target. |
| N7 | §2.2 "any comparison snapshot table" | `benchmark_ticker` of v2 and v3 counts as a reference too, in addition to `ticker`. | It names a ticker the snapshot depends on. Counting it makes the cleanup more conservative. |
| N8 | §2.3 "The first cleanup run records 'now' for every unreferenced ticker it finds" | **Every** run records "now" for any unreferenced cache ticker that has no pending row, and drops the pending row of any ticker that is referenced again. | This makes the run correct even for paths that are not hooked (P8, any future writer). A missed hook can only delay a cleanup, never cause a wrong delete. |
| N9 | §2.4 "Deletes run in one transaction per ticker" and "a failure in one ticker or table … does not stop the others" | One `BEGIN IMMEDIATE` transaction per ticker, with one `SAVEPOINT` per table. A failed table is rolled back to its savepoint and logged, and the other tables still commit. The ticker's pending row is **kept** when any table failed, so the next run retries. Reference queries are **not** caught: if one fails, the run raises before deleting anything, and `run_cleanup_logged` logs it. | The two requirements are compatible only with savepoints. Proceeding without knowing every reference could delete caches a reference still needs. |

---

## Global Constraints

- **Where to work.** The main checkout holds uncommitted frontend work on `feat/corporate-one-screen`. Do not switch branches in it. Create an isolated worktree from `renewal`:
  `git -C /c/Learn/Economy/MoneyView worktree add /c/Learn/Economy/MoneyView-cleanup -b feat/watchlist-cleanup-corporate-sync renewal`
  Run every command below from `/c/Learn/Economy/MoneyView-cleanup`, in Git Bash.
- **Backend only.** No file under `apps/web/`, `packages/` or `scripts/` changes. The independent frontend branches are not touched.
- Use `python`, never `python3`. Tests run as `python -m pytest <path> -q` from the worktree root (`pyproject.toml` sets `testpaths = ["tests"]`; `tests/conftest.py` isolates the database per test, forbids network, unsets `MONEYVIEW_SYNC_DIR` and sets `MONEYVIEW_DISABLE_STARTUP_JOBS=1`).
- **Baseline.** Task 1 Step 1 records the full-suite baseline. `guideline/sop/todo.md` notes 16 environmental failures (`exchange_calendars` is not installed). Any failure that is **not** in the baseline is yours.
- `CLEANUP_GRACE_DAYS = 30` and `CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60` live in `apps/api/services/watchlist_cleanup.py`. Tests derive day counts from `CLEANUP_GRACE_DAYS` and never hard-code 30.
- Timestamps in `cleanup_pending.removed_at` are `datetime.isoformat()` of an aware UTC moment, the same convention `acquisition_state` uses.
- The log format is `cleanup.deleted ticker=%s table=%s rows=%d`, and failures are logged as `cleanup.failed ticker=%s table=%s error=%s`. Log only tickers, table names, counts and SQLite error text. Never log a payload, a path under `config/`, or an environment value.
- **Never** delete from `watchlist`, `watchlist_removed`, `corporate_metrics`, `corporate_companies`, `valuation_case` (or its children), `investment_decision`, any snapshot table, `record_sync`, `dataset_metadata` or `indices` in cleanup code. `CLEANUP_TABLES` lists exactly the five tables pinned above.
- SQL takes the ticker only as a bound parameter (`?`). Table names and clauses come from module constants, never from input.
- **Existing tests.** No existing test is edited (inventory below: 0 rows). If any existing test fails, stop and report it. Do not edit it.
- **CLAUDE.md §8, mutation procedure.** Every new test is shown failing against the mutation named in its task's matrix. Procedure, after the task's tests pass:
  ```bash
  bak=$(mktemp -d); cp -p <file> "$bak"/
  # apply ONE mutation with Edit: the exact old -> new text from the matrix
  python -m pytest <test node id> -q        # must FAIL, and the message must contain the named fragment
  cp -p "$bak"/<basename> <file>; cmp "$bak"/<basename> <file>   # cmp must print nothing
  ```
  Restore by copying the bytes back. **Never** use `git checkout`, `git restore`, `git stash` or `--no-verify`. Never read `config/.env`. After the matrix, run `git diff --ignore-cr-at-eol --stat`: it must list only the files the task names.
- **Commits.** Stage files by name (`git add <paths>`), never `git add -A`. Every commit message ends with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **ERROR-LOG.md.** No entry is planned: the change closes documented gaps G1 and G2 and fixes no reproduced incident. If a reviewer asks for one, append it at the very end of the file only. If it conflicts on merge, keep both sides.
- SOPs consulted: `guideline/sop/architect.md`, `planner.md`, `file-structure.md` (new code goes under `apps/api/services`; routes stay thin), `test-verification.md`, `security-reviewer.md` (SQL is parameterised; logs carry no secrets), `code-reviewer.md` (final gate, Task 8).

## Review Focus

These are the five failure modes most likely to bite the owner that no spec test exercises. Each line names the test that pins it.

1. **A reference whose ticker is stored in another case** (`valuation_case.ticker = 'zzl'` while the caches use `ZZL`). The caches must stay. Task 2: `test_a_reference_in_another_case_still_protects_the_ticker`.
2. **A removal exactly `CLEANUP_GRACE_DAYS` old.** It is due (≥, not >). Task 2: `test_a_removal_exactly_the_grace_period_old_is_due`.
3. **A ticker re-added after the run built its due list, but before its delete transaction.** Its caches must stay. Task 2: `test_a_ticker_re_added_before_its_delete_transaction_keeps_its_caches`.
4. **Adding a company on a PC that has not yet received the other PC's adjustment of that ticker** (and the same situation at first sync, before this ships). The adjustment must survive. Task 6: `test_first_sync_ranks_an_add_company_default_below_a_real_adjustment`. Task 7: `test_adding_a_company_never_overwrites_assumptions_saved_on_another_pc`.
5. **A reference query that fails** (a missing or renamed table). The run deletes nothing, and the API is unaffected. Task 2: `test_a_failing_reference_query_deletes_nothing`.

## Existing-test change inventory (owner approval)

**0 rows.** No existing test's expectation changes. These existing tests touch changed code and are expected to stay green. Each task's gate runs them:
- `tests/api/test_watchlist_resync.py::test_corporate_companies_includes_all_stock_targets_json_entries`. With an empty watchlist, `list_companies` bootstraps IONQ and RGTI into `watchlist` first, so they are still listed, as `source="portfolio"`.
- `tests/api/test_watchlist_resync.py::test_watchlist_resync_updates_corporate_companies_source_from_portfolio`. XOM is on the watchlist after the resync.
- `tests/api/records_sync/test_kinds.py` (all six). These check every kind against the live schema, so they now also check the two new kinds.
- `tests/api/test_startup_jobs_gate.py` (all). These patch only `stock_prewarm_cycle`. The new cleanup cycle never appends to their `started` list. With the gate cleared, the real `run_cleanup_logged` runs once on the per-test database and never raises.
- `tests/api/records_sync/test_files.py::test_an_unknown_kind_is_skipped_and_reported`. Unchanged; it is the reason for the rollout order.

If any of these fails, stop and report. Do not edit it.

## Rollout notes (two PCs)

1. **Update both PCs in the same session, before either one runs the new API with sync on.** The first sync on an updated PC publishes `corporate_metrics`/`corporate_companies` records in its `records.<pc_id>.json`. An older PC skips **that whole file** (`unknown kind 'corporate_metrics'`), including that PC's cases, decisions, events and preferences, until it is updated too. Nothing is lost: once the older PC updates, it reads the file and merges as usual. The older PC's own file still reaches the updated PC. Watchlist sync is a separate file and is unaffected. `test_an_older_reader_skips_a_whole_file_that_carries_the_new_kinds` (Task 6) pins this behaviour.
2. **The first sync after updating merges both PCs' corporate rows.** Each ticker's row is decided by its own `updated_at` (N3). Expect tickers adjusted only on the other PC to appear in Corporate with that PC's assumptions.
3. **The cleanup is per PC.** It records pending times locally, so each PC deletes its own caches 30 days after it sees a removal. Nothing is deleted on either PC during the first 30 days after the update.
4. **`PUT /corporate/metrics/{ticker}` now runs a records sync after each save.** It is debounced on the page and does the same work as the existing `PUT /portfolio/preferences`: one local file write per save.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/api/services/db.py` (modify) | `cleanup_pending` table in `_CREATE_SCHEMA_SQL` and `_ensure_schema_compatibility` | 1 |
| `apps/api/services/watchlist_cleanup.py` (create) | Pending store (`record_pending`, `clear_pending`), references, candidates, `run_cleanup`, `delete_ticker_caches`, `run_cleanup_logged` | 1, 2 |
| `apps/api/routes/portfolio.py` (modify) | Hooks P1, P2 | 3 |
| `apps/api/services/watchlist_seed.py` (modify) | Hooks P4, P5, P6 | 3 |
| `apps/api/services/watchlist_sync/store.py` (modify) | Hook P7 | 3 |
| `apps/api/main.py` (modify) | `watchlist_cleanup_cycle` started in `lifespan` | 4 |
| `apps/api/services/corporate_metrics_service.py` (modify) | `list_companies` drops the seed loop (5). `save_metrics` and `add_company` stamp records sync (7). | 5, 7 |
| `apps/api/services/records_sync/kinds.py` (modify) | Two new kinds | 6 |
| `apps/api/services/records_sync/store.py` (modify) | First-sync stamp from `updated_at`; `stamp_seed` | 6 |
| `apps/api/routes/corporate.py` (modify) | `run_records_sync("mutation")` after PUT metrics and POST companies | 7 |
| `tests/api/test_watchlist_cleanup_pending.py` (create) | Task 1 tests | 1 |
| `tests/api/test_watchlist_cleanup_run.py` (create) | Spec §4.2, 4.3, 4.4, 4.6, 4.7, plus Review Focus 1, 2, 3, 5 | 2 |
| `tests/api/test_watchlist_cleanup_hooks.py` (create) | Spec §4.5, plus every hook path | 3 |
| `tests/api/test_watchlist_cleanup_schedule.py` (create) | Startup and daily runs, gate | 4 |
| `tests/api/test_corporate_registry_hides_removed.py` (create) | Spec §4.1 | 5 |
| `tests/api/records_sync/test_corporate_kinds.py` (create) | Spec §4.8 (store level), §4.9, rollout characterisation, Review Focus 4 (first sync) | 6 |
| `tests/api/test_corporate_records_sync.py` (create) | Spec §4.8 through the real write paths, applying, route wiring, Review Focus 4 | 7 |
| `docs/architecture/database-relationships.md`, `guideline/sop/todo.md` (modify) | Documentation in the same branch (§7 of that doc requires it) | 8 |

No Playwright spec is added. The only UI effect is the company list (`GET /corporate/companies`), and Task 5 asserts it at the API.

---

### Task 1: Worktree, baseline, and the pending store

**Files:**
- Modify: `apps/api/services/db.py` (end of `_CREATE_SCHEMA_SQL`, the `record_sync` block at `:652-663`; end of `_ensure_schema_compatibility`, after the `industry_benchmark` ALTER loop at `:996-1001`)
- Create: `apps/api/services/watchlist_cleanup.py`
- Test: `tests/api/test_watchlist_cleanup_pending.py`

**Interfaces:**
- Consumes: `apps.api.services.db.get_db`, `init_db`.
- Produces:
  - table `cleanup_pending(ticker TEXT PRIMARY KEY, removed_at TEXT NOT NULL)`;
  - `watchlist_cleanup.CLEANUP_GRACE_DAYS: int = 30`;
  - `watchlist_cleanup.CLEANUP_INTERVAL_SECONDS: int = 86400`;
  - `watchlist_cleanup.record_pending(conn: sqlite3.Connection, ticker: str, now: datetime | None = None) -> None` (upsert; a second removal restarts the clock);
  - `watchlist_cleanup.clear_pending(conn: sqlite3.Connection, ticker: str) -> None`.

  Both upper-case and strip the ticker.

- [ ] **Step 1: Create the worktree and record the baseline**

```bash
git -C /c/Learn/Economy/MoneyView worktree add /c/Learn/Economy/MoneyView-cleanup -b feat/watchlist-cleanup-corporate-sync renewal
cd /c/Learn/Economy/MoneyView-cleanup
mkdir -p data/cache
python -m pytest -q -rf 2>&1 | grep -E "^FAILED|^ERROR|passed|failed" > data/cache/cleanup-baseline.txt; cat data/cache/cleanup-baseline.txt
```
Expected: the summary line shows only the known environmental failures (about 16, `exchange_calendars`). Keep the list of failing node ids. Later tasks compare against it.

- [ ] **Step 2: Write the failing tests**

Create `tests/api/test_watchlist_cleanup_pending.py`:

```python
"""The pending-removal store (spec 2026-10-15 §2.3): one row per ticker that left the watchlist,
holding when it left. The per-test database comes from tests/conftest.py's autouse _isolated_db.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apps.api.services import db as db_service
from apps.api.services import watchlist_cleanup
from apps.api.services.db import get_db

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


def pending() -> dict[str, str]:
    with get_db() as conn:
        return {r["ticker"]: r["removed_at"] for r in conn.execute("SELECT ticker, removed_at FROM cleanup_pending")}


def test_init_db_creates_the_pending_table():
    with get_db() as conn:
        columns = {r["name"]: r for r in conn.execute("PRAGMA table_info(cleanup_pending)")}
    assert set(columns) == {"ticker", "removed_at"}, f"cleanup_pending is missing or wrong: {sorted(columns)}"
    assert columns["ticker"]["pk"] == 1
    assert columns["removed_at"]["notnull"] == 1


def test_an_existing_database_without_the_table_gains_it_on_init():
    with get_db() as conn:
        conn.execute("DROP TABLE cleanup_pending")
    db_service.init_db()
    with get_db() as conn:
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "cleanup_pending" in tables, "init_db did not add cleanup_pending to an existing database"


def test_a_second_removal_restarts_the_clock_and_the_ticker_is_normalised():
    second = T0 + timedelta(days=20)
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, " zza ", now=T0)
        watchlist_cleanup.record_pending(conn, "ZZA", now=second)
    assert pending() == {"ZZA": second.isoformat()}, "the later removal must replace the earlier one"


def test_clear_pending_removes_only_that_ticker():
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, "ZZA", now=T0)
        watchlist_cleanup.record_pending(conn, "ZZB", now=T0)
        watchlist_cleanup.clear_pending(conn, "zza")
    assert pending() == {"ZZB": T0.isoformat()}


def test_record_pending_without_a_clock_uses_utc_now():
    before = datetime.now(timezone.utc)
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, "ZZA")
    after = datetime.now(timezone.utc)
    recorded = datetime.fromisoformat(pending()["ZZA"])
    assert before <= recorded <= after and recorded.utcoffset() == timedelta(0)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_watchlist_cleanup_pending.py -q`
Expected: FAIL with `ImportError: cannot import name 'watchlist_cleanup'`.

- [ ] **Step 4: Add the table to the schema**

In `apps/api/services/db.py`, replace the end of `_CREATE_SCHEMA_SQL`:

```python
    removed_by TEXT,
    PRIMARY KEY (kind, uid)
);
"""
```
with:
```python
    removed_by TEXT,
    PRIMARY KEY (kind, uid)
);

-- Deferred watchlist cache cleanup (spec 2026-10-15 §2.3): a ticker that left the watchlist, and
-- when. Its upstream caches are deleted CLEANUP_GRACE_DAYS later if nothing refers to it by then.
CREATE TABLE IF NOT EXISTS cleanup_pending (
    ticker     TEXT PRIMARY KEY,
    removed_at TEXT NOT NULL   -- datetime.isoformat() of an aware UTC moment
);
"""
```

At the end of `_ensure_schema_compatibility`, after
```python
    for column in ("trailing_pe", "price_to_book", "ev_sales", "stdev_price"):
        if column not in benchmark_columns:
            conn.execute(f"ALTER TABLE industry_benchmark ADD COLUMN {column} REAL")
```
append:
```python
    # Additive, as for industry_benchmark above: covers a database whose create script stopped
    # before its last statement (init_db's legacy universe_key path).
    conn.execute(
        """CREATE TABLE IF NOT EXISTS cleanup_pending (
            ticker     TEXT PRIMARY KEY,
            removed_at TEXT NOT NULL
        )"""
    )
```

- [ ] **Step 5: Create the module with the pending store**

Create `apps/api/services/watchlist_cleanup.py`:

```python
"""Deferred cleanup of upstream caches for tickers that left the watchlist
(spec docs/superpowers/specs/2026-10-15-watchlist-cleanup-and-corporate-sync-design.md §2).

A ticker leaving the watchlist is recorded in cleanup_pending with the moment it left. Once it has
been pending for CLEANUP_GRACE_DAYS and nothing refers to it any more, its rows in the rebuildable
cache tables are deleted. User-authored tables and snapshot history are references, never targets.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

CLEANUP_GRACE_DAYS = 30
CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60


def _normalize(ticker: object) -> str:
    return str(ticker).upper().strip()


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def record_pending(conn: sqlite3.Connection, ticker: str, now: datetime | None = None) -> None:
    """Record that `ticker` left the watchlist at `now`. A later removal restarts the clock."""
    conn.execute(
        """INSERT INTO cleanup_pending (ticker, removed_at) VALUES (?, ?)
           ON CONFLICT(ticker) DO UPDATE SET removed_at = excluded.removed_at""",
        (_normalize(ticker), _iso(now or datetime.now(timezone.utc))),
    )


def clear_pending(conn: sqlite3.Connection, ticker: str) -> None:
    """The ticker is back on the watchlist: nothing is pending for it."""
    conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (_normalize(ticker),))
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_watchlist_cleanup_pending.py tests/api/test_sqlite_schema_validation.py tests/api/records_sync/test_store.py tests/api/watchlist_sync/test_store.py -q`
Expected: PASS.

- [ ] **Step 7: Mutation matrix (procedure in Global Constraints)**

| # | File | Mutation (old → new) | Test that must FAIL | Expected message fragment |
|---|---|---|---|---|
| 1.1 | `db.py` | Delete **both** `cleanup_pending` CREATE blocks added in Step 4 | `test_init_db_creates_the_pending_table` | `cleanup_pending is missing or wrong` |
| 1.2 | `db.py` | Same as 1.1 | `test_an_existing_database_without_the_table_gains_it_on_init` | `no such table: cleanup_pending` |
| 1.3 | `watchlist_cleanup.py` | `ON CONFLICT(ticker) DO UPDATE SET removed_at = excluded.removed_at` → `ON CONFLICT(ticker) DO NOTHING` | `test_a_second_removal_restarts_the_clock_and_the_ticker_is_normalised` | `the later removal must replace the earlier one` |
| 1.4 | `watchlist_cleanup.py` | In `clear_pending`, `(_normalize(ticker),)` → `(ticker,)` | `test_clear_pending_removes_only_that_ticker` | `assert {'ZZA'` |

- [ ] **Step 8: Commit**

```bash
git add apps/api/services/db.py apps/api/services/watchlist_cleanup.py tests/api/test_watchlist_cleanup_pending.py
git commit -F - <<'EOF'
feat(cleanup): cleanup_pending table records when a ticker left the watchlist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The cleanup run

**Files:**
- Modify: `apps/api/services/watchlist_cleanup.py` (replace the whole file)
- Test: `tests/api/test_watchlist_cleanup_run.py`

**Interfaces:**
- Consumes: Task 1's `record_pending`, `clear_pending`, `CLEANUP_GRACE_DAYS`; `apps.api.services.acquisition.registry.REGISTRY`, `Scope`; `corporate_metrics_service.DEFAULT_COMPANIES` (imported lazily inside the function: `corporate_metrics_service` imports `watchlist_seed`, which imports this module from Task 3 on).
- Produces:
  - `PER_TICKER_DATA_CLASSES: tuple[str, ...]` (sorted: `('equity_bars', 'market_cap', 'news', 'statements')`);
  - `CLEANUP_TABLES: tuple[tuple[str, str], ...]`;
  - `_REFERENCE_QUERIES: tuple[str, ...]`;
  - `referenced_tickers(conn) -> set[str]`;
  - `delete_ticker_caches(ticker: str) -> dict[str, int]` (table → rows deleted; `{}` when the ticker turned out to be referenced);
  - `run_cleanup(now: datetime) -> dict[str, dict[str, int]]` (ticker → table → rows);
  - `run_cleanup_logged() -> None` (never raises).

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_watchlist_cleanup_run.py`:

```python
"""Deferred cache cleanup: what is deleted, when, and what never is
(spec 2026-10-15 §2; tests §4.2, §4.3, §4.4, §4.6, §4.7; plan Review Focus 1, 2, 3, 5).
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from apps.api.services import watchlist_cleanup
from apps.api.services.corporate_metrics_service import DEFAULT_COMPANIES
from apps.api.services.db import get_db

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
GRACE = timedelta(days=watchlist_cleanup.CLEANUP_GRACE_DAYS)
DAY = timedelta(days=1)
CLASSES = watchlist_cleanup.PER_TICKER_DATA_CLASSES
FULL = {"stocks": 2, "news": 1, "corporate_statements": 1, "corporate_quote_facts": 1,
        "acquisition_state": len(CLASSES)}
GONE = {table: 0 for table in FULL}


def seed_caches(ticker: str) -> None:
    with get_db() as conn:
        for day in ("2026-09-01", "2026-09-02"):
            conn.execute("INSERT INTO stocks (ticker, date, close) VALUES (?, ?, 1.0)", (ticker, day))
        conn.execute("INSERT INTO news (ticker, headline, url, hash) VALUES (?, 'headline', ?, ?)",
                     (ticker, f"https://example.test/{ticker}", f"hash-{ticker}"))
        conn.execute("INSERT INTO corporate_statements (ticker, statement_type, frequency, period_end, line_item, "
                     "value, fetched_at) VALUES (?, 'income', 'annual', '2025-12-31', 'revenue', 1.0, "
                     "'2026-09-01T00:00:00+00:00')", (ticker,))
        conn.execute("INSERT INTO corporate_quote_facts (ticker, market_cap, fetched_at) "
                     "VALUES (?, 1.0, '2026-09-01T00:00:00+00:00')", (ticker,))
        for data_class in CLASSES:
            conn.execute("INSERT INTO acquisition_state (data_class, subject, status) VALUES (?, ?, 'ok')",
                         (data_class, ticker))


def cache_counts(ticker: str) -> dict[str, int]:
    marks = ", ".join("?" for _ in CLASSES)
    with get_db() as conn:
        def count(sql: str, *extra) -> int:
            return conn.execute(sql, (ticker, *extra)).fetchone()[0]
        return {
            "stocks": count("SELECT COUNT(*) FROM stocks WHERE ticker = ?"),
            "news": count("SELECT COUNT(*) FROM news WHERE ticker = ?"),
            "corporate_statements": count("SELECT COUNT(*) FROM corporate_statements WHERE ticker = ?"),
            "corporate_quote_facts": count("SELECT COUNT(*) FROM corporate_quote_facts WHERE ticker = ?"),
            "acquisition_state": count(
                f"SELECT COUNT(*) FROM acquisition_state WHERE subject = ? AND data_class IN ({marks})", *CLASSES),
        }


def pend(ticker: str, at: datetime) -> None:
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, ticker, now=at)


def pending() -> dict[str, str]:
    with get_db() as conn:
        return {r["ticker"]: r["removed_at"] for r in conn.execute("SELECT ticker, removed_at FROM cleanup_pending")}


CASE_SQL = ("INSERT INTO valuation_case (case_name, ticker, as_of_date, base_year, target_year, riskfree_rate, "
            "wacc_initial, wacc_stable, marginal_tax_rate, roic_stable, shares_basic) "
            "VALUES (?, ?, '2026-01-01', 2026, 2031, 0.03, 0.09, 0.08, 0.21, 0.12, 10.0)")
TAKEN = "2026-09-01T00:00:00+00:00"

REFERENCES = {
    "watchlist": lambda c, t: c.execute("INSERT INTO watchlist (ticker, name) VALUES (?, 'x')", (t,)),
    "corporate_companies": lambda c, t: c.execute(
        "INSERT INTO corporate_companies (ticker, name) VALUES (?, 'x')", (t,)),
    "corporate_metrics": lambda c, t: c.execute("INSERT INTO corporate_metrics (ticker) VALUES (?)", (t,)),
    "indices": lambda c, t: c.execute(
        "INSERT INTO indices (name, ticker, date, close) VALUES ('Index', ?, '2026-09-01', 1.0)", (t,)),
    "valuation_case": lambda c, t: c.execute(CASE_SQL, (f"case-{t}", t)),
    "investment_decision": lambda c, t: c.execute(
        "INSERT INTO investment_decision (ticker, decided_at, action, memo, figures_source) "
        "VALUES (?, '2026-09-01T00:00:00Z', 'watch', 'memo', 'live')", (t,)),
    "snapshot_v1": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots (snapshot_date, snapshot_taken_at, ticker) "
        "VALUES ('2026-09-01', ?, ?)", (TAKEN, t)),
    "snapshot_v2": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots_v2 (snapshot_date, universe_key, snapshot_taken_at, ticker) "
        "VALUES ('2026-09-01', 'u', ?, ?)", (TAKEN, t)),
    "snapshot_v2_benchmark": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots_v2 (snapshot_date, universe_key, snapshot_taken_at, ticker, "
        "benchmark_ticker) VALUES ('2026-09-01', 'u', ?, 'ZZOTHER', ?)", (TAKEN, t)),
    "snapshot_v3": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots_v3 (snapshot_version, snapshot_date, universe_key, "
        "snapshot_taken_at, ticker) VALUES ('v', '2026-09-01', 'u', ?, ?)", (TAKEN, t)),
    "snapshot_v3_benchmark": lambda c, t: c.execute(
        "INSERT INTO corporate_comparison_snapshots_v3 (snapshot_version, snapshot_date, universe_key, "
        "snapshot_taken_at, ticker, benchmark_ticker) VALUES ('v', '2026-09-01', 'u', ?, 'ZZOTHER', ?)",
        (TAKEN, t)),
}


# --- §4.2: grace period under a fake clock --------------------------------------------------------

def test_one_day_before_the_grace_period_nothing_is_deleted_and_one_day_after_it_is():
    seed_caches("ZZA")
    pend("ZZA", T0)

    watchlist_cleanup.run_cleanup(T0 + GRACE - DAY)
    assert cache_counts("ZZA") == FULL, "caches were deleted before the grace period ended"

    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == GONE, "caches survived past the grace period"
    assert "ZZA" not in pending(), "a fully cleaned ticker kept its pending record"


def test_a_removal_exactly_the_grace_period_old_is_due():
    seed_caches("ZZA")
    pend("ZZA", T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE)
    assert cache_counts("ZZA") == GONE, "a removal exactly CLEANUP_GRACE_DAYS old must be due"


def test_other_tickers_caches_survive_a_cleanup():
    seed_caches("ZZA")
    seed_caches("ZZB")
    pend("ZZA", T0)
    pend("ZZB", T0 + GRACE)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == GONE
    assert cache_counts("ZZB") == FULL, "a ticker that is not yet due lost its caches"


def test_a_second_removal_restarts_the_grace_period():
    seed_caches("ZZA")
    pend("ZZA", T0)
    pend("ZZA", T0 + 20 * DAY)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == FULL, "the grace period must run from the latest removal"


# --- §4.3: a referenced ticker is never cleaned ---------------------------------------------------

@pytest.mark.parametrize("reference", sorted(REFERENCES))
def test_a_ticker_something_still_refers_to_is_never_cleaned(reference):
    ticker = "ZZREF"
    seed_caches(ticker)
    with get_db() as conn:
        REFERENCES[reference](conn, ticker)
        watchlist_cleanup.record_pending(conn, ticker, now=T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts(ticker) == FULL, f"{reference} refers to {ticker}, but its caches were deleted"
    assert ticker not in pending(), f"{reference} refers to {ticker}, but its pending record was kept"


def test_a_default_company_is_never_cleaned():
    ticker = sorted(DEFAULT_COMPANIES)[0]
    seed_caches(ticker)
    pend(ticker, T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts(ticker) == FULL, f"default company {ticker} lost its caches"


def test_a_reference_in_another_case_still_protects_the_ticker():
    seed_caches("ZZL")
    with get_db() as conn:
        conn.execute(CASE_SQL, ("lower-case case", "zzl"))
    pend("ZZL", T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZL") == FULL, "valuation_case.ticker='zzl' must protect the ZZL caches"


# --- §4.4: cleanup never touches user records or snapshots ---------------------------------------

def _row_counts_outside_the_cleanup_tables() -> dict[str, int]:
    skip = {table for table, _ in watchlist_cleanup.CLEANUP_TABLES} | {"cleanup_pending", "sqlite_sequence"}
    with get_db() as conn:
        tables = [r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables if t not in skip}


def test_the_cleanup_tables_are_exactly_the_five_rebuildable_caches():
    assert {table for table, _ in watchlist_cleanup.CLEANUP_TABLES} == {
        "stocks", "news", "corporate_statements", "corporate_quote_facts", "acquisition_state",
    }, "CLEANUP_TABLES must list only rebuildable upstream caches"


def test_a_cleanup_run_never_changes_any_other_table():
    seed_caches("KEEP")
    seed_caches("ZZA")
    with get_db() as conn:
        for reference in ("watchlist", "corporate_metrics", "corporate_companies", "valuation_case",
                          "investment_decision", "snapshot_v1", "snapshot_v2", "snapshot_v3", "indices"):
            REFERENCES[reference](conn, "KEEP")
        # ZZA's own sync tombstone and a global index_bars row: neither is ever a cleanup target.
        conn.execute("INSERT INTO watchlist_removed (ticker, removed_at, removed_by) "
                     "VALUES ('ZZA', '2026-09-01T00:00:00.000Z', 'PC-A-0001')")
        conn.execute("INSERT INTO record_sync (kind, uid, updated_at, updated_by) "
                     "VALUES ('corporate_metrics', 'KEEP', '2026-09-01T00:00:00.000Z', 'PC-A-0001')")
        conn.execute("INSERT INTO acquisition_state (data_class, subject, status) VALUES ('index_bars', 'ZZA', 'ok')")
    pend("ZZA", T0)
    before = _row_counts_outside_the_cleanup_tables()

    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)

    assert cache_counts("ZZA") == GONE
    assert _row_counts_outside_the_cleanup_tables() == before, "cleanup changed a table it must never touch"
    assert cache_counts("KEEP") == FULL, "a referenced ticker lost caches"
    with get_db() as conn:
        index_bars = conn.execute("SELECT COUNT(*) FROM acquisition_state WHERE data_class = 'index_bars'").fetchone()[0]
    assert index_bars == 1, "the global index_bars state row was deleted"


def test_market_wide_news_is_never_a_candidate_and_never_deleted():
    with get_db() as conn:
        conn.execute("INSERT INTO news (ticker, headline, url, hash) VALUES (NULL, 'market', 'https://m', 'h-null')")
        conn.execute("INSERT INTO news (ticker, headline, url, hash) VALUES ('', 'blank', 'https://b', 'h-blank')")
    seed_caches("ZZA")
    pend("ZZA", T0)
    watchlist_cleanup.run_cleanup(T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    with get_db() as conn:
        unattributed = conn.execute("SELECT COUNT(*) FROM news WHERE ticker IS NULL OR ticker = ''").fetchone()[0]
    assert unattributed == 2, "market-wide news rows were deleted"
    assert set(pending()) <= {"ZZA"}, f"an unattributed news row became a candidate: {pending()}"


# --- §4.6: the first run records and deletes nothing ----------------------------------------------

def test_the_first_run_records_pending_times_and_deletes_nothing():
    seed_caches("ZZA")
    seed_caches("ZZB")
    deleted = watchlist_cleanup.run_cleanup(T0)
    assert deleted == {}, "the first run deleted caches"
    assert cache_counts("ZZA") == FULL and cache_counts("ZZB") == FULL, "the first run deleted caches"
    assert pending() == {"ZZA": T0.isoformat(), "ZZB": T0.isoformat()}, "the first run did not record 'now'"

    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == GONE, "the recorded first-run time was not used as the removal time"


def test_a_pending_record_of_a_referenced_ticker_is_dropped():
    pend("ZZA", T0)
    with get_db() as conn:
        REFERENCES["watchlist"](conn, "ZZA")
    watchlist_cleanup.run_cleanup(T0 + DAY)
    assert "ZZA" not in pending(), "a referenced ticker kept a stale pending record"


# --- §4.7: a failure in one table does not stop the rest -------------------------------------------

def test_a_failure_in_one_table_does_not_stop_the_rest(monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger=watchlist_cleanup.__name__)
    tables = watchlist_cleanup.CLEANUP_TABLES
    monkeypatch.setattr(watchlist_cleanup, "CLEANUP_TABLES", (tables[0], ("no_such_table", "ticker = ?"), *tables[1:]))
    seed_caches("ZZA")
    seed_caches("ZZB")
    pend("ZZA", T0)
    pend("ZZB", T0)

    deleted = watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)

    assert cache_counts("ZZA") == GONE, "one failing table stopped the other tables of ZZA"
    assert cache_counts("ZZB") == GONE, "one failing ticker stopped the next ticker"
    assert deleted["ZZB"]["stocks"] == 2
    assert set(pending()) == {"ZZA", "ZZB"}, "a ticker with a failed table must stay pending for a retry"
    assert "cleanup.failed ticker=ZZA table=no_such_table" in caplog.text


def test_each_deleted_batch_is_logged(caplog):
    caplog.set_level(logging.INFO, logger=watchlist_cleanup.__name__)
    seed_caches("ZZA")
    pend("ZZA", T0)
    watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert "cleanup.deleted ticker=ZZA table=stocks rows=2" in caplog.text
    assert f"cleanup.deleted ticker=ZZA table=acquisition_state rows={len(CLASSES)}" in caplog.text


# --- Review Focus 3 and 5 --------------------------------------------------------------------------

def test_a_ticker_re_added_before_its_delete_transaction_keeps_its_caches():
    seed_caches("ZZA")
    pend("ZZA", T0)
    with get_db() as conn:  # re-added after run_cleanup would have built its due list
        REFERENCES["watchlist"](conn, "ZZA")
    assert watchlist_cleanup.delete_ticker_caches("ZZA") == {}
    assert cache_counts("ZZA") == FULL, "a ticker re-added before its delete transaction lost its caches"
    assert "ZZA" not in pending()


def test_a_failing_reference_query_deletes_nothing(monkeypatch):
    monkeypatch.setattr(watchlist_cleanup, "_REFERENCE_QUERIES",
                        (*watchlist_cleanup._REFERENCE_QUERIES, "SELECT ticker FROM no_such_table"))
    seed_caches("ZZA")
    pend("ZZA", T0)
    with pytest.raises(sqlite3.OperationalError, match="no_such_table"):
        watchlist_cleanup.run_cleanup(T0 + GRACE + DAY)
    assert cache_counts("ZZA") == FULL, "a run that could not read every reference deleted caches"
    watchlist_cleanup.run_cleanup_logged()  # must not raise
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_watchlist_cleanup_run.py -q`
Expected: FAIL at import or collection with `AttributeError: module 'apps.api.services.watchlist_cleanup' has no attribute 'PER_TICKER_DATA_CLASSES'`.

- [ ] **Step 3: Write the implementation**

Replace the whole of `apps/api/services/watchlist_cleanup.py` with:

```python
"""Deferred cleanup of upstream caches for tickers that left the watchlist
(spec docs/superpowers/specs/2026-10-15-watchlist-cleanup-and-corporate-sync-design.md §2).

A ticker leaving the watchlist is recorded in cleanup_pending with the moment it left. Once it has
been pending for CLEANUP_GRACE_DAYS and nothing refers to it any more, its rows in the rebuildable
cache tables are deleted. User-authored tables and snapshot history are references, never targets.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone

from apps.api.services.acquisition.registry import REGISTRY, Scope
from apps.api.services.db import get_db

logger = logging.getLogger(__name__)

CLEANUP_GRACE_DAYS = 30
CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60

# acquisition_state rows keyed by a ticker. index_bars is GLOBAL: its subjects are index symbols
# whose bars live in `indices`, a reference table.
PER_TICKER_DATA_CLASSES = tuple(sorted(name for name, dc in REGISTRY.items() if dc.scope is Scope.PER_TICKER))
_CLASS_LIST = ", ".join(f"'{name}'" for name in PER_TICKER_DATA_CLASSES)

# (table, WHERE clause binding the ticker once). Only caches Yahoo can rebuild on demand belong here.
CLEANUP_TABLES: tuple[tuple[str, str], ...] = (
    ("stocks", "ticker = ?"),
    ("news", "ticker = ?"),
    ("corporate_statements", "ticker = ?"),
    ("corporate_quote_facts", "ticker = ?"),
    ("acquisition_state", f"subject = ? AND data_class IN ({_CLASS_LIST})"),
)

# Tickers present in a cache table. A NULL or '' news ticker is market-wide news, not attributed
# to any ticker, so it is never a candidate.
_CANDIDATE_QUERIES: tuple[str, ...] = (
    "SELECT DISTINCT ticker FROM stocks",
    "SELECT DISTINCT ticker FROM news WHERE ticker IS NOT NULL AND ticker <> ''",
    "SELECT DISTINCT ticker FROM corporate_statements",
    "SELECT ticker FROM corporate_quote_facts",
    f"SELECT DISTINCT subject FROM acquisition_state WHERE data_class IN ({_CLASS_LIST})",
)

# A ticker any of these name is never cleaned (spec §2.2). corporate_metrics counts so the owner's
# assumptions keep their statements available. A failing query is NOT caught: a run that cannot
# see every reference must not delete anything.
_REFERENCE_QUERIES: tuple[str, ...] = (
    "SELECT ticker FROM watchlist",
    "SELECT ticker FROM corporate_companies",
    "SELECT ticker FROM corporate_metrics",
    "SELECT DISTINCT ticker FROM indices",
    "SELECT ticker FROM valuation_case WHERE ticker IS NOT NULL",
    "SELECT ticker FROM investment_decision",
    "SELECT DISTINCT ticker FROM corporate_comparison_snapshots",
    "SELECT DISTINCT ticker FROM corporate_comparison_snapshots_v2",
    "SELECT DISTINCT benchmark_ticker FROM corporate_comparison_snapshots_v2",
    "SELECT DISTINCT ticker FROM corporate_comparison_snapshots_v3",
    "SELECT DISTINCT benchmark_ticker FROM corporate_comparison_snapshots_v3",
)


def _normalize(ticker: object) -> str:
    return str(ticker).upper().strip()


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def record_pending(conn: sqlite3.Connection, ticker: str, now: datetime | None = None) -> None:
    """Record that `ticker` left the watchlist at `now`. A later removal restarts the clock."""
    conn.execute(
        """INSERT INTO cleanup_pending (ticker, removed_at) VALUES (?, ?)
           ON CONFLICT(ticker) DO UPDATE SET removed_at = excluded.removed_at""",
        (_normalize(ticker), _iso(now or datetime.now(timezone.utc))),
    )


def clear_pending(conn: sqlite3.Connection, ticker: str) -> None:
    """The ticker is back on the watchlist: nothing is pending for it."""
    conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (_normalize(ticker),))


def referenced_tickers(conn: sqlite3.Connection) -> set[str]:
    # Imported here: corporate_metrics_service imports watchlist_seed, which imports this module.
    from apps.api.services.corporate_metrics_service import DEFAULT_COMPANIES

    found = {_normalize(ticker) for ticker in DEFAULT_COMPANIES}
    for sql in _REFERENCE_QUERIES:
        found.update(_normalize(row[0]) for row in conn.execute(sql) if row[0])
    return found


def _cache_tickers(conn: sqlite3.Connection) -> set[str]:
    found: set[str] = set()
    for sql in _CANDIDATE_QUERIES:
        found.update(row[0] for row in conn.execute(sql) if row[0])
    return found


def delete_ticker_caches(ticker: str) -> dict[str, int]:
    """Delete one ticker's cache rows in one transaction, one savepoint per table. A failed table
    is rolled back and logged; the others still commit, and the ticker stays pending for a retry.
    Returns {} without deleting when the ticker is referenced again by now."""
    counts: dict[str, int] = {}
    failed: list[str] = []
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if _normalize(ticker) in referenced_tickers(conn):
            conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (ticker,))
            return {}
        for table, where in CLEANUP_TABLES:
            conn.execute("SAVEPOINT cleanup_table")
            try:
                counts[table] = conn.execute(f"DELETE FROM {table} WHERE {where}", (ticker,)).rowcount
            except sqlite3.Error as error:
                conn.execute("ROLLBACK TO SAVEPOINT cleanup_table")
                failed.append(table)
                logger.warning("cleanup.failed ticker=%s table=%s error=%s", ticker, table, error)
            conn.execute("RELEASE SAVEPOINT cleanup_table")
        if not failed:
            conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (ticker,))
    for table, rows in counts.items():
        logger.info("cleanup.deleted ticker=%s table=%s rows=%d", ticker, table, rows)
    return counts


def run_cleanup(now: datetime) -> dict[str, dict[str, int]]:
    """One cleanup pass at `now` (an aware UTC datetime). Returns {ticker: {table: rows deleted}}."""
    with get_db() as conn:
        referenced = referenced_tickers(conn)
        pending = {row["ticker"]: row["removed_at"]
                   for row in conn.execute("SELECT ticker, removed_at FROM cleanup_pending")}
        for ticker in [t for t in pending if _normalize(t) in referenced]:
            conn.execute("DELETE FROM cleanup_pending WHERE ticker = ?", (ticker,))
            del pending[ticker]
        # Any unreferenced cache ticker with no record (removed before this shipped, or by a path
        # that is not hooked) starts its grace period now, so nothing is deleted on first sight.
        for ticker in sorted(_cache_tickers(conn)):
            if _normalize(ticker) not in referenced and ticker not in pending:
                conn.execute("INSERT OR IGNORE INTO cleanup_pending (ticker, removed_at) VALUES (?, ?)",
                             (ticker, _iso(now)))
    grace = timedelta(days=CLEANUP_GRACE_DAYS)
    due = sorted(t for t, at in pending.items() if now - datetime.fromisoformat(at) >= grace)
    deleted: dict[str, dict[str, int]] = {}
    for ticker in due:
        try:
            counts = delete_ticker_caches(ticker)
        except Exception as error:  # noqa: BLE001 - one ticker must not stop the others
            logger.warning("cleanup.ticker_failed ticker=%s error=%s", ticker, error)
            continue
        if counts:
            deleted[ticker] = counts
    return deleted


def run_cleanup_logged() -> None:
    """The scheduled entry point. Never raises: cleanup must never take the API down."""
    try:
        deleted = run_cleanup(datetime.now(timezone.utc))
    except Exception as error:  # noqa: BLE001
        logger.warning("cleanup.run_failed error=%s", error)
        return
    logger.info("cleanup.run_finished tickers=%d", len(deleted))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_watchlist_cleanup_run.py tests/api/test_watchlist_cleanup_pending.py -q`
Expected: PASS (11 parametrized reference cases included).

- [ ] **Step 5: Mutation matrix**

| # | Mutation in `watchlist_cleanup.py` (old → new) | Test that must FAIL | Fragment |
|---|---|---|---|
| 2.1 | `if now - datetime.fromisoformat(at) >= grace` → `if True` | `test_one_day_before_the_grace_period_nothing_is_deleted_and_one_day_after_it_is` | `caches were deleted before the grace period ended` |
| 2.2 | `>= grace)` → `> grace)` | `test_a_removal_exactly_the_grace_period_old_is_due` | `exactly CLEANUP_GRACE_DAYS old must be due` |
| 2.3 | `DELETE FROM {table} WHERE {where}` → `DELETE FROM {table} WHERE {where} OR 1` | `test_other_tickers_caches_survive_a_cleanup` | `not yet due lost its caches` |
| 2.4 | Delete the line `"SELECT ticker FROM valuation_case WHERE ticker IS NOT NULL",` | `test_a_ticker_something_still_refers_to_is_never_cleaned[valuation_case]` | `valuation_case refers to ZZREF` |
| 2.5 | Delete the line `"SELECT ticker FROM investment_decision",` | `…[investment_decision]` | `investment_decision refers to ZZREF` |
| 2.6 | Delete the line `"SELECT DISTINCT ticker FROM corporate_comparison_snapshots_v3",` | `…[snapshot_v3]` | `snapshot_v3 refers to ZZREF` |
| 2.7 | Delete the line `"SELECT ticker FROM corporate_metrics",` | `…[corporate_metrics]` | `corporate_metrics refers to ZZREF` |
| 2.8 | Delete the lines for v1, v2 ticker, v2 benchmark, v3 benchmark, watchlist, companies and indices, **one at a time** | the matching `…[<id>]` case | `<id> refers to ZZREF` |
| 2.9 | `found = {_normalize(ticker) for ticker in DEFAULT_COMPANIES}` → `found = set()` | `test_a_default_company_is_never_cleaned` | `lost its caches` |
| 2.10 | In `referenced_tickers`, `found.update(_normalize(row[0]) …` → `found.update(row[0] …` | `test_a_reference_in_another_case_still_protects_the_ticker` | `must protect the ZZL caches` |
| 2.11 | Add `("watchlist_removed", "ticker = ?"),` as the last entry of `CLEANUP_TABLES` | `test_the_cleanup_tables_are_exactly_the_five_rebuildable_caches` **and** `test_a_cleanup_run_never_changes_any_other_table` | `only rebuildable upstream caches` / `changed a table it must never touch` |
| 2.12 | In the `acquisition_state` entry, `f"subject = ? AND data_class IN ({_CLASS_LIST})"` → `"subject = ?"` | `test_a_cleanup_run_never_changes_any_other_table` | `index_bars state row was deleted` |
| 2.13 | Two edits applied together (the SQL filter and the Python filter guard the same input): `"SELECT DISTINCT ticker FROM news WHERE ticker IS NOT NULL AND ticker <> ''"` → `"SELECT DISTINCT ticker FROM news"`, **and** in `_cache_tickers` `found.update(row[0] for row in conn.execute(sql) if row[0])` → `found.update(str(row[0]) for row in conn.execute(sql))` | `test_market_wide_news_is_never_a_candidate_and_never_deleted` | `unattributed news row became a candidate` |
| 2.14 | `if _normalize(ticker) not in referenced and ticker not in pending:` → `if False:` | `test_the_first_run_records_pending_times_and_deletes_nothing` | `did not record 'now'` |
| 2.15 | In the backfill `INSERT OR IGNORE INTO cleanup_pending`, `(ticker, _iso(now)))` → `(ticker, _iso(now - timedelta(days=CLEANUP_GRACE_DAYS))))` | `test_the_first_run_records_pending_times_and_deletes_nothing` | `did not record 'now'` |
| 2.16 | Remove the `try:`/`except sqlite3.Error` around the table DELETE (keep the DELETE, de-indented) | `test_a_failure_in_one_table_does_not_stop_the_rest` | `one failing table stopped the other tables of ZZA` |
| 2.17 | `if not failed:` → `if True:` | `test_a_failure_in_one_table_does_not_stop_the_rest` | `must stay pending for a retry` |
| 2.18 | Delete the line `if _normalize(ticker) in referenced_tickers(conn):` and its two-line body | `test_a_ticker_re_added_before_its_delete_transaction_keeps_its_caches` | `assert {'stocks'` |
| 2.19 | In `referenced_tickers`, wrap the `for sql` body in `try: … except sqlite3.Error: continue` | `test_a_failing_reference_query_deletes_nothing` | `DID NOT RAISE` |
| 2.20 | `logger.info("cleanup.deleted ticker=%s table=%s rows=%d", …)` → `logger.debug(…)` | `test_each_deleted_batch_is_logged` | `cleanup.deleted ticker=ZZA` |
| 2.21 | Delete the `for ticker in [t for t in pending if _normalize(t) in referenced]:` loop and its body | `test_a_pending_record_of_a_referenced_ticker_is_dropped` | `kept a stale pending record` |

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/watchlist_cleanup.py tests/api/test_watchlist_cleanup_run.py
git commit -F - <<'EOF'
feat(cleanup): delete a removed ticker's caches after 30 days when nothing refers to it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Record and clear pending removals on every watchlist path

**Files:**
- Modify: `apps/api/routes/portfolio.py` (imports at `:33-45`; `upsert_watchlist_item` `:178-206`; `delete_watchlist_item` `:309-330`)
- Modify: `apps/api/services/watchlist_seed.py` (imports at `:1-8`; `bootstrap_from_seed` `:75-80`; `merge_missing_watchlist_items` `:107-116`; `resync_watchlist_from_json` `:145-155`)
- Modify: `apps/api/services/watchlist_sync/store.py` (imports at `:3-10`; `apply_state` `:73-88`)
- Test: `tests/api/test_watchlist_cleanup_hooks.py`

**Interfaces:**
- Consumes: `watchlist_cleanup.record_pending(conn, ticker, now=None)` and `clear_pending(conn, ticker)` (Task 1); `run_cleanup(now)` (Task 2); `tests.api.test_watchlist_cleanup_run.seed_caches`, `cache_counts`, `FULL`, `GRACE`, `DAY`, `T0`; `tests.api.watchlist_sync.test_service.PC`, `cloud`.
- Produces: no new names. Paths P1, P2, P4, P5, P6 and P7 now keep `cleanup_pending` current.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_watchlist_cleanup_hooks.py`:

```python
"""Every path that removes a watchlist row records a pending cleanup; every path that adds one
clears it (spec 2026-10-15 §2.3, test §4.5).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.routes import portfolio as portfolio_route
from apps.api.services import watchlist_cleanup, watchlist_seed
from apps.api.services.db import get_db
from tests.api.test_watchlist_cleanup_run import DAY, FULL, GRACE, T0, cache_counts, seed_caches
from tests.api.watchlist_sync.test_service import PC, cloud  # noqa: F401 - cloud is a pytest fixture

ITEM = {"ticker": "ZZA", "name": "Zed A", "sector": "", "group_name": "custom", "weight": 0.0}


@pytest.fixture(autouse=True)
def _no_real_acquisition(monkeypatch):
    # POST /watchlist schedules a live bars fetch for a new row (routes/portfolio.py:219-224).
    monkeypatch.setattr("apps.api.routes.portfolio.schedule_acquisition", lambda data_class, subject: None)


def pending() -> dict[str, str]:
    with get_db() as conn:
        return {r["ticker"]: r["removed_at"] for r in conn.execute("SELECT ticker, removed_at FROM cleanup_pending")}


def _seed_file(tmp_path, *tickers: str):
    path = tmp_path / "seed.json"
    targets = [{"ticker": t, "name": t, "sector": "", "weight": 0.0} for t in tickers]
    path.write_text(json.dumps({"custom": {"targets": targets}}), encoding="utf-8")
    return path


# --- P1, P2 (local routes) ----------------------------------------------------------------------

def test_deleting_a_watchlist_ticker_records_when_it_left():
    client = TestClient(app)
    assert client.post("/api/v1/portfolio/watchlist", json=ITEM).status_code == 200
    before = datetime.now(timezone.utc)
    assert client.delete("/api/v1/portfolio/watchlist/ZZA").status_code == 200
    after = datetime.now(timezone.utc)

    recorded = pending()
    assert "ZZA" in recorded, "DELETE /watchlist/{ticker} recorded no pending cleanup"
    assert before <= datetime.fromisoformat(recorded["ZZA"]) <= after


def test_re_adding_within_the_grace_period_clears_the_record_and_keeps_the_caches():
    client = TestClient(app)
    client.post("/api/v1/portfolio/watchlist", json=ITEM)
    seed_caches("ZZA")
    client.delete("/api/v1/portfolio/watchlist/ZZA")
    assert "ZZA" in pending()

    assert client.post("/api/v1/portfolio/watchlist", json=ITEM).status_code == 200
    assert "ZZA" not in pending(), "re-adding through POST /watchlist did not clear the pending record"

    watchlist_cleanup.run_cleanup(datetime.now(timezone.utc) + GRACE + DAY)
    assert cache_counts("ZZA") == FULL, "a re-added ticker lost its caches"


# --- P6 (the import) ----------------------------------------------------------------------------

def test_the_import_records_dropped_tickers_and_clears_imported_ones(tmp_path, monkeypatch):
    monkeypatch.setattr(portfolio_route, "_WATCHLIST_JSON", _seed_file(tmp_path, "ZZB"))
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name) VALUES ('ZZA', 'A')")
        watchlist_cleanup.record_pending(conn, "ZZB", now=T0)

    response = TestClient(app).post("/api/v1/portfolio/watchlist/resync")

    assert response.status_code == 200, response.text
    recorded = pending()
    assert "ZZA" in recorded, "the import dropped ZZA but recorded no pending cleanup"
    assert "ZZB" not in recorded, "the import re-added ZZB but kept its pending record"


# --- P4, P5 (seed paths) ------------------------------------------------------------------------

def test_the_seed_merge_clears_a_ticker_it_brings_back(tmp_path):
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name) VALUES ('ZZA', 'A')")
        watchlist_cleanup.record_pending(conn, "ZZB", now=T0)
    assert watchlist_seed.merge_missing_watchlist_items(_seed_file(tmp_path, "ZZB")) == ["ZZB"]
    assert "ZZB" not in pending(), "the seed merge re-added ZZB but kept its pending record"


def test_the_first_bootstrap_clears_a_pending_seed_ticker(tmp_path):
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, "ZZB", now=T0)
    watchlist_seed.bootstrap_from_seed(_seed_file(tmp_path, "ZZB"))
    with get_db() as conn:
        assert conn.execute("SELECT 1 FROM watchlist WHERE ticker = 'ZZB'").fetchone() is not None
    assert "ZZB" not in pending(), "the bootstrap added ZZB but kept its pending record"


# --- P7 (peer sync) -----------------------------------------------------------------------------

def _pending_on(pc) -> dict[str, str]:
    pc.use()
    return pending()


def test_a_peer_removal_records_the_pending_time_on_this_pc(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("ZZA")
    b.sync()
    assert "ZZA" in b.rows()

    a.delete("ZZA")
    b.sync()

    assert "ZZA" not in b.rows()
    assert "ZZA" in _pending_on(b), "a peer tombstone removed ZZA here but recorded no pending cleanup"


def test_a_peer_re_add_clears_the_pending_record_on_this_pc(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("ZZA")
    b.sync()
    a.delete("ZZA")
    b.sync()
    assert "ZZA" in _pending_on(b)

    a.add("ZZA")
    b.sync()

    assert "ZZA" in b.rows()
    assert "ZZA" not in _pending_on(b), "a peer re-add arrived here but the pending record was kept"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_watchlist_cleanup_hooks.py -q`
Expected: 7 FAIL, each with its own message, for example `DELETE /watchlist/{ticker} recorded no pending cleanup`. `test_re_adding_within…` fails at `assert "ZZA" in pending()`.

- [ ] **Step 3: Hook the routes (P1, P2)**

In `apps/api/routes/portfolio.py`, replace
```python
from apps.api.services import watchlist_seed
```
with
```python
from apps.api.services import watchlist_cleanup, watchlist_seed
```

In `upsert_watchlist_item`, replace
```python
            (normalized.ticker, normalized.name, normalized.sector, normalized.group_name,
             normalized.weight, stamp, author),
        )
    mark_watchlist_state("user_mutation")
```
with
```python
            (normalized.ticker, normalized.name, normalized.sector, normalized.group_name,
             normalized.weight, stamp, author),
        )
        # On the watchlist again: its caches are no longer heading for cleanup (spec 2026-10-15 §2.3).
        watchlist_cleanup.clear_pending(conn, normalized.ticker)
    mark_watchlist_state("user_mutation")
```

In `delete_watchlist_item`, replace
```python
        conn.execute("DELETE FROM watchlist WHERE ticker = ?", (normalized_ticker,))
    mark_watchlist_state("user_mutation")
```
with
```python
        conn.execute("DELETE FROM watchlist WHERE ticker = ?", (normalized_ticker,))
        # Hidden at once; its caches are deleted after the grace period (spec 2026-10-15 §2.3).
        watchlist_cleanup.record_pending(conn, normalized_ticker)
    mark_watchlist_state("user_mutation")
```

- [ ] **Step 4: Hook the seed paths (P4, P5, P6)**

In `apps/api/services/watchlist_seed.py`, replace
```python
from apps.api.services.db import get_db
```
with
```python
from apps.api.services import watchlist_cleanup
from apps.api.services.db import get_db
```

In `bootstrap_from_seed`, replace
```python
        for item in items:
            conn.execute(
                """INSERT OR IGNORE INTO watchlist (ticker, name, sector, group_name, weight, updated_at, updated_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (item.ticker.upper(), item.name, item.sector, item.group_name, item.weight, SEED_TS, pc_id),
            )
        _mark_watchlist_state(conn, source)
```
with
```python
        for item in items:
            cursor = conn.execute(
                """INSERT OR IGNORE INTO watchlist (ticker, name, sector, group_name, weight, updated_at, updated_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (item.ticker.upper(), item.name, item.sector, item.group_name, item.weight, SEED_TS, pc_id),
            )
            if cursor.rowcount:
                watchlist_cleanup.clear_pending(conn, item.ticker)
        _mark_watchlist_state(conn, source)
```

In `merge_missing_watchlist_items`, replace
```python
            if cursor.rowcount:
                added.append(item.ticker)
```
with
```python
            if cursor.rowcount:
                added.append(item.ticker)
                watchlist_cleanup.clear_pending(conn, item.ticker)
```

In `resync_watchlist_from_json`, replace
```python
        pc_id = sync_store.get_or_create_pc_id(conn)
        conn.execute("DELETE FROM watchlist")
        for item in normalized_items:
            conn.execute(
                """INSERT INTO watchlist (ticker, name, sector, group_name, weight, updated_at, updated_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (item.ticker, item.name, item.sector, item.group_name, item.weight, BASELINE_TS, pc_id),
            )
```
with
```python
        pc_id = sync_store.get_or_create_pc_id(conn)
        before = {row["ticker"] for row in conn.execute("SELECT ticker FROM watchlist")}
        conn.execute("DELETE FROM watchlist")
        for item in normalized_items:
            conn.execute(
                """INSERT INTO watchlist (ticker, name, sector, group_name, weight, updated_at, updated_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (item.ticker, item.name, item.sector, item.group_name, item.weight, BASELINE_TS, pc_id),
            )
            watchlist_cleanup.clear_pending(conn, item.ticker)
        for ticker in before - {item.ticker for item in normalized_items}:
            watchlist_cleanup.record_pending(conn, ticker)
```

- [ ] **Step 5: Hook the peer apply (P7)**

In `apps/api/services/watchlist_sync/store.py`, replace
```python
from apps.api.services.peer_sync.model import BASELINE_TS, SyncRow, SyncState, Tombstone, next_stamp
```
with
```python
from apps.api.services import watchlist_cleanup
from apps.api.services.peer_sync.model import BASELINE_TS, SyncRow, SyncState, Tombstone, next_stamp
```

In `apply_state`, replace
```python
    for ticker in current.rows.keys() - state.rows.keys():
        conn.execute("DELETE FROM watchlist WHERE ticker = ?", (ticker,))
    for row in state.rows.values():
        if current.rows.get(row.ticker) == row:
            continue
        conn.execute(
```
with
```python
    for ticker in current.rows.keys() - state.rows.keys():
        conn.execute("DELETE FROM watchlist WHERE ticker = ?", (ticker,))
        # A peer's tombstone removed it here: this PC starts its own grace period (spec §2.3).
        watchlist_cleanup.record_pending(conn, ticker)
    for row in state.rows.values():
        if current.rows.get(row.ticker) == row:
            continue
        if row.ticker not in current.rows:
            watchlist_cleanup.clear_pending(conn, row.ticker)
        conn.execute(
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_watchlist_cleanup_hooks.py tests/api/watchlist_sync tests/api/test_watchlist_resync.py tests/api/test_watchlist_merge.py tests/api/test_watchlist_seed_neutral.py tests/api/test_watchlist_group.py tests/api/test_watchlist_id.py tests/api/acquisition/test_triggers.py -q`
Expected: PASS. If a circular import appears (`ImportError … partially initialized module`), report it. Do not reorder unrelated imports.

- [ ] **Step 7: Mutation matrix**

| # | File: mutation (old → new) | Test that must FAIL | Fragment |
|---|---|---|---|
| 3.1 | `portfolio.py`: delete the line `watchlist_cleanup.record_pending(conn, normalized_ticker)` | `test_deleting_a_watchlist_ticker_records_when_it_left` | `recorded no pending cleanup` |
| 3.2 | `portfolio.py`: delete the line `watchlist_cleanup.clear_pending(conn, normalized.ticker)` | `test_re_adding_within_the_grace_period_clears_the_record_and_keeps_the_caches` | `did not clear the pending record` |
| 3.3 | `watchlist_seed.py`: delete `watchlist_cleanup.record_pending(conn, ticker)` in `resync_watchlist_from_json` | `test_the_import_records_dropped_tickers_and_clears_imported_ones` | `dropped ZZA but recorded no pending cleanup` |
| 3.4 | `watchlist_seed.py`: delete `watchlist_cleanup.clear_pending(conn, item.ticker)` in `resync_watchlist_from_json` | same test | `re-added ZZB but kept its pending record` |
| 3.5 | `watchlist_seed.py`: in `merge_missing_watchlist_items`, delete its `clear_pending` line | `test_the_seed_merge_clears_a_ticker_it_brings_back` | `seed merge re-added ZZB` |
| 3.6 | `watchlist_seed.py`: in `bootstrap_from_seed`, delete its two `if cursor.rowcount:` / `clear_pending` lines | `test_the_first_bootstrap_clears_a_pending_seed_ticker` | `bootstrap added ZZB` |
| 3.7 | `watchlist_sync/store.py`: delete `watchlist_cleanup.record_pending(conn, ticker)` | `test_a_peer_removal_records_the_pending_time_on_this_pc` | `recorded no pending cleanup` |
| 3.8 | `watchlist_sync/store.py`: delete the two lines `if row.ticker not in current.rows:` / `clear_pending` | `test_a_peer_re_add_clears_the_pending_record_on_this_pc` | `pending record was kept` |

- [ ] **Step 8: Commit**

```bash
git add apps/api/routes/portfolio.py apps/api/services/watchlist_seed.py apps/api/services/watchlist_sync/store.py tests/api/test_watchlist_cleanup_hooks.py
git commit -F - <<'EOF'
feat(cleanup): every watchlist removal records a pending cleanup; every add clears it

Covers the delete route, the add route, the import, the seed bootstrap and merge, and peer
removals and re-adds applied by watchlist sync.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Run the cleanup at startup and once a day

**Files:**
- Modify: `apps/api/main.py` (new coroutine after `stock_prewarm_cycle` at `:89-96`; `lifespan` at `:128-130`)
- Test: `tests/api/test_watchlist_cleanup_schedule.py`

**Interfaces:**
- Consumes: `watchlist_cleanup.run_cleanup_logged()` and `watchlist_cleanup.CLEANUP_INTERVAL_SECONDS`, both read from the module at call time so tests can patch them.
- Produces: `apps.api.main.watchlist_cleanup_cycle(run_at_start: bool) -> Coroutine`. `lifespan` starts it with `run_at_start=not startup_jobs_disabled`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_watchlist_cleanup_schedule.py`:

```python
"""The cleanup runs once at startup unless MONEYVIEW_DISABLE_STARTUP_JOBS is set, then once per
CLEANUP_INTERVAL_SECONDS (spec 2026-10-15 §2.4). Drives apps/api/main.py's lifespan the way
tests/api/test_startup_jobs_gate.py does.
"""
from __future__ import annotations

import asyncio

import pytest

from apps.api import main as api_main
from apps.api.services import watchlist_cleanup


def _drive(monkeypatch, gate: str | None, interval: float) -> list[str]:
    calls: list[str] = []
    monkeypatch.setattr(watchlist_cleanup, "run_cleanup_logged", lambda: calls.append("cleanup"))
    monkeypatch.setattr(watchlist_cleanup, "CLEANUP_INTERVAL_SECONDS", interval)

    async def no_prewarm():
        return None

    monkeypatch.setattr(api_main, "stock_prewarm_cycle", no_prewarm)
    if gate is None:
        monkeypatch.delenv("MONEYVIEW_DISABLE_STARTUP_JOBS", raising=False)
    else:
        monkeypatch.setenv("MONEYVIEW_DISABLE_STARTUP_JOBS", gate)

    async def drive():
        async with api_main.lifespan(api_main.app):
            await asyncio.sleep(0.2)

    asyncio.run(drive())
    return calls


@pytest.mark.parametrize("gate", [None, "", "0", "false"])
def test_the_cleanup_runs_once_at_startup_unless_gated(monkeypatch, gate):
    calls = _drive(monkeypatch, gate, interval=3600)
    assert calls == ["cleanup"], f"expected exactly one startup cleanup, got {calls}"


@pytest.mark.parametrize("gate", ["1", "true", "yes"])
def test_the_startup_gate_skips_the_startup_run(monkeypatch, gate):
    calls = _drive(monkeypatch, gate, interval=3600)
    assert calls == [], f"MONEYVIEW_DISABLE_STARTUP_JOBS={gate} must skip the startup cleanup, got {calls}"


def test_the_cleanup_repeats_every_interval(monkeypatch):
    calls = _drive(monkeypatch, None, interval=0.02)
    assert len(calls) >= 3, f"the daily loop did not repeat: {calls}"


def test_the_daily_loop_runs_even_when_the_startup_run_is_gated(monkeypatch):
    calls = _drive(monkeypatch, "1", interval=0.02)
    assert len(calls) >= 2, f"the gate must skip only the startup run, got {calls}"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_watchlist_cleanup_schedule.py -q`
Expected: the "unless_gated", "repeats" and "even_when_gated" tests FAIL (`expected exactly one startup cleanup, got []`). The "skips" cases pass, because nothing runs yet.

- [ ] **Step 3: Add the cycle**

In `apps/api/main.py`, after `stock_prewarm_cycle` (the function ending `logger.warning("Non-fatal stock prewarm startup error: %s", exc)`), insert:

```python


async def watchlist_cleanup_cycle(run_at_start: bool) -> None:
    """Deferred watchlist cache cleanup (spec 2026-10-15 §2.4): once at startup unless the startup
    gate is set, then once per CLEANUP_INTERVAL_SECONDS. Each run happens in a worker thread and
    never raises. Both names are read from the module on every pass, so tests can patch them."""
    from apps.api.services import watchlist_cleanup

    if run_at_start:
        await asyncio.to_thread(watchlist_cleanup.run_cleanup_logged)
    while True:
        await asyncio.sleep(watchlist_cleanup.CLEANUP_INTERVAL_SECONDS)
        await asyncio.to_thread(watchlist_cleanup.run_cleanup_logged)
```

In `lifespan`, replace
```python
    background = [task_wal]
    if not startup_jobs_disabled:
        background.append(asyncio.create_task(stock_prewarm_cycle()))
```
with
```python
    background = [task_wal]
    if not startup_jobs_disabled:
        background.append(asyncio.create_task(stock_prewarm_cycle()))
    # After the startup syncs above, so peer removals are already recorded as pending.
    background.append(asyncio.create_task(watchlist_cleanup_cycle(run_at_start=not startup_jobs_disabled)))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_watchlist_cleanup_schedule.py tests/api/test_startup_jobs_gate.py -q`
Expected: PASS.

- [ ] **Step 5: Mutation matrix**

| # | Mutation in `main.py` (old → new) | Test that must FAIL | Fragment |
|---|---|---|---|
| 4.1 | `run_at_start=not startup_jobs_disabled` → `run_at_start=True` | `test_the_startup_gate_skips_the_startup_run[1]` | `must skip the startup cleanup` |
| 4.2 | `run_at_start=not startup_jobs_disabled` → `run_at_start=False` | `test_the_cleanup_runs_once_at_startup_unless_gated[None]` | `expected exactly one startup cleanup` |
| 4.3 | Delete the `while True:` loop (its three lines) | `test_the_cleanup_repeats_every_interval` | `the daily loop did not repeat` |
| 4.4 | Wrap the `background.append(asyncio.create_task(watchlist_cleanup_cycle(…)))` line under `if not startup_jobs_disabled:` | `test_the_daily_loop_runs_even_when_the_startup_run_is_gated` | `must skip only the startup run` |

- [ ] **Step 6: Commit**

```bash
git add apps/api/main.py tests/api/test_watchlist_cleanup_schedule.py
git commit -F - <<'EOF'
feat(cleanup): run the watchlist cleanup at startup (gated) and once a day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: A deleted watchlist ticker leaves the company list at once

**Files:**
- Modify: `apps/api/services/corporate_metrics_service.py` (import at `:28`; `list_companies` `:303-322`)
- Test: `tests/api/test_corporate_registry_hides_removed.py`

**Interfaces:**
- Consumes: `GET /api/v1/corporate/companies` (`routes/corporate.py:143-146`), `POST /api/v1/corporate/companies`, `POST`/`DELETE /api/v1/portfolio/watchlist`; `corporate_comparison.load_company_universe_data(default_companies)`; `corporate_metrics_service.DEFAULT_COMPANIES`.
- Produces: `list_companies(watchlist_json)` with the same signature. It no longer lists seed-file tickers directly.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_corporate_registry_hides_removed.py`:

```python
"""A ticker deleted from the watchlist leaves the comparison candidates at once; manual and
default companies stay (spec 2026-10-15 §1, test §4.1; plan Narrowed N1).
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.routes import corporate as corporate_route
from apps.api.services.corporate_comparison import load_company_universe_data
from apps.api.services.corporate_metrics_service import DEFAULT_COMPANIES

REMOVED, KEPT, MANUAL = "ZZRM", "ZZKP", "ZZMN"
DEFAULT = sorted(DEFAULT_COMPANIES)[-1]


@pytest.fixture
def client(tmp_path, monkeypatch):
    assert not {REMOVED, KEPT, MANUAL} & set(DEFAULT_COMPANIES), "fixture tickers must not be defaults"
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"custom": {"targets": [
        {"ticker": REMOVED, "name": "Removed Co", "sector": "Tech", "weight": 0.0},
    ]}}), encoding="utf-8")
    monkeypatch.setattr(corporate_route, "_WATCHLIST_JSON", seed)
    monkeypatch.setattr("apps.api.routes.portfolio.schedule_acquisition", lambda data_class, subject: None)
    client = TestClient(app)
    for ticker in (KEPT, REMOVED):
        response = client.post("/api/v1/portfolio/watchlist",
                               json={"ticker": ticker, "name": ticker, "sector": "", "group_name": "custom", "weight": 0.0})
        assert response.status_code == 200, response.text
    assert client.post("/api/v1/corporate/companies",
                       json={"ticker": MANUAL, "name": "Manual Co", "sector": "Private"}).status_code == 200
    assert client.delete(f"/api/v1/portfolio/watchlist/{REMOVED}").status_code == 200
    return client


def test_a_deleted_watchlist_ticker_leaves_the_company_list_at_once(client):
    tickers = {company["ticker"] for company in client.get("/api/v1/corporate/companies").json()}
    assert REMOVED not in tickers, "a deleted watchlist ticker is still offered as a comparison candidate"
    assert {KEPT, MANUAL, DEFAULT} <= tickers, f"a kept, manual or default company disappeared: {sorted(tickers)}"


def test_a_deleted_watchlist_ticker_leaves_the_comparison_registry_at_once(client):
    registry = load_company_universe_data(DEFAULT_COMPANIES).registry
    assert REMOVED not in registry, "a deleted watchlist ticker is still in the comparison registry"
    assert {KEPT, MANUAL, DEFAULT} <= set(registry)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_corporate_registry_hides_removed.py -q`
Expected: `test_a_deleted_watchlist_ticker_leaves_the_company_list_at_once` FAILS with `still offered as a comparison candidate`. The registry test PASSES already (N1). It is verified by mutation 5.2.

- [ ] **Step 3: Remove the seed loop**

In `apps/api/services/corporate_metrics_service.py`, replace
```python
from apps.api.services.watchlist_seed import ensure_watchlist_bootstrapped, load_watchlist_seed
```
with
```python
from apps.api.services.watchlist_seed import ensure_watchlist_bootstrapped
```

and in `list_companies`, replace
```python
    seeded_items, _ = load_watchlist_seed(watchlist_json)
    for item in seeded_items:
        ticker = item.ticker.upper()
        companies[ticker] = CorporateCompany(
            ticker=ticker,
            name=item.name or ticker,
            sector=item.sector,
            source="portfolio",
        )

    with get_db() as conn:
```
with
```python
    # Seed tickers arrive through the watchlist they were bootstrapped into, one line above.
    # Listing the seed file itself kept a deleted ticker comparable (spec 2026-10-15 §1).
    with get_db() as conn:
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_corporate_registry_hides_removed.py tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py -q`
Expected: PASS. This includes `test_corporate_companies_includes_all_stock_targets_json_entries`.

- [ ] **Step 5: Mutation matrix**

| # | File: mutation (old → new) | Test that must FAIL | Fragment |
|---|---|---|---|
| 5.1 | `corporate_metrics_service.py`: put the removed seed loop back, along with its `load_watchlist_seed` import | `test_a_deleted_watchlist_ticker_leaves_the_company_list_at_once` | `still offered as a comparison candidate` |
| 5.2 | `routes/portfolio.py`: `conn.execute("DELETE FROM watchlist WHERE ticker = ?", (normalized_ticker,))` → `conn.execute("DELETE FROM watchlist WHERE 0 AND ticker = ?", (normalized_ticker,))` | `test_a_deleted_watchlist_ticker_leaves_the_comparison_registry_at_once` | `still in the comparison registry` |
| 5.3 | `corporate_comparison.py`: in `load_company_universe_data`, `for row in company_rows:` → `for row in company_rows[:0]:` | `test_a_deleted_watchlist_ticker_leaves_the_comparison_registry_at_once` | `assert {'ZZ` (the manual company is missing) |

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/corporate_metrics_service.py tests/api/test_corporate_registry_hides_removed.py
git commit -F - <<'EOF'
fix(corporate): a deleted watchlist ticker leaves the company list at once

list_companies listed every seed-file ticker directly, so a deleted seed ticker stayed
comparable, and with an empty seed file every corporate_metrics ticker did. Seed tickers
still appear through the watchlist they are bootstrapped into.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: `corporate_metrics` and `corporate_companies` become records-sync kinds

**Files:**
- Modify: `apps/api/services/records_sync/kinds.py` (constants at `:12-17`; `KINDS` at `:106-170`)
- Modify: `apps/api/services/records_sync/store.py` (imports `:12-14`; `ensure_first_sync` `:81-98`; new `stamp_seed` after `stamp` at `:365-370`)
- Test: `tests/api/records_sync/test_corporate_kinds.py`

**Interfaces:**
- Consumes: `tests.api.records_sync.test_service.PC` (methods `use()`, `sync()`, `add_event(label)`, `events()`) and the `cloud` fixture; `records_sync.store.stamp`; `records_sync.files.read_peer_files`, `own_file_path`; `records_sync.service.current_status`.
- Produces:
  - `kinds.KIND_CORPORATE_METRICS = "corporate_metrics"` and `kinds.KIND_CORPORATE_COMPANIES = "corporate_companies"`, both registered in `KINDS` with `uid_column="ticker"`;
  - `store.stamp_seed(conn, kind: str, uid: str, pc_id: str) -> None` (inserts `SEED_TS` only if no stamp exists);
  - the first-sync stamping rules of N3 inside `ensure_first_sync`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/records_sync/test_corporate_kinds.py`:

```python
"""corporate_metrics and corporate_companies sync between PCs by ticker; the later edit wins
(spec 2026-10-15 §3, tests §4.8 and §4.9; plan Narrowed N2, N3; Rollout notes).
Rows here are written the way the write paths will (Task 7), with explicit stamps.
"""
from __future__ import annotations

import json

from apps.api.services.db import get_db
from apps.api.services.records_sync import files, kinds, service, store
from apps.api.services.records_sync.kinds import KIND_CORPORATE_COMPANIES, KIND_CORPORATE_METRICS, KINDS
from apps.api.services.watchlist_sync import store as watchlist_store
from tests.api.records_sync.test_service import PC, cloud  # noqa: F401 - cloud is a pytest fixture

TS = "2026-10-01T00:00:00.000Z"


def put_metrics(pc, ticker, growth, saved_at="2026-10-01T00:00:00+00:00", stamp=True):
    pc.use()
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO corporate_metrics (ticker, growth, updated_at) VALUES (?, ?, ?)",
                     (ticker, growth, saved_at))
        if stamp:
            store.stamp(conn, KIND_CORPORATE_METRICS, ticker, watchlist_store.get_or_create_pc_id(conn))


def put_company(pc, ticker, name, saved_at="2026-10-01T00:00:00+00:00", stamp=True):
    pc.use()
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO corporate_companies (ticker, name, updated_at) VALUES (?, ?, ?)",
                     (ticker, name, saved_at))
        if stamp:
            store.stamp(conn, KIND_CORPORATE_COMPANIES, ticker, watchlist_store.get_or_create_pc_id(conn))


def metrics(pc) -> dict[str, dict]:
    pc.use()
    with get_db() as conn:
        return {r["ticker"]: dict(r) for r in conn.execute("SELECT * FROM corporate_metrics")}


def companies(pc) -> dict[str, dict]:
    pc.use()
    with get_db() as conn:
        return {r["ticker"]: dict(r) for r in conn.execute("SELECT * FROM corporate_companies")}


def test_both_corporate_kinds_are_keyed_by_ticker():
    for name in (KIND_CORPORATE_METRICS, KIND_CORPORATE_COMPANIES):
        kind = KINDS[name]
        assert kind.table == name and kind.uid_column == "ticker", name
        assert not kind.generates_uid and kind.singleton_uid is None, name
        assert "ticker" in kind.columns and "updated_at" in kind.columns, name


def test_a_metrics_edit_on_pc_a_arrives_on_pc_b(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    put_metrics(a, "AAPL", 9.5)
    a.sync(); b.sync()
    assert metrics(b).get("AAPL", {}).get("growth") == 9.5, "a corporate_metrics edit did not reach PC B"


def test_a_company_added_on_pc_a_arrives_on_pc_b(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    put_company(a, "ZZPV", "Private Co")
    a.sync(); b.sync()
    assert companies(b).get("ZZPV", {}).get("name") == "Private Co", "a corporate_companies row did not reach PC B"


def test_when_both_pcs_edited_metrics_the_later_edit_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    put_metrics(a, "AAPL", 9.0)
    a.sync(); b.sync()
    put_metrics(b, "AAPL", 11.0)  # later; its JSON sorts BELOW 9.0, so a tie would pick 9.0
    b.sync(); a.sync()
    assert metrics(a)["AAPL"]["growth"] == 11.0 and metrics(b)["AAPL"]["growth"] == 11.0, \
        "the later corporate_metrics edit did not win on both PCs"


def test_when_both_pcs_edited_a_company_the_later_edit_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    put_company(a, "ZZPV", "Zeta")
    a.sync(); b.sync()
    put_company(b, "ZZPV", "Alpha")  # later; sorts below "Zeta"
    b.sync(); a.sync()
    assert companies(a)["ZZPV"]["name"] == "Alpha" and companies(b)["ZZPV"]["name"] == "Alpha", \
        "the later corporate_companies edit did not win on both PCs"


def test_first_sync_orders_pre_existing_rows_by_their_saved_time(tmp_path, monkeypatch, cloud):
    # Rows saved before this shipped have no record_sync stamp. PC-A sorts below PC-B, so a pc_id
    # tiebreak would pick B's older row.
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    put_metrics(a, "AAPL", 7.0, saved_at="2026-10-05T00:00:00+00:00", stamp=False)
    put_metrics(b, "AAPL", 11.0, saved_at="2026-10-01T00:00:00+00:00", stamp=False)
    put_company(a, "ZZPV", "Newer", saved_at="2026-10-05T00:00:00+00:00", stamp=False)
    put_company(b, "ZZPV", "Older", saved_at="2026-10-01T00:00:00+00:00", stamp=False)
    a.sync(); b.sync(); a.sync()
    assert metrics(a)["AAPL"]["growth"] == 7.0 and metrics(b)["AAPL"]["growth"] == 7.0, \
        "first sync did not keep the later-saved corporate_metrics row"
    assert companies(b)["ZZPV"]["name"] == "Newer", "first sync did not keep the later-saved company"


def test_first_sync_ranks_an_add_company_default_below_a_real_adjustment(tmp_path, monkeypatch, cloud):
    # add_company writes one `now` into both tables; nobody adjusted LEU on A after that.
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    put_company(a, "LEU", "Centrus", saved_at="2026-10-05T00:00:00+00:00", stamp=False)
    put_metrics(a, "LEU", 3.0, saved_at="2026-10-05T00:00:00+00:00", stamp=False)
    put_metrics(b, "LEU", 20.0, saved_at="2026-10-01T00:00:00+00:00", stamp=False)
    a.sync(); b.sync(); a.sync()
    assert metrics(a)["LEU"]["growth"] == 20.0 and metrics(b)["LEU"]["growth"] == 20.0, \
        "an untouched add_company default outranked a real adjustment made on the other PC"


def test_an_older_peer_file_without_the_new_kinds_still_loads_and_merges(tmp_path, monkeypatch, cloud):
    b = PC(tmp_path, "PC-B", monkeypatch)
    put_metrics(b, "AAPL", 9.5)
    old = files.own_file_path(cloud, "PC-OLD-0001")
    old.parent.mkdir(exist_ok=True)
    old.write_text(json.dumps({
        "format_version": 1, "pc_id": "PC-OLD-0001", "written_at": TS,
        "records": [{"kind": "user_event", "uid": "old-event-1", "updated_at": TS, "updated_by": "PC-OLD-0001",
                     "payload": {"label": "From the old PC", "category": "fomc", "start_date": "2026-01-01",
                                 "end_date": None, "source": None, "note": "", "created_at": TS}}],
        "removed": [],
    }), encoding="utf-8")

    b.sync()

    assert service.current_status().skipped_files == [], "an older peer file was skipped"
    assert "From the old PC" in b.events(), "an existing kind from an older peer file did not merge"
    assert metrics(b)["AAPL"]["growth"] == 9.5
    published = json.loads(files.own_file_path(cloud, b.pc_id()).read_text(encoding="utf-8"))
    assert ("corporate_metrics", "AAPL") in {(r["kind"], r["uid"]) for r in published["records"]}


def test_an_older_reader_skips_a_whole_file_that_carries_the_new_kinds(tmp_path, monkeypatch, cloud):
    # Characterises today's reader (files.py:283-285) for the rollout notes: an older PC drops the
    # updated PC's WHOLE file, other kinds included, until it is updated too.
    a = PC(tmp_path, "PC-A", monkeypatch)
    put_metrics(a, "AAPL", 9.5)
    a.add_event("Also in that file")
    for name in (KIND_CORPORATE_METRICS, KIND_CORPORATE_COMPANIES):
        monkeypatch.delitem(kinds.KINDS, name)

    peers, skipped = files.read_peer_files(cloud, own_pc_id="PC-OLD-0001")

    assert peers == [], "an older reader accepted a file with an unknown kind; update the rollout notes"
    assert len(skipped) == 1 and "unknown kind 'corporate_metrics'" in skipped[0].reason
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/records_sync/test_corporate_kinds.py -q`
Expected: FAIL at import, `ImportError: cannot import name 'KIND_CORPORATE_COMPANIES'`.

- [ ] **Step 3: Register the kinds**

In `apps/api/services/records_sync/kinds.py`, replace
```python
KIND_PREFERENCES = "portfolio_preferences"
```
with
```python
KIND_PREFERENCES = "portfolio_preferences"
KIND_CORPORATE_METRICS = "corporate_metrics"
KIND_CORPORATE_COMPANIES = "corporate_companies"
```

and replace the end of `KINDS`:
```python
        singleton_uid="portfolio_preferences",
        not_null=("total_investment_amount", "transaction_fee_rate", "updated_at"),
    ),
}
```
with
```python
        singleton_uid="portfolio_preferences",
        not_null=("total_investment_amount", "transaction_fee_rate", "updated_at"),
    ),
    # The owner's slider assumptions per ticker. Natural identity, like event_category_visibility's
    # category_id: the ticker IS the record on every PC, so it travels in the payload too. Never
    # deleted (spec 2026-10-15 D4), so no tombstone is ever written for it.
    KIND_CORPORATE_METRICS: Kind(
        name=KIND_CORPORATE_METRICS,
        table="corporate_metrics",
        uid_column="ticker",
        columns=("ticker", "growth", "roic", "wacc", "debt_ratio", "unlevered_beta", "crp",
                 "reinvestment", "fcff", "innovation", "market_share", "governance", "esg_penalty",
                 "updated_at"),
        not_null=("growth", "roic", "wacc", "debt_ratio", "unlevered_beta", "crp", "reinvestment",
                  "fcff", "innovation", "market_share", "governance", "esg_penalty", "updated_at"),
    ),
    # Companies the owner added by hand. Same identity rule; never deleted either.
    KIND_CORPORATE_COMPANIES: Kind(
        name=KIND_CORPORATE_COMPANIES,
        table="corporate_companies",
        uid_column="ticker",
        columns=("ticker", "name", "sector", "source", "updated_at"),
        not_null=("name", "updated_at"),
    ),
}
```

- [ ] **Step 4: First-sync stamps and `stamp_seed`**

In `apps/api/services/records_sync/store.py`, replace
```python
from apps.api.services.records_sync.kinds import KIND_PREFERENCES, KINDS, PARENT_UID_KEY, ChildSpec, Kind
```
with
```python
from apps.api.services.records_sync.kinds import (
    KIND_CORPORATE_COMPANIES,
    KIND_CORPORATE_METRICS,
    KIND_PREFERENCES,
    KINDS,
    PARENT_UID_KEY,
    ChildSpec,
    Kind,
)
```

After `_first_preferences_stamp` (the function ending `return format_ts(moment)`), insert:

```python


def _first_saved_at_stamp(saved_at: str) -> str:
    """The first-sync stamp for a corporate row, from its own updated_at. The corporate write paths
    store datetime.now(timezone.utc).isoformat(), so two PCs that saved the same ticker before sync
    existed are decided by recency rather than by the pc_id tiebreak. BASELINE_TS for '' or
    anything that does not parse."""
    try:
        moment = datetime.fromisoformat(saved_at)
    except (TypeError, ValueError):
        return BASELINE_TS
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return max(format_ts(moment), BASELINE_TS)


def _is_add_company_default(conn: sqlite3.Connection, row: sqlite3.Row) -> bool:
    """A corporate_metrics row that add_company inserted and nobody has adjusted since: add_company
    writes one `now` into both tables' updated_at, and save_metrics always writes a new one."""
    company = conn.execute(
        "SELECT updated_at FROM corporate_companies WHERE ticker = ?", (row["ticker"],)
    ).fetchone()
    return company is not None and row["updated_at"] != "" and company["updated_at"] == row["updated_at"]


def _first_stamp(conn: sqlite3.Connection, kind: Kind, row: sqlite3.Row) -> str:
    if kind.name == KIND_PREFERENCES:
        return _first_preferences_stamp(row["updated_at"])
    if kind.name == KIND_CORPORATE_METRICS and _is_add_company_default(conn, row):
        return SEED_TS
    if kind.name in (KIND_CORPORATE_METRICS, KIND_CORPORATE_COMPANIES):
        return _first_saved_at_stamp(row["updated_at"])
    return BASELINE_TS
```

In `ensure_first_sync`, replace
```python
            stamp = _first_preferences_stamp(row["updated_at"]) if kind.name == KIND_PREFERENCES else BASELINE_TS
```
with
```python
            stamp = _first_stamp(conn, kind, row)
```

After `stamp` (the function ending `_upsert_added(conn, kind, uid, _causal_stamp(conn, kind, uid), pc_id)`), insert:

```python


def stamp_seed(conn: sqlite3.Connection, kind: str, uid: str, pc_id: str) -> None:
    """Record a row the app created on its own, not an owner edit (add_company's default metrics),
    at SEED_TS, so a real edit of the same record on any PC outranks it. Leaves an existing stamp
    alone."""
    conn.execute(
        "INSERT OR IGNORE INTO record_sync (kind, uid, updated_at, updated_by) VALUES (?, ?, ?, ?)",
        (kind, uid, SEED_TS, pc_id),
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/api/records_sync -q`
Expected: PASS. This includes the existing `test_kinds.py`, which now also checks both new kinds against the live schema.

- [ ] **Step 6: Mutation matrix**

| # | File: mutation (old → new) | Test that must FAIL | Fragment |
|---|---|---|---|
| 6.1 | `kinds.py`: delete the whole `KIND_CORPORATE_METRICS: Kind(…),` entry | `test_a_metrics_edit_on_pc_a_arrives_on_pc_b` | `did not reach PC B` |
| 6.2 | `kinds.py`: delete the whole `KIND_CORPORATE_COMPANIES: Kind(…),` entry | `test_a_company_added_on_pc_a_arrives_on_pc_b` | `did not reach PC B` |
| 6.3 | `store.py`: `if kind.name in (KIND_CORPORATE_METRICS, KIND_CORPORATE_COMPANIES):` → `if False:` | `test_first_sync_orders_pre_existing_rows_by_their_saved_time` | `did not keep the later-saved corporate_metrics row` |
| 6.4 | `store.py`: `if kind.name == KIND_CORPORATE_METRICS and _is_add_company_default(conn, row):` → `if False:` | `test_first_sync_ranks_an_add_company_default_below_a_real_adjustment` | `outranked a real adjustment` |
| 6.5 | Test-side check of the "later edit" fixture. In `put_metrics`, comment out `store.stamp(…)`; the source is untouched. Restore the test file the same way afterwards. | `test_when_both_pcs_edited_metrics_the_later_edit_wins` | `did not win on both PCs` |
| 6.6 | `files.py`: `raise ValueError(f"unknown kind {raw['kind']!r}")` → `continue` (in `_parse`'s records loop) | `test_an_older_reader_skips_a_whole_file_that_carries_the_new_kinds` | `update the rollout notes` |

6.5 proves that the "later edit" tests depend on the stamp, so Task 7 can rely on them. It is the only mutation applied to a test file.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/records_sync/kinds.py apps/api/services/records_sync/store.py tests/api/records_sync/test_corporate_kinds.py
git commit -F - <<'EOF'
feat(sync): corporate_metrics and corporate_companies sync by ticker; later edit wins

First sync stamps pre-existing rows from their own updated_at; an untouched add_company
default ranks below any real adjustment.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: The corporate write paths stamp and publish

**Files:**
- Modify: `apps/api/services/corporate_metrics_service.py` (imports `:26-28`; `add_company` `:356-397`; `save_metrics` `:447-474`)
- Modify: `apps/api/routes/corporate.py` (imports `:34`; handlers `:149-152`, `:526-528`)
- Test: `tests/api/test_corporate_records_sync.py`

**Interfaces:**
- Consumes: `records_sync.store.stamp`, `stamp_seed`, `KIND_CORPORATE_METRICS`, `KIND_CORPORATE_COMPANIES` (Task 6); `watchlist_sync.store.get_or_create_pc_id`; `records_sync.service.run_records_sync`.
- Produces: `save_metrics` and `add_company` keep their signatures. Every owner edit is stamped, and `add_company`'s auto-inserted metrics row is stamped `SEED_TS`. `PUT /corporate/metrics/{ticker}` and `POST /corporate/companies` run `run_records_sync("mutation")` after the write.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_corporate_records_sync.py`:

```python
"""The corporate write paths reach the other PC and apply there as the owner's assumptions
(spec 2026-10-15 §3, test §4.8; plan Review Focus 4).
"""
from __future__ import annotations

import json

from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schemas import CorporateCompany, CorporateMetrics
from apps.api.services import corporate_metrics_service
from apps.api.services.db import get_db
from apps.api.services.records_sync import files
from apps.api.services.watchlist_sync import store as watchlist_store
from tests.api.records_sync.test_service import PC, cloud  # noqa: F401 - cloud is a pytest fixture


def save(pc, ticker, growth):
    pc.use()
    corporate_metrics_service.save_metrics(ticker, CorporateMetrics(ticker=ticker, growth=growth, roic=21.0))


def add(pc, ticker, name):
    pc.use()
    corporate_metrics_service.add_company(CorporateCompany(ticker=ticker, name=name, sector="Energy"))


def growth_on(pc, ticker):
    pc.use()
    with get_db() as conn:
        row = conn.execute("SELECT growth FROM corporate_metrics WHERE ticker = ?", (ticker,)).fetchone()
    return None if row is None else row["growth"]


def company_name_on(pc, ticker):
    pc.use()
    with get_db() as conn:
        row = conn.execute("SELECT name FROM corporate_companies WHERE ticker = ?", (ticker,)).fetchone()
    return None if row is None else row["name"]


def published_keys(root) -> set[tuple[str, str]]:
    with get_db() as conn:
        pc_id = watchlist_store.get_or_create_pc_id(conn)
    path = files.own_file_path(root, pc_id)
    assert path.exists(), "the write route did not publish this PC's records file"
    return {(r["kind"], r["uid"]) for r in json.loads(path.read_text(encoding="utf-8"))["records"]}


def test_a_saved_assumption_arrives_on_pc_b_and_applies_as_the_owners_assumption(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    save(a, "AAPL", 12.5)
    a.sync(); b.sync()

    b.use()
    applied, is_saved = corporate_metrics_service.load_fallback_metrics("AAPL")
    assert is_saved, "the synced row is not used as a saved assumption on PC B"
    assert applied.growth == 12.5 and applied.roic == 21.0


def test_when_both_pcs_saved_the_later_save_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    save(a, "AAPL", 9.0)
    a.sync(); b.sync()
    save(b, "AAPL", 11.0)  # later; sorts below 9.0, so an unstamped edit would lose the tiebreak
    b.sync(); a.sync()
    assert growth_on(a, "AAPL") == 11.0 and growth_on(b, "AAPL") == 11.0, "the later save_metrics did not win"


def test_when_both_pcs_added_the_same_company_the_later_add_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    add(a, "ZZPV", "Zeta")
    a.sync(); b.sync()
    add(b, "ZZPV", "Alpha")
    b.sync(); a.sync()
    assert company_name_on(a, "ZZPV") == "Alpha" and company_name_on(b, "ZZPV") == "Alpha", \
        "the later add_company did not win"


def test_adding_a_company_never_overwrites_assumptions_saved_on_another_pc(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    save(b, "LEU", 20.0)
    b.sync()
    add(a, "LEU", "Centrus Energy")  # A has not received B's LEU yet, so it inserts defaults
    a.sync(); b.sync()
    assert growth_on(a, "LEU") == 20.0 and growth_on(b, "LEU") == 20.0, \
        "add_company's default metrics overwrote an assumption saved on the other PC"


def test_saving_through_the_route_publishes_the_record(cloud):
    body = CorporateMetrics(ticker="AAPL", growth=12.5).model_dump(mode="json")
    response = TestClient(app).put("/api/v1/corporate/metrics/AAPL", json=body)
    assert response.status_code == 200, response.text
    assert ("corporate_metrics", "AAPL") in published_keys(cloud)


def test_adding_a_company_through_the_route_publishes_both_records(cloud):
    response = TestClient(app).post("/api/v1/corporate/companies",
                                    json={"ticker": "ZZPV", "name": "Private Co", "sector": ""})
    assert response.status_code == 200, response.text
    keys = published_keys(cloud)
    assert {("corporate_companies", "ZZPV"), ("corporate_metrics", "ZZPV")} <= keys
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_corporate_records_sync.py -q`
Expected: `test_when_both_pcs_saved…` fails with `the later save_metrics did not win`, `test_when_both_pcs_added…` with `the later add_company did not win`, and both route tests with `did not publish`. The two other tests may pass or fail. Mutations 7.x verify them in Step 6.

- [ ] **Step 3: Stamp in the service**

In `apps/api/services/corporate_metrics_service.py`, replace
```python
from apps.api.services.db import get_db
from apps.api.services.market_data import MarketDataService
```
with
```python
from apps.api.services.db import get_db
from apps.api.services.market_data import MarketDataService
from apps.api.services.records_sync import store as records_sync_store
from apps.api.services.records_sync.kinds import KIND_CORPORATE_COMPANIES, KIND_CORPORATE_METRICS
from apps.api.services.watchlist_sync.store import get_or_create_pc_id
```

In `add_company`, replace
```python
            (payload.ticker, payload.name or payload.ticker, payload.sector, payload.source, now),
        )
        fallback = default_metrics(payload.ticker)
        conn.execute(
            """INSERT OR IGNORE INTO corporate_metrics
```
with
```python
            (payload.ticker, payload.name or payload.ticker, payload.sector, payload.source, now),
        )
        pc_id = get_or_create_pc_id(conn)
        records_sync_store.stamp(conn, KIND_CORPORATE_COMPANIES, payload.ticker, pc_id)
        fallback = default_metrics(payload.ticker)
        inserted = conn.execute(
            """INSERT OR IGNORE INTO corporate_metrics
```
and replace the end of that statement
```python
                fallback.esg_penalty,
                now,
            ),
        )
    return payload
```
with
```python
                fallback.esg_penalty,
                now,
            ),
        ).rowcount
        if inserted:
            # Defaults the app filled in, not the owner's assumption: any real edit on any PC wins.
            records_sync_store.stamp_seed(conn, KIND_CORPORATE_METRICS, payload.ticker, pc_id)
    return payload
```

In `save_metrics`, replace
```python
                payload.esg_penalty,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
    return payload
```
with
```python
                payload.esg_penalty,
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        records_sync_store.stamp(conn, KIND_CORPORATE_METRICS, ticker, get_or_create_pc_id(conn))
    return payload
```

- [ ] **Step 4: Publish from the routes**

In `apps/api/routes/corporate.py`, replace
```python
from apps.api.services import corporate_metrics_service
```
with
```python
from apps.api.services import corporate_metrics_service
from apps.api.services.records_sync import service as records_sync
```

Replace
```python
def add_corporate_company(company: CorporateCompany = Body(...)):
    """Persist a manually added company for on-demand corporate analysis."""
    return corporate_metrics_service.add_company(company)
```
with
```python
def add_corporate_company(company: CorporateCompany = Body(...)):
    """Persist a manually added company for on-demand corporate analysis."""
    saved = corporate_metrics_service.add_company(company)
    records_sync.run_records_sync("mutation")
    return saved
```

Replace
```python
def save_corporate_metrics(ticker: str, metrics: CorporateMetrics):
    return corporate_metrics_service.save_metrics(ticker, metrics)
```
with
```python
def save_corporate_metrics(ticker: str, metrics: CorporateMetrics):
    saved = corporate_metrics_service.save_metrics(ticker, metrics)
    records_sync.run_records_sync("mutation")
    return saved
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_corporate_records_sync.py tests/api/records_sync tests/api/test_corporate_registry_hides_removed.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_watchlist_resync.py -q`
Expected: PASS. A circular import between `corporate_metrics_service` and `records_sync` must not occur: `records_sync.store` imports only `peer_sync.model`, `kinds` and `merge`. If one appears, report it.

- [ ] **Step 6: Mutation matrix**

| # | File: mutation (old → new) | Test that must FAIL | Fragment |
|---|---|---|---|
| 7.1 | `corporate_metrics_service.py`: delete `records_sync_store.stamp(conn, KIND_CORPORATE_METRICS, ticker, get_or_create_pc_id(conn))` in `save_metrics` | `test_when_both_pcs_saved_the_later_save_wins` | `the later save_metrics did not win` |
| 7.2 | same file: delete `records_sync_store.stamp(conn, KIND_CORPORATE_COMPANIES, payload.ticker, pc_id)` | `test_when_both_pcs_added_the_same_company_the_later_add_wins` | `the later add_company did not win` |
| 7.3 | same file: `records_sync_store.stamp_seed(conn, KIND_CORPORATE_METRICS, payload.ticker, pc_id)` → `records_sync_store.stamp(conn, KIND_CORPORATE_METRICS, payload.ticker, pc_id)` | `test_adding_a_company_never_overwrites_assumptions_saved_on_another_pc` | `overwrote an assumption saved on the other PC` |
| 7.4 | `routes/corporate.py`: delete `records_sync.run_records_sync("mutation")` in `save_corporate_metrics` | `test_saving_through_the_route_publishes_the_record` | `did not publish` |
| 7.5 | `routes/corporate.py`: delete `records_sync.run_records_sync("mutation")` in `add_corporate_company` | `test_adding_a_company_through_the_route_publishes_both_records` | `did not publish` |
| 7.6 | `kinds.py`: delete the `KIND_CORPORATE_METRICS: Kind(…),` entry (with its import users left in place, the module still imports) | `test_a_saved_assumption_arrives_on_pc_b_and_applies_as_the_owners_assumption` | `KeyError` or `not used as a saved assumption` |

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/corporate_metrics_service.py apps/api/routes/corporate.py tests/api/test_corporate_records_sync.py
git commit -F - <<'EOF'
feat(corporate): saved assumptions and added companies reach the other PC

save_metrics and add_company stamp records sync; the routes publish after each write.
add_company's auto-inserted default metrics row ranks below any real adjustment.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Documentation, full suite and final gate

**Files:**
- Modify: `docs/architecture/database-relationships.md`
- Modify: `guideline/sop/todo.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation only.

- [ ] **Step 1: Update `docs/architecture/database-relationships.md`**

The doc's §7 requires this in the same branch. Apply these Edits (old → new):

1. `26 tables (plus SQLite's internal `sqlite_sequence`).` → `27 tables (plus SQLite's internal `sqlite_sequence`).`
2. In §2.4, replace the `corporate_metrics` row's `| no (not in `KINDS`) |` with `| yes, records-sync (`uid_column=ticker`; first-sync stamp from `updated_at`; never deleted) |`. Replace the `corporate_companies` row's `| record | no | no |` with `| record | no | yes, records-sync (`uid_column=ticker`; never deleted) |`.
3. After the `### 2.8 Other Domains` paragraph (ending `` (`services/events/price_events.py:160`).``), insert:
   ```markdown

   ### 2.9 Cleanup Bookkeeping (1)

   | Table | Purpose | PK / unique keys | Class | Rebuildable? | Synced? | Owning module |
   | --- | --- | --- | --- | --- | --- | --- |
   | `cleanup_pending` | Ticker that left the watchlist and when (UTC ISO); its caches are deleted `CLEANUP_GRACE_DAYS` (30) later if unreferenced | `ticker` PK | book | yes (a missing row is recorded as "now" by the next run) | no (each PC cleans on its own) | `services/watchlist_cleanup.py` |
   ```
4. `Declared foreign keys: **4**. Logical references: **22** (L1-L22).` → `Declared foreign keys: **4**. Logical references: **25** (L1-L25).`. After the L22 row, insert:
   ```markdown
   | L23 | `record_sync(kind='corporate_metrics', uid)` -> `corporate_metrics.ticker` | logical | n/a (never deleted) | `records_sync/kinds.py` `KIND_CORPORATE_METRICS` |
   | L24 | `record_sync(kind='corporate_companies', uid)` -> `corporate_companies.ticker` | logical | n/a (never deleted) | `records_sync/kinds.py` `KIND_CORPORATE_COMPANIES` |
   | L25 | `cleanup_pending.ticker` -> `stocks`/`news`/`corporate_statements`/`corporate_quote_facts`/`acquisition_state` rows of that ticker | logical | deferred: the run deletes those rows after 30 days when no reference remains | `services/watchlist_cleanup.py` (`CLEANUP_TABLES`, `_REFERENCE_QUERIES`) |
   ```
5. In the "Writers by table" table, replace the `corporate_metrics` / `corporate_companies` row's writers cell with ``PUT /corporate/metrics/{ticker}` (`routes/corporate.py`); `POST /corporate/companies`; records-sync apply``. Append the row `| `cleanup_pending` | `watchlist_cleanup.record_pending` from the watchlist delete route, the import, and watchlist-sync apply; `clear_pending` from every add path; the cleanup run |`. In the `stocks`/`indices`, `news`, `acquisition_state` and `corporate_statements` rows, append `; deleted by the watchlist cleanup (`watchlist_cleanup.py`)` to the writers cell, except for `indices`.
6. In §5, at the end of the "*Watchlist delete*" bullet, append: ` Since 2026-10-15 the delete also records `cleanup_pending`; after 30 days, if nothing in `watchlist_cleanup._REFERENCE_QUERIES` or `DEFAULT_COMPANIES` names the ticker, its rows in the five cache tables are deleted, one transaction per ticker (`watchlist_cleanup.py`). `corporate_metrics`, `corporate_companies` and snapshot rows are never deleted by it.`
7. In §6, append to G1: ` **Resolved 2026-10-15** (plan `docs/superpowers/plans/2026-10-15-watchlist-cleanup-and-corporate-sync.md`): deferred cleanup of the cache tables. Correction: the registry at `corporate_comparison.py:947-1016` never kept a removed ticker (it is rebuilt from `watchlist`; `indices` only supplies names). The leak was `list_companies`' direct seed-file loop, now removed.` Append to G2: ` **Resolved 2026-10-15**: both are records-sync kinds keyed by ticker (`kinds.py`).`

- [ ] **Step 2: Update `guideline/sop/todo.md`**

Insert before the line `## Known limits, accepted deliberately`:

```markdown
### Track W: Watchlist cleanup and corporate sync (G1, G2)
Plan: `docs/superpowers/plans/2026-10-15-watchlist-cleanup-and-corporate-sync.md`.
Spec: `docs/superpowers/specs/2026-10-15-watchlist-cleanup-and-corporate-sync-design.md`.
- [x] W1 `cleanup_pending` + run (30-day grace, references, savepoint per table)
- [x] W2 hooks on every watchlist add/remove path, incl. peer sync
- [x] W3 startup (gated) + daily run  - [x] W4 company list hides a deleted ticker
- [x] W5 `corporate_metrics` / `corporate_companies` records-sync kinds + write-path stamps
- [ ] W6 **Rollout:** update BOTH PCs in one session before either runs with sync on (an older
      PC skips the updated PC's whole records file; see the plan's Rollout notes).

```

- [ ] **Step 3: Full suite against the baseline**

Run: `python -m pytest -q 2>&1 | tail -30`
Expected: the only failures are the node ids recorded in Task 1 Step 1. Every new test file passes.

- [ ] **Step 4: Security and integrity checks (`guideline/sop/security-reviewer.md`)**

```bash
git diff renewal --stat
git diff renewal -- apps/ | grep -nE "API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY" || echo "no secret-like strings"
grep -n "logger\.\(info\|warning\)" apps/api/services/watchlist_cleanup.py
grep -nE "execute\(f\"" apps/api/services/watchlist_cleanup.py
```
Expected:
- the stat lists only the files in this plan's File Structure table;
- no secret-like strings;
- every log call formats only `ticker`, `table`, `rows`/`len(...)` or `error`;
- the only f-string SQL is `DELETE FROM {table} WHERE {where}`, `SELECT ... {_CLASS_LIST}` and the module constants, with the ticker always bound as `?`.

- [ ] **Step 5: Final review gate**

Run the `guideline/sop/code-reviewer.md` checklist over `git diff renewal`. Confirm three things. (a) No existing test file appears in the diff. (b) Every mutation matrix row of Tasks 1–7 was executed, and its result was recorded in the task report. (c) `git status` shows nothing outside the plan's files.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/database-relationships.md guideline/sop/todo.md
git commit -F - <<'EOF'
docs: database relationships and todo track for watchlist cleanup and corporate sync

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Self-review

**Spec coverage:**

| Spec | Task |
|---|---|
| Background G1/G2, D1 | 2, 3, 4 (deferred cleanup); 5 (hide at once) |
| D2 (never deletes snapshots, decisions, cases, `corporate_metrics`; re-add restores assumptions) | 2 (`_REFERENCE_QUERIES`, `CLEANUP_TABLES`, guard test); `corporate_metrics` is never a target, so a re-add finds it |
| D3, §3 New kinds, Merge, Applying | 6, 7 |
| D4 (no delete for corporate tables) | 6 (no tombstone path; kinds comment) |
| §1 Hide on delete | 5 (N1) |
| §2.1 tables | 2 (`CLEANUP_TABLES`; N5, N6) |
| §2.2 references | 2 (`_REFERENCE_QUERIES`, `DEFAULT_COMPANIES`; N7) |
| §2.3 store, grace, re-adding, peer removals, pre-ship tickers | 1, 2, 3 (N8) |
| §2.4 startup gate, daily, log line, failure isolation, transaction per ticker | 2, 4 (N4, N9) |
| §3 Older peers | 6 (two tests) + Rollout notes |
| §4.1 | 5 |
| §4.2 | 2 `test_one_day_before…` |
| §4.3 | 2 parametrised reference test + default + case-variant |
| §4.4 | 2 `test_a_cleanup_run_never_changes_any_other_table` + structural test |
| §4.5 | 3 `test_re_adding_within_the_grace_period…` |
| §4.6 | 2 `test_the_first_run_records…` |
| §4.7 | 2 `test_a_failure_in_one_table…` |
| §4.8 | 6 (store level), 7 (write paths, applying) |
| §4.9 | 6 `test_an_older_peer_file…` |
| Out of scope (G3–G11, deleting corporate rows, frontend) | Not touched. The Global Constraints forbid `apps/web` changes. |
| Order (backend-only branch from `renewal`) | Global Constraints, Task 1 Step 1 |

**Placeholder scan.** I removed a placeholder test function from Task 4 and replaced an invalid mutation form in 2.15. Mutation 2.13 was rewritten as a two-edit mutation, because the Python filter alone also guards the input. Mutation 5.3 was narrowed to the one test it can reach. No "TBD", "TODO" or "similar to Task N" remains.

**Type consistency.** These names are used identically across Tasks 1–8: `record_pending(conn, ticker, now=None)`, `clear_pending(conn, ticker)`, `run_cleanup(now) -> dict[str, dict[str, int]]`, `delete_ticker_caches(ticker) -> dict[str, int]`, `run_cleanup_logged() -> None`, `CLEANUP_TABLES`, `_REFERENCE_QUERIES`, `PER_TICKER_DATA_CLASSES`, `CLEANUP_GRACE_DAYS`, `CLEANUP_INTERVAL_SECONDS`, `watchlist_cleanup_cycle(run_at_start)`, `KIND_CORPORATE_METRICS`, `KIND_CORPORATE_COMPANIES`, `stamp_seed(conn, kind, uid, pc_id)`. Task 3 imports `DAY, FULL, GRACE, T0, cache_counts, seed_caches` from Task 2's test module, and all of them are defined there.

**Review Focus.** All five lines have tests in their owning tasks: 1, 2, 3 and 5 in Task 2; 4 in Tasks 6 and 7.
