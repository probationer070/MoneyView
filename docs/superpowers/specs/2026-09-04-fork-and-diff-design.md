# Fork and Diff — Attributing a Valuation Difference — Design

Date: 2026-09-04
Status: reviewed 2026-09-04; P0 items closed. Ready for an implementation plan.
Scope: the first half of Track C2 (3c). `/fork` and `/diff` only. Monte Carlo
(`/simulate`) and `/pricing` are separate sub-projects.

> Every figure quoted below was measured against this repository on 2026-09-04,
> not assumed. Measurements are reproduced inline so a reviewer can disagree
> with the evidence rather than only with the conclusion.

---

## 1. Problem

The segment build-up engine (3a) and its persistence (3b) shipped. A case can be
stored and run, and it returns one number: `value_per_share_diluted`.

What it cannot do is answer the only question a reader of that number actually
has: **if I change an assumption, how much of the difference is due to that
assumption?**

`2026-08-09-segment-buildup-valuation-design.md` §5.1 anticipated this. It kept
`valuation_case.parent_case_id` in the schema *specifically* for a deferred
`/diff`, even though nothing then used it:

> **`parent_case_id` is kept** even though `/diff` is deferred, because the seed
> [...] is the fixture 3c's `/diff` will need.

That column exists today and was `NULL` on every stored case at design time.

### 1.1 There is now something to fork

**At design time (2026-09-04)** 30 `valuation_case` rows existed — the
conservative cases generated after Track A1 loaded the Damodaran vintage; before
that day there were zero. These are measurements of the repository on one day,
not architectural facts: nothing below depends on the number being 30, and a
reader should re-measure rather than quote it.

---

## 2. The design problem: attribution is not unique

The engine is **nonlinear**. If a fork changes both `wacc_stable` and
`terminal_growth`, there is no single true answer to "how much did WACC
contribute?" — the answer depends on whether WACC is applied before or after
growth, because the two interact through the terminal value.

A waterfall that reports "WACC: −$12.40" without saying which ordering produced
it is stating a number whose basis is an arbitrary choice made inside the
implementation. That is the defect class `ERROR-LOG.md` records three times: a
number wearing an attribution it has not earned.

Three ways to resolve it, measured against a run cost of **3.98 ms** (timed over
200 runs of a stored case on 2026-09-04):

| Method | Sums to the total? | Order-dependent? | Cost for *k* changed inputs |
| --- | --- | --- | --- |
| Sequential, in a declared order | yes | **yes** | *k* runs |
| One-at-a-time from the parent | **no** — leaves an interaction residual | no | *k* runs |
| **Shapley over the changed inputs** | **yes, exactly** | **no** | 2^*k* runs |

**Shapley is chosen.** It is the only one that is both exact and
order-independent. At the measured benchmark of 3.98 ms per run, 8 changed
inputs take approximately 1.0 s, 10 about 4.1 s and 12 about 16.3 s. **These are
planning estimates from one machine on one day, not latency guarantees.** A
realistic fork changes a handful of assumptions, not thirty.

The cost is exponential, so §5.2 sets a cap and **refuses beyond it** rather than
degrading to a cheaper method.

### 2.1 What counts as one Shapley input

This is the definition the whole result rests on, so it is stated before the
endpoints that use it.

```
Each changed SCALAR FIELD is exactly one Shapley player. Canonical keys:

    case.<column>                        e.g. case.wacc_stable
    segment.<segment_name>.<column>      e.g. segment.Core.margin_target

A segment is NOT a player. Two changed fields on one segment are two players.
Segment names are matched exactly: case-sensitive, no normalisation, no fuzzy
matching. Names are unique within a case.
```

Canonical ordering, used wherever inputs or contributions are enumerated:
**`case.*` keys first in `valuation_case` column order, then `segment.*` keys
ordered by segment name, then by `segment` column order.** This is a
presentation rule only — §2.2 states the mathematical guarantee that the values
themselves do not depend on any ordering.

### 2.2 Order-independence is a property of the values, not of the list

Two different statements, both required:

- **Mathematical.** Shapley contributions are invariant to the order in which
  inputs are enumerated. Computing a diff with the changed inputs in any
  permutation yields identical numbers.
- **Presentational.** The response emits contributions in the canonical order of
  §2.1, so a client rendering them gets a stable list.

Both are tested (§7). They are independent: an implementation could be
mathematically correct and still emit an unstable list.

---

## 3. Scope

**In:** two endpoints, one service module, no schema change.

**Out, deliberately:**

| Item | Why |
| --- | --- |
| Adding or removing segments in a fork | Shapley assigns a contribution per *changed input*. A segment present in only one case is not a changed input — it is a different model. There is no coherent contribution to report, so the honest move is to exclude it rather than invent one. |
| Monte Carlo (`/simulate`) | Separate sub-project. Distributions over inputs, not a pairwise difference. |
| `/pricing` multiples | Separate sub-project. |
| Any UI | 3a and 3b shipped API-only; the valuation tab (C1) consumes the verdict panel, not cases. |
| A new schema column | `parent_case_id` already exists and is unused. |

---

## 4. `POST /api/v1/valuation/cases/{case_id}/fork`

Request:

```json
{
  "case_name": "aapl_higher_margin",
  "overrides": {
    "case": { "wacc_stable": 0.081, "terminal_growth": 0.025 },
    "segments": { "Core": { "margin_target": 0.31 } }
  }
}
```

Loads `case_id`, applies the overrides, persists a new case with
`parent_case_id = case_id`, and returns the new id.

**Segments are matched by name.** A name in `overrides.segments` that the parent
does not have is a 422 naming the unknown segment — silently ignoring it would
let a typo look like an applied change that did nothing.

**Only scalar fields may be overridden**, on the case and on existing segments.
The allowed keys are exactly the columns of `valuation_case` (excluding `id`,
`case_name`, `parent_case_id`) and of `segment` (excluding `id`, `case_id`,
`name`). Anything else is a 422 naming the field.

### 4.1 Effective changes, and the order things are decided in

An override whose value **equals the parent's persisted value is not a change.**
Sending `wacc_stable: 0.074` when the parent already holds `0.074` contributes
nothing and must not be counted, because `changed_input_count` and the §5.2 cap
both describe *changed dimensions*, not request keys.

The processing order is fixed, and the sequence matters:

```
1. validate the requested keys        -> unknown field or segment: 422
2. resolve each against the parent    -> read the parent's persisted value
3. discard overrides equal to parent  -> these are not changes
4. count the remaining EFFECTIVE changes
5. if zero                            -> 422, nothing to fork
6. if more than SHAPLEY_INPUT_CAP     -> 422 (the cap is checked at /diff, §5.2)
7. persist, then attribute over exactly those effective changes
```

Step 3 before step 4 is the whole point: a fork sending twelve keys of which two
differ has **two** effective changes, and both the count and the cap must say so.

**An empty override set — or one whose every value matches the parent — is
refused.** A fork that changes nothing produces a case identical to its parent,
and a diff of it would be an all-zero waterfall presented as if it meant
something.

### 4.2 A changed narrated field needs a new claim

**10 of the 11 segment scalars are `NARRATED_FIELDS`** — every one carries a
stored claim justifying its value. At design time the 30 stored cases held 180
such claims, e.g. for `revenue_target`:

> "416.1610 compounded at 0.0181 for 10 years. Top 5 industries…"

`_validate_narratives` enforces both directions: every stated field has a claim,
and every claim names a stated field. Its own docstring says why the second
matters — *"a claim survives the removal of the input it justified and quietly
misdescribes the case."*

**Inheriting the parent's narrative through a fork would defeat exactly that.**
Override `revenue_target` and copy the claim, and validation PASSES — the field
is still stated and still claimed — while the stored claim now describes how a
different number was derived. Nothing in the schema or the validator would catch
it. A claim wearing an attribution it no longer earns is the defect class
`ERROR-LOG.md` records three times.

So:

```
A fork that changes a NARRATED field MUST supply a new claim for it.
Narratives are never inherited for changed fields.
Unchanged narrated fields keep the parent's narrative untouched.
```

The request carries them alongside the value:

```json
{
  "case_name": "aapl_higher_margin",
  "overrides": {
    "case": { "wacc_stable": 0.081 },
    "segments": {
      "Core": {
        "margin_target": {
          "value": 0.31,
          "claim": "Services mix reaches 30% of revenue by 2030; margin follows the 2024-25 trend rather than the 5-year mean.",
          "evidence_source": "own estimate",
          "confidence": "assumed",
          "three_p": "plausible"
        }
      }
    }
  }
}
```

`three_p` is required and must be one of `possible | plausible | probable` --
`segment_narrative.three_p` is `NOT NULL` with a `CHECK` on exactly those three
values. It is **not** defaulted: it is an epistemic claim about the assumption,
and an API that picks one on the caller's behalf asserts a confidence nobody
stated. That is the same reason the claim itself is required.

A narrated field given as a bare scalar instead of this object, or missing
`claim` or `three_p`, is a **422 `narrative_required:`** naming the field. An unnarrated field (`ramp_start_year`,
and every `case.*` column) takes a bare scalar; supplying a claim for one is a
422 `unexpected_narrative:`, because a claim that names no narrated input is the
other half of what `_validate_narratives` rejects.

This is the same rule the codebase already applies twice: a number does not enter
the model without a stated reason (`_validate_narratives`), and a decision
without a stated reason is a snapshot (`investment_decision.memo` is NOT NULL).
The cost is one sentence per changed assumption, which is the point rather than
the price.

### 4.3 Fork invariants

Locked down, because a diff's meaning depends on them:

```
- A fork ALWAYS creates a new case. It never edits in place.
- The parent is never mutated, by this endpoint or any other.
- parent_case_id points at the source case and is IMMUTABLE after creation.
- Every scalar not explicitly overridden is copied from the parent unchanged.
- Segments cannot be added, removed or renamed.
- Only scalar fields on existing case and segment records may change.
- A changed NARRATED field carries a new claim; narratives are never inherited
  for changed fields (§4.2).
- Segment names match exactly: case-sensitive, unique within a case, no
  normalisation and no fuzzy matching.
```

### 4.4 The runnability gate applies unchanged

A fork goes through `create_case`, and therefore through `_validate_by_engine`,
which runs the engine and raises `case is not valuable: <engine's own message>`
on refusal. A fork that drives `roic_stable` below `wacc_stable` is refused with
the engine's wording, exactly as a conservative case is.

This is not an obstacle to route around. It is the guarantee that **every stored
case is runnable**, and the reason the conservative-case generator stored only 30
of 139 tickers on 2026-09-04 — 53 refused because `roic_stable` did not exceed
terminal growth, 37 for a negative `roic_stable`. A fork endpoint that bypassed
the gate would reintroduce exactly the stored-but-unrunnable case Track D3 went
looking for.

The refusal is a **422 carrying the engine's message verbatim**. It is not
reworded here: the engine owns that wording, and a second copy of it in this
layer is what D1 removed for shadowing the original.

### 4.5 The error contract — prefixes, not a new envelope

Callers must be able to branch on a refusal without parsing prose. This repo
already solves that, and this design adopts the existing solution rather than
inventing a second one.

Every error in `apps/api/routes/` today is `HTTPException(status, detail=<str>)`
— there is **no** structured `{"code": ..., "detail": ...}` body anywhere in the
codebase (checked 2026-09-04). The conservative-case route documents the
convention explicitly:

> the reason keeps its machine-readable prefix (`unmapped_industry`,
> `no_statements`, `not_storable`, ...) so a caller can branch on it without
> parsing prose.

**The prefix IS the code.** Introducing a `{code, detail}` object on these two
endpoints would put two error shapes in one router, and a client would have to
handle both depending on which endpoint it hit. So:

| Condition | Status | `detail` prefix |
| --- | --- | --- |
| unknown case | 404 | `no_case:` |
| unknown field in `overrides.case` or a segment | 422 | `unknown_field:` |
| unknown segment name | 422 | `unknown_segment:` |
| a narrated field changed without a claim | 422 | `narrative_required:` |
| a claim supplied for an unnarrated field | 422 | `unexpected_narrative:` |
| zero effective changes (§4.1) | 422 | `no_effective_change:` |
| engine refuses the forked case | 422 | `case is not valuable:` — **the engine's own wording, verbatim** |
| `/diff` on a case with no parent | 422 | `no_parent:` |
| more changed inputs than the cap | 422 | `too_many_changed_inputs:` |

Every prefix ends with `: ` followed by a human-readable explanation naming the
offending field, segment, or count.

---

## 5. `GET /api/v1/valuation/cases/{case_id}/diff`

Diffs `case_id` against its parent. The parent is read from `parent_case_id`;
there is no second id in the request, because a diff between two unrelated cases
is not a fork's attribution — it is a comparison of two models, which this
endpoint does not claim to explain.

**A case with `parent_case_id IS NULL` is a 422** stating that it has no parent.
All 30 cases stored today are roots.

Response:

```json
{
  "case_id": 31,
  "parent_case_id": 2,
  "metric": "value_per_share_diluted",
  "parent_value_per_share_diluted": 118.42,
  "case_value_per_share_diluted": 96.10,
  "total_difference": -22.32,
  "method": "shapley",
  "changed_input_count": 3,
  "contributions": [
    { "input": "case.wacc_stable",           "from": 0.074, "to": 0.081, "contribution": -14.80 },
    { "input": "case.terminal_growth",       "from": 0.030, "to": 0.025, "contribution":  -9.02 },
    { "input": "segment.Core.margin_target", "from": 0.280, "to": 0.310, "contribution":   1.50 }
  ]
}
```

### 5.1 The rules that make the number mean something

1. **Conservation.** The invariant, stated once:

   ```
   sum(contributions) == case_value_per_share_diluted - parent_value_per_share_diluted
   ```

   Shapley guarantees this analytically; floating-point arithmetic does not, so
   the contract is a **tolerance, not the word "exactly"**:

   ```python
   math.isclose(sum(contributions), total_difference, rel_tol=1e-7, abs_tol=1e-9)
   ```

   The tolerance is measured, not guessed. Summing 2^k Shapley terms over a
   deliberately nasty nonlinear function at valuation scale (values ≈ 100–250)
   gave a worst absolute residual of **5.9e-11 at k = 8**, growing roughly an
   order of magnitude per added input — so ≈6e-7 at the k = 12 cap. Against
   values of that size `rel_tol=1e-7` dominates and clears the worst case by
   more than an order of magnitude, while remaining far below one ten-thousandth
   of a cent.
2. **No residual and no "other" bucket, ever.** If contributions do not sum
   within tolerance the arithmetic is wrong, and the correct response is a
   failing test — never a balancing row. A residual line is where an unexplained
   gap goes to look explained.
3. **`method` and `changed_input_count` are always present.** A contribution is
   only meaningful with the method that produced it named beside it.
4. **The metric is `value_per_share_diluted`**, named in the response. It is what
   `valuation_verdict`'s `dcf_gap` row already consumes
   (`run_stored_case(case_id)["value_per_share_diluted"]`), so the two agree
   about what "the valuation" is. **Every `contribution` carries that same unit**
   — currency per diluted share — so the column is summable and directly
   comparable to `total_difference`.
5. **`from` and `to` are the persisted parent and child values**, unrounded and
   unformatted. Display rounding belongs to whatever renders them; a spec that
   rounds at the API makes the conservation check in rule 1 fail for reasons
   that have nothing to do with the model.
6. **Contributions are emitted in the canonical order of §2.1**, so the list is
   stable across calls. The values themselves do not depend on any ordering
   (§2.2).

### 5.2 The cap, and why it refuses rather than degrades

Shapley costs 2^*k* engine runs. The cap is a named policy constant, `SHAPLEY_INPUT_CAP = 12`, so the number has
one home and its rationale travels with it: 2^12 = 4096 runs ≈ 16.3 s at the
measured benchmark, which is the edge of a tolerable synchronous request. Above
it the endpoint returns **422 with the count and the cap**:
`too_many_changed_inputs: 17 inputs changed, the attribution cap is 12`.

The cap counts **effective** changes (§4.1), not request keys.

It does **not** fall back to sequential attribution. Two responses with identical
shape, one exact and order-independent and the other neither, cannot be compared
by a reader who does not check `method` — and the whole point of this endpoint is
that the reader can trust the decomposition. Refusing is content; a
silently-different method is not.

---

## 6. Components

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `apps/api/services/case_fork.py` | Apply overrides to a loaded case, validate the override keys and segment names, delegate to `create_case`. | `valuation_case` |
| `packages/core_finance/shapley.py` | Pure: given a base input dict, a changed input dict, and a callable returning a metric, return the exact Shapley contribution per changed key. No knowledge of cases or SQL. | nothing |
| `apps/api/services/case_diff.py` | Enumerate changed inputs between a case and its parent, enforce the cap, call the Shapley module with a runner closure. | `valuation_case`, `shapley` |
| `apps/api/routes/valuation.py` | Two endpoints; translate refusals to 422 with the underlying wording. | the above |

`shapley.py` is deliberately in `packages/core_finance` and knows nothing about
valuation: it takes a `Callable[[dict], float]`. That is what makes it testable
against a linear model whose exact answers can be computed by hand.

---

## 7. Verification

### Hard gates

| Guarantee | Mutation that must break it |
| --- | --- |
| Conservation within tolerance | drop the `k!` weighting from the Shapley sum; the conservation assertion must fail |
| An override equal to the parent is not a change | remove the step-3 discard in §4.1; the unchanged-value fork test must fail |
| Unmentioned fields are preserved | make the fork write defaults instead of copying the parent; the preservation test must fail |
| Attribution is order-independent | replace Shapley with sequential application; the NONLINEAR fixture and the two-orderings test must fail. A linear-only suite would not notice — see §7 |
| Exact on a linear model | change a coefficient in the linear fixture; the hand-computed expectation must fail |
| A fork the engine rejects is refused | remove the `create_case` call path so the fork is inserted directly; the not-valuable test must fail |
| A parentless case cannot be diffed | drop the `parent_case_id IS NULL` check; the 422 test must fail |
| The cap refuses rather than degrades | make the cap fall back to sequential; the refusal test must fail |
| An empty fork is refused | drop the empty-override check; the test must fail |

**The order-independence test is the one that matters.** It runs the same diff
twice with the changed inputs enumerated in opposite orders and asserts the
contributions are identical. Under sequential attribution it fails; under Shapley
it passes. That single test is what distinguishes this feature from a plausible
waterfall.

### Two fixtures, and why one alone is not enough

**The linear fixture proves exactness.** Shapley on `f(x) = 3a + 5b - 2c` must
return exactly `3Δa`, `5Δb`, `-2Δc`, because a linear function's Shapley values
are its marginal effects. Hand-checked, not compared against another
implementation.

**But a linear fixture cannot catch a sequential swap, and this was measured.**
On `f = 3a + 5b - 2c` with a = 1→2, b = 1→3, c = 1→0.5:

| Method | a | b | c |
| --- | --- | --- | --- |
| Shapley | 3.0 | 10.0 | 1.0 |
| Sequential, order a,b,c | 3.0 | 10.0 | 1.0 |
| Sequential, order c,b,a | 3.0 | 10.0 | 1.0 |

**Identical.** On a linear function every method agrees, so a linear-only test
suite would pass unchanged if someone replaced Shapley with sequential
attribution — a cannot-fail assertion for the single property this design
exists to provide.

**The nonlinear fixture is therefore mandatory.** On `f(a, b) = a · b` with
a = 1→3, b = 1→5 (total difference 15 − 1 = 14):

| Method | a | b |
| --- | --- | --- |
| **Shapley** | **6.0** | **8.0** |
| Sequential, order a,b | 2.0 | 12.0 |
| Sequential, order b,a | 10.0 | 4.0 |

Hand-computed: `φ_a = ½[(3·1 − 1·1) + (3·5 − 1·5)] = ½[2 + 10] = 6`, and
`φ_b = ½[(1·5 − 1·1) + (3·5 − 3·1)] = ½[4 + 12] = 8`. Both sum to 14.

This fixture separates the methods, so the "replace Shapley with sequential"
mutation in the gate table fails against it. The linear fixture stays — it pins
exactness — but it is the nonlinear one that proves the feature does what §2
claims.

### Against the real engine

The synthetic fixtures prove the algorithm. One integration test proves it is
wired into MoneyView's actual valuation engine: fork a stored case with one or
two safe overrides, run both, and assert

```
parent_value_per_share_diluted + sum(contributions) ≈ case_value_per_share_diluted
```

to the §5.1 tolerance. Without it the module could be perfect and the wiring
still wrong.

### Fork behaviour, not just its HTTP status

| Test | Asserts |
| --- | --- |
| unchanged-value fork | parent `wacc_stable` 0.074, override sends 0.074 → 422 `no_effective_change:`, and the count of effective changes is 0 |
| preservation | parent (wacc .074, growth .030, margin .280), fork overrides wacc → .081 only. Child must hold wacc .081, growth .030, margin .280, and the diff must contain **exactly one** contribution, `case.wacc_stable` |
| two fields, one segment | overriding `margin_target` and `sales_to_capital_late` on `Core` yields **two** players, not one |
| two segments | one field on each of two segments yields two players with distinct `segment.<name>.` prefixes |
| response ordering | the same diff called twice emits contributions in identical canonical order (§2.1) |

The preservation test is the one that validates the *fork* rather than its
response code: it is the only check that an unmentioned field was carried over
untouched.

### Cost

The suite must not run a 4096-run diff. Tests use ≤ 5 changed inputs (32 runs,
≈ 0.13 s); the cap is tested by asserting the refusal, not by exceeding it.

---

## 8. Out of scope

| Item | Why |
| --- | --- |
| Diffing two unrelated cases | Not a fork's attribution. Would need its own basis disclosure. |
| Attribution on any metric but `value_per_share_diluted` | One metric, named in the response. Others can be added when something consumes them. |
| Caching diff results | §5.1 of the 3b spec defers caching to "when a 10,000-run Monte Carlo makes caching pay". A 32-run diff does not. |
| Segment add/remove | §3. No coherent contribution exists. |
