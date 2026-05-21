# Corporate Analysis Tab

The Corporate Analysis tab is the valuation and company-diagnostics workspace at `http://localhost:3000/corporate`.

## What It Shows

### 1. Header Controls

- `Company Search`
  Searches saved companies and switches the active ticker for analysis.
- `Intrinsic DCF`
  Shows the current backend intrinsic DCF estimate for the selected ticker and opens the detailed DCF explanation modal.
  See [DCF Valuation](./dcf-valuation.md) for the full formula walkthrough and MoneyView-specific implementation notes.
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
  Breaks the DCF into sustainable growth, terminal value share, FCFF, and backend intrinsic value context

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
  Fixed to `S&P 500 (^GSPC)` for the current live comparison workflow
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

## How To Use The Graphs

### 1. Start with KPI cards

Use the KPI cards to decide which diagnostic graph deserves attention first.

- if `ROIC - WACC` is weak or negative, focus on value-creation and hurdle-rate graphs
- if `Bottom-up Ke` or `Levered Beta` looks high, focus on leverage and risk decomposition
- if `Success Probability` is weak, use the risk-return and value-driver visuals before changing multiple sliders at once

Practical rule:

- change one major assumption at a time
- watch which KPI moves first
- then use the graph tied to that KPI to understand why

### 2. Use the six diagnostic graphs by question

#### `Company Status Graph`

Use this when you want a fast operating-profile read.

- look for obvious strengths and weaknesses rather than tiny score differences
- use it to spot imbalance across health dimensions
- if one spoke is much weaker than the others, review the supporting assumptions and source data before concluding the company is broadly weak

#### `Hurdle Rate Decomposition`

Use this when the company looks expensive or risky and you need to know which required-return component is driving that result.

- check whether the hurdle rate is being lifted mostly by base market risk, beta, or country risk premium
- if the hurdle rate seems too punitive, adjust the relevant driver rather than forcing the final DCF result directly

#### `Beta + WACC Curve`

Use this when testing leverage sensitivity.

- read how debt-ratio changes alter beta and WACC together
- use it to avoid unrealistic leverage assumptions that make valuation look better only because one slider was pushed too far

#### `Value Driver Matrix`

Use this when you want to place the company in a growth-versus-quality frame.

- read it as positioning, not precision
- use it to compare the selected ticker against the kind of value-creation story you think the business has

#### `Risk-Return Minard`

Use this when deciding whether the current setup is attractive enough to keep modeling.

- read spread and success probability together
- if spread looks good but success probability is weak, treat the case as fragile rather than obviously attractive
- see [Risk-Return Minard Chart](./risk-return-minard.md) for the current MoneyView calculation formula and scenario-construction details

#### `DCF Core Modules`

Use this when you need to understand what is actually driving the intrinsic-value result.

- check sustainable growth first
- then review terminal value share and FCFF support
- if intrinsic value looks too sensitive to terminal assumptions, do not treat the point estimate as stable

### 3. Use the calculation detail modal for verification

Every major graph and KPI can lead into the same detail system.

- open the modal when you need formulas, source lineage, and raw supporting datasets
- use the CSV downloads when you want to verify that a chart is not hiding a weak input set
- prefer the modal before making large slider changes based only on chart shape

### 4. Use Target Stock Comparison as a ranking tool, not a final decision tool

The bottom comparison section is best for ranking and triage.

#### Similar Stocks Spread View

- use this first to compare the selected ticker against sector peers
- if there are too few same-sector names, remember the chart falls back to the active comparison universe
- treat a strong spread bar as a prompt to inspect assumptions, not as proof the stock is superior

#### Price Vs Fair Value Map

- use this to see whether market price already sits above or below DCF value
- larger bubbles mean larger expected-return spread, so investigate big outliers first
- if a bubble is far from peers, confirm the price and DCF assumptions before trusting the signal

#### Comparison table

- sort by expected return spread for idea generation
- sort by `ROIC - WACC` for quality and value-creation review
- sort by DCF value when you want raw valuation context
- use the highlighted active ticker row as the anchor while scanning peers

Important interpretation rule:

- this section is live and non-persisted
- use Portfolio, not Corporate Analysis, when you need saved snapshots, history, or weight-aware review

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
  Returns the backend DCF result used by the intrinsic-value widgets
- `GET /api/v1/corporate/comparison`
  Returns live comparison rows and comparison metadata for the bottom comparison table

## Relationship To Portfolio

Corporate Analysis is ticker-centric and comparison-centric.

- Use `Corporate Analysis` for live assumption tuning, company diagnostics, DCF inspection, and ad-hoc comparison
- Use `Portfolio` for saved weights, implied cash, attribution, persisted snapshots, and snapshot history
