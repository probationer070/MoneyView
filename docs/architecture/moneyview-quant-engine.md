# MoneyView Quant Engine

This document is the formal specification for the reusable finance computation layer in `packages/core_finance`. It defines the role of the engine, the module boundaries, the implemented formulas, the expected units and conventions, the validation behavior visible from code, and the known limitations of the current implementation.

## 1. Engine Role

### 1.1 Canonical Role

`packages/core_finance` is the reusable, framework-independent finance layer for MoneyView. It is the canonical home for:

- DCF primitives
- hurdle-rate and WACC helpers
- beta transformations
- expected-return helpers
- general-purpose risk-analysis utilities

The engine is designed to be:

- stateless
- deterministic for fixed inputs
- independent of FastAPI, SQLite, and frontend code
- reusable by backend services and tests

### 1.2 What The Engine Does Not Own

The engine does not own:

- HTTP transport
- SQLite access
- route-level orchestration
- Yahoo/provider fetching
- chart formatting
- page-level UI logic

Some finance-related calculations still exist in backend route/service code for product-specific workflows. That is an orchestration and application-design choice, not a transfer of engine ownership to the frontend.

### 1.3 Current Module Map

- `dcf.py`
  FCFF, sustainable growth, terminal value, NPV, and multi-stage DCF aggregation
- `hurdle_rate.py`
  country risk premium, hurdle-rate decomposition, WACC, and WACC sensitivity
- `risk_analysis.py`
  payback period, one-variable-at-a-time sensitivity analysis, Monte Carlo NPV sampling
- `beta.py`
  unlevering, relevering, and bottom-up beta estimation
- `expected_return.py`
  market expected return, CAPM expected return, DCF-implied return, expected-return spread

## 2. Design Principles And Conventions

### 2.1 Design Principles

- Functions operate only on explicit inputs.
- There is no internal caching or hidden state.
- Outputs are plain Python values, dataclasses, lists, or dictionaries.
- NumPy is used where it improves clarity or performance.
- The engine favors simple, inspectable formulas over opaque abstractions.

### 2.2 Units And Representation

The core convention in `packages/core_finance` is:

- rates are decimal values
  example: `0.08` means 8%
- time is annual unless stated otherwise
- cash-flow vectors are ordered by year starting at year 1
- outputs generally remain in the same unit family as the inputs

Important note:

- Backend product payloads sometimes convert rates into percentage points for UI-facing responses.
- The engine itself generally expects and returns decimal rates.

### 2.3 Precision And Rounding

The engine uses floating-point arithmetic. Rounding behavior differs by function:

- low-level helpers such as `calculate_fcff`, `calculate_growth_rate`, and `calculate_npv` return raw floats
- some summary helpers such as `multi_stage_dcf`, `decompose_hurdle_rate`, and `calculate_wacc` round selected outputs for presentation-friendly stability
- risk-analysis helpers generally round their summary payload fields

This means callers should not assume every engine function is either fully raw or fully rounded. The rounding policy is function-specific.

### 2.4 Deterministic Vs Stochastic Behavior

- deterministic functions:
  `dcf.py`, `hurdle_rate.py`, `beta.py`, `expected_return.py`, `payback_period`, `sensitivity_analysis`
- stochastic function:
  `risk_analysis.monte_carlo_npv`

`monte_carlo_npv` becomes reproducible when a `seed` is provided.

## 3. Module Specifications

## 3.1 `dcf.py`

This module contains the reusable building blocks for discounted cash flow valuation.

### Free Cash Flow To Firm

Function:
- `calculate_fcff(ebit, tax_rate, depreciation, capex, delta_nwc) -> float`

Equation:
- `FCFF = EBIT * (1 - tax_rate) + depreciation - capex - delta_nwc`

Variables:
- `ebit`
  earnings before interest and taxes
- `tax_rate`
  operating tax rate as a decimal
- `depreciation`
  non-cash depreciation/amortization add-back
- `capex`
  capital expenditures
- `delta_nwc`
  change in net working capital

Interpretation:
- positive `delta_nwc` consumes cash and reduces FCFF
- negative `delta_nwc` represents a working-capital release and increases FCFF

Edge cases:
- `tax_rate = 1.0` drives after-tax EBIT to zero
- negative `delta_nwc` increases FCFF
- no explicit validation is enforced in code for unrealistic tax rates or negative depreciation

Test coverage:
- covered in `tests/core_finance/test_dcf.py`

### Sustainable Growth Rate

Function:
- `calculate_growth_rate(reinvestment_rate, roic) -> float`

Equation:
- `g = reinvestment_rate * roic`

Variables:
- `reinvestment_rate`
  fraction of operating return reinvested back into the business
- `roic`
  return on invested capital as a decimal

Interpretation:
- this is the standard sustainable-growth shortcut used in fundamental valuation
- growth can be positive even when value creation is poor
- value creation depends on comparing ROIC to WACC, not just on growth being positive

Edge cases:
- zero ROIC produces zero growth
- positive growth with ROIC below WACC can still destroy value economically

Test coverage:
- covered in `tests/core_finance/test_dcf.py`

### Terminal Value

Function:
- `calculate_terminal_value(terminal_cf, wacc, growth_rate) -> float`

Equation:
- `TV = terminal_cf / (wacc - growth_rate)`

Variables:
- `terminal_cf`
  terminal-period cash flow used as the Gordon-growth numerator
- `wacc`
  weighted average cost of capital as a decimal
- `growth_rate`
  perpetual terminal growth rate as a decimal

Interpretation:
- this is a Gordon-growth perpetuity model
- small changes in `wacc` or `growth_rate` can create very large valuation swings

Validation and failure conditions:
- raises `ValueError` if `wacc <= growth_rate`

Edge cases:
- zero growth is valid
- growth equal to or above WACC is explicitly rejected

Test coverage:
- covered in `tests/core_finance/test_dcf.py`

### Net Present Value

Function:
- `calculate_npv(cash_flows, discount_rate) -> float`

Equation:
- `NPV = sum(CF_t / (1 + r)^t)` for `t = 1..n`

Variables:
- `cash_flows`
  list of period cash flows beginning at year 1
- `discount_rate`
  annual discount rate as a decimal

Interpretation:
- the function discounts each cash flow from period 1 onward
- there is no explicit period 0 term in this helper

Validation and edge cases:
- empty cash-flow list returns `0.0`
- code does not explicitly reject `discount_rate <= -1`
- very large negative discount rates could produce unstable or non-economic outputs

Test coverage:
- covered in `tests/core_finance/test_dcf.py`

### Multi-Stage DCF Aggregation

Function:
- `multi_stage_dcf(explicit_fcff, terminal_cf, wacc, terminal_growth) -> dict`

Method:
1. discount explicit forecast FCFF with `calculate_npv`
2. compute terminal value with `calculate_terminal_value`
3. discount the terminal value by the explicit-stage horizon
4. sum explicit PV and terminal PV into enterprise value
5. compute terminal-value share of enterprise value

Output fields:
- `pv_explicit`
- `pv_terminal`
- `enterprise_value`
- `terminal_value`
- `tv_share_pct`

Interpretation:
- `tv_share_pct` shows how much of total enterprise value comes from the terminal component
- high terminal-value share means the valuation is especially assumption-sensitive

Validation behavior:
- inherits terminal-growth validation from `calculate_terminal_value`
- no separate validation for empty explicit cash-flow vectors

### DCF Theory Notes

- DCF is only as stable as the cash-flow, WACC, and terminal assumptions behind it
- perpetual growth should be interpreted conservatively
- terminal-value dominance should be treated as an analytical warning sign, not just a number

## 3.2 `hurdle_rate.py`

This module covers cost-of-capital decomposition and leverage-aware discount-rate construction.

### Country Risk Premium

Function:
- `calculate_crp(default_spread, equity_vol, bond_vol) -> float`

Equation:
- `CRP = default_spread * (equity_vol / bond_vol)`

Variables:
- `default_spread`
  sovereign/default spread as a decimal
- `equity_vol`
  annualized equity-market volatility
- `bond_vol`
  annualized bond-market volatility

Interpretation:
- this scales default spread by relative equity-to-bond volatility
- it is a simple Damodaran-style country-risk premium adjustment

Validation and edge cases:
- if `bond_vol == 0`, the function falls back to `default_spread`
- no error is raised for zero bond volatility

### Hurdle Rate Decomposition

Function:
- `decompose_hurdle_rate(risk_free_rate, beta, erp, crp=0.0) -> HurdleRateComponents`

Equation:
- `hurdle_rate = risk_free_rate + beta * erp + crp`

Variables:
- `risk_free_rate`
  risk-free rate as a decimal
- `beta`
  systematic-risk loading
- `erp`
  equity risk premium as a decimal
- `crp`
  country risk premium as a decimal

Output dataclass:
- `risk_free_rate`
- `equity_premium`
- `country_premium`
- `beta`
- `hurdle_rate`

Interpretation:
- this is effectively a CAPM-style cost of equity with an extra country-risk term
- it is used as a hurdle-rate building block rather than a standalone enterprise valuation

### Weighted Average Cost Of Capital

Function:
- `calculate_wacc(cost_of_equity, cost_of_debt, tax_rate, equity_value, debt_value) -> WACCComponents`

Equation:
- `WACC = (E / V) * cost_of_equity + (D / V) * cost_of_debt * (1 - tax_rate)`
- where `V = E + D`

Variables:
- `cost_of_equity`
  cost of equity as a decimal
- `cost_of_debt`
  pre-tax cost of debt as a decimal
- `tax_rate`
  marginal tax rate as a decimal
- `equity_value`
  market value of equity
- `debt_value`
  market value of debt

Output dataclass:
- `cost_of_equity`
- `cost_of_debt`
- `tax_rate`
- `equity_weight`
- `debt_weight`
- `wacc`

Validation and failure conditions:
- raises `ValueError` when `equity_value + debt_value == 0`

Edge cases:
- if `debt_value == 0`, debt weight becomes zero and WACC collapses to cost of equity
- if `equity_value == 0` and debt is positive, the formula still computes, but the result is not a standard equity-valuation capital structure

### WACC Sensitivity

Function:
- `wacc_sensitivity(cost_of_equity, cost_of_debt, tax_rate, equity_value, de_ratios=None) -> list[dict]`

Method:
- simulates WACC across a range of debt-to-equity ratios
- default range is `0.0` to `2.0` in `0.1` increments

Output fields per row:
- `de_ratio`
- `debt_weight`
- `equity_weight`
- `wacc`

Interpretation:
- this is used to construct U-curve style capital-structure analysis
- it is a sensitivity helper, not a capital-structure optimizer

### Hurdle-Rate Theory Notes

- WACC should use market-value weights, not book-value weights
- leverage can reduce WACC through tax shields, but excessive leverage can also change the real cost inputs outside this simplified helper
- the module does not model dynamic credit spread changes as leverage rises

## 3.3 `beta.py`

This module implements Hamada-equation leverage transforms and bottom-up beta estimation.

### Unlever Beta

Function:
- `unlever_beta(levered_beta, tax_rate, de_ratio) -> float`

Equation:
- `beta_u = levered_beta / (1 + (1 - tax_rate) * de_ratio)`

Variables:
- `levered_beta`
  observed equity beta
- `tax_rate`
  marginal tax rate
- `de_ratio`
  debt-to-equity ratio

Interpretation:
- removes the financial-leverage effect from observed equity beta
- isolates business-risk beta under the Hamada framework

Edge cases:
- `de_ratio = 0` leaves beta unchanged
- `tax_rate = 1` makes the denominator equal to `1`
- no validation prevents negative debt ratios or extreme values

Test coverage:
- covered in `tests/core_finance/test_beta.py`

### Relever Beta

Function:
- `relever_beta(unlevered_beta, tax_rate, de_ratio) -> float`

Equation:
- `beta_l = unlevered_beta * (1 + (1 - tax_rate) * de_ratio)`

Interpretation:
- reapplies leverage to a business-risk beta using the target firm's capital structure

Edge cases:
- `de_ratio = 0` leaves beta unchanged
- unlever/relever round-trip behavior is expected for the same tax and D/E inputs

Test coverage:
- covered in `tests/core_finance/test_beta.py`

### Bottom-Up Beta

Function:
- `bottom_up_beta(peers, target_tax_rate, target_de_ratio) -> float`

Method:
1. unlever each peer beta using each peer's own tax rate and D/E ratio
2. average the unlevered peer betas
3. relever the average using the target firm's tax rate and D/E ratio

Expected peer payload:
- each peer is a `dict` with:
  `levered_beta`
  `tax_rate`
  `de_ratio`

Interpretation:
- bottom-up beta reduces firm-specific noise by aggregating comparable-company business risk
- it is especially useful when the target firm's own observed beta is unstable

Validation and failure conditions:
- raises `ValueError` if `peers` is empty

Test coverage:
- covered in `tests/core_finance/test_beta.py`

### Beta Theory Notes

- beta is a systematic-risk measure, not total risk
- bottom-up beta is often more stable than direct regression beta for illiquid or event-distorted names
- the current module does not implement rolling regression or empirical regression beta estimation

## 3.4 `expected_return.py`

This module contains simple helpers for comparing stock-level and market-level expected returns.

### Market Expected Return

Function:
- `calculate_market_expected_return(risk_free_rate, equity_risk_premium) -> float`

Equation:
- `market_expected_return = risk_free_rate + equity_risk_premium`

Interpretation:
- additive implied market return
- used as a baseline comparison return in corporate-comparison workflows

Test coverage:
- covered in `tests/core_finance/test_expected_return.py`

### CAPM Expected Return

Function:
- `calculate_capm_expected_return(risk_free_rate, equity_risk_premium, beta) -> float`

Equation:
- `capm_expected_return = risk_free_rate + beta * equity_risk_premium`

Interpretation:
- CAPM-style stock expected return using beta-scaled market risk premium

Test coverage:
- covered in `tests/core_finance/test_expected_return.py`

### DCF-Implied Return

Function:
- `calculate_dcf_implied_return(current_price, intrinsic_value) -> float`

Equation:
- `dcf_implied_return = (intrinsic_value / current_price) - 1`

Interpretation:
- the implied upside or downside from intrinsic value relative to current market price

Edge cases:
- returns `0.0` if `current_price <= 0`
- this is a practical guardrail in code, not a theoretical finance identity

Test coverage:
- covered in `tests/core_finance/test_expected_return.py`

### Expected Return Spread

Function:
- `calculate_expected_return_spread(stock_expected_return, market_expected_return) -> float`

Equation:
- `spread = stock_expected_return - market_expected_return`

Interpretation:
- active expected-return spread relative to the market baseline

Test coverage:
- covered in `tests/core_finance/test_expected_return.py`

### Expected-Return Theory Notes

- these helpers are intentionally simple and composable
- they do not estimate alpha, multi-factor expected return, or time-varying risk premia
- they are best understood as comparison utilities inside MoneyView workflows

## 3.5 `risk_analysis.py`

This module contains reusable risk-analysis helpers for payback, tornado-style sensitivity work, and Monte Carlo NPV distributions.

### Payback Period

Function:
- `payback_period(cash_flows, discount_rate=0.0, initial_cost=0.0) -> Optional[float]`

Method:
- starts cumulative value at `-abs(initial_cost)`
- adds each annual cash flow
- discounts each cash flow if `discount_rate > 0`
- returns the interpolated year in which cumulative value crosses zero

Interpretation:
- simple payback when `discount_rate == 0`
- discounted payback when `discount_rate > 0`

Edge cases:
- returns `None` if the cost is never recovered
- if a recovery period is found, interpolation is linear within the year
- there is no separate validation for empty cash-flow vectors

Limitations:
- ignores value after payback
- can mislead when back-ended cash flows dominate economics

### Sensitivity Analysis

Function:
- `sensitivity_analysis(base_npv, variables, npv_function, base_inputs) -> list[dict]`

Methodology:
- one-variable-at-a-time sensitivity analysis
- for each variable, evaluate a low case and a high case while keeping other inputs fixed
- compute `swing = abs(high_npv - low_npv)`
- sort descending by swing

Expected `variables` payload:
- `dict[str, tuple[low_value, high_value]]`

Output fields:
- `variable`
- `base_npv`
- `low_npv`
- `high_npv`
- `swing`

Interpretation:
- produces tornado-chart style impact ranking
- measures isolated sensitivity, not scenario interaction

Limitations:
- assumes variable independence
- does not capture covariance or nonlinear multi-variable interaction

### Monte Carlo NPV

Function:
- `monte_carlo_npv(base_inputs, variable_ranges, npv_function, n_simulations=1000, seed=None) -> dict`

Expected `variable_ranges` payload:
- `dict[str, tuple[mean, std, distribution]]`
- supported distributions:
  `normal`
  `uniform`
  `triangular`

Method:
1. initialize a NumPy random generator, optionally with a seed
2. copy `base_inputs` for each simulation
3. sample each variable according to the requested distribution
4. call `npv_function(**sampled)`
5. if the user-supplied function raises, record `0.0` for that simulation
6. summarize the resulting distribution and build a 20-bin histogram

Output fields:
- `n_simulations`
- `mean_npv`
- `p5`
- `p50`
- `p95`
- `prob_positive`
- `computed_by`
- `histogram`

Interpretation:
- `p5`, `p50`, and `p95` are empirical percentiles of the simulated NPV distribution
- `prob_positive` is the simulated frequency of `NPV > 0`, expressed as a percentage
- histogram bins are summary buckets, not a parametric density estimate

Reproducibility:
- deterministic given the same seed and the same `npv_function`

Edge cases and current behavior:
- unsupported distribution labels fall back to the variable mean
- if `npv_function` raises during one simulation, that run is recorded as `0.0` rather than propagating the exception
- `computed_by` is currently always `"numpy"`

Performance notes:
- current implementation is a Python loop with NumPy sampling, not a fully vectorized valuation kernel
- appropriate for local exploratory simulation sizes
- not a compiled or distributed simulation engine

### Risk-Analysis Theory Notes

- payback is a liquidity/recapture metric, not a full valuation metric
- tornado sensitivity is useful for ranking driver importance, not for scenario realism
- Monte Carlo simulation is only as realistic as the distributional assumptions and the supplied `npv_function`
- the current helper assumes static distributions and independent sampling unless the caller encodes dependencies manually

## 4. Validation And Error Behavior

The engine currently shows three different validation styles:

### 4.1 Explicit Exceptions

Functions that explicitly reject invalid states:

- `calculate_terminal_value`
  raises when `wacc <= growth_rate`
- `calculate_wacc`
  raises when `equity_value + debt_value == 0`
- `bottom_up_beta`
  raises when `peers` is empty

### 4.2 Guardrail Defaults

Functions that choose a safe fallback instead of raising:

- `calculate_crp`
  returns `default_spread` if `bond_vol == 0`
- `calculate_dcf_implied_return`
  returns `0.0` if `current_price <= 0`
- `calculate_npv`
  returns `0.0` for empty cash-flow lists

### 4.3 Tolerant Simulation Handling

`monte_carlo_npv` is intentionally tolerant:

- unsupported distribution strings revert to the supplied mean
- exceptions from the caller-provided `npv_function` are swallowed for that run and recorded as `0.0`

This is practical for exploratory simulation, but it also means simulation summaries can hide bad user-supplied functions unless the caller validates inputs upstream.

## 5. Test Coverage Status

Current direct engine test coverage in `tests/core_finance/` includes:

- `test_dcf.py`
- `test_beta.py`
- `test_expected_return.py`

These tests cover:

- DCF helper behavior
- beta transforms and bottom-up beta
- expected-return helper behavior

Current gap:

- there is no dedicated `tests/core_finance` file yet for `hurdle_rate.py`
- there is no dedicated `tests/core_finance` file yet for `risk_analysis.py`

That gap should be treated as a documentation and verification note, not as proof that the functions are incorrect.

## 6. Known Limitations

### 6.1 Finance-Model Limits

- no multi-factor expected-return model
- no rolling regression beta estimation
- no explicit cost-of-debt curve modeling
- no dynamic capital-structure optimization
- no path-dependent Monte Carlo modeling
- no scenario-regime switching
- no derivatives or options pricing

### 6.2 Numerical And Contract Limits

- many functions trust caller-supplied units and do not normalize percentage-vs-decimal mistakes
- some helpers raise on invalid states while others silently clamp or default
- Monte Carlo sampling is exploratory and does not encode correlated sampling by default

### 6.3 System-Boundary Limits

- the engine does not fetch data or own persistence
- some product-specific finance logic still exists in backend route/service code for end-user workflows
- frontend simulation code may duplicate selected methodology for responsiveness, but the reusable finance-spec layer remains Python-first
