# Write-Time Runnability Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `create_case` must refuse to store a valuation case that the engine cannot value, instead of storing it and reporting success.

**Architecture:** A new `_validate_by_engine(payload)` runs the real `run_case` against specs built from the create payload, before the transaction opens. Any `ValueError` the engine raises becomes a creation-time `ValueError` prefixed `case is not valuable: `. No finance logic is copied into the service layer, and no caller changes.

**Tech Stack:** Python 3.11, pytest, SQLite via `apps/api/services/db.py`, the segment build-up engine in `packages/core_finance/segment_valuation.py`.

**Spec:** `docs/superpowers/specs/2026-08-15-write-time-runnability-gate-design.md`

## Global Constraints

- Do NOT modify `packages/core_finance/segment_valuation.py`. The engine's guards are correct; only the moment they fire changes.
- Do NOT modify `apps/api/services/company_baseline.py` or `apps/api/routes/valuation.py`. Both already handle `ValueError` correctly; this was verified by reading them.
- Do NOT modify `packages/core_finance/dcf.py`, `apps/api/services/corporate_dcf.py`, or `apps/api/services/corporate_metrics_service.py`.
- `packages/core_finance` must never import from `apps/api`.
- Tests must make no network calls and must not open `data/processed/moneyview.db`. The autouse `_isolated_db` fixture in `tests/conftest.py` redirects `get_db()` to a tmp file; rely on it rather than adding new isolation.
- Only `ValueError` is translated by the new gate. Never widen to `except Exception`: that would relabel programming and infrastructure faults as economic refusals.
- Success criterion for the whole plan: the full suite passes with **no test skipped, xfailed, or weakened** to accommodate the gate.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/api/services/valuation_case.py` | Modify | Add `_specs_from_payload` and `_validate_by_engine`; call the latter from `create_case`. |
| `tests/api/test_valuation_case_service.py` | Modify | Tests 1-6: both guards, non-persistence, the valid case, the declining case, spec equivalence. |
| `tests/api/test_company_baseline.py` | Modify | Test 7: the generator reports the refusal end to end. |
| `tests/api/test_zz_probe2.py` | Delete | Assertion-free scratch probe; its scenario survives as tests 1 and 7. |
| `ERROR-LOG.md` | Modify | Confirmed-defect record (CLAUDE.md §7). |
| `guideline/sop/todo.md` | Modify | Log the fix and the deferred guard-extraction refactor (CLAUDE.md §6). |

`run_case`, `CaseSpec` and `SegmentSpec` are **already imported** in `valuation_case.py` (lines 16-20). No import changes are needed anywhere.

---

### Task 1: The engine gate

**Files:**
- Modify: `apps/api/services/valuation_case.py` (add two functions after `_validate_runnable`, which ends at line 131; add one call inside `create_case`)
- Test: `tests/api/test_valuation_case_service.py`

**Interfaces:**
- Consumes: `_CASE_COLUMNS`, `_SEGMENT_COLUMNS`, `_to_specs`, `run_case` — all already present in the module.
- Produces:
  - `_specs_from_payload(payload: dict) -> tuple[CaseSpec, list[SegmentSpec]]`
  - `_validate_by_engine(payload: dict) -> None` — raises `ValueError` prefixed `case is not valuable: `

**Background the implementer needs:**

The engine raises four guards from `terminal_value` (`segment_valuation.py:796-826`), in this order:

1. `wacc_stable - g_stable <= 0` — terminal spread not positive
2. `roic_stable <= 0`
3. `roic_stable <= abs(g_stable)` — "must exceed the magnitude of terminal growth"
4. `g_stable > 0 and roic_stable <= wacc_stable` — "must exceed wacc_stable"

Order matters: guard 3 fires before guard 4, so a test targeting guard 4 must pick a `roic_stable` that clears `abs(g_stable)` first.

The shared fixture `_case_payload()` in `tests/api/valuation_fixtures.py` has `riskfree_rate=0.0456`, `wacc_stable=0.0825`, `terminal_growth=None` (which makes effective terminal growth default to the riskfree rate, 0.0456) and `roic_stable=0.35`. The values below were verified against the real engine on 2026-08-15.

Note that the target-year marginal-return consistency check is **reported, not enforced**, in the downward direction (see the comment at `segment_valuation.py:32-58`), so lowering `roic_stable` does not trip a separate guard.

- [ ] **Step 1: Write the two failing guard tests**

Add to the end of `tests/api/test_valuation_case_service.py`:

```python
def test_a_case_whose_roic_cannot_carry_its_terminal_growth_is_rejected():
    """The defect this gate exists for. roic_stable 3% under a 4.56% terminal
    growth stored cleanly and then failed on every single run, forever, while
    the caller was told the case was created."""
    payload = _case_payload(case_name="dead_on_arrival", roic_stable=0.03)
    with pytest.raises(ValueError) as excinfo:
        create_case(payload)
    assert "case is not valuable" in str(excinfo.value)
    assert "must exceed the magnitude of terminal growth" in str(excinfo.value)


def test_a_case_growing_while_destroying_value_is_rejected():
    """A SECOND, different engine guard: positive terminal growth with a
    terminal return below the cost of capital.

    This test is why the gate can claim to delegate. A single-guard test would
    still pass if the implementation had quietly copied that one check into
    this module; two different guards reached through one `run_case` call is
    the cheapest evidence that the engine itself does the rejecting.
    """
    payload = _case_payload(case_name="value_destroying", roic_stable=0.06)
    with pytest.raises(ValueError) as excinfo:
        create_case(payload)
    assert "case is not valuable" in str(excinfo.value)
    assert "must exceed wacc_stable" in str(excinfo.value)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python -m pytest tests/api/test_valuation_case_service.py -k "dead_on_arrival or growing_while_destroying or roic_cannot_carry or value_destroying" -v`

Expected: both FAIL with `DID NOT RAISE ValueError`. That failure mode is the point — it *is* the defect: `create_case` accepts both payloads today.

- [ ] **Step 3: Implement the gate**

In `apps/api/services/valuation_case.py`, insert both functions immediately after `_validate_runnable` (which ends at line 131) and before `def create_case`:

```python
def _specs_from_payload(payload: dict) -> tuple[CaseSpec, list[SegmentSpec]]:
    """Build engine specs from a create payload, as `load_case` would.

    Normalizing through the column lists reproduces exactly what a stored row
    yields on read -- `None` for anything unstated -- so the write-time trial
    and the later run cannot disagree about their inputs. `_to_specs` indexes
    with `case["key"]` and would raise `KeyError` on an omitted optional field,
    where `create_case` tolerates the omission via `.get()`.
    """
    normalized = {column: payload.get(column) for column in _CASE_COLUMNS}
    normalized["segments"] = [
        {column: segment.get(column) for column in _SEGMENT_COLUMNS}
        for segment in payload["segments"]
    ]
    return _to_specs(normalized)


def _validate_by_engine(payload: dict) -> None:
    """Reject at write time what `run_case` rejects at read time.

    Not a re-statement of the engine's guards -- the engine itself. Any
    `ValueError` guard reached by `run_case` through this execution path is
    enforced at creation time without duplicating the guard in this layer.

    Only `ValueError` is translated. A `KeyError`, `TypeError` or anything else
    is a defect in this module or the engine, not an economic refusal, and must
    keep its own type and traceback. Do NOT widen this to `except Exception`:
    that would relabel programming and infrastructure faults as ordinary
    validation failures and bury them behind a 422.

    The engine's result is discarded. This is a gate, not a computation.
    """
    try:
        run_case(*_specs_from_payload(payload))
    except ValueError as exc:
        raise ValueError(f"case is not valuable: {exc}") from exc
```

`_to_specs` is defined further down the module (line 235). That forward reference is fine — names resolve at call time, not definition time.

- [ ] **Step 4: Wire it into `create_case`**

In `create_case`, add one line after the per-segment loop and **before** `with get_db() as conn:`:

```python
    for segment in segments:
        _validate_narratives(segment)
        _validate_runnable(payload, segment)
    _validate_by_engine(payload)

    with get_db() as conn:
```

It must stay outside the transaction: nothing is then written and rolled back, and `case_name` uniqueness (raised by SQLite as `IntegrityError`) stays separately diagnosable from unvaluability (raised by the engine).

- [ ] **Step 5: Run the two tests to verify they pass**

Run: `python -m pytest tests/api/test_valuation_case_service.py -k "roic_cannot_carry or growing_while_destroying" -v`
Expected: 2 passed.

- [ ] **Step 6: Write the remaining four tests**

Append to `tests/api/test_valuation_case_service.py`:

```python
def test_an_unvaluable_case_leaves_nothing_behind():
    """The gate runs before the transaction opens, so a refusal writes no row.

    Without this the gate could reject correctly and still leave a half-written
    case behind, which is the failure mode `test_a_rejected_case_leaves_nothing_behind`
    guards for the narrative rule.
    """
    payload = _case_payload(case_name="doomed_by_engine", roic_stable=0.03)
    with pytest.raises(ValueError):
        create_case(payload)
    assert [c["case_name"] for c in list_cases()] == []


def test_a_valuable_case_still_stores_and_runs():
    """The gate must not reject good input."""
    case_id = create_case(_case_payload())
    assert run_stored_case(case_id)["enterprise_value"] > 0


def test_a_declining_case_is_not_judged_by_the_positive_growth_rule():
    """roic_stable 6% sits below wacc_stable 8.25%, which the engine rejects
    ONLY when terminal growth is positive. At -1% growth that rule does not
    apply, and the case must store.

    This is the counterpart to the value-destroying test: together they show the
    gate rejects where the engine rejects and *only* there, rather than imposing
    a broader rule of its own at the service layer.
    """
    case_id = create_case(_case_payload(
        case_name="declining", roic_stable=0.06, terminal_growth=-0.01,
    ))
    assert run_stored_case(case_id)["enterprise_value"] > 0


def test_write_time_specs_equal_read_time_specs():
    """The invariant the whole gate rests on: the trial validates the same
    representation the later run will see.

    It holds today by construction -- `create_case` inserts `payload.get(column)`
    with no defaults or coercion, and `load_case` returns `dict(row)`
    untransformed -- but that is an argument, not a proof. A future default, a
    generated column, a serialization step or a SQLite type-affinity change
    would break it silently, and the gate would start validating something the
    run path never sees. `CaseSpec` and `SegmentSpec` are both
    `@dataclass(frozen=True)`, so `==` compares field by field.
    """
    payload = _case_payload(case_name="equivalence")
    case_id = create_case(payload)
    assert _specs_from_payload(payload) == _to_specs(load_case(case_id))
```

Extend the existing import block at the top of the file to add the two private names:

```python
from apps.api.services.valuation_case import (
    CaseNotFound,
    _specs_from_payload,
    _to_specs,
    create_case,
    list_cases,
    load_case,
    run_stored_case,
)
```

- [ ] **Step 7: Run the whole file**

Run: `python -m pytest tests/api/test_valuation_case_service.py -v`
Expected: all pass, including the pre-existing tests.

- [ ] **Step 8: Run the full suite and triage every new failure**

Run: `python -m pytest -q`

`create_case` has 21 call sites across `test_valuation_case_service.py` (17), `test_company_baseline.py` (2) and `test_valuation_seed.py` (2), plus payloads posted by `tests/api/test_valuation_routes.py`. Some fixtures were written to exercise storage, not economics.

For each newly failing test, classify it as exactly one of:

- **a fixture that was never a valid case** — fix the fixture, and say in the commit message which values changed and why the old ones were unvaluable; or
- **a real defect the gate has just exposed** — stop and report it. Do not fix it inside this task.

Do NOT skip, xfail, or weaken any test to make the suite green. If a test cannot be classified as either of the two above, stop and report rather than guessing.

- [ ] **Step 9: Commit**

```bash
git add apps/api/services/valuation_case.py tests/api/test_valuation_case_service.py
git commit -m "fix: reject unvaluable cases at write time, not read time

create_case stored cases the engine cannot value: the row was written, the
caller got a success, and every later run failed identically forever.
_validate_runnable claimed to reject 'at write time what run_case would
reject at read time' but checked only two structural combinations.

_validate_by_engine runs the real engine against specs built from the
payload, before the transaction opens, and translates ValueError into a
creation-time refusal. No guard is copied into the service layer, so a guard
added to run_case is enforced here with no change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The generator reports the refusal, and the probe retires

**Files:**
- Test: `tests/api/test_company_baseline.py`
- Delete: `tests/api/test_zz_probe2.py`

**Interfaces:**
- Consumes: `_validate_by_engine` from Task 1, reached indirectly through `create_case`.
- Produces: nothing consumed by later tasks.

**Background:** `generate_conservative_case` already wraps `create_case` in `except ValueError` and converts it to `not_storable: {exc}` (`company_baseline.py:156-161`). No production code changes in this task — it proves the existing handler now carries the engine's message.

The helpers `_metrics`, `_baseline_source`, `_seed_quote_facts` and `_generate` already exist in the test file (lines 14, 20, 235, 247).

- [ ] **Step 1: Write the failing end-to-end test**

Append to `tests/api/test_company_baseline.py`:

```python
def test_generate_refuses_a_case_the_engine_cannot_value():
    """A thin-margin, capital-heavy company: 3% operating margin against a
    capital base 1.66x revenue.

    Before the write-time gate this returned `(case_id, None)` -- a success --
    for a case that raised on every run. The refusal must name both the layer
    (`not_storable`) and the engine's own guard, so a reader can tell it apart
    from a duplicate case name, which carries the same prefix.
    """
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts()

    case_id, reason = _generate(
        metrics=_metrics(growth=2.0, roic=4.0, wacc=9.0),
        statement_source=_baseline_source(
            revenue_by_year={2025: 100_000_000_000.0},
            operating_income_by_year={2025: 3_000_000_000.0},
            invested_capital_by_year={2025: 166_000_000_000.0},
        ),
    )
    assert case_id is None
    assert reason.startswith("not_storable: case is not valuable: ")
    assert "must exceed the magnitude of terminal growth" in reason
```

- [ ] **Step 2: Confirm it passes on Task 1's implementation**

Run: `python -m pytest tests/api/test_company_baseline.py::test_generate_refuses_a_case_the_engine_cannot_value -v`
Expected: PASS.

This test is written after the fix rather than before it, because the behaviour it asserts is produced entirely by Task 1. To see it fail first, stash Task 1's one-line call in `create_case` and re-run: it then fails with `assert None is None` on a real `case_id`. Do that check, then restore the line.

- [ ] **Step 3: Delete the probe**

```bash
git rm tests/api/test_zz_probe2.py
```

It has no assertions and can never fail, so it has no value as a test. Its question is answered and its scenario now lives in `test_generate_refuses_a_case_the_engine_cannot_value` and `test_a_case_whose_roic_cannot_carry_its_terminal_growth_is_rejected`.

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest -q`
Expected: green, with one fewer collected test than after Task 1 (the probe is gone) and one more real test.

- [ ] **Step 5: Commit**

```bash
git add tests/api/test_company_baseline.py
git commit -m "test: prove the generator surfaces the engine's refusal

The thin-margin scratch probe's question, as an assertion: a case the engine
cannot value now returns (None, reason) instead of (case_id, None), and the
reason names both the layer and the guard. Retires the probe, which had no
assertions and could never fail.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The records

**Files:**
- Modify: `ERROR-LOG.md`
- Modify: `guideline/sop/todo.md`
- Commit: the pending `CLAUDE.md` deletion

**Interfaces:**
- Consumes: the outcome of Tasks 1 and 2, including the fixture triage from Task 1 Step 8.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the ERROR-LOG.md entry**

Follow the template at the top of `ERROR-LOG.md` — read it first and match the existing entries' field order and heading style exactly rather than copying the sketch below verbatim. The entry must cover:

- **Date:** 2026-08-15
- **Command:** `generate_conservative_case("TEST", ...)` on a thin-margin, capital-heavy company
- **Failure:** the call returned `(case_id, None)` — a success — and `run_stored_case(case_id)` then raised `ValueError: roic_stable 1.3554% must exceed the magnitude of terminal growth 4.5600%`. The case was stored and permanently unrunnable. `POST /valuation/cases` had the same defect, returning 201 followed by a permanent 422.
- **Root cause:** `_validate_runnable` documented itself as rejecting "at write time what `run_case` would reject at read time" but only checked two structural combinations (`waypoint_gap_fraction` vs `initial_growth`, and the 10-year horizon). The economic guards live in `terminal_value` and fire only when the case is run. **State explicitly that the docstring claimed coverage the function did not have** — that overclaim is why the gap survived review.
- **Fix:** `_validate_by_engine` runs the real engine before the transaction opens and translates `ValueError` into `case is not valuable: ...`.
- **Files changed:** `apps/api/services/valuation_case.py`, `tests/api/test_valuation_case_service.py`, `tests/api/test_company_baseline.py`, `tests/api/test_zz_probe2.py` (deleted).
- **Prevention:** a validator that claims to mirror another layer must execute that layer, not restate it. Where restating is unavoidable, the claim in the docstring must be narrowed to what is actually checked.

- [ ] **Step 2: Update `guideline/sop/todo.md`**

Add to the **Active Track - Industry-Relative Conservative Valuation** section, after the Task 9 entry (the file's last entry before `## Archived Track`), a `- [x]` entry dated 2026-08-15 recording:

- the stored-but-unrunnable defect and that it affected both `create_case` callers;
- that this section previously described such cases as refusals, which was true only at run time;
- the fixture triage result from Task 1 Step 8: which fixtures were changed, and why each was never a valid case;
- the deferred refactor, in these terms: *extracting the engine's input guards into a `_validate_valuation_inputs(spec, segments)` called by both `create_case` and `run_case` would remove the duplicated DCF computation, but requires the guards to be separable from the computation and would mean modifying `packages/core_finance/segment_valuation.py`. Deferred until a second need for validation-without-computation appears.*

- [ ] **Step 3: Commit the records**

```bash
git add ERROR-LOG.md guideline/sop/todo.md
git commit -m "docs: record the stored-but-unrunnable case defect

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Commit the unrelated CLAUDE.md deletion separately**

An empty 0-byte `CLAUDE.md` at the repo root was deleted during an earlier `/doctor` run and has been sitting uncommitted since. It is unrelated to this defect, which is why it gets its own commit rather than riding along with one above.

Verify it is empty and was already deleted before committing:

```bash
git show HEAD:CLAUDE.md | wc -c   # expect 0
git status --short CLAUDE.md      # expect " D CLAUDE.md"
git add CLAUDE.md
git commit -m "chore: drop the empty root CLAUDE.md

A 0-byte stub shadowing nothing. The real project instructions live in
.claude/CLAUDE.md.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final verification**

Run: `python -m pytest -q`
Expected: green, no skips, no xfails.

Run: `git status --short`
Expected: clean, except the untracked `__pycache__` entries for two already-deleted scratch test files (`test_zzprobe_broken_metrics_wiring`, `test_zz_scratch_atomicity`). Those are pre-existing and out of scope — leave them.
