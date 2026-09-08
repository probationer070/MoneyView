# Price Signals

Three reads taken directly off a ticker's own stored price and volume
history: how far it has fallen from its own recent high, whether it is
trading unusually heavily right now, and what multiple of trailing earnings
the market is paying for it. None of the three consult a model or a peer
average to compute their own value — the peer and Damodaran-sector
comparisons a reader sees alongside them are a separate figure attached
afterward, not part of the calculation documented here.

> **Note on scope.** `docs/metrics/inventory.md` lists four `price-signals`
> candidates as "distinct": `drawdown`, `volume_ratio`, `trailing_pe`, and
> `pe_change`. Writing this file's `trailing_pe` entry required reading all of
> `packages/core_finance/price_signals.py`, and that reading turned up that
> `pe_change` (`price_signals.py:63`) is never called from anywhere under
> `apps/` — confirmed by `grep -rn "pe_change" apps/`, which returns zero
> matches; only `tests/core_finance/test_price_signals.py` calls it. That is
> exactly the "not present" test the inventory itself already applied to
> `packages/core_finance/hurdle_rate.py` and `risk_analysis.py` (see
> inventory.md's "Notable findings"), and by that same test `pe_change` earns
> no entry here: nothing under `apps/` ever reports this number, so no reader
> ever meets it and there is no belief for an entry to correct. This file
> therefore has three entries, not the inventory's four. `inventory.md` itself
> is unmodified — this note flags the discrepancy for whoever next revises it,
> rather than silently rewriting a prior task's deliverable.

### `drawdown`

Source: `packages/core_finance/price_signals.py:19` — `drawdown_from_peak`

**What it is.** How far the latest close sits below the highest close in a
window, expressed as a negative fraction of that high.

**Why this metric.** It answers "how far has this stock already fallen from
its own recent high" — a question about the stock's own price path, not about
whether that price is cheap relative to a model (`dcf_gap`), how many shares
are trading (`volume_ratio`), or what multiple of earnings it costs
(`trailing_pe`). It carries no information about value; a stock can be down
40% from its peak and still be overpriced.

**How it is calculated here.** `(closes[-1] - peak) / peak`, where
`peak = max(closes)` and `closes` is whatever window the *caller* passes in —
the docstring is explicit that "the choice of 'previous peak' stays with the
caller rather than being guessed here." Sign convention: the result is always
`<= 0`; there is no separate magnitude field. The function refuses (returns
`None`) on an empty `closes` or a non-positive peak (`peak <= 0`), and does no
annualisation — it is a single point-in-time fractional read, not a rate. The
caller, `build_verdict` in `apps/api/services/valuation_verdict.py`, fixes the
window to the last `_DRAWDOWN_BARS = 252` *usable* closes (line 273; NULL
closes are dropped first, so 252 kept closes can span more than 252 calendar
days) and refuses the whole row with `insufficient_history` if fewer than 252
usable closes exist (lines 274–286), separately reporting `non_positive_peak`
if the window's own maximum is `<= 0` (line 287). **A third guard refuses the
row for a reason that has nothing to do with the subject's own closes:** if
`resolve_peers(ticker)` (`apps/api/services/peer_set.py:17`) cannot find at
least `MIN_PEERS = 3` same-industry tickers, `build_verdict` refuses the
*entire* `drawdown` row with that failure's own reason —
`peer_set_too_thin: N peers` or `no_industry: {ticker}` — at
`valuation_verdict.py:294-295`, even though `drawdown_from_peak` itself never
ran and would have succeeded on the subject's own closes alone. The peer-mean
comparison shown alongside a *successful* row is computed from other
tickers' closes over the *same calendar span*, not their own last-252-bar
window; that comparison is a value attached next to `drawdown`, not part of
what this entry documents — but its prerequisite, the peer set resolving at
all, is a real gate on whether `drawdown` reports anything.

**What it affects.** Only the verdict panel's `drawdown` row and, when the
peer set resolves, a peer-mean figure shown beside it. Nothing further
downstream reads this value.

**Where it is shown.** `GET /api/v1/valuation/verdict/{ticker}`
(`apps/api/routes/valuation.py:221`), the Valuation tab
(`apps/web/app/valuation/page.tsx`), labelled "Drawdown from peak".

**How to read it.** Unit: a fraction of the window's peak close, always zero
or negative. `-0.094` means the latest close is 9.4% below the 252-bar peak.
It carries no time dimension — it does not say how many bars ago the peak was
set, and is never comparable to an annualised return.

**Common misreading.** Read as a positive loss percentage. `-0.094` is a 9.4%
decline, not a 9.4% gain and not 0.094%.

**Current state.** (2026-09-08) Measured by calling `build_verdict(ticker)` for
all 139 tickers in the live watchlist (`SELECT ticker FROM watchlist` against
`data/processed/moneyview.db`) and reading each result's
`["rows"]["drawdown"]["reason"]`. **84 of 139 currently return a value; 55
refuse** — 0 `insufficient_history`, 0 `non_positive_peak`, but **51
`peer_set_too_thin` and 4 `no_industry`**, both from the peer-set guard above,
not from `drawdown_from_peak` itself. This is the *verdict-panel row's*
coverage, gated on peer resolution; it is a different, narrower quantity than
`drawdown_from_peak`'s own success rate over the subject's closes alone,
which this measurement did not isolate. Re-measure rather than quote — this
reflects only the history and industry mappings stored today.

### `volume_ratio`

Source: `packages/core_finance/price_signals.py:35` — `volume_ratio`

**What it is.** Mean traded volume over a short recent window, divided by
mean traded volume over a longer baseline window.

**Why this metric.** It answers "is this stock trading unusually heavily
right now" — a question none of `drawdown`, `trailing_pe`, or `dcf_gap`
touch, since all three are price-derived and say nothing about how many
shares are changing hands. Dividing by the ticker's own baseline mean, rather
than reporting a raw volume count, is what makes the figure comparable across
differently-sized names.

**How it is calculated here.** `(mean(volumes[-recent:])) / (mean(volumes[-baseline:]))`
— the mean over the last `recent` bars, divided by the mean over the last
`baseline` bars; both windows are supplied by the caller. There is no sign
convention (volume cannot be negative) and no annualisation — it is a ratio
of two means over caller-chosen windows, horizonless in the same sense
`drawdown` is. Guards (lines 37–41): returns `None` if `recent <= 0`,
`baseline <= 0`, there are fewer bars than `max(recent, baseline)`, or the
baseline mean is `<= 0`. In `build_verdict`, the primary call uses
`_RECENT_DAYS = 90` over `_BASELINE_DAYS = 252` (lines 358, 54–55); if that
call refuses, a fallback recomputes with `fallback_recent = max(1, len(volumes) // 2)`
and `fallback_baseline = len(volumes)` (lines 362–365) — so the *same*
reported figure can, on a ticker with thinner history, be computed over a
structurally different pair of window sizes than the 90/252 the row's label
implies, disclosed only in the row's `source` text, not in the value itself.

**What it affects.** Only the verdict panel's `volume` row. Nothing further
downstream reads this value.

**Where it is shown.** `GET /api/v1/valuation/verdict/{ticker}`, reported
under the JSON key `volume` — not `volume_ratio`; the function name and the
reported field differ. Valuation tab, labelled "Volume vs baseline".

**How to read it.** Unit: a ratio of two means, not a percentage. `1.20`
means the recent window's mean volume runs at 1.20x the baseline mean.

**Common misreading.** Read as a proportion. `1.195` is `×1.20`, not `+19.5%`
and not `119.5%`.

**Current state.** (2026-09-08) Measured by calling `build_verdict(ticker)` for
all 139 live watchlist tickers and reading each result's
`["rows"]["volume"]["reason"]`. All 139 currently return a value (some via
the 90/252 primary call, others via the fallback); none refuse (0
`zero_volume`, 0 `no_volume`, 0 `insufficient_history` on this row). Unlike
`drawdown`, this row has no peer-set or benchmark gate, so its coverage is
the subject's own bars alone. Re-measure rather than quote.

### `trailing_pe`

Source: `apps/api/services/valuation_verdict.py:446` — `build_verdict`

**What it is.** The subject's own latest close divided by its trailing
annual diluted earnings per share — a price multiple, not a percentage.

**Why this metric.** It answers "how many times last year's earnings does
the market pay for this stock today" — a pure market-observed multiple, with
no discounted-cash-flow model behind it. That distinguishes it from `dcf_gap`
(a model-implied fair-value gap) and from the `discount-rates-and-returns`
family (what return is implied or required); `trailing_pe` says nothing about
value, only about the price the market currently sets relative to a backward-
looking earnings figure.

**How it is calculated here.** `price / eps` at
`apps/api/services/valuation_verdict.py:446`, inline rather than through a
named function. `price` is the latest usable close (`dated_closes[-1][1]`);
`eps` is diluted EPS for the newest annual period with strictly positive EPS
(`_latest_positive_eps`, line 186) — there is deliberately no fallback to
Basic EPS if diluted is missing (docstring, lines 189–192: falling back would
silently swap the conservative figure for the less conservative one exactly
where diluted is absent, which is worse than refusing). No annualisation
beyond the annual EPS figure itself; the result is a point-in-time ratio, not
a rate. Guards: refuses with `no_statements` if no statement bundle is stored
for the ticker at all; refuses with `no_positive_eps` if every annual period
examined has EPS `<= 0` or missing; refuses with `insufficient_history` if
there is no usable close. **A prior guard gates all three of those, and has
nothing to do with the subject's own EPS or price:** `price / eps` is never
even attempted unless `resolve_for_ticker(ticker)`
(`apps/api/services/industry_benchmark_store.py:143`) first resolves a
Damodaran sector benchmark for the ticker's industry (refuses with
`no_industry`/other `bench_reason` text if not, line 383) *and* that
benchmark carries a `trailing_pe` column with at least 3 surviving
contributing industries (refuses with `no_sector_pe` otherwise, lines
384-387). A ticker with a perfectly good own EPS and price still reports no
`trailing_pe` value if its sector benchmark does not resolve. **Divergence
from the textbook / from this same
module:** `packages/core_finance/price_signals.py:45` defines a second,
differently-scoped implementation, `trailing_pe_series`, which pairs each
close with whatever EPS covers that close's own year across a whole series.
That function is never called from anywhere under `apps/` (confirmed by
`docs/metrics/inventory.md` and a repo-wide grep) — the reported `trailing_pe`
figure is this inline `price / eps` computation only, using the single
newest positive-EPS period, not a series and not that function's output. A
future change to `trailing_pe_series` would not affect what this endpoint
reports.

**What it affects.** Only the verdict panel's `trailing_pe` row, alongside a
Damodaran sector-average comparison when the benchmark resolves and at least
three industries survive its own screen. Nothing further downstream reads
this value.

**Where it is shown.** `GET /api/v1/valuation/verdict/{ticker}`, Valuation
tab, labelled "Trailing PE".

**How to read it.** Unit: a multiple, not a percent. `24.3` means the market
is paying 24.3x trailing annual diluted EPS for the stock. Formatting it with
a `%` sign states something false about what the number is.

**Common misreading.** Read as a percentage. `24.3` is a multiple (24.3×),
not 24.3%. A second, codebase-specific misreading: assuming this figure comes
from `price_signals.py`'s `trailing_pe_series` function. It does not — that
function exists, is tested, and is never called; the reported value is a
separate, hand-written `price / eps` with different EPS-selection logic.

**Current state.** (2026-09-08) Measured by calling `build_verdict(ticker)` for
all 139 live watchlist tickers and reading each result's
`["rows"]["trailing_pe"]["reason"]`. **108 of 139 currently return a value
from the "own PE" branch documented above; 31 refuse** — 0 `no_statements`,
0 `insufficient_history`, but **27 `no_positive_eps` and 4 `no_industry`**;
the 4 `no_industry` refusals are the sector-benchmark gate above, not a
failure of the subject's own EPS or price (the same 4 tickers also fail
`drawdown`'s peer-set gate, since both read the same
`corporate_quote_facts.industry` column). Re-measure rather than quote.
