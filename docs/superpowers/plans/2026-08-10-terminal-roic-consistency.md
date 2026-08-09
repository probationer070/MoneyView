# Terminal ROIC Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the segment build-up engine's terminal value from silently contradicting its own explicit-period capital economics, and close four inputs that currently produce plausible-looking wrong valuations instead of errors.

**Architecture:** Add one computed quantity — the revenue-weighted return on new capital in the target year — and use it three ways: as a reported diagnostic, as a one-sided consistency guard, and as the basis for a stated terminal-return policy in the seeded cases. Plus construction-time validation on `CaseSpec`/`SegmentSpec` for four inputs that are currently accepted and mis-handled.

**Tech Stack:** Python 3, dataclasses, pytest. No new dependencies. No new database columns, no new endpoints.

**Spec:** `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md`
**Prior spec being amended:** `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md`

## Global Constraints

- **The engine computes the marginal return; the case chooses the terminal return by policy; the engine prevents the latter from exceeding the former.** Nothing in this plan derives `roic_stable`. Do not add code that computes it.
- **The guard is one-sided on purpose.** `roic_stable` *below* the marginal return is legitimate — that is what competitive erosion means. Only the reverse is rejected. Do not add a lower bound.
- **`packages/core_finance/` is pure.** No I/O, no DB, no network, no FastAPI imports.
- **Units: billions throughout, including share counts.** Rates are decimal fractions.
- **Constraint violations raise `ValueError`.** Nothing epsilon-floored, clamped, or silently reinterpreted.
- **Do NOT modify** `packages/core_finance/dcf.py`, `apps/api/services/corporate_dcf.py`, or `packages/shared-types`.
- **No new database columns and no schema change.** `roic_stable` already exists on `valuation_case`.
- **Tests may not make network calls** and must not open `data/processed/moneyview.db`. An autouse `_isolated_db` fixture in `tests/conftest.py` handles isolation.
- **Baseline before this work: 585 tests passing.** Run from repo root `C:\Learn\Economy\MoneyView` with `python -m pytest tests -q`.

## File Structure

| File | Change |
| --- | --- |
| `packages/core_finance/segment_valuation.py` | **Modify.** Add `marginal_roic()`; add 3 fields to `CaseResult`; add the guard and diagnostics to `run_case`; add `SegmentSpec.__post_init__`; extend `CaseSpec.__post_init__`; remove `reinvestment`'s now-unreachable ratio check. |
| `tests/core_finance/test_segment_valuation.py` | **Modify.** Engine unit tests for all of the above; one existing test moves from call-time to construction-time. |
| `tests/core_finance/test_segment_valuation_spacex.py` | **Modify.** Marginal-ROIC gate on both real cases. |
| `apps/api/services/valuation_seed.py` | **Modify.** `roic_stable` set by the §2.5 policy in both cases. |
| `apps/api/services/valuation_case.py` | **Modify.** Expose the 3 diagnostics through `run_stored_case`. |
| `tests/api/test_valuation_seed.py` | **Modify.** Pin the seeded `roic_stable` values. |
| `tests/api/test_valuation_routes.py` | **Modify.** Assert the diagnostics reach `/run`. |
| `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md` | **Modify.** The four amendments in the new spec's §2.6. |
| `guideline/sop/todo.md` | **Modify.** Record the remediation on the existing track. |

---

## Task 1: Marginal ROIC and the reported diagnostics

**Files:**
- Modify: `packages/core_finance/segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation_spacex.py`

**Interfaces:**
- Consumes: `SegmentSpec` (frozen dataclass with `sales_to_capital_late`, `margin_target`, and a `target_revenue() -> float` method), `CaseSpec`, `CaseResult`, `run_case(case, segments) -> CaseResult` — all already exist.
- Produces: `marginal_roic(segments: list[SegmentSpec], marginal_tax_rate: float) -> float`, and three new `CaseResult` fields: `marginal_roic_target_year: float`, `terminal_reinvestment_rate: float`, `explicit_reinvestment_rate_target_year: float`.

**Background.** The terminal value assumes a perpetual return on capital (`roic_stable`) that today has no computed counterpart, so nothing reveals when it contradicts the forecast. The counterpart is the **marginal** return — what a dollar of *new* capital earns — because that is what the terminal reinvestment rate `g / ROIC` actually governs. Level ROIC would need an invested-capital base the case does not carry.

Each segment's marginal return is `sales_to_capital_late × margin_target × (1 − τ)`: a dollar of capital buys `s2c` dollars of revenue, which earn `margin_target` before tax. Weight by target-year revenue, because that is each segment's share of the firm at the moment the terminal value is struck.

Use `spec.target_revenue()` for the weights rather than the computed path. They are equal by construction — the revenue path terminates exactly on target — and using the spec keeps `marginal_roic` testable without running a whole case.

- [ ] **Step 1: Write the failing engine tests**

Append to `tests/core_finance/test_segment_valuation.py`:

```python
from packages.core_finance.segment_valuation import marginal_roic


def test_marginal_roic_is_sales_to_capital_times_margin_after_tax():
    spec = SegmentSpec(
        name="one",
        base_revenue=10.0,
        base_margin=0.0,
        margin_target=0.40,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=100.0,
    )
    # 1.5 x 0.40 x (1 - 0.25) = 0.45
    assert marginal_roic([spec], marginal_tax_rate=0.25) == pytest.approx(0.45)


def test_marginal_roic_is_revenue_weighted_not_an_arithmetic_mean():
    """Spec gate 9.

    Deliberately lopsided: a 90/10 revenue split across segments whose returns
    differ by 16x. The weighted answer is 0.1875; the arithmetic mean is 0.6375.
    Nothing subtle separates them, which is the point -- this test pins the
    weighting property in isolation, so it keeps testing that property even if
    the seeded segment mix changes.
    """
    big = SegmentSpec(
        name="big", base_revenue=1.0, base_margin=0.0, margin_target=0.10,
        sales_to_capital_early=1.0, sales_to_capital_late=1.0, revenue_target=90.0,
    )
    small = SegmentSpec(
        name="small", base_revenue=1.0, base_margin=0.0, margin_target=0.80,
        sales_to_capital_early=1.0, sales_to_capital_late=2.0, revenue_target=10.0,
    )
    # big  = 1.0 x 0.10 x 0.75 = 0.075   on 90 of revenue
    # small= 2.0 x 0.80 x 0.75 = 1.200   on 10 of revenue
    # weighted      = (0.075*90 + 1.200*10) / 100 = 0.1875   <- correct
    # arithmetic mean = (0.075 + 1.200) / 2       = 0.6375   <- what a bug returns
    assert marginal_roic([big, small], marginal_tax_rate=0.25) == pytest.approx(0.1875)


def test_marginal_roic_rejects_an_empty_segment_list():
    with pytest.raises(ValueError, match="at least one segment"):
        marginal_roic([], marginal_tax_rate=0.25)


def test_run_case_reports_the_terminal_reinvestment_rate():
    """Spec gate 5."""
    case = _case()
    result = run_case(case, [_launch()])
    assert result.terminal_reinvestment_rate == pytest.approx(
        case.effective_terminal_growth() / case.roic_stable
    )


def test_run_case_reports_the_explicit_reinvestment_rate():
    """Spec gate 5. The counterpart the terminal rate must be read against."""
    case = _case()
    result = run_case(case, [_launch()])
    nopat = result.ebit[-1] * (1 - case.marginal_tax_rate)
    assert result.explicit_reinvestment_rate_target_year == pytest.approx(
        result.reinvestment[-1] / nopat
    )


def test_run_case_reports_marginal_roic():
    case = _case()
    segments = [_launch()]
    result = run_case(case, segments)
    assert result.marginal_roic_target_year == pytest.approx(
        marginal_roic(segments, case.marginal_tax_rate)
    )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: FAIL — `ImportError: cannot import name 'marginal_roic'`

- [ ] **Step 3: Add `marginal_roic`**

Insert into `packages/core_finance/segment_valuation.py`, immediately **before** the `terminal_value` function:

```python
def marginal_roic(segments: list[SegmentSpec], marginal_tax_rate: float) -> float:
    """Revenue-weighted after-tax return on NEW capital in the target year.

    A dollar of capital buys `sales_to_capital_late` dollars of revenue, which
    earn `margin_target` before tax:

        roic_i = sales_to_capital_late_i x margin_target_i x (1 - tau)

    weighted by each segment's target-year revenue.

    This is the quantity the terminal reinvestment rate `g / ROIC` actually
    governs, which is why the consistency guard in `run_case` compares against it.
    todo3's I3 states ROIC as `EBIT(1-tau) / InvestedCapital`, a *level* return --
    but that needs an invested-capital base the case does not carry, and it blends
    in legacy capital that no longer drives growth. Deliberate deviation.

    Weights come from `spec.target_revenue()` rather than a computed path. They
    are equal by construction -- the revenue path terminates exactly on target --
    and taking them from the spec keeps this function callable without running a
    case.
    """
    if not segments:
        raise ValueError("marginal_roic needs at least one segment")

    after_tax = 1.0 - marginal_tax_rate
    total_revenue = 0.0
    weighted = 0.0
    for spec in segments:
        revenue = spec.target_revenue()
        total_revenue += revenue
        weighted += spec.sales_to_capital_late * spec.margin_target * after_tax * revenue

    if total_revenue == 0:
        raise ValueError(
            "marginal_roic needs a positive total target revenue to weight by"
        )
    return weighted / total_revenue
```

- [ ] **Step 4: Add the three `CaseResult` fields**

In the `CaseResult` dataclass, add these three lines after `base_ebit_total: float`:

```python
    marginal_roic_target_year: float
    terminal_reinvestment_rate: float
    explicit_reinvestment_rate_target_year: float
```

- [ ] **Step 5: Populate them in `run_case`**

In `run_case`, immediately after the line `factors = discount_factors(waccs)`, add:

```python
    target_year_marginal_roic = marginal_roic(segments, case.marginal_tax_rate)
    target_year_nopat = ebit[-1] * (1 - case.marginal_tax_rate)
```

Then add these three arguments to the `CaseResult(...)` constructor call, after
`base_ebit_total=...`:

```python
        marginal_roic_target_year=target_year_marginal_roic,
        terminal_reinvestment_rate=g_stable / case.roic_stable,
        # Zero NOPAT makes the ratio undefined rather than infinite. Reported as
        # 0.0, matching how `terminal_value_share_pct` above handles a zero
        # enterprise value. A negative NOPAT is left as a negative rate: a firm
        # reinvesting while losing money is a real state worth seeing.
        explicit_reinvestment_rate_target_year=(
            reinvest[-1] / target_year_nopat if target_year_nopat else 0.0
        ),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: PASS, 41 tests (35 existing plus 6 new).

- [ ] **Step 7: Add the marginal-ROIC gate on the two real cases**

Append to `tests/core_finance/test_segment_valuation_spacex.py`:

```python
from packages.core_finance.segment_valuation import marginal_roic


def test_post_prospectus_marginal_roic():
    """Spec gate 1. Hand-computed from confirmed margins and the [V] s2c values:

        launch       1.5 x 0.45 x 0.75 = 0.50625  on 70  of target revenue
        connectivity 1.5 x 0.60 x 0.75 = 0.675    on 120
        ai           1.0 x 0.25 x 0.75 = 0.1875   on 160
        expansion    1.5 x 0.30 x 0.75 = 0.3375   on 50
        weighted = 163.3125 / 400 = 0.40828125
    """
    case, segments = post_prospectus()
    assert marginal_roic(segments, case.marginal_tax_rate) == pytest.approx(
        0.40828125, abs=1e-9
    )


def test_pre_prospectus_marginal_roic():
    """Spec gate 1.

        launch       2.0 x 0.40 x 0.75 = 0.60    on 70
        connectivity 2.0 x 0.60 x 0.75 = 0.90    on 120
        ai           1.2 x 0.45 x 0.75 = 0.405   on 80
        expansion    1.5 x 0.30 x 0.75 = 0.3375  on 50
        weighted = 199.275 / 320 = 0.622734375

    Higher than the post case because the pre-case sales-to-capital values are
    higher -- todo3 section 3 records that Damodaran LOWERED them after the
    prospectus. Both sets are [V] guesses.
    """
    case, segments = pre_prospectus()
    assert marginal_roic(segments, case.marginal_tax_rate) == pytest.approx(
        0.622734375, abs=1e-9
    )
```

- [ ] **Step 8: Run the gates**

Run: `python -m pytest tests/core_finance/ -v`
Expected: PASS, 41 in `test_segment_valuation.py` and 8 in `test_segment_valuation_spacex.py` (6 existing plus 2 new).

If a marginal-ROIC gate fails, check the arithmetic in the docstring against the seeded segment values before touching the implementation — the expected numbers are arithmetic on values already in the test file.

- [ ] **Step 9: Commit**

```bash
git add packages/core_finance/segment_valuation.py tests/core_finance/test_segment_valuation.py tests/core_finance/test_segment_valuation_spacex.py
git commit -m "feat: compute marginal ROIC and report the reinvestment-rate discontinuity"
```

---

## Task 2: The one-sided consistency guard

**Files:**
- Modify: `packages/core_finance/segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation.py`

**Interfaces:**
- Consumes: `marginal_roic(segments, marginal_tax_rate) -> float` and the three `CaseResult` fields from Task 1.
- Produces: no new names. `run_case` gains a raise condition.

**Background — read this before writing the guard, because its shape is unusual and deliberate.**

The guard rejects `roic_stable > marginal_roic_target_year` and **nothing else**. It does not enforce a lower bound, and it does not enforce the seeding policy.

Why one-sided: a terminal return *below* the marginal return is exactly what competitive erosion means, and is expected. A terminal return *above* it is not mathematically impossible, but it is inconsistent with the stated assumptions — the margin path has already converged to `margin_target` by the target year and `sales_to_capital_late` does not change afterwards, so the model contains no mechanism by which returns on new capital could improve. A case asserting a higher terminal return is asserting something it has not modelled.

Why no lower bound: nothing in a revenue and margin path can determine *how fast* competitive erosion should occur. That is a judgement about competitive dynamics. So `roic_stable = 0.10` still passes and still produces a terminal reinvestment rate of 45.6% against an explicit-period 17.5%. The engine cannot reject that without pretending to know something it does not. What it does instead is report both rates side by side (Task 1) so whoever chose the input can see the discontinuity.

The guard lives in `run_case`, not `terminal_value`, because it needs the segment list.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core_finance/test_segment_valuation.py`:

```python
def test_terminal_roic_above_the_marginal_return_raises():
    """Spec gate 2. _launch()'s marginal return is 1.5 x 0.45 x 0.75 = 0.50625."""
    with pytest.raises(ValueError, match="exceeds the target-year marginal"):
        run_case(_case(roic_stable=0.60), [_launch()])


def test_the_guard_message_names_both_values():
    """A guard that does not say what it compared cannot be acted on."""
    with pytest.raises(ValueError) as excinfo:
        run_case(_case(roic_stable=0.60), [_launch()])
    message = str(excinfo.value)
    assert "60.0000%" in message
    assert "50.6250%" in message


def test_terminal_roic_below_the_marginal_return_is_accepted():
    """Spec gate 3. The guard is one-sided: erosion is legitimate.

    0.12 against a 0.50625 marginal return is the exact configuration that
    motivated this work -- a suspiciously low terminal return. It must still run,
    because nothing in the model can determine the speed of competitive erosion.
    The engine reports the discontinuity instead of refusing it.
    """
    result = run_case(_case(roic_stable=0.12), [_launch()])
    assert result.terminal_reinvestment_rate > result.explicit_reinvestment_rate_target_year
    assert result.enterprise_value > 0


def test_terminal_roic_exactly_at_the_marginal_return_is_accepted():
    """The boundary is inclusive: equality is consistent, not contradictory."""
    result = run_case(_case(roic_stable=0.50625), [_launch()])
    assert result.marginal_roic_target_year == pytest.approx(0.50625)


def test_terminal_reinvestment_rate_stays_below_one_for_any_admitted_case():
    """Spec gate 8.

    Not a production guard -- the spec argues one would be dead code, because
    `roic_stable > wacc_stable` and `wacc_stable > g_stable` together already
    force `g / roic_stable < 1`. This test checks that argument rather than
    leaving it asserted. Sweeps roic_stable across the admitted range, from just
    above wacc_stable up to the marginal return.
    """
    # The relationship only binds for positive growth, so pin that first --
    # otherwise the sweep below could pass vacuously.
    assert _case().effective_terminal_growth() > 0

    for roic in (0.0826, 0.10, 0.12, 0.25, 0.40, 0.50625):
        result = run_case(_case(roic_stable=roic), [_launch()])
        assert 0 < result.terminal_reinvestment_rate < 1, roic
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: FAIL — `test_terminal_roic_above_the_marginal_return_raises` and
`test_the_guard_message_names_both_values` fail because no guard exists yet
(`run_case` returns a result rather than raising). The other three should already pass.

- [ ] **Step 3: Add the guard**

In `run_case`, immediately after the two lines Task 1 added
(`target_year_marginal_roic = ...` and `target_year_nopat = ...`), insert:

```python
    # One-sided by design. A terminal return BELOW the marginal return is
    # competitive erosion and is expected; the engine cannot judge its speed and
    # does not try. A terminal return ABOVE it is inconsistent with the stated
    # assumptions: margins have converged to margin_target by the target year and
    # sales_to_capital_late does not change afterwards, so nothing in the model
    # produces the improvement in returns such a case asserts.
    if case.roic_stable > target_year_marginal_roic:
        raise ValueError(
            f"roic_stable {case.roic_stable:.4%} exceeds the target-year marginal "
            f"return on new capital {target_year_marginal_roic:.4%}. Margins have "
            f"already converged and sales-to-capital does not change after the "
            f"target year, so the model contains no mechanism by which returns on "
            f"new capital could improve."
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/ -v`
Expected: PASS, 46 in `test_segment_valuation.py` (41 plus 5 new) and 8 in the SpaceX file.

The existing `_case()` default `roic_stable=0.12` is well below `_launch()`'s 0.50625 marginal return, and `tests/api/valuation_fixtures.py` uses the same pair, so no existing test should start failing. If one does, report it rather than adjusting the guard.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest tests -q`
Expected: 598 passing (585 baseline, plus 8 from Task 1 and 5 from Task 2). No failures.

The seeded cases still use `roic_stable = 0.12`, which passes the guard for both — 0.12 is below the pre case's 0.6227 and the post case's 0.4083. Task 4 changes those values.

- [ ] **Step 6: Commit**

```bash
git add packages/core_finance/segment_valuation.py tests/core_finance/test_segment_valuation.py
git commit -m "feat: reject a terminal return above the model's marginal return"
```

---

## Task 3: Construction-time guards for silently-wrong inputs

**Files:**
- Modify: `packages/core_finance/segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation.py`

**Interfaces:**
- Consumes: `CaseSpec` (frozen dataclass with an existing `__post_init__`), `SegmentSpec` (frozen dataclass with **no** `__post_init__` yet).
- Produces: no new names. Both dataclasses gain validation.

**Background.** Four inputs are currently accepted and mis-handled. Every one produces a plausible-looking wrong valuation rather than an error, which is the worst failure mode this engine has — a raised exception gets fixed, a wrong number gets used.

| Input | What happens today |
| --- | --- |
| `nol_balance < 0` | `tax_path` computes `shield = min(balance, amount)`, which goes negative and is then *added* to the taxable base. `tax_path([10,10,10], 0.25, -20)` returns `[7.5, 2.5, 2.5]` — 12.5 of tax on 30 of EBIT, a 41.7% effective rate against a 25% marginal rate. |
| `marginal_tax_rate` outside [0,1] | A percent/decimal slip (`25.0`) makes `(1 − τ)` equal −24, and the case returns a large negative enterprise value with no error. |
| `ramp_start_year < 1` | `lead = ramp_start_year − 1` goes negative, `[0.0] * -1` is `[]`, and `steps = n + 1`, so the revenue list is 11 long against a 10-long margin list. `zip` truncates, and target-year revenue silently lands at 395.45 instead of 400.00. |
| `sales_to_capital_* <= 0` | Checked lazily inside `reinvestment`'s loop, so it only fires if a year actually reaches that ratio. A segment with `ramp_start_year=7` never validates its early ratio at all. |

Both dataclasses are `frozen=True`, so construction-time validation cannot be bypassed by mutation.

Moving the `sales_to_capital` check to construction makes `reinvestment`'s in-loop check unreachable, so it is **removed** rather than left as dead defence. One existing test moves with it.

**Test both sides of every boundary.** Tests that only prove bad values fail do not document the intended domain. `marginal_tax_rate = 0.0` and `1.0` must be accepted; `ramp_start_year = 1` must be accepted; `nol_balance = 0.0` must be accepted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core_finance/test_segment_valuation.py`:

```python
def _segment(**overrides) -> dict:
    """Valid SegmentSpec keyword arguments, for boundary tests to perturb."""
    base = dict(
        name="s",
        base_revenue=10.0,
        base_margin=0.0,
        margin_target=0.20,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=100.0,
    )
    base.update(overrides)
    return base


# --- marginal_tax_rate -------------------------------------------------------

def test_marginal_tax_rate_just_below_zero_raises():
    with pytest.raises(ValueError, match="marginal_tax_rate"):
        _case(marginal_tax_rate=-1e-9)


def test_marginal_tax_rate_just_above_one_raises():
    with pytest.raises(ValueError, match="marginal_tax_rate"):
        _case(marginal_tax_rate=1 + 1e-9)


def test_marginal_tax_rate_as_a_percentage_raises():
    """The realistic slip: 25 meaning 25%, which makes (1 - tau) equal -24."""
    with pytest.raises(ValueError, match="decimal fraction"):
        _case(marginal_tax_rate=25.0)


def test_marginal_tax_rate_of_zero_is_accepted():
    assert _case(marginal_tax_rate=0.0).marginal_tax_rate == 0.0


def test_marginal_tax_rate_of_one_is_accepted():
    assert _case(marginal_tax_rate=1.0).marginal_tax_rate == 1.0


# --- nol_balance -------------------------------------------------------------

def test_negative_nol_balance_raises():
    """A negative balance is added to the taxable base by tax_path, producing a
    41.7% effective rate against a 25% marginal rate with no error."""
    with pytest.raises(ValueError, match="nol_balance"):
        _case(nol_balance=-1e-9)


def test_zero_nol_balance_is_accepted():
    assert _case(nol_balance=0.0).nol_balance == 0.0


# --- ramp_start_year ---------------------------------------------------------

def test_ramp_start_year_of_zero_raises():
    with pytest.raises(ValueError, match="ramp_start_year"):
        SegmentSpec(**_segment(ramp_start_year=0))


def test_negative_ramp_start_year_raises():
    with pytest.raises(ValueError, match="ramp_start_year"):
        SegmentSpec(**_segment(ramp_start_year=-1))


def test_ramp_start_year_of_one_is_accepted():
    assert SegmentSpec(**_segment(ramp_start_year=1)).ramp_start_year == 1


# --- sales_to_capital --------------------------------------------------------

def test_zero_sales_to_capital_early_raises():
    with pytest.raises(ValueError, match="sales_to_capital_early"):
        SegmentSpec(**_segment(sales_to_capital_early=0.0))


def test_negative_sales_to_capital_early_raises():
    with pytest.raises(ValueError, match="sales_to_capital_early"):
        SegmentSpec(**_segment(sales_to_capital_early=-1.0))


def test_zero_sales_to_capital_late_raises():
    with pytest.raises(ValueError, match="sales_to_capital_late"):
        SegmentSpec(**_segment(sales_to_capital_late=0.0))


def test_negative_sales_to_capital_late_raises():
    with pytest.raises(ValueError, match="sales_to_capital_late"):
        SegmentSpec(**_segment(sales_to_capital_late=-1.0))


def test_a_small_positive_sales_to_capital_is_accepted():
    assert SegmentSpec(**_segment(sales_to_capital_early=1e-6)).sales_to_capital_early == 1e-6


def test_an_early_ratio_is_validated_even_when_no_year_reaches_it():
    """The gap this closes: a delayed segment never exercises its early ratio, so
    a lazy in-loop check would never fire for it."""
    with pytest.raises(ValueError, match="sales_to_capital_early"):
        SegmentSpec(**_segment(
            base_revenue=0.0, ramp_start_year=7, sales_to_capital_early=-5.0
        ))
```

- [ ] **Step 2: Update the one existing test that moves to construction time**

In the same file, replace `test_reinvestment_rejects_non_positive_sales_to_capital`
(around line 210) entirely. It currently builds a `SegmentSpec` with
`sales_to_capital_early=0.0` and expects `reinvestment` to raise; after this task
the construction itself raises, so the old test would fail for the wrong reason.
`test_zero_sales_to_capital_early_raises` above replaces it — delete the old test.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: FAIL — the `ramp_start_year` and `sales_to_capital` tests fail because
`SegmentSpec` has no validation and construction succeeds; the `marginal_tax_rate`
and `nol_balance` tests fail because `CaseSpec.__post_init__` does not check them.

- [ ] **Step 4: Extend `CaseSpec.__post_init__`**

Add to the end of the existing `CaseSpec.__post_init__`, after the `shares_basic` check:

```python
        if self.nol_balance < 0:
            raise ValueError(
                f"nol_balance must not be negative, got {self.nol_balance}. "
                f"tax_path adds a negative balance to the taxable base, which "
                f"overstates tax without raising."
            )
        if not 0.0 <= self.marginal_tax_rate <= 1.0:
            raise ValueError(
                f"marginal_tax_rate must be a decimal fraction between 0 and 1, "
                f"got {self.marginal_tax_rate}. A percentage such as 25.0 makes "
                f"(1 - tau) negative and returns a large negative valuation with "
                f"no error."
            )
```

- [ ] **Step 5: Add `SegmentSpec.__post_init__`**

Add to the `SegmentSpec` dataclass, immediately **before** the `target_revenue` method:

```python
    def __post_init__(self) -> None:
        if self.ramp_start_year < 1:
            raise ValueError(
                f"{self.name}: ramp_start_year must be at least 1, got "
                f"{self.ramp_start_year}. Below 1 it produces a revenue path "
                f"longer than the horizon, which zip() then truncates -- the "
                f"target-year revenue silently misses its target."
            )
        if self.sales_to_capital_early <= 0:
            raise ValueError(
                f"{self.name}: sales_to_capital_early must be positive, got "
                f"{self.sales_to_capital_early}"
            )
        if self.sales_to_capital_late <= 0:
            raise ValueError(
                f"{self.name}: sales_to_capital_late must be positive, got "
                f"{self.sales_to_capital_late}"
            )
```

- [ ] **Step 6: Remove the now-unreachable check in `reinvestment`**

In `reinvestment`, delete these four lines (they sit just after the `ratio = (...)`
assignment):

```python
        if ratio <= 0:
            raise ValueError(
                f"{spec.name}: sales_to_capital must be positive, got {ratio}"
            )
```

Then correct the function's docstring, which currently justifies the pre-ramp guard
by reference to arbitrary input. Replace the paragraph beginning "Years before
`ramp_start_year` book zero" with:

```
    Years before `ramp_start_year` book zero regardless of the revenue series. For
    a segment ramping from a zero base the delta is already zero, so the guard is
    redundant in practice -- `revenue_path` rejects a non-zero base combined with
    `ramp_start_year > 1`, and `SegmentSpec` now rejects `ramp_start_year < 1`. It
    stays because this function is public and takes an arbitrary revenues list.

    The sales-to-capital ratios are no longer checked here. `SegmentSpec` validates
    them at construction, which also covers a delayed segment whose early ratio no
    year ever reaches -- a case this loop could not see.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/ -v`
Expected: PASS, 61 in `test_segment_valuation.py` (46 from Task 2, minus 1 deleted,
plus 16 new) and 8 in the SpaceX file.

- [ ] **Step 8: Run the full suite**

Run: `python -m pytest tests -q`
Expected: 613 passing. No failures.

Watch for fallout in `tests/api/`: every seeded and fixture segment must satisfy the
new construction rules. They should — all use `ramp_start_year` of 1 or 7 and
positive ratios — but if any test fails, report it rather than relaxing a guard.

- [ ] **Step 9: Commit**

```bash
git add packages/core_finance/segment_valuation.py tests/core_finance/test_segment_valuation.py
git commit -m "fix: reject four inputs that produced wrong valuations instead of errors"
```

---

## Task 4: Apply the terminal-ROIC policy to the seeded cases and amend the specs

**Files:**
- Modify: `apps/api/services/valuation_seed.py`
- Modify: `apps/api/services/valuation_case.py`
- Test: `tests/api/test_valuation_seed.py`
- Test: `tests/api/test_valuation_routes.py`
- Modify: `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md`
- Modify: `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md`
- Modify: `guideline/sop/todo.md`

**Interfaces:**
- Consumes: `marginal_roic` and the three `CaseResult` fields (Task 1), the guard (Task 2).
- Produces: no new names. `run_stored_case`'s returned dict gains three keys:
  `marginal_roic_target_year`, `terminal_reinvestment_rate`,
  `explicit_reinvestment_rate_target_year`.

**Background.** The seeded `roic_stable = 0.12` was invented — it appears nowhere in
`guideline/sop/todo3.md`. Replace it with a value chosen by an explicit stated policy:

```
roic_stable = wacc_stable + (marginal_roic - wacc_stable) / 2
            = (wacc_stable + marginal_roic) / 2
```

Half of the excess return over the cost of capital survives in perpetuity, half
competes away. This is a **modelling policy, not a derivation** — the engine cannot
determine the speed of competitive erosion, and this plan must not add code that tries.

| Case | `wacc_stable` | marginal ROIC | policy value | rounded, seeded |
| --- | --- | --- | --- | --- |
| pre-prospectus | 0.0800 | 0.622734375 | 0.3513671875 | **0.3514** |
| post-prospectus | 0.0825 | 0.40828125 | 0.245390625 | **0.2454** |

Write the rounded literals. A seed that recomputes its own inputs cannot be checked
against anything.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_valuation_seed.py`:

```python
def test_seeded_terminal_roic_follows_the_stated_erosion_policy():
    """roic_stable = (wacc_stable + marginal_roic) / 2, rounded to 4dp.

    Expectations are literal, not recomputed from the seed module -- a test that
    re-derives its expectation from the code under test cannot catch a wrong value.
    """
    ensure_valuation_cases_seeded()
    pre = load_case(_case_id(PRE_CASE_NAME))
    post = load_case(_case_id(POST_CASE_NAME))
    assert pre["roic_stable"] == pytest.approx(0.3514)
    assert post["roic_stable"] == pytest.approx(0.2454)


def test_seeded_terminal_roic_sits_below_the_marginal_return():
    """The policy must satisfy the engine's guard, and by a real margin -- an
    erosion rule that lands at or above the marginal return is not erosion."""
    ensure_valuation_cases_seeded()
    for name, marginal in ((PRE_CASE_NAME, 0.622734375), (POST_CASE_NAME, 0.40828125)):
        data = _run(name)
        assert data["marginal_roic_target_year"] == pytest.approx(marginal, abs=1e-9)
        assert load_case(_case_id(name))["roic_stable"] < marginal


def test_run_reports_both_reinvestment_rates_for_the_seeded_cases():
    """The discontinuity the whole change exists to make visible."""
    ensure_valuation_cases_seeded()
    data = _run(POST_CASE_NAME)
    assert data["terminal_reinvestment_rate"] > 0
    assert data["explicit_reinvestment_rate_target_year"] > 0
    assert data["terminal_reinvestment_rate"] < 1
```

Append to `tests/api/test_valuation_routes.py`:

```python
def test_run_exposes_the_terminal_consistency_diagnostics():
    case_id = client.post(
        "/api/v1/valuation/cases", json=_case_payload(case_name="diagnostics")
    ).json()["data"]["id"]
    data = client.post(f"/api/v1/valuation/cases/{case_id}/run").json()["data"]
    for key in (
        "marginal_roic_target_year",
        "terminal_reinvestment_rate",
        "explicit_reinvestment_rate_target_year",
    ):
        assert key in data, key
        assert isinstance(data[key], float)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_valuation_seed.py tests/api/test_valuation_routes.py -v`
Expected: FAIL — the seeded `roic_stable` is still 0.12, and `run_stored_case` does
not emit the three keys.

- [ ] **Step 3: Expose the diagnostics through the service**

In `apps/api/services/valuation_case.py`, in the dict `run_stored_case` returns, add
these three entries immediately after `"base_ebit_total": result.base_ebit_total,`:

```python
        "marginal_roic_target_year": result.marginal_roic_target_year,
        "terminal_reinvestment_rate": result.terminal_reinvestment_rate,
        "explicit_reinvestment_rate_target_year": (
            result.explicit_reinvestment_rate_target_year
        ),
```

- [ ] **Step 4: Apply the policy to both seeded cases**

In `apps/api/services/valuation_seed.py`, change `"roic_stable": 0.12,` to
`"roic_stable": 0.3514,` in `_pre_prospectus_payload`, and to `"roic_stable": 0.2454,`
in `_post_prospectus_payload`.

Add this to the module docstring, after the paragraph explaining the confidence tags:

```
`roic_stable` is set by an explicit competitive-erosion policy rather than taken
from a source: half the excess return over the cost of capital survives in
perpetuity, half competes away --

    roic_stable = (wacc_stable + marginal_roic) / 2

where marginal_roic is the revenue-weighted `sales_to_capital_late x margin_target
x (1 - tau)` the engine computes. Pre: (0.0800 + 0.622734) / 2 = 0.3514. Post:
(0.0825 + 0.408281) / 2 = 0.2454. This is a modelling judgement about the speed of
competitive erosion, not a derivation -- the engine constrains only the direction.
The previous value, 0.12, was invented and appears nowhere in todo3.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/api/ -v`
Expected: PASS. The seed's target-year totals must be unchanged — `roic_stable`
affects only the terminal value, never the revenue or EBIT paths. If
`test_seeded_target_year_totals_match_the_confirmed_inputs` fails, something other
than this change is wrong; report it.

- [ ] **Step 6: Record the resulting valuation**

Run and capture the output:

```bash
python -c "
from tests.core_finance.test_segment_valuation_spacex import pre_prospectus, post_prospectus
from packages.core_finance.segment_valuation import run_case, marginal_roic
import dataclasses
for name, build, published in (('pre',pre_prospectus,1210),('post',post_prospectus,1220)):
    case, segs = build()
    seeded = 0.3514 if name=='pre' else 0.2454
    r = run_case(dataclasses.replace(case, roic_stable=seeded), segs)
    print(f'{name}: roic={seeded} marginal={marginal_roic(segs, case.marginal_tax_rate):.6f} EV={r.enterprise_value:.1f} (published {published}) \$/sh={r.value_per_share_diluted:.2f} TVshare={r.terminal_value_share_pct:.1f}% explicitRIR={r.explicit_reinvestment_rate_target_year:.3f} terminalRIR={r.terminal_reinvestment_rate:.3f}')
"
```

This is read-only — it constructs cases in memory and touches no database.

Then update the table in `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md` §2.5 with the measured EV and per-share figures if they differ from the recorded 1333.2 (pre) and 1210.0 (post). Do not change the published reference figures.

- [ ] **Step 7: Amend the prior spec**

In `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md`, make the
four changes its successor's §2.6 specifies:

1. **§1.2** — keep the "a model with a dozen free parameters can be tuned to $1.22T
   while being structurally wrong" sentence, then add immediately after it:

```
   **Corrected 2026-08-10.** That is right about agreement and wrong about the gap.
   Agreement alone would be weak evidence, but a gap is informative whenever the
   free parameters can be *bounded* -- and they can. Holding `roic_stable` at the
   seeded value and setting every `[V]` input to its most value-favourable extreme
   (zero reinvestment and zero tax for all ten years) reaches EV 1186.6, still short
   of 1220. The gap was never attributable to those inputs; it was one unconstrained
   parameter. See `2026-08-10-terminal-roic-consistency-design.md`.
```

2. **§4.2** — the `roic_stable` paragraph currently argues that deriving it from the
   model "would make terminal value a function of the `[V]` sales-to-capital guesses,
   which is exactly the coupling to avoid." Append:

```
   **Reversed 2026-08-10.** That reasoning is backwards. todo3's F6
   (`ReinvRate = g / ROIC_stable`) exists precisely to couple the perpetuity to the
   explicit period; implementing F6 while omitting I3 turned the one mechanism whose
   purpose is internal consistency into a free parameter. The engine now computes a
   marginal ROIC and rejects a terminal return above it. See
   `2026-08-10-terminal-roic-consistency-design.md`.
```

3. **§6** — replace the recorded diagnostic figures (EV 916.2 / $75.86 / TV share
   102.4% for the post case, and the pre-case line) with the values measured in
   Step 6, and note the date and cause of the change.

4. **§7** — add a line noting the terminal-consistency work is done and pointing at
   the new spec, so the out-of-scope list does not read as still-open.

- [ ] **Step 8: Update the track record**

In `guideline/sop/todo.md`, under the existing "Segment Build-Up Valuation" track, add:

```markdown
- [x] Terminal ROIC consistency remediation (2026-08-10) - an independent
      adversarial review found `roic_stable` shipped as an unconstrained input set
      3.5x below the model's own marginal return on capital, accounting for
      essentially the whole gap against the published valuation. Engine now computes
      marginal ROIC, rejects a terminal return above it, and reports both
      reinvestment rates. Four inputs that produced wrong numbers instead of errors
      now raise at construction.
      Spec: `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md`

Still open from that review, deliberately out of scope:
- Case-level inputs carry no narrative rows, so `roic_stable` -- the most valuable
  number in the model -- cannot carry a claim in the data.
- Base-year off-by-one: the seed labels its revenues FY2025 while setting
  `base_year=2026`, making the horizon 10 where the figures imply 11 (~6% EV).
- Growth-path shape: the decaying curve makes year 1 always the fastest, so the model
  cannot express the slowed near-term growth todo3 R3 records as `[C]`.
- API lifecycle: no update or delete endpoint; structural validation fires at `/run`
  rather than `POST`; horizon is unbounded.
```

- [ ] **Step 9: Run the full suite**

Run: `python -m pytest tests -q`
Expected: 617 passing. No failures.

- [ ] **Step 10: Commit**

```bash
git add apps/api/services/valuation_seed.py apps/api/services/valuation_case.py tests/api/test_valuation_seed.py tests/api/test_valuation_routes.py docs/superpowers/specs/ guideline/sop/todo.md
git commit -m "feat: seed terminal ROIC by a stated erosion policy, amend prior spec"
```

---

## Self-Review Notes

**Spec coverage.** §2.1 → Task 1 Step 3. §2.2 → Task 2 Step 3. §2.2.1's "upper bound,
not an estimate" → Task 2's `test_terminal_roic_below_the_marginal_return_is_accepted`,
which pins the 0.12 case as *accepted*. §2.3 → Task 1 Steps 4-5. §2.4 → Task 3. §2.5 →
Task 4 Steps 4 and 6. §2.6 → Task 4 Step 7. §3 gates: 1 → Task 1 Step 7; 2 → Task 2
Step 1; 3 → Task 2 Step 1; 4 → Task 3 Step 1 (both sides of all four boundaries);
5 → Task 1 Step 1; 6 → Task 4 Step 5; 7 → every task's final step; 8 → Task 2 Step 1;
9 → Task 1 Step 1.

**§4 out-of-scope items are recorded, not implemented** — Task 4 Step 8 writes all four
into the tracker so they survive the deletion of this plan's workspace.

**Type consistency.** `marginal_roic(segments, marginal_tax_rate)` keeps that signature
in Tasks 1, 2 and 4. The three `CaseResult` field names are identical in Task 1
(definition), Task 2 (assertions) and Task 4 (service dict keys and route assertions).

**Two things a reviewer should NOT flag.** The guard has no lower bound — §2.2.1 argues
that at length, and Task 2's background repeats it. And `roic_stable` remains an input
rather than a computed value — the engine cannot know the speed of competitive erosion,
so a derivation would encode a judgement as if it were arithmetic.
