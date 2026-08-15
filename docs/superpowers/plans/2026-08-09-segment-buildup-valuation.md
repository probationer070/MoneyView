# Segment Build-Up Valuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give MoneyView a segment build-up, target-year DCF — N business segments each with their own TAM, share, margin and capital intensity, consolidated into a 10-year FCFF stream discounted at a time-varying WACC — persisted as hand-authored cases where every numeric input carries the narrative claim that justifies it.

**Architecture:** A new pure-math module `packages/core_finance/segment_valuation.py` (no I/O), orchestrated by `apps/api/services/valuation_case.py` over three new SQLite tables, exposed through `apps/api/routes/valuation.py`. It is additive: nothing in `dcf.py` or `corporate_dcf.py` changes. The enterprise-to-equity bridge is **reused** from `dcf.py`, not rewritten, because `EV + cash + proceeds − debt` is the same identity as `EV − net_debt + non_operating_assets`.

**Tech Stack:** Python 3, FastAPI, Pydantic v2, SQLite (`sqlite3` stdlib), pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md`
**Source:** `guideline/sop/todo3.md`

## Global Constraints

- **Units: billions throughout, including share counts.** `12.535`, never `12_535`. Fixed by `docs/dcf-valuation.md:225`.
- **Constraint violations raise `ValueError`; denominators are never epsilon-floored.** Follows the stance argued at `packages/core_finance/dcf.py:196`. Routes map `ValueError` → HTTP 422.
- **`packages/core_finance/` is pure.** No I/O, no DB, no network, no FastAPI imports. Per `guideline/sop/file-structure.md:42`.
- **Do not modify `packages/core_finance/dcf.py` or `apps/api/services/corporate_dcf.py`.** `corporate_dcf.py:157` floors `max(wacc - terminal_growth, 0.005)` in contradiction of `dcf.py:196`; that is pre-existing, works, and is out of scope. Leave it.
- **Do not touch `packages/shared-types`.** No frontend consumer exists until piece 3d.
- **All API routes are mounted under `/api/v1`.** `apps/api/main.py:179-188`. The spec's `/valuation/cases` is reached at `/api/v1/valuation/cases`.
- **Tests may not make network calls.** `tests/conftest.py` enforces this at session scope. Nothing in this plan needs the network.
- **Every test gets an isolated DB automatically.** The autouse `_isolated_db` fixture in `tests/conftest.py` repoints `db_service._DB_PATH` at `tmp_path` and calls `init_db()`. Do not open your own connection to `data/processed/moneyview.db`; a session fixture fails the test if you do.
- **Horizon is `n = target_year − base_year`.** Seeds use `base_year=2026, target_year=2036`, so `n = 10`.
- **Run tests with:** `python -m pytest tests/... -v` from the repo root (`C:\Learn\Economy\MoneyView`). `testpaths = ["tests"]` per `pyproject.toml:47`.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core_finance/segment_valuation.py` | **Create.** All segment build-up math. Dataclasses `SegmentSpec`, `CaseSpec`, `CaseResult`; path functions; `run_case`. Pure. |
| `tests/core_finance/test_segment_valuation.py` | **Create.** Engine unit tests, path invariants, trap tests. |
| `tests/core_finance/test_segment_valuation_spacex.py` | **Create.** The confirmed-input gates for both SpaceX cases, run against the engine directly. |
| `apps/api/services/db.py` | **Modify.** Append 3 tables to `_CREATE_SCHEMA_SQL` (ends near line 481). |
| `apps/api/models/schema_parts/valuation.py` | **Create.** Pydantic request/response models. |
| `apps/api/models/schemas.py` | **Modify.** Re-export the new models (import block ends near line 30+). |
| `apps/api/services/valuation_case.py` | **Create.** Persistence, the narrative rule, and the run orchestration. |
| `apps/api/services/valuation_seed.py` | **Create.** The two SpaceX fixtures, idempotent. |
| `apps/api/routes/valuation.py` | **Create.** Four endpoints. |
| `apps/api/routes/__init__.py` | **Modify.** Export `valuation_router`. |
| `apps/api/main.py` | **Modify.** Import and `include_router` at prefix `/api/v1/valuation`. |
| `tests/api/test_valuation_schema.py` | **Create.** Table/column existence. |
| `tests/api/test_valuation_case_service.py` | **Create.** Narrative rule, persistence round-trip. |
| `tests/api/test_valuation_routes.py` | **Create.** Endpoint behaviour. |
| `tests/api/test_valuation_seed.py` | **Create.** Seed idempotency and end-to-end gates through HTTP. |

---

## Task 1: Segment specs and the revenue path

**Files:**
- Create: `packages/core_finance/segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `SegmentSpec` (frozen dataclass), `SegmentSpec.target_revenue() -> float`, `revenue_path(spec: SegmentSpec, n: int, g_stable: float) -> list[float]`.

**Background you need.** Damodaran's model fixes revenue at a *target year* (`TAM × market share`, or a directly stated revenue) and then interpolates backwards to today. Growth is front-loaded and decays to a stable rate. So the path is not "compound at g%"; it is "find the `g₁` whose decaying schedule lands exactly on the target." One unknown, one equation, and the product is strictly monotone in `g₁` — so bisection solves it exactly and deterministically. Do not use `scipy`; a hand-rolled bisection is 12 lines and the repo has no scipy dependency.

A segment with `base_revenue = 0` (the "expansion options" pseudo-segment) has no growth rate that reaches a positive target from zero, so it takes a linear ramp instead.

- [ ] **Step 1: Write the failing tests**

Create `tests/core_finance/test_segment_valuation.py`:

```python
import pytest

from packages.core_finance.segment_valuation import SegmentSpec, revenue_path


def _launch() -> SegmentSpec:
    return SegmentSpec(
        name="launch",
        base_revenue=4.1,
        base_margin=-0.10,
        margin_target=0.45,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        tam_target=100.0,
        market_share_target=0.70,
    )


def test_target_revenue_is_tam_times_share():
    assert _launch().target_revenue() == pytest.approx(70.0)


def test_target_revenue_prefers_explicit_override():
    spec = SegmentSpec(
        name="ai",
        base_revenue=0.1,
        base_margin=-0.50,
        margin_target=0.25,
        sales_to_capital_early=0.6,
        sales_to_capital_late=1.0,
        revenue_target=160.0,
    )
    assert spec.target_revenue() == pytest.approx(160.0)


def test_target_revenue_raises_without_tam_share_or_override():
    spec = SegmentSpec(
        name="broken",
        base_revenue=1.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.0,
    )
    with pytest.raises(ValueError, match="broken"):
        spec.target_revenue()


def test_revenue_path_lands_exactly_on_target():
    path = revenue_path(_launch(), n=10, g_stable=0.0456)
    assert len(path) == 10
    assert path[-1] == pytest.approx(70.0, abs=1e-9)


def test_revenue_growth_decays_monotonically():
    """Front-loaded growth is the whole point of the target-year template.

    Checking the growth *rates* rather than the revenue levels: revenue rises
    every year in any growing path, so asserting on levels would pass even for
    a uniform CAGR, which is exactly the shape this curve exists not to be.
    """
    path = revenue_path(_launch(), n=10, g_stable=0.0456)
    levels = [4.1, *path]
    growths = [levels[i + 1] / levels[i] - 1 for i in range(len(path))]
    assert all(growths[i] > growths[i + 1] for i in range(len(growths) - 1))
    assert growths[-1] == pytest.approx(0.0456, abs=1e-9)


def test_ramped_segment_is_zero_until_ramp_start_then_linear():
    spec = SegmentSpec(
        name="expansion",
        base_revenue=0.0,
        base_margin=0.0,
        margin_target=0.30,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=50.0,
        ramp_start_year=7,
    )
    path = revenue_path(spec, n=10, g_stable=0.0456)
    assert path[:6] == [0.0] * 6
    assert path[6:] == pytest.approx([12.5, 25.0, 37.5, 50.0])


def test_revenue_path_rejects_unreachable_target():
    spec = SegmentSpec(
        name="shrinking",
        base_revenue=100.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.0,
        revenue_target=-5.0,
    )
    with pytest.raises(ValueError, match="positive"):
        revenue_path(spec, n=10, g_stable=0.0456)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'packages.core_finance.segment_valuation'`

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core_finance/segment_valuation.py`:

```python
"""Segment build-up, target-year DCF -- pure Python.

Damodaran's young-company / big-market template, as reconstructed in
`guideline/sop/todo3.md`. Each business segment carries its own market size,
share, margin and capital intensity; the segments consolidate into one FCFF
stream discounted at a time-varying WACC.

Distinct from `dcf.py`, which values a single FCFF stream over five years at a
constant discount rate. Both are wanted; neither subsumes the other.

Everything here is pure: no I/O, no database, no network. Amounts are in
billions, share counts in billions of shares, rates as decimal fractions.
"""

from __future__ import annotations

from dataclasses import dataclass

# Bisection bounds for the year-1 growth rate. The lower bound stays above -1 so
# every (1 + g_t) factor is positive and the product stays monotone; the upper
# bound is far past any credible growth rate and costs nothing to carry.
_G1_LOW = -0.99
_G1_HIGH = 1000.0
_BISECTION_STEPS = 200


@dataclass(frozen=True)
class SegmentSpec:
    """One business segment of a valuation case.

    `base_margin` is the **R&D-adjusted** operating margin. R&D capitalization is
    not implemented (see the spec, section 7.2), so the base margin is taken to
    already reflect the adjustment rather than having it applied on top.
    """

    name: str
    base_revenue: float
    base_margin: float
    margin_target: float
    sales_to_capital_early: float          # years 1..5
    sales_to_capital_late: float           # years 6..n
    tam_target: float | None = None
    market_share_target: float | None = None
    revenue_target: float | None = None
    ramp_start_year: int = 1

    def target_revenue(self) -> float:
        """Revenue in the target year -- todo3 R1.

        An explicit `revenue_target` wins over `tam x share`, which is how a
        segment with no meaningful addressable market (xAI, expansion options)
        states its endpoint directly.
        """
        if self.revenue_target is not None:
            return float(self.revenue_target)
        if self.tam_target is None or self.market_share_target is None:
            raise ValueError(
                f"{self.name}: need (tam_target x market_share_target) or an "
                f"explicit revenue_target"
            )
        return float(self.tam_target) * float(self.market_share_target)


def _decaying_growth_rates(g_first: float, n: int, g_stable: float) -> list[float]:
    """Growth decaying linearly from `g_first` in year 1 to `g_stable` in year n."""
    if n < 2:
        return [g_stable]
    return [
        g_first - (g_first - g_stable) * (t - 1) / (n - 1)
        for t in range(1, n + 1)
    ]


def _compound(g_first: float, n: int, g_stable: float) -> float:
    product = 1.0
    for rate in _decaying_growth_rates(g_first, n, g_stable):
        product *= 1.0 + rate
    return product


def _solve_first_year_growth(ratio: float, n: int, g_stable: float) -> float:
    """Find the year-1 growth whose decaying schedule compounds to `ratio`.

    The compounded product is strictly increasing in `g_first` -- every factor
    carries a non-negative weight on it -- so bisection converges without
    needing a derivative, and without a scipy dependency this repo does not have.
    """
    low, high = _G1_LOW, _G1_HIGH
    if not _compound(low, n, g_stable) <= ratio <= _compound(high, n, g_stable):
        raise ValueError(
            f"target revenue ratio {ratio:.6g} is unreachable with a decaying "
            f"growth path over {n} years ending at {g_stable:.4%}"
        )
    for _ in range(_BISECTION_STEPS):
        mid = (low + high) / 2
        if _compound(mid, n, g_stable) < ratio:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def _ramp_revenues(target: float, n: int, ramp_start_year: int) -> list[float]:
    """Zero until `ramp_start_year`, then linear to `target` in year n."""
    lead = ramp_start_year - 1
    steps = n - lead
    if steps < 1:
        raise ValueError(
            f"ramp_start_year {ramp_start_year} leaves no years to ramp over "
            f"within a {n}-year horizon"
        )
    return [0.0] * lead + [target * step / steps for step in range(1, steps + 1)]


def revenue_path(spec: SegmentSpec, n: int, g_stable: float) -> list[float]:
    """Revenue for years 1..n, terminating exactly on the target -- todo3 R3.

    Two shapes. A segment with revenue today decays its growth from a solved
    year-1 rate down to `g_stable`. A segment starting from zero, or one held
    back by `ramp_start_year`, ramps linearly instead: no growth rate reaches a
    positive target from a base of zero.
    """
    target = spec.target_revenue()
    if target <= 0:
        raise ValueError(f"{spec.name}: target revenue must be positive, got {target}")

    if spec.ramp_start_year > 1 or spec.base_revenue == 0:
        return _ramp_revenues(target, n, spec.ramp_start_year)

    if spec.base_revenue < 0:
        raise ValueError(f"{spec.name}: base_revenue must not be negative")

    g_first = _solve_first_year_growth(target / spec.base_revenue, n, g_stable)
    revenues: list[float] = []
    level = spec.base_revenue
    for rate in _decaying_growth_rates(g_first, n, g_stable):
        level *= 1.0 + rate
        revenues.append(level)
    return revenues
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core_finance/segment_valuation.py tests/core_finance/test_segment_valuation.py
git commit -m "feat: segment revenue path with solved decaying growth"
```

---

## Task 2: Margin path and reinvestment

**Files:**
- Modify: `packages/core_finance/segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation.py`

**Interfaces:**
- Consumes: `SegmentSpec` from Task 1.
- Produces: `margin_path(spec: SegmentSpec, n: int) -> list[float]`, `reinvestment(revenues: list[float], spec: SegmentSpec) -> list[float]`.

**Background.** Margins converge from a (usually negative) base to a target by the final year. Reinvestment in this template has **no** separate capex / depreciation / working-capital schedule — it is entirely `ΔRevenue / salesToCapital`. A lower sales-to-capital ratio means more capital consumed per dollar of new revenue.

The trap: a segment that has not started ramping must book **zero** reinvestment, or the model charges capital against revenue that does not exist yet (todo3 §9.2 trap 6).

- [ ] **Step 1: Write the failing tests**

Append to `tests/core_finance/test_segment_valuation.py`:

```python
from packages.core_finance.segment_valuation import margin_path, reinvestment


def test_margin_starts_at_base_and_ends_at_target():
    path = margin_path(_launch(), n=10)
    assert path[0] == pytest.approx(-0.10)
    assert path[-1] == pytest.approx(0.45)


def test_margin_converges_linearly():
    path = margin_path(_launch(), n=10)
    steps = [path[i + 1] - path[i] for i in range(len(path) - 1)]
    assert steps == pytest.approx([steps[0]] * len(steps))


def test_reinvestment_is_revenue_delta_over_sales_to_capital():
    spec = SegmentSpec(
        name="s",
        base_revenue=10.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=2.0,
        sales_to_capital_late=4.0,
        revenue_target=20.0,
    )
    revenues = [12.0, 14.0, 15.0, 16.0, 17.0, 18.0]
    result = reinvestment(revenues, spec)
    # Years 1-5 use the early ratio, year 6 the late one.
    assert result == pytest.approx([1.0, 1.0, 0.5, 0.5, 0.5, 0.25])


def test_ramped_segment_books_no_reinvestment_before_ramp_start():
    """todo3 trap 6: capital must not be charged against revenue that does not exist."""
    spec = SegmentSpec(
        name="expansion",
        base_revenue=0.0,
        base_margin=0.0,
        margin_target=0.30,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=50.0,
        ramp_start_year=7,
    )
    revenues = revenue_path(spec, n=10, g_stable=0.0456)
    result = reinvestment(revenues, spec)
    assert result[:6] == [0.0] * 6
    assert all(value > 0 for value in result[6:])


def test_reinvestment_rejects_non_positive_sales_to_capital():
    spec = SegmentSpec(
        name="s",
        base_revenue=10.0,
        base_margin=0.0,
        margin_target=0.2,
        sales_to_capital_early=0.0,
        sales_to_capital_late=1.0,
        revenue_target=20.0,
    )
    with pytest.raises(ValueError, match="sales_to_capital"):
        reinvestment([12.0], spec)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: FAIL — `ImportError: cannot import name 'margin_path'`

- [ ] **Step 3: Write the minimal implementation**

Append to `packages/core_finance/segment_valuation.py`:

```python
_EARLY_YEARS = 5


def margin_path(spec: SegmentSpec, n: int) -> list[float]:
    """Operating margin for years 1..n -- todo3 P2.

    Converges linearly from `base_margin` in year 1 to `margin_target` in year n:
    phi(1) = 1, phi(n) = 0. todo3 notes Damodaran typically back-loads this
    convergence, but tags the shape as unconfirmed. An invented back-loading
    exponent would be precision the source does not support, so this stays linear
    until the spreadsheets are available to calibrate it.
    """
    if n < 2:
        return [spec.margin_target]
    spread = spec.margin_target - spec.base_margin
    return [
        spec.margin_target - spread * (n - t) / (n - 1)
        for t in range(1, n + 1)
    ]


def reinvestment(revenues: list[float], spec: SegmentSpec) -> list[float]:
    """Capital consumed per year -- todo3 I1.

    `(Rev_t - Rev_t-1) / salesToCapital_t`. This is the only reinvestment
    mechanism in the template: there is no separate capex, depreciation or
    working-capital schedule to reconcile against.

    Years before `ramp_start_year` book zero regardless of the revenue series.
    For a segment ramping from a zero base the delta is already zero, but the
    guard also covers a segment held back from a non-zero base, where it is not.
    """
    amounts: list[float] = []
    previous = spec.base_revenue
    for index, revenue in enumerate(revenues):
        year = index + 1
        if year < spec.ramp_start_year:
            amounts.append(0.0)
            previous = revenue
            continue
        ratio = (
            spec.sales_to_capital_early
            if year <= _EARLY_YEARS
            else spec.sales_to_capital_late
        )
        if ratio <= 0:
            raise ValueError(
                f"{spec.name}: sales_to_capital must be positive, got {ratio}"
            )
        amounts.append((revenue - previous) / ratio)
        previous = revenue
    return amounts
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: PASS, 15 tests (10 from Task 1 including its fix round, plus 5 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core_finance/segment_valuation.py tests/core_finance/test_segment_valuation.py
git commit -m "feat: segment margin convergence and sales-to-capital reinvestment"
```

---

## Task 3: NOL tax path, time-varying WACC, cumulative discount factors

**Files:**
- Modify: `packages/core_finance/segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (these three are independent of `SegmentSpec`).
- Produces: `tax_path(ebit: list[float], marginal_rate: float, nol_balance: float) -> list[float]` (returns tax **amounts**, not rates), `wacc_path(wacc_initial: float, wacc_stable: float, n: int, converge_from: int) -> list[float]`, `discount_factors(waccs: list[float]) -> list[float]`.

**Background — this task contains the single most important bug guard in the plan.** When the discount rate varies by year, the discount factor is a **cumulative product** `DF_t = DF_{t−1} / (1 + w_t)`, not `1 / (1 + w)^t`. todo3 §9.2 names writing the latter as the common implementation bug. The two agree only when every `w_t` is identical, which is exactly why the mistake survives casual testing.

A young company with accumulated losses pays no tax until they are used up, which materially shifts early-year cash flow. So tax is a rollforward, not a rate multiplication.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core_finance/test_segment_valuation.py`:

```python
from packages.core_finance.segment_valuation import (
    discount_factors,
    tax_path,
    wacc_path,
)


def test_no_tax_while_losses_shield_income():
    """15 of shield against 10/10/10: year 1 fully sheltered, year 2 half, year 3 none."""
    taxes = tax_path([10.0, 10.0, 10.0], marginal_rate=0.25, nol_balance=15.0)
    assert taxes == pytest.approx([0.0, 1.25, 2.5])


def test_losses_accumulate_into_the_shield():
    taxes = tax_path([-5.0, 10.0], marginal_rate=0.25, nol_balance=0.0)
    assert taxes == pytest.approx([0.0, 1.25])


def test_total_tax_equals_marginal_rate_on_income_net_of_shield():
    ebit = [20.0, 30.0, 50.0]
    taxes = tax_path(ebit, marginal_rate=0.25, nol_balance=40.0)
    assert sum(taxes) == pytest.approx(0.25 * (sum(ebit) - 40.0))


def test_wacc_holds_then_converges_linearly_to_stable():
    path = wacc_path(0.0837, 0.0825, n=10, converge_from=6)
    assert path[:4] == pytest.approx([0.0837] * 4)
    assert path[-1] == pytest.approx(0.0825)
    tail = path[4:]
    steps = [tail[i + 1] - tail[i] for i in range(len(tail) - 1)]
    assert steps == pytest.approx([steps[0]] * len(steps))


def test_wacc_rejects_converge_point_outside_the_horizon():
    with pytest.raises(ValueError, match="converge_from"):
        wacc_path(0.0837, 0.0825, n=10, converge_from=11)


def test_discount_factors_are_a_cumulative_product():
    """todo3 trap 1. The `(1+w)^t` form is wrong whenever WACC varies by year.

    Asserted as the recurrence rather than against hardcoded numbers, because
    the recurrence is the property that distinguishes the two formulas -- a
    hardcoded expectation would have to be computed by one of them.
    """
    waccs = wacc_path(0.0837, 0.0825, n=10, converge_from=6)
    factors = discount_factors(waccs)
    assert factors[0] == pytest.approx(1 / (1 + waccs[0]))
    for t in range(1, len(factors)):
        assert factors[t] == pytest.approx(factors[t - 1] / (1 + waccs[t]), abs=1e-12)


def test_cumulative_and_power_forms_diverge_when_wacc_varies():
    """Proves the previous test is load-bearing and not vacuous."""
    waccs = wacc_path(0.0837, 0.0825, n=10, converge_from=6)
    factors = discount_factors(waccs)
    naive = 1 / (1 + waccs[0]) ** len(waccs)
    assert abs(factors[-1] - naive) > 1e-6
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: FAIL — `ImportError: cannot import name 'discount_factors'`

- [ ] **Step 3: Write the minimal implementation**

Append to `packages/core_finance/segment_valuation.py`:

```python
def tax_path(
    ebit: list[float],
    marginal_rate: float,
    nol_balance: float,
) -> list[float]:
    """Tax paid per year, net of accumulated losses -- todo3 F2.

    Returns amounts, not rates. A company with a loss carryforward pays nothing
    until the balance is exhausted, which is not a detail: it moves cash flow
    into the early years, where discounting hurts it least.

    Losses in the forecast add to the balance rather than generating a refund.
    """
    taxes: list[float] = []
    balance = float(nol_balance)
    for amount in ebit:
        if amount <= 0:
            balance += -amount
            taxes.append(0.0)
            continue
        shield = min(balance, amount)
        balance -= shield
        taxes.append((amount - shield) * marginal_rate)
    return taxes


def wacc_path(
    wacc_initial: float,
    wacc_stable: float,
    n: int,
    converge_from: int,
) -> list[float]:
    """Cost of capital per year -- todo3 F3.

    Flat at `wacc_initial` through year `converge_from - 1`, then linear to
    `wacc_stable` in year n. A young firm's risk profile migrates toward the
    market as it matures, so a single constant rate over ten years is wrong in
    a way that compounds.
    """
    if not 1 <= converge_from <= n:
        raise ValueError(
            f"converge_from must be between 1 and {n}, got {converge_from}"
        )
    lead = converge_from - 1
    span = n - lead
    spread = wacc_stable - wacc_initial
    return [
        wacc_initial if t <= lead else wacc_initial + spread * (t - lead) / span
        for t in range(1, n + 1)
    ]


def discount_factors(waccs: list[float]) -> list[float]:
    """Present-value factors for a time-varying discount rate -- todo3 F4.

    A cumulative product: DF_t = DF_t-1 / (1 + w_t). NOT 1 / (1 + w)^t, which is
    only correct when every rate is identical and is the standard way this model
    gets silently mis-implemented.
    """
    factors: list[float] = []
    accumulated = 1.0
    for wacc in waccs:
        if wacc <= -1:
            raise ValueError(f"wacc must exceed -100%, got {wacc}")
        accumulated /= 1.0 + wacc
        factors.append(accumulated)
    return factors
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: PASS, 22 tests (15 existing plus 7 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core_finance/segment_valuation.py tests/core_finance/test_segment_valuation.py
git commit -m "feat: NOL tax rollforward, converging WACC, cumulative discount factors"
```

---

## Task 4: Terminal value, case assembly, and the SpaceX confirmed-input gates

**Files:**
- Modify: `packages/core_finance/segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation_spacex.py` (create)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `CaseSpec` (frozen dataclass), `CaseResult` (frozen dataclass), `terminal_value(ebit_n, marginal_rate, g_stable, roic_stable, wacc_stable) -> float`, `run_case(case: CaseSpec, segments: list[SegmentSpec]) -> CaseResult`.

**Background.** Terminal value is usually the majority of a big-market valuation, and it is extremely sensitive to the `WACC − g` spread — 3.69 percentage points in the SpaceX case. Three guards matter:

- **The growth cap.** Perpetual growth cannot exceed the riskfree rate. `CaseSpec.terminal_growth` is optional and defaults to `riskfree_rate`; when supplied it is rejected if it exceeds it.
- **Terminal reinvestment must be consistent with terminal growth**: `ReinvRate = g / ROIC_stable`. Otherwise the model grows forever with no capital behind it.
- **`ROIC_stable > WACC_stable` whenever `g > 0`**, or the terminal value implies growth that destroys value.

The equity bridge is **reused** from `dcf.py`. `EV + cash + proceeds − debt` is `EV − net_debt + non_operating_assets` under `net_debt = debt − cash` and `non_operating_assets = proceeds`. Import it; do not reimplement it.

- [ ] **Step 1: Write the failing engine tests**

Append to `tests/core_finance/test_segment_valuation.py`:

```python
from packages.core_finance.segment_valuation import CaseSpec, run_case, terminal_value


def _case(**overrides) -> CaseSpec:
    defaults = dict(
        base_year=2026,
        target_year=2036,
        riskfree_rate=0.0456,
        wacc_initial=0.0837,
        wacc_stable=0.0825,
        wacc_converge_from=6,
        marginal_tax_rate=0.25,
        nol_balance=5.0,
        roic_stable=0.12,
        cash=24.7,
        debt=22.9,
        ipo_proceeds=75.0,
        shares_basic=12.535,
        shares_new=0.556,
    )
    defaults.update(overrides)
    return CaseSpec(**defaults)


def test_terminal_value_discounts_growth_consistent_reinvestment():
    value = terminal_value(
        ebit_n=100.0,
        marginal_rate=0.25,
        g_stable=0.0456,
        roic_stable=0.12,
        wacc_stable=0.0825,
    )
    reinvestment_rate = 0.0456 / 0.12
    fcff = 100.0 * 1.0456 * 0.75 * (1 - reinvestment_rate)
    assert value == pytest.approx(fcff / (0.0825 - 0.0456))


def test_terminal_growth_above_riskfree_rate_raises():
    """todo3 trap 2 -- the cap is enforced, not warned about."""
    with pytest.raises(ValueError, match="riskfree"):
        _case(terminal_growth=0.06)


def test_terminal_growth_defaults_to_the_riskfree_rate():
    assert _case().effective_terminal_growth() == pytest.approx(0.0456)


def test_roic_at_or_below_wacc_with_positive_growth_raises():
    """todo3 trap 3 -- otherwise terminal growth destroys value."""
    with pytest.raises(ValueError, match="roic_stable"):
        terminal_value(
            ebit_n=100.0,
            marginal_rate=0.25,
            g_stable=0.0456,
            roic_stable=0.08,
            wacc_stable=0.0825,
        )


def test_wacc_at_or_below_terminal_growth_raises():
    """todo3 trap 5 -- the denominator is not floored to fake a finite answer."""
    with pytest.raises(ValueError, match="spread"):
        terminal_value(
            ebit_n=100.0,
            marginal_rate=0.25,
            g_stable=0.09,
            roic_stable=0.12,
            wacc_stable=0.0825,
        )


def test_run_case_exposes_the_terminal_spread():
    result = run_case(_case(), [_launch()])
    assert result.terminal_spread == pytest.approx(0.0825 - 0.0456)


def test_equity_bridge_matches_the_shared_dcf_helper():
    """The reuse in the design is an identity, not a coincidence."""
    from packages.core_finance.dcf import calculate_equity_value

    case = _case()
    result = run_case(case, [_launch()])
    assert result.equity_value == pytest.approx(
        calculate_equity_value(
            enterprise_value=result.enterprise_value,
            net_debt=case.debt - case.cash,
            non_operating_assets=case.ipo_proceeds,
        )
    )


def test_value_per_share_uses_basic_plus_new_shares():
    case = _case()
    result = run_case(case, [_launch()])
    assert result.value_per_share_diluted == pytest.approx(
        result.equity_value / (case.shares_basic + case.shares_new)
    )
    assert result.value_per_share_basic == pytest.approx(
        result.equity_value / case.shares_basic
    )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: FAIL — `ImportError: cannot import name 'CaseSpec'`

- [ ] **Step 3: Write the implementation**

Append to `packages/core_finance/segment_valuation.py`. Add this import at the **top** of the file, below the existing `from dataclasses import dataclass`:

```python
from packages.core_finance.dcf import (
    calculate_equity_value,
    calculate_intrinsic_value_per_share,
)
```

Then append:

```python
@dataclass(frozen=True)
class CaseSpec:
    """Firm-level inputs for one valuation case.

    `terminal_growth` is optional and defaults to `riskfree_rate`, which is what
    Damodaran uses. It exists as a separate field so the cap in todo3 F5 has
    something to reject: a value *defined* as the riskfree rate could never
    exceed it, and the rule would be unenforceable.
    """

    base_year: int
    target_year: int
    riskfree_rate: float
    wacc_initial: float
    wacc_stable: float
    wacc_converge_from: int
    marginal_tax_rate: float
    nol_balance: float
    roic_stable: float
    cash: float
    debt: float
    ipo_proceeds: float
    shares_basic: float
    shares_new: float
    terminal_growth: float | None = None

    def __post_init__(self) -> None:
        if self.target_year <= self.base_year:
            raise ValueError(
                f"target_year {self.target_year} must be after base_year {self.base_year}"
            )
        if self.terminal_growth is not None and self.terminal_growth > self.riskfree_rate:
            raise ValueError(
                f"terminal growth {self.terminal_growth:.4%} exceeds the riskfree "
                f"rate {self.riskfree_rate:.4%} -- perpetual growth is capped there"
            )
        if self.shares_basic <= 0:
            raise ValueError(f"shares_basic must be positive, got {self.shares_basic}")

    @property
    def horizon(self) -> int:
        return self.target_year - self.base_year

    def effective_terminal_growth(self) -> float:
        if self.terminal_growth is None:
            return self.riskfree_rate
        return self.terminal_growth


@dataclass(frozen=True)
class SegmentResult:
    name: str
    revenue: list[float]
    margin: list[float]
    ebit: list[float]
    reinvestment: list[float]


@dataclass(frozen=True)
class CaseResult:
    segments: list[SegmentResult]
    revenue: list[float]
    ebit: list[float]
    tax: list[float]
    reinvestment: list[float]
    fcff: list[float]
    wacc: list[float]
    discount_factor: list[float]
    pv_explicit: float
    terminal_value: float
    pv_terminal: float
    enterprise_value: float
    equity_value: float
    value_per_share_basic: float
    value_per_share_diluted: float
    terminal_spread: float
    terminal_value_share_pct: float
    base_revenue_total: float
    base_ebit_total: float


def terminal_value(
    ebit_n: float,
    marginal_rate: float,
    g_stable: float,
    roic_stable: float,
    wacc_stable: float,
) -> float:
    """Gordon growth terminal value with consistent reinvestment -- todo3 F6-F8.

    Three guards, all raising rather than warning or flooring:

    - the WACC-to-growth spread must be positive, and is not clamped to some
      epsilon: a large finite number at the point where the model has no value
      is worse than no number at all (the argument at dcf.py:196)
    - ROIC in stable growth must beat the cost of capital whenever growth is
      positive, or the perpetuity is growing while destroying value
    - ROIC must be positive, or the reinvestment rate is undefined
    """
    spread = wacc_stable - g_stable
    if spread <= 0:
        raise ValueError(
            f"terminal spread is not positive: wacc {wacc_stable:.4%} must exceed "
            f"growth {g_stable:.4%}"
        )
    if roic_stable <= 0:
        raise ValueError(f"roic_stable must be positive, got {roic_stable}")
    if g_stable > 0 and roic_stable <= wacc_stable:
        raise ValueError(
            f"roic_stable {roic_stable:.4%} must exceed wacc_stable "
            f"{wacc_stable:.4%} when terminal growth is positive, otherwise "
            f"terminal growth destroys value"
        )
    reinvestment_rate = g_stable / roic_stable
    fcff_next = ebit_n * (1 + g_stable) * (1 - marginal_rate) * (1 - reinvestment_rate)
    return fcff_next / spread


def run_case(case: CaseSpec, segments: list[SegmentSpec]) -> CaseResult:
    """Value one case end to end: segments in, value per share out."""
    if not segments:
        raise ValueError("a valuation case needs at least one segment")

    n = case.horizon
    g_stable = case.effective_terminal_growth()

    segment_results: list[SegmentResult] = []
    for spec in segments:
        revenues = revenue_path(spec, n, g_stable)
        margins = margin_path(spec, n)
        segment_results.append(
            SegmentResult(
                name=spec.name,
                revenue=revenues,
                margin=margins,
                ebit=[r * m for r, m in zip(revenues, margins)],
                reinvestment=reinvestment(revenues, spec),
            )
        )

    revenue = [sum(s.revenue[t] for s in segment_results) for t in range(n)]
    ebit = [sum(s.ebit[t] for s in segment_results) for t in range(n)]
    reinvest = [sum(s.reinvestment[t] for s in segment_results) for t in range(n)]

    tax = tax_path(ebit, case.marginal_tax_rate, case.nol_balance)
    fcff = [ebit[t] - tax[t] - reinvest[t] for t in range(n)]

    waccs = wacc_path(case.wacc_initial, case.wacc_stable, n, case.wacc_converge_from)
    factors = discount_factors(waccs)

    pv_explicit = sum(fcff[t] * factors[t] for t in range(n))
    tv = terminal_value(
        ebit_n=ebit[-1],
        marginal_rate=case.marginal_tax_rate,
        g_stable=g_stable,
        roic_stable=case.roic_stable,
        wacc_stable=case.wacc_stable,
    )
    pv_terminal = tv * factors[-1]
    enterprise_value = pv_explicit + pv_terminal

    # todo3 E1/E3: IPO proceeds are held as cash, so they are a firm-value term,
    # not an enterprise-value one. Expressed through the shared bridge helper --
    # EV + cash + proceeds - debt is EV - net_debt + non_operating_assets.
    equity_value = calculate_equity_value(
        enterprise_value=enterprise_value,
        net_debt=case.debt - case.cash,
        non_operating_assets=case.ipo_proceeds,
    )

    return CaseResult(
        segments=segment_results,
        revenue=revenue,
        ebit=ebit,
        tax=tax,
        reinvestment=reinvest,
        fcff=fcff,
        wacc=waccs,
        discount_factor=factors,
        pv_explicit=pv_explicit,
        terminal_value=tv,
        pv_terminal=pv_terminal,
        enterprise_value=enterprise_value,
        equity_value=equity_value,
        value_per_share_basic=calculate_intrinsic_value_per_share(
            equity_value, case.shares_basic
        ),
        value_per_share_diluted=calculate_intrinsic_value_per_share(
            equity_value, case.shares_basic + case.shares_new
        ),
        terminal_spread=case.wacc_stable - g_stable,
        terminal_value_share_pct=(
            pv_terminal / enterprise_value * 100 if enterprise_value else 0.0
        ),
        base_revenue_total=sum(s.base_revenue for s in segments),
        base_ebit_total=sum(s.base_revenue * s.base_margin for s in segments),
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: PASS, 30 tests (22 existing plus 8 new).

- [ ] **Step 5: Write the SpaceX confirmed-input gates**

These are the acceptance tests for the whole engine. They assert **only** what todo3 §3 confirms — target-year revenue and EBIT — because every other input is an uncalibrated guess. Create `tests/core_finance/test_segment_valuation_spacex.py`:

```python
"""Confirmed-input gates for Damodaran's two SpaceX cases.

Everything asserted here is determined by inputs todo3 tags as confirmed. The
revenue path terminates on `target_revenue` by construction and phi(n) = 0 makes
the final margin equal `margin_target`, so target-year revenue and EBIT are
functions of TAM, market share and target margin alone -- independent of the
base margins, sales-to-capital ratios, tax rate and NOL balance, all of which
are guesses pending the spreadsheets.

Enterprise value is deliberately NOT asserted. See the design spec, section 1.2.

This case data is also present in `apps/api/services/valuation_seed.py`, and the
duplication is deliberate. These gates test the engine, which lives in
`packages/core_finance` and must not import from `apps/api` -- the dependency runs
one way (guideline/sop/file-structure.md:42). Importing the seed here would invert
it, and dropping these gates in favour of the seed's would leave the engine with no
acceptance test at its own commit.
"""

import pytest

from packages.core_finance.segment_valuation import CaseSpec, SegmentSpec, run_case

# Base-year (FY2025) revenues. Derived, not stated -- but corroborated twice by
# todo3 section 6: 1250 / 80.13 = 15.60 and 1750 / 112.18 = 15.60, both of which
# match the 4.1 + 11.4 + 0.1 + 0 = 15.6 suggested in section 9.4.
BASE_REVENUE = {"launch": 4.1, "connectivity": 11.4, "ai": 0.1, "expansion": 0.0}
BASE_MARGIN = {"launch": -0.10, "connectivity": 0.02, "ai": -0.50, "expansion": 0.0}


def _segment(name, *, margin_target, s2c_early, s2c_late, **endpoint) -> SegmentSpec:
    return SegmentSpec(
        name=name,
        base_revenue=BASE_REVENUE[name],
        base_margin=BASE_MARGIN[name],
        margin_target=margin_target,
        sales_to_capital_early=s2c_early,
        sales_to_capital_late=s2c_late,
        ramp_start_year=7 if name == "expansion" else 1,
        **endpoint,
    )


def pre_prospectus() -> tuple[CaseSpec, list[SegmentSpec]]:
    case = CaseSpec(
        base_year=2026, target_year=2036,
        riskfree_rate=0.0420, wacc_initial=0.0802, wacc_stable=0.0800,
        wacc_converge_from=6, marginal_tax_rate=0.25, nol_balance=5.0,
        roic_stable=0.12,
        cash=0.0, debt=0.0, ipo_proceeds=0.0,
        shares_basic=2.467, shares_new=0.0,
    )
    segments = [
        _segment("launch", tam_target=100.0, market_share_target=0.70,
                 margin_target=0.40, s2c_early=1.5, s2c_late=2.0),
        _segment("connectivity", tam_target=160.0, market_share_target=0.75,
                 margin_target=0.60, s2c_early=1.5, s2c_late=2.0),
        # 45%, not 50%. todo3 section 3 footnote 1 documents the conflict: S1's
        # text says 50%, S2 restates the same assumption as 45%, and section 3's
        # own derived table uses 45%.
        _segment("ai", revenue_target=80.0, margin_target=0.45,
                 s2c_early=0.8, s2c_late=1.2),
        _segment("expansion", revenue_target=50.0, margin_target=0.30,
                 s2c_early=1.0, s2c_late=1.5),
    ]
    return case, segments


def post_prospectus() -> tuple[CaseSpec, list[SegmentSpec]]:
    case = CaseSpec(
        base_year=2026, target_year=2036,
        riskfree_rate=0.0456, wacc_initial=0.0837, wacc_stable=0.0825,
        wacc_converge_from=6, marginal_tax_rate=0.25, nol_balance=5.0,
        roic_stable=0.12,
        cash=24.7, debt=22.9, ipo_proceeds=75.0,
        shares_basic=12.535, shares_new=0.556,
    )
    segments = [
        _segment("launch", tam_target=100.0, market_share_target=0.70,
                 margin_target=0.45, s2c_early=1.0, s2c_late=1.5),
        _segment("connectivity", tam_target=160.0, market_share_target=0.75,
                 margin_target=0.60, s2c_early=1.0, s2c_late=1.5),
        _segment("ai", revenue_target=160.0, margin_target=0.25,
                 s2c_early=0.6, s2c_late=1.0),
        _segment("expansion", revenue_target=50.0, margin_target=0.30,
                 s2c_early=1.0, s2c_late=1.5),
    ]
    return case, segments


def test_pre_prospectus_target_year_totals():
    """todo3 section 3: $320bn revenue, $151bn EBIT in 2036."""
    case, segments = pre_prospectus()
    result = run_case(case, segments)
    assert result.revenue[-1] == pytest.approx(320.0, abs=1e-6)
    assert result.ebit[-1] == pytest.approx(151.0, abs=1e-6)


def test_post_prospectus_target_year_totals():
    """todo3 section 3: $400bn revenue, $158.5bn EBIT in 2036."""
    case, segments = post_prospectus()
    result = run_case(case, segments)
    assert result.revenue[-1] == pytest.approx(400.0, abs=1e-6)
    assert result.ebit[-1] == pytest.approx(158.5, abs=1e-6)


def test_pre_prospectus_revenue_matches_the_forward_multiple():
    """Independent corroboration: todo3 section 6 quotes a 3.91x forward
    EV/Sales at a $1.25T price, and 1250 / 3.91 = 319.7."""
    case, segments = pre_prospectus()
    result = run_case(case, segments)
    assert result.revenue[-1] == pytest.approx(1250 / 3.91, rel=0.002)


def test_base_revenue_reconciles_with_trailing_multiples():
    """todo3 section 6 derives 2025 revenue twice: 1250/80.13 and 1750/112.18."""
    for builder in (pre_prospectus, post_prospectus):
        case, segments = builder()
        result = run_case(case, segments)
        assert result.base_revenue_total == pytest.approx(15.6, abs=0.05)
        assert result.base_revenue_total == pytest.approx(1250 / 80.13, abs=0.05)
        assert result.base_revenue_total == pytest.approx(1750 / 112.18, abs=0.05)


def test_offsetting_changes_barely_move_target_year_ebit():
    """todo3 section 3's central finding: AI revenue doubling and the launch
    margin uplift are almost exactly cancelled by the AI margin collapse. A
    277-page prospectus moved target-year EBIT by under 5%."""
    pre = run_case(*pre_prospectus())
    post = run_case(*post_prospectus())
    assert post.revenue[-1] / pre.revenue[-1] == pytest.approx(1.25, abs=0.01)
    assert abs(post.ebit[-1] / pre.ebit[-1] - 1) < 0.05


def test_expansion_segment_contributes_nothing_before_2032():
    """todo3 R5: the real-option proxy ramps only after year 6."""
    case, segments = post_prospectus()
    result = run_case(case, segments)
    expansion = next(s for s in result.segments if s.name == "expansion")
    assert expansion.revenue[:6] == [0.0] * 6
    assert expansion.ebit[:6] == [0.0] * 6
    assert expansion.reinvestment[:6] == [0.0] * 6
    assert expansion.revenue[-1] == pytest.approx(50.0)
```

- [ ] **Step 6: Run the gates**

Run: `python -m pytest tests/core_finance/test_segment_valuation_spacex.py -v`
Expected: PASS, 6 tests.

If a target-year total is off, the fault is in `revenue_path` or `margin_path` terminating early, not in the seed data — these totals are arithmetic on confirmed inputs.

- [ ] **Step 7: Record the enterprise-value diagnostic**

This is not an assertion. Run it and write the numbers down:

```bash
python -c "from tests.core_finance.test_segment_valuation_spacex import pre_prospectus, post_prospectus; from packages.core_finance.segment_valuation import run_case; [print(name, f'EV={r.enterprise_value:,.1f}bn', f'per-share=\${r.value_per_share_diluted:,.2f}', f'TV share={r.terminal_value_share_pct:.1f}%') for name, r in (('pre ', run_case(*pre_prospectus())), ('post', run_case(*post_prospectus())))]"
```

Damodaran reports ~$1,210bn (pre) and ~$1,220bn (post), ~$100/share. **A gap is expected and is not a failure** — the sales-to-capital ratios, base margins, tax rate and NOL balance are all guesses. Paste the output into the task's completion note so the gap is on record for the calibration work later.

- [ ] **Step 8: Commit**

```bash
git add packages/core_finance/segment_valuation.py tests/core_finance/test_segment_valuation.py tests/core_finance/test_segment_valuation_spacex.py
git commit -m "feat: terminal value, case assembly, and SpaceX confirmed-input gates"
```

---

## Task 5: Database schema

**Files:**
- Modify: `apps/api/services/db.py` (append to `_CREATE_SCHEMA_SQL`, which ends around line 481)
- Test: `tests/api/test_valuation_schema.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `valuation_case`, `segment`, `segment_narrative`.

**Background.** There is no migration framework here. `init_db()` (`apps/api/services/db.py:483`) executes one `_CREATE_SCHEMA_SQL` script of `CREATE TABLE IF NOT EXISTS` statements, then `_ensure_schema_compatibility()` retrofits older files. New tables need no retrofit — just append them to the script.

`get_db()` sets `PRAGMA foreign_keys=ON` (`db.py:190`), so `ON DELETE CASCADE` genuinely cascades. `row_factory` is `sqlite3.Row`, so rows support `row["column"]`.

`scripts/validate_sqlite_schema.py` checks only that its *expected* tables exist; extra tables are ignored, so `tests/api/test_sqlite_schema_validation.py` will not break.

- [ ] **Step 1: Write the failing test**

Create `tests/api/test_valuation_schema.py`:

```python
"""The valuation tables exist with the columns the engine and service need."""

from apps.api.services.db import get_db


def _columns(conn, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def test_valuation_case_table_has_every_engine_input():
    with get_db() as conn:
        assert _columns(conn, "valuation_case") >= {
            "id", "case_name", "ticker", "as_of_date", "base_year", "target_year",
            "riskfree_rate", "wacc_initial", "wacc_stable", "wacc_converge_from",
            "marginal_tax_rate", "nol_balance", "roic_stable", "terminal_growth",
            "cash", "debt", "ipo_proceeds", "shares_basic", "shares_new",
            "parent_case_id",
        }


def test_segment_table_has_every_segment_input():
    with get_db() as conn:
        assert _columns(conn, "segment") >= {
            "id", "case_id", "name", "base_revenue", "base_margin",
            "tam_target", "market_share_target", "revenue_target", "margin_target",
            "sales_to_capital_early", "sales_to_capital_late", "ramp_start_year",
        }


def test_segment_narrative_table_binds_a_claim_to_an_input_field():
    with get_db() as conn:
        assert _columns(conn, "segment_narrative") >= {
            "segment_id", "input_field", "claim", "evidence_source",
            "confidence", "three_p",
        }


def test_case_name_is_unique():
    """UNIQUE(case_name) alone, not UNIQUE(ticker, case_name): ticker is NULL for
    a private company, and SQLite treats NULLs as distinct, so the pair would
    silently fail to constrain exactly the rows it exists to protect."""
    import pytest

    with get_db() as conn:
        conn.execute(
            "INSERT INTO valuation_case (case_name, as_of_date, base_year, target_year,"
            " riskfree_rate, wacc_initial, wacc_stable, marginal_tax_rate, roic_stable,"
            " shares_basic) VALUES ('dup', '2026-08-09', 2026, 2036, 0.04, 0.08, 0.08,"
            " 0.25, 0.12, 1.0)"
        )
        with pytest.raises(Exception, match="UNIQUE"):
            conn.execute(
                "INSERT INTO valuation_case (case_name, as_of_date, base_year, target_year,"
                " riskfree_rate, wacc_initial, wacc_stable, marginal_tax_rate, roic_stable,"
                " shares_basic) VALUES ('dup', '2026-08-09', 2026, 2036, 0.04, 0.08, 0.08,"
                " 0.25, 0.12, 1.0)"
            )


def test_deleting_a_case_cascades_to_segments_and_narratives():
    with get_db() as conn:
        conn.execute(
            "INSERT INTO valuation_case (id, case_name, as_of_date, base_year, target_year,"
            " riskfree_rate, wacc_initial, wacc_stable, marginal_tax_rate, roic_stable,"
            " shares_basic) VALUES (1, 'c', '2026-08-09', 2026, 2036, 0.04, 0.08, 0.08,"
            " 0.25, 0.12, 1.0)"
        )
        conn.execute(
            "INSERT INTO segment (id, case_id, name, base_revenue, base_margin,"
            " margin_target, sales_to_capital_early, sales_to_capital_late, revenue_target)"
            " VALUES (1, 1, 'launch', 4.1, -0.1, 0.45, 1.0, 1.5, 70.0)"
        )
        conn.execute(
            "INSERT INTO segment_narrative (segment_id, input_field, claim, confidence,"
            " three_p) VALUES (1, 'margin_target', 'reusability', 'confirmed', 'probable')"
        )
        conn.execute("DELETE FROM valuation_case WHERE id = 1")
        assert conn.execute("SELECT COUNT(*) c FROM segment").fetchone()["c"] == 0
        assert conn.execute(
            "SELECT COUNT(*) c FROM segment_narrative"
        ).fetchone()["c"] == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/api/test_valuation_schema.py -v`
Expected: FAIL — `sqlite3.OperationalError: no such table: valuation_case`

- [ ] **Step 3: Add the tables**

In `apps/api/services/db.py`, append to the `_CREATE_SCHEMA_SQL` string, immediately before its closing `"""`:

```sql

-- ============================================================
-- Schema: Segment build-up valuation cases (hand-authored)
--
-- Independent of the acquisition pipeline: a case is authored, not fetched, so
-- a private or pre-IPO company with no ticker and no statements is a first-class
-- subject. See docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md
-- ============================================================

CREATE TABLE IF NOT EXISTS valuation_case (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    case_name          TEXT NOT NULL UNIQUE,
    ticker             TEXT,                      -- NULL for private / pre-IPO
    as_of_date         TEXT NOT NULL,
    base_year          INTEGER NOT NULL,
    target_year        INTEGER NOT NULL,
    riskfree_rate      REAL NOT NULL,
    wacc_initial       REAL NOT NULL,
    wacc_stable        REAL NOT NULL,
    wacc_converge_from INTEGER NOT NULL DEFAULT 6,
    marginal_tax_rate  REAL NOT NULL,
    nol_balance        REAL NOT NULL DEFAULT 0,
    roic_stable        REAL NOT NULL,
    terminal_growth    REAL,                      -- NULL means: use riskfree_rate
    cash               REAL NOT NULL DEFAULT 0,
    debt               REAL NOT NULL DEFAULT 0,
    ipo_proceeds       REAL NOT NULL DEFAULT 0,
    shares_basic       REAL NOT NULL,
    shares_new         REAL NOT NULL DEFAULT 0,
    parent_case_id     INTEGER REFERENCES valuation_case(id)
);

CREATE TABLE IF NOT EXISTS segment (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id                INTEGER NOT NULL REFERENCES valuation_case(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    base_revenue           REAL NOT NULL,
    base_margin            REAL NOT NULL,
    tam_target             REAL,
    market_share_target    REAL,
    revenue_target         REAL,
    margin_target          REAL NOT NULL,
    sales_to_capital_early REAL NOT NULL,
    sales_to_capital_late  REAL NOT NULL,
    ramp_start_year        INTEGER NOT NULL DEFAULT 1,
    UNIQUE(case_id, name)
);
CREATE INDEX IF NOT EXISTS idx_segment_case ON segment(case_id);

CREATE TABLE IF NOT EXISTS segment_narrative (
    segment_id      INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
    input_field     TEXT NOT NULL,
    claim           TEXT NOT NULL,
    evidence_source TEXT,
    confidence      TEXT NOT NULL CHECK(confidence IN ('confirmed','derived','assumed')),
    three_p         TEXT NOT NULL CHECK(three_p IN ('possible','plausible','probable')),
    PRIMARY KEY (segment_id, input_field)
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_valuation_schema.py tests/api/test_sqlite_schema_validation.py -v`
Expected: PASS. The existing schema-validation tests must still pass — the validator ignores tables it does not know about.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/db.py tests/api/test_valuation_schema.py
git commit -m "feat: valuation_case, segment and segment_narrative tables"
```

---

## Task 6: Case service and the narrative rule

**Files:**
- Create: `apps/api/services/valuation_case.py`
- Create: `tests/api/valuation_fixtures.py` (shared payload builders — Task 7 uses them too; not named `test_*` so pytest does not collect it)
- Test: `tests/api/test_valuation_case_service.py`

**Interfaces:**
- Consumes: `CaseSpec`, `SegmentSpec`, `CaseResult`, `run_case` from Task 4; the tables from Task 5.
- Produces: `NARRATED_FIELDS: tuple[str, ...]`, `create_case(payload: dict) -> int`, `load_case(case_id: int) -> dict`, `list_cases() -> list[dict]`, `run_stored_case(case_id: int) -> dict`, `CaseNotFound(Exception)`.

**Background — this is the part that makes the feature more than a DCF calculator.** Every numeric input on a segment must carry the narrative claim that justifies it. The rule is enforced on write: a POST that sets `margin_target = 0.45` without a claim explaining *why* 45% is rejected with 422. That is what keeps the uncalibrated guesses visible instead of buried — each one is stored `confidence='assumed'` with its claim.

`three_p` is stored but **not** gated. Refusing to run a case whose inputs are below `probable` sounds principled, but the author sets `three_p` themselves, so the gate would only ever reject inputs someone had already labelled weak. `/run` reports them instead.

- [ ] **Step 1: Write the shared payload builders**

Two test modules need these (this task's and Task 7's), so they live in their own
module rather than being imported across test files. The name deliberately does not
start with `test_`, so pytest imports it without collecting it.

Create `tests/api/valuation_fixtures.py`:

```python
"""Payload builders for valuation-case tests.

Shared by test_valuation_case_service.py and test_valuation_routes.py. Kept out
of a test module so neither imports the other, and out of conftest.py because
these are called directly, not injected as pytest fixtures.
"""

from apps.api.services.valuation_case import NARRATED_FIELDS


def _narrative(field: str, confidence: str = "assumed", three_p: str = "probable") -> dict:
    return {
        "input_field": field,
        "claim": f"placeholder claim for {field}",
        "evidence_source": "test",
        "confidence": confidence,
        "three_p": three_p,
    }


def _segment_payload(**overrides) -> dict:
    payload = {
        "name": "launch",
        "base_revenue": 4.1,
        "base_margin": -0.10,
        "tam_target": 100.0,
        "market_share_target": 0.70,
        "margin_target": 0.45,
        "sales_to_capital_early": 1.0,
        "sales_to_capital_late": 1.5,
        "ramp_start_year": 1,
    }
    payload.update(overrides)
    present = [f for f in NARRATED_FIELDS if payload.get(f) is not None]
    payload["narratives"] = [_narrative(f) for f in present]
    return payload


def _case_payload(**overrides) -> dict:
    payload = {
        "case_name": "test_case",
        "ticker": None,
        "as_of_date": "2026-08-09",
        "base_year": 2026,
        "target_year": 2036,
        "riskfree_rate": 0.0456,
        "wacc_initial": 0.0837,
        "wacc_stable": 0.0825,
        "wacc_converge_from": 6,
        "marginal_tax_rate": 0.25,
        "nol_balance": 5.0,
        "roic_stable": 0.12,
        "terminal_growth": None,
        "cash": 24.7,
        "debt": 22.9,
        "ipo_proceeds": 75.0,
        "shares_basic": 12.535,
        "shares_new": 0.556,
        "parent_case_id": None,
        "segments": [_segment_payload()],
    }
    payload.update(overrides)
    return payload
```

- [ ] **Step 2: Write the failing tests**

Create `tests/api/test_valuation_case_service.py`:

```python
import pytest

from apps.api.services.valuation_case import (
    CaseNotFound,
    NARRATED_FIELDS,
    create_case,
    list_cases,
    load_case,
    run_stored_case,
)
from tests.api.valuation_fixtures import _case_payload, _narrative


def test_create_and_load_round_trips_every_field():
    case_id = create_case(_case_payload())
    loaded = load_case(case_id)
    assert loaded["case_name"] == "test_case"
    assert loaded["ticker"] is None
    assert loaded["segments"][0]["market_share_target"] == pytest.approx(0.70)
    assert len(loaded["segments"][0]["narratives"]) == len(NARRATED_FIELDS) - 1


def test_missing_narrative_rejects_the_whole_case():
    payload = _case_payload()
    payload["segments"][0]["narratives"] = [
        n for n in payload["segments"][0]["narratives"]
        if n["input_field"] != "margin_target"
    ]
    with pytest.raises(ValueError, match="margin_target"):
        create_case(payload)


def test_a_rejected_case_leaves_nothing_behind():
    """The narrative rule must not half-write a case."""
    payload = _case_payload(case_name="doomed")
    payload["segments"][0]["narratives"] = []
    with pytest.raises(ValueError):
        create_case(payload)
    assert [c["case_name"] for c in list_cases()] == []


def test_narrative_for_an_absent_field_is_rejected():
    """A claim about tam_target on a segment that sets revenue_target instead is
    a claim about nothing, and silently storing it would rot."""
    payload = _case_payload()
    payload["segments"][0]["narratives"].append(_narrative("revenue_target"))
    with pytest.raises(ValueError, match="revenue_target"):
        create_case(payload)


def test_load_of_an_unknown_case_raises_case_not_found():
    with pytest.raises(CaseNotFound):
        load_case(9999)


def test_run_stored_case_returns_engine_output():
    case_id = create_case(_case_payload())
    result = run_stored_case(case_id)
    assert result["revenue"][-1] == pytest.approx(70.0)
    assert result["terminal_spread"] == pytest.approx(0.0825 - 0.0456)
    assert result["equity_value"] > 0


def test_run_reports_inputs_below_probable_without_refusing():
    payload = _case_payload()
    for narrative in payload["segments"][0]["narratives"]:
        if narrative["input_field"] == "market_share_target":
            narrative["three_p"] = "plausible"
    case_id = create_case(payload)
    result = run_stored_case(case_id)
    assert result["below_probable"] == [
        {"segment": "launch", "input_field": "market_share_target", "three_p": "plausible"}
    ]


def test_duplicate_case_name_is_rejected():
    create_case(_case_payload(case_name="taken"))
    with pytest.raises(ValueError, match="taken"):
        create_case(_case_payload(case_name="taken"))
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_valuation_case_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.valuation_case'`

- [ ] **Step 4: Write the implementation**

Create `apps/api/services/valuation_case.py`:

```python
"""Storage and orchestration for hand-authored segment build-up valuation cases.

A case is authored, not acquired. Nothing here touches the network or the
statement pipeline, which is what lets a private or pre-IPO company with no
ticker be valued at all.

The one rule this module exists to enforce: every numeric input on a segment
carries the narrative claim that justifies it. See `_validate_narratives`.
"""

from __future__ import annotations

import sqlite3

from apps.api.services.db import get_db
from packages.core_finance.segment_valuation import (
    CaseSpec,
    SegmentSpec,
    run_case,
)

# Every value-bearing field on a segment. A non-NULL value in any of these needs
# a segment_narrative row; a narrative for a field left NULL is rejected too,
# since it is a claim about a number the model never uses.
NARRATED_FIELDS: tuple[str, ...] = (
    "base_revenue",
    "base_margin",
    "tam_target",
    "market_share_target",
    "revenue_target",
    "margin_target",
    "sales_to_capital_early",
    "sales_to_capital_late",
)

_CASE_COLUMNS = (
    "case_name", "ticker", "as_of_date", "base_year", "target_year",
    "riskfree_rate", "wacc_initial", "wacc_stable", "wacc_converge_from",
    "marginal_tax_rate", "nol_balance", "roic_stable", "terminal_growth",
    "cash", "debt", "ipo_proceeds", "shares_basic", "shares_new",
    "parent_case_id",
)

_SEGMENT_COLUMNS = (
    "name", "base_revenue", "base_margin", "tam_target", "market_share_target",
    "revenue_target", "margin_target", "sales_to_capital_early",
    "sales_to_capital_late", "ramp_start_year",
)


class CaseNotFound(Exception):
    """No valuation case with the requested id."""


def _validate_narratives(segment: dict) -> None:
    """Every stated input has a claim, and every claim names a stated input.

    Both directions matter. Without the first, a number can enter the model with
    no stated reason -- which is the whole discipline this feature encodes. Without
    the second, a claim survives the removal of the input it justified and quietly
    misdescribes the case.
    """
    name = segment.get("name", "?")
    stated = {f for f in NARRATED_FIELDS if segment.get(f) is not None}
    claimed = {n["input_field"] for n in segment.get("narratives", [])}

    for field in sorted(stated - claimed):
        raise ValueError(
            f"segment '{name}': input '{field}' has no narrative claim. Every "
            f"number in a valuation case must state why it holds that value."
        )
    for field in sorted(claimed - stated):
        raise ValueError(
            f"segment '{name}': narrative for '{field}', which this segment does "
            f"not set. A claim about an unused input cannot be checked."
        )


def create_case(payload: dict) -> int:
    """Persist a case, its segments and their narratives in one transaction."""
    segments = payload.get("segments") or []
    if not segments:
        raise ValueError("a valuation case needs at least one segment")
    for segment in segments:
        _validate_narratives(segment)

    with get_db() as conn:
        try:
            cursor = conn.execute(
                f"INSERT INTO valuation_case ({', '.join(_CASE_COLUMNS)}) "
                f"VALUES ({', '.join('?' * len(_CASE_COLUMNS))})",
                tuple(payload.get(column) for column in _CASE_COLUMNS),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError(
                f"case name '{payload.get('case_name')}' already exists"
            ) from exc
        case_id = int(cursor.lastrowid)

        for segment in segments:
            segment_cursor = conn.execute(
                f"INSERT INTO segment (case_id, {', '.join(_SEGMENT_COLUMNS)}) "
                f"VALUES (?, {', '.join('?' * len(_SEGMENT_COLUMNS))})",
                (case_id, *(segment.get(column) for column in _SEGMENT_COLUMNS)),
            )
            segment_id = int(segment_cursor.lastrowid)
            for narrative in segment.get("narratives", []):
                conn.execute(
                    "INSERT INTO segment_narrative (segment_id, input_field, claim,"
                    " evidence_source, confidence, three_p) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        segment_id,
                        narrative["input_field"],
                        narrative["claim"],
                        narrative.get("evidence_source"),
                        narrative["confidence"],
                        narrative["three_p"],
                    ),
                )
    return case_id


def list_cases() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, case_name, ticker, as_of_date, base_year, target_year,"
            " parent_case_id FROM valuation_case ORDER BY id"
        ).fetchall()
    return [dict(row) for row in rows]


def load_case(case_id: int) -> dict:
    with get_db() as conn:
        case_row = conn.execute(
            "SELECT * FROM valuation_case WHERE id = ?", (case_id,)
        ).fetchone()
        if case_row is None:
            raise CaseNotFound(f"no valuation case with id {case_id}")

        case = dict(case_row)
        case["segments"] = []
        for segment_row in conn.execute(
            "SELECT * FROM segment WHERE case_id = ? ORDER BY id", (case_id,)
        ).fetchall():
            segment = dict(segment_row)
            segment["narratives"] = [
                dict(row)
                for row in conn.execute(
                    "SELECT input_field, claim, evidence_source, confidence, three_p"
                    " FROM segment_narrative WHERE segment_id = ? ORDER BY input_field",
                    (segment["id"],),
                ).fetchall()
            ]
            case["segments"].append(segment)
    return case


def _to_specs(case: dict) -> tuple[CaseSpec, list[SegmentSpec]]:
    spec = CaseSpec(
        base_year=case["base_year"],
        target_year=case["target_year"],
        riskfree_rate=case["riskfree_rate"],
        wacc_initial=case["wacc_initial"],
        wacc_stable=case["wacc_stable"],
        wacc_converge_from=case["wacc_converge_from"],
        marginal_tax_rate=case["marginal_tax_rate"],
        nol_balance=case["nol_balance"],
        roic_stable=case["roic_stable"],
        terminal_growth=case["terminal_growth"],
        cash=case["cash"],
        debt=case["debt"],
        ipo_proceeds=case["ipo_proceeds"],
        shares_basic=case["shares_basic"],
        shares_new=case["shares_new"],
    )
    segments = [
        SegmentSpec(
            name=segment["name"],
            base_revenue=segment["base_revenue"],
            base_margin=segment["base_margin"],
            margin_target=segment["margin_target"],
            sales_to_capital_early=segment["sales_to_capital_early"],
            sales_to_capital_late=segment["sales_to_capital_late"],
            tam_target=segment["tam_target"],
            market_share_target=segment["market_share_target"],
            revenue_target=segment["revenue_target"],
            ramp_start_year=segment["ramp_start_year"],
        )
        for segment in case["segments"]
    ]
    return spec, segments


def _below_probable(case: dict) -> list[dict]:
    """Inputs the author did not rate Probable.

    Reported rather than refused. The author assigns three_p themselves, so a
    hard gate would only reject numbers someone had already flagged as weak --
    it would catch nothing an honest author had not already disclosed.
    """
    return [
        {
            "segment": segment["name"],
            "input_field": narrative["input_field"],
            "three_p": narrative["three_p"],
        }
        for segment in case["segments"]
        for narrative in segment["narratives"]
        if narrative["three_p"] != "probable"
    ]


def run_stored_case(case_id: int) -> dict:
    """Value a stored case. Raises ValueError on any model-invalid input."""
    case = load_case(case_id)
    spec, segments = _to_specs(case)
    result = run_case(spec, segments)

    return {
        "case_id": case_id,
        "case_name": case["case_name"],
        "base_year": case["base_year"],
        "target_year": case["target_year"],
        "segments": [
            {
                "name": segment.name,
                "revenue": segment.revenue,
                "margin": segment.margin,
                "ebit": segment.ebit,
                "reinvestment": segment.reinvestment,
            }
            for segment in result.segments
        ],
        "revenue": result.revenue,
        "ebit": result.ebit,
        "tax": result.tax,
        "reinvestment": result.reinvestment,
        "fcff": result.fcff,
        "wacc": result.wacc,
        "discount_factor": result.discount_factor,
        "pv_explicit": result.pv_explicit,
        "terminal_value": result.terminal_value,
        "pv_terminal": result.pv_terminal,
        "terminal_value_share_pct": result.terminal_value_share_pct,
        "terminal_spread": result.terminal_spread,
        "enterprise_value": result.enterprise_value,
        "equity_bridge": {
            "enterprise_value": result.enterprise_value,
            "cash": spec.cash,
            "ipo_proceeds": spec.ipo_proceeds,
            "debt": spec.debt,
            "equity_value": result.equity_value,
        },
        "equity_value": result.equity_value,
        "value_per_share_basic": result.value_per_share_basic,
        "value_per_share_diluted": result.value_per_share_diluted,
        "base_revenue_total": result.base_revenue_total,
        "base_ebit_total": result.base_ebit_total,
        "below_probable": _below_probable(case),
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_valuation_case_service.py -v`
Expected: PASS, 8 tests.

If `test_a_rejected_case_leaves_nothing_behind` fails, the narrative validation is running *after* the insert. It must run before `get_db()` is entered — that is why `_validate_narratives` is called in the loop at the top of `create_case`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/valuation_case.py tests/api/valuation_fixtures.py tests/api/test_valuation_case_service.py
git commit -m "feat: valuation case persistence with the narrative-completeness rule"
```

---

## Task 7: Pydantic models and the four endpoints

**Files:**
- Create: `apps/api/models/schema_parts/valuation.py`
- Modify: `apps/api/models/schemas.py`
- Create: `apps/api/routes/valuation.py`
- Modify: `apps/api/routes/__init__.py`
- Modify: `apps/api/main.py`
- Test: `tests/api/test_valuation_routes.py`

**Interfaces:**
- Consumes: `create_case`, `load_case`, `list_cases`, `run_stored_case`, `CaseNotFound` from Task 6.
- Produces: `valuation_router`, and the Pydantic models `SegmentNarrativeInput`, `SegmentInput`, `ValuationCaseInput`, `ValuationCaseSummary`.

**Background.** Routes in this repo wrap payloads in `APIResponse[T]` (`apps/api/models/schema_parts/common.py:16`) and translate `ValueError` into `HTTPException(422)` — see `apps/api/routes/report.py:20-29` for the exact shape. Routers live in `apps/api/routes/`, are re-exported from `routes/__init__.py`, and are mounted in `main.py` with an `/api/v1/...` prefix.

The run response is returned as a plain `dict` rather than a fully-typed model. It is a wide numeric payload with no frontend consumer yet, and per the global constraints `packages/shared-types` is deliberately not being generated for it. A typed response model arrives with the UI in piece 3d.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_valuation_routes.py`:

```python
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from tests.api.valuation_fixtures import _case_payload

client = TestClient(app)


def test_create_returns_the_new_case_id():
    response = client.post("/api/v1/valuation/cases", json=_case_payload())
    assert response.status_code == 200
    assert response.json()["data"]["id"] > 0


def test_create_without_a_narrative_is_a_422_naming_the_field():
    payload = _case_payload(case_name="unnarrated")
    payload["segments"][0]["narratives"] = [
        n for n in payload["segments"][0]["narratives"]
        if n["input_field"] != "margin_target"
    ]
    response = client.post("/api/v1/valuation/cases", json=payload)
    assert response.status_code == 422
    assert "margin_target" in response.json()["detail"]


def test_list_returns_created_cases():
    client.post("/api/v1/valuation/cases", json=_case_payload(case_name="listed"))
    names = [c["case_name"] for c in client.get("/api/v1/valuation/cases").json()["data"]]
    assert "listed" in names


def test_get_returns_segments_and_narratives():
    case_id = client.post(
        "/api/v1/valuation/cases", json=_case_payload(case_name="detailed")
    ).json()["data"]["id"]
    data = client.get(f"/api/v1/valuation/cases/{case_id}").json()["data"]
    assert data["segments"][0]["name"] == "launch"
    assert data["segments"][0]["narratives"][0]["claim"]


def test_get_unknown_case_is_404():
    assert client.get("/api/v1/valuation/cases/9999").status_code == 404


def test_run_returns_paths_bridge_and_spread():
    case_id = client.post(
        "/api/v1/valuation/cases", json=_case_payload(case_name="runnable")
    ).json()["data"]["id"]
    data = client.post(f"/api/v1/valuation/cases/{case_id}/run").json()["data"]
    assert len(data["fcff"]) == 10
    assert data["revenue"][-1] == pytest.approx(70.0)
    assert data["equity_bridge"]["equity_value"] == pytest.approx(data["equity_value"])
    assert data["terminal_spread"] == pytest.approx(0.0825 - 0.0456)


def test_run_of_an_unknown_case_is_404():
    assert client.post("/api/v1/valuation/cases/9999/run").status_code == 404


def test_model_invalid_inputs_are_422_not_500():
    """A terminal growth above the riskfree rate is a rejected model, not a crash."""
    payload = _case_payload(case_name="uncapped", terminal_growth=0.09)
    case_id = client.post("/api/v1/valuation/cases", json=payload).json()["data"]["id"]
    response = client.post(f"/api/v1/valuation/cases/{case_id}/run")
    assert response.status_code == 422
    assert "riskfree" in response.json()["detail"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_valuation_routes.py -v`
Expected: FAIL — 404 on every route, since the router does not exist.

- [ ] **Step 3: Write the Pydantic models**

Create `apps/api/models/schema_parts/valuation.py`:

```python
"""Request and response models for segment build-up valuation cases."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SegmentNarrativeInput(BaseModel):
    """The claim that justifies one numeric input."""

    input_field: str
    claim: str
    evidence_source: str | None = None
    confidence: Literal["confirmed", "derived", "assumed"]
    three_p: Literal["possible", "plausible", "probable"]


class SegmentInput(BaseModel):
    name: str
    base_revenue: float
    base_margin: float
    margin_target: float
    sales_to_capital_early: float = Field(gt=0)
    sales_to_capital_late: float = Field(gt=0)
    tam_target: float | None = None
    market_share_target: float | None = None
    revenue_target: float | None = None
    ramp_start_year: int = Field(default=1, ge=1)
    narratives: list[SegmentNarrativeInput] = Field(default_factory=list)


class ValuationCaseInput(BaseModel):
    case_name: str
    as_of_date: str
    base_year: int
    target_year: int
    riskfree_rate: float
    wacc_initial: float = Field(gt=0)
    wacc_stable: float = Field(gt=0)
    marginal_tax_rate: float = Field(ge=0, le=1)
    roic_stable: float = Field(gt=0)
    shares_basic: float = Field(gt=0)
    segments: list[SegmentInput] = Field(min_length=1)
    ticker: str | None = None
    wacc_converge_from: int = Field(default=6, ge=1)
    nol_balance: float = 0.0
    terminal_growth: float | None = None
    cash: float = 0.0
    debt: float = 0.0
    ipo_proceeds: float = 0.0
    shares_new: float = 0.0
    parent_case_id: int | None = None


class ValuationCaseCreated(BaseModel):
    id: int


class ValuationCaseSummary(BaseModel):
    id: int
    case_name: str
    ticker: str | None
    as_of_date: str
    base_year: int
    target_year: int
    parent_case_id: int | None
```

- [ ] **Step 4: Re-export the models**

In `apps/api/models/schemas.py`, add after the existing `from .schema_parts.corporate import (...)` block:

```python
from .schema_parts.valuation import (
    SegmentInput,
    SegmentNarrativeInput,
    ValuationCaseCreated,
    ValuationCaseInput,
    ValuationCaseSummary,
)
```

If the file has an `__all__` list, append these five names to it. If it does not, the import alone is the export surface.

- [ ] **Step 5: Write the router**

Create `apps/api/routes/valuation.py`:

```python
"""Segment build-up valuation cases.

Hand-authored cases: nothing here consults the acquisition pipeline, so a
private or pre-IPO company is valued the same way a listed one is.
"""

from fastapi import APIRouter, Body, HTTPException

from apps.api.models.schemas import (
    APIResponse,
    ValuationCaseCreated,
    ValuationCaseInput,
    ValuationCaseSummary,
)
from apps.api.services.valuation_case import (
    CaseNotFound,
    create_case,
    list_cases,
    load_case,
    run_stored_case,
)

router = APIRouter()


@router.post("/cases", response_model=APIResponse[ValuationCaseCreated])
async def create_valuation_case(payload: ValuationCaseInput = Body(...)):
    """Create a case with its segments and narratives.

    Rejects with 422 if any stated numeric input lacks a narrative claim.
    """
    try:
        case_id = create_case(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return APIResponse(data=ValuationCaseCreated(id=case_id))


@router.get("/cases", response_model=APIResponse[list[ValuationCaseSummary]])
async def list_valuation_cases():
    return APIResponse(data=[ValuationCaseSummary(**case) for case in list_cases()])


@router.get("/cases/{case_id}", response_model=APIResponse[dict])
async def get_valuation_case(case_id: int):
    try:
        return APIResponse(data=load_case(case_id))
    except CaseNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cases/{case_id}/run", response_model=APIResponse[dict])
async def run_valuation_case(case_id: int):
    """Value a stored case.

    A ValueError here is a rejected model, not a server fault: terminal growth
    above the riskfree rate, a non-positive WACC-to-growth spread, ROIC at or
    below WACC with positive growth. All are 422.
    """
    try:
        return APIResponse(data=run_stored_case(case_id))
    except CaseNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

- [ ] **Step 6: Register the router**

In `apps/api/routes/__init__.py`, add the import line after the `stock` import and add `"valuation_router"` to `__all__`:

```python
from .valuation import router as valuation_router
```

In `apps/api/main.py`, add `valuation_router` to the `from apps.api.routes import (...)` block starting at line 25, and add this line after the `stock_router` mount at line 188:

```python
app.include_router(valuation_router, prefix="/api/v1/valuation", tags=["Valuation"])
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_valuation_routes.py -v`
Expected: PASS, 8 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/models/schema_parts/valuation.py apps/api/models/schemas.py apps/api/routes/valuation.py apps/api/routes/__init__.py apps/api/main.py tests/api/test_valuation_routes.py
git commit -m "feat: valuation case endpoints under /api/v1/valuation"
```

---

## Task 8: Seed both SpaceX cases

**Files:**
- Create: `apps/api/services/valuation_seed.py`
- Test: `tests/api/test_valuation_seed.py`

**Interfaces:**
- Consumes: `create_case`, `list_cases` from Task 6.
- Produces: `PRE_CASE_NAME`, `POST_CASE_NAME`, `ensure_valuation_cases_seeded() -> None`.

**Background.** Two cases, linked: `spacex_2026_04_pre_prospectus` and `spacex_2026_06_post_prospectus`, the latter carrying `parent_case_id` back to the former. Seeding both is what makes todo3 §3's central finding testable — a 277-page prospectus barely moved the valuation because the AI revenue doubling was cancelled by the AI margin collapse.

Every narrative claim below comes from todo3 §7's narrative-to-number table or §4's evidence layer. Confidence tags mirror todo3's own: `[C]` → `confirmed`, `[D]` → `derived`, `[V]` → `assumed`.

Seeding is **not** wired into application startup. `ensure_valuation_cases_seeded()` is called explicitly by tests and can be called from a script; adding it to the FastAPI lifespan would put fixture data in every developer's database without asking.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_valuation_seed.py`:

```python
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.valuation_case import list_cases, load_case
from apps.api.services.valuation_seed import (
    POST_CASE_NAME,
    PRE_CASE_NAME,
    ensure_valuation_cases_seeded,
)

client = TestClient(app)


def _case_id(name: str) -> int:
    return next(c["id"] for c in list_cases() if c["case_name"] == name)


def _run(name: str) -> dict:
    return client.post(f"/api/v1/valuation/cases/{_case_id(name)}/run").json()["data"]


def test_seed_creates_both_cases():
    ensure_valuation_cases_seeded()
    names = {c["case_name"] for c in list_cases()}
    assert names == {PRE_CASE_NAME, POST_CASE_NAME}


def test_seed_is_idempotent():
    ensure_valuation_cases_seeded()
    ensure_valuation_cases_seeded()
    assert len(list_cases()) == 2


def test_post_prospectus_case_descends_from_the_pre_case():
    ensure_valuation_cases_seeded()
    post = load_case(_case_id(POST_CASE_NAME))
    assert post["parent_case_id"] == _case_id(PRE_CASE_NAME)


def test_every_seeded_input_carries_a_narrative():
    """The seed obeys the rule it is meant to demonstrate."""
    ensure_valuation_cases_seeded()
    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        for segment in load_case(_case_id(name))["segments"]:
            stated = {
                f for f in (
                    "base_revenue", "base_margin", "tam_target",
                    "market_share_target", "revenue_target", "margin_target",
                    "sales_to_capital_early", "sales_to_capital_late",
                )
                if segment[f] is not None
            }
            assert {n["input_field"] for n in segment["narratives"]} == stated


def test_uncalibrated_inputs_are_marked_assumed():
    """todo3 tags sales-to-capital and base margins as unconfirmed. That has to
    be visible in the data, not just in a comment."""
    ensure_valuation_cases_seeded()
    post = load_case(_case_id(POST_CASE_NAME))
    launch = next(s for s in post["segments"] if s["name"] == "launch")
    by_field = {n["input_field"]: n for n in launch["narratives"]}
    assert by_field["sales_to_capital_early"]["confidence"] == "assumed"
    assert by_field["base_margin"]["confidence"] == "assumed"
    assert by_field["margin_target"]["confidence"] == "confirmed"


def test_seeded_target_year_totals_match_the_confirmed_inputs():
    """The section 6 gates, end to end through HTTP."""
    ensure_valuation_cases_seeded()
    pre, post = _run(PRE_CASE_NAME), _run(POST_CASE_NAME)
    assert pre["revenue"][-1] == pytest.approx(320.0, abs=1e-6)
    assert pre["ebit"][-1] == pytest.approx(151.0, abs=1e-6)
    assert post["revenue"][-1] == pytest.approx(400.0, abs=1e-6)
    assert post["ebit"][-1] == pytest.approx(158.5, abs=1e-6)


def test_seeded_base_revenue_reconciles_with_trailing_multiples():
    ensure_valuation_cases_seeded()
    assert _run(POST_CASE_NAME)["base_revenue_total"] == pytest.approx(15.6, abs=0.05)


def test_post_prospectus_bridge_uses_prospectus_balance_sheet():
    ensure_valuation_cases_seeded()
    bridge = _run(POST_CASE_NAME)["equity_bridge"]
    assert bridge["cash"] == pytest.approx(24.7)
    assert bridge["debt"] == pytest.approx(22.9)
    assert bridge["ipo_proceeds"] == pytest.approx(75.0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_valuation_seed.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.valuation_seed'`

- [ ] **Step 3: Write the seed**

Create `apps/api/services/valuation_seed.py`:

```python
"""Damodaran's two SpaceX cases as reference fixtures.

Sourced from `guideline/sop/todo3.md`, which reconstructs his April 2026
pre-prospectus and June 2026 post-prospectus valuations. Both are seeded because
the pair is the point: section 3's finding is that a 277-page prospectus barely
moved enterprise value, because the AI revenue doubling and the launch margin
uplift were almost exactly cancelled by the AI margin collapse.

Confidence tags mirror todo3's own: [C] -> confirmed, [D] -> derived,
[V] -> assumed. Everything tagged `assumed` is a placeholder pending
SpaceX2026IPO.xlsx and SpaceX2026IPOUpdated.xlsx; see the design spec, 7.3.

Not wired into application startup: fixture data belongs in a database because
someone asked for it.
"""

from __future__ import annotations

from apps.api.services.valuation_case import create_case, list_cases

PRE_CASE_NAME = "spacex_2026_04_pre_prospectus"
POST_CASE_NAME = "spacex_2026_06_post_prospectus"

# Base-year (FY2025) figures. Revenues are [D]: todo3 section 6 derives 2025
# revenue twice from trailing multiples -- 1250/80.13 and 1750/112.18 both give
# 15.60 -- and these four sum to 15.6. Margins are [V] and do not reconcile with
# either base-year EBIT figure todo3 quotes; see the design spec, section 6.
_BASE = {
    "launch": (4.1, -0.10),
    "connectivity": (11.4, 0.02),
    "ai": (0.1, -0.50),
    "expansion": (0.0, 0.0),
}

_BASE_CLAIMS = {
    "launch": "2025 launch revenue, backed out of trailing EV/Sales of 80.13x at $1.25T.",
    "connectivity": "2025 Starlink revenue; ~+50% growth on 10.3m subscribers at $66/mo ARPU.",
    "ai": "2025 xAI revenue, pre-Cursor; ~+22% growth, below the implied path.",
    "expansion": "No revenue today. The segment is a real-option proxy, not a business.",
}

_ASSUMED_BASE_MARGIN = (
    "Placeholder. todo3 tags base margins [V]; the blog posts give only "
    "consolidated figures, which do not reconcile with each other "
    "(-$2.57bn reported vs +$4bn EBITR vs -$0.23bn implied by these margins)."
)
_ASSUMED_S2C = (
    "Placeholder. todo3 states only the direction -- sales-to-capital was "
    "lowered after $14bn of 2025 capex -- never the level. Calibrate against "
    "SpaceX2026IPOUpdated.xlsx."
)


def _narrative(field, claim, confidence, three_p="probable", source="todo3"):
    return {
        "input_field": field,
        "claim": claim,
        "evidence_source": source,
        "confidence": confidence,
        "three_p": three_p,
    }


def _segment(name, *, margin_target, margin_claim, s2c_early, s2c_late,
             tam=None, tam_claim=None, share=None, share_claim=None,
             revenue_target=None, revenue_claim=None, ramp_start_year=1):
    base_revenue, base_margin = _BASE[name]
    narratives = [
        _narrative("base_revenue", _BASE_CLAIMS[name], "derived", source="todo3 section 6"),
        _narrative("base_margin", _ASSUMED_BASE_MARGIN, "assumed"),
        _narrative("margin_target", margin_claim, "confirmed", source="todo3 section 3"),
        _narrative("sales_to_capital_early", _ASSUMED_S2C, "assumed"),
        _narrative("sales_to_capital_late", _ASSUMED_S2C, "assumed"),
    ]
    if tam is not None:
        narratives.append(_narrative("tam_target", tam_claim, "confirmed", source="todo3 section 7"))
        narratives.append(_narrative("market_share_target", share_claim, "confirmed", source="todo3 section 7"))
    if revenue_target is not None:
        narratives.append(_narrative("revenue_target", revenue_claim, "confirmed", source="todo3 section 7"))

    return {
        "name": name,
        "base_revenue": base_revenue,
        "base_margin": base_margin,
        "tam_target": tam,
        "market_share_target": share,
        "revenue_target": revenue_target,
        "margin_target": margin_target,
        "sales_to_capital_early": s2c_early,
        "sales_to_capital_late": s2c_late,
        "ramp_start_year": ramp_start_year,
        "narratives": narratives,
    }


_LAUNCH_TAM = "The launch market grows from $30bn to $100bn as government and private demand rises. The prospectus TAM is rejected as an over-reach."
_LAUNCH_SHARE = "SpaceX stays dominant but sheds share to security- and nationalism-driven entrants, from over 80% today to 70%."
_CONN_TAM = "Satellite internet goes from 1% to 10% of a $1.5T internet market."
_CONN_SHARE = "Starlink's satellite lead plus captive launch capacity is defensible."
_CONN_MARGIN = "Once satellites are in orbit incremental subscribers are nearly pure margin, and CAC eases as the business mix rises."
_EXPANSION_REVENUE = "A deliberately crude stand-in for optionality, ramping only after year 6. Mars, space tourism and in-space business are excluded outright: no viable revenue path today."
_EXPANSION_MARGIN = "Assumed mid-range for an unspecified business. The segment is a placeholder for optionality, not a forecast."


def _pre_prospectus_payload() -> dict:
    return {
        "case_name": PRE_CASE_NAME,
        "ticker": None,
        "as_of_date": "2026-04-23",
        "base_year": 2026,
        "target_year": 2036,
        "riskfree_rate": 0.0420,
        "wacc_initial": 0.0802,
        "wacc_stable": 0.0800,
        "wacc_converge_from": 6,
        "marginal_tax_rate": 0.25,
        "nol_balance": 5.0,
        "roic_stable": 0.12,
        "terminal_growth": None,
        "cash": 0.0,
        "debt": 0.0,
        "ipo_proceeds": 0.0,
        "shares_basic": 2.467,
        "shares_new": 0.0,
        "parent_case_id": None,
        "segments": [
            _segment("launch", tam=100.0, tam_claim=_LAUNCH_TAM, share=0.70,
                     share_claim=_LAUNCH_SHARE, margin_target=0.40,
                     margin_claim="Reusability and existing infrastructure produce a durable cost advantage.",
                     s2c_early=1.5, s2c_late=2.0),
            _segment("connectivity", tam=160.0, tam_claim=_CONN_TAM, share=0.75,
                     share_claim=_CONN_SHARE, margin_target=0.60,
                     margin_claim=_CONN_MARGIN, s2c_early=1.5, s2c_late=2.0),
            # 45%, not 50%. todo3 section 3 footnote 1: S1's text says 50%, S2
            # restates the same assumption as 45%, and section 3's derived table
            # uses 45%. Recorded as derived so the conflict stays visible.
            _segment("ai", revenue_target=80.0,
                     revenue_claim="xAI against a $3-4T real enterprise AI market, before the Cursor acquisition.",
                     margin_target=0.45,
                     margin_claim="Restated from S2 as 45%. S1's text says 50%; todo3 section 3 footnote 1 documents the conflict and its own derived table uses 45%.",
                     s2c_early=0.8, s2c_late=1.2),
            _segment("expansion", revenue_target=50.0, revenue_claim=_EXPANSION_REVENUE,
                     margin_target=0.30, margin_claim=_EXPANSION_MARGIN,
                     s2c_early=1.0, s2c_late=1.5, ramp_start_year=7),
        ],
    }


def _post_prospectus_payload(parent_case_id: int) -> dict:
    return {
        "case_name": POST_CASE_NAME,
        "ticker": None,
        "as_of_date": "2026-06-04",
        "base_year": 2026,
        "target_year": 2036,
        "riskfree_rate": 0.0456,
        "wacc_initial": 0.0837,
        "wacc_stable": 0.0825,
        "wacc_converge_from": 6,
        "marginal_tax_rate": 0.25,
        "nol_balance": 5.0,
        "roic_stable": 0.12,
        "terminal_growth": None,
        "cash": 24.7,
        "debt": 22.9,
        "ipo_proceeds": 75.0,
        "shares_basic": 12.535,
        "shares_new": 0.556,
        "parent_case_id": parent_case_id,
        "segments": [
            _segment("launch", tam=100.0, tam_claim=_LAUNCH_TAM, share=0.70,
                     share_claim=_LAUNCH_SHARE, margin_target=0.45,
                     margin_claim="Raised from 40%. Gross margin is ~67% and the reported operating loss was entirely R&D-driven.",
                     s2c_early=1.0, s2c_late=1.5),
            _segment("connectivity", tam=160.0, tam_claim=_CONN_TAM, share=0.75,
                     share_claim=_CONN_SHARE, margin_target=0.60,
                     margin_claim=_CONN_MARGIN + " Held at 60%: gross margin went 37% to 48% across 2024-2025.",
                     s2c_early=1.0, s2c_late=1.5),
            _segment("ai", revenue_target=160.0,
                     revenue_claim="Doubled from $80bn on the Cursor acquisition and enterprise intent, against a $3-4T AI TAM. The prospectus claim of $26T is rejected as a marketing artifact.",
                     margin_target=0.25,
                     margin_claim="Cut from 45%. The lowest gross margins of the three segments, and deteriorating, under LLM competition.",
                     s2c_early=0.6, s2c_late=1.0),
            _segment("expansion", revenue_target=50.0, revenue_claim=_EXPANSION_REVENUE,
                     margin_target=0.30, margin_claim=_EXPANSION_MARGIN,
                     s2c_early=1.0, s2c_late=1.5, ramp_start_year=7),
        ],
    }


def ensure_valuation_cases_seeded() -> None:
    """Plant the two SpaceX reference cases if they are not already there."""
    existing = {case["case_name"]: case["id"] for case in list_cases()}

    pre_id = existing.get(PRE_CASE_NAME)
    if pre_id is None:
        pre_id = create_case(_pre_prospectus_payload())

    if POST_CASE_NAME not in existing:
        create_case(_post_prospectus_payload(pre_id))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_valuation_seed.py -v`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole suite**

Run: `python -m pytest tests -q`
Expected: every previously-passing test still passes. Nothing in this plan modifies existing behaviour — `db.py` gains three tables, `main.py` and `routes/__init__.py` gain one router, `schemas.py` gains five imports.

The enterprise-value diagnostic was already recorded at the engine level in Task 4
Step 7. Do **not** re-run it through the seed: that path calls `init_db()` and
`ensure_valuation_cases_seeded()` against the developer's real
`data/processed/moneyview.db`, planting fixture rows outside any test's isolation,
to produce a number Task 4 already produced. `test_seeded_target_year_totals_match_the_confirmed_inputs`
above already proves the seed data agrees with the engine fixture.

- [ ] **Step 6: Update the trackers**

Add to `guideline/sop/todo.md` a new track section:

```markdown
## Active Track - Segment Build-Up Valuation (todo3 pieces 3a+3b)

Spec: `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md`
Plan: `docs/superpowers/plans/2026-08-09-segment-buildup-valuation.md`
Source: `guideline/sop/todo3.md`

- [x] 3a Engine core - `packages/core_finance/segment_valuation.py`
- [x] 3b Persistence + API - 3 tables, 4 endpoints, both SpaceX cases seeded
- [ ] 3c Uncertainty + attribution - Monte Carlo, /fork, /diff, /pricing
- [ ] 3d UI - valuation tab

Known open: every `[V]` input is a placeholder pending SpaceX2026IPO.xlsx and
SpaceX2026IPOUpdated.xlsx. The enterprise-value gap against Damodaran's $1.21T /
$1.22T is recorded as a diagnostic, not a gate -- see spec section 1.2.
```

Add the spec and plan to the tables in `docs/INDEX.md` under "Design Specs (`docs/superpowers/specs/`)".

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/valuation_seed.py tests/api/test_valuation_seed.py guideline/sop/todo.md docs/INDEX.md
git commit -m "feat: seed Damodaran's two SpaceX reference cases"
```

---

## Self-Review Notes

**Spec coverage.** Every §6 gate maps to a task: gates 1 and 8 → Task 4 Step 5 and Task 8 Step 1; gate 2 (traps) → Tasks 1–4; gate 3 → Tasks 1–2; gate 4 → Task 3; gate 5 → Task 4; gate 6 → Task 6; gate 7 → Task 8. Spec §5.3's `/run` payload fields all appear in `run_stored_case`. Spec §5.2's narrative rule is Task 6. Spec §5.5 (do not touch `shared-types`) is in Global Constraints.

**Deliberately not covered, matching the spec's Out of Scope:** Monte Carlo, `/fork`, `/diff`, `/pricing`, the UI, and R&D capitalization. Trap #4 (the R&D↔reinvestment cross-check) has no task because it has no implementation to guard — recorded in spec §6 gate 2 so the slot is not lost.

**Two deliberate duplications, both justified in-file so review does not re-litigate them.** The SpaceX case data appears in both `tests/core_finance/test_segment_valuation_spacex.py` and `apps/api/services/valuation_seed.py`, because `packages/core_finance` must not import from `apps/api`. Shared test payload builders live in `tests/api/valuation_fixtures.py` rather than being imported across test modules.
