# MoneyView Quant Engine & Formulas

This document serves as the formal specification for the financial computation engine housed in `packages/core_finance`. It details the input/output contracts, design principles, mathematical logic, and system-wide usage of the models.

---

## 0. Engine Role & Design Principles

### 0.1 Engine Role in System
- The quant engine is the **single source of truth for all financial computations**.
- Backend services must delegate all financial logic to this engine.
- No duplication of financial methodology should exist outside this layer (except performance-oriented approximations in frontend workers).

### 0.2 Computation Model
- **Canonical Computation:** All financial models are definitively authored in `core_finance`.
- **Exploratory Execution:** Some simulations may run in frontend Web Workers for UI responsiveness.
- **Rule:** The Python engine defines the authoritative financial methodology. Any frontend duplication is an optimization, not a standard.

### 0.3 Design Principles
- **Pure Computation Layer:** No dependency on FastAPI, database states, or frontend code. Functions operate only on explicit arguments.
- **Deterministic Outputs:** Identical inputs strictly produce identical outputs (excepting stochastic simulations).
- **Vectorized Execution:** Relies heavily on NumPy for performance, precision, and scalability.
- **Stateless Design:** Contains zero internal state or caching mechanisms.

---

## 1. Units, Conventions & Stability

### 1.1 Units and Conventions
- **Rates as Decimals:** All percentage inputs are expressed as decimals (e.g., `0.08` = 8%). Mixing percentages (e.g., 8) and decimals is invalid.
- **Time/Frequency:** Cash flows and growth rates are assumed annual unless explicitly specified.
- **Currency:** Assumed consistent and unhedged across all inputs.
- **Time Index:** `t` universally represents full years.

### 1.2 Numerical Stability & Data Types
- **Precision:** Floating point precision errors may accumulate in long-horizon simulations. Discounting over extreme time periods may underflow small values.
- **Data Types:** Inputs must be finite floats (no NaN, no infinity). Lists must be non-empty where required.
- **Economic Logic:** Negative values are only allowed where economically meaningful (e.g., negative cash flows or margin).

---

## 2. Module Mapping & Dependencies

### 2.1 Module Mapping
- **`dcf.py`**: FCFF, Terminal Value, NPV, Growth Rates.
- **`hurdle_rate.py`**: CRP, Cost of Equity, WACC.
- **`risk_analysis.py`**: Payback, Sensitivity/Tornado, Monte Carlo.

### 2.2 Cross-Module Dependencies
- **DCF Valuation** depends structurally on:
  - `FCFF`
  - `WACC`
  - `Terminal Value`
- **Risk Analysis** depends structurally on:
  - `NPV` function
  - DCF inputs
- **Hurdle Rate** outputs feed into:
  - `WACC`
  - DCF discounting mechanics

---

## 3. Valuation & Discounted Cash Flow (`dcf.py`)

### Free Cash Flow to Firm (FCFF)
- **Equation:** `FCFF = EBIT(1 - t) + D&A - CapEx - ΔNWC`
- **Contract:**
  - **Inputs:** `ebit: float`, `tax_rate: float`, `depreciation: float`, `capex: float`, `delta_nwc: float`
  - **Output:** `fcff: float`
- **Usage:** Serves as the primary input for the DCF module and Corporate API routes.
- **Assumptions:** EBIT is normalized. Non-operating items are strictly excluded.
- **Limitations:** Does not adjust for IFRS16 leases, stock-based compensation, or extraordinary one-time events.

### Net Present Value (NPV)
- **Purpose:** Measures the value created by discounted future cash flows.
- **Equation:** `NPV = Σ (CF_t / (1 + WACC)^t)`
- **Contract:**
  - **Inputs:** `cash_flows: list[float]`, `discount_rate: float`
  - **Output:** `npv: float`
- **Usage:** Used extensively in DCF valuation, Sensitivity Analysis, and Monte Carlo scenarios.
- **Constraint:** Discount rate must be strictly greater than -1 (`discount_rate > -1.0`).
- **Limitation:** Assumes discrete annual discounting (not continuous).

### Sustainable Growth Rate
- **Equation:** `g = Reinvestment Rate × ROIC`
- **Contract:**
  - **Inputs:** `reinvestment_rate: float`, `roic: float`
  - **Output:** `g: float`
- **Usage:** Drives the Terminal Value calculation in DCF workflows.
- **Economic Constraint:** Practical applications assume `g` should not exceed long-term macroeconomic GDP growth.

### Terminal Value (Gordon Growth Model)
- **Equation:** `TV = CF_{n+1} / (WACC - g)`
- **Contract:**
  - **Inputs:** `terminal_cf: float`, `wacc: float`, `growth_rate: float`
  - **Output:** `terminal_value: float`
- **Sensitivity Risk:** Highly sensitive; small tweaks to `g` or `WACC` result in massive Enterprise Value swings.
- **Implementation Constraint:** Engine enforces `WACC - g > ε` (epsilon threshold) to prevent undefined/unstable blowups.

---

## 4. Cost of Capital (`hurdle_rate.py`)

### Country Risk Premium (CRP)
- **Equation:** `CRP = default_spread × (σ_equity / σ_bond)`
- **Contract:**
  - **Inputs:** `default_spread: float`, `equity_vol: float`, `bond_vol: float`
  - **Output:** `crp: float`

### Hurdle Rate (Cost of Equity)
- **Equation:** `k = r_f + β × ERP + CRP`
- **Contract:**
  - **Inputs:** `risk_free_rate: float`, `beta: float`, `erp: float`, `crp: float`
  - **Output:** `hurdle_rate: float`

### Weighted Average Cost of Capital (WACC)
- **Equation:** `WACC = (E/V) × r_e + (D/V) × r_d × (1 - t)`
- **Contract:**
  - **Inputs:** `cost_of_equity: float`, `cost_of_debt: float`, `tax_rate: float`, `equity_value: float`, `debt_value: float`
  - **Output:** `WACCComponents` containing `wacc: float`
- **Usage:** Core discount rate mechanism in `/api/v1/corporate/dcf`.
- **Assumptions:** Weights must use market values (not book values).
- **Edge Cases:** If `debt_value = 0`, WACC collapses to the cost of equity. If `equity_value = 0`, the model is invalid for standard equity valuation.
- **Limitations:** Cost of debt estimation is simplified. Beta inputs may be highly unstable for illiquid stocks.

---

## 5. Risk Analysis & Simulation (`risk_analysis.py`)

### Payback Period
- **Contract:**
  - **Inputs:** `cash_flows: list[float]`, `discount_rate: float = 0.0`, `initial_cost: float`
  - **Output:** `payback_years: Optional[float]`
- **Limitations:** Ignores cash flows beyond the breakeven point and fails to capture the time value of money unless explicitly discounted.

### Sensitivity Analysis (Tornado)
- **Contract:**
  - **Inputs:** `base_npv: float`, `variables: dict[str, tuple]`, `npv_function: Callable`, `base_inputs: dict`
  - **Output:** `list[dict]` containing swings sorted descending by absolute impact.
- **Methodology:** One-variable-at-a-time (OAT). Assumes independence between variables.
- **Limitations:** Does not capture structural interaction effects (e.g., if growth increases, margins might compress).

### Monte Carlo NPV Simulation
- **Contract:**
  - **Inputs:** `base_inputs: dict`, `variable_ranges: dict`, `npv_function: Callable`, `n_simulations: int`
  - **Output:** `dict` containing mean NPV, percentiles (P5/P50/P95), probability of positive NPV, and histogram data.
- **Statistical Interpretation:** 
  - `P5 / P50 / P95` represent the empirical percentile distribution of outcomes.
  - The probability of a positive NPV mathematically approximates the likelihood of investment success.
  - Distribution shapes must be interpreted cautiously due to the underlying independence assumptions.
- **Reproducibility:** Random seed support ensures exact reproducibility of stochastic simulations when explicitly provided.
- **Constraints:** 
  - No time-series dependency (each simulation path is independent).
  - No dynamic parameter evolution (e.g., volatility cannot change over the horizon).
  - Assumes static distributions across the entire simulation window.

### 5.1 Performance Boundaries
- **Target Envelope:** Designed natively for `< 100k` simulation iterations using vectorized NumPy.
- **Upper Bound:** Beyond `100k`, compute should shift to a compiled backend (e.g., Rust bridge).
- **Memory Scaling:** Memory usage grows linearly with simulation size.

---

## 6. Error Handling & Validation Rules

The engine prioritizes explicit safety over silent degradation:
- **Validation Execution:** All validation errors must raise explicit exceptions (e.g., `ValueError`).
- **No Silencing:** No silent fallbacks or defaulting are permitted. Errors must propagate cleanly to the API layer for user visibility.
- **WACC Checks:** The sum of Market Equity and Market Debt must be greater than zero (`E + D > 0`).

---

## 7. Known Limitations

- Simplified financial modeling assumptions (no DTA tracking, no minority interest adjustments).
- No multi-factor risk model (defaults to CAPM; lacks Fama-French extensions).
- No stochastic interest rate modeling (discount rates are constant over simulation paths).
- No stochastic correlation modeling (beyond the basic independence assumption).
- No scenario-based regime switching (e.g., recession vs. expansion pathing).
- No path-dependent modeling.
- No support for derivatives pricing (e.g., options, Greeks).
