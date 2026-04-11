# Corporate Analysis Tab

The Corporate Analysis tab is the valuation and company-diagnostics workspace at `http://localhost:3000/corporate`.

## What It Shows

### 1. Header Controls

- `Company Search`
  Searches saved companies and switches the active ticker for analysis.
- `Backend DCF`
  Shows the current backend fair value estimate for the selected ticker and opens the detailed DCF explanation modal.
- `Add Company`
  Persists a manual company and ticker so it can be selected for future analysis.

### 2. Realtime Assumptions

The left-side control panel is the main modeling surface. It drives the frontend-derived metrics and the debounced backend DCF request.

It includes:

- `Growth Basis`
  Choose `5-year CAGR`, `Recent multi-year average`, or `Select annual value`
- `Growth Year`
  Available when annual growth is selected
- `ROIC Basis`
  Choose `Recent multi-year average`, `All available years average`, or `Select annual value`
- `ROIC Year`
  Available when annual ROIC is selected

The slider controls cover:

- `Growth Rate`
- `ROIC`
- `WACC`
- `Debt Ratio`
- `Unlevered Beta`
- `Country Risk Premium`
- `Reinvestment Rate`
- `Innovation Index`
- `Governance Quality`
- `ESG / Agency Penalty`

Behavior:

- Yahoo annual statement data from 2021 onward is the preferred source where available
- saved backend metrics in SQLite `corporate_metrics` are used as persistence/fallback
- browser local state preserves the current working assumptions per ticker
- deterministic company or sector defaults are used when live or saved data is missing

### 3. KPI Cards

The top-right cards summarize the selected ticker's current valuation profile:

- `ROIC - WACC`
  Value-creation spread
- `Bottom-up Ke`
  Cost of equity estimate
- `Levered Beta`
  Equity risk after leverage
- `Success Probability`
  Scenario-style score derived from spread, growth, and penalty inputs

Each card is clickable and opens a detailed explanation modal with formulas and data lineage.

### 4. Diagnostic Graphs

The main analysis surface includes six graph modules:

- `Company Status Graph`
  Company health and radar-style operating profile
- `Hurdle Rate Decomposition`
  Shows the components of hurdle rate and regional or Minard-style context
- `Beta + WACC Curve`
  Visualizes leverage sensitivity, beta, and WACC behavior
- `Value Driver Matrix`
  Places the company in a quadrant-style value-driver view
- `Risk-Return Minard`
  Maps spread and success probability into a risk-return visual
- `DCF Core Modules`
  Breaks the DCF into sustainable growth, terminal value share, FCFF, and backend fair value context

All of these chart titles or related metrics can open the same calculation-detail modal system.

### 5. Calculation Detail Modal

When a metric or chart is selected, the tab opens a detailed modal that explains:

- formula used
- result
- source lineage
- simulation or calculation steps
- summary and components

The modal also exposes raw supporting datasets and CSV downloads for:

- raw analysis datasets
- 5-year historical OHLCV price data
- quarterly financial statements

### 6. Target Stock Comparison

The bottom section is a live comparison workspace for watchlist names or custom ticker sets. This is not the same as Portfolio's weighted testing workflow.

It shows:

- risk-free rate
- equity risk premium
- stock return method
- comparison reference method
- comparison type
- comparison universe

Controls in this block:

- `Universe`
  Switches between `watchlist_plus_benchmark` and `custom`
- `Benchmark`
  Changes the comparison benchmark ticker
- `Korea preset`
  Quick-select preset benchmark tickers
- `Custom tickers`
  Available when the universe is `custom`
- `Sort by`
  Sort rows by expected return spread, `ROIC - WACC`, or DCF value
- `Direction`
  Sort high-to-low or low-to-high
- `Open Portfolio Testing`
  Jumps to the Portfolio page for saved-weight, implied-cash, and snapshot workflows

The comparison table shows:

- ticker
- company
- weight
- `ROIC - WACC`
- DCF value
- current price
- DCF return
- CAPM return
- market return
- expected return spread

Behavior:

- this section stays in live comparison mode
- snapshot history and persisted portfolio-side snapshots are managed from the Portfolio tab, not here
- the active selected ticker is highlighted inside the comparison table

## Data Sources

- `GET /api/v1/corporate/companies`
  Loads saved companies for search and selection
- `POST /api/v1/corporate/companies`
  Adds a manual company for future analysis
- `GET /api/v1/corporate/metrics/{ticker}`
  Loads current saved or derived metrics for the active ticker
- `PUT /api/v1/corporate/metrics/{ticker}`
  Persists updated ticker metrics
- `GET /api/v1/corporate/metrics/{ticker}/history`
  Provides annual metric history for growth and ROIC basis selection
- `GET /api/v1/corporate/metrics/{ticker}/quarterly-statements`
  Provides quarterly financial statement rows for the detail modal
- `GET /api/v1/detail/{ticker}/ohlcv`
  Provides 5-year historical price data for the detail modal used by Corporate Analysis
- `POST /api/v1/corporate/dcf/{ticker}`
  Returns the backend DCF result used by the fair-value widgets
- `GET /api/v1/corporate/comparison`
  Returns live comparison rows and comparison metadata for the bottom comparison table

## Relationship To Portfolio

Corporate Analysis is ticker-centric and comparison-centric.

- Use `Corporate Analysis` for live assumption tuning, company diagnostics, DCF inspection, and ad-hoc comparison
- Use `Portfolio` for saved weights, implied cash, attribution, persisted snapshots, and snapshot history
