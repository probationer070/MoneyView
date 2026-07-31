# Portfolio Tile Grid and News Acquisition — Design

**Date:** 2026-07-31
**Status:** Approved for planning

## Problem

`/portfolio` is one long vertical scroll. `apps/web/app/portfolio/page.tsx` is 2,726 lines
rendering a single `space-y-6` column: Latest Snapshot Summary, Portfolio Attribution
Summary, Watchlist Holdings table, Portfolio Allocation Workspace. Reaching the allocation
editor means scrolling past everything above it, and there is no way to see prices and news
together.

News compounds this. It exists only inside `StockDetailModal`, fetched one ticker at a time
(`useInfiniteQuery(["stock-news", ticker])` -> `GET /news/feed?ticker=X`, falling back to
`POST /news/crawl/stock`). To learn what happened across the portfolio you open and close a
modal once per stock.

## Goals

1. Replace the vertical stack with a tile grid as the primary view, reachable analytics
   moved into icon-triggered side panels.
2. Show price and news together, per stock, without opening anything.
3. Refresh news for every stock in the grid in one action, through the acquisition layer
   rather than around it.

## Non-goals

- Redesigning `StockDetailModal`. It remains the drill-down and is unchanged.
- Changing any finance calculation. This is presentation plus one new acquisition class.
- Rewriting `page.tsx`'s data layer. Query wiring, session caches and request snapshots stay
  as they are.

## Measured constraints

Read from the live database on 2026-07-31, and these numbers drove several decisions:

- **139 watchlist rows**, **0 with a positive weight**. The equal-weight fallback means every
  tile would show ~0.72%, so "held stocks" cannot be the only membership rule without a
  fallback.
- **239 news rows across 45 distinct tickers**. Most watchlist stocks have no stored news at
  all, so "no news" is the common tile state, not an edge case.
- A batch crawl of all 139 tickers would take minutes. Scoping the refresh to visible tiles
  keeps it in the seconds.

## Architecture

### Layout shell

A two-column CSS grid replaces the stack:

```
grid-template-columns: 1fr 56px

┌──────────────────────────────────┬────┐
│ filter / search header (sticky)  │ ▣  │ snapshot summary
├──────────────────────────────────┤ ▣  │ attribution
│ tile grid                        │ ▣  │ allocation workspace
│ auto-fill, minmax(260px, 1fr)    │ ▣  │ holdings table
│ the only vertical scroll         │ ── │
│                                  │ ↻  │ refresh news
└──────────────────────────────────┴────┘
```

The rail is `position: sticky` and always visible. The tile grid is the only vertically
scrolling region. This is what removes the long scroll rather than shortcutting it: the
analytical sections stop occupying vertical space entirely.

**Panels.** One icon opens one panel; one panel open at a time. Panels slide over the right
of the main area at ~480px rather than full width, so the grid stays visible behind them and
the user keeps their place. `Esc` closes, focus is trapped while open, `aria-modal` is set,
and every icon-only button carries an `aria-label` plus a tooltip.

**Responsive.** Below `lg` the rail becomes a fixed bottom bar and panels become full-screen
sheets. The grid drops to `minmax(180px, 1fr)`.

**Reuse.** The four panel bodies already exist as standalone components —
`PortfolioSnapshotSummary`, `PortfolioAttributionSummary`, `PortfolioAllocationEditor` and
`PortfolioCommandCenter`. They move into panels essentially unchanged. This is why the work
is a re-composition rather than a rewrite.

**Known risk.** `page.tsx` holds the state those panels consume. Moving sections into panels
means threading props or introducing a context. Decision: thread props first, and introduce
a context only if the count becomes unmanageable — a context here would hide data flow that
is currently explicit.

### New files

| File | Responsibility |
|---|---|
| `PortfolioShell.tsx` | Two-column grid, sticky rail, panel host, one-open-at-a-time state |
| `SidePanel.tsx` | Slide-over primitive: focus trap, `Esc`, `aria-modal`, responsive sheet |
| `StockTileGrid.tsx` | Grid container, membership rule, filter and search header |
| `StockTile.tsx` | One tile: price header plus headlines |

`page.tsx` keeps its data wiring and shrinks to composition.

### The tile

`PortfolioStock` already carries `ticker, name, sector, group_name, weight, last_close,
delta, sparkline`. The entire price header is a re-render of data the page already holds; no
new API is needed for it.

```
┌────────────────────────┐
│ NVDA           ▲ 5.2%  │  last_close, delta
│ $1,278.01              │
│ ▁▂▃▅▇█▇▅      wt 12.0% │  sparkline, weight
├────────────────────────┤
│ · Blackwell demand     │  news — the only new read
│   beats guidance   2h  │
│ · Supply eases Q3  6h  │
└────────────────────────┘
```

Up to three headlines, newest first, each with a relative age. Clicking the tile opens the
existing `StockDetailModal`. The tile is a summary, not a replacement for it.

### Grid membership

`weight > 0` defines a held stock. Because no weights are currently set, the rule needs a
fallback:

> Held stocks if any exist; otherwise the 12 most recently added watchlist rows.

When the fallback is active the grid header states it ("No weights set — showing 12 most
recent"), so an unexpected-looking grid is never unexplained. A filter (`held / all /
sector`) and a search box in the sticky header reach the remaining rows.

**"Most recently added" requires a small API addition.** The `watchlist` table has no
`created_at`; insertion order survives only in its `id INTEGER PRIMARY KEY AUTOINCREMENT`.
`GET /portfolio/watchlist` currently returns `SELECT * FROM watchlist ORDER BY group_name,
ticker` and its payload omits `id`, so the frontend cannot currently order by recency at
all. Two changes, both small:

- Add `id` to the watchlist item payload and to `PortfolioStock`.
- Keep the existing `ORDER BY group_name, ticker` for the table's own use; the grid sorts by
  `id` descending client-side.

No schema migration is needed — `id` already exists and is already selected by `SELECT *`.
The alternative considered and rejected was falling back to the first 12 alphabetically,
which needs no change but shows an arbitrary slice that will always start with the same
letters.

**Weight display under the fallback.** Every fallback stock has `weight = 0`, so the tile's
`wt 12.0%` line would read `wt 0.0%` on all twelve — visual noise asserting something
uninformative. When the fallback is active the tile omits the weight line entirely rather
than printing zeros.

**Transition.** The fallback is all-or-nothing, not additive. The moment any watchlist row
has `weight > 0`, fallback mode is off entirely and the grid shows held stocks only — never
"held plus recent", which would mix two different meanings of membership in one grid and
leave the user unable to tell which tiles are holdings. Everything else stays one click away
under the `all` filter. Setting the last positive weight back to zero returns the grid to
the fallback, and the banner reappears.

### News: two operations

Only the second was in the original request, but the first is required for tiles to render.

**Read.** `GET /news/feed` takes a single ticker, so twelve tiles would mean twelve round
trips. Add a bulk read that also carries acquisition state, so a tile can tell "checked, no
news" from "never checked" without a second request:

```
GET /news/feed/bulk?tickers=A,B,C&per_ticker=3

{
  "tickers": {
    "A": { "articles": [ ... ], "last_checked_at": "2026-07-31T14:00:00Z" },
    "B": { "articles": [],       "last_checked_at": "2026-07-31T14:00:00Z" },
    "C": { "articles": [],       "last_checked_at": null }
  }
}
```

`last_checked_at` is joined from `acquisition_state` on `(data_class='news', subject=ticker)`
and is `null` when that ticker has never been acquired. `B` and `C` above are the two states
that would otherwise be indistinguishable.

**Ordering.** Articles are newest first. `news.published_date` is `TEXT DEFAULT ''`, so the
sort is `ORDER BY published_date DESC, id DESC` with empty dates sorting last — an undated
article must never displace a dated one from a three-item tile. `id DESC` breaks ties
deterministically, so repeated reads return the same three headlines.

**Every requested ticker appears as a key**, including those with no news and those unknown
to the store. The frontend maps by ticker and must not depend on key ordering, since JSON
object order is not a contract.

One query serves the whole grid, keyed on the visible ticker list.

**Refresh.** News becomes an acquisition data class, following the pattern statements and
quote facts already use.

```python
# boundaries.py — new, mirroring Daily's structure and validation
@dataclass(frozen=True)
class Hourly:
    at_minute: int = 0

# registry.py
"news": DataClass(
    name="news",
    scope=Scope.PER_TICKER,
    boundary=Hourly(at_minute=0),
    store="news",
    calendar="us_equity",
)
```

Hourly rather than Daily because a refresh button that does nothing for 23 hours reads as
broken.

- `sources/news.py` — `fetch_news(ticker, company_name, *, crawler=None)` wraps the existing
  crawler. Catches only `(AttributeError, KeyError, TypeError, ValueError)`, per the
  established source rule, so an unexpected bug propagates. `crawler` is injectable so tests
  run offline.
- `store.py` — `save_news(ticker, articles)`. The `news` table already has `hash TEXT
  UNIQUE`, so dedupe is `INSERT OR IGNORE` and needs no new schema.
- `POST /news/acquire` takes the visible ticker list, loops `acquire_point_in_time`, and
  returns **per-ticker status**.

### Why Hourly

News providers rate-limit aggressively, and the grid's refresh button is the one control a
user is most likely to press repeatedly. Hourly balances the two: a genuine refresh is
available roughly as often as the news actually turns over, while repeated presses within
the hour report "already current" and perform no provider work at all. Daily would make the
button inert for 23 hours out of 24; per-press crawling would let one impatient user
generate unbounded provider load. The boundary is the rate limiter.

### Batch execution

**Sequential, inside one worker thread.** Measured on 2026-07-31 against the running app,
a single-ticker crawl takes **0.8–1.0 s** (AAPL 1043 ms, MSFT 829 ms, NVDA 818 ms), so a
full twelve-tile refresh is roughly **11 s**. That is acceptable behind the progress counter
specified below, and it is the option that matches the rest of the acquisition layer, which
is sequential throughout.

Concurrency is deliberately not introduced now. We have no measurement of the provider's
behaviour under concurrent load, and a bounded pool of four would turn an 11 s
button that works into a 3 s button that may be throttled — trading a known cost for an
unmeasured risk, on an action the hourly boundary already limits to once per ticker per
hour.

The API contract does not expose execution strategy, so this can change without a client
change. **Revisit when either trigger fires:** the typical visible set exceeds ~20 tiles, or
measured per-ticker latency exceeds ~2 s. At that point a bounded pool of four is the
intended next step.

The loop runs in a worker thread (`asyncio.to_thread`) because `crawl_stock_and_save` is
synchronous and blocking; 11 s on the event loop would stall every other request. Note the
known consequence, already documented in `tests/conftest.py` and `ERROR-LOG.md`: a
`to_thread` worker cannot be cancelled once started. That is what makes the cancellation
semantics below a statement of fact rather than a choice.

### `/news/acquire` contract

```
POST /news/acquire
{ "tickers": ["NVDA", "AAPL", "MSFT"] }

200
{
  "results": [
    { "ticker": "NVDA", "status": "acquired", "articles": 5 },
    { "ticker": "AAPL", "status": "fresh",    "articles": 0 },
    { "ticker": "MSFT", "status": "failed",   "articles": 0, "detail": "provider timeout" }
  ],
  "skipped_unknown": ["ZZZZ"]
}
```

**Validation.**

- Tickers are upper-cased and de-duplicated before acquisition, so a repeated ticker is
  crawled once.
- Tickers are intersected with the watchlist. Anything outside it is **ignored and reported
  in `skipped_unknown`**, never crawled. This is what stops the endpoint becoming a generic
  crawler that anything on the machine can drive.
- Ignoring rather than rejecting with 400 is deliberate: a stock removed between page load
  and refresh is an ordinary race, not a client error, and failing the whole batch for it
  would be worse than skipping it. Returning the skipped list keeps the behaviour visible
  rather than silent.
- An empty list after validation returns **400** — that is a genuine client bug, not a race.
- More than **100** tickers returns **400**. The measured 0.9 s per ticker makes 100 a
  ~90 s ceiling, which is already beyond what the progress counter should be asked to cover.

`status` is one of `acquired`, `fresh`, `empty`, `failed` — the same vocabulary
`AcquisitionResult` already uses, so the route adds no new status language.

### Why per-ticker status matters

Freshness asks "have I asked since the boundary?", so pressing refresh twice within the hour
correctly performs no work the second time. A button that silently does nothing reads as
broken — this is exactly the `/dev/performance` failure recorded in `ERROR-LOG.md` on
2026-07-31, where a working page could not say so.

The rail button therefore reports the outcome:

> **8 refreshed · 4 already current · 1 failed (TSM)**

Failures are named rather than swallowed. `acquire_point_in_time` already records them, and
`AssertionError` propagates so a test that reaches the network fails loudly instead of
recording a `FAILED` row nobody reads.

## Data flow

```
Portfolio page
      │
      ▼
Watchlist query ──► PortfolioStock[]
      │
      ▼
Membership rule (client-side)
      │
      ▼
Visible tickers ──────────────┬───────────────────────────┐
      │                       │                           │
      │ on load               │ on Refresh press          │
      ▼                       ▼                           │
GET /news/feed/bulk    POST /news/acquire                 │
      │                       │                           │
      │                       ▼                           │
      │              for each ticker (sequential,          │
      │              in one worker thread)                 │
      │                       │                           │
      │                       ▼                           │
      │              acquire_point_in_time("news", …)      │
      │                       │                           │
      │                fresh? ─┴─ stale?                   │
      │                  │         │                       │
      │               skip      fetch_news()               │
      │                            │                       │
      │                            ▼                       │
      │                       save_news()                  │
      │                            │                       │
      │                            ▼                       │
      │                  per-ticker status ────────────────┘
      │                            │
      │                            ▼
      │              invalidate ONLY the bulk news key
      ▼                            │
   tiles ◄───────── re-render ◄────┘
```

1. Existing watchlist query produces `PortfolioStock[]`.
2. Membership rule selects the visible tickers, client-side.
3. Bulk news query, keyed on that ticker list, fills the tiles' lower half.
4. Rail refresh button posts the visible tickers to `/news/acquire`.
5. On success the bulk news query is invalidated and tiles re-render. No page reload and no
   per-tile spinners.
6. Panels read from existing page state; opening one performs no fetch of its own.

### Refresh snapshot semantics

**The visible ticker set is captured when Refresh is pressed.** Changing the filter or search
while a batch is in flight does not alter that batch — it will finish on the set it started
with. The alternative, re-reading the filter mid-flight, would make the outcome depend on
timing and leave the reported counts describing a set the user can no longer see.

Only one batch runs at a time. While one is in flight the refresh control is disabled, so a
double-press cannot start a second overlapping crawl.

### Cache boundary

The bulk news query key is derived from the visible ticker list, so filter changes naturally
produce a different key rather than stale reuse.

A successful refresh invalidates **only that key**. No watchlist, comparison, attribution,
snapshot or history query is touched. News acquisition changes news rows and acquisition
state and nothing else, so invalidating anything further would discard correct data and
trigger refetches the user did not ask for.

### Cancellation

Refresh continues server-side if the user navigates away or closes the page — the worker
thread running the loop cannot be cancelled once started, as recorded in `tests/conftest.py`
and `ERROR-LOG.md`. This is stated as fact rather than chosen: any client-side "cancel"
would stop the client waiting, not the crawl. The client simply ignores a late response, and
because every acquisition writes through `save_news` and `acquisition_state` as it goes, the
work is not lost — the next page load sees whatever completed.

## States

Treated as first-class, because the failure mode this codebase keeps hitting is a working
page that cannot explain itself.

| Condition | What renders |
|---|---|
| Grid loading | Skeleton **tiles** in the grid — visible placeholders, not the near-invisible grey bars that made `/dev/performance` look dead |
| No watchlist at all | Empty state with "Add stocks", opening the allocation panel |
| Watchlist exists, no weights | The 12 fallback tiles plus a banner naming the rule |
| Tile has no news | "No recent news · last checked 14:00", read from `acquisition_state.last_checked_at` |
| Refresh in flight | Button spinner, rail disabled, `n/total` counter |
| Refresh complete | `8 refreshed · 4 already current · 1 failed (TSM)` |
| Refresh failed entirely | Error with retry, the request-level failure named |

The "last checked" line comes free from acquisition state and distinguishes *"there is no
news for this stock"* from *"we never looked"*. Without it an empty tile is ambiguous in
exactly the way a blank dashboard is.

## Error handling

### Failure aggregation

- Failures are aggregated **per ticker**. One ticker failing never aborts the remaining
  acquisitions — the loop continues and that ticker's `status` is `failed` with its `detail`.
- The batch **succeeds overall** (HTTP 200) whenever the request itself was valid, even if
  every ticker failed. The result is the per-ticker list; a partial failure is data, not an
  HTTP error. The endpoint returns non-200 only for request-level problems: failed
  validation (400) or an unhandled server fault (500).
- The refresh summary names failures rather than counting them anonymously. With one
  failure: `1 failed (TSM)`. With several, it names the first two and counts the rest —
  `3 failed (TSM, WDC +1)` — with the full list available in the panel, because a bare
  "3 failed" tells the user nothing they can act on.
- Source-level failures are recorded per ticker by `acquire_point_in_time` and surfaced in
  the refresh summary.
- A transient failure advances `last_checked_at` and so suppresses retry until the next
  hourly boundary. This is the known, deliberate consequence of the freshness rule, already
  recorded as a deferral in `guideline/sop/todo.md`. At Hourly rather than Weekly the blast
  radius is small.
- The bulk news read failing degrades tiles to their price header with an inline notice; it
  never blanks the grid.

## Dependencies

Files this design touches, by layer.

**Backend — new**

| File | Purpose |
|---|---|
| `apps/api/services/acquisition/sources/news.py` | `fetch_news(ticker, company_name, *, crawler=None)` |

**Backend — modified**

| File | Change |
|---|---|
| `apps/api/services/acquisition/boundaries.py` | Add `Hourly` |
| `apps/api/services/acquisition/registry.py` | Register the `news` data class |
| `apps/api/services/acquisition/store.py` | Add `save_news`, `news_coverage` |
| `apps/api/routes/news.py` | Add `GET /news/feed/bulk`, `POST /news/acquire` |
| `apps/api/routes/portfolio.py` | Include `id` in the watchlist item payload |
| `apps/api/models/schema_parts/` | Response models for the two new routes; `id` on the watchlist item |

No database migration. `news` and `acquisition_state` already exist, and `watchlist.id`
already exists and is already selected by `SELECT *`.

**Frontend — new**

| File | Purpose |
|---|---|
| `apps/web/app/portfolio/components/PortfolioShell.tsx` | Two-column grid, sticky rail, panel host |
| `apps/web/app/portfolio/components/SidePanel.tsx` | Slide-over: focus trap, `Esc`, `aria-modal` |
| `apps/web/app/portfolio/components/StockTileGrid.tsx` | Grid, membership rule, filter and search |
| `apps/web/app/portfolio/components/StockTile.tsx` | One tile |

**Frontend — modified**

| File | Change |
|---|---|
| `apps/web/app/portfolio/page.tsx` | Compose the shell; move section JSX into panels; keep data wiring |
| `apps/web/app/portfolio/components/PortfolioSnapshotSummary.tsx` | Becomes a panel body; dead stale banner removed |
| `apps/web/lib/` news client | `fetchBulkNews`, `acquireNews` |
| `apps/web/tests/e2e/helpers/portfolioPageMock.ts` and portfolio specs | Selector updates for the new layout |

`PortfolioAttributionSummary`, `PortfolioAllocationEditor` and `PortfolioCommandCenter` move
into panels unchanged.

## Related cleanup

`snapshot_is_stale` is now always `False` from every backend construction site, leaving the
stale-warning banner in `PortfolioSnapshotSummary` permanently inert — currently logged as a
deferral. This redesign rebuilds that component's container, so the dead banner is removed
here rather than carried into the new layout.

## Testing

**Backend**

- `Hourly` boundary, mirroring the existing `Daily` tests, including `at_minute` validation
  failing at declaration rather than at first use.
- `fetch_news` with an injected crawler: normal payload, provider raising, empty result.
- `save_news` dedupe through the existing `hash UNIQUE` constraint.
- The acquire loop: fresh means no crawl, stale means crawl.
- `GET /news/feed/bulk`: every requested ticker present as a key; a ticker with no news
  returns `articles: []` rather than being omitted; `last_checked_at` is `null` for a never
  acquired ticker and set for one that was checked and found nothing — the two cases the
  tile must distinguish.
- Bulk ordering: newest first, and an article with an empty `published_date` sorts after
  every dated one rather than displacing a dated article from a three-item tile.
- `/news/acquire` validation: duplicates collapse to one crawl; a ticker outside the
  watchlist is never crawled and comes back in `skipped_unknown`; an empty post-validation
  list is 400; 101 tickers is 400.
- Failure aggregation: with one ticker failing mid-batch, the remaining tickers still
  acquire, the response is 200, and the failing ticker carries `status: "failed"` with a
  detail.

**The seam test, explicitly**

Every news test injects the crawler, which leaves the network guard silent at that boundary
— the blind spot that hid both Critical findings in the 2026-07-31 branch review. So one
test exercises `POST /news/acquire` with **production wiring** under `_forbid_network` and
asserts it does not reach the network.

**Frontend**

- Tile renders price header and headlines from fixture data.
- Membership rule: held stocks when weights exist; the twelve highest `id`s when none do,
  with its banner; and the weight line suppressed rather than showing `0.0%` twelve times.
- Refresh reports per-ticker outcome, including the mixed case and the all-current case.
- The captured ticker set: changing the filter while a batch is in flight does not change
  what that batch acquires or what its summary reports.
- A successful refresh invalidates the bulk news key and nothing else.
- Panel opens on icon click, closes on `Esc`, traps focus while open.

**Known breakage**

The existing Playwright specs target the stacked layout. `portfolioPageMock.ts` and the
portfolio specs need selector updates. This is real work in the plan, not a footnote.

## Acceptance criteria

Each is observable, and each maps to a test.

1. **One scrolling region.** The portfolio page has exactly one vertically scrolling element
   — the tile grid. The rail and the grid header stay fixed while it scrolls.
2. **One request for news.** Rendering the grid issues exactly **one** news request
   regardless of tile count. Twelve tiles produce one `GET /news/feed/bulk`, not twelve.
3. **Refresh is scoped to what is visible.** `POST /news/acquire` carries exactly the ticker
   set captured at press time — never the full 139-row watchlist, and never a set changed by
   a filter interaction during the batch.
4. **Refresh reports its outcome.** Completion states refreshed, already-current and failed
   counts, with failing tickers named. Pressing refresh twice within the hour reports every
   ticker as already-current and performs zero provider calls.
5. **Panels are free.** Opening or closing any panel issues no network request.
6. **Empty is never ambiguous.** A tile with no news distinguishes "checked at HH:MM, none
   found" from "never checked", from the `last_checked_at` in the bulk response.
7. **Offline-safe.** The whole metric and grid render path passes with the suite's network
   guard active; only `POST /news/acquire` reaches the provider.

## Future scalability

The design targets watchlists of roughly 100–200 rows, which is where this one sits at 139.
Two growth paths exist and neither disturbs the architecture:

- **More tiles.** `StockTileGrid` can adopt windowed rendering internally. Membership,
  panels and acquisition are unaffected, because the grid already computes its visible set
  explicitly and that set is what the bulk read and the refresh both consume.
- **Slower or larger batches.** Batch execution can move to a bounded worker pool behind the
  unchanged `/news/acquire` contract, per the triggers in Batch execution above.

The 100-ticker request cap is the deliberate boundary between these: past it, the answer is
a different interaction — a background job with progress — rather than a bigger loop.

## Scope

Roughly twelve tasks: six backend (`Hourly` boundary; news source; news store; registry plus
the `/news/acquire` route with its validation and aggregation; the bulk feed route with its
acquisition-state join and ordering; `id` on the watchlist payload), five frontend (shell,
side panel, grid with membership and filter, tile, states and refresh reporting), one for the
Playwright selector updates.
Comparable in size to the statements-acquisition plan and coherent as a single plan, because
the tile cannot render without the bulk news read and the refresh button has no home without
the rail.

## Open questions

None.

Four structural decisions were made during brainstorming: the rail opens side panels; tiles
carry a price header plus two to three headlines; membership is held-stocks with a
twelve-most-recent fallback; news becomes a data class on an hourly boundary.

Two ambiguities were found during spec self-review and resolved above: how "most recently
added" is ordered when `watchlist` has no `created_at`, and what the weight line shows when
every weight is zero.

A specification review on 2026-07-31 raised twelve further gaps, all now closed in this
document — batch concurrency (sequential, with the measurement and the revisit triggers that
justify it), the `/news/acquire` contract (dedupe, watchlist intersection, 100-ticker cap,
error codes), bulk ordering, refresh snapshot semantics, acceptance criteria, the
acquisition-state join, membership transitions, the cache boundary, failure aggregation, the
Hourly rationale, cancellation, and the scalability path. Where that review offered
alternatives, this document picks one and records why.
