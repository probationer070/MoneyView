# DCF Data Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed the enterprise-to-equity bridge from locally stored statements so the DCF and the corporate comparison report an intrinsic per-share value instead of enterprise value wearing a per-share label.

**Architecture:** One new pure formula in `packages/core_finance/dcf.py`, one new service module `apps/api/services/equity_bridge.py` that reads the already-stored statement bundle and emits three `BridgeInputMeta` records, then three consumers wired to it: `corporate_dcf`, `corporate_comparison`, and the `Total Debt` extraction in `corporate_statement_metrics`. No acquisition, no network, no new table.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pandas, SQLite, pytest.

**Spec:** `docs/superpowers/specs/2026-08-03-dcf-data-completeness-design.md`

## Global Constraints

- **Read the SOPs.** `guideline/sop/finance-logic.md` before any formula change; `guideline/sop/code-reviewer.md` before each commit.
- **Missing values stay missing.** Never substitute `0.0` or `""` for an absent financial input. A missing cash balance is not a zero cash balance.
- **No network in tests.** Every test injects a loader. `yfinance` must not be reachable from any test in this plan.
- **Backend suite must end at ≥418 passed.** That is the current baseline; this plan adds tests, so the final number will be higher.
- **`npx tsc --noEmit` from `apps/web` must exit 0.** No frontend source changes in this plan, but the check must still pass.
- **No frontend unit-test runner.** No Jest, Vitest, or Testing Library. Playwright only.
- **Units: billions.** Every figure crossing into the bridge is divided by `1e9` at read time. `enterprise_value`, `equity_value` and `net_debt` are all in billions; `diluted_shares_outstanding` is in billions of shares; the quotient is dollars per share.
- **Quality vocabulary:** `ok` < `estimated` < `missing`. Reuse `_pick_worst_quality` from `apps/api/services/corporate_statement_metrics.py:869`. Never emit `stale`, `suspicious` or `invalid` from the bridge.
- **Commit message trailer**, on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **PowerShell here-string caveat:** a `git commit -m` message containing double quotes breaks argument parsing on this machine. Write multi-line messages to a file and use `git commit -F <file>`.
- **Run tests from the repo root**, `C:\Learn\Economy\MoneyView`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/core_finance/dcf.py` | `calculate_net_debt` — the one new formula. Modify. | 1 |
| `packages/core_finance/__init__.py` | Re-export it. Modify. | 1 |
| `tests/core_finance/test_dcf.py` | Formula tests. Modify. | 1 |
| `apps/api/models/schema_parts/corporate.py` | `BridgeInputMeta`, `BridgeSource`; new fields on `DCFSummary`, `DCFFullReport`, `CorporateComparisonRow`. Modify. | 2 |
| `apps/api/services/equity_bridge.py` | **Create.** Line-item extraction, unit scaling, quality assignment. The only module that knows Yahoo label names for the bridge. | 3 |
| `tests/api/test_equity_bridge.py` | **Create.** Extraction, scaling, and quality tests against synthetic bundles. | 3 |
| `apps/api/services/corporate_dcf.py` | Consume the bridge; roll up `bridge_quality`. Modify. | 4 |
| `tests/api/test_corporate_dcf_bridge.py` | **Create.** Override precedence, unit correctness, the ESG invariant. | 4 |
| `apps/api/services/corporate_statement_metrics.py` | Unalias `Total Debt` from `Net Debt` at three sites. Modify. | 5 |
| `tests/api/test_statement_debt_extraction.py` | **Create.** The alias regression. | 5 |
| `apps/api/services/db.py` | Guarded `ALTER TABLE` adding `bridge_quality`. Modify. | 6 |
| `apps/api/services/corporate_comparison.py` | Consume the bridge, persist `bridge_quality`, filter the aggregates, bump `METRIC_SCHEMA_VERSION`. Modify. | 6 |
| `tests/api/test_corporate_comparison.py` | Row and aggregate behaviour. Modify. | 6 |
| `docs/dcf-valuation.md` | Bridge definitions, units, the ESG decision. Modify. | 7 |
| `ERROR-LOG.md` | Two defect entries. Modify. | 7 |
| `guideline/sop/todo.md` | Close Phase 2 items 1–3. Modify. | 7 |

Task order is a dependency chain: 1 → 2 → 3 → 4, then 5 (independent of 4), then 6 (needs 3), then 7.

---

### Task 1: The `calculate_net_debt` formula

**Files:**
- Modify: `packages/core_finance/dcf.py` (append after `calculate_equity_value`, currently at line 74-84)
- Modify: `packages/core_finance/__init__.py` (the import block at line 20-33 and `__all__` at line 51-60)
- Test: `tests/core_finance/test_dcf.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `calculate_net_debt(total_debt: float | None, cash_and_equivalents: float | None) -> float | None`, exported from `packages.core_finance`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core_finance/test_dcf.py`, inside the same test class that holds `test_calculate_equity_value_subtracts_net_debt_and_adds_non_operating_assets` (around line 108):

```python
    def test_calculate_net_debt_subtracts_cash_from_total_debt(self):
        assert calculate_net_debt(1000.0, 250.0) == 750.0

    def test_calculate_net_debt_is_negative_when_cash_exceeds_debt(self):
        # A cash-rich company has negative net debt, which correctly RAISES equity value
        # above enterprise value. Clamping this at zero would undervalue every such issuer.
        assert calculate_net_debt(100.0, 400.0) == -300.0

    def test_calculate_net_debt_is_none_when_total_debt_is_missing(self):
        assert calculate_net_debt(None, 250.0) is None

    def test_calculate_net_debt_is_none_when_cash_is_missing(self):
        # A missing cash balance is not a zero cash balance. Returning total debt here
        # would hand a real number to the bridge and overstate net debt by all the cash.
        assert calculate_net_debt(1000.0, None) is None

    def test_calculate_net_debt_accepts_a_genuine_zero_cash_balance(self):
        # Zero is data; None is absence. They must not collapse into the same branch.
        assert calculate_net_debt(1000.0, 0.0) == 1000.0
```

Add `calculate_net_debt` to the existing import from `packages.core_finance` at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_dcf.py -k net_debt -v`
Expected: FAIL — `ImportError: cannot import name 'calculate_net_debt'`

- [ ] **Step 3: Write the implementation**

In `packages/core_finance/dcf.py`, immediately after `calculate_equity_value`:

```python
def calculate_net_debt(
    total_debt: float | None,
    cash_and_equivalents: float | None,
) -> float | None:
    """
    Net Debt = Total Debt - Cash and Equivalents

    None if either input is missing. A missing cash balance is not a zero cash
    balance, and returning total debt unadjusted would overstate net debt by the
    entire cash position -- a real number handed to a bridge that should report a
    missing input.

    A negative result is valid and must be preserved: a company holding more cash
    than debt raises equity value above enterprise value.
    """
    if total_debt is None or cash_and_equivalents is None:
        return None
    return float(total_debt) - float(cash_and_equivalents)
```

In `packages/core_finance/__init__.py`, add `calculate_net_debt` to the `from .dcf import (...)` block and to `__all__`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/core_finance/test_dcf.py -v`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/core_finance/dcf.py packages/core_finance/__init__.py tests/core_finance/test_dcf.py
git commit -F <message-file>
```

Message:
```
feat: add calculate_net_debt to the finance engine

Net debt = total debt - cash, returning None when either input is
missing. The equity bridge needs this and had no formula for it; the
statement metrics layer papered over the gap by treating Yahoo's
Net Debt line as a synonym for Total Debt.

A negative result is preserved deliberately: more cash than debt raises
equity value above enterprise value.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 2: The `BridgeInputMeta` contract

**Files:**
- Modify: `apps/api/models/schema_parts/corporate.py`
- Test: none of its own — Pydantic model declarations are exercised by Tasks 3, 4 and 6. Do not write a test that only asserts a model has fields.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BridgeSource` (a `StrEnum`) with members `REQUEST`, `TOTAL_DEBT_LESS_CASH`, `NET_DEBT_PLUS_CASH`, `INVESTMENTS_ADVANCES`, `DILUTED_AVERAGE_SHARES`, `SHARES_OUTSTANDING`, `UNAVAILABLE`.
  - `BridgeInputMeta(value: float | None, source: str, quality: str, as_of: str | None)`.
  - `DCFSummary` and `DCFFullReport` each gain `net_debt_meta`, `non_operating_assets_meta`, `diluted_shares_meta`.
  - `CorporateComparisonRow` gains `bridge_quality: str = "missing"`.

- [ ] **Step 1: Add the enum and the model**

At the top of `apps/api/models/schema_parts/corporate.py`, extend the imports:

```python
from enum import StrEnum
```

Then, immediately before `class ValuationAssumptions` (line 10):

```python
class BridgeSource(StrEnum):
    """Where one enterprise-to-equity bridge input came from.

    A closed set, not a free-form string: this value is rendered in the UI, and
    free-form provenance strings drift apart across call sites.
    """

    REQUEST = "request"
    TOTAL_DEBT_LESS_CASH = "total_debt_less_cash"
    NET_DEBT_PLUS_CASH = "net_debt_plus_cash"
    INVESTMENTS_ADVANCES = "investments_and_advances"
    DILUTED_AVERAGE_SHARES = "diluted_average_shares"
    SHARES_OUTSTANDING = "shares_outstanding"
    UNAVAILABLE = "unavailable"


class BridgeInputMeta(BaseModel):
    """One bridge input with its provenance.

    `value` is in billions -- of currency for the two money terms, of shares for
    the share count -- so equity_value / diluted_shares yields dollars per share
    directly. Scaling happens once, in equity_bridge.py, at read time.
    """

    value: float | None = None
    source: str = BridgeSource.UNAVAILABLE
    quality: str = "missing"
    as_of: str | None = None
```

- [ ] **Step 2: Add the fields to the three response models**

In `DCFSummary` (line 28-42), after `bridge_quality`:

```python
    net_debt_meta: BridgeInputMeta = Field(default_factory=BridgeInputMeta)
    non_operating_assets_meta: BridgeInputMeta = Field(default_factory=BridgeInputMeta)
    diluted_shares_meta: BridgeInputMeta = Field(default_factory=BridgeInputMeta)
```

In `DCFFullReport` (line 80-102), after its `bridge_quality`, add the same three lines.

In `CorporateComparisonRow`, after `has_price_data: bool = True` (line 223):

```python
    # Beside has_price_data, and for the same reason: the three return fields above are
    # typed float and feed non-optional aggregates, so they cannot become None when the
    # bridge does not resolve. This flag says the numbers next to it are not meaningful.
    bridge_quality: str = "missing"
```

- [ ] **Step 3: Verify the models still load**

Run: `python -c "from apps.api.models.schemas import DCFSummary, DCFFullReport, CorporateComparisonRow; print(DCFSummary.model_fields['net_debt_meta'])"`
Expected: prints a `FieldInfo`, no exception.

- [ ] **Step 4: Run the existing suite to confirm nothing broke**

Run: `python -m pytest tests/api/ -q`
Expected: PASS, same count as before this task (defaults mean no existing construction site needs changing).

- [ ] **Step 5: Commit**

```bash
git add apps/api/models/schema_parts/corporate.py
git commit -F <message-file>
```

Message:
```
feat: add the BridgeInputMeta contract

BridgeSource is a StrEnum rather than free-form strings because the value
reaches the UI and free-form provenance drifts across call sites.

Every new field is defaulted, so no existing construction site changes and
nothing here is breaking.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 3: `equity_bridge.py` — extraction, scaling, quality

**Files:**
- Create: `apps/api/services/equity_bridge.py`
- Create: `tests/api/test_equity_bridge.py`

**Interfaces:**
- Consumes: `BridgeInputMeta`, `BridgeSource` (Task 2); `calculate_net_debt` (Task 1); `get_yahoo_statement_bundle(ticker: str, endpoint: str) -> dict | None` from `apps/api/services/corporate_statement_metrics.py:85`.
- Produces:
  - `EquityBridge` — a frozen dataclass with `net_debt`, `non_operating_assets`, `diluted_shares_outstanding`, each a `BridgeInputMeta`.
  - `load_equity_bridge(ticker: str, *, bundle_loader=get_yahoo_statement_bundle) -> EquityBridge`.

**Bundle shape** (from `apps/api/services/acquisition/store.py:148-159`) — the loader returns a dict with keys `income`, `balance`, `cashflow`, `quarterly_income`, `quarterly_balance`, `quarterly_cashflow` (each a `pd.DataFrame` indexed by line-item label, columns are `pd.Timestamp` period ends, **newest first**), plus `info` (a dict with `marketCap`, `sharesOutstanding`, `currency`, `beta`) and `fetched_at`. A ticker with nothing stored returns `None`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_equity_bridge.py`:

```python
import pandas as pd
import pytest

from apps.api.models.schema_parts.corporate import BridgeSource
from apps.api.services.equity_bridge import load_equity_bridge

BILLION = 1_000_000_000.0


def _bundle(*, balance=None, income=None, quarterly_balance=None, info=None):
    """A statement bundle shaped exactly like acquisition.store.load_statement_bundle.

    Columns are Timestamps and newest-first, which is what the real loader produces;
    a test using string columns would pass against code that never handles real data.
    """
    empty = pd.DataFrame()
    return {
        "ticker": "TEST",
        "income": income if income is not None else empty,
        "balance": balance if balance is not None else empty,
        "cashflow": empty,
        "quarterly_income": empty,
        "quarterly_balance": quarterly_balance if quarterly_balance is not None else empty,
        "quarterly_cashflow": empty,
        "info": info if info is not None else {},
        "fetched_at": None,
    }


def _frame(rows: dict[str, list[float | None]], periods: list[str]) -> pd.DataFrame:
    frame = pd.DataFrame(rows, index=pd.to_datetime(periods)).T
    return frame


def _loader(bundle):
    return lambda ticker, endpoint: bundle


def test_net_debt_is_total_debt_less_cash_scaled_to_billions():
    bundle = _bundle(
        balance=_frame(
            {
                "Total Debt": [100 * BILLION],
                "Cash Cash Equivalents And Short Term Investments": [40 * BILLION],
            },
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(60.0)
    assert bridge.net_debt.quality == "ok"
    assert bridge.net_debt.source == BridgeSource.TOTAL_DEBT_LESS_CASH
    assert bridge.net_debt.as_of == "2025-09-30"


def test_a_newer_quarterly_period_beats_the_annual_one():
    # A balance sheet is a point-in-time snapshot, so the newest one wins -- unlike the
    # per-year maps the metric layer builds for multi-year ratios.
    bundle = _bundle(
        balance=_frame(
            {"Total Debt": [100 * BILLION], "Cash And Cash Equivalents": [10 * BILLION]},
            ["2024-12-31"],
        ),
        quarterly_balance=_frame(
            {"Total Debt": [80 * BILLION], "Cash And Cash Equivalents": [10 * BILLION]},
            ["2025-09-30"],
        ),
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(70.0)
    assert bridge.net_debt.as_of == "2025-09-30"


def test_net_debt_falls_back_to_the_net_debt_line_at_estimated_quality():
    # Recovering total debt as NetDebt + cash and then netting cash back out is just
    # NetDebt, so this branch does rely on Yahoo's undocumented definition. It must be
    # labelled a fallback, not reported as ok.
    bundle = _bundle(
        balance=_frame(
            {"Net Debt": [55 * BILLION], "Cash And Cash Equivalents": [10 * BILLION]},
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(55.0)
    assert bridge.net_debt.quality == "estimated"
    assert bridge.net_debt.source == BridgeSource.NET_DEBT_PLUS_CASH


def test_net_debt_is_missing_when_cash_is_absent():
    bundle = _bundle(_frame({"Total Debt": [100 * BILLION]}, ["2025-09-30"]))
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value is None
    assert bridge.net_debt.quality == "missing"


def test_net_debt_is_negative_for_a_cash_rich_balance_sheet():
    bundle = _bundle(
        balance=_frame(
            {
                "Total Debt": [10 * BILLION],
                "Cash Cash Equivalents And Short Term Investments": [60 * BILLION],
            },
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(-50.0)


def test_non_operating_assets_degrade_to_estimated_when_absent():
    # This term degrades rather than going missing: omitting it understates equity value
    # by a bounded, usually immaterial amount, where substituting net debt would not be.
    bundle = _bundle(
        balance=_frame(
            {"Total Debt": [10 * BILLION], "Cash And Cash Equivalents": [5 * BILLION]},
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.non_operating_assets.value is None
    assert bridge.non_operating_assets.quality == "estimated"


def test_diluted_shares_prefer_the_income_statement_over_shares_outstanding():
    bundle = _bundle(
        income=_frame({"Diluted Average Shares": [15 * BILLION]}, ["2025-09-30"]),
        info={"sharesOutstanding": 99 * BILLION},
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.diluted_shares_outstanding.value == pytest.approx(15.0)
    assert bridge.diluted_shares_outstanding.quality == "ok"
    assert bridge.diluted_shares_outstanding.source == BridgeSource.DILUTED_AVERAGE_SHARES


def test_diluted_shares_fall_back_to_shares_outstanding_at_estimated_quality():
    # sharesOutstanding is basic, not diluted, and the field promises diluted.
    bundle = _bundle(info={"sharesOutstanding": 15 * BILLION})
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.diluted_shares_outstanding.value == pytest.approx(15.0)
    assert bridge.diluted_shares_outstanding.quality == "estimated"
    assert bridge.diluted_shares_outstanding.source == BridgeSource.SHARES_OUTSTANDING


def test_a_ticker_with_nothing_stored_returns_three_missing_inputs():
    # Not None for the bridge itself: callers must never branch on two levels of absence.
    bridge = load_equity_bridge("TEST", bundle_loader=lambda ticker, endpoint: None)
    assert bridge.net_debt.quality == "missing"
    assert bridge.non_operating_assets.quality == "missing"
    assert bridge.diluted_shares_outstanding.quality == "missing"


def test_a_zero_value_is_data_not_absence():
    bundle = _bundle(
        balance=_frame(
            {"Total Debt": [0.0], "Cash And Cash Equivalents": [5 * BILLION]},
            ["2025-09-30"],
        )
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    assert bridge.net_debt.value == pytest.approx(-5.0)
    assert bridge.net_debt.quality == "ok"


def test_every_emitted_source_is_a_bridge_source_member():
    # No free-form provenance string can reach the UI.
    bundle = _bundle(
        balance=_frame(
            {"Total Debt": [10 * BILLION], "Cash And Cash Equivalents": [5 * BILLION]},
            ["2025-09-30"],
        ),
        info={"sharesOutstanding": 2 * BILLION},
    )
    bridge = load_equity_bridge("TEST", bundle_loader=_loader(bundle))
    for meta in (bridge.net_debt, bridge.non_operating_assets, bridge.diluted_shares_outstanding):
        assert meta.source in set(BridgeSource)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_equity_bridge.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.equity_bridge'`

- [ ] **Step 3: Write the implementation**

Create `apps/api/services/equity_bridge.py`:

```python
"""Read the enterprise-to-equity bridge inputs out of locally stored statements.

This module is the only place that knows Yahoo's balance-sheet label names for the
bridge, and the only place that converts units. It acquires nothing: metric
computation must never touch the network, so a ticker whose statements have not been
acquired yields three `missing` inputs rather than a fetch.

Everything it emits is in billions -- of currency for the two money terms, of shares
for the share count -- so `equity_value / diluted_shares_outstanding` yields dollars
per share with no further scaling. Scaling happens here, at read time, rather than in
the store: stored values stay verbatim as the provider reported them, no migration is
needed, and the conversion lives in one layer.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from apps.api.models.schema_parts.corporate import BridgeInputMeta, BridgeSource
from apps.api.services.corporate_statement_metrics import get_yahoo_statement_bundle
from packages.core_finance.dcf import calculate_net_debt

_BILLION = 1_000_000_000.0

_TOTAL_DEBT_LABELS = ("Total Debt",)
_NET_DEBT_LABELS = ("Net Debt",)
_CASH_LABELS = (
    "Cash Cash Equivalents And Short Term Investments",
    "Cash And Cash Equivalents",
)
_INVESTMENT_LABELS = ("Investments And Advances", "Long Term Equity Investment")
_DILUTED_SHARE_LABELS = ("Diluted Average Shares",)

_MISSING = BridgeInputMeta(value=None, source=BridgeSource.UNAVAILABLE, quality="missing")


@dataclass(frozen=True)
class EquityBridge:
    net_debt: BridgeInputMeta
    non_operating_assets: BridgeInputMeta
    diluted_shares_outstanding: BridgeInputMeta


def _latest(frames: list[object], labels: tuple[str, ...]) -> tuple[float | None, str | None]:
    """The newest reported value for the first matching label, across every frame.

    A balance sheet is a point-in-time snapshot, so the most recent period wins -- a
    quarterly figure beats an older annual one. Returns the value and its period end.
    """
    best_value: float | None = None
    best_period: pd.Timestamp | None = None
    for frame in frames:
        if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
            continue
        for label in labels:
            if label not in frame.index:
                continue
            series = frame.loc[label]
            for period, raw in series.items():
                if raw is None or pd.isna(raw):
                    continue
                if best_period is None or period > best_period:
                    best_period = period
                    best_value = float(raw)
            break  # first matching label wins within a frame
    if best_value is None or best_period is None:
        return None, None
    return best_value, str(best_period.date())


def _scaled(value: float | None) -> float | None:
    return None if value is None else value / _BILLION


def _net_debt_input(bundle: dict) -> BridgeInputMeta:
    balances = [bundle.get("balance"), bundle.get("quarterly_balance")]
    total_debt, debt_period = _latest(balances, _TOTAL_DEBT_LABELS)
    cash, cash_period = _latest(balances, _CASH_LABELS)

    net_debt = calculate_net_debt(total_debt, cash)
    if net_debt is not None:
        return BridgeInputMeta(
            value=_scaled(net_debt),
            source=BridgeSource.TOTAL_DEBT_LESS_CASH,
            quality="ok",
            as_of=debt_period or cash_period,
        )

    # Falling back to the reported Net Debt line means relying on a definition we cannot
    # see, which varies by sector. Usable, but it is a fallback and must say so.
    reported, reported_period = _latest(balances, _NET_DEBT_LABELS)
    if reported is not None:
        return BridgeInputMeta(
            value=_scaled(reported),
            source=BridgeSource.NET_DEBT_PLUS_CASH,
            quality="estimated",
            as_of=reported_period,
        )
    return _MISSING


def _non_operating_assets_input(bundle: dict) -> BridgeInputMeta:
    value, period = _latest(
        [bundle.get("balance"), bundle.get("quarterly_balance")], _INVESTMENT_LABELS
    )
    if value is None:
        # Estimated, not missing: omitting this term understates equity value by a bounded
        # amount that is immaterial for most issuers, and refusing to value a company
        # because Yahoo reported no investments line would make the bridge useless. The
        # caller sums it as 0.0 and the payload records that it was absent.
        return BridgeInputMeta(
            value=None, source=BridgeSource.UNAVAILABLE, quality="estimated"
        )
    return BridgeInputMeta(
        value=_scaled(value),
        source=BridgeSource.INVESTMENTS_ADVANCES,
        quality="ok",
        as_of=period,
    )


def _diluted_shares_input(bundle: dict) -> BridgeInputMeta:
    value, period = _latest(
        [bundle.get("income"), bundle.get("quarterly_income")], _DILUTED_SHARE_LABELS
    )
    if value is not None and value > 0:
        return BridgeInputMeta(
            value=_scaled(value),
            source=BridgeSource.DILUTED_AVERAGE_SHARES,
            quality="ok",
            as_of=period,
        )

    info = bundle.get("info") or {}
    raw = info.get("sharesOutstanding")
    if raw is None:
        return _MISSING
    try:
        shares = float(raw)
    except (TypeError, ValueError):
        return _MISSING
    if shares <= 0:
        return _MISSING
    # sharesOutstanding is a basic count and the field promises diluted.
    return BridgeInputMeta(
        value=_scaled(shares),
        source=BridgeSource.SHARES_OUTSTANDING,
        quality="estimated",
    )


def load_equity_bridge(ticker: str, *, bundle_loader=get_yahoo_statement_bundle) -> EquityBridge:
    """Build the three bridge inputs for one ticker from the local store.

    `bundle_loader` is injected so tests run against a synthetic bundle with no
    database and no network, matching how `yahoo_statement_metrics` is tested.

    Writes nothing, opens no socket, holds no module state. A ticker with nothing
    stored yields three `missing` inputs -- never None for the bridge itself, so
    callers never branch on two levels of absence.
    """
    bundle = bundle_loader(ticker.upper(), "equity_bridge")
    if bundle is None:
        return EquityBridge(_MISSING, _MISSING, _MISSING)
    return EquityBridge(
        net_debt=_net_debt_input(bundle),
        non_operating_assets=_non_operating_assets_input(bundle),
        diluted_shares_outstanding=_diluted_shares_input(bundle),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_equity_bridge.py -v`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/equity_bridge.py tests/api/test_equity_bridge.py
git commit -F <message-file>
```

Message:
```
feat: read the equity bridge inputs from stored statements

The raw data was already local -- corporate_statements holds every
balance-sheet line item and corporate_quote_facts holds the share count --
but nothing read it into the bridge. This module does, and it is the only
place that knows Yahoo label names for the bridge or converts units.

Scaling to billions happens here at read time rather than in the store, so
stored values stay verbatim as the provider reported them and no migration
is needed.

Acquires nothing. A ticker whose statements were never acquired yields
three missing inputs, not a fetch.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 4: Wire the bridge into the DCF

**Files:**
- Modify: `apps/api/services/corporate_dcf.py:107-218` (the body of `_build_dcf_outputs`)
- Create: `tests/api/test_corporate_dcf_bridge.py`

**Interfaces:**
- Consumes: `load_equity_bridge`, `EquityBridge` (Task 3); `_pick_worst_quality` from `apps/api/services/corporate_statement_metrics.py:869`.
- Produces: `_build_dcf_outputs` gains a keyword-only parameter `bridge_loader=load_equity_bridge`. `DCFSummary` and `DCFFullReport` now carry populated `*_meta` fields.

**Read first:** `apps/api/services/corporate_dcf.py:107-218`. Note line 119, which loads metrics only when a param is absent — that is the precedent this task extends.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_corporate_dcf_bridge.py`:

```python
import pytest

from apps.api.models.schema_parts.corporate import (
    BridgeInputMeta,
    BridgeSource,
    ValuationAssumptions,
)
from apps.api.services.corporate_dcf import _build_dcf_outputs
from apps.api.services.equity_bridge import EquityBridge
from apps.api.models.schemas import CorporateMetrics


def _metrics(ticker="TEST"):
    return CorporateMetrics(
        ticker=ticker, growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64,
        governance=74, esg_penalty=22,
    )


def _params(**overrides):
    base = dict(
        revenue_growth_rate=0.06, operating_margin=0.25, tax_rate=0.21,
        wacc=0.10, terminal_growth_rate=0.02, fcff=100.0, esg_penalty=22.0,
    )
    base.update(overrides)
    return ValuationAssumptions(**base)


def _bridge(net_debt=60.0, non_op=5.0, shares=15.0):
    return EquityBridge(
        net_debt=BridgeInputMeta(
            value=net_debt, source=BridgeSource.TOTAL_DEBT_LESS_CASH,
            quality="ok", as_of="2025-09-30",
        ),
        non_operating_assets=BridgeInputMeta(
            value=non_op, source=BridgeSource.INVESTMENTS_ADVANCES,
            quality="ok", as_of="2025-09-30",
        ),
        diluted_shares_outstanding=BridgeInputMeta(
            value=shares, source=BridgeSource.DILUTED_AVERAGE_SHARES,
            quality="ok", as_of="2025-09-30",
        ),
    )


def _outputs(params, bridge):
    return _build_dcf_outputs(
        ticker="TEST",
        params=params,
        current_price_loader=lambda t: 100.0,
        metrics_loader=lambda t: _metrics(t),
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
        country_risk_premium=0.008,
        bridge_loader=lambda t: bridge,
    )


def test_the_store_fills_a_bridge_field_the_request_left_none():
    summary, _, _ = _outputs(_params(), _bridge(net_debt=60.0))
    assert summary.net_debt_meta.value == pytest.approx(60.0)
    assert summary.bridge_quality == "ok"
    assert summary.valuation_method == "intrinsic_equity_per_share"
    assert summary.status != "Bridge Incomplete"


def test_a_request_parameter_overrides_the_store():
    summary, _, _ = _outputs(_params(net_debt=999.0), _bridge(net_debt=60.0))
    assert summary.net_debt_meta.value == pytest.approx(999.0)
    assert summary.net_debt_meta.source == BridgeSource.REQUEST
    assert summary.net_debt_meta.quality == "ok"


def test_the_per_share_value_is_in_dollars_not_billionths_of_a_dollar():
    # fcff and enterprise_value are in billions; net debt and the share count are scaled
    # to billions at read time, so the quotient is dollars per share. Feeding raw dollars
    # here would be wrong by 1e9 and would still return a plausible small number.
    summary, _, full = _outputs(_params(), _bridge(net_debt=60.0, non_op=0.0, shares=15.0))
    expected = (full.enterprise_value - 60.0) / 15.0
    assert summary.intrinsic_value_per_share == pytest.approx(expected, rel=1e-6)
    assert summary.intrinsic_value_per_share > 1.0


def test_bridge_quality_is_the_worst_of_the_three_inputs():
    bridge = _bridge()
    degraded = EquityBridge(
        net_debt=bridge.net_debt,
        non_operating_assets=BridgeInputMeta(
            value=None, source=BridgeSource.UNAVAILABLE, quality="estimated"
        ),
        diluted_shares_outstanding=bridge.diluted_shares_outstanding,
    )
    summary, _, _ = _outputs(_params(), degraded)
    assert summary.bridge_quality == "estimated"
    # An absent non-operating-assets term is summed as zero, so the value still resolves.
    assert summary.intrinsic_value_per_share is not None


def test_a_missing_share_count_leaves_the_per_share_value_unavailable():
    bridge = _bridge()
    starved = EquityBridge(
        net_debt=bridge.net_debt,
        non_operating_assets=bridge.non_operating_assets,
        diluted_shares_outstanding=BridgeInputMeta(
            value=None, source=BridgeSource.UNAVAILABLE, quality="missing"
        ),
    )
    summary, _, _ = _outputs(_params(), starved)
    assert summary.intrinsic_value_per_share is None
    assert summary.bridge_quality == "missing"
    assert summary.status == "Bridge Incomplete"


def test_esg_penalty_moves_no_valuation_output():
    # esg_penalty is round(8.0 + (seed % 32), 2) where seed is the sum of character codes
    # in f"{ticker}:{sector}" -- a hash of how the ticker is spelled, not a measurement.
    # Wiring it into WACC or the cash flows would let renaming a ticker change a valuation.
    # This test is the record of that decision (spec 2026-08-03, item 3).
    low, _, low_full = _outputs(_params(esg_penalty=8.0), _bridge())
    high, _, high_full = _outputs(_params(esg_penalty=40.0), _bridge())
    assert low.enterprise_value == high.enterprise_value
    assert low.equity_value == high.equity_value
    assert low.intrinsic_value_per_share == high.intrinsic_value_per_share
    assert low_full.terminal_value == high_full.terminal_value


def test_the_dcf_value_does_not_move_with_the_current_price():
    # The Phase 1 invariant. current_price may inform upside_pct and status, never value.
    cheap = _build_dcf_outputs(
        ticker="TEST", params=_params(), current_price_loader=lambda t: 10.0,
        metrics_loader=lambda t: _metrics(t), risk_free_rate=0.042,
        equity_risk_premium=0.055, country_risk_premium=0.008,
        bridge_loader=lambda t: _bridge(),
    )[0]
    dear = _build_dcf_outputs(
        ticker="TEST", params=_params(), current_price_loader=lambda t: 1000.0,
        metrics_loader=lambda t: _metrics(t), risk_free_rate=0.042,
        equity_risk_premium=0.055, country_risk_premium=0.008,
        bridge_loader=lambda t: _bridge(),
    )[0]
    assert cheap.intrinsic_value_per_share == dear.intrinsic_value_per_share
    assert cheap.enterprise_value == dear.enterprise_value
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_corporate_dcf_bridge.py -v`
Expected: FAIL — `TypeError: _build_dcf_outputs() got an unexpected keyword argument 'bridge_loader'`

- [ ] **Step 3: Write the implementation**

In `apps/api/services/corporate_dcf.py`, add the imports:

```python
from apps.api.models.schema_parts.corporate import BridgeInputMeta, BridgeSource
from apps.api.services.corporate_statement_metrics import _pick_worst_quality
from apps.api.services.equity_bridge import load_equity_bridge
```

Add `bridge_loader=load_equity_bridge` as a keyword-only parameter to `_build_dcf_outputs` (after `metrics_loader` in the signature at line 107-116).

Replace lines 154-183 with:

```python
    # Request wins, store fills -- the same precedent line 119 sets for fcff and
    # esg_penalty. Keeping the request fields is what lets the DCF what-if simulator
    # override an assumption; the store is what makes the bridge resolve when nobody does.
    needs_store = (
        params.net_debt is None
        or params.non_operating_assets is None
        or params.diluted_shares_outstanding is None
    )
    bridge = bridge_loader(ticker) if needs_store else None

    def _resolve(requested: float | None, stored: BridgeInputMeta) -> BridgeInputMeta:
        if requested is None:
            return stored
        # The caller asserted this figure, so it is ok by definition and its provenance
        # is the request -- not whatever the store happened to hold.
        return BridgeInputMeta(
            value=float(requested), source=BridgeSource.REQUEST, quality="ok"
        )

    net_debt_meta = _resolve(
        params.net_debt, bridge.net_debt if bridge else BridgeInputMeta()
    )
    non_operating_assets_meta = _resolve(
        params.non_operating_assets,
        bridge.non_operating_assets if bridge else BridgeInputMeta(),
    )
    diluted_shares_meta = _resolve(
        params.diluted_shares_outstanding,
        bridge.diluted_shares_outstanding if bridge else BridgeInputMeta(),
    )

    net_debt = net_debt_meta.value
    non_operating_assets = non_operating_assets_meta.value
    diluted_shares_outstanding = diluted_shares_meta.value

    bridge_quality = _pick_worst_quality(
        net_debt_meta.quality, non_operating_assets_meta.quality, diluted_shares_meta.quality
    )

    # An absent non-operating-assets term sums as zero -- that is what "estimated" means
    # here. An absent net debt or share count does not: those are "missing", and the
    # per-share value must not be produced at all.
    equity_value = (
        calculate_equity_value(
            enterprise_value=enterprise_value,
            net_debt=net_debt,
            non_operating_assets=non_operating_assets or 0.0,
        )
        if net_debt is not None
        else None
    )
    intrinsic_value_per_share = (
        calculate_intrinsic_value_per_share(equity_value, diluted_shares_outstanding)
        if equity_value is not None
        and diluted_shares_outstanding is not None
        and diluted_shares_outstanding > 0
        else None
    )
    valuation_method = (
        "intrinsic_equity_per_share"
        if intrinsic_value_per_share is not None
        else "enterprise_value_no_share_bridge"
    )
```

Pass `net_debt_meta`, `non_operating_assets_meta` and `diluted_shares_meta` into the `DCFSummary` construction (line 205) and the `DCFFullReport` construction (around line 240-256).

**Do not change** the `_report_id` call at line 193-204 — it already hashes the three bridge values, and now hashes the resolved ones, which is correct.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_corporate_dcf_bridge.py tests/api/test_corporate_dcf_streaming.py -v`
Expected: PASS. If `test_corporate_dcf_streaming.py` fails, it is because its fixture supplies bridge params explicitly and now gets `source="request"` — assert against that, do not weaken the new behaviour.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/corporate_dcf.py tests/api/test_corporate_dcf_bridge.py
git commit -F <message-file>
```

Message:
```
fix: feed the DCF bridge from the store instead of substituting 0.0

net_debt and non_operating_assets were request parameters no caller sent,
so lines 161-162 substituted 0.0 and intrinsic_value_per_share stayed
None -- forcing estimated_value back to enterprise value and status to
"Bridge Incomplete" on every request.

Request still wins where it supplies a value, which is what keeps the
what-if simulator working. bridge_quality is now the worst of the three
inputs rather than a two-branch guess.

Includes the test recording the ESG decision: esg_penalty is a hash of the
ticker string, so no valuation output may move with it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 5: Unalias `Total Debt` from `Net Debt`

**Files:**
- Modify: `apps/api/services/corporate_statement_metrics.py:659-660`, `:1311-1312`, `:1551-1552`
- Create: `tests/api/test_statement_debt_extraction.py`

**Interfaces:**
- Consumes: nothing from earlier tasks. Independent of Tasks 3 and 4 — it can be done in any order relative to them.
- Produces: no new public names. `debt_by_year` at the three sites now holds gross total debt.

**Why:** `_statement_map(balance, ("Total Debt", "Net Debt"))` treats the two as synonyms. Net debt is total debt *minus cash*, so when Yahoo omits `Total Debt` this silently substitutes a much smaller number into `debt_ratio`, the capital-structure weights and WACC.

**Note the asymmetry with Task 3.** Here the recovery is `NetDebt + cash` and the cash term does **not** cancel, because `debt_ratio` needs gross debt. In `equity_bridge.py` the same two line items produce net debt and the cash does cancel. Same inputs, two consumers, two expressions — do not extract a shared helper.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_statement_debt_extraction.py`:

```python
import pandas as pd

from apps.api.services.corporate_statement_metrics import yahoo_statement_metrics
from apps.api.models.schemas import CorporateMetrics

BILLION = 1_000_000_000.0


def _fallback():
    return CorporateMetrics(
        ticker="TEST", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64,
        governance=74, esg_penalty=22,
    )


def _frame(rows, periods):
    return pd.DataFrame(rows, index=pd.to_datetime(periods)).T


def _bundle(balance):
    empty = pd.DataFrame()
    income = _frame(
        {
            "Total Revenue": [100 * BILLION, 110 * BILLION, 120 * BILLION],
            "Operating Income": [20 * BILLION, 22 * BILLION, 24 * BILLION],
            "Pretax Income": [18 * BILLION, 20 * BILLION, 22 * BILLION],
            "Tax Provision": [4 * BILLION, 4.4 * BILLION, 4.8 * BILLION],
        },
        ["2023-12-31", "2024-12-31", "2025-12-31"],
    )
    return {
        "ticker": "TEST", "income": income, "balance": balance, "cashflow": empty,
        "quarterly_income": empty, "quarterly_balance": empty, "quarterly_cashflow": empty,
        "info": {}, "fetched_at": None,
    }


def _debt_ratio(balance):
    metrics = yahoo_statement_metrics(
        "TEST", _fallback(), bundle_loader=lambda t, e: _bundle(balance)
    )
    return metrics.debt_ratio if metrics is not None else None


def test_net_debt_is_not_read_as_total_debt():
    # A cash-rich company: total debt 100B, cash 90B, so Yahoo's Net Debt line reads 10B.
    # Treating that as total debt understates leverage by 90% of the balance sheet, and
    # every WACC weight derived from it is wrong.
    equity = 100 * BILLION
    net_debt_only = _frame(
        {"Net Debt": [10 * BILLION],
         "Cash And Cash Equivalents": [90 * BILLION],
         "Stockholders Equity": [equity]},
        ["2025-12-31"],
    )
    true_total = _frame(
        {"Total Debt": [100 * BILLION],
         "Cash And Cash Equivalents": [90 * BILLION],
         "Stockholders Equity": [equity]},
        ["2025-12-31"],
    )
    assert _debt_ratio(net_debt_only) == _debt_ratio(true_total)


def test_total_debt_is_recovered_from_net_debt_plus_cash():
    # debt_ratio needs GROSS debt, so here the cash term does not cancel -- unlike the
    # equity bridge, where the same two line items produce net debt.
    balance = _frame(
        {"Net Debt": [10 * BILLION],
         "Cash And Cash Equivalents": [90 * BILLION],
         "Stockholders Equity": [100 * BILLION]},
        ["2025-12-31"],
    )
    # gross debt 100B / (100B + 100B equity) = 50%
    assert _debt_ratio(balance) == 50.0


def test_total_debt_is_preferred_when_both_lines_are_present():
    balance = _frame(
        {"Total Debt": [100 * BILLION],
         "Net Debt": [10 * BILLION],
         "Cash And Cash Equivalents": [90 * BILLION],
         "Stockholders Equity": [100 * BILLION]},
        ["2025-12-31"],
    )
    assert _debt_ratio(balance) == 50.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_statement_debt_extraction.py -v`
Expected: FAIL — `test_total_debt_is_recovered_from_net_debt_plus_cash` asserts `50.0` and gets `9.09` (10B / 110B), because `Net Debt` was read as total debt.

- [ ] **Step 3: Write the implementation**

In `apps/api/services/corporate_statement_metrics.py`, add a helper near `_statement_map` (around line 160):

```python
def _gross_debt_map(balance, quarterly_balance) -> dict[int, float]:
    """Total debt by year, recovering it from Net Debt + cash where the line is absent.

    "Total Debt" and "Net Debt" were previously read as an alias pair, but net debt is
    total debt MINUS cash -- for a cash-rich company they differ by most of the balance
    sheet, and the substitution silently understated every WACC weight.

    Note this is gross debt: the cash term does not cancel here. The equity bridge reads
    the same two line items to produce NET debt, where it does. Two consumers, two
    expressions; do not merge them.
    """
    total = _prefer_annual_map(
        _statement_map(balance, ("Total Debt",)),
        _quarterly_balance_map(quarterly_balance, ("Total Debt",)),
    )
    net = _prefer_annual_map(
        _statement_map(balance, ("Net Debt",)),
        _quarterly_balance_map(quarterly_balance, ("Net Debt",)),
    )
    cash = _prefer_annual_map(
        _statement_map(balance, ("Cash Cash Equivalents And Short Term Investments",
                                "Cash And Cash Equivalents")),
        _quarterly_balance_map(quarterly_balance,
                               ("Cash Cash Equivalents And Short Term Investments",
                                "Cash And Cash Equivalents")),
    )
    recovered = {
        year: net[year] + cash[year]
        for year in set(net) & set(cash)
        if year not in total
    }
    return {**recovered, **total}
```

Replace all three call sites. At `:659-660`:

```python
    debt_by_year = _gross_debt_map(balance, quarterly_balance)
```

Apply the identical replacement at `:1311-1312` and `:1551-1552`. Read each site first — the surrounding variable names differ.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_statement_debt_extraction.py tests/api/test_corporate_metric_audit.py -v`
Expected: PASS. `test_corporate_metric_audit.py` exercises the same extraction and must stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/corporate_statement_metrics.py tests/api/test_statement_debt_extraction.py
git commit -F <message-file>
```

Message:
```
fix: stop reading Yahoo's Net Debt line as total debt

Three sites read _statement_map(balance, ("Total Debt", "Net Debt")) as an
alias pair. Net debt is total debt minus cash; for a cash-rich company the
two differ by most of the balance sheet. When Yahoo omitted Total Debt this
silently substituted a much smaller number into debt_ratio, the capital
structure weights and WACC, with no error raised.

Total debt is now recovered as Net Debt + cash where the line is absent, so
coverage does not drop. Note this is gross debt and the cash term does not
cancel -- the equity bridge reads the same two line items to produce net
debt, where it does.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

- [ ] **Step 6: Record the defect**

Add an entry to `ERROR-LOG.md` following the template at the top of that file: Date `2026-08-03`, Command (the failing test), Failure, Root cause, Fix, Files changed, Prevention. Commit separately with `docs: record the Total Debt alias defect`.

---

### Task 6: Wire the bridge into the comparison and persist its quality

**Files:**
- Modify: `apps/api/services/db.py` (after line 665, alongside the other guarded `v3_columns` checks)
- Modify: `apps/api/services/corporate_comparison.py:46` (`METRIC_SCHEMA_VERSION`), `:176-184` (the INSERT), `:334-343` (row construction), `:348-396` (`_dcf_snapshot`), `:605-607` (the aggregate SQL)
- Modify: `tests/api/test_corporate_comparison.py`

**Interfaces:**
- Consumes: `load_equity_bridge`, `EquityBridge` (Task 3); `calculate_equity_value`, `calculate_intrinsic_value_per_share`; `_pick_worst_quality` from `corporate_statement_metrics.py:869`.
- Produces: `_dcf_snapshot` gains a keyword-only `bridge_loader=load_equity_bridge` and returns `"bridge_quality"` in its dict.

**Do not thread `bridge_loader` through `_build_live_rows`, `_build_live_response` and `save_corporate_comparison_snapshot`.** That would add a parameter to three signatures purely so tests can reach the fourth. `_dcf_snapshot` is called directly by the row-level tests, and the end-to-end tests monkeypatch the module-level `load_equity_bridge` name instead.

**Read first:** `apps/api/services/corporate_comparison.py:348-396`. Two defects live there: `net_debt=0.0` at line 372, and `intrinsic_value=current_price` at line 380, which pins `dcf_implied_return` and `stock_expected_return` at `0.00` for every ticker.

- [ ] **Step 1: Add the guarded column**

In `apps/api/services/db.py`, after the `metric_schema_version` block (line 666-670):

```python
    if "bridge_quality" not in v3_columns:
        # '' , not 'missing': these rows were computed before the bridge existed. The
        # aggregate filter excludes only 'missing', so legacy rows stay in every
        # historical average exactly as they read today. Defaulting them to 'missing'
        # would silently rewrite the history this column exists to preserve -- the same
        # reasoning as metric_schema_version defaulting to 0 above.
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN bridge_quality TEXT NOT NULL DEFAULT ''")
```

Add `bridge_quality TEXT NOT NULL DEFAULT ''` to the `CREATE TABLE` at `db.py:399-430` and to the duplicate at `db.py:606-637`, before the `PRIMARY KEY` line in each.

- [ ] **Step 2: Write the failing tests**

Add to `tests/api/test_corporate_comparison.py`, following the fixture style already in that file:

```python
from apps.api.models.schema_parts.corporate import BridgeInputMeta, BridgeSource
from apps.api.services.corporate_comparison import (
    _comparison_universe_key,
    _dcf_snapshot,
    load_corporate_comparison_history,
)
from apps.api.services.equity_bridge import EquityBridge


def _meta(value, quality="ok", source=BridgeSource.TOTAL_DEBT_LESS_CASH):
    return BridgeInputMeta(value=value, source=source, quality=quality, as_of="2025-09-30")


def _resolved_bridge(net_debt=60.0, non_op=0.0, shares=15.0):
    return EquityBridge(
        net_debt=_meta(net_debt),
        non_operating_assets=_meta(non_op, source=BridgeSource.INVESTMENTS_ADVANCES),
        diluted_shares_outstanding=_meta(shares, source=BridgeSource.DILUTED_AVERAGE_SHARES),
    )


def _starved_bridge():
    absent = BridgeInputMeta(value=None, source=BridgeSource.UNAVAILABLE, quality="missing")
    return EquityBridge(absent, absent, absent)


def _snapshot(bridge, *, price=100.0):
    return _dcf_snapshot(
        ticker="AAPL",
        metrics=_stub_metrics_loader("AAPL"),
        price_loader=lambda _t: price,
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
        bridge_loader=lambda _t: bridge,
    )


def test_a_resolved_bridge_produces_a_per_share_value_not_an_enterprise_value():
    # net_debt was hardcoded 0.0 at line 372, so estimated_value was enterprise value
    # under a per-share label and status was permanently "Bridge Incomplete".
    dcf = _snapshot(_resolved_bridge(net_debt=60.0, non_op=0.0, shares=15.0))
    assert dcf["bridge_quality"] == "ok"
    assert dcf["status"] in {"Undervalued", "Overvalued"}
    # fcff is 92 (billions), so enterprise value is in the thousands of billions. A
    # per-share value divided by 15B shares cannot land in that range.
    assert dcf["estimated_value"] < 1000.0


def test_an_unresolved_bridge_reports_missing_and_falls_back_to_enterprise_value():
    dcf = _snapshot(_starved_bridge())
    assert dcf["bridge_quality"] == "missing"
    assert dcf["status"] == "Bridge Incomplete"
    assert dcf["estimated_value"] > 1000.0


def test_the_dcf_implied_return_is_no_longer_pinned_at_zero():
    # _dcf_snapshot passed intrinsic_value=current_price, so dcf_implied_return was
    # f(price, price) = 0. stock_expected_return is assigned from it and
    # expected_return_spread derived from that, so three columns were constant.
    few_shares = _snapshot(_resolved_bridge(shares=1.0))
    many_shares = _snapshot(_resolved_bridge(shares=1000.0))
    assert few_shares["dcf_implied_return"] != many_shares["dcf_implied_return"]
    assert few_shares["dcf_implied_return"] != 0.0
    assert few_shares["stock_expected_return"] == few_shares["dcf_implied_return"]


def test_an_estimated_bridge_still_produces_a_value():
    bridge = EquityBridge(
        net_debt=_meta(60.0),
        non_operating_assets=BridgeInputMeta(
            value=None, source=BridgeSource.UNAVAILABLE, quality="estimated"
        ),
        diluted_shares_outstanding=_meta(15.0, source=BridgeSource.DILUTED_AVERAGE_SHARES),
    )
    dcf = _snapshot(bridge)
    assert dcf["bridge_quality"] == "estimated"
    assert dcf["status"] in {"Undervalued", "Overvalued"}


def _insert_snapshot_rows(rows: list[tuple[str, str, float]]) -> str:
    """Write snapshot rows directly, bypassing the builder, so the aggregate SQL is what
    is under test rather than the row construction that feeds it."""
    universe_key = _comparison_universe_key(
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
    )
    taken_at = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc).isoformat()
    with db_service.get_db() as conn:
        for ticker, bridge_quality, dcf_value in rows:
            conn.execute(
                """INSERT INTO corporate_comparison_snapshots_v3 (
                       snapshot_version, snapshot_date, universe_key, comparison_universe,
                       benchmark_ticker, custom_tickers, snapshot_taken_at, snapshot_source,
                       risk_free_rate, equity_risk_premium, stock_expected_return_method,
                       ticker, name, sector, group_name, weight, roic, wacc, roic_minus_wacc,
                       dcf_value, current_price, dcf_implied_return, capm_expected_return,
                       stock_expected_return, market_expected_return, expected_return_spread,
                       stock_expected_return_source, has_price_data, metric_schema_version,
                       bridge_quality
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                             ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("v1", "2026-08-03", universe_key, "portfolio_plus_benchmark", "^GSPC", "",
                 taken_at, "manual", 4.2, 5.5, "dcf_implied_upside", ticker, ticker,
                 "Technology", "core", 0.1, 18.0, 10.0, 8.0, dcf_value, 100.0, 5.0, 9.0,
                 5.0, 9.0, -4.0, "dcf_implied_upside", 1, 2, bridge_quality),
            )
    return universe_key


def _history_average_dcf_value():
    history = load_corporate_comparison_history(
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
    )
    return history.points[0].average_dcf_value


def test_missing_rows_are_excluded_from_the_aggregates_but_estimated_rows_are_not(
    tmp_path, monkeypatch
):
    # The exclusion rule must be "bridge_quality = 'missing'", never "!= 'ok'". An
    # estimated row carries a defensible number and the label that says so.
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([
        ("AAA", "ok", 100.0),
        ("BBB", "estimated", 200.0),
        ("CCC", "missing", 999999.0),
    ])
    assert _history_average_dcf_value() == pytest.approx(150.0)


def test_legacy_rows_with_an_empty_bridge_quality_stay_in_the_aggregates(
    tmp_path, monkeypatch
):
    # Rows written before the column existed carry ''. Every historical average must read
    # exactly as it does today, not be reinterpreted as missing.
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([("AAA", "", 100.0), ("BBB", "", 200.0)])
    assert _history_average_dcf_value() == pytest.approx(150.0)


def test_the_metric_schema_version_is_bumped():
    # Metric semantics changed, so snapshots from before and after must never compare as
    # like-for-like.
    assert METRIC_SCHEMA_VERSION == 2
```

If `_comparison_universe_key`'s signature differs from the call above, read it at `corporate_comparison.py:166-170` and match it — do not guess.

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_corporate_comparison.py -k "bridge or aggregate or estimated or legacy or schema_version" -v`

Expected failures, and each must be the stated one — a test failing for a different reason is not yet proving anything:
- `_dcf_snapshot` tests: `TypeError: _dcf_snapshot() got an unexpected keyword argument 'bridge_loader'`
- aggregate tests: `sqlite3.OperationalError: table corporate_comparison_snapshots_v3 has no column named bridge_quality` (Step 1 adds the column, so run Step 1 first and these become wrong-average failures instead)
- `test_the_metric_schema_version_is_bumped`: `assert 1 == 2`

- [ ] **Step 4: Write the implementation**

In `apps/api/services/corporate_comparison.py`:

Bump line 46 to `METRIC_SCHEMA_VERSION = 2`.

Add the imports:

```python
from apps.api.services.corporate_statement_metrics import _pick_worst_quality
from apps.api.services.equity_bridge import load_equity_bridge
```

Add `bridge_loader=load_equity_bridge` to `_dcf_snapshot`'s keyword-only signature (lines 348-355). `_build_live_rows` calls it without the argument at line 317 and keeps doing so — the default is what makes that work.

Replace the bridge portion of `_dcf_snapshot` (lines 370-374) and its expected-return call (lines 376-385):

```python
        bridge = bridge_loader(ticker)
        net_debt = bridge.net_debt.value
        non_operating_assets = bridge.non_operating_assets.value
        shares = bridge.diluted_shares_outstanding.value
        bridge_quality = _pick_worst_quality(
            bridge.net_debt.quality,
            bridge.non_operating_assets.quality,
            bridge.diluted_shares_outstanding.quality,
        )
        equity_value = (
            calculate_equity_value(
                enterprise_value=enterprise_value,
                net_debt=net_debt,
                non_operating_assets=non_operating_assets or 0.0,
            )
            if net_debt is not None
            else None
        )
        intrinsic_value_per_share = (
            calculate_intrinsic_value_per_share(equity_value, shares)
            if equity_value is not None and shares is not None and shares > 0
            else None
        )
        estimated_value = (
            intrinsic_value_per_share
            if intrinsic_value_per_share is not None
            else enterprise_value
        )

    with perf_timer(scope="metric", operation="metric.expected_vs_market", ticker=ticker, component="corporate_comparison"):
        expected_returns = calculate_expected_return_result(
            ExpectedReturnInputs(
                current_price=current_price,
                # The real intrinsic value, not the current price. Passing the price made
                # dcf_implied_return = f(price, price) = 0, and stock_expected_return is
                # assigned from it, so three columns were constant for every ticker.
                intrinsic_value=(
                    intrinsic_value_per_share
                    if intrinsic_value_per_share is not None
                    else current_price
                ),
                risk_free_rate=risk_free_rate,
                equity_risk_premium=equity_risk_premium,
                beta=_levered_beta_from_metrics(metrics),
            )
        )
```

Add `"bridge_quality": bridge_quality` and a real `"status"` to the returned dict (replacing the constant `"Bridge Incomplete"` at line 395):

```python
        "status": (
            "Bridge Incomplete"
            if intrinsic_value_per_share is None
            else "Undervalued" if current_price > 0 and intrinsic_value_per_share > current_price
            else "Overvalued"
        ),
        "bridge_quality": bridge_quality,
```

Add `bridge_quality=str(dcf["bridge_quality"])` to the `CorporateComparisonRow` construction at line 325-343.

Add `bridge_quality` to the INSERT column list at line 176-184, add one `?` to the `VALUES` tuple, and pass `row.bridge_quality` in the parameter tuple at line 185.

Change the three aggregate expressions at lines 605-607 to exclude unresolved rows:

```sql
AVG(CASE WHEN s.group_name != ? AND s.bridge_quality != 'missing' THEN s.expected_return_spread END) AS average_expected_return_spread,
AVG(CASE WHEN s.group_name != ? THEN s.roic_minus_wacc END) AS average_roic_minus_wacc,
AVG(CASE WHEN s.group_name != ? AND s.bridge_quality != 'missing' THEN s.dcf_value END) AS average_dcf_value,
```

`average_roic_minus_wacc` is deliberately unfiltered — ROIC and WACC do not depend on the bridge.

**Add `bridge_quality` to every snapshot read-back too.** `load_corporate_comparison_snapshot_version` selects an explicit column list at `corporate_comparison.py:656-663` that would otherwise omit it, so a stored snapshot would come back with every row defaulted to `"missing"` regardless of what was persisted. Add the column to that `SELECT` and to the `CorporateComparisonRow` construction below it. Then check `_load_snapshot_response` (line 403) and `load_corporate_comparison_stock_history` (line 688) for the same pattern — read each one before editing; only add the column where a `CorporateComparisonRow` is being rebuilt.

Verify with:

```bash
grep -n "has_price_data" apps/api/services/corporate_comparison.py
```

Every `SELECT` that lists `has_price_data` is rebuilding a row and needs `bridge_quality` beside it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_corporate_comparison.py -v`
Expected: PASS. Several existing assertions in this file encode the old constants (`dcf_implied_return == 0.0`, `status == "Bridge Incomplete"`). **Update them to the new correct values — do not weaken the new tests to match the old behaviour.**

- [ ] **Step 6: Run the whole backend suite**

Run: `python -m pytest tests/core_finance/ tests/api/ -q`
Expected: PASS, ≥418 + the new tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/db.py apps/api/services/corporate_comparison.py tests/api/test_corporate_comparison.py
git commit -F <message-file>
```

Message:
```
fix: give the comparison table a real bridge and a real verdict

Three defects in _dcf_snapshot:

- net_debt was hardcoded 0.0, so dcf_value was enterprise value under a
  per-share label and status was permanently "Bridge Incomplete".
- intrinsic_value=current_price made dcf_implied_return f(price, price) = 0.
  stock_expected_return is assigned from it and expected_return_spread
  derived from that, so three columns were structurally constant for every
  ticker.
- Nothing recorded whether a row's bridge had resolved, so an unresolved row
  contributed its enterprise value to average_dcf_value.

bridge_quality is persisted because the aggregates are SQL over the snapshot
table, not Python over live rows -- a value not stored cannot be filtered on.
It defaults to '' for pre-existing rows so every historical average reads
exactly as it does today.

METRIC_SCHEMA_VERSION 1 -> 2: metric semantics changed, so snapshots from
before and after must never compare as like-for-like.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

- [ ] **Step 8: Record the defect**

Add an `ERROR-LOG.md` entry for `intrinsic_value=current_price` — a silent failure that produced three constant columns with no error raised. Commit separately.

---

### Task 7: Documentation and track closure

**Files:**
- Modify: `docs/dcf-valuation.md`
- Modify: `guideline/sop/todo.md` (the Phase 2 block at lines 54-59)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code-facing.

- [ ] **Step 1: Update `docs/dcf-valuation.md`**

Read the file first and match its existing structure and tone. Add:

- The bridge definitions: `net_debt = TotalDebt − (Cash + STI)`, `non_operating_assets = InvestmentsAndAdvances`, and why cash enters exactly one term.
- The units convention: everything in billions, scaled at read time, and why the quotient is dollars per share.
- The quality vocabulary, and the rule that separates `estimated` from `missing` — whether a wrong answer is bounded.
- **The ESG decision, with its evidence**: `esg_penalty` is `round(8.0 + (seed % 32), 2)` where `seed = sum(ord(char) for char in f"{ticker}:{sector}")`. It must not adjust WACC or the cash-flow scenarios while that is its source, because renaming a ticker would change a valuation. `agency_discount` remains reported and inert. Revisit only if ESG becomes a real acquisition data class.
- That `current_price` informs `upside_pct` and `status` only, never a valuation input.

- [ ] **Step 2: Close the track in `guideline/sop/todo.md`**

Mark Phase 2 items 1, 2 and 3 `- [x]` with what was actually done, in the style of the completed tracks already in the file. Restate item 4 (the sensitivity table) as its own open track with a line saying it was deliberately deferred until the bridge had data. Note the three defects found and where their `ERROR-LOG.md` entries are.

- [ ] **Step 3: Run the full verification**

```bash
python -m pytest tests/core_finance/ tests/api/ -q
cd apps/web && npx tsc --noEmit
```
Expected: backend ≥418 passed plus the new tests; `tsc` exits 0.

- [ ] **Step 4: Commit**

```bash
git add docs/dcf-valuation.md guideline/sop/todo.md
git commit -F <message-file>
```

Message:
```
docs: close Phase 2 items 1-3 of the financial logic remediation

Records the bridge definitions, the billions convention and why scaling
happens at read time, and the ESG decision with the evidence behind it --
esg_penalty is a hash of the ticker string, so nothing may be derived from
it that moves a valuation.

Item 4, the WACC x terminal-growth sensitivity table, stays open as its own
track. It was deferred deliberately: a sensitivity chart is worth building
on a bridge that has data in it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Verification Checklist

Run before declaring the plan complete:

- [ ] `python -m pytest tests/core_finance/ tests/api/ -q` — ≥418 passed plus the new tests, 0 failed
- [ ] `cd apps/web && npx tsc --noEmit` — exit 0
- [ ] `git log --oneline` shows one commit per task plus two `ERROR-LOG.md` commits
- [ ] `grep -rn '"Total Debt", "Net Debt"' apps/api/` returns nothing
- [ ] `grep -n "intrinsic_value=current_price" apps/api/services/corporate_comparison.py` returns nothing
- [ ] `grep -n "net_debt=0.0" apps/api/services/corporate_comparison.py` returns nothing
- [ ] `METRIC_SCHEMA_VERSION == 2`
- [ ] Every `SELECT` in `corporate_comparison.py` that lists `has_price_data` also lists `bridge_quality`
- [ ] A snapshot saved and then read back reports the same `bridge_quality` it was written with
- [ ] No test in this plan reaches the network — every one injects a loader
