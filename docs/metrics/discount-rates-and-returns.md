# Discount Rates and Returns

Four return figures answering two different questions about the same set of
tickers: what return would a diversified, average-risk investment be expected
to earn under this model's stated risk assumptions (`market_expected_return`),
what return would this specific stock's own systematic risk imply investors
require (`capm_expected_return`), what return would buying at today's price
versus this codebase's own modeled intrinsic value imply
(`dcf_implied_return`), and how far the third of those sits above or below the
first (`expected_return_spread`). All four are computed in
`packages/core_finance/expected_return.py` and assembled into one payload by
`apps/api/services/corporate_comparison.py`'s `_dcf_snapshot`, which is why a
defect in any one of them was never contained to one column — see
`dcf_implied_return`'s entry, and `ERROR-LOG.md`'s 2026-08-03 record, for what
happened the one time that mattered.

> **Note on scope.** This file has 4 entries, not the 11 both
> `docs/superpowers/specs/2026-09-08-metric-reference-design.md`'s §5
> structure table and `docs/superpowers/plans/2026-09-08-metric-reference.md`
> still list `discount-rates-and-returns` at. Both were written as part of the
> original 50-candidate enumeration, before Task 1 read the actual source and
> confirmed what each family's candidates resolve to —
> `docs/metrics/inventory.md` is that later, source-backed confirmation, and
> per this project's own override rule (`docs/metrics/README.md:29-30`,
> `task-3-brief.md:37`) it wins where the two disagree. `inventory.md` lists
> exactly four `discount-rates-and-returns` rows as "distinct" —
> `market_expected_return`, `capm_expected_return`, `dcf_implied_return`,
> `expected_return_spread`, all in `packages/core_finance/expected_return.py`
> — and moves the plan's other seven candidates to "not present": all four
> functions in `packages/core_finance/hurdle_rate.py` (`calculate_crp`,
> `calculate_wacc`, `decompose_hurdle_rate`, `wacc_sensitivity`) and all three
> in `packages/core_finance/beta.py` (`unlever_beta`, `relever_beta`,
> `bottom_up_beta`) have zero callers anywhere under `apps/` — confirmed by
> `inventory.md`'s own repo-wide grep and independently reconfirmed while
> writing this file (`grep -rn "hurdle_rate" apps --include=*.py` and
> `grep -rn "unlever_beta\|relever_beta\|bottom_up_beta" apps --include=*.py`,
> both zero matches). Neither the design spec nor the plan is corrected here —
> both are historical planning documents outside this task's file list.
>
> **That does not mean this codebase reports no WACC or beta at all — it
> means the WACC and beta a reader actually sees are not the output of those
> two modules' formulas.** The WACC is reported at
> `apps/api/services/corporate_dcf.py:132` —
> `wacc = max(float(params.wacc), 0.001)` — a caller-supplied assumption
> floored at 0.001, not `hurdle_rate.py`'s `(E/V)r_e + (D/V)r_d(1-t)`
> decomposition. `unlevered_beta` is reported at
> `apps/api/services/corporate_dcf.py:309` as
> `params.unlevered_beta or (metrics.unlevered_beta if metrics else 0.0)` — a
> stored passthrough, not `beta.py`'s `unlever_beta` computation. Both are
> recorded in `inventory.md`'s "Follow-up candidates" table rather than
> silently dropped, and would earn entries of their own once someone
> documents `corporate_dcf.py`'s reported figures as-reported. That is out of
> scope for this file, which documents `expected_return.py`'s four functions
> and the values `corporate_comparison.py` builds from them — a separate
> service from `corporate_dcf.py`, with its own hand-rolled WACC computation
> (`corporate_comparison.py:384`, `wacc = max(float(metrics.wacc) / 100,
> 0.001)`) that the entries below mention only where it feeds one of the four
> figures documented here.

### `market_expected_return`

Source: `packages/core_finance/expected_return.py:32` — `calculate_market_expected_return`

**What it is.** The risk-free rate plus the equity risk premium — a single
baseline return figure, the same for every ticker in a given response.

**Why this metric.** It answers "what would a diversified, average-risk
portfolio be expected to return under the model's stated risk assumptions" —
a number that carries no information about any specific stock, which is what
distinguishes it from `capm_expected_return` (the identical additive shape,
but scaled by that ticker's own beta) and from `dcf_implied_return` (a
completely different formula driven by a modeled intrinsic value, not by risk
premia at all).

**How it is calculated here.** `float(risk_free_rate + equity_risk_premium)`
at `expected_return.py:38`, inside `calculate_market_expected_return`. No
beta term — this is CAPM with beta fixed at 1, though the function is not
named or documented that way. Both inputs are decimal fractions (the
function's own docstring: "e.g. 0.042 for 4.2%"), and the output is decimal
too. No annualisation logic of its own: the result is exactly as annualised
as its two inputs are, and both arrive as already-annual constants —
`apps/api/routes/corporate.py:165-166` passes
`DEFAULT_RISK_FREE_RATE = 0.042` and `DEFAULT_EQUITY_RISK_PREMIUM = 0.055`
(both defined at `apps/api/services/corporate_statement_metrics.py:32-33`),
fixed module-level constants, never fetched per ticker or per date. No guard
and no refusal path exists in this function or its caller: two floats in, one
float out, unconditionally — there is no `current_price`, `intrinsic_value`,
or `beta` dependency at all, which is the fact the rest of this entry turns
on.

**What it affects.** Reported directly as the comparison table's
`market_expected_return` column for every row, and consumed as the
subtrahend of `expected_return_spread` (below) for every row. It is also the
one field of these four that the endpoint can compute and return even when
it has no per-ticker rows at all — see Current state.

**Where it is shown.** `GET /api/v1/corporate/comparison`
(`apps/api/routes/corporate.py:146-171`), Corporate tab
(`apps/web/app/corporate/page.tsx`), rendered by
`CorporateComparisonTable.tsx`'s "Market Return" column and restated as prose
in `TargetStockComparisonSection.tsx:169` ("Market expected return formula:
risk-free rate + equity risk premium = …").

**How to read it.** Unit: a percent (multiplied by 100 and rounded to 2dp at
the wire boundary, `corporate_comparison.py:449`). Identical for every row in
a given response — it carries no per-ticker information, so it cannot be
sorted, ranked, or compared across tickers the way its three neighbours in
the same row can; each of those varies row to row, this one does not.

**Common misreading.** Read as a per-ticker figure, the way the other three
columns in the same table row are — assuming a row with a "high"
`market_expected_return` says something about that ticker, when in fact
every row in the same response carries the exact same value: it depends only
on the two fixed constants, never on anything about the ticker in that row.
Measured directly (Current state, below): all 140 rows in a live pull report
`market_expected_return = 9.7` without exception.

**Current state.** (2026-09-08) Measured by calling
`build_corporate_comparison_response(mode="live",
comparison_universe="portfolio_plus_benchmark", benchmark_ticker="^GSPC",
custom_tickers=[])` with the route's real `_metrics_for_ticker`/
`_latest_market_price` loaders against `data/processed/moneyview.db`. **All
140 returned rows report `market_expected_return = 9.7`, with no
variation** — exactly `round((0.042 + 0.055) * 100, 2)`. Separately,
`mode="snapshot"` (the endpoint's actual default,
`DEFAULT_SNAPSHOT_MODE = "snapshot"`) currently returns **zero rows** —
`SELECT COUNT(*) FROM corporate_comparison_snapshots_v3` is 0, so no snapshot
has ever been taken — yet still reports a live `market_expected_return: 9.7`
at the top level of the response (`_empty_snapshot_response`,
`corporate_comparison.py:472-473`), because that field alone needs no
per-ticker data to compute. Re-measure rather than quote; only the two
constants are load-bearing here, not the ticker universe.

### `capm_expected_return`

Source: `packages/core_finance/expected_return.py:41` — `calculate_capm_expected_return`

**What it is.** The risk-free rate plus that ticker's own beta multiplied by
the equity risk premium — the standard CAPM cost-of-equity formula.

**Why this metric.** It distinguishes itself from `market_expected_return` by
scaling the equity risk premium by the specific stock's own beta rather than
assuming beta = 1, and from `dcf_implied_return` by being a model-of-risk
figure (what return this stock's systematic risk alone implies investors
demand) rather than a model-of-value figure (what return buying at today's
price versus a modeled intrinsic value implies).

**How it is calculated here.**
`float(risk_free_rate + (beta * equity_risk_premium))` at
`expected_return.py:51`, inside `calculate_capm_expected_return`. Decimal in,
decimal out, no annualisation logic of its own — same as
`market_expected_return`. `risk_free_rate`/`equity_risk_premium` are the
identical fixed constants (0.042/0.055) `market_expected_return` receives.
`beta`, unlike those two, is ticker-specific: it is
`_levered_beta_from_metrics(metrics)`, computed inline at
`corporate_comparison.py:1129-1131` —
`max(metrics.unlevered_beta * (1 + (1 - DEFAULT_TAX_RATE) * debt_to_equity),
0.0)`, where `DEFAULT_TAX_RATE = 0.21` (`corporate_comparison.py:42`) and
`debt_to_equity = max(metrics.debt_ratio / 100, 0.0)`. This is the identical
Hamada relever expression `packages/core_finance/beta.py:23`'s
`relever_beta` defines (`β_L = β_U × [1 + (1−t)(D/E)]`), but hand-duplicated
rather than calling that function — flagged in `inventory.md`'s "Notable
findings": a future change to `beta.py`'s formula would not reach this call
site. **A second divergence worth flagging on its own: the local variable is
named `debt_to_equity`, but `metrics.debt_ratio` is defined elsewhere
(`corporate_statement_metrics.py:800-803`) as
`debt / (debt + equity) * 100`, bounded to `[0, 90]`** — a debt-to-capital
weight, not a debt-to-equity ratio. Feeding a `[0, 0.9]`-bounded
capital-structure weight into a formula whose textbook denominator is D/E
(unbounded above 1 for a levered firm) understates the leverage effect on
beta for any company whose true D/E exceeds roughly 9 (debt over 90% of
capital), and mislabels what the variable holds for every other company. No
guard beyond the `max(..., 0.0)` floor on the final beta (never negative);
`calculate_capm_expected_return` itself has no guard at all — unconditional
arithmetic once beta resolves.

**What it affects.** Reported directly as the `capm_expected_return` column.
Not consumed by any of the other three figures in this family — unlike
`dcf_implied_return`, which feeds two more.

**Where it is shown.** Same endpoint and screen as `market_expected_return`,
`CorporateComparisonTable.tsx`'s "CAPM Return" column.

**How to read it.** Unit: a percent, ticker-specific (varies row to row,
unlike `market_expected_return`). A low-beta stock (beta < 1) reads below
`market_expected_return`; a high-beta stock reads above it. Beta cannot go
negative here (the upstream `max(..., 0.0)` floor), so this figure cannot
fall below `risk_free_rate` itself as reported.

**Common misreading.** Read as the discount rate (WACC) actually used inside
this same ticker's DCF build in the very same response. It is not:
`capm_expected_return` is a stock-vs-market return comparison, entirely
separate from `metrics.wacc` — the cost-of-capital figure `_dcf_snapshot`
uses a few lines earlier to discount cash flows
(`corporate_comparison.py:384`, `wacc = max(float(metrics.wacc) / 100,
0.001)`). The two can and do differ for the same ticker in the same
response; reading `capm_expected_return` as "the WACC used" conflates a
return the model estimates the market requires with the structurally
unrelated, debt-weighted rate the DCF actually discounted at. A second,
codebase-specific misreading: assuming the beta feeding this formula came
from `packages/core_finance/beta.py`'s `relever_beta`. It did not — that
function is never called; the identical formula is reimplemented by hand at
`corporate_comparison.py:1129-1131`, fed a capital-structure weight
mislabeled as debt-to-equity (see above).

**Current state.** (2026-09-08) Measured in the same live pull as
`market_expected_return` (140 rows, `portfolio_plus_benchmark` universe,
real loaders): `capm_expected_return` ranges from **6.65 to 24.94** across
the 140 rows, confirming it does vary per ticker (unlike
`market_expected_return`'s fixed 9.7). This pass did not independently
verify any individual ticker's beta or debt ratio against an external
source — it confirms the formula's mechanics and its input provenance by
reading the code directly, not by re-deriving a "correct" beta to compare
against. Re-measure rather than quote the range, since both inputs move with
stored statement data.

### `dcf_implied_return`

Source: `packages/core_finance/expected_return.py:54` — `calculate_dcf_implied_return`

**What it is.** The percentage gap between a ticker's modeled intrinsic value
per share and its current price: `(intrinsic / price) − 1`.

**Why this metric.** It is the only one of this family's three "expected
return" figures actually driven by a valuation model's output, rather than by
risk premia alone — it answers "if the market price converged fully to this
DCF's intrinsic value, what return would that represent," a one-shot
convergence assumption with no stated time horizon, not a projected annual
return the way `market_expected_return`/`capm_expected_return` are commonly
read.

**How it is calculated here.**
`float((intrinsic_value / current_price) - 1.0)` at `expected_return.py:62`,
inside `calculate_dcf_implied_return` — guarded:
`if current_price <= 0: return 0.0` (`expected_return.py:60-61`, the
function's only guard). `intrinsic_value` and `current_price` are supplied by
the caller, `_dcf_snapshot` (`corporate_comparison.py:372-464`):
`current_price` comes from `price_loader(ticker)`; `intrinsic_value` is
`intrinsic_value_per_share` when the equity bridge resolves (`net_debt`,
`non_operating_assets`, `diluted_shares_outstanding` all present,
`corporate_comparison.py:396-418`), and **falls back to `current_price`
itself when the bridge does not resolve**
(`corporate_comparison.py:432-436`) — deliberately reproducing the exact
`f(price, price) = 0.0` shape `ERROR-LOG.md`'s 2026-08-03 entry records as
the historical defect, except now as an intentional, documented fallback for
a genuinely unresolved bridge rather than an accidental universal pin. **This
is the metric `ERROR-LOG.md` records as having been computed as
`f(price, price)` and pinned at `0.0` for every ticker** before the
2026-08-03 fix wired a real `bridge_loader` into `_dcf_snapshot`;
`stock_expected_return` is assigned literally from this value
(`expected_return.py:89`, `stock_expected_return=dcf_implied_return`), and
`expected_return_spread` (below) is derived from `stock_expected_return`,
which is exactly how one defect here became three wrong columns. No
annualisation: this is a single point-in-time percentage gap between two
numbers observed/modeled today, not a rate over any period. The API's own
`stock_expected_return_method` field (constant
`STOCK_EXPECTED_RETURN_METHOD = "dcf_implied_upside"`,
`corporate_comparison.py:36`) discloses the literal-copy relationship to any
caller who reads it, and the frontend does render it as prose ("Stock Return
Method: dcf implied upside", `TargetStockComparisonSection.tsx:215-218`) —
but separately from the table's own column headers, so a reader looking only
at the table does not necessarily connect the two.

**What it affects.** Feeds `stock_expected_return` (literal assignment) and
`expected_return_spread` (via `stock_expected_return − market_expected_return`);
reported directly as its own column.

**Where it is shown.** Same endpoint and screen, "DCF Return" column —
rendered as a clickable button (disabled only for the benchmark row) that
opens a calculation-detail view, unlike its three neighbours which are plain
text (`CorporateComparisonTable.tsx:106-110`).

**How to read it.** Unit: a percent. Sign convention: positive means
intrinsic value exceeds price (the model implies upside), negative the
reverse — the same sign convention as `dcf_gap`
(`docs/metrics/verdict-panel.md`), and in fact the identical formula shape,
but **not the same number** for a given ticker on a given day (see Common
misreading). A `0.0` reading no longer reliably means "the model found fair
value": it can mean the bridge did not resolve (that row's
`bridge_quality: "missing"`), `current_price <= 0` (`has_price_data: false`),
or a genuine coincidence of intrinsic value equalling price — the figure
alone does not distinguish the three.

**Common misreading.** Two, both specific to this codebase. First: mistaking
this for `verdict-panel.md`'s `dcf_gap`, because both are
`(modeled value − price) / price` with the same sign convention — they are
computed from two independent DCF pipelines (this family's ad hoc five-year
FCFF projection built inline in `corporate_comparison.py:383-394`, versus
`dcf_gap`'s read of a stored segment-level "conservative case" via
`run_stored_case`) and are not guaranteed to agree for the same ticker on the
same day; no code path reconciles them. Second: reading a reported `0.0` as
"the market has found fair value," the same misreading the original
ERROR-LOG defect produced structurally — except today it is sometimes
correct (a genuine coincidence) and sometimes the unresolved-bridge fallback
described above, and a row's own `bridge_quality`/`has_price_data` fields are
what distinguish the two, not the figure itself.

**Current state.** (2026-09-08) Measured via the same live pull as
`market_expected_return` (140 rows, real loaders, `portfolio_plus_benchmark`
universe): **7 of 140 rows report `dcf_implied_return == 0.0`, and those are
exactly the 7 rows with `bridge_quality == "missing"`** (a 1:1 match,
confirmed by cross-referencing both fields per row) — today's zero-pins are
the documented fallback described above, not a recurrence of the fixed
2026-08-03 bug. Separately, of the 133 nonzero rows, **98 (70%) report a
magnitude over 100%** (i.e. more than a full price double implied), several
in the thousands or millions of percent — e.g. `TMQ` at 6,550,788.6%, with
`bridge_quality: "ok"`, not a data-quality flag. This is driven by this
pipeline's five-year compounding of `metrics.growth` and the terminal
value's `0.005` denominator floor (`corporate_comparison.py:392`,
`terminal_value = terminal_cash_flow / max(wacc - terminal_growth, 0.005)`),
not a data defect and not related to the fixed 2026-08-03 bug — but it means
a reader cannot assume a triple-digit-or-larger `dcf_implied_return` is
itself evidence of a bug. Re-measure rather than quote; this reflects only
today's stored statement data.

### `expected_return_spread`

Source: `packages/core_finance/expected_return.py:65` — `calculate_expected_return_spread`

**What it is.** `stock_expected_return` minus `market_expected_return` — and
because `stock_expected_return` is always assigned directly from
`dcf_implied_return` (see that entry), this is, in practice,
`dcf_implied_return` minus `market_expected_return`.

**Why this metric.** It is this family's single "is this stock attractively
priced relative to the market baseline" figure. That distinguishes it from
`roic_minus_wacc` — an accounting return-on-capital spread, computed
entirely differently and shown in the same table row and the same
comparison chart — which measures how efficiently the company already
deploys its existing capital, not what the DCF implies about buying it
today.

**How it is calculated here.**
`float(stock_expected_return - market_expected_return)` at
`expected_return.py:71`, inside `calculate_expected_return_spread` — pure
subtraction, no guard, decimal in and percent-at-the-wire out (converted at
`corporate_comparison.py:450`, matching its siblings). Because
`ExpectedReturnResult.stock_expected_return` is assigned as
`dcf_implied_return` verbatim (`expected_return.py:89`) rather than an
independent CAPM- or market-based figure, this metric's name is doubly
misleading: "stock_expected_return" sounds like it should be
`capm_expected_return`'s stock-specific cousin, and
"expected_return_spread" sounds like it should net the DCF figure against
CAPM's, but it nets the DCF figure against the market baseline, never
against `capm_expected_return`.

**What it affects.** Reported directly, and charted
(`apps/web/app/corporate/components/TargetStockComparisonSection.tsx:400`, a
Recharts bar `dataKey`) as one of three selectable series alongside
`roic_minus_wacc` and `dcf_value` in the same `<select>` dropdown
(`TargetStockComparisonSection.tsx:293-297`).

**Where it is shown.** Same endpoint and screen, "Spread" column in the
table (bold, colored by sign — `text-[var(--delta-up)]` /
`text-[var(--delta-down)]`, `CorporateComparisonTable.tsx:118`), and the bar
chart above it.

**How to read it.** Unit: a percent, signed; positive means the DCF-implied
stock return exceeds the market baseline, negative the reverse. Inherits
every guard and fallback `dcf_implied_return` has (the unresolved-bridge
`0.0` fallback, the `current_price <= 0` guard), since it is built directly
on top of that value, offset by the fixed `market_expected_return` constant.

**Common misreading.** Two, both concerning what this figure is confused
with in the same UI. First: confusing it with `roic_minus_wacc`, which sits
in the same table row, the same chart-series dropdown, and answers a
superficially similar "spread" question but from accounting figures (return
on invested capital versus a blended cost of capital) rather than from a
DCF-vs-market comparison; the two do not move together and can carry
opposite signs for the same ticker. Second: assuming "stock" in
"`stock_expected_return`" names a CAPM-based, beta-adjusted figure
comparable to `capm_expected_return` — the only other beta-aware return in
the same table — when it is a verbatim copy of `dcf_implied_return`, so this
metric's real inputs are `(dcf_implied_return, market_expected_return)`,
never `capm_expected_return`.

**Current state.** (2026-09-08) Measured in the same live pull as the other
three entries: across the 140 rows, `expected_return_spread` ranges from
about **-155.56 to over 6,550,000**, for the same reasons
`dcf_implied_return`'s entry documents — `market_expected_return` is a fixed
9.7 subtracted from every row, so this figure's spread and its extremes
track `dcf_implied_return`'s directly. Re-measure rather than quote.
