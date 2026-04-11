# Portfolio Tab

The Portfolio tab is the main holdings and attribution workspace at `http://localhost:3000/portfolio`.

## What It Shows

### 1. Header Controls

- `Holding Start Date`
  Sets the start date for return, attribution, and beta calculations.
- `Return End Date`
  Sets the end date for the same calculations. If blank, the latest cached market date is used.
- `Export`
  Exports the current attribution/report payload for the active holdings, weights, benchmark, and date range.

### 2. Latest Snapshot Summary

This is the portfolio-side corporate comparison summary. It is separate from the attribution engine.

It shows:

- snapshot `as of` date
- source mode: persisted snapshot or live calculation
- comparison universe
- benchmark ticker
- average expected return spread
- average `ROIC - WACC`
- average DCF value
- generated timestamp and snapshot count for the day

Controls in this block:

- `Universe`
  Switches between `portfolio_plus_benchmark` and `custom`
- `Benchmark`
  Lets the user change the comparison benchmark ticker
- `Korea preset`
  Quick-select preset benchmark tickers
- `Custom tickers`
  Available when the universe is `custom`
- `Source`
  Switches between persisted snapshot and live calculation
- `Save Current As Snapshot`
  Persists the current comparison result as the day snapshot
- `View Full Comparison` / `Open Full Comparison View`
  Opens the Corporate tab
- `Open Snapshot History`
  Opens the historical snapshot timeline modal

### 3. Attribution Summary

When the watchlist has holdings and the weights are valid, the Portfolio tab shows attribution KPIs:

- `Portfolio Return`
- `Benchmark Return`
- `Active Return`
- `Beta`

It also shows:

- benchmark selection and methodology notes
- benchmark weight source
- benchmark proxy method
- allocation donut chart
- attribution waterfall chart with allocation, selection, interaction, and active return effects

The attribution request uses:

- saved watchlist weights when any positive weights exist
- equal-weight fallback only when no positive saved weights exist
- implied cash when saved weights sum to less than `100%`
- the current benchmark and date window selected in the page

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
- add holding
- remove holding
- click-through stock detail modal

The stock detail modal shows:

- TradingView-style price chart from `/portfolio/stock/{ticker}`
- paginated ticker news from `/news/feed`
- crawl-on-demand stock news fallback through `/news/crawl/stock`

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

Behavior:

- positive saved weights are used directly for attribution and export
- if the total saved weight is below `100%`, the remainder is treated as explicit cash
- zero-weight names remain visible in the watchlist but do not affect the weighted portfolio
- if no positive saved weights exist, the page falls back to equal stock weights with no explicit cash row

## Error And Empty States

The Portfolio tab can also show:

- `Portfolio Data Unavailable`
- `No Holdings Yet`
- `Attribution Pending Portfolio`
- `Allocation Weights Exceed 100%`
- `Attribution Engine Unavailable`
- `Portfolio Snapshot Summary Unavailable`

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
- corporate comparison endpoints
  Used for the snapshot summary and snapshot history shown at the top of the page
