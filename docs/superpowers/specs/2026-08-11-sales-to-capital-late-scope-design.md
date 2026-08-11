# Sales-to-Capital: Restoring the Source's Scope — Design

Date: 2026-08-11
Status: draft, pending review
Trigger: investigating why the model produces the pre/post enterprise-value direction
opposite to the source.
Branch: `feat-statements-acquisition` (updates PR #4 in place).

---

## 1. What was being investigated, and what was found instead

The model produces enterprise value **falling** from the pre-prospectus case to the
post-prospectus case (1323.37 → 1309.85). `guideline/sop/todo3.md` §3 records it
**rising** slightly ($1.21T → $1.22T). The investigation asked whether an input was
wrong in a way that explained the sign.

### 1.1 The direction cannot be fixed without contradicting the source

An input-by-input attribution from the pre case to the post case, each change applied
alone:

| change | ΔEV |
| --- | --- |
| ai revenue target 80 → 160 | **+286.49** |
| ai margin 0.45 → 0.25 | **−148.78** |
| riskfree 4.20% → 4.56% | +118.14 |
| wacc → post values | −113.78 |
| launch margin 0.40 → 0.45 | +33.77 |
| sales-to-capital → post values | −21.59 |
| *sum of individual effects* | *+154.25* |
| **actual pre → post** | **−13.52** |

The individual effects sum to +154 while the actual move is −13.5, so interactions
account for −168. The dominant interaction is todo3 §3's own "offsetting changes"
finding: doubling AI's revenue target while halving its margin leaves target-year AI
EBIT nearly unchanged (36 → 40) — but roughly **doubles the capital** required to
reach it from a 0.1 base, and that does not cancel.

The sign itself turns on one input. Holding the post case fixed and sweeping the
pre-case sales-to-capital ratios as a multiple of the post values:

| pre s2c ÷ post s2c | post − pre |
| --- | --- |
| 1.00 (no lowering at all) | **+8.07** |
| 1.03 | +3.64 |
| 1.05 | +0.83 |
| **1.067 (as seeded)** | **−13.5** |
| 1.10 | −5.74 |

The sign flips at roughly a **6% lowering**. todo3 I2 confirms — tagged `[C]` — that
he *did* lower sales-to-capital. **Any lowering consistent with that confirmed
statement produces a falling enterprise value.** Reproducing the source's +10 requires
a multiple near 0.97, i.e. that he *raised* it, contradicting the one thing the source
confirms about this input.

So todo3's confirmed input and todo3's reported outcome are **mutually inconsistent
under this template**. That is a finding about the reconstruction, not a defect to
repair.

### 1.2 Why chasing the sign would be meaningless anyway

The source's own move is **+0.8%** (1210 → 1220). The sales-to-capital sweep above
spans 22 points of enterprise value on its own, and every `[V]` input carries
comparable or larger uncertainty. **No reconstruction at this fidelity can
meaningfully reproduce the sign of a 0.8% move.** Selecting an unconstrained input to
land on the right side of zero would be fitting — the same failure the terminal-ROIC
remediation corrected in `2026-08-10-terminal-roic-consistency-design.md`.

Two hypotheses were tested and rejected on the way:

- **AI's base revenue.** Raising it (holding the corroborated 15.6 total) makes the
  gap *worse*, −13.5 → −26.8 at a base of 3.0, because base revenue moved into the
  low-return segment comes out of the high-return ones, and the post case has more AI.
- **A different terminal-ROIC policy.** Already tested during the prior remediation: a
  per-case policy gave a pre/post ratio of 0.908 against a shared value's 0.978. The
  shared value is already the better choice for this metric; there is no room in that
  direction.

### 1.3 The real defect the investigation surfaced

`todo3.md:82` (formula I2, tagged **`[C]`**) reads:

> In S2 he **lowered** sales-to-capital for **yrs 1–5** (launch + connectivity) after
> seeing actual capex, and again for AI.

§3 repeats the restriction in its per-segment rows: "Sales-to-capital **yrs 1–5** —
lowered" for launch (line 121) and for connectivity (line 126). AI's row (line 129)
carries **no year restriction** — "already low → lower still".

The seed lowers **both** ratios for launch and connectivity:

| segment | pre early → post early | pre late → post late | supported? |
| --- | --- | --- | --- |
| launch | 1.5 → 1.0 | 1.6 → 1.5 | early yes (`[C]`); **late no** |
| connectivity | 1.5 → 1.0 | 1.6 → 1.5 | early yes (`[C]`); **late no** |
| ai | 0.8 → 0.6 | 1.05 → 1.0 | both yes — no year restriction |
| expansion | 1.0 → 1.0 | 1.5 → 1.5 | unchanged, per §3's `[V]` "assumed unchanged" |

The late-ratio lowering for launch and connectivity is an invention beyond what the
source claims. It is not cosmetic: `marginal_roic` — the anchor for the entire
terminal block and the guard that bounds `roic_stable` — reads
`sales_to_capital_late` **only**.

---

## 2. Design

### 2.1 The correction

Set the pre-prospectus `sales_to_capital_late` for **launch** and **connectivity** to
`1.5`, matching the post case. Leave everything else alone:

- **AI's late ratio stays 1.05 → 1.0.** todo3 line 129 places no year restriction on
  AI, so lowering its late ratio is supported.
- **Early ratios are untouched.** Pre `1.5 / 1.5 / 0.8` against post `1.0 / 1.0 / 0.6`
  is the confirmed years-1–5 lowering and must remain.
- **Expansion stays 1.5 in both**, per §3's "assumed unchanged".

After this the two cases differ in `sales_to_capital_late` **only for AI** — exactly
what the source confirms.

### 2.2 Narrative text

The pre-case `sales_to_capital_late` claims for launch and connectivity must state
that the ratio is unchanged from the post case *because* todo3 I2 restricts the
confirmed lowering to years 1–5, and that the level itself remains a guess.

Tags stay `confidence='assumed'`, `three_p='plausible'`. The source answers *whether*
this ratio was lowered; it still says nothing about *what level* it takes. Promoting
the tag would repeat the overclaim corrected in the `initial_growth` retagging.

### 2.3 Recording the incompatibility

`guideline/sop/todo.md` currently carries a "pre/post EV direction" divergence entry
saying only that the model disagrees with the source. Replace it with §1.1 and §1.2's
quantitative version: the sign flips at ~6% lowering; any lowering consistent with
`[C]` yields a falling EV; reproducing +10 requires a *raising*; and the source's own
move is +0.8%, smaller than the uncertainty on any single `[V]` input.

That converts an unfalsifiable "we disagree" into a checkable statement about why, and
records that the direction is **not** a defect awaiting repair.

### 2.4 Measured effects

| | before | after |
| --- | --- | --- |
| pre EV | 1323.37 | **1320.79** |
| post EV | 1309.85 | 1309.85 (unchanged) |
| gap (post − pre) | −13.52 | **−10.94** |
| pre `marginal_roic` | 0.4961 | **0.4795** |

Pre's implied capital-intensity change against `roic_stable = 0.33` becomes
`0.4795 / 0.33 − 1 = +45.3%`, comfortably inside the engine's 60% tolerance, so the
two-sided guard still admits the case with margin to spare.

**The sign does not flip, and this design does not try to flip it.** The deliverable
is an invented assumption removed and an incompatibility stated precisely.

---

## 3. Verification

**Gated:**

1. Pre and post `sales_to_capital_late` are **equal** for launch and connectivity in
   the seeded cases. Docstring cites `todo3.md:82` — the confirmed lowering covers
   years 1–5 only.
2. Pre and post `sales_to_capital_early` **differ** for launch, connectivity and ai.
   The confirmed years-1–5 lowering must still be present; a correction that removed
   it as well would be a different error.
3. AI's `sales_to_capital_late` still differs between the cases (1.05 pre, 1.0 post) —
   todo3 places no year restriction on that segment.
4. Pre `marginal_roic` equals **0.4795** (±1e-4), hand-computable from the new ratios.
5. Both cases still run: `roic_stable = 0.33` remains inside the capital-intensity
   tolerance for each.
6. Seeded target-year totals unmoved: **400.0 / 158.5** post, **320.0 / 151.0** pre.
   Sales-to-capital affects reinvestment, never the revenue or margin paths.
7. Post EV unchanged at 1309.85 — this touches the pre case only.
8. The narrative rule still passes: every stated input carries a claim.

**Recorded, not gated:** the new pre EV and the pre/post gap.

---

## 4. Out of scope

**The pre/post direction itself.** §1.1 establishes it cannot be corrected within the
source's confirmed constraints, and §1.2 that doing so would be meaningless at this
fidelity. It stays recorded.

**Everything else already deferred**, unchanged: `base_margin`'s R&D-basis
contradiction; case-level narratives, so `roic_stable` still states no reason; the
consolidated path's non-monotonicity at the expansion ramp and its year-10 growth of
~7% rather than `g_stable`; and API update/delete endpoints.
