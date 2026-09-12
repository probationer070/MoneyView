# Theme and policy spreads — design

> **Status:** designed 2026-09-12, revised the same day after a design-review pass, approved
> for planning, not yet implemented. Sub-project **I-D**, the last of the four decomposed
> from the 2026-09-10 request. Builds on I-C1 (market event lines, PR #34), whose event
> overlay this reuses.
>
> **The review changed five contract details and caught one factual error.** The join and
> base-date rule, the window-day semantics and `latest` were all underspecified enough that
> two implementations could satisfy the prose and disagree; a refused pair had no defined
> presentation. The error was in acquisition: an earlier draft claimed these tickers are
> triggered by "schedule and watchlist add", and neither holds — the scheduled warmer does
> not exist, and watchlist-add would inject six instruments into the user's holdings. See
> *Where they are registered*.

## What was asked, and what is being built instead

The request was for "indicators centered around left-wing vs right-wing political trends,
alongside the current AI trend, cybersecurity, and cloud computing, while also including the
Fear and Greed Index."

Three of those five are built as asked. Two are deliberately reshaped, and the user approved
both changes after the reasoning below was put to them.

### Politics is made observable, not scored

**There is no observable series that measures "left-wing vs right-wing trend."** Producing
that number requires asserting which assets are left-coded and which are right-coded,
choosing weights, and publishing one figure. Every step is an editorial choice, the output
arrives on screen looking like a measurement, and nothing can falsify it.

That is the defect class this repository keeps finding and logging — a number wearing a basis
it has not earned. `ERROR-LOG.md` carries a valuation verdict that took ten review rounds
over exactly this, a ROIC audit that displayed one year's inputs beside a multi-year output,
and a terminal-growth label that named a bound the number never passed through.

So politics is represented by **policy-sensitive spreads with the basis on screen**: two real
tickers, a stated window, and a label a reader can disagree with. `ICLN vs XLE · 90d` is
checkable. "Politics: 63 right" is not.

### Fear & Greed becomes `^VIX`

CNN publishes no official API for its Fear & Greed Index. Any figure in this app would
therefore be either scraped from an unstable page or our own composite wearing CNN's name.
`^VIX` is a real published series, needs one registry entry, involves no composite, and
already answers "is the market frightened".

A named composite ("Risk Appetite (VIX + breadth)", formula visible) remains available later.
What is ruled out is any composite presented as CNN's number.

## The engine: one computation, not five features

The five requested indicators become **five relative-strength pairs plus one plain
series**: politics splits into two policy spreads, the three themes are one pair each, and
Fear & Greed becomes `^VIX`, which is a series and not a spread. The word "five" refers to
the requested indicators everywhere else in this document; the pairs also happen to number
five, and the table below is the authoritative list.

All five pairs are the same computation — relative strength between two tickers over a
window:

```
strength(A, B, t) = (A_t / A_0) / (B_t / B_0) × 100
```

Indexed to 100 at the base date, so a value above 100 means A outperformed B since then.

**The join and the base date, stated exactly, because two implementations can otherwise both
satisfy the prose and disagree on the first value:**

```text
Join A and B on exact trading dates only. No forward fill, no interpolation.

common     = sorted(dates(A) INTERSECT dates(B))
base_date  = first d in common where d >= requested window_start
A_0, B_0   = A[base_date], B[base_date]

series     = [ (d, (A[d]/A_0) / (B[d]/B_0) * 100)
               for d in common where d >= base_date ]
```

`A_0` and `B_0` come from **the same** `base_date` by construction — a single common date,
not two independently chosen first observations. If A starts 2 Jan and B starts 3 Jan, the
base date is 3 Jan and 2 Jan is not emitted at all. Anchoring each side to its own first
observation would index the two series to different days and silently bake that offset into
every value that follows.

Refusals (see `refused_reason`): no common date at or after `window_start`; or `A_0` or `B_0`
absent or zero.

**The definition ships in the payload.** A field called "relative strength" with no stated
formula is the same unearned-basis problem in a different coat: a reader cannot tell a ratio
of returns from a difference of returns from a regression beta, and all three are called
"relative strength" somewhere.

Lives in `packages/core_finance` — a reusable finance calculation, which the file-structure
SOP places there and explicitly forbids in `apps/web`.

### Edge cases the engine must state, not guess

- **Either side missing a bar for a date**: the pair is undefined for that date and is
  omitted, never forward-filled. A forward-filled spread invents a day the market did not
  trade and flattens exactly the gaps that matter (see I-C1's weekend problem).
- **`A_0` or `B_0` is zero or absent**: the pair refuses for that window and says so, rather
  than dividing and publishing an infinity. `DeltaBadge.compute` already refuses on absent
  inputs rather than substituting 0; this follows it.
- **Windows shorter than the requested span** (a young ETF): the response reports the window
  actually used, not the one requested. Silently shortening it would make two pairs with
  different histories look directly comparable when they are not.

## The pairs

| Pair | A | B | Reads as |
|---|---|---|---|
| AI | `BOTZ` | `^GSPC` | is the AI trade leading the market |
| Cybersecurity | `CIBR` | `^GSPC` | |
| Cloud | `SKYY` | `^GSPC` | |
| Energy policy | `ICLN` | `XLE` | clean energy against traditional |
| Defence | `ITA` | `^GSPC` | geopolitical premium |

Plus `^VIX` as a plain series, not a pair.

**Benchmark is `^GSPC`, not SPY**, because `^GSPC` is already cached — 12,873 rows across the
9 existing index tickers — so the benchmark side of four pairs costs no new acquisition.

**Cached is not the same as fresh.** Those existing rows remove the initial backfill cost
only; `^GSPC` remains subject to the ordinary daily-bars freshness rule like every other
series, and nothing here exempts the benchmark from refresh.

**Data availability verified 2026-09-12**, not assumed. All eleven candidates returned 127
daily bars over a 6-month probe (`^VIX` 130): BOTZ 35.28, ARKQ 121.36, CIBR 94.40, HACK
109.90, SKYY 158.47, CLOU 27.13, ICLN 17.92, XLE 65.14, ITA 219.01, ^VIX 15.84, ^GSPC
7656.98. ARKQ, HACK and CLOU are live fallbacks if a primary proxy thins out.

### The editorial residue, stated plainly

"AI" has no price; `BOTZ` *stands in* for it. That choice cannot be derived, only made. The
mitigation is that the label names the proxy — `BOTZ vs ^GSPC · 90d`, never
`AI Trend +12%` — so a reader can reject the proxy instead of being told a fact. Every pair
in the table above carries the same caveat and the same mitigation.

## Data acquisition

**No new data class and no new freshness policy.** These are daily price series and take the
existing daily-bars rule: boundary daily 00:00 UTC, yfinance with Stooq fallback, incremental
backfill, and `last_checked_at` as the freshness primitive ("have I asked since the
boundary?" — never "do I hold a bar dated >= X", which can never be satisfied on a market
holiday and causes permanent refetch storms).

Seven new tickers: `BOTZ`, `CIBR`, `SKYY`, `ICLN`, `XLE`, `ITA`, `^VIX`.

### Where they are registered, and what actually triggers a fetch

An earlier draft of this section said these tickers are triggered by "schedule and watchlist
add". **Both halves were wrong**, established by reading the code on 2026-09-12:

- `schedule_acquisition("equity_bars", ticker)` has exactly **one** caller,
  `POST /portfolio/watchlist` (`routes/portfolio.py:200`), and only when the ticker is new.
- **There is no scheduled warmer.** `schedule_acquisition`'s own docstring says "a scheduled
  warmer for the whole registry arrives with the later phases" — it is unbuilt.
- The only other entry point is `MarketDataService.prewarm_configured_tickers`, driven by the
  `MONEYVIEW_PREWARM_TICKERS` **environment variable** at startup. That is per-machine
  configuration, not a registry that travels with the repository.

Registering the six ETFs by adding them to the watchlist is therefore **rejected**: it is the
only implemented trigger, but it would put six instruments the user does not hold into a
143-row watchlist, and they would appear as tiles in the portfolio grid and inside the
`12 of 143 · 7 followed` count.

**The decision:** a module-level `SPREAD_PAIRS` registry in the new
`apps/api/services/market_spreads.py` is the single source of truth for which pairs exist and
which tickers they need. The spreads route acquires them **lazily through the existing
`MarketDataService.get_stock_ohlcv` path**, which is how the detail page already acquires a
ticker nobody has opened before — cache read, background refresh when past the boundary. No
watchlist pollution, no new scheduler, and no new env var.

`^VIX` additionally needs a `MARKET_INDICES` entry, because `_table_for_ticker` decides
between the `indices` and `stocks` tables by membership in that dict. The six ETFs are
equities and correctly fall through to `stocks`.

The empty `indicators` table (0 rows, confirmed 2026-09-12) is **not** used. It is shaped for
macro/economic records with a `code` and a `cycle`; these are price series and belong in the
tables that already hold price series.

## API

`GET /market/spreads?window=90d` returns one entry per pair:

```
{ "id": "ai", "label": "AI",
  "numerator": "BOTZ", "denominator": "^GSPC",
  "requested_window_days": 90,
  "actual_window_start": "2026-06-15", "actual_window_end": "2026-09-11",
  "actual_window_days": 88,
  "observations": 62,
  "basis": "(BOTZ_t / BOTZ_0) / (GSPC_t / GSPC_0) x 100, indexed to 100 at 2026-06-15",
  "series": [{ "date": "2026-06-15", "value": 100.0 }],
  "latest": 103.4,
  "refused_reason": null }
```

**Window semantics, stated because `90d` has three plausible readings.**
`requested_window_days` and `actual_window_days` are **calendar days**, matching the `window`
parameter's `90d` form and the date-based acquisition layer. `actual_window_start` and
`actual_window_end` are the first and last *emitted common dates*, and `actual_window_days`
is the inclusive calendar span between them — so a young ETF reports 88 where 90 was asked
for, rather than silently presenting a shorter history as if it were comparable to a full
one. The ambiguous `window_days` field is gone.

`observations` is the count of emitted points, which is **not** derivable from the calendar
span (62 sessions inside 88 calendar days). Without it a reader cannot tell a thin series
from a dense one, and the two look identical in a sparkline.

**`latest` is exactly `series[-1].value`** — never recomputed from each side's most recent
close independently. If one side has a bar the other lacks, an independently computed scalar
would disagree with the last point on the chart beside it, and nothing on screen would
explain why.

`refused_reason` is populated instead of `series` when a window cannot be computed, so a
refusal is a stated fact rather than an empty array indistinguishable from "no movement".
Thin route; computation in `packages/core_finance`; Pydantic schema mirrored into
`packages/shared-types/market.ts` beside `MarketEvent`.

## UI

A section on **Market Overview**, which already owns cross-asset context and a daily/monthly
toggle, so the spreads sit beside the indices they are measured against.

- One small multiple per pair, each titled with its own basis (`BOTZ vs ^GSPC · 90d`).
- **Window is fixed at 90 days in v1.** The API takes a `window` parameter because the engine
  is windowed, but no UI control ships for it; one more control on a page that already has a
  daily/monthly toggle needs a reason, and nobody has asked for a second window yet.
- `^VIX` as its own series in the same section.
- The I-C1 event lines overlay these charts, which is the point: the 28 Feb 2026 line should
  be readable against the defence spread.

### A refused pair is shown, not hidden

The API treats refusal as a meaningful fact, so the UI must render it as one. A refused pair
keeps its card, its title and its basis, and replaces the chart with the reason:

```text
BOTZ vs ^GSPC · 90d
Unavailable
Reason: insufficient overlapping history
```

Explicitly **not** any of: an empty chart, a chart zeroed or flat-lined at 100, a bare
"No data", or hiding the card. Each of those either invents a reading or removes the
reader's ability to notice something is missing — and a flat line at 100 is the worst,
because it is indistinguishable from a real result showing no relative movement.

- **`MarketOverviewClient` uses `TVChart` directly rather than through `OHLCVChartCard`, so
  it has no event toggle yet.** Wiring it is part of this work — it is the surface where the
  overlay matters most, and the oil series is where the 28 Feb event is loudest (WTI 67.02
  on 27 Feb to 81.01 by 5 Mar).

## Testing

Engine, in `tests/core_finance/`:

- an identical pair returns exactly 100 at every date (the identity that makes the formula
  checkable at a glance)
- A outperforming B yields > 100, B outperforming A yields < 100
- a date missing from either side is omitted, **not** forward-filled
- a zero or absent base refuses with a reason rather than dividing
- a window shorter than requested reports the window actually used
- **two series with different start dates**: the first emitted value uses the first *common*
  date, and both bases come from that same date. This is the test that locks down the join
  rule; without it an implementation anchoring each side to its own first observation passes
  everything else in this list.
- **`latest` equals the final emitted series value.** Tiny, and it stops the scalar and the
  chart drifting apart later — the scalar is the number a reader quotes.
- fixture constants are **derived from the module's constants**, never mirrored from their
  current values — a fixture tuned to today's value of a window constant can stop reaching
  what it probes and pass while asserting nothing (observed 2026-09-03)

Route, in `tests/api/`: every entry carries a non-empty `basis`; a refused pair carries a
reason and no series.

E2E: each small multiple renders its proxy tickers in its own title, so a reader cannot see a
theme figure without seeing what produced it.

**Mutation matrix — required before any of this is reported as verified.** Named candidates:
difference-of-returns substituted for ratio-of-returns (the two agree closely over short
windows and diverge over long ones, which is exactly the sort of silent error a string
assertion cannot see); forward-fill reinstated for missing dates; the `basis` string
hardcoded rather than derived from the tickers actually used, so it keeps reading correctly
while the computation changes underneath it.

That last one is the important one. The repository's history is full of labels that survived
the computation they described.

## Out of scope

- Any left/right composite score (reshaped above, with the user's approval).
- A scraped CNN figure.
- Derived market events and event categories — that is I-C2, designed and unbuilt.
- Backfilling 30 years for a crisis-comparison view. Recorded as deferred in the acquisition
  design and unchanged by this work.
