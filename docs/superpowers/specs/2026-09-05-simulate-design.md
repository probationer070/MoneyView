# `/simulate` — Monte Carlo Over Stated Input Distributions — Design

Date: 2026-09-05
Status: draft, pending review
Scope: the second half of Track C2 (3c), minus `/pricing`. One endpoint,
`POST /api/v1/valuation/cases/{case_id}/simulate`. `/pricing` is a separate
sub-project and is not designed here.

> Every figure below was measured against this repository on 2026-09-05, not
> assumed. Measurements are reproduced inline so a reviewer can disagree with the
> evidence rather than only with the conclusion.

---

## 1. Problem

`/run` returns one number. `/diff` explains the difference between two cases.
Neither says how much that number moves when an assumption is uncertain — and
every input in a segment build-up case is uncertain, which is why each one is
required to carry a narrative claim and a `three_p`.

The existing Monte Carlo code does not close this. `apps/api/routes/monte_carlo.py`
simulates GBM **price paths**, and `apps/web/app/monte-carlo/lib/valuation-core.ts`
is a client-side EPS/PER model in a web worker. The 2026-08-09 design says so
directly: *"Neither is a distribution over DCF inputs."* This is new work, not an
extension of either.

Measured 2026-09-05: 31 stored `valuation_case` rows, so there is something to
simulate against.

---

## 2. The design problem: a distribution is a stronger claim than a number

This repository's spine is that a number does not enter the model without a
stated reason — the narrative rule, `three_p`, the claim requirement on a forked
field. A distribution asserts more than a point estimate: not just a value but a
shape and a spread.

So the distributions are **stated by the caller**, each carrying a claim and a
`three_p`, exactly as a forked assumption does. They are not derived from
`industry_benchmark` dispersion and not defaulted to a ± band.

The rejected alternatives, and why:

| Alternative | Why not |
| --- | --- |
| Derive spread from `industry_benchmark` | Measured 2026-09-05: 94 rows at vintage 2026-01-01. Its `stdev_price` is **price** dispersion across firms, not dispersion of a DCF input. Mapping it onto `wacc_stable` or `margin_target` attaches a basis it has not earned — the defect class `ERROR-LOG.md` records four times. |
| Fixed ± band around the stored value | Honest about being arbitrary, but every reported percentile then inherits an arbitrary width, and a reader treats P10/P90 as if it meant something. |
| Benchmark-derived default the caller may accept | The arbitrary band wearing better clothes: a default accepted unread is not a stated basis. |

---

## 3. Scope

**In:** one endpoint; sampling; the engine per sample; the distribution of
`value_per_share_diluted`; a per-input association ranking; run accounting.

**Out, deliberately:**

| Item | Why |
| --- | --- |
| `/pricing` | Its own sub-project. It also partly re-answers what the C1 verdict panel already shows (`trailing_pe`, `dcf_gap`), so it needs scoping against that panel rather than bolting on here. |
| Persisting a simulation | A stored simulation would be a second kind of case with no narrative rule over it. A simulation is a question asked of a stored case, not a new case. |
| Correlation between inputs | Sampling inputs independently is a stated limitation (§8), not an oversight. Correlated sampling needs a correlation matrix that nothing in this repo can source today. |
| Any UI | `/simulate` is HTTP-only, as `/fork` and `/diff` are. |

---

## 4. Request

The shape deliberately mirrors `/fork`, so one mental model covers both.

```jsonc
{
  "runs": 10000,
  "seed": 42,
  "distributions": {
    "case": {
      "wacc_stable": {
        "shape": "triangular", "low": 0.070, "mode": 0.074, "high": 0.085,
        "claim": "peer cost of capital spans 7.0-8.5%",
        "three_p": "plausible"
      }
    },
    "segments": {
      "Core": {
        "margin_target": {
          "shape": "normal", "mean": 0.28, "sd": 0.03,
          "claim": "services mix reaches 28% +/- 3pp by 2030",
          "three_p": "possible"
        }
      }
    }
  }
}
```

### 4.1 Shapes

Three, and no more in v1:

| `shape` | Parameters | Why it is here |
| --- | --- | --- |
| `triangular` | `low`, `mode`, `high` | The natural form of an elicited range: an analyst states a low, a likely and a high. |
| `normal` | `mean`, `sd` | Symmetric uncertainty around a stored value. |
| `uniform` | `low`, `high` | "Anywhere in this band, no view" — the honest shape for a genuinely unknown input. |

`lognormal` is deliberately absent. Truncation against the engine's bounds (§6)
governs the tails here far more than tail shape does, and a shape nobody has
asked for is a shape nobody has justified.

### 4.2 The narrative rule applies unchanged

Every distribution on a **narrated** field carries `claim` and `three_p`, refused
with `narrative_required:` if absent, exactly as in `case_fork._unwrap`.
`three_p` is never defaulted, for the reason §4.2 of the fork/diff design gives:
it is an epistemic claim about the assumption, and picking one for the caller
asserts a confidence nobody stated. `confidence` may default to `assumed`; a
supplied value is validated.

An unnarrated field (`ramp_start_year`, and the `case.*` columns) takes a
distribution object without `claim`/`three_p`; supplying one is
`unexpected_narrative:`.

### 4.3 `runs` and `seed`

`runs` is bounded to **1,000 – 20,000**, `invalid_runs:` outside it. Measured
2026-09-05 on the four-segment seeded case (`spacex_2026_04_pre_prospectus`),
200 iterations through `run_case_payload`:

```
4-segment seeded:  0.134 ms/run  ->  1,000 = 0.1s   10,000 =  1.3s   20,000 =  2.7s
1-segment fixture: 0.550 ms/run  ->  1,000 = 0.6s   10,000 =  5.5s   20,000 = 11.0s
```

So a 10,000-run simulation fits inside a synchronous request. **No job queue, no
polling, no new infrastructure.**

The one-segment fixture is **4x slower** than the four-segment seeded case, which
is worth flagging because it is counter-intuitive and I have not explained it.
Both have a 10-year horizon (2026->2036 and 2025->2035, measured), so neither
segment count nor horizon accounts for the gap; the likely candidate is the
revenue-path solver taking more iterations on one shape than the other, but that
is a guess and is recorded here as one. The design does not depend on the cause:
it needs an upper bound, and **0.550 ms/run is the bound to size against**.
A plan that quotes a faster figure should re-measure on its own fixture first.

Below 1,000 runs the P10/P90 are noise. The ceiling is **20,000, derived from the
SLOW bound**: 11.0s at 0.550 ms/run, 2.7s at 0.134. Deriving it from the fast
figure would have allowed 50,000, which is 6.7s on the seeded case but **27.5s on
the fixture** — a request that times out on the very case a first-time caller is
most likely to have built by hand. A caller who needs more runs than this needs
an async endpoint, which is out of scope.

`seed` is optional. **The response always reports the seed used**, generated when
absent. A simulation nobody can reproduce cannot be reviewed, and this repository
reviews numbers.

### 4.4 There is no input cap, and that is deliberate

`/diff` refuses above `SHAPLEY_INPUT_CAP = 12` because its cost is `2^k`.
Monte Carlo cost is **linear in `runs` and flat in the number of inputs**, so an
input cap here would be cargo-culted from a constraint that does not apply.
`runs` is bounded instead. This paragraph exists because the first reader will
ask why the two endpoints differ.

---

## 5. Sampling and determinism

One `numpy.random.Generator` seeded from `seed`. Inputs are sampled
**independently** (§8 records the limitation). Each draw produces one complete
override map — the same canonical keys `/diff` uses, `case.<field>` and
`segment.<name>.<column>` — which is handed to the existing
`valuation_case.run_case_payload`. No new engine code.

Canonical keys are parsed with `rsplit`, never `split`: a segment **name** may
contain dots (`conservative_case` names a segment `ticker.lower()`, and this repo
ships `.KS` tickers), a column name may not. That defect is already recorded in
`ERROR-LOG.md`.

---

## 6. Refused samples: the design's hardest problem

Random draws **will** produce input combinations the engine refuses. This is not
an edge case: the engine's guards are exactly the region a distribution's tail
reaches. `roic_stable` sampled below `wacc_stable` with positive terminal growth,
a non-positive terminal spread, a target revenue ratio unreachable over the
horizon — all are one draw away from a legitimate stored case.

`/diff` solved its version of this by refusing the whole request
(`unrunnable_coalition:`), because its 2^k coalitions are *enumerated* and a
single unrunnable one makes the attribution incomputable. **That solution cannot
be transplanted here.** Refusing a whole 10,000-run simulation because one draw
in the tail was invalid would make the endpoint unusable, and would refuse most
loudly exactly when the caller's stated spread is widest — which is when they
most need the answer.

### 6.1 What dropping a sample actually does

It does **not** bias an estimate of the same quantity. It changes *which quantity
is estimated*: from the distribution of `value_per_share_diluted` under the
caller's stated distributions, to that distribution **conditional on the engine
accepting the inputs**.

That distinction is the whole of this section. A reader told "these percentiles
may be biased" learns only to be vaguely worried. A reader told "these are
conditional on the engine accepting the inputs" can decide whether that
conditioning is acceptable for their question — and often it is, because the
refused region is genuinely not a case anyone would hold.

### 6.2 The accounting

Every sample is run. A refused sample:

- counts toward `runs_requested`
- counts toward `runs_refused`
- retains the engine's refusal reason, grouped (§6.4)
- contributes **no** `value_per_share_diluted` observation

`runs_valid + runs_refused == runs_requested` is an asserted invariant. That
identity is what makes silent dropping impossible to hide.

### 6.3 The suppression threshold

```
refused_fraction = runs_refused / runs_requested
```

**If `refused_fraction >= 0.10`, the response omits `p10`, `p50`, `p90`, `mean`,
`histogram` and `association_among_accepted_samples`.** Omits — the keys are absent. Not `null`, not
`0`, not an empty list. A refusal is content, not a zero wearing a value's
clothes; that rule is C1's and it holds here.

What survives is the run accounting and the refusal groups, so a suppressed
response still answers *why*, not merely *no*:

```jsonc
{
  "case_id": 7,
  "runs_requested": 10000, "runs_valid": 8600, "runs_refused": 1400,
  "refused_fraction": 0.14,
  "seed": 42,
  "suppressed": "refused_fraction 0.14 >= 0.10: the surviving sample describes
    the distribution of value_per_share_diluted CONDITIONAL on the engine
    accepting the inputs, not the distribution the stated inputs describe",
  "refusals": [
    {"code": "terminal_spread_not_positive", "count": 1310,
     "message": "terminal spread is not positive: wacc 3.0000% must exceed growth 3.0000%"},
    {"code": "roic_below_wacc", "count": 90,
     "message": "roic_stable 6.0000% must exceed wacc_stable 7.4000% when terminal growth is positive"}
  ]
}
```

10% rather than some other number: below it, the conditioning moves the reported
percentiles by less than the sampling noise at 10,000 runs; above it, the
surviving sample is describing a visibly different question. The threshold is a
named constant, `REFUSED_FRACTION_CAP = 0.10`, so it has one home.

**A suppressed response is a 200, not an error.** Nothing failed: the simulation
ran, and its result is that the question cannot be answered from this sample.
That is an answer.

### 6.4 Refusal codes: a stable key beside the engine's own words

`/fork` passes the engine's refusal through **verbatim**, because the engine owns
that wording. Grouping is different: a client keying a histogram off
`"terminal spread is not positive: wacc 3.0000% must exceed growth 3.0000%"`
breaks the moment anyone reformats a percentage.

So each group carries **both**: a stable `code` to branch on, and the engine's
verbatim `message` (first occurrence in the group) to read.

The codes are derived by enumerating the engine's `raise ValueError` sites, not
invented. The sampling-reachable families, read out of
`packages/core_finance/segment_valuation.py` and `dcf.py` on 2026-09-05:

| `code` | Engine condition |
| --- | --- |
| `terminal_spread_not_positive` | `segment_valuation.py:853` — wacc must exceed terminal growth |
| `roic_below_wacc` | `:878` — `roic_stable` must exceed `wacc_stable` with positive growth |
| `terminal_growth_above_riskfree` | terminal growth capped at the riskfree rate |
| `target_revenue_unreachable` | target ratio unreachable over the horizon |
| `non_positive_rate` | `wacc_initial`, `roic_stable`, `sales_to_capital_*`, `shares_basic` |
| `rate_out_of_unit_interval` | `marginal_tax_rate`, `effective_tax_rate` outside [0, 1] |
| `negative_balance` | `nol_balance`, `cash`, `debt` |
| `horizon_incoherent` | `ramp_start_year`, `wacc_converge_from` against the horizon |
| `other` | anything unmatched, carrying the verbatim message |

**Completeness is tested, not assumed.** A test drives each condition above
through `run_case_payload` and asserts that none of them lands in `other`. That
makes the table's completeness observable; without it, an engine message
reworded next month would silently degrade every group to `other` and no test
would notice.

If `other` starts appearing in practice, the fix is typed refusals in
`core_finance` — the move `DuplicateCaseName` made in the fork/diff work — not a
larger regex table. The spec says so here so it is a decision on record rather
than folklore.

---

## 7. Response, unsuppressed

```jsonc
{
  "case_id": 7,
  "metric": "value_per_share_diluted",
  "runs_requested": 10000, "runs_valid": 9880, "runs_refused": 120,
  "refused_fraction": 0.012,
  "seed": 42,
  "p10": 38.4, "p50": 49.9, "p90": 64.2, "mean": 50.6,
  "histogram": [{"lower": 30.0, "upper": 32.5, "count": 41}, "..."],
  "association_among_accepted_samples": [
    {"input": "case.wacc_stable", "spearman": -0.81},
    {"input": "segment.Core.margin_target", "spearman": 0.44}
  ],
  "refusals": [{"code": "roic_below_wacc", "count": 120, "message": "..."}]
}
```

### 7.1 The ranking is an association, not a contribution

Spearman rank correlation between each sampled input and the sampled output,
computed from the accepted samples at **zero extra engine cost**.

It is deliberately **not** called a contribution. `/diff`'s contributions are
exact Shapley values, in per-share units, that sum to a difference. These are
unitless, sum to nothing, and describe monotonic association. Two differently
computed numbers under one word is the confusion this repository has recorded
repeatedly; a different basis gets a different word.

The field is named `association_among_accepted_samples` rather than
`association`, so the conditioning of §6.1 travels with the number into whatever
spreadsheet it is pasted into, and does not live only in prose the reader may not
have kept.

Spearman rather than Pearson because the engine is nonlinear and monotonic: a
Pearson coefficient understates a strong but curved relationship, and would rank
a strongly nonlinear driver below a weakly linear one.

---

## 8. Stated limitations

Recorded because a reader deserves them stated rather than discovered:

- **Inputs are sampled independently.** Real assumptions covary — a higher
  `wacc_stable` usually accompanies a higher `riskfree_rate`. Independent
  sampling therefore explores combinations no analyst would hold, and some of
  those land in the refused region (§6). Correlated sampling needs a correlation
  matrix nothing in this repo can source today.
- **Percentiles are conditional on acceptance** whenever `runs_refused > 0`, not
  only above the threshold. The threshold is where the conditioning becomes large
  enough to suppress; below it the response still reports `refused_fraction` so
  the reader can see the conditioning exists.
- **The association ranking is univariate.** It says which input moves with the
  output, not which input's uncertainty is worth reducing.

---

## 9. Error contract

The existing convention, unchanged: the prefix before the first `: ` **is** the
code, and there is no `{code, detail}` envelope. New prefixes are marked.

| Condition | Status | `detail` prefix |
| --- | --- | --- |
| unknown case | 404 | `no_case:` |
| unknown field in `distributions.case` or a segment | 422 | `unknown_field:` |
| unknown segment name | 422 | `unknown_segment:` |
| a narrated field's distribution without a claim or `three_p` | 422 | `narrative_required:` |
| a claim on an unnarrated field | 422 | `unexpected_narrative:` |
| a `shape` that is not one of the three | 422 | `unknown_shape:` **(new)** |
| a shape's parameters missing or incoherent (`low >= high`, `sd <= 0`, `mode` outside `[low, high]`) | 422 | `invalid_distribution:` **(new)** |
| `runs` outside 1,000–20,000 | 422 | `invalid_runs:` **(new)** |
| no distributions supplied | 422 | `no_distributions:` **(new)** |

**A refused sample never reaches this table.** A bad draw is data about the
model, not a failed request. Request validation fails the request; sampling
refusals are counted and reported inside a 200.

---

## 10. Testing

A fixed `seed` makes the whole endpoint exactly assertable, which is the point of
requiring it in the response.

Mutations that must break a named test:

| Guarantee | Mutation that must break it |
| --- | --- |
| Percentiles are percentiles | return the mean where `p50` is asked for |
| The run is reproducible | drop `seed` from the response, or reseed per sample |
| Refused samples are accounted, not dropped | exclude refused samples from `runs_requested` |
| The invariant holds | make `runs_valid + runs_refused != runs_requested` |
| Suppression fires at the threshold | change `>=` to `>` and simulate at exactly 0.10 |
| Suppression omits, never zeroes | emit `p50: null` instead of omitting the key |
| The association is Spearman | compute Pearson, against a monotonic nonlinear fixture where the two differ |
| Codes are stable and complete | reword one engine message and assert its group does not fall to `other` |
| Sampling is seeded once | reseed the generator inside the sample loop |

The Spearman-vs-Pearson mutation needs a **monotonic but strongly nonlinear**
fixture, for the same reason the Shapley work needed a nonlinear one: on a linear
fixture the two coefficients agree, and the test would be a cannot-fail assertion
for the exact property the choice exists to guarantee. That trap has already been
recorded twice in this repository; this is its third appearance and it is
designed against rather than rediscovered.

---

## 11. Out of scope

| Item | Why |
| --- | --- |
| `/pricing` | Its own sub-project; overlaps the C1 verdict panel and needs scoping against it. |
| Correlated input sampling | §8. Needs a correlation matrix nothing sources today. |
| Storing or naming a simulation | §3. A simulation is a question, not a case. |
| A UI | HTTP-only, as `/fork` and `/diff` are. C2 stays open until one exists. |
