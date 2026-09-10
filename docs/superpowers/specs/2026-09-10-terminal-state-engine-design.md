# The Terminal State Engine — Design

Date: 2026-09-10
Status: draft, revised after review
Scope: how terminal value assumptions are derived. Touches
`corporate_metrics_service.valuation_params_from_metrics`, the DCF report schema, and
the surfaces that display a valuation. No change to the DCF arithmetic itself.

> Every figure below was measured against this repository on 2026-09-10 and the
> measurement is named, so a reviewer can disagree with the evidence rather than only
> with the conclusion. Where a thing was **not** measurable, this document says so
> instead of estimating it.

**Revision note.** The first draft proposed sourcing the terminal-growth ceiling from
`industry_benchmark.revenue_growth`. Review challenged whether that field means what the
draft assumed. It does not — see §2.2 — and the ceiling design is rewritten as a result.
That challenge caught a worse error than the defect being fixed.

---

## 0. Glossary

Terms that look interchangeable and are not. Every later section uses them as defined
here.

| Term | Means |
| --- | --- |
| **annual growth observation** | One year-over-year revenue growth figure. 5 stored annual periods yield 4 observations. |
| **CAGR** | Compound annual growth rate across the full stored window. One number per company. |
| **industry benchmark growth** | `industry_benchmark.revenue_growth` — *trailing 5-year average* industry revenue growth (§2.2). A structural baseline, not a forecast. |
| **macro ceiling** | The configured long-run nominal growth bound on perpetual growth. A parameter, not data. |
| **safety margin** | The distance below WACC at which the Gordon denominator is considered unsafe. |
| **terminal state** | The set `{g, ROIC, reinvestment, WACC, margin, tax}` describing the mature company. |
| **regime** | Which of five bands a company falls into (§4.3). |
| **binding constraint** | Which bound actually determined terminal growth. |

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
each then valued at 203x-228x FCFF. Across the 18 reports that built successfully:

| | |
| --- | --- |
| Median `terminal_value_share_pct` | **96.25%** |
| Reports above 95% | 9 of 18 |
| Highest | ATEX, **98.92%** |

The explicit multi-year projection contributes under 4% of the answer. The tickers that
refuse fail loudly and are therefore visible; the remainder converge on a near-fixed
terminal multiple, which removes most of the economic differentiation a DCF exists to
provide, and does so without any signal that it has happened.

### 1.1 The framing this design adopts

The question is not "what is the largest growth rate that will not break the arithmetic?"
It is "what economic state is this company expected to reach, and what growth, returns,
reinvestment and cost of capital are sustainable in that state?"

Terminal growth becomes an **output of a terminal-state assessment**, not a capped
version of today's growth.

---

## 2. What the data actually supports

A regime classifier fed by fields that do not exist would be the defect class this
repository keeps recording, committed in a new place.

### 2.1 Signal inventory

| Signal | Sourceable | Evidence, measured 2026-09-10 |
| --- | --- | --- |
| Revenue / EBIT / FCFF CAGR and annual observations | **Yes** | `corporate_statements`: 135 tickers with annual income statements — 97 have 5 distinct years, 37 have 4, 1 has 3 |
| ROIC and WACC, and their spread | **Yes** | both computed for 135 tickers |
| Industry growth baseline | **Yes, with a caveat** | see §2.2 |
| Growth persistence | **Thin** | 5 annual points is 4 observations; 4 points is 3 |
| Reinvestment rate | **Partial** | derivable; "reinvestment *opportunity*" is a judgement, not a field |
| **Market share trend** | **No** | §2.3 |
| **Competitive moat** | **No** | nothing in any schema expresses it |
| Analyst long-term growth estimates | **No** | not acquired |

**Three signals are solid, two are partial or thin, three do not exist.**

### 2.2 What `industry_benchmark.revenue_growth` actually is

`packages/core_finance/industry_benchmark.py:54` declares the source column verbatim:

```python
BenchmarkColumn("revenue_growth", "Annual Average Revenue growth - Last 5 years", ...)
```

It is **trailing five-year average revenue growth**, imported from an industry sheet
(`industry_benchmark_store.py:38`, sheet `"Industry Average Beta (US)"`). It is an
*observed historical* figure. It is not a forecast, and it is emphatically not a
perpetual-growth estimate.

The measured range makes the consequence concrete: **-13.2% (Rubber & Tires) to +47.8%
(Air Transport)**, 5 of 94 industries negative, vintage 2026-01-01.

An industry averaging 47.8% revenue growth over five trailing years is recovering from
something, not compounding at 47.8% for ever. **Using this field as a terminal-growth
ceiling would have produced a worse defect than the clamp it replaced** — it would have
authorised terminal growth far above the current 0.1 bound, with an economic-sounding
justification attached.

This design therefore uses the field for what it can support:

| Use | Legitimate? |
| --- | --- |
| Baseline to classify a company's growth against (§4) | **Yes** — a structural comparison |
| Evidence that an industry is structurally shrinking (§5.2) | **Yes** — a negative trailing average is a real signal |
| The terminal-growth ceiling itself | **No** — it is trailing, not long-run |

### 2.3 Why market share is unusable

`corporate_metrics.market_share` is populated, and identical in every row:

```
AMZN 64.0   AMD 64.0   TSLA 64.0   META 64.0   GOOGL 64.0   AAPL 64.0   MSFT 64.0
```

So are `governance` (74.0 throughout) and `esg_penalty` (22.0 throughout). Defaults, not
measurements, across **7 rows against a 143-ticker watchlist**. Recorded here so a later
reader does not rediscover the column and assume it means something.

### 2.4 Consequence: no weighted score

A weighted 100-point regime score computed from partial inputs yields a figure like
`68.4` that reads as measurement and is substantially imputation, and threshold
comparisons against it then carry decisive weight they have not earned. **Rejected, not
deferred.** Revisit only if the three absent signals are acquired.

---

## 3. Architecture

```
                    Company data
                         |
             +-----------------------+
             |   Growth regime       |   HIGH_GROWTH | TRANSITION | MATURE
             |   classifier          |   DECLINING | INSUFFICIENT_EVIDENCE
             +-----------+-----------+
                         |
             +-----------------------+
             |   Terminal state      |   g, ROIC, reinvestment,
             |                       |   WACC, margin, tax
             +-----------+-----------+
                         |
             +-----------------------+
             |   Bounds and refusals |   §5.5 rules, §5.6 edge cases
             +-----------+-----------+
                         |
                  Terminal value
                         |
                    Diagnostics (§7)
```

The load-bearing change is the direction of derivation. Today growth flows into a clamp
and out as terminal growth. Here the regime determines a terminal state, and terminal
growth is one of that state's fields.

---

## 4. The growth regime

### 4.1 Signals, and exactly how each is computed

| Signal | Computation |
| --- | --- |
| **Excess return** | `ROIC - WACC`, current values |
| **Growth level** | company revenue **CAGR** over the stored window, minus industry benchmark growth |
| **Persistence** | count of **annual growth observations** exceeding industry benchmark growth, over the number of observations available |

Level and persistence deliberately use different growth measures: one asks "is the
company ahead", the other asks "has it been ahead repeatedly". Using CAGR for both would
collapse them into the same question asked twice.

**Persistent** means a strict majority of available observations exceeded the benchmark —
3 of 4, or 2 of 3. Expressed as a ratio rather than a year count, because the number of
observations varies by ticker (§2.1) and a rule phrased in years would silently mean
different things for the 97 tickers with five periods and the 37 with four.

### 4.2 Temporal alignment, stated honestly

The industry benchmark is a **single trailing-5-year figure at vintage 2026-01-01**.
Company annual observations span several distinct historical years. There is no
year-by-year industry series in this repository, so a true historical comparison is not
available.

Persistence therefore means, precisely:

> How many of the company's annual growth observations exceeded **today's structural
> industry baseline**.

That is a defensible current-regime signal. It is **not** a claim that the company beat
its industry in each of those specific years, and the diagnostics (§7) must not describe
it as one. Acquiring a historical industry series would upgrade this; until then the
weaker claim is the honest one.

### 4.3 Bands

Evaluated in order; the first match wins.

| Order | Regime | Condition |
| --- | --- | --- |
| 1 | `INSUFFICIENT_EVIDENCE` | fewer than 3 annual observations, **or** no resolvable industry benchmark, **or** ROIC or WACC unavailable |
| 2 | `DECLINING` | `excess return <= 0` **and** company CAGR `<= 0` |
| 3 | `HIGH_GROWTH` | `excess return > 0` **and** growth level `> 0` **and** persistent |
| 4 | `TRANSITION` | `excess return > 0` **and** growth level `> 0` **and** not persistent |
| 5 | `MATURE` | everything else that reached this row |

**`DECLINING` is about the company, not the industry.** The first draft classified on
negative *industry* growth, which would have labelled a company growing at +5% with a 10
point excess return as declining merely because its industry shrank — contradicting the
three signals the section had just established. A shrinking industry is a fact about the
company's *ceiling* (§5.2), not about the company's own state.

Thresholds are implementation parameters, pinned in the Stage 4 plan, and every one is
reported (§7).

### 4.4 Growth alone is not a signal

Two companies at `g = 15%`: one at `ROIC = 20%` against `WACC = 10%` compounds value; one
at `ROIC = 8%` against the same WACC destroys it. The bands are therefore gated on excess
return before growth is considered — a company earning below its cost of capital cannot be
`HIGH_GROWTH` however fast it grows.

---

## 5. Terminal state

### 5.1 Terminal growth

```python
terminal_growth_rate = min(
    company_growth,          # company-specific expectation
    terminal_growth_ceiling, # what an economy permits, in perpetuity
    wacc - safety_margin,    # what the arithmetic permits
)
```

Three bounds with three distinct jobs, where today two bounds do one job.

**`terminal_growth_ceiling` is a configured macro parameter, not industry data.** Given
§2.2, no field in this repository expresses long-run sustainable growth, so the ceiling is
declared as a parameter with a stated basis (long-run nominal economic growth) rather than
derived from a trailing average that would authorise 47.8%.

**`safety_margin` is `0.005`**, retained from the current implementation. It is unchanged
because nothing in the measured evidence indicts the distance itself — the defect is that
this bound was doing the ceiling's job, not that 50bp is the wrong distance. Changing both
at once would make it impossible to attribute the improvement.

### 5.2 Where the industry signal does apply: permission to decline

A structurally shrinking industry is a real constraint on perpetual growth, and the
benchmark is credible evidence *of direction* even though it is not credible as a
*magnitude* for perpetuity.

```
if industry_benchmark_growth < 0:
    terminal_growth_ceiling = max(declining_floor, min(macro_ceiling, 0))
```

So a company in a shrinking industry may take `g < 0` rather than being forced into
perpetual growth — but the depth of that decline is bounded by a configured
`declining_floor`, **not** by the trailing industry figure. Rubber & Tires at -13.2%
trailing does not mean -13.2% for ever, for exactly the reason Air Transport at +47.8%
does not.

### 5.3 Terminal ROIC

Where no moat evidence exists — which is every company in this repository (§2.1):

```python
terminal_roic = terminal_wacc
```

Not a fade. The first draft said terminal ROIC "fades to WACC over the transition", which
implies a multi-period trajectory this design never defined and this scope does not cover.
A single terminal-year equality is testable, reasonable to explain, and does not require
inventing a transition model. A genuine fade is separate future work, named in §9.

The economic claim being refused is specific: a terminal ROIC above terminal WACC asserts
that competitors cannot arbitrage the excess away, for ever. Absent evidence, the
conservative reading is that they can.

### 5.4 Terminal WACC

Stays at current WACC. Business risk, beta and capital structure all change as a company
matures, but a proper fade needs a beta path this codebase does not have — `beta.py` is
unreachable from any live path (`docs/metrics/inventory.md`). Named here and reported in
§7 as an assumption, so it is a known limitation rather than an oversight.

### 5.5 Deterministic terminal-state rules

The terminal state must be fully determined before terminal value is computed.

1. Terminal growth starts from the company's growth assumption.
2. It is bounded above by `terminal_growth_ceiling` (§5.1), itself adjusted for a
   structurally declining industry (§5.2).
3. It is bounded above by `wacc - safety_margin`.
4. If the regime is `INSUFFICIENT_EVIDENCE`, terminal growth is the configured
   `insufficient_evidence_growth` fallback, and that fact is recorded.
5. `terminal_roic = terminal_wacc` where no moat evidence exists.
6. `reinvestment_rate = terminal_growth / terminal_roic`, subject to §5.6.
7. A terminal state whose implied reinvestment exceeds `max_reinvestment_rate` is refused,
   naming the implied figure.
8. Every bound, fallback or refusal that determined an assumption is recorded in the
   diagnostics (§7).

### 5.6 Edge cases

The reinvestment identity `g / ROIC` is undefined or meaningless in several states that
occur in this data, so each is decided here rather than left to the implementer.

| Condition | Treatment |
| --- | --- |
| `ROIC > 0`, `g >= 0` | `reinvestment = g / ROIC` |
| `ROIC > 0`, `g < 0` | `reinvestment = g / ROIC`, negative, **permitted** — a shrinking firm releases capital rather than absorbing it, and forcing it to zero would overstate terminal cash flow |
| `ROIC = 0` | refuse. The identity is undefined, and a zero-return terminal state has no defensible reinvestment |
| `ROIC < 0` | refuse. A negative terminal ROIC asserts perpetual value destruction; the model should decline to value it rather than emit a sign-flipped ratio |
| `reinvestment > max_reinvestment_rate` | refuse, naming the implied rate |
| `terminal_growth >= terminal_wacc` after all bounds | refuse, naming both figures — unreachable given §5.1, so reaching it means a bound was bypassed |

Refusals travel through the existing `SkippedDcfTicker` channel, so a batch names what it
could not value rather than failing whole or silently returning a short list.

### 5.7 The insufficient-evidence fallback

`INSUFFICIENT_EVIDENCE` uses a **configured `insufficient_evidence_growth` parameter**,
named as such in the output.

The first draft said it "falls back to the macro ceiling", implying the ceiling is
intrinsically conservative. It is not — the ceiling is an *upper bound on plausible
growth*, and adopting an upper bound when nothing is known is close to the opposite of
conservative. The fallback is therefore its own parameter, and the report says which
parameter produced the number rather than implying a neutral default exists.

---

## 6. Bounds, and what each does when it binds

The first draft called these "constraints" and described the ceiling as something that
could be "violated". It cannot: `min()` guarantees the result is at or below every bound.
The distinction that matters is which bound **bound**.

| Situation | Treatment |
| --- | --- |
| `company_growth` is the smallest | use it; `binding_constraint = "company"` |
| `terminal_growth_ceiling` is the smallest | clamp; `binding_constraint = "ceiling"` |
| `wacc - safety_margin` is the smallest | clamp; `binding_constraint = "wacc_safety"` |
| ceiling and `wacc - safety_margin` are exactly equal | report `"ceiling"`. A reader told `wacc_safety` concludes the arithmetic cornered the model; told `ceiling` they conclude a judgement was applied. When both are true, the judgement is the more useful answer. |
| regime is `INSUFFICIENT_EVIDENCE` | fallback (§5.7); `binding_constraint = "insufficient_evidence"` |
| `ROIC <= 0`, or reinvestment above maximum | **refuse** (§5.6) |
| `g >= WACC` after all bounds | **refuse** — indicates a bypassed bound |

Only the last two rows are failures. The rest are outcomes, and each is reported.

---

## 7. Diagnostics

Every DCF report gains a terminal block. This is the highest-value part of the design and
the cheapest, because **it changes no valuation**.

### 7.1 Terminal figures

| Field | Why |
| --- | --- |
| `terminal_value_share_pct` | Computed and **already displayed** — a tile in `DcfCoreModulesGraph.tsx:52-61` and per-cell in `DcfSensitivityTable.tsx:91`. What is missing is a **threshold**: 96.25% and 60% render identically as a plain percentage. Gains a warning state (§7.4), not a new field. |
| `wacc_minus_terminal_growth` | The spread the whole terminal value turns on |
| `terminal_growth_binding_constraint` | `company` / `ceiling` / `wacc_safety` / `insufficient_evidence` |
| `implied_reinvestment_rate` | Whether the growth is paid for |
| `terminal_roic_treatment` | `moat_evidenced` or `set_to_wacc`, and why |
| `terminal_wacc_assumption` | Currently `held_at_current_wacc` (§5.4) |

### 7.2 Regime evidence, not just the label

`HIGH_GROWTH` alone is another opaque classifier. The payload carries what produced it:

```
growth_regime:
  regime:                 HIGH_GROWTH
  excess_return:          8.2%
  company_growth_cagr:    18.4%
  industry_growth:        7.1%
  growth_level:           11.3%
  persistence:            3 of 4
  observations_available: 4
```

### 7.3 Benchmark provenance

The watchlist carries **13 distinct sectors** against **94 benchmark industries**, bridged
by `resolve_benchmark` through a basket average. Two companies can both report
`industry_growth = 8.4%` while one is a direct match and the other a basket mean, and
nothing on screen distinguishes them.

```
industry_benchmark:
  industry:      Semiconductor
  growth:        7.1%
  vintage:       2026-01-01
  resolution:    basket_average | direct
  basket_size:   5
  metric_basis:  trailing_5y_average   # §2.2 -- never a forecast
```

`metric_basis` is included so a reader is never left to assume the industry figure is
forward-looking.

### 7.4 Warning

Above a configured share threshold: *terminal value represents most of this valuation; it
is highly sensitive to the terminal assumptions.*

**The share is a diagnostic, never a target.** Forcing terminal share into a preferred band
would be another mechanical clamp in better clothes. A capital-intensive company with a
long runway may legitimately sit high; the point is that the reader can see it.

---

## 8. Staging

| Stage | Content | Changes a valuation? |
| --- | --- | --- |
| **1** | Diagnostics (§7.1, §7.3) against today's derivation | **No** |
| **2** | Three-bound split (§5.1) with the macro ceiling and `safety_margin = 0.005`. **No industry logic, no regime classifier.** | Yes |
| **3** | Declining-industry permission (§5.2) and benchmark provenance | Yes |
| **4** | Regime classifier, terminal ROIC rule, reinvestment identity and refusals (§4, §5.3, §5.5, §5.6) | Yes |

**Stage 2 must not introduce the industry ceiling or the regime classifier.** Both are
Stage 3 and 4 respectively, and pulling either forward would make Stage 2's effect
unattributable.

Stage 1 first, deliberately: it makes the defect legible before anything changes, and
gives every later stage a measured before-and-after instead of an argument.

**A correction worth carrying into the plan.** An earlier draft of this spec, and the
`ERROR-LOG.md` entry beside it, asserted that nothing in the product surfaced
`terminal_value_share_pct`. That was false — it has been on screen throughout. The real
gap is that a 96% reading and a 60% reading look the same, and nothing tells a reader that
one of them means the valuation is almost entirely one assumption. Stage 1 is therefore a
warning state and the two missing companion figures, not the surfacing of a hidden field.
**A figure can be fully visible and still not be information**, which is a sharper lesson
than the one the draft recorded.

Each stage gets its own implementation plan. Stages 1-2 may share one; 3 and 4 must not,
because 4 introduces a classifier whose bands need their own review.

---

## 9. Out of scope, and what blocks it

| Item | Blocked on |
| --- | --- |
| Market-share-trend factor | No data. The column is a constant 64.0 (§2.3). |
| Competitive-moat factor | No data of any kind. Until then §5.3 applies. |
| Analyst long-term growth estimates | Not acquired. |
| Multi-period ROIC fade | Needs a transition trajectory model; §5.3 uses terminal equality instead. |
| Terminal WACC fade | Needs a beta and capital-structure path; `beta.py` is unreachable from any live path. |
| Historical industry growth series | Would upgrade persistence from §4.2's weaker claim to a true year-by-year comparison. |
| Weighted 100-point regime score | Deliberately rejected (§2.4). |
| Finer sector mapping | 13 sectors against 94 industries; Stage 3 inherits the coarseness and reports it (§7.3). |

---

## 10. Verification

1. **The defect is reproduced before it is fixed.** A test asserting today's behaviour —
   the clamp binding for 23 of 40, the 96.25% median share — so the change has a measured
   baseline rather than a remembered one.

2. **The defect mechanism is gone.** Not `terminal_share < 90%`, which would make a
   diagnostic into a target. The assertion is narrower and directly about the cause:

   > No ticker arrives at `g = wacc - safety_margin` **solely because company growth
   > exceeded WACC**. Where that bound still binds, another bound must have been higher.

3. **Each bound is shown to bind independently** — one case per row of §6, each asserting
   `terminal_growth_binding_constraint`.

4. **The declining-industry invariant.** Given `company_growth > 0`,
   `industry_benchmark_growth < 0`, `WACC > 0`: terminal growth is `< 0` and
   `binding_constraint = "ceiling"`. This proves Stage 3 does something economically
   meaningful rather than moving constants around.

5. **`INSUFFICIENT_EVIDENCE` is reachable and honest** — a ticker with two annual
   observations classifies as insufficient, uses the named fallback, and reports which
   parameter produced its number.

6. **Every §5.6 edge case is exercised** — `ROIC = 0`, `ROIC < 0`, negative `g`, and
   reinvestment above maximum, each asserting refusal or permission as specified.

7. **`DECLINING` is about the company.** A company growing at +5% with a positive excess
   return in an industry shrinking at -5% is **not** `DECLINING`. This is the regression
   test for the classification error the first draft contained.

8. **Diagnostics move.** Stage 1's fields must be shown to change when the underlying
   valuation changes, or they are decoration.

9. **Mutation-verified per `CLAUDE.md` §8.** Every test above names the broken
   implementation it was shown to reject. A test that passes because the code is right and
   one that never reaches its assertion look identical from a green run.

---

## 11. Worked examples

Illustrative, using the rules as specified. Figures exercise the paths; they are not taken
from any specific company.

**A — `HIGH_GROWTH`, ceiling binds**

```
ROIC 22%, WACC 10%    -> excess +12%
CAGR 18%, industry 7% -> level +11%, persistence 3 of 4  -> HIGH_GROWTH
terminal g = min(18%, ceiling 3.0%, 10% - 0.5% = 9.5%) = 3.0%
binding_constraint = ceiling
terminal ROIC = 10% (no moat evidence) ; reinvestment = 3.0 / 10 = 30%
```

The company's own growth is irrelevant to the terminal year, which is the point.

**B — `MATURE`, and where the WACC bound would bite**

```
ROIC 6%, WACC 4%     -> excess +2%
CAGR 3%, industry 5% -> level -2%  -> MATURE
terminal g = min(3%, ceiling 3.0%, 4% - 0.5% = 3.5%) = 3.0%
binding_constraint = ceiling
```

Had WACC been 3.0%, `wacc - safety_margin = 2.5%` would bind instead, and the report would
say so — the case that is today's silent default.

**C — `INSUFFICIENT_EVIDENCE`**

```
2 annual observations available  -> INSUFFICIENT_EVIDENCE
terminal g = insufficient_evidence_growth (configured), NOT the ceiling
binding_constraint = insufficient_evidence
```

**D — declining industry, company still growing**

```
ROIC 20%, WACC 10% -> excess +10% ; CAGR +5% -> company is NOT declining
industry growth -5% -> ceiling adjusted below zero, floored at declining_floor
terminal g < 0, binding_constraint = ceiling ; regime = MATURE or better
```

The company is not labelled `DECLINING`; its *ceiling* reflects the industry. These are
different claims, and §4.3 keeps them apart.

---

## 12. What this design does not claim

- **Not a replication of any institution's proprietary model.** No public source
  establishes what any specific firm uses. What is borrowed is the architecture — derive
  terminal assumptions from an economic state — not anyone's parameters.
- **Not a claim that any particular ceiling value is correct.** It is a parameter with a
  stated basis, pinned in the Stage 2 plan and reported in every output.
- **Not a claim that the regime bands are objectively right.** They are model-design
  parameters. The contribution is that they are stated and their evidence reported, where
  today a single clamp decides silently.
- **Not a claim that persistence measures historical industry outperformance.** §4.2 is
  explicit about what the available data supports.
