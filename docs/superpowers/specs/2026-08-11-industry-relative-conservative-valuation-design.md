# Industry-Relative Conservative Valuation

**Date:** 2026-08-11
**Status:** Approved design, not yet planned

## Problem

Every DCF in MoneyView runs on assumptions that are either the company's own
trailing metrics or static defaults. Nothing asks whether those assumptions are
plausible for the business the company is actually in. A 30% operating margin
assumed in perpetuity is a different claim in Software than in Air Transport,
and the model currently cannot tell the difference.

The request: value conservatively by measuring each input against what
comparable industries actually achieve, and make the over/undervalued judgement
recalculable on that basis rather than on fixed conditions.

## Decisions

Four settled during brainstorming. Each changes the data model, so they are
recorded before the design rather than inside it.

| Decision | Choice | Rejected |
| --- | --- | --- |
| Benchmark set | Top 3–5 **industries** within the company's sector | The company's own single industry row; top 3–5 peer *companies* |
| Ranking | After-tax ROC, descending | Operating margin; firm count; a weighted composite |
| Conservative rule | Asymmetric fade toward the benchmark | Hard worse-of ceiling held flat; fixed haircut |
| Target engine | `corporate_dcf`, the live comparison-tab path | The segment build-up engine; both |

**Why "top" is the conservative direction.** Benchmarking against the strongest
comparable industries sets a ceiling, not a target: the company must still look
undervalued when measured against the best of its sector, rather than against a
mediocre average that flatters it.

**Why peer *companies* were rejected.** MoneyView's universe is the user's own
watchlist, roughly 40 self-selected tickers. Most industries would contain zero
to two members. Company-level peer sets require acquiring a far wider universe
first, which would become the project and leave the valuation work waiting
behind it.

## Scope

The request decomposes into three sub-projects. This spec covers **1 and 2**.

1. **Industry benchmark data** — acquire, store, and map tickers to industries.
2. **Conservative assumption derivation** — turn benchmarks into DCF inputs.
3. **Over/undervaluation verdict** — *deferred to its own spec.*

Sub-project 3 is where the price-derived signals named in the request live:
percentage decline from previous peak, trading volume, and PE decline over time.
None of them are DCF inputs; they are evidence about whether a computed gap
between price and value is worth acting on. They are also all computable from
price bars MoneyView already stores, so deferring them costs no acquisition
work. Splitting here keeps this spec to one testable outcome: **a DCF whose
assumptions are derived from industry benchmarks instead of static defaults.**

## Data foundation

### Source

Damodaran's US industry-average dataset: 96 rows × 27 columns, republished
annually. The columns this design consumes:

| Column | Feeds |
| --- | --- |
| Industry Name | key |
| Number of firms | screening |
| Annual Average Revenue growth – Last 5 years | `revenue_growth_rate` |
| Pre-tax Operating Margin (Unadjusted) | `operating_margin` |
| After-tax ROC | ranking |
| Average effective tax rate | `tax_rate` |
| Unlevered Beta | `unlevered_beta` |
| Cost of capital | `wacc` |
| Market Debt/Capital | `debt_ratio` (reported) |
| Reinvestment Rate | `reinvestment` |
| Sales/Capital | stored and reported; no `ValuationAssumptions` field consumes it |

Sales/Capital has no counterpart in `ValuationAssumptions`, so it feeds no
assumption in this spec. It is listed because it appears in the worked example
and its average is asserted in the tests — the resolver averages every numeric
column uniformly, and testing a column with no consumer is the cheapest way to
check that the averaging is not quietly special-cased per field.

The remaining 16 columns are stored but unused here; `Trailing PE`, `EV/Sales`,
`Price/Book` and `Std deviation in stock prices` are the ones sub-project 3 will
want, and storing them now avoids a re-acquisition later.

### Three artifacts

**`industry_benchmark` table.** One row per industry per vintage, keyed
`(vintage, industry_name)`. Vintage is the dataset's publication date, not the
fetch date — the data changes annually, so a fetch-dated row would manufacture
variation that did not occur. This is the same argument
`2026-07-28-statements-acquisition-and-manual-snapshots-design.md` makes against
daily snapshots of quarterly statements.

**`sector → industries` map.** Hand-authored, checked into the repo. Damodaran's
dataset has no sector column, so this map is what makes "top 3–5 industries
within the same sector" computable at all. It is a judgement artifact and
belongs in version control where it can be reviewed and argued with, not in a
database where it would look like acquired fact.

**`yahoo_industry → damodaran_industry` map.** Also checked in, same reasoning.
`apps/api/services/acquisition/sources/quote_facts.py` already calls
`handle.info`, which carries Yahoo's `sector` and `industry`; it currently
discards both. Adding them to `QuoteFacts` extends an acquisition path that
already runs rather than adding a pipeline.

### Non-industry rows must be excluded explicitly

The dataset contains aggregate rows — the largest firm count is 5994 against a
median of 34, which is a market total, not an industry. Firm-count screening
will not catch these because they screen *high*. The excluded names are listed
in the map artifact, not inferred.

## The benchmark resolver

Input: a Damodaran industry name. Output: a `SectorBenchmark` carrying one
averaged value per column, plus the provenance of how it was reached.

### Steps

1. **Resolve the sector** containing the company's industry, via the checked-in
   map.
2. **Rank** that sector's industries by after-tax ROC, descending.
3. **Screen** each candidate before it enters the basket (below).
4. **Average** the surviving candidates per column *independently*: take up to
   5, require at least 3. Per-column independence means one unusable cell drops
   one column rather than the whole benchmark, so different columns may rest on
   different numbers of industries — which is why the provenance records the
   count per column, not once for the basket.
5. **Return provenance**: which industries were averaged, their ROC ranks, their
   firm counts, and every value screened out with its reason.

### Screening thresholds

Damodaran's averages contain distorted cells, and they would poison a naive mean
silently. Measured across the 96 rows:

| Column | Observed range | p10 → p90 | Bound | Rejects |
| --- | --- | --- | --- | --- |
| Number of firms | 1 → 5994 | 10 → 176 | `>= 10` | the thinnest decile |
| Reinvestment Rate | −0.986 → 14.142 | −0.156 → 1.311 | `0.0 → 1.5` | 11 negative, 3 above 200% |
| Pre-tax Operating Margin | −0.045 → 0.435 | 0.027 → 0.262 | `-0.5 → 1.0` | none today; guards a future vintage |
| After-tax ROC | −0.083 → 0.631 | 0.041 → 0.284 | `-1.0 → 1.0` | none today |
| Average effective tax rate | — | — | `0.0 → 1.0` | out-of-range cells |
| Cost of capital | — | — | `0.0 → 0.5` | out-of-range cells |
| Unlevered Beta | — | — | `0.0 → 5.0` | out-of-range cells |
| Market Debt/Capital | 0.020 → 0.782 | 0.084 → 0.490 | `0.0 → 1.0` | none today |

The concrete hazard: `Software (Internet)` reports a **1414% reinvestment rate**
and `Information Services` a negative one — artifacts of tiny or sign-flipped
denominators. Averaged in unscreened, either would move the conservative
valuation substantially, in the direction of *looking more conservative*, with
no visible cause.

Bounds that reject nothing in the current vintage are still specified. They
exist because the dataset is re-acquired annually and a future vintage is not
required to resemble this one.

### Units: the two sides do not agree, and must be converted explicitly

This is the highest-risk detail in the design, because getting it wrong produces
a silent 100× error in a plausible-looking number.

**Damodaran's dataset is in fractions.** Reinvestment Rate 0.409, Market
Debt/Capital 0.220, After-tax ROC 0.146.

**MoneyView's `CorporateMetrics` are in percent.** `AAPL` is stored as
`{"growth": 6, "roic": 18, "wacc": 10, "debt_ratio": 18}`
(`corporate_metrics_service.py:38`).

**`ValuationAssumptions` is mixed.** `revenue_growth_rate`, `operating_margin`,
`tax_rate` and `wacc` are fractions — `metric_percent_for_valuation` divides by
100 on the way in. But `reinvestment` and `debt_ratio` are declared
`ge=0.0, le=100.0` and are *not* divided; `corporate_dcf.py:310` passes
`debt_ratio` straight through. They remain percentages.

So the claim that screening bounds can simply mirror the `ValuationAssumptions`
ranges is **false** for exactly those two fields, where the model's range is
0–100 and the benchmark's natural range is 0–1.

The design therefore requires:

- Every benchmark column carries a declared unit (`fraction` or `percent`) in
  the stored schema, not by convention.
- Conversion happens once, at the boundary into `ValuationAssumptions`, per
  field — never by a blanket `* 100`.
- A test asserts, for every industry in the stored vintage, that each converted
  assumption satisfies its own `ValuationAssumptions` bound. A fraction leaking
  into `reinvestment` would pass silently (0.409 is within 0–100 and means 0.4%
  instead of 41%), so this test must additionally assert the converted value is
  in the plausible band for its unit, not merely inside the field's declared
  range.

The last point matters: the field bounds are too loose to catch this class of
error on their own, which is why the bound table above specifies plausible
ranges separately from the model's validation ranges.

### Worked example

Ranking a Technology-sector grouping by after-tax ROC:

| Industry | Firms | ROC | Op margin | Sales/Cap | Reinvest |
| --- | ---: | ---: | ---: | ---: | ---: |
| Computers/Peripherals | 36 | 0.4476 | 0.2248 | 3.620 | 0.214 |
| Software (System & Application) | 309 | 0.2932 | 0.3298 | 1.538 | 0.738 |
| Semiconductor Equip | 31 | 0.2840 | 0.2617 | 1.851 | 0.275 |
| **top-3 average** | | **0.3416** | **0.2721** | **2.336** | **0.409** |
| Semiconductor | 66 | 0.2723 | 0.3533 | 1.207 | 0.353 |
| Information Services | 15 | 0.2217 | 0.1189 | 2.512 | −0.268 → screened |
| Software (Internet) | 29 | 0.0343 | 0.0369 | 1.350 | 14.142 → screened |

This example is a test fixture, not illustration: the implementation must
reproduce these averages exactly from the stored vintage.

## The conservative fade

### Direction is per-assumption, not global

"Conservative" flips sign depending on whether an input is a benefit or a cost.
A company assumed to pay less tax, or raise cheaper capital, than the best of
its sector is being flattered exactly as much as one assumed to earn a higher
margin.

| Assumption | Benchmark column | If company is *better* | If *worse* |
| --- | --- | --- | --- |
| `revenue_growth_rate` | Annual Avg Revenue growth | fade **down** to benchmark | hold |
| `operating_margin` | Pre-tax Operating Margin | fade **down** | hold |
| `tax_rate` | Average effective tax rate | fade **up** | hold |
| `wacc` | Cost of capital | fade **up** | hold |
| `unlevered_beta` | Unlevered Beta | fade **up** | hold |
| `reinvestment` | Reinvestment Rate | fade **up** | hold |
| `debt_ratio` | Market Debt/Capital | reported only | reported only |

**Nothing ever fades toward optimism.** A company below its sector benchmark
holds its own value rather than being assumed to catch the best in the sector.
The asymmetry is the conservatism; a symmetric fade would be a mean-reversion
model, which is a different and less cautious claim.

`terminal_growth_rate` is not benchmarked. Perpetual growth is a macro
constraint, not an industry characteristic, and the existing cap at the riskfree
rate is already the conservative treatment.

`debt_ratio` is reported but not faded. Capital structure is a financing choice
rather than an operating assumption, and forcing a company toward its sector's
leverage would change the WACC that is already being faded directly — the same
quantity adjusted twice by two routes.

### Fade shape and horizon

`corporate_dcf` is a five-year model. The fade runs linearly from the company's
current value in year 1 to the benchmark in the terminal year, and the terminal
value carries the fully-faded assumption.

Terminal value dominates: the SpaceX reproduction completed this session put it
at **~87% of enterprise value**. So the terminal assumption is where nearly all
of the conservatism actually lands, and a fade that stopped short of the terminal
year would mostly be decoration.

Five years is a faster convergence than Damodaran's ten. This is a deliberate
consequence of targeting the existing engine and is recorded as such rather than
defended: it makes the result more conservative for a company currently above
its benchmark, and identical for one below it.

## Integration

### Parallel scenario, not an override

The DCF runs twice per ticker: once on stored assumptions, once on
benchmark-faded ones. Both values are returned, with the per-assumption deltas
between them.

The alternative — applying the fade inside `valuation_params_from_metrics` — was
rejected. It changes the meaning of every stored snapshot silently and destroys
the ability to see which assumption moved a valuation. This session ended with
three independent reviews finding overclaims that were only catchable because
the superseded numbers stayed visible; the same argument applies here.

### Shape

```
packages/core_finance/industry_benchmark.py     pure: screening, ranking, averaging, fade
apps/api/services/industry_benchmark.py         storage, vintage handling, map loading
apps/api/services/industry_maps/                the two checked-in map artifacts
```

`packages/core_finance` must not import from `apps/api`
(`guideline/sop/file-structure.md:42`). The fade and the resolver are pure
functions over plain data, so the dependency runs one way: the service layer
loads a vintage and hands it to the pure layer.

`conservative_valuation_params(metrics, benchmark, *, year, horizon)` sits beside
the existing `valuation_params_from_metrics` rather than replacing it, and
returns the same `ValuationAssumptions` type so the DCF needs no change to
consume it.

## Error handling

The governing rule: **a missing or unreliable benchmark produces no conservative
valuation, never a silently degraded one.**

| Condition | Behaviour |
| --- | --- |
| Ticker has no Yahoo industry | No conservative scenario. Reason reported. |
| Yahoo industry not in the map | No conservative scenario. Reason names the unmapped value, so the map can be extended. |
| Industry maps to a sector with fewer than 3 industries surviving screening | No conservative scenario. Reason lists what was screened and why. |
| A single column loses too many candidates | That column falls back to the company's own value, unfaded, and is marked as such. The other columns still fade. |
| No benchmark vintage stored | No conservative scenario. Reason distinguishes "never acquired" from "acquired but stale". |

Falling back to an all-industry average was considered and rejected: it would
produce a number that looks like a sector benchmark but is not one, which is the
failure mode this design exists to prevent.

## Testing

Network is prohibited in tests, and tests must not open
`data/processed/moneyview.db`. Both constraints are already established in this
repo.

**Pure layer** (`packages/core_finance/industry_benchmark.py`)

- The worked example above reproduces exactly — top-3 average ROC 0.3416,
  operating margin 0.2721, sales/capital 2.336, reinvestment 0.409.
- `Software (Internet)`'s 1414% reinvestment rate is screened out, and the
  resulting basket's reinvestment average is computed without it.
- `Information Services`'s negative reinvestment is screened, while its *other*
  columns still qualify — per-column independence.
- Each fade direction, both branches: a company above and below the benchmark,
  for a benefit assumption and for a cost assumption. Four cases minimum.
- A company exactly at the benchmark does not move.
- Fade reaches the benchmark exactly in the terminal year, and year 1 is one
  step in — matching the convention `margin_path` already uses in
  `segment_valuation.py`.
- Every faded assumption satisfies the corresponding `ValuationAssumptions`
  bound, for every industry in the stored vintage. This is the test that catches
  a screening bound drifting out of step with the model's own validation.

**Service layer**

- Vintage selection returns the newest vintage at or before a given date.
- Every error-handling row above produces no scenario and a distinct reason
  string.
- Round-trip: a stored vintage loads back with identical values.

**Integration**

- A ticker with a mapped industry returns both valuations and the deltas.
- A ticker without one returns the existing valuation unchanged, plus a reason.
- The stored-assumption valuation is byte-identical to what the same ticker
  produced before this change. This is the regression guard for the
  parallel-scenario promise.

## Risks and limits

**The two maps encode my classification judgement.** Neither Yahoo's taxonomy nor
a sector grouping over Damodaran's 95 industries is a fact; both are opinions
checked into the repo. Every resolved benchmark therefore carries its
provenance, and the maps are reviewable artifacts rather than embedded
constants. A wrong mapping produces a confidently wrong benchmark, and nothing
in the design detects that — only review does.

**Benchmarking against the top of a sector is a choice, not a neutral baseline.**
It is conservative for identifying undervaluation and *anti*-conservative for
identifying overvaluation: a company that looks expensive against the best
industries in its sector may be reasonably priced against its actual peers. The
verdict layer in sub-project 3 must state which direction it is testing.

**US-only.** The dataset acquired here is `Industry Average Beta (US)`.
Damodaran publishes global and regional equivalents in the same shape. Non-US
holdings will resolve to US industry benchmarks unless and until the regional
datasets are added, and the provenance must say so rather than let a US
benchmark pass for a local one.

**Annual vintage means the benchmark is stale for most of the year.** This is a
property of the source, not a defect to engineer around. The vintage date is
stored and reported so the staleness is visible.

## Noted, not addressed

`valuation_params_from_metrics` feeds `metrics.roic` into `operating_margin`
(`apps/api/services/corporate_metrics_service.py:456`). Return on invested
capital and operating margin are different quantities. This may be deliberate,
but it means the assumption this design fades against
`Pre-tax Operating Margin` may not currently hold an operating margin. It is
pre-existing and unrelated to this work; it is recorded here because it will
affect how the fade's output should be read, and it should be resolved before or
alongside implementation.
