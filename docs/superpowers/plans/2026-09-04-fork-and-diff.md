# Fork and Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork a stored valuation case with changed assumptions, then attribute the resulting difference in `value_per_share_diluted` to each changed input, exactly and without depending on the order the changes are applied.

**Architecture:** A pure Shapley module in `packages/core_finance` that knows nothing about valuation; a fork service that applies overrides and delegates to the existing `create_case` (so the engine's runnability gate and narrative validation apply unchanged); a diff service that enumerates effective changes and calls the Shapley module with a runner closure; two thin routes. No schema change — `valuation_case.parent_case_id` already exists and is unused.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, SQLite, pytest.

**Spec:** `docs/superpowers/specs/2026-09-04-fork-and-diff-design.md`

---

## Global Constraints

- **Shapley, never a fallback.** Above `SHAPLEY_INPUT_CAP = 12` effective changes the diff **refuses**. It must never silently switch to sequential attribution: two responses of identical shape computed by different methods cannot be compared by a reader who does not check `method`.
- **Conservation, within a measured tolerance.** `math.isclose(sum(contributions), total_difference, rel_tol=1e-7, abs_tol=1e-9)`. **No residual row, no "other" bucket, ever.** If contributions do not sum, the arithmetic is wrong and the correct outcome is a failing test.
- **One changed scalar field = one Shapley player.** Canonical keys `case.<column>` and `segment.<segment_name>.<column>`. **A segment is not a player**; two changed fields on one segment are two players. Segment names match exactly — case-sensitive, no normalisation, no fuzzy matching.
- **An override equal to the parent's stored value is not a change.** Discard before counting; the cap and `changed_input_count` describe effective changes, not request keys.
- **A changed narrated field must carry a new claim.** Narratives are never inherited for changed fields. 10 of the 11 segment scalars are in `NARRATED_FIELDS`.
- **Errors are `HTTPException(status, detail=str)` with a machine-readable prefix.** There is no `{code, detail}` envelope anywhere in `apps/api/routes/`; the prefix is the code.
- **The engine's refusal wording is passed through verbatim** (`case is not valuable: …`). Do not reword it — a second copy of that wording in this layer is what Track D1 removed for shadowing the original.
- **The parent is never mutated.** A fork always creates a new case; `parent_case_id` is immutable after creation.
- Run tests with `python -m pytest -q` from the repo root. The suite was **967 passing** before this work.

### What exists already, and must not be rebuilt

| Symbol | Location | Relevance |
| --- | --- | --- |
| `load_case(case_id) -> dict` | `apps/api/services/valuation_case.py` | Returns the case's columns plus `segments`, each with its `narratives` list. Raises `CaseNotFound`. |
| `create_case(payload) -> int` | same | Validates narratives, then `_validate_by_engine`, then inserts case + segments + narratives in one transaction. |
| `run_stored_case(case_id) -> dict` | same | Runs the engine. `["value_per_share_diluted"]` is the metric this feature attributes over. **3.98 ms per call**, measured. |
| `_CASE_COLUMNS` | same | 20 names, including `case_name` and `parent_case_id`. |
| `_SEGMENT_COLUMNS` | same | 12 names, including `name`. |
| `NARRATED_FIELDS` | same | 10 names. `ramp_start_year` is the only unnarrated segment scalar. |
| `CaseNotFound` | same | Raise/translate to 404. |

---

## File Structure

| File | Responsibility |
| --- | --- |
| Create `packages/core_finance/shapley.py` | Pure. Exact Shapley values over a set of changed keys, given a callable. No knowledge of cases, SQL, or valuation. |
| Create `tests/core_finance/test_shapley.py` | Linear fixture (exactness) and nonlinear fixture (order-independence). |
| Create `apps/api/services/case_fork.py` | Validate overrides, compute effective changes, build a `create_case` payload from parent + overrides. |
| Create `tests/api/test_case_fork.py` | Fork semantics: preservation, unchanged-value rejection, narrative rules, engine refusal. |
| Create `apps/api/services/case_diff.py` | Enumerate effective changes between a case and its parent, enforce the cap, attribute via `shapley`. |
| Create `tests/api/test_case_diff.py` | Attribution against the real engine, conservation, cap refusal, no-parent refusal. |
| Modify `apps/api/routes/valuation.py` | Two endpoints, translating service errors to prefixed 4xx. |
| Create `tests/api/test_fork_diff_routes.py` | Wire-level: status codes, prefixes, response shape and ordering. |

---

### Task 1: The Shapley module

**Files:**
- Create: `packages/core_finance/shapley.py`
- Test: `tests/core_finance/test_shapley.py`

**Interfaces:**
- Produces: `shapley_contributions(base: dict, changed: dict, metric: Callable[[dict], float]) -> dict[str, float]`

- [ ] **Step 1: Write the failing tests**

Create `tests/core_finance/test_shapley.py`:

```python
import math

import pytest

from packages.core_finance.shapley import shapley_contributions


def test_linear_model_returns_marginal_effects():
    """A linear function's Shapley values ARE its marginal effects, so the
    expected numbers are computable by hand rather than by running another
    implementation and trusting it."""
    f = lambda x: 3 * x["a"] + 5 * x["b"] - 2 * x["c"]
    base = {"a": 1.0, "b": 1.0, "c": 1.0}
    changed = {"a": 2.0, "b": 3.0, "c": 0.5}

    got = shapley_contributions(base, changed, f)

    assert got["a"] == pytest.approx(3.0)     # 3 * (2 - 1)
    assert got["b"] == pytest.approx(10.0)    # 5 * (3 - 1)
    assert got["c"] == pytest.approx(1.0)     # -2 * (0.5 - 1)


def test_nonlinear_model_splits_the_interaction_evenly():
    """THE test for this module. On f(a,b) = a*b the interaction term is real,
    and this is where Shapley differs from applying changes in sequence:

        shapley        a=6.0   b=8.0
        sequential a,b a=2.0   b=12.0
        sequential b,a a=10.0  b=4.0

    Hand-computed: phi_a = 1/2[(3*1 - 1*1) + (3*5 - 1*5)] = 1/2[2 + 10] = 6
                   phi_b = 1/2[(1*5 - 1*1) + (3*5 - 3*1)] = 1/2[4 + 12] = 8

    The LINEAR fixture above cannot catch a sequential implementation -- every
    method agrees on a linear function -- so without this test the suite would
    pass unchanged if Shapley were replaced by sequential attribution.
    """
    f = lambda x: x["a"] * x["b"]
    base = {"a": 1.0, "b": 1.0}
    changed = {"a": 3.0, "b": 5.0}

    got = shapley_contributions(base, changed, f)

    assert got["a"] == pytest.approx(6.0)
    assert got["b"] == pytest.approx(8.0)
    assert sum(got.values()) == pytest.approx(14.0)   # f(3,5) - f(1,1)


def test_contributions_are_invariant_to_key_order():
    """Order-independence is the property the whole design rests on. Sequential
    attribution fails this; Shapley cannot."""
    f = lambda x: x["a"] * x["b"] + x["c"] ** 2
    base = {"a": 1.0, "b": 2.0, "c": 1.0}
    changed = {"a": 4.0, "b": 3.0, "c": 2.0}

    forward = shapley_contributions(base, changed, f)
    reversed_keys = shapley_contributions(
        {k: base[k] for k in reversed(list(base))},
        {k: changed[k] for k in reversed(list(changed))},
        f,
    )

    for key in forward:
        assert forward[key] == pytest.approx(reversed_keys[key], rel=1e-12)


def test_contributions_conserve_the_total_difference():
    f = lambda x: 120.0 * (1 + x["a"]) ** 2 * (1 + x["b"]) / (1 + x["c"])
    base = {"a": 0.05, "b": 0.10, "c": 0.20}
    changed = {"a": 0.08, "b": 0.04, "c": 0.11}

    got = shapley_contributions(base, changed, f)
    total = f(changed) - f(base)

    assert math.isclose(sum(got.values()), total, rel_tol=1e-7, abs_tol=1e-9)


def test_an_unchanged_key_is_not_a_player():
    """Only CHANGED keys are players. A key whose value is identical in both
    dicts contributes nothing and must not appear -- it would be a zero row
    implying an assumption was examined when it never moved."""
    f = lambda x: x["a"] + x["b"]
    got = shapley_contributions({"a": 1.0, "b": 2.0}, {"a": 5.0, "b": 2.0}, f)
    assert set(got) == {"a"}


def test_no_changed_keys_returns_nothing():
    f = lambda x: x["a"]
    assert shapley_contributions({"a": 1.0}, {"a": 1.0}, f) == {}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
python -m pytest -q tests/core_finance/test_shapley.py
```

Expected: FAIL — `ModuleNotFoundError: No module named 'packages.core_finance.shapley'`.

- [ ] **Step 3: Write the module**

Create `packages/core_finance/shapley.py`:

```python
"""Exact Shapley attribution over a set of changed inputs.

Deliberately knows nothing about valuation, cases or SQL: it takes a callable
returning a number. That is what lets it be tested against a linear model whose
answers are computable by hand, and against a nonlinear one where the choice of
method actually shows.

Why Shapley and not something cheaper: the model this attributes over is
nonlinear, so applying changes in sequence gives a different answer per ordering
-- "WACC contributed -12.40" would then be a fact about the implementation's
loop order rather than about WACC. Shapley is the unique attribution that is
both exact (contributions sum to the total difference) and independent of
ordering. It costs 2^k evaluations, which is why the caller caps k.
"""
from __future__ import annotations

from itertools import combinations
from math import factorial
from typing import Callable, Mapping


def shapley_contributions(
    base: Mapping[str, float],
    changed: Mapping[str, float],
    metric: Callable[[dict], float],
) -> dict[str, float]:
    """Exact Shapley value per CHANGED key, in `metric`'s units.

    `base` and `changed` hold the same keys; only those whose values differ are
    players. Returns {} when nothing differs.

    The result satisfies sum(contributions) == metric(changed) - metric(base) to
    floating tolerance -- there is no residual to report, and a caller that finds
    one has a bug rather than a rounding story.
    """
    players = [key for key in base if changed[key] != base[key]]
    if not players:
        return {}

    # metric() is evaluated once per distinct coalition rather than once per
    # permutation: 2^k evaluations instead of k!.
    cache: dict[frozenset[str], float] = {}

    def value(coalition: frozenset[str]) -> float:
        if coalition not in cache:
            inputs = dict(base)
            for key in coalition:
                inputs[key] = changed[key]
            cache[coalition] = metric(inputs)
        return cache[coalition]

    n = len(players)
    contributions: dict[str, float] = {}
    for player in players:
        others = [key for key in players if key != player]
        total = 0.0
        for size in range(len(others) + 1):
            weight = factorial(size) * factorial(n - size - 1) / factorial(n)
            for subset in combinations(others, size):
                coalition = frozenset(subset)
                total += weight * (value(coalition | {player}) - value(coalition))
        contributions[player] = total
    return contributions
```

- [ ] **Step 4: Run the tests**

```bash
python -m pytest -q tests/core_finance/test_shapley.py
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the nonlinear test is load-bearing**

Replace the body of `shapley_contributions` with sequential attribution — apply each changed key in `players` order, recording the delta:

```python
    inputs = dict(base)
    contributions = {}
    for player in players:
        before = metric(inputs)
        inputs[player] = changed[player]
        contributions[player] = metric(inputs) - before
    return contributions
```

```bash
python -m pytest -q tests/core_finance/test_shapley.py
```

Expected: `test_linear_model_returns_marginal_effects` **still passes** — that is the point — while `test_nonlinear_model_splits_the_interaction_evenly` FAILS (a = 2.0, expected 6.0). **Restore** and confirm `git diff` on the file is empty.

- [ ] **Step 6: Verify the conservation test is load-bearing**

Change the weight to `weight = 1 / factorial(n)` (dropping the `factorial(size) * factorial(n - size - 1)` term).

```bash
python -m pytest -q tests/core_finance/test_shapley.py
```

Expected: `test_contributions_conserve_the_total_difference` FAILS. **Restore**, re-run green.

- [ ] **Step 7: Commit**

```bash
git add packages/core_finance/shapley.py tests/core_finance/test_shapley.py
git commit -m "feat: exact order-independent Shapley attribution over changed inputs"
```

---

### Task 2: Forking a case

**Files:**
- Create: `apps/api/services/case_fork.py`
- Test: `tests/api/test_case_fork.py`

**Interfaces:**
- Consumes: `load_case`, `create_case`, `_CASE_COLUMNS`, `_SEGMENT_COLUMNS`, `NARRATED_FIELDS` from `apps.api.services.valuation_case`.
- Produces: `fork_case(case_id: int, case_name: str, overrides: dict) -> int`; `ForkRefused(Exception)`; `effective_changes(parent: dict, overrides: dict) -> dict[str, tuple[float, float]]` mapping canonical key → `(from, to)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_case_fork.py`:

```python
import pytest

from apps.api.services.case_fork import ForkRefused, effective_changes, fork_case
from apps.api.services.valuation_case import load_case


def _parent_payload() -> dict:
    """A minimal storable case. Narratives are required for every stated
    narrated field -- that is `_validate_narratives`, not this feature."""
    return {
        "case_name": "parent_case",
        "ticker": "TESTCO",
        "as_of_date": "2026-01-01",
        "base_year": 2025,
        "target_year": 2035,
        "riskfree_rate": 0.042,
        "wacc_initial": 0.090,
        "wacc_stable": 0.074,
        "wacc_converge_from": 5,
        "marginal_tax_rate": 0.25,
        "effective_tax_rate": 0.15,
        "nol_balance": 0.0,
        "roic_stable": 0.120,
        "terminal_growth": 0.030,
        "cash": 100.0,
        "debt": 50.0,
        "ipo_proceeds": 0.0,
        "shares_basic": 100.0,
        "shares_new": 0.0,
        "segments": [
            {
                "name": "Core",
                "base_revenue": 1000.0,
                "base_margin": 0.20,
                "revenue_target": 2000.0,
                "margin_target": 0.28,
                "sales_to_capital_early": 2.0,
                "sales_to_capital_late": 3.0,
                "ramp_start_year": 1,
                "narratives": [
                    # three_p is NOT NULL with CHECK(three_p IN
                    # ('possible','plausible','probable')) -- see db.py:568.
                    {"input_field": f, "claim": f"parent claim for {f}",
                     "evidence_source": "test", "confidence": "assumed",
                     "three_p": "probable"}
                    for f in ("base_revenue", "base_margin", "revenue_target",
                              "margin_target", "sales_to_capital_early",
                              "sales_to_capital_late")
                ],
            }
        ],
    }


@pytest.fixture()
def parent_id() -> int:
    from apps.api.services.valuation_case import create_case
    return create_case(_parent_payload())


def test_a_fork_copies_every_unmentioned_field(parent_id):
    """The test that validates the FORK rather than its HTTP status: a field the
    request never mentions must arrive unchanged."""
    child_id = fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.081}})

    child = load_case(child_id)
    assert child["wacc_stable"] == pytest.approx(0.081)
    assert child["terminal_growth"] == pytest.approx(0.030)
    assert child["roic_stable"] == pytest.approx(0.120)
    assert child["segments"][0]["margin_target"] == pytest.approx(0.28)
    assert child["parent_case_id"] == parent_id
    assert child["case_name"] == "child_case"


def test_the_parent_is_not_mutated(parent_id):
    before = load_case(parent_id)
    fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.081}})
    after = load_case(parent_id)
    assert after["wacc_stable"] == before["wacc_stable"]
    assert after["parent_case_id"] is None


def test_an_override_equal_to_the_parent_is_not_a_change(parent_id):
    """Sending the value the parent already holds is not a change. Counting it
    would inflate changed_input_count and consume the attribution cap for an
    assumption nobody moved."""
    parent = load_case(parent_id)
    assert parent["wacc_stable"] == pytest.approx(0.074)

    with pytest.raises(ForkRefused, match="no_effective_change"):
        fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.074}})


def test_an_empty_override_set_is_refused(parent_id):
    with pytest.raises(ForkRefused, match="no_effective_change"):
        fork_case(parent_id, "child_case", {})


def test_a_changed_narrated_field_needs_a_new_claim(parent_id):
    """Inheriting the parent's claim would leave a stored sentence describing how
    a DIFFERENT number was derived, and `_validate_narratives` would not notice:
    the field is still stated and still claimed."""
    with pytest.raises(ForkRefused, match="narrative_required"):
        fork_case(parent_id, "child_case",
                  {"segments": {"Core": {"margin_target": 0.31}}})


def test_a_narrated_change_with_a_claim_replaces_the_parents(parent_id):
    child_id = fork_case(parent_id, "child_case", {
        "segments": {"Core": {"margin_target": {
            "value": 0.31,
            "claim": "services mix reaches 30% by 2030",
            "evidence_source": "own estimate",
            "confidence": "assumed",
            "three_p": "plausible",
        }}},
    })

    segment = load_case(child_id)["segments"][0]
    assert segment["margin_target"] == pytest.approx(0.31)
    claims = {n["input_field"]: n["claim"] for n in segment["narratives"]}
    assert claims["margin_target"] == "services mix reaches 30% by 2030"
    # Untouched narrated fields keep the parent's wording.
    assert claims["base_revenue"] == "parent claim for base_revenue"


def test_a_narrated_change_without_three_p_is_refused(parent_id):
    """three_p is NOT NULL with a CHECK on three values. Defaulting it would have
    the API state an epistemic confidence the caller never gave."""
    with pytest.raises(ForkRefused, match="three_p"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"margin_target": {
                "value": 0.31, "claim": "services mix reaches 30% by 2030",
            }}},
        })


def test_a_claim_on_an_unnarrated_field_is_refused(parent_id):
    with pytest.raises(ForkRefused, match="unexpected_narrative"):
        fork_case(parent_id, "child_case", {
            "segments": {"Core": {"ramp_start_year": {"value": 2, "claim": "x"}}},
        })


def test_an_unknown_field_is_refused(parent_id):
    with pytest.raises(ForkRefused, match="unknown_field"):
        fork_case(parent_id, "child_case", {"case": {"not_a_column": 1.0}})


def test_an_unknown_segment_is_refused(parent_id):
    """Silently ignoring it would let a typo look like an applied change that
    did nothing."""
    with pytest.raises(ForkRefused, match="unknown_segment"):
        fork_case(parent_id, "child_case", {"segments": {"Cor": {"margin_target": 0.31}}})


def test_a_fork_the_engine_rejects_is_refused_in_the_engines_words(parent_id):
    """The runnability gate applies to forks unchanged: driving roic_stable below
    the terminal growth makes the case unrunnable, and a stored-but-unrunnable
    case is exactly what that gate exists to prevent."""
    with pytest.raises(ValueError, match="case is not valuable"):
        fork_case(parent_id, "child_case", {"case": {"roic_stable": 0.001}})


def test_effective_changes_reports_canonical_keys(parent_id):
    parent = load_case(parent_id)
    changes = effective_changes(parent, {
        "case": {"wacc_stable": 0.081},
        "segments": {"Core": {"margin_target": {
            "value": 0.31, "claim": "c", "three_p": "possible"}}},
    })
    assert set(changes) == {"case.wacc_stable", "segment.Core.margin_target"}
    assert changes["case.wacc_stable"] == (pytest.approx(0.074), pytest.approx(0.081))


def test_two_fields_on_one_segment_are_two_players(parent_id):
    """A segment is not a player; each changed scalar is."""
    parent = load_case(parent_id)
    changes = effective_changes(parent, {
        "segments": {"Core": {
            "margin_target": {"value": 0.31, "claim": "c1", "three_p": "possible"},
            "sales_to_capital_late": {"value": 3.5, "claim": "c2", "three_p": "possible"},
        }},
    })
    assert set(changes) == {
        "segment.Core.margin_target",
        "segment.Core.sales_to_capital_late",
    }
```

- [ ] **Step 2: Run them and watch them fail**

```bash
python -m pytest -q tests/api/test_case_fork.py
```

Expected: FAIL — `No module named 'apps.api.services.case_fork'`.

- [ ] **Step 3: Write the service**

Create `apps/api/services/case_fork.py`:

```python
"""Fork a stored valuation case with changed assumptions.

Everything a fork does not mention is copied from the parent. Everything it does
mention is validated first, then applied. The result goes through `create_case`,
so the narrative rule and the engine's runnability gate apply to a fork exactly
as they apply to any other case -- a fork endpoint that bypassed them would be
the hole in the guarantee that every stored case is runnable.
"""
from __future__ import annotations

from apps.api.services.valuation_case import (
    _CASE_COLUMNS,
    _SEGMENT_COLUMNS,
    NARRATED_FIELDS,
    create_case,
    load_case,
)

# Set by the caller, never copied: a fork's name is new and its parent is the
# case it came from.
_UNSETTABLE_CASE_FIELDS = frozenset({"case_name", "parent_case_id"})
_SETTABLE_CASE_FIELDS = frozenset(_CASE_COLUMNS) - _UNSETTABLE_CASE_FIELDS
_SETTABLE_SEGMENT_FIELDS = frozenset(_SEGMENT_COLUMNS) - {"name"}


class ForkRefused(Exception):
    """A fork the caller must change. The message carries a machine-readable
    prefix so a route can map it to a status without parsing prose."""


_THREE_P = frozenset({"possible", "plausible", "probable"})


def _unwrap(field: str, raw: object) -> tuple[float, str | None, str, str, str]:
    """Return (value, claim, evidence_source, confidence, three_p) for one override.

    A narrated field arrives as an object carrying its claim; an unnarrated one
    arrives as a bare scalar. Mixing them up is refused rather than guessed at.
    """
    narrated = field in NARRATED_FIELDS
    if isinstance(raw, dict):
        if not narrated:
            raise ForkRefused(
                f"unexpected_narrative: {field} is not a narrated field, so it takes "
                "a bare value rather than a claim"
            )
        if "value" not in raw:
            raise ForkRefused(f"narrative_required: {field} override has no 'value'")
        claim = str(raw.get("claim") or "").strip()
        if not claim:
            raise ForkRefused(
                f"narrative_required: {field} is a narrated field, so changing it "
                "needs a claim -- the parent's claim describes a different number"
            )
        three_p = str(raw.get("three_p") or "")
        if three_p not in _THREE_P:
            # NOT defaulted: three_p is an epistemic claim about the assumption,
            # and picking one for the caller asserts a confidence nobody stated.
            raise ForkRefused(
                f"narrative_required: {field} needs a three_p of "
                f"{sorted(_THREE_P)}, got {three_p!r}"
            )
        return (
            raw["value"],
            claim,
            str(raw.get("evidence_source") or "fork"),
            str(raw.get("confidence") or "assumed"),
            three_p,
        )
    if narrated:
        raise ForkRefused(
            f"narrative_required: {field} is a narrated field, so changing it needs "
            "a claim -- the parent's claim describes a different number"
        )
    return raw, None, "", "", ""


def effective_changes(parent: dict, overrides: dict) -> dict[str, tuple[float, float]]:
    """Canonical key -> (parent value, requested value), for CHANGED fields only.

    Validation happens here, before anything is counted: an override equal to the
    parent's stored value is discarded rather than counted, because the
    attribution cap and `changed_input_count` describe changed dimensions, not
    request keys.
    """
    changes: dict[str, tuple[float, float]] = {}

    for field, raw in (overrides.get("case") or {}).items():
        if field not in _SETTABLE_CASE_FIELDS:
            raise ForkRefused(f"unknown_field: case.{field} is not a settable case column")
        value, _, _, _, _ = _unwrap(field, raw)
        if value != parent[field]:
            changes[f"case.{field}"] = (parent[field], value)

    by_name = {segment["name"]: segment for segment in parent["segments"]}
    for segment_name, fields in (overrides.get("segments") or {}).items():
        if segment_name not in by_name:
            raise ForkRefused(
                f"unknown_segment: {segment_name!r} is not a segment of this case; "
                f"it has {sorted(by_name)}"
            )
        segment = by_name[segment_name]
        for field, raw in fields.items():
            if field not in _SETTABLE_SEGMENT_FIELDS:
                raise ForkRefused(
                    f"unknown_field: segment.{segment_name}.{field} is not a settable "
                    "segment column"
                )
            value, _, _, _, _ = _unwrap(field, raw)
            if value != segment[field]:
                changes[f"segment.{segment_name}.{field}"] = (segment[field], value)

    return changes


def fork_case(case_id: int, case_name: str, overrides: dict) -> int:
    """Persist a copy of `case_id` with `overrides` applied. Returns the new id.

    Raises `CaseNotFound` for an unknown parent, `ForkRefused` for a request the
    caller must change, and `ValueError` from `create_case` when the engine
    refuses the resulting case.
    """
    parent = load_case(case_id)
    changes = effective_changes(parent, overrides)
    if not changes:
        raise ForkRefused(
            "no_effective_change: the fork changes nothing -- every override "
            "already matches the parent's stored value"
        )

    payload = {field: parent[field] for field in _CASE_COLUMNS}
    payload["case_name"] = case_name
    payload["parent_case_id"] = case_id
    for field, raw in (overrides.get("case") or {}).items():
        payload[field], _, _, _, _ = _unwrap(field, raw)

    payload["segments"] = []
    for segment in parent["segments"]:
        copy = {field: segment[field] for field in _SEGMENT_COLUMNS}
        narratives = {n["input_field"]: dict(n) for n in segment["narratives"]}
        for field, raw in (overrides.get("segments") or {}).get(segment["name"], {}).items():
            value, claim, source, confidence, three_p = _unwrap(field, raw)
            copy[field] = value
            if claim is not None:
                # Replace, never inherit: the parent's claim describes the value
                # this override just superseded.
                narratives[field] = {
                    "input_field": field,
                    "claim": claim,
                    "evidence_source": source,
                    "confidence": confidence,
                    "three_p": three_p,
                }
        copy["narratives"] = [narratives[k] for k in sorted(narratives)]
        payload["segments"].append(copy)

    return create_case(payload)
```

- [ ] **Step 4: Run the tests**

```bash
python -m pytest -q tests/api/test_case_fork.py
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Verify the preservation test is load-bearing**

In `fork_case`, build the payload from defaults instead of the parent — change
`payload = {field: parent[field] for field in _CASE_COLUMNS}` to
`payload = {field: parent[field] if field in ("ticker", "as_of_date", "base_year", "target_year") else 0.0 for field in _CASE_COLUMNS}`.

```bash
python -m pytest -q tests/api/test_case_fork.py
```

Expected: `test_a_fork_copies_every_unmentioned_field` FAILS on `terminal_growth`. **Restore.**

- [ ] **Step 6: Verify the unchanged-value discard is load-bearing**

In `effective_changes`, drop both `if value != …` guards so every override counts.

```bash
python -m pytest -q tests/api/test_case_fork.py
```

Expected: `test_an_override_equal_to_the_parent_is_not_a_change` FAILS — no `ForkRefused` raised. **Restore.**

- [ ] **Step 7: Verify the narrative rule is load-bearing**

In `_unwrap`, make the bare-scalar branch return `(raw, None, "", "")` for narrated fields too (delete the `if narrated: raise` immediately above it).

```bash
python -m pytest -q tests/api/test_case_fork.py
```

Expected: `test_a_changed_narrated_field_needs_a_new_claim` FAILS. **Restore**, re-run green, and confirm `git diff` on the service is empty.

- [ ] **Step 8: Commit**

```bash
git add apps/api/services/case_fork.py tests/api/test_case_fork.py
git commit -m "feat: fork a stored case, requiring a fresh claim for every changed narrated field"
```

---

### Task 3: Diffing a case against its parent

**Files:**
- Create: `apps/api/services/case_diff.py`
- Test: `tests/api/test_case_diff.py`

**Interfaces:**
- Consumes: `shapley_contributions` (Task 1); `effective_changes` (Task 2); `load_case`, `run_stored_case`, `_CASE_COLUMNS`, `_SEGMENT_COLUMNS` from `valuation_case`.
- Produces: `diff_case(case_id: int) -> dict`; `DiffRefused(Exception)`; `SHAPLEY_INPUT_CAP = 12`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_case_diff.py`:

```python
import math

import pytest

from apps.api.services.case_diff import SHAPLEY_INPUT_CAP, DiffRefused, diff_case
from apps.api.services.case_fork import fork_case
from apps.api.services.valuation_case import create_case, run_stored_case
from tests.api.test_case_fork import _parent_payload


@pytest.fixture()
def parent_id() -> int:
    return create_case(_parent_payload())


def test_a_case_with_no_parent_cannot_be_diffed(parent_id):
    """A root case has nothing to be attributed against. Returning an empty
    waterfall would present 'no differences' where the truth is 'no comparison
    exists'."""
    with pytest.raises(DiffRefused, match="no_parent"):
        diff_case(parent_id)


def test_contributions_conserve_the_difference_against_the_real_engine(parent_id):
    """Proves the module is wired into MoneyView's actual valuation engine, not
    merely correct in isolation."""
    child_id = fork_case(parent_id, "child_case", {
        "case": {"wacc_stable": 0.081, "terminal_growth": 0.025},
    })

    result = diff_case(child_id)

    parent_value = run_stored_case(parent_id)["value_per_share_diluted"]
    child_value = run_stored_case(child_id)["value_per_share_diluted"]
    assert result["parent_value_per_share_diluted"] == pytest.approx(parent_value)
    assert result["case_value_per_share_diluted"] == pytest.approx(child_value)

    total = sum(c["contribution"] for c in result["contributions"])
    assert math.isclose(total, result["total_difference"], rel_tol=1e-7, abs_tol=1e-9)
    assert math.isclose(
        result["parent_value_per_share_diluted"] + total,
        result["case_value_per_share_diluted"],
        rel_tol=1e-7, abs_tol=1e-9,
    )


def test_the_response_names_its_method_and_input_count(parent_id):
    child_id = fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.081}})
    result = diff_case(child_id)
    assert result["method"] == "shapley"
    assert result["changed_input_count"] == 1
    assert result["metric"] == "value_per_share_diluted"


def test_only_changed_inputs_appear(parent_id):
    """One override, one contribution. A zero row for an untouched assumption
    would imply it was examined."""
    child_id = fork_case(parent_id, "child_case", {"case": {"wacc_stable": 0.081}})
    result = diff_case(child_id)
    assert [c["input"] for c in result["contributions"]] == ["case.wacc_stable"]
    assert result["contributions"][0]["from"] == pytest.approx(0.074)
    assert result["contributions"][0]["to"] == pytest.approx(0.081)


def test_contributions_come_back_in_canonical_order(parent_id):
    """Mathematical order-independence and a stable response list are different
    guarantees; this is the second one."""
    child_id = fork_case(parent_id, "child_case", {
        "case": {"wacc_stable": 0.081, "terminal_growth": 0.025},
        "segments": {"Core": {"margin_target": {
            "value": 0.31, "claim": "c", "three_p": "possible"}}},
    })
    first = [c["input"] for c in diff_case(child_id)["contributions"]]
    second = [c["input"] for c in diff_case(child_id)["contributions"]]
    assert first == second
    assert first[-1].startswith("segment."), "case.* keys sort before segment.*"


def test_too_many_changed_inputs_is_refused_not_downgraded(monkeypatch):
    """Refusing is content. Falling back to sequential would return the same
    response shape computed by a different, order-dependent method -- and a
    reader comparing two diffs could not tell."""
    import apps.api.services.case_diff as case_diff

    monkeypatch.setattr(case_diff, "SHAPLEY_INPUT_CAP", 1)
    parent = create_case(_parent_payload())
    child_id = fork_case(parent, "child_case", {
        "case": {"wacc_stable": 0.081, "terminal_growth": 0.025},
    })
    with pytest.raises(DiffRefused, match="too_many_changed_inputs"):
        case_diff.diff_case(child_id)


def test_the_cap_is_a_named_constant():
    assert SHAPLEY_INPUT_CAP == 12
```

- [ ] **Step 2: Run them and watch them fail**

```bash
python -m pytest -q tests/api/test_case_diff.py
```

Expected: FAIL — `No module named 'apps.api.services.case_diff'`.

- [ ] **Step 3: Write the service**

Create `apps/api/services/case_diff.py`:

```python
"""Attribute the difference between a forked case and its parent, per input.

The metric is `value_per_share_diluted` -- the same number
`valuation_verdict`'s dcf_gap row consumes, so the two layers agree about what
"the valuation" is.
"""
from __future__ import annotations

from apps.api.services.case_fork import effective_changes
from apps.api.services.valuation_case import (
    _CASE_COLUMNS,
    _SEGMENT_COLUMNS,
    NARRATED_FIELDS,
    load_case,
    run_case_payload,
)
from packages.core_finance.shapley import shapley_contributions

METRIC = "value_per_share_diluted"

# 2^12 = 4096 engine runs, about 16 s at the measured 3.98 ms per run: the edge
# of a tolerable synchronous request. Named so the number has one home and its
# rationale travels with it.
SHAPLEY_INPUT_CAP = 12


class DiffRefused(Exception):
    """A diff that cannot be produced. The message carries a machine-readable
    prefix so a route can map it without parsing prose."""


def _canonical_sort_key(key: str) -> tuple:
    """case.* before segment.*, then column order, then segment name."""
    if key.startswith("case."):
        column = key.split(".", 1)[1]
        return (0, _CASE_COLUMNS.index(column), "", 0)
    _, segment_name, column = key.split(".", 2)
    return (1, 0, segment_name, _SEGMENT_COLUMNS.index(column))


def diff_case(case_id: int) -> dict:
    """Shapley attribution of `case_id`'s value difference from its parent."""
    case = load_case(case_id)
    parent_id = case["parent_case_id"]
    if parent_id is None:
        raise DiffRefused(
            f"no_parent: case {case_id} has no parent, so there is nothing to "
            "attribute a difference against"
        )
    parent = load_case(parent_id)

    # Rebuild the overrides the fork applied, as a plain scalar map: the child's
    # stored values ARE the requested ones, so `effective_changes` re-derives the
    # same canonical keys the fork produced.
    overrides = {
        "case": {
            field: case[field]
            for field in _CASE_COLUMNS
            if field not in ("case_name", "parent_case_id") and case[field] != parent[field]
        },
        "segments": {},
    }
    parent_segments = {s["name"]: s for s in parent["segments"]}
    for segment in case["segments"]:
        original = parent_segments.get(segment["name"])
        if original is None:
            continue
        changed = {
            field: segment[field]
            for field in _SEGMENT_COLUMNS
            if field != "name" and segment[field] != original[field]
        }
        if changed:
            overrides["segments"][segment["name"]] = changed

    changes = effective_changes(parent, _as_bare_scalars(overrides))
    if not changes:
        raise DiffRefused(
            f"no_effective_change: case {case_id} holds the same values as its parent"
        )
    if len(changes) > SHAPLEY_INPUT_CAP:
        raise DiffRefused(
            f"too_many_changed_inputs: {len(changes)} inputs changed, the attribution "
            f"cap is {SHAPLEY_INPUT_CAP}"
        )

    base = {key: frm for key, (frm, _) in changes.items()}
    changed_values = {key: to for key, (_, to) in changes.items()}
    contributions = shapley_contributions(
        base, changed_values, lambda inputs: run_case_payload(parent, inputs)[METRIC]
    )

    parent_value = run_case_payload(parent, base)[METRIC]
    case_value = run_case_payload(parent, changed_values)[METRIC]
    return {
        "case_id": case_id,
        "parent_case_id": parent_id,
        "metric": METRIC,
        "parent_value_per_share_diluted": parent_value,
        "case_value_per_share_diluted": case_value,
        "total_difference": case_value - parent_value,
        "method": "shapley",
        "changed_input_count": len(changes),
        "contributions": [
            {
                "input": key,
                "from": changes[key][0],
                "to": changes[key][1],
                "contribution": contributions[key],
            }
            for key in sorted(changes, key=_canonical_sort_key)
        ],
    }


def _as_bare_scalars(overrides: dict) -> dict:
    """`effective_changes` accepts narrated fields only as {value, claim} objects.
    Re-deriving changes from two STORED cases needs no claim -- both already
    passed narrative validation when they were written -- so wrap each scalar
    with a placeholder claim that is never persisted."""
    wrapped = {"case": dict(overrides["case"]), "segments": {}}
    for name, fields in overrides["segments"].items():
        wrapped["segments"][name] = {
            # Only NARRATED fields take the object form. Wrapping an unnarrated
            # one (ramp_start_year) would trip `unexpected_narrative` and crash
            # the diff on a fork that legitimately changed it.
            field: ({"value": value, "claim": "stored", "three_p": "probable"}
                    if field in NARRATED_FIELDS else value)
            for field, value in fields.items()
        }
    return wrapped
```

- [ ] **Step 4: Add the engine runner this depends on**

`diff_case` needs to run the engine on an arbitrary set of input values without persisting anything. Add to `apps/api/services/valuation_case.py`, directly below `run_stored_case`:

```python
def run_case_payload(base_case: dict, overrides: dict[str, float]) -> dict:
    """Run the engine over `base_case` with canonical-key `overrides` applied.

    Nothing is persisted: this is the evaluation function Shapley calls 2^k
    times, and writing a row per coalition would be both slow and a lie about
    what a stored case means.
    """
    case = {field: base_case[field] for field in _CASE_COLUMNS}
    segments = [
        {field: segment[field] for field in _SEGMENT_COLUMNS}
        for segment in base_case["segments"]
    ]
    by_name = {segment["name"]: segment for segment in segments}
    for key, value in overrides.items():
        if key.startswith("case."):
            case[key.split(".", 1)[1]] = value
        else:
            _, segment_name, column = key.split(".", 2)
            by_name[segment_name][column] = value

    case["segments"] = segments
    spec, specs = _specs_from_payload(case)
    result = run_case(spec, specs)
    return {"value_per_share_diluted": result.value_per_share_diluted}
```

- [ ] **Step 5: Run the tests**

```bash
python -m pytest -q tests/api/test_case_diff.py
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Verify the cap refuses rather than degrades**

In `diff_case`, replace the `too_many_changed_inputs` raise with a sequential fallback:

```python
    if len(changes) > SHAPLEY_INPUT_CAP:
        contributions = {}
        inputs = dict(base)
        for key in changes:
            before = run_case_payload(parent, inputs)[METRIC]
            inputs[key] = changes[key][1]
            contributions[key] = run_case_payload(parent, inputs)[METRIC] - before
```

```bash
python -m pytest -q tests/api/test_case_diff.py
```

Expected: `test_too_many_changed_inputs_is_refused_not_downgraded` FAILS — no `DiffRefused`. **Restore.**

- [ ] **Step 7: Verify the no-parent refusal is load-bearing**

Delete the `if parent_id is None:` block.

```bash
python -m pytest -q tests/api/test_case_diff.py
```

Expected: `test_a_case_with_no_parent_cannot_be_diffed` FAILS. **Restore**, re-run green, confirm `git diff` clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api/services/case_diff.py apps/api/services/valuation_case.py tests/api/test_case_diff.py
git commit -m "feat: attribute a fork's valuation difference per input, by Shapley"
```

---

### Task 4: The two endpoints

**Files:**
- Modify: `apps/api/routes/valuation.py`
- Test: `tests/api/test_fork_diff_routes.py`

**Interfaces:**
- Consumes: `fork_case`, `ForkRefused` (Task 2); `diff_case`, `DiffRefused` (Task 3); `CaseNotFound`.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_fork_diff_routes.py`:

```python
import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.valuation_case import create_case
from tests.api.test_case_fork import _parent_payload

client = TestClient(app)


@pytest.fixture()
def parent_id() -> int:
    return create_case(_parent_payload())


def test_fork_returns_the_new_case_id(parent_id):
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case", "overrides": {"case": {"wacc_stable": 0.081}}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["id"] != parent_id


def test_forking_an_unknown_case_is_a_404():
    response = client.post(
        "/api/v1/valuation/cases/999999/fork",
        json={"case_name": "child_case", "overrides": {"case": {"wacc_stable": 0.081}}},
    )
    assert response.status_code == 404
    assert "no valuation case" in response.json()["detail"]


def test_a_refused_fork_carries_its_machine_readable_prefix(parent_id):
    """The prefix IS the code: this repo has no {code, detail} envelope, and the
    conservative-case route documents the same convention."""
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case",
              "overrides": {"segments": {"Core": {"margin_target": 0.31}}}},
    )
    assert response.status_code == 422
    assert response.json()["detail"].startswith("narrative_required:")


def test_an_engine_refusal_reaches_the_caller_verbatim(parent_id):
    response = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case", "overrides": {"case": {"roic_stable": 0.001}}},
    )
    assert response.status_code == 422
    assert response.json()["detail"].startswith("case is not valuable:")


def test_diff_returns_the_waterfall(parent_id):
    created = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case",
              "overrides": {"case": {"wacc_stable": 0.081, "terminal_growth": 0.025}}},
    ).json()["data"]["id"]

    body = client.get(f"/api/v1/valuation/cases/{created}/diff").json()["data"]

    assert body["method"] == "shapley"
    assert body["changed_input_count"] == 2
    assert {c["input"] for c in body["contributions"]} == {
        "case.wacc_stable", "case.terminal_growth"
    }
    total = sum(c["contribution"] for c in body["contributions"])
    assert total == pytest.approx(body["total_difference"], rel=1e-7, abs=1e-9)


def test_the_diff_response_carries_no_residual_row(parent_id):
    """An 'other' bucket is where an unexplained gap goes to look explained."""
    created = client.post(
        f"/api/v1/valuation/cases/{parent_id}/fork",
        json={"case_name": "child_case", "overrides": {"case": {"wacc_stable": 0.081}}},
    ).json()["data"]["id"]

    body = client.get(f"/api/v1/valuation/cases/{created}/diff").json()["data"]
    inputs = {c["input"] for c in body["contributions"]}
    assert not {"other", "residual", "interaction", "unexplained"} & inputs


def test_diffing_a_root_case_is_a_422(parent_id):
    response = client.get(f"/api/v1/valuation/cases/{parent_id}/diff")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("no_parent:")
```

- [ ] **Step 2: Run them and watch them fail**

```bash
python -m pytest -q tests/api/test_fork_diff_routes.py
```

Expected: FAIL — 404s from FastAPI, since neither route exists.

- [ ] **Step 3: Add the routes**

In `apps/api/routes/valuation.py`, extend the imports:

```python
from apps.api.services.case_diff import DiffRefused, diff_case
from apps.api.services.case_fork import ForkRefused, fork_case
```

and append, after the existing `/cases/{case_id}/run` route:

```python
@router.post("/cases/{case_id}/fork", response_model=APIResponse[ValuationCaseCreated])
def fork_valuation_case(case_id: int, payload: dict = Body(...)):
    """Copy a case with changed assumptions, recording the parent.

    Refusals keep a machine-readable prefix (`unknown_field`, `unknown_segment`,
    `narrative_required`, `unexpected_narrative`, `no_effective_change`) so a
    caller can branch without parsing prose -- the same convention the
    conservative-case route documents. An engine refusal passes through in the
    engine's own words: it owns that wording.
    """
    case_name = str(payload.get("case_name") or "").strip()
    if not case_name:
        raise HTTPException(status_code=422, detail="missing_case_name: a fork needs a name")
    try:
        new_id = fork_case(case_id, case_name, payload.get("overrides") or {})
    except CaseNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ForkRefused as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return APIResponse(data=ValuationCaseCreated(id=new_id))


@router.get("/cases/{case_id}/diff", response_model=APIResponse[dict])
def diff_valuation_case(case_id: int):
    """Attribute this case's value difference from its parent, per changed input.

    Shapley: exact and independent of the order the changes are enumerated.
    Above the cap it refuses rather than falling back to a cheaper, order-
    dependent method -- two responses of identical shape computed differently
    cannot be compared.
    """
    try:
        return APIResponse(data=diff_case(case_id))
    except CaseNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DiffRefused as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
```

`CaseNotFound` is already imported in this module (`apps/api/routes/valuation.py:23`), so no import change is needed for it.

- [ ] **Step 4: Run the tests**

```bash
python -m pytest -q tests/api/test_fork_diff_routes.py
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Verify the no-residual test is load-bearing**

In `diff_case`, append a residual row before returning:

```python
        result["contributions"].append(
            {"input": "residual", "from": 0.0, "to": 0.0, "contribution": 0.0}
        )
```

(assigning the dict to `result` first if needed).

```bash
python -m pytest -q tests/api/test_fork_diff_routes.py
```

Expected: `test_the_diff_response_carries_no_residual_row` FAILS. **Restore.**

- [ ] **Step 6: Verify the engine-refusal passthrough is load-bearing**

In the fork route, replace `detail=str(exc)` in the `except ValueError` branch with `detail="invalid case"`.

```bash
python -m pytest -q tests/api/test_fork_diff_routes.py
```

Expected: `test_an_engine_refusal_reaches_the_caller_verbatim` FAILS. **Restore**, re-run green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/routes/valuation.py tests/api/test_fork_diff_routes.py
git commit -m "feat: expose /fork and /diff, refusals keeping their prefixes"
```

---

### Task 5: Whole-suite verification and docs

**Files:**
- Modify: `guideline/sop/todo.md` (Track C, item C2)

- [ ] **Step 1: Run the whole backend suite**

```bash
python -m pytest -q
```

Expected: **1000 passed** (967 before this work, plus 6 + 13 + 7 + 7 = 33 new). If the count differs, report the actual number rather than the expected one — a mismatch means a test was not collected or an existing one broke.

- [ ] **Step 2: Confirm no frontend impact**

This work is API-only and touches no file under `apps/web`. Confirm with:

```bash
git diff --name-only renewal..HEAD -- apps/web
```

Expected: empty output. If it is not, something is out of scope.

- [ ] **Step 3: Update the todo**

In `guideline/sop/todo.md`, change the C2 bullet to record that **`/fork` and `/diff` are done** while **Monte Carlo (`/simulate`) and `/pricing` remain open** — C2 is not closed by this work. Record: the two endpoints, the Shapley choice and why (exact and order-independent, versus sequential's order-dependence and one-at-a-time's residual), `SHAPLEY_INPUT_CAP = 12` with its refusal, the narrative rule for changed narrated fields, and the mutations each guarantee was shown to fail against.

State plainly that the **linear Shapley fixture cannot catch a sequential swap** — every method agrees on a linear function — and that the nonlinear `a·b` fixture is what makes that mutation fail. That is the single most useful sentence for the next reader.

- [ ] **Step 4: Commit**

```bash
git add guideline/sop/todo.md
git commit -m "docs: record /fork and /diff; C2's Monte Carlo and /pricing remain open"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §2 Shapley chosen; exact and order-independent | Task 1, mutation-verified in Steps 5–6 |
| §2.1 canonical keys; a segment is not a player | Task 2 (`effective_changes`), tested by `test_two_fields_on_one_segment_are_two_players` |
| §2.2 mathematical vs presentational ordering | Task 1 (`test_contributions_are_invariant_to_key_order`) and Task 3 (`test_contributions_come_back_in_canonical_order`) |
| §4.1 effective changes, order of operations | Task 2, mutation-verified Step 6 |
| §4.2 a changed narrated field needs a new claim | Task 2, mutation-verified Step 7 |
| §4.3 fork invariants | Task 2 (`test_the_parent_is_not_mutated`, preservation test) |
| §4.4 runnability gate applies unchanged | Task 2 (`test_a_fork_the_engine_rejects_is_refused_in_the_engines_words`) |
| §4.5 error prefixes, no `{code, detail}` envelope | Task 4 |
| §5.1 conservation, no residual, units, `from`/`to` | Task 3 and Task 4, mutation-verified Task 4 Step 5 |
| §5.2 the cap refuses rather than degrades | Task 3, mutation-verified Step 6 |
| §6 component boundaries | the File Structure table |
| §7 verification, both fixtures | Task 1 |

**Deliberately not built**

- **Monte Carlo, `/pricing`, any UI, segment add/remove, caching** — §3 and §8 of the spec put all of these out of scope, each with a reason. C2 remains open after this plan.
- **A `/diff` between two arbitrary cases.** The endpoint diffs against `parent_case_id` only; comparing unrelated cases is a different claim needing its own basis disclosure.

**Type consistency:** `shapley_contributions(base, changed, metric)` (Task 1) is called with exactly that signature in Task 3. `effective_changes(parent, overrides) -> dict[str, tuple[float, float]]` (Task 2) is consumed in Task 3 as `(frm, to)` pairs. `fork_case(case_id, case_name, overrides) -> int`, `ForkRefused`, `diff_case(case_id) -> dict`, `DiffRefused` and `SHAPLEY_INPUT_CAP` are used in Task 4 under those names. `run_case_payload(base_case, overrides) -> dict` is added in Task 3 Step 4 and called only there.

**One thing the implementer must not miss:** Task 1 Step 5 requires the *linear* test to keep passing while the *nonlinear* one fails. If both fail, the sequential replacement was written wrongly; if neither fails, `shapley_contributions` was not actually replaced.
