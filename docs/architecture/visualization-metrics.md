# MoneyView Visualization And Metrics

This document is the canonical specification for MoneyView feature modules, KPI meaning, chart semantics, filter behavior, frontend/backend ownership, and drill-down rules.

Use this file together with:

- `docs/architecture/moneyview-api-reference.md` for endpoint contracts
- `docs/architecture/moneyview-quant-engine.md` for canonical finance methodology
- `docs/architecture/data-flow.md` for end-to-end execution sequences
- `docs/portfolio-tab.md`
- `docs/corporate-analysis-tab.md`
- `docs/monte-carlo-tab.md`

It exists to prevent metric meaning from drifting into page-local JSX, tooltip strings, and chart adapters.

## 1. Ownership Rules

### 1.1 Canonical metric meaning

Metric meaning is owned by the backend or finance-engine layer when the metric depends on:

- attribution logic
- DCF or hurdle-rate methodology
- benchmark construction
- expected-return methodology
- persisted snapshot semantics
- report/export payload structure
- log and diagnostic endpoint behavior

Examples:

- `Portfolio Return`
- `Benchmark Return`
- `Active Return`
- `Beta`
- `ROIC - WACC`
- DCF fair value
- expected return spread
- report summary metrics
- API log tail metadata

### 1.2 Frontend-owned presentation work

The frontend may reshape, cache, sort, color, or annotate domain metrics for display, but it does not redefine the underlying metric.

Frontend-owned responsibilities include:

- converting API payloads into Recharts or TradingView-series props
- formatting percentages, currency, and labels
- choosing color scales and card emphasis
- sorting comparison tables
- chart-only derived helpers such as bubble size, sparkline direction, and UI status copy
- session/local storage caching for user review continuity

### 1.3 Implicit logic promoted into this doc

Track 6 promotes several meanings that previously lived mainly in UI code:

- positive attribution and comparison metrics use positive/negative color semantics rather than neutral-only display
- portfolio comparison rows with extreme or invalid values render as `N/A` instead of pretending precision
- Market Overview modal warnings distinguish stale-cache fallback from live-refresh recovery
- Monte Carlo tabs share one path result across `Path Simulation`, `Risk Analysis`, and `Return Distribution`
- Corporate `Target Stock Comparison` is live-only, while persisted snapshot review belongs to `Portfolio`
- diagnostic workbenches and DCF workbenches stay idle on first load and refresh only on explicit user action

## 2. Module Specs

## 2.1 Market Overview

### Purpose

Provide a local-first market scan for major tracked indices and macro proxies before the user drills into portfolio, corporate, or simulation workflows.

### Main screens

- `/` page header and snapshot grid/table
- market detail modal inside `apps/web/components/market/MarketOverviewClient.tsx`

### Primary data sources

- `GET /api/v1/market/indices`
- `GET /api/v1/market/index/{ticker}/detail`

### Core state

- SSR-loaded initial index snapshot
- client-side view mode: chart or table
- selected instrument modal
- modal chart timeframe: `daily` or `monthly`

### Outputs

- market snapshot cards or rows
- OHLCV detail chart
- daily and monthly technical-indicator panels
- volume summary cards
- instrument-context interpretation block
- data-quality and freshness warnings

### Dependencies

- backend market snapshot and detail routes
- chart transformers in `apps/web/lib/transformers`
- TradingView-style chart component

## 2.2 Portfolio Command Center

### Purpose

Act as the saved-holdings, saved-allocation, attribution, and persisted corporate-snapshot review workspace.

### Main screens

- `/portfolio`
- stock detail modal
- snapshot history modal

### Primary data sources

- `GET/POST/DELETE /api/v1/portfolio/watchlist`
- `POST /api/v1/portfolio/attribution`
- `GET /api/v1/portfolio/stock/{ticker}`
- `GET /api/v1/corporate/comparison`
- `POST /api/v1/corporate/comparison/snapshot`
- `GET /api/v1/corporate/comparison/history`
- `GET /api/v1/corporate/comparison/snapshot-version`
- `GET /api/v1/corporate/comparison/stock-history`
- `GET /api/v1/news/feed`
- `POST /api/v1/news/crawl/stock`

### Core state

- DB-backed watchlist
- saved weights and total investment settings
- date filters for attribution
- comparison mode: live vs snapshot review
- benchmark and comparison-universe controls
- selected stock for modal review
- sector filter and view mode
- allocation drafts and auto-save status

### Outputs

- comparison snapshot summary
- attribution KPI cards
- allocation donut
- attribution waterfall
- holdings cards/table
- portfolio allocation workspace
- snapshot history review
- stock-level modal with prices, news, and snapshot history

## 2.3 Corporate Analysis

### Purpose

Provide ticker-centric valuation analysis, backend DCF inspection, operating diagnostics, and live cross-stock comparison.

### Main screens

- `/corporate`
- calculation-detail modal
- bottom live comparison section

### Primary data sources

- `GET /api/v1/corporate/companies`
- `POST /api/v1/corporate/companies`
- `GET /api/v1/corporate/metrics/{ticker}`
- `PUT /api/v1/corporate/metrics/{ticker}`
- `GET /api/v1/corporate/metrics/{ticker}/history`
- `GET /api/v1/corporate/metrics/{ticker}/quarterly-statements`
- `GET /api/v1/detail/{ticker}/ohlcv`
- `POST /api/v1/corporate/dcf/{ticker}`
- `POST /api/v1/corporate/dcf/{ticker}/stream`
- `POST /api/v1/corporate/dcf/{ticker}/report`
- `POST /api/v1/corporate/dcf/reports/bulk`
- `GET /api/v1/corporate/comparison`
- `GET /api/v1/corporate/diagnostic/{ticker}/radar`
- `GET /api/v1/corporate/diagnostic/{ticker}/tornado`

### Core state

- active ticker
- live assumption sliders and basis selectors
- cached DCF and comparison results
- comparison-universe, benchmark, sort, and direction controls
- selected comparison row for peer charts
- detail modal state for formula explanations and downloads

### Outputs

- KPI cards
- six diagnostic graph modules
- batch and streamed DCF views
- live comparison table
- peer spread bar chart
- price-vs-fair-value scatter
- batch DCF report table

## 2.4 Simulation Lab

### Purpose

Run browser-side exploratory simulations without blocking the backend request path.

### Main screens

- `/monte-carlo`

### Primary execution model

- shared worker `apps/web/app/monte-carlo/workers/simulation.worker.ts`
- path engine for path, risk, and return-distribution tabs
- separate valuation worker job
- separate correlation worker job

### Core state

- active tab
- path input
- valuation input
- correlation input
- worker progress and cancellation state
- shared path result
- valuation result
- correlation result

### Outputs

- percentile path charts and cones
- risk cards and downside charts
- return histogram and normal-fit overlays
- single-stock valuation distribution
- correlation frontier, sensitivity, and heatmap views
- CSV exports for shared path outputs

## 2.5 Reports And Export

### Purpose

Convert canonical backend portfolio analysis into portable markdown, HTML, or JSON outputs without moving report methodology into the browser.

### Primary data sources

- `POST /api/v1/report/summary`
- `POST /api/v1/report/export`

### Dependencies

- attribution pipeline
- backend report renderer and export formatter

### Outputs

- canonical report payload
- formatted export blobs
- downstream frontend export-button workflows

### Key rule

Report metrics inherit portfolio attribution semantics. Export formatting is a serialization concern, not a new analytics layer.

## 2.6 News And Crawling

### Purpose

Provide persisted article retrieval plus explicit live crawl refresh when stored article coverage is missing or stale.

### Primary data sources

- `GET /api/v1/news/feed`
- `POST /api/v1/news/crawl`
- `POST /api/v1/news/crawl/stock`
- portfolio stock-detail endpoint, which embeds recent ticker news

### Outputs

- stock news lists in detail workflows
- fallback crawl-triggered refresh paths

### Key rule

News is support context. It informs interpretation and review, but it does not redefine canonical valuation or attribution metrics.

## 2.7 Diagnostics And Log Visibility

### Purpose

Expose local runtime-health and sensitivity context without requiring the user to inspect server terminals directly.

### Primary data sources

- `GET /api/v1/diagnostic/logs/api-tail`
- `GET /api/v1/corporate/diagnostic/{ticker}/radar`
- `GET /api/v1/corporate/diagnostic/{ticker}/tornado`
- DCF workbench refresh requests

### Outputs

- local API log tail visibility
- corporate radar and tornado diagnostics
- DCF workbench summary cards
- explicit stale-vs-fresh diagnostic refresh state

## 3. Market Overview Metrics And Charts

## 3.1 Snapshot grid and table

### Current Value

- Meaning: latest close or latest available snapshot value for the tracked instrument.
- Source: `last_close` from `GET /api/v1/market/indices`.
- Ownership: backend defines the value; frontend formats and rounds it.
- Filters/time windows: page-level snapshot only.
- Granularity: one value per instrument.
- Color semantics: neutral text.
- Drill-down: click a card or ticker row to open detail.

### Abs Change

- Meaning: absolute move versus prior close in the snapshot payload.
- Source: `delta.delta_abs`.
- Ownership: backend computes; frontend signs and colors.
- Granularity: one value per instrument.
- Color semantics: positive uses `var(--delta-up)`, negative uses `var(--delta-down)`.
- Drill-down: same modal path as Current Value.

### Pct Change

- Meaning: percentage move versus prior close.
- Source: `delta.delta_pct`.
- Ownership: backend computes; frontend renders with `DeltaBadge`.
- Granularity: one value per instrument.
- Color semantics: same positive/negative rule as other delta metrics.

### Sparkline and Observed Trend

- Meaning: compact recent path for quick direction scan, then modal-level summary of whether the visible sparkline implies uptrend, downtrend, or flat trend.
- Source: `sparkline`.
- Ownership: backend owns the time-series payload; frontend-owned `summarizeTrend` derives the verbal trend label from the visible points.
- Filters/time windows: whatever short window is embedded in the snapshot payload.
- Granularity: sparkline sequence plus one summary label.
- Drill-down: opens the detail modal.

## 3.2 Market detail modal

### OHLCV Chart

- Meaning: expanded price-and-volume review for the selected market instrument.
- Source: `daily_history` or `monthly_history` from the detail endpoint.
- Ownership: backend owns bars; frontend converts them into candlestick, volume, and moving-average series.
- Filters/time windows:
  - requested period comes from the detail payload or snapshot period
  - user toggles `daily` vs `monthly`
- Granularity:
  - daily bars in daily mode
  - monthly bars in monthly mode
- Color semantics:
  - chart accent is red for positive daily move and blue for negative move in the current modal session
  - moving averages use stable colors: 20 orange, 50 green, 200 blue
- Drill-down behavior: no deeper in-chart drill path; interpretation continues via indicator, context, and data-quality panels.

### Technical indicators

- Meaning: RSI, MACD family, Bollinger bands, and moving averages for the chosen timeframe.
- Source: `daily_indicators` and `monthly_indicators`.
- Ownership: backend calculates; frontend relabels them based on instrument type.
- Filters/time windows: daily vs monthly.
- Granularity: one card per indicator field.
- Color semantics: neutral cards.
- Drill-down: none; cards are explanatory rather than interactive.

### Daily Volume

- Meaning: latest volume, rolling 20-day average, rolling 60-day average, and latest-vs-20-day change.
- Source: `volume_summary`.
- Ownership: backend computes; frontend formats integers and sign color.
- Filters/time windows: daily-only.
- Granularity: summary cards.
- Color semantics:
  - `Vs 20D Avg` is green when nonnegative and down-color when negative
  - unavailable FX volume remains `N/A`

### Market Regime

- Meaning: local regime classification for index instruments, including breadth and cross-asset risk-on/risk-off counts.
- Source: `market_regime` in detail payload.
- Ownership: backend defines the regime and counts; frontend only renders labels and percentages.
- Filters/time windows: current detail payload only.
- Granularity: summary cards.
- Drill-down: none in UI; interpretive bullets provide context.

### Data Quality

- Meaning: freshness, source lineage, last update, latest trading date, and fallback notes for the detail payload.
- Source: `data_quality`.
- Ownership: backend defines data-quality state; frontend surfaces warnings and fallback explanations.
- Color semantics: warning section uses amber treatment when stale cache, live refresh, or incomplete monthly history is detected.

## 4. Portfolio Command Center Metrics And Charts

## 4.1 Corporate comparison snapshot summary

### Snapshot `as of`, generated timestamp, version count, source mode

- Meaning: persisted review context for portfolio-side comparison snapshots or live calculation context when snapshot mode is not active.
- Source: `snapshot` metadata from `/api/v1/corporate/comparison` or selected snapshot-version endpoint.
- Ownership: backend owns meaning and retention/version semantics; frontend displays banners and lock-state.
- Filters/time windows:
  - current benchmark and universe
  - selected saved snapshot when in review mode
- Drill-down: `Open Snapshot History` and stock modal history table.

### Positive spread counts

- Meaning: count of rows whose expected-return spread is greater than zero.
- Source: comparison rows.
- Ownership: frontend aggregates the displayed row set, but the underlying spread metric is backend-owned.
- Filters/time windows: current snapshot/live comparison universe.
- Granularity: one count for the visible result set.
- Color semantics: positive count is informational, not a green/red confidence score.

### Positive `ROIC - WACC` counts

- Meaning: count of visible names creating positive value spread.
- Source: comparison rows.
- Ownership: backend owns each row value; frontend counts visible positives.

### Highest expected-return spread

- Meaning: best positive spread visible in the current comparison result set.
- Source: max of row spreads.
- Ownership: backend owns row spreads; frontend selects the displayed max.

## 4.2 Attribution KPI cards

### `Portfolio Return`

- Meaning: weighted total holding return over the selected attribution window.
- Formula/source: `sum(weight_i x holding return_i)`.
- Ownership: backend attribution engine computes; frontend tooltip text explains the formula.
- Filters/time windows:
  - holding start date
  - attribution as-of date
  - current benchmark ticker
  - stored weights or equal-weight fallback
- Granularity: one portfolio-level metric.
- Color semantics:
  - positive status is treated as good
  - negative status is treated as bad
- Drill-down: interpretation continues in waterfall and donut charts, not by a separate modal.

### `Benchmark Return`

- Meaning: benchmark-period return used as comparison hurdle.
- Formula/source: direct benchmark return or proxy-sector aggregate depending on backend methodology.
- Ownership: backend.
- Filters/time windows: same period as portfolio return.
- Color semantics: neutral display.

### `Active Return`

- Meaning: excess return versus benchmark.
- Formula/source: `Portfolio Return - Benchmark Return`.
- Ownership: backend; frontend status copy marks positive as outperforming and negative as underperforming.
- Filters/time windows: same as attribution request.
- Drill-down: active return is decomposed in the waterfall chart.

### `Beta`

- Meaning: portfolio sensitivity to market benchmark in the attribution output.
- Source: attribution response.
- Ownership: backend.
- Filters/time windows: same attribution request.
- Color semantics:
  - `<= 1.2` is framed as near-or-below-market risk
  - `> 1.2` is framed as above-market sensitivity

## 4.3 Allocation Donut

### Sector Allocation

- Meaning: share of portfolio weight allocated to each sector.
- Source: transformed attribution data through `toAllocationDonutData`.
- Ownership:
  - backend owns sector weights in the attribution payload
  - frontend adapts the payload into donut slices
- Filters/time windows: current holdings and active weight model.
- Granularity: sector-level share.
- Color semantics: categorical palette only; color does not imply good/bad.
- Drill-down behavior: no click drill-down. Sector isolation happens through the holdings-sector filter elsewhere on the page.

## 4.4 Attribution Waterfall

### Allocation, Selection, Interaction, Active Return

- Meaning: Brinson-style active-return decomposition.
- Formula/source:
  - Allocation: `(portfolio weight_i - benchmark weight_i) x (benchmark sector return_i - total benchmark return)`
  - Selection: `benchmark weight_i x (portfolio sector return_i - benchmark sector return_i)`
  - Interaction: `(portfolio weight_i - benchmark weight_i) x (portfolio sector return_i - benchmark sector return_i)`
  - Active Return: `Portfolio Return - Benchmark Return = Allocation + Selection + Interaction`
- Ownership:
  - backend attribution engine defines effect values and sector breakdowns
  - frontend chart component provides the modalized explanation and top-driver copy
- Filters/time windows: current attribution request.
- Granularity:
  - chart bars at effect level
  - detail modal references sector-level drivers
- Color semantics: chart bars use accent color for all effects; good/bad interpretation comes from signed value text in the details modal.
- Drill-down behavior:
  - `Details` button opens the methodology modal
  - modal lists each effect, its formula, and the largest sector driver

## 4.5 Holdings and stock review metrics

### Holdings sparkline and day change

- Meaning: quick watchlist-level price direction.
- Source: watchlist payload.
- Ownership: backend supplies values; frontend colors sparkline and delta badge.

### `ROIC - WACC`, `DCF Upside`, `Expected vs Market`, `Volatility`

- Meaning: per-holding comparison diagnostics used in holdings table and stock modal context.
- Source: portfolio-side corporate comparison response.
- Ownership:
  - backend owns metric calculation
  - frontend maps values by ticker and formats them
- Filters/time windows: current comparison mode and selected benchmark/universe.
- Color semantics:
  - positive spreads/upside values use positive tone
  - negative values use down tone
  - absolute values above `500` or invalid numbers render `N/A`
- Drill-down: open stock modal and snapshot-history tables.

## 4.6 Portfolio allocation workspace

### Draft total

- Meaning: sum of current unsaved allocation drafts.
- Source: frontend draft state.
- Ownership: frontend only.
- Filter/time window: current editing session.
- Color semantics: warning banner appears when draft total exceeds `100%`.

### Projected net value

- Meaning: projected exit value across current allocation rows after fee handling.
- Source: frontend allocation summary derived from current DCF upside metrics and investment amount.
- Ownership: frontend projection using backend-owned DCF upside inputs.

### Transaction fee reserve

- Meaning: retained fee amount based on current total investment and fee settings.
- Source: frontend allocation summary state.

### Final Profit

- Meaning: current DCF-upside-based exit profit estimate after subtracting transaction fee.
- Source: frontend row-level projection.
- Ownership: presentation/workspace-only frontend metric; not canonical valuation methodology.
- Important note: this is a scenario-planning convenience metric, not the canonical backend DCF definition.

## 5. Corporate Analysis Metrics And Charts

## 5.1 KPI cards

### `ROIC - WACC`

- Meaning: value-creation spread between operating return and capital hurdle.
- Formula/source: backend metrics plus frontend-derived display from active assumptions.
- Ownership: financial meaning is backend/engine-owned.
- Filters/time windows: active ticker and current assumption state.
- Color semantics: positive spread is favorable; negative spread is unfavorable.
- Drill-down: opens calculation-detail modal.

### `Bottom-up Ke`

- Meaning: cost of equity estimate after beta and risk-premium decomposition.
- Source: derived from active assumptions and corporate methodology.
- Ownership: finance meaning is backend/engine-owned even when shown immediately in frontend.
- Drill-down: calculation-detail modal.

### `Levered Beta`

- Meaning: equity beta after leverage adjustment.
- Source: derived from unlevered beta and debt ratio.
- Ownership: quant-engine methodology.
- Drill-down: calculation-detail modal.

### `Success Probability`

- Meaning: scenario-style score summarizing whether spread, growth, and penalties imply a favorable setup.
- Source: current Corporate page derives and labels this score.
- Ownership:
  - frontend currently computes the displayed score and associated chart copy
  - the score is a UI-level decision-support metric, not part of canonical `core_finance`
- Important note: because this remains primarily UI-defined today, this document is the canonical specification until the logic is moved to a shared backend/service layer.
- Drill-down: calculation-detail modal.

## 5.2 Diagnostic graph modules

### Company Status Graph

- Meaning: radar-style operating and health profile for the active company.
- Source: active derived assumptions and/or radar endpoint in workbench flows.
- Ownership: frontend graph presentation over backend/derived metric inputs.
- Drill-down: title opens calculation-detail modal; detail page workbench can refresh standalone radar data.

### Hurdle Rate Decomposition

- Meaning: component view of hurdle rate inputs such as risk-free rate, ERP, beta, and country premium.
- Source: corporate derived metrics and backend methodology.
- Ownership: backend/engine meaning, frontend chart layout.
- Drill-down: calculation-detail modal.

### Beta + WACC Curve

- Meaning: leverage sensitivity of beta and WACC across debt-ratio shifts.
- Source: active assumptions.
- Ownership: quant meaning comes from beta/WACC methodology; frontend renders the curve.

### Value Driver Matrix

- Meaning: quadrant-style placement of the company based on growth and value-creation signals.
- Source: active derived inputs.
- Ownership: frontend chart composition over backend/engine-owned metrics.

### Risk-Return Minard

- Meaning: visual placement of spread and success probability in risk-return space.
- Source: derived values on the page.
- Ownership: hybrid, with `Success Probability` still UI-defined.

### DCF Core Modules

- Meaning: breakdown of sustainable growth, terminal value share, FCFF, and backend fair-value context.
- Source: backend DCF result plus active assumptions.
- Ownership: backend DCF methodology; frontend graph composition.

## 5.3 Backend DCF summary and reports

### Backend Fair Value

- Meaning: point estimate from backend DCF request.
- Source: `/api/v1/corporate/dcf/{ticker}`.
- Ownership: backend.
- Drill-down: opens the detailed DCF modal and can request full report.

### Batch DCF Reports

- Meaning: full backend DCF reports for every non-benchmark stock in the current comparison universe.
- Source: `/api/v1/corporate/dcf/reports/bulk`.
- Ownership: backend.
- Filters/time windows: currently visible comparison universe only.
- Granularity: one report row per non-benchmark ticker.
- Drill-down: ticker click resets the active analysis ticker.

## 5.4 Target Stock Comparison

### Comparison metadata

- Meaning:
  - `risk_free_rate`: comparison assumption baseline
  - `equity_risk_premium`: market compensation assumption
  - `stock_expected_return_method`: how stock expected return is produced
  - `comparison_reference_return_method`: how market/reference return is defined
  - benchmark, universe, and custom tickers: scope of the live peer set
- Ownership: backend.
- Filters/time windows:
  - live only
  - benchmark
  - universe selection
  - optional custom tickers
  - sort key and direction are frontend-only presentation filters

### Similar Stocks Spread View

- Meaning: compare selected ticker against same-sector peers or, if sector coverage is too thin, against the full active comparison universe.
- Source: frontend-selected subset of live comparison rows.
- Ownership:
  - backend owns row metrics
  - frontend owns peer selection and fallback rule
- Granularity: one bar each for `ROIC - WACC` and expected-return spread per peer.
- Color semantics:
  - selected ticker highlighted with stronger teal/blue
  - peers shown in lighter fills
- Drill-down: selecting a ticker in the comparison table updates the comparison focus.

### Price Vs Fair Value Map

- Meaning: compare current market price against DCF value, with bubble size scaled by expected-return spread.
- Source: live comparison rows.
- Ownership:
  - backend owns price, DCF value, and spread
  - frontend computes bubble size for visual salience
- Granularity: one bubble per comparison row.
- Drill-down: selection follows the chosen ticker; no separate modal.

### Comparison table metrics

- `Weight`
  - Meaning: comparison weight carried in the response row; benchmark rows may carry benchmark-specific context.
- `ROIC - WACC`
  - Meaning: value-creation spread.
- `DCF Value`
  - Meaning: backend fair-value estimate.
- `Current Price`
  - Meaning: live or cached current price when available, else `N/A`.
- `DCF Return`
  - Meaning: DCF-implied return from price to fair value.
- `CAPM Return`
  - Meaning: CAPM-based equity return estimate.
- `Market Return`
  - Meaning: reference market expected return used for spread comparison.
- `Spread`
  - Meaning: stock expected return minus market/reference return.

For all rows:

- ownership: backend owns calculation
- filters: live comparison scope and frontend sort options
- color semantics:
  - positive `ROIC - WACC` and `Spread` use positive styling
  - negative values use down styling
  - selected active ticker row gets a muted background highlight
- drill-down: clicking a non-benchmark ticker switches the main page ticker

## 6. Simulation Lab Metrics And Charts

## 6.1 Shared path-simulation outputs

The following tabs all reuse one shared path result:

- `Path Simulation`
- `Risk Analysis`
- `Return Distribution`

This shared-result rule is canonical for the current frontend implementation.

### Median terminal value

- Meaning: `P50` terminal portfolio value across simulated paths.
- Source: shared worker output.
- Ownership: worker/model logic.
- Filters/time windows: current path input and horizon.
- Granularity: one result per completed path run.

### Percentile ranges

- Meaning: visible uncertainty bands such as `5%-95%`, `10%-90%`, and `25%-75%`.
- Source: path summary percentiles.
- Ownership: worker/model logic; frontend organizes them into charts and cards.

## 6.2 Risk Analysis

### `VaR 95%` and `VaR 99%`

- Meaning: loss threshold not exceeded with 95% or 99% confidence under the simulated terminal distribution.
- Source: `sharedSimulation.raw.risk_metrics`.
- Ownership: worker-side risk calculation.
- Filters/time windows: shared path simulation only.
- Granularity: one loss metric per completed run.
- Color semantics:
  - risk-distribution histogram colors loss buckets red and gain buckets green
  - VaR 95 marker amber
  - VaR 99 marker orange

### `CVaR 95%`

- Meaning: expected loss conditional on losses worse than VaR 95.
- Source: shared path risk metrics.
- Color semantics: black dashed marker in the risk-distribution chart.

### `Maximum drawdown`

- Meaning: largest peak-to-trough decline of the median path.
- Ownership: frontend derives this from shared path summary points, but it remains a display summary of worker output rather than a backend-owned finance primitive.

### `Sortino ratio`, `Skewness`, summary table moments

- Meaning: downside-adjusted return quality plus distribution shape.
- Source: shared risk metrics.

### `VaR / CVaR Risk Distribution`

- Meaning: histogram of terminal-return outcomes with loss-side thresholds marked.
- Granularity: histogram bucket level.
- Drill-down: no modal; table below provides exact summary values.

### `Terminal Value Percentiles`

- Meaning: P5, P10, P25, P50, P75, P90, and P95 terminal outcomes.
- Source: terminal percentile values from shared path result.
- Granularity: percentile-bar level.
- Color semantics: lower percentiles use red/orange tones, median dark neutral, upper percentiles teal/green.

## 6.3 Return Distribution

### `Mean return`, `Std. deviation`, `Kurtosis`, `Maximum return`, `Minimum return`

- Meaning: terminal return moments and extremes from the shared simulation output.
- Source: worker risk metrics.

### `Return Histogram with Fitted Normal Curve`

- Meaning: compare simulated terminal-return frequency with a normal fit.
- Ownership:
  - worker owns histogram and normal-fit data
  - frontend overlays them in a composed chart
- Color semantics:
  - red bars for loss buckets
  - green bars for gain buckets
  - black line for fitted normal

### `CDF Comparison`

- Meaning: compare simulated cumulative probability against the fitted normal CDF.
- Ownership: worker data, frontend line rendering.
- Color semantics:
  - teal line for simulated CDF
  - dashed black line for normal CDF

## 6.4 Corporate Valuation

### `Median Fair Value`

- Meaning: 50th percentile fair value across valuation simulations.

### `Undervaluation Probability`

- Meaning: probability that simulated fair value is above the current market price.

### `Upside Potential`

- Meaning: median fair value relative to current stock price.

### `80% Confidence Interval`

- Meaning: P10 to P90 fair value range.

For all four:

- source: valuation worker output
- ownership: frontend worker valuation engine
- filters: current valuation input set, including current price, EPS, growth uncertainty, discount-rate uncertainty, terminal growth, forecast period, PER uncertainty, and simulation count

### `Fair Value Distribution`

- Meaning: histogram of simulated single-stock fair values.
- Source: `valuation_distribution`.
- Color semantics:
  - green bars for distribution
  - black reference line for current price
- Drill-down: no modal; exact percentile values appear in `Valuation Statistics`.

### `Valuation Statistics`

- Meaning: current price, mean, standard deviation, P05/P10/P25/median/P75/P90/P95, undervaluation probability, and z-score for the simulated distribution.
- Source: worker summary table.

## 6.5 Correlation Model

### `Optimal Portfolio Mu`

- Meaning: annual expected return of the highest-Sharpe sampled portfolio.

### `Portfolio Sigma`

- Meaning: realized volatility of that optimal portfolio after correlation is applied.

### `Diversification Effect`

- Meaning: reduction versus the simple average of stand-alone asset volatilities.

### `Optimal Sharpe`

- Meaning: highest Sharpe ratio among sampled portfolios.

For all four:

- source: correlation worker output
- ownership: worker model
- filters: current asset list, expected returns, volatilities, correlation matrix, and simulation count

### `Efficient Frontier`

- Meaning: scatter of sampled portfolios in risk-return space.
- Source: `efficient_frontier`.
- Granularity: one point per sampled portfolio.
- Color semantics:
  - sampled portfolios use purple
  - highest-Sharpe portfolio uses bright green

### `Spearman rho Sensitivity`

- Meaning: rank correlation of each asset return with portfolio returns.
- Granularity: one bar per asset.
- Color semantics:
  - positive exposures shown in green
  - negative exposures shown in red
  - opacity increases with magnitude

### `Correlation Coefficient Heatmap`

- Meaning: full pairwise correlation matrix for the current setup.
- Granularity: matrix cell.
- Color semantics:
  - diagonal cells solid green
  - positive off-diagonal cells green with strength-based opacity
  - negative cells red with strength-based opacity

## 7. Reports, News, Diagnostics, And Logs

## 7.1 Report summary and export metrics

Report summary and export should be read as a delivery format for backend portfolio analytics, not as a separate analytic engine.

Canonical rules:

- report payload metrics inherit attribution semantics from `Portfolio Command Center`
- markdown/HTML/JSON export does not introduce alternate formulas
- frontend export controls should never silently drift from backend report payload fields

## 7.2 News metrics and article semantics

News items are article records, not KPIs.

The important semantics are:

- ticker association may be explicit or inferred by crawl path
- persistence lives in SQLite news storage
- live crawl endpoints append or refresh article inventory
- article sentiment and importance support interpretation, but they are not first-class valuation outputs

## 7.3 Diagnostics and log visibility

### Corporate Diagnostics workbench

- Meaning: on-demand radar and tornado views for the selected ticker.
- Source: `/api/v1/corporate/diagnostic/{ticker}/radar` and `/tornado`.
- Ownership: backend owns diagnostic datasets; frontend manages idle state, refresh button, and session cache.
- Filters/time windows: selected ticker only; data is considered slow-moving and uses long staleness windows.
- Drill-down: none beyond the charts themselves.

### DCF Diagnostics workbench

- Meaning: explicit user-triggered DCF recomputation for a local assumption set.
- Source: `/api/v1/corporate/dcf/{ticker}` with workbench request body.
- Ownership: backend DCF engine; frontend owns stale-calculation warning and slider state.
- Important note: this workbench is intentionally idle on first load and must be explicitly refreshed.

### API log tail

- Meaning: recent plain-text tail of the persistent API server log for local debugging.
- Source: `GET /api/v1/diagnostic/logs/api-tail`.
- Ownership: backend logging pipeline.
- Filters/time windows: last `N` lines requested.
- Granularity: line-level log records.
- Drill-down: none in current UI; this is a visibility/debugging surface rather than a business chart.

## 8. Cross-Reference Notes

This document should be the canonical metric-semantics layer. The existing tab docs remain useful as user-facing workflow summaries:

- `docs/portfolio-tab.md` explains the Portfolio page from a workflow perspective
- `docs/corporate-analysis-tab.md` explains the Corporate page from a workflow perspective
- `docs/monte-carlo-tab.md` explains the Simulation Lab from a workflow perspective

If any future tooltip, modal, or chart title adds new metric meaning, update this document first or in the same change.
