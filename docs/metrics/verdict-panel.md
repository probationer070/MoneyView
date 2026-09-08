# Verdict Panel

Three fields describing how the read-only evidence panel
(`GET /api/v1/valuation/verdict/{ticker}`) frames and gaps its price and
value signals — distinct from the panel's price-derived signal rows
themselves (`drawdown`, `volume`, `trailing_pe`; see `price-signals.md`).
`dcf_gap` is the fourth row on that same panel, and the one row that
consults a valuation model rather than reading price, volume, or earnings
directly — which makes it the row most easily mistaken for a return.
`direction` is the panel's fixed orientation text, identical for every
ticker and every request, not a computed verdict. `price_move_pct` belongs
to a different endpoint (investment decisions) but earns an entry here
because it is the number a reader is most likely to set beside `dcf_gap` on
a chart and treat as the same kind of quantity, which it structurally is
not: one carries a stated time horizon and the other carries none at all.

> **Note on scope.** `docs/superpowers/specs/2026-09-08-metric-reference-design.md`'s
> §5 structure table and `docs/superpowers/plans/2026-09-08-metric-reference.md`
> both still list `verdict-panel.md` at 6 entries. Both were written on
> 2026-09-08 as part of the original 50-candidate enumeration, *before*
> Task 1 read the actual source and confirmed what each family's candidates
> resolve to — `docs/metrics/inventory.md` is that confirmation, produced
> after the spec and the plan, and per this project's own override rule
> (`docs/metrics/README.md:29-30`, `task-3-brief.md:37`: "if the inventory
> disagrees with the spec, follow the inventory") it is authoritative where
> the two disagree. `inventory.md`'s table lists exactly three
> `verdict-panel` rows as "distinct" — `dcf_gap`, `direction` (the fixed
> framing constant), and `price_move_pct` — and no fourth, fifth, or sixth
> candidate for this family appears anywhere in its "distinct", "duplicate",
> or "not present" accounting. This file therefore has three entries, not
> the spec's or the plan's six. Neither the design spec nor the plan is
> modified here — both are historical planning documents outside this
> task's file list — this note exists so a reader landing on either of them,
> or on this file, does not have to wonder where three entries went.

### `dcf_gap`

Source: `apps/api/services/valuation_verdict.py:486` — `build_verdict`

**What it is.** How far the subject's DCF-modelled intrinsic value per share
sits above or below its latest close, as a fraction of that close.

**Why this metric.** It is the only verdict-panel row that consults a
valuation model — the ticker's stored "conservative" DCF case — rather than
reading price, volume, or earnings directly, which is what distinguishes it
from `trailing_pe` (a pure market-observed multiple, no model behind it) and
`drawdown` (a read of the stock's own price path, no value judgment at all).

**How it is calculated here.** `(intrinsic - price) / price` at
`valuation_verdict.py:486`, inline within `build_verdict` rather than a
named function. `intrinsic` is
`run_stored_case(case_id)["value_per_share_diluted"]` for the ticker's
conservative case (`find_conservative_case_id(ticker)`, line 456) — the same
`value_per_share_diluted` figure the `attribution-and-uncertainty` family's
Shapley contribution and Monte Carlo summary both operate on; `case_diff.py`'s
own module docstring makes the agreement explicit: "The metric is
value_per_share_diluted -- the same number valuation_verdict's dcf_gap row
consumes, so the two layers agree about what 'the valuation' is." `price` is
the latest usable close (`dated_closes[-1][1]`). No annualisation and no time
dimension of any kind — a single point-in-time ratio between one modelled
number and one observed-today number. Guards, each naming a distinct reason:
`no_case` if `find_conservative_case_id` finds no stored case for this
ticker — unless the industry benchmark itself never loaded at all, in which
case the row instead carries that upstream `no_vintage` reason, so the
ticker is not blamed for a global data-loading failure it had no part in
(lines 456-469); `insufficient_history` if there is no usable close;
`non_positive_price` if the latest close is `<= 0`; `invalid_case #{case_id}`
if the stored case itself fails to run (`ValueError`/`CaseNotFound` from
`run_stored_case`). Sign convention: positive means the model's intrinsic
value exceeds price (reads as undervalued under `DIRECTION`'s framing,
below); negative means the reverse.

**What it affects.** Only the verdict panel's `dcf_gap` row, alongside a
`comparison` string naming the two raw figures it was computed from
(`intrinsic {X} vs price {Y} as of {date}`). Nothing further downstream
reads this value; it feeds no rollup across the panel (see `direction`,
below).

**Where it is shown.** `GET /api/v1/valuation/verdict/{ticker}`, Valuation
tab, labelled "Gap to fair value" (`apps/web/app/valuation/verdictFormat.ts:23`),
whose own basis line under the figure reads "total gap, no time horizon"
(line 31).

**How to read it.** Unit: a dimensionless fraction of the latest close, with
no time dimension whatsoever — not an annualised return, not a return over
any stated holding period. `0.182` means the modelled intrinsic value is
18.2% above the current price; it does not mean an 18.2% gain is expected
over any particular year or holding period. It must never be subtracted from
or ranked against an annualised return (`market_expected_return`,
`capm_expected_return`, `dcf_implied_return`, or the
`discount-rates-and-returns` family generally) — those carry a horizon this
figure structurally lacks, and the two are not commensurable even though
both can be formatted as percentages.

**Common misreading.** Read as a return over a horizon — "this stock will
return 18.2% [this year / by some date]." `dcf_gap` is a snapshot valuation
gap, not a forecast with a time axis; comparing it to `price_move_pct`
(below) or to any `discount-rates-and-returns` figure treats two
differently-shaped quantities as though they answered the same question.
`apps/web/app/decisions/decisionTypes.ts`'s own comment draws the identical
line for the closely related `dcf_implied_return_pct`: "total upside with no
time horizon... Never combine them" with a figure that has one.

**Current state.** (2026-09-08) Measured by calling `build_verdict(ticker)`
for all 139 tickers in the live watchlist (`SELECT ticker FROM watchlist`
against `data/processed/moneyview.db`) and reading each result's
`["rows"]["dcf_gap"]["reason"]`. **30 of 139 currently return a value; 109
refuse** — all 109 with `no_case` (0 `no_vintage`, 0 `insufficient_history`,
0 `non_positive_price`, 0 `invalid_case`). Cross-checked directly against
the database: exactly 31 conservative cases are stored
(`SELECT COUNT(*) FROM valuation_case WHERE parent_case_id IS NULL`), one of
which (`TESTCO`) is not on the live watchlist — leaving exactly 30 watchlist
tickers with a stored conservative case, matching the 30 successes exactly.
Unlike `drawdown`/`trailing_pe`, whose refusals are dominated by an
automatic peer-set or industry-benchmark gate, `dcf_gap`'s refusals here are
entirely a manual precondition: whether a conservative case has been created
for that ticker at all. Re-measure rather than quote — this reflects only
which tickers currently have a stored case.

### `direction`

Source: `apps/api/services/valuation_verdict.py:29` — `DIRECTION`

**What it is.** A fixed sentence of framing prose returned alongside every
ticker's verdict panel, identical for every ticker and every request.

**Why this metric.** It is the field most likely to be mistaken for the
panel's actual output — a computed judgment about whether *this* ticker
looks under- or over-valued — when the module's own docstring is explicit
that it issues no such thing: "Reports each price-derived signal beside its
sector comparison and names the source that comparison came from. It issues
NO label and NO score." `direction` names the panel's fixed testing
orientation ("Testing UNDERVALUATION") and the basis-consistency caveat that
goes with it, not a per-ticker result.

**How it is calculated here.** Not calculated — a hardcoded Python string
constant, `DIRECTION = (...)` at `valuation_verdict.py:29-37`, assembled once
at import time and returned verbatim from every `build_verdict(ticker)` call
(`return {"ticker": ticker, "direction": DIRECTION, "rows": rows}`, line
491). There is no per-ticker branch, no conditional wording, and no
dependency on any of the four rows' outcomes — a ticker whose every row
refuses receives the exact same `direction` string as one whose every row
computes successfully. The string's own content states the reason no single
verdict is issued: the panel's rows are benchmarked against different bases
(a peer mean for `drawdown`, a baseline window for `volume`, a Damodaran
sector average for `trailing_pe`, a conservative DCF case for `dcf_gap`), and
only the sector-benchmarked rows carry the "conservative for undervaluation,
anti-conservative for overvaluation" caveat the constant states explicitly.

**What it affects.** Nothing computationally — it participates in no
calculation and gates no other field. It affects only what a reader is told
about how to weigh the rows that follow it.

**Where it is shown.** `GET /api/v1/valuation/verdict/{ticker}`, Valuation
tab, rendered as prose directly under the ticker name
(`apps/web/app/valuation/components/VerdictPanel.tsx:24-29`,
`data-testid="verdict-direction"`). The component carries two separate
comments making the same point: "Framing, rendered as prose. Not a headline
verdict." immediately above the rendered paragraph (line 23), and, in the
component's own doc comment, "`direction` is a fixed constant identical for
every ticker; the backend deliberately computes no verdict and neither does
this component" (lines 11-13).

**How to read it.** Not a value to compare across tickers — reading two
tickers' `direction` strings side by side and expecting them to differ finds
nothing, because there is exactly one string in the system's vocabulary. It
is instructions for reading the rows that follow, not a result derived from
them.

**Common misreading.** Read as a computed verdict — "the panel says AAPL is
testing undervaluation," as though this were a conclusion the backend
reached about AAPL specifically, rather than the fixed orientation every
request receives regardless of ticker or of whether any row computed a value
at all. The backend deliberately computes no rollup across the panel's rows
(`drawdown`, `volume`, `trailing_pe`, `dcf_gap`) because they are reported in
four different units — a fraction, a ratio, a multiple, and a dimensionless
gap — and combining them into one verdict would require weights the data
does not contain.

**Current state.** (2026-09-08) Confirmed by reading
`valuation_verdict.py:29-37` and `:491` that `DIRECTION` is a single
module-level string with no ticker-dependent branch anywhere in
`build_verdict`; every one of the 139 watchlist tickers' verdict responses
therefore carries byte-identical `direction` text — a direct consequence of
there being exactly one code path that ever sets this key, not something
that needed a per-ticker measurement. No coverage figure applies: there is
nothing here that succeeds or refuses per ticker.

### `price_move_pct`

Source: `apps/api/services/investment_decision.py:52` — `outcome_for`

**What it is.** The percentage change in a ticker's price from the day an
investment decision was recorded to the most recent close, recomputed fresh
every time the decision is read.

**Why this metric.** It sits beside `dcf_implied_return_pct` (a decision's
stored model-implied total upside, frozen at decision time, no time
horizon) as the opposite in both respects: it is a *realized* move, over a
horizon that is exactly stated (`decided_on` to `price_date`, both returned
alongside it), and it is recomputed on every read rather than stored.
`apps/web/app/decisions/decisionTypes.ts`'s own comment states the pairing
and the danger directly: both carry `_pct` "because they sit on the same
scatter and a raw fraction beside a percent would put them 100x apart," but
"`dcf_implied_return_pct` is total upside with no time horizon,
`price_move_pct` is a move over a stated period. Never combine them" — the
identical caution `dcf_gap`'s entry above states for the same reason.

**How it is calculated here.**
`(price_now - price_at_decision) / price_at_decision`, computed inline at
`investment_decision.py:52` within `outcome_for`, as a raw fraction under the
key `"price_move"` — converted to a percentage only at the wire boundary,
not in the service layer: `DecisionOutcome`'s `_price_move_to_percent`
validator (`apps/api/models/schema_parts/decision.py:45-52`) multiplies by
100 and renames the key to `price_move_pct` when the response model is
built. `price_now`/`price_date` are the latest bar with a non-null close
strictly after `decided_on`
(`investment_decision.py:39-43`: `str(bar["date"]) > decided_on` and
`close is not None`), loaded with a small limit
(`_OUTCOME_BARS_LIMIT = 30`, line 227) since only the newest qualifying bar
is ever needed. Never persisted: `get_decision`/`list_decisions` compute it
fresh on every read — `outcome_for`'s own function docstring
(`investment_decision.py:16-25`): "A persisted outcome is correct only until
the next bar arrives and then silently wrong, with nothing to reveal it;
computing on read cannot go stale." Guards: returns
`price_move: None` with a `reason` of `"no price recorded at decision time"`
if `price_at_decision` is `None` or `<= 0`, or `"no bar with a close after
{decided_on}"` if no qualifying bar exists.

**What it affects.** Only the decision's own `outcome.price_move_pct` field;
nothing else consumes it. It is charted alongside `dcf_implied_return_pct` on
the decisions scatter (`apps/web/app/decisions/decisionChartData.ts:43`) —
exactly the pairing the "never combine them" comment above guards against
being misread as commensurable.

**Where it is shown.** `GET /api/v1/decisions` and
`GET /api/v1/decisions/{id}` (`apps/api/routes/decisions.py:31-49`),
Decisions tab (`apps/web/app/decisions/components/DecisionList.tsx:40`).

**How to read it.** Unit: a percent (already multiplied by 100 at the wire
boundary, matching `dcf_implied_return_pct`'s unit so the two can share a
chart axis without a 100x scale mismatch) over the stated period from
`decided_on` to `price_date` — both dates travel with the figure precisely so
a reader is not left to guess the horizon. `None` means no outcome could be
computed yet (`reason` names why), not a zero move.

**Common misreading.** Read as commensurable with `dcf_implied_return_pct`
because both are percentages plotted on the same chart. The two answer
different questions — a realized move over a stated period versus a
horizonless modelled total upside — and must never be subtracted from or
compared directly against each other, per the frontend type's own comment. A
second, narrower misreading: treating a `null` value as "no move," when it
means the outcome could not be computed at all (no recorded price at
decision time, or no later bar).

**Current state.** (2026-09-08) The live `investment_decision` table
currently holds **0 rows** (`SELECT COUNT(*) FROM investment_decision`), so
there are no stored decisions to compute a refusal-rate split over today —
the two guards above (`no price recorded at decision time`, `no bar with a
close after {decided_on}`) are exercised per-decision as they are created and
read, not observable as a stored coverage figure the way the verdict-panel
rows are. Re-measure once decisions exist rather than assume either guard's
live hit rate.
