# Terminal Diagnostics and Bounds — Implementation Plan (Stages 1–2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a DCF say which bound decided its terminal growth and warn when the terminal
value dominates the valuation (Stage 1, no valuation changes), then split the single
WACC-anchored clamp into three bounds with distinct jobs (Stage 2, valuations change).

**Architecture:** A pure derivation function in `packages/core_finance` returns the chosen
terminal growth *and* which bound produced it. Stage 1 calls it with no economic ceiling,
which reproduces today's arithmetic exactly while making the binding bound reportable.
Stage 2 supplies the ceiling, at which point the same function starts changing numbers.

**Tech Stack:** Python 3, FastAPI, Pydantic v2, pytest; Next.js 16 / React 19 /
TypeScript, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-terminal-state-engine-design.md`

## Global Constraints

- `safety_margin = 0.005`, unchanged from today's implementation (spec §5.1). Do not tune it.
- `TERMINAL_GROWTH_CEILING = 0.03`. Pinned by this plan as long-run nominal economic
  growth. Stage 1 must not apply it; Stage 2 does.
- **Stage 1 changes no valuation.** Any task in Stages 1 (Tasks 1–3) that alters a
  computed `estimated_value`, `enterprise_value` or `terminal_value_share_pct` is wrong.
- **Stage 2 must not introduce the industry ceiling or the regime classifier** (spec §8).
  Both are Stages 3 and 4.
- `terminal_value_share_pct` is a **diagnostic, never a target** (spec §7.4). No task may
  clamp, cap or otherwise steer it.
- Every test must be mutation-verified per `CLAUDE.md` §8: name the broken implementation
  it was shown to reject, or call it unverified.
- No `git add -A`. Stage by explicit path — the working tree carries unrelated user files.
- **No test may open `data/processed/moneyview.db`.** `tests/conftest.py:161` and
  `tests/__init__.py` refuse it at import time — a guard added after a test wrote a
  fabricated Damodaran vintage into the developer's real database. Use
  `_watchlist_tickers()` in `tests/api/test_terminal_diagnostics.py`, which bootstraps the
  isolated test database from the checked-in `stock_targets.json` seed. The measurement
  scripts in Task 4 Step 7 are shell commands, not tests, and may read it.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core_finance/terminal_growth.py` | **New.** Pure derivation: choose terminal growth from its bounds and report which bound bound. No I/O, no models. |
| `tests/core_finance/test_terminal_growth.py` | **New.** Unit tests for the above, including every bound binding independently. |
| `apps/api/models/schema_parts/corporate.py` | Two new `DCFSummary` fields carrying the diagnosis. |
| `apps/api/services/corporate_dcf.py` | Populates those fields from values it already holds. |
| `tests/api/test_terminal_diagnostics.py` | **New.** The report carries the diagnosis; today's behaviour is characterised before Stage 2 changes it. |
| `apps/api/services/corporate_metrics_service.py` | Stage 2 only: derivation moves to the shared function and gains the ceiling. |
| `apps/web/app/corporate/components/graphs/DcfCoreModulesGraph.tsx` | The terminal-share tile gains a warning state. |
| `apps/web/tests/e2e/terminal-diagnostics.spec.ts` | **New.** The warning appears above the threshold and not below it. |

---

### Task 1: The terminal growth derivation

Pure function, no dependencies on models or storage, so every bound can be exercised
directly. Called with `ceiling=None` it reproduces today's arithmetic exactly — that is
what makes Stage 1 safe.

**Files:**
- Create: `packages/core_finance/terminal_growth.py`
- Test: `tests/core_finance/test_terminal_growth.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SAFETY_MARGIN: float = 0.005`
  - `TERMINAL_GROWTH_CEILING: float = 0.03`
  - `@dataclass(frozen=True) TerminalGrowthDerivation` with fields
    `rate: float`, `binding_constraint: str`, `company_growth: float`,
    `ceiling: float | None`, `wacc_safety_bound: float`
  - `derive_terminal_growth(company_growth: float, wacc: float, *, ceiling: float | None = None, safety_margin: float = SAFETY_MARGIN, floor: float = TERMINAL_GROWTH_FLOOR) -> TerminalGrowthDerivation`
  - `binding_constraint` is one of `"company"`, `"ceiling"`, `"wacc_safety"`, `"floor"`.
  - `TERMINAL_GROWTH_FLOOR: float = -0.1` — the pre-existing `max(..., -0.1)` in both
    derivation paths, modelled rather than ignored. Amended after Task 2's review found
    that omitting it made the diagnostic report `"company"` for 8 tickers whose number the
    floor decided.

- [ ] **Step 1: Write the failing tests**

```python
"""Terminal growth, and which bound decided it.

`WACC - safety_margin` was doing two jobs: keeping the Gordon denominator away from zero,
and standing in for an economic ceiling it was never chosen to represent. Splitting them
starts here, with a function that reports which bound actually bound -- because "why is
this number 3%?" is the question the current implementation cannot answer.
"""

import pytest

from packages.core_finance.terminal_growth import (
    SAFETY_MARGIN,
    TERMINAL_GROWTH_CEILING,
    derive_terminal_growth,
)


def test_company_growth_binds_when_it_is_the_smallest():
    result = derive_terminal_growth(company_growth=0.02, wacc=0.09, ceiling=0.03)

    assert result.rate == pytest.approx(0.02)
    assert result.binding_constraint == "company"


def test_the_ceiling_binds_a_fast_grower():
    result = derive_terminal_growth(company_growth=0.18, wacc=0.09, ceiling=0.03)

    assert result.rate == pytest.approx(0.03)
    assert result.binding_constraint == "ceiling"


def test_the_wacc_safety_bound_binds_when_wacc_is_low():
    """A WACC below the ceiling makes the safety bound the smallest of the three."""
    result = derive_terminal_growth(company_growth=0.18, wacc=0.02, ceiling=0.03)

    assert result.rate == pytest.approx(0.015)
    assert result.binding_constraint == "wacc_safety"


def test_without_a_ceiling_the_result_is_todays_arithmetic():
    """Stage 1 calls it this way, so this pins that Stage 1 changes no valuation."""
    result = derive_terminal_growth(company_growth=0.18, wacc=0.1414, ceiling=None)

    assert result.rate == pytest.approx(0.1414 - 0.005)
    assert result.binding_constraint == "wacc_safety"
    assert result.ceiling is None


def test_the_reported_bounds_are_the_ones_that_were_compared():
    result = derive_terminal_growth(company_growth=0.18, wacc=0.09, ceiling=0.03)

    assert result.company_growth == pytest.approx(0.18)
    assert result.ceiling == pytest.approx(0.03)
    assert result.wacc_safety_bound == pytest.approx(0.085)


def test_a_negative_ceiling_is_honoured_rather_than_floored_at_zero():
    """Spec 5.2: a shrinking industry may drive the ceiling below zero."""
    result = derive_terminal_growth(company_growth=0.05, wacc=0.09, ceiling=-0.01)

    assert result.rate == pytest.approx(-0.01)
    assert result.binding_constraint == "ceiling"


def test_ties_resolve_to_the_more_economic_bound():
    """When the ceiling and the safety bound are equal, the ceiling is the reason.

    Arbitrary only in appearance: reporting `wacc_safety` here would tell a reader the
    arithmetic constrained them when an economic judgement did so equally.
    """
    result = derive_terminal_growth(company_growth=0.5, wacc=0.035, ceiling=0.03)

    assert result.rate == pytest.approx(0.03)
    assert result.binding_constraint == "ceiling"


def test_the_pinned_constants_are_what_the_plan_says():
    assert SAFETY_MARGIN == 0.005
    assert TERMINAL_GROWTH_CEILING == 0.03
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_terminal_growth.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'packages.core_finance.terminal_growth'`

- [ ] **Step 3: Write the implementation**

```python
"""Choosing a terminal growth rate, and saying which bound chose it.

Gordon growth is `TV = FCFF x (1 + g) / (WACC - g)`, so the entire terminal value turns on
the spread `WACC - g`. The previous implementation bounded `g` only by `WACC - 0.005`,
which keeps the denominator away from zero and says nothing about whether `g` is a rate any
company could sustain for ever. On this repository's watchlist that single bound decided
terminal growth for 23 of 40 tickers, each then valued at roughly 203x-228x FCFF.

Three bounds, three jobs:

- `company_growth`  -- what this company is doing
- `ceiling`         -- what an economy permits in perpetuity
- `wacc - margin`   -- what the arithmetic permits

`ceiling=None` omits the middle one, which reproduces the previous behaviour exactly. That
is deliberate: it lets the diagnostic ship before any number moves.
"""

from __future__ import annotations

from dataclasses import dataclass

SAFETY_MARGIN = 0.005
"""Distance below WACC at which the Gordon denominator is treated as unsafe.

Unchanged from the previous implementation. The defect was that this bound was doing the
ceiling's job, not that 50bp is the wrong distance -- and moving both at once would make
the improvement impossible to attribute.
"""

TERMINAL_GROWTH_CEILING = 0.03
"""Long-run nominal economic growth: the most a firm can compound at for ever.

A parameter with a stated basis, not a measurement. No field in this repository expresses
long-run growth -- `industry_benchmark.revenue_growth` is a trailing five-year average
reaching +47.8%, which is a recovery, not a perpetuity.
"""


@dataclass(frozen=True)
class TerminalGrowthDerivation:
    """The chosen rate and the bounds it was chosen from."""

    rate: float
    binding_constraint: str
    company_growth: float
    ceiling: float | None
    wacc_safety_bound: float


def derive_terminal_growth(
    company_growth: float,
    wacc: float,
    *,
    ceiling: float | None = None,
    safety_margin: float = SAFETY_MARGIN,
) -> TerminalGrowthDerivation:
    """Terminal growth, plus which of its bounds produced it."""
    wacc_safety_bound = wacc - safety_margin

    # Ordered so that an exact tie reports the economic bound rather than the arithmetic
    # one. A reader told "wacc_safety" concludes the model was cornered; told "ceiling"
    # they conclude a judgement was applied. When both are true, the judgement is the
    # more useful answer.
    candidates: list[tuple[str, float]] = [("company", company_growth)]
    if ceiling is not None:
        candidates.append(("ceiling", ceiling))
    candidates.append(("wacc_safety", wacc_safety_bound))

    binding_constraint, rate = min(candidates, key=lambda item: item[1])

    return TerminalGrowthDerivation(
        rate=rate,
        binding_constraint=binding_constraint,
        company_growth=company_growth,
        ceiling=ceiling,
        wacc_safety_bound=wacc_safety_bound,
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/test_terminal_growth.py -q`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-verify**

Run each mutation, confirm the named test fails, then restore.

| Mutation | Must fail |
| --- | --- |
| Put `("wacc_safety", ...)` before `("ceiling", ...)` in `candidates` | `test_ties_resolve_to_the_more_economic_bound` |
| `binding_constraint, rate = max(candidates, ...)` | the three binding tests |
| Append the ceiling unconditionally, using `ceiling or TERMINAL_GROWTH_CEILING` | `test_without_a_ceiling_the_result_is_todays_arithmetic` |
| `ceiling = max(ceiling, 0.0)` before comparison | `test_a_negative_ceiling_is_honoured_rather_than_floored_at_zero` |

- [ ] **Step 6: Commit**

```bash
git add packages/core_finance/terminal_growth.py tests/core_finance/test_terminal_growth.py
git commit -m "feat: derive terminal growth and report which bound decided it"
```

---

### Task 2: The report carries the diagnosis

The report already computes everything needed; nothing is threaded through from the params
builder. Stage 1, so no number moves.

**Files:**
- Modify: `apps/api/models/schema_parts/corporate.py` — `DCFSummary`, after
  `terminal_value_share_pct` (currently line 81)
- Modify: `apps/api/services/corporate_dcf.py` — near the existing
  `terminal_value_share_pct` computation (line 233) and the `DCFSummary(...)` construction
  (line 358)
- Test: `tests/api/test_terminal_diagnostics.py`

**Interfaces:**
- Consumes: `derive_terminal_growth`, `TerminalGrowthDerivation`, `SAFETY_MARGIN` from Task 1.
- Produces: `DCFSummary.wacc_minus_terminal_growth: float` and
  `DCFSummary.terminal_growth_binding_constraint: str`.

- [ ] **Step 1: Write the failing tests**

```python
"""A DCF report should say which bound decided its terminal growth.

`terminal_value_share_pct` has always been on the report and on screen. What no surface
could say is WHY a valuation is 96% terminal value -- whether an economic judgement or the
Gordon denominator's safety bound produced the growth rate. These two fields answer that.

Stage 1: the values below are today's arithmetic. When Stage 2 supplies a ceiling they
change, and the characterisation test here is what makes that change visible rather than
merely asserted.
"""

import pytest

from apps.api.routes import corporate as corporate_route
from apps.api.services.corporate_dcf import build_dcf_full_report
from packages.core_finance.terminal_growth import SAFETY_MARGIN


def _report(ticker: str = "AAPL"):
    metrics = corporate_route._metrics_for_ticker(ticker)
    params = corporate_route._valuation_params_from_metrics(metrics)
    return build_dcf_full_report(
        ticker=ticker,
        params=params,
        current_price_loader=corporate_route._latest_market_price,
        metrics_loader=corporate_route._metrics_for_ticker,
        risk_free_rate=corporate_route.DEFAULT_RISK_FREE_RATE,
        equity_risk_premium=corporate_route.DEFAULT_EQUITY_RISK_PREMIUM,
        country_risk_premium=corporate_route.KOREA_COUNTRY_RISK_PREMIUM,
    )


def test_the_report_states_the_spread_the_terminal_value_turns_on():
    summary = _report().summary

    assert summary.wacc_minus_terminal_growth is not None
    assert summary.wacc_minus_terminal_growth > 0


def test_the_report_names_the_binding_constraint():
    summary = _report().summary

    assert summary.terminal_growth_binding_constraint in {"company", "wacc_safety"}


def test_stage_one_never_reports_a_ceiling_because_none_is_applied():
    """The ceiling arrives in Stage 2. Reporting it here would be a lie about the run."""
    summary = _report().summary

    assert summary.terminal_growth_binding_constraint != "ceiling"


def test_where_the_safety_bound_binds_the_spread_is_exactly_the_margin():
    """Today's defect, characterised: where that bound binds, the spread is pinned at 50bp.

    Two assertions, and the second is the important one. Guarding a single-ticker assertion
    on the binding constraint makes it vacuous whenever the guard is false -- AAPL binds on
    "company", so the first version of this test asserted nothing at all. Sweeping a sample
    and then requiring that the sample contained at least one such ticker is what stops a
    green run from meaning "the condition never occurred".

    Expected to change after Stage 2 for tickers whose growth exceeds the ceiling. That
    change is the point, and this test is how it becomes visible.
    """
    # NOT `sqlite3.connect("data/processed/moneyview.db")`. `tests/conftest.py:161` and
    # `tests/__init__.py` both refuse that path outright -- a guard added after a test
    # wrote a fabricated Damodaran vintage into the developer's real database. Use the
    # hermetic helper Task 2 introduced, which bootstraps the isolated test database from
    # the checked-in `stock_targets.json` seed and yields the same ticker roster.
    tickers = _watchlist_tickers(limit=20)

    pinned = []
    for ticker in tickers:
        try:
            summary = _report(ticker).summary
        except Exception:
            continue
        if summary.terminal_growth_binding_constraint == "wacc_safety":
            pinned.append(ticker)
            assert summary.wacc_minus_terminal_growth == pytest.approx(SAFETY_MARGIN), ticker

    assert pinned, "no sampled ticker bound on wacc_safety; this test proved nothing"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_terminal_diagnostics.py -q`
Expected: FAIL — `AttributeError: 'DCFSummary' object has no attribute 'wacc_minus_terminal_growth'`

- [ ] **Step 3: Add the schema fields**

In `apps/api/models/schema_parts/corporate.py`, inside `DCFSummary`, directly after
`terminal_value_share_pct: float`:

```python
    # Why the terminal growth rate is what it is. `terminal_value_share_pct` says a
    # valuation rests on the perpetuity; these two say which bound put it there, which is
    # the question a reader asks next and could not previously answer.
    wacc_minus_terminal_growth: float | None = None
    terminal_growth_binding_constraint: str | None = None
```

Both default to `None` so a payload restored from a `sessionStorage` cache written by an
earlier build still validates — the same precedent `terminal_value_share_pct` set at
`corporate.py:138`.

- [ ] **Step 4: Populate them in the report builder**

In `apps/api/services/corporate_dcf.py`, after the `terminal_value_share_pct` computation
(line 233):

```python
    # Recovered rather than threaded: the builder already holds both inputs, and passing a
    # derivation record through every caller would make the params object carry state that
    # only one consumer reads. Stage 1 passes no ceiling, so this reproduces the same
    # comparison the params builder made.
    terminal_derivation = derive_terminal_growth(
        company_growth=params.revenue_growth_rate,
        wacc=wacc,
        ceiling=None,
    )
```

Add to the import block at the top of the file:

```python
from packages.core_finance.terminal_growth import derive_terminal_growth
```

And in the `DCFSummary(...)` construction (line 358), after
`terminal_value_share_pct=...`:

```python
        wacc_minus_terminal_growth=round(float(wacc - terminal_growth), 6),
        terminal_growth_binding_constraint=terminal_derivation.binding_constraint,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_terminal_diagnostics.py -q`
Expected: PASS, 4 tests.

- [ ] **Step 6: Prove Stage 1 changed no valuation**

Run: `python -m pytest tests/ -q`
Expected: PASS, with **no existing test changed**. If any assertion on `estimated_value`,
`enterprise_value` or `terminal_value_share_pct` moved, the task is wrong — revert and
find what was altered.

- [ ] **Step 7: Mutation-verify**

| Mutation | Must fail |
| --- | --- |
| `ceiling=TERMINAL_GROWTH_CEILING` in the builder call | `test_stage_one_never_reports_a_ceiling_because_none_is_applied` |
| `wacc_minus_terminal_growth=round(float(wacc), 6)` | `test_where_the_safety_bound_binds_the_spread_is_exactly_the_margin` |
| `terminal_growth_binding_constraint="company"` hard-coded | `test_where_the_safety_bound_binds_the_spread_is_exactly_the_margin` — on its `assert pinned` line, which is the vacuity guard |

- [ ] **Step 8: Commit**

```bash
git add apps/api/models/schema_parts/corporate.py apps/api/services/corporate_dcf.py tests/api/test_terminal_diagnostics.py
git commit -m "feat: a DCF report says which bound decided its terminal growth"
```

---

### Task 3: The terminal-share tile warns

`terminal_value_share_pct` is already displayed (`DcfCoreModulesGraph.tsx:52-61`). 96% and
60% render identically. This gives the high reading a visible state and shows the spread
beside it.

**Files:**
- Modify: `apps/web/app/corporate/components/graphs/DcfCoreModulesGraph.tsx:52-61`
- Test: `apps/web/tests/e2e/terminal-diagnostics.spec.ts`

**Interfaces:**
- Consumes: `DCFSummary.terminal_value_share_pct`,
  `DCFSummary.wacc_minus_terminal_growth` from Task 2.
- Produces: `data-testid="terminal-share-warning"` on the warning element.

- [ ] **Step 1: Write the failing test**

```typescript
import { expect, test } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

/**
 * A terminal share of 96% and one of 60% used to render identically -- a plain
 * percentage, with nothing saying that one of them means the valuation is almost entirely
 * a single perpetuity assumption. The figure was visible throughout; it was not
 * information.
 */

const WARNING = "terminal-share-warning";

async function gotoCorporate(page: import("@playwright/test").Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({
    timeout: 60_000,
  });
}

test("a terminal share above the threshold is marked", async ({ page }) => {
  await mockCorporatePageApi(page, { dcfTerminalValueSharePct: 96.2 });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByTestId(WARNING)).toBeVisible();
});

test("an ordinary terminal share is not marked", async ({ page }) => {
  // The threshold has to discriminate. A warning on every valuation is wallpaper.
  await mockCorporatePageApi(page, { dcfTerminalValueSharePct: 62.0 });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByTestId(WARNING)).toHaveCount(0);
});
```

- [ ] **Step 2: Add the mock option**

In `apps/web/tests/e2e/helpers/corporatePageMock.ts`, extend the options type with
`dcfTerminalValueSharePct?: number` and apply it to `mockDcfFullReport.summary`'s
`terminal_value_share_pct` when supplied. Follow the existing option pattern in that file;
do not restructure it.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/web && npx playwright test tests/e2e/terminal-diagnostics.spec.ts --reporter=line`
Expected: FAIL — `terminal-share-warning` not found.

- [ ] **Step 4: Implement the warning**

Replace the tile body at `DcfCoreModulesGraph.tsx:52-61`:

```tsx
          <div className="text-xs text-[var(--text-muted)]">Terminal Value Share</div>
          {/* Measured by the backend as PV(terminal) / enterprise value. It is a property
              of a valuation that ran, so without a DCF result there is no share to show --
              the assumption sliders alone cannot produce one. The nullish check also covers
              a result restored from a sessionStorage cache written before this field. */}
          <div className="text-2xl font-black">
            {dcfResult?.terminal_value_share_pct == null
              ? "N/A"
              : pct(dcfResult.terminal_value_share_pct)}
          </div>
          {/* A share this high means the explicit forecast contributes almost nothing, so
              the valuation is a restatement of the terminal assumptions. Shown as a state
              rather than a clamp: the share is a diagnostic, and steering it would hide
              the very thing worth seeing. */}
          {dcfResult?.terminal_value_share_pct != null
          && dcfResult.terminal_value_share_pct >= TERMINAL_SHARE_WARNING_PCT ? (
            <div
              data-testid="terminal-share-warning"
              className="mt-1 text-[length:var(--type-helper)] text-[var(--delta-down)]"
            >
              Mostly terminal value
              {dcfResult.wacc_minus_terminal_growth != null
                ? ` · WACC − g = ${pct(dcfResult.wacc_minus_terminal_growth * 100)}`
                : ""}
            </div>
          ) : null}
```

Add above the component:

```tsx
/** Above this, the explicit forecast contributes little enough to be worth flagging. */
const TERMINAL_SHARE_WARNING_PCT = 90;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && npx playwright test tests/e2e/terminal-diagnostics.spec.ts --reporter=line`
Expected: PASS, 2 tests.

- [ ] **Step 6: Typecheck, lint, and run the corporate specs**

```bash
cd apps/web
npx tsc --noEmit
npx eslint app --max-warnings=0
npx playwright test tests/e2e/corporate-comparison.spec.ts tests/e2e/refresh-idle-state.spec.ts --reporter=line
```

Expected: clean, and no corporate spec regressions.

- [ ] **Step 7: Mutation-verify**

| Mutation | Must fail |
| --- | --- |
| `TERMINAL_SHARE_WARNING_PCT = 0` | `an ordinary terminal share is not marked` |
| `TERMINAL_SHARE_WARNING_PCT = 100` | `a terminal share above the threshold is marked` |
| Drop the `!= null` guard | neither — the guard is for cache-restored payloads; note it as untested rather than claiming otherwise |

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/corporate/components/graphs/DcfCoreModulesGraph.tsx apps/web/tests/e2e/terminal-diagnostics.spec.ts apps/web/tests/e2e/helpers/corporatePageMock.ts
git commit -m "feat: mark a valuation that is mostly terminal value"
```

---

### Task 4: Stage 2 — the ceiling joins the bounds

The first task that changes a number. Everything before it exists so this one can be
measured rather than argued about.

**Files:**
- Modify: `apps/api/services/corporate_metrics_service.py:504-506`
- Modify: `apps/api/services/corporate_comparison.py:386` — the second derivation site
- Modify: `apps/api/services/corporate_dcf.py` — pass the ceiling in the Task 2 call
- Test: `tests/api/test_terminal_diagnostics.py` (extend)

**Two derivation sites, two safety clamps. Change only the derivations.**

`min(..., wacc - 0.005)` appears at four places, and they are not the same thing:

| Site | What it bounds | Change? |
| --- | --- | --- |
| `corporate_metrics_service.py:505` | `metrics.growth` — a **derivation** | **Yes** |
| `corporate_comparison.py:386` | `metrics.growth` — a **derivation** | **Yes** |
| `corporate_dcf.py:204` | `params.terminal_growth_rate` — derived on the bulk path, taken straight from the request body on all three single-ticker routes | **No** |
| `monte_carlo.py:191` | `request.terminal_growth`, supplied and sampled | **No** |

The last two bound a value arriving from outside, which is exactly what a safety net is
for; giving them the ceiling would silently rewrite a number a caller deliberately chose.
The first two compute the rate from company metrics, and leaving either behind would make
the comparison table and the DCF report disagree about the same ticker — the shape of
divergence `ERROR-LOG.md` already records for the base case and the sensitivity grid.

**Interfaces:**
- Consumes: `derive_terminal_growth`, `TERMINAL_GROWTH_CEILING` from Task 1.
- Produces: no new names. `terminal_growth_binding_constraint` can now be `"ceiling"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_terminal_diagnostics.py`:

```python
def test_a_fast_grower_is_bound_by_the_ceiling_not_the_safety_margin():
    """AMD derived 0.1364 under the old clamp -- 50bp below its 14.14% WACC.

    That rate is refused by ValuationAssumptions' own `le=0.1` bound, which is why 9 of the
    first 40 watchlist tickers could not be valued at all. Under the ceiling it is 3%, and
    the report says the ceiling is why.
    """
    from packages.core_finance.terminal_growth import (
        TERMINAL_GROWTH_CEILING,
        derive_terminal_growth,
    )

    result = derive_terminal_growth(
        company_growth=0.18, wacc=0.1414, ceiling=TERMINAL_GROWTH_CEILING
    )

    assert result.rate == pytest.approx(TERMINAL_GROWTH_CEILING)
    assert result.binding_constraint == "ceiling"


def test_the_watchlist_no_longer_pins_on_the_safety_margin_alone():
    """The defect mechanism, tested directly rather than through a share threshold.

    Not `terminal_share < 90%`: the share is a diagnostic, and asserting a bound on it
    would turn it into a target. The claim is narrower -- no ticker arrives at
    `wacc - safety_margin` merely because its growth exceeded WACC.
    """
    # NOT `sqlite3.connect("data/processed/moneyview.db")`. `tests/conftest.py:161` and
    # `tests/__init__.py` both refuse that path outright -- a guard added after a test
    # wrote a fabricated Damodaran vintage into the developer's real database. Use the
    # hermetic helper Task 2 introduced, which bootstraps the isolated test database from
    # the checked-in `stock_targets.json` seed and yields the same ticker roster.
    tickers = _watchlist_tickers(limit=20)

    pinned = []
    for ticker in tickers:
        try:
            summary = _report(ticker).summary
        except Exception:
            continue
        if (
            summary.terminal_growth_binding_constraint == "wacc_safety"
            and summary.wacc_minus_terminal_growth == pytest.approx(SAFETY_MARGIN)
        ):
            # Legitimate only when WACC is genuinely below the ceiling plus the margin.
            pinned.append(ticker)

    assert pinned == [], f"still pinned on the safety margin alone: {pinned}"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_terminal_diagnostics.py -q`
Expected: FAIL — the ceiling is not applied, so `binding_constraint` is `wacc_safety`.

- [ ] **Step 3: Apply the ceiling in the params builder**

Replace `apps/api/services/corporate_metrics_service.py:505-506`:

```python
    terminal_growth_rate = min(growth_rate, wacc - 0.005)
    terminal_growth_rate = max(terminal_growth_rate, -0.1)
```

with:

```python
    # Three bounds, three jobs. `wacc - safety_margin` used to carry the economic ceiling's
    # work as well as its own, which pinned terminal growth 50bp below WACC for 23 of 40
    # watchlist tickers and valued each at roughly 203x-228x FCFF.
    terminal_growth_rate = derive_terminal_growth(
        company_growth=growth_rate,
        wacc=wacc,
        ceiling=TERMINAL_GROWTH_CEILING,
    ).rate
    # The model's own floor. Unchanged.
    terminal_growth_rate = max(terminal_growth_rate, -0.1)
```

Add to that file's imports:

```python
from packages.core_finance.terminal_growth import (
    TERMINAL_GROWTH_CEILING,
    derive_terminal_growth,
)
```

- [ ] **Step 3b: Apply the ceiling at the second derivation site**

Replace `apps/api/services/corporate_comparison.py:386`:

```python
        terminal_growth = min(growth_rate, wacc - 0.005)
```

with:

```python
        # The same derivation as corporate_metrics_service, and it must stay the same:
        # this figure feeds the comparison table's dcf_value and dcf_implied_return, so a
        # ceiling applied in one place and not the other would show one ticker two
        # different terminal growth rates on two screens.
        terminal_growth = derive_terminal_growth(
            company_growth=growth_rate,
            wacc=wacc,
            ceiling=TERMINAL_GROWTH_CEILING,
        ).rate
```

Add to that file's imports:

```python
from packages.core_finance.terminal_growth import (
    TERMINAL_GROWTH_CEILING,
    derive_terminal_growth,
)
```

Add this test to `tests/api/test_terminal_diagnostics.py`:

```python
def test_both_derivation_sites_agree_on_the_same_ticker():
    """A ceiling applied in one derivation and not the other splits one ticker in two.

    corporate_comparison computes the comparison table's dcf_value; corporate_dcf computes
    the report. They read the same metrics, so they must reach the same terminal growth.
    """
    from apps.api.services import corporate_comparison

    metrics = corporate_route._metrics_for_ticker("AAPL")
    wacc = max(float(metrics.wacc) / 100, 0.001)
    growth_rate = float(metrics.growth) / 100

    from packages.core_finance.terminal_growth import (
        TERMINAL_GROWTH_CEILING,
        derive_terminal_growth,
    )

    expected = derive_terminal_growth(
        company_growth=growth_rate, wacc=wacc, ceiling=TERMINAL_GROWTH_CEILING
    ).rate
    params = corporate_route._valuation_params_from_metrics(metrics)

    assert params.terminal_growth_rate == pytest.approx(max(expected, -0.1))
    assert "wacc - 0.005" not in inspect.getsource(corporate_comparison._dcf_upside_fields)
```

Add `import inspect` to the test file's imports. If `_dcf_upside_fields` is not the
enclosing function name at `corporate_comparison.py:386`, use whatever function encloses
that line — the assertion's point is that the raw clamp is gone from the derivation.

- [ ] **Step 4: Pass the ceiling in the report builder**

In `apps/api/services/corporate_dcf.py`, change the Task 2 call so the reported diagnosis
matches the derivation that actually ran:

```python
    terminal_derivation = derive_terminal_growth(
        company_growth=params.revenue_growth_rate,
        wacc=wacc,
        ceiling=TERMINAL_GROWTH_CEILING,
    )
```

and extend that file's import to include `TERMINAL_GROWTH_CEILING`.

Delete `test_stage_one_never_reports_a_ceiling_because_none_is_applied` from
`tests/api/test_terminal_diagnostics.py` — it asserted a Stage 1 property that Stage 2
deliberately ends. Removing it is correct; leaving it and loosening it would be the
failure this project keeps recording.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_terminal_diagnostics.py -q`
Expected: PASS.

- [ ] **Step 6: Run the full suite and expect movement**

Run: `python -m pytest tests/ -q`

Existing tests asserting a specific `estimated_value`, `enterprise_value` or
`terminal_value_share_pct` **will** fail, because valuations have changed. For each one:
recompute the expected figure, update it, and state in the commit message which values
moved and by how much. Do **not** loosen an assertion to a range to make it pass.

- [ ] **Step 7: Measure the change against the baseline**

Run the same measurement the spec's §1 used, and record the result in the commit message:

```bash
python -u -c "
import logging, sqlite3; logging.disable(logging.CRITICAL)
from apps.api.routes import corporate as C
from apps.api.services.corporate_dcf import build_dcf_full_report
db = sqlite3.connect('data/processed/moneyview.db')
tickers = [r[0] for r in db.execute('select ticker from watchlist order by ticker limit 25')]
shares, bound = [], {}
for t in tickers:
    try:
        m = C._metrics_for_ticker(t); p = C._valuation_params_from_metrics(m)
        r = build_dcf_full_report(ticker=t, params=p,
            current_price_loader=C._latest_market_price, metrics_loader=C._metrics_for_ticker,
            risk_free_rate=C.DEFAULT_RISK_FREE_RATE, equity_risk_premium=C.DEFAULT_EQUITY_RISK_PREMIUM,
            country_risk_premium=C.KOREA_COUNTRY_RISK_PREMIUM)
        shares.append(r.summary.terminal_value_share_pct)
        k = r.summary.terminal_growth_binding_constraint
        bound[k] = bound.get(k, 0) + 1
    except Exception: pass
import statistics
print('reports:', len(shares), 'median share:', round(statistics.median(shares), 2))
print('binding:', bound)
"
```

Baseline to compare against, measured 2026-09-10: **18 reports, median share 96.25%**, and
every binding constraint `wacc_safety`.

- [ ] **Step 8: Mutation-verify**

| Mutation | Must fail |
| --- | --- |
| `ceiling=None` in the params builder | `test_the_watchlist_no_longer_pins_on_the_safety_margin_alone` |
| `TERMINAL_GROWTH_CEILING = 0.5` | the same test |
| Ceiling applied in the report but not the params builder | the same test — this is the one that would otherwise ship a report describing a derivation that did not happen |

- [ ] **Step 9: Commit**

```bash
git add apps/api/services/corporate_metrics_service.py apps/api/services/corporate_comparison.py apps/api/services/corporate_dcf.py tests/api/test_terminal_diagnostics.py
git commit -m "fix: bound terminal growth by an economic ceiling, not only by WACC"
```

---

## Self-Review

**Spec coverage (Stages 1–2 only).**

| Spec section | Task |
| --- | --- |
| §5.1 three bounds, `safety_margin = 0.005` | Task 1 constants; Task 4 applies the ceiling |
| §6 which bound bound, and its vocabulary | Task 1 `binding_constraint`; Task 2 reports it |
| §7.1 `wacc_minus_terminal_growth`, `terminal_growth_binding_constraint` | Task 2 |
| §7.4 warning, share is never a target | Task 3, and Task 4 Step 1's second test asserts the mechanism rather than the share |
| §8 Stage 1 changes no valuation | Task 2 Step 6 |
| §8 Stage 2 introduces no industry logic or classifier | No task references `industry_benchmark` or a regime |
| §10.1 defect reproduced before it is fixed | Task 2's `test_where_the_safety_bound_binds_the_spread_is_exactly_the_margin`, plus the Task 4 Step 7 baseline |
| §10.2 defect mechanism gone | Task 4 `test_the_watchlist_no_longer_pins_on_the_safety_margin_alone` |
| §10.3 each bound binds independently | Task 1's three binding tests |
| §10.9 mutation verification | Every task's mutation step |

**Deliberately not covered here** — Stages 3 and 4, which get their own plans: §4 regime
classifier, §5.2 declining-industry ceiling, §5.3 terminal ROIC, §5.6 edge cases, §7.2
regime evidence, §7.3 benchmark provenance.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every code
step carries the code. The one deferred value — the mock option's exact shape in Task 3
Step 2 — names the file, the field and the pattern to follow, because that helper's option
plumbing is idiosyncratic and copying it wrongly is likelier than reading it.

**Type consistency.** `derive_terminal_growth(company_growth, wacc, *, ceiling, safety_margin)`
and `TerminalGrowthDerivation.{rate, binding_constraint, company_growth, ceiling,
wacc_safety_bound}` are used with those exact names in Tasks 2 and 4.
`binding_constraint` values are `"company" | "ceiling" | "wacc_safety" | "floor"` throughout
(the floor joined them in Task 2's fix round), plus `None` from Task 4's fix round where the
reconstruction cannot vouch for the rate.
`DCFSummary.wacc_minus_terminal_growth` and
`DCFSummary.terminal_growth_binding_constraint` are read in Task 3 under those names.

**One risk worth naming — and it was worse than this paragraph estimated.** Task 2 recovers
the derivation in the report builder rather than threading it from the params builder, so
the two disagree whenever a caller supplies hand-set params.

This called that the what-if sliders and judged the reconstruction "the useful reading".
Both were wrong, and Task 4's review caught it. `_valuation_params_from_metrics` has exactly
one caller — the bulk endpoint. All three single-ticker DCF routes take `params` from the
request body, and `apps/web/app/corporate/corporateUtils.ts:56` fills `terminal_growth_rate`
with `clamp(snapshot.growth / 100, -0.1, 0.1)`: company growth, no ceiling. So the divergent
path is the default path, not an edge case, and once Task 4 gave the reconstruction a
ceiling the real rate never passed through, the report named a bound that did not run —
`constraint=ceiling` beside a spread of 0.005 that can only be `wacc_safety`.

Task 4's fix round settled it: the constraint is emitted only when the reconstruction's rate
equals the rate that ran, and is `None` otherwise. A reconstruction that cannot vouch for
the number says nothing. Threading a real derivation record through `ValuationAssumptions`,
so a hand-set rate can be attributed honestly rather than merely disclaimed, is Stage 3.
