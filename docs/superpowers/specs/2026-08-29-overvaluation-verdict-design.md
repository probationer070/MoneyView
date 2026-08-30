# Over/Undervaluation Verdict

Date: 2026-08-29
Status: approved, ready for planning

Sub-project 3 of the industry-relative conservative valuation request. Sub-projects 1
and 2 shipped in `docs/superpowers/specs/2026-08-11-industry-relative-conservative-valuation-design.md`;
this is the piece that spec deferred:

> **Over/undervaluation verdict** — *deferred to its own spec.*
>
> Sub-project 3 is where the price-derived signals named in the request live:
> percentage decline from previous peak, trading volume, and PE decline over time.
> None of them are DCF inputs; they are evidence about whether a computed gap
> between price and value is worth acting on.

## What this builds

For one ticker, an **evidence panel**: each price-derived signal beside its
sector comparison, each naming the source that comparison came from, with the
direction being tested stated explicitly.

It issues **no buy/sell label and no score.** Collapsing these signals into one
verdict requires weights the data does not contain, and once collapsed the
weighting — which would *be* the verdict — becomes invisible to the reader. The
panel shows its work and the reader judges. This matches the rule the rest of
the feature already follows: report rather than enforce, and carry a narrative
claim on every number.

```
NVDA vs Semiconductors (2026-01-01 vintage)

  DCF gap        +18.4%   intrinsic 142.10 vs price 120.00   [conservative case #42]
  Drawdown        -31.2%   from 174.40 peak (2025-11-04)      [peers: 6 stored]
  Volume           1.8x    90d avg vs 1y avg                  [peers: 6 stored]
  Trailing PE     refused  no_sector_pe: 2026-01-01 vintage has no trailing_pe

  Testing: UNDERVALUATION against the top of the sector.
  This basis is anti-conservative for overvaluation.
```

## Two premises from the deferring spec, checked

**Price bars are stored — holds.** The `stocks` table carries `ticker`, `date`,
`open`, `high`, `low`, `close`, `volume` (`db.py:234-246`), and
`market_data.get_stock_ohlcv` reads SQLite, refreshing live only when stale.
Drawdown and volume need no acquisition work, exactly as the deferral promised.

**The PE columns were stored — FAILS.** That spec said:

> `Trailing PE`, `EV/Sales`, `Price/Book` and `Std deviation in stock prices` are
> the ones sub-project 3 will want, and storing them now avoids a re-acquisition
> later.

They were not stored. The shipped `industry_benchmark` table (`db.py:544-558`)
has only the nine columns the conservative-case generator consumes.
`BENCHMARK_COLUMNS` likewise defines nine. So the re-acquisition the deferral
was meant to avoid is now required, and this spec carries that cost.

**Statement line items are stored unfiltered — holds.** The acquisition layer
writes every row Yahoo returns (`acquisition/sources/statements.py:64`,
`for line_item, value in frame[column].items()`), so EPS and Net Income are
present in `corporate_statements` even though no current code reads them. PE
history is computable without new acquisition.

## Where each comparison comes from

The three signals cannot share one basis: Damodaran's dataset has PE but no
drawdown and no volume, and nothing else in the repo has a sector-wide PE.

| Signal | Value from | Compared against |
| --- | --- | --- |
| DCF gap | stored conservative case | the ticker's own market price |
| Drawdown from peak | `stocks` bars | peers: stored tickers sharing `industry` |
| Volume ratio | `stocks` bars | peers: stored tickers sharing `industry` |
| Trailing PE | `stocks` close + `corporate_statements` EPS | Damodaran sector average |

Every panel row names its own source. A reader must never have to guess whether
"the sector" meant Damodaran's industry census or the handful of tickers this
installation happens to store — those are different claims of very different
strength.

### The peer set is not a sector census, and says so

Peers are tickers in `corporate_quote_facts` sharing the target's `industry`,
excluding the target itself. That column exists already, added for the benchmark
feature. This is a **watchlist, not a census**: six semiconductor tickers someone
follows are not the semiconductor sector. The panel therefore reports the peer
count on every peer-based row (`[peers: 6 stored]`) rather than presenting the
comparison as authoritative.

Minimum 3 peers, matching `resolve_benchmark`'s existing `minimum=3`. Below that
the signal refuses rather than averaging over too few — the same rule, chosen for
the same reason, so the two layers cannot disagree about what "enough" means.

## Components

### `packages/core_finance/price_signals.py` — pure

No I/O, no database, no `apps/api` import. Takes sequences in, returns numbers out.

- `drawdown_from_peak(closes)` → `(pct, peak_value, peak_index)`. The peak is the
  running maximum over the supplied window, so the caller's window choice defines
  "previous peak" rather than the function guessing it.
- `volume_ratio(volumes, recent, baseline)` → recent mean over baseline mean.
- `trailing_pe_series(closes_by_date, eps_by_period)` → `[(date, pe)]`, and
  `pe_change(series, window)` → the fractional change across the window.

Division guards: a zero or negative EPS yields no PE for that period rather than
a negative or infinite one, and a zero baseline volume refuses rather than
dividing. A meaningless number that looks plausible is worse than a refusal —
the argument `dcf.py:196` already makes for the terminal spread.

### `apps/api/services/peer_set.py`

`resolve_peers(ticker) -> tuple[list[str], str | None]`, exactly one non-None.
Reads `corporate_quote_facts`, refuses with `peer_set_too_thin: N peers` below 3
and `no_industry: <ticker>` when the target has no stored industry.

### `apps/api/services/valuation_verdict.py`

Assembles the panel: loads bars for the target and its peers, loads EPS, resolves
the Damodaran benchmark, computes each row, and attaches sources. Every
dependency is injected the way `generate_conservative_case` injects its four, so
the whole path is testable without network or live data.

### Benchmark columns — additive migration

Add `trailing_pe`, `price_to_book`, `ev_sales`, `stdev_price` to
`industry_benchmark` in both schema locations (`_CREATE_SCHEMA_SQL` and
`_ensure_schema_compatibility`), following the `sector`/`industry` columns'
existing `ALTER TABLE` pattern.

**They must be registered as OPTIONAL in `BENCHMARK_COLUMNS`.**
`parse_workbook` builds its `required` header list from every entry
(`industry_benchmark_store.py:49`), so adding them as ordinary columns would make
an older workbook fail to parse entirely — trading a missing signal for a broken
loader. A `required: bool` field on `BenchmarkColumn`, defaulting True, keeps
every existing column's behaviour identical.

### Route

`GET /api/v1/valuation/verdict/{ticker}` — 200 with the panel, 404 when the
**target** has no stored bars at all (there is no panel to build), 409 for
`no_vintage` (matching the conservative route's existing rule that missing
server-wide data is not the caller's fault).

Individual refused rows are **not** errors; they travel inside the 200 body. A
panel where three rows computed and one refused is a successful response — that
is the whole point of refusing per signal.

A peer with no bars is dropped from the peer average and counted in the reported
peer total, so `[peers: 6 stored]` always means six peers that actually
contributed.

Declared `def`, not `async def`: it does synchronous SQLite and arithmetic work,
and every route in the app is now sync-on-threadpool for that reason.

## Refusal is per-signal, never global

| Reason | Meaning |
| --- | --- |
| `no_bars` | a **peer** has nothing stored in `stocks`, so it is dropped from the peer average (the target having no bars is a 404, not a row) |
| `insufficient_history: N bars` | fewer bars than the requested window |
| `no_industry: <ticker>` | no industry on `corporate_quote_facts` |
| `peer_set_too_thin: N peers` | fewer than 3 stored peers in the industry |
| `no_eps` | no usable EPS in `corporate_statements` |
| `no_sector_pe: <vintage> has no trailing_pe` | vintage predates the new columns |
| `no_case: <ticker>` | no stored conservative case to take a gap from |
| `no_vintage` | no benchmark dataset loaded at all |

A refused row never falls back to an absolute threshold. Fixed cutoffs across
every industry are precisely what the original request set out to eliminate, and
a silent fallback to one would reintroduce it in the layer meant to judge it.

## The direction statement is mandatory

Carried on every panel, non-negotiable, because the deferring spec requires it:

> Benchmarking against the top of a sector is a choice, not a neutral baseline.
> It is conservative for identifying undervaluation and *anti*-conservative for
> identifying overvaluation: a company that looks expensive against the best
> industries in its sector may be reasonably priced against its actual peers.
> The verdict layer in sub-project 3 must state which direction it is testing.

The panel states: testing **undervaluation** against the top of the sector, and
that this basis is anti-conservative for the opposite conclusion. A reader who
takes an "expensive" reading from this panel is being told, in the panel, why
that reading is the weaker one.

## The DCF gap row

Takes `value_per_share_diluted` from running the ticker's stored conservative
case (`run_stored_case` returns it, `valuation_case.py:445`) against the latest
close in `stocks`. No stored case → `no_case`.

The gap is deliberately **not** recomputed here. Sub-project 3 exists to judge
whether a computed gap is worth acting on; computing a second, independent
valuation would make the panel a rival to the case rather than evidence about it.

## Testing

- **Pure module**: synthetic series with exact expected values — a known peak and
  trough for drawdown, a known ratio for volume, a hand-computed PE series. Plus
  the guards: zero EPS, negative EPS, zero baseline volume, empty input.
- **Peer set**: seeded `corporate_quote_facts`, including the 2-peer boundary that
  must refuse and the 3-peer boundary that must not.
- **Verdict service**: hermetic, dependencies injected, covering a fully-populated
  panel and a panel where each reason fires in turn.
- **Route**: `TestClient` against a seeded database — a populated panel, a 404 for
  an unknown ticker, and a 200 whose body carries refused rows, proving partial
  refusal is not an error.
- No test may open `data/processed/moneyview.db` or reach the network.

## Out of scope

- **No buy/sell label and no score** — the reasoning is at the top of this spec.
- **No new acquisition.** Bars and statements are already stored; only the
  Damodaran workbook must be re-loaded, and that path is already manual
  (`store_vintage(parse_workbook(path))`).
- **No UI.** The valuation tab is 3d, tracked separately in `guideline/sop/todo.md`.
- **No `EV/Sales`, `Price/Book` or `stdev_price` consumers.** The columns are
  added because re-loading the workbook twice would be worse than storing four
  columns once, but only `trailing_pe` has a consumer in this spec. Storing a
  column with no consumer is also the cheapest check that the parser is not
  special-casing per field — the same argument the benchmark spec made for its
  three unfaded columns.

## Accepted consequence

**The PE row refuses until a workbook carrying those columns is loaded.** Every
existing vintage predates them. Drawdown, volume and the DCF gap work immediately
against data already stored, so the panel is useful on day one with one row
honestly reporting why it is absent.
