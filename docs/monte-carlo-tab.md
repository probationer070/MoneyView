# Monte Carlo Tab

The Monte Carlo tab is the simulation workspace at `http://localhost:3000/monte-carlo`.

## What It Shows

The page is labeled `Simulation Lab` and is split into five sub-tabs:

- `Path Simulation`
- `Risk Analysis`
- `Return Distribution`
- `Corporate Valuation`
- `Correlation Model`

The page uses a shared browser worker for long-running simulations so the UI stays responsive.

## 1. Path Simulation

This is the primary simulation entry point for portfolio-path analysis.

Inputs:

- `Initial investment`
- `Expected annual return`
- `Annual volatility (sigma)`
- `Investment horizon`
- `Number of simulations`
- `Execution mode`
  `Interactive` or `Large Summary`
- `Jump probability`
- `Jump intensity`
- `Risk-free rate`

Actions:

- `Run Path Simulation`
- `Cancel`

Outputs:

- worker progress bar
- export buttons for:
  `summary.csv`
  `percentile_cone.csv`
  `sample_paths.csv`
  `terminal_distribution.csv`
- KPI cards for:
  median terminal value
  expected return
  loss probability
  Sharpe ratio
- percentile range indicators for:
  `5%-95%`
  `10%-90%`
  `25%-75%`
  median
- `GBM + Jump-Diffusion Simulated Paths` chart
- `Percentile Cone` chart
- `Simulation Setup` summary panel

Model behavior:

- uses a browser-side Monte Carlo engine
- path dynamics use geometric Brownian motion with jump shocks
- if the requested run is large, execution can be promoted to summary mode automatically

## 2. Risk Analysis

This tab reuses the same shared simulation result produced by `Path Simulation`. It does not run a separate engine.

It shows:

- `VaR 95%`
- `VaR 99%`
- `CVaR 95%`
- `Maximum drawdown`
- `Sortino ratio`
- `Skewness`

Visuals:

- `VaR / CVaR Risk Distribution`
  Histogram with principal, VaR 95, VaR 99, and CVaR 95 markers
- `Terminal Value Percentiles`
  Bar chart of P5, P10, P25, P50, P75, P90, and P95 terminal outcomes
- `Statistical Summary`
  Table of mean, median, standard deviation, Sharpe, Sortino, skewness, kurtosis, and tail-loss metrics

If no path simulation has been run yet, the tab shows a prompt telling the user to run `Path Simulation` first.

## 3. Return Distribution

This tab also reuses the shared result from `Path Simulation`.

It shows:

- `Mean return`
- `Std. deviation`
- `Kurtosis`
- `Maximum return`
- `Minimum return`

Visuals:

- `Return Histogram with Fitted Normal Curve`
  Simulated terminal return histogram with a fitted normal overlay
- `CDF Comparison`
  Simulated cumulative distribution versus fitted normal cumulative distribution

Purpose:

- inspect whether the simulated return distribution is symmetric or skewed
- compare simulated tails against a normal approximation

## 4. Corporate Valuation

This tab runs a separate worker-side valuation simulation. It does not depend on the `Path Simulation` result.

Inputs:

- `Ticker`
- `Current stock price`
- `Base EPS`
- `Average growth rate`
- `Growth uncertainty`
- `Discount rate (WACC)`
- `WACC uncertainty`
- `Terminal growth rate`
- `Forecast period`
- `Target PER uncertainty`
- `Simulation Count`

Actions:

- `Run Valuation`
- `Cancel`

Outputs:

- worker progress bar
- KPI cards for:
  median fair value
  undervaluation probability
  upside potential
  `80% Confidence Interval`
- `Fair Value Distribution` histogram
- `Valuation Statistics` table with:
  current price
  mean fair value
  standard deviation
  P05, P10, P25, median, P75, P90, P95
  undervaluation probability
  z-score

Model behavior:

- uses a worker-side EPS and PER Monte Carlo valuation engine
- varies growth, discount rate, and target PER uncertainty
- estimates a distribution of fair values rather than a single point estimate

## 5. Correlation Model

This tab runs a separate worker-side correlation simulation for a multi-asset setup.

Inputs:

- asset list with:
  asset name
  expected return (`mu`)
  volatility (`sigma`)
- editable correlation matrix (`rho`)
- `Number of Simulations`

Action:

- `Run Correlation Analysis`

Outputs:

- worker progress bar
- `Efficient Frontier`
  Scatter plot of random portfolios with the highest-Sharpe portfolio highlighted
- `Spearman rho Sensitivity`
  Rank-correlation sensitivity of each asset to portfolio returns
- `Correlation Coefficient Heatmap`
  Full matrix heatmap
- KPI cards for:
  optimal portfolio return
  portfolio volatility
  diversification effect
  optimal Sharpe

Model behavior:

- uses a worker-side portfolio correlation engine
- applies Cholesky decomposition to the input correlation matrix
- generates random portfolio weights to sample the frontier

## Data And Execution Model

The Monte Carlo tab is primarily frontend-compute, not backend-API driven.

- simulations run in `apps/web/app/monte-carlo/workers/simulation.worker.ts`
- path, risk, and return-distribution views share one path-simulation result
- valuation and correlation each run as separate worker jobs
- progress, cancellation, and results are managed at the page level

Core engines:

- `simulation-core.ts`
  Browser-side GBM + jump-diffusion engine for path, risk, and return distribution
- `valuation-core.ts`
  Worker-side EPS/PER valuation Monte Carlo engine
- `correlation-core.ts`
  Worker-side correlation and efficient-frontier engine

## Relationship To Other Tabs

- Use `Monte Carlo` for scenario analysis, distribution inspection, valuation uncertainty, and portfolio-correlation experiments
- Use `Corporate Analysis` for ticker-specific diagnostics, live assumption tuning, and DCF inspection
- Use `Portfolio` for saved holdings, attribution, implied cash, and snapshot workflows
