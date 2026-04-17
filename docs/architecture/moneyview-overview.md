# MoneyView Product Overview

> **Document Role**
> This document serves as the top-level definition of MoneyView’s identity, scope, module structure, design philosophy, and operating constraints. Detailed API, quant, and system implementation documents should be read alongside this overview.

> **System Identity Statement**
> MoneyView is best understood as a **local quantitative analysis platform**, combining a computation engine, a structured API layer, and an interactive visualization system into a single-user environment. It is not just a dashboard, but a **locally-executed financial analysis engine with an integrated UI layer**, designed to provide reproducible, assumption-driven workflows without reliance on external SaaS platforms.

---

## 1. Product Overview

**What MoneyView Is**
MoneyView functions as a comprehensive, single-user workspace for market monitoring, portfolio attribution, corporate valuation, and Monte Carlo simulation. 

**Who It Is For**
It is built for quantitative investors, financial analysts, and researchers who require a private, localized environment to test assumptions, benchmark portfolios, and run advanced valuation metrics.

### 1.1 Differentiation
MoneyView is differentiated by:
- local-first execution
- reproducible assumption-driven workflows
- explicit separation between UI, API, and quant engine
- private single-user analysis without cloud dependency

### 1.2 Primary User Value
MoneyView provides users with:
- a private environment for financial experimentation
- a reproducible workspace for valuation and portfolio analysis
- integrated workflows across market data, attribution, valuation, and simulation
- direct control over assumptions without opaque SaaS abstractions

### 1.3 Design Philosophy
- **Local-First Execution**
  - All computations and data storage occur on the user's machine.
  - No dependency on remote compute or cloud persistence.
- **Separation of Concerns**
  - UI, API, and financial logic are strictly decoupled.
  - Core calculations are isolated in a pure computation engine.
- **Deterministic & Reproducible Analysis**
  - *Deterministic where model inputs are fixed:* Rule-based valuation and attribution outputs are deterministic.
  - *Reproducible where stochastic workflows expose explicit seeds or parameterized randomness:* Monte Carlo results are probabilistic by design.
- **Composable Financial Workflows**
  - Modules (DCF, attribution, simulation) can be combined into larger analysis pipelines.

### 1.4 Terminology
- **Workspace:** The entire MoneyView application.
- **Module:** A feature-level system (e.g., Portfolio, Corporate, Simulation).
- **Engine:** The core Python/NumPy computation layer.
- **Dashboard:** The UI presentation and visualization layer.

---

## 2. Key Capabilities & Primary Workflows

### 2.1 Key Capabilities

**Market Overview**
- **Purpose:** Provide a macro snapshot of the broader financial environment. Primarily a monitoring and context module, not a deep research engine; intended to provide macro context for downstream valuation and portfolio workflows.
- **Core Outputs:** Real-time index pricing, commodity tracking, FX rates, crypto quotes.
- **Underlying Engine:** FastAPI market data ingestion routes.

**Portfolio Command Center**
- **Purpose:** Analyze portfolio performance, attribution effects, and benchmark-relative returns.
- **Core Outputs:** Total return, active return, Brinson-Fachler attribution effects, risk metrics (Beta, VaR).
- **Underlying Engine:** Portfolio attribution module in `core_finance`.

**Corporate Analysis**
- **Purpose:** Perform intrinsic valuation and diagnostic cross-company comparisons.
- **Core Outputs:** Enterprise Value (DCF), Hurdle Rates, Sensitivity (Tornado) swings, snapshot histories.
- **Underlying Engine:** DCF and Hurdle Rate modules in `core_finance`.

**Simulation Lab**
- **Purpose:** Model uncertainty and analyze risk distribution across custom inputs.
- **Core Outputs:** Mean NPV, P5/P50/P95 distributions, Probability of Positive NPV.
- **Underlying Engine:** NumPy vectorized Monte Carlo simulation and frontend Web Workers.

### 2.2 Primary Workflows

**Company Valuation Workflow**
1. Select target company.
2. Adjust financial assumptions (growth, margin, WACC).
3. Run DCF calculation.
4. Analyze intrinsic value vs market price.
5. Perform sensitivity analysis.

**Portfolio Analysis Workflow**
1. Load watchlist and set allocations.
2. Run attribution against a benchmark (e.g., S&P 500).
3. Compare portfolio vs. benchmark sector weights.
4. Analyze allocation and selection active return drivers.

**Simulation Workflow**
1. Define stochastic parameters (volatility, horizon, iterations).
2. Run Monte Carlo simulation.
3. Analyze outcome distribution and histograms.
4. Evaluate downside risk.

### 2.3 Module Inventory

Primary modules currently include:
- Market Overview
- Portfolio Command Center
- Corporate Analysis
- Simulation Lab

Supporting infrastructure includes:
- API layer
- Quant engine
- shared schema/types
- local persistence layer
- launcher/runtime utilities

---

## 3. Scope and Boundaries

### 3.1 Data Responsibility Split

**Persistent Data (SQLite / Filesystem):**
- SQLite stores canonical user state such as:
  - watchlists
  - target allocations
  - historical comparison snapshots
  - overridden metrics
- Filesystem-based storage may be used for:
  - raw extracts
  - temporary cache artifacts
  - import/export support files

**Transient Data (Computed on-the-fly):**
- DCF outputs.
- Simulation results and path distributions.
- Brinson-Fachler attribution calculations.

### 3.2 Single-User Constraints & External Dependencies

**Trusted Local Environment Assumption**
MoneyView assumes it is running in a trusted local environment controlled by a single user. It does not include hardened security boundaries suitable for public network exposure.

**Single-User Implications:**
- No concurrency control (assumes 1 user).
- No authentication layer.
- No distributed state.

**External Dependency Clarification:**
- External data providers (e.g., Yahoo Finance) are best-effort.
- Data is not guaranteed to be 100% accurate and may introduce missing, lagged, or split-adjusted anomalies. This must be factored into financial correctness expectations.

### 3.3 System Boundaries

**Inside the System**
- Next.js frontend
- FastAPI backend
- `core_finance` engine
- SQLite / local file cache
- local launcher and local runtime processes

**Outside the System**
- external market data vendors
- external Python / Node package ecosystem
- user OS / local machine environment

**Not Part of the System**
- cloud persistence
- shared multi-user backend
- external job orchestration platform

---

## 4. Repository Structure & Architectural Rules

### 4.1 Folder Responsibilities

`packages/core_finance/`
- **Role:** Pure computation layer.
- **Constraint:** Must not depend on FastAPI or frontend code.
- **Design Goal:** Provide deterministic, highly testable financial functions (NumPy/Python).

`apps/api/`
- **Role:** Backend orchestration layer.
- **Constraint:** Must keep HTTP handlers thin; delegates math to `core_finance`.
- **Design Goal:** Safely marshal data, enforce schemas via Pydantic, and execute SQLite operations.

`apps/web/`
- **Role:** Presentation and interactive layer.
- **Constraint:** Must not implement canonical financial business logic. Frontend workers may execute exploratory or UI-performance-oriented simulations, but the backend Python engine remains the primary reference implementation for financial methodology.
- **Design Goal:** Fast, responsive Recharts visualization powered by React Query caching.

`packages/shared-types/`
- **Role:** API contract enforcement.
- **Constraint:** Auto-generated strictly from Pydantic schemas.
- **Design Goal:** Ensure frontend/backend type safety.

### 4.2 Architectural Rules

1. **Frontend must not implement canonical financial logic.**
2. **Backend routes must not contain business logic beyond orchestration and validation.**
3. **Core engine must remain web-framework independent.**

---

## 5. Runtime and Computation Flow

### 5.1 High-Level Data Flow

1. **External provider** → Raw data ingestion.
2. **Raw data** → Normalization (Pydantic) → Local storage cache.
3. **Frontend request** → Backend API routing.
4. **Backend orchestrator** → `core_finance` computation execution.
5. **Computed result** → Structured API response.
6. **Frontend** → UI visualization (Recharts).

### 5.2 Runtime Behavior

- **Two-Process Model:** The system runs a Next.js frontend (Node) and a FastAPI backend (Python) concurrently via local desktop processes.
- **Communication:** Standard HTTP over localhost. 
- **Scheduling:** No distributed execution or persistent background job scheduler (except in-memory FastAPI tasks like WAL flushing).

### 5.3 Computation Model

- **Canonical Computation:** Core financial methodology is defined in the Python `core_finance` engine.
- **Exploratory Computation:** Some simulation workloads may run in frontend Web Workers for responsiveness.
- **Rule:** Frontend-side simulations are performance-oriented execution paths, not the authoritative source of financial model design.

---

## 6. Known Limitations and Non-Goals

### 6.1 Non-Goals
MoneyView is not designed to be:
- a multi-tenant SaaS analytics platform
- a brokerage execution engine
- a high-frequency trading system
- a derivatives pricing platform
- a collaborative cloud workspace

### 6.2 Known Limitations
- **No real-time streaming:** Market data relies on request/response polling, not WebSockets.
- **Limited error recovery:** Network timeouts to external APIs fail the specific request.
- **No distributed scaling:** Bounded by local machine CPU/Memory limits.
- **Partial Logic Duplication:** Specific Monte Carlo simulation workloads are duplicated between Python and frontend JS Web Workers to prevent backend thread locking on massive iterations.
