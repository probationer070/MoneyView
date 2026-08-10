# Near-Term Growth Curve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a segment's revenue path start at an observed growth rate instead of being forced to peak in year 1, so the engine can express the slowed near-term growth its source records as confirmed.

**Architecture:** Add a second growth-curve shape that pins **both** endpoints — year-1 growth to an observed input, year-n growth to `g_stable` — and solves a single hump amplitude by bisection to hit the target-year revenue. The existing curve stays as the default when the new input is absent, so nothing already stored changes behaviour.

**Tech Stack:** Python 3, `math` (stdlib), dataclasses, SQLite, Pydantic v2, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-10-growth-curve-near-term-design.md`
**Branch:** `feat-statements-acquisition` — this updates PR #4 in place.

## Global Constraints

- **`initial_growth = None` must reproduce the existing path element-for-element.** This is the backward-compatibility guarantee and it is gated in Task 1. Every currently-stored case and every existing test keeps its exact behaviour.
- **Both endpoints are pinned by construction, not by solving.** `g(1) = initial_growth` and `g(n) = g_stable` hold because `sin` vanishes at both ends. If an implementation needs to solve for either, it is the wrong implementation.
- **The bisection bracket must be computed, not hardcoded.** `a_low = -0.99 - min(initial_growth, g_stable)`. The solver's monotonicity argument holds only while every `(1 + g_t)` stays positive; a hardcoded `-0.99` breaks for a declining segment.
- **`packages/core_finance/` stays pure.** No I/O, DB, network, or FastAPI imports.
- **Constraint violations raise `ValueError`.** Nothing clamped, floored, or silently reinterpreted.
- **Do NOT modify** `packages/core_finance/dcf.py`, `apps/api/services/corporate_dcf.py`, or `packages/shared-types`.
- **Units:** billions throughout. Rates are decimal fractions.
- **Seeded target-year totals must not move:** 400.0 / 158.5 post, 320.0 / 151.0 pre. Both curves hit the endpoint by construction, so these are unaffected. If one moves, stop and report.
- **Tests may not make network calls** or open `data/processed/moneyview.db`. An autouse `_isolated_db` fixture handles isolation.
- **Known pre-existing flake:** `test_persistence_failure_self_disables_logs_once_and_keeps_ring_buffer` in `tests/api/test_perf_capture.py` is order-dependent. Note if hit; do not fix.
- **Baseline before this work: 630 tests passing.** Run from repo root with `python -m pytest tests -q`.

## File Structure

| File | Change |
| --- | --- |
| `packages/core_finance/segment_valuation.py` | **Modify.** Add `import math`; add `_hump_shape`, `_anchored_growth_rates`, `_compound_anchored`, `_solve_hump_amplitude`; add `initial_growth` to `SegmentSpec` with validation; branch in `revenue_path`. |
| `tests/core_finance/test_segment_valuation.py` | **Modify.** Curve tests, endpoint pinning, backward-compat, the dip case, validation. |
| `apps/api/services/db.py` | **Modify.** One nullable column on `segment`. |
| `apps/api/models/schema_parts/valuation.py` | **Modify.** `initial_growth` on `SegmentInput`. |
| `apps/api/services/valuation_case.py` | **Modify.** Add to `NARRATED_FIELDS`, `_SEGMENT_COLUMNS`, and the `SegmentSpec` construction in `_to_specs`. |
| `tests/api/test_valuation_schema.py`, `tests/api/test_valuation_case_service.py` | **Modify.** Column presence; narrative-rule coverage for the new field. |
| `apps/api/services/valuation_seed.py` | **Modify.** Seed the three confirmed actuals with claims. |
| `tests/api/test_valuation_seed.py` | **Modify.** Pin the seeded values, tags, and consolidated year-1 growth. |
| `tests/core_finance/test_segment_valuation_spacex.py` | **Modify.** Update the pinned enterprise values. |
| `docs/superpowers/specs/2026-08-09-*.md`, `docs/superpowers/specs/2026-08-10-terminal-roic-*.md`, `guideline/sop/todo.md` | **Modify.** Update stale valuation figures; close the divergence entry. |

---

## Task 1: The anchored growth curve

**Files:**
- Modify: `packages/core_finance/segment_valuation.py`
- Test: `tests/core_finance/test_segment_valuation.py`

**Interfaces:**
- Consumes: `SegmentSpec` (frozen dataclass, has `__post_init__`), `revenue_path(spec, n, g_stable) -> list[float]`, `_decaying_growth_rates(g_first, n, g_stable)`, `_solve_first_year_growth(ratio, n, g_stable)`, constants `_G1_LOW = -0.99`, `_G1_HIGH = 1000.0`, `_BISECTION_STEPS = 200`.
- Produces: `SegmentSpec.initial_growth: float | None = None`, and module-private `_hump_shape`, `_anchored_growth_rates`, `_compound_anchored`, `_solve_hump_amplitude`.

**Background — why the obvious implementation is wrong.**

The existing curve is `g_t = g₁ − (g₁ − g_stable)·(t−1)/(n−1)` with `g₁` solved to hit the target. One free parameter, one condition — so year-1 growth is entirely determined by the endpoint and cannot also be set. That is why year 1 is structurally the fastest year of every segment.

The source document recommends a logistic. **Do not build one.** Normalized to hit the target and steepened until year-1 growth matches an observed 7.64%, a logistic saturates: year-10 growth falls to **0.54%** while the terminal value assumes `g_stable = 4.56%` in perpetuity. That is an unmodelled discontinuity at the year-10 boundary — the same defect class this codebase spent three review rounds removing from the terminal block. A curve that pins only one endpoint cannot be used with a perpetuity that assumes the other.

The curve below pins both:

```
g_t = g_init + (g_stable − g_init)·(t−1)/(n−1) + a · sin(π·(t−1)/(n−1))
```

`sin` is zero at `t = 1` and `t = n`, so both endpoints hold **by construction** and neither depends on `a`. The single free parameter `a` is solved by bisection against the target.

**The bracket is the subtle part.** Monotonicity — `d/da Π(1+g_t) = Σ_t [ sin_t · Π_{s≠t}(1+g_s) ] ≥ 0` — holds only while every factor stays positive. The linear term never drops below `min(g_init, g_stable)` and `sin ≤ 1`, so for `a < 0` the trough is `min(g_init, g_stable) + a`. Keeping it above `−1` gives `a_low = -0.99 - min(g_init, g_stable)`, which pins the trough at exactly `−0.99` for any input. Computing it wrong is silent: the solver still returns a number.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core_finance/test_segment_valuation.py`. Add `math` to the imports at the top of the file if not already present, and add the new names to the existing `from packages.core_finance.segment_valuation import ...` statement.

```python
def _anchored(**overrides) -> SegmentSpec:
    """A segment with an observed year-1 growth rate, for curve tests."""
    base = dict(
        name="anchored",
        base_revenue=4.1,
        base_margin=-0.10,
        margin_target=0.45,
        sales_to_capital_early=1.0,
        sales_to_capital_late=1.5,
        revenue_target=70.0,
        initial_growth=0.0764,
    )
    base.update(overrides)
    return SegmentSpec(**base)


def test_anchored_path_starts_at_the_observed_growth_rate():
    """Pinned by construction: sin vanishes at t=1, so `a` cannot move it."""
    spec = _anchored()
    path = revenue_path(spec, n=10, g_stable=0.0456)
    assert path[0] / spec.base_revenue - 1 == pytest.approx(0.0764, abs=1e-12)


def test_anchored_path_ends_at_stable_growth():
    """The reason a logistic was rejected: the explicit period must hand off to
    the perpetuity at the growth rate the perpetuity assumes."""
    path = revenue_path(_anchored(), n=10, g_stable=0.0456)
    assert path[-1] / path[-2] - 1 == pytest.approx(0.0456, abs=1e-12)


def test_anchored_path_still_lands_exactly_on_target():
    path = revenue_path(_anchored(), n=10, g_stable=0.0456)
    assert path[-1] == pytest.approx(70.0, abs=1e-9)


def test_anchored_path_is_slower_in_year_one_than_the_decaying_curve():
    """The whole point. Same endpoints, same base -- only the shape differs."""
    anchored = revenue_path(_anchored(), n=10, g_stable=0.0456)
    decaying = revenue_path(_anchored(initial_growth=None), n=10, g_stable=0.0456)
    assert anchored[0] < decaying[0]
    assert decaying[0] / 4.1 - 1 == pytest.approx(0.638, abs=0.002)


def test_anchored_path_humps_in_the_middle():
    """Slow start plus a fixed endpoint forces a fast middle. That is arithmetic,
    not a modelling choice, and it must not be hidden."""
    path = revenue_path(_anchored(), n=10, g_stable=0.0456)
    levels = [4.1, *path]
    growths = [levels[i + 1] / levels[i] - 1 for i in range(len(path))]
    assert max(growths) == pytest.approx(0.548, abs=0.005)
    assert growths.index(max(growths)) not in (0, len(growths) - 1)


def test_a_segment_already_growing_fast_enough_solves_to_a_dip():
    """Connectivity's shape: linear decay from its observed rate already compounds
    to target, so the hump amplitude solves to about zero rather than erroring."""
    spec = _anchored(name="connectivity", base_revenue=11.4,
                     revenue_target=120.0, initial_growth=0.50)
    path = revenue_path(spec, n=10, g_stable=0.0456)
    levels = [11.4, *path]
    growths = [levels[i + 1] / levels[i] - 1 for i in range(len(path))]
    assert path[-1] == pytest.approx(120.0, abs=1e-9)
    # Near-linear decay from 50% to 4.56%: consecutive steps are near-equal.
    # Measured deviation is 1.12e-3 (the solved amplitude is 0.00164, not exactly
    # zero), so the tolerance is 2e-3 -- tight enough that a real hump fails it.
    steps = [growths[i + 1] - growths[i] for i in range(len(growths) - 1)]
    assert steps == pytest.approx([steps[0]] * len(steps), abs=2e-3)


def test_a_negative_hump_amplitude_is_solvable_not_an_error():
    """A segment whose observed growth overshoots its endpoint needs a dip. The
    bracket must reach below zero, and the trough must stay above -100%."""
    spec = _anchored(base_revenue=10.0, revenue_target=12.0, initial_growth=0.60)
    path = revenue_path(spec, n=10, g_stable=0.0456)
    levels = [10.0, *path]
    growths = [levels[i + 1] / levels[i] - 1 for i in range(len(path))]
    assert path[-1] == pytest.approx(12.0, abs=1e-9)
    assert min(growths) < 0
    assert min(growths) > -1.0


def test_the_hump_bracket_keeps_every_growth_factor_positive():
    """This is the test that actually catches a hardcoded bracket.

    The solver's monotonicity argument holds only while every (1 + g_t) > 0, so
    the lower bound must be computed from min(initial_growth, g_stable). Asserting
    on a solved path does NOT catch a bad bracket: measured with a hardcoded
    -0.99 and initial_growth=-0.50, four growth factors go negative, yet an even
    count multiplies to a positive product, so the bracket check still passes and
    bisection proceeds on a violated precondition -- then converges to the right
    answer anyway, because the true root sits well inside the valid region.

    So test the bound directly rather than its consequences.
    """
    for g_init in (0.50, 0.0, -0.50, -0.90):
        low = _hump_amplitude_lower_bound(g_init, 0.0456)
        rates = _anchored_growth_rates(g_init, low, 10, 0.0456)
        assert all(1 + rate > 0 for rate in rates), g_init


def test_a_declining_segment_still_hits_its_target():
    """End-to-end sanity for a shrinking segment. Note this passes with a broken
    bracket too -- `test_the_hump_bracket_keeps_every_growth_factor_positive` is
    what guards the bracket."""
    spec = _anchored(base_revenue=50.0, revenue_target=30.0, initial_growth=-0.50)
    path = revenue_path(spec, n=10, g_stable=0.0456)
    assert path[-1] == pytest.approx(30.0, abs=1e-9)
    assert all(level > 0 for level in path)


def test_initial_growth_at_or_below_minus_one_raises():
    with pytest.raises(ValueError, match="initial_growth"):
        _anchored(initial_growth=-1.0)


def test_initial_growth_on_a_ramped_segment_raises():
    """A segment with no revenue today has no year-1 growth rate to pin."""
    with pytest.raises(ValueError, match="initial_growth"):
        SegmentSpec(
            name="expansion", base_revenue=0.0, base_margin=0.0,
            margin_target=0.30, sales_to_capital_early=1.0,
            sales_to_capital_late=1.5, revenue_target=50.0,
            ramp_start_year=7, initial_growth=0.10,
        )


def test_initial_growth_none_reproduces_the_existing_path_exactly():
    """Backward compatibility, gated. Every stored case and existing test keeps
    its behaviour. Asserted element-for-element against the decaying curve rather
    than against hardcoded numbers."""
    spec = _anchored(initial_growth=None)
    expected = []
    level = spec.base_revenue
    for rate in _decaying_growth_rates(
        _solve_first_year_growth(70.0 / 4.1, 10, 0.0456), 10, 0.0456
    ):
        level *= 1.0 + rate
        expected.append(level)
    assert revenue_path(spec, n=10, g_stable=0.0456) == pytest.approx(expected, abs=0.0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_segment_valuation.py -v`
Expected: FAIL — `SegmentSpec.__init__() got an unexpected keyword argument 'initial_growth'`

- [ ] **Step 3: Add the import and the curve functions**

At the top of `packages/core_finance/segment_valuation.py`, add `import math` below `from dataclasses import dataclass`.

Insert these four functions immediately **before** the existing `_ramp_revenues`:

```python
def _hump_shape(t: int, n: int) -> float:
    """Zero at both ends of the horizon, one at its midpoint.

    This is what pins both endpoints: because it vanishes at t=1 and t=n, the
    solved amplitude cannot move either of them.
    """
    return math.sin(math.pi * (t - 1) / (n - 1))


def _anchored_growth_rates(
    g_init: float, a: float, n: int, g_stable: float
) -> list[float]:
    """Growth from a stated year-1 rate to `g_stable`, humped by amplitude `a`.

    A linear ramp between two pinned endpoints plus a hump:

        g_t = g_init + (g_stable - g_init)(t-1)/(n-1) + a * sin(pi (t-1)/(n-1))

    Unlike `_decaying_growth_rates`, year 1 is NOT forced to be the fastest year --
    which is the point. A source that records near-term growth being *slowed*
    cannot be represented by a curve whose first year is always its maximum.
    """
    if n < 2:
        return [g_stable]
    return [
        g_init + (g_stable - g_init) * (t - 1) / (n - 1) + a * _hump_shape(t, n)
        for t in range(1, n + 1)
    ]


def _compound_anchored(g_init: float, a: float, n: int, g_stable: float) -> float:
    product = 1.0
    for rate in _anchored_growth_rates(g_init, a, n, g_stable):
        product *= 1.0 + rate
    return product


def _hump_amplitude_lower_bound(g_init: float, g_stable: float) -> float:
    """Lowest amplitude that keeps every growth factor positive.

    The solver below is monotone in `a` only while every (1 + g_t) > 0. The
    linear term never drops below min(g_init, g_stable) and sin <= 1, so for
    a < 0 the trough sits at min(g_init, g_stable) + a. This bound pins that
    trough at exactly -0.99 for any input.

    Computed, never hardcoded. With a hardcoded -0.99 and a segment declining at
    50% a year, four growth factors go negative -- and because an even count of
    negatives multiplies to a positive product, the bracket check still passes
    and bisection proceeds on a violated precondition without complaint.
    """
    return _G1_LOW - min(g_init, g_stable)


def _solve_hump_amplitude(
    ratio: float, g_init: float, n: int, g_stable: float
) -> float:
    """Find the hump amplitude whose schedule compounds to `ratio`.

    Monotone in `a` -- d/da of the product is a sum of non-negative sine weights
    times positive partial products -- so bisection converges, the same technique
    and step count as `_solve_first_year_growth`.

    That monotonicity holds ONLY while every (1 + g_t) stays positive, so the
    lower bracket is computed rather than hardcoded. The linear term never drops
    below min(g_init, g_stable) and sin <= 1, so for a < 0 the trough sits at
    min(g_init, g_stable) + a; the bound below pins it at exactly -0.99 for any
    input. A hardcoded -0.99 would put the trough at -1.99 for a segment
    declining at 50% a year, producing a negative growth factor and a solver
    whose precondition no longer holds -- silently, since it still returns.
    """
    low = _G1_LOW - min(g_init, g_stable)
    high = _G1_HIGH
    if not _compound_anchored(g_init, low, n, g_stable) <= ratio <= _compound_anchored(
        g_init, high, n, g_stable
    ):
        raise ValueError(
            f"target revenue ratio {ratio:.6g} is unreachable from a year-1 growth "
            f"of {g_init:.4%} over {n} years ending at {g_stable:.4%}"
        )
    for _ in range(_BISECTION_STEPS):
        mid = (low + high) / 2
        if _compound_anchored(g_init, mid, n, g_stable) < ratio:
            low = mid
        else:
            high = mid
    return (low + high) / 2
```

- [ ] **Step 4: Add the field and its validation**

In `SegmentSpec`, add after `ramp_start_year: int = 1`:

```python
    initial_growth: float | None = None     # observed year-1 growth; None = decaying curve
```

Append to `SegmentSpec.__post_init__`, after the `sales_to_capital_late` check:

```python
        if self.initial_growth is not None:
            if self.initial_growth <= -1:
                raise ValueError(
                    f"{self.name}: initial_growth must exceed -100%, got "
                    f"{self.initial_growth}"
                )
            if self.base_revenue == 0 or self.ramp_start_year > 1:
                raise ValueError(
                    f"{self.name}: initial_growth={self.initial_growth} is "
                    f"incoherent with a ramped segment (base_revenue="
                    f"{self.base_revenue}, ramp_start_year={self.ramp_start_year}); "
                    f"a segment with no revenue today has no year-1 growth to pin"
                )
```

Extend the class docstring with a sentence: `initial_growth` pins year-1 growth to an observed rate; when `None` the growth path decays from a solved year-1 rate instead, making year 1 the fastest year.

- [ ] **Step 5: Branch in `revenue_path`**

Replace the final three statements of `revenue_path` — from `g_first = _solve_first_year_growth(...)` to `return revenues` — with:

```python
    if spec.initial_growth is None:
        rates = _decaying_growth_rates(
            _solve_first_year_growth(target / spec.base_revenue, n, g_stable),
            n,
            g_stable,
        )
    else:
        rates = _anchored_growth_rates(
            spec.initial_growth,
            _solve_hump_amplitude(
                target / spec.base_revenue, spec.initial_growth, n, g_stable
            ),
            n,
            g_stable,
        )

    revenues: list[float] = []
    level = spec.base_revenue
    for rate in rates:
        level *= 1.0 + rate
        revenues.append(level)
    return revenues
```

Update `revenue_path`'s docstring: there are now **three** shapes — a decaying curve from a solved year-1 rate (the default), an anchored curve pinning year-1 growth to `initial_growth` and year-n growth to `g_stable`, and a linear ramp for a segment starting from zero.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/ -v`
Expected: PASS. `test_segment_valuation.py` gains 11 tests; the SpaceX file is unchanged at this point because no seeded segment sets `initial_growth` yet.

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest tests -q`
Expected: 641 passing (630 baseline plus 11). **No existing test may change behaviour** — `initial_growth` defaults to `None` everywhere, so every current path is the decaying one. If any pre-existing test fails, stop and report it rather than adjusting it.

- [ ] **Step 8: Commit**

```bash
git add packages/core_finance/segment_valuation.py tests/core_finance/test_segment_valuation.py
git commit -m "feat: growth curve that can start at an observed rate instead of peaking in year 1"
```

---

## Task 2: Persist and expose the input

**Files:**
- Modify: `apps/api/services/db.py`
- Modify: `apps/api/models/schema_parts/valuation.py`
- Modify: `apps/api/services/valuation_case.py`
- Test: `tests/api/test_valuation_schema.py`
- Test: `tests/api/test_valuation_case_service.py`

**Interfaces:**
- Consumes: `SegmentSpec.initial_growth: float | None` from Task 1.
- Produces: `segment.initial_growth` column; `SegmentInput.initial_growth`; `initial_growth` in `NARRATED_FIELDS` and `_SEGMENT_COLUMNS`.

**Background.** `initial_growth` is a value-bearing numeric input, so the narrative rule must cover it — a case that states a growth rate without saying where it came from is exactly what that rule exists to prevent. Adding it to `NARRATED_FIELDS` is what makes the seed's confirmed actuals carry their source.

There is no migration framework here. `init_db()` executes one `_CREATE_SCHEMA_SQL` script of `CREATE TABLE IF NOT EXISTS` statements, then `_ensure_schema_compatibility(conn)` retrofits columns onto **pre-existing** local database files. A new nullable column on an existing table needs **both**: the `CREATE TABLE` text for fresh databases, and an `ALTER TABLE` retrofit for developer machines whose `segment` table already exists. Adding it only to the `CREATE TABLE` would leave existing local databases broken, because `CREATE TABLE IF NOT EXISTS` silently does nothing when the table is already there.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_valuation_schema.py`:

```python
def test_segment_table_carries_initial_growth():
    with get_db() as conn:
        assert "initial_growth" in _columns(conn, "segment")


def test_initial_growth_retrofits_onto_a_pre_existing_segment_table():
    """New nullable columns need the ALTER path too: CREATE TABLE IF NOT EXISTS
    silently does nothing when the table already exists, so a developer database
    created before this change would otherwise never gain the column."""
    from apps.api.services import db as db_service

    with get_db() as conn:
        conn.execute("DROP TABLE IF EXISTS segment")
        conn.execute(
            "CREATE TABLE segment ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " case_id INTEGER NOT NULL REFERENCES valuation_case(id) ON DELETE CASCADE,"
            " name TEXT NOT NULL, base_revenue REAL NOT NULL, base_margin REAL NOT NULL,"
            " tam_target REAL, market_share_target REAL, revenue_target REAL,"
            " margin_target REAL NOT NULL, sales_to_capital_early REAL NOT NULL,"
            " sales_to_capital_late REAL NOT NULL,"
            " ramp_start_year INTEGER NOT NULL DEFAULT 1, UNIQUE(case_id, name))"
        )
        assert "initial_growth" not in _columns(conn, "segment")

    db_service.init_db()

    with get_db() as conn:
        assert "initial_growth" in _columns(conn, "segment")
```

Append to `tests/api/test_valuation_case_service.py`:

```python
def test_initial_growth_requires_a_narrative():
    """It is a stated numeric input, so the narrative rule covers it."""
    payload = _case_payload(case_name="growth_unnarrated")
    payload["segments"][0]["initial_growth"] = 0.0764
    with pytest.raises(ValueError, match="initial_growth"):
        create_case(payload)


def test_initial_growth_round_trips_and_reaches_the_engine():
    payload = _case_payload(case_name="growth_narrated")
    payload["segments"][0]["initial_growth"] = 0.0764
    payload["segments"][0]["narratives"].append(_narrative("initial_growth"))
    case_id = create_case(payload)

    loaded = load_case(case_id)
    assert loaded["segments"][0]["initial_growth"] == pytest.approx(0.0764)

    result = run_stored_case(case_id)
    launch = result["segments"][0]
    assert launch["revenue"][0] / 4.1 - 1 == pytest.approx(0.0764, abs=1e-12)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_valuation_schema.py tests/api/test_valuation_case_service.py -v`
Expected: FAIL — no `initial_growth` column, and `create_case` accepts the field without demanding a narrative.

- [ ] **Step 3: Add the column, both paths**

In `apps/api/services/db.py`, in `_CREATE_SCHEMA_SQL`'s `segment` table, add after `ramp_start_year INTEGER NOT NULL DEFAULT 1,`:

```sql
    initial_growth         REAL,
```

Then add to `_ensure_schema_compatibility(conn)`, following the pattern the other retrofits in that function already use:

```python
    segment_columns = {row["name"] for row in conn.execute("PRAGMA table_info(segment)")}
    if segment_columns and "initial_growth" not in segment_columns:
        # Nullable, so no default is needed and existing rows keep the decaying
        # curve. CREATE TABLE IF NOT EXISTS cannot add a column to a table that
        # already exists, which is every developer database created before this.
        conn.execute("ALTER TABLE segment ADD COLUMN initial_growth REAL")
```

The `segment_columns and` guard matters: `PRAGMA table_info` on a table that does not exist returns an empty set, and this function runs before the schema script on some paths.

- [ ] **Step 4: Add it to the request model**

In `apps/api/models/schema_parts/valuation.py`, add to `SegmentInput` after `ramp_start_year`:

```python
    initial_growth: float | None = Field(default=None, gt=-1)
```

- [ ] **Step 5: Wire it through the service**

In `apps/api/services/valuation_case.py`:

- Add `"initial_growth",` to the end of `NARRATED_FIELDS`.
- Add `"initial_growth",` to the end of `_SEGMENT_COLUMNS`.
- In `_to_specs`, add `initial_growth=segment["initial_growth"],` to the `SegmentSpec(...)` construction.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/api/ -v`
Expected: PASS. Watch for fallout in the seed tests — no seeded segment sets `initial_growth` yet, so the narrative rule has nothing new to demand and they should be unaffected.

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest tests -q`
Expected: 645 passing (641 from Task 1 plus 4).

- [ ] **Step 8: Commit**

```bash
git add apps/api/services/db.py apps/api/models/schema_parts/valuation.py apps/api/services/valuation_case.py tests/api/test_valuation_schema.py tests/api/test_valuation_case_service.py
git commit -m "feat: persist and narrate a segment's observed year-1 growth"
```

---

## Task 3: Seed the confirmed actuals and update every stale figure

**Files:**
- Modify: `apps/api/services/valuation_seed.py`
- Test: `tests/api/test_valuation_seed.py`
- Test: `tests/core_finance/test_segment_valuation_spacex.py`
- Modify: `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md`
- Modify: `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md`
- Modify: `guideline/sop/todo.md`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: no new names.

**Background.** `guideline/sop/todo3.md` §4 supplies **confirmed** 2025 segment growth actuals that the engine has been discarding: launch **+7.64%**, connectivity **~+50%**, ai **~+22%**, total **+33%**. These become the first confirmed segment-level inputs in the seed besides TAM and market share, so they seed `confidence="confirmed"`, `three_p="probable"` — unlike almost everything else in that file.

`expansion` is a ramped segment with no revenue today, so it takes no `initial_growth`.

Both cases take the same three values: these are FY2025 actuals and do not differ between the April and June valuations.

**Every seeded valuation figure moves — this is the fourth revision of those numbers.** Measure them; do not predict them. The confirmed-input gates (400.0/158.5 post, 320.0/151.0 pre) do **not** move, because both curve shapes hit the endpoint by construction.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_valuation_seed.py`:

```python
def test_seeded_initial_growth_matches_the_confirmed_actuals():
    """todo3 section 4's confirmed 2025 segment growth. Expectations are literal,
    not read back from the seed module."""
    ensure_valuation_cases_seeded()
    expected = {"launch": 0.0764, "connectivity": 0.50, "ai": 0.22, "expansion": None}
    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        actual = {
            s["name"]: s["initial_growth"] for s in load_case(_case_id(name))["segments"]
        }
        assert actual == pytest.approx(expected)


def test_seeded_initial_growth_is_tagged_confirmed():
    """These are among the few genuinely confirmed segment inputs in the seed --
    unlike the base-revenue split, which is an assumption."""
    ensure_valuation_cases_seeded()
    for name in (PRE_CASE_NAME, POST_CASE_NAME):
        for segment in load_case(_case_id(name))["segments"]:
            claims = {n["input_field"]: n for n in segment["narratives"]}
            if segment["initial_growth"] is None:
                assert "initial_growth" not in claims
                continue
            assert claims["initial_growth"]["confidence"] == "confirmed"
            assert claims["initial_growth"]["three_p"] == "probable"


def test_seeded_year_one_growth_no_longer_contradicts_the_source():
    """Was +55% against a confirmed +33% total. Now +38.7%: closer, and the
    residual traces to the base-revenue split, which the seed's own narratives
    record as an assumption rather than a derivation."""
    ensure_valuation_cases_seeded()
    data = _run(POST_CASE_NAME)
    base_total = data["base_revenue_total"]
    assert data["revenue"][0] / base_total - 1 == pytest.approx(0.387, abs=0.001)


def test_seeded_launch_starts_at_its_observed_rate():
    ensure_valuation_cases_seeded()
    launch = next(s for s in _run(POST_CASE_NAME)["segments"] if s["name"] == "launch")
    assert launch["revenue"][0] / 4.1 - 1 == pytest.approx(0.0764, abs=1e-12)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_valuation_seed.py -v`
Expected: FAIL — seeded `initial_growth` is `None` everywhere.

- [ ] **Step 3: Seed the values**

In `apps/api/services/valuation_seed.py`, add a module-level claim constant beside the existing ones:

```python
_CONFIRMED_INITIAL_GROWTH = {
    "launch": (
        0.0764,
        "2025 launch revenue grew 7.64% (todo3 section 4). todo3 R3 records as "
        "[C] that Damodaran SLOWED near-term launch growth in the June revision; "
        "pinning year 1 to the observed rate is how that enters the model.",
    ),
    "connectivity": (
        0.50,
        "2025 Starlink revenue grew about 50% (todo3 section 4) -- the near-term "
        "engine, on subscribers doubling from 5.0m to 10.3m.",
    ),
    "ai": (
        0.22,
        "2025 xAI revenue grew about 22% (todo3 section 4), which todo3 notes is "
        "below the growth its own target-year revenue implies.",
    ),
}
```

Give `_segment` a way to attach it. Inside `_segment`, after the existing narrative list is built, add:

```python
    initial_growth = None
    if name in _CONFIRMED_INITIAL_GROWTH and base_revenue > 0:
        initial_growth, growth_claim = _CONFIRMED_INITIAL_GROWTH[name]
        narratives.append(
            _narrative(
                "initial_growth", growth_claim, "confirmed",
                three_p="probable", source="todo3 section 4",
            )
        )
```

and add `"initial_growth": initial_growth,` to the returned segment dict.

Add to the module docstring, beside the existing notes, a paragraph recording that `initial_growth` carries todo3 §4's confirmed 2025 actuals; that before this the engine's consolidated year-1 growth was +55% against a confirmed +33%, contradicting a `[C]`-tagged behaviour; and that `expansion` takes none because a ramped segment has no revenue today.

- [ ] **Step 4: Run and measure**

Run: `python -m pytest tests/api/test_valuation_seed.py -v`

Then capture the new figures — this is read-only and touches no database:

```bash
python -c "
from tests.core_finance.test_segment_valuation_spacex import pre_prospectus, post_prospectus
from packages.core_finance.segment_valuation import run_case
for nm, build, pub in (('pre',pre_prospectus,1210),('post',post_prospectus,1220)):
    c, s = build(); r = run_case(c, s)
    g1 = r.revenue[0] / r.base_revenue_total - 1
    print(f'{nm}: EV={r.enterprise_value:8.2f} (published {pub})  pv_explicit={r.pv_explicit:+8.2f}  TVshare={r.terminal_value_share_pct:6.2f}%  basic={r.value_per_share_basic:7.2f} diluted={r.value_per_share_diluted:7.2f}  yr1growth={g1:6.2%}  rev10={r.revenue[-1]:.1f} ebit10={r.ebit[-1]:.1f}')
"
```

**`rev10` must read 400.0 / 320.0 and `ebit10` 158.5 / 151.0.** If either moved, stop and report — it would mean the curve does not hit its endpoint.

Note the SpaceX builders in `tests/core_finance/test_segment_valuation_spacex.py` construct segments directly and must be given the same `initial_growth` values as the seed, or the two will disagree again. Add `initial_growth=` to the `_segment` helper in that file for launch, connectivity and ai.

- [ ] **Step 5: Update the pinned enterprise values**

In `tests/core_finance/test_segment_valuation_spacex.py`, update `test_seeded_pair_enterprise_values` to the measured figures, keeping `abs=0.5`. Update its docstring: keep the statement that these are the model's own output rather than a target, keep the published references as **pre 1210, post 1220**, and keep whatever the measured direction is stated honestly — if the model still produces the pre/post direction opposite to the source, say so; if this change flipped it, say that instead. Do not assert agreement either way.

- [ ] **Step 6: Update every stale figure elsewhere**

Three documents carry valuation figures that this change invalidates. Replace the numbers with the measured ones and date the change:

- `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md` §2.5's table and §3's "Recorded, not gated" paragraph.
- `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md` §6's recorded diagnostic figures.
- `guideline/sop/todo.md` — the Segment Build-Up Valuation track.

In `guideline/sop/todo.md`, **close the divergence entry**: the "near-term growth runs the wrong way" item is now fixed. Replace it with a record of what changed — consolidated year-1 growth from +55% to +38.7% against a confirmed +33%, the residual traced to the base-revenue split — and note that the consolidated path's non-monotonicity at the expansion ramp is unchanged. Leave the other divergences (the `base_margin` R&D basis, case-level narratives, the pre/post EV direction, API lifecycle) exactly as they are.

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest tests -q`
Expected: 649 passing (645 from Task 2 plus 4). No failures.

- [ ] **Step 8: Commit**

```bash
git add apps/api/services/valuation_seed.py tests/api/test_valuation_seed.py tests/core_finance/test_segment_valuation_spacex.py docs/superpowers/specs/ guideline/sop/todo.md
git commit -m "feat: seed the confirmed 2025 growth actuals as year-1 anchors"
```

---

## Self-Review Notes

**Spec coverage.** §2.1 (why not a logistic) → Task 1 Background, carried into the `_anchored_growth_rates` docstring. §2.2 (the curve, the monotonicity argument, the computed bracket) → Task 1 Steps 3 and 5, gated by `test_a_declining_segment_keeps_every_growth_factor_positive`. §2.3 (behaviour on seeded data) → Task 1's hump and dip tests, plus Task 3 Step 4's measurement. §2.4 (inputs, the `None` default, the ramp exclusion, narration) → Tasks 1 and 2. §2.5 (seeded values, +38.7%) → Task 3. §3 gates 1–8 map to: 1 → `starts_at`/`ends_at`; 2 → `lands_exactly_on_target`; 3 → `initial_growth_none_reproduces`; 4 → `on_a_ramped_segment_raises`; 5 → `negative_hump_amplitude`; 6 → Task 3 Step 4's explicit check; 7 → `initial_growth_requires_a_narrative`; 8 → `year_one_growth_no_longer_contradicts_the_source`.

**One thing the spec did not call out and this plan adds:** the `_ensure_schema_compatibility` retrofit in Task 2 Step 3. A new nullable column needs both the `CREATE TABLE` text and an `ALTER TABLE` path, because `CREATE TABLE IF NOT EXISTS` does nothing on a database whose `segment` table already exists — which is every developer machine that has run this branch. Without it the column would appear only on fresh databases. Gated by `test_initial_growth_retrofits_onto_a_pre_existing_segment_table`.

**Type consistency.** `initial_growth: float | None` is the same name and type in `SegmentSpec`, the SQL column, `SegmentInput`, `_SEGMENT_COLUMNS`, `NARRATED_FIELDS` and the seed dict. `_solve_hump_amplitude(ratio, g_init, n, g_stable)` and `_anchored_growth_rates(g_init, a, n, g_stable)` keep their argument order between Steps 3 and 5.

**Two things a reviewer should NOT flag.** AI's hump peaking above 200% is the arithmetic of a base of 0.1 growing to 160, deliberately reported rather than guarded — an arbitrary plausibility ceiling would suppress the signal that the 0.1 base is the seed's weakest input. And the enterprise values moving again is expected: the confirmed-input gates are what must hold, and they do.
