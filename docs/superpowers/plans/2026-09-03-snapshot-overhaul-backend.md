# Snapshot Overhaul (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MoneyView a durable, annotated record of investment decisions with outcomes computed from stored bars, and stop the snapshot table accumulating duplicate versions.

**Architecture:** A new `investment_decision` table and `/api/v1/decisions` router, independent of the snapshot subsystem. Figures are copied into the decision by the **server** at record time via `_dcf_snapshot`, never sent by the client. Outcomes are computed on read from `stocks`, never stored. Separately, `_snapshot_version_id` becomes deterministic so a repeated write replaces in place instead of appending a version.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLite (stdlib `sqlite3`), pytest.

**Spec:** `docs/superpowers/specs/2026-09-03-snapshot-overhaul-design.md`

**Line numbers below were measured against `renewal` 3bdd3d0** (PRs #13, #14, #15
merged). If they no longer match, trust the named symbol over the number and
re-derive -- a stale line reference is exactly the drift this repo keeps finding.

## Scope of THIS plan

Backend only: §3, §4, §5 and §7 of the spec. The frontend (`/decisions` page and the §6 scatter chart) gets its own plan, written **after** this one ships, so it can be built against a real API response rather than an imagined one. Everything here is testable and useful without any UI — the API is exercisable directly.

## Global Constraints

Copied verbatim from the spec and from `.claude/CLAUDE.md`:

- **A passing test is not evidence.** Every new test must be shown to FAIL against a deliberately broken implementation, and to fail for the intended reason. See `guideline/sop/test-verification.md`. Each task below names its mutation.
- **`memo` is NOT NULL.** A decision without a stated reason is a snapshot.
- **Exactly one** of `figures_unavailable_reason` and the copied figures is populated.
- **No retention policy on decisions.** Snapshots expire at `SNAPSHOT_RETENTION_DAYS = 365`; decisions do not.
- **The client never sends figures.** `POST /api/v1/decisions` accepts `{ticker, action, memo}` and nothing else.
- **Outcomes are computed on read, never stored**, and always name both dates.
- **No accuracy metric, trend line or R²** anywhere. Gap-to-fair-value has no horizon; realized return does.
- **Never write to `data/processed/moneyview.db` from a test.** `tests/__init__.py` refuses it at import.
- Surgical changes only: do not reformat or "improve" adjacent code (`CLAUDE.md` §3).

---

### Task 1: Clear the three snapshot tables

**Files:**
- Create: `scripts/reset_snapshots.py`
- Test: `tests/scripts/test_reset_snapshots.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `reset_snapshots(conn) -> dict[str, int]` — table name to rows deleted.

- [ ] **Step 1: Write the failing test**

```python
# tests/scripts/test_reset_snapshots.py
from apps.api.services.db import get_db
from scripts.reset_snapshots import reset_snapshots

# The three tables named as LITERALS, deliberately NOT `set(SNAPSHOT_TABLES)`.
# Comparing the function's output against the same constant the function
# iterates is tautological: shrink the constant and both sides shrink together,
# so the assertion can never fail for the defect this test is named after. The
# first draft of this plan made exactly that mistake and the Task 1 mutation
# check caught it.
EXPECTED_SNAPSHOT_TABLES = {
    "corporate_comparison_snapshots",
    "corporate_comparison_snapshots_v2",
    "corporate_comparison_snapshots_v3",
}


def _seed(conn):
    conn.execute(
        "INSERT INTO corporate_comparison_snapshots_v3 "
        "(snapshot_version, snapshot_date, universe_key, snapshot_taken_at, ticker) "
        "VALUES ('v1', '2026-04-23', 'u', '2026-04-23T00:00:00+00:00', 'MSFT')"
    )


def test_reset_clears_every_snapshot_table_not_only_v3():
    """Clearing only _v3 would leave v1 rows behind and the clean start would be
    false: the live database holds 139 rows in `corporate_comparison_snapshots`
    and 880 in `_v3`."""
    with get_db() as conn:
        _seed(conn)
        deleted = reset_snapshots(conn)
        assert set(deleted) == EXPECTED_SNAPSHOT_TABLES, deleted
        assert deleted["corporate_comparison_snapshots_v3"] == 1
        for table in EXPECTED_SNAPSHOT_TABLES:
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def test_reset_leaves_non_snapshot_tables_alone():
    """A reset that also emptied `stocks` or `watchlist` would destroy
    re-fetchable market data and hand-curated holdings for no reason."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO watchlist (ticker, name, sector, group_name, weight) "
            "VALUES ('AAPL', 'Apple', 'Technology', 'core', 0.4)"
        )
        reset_snapshots(conn)
        assert conn.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/scripts/test_reset_snapshots.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.reset_snapshots'`

- [ ] **Step 3: Write minimal implementation**

Create `tests/scripts/__init__.py` (empty) if absent, then:

```python
# scripts/reset_snapshots.py
"""Clear every snapshot table, so the new dedupe rule starts from an empty slate.

All three are named deliberately. `_v3` holds 880 rows and is the live table, but
`corporate_comparison_snapshots` still holds 139 v1 rows; clearing only the live
one would leave those behind and the "clean start" would be false.

This is irreversible -- snapshot rows are point-in-time records that cannot be
regenerated, because their inputs have moved. Back the database up first.
"""
from __future__ import annotations

import sqlite3

SNAPSHOT_TABLES = (
    "corporate_comparison_snapshots",
    "corporate_comparison_snapshots_v2",
    "corporate_comparison_snapshots_v3",
)


def reset_snapshots(conn: sqlite3.Connection) -> dict[str, int]:
    """Delete every row from each snapshot table. Returns rows deleted per table."""
    deleted: dict[str, int] = {}
    for table in SNAPSHOT_TABLES:
        deleted[table] = conn.execute(f"DELETE FROM {table}").rowcount
    return deleted


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import shutil
    from pathlib import Path

    from apps.api.services.db import get_db, get_db_path

    source = get_db_path()
    backup = source.with_suffix(".db.pre-snapshot-reset")
    shutil.copy2(source, backup)
    print(f"backed up -> {backup}")
    with get_db() as connection:
        for name, count in reset_snapshots(connection).items():
            print(f"  {name}: {count} rows deleted")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/scripts/test_reset_snapshots.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Mutation-verify**

Edit `SNAPSHOT_TABLES` in `scripts/reset_snapshots.py` to contain only `"corporate_comparison_snapshots_v3"`.
Run the tests. Expected: `test_reset_clears_every_snapshot_table_not_only_v3` FAILS, because `deleted` now has one key and `EXPECTED_SNAPSHOT_TABLES` still names three. Restore the tuple and re-run; both pass.

> This step earns its keep: the first draft asserted against `set(SNAPSHOT_TABLES)`, which made the check tautological, and running the mutation is what exposed it.

- [ ] **Step 6: Commit**

```bash
git add scripts/reset_snapshots.py tests/scripts/
git commit -m "feat: add a snapshot reset that clears all three tables, not only v3"
```

---

### Task 2: The `investment_decision` table

**Files:**
- Modify: `apps/api/services/db.py` (append to `_CREATE_SCHEMA_SQL`, near the `valuation_case` block at :491)
- Test: `tests/api/test_investment_decision_store.py`

**Interfaces:**
- Consumes: `apps.api.services.db.init_db`, `get_db`.
- Produces: table `investment_decision` with the columns listed below.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_investment_decision_store.py
from apps.api.services.db import get_db

EXPECTED_COLUMNS = {
    "id", "ticker", "decided_at", "action", "memo",
    "price_at_decision", "dcf_value", "dcf_implied_return", "roic", "wacc",
    "risk_free_rate", "equity_risk_premium", "metric_schema_version",
    "figures_source", "figures_unavailable_reason",
}


def test_the_decision_table_exists_with_every_column_the_record_needs():
    with get_db() as conn:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(investment_decision)")}
    assert columns == EXPECTED_COLUMNS, columns


def test_memo_is_required_so_a_decision_cannot_decay_into_a_snapshot():
    """A decision without a stated reason is a snapshot, and snapshots already
    exist. The NOT NULL is the only thing stopping the feature regressing."""
    import sqlite3
    import pytest

    with get_db() as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO investment_decision "
                "(ticker, decided_at, action, memo, figures_source) "
                "VALUES ('AAPL', '2026-09-03T00:00:00+00:00', 'buy', NULL, 'test')"
            )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_investment_decision_store.py -v`
Expected: FAIL — `assert set() == {...}`, because `PRAGMA table_info` on a missing table returns no rows.

- [ ] **Step 3: Write minimal implementation**

Append inside the `_CREATE_SCHEMA_SQL` string in `apps/api/services/db.py`, after the `valuation_case` table:

```sql
CREATE TABLE IF NOT EXISTS investment_decision (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker                     TEXT NOT NULL,
    decided_at                 TEXT NOT NULL,   -- ISO-8601 UTC
    action                     TEXT NOT NULL,   -- buy | sell | watch | pass
    -- NOT NULL on purpose: a decision without a stated reason is a snapshot,
    -- and snapshots already exist. See the 2026-09-03 snapshot-overhaul spec.
    memo                       TEXT NOT NULL,
    -- Figures COPIED at record time, never a reference to a snapshot row:
    -- snapshots expire at SNAPSHOT_RETENTION_DAYS = 365 and metric definitions
    -- change, so a reference would be reinterpreted later. A copy is a fixed
    -- record of what was actually believed.
    price_at_decision          REAL,
    dcf_value                  REAL,
    dcf_implied_return         REAL,
    roic                       REAL,
    wacc                       REAL,
    risk_free_rate             REAL,
    equity_risk_premium        REAL,
    metric_schema_version      INTEGER,
    figures_source             TEXT NOT NULL,
    -- Populated INSTEAD of the figures when the model cannot value the ticker.
    -- Exactly one side is ever set. A refusal is content, not an error -- the
    -- same rule valuation_verdict.py follows per signal.
    figures_unavailable_reason TEXT
);
-- No retention policy, deliberately. Snapshots expire; decisions do not.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_investment_decision_store.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Mutation-verify**

Change `memo TEXT NOT NULL` to `memo TEXT`. Run the tests. Expected: `test_memo_is_required_so_a_decision_cannot_decay_into_a_snapshot` FAILS with `DID NOT RAISE <class 'sqlite3.IntegrityError'>`. Restore and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/db.py tests/api/test_investment_decision_store.py
git commit -m "feat: add the investment_decision table"
```

---

### Task 3: Outcome arithmetic

**Files:**
- Create: `apps/api/services/investment_decision.py`
- Test: `tests/api/test_investment_decision_outcome.py`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `outcome_for(decided_at: str, price_at_decision: float | None, bars: list[dict]) -> dict` returning keys `price_now`, `price_date`, `price_move`, `reason`.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_investment_decision_outcome.py
import pytest

from apps.api.services.investment_decision import outcome_for


def _bars(pairs):
    return [{"date": d, "close": c} for d, c in pairs]


def test_the_move_is_measured_from_the_decision_price_and_names_both_dates():
    outcome = outcome_for(
        decided_at="2026-01-10T00:00:00+00:00",
        price_at_decision=100.0,
        bars=_bars([("2026-01-09", 90.0), ("2026-01-12", 110.0), ("2026-02-01", 120.0)]),
    )
    assert outcome["reason"] is None, outcome
    assert outcome["price_now"] == 120.0
    assert outcome["price_date"] == "2026-02-01"
    assert outcome["price_move"] == pytest.approx(0.20)
    # The period must be stated, not implied: a bare percentage invites the
    # reader to supply a horizon the number does not have.
    assert outcome["decided_on"] == "2026-01-10"


def test_a_bar_before_the_decision_cannot_be_the_outcome():
    """The only bar is older than the decision, so there is no move to report.
    Returning the stale close would date the outcome before its own cause."""
    outcome = outcome_for(
        decided_at="2026-01-10T00:00:00+00:00",
        price_at_decision=100.0,
        bars=_bars([("2026-01-09", 90.0)]),
    )
    assert outcome["price_move"] is None
    assert "no bar" in outcome["reason"]


def test_no_outcome_without_a_decision_price():
    """A decision recorded with figures_unavailable_reason has no price to
    measure from, so it refuses rather than reporting a move against zero."""
    outcome = outcome_for(
        decided_at="2026-01-10T00:00:00+00:00",
        price_at_decision=None,
        bars=_bars([("2026-02-01", 120.0)]),
    )
    assert outcome["price_move"] is None
    assert "no price" in outcome["reason"]


def test_a_null_close_is_skipped_rather_than_ending_the_series():
    """load_price_bars passes NULL closes through verbatim; the newest bar may
    carry one, and float(None) would raise inside the panel."""
    outcome = outcome_for(
        decided_at="2026-01-10T00:00:00+00:00",
        price_at_decision=100.0,
        bars=_bars([("2026-02-01", 120.0), ("2026-02-02", None)]),
    )
    assert outcome["price_now"] == 120.0
    assert outcome["price_date"] == "2026-02-01"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_investment_decision_outcome.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.investment_decision'`

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/services/investment_decision.py
"""Investment decisions: a durable, annotated record of what was believed and when.

Distinct from a snapshot, on purpose. Snapshots are telemetry over a universe and
expire at SNAPSHOT_RETENTION_DAYS = 365; a decision is one judgement about one
ticker and never expires. See docs/superpowers/specs/2026-09-03-snapshot-overhaul-design.md.
"""
from __future__ import annotations


def outcome_for(
    *,
    decided_at: str,
    price_at_decision: float | None,
    bars: list[dict],
) -> dict:
    """The price move since a decision, computed fresh from stored bars.

    Never stored. A persisted outcome is correct only until the next bar arrives
    and then silently wrong, with nothing to reveal it; computing on read cannot
    go stale.

    Both dates travel with the number because the move has a period and the
    figure it will sit beside -- gap to fair value -- does not. Reporting a bare
    percentage would invite the reader to supply a horizon that is not there.
    """
    decided_on = decided_at[:10]
    empty = {
        "decided_on": decided_on,
        "price_now": None,
        "price_date": None,
        "price_move": None,
        "reason": None,
    }
    if price_at_decision is None or price_at_decision <= 0:
        return {**empty, "reason": "no price recorded at decision time"}

    # A NULL close is not a price. `load_price_bars` documents that close passes
    # through exactly as stored, including NULL, and the caller must handle it.
    usable = [
        (str(bar["date"]), float(bar["close"]))
        for bar in bars
        if bar.get("close") is not None and str(bar["date"]) > decided_on
    ]
    if not usable:
        return {**empty, "reason": f"no bar with a close after {decided_on}"}

    price_date, price_now = usable[-1]
    return {
        "decided_on": decided_on,
        "price_now": price_now,
        "price_date": price_date,
        "price_move": (price_now - price_at_decision) / price_at_decision,
        "reason": None,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_investment_decision_outcome.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Mutation-verify**

Change `if bar.get("close") is not None and str(bar["date"]) > decided_on` to drop the date comparison (`if bar.get("close") is not None`). Run the tests. Expected: `test_a_bar_before_the_decision_cannot_be_the_outcome` FAILS, because the stale 2026-01-09 bar is now returned as the outcome. Restore and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/investment_decision.py tests/api/test_investment_decision_outcome.py
git commit -m "feat: compute a decision's outcome from stored bars, on read"
```

---

### Task 4: Recording a decision, with server-captured figures

**Files:**
- Modify: `apps/api/services/investment_decision.py`
- Test: `tests/api/test_investment_decision_record.py`

**Interfaces:**
- Consumes: `outcome_for` (Task 3); `apps.api.services.corporate_metrics_service.metrics_for_ticker`, `.latest_market_price`; `apps.api.services.corporate_comparison._dcf_snapshot`, `.METRIC_SCHEMA_VERSION`.
- Produces: `record_decision(*, ticker, action, memo, risk_free_rate=4.2, equity_risk_premium=5.5, figures_loader=None) -> int` (the new row id).

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_investment_decision_record.py
import pytest

from apps.api.services.db import get_db
from apps.api.services.investment_decision import record_decision


def _figures_ok(ticker):
    return {
        "price_at_decision": 431.65,
        "dcf_value": 379.39,
        "dcf_implied_return": -12.11,
        "roic": 29.64,
        "wacc": 9.92,
        "source": "corporate_comparison._dcf_snapshot",
    }


def _figures_refused(ticker):
    raise ValueError(f"no usable metrics for {ticker}")


def _row(decision_id):
    with get_db() as conn:
        return dict(
            conn.execute(
                "SELECT * FROM investment_decision WHERE id = ?", (decision_id,)
            ).fetchone()
        )


def test_the_figures_are_captured_by_the_server_not_supplied_by_the_caller():
    """record_decision takes no figure arguments at all. A browser-posted number
    could be stale or rounded for display and would be stored as what the user
    believed, undetectably."""
    decision_id = record_decision(
        ticker="MSFT", action="buy", memo="cheap on FCF", figures_loader=_figures_ok
    )
    row = _row(decision_id)
    assert row["price_at_decision"] == 431.65
    assert row["dcf_value"] == 379.39
    assert row["figures_source"] == "corporate_comparison._dcf_snapshot"
    assert row["figures_unavailable_reason"] is None


def test_a_decision_is_recorded_even_when_the_model_cannot_value_the_ticker():
    """Otherwise the feature refuses to record decisions about exactly the
    companies the model finds hardest -- the ones a memo is most worth having."""
    decision_id = record_decision(
        ticker="NEWCO", action="watch", memo="pre-revenue, watching",
        figures_loader=_figures_refused,
    )
    row = _row(decision_id)
    assert row["memo"] == "pre-revenue, watching"
    assert row["price_at_decision"] is None
    assert "no usable metrics for NEWCO" in row["figures_unavailable_reason"]


def test_exactly_one_of_figures_and_refusal_is_ever_populated():
    ok = _row(record_decision(ticker="MSFT", action="buy", memo="m", figures_loader=_figures_ok))
    refused = _row(record_decision(ticker="X", action="pass", memo="m", figures_loader=_figures_refused))
    assert (ok["price_at_decision"] is None) != (ok["figures_unavailable_reason"] is None)
    assert (refused["price_at_decision"] is None) != (refused["figures_unavailable_reason"] is None)


def test_an_unknown_action_is_refused():
    with pytest.raises(ValueError, match="action"):
        record_decision(ticker="MSFT", action="hodl", memo="m", figures_loader=_figures_ok)


def test_an_empty_memo_is_refused_before_it_reaches_the_database():
    with pytest.raises(ValueError, match="memo"):
        record_decision(ticker="MSFT", action="buy", memo="   ", figures_loader=_figures_ok)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_investment_decision_record.py -v`
Expected: FAIL — `ImportError: cannot import name 'record_decision'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/services/investment_decision.py`:

```python
from datetime import datetime, timezone

from apps.api.services.db import get_db

ACTIONS = ("buy", "sell", "watch", "pass")

# Defaults matching the assumptions the comparison table ships with.
DEFAULT_RISK_FREE_RATE = 4.2
DEFAULT_EQUITY_RISK_PREMIUM = 5.5


def _default_figures_loader(ticker: str) -> dict:
    """Capture the model's view of `ticker` right now, from the same function
    that produces the comparison table's figures."""
    from apps.api.services import corporate_metrics_service
    from apps.api.services.corporate_comparison import _dcf_snapshot

    metrics = corporate_metrics_service.metrics_for_ticker(ticker)
    dcf = _dcf_snapshot(
        ticker=ticker,
        metrics=metrics,
        price_loader=corporate_metrics_service.latest_market_price,
        risk_free_rate=DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=DEFAULT_EQUITY_RISK_PREMIUM,
    )
    return {
        "price_at_decision": float(dcf["current_price"]),
        "dcf_value": float(dcf["estimated_value"]),
        "dcf_implied_return": float(dcf["dcf_implied_return"]),
        "roic": round(float(metrics.roic), 2),
        "wacc": round(float(metrics.wacc), 2),
        "source": "corporate_comparison._dcf_snapshot",
    }


def record_decision(
    *,
    ticker: str,
    action: str,
    memo: str,
    risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
    equity_risk_premium: float = DEFAULT_EQUITY_RISK_PREMIUM,
    figures_loader=None,
) -> int:
    """Persist one decision, capturing the model's figures HERE rather than
    accepting them from the caller.

    A figure supplied by a browser could be stale, rounded for display, or read
    from a page opened an hour earlier, and would be stored as what the user
    believed with no way to tell the difference later. Capturing server-side
    makes the record self-certifying; `figures_source` names where it came from.
    """
    from apps.api.services.corporate_comparison import METRIC_SCHEMA_VERSION

    ticker = ticker.upper().strip()
    if action not in ACTIONS:
        raise ValueError(f"action must be one of {', '.join(ACTIONS)}, got {action!r}")
    if not memo.strip():
        raise ValueError("memo is required: a decision without a stated reason is a snapshot")

    loader = figures_loader or _default_figures_loader
    figures: dict | None = None
    unavailable: str | None = None
    try:
        figures = loader(ticker)
    except (ValueError, KeyError, TypeError) as exc:
        # The model could not value this ticker. Record the decision anyway with
        # the reason in place of the numbers -- refusing outright would drop the
        # memo, which is the part that cannot be reconstructed later.
        unavailable = str(exc)

    with get_db() as conn:
        cursor = conn.execute(
            """INSERT INTO investment_decision
               (ticker, decided_at, action, memo, price_at_decision, dcf_value,
                dcf_implied_return, roic, wacc, risk_free_rate, equity_risk_premium,
                metric_schema_version, figures_source, figures_unavailable_reason)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ticker,
                datetime.now(timezone.utc).isoformat(),
                action,
                memo.strip(),
                (figures or {}).get("price_at_decision"),
                (figures or {}).get("dcf_value"),
                (figures or {}).get("dcf_implied_return"),
                (figures or {}).get("roic"),
                (figures or {}).get("wacc"),
                risk_free_rate if figures else None,
                equity_risk_premium if figures else None,
                METRIC_SCHEMA_VERSION if figures else None,
                (figures or {}).get("source", "unavailable"),
                unavailable,
            ),
        )
        return int(cursor.lastrowid)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_investment_decision_record.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Mutation-verify**

Replace the `try/except` around `loader(ticker)` with a bare `figures = loader(ticker)`. Run the tests. Expected: `test_a_decision_is_recorded_even_when_the_model_cannot_value_the_ticker` FAILS with the raised `ValueError` escaping. Restore and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/investment_decision.py tests/api/test_investment_decision_record.py
git commit -m "feat: record a decision with server-captured figures"
```

---

### Task 5: Reading decisions with their outcomes

**Files:**
- Modify: `apps/api/services/investment_decision.py`
- Test: `tests/api/test_investment_decision_read.py`

**Interfaces:**
- Consumes: `outcome_for` (Task 3), `record_decision` (Task 4).
- Produces: `list_decisions(*, bars_loader=load_price_bars) -> list[dict]` — newest first, each with an `outcome` key.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_investment_decision_read.py
import pytest

from apps.api.services.investment_decision import list_decisions, record_decision


def _figures(ticker):
    return {
        "price_at_decision": 100.0, "dcf_value": 150.0, "dcf_implied_return": 50.0,
        "roic": 20.0, "wacc": 10.0, "source": "test",
    }


def _bars(ticker, limit=None):
    return [{"date": "2026-12-31", "close": 120.0}]


def test_each_decision_carries_an_outcome_computed_from_bars():
    record_decision(ticker="MSFT", action="buy", memo="m", figures_loader=_figures)
    rows = list_decisions(bars_loader=_bars)
    assert len(rows) == 1
    outcome = rows[0]["outcome"]
    assert outcome["price_move"] == pytest.approx(0.20)
    assert outcome["price_date"] == "2026-12-31"
    assert outcome["reason"] is None


def test_the_gap_at_decision_is_returned_beside_the_move_but_never_combined():
    """Two separately labelled figures. dcf_implied_return has no horizon and the
    move does, so no ratio, difference or accuracy score between them is emitted."""
    record_decision(ticker="MSFT", action="buy", memo="m", figures_loader=_figures)
    row = list_decisions(bars_loader=_bars)[0]
    assert row["dcf_implied_return"] == 50.0
    assert row["outcome"]["price_move"] == pytest.approx(0.20)
    forbidden = {"accuracy", "error", "residual", "predicted_vs_realized", "score"}
    assert not (forbidden & set(row)), row.keys()


def test_decisions_come_back_newest_first():
    record_decision(ticker="AAA", action="buy", memo="first", figures_loader=_figures)
    record_decision(ticker="BBB", action="buy", memo="second", figures_loader=_figures)
    assert [r["ticker"] for r in list_decisions(bars_loader=_bars)] == ["BBB", "AAA"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_investment_decision_read.py -v`
Expected: FAIL — `ImportError: cannot import name 'list_decisions'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/services/investment_decision.py`:

```python
from apps.api.services.acquisition.store import load_price_bars


def list_decisions(*, bars_loader=load_price_bars) -> list[dict]:
    """Every decision, newest first, each with a freshly computed outcome.

    `bars_loader` is injected so the whole path is testable without the store.
    The outcome is NOT persisted -- see `outcome_for`.
    """
    with get_db() as conn:
        rows = [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM investment_decision ORDER BY decided_at DESC, id DESC"
            )
        ]
    for row in rows:
        row["outcome"] = outcome_for(
            decided_at=str(row["decided_at"]),
            price_at_decision=row["price_at_decision"],
            bars=bars_loader(str(row["ticker"])),
        )
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_investment_decision_read.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Mutation-verify**

Add `row["accuracy"] = row["dcf_implied_return"] - row["outcome"]["price_move"] * 100` before the `return rows`. Run the tests. Expected: `test_the_gap_at_decision_is_returned_beside_the_move_but_never_combined` FAILS on the forbidden-keys assertion. Remove the line and re-run. This mutation is the spec's §6 rule made executable.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/investment_decision.py tests/api/test_investment_decision_read.py
git commit -m "feat: list decisions with outcomes computed on read"
```

---

### Task 6: The `/api/v1/decisions` router

**Files:**
- Create: `apps/api/models/schema_parts/decision.py`
- Create: `apps/api/routes/decisions.py`
- Modify: `apps/api/models/schemas.py` (re-export), `apps/api/main.py` (register the router, beside the other `include_router` calls at :180-189)
- Test: `tests/api/test_decision_routes.py`

**Interfaces:**
- Consumes: `record_decision`, `list_decisions`.
- Produces: `POST /api/v1/decisions`, `GET /api/v1/decisions`.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_decision_routes.py
from fastapi.testclient import TestClient

from apps.api.main import app

client = TestClient(app)


def test_posting_a_decision_returns_its_id_and_it_comes_back_on_the_list():
    response = client.post(
        "/api/v1/decisions",
        json={"ticker": "MSFT", "action": "watch", "memo": "waiting for a better price"},
    )
    assert response.status_code == 200, response.text
    decision_id = response.json()["data"]["id"]
    assert decision_id > 0

    listed = client.get("/api/v1/decisions").json()["data"]
    assert [row["id"] for row in listed] == [decision_id]
    assert listed[0]["memo"] == "waiting for a better price"


def test_the_route_refuses_figures_supplied_by_the_client():
    """The request model forbids extra fields, so a client cannot smuggle in a
    price and have it stored as what the model said."""
    response = client.post(
        "/api/v1/decisions",
        json={"ticker": "MSFT", "action": "buy", "memo": "m", "price_at_decision": 1.0},
    )
    assert response.status_code == 422, response.text


def test_an_empty_memo_is_a_422_naming_the_field():
    response = client.post(
        "/api/v1/decisions", json={"ticker": "MSFT", "action": "buy", "memo": "  "}
    )
    assert response.status_code == 422
    assert "memo" in response.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_decision_routes.py -v`
Expected: FAIL — the POST returns 404, because the router is not registered.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/models/schema_parts/decision.py
from pydantic import BaseModel, ConfigDict, Field, field_validator


class DecisionInput(BaseModel):
    # extra="forbid" is the contract: the server captures the figures, so a
    # client that sends one is making a mistake worth surfacing as a 422 rather
    # than silently dropping.
    model_config = ConfigDict(extra="forbid")

    ticker: str = Field(min_length=1)
    action: str
    memo: str

    @field_validator("memo")
    @classmethod
    def memo_must_say_something(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("memo is required: a decision without a reason is a snapshot")
        return value


class DecisionCreated(BaseModel):
    id: int


class DecisionOutcome(BaseModel):
    decided_on: str
    price_now: float | None = None
    price_date: str | None = None
    price_move: float | None = None
    reason: str | None = None


class DecisionRow(BaseModel):
    id: int
    ticker: str
    decided_at: str
    action: str
    memo: str
    price_at_decision: float | None = None
    dcf_value: float | None = None
    dcf_implied_return: float | None = None
    roic: float | None = None
    wacc: float | None = None
    figures_source: str
    figures_unavailable_reason: str | None = None
    outcome: DecisionOutcome
```

```python
# apps/api/routes/decisions.py
"""Investment decisions: what was believed about a ticker, when, and why.

The figures are captured by the server (see `record_decision`); this router
never accepts them from the caller.
"""
from fastapi import APIRouter, Body, HTTPException

from apps.api.models.schema_parts.common import APIResponse
from apps.api.models.schema_parts.decision import (
    DecisionCreated,
    DecisionInput,
    DecisionRow,
)
from apps.api.services.investment_decision import list_decisions, record_decision

router = APIRouter()


@router.post("", response_model=APIResponse[DecisionCreated])
def create_decision(payload: DecisionInput = Body(...)):
    try:
        decision_id = record_decision(
            ticker=payload.ticker, action=payload.action, memo=payload.memo
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return APIResponse(data=DecisionCreated(id=decision_id))


@router.get("", response_model=APIResponse[list[DecisionRow]])
def get_decisions():
    return APIResponse(data=[DecisionRow(**row) for row in list_decisions()])
```

In `apps/api/main.py`, beside the existing `include_router` calls:

```python
from apps.api.routes.decisions import router as decisions_router
app.include_router(decisions_router, prefix="/api/v1/decisions", tags=["Decisions"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_decision_routes.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Mutation-verify**

Change `model_config = ConfigDict(extra="forbid")` to `ConfigDict(extra="ignore")`. Run the tests. Expected: `test_the_route_refuses_figures_supplied_by_the_client` FAILS (200 instead of 422). Restore and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/api/models/schema_parts/decision.py apps/api/routes/decisions.py \
        apps/api/models/schemas.py apps/api/main.py tests/api/test_decision_routes.py
git commit -m "feat: add the /api/v1/decisions router"
```

---

### Task 7: Snapshot dedupe on write

**Files:**
- Modify: `apps/api/services/corporate_comparison.py` — `_snapshot_version_id` at :1039, and its call site at :180
- Test: `tests/api/test_corporate_comparison.py` (append)

**Interfaces:**
- Consumes: `METRIC_SCHEMA_VERSION`, `_comparison_universe_key`.
- Produces: `_snapshot_version_id(*, universe_key, snapshot_date, risk_free_rate, equity_risk_premium) -> str` — note the **signature change**: `snapshot_taken_at` is gone.

- [ ] **Step 1: Write the failing test**

```python
# append to tests/api/test_corporate_comparison.py
def test_repeating_a_snapshot_with_unchanged_assumptions_does_not_add_a_version():
    """The live table holds 8 versions of 2026-04-23, seven from clicking
    refresh. Crucially MSFT and IAUM are byte-identical across all of them and
    only the benchmark ^GSPC ticks, so a rule comparing OUTPUT figures would
    have caught 3 of 8. This keys on inputs instead."""
    first = _snapshot_version_id(
        universe_key="portfolio_plus_benchmark|^GSPC|",
        snapshot_date="2026-04-23",
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    again = _snapshot_version_id(
        universe_key="portfolio_plus_benchmark|^GSPC|",
        snapshot_date="2026-04-23",
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    assert first == again, "a repeated click must reuse the version, not append one"


def test_a_changed_assumption_creates_a_new_version():
    base = dict(
        universe_key="portfolio_plus_benchmark|^GSPC|",
        snapshot_date="2026-04-23",
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    assert _snapshot_version_id(**base) != _snapshot_version_id(**{**base, "risk_free_rate": 0.045})
    assert _snapshot_version_id(**base) != _snapshot_version_id(**{**base, "snapshot_date": "2026-04-24"})
    assert _snapshot_version_id(**base) != _snapshot_version_id(
        **{**base, "universe_key": "custom|^KS11|NVDA"}
    )


def test_the_version_carries_no_timestamp():
    """A timestamp component is what made every click a new version."""
    version = _snapshot_version_id(
        universe_key="u", snapshot_date="2026-04-23",
        risk_free_rate=0.042, equity_risk_premium=0.055,
    )
    assert "T" not in version.replace("2026-04-23", ""), version
```

Add `_snapshot_version_id` to the existing import block from `apps.api.services.corporate_comparison`.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_corporate_comparison.py -k "version" -v`
Expected: FAIL — `TypeError: _snapshot_version_id() got an unexpected keyword argument 'snapshot_date'`

- [ ] **Step 3: Write minimal implementation**

Replace `_snapshot_version_id` (`corporate_comparison.py:1039`):

```python
def _snapshot_version_id(
    *,
    universe_key: str,
    snapshot_date: str,
    risk_free_rate: float,
    equity_risk_premium: float,
) -> str:
    """A DETERMINISTIC snapshot identity, so a repeated write replaces in place.

    The previous identity embedded `snapshot_taken_at`, which made every click a
    new version: the live table holds 8 versions of 2026-04-23, seven of them
    from refreshing within about three minutes.

    Dedupe keys on INPUTS -- day, universe, assumptions, metric schema -- not on
    the output figures. Across those 8 versions MSFT and IAUM are byte-identical
    and only the benchmark ^GSPC moves, by pennies, so an output comparison would
    have suppressed 3 of 8 and let a tick on a ticker nobody was looking at
    defeat it.

    Renaming this field to `snapshot_id` is still deferred: it is a query
    parameter on two routes and an identity key across five frontend files.
    """
    # The assumptions arrive as DECIMALS (0.042) and are stored as rounded
    # percentages (`round(risk_free_rate * 100, 2)` at :203). The key uses the
    # stored form: a raw float would put 0.042000000000000003 in an identity
    # string, and two runs that agree could then disagree.
    return (
        f"{snapshot_date}|{universe_key}"
        f"|rf={round(risk_free_rate * 100, 2)}|erp={round(equity_risk_premium * 100, 2)}"
        f"|schema={METRIC_SCHEMA_VERSION}"
    )
```

At the call site (`:180`), pass the new arguments — `snapshot_date` is already computed on the line below it, so move that computation above the call:

```python
    snapshot_date = _snapshot_business_date()
    snapshot_version = _snapshot_version_id(
        universe_key=universe_key,
        snapshot_date=snapshot_date,
        risk_free_rate=risk_free_rate,
        equity_risk_premium=equity_risk_premium,
    )
```

**The write is a plain `INSERT` today** (`:185`). With a deterministic version and
the primary key `(snapshot_version, ticker)`, a second click would raise
`sqlite3.IntegrityError: UNIQUE constraint failed`. Change that one word:

```python
                """INSERT OR REPLACE INTO corporate_comparison_snapshots_v3 (
```

Then delete rows for that version whose ticker has left the universe, so a
shrinking universe leaves no orphans. There is no `tickers` variable in scope --
the loop iterates `response.rows` -- so build one:

```python
        live_tickers = [row.ticker for row in response.rows]
        conn.execute(
            "DELETE FROM corporate_comparison_snapshots_v3 "
            "WHERE snapshot_version = ? AND ticker NOT IN "
            f"({','.join('?' * len(live_tickers))})",
            (snapshot_version, *live_tickers),
        )
```

**Keep the `snapshot_taken_at` variable.** It is still written to its own column
(`:197`); only the version *identifier* drops it.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_corporate_comparison.py -v`
Expected: PASS — all tests, including the 35 already there.

- [ ] **Step 5: Mutation-verify**

Append `f"|{snapshot_taken_at}"` to the returned string (adding the parameter back). Run the tests. Expected: `test_repeating_a_snapshot_with_unchanged_assumptions_does_not_add_a_version` FAILS on `first == again`. Restore and re-run.

- [ ] **Step 6: Run the whole suite and commit**

Run: `python -m pytest -q`
Expected: PASS, no failures. (`test_perf_cpu_wait_split.py::test_a_sleeping_span_reports_almost_no_cpu` is a known pre-existing timing flake under load — if it fails, re-run it alone and leave it alone.)

```bash
git add apps/api/services/corporate_comparison.py tests/api/test_corporate_comparison.py
git commit -m "fix: make the snapshot version deterministic so a refresh replaces in place"
```

---

## Task 8: Run the reset and update the todo

**Files:**
- Modify: `guideline/sop/todo.md`

- [ ] **Step 1: Back up and run the reset**

```bash
python scripts/reset_snapshots.py
```

Expected output names each of the three tables and its deleted row count (139, 0, 880 on the current database), plus the backup path.

- [ ] **Step 2: Verify**

```bash
python -c "import sqlite3; c=sqlite3.connect('file:data/processed/moneyview.db?mode=ro',uri=True); print([(t, c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]) for t in ('corporate_comparison_snapshots','corporate_comparison_snapshots_v2','corporate_comparison_snapshots_v3')])"
```
Expected: every count `0`. Confirm `stocks` and `watchlist` are untouched.

- [ ] **Step 3: Add a Track E section to `guideline/sop/todo.md`** recording what shipped, what the deferred items are (§9 of the spec), and that the frontend plan is still to be written.

- [ ] **Step 4: Commit**

```bash
git add guideline/sop/todo.md
git commit -m "docs: record the snapshot overhaul backend in the todo"
```

---

## Self-Review

**Spec coverage:** §3 data model → Task 2. §3.1 copied figures → Task 4. §3.2 memo NOT NULL → Tasks 2, 4, 6. §3.3 refusal path → Task 4. §3.4 no retention → Task 2 (comment). §4 recording → Tasks 4, 6. §4.1 outcomes on read → Tasks 3, 5. §5 dedupe → Task 7. §5.1 deterministic key → Task 7. §6 visualization → **deferred to the frontend plan**; the API half (two separate figures, no combined metric) is Task 5, enforced by its mutation. §7 reset → Tasks 1, 8. §8 verification → every task's Step 5.

**Placeholder scan:** none. Every code step contains runnable code; every mutation names the exact edit and the exact expected failure.

**Type consistency:** `outcome_for` returns `decided_on`/`price_now`/`price_date`/`price_move`/`reason` in Task 3, consumed under those names in Task 5 and modelled as `DecisionOutcome` with the same five fields in Task 6. `record_decision` returns `int`, used as `decision_id` in Task 6. `figures_loader` returns the six keys `_default_figures_loader` produces, matching the test doubles in Tasks 4 and 5. `_snapshot_version_id`'s new keyword-only signature is used identically in Task 7's test and call site.

**Three assumptions checked against the source rather than left to the implementer:** the snapshot write is a plain `INSERT`, not `INSERT OR REPLACE` (`:185`) — so a deterministic version would raise `IntegrityError` on the second click unless that word changes; there is no `tickers` variable in scope at the delete site, since the loop iterates `response.rows`; and the assumption columns are stored as rounded percentages (`:203`), so the version key uses that form rather than the raw decimal. Task 7 reflects all three.
