# Fork and Diff — Attributing a Valuation Difference — Design

Date: 2026-09-04
Status: draft, pending review
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

That column exists today and is `NULL` on all 30 stored cases.

### 1.1 There is now something to fork

30 `valuation_case` rows exist as of 2026-09-04 — the conservative cases
generated after Track A1 loaded the Damodaran vintage. Before today there were
zero. The feature has real parents to fork from rather than a fixture.

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
order-independent. At 3.98 ms per run: 8 changed inputs ≈ 1.0 s, 10 ≈ 4.1 s,
12 ≈ 16.3 s. A realistic fork changes a handful of assumptions, not thirty.

The cost is exponential, so §5 sets a cap and **refuses beyond it** rather than
degrading to a cheaper method.

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

**An empty override set is refused.** A fork that changes nothing produces a case
identical to its parent, and a diff of it would be an all-zero waterfall
presented as if it meant something.

### 4.1 The runnability gate applies unchanged

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
  "parent_value": 118.42,
  "case_value": 96.10,
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

1. **Contributions sum to `total_difference`, exactly.** Shapley guarantees it.
   Asserted to floating tolerance by a test, not assumed.
2. **There is no residual and no "other" bucket.** If contributions do not sum,
   the arithmetic is wrong — the correct response is a failing test, not a
   balancing row. A residual line is where an unexplained gap goes to look
   explained.
3. **`method` and `changed_input_count` are always present.** A contribution is
   only meaningful with the method that produced it named beside it.
4. **The metric is `value_per_share_diluted`**, named in the response. It is what
   `valuation_verdict`'s `dcf_gap` row already consumes
   (`run_stored_case(case_id)["value_per_share_diluted"]`), so the two agree
   about what "the valuation" is.

### 5.2 The cap, and why it refuses rather than degrades

Shapley costs 2^*k* engine runs. Above **12 changed inputs** (4096 runs ≈ 16.3 s)
the endpoint returns **422 with the count and the cap**, e.g.
`too_many_changed_inputs: 17 inputs changed, the attribution cap is 12`.

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
| Contributions sum to the total difference | drop the `k!` weighting from the Shapley sum; the sum-to-total assertion must fail |
| Attribution is order-independent | replace Shapley with sequential application; the two-orderings test must produce different numbers and fail |
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

### The linear fixture

Shapley on `f(x) = 3a + 5b - 2c` must return exactly `3Δa`, `5Δb`, `-2Δc`,
because a linear function's Shapley values are its marginal effects. Hand-checked
values, not a self-comparison against another implementation.

### Cost

The suite must not run a 4096-run diff. Tests use ≤ 5 changed inputs (32 runs,
≈ 0.13 s); the cap itself is tested by asserting the refusal, not by exceeding it.

---

## 8. Out of scope

| Item | Why |
| --- | --- |
| Diffing two unrelated cases | Not a fork's attribution. Would need its own basis disclosure. |
| Attribution on any metric but `value_per_share_diluted` | One metric, named in the response. Others can be added when something consumes them. |
| Caching diff results | §5.1 of the 3b spec defers caching to "when a 10,000-run Monte Carlo makes caching pay". A 32-run diff does not. |
| Segment add/remove | §3. No coherent contribution exists. |
