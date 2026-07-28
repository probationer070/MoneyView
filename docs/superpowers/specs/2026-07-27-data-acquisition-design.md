# Data Acquisition & Freshness — Design

Date: 2026-07-27
Status: draft, pending review
Sub-project: 2 of 4 ("on-demand loading", `guideline/sop/todo.md`)
Predecessor: `docs/superpowers/specs/2026-07-25-perf-instrumentation/` (sub-project 1)

---

## 1. Problem

Every data class in MoneyView invented its own acquisition and storage strategy
independently. The row counts expose it:

| Data class | Storage today | Rows | Acquisition |
| --- | --- | --- | --- |
| OHLCV prices | SQLite `stocks` | 65,093 | lazy on read, freshness-gated |
| Indices | SQLite `indices` | 12,584 | lazy on read |
| News | SQLite `news` | 229 | persisted |
| Corporate statements | in-memory `TTLCache` only | `corporate_metrics` **7** of 139 | lazy on read, **every request** |
| Macro indicators | `indicators` table exists | **0** | nothing populates it |
| Comparison snapshots | v1 **139** / v2 **0** / v3 **600** | | three accreted generations |

Four independent `TTLCache` instances exist (`_YAHOO_STATEMENT_CACHE`,
`_provider_fetch_cache`, `_attribution_cache`, `_report_cache`), each with its own
maxsize and TTL environment variable, none aware of the others, none persisted.

Three measured consequences:

**Acquisition runs on the read path.** `POST /watchlist` writes one row, calls
`mark_watchlist_state("user_mutation")`, and returns — it acquires nothing. `DELETE`
removes the row and leaves the data. So the natural acquisition events trigger no
acquisition, and every fetch instead happens in-band while a user waits.

**The statement cache cannot hit.** Two independent causes, either sufficient alone:
`ttl=300s` is shorter than one 138-ticker sweep, and `maxsize=48` is smaller than the
139-ticker universe, so a sweep evicts its own earliest entries. Measured: **0 hits,
539 misses** across a full run. Consequently each `GET /corporate/comparison?mode=live`
performs 138 tickers × ~7 lazy `yfinance` property accesses ≈ **~966 sequential HTTP
round trips**, discarding all of it. This is the leading candidate for reported
symptom S2.

**Refetch is all-or-nothing.** `market_data.py` fetches with
`yf.Ticker(t).history(period=period)` — never `start`/`end`. `_rows_cover_period`
computes that coverage is short and then discards that information and refetches the
whole period. There is no delta capability. The store holds
65,093 ÷ 139 = **468 rows per ticker ≈ 1.9 years**, short of the 5–10 years wanted.

---

## 2. Goals and non-goals

**Goals**

- One acquisition layer where each data class declares its policy. Adding SOFR or a
  new index is a row in a registry, not a new pipeline.
- Read paths query SQLite and never fetch.
- Freshness expressed as a declared boundary, not a duration.
- Incremental updates: fetch the missing range, not the whole history.

**Non-goals**

- Changing any finance formula. Purely an acquisition and storage concern.
- Intraday or real-time quotes. Every class here is daily or slower, except news.
- A distributed job queue. This is a local-first single-process app; the runner is a
  thread with a schedule.
- Replacing the comparison snapshot tables (v1/v2/v3). Noted as debt, out of scope.

---

## 3. Freshness: boundary, not duration

A TTL is the wrong primitive for scheduled data. Daily bars change once per day, so a
300-second TTL permits 288 refetches per day for one actual change, while still being
able to serve data from *before* the change. Every cache defect in §1 traces to this.

Two concepts are currently conflated and must be separated:

- **Schedule** — when to go and look. A convenience; correctness must not depend on it.
- **Boundary** — the instant at which a held copy becomes invalid.

### 3.1 The freshness question

The existing rule asks *"do I hold a bar dated ≥ the last trading day?"*
(`_rows_are_fresh`). That question cannot be satisfied on a market holiday, because no
bar exists for one — so it triggers a refetch storm on every request, all day, roughly
ten days a year. The same happens nightly between local midnight and the moment the
provider publishes. It also retries delisted tickers forever.

The rule instead asks:

> **Have I asked since the last boundary?**

Tracked as `last_checked_at`, compared against
`boundary.most_recent_instant(now_utc)`. This tracks our own action rather than the
market's output, so it cannot be defeated by a holiday, an early close, a delisting, or
a provider gap. It also makes *"asked, nothing new"* distinguishable from *"never
asked"* — a distinction a TTL cache cannot express, and the one that lets the UI say
"not yet acquired" honestly instead of silently showing stale numbers.

### 3.2 Everything is UTC

All boundaries are declared and compared in UTC. The codebase already stores time in
UTC (`datetime.now(UTC)`, `fetched_at`), so a UTC boundary compares directly against
stored values with no timezone conversion — and every conversion is a place to acquire
an off-by-nine-hours bug. `_previous_trading_day` currently uses naive
`date.today()`, which flips at local midnight and behaves differently on a KST laptop
than in a UTC container; that is replaced.

Note that no fixed wall-clock boundary is perfectly stable against the market: the US
close is 16:00 `America/New_York`, which is 21:00 UTC in winter and 20:00 UTC in
summer. A 00:00 UTC boundary sits 3–4 hours after it in both, which is the margin we
want.

### 3.3 Boundary types

| Type | Semantics |
| --- | --- |
| `Daily(at="00:00", tz="UTC")` | invalid once the next 00:00 UTC passes |
| `Daily(at="08:00", tz="America/New_York", business_days=True)` | skips weekends and US holidays |
| `Interval(hours=12)` | rolling window, for data with no publication schedule |
| `Event(feed=...)` | valid until a named external event is observed |

### 3.4 Trading calendars are per-source

"The last completed session" is not one thing. `^GSPC` closes 21:00/20:00 UTC;
`^KS200` closes 15:30 KST = 06:30 UTC, so at the 00:00 UTC boundary the most recent
completed Korean session is the previous calendar day; `CL=F` is a CME future settling
14:30 ET; `BTC-USD` never closes. So the calendar is a per-source declaration
(`calendar: us_equity | krx | cme_energy | continuous`), not a global rule.

---

## 4. Architecture: the registry

One declaration per data class; a shared runner reads the table.

```python
@dataclass(frozen=True)
class DataClass:
    name: str                      # "equity_bars" | "statements" | ...
    scope: Scope                   # PER_TICKER | GLOBAL
    boundary: Boundary             # §3.3
    triggers: tuple[Trigger, ...]  # §5
    source: Source | None          # None for derived classes
    depends_on: tuple[str, ...]    # derived freshness = min(inputs)
    calendar: str                  # §3.4
    store: str                     # SQLite table
```

The value of the registry is that the acquisition runner contains no per-class logic.
Adding a macro series or an index is a row. Six hand-rolled strategies become one
mechanism plus five declarations.

### 4.1 Declarations

| Class | Scope | Boundary | Calendar | Triggers | Source | Store |
| --- | --- | --- | --- | --- | --- | --- |
| `equity_bars` | per-ticker | `Daily(00:00, UTC)` | `us_equity` | schedule, subject added, corporate action | yfinance → Stooq | `stocks` |
| `index_bars` | global | `Daily(00:00, UTC)` | per-subject¹ | schedule | yfinance → Stooq | `indices` |
| `statements` | per-ticker | `Event(edgar_submissions)` | n/a | filing detected, subject added | EDGAR → yfinance | `corporate_metrics` |
| `macro_rates` | global | `Daily(08:00, America/New_York, business_days)` | `us_business` | schedule | NY Fed, FRED | `indicators` |
| `news` | per-ticker | `Interval(12h)` | n/a | schedule, detail click | RSS → Finnhub | `news` |
| `valuation_ratios` | per-ticker | `Daily(00:00, UTC)` | n/a | derived | none | `valuation_ratios` |

¹ `index_bars` subjects span calendars — `^GSPC` is `us_equity`, `^KS200` is `krx`,
`CL=F` is `cme_energy`, `BTC-USD` is `continuous` (§3.4) — so `calendar` is resolved per
subject from a lookup rather than fixed on the class. Every other class has one
calendar for all its subjects.

"Daily bars" is used in prose for the `equity_bars` + `index_bars` family; they are two
declarations because `store` is one table per class, and they share one source adapter
and one boundary. Splitting them is also what makes "adding an index is a row" literally
true.

`valuation_ratios` gets its own table rather than sharing `corporate_metrics`, so that
derived values are never confused with reported ones and can be recomputed by truncation
without touching source data.

### 4.2 New state table

```sql
CREATE TABLE acquisition_state (
    data_class      TEXT NOT NULL,
    subject         TEXT NOT NULL,   -- ticker, or '*' for GLOBAL scope
    last_checked_at TEXT,            -- UTC ISO8601; answers §3.1
    last_success_at TEXT,
    covered_from    TEXT,            -- range coverage, §6
    covered_to      TEXT,
    status          TEXT NOT NULL,   -- never_acquired | ok | empty | failed
    detail          TEXT,
    PRIMARY KEY (data_class, subject)
);
```

`status` is what lets a read return `never_acquired` explicitly rather than an empty
list that the UI cannot distinguish from "this stock has no news".

---

## 5. Triggers separate the situations

The same class carries several triggers, each acquiring a different range. This is the
core of the design: *what changed* determines *what to fetch*.

| Trigger | Fires on | Example effect |
| --- | --- | --- |
| `Scheduled(boundary)` | boundary passes | `equity_bars`: delta only |
| `SubjectAdded` | `POST /watchlist` | `equity_bars`: 10-year backfill for one ticker; `statements`: one EDGAR fetch |
| `SubjectRemoved` | `DELETE /watchlist/{t}` | stop refreshing; retain rows (cheap, and re-adding is then free) |
| `UserViewed(surface)` | detail page opened | `news`: refresh that one ticker |
| `UpstreamChanged` | an input's `last_success_at` advances | `valuation_ratios`: recompute |
| `CorporateAction` | new split or dividend observed | `equity_bars`: full refetch of that ticker (§6.1) |

`POST /watchlist` and `DELETE /watchlist/{ticker}` gain an enqueue call and nothing
else; they must not block on acquisition.

---

## 6. Incremental acquisition for daily bars

Replaces `history(period=...)` with an explicit range.

- **Backfill** (`SubjectAdded`): `start = today − 10y`, one request, once per ticker.
- **Delta** (`Scheduled`): `start = covered_to + 1 day`, `end = last completed session
  + 1 day`. Steady state is **one row**, or two to three after a weekend.

Sizing: 10 years is 252 × 10 = 2,520 rows per ticker, so 139 tickers ≈ **350,000 rows
≈ 50 MB** at the current ~137 bytes/row. Trivial for SQLite. A delta transfers 1 row
where a full refetch transfers 2,520 — a ~2,500× reduction per update.

`covered_from`/`covered_to` in `acquisition_state` record **which ranges were
successfully covered**, rather than inferring coverage from which rows are present.
Inference cannot distinguish a provider gap from a market holiday; a coverage record
can. This also means an interior hole from a failed fetch is repairable, where
`last_stored + 1` only ever heals the tail.

### 6.1 The split hazard

`yfinance.history()` returns **auto-adjusted** prices, and the adjustment factor is
rewritten retroactively by every split and every dividend. Appending deltas onto an
adjusted series therefore mixes pre- and post-adjustment prices, silently corrupting
returns, volatility, and every DCF input derived from them. It degrades gradually and
looks like data, not like an error. **This is the single most likely way this design
fails in production.**

Chosen mitigation: poll `.actions` (cheap) as part of the daily delta; when a new split
or dividend appears for a ticker, fire `CorporateAction` and refetch that ticker's full
history. Rare — a few per ticker per year — and it keeps the existing schema.

Recorded alternative for later: store unadjusted OHLCV plus a `corporate_actions`
table and adjust on read. Strictly more correct, since actions are append-only and raw
prices are immutable once recorded, but a schema migration this design does not need.

### 6.2 `end=` is exclusive

`yfinance` treats `end` as exclusive, which silently drops the most recent day. Pinned
by a test rather than a comment.

---

## 7. Sources

Each source is an adapter with one method, `fetch(subject, range) -> rows`, and an
ordered fallback chain. Recommendations and reasoning:

**Daily bars — yfinance primary, Stooq fallback.** yfinance already works and is the
only free interface covering equities, indices and commodity futures uniformly
(`^GSPC`, `^IXIC`, `^DJI`, `GC=F`, `CL=F`). The fallback exists because yfinance is an
unofficial scraper that breaks when Yahoo changes markup, and it is currently a single
point of failure under the entire price layer. Alpha Vantage is unusable (25 req/day
free); Polygon and Tiingo are paid, against the local-first goal.

**Statements — SEC EDGAR primary, yfinance fallback.**
`data.sec.gov/api/xbrl/companyfacts/CIK##########.json` returns every reported fact,
all statements, all periods, in **one** request — replacing ~7 lazy yfinance property
accesses per ticker, a 7× reduction in round trips.
`data.sec.gov/submissions/CIK##########.json` is the filing feed and *is* the
`Event(edgar_submissions)` boundary: compare the latest 10-Q/10-K accession number and
refetch facts only when it changes, which turns "quarterly" from a guess into a
detectable event. Free, official, no key; requires a declared `User-Agent` and ≤10
req/s. CIK map from `sec.gov/files/company_tickers.json`, cached. **US registrants
only**, so yfinance remains the fallback for tickers with no CIK — the count of such
tickers in the current watchlist must be measured during implementation, as it sets
how much the fallback matters.

**Macro — NY Fed for SOFR, FRED for the rest.**
`markets.newyorkfed.org/api/rates/secured/sofr/last/1.json` is free, needs no key, and
is the publishing authority, so its schedule *is* the boundary. FRED
(`api.stlouisfed.org/fred/series/observations`) covers CPI, DGS10, unemployment; free
with a key. These populate the empty `indicators` table.

**News — RSS primary, Finnhub on click.** `feedparser` is already a dependency and the
`news` table exists, so RSS is the established path for the 12-hour sweep (Yahoo
per-ticker `feeds.finance.yahoo.com/rss/2.0/headline?s=<TICKER>`, plus EDGAR filing
RSS). For the on-click path, Finnhub's free tier (`/company-news`, 60 req/min) is worth
a key: a click is a single request, so a rate-limited API is acceptable exactly where
RSS is thinnest. NewsAPI is rejected — its free tier forbids production use and delays
24 hours.

### 7.1 Provider rate limits are a first-class concern

Concurrent unthrottled fetching earned a Yahoo rate limit during this project's
measurement work ("Too Many Requests"), which invalidated every subsequent measurement
for roughly an hour. The runner must therefore serialise per source, honour a declared
minimum interval per source (EDGAR's ≤10 req/s is a documented limit, not a guess),
and treat a rate-limit response as a boundary-deferring failure rather than something
to retry immediately.

---

## 8. Derived classes carry no source

`valuation_ratios` (PER, PSR, PBR) is `source=None`,
`depends_on=("equity_bars", "statements")`. Its freshness is `min()` over its inputs'
`last_success_at`, and it recomputes on `UpstreamChanged` rather than declaring a
cadence it cannot honour. The 00:00 UTC boundary sits one hour after the daily-bar
boundary, so the input lands before the recompute rather than racing it.

`yfinance` exposes `trailingPE`, and it is deliberately **not** used. Two sources for a
number we compute ourselves guarantees disagreement — the same class of coupling that
Phase 1 of the finance remediation removed from DCF, where `current_price` was allowed
to drive intrinsic value.

---

## 9. Reads never fetch

A read queries SQLite and returns whatever `acquisition_state.status` says. A class
that has never been acquired returns `never_acquired`, which the UI renders as an
explicit state.

No in-band fallback fetch. A fallback would make the common case fast while letting a
dead warmer go unnoticed indefinitely — the system would appear to work while
silently degrading to the current architecture, and the failure would surface as
mysterious slowness rather than as a broken job. Making the absence visible is the
point. This is a recommendation carrying real cost — a cold start shows empty panels
until the warmer runs — and §12 records it as the decision most worth challenging.

---

## 10. Error handling

- A source failure records `status=failed` with `detail`, advances
  `last_checked_at` (so it does not hot-loop), and leaves `last_success_at` alone.
- Reads always serve the last good rows, with staleness derivable from
  `last_success_at`. A failed refresh never blanks a working panel.
- Fallback chains are ordered and tried once per boundary, not retried in a loop.
- A rate-limit response defers to the next boundary (§7.1).
- No acquisition failure propagates into a request. Precedent: the telemetry sink's
  failure policy in perf spec §03.8.

---

## 11. Testing

Following the predecessor's structure (perf spec §07), with most tests as pure unit
tests over declarations:

- **Boundaries.** `most_recent_instant` at DST transitions, across weekends and US
  holidays, and for `business_days=True`. Pure function, no clock, no I/O.
- **The freshness question.** A holiday must not trigger a refetch — the regression
  that motivates §3.1. A delisted ticker returning nothing must be asked once per
  boundary, not once per request.
- **Range arithmetic.** Delta start from `covered_to`; interior gap detected and
  repaired; `end=` exclusivity (§6.2); backfill range from `SubjectAdded`.
- **The split hazard.** A new split in `.actions` fires `CorporateAction` and triggers
  a full refetch rather than an append. Asserted on adjusted-price continuity across
  the split date, since that is the symptom that would otherwise be invisible.
- **Triggers.** `POST /watchlist` enqueues and returns without blocking;
  `DELETE` stops refreshes.
- **Derived freshness.** `valuation_ratios` recomputes when either input advances, and
  reports the `min()` of their freshness.
- **Reads never fetch.** A read with an empty store returns `never_acquired` and makes
  no provider call — asserted with the provider patched to raise.
- **Sources** are contract-tested against recorded fixtures, not live endpoints. No
  test may make a network call; the rate limit in §7.1 is the reason.

---

## 12. Decisions (resolved 2026-07-27)

1. **EDGAR is in v1.** The 7× round-trip reduction and the filing-event boundary both
   come from EDGAR, so a v1 without it would keep the `Event` boundary unimplemented
   and statements on a guessed quarterly cadence. It costs CIK mapping and a US-only
   caveat in the first slice, which is the right price:
   `Event(edgar_submissions)` is the only trigger that makes "quarterly on earnings
   release" a **detected event** rather than an approximation.
2. **No in-band read fallback.** Reads query SQLite and return `never_acquired`; they
   never fetch. The cost is real — a cold start shows empty panels until the warmer
   runs — and it was the decision most worth challenging. It stands because a fallback
   lets a dead warmer go unnoticed indefinitely: the system would appear to work while
   silently degrading to exactly the architecture this design replaces, and the failure
   would surface as mysterious slowness rather than as a broken job. Making the absence
   visible is the point.
3. **Backfill depth is 10 years.** ~2,520 rows per ticker, ~350k rows and ~50 MB across
   the watchlist. It does not reach the 2008 Lehman or 1997 IMF crises; §13 explains why
   that is acceptable — a crisis view needs depth on index and macro series, not on
   per-stock history that truncates at IPO anyway.

### 12.1 Evidence from the sub-project 1 baseline

The 2026-07-27 baseline strengthened the case for this design rather than changing it:

- The statement cache scores a **structural 0% hit rate** — `ttl=300s` is shorter than
  one 138-ticker sweep and `maxsize=48` is smaller than the 139-ticker universe. Either
  alone forces it.
- Fixing that cache did not solve the problem, it **exposed the next bottleneck**:
  `external.fetch_quote` runs 1,400 times at 369.7 ms, **92.4% of `comparison_138`**.
  Live price quotes are fetched per ticker per request with no cache at all.

That second point is the design's own thesis demonstrated: point-fixing one cache moved
the cost rather than removing it, because the read path was still doing acquisition.
Both defects disappear under §9 — a read that never fetches cannot have a fetch
bottleneck.

---

## 13. Deferred

**Crisis-comparison view.** Compare current conditions against past crises (1997 IMF,
2008 Lehman). Deferred at the user's request. One design note, recorded so this design
does not preclude it: such a view needs ~30 years of history, but almost entirely on
**index and macro** series, not per-stock — most of the current 139 tickers did not
exist in 1997, so their history truncates at IPO regardless. Those series are
`GLOBAL` scope and few, so backfilling them 30 years deep is cheap and needs no change
to the 5–10 year per-stock decision. The registry's per-class `boundary` and backfill
depth make this a declaration change when the time comes.

**Comparison snapshot consolidation.** Three generations of table
(`corporate_comparison_snapshots`, `_v2` empty, `_v3`) with no single mechanism. Debt,
noted, out of scope.

---

## 14. Phasing

Phase 1 builds the machinery; later phases are declarations plus an adapter.

| Phase | Content | Why this order |
| --- | --- | --- |
| 1 | Registry, `Boundary`, `acquisition_state`, runner, `equity_bars` + `index_bars` with backfill + delta + split handling | Establishes every reusable piece against the class with the most measured pain and no API key |
| 2 | `statements` via EDGAR, `Event` boundary | Largest round-trip reduction; needs Phase 1's state table |
| 3 | `macro_rates` (NY Fed, FRED) | Fills the empty `indicators` table; proves `GLOBAL` scope and a second calendar |
| 4 | `news` two-trigger acquisition | Proves `UserViewed` alongside a schedule |
| 5 | `valuation_ratios` | Proves derived classes and `UpstreamChanged`; depends on 1 and 2 |

Phase 1 is the first implementation plan.

---

## 15. Success criteria

1. `GET /corporate/comparison?mode=live` performs **zero** provider round trips on the
   read path, against ~966 today.
2. A steady-state daily update transfers one row per ticker, not 2,520.
3. A market holiday triggers no refetch — the §3.1 regression.
4. Statement cache hit rate is not a tuning parameter, because statements are read from
   SQLite rather than a sized in-memory cache.
5. Every panel distinguishes `never_acquired` from empty data.
6. Adding a new macro series or index requires one registry row and no new pipeline
   code — the reusability claim, tested by doing it.

Criterion 1 is measurable with the sub-project 1 baseline runner, which is what makes
the before/after provable rather than asserted.
