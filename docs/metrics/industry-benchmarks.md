# Industry Benchmarks

Five figures behind one feature: a sector reference computed from Damodaran's
US industry-average dataset, and the one adjustment that uses it to move a
company's own assumptions toward its sector's — never away. `column_by_key`
names the 13 declared columns (`packages/core_finance/industry_benchmark.py:53-79`)
and the plausibility band each is screened against; `screen_row` and
`screen_value` are the two independent screens — one on firm count, one on a
per-column band — that decide which raw data is thick and plausible enough to
average at all; `resolve_benchmark` runs both, ranks the survivors by
after-tax return on capital, and averages the top few into a
`SectorBenchmark`; `fade` is the only place a resolved benchmark reaches into
a stored valuation case. Entries below run in that pipeline order, not the
source file's line order or `inventory.md`'s listing order. All five are pure
functions in `packages/core_finance/industry_benchmark.py`; the only I/O —
loading a stored vintage and mapping a ticker to a sector — lives in
`apps/api/services/industry_benchmark_store.py` and
`apps/api/services/industry_maps.py`, neither of which is one of these five
metrics itself.

`apps/api/services/company_baseline.py` is the ticker-level entry point above
all of this: it assembles a company's own baseline figures and defines
`generate_conservative_case`, which calls `resolve_for_ticker` (→
`resolve_benchmark`) and `build_conservative_case` (→ `fade`,
`column_by_key`) in turn — but it never calls any of the five functions below
directly, confirmed by grep (`fade|screen_row|screen_value|column_by_key|
resolve_benchmark` matches nothing in that file). `.superpowers/sdd/2026-09-08-metric-reference/task-6-brief.md`
names `company_baseline.py` as a source for this family; `inventory.md:69-73`
names `apps/api/services/conservative_case.py` and
`apps/api/services/industry_benchmark_store.py` instead, as the actual call
sites. Per `docs/metrics/README.md`'s override rule, the inventory wins, and
every `Source:` line below cites the direct call site it names, not
`company_baseline.py`. This is a naming discrepancy, not a count one — both
the brief and `inventory.md` agree on exactly five entries for this family,
so no "Note on scope" applies here the way it does in `dcf-mechanics.md`.

### `column_by_key`

Source: `packages/core_finance/industry_benchmark.py:84` — `column_by_key`

**What it is.** The lookup from a benchmark column's short key (e.g.
`"operating_margin"`) to its full definition: the workbook header it is read
from, its unit, and the plausibility band `screen_value` checks it against.

**Why this metric.** Every other function in this file names a column by its
short key, not by position in `BENCHMARK_COLUMNS`; this is the one place that
mapping happens, so a caller's typo produces a naming error immediately
rather than a bare `KeyError` deep inside a comprehension.

**How it is calculated here.** Not a calculation — a dict lookup built once
at import (`_COLUMNS_BY_KEY`, line 81) over the module-level
`BENCHMARK_COLUMNS` tuple: 13 entries, 9 required and 4 optional
(`trailing_pe`, `price_to_book`, `ev_sales`, `stdev_price`, added later and
never rejecting an older workbook that lacks them, `industry_benchmark.py:46-50`).
`column_by_key` wraps the raw `KeyError` into a `ValueError` naming both the
unknown key and every valid one, sorted (lines 84-91) — confirmed directly by
calling it with a bogus key: it raises `ValueError: no benchmark column
named 'not_a_real_key'; known columns are ['after_tax_roc', ...
'unlevered_beta']` rather than a bare `KeyError`. Two call sites use it for
different reasons: `resolve_benchmark` (`:185`, `:199`) reads the full
`BenchmarkColumn` (unit and band, for ranking and per-column screening);
`apps/api/services/conservative_case.py:189` reads only `.required`, to build
`full_basket` — deliberately scoped to the nine pre-Task-3 columns so a
well-populated optional column cannot raise that denominator and loosen an
unrelated fade's `three_p` label (that file's own comment, lines 176-186).

**What it affects.** Every column-aware step downstream: `resolve_benchmark`'s
ranking and per-column averaging, `screen_value`'s band check, and (through
`.required`) `conservative_case.py`'s `full_basket` denominator for the
`three_p` confidence label on every faded field. `apps/api/services/company_baseline.py`
does not call it directly — it calls `resolve_for_ticker` and
`build_conservative_case`, which call this and the other four entries in this
file on its behalf.

**Where it is shown.** Not shown directly — it resolves the `BenchmarkColumn`
objects that `resolve_benchmark` and `fade` consume. HTTP-only, no UI, and
appears in no response body itself.

**How to read it.** Not a number — a registry lookup, keyed by the same
short strings (`operating_margin`, `after_tax_roc`, ...) that appear inside
`resolve_benchmark`'s stored narrative claims (see `fade`, below). An unknown
key is a refusal (`ValueError`), never a silent `None`.

**Common misreading.** Assuming every column this function can resolve is
fed into `fade`. It is not: `resolve_benchmark` screens and averages all 13
columns identically — three of them (`unlevered_beta`, `debt_to_capital`,
`reinvestment_rate`) are looked up, screened, and populated into
`SectorBenchmark.columns` exactly like the rest — but `FADE_DIRECTIONS`
(`industry_benchmark.py:237-247`) deliberately omits all three, because the
segment engine takes WACC directly rather than rebuilding it from beta and
leverage, and reinvestment is an engine *output*, not an input (the module's
own comment, `:230-236`). A resolved, populated column is not proof that
anything fades toward it.

**Current state.** (2026-09-09) Confirmed directly: `column_by_key("not_a_real_key")`
raises `ValueError` naming all 13 known keys (measured against the live
import, not merely read from source). Of the 13 declared columns, 6 have a
`FADE_DIRECTIONS` entry and are ever passed to `fade`; the other 7
(`debt_to_capital`, `unlevered_beta`, `reinvestment_rate`, and the four
optional price columns) are resolved and averaged but never faded. No
live-database coverage figure applies beyond this — it is a per-call lookup,
not a stored quantity.

### `screen_row`

Source: `packages/core_finance/industry_benchmark.py:103` — `screen_row`

**What it is.** The row-level filter that rejects one industry's entire
average as too thin to benchmark against, based only on how many firms it
was computed over.

**Why this metric.** It is a threshold, not a formula — the interpretive
weight is entirely in what `MIN_FIRMS` does operationally (excludes a row
from ranking *and* from every column's averaging, everywhere, not a soft
discount), not in any competing way to compute "thin."

**How it is calculated here.** `row.firms < MIN_FIRMS` (`MIN_FIRMS = 10`,
line 28), returning a human-readable rejection string naming the row, its
firm count, and the threshold, or `None` when the row is usable.
`MIN_FIRMS`'s own comment (lines 24-27) states its basis: firm counts in the
2026 vintage run 1 to 5,994 with a median of 34, and 10 is the observed 10th
percentile — chosen to reject the thinnest decile, not an arbitrary round
number. The rejection is unconditional: a thin row is dropped from
`resolve_benchmark`'s ranking entirely (`industry_benchmark.py:179-183`) and
therefore from every column's average, even a column where that row's own
value would have been perfectly plausible — `screen_row` has no per-column
exception.

**What it affects.** Whether an industry row enters `resolve_benchmark`'s
ranked list at all; a row it rejects contributes to no column's average,
appears in `SectorBenchmark.rejected` (not `.ranked`), and cannot be part of
any sector's top-N basket regardless of how strong its `after_tax_roc` is.

**Where it is shown.** Not shown directly — reflected only in which
industries appear in a resolved `SectorBenchmark`'s `ranked`/`rejected`
tuples, which are not themselves returned by any endpoint (see
`resolve_benchmark`, below, for where the averaged figures it feeds are
shown). HTTP-only, no UI.

**How to read it.** A pass/fail per industry row, not a graded confidence.
`screen_row(row) is None` means usable; anything else is the specific reason
it was not, always naming the row and its firm count.

**Common misreading.** Assuming a rejected row's underlying figures are
wrong or an "artifact," the way `screen_value`'s rejections are. They are
not: `screen_row` says nothing about whether the row's numbers are
plausible, only that too few firms stand behind them to trust the average at
all — a thin industry can have perfectly ordinary-looking figures and still
be excluded.

**Current state.** (2026-09-09) Measured against the live `2026-01-01`
vintage (94 industry rows, loaded via `load_vintage("2026-01-01")`): **9 of
94 rows fall below `MIN_FIRMS`** — Cable TV (9), Chemical (Diversified) (4),
Electronics (Consumer & Office) (8), Oil/Gas (Integrated) (4), Paper/Forest
Products (6), Reinsurance (1), Rubber& Tires (3), Shipbuilding & Marine (8),
Transportation (Railroads) (4). None of the 11 sectors in
`SECTOR_TO_INDUSTRIES` is left with too few surviving industries to resolve
a benchmark at all despite these exclusions — every sector still produces a
`SectorBenchmark` (see `resolve_benchmark`'s entry). Re-measure if a new
vintage is loaded; these counts are specific to `2026-01-01`.

### `screen_value`

Source: `packages/core_finance/industry_benchmark.py:113` — `screen_value`

**What it is.** The column-level filter that rejects one industry's value
for one column — missing, or outside a plausibility band tighter than
anything the valuation engine itself would reject — before it can enter that
column's average.

**Why this metric.** The formula (a range check) is trivial; the judgment is
which numbers are "a data artifact rather than an economic fact" for each of
the 13 columns, and the bands (`BENCHMARK_COLUMNS`, `industry_benchmark.py:53-79`)
are opinions about a specific dataset, not a derived statistical rule.
`BenchmarkColumn`'s own docstring states why the bands must be tighter than
the engine's own validation: `CaseSpec` accepts any `effective_tax_rate` in
`[0, 1]`, so 0.22 and 0.0022 are both legal there and only one is right — the
engine cannot catch a magnitude error that stays inside its own range.

**How it is calculated here.** `value is None` rejects outright ("no value
in this vintage"); otherwise `not column.low <= value <= column.high`
rejects with a message naming the value, the band, and the column's declared
unit. Every band is a specific, dataset-grounded choice, not a round
default — `reinvestment_rate`'s `[0.0, 2.0]` is the sharpest example: its own
comment (lines 65-71) states it rejects "the 11 negative rates and the three
genuine artifacts above it" (Steel 2.115, Insurance (General) 3.242,
Software (Internet) 14.142), sitting inside the observed gap between 1.888
and 2.115 so that ordinary capital-intensive reinvestment (five industries
between 1.522 and 1.888, kept) is not discarded alongside the artifacts.
This exact band was corrected once already: `ERROR-LOG.md`'s 2026-08-11
entry records an earlier `[0.0, 1.5]` bound that silently discarded those
same five legitimate industries as if they were artifacts, because the
original comment asserted "the three above 200%" without measuring the full
dataset — the bound was widened to `2.0` and the comment corrected only
after a reviewer checked it against all 92 industries then live. `MIN_FIRMS`
(`screen_row`, above) is a threshold on firm count; every one of these bands
is the same kind of judgment applied to a value's magnitude instead.

**What it affects.** Whether one cell (one industry, one column) enters that
column's average inside `resolve_benchmark`; a rejected cell removes only
that industry from that one column, never the whole row (`screen_row` is the
row-level filter, above) and never the industry's other columns.

**Where it is shown.** Not shown directly — reflected only in
`SectorBenchmark.rejected` and in which industries back a resolved column
average (see `resolve_benchmark`, below). HTTP-only, no UI.

**How to read it.** A pass/fail per (industry, column) cell. A rejection
names the actual value and the band it fell outside, so "no value in this
vintage" (missing) and "outside the plausible band" (present but
implausible) are distinguishable reasons, not the same failure.

**Common misreading.** Reading a screened-out value as evidence the
underlying industry is unusual or risky. The rejection is a judgment that
the *number* is a data artifact (a workbook error, a near-zero denominator
blowing up a ratio), not a claim about the industry's actual economics —
`reinvestment_rate`'s own screened artifacts are the clearest case: Software
(Internet)'s 14.14 does not mean the industry reinvests 1,414% of NOPAT, it
means the ratio's denominator was very small that year.

**Current state.** (2026-09-09) Measured directly against the live
`2026-01-01` vintage (94 rows) for every column: `reinvestment_rate` rejects
**18 of 94** (11 negative, 3 above the 2.0 band, 4 missing); `trailing_pe`
rejects **6** (3 missing, 3 implausibly high — up to 506.5 at Heathcare
Information and Technology); `after_tax_roc` rejects **4**, all missing (the
four bank/insurance/brokerage rows); `effective_tax_rate` rejects **3**, all
missing; `price_to_book` rejects **3** (1 missing, 2 implausibly high, up to
132.2). Every other column (`revenue_growth`, `operating_margin`,
`unlevered_beta`, `debt_to_capital`, `cost_of_capital`, `sales_to_capital`,
`ev_sales`, `stdev_price`) rejects none. Query: `screen_value(column,
row.values[column.key])` over every row for every `BENCHMARK_COLUMNS` entry,
against `load_vintage("2026-01-01")`. Re-measure if a new vintage is loaded.

### `resolve_benchmark`

Source: `packages/core_finance/industry_benchmark.py:155` — `resolve_benchmark`

**What it is.** The top-N-by-return average: the sector benchmark a
company's own assumptions are faded toward, built by ranking a sector's
industries by after-tax return on capital and averaging each column
independently over the top few survivors.

**Why this metric.** It answers "what does the best of this sector look
like," not "what does the average of this sector look like" — the
ranking-then-averaging shape is deliberate: benchmarking a company against
its sector's median would let a company merely as mediocre as its peers pass
as conservative, where benchmarking against the top few sets a genuinely
demanding bar.

**How it is calculated here.** Screens every row with `screen_row` (firm
count) and, separately, its `after_tax_roc` with `screen_value` (line 185) —
a row failing either cannot be ranked at all, and both rejections land in
the same `rejected` list. Sorts the survivors by `after_tax_roc` descending,
takes the top `top_n` (default 5), and refuses (`BenchmarkUnavailable`) if
fewer than `minimum` (default 3) survive — deliberately not a degraded
average over whatever is left: falling back to an all-industry average
"would produce a number that looks like a sector benchmark and is not one"
(the exception's own docstring, lines 126-132). Each of the 13
`BENCHMARK_COLUMNS` is then averaged *independently* over the basket,
screening every cell with `screen_value` again: a column with fewer than
`minimum` surviving cells is omitted from `SectorBenchmark.columns` entirely
rather than averaged over too few, so different columns of the same sector
benchmark can rest on different, and fewer, industries than the basket
size — `ranked`/`rejected` travel with the result specifically so an
unusually thin column average can be traced back to which industries backed
it and which were screened out.

**What it affects.** `apps/api/services/industry_benchmark_store.py:181`
(`resolve_for_ticker`) is the sole production caller, invoked with the
defaults (`top_n=5`, `minimum=3`) for every ticker; its result is the
`benchmark` argument `apps/api/services/conservative_case.py`'s
`build_conservative_case` fades a company's own assumptions against (see
`fade`, below). `apps/api/services/company_baseline.py` never calls this
function directly — it calls `resolve_for_ticker`, which calls this, as part
of `generate_conservative_case`.

**Where it is shown.** Never returned directly by any endpoint. Its resolved
values reach a reader only as prose inside a stored conservative case's
segment narratives (`_claim`, `conservative_case.py:110-118`: "Top N
industries by after-tax ROC in {sector} ({names}), vintage {vintage},
average {column} {value}..."), retrievable via `GET
/api/v1/valuation/cases/{case_id}`. HTTP-only — confirmed by grep, no page
under `apps/web` reads `segment_narrative`'s `claim`/`input_field` fields.

**How to read it.** A per-column average (same unit as the underlying
column: fractions for rates, ratios for multiples), always over the
sector's *best*-performing industries by after-tax ROC, never the sector's
typical one. A missing column in the result (see Real Estate, below) means
too few of the basket's industries had a usable value for it — not that the
sector's true average for that column is zero or unremarkable.

**Common misreading.** Treating "the top N by after-tax ROC" as "the N
largest" or "the N most representative" industries. Ranking is by after-tax
return on capital alone; a sector's biggest or most typical industries can
be entirely absent from the basket if their `after_tax_roc` ranks below the
cutoff, and the industries actually averaged are named in `ranked`/the
narrative claim specifically because that substitution is not visible from
the averaged number alone.

**Current state.** (2026-09-09) Measured against the live `2026-01-01`
vintage for every sector in `SECTOR_TO_INDUSTRIES`: **all 11 sectors resolve
successfully** (`resolve_benchmark` raises `BenchmarkUnavailable` for none of
them); basket size is the full `top_n=5` for 8 sectors and only 4 (below
`top_n`, still above `minimum`) for Financials, Energy, and Utilities, where
fewer than 5 industries in the sector survive row-level screening. Every
sector's benchmark carries all 13 columns except **Real Estate, whose
`reinvestment_rate` column is entirely absent**: 3 of its top-5 basket (Real
Estate (Development), Retail (REITs), R.E.I.T.) report a negative
reinvestment rate and are screened out, leaving 2 usable industries for that
column — below `minimum=3` — so the column drops out of the benchmark rather
than averaging over 2. Query: `resolve_benchmark(sector, [row for row in
load_vintage("2026-01-01") if row.name in SECTOR_TO_INDUSTRIES[sector]])`
for each of the 11 sectors. Re-measure if a new vintage is loaded or a
sector mapping changes.

### `fade`

Source: `packages/core_finance/industry_benchmark.py:250` — `fade`

**What it is.** The one-sided adjustment that moves a company's own
assumption toward its sector's top-industry benchmark — but only when the
company's own value is on the *less* conservative side of it; a company
already more conservative than the benchmark is left untouched.

**Why this metric.** The formula (linear interpolation to a target) is
uncontroversial; the interpretive weight is entirely in two choices this
function makes, both of which a reader could otherwise miss: *what it fades
toward* — not the sector average or median, but `resolve_benchmark`'s
top-N-by-return basket, a value most industries in the sector do not reach —
and *what "conservative" means per field*, which flips by field
(`FADE_DIRECTIONS`, `industry_benchmark.py:237-247`): a company assumed to
pay less tax or borrow more cheaply than its sector's best is being
flattered exactly as much as one assumed to earn a higher margin, so a
benefit-type input (margin, growth, return on capital, sales-to-capital
efficiency) fades *down* toward the benchmark while a cost-type input (tax
rate, cost of capital) fades *up*. The asymmetry itself — nothing ever fades
toward optimism — is the entire conservatism claim this feature makes about
itself: a laggard is never assumed to catch up to the best of its sector.

**How it is calculated here.** `company + (benchmark - company) * year /
horizon`, linear from the company's own value to the benchmark, reaching it
exactly at `year == horizon`; holds at the company's own value with no
adjustment when the company is already past the benchmark in the
conservative direction (`company <= benchmark` for `lower_is_conservative`,
`company >= benchmark` for `higher_is_conservative`) — there is no partial
move on the "already conservative" side, and a company exactly at the
benchmark does not move either way. Raises `ValueError` if `year` is not in
`[1, horizon]`. **The year-by-year interpolation this signature implies is
unused in production**: the sole production caller,
`apps/api/services/conservative_case.py`, always passes `year == horizon`
(`HORIZON_YEARS = 10`), degenerating every call to a min/max endpoint choice
between the company's own value and the benchmark — the segment engine
already interpolates internally (`margin_path`, `wacc_path`, `tax_rate_path`
in `segment_valuation.py`), so fading per year here on top of that would
apply convergence twice (the function's own docstring says so directly).
`build_conservative_case` (`conservative_case.py:193-213`) calls `fade` for
exactly six fields — `operating_margin`, `after_tax_roc`, `sales_to_capital`,
`revenue_growth`, `effective_tax_rate`, `cost_of_capital` — but stores a
justifying narrative claim (`_claim`/`_missing_claim`, naming the benchmark,
the company's own value, and the chosen endpoint) for only three of them:
`operating_margin` (narrated as `margin_target`), `sales_to_capital`
(narrated twice, once under each of the segment's two ratio fields,
`sales_to_capital_early`/`sales_to_capital_late`), and `revenue_growth`
(narrated as `revenue_target`) — four narrated output columns from three
narrated input fields. **The other three fades' meta dicts are discarded**
(bound to `_`): `after_tax_roc` at lines 217-218, alongside `effective_tax_rate`
and `cost_of_capital` at lines 226-229. This is a consequence of scope, not a
decision to omit these three specifically: `roic_stable`,
`effective_tax_rate`, and `wacc_initial`/`wacc_stable` are all case-level
fields, and this codebase's narrative-claim discipline (`NARRATED_FIELDS`,
`valuation_case.py:31-42`) applies only to segment-level fields, so there is
no case-level slot for any of the three claims to go in. **The gap this
leaves is unmarked, not merely undocumented**: a stored case's fields carry
no flag distinguishing a faded case-level value from one that was never
faded at all — `after_tax_roc` feeds `roic_stable` (`conservative_case.py:237`,
`roic_stable = min(faded_roc, implied_marginal_roc)`), which is exactly what
gates the `run_case` raise documented in this file's sibling
(`dcf-mechanics.md`'s `terminal_capital_intensity_change` entry), so the
missing provenance sits on a field with real downstream consequence, not an
inert one. When a benchmark column is absent from `resolve_benchmark`'s
result (dropped for too few surviving industries, per that entry), `fade` is
never called for it at all — `faded()`'s own `average is None` branch
(`conservative_case.py:200-208`) short-circuits to the company's own value
with `_missing_claim`, so `after_tax_roc` in a Real Estate case (see
`resolve_benchmark`'s entry) would be held unfaded, not faded against a
benchmark that does not exist.

**What it affects.** `margin_target`, `sales_to_capital_early`/`_late`,
`wacc_initial`/`wacc_stable` (kept equal to each other by construction),
`effective_tax_rate`, and (through compounding `base_revenue` at the faded
growth rate) `revenue_target` — every one of the segment inputs a stored
conservative case runs through the segment DCF engine. Through those, it
reaches `value_per_share_diluted`, the same figure the verdict panel's
`dcf_gap` (`verdict-panel.md`) and the attribution-and-uncertainty family
read.

**Where it is shown.** Never returned directly; the three narrated fades
(margin, sales-to-capital, revenue growth) are readable as prose via `GET
/api/v1/valuation/cases/{case_id}`'s segment narratives, HTTP-only, no UI.
The `wacc`/tax-rate fades are not narrated anywhere (see above) — only their
post-fade *values* are visible, as plain `wacc_initial`/`effective_tax_rate`
case fields on the same endpoint. Their downstream effect on
`value_per_share_diluted` reaches the Valuation tab through `dcf_gap`, same
as every other segment input.

**How to read it.** Same unit as the field being faded (a fraction, matching
both the benchmark dataset and the segment engine). A faded value sitting
exactly at the benchmark means the company's own figure was *at least* that
far from conservative and got capped there; a faded value equal to the
company's own original figure means the company was already on the
conservative side and nothing moved — the two cases are indistinguishable
from the number alone without also knowing the company's pre-fade figure,
which is why the narrative claim states both.

**Common misreading.** Reading a faded value as an observed figure for the
company — "this company's margin is 15%" — rather than a deliberately
conservative model input that may differ from the company's own reported
number specifically because the company's own figure was judged less
conservative than its sector's best. The claim text exists exactly to
prevent this: every narrated fade states the company's own value alongside
the chosen one, but a reader who only sees the stored case's numeric fields
(not the narrative) has no way to tell a held value from a moved one.

**Current state.** (2026-09-09) Measured against the live database's 30
stored `conservative_*` cases (of 31 total `valuation_case` rows; the
remaining one, `two_segment_parent`, is a hand-authored case with no sector
benchmark involved): across the three narrated fadeable fields,
**`margin_target` moved (was faded) in 22 of 30 cases and held at the
company's own value in 8; `sales_to_capital` moved in 3 of 30 and held in
27; `revenue_target`'s underlying growth rate moved in 15 of 30 and held in
15**. In none of the 30 stored cases did any of these three columns drop out
of its sector's benchmark (the `_missing_claim` "no usable sector average"
path was never taken). Query: for each `conservative_%` case, parsed each
segment narrative's `claim` text for "the company's own value is X; the
conservative endpoint is Y" and compared X to Y. Re-measure if new
conservative cases are generated.
