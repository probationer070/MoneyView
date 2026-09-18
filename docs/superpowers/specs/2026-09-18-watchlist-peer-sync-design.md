# Watchlist peer sync: design

> **Status:** Implemented on branch `watchlist-peer-sync` (2026-09-18).
>
> **Scope:** personal use across the owner's own PCs, not an open-source feature. The repository
> is public, so this design also takes the owner's watchlist **out of** the committed seed file.
>
> **Review:** sections 1–3 were each reviewed in chat. The owner's detailed feedback on every
> section is already applied below, as is the owner's final review of the complete document (15 points).

## What was asked

Keep the stock list, meaning the whole Watchlist section, identical on two (or more) PCs. That
includes every ticker added on either PC, not only tickers in the committed seed.

## Decisions taken with the owner

| Question | Decision |
| --- | --- |
| What syncs | **The Watchlist only**: every ticker in every group, with `name`, `sector`, `group_name`, `weight`. Not chart events, the decision log or snapshots. |
| Transport | **A cloud-synced folder** the owner already has (OneDrive, Google Drive or Dropbox). No server, and the PCs never need to be on at the same time. |
| Conflicts | **Merge per ticker.** The newest change wins, and removals are remembered so a deleted ticker is not revived by an older copy. |
| When | **Automatically**: on API start, on every Watchlist read, and after every Watchlist change. No sync button, no background polling. |
| Layout | **Approach A**: each PC writes only its own file, and every PC merges all the files. |
| Public seed | **Replace it with neutral defaults.** The old list stays in existing git history; no history rewrite is done. |

## What exists today

- The **SQLite `watchlist`** table is the authority. Columns: `ticker` (`NOT NULL UNIQUE`), `name`, `sector`,
  `group_name` (default `custom`) and `weight`.
- **The committed seed `apps/api/services/webscrap/stock_targets.json`** holds the owner's list today: a
  `custom` group and a `total` group.
- **Code paths that touch the seed:**
  - `ensure_watchlist_bootstrapped` seeds an empty DB, from the file or from 5 built-in defaults.
  - `merge_missing_watchlist_items`, on every `GET /portfolio/watchlist`, adds seed tickers the DB lacks. It is
    the git-based way new tickers reached a second PC (ERROR-LOG.md 2026-09-12).
  - The Portfolio page's **Export JSON** (`POST /portfolio/watchlist/sync`) writes the DB list **into the
    committed file**.
  - **Import JSON** (`POST /portfolio/watchlist/resync`) runs `DELETE FROM watchlist` and replaces the table
    from the file.
  - `corporate_metrics_service` calls the bootstrap as well.
- **What git-based sync can't do:** it is one-way and only adds. Deletions, group changes and weight changes
  never reach the other PC.
- **`config/.env` is never loaded.** `config/.env.example` exists and `python-dotenv` is a dependency, but no code reads the file.

## Three separate artifacts

These must never be confused. Much of this design exists to keep personal data out of the first one.

| Artifact | Path | Contents | In git |
| --- | --- | --- | --- |
| Public starter seed | `apps/api/services/webscrap/stock_targets.json` | 5 neutral default tickers | yes, public |
| Peer sync files | `<MONEYVIEW_SYNC_DIR>\MoneyView\watchlist.<pc_id>.json` | each PC's full merged state, with timestamps and tombstones | never |
| Personal export | `data/exports/watchlist-export.json` | the current Watchlist in the plain seed format, with no timestamps or tombstones | never (`data/exports/` is explicitly git-ignored) |

---

## 1. Data model and file format

### Identity

`ticker` is the unique identity of a Watchlist entry, and the schema already enforces this. A ticker
belongs to exactly one group. `name`, `sector`, `group_name` and `weight` are attributes of that
ticker, and they sync together as one row.

### Local schema additions (additive migration)

| Field | Meaning |
| --- | --- |
| `watchlist.updated_at` TEXT | The row's **logical modification time**, as UTC ISO-8601 with milliseconds, e.g. `2026-09-18T11:00:00.123Z`. It is set when the row is added or any synced field actually changes. An import keeps the incoming value. It never changes on a read, on a merge that keeps the local row, on a file rewrite, or on a restart. |
| `watchlist.updated_by` TEXT | The `pc_id` of the PC that **authored** the change. A PC republishes rows it has imported, so the author can't be taken from the file's `pc_id`. Without it, the winner of a tie could change depending on which PC happened to republish. |
| `watchlist_removed(ticker TEXT PRIMARY KEY, removed_at TEXT, removed_by TEXT)` | Tombstones. A delete removes the row and upserts the tombstone. Tombstones are kept indefinitely: there are few, and pruning one could let an old copy come back. When a newer add or edit wins, the older tombstone **stays stored and is simply ineffective**; it is still published, and it loses every comparison against that newer add. |

Both kinds of change are ordered by the same **change key**, compared as a tuple. **The larger tuple wins.**

```text
add_key    = (updated_at, updated_by)    for a watchlist row
remove_key = (removed_at, removed_by)    for a tombstone
```

**Authorship never changes in transit.** Importing a row or tombstone from a peer file stores its
`updated_by`/`removed_by` exactly as received, and republishing writes it out unchanged. Only a
change actually made on this PC sets the author to this PC's `pc_id`. Republish stability depends on
this: every copy of one change carries the same key, whichever PC's file it is read from.

### `pc_id`

- Generated once as the computer name, a hyphen, and 4 random lowercase hex digits, e.g. `DESKTOP-A1B2-7f3a`.
- Stored in this database's `dataset_metadata` (`dataset_name = 'watchlist_sync_pc_id'`), so it stays the same for this data directory even if the PC is renamed.
- Never derived from a filename.

### Baseline timestamp

`BASELINE_TS = "1970-01-01T00:00:00.000Z"` is a **fixed constant**, never generated. Rows that
exist when sync is first enabled get it. Every real change made after sync is enabled is newer than
the baseline, so it wins. Two baseline rows are decided by the author `pc_id`.

Rows seeded from the starter seed (the bootstrap and the sync-off seed merge) get
`SEED_TS = "0000-01-01T00:00:00.000Z"` instead. It is below the baseline, so a starter default never
outranks a real installation's row or any tombstone, whichever PC's id sorts higher.

### Causal stamps

A local change is stamped strictly above the last stamp this process issued **and** above the current
`updated_at` of the ticker's row and `removed_at` of its tombstone. A change therefore outranks the
version the user saw, even when that version came from a peer whose clock runs ahead of this PC's, or
this PC's clock stepped back. A delete records its tombstone before removing the row, so the tombstone
sees the row it replaces.

### Peer file

Path: `<MONEYVIEW_SYNC_DIR>\MoneyView\watchlist.<pc_id>.json`, UTF-8. Each PC writes only its own file.

```json
{
  "format_version": 1,
  "pc_id": "DESKTOP-A1B2-7f3a",
  "written_at": "2026-09-18T11:00:00.123Z",
  "watchlist": [
    {"ticker": "AAPL", "name": "Apple Inc.", "sector": "Technology", "group_name": "custom",
     "weight": 0.1, "updated_at": "2026-09-18T10:59:58.001Z", "updated_by": "DESKTOP-A1B2-7f3a"}
  ],
  "removed": [
    {"ticker": "MSFT", "removed_at": "2026-09-18T10:30:00.000Z", "removed_by": "LAPTOP-C3D4-19c2"}
  ]
}
```

- A PC publishes its **whole merged state**, including tombstones it has imported, so removals keep
  propagating.
- `written_at` records when this PC last wrote the file successfully. It is used for diagnostics and the
  status line only. It never decides a merge.

**Which files count:** only names matching exactly `watchlist.<pc_id>.json`, where `<pc_id>` matches
`[A-Za-z0-9-]+`. Temporary files (`*.tmp`) and conflict copies with spaces or brackets, such as
`watchlist.X (1).json`, never match. A conflict copy that does match the pattern, such as
`watchlist.X-DESKTOP.json`, is caught by the second rule: a matching file whose content `pc_id`
differs from its filename is skipped and reported.

### Merge (per ticker)

The inputs are the local database plus every readable peer file.

```text
latest_add    = the row with the largest add_key       among the local DB and all peer files
latest_remove = the tombstone with the largest remove_key among the local DB and all peer files
if latest_remove exists and remove_key(latest_remove) > add_key(latest_add), or no row exists
                 -> absent:  delete the local row; store latest_remove as the tombstone
else             -> present: store latest_add, with its own updated_at and updated_by (as received);
                             store latest_remove too, if any (kept, but ineffective)
```

**This PC's own file is never a merge input.** The local database is this PC's authority; its own
file is only ever written. A file that carries this PC's filename but a different `pc_id` inside is
ignored as an input, reported, and replaced by this PC's next successful publish.

File modification times and the order in which files arrive play no part in the merge. After a merge,
the local database is the effective state, and it is what this PC publishes.

### First sync

This runs once per data directory and is recorded in `dataset_metadata`
(`dataset_name = 'watchlist_sync_enabled_at'`).

- Every existing row that has no `updated_at` yet gets `updated_at = BASELINE_TS` and
  `updated_by = <own pc_id>`. This covers every row of an installation that predates this feature.
- Rows that already carry a timestamp keep it. They exist because timestamps are maintained even while
  sync is off (§1, Switch): any row added or edited after this feature ships, but before sync is first
  enabled, already has a real `updated_at`. That change is real, so it keeps its time and beats a
  baseline row from another PC.
- No tombstones are created for tickers deleted earlier.
- **The first merge between PCs is therefore the union** of their Watchlists. Only deletions made after
  sync was enabled can propagate.

### Atomic writes and failure behaviour

- **Writing:** write `watchlist.<pc_id>.json.tmp` in the same folder, then `os.replace` it onto the final
  name. If the replace fails, the previous valid file is left untouched.
- **Unreadable peer files are skipped, never read as empty.** A file is skipped if it:
  - can't be opened;
  - is an online-only placeholder that isn't available yet;
  - is invalid JSON or fails schema validation;
  - has an unsupported `format_version`.

  Each skip is recorded, and the file is retried on the next trigger.
- MoneyView never writes, deletes or repairs another PC's file.
- **Sync never breaks the local Watchlist.** A sync failure never rolls back or discards a successful local
  change, and `GET /portfolio/watchlist` never fails because of sync (§2).

### Switch

`MONEYVIEW_SYNC_DIR`, read by the backend.

- **Unset:** sync is off. No files, no merge, no tombstones, and no visible change in behaviour.
- **Set:** sync is on.
- **Row timestamps are kept current whether sync is on or off.** Every change to a synced field sets
  `updated_at` and `updated_by`; the `pc_id` is generated on first need. This is invisible while sync is off.
  It is what keeps switching sync off and back on safe: without it, edits made while off would carry stale
  timestamps and could lose to older peer rows.
- **Tombstones are recorded only while sync is on.** Deletions made while sync is off do not propagate.

---

## 2. When it runs and what you see

Sync runs only while `MONEYVIEW_SYNC_DIR` is set.

| Trigger | Behaviour |
| --- | --- |
| API startup | Best-effort read → merge → write. A failure is recorded as `last_error`, and **startup never fails** because of it. |
| `GET /portfolio/watchlist` | Read → merge → write, then respond. **Invariant:** the response never shows an older state than any readable peer file holds. |
| Any change to a synced Watchlist field (the rule applies to every synced field, current and future) | Set `updated_at` to a causal stamp (§1: `now`, raised above the stamps the change replaces) and `updated_by = own pc_id`, then publish. |
| Any delete | Upsert the tombstone with `removed_at` = a causal stamp and `removed_by = own pc_id`, delete the row, then publish. |

**Rules:**
- **One lock per API process** covers the whole transaction: read peer files → merge → update the local
  DB → write this PC's file.
- **No background polling.** A change made on another PC appears once its file has reached this PC and a
  trigger runs, e.g. loading the Portfolio page or returning to its browser tab (React Query refetches on
  focus).
- **Size:** the files stay small, around 150 tickers, so no background processing is needed.
- **A peer** is any valid `watchlist.<pc_id>.json` in the folder whose `pc_id` differs from this PC's.

### `GET /portfolio/watchlist` when the folder is missing or unwritable

The route returns **HTTP 200** with the local Watchlist, which is the last merged state. `last_error`
is recorded and reported by the status route. This is the core local-first guarantee.

### Status: `GET /portfolio/watchlist/peer-sync`

This route is **read-only**. It reports the last recorded sync and never triggers one:

```json
{"enabled": true, "pc_id": "DESKTOP-A1B2-7f3a",
 "peers": [{"pc_id": "LAPTOP-C3D4-19c2", "written_at": "2026-09-18T11:02:00.000Z"}],
 "skipped_files": [], "last_sync_at": "2026-09-18T11:03:10.500Z", "last_error": null}
```

**Lifecycle:** every sync attempt replaces the recorded status as a whole.
- `skipped_files` lists the files skipped **during the last attempt only**. It is not an accumulating
  history.
- `last_error` is the last attempt's error. A later attempt that completes (the folder is reachable and
  this PC's file is written) sets it back to `null`, so a transient cloud problem does not leave a
  permanent warning. Skipped peer files alone do not set `last_error`; they are reported in
  `skipped_files`.
- The status lives in memory in the API process. After a restart it is refreshed by the startup sync.

The Portfolio page shows one status line beside the holdings count. The time shown is the **most recent**
peer `written_at`.

| State | Display |
| --- | --- |
| Off | *(nothing)* |
| OK | `Synced with 1 other PC · 11:02`, or `Synced with 2 other PCs · latest 11:02` |
| No peers yet | `Sync on · no other PC has synced yet` |
| A peer file skipped | `Synced · 1 file skipped, will retry` |
| Folder unavailable | `Sync unavailable · changes are kept on this PC`, in the warning colour |

### Configuration

- **Loading:** at startup the API loads `config/.env` from the repository root using `python-dotenv` with
  `override=False`. A real environment variable therefore still wins, and a missing file is not an error.
  This makes the existing `config/.env.example` convention work.
- **Example file:** `MONEYVIEW_SYNC_DIR=` is added to `config/.env.example`, left empty.

**Setup, once per PC:**
1. Set `MONEYVIEW_SYNC_DIR=C:\Users\<you>\OneDrive\MoneyView-sync` in `config/.env`.
2. Restart MoneyView.

For OneDrive, setting the folder to "Always keep on this device" is recommended but not required: an
online-only file is handled as "skipped, will retry". This is documented in
`docs/local-run-resources.md`.

---

## 3. The public seed, the existing paths, and testing

### The neutral seed file

After the change, `apps/api/services/webscrap/stock_targets.json` is exactly:

```json
{
  "custom": {
    "targets": [
      {"ticker": "AAPL", "name": "Apple", "sector": "Technology", "weight": 0.0},
      {"ticker": "MSFT", "name": "Microsoft", "sector": "Technology", "weight": 0.0},
      {"ticker": "NVDA", "name": "NVIDIA", "sector": "Semiconductors", "weight": 0.0},
      {"ticker": "GOOGL", "name": "Alphabet", "sector": "Communication Services", "weight": 0.0},
      {"ticker": "AMZN", "name": "Amazon", "sector": "Consumer Discretionary", "weight": 0.0}
    ]
  },
  "total": {"targets": []}
}
```

- **Format:** the existing seed format, `{"<group>": {"targets": [{ticker, name, sector, weight}]}}`. The
  loader accepts an empty `targets` list.
- **Git history:** the old list remains in existing git history. **No history rewrite is performed.**
- **Existing installations are safe whatever the order.** Both the seed merge and the bootstrap only ever
  *add* (`INSERT OR IGNORE`), so a PC that pulls the smaller file loses nothing.
- **Recommended order for the owner:**
  1. Enable sync on both PCs.
  2. On each PC, check that the status line reads "Synced with 1 other PC", **and** that the Watchlist
     itself holds every ticker from both PCs. The status line only proves a peer file was read, not that
     the lists match.
  3. Then merge the PR that swaps the seed file.

### The four existing paths

| Path | Sync off | Sync on |
| --- | --- | --- |
| **Seed merge**: `merge_missing_watchlist_items` on `GET /portfolio/watchlist` | unchanged | **skipped.** Sync replaces it, and it would revive a ticker deleted on another PC. |
| **Bootstrap** of an empty DB: `ensure_watchlist_bootstrapped`, used by Portfolio and by Corporate's `seed_watchlist_from_json_if_empty` | unchanged | Precedence as below |
| **Export JSON**: `POST /portfolio/watchlist/sync` | **writes `data/exports/watchlist-export.json`** | **writes `data/exports/watchlist-export.json`** |
| **Import JSON**: `POST /portfolio/watchlist/resync` | unchanged: replace from the committed seed | **UI:** button hidden. **API:** `409` "Import is unavailable while watchlist sync is on". The server guard is authoritative; hiding the button is only convenience. |

**Bootstrap precedence while sync is on.** This check runs inside the sync lock, after peer discovery:

1. At least one readable peer file exists → run the normal merge. The empty DB becomes the **merged
   effective state across all readable peer files**, not one arbitrary peer. No defaults are seeded,
   even if that merged state is empty.
2. No peer file at all, readable or skipped → run today's bootstrap: seed from the committed file. If that
   file is missing or unreadable, the existing hard-coded `DEFAULT_WATCHLIST_ITEMS` fallback applies,
   exactly as today. This is the committed seed file, not a sync file: its absence is not a sync failure
   and sets no `last_error`. The seeded rows get `updated_at = SEED_TS` and `updated_by = own pc_id`.
3. Only unreadable (skipped) peer files → nothing is seeded and the PC is not marked bootstrapped. An
   unreadable peer is never "no peers": the PC stays empty until a later sync reads the file.

**Export and Import are independent rules:**
- Export is **always** retargeted, whether or not sync is on. It never writes anywhere under
  `apps/api/services/webscrap/`.
- The output is the plain seed format (group → targets, with no timestamps or tombstones). The
  directory is created if missing.
- The button label and success message name the new path.
- Import's behaviour depends on sync, as in the table above.

### Testing

Every new test must be shown to fail against a named broken implementation before it is trusted
(CLAUDE.md §8).

**Merge function** (pure, no filesystem):

| Scenario | Expected |
| --- | --- |
| Add, then edit | The edit wins. |
| Remove, then re-add | The re-add wins. |
| Remove, then edit (revive) | The edit wins. |
| **A newer remote removal against an older local row** | The row is deleted. The timestamps are set explicitly, so this tests the ordering rule and not just that the removal arrives. |
| An older remote removal against a newer local row | The row stays. |
| Equal timestamps | The larger `updated_by` wins. |
| **Republish stability** | Copying A's change into B's file (same `updated_by`) does not change the winner. |
| **Authorship kept on import** | A row imported from B's file keeps `updated_by = B` in A's database and in A's published file. |
| **Three-way conflict**: A, B and C each hold a different version of one ticker | Every merge order converges on the same `(updated_at, updated_by)` winner. |
| Baseline rows on two PCs | The result is the union. |

**Two simulated PCs** (two SQLite files, two `pc_id`s, one temporary sync folder):
- **Propagation:** a ticker added on A appears on B. A deletion on B removes the ticker on A.
- **Imported tombstones are republished** (three PCs). B deletes a ticker; A syncs and republishes B's
  tombstone; B's file is then removed from the folder; C syncs and still deletes the ticker, from A's
  file alone.
- **Independent edits:** simultaneous edits to different tickers both survive.
- **First sync** gives the union. No earlier deletion is reconstructed.
- **Fresh PC with peers:** a new, empty PC takes the merged peer state (from two peers), not the defaults.
- **Empty merged peer state:** readable peer files exist, but their merged Watchlist is empty (everything
  is tombstoned). The fresh PC stays empty, and no defaults are inserted.
- **Fresh PC without peers:** a new, empty PC with no peers gets the 5 defaults at `SEED_TS`.
- **Fresh PC with only an unreadable peer file** stays empty, and the file is listed in `skipped_files`.
- **Seeded defaults never outrank a real row**, even from a PC whose id sorts higher.
- **Off, then on again:** an edit made while sync was off keeps its real timestamp, and wins over an
  older peer row once sync is switched back on.
- **Seed merge must not revive a deletion** (critical regression test). With sync on, a ticker deleted on
  B and present in the committed seed is **not** re-added by `merge_missing_watchlist_items`.
- **Convergence invariant:** after a sequence of operations on A and B, run sync on both twice. Both
  databases then hold identical effective Watchlists (the same rows, timestamps and tombstones).

**Filesystem:**

| Scenario | Expected |
| --- | --- |
| Invalid JSON in a peer file | Skipped, reported, not treated as empty. The local rows it would otherwise "empty" survive. |
| Valid JSON with an unsupported `format_version` | Skipped and reported. |
| A file whose content `pc_id` doesn't match its filename | Skipped and reported. |
| `watchlist.X.json.tmp` holding a different state | Ignored by the merge. |
| Conflict-copy names such as `watchlist.X (1).json` | Ignored. |
| **Atomic write failure** (a simulated `os.replace` failure) | The previous valid file is intact and still parses. |
| **Failed publish, then retry** | A publish failure is **injected** by patching the write/replace call, not by OS folder permissions, which are unreliable on Windows and OneDrive. A local edit succeeds and is kept in SQLite, and `last_error` is set. The injection is removed; on the next `GET /portfolio/watchlist` the file contains the edit and `last_error` is `null`. |
| **Partial peer availability** (three PCs) | A's file is valid, B's is invalid JSON, C's is valid. The merge includes A's and C's changes, and `skipped_files` lists only B's file. |
| **Own filename, foreign content** | A file named with this PC's id but a different `pc_id` inside is not used as a merge input, is reported, and is replaced by this PC's next publish. |
| **Skipped-file lifecycle** | A file skipped in one attempt is no longer listed after a later attempt in which it reads correctly. |

**Routes and startup:**
- `GET /portfolio/watchlist` returns the merged list.
- With a missing folder it returns **200** with the local list, and `/peer-sync` reports `last_error`.
- `/peer-sync` is read-only: this PC's file modification time and the DB are unchanged after the call.
- **`pc_id` persistence:** closing and reopening the same database returns the same `pc_id`, and changing
  the reported computer name (patched) does not change it.
- **Startup with an unavailable folder** doesn't prevent the API from starting.
- **Import cannot bypass the UI restriction:** `POST /portfolio/watchlist/resync` returns `409` while sync
  is on. The server guard is authoritative.
- Export writes `data/exports/watchlist-export.json` and nothing under `apps/api/services/webscrap/`, both
  with sync on and with sync off.
- `config/.env` is loaded, and a real environment variable overrides it.
- **Seed migration, separate from sync:** with sync off, replacing the committed seed with the neutral
  file leaves every existing local row unchanged, including weights and groups.

**Playwright** (mocked API):
- The status line's five states.
- The Import button is hidden while sync is on.
- The Export message names `data/exports/watchlist-export.json`.

## Out of scope

- Syncing anything other than the Watchlist.
- Background polling or file watchers.
- A conflict UI.
- Scrubbing git history.
- Pruning tombstones.
- Syncing the per-machine group-display preference (`portfolio_preferences`).
