# Records Peer Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync the records the owner writes by hand — valuation cases with their segments and
narratives, investment decisions, user events, category overrides, category visibility and portfolio
settings — between the owner's PCs, through the cloud folder the Watchlist already uses.

**Architecture:**
- A shared `peer_sync` package holds what both features use: the timestamp rules, change keys and
  causal stamps that watchlist sync already ships.
- A kind registry describes each synced record type: its table, its identity, its columns, and how to
  read and write one record.
- A pure merge orders records by `(updated_at, updated_by)` and tombstones by
  `(removed_at, removed_by)`, per `(kind, uid)`, replacing a record whole.
- `records.<pc_id>.json` carries this PC's whole record set, written atomically beside
  `watchlist.<pc_id>.json`.
- `run_records_sync` does read → merge → SQLite apply → write under its own lock, and never raises.

**Tech Stack:** Python 3.13, FastAPI, Pydantic v2, SQLite 3.51; Next.js 16, React 19, TanStack Query
v5; pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-records-peer-sync-design.md`. Read it first; this plan
implements it.

## Global Constraints

- **Identity.** Every synced record has a stable `uid`:
  - `valuation_case`, `investment_decision`, `user_event`: a new `sync_uid TEXT` column, 32 hex chars
    from `secrets.token_hex(16)`, generated once and never changed — not on import, not on rename.
  - `event_category`: its existing text `id`.
  - `event_category_visibility`: its `category_id`.
  - `portfolio_preferences`: the fixed string `portfolio_preferences`.
- **Change keys** (unchanged from watchlist sync): `add_key = (updated_at, updated_by)`,
  `remove_key = (removed_at, removed_by)`; the larger tuple wins; authorship is never rewritten on
  import or republish.
- **Causal stamps.** A local change always outranks the version it replaced:
  `next_stamp(after=<the record's current stamp>)`.
- **Whole-record replacement.** Applying a valuation case replaces the case row and all its segments
  and narratives from the payload. Half a case is never applied.
- **Timestamps are maintained whether sync is on or off. Tombstones are recorded only while sync is
  on.** Same rule as the Watchlist.
- **Timestamps** are UTC ISO-8601 with exactly 3 fractional digits and a `Z`. `BASELINE_TS` is
  `1970-01-01T00:00:00.000Z`.
- **The file:** `<MONEYVIEW_SYNC_DIR>\MoneyView\records.<pc_id>.json`, `format_version` 1, matched by
  `records\.([A-Za-z0-9-]+)\.json` only; a `pc_id` inside that differs from the filename is skipped
  and reported; this PC's own file is never a merge input; write `.tmp` then `os.replace`; validate
  the payload with the reader before publishing.
- **Failure:** a sync failure never fails a request or startup; an unreadable peer file is skipped and
  reported, never read as empty; one bad file never blocks the others.
- **Independence:** a records-sync failure never stops watchlist sync, and the reverse.
- **Switch:** the same `MONEYVIEW_SYNC_DIR`. Unset means nothing happens: no files, no tombstones, no
  uid backfill.
- **Tests:** every new test must be shown to FAIL against a named broken implementation before it is
  trusted (CLAUDE.md §8). Each task ends with a mutation check.
- **Line endings:** repo text files are CRLF in the working tree (`core.autocrlf=true`).
- **Python:** from the repo root, `C:\Users\eajwa\anaconda3\envs\moneyview\python.exe -m pytest ... -p no:cacheprovider`, with `PYTHONPATH` set to the repo root.
- **Playwright:** one run at a time, ports 8110/3101; check the ports before and after.
- **Git:** merges only, never rebase or force-push. Never commit `apps/web/package-lock.json`.

## Facts checked against the code (2026-09-20)

| Fact | Where |
|---|---|
| Valuation cases have **no edit and no delete route**: create (`POST /api/v1/valuation/cases`) and fork (`POST /cases/{id}/fork`) only | `apps/api/routes/valuation.py:40,106` |
| Case writes go through one service | `valuation_case.create_case` (`apps/api/services/valuation_case.py:154`), which inserts the case, its segments and their narratives in one transaction |
| Case and segment column tuples already exist | `_CASE_COLUMNS`, `_SEGMENT_COLUMNS` (`valuation_case.py:44,53`) |
| Decisions are append-only | `investment_decision.record_decision` (`apps/api/services/investment_decision.py:110`) |
| Events have full CRUD in one store | `apps/api/services/events/store.py`: `insert_user_event`, `update_user_event`, `delete_user_event`, `upsert_category_override`, `delete_category_override`, `insert_user_category`, `update_user_category`, `delete_user_category`, `set_visibility` |
| `delete_user_category` also deletes that category's visibility row | `events/store.py:109-111` |
| Preferences are one upsert | `apps/api/routes/portfolio.py:129-139` (`PUT /api/v1/portfolio/preferences`) |
| Read routes to trigger on | `GET /api/v1/valuation/cases`, `GET /api/v1/decisions`, `GET /api/v1/market/events`, `GET /api/v1/market/event-categories`, `GET /api/v1/portfolio/preferences` |
| `segment` and `segment_narrative` cascade from their parent | `apps/api/services/db.py:557,575` |
| Visibility rows exist for built-in categories with no `event_category` row | 4 rows vs 0 today |

## File map

**Create:**
- `apps/api/services/peer_sync/__init__.py`, `apps/api/services/peer_sync/model.py` (moved).
- `apps/api/services/records_sync/__init__.py`, `kinds.py`, `merge.py`, `files.py`, `store.py`,
  `service.py`.
- `apps/api/routes/sync.py` (the `/api/v1/sync/status` route).
- `apps/web/app/components/RecordsSyncStatus.tsx` (one line, three pages).

**Modify:**
- `apps/api/services/watchlist_sync/{files,store,service}.py` — import the moved model.
- `apps/api/services/db.py` — `sync_uid` columns, unique indexes, `record_sync` table.
- `apps/api/services/valuation_case.py`, `apps/api/services/investment_decision.py`,
  `apps/api/services/events/store.py`, `apps/api/routes/portfolio.py` — stamp on write.
- `apps/api/routes/{valuation,decisions,market,portfolio}.py` — trigger on read.
- `apps/api/main.py` — startup trigger, new router.
- `apps/api/models/schema_parts/`, `apps/api/models/schemas.py` — status models.
- `apps/web/app/{valuation,decisions,events}/page.tsx` — the status line.
- Docs: `docs/local-run-resources.md`, `docs/architecture/storage-model.md`,
  `guideline/sop/todo.md`.

**Tests:** `tests/api/records_sync/{__init__,test_merge,test_files,test_store,test_service,test_routes}.py`,
`apps/web/tests/e2e/records-sync-status.spec.ts`.

---

### Task 1: Move the shared model into `peer_sync`

**Files:**
- Create: `apps/api/services/peer_sync/__init__.py` (empty), `apps/api/services/peer_sync/model.py`
- Delete: `apps/api/services/watchlist_sync/model.py`
- Modify: `apps/api/services/watchlist_sync/{files,store,service}.py`, and every test importing the old path

**Interfaces:**
- Produces: `apps.api.services.peer_sync.model` with the same names as today: `BASELINE_TS`,
  `SEED_TS`, `TS_PATTERN`, `is_valid_ts`, `format_ts`, `next_stamp`, `SyncRow`, `Tombstone`,
  `SyncState`, `merge_states`.

This is a pure move: no behaviour changes, and the watchlist tests must pass untouched except for
their import lines.

- [ ] **Step 1: Move the file and update imports**

```bash
git mv apps/api/services/watchlist_sync/model.py apps/api/services/peer_sync/model.py
```

Create an empty `apps/api/services/peer_sync/__init__.py`. Then update every import of
`apps.api.services.watchlist_sync.model` to `apps.api.services.peer_sync.model`:

```bash
grep -rln "watchlist_sync.model\|watchlist_sync import model" --include=*.py apps tests
```

`SyncRow`, `Tombstone`, `SyncState` and `merge_states` stay in this module for now: the watchlist
uses them, and moving them again would be churn. Task 3 adds record types beside them, not in place
of them.

- [ ] **Step 2: Run the whole suite**

Run: `python -m pytest -q -p no:cacheprovider`
Expected: the same count as before the move (1512 at the time of writing), 0 failed.

- [ ] **Step 3: Mutation check**

This task adds no behaviour, so the check is that nothing silently kept the old module:
1. `grep -rn "watchlist_sync.model" --include=*.py apps tests` must print nothing.
2. `git status --short` must show the rename, not an added copy plus an untouched original.
3. Delete `apps/api/services/peer_sync/__init__.py` and run the suite: it must FAIL at import.
   Restore.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api/services tests
git commit -m "refactor(sync): move the shared timestamp and merge-key model into peer_sync"
```

### Task 2: Schema — `sync_uid` columns and the `record_sync` table

**Files:**
- Modify: `apps/api/services/db.py` (`_CREATE_SCHEMA_SQL`, and the compatibility block near the
  watchlist columns)
- Test: `tests/api/records_sync/__init__.py` (empty), `tests/api/records_sync/test_store.py` (the
  schema part; the rest arrives in Task 5)

**Interfaces:**
- Produces: `valuation_case.sync_uid`, `investment_decision.sync_uid`, `user_event.sync_uid`, each
  `TEXT` and nullable, each with a unique index; and the table `record_sync`.

- [ ] **Step 1: Write the failing test**

`tests/api/records_sync/test_store.py`:

```python
"""Schema for records peer sync: additive columns, the record_sync table (spec §3)."""

import sqlite3

import pytest

from apps.api.services import db as db_service
from apps.api.services.db import get_db

UID_TABLES = ("valuation_case", "investment_decision", "user_event")


def test_every_synced_table_has_a_nullable_sync_uid():
    with get_db() as conn:
        for table in UID_TABLES:
            columns = {r["name"]: r for r in conn.execute(f"PRAGMA table_info({table})")}
            assert "sync_uid" in columns, table
            assert columns["sync_uid"]["notnull"] == 0, f"{table}.sync_uid must be nullable"


def test_sync_uid_is_unique_per_table():
    with get_db() as conn:
        conn.execute("INSERT INTO user_event (label, category, start_date, sync_uid) VALUES ('A', 'fomc', '2026-01-01', 'dup')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO user_event (label, category, start_date, sync_uid) VALUES ('B', 'fomc', '2026-01-02', 'dup')")


def test_two_rows_may_both_have_no_uid_yet():
    # NULLs are distinct in a SQLite unique index, which is what makes the backfill possible.
    with get_db() as conn:
        conn.execute("INSERT INTO user_event (label, category, start_date) VALUES ('A', 'fomc', '2026-01-01')")
        conn.execute("INSERT INTO user_event (label, category, start_date) VALUES ('B', 'fomc', '2026-01-02')")
        assert conn.execute("SELECT COUNT(*) FROM user_event WHERE sync_uid IS NULL").fetchone()[0] == 2


def test_the_record_sync_table_exists_with_its_composite_key():
    with get_db() as conn:
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(record_sync)")}
        keys = [r["name"] for r in conn.execute("PRAGMA table_info(record_sync)") if r["pk"]]
    assert columns == {"kind", "uid", "updated_at", "updated_by", "removed_at", "removed_by"}
    assert sorted(keys) == ["kind", "uid"]


def test_an_old_database_gains_the_columns_without_losing_rows(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    raw.execute("CREATE TABLE user_event (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, "
                "category TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, source TEXT, "
                "note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z')")
    raw.execute("INSERT INTO user_event (label, category, start_date) VALUES ('kept', 'fomc', '2026-01-01')")
    raw.commit()
    raw.close()
    monkeypatch.setattr(db_service, "_DB_PATH", path)

    db_service.init_db()

    with get_db() as conn:
        row = conn.execute("SELECT label, sync_uid FROM user_event").fetchone()
    assert (row["label"], row["sync_uid"]) == ("kept", None)
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/records_sync/test_store.py -q -p no:cacheprovider`
Expected: FAIL — `no such column: sync_uid`.

- [ ] **Step 3: Implement**

In `_CREATE_SCHEMA_SQL`, add `sync_uid TEXT` as the last column of `valuation_case`,
`investment_decision` and `user_event`, then add after each table's statement:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_valuation_case_sync_uid ON valuation_case(sync_uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_decision_sync_uid ON investment_decision(sync_uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_event_sync_uid ON user_event(sync_uid);

-- Peer-sync bookkeeping for the owner's own records (spec §3.2). One row per record, and a row
-- with removed_at set IS that record's tombstone, so it survives the record itself.
CREATE TABLE IF NOT EXISTS record_sync (
    kind       TEXT NOT NULL,
    uid        TEXT NOT NULL,
    updated_at TEXT,
    updated_by TEXT,
    removed_at TEXT,
    removed_by TEXT,
    PRIMARY KEY (kind, uid)
);
```

In the compatibility block, beside the watchlist `updated_at`/`updated_by` handling, add the same
additive pattern for each of the three tables:

```python
    # Nullable and additive: existing rows keep every value and get a uid on the first records sync
    # (records_sync.store.backfill_uids).
    for table in ("valuation_case", "investment_decision", "user_event"):
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if columns and "sync_uid" not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN sync_uid TEXT")
            conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_sync_uid ON {table}(sync_uid)")
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/api/records_sync tests/api/test_sqlite_schema_validation.py -q -p no:cacheprovider`

- [ ] **Step 5: Mutation check**

Each on its own, then restore:
1. Make `sync_uid` `NOT NULL` in the create script. Run `-k nullable_sync_uid`. Expected: FAIL.
2. Drop the unique index. Run `-k unique_per_table`. Expected: FAIL.
3. Remove the `ALTER TABLE` loop. Run `-k old_database`. Expected: FAIL.
4. Make `record_sync`'s primary key `uid` alone. Run `-k composite_key`. Expected: FAIL.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/db.py tests/api/records_sync
git commit -m "feat(records-sync): stable record ids and the record_sync bookkeeping table"
```

### Task 3: The kind registry and the pure merge

**Files:**
- Create: `apps/api/services/records_sync/__init__.py` (empty),
  `apps/api/services/records_sync/kinds.py`, `apps/api/services/records_sync/merge.py`
- Test: `tests/api/records_sync/test_merge.py`

**Interfaces:**
- Consumes: `peer_sync.model` (`BASELINE_TS`, `next_stamp`, `is_valid_ts`).
- Produces:
  - `kinds.KIND_VALUATION_CASE`, `KIND_DECISION`, `KIND_USER_EVENT`, `KIND_CATEGORY`,
    `KIND_VISIBILITY`, `KIND_PREFERENCES`, and `KINDS: dict[str, Kind]`
  - `Kind(name, table, uid_column, columns, generates_uid, natural_key, children, singleton_uid)`
  - `merge.Record(kind, uid, updated_at, updated_by, payload)` with `.add_key()` and `.order_key()`
  - `merge.RecordTombstone(kind, uid, removed_at, removed_by)` with `.remove_key()`
  - `merge.RecordState(records: dict[tuple[str, str], Record], removed: dict[tuple[str, str], RecordTombstone])`
  - `merge.merge_record_states(states) -> RecordState`

- [ ] **Step 1: Write the failing tests**

`tests/api/records_sync/test_merge.py`:

```python
"""Per-record merge rules (spec §5). Pure: no I/O, no database."""

import itertools

import pytest

from apps.api.services.records_sync.kinds import KINDS
from apps.api.services.records_sync.merge import (
    Record,
    RecordState,
    RecordTombstone,
    merge_record_states,
)

CASE = "valuation_case"


def rec(uid="u1", ts="2026-09-20T10:00:00.000Z", by="PC-A-0001", name="Case", kind=CASE):
    return Record(kind=kind, uid=uid, updated_at=ts, updated_by=by,
                  payload={"case": {"case_name": name}, "segments": []})


def tomb(uid="u1", ts="2026-09-20T11:00:00.000Z", by="PC-B-0002", kind=CASE):
    return RecordTombstone(kind=kind, uid=uid, removed_at=ts, removed_by=by)


def state(records=(), removed=()):
    return RecordState(records={(r.kind, r.uid): r for r in records},
                       removed={(t.kind, t.uid): t for t in removed})


def test_every_kind_declares_a_table_and_an_identity():
    for name, kind in KINDS.items():
        assert kind.name == name
        assert kind.table and kind.uid_column, name
        assert kind.columns, name


def test_a_later_edit_wins():
    merged = merge_record_states([state([rec(name="old")]),
                                  state([rec(ts="2026-09-20T10:05:00.000Z", name="new")])])
    assert merged.records[(CASE, "u1")].payload["case"]["case_name"] == "new"


def test_the_payload_is_replaced_whole_never_merged_field_by_field():
    first = rec(name="A")
    first.payload["segments"] = [{"name": "one"}, {"name": "two"}]
    second = rec(ts="2026-09-20T10:05:00.000Z", name="A")
    second.payload["segments"] = [{"name": "one"}]

    merged = merge_record_states([state([first]), state([second])])

    assert merged.records[(CASE, "u1")].payload["segments"] == [{"name": "one"}], \
        "a segment removed on the winning PC must not survive from the losing copy"


def test_a_newer_remote_removal_deletes_an_older_local_record():
    merged = merge_record_states([state([rec(ts="2026-09-20T10:00:00.000Z")]),
                                  state(removed=[tomb(ts="2026-09-20T10:00:00.001Z")])])
    assert (CASE, "u1") not in merged.records
    assert (CASE, "u1") in merged.removed


def test_an_older_remote_removal_does_not_delete_a_newer_local_record():
    merged = merge_record_states([state([rec(ts="2026-09-20T10:00:00.001Z")]),
                                  state(removed=[tomb(ts="2026-09-20T10:00:00.000Z")])])
    assert (CASE, "u1") in merged.records


def test_an_equal_key_keeps_the_record_because_only_a_greater_remove_key_removes():
    at, by = "2026-09-20T10:00:00.000Z", "PC-A-0001"
    merged = merge_record_states([state([rec(ts=at, by=by)]),
                                  state(removed=[tomb(ts=at, by=by)])])
    assert (CASE, "u1") in merged.records


def test_an_equal_timestamp_is_decided_by_the_larger_author():
    a = rec(by="PC-A-0001", name="zz-from-a")   # content alone would pick this one
    c = rec(by="PC-C-0003", name="from-c")
    assert merge_record_states([state([a]), state([c])]).records[(CASE, "u1")].payload["case"]["case_name"] == "from-c"


def test_the_same_uid_in_two_kinds_is_two_records():
    merged = merge_record_states([state([rec(uid="x", kind="user_event"),
                                         rec(uid="x", kind="investment_decision")])])
    assert set(merged.records) == {("user_event", "x"), ("investment_decision", "x")}


def test_a_tombstone_is_kept_even_when_a_newer_add_wins():
    merged = merge_record_states([state(removed=[tomb(ts="2026-09-20T11:00:00.000Z")]),
                                  state([rec(ts="2026-09-20T12:00:00.000Z")])])
    assert (CASE, "u1") in merged.records
    assert merged.removed[(CASE, "u1")].removed_at == "2026-09-20T11:00:00.000Z"


def test_the_result_does_not_depend_on_read_order():
    versions = [rec(ts="2026-09-20T10:00:00.000Z", by="PC-A-0001", name="a"),
                rec(ts="2026-09-20T10:00:00.002Z", by="PC-B-0002", name="b"),
                rec(ts="2026-09-20T10:00:00.001Z", by="PC-C-0003", name="c")]
    winners = {merge_record_states(state([v]) for v in order).records[(CASE, "u1")].payload["case"]["case_name"]
               for order in itertools.permutations(versions)}
    assert winners == {"b"}


def test_baseline_records_from_two_pcs_merge_as_a_union():
    from apps.api.services.peer_sync.model import BASELINE_TS

    a = state([rec(uid="a", ts=BASELINE_TS, by="PC-A-0001")])
    b = state([rec(uid="b", ts=BASELINE_TS, by="PC-B-0002")])
    assert set(merge_record_states([a, b]).records) == {(CASE, "a"), (CASE, "b")}
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/records_sync/test_merge.py -q -p no:cacheprovider`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement the kind registry**

`apps/api/services/records_sync/kinds.py`:

```python
"""What each synced record kind is made of (spec §1, §3).

A kind names one table, the column that identifies a record across PCs, the columns that travel in
the payload, and — for a valuation case — the child tables that ride along inside it. Nothing here
touches SQLite; store.py reads this to build and apply records.
"""

from __future__ import annotations

from dataclasses import dataclass, field

KIND_VALUATION_CASE = "valuation_case"
KIND_DECISION = "investment_decision"
KIND_USER_EVENT = "user_event"
KIND_CATEGORY = "event_category"
KIND_VISIBILITY = "event_category_visibility"
KIND_PREFERENCES = "portfolio_preferences"


@dataclass(frozen=True)
class ChildSpec:
    """A table carried inside its parent's payload and rebuilt under local ids on import."""

    key: str                 # the payload key holding the list
    table: str
    parent_column: str       # the column pointing at the parent's local id
    columns: tuple[str, ...]
    children: tuple["ChildSpec", ...] = ()


@dataclass(frozen=True)
class Kind:
    name: str
    table: str
    uid_column: str          # the column holding the record's cross-PC identity
    columns: tuple[str, ...]  # payload columns, excluding local ids and the uid
    generates_uid: bool = False   # True: a new row needs a generated sync_uid
    natural_key: str | None = None  # a UNIQUE column that two PCs can collide on (spec §5)
    children: tuple[ChildSpec, ...] = ()
    singleton_uid: str | None = None


_SEGMENT_NARRATIVE = ChildSpec(
    key="narratives",
    table="segment_narrative",
    parent_column="segment_id",
    columns=("input_field", "claim", "evidence_source", "confidence", "three_p"),
)

_SEGMENT = ChildSpec(
    key="segments",
    table="segment",
    parent_column="case_id",
    columns=("name", "base_revenue", "base_margin", "tam_target", "market_share_target",
             "revenue_target", "margin_target", "sales_to_capital_early", "sales_to_capital_late",
             "ramp_start_year", "initial_growth", "waypoint_gap_fraction"),
    children=(_SEGMENT_NARRATIVE,),
)

KINDS: dict[str, Kind] = {
    KIND_VALUATION_CASE: Kind(
        name=KIND_VALUATION_CASE,
        table="valuation_case",
        uid_column="sync_uid",
        # parent_case_id points at a LOCAL id, so it never travels: a fork's parent link is local
        # provenance, and a peer's id would name a different case here.
        columns=("case_name", "ticker", "as_of_date", "base_year", "target_year", "riskfree_rate",
                 "wacc_initial", "wacc_stable", "wacc_converge_from", "marginal_tax_rate",
                 "nol_balance", "roic_stable", "terminal_growth", "effective_tax_rate", "cash",
                 "debt", "ipo_proceeds", "shares_basic", "shares_new"),
        generates_uid=True,
        natural_key="case_name",
        children=(_SEGMENT,),
    ),
    KIND_DECISION: Kind(
        name=KIND_DECISION,
        table="investment_decision",
        uid_column="sync_uid",
        columns=("ticker", "decided_at", "action", "memo", "price_at_decision", "dcf_value",
                 "dcf_implied_return", "roic", "wacc", "risk_free_rate", "equity_risk_premium",
                 "metric_schema_version", "figures_source", "figures_unavailable_reason"),
        generates_uid=True,
    ),
    KIND_USER_EVENT: Kind(
        name=KIND_USER_EVENT,
        table="user_event",
        uid_column="sync_uid",
        columns=("label", "category", "start_date", "end_date", "source", "note", "created_at"),
        generates_uid=True,
    ),
    KIND_CATEGORY: Kind(
        name=KIND_CATEGORY,
        table="event_category",
        uid_column="id",
        columns=("id", "kind", "label", "color", "created_at"),
    ),
    KIND_VISIBILITY: Kind(
        name=KIND_VISIBILITY,
        table="event_category_visibility",
        uid_column="category_id",
        columns=("category_id", "visible"),
    ),
    KIND_PREFERENCES: Kind(
        name=KIND_PREFERENCES,
        table="portfolio_preferences",
        uid_column="singleton_id",
        columns=("total_investment_amount", "transaction_fee_rate", "updated_at"),
        singleton_uid="portfolio_preferences",
    ),
}
```

- [ ] **Step 4: Implement the merge**

`apps/api/services/records_sync/merge.py`:

```python
"""Per-record merge (spec §5). Pure: no I/O.

Records and tombstones are ordered by the same change keys watchlist sync uses, per (kind, uid). A
record's payload is replaced whole — never field by field — so a case never mixes one PC's
assumptions with another's segments.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Iterable


@dataclass
class Record:
    kind: str
    uid: str
    updated_at: str
    updated_by: str
    payload: dict

    def add_key(self) -> tuple[str, str]:
        return (self.updated_at, self.updated_by)

    def order_key(self) -> tuple[str, str, str]:
        # Content breaks an exact (timestamp, author) tie, so the winner never depends on read
        # order. sort_keys makes the comparison stable whatever order the JSON arrived in.
        return (self.updated_at, self.updated_by, json.dumps(self.payload, sort_keys=True, default=str))


@dataclass(frozen=True)
class RecordTombstone:
    kind: str
    uid: str
    removed_at: str
    removed_by: str

    def remove_key(self) -> tuple[str, str]:
        return (self.removed_at, self.removed_by)


@dataclass(frozen=True)
class RecordState:
    records: dict[tuple[str, str], Record] = field(default_factory=dict)
    removed: dict[tuple[str, str], RecordTombstone] = field(default_factory=dict)


def merge_record_states(states: Iterable[RecordState]) -> RecordState:
    best: dict[tuple[str, str], Record] = {}
    best_removed: dict[tuple[str, str], RecordTombstone] = {}
    for current in states:
        for key, record in current.records.items():
            held = best.get(key)
            if held is None or record.order_key() > held.order_key():
                best[key] = record
        for key, tomb in current.removed.items():
            held_tomb = best_removed.get(key)
            if held_tomb is None or tomb.remove_key() > held_tomb.remove_key():
                best_removed[key] = tomb
    present = {
        key: record
        for key, record in best.items()
        if not (key in best_removed and best_removed[key].remove_key() > record.add_key())
    }
    # Every tombstone is kept, including ones a newer add has made ineffective.
    return RecordState(records=present, removed=best_removed)
```

- [ ] **Step 5: Run to verify they pass**

Run: `python -m pytest tests/api/records_sync -q -p no:cacheprovider`

- [ ] **Step 6: Mutation check**

Each on its own, then restore:
1. In `merge_record_states`, drop the tombstone filter. Run `-k newer_remote_removal`. Expected: FAIL.
2. Change `>` to `>=` in that filter. Run `-k equal_key_keeps`. Expected: FAIL.
3. Use `add_key()` instead of `order_key()` for records. Run `-k does_not_depend_on_read_order`.
   Report the result: with distinct timestamps it may survive, in which case run `-k equal_timestamp`,
   which must FAIL.
4. Merge payload dicts instead of replacing (`{**held.payload, **record.payload}` on the winner).
   Run `-k replaced_whole`. Expected: FAIL.
5. Key records by `uid` alone. Run `-k same_uid_in_two_kinds`. Expected: FAIL.
6. Return `removed={}`. Run `-k tombstone_is_kept`. Expected: FAIL.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/records_sync tests/api/records_sync/test_merge.py
git commit -m "feat(records-sync): kind registry and whole-record merge by (timestamp, author)"
```

### Task 4: The record peer file

**Files:**
- Create: `apps/api/services/records_sync/files.py`
- Test: `tests/api/records_sync/test_files.py`

**Interfaces:**
- Consumes: `kinds.KINDS`, `merge.Record/RecordTombstone/RecordState`,
  `peer_sync.model.is_valid_ts`, and from `watchlist_sync.files`: `SyncFolderUnavailable`,
  `SkippedFile`, `SYNC_SUBDIR`.
- Produces: `FORMAT_VERSION = 1`, `RecordPeerFile(pc_id, written_at, state)`,
  `own_file_path(root, pc_id)`, `read_peer_files(root, own_pc_id) -> (peers, skipped)`,
  `write_own_file(root, pc_id, state, written_at) -> Path`.

Reuse `SyncFolderUnavailable`, `SkippedFile` and `SYNC_SUBDIR` by importing them from
`watchlist_sync.files`; do not redefine them. Everything else in this module is records-specific.

- [ ] **Step 1: Write the failing tests**

`tests/api/records_sync/test_files.py`:

```python
"""Record peer files: which files count, validation per kind, atomic writes (spec §4)."""

import json

import pytest

from apps.api.services.records_sync import files
from apps.api.services.records_sync.files import own_file_path, read_peer_files, write_own_file
from apps.api.services.records_sync.merge import Record, RecordState, RecordTombstone
from apps.api.services.watchlist_sync.files import SyncFolderUnavailable

A, ME = "PC-A-0001", "PC-ME-00ff"
TS = "2026-09-20T10:00:00.000Z"


def _state():
    case = Record("valuation_case", "u1", TS, A,
                  {"case": {"case_name": "Case", "ticker": "AAPL", "as_of_date": "2026-01-01",
                            "base_year": 2026, "target_year": 2031, "riskfree_rate": 0.03,
                            "wacc_initial": 0.09, "wacc_stable": 0.08, "wacc_converge_from": 5,
                            "marginal_tax_rate": 0.21, "nol_balance": 0.0, "roic_stable": 0.12,
                            "terminal_growth": 0.02, "effective_tax_rate": 0.18, "cash": 1.0,
                            "debt": 0.0, "ipo_proceeds": 0.0, "shares_basic": 10.0, "shares_new": 0.0},
                   "segments": [{"name": "core", "base_revenue": 100.0, "base_margin": 0.2,
                                 "tam_target": None, "market_share_target": None,
                                 "revenue_target": 200.0, "margin_target": 0.25,
                                 "sales_to_capital_early": 2.0, "sales_to_capital_late": 2.5,
                                 "ramp_start_year": 1, "initial_growth": 0.2,
                                 "waypoint_gap_fraction": 0.5,
                                 "narratives": [{"input_field": "revenue_target", "claim": "c",
                                                 "evidence_source": None, "confidence": "assumed",
                                                 "three_p": "plausible"}]}]})
    return RecordState(records={("valuation_case", "u1"): case},
                       removed={("user_event", "gone"): RecordTombstone("user_event", "gone", TS, A)})


def _folder(tmp_path):
    folder = tmp_path / "MoneyView"
    folder.mkdir()
    return folder


def test_a_written_file_reads_back_as_the_same_state_with_authors_kept(tmp_path):
    _folder(tmp_path)
    write_own_file(tmp_path, "PC-B-0002", _state(), "2026-09-20T10:00:01.000Z")

    [peer], skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert skipped == []
    assert peer.pc_id == "PC-B-0002"
    assert peer.state == _state(), "a republished record keeps its original author"


def test_this_pcs_own_file_is_never_an_input(tmp_path):
    _folder(tmp_path)
    write_own_file(tmp_path, ME, _state(), "2026-09-20T10:00:01.000Z")
    assert read_peer_files(tmp_path, own_pc_id=ME) == ([], [])


def test_the_watchlist_file_is_not_a_record_file(tmp_path):
    folder = _folder(tmp_path)
    (folder / f"watchlist.{A}.json").write_text("{}", encoding="utf-8")
    assert read_peer_files(tmp_path, own_pc_id=ME) == ([], [])


def test_an_unknown_kind_is_skipped_and_reported(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    path = folder / f"records.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["records"][0]["kind"] = "something_else"
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and "something_else" in skipped[0].reason


def test_a_payload_column_this_schema_does_not_have_is_an_error_not_ignored(tmp_path):
    # A peer on a newer schema. Guessing would drop a column the owner wrote.
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    path = folder / f"records.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["records"][0]["payload"]["case"]["brand_new_column"] = 1
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and "brand_new_column" in skipped[0].reason


def test_a_missing_payload_column_is_an_error(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    path = folder / f"records.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    del payload["records"][0]["payload"]["case"]["ticker"]
    path.write_text(json.dumps(payload), encoding="utf-8")

    assert read_peer_files(tmp_path, own_pc_id=ME)[0] == []


def test_an_impossible_stamp_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    path = folder / f"records.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["records"][0]["updated_at"] = "2026-13-01T00:00:00.000Z"
    path.write_text(json.dumps(payload), encoding="utf-8")

    assert read_peer_files(tmp_path, own_pc_id=ME)[0] == []


def test_one_bad_file_does_not_poison_the_others(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    (folder / "records.PC-C-0003.json").write_text("{not json", encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert [p.pc_id for p in peers] == [A]
    assert [s.name for s in skipped] == ["records.PC-C-0003.json"]


def test_a_file_whose_pc_id_differs_from_its_name_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-20T10:00:01.000Z")
    (folder / f"records.{A}.json").rename(folder / f"records.{A}-DESKTOP.json")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"records.{A}-DESKTOP.json"


def test_a_failed_replace_leaves_the_previous_file_intact(tmp_path, monkeypatch):
    _folder(tmp_path)
    write_own_file(tmp_path, ME, _state(), "2026-09-20T10:00:01.000Z")
    before = own_file_path(tmp_path, ME).read_text(encoding="utf-8")

    def refuse(src, dst):
        raise PermissionError("simulated replace failure")

    monkeypatch.setattr(files.os, "replace", refuse)
    with pytest.raises(PermissionError):
        write_own_file(tmp_path, ME, RecordState(), "2026-09-20T10:00:02.000Z")

    assert own_file_path(tmp_path, ME).read_text(encoding="utf-8") == before


def test_writing_a_state_peers_would_reject_raises_and_creates_no_file(tmp_path):
    _folder(tmp_path)
    bad = RecordState(records={("valuation_case", "u1"): Record("valuation_case", "u1", TS, "", {"case": {}, "segments": []})})

    with pytest.raises(ValueError):
        write_own_file(tmp_path, A, bad, "2026-09-20T10:00:01.000Z")

    assert not own_file_path(tmp_path, A).exists()


def test_a_missing_sync_root_is_unavailable_and_is_not_created(tmp_path):
    root = tmp_path / "not-there"
    with pytest.raises(SyncFolderUnavailable):
        read_peer_files(root, own_pc_id=ME)
    assert not root.exists()
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/records_sync/test_files.py -q -p no:cacheprovider`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`apps/api/services/records_sync/files.py`:

```python
"""Record peer files: one per PC, read defensively and written atomically (spec §4).

Only names fully matching `records.<pc_id>.json` count, so the watchlist file and cloud conflict
copies are never read as records. An unreadable or invalid file is skipped and reported as a unit,
never read as empty, and never blocks the others. This PC's own file is output only, and is
validated with this module's own reader before it is published.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from apps.api.services.peer_sync.model import is_valid_ts
from apps.api.services.records_sync.kinds import KINDS, ChildSpec, Kind
from apps.api.services.records_sync.merge import Record, RecordState, RecordTombstone
from apps.api.services.watchlist_sync.files import SYNC_SUBDIR, SkippedFile, SyncFolderUnavailable

FORMAT_VERSION = 1
_PEER_NAME = re.compile(r"records\.([A-Za-z0-9-]+)\.json")
_PC_ID = re.compile(r"[A-Za-z0-9-]+")


@dataclass(frozen=True)
class RecordPeerFile:
    pc_id: str
    written_at: str
    state: RecordState


def own_file_path(root: Path, pc_id: str) -> Path:
    return root / SYNC_SUBDIR / f"records.{pc_id}.json"


def _require_root(root: Path) -> Path:
    if not root.is_dir():
        raise SyncFolderUnavailable(f"sync folder {root} does not exist or is not a folder")
    return root / SYNC_SUBDIR


def _ts(value, what: str) -> str:
    if not isinstance(value, str) or not is_valid_ts(value):
        raise ValueError(f"{what}={value!r} is not a valid UTC millisecond timestamp")
    return value


def _pc(value, what: str) -> str:
    if not isinstance(value, str) or not _PC_ID.fullmatch(value):
        raise ValueError(f"{what}={value!r} is not a pc_id")
    return value


def _check_tree(node: dict, columns: tuple[str, ...], children: tuple[ChildSpec, ...], what: str) -> None:
    if not isinstance(node, dict):
        raise ValueError(f"{what} is not an object")
    expected = set(columns) | {child.key for child in children}
    present = set(node)
    if expected - present:
        raise ValueError(f"{what} is missing {sorted(expected - present)}")
    # A column this schema does not know means the peer runs a newer version. Applying the rest
    # would silently drop whatever the owner wrote in it.
    if present - expected:
        raise ValueError(f"{what} has unknown columns {sorted(present - expected)}")
    for child in children:
        rows = node[child.key]
        if not isinstance(rows, list):
            raise ValueError(f"{what}.{child.key} is not a list")
        for index, row in enumerate(rows):
            _check_tree(row, child.columns, child.children, f"{what}.{child.key}[{index}]")


def _check_payload(kind: Kind, payload: dict) -> None:
    if kind.children:
        if not isinstance(payload, dict) or set(payload) != {"case", *(c.key for c in kind.children)}:
            raise ValueError(f"{kind.name} payload must hold 'case' and {[c.key for c in kind.children]}")
        _check_tree(payload["case"], kind.columns, (), f"{kind.name}.case")
        for child in kind.children:
            rows = payload[child.key]
            if not isinstance(rows, list):
                raise ValueError(f"{kind.name}.{child.key} is not a list")
            for index, row in enumerate(rows):
                _check_tree(row, child.columns, child.children, f"{kind.name}.{child.key}[{index}]")
        return
    _check_tree(payload, kind.columns, (), f"{kind.name} payload")


def _parse(payload: dict) -> RecordPeerFile:
    if not isinstance(payload, dict):
        raise ValueError("the file is not a JSON object")
    if payload.get("format_version") != FORMAT_VERSION:
        raise ValueError(f"unsupported format_version {payload.get('format_version')!r}")
    if not isinstance(payload["records"], list) or not isinstance(payload["removed"], list):
        raise ValueError("records and removed must both be lists")

    records: dict[tuple[str, str], Record] = {}
    for raw in payload["records"]:
        kind = KINDS.get(raw["kind"])
        if kind is None:
            raise ValueError(f"unknown kind {raw['kind']!r}")
        uid = raw["uid"]
        if not isinstance(uid, str) or not uid:
            raise ValueError(f"{raw['kind']}: invalid uid {uid!r}")
        key = (kind.name, uid)
        if key in records:
            raise ValueError(f"duplicate record {key}")
        _check_payload(kind, raw["payload"])
        records[key] = Record(
            kind=kind.name, uid=uid,
            updated_at=_ts(raw["updated_at"], f"{kind.name}.{uid} updated_at"),
            updated_by=_pc(raw["updated_by"], f"{kind.name}.{uid} updated_by"),
            payload=raw["payload"],
        )

    removed: dict[tuple[str, str], RecordTombstone] = {}
    for raw in payload["removed"]:
        if raw["kind"] not in KINDS:
            raise ValueError(f"unknown kind {raw['kind']!r}")
        key = (raw["kind"], raw["uid"])
        if key in removed:
            raise ValueError(f"duplicate tombstone {key}")
        removed[key] = RecordTombstone(
            kind=raw["kind"], uid=raw["uid"],
            removed_at=_ts(raw["removed_at"], f"{key} removed_at"),
            removed_by=_pc(raw["removed_by"], f"{key} removed_by"),
        )

    return RecordPeerFile(
        pc_id=_pc(payload["pc_id"], "pc_id"),
        written_at=_ts(payload["written_at"], "written_at"),
        state=RecordState(records=records, removed=removed),
    )


def read_peer_files(root: Path, own_pc_id: str) -> tuple[list[RecordPeerFile], list[SkippedFile]]:
    folder = _require_root(root)
    if not folder.is_dir():
        return [], []
    peers: list[RecordPeerFile] = []
    skipped: list[SkippedFile] = []
    for path in sorted(folder.iterdir()):
        match = _PEER_NAME.fullmatch(path.name)
        if match is None or not path.is_file():
            continue
        try:
            peer = _parse(json.loads(path.read_text(encoding="utf-8")))
        except Exception as error:  # noqa: BLE001 - each file is untrusted, independent input
            skipped.append(SkippedFile(path.name, f"unreadable: {type(error).__name__}: {error}"))
            continue
        if peer.pc_id != match.group(1):
            skipped.append(SkippedFile(path.name, f"pc_id {peer.pc_id!r} inside does not match the filename"))
            continue
        if peer.pc_id == own_pc_id:
            continue
        peers.append(peer)
    return peers, skipped


def _payload_of(state: RecordState, pc_id: str, written_at: str) -> dict:
    return {
        "format_version": FORMAT_VERSION,
        "pc_id": pc_id,
        "written_at": written_at,
        "records": [
            {"kind": r.kind, "uid": r.uid, "updated_at": r.updated_at, "updated_by": r.updated_by,
             "payload": r.payload}
            for r in sorted(state.records.values(), key=lambda r: (r.kind, r.uid))
        ],
        "removed": [
            {"kind": t.kind, "uid": t.uid, "removed_at": t.removed_at, "removed_by": t.removed_by}
            for t in sorted(state.removed.values(), key=lambda t: (t.kind, t.uid))
        ],
    }


def write_own_file(root: Path, pc_id: str, state: RecordState, written_at: str) -> Path:
    folder = _require_root(root)
    folder.mkdir(exist_ok=True)
    payload = _payload_of(state, pc_id, written_at)
    # Fail loudly here rather than silently on every peer: the reader is the judge of what is
    # publishable.
    _parse(payload)
    final = own_file_path(root, pc_id)
    temporary = final.with_name(final.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, final)
    return final
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/records_sync -q -p no:cacheprovider`

- [ ] **Step 5: Mutation check**

Each on its own, then restore:
1. Treat a parse error as an empty peer. Run `-k one_bad_file`. Expected: FAIL.
2. Use `_PEER_NAME.search` instead of `fullmatch`. Run `-k watchlist_file_is_not_a_record_file`.
   Expected: FAIL.
3. Drop the `extra` check in `_check_tree`. Run `-k unknown_columns or brand_new_column`.
   Expected: FAIL.
4. Drop the `missing` check. Run `-k missing_payload_column`. Expected: FAIL.
5. Delete the `_parse(payload)` call in `write_own_file`. Run `-k peers_would_reject`. Expected: FAIL.
6. Remove the own-file skip. Run `-k own_file_is_never`. Expected: FAIL.
7. Write straight to `final`. Run `-k failed_replace`. Expected: FAIL.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/records_sync/files.py tests/api/records_sync/test_files.py
git commit -m "feat(records-sync): record file format, per-kind validation, atomic writing"
```

### Task 5: The store — backfill, read, apply, stamps

**Files:**
- Create: `apps/api/services/records_sync/store.py`
- Test: extend `tests/api/records_sync/test_store.py`

**Interfaces:**
- Consumes: `kinds`, `merge`, `peer_sync.model.next_stamp/BASELINE_TS`,
  `watchlist_sync.store.get_or_create_pc_id`.
- Produces:
  - `backfill_uids(conn) -> int`
  - `ensure_first_sync(conn, pc_id) -> None`
  - `read_local_state(conn) -> RecordState`
  - `apply_state(conn, state) -> list[str]` (the renames it had to perform, for the status)
  - `stamp(conn, kind, uid, pc_id) -> None`
  - `record_removal(conn, kind, uid, pc_id) -> None`
  - `uid_of(conn, kind, local_id) -> str | None`

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/records_sync/test_store.py`:

```python
from apps.api.services.peer_sync.model import BASELINE_TS
from apps.api.services.records_sync import store
from apps.api.services.records_sync.merge import Record, RecordState, RecordTombstone

PC = "PC-ME-00ff"
TS = "2026-09-20T10:00:00.000Z"


def _case_payload(name="Case", segments=("core",)):
    return {
        "case": {"case_name": name, "ticker": "AAPL", "as_of_date": "2026-01-01", "base_year": 2026,
                 "target_year": 2031, "riskfree_rate": 0.03, "wacc_initial": 0.09,
                 "wacc_stable": 0.08, "wacc_converge_from": 5, "marginal_tax_rate": 0.21,
                 "nol_balance": 0.0, "roic_stable": 0.12, "terminal_growth": 0.02,
                 "effective_tax_rate": 0.18, "cash": 1.0, "debt": 0.0, "ipo_proceeds": 0.0,
                 "shares_basic": 10.0, "shares_new": 0.0},
        "segments": [{"name": s, "base_revenue": 100.0, "base_margin": 0.2, "tam_target": None,
                      "market_share_target": None, "revenue_target": 200.0, "margin_target": 0.25,
                      "sales_to_capital_early": 2.0, "sales_to_capital_late": 2.5,
                      "ramp_start_year": 1, "initial_growth": 0.2, "waypoint_gap_fraction": 0.5,
                      "narratives": [{"input_field": "revenue_target", "claim": f"why {s}",
                                      "evidence_source": None, "confidence": "assumed",
                                      "three_p": "plausible"}]}
                     for s in segments],
    }


def _insert_local_case(conn, name="Local"):
    # Every NOT NULL column that has no default: case_name, as_of_date, base_year, target_year,
    # riskfree_rate, wacc_initial, wacc_stable, marginal_tax_rate, roic_stable, shares_basic.
    cursor = conn.execute("INSERT INTO valuation_case (case_name, as_of_date, base_year, target_year, "
                          "riskfree_rate, wacc_initial, wacc_stable, wacc_converge_from, "
                          "marginal_tax_rate, roic_stable, terminal_growth, shares_basic) "
                          "VALUES (?, '2026-01-01', 2026, 2031, 0.03, 0.09, 0.08, 5, 0.21, 0.12, 0.02, 10.0)",
                          (name,))
    return int(cursor.lastrowid)


def test_backfill_gives_every_row_a_uid_once(tmp_path):
    with get_db() as conn:
        _insert_local_case(conn, "One")
        _insert_local_case(conn, "Two")
        assert store.backfill_uids(conn) == 2
        uids = [r["sync_uid"] for r in conn.execute("SELECT sync_uid FROM valuation_case ORDER BY id")]
        assert all(uids) and len(set(uids)) == 2
        assert store.backfill_uids(conn) == 0, "a second run must not re-issue uids"
        again = [r["sync_uid"] for r in conn.execute("SELECT sync_uid FROM valuation_case ORDER BY id")]
        assert again == uids


def test_first_sync_stamps_unstamped_records_with_the_baseline():
    with get_db() as conn:
        _insert_local_case(conn, "One")
        store.backfill_uids(conn)
        store.ensure_first_sync(conn, PC)
        row = conn.execute("SELECT updated_at, updated_by FROM record_sync WHERE kind = 'valuation_case'").fetchone()
    assert (row["updated_at"], row["updated_by"]) == (BASELINE_TS, PC)


def test_read_local_state_builds_the_whole_case_tree():
    with get_db() as conn:
        case_id = _insert_local_case(conn, "Tree")
        segment = conn.execute("INSERT INTO segment (case_id, name, base_revenue, base_margin, margin_target, "
                               "sales_to_capital_early, sales_to_capital_late, ramp_start_year, "
                               "initial_growth, waypoint_gap_fraction) "
                               "VALUES (?, 'core', 100.0, 0.2, 0.25, 2.0, 2.5, 1, 0.2, 0.5)", (case_id,))
        conn.execute("INSERT INTO segment_narrative (segment_id, input_field, claim, confidence, three_p) "
                     "VALUES (?, 'revenue_target', 'why', 'assumed', 'plausible')", (int(segment.lastrowid),))
        store.backfill_uids(conn)
        store.ensure_first_sync(conn, PC)
        state = store.read_local_state(conn)

    [record] = [r for r in state.records.values() if r.kind == "valuation_case"]
    assert record.payload["case"]["case_name"] == "Tree"
    assert [s["name"] for s in record.payload["segments"]] == ["core"]
    assert record.payload["segments"][0]["narratives"][0]["claim"] == "why"
    assert "id" not in record.payload["case"] and "case_id" not in record.payload["segments"][0]


def test_apply_state_inserts_a_peer_case_with_local_ids_and_no_orphans():
    incoming = Record("valuation_case", "peer-uid", TS, "PC-B-0002", _case_payload("Peer", ("a", "b")))
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={("valuation_case", "peer-uid"): incoming}))
        case = conn.execute("SELECT id, case_name, sync_uid FROM valuation_case").fetchone()
        segments = conn.execute("SELECT id, case_id, name FROM segment ORDER BY name").fetchall()
        narratives = conn.execute("SELECT segment_id FROM segment_narrative").fetchall()

    assert (case["case_name"], case["sync_uid"]) == ("Peer", "peer-uid")
    assert [s["name"] for s in segments] == ["a", "b"]
    assert {s["case_id"] for s in segments} == {case["id"]}
    assert {n["segment_id"] for n in narratives} == {s["id"] for s in segments}


def test_apply_state_replaces_the_whole_tree_dropping_a_removed_segment():
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", TS, "PC-B-0002", _case_payload("C", ("a", "b")))}))
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", "2026-09-20T10:05:00.000Z", "PC-B-0002",
                                            _case_payload("C", ("a",)))}))
        names = [r["name"] for r in conn.execute("SELECT name FROM segment")]
        assert names == ["a"]
        assert conn.execute("SELECT COUNT(*) FROM segment_narrative").fetchone()[0] == 1


def test_apply_state_deletes_a_record_absent_from_the_merged_state():
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={
            ("valuation_case", "u"): Record("valuation_case", "u", TS, "PC-B-0002", _case_payload("Gone"))}))
        store.apply_state(conn, RecordState(
            removed={("valuation_case", "u"): RecordTombstone("valuation_case", "u", "2026-09-20T11:00:00.000Z", "PC-B-0002")}))
        assert conn.execute("SELECT COUNT(*) FROM valuation_case").fetchone()[0] == 0
        tomb = conn.execute("SELECT removed_at FROM record_sync WHERE uid = 'u'").fetchone()
    assert tomb["removed_at"] == "2026-09-20T11:00:00.000Z"


def test_an_unchanged_record_is_not_rewritten():
    record = Record("valuation_case", "u", TS, "PC-B-0002", _case_payload("Same"))
    with get_db() as conn:
        store.apply_state(conn, RecordState(records={("valuation_case", "u"): record}))
        before = conn.execute("SELECT id FROM valuation_case").fetchone()["id"]
        store.apply_state(conn, RecordState(records={("valuation_case", "u"): record}))
        after = conn.execute("SELECT id FROM valuation_case").fetchone()["id"]
    assert after == before, "re-applying an identical record must not delete and re-insert it"


def test_a_name_clash_between_two_uids_renames_the_older_and_reports_it():
    older = Record("valuation_case", "old-uid", TS, "PC-A-0001", _case_payload("Shared"))
    newer = Record("valuation_case", "new-uid", "2026-09-20T10:05:00.000Z", "PC-B-0002", _case_payload("Shared"))
    with get_db() as conn:
        renamed = store.apply_state(conn, RecordState(records={
            ("valuation_case", "old-uid"): older, ("valuation_case", "new-uid"): newer}))
        rows = {r["sync_uid"]: r["case_name"] for r in conn.execute("SELECT sync_uid, case_name FROM valuation_case")}
        stamps = {r["uid"]: r["updated_at"] for r in conn.execute("SELECT uid, updated_at FROM record_sync")}

    assert rows["new-uid"] == "Shared"
    assert rows["old-uid"].startswith("Shared (from ")
    assert renamed and "Shared" in renamed[0]
    assert stamps["old-uid"] == TS, "a local repair must not restamp the record as a new authored change"


def test_stamp_and_record_removal_use_this_pc_and_outrank_what_they_replace():
    with get_db() as conn:
        store.stamp(conn, "user_event", "u1", PC)
        first = conn.execute("SELECT updated_at FROM record_sync WHERE uid = 'u1'").fetchone()["updated_at"]
        conn.execute("UPDATE record_sync SET updated_at = '2099-01-01T00:00:00.000Z' WHERE uid = 'u1'")
        store.stamp(conn, "user_event", "u1", PC)
        second = conn.execute("SELECT updated_at FROM record_sync WHERE uid = 'u1'").fetchone()["updated_at"]
        store.record_removal(conn, "user_event", "u1", PC)
        row = conn.execute("SELECT removed_at, removed_by FROM record_sync WHERE uid = 'u1'").fetchone()

    assert first > BASELINE_TS
    assert second > "2099-01-01T00:00:00.000Z", "a local edit must outrank a peer stamp from an ahead clock"
    assert row["removed_at"] > second and row["removed_by"] == PC
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/records_sync/test_store.py -q -p no:cacheprovider`
Expected: `AttributeError`/`ModuleNotFoundError` on `store`.

- [ ] **Step 3: Implement**

`apps/api/services/records_sync/store.py` — the SQLite side. Follow these rules exactly:

- `backfill_uids(conn)`: for each kind with `generates_uid`, `UPDATE <table> SET sync_uid = ? WHERE
  id = ?` for every row where `sync_uid IS NULL`, using `secrets.token_hex(16)`. Return how many it
  filled.
- `ensure_first_sync(conn, pc_id)`: insert a `record_sync` row with `(BASELINE_TS, pc_id)` for every
  existing record that has no row yet, on every call (the watchlist's Ruling R3, for the same
  reason: an unstamped record must never be published with an empty author).
- `read_local_state(conn)`: for each kind, join its table to `record_sync` and build a `Record` per
  row, with the payload shaped by the kind (`case`/`segments`/`narratives` for a valuation case, a
  flat dict otherwise). Rows whose `record_sync` row has `removed_at` set are tombstones, not
  records. Local ids (`id`, `case_id`, `segment_id`, `parent_case_id`) never enter a payload.
- `apply_state(conn, state)`:
  1. delete local records whose `(kind, uid)` is absent from `state.records`;
  2. for each incoming record, skip it when the local payload is identical; otherwise delete the
     local row (the cascade removes its children) and insert the payload, then its children, under
     fresh local ids;
  3. resolve a `natural_key` clash before inserting: if another uid holds that value, the larger
     `order_key()` keeps it and the loser is renamed `"<value> (from <updated_by>)"`, with a numeric
     suffix if that is taken too. Return the list of renames;
  4. upsert every `record_sync` row from the merged state, keeping the incoming `updated_at`,
     `updated_by`, `removed_at` and `removed_by` exactly as received.
- `stamp(conn, kind, uid, pc_id)`: upsert `record_sync` with
  `next_stamp(after=<the greater of this record's updated_at and removed_at>)` and clear
  `removed_at`/`removed_by` (a re-add is not a deletion).
- `record_removal(conn, kind, uid, pc_id)`: upsert `removed_at`/`removed_by` the same way.
- `uid_of(conn, kind, local_id)`: read the uid for a local row id, so the write paths in Task 7 can
  stamp what they just wrote.

Every function takes an open connection and never opens its own, so a caller can hold one
transaction.

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/records_sync -q -p no:cacheprovider`

- [ ] **Step 5: Mutation check**

Each on its own, then restore:
1. `backfill_uids` re-issues a uid for rows that already have one. Run `-k backfill`. Expected: FAIL.
2. `apply_state` updates the case row instead of replacing the tree. Run `-k replaces_the_whole_tree`.
   Expected: FAIL.
3. `apply_state` skips the absent-record delete. Run `-k absent_from_the_merged_state`. Expected: FAIL.
4. `apply_state` always rewrites, even when identical. Run `-k unchanged_record`. Expected: FAIL.
5. The clash resolver keeps the older name. Run `-k name_clash`. Expected: FAIL.
6. The clash resolver restamps the renamed record with `next_stamp()`. Run `-k name_clash`.
   Expected: FAIL on the stamp assertion.
7. `stamp` ignores `after`. Run `-k outrank_what_they_replace`. Expected: FAIL.
8. `read_local_state` includes local ids in the payload. Run `-k builds_the_whole_case_tree`.
   Expected: FAIL.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/records_sync/store.py tests/api/records_sync/test_store.py
git commit -m "feat(records-sync): uid backfill, whole-tree apply, causal stamps and tombstones"
```

### Task 6: `run_records_sync`

**Files:**
- Create: `apps/api/services/records_sync/service.py`
- Modify: `apps/api/models/schema_parts/` (a new `sync.py`), `apps/api/models/schemas.py`
- Test: `tests/api/records_sync/test_service.py`

**Interfaces:**
- Produces:
  - `service.is_enabled()`, `service.sync_root()`, `service.current_status()`
  - `service.run_records_sync(trigger: str) -> None` (never raises)
  - Pydantic `RecordsSyncStatus(enabled, pc_id, peers, skipped_files, last_sync_at, last_error, renamed)`,
    reusing `WatchlistPeer` and `WatchlistSkippedFile`.

`run_records_sync` mirrors `watchlist_sync.service.run_sync`:

```python
def run_records_sync(trigger: str) -> None:
    global _status
    root = sync_root()
    if root is None:
        _status = RecordsSyncStatus(enabled=False)
        return
    with _lock:
        pc_id = None
        try:
            with get_db() as conn:
                pc_id = watchlist_store.get_or_create_pc_id(conn)
                store.backfill_uids(conn)
                store.ensure_first_sync(conn, pc_id)
            peers, skipped = read_peer_files(root, pc_id)
            with get_db() as conn:
                # Serialises read-merge-apply against every other SQLite writer.
                conn.execute("BEGIN IMMEDIATE")
                merged = merge_record_states([store.read_local_state(conn), *(p.state for p in peers)])
                renamed = store.apply_state(conn, merged)
            finished = next_stamp()
            write_own_file(root, pc_id, merged, finished)
            _status = RecordsSyncStatus(enabled=True, pc_id=pc_id, peers=[...], skipped_files=[...],
                                        last_sync_at=finished, last_error=None, renamed=renamed)
        except Exception as error:  # noqa: BLE001 - sync must never break local records
            logger.warning("records.peer_sync_failed trigger=%s error=%s", trigger, error)
            _status = RecordsSyncStatus(enabled=True, pc_id=pc_id, peers=[], skipped_files=[],
                                        last_sync_at=_status.last_sync_at, last_error=str(error),
                                        renamed=[])
```

- [ ] **Step 1: Write the failing two-PC tests**

`tests/api/records_sync/test_service.py` follows `tests/api/watchlist_sync/test_service.py`: a `PC`
helper that points `db_service._DB_PATH` and `watchlist_store.host_name` at one simulated machine, a
`cloud` fixture that sets `MONEYVIEW_SYNC_DIR`, and these cases:

| Test | Assertion |
|---|---|
| A case created on A appears on B | after `a.sync(); b.sync()`, B holds the case with its segments and narratives |
| A deletion propagates | a user event deleted on B is gone on A after a sync |
| Imported tombstones are republished | three PCs; B's file is removed after A syncs, and C still deletes the record |
| Both PCs converge | after two rounds, `read_local_state` on each is equal, tombstones included |
| First sync is a union | records that existed on both before sync survive on both, none tombstoned |
| An unreadable peer file is reported, not read as empty | local records unchanged, `skipped_files` names it |
| A missing folder | records unchanged, `last_error` set, no exception |
| A failed publish keeps the local change | patch `service.write_own_file` to raise; the local record survives and `last_error` is set; restore the patch and the next sync publishes it with `last_error is None` |
| Sync off | `run_records_sync` writes no file, creates no `record_sync` rows and backfills no uid |
| Independence | with `watchlist_sync.service.run_sync` patched to raise, a records sync still completes, and the reverse |
| Concurrency | a local insert committed from a second connection during the merge is not lost |
| Each kind round-trips | one test per kind: decision, user event, category, visibility, preferences |

- [ ] **Step 2: Run to verify they fail**, then implement, then run again

Expected first: `ModuleNotFoundError`. After implementing: all pass.

- [ ] **Step 3: Mutation check**

Each on its own, then restore:
1. Remove `BEGIN IMMEDIATE`. Run `-k concurrent`. Expected: FAIL.
2. Let the exception escape. Run `-k missing_folder`. Expected: FAIL.
3. Keep `last_error` on success. Run `-k failed_publish`. Expected: FAIL.
4. Accumulate `skipped_files` across attempts. Run `-k unreadable`. Expected: FAIL.
5. Skip `backfill_uids`. Run `-k first_sync or union`. Expected: FAIL.
6. Call `watchlist_sync.service.run_sync` from `run_records_sync`. Run `-k independence`.
   Expected: FAIL.

- [ ] **Step 4: Commit**

```bash
git add apps/api/services/records_sync/service.py apps/api/models tests/api/records_sync/test_service.py
git commit -m "feat(records-sync): run_records_sync under one lock, with its own status"
```

### Task 7: Wiring — stamps, triggers and the status route

**Files:**
- Modify: `apps/api/services/valuation_case.py`, `apps/api/services/investment_decision.py`,
  `apps/api/services/events/store.py`, `apps/api/routes/portfolio.py`,
  `apps/api/routes/{valuation,decisions,market}.py`, `apps/api/main.py`
- Create: `apps/api/routes/sync.py`
- Test: `tests/api/records_sync/test_routes.py`

**Stamping.** Every write to a synced table stamps its record in the same transaction, and every
delete records a removal **only while sync is on**:

| Write | Stamp |
|---|---|
| `valuation_case.create_case` (and the fork path that calls it) | generate the uid on insert, then `store.stamp(conn, KIND_VALUATION_CASE, uid, pc_id)` |
| `investment_decision.record_decision` | same, `KIND_DECISION` |
| `events/store.insert_user_event` / `update_user_event` | same, `KIND_USER_EVENT` |
| `events/store.delete_user_event` | `store.record_removal(...)` before the DELETE, so the uid is still readable |
| `events/store.upsert_category_override` / `insert_user_category` / `update_user_category` | `KIND_CATEGORY` |
| `events/store.delete_category_override` / `delete_user_category` | `record_removal` for `KIND_CATEGORY`; `delete_user_category` also removes that category's visibility row, so it records a removal for `KIND_VISIBILITY` too |
| `events/store.set_visibility` | `KIND_VISIBILITY` |
| `PUT /portfolio/preferences` | `KIND_PREFERENCES`, uid `portfolio_preferences` |

**Triggering.** After the caller's own `with get_db()` block has committed — never inside it,
because `BEGIN IMMEDIATE` would wait on it — call `records_sync.run_records_sync("mutation")`. The
five read routes call `run_records_sync("read")` before they query.

**The status route.** `apps/api/routes/sync.py`:

```python
@router.get("/status", response_model=APIResponse[SyncStatus])
def get_sync_status():
    """Both peer-sync halves. Read-only: it never triggers a sync."""
    return APIResponse(data=SyncStatus(watchlist=watchlist_sync.current_status(),
                                       records=records_sync.current_status()))
```

registered in `main.py` with `prefix="/api/v1/sync"`. The existing
`GET /api/v1/portfolio/watchlist/peer-sync` stays exactly as it is, so the Portfolio page needs no
change. `main.py`'s lifespan gains `records_sync.run_records_sync("startup")` beside the watchlist's,
outside the `MONEYVIEW_DISABLE_STARTUP_JOBS` gate.

- [ ] **Step 1: Write the failing route tests**

`tests/api/records_sync/test_routes.py`, following `tests/api/watchlist_sync/test_routes.py`:

| Test | Assertion |
|---|---|
| `GET /api/v1/valuation/cases` merges a peer file | a case only in the peer file is listed |
| `GET /api/v1/decisions`, `GET /api/v1/market/events`, `GET /api/v1/market/event-categories`, `GET /api/v1/portfolio/preferences` each merge | one test per route |
| Creating a case publishes it | the file on disk holds the case, and `last_error is None` |
| Deleting a user event records a tombstone only while sync is on | with sync off, `record_sync` holds no `removed_at` |
| Timestamps are kept with sync off | creating a case with sync off still writes `record_sync.updated_at` |
| `GET /api/v1/sync/status` is read-only | the DB and both files are unchanged afterwards, and it reports both halves |
| Each mutation runs its sync after its own transaction | `last_error is None` and the file reflects the change, for a case, an event and a preference write; moving the call inside the block fails these |
| Startup with an unavailable folder still starts | `GET /api/v1/healthz` returns 200 |
| A records failure does not break a page | with the folder missing, every one of the five routes returns 200 |

- [ ] **Step 2: Run to verify they fail**, implement, then run again

Also run the suites that already cover these routes:
`python -m pytest tests/api/records_sync tests/api/test_valuation_*.py tests/api/test_decisions*.py tests/api/test_market_event*.py tests/api/events -q -p no:cacheprovider`

- [ ] **Step 3: Mutation check**

Each on its own, then restore:
1. `run_records_sync` moved inside `create_case`'s transaction. Run `-k after_its_own_transaction`.
   Expected: FAIL (about a 5 s wait, then "database is locked").
2. Drop the stamp from `insert_user_event`. Run `-k event` tests. Expected: FAIL.
3. Record a tombstone even with sync off. Run `-k only_while_sync_is_on`. Expected: FAIL.
4. `GET /sync/status` calls `run_records_sync`. Run `-k read_only`. Expected: FAIL.
5. Skip the read trigger on `GET /valuation/cases`. Run `-k merges_a_peer_file`. Expected: FAIL.

- [ ] **Step 4: Commit**

```bash
git add apps/api tests/api/records_sync/test_routes.py
git commit -m "feat(records-sync): stamp every record write, sync on read and mutation, status route"
```

### Task 8: The status line on the three record pages

**Files:**
- Create: `apps/web/app/components/RecordsSyncStatus.tsx`
- Modify: `apps/web/app/valuation/page.tsx`, `apps/web/app/decisions/page.tsx`,
  `apps/web/app/events/page.tsx`
- Modify: `apps/web/tests/e2e/helpers/*` as needed for the new endpoint mock
- Test: `apps/web/tests/e2e/records-sync-status.spec.ts`

The component mirrors `apps/web/app/portfolio/components/WatchlistPeerSyncStatus.tsx`, reading
`GET /api/v1/sync/status` and rendering its `records` half under
`data-testid="records-sync-status"`:

| State | Text |
|---|---|
| off | nothing rendered |
| peers, no error | `Synced with N other PC(s) · <time>`, "latest" with 2+ |
| no peers | `Sync on · no other PC has synced yet` |
| skipped files | append `· N file(s) skipped, will retry` (in both the peers and no-peers cases) |
| renamed | append `· N name clash repaired` |
| last_error | `Sync unavailable · changes are kept on this PC`, warning colour |

Use `placeholderData: keepPreviousData` so the line does not blink on refetch, and key the query on
the page's own record query `dataUpdatedAt`, so the status is read after the sync the page triggered.

- [ ] **Steps:** write the Playwright spec first (one test per state, plus one asserting the line is
  absent on a page whose sync is off), watch it fail, implement, run `npx tsc --noEmit` and ESLint on
  the changed files, then run the spec.
- [ ] **Mutation check:** (1) render when `enabled` is false → the "off" test fails; (2) show the
  oldest peer time → the two-peer test fails; (3) drop the rename suffix → the rename test fails;
  (4) remove `keepPreviousData` → the no-blink test fails.
- [ ] **Commit:** `feat(web): records sync status on the valuation, decisions and events pages`

### Task 9: Docs and gates

**Files:** `docs/local-run-resources.md`, `docs/architecture/storage-model.md`,
`guideline/sop/todo.md`, `docs/INDEX.md`

- [ ] **Step 1: Docs**
  - `docs/local-run-resources.md`: extend the "Watchlist sync between your PCs" section to say the
    same folder now also carries the owner's records, name the file, and state the two rules the
    owner must know: the newest edit to one record wins whole, and a deletion propagates.
  - `docs/architecture/storage-model.md`: a short section on `record_sync`, `sync_uid`, and which
    kinds sync.
  - `guideline/sop/todo.md`: a new Track L with one item per task.
  - `docs/INDEX.md`: add the plan row beside the spec row.
- [ ] **Step 2: Gates**
  - `python -m pytest -q -p no:cacheprovider`
  - in `apps/web`: `npx tsc --noEmit`, ESLint on changed files, and `npx playwright test --reporter=line`
  - Record the exact counts.
- [ ] **Step 3: Commit, then open the PR against `renewal`** with the spec's decisions, the
  deviations, the mutation checks and the gate results.

## Plan self-review (2026-09-20)

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 scope and kinds | 3 (registry), 5–7 (each kind wired) |
| §2 why the watchlist path does not fit | 2 (uid), 5 (tree apply) |
| §3.1 stable id, backfill | 2, 5 |
| §3.2 `record_sync` | 2, 5 |
| §3.3 shared model | 1 |
| §4 file format and validation | 4 |
| §5 merge, whole-record, name clash, first sync | 3, 5 |
| §6 triggers, lock, never raises | 6, 7 |
| §7 status and failure | 6, 7, 8 |
| §8 config, migration, tests | 2, 6, 9 |

**Placeholder scan:** Tasks 6, 7 and 8 give their tests as tables rather than full code, because each
is a variation of a test file that already exists in the repo (`tests/api/watchlist_sync/test_service.py`,
`test_routes.py`, `apps/web/tests/e2e/watchlist-peer-sync.spec.ts`). The implementer copies the shape
from the named file. Every other task carries its code in full.

**Type consistency:** `Record`/`RecordTombstone`/`RecordState` are defined in Task 3 and used with the
same fields in 4, 5 and 6. `Kind`/`ChildSpec` are defined in Task 3 and consumed in 4 and 5.
`RecordsSyncStatus` is defined in Task 6 and consumed in 7 and 8. `SkippedFile` and
`SyncFolderUnavailable` are imported from `watchlist_sync.files`, not redefined.
