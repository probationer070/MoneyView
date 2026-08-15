# Write-Time Runnability Gate

Date: 2026-08-15
Status: approved, ready for planning

## The defect

`create_case` stores valuation cases that can never be valued. The case is
written, the caller is told it succeeded, and every subsequent run fails with
the same error forever.

Reproduced against the real code on 2026-08-15 with a thin-margin,
capital-heavy company (3% operating margin, sales-to-capital 0.6,
`CorporateMetrics(growth=2.0, roic=4.0, wacc=9.0)`):

```
case_id 1  reason None
STORED BUT UNRUNNABLE: ValueError roic_stable 1.3554% must exceed the
magnitude of terminal growth 4.5600%: otherwise the terminal reinvestment
rate g / roic_stable leaves (-1, 1) and the perpetuity reinvests, or
releases, more capital than it earns every year forever.
```

`reason is None` and a real `case_id` together mean success. The case is
stored and permanently unrunnable.

### Why the existing guard misses it

`_validate_runnable` (`apps/api/services/valuation_case.py:105`) documents
itself as rejecting "at write time what `run_case` would reject at read
time". It checks two structural combinations only:

1. `waypoint_gap_fraction` and `initial_growth` both stated;
2. `waypoint_gap_fraction` on a horizon other than 10 years.

It never evaluates the economic guards -- `roic_stable` against the magnitude
of terminal growth, and `roic_stable` against `wacc_stable` for a positive
growth perpetuity. Those live in the engine and fire only when the case is
run. The docstring's promise is wider than its behaviour, which is why the
gap went unnoticed.

### Who is affected

Both callers of `create_case`:

- `generate_conservative_case` (`apps/api/services/company_baseline.py:156`)
  returns `(case_id, None)` -- a success -- for a case that cannot be valued.
- `POST /valuation/cases` (`apps/api/routes/valuation.py:33`) returns
  **201 Created**, and every later `POST /cases/{id}/run` returns 422. This is
  the exact scenario `_validate_runnable`'s own docstring describes.

## Design

### Where the check lives

In `create_case`, running the real engine.

Three sites were considered:

| Site | Fixes generator | Fixes HTTP POST | Duplicates finance logic |
|---|---|---|---|
| **`create_case`, trial-run the engine** | yes | yes | no |
| `generate_conservative_case` only | yes | no | no |
| `_validate_runnable`, explicit checks | yes | yes | yes |

The third was rejected: re-stating the engine's guards creates two sources of
truth for finance logic and drifts the moment `run_case` gains a guard, which
`guideline/sop/finance-logic.md` forbids. The second was rejected because it
leaves the HTTP endpoint broken and any future caller reintroduces the defect.

### The change

One new private function in `apps/api/services/valuation_case.py`:

```python
def _reject_if_unvaluable(payload: dict) -> None:
    """Reject at write time exactly what `run_case` rejects at read time.

    Not a re-statement of the engine's guards -- the engine itself. A guard
    added to run_case later is enforced here with no change, which a
    hand-copied list of checks could not promise.
    """
    normalized = {column: payload.get(column) for column in _CASE_COLUMNS}
    normalized["segments"] = [
        {column: segment.get(column) for column in _SEGMENT_COLUMNS}
        for segment in payload["segments"]
    ]
    try:
        run_case(*_to_specs(normalized))
    except ValueError as exc:
        raise ValueError(f"case is not valuable: {exc}") from exc
```

Called from `create_case` after the existing per-segment validation and
before the transaction opens:

```python
for segment in segments:
    _validate_narratives(segment)
    _validate_runnable(payload, segment)
_reject_if_unvaluable(payload)
with get_db() as conn:
    ...
```

### Two decisions inside it

**Normalize rather than pass the payload through.** `_to_specs` indexes with
`case["key"]` and raises `KeyError` on an omitted optional field, while
`create_case` tolerates omissions via `.get()`. Normalizing to the column
lists reproduces what `load_case` returns -- `None` for anything unstated --
so the gate sees exactly what the run path sees. Without this a payload
omitting an optional field would fail with `KeyError` instead of a clean
`ValueError`, and the gate could disagree with the thing it gates.

**Run before the transaction, not inside it.** Nothing is written and rolled
back. It also keeps `case_name` uniqueness (a storage concern, raised by
SQLite as `IntegrityError`) separate from unvaluability (an economics
concern, raised by the engine), so the two failures stay separately
diagnosable.

### The result is discarded

`run_case`'s return value is not used and not stored. This is a gate, not a
computation. The cost is one extra 10-year DCF per case creation, which is
arithmetic over ten years and a handful of segments -- immaterial next to the
SQLite write it precedes.

### What callers must change

Nothing.

- `generate_conservative_case` already wraps `create_case` in
  `except ValueError` and converts it to a `not_storable` reason. The false
  success becomes
  `not_storable: case is not valuable: roic_stable 1.3554% must exceed ...`.
- `apps/api/routes/valuation.py:34` already maps `ValueError` to HTTP 422
  with the message as `detail`. The false 201 becomes an immediate 422
  carrying the engine's own explanation.

Both were verified by reading the code, not assumed.

## Error handling

Every failure of this gate is a `ValueError` whose message is the engine's
own, prefixed with `case is not valuable: `. The prefix names the category;
the engine's text names the specific guard and the offending numbers.

The prefix matters at the generator boundary: `generate_conservative_case`
already produces `not_storable:` for a duplicate `case_name`, and a reader
of that reason must be able to tell "this name is taken" from "these
economics do not support a valuation". They call for different responses.

Refusal here is a legitimate outcome, not a fault. A company whose implied
return on new capital sits below its cost of capital genuinely has no
positive-growth perpetuity, exactly as recorded for Real Estate and Utilities
in `guideline/sop/todo.md`. The gate moves that refusal from read time to
write time; it does not change which cases are valuable.

## Testing

New tests in `tests/api/test_valuation_case_service.py`:

1. **The defect, as an assertion.** The probe's scenario -- a thin-margin,
   capital-heavy case -- is refused by `create_case` with a `ValueError`
   naming the terminal-growth guard.
2. **Nothing is persisted when the gate fires.** `list_cases()` is unchanged
   across the rejected call. This is what proves the pre-transaction
   ordering; without it the gate could be correct and still leave rows behind.
3. **A valid case is unaffected.** It stores and runs, proving the gate does
   not reject good input.

And in `tests/api/test_conservative_case.py`:

4. **The generator reports the refusal.** The same scenario through
   `generate_conservative_case` returns `(None, reason)` where the reason
   carries both the `not_storable` prefix and the engine's guard message --
   the end-to-end proof that the false success is gone.

`tests/api/test_zz_probe2.py` is deleted. Its question is answered and its
scenario survives as tests 1 and 4. It has no assertions and can never fail,
so it has no value as a test.

### Regression risk, and how it will be reported

`create_case` has 21 call sites across three test files
(`test_valuation_case_service.py` 17, `test_conservative_case.py` 2,
`test_valuation_seed.py` 2). Some fixtures are minimal payloads written to
exercise storage rather than economics, and may not be valuable cases.

Every test that newly fails is one of two things:

- a fixture that was never a valid case -- fix the fixture; or
- a real defect the gate has just exposed -- fix the code.

Which one each was will be reported explicitly. Fixtures will not be adjusted
until the suite is green without saying what changed and why.

**Success criterion: the full suite passes, 784 tests and the new ones, with
no test skipped, xfailed, or weakened to accommodate the gate.**

## Also in scope

- **`ERROR-LOG.md` entry.** A confirmed defect that produced silent wrong
  behaviour -- a success return for a permanently broken case -- which
  CLAUDE.md §7 requires be recorded. The record must state that
  `_validate_runnable`'s docstring claimed coverage it did not have, since
  that claim is why the gap survived review.
- **`guideline/sop/todo.md`.** Log the fix on the Industry-Relative
  Conservative Valuation track, where the stored-but-unrunnable behaviour was
  described as a refusal.
- **The `CLAUDE.md` deletion.** A 0-byte stub at the repo root, deleted
  during an earlier `/doctor` run and still uncommitted. It is unrelated to
  this defect and will be committed separately, not folded into the fix.

## Out of scope

- `packages/core_finance/segment_valuation.py` is not modified. The engine's
  guards are correct; only the moment they fire is changing.
- `apps/api/services/company_baseline.py` and `apps/api/routes/valuation.py`
  are not modified. Both already handle `ValueError` correctly.
- Orphaned `__pycache__` entries for two already-deleted scratch test files
  (`test_zzprobe_broken_metrics_wiring`, `test_zz_scratch_atomicity`) are
  noted, not touched -- pre-existing and unrelated.
