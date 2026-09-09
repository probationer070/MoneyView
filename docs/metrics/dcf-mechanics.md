# DCF Mechanics

The discounted-cash-flow build itself: the primitives `packages/core_finance/dcf.py`
and `packages/core_finance/segment_valuation.py` supply for turning a projected cash
flow stream into a terminal value, an enterprise value, and a per-share figure. This
file documents what THIS implementation does with those textbook formulas -- which
guards refuse, which inputs are floored versus raised on, and, critically, which of
two competing DCF products in this codebase a given function actually feeds. It does
not re-derive DCF from first principles; see [`docs/dcf-valuation.md`](../dcf-valuation.md)
for that.

Two DCF products exist side by side and neither subsumes the other:
`apps/api/services/corporate_dcf.py` values a single FCFF stream over a fixed
five-year horizon at a constant WACC (`corporate_dcf.py`'s own headline computation,
plus the `dcf.py`-powered sensitivity grid built alongside it);
`packages/core_finance/segment_valuation.py` values a case built from named business
segments, each with its own revenue path and capital intensity, consolidated into one
FCFF stream discounted at a time-varying WACC (`segment_valuation.py`'s own module
docstring makes the non-overlap explicit). The first five entries below are
`dcf.py` primitives, organised around the first product -- though two of them
(`calculate_equity_value`, `calculate_intrinsic_value_per_share`) are shared by
the second product as well, as their own entries note; the last three entries are
specific to the second product.

> **Note on scope.** The plan that scoped this file
> (`.superpowers/sdd/2026-09-08-metric-reference/task-6-brief.md`) lists nine
> `packages/core_finance/dcf.py` functions as this family's sources, including
> `calculate_fcff`. `docs/metrics/inventory.md:99,117` moved `calculate_fcff` to
> "not present": a repo-wide grep (`grep -rn "calculate_fcff" apps/`) returns zero
> matches, and the function is unreachable even from `packages/core_finance` itself --
> both `multi_stage_dcf` and `sensitivity_grid` take a pre-computed FCFF list as an
> argument rather than deriving one, so nothing in this codebase, live or internal,
> ever calls it. That is exactly the "not present" test this reference's sibling
> files (`price-signals.md`, `discount-rates-and-returns.md`) already apply to their
> own dropped candidates. This file therefore documents the inventory's confirmed
> eight (`inventory.md:58-65`), not the brief's nine; `docs/metrics/README.md`'s
> family table carries the corrected count and this same explanation.

### `calculate_terminal_value`

Source: `packages/core_finance/dcf.py:41` — `calculate_terminal_value`

**What it is.** The Gordon-growth present value of every cash flow beyond an
explicit forecast horizon, collapsed into one number: `terminal_cash_flow / (WACC -
growth_rate)`.

**Why this metric.** It is the mechanism by which a finite forecast (five years,
or a segment case's target year) stands in for cash flows extending forever. It is
also, per the finding below, the entry most likely to be mistaken for the DCF
report's own headline number, when in the reported production path it never runs.

**How it is calculated here.** `terminal_cf / (wacc - growth_rate)`, raising
`ValueError` if `wacc <= growth_rate` (`dcf.py:53-57`) -- the model is undefined at
or below that boundary, and the function does not floor the denominator to produce
a large-but-finite number instead. **This function has exactly one call path in
production, and it is not the DCF report's headline number.** It is called only
from `multi_stage_dcf` (`dcf.py:145`), which is called only from `sensitivity_cell`
(`dcf.py:206`), which is called only from `sensitivity_grid` (`dcf.py:251`), which
`apps/api/services/corporate_dcf.py:230` calls to build the "WACC x Terminal
Growth Sensitivity" grid *alongside* the headline valuation -- not to produce it.
The headline `terminal_value` field on the same report
(`corporate_dcf.py:156-157`: `terminal_cash_flow / max(wacc - terminal_growth,
0.005)`) is a second, independently hand-written expression: same numerator, but a
**floor** at 0.005 rather than a raise. In practice the floor is currently
unreachable through the API -- `terminal_growth` is clamped upstream to at most
`wacc - 0.005` (`corporate_dcf.py:133`), so `wacc - terminal_growth` is always
`>= 0.005` by construction -- but the two protective mechanisms are not the same
code, and a future change to either clamp could make them diverge. `sensitivity_cell`
itself pre-checks `wacc <= 0` and `wacc <= terminal_growth` (`dcf.py:201-204`) and
returns an all-`None` "undefined" cell *before* calling `multi_stage_dcf` at all --
so `calculate_terminal_value`'s own `ValueError` is, through the shipped grid,
unreachable dead code: the caller already filters out every input that would
trigger it.

This is a measured divergence, not just a theoretical one. `dcf.py:236-239`
documents the grid's centre (`is_base`) cell as reproducing the headline
valuation "exactly." It does not, and two tests already say so:
`tests/api/test_corporate_dcf_sensitivity.py::test_the_base_cell_reproduces_the_reported_enterprise_value`
(lines 92-102) asserts agreement only to `abs=0.01`, with its own comment stating
why -- "the two paths really are different code... multi_stage_dcf publishes 2dp
and the report 4dp, so agreement can only be asserted to the coarser of the two" --
and the sibling `test_the_base_cell_reproduces_the_reported_per_share_value`
(lines 105-113) carries that same 0.01 through the equity bridge, pinning
per-share agreement to `abs=0.01/15.0`, tighter than the discussion below might
suggest. The headline path sums FIVE *already-rounded-to-4dp* per-year present
values (`corporate_dcf.py:146-155`); the grid path (`calculate_npv`, below) sums
the *unrounded* present values and rounds only the total, to 2dp. I measured this
directly rather than take the comment's word for it: calling
`build_dcf_full_report` for every ticker in the live watchlist (`SELECT ticker FROM
watchlist` against `data/processed/moneyview.db`) with the same loaders
`apps/api/routes/corporate.py`'s bulk-report route uses, then comparing each
report's headline `enterprise_value` to its own sensitivity grid's `is_base` cell:
**115 of 139 tickers produced a comparable pair** (the other 24 raised a pydantic
`ValidationError` building inputs from stored data, unrelated to this divergence
and not investigated further here). Across those 115, the two paths' enterprise
values differed by as much as **$0.005bn** (ticker `TRP`: base cell 232.2 vs.
headline 232.205) and the per-share values by as much as **$0.346** (ticker `TWIN`:
18495.071 vs. 18494.7251) in absolute terms -- small relative to either figure.
Measured in *relative* terms instead, the worst case is a different ticker
entirely: **`MSTR`'s base cell (0.0204) and headline (0.0264) per-share figures
are both themselves tiny, so their $0.006 gap is a 22.7% disagreement** on the
number a reader acts on -- not small at all, even though the absolute dollar
amount is the smallest in the sample. Only 1 of 109 tickers with a measurable
relative divergence exceeds 1% and 3 exceed 0.1%, so the rounding-order
explanation above still accounts for the size of every divergence measured; it
is only the "small relative to either figure" framing that does not survive the
worst live case.

**What it affects.** Only the sensitivity grid's per-cell `enterprise_value`,
`terminal_value`, `pv_terminal`, `tv_share_pct`, and (through the shared equity
bridge) each cell's `intrinsic_value_per_share`. It does not affect the same
report's own headline `terminal_value`, `enterprise_value`, or
`intrinsic_value_per_share` fields.

**Where it is shown.** `POST /api/v1/corporate/dcf/{ticker}/report` and the bulk
variant, in the `sensitivity` field; Corporate Analysis tab, "WACC x Terminal
Growth Sensitivity" table (`apps/web/app/corporate/components/DcfSensitivityTable.tsx`),
for every cell except those rendering `undefined_reason` as "n/a".

**How to read it.** A dollar amount (billions, matching the rest of the DCF
report), already discounted to the base year -- this is the terminal *value*, not
yet its present value (`pv_terminal = tv / (1+wacc)^n` is the separate discounting
step). It exists only where `wacc > growth_rate`; where the grid does not (a
`wacc_not_above_terminal_growth` or `wacc_not_positive` cell), there is no
number to read at all, not a large one.

**Common misreading.** Assuming this function computes the DCF report's headline
`terminal_value` field. It does not: that field is a separate, hand-written
expression in `corporate_dcf.py` with a floor instead of a raise. This function
is reachable only through the sensitivity grid, and even there its output matches
the headline number only to the coarser of the two paths' rounding precision
(measured above), not exactly -- despite the source's own docstring saying
"exactly."

**Current state.** (2026-09-09) Measured against the live watchlist as described
above: of 139 tickers, 115 produced a valid `is_base` grid cell to compare;
maximum observed enterprise-value divergence from the headline figure was
$0.005bn, maximum per-share divergence $0.346, both consistent with the
rounding-order explanation the existing unit test already gives rather than with
a larger, unexplained disagreement. Re-measure if either path's rounding
precision changes.

### `calculate_npv`

Source: `packages/core_finance/dcf.py:61` — `calculate_npv`

**What it is.** The present value of a series of cash flows discounted at one
constant rate: `Σ CF_t / (1 + r)^t` for `t = 1..n`.

**Why this metric.** It is the closed-form explicit-period discounting primitive
this module offers -- the same role `corporate_dcf.py`'s own per-year loop plays
for the headline report, computed independently rather than through this function.

**How it is calculated here.** Vectorised over NumPy: `t = 1..len(cash_flows)`,
`Σ cf / (1+r)^t`. Returns `0.0`, not `None` or an error, for an empty
`cash_flows` list (`dcf.py:67-68`) -- a deliberate zero, not a refusal, since an
empty explicit-forecast period is a valid (if degenerate) all-terminal-value case.
**Same production reach as `calculate_terminal_value` above: this function is
called only from `multi_stage_dcf` (`dcf.py:143`), reached only through the
sensitivity grid.** The DCF report's own headline explicit-period present value
(`present_value_of_fcff`, `corporate_dcf.py:155`, summing `DCFProjectionRow`) is a
separate, hand-rolled loop: each year's present value is computed and rounded to
4 decimal places individually (`corporate_dcf.py:149-153`), and the *rounded*
per-year values are summed. `calculate_npv` sums the *unrounded* per-year values
and the aggregate is rounded once, to 2dp, inside `multi_stage_dcf`
(`dcf.py:152`). This is the specific mechanism behind the measured divergence
documented under `calculate_terminal_value` above -- the same rounding-order
difference, applied to the explicit-period component rather than the terminal
one.

**What it affects.** Only each sensitivity-grid cell's `pv_explicit`, folded into
that cell's `enterprise_value` -- not displayed as its own column, only via the
aggregates it feeds.

**Where it is shown.** Same grid as `calculate_terminal_value`: `POST
/api/v1/corporate/dcf/{ticker}/report`, Corporate Analysis tab's sensitivity
table -- indirectly, through `enterprise_value` and `intrinsic_value_per_share`
per cell, never as a standalone `pv_explicit` figure.

**How to read it.** A dollar amount (billions), already discounted -- not a rate,
not a multiple. `0.0` on an empty cash-flow list means "no explicit period was
supplied," not "the explicit period is worthless."

**Common misreading.** Assuming this function discounts the explicit-period cash
flows shown in the DCF report's own projection table
(`DCFProjectionRow.present_value`). It does not; that table's rows come from a
separate, hand-rolled loop in `corporate_dcf.py` that rounds each year
individually before summing, which is what makes the grid's aggregate a close but
not identical match to the report's own `present_value_of_fcff`.

**Current state.** (2026-09-09) Confirmed by reading `dcf.py:61-71` and
`corporate_dcf.py:139-155` side by side that the two summation orders differ as
described. No separate live measurement of `pv_explicit` alone was taken; it is
one term inside the `enterprise_value` divergence already measured under
`calculate_terminal_value`, not a quantity reported on its own.

### `calculate_net_debt`

Source: `packages/core_finance/dcf.py:87` — `calculate_net_debt`

**What it is.** Total debt minus cash and cash equivalents -- the standard
enterprise-to-equity bridge term for a company's net leverage.

**Why this metric.** It is the one bridge input whose *absence* this function
refuses to paper over: a missing cash balance is not a zero cash balance, and
reporting total debt unadjusted would silently overstate net debt by the entire
cash position.

**How it is calculated here.** `float(total_debt) - float(cash_and_equivalents)`,
returning `None` -- not raising, not substituting zero -- if *either* argument is
`None` (`dcf.py:102-104`). A negative result is valid and deliberately preserved:
a company holding more cash than debt raises equity value above enterprise value,
and the function does not clamp that at zero. Called from exactly one production
site, `apps/api/services/equity_bridge.py:101` inside `_net_debt_input`, which
supplies both arguments only for the single most recent balance-sheet period
where a debt figure and a cash figure are reported *together*
(`equity_bridge.py`'s `co_dated` period-intersection logic, described in full in
`docs/dcf-valuation.md`'s "Where the bridge inputs come from" section) -- if no
period carries both, this function is never called and `net_debt` is reported
`missing` outright. **A second DCF product computes the identical one-line
formula by hand instead of calling this function:** `segment_valuation.py:971`
(`run_case`) passes `net_debt=case.debt - case.cash` straight into
`calculate_equity_value`, never through `calculate_net_debt` -- same arithmetic,
duplicated rather than shared, so a future change to this function's guard
(the `None`-propagation rule) would not reach the segment-model bridge.

**What it affects.** `apps/api/services/equity_bridge.py`'s `net_debt` bridge
input and its `net_debt_meta.quality`; gates whether the DCF report's `equity_value`
and `intrinsic_value_per_share` compute at all -- `corporate_dcf.py`'s
`_bridge_to_per_share` (lines 360-361) returns `(None, None)` before ever calling
`calculate_equity_value` if `net_debt is None`, and both the headline and every
sensitivity-grid cell run through that same guard.

**Where it is shown.** Corporate Analysis tab, Calculation Detail modal's "Net
Debt" row (`apps/web/app/corporate/components/CalculationDetailModal.tsx:480`,
labelled "Enterprise-to-equity bridge input").

**How to read it.** A dollar amount (billions). Positive means more debt than
cash; negative means a net cash position, which *raises* equity value relative to
enterprise value rather than lowering it.

**Common misreading.** Reading a `None`/missing net debt as "assumed to be zero."
It is not: `None` means the two input line items never shared a reporting
period in the stored data, and the report refuses to bridge to equity value at
all rather than guess -- a materially different state from a company whose net
debt happens to measure at exactly zero.

**Current state.** (2026-09-09) Measured by calling `load_equity_bridge(ticker)`
for all 139 live watchlist tickers and reading each result's `net_debt.quality`:
**133 of 139 report `ok`; 6 report `missing`; none reported `estimated`** on this
measurement (the fallback to Yahoo's own undocumented `Net Debt` line, per
`docs/dcf-valuation.md`, was not exercised by any ticker currently stored).
Re-measure rather than quote -- this reflects only the statement data stored
today.

### `calculate_equity_value`

Source: `packages/core_finance/dcf.py:74` — `calculate_equity_value`

**What it is.** The standard enterprise-to-equity bridge:
`enterprise_value - net_debt + non_operating_assets`.

**Why this metric.** It is the single point through which every DCF product in
this codebase converts a firm-level valuation into an equity-holder figure --
shared code specifically so the bridge rule cannot drift between a headline
number and the numbers computed alongside it.

**How it is calculated here.** The literal three-term formula, with no guard of
its own -- callers are expected to have already resolved `net_debt` (this
function has no `None`-branch; a caller passing `net_debt=None` gets a `TypeError`
from the subtraction, not a clean refusal). Every current caller guards first:
`corporate_dcf.py`'s `_bridge_to_per_share` (lines 360-361) returns `(None, None)`
before calling this function if `enterprise_value is None or net_debt is None`;
`corporate_comparison.py:406-413` (`_build_live_rows`) only calls it `if net_debt
is not None else None`. `non_operating_assets` is different: an absent value is
summed as `0.0` at each call site (`... or 0.0`), not refused -- "estimated," per
`docs/dcf-valuation.md`, meaning the term is treated as immaterial when unknown
rather than blocking the bridge. **Used identically across all three DCF products
in this codebase**: `corporate_dcf.py`'s `_bridge_to_per_share` (for *both* the
headline valuation and every sensitivity-grid cell -- "One home for that rule,"
per its own docstring at lines 347-359), `corporate_comparison.py`'s
`_build_live_rows` (the Corporate Comparison table's own DCF-implied value per
row), and `segment_valuation.py`'s `run_case` (line 969, the segment/conservative
case, with `net_debt` computed inline rather than via `calculate_net_debt` --
see that entry above).

**What it affects.** `equity_value` on the DCF report (headline and every
sensitivity cell), on each Corporate Comparison row, and on every segment-model
case (feeding `value_per_share_basic`/`value_per_share_diluted`, which in turn
feed the verdict panel's `dcf_gap` and the attribution-and-uncertainty family).

**Where it is shown.** Corporate Analysis tab (Calculation Detail modal's
"Equity Value" row, and every sensitivity-grid cell's derived per-share figure);
Corporate Comparison table; indirectly, the Valuation tab's `dcf_gap` row (via
`segment_valuation.py`'s `equity_value`, see `verdict-panel.md`).

**How to read it.** A dollar amount (billions), the same unit as
`enterprise_value`. It is not itself per-share -- `calculate_intrinsic_value_per_share`
(below) is the separate division step.

**Common misreading.** Assuming the three DCF products' `equity_value` figures
share a common provenance because they call the same function. They share only
the *formula* -- each supplies its own, independently sourced `net_debt` and
`non_operating_assets` (a store-loaded bridge for the corporate products, hand-
specified case fields for the segment model), so two `equity_value` figures for
the same ticker computed by different products are not directly comparable
without also comparing their inputs.

**Current state.** (2026-09-09) Confirmed by reading all three call sites
(`corporate_dcf.py:363-367`, `corporate_comparison.py:406-410`,
`segment_valuation.py:969-973`) that each supplies its own independently-resolved
`net_debt`/`non_operating_assets` pair rather than sharing one. No single
coverage figure applies across three different call sites with three different
gating rules; see `calculate_net_debt`'s entry above for the corporate bridge's
own measured `ok`/`missing` split.

### `calculate_intrinsic_value_per_share`

Source: `packages/core_finance/dcf.py:107` — `calculate_intrinsic_value_per_share`

**What it is.** Equity value divided by diluted shares outstanding -- the
per-share figure a reader compares directly against a quoted stock price.

**Why this metric.** It is the last step of the bridge, and the one that makes
a DCF valuation commensurable with a market price at all; everything upstream
(`enterprise_value`, `calculate_equity_value`) is denominated in aggregate
dollars, not per share.

**How it is calculated here.** `equity_value / diluted_shares_outstanding`,
raising `ValueError` if `diluted_shares_outstanding <= 0` (`dcf.py:116-120`) --
a hard raise, not a `None`-return, unlike `calculate_net_debt`'s soft refusal.
Every current caller pre-filters around that raise rather than catching it:
`corporate_dcf.py`'s `_bridge_to_per_share` (lines 368-372) only calls this
function `if diluted_shares_outstanding is not None and diluted_shares_outstanding
> 0`, otherwise returning `(equity_value, None)` directly; `corporate_comparison.py:414-418`
guards identically. **Used across the same three DCF products as
`calculate_equity_value`**: `corporate_dcf.py` (headline and every sensitivity
cell), `corporate_comparison.py`, and `segment_valuation.py`'s `run_case`, which
calls it *twice* per case with two different share counts --
`value_per_share_basic` (line 994, `shares_basic` alone: "what existing holders'
shares are worth before an IPO/funding raise") and `value_per_share_diluted`
(line 1003, `shares_basic + shares_new`: "what a share is worth post-money,
proceeds and the new shares that raised them both included") -- a distinction
that belongs entirely to what each caller passes in, not to this function, which
only divides.

**What it affects.** `intrinsic_value_per_share` on the DCF report (headline and
every sensitivity cell), each Corporate Comparison row's per-share figure, and
`value_per_share_basic`/`value_per_share_diluted` on every segment-model case --
the latter is the exact figure the verdict panel's `dcf_gap` and the
attribution-and-uncertainty family's Shapley contribution and Monte Carlo
summary all read (see those files).

**Where it is shown.** Corporate Analysis tab ("Intrinsic Value / Share" row and
every sensitivity-grid cell's upper figure); Corporate Comparison table;
Valuation tab's `dcf_gap` row (via `value_per_share_diluted`, HTTP-adjacent
through `run_stored_case`).

**How to read it.** A dollar-per-share figure, directly comparable to a quoted
price. It is never negative unless `equity_value` itself is negative (a company
whose bridge leaves it owing more than it is worth), which the function does not
special-case.

**Common misreading.** Reading "diluted" in `value_per_share_diluted` as the
accounting diluted share count -- issued shares plus options, convertibles and
the rest of the conventional dilution -- the way the same word means on the
corporate DCF report. In the segment model it does not: the denominator is
`case.shares_basic + case.shares_new` over an equity value that *includes*
`case.ipo_proceeds` (`segment_valuation.py:969-973,1003`), so "diluted" here
means **post-money**, the new shares and the money they raised both counted in.
Its sibling `value_per_share_basic` (`:994-1000`) is the pre-money figure --
`shares_basic` alone, over an equity value computed without the proceeds. The
corporate DCF report's own `intrinsic_value_per_share` divides by
`diluted_shares_outstanding`, the statement's diluted average share count
(`equity_bridge.py:140-150`), which is the conventional meaning. Two figures,
one word, two different denominators -- and it is the segment model's
post-money one that the verdict panel's `dcf_gap` compares against a quoted
market price. A second, narrower misreading: treating a `ValueError` surfacing
from this function as a data problem discovered here. Every caller already
refuses to invoke it with an invalid share count and substitutes `None`, so
this exception reaching the API boundary means a caller skipped its own guard
-- a code defect there, not a refusal path this function signals.

**Current state.** (2026-09-09) Confirmed by reading all guarded call sites
(`corporate_dcf.py:368-372`, `corporate_comparison.py:414-418`,
`segment_valuation.py:994-1005`) that each pre-filters the share count before
calling this function. No case of the raise actually surfacing through the API
was found or measured; the guards make it structurally unreachable through the
current callers, not merely unobserved.

### segment revenue path

Source: `packages/core_finance/segment_valuation.py:388` — `revenue_path`

**What it is.** Projected revenue for one business segment across every year of
its forecast horizon, dispatched among four structurally different shapes,
guaranteed to land exactly on the segment's own target-year revenue.

**Why this metric.** It is the segment-model DCF's (`segment_valuation.py`)
counterpart to `corporate_dcf.py`'s single `base_fcff * (1+g)^t` growth
assumption -- but instead of one constant growth rate, a segment's revenue curve
can take one of four shapes depending on which optional fields its `SegmentSpec`
sets, which is the source of most of this function's interpretive risk: two
segments in the same case can be following visibly different curves with no flag
in the reported numbers distinguishing which.

**How it is calculated here.** Dispatch order, per the function's own docstring
(`segment_valuation.py:391-404`): (1) a segment starting from a zero base
(`ramp_start_year > 1` or `base_revenue == 0`) ramps *linearly* from zero to
target (`_ramp_revenues`) -- no growth-rate curve can reach a positive target
from a base of zero; (2) `waypoint_gap_fraction` set: the "gap-closing" curve
transcribed from Damodaran's own SpaceX spreadsheets (`_gap_closing_revenues`),
in which growth *rates* are an output, not an input, and can jump discontinuously
at the midpoint rather than decay smoothly; (3) `initial_growth` set: growth
anchored to that observed year-1 rate and humped in between to still land on
target (`_anchored_growth_rates`); (4) otherwise: growth decays from a solved
year-1 rate down to the stable rate (`_decaying_growth_rates`), making year 1 the
fastest year. Guards: refuses (raises) if target revenue is not positive, if
`base_revenue` is negative, or if a non-zero `base_revenue` is combined with
`ramp_start_year > 1` (incoherent: a segment already earning revenue cannot also
be a delayed-start ramp). **Only one of the four shapes is exercised by anything
that reaches a reader today.** `apps/api/services/conservative_case.py:295-297`
hardcodes every auto-generated conservative case's segments to
`ramp_start_year=1, initial_growth=None, waypoint_gap_fraction=None` -- shape (4),
the decaying-growth default -- and 30 of the 31 stored `valuation_case` rows in
the live database are exactly such an auto-generated conservative case. The
remaining row, `two_segment_parent`, is a hand-authored case (0 forked, per
`attribution-and-uncertainty.md`'s Shapley entry) -- but both of its segments
also set `ramp_start_year=1, initial_growth=NULL, waypoint_gap_fraction=NULL`,
the same shape (4), so every one of the 31 stored rows currently exercises this
shape regardless of how it was created. The other three shapes are reachable
only through a hand-authored `POST /api/v1/valuation/cases` payload specifying
different `SegmentSpec` fields directly -- a real, HTTP-only capability, but
one no case in the live database currently uses.

**What it affects.** Feeds `ebit` (`revenue x margin`), which feeds `reinvestment`
(below) and `fcff`, which feed `enterprise_value`/`equity_value`/
`value_per_share_diluted` for the segment-model case -- the same figure the
verdict panel's `dcf_gap` and the attribution-and-uncertainty family read.

**Where it is shown.** The raw per-year revenue array: `GET`/`POST
/api/v1/valuation/cases/{case_id}` and `/run` (HTTP-only, no UI -- confirmed by
grep, `apps/web` has no reference to the case-run response's `revenue` field).
Its downstream aggregate, `value_per_share_diluted`, reaches the Valuation tab
through `dcf_gap`.

**How to read it.** A dollar amount (billions) per forecast year, one array per
segment. It always terminates exactly on `target_revenue()` in the final year --
comparing year-over-year growth rates across the four shapes without first
checking which shape a segment uses will misread a discontinuous jump (shape 2)
as an error, or a delayed ramp's zero years (shape 1) as "no revenue assumed" when
it means "not yet started."

**Common misreading.** Assuming every segment in a case follows the same kind of
revenue curve, or that the shape is visible anywhere in the reported output.
Neither holds: the shape is a silent consequence of which optional `SegmentSpec`
fields were set when the case was authored, not a labelled field on the segment's
own reported revenue array.

**Current state.** (2026-09-09) Confirmed directly: `conservative_case.py:295-297`
hardcodes shape (4) for every auto-generated case; 30 of the 31 stored
`valuation_case` rows are auto-generated conservative cases, and the
remaining row, `two_segment_parent`, is a hand-authored case whose two
segments also happen to set the shape-(4) fields. No stored case currently
exercises shapes (1), (2), or (3) -- re-measure if a hand-authored case
setting different `SegmentSpec` fields is ever created.

### sales-to-capital reinvestment

Source: `packages/core_finance/segment_valuation.py:485` — `reinvestment`

**What it is.** Capital consumed by a segment in a given year, derived from that
year's revenue growth and an assumed sales-to-capital efficiency ratio:
`(Rev_t - Rev_{t-1}) / sales_to_capital_t`.

**Why this metric.** It is the *only* reinvestment mechanism the segment model
carries -- there is no separate capex, depreciation, or working-capital schedule
to reconcile against. A dollar of revenue growth here always consumes capital at
a rate fixed entirely by the `sales_to_capital` assumption -- there is no way for
this model to represent, say, capex running ahead of or behind revenue growth in
a given year.

**How it is calculated here.** `(revenue - previous) / ratio`, where `ratio` is
`sales_to_capital_early` for years 1 through 5 and `sales_to_capital_late`
thereafter (`segment_valuation.py:510-514`, `_EARLY_YEARS = 5`). Years before
`ramp_start_year` book zero regardless of the revenue series
(`segment_valuation.py:506-509`) -- redundant in practice for a from-zero ramp
(whose revenue delta is already zero), but the guard stays because this function
is public and takes an arbitrary `revenues` list, not only one `revenue_path`
produced. The sales-to-capital ratios themselves are validated at `SegmentSpec`
construction (both must be positive), not inside this function.

**What it affects.** Summed into `fcff` (`ebit[t] - tax[t] - reinvest[t]`) for
the segment case, and separately reported as `reinvestment_rate_target_year` and
`explicit_reinvestment_rate_at_stable_growth` diagnostics. Feeds
`enterprise_value`/`value_per_share_diluted` the same way `revenue_path` does,
above.

**Where it is shown.** The raw per-year reinvestment array:
`GET`/`POST /api/v1/valuation/cases/{case_id}` and `/run` (HTTP-only, no UI).
Its downstream aggregate reaches the Valuation tab through `dcf_gap`, same as
`revenue_path`.

**How to read it.** A dollar amount (billions) per forecast year, subtracted
from EBIT after tax to reach FCFF -- capital *consumed*, not capital available. A
segment with `sales_to_capital` set very high reports very little reinvestment
per dollar of new revenue, which reads as capital-efficient growth regardless of
whether that efficiency assumption is realistic for the segment in question.

**Common misreading.** Treating this figure as decomposable into separate capex
and depreciation components. It is not: this is a single lump derived purely
from the revenue delta and one assumed ratio, with no separate depreciation
add-back or working-capital term anywhere in the segment model.

**Current state.** (2026-09-09) Confirmed by reading `segment_valuation.py:485-517`
that the ramp-year guard and the early/late ratio switch are the only two branches
in the function. No live-data coverage figure applies beyond what `revenue_path`'s
entry above already measured (all 31 stored cases use the same segment shapes),
since this function runs unconditionally over whatever revenue series it is
given.

### `terminal_capital_intensity_change`

Source: `packages/core_finance/segment_valuation.py:951` — `run_case`

**What it is.** How much more (or less) capital the terminal-perpetuity block
implies per dollar of new revenue than the model's own target-year marginal
return would require: `marginal_roic_target_year / roic_stable - 1`.

**Why this metric.** A terminal return on capital below the target year's own
marginal return is not a bug in this model -- Damodaran's own reference
templates do exactly this (see below) -- but it is a real, checkable assumption
a reader could otherwise miss entirely, since nothing about the headline
valuation number signals it on its own.

**How it is calculated here.** `target_year_marginal_roic / case.roic_stable - 1`
at `segment_valuation.py:951-953`, where `target_year_marginal_roic` comes from
`marginal_roic` (line 927, a capital-weighted return across segments -- see that
function's own extensive derivation comment). **Reported, not enforced, and only
since 2026-08-11.** The constant's own comment (`segment_valuation.py:38-58`)
records that a hard bound used to reject a drift larger than 60%, until reading
Damodaran's own SpaceX spreadsheets found his terminal ROIC (0.15) implies a
+578%/+501% change against his own target-year marginal returns -- an order of
magnitude past the old bound, on the exact source this model reproduces. The
bound was removed; this field now only reports the size of the drift. **A
one-sided guard remains, and it is asymmetric with what gets reported**: `run_case`
still raises outright (`segment_valuation.py:939-946`) if
`case.roic_stable > target_year_marginal_roic * (1 + 1e-9)` -- a terminal return
*above* the target year's marginal one has no mechanism in this model (margins
have already converged, `sales_to_capital_late` does not change afterward) and is
refused before this field is ever computed. So in every case that actually
produces a `terminal_capital_intensity_change`, the value is `>= 0` to floating
tolerance -- a genuinely negative drift is a 422 refusal, not a reported negative
number.

**What it affects.** Nothing downstream computationally -- it is a reported
diagnostic that gates no other field and is not summed or averaged into any
other metric.

**Where it is shown.** `GET`/`POST /api/v1/valuation/cases/{case_id}` and `/run`.
HTTP-only, no UI -- confirmed by grep, `apps/web` has no reference to
`terminal_capital_intensity_change`.

**How to read it.** A dimensionless fraction, `>= 0` in every case this model can
currently produce (see above). `0.0` means the terminal block reinvests at
exactly the target year's own marginal rate per dollar of new revenue; `3.31`
(the largest value measured live, below) means the terminal block implies
capital intensity 331% higher than the target year's own economics would
suggest.

**Common misreading.** Reading a large positive value as evidence of a
modelling error. The source's own history argues the opposite: Damodaran's own
reference case implies a change an order of magnitude larger than this
codebase's own former (and since-removed) hard bound, and treating a large drift
as inherently wrong would flag the exact reference the model is built to
reproduce. The converse assumption -- that a small value is automatically safer
-- also does not follow; this is a surfaced-for-judgement diagnostic, not a
model-validity signal.

**Current state.** (2026-09-09) Measured directly against the live database:
calling `run_stored_case` for all 31 stored `valuation_case` rows (30 root
auto-generated conservative cases plus the hand-authored `two_segment_parent`,
per the measurement in `revenue_path`'s entry above) and reading each result's
`terminal_capital_intensity_change`. **0 of 31 are negative
beyond floating-point tolerance (minimum observed: -1.1e-16, i.e. exactly zero);
9 of 31 are strictly positive, up to a maximum of 3.3125** (331%). The remaining
22 report exactly zero -- `roic_stable` set equal to the segment's own
target-year marginal return. Re-measure rather than quote; this reflects only
the cases currently stored.
