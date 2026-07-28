# Portfolio Tab

The Portfolio tab is the main local-first holdings, snapshot-review, and attribution workspace at `http://localhost:3000/portfolio`.

## What It Shows

### 1. Comparison Snapshot Summary

The top section is the portfolio-side corporate comparison surface. It is intentionally separate from attribution.

It shows:

- snapshot `as of` date
- snapshot source mode
- comparison universe
- saved benchmark ticker
- positive spread counts
- positive `ROIC - WACC` counts
- highest expected-return spread
- generated timestamp and version count for the KST day

Important interpretation rules:

- portfolio-level averages are intentionally demoted because outliers can make them misleading
- per-stock rows are the primary comparison surface
- flagged extreme values render as `N/A` instead of receiving valid-looking colors
- when a saved snapshot is selected from history, the page keeps that snapshot's benchmark and universe context locked for review until the selection is cleared

Controls in this block:

- `Portfolio comparison universe`
  Switches between `portfolio_plus_benchmark` and `custom`
- `Portfolio benchmark preset`
  Quick-selects common benchmark tickers
- `Portfolio benchmark ticker`
  Manual ticker entry always wins over presets
- `Portfolio custom tickers`
  Available only in `custom`
- `Portfolio comparison source`
  Switches between persisted snapshot and live calculation
- `Save Current As Snapshot`
  Persists the current comparison result as the day snapshot
- `Open Full Comparison View`
  Opens the Corporate tab
- `Open Snapshot History`
  Opens the saved snapshot timeline modal

Comparison control UX:

- snapshot mode is the default portfolio review path
- live mode is review-only and does not overwrite history
- the page shows a visible `Calculating` chip while debounced benchmark or custom-ticker updates are still settling

### 2. Snapshot History Review

The history modal and stock modal drill-down both use persisted snapshot data.

The page-level history modal provides:

- one row per saved day/version group
- source label
- per-day version count
- average summary metrics
- explicit `Review Snapshot` action

When a saved snapshot is selected:

- the summary banner states that the snapshot is being reviewed
- table values and stock modal comparison metrics follow the saved snapshot
- benchmark/universe review context stays locked to the selected saved snapshot even if current controls change

The stock detail modal includes:

- TradingView-style OHLCV chart
- three key metric cards
- metric source banner with snapshot version
- recent price-trend summary from the holding sparkline
- saved snapshot drill-down with:
  saved snapshot count
  expected-spread trend delta
  saved per-day metric table
  watchlist-side sparkline context

If one or more stock comparison metrics are extreme or invalid:

- the modal shows an explicit outlier warning
- affected values render as `N/A`
- the price chart and saved snapshot history become the preferred review path

### 3. Attribution Summary

When the watchlist has holdings and the saved weights are valid, the Portfolio tab shows attribution KPIs:

- `Portfolio Return`
- `Benchmark Return`
- `Active Return`
- `Beta`

It also shows:

- benchmark methodology notes
- benchmark proxy status
- allocation donut chart
- attribution waterfall chart

The attribution request uses:

- saved watchlist weights when any positive weights exist
- equal-weight fallback only when no positive saved weights exist
- implied cash when saved weights sum to less than `100%`
- the current benchmark and date window selected in the page

### How To Use The Graphs

#### Allocation donut chart

Use the allocation donut first when you want to understand concentration before interpreting performance.

- start by checking whether one or two sectors dominate the portfolio
- compare the largest slices against the saved-weight table and implied-cash state
- if a sector looks unexpectedly large, review saved weights before treating attribution output as intentional positioning
- use the sector filter in holdings to inspect the names driving a large slice

Interpretation rule:

- the donut explains where capital is allocated
- it does not explain whether that allocation helped or hurt performance

#### Attribution waterfall chart

Use the waterfall after the KPI cards when you want to explain `why` active return was positive or negative.

- read `Active Return` first to confirm whether the portfolio outperformed or underperformed
- then read `Allocation`, `Selection`, and `Interaction` in that order
- a positive effect means that source added value relative to the benchmark
- a negative effect means that source detracted from benchmark-relative performance
- open `Details` when you need the formula and the largest sector driver behind each effect

Practical reading order:

- if `Allocation` is large, review sector overweight and underweight decisions
- if `Selection` is large, inspect stock picking inside sectors
- if `Interaction` is large, review combined sector-bet and stock-pick effects rather than treating them as isolated drivers

#### Holding sparkline and stock-detail chart

Use the watchlist sparkline for triage and the stock modal chart for review.

- sparkline: quickly scan whether a holding has been trending up, down, or flat recently
- stock modal OHLCV chart: inspect the exact price path when a row-level comparison metric looks surprising or invalid
- if the modal shows outlier warnings or `N/A` comparison values, prefer the price chart and saved snapshot history over the spread metrics

#### Snapshot-history visuals

Use snapshot history when you want to compare the same stock or portfolio comparison across saved review dates.

- open history from the page when you want day/version context
- open stock-level history when you want to see how spread and DCF review metrics changed for one name
- treat saved snapshots as the authoritative review path when the current live comparison is moving around during the day

### 4. Watchlist Holdings

This is the tracking list, not the weighted portfolio model itself.

Each holding shows:

- company name
- ticker
- sector
- last close
- day-over-day delta
- recent sparkline

The holdings section supports:

- card view
- table view
- sector grouping
- mobile-priority column collapse
- add holding
- remove holding
- click-through stock detail modal

Manual add behavior:

- `Add to Watchlist only` is the default and preserves watchlist/portfolio separation
- turning it off seeds an initial allocation intentionally
- saving a manual ticker should not silently couple tracking and weighted-portfolio ownership

### 5. Watchlist Sync Controls

The watchlist block also includes:

- `Export Watchlist To JSON`
  Writes the DB-backed watchlist, including weights, to `stock_targets.json`
- `Import JSON Into DB`
  Replaces the DB watchlist from the JSON file and is intentionally destructive
- sync/import status
  Shows last source, last time, and JSON path

### 6. Portfolio Allocation Model

This is where tracked names become the weighted test portfolio.

It shows:

- tracked names count
- allocated names count
- invested weight
- implied cash weight
- cash treatment

It also provides:

- per-row saved weight display
- editable allocation percentage input
- `Save` per holding
- `Normalize To 100%`
- `Apply to Snapshot`

Behavior:

- positive saved weights are used directly for attribution and export
- if the total saved weight is below `100%`, the remainder is treated as explicit cash
- zero-weight names remain visible in the watchlist but do not affect the weighted portfolio
- if no positive saved weights exist, the page falls back to equal stock weights with no explicit cash row
- `Apply to Snapshot` is default `OFF` so allocation editing remains separate from snapshot history unless the user opts in

## Error And Empty States

The Portfolio tab can also show:

- `Portfolio Data Unavailable`
- `No Holdings Yet`
- `Attribution Pending Portfolio`
- `Allocation Weights Exceed 100%`
- `Attribution Engine Unavailable`
- `Portfolio Snapshot Summary Unavailable`
- `Snapshot History Unavailable`
- `Selected Snapshot Unavailable`
- `Snapshot Trend Unavailable`

## Data Sources

- `GET /api/v1/portfolio/watchlist`
  Holdings list plus last close, delta, and sparkline
- `POST /api/v1/portfolio/watchlist`
  Add or update a holding or saved weight
- `DELETE /api/v1/portfolio/watchlist/{ticker}`
  Remove a holding
- `POST /api/v1/portfolio/attribution`
  Attribution summary and sector effects
- `GET /api/v1/portfolio/stock/{ticker}`
  Per-holding price history and detail payload
- `GET /api/v1/news/feed`
  Stored news for a ticker
- `POST /api/v1/news/crawl/stock`
  Crawl fallback for ticker news
- `GET /api/v1/corporate/comparison`
  Latest snapshot summary or live comparison
- `POST /api/v1/corporate/comparison/snapshot`
  Manual snapshot save
- `GET /api/v1/corporate/comparison/history`
  Snapshot timeline modal
- `GET /api/v1/corporate/comparison/snapshot-version`
  Selected saved snapshot review path
- `GET /api/v1/corporate/comparison/stock-history`
  Stock modal saved metric drill-down
