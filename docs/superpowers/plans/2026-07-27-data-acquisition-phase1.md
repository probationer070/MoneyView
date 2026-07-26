# Data Acquisition Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable acquisition machinery — boundary-based freshness, an
`acquisition_state` table, a registry, and a runner — and use it to acquire daily price
bars incrementally instead of re-downloading whole periods on the read path.

**Architecture:** Each data class declares `(scope, boundary, triggers, source, calendar,
store)` in one registry. A shared runner reads that table and holds no per-class logic.
Freshness asks *"have I asked since the last boundary?"* against `acquisition_state`,
never *"do I hold a bar dated ≥ X"* — the latter cannot be satisfied on a market holiday
or for a delisted ticker, which is the existing refetch-storm bug. Phase 1 covers
`equity_bars` and `index_bars`; later phases add rows for statements, macro and news.

**Tech Stack:** Python 3.12, FastAPI, SQLite (`sqlite3`, WAL), pydantic v2, yfinance,
pytest. No new third-party dependencies.

## Global Constraints

- **All boundaries are declared and compared in UTC.** The codebase already stores UTC
  (`datetime.now(UTC)`), so a UTC boundary compares directly against stored values with
  no timezone conversion. Never use naive `date.today()` — that is the existing
  `_previous_trading_day` bug (`market_data.py:442`), which flips at local midnight and
  behaves differently on a KST laptop than in a UTC container.
- **Reads never fetch.** Nothing in this phase may add a provider call to a read path.
  A class that has never been acquired reports `never_acquired`; it does not
  transparently fall back to fetching (design §9, §12.2).
- **Backfill depth is 10 years** (design §12.3).
- **`yfinance`'s `end` parameter is exclusive.** Every range passed to it must add one
  day to the intended last date, or the most recent bar is silently dropped.
- **No test may make a network call.** Provider adapters are tested against injected
  fakes. Concurrent live fetching earned a Yahoo rate limit during sub-project 1 that
  invalidated a day of measurements (`ERROR-LOG.md`).
- New modules live under `apps/api/services/acquisition/`. Existing finance and route
  code is not restructured in this phase.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/api/services/acquisition/__init__.py` | Package marker; re-exports the public surface |
| `apps/api/services/acquisition/boundaries.py` | `Boundary` protocol and `Daily`. Pure: no I/O, no clock reads, takes `now` as an argument |
| `apps/api/services/acquisition/state.py` | `acquisition_state` row access — read, record check, record success |
| `apps/api/services/acquisition/freshness.py` | The *"have I asked since the boundary?"* decision. Pure |
| `apps/api/services/acquisition/ranges.py` | Backfill-versus-delta range planning. Pure |
| `apps/api/services/acquisition/registry.py` | `DataClass`, `Scope`, and the `REGISTRY` declarations |
| `apps/api/services/acquisition/sources/bars.py` | yfinance range-fetch adapter and corporate-action probe |
| `apps/api/services/acquisition/runner.py` | Orchestration: decide, plan, fetch, persist, record |
| `apps/api/services/db.py` | Modified — adds `acquisition_state` to the schema |
| `apps/api/routes/portfolio.py` | Modified — watchlist add/remove enqueue and stop acquisition |

Pure modules (`boundaries`, `freshness`, `ranges`) are separated from I/O
(`state`, `sources`, `runner`) deliberately: it is what lets the date arithmetic —
where the bugs live — be tested exhaustively without a database or a network.

---

### Task 1: Boundary primitive

**Files:**
- Create: `apps/api/services/acquisition/__init__.py`
- Create: `apps/api/services/acquisition/boundaries.py`
- Test: `tests/api/acquisition/test_boundaries.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Daily(at_hour: int, at_minute: int = 0, business_days: bool = False)` with
  `most_recent_instant(now: datetime) -> datetime`. All datetimes are timezone-aware UTC.

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/__init__.py` (empty) and `tests/api/acquisition/test_boundaries.py`:

```python
from datetime import UTC, datetime

from apps.api.services.acquisition.boundaries import Daily


def test_most_recent_instant_is_today_when_now_is_past_the_hour():
    boundary = Daily(at_hour=0)
    now = datetime(2026, 7, 27, 9, 30, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 27, 0, 0, tzinfo=UTC)


def test_most_recent_instant_is_yesterday_when_now_is_before_the_hour():
    boundary = Daily(at_hour=8)
    now = datetime(2026, 7, 27, 3, 0, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 26, 8, 0, tzinfo=UTC)


def test_boundary_instant_itself_counts_as_passed():
    """At exactly the boundary the new window has begun; anything acquired before it
    is stale. An off-by-one here means a whole day of staleness served as fresh."""
    boundary = Daily(at_hour=0)
    now = datetime(2026, 7, 27, 0, 0, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 27, 0, 0, tzinfo=UTC)


def test_business_days_boundary_skips_back_over_the_weekend():
    """2026-07-27 is a Monday; 2026-07-26 Sunday, 2026-07-25 Saturday."""
    boundary = Daily(at_hour=12, business_days=True)
    now = datetime(2026, 7, 27, 6, 0, tzinfo=UTC)  # Monday, before the hour
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 24, 12, 0, tzinfo=UTC)


def test_business_days_boundary_returns_today_when_today_is_a_weekday_past_the_hour():
    boundary = Daily(at_hour=12, business_days=True)
    now = datetime(2026, 7, 27, 18, 0, tzinfo=UTC)  # Monday, after the hour
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 27, 12, 0, tzinfo=UTC)


def test_naive_datetime_is_rejected():
    """A naive datetime is the bug this design exists to remove: `date.today()` flips at
    local midnight and differs between a KST laptop and a UTC container."""
    boundary = Daily(at_hour=0)
    try:
        boundary.most_recent_instant(datetime(2026, 7, 27, 9, 30))
    except ValueError as error:
        assert "timezone-aware" in str(error)
    else:
        raise AssertionError("a naive datetime must be rejected")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_boundaries.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.acquisition'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/services/acquisition/__init__.py` as an empty file.

Create `apps/api/services/acquisition/boundaries.py`:

```python
"""Freshness boundaries.

A boundary is the instant a held copy becomes invalid. It is deliberately not a TTL:
daily data changes once a day, so a 300-second TTL permits 288 refetches per day for
one actual change while still being able to serve data from *before* that change.

Pure by design -- `now` is a parameter, never a clock read -- so the date arithmetic
where the bugs live is exhaustively testable without a database or a network.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol


class Boundary(Protocol):
    def most_recent_instant(self, now: datetime) -> datetime:
        """The latest boundary instant at or before `now`."""


@dataclass(frozen=True)
class Daily:
    """Invalid once the next occurrence of `at_hour:at_minute` UTC passes.

    `business_days=True` steps back over Saturday and Sunday. It deliberately does not
    consult a market-holiday calendar: because freshness asks "have I asked since the
    boundary?" rather than "do I hold a bar dated >= X", a holiday simply means the
    provider returns nothing and we do not ask again until the next boundary. A holiday
    calendar would change which instant we ask *at*, never whether the rule is correct.
    """

    at_hour: int
    at_minute: int = 0
    business_days: bool = False

    def most_recent_instant(self, now: datetime) -> datetime:
        if now.tzinfo is None:
            raise ValueError("Boundary comparisons require a timezone-aware datetime (UTC)")
        candidate = now.replace(
            hour=self.at_hour, minute=self.at_minute, second=0, microsecond=0
        )
        if candidate > now:
            candidate -= timedelta(days=1)
        if self.business_days:
            while candidate.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
                candidate -= timedelta(days=1)
        return candidate
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_boundaries.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/__init__.py apps/api/services/acquisition/boundaries.py tests/api/acquisition/
git commit -m "feat: UTC daily freshness boundary primitive"
```

---

### Task 2: `acquisition_state` table and accessors

**Files:**
- Modify: `apps/api/services/db.py` — append to `_CREATE_SCHEMA_SQL` (the string beginning at line 216)
- Create: `apps/api/services/acquisition/state.py`
- Test: `tests/api/acquisition/test_state.py`

**Interfaces:**
- Consumes: `apps.api.services.db.get_db`.
- Produces:
  - `AcquisitionState(data_class, subject, last_checked_at, last_success_at, covered_from, covered_to, status, detail)` — a frozen dataclass; datetimes are timezone-aware UTC or `None`.
  - `read_state(data_class: str, subject: str) -> AcquisitionState`
  - `record_check(data_class: str, subject: str, *, now: datetime, status: str, detail: str | None = None) -> None`
  - `record_success(data_class: str, subject: str, *, now: datetime, covered_from: date, covered_to: date) -> None`
  - `STATUS_NEVER_ACQUIRED = "never_acquired"`, `STATUS_OK = "ok"`, `STATUS_EMPTY = "empty"`, `STATUS_FAILED = "failed"`

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_state.py`:

```python
from datetime import UTC, date, datetime

from apps.api.services.acquisition.state import (
    STATUS_EMPTY,
    STATUS_NEVER_ACQUIRED,
    STATUS_OK,
    read_state,
    record_check,
    record_success,
)

NOW = datetime(2026, 7, 27, 9, 0, tzinfo=UTC)


def test_unknown_subject_reads_as_never_acquired():
    """`never_acquired` and "acquired, found nothing" must be distinguishable: it is
    what lets a read report an explicit state instead of an empty list the UI cannot
    tell apart from "this stock has no data"."""
    state = read_state("equity_bars", "TEST_UNKNOWN_TICKER")
    assert state.status == STATUS_NEVER_ACQUIRED
    assert state.last_checked_at is None
    assert state.covered_to is None


def test_record_check_marks_the_ask_without_claiming_success():
    record_check("equity_bars", "TEST_CHECK", now=NOW, status=STATUS_EMPTY, detail="no bars")
    state = read_state("equity_bars", "TEST_CHECK")
    assert state.last_checked_at == NOW
    assert state.last_success_at is None
    assert state.status == STATUS_EMPTY
    assert state.detail == "no bars"


def test_record_success_sets_coverage_and_both_timestamps():
    record_success(
        "equity_bars", "TEST_OK", now=NOW,
        covered_from=date(2016, 7, 27), covered_to=date(2026, 7, 24),
    )
    state = read_state("equity_bars", "TEST_OK")
    assert state.status == STATUS_OK
    assert state.last_checked_at == NOW
    assert state.last_success_at == NOW
    assert state.covered_from == date(2016, 7, 27)
    assert state.covered_to == date(2026, 7, 24)


def test_a_later_failed_check_preserves_the_earlier_success():
    """A failed refresh must never blank a working panel: reads keep serving the last
    good rows, and staleness stays derivable from last_success_at."""
    record_success(
        "equity_bars", "TEST_KEEP", now=NOW,
        covered_from=date(2016, 1, 1), covered_to=date(2026, 7, 24),
    )
    later = datetime(2026, 7, 28, 9, 0, tzinfo=UTC)
    record_check("equity_bars", "TEST_KEEP", now=later, status="failed", detail="429")
    state = read_state("equity_bars", "TEST_KEEP")
    assert state.last_checked_at == later
    assert state.last_success_at == NOW
    assert state.covered_to == date(2026, 7, 24)
    assert state.status == "failed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_state.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.acquisition.state'`

- [ ] **Step 3a: Add the table to the schema**

In `apps/api/services/db.py`, inside the `_CREATE_SCHEMA_SQL` string, append this block
before the closing `"""` of that string:

```sql
CREATE TABLE IF NOT EXISTS acquisition_state (
    data_class      TEXT NOT NULL,
    subject         TEXT NOT NULL,
    last_checked_at TEXT,
    last_success_at TEXT,
    covered_from    TEXT,
    covered_to      TEXT,
    status          TEXT NOT NULL DEFAULT 'never_acquired',
    detail          TEXT,
    PRIMARY KEY (data_class, subject)
);
```

`data_class` plus `subject` is the primary key, so an upsert is a single statement and
the freshness question is one indexed lookup rather than six bespoke checks.

- [ ] **Step 3b: Write the accessors**

Create `apps/api/services/acquisition/state.py`:

```python
"""Persistent record of what we have asked for and when.

Freshness asks "have I asked since the boundary?", so this table records our own
actions rather than inferring them from which rows happen to be present. Inference
cannot tell a provider gap from a market holiday; a coverage record can.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime

from apps.api.services.db import get_db

STATUS_NEVER_ACQUIRED = "never_acquired"
STATUS_OK = "ok"
STATUS_EMPTY = "empty"
STATUS_FAILED = "failed"


@dataclass(frozen=True)
class AcquisitionState:
    data_class: str
    subject: str
    last_checked_at: datetime | None = None
    last_success_at: datetime | None = None
    covered_from: date | None = None
    covered_to: date | None = None
    status: str = STATUS_NEVER_ACQUIRED
    detail: str | None = None


def _parse_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    parsed = datetime.fromisoformat(raw)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _parse_date(raw: str | None) -> date | None:
    return date.fromisoformat(raw) if raw else None


def read_state(data_class: str, subject: str) -> AcquisitionState:
    with get_db() as conn:
        row = conn.execute(
            """SELECT last_checked_at, last_success_at, covered_from, covered_to, status, detail
               FROM acquisition_state WHERE data_class = ? AND subject = ?""",
            (data_class, subject),
        ).fetchone()
    if row is None:
        return AcquisitionState(data_class=data_class, subject=subject)
    return AcquisitionState(
        data_class=data_class,
        subject=subject,
        last_checked_at=_parse_datetime(row["last_checked_at"]),
        last_success_at=_parse_datetime(row["last_success_at"]),
        covered_from=_parse_date(row["covered_from"]),
        covered_to=_parse_date(row["covered_to"]),
        status=row["status"],
        detail=row["detail"],
    )


def record_check(
    data_class: str, subject: str, *, now: datetime, status: str, detail: str | None = None
) -> None:
    """Record that we asked. Deliberately leaves last_success_at and coverage alone:
    a failed refresh must not blank data that is still being served."""
    with get_db() as conn:
        conn.execute(
            """INSERT INTO acquisition_state (data_class, subject, last_checked_at, status, detail)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(data_class, subject) DO UPDATE SET
                   last_checked_at = excluded.last_checked_at,
                   status = excluded.status,
                   detail = excluded.detail""",
            (data_class, subject, now.isoformat(), status, detail),
        )


def record_success(
    data_class: str, subject: str, *, now: datetime, covered_from: date, covered_to: date
) -> None:
    with get_db() as conn:
        conn.execute(
            """INSERT INTO acquisition_state
                   (data_class, subject, last_checked_at, last_success_at,
                    covered_from, covered_to, status, detail)
               VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
               ON CONFLICT(data_class, subject) DO UPDATE SET
                   last_checked_at = excluded.last_checked_at,
                   last_success_at = excluded.last_success_at,
                   covered_from = MIN(COALESCE(acquisition_state.covered_from, excluded.covered_from),
                                      excluded.covered_from),
                   covered_to = MAX(COALESCE(acquisition_state.covered_to, excluded.covered_to),
                                    excluded.covered_to),
                   status = excluded.status,
                   detail = NULL""",
            (
                data_class, subject, now.isoformat(), now.isoformat(),
                covered_from.isoformat(), covered_to.isoformat(), STATUS_OK,
            ),
        )
```

`covered_from`/`covered_to` widen rather than overwrite, so a later delta cannot shrink
the recorded history a backfill established.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_state.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/db.py apps/api/services/acquisition/state.py tests/api/acquisition/test_state.py
git commit -m "feat: acquisition_state table and accessors"
```

---

### Task 3: The freshness decision

**Files:**
- Create: `apps/api/services/acquisition/freshness.py`
- Test: `tests/api/acquisition/test_freshness.py`

**Interfaces:**
- Consumes: `Daily` from Task 1, `AcquisitionState` from Task 2.
- Produces: `needs_acquisition(state: AcquisitionState, boundary: Boundary, now: datetime) -> bool`

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_freshness.py`:

```python
from datetime import UTC, datetime

from apps.api.services.acquisition.boundaries import Daily
from apps.api.services.acquisition.freshness import needs_acquisition
from apps.api.services.acquisition.state import STATUS_EMPTY, STATUS_OK, AcquisitionState

BOUNDARY = Daily(at_hour=0)
NOW = datetime(2026, 7, 27, 9, 0, tzinfo=UTC)  # boundary today was 00:00


def _state(**overrides) -> AcquisitionState:
    base = dict(data_class="equity_bars", subject="AAPL")
    return AcquisitionState(**{**base, **overrides})


def test_never_acquired_needs_acquisition():
    assert needs_acquisition(_state(), BOUNDARY, NOW) is True


def test_asked_after_the_boundary_does_not_need_acquisition():
    asked = datetime(2026, 7, 27, 1, 0, tzinfo=UTC)
    assert needs_acquisition(_state(last_checked_at=asked, status=STATUS_OK), BOUNDARY, NOW) is False


def test_asked_before_the_boundary_needs_acquisition():
    asked = datetime(2026, 7, 26, 23, 0, tzinfo=UTC)
    assert needs_acquisition(_state(last_checked_at=asked, status=STATUS_OK), BOUNDARY, NOW) is True


def test_asked_and_found_nothing_still_counts_as_asked():
    """The rule that removes the refetch storm. On a market holiday, or for a delisted
    ticker, the provider returns nothing forever. Asking "do I hold a bar dated >= X"
    can never be satisfied and retries every request, all day. Asking "did I ask" is
    satisfied immediately and waits for the next boundary."""
    asked = datetime(2026, 7, 27, 1, 0, tzinfo=UTC)
    state = _state(last_checked_at=asked, last_success_at=None, status=STATUS_EMPTY)
    assert needs_acquisition(state, BOUNDARY, NOW) is False


def test_asked_exactly_at_the_boundary_counts_as_asked():
    asked = datetime(2026, 7, 27, 0, 0, tzinfo=UTC)
    assert needs_acquisition(_state(last_checked_at=asked, status=STATUS_OK), BOUNDARY, NOW) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_freshness.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.acquisition.freshness'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/services/acquisition/freshness.py`:

```python
"""The freshness question.

The rule is "have I asked since the last boundary?", never "do I hold a bar dated
>= X". The latter cannot be satisfied on a market holiday, because no bar exists for
one, so it triggers a refetch on every request all day, roughly ten days a year. It
also retries delisted tickers forever. This rule tracks our own action instead of the
market's output, so neither can defeat it.
"""
from __future__ import annotations

from datetime import datetime

from apps.api.services.acquisition.boundaries import Boundary
from apps.api.services.acquisition.state import AcquisitionState


def needs_acquisition(state: AcquisitionState, boundary: Boundary, now: datetime) -> bool:
    if state.last_checked_at is None:
        return True
    return state.last_checked_at < boundary.most_recent_instant(now)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_freshness.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/freshness.py tests/api/acquisition/test_freshness.py
git commit -m "feat: boundary-based freshness rule"
```

---

### Task 4: Range planning — backfill versus delta

**Files:**
- Create: `apps/api/services/acquisition/ranges.py`
- Test: `tests/api/acquisition/test_ranges.py`

**Interfaces:**
- Consumes: `AcquisitionState` from Task 2.
- Produces:
  - `FetchRange(start: date, end_exclusive: date, reason: str)` — frozen dataclass
  - `plan_range(state: AcquisitionState, *, today: date, backfill_years: int = 10, full_refetch: bool = False) -> FetchRange | None`
  - `BACKFILL_YEARS = 10`

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_ranges.py`:

```python
from datetime import date

from apps.api.services.acquisition.ranges import plan_range
from apps.api.services.acquisition.state import AcquisitionState

TODAY = date(2026, 7, 27)


def _state(**overrides) -> AcquisitionState:
    base = dict(data_class="equity_bars", subject="AAPL")
    return AcquisitionState(**{**base, **overrides})


def test_no_coverage_plans_a_ten_year_backfill():
    plan = plan_range(_state(), today=TODAY)
    assert plan is not None
    assert plan.start == date(2016, 7, 27)
    assert plan.reason == "backfill"


def test_existing_coverage_plans_a_delta_from_the_day_after_covered_to():
    plan = plan_range(_state(covered_to=date(2026, 7, 24)), today=TODAY)
    assert plan is not None
    assert plan.start == date(2026, 7, 25)
    assert plan.reason == "delta"


def test_end_is_exclusive_and_one_day_past_today():
    """yfinance treats `end` as exclusive. Passing today would silently drop today's
    bar; every range must add a day."""
    plan = plan_range(_state(covered_to=date(2026, 7, 24)), today=TODAY)
    assert plan is not None
    assert plan.end_exclusive == date(2026, 7, 28)


def test_coverage_already_current_plans_nothing():
    assert plan_range(_state(covered_to=TODAY), today=TODAY) is None


def test_full_refetch_overrides_existing_coverage():
    """A split or dividend rewrites adjusted history retroactively, so the whole series
    must be refetched rather than appended to."""
    plan = plan_range(_state(covered_to=date(2026, 7, 24)), today=TODAY, full_refetch=True)
    assert plan is not None
    assert plan.start == date(2016, 7, 27)
    assert plan.reason == "corporate_action"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_ranges.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.acquisition.ranges'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/services/acquisition/ranges.py`:

```python
"""Which date range to fetch.

Replaces `history(period=...)`, which has no delta capability: the existing
`_rows_cover_period` computes that coverage is short and then discards that information
and refetches the whole period. A steady-state update transfers one row where a full
refetch transfers ~2,520.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from apps.api.services.acquisition.state import AcquisitionState

BACKFILL_YEARS = 10


@dataclass(frozen=True)
class FetchRange:
    start: date
    end_exclusive: date
    reason: str


def _backfill_start(today: date, backfill_years: int) -> date:
    try:
        return today.replace(year=today.year - backfill_years)
    except ValueError:  # 29 February
        return today.replace(year=today.year - backfill_years, day=28)


def plan_range(
    state: AcquisitionState,
    *,
    today: date,
    backfill_years: int = BACKFILL_YEARS,
    full_refetch: bool = False,
) -> FetchRange | None:
    # `end` is exclusive in yfinance: passing `today` drops today's bar silently.
    end_exclusive = today + timedelta(days=1)

    if full_refetch:
        return FetchRange(_backfill_start(today, backfill_years), end_exclusive, "corporate_action")
    if state.covered_to is None:
        return FetchRange(_backfill_start(today, backfill_years), end_exclusive, "backfill")
    if state.covered_to >= today:
        return None
    return FetchRange(state.covered_to + timedelta(days=1), end_exclusive, "delta")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_ranges.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/ranges.py tests/api/acquisition/test_ranges.py
git commit -m "feat: backfill and delta range planning"
```

---

### Task 5: yfinance range-fetch adapter and corporate-action probe

**Files:**
- Create: `apps/api/services/acquisition/sources/__init__.py`
- Create: `apps/api/services/acquisition/sources/bars.py`
- Test: `tests/api/acquisition/test_bars_source.py`

**Interfaces:**
- Consumes: `FetchRange` from Task 4; `StockOHLCV` from `apps.api.models.schemas`.
- Produces:
  - `fetch_bars(ticker: str, fetch_range: FetchRange, *, ticker_factory=None) -> list[StockOHLCV]`
  - `latest_action_date(ticker: str, *, ticker_factory=None) -> date | None`
  - `ticker_factory` defaults to `yfinance.Ticker` and exists so tests inject a fake. No test may hit the network.

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_bars_source.py`:

```python
from datetime import date

import pandas as pd

from apps.api.services.acquisition.ranges import FetchRange
from apps.api.services.acquisition.sources.bars import fetch_bars, latest_action_date


class _FakeTicker:
    def __init__(self, symbol: str, frame: pd.DataFrame | None = None, actions: pd.DataFrame | None = None):
        self.symbol = symbol
        self._frame = frame if frame is not None else pd.DataFrame()
        self._actions = actions if actions is not None else pd.DataFrame()
        self.history_calls: list[dict] = []

    def history(self, **kwargs):
        self.history_calls.append(kwargs)
        return self._frame

    @property
    def actions(self):
        return self._actions


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Date": [pd.Timestamp("2026-07-24"), pd.Timestamp("2026-07-25")],
            "Open": [1.0, 2.0], "High": [1.5, 2.5], "Low": [0.5, 1.5],
            "Close": [1.2, 2.2], "Volume": [100, 200],
        }
    )


def test_fetch_bars_passes_start_and_end_not_period():
    """The whole point of this phase: a bounded range instead of a whole period."""
    fake = _FakeTicker("AAPL", _frame())
    rows = fetch_bars(
        "AAPL",
        FetchRange(date(2026, 7, 24), date(2026, 7, 26), "delta"),
        ticker_factory=lambda symbol: fake,
    )
    assert fake.history_calls == [{"start": "2026-07-24", "end": "2026-07-26", "auto_adjust": True}]
    assert [row.date for row in rows] == ["2026-07-24", "2026-07-25"]
    assert rows[0].close == 1.2


def test_empty_frame_returns_no_rows_without_raising():
    """A holiday, a delisting, or a gap all produce an empty frame. That is `empty`,
    not a failure, and must not raise."""
    fake = _FakeTicker("DEAD", pd.DataFrame())
    assert fetch_bars("DEAD", FetchRange(date(2026, 7, 24), date(2026, 7, 26), "delta"),
                      ticker_factory=lambda symbol: fake) == []


def test_latest_action_date_reads_the_most_recent_split_or_dividend():
    actions = pd.DataFrame(
        {"Dividends": [0.0, 0.24], "Stock Splits": [4.0, 0.0]},
        index=[pd.Timestamp("2020-08-31"), pd.Timestamp("2026-05-15")],
    )
    fake = _FakeTicker("AAPL", actions=actions)
    assert latest_action_date("AAPL", ticker_factory=lambda symbol: fake) == date(2026, 5, 15)


def test_latest_action_date_is_none_when_there_are_no_actions():
    fake = _FakeTicker("AAPL", actions=pd.DataFrame())
    assert latest_action_date("AAPL", ticker_factory=lambda symbol: fake) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_bars_source.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.acquisition.sources'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/services/acquisition/sources/__init__.py` as an empty file.

Create `apps/api/services/acquisition/sources/bars.py`:

```python
"""Daily bar acquisition from yfinance, by explicit date range.

`ticker_factory` is injected so tests never make a network call. Concurrent live
fetching earned a Yahoo rate limit during sub-project 1 that invalidated a day of
measurements, so this is a hard rule, not a convenience.
"""
from __future__ import annotations

from datetime import date
from typing import Callable

from apps.api.core.logger import setup_logger
from apps.api.models.schemas import StockOHLCV
from apps.api.services.acquisition.ranges import FetchRange

logger = setup_logger(__name__)


def _default_ticker_factory(symbol: str):
    import yfinance as yf

    return yf.Ticker(symbol)


def fetch_bars(
    ticker: str,
    fetch_range: FetchRange,
    *,
    ticker_factory: Callable[[str], object] | None = None,
) -> list[StockOHLCV]:
    factory = ticker_factory or _default_ticker_factory
    frame = factory(ticker).history(
        start=fetch_range.start.isoformat(),
        end=fetch_range.end_exclusive.isoformat(),
        auto_adjust=True,
    )
    if frame is None or frame.empty:
        return []
    if "Date" not in frame.columns:
        frame = frame.reset_index()
    rows: list[StockOHLCV] = []
    for record in frame.to_dict("records"):
        raw_date = record.get("Date")
        rows.append(
            StockOHLCV(
                date=str(raw_date)[:10],
                open=float(record.get("Open") or 0),
                high=float(record.get("High") or 0),
                low=float(record.get("Low") or 0),
                close=float(record.get("Close") or 0),
                volume=int(record.get("Volume") or 0),
            )
        )
    return rows


def latest_action_date(
    ticker: str, *, ticker_factory: Callable[[str], object] | None = None
) -> date | None:
    """Most recent split or dividend, or None.

    yfinance returns auto-adjusted prices, and every split and dividend rewrites the
    adjustment factor retroactively. Appending deltas onto an adjusted series therefore
    mixes pre- and post-adjustment prices and silently corrupts returns, volatility and
    every DCF input built on them. It degrades gradually and looks like data, not like
    an error -- which is why it is detected explicitly rather than hoped about.
    """
    factory = ticker_factory or _default_ticker_factory
    actions = factory(ticker).actions
    if actions is None or actions.empty:
        return None
    return max(entry.date() for entry in actions.index.to_pydatetime())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_bars_source.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/sources/ tests/api/acquisition/test_bars_source.py
git commit -m "feat: range-based bar fetch and corporate action probe"
```

---

### Task 6: Registry declarations

**Files:**
- Create: `apps/api/services/acquisition/registry.py`
- Test: `tests/api/acquisition/test_registry.py`

**Interfaces:**
- Consumes: `Daily` from Task 1.
- Produces:
  - `Scope` — `str` enum with `PER_TICKER = "per_ticker"`, `GLOBAL = "global"`
  - `DataClass(name, scope, boundary, store, calendar, depends_on=())` — frozen dataclass
  - `REGISTRY: dict[str, DataClass]` containing `equity_bars` and `index_bars`
  - `get_data_class(name: str) -> DataClass`

**Note:** `index_bars` is declared here but has no trigger until the scheduled warmer
arrives in a later phase — Phase 1's only trigger is the per-ticker watchlist event.
Declaring it now is what proves the registry handles `GLOBAL` scope and a second store
without the runner gaining a branch. Indices keep being served by the existing
`market_data` read path in the meantime.

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_registry.py`:

```python
from datetime import UTC, datetime

from apps.api.services.acquisition.registry import REGISTRY, Scope, get_data_class


def test_phase_one_declares_equity_and_index_bars():
    assert set(REGISTRY) == {"equity_bars", "index_bars"}


def test_equity_bars_is_per_ticker_and_stores_to_stocks():
    declared = get_data_class("equity_bars")
    assert declared.scope is Scope.PER_TICKER
    assert declared.store == "stocks"


def test_index_bars_stores_to_indices():
    assert get_data_class("index_bars").store == "indices"


def test_both_bar_classes_use_the_midnight_utc_boundary():
    """Design decision: all boundaries declared and compared in UTC. 00:00 UTC sits
    3-4 hours after the US close in both DST halves."""
    now = datetime(2026, 7, 27, 9, 0, tzinfo=UTC)
    for name in ("equity_bars", "index_bars"):
        instant = get_data_class(name).boundary.most_recent_instant(now)
        assert instant == datetime(2026, 7, 27, 0, 0, tzinfo=UTC)


def test_unknown_data_class_raises_with_a_useful_message():
    try:
        get_data_class("statements")
    except KeyError as error:
        assert "statements" in str(error)
    else:
        raise AssertionError("an unknown data class must raise")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_registry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.acquisition.registry'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/services/acquisition/registry.py`:

```python
"""One declaration per data class; the runner reads this table and holds no per-class
logic. Adding a macro series or another index is a row, not a pipeline.

Phase 1 declares only the two bar classes. Statements, macro rates, news and the
derived valuation ratios arrive in later phases as further rows.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from apps.api.services.acquisition.boundaries import Boundary, Daily


class Scope(str, Enum):
    PER_TICKER = "per_ticker"
    GLOBAL = "global"


@dataclass(frozen=True)
class DataClass:
    name: str
    scope: Scope
    boundary: Boundary
    store: str
    calendar: str
    depends_on: tuple[str, ...] = field(default_factory=tuple)


# 00:00 UTC sits 3-4 hours after the US close (21:00 UTC in winter, 20:00 in summer),
# so the previous session's bars are settled and published by then in both DST halves.
_DAILY_UTC = Daily(at_hour=0)

REGISTRY: dict[str, DataClass] = {
    "equity_bars": DataClass(
        name="equity_bars",
        scope=Scope.PER_TICKER,
        boundary=_DAILY_UTC,
        store="stocks",
        calendar="us_equity",
    ),
    # Index subjects span calendars -- ^GSPC is us_equity, ^KS200 krx, CL=F cme_energy,
    # BTC-USD continuous -- so `calendar` here is the default and is resolved per subject
    # when a later phase needs session-accurate handling.
    "index_bars": DataClass(
        name="index_bars",
        scope=Scope.GLOBAL,
        boundary=_DAILY_UTC,
        store="indices",
        calendar="per_subject",
    ),
}


def get_data_class(name: str) -> DataClass:
    if name not in REGISTRY:
        raise KeyError(f"unknown data class: {name!r}; declared: {sorted(REGISTRY)}")
    return REGISTRY[name]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_registry.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/registry.py tests/api/acquisition/test_registry.py
git commit -m "feat: data class registry with equity and index bars"
```

---

### Task 7: The acquisition runner

**Files:**
- Create: `apps/api/services/acquisition/runner.py`
- Test: `tests/api/acquisition/test_runner.py`

**Interfaces:**
- Consumes: everything from Tasks 1–6, plus `MarketDataService._save_ohlcv_rows` from `apps.api.services.market_data`.
- Produces:
  - `AcquisitionResult(data_class, subject, fetched_rows, reason, skipped)` — frozen dataclass
  - `acquire(data_class_name: str, subject: str, *, now: datetime, fetcher=fetch_bars, action_probe=latest_action_date, saver=None) -> AcquisitionResult`

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_runner.py`:

```python
from datetime import UTC, date, datetime

from apps.api.models.schemas import StockOHLCV
from apps.api.services.acquisition.ranges import FetchRange
from apps.api.services.acquisition.runner import acquire
from apps.api.services.acquisition.state import read_state, record_success

NOW = datetime(2026, 7, 27, 9, 0, tzinfo=UTC)


def _row(day: str) -> StockOHLCV:
    return StockOHLCV(date=day, open=1.0, high=1.0, low=1.0, close=1.0, volume=1)


def test_first_acquisition_backfills_and_records_coverage():
    calls: list[FetchRange] = []
    saved: list[tuple[str, list[StockOHLCV]]] = []

    def fetcher(ticker, fetch_range, **_):
        calls.append(fetch_range)
        return [_row("2026-07-24")]

    result = acquire(
        "equity_bars", "TEST_RUNNER_NEW", now=NOW,
        fetcher=fetcher, action_probe=lambda ticker, **_: None,
        saver=lambda ticker, rows: saved.append((ticker, rows)),
    )

    assert result.skipped is False
    assert result.reason == "backfill"
    assert calls[0].start == date(2016, 7, 27)
    assert saved == [("TEST_RUNNER_NEW", [_row("2026-07-24")])]
    assert read_state("equity_bars", "TEST_RUNNER_NEW").covered_to == date(2026, 7, 27)


def test_second_call_within_the_same_boundary_window_is_skipped():
    """Reads never fetch and the runner does not re-ask inside one window: this is what
    turns 966 round trips per request into one per boundary."""
    def fetcher(ticker, fetch_range, **_):
        return [_row("2026-07-24")]

    for _ in range(2):
        result = acquire(
            "equity_bars", "TEST_RUNNER_TWICE", now=NOW,
            fetcher=fetcher, action_probe=lambda ticker, **_: None, saver=lambda t, r: None,
        )
    assert result.skipped is True
    assert result.fetched_rows == 0


def test_a_new_corporate_action_forces_a_full_refetch_not_an_append():
    """A split rewrites adjusted history retroactively, so appending would mix pre- and
    post-split prices into one series and silently corrupt every derived metric."""
    record_success(
        "equity_bars", "TEST_RUNNER_SPLIT", now=datetime(2026, 7, 26, 9, 0, tzinfo=UTC),
        covered_from=date(2016, 1, 1), covered_to=date(2026, 7, 24),
    )
    calls: list[FetchRange] = []

    def fetcher(ticker, fetch_range, **_):
        calls.append(fetch_range)
        return [_row("2026-07-24")]

    result = acquire(
        "equity_bars", "TEST_RUNNER_SPLIT", now=NOW,
        fetcher=fetcher, action_probe=lambda ticker, **_: date(2026, 7, 25),
        saver=lambda t, r: None,
    )
    assert result.reason == "corporate_action"
    assert calls[0].start == date(2016, 7, 27)


def test_an_empty_result_records_the_ask_so_it_is_not_retried_all_day():
    """A delisted ticker returns nothing forever. It must be asked once per boundary,
    not once per request."""
    result = acquire(
        "equity_bars", "TEST_RUNNER_EMPTY", now=NOW,
        fetcher=lambda ticker, fetch_range, **_: [],
        action_probe=lambda ticker, **_: None, saver=lambda t, r: None,
    )
    assert result.fetched_rows == 0
    state = read_state("equity_bars", "TEST_RUNNER_EMPTY")
    assert state.status == "empty"
    assert state.last_checked_at == NOW
    assert state.last_success_at is None


def test_a_provider_failure_records_the_ask_and_preserves_prior_success():
    record_success(
        "equity_bars", "TEST_RUNNER_FAIL", now=datetime(2026, 7, 26, 9, 0, tzinfo=UTC),
        covered_from=date(2016, 1, 1), covered_to=date(2026, 7, 24),
    )

    def failing(ticker, fetch_range, **_):
        raise RuntimeError("429 Too Many Requests")

    result = acquire(
        "equity_bars", "TEST_RUNNER_FAIL", now=NOW,
        fetcher=failing, action_probe=lambda ticker, **_: None, saver=lambda t, r: None,
    )
    assert result.fetched_rows == 0
    state = read_state("equity_bars", "TEST_RUNNER_FAIL")
    assert state.status == "failed"
    assert state.covered_to == date(2026, 7, 24)  # prior data still served
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_runner.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.acquisition.runner'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/services/acquisition/runner.py`:

```python
"""Acquisition orchestration.

Reads the registry, asks the freshness question, plans a range, fetches, persists, and
records what happened. Holds no per-class logic: adding a data class is a registry row.

No acquisition failure ever propagates into a request. Precedent: the telemetry sink's
failure policy in perf spec 03.8.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from apps.api.core.logger import setup_logger
from apps.api.services.acquisition.freshness import needs_acquisition
from apps.api.services.acquisition.ranges import plan_range
from apps.api.services.acquisition.registry import get_data_class
from apps.api.services.acquisition.sources.bars import fetch_bars, latest_action_date
from apps.api.services.acquisition.state import (
    STATUS_EMPTY,
    STATUS_FAILED,
    read_state,
    record_check,
    record_success,
)

logger = setup_logger(__name__)


@dataclass(frozen=True)
class AcquisitionResult:
    data_class: str
    subject: str
    fetched_rows: int
    reason: str
    skipped: bool


def _default_saver(ticker: str, rows) -> None:
    from apps.api.services.market_data import MarketDataService

    MarketDataService()._save_ohlcv_rows(ticker, rows)


def acquire(
    data_class_name: str,
    subject: str,
    *,
    now: datetime,
    fetcher=fetch_bars,
    action_probe=latest_action_date,
    saver=None,
) -> AcquisitionResult:
    declared = get_data_class(data_class_name)
    state = read_state(data_class_name, subject)

    if not needs_acquisition(state, declared.boundary, now):
        return AcquisitionResult(data_class_name, subject, 0, "fresh", skipped=True)

    today = now.date()

    # A split or dividend rewrites adjusted history retroactively, so a delta append
    # would mix pre- and post-adjustment prices. Detect it and refetch the whole series.
    full_refetch = False
    try:
        action_date = action_probe(subject)
    except Exception as error:  # noqa: BLE001 - a probe failure must not block acquisition
        logger.warning("acquisition.action_probe_failed subject=%s error=%s", subject, error)
        action_date = None
    if action_date is not None and state.covered_to is not None and action_date > state.covered_to:
        full_refetch = True

    fetch_range = plan_range(state, today=today, full_refetch=full_refetch)
    if fetch_range is None:
        record_check(data_class_name, subject, now=now, status=state.status or STATUS_EMPTY)
        return AcquisitionResult(data_class_name, subject, 0, "current", skipped=True)

    try:
        rows = fetcher(subject, fetch_range)
    except Exception as error:  # noqa: BLE001 - never propagate into a caller
        logger.warning("acquisition.fetch_failed subject=%s error=%s", subject, error)
        record_check(data_class_name, subject, now=now, status=STATUS_FAILED, detail=str(error))
        return AcquisitionResult(data_class_name, subject, 0, fetch_range.reason, skipped=False)

    if not rows:
        # Asked and found nothing: a holiday, a gap, or a delisting. Recording the ask
        # is what stops it being retried on every request for the rest of the day.
        record_check(data_class_name, subject, now=now, status=STATUS_EMPTY)
        return AcquisitionResult(data_class_name, subject, 0, fetch_range.reason, skipped=False)

    (saver or _default_saver)(subject, rows)
    record_success(
        data_class_name, subject, now=now,
        covered_from=fetch_range.start, covered_to=today,
    )
    return AcquisitionResult(data_class_name, subject, len(rows), fetch_range.reason, skipped=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_runner.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/runner.py tests/api/acquisition/test_runner.py
git commit -m "feat: acquisition runner with backfill, delta and corporate action handling"
```

---

### Task 8: Wire the watchlist triggers

**Files:**
- Modify: `apps/api/routes/portfolio.py` — `upsert_watchlist_item` (line 145) and `delete_watchlist_item` (line 192)
- Test: `tests/api/acquisition/test_triggers.py`

**Interfaces:**
- Consumes: `acquire` from Task 7, `read_state`/`record_check` from Task 2.
- Produces: no new public function. `POST /portfolio/watchlist` schedules a backfill for
  the added ticker; `DELETE /portfolio/watchlist/{ticker}` records that it is no longer
  refreshed.

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_triggers.py`:

```python
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.acquisition.state import read_state

TICKER = "TESTTRIG"


def test_adding_a_watchlist_item_schedules_acquisition(monkeypatch):
    """Today POST /watchlist writes one row and returns, acquiring nothing -- so the
    natural acquisition event triggers no acquisition and every fetch instead happens
    in-band while a user waits."""
    scheduled: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "apps.api.routes.portfolio.schedule_acquisition",
        lambda data_class, subject: scheduled.append((data_class, subject)),
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/portfolio/watchlist",
            json={"ticker": TICKER, "name": "Trigger Test", "sector": "Tech",
                  "group_name": "custom", "weight": 1.0},
        )
    assert response.status_code == 200
    assert ("equity_bars", TICKER) in scheduled


def test_adding_a_watchlist_item_does_not_block_on_acquisition(monkeypatch):
    """The route must enqueue and return. Acquisition on the request path is the
    inversion this design exists to remove."""
    def _explode(data_class, subject):
        raise RuntimeError("acquisition must not run inline")

    monkeypatch.setattr("apps.api.routes.portfolio.schedule_acquisition", _explode)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/portfolio/watchlist",
            json={"ticker": TICKER, "name": "Trigger Test", "sector": "Tech",
                  "group_name": "custom", "weight": 1.0},
        )
    assert response.status_code == 200


def test_removing_a_watchlist_item_marks_it_no_longer_refreshed():
    with TestClient(app) as client:
        client.post(
            "/api/v1/portfolio/watchlist",
            json={"ticker": TICKER, "name": "Trigger Test", "sector": "Tech",
                  "group_name": "custom", "weight": 1.0},
        )
        response = client.delete(f"/api/v1/portfolio/watchlist/{TICKER}")
    assert response.status_code == 200
    assert read_state("equity_bars", TICKER).status == "retired"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_triggers.py -v`
Expected: FAIL with `AttributeError: <module 'apps.api.routes.portfolio'> has no attribute 'schedule_acquisition'`

- [ ] **Step 3a: Add the scheduling helper**

Append to `apps/api/services/acquisition/runner.py`:

```python
STATUS_RETIRED = "retired"


def schedule_acquisition(data_class: str, subject: str) -> None:
    """Enqueue acquisition without blocking the caller.

    Phase 1 runs it on a daemon thread. That is sufficient for a local-first
    single-process app and keeps the write path non-blocking; a scheduled warmer for the
    whole registry arrives with the later phases.
    """
    import threading
    from datetime import UTC, datetime

    def _run() -> None:
        try:
            acquire(data_class, subject, now=datetime.now(UTC))
        except Exception as error:  # noqa: BLE001 - a background failure must stay contained
            logger.warning("acquisition.scheduled_failed subject=%s error=%s", subject, error)

    threading.Thread(target=_run, name=f"acquire-{subject}", daemon=True).start()


def retire_subject(data_class: str, subject: str) -> None:
    """Stop refreshing a subject. Rows are retained: storage is cheap and re-adding the
    ticker is then free."""
    from datetime import UTC, datetime

    record_check(data_class, subject, now=datetime.now(UTC), status=STATUS_RETIRED)
```

- [ ] **Step 3b: Wire the routes**

In `apps/api/routes/portfolio.py`, add to the imports at the top of the file:

```python
from apps.api.services.acquisition.runner import retire_subject, schedule_acquisition
```

In `upsert_watchlist_item`, replace the line `mark_watchlist_state("user_mutation")` with:

```python
    mark_watchlist_state("user_mutation")
    # Adding a stock is the natural moment to acquire its history: one 10-year backfill,
    # once, off the request path. Without this the next comparison discovers the ticker
    # and pays a live fetch in-band while a user waits.
    schedule_acquisition("equity_bars", normalized.ticker)
```

In `delete_watchlist_item`, replace the line `mark_watchlist_state("user_mutation")` with:

```python
    mark_watchlist_state("user_mutation")
    retire_subject("equity_bars", normalized_ticker)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_triggers.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest tests/api -q`
Expected: the six pre-existing failures documented in `guideline/sop/todo.md` and no
others. If a new failure appears, it belongs to this change.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/acquisition/runner.py apps/api/routes/portfolio.py tests/api/acquisition/test_triggers.py
git commit -m "feat: watchlist add and remove drive acquisition"
```

---

## Phase 1 completion checklist

- [ ] `python -m pytest tests/api/acquisition -v` — all tasks' tests pass
- [ ] `python -m pytest tests/api -q` — only the six pre-existing failures
- [ ] Adding a watchlist ticker performs one 10-year backfill, off the request path
- [ ] A second acquisition inside the same boundary window is skipped
- [ ] A market holiday or delisted ticker is asked once per boundary, not per request
- [ ] A new split triggers a full refetch rather than a delta append
- [ ] No read path gained a provider call

## Deliberately not in Phase 1

- **Statements, macro rates, news, valuation ratios.** Later phases, each a registry row
  plus a source adapter.
- **A scheduled warmer, and therefore any acquisition of `index_bars`.** Phase 1
  acquires only on the watchlist trigger, which is per-ticker, so `index_bars` is
  **declared but never acquired in this phase**. That is intentional rather than an
  oversight: declaring it now is what proves the registry handles `GLOBAL` scope and a
  second store without the runner gaining a branch, and it costs one row. Index bars
  start flowing when the daily sweep lands. Indices continue to be served by the
  existing `market_data` read path throughout, so nothing regresses in the meantime.
- **Replacing the read path.** `market_data.get_stock_ohlcv` still serves reads exactly
  as it does today. Phase 1 changes how data *arrives*, not how it is read; switching
  reads to state-aware `never_acquired` responses is a separate, UI-visible change.
- **Market-holiday calendars.** The "have I asked" rule makes them unnecessary for
  correctness (see `boundaries.Daily`), so they would be cost without benefit here.
