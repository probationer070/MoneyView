# Watchlist Peer Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the owner's whole Watchlist identical across their PCs through a cloud-synced
folder: one file per PC, merged per ticker. Also take the owner's list out of the public seed file.

**Architecture:**
- A pure merge module orders every change by `(timestamp, author pc_id)`, with tombstones.
- A file module reads peer files and writes this PC's file atomically.
- A store module persists timestamps, tombstones and the PC id in SQLite.
- One service function, `run_sync`, runs the whole read → merge → apply → write transaction under a
  process lock.
- It runs on API start, on `GET /portfolio/watchlist`, and after every watchlist change.
- A read-only status route feeds one status line on the Portfolio page.

**Tech Stack:** Python 3.13, FastAPI, Pydantic v2, SQLite 3.51 (upsert), python-dotenv; Next.js 16,
React 19, TanStack Query v5; pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-watchlist-peer-sync-design.md`. Read it first; this plan
implements it and records where it deviates.

## Global Constraints

- **Delivery is two PRs.**
  - PR 1 (Tasks 1–8) is the sync feature. The seed file stays as it is.
  - PR 2 (Task 9) swaps the public seed for neutral defaults. The owner merges PR 2 only after
    enabling sync on both PCs and checking that the Watchlist *contents* match (spec §3).
- **Identity:** `ticker` is the unique Watchlist identity. `name`, `sector`, `group_name` and `weight`
  sync together as one row.
- **Timestamps** are UTC ISO-8601 with exactly 3 fractional digits and a `Z`, e.g.
  `2026-09-18T11:00:00.123Z`. They are compared as strings, which is valid only because the format
  is fixed.
- **`BASELINE_TS = "1970-01-01T00:00:00.000Z"`** is a fixed constant, never generated.
- **Change keys:**
  - `add_key = (updated_at, updated_by)`
  - `remove_key = (removed_at, removed_by)`
  - Tuples are compared, and the larger wins.
  - Authorship is never rewritten on import or on republish.
- **`pc_id`:** the computer name sanitised to `[A-Za-z0-9-]`, a hyphen, then 4 lowercase hex digits. It
  is stored in `dataset_metadata` (`dataset_name = 'watchlist_sync_pc_id'`, value in `source`) and
  never regenerated.
- **Peer file:** `<MONEYVIEW_SYNC_DIR>\MoneyView\watchlist.<pc_id>.json`, `format_version` 1.
  - Only names that fully match `watchlist\.([A-Za-z0-9-]+)\.json` count as peer files.
  - A file whose `pc_id` inside differs from its filename is skipped and reported.
  - This PC's own file is never a merge input.
- **Switch:** `MONEYVIEW_SYNC_DIR`. When it is unset, there are no files, no merge, no tombstones and
  no visible change.
  - Row timestamps are maintained whether sync is on or off.
  - Tombstones are recorded only while sync is on.
- **Failure:** a sync failure never fails a request, never fails startup, and never discards a
  successful local change. An unreadable peer file is never read as empty.
- **Artifacts:**

  | Artifact | Path | Rule |
  | --- | --- | --- |
  | Public seed | `apps/api/services/webscrap/stock_targets.json` | MoneyView must never write to it |
  | Peer sync files | the sync folder | private |
  | Personal export | `data/exports/watchlist-export.json` | git-ignored |

- **Tests:** every new test must be shown to fail against a named broken implementation before it is
  trusted (CLAUDE.md §8). Each task has a *Mutation check* step.
- **Line endings:** repo text files use CRLF. After creating a file, normalise it with
  `python -c "p='<path>'; b=open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'); open(p,'wb').write(b)"`.
- **Python:** from the worktree root, run
  `C:\Users\eajwa\anaconda3\envs\moneyview\python.exe -m pytest ...` with `PYTHONPATH` set to the
  worktree root.
- **Playwright:** one run at a time, on fixed ports 8110 and 3101. See `docs/git-worktrees.md` §4.
- **Git:** merges only, no rebase and no force-push. Never commit `apps/web/package-lock.json`.

## Deviations from the spec, decided while planning

| Spec says | Plan does | Why |
| --- | --- | --- |
| (not covered) | `ensure_watchlist_bootstrapped` and `load_watchlist_seed` stop writing the committed seed file. Today they regenerate it from the DB when it is missing. | A second leak path, like Export: a missing seed file would be recreated from the owner's personal list. |
| A mutation "sets the timestamp, then publishes" | A mutation runs the full `run_sync` (read, merge, apply, write) | One code path for every trigger. It is a superset of publishing, and the local change is the newest key, so it survives the merge. |
| Ordering key is `(timestamp, pc_id)` | Local stamps are strictly increasing per process (a monotonic clock, +1 ms on collision). If `(timestamp, author)` is exactly equal, the row content breaks the tie. | Two edits on one PC in the same millisecond would otherwise give two contents the same key, and the winner would depend on read order. |
| (not covered) | Rows that arrive from, or are deleted by, another PC do not schedule or retire market-data acquisition | Acquisition is best-effort. The Portfolio page fetches prices on demand, and the local routes keep their existing hooks. |

## File map

**PR 1 (sync feature):**
- Create `apps/api/core/local_env.py`: loads `config/.env`.
- Modify `apps/api/main.py`: load the local env at import; run the startup sync in `lifespan`.
- Modify `config/.env.example`: add `MONEYVIEW_SYNC_DIR=`.
- Create `apps/api/services/watchlist_sync/__init__.py`, `model.py` (pure merge, stamps), `files.py`
  (peer file format, atomic write), `store.py` (SQLite: pc_id, first sync, local state, stamps,
  tombstones), `service.py` (`run_sync`, status, `is_enabled`).
- Modify `apps/api/services/db.py`: new columns and table.
- Modify `apps/api/services/watchlist_seed.py`: sync-aware bootstrap, baseline stamps on seeded rows, no
  writes to the seed file, export path.
- Modify `apps/api/routes/portfolio.py`: stamping and publishing on writes, `peer-sync` route, Import
  refused while sync is on, retargeted Export.
- Modify `apps/api/models/schema_parts/watchlist.py` and `apps/api/models/schemas.py`: status models.
- Frontend:
  - Create `apps/web/app/portfolio/components/WatchlistPeerSyncStatus.tsx`.
  - Modify `apps/web/app/portfolio/page.tsx`, `apps/web/app/portfolio/components/StockTileGrid.tsx`,
    `apps/web/app/portfolio/components/PortfolioCommandCenter.tsx`.
- Tests:
  - `tests/api/test_local_env.py`
  - `tests/api/watchlist_sync/{__init__,test_model,test_files,test_store,test_service,test_routes}.py`
  - `apps/web/tests/e2e/watchlist-peer-sync.spec.ts`
  - modify `apps/web/tests/e2e/helpers/portfolioPageMock.ts` and `apps/web/tests/e2e/portfolio-watchlist.spec.ts`
- Docs: `docs/local-run-resources.md`, `docs/architecture/storage-model.md` §4, `guideline/sop/todo.md`.

**PR 2 (neutral seed):** `apps/api/services/webscrap/stock_targets.json`, and
`tests/api/test_watchlist_seed_neutral.py`.

---

# PR 1: the sync feature

Start in the worktree `C:\Learn\Economy\MoneyView\.claude\worktrees\wl-sync` on branch
`watchlist-peer-sync`. It already holds the spec commits. Run `npm install` in `apps/web` before the
frontend tasks. Never commit `package-lock.json`.

### Task 1: Load `config/.env`

**Files:**
- Create: `apps/api/core/local_env.py`
- Modify: `apps/api/main.py` (imports block, near line 21), `config/.env.example`
- Test: `tests/api/test_local_env.py`

**Interfaces:**
- Produces: `load_local_env(path: Path | None = None) -> bool`, and `LOCAL_ENV_PATH: Path` (the repo's
  `config/.env`).

- [ ] **Step 1: Write the failing tests**

`tests/api/test_local_env.py`:

```python
"""config/.env is loaded, and a real environment variable still wins (spec §2, Configuration)."""

import os

from apps.api.core.local_env import LOCAL_ENV_PATH, load_local_env

NAME = "MONEYVIEW_TEST_LOCAL_ENV_PROBE"


def _isolate(monkeypatch):
    # setenv then delenv registers an undo that restores "absent", so a value load_dotenv writes
    # directly into os.environ does not leak into later tests.
    monkeypatch.setenv(NAME, "sentinel")
    monkeypatch.delenv(NAME)


def test_the_default_path_is_config_env_at_the_repo_root():
    assert LOCAL_ENV_PATH.parts[-2:] == ("config", ".env")
    assert (LOCAL_ENV_PATH.parent / ".env.example").exists()


def test_a_value_in_the_file_is_loaded(tmp_path, monkeypatch):
    _isolate(monkeypatch)
    env = tmp_path / ".env"
    env.write_text(f"{NAME}=from-file\n", encoding="utf-8")

    assert load_local_env(env) is True
    assert os.environ[NAME] == "from-file"


def test_a_real_environment_variable_is_not_overridden(tmp_path, monkeypatch):
    _isolate(monkeypatch)
    monkeypatch.setenv(NAME, "from-environment")
    env = tmp_path / ".env"
    env.write_text(f"{NAME}=from-file\n", encoding="utf-8")

    load_local_env(env)

    assert os.environ[NAME] == "from-environment"


def test_a_missing_file_is_not_an_error(tmp_path):
    assert load_local_env(tmp_path / "absent.env") is False
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_local_env.py -q -p no:cacheprovider`
Expected: `ModuleNotFoundError: apps.api.core.local_env`.

- [ ] **Step 3: Implement**

`apps/api/core/local_env.py`:

```python
"""Load the git-ignored config/.env into the process environment.

`config/.env.example` documents this convention, but nothing loaded the file until now. Values
already present in the environment win (override=False), so a variable set in the shell or by the
launcher is never replaced by the file. A missing file is normal: most settings are optional.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

LOCAL_ENV_PATH = Path(__file__).resolve().parents[3] / "config" / ".env"


def load_local_env(path: Path | None = None) -> bool:
    # load_dotenv returns False for a missing file (verified with python-dotenv in the moneyview env).
    return load_dotenv(path if path is not None else LOCAL_ENV_PATH, override=False)
```

In `apps/api/main.py`, directly after the `from apps.api.core.logger import ...` line, add:

```python
from apps.api.core.local_env import load_local_env

# Before anything reads the environment. Settings such as MONEYVIEW_SYNC_DIR are read at call time,
# so loading here, at import, covers every later read.
load_local_env()
```

Append to `config/.env.example`:

```text

# Watchlist sync between your own PCs (docs/local-run-resources.md). A folder that a cloud
# client (OneDrive, Google Drive, Dropbox) keeps in sync. Leave empty to keep sync off.
MONEYVIEW_SYNC_DIR=
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/test_local_env.py -q -p no:cacheprovider`. Expected: 4 passed.

- [ ] **Step 5: Mutation check**
Apply each change on its own, run the named test, confirm it fails, then restore:
1. Pass `override=True` to `load_dotenv`. Run `-k not_overridden`. Expected: FAIL.
2. Point `LOCAL_ENV_PATH` at `parents[2]`, the wrong root. Run `-k default_path`. Expected: FAIL.
3. Return `True` unconditionally. Run `-k missing_file`. Expected: FAIL.

- [ ] **Step 6: Commit**

```bash
git add apps/api/core/local_env.py apps/api/main.py config/.env.example tests/api/test_local_env.py
git commit -m "feat(config): load config/.env at API start without overriding the environment"
```

### Task 2: The merge model and the clock

**Files:**
- Create: `apps/api/services/watchlist_sync/__init__.py` (empty), `apps/api/services/watchlist_sync/model.py`
- Test: `tests/api/watchlist_sync/__init__.py` (empty), `tests/api/watchlist_sync/test_model.py`

**Interfaces:**
- Produces:
  - `BASELINE_TS: str`
  - `TS_PATTERN: re.Pattern`
  - `format_ts(moment: datetime) -> str`
  - `next_stamp(now: datetime | None = None) -> str`
  - `SyncRow(ticker, name, sector, group_name, weight, updated_at, updated_by)`, with `.add_key()`
    and `.order_key()`
  - `Tombstone(ticker, removed_at, removed_by)`, with `.remove_key()`
  - `SyncState(rows: dict[str, SyncRow], removed: dict[str, Tombstone])`
  - `merge_states(states: Iterable[SyncState]) -> SyncState`

- [ ] **Step 1: Write the failing tests**

`tests/api/watchlist_sync/test_model.py`:

```python
"""Pure merge rules (spec §1, Merge; §3, Testing: merge function)."""

import itertools
from datetime import datetime, timezone

from apps.api.services.watchlist_sync.model import (
    BASELINE_TS,
    SyncRow,
    SyncState,
    Tombstone,
    format_ts,
    merge_states,
    next_stamp,
)


def row(ticker="AAPL", ts="2026-09-18T10:00:00.000Z", by="PC-A-0001", group="custom", weight=0.1, name="Apple"):
    return SyncRow(ticker=ticker, name=name, sector="Technology", group_name=group, weight=weight,
                   updated_at=ts, updated_by=by)


def tomb(ticker="AAPL", ts="2026-09-18T11:00:00.000Z", by="PC-B-0002"):
    return Tombstone(ticker=ticker, removed_at=ts, removed_by=by)


def state(rows=(), removed=()):
    return SyncState(rows={r.ticker: r for r in rows}, removed={t.ticker: t for t in removed})


def test_format_is_utc_milliseconds_with_z():
    moment = datetime(2026, 9, 18, 20, 0, 0, 123456, tzinfo=timezone.utc)
    assert format_ts(moment) == "2026-09-18T20:00:00.123Z"


def test_stamps_strictly_increase_even_within_one_millisecond():
    moment = datetime(2030, 1, 1, tzinfo=timezone.utc)
    first, second = next_stamp(moment), next_stamp(moment)
    assert second > first


def test_a_later_edit_wins():
    merged = merge_states([state([row(group="custom")]), state([row(ts="2026-09-18T10:05:00.000Z", group="total")])])
    assert merged.rows["AAPL"].group_name == "total"


def test_remove_then_re_add_keeps_the_ticker_and_the_ineffective_tombstone():
    merged = merge_states([state(removed=[tomb(ts="2026-09-18T11:00:00.000Z")]),
                           state([row(ts="2026-09-18T12:00:00.000Z")])])
    assert "AAPL" in merged.rows
    assert merged.removed["AAPL"].removed_at == "2026-09-18T11:00:00.000Z", "the older tombstone is kept"


def test_remove_then_edit_revives_the_ticker():
    merged = merge_states([state(removed=[tomb(ts="2026-09-18T11:00:00.000Z")]),
                           state([row(ts="2026-09-18T11:30:00.000Z", weight=0.3)])])
    assert merged.rows["AAPL"].weight == 0.3


def test_a_newer_remote_removal_deletes_an_older_local_row():
    local = state([row(ts="2026-09-18T10:00:00.000Z")])
    remote = state(removed=[tomb(ts="2026-09-18T10:00:00.001Z")])
    assert "AAPL" not in merge_states([local, remote]).rows


def test_an_older_remote_removal_does_not_delete_a_newer_local_row():
    local = state([row(ts="2026-09-18T10:00:00.001Z")])
    remote = state(removed=[tomb(ts="2026-09-18T10:00:00.000Z")])
    assert "AAPL" in merge_states([local, remote]).rows


def test_an_equal_timestamp_is_decided_by_the_larger_author():
    # The content tie-break alone would pick "zz-from-a"; only the author makes C win.
    a = row(by="PC-A-0001", group="zz-from-a")
    c = row(by="PC-C-0003", group="from-c")
    assert merge_states([state([a]), state([c])]).rows["AAPL"].group_name == "from-c"


def test_republishing_a_change_does_not_change_the_winner():
    a = row(by="PC-A-0001", group="from-a", ts="2026-09-18T10:00:00.000Z")
    c = row(by="PC-C-0003", group="from-c", ts="2026-09-18T10:00:00.000Z")
    before = merge_states([state([a]), state([c])])
    # B imported A's change and republished it: same author, same time, in a third file.
    after = merge_states([state([a]), state([a]), state([c])])
    assert before.rows["AAPL"] == after.rows["AAPL"]


def test_three_way_conflict_converges_regardless_of_order():
    versions = [row(ts="2026-09-18T10:00:00.000Z", by="PC-A-0001", group="a"),
                row(ts="2026-09-18T10:00:00.002Z", by="PC-B-0002", group="b"),
                row(ts="2026-09-18T10:00:00.001Z", by="PC-C-0003", group="c")]
    winners = {merge_states(state([v]) for v in order).rows["AAPL"].group_name for order in itertools.permutations(versions)}
    assert winners == {"b"}


def test_baseline_rows_from_two_pcs_merge_as_a_union():
    a = state([row("AAPL", ts=BASELINE_TS, by="PC-A-0001")])
    b = state([row("NVDA", ts=BASELINE_TS, by="PC-B-0002")])
    assert set(merge_states([a, b]).rows) == {"AAPL", "NVDA"}


def test_a_real_change_beats_a_baseline_row():
    base = state([row(ts=BASELINE_TS, by="PC-Z-ffff", group="old")])
    real = state([row(ts="2026-01-01T00:00:00.000Z", by="PC-A-0001", group="new")])
    assert merge_states([base, real]).rows["AAPL"].group_name == "new"
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/watchlist_sync/test_model.py -q -p no:cacheprovider`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`apps/api/services/watchlist_sync/model.py`:

```python
"""Pure merge rules for watchlist peer sync (spec §1). No I/O.

Every change is ordered by a key. The larger key wins:
    add_key    = (updated_at, updated_by)    for a watchlist row
    remove_key = (removed_at, removed_by)    for a tombstone
Timestamps use one fixed format, so comparing them as strings orders them in time. Authors travel
with the change and are never rewritten, which keeps the winner stable however files are republished.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable

BASELINE_TS = "1970-01-01T00:00:00.000Z"
TS_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z")
_TS_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


def format_ts(moment: datetime) -> str:
    utc = moment.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


_clock_lock = threading.Lock()
_last_issued = BASELINE_TS


def next_stamp(now: datetime | None = None) -> str:
    """A timestamp strictly greater than any this process issued before.

    Two edits within one millisecond on one PC would otherwise share a key while holding different
    contents, and the winner would depend on read order.
    """
    global _last_issued
    with _clock_lock:
        candidate = format_ts(now or datetime.now(timezone.utc))
        if candidate <= _last_issued:
            previous = datetime.strptime(_last_issued, _TS_FORMAT).replace(tzinfo=timezone.utc)
            candidate = format_ts(previous + timedelta(milliseconds=1))
        _last_issued = candidate
        return candidate


@dataclass(frozen=True)
class SyncRow:
    ticker: str
    name: str
    sector: str
    group_name: str
    weight: float
    updated_at: str
    updated_by: str

    def add_key(self) -> tuple[str, str]:
        return (self.updated_at, self.updated_by)

    def order_key(self) -> tuple:
        # Content breaks an exact (timestamp, author) tie, so the choice never depends on read order.
        return (self.updated_at, self.updated_by, self.name, self.sector, self.group_name, self.weight)


@dataclass(frozen=True)
class Tombstone:
    ticker: str
    removed_at: str
    removed_by: str

    def remove_key(self) -> tuple[str, str]:
        return (self.removed_at, self.removed_by)


@dataclass(frozen=True)
class SyncState:
    rows: dict[str, SyncRow] = field(default_factory=dict)
    removed: dict[str, Tombstone] = field(default_factory=dict)


def merge_states(states: Iterable[SyncState]) -> SyncState:
    best_rows: dict[str, SyncRow] = {}
    best_removed: dict[str, Tombstone] = {}
    for current in states:
        for row in current.rows.values():
            held = best_rows.get(row.ticker)
            if held is None or row.order_key() > held.order_key():
                best_rows[row.ticker] = row
        for tomb in current.removed.values():
            held_tomb = best_removed.get(tomb.ticker)
            if held_tomb is None or tomb.remove_key() > held_tomb.remove_key():
                best_removed[tomb.ticker] = tomb
    present = {
        ticker: row
        for ticker, row in best_rows.items()
        if not (ticker in best_removed and best_removed[ticker].remove_key() > row.add_key())
    }
    # Every tombstone is kept, including ones a newer add has made ineffective (spec §1).
    return SyncState(rows=present, removed=best_removed)
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/watchlist_sync/test_model.py -q -p no:cacheprovider`. Expected: 13 passed.

- [ ] **Step 5: Mutation check**

Apply each change on its own, run the named test, confirm it fails, then restore:
1. In the `present` filter, drop the tombstone check (keep every best row). Run
   `-k newer_remote_removal`. Expected: FAIL.
2. In the `present` filter, change `>` to `<`. Run `-k older_remote_removal`. Expected: FAIL.
3. In `next_stamp`, delete the `if candidate <= _last_issued` block. Run `-k strictly_increase`.
   Expected: FAIL.
4. Drop the `removed` tombstones from the returned state (`removed={}`). Run
   `-k ineffective_tombstone`. Expected: FAIL.
5. Drop `updated_by` from `order_key`, so it starts `(self.updated_at, self.name, ...)`. Run
   `-k equal_timestamp`. Expected: FAIL, because the content tie-break then picks `"zz-from-a"`.
6. Pick the smallest key instead of the largest (`<` in the `best_rows` comparison). Run `-k three_way`.
   Expected: FAIL.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/watchlist_sync/__init__.py apps/api/services/watchlist_sync/model.py tests/api/watchlist_sync/__init__.py tests/api/watchlist_sync/test_model.py
git commit -m "feat(sync): per-ticker merge by (timestamp, author) with tombstones"
```

### Task 3: Peer file format, reading and atomic writing

**Files:**
- Create: `apps/api/services/watchlist_sync/files.py`
- Test: `tests/api/watchlist_sync/test_files.py`

**Interfaces:**
- Consumes: `SyncRow`, `Tombstone`, `SyncState`, `TS_PATTERN` (Task 2).
- Produces:
  - `FORMAT_VERSION = 1`, `SYNC_SUBDIR = "MoneyView"`
  - `class SyncFolderUnavailable(OSError)`
  - `PeerFile(pc_id, written_at, state)`, `SkippedFile(name, reason)`
  - `read_peer_files(root: Path, own_pc_id: str) -> tuple[list[PeerFile], list[SkippedFile]]`
  - `write_own_file(root: Path, pc_id: str, state: SyncState, written_at: str) -> Path`
  - `own_file_path(root: Path, pc_id: str) -> Path`

- [ ] **Step 1: Write the failing tests**

`tests/api/watchlist_sync/test_files.py`:

```python
"""Peer files (spec §1: which files count, atomic writes, failure behaviour)."""

import json
import os

import pytest

from apps.api.services.watchlist_sync import files
from apps.api.services.watchlist_sync.files import (
    SyncFolderUnavailable,
    own_file_path,
    read_peer_files,
    write_own_file,
)
from apps.api.services.watchlist_sync.model import SyncRow, SyncState, Tombstone

A, B, C, ME = "PC-A-0001", "PC-B-0002", "PC-C-0003", "PC-ME-00ff"


def _state(ticker="AAPL", by=A, ts="2026-09-18T10:00:00.000Z"):
    return SyncState(
        rows={ticker: SyncRow(ticker, "Apple", "Technology", "custom", 0.1, ts, by)},
        removed={"MSFT": Tombstone("MSFT", "2026-09-18T09:00:00.000Z", by)},
    )


def _folder(tmp_path):
    folder = tmp_path / "MoneyView"
    folder.mkdir()
    return folder


def test_a_written_file_reads_back_as_the_same_state_with_authors_kept(tmp_path):
    _folder(tmp_path)
    write_own_file(tmp_path, B, _state(by=A), "2026-09-18T10:00:01.000Z")

    [peer], skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert skipped == []
    assert peer.pc_id == B and peer.written_at == "2026-09-18T10:00:01.000Z"
    assert peer.state == _state(by=A), "a republished row keeps its original author"


def test_this_pcs_own_file_is_never_an_input(tmp_path):
    _folder(tmp_path)
    write_own_file(tmp_path, ME, _state(by=ME), "2026-09-18T10:00:01.000Z")

    assert read_peer_files(tmp_path, own_pc_id=ME) == ([], [])


def test_invalid_json_is_skipped_and_reported_not_treated_as_empty(tmp_path):
    folder = _folder(tmp_path)
    (folder / f"watchlist.{A}.json").write_text("{not json", encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == []
    assert [s.name for s in skipped] == [f"watchlist.{A}.json"]


def test_an_unsupported_format_version_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    path = folder / f"watchlist.{A}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["format_version"] = 2
    path.write_text(json.dumps(payload), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and "format_version" in skipped[0].reason


def test_a_file_whose_pc_id_differs_from_its_name_is_skipped(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    (folder / f"watchlist.{A}.json").rename(folder / f"watchlist.{A}-DESKTOP.json")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"watchlist.{A}-DESKTOP.json"


def test_own_filename_with_foreign_content_is_reported_not_used(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    (folder / f"watchlist.{A}.json").rename(folder / f"watchlist.{ME}.json")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert peers == [] and skipped[0].name == f"watchlist.{ME}.json"


def test_tmp_files_and_conflict_copies_are_ignored(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state(), "2026-09-18T10:00:01.000Z")
    good = (folder / f"watchlist.{A}.json").read_text(encoding="utf-8")
    (folder / f"watchlist.{B}.json.tmp").write_text(good.replace(A, B), encoding="utf-8")
    (folder / f"watchlist.{C} (1).json").write_text(good.replace(A, C), encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert [p.pc_id for p in peers] == [A] and skipped == []


def test_one_bad_peer_does_not_poison_the_others(tmp_path):
    folder = _folder(tmp_path)
    write_own_file(tmp_path, A, _state("AAPL", by=A), "2026-09-18T10:00:01.000Z")
    write_own_file(tmp_path, C, _state("NVDA", by=C), "2026-09-18T10:00:01.000Z")
    (folder / f"watchlist.{B}.json").write_text("[]", encoding="utf-8")

    peers, skipped = read_peer_files(tmp_path, own_pc_id=ME)

    assert sorted(p.pc_id for p in peers) == [A, C]
    assert [s.name for s in skipped] == [f"watchlist.{B}.json"]


def test_a_failed_replace_leaves_the_previous_file_intact(tmp_path, monkeypatch):
    _folder(tmp_path)
    write_own_file(tmp_path, ME, _state(by=ME), "2026-09-18T10:00:01.000Z")
    before = own_file_path(tmp_path, ME).read_text(encoding="utf-8")

    def refuse(src, dst):
        raise PermissionError("simulated replace failure")

    monkeypatch.setattr(files.os, "replace", refuse)
    with pytest.raises(PermissionError):
        write_own_file(tmp_path, ME, _state("NVDA", by=ME), "2026-09-18T10:00:02.000Z")

    assert own_file_path(tmp_path, ME).read_text(encoding="utf-8") == before
    json.loads(before)


def test_a_missing_sync_root_is_unavailable_and_is_not_created(tmp_path):
    root = tmp_path / "not-there"
    with pytest.raises(SyncFolderUnavailable):
        read_peer_files(root, own_pc_id=ME)
    with pytest.raises(SyncFolderUnavailable):
        write_own_file(root, ME, _state(by=ME), "2026-09-18T10:00:01.000Z")
    assert not root.exists()


def test_the_moneyview_subfolder_is_created_inside_an_existing_root(tmp_path):
    write_own_file(tmp_path, ME, _state(by=ME), "2026-09-18T10:00:01.000Z")
    assert own_file_path(tmp_path, ME).parent == tmp_path / "MoneyView"
    assert read_peer_files(tmp_path, own_pc_id="PC-OTHER-1111")[0][0].pc_id == ME
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/watchlist_sync/test_files.py -q -p no:cacheprovider`
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`apps/api/services/watchlist_sync/files.py`:

```python
"""Peer sync files: one per PC, read defensively and written atomically (spec §1).

Only names fully matching `watchlist.<pc_id>.json` count. Temp files and cloud conflict copies that
add spaces or brackets never match. A copy that does match, e.g. `watchlist.X-DESKTOP.json`, is caught
because the pc_id inside differs from the name. An unreadable file is skipped and reported, never
read as empty. This PC's own file is output only.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from apps.api.services.watchlist_sync.model import TS_PATTERN, SyncRow, SyncState, Tombstone

FORMAT_VERSION = 1
SYNC_SUBDIR = "MoneyView"
_PEER_NAME = re.compile(r"watchlist\.([A-Za-z0-9-]+)\.json")
_PC_ID = re.compile(r"[A-Za-z0-9-]+")


class SyncFolderUnavailable(OSError):
    """The configured sync root does not exist or is not a folder."""


@dataclass(frozen=True)
class PeerFile:
    pc_id: str
    written_at: str
    state: SyncState


@dataclass(frozen=True)
class SkippedFile:
    name: str
    reason: str


def own_file_path(root: Path, pc_id: str) -> Path:
    return root / SYNC_SUBDIR / f"watchlist.{pc_id}.json"


def _require_root(root: Path) -> Path:
    if not root.is_dir():
        raise SyncFolderUnavailable(f"sync folder {root} does not exist or is not a folder")
    return root / SYNC_SUBDIR


def _ts(value, what: str) -> str:
    if not isinstance(value, str) or not TS_PATTERN.fullmatch(value):
        raise ValueError(f"{what}={value!r} is not a UTC millisecond timestamp")
    return value


def _pc(value, what: str) -> str:
    if not isinstance(value, str) or not _PC_ID.fullmatch(value):
        raise ValueError(f"{what}={value!r} is not a pc_id")
    return value


def _parse(payload: dict) -> PeerFile:
    if not isinstance(payload, dict):
        raise ValueError("the file is not a JSON object")
    if payload.get("format_version") != FORMAT_VERSION:
        raise ValueError(f"unsupported format_version {payload.get('format_version')!r}")
    rows: dict[str, SyncRow] = {}
    for raw in payload["watchlist"]:
        ticker = raw["ticker"]
        if not isinstance(ticker, str) or not ticker.strip() or ticker != ticker.strip().upper():
            raise ValueError(f"invalid ticker {ticker!r}")
        if ticker in rows:
            raise ValueError(f"duplicate ticker {ticker}")
        weight = raw["weight"]
        if isinstance(weight, bool) or not isinstance(weight, (int, float)) or not 0.0 <= float(weight) <= 1.0:
            raise ValueError(f"{ticker}: weight {weight!r} is not a number in [0, 1]")
        for text in ("name", "sector", "group_name"):
            if not isinstance(raw[text], str):
                raise ValueError(f"{ticker}: {text} is not text")
        rows[ticker] = SyncRow(
            ticker=ticker, name=raw["name"], sector=raw["sector"], group_name=raw["group_name"],
            weight=float(weight),
            updated_at=_ts(raw["updated_at"], f"{ticker} updated_at"),
            updated_by=_pc(raw["updated_by"], f"{ticker} updated_by"),
        )
    removed: dict[str, Tombstone] = {}
    for raw in payload["removed"]:
        ticker = raw["ticker"]
        if not isinstance(ticker, str) or not ticker.strip() or ticker in removed:
            raise ValueError(f"invalid or duplicate removed ticker {ticker!r}")
        removed[ticker] = Tombstone(
            ticker=ticker,
            removed_at=_ts(raw["removed_at"], f"{ticker} removed_at"),
            removed_by=_pc(raw["removed_by"], f"{ticker} removed_by"),
        )
    return PeerFile(
        pc_id=_pc(payload["pc_id"], "pc_id"),
        written_at=_ts(payload["written_at"], "written_at"),
        state=SyncState(rows=rows, removed=removed),
    )


def read_peer_files(root: Path, own_pc_id: str) -> tuple[list[PeerFile], list[SkippedFile]]:
    folder = _require_root(root)
    if not folder.is_dir():
        return [], []
    peers: list[PeerFile] = []
    skipped: list[SkippedFile] = []
    for path in sorted(folder.iterdir()):
        match = _PEER_NAME.fullmatch(path.name)
        if match is None or not path.is_file():
            continue
        try:
            peer = _parse(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, KeyError, TypeError) as error:
            skipped.append(SkippedFile(path.name, f"unreadable: {error}"))
            continue
        if peer.pc_id != match.group(1):
            skipped.append(SkippedFile(path.name, f"pc_id {peer.pc_id!r} inside does not match the filename"))
            continue
        if peer.pc_id == own_pc_id:
            continue
        peers.append(peer)
    return peers, skipped


def write_own_file(root: Path, pc_id: str, state: SyncState, written_at: str) -> Path:
    folder = _require_root(root)
    folder.mkdir(exist_ok=True)
    payload = {
        "format_version": FORMAT_VERSION,
        "pc_id": pc_id,
        "written_at": written_at,
        "watchlist": [
            {"ticker": r.ticker, "name": r.name, "sector": r.sector, "group_name": r.group_name,
             "weight": r.weight, "updated_at": r.updated_at, "updated_by": r.updated_by}
            for r in sorted(state.rows.values(), key=lambda r: r.ticker)
        ],
        "removed": [
            {"ticker": t.ticker, "removed_at": t.removed_at, "removed_by": t.removed_by}
            for t in sorted(state.removed.values(), key=lambda t: t.ticker)
        ],
    }
    final = own_file_path(root, pc_id)
    temporary = final.with_name(final.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    # Atomic on one volume: a crash leaves either the old file or the new one, never half of one.
    os.replace(temporary, final)
    return final
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/watchlist_sync -q -p no:cacheprovider`. Expected: all pass.

- [ ] **Step 5: Mutation check**

Apply each change on its own, run the named test, confirm it fails, then restore:
1. In `read_peer_files`, treat a parse error as an empty peer
   (`peers.append(PeerFile(match.group(1), "", SyncState()))`). Run `-k invalid_json`. Expected: FAIL.
2. Delete the `pc_id != match.group(1)` check. Run `-k differs_from_its_name or foreign_content`.
   Expected: both FAIL.
3. Delete `if peer.pc_id == own_pc_id: continue`. Run `-k own_file_is_never`. Expected: FAIL.
4. Write straight to `final` (skip the temp file and `os.replace`). Run `-k failed_replace`. Expected:
   FAIL, because the patched `os.replace` is no longer the only write, so the file changes.
5. Replace `_require_root` with `root.mkdir(parents=True, exist_ok=True)`. Run `-k missing_sync_root`.
   Expected: FAIL.
6. Use `_PEER_NAME.search` instead of `fullmatch`. Run `-k tmp_files`. Expected: FAIL.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/watchlist_sync/files.py tests/api/watchlist_sync/test_files.py
git commit -m "feat(sync): peer file format, defensive reading, atomic writing"
```

### Task 4: Schema, `pc_id`, and local state in SQLite

**Files:**
- Modify: `apps/api/services/db.py`: the `watchlist` table in `_CREATE_SCHEMA_SQL` (about line 290), and the
  `watchlist_columns` compatibility block (about line 859)
- Create: `apps/api/services/watchlist_sync/store.py`
- Test: `tests/api/watchlist_sync/test_store.py`

**Interfaces:**
- Consumes: Task 2 model.
- Produces:
  - `PC_ID_DATASET`, `ENABLED_DATASET`
  - `host_name() -> str`
  - `get_or_create_pc_id(conn) -> str`
  - `ensure_first_sync(conn, pc_id: str) -> None`
  - `read_local_state(conn) -> SyncState`
  - `apply_state(conn, state: SyncState) -> None`
  - `stamp_row(conn, ticker: str, pc_id: str) -> None`
  - `record_removal(conn, ticker: str, pc_id: str) -> None`
  - `watchlist_is_empty(conn) -> bool`

- [ ] **Step 1: Write the failing tests**

`tests/api/watchlist_sync/test_store.py`:

```python
"""SQLite side of sync: additive schema, durable pc_id, first-sync baseline, apply (spec §1)."""

import sqlite3

from apps.api.services import db as db_service
from apps.api.services.db import get_db
from apps.api.services.watchlist_sync import store
from apps.api.services.watchlist_sync.model import BASELINE_TS, SyncRow, SyncState, Tombstone


def _insert(ticker, group="custom", weight=0.1):
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES (?, ?, '', ?, ?)",
                     (ticker, ticker, group, weight))


def test_the_new_columns_and_table_exist():
    with get_db() as conn:
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(watchlist)")}
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"updated_at", "updated_by"} <= columns
    assert "watchlist_removed" in tables


def test_an_old_database_gains_the_columns_without_losing_rows(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    raw.execute("CREATE TABLE watchlist (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT NOT NULL UNIQUE, "
                "name TEXT DEFAULT '', sector TEXT DEFAULT '', group_name TEXT DEFAULT 'custom', weight REAL DEFAULT 0.0)")
    raw.execute("INSERT INTO watchlist (ticker, weight) VALUES ('AAPL', 0.4)")
    raw.commit()
    raw.close()
    monkeypatch.setattr(db_service, "_DB_PATH", path)

    db_service.init_db()

    with get_db() as conn:
        row = conn.execute("SELECT ticker, weight, updated_at FROM watchlist").fetchone()
    assert (row["ticker"], row["weight"], row["updated_at"]) == ("AAPL", 0.4, None)


def test_pc_id_is_generated_once_and_survives_a_rename(monkeypatch):
    monkeypatch.setattr(store, "host_name", lambda: "DESKTOP ONE")
    with get_db() as conn:
        first = store.get_or_create_pc_id(conn)
    monkeypatch.setattr(store, "host_name", lambda: "RENAMED-PC")
    with get_db() as conn:
        second = store.get_or_create_pc_id(conn)

    assert first == second
    assert first.startswith("DESKTOP-ONE-") and len(first) == len("DESKTOP-ONE-") + 4


def test_first_sync_stamps_untimestamped_rows_with_the_baseline_and_keeps_real_ones():
    _insert("AAPL")
    _insert("NVDA")
    with get_db() as conn:
        conn.execute("UPDATE watchlist SET updated_at = '2026-09-17T01:00:00.000Z', updated_by = 'PC-X-0000' WHERE ticker = 'NVDA'")
        store.ensure_first_sync(conn, "PC-ME-00ff")
        rows = {r["ticker"]: (r["updated_at"], r["updated_by"]) for r in conn.execute("SELECT * FROM watchlist")}
        tombs = conn.execute("SELECT COUNT(*) FROM watchlist_removed").fetchone()[0]

    assert rows["AAPL"] == (BASELINE_TS, "PC-ME-00ff")
    assert rows["NVDA"] == ("2026-09-17T01:00:00.000Z", "PC-X-0000")
    assert tombs == 0, "first sync never invents deletions"


def test_apply_state_writes_rows_tombstones_and_deletes_absent_rows_keeping_authors():
    _insert("AAPL")
    _insert("OLD")
    merged = SyncState(
        rows={"AAPL": SyncRow("AAPL", "Apple", "Tech", "total", 0.3, "2026-09-18T10:00:00.000Z", "PC-B-0002")},
        removed={"OLD": Tombstone("OLD", "2026-09-18T10:00:00.000Z", "PC-B-0002")},
    )
    with get_db() as conn:
        store.apply_state(conn, merged)
        assert store.read_local_state(conn) == merged


def test_stamp_row_and_record_removal_use_this_pc():
    _insert("AAPL")
    with get_db() as conn:
        store.stamp_row(conn, "AAPL", "PC-ME-00ff")
        store.record_removal(conn, "MSFT", "PC-ME-00ff")
        state = store.read_local_state(conn)
    assert state.rows["AAPL"].updated_by == "PC-ME-00ff" and state.rows["AAPL"].updated_at > BASELINE_TS
    assert state.removed["MSFT"].removed_by == "PC-ME-00ff"
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/watchlist_sync/test_store.py -q -p no:cacheprovider`
Expected: failures. The columns are missing and `store` does not exist.

- [ ] **Step 3: Implement**

In `apps/api/services/db.py` `_CREATE_SCHEMA_SQL`, change the watchlist table and add the tombstone
table right after it:

```sql
CREATE TABLE IF NOT EXISTS watchlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker     TEXT NOT NULL UNIQUE,
    name       TEXT DEFAULT '',
    sector     TEXT DEFAULT '',
    group_name TEXT DEFAULT 'custom',
    weight     REAL DEFAULT 0.0,
    updated_at TEXT,   -- logical change time for peer sync (UTC ms, Z); NULL until first stamped
    updated_by TEXT    -- pc_id that authored that change
);

-- Peer-sync tombstones: a removal remembered so an older copy on another PC cannot revive it.
CREATE TABLE IF NOT EXISTS watchlist_removed (
    ticker     TEXT PRIMARY KEY,
    removed_at TEXT NOT NULL,
    removed_by TEXT NOT NULL
);
```

In the compatibility block, directly after the existing `weight` handling for `watchlist_columns`, add:

```python
    # Nullable, additive: existing rows keep every value, and a NULL `updated_at` is stamped with
    # the baseline the first time sync runs (watchlist_sync.store.ensure_first_sync).
    if "updated_at" not in watchlist_columns:
        conn.execute("ALTER TABLE watchlist ADD COLUMN updated_at TEXT")
    if "updated_by" not in watchlist_columns:
        conn.execute("ALTER TABLE watchlist ADD COLUMN updated_by TEXT")
```

`apps/api/services/watchlist_sync/store.py`:

```python
"""SQLite side of watchlist peer sync: pc_id, first-sync baseline, local state, stamps, tombstones."""

from __future__ import annotations

import platform
import re
import secrets
import sqlite3

from apps.api.services.watchlist_sync.model import BASELINE_TS, SyncRow, SyncState, Tombstone, next_stamp

PC_ID_DATASET = "watchlist_sync_pc_id"
ENABLED_DATASET = "watchlist_sync_enabled_at"


def host_name() -> str:
    return platform.node()


def get_or_create_pc_id(conn: sqlite3.Connection) -> str:
    """Generated once per data directory and never regenerated, even if the PC is renamed."""
    row = conn.execute("SELECT source FROM dataset_metadata WHERE dataset_name = ?", (PC_ID_DATASET,)).fetchone()
    if row and row["source"]:
        return row["source"]
    name = re.sub(r"[^A-Za-z0-9-]+", "-", host_name()).strip("-") or "PC"
    pc_id = f"{name}-{secrets.token_hex(2)}"
    conn.execute(
        "INSERT OR REPLACE INTO dataset_metadata (dataset_name, last_updated_at, source) VALUES (?, ?, ?)",
        (PC_ID_DATASET, next_stamp(), pc_id),
    )
    return pc_id


def ensure_first_sync(conn: sqlite3.Connection, pc_id: str) -> None:
    """Once per data directory: rows without a timestamp get the baseline, so the first merge
    between PCs is a union. Rows already stamped keep their real time. No tombstones are made."""
    done = conn.execute("SELECT 1 FROM dataset_metadata WHERE dataset_name = ?", (ENABLED_DATASET,)).fetchone()
    if done:
        return
    conn.execute(
        "UPDATE watchlist SET updated_at = ?, updated_by = ? WHERE updated_at IS NULL",
        (BASELINE_TS, pc_id),
    )
    conn.execute(
        "INSERT OR REPLACE INTO dataset_metadata (dataset_name, last_updated_at, source) VALUES (?, ?, ?)",
        (ENABLED_DATASET, next_stamp(), pc_id),
    )


def watchlist_is_empty(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0] == 0


def read_local_state(conn: sqlite3.Connection) -> SyncState:
    rows = {
        r["ticker"]: SyncRow(
            ticker=r["ticker"], name=r["name"] or "", sector=r["sector"] or "",
            group_name=r["group_name"] or "custom", weight=float(r["weight"] or 0.0),
            updated_at=r["updated_at"] or BASELINE_TS, updated_by=r["updated_by"] or "",
        )
        for r in conn.execute("SELECT ticker, name, sector, group_name, weight, updated_at, updated_by FROM watchlist")
    }
    removed = {
        r["ticker"]: Tombstone(ticker=r["ticker"], removed_at=r["removed_at"], removed_by=r["removed_by"])
        for r in conn.execute("SELECT ticker, removed_at, removed_by FROM watchlist_removed")
    }
    return SyncState(rows=rows, removed=removed)


def apply_state(conn: sqlite3.Connection, state: SyncState) -> None:
    """Make the local tables equal the merged state. Authors and timestamps are stored as received."""
    current = read_local_state(conn)
    for ticker in current.rows.keys() - state.rows.keys():
        conn.execute("DELETE FROM watchlist WHERE ticker = ?", (ticker,))
    for row in state.rows.values():
        if current.rows.get(row.ticker) == row:
            continue
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight, updated_at, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET name = excluded.name, sector = excluded.sector,
                   group_name = excluded.group_name, weight = excluded.weight,
                   updated_at = excluded.updated_at, updated_by = excluded.updated_by""",
            (row.ticker, row.name, row.sector, row.group_name, row.weight, row.updated_at, row.updated_by),
        )
    for tomb in state.removed.values():
        if current.removed.get(tomb.ticker) == tomb:
            continue
        conn.execute(
            """INSERT INTO watchlist_removed (ticker, removed_at, removed_by) VALUES (?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET removed_at = excluded.removed_at, removed_by = excluded.removed_by""",
            (tomb.ticker, tomb.removed_at, tomb.removed_by),
        )


def stamp_row(conn: sqlite3.Connection, ticker: str, pc_id: str) -> None:
    conn.execute("UPDATE watchlist SET updated_at = ?, updated_by = ? WHERE ticker = ?", (next_stamp(), pc_id, ticker))


def record_removal(conn: sqlite3.Connection, ticker: str, pc_id: str) -> None:
    conn.execute(
        """INSERT INTO watchlist_removed (ticker, removed_at, removed_by) VALUES (?, ?, ?)
           ON CONFLICT(ticker) DO UPDATE SET removed_at = excluded.removed_at, removed_by = excluded.removed_by""",
        (ticker, next_stamp(), pc_id),
    )
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/watchlist_sync tests/api/test_sqlite_schema_validation.py tests/api/test_watchlist_merge.py -q -p no:cacheprovider`.
Expected: all pass.

- [ ] **Step 5: Mutation check**

Apply each change on its own, run the named test, confirm it fails, then restore:
1. In `get_or_create_pc_id`, skip the lookup and always generate a new id. Run `-k survives_a_rename`.
   Expected: FAIL.
2. In `ensure_first_sync`, drop `WHERE updated_at IS NULL`. Run `-k keeps_real_ones`. Expected: FAIL.
3. In `apply_state`, delete the absent-row `DELETE` loop. Run `-k deletes_absent_rows`. Expected: FAIL.
4. In `apply_state`, store `updated_by` as a constant `"PC-ME"`. Run `-k keeping_authors`. Expected: FAIL.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/db.py apps/api/services/watchlist_sync/store.py tests/api/watchlist_sync/test_store.py
git commit -m "feat(sync): watchlist timestamps, tombstones and a durable pc_id in SQLite"
```

### Task 5: `run_sync`, bootstrap precedence, and seed-side changes

**Files:**
- Create: `apps/api/services/watchlist_sync/service.py`
- Modify: `apps/api/services/watchlist_seed.py`
- Modify: `apps/api/models/schema_parts/watchlist.py`, `apps/api/models/schemas.py` (status models)
- Test: `tests/api/watchlist_sync/test_service.py`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `service.sync_root() -> Path | None`
  - `service.is_enabled() -> bool`
  - `service.run_sync(trigger: str, seed_json: Path | None = None) -> None` (never raises)
  - `service.current_status() -> WatchlistPeerSyncStatus`
  - `service.local_pc_id(conn) -> str`
  - In `watchlist_seed`:
    - `SEED_JSON: Path`
    - `EXPORT_JSON: Path`
    - `bootstrap_from_seed(json_path: Path) -> None` (the old bootstrap body, with no file writes)
    - `ensure_watchlist_bootstrapped(json_path)`, now sync-aware
  - Pydantic models `WatchlistPeer(pc_id, written_at)`, `WatchlistSkippedFile(name, reason)`, and
    `WatchlistPeerSyncStatus(enabled, pc_id, peers, skipped_files, last_sync_at, last_error)`.

- [ ] **Step 1: Add the status models**

Add to `apps/api/models/schema_parts/watchlist.py`, after `WatchlistSyncStatus`:

```python
class WatchlistPeer(BaseModel):
    """Another PC seen in the sync folder. `written_at` is its last successful file write."""

    pc_id: str
    written_at: str


class WatchlistSkippedFile(BaseModel):
    name: str
    reason: str


class WatchlistPeerSyncStatus(BaseModel):
    """The last recorded peer-sync attempt. Replaced as a whole by every attempt (spec §2)."""

    enabled: bool = False
    pc_id: Optional[str] = None
    peers: List[WatchlistPeer] = Field(default_factory=list)
    skipped_files: List[WatchlistSkippedFile] = Field(default_factory=list)
    last_sync_at: Optional[str] = None
    last_error: Optional[str] = None
```

In `apps/api/models/schemas.py`, export `WatchlistPeer`, `WatchlistSkippedFile` and
`WatchlistPeerSyncStatus` next to `WatchlistSyncStatus`: add them to the watchlist import and to
`__all__`.

- [ ] **Step 2: Write the failing two-PC tests**

`tests/api/watchlist_sync/test_service.py`:

```python
"""Two or three simulated PCs sharing one sync folder (spec §3, Testing: simulated PCs)."""

import json

import pytest

from apps.api.services import db as db_service
from apps.api.services import watchlist_seed
from apps.api.services.db import get_db
from apps.api.services.watchlist_sync import files, service, store
from apps.api.services.watchlist_sync.model import BASELINE_TS


class PC:
    def __init__(self, tmp_path, name, monkeypatch):
        self.name = name
        self.db = tmp_path / f"{name}.db"
        self.monkeypatch = monkeypatch
        self.use()
        db_service.init_db()

    def use(self):
        self.monkeypatch.setattr(db_service, "_DB_PATH", self.db)
        self.monkeypatch.setattr(store, "host_name", lambda: self.name)
        return self

    def sync(self):
        self.use()
        service.run_sync("test")
        return self

    def rows(self):
        self.use()
        with get_db() as conn:
            return {r["ticker"]: dict(r) for r in conn.execute("SELECT ticker, group_name, weight, updated_at, updated_by FROM watchlist")}

    def tombstones(self):
        self.use()
        with get_db() as conn:
            return {r["ticker"]: (r["removed_at"], r["removed_by"]) for r in conn.execute("SELECT * FROM watchlist_removed")}

    def add(self, ticker, group="custom", weight=0.1):
        self.use()
        with get_db() as conn:
            pc_id = service.local_pc_id(conn)
            conn.execute("INSERT OR REPLACE INTO watchlist (ticker, name, sector, group_name, weight) VALUES (?, ?, '', ?, ?)",
                         (ticker, ticker, group, weight))
            store.stamp_row(conn, ticker, pc_id)
        return self.sync()

    def delete(self, ticker):
        self.use()
        with get_db() as conn:
            pc_id = service.local_pc_id(conn)
            conn.execute("DELETE FROM watchlist WHERE ticker = ?", (ticker,))
            store.record_removal(conn, ticker, pc_id)
        return self.sync()


@pytest.fixture
def cloud(tmp_path, monkeypatch):
    root = tmp_path / "cloud"
    root.mkdir()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(root))
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"custom": {"targets": [{"ticker": "SEED", "name": "Seed", "sector": "", "weight": 0.0}]}}), encoding="utf-8")
    monkeypatch.setattr(watchlist_seed, "SEED_JSON", seed)
    return root


def test_an_add_on_one_pc_reaches_the_other(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.add("NVDA")
    b.sync()
    assert "NVDA" in b.rows()


def test_a_delete_on_one_pc_removes_it_on_the_other(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("NVDA"); b.sync()
    b.delete("NVDA")
    a.sync()
    assert "NVDA" not in a.rows()


def test_edits_to_different_tickers_on_both_pcs_both_survive(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("AAA"); b.add("BBB")
    a.sync(); b.sync()
    assert {"AAA", "BBB"} <= set(a.rows()) and {"AAA", "BBB"} <= set(b.rows())


def test_first_sync_is_a_union_and_invents_no_deletions(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    for pc, ticker in ((a, "ONLY-A"), (b, "ONLY-B")):
        pc.use()
        with get_db() as conn:
            conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES (?, ?, '', 'custom', 0.0)", (ticker, ticker))
    a.sync(); b.sync(); a.sync()
    assert {"ONLY-A", "ONLY-B"} <= set(a.rows()) and {"ONLY-A", "ONLY-B"} <= set(b.rows())
    assert a.rows()["ONLY-A"]["updated_at"] == BASELINE_TS
    assert a.tombstones() == {} and b.tombstones() == {}


def test_a_fresh_pc_with_peers_takes_their_merged_list_not_the_defaults(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("AAA"); b.add("BBB")
    fresh = PC(tmp_path, "PC-NEW", monkeypatch).sync()
    assert {"AAA", "BBB"} <= set(fresh.rows())
    assert "SEED" not in fresh.rows(), "defaults are not seeded when a readable peer exists"


def test_a_fresh_pc_without_peers_gets_the_seed_at_the_baseline(tmp_path, monkeypatch, cloud):
    fresh = PC(tmp_path, "PC-NEW", monkeypatch).sync()
    assert fresh.rows()["SEED"]["updated_at"] == BASELINE_TS


def test_an_empty_merged_peer_state_leaves_a_fresh_pc_empty(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch).sync()   # empty, no peers: seeds SEED
    assert set(a.rows()) == {"SEED"}
    a.delete("SEED")                                # A's file now holds no rows, one tombstone
    fresh = PC(tmp_path, "PC-NEW", monkeypatch).sync()
    assert fresh.rows() == {}


def test_imported_tombstones_are_republished_to_a_third_pc(tmp_path, monkeypatch, cloud):
    a, b, c = (PC(tmp_path, n, monkeypatch) for n in ("PC-A", "PC-B", "PC-C"))
    a.add("NVDA"); b.sync(); c.sync()
    b.delete("NVDA")
    a.sync()
    b.use()
    with get_db() as conn:
        b_id = service.local_pc_id(conn)
    files.own_file_path(cloud, b_id).unlink()
    c.sync()
    assert "NVDA" not in c.rows()


def test_an_off_then_on_edit_keeps_its_real_time_and_wins(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("NVDA", group="custom"); b.sync()
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR")
    b.use()
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
        conn.execute("UPDATE watchlist SET group_name = 'total' WHERE ticker = 'NVDA'")
        store.stamp_row(conn, "NVDA", pc_id)
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(cloud))
    b.sync(); a.sync()
    assert a.rows()["NVDA"]["group_name"] == "total"


def test_the_seed_merge_does_not_revive_a_ticker_deleted_on_another_pc(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync(); a.sync()
    b.delete("SEED")
    a.sync()
    a.use()
    watchlist_seed.ensure_watchlist_bootstrapped(watchlist_seed.SEED_JSON)
    assert "SEED" not in a.rows()


def test_a_failed_publish_keeps_the_local_change_and_retries(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch).sync()

    def refuse(*args, **kwargs):
        raise PermissionError("simulated publish failure")

    monkeypatch.setattr(service, "write_own_file", refuse)
    a.add("NVDA")
    assert "NVDA" in a.rows()
    assert "simulated publish failure" in service.current_status().last_error

    # Restore just this patch: monkeypatch.undo() would also undo conftest's autouse guards.
    monkeypatch.setattr(service, "write_own_file", files.write_own_file)
    a.sync()
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
    published = json.loads(files.own_file_path(cloud, pc_id).read_text(encoding="utf-8"))
    assert "NVDA" in {row["ticker"] for row in published["watchlist"]}
    assert service.current_status().last_error is None


def test_status_lists_peers_and_only_the_last_attempts_skips(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    bad = cloud / "MoneyView" / "watchlist.PC-BROKEN-0000.json"
    bad.write_text("{", encoding="utf-8")
    a.sync()
    status = service.current_status()
    assert [p.pc_id for p in status.peers][0].startswith("PC-B-")
    assert [s.name for s in status.skipped_files] == [bad.name]
    bad.unlink()
    a.sync()
    assert service.current_status().skipped_files == []


def test_a_missing_folder_is_recorded_and_changes_nothing(tmp_path, monkeypatch, cloud):
    a = PC(tmp_path, "PC-A", monkeypatch).sync()
    before = a.rows()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "gone"))
    a.sync()
    assert a.rows() == before
    assert "does not exist" in service.current_status().last_error


def test_both_pcs_converge_on_identical_state(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()                              # A seeds SEED; B takes it from A
    a.add("AAA", weight=0.1); b.add("AAA", weight=0.2); a.delete("SEED")
    b.add("BBB"); a.add("CCC"); b.sync(); b.delete("CCC")
    for _ in range(2):
        a.sync(); b.sync()
    assert a.rows() == b.rows()
    assert a.tombstones() == b.tombstones()


def test_sync_off_does_nothing(tmp_path, monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    a = PC(tmp_path, "PC-A", monkeypatch)
    service.run_sync("test")
    assert service.current_status().enabled is False
    assert not (tmp_path / "MoneyView").exists()
```

- [ ] **Step 3: Run to verify they fail**

Run: `python -m pytest tests/api/watchlist_sync/test_service.py -q -p no:cacheprovider`
Expected: `ModuleNotFoundError` (`service`).

- [ ] **Step 4: Implement the service**

`apps/api/services/watchlist_sync/service.py`:

```python
"""run_sync: the one transaction every trigger uses (spec §2).

read peer files -> merge -> apply to SQLite -> write this PC's file, under one process lock. It
never raises: a failure is recorded in the status, and the local Watchlist keeps working.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from pathlib import Path

from apps.api.models.schemas import WatchlistPeer, WatchlistPeerSyncStatus, WatchlistSkippedFile
from apps.api.services.db import get_db
from apps.api.services.watchlist_sync import store
from apps.api.services.watchlist_sync.files import read_peer_files, write_own_file
from apps.api.services.watchlist_sync.model import merge_states, next_stamp

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_status = WatchlistPeerSyncStatus()


def sync_root() -> Path | None:
    raw = os.getenv("MONEYVIEW_SYNC_DIR", "").strip()
    return Path(raw) if raw else None


def is_enabled() -> bool:
    return sync_root() is not None


def local_pc_id(conn: sqlite3.Connection) -> str:
    return store.get_or_create_pc_id(conn)


def current_status() -> WatchlistPeerSyncStatus:
    if not is_enabled():
        return WatchlistPeerSyncStatus(enabled=False)
    return _status


def run_sync(trigger: str, seed_json: Path | None = None) -> None:
    global _status
    root = sync_root()
    if root is None:
        _status = WatchlistPeerSyncStatus(enabled=False)
        return
    with _lock:
        pc_id = None
        try:
            with get_db() as conn:
                pc_id = store.get_or_create_pc_id(conn)
                store.ensure_first_sync(conn, pc_id)
            peers, skipped = read_peer_files(root, pc_id)
            with get_db() as conn:
                empty = store.watchlist_is_empty(conn)
            if empty and not peers:
                # Spec §3 precedence: with no readable peer, a fresh PC runs today's bootstrap.
                from apps.api.services import watchlist_seed

                watchlist_seed.bootstrap_from_seed(seed_json or watchlist_seed.SEED_JSON)
            with get_db() as conn:
                merged = merge_states([store.read_local_state(conn), *(peer.state for peer in peers)])
                store.apply_state(conn, merged)
            finished = next_stamp()
            write_own_file(root, pc_id, merged, finished)
            _status = WatchlistPeerSyncStatus(
                enabled=True,
                pc_id=pc_id,
                peers=[WatchlistPeer(pc_id=p.pc_id, written_at=p.written_at) for p in peers],
                skipped_files=[WatchlistSkippedFile(name=s.name, reason=s.reason) for s in skipped],
                last_sync_at=finished,
                last_error=None,
            )
        except Exception as error:  # noqa: BLE001 - sync must never break the local Watchlist
            logger.warning("watchlist.peer_sync_failed trigger=%s error=%s", trigger, error)
            _status = WatchlistPeerSyncStatus(
                enabled=True, pc_id=pc_id, peers=[], skipped_files=[],
                last_sync_at=_status.last_sync_at, last_error=str(error),
            )
```

- [ ] **Step 5: Make the seed side sync-aware and non-writing**

In `apps/api/services/watchlist_seed.py`:

1. After the `DEFAULT_WATCHLIST_METADATA` line, add:

```python
_REPO_ROOT = Path(__file__).resolve().parents[3]
# The committed PUBLIC seed. MoneyView reads it and must never write it: that is how the owner's
# personal list ended up in a public repository.
SEED_JSON = Path(__file__).resolve().parent / "webscrap" / "stock_targets.json"
# Personal export, git-ignored under data/.
EXPORT_JSON = _REPO_ROOT / "data" / "exports" / "watchlist-export.json"
```

2. Rename the body of `ensure_watchlist_bootstrapped` into a new function, and make the old name a
   sync-aware wrapper:

```python
def ensure_watchlist_bootstrapped(json_path: Path) -> None:
    """Seed an empty watchlist, sync-aware (spec §3, bootstrap precedence).

    With sync on, the whole decision happens inside run_sync, after peer discovery: a readable peer
    wins over the seed, and the seed is used only when no peer exists. With sync off, today's
    behaviour is kept.
    """
    from apps.api.services.watchlist_sync import service as watchlist_sync

    if watchlist_sync.is_enabled():
        watchlist_sync.run_sync("bootstrap", seed_json=json_path)
        return
    bootstrap_from_seed(json_path)


def bootstrap_from_seed(json_path: Path) -> None:
    """Seed the table once when it is empty and no user/bootstrap state exists. Seeded rows get the
    baseline stamp, so any real change on any PC outranks them. Never writes the seed file."""
    with get_db() as conn:
        row = conn.execute("SELECT COUNT(*) AS count FROM watchlist").fetchone()
        if row and int(row["count"]) > 0:
            return
        if _has_watchlist_state(conn):
            return

        from apps.api.services.watchlist_sync import store as sync_store
        from apps.api.services.watchlist_sync.model import BASELINE_TS

        pc_id = sync_store.get_or_create_pc_id(conn)
        items, source = load_watchlist_seed(json_path)
        for item in items:
            conn.execute(
                """INSERT OR IGNORE INTO watchlist (ticker, name, sector, group_name, weight, updated_at, updated_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (item.ticker.upper(), item.name, item.sector, item.group_name, item.weight, BASELINE_TS, pc_id),
            )
        _mark_watchlist_state(conn, source)
```

   This removes the old `if not json_path.exists(): ... _write_watchlist_json(json_path, regenerated)` block.

3. In `load_watchlist_seed`, replace `regenerated = _regenerate_watchlist_json_from_db(json_path)`
   with:

```python
    with get_db() as conn:
        regenerated = _build_watchlist_items_from_db(conn)
```

   Then delete `_regenerate_watchlist_json_from_db`, which now has no callers.

4. In `merge_missing_watchlist_items`, make inserted rows baseline-stamped as well. Change its
   `INSERT OR IGNORE` to include `updated_at, updated_by`, with `BASELINE_TS` and
   `sync_store.get_or_create_pc_id(conn)`, using the same local imports as in `bootstrap_from_seed`.

5. In `resync_watchlist_from_json`, make inserted rows baseline-stamped the same way. This path is
   refused while sync is on (Task 6), so this only keeps timestamps present.

- [ ] **Step 6: Run to verify they pass**

Run: `python -m pytest tests/api/watchlist_sync tests/api/test_watchlist_merge.py tests/api/test_watchlist_resync.py tests/api/test_watchlist_group.py tests/api/test_watchlist_id.py -q -p no:cacheprovider`
Expected: all pass. If an existing watchlist test asserted that a missing seed file gets regenerated
on disk, report it. That behaviour is removed on purpose (see Deviations): update the test to assert
the file is **not** written, and say so in the report.

- [ ] **Step 7: Mutation check**

Apply each change on its own, run the named test, confirm it fails, then restore:
1. `run_sync`: seed even when peers exist (`if empty:`). Run `-k fresh_pc_with_peers`. Expected: FAIL.
2. `ensure_watchlist_bootstrapped`: call `bootstrap_from_seed` before the sync branch. Run
   `-k seed_merge_does_not_revive or fresh_pc_with_peers`. Report which fails.
3. `run_sync`: keep `last_error` from the previous status on success. Run `-k failed_publish`.
   Expected: FAIL at `last_error is None`.
4. `run_sync`: accumulate `skipped_files` across attempts (`[*_status.skipped_files, ...]`). Run
   `-k only_the_last_attempts_skips`. Expected: FAIL.
5. `bootstrap_from_seed`: stamp seeded rows with `next_stamp()` instead of `BASELINE_TS`. Run
   `-k fresh_pc_without_peers`. Expected: FAIL.
6. `run_sync`: let an exception escape (remove the `except`). Run `-k missing_folder`. Expected: FAIL
   with an error.

- [ ] **Step 8: Commit**

```bash
git add apps/api/services/watchlist_sync/service.py apps/api/services/watchlist_seed.py apps/api/models/schema_parts/watchlist.py apps/api/models/schemas.py tests/api/watchlist_sync/test_service.py
git commit -m "feat(sync): run_sync with bootstrap precedence; the seed file is never written"
```

### Task 6: Wire the triggers and routes

**Files:**
- Modify: `apps/api/routes/portfolio.py` (GET `/watchlist`, POST `/watchlist`,
  POST `/watchlist/{ticker}/group`, DELETE `/watchlist/{ticker}`, POST `/watchlist/resync`,
  POST `/watchlist/sync`, the new GET `/watchlist/peer-sync`)
- Modify: `apps/api/main.py` (`lifespan`)
- Test: `tests/api/watchlist_sync/test_routes.py`

**Interfaces:**
- Consumes: `service.run_sync`, `service.is_enabled`, `service.current_status`, `service.local_pc_id`,
  `store.stamp_row`, `store.record_removal`, `watchlist_seed.EXPORT_JSON`.
- Produces:
  - `GET /api/v1/portfolio/watchlist/peer-sync` → `APIResponse[WatchlistPeerSyncStatus]`
  - Import while sync is on → 409 `"Import is unavailable while watchlist sync is on"`
  - Export → `data/exports/watchlist-export.json`

- [ ] **Step 1: Write the failing route tests**

`tests/api/watchlist_sync/test_routes.py`:

```python
"""Routes and startup (spec §2, §3)."""

import json

from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.routes import portfolio as portfolio_routes
from apps.api.services import watchlist_seed
from apps.api.services.db import get_db
from apps.api.services.watchlist_sync import files, service

client = TestClient(app)
BASE = "/api/v1/portfolio/watchlist"


def _quiet_prices(monkeypatch):
    monkeypatch.setattr(portfolio_routes._mkt, "get_stock_ohlcv", lambda *a, **k: [])


def _enable(tmp_path, monkeypatch):
    root = tmp_path / "cloud"
    root.mkdir()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(root))
    _quiet_prices(monkeypatch)
    return root


def test_get_watchlist_merges_a_peer_file(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    (root / "MoneyView").mkdir()
    (root / "MoneyView" / "watchlist.PC-PEER-0001.json").write_text(json.dumps({
        "format_version": 1, "pc_id": "PC-PEER-0001", "written_at": "2026-09-18T10:00:00.000Z",
        "watchlist": [{"ticker": "PEER", "name": "Peer", "sector": "", "group_name": "custom", "weight": 0.0,
                       "updated_at": "2026-09-18T10:00:00.000Z", "updated_by": "PC-PEER-0001"}],
        "removed": []}), encoding="utf-8")

    tickers = {row["ticker"] for row in client.get(BASE).json()}

    assert "PEER" in tickers


def test_get_watchlist_does_not_revive_a_seed_ticker_deleted_on_another_pc(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"custom": {"targets": [{"ticker": "SEED", "name": "Seed", "sector": "", "weight": 0.0}]}}), encoding="utf-8")
    monkeypatch.setattr(portfolio_routes, "_WATCHLIST_JSON", seed)
    client.post(BASE, json={"ticker": "KEEP", "name": "Keep", "sector": "", "group_name": "custom", "weight": 0.0})
    (root / "MoneyView" / "watchlist.PC-PEER-0001.json").write_text(json.dumps({
        "format_version": 1, "pc_id": "PC-PEER-0001", "written_at": "2026-09-18T10:00:00.000Z",
        "watchlist": [],
        "removed": [{"ticker": "SEED", "removed_at": "2026-09-18T10:00:00.000Z", "removed_by": "PC-PEER-0001"}]}),
        encoding="utf-8")

    tickers = {row["ticker"] for row in client.get(BASE).json()}

    assert "SEED" not in tickers, "the git-seed merge must not run while sync is on"


def test_a_missing_folder_still_serves_the_watchlist_and_reports_the_error(tmp_path, monkeypatch):
    _quiet_prices(monkeypatch)
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "gone"))

    response = client.get(BASE)

    assert response.status_code == 200
    assert client.get(f"{BASE}/peer-sync").json()["data"]["last_error"]


def test_peer_sync_is_read_only(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    client.get(BASE)
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
        before_rows = [tuple(r) for r in conn.execute("SELECT * FROM watchlist ORDER BY ticker")]
    own = files.own_file_path(root, pc_id)
    before_mtime = own.stat().st_mtime_ns

    client.get(f"{BASE}/peer-sync")

    with get_db() as conn:
        assert [tuple(r) for r in conn.execute("SELECT * FROM watchlist ORDER BY ticker")] == before_rows
    assert own.stat().st_mtime_ns == before_mtime


def test_a_local_edit_is_stamped_and_published(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    client.post(BASE, json={"ticker": "NVDA", "name": "NVIDIA", "sector": "Semis", "group_name": "custom", "weight": 0.1})
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
        row = conn.execute("SELECT updated_by FROM watchlist WHERE ticker = 'NVDA'").fetchone()
    published = json.loads(files.own_file_path(root, pc_id).read_text(encoding="utf-8"))

    assert row["updated_by"] == pc_id
    assert "NVDA" in {r["ticker"] for r in published["watchlist"]}


def test_an_unchanged_upsert_keeps_the_timestamp(tmp_path, monkeypatch):
    _enable(tmp_path, monkeypatch)
    body = {"ticker": "NVDA", "name": "NVIDIA", "sector": "Semis", "group_name": "custom", "weight": 0.1}
    client.post(BASE, json=body)
    with get_db() as conn:
        first = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]
    client.post(BASE, json=body)
    with get_db() as conn:
        second = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]
    assert first == second


def test_a_group_change_is_stamped(tmp_path, monkeypatch):
    _enable(tmp_path, monkeypatch)
    client.post(BASE, json={"ticker": "NVDA", "name": "NVIDIA", "sector": "", "group_name": "custom", "weight": 0.1})
    with get_db() as conn:
        first = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]
    client.post(f"{BASE}/NVDA/group", json={"group_name": "total"})
    with get_db() as conn:
        second = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]
    assert second > first


def test_a_delete_records_a_tombstone_only_while_sync_is_on(tmp_path, monkeypatch):
    _quiet_prices(monkeypatch)
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    client.post(BASE, json={"ticker": "OFF", "name": "Off", "sector": "", "group_name": "custom", "weight": 0.0})
    client.delete(f"{BASE}/OFF")
    _enable(tmp_path, monkeypatch)
    client.post(BASE, json={"ticker": "ON", "name": "On", "sector": "", "group_name": "custom", "weight": 0.0})
    client.delete(f"{BASE}/ON")
    with get_db() as conn:
        tombs = {r["ticker"] for r in conn.execute("SELECT ticker FROM watchlist_removed")}
    assert tombs == {"ON"}


def test_timestamps_are_kept_while_sync_is_off(tmp_path, monkeypatch):
    _quiet_prices(monkeypatch)
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    client.post(BASE, json={"ticker": "OFF", "name": "Off", "sector": "", "group_name": "custom", "weight": 0.0})
    with get_db() as conn:
        row = conn.execute("SELECT updated_at, updated_by FROM watchlist WHERE ticker = 'OFF'").fetchone()
    assert row["updated_at"] and row["updated_by"]


def test_import_is_refused_while_sync_is_on_even_without_the_ui(tmp_path, monkeypatch):
    _enable(tmp_path, monkeypatch)
    response = client.post(f"{BASE}/resync")
    assert response.status_code == 409
    assert "unavailable while watchlist sync is on" in response.text


def test_export_writes_the_personal_file_never_the_committed_seed(tmp_path, monkeypatch):
    _quiet_prices(monkeypatch)
    export = tmp_path / "exports" / "watchlist-export.json"
    monkeypatch.setattr(watchlist_seed, "EXPORT_JSON", export)
    seed_before = watchlist_seed.SEED_JSON.read_bytes()
    client.post(BASE, json={"ticker": "NVDA", "name": "NVIDIA", "sector": "", "group_name": "custom", "weight": 0.1})

    for sync_dir in (None, tmp_path / "cloud"):
        if sync_dir is None:
            monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
        else:
            sync_dir.mkdir(exist_ok=True)
            monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(sync_dir))
        response = client.post(f"{BASE}/sync")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["json_path"] == str(export)

    assert "NVDA" in export.read_text(encoding="utf-8")
    assert watchlist_seed.SEED_JSON.read_bytes() == seed_before


def test_startup_with_an_unavailable_folder_still_starts(tmp_path, monkeypatch):
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "gone"))
    monkeypatch.setenv("MONEYVIEW_DISABLE_STARTUP_JOBS", "1")
    with TestClient(app) as started:
        assert started.get("/api/v1/healthz").status_code == 200
```

`/api/v1/healthz` is defined at `apps/api/main.py:200`.

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/watchlist_sync/test_routes.py -q -p no:cacheprovider`
Expected: failures (404 on `peer-sync`, no stamps, Import returning 200).

- [ ] **Step 3: Implement the routes**

In `apps/api/routes/portfolio.py`:

- Imports:

```python
from apps.api.models.schemas import WatchlistPeerSyncStatus  # add to the existing schemas import
from apps.api.services.watchlist_seed import EXPORT_JSON  # add to the existing watchlist_seed import
from apps.api.services.watchlist_sync import service as watchlist_sync
from apps.api.services.watchlist_sync import store as watchlist_sync_store
```

  In `sync_watchlist`, refer to the export path as `watchlist_seed.EXPORT_JSON` through a module
  import (`from apps.api.services import watchlist_seed`), so the test's monkeypatch takes effect.
  Do the same for any other `EXPORT_JSON` use.

- `get_watchlist`: replace the `ensure_watchlist_bootstrapped(...)` / `merge_missing_watchlist_items(...)` lines with:

```python
    # With sync on, this runs the full peer sync (spec §2): the response never shows an older
    # state than a readable peer file holds.
    ensure_watchlist_bootstrapped(_WATCHLIST_JSON)
    if not watchlist_sync.is_enabled():
        # Sync replaces the git-based seed merge; left on, it would revive a ticker deleted on
        # another PC (spec §3).
        merge_missing_watchlist_items(_WATCHLIST_JSON)
```

- `upsert_watchlist_item`: inside the `with get_db()` block, read the full existing row and stamp only
  on an actual change. Replace the `existing = ...` select and the `INSERT OR REPLACE` with:

```python
        existing = conn.execute(
            "SELECT name, sector, group_name, weight, updated_at, updated_by FROM watchlist WHERE ticker = ?",
            (normalized.ticker,),
        ).fetchone()
        changed = existing is None or (
            existing["name"], existing["sector"], existing["group_name"], float(existing["weight"] or 0.0)
        ) != (normalized.name, normalized.sector, normalized.group_name, normalized.weight)
        pc_id = watchlist_sync.local_pc_id(conn)
        stamp = next_stamp() if changed else existing["updated_at"]
        author = pc_id if changed else existing["updated_by"]
        conn.execute(
            """INSERT OR REPLACE INTO watchlist (ticker, name, sector, group_name, weight, updated_at, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (normalized.ticker, normalized.name, normalized.sector, normalized.group_name,
             normalized.weight, stamp, author),
        )
```

  Add `from apps.api.services.watchlist_sync.model import next_stamp` to the imports. After
  `mark_watchlist_state("user_mutation")`, add `watchlist_sync.run_sync("mutation")`. The existing
  `if existing is None: schedule_acquisition(...)` stays.

- `set_watchlist_group`: after the `UPDATE ... SET group_name`, and only if the group actually
  changed, stamp the row. Read the current `group_name` in the existing select and compare:

```python
        if row["group_name"] != group_name:
            conn.execute("UPDATE watchlist SET group_name = ? WHERE ticker = ?", (group_name, normalized_ticker))
            watchlist_sync_store.stamp_row(conn, normalized_ticker, watchlist_sync.local_pc_id(conn))
```

  Add `group_name` to that function's `SELECT` column list, replace the unconditional `UPDATE` with
  the block above, and call `watchlist_sync.run_sync("mutation")` after `mark_watchlist_state`.

- `delete_watchlist_item`: after `DELETE FROM watchlist ...`, add:

```python
        if watchlist_sync.is_enabled():
            # Tombstones only while sync is on (spec §1, Switch).
            watchlist_sync_store.record_removal(conn, normalized_ticker, watchlist_sync.local_pc_id(conn))
```

  Then call `watchlist_sync.run_sync("mutation")` after `mark_watchlist_state`.

- `resync_watchlist`: first line:

```python
    if watchlist_sync.is_enabled():
        # The server guard is authoritative; hiding the button is only convenience (spec §3).
        raise HTTPException(status_code=409, detail="Import is unavailable while watchlist sync is on: "
                            "a bulk replace would be undone by the next merge and would never reach other PCs.")
```

- `sync_watchlist` (Export): call `sync_watchlist_to_json(watchlist_seed.EXPORT_JSON)` and update the
  docstring to `Export the DB-backed watchlist to the personal, git-ignored data/exports/watchlist-export.json.`
- `get_watchlist_sync_metadata`: pass `watchlist_seed.EXPORT_JSON`, so the reported path is the export.
- New route, declared before `@router.delete("/watchlist/{ticker}")`:

```python
@router.get("/watchlist/peer-sync", response_model=APIResponse[WatchlistPeerSyncStatus])
def get_watchlist_peer_sync():
    """Last recorded peer-sync attempt. Read-only: it never triggers a sync (spec §2)."""
    return APIResponse(data=watchlist_sync.current_status())
```

In `apps/api/main.py` `lifespan`, directly after `logger.info("Database ready.")`, add:

```python
    # Best-effort watchlist peer sync (spec §2): run_sync never raises, so an unavailable
    # folder only records last_error and startup continues.
    from apps.api.services.watchlist_sync import service as watchlist_sync

    watchlist_sync.run_sync("startup")
```

- [ ] **Step 4: Run to verify they pass, plus the existing watchlist and portfolio tests**

Run: `python -m pytest tests/api/watchlist_sync tests/api/test_watchlist_merge.py tests/api/test_watchlist_resync.py tests/api/test_watchlist_group.py tests/api/test_watchlist_id.py tests/api/test_portfolio_attribution.py -q -p no:cacheprovider`.
Expected: all pass.

- [ ] **Step 5: Mutation check**

Apply each change on its own, run the named test, confirm it fails, then restore:
1. `get_watchlist`: always call `merge_missing_watchlist_items`. Run `-k does_not_revive_a_seed_ticker`.
   Expected: FAIL.
2. `peer-sync`: call `run_sync("status")` before returning. Run `-k read_only`. Expected: FAIL.
3. `upsert`: always stamp (`changed = True`). Run `-k unchanged_upsert`. Expected: FAIL.
4. `delete`: record the tombstone even when sync is off. Run `-k only_while_sync_is_on`. Expected: FAIL.
5. `resync`: remove the 409 guard. Run `-k import_is_refused`. Expected: FAIL.
6. `sync_watchlist`: pass `_WATCHLIST_JSON`. Run `-k export_writes`. Expected: FAIL.
7. `lifespan`: call a version of `run_sync` that re-raises. Run `-k startup_with_an_unavailable`.
   Expected: FAIL.

- [ ] **Step 6: Commit**

```bash
git add apps/api/routes/portfolio.py apps/api/main.py tests/api/watchlist_sync/test_routes.py
git commit -m "feat(sync): sync on start, on read and after every change; status route; Export retargeted, Import refused while syncing"
```

### Task 7: The Portfolio page

**Files:**
- Create: `apps/web/app/portfolio/components/WatchlistPeerSyncStatus.tsx`
- Modify: `apps/web/app/portfolio/components/StockTileGrid.tsx` (the `grid-count` element, around line 172)
- Modify: `apps/web/app/portfolio/components/PortfolioCommandCenter.tsx` (Export/Import block, around lines 241–281)
- Modify: `apps/web/app/portfolio/page.tsx` (the `syncWatchlistMutation` message around line 1750;
  `<StockTileGrid ...>` and `<PortfolioCommandCenter ...>` props)
- Modify: `apps/web/tests/e2e/helpers/portfolioPageMock.ts` (a `peer-sync` handler; the export
  `json_path`), and `apps/web/tests/e2e/portfolio-watchlist.spec.ts:285` (Export message)
- Test: `apps/web/tests/e2e/watchlist-peer-sync.spec.ts`

**Interfaces:**
- Consumes: `GET /portfolio/watchlist/peer-sync` → `{enabled, pc_id, peers:[{pc_id, written_at}], skipped_files:[{name, reason}], last_sync_at, last_error}`.
- Produces: `data-testid="watchlist-peer-sync"` status text; `PortfolioCommandCenter` prop
  `importUnavailableReason: string | null`; Export message
  `Exported N holdings to data/exports/watchlist-export.json.`

- [ ] **Step 1: Write the failing spec**

`apps/web/tests/e2e/watchlist-peer-sync.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { openPortfolioPanel } from "./helpers/portfolioPanels";

type Status = {
  enabled: boolean; pc_id: string | null;
  peers: Array<{ pc_id: string; written_at: string }>;
  skipped_files: Array<{ name: string; reason: string }>;
  last_sync_at: string | null; last_error: string | null;
};

const OFF: Status = { enabled: false, pc_id: null, peers: [], skipped_files: [], last_sync_at: null, last_error: null };

async function openWith(page: Page, status: Status) {
  await mockPortfolioPageApi(page);
  await page.route("**/api/v1/portfolio/watchlist/peer-sync", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data: status }) }),
  );
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("grid-count")).toBeVisible();
}

const line = (page: Page) => page.getByTestId("watchlist-peer-sync");
const on = (overrides: Partial<Status>): Status => ({ ...OFF, enabled: true, pc_id: "PC-ME-00ff", last_sync_at: "2026-09-18T02:03:00.000Z", ...overrides });

test("sync off shows nothing", async ({ page }) => {
  await openWith(page, OFF);
  await expect(line(page)).toHaveCount(0);
});

test("one peer shows the peer count and its last write time", async ({ page }) => {
  await openWith(page, on({ peers: [{ pc_id: "PC-B-0002", written_at: "2026-09-18T02:02:00.000Z" }] }));
  await expect(line(page)).toContainText("Synced with 1 other PC");
});

test("two peers show the most recent write time", async ({ page }) => {
  await openWith(page, on({ peers: [
    { pc_id: "PC-B-0002", written_at: "2026-09-18T01:00:00.000Z" },
    { pc_id: "PC-C-0003", written_at: "2026-09-18T02:02:00.000Z" },
  ] }));
  await expect(line(page)).toContainText("Synced with 2 other PCs · latest");
});

test("no peers yet says so", async ({ page }) => {
  await openWith(page, on({}));
  await expect(line(page)).toHaveText("Sync on · no other PC has synced yet");
});

test("a skipped peer file is reported", async ({ page }) => {
  await openWith(page, on({ peers: [{ pc_id: "PC-B-0002", written_at: "2026-09-18T02:02:00.000Z" }],
    skipped_files: [{ name: "watchlist.PC-C-0003.json", reason: "unreadable" }] }));
  await expect(line(page)).toContainText("1 file skipped, will retry");
});

test("an unavailable folder says changes are kept on this PC", async ({ page }) => {
  await openWith(page, on({ last_error: "sync folder does not exist" }));
  await expect(line(page)).toHaveText("Sync unavailable · changes are kept on this PC");
});

test("Import is hidden while sync is on, and Export names the personal file", async ({ page }) => {
  await openWith(page, on({}));
  // Export and Import live in the allocation panel (see portfolio-watchlist.spec.ts).
  await openPortfolioPanel(page, "allocation");
  await expect(page.getByRole("button", { name: "Export Watchlist To JSON" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import JSON Into DB" })).toHaveCount(0);
  await expect(page.getByText("Import is unavailable while watchlist sync is on")).toBeVisible();
  await page.getByRole("button", { name: "Export Watchlist To JSON" }).click();
  await expect(page.getByText(/Exported \d+ holdings to data\/exports\/watchlist-export\.json\./)).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/web`, with `PYTHONPATH` set to the worktree root):
`npx playwright test tests/e2e/watchlist-peer-sync.spec.ts --reporter=line`
Expected: FAIL. `watchlist-peer-sync` does not exist and Import is visible.

- [ ] **Step 3: Implement**

`apps/web/app/portfolio/components/WatchlistPeerSyncStatus.tsx`:

```tsx
"use client";

export interface WatchlistPeerSyncStatusData {
  enabled: boolean;
  pc_id: string | null;
  peers: Array<{ pc_id: string; written_at: string }>;
  skipped_files: Array<{ name: string; reason: string }>;
  last_sync_at: string | null;
  last_error: string | null;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** One line beside the holdings count (spec §2). Renders nothing while sync is off. */
export function WatchlistPeerSyncStatus({ status }: { status: WatchlistPeerSyncStatusData | undefined }) {
  if (!status?.enabled) return null;
  let text: string;
  let warn = false;
  if (status.last_error) {
    text = "Sync unavailable · changes are kept on this PC";
    warn = true;
  } else if (status.peers.length === 0) {
    text = "Sync on · no other PC has synced yet";
  } else {
    const latest = status.peers.map((peer) => peer.written_at).sort().at(-1)!;
    const count = status.peers.length;
    text = count === 1 ? `Synced with 1 other PC · ${localTime(latest)}` : `Synced with ${count} other PCs · latest ${localTime(latest)}`;
    if (status.skipped_files.length > 0) {
      const n = status.skipped_files.length;
      text += ` · ${n} file${n === 1 ? "" : "s"} skipped, will retry`;
    }
  }
  return (
    <span
      data-testid="watchlist-peer-sync"
      title={status.last_error ?? (status.skipped_files.map((file) => `${file.name}: ${file.reason}`).join("\n") || undefined)}
      className={`text-xs ${warn ? "text-[var(--state-warning)]" : "text-[var(--text-muted)]"}`}
    >
      {text}
    </span>
  );
}
```

The skipped-peer test expects `1 file skipped, will retry`, and the text above contains it. The spec
table's standalone "Synced · 1 file skipped, will retry" is covered by this combined form; record that
wording in the report.

`StockTileGrid.tsx`: add an optional prop `statusSlot?: ReactNode` to its props interface and
destructuring, and render it right after the `grid-count` element, inside the same header row:

```tsx
        {statusSlot}
```

Import `type ReactNode` from `react` if it is not already imported.

`page.tsx`:
- Add the query next to `syncStatusQuery`:

```tsx
  // Keyed on the watchlist fetch time: the status route is read-only, so it must be read after
  // the watchlist GET (which performs the sync) has completed, not in parallel with it.
  const peerSyncQuery = useQuery<WatchlistPeerSyncStatusData>({
    queryKey: ["portfolio-watchlist-peer-sync", watchlistQuery.dataUpdatedAt],
    queryFn: () => fetchApi<WatchlistPeerSyncStatusData>("/portfolio/watchlist/peer-sync"),
    enabled: watchlistQuery.isSuccess,
    refetchOnWindowFocus: false,
  });
```

  `watchlistQuery` is the existing watchlist query (`page.tsx:1031`, key `["portfolio-watchlist"]`).
- Pass `statusSlot={<WatchlistPeerSyncStatus status={peerSyncQuery.data} />}` to `<StockTileGrid ...>`.
- Pass `importUnavailableReason={peerSyncQuery.data?.enabled ? "Import is unavailable while watchlist sync is on." : null}`
  to `<PortfolioCommandCenter ...>`.
- Change the Export success message to
  ``setMutationMessage(`Exported ${result.item_count} holdings to data/exports/watchlist-export.json.`);``.
- Import `WatchlistPeerSyncStatus` and `type WatchlistPeerSyncStatusData`.

`PortfolioCommandCenter.tsx`:
- Add the prop `importUnavailableReason: string | null` to the interface and destructuring.
- Render the Import button and its arming checkbox label only when `importUnavailableReason` is
  `null`. Otherwise render
  `<p className="text-xs text-[var(--text-muted)]">{importUnavailableReason}</p>` in their place.
- Change the help paragraph to:
  `Export writes the current DB-backed watchlist, including weights, into data/exports/watchlist-export.json (git-ignored, personal). Import replaces the watchlist from the committed starter seed and is intentionally destructive.`
  Keep the words "including weights, into": `portfolio-watchlist.spec.ts:96` matches that phrase.

`portfolioPageMock.ts`:
- Set the initial `syncStatus.json_path` to
  `"C:\\Learn\\Economy\\MoneyView\\data\\exports\\watchlist-export.json"`.
- Add a GET handler for `${API_PREFIX}/portfolio/watchlist/peer-sync` next to the `sync-status`
  handler, returning `{ status: "ok", data: { enabled: false, pc_id: null, peers: [], skipped_files: [], last_sync_at: null, last_error: null } }`.

`portfolio-watchlist.spec.ts:285`: expect
`"Exported 1 holdings to data/exports/watchlist-export.json."`.

- [ ] **Step 4: Run to verify they pass**

Run `npx tsc --noEmit`, then:
`npx playwright test tests/e2e/watchlist-peer-sync.spec.ts tests/e2e/portfolio-watchlist.spec.ts --reporter=line`
Expected: exit 0, then all pass.

- [ ] **Step 5: Mutation check**

Apply each change on its own, run the named test, confirm it fails, then restore:
1. Always show the Import button. Run `-g "Import is hidden"`. Expected: FAIL.
2. Use the oldest peer time (`.sort()[0]`) and drop "latest". Run `-g "two peers"`. Expected: FAIL.
3. Treat `last_error` as OK (skip that branch). Run `-g "unavailable folder"`. Expected: FAIL.
4. Render the line when `enabled` is false. Run `-g "sync off shows nothing"`. Expected: FAIL.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/portfolio apps/web/tests/e2e/watchlist-peer-sync.spec.ts apps/web/tests/e2e/helpers/portfolioPageMock.ts apps/web/tests/e2e/portfolio-watchlist.spec.ts
git status --short   # package-lock.json must not be staged
git commit -m "feat(portfolio): watchlist sync status line; Import hidden while syncing; Export names the personal file"
```

### Task 8: Docs, gates, PR 1

**Files:**
- Modify: `docs/local-run-resources.md` (append a section), `docs/architecture/storage-model.md` (§4.2–§4.4),
  `guideline/sop/todo.md` (before `## Archived`)

- [ ] **Step 1: Setup note**

Append to `docs/local-run-resources.md`:

```markdown
## Watchlist sync between your PCs

1. Pick a folder a cloud client keeps in sync, e.g. `C:\Users\<you>\OneDrive\MoneyView-sync`.
   In OneDrive, set it to "Always keep on this device" (recommended; an online-only file is
   skipped and retried, never read as empty).
2. In `config/.env` (copy `config/.env.example` if you have none), set
   `MONEYVIEW_SYNC_DIR=C:\Users\<you>\OneDrive\MoneyView-sync`.
3. Restart MoneyView. The Portfolio page shows the sync status beside the holdings count.

Each PC writes only `MoneyView\watchlist.<pc_id>.json` in that folder. Your first sync merges
both PCs' lists (a union); deletions made after that propagate. With the variable unset, sync is
off and nothing changes. Design: `docs/superpowers/specs/2026-09-18-watchlist-peer-sync-design.md`.
```

- [ ] **Step 2: Storage model**

In `docs/architecture/storage-model.md`:
- **§4.2 (Bootstrap Source):** add at the end: `With peer sync on, an empty database is filled from
  the peers' merged list when any peer file is readable, and from the seed only when none is; the
  seed file is read-only to MoneyView and holds neutral starter tickers.`
- **§4.4:** replace the "Safe sync: DB to JSON" bullet list with:

  ```markdown
  **Export** (DB → `data/exports/watchlist-export.json`, git-ignored). Never writes the committed seed.

  **Destructive import** (seed → DB). Refused (409) while peer sync is on.

  **Peer sync** (`MONEYVIEW_SYNC_DIR`). One file per PC in a cloud-synced folder, merged per ticker
  by `(updated_at, updated_by)` with tombstones in `watchlist_removed`. See the spec above.
  ```

- [ ] **Step 3: Track the work**

Add to `guideline/sop/todo.md`, before `## Archived`:

```markdown
## Track K - Watchlist peer sync  [2026-09-18]

Spec: `docs/superpowers/specs/2026-09-18-watchlist-peer-sync-design.md`.
Plan: `docs/superpowers/plans/2026-09-18-watchlist-peer-sync.md`.

- [ ] **K-1. Sync feature** (PR 1, open)
- [ ] **K-2. Neutral public seed** (PR 2): merge only after sync is on for both PCs and both
      Watchlists hold every ticker
```

- [ ] **Step 4: Gates**

Run:
- `python -m pytest -q -p no:cacheprovider`
- `npx tsc --noEmit` and ESLint on the changed web files, in `apps/web`
- `npx playwright test --reporter=line` in `apps/web`

Expected: all pass.

- [ ] **Step 5: Commit, push, open PR 1**

```bash
git add docs/local-run-resources.md docs/architecture/storage-model.md guideline/sop/todo.md
git commit -m "docs: watchlist peer sync setup and storage model"
git push -u origin watchlist-peer-sync
```

Open the PR to `renewal`. The body lists:
- the spec decisions;
- the deviations;
- the mutation checks;
- the gates;
- **the owner's rollout steps:** set the folder on both PCs, confirm the contents match, then merge
  PR 2.

End the body with the attribution lines.

---

# PR 2: the neutral public seed

Branch `watchlist-neutral-seed` from `watchlist-peer-sync` (stacked). Retarget it once PR 1 merges.

### Task 9: Replace the committed seed with neutral defaults

**Files:**
- Modify: `apps/api/services/webscrap/stock_targets.json`
- Test: `tests/api/test_watchlist_seed_neutral.py`

- [ ] **Step 1: Write the failing tests**

`tests/api/test_watchlist_seed_neutral.py`:

```python
"""The committed seed is a neutral starter list, and swapping it never touches local rows (spec §3)."""

import json

from apps.api.services import watchlist_seed
from apps.api.services.db import get_db

NEUTRAL = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"]


def test_the_committed_seed_is_exactly_the_neutral_starter_list():
    data = json.loads(watchlist_seed.SEED_JSON.read_text(encoding="utf-8"))
    assert set(data) == {"custom", "total"}
    assert [t["ticker"] for t in data["custom"]["targets"]] == NEUTRAL
    assert data["total"] == {"targets": []}
    assert all(set(t) == {"ticker", "name", "sector", "weight"} and t["weight"] == 0.0 for t in data["custom"]["targets"])


def test_swapping_the_seed_leaves_existing_local_rows_untouched(tmp_path, monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES ('CRCL', 'Circle', 'Crypto', 'custom', 0.3)")
        conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES ('AAPL', 'My Apple', 'Tech', 'total', 0.7)")

    watchlist_seed.ensure_watchlist_bootstrapped(watchlist_seed.SEED_JSON)
    watchlist_seed.merge_missing_watchlist_items(watchlist_seed.SEED_JSON)

    with get_db() as conn:
        rows = {r["ticker"]: (r["name"], r["group_name"], r["weight"]) for r in conn.execute("SELECT * FROM watchlist")}
    assert rows["CRCL"] == ("Circle", "custom", 0.3), "a personal ticker absent from the new seed is never deleted"
    assert rows["AAPL"] == ("My Apple", "total", 0.7), "a curated row is never overwritten by the seed"
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_watchlist_seed_neutral.py -q -p no:cacheprovider`
Expected: the first test FAILS, because the seed still holds the owner's list. The second passes
already; it guards a property that must keep holding.

- [ ] **Step 3: Replace the file**

Write `apps/api/services/webscrap/stock_targets.json` exactly (UTF-8, CRLF):

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

- [ ] **Step 4: Run the tests and the suites that read the seed**

Run: `python -m pytest tests/api/test_watchlist_seed_neutral.py tests/api/test_watchlist_merge.py tests/api/test_watchlist_resync.py tests/api/test_corporate_comparison.py -q -p no:cacheprovider`
Then `python -m pytest -q -p no:cacheprovider`.

If any existing test asserted a ticker from the old personal list (e.g. `CRCL`, `SPCX`), change it to
use a neutral ticker or its own temporary seed file, and list each change in the report. Tests must
not depend on the owner's personal list.

- [ ] **Step 5: Mutation check**

Apply each change on its own, run the named test, confirm it fails, then restore:
1. Add `CRCL` back to the seed. Run `-k exactly_the_neutral`. Expected: FAIL.
2. In `merge_missing_watchlist_items`, use `INSERT OR REPLACE`. Run `-k leaves_existing_local_rows`.
   Expected: FAIL (`('Apple', 'custom', 0.0)`).

- [ ] **Step 6: Commit, push, open PR 2 (not to be merged until the owner confirms)**

```bash
git add apps/api/services/webscrap/stock_targets.json tests/api/test_watchlist_seed_neutral.py
git commit -m "chore(watchlist): replace the public seed with a neutral starter list"
git push -u origin watchlist-neutral-seed
```

Open the PR with base `watchlist-peer-sync`. The body says, first line:
**Merge only after sync is on for both PCs and both Watchlists hold every ticker.**
It also notes that the old list remains in existing git history, and no rewrite is done.

---

## Plan self-review (2026-09-18)

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| §1 identity, schema, `pc_id`, baseline, change keys, authorship | 2, 4 |
| §1 file format, which files count, own file, atomic write, unreadable ≠ empty | 3 |
| §1 merge, first sync, timestamps kept while off, tombstones only while on | 2, 4, 5, 6 |
| §2 triggers, lock, invariant on GET, local-first failure, status route read-only, lifecycle | 5, 6 |
| §2 status line states | 7 |
| §2 configuration (`config/.env`, `override=False`) | 1 |
| §3 seed merge skipped, bootstrap precedence, Export, Import (UI + 409) | 5, 6, 7 |
| §3 neutral seed and swap safety | 9 |
| §3 every listed test | 2–7, 9 |

**Placeholder scan:** none. Names that were first written as "confirm before use" are now checked
against the code:
- `/api/v1/healthz` is at `main.py:200`.
- `watchlistQuery` is at `page.tsx:1031`.
- Export is in the allocation panel (`openPortfolioPanel`).
- `portfolio-watchlist.spec.ts:96` matches the help-text phrase "including weights, into".
- `load_dotenv` returns `False` for a missing file, so no guard is needed.
- `merge_missing_watchlist_items` re-inserts unconditionally, so the route revival test can fail.

**Type consistency:**
- `SyncRow`, `Tombstone`, `SyncState` and `merge_states` are used unchanged in Tasks 3–5.
- `run_sync(trigger, seed_json=None)` is the same in Tasks 5 and 6.
- `WatchlistPeerSyncStatus` fields match the route (6) and the frontend type (7).
- `EXPORT_JSON` and `SEED_JSON` are defined in Task 5 and used in 6 and 9.
