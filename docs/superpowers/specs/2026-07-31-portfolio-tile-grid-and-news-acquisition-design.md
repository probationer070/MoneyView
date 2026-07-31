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

### News: two operations

Only the second was in the original request, but the first is required for tiles to render.

**Read.** `GET /news/feed` takes a single ticker, so twelve tiles would mean twelve round
trips. Add a bulk read:

```
GET /news/feed/bulk?tickers=A,B,C&per_ticker=3
-> { "A": [article, ...], "B": [...], "C": [] }
```

One query for the whole grid, keyed on the visible ticker list.

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

1. Existing watchlist query produces `PortfolioStock[]`.
2. Membership rule selects the visible tickers, client-side.
3. Bulk news query, keyed on that ticker list, fills the tiles' lower half.
4. Rail refresh button posts the visible tickers to `/news/acquire`.
5. On success the bulk news query is invalidated and tiles re-render. No page reload and no
   per-tile spinners.
6. Panels read from existing page state; opening one performs no fetch of its own.

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

- Source-level failures are recorded per ticker by `acquire_point_in_time` and surfaced in
  the refresh summary. One failing ticker does not abort the batch.
- A transient failure advances `last_checked_at` and so suppresses retry until the next
  hourly boundary. This is the known, deliberate consequence of the freshness rule, already
  recorded as a deferral in `guideline/sop/todo.md`. At Hourly rather than Weekly the blast
  radius is small.
- The bulk news read failing degrades tiles to their price header with an inline notice; it
  never blanks the grid.

## Cleanup included

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
- `GET /news/feed/bulk` response shape, including a ticker with no news returning `[]`
  rather than being omitted.

**The seam test, explicitly**

Every news test injects the crawler, which leaves the network guard silent at that boundary
— the blind spot that hid both Critical findings in the 2026-07-31 branch review. So one
test exercises `POST /news/acquire` with **production wiring** under `_forbid_network` and
asserts it does not reach the network.

**Frontend**

- Tile renders price header and headlines from fixture data.
- Membership rule: held stocks when weights exist; the twelve highest `id`s when none do,
  with its banner; and the weight line suppressed rather than showing `0.0%` twelve times.
- Refresh reports per-ticker outcome, including the mixed case.
- Panel opens on icon click, closes on `Esc`, traps focus while open.

**Known breakage**

The existing Playwright specs target the stacked layout. `portfolioPageMock.ts` and the
portfolio specs need selector updates. This is real work in the plan, not a footnote.

## Scope

Roughly eleven tasks: five backend (`Hourly` boundary, news source, news store, registry
plus acquire route, bulk feed route), five frontend (shell, side panel, grid with membership
and filter, tile, states and refresh reporting), one for the Playwright selector updates.
Comparable in size to the statements-acquisition plan and coherent as a single plan, because
the tile cannot render without the bulk news read and the refresh button has no home without
the rail.

## Open questions

None. Four structural decisions were made during brainstorming — rail opens side panels;
tiles carry a price header plus two to three headlines; membership is held-stocks with a
twelve-most-recent fallback; news becomes a data class on an hourly boundary — and the two
ambiguities found during spec review (how "most recently added" is ordered, and what the
weight line shows when every weight is zero) are resolved above.
