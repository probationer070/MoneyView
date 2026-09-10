# The Terminal State Engine — Design

Date: 2026-09-10
Status: draft, pending review
Scope: how terminal value assumptions are derived. Touches
`corporate_metrics_service.valuation_params_from_metrics`, the DCF report schema, and
the comparison surfaces that display a valuation. No change to the DCF arithmetic itself.

> Every figure below was measured against this repository on 2026-09-10 and the
> measurement is named, so a reviewer can disagree with the evidence rather than only
> with the conclusion. Where a thing was **not** measurable, this document says so
> instead of estimating it.

---

## 1. Problem

`apps/api/services/corporate_metrics_service.py:505`:

```python
terminal_growth_rate = min(growth_rate, wacc - 0.005)
```

Gordon growth is `TV = FCFF x (1 + g) / (WACC - g)`, so the entire terminal value turns
on the spread `WACC - g`. This clamp prevents the **mathematical** failure — at
`g >= WACC` the denominator is zero or negative — and expresses no opinion about whether
`g` is a rate any company could sustain in perpetuity.

Two consequences, both measured.

**The visible one.** `ValuationAssumptions.terminal_growth_rate` is bounded `le=0.1`
(`apps/api/models/schema_parts/corporate.py:51`). The derived rate exceeds it for **9 of
the first 40 watchlist tickers**, which raise a `ValidationError` and cannot be valued at
all: ASM 0.1415, AMD 0.1364, ANET 0.1334, ARIS 0.1254, AXP 0.1055.

**The larger one, which is silent.** Because the clamp pins `g` at exactly
`WACC - 0.005` whenever company growth exceeds that, the denominator becomes 0.005 for
everyone it touches. Measured across 40 watchlist tickers, **the clamp binds for 23**,
each then valued at 203x-228x FCFF regardless of the business. Across the 18 reports that
built successfully:

| | |
| --- | --- |
| Median `terminal_value_share_pct` | **96.25%** |
| Reports above 95% | 9 of 18 |
| Highest | ATEX, **98.92%** |

The explicit multi-year projection contributes under 4% of the answer. **The refusals are
the lucky cases** — they fail loudly. The rest quietly report a near-fixed multiple
wearing a discounted-cash-flow's clothes.

### The framing this design adopts

The question is not "what is the largest growth rate that will not break the arithmetic?"
It is "what economic state is this company expected to reach, and what growth, returns,
reinvestment and cost of capital are sustainable in that state?"

Terminal growth becomes an **output of a terminal-state assessment**, not a capped
version of today's growth.

---

## 2. What the data actually supports

This section exists because the design's credibility rests on it. A regime classifier fed
by fields that do not exist would be the defect class this repository keeps recording,
committed in a new place.

| Signal | Sourceable | Evidence, measured 2026-09-10 |
| --- | --- | --- |
| Revenue / EBIT / FCFF CAGR | **Yes** | `corporate_statements`: 135 tickers with annual income statements — 97 have 5 distinct years, 37 have 4, 1 has 3 |
| ROIC and WACC, and their spread | **Yes** | both computed for 135 tickers |
| Industry growth | **Yes** | `industry_benchmark.revenue_growth`, 94 industries, vintage 2026-01-01, ranging -13.2% (Rubber & Tires) to +47.8% (Air Transport) |
| Structurally declining industries | **Yes** | 5 of 94 carry negative revenue growth |
| Growth persistence | **Thin** | 5 annual points is 4 growth observations; 4 points is 3 |
| Reinvestment rate | **Partial** | derivable from statements; "reinvestment *opportunity*" is a judgement, not a field |
| **Market share trend** | **No** | see below |
| **Competitive moat** | **No** | nothing in any schema expresses it |
| Analyst long-term growth estimates | **No** | not acquired |

### Why market share is unusable

`corporate_metrics` carries a `market_share` column, and it is populated. It is also
identical in every row:

```
AMZN 64.0   AMD 64.0   TSLA 64.0   META 64.0   GOOGL 64.0   AAPL 64.0   MSFT 64.0
```

So are `governance` (74.0 throughout) and `esg_penalty` (22.0 throughout). These are
defaults, not measurements. The table holds **7 rows against a 143-ticker watchlist**.

A factor built on this would manufacture a fifth of a score out of one hard-coded number.
It is excluded, and this document records why so that a later reader does not rediscover
the column and assume it means something.

### The consequence for design

**Three signals are solid, two are partial or thin, three do not exist.** That rules out a weighted
100-point score: a score computed from partial inputs yields a figure like `68.4` that
reads as measurement and is substantially imputation, and threshold comparisons against it
then carry decisive weight they have not earned.

The design instead classifies on what exists and **refuses when the evidence is
insufficient**, which is a first-class outcome rather than an error path.

---

## 3. Architecture

```
                    Company data
                         |
             +-----------------------+
             |   Growth regime       |   HIGH_GROWTH | TRANSITION |
             |   classifier          |   MATURE | DECLINING |
             |                       |   INSUFFICIENT_EVIDENCE
             +-----------+-----------+
                         |
             +-----------------------+
             |   Terminal state      |   g, ROIC, reinvestment,
             |                       |   WACC, margin, tax
             +-----------+-----------+
                         |
             +-----------------------+
             |   Hard constraints    |   g < WACC ; g <= ceiling ;
             |                       |   reinvestment = g / ROIC
             +-----------+-----------+
                         |
                  Terminal value
                         |
                    Diagnostics
```

The load-bearing change is the direction of derivation. Today growth flows into a clamp
and out as terminal growth. Here the regime determines a terminal state, and terminal
growth is one of that state's fields.

---

## 4. The growth regime

### 4.1 Signals

Three, all sourceable, each computed from data already stored:

1. **Excess return** — `ROIC - WACC`. Whether the company earns above its cost of
   capital at all. A company below it is not made attractive by growth (§4.4).
2. **Growth against its industry** — company revenue CAGR minus the resolved industry
   benchmark's revenue growth. Absolute growth says little; growth relative to the
   industry says whether share is being won.
3. **Persistence** — how many of the available annual growth observations exceed the
   industry rate. With 4-5 years this is 3-4 observations, which is enough to separate
   "consistently above" from "one good year", and **not** enough to support a continuous
   persistence score.

### 4.2 Bands

| Regime | Condition |
| --- | --- |
| `HIGH_GROWTH` | positive excess return, growth above industry, and persistent |
| `TRANSITION` | positive excess return, growth above industry, not persistent |
| `MATURE` | positive excess return, growth at or below industry |
| `DECLINING` | excess return at or below zero, or industry growth negative |
| `INSUFFICIENT_EVIDENCE` | fewer than 3 annual observations, or no resolvable industry benchmark, or ROIC/WACC unavailable |

**Persistent** means a majority of the available annual growth observations exceeded the
industry rate — 3 of 4, or 2 of 3. Stated as a fraction rather than a count because the
number of observations varies by ticker (§2), and a rule phrased in years would silently
mean something different for the 37 tickers that have four.

Exact thresholds are implementation parameters to be pinned in the plan, not universal
truths, and every one must be stated in the output (§7).

### 4.3 Insufficient evidence is a verdict, not a failure

`INSUFFICIENT_EVIDENCE` falls back to the macro ceiling (§5.1) and **says so in the
report**. It does not raise, and it does not silently pick a regime. This is the
difference between "we do not know, so we assumed the conservative case" and "we
assumed", and only the first is auditable.

### 4.4 Growth alone is not a signal

Two companies at `g = 15%`: one at `ROIC = 20%` against `WACC = 10%` is compounding value;
one at `ROIC = 8%` against the same `WACC` is destroying it. The regime is therefore
gated on excess return before growth is considered at all — a company earning below its
cost of capital cannot be `HIGH_GROWTH` regardless of how fast it grows.

---

## 5. Terminal state

### 5.1 Terminal growth

```python
terminal_growth_rate = min(
    company_growth,          # what the company is doing
    terminal_growth_ceiling, # what the economy permits, forever
    wacc - safety_margin,    # what the arithmetic permits
)
```

Three constraints with three distinct jobs, where today there are two doing one job.

- **`company_growth`** — company-specific expectation, unchanged.
- **`terminal_growth_ceiling`** — the economic bound. Sourced from the resolved
  industry's long-run growth rather than a single global number, so a structurally
  declining industry can yield `g < 0` instead of being forced into perpetual growth.
  Five of 94 industries carry negative growth today, so this is a live case, not a
  hypothetical.
- **`wacc - safety_margin`** — demoted to what it always should have been: a guard
  against the denominator approaching zero, reached only when the other two have not
  already bound.

**A constraint that binds must be named in the output** (§7). "Which of the three
decided this number" is the single most useful thing a reader can know about it.

### 5.2 Terminal ROIC, and the persistence question

A terminal ROIC above terminal WACC asserts that competitors cannot arbitrage the excess
away — for ever. That is a strong claim about the world.

This repository has **no moat data** (§2). Therefore:

> Where terminal ROIC would exceed terminal WACC, and no moat evidence exists, terminal
> ROIC **fades to WACC** over the transition rather than persisting.

That is the conservative default the absence of evidence requires. It is not a claim that
no company has a moat; it is a refusal to assume one from a historical ROIC series. If
moat evidence is later acquired (§9), this becomes the branch that consumes it.

### 5.3 Reinvestment must support the growth

```
reinvestment_rate = g / ROIC
```

A free consistency check on data already present, and it indicts the current behaviour
immediately: 14% perpetual growth at 14% ROIC implies reinvesting **100% of after-tax
profit for ever**, which is not a going concern, it is a treadmill.

This is enforced, not merely reported. The absolute bound is arithmetic — a reinvestment
rate above 100% means paying out more than is earned, for ever — and the working bound is
a parameter below it, because a terminal state requiring 95% reinvestment is barely more
credible than one requiring 105%. Exceeding it refuses, and the refusal names the implied
rate rather than reporting a bare failure.

### 5.4 Terminal WACC

The current WACC is the mature company's WACC only by coincidence. Business risk, beta and
capital structure all change as a company matures.

**Deliberately deferred.** Doing this properly requires a beta and capital-structure fade
that this codebase does not have, and `beta.py` is currently unreachable from any live
path (recorded in `docs/metrics/inventory.md`). Terminal WACC therefore stays current WACC
in this design, and that assumption is **stated in the output** rather than left implicit.
Named here so it is a known limitation rather than an oversight.

---

## 6. Hard constraints

Checked after the terminal state is assembled, before terminal value is computed:

| Constraint | On violation |
| --- | --- |
| `g_terminal < WACC_terminal` | refuse, naming both figures |
| `g_terminal <= terminal_growth_ceiling` | clamp, and record that the ceiling bound |
| `reinvestment_rate = g / ROIC` within bounds | refuse, naming the implied rate |
| `ROIC_terminal > WACC_terminal` requires moat evidence | fade ROIC to WACC (§5.2) |

Refusals travel through the existing `SkippedDcfTicker` channel added on the
`fix-priceless-bars` branch, so a batch names what it could not value rather than failing
whole or reporting a short list silently.

---

## 7. Diagnostics

Every DCF report gains a terminal block. **This is the highest-value part of the design
and the cheapest**, because it changes no valuation:

| Field | Why |
| --- | --- |
| `terminal_value_share_pct` | Already computed and returned today. **Nothing reads it.** That is why the current defect stayed invisible: a valuation 98% composed of one assumption looks identical to one at 60%. |
| `wacc_minus_terminal_growth` | The spread the whole terminal value turns on |
| `terminal_growth_binding_constraint` | `company` / `ceiling` / `wacc_safety` — which of the three decided the number |
| `growth_regime` and its evidence | What was concluded, and from what |
| `implied_reinvestment_rate` | Whether the growth is paid for |
| `terminal_roic_treatment` | `persisted` or `faded_to_wacc`, and why |
| `terminal_wacc_assumption` | Currently "held at current WACC" (§5.4) |

A warning surfaces above a threshold (initially 90%): *terminal value represents most of
this valuation; it is highly sensitive to the terminal assumptions.*

**The share is a diagnostic, never a target.** Forcing terminal share into a preferred
band would be another mechanical clamp wearing better clothes. A capital-intensive company
with a long runway may legitimately sit high; the point is that the reader can see it.

---

## 8. Staging

Each stage ships independently and is separately reviewable.

| Stage | Content | Changes a valuation? |
| --- | --- | --- |
| **1** | Diagnostics (§7) against today's derivation | **No** |
| **2** | Three-constraint split (§5.1) with a single global ceiling | Yes — fixes both symptoms |
| **3** | Industry-sourced ceiling (§5.1), negative permitted | Yes |
| **4** | Regime classifier, terminal ROIC fade, reinvestment constraint (§4, §5.2, §5.3, §6) | Yes |

Stage 1 first, deliberately. It makes the defect visible before anything is changed, and
gives every later stage a measured before-and-after instead of an argument.

**Each stage gets its own implementation plan.** Stages 1-2 are small and could share one;
stages 3 and 4 should not, because 4 introduces a classifier whose bands need their own
review. A single plan spanning all four would be too large to review as one unit, which is
the condition this project's planning guidance treats as a decomposition signal.

---

## 9. Out of scope, and what blocks it

| Item | Blocked on |
| --- | --- |
| Market-share-trend factor | No data. The column is a constant 64.0 (§2). |
| Competitive-moat factor | No data of any kind. Until then, §5.2's fade is the default. |
| Analyst long-term growth estimates | Not acquired. |
| Terminal WACC fade | Needs a beta and capital-structure fade; `beta.py` is unreachable from any live path. |
| Weighted 100-point regime score | Deliberately rejected, not deferred (§2). It would present imputation as measurement. Revisit only if the three missing signals are acquired. |
| Finer sector mapping | The watchlist carries **13 distinct sectors** against **94 benchmark industries**; `resolve_benchmark` bridges them by basket average. Stage 3 inherits that coarseness and should state it. |

---

## 10. Verification

1. **The current defect is reproduced before it is fixed** — a test asserting today's
   23-of-40 clamp binding and the 96.25% median share, so the change has a measured
   baseline rather than a remembered one.
2. **Each constraint is shown to bind independently** — one case where company growth
   decides, one where the ceiling decides, one where the WACC safety net decides, each
   asserting `terminal_growth_binding_constraint`.
3. **`INSUFFICIENT_EVIDENCE` is reachable and honest** — a ticker with two annual
   observations classifies as insufficient, falls back to the ceiling, and says so.
4. **The reinvestment identity refuses** — a terminal state implying an impossible
   reinvestment rate is refused, naming the rate.
5. **Mutation-verified per `CLAUDE.md` §8** — every test above names the broken
   implementation it was shown to reject. A test that passes because the code is right and
   one that never reaches its assertion look identical from a green run.

Stage 1's verification is narrower and worth stating separately: the diagnostic fields
must be shown to change when the underlying valuation changes, or they are decoration.

---

## 11. What this design does not claim

- **Not a replication of any institution's proprietary model.** No public source
  establishes what any specific firm uses, and this document does not assert one. What is
  borrowed is the architecture — derive terminal assumptions from an economic state — not
  anyone's parameters.
- **Not a claim that 2.5-3% is correct.** The ceiling is a parameter with a defensible
  basis (long-run nominal growth), to be pinned in the plan and stated in every output.
- **Not a claim that the regime bands are objectively right.** They are model-design
  parameters. The design's contribution is that they are *stated* and their evidence is
  reported, where today a single clamp decides silently.
