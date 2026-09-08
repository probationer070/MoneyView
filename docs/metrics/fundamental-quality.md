# Fundamental Quality

Seven figures answering how efficiently a company turns capital into after-tax
operating profit, how fast its revenue is growing, and — for two of them —
whether the resulting number is even trustworthy enough to act on. All seven
live in `packages/core_finance/corporate_statement_metrics.py` and are wired
into the app by `apps/api/services/corporate_statement_metrics.py`, which
duplicates the same functions privately under leading-underscore names near
the top of that file and then immediately shadows every one of them with a
`from packages.core_finance.corporate_statement_metrics import ... as
_name` block (`apps/api/services/corporate_statement_metrics.py:599-623`).
Because Python resolves a module-level name at call time, the later import
wins for every call site in the file — the earlier private definitions
(`apps/api/services/corporate_statement_metrics.py:291-596`) are dead code,
never reached at runtime. This reference documents the live code path: the
`packages/core_finance` functions, as consumed through those import aliases.

NOPAT and average invested capital feed ROIC, which is one number computed
three different ways depending on a caller-chosen basis; ROIC quality does not
grade that number on a scale, it decides whether to trust it and says why not
when it doesn't. Revenue growth has the identical basis-dispatch shape, and
growth quality is the identical kind of trust gate, but built differently in
one important way documented in its own entry below. Effective tax rate is
the one shared input NOPAT, ROIC, and WACC (a `discount-rates-and-returns`
sibling figure, computed in `apps/api`, not documented here) all read from
the same single computation, reused verbatim rather than recomputed per
consumer.

### NOPAT

Source: `packages/core_finance/corporate_statement_metrics.py:279` — `calculate_nopat`

**What it is.** Operating income after a normalized tax deduction — the
after-tax operating profit a company generates before financing effects, the
numerator of ROIC.

**Why this metric.** It isolates operating performance from capital
structure: unlike net income, NOPAT does not fall when a company borrows more
(interest expense never enters it), which is exactly why it, not net income,
is what ROIC divides by invested capital. It answers "how much after-tax
operating profit did the business's operations themselves produce," not "how
much was left for shareholders after financing costs."

**How it is calculated here.** `operating_income * (1 - tax_rate)`
(`:284`), where `tax_rate` is not computed inside this function — it is
supplied by the caller, always `stable_tax_result`'s output in this codebase
(see the `effective tax rate` entry below), never a per-year statement tax
rate for the same year as the operating income. `operating_income` is
normalized through `safe_number` first; if it is `None`, `NaN`, or infinite,
the function refuses outright and returns `{"nopat": None, "nopat_note":
"Missing operating income."}` (`:281-282`) rather than substituting zero or
any other placeholder — there is no fallback NOPAT value. No sign check: a
negative `operating_income` produces a negative NOPAT (never floored at
zero), and no bound on the tax rate is applied here — `calculate_nopat`
trusts whatever `tax_rate` it is handed; the `[0.15, 0.30]` clamp lives
entirely in `stable_tax_result`, one layer up. There is no annualisation
step — the function is agnostic to whether `operating_income` is a single
fiscal year, a trailing sum, or anything else; `build_roic_records` (`:349`)
is what decides it is always a single fiscal year's operating income per
call, one call per year in `roic_years`.

**What it affects.** The numerator of `roic_decimal`/`roic_percent` in every
`roic_records` entry (`:387`, `build_roic_records`); nothing else in this
codebase reads a standalone NOPAT figure outside the ROIC pipeline.

**Where it is shown.** `GET /api/v1/corporate/metrics/{ticker}/audit`
(`apps/api/routes/corporate.py:448-469`), as the "NOPAT" row of the ROIC
audit's `inputs_used` table (`apps/api/services/corporate_statement_metrics.py:1491`,
labeled and formatted as money). Rendered by `MetricAuditPanel`'s
`AuditInputsTable` (`apps/web/components/ui/MetricAuditPanel.tsx:8-31`) in
both the Corporate tab's calculation-detail modal
(`apps/web/app/corporate/components/CalculationDetailModal.tsx:299`) and the
Portfolio tab's stock detail modal, "ROIC Audit" panel
(`apps/web/app/portfolio/components/StockDetailModal.tsx:628`). Never shown
on the plain `/metrics/{ticker}` response — `CorporateMetrics`
(`apps/api/models/schema_parts/corporate.py:194-215`) has no NOPAT field at
all.

**How to read it.** Unit: money, same currency and scale as the statement's
`operating_income` line (unscaled — not billions, not per-share). Sign
follows `operating_income`'s own sign; it can be negative. It is a single
fiscal year's figure, not an average or a trailing sum — even when the ROIC
it feeds is reported on a `recent_average` or `all_year_average` basis (see
that entry).

**Common misreading.** Reading the NOPAT figure shown in the audit table as
"the NOPAT behind this ROIC number" when the ROIC basis is not `annual`.
`_select_roic_record` (`apps/api/services/corporate_statement_metrics.py:999-1009`)
always returns the **latest year's** record for any non-`annual` basis,
regardless of which years the reported ROIC value actually averaged over —
so for the default `recent_average` basis (a 3-year average of yearly ROIC
percentages, see the `ROIC` entry), the NOPAT and invested-capital figures
displayed alongside it in the same audit panel are one specific year's
values, not any average matching the displayed ROIC. Measured directly
(2026-09-08): recomputing `NOPAT / average invested capital` from the two
audit-displayed figures and comparing to the audit's own displayed `roic`
value, across all 135 tickers with locally stored statements
(`recent_average` basis, the app's default), **102 of 135 (76%) diverge by
more than 0.5 percentage points** — e.g. AAPL's displayed ROIC reads 60.69%
while its displayed NOPAT/invested-capital pair implies 66.60%. This is not a
rounding artifact; it is the structural consequence of showing a single
year's inputs beside a multi-year-averaged output. Query: iterate
`metric_audit_for_ticker` for every `DISTINCT ticker` in
`corporate_statements`, compare `roic.value` to
`100 * inputs_used["nopat"].value / inputs_used["average_invested_capital"].value`.

**Current state.** (2026-09-08) The mismatch above is real and current, not
historical — it was found while writing this entry and has not been reported
or fixed. It sits in `apps/api/services/corporate_statement_metrics.py`
(`_select_roic_record`, `metric_audit_for_ticker`), one layer above the
`packages/core_finance` function this entry documents, but it is the
direct consequence of how that layer surfaces NOPAT alongside a
basis-dispatched ROIC. Reported here rather than fixed, per this task's
scope. Missing-operating-income refusals were not separately tallied in this
pass; every one of the 135 stored tickers produced *some* NOPAT figure for at
least its latest year (the `computed=None` cases in the `ROIC` entry's
Current state are revenue-history refusals upstream of NOPAT, not NOPAT
refusals themselves).

### average invested capital (ROIC denominator)

Source: `packages/core_finance/corporate_statement_metrics.py:314` — `average_invested_capital_result`

**What it is.** The denominator of ROIC: the average of a company's invested
capital (equity plus interest-bearing debt) at the end of the current
statement year and the end of the prior year.

**Why this metric.** Dividing a full year's NOPAT by a single point-in-time
capital balance overstates or understates ROIC whenever capital moved a lot
during the year (a large buyback, a debt raise, an acquisition); averaging
the two year-end balances is the standard correction. It is a distinct
entry from `invested_capital` itself because the averaging window, and what
happens when the prior year is unavailable, is exactly the kind of variant
choice a textbook definition leaves open and this code closes one specific
way.

**How it is calculated here.** `calculate_invested_capital(equity, debt)`
(`:289-311`) is called twice — once for the current year's equity/debt, once
for the prior year's (`current_equity - 1`, `current_debt - 1` in the caller,
`build_roic_records:363-368`) — and `average_invested_capital_result`
(`:314-346`) averages the two ending balances: `(current_ic + previous_ic) /
2`. Within `calculate_invested_capital` itself: `invested_capital = equity +
debt` — **gross debt, not net of cash**, and no adjustment for goodwill,
minority interest, or operating leases; this is the plainest textbook
variant, not the "equity + net debt" or "total assets − non-interest-bearing
current liabilities" variants also in common use. The two inputs are not
treated symmetrically: `equity` missing (`safe_number` returns `None`)
refuses outright (`"Missing total stockholder equity."`, `:292-296`), but
`debt` missing silently becomes `0.0` (`safe_number(debt) or 0.0`, `:291`) —
a company with no reported debt line is treated as debt-free, not as
data-missing. Two further guards apply to each year's invested capital
independently: `invested_capital <= 0` refuses (`:298-302`), and
`invested_capital < 1,000,000` (`MIN_INVESTED_CAPITAL`, an absolute-currency
floor, not a ratio) refuses as "too small; ROIC denominator unstable"
(`:303-307`). If the current year fails either guard, the average is `None`
outright — the prior year is never consulted (`:320-329`). If only the prior
year fails, `average_invested_capital_result` **falls back to the current
year alone** as the "average" (`used_previous: False`,
`:330-339`) rather than refusing — so a value carrying no averaging at all
can still be labeled and consumed exactly like a genuinely averaged one, the
only trace of the substitution being the `average_ic_note` string and the
`used_previous_capital` flag, neither of which appears in the number itself.

**What it affects.** The denominator of `roic_decimal`/`roic_percent` for
every year in `roic_records` (`build_roic_records:371-390`), and, via
`selected_average_capital`, two of the five `assess_roic_quality` checks
(`unstable_roic_denominator`, `missing_average_invested_capital` — see that
entry).

**Where it is shown.** `GET /api/v1/corporate/metrics/{ticker}/audit`, as
four separate rows of the ROIC audit's `inputs_used` table — "Invested
capital", "Beginning invested capital", "Ending invested capital", "Average
invested capital"
(`apps/api/services/corporate_statement_metrics.py:1494-1497`) — all four
sourced from the same single selected record. Rendered by the same
`MetricAuditPanel` locations as NOPAT, above.

**How to read it.** Unit: money, same scale as the statement. Always
positive when present (both guards above rule out zero or negative). A
`used_previous_capital: False` selected record (visible only via the
`average_invested_capital_note` text, not a dedicated boolean field in the
API response) means the "average" is really just the current year's ending
balance — most commonly a ticker's earliest available statement year, where
no prior year exists to average against. Measured directly (2026-09-08):
across all 485 per-ticker-year `roic_records` produced from the 135 locally
stored tickers, **139 (29%) used the current-year-only fallback** rather
than a genuine two-point average; the remaining 346 (71%) averaged both
years. Query: call `build_roic_records` for every stored ticker and tally
`used_previous_capital` across every record in `roic_records`.

**Common misreading.** Assuming a missing debt line means the company's debt
is *unknown* and the figure should be treated as suspect for that reason —
in fact a missing debt line is treated as *zero* debt (see the asymmetric
guard above), silently, with no note or warning distinguishing "debt
confirmed at zero" from "debt line absent from the statement." A reader
comparing two companies' invested capital cannot tell, from the figure or
its note, whether a low invested-capital, low-debt company genuinely
carries little debt or simply has an unreported debt line being read as
zero.

**Current state.** (2026-09-08) Guards and the fallback behavior confirmed
directly against `calculate_invested_capital` and
`average_invested_capital_result`'s source (`:289-346`). The 139/485
fallback-usage figure above is measured against
`data/processed/moneyview.db`'s current `corporate_statements` contents; it
will shift as more statement years accumulate. Not independently re-derived
against an external invested-capital figure for any ticker — this pass
verifies the code's own arithmetic and guard behavior, not whether $1M is
the "right" stability floor.

### ROIC

Source: `packages/core_finance/corporate_statement_metrics.py:349` — `build_roic_records`

**What it is.** Return on invested capital — NOPAT divided by average
invested capital, expressed as a percentage — reported on one of three
selectable bases: a single fiscal year, a trailing multi-year average of
yearly ROIC values, or an average across every stored year.

**Why this metric.** It is this family's single "how efficiently does the
business turn capital into after-tax profit" figure, independent of how that
capital is financed (debt vs. equity) — which is what separates it from a
plain profit margin (revenue-based, not capital-based) and from the
`discount-rates-and-returns` family's return figures (market-return
estimates, not accounting efficiency measures).

**How it is calculated here.** `build_roic_records` (`:349-397`) computes
one record per year in `matching_years(operating_income, debt, equity)` —
the intersection of years present in all three inputs, most recent five
(`matching_years:245-251`) — combining that year's `calculate_nopat` and
`average_invested_capital_result` into `roic_decimal = nopat /
average_invested_capital` and `roic_percent = roic_decimal * 100`
(`:372-373`); a year is silently dropped from `roic_points` (not
zero-filled) if either input is `None`. **Which of those per-year values is
reported is a separate dispatch**, `roic_value` (`:499-509`), keyed by a
`roic_basis` string with three real behaviors: `"annual"` with a `roic_year`
returns that specific year's `roic_percent`, falling back to the latest
year if that year has no value; `"all_year_average"` averages every stored
year's `roic_percent` (up to 5); anything else — including this codebase's
own default, `"recent_average"` — averages **only the trailing 3 years**
(`values[-3:]`) of `roic_percent`, an average of yearly *ratios*, not a
ratio built from summed NOPAT and summed capital across those years. Because
`roic_points` can already have gaps (a year dropped for missing NOPAT or
invested capital), a `"recent_average"` result can legitimately be an
average of fewer than 3 years with no separate flag distinguishing that
from a full 3-year average — the `non_annual_roic_basis` warning
(`ROIC quality`, below) fires identically either way. `apps/api`'s
`Literal["recent_average", "all_year_average", "annual"]`
(`apps/api/routes/corporate.py:426`) is what actually constrains `roic_basis`
to those three strings in practice; `roic_value` itself does not validate
the string.

**What it affects.** The `roic` field on `CorporateMetrics`
(rounded to 2dp, `apps/api/services/corporate_statement_metrics.py:860`)
when the value is judged decision-grade (see `ROIC quality`); otherwise a
per-ticker fallback figure is substituted instead
(`_is_decision_grade_roic`, `:1109-1110`). Feeds `roic_minus_wacc` /
`spread` alongside `discount-rates-and-returns`' WACC-side figures, and the
`operating_margin` input to a DCF build via `valuation_params_from_metrics`
(`apps/api/services/corporate_metrics_service.py:497-503`).

**Where it is shown.** `GET /api/v1/corporate/metrics/{ticker}` (`roic`
field, basis selectable via `roic_basis`/`roic_year` query params,
`apps/api/routes/corporate.py:422-445`) and
`GET /api/v1/corporate/metrics/{ticker}/audit`. Corporate tab
(`apps/web/app/corporate/page.tsx`), ROIC range control with a basis
selector (`roicBasis` state, default `"recent_average"`,
`page.tsx:155,826-830`) and a basis label rendered alongside the value;
Portfolio tab's stock detail modal, "ROIC Audit" panel
(`StockDetailModal.tsx:628`) and the "ROIC - WACC" tile.

**How to read it.** Unit: percent, unbounded in either direction by this
function itself (the `[-300%, 300%]` sanity check lives in `ROIC quality`,
not here). The basis matters to the number: for the same ticker on the same
day, `annual`, `recent_average`, and `all_year_average` can and do report
different figures, and nothing in the plain `/metrics/{ticker}` response
names which basis produced the number you're looking at unless you also
read the request's own `roic_basis` parameter or the UI's basis label — the
figure is not self-describing.

**Common misreading.** Assuming `recent_average` means "the average of this
company's ROIC over its recent-average trend" is somehow smoother or more
representative than a single year — it is a mechanical average of up to 3
yearly ratios, silently shortened when a year is missing, not a
trend-adjusted or weighted figure. A second, related misreading: assuming
the NOPAT and invested-capital figures shown in the same audit response
explain a `recent_average` or `all_year_average` ROIC number — they don't;
see the `NOPAT` entry's measured 76% divergence.

**Current state.** (2026-09-08) Measured against `data/processed/moneyview.db`'s
135 tickers with stored statements (default `recent_average` basis, real
`yahoo_statement_metrics` calls): **12 of 135 (9%) return no computed metrics
at all** — an earlier revenue-history guard in the caller refuses before ROIC
is reached — leaving 123 with a computed ROIC. Of those 123, quality breaks
down as `estimated: 118, invalid: 2, missing: 3` (`ROIC quality`, below,
explains why `estimated` — not `ok` — is nearly universal under this app's
own default basis). The 2 `invalid` cases (ASM, VRSN) both trip
`"Invested capital is zero or negative."`; the 3 `missing` cases (AXP, BAC,
UEC) all trip `"No overlapping Yahoo statement years were available to
compute ROIC."` — AXP and BAC are both financials, whose statement layout
evidently does not intersect the same operating-income/debt/equity years
this pipeline expects, though this pass did not trace why. Re-measure rather
than quote; this reflects only today's stored statement data.

### ROIC quality

Source: `packages/core_finance/corporate_statement_metrics.py:512` — `assess_roic_quality`

**What it is.** A judgement about whether a computed ROIC figure should be
trusted — one of `ok`/`estimated`/`suspicious`/`invalid`/`missing` — plus a
`reason` string when the answer is worse than `ok`, and a list of
`warnings` that can accumulate independently of `reason`. **This is not a
score.** It does not measure how good the company's return on capital is;
it measures how much the pipeline that produced the number had to
compromise to produce it at all.

**Why this metric.** A reader who takes ROIC quality as a graded score of
capital efficiency has misread it at the root: `quality` and the ROIC
percentage itself vary on entirely independent axes. A company can post a
mediocre ROIC with `quality: "ok"`, or an excellent one with `quality:
"suspicious"` because its invested-capital denominator happens to be small
relative to NOPAT. This entry exists specifically to say what the assessment
rejects and on what grounds — a plain re-reading of the ROIC percentage
would tell a reader nothing about this axis at all.

**How it is calculated here.** Two independent rule passes, in a fixed
order that matters. First, every rule in `ROIC_WARNING_RULES`
(`:103-125`) is evaluated and **all** matching warning text is appended to
`warnings`, regardless of how many match: `non_annual_roic_basis` fires
whenever `roic_basis != "annual"` — meaning it fires for this app's own
default (`recent_average`) on every single request that reaches it, not as
an edge case; `fallback_tax_rate` fires when the shared `stable_tax_result`
(below) fell back to the `21%` default rather than a measured statement
rate; `current_capital_only` fires when the selected record's invested
capital used the current-year-only fallback documented in the `average
invested capital` entry, above. The first of these to fire bumps `quality`
from `"ok"` to `"estimated"`; further matches keep appending to `warnings`
but cannot push `quality` past `"estimated"` on their own. Second, exactly
one rule from `ROIC_QUALITY_RULES` (`:127-158`) is selected — the **first**
whose predicate is true, in declared order — and its `quality`
unconditionally overwrites whatever the warning pass set: `missing_roic_records`
(`"missing"`, no overlapping statement years at all); `missing_average_invested_capital`
(`"invalid"`, the selected record's average invested capital is `None`);
`non_positive_average_invested_capital` (`"invalid"`, average invested
capital is `<= 0`) — **this rule is structurally unreachable**: both
`calculate_invested_capital` calls that feed an average already refuse any
non-positive result by returning `None` (see the `average invested capital`
entry), so `selected_average_capital`, if not `None`, is always the average
of two positive numbers or a single positive one — it can never be
zero or negative in the code as it stands today, confirmed by reading
`:289-346` and `:522-526` together; `unstable_roic_denominator`
(`"suspicious"`, average invested capital is less than 10% of `|NOPAT|`,
i.e. an implied single-year ratio magnitude over 1000% — a much tighter
bound than the next rule's 300%, and tested against the *selected record's*
own single-year NOPAT/capital pair, not the basis-dispatched, possibly
multi-year-averaged `roic` value the reader actually sees); `outlier_roic`
(`"suspicious"`, `|derived_roic| > 300%`, tested against the actual reported
figure, whatever basis produced it). Because only the first matching
`ROIC_QUALITY_RULES` rule contributes a `reason`, a record that trips both
`unstable_roic_denominator` and `outlier_roic` — plausible, since a small
denominator is exactly what produces an extreme ratio — reports only the
denominator-instability reason; the sanity-range breach, while equally
true, is folded into the same `"suspicious"` label without its own stated
reason.

**What it affects.** `quality`, `reason`, and `warnings` on the `roic_meta`
field of `CorporateMetrics` (`:788-798`) and on the `roic` entry of
`CorporateMetricAudit`; `_is_decision_grade_roic`
(`apps/api/services/corporate_statement_metrics.py:1109-1110`) — `quality in
{"ok", "estimated"}` — gates whether the computed ROIC or a fallback figure
is what actually ships in `CorporateMetrics.roic`.

**Where it is shown.** Rendered as a `MetricQualityBadge` on the Corporate
tab's ROIC range control and inside the "ROIC Audit" panel in both the
Corporate tab's calculation-detail modal and the Portfolio tab's stock
detail modal (same locations as `NOPAT`, above); the `reason` text is shown
whenever the metric is not decision-grade
(`apps/web/lib/metricAudit.ts`'s `isDecisionGradeMetric`,
`MetricAuditPanel.tsx:82-84`), and all accumulated `warnings` render as a
single joined block (`MetricAuditPanel.tsx:86-90`) when non-empty,
regardless of `quality`.

**How to read it.** A categorical label with an implied severity order
(`ok < estimated < stale < suspicious < invalid < missing`, the ranking
`_quality_rank` uses elsewhere, `apps/api/services/corporate_statement_metrics.py:896-905`),
not a numeric score and not a statement about the underlying business.
`estimated` under this app's default basis is not a warning sign about data
quality — see Current state — it is close to the median outcome, produced
by the basis choice itself, not by anything unusual about the ticker.

**Common misreading.** Treating `estimated` as meaning "this specific
company's data was unusually thin or unreliable." Under the `recent_average`
basis this app defaults to, `non_annual_roic_basis` fires on every ticker
that reaches this assessment at all — `estimated` is not a signal that
singles a ticker out, it is the default consequence of not requesting a
single fiscal year. A second, related misreading: assuming a `reason` string
is an exhaustive account of everything disqualifying about the figure — see
"How it is calculated here" for why only the first matching quality rule's
reason is ever surfaced.

**Current state.** (2026-09-08) Measured against the same 135-ticker,
`recent_average`-basis pull as the `ROIC` entry: of 123 tickers with a
computed ROIC, **0 report `quality: "ok"`** — every single one is at least
`"estimated"`, exactly because `non_annual_roic_basis` fires unconditionally
under the default basis. 118 are `"estimated"` outright; 2 are `"invalid"`
(ASM, VRSN — both `"Invested capital is zero or negative."`, i.e. negative
book equity outweighing debt); 3 are `"missing"` (AXP, BAC, UEC — no
overlapping statement years). The `non_positive_average_invested_capital`
rule's unreachability, stated above, was confirmed by code reading, not by
searching for a counterexample in this dataset — it follows from the guard
structure regardless of what any particular ticker's statements contain.

### revenue growth

Source: `packages/core_finance/corporate_statement_metrics.py:446` — `stable_growth_payload`

**What it is.** A company's revenue compound annual growth rate (CAGR)
across its stored statement years, or — depending on a caller-chosen basis —
a single year's year-over-year growth, or a trailing 3-year average of
yearly growth rates.

**Why this metric.** It is the one top-line, non-capital-efficiency figure
in this family — the growth rate that, together with ROIC, feeds a DCF's
projection engine. It shares its basis-dispatch shape with ROIC, but the
underlying acceptance logic is structured differently (see `growth quality`,
below), which matters for a reader trying to reason about the two the same
way.

**How it is calculated here.** `stable_growth_payload` (`:446-478`) first
filters revenue years to `valid_revenue_points` (`:413-422` — each year's
revenue must be `>= 1,000,000` and within `YAHOO_STATEMENT_START_YEAR..
YAHOO_STATEMENT_END_YEAR`), then computes two independent things from that
filtered series: `annual_growth_rates` (`:400-410`) — `((current /
previous) - 1) * 100` per consecutive pair of *stored* years, up to the most
recent 5, silently skipped when the prior year's revenue is `<= 0` — and its
own CAGR: `((revenue_last / revenue_first) ** (1 / periods) - 1) * 100`
(`:456-457`), where `first`/`last` are the earliest and latest valid points
and `periods` is the calendar-year gap between them, **not necessarily equal
to the number of valid points** if a year in between was excluded by the
revenue-validity filter — a CAGR computed over, say, `2021→2024` (3
`periods`) when 2022's revenue happened to fail the `$1M` floor,
compounding as if 3 continuous years of growth occurred with no visibility
into the gap. `growth_value` (`:481-496`) then dispatches on `growth_basis`:
`"annual"` with a `growth_year` returns that specific year's YoY rate,
falling back to the latest available; `"annual"` without a year also
returns the latest; `"recent_average"` returns the average of the last 3
stored YoY rates; anything else — including this codebase's own default,
`"cagr"` — returns the CAGR computed above. Unlike `roic_value`'s
`recent_average` case, `growth_basis`'s `"recent_average"` branch here
averages *year-over-year rates*, not a re-derived multi-year CAGR — a
structurally different "average" from ROIC's despite the identical name in
each field's UI label.

**What it affects.** The `growth` field on `CorporateMetrics` (rounded to
2dp) when accepted (see `growth quality`); otherwise a per-ticker fallback
substitutes. Feeds `growth_rate` in `valuation_params_from_metrics`
(`apps/api/services/corporate_metrics_service.py:489-496`), which becomes a
DCF's projected revenue growth input.

**Where it is shown.** `GET /api/v1/corporate/metrics/{ticker}` (`growth`
field) and `GET .../history` (`annual_growth_rates` array). Corporate tab's
Growth range control (`apps/web/app/corporate/page.tsx`), always requested
with the API's default `growth_basis="cagr"` — the frontend never sends a
`growth_basis` query parameter (`metricBasisParams`,
`apps/web/app/corporate/corporateUtils.ts:309-315`, sets only
`roic_basis`/`roic_year`), so despite the API supporting `annual` and
`recent_average` growth bases, no UI path in this codebase ever requests
them; every reader of the Corporate tab sees the CAGR basis only, labeled
`"stable CAGR"` (`page.tsx:823-825`).

**How to read it.** Unit: percent. Because the frontend never varies
`growth_basis`, in practice the number shown in this app is always the
compound annual growth rate over the stored window, never a single year's
YoY rate or a 3-year YoY average — even though the API itself supports both.

**Common misreading.** Assuming the reported CAGR is a smooth, continuously
compounded rate across every intervening year — it compounds only over the
gap between the earliest and latest *valid* revenue years, silently treating
any excluded year in between as if it did not affect the compounding path
(see "How it is calculated here"). A second misreading, specific to this
codebase: assuming a caller could switch to a single-year or 3-year-average
basis from the UI the way ROIC's basis is switchable — no growth-basis
selector exists in `apps/web`; only a direct API call can request anything
other than `cagr`.

**Current state.** (2026-09-08) Measured against the same 135-ticker pull as
`ROIC` (default `growth_basis="cagr"`): 123 tickers produce a computed
result (the same 12 refused earlier for insufficient revenue history). Of
those 123, **120 (98%) accept a CAGR; 3 (2%) are rejected** — IPWR and POET
both for `"Need at least two valid revenue years."`, NBIS for `"Growth CAGR
exceeded sanity threshold."` (outside `[-90%, 200%]`). No ticker in this
dataset tripped `"Invalid year range for CAGR."` or `"Revenue base must be
positive."` — reading the guard order (`GROWTH_QUALITY_RULES:160-185`)
against the upstream `valid_revenue_points` filter, the year-range rule
appears structurally very hard to trip in practice: `periods <= 0` would
require the earliest and latest valid points to share a year, impossible
once at least two distinct-year points exist, which the preceding rule
already requires. Re-measure rather than quote; this reflects only today's
stored statement data.

### growth quality

Source: `packages/core_finance/corporate_statement_metrics.py:435` — `assess_growth_quality`

**What it is.** A judgement about whether a computed revenue CAGR should be
reported at all, expressed as a binary accept/reject decision plus an
explanatory note — not a graded scale the way ROIC quality is.

**Why this metric.** Named alongside `ROIC quality` in this file precisely
because a reader who expects the two to work the same way will be wrong.
`assess_growth_quality` itself never produces a `quality` label — it
produces `growth_cagr: None` (rejected) or `growth_cagr: <value>` (accepted)
plus a `growth_note` string. There is no `"estimated"` or `"suspicious"`
tier here: a growth figure that survives all four rules is reported exactly
as computed, with no equivalent of ROIC's warning-rule pass that can
downgrade an accepted value while still reporting it.

**How it is calculated here.** `assess_growth_quality` (`:435-443`) checks
`GROWTH_QUALITY_RULES` (`:160-185`) in order and takes the **first**
matching predicate, exactly as `ROIC_QUALITY_RULES` does — but here there is
only one rule pass, no warning pass, and only one outcome per match: return
`growth_cagr: None` with that rule's fixed note. The four rules, in
declared order: `insufficient_revenue_history` (`"Need at least two valid
revenue years."` — fewer than 2 valid points, or no first/last); `invalid_year_range`
(`"Invalid year range for CAGR."` — `periods <= 0`, shown above to be
effectively unreachable given the preceding rule); `non_positive_revenue_base`
(`"Revenue base must be positive."` — the first or last valid revenue is
`<= 0`, itself largely redundant with the upstream `$1M` floor
`valid_revenue_points` already enforces); `outlier_growth_cagr`
(`"Growth CAGR exceeded sanity threshold."` — the computed CAGR falls
outside `[-90%, 200%]`). If none match, the note becomes `"Growth calculated
using revenue CAGR from available annual statements."` and `growth_cagr` is
reported as computed. **The `"ok"`/`"invalid"` label a reader actually sees
is not produced here at all** — `apps/api`'s `yahoo_statement_metrics`
derives it one layer up, from whether `growth_cagr` came back `None`
(`has_stable_growth_cagr`, `apps/api/services/corporate_statement_metrics.py:1105-1106,736`),
collapsing this function's four distinct rejection reasons and its one
acceptance note down to a boolean `quality`.

**What it affects.** `growth_meta.quality` (`"ok"` or `"invalid"`, never a
third value) and `growth_meta.reason` on `CorporateMetrics`; `metric_role`
(`"primary"` if accepted, `"fallback"` if not) determines whether the
computed CAGR or a per-ticker fallback figure ships in `CorporateMetrics.growth`.

**Where it is shown.** `MetricQualityBadge quality={growthMeta.quality}` on
the Corporate tab's Growth range control
(`apps/web/app/corporate/components/CorporateAssumptionsPanel.tsx:117,162`);
the reason text renders alongside it via `metricMetaReason(growthMeta)`
(same file, line 120). No Portfolio-tab audit panel exists for `growth` the
way one exists for `roic`/`wacc` (`StockDetailModal.tsx` renders only
`metric="roic"` and `metric="wacc"` — see the `NOPAT` entry's "Where it is
shown").

**How to read it.** Exactly two states in this codebase's actual API
surface: accepted (badge reads whatever `MetricQualityBadge` renders for
`"ok"`) or rejected (`"invalid"`, with a specific reason from the four
above). There is no `"estimated"` tier here, unlike ROIC — a growth figure
that used a stale or fallback tax rate, for instance, carries no
growth-quality consequence at all, because nothing in `GROWTH_QUALITY_RULES`
checks tax-rate provenance (growth does not depend on the tax rate in the
first place — only ROIC and WACC do).

**Common misreading.** Assuming growth quality can be `"estimated"` the way
ROIC quality routinely is, because the two sit side by side in the same UI
panel style and use the same `MetricQualityBadge` component. It cannot: the
apps/api layer's `growth_quality = "ok" if has_stable_growth_cagr else
"invalid"` is a two-valued derivation with no middle state, structurally
different from ROIC's five-state, two-pass assessment, even though both are
described here as "quality" and rendered with the same badge component.

**Current state.** (2026-09-08) Confirmed by reading
`assess_growth_quality`/`GROWTH_QUALITY_RULES` (`:160-185,435-443`) that no
code path in `packages/core_finance` produces anything other than an
accept/reject outcome, and by reading
`apps/api/services/corporate_statement_metrics.py:736,1105-1106` that the
`"ok"`/`"invalid"` label is a downstream boolean derivation, not part of
`assess_growth_quality`'s own return value. The 120/123 accept rate is the
same measurement reported under `revenue growth`, above — not re-measured
separately here since both entries read the identical live pull.

### effective tax rate

Source: `packages/core_finance/corporate_statement_metrics.py:254` — `stable_tax_result`

**What it is.** A single normalized tax rate, derived from a company's
recent statement years, used to convert operating income into NOPAT and to
discount the cost of debt inside WACC — the same rate reused for both, not
computed twice.

**Why this metric.** A single year's raw `tax_expense / pretax_income` can
swing wildly on one-off items (a tax settlement, a valuation-allowance
release); this function's whole purpose is producing a rate stable enough to
apply to NOPAT and WACC without those swings propagating downstream. It
answers "what tax rate should this model assume," not "what tax rate did
this company actually pay this year."

**How it is calculated here.** For each of the (up to 5, most recent)
`matching_years` between `pretax_income_by_year` and `tax_expense_by_year`
(`:245-251,256`), a raw rate `tax / pretax` is computed and kept only if
`pretax > 0` and the raw rate is `is_valid_statement_tax_rate` — strictly
between `0` and `0.50` (`:210-211,262`) — silently discarding negative
pretax years, negative or zero rates, and rates above 50%, not flagging or
counting them anywhere in the returned payload. The **median** (not mean) of
whatever valid rates survive is taken (`:265`, `_median` is a true
even-count-averaging median, `:235-242`), then clamped to `[0.15, 0.30]`
(`TAX_RATE_RULE.clamp`, `:19-20,273`) — so even a company with a genuinely
low or high but valid effective rate (say, a clean `8%` rate from
tax-advantaged operations) is reported no lower than `15%` here. If **zero**
years survive the per-year filter, the function does not refuse — it
returns a fixed fallback: `DEFAULT_TAX_RATE = 0.21` (`:76,266-271`), tagged
`tax_rate_source: "fallback_default"`, indistinguishable in the numeric
field itself from a company whose measured median rate happened to also
land on 21%.

**What it affects.** `calculate_nopat`'s tax deduction (via `build_roic_records`,
`:357-358,369`) and, independently in `apps/api`,
`corporate_statement_metrics.py:1390`'s `wacc = (... + debt_weight *
cost_of_debt * (1 - tax_rate) ...)` — the identical `tax_rate` value, computed
once inside `build_roic_records`, is reused verbatim for the WACC build one
layer up, not recomputed. Also gates `ROIC quality`'s `fallback_tax_rate`
warning (above).

**Where it is shown.** `GET /api/v1/corporate/metrics/{ticker}/audit`, as a
"Tax rate" row appearing in **both** the `roic` audit entry's `inputs_used`
(`apps/api/services/corporate_statement_metrics.py:1490`) and the `wacc`
audit entry's `inputs_used` (`:1523`) — the same computed value, shown
twice, once per panel, with the `source` field displaying the literal
`tax_rate_source` string (`"median_valid_statement_tax_rate"` or
`"fallback_default"`).

**How to read it.** Unit: a decimal fraction internally (e.g. `0.21`),
displayed as a percent. Always within `[15%, 30%]` by construction — the
clamp applies identically whether the rate is measured or the fallback
default, so `15%` or `30%` exactly could mean either a clamped genuine
outlier or a coincidence. The `source` field, not the number, is what
distinguishes a measured rate from the fallback.

**Common misreading.** Seeing the same tax rate figure in both the "ROIC
Audit" and "WACC Audit" panels and assuming each was computed independently
for its respective metric — they are the same value, computed once by
`stable_tax_result` inside `build_roic_records`, and reused verbatim by the
WACC calculation one layer up in `apps/api`. A reader who notices the two
panels' tax rates always agree could reasonably (but wrongly) read that
agreement as a cross-check; it is definitional, not a validation.

**Current state.** (2026-09-08) Measured against all 135 locally stored
tickers via `metric_audit_for_ticker`'s `tax_rate` audit-input `source`
field: **93 (69%) report `"median_valid_statement_tax_rate"`; 42 (31%)
report `"fallback_default"`** — i.e. for nearly a third of tickers with
stored statements, every year's raw tax rate failed the `(0%, 50%]` filter
or too few years overlapped, and NOPAT/WACC are both built on the fixed 21%
assumption rather than anything measured from that company's own
statements. Query: call `metric_audit_for_ticker` for every `DISTINCT
ticker` in `corporate_statements`, read `roic.inputs_used` for the entry
with `field == "tax_rate"`, tally its `source`. Re-measure rather than
quote; this reflects only today's stored statement data.
