# Statements in the Acquisition Layer, and Manual-Only Snapshots

**Date:** 2026-07-28
**Status:** Approved design, not yet planned

## Problem

Two complaints with one root cause.

**The comparison tab asks the network 138 times.** MoneyView acquires and stores price
bars locally, but never statements. DCF, WACC and ROIC all need income, balance and cash
flow statements, so `get_yahoo_statement_bundle` fetches them from Yahoo per ticker, per
request, at roughly 2.5s each. A full sweep measures ~357s. Acquisition Phase 1 scoped
statements out by decision (`guideline/sop/todo.md`), and nothing has connected them since.

**Snapshots are minted daily, which is both wasteful and misleading.** `corporate_snapshot_cycle`
materialises a KST-daily snapshot at startup and at each midnight, and
`build_corporate_comparison_response` will compute one synchronously inside a user's request
if today's is missing. Statements change quarterly, so a daily snapshot manufactures daily
variation in fundamentals that did not change — false precision, which `finance-logic.md`
prohibits in its opening principle. It also makes snapshot-to-snapshot comparison
meaningless: two adjacent snapshots differ by when they were computed, not by what changed.

## Design

### Layering

```
Yahoo → Acquisition → Local stores → Metrics
```

Metric code stops knowing where data comes from. Every input to a computation is local, so
the same stored data yields the same WACC today and tomorrow. That determinism is the
primary architectural gain: it makes the metric layer reproducible, testable offline, and
debuggable without a network.

### Statements become a data class

`acquisition/registry.py` already anticipates this — its docstring names statements as a
later row, and adding a class is "a row, not a pipeline".

| File | Change |
| --- | --- |
| `acquisition/boundaries.py` | Add `Weekly(weekday, at_hour, at_minute)` — invalid once the next occurrence of that weekday/time UTC passes. Same shape and purity as `Daily`. |
| `acquisition/registry.py` | Add `statements`: `Scope.PER_TICKER`, `boundary=Weekly(weekday=0, at_hour=0)`, `store="corporate_statements"`. Add `market_cap`: `Scope.PER_TICKER`, `boundary=Daily(at_hour=0)`, `store="corporate_quote_facts"`. |
| `acquisition/sources/` | A statements source beside the bars source, returning normalised rows. |
| new table | `corporate_statements(ticker, statement_type, frequency, period_end, line_item, value, fetched_at)` — normalised rather than a blob, so it is queryable and satisfies `finance-logic.md`'s reproducibility-key requirement. |
| new table | `corporate_quote_facts(ticker, market_cap, shares_outstanding, currency, fetched_at)` |
| `corporate_statement_metrics.py` | `get_yahoo_statement_bundle` reads the local store. The module-level `TTLCache` is deleted. |

**Why the in-memory cache goes.** The local store is already a persistent cache with its own
invalidation rule. Keeping a `TTLCache` above it means two cache layers with different and
independently-wrong invalidation policies — which is exactly the defect recorded in
`ERROR-LOG.md` on 2026-07-26 and partially patched in `0e4a3c1`. One layer, one rule.

**Why statements and market cap are separate classes.** They have different natural
frequencies. Statements are quarterly and irregular; market cap moves with the market.
Bundling them forces one freshness policy to serve both, which is what made the 2026-07-28
cache fix accept a day-stale market cap behind WACC's capital-structure weights.

Market cap gets `Daily`, not something intraday, because every price input in MoneyView is a
daily bar. An intraday market cap would be the only sub-daily input in the system and would
make WACC vary within a day while nothing else did — the same false precision this design
removes elsewhere. The boundary matches the app's cadence deliberately, not by default.

Deriving market cap as `latest close × shares outstanding` was considered and **rejected on
evidence**. Measured against yfinance on 2026-07-28:

| Ticker | Balance-sheet ordinary shares | `info.sharesOutstanding` | Error if derived |
| --- | --- | --- | --- |
| AAPL | 14,773,260,000 | 14,687,356,000 | +0.6%, stale since fiscal year end |
| GOOGL | 12,088,000,000 | 5,867,155,790 | 2.06x — balance sheet aggregates all share classes |
| BRK-B | 1,438,223 | 1,398,308,677 | ~972x — balance sheet is in Class-A equivalents |
| TSM | 25,932,524,521 | 5,186,474,013 | 5.0x — ordinary shares vs ADR ratio |
| 005930.KS | 6,630,180,138 | 5,764,191,903 | +15%, and preferred shares are a separate row |
| SPY | balance sheet empty | 917,782,016 | no data; `marketCap` is `None` |

The share count is not always present, is historical rather than current, and is
inconsistent across exchanges. Multi-class equities and ADRs — where it is most wrong — fail
silently with plausible-looking numbers. Market cap is therefore acquired, never derived.
`SPY` returning `marketCap: None` is already handled by the `missing_market_cap` quality rule
at `corporate_statement_metrics.py:68`.

### Snapshots become manual-only

A snapshot is created only when the user presses the button. Nothing creates one on a
schedule, and no read path creates one as a side effect.

**Deleted:**

- `corporate_snapshot_cycle` from the `main.py` lifespan.
- `ensure_corporate_comparison_daily_snapshot` (`routes/corporate.py:112`) and
  `ensure_daily_snapshot_current`.
- The synchronous `save_corporate_comparison_snapshot` fallback at
  `services/corporate_comparison.py:96-107` — the path where opening the tab silently pays a
  six-minute sweep the user never asked for.

**Changed:**

- `mode=snapshot` returns the **latest snapshot regardless of date**, or an explicit empty
  state when none exists. "Today's snapshot" stops being a concept, so `_snapshot_business_date`
  is no longer consulted on the read path.
- `POST /comparison/snapshot` is the button: acquire stale statements and quote facts, compute,
  persist. One action, because the freshness boundary already tracks what needs fetching, and
  separate fetch/compute buttons would let a user generate a snapshot from statements they
  forgot to refresh — the false-precision problem relocated rather than solved.

Snapshots become a deliberate record of "the picture when I asked", which is what gives
snapshot-to-snapshot comparison real semantics later.

### Data flow on a button press

1. Resolve the comparison universe (unchanged).
2. For each ticker, `needs_acquisition(state, boundary, now)` per data class.
3. Acquire only what is stale. Usually nothing.
4. Compute from local stores. No network.
5. Persist the snapshot with its source and version.

### Error handling

- **A ticker fails to acquire.** Record the failure in `acquisition_state`, keep the last
  stored statements, and mark that row's metrics with the existing quality-rule machinery.
  One bad ticker must not fail the snapshot.
- **No statements stored for a ticker at all.** The row reports missing inputs through the
  existing `inputs_used` / quality path rather than fabricating a value.
- **Snapshot persistence fails.** Surface the error. Do not fall back to recomputing, which is
  the behaviour being removed.

### Testing

- `Weekly` boundary: exhaustive date arithmetic, pure, no database — matching `test_boundaries.py`.
- Freshness: a statement class does not re-acquire within the same week and does after it.
- Source: normalised rows from a fixture bundle, including a ticker whose balance sheet is
  empty and one with preferred shares.
- Read path: `mode=snapshot` with no snapshot returns the empty state and **makes no network
  call and writes no snapshot** — the regression guard for the deleted fallback.
- Button: acquires only stale tickers; a second press within the boundary acquires nothing.
- The suite's existing `_forbid_network` guard already fails any test that reaches the network,
  so "the comparison is local" is enforced rather than asserted.

## Consequences

- A new filing is reflected up to 7 days late, bounded by the `Weekly` boundary, with no way
  to force it sooner — the accepted cost of a single button. A per-ticker
  expected-next-filing boundary is the refinement, deferred.
- The first press, or the first after a filing season, fetches every stale ticker and takes
  minutes. It is explicit and user-initiated, unlike the behaviour being deleted.
- A process restart no longer costs a cold sweep, because the store is on disk rather than in
  memory.

## Deliberately excluded

- **A generic source protocol.** The registry is already a catalog of datasets; what remains
  bespoke is the source per dataset. With two sources, an abstraction would be guessing at the
  shape. Extract it when the third lands.
- **Snapshot-to-snapshot comparison UI.** Enabled by this design, not built by it.
- **Further datasets** — dividends, splits, estimates, ownership. They follow this pattern as
  further rows; none is in scope here.
- **Backfilling historical statements.** Only what yfinance returns for the current periods is
  stored.
