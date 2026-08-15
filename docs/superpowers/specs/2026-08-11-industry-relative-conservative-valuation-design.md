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
| Target engine | **The segment build-up engine** (revised, see below) | `corporate_dcf`; both |

**Why "top" is the conservative direction.** Benchmarking against the strongest
comparable industries sets a ceiling, not a target: the company must still look
undervalued when measured against the best of its sector, rather than against a
mediocre average that flatters it.

### Revised 2026-08-11: the target engine changed before implementation

The original choice was `corporate_dcf`, on the reasoning that it is the live
path valuing every watchlist ticker. That reasoning checked *that* it runs
everywhere, not *what it consumes*. It consumes almost nothing.

`corporate_dcf.py:159` computes `enterprise_value = pv_fcff + pv_terminal`, and
the projection is `base_fcff * (1 + growth) ** year` discounted at `wacc`. Five
inputs reach that arithmetic: `fcff`, `revenue_growth_rate`, `wacc`,
`terminal_growth_rate`, `esg_penalty`. The rest are echoed into the response
payload and hashed into `report_id`, and never enter the math:

| Assumption | Where it actually goes |
| --- | --- |
| `operating_margin` | `:135` → payload + `report_id`. Not in the computation. |
| `tax_rate` | `:311` → payload echo only |
| `unlevered_beta` | `:309` → payload echo only |
| `debt_ratio` | `:310` → payload echo only |
| `reinvestment` | zero references |

So four of the six columns this design fades would have computed, displayed and
changed nothing, while appearing to work — the false precision
`guideline/sop/finance-logic.md` prohibits in its opening principle, built in by
design.

**The segment build-up engine consumes all of them as real drivers.** It is a
revenue → margin → NOPAT → reinvestment → FCFF model, so operating margin,
sales-to-capital, the tax ramp and the terminal return each move enterprise
value. It is the multivariate engine the request asked for; `corporate_dcf` is
structurally a three-parameter model and no amount of benchmarking changes that.

The obstacle cited when it was first rejected — that it values hand-authored
cases rather than the watchlist — is a wiring problem, not a modelling one, and
this design now solves it (see "The conservative case generator").

A second finding, now moot but worth recording: `metrics.roic` IS a genuine
return on invested capital (`nopat / average_invested_capital`,
`corporate_statement_metrics.py:389`), so feeding it into `operating_margin` at
`corporate_metrics_service.py:456` is a real mislabelling. It is inert, which is
presumably why it survived.

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
| Annual Average Revenue growth – Last 5 years | `SegmentSpec.revenue_target` |
| Pre-tax Operating Margin (Unadjusted) | `SegmentSpec.margin_target` |
| After-tax ROC | ranking, and `CaseSpec.roic_stable` |
| Average effective tax rate | `CaseSpec.effective_tax_rate` |
| Cost of capital | `CaseSpec.wacc_initial`, `wacc_stable` |
| Sales/Capital | `SegmentSpec.sales_to_capital_early` / `_late` |
| Unlevered Beta | stored, fades nothing — the engine takes WACC directly |
| Market Debt/Capital | stored, fades nothing — same reason |
| Reinvestment Rate | stored, fades nothing — it is an engine OUTPUT, not an input |

The resolver averages every numeric column uniformly, including the three that
fade nothing. Keeping them costs nothing and testing a column with no consumer
is the cheapest way to check that the averaging is not quietly special-cased per
field.

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
| Reinvestment Rate | −0.986 → 14.142 | −0.156 → 1.311 | `0.0 → 2.0` | 11 negative, 3 above the bound |
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

### Units

The first draft of this design targeted `corporate_dcf`, where units were the
highest-risk detail: `ValuationAssumptions` is mixed — `revenue_growth_rate`,
`operating_margin`, `tax_rate` and `wacc` are fractions, while `reinvestment`
and `debt_ratio` are declared `ge=0.0, le=100.0` and never divided
(`corporate_dcf.py:310` passes `debt_ratio` straight through). A fraction
leaking into `reinvestment` passes every declared bound and silently means 0.4%
instead of 41%.

**Retargeting to the segment engine removes most of that risk.**
`segment_valuation.py` uses fractions for every rate and billions for every
money amount, with no mixed convention anywhere. Damodaran's dataset is also
entirely fractions. So the two sides agree, and no rate conversion happens at
all.

Two boundaries survive and still need explicit handling:

1. **Statements → billions.** `base_revenue` comes from raw statement currency
   and must be scaled. `equity_bridge._scaled` is the existing helper and the
   convention to follow; `equity_bridge` already emits net debt and share counts
   in billions, so the generator's money terms are consistent if they all come
   through it.
2. **`CorporateMetrics` → the engine.** Anything read from `CorporateMetrics`
   (the marginal tax rate, for instance) is in PERCENT — `AAPL` is stored as
   `{"growth": 6, "roic": 18, "wacc": 10}` (`corporate_metrics_service.py:38`) —
   and must be divided by 100 before it reaches `CaseSpec`.

The design therefore still requires:

- Every benchmark column carries a declared unit in the stored schema, not by
  convention.
- Conversion happens once, per field, at the boundary — never by a blanket
  multiply.
- A test asserts that a generated case's rate fields all land in plausible
  bands, not merely inside the engine's validation ranges. `CaseSpec` accepts
  `marginal_tax_rate` anywhere in [0, 1], so a percent leaking through as 25.0
  is rejected — but `effective_tax_rate=0.25` and `0.0025` are both accepted,
  and only one is right.

The engine's own validation is a genuine safety net here in a way
`ValuationAssumptions` was not: `CaseSpec.__post_init__` rejects a
`marginal_tax_rate` outside [0, 1] with an explicit message about percentages,
and `terminal_value` rejects a `roic_stable` below the magnitude of terminal
growth. Several classes of units error fail loudly rather than silently.

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

### What the segment engine actually consumes

Every field below moves enterprise value. That is the whole reason the target
changed.

| Benchmark column | Engine field | How it moves value |
| --- | --- | --- |
| Pre-tax Operating Margin | `SegmentSpec.margin_target` | Sets the margin path's endpoint; EBIT in every year |
| Sales/Capital | `SegmentSpec.sales_to_capital_early` / `_late` | Reinvestment is `ΔRevenue / sales_to_capital` |
| After-tax ROC | `CaseSpec.roic_stable` | Terminal reinvestment is `g / roic_stable` |
| Average effective tax rate | `CaseSpec.effective_tax_rate` | The tax ramp across years 1–10 |
| Cost of capital | `CaseSpec.wacc_initial`, `wacc_stable` | Discounting, every year |
| Annual Avg Revenue growth | `SegmentSpec.revenue_target` | The target-year revenue the whole path lands on |

### The terminal return needs two estimates reconciled, not one adopted

`roic_stable` cannot simply take Damodaran's After-tax ROC. Measured across all
11 sectors in the 2026 vintage, five would be rejected by the engine's own
guards: Consumer Discretionary, Financials, Industrials and Utilities exceed
`margin_target × (1 − τ) × sales_to_capital_late`, and Real Estate falls below
its benchmarked cost of capital.

The reason is that the two columns measure different things:

- **After-tax ROC** is a book return on *existing* capital — NOPAT over invested
  capital.
- **`margin × (1 − τ) × sales/capital`** is the return on *new* capital implied
  by the same table's margin and capital intensity.

When the first exceeds the second, the industry's book capital base is
understated relative to what its current economics generate on new investment.
Adopting the higher figure as a TERMINAL return asserts that the terminal block
earns more on new capital than the model's own margin and capital intensity
support, which is exactly what `run_case`'s ceiling exists to reject.

So `roic_stable` is the **lower of the two**:

    roic_stable = min(faded After-tax ROC, margin_target × (1 − τ) × sales_to_capital_late)

This is the same worse-of rule the fade applies everywhere else, here reconciling
two independent estimates of one quantity rather than a company against a sector.
It is conservative by construction and consistent by construction, and it takes
10 of the 11 sectors from rejected to valued.

**Real Estate still refuses, and should.** Its top industries by ROC earn 5.31%
against a 6.07% cost of capital. A perpetuity growing at the riskfree rate while
earning below its cost of capital destroys value without bound, and the engine
rejects it. That is an economic finding about the sector, not a defect to
engineer around.

**`roic_stable` is the largest single lever.** This session established that
terminal value is roughly 87% of enterprise value on a reproduced Damodaran
case, and `roic_stable` drives it. Benchmarking it against the sector's
after-tax ROC also closes `guideline/sop/todo.md`'s "Known divergences" item 3:
`roic_stable` currently determines most of a valuation while stating no reason.
A benchmark gives it one, with a source.

Three columns are stored but fade nothing, and their absence is deliberate:

- **Unlevered Beta** and **Market Debt/Capital** — the engine takes WACC
  directly rather than rebuilding it from beta and leverage, so fading these
  would move nothing. Storing them without fading is honest; fading them would
  repeat the mistake that caused this revision.
- **Reinvestment Rate** — an *output* of the segment engine
  (`ΔRevenue / sales_to_capital`), not an input. Benchmarking it would assert a
  result the model is supposed to derive.

### Direction is per-assumption, not global

"Conservative" flips sign depending on whether an input is a benefit or a cost.

| Engine field | Benchmark column | If company is *better* | If *worse* |
| --- | --- | --- | --- |
| `margin_target` | Pre-tax Operating Margin | fade **down** to benchmark | hold |
| `revenue_target` | via Annual Avg Revenue growth | fade **down** | hold |
| `roic_stable` | After-tax ROC | fade **down** | hold |
| `sales_to_capital_early` / `_late` | Sales/Capital | fade **down** | hold |
| `effective_tax_rate` | Average effective tax rate | fade **up** | hold |
| `wacc_initial`, `wacc_stable` | Cost of capital | fade **up** | hold |

`sales_to_capital` needs care: a *higher* ratio means less capital consumed per
dollar of new revenue, so it is a benefit and fades **down** toward the
benchmark. Getting its direction backwards would make capital-hungry companies
look cheaper, which is the opposite of conservative.

**Nothing ever fades toward optimism.** A company below its sector benchmark
holds its own value rather than being assumed to catch the best in the sector.
The asymmetry is the conservatism; a symmetric fade would be mean reversion,
which is a different and less cautious claim.

`terminal_growth` is not benchmarked — it defaults to `riskfree_rate`, which the
engine already caps, and perpetual growth is a macro constraint rather than an
industry characteristic.

### Fade shape and horizon

The horizon is **ten years**, matching the engine's own target-year convention
and Damodaran's convergence. This removes the caveat the first draft carried:
against `corporate_dcf`'s five-year model the fade was faster than Damodaran's;
against this engine it is the same length.

Each benchmarked field is faded **once, to its terminal value**, because the
engine already applies its own convergence path over the horizon: `margin_path`
ramps `base_margin` to `margin_target`, `wacc_path` ramps `wacc_initial` to
`wacc_stable`, and `tax_rate_path` ramps `effective_tax_rate` to the marginal
rate. Fading the *endpoints* and letting the engine's own paths carry them is
correct. Fading year by year on top of that would apply convergence twice, which
would be a real modelling error rather than merely a conservative one.

## The conservative case generator

This is the wiring that was missing when the segment engine was first rejected.

`build_conservative_case(ticker, benchmark, vintage) -> dict` produces a
`create_case` payload: one `CaseSpec` and a single `SegmentSpec` named for the
company. A listed company has no published segment split, so one segment is the
whole business — the engine requires at least one and imposes no upper bound.

| Field | Source |
| --- | --- |
| `base_revenue`, `base_margin` | Stored statements: `revenue_by_year`, `operating_income_by_year` |
| `margin_target`, `revenue_target`, `sales_to_capital_*`, `roic_stable`, `effective_tax_rate`, `wacc_*` | Benchmark, faded |
| `cash`, `debt`, `shares_basic` | `equity_bridge.py`, which already emits net debt and diluted shares in billions with quality metadata |
| `riskfree_rate` | Existing market data |
| `marginal_tax_rate` | Existing metrics |
| `base_year`, `target_year` | Current year, +10 |

Amounts are in **billions**; `equity_bridge._scaled` is the existing convention
to follow. Rates are fractions throughout, in both the engine and the dataset —
so the units hazard that dominated the first draft largely evaporates. It
survives only at the statement boundary, where raw currency becomes billions,
and that boundary already has a helper.

`equity_bridge` emits `net_debt` as a single figure while `CaseSpec` takes
`cash` and `debt` separately. The generator sets `debt = max(net_debt, 0)` and
`cash = max(-net_debt, 0)`, which reproduces the same equity bridge — the engine
computes `EV - debt + cash + ipo_proceeds`, so only the difference matters.
`ipo_proceeds` and `shares_new` are zero for a listed company.

### The narrative rule becomes the point, not an obstacle

`valuation_case.create_case` rejects any segment input lacking a narrative
claim. Every benchmark-derived number has an exact one:

> claim: "Top 3 industries by after-tax ROC in Technology (Computers/Peripherals,
> Software (System & Application), Semiconductor Equip), vintage 2026-01-01,
> average Pre-tax Operating Margin 0.2721, faded from the company's 0.31."
> confidence: `derived` · evidence_source: `damodaran_industry_2026-01-01`

That is stronger provenance than the hand-authored SpaceX cases carry, and it is
machine-generated rather than asserted. `three_p` follows the column: `probable`
where the benchmark rests on the full basket, `plausible` where screening
reduced it below the requested size.

`base_revenue` and `base_margin` come from statements rather than the benchmark,
so their claims name the statement years used and are tagged `derived` /
`probable`.

## Integration

### A separate case, not an override

Nothing existing changes. `corporate_dcf` keeps producing exactly what it
produces today; the conservative valuation is an additional stored case,
runnable through the existing `POST /api/v1/valuation/cases/{id}/run`.

This is a stronger form of the parallel-scenario promise than the first draft
had: the two valuations now come from *different engines*, so there is no shared
code path along which one could perturb the other. The regression guard is
correspondingly simpler — no existing test should change at all.

Case naming is `conservative_<TICKER>_<vintage>`, so re-running against a new
benchmark vintage creates a new case rather than silently mutating the old one,
and the two remain comparable. `create_case` already rejects duplicate names,
which makes regeneration explicit rather than accidental.

### Shape

```
packages/core_finance/industry_benchmark.py     pure: screening, ranking, averaging, fade
apps/api/services/industry_benchmark_store.py   storage, vintage handling, resolution
apps/api/services/industry_maps.py              the two checked-in map artifacts
apps/api/services/conservative_case.py          the case generator
```

`packages/core_finance` must not import from `apps/api`
(`guideline/sop/file-structure.md:42`). The screening, ranking and fade are pure
functions over plain data; the generator is a service because it reads
statements, the equity bridge and the benchmark store.

## Error handling

The governing rule: **a missing or unreliable benchmark produces no conservative
case, never a silently degraded one.**

| Condition | Behaviour |
| --- | --- |
| Ticker has no Yahoo industry | No case generated. Reason reported. |
| Yahoo industry not in the map | No case. Reason names the unmapped value, so the map can be extended. |
| Sector has fewer than 3 industries surviving screening | No case. Reason lists what was screened and why. |
| A column the generator needs loses too many candidates | No case. Unlike the first draft, a missing column cannot fall back to the company's own value: `roic_stable` and `margin_target` have no unfaded counterpart to fall back to. |
| No statements stored for the ticker | No case. `base_revenue` and `base_margin` have no source. |
| No benchmark vintage stored | No case. Reason distinguishes "never acquired" from "acquired but stale". |
| A case with the same name already exists | No new case; the existing one is returned. Regeneration is explicit, not accidental. |

Falling back to an all-industry average was considered and rejected: it would
produce a number that looks like a sector benchmark and is not one, which is the
failure mode this design exists to prevent.

Note the change from the first draft's per-column fallback. Against
`corporate_dcf` a missing column could leave the company's own assumption in
place, because every field had one. The segment engine's `margin_target`,
`roic_stable` and `sales_to_capital` are forward-looking inputs with no
"current" counterpart, so a missing benchmark column means the case cannot be
built at all.

## Testing

Network is prohibited in tests, and tests must not open
`data/processed/moneyview.db`. `tests/conftest.py` enforces both with autouse
session fixtures, and gives every test its own SQLite file via `_isolated_db`.

**Pure layer** (`packages/core_finance/industry_benchmark.py`)

- The worked example reproduces exactly — top-3 average after-tax ROC 0.3416,
  operating margin 0.2721, sales/capital 2.336, reinvestment 0.409.
- `Software (Internet)`'s 1414% reinvestment rate is screened out, and the
  basket's reinvestment average is computed without it.
- `Information Services`'s negative reinvestment is screened while its other
  columns still qualify — per-column independence.
- Each fade direction, both branches: a company above and below the benchmark,
  for a benefit field and a cost field.
- `sales_to_capital` fades DOWN when the company's ratio is higher. This is the
  direction most likely to be implemented backwards, and getting it wrong makes
  capital-hungry companies look cheaper.
- A company exactly at the benchmark does not move.
- Screening is exercised by a synthetic sector where a poisoned row ranks FIRST
  by ROC. In the real Technology rows the two defective industries rank last, so
  a test built only on real data would never fire the screen and would pass
  vacuously.

**Service layer**

- Vintage selection returns the newest vintage at or before a given date.
- Every error-handling row above produces no case and a distinct reason string.
- Round-trip: a stored vintage loads back with identical values.

**The case generator**

- A generated case passes `create_case` — which means every segment input
  carries a narrative, since `create_case` rejects any that does not. This is
  the test that proves the narrative rule is satisfied rather than worked
  around.
- Every generated narrative is tagged `derived`, never `confirmed`: the
  benchmark is a real average, but applying it to this company is inference.
- A generated case runs through `run_case` without raising, and produces a
  positive enterprise value.
- The money terms are in billions: a company with $400bn revenue yields
  `base_revenue == 400.0`, not `4.0e11`. A units error here is a 10⁹ error.
- `debt` and `cash` reconstruct the equity bridge: for a net-debt-positive
  company `debt > 0 and cash == 0`, and the reverse for a net-cash company.
- The case is reproducible: generating twice from the same vintage and the same
  statements yields identical inputs.

**Regression**

- The full existing suite passes unchanged. Because the conservative valuation
  runs on a different engine and stores a separate case, no existing test should
  need modification — if one does, the parallel-scenario promise has been broken
  and the change needs justifying rather than accommodating.

## Risks and limits

**The two maps encode my classification judgement.** Neither Yahoo's taxonomy
nor a sector grouping over Damodaran's 95 industries is a fact; both are
opinions checked into the repo. Every resolved benchmark carries its provenance,
and the maps are reviewable artifacts rather than embedded constants. A wrong
mapping produces a confidently wrong benchmark, and nothing in the design
detects that — only review does.

**One segment is a real simplification.** A conglomerate valued as a single
business against a single sector benchmark is being described crudely. The
engine supports multiple segments and the SpaceX cases use four; a listed
company simply has no published split to use. Where a company spans sectors,
the benchmark is the one its Yahoo industry names, and the provenance says so.

**Benchmarking against the top of a sector is a choice, not a neutral
baseline.** It is conservative for identifying undervaluation and
*anti*-conservative for identifying overvaluation: a company that looks
expensive against the best industries in its sector may be reasonably priced
against its actual peers. The verdict layer in sub-project 3 must state which
direction it is testing.

**US-only.** The dataset acquired here is `Industry Average Beta (US)`.
Damodaran publishes global and regional equivalents in the same shape. Non-US
holdings resolve to US industry benchmarks until those are added, and the
provenance must say so rather than let a US benchmark pass for a local one.

**Annual vintage means the benchmark is stale for most of the year.** A property
of the source, not a defect to engineer around. The vintage date is stored and
reported so the staleness is visible.

**The generated case competes with hand-authored ones.** The SpaceX cases were
authored deliberately, with argued narratives. Machine-generated cases will
outnumber them quickly. Case naming (`conservative_<TICKER>_<vintage>`) keeps
them distinguishable, but the case list will need a filter before it is usable
with a full watchlist.

## Resolved during design

`valuation_params_from_metrics` feeds `metrics.roic` into `operating_margin`
(`corporate_metrics_service.py:456`). Investigating this is what produced the
target-engine reversal above. Two findings:

1. `metrics.roic` is a genuine return on invested capital
   (`nopat / average_invested_capital`, `corporate_statement_metrics.py:389`),
   so the mapping is a real mislabelling.
2. It does not matter, because `operating_margin` never enters
   `corporate_dcf`'s arithmetic — it reaches the response payload and the
   `report_id` hash and stops there.

This design no longer touches `valuation_params_from_metrics`, so the
mislabelling is out of scope. It is recorded here because it is a live defect in
displayed output, and because the investigation that found it is the reason this
spec was revised.
