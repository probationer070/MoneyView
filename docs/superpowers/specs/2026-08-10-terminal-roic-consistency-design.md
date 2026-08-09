# Terminal ROIC Consistency — Design

Date: 2026-08-10
Status: draft, pending review
Supersedes: parts of `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md` — §1.2's
reasoning about the enterprise-value gap, and §6's recorded diagnostic figures.
Trigger: independent adversarial review of the shipped 3a/3b code.

---

## 1. Problem

The segment build-up engine shipped with `roic_stable` as an unconstrained input.
Nothing in the code relates it to the capital economics the explicit forecast
period assumes, and nothing reports the divergence. The seeded value, `0.12`, was
invented — it appears nowhere in `guideline/sop/todo3.md`.

The model's own assumptions imply a target-year return on new capital of **40.8%**
(revenue-weighted `sales_to_capital_late × margin_target × (1 − τ)`). Setting the
perpetuity's return to 12% means the reinvestment rate **more than doubles** at the
year-10 boundary — from 17.5% of NOPAT to 38.0% — while growth *falls* from 7.46%
to 4.56%. Reinvestment rising as growth falls is backwards, and it is the signature
of a terminal block that has lost contact with the explicit block.

Sensitivity of the post-prospectus case to this one input:

| `roic_stable` | EV | Equity | $/share |
| --- | --- | --- | --- |
| 0.0925 (WACC + 1pp) | 745.3 | — | 62.80 |
| **0.12 (shipped)** | **916.2** | **993.0** | **75.86** |
| 0.25 | 1215.2 | 1292.0 | 98.69 |
| 0.408 (model's marginal ROIC) | 1322.0 | — | 106.85 |
| *Damodaran* | *1220* | *1297* | *~100* |

### 1.1 The reasoning this corrects

The 2026-08-09 spec §1.2 argued that the enterprise-value gap could not serve as
evidence because "a model with a dozen free parameters can be tuned to $1.22T while
being structurally wrong." That argument was used to justify not investigating a 25%
miss, a **negative** explicit-period present value, and a terminal-value share above
100% — three signals that were all visible in the output.

It is falsifiable, and false. Holding `roic_stable = 0.12` and setting every `[V]`
input to its most value-favourable extreme — zero reinvestment **and** zero tax for
all ten years — reaches EV 1186.6, still short of 1220. The uncalibrated inputs are
bounded, and the bound does not reach. The gap was never attributable to them.

The general lesson, worth carrying: *"too many free parameters to test" is a claim
about a model, and it can be checked by bounding the parameters rather than asserted.*
An unbounded dial that no test, guard, or diagnostic touches is not an accepted
limitation; it is an untested assumption.

### 1.2 Why this was invisible to three review rounds

Every prior review compared the code against the design documents that produced it.
This defect was *in* those documents — the 2026-08-09 spec §4.2 argues explicitly
that deriving `roic_stable` from the model "would make terminal value a function of
the `[V]` sales-to-capital guesses, which is exactly the coupling to avoid."

That reasoning is backwards. todo3's F6 (`ReinvRate = g / ROIC_stable`) exists
precisely to couple the perpetuity to the explicit period. Implementing F6 while
omitting I3 — the formula that derives ROIC from the model — converts the one
mechanism whose purpose is internal consistency into a free parameter.

---

## 2. Design

### 2.1 Marginal ROIC, not level ROIC

todo3 I3 states `ROIC_t = EBIT_t(1−τ) / InvestedCapital_t` with
`InvestedCapital_t = IC_{t−1} + Reinvestment_t`. That needs an invested-capital base
`IC_0` which `valuation_case` does not carry and todo3 supplies only as a book-equity
figure tagged as a guess.

This design implements the **marginal** return instead:

```
marginal_roic = Σ_i ( s2c_late_i × margin_target_i × (1 − τ) × revenue_i,n ) / Σ_i revenue_i,n
```

Rationale: the terminal reinvestment rate governs *new* capital, so the consistency
check belongs on the return that new capital earns. Level ROIC blends in legacy
capital that no longer drives growth. This satisfies I3's purpose without inventing
an `IC_0`, and it is a deliberate deviation from I3's literal form.

### 2.2 The guard

`run_case` raises `ValueError` when `roic_stable > marginal_roic_target_year`.

A perpetual return above what the explicit period earns on new capital is competitive
erosion running backwards. The model's margin path has already converged to
`margin_target` by year n, so no further improvement is even represented — a higher
terminal return has nothing to come from.

It lives in `run_case` rather than `terminal_value` because it needs segment data.

**Not added:** a `g_stable / roic_stable > 1` guard. The existing
`roic_stable > wacc_stable` requirement, combined with the existing
`wacc_stable > g_stable` spread requirement, already forces the terminal reinvestment
rate below 1 whenever growth is positive. It would be dead code.

The guard is deliberately one-sided. A terminal return *below* the marginal return is
legitimate and expected — it is what competitive erosion means. Only the reverse is
unambiguously wrong.

### 2.3 Reported diagnostics

`CaseResult` gains three fields, surfaced through `/run`:

| Field | Meaning |
| --- | --- |
| `marginal_roic_target_year` | §2.1's revenue-weighted return on new capital |
| `terminal_reinvestment_rate` | `g_stable / roic_stable` |
| `explicit_reinvestment_rate_target_year` | `reinvestment[n] / (EBIT[n] × (1 − τ))` |

The last two side by side make the discontinuity legible: 17.5% → 38.0% in the
shipped post-prospectus case. A reader can see the terminal block disagreeing with
the explicit block without recomputing anything.

### 2.4 Input guards for silently-wrong numbers

Four inputs are currently accepted and mis-handled rather than rejected. All produce
a plausible-looking wrong valuation, which is the worst failure mode this engine has.

| Input | Current behaviour | Fix |
| --- | --- | --- |
| `nol_balance < 0` | `min(balance, amount)` goes negative and is added to the taxable base: `tax_path([10,10,10], 0.25, -20)` → 12.5 of tax on 30 of EBIT, a 41.7% effective rate against a 25% marginal | raise in `CaseSpec.__post_init__` |
| `marginal_tax_rate` outside [0,1] | a percent/decimal slip (`25.0`) returns EV = −36,092.8 silently | raise in `CaseSpec.__post_init__` |
| `ramp_start_year < 1` | `lead = -1` → `[0.0] * -1 == []` and `steps = n+1`, producing an 11-element revenue list against a 10-element margin list; `zip` truncates and target-year revenue lands at 395.45 instead of 400.00 | raise in new `SegmentSpec.__post_init__` |
| `sales_to_capital_* <= 0` | checked lazily inside `reinvestment`'s loop, so a segment with `ramp_start_year=7` never validates its early ratio | raise in new `SegmentSpec.__post_init__` |

Moving the `sales_to_capital` check to construction makes `reinvestment`'s in-loop
check unreachable, so it is removed rather than left as dead defence. `SegmentSpec`
is frozen, so construction-time validation cannot be bypassed by mutation.

`CaseSpec.__post_init__` already exists and validates `terminal_growth`,
`shares_basic` and the year ordering; these are additions to it.

### 2.5 Seeding rule

`roic_stable` is seeded by an explicit stated rule rather than a fitted value:

```
roic_stable = (wacc_stable + marginal_roic) / 2
```

"Half the excess return competes away in perpetuity." Chosen on its own logic, not by
matching a published number.

| Case | marginal ROIC | seeded `roic_stable` | EV | published |
| --- | --- | --- | --- | --- |
| pre-prospectus | 0.623 | **0.351** | 1333.2 | 1210 |
| post-prospectus | 0.408 | **0.245** | **1210.0** | **1220** |

The post case lands within 0.8% of Damodaran's figure. Because the rule was chosen
for its own reasons, that agreement is corroboration rather than curve-fitting — the
evidential value the 2026-08-09 spec wrongly claimed was unobtainable.

The pre case overshoots by 10%. That difference traces to one identifiable input: the
pre-case `sales_to_capital_late` values (2.0 for launch and connectivity, against 1.5
post) are `[V]` guesses invented to reflect todo3 §3's statement that Damodaran
*lowered* sales-to-capital after the prospectus. Higher sales-to-capital means less
capital per dollar of revenue, hence a higher marginal return, hence a higher
midpoint. **A disagreement that points at a specific guessed input is the diagnostic
behaviour this feature was supposed to have.**

Values are written as literals in the seed with the derivation in the claim text, not
computed at seed time — a seed that recomputes its own inputs cannot be checked
against anything.

### 2.6 Amendments to the prior spec

`docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md` currently
states reasoning this document falsifies, and figures this change invalidates. Leaving
it is the stale-doc failure that repo already has a commit history of fixing.

| Section | Change |
| --- | --- |
| §1.2 | The "dozen free parameters, so agreement proves nothing" argument must be corrected, not deleted. It is right that *agreement* alone proves little; it was wrong to conclude the gap carried no information. Add the bounding test and its result. |
| §4.2 | The claim that deriving `roic_stable` from the model is "exactly the coupling to avoid" is backwards and must be reversed, pointing at this document. |
| §6 | The recorded diagnostic figures change from EV 916.2 / $75.86 / TV share 102.4% to the §2.5 values. |
| §7 (out of scope) | Note that the terminal-consistency work is now done and where. |

---

## 3. Verification

**Gated:**

1. `marginal_roic_target_year == 0.408` (±0.001) for the post-prospectus case and
   `0.623` for the pre case, both hand-computed from `s2c_late × margin × (1−τ)`
   weighted by target-year revenue.
2. `roic_stable > marginal_roic_target_year` raises, with a message naming both values.
3. A terminal return *below* marginal does **not** raise — the guard is one-sided.
4. Each of §2.4's four inputs raises at construction, asserting on the message.
5. `terminal_reinvestment_rate == g_stable / roic_stable` and
   `explicit_reinvestment_rate_target_year == reinvestment[-1] / (ebit[-1] × (1−τ))`.
6. Both seeded cases still reproduce their confirmed target-year totals — 400.0/158.5
   post, 320.0/151.0 pre. These are unaffected by `roic_stable` and must not move.
7. The full suite still passes. Baseline before this work: 585.

**Recorded, not gated:** the post-prospectus EV of 1210.0 against Damodaran's 1220,
and the pre-prospectus 1333.2 against 1210 with §2.5's explanation. Recorded in this
document, not computed by `/run` — the 2026-08-09 spec §6 establishes why
company-specific constants do not belong in a generic engine.

---

## 4. Out of scope

**Case-level narratives.** `segment_narrative` covers segment fields only, so
`roic_stable` — the single most valuable input in the model — cannot carry a claim in
the data. This is the structural form of the defect this document fixes: the
narrative discipline was applied where it was easy rather than where the value
concentrates. It deserves its own pass.

**Base-year off-by-one.** The seed labels its revenues FY2025 while setting
`base_year=2026`, making the horizon 10 where the figures imply 11. Overstates EV by
roughly 6%. Real, and independent of this fix.

**Growth-path shape.** The decaying curve makes year 1 always the fastest year:
launch grows 63.8% in year 1 against todo3 §4's confirmed 2025 actual of 7.64%.
todo3 R3 tags the shape change `[C]` and S2's headline revision was *slowed* near-term
growth, which this engine structurally cannot express. Needs a second curve.

**API lifecycle.** No update or delete endpoint; structural validation fires at `/run`
rather than at `POST`; horizon is unbounded. From the same review, separately scoped.
