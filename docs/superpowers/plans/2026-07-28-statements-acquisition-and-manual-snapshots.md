# Statements Acquisition and Manual-Only Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move financial statements and market cap into the acquisition layer so corporate comparison computes entirely from local data, and make snapshot creation exclusively user-initiated.

**Architecture:** Statements and quote facts become acquisition data classes with their own freshness boundaries and normalised SQLite stores. `get_yahoo_statement_bundle` reads those stores instead of Yahoo, which removes the network from metric computation. The daily snapshot cycle and the read-path snapshot fallback are deleted; `POST /comparison/snapshot` becomes the only way a snapshot comes into existence.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, pandas, yfinance, pytest.

**Spec:** `docs/superpowers/specs/2026-07-28-statements-acquisition-and-manual-snapshots-design.md`

## Global Constraints

- **Architectural invariant:** "Metric computation never performs acquisition. All network access is confined to the acquisition layer. Every metric is computed exclusively from locally stored data."
- **Idempotence:** "Re-running acquisition within the freshness boundary performs no network work and does not modify local state."
- **Immutability:** "Once persisted, a snapshot is never modified. A newer snapshot represents a new observation rather than an update to an existing one."
- **Market cap is acquired, never derived.** Deriving it from `price × shares outstanding` was rejected on measured evidence; see the spec's table. Do not reintroduce it.
- **`Weekly` is a freshness policy, not a filing schedule.** It bounds staleness to seven days. Nothing may assume statements change weekly.
- No test may make a network call. `tests/conftest.py::_forbid_network` enforces this and will fail the test for you.
- No test may read or write `data/processed/moneyview.db`. `tests/conftest.py::_forbid_the_real_database` enforces this.
- Run tests with `python -m pytest`, never bare `pytest`.
- Match surrounding style. Do not "improve" adjacent code.
- Every task ends green: `python -m pytest tests/core_finance/ tests/api/ -q` must report 0 failed before you commit.

## Context the implementer needs

**The acquisition layer already exists and works.** Read these four files before Task 1; they are small and the design depends on their conventions:

- `apps/api/services/acquisition/boundaries.py` — `Boundary` protocol, `Daily`. Pure: `now` is a parameter, never a clock read.
- `apps/api/services/acquisition/freshness.py` — the whole rule is `state.last_checked_at < boundary.most_recent_instant(now)`, i.e. "have I asked since the last boundary?"
- `apps/api/services/acquisition/state.py` — `AcquisitionState`, `record_check`, `record_success`, `record_retired`, `read_state`.
- `apps/api/services/acquisition/registry.py` — `DataClass` rows.

**One thing the runner's docstring gets wrong.** `runner.py` says it "holds no per-class logic: adding a data class is a registry row". That is true of the registry but not of `acquire()`, which calls `plan_range`, runs a corporate-action probe, and reads `row.date` to compute coverage. All three are bar-shaped. Statements have no date range to plan. Task 5 therefore adds a sibling `acquire_point_in_time` rather than bending `acquire`, and both statements and quote facts use it — two consumers, so it is not a speculative abstraction. Update the module docstring in Task 5 to describe both shapes.

**The bundle shape must not change.** `get_yahoo_statement_bundle` returns a dict with keys `ticker`, `income`, `balance`, `cashflow`, `quarterly_income`, `quarterly_balance`, `quarterly_cashflow`, `info`, `fetched_at`, where the six statement values are pandas DataFrames indexed by line item with period-end columns. Every metric function downstream consumes that shape. Task 6 reconstructs exactly that dict from the local store so no metric code changes.

## File Structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `apps/api/services/acquisition/boundaries.py` | Modify | Add `Weekly` |
| `apps/api/services/db.py` | Modify | Two new tables; snapshot columns |
| `apps/api/services/acquisition/sources/statements.py` | Create | Fetch statements from yfinance, return normalised rows |
| `apps/api/services/acquisition/sources/quote_facts.py` | Create | Fetch market cap and shares outstanding |
| `apps/api/services/acquisition/registry.py` | Modify | `statements` and `market_cap` rows |
| `apps/api/services/acquisition/runner.py` | Modify | `acquire_point_in_time` |
| `apps/api/services/acquisition/store.py` | Create | Read/write the two new stores; rebuild the bundle dict |
| `apps/api/services/corporate_statement_metrics.py` | Modify | Read the store; delete the `TTLCache` |
| `apps/api/services/corporate_comparison.py` | Modify | Manual-only read path; `snapshot_id`, `metric_schema_version` |
| `apps/api/routes/corporate.py` | Modify | Delete `ensure_corporate_comparison_daily_snapshot`; button acquires then computes |
| `apps/api/main.py` | Modify | Delete `corporate_snapshot_cycle` |

---

## Task 1: The `Weekly` boundary

**Files:**
- Modify: `apps/api/services/acquisition/boundaries.py`
- Test: `tests/api/acquisition/test_boundaries.py`

**Interfaces:**
- Consumes: the existing `Boundary` protocol and `Daily` dataclass in the same file.
- Produces: `Weekly(weekday: int, at_hour: int = 0, at_minute: int = 0)` with `most_recent_instant(now: datetime) -> datetime`. `weekday` uses Python's convention: Monday is 0, Sunday is 6.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/acquisition/test_boundaries.py`:

```python
def test_weekly_returns_the_most_recent_occurrence_of_that_weekday():
    boundary = Weekly(weekday=0, at_hour=0)

    # Thursday 2026-07-30 12:00 UTC -> the Monday of that week.
    result = boundary.most_recent_instant(datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc))

    assert result == datetime(2026, 7, 27, 0, 0, tzinfo=timezone.utc)


def test_weekly_on_the_boundary_day_before_the_hour_steps_back_a_full_week():
    boundary = Weekly(weekday=0, at_hour=6)

    # Monday 2026-07-27 05:00 is before 06:00, so the last boundary is the previous Monday.
    result = boundary.most_recent_instant(datetime(2026, 7, 27, 5, 0, tzinfo=timezone.utc))

    assert result == datetime(2026, 7, 20, 6, 0, tzinfo=timezone.utc)


def test_weekly_exactly_on_the_boundary_instant_returns_that_instant():
    boundary = Weekly(weekday=0, at_hour=6)

    result = boundary.most_recent_instant(datetime(2026, 7, 27, 6, 0, tzinfo=timezone.utc))

    assert result == datetime(2026, 7, 27, 6, 0, tzinfo=timezone.utc)


def test_weekly_rejects_a_naive_datetime():
    with pytest.raises(ValueError, match="timezone-aware"):
        Weekly(weekday=0).most_recent_instant(datetime(2026, 7, 30, 12, 0))


def test_weekly_rejects_an_out_of_range_weekday():
    with pytest.raises(ValueError, match="weekday"):
        Weekly(weekday=7)
```

Check the file's existing imports; add `Weekly` to the `from apps.api.services.acquisition.boundaries import ...` line and ensure `pytest`, `datetime`, `timezone` are imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/acquisition/test_boundaries.py -q`
Expected: FAIL with `ImportError: cannot import name 'Weekly'`.

- [ ] **Step 3: Implement `Weekly`**

Add to `apps/api/services/acquisition/boundaries.py`, after `Daily`:

```python
@dataclass(frozen=True)
class Weekly:
    """Invalid once the next occurrence of `weekday` at `at_hour:at_minute` UTC passes.

    This is a freshness policy, not a model of anything's publication cadence. Statements
    are filed quarterly and irregularly per company; Weekly simply bounds how stale a held
    copy may be to seven days, until a filing-aware boundary exists. Nothing may read it as
    "this data changes weekly".

    `weekday` follows Python: Monday is 0, Sunday is 6.
    """

    weekday: int
    at_hour: int = 0
    at_minute: int = 0

    def __post_init__(self) -> None:
        if not 0 <= self.weekday <= 6:
            raise ValueError(f"weekday must be 0-6 (Monday is 0), got {self.weekday}")
        if not 0 <= self.at_hour <= 23:
            raise ValueError(f"at_hour must be 0-23, got {self.at_hour}")
        if not 0 <= self.at_minute <= 59:
            raise ValueError(f"at_minute must be 0-59, got {self.at_minute}")

    def most_recent_instant(self, now: datetime) -> datetime:
        if now.tzinfo is None:
            raise ValueError("Boundary comparisons require a timezone-aware datetime (UTC)")
        candidate = now.replace(
            hour=self.at_hour, minute=self.at_minute, second=0, microsecond=0
        )
        candidate -= timedelta(days=(candidate.weekday() - self.weekday) % 7)
        if candidate > now:
            candidate -= timedelta(days=7)
        return candidate
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/acquisition/test_boundaries.py -q`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/boundaries.py tests/api/acquisition/test_boundaries.py
git commit -m "feat: add a Weekly freshness boundary

A freshness policy bounding staleness to seven days, not a model of
filing cadence. Statements are filed quarterly and irregularly per
company; nothing may read Weekly as 'this data changes weekly'."
```

**Acceptance:** ✓ `Weekly` steps back to the most recent matching weekday. ✓ Before the hour on the boundary day it steps back a full week. ✓ Naive datetimes and out-of-range weekdays raise at construction or call.

---

## Task 2: The two local stores

**Files:**
- Modify: `apps/api/services/db.py` (schema block, near `corporate_comparison_snapshots_v3` around `:399`)
- Test: `tests/api/test_sqlite_schema_validation.py`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `corporate_statements` and `corporate_quote_facts`, created by `init_db()`.

**Context:** `init_db()` runs a single `executescript` of `CREATE TABLE IF NOT EXISTS` statements. Add these beside the existing corporate tables. `tests/conftest.py::_isolated_db` calls `init_db()` for every test, so once these exist every test has them.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_sqlite_schema_validation.py`:

```python
def test_init_db_creates_the_statement_and_quote_fact_stores():
    with db_service.get_db() as conn:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }

    assert {"corporate_statements", "corporate_quote_facts"} <= tables


def test_corporate_statements_is_keyed_by_line_item_within_a_period():
    """One row per line item per period per statement, so a refetch replaces rather than
    duplicates -- the same INSERT OR REPLACE contract the bars table relies on."""
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_statements
                   (ticker, statement_type, frequency, period_end, line_item, value, fetched_at)
               VALUES ('AAPL', 'income', 'annual', '2025-09-30', 'Total Revenue', 1.0, '2026-07-28T00:00:00+00:00')"""
        )
        conn.execute(
            """INSERT OR REPLACE INTO corporate_statements
                   (ticker, statement_type, frequency, period_end, line_item, value, fetched_at)
               VALUES ('AAPL', 'income', 'annual', '2025-09-30', 'Total Revenue', 2.0, '2026-07-28T01:00:00+00:00')"""
        )
        rows = conn.execute(
            "SELECT value FROM corporate_statements WHERE ticker='AAPL'"
        ).fetchall()

    assert [row["value"] for row in rows] == [2.0]
```

Confirm the file already imports `db_service`; if not, add `from apps.api.services import db as db_service`.

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_sqlite_schema_validation.py -q`
Expected: FAIL — the assertion on table names fails, and the insert raises `sqlite3.OperationalError: no such table`.

- [ ] **Step 3: Add the tables**

In `apps/api/services/db.py`, in the schema script beside the other corporate tables:

```sql
-- Statements are stored one row per line item per period, not as a serialised blob, so
-- they can be queried deterministically, updated in part, and grown with new metrics
-- without a schema change or a deserialisation step.
CREATE TABLE IF NOT EXISTS corporate_statements (
    ticker         TEXT NOT NULL,
    statement_type TEXT NOT NULL,
    frequency      TEXT NOT NULL,
    period_end     TEXT NOT NULL,
    line_item      TEXT NOT NULL,
    value          REAL,
    fetched_at     TEXT NOT NULL,
    PRIMARY KEY (ticker, statement_type, frequency, period_end, line_item)
);

CREATE INDEX IF NOT EXISTS idx_corporate_statements_lookup
    ON corporate_statements(ticker, statement_type, frequency, period_end);

-- Quote-derived facts are a separate class from statements because they have a different
-- natural frequency. Market cap is acquired here, never derived from shares outstanding:
-- the balance-sheet share count is absent for ETFs, aggregates share classes, and counts
-- ordinary shares rather than ADRs.
CREATE TABLE IF NOT EXISTS corporate_quote_facts (
    ticker              TEXT PRIMARY KEY,
    market_cap          REAL,
    shares_outstanding  REAL,
    currency            TEXT DEFAULT '',
    fetched_at          TEXT NOT NULL
);
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/test_sqlite_schema_validation.py -q`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `python -m pytest tests/core_finance/ tests/api/ -q`
Expected: 0 failed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/db.py tests/api/test_sqlite_schema_validation.py
git commit -m "feat: add local stores for statements and quote facts

Statements are normalised one row per line item per period rather than
stored as a blob, so they can be queried deterministically, updated in
part, and grown with new metrics without a schema change.

Quote facts are a separate table because market cap has a different
natural frequency from a quarterly filing."
```

**Acceptance:** ✓ Both tables exist after `init_db()`. ✓ A repeated insert for the same line item and period replaces rather than duplicates.

---

## Task 3: The statements source

**Files:**
- Create: `apps/api/services/acquisition/sources/statements.py`
- Test: `tests/api/acquisition/test_statements_source.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `@dataclass(frozen=True) class StatementRow: ticker: str; statement_type: str; frequency: str; period_end: str; line_item: str; value: float | None`
  - `fetch_statements(ticker: str, *, ticker_factory: Callable[[str], object] | None = None) -> list[StatementRow]`

**Context:** Model this on `apps/api/services/acquisition/sources/bars.py`, which takes an injectable `ticker_factory` so tests never touch the network. Do the same here — the suite's `_forbid_network` guard will fail any test that forgets.

yfinance returns six DataFrames: `.financials`, `.balance_sheet`, `.cashflow` (annual) and `.quarterly_financials`, `.quarterly_balance_sheet`, `.quarterly_cashflow`. Each is indexed by line item with `Timestamp` columns for period ends. `NaN` is common and must be stored as `None`, not `0.0` — a missing line item is not a zero.

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_statements_source.py`:

```python
from types import SimpleNamespace

import pandas as pd
import pytest

from apps.api.services.acquisition.sources.statements import StatementRow, fetch_statements


def _frame(rows: dict[str, list[float | None]], periods: list[str]) -> pd.DataFrame:
    return pd.DataFrame(rows, index=periods).T


def _fake_ticker(**frames):
    empty = pd.DataFrame()
    return SimpleNamespace(
        financials=frames.get("financials", empty),
        balance_sheet=frames.get("balance_sheet", empty),
        cashflow=frames.get("cashflow", empty),
        quarterly_financials=frames.get("quarterly_financials", empty),
        quarterly_balance_sheet=frames.get("quarterly_balance_sheet", empty),
        quarterly_cashflow=frames.get("quarterly_cashflow", empty),
    )


def test_annual_income_rows_carry_type_frequency_and_period():
    frame = _frame({"Total Revenue": [100.0, 90.0]}, ["2025-09-30", "2024-09-30"])
    rows = fetch_statements("AAPL", ticker_factory=lambda _: _fake_ticker(financials=frame))

    assert StatementRow("AAPL", "income", "annual", "2025-09-30", "Total Revenue", 100.0) in rows
    assert StatementRow("AAPL", "income", "annual", "2024-09-30", "Total Revenue", 90.0) in rows


def test_quarterly_frames_are_tagged_quarterly():
    frame = _frame({"Total Revenue": [25.0]}, ["2026-06-30"])
    rows = fetch_statements("AAPL", ticker_factory=lambda _: _fake_ticker(quarterly_financials=frame))

    assert [row.frequency for row in rows] == ["quarterly"]


def test_missing_values_are_none_not_zero():
    """A line item the provider did not report is unknown, not zero. Storing 0.0 would
    feed a real number into a formula that should have reported missing input."""
    frame = _frame({"Total Revenue": [float("nan")]}, ["2025-09-30"])
    rows = fetch_statements("AAPL", ticker_factory=lambda _: _fake_ticker(financials=frame))

    assert [row.value for row in rows] == [None]


def test_an_empty_balance_sheet_yields_no_rows_and_does_not_raise():
    """ETFs return an entirely empty balance sheet -- SPY does. That is a normal case."""
    rows = fetch_statements("SPY", ticker_factory=lambda _: _fake_ticker())

    assert rows == []


def test_all_six_frames_are_read():
    frame = _frame({"Line": [1.0]}, ["2025-12-31"])
    rows = fetch_statements(
        "AAPL",
        ticker_factory=lambda _: _fake_ticker(
            financials=frame, balance_sheet=frame, cashflow=frame,
            quarterly_financials=frame, quarterly_balance_sheet=frame, quarterly_cashflow=frame,
        ),
    )

    assert {(row.statement_type, row.frequency) for row in rows} == {
        ("income", "annual"), ("balance", "annual"), ("cashflow", "annual"),
        ("income", "quarterly"), ("balance", "quarterly"), ("cashflow", "quarterly"),
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_statements_source.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.acquisition.sources.statements'`.

- [ ] **Step 3: Implement the source**

Create `apps/api/services/acquisition/sources/statements.py`:

```python
"""Fetch company statements and flatten them into normalised rows.

The provider handle is injected so this is testable without a network. Six frames arrive
as pandas DataFrames indexed by line item with period-end columns; they leave as one row
per line item per period, which is what the store holds.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import pandas as pd

_FRAMES: tuple[tuple[str, str, str], ...] = (
    ("financials", "income", "annual"),
    ("balance_sheet", "balance", "annual"),
    ("cashflow", "cashflow", "annual"),
    ("quarterly_financials", "income", "quarterly"),
    ("quarterly_balance_sheet", "balance", "quarterly"),
    ("quarterly_cashflow", "cashflow", "quarterly"),
)


@dataclass(frozen=True)
class StatementRow:
    ticker: str
    statement_type: str
    frequency: str
    period_end: str
    line_item: str
    value: float | None


def _default_ticker_factory(symbol: str):
    import yfinance as yf

    return yf.Ticker(symbol)


def _period_key(column) -> str:
    return str(getattr(column, "date", lambda: column)())[:10]


def fetch_statements(
    ticker: str,
    *,
    ticker_factory: Callable[[str], object] | None = None,
) -> list[StatementRow]:
    handle = (ticker_factory or _default_ticker_factory)(ticker)
    rows: list[StatementRow] = []

    for attribute, statement_type, frequency in _FRAMES:
        frame = getattr(handle, attribute, None)
        if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
            continue
        for column in frame.columns:
            period_end = _period_key(column)
            for line_item, value in frame[column].items():
                # NaN means the provider did not report the line item. Storing 0.0 would
                # hand a real number to a formula that should report a missing input.
                rows.append(
                    StatementRow(
                        ticker=ticker,
                        statement_type=statement_type,
                        frequency=frequency,
                        period_end=period_end,
                        line_item=str(line_item),
                        value=None if pd.isna(value) else float(value),
                    )
                )
    return rows
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_statements_source.py -q`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/sources/statements.py tests/api/acquisition/test_statements_source.py
git commit -m "feat: statements source flattening six frames to normalised rows

The provider handle is injected, so this is testable without a network.
A line item the provider did not report is stored as NULL rather than
0.0 -- a missing input must reach the quality rules as missing."
```

**Acceptance:** ✓ All six frames are read and tagged with type and frequency. ✓ `NaN` becomes `None`. ✓ An empty frame yields no rows rather than raising.

---

## Task 4: The quote-facts source

**Files:**
- Create: `apps/api/services/acquisition/sources/quote_facts.py`
- Test: `tests/api/acquisition/test_quote_facts_source.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `@dataclass(frozen=True) class QuoteFacts: ticker: str; market_cap: float | None; shares_outstanding: float | None; currency: str`
  - `fetch_quote_facts(ticker: str, *, ticker_factory: Callable[[str], object] | None = None) -> QuoteFacts | None`

**Context:** Returns `None` when the provider gives nothing usable, which the runner records as `EMPTY`. `SPY` returns `marketCap: None` — that is a normal case, already handled downstream by the `missing_market_cap` quality rule at `corporate_statement_metrics.py:68`. Do not substitute `0.0`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_quote_facts_source.py`:

```python
from types import SimpleNamespace

from apps.api.services.acquisition.sources.quote_facts import QuoteFacts, fetch_quote_facts


def _fake_ticker(info):
    return SimpleNamespace(info=info)


def test_reads_market_cap_shares_and_currency():
    facts = fetch_quote_facts(
        "AAPL",
        ticker_factory=lambda _: _fake_ticker(
            {"marketCap": 4_957_276_209_152, "sharesOutstanding": 14_687_356_000, "currency": "USD"}
        ),
    )

    assert facts == QuoteFacts("AAPL", 4_957_276_209_152.0, 14_687_356_000.0, "USD")


def test_a_missing_market_cap_stays_none():
    """SPY reports marketCap None. That must reach the missing_market_cap quality rule as
    missing, not as a zero that a WACC weight would divide by."""
    facts = fetch_quote_facts(
        "SPY",
        ticker_factory=lambda _: _fake_ticker({"sharesOutstanding": 917_782_016, "currency": "USD"}),
    )

    assert facts.market_cap is None
    assert facts.shares_outstanding == 917_782_016.0


def test_empty_info_returns_none():
    assert fetch_quote_facts("NOPE", ticker_factory=lambda _: _fake_ticker({})) is None


def test_a_provider_that_raises_on_info_returns_none():
    class Raises:
        @property
        def info(self):
            raise ValueError("provider blew up")

    assert fetch_quote_facts("BAD", ticker_factory=lambda _: Raises()) is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_quote_facts_source.py -q`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the source**

Create `apps/api/services/acquisition/sources/quote_facts.py`:

```python
"""Fetch quote-derived facts: market cap, shares outstanding, currency.

A separate data class from statements because the frequencies differ -- a filing is
quarterly, a market cap moves with the market.

Market cap is acquired, never derived from price x shares outstanding. Measured on
2026-07-28, the balance-sheet share count is absent for ETFs, historical rather than
current, aggregates share classes (GOOGL 2.06x, BRK-B ~972x), and counts ordinary shares
rather than ADRs (TSM 5.0x). It fails silently with plausible numbers.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class QuoteFacts:
    ticker: str
    market_cap: float | None
    shares_outstanding: float | None
    currency: str


def _default_ticker_factory(symbol: str):
    import yfinance as yf

    return yf.Ticker(symbol)


def _optional_float(raw) -> float | None:
    # A missing figure must stay missing: 0.0 would be a real number to a WACC weight.
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def fetch_quote_facts(
    ticker: str,
    *,
    ticker_factory: Callable[[str], object] | None = None,
) -> QuoteFacts | None:
    handle = (ticker_factory or _default_ticker_factory)(ticker)
    try:
        info = handle.info or {}
    except (AttributeError, KeyError, TypeError, ValueError):
        return None

    market_cap = _optional_float(info.get("marketCap"))
    shares_outstanding = _optional_float(info.get("sharesOutstanding"))
    if market_cap is None and shares_outstanding is None:
        return None

    return QuoteFacts(
        ticker=ticker,
        market_cap=market_cap,
        shares_outstanding=shares_outstanding,
        currency=str(info.get("currency") or ""),
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_quote_facts_source.py -q`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/sources/quote_facts.py tests/api/acquisition/test_quote_facts_source.py
git commit -m "feat: quote-facts source for market cap and shares outstanding

Market cap is acquired, never derived from price x shares outstanding:
the balance-sheet share count is absent for ETFs, aggregates share
classes, and counts ordinary shares rather than ADRs. A missing figure
stays None so it reaches the missing_market_cap quality rule."
```

**Acceptance:** ✓ Market cap, shares and currency are read. ✓ A missing market cap stays `None`. ✓ Empty or raising providers return `None` rather than propagating.

---

## Task 5: Registry rows and `acquire_point_in_time`

**Files:**
- Modify: `apps/api/services/acquisition/registry.py`
- Modify: `apps/api/services/acquisition/runner.py`
- Test: `tests/api/acquisition/test_registry.py`, `tests/api/acquisition/test_runner.py`

**Interfaces:**
- Consumes: `Weekly` (Task 1), `StatementRow`/`fetch_statements` (Task 3), `QuoteFacts`/`fetch_quote_facts` (Task 4).
- Produces: `acquire_point_in_time(data_class_name: str, subject: str, *, now: datetime, fetcher: Callable[[str], object], saver: Callable[[str, object], None], coverage: Callable[[object], tuple[date, date]]) -> AcquisitionResult`, returning the existing `AcquisitionResult` dataclass.

**Context:** `acquire()` cannot be reused. It calls `plan_range`, runs a corporate-action probe, and derives coverage from `row.date` — all bar-shaped. Statements have no range to plan. `acquire_point_in_time` shares what is genuinely general: the freshness question and the state records.

`record_success` requires `covered_from` and `covered_to` dates, so the caller supplies a `coverage` function. For statements that is the earliest and latest `period_end`; for quote facts it is today twice.

Failure semantics follow `acquire()` exactly — `record_check(..., status=FAILED, detail=str(error))`, which advances `last_checked_at`. That is deliberate and documented in the spec: freshness tracks "have I asked", so a delisted ticker is not retried forever. The consequence under `Weekly` is that a transient failure suppresses retry for up to seven days.

- [ ] **Step 1: Write the failing registry test**

Append to `tests/api/acquisition/test_registry.py`:

```python
def test_statements_is_declared_with_a_weekly_boundary():
    declared = get_data_class("statements")

    assert declared.scope is Scope.PER_TICKER
    assert declared.store == "corporate_statements"
    assert isinstance(declared.boundary, Weekly)


def test_market_cap_is_a_separate_class_from_statements():
    """Different natural frequencies: a filing is quarterly, a market cap moves with the
    market. One boundary cannot serve both without making one of them wrong."""
    statements = get_data_class("statements")
    market_cap = get_data_class("market_cap")

    assert market_cap.store == "corporate_quote_facts"
    assert market_cap.boundary != statements.boundary
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_registry.py -q`
Expected: FAIL with `KeyError: "unknown data class: 'statements'"`.

- [ ] **Step 3: Add the registry rows**

In `apps/api/services/acquisition/registry.py`, import `Weekly` alongside `Daily` and add:

```python
# Weekly bounds staleness to seven days. It does NOT model filing cadence -- filings are
# quarterly and irregular per company. A filing-aware boundary replaces this later.
_WEEKLY_UTC = Weekly(weekday=0, at_hour=0)

REGISTRY: dict[str, DataClass] = {
    # ... existing equity_bars and index_bars rows unchanged ...
    "statements": DataClass(
        name="statements",
        scope=Scope.PER_TICKER,
        boundary=_WEEKLY_UTC,
        store="corporate_statements",
        calendar="us_equity",
    ),
    # Daily, not intraday: every price input in MoneyView is a daily bar, so a sub-daily
    # market cap would be the only intraday input and would make WACC move within a day
    # while nothing else did.
    "market_cap": DataClass(
        name="market_cap",
        scope=Scope.PER_TICKER,
        boundary=_DAILY_UTC,
        store="corporate_quote_facts",
        calendar="us_equity",
    ),
}
```

- [ ] **Step 4: Write the failing runner tests**

Append to `tests/api/acquisition/test_runner.py`:

```python
def test_point_in_time_skips_entirely_when_fresh():
    """Idempotence: inside the boundary, no network work and no state change."""
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    record_success("statements", "AAPL", now=now, covered_from=date(2024, 1, 1), covered_to=date(2025, 9, 30))
    calls = []

    result = acquire_point_in_time(
        "statements", "AAPL", now=now,
        fetcher=lambda subject: calls.append(subject) or [],
        saver=lambda subject, rows: calls.append("saved"),
        coverage=lambda rows: (date(2024, 1, 1), date(2025, 9, 30)),
    )

    assert result.skipped is True
    assert result.reason == "fresh"
    assert calls == []


def test_point_in_time_saves_and_records_coverage():
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    saved = {}

    result = acquire_point_in_time(
        "statements", "AAPL", now=now,
        fetcher=lambda subject: ["row"],
        saver=lambda subject, rows: saved.update({subject: rows}),
        coverage=lambda rows: (date(2024, 9, 30), date(2025, 9, 30)),
    )

    assert result.skipped is False
    assert saved == {"AAPL": ["row"]}
    state = read_state("statements", "AAPL")
    assert state.status == AcquisitionStatus.OK
    assert state.covered_to == date(2025, 9, 30)


def test_point_in_time_records_failure_without_touching_stored_data():
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)

    def explode(subject):
        raise RuntimeError("provider down")

    result = acquire_point_in_time(
        "statements", "AAPL", now=now,
        fetcher=explode,
        saver=lambda subject, rows: pytest.fail("saver must not run on a failed fetch"),
        coverage=lambda rows: (date(2024, 1, 1), date(2025, 1, 1)),
    )

    assert result.skipped is False
    state = read_state("statements", "AAPL")
    assert state.status == AcquisitionStatus.FAILED
    assert state.last_success_at is None
    # Advanced deliberately: freshness asks "have I asked", so a delisted ticker is not
    # retried forever. Under Weekly that suppresses retry for up to seven days.
    assert state.last_checked_at == now


def test_point_in_time_acquires_again_once_the_boundary_has_passed():
    """The other half of idempotence: fresh means skip, stale means fetch. Without this,
    a boundary that never expires would pass the skip test and silently freeze the data."""
    acquired_at = datetime(2026, 7, 27, 12, 0, tzinfo=timezone.utc)      # Monday
    record_success("statements", "AAPL", now=acquired_at,
                   covered_from=date(2024, 1, 1), covered_to=date(2025, 9, 30))
    calls = []

    # The following Monday: a new Weekly boundary has passed.
    result = acquire_point_in_time(
        "statements", "AAPL", now=datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc),
        fetcher=lambda subject: calls.append(subject) or ["row"],
        saver=lambda subject, rows: None,
        coverage=lambda rows: (date(2024, 1, 1), date(2025, 9, 30)),
    )

    assert result.skipped is False
    assert calls == ["AAPL"]


def test_point_in_time_counts_a_single_dataclass_payload():
    """Quote facts arrive as one frozen dataclass, not a list. Counting must not assume
    __len__ exists."""
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    facts = QuoteFacts("AAPL", 4_000.0, 100.0, "USD")

    result = acquire_point_in_time(
        "market_cap", "AAPL", now=now,
        fetcher=lambda subject: facts,
        saver=lambda subject, payload: None,
        coverage=lambda payload: (now.date(), now.date()),
    )

    assert result.fetched_rows == 1


def test_point_in_time_records_empty_when_the_provider_returns_nothing():
    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)

    result = acquire_point_in_time(
        "statements", "AAPL", now=now,
        fetcher=lambda subject: [],
        saver=lambda subject, rows: pytest.fail("saver must not run on an empty fetch"),
        coverage=lambda rows: (date(2024, 1, 1), date(2025, 1, 1)),
    )

    assert result.skipped is False
    assert read_state("statements", "AAPL").status == AcquisitionStatus.EMPTY
```

Add `acquire_point_in_time` to the module's import line and confirm `date`, `datetime`,
`timezone`, `pytest`, `read_state`, `record_success`, `AcquisitionStatus` are imported. Add
`from apps.api.services.acquisition.sources.quote_facts import QuoteFacts` for the
single-dataclass counting test.

- [ ] **Step 5: Run to verify they fail**

Run: `python -m pytest tests/api/acquisition/test_runner.py -q`
Expected: FAIL with `ImportError: cannot import name 'acquire_point_in_time'`.

- [ ] **Step 6: Implement `acquire_point_in_time`**

Add to `apps/api/services/acquisition/runner.py`:

```python
def acquire_point_in_time(
    data_class_name: str,
    subject: str,
    *,
    now: datetime,
    fetcher,
    saver,
    coverage,
) -> AcquisitionResult:
    """Acquire a data class that has no date range to plan.

    `acquire` above is range-shaped: it plans a fetch window, probes for corporate actions
    and derives coverage from bar dates. Statements and quote facts have none of that --
    the provider returns whatever periods it currently reports. What is genuinely shared
    is the freshness question and the state records, which is all this reuses.

    `coverage` maps the fetched rows to (covered_from, covered_to) for record_success.
    """
    declared = get_data_class(data_class_name)
    state = read_state(data_class_name, subject)

    if not needs_acquisition(state, declared.boundary, now):
        return AcquisitionResult(data_class_name, subject, 0, "fresh", skipped=True)

    try:
        rows = fetcher(subject)
    except Exception as error:  # noqa: BLE001 - never propagate into a caller
        logger.warning("acquisition.fetch_failed data_class=%s subject=%s error=%s",
                       data_class_name, subject, error)
        record_check(data_class_name, subject, now=now, status=AcquisitionStatus.FAILED, detail=str(error))
        return AcquisitionResult(data_class_name, subject, 0, "failed", skipped=False)

    if not rows:
        record_check(data_class_name, subject, now=now, status=AcquisitionStatus.EMPTY)
        return AcquisitionResult(data_class_name, subject, 0, "empty", skipped=False)

    saver(subject, rows)
    covered_from, covered_to = coverage(rows)
    record_success(data_class_name, subject, now=now, covered_from=covered_from, covered_to=covered_to)
    # Statements arrive as a list; quote facts arrive as a single frozen dataclass with no
    # __len__. Both are legitimate point-in-time payloads, so count defensively.
    fetched = len(rows) if hasattr(rows, "__len__") else 1
    return AcquisitionResult(data_class_name, subject, fetched, "acquired", skipped=False)
```

Update the module docstring's "Holds no per-class logic: adding a data class is a registry row" to:

```python
"""Acquisition orchestration.

Two shapes. `acquire` is range-shaped -- it plans a fetch window, probes for corporate
actions, and derives coverage from bar dates. `acquire_point_in_time` is for classes with
no range, where the provider returns whatever periods it currently reports. Both share the
freshness question and the state records and hold no other per-class logic.

A source protocol gets extracted when a third shape appears; with two, an abstraction
would be guessing.

No acquisition failure ever propagates into a request. Precedent: the telemetry sink's
failure policy in perf spec 03.8.
"""
```

- [ ] **Step 7: Run to verify they pass**

Run: `python -m pytest tests/api/acquisition/ -q`
Expected: PASS, whole directory.

- [ ] **Step 8: Commit**

```bash
git add apps/api/services/acquisition/registry.py apps/api/services/acquisition/runner.py tests/api/acquisition/
git commit -m "feat: declare statements and market_cap, add point-in-time acquisition

acquire() is range-shaped -- it plans a window, probes corporate actions
and derives coverage from bar dates -- so statements cannot reuse it.
acquire_point_in_time shares the freshness question and the state
records, which is the genuinely general part, and has two consumers
immediately rather than being a speculative abstraction.

Failure follows the existing convention: record_check advances
last_checked_at so a delisted subject is not retried forever. Under
Weekly that suppresses retry for up to seven days, which the spec
records as an accepted cost."
```

**Acceptance:** ✓ Both classes are declared with distinct boundaries. ✓ A fresh subject does no work and changes no state. ✓ Failure records `FAILED` and leaves `last_success_at` alone. ✓ An empty fetch records `EMPTY`.

---

## Task 6: The store — write rows, rebuild the bundle

**Files:**
- Create: `apps/api/services/acquisition/store.py`
- Test: `tests/api/acquisition/test_store.py`

**Interfaces:**
- Consumes: `StatementRow` (Task 3), `QuoteFacts` (Task 4), the tables (Task 2).
- Produces:
  - `save_statements(ticker: str, rows: list[StatementRow]) -> None`
  - `save_quote_facts(ticker: str, facts: QuoteFacts) -> None`
  - `statement_coverage(rows: list[StatementRow]) -> tuple[date, date]`
  - `load_statement_bundle(ticker: str) -> dict[str, object] | None`

**Context:** `load_statement_bundle` must return **exactly** the dict shape `get_yahoo_statement_bundle` returns today, so no metric code changes: keys `ticker`, `income`, `balance`, `cashflow`, `quarterly_income`, `quarterly_balance`, `quarterly_cashflow`, `info`, `fetched_at`. The six statement values are DataFrames indexed by line item with period-end columns, newest first — that ordering matters because metric code takes the first column as the latest period. `info` is rebuilt from `corporate_quote_facts` as `{"marketCap": ..., "sharesOutstanding": ..., "currency": ...}`.

Return `None` when the ticker has no stored statements, which is the same contract the current function has for an unusable provider response.

- [ ] **Step 1: Write the failing test**

Create `tests/api/acquisition/test_store.py`:

```python
from datetime import date

import pandas as pd

from apps.api.services.acquisition.sources.quote_facts import QuoteFacts
from apps.api.services.acquisition.sources.statements import StatementRow
from apps.api.services.acquisition.store import (
    load_statement_bundle,
    save_quote_facts,
    save_statements,
    statement_coverage,
)


def _rows() -> list[StatementRow]:
    return [
        StatementRow("AAPL", "income", "annual", "2024-09-30", "Total Revenue", 90.0),
        StatementRow("AAPL", "income", "annual", "2025-09-30", "Total Revenue", 100.0),
        StatementRow("AAPL", "balance", "quarterly", "2026-06-30", "Total Debt", 5.0),
    ]


def test_coverage_spans_earliest_to_latest_period():
    assert statement_coverage(_rows()) == (date(2024, 9, 30), date(2026, 6, 30))


def test_bundle_rebuilds_the_shape_metric_code_expects():
    save_statements("AAPL", _rows())
    save_quote_facts("AAPL", QuoteFacts("AAPL", 4_000.0, 100.0, "USD"))

    bundle = load_statement_bundle("AAPL")

    assert set(bundle) == {
        "ticker", "income", "balance", "cashflow",
        "quarterly_income", "quarterly_balance", "quarterly_cashflow",
        "info", "fetched_at",
    }
    assert isinstance(bundle["income"], pd.DataFrame)
    assert bundle["info"]["marketCap"] == 4_000.0


def test_periods_are_newest_first():
    """Metric code reads the first column as the latest period. Ordering is load-bearing."""
    save_statements("AAPL", _rows())

    columns = list(load_statement_bundle("AAPL")["income"].columns)

    assert columns == ["2025-09-30", "2024-09-30"]


def test_a_missing_value_round_trips_as_nan_not_zero():
    save_statements("NONE", [StatementRow("NONE", "income", "annual", "2025-09-30", "Total Revenue", None)])

    value = load_statement_bundle("NONE")["income"].loc["Total Revenue", "2025-09-30"]

    assert pd.isna(value)


def test_an_unknown_ticker_returns_none():
    assert load_statement_bundle("NOPE") is None


def test_resaving_replaces_rather_than_duplicates():
    save_statements("AAPL", _rows())
    save_statements("AAPL", [StatementRow("AAPL", "income", "annual", "2025-09-30", "Total Revenue", 111.0)])

    assert load_statement_bundle("AAPL")["income"].loc["Total Revenue", "2025-09-30"] == 111.0
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/acquisition/test_store.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'apps.api.services.acquisition.store'`.

- [ ] **Step 3: Implement the store**

Create `apps/api/services/acquisition/store.py`:

```python
"""Read and write the local statement and quote-fact stores.

`load_statement_bundle` rebuilds exactly the dict shape the metric layer already consumes,
so moving statements onto disk changes no metric code.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pandas as pd

from apps.api.services.acquisition.sources.quote_facts import QuoteFacts
from apps.api.services.acquisition.sources.statements import StatementRow
from apps.api.services.db import get_db

_BUNDLE_KEYS: tuple[tuple[str, str, str], ...] = (
    ("income", "income", "annual"),
    ("balance", "balance", "annual"),
    ("cashflow", "cashflow", "annual"),
    ("quarterly_income", "income", "quarterly"),
    ("quarterly_balance", "balance", "quarterly"),
    ("quarterly_cashflow", "cashflow", "quarterly"),
)


def statement_coverage(rows: list[StatementRow]) -> tuple[date, date]:
    periods = sorted(date.fromisoformat(row.period_end) for row in rows)
    return periods[0], periods[-1]


def save_statements(ticker: str, rows: list[StatementRow]) -> None:
    fetched_at = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.executemany(
            """INSERT OR REPLACE INTO corporate_statements
                   (ticker, statement_type, frequency, period_end, line_item, value, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (row.ticker, row.statement_type, row.frequency, row.period_end,
                 row.line_item, row.value, fetched_at)
                for row in rows
            ],
        )


def save_quote_facts(ticker: str, facts: QuoteFacts) -> None:
    with get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_quote_facts
                   (ticker, market_cap, shares_outstanding, currency, fetched_at)
               VALUES (?, ?, ?, ?, ?)""",
            (ticker, facts.market_cap, facts.shares_outstanding, facts.currency,
             datetime.now(timezone.utc).isoformat()),
        )


def _frame(rows: list, statement_type: str, frequency: str) -> pd.DataFrame:
    selected = [row for row in rows if row["statement_type"] == statement_type
                and row["frequency"] == frequency]
    if not selected:
        return pd.DataFrame()
    # Newest period first: metric code reads column 0 as the latest period.
    periods = sorted({row["period_end"] for row in selected}, reverse=True)
    line_items = sorted({row["line_item"] for row in selected})
    values = {
        period: [
            next((row["value"] for row in selected
                  if row["line_item"] == item and row["period_end"] == period), None)
            for item in line_items
        ]
        for period in periods
    }
    return pd.DataFrame(values, index=line_items)


def load_statement_bundle(ticker: str) -> dict[str, object] | None:
    ticker = ticker.upper()
    with get_db() as conn:
        rows = conn.execute(
            """SELECT statement_type, frequency, period_end, line_item, value, fetched_at
               FROM corporate_statements WHERE ticker = ?""",
            (ticker,),
        ).fetchall()
        facts = conn.execute(
            "SELECT market_cap, shares_outstanding, currency FROM corporate_quote_facts WHERE ticker = ?",
            (ticker,),
        ).fetchone()

    if not rows:
        return None

    bundle: dict[str, object] = {"ticker": ticker}
    for key, statement_type, frequency in _BUNDLE_KEYS:
        bundle[key] = _frame(rows, statement_type, frequency)
    bundle["info"] = {
        "marketCap": facts["market_cap"] if facts else None,
        "sharesOutstanding": facts["shares_outstanding"] if facts else None,
        "currency": facts["currency"] if facts else "",
    }
    bundle["fetched_at"] = datetime.fromisoformat(rows[0]["fetched_at"])
    return bundle
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/api/acquisition/test_store.py -q`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/store.py tests/api/acquisition/test_store.py
git commit -m "feat: local statement store rebuilding the bundle metric code expects

load_statement_bundle returns exactly the dict shape
get_yahoo_statement_bundle returns today, so moving statements onto disk
changes no metric code. Periods are newest-first because metric code
reads column 0 as the latest period."
```

**Acceptance:** ✓ The bundle has the nine expected keys with DataFrame statements. ✓ Periods are newest first. ✓ A missing value round-trips as NaN, never 0. ✓ An unknown ticker returns `None`. ✓ Resaving replaces.

---

## Task 7: Metrics read the store, and the `TTLCache` is deleted

**Files:**
- Modify: `apps/api/services/corporate_statement_metrics.py` (the cache block near `:30`, and `get_yahoo_statement_bundle` at `:107`)
- Test: `tests/api/test_corporate_metric_audit.py`

**Interfaces:**
- Consumes: `load_statement_bundle` (Task 6).
- Produces: `get_yahoo_statement_bundle(ticker: str, endpoint: str) -> dict | None` with an unchanged signature, now reading locally.

**Context:** This task delivers the architectural invariant. After it, no metric path reaches the network.

Delete `YAHOO_STATEMENT_CACHE_TTL_SECONDS`, `YAHOO_STATEMENT_CACHE_MAXSIZE`, `_YAHOO_STATEMENT_CACHE`, the `cachetools` import if now unused, and the two invariant tests added in `0e4a3c1` (`test_statement_cache_ttl_outlives_one_full_sweep`, `test_statement_cache_holds_a_full_sweep_without_evicting_itself`) plus their `MEASURED_FULL_SWEEP_SECONDS` / `MEASURED_WATCHLIST_SIZE` constants — they pin a cache that no longer exists. Also delete the two existing tests that monkeypatch `sys.modules["yfinance"]` to exercise provider failures inside this function (`test_yahoo_statement_bundle_returns_none_for_known_provider_missing_data`, `test_yahoo_statement_bundle_does_not_hide_unexpected_provider_bug`): provider failure is now the source's concern and is covered by Task 3 and Task 4.

Keep the `cache.lookup` / `cache.hit` / `cache.miss` dev-monitor events — the store is still a cache, and the perf dashboard's `cache_effectiveness` panel reads them. A store hit is a `cache.hit`; a ticker with nothing stored is a `cache.miss`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_corporate_metric_audit.py`:

```python
def test_bundle_comes_from_the_local_store_and_never_the_network():
    """The architectural invariant: metric computation never acquires. The suite's
    _forbid_network guard fails any test that reaches out, so this passing IS the proof."""
    save_statements("LOCAL", [StatementRow("LOCAL", "income", "annual", "2025-09-30", "Total Revenue", 42.0)])

    bundle = get_yahoo_statement_bundle("LOCAL", "audit")

    assert bundle["income"].loc["Total Revenue", "2025-09-30"] == 42.0


def test_a_ticker_with_nothing_stored_returns_none():
    assert get_yahoo_statement_bundle("NEVERSTORED", "audit") is None


def test_the_same_stored_data_yields_identical_metrics_twice():
    """Reproducibility, stated in the spec: given identical locally stored acquisition
    data, metric computation always produces identical outputs regardless of process
    restart, network availability, or execution time. Within one process the strongest
    available check is that two computations over unchanged storage agree exactly."""
    save_statements("REPRO", [
        StatementRow("REPRO", "income", "annual", "2025-09-30", "Total Revenue", 100.0),
        StatementRow("REPRO", "income", "annual", "2024-09-30", "Total Revenue", 90.0),
    ])

    first = get_yahoo_statement_bundle("REPRO", "audit")
    second = get_yahoo_statement_bundle("REPRO", "audit")

    assert first["income"].equals(second["income"])
    assert first["info"] == second["info"]
```

Add `from apps.api.services.acquisition.store import save_statements` and
`from apps.api.services.acquisition.sources.statements import StatementRow` to the imports.

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/test_corporate_metric_audit.py -q`
Expected: FAIL — the first test fails because the function still calls yfinance, which the network guard blocks with `AssertionError: test resolved ...`.

- [ ] **Step 3: Rewrite the function**

Replace the body of `get_yahoo_statement_bundle` in `apps/api/services/corporate_statement_metrics.py`:

```python
def get_yahoo_statement_bundle(ticker: str, endpoint: str) -> Optional[dict[str, object]]:
    """Read the locally stored statement bundle.

    Metric computation never acquires: this reads what the acquisition layer stored and
    nothing else. A ticker with nothing stored returns None, which flows through the
    existing quality rules as a missing input rather than triggering a fetch.
    """
    ticker = ticker.upper()
    emit_cache_event(
        operation="cache.lookup",
        status="success",
        ticker=ticker,
        provider="local_store",
        component="corporate_statement_bundle",
        metadata={"endpoint": endpoint},
    )
    bundle = load_statement_bundle(ticker)
    if bundle is None:
        emit_cache_event(
            operation="cache.miss",
            status="cache_miss",
            ticker=ticker,
            provider="local_store",
            component="corporate_statement_bundle",
            metadata={"endpoint": endpoint, "source": "corporate_statements"},
        )
        logger.info("corporate.statement_store ticker=%s endpoint=%s stored=false", ticker, endpoint)
        return None

    emit_cache_event(
        operation="cache.hit",
        status="cache_hit",
        ticker=ticker,
        provider="local_store",
        component="corporate_statement_bundle",
        metadata={"endpoint": endpoint, "source": "corporate_statements"},
    )
    logger.info("corporate.statement_store ticker=%s endpoint=%s stored=true", ticker, endpoint)
    return bundle
```

Add `from apps.api.services.acquisition.store import load_statement_bundle` to the imports. Delete the cache constants, the `_YAHOO_STATEMENT_CACHE` object, the now-unused `cachetools` import, and the tests named in the Context block.

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/api/test_corporate_metric_audit.py -q`
Expected: PASS.

- [ ] **Step 5: Verify no metric path reaches the network**

Run: `python -m pytest tests/core_finance/ tests/api/ -q`
Expected: 0 failed. `_forbid_network` fails any test that reaches out, so a green suite is the invariant's proof.

Then confirm the cache is gone:

Run: `grep -rn "YAHOO_STATEMENT_CACHE\|TTLCache" apps/ tests/`
Expected: no output.

- [ ] **Step 6: Update `ERROR-LOG.md`**

The 2026-07-26 entry reads "Partially fixed 2026-07-28". Append to its Fix section:

```
Fully resolved 2026-07-28 by moving statements into the acquisition layer: the TTLCache
is deleted and the local store is the only cache, so the two-layers-with-different-
invalidation problem no longer exists. Options (b) and (c) are both satisfied -- bundles
persist to SQLite and survive restarts, and the comparison fan-out no longer requires
live statements.
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/corporate_statement_metrics.py tests/api/test_corporate_metric_audit.py ERROR-LOG.md
git commit -m "feat: metrics read statements from the local store, never the network

Delivers the architectural invariant: metric computation never performs
acquisition. The TTLCache is deleted rather than tuned -- the local store
is already a persistent cache, and keeping an in-memory layer above it
meant two caches with independently-wrong invalidation, which is the
defect recorded in ERROR-LOG.md on 2026-07-26.

The suite's _forbid_network guard fails any test that reaches out, so a
green suite is the proof that no metric path touches the network."
```

**Acceptance:** ✓ The bundle comes from SQLite. ✓ No `TTLCache` remains. ✓ The full suite is green with the network guard active. ✓ `ERROR-LOG.md` records the resolution.

---

## Task 8: Snapshots become manual-only

**Files:**
- Modify: `apps/api/main.py` (`lifespan`, and `corporate_snapshot_cycle` at `:81`)
- Modify: `apps/api/routes/corporate.py` (`ensure_corporate_comparison_daily_snapshot` at `:112`)
- Modify: `apps/api/services/corporate_comparison.py` (`build_corporate_comparison_response` at `:46-107`)
- Test: `tests/api/test_corporate_comparison.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `build_corporate_comparison_response` no longer writes.

**Context:** Three deletions. The important one is the fallback at `corporate_comparison.py:96-107`, where a read computes and persists a snapshot — up to a six-minute sweep inside a user's request that they never asked for.

`_snapshot_business_date()` is no longer consulted on the read path. `_load_latest_snapshot_response` already exists and returns the newest snapshot regardless of date; that becomes the only snapshot read.

Deleting `corporate_snapshot_cycle` leaves `stock_prewarm_cycle` as the only gated startup job. Keep `MONEYVIEW_DISABLE_STARTUP_JOBS` and its test file — it still gates prewarm.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_corporate_comparison.py`:

```python
def test_reading_a_comparison_never_writes_a_snapshot():
    """The deleted fallback: a read used to compute and persist a snapshot when today's
    was missing -- a multi-minute sweep inside a request the user never asked for."""
    with db_service.get_db() as conn:
        before = conn.execute("SELECT COUNT(*) AS n FROM corporate_comparison_snapshots_v3").fetchone()["n"]

    build_corporate_comparison_response(
        mode="snapshot",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **kwargs: pytest.fail("a read must not compute metrics"),
        price_loader=lambda ticker: 0.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    with db_service.get_db() as conn:
        after = conn.execute("SELECT COUNT(*) AS n FROM corporate_comparison_snapshots_v3").fetchone()["n"]
    assert after == before


def test_reading_with_no_snapshot_returns_an_empty_state():
    response = build_corporate_comparison_response(
        mode="snapshot",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **kwargs: pytest.fail("a read must not compute metrics"),
        price_loader=lambda ticker: 0.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    assert response.rows == []
    assert response.snapshot.snapshot_available is False


def test_the_lifespan_starts_no_snapshot_cycle():
    import apps.api.main as api_main

    assert not hasattr(api_main, "corporate_snapshot_cycle")
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_corporate_comparison.py -q`
Expected: FAIL — `pytest.fail("a read must not compute metrics")` fires, and the lifespan test finds the attribute.

- [ ] **Step 3: Rewrite the read path**

In `apps/api/services/corporate_comparison.py`, replace the snapshot branch of
`build_corporate_comparison_response` (everything after the `if mode == "live":` block) with:

```python
    # Reads never write. The former fallback computed and persisted a snapshot when today's
    # was missing, which put a multi-minute live sweep inside a request the user never made.
    # Snapshot creation is exclusively user-initiated now.
    latest = _load_latest_snapshot_response(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
        custom_tickers=custom_tickers,
    )
    if latest is not None:
        return latest
    return _empty_snapshot_response(
        comparison_universe=comparison_universe,
        benchmark_ticker=benchmark_ticker,
    )
```

`_empty_snapshot_response` is the existing empty-state construction at roughly `:245-255`; extract it into a named function if it is currently inline.

- [ ] **Step 4: Delete the automatic snapshot machinery**

In `apps/api/main.py`, delete `corporate_snapshot_cycle` entirely and remove it from `background` in `lifespan`, leaving:

```python
    background = [task_wal]
    if not startup_jobs_disabled:
        background.append(asyncio.create_task(stock_prewarm_cycle()))
```

In `apps/api/routes/corporate.py`, delete `ensure_corporate_comparison_daily_snapshot`. In
`apps/api/services/corporate_comparison.py`, delete `ensure_daily_snapshot_current`. Remove
imports left unused by those deletions.

- [ ] **Step 5: Run to verify they pass**

Run: `python -m pytest tests/core_finance/ tests/api/ -q`
Expected: 0 failed. Some existing snapshot tests will need updating where they relied on a
read materialising a snapshot — update them to create the snapshot explicitly first, which
is now the only way one exists.

- [ ] **Step 6: Commit**

```bash
git add apps/api/main.py apps/api/routes/corporate.py apps/api/services/corporate_comparison.py tests/api/test_corporate_comparison.py
git commit -m "feat: snapshot creation becomes exclusively user-initiated

Deletes the daily cycle, the ensure-current helpers, and the read-path
fallback that computed and persisted a snapshot when today's was missing
-- a multi-minute sweep inside a request the user never made.

A daily cadence also manufactured daily variation in quarterly
fundamentals, which finance-logic.md's opening principle prohibits, and
made snapshot-to-snapshot comparison meaningless."
```

**Acceptance:** ✓ A read never writes. ✓ No snapshot yields an explicit empty state. ✓ The lifespan starts no snapshot cycle. ✓ `mode=snapshot` returns the newest snapshot regardless of date.

---

## Task 9: `snapshot_id`, `metric_schema_version`, and the button

**Files:**
- Modify: `apps/api/services/db.py` (snapshot table)
- Modify: `apps/api/services/corporate_comparison.py` (`_snapshot_version_id` at `:993`, `save_corporate_comparison_snapshot`)
- Modify: `apps/api/routes/corporate.py` (`refresh_corporate_comparison_snapshot` at `:188`)
- Test: `tests/api/test_corporate_comparison.py`

**Interfaces:**
- Consumes: `acquire_point_in_time` (Task 5), `fetch_statements`/`fetch_quote_facts` (Tasks 3-4), `save_statements`/`save_quote_facts`/`statement_coverage` (Task 6).
- Produces: `METRIC_SCHEMA_VERSION: int` in `corporate_comparison.py`.

**Context:** `_snapshot_version_id` builds `"{business_date}|{universe_key}|{snapshot_taken_at}"` — an instance identifier, not a version of anything, and its business-date half is meaningless now. Rename to `snapshot_id` without the date component, and add a real `metric_schema_version` so two snapshots computed by different metric code are never silently compared as equivalent.

Add the columns with `ALTER TABLE ... ADD COLUMN` guarded the way the existing migration in
`init_db` does it (see the legacy `corporate_comparison_snapshots` migration that
`test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables` covers). Drop
`snapshot_versions_for_day` from the response model — "per day" no longer means anything.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_corporate_comparison.py`:

```python
def test_a_snapshot_records_the_metric_schema_version():
    """Snapshots are immutable and comparable. Two computed by different metric code are
    not like for like, and without this field that difference is invisible -- the
    comparison feature would blame the company for a change in the code."""
    save_corporate_comparison_snapshot(
        snapshot_source="manual",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=_stub_metrics_loader,
        price_loader=lambda ticker: 10.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    with db_service.get_db() as conn:
        row = conn.execute(
            "SELECT metric_schema_version, snapshot_id FROM corporate_comparison_snapshots_v3 LIMIT 1"
        ).fetchone()

    assert row["metric_schema_version"] == METRIC_SCHEMA_VERSION
    assert "|" in row["snapshot_id"]


def test_snapshots_are_immutable_a_second_save_adds_rather_than_updates():
    for _ in range(2):
        save_corporate_comparison_snapshot(
            snapshot_source="manual",
            comparison_universe="portfolio_plus_benchmark",
            benchmark_ticker="^GSPC",
            custom_tickers=[],
            metrics_loader=_stub_metrics_loader,
            price_loader=lambda ticker: 10.0,
            default_companies={},
            risk_free_rate=0.042,
            equity_risk_premium=0.055,
        )

    with db_service.get_db() as conn:
        ids = conn.execute(
            "SELECT DISTINCT snapshot_id FROM corporate_comparison_snapshots_v3"
        ).fetchall()

    assert len(ids) == 2
```

Define `_stub_metrics_loader` near the top of the file returning a fixed `CorporateMetrics`,
matching how existing tests in this file build one.

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/test_corporate_comparison.py -q`
Expected: FAIL with `sqlite3.OperationalError: no such column: metric_schema_version`.

- [ ] **Step 3: Add the columns and the version**

In `apps/api/services/db.py`, add `snapshot_id TEXT` and `metric_schema_version INTEGER NOT NULL DEFAULT 1` to `corporate_comparison_snapshots_v3`, plus the guarded `ALTER TABLE` migration for existing databases.

In `apps/api/services/corporate_comparison.py`:

```python
# Bumped by hand whenever metric SEMANTICS change -- a formula, a fallback, an input
# source. Not a database schema version and not a payload format version. It exists
# because snapshots are immutable and comparable: two computed by different metric code
# are not like for like, and the comparison feature must be able to see that.
METRIC_SCHEMA_VERSION = 1


def _snapshot_id(*, universe_key: str, snapshot_taken_at: str) -> str:
    return f"{snapshot_taken_at}|{universe_key}"
```

Delete `_snapshot_version_id`, `_count_snapshot_versions_for_day`, and the
`snapshot_versions_for_day` field from the response model and its call sites. Write
`snapshot_id` and `METRIC_SCHEMA_VERSION` on every inserted row.

- [ ] **Step 4: Wire the button to acquire first**

In `apps/api/routes/corporate.py`, in `refresh_corporate_comparison_snapshot`, before
computing:

```python
    # One button: refresh only the datasets whose freshness boundaries have expired, then
    # compute. Separate fetch and compute buttons would let a snapshot be generated from
    # statements the user forgot to refresh.
    now = datetime.now(timezone.utc)
    for ticker in _tickers_to_acquire(comparison_universe, benchmark_ticker, custom_tickers):
        acquire_point_in_time(
            "statements", ticker, now=now,
            fetcher=fetch_statements,
            saver=save_statements,
            coverage=statement_coverage,
        )
        acquire_point_in_time(
            "market_cap", ticker, now=now,
            fetcher=lambda subject: fetch_quote_facts(subject),
            saver=lambda subject, facts: save_quote_facts(subject, facts),
            coverage=lambda facts: (now.date(), now.date()),
        )
```

`_tickers_to_acquire` is a thin new helper in `corporate_comparison.py` that returns the
ticker strings for a universe. It must delegate to the existing
`_resolve_comparison_universe_rows(*, comparison_universe, benchmark_ticker, custom_tickers,
company_registry, watchlist_payload) -> list[dict]` at `corporate_comparison.py:896` and
read `row["ticker"]` from its result. Do not re-implement universe resolution: the
watchlist-weight fallback at `:914-916` (no positive weights means equal-weight the whole
watchlist) is subtle and must not be duplicated.

- [ ] **Step 5: Run to verify it passes**

Run: `python -m pytest tests/core_finance/ tests/api/ -q`
Expected: 0 failed.

- [ ] **Step 6: Update `guideline/sop/todo.md`**

Add a track recording: statements and market cap are acquisition data classes; metric
computation is network-free and the invariant that makes it so; snapshots are manual-only
and immutable; `metric_schema_version` must be bumped when metric semantics change; and
the deferred items — a filing-aware boundary, and `needs_acquisition` distinguishing
`FAILED` from `EMPTY` so a transient error does not suppress retry for a whole boundary.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/db.py apps/api/services/corporate_comparison.py apps/api/routes/corporate.py tests/api/test_corporate_comparison.py guideline/sop/todo.md
git commit -m "feat: snapshot identity, metric schema version, and the acquire-then-compute button

snapshot_version was an instance identifier carrying a business date that
means nothing once snapshots are manual. Split into snapshot_id and
metric_schema_version, the latter so two snapshots computed by different
metric code are never silently compared as like for like.

The button refreshes only datasets whose freshness boundaries expired,
then computes. In the common case no acquisition occurs."
```

**Acceptance:** ✓ Every snapshot row carries `snapshot_id` and `metric_schema_version`. ✓ A second save creates a new snapshot rather than updating one. ✓ The button acquires stale datasets then computes. ✓ `todo.md` records the invariant and the deferrals.

---

## Deliberate exclusions

Recorded so they are not mistaken for oversights:

- **A generic source protocol.** Two shapes exist after this plan — ranged and point-in-time. Extract when a third appears; with two, an abstraction would be guessing.
- **A filing-aware boundary.** `Weekly` bounds staleness to seven days. A per-ticker expected-next-filing date is the refinement.
- **`needs_acquisition` distinguishing `FAILED` from `EMPTY`.** A failure advances `last_checked_at`, so a transient error suppresses retry for a whole boundary — seven days under `Weekly`. Fixing it changes freshness for every data class and belongs in its own work.
- **Snapshot-to-snapshot comparison UI.** Enabled here, not built here.
- **Backfilling historical statements.** Only the periods yfinance currently reports are stored.
- **Migrating existing snapshot rows.** New columns default; old rows keep `metric_schema_version = 1`.
