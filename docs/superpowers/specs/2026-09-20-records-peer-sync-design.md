# Records Peer Sync — Design

> **Status:** implemented and merged to `renewal` as PR #48 (2026-09-22).
> **Decided with the owner on 2026-09-20.** Scope, conflict rule, record kinds and deletion
> behaviour are the owner's answers, quoted in §1.

## 1. What this is

Watchlist peer sync (`docs/superpowers/specs/2026-09-18-watchlist-peer-sync-design.md`, merged as
PR #44) keeps the ticker list identical across the owner's PCs through a cloud-synced folder. This
design extends the same mechanism to **the records the owner writes by hand**, which exist nowhere
else: a machine that dies takes them with it.

The owner's decisions:

| Question | Answer |
|---|---|
| What syncs | The owner's own work. **Not** market data: prices and statements are re-fetchable, and each PC already acquires them. |
| Conflict on the same record | **Newest edit wins, whole record.** A valuation case moves as one unit with its segments and narrative rows. |
| Which kinds | Valuation cases, investment decisions, portfolio settings, and events with their categories. |
| Deletion | **Propagates.** A record deleted on one PC is deleted on the other, and an older copy cannot revive it. |

**In scope (the synced kinds):**

| Kind | Tables | Rows today |
|---|---|---|
| `valuation_case` | `valuation_case` + its `segment` rows + their `segment_narrative` rows | 31 / 32 / 192 |
| `investment_decision` | `investment_decision` | 0 |
| `user_event` | `user_event` | 0 |
| `event_category` | `event_category` (a user category, or an override of a built-in one) | 0 |
| `event_category_visibility` | `event_category_visibility` | 4 |
| `portfolio_preferences` | `portfolio_preferences` (one row) | 1 |

`event_category_visibility` is its own kind, not part of a category: it holds a row for every
built-in category (`fomc`, `quad-witching`, `geopolitical`, `uncategorized`), which have no
`event_category` row at all until the owner overrides one. Its identity is `category_id`.

**Out of scope, deliberately:**
- Market data: `stocks`, `indices`, `corporate_statements`, `news`, `corporate_*`, `indicators`,
  `acquisition_state`. Re-fetchable, and 100 MB of it.
- `corporate_comparison_snapshots_v3` and its older versions: generated output, empty today. Add it
  later if the owner wants it; nothing here blocks that.
- The `watchlist` table, which already syncs.

## 2. Why the existing mechanism cannot just be pointed at these tables

Three properties of the watchlist path do not hold here.

**a. The ids collide.** `valuation_case`, `segment`, `investment_decision`, `user_event` all use
`INTEGER PRIMARY KEY AUTOINCREMENT`, and both PCs number from 1. `segment.case_id` and
`segment_narrative.segment_id` point at those numbers, so importing a peer's rows by id would attach
one PC's segments to another PC's case. The watchlist had a natural identity, `ticker`; these do not.

**b. There is no timestamp.** None of these tables records when a row last changed.
`portfolio_preferences.updated_at` is the only one, and `user_event.created_at` /
`event_category.created_at` record creation, not change.

**c. A record is a tree.** A valuation case owns segments, which own narrative rows. Half a case is
not a case: the merge has to move the whole tree or none of it, which is exactly what the owner's
"newest edit wins, whole record" answer asks for.

## 3. Data model

### 3.1 A stable id per record

Each top-level table gains one nullable column, `sync_uid TEXT`, with a `UNIQUE` index. It holds a
32-character hex string (`secrets.token_hex(16)`), generated when the row is created, and never
changed afterwards — not on import, not on rename.

- `valuation_case.sync_uid`
- `investment_decision.sync_uid`
- `user_event.sync_uid`
- `event_category` already has a text `id` the owner chooses (e.g. `fed`), so it needs no new column:
  its `id` IS the identity, stable across PCs by construction. The same holds for
  `event_category_visibility.category_id`.
- `portfolio_preferences` is a singleton, so its identity is the fixed string
  `portfolio_preferences`.

Children (`segment`, `segment_narrative`) get no uid. They are carried inside their parent case's
bundle and rebuilt under local ids on import.

**Why a uid rather than the natural key.** `valuation_case.case_name` is UNIQUE and looks like an
identity, but renaming a case would then read as "delete the old name, add a new one", and the two
PCs would end up holding both names. With a uid, a rename is an ordinary edit.

**Backfill.** Existing rows have `sync_uid = NULL` until the first records sync, which fills each one
with a fresh uid, exactly as the watchlist's first sync stamped existing rows. A row without a uid is
never published.

### 3.2 Where the stamps live

One new table, rather than three more columns on each synced table:

```sql
CREATE TABLE IF NOT EXISTS record_sync (
    kind       TEXT NOT NULL,   -- valuation_case | investment_decision | user_event | event_category |
                                -- event_category_visibility | portfolio_preferences
    uid        TEXT NOT NULL,   -- sync_uid, the category id, or 'portfolio_preferences'
    updated_at TEXT,            -- UTC ms, Z. NULL only between an insert and the next sync
    updated_by TEXT,            -- pc_id that authored that change
    removed_at TEXT,            -- set when the record is deleted; the row then IS the tombstone
    removed_by TEXT,
    PRIMARY KEY (kind, uid)
);
```

A deleted record keeps its `record_sync` row with `removed_at` set, so the tombstone survives after
the record's own row is gone. Tombstones are kept indefinitely: there are few, and pruning one lets
an old copy come back.

### 3.3 Reused from watchlist sync, unchanged

`apps/api/services/watchlist_sync/model.py` already provides, and this design imports rather than
copies:

- `BASELINE_TS`, `SEED_TS`, `TS_PATTERN`, `is_valid_ts`, `format_ts`;
- `next_stamp(now=None, after=None)`, including the causal rule: a local change always outranks the
  version it replaced, even when a peer's clock is ahead;
- the change-key rule: `add_key = (updated_at, updated_by)`, `remove_key = (removed_at, removed_by)`,
  larger tuple wins, authorship never rewritten on import or republish.

`store.get_or_create_pc_id` provides the PC id, and both features share it: the same PC is the same
author for both files.

**These modules move to a shared location.** `model.py` is already generic; it moves to
`apps/api/services/peer_sync/model.py`, and `watchlist_sync` imports it from there. No behaviour
changes, and the watchlist tests keep passing unchanged. Nothing else is moved: `watchlist_sync`'s
files, store and service keep their current shape, per the owner's choice of approach A over a
rewrite.

## 4. The peer file

Each PC writes one more file beside its watchlist file, in the same folder:

```
<MONEYVIEW_SYNC_DIR>\MoneyView\records.<pc_id>.json
```

```json
{
  "format_version": 1,
  "pc_id": "DESKTOP-A1B2-4f9c",
  "written_at": "2026-09-20T02:03:04.567Z",
  "records": [
    {
      "kind": "valuation_case",
      "uid": "9f2c…",
      "updated_at": "2026-09-19T23:10:00.000Z",
      "updated_by": "DESKTOP-A1B2-4f9c",
      "payload": { "case": { "…": "every valuation_case column except id, sync_uid and parent_case_id",
                             "parent_uid": "the sync_uid of the case parent_case_id points at, or null" },
                   "segments": [ { "…": "segment columns except id and case_id",
                                   "narratives": [ { "…": "segment_narrative columns except segment_id" } ] } ] }
    }
  ],
  "removed": [
    { "kind": "user_event", "uid": "1a7b…", "removed_at": "2026-09-19T22:00:00.000Z", "removed_by": "DESKTOP-A1B2-4f9c" }
  ]
}
```

Rules carried over from the watchlist file, and enforced the same way:
- only names fully matching `records\.([A-Za-z0-9-]+)\.json` count;
- a file whose `pc_id` inside differs from its filename is skipped and reported;
- this PC's own file is never a merge input;
- the write is `.tmp` then `os.replace`;
- an unreadable or invalid file is skipped and reported, never read as empty, and never blocks the
  others;
- before publishing, this PC parses its own payload with the reader's parser and refuses to write a
  file peers would reject.

**Fork lineage travels by uid.** `parent_case_id` points at a local id, so it never travels. The
case payload carries `parent_uid` in its place: the `sync_uid` of the parent case, or `null`. On
apply, once every case is in place, it is resolved to this PC's local id of the case with that
uid, or to NULL when that case is not present here.

**Validation is per kind.** Each kind declares its columns and their types, and a record whose
payload does not match its kind is rejected with the file. A payload column the local schema does not
have is an error, not something to ignore: it means the peer runs a newer schema, and guessing would
corrupt a record. So is any value the local schema would refuse at apply -- a null in a NOT NULL
column, a value outside a CHECK's set, or a category (or visibility) payload whose own id differs
from its uid -- because failing at apply would roll back every kind on every sync.

Expected size today: 31 cases with 192 narrative rows is well under 1 MB, so the whole state is
republished on every sync, as the watchlist does. If the file ever exceeds about 5 MB, that is the
signal to revisit, and §9 records it.

## 5. Merge

Per `(kind, uid)`, from this PC's state and every readable peer file:

```text
latest_add    = the record with the largest add_key
latest_remove = the tombstone with the largest remove_key
if latest_remove exists and remove_key > add_key, or no record exists
                 -> absent: delete the local record; keep the tombstone
else             -> present: store latest_add's payload whole, with its own updated_at/updated_by
```

**Whole-record replacement.** Applying a record replaces its entire tree: every column of the case
row, then all its segments and narratives, deleted and re-inserted from the payload under fresh local
ids. This is what makes "newest edit wins, whole case" true rather than approximately true. The case
row itself is updated in place, keeping its local id, because a local fork's `parent_case_id` points
at that id; only the children are deleted (`ON DELETE CASCADE` takes the narratives with their
segments).

**A record is only rewritten when it actually differs.** Applying an identical payload is skipped, so
local ids stay stable across syncs and `AUTOINCREMENT` does not run away.

**Natural-key collisions between different uids.** `valuation_case.case_name` is UNIQUE. Two PCs can
independently create different cases with the same name, so the merge can hold two uids claiming one
name. The newer `add_key` keeps the name; the older one is renamed to
`<name> (from <pc_id>)`, kept, and reported in the status once, by the sync that performs the
rename; later syncs do not report it again. Nothing the owner wrote is deleted to resolve a name
clash -- including two `conservative_<TICKER>_<vintage>` cases, whose names are deterministic, so
both PCs hold one: both copies are kept. The rename is a local repair, not a new authored change:
it does not restamp the record.

**First sync** is a union, exactly as the watchlist's was: records that exist before sync is first
enabled are stamped `(BASELINE_TS, own pc_id)`, so both PCs' pre-existing work survives, and any real
edit afterwards outranks it. No tombstones are invented.

## 6. When it runs

The same triggers as the watchlist, so there is one story to remember, and no polling:

| Trigger | Why |
|---|---|
| API startup, best effort | A PC that was off catches up before anything is shown. |
| `GET /api/v1/valuation/cases`, `GET /api/v1/decisions`, `GET /api/v1/market/events`, `GET /api/v1/market/event-categories`, `GET /api/v1/portfolio/preferences` | A page never shows an older state than a readable peer file holds. |
| Any create, edit or delete of a synced record | The change reaches the folder without the owner doing anything. |

`run_records_sync` does read → merge → SQLite apply → write, under its own process lock and
`BEGIN IMMEDIATE`, and it never raises: a failure is recorded and the local records keep working. It
is called only after the caller's own transaction has committed, because `BEGIN IMMEDIATE` would
otherwise wait on it.

Records sync and watchlist sync are independent: one failing does not stop the other.

## 7. Status and failure

`GET /api/v1/portfolio/watchlist/peer-sync` reports the watchlist's last attempt. This design adds
the same shape for records under a neutral route:

```
GET /api/v1/sync/status  ->  { watchlist: {…}, records: {…} }
```

Each half has the existing fields: `enabled`, `pc_id`, `peers`, `skipped_files`, `last_sync_at`,
`last_error`, and records adds `renamed`, the list of name clashes repaired in §5. The existing
watchlist route stays, so the Portfolio page needs no change.

The Portfolio status line is unchanged. Records status is shown where the records live: one line on
the Valuation, Decisions and Events pages, with the same wording and the same states as the
watchlist's, plus one state for a repaired name clash. A failure never blocks a page: the records are
local, and the line says "changes are kept on this PC".

## 8. Config, migration and testing

**Config.** The same switch, `MONEYVIEW_SYNC_DIR` in `config/.env`. With it unset, nothing changes.
There is no separate switch: the owner asked for their PCs to match, not for two dials.

**Migration.** The new column and table are additive: `ALTER TABLE … ADD COLUMN sync_uid TEXT`, a
unique index, and `CREATE TABLE record_sync`. Existing rows keep every value. Rows that existed
before the migration keep `sync_uid = NULL` until the first records sync backfills them, but every
row created afterwards gets a uid and a stamp when it is written, whether sync is on or off (§3.1
and the timestamps rule below). With sync off, nothing reads them, and the app behaves exactly as
before.

**Timestamps are maintained whether sync is on or off**, as the watchlist does, so a change made
while sync is off keeps its real time and wins on merit when sync is turned back on. Tombstones are
recorded only while sync is on.

**Tests.** The watchlist's test shape carries over, and these are the cases that must exist:

| Area | Test |
|---|---|
| Merge | Later edit wins; delete-then-re-add keeps the record; a newer remote delete removes an older local record; an older remote delete does not remove a newer local record; equal timestamps decided by author. |
| Whole-record | A case whose segment list shrank on one PC does not keep the removed segment on the other. |
| Tree integrity | After applying a peer's case, every segment belongs to that case and every narrative to its segment; no orphan rows. |
| Identity | A renamed case is one record, not two. Two independently created cases with the same name both survive, one renamed, and the rename is reported. |
| Backfill | Rows created before sync get a uid on first sync and are published with `BASELINE_TS`. |
| Two PCs | Propagation of each kind; a deletion propagates; imported tombstones are republished to a third PC; both PCs converge on identical state after two rounds. |
| Failure | A missing folder, an unreadable peer file, and a failed publish each keep local records intact and set `last_error`; an unreadable file is never read as empty. |
| Isolation | A records failure does not stop the watchlist sync, and the reverse. |
| Concurrency | A local write committed during a records sync is not lost. |
| Off | With `MONEYVIEW_SYNC_DIR` unset: no files, no tombstones, no uid backfill, and no behaviour change on any page. |
| Privacy | pytest and the e2e API never read `config/.env` (`MONEYVIEW_SKIP_LOCAL_ENV=1`), so no test can write into the owner's real folder. |

Every test must be shown to fail against a named broken implementation before it is trusted
(CLAUDE.md §8).

## 9. Known limits, accepted

- **Whole-state republish.** Each sync writes the whole record set. Fine at today's size; revisit if
  the file passes about 5 MB.
- **Whole-record conflict resolution.** Editing the same case on both PCs loses the older edit. This
  is the owner's decision, chosen over a field-level merge that could produce a model nobody wrote.
- **Market data still downloads per PC.** A new PC re-acquires prices and statements. Out of scope by
  the owner's decision.
- **Comparison snapshots are not synced.**
- **A schema change must ship to both PCs together.** A peer file from a newer schema is rejected and
  reported rather than half-applied, so the owner sees "file skipped" until both PCs run the same
  version.

## 10. Recommended build order

1. The shared `peer_sync` move and the schema migration (uid column, `record_sync`), with the
   watchlist untouched behaviourally.
2. The pure merge over kinds, with the whole-record and name-clash rules.
3. The record file: read, validate per kind, write atomically.
4. `run_records_sync` and the store: backfill, apply, tombstones.
5. Wiring: the four page triggers, the mutation triggers, startup, and the `/sync/status` route.
6. The status line on Valuation, Decisions and Events.
7. Docs: `docs/local-run-resources.md` and `docs/architecture/storage-model.md`.
