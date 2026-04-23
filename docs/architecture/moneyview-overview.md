# MoneyView Product Overview

> **Document Role**
> This document is the canonical home for MoneyView's product identity, audience, design philosophy, scope, system boundaries, and shared glossary. Detailed API, quant, storage, and workflow implementation notes should be read alongside this overview rather than duplicated here.

> **System Identity Statement**
> MoneyView is best understood as a **local quantitative analysis platform**, combining a computation engine, a structured API layer, and an interactive visualization system into a single-user environment. It is not just a dashboard, but a **locally-executed financial analysis engine with an integrated UI layer**, designed to provide reproducible, assumption-driven workflows without reliance on external SaaS platforms.

---

## 1. Product Overview

**What MoneyView Is**
MoneyView functions as a comprehensive, single-user workspace for market monitoring, portfolio attribution, corporate valuation, and Monte Carlo simulation.

**Who It Is For**
It is built for quantitative investors, financial analysts, and researchers who require a private, localized environment to test assumptions, benchmark portfolios, and run advanced valuation metrics.

**Related Documents**
- `system-overview.md` is the architecture index and reading guide.
- `moneyview-system-design.md` defines runtime structure and technical boundaries.
- `moneyview-api-reference.md` defines the HTTP contract.
- `moneyview-quant-engine.md` defines canonical financial methodology.
- `data-flow.md` explains end-to-end workflow execution.

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
- **Deterministic And Reproducible Analysis**
  - Deterministic where model inputs are fixed: rule-based valuation and attribution outputs are deterministic.
  - Reproducible where stochastic workflows expose explicit seeds or parameterized randomness: Monte Carlo results are probabilistic by design.
- **Composable Financial Workflows**
  - Modules such as DCF, attribution, and simulation can be combined into larger analysis pipelines.

### 1.4 Core Terminology
- **Workspace:** The entire MoneyView application.
- **Module:** A feature-level system such as Portfolio, Corporate Analysis, or Simulation Lab.
- **Engine:** The core Python/NumPy computation layer.
- **Dashboard:** The UI presentation and visualization layer.
- **Local-First:** The application stores state and performs primary computation on the user's machine rather than depending on cloud-hosted persistence or compute.
- **Canonical:** The authoritative implementation or definition used as the source of truth.
- **Persistent State:** Data intentionally written to SQLite or local files for reuse across sessions.
- **Transient State:** Data computed for the current request, render, or simulation run and not stored as the canonical record.
- **Trusted Local Environment:** The assumption that the app runs on a machine controlled by one user and is not exposed as a hardened public service.

---

## 2. Key Capabilities And Primary Workflows

### 2.1 Key Capabilities

**Market Overview**
- **Purpose:** Provide a macro snapshot of the broader financial environment. It is a monitoring and context module rather than a deep research engine.
- **Core Outputs:** Real-time index pricing, commodity tracking, FX rates, and crypto quotes.
- **Underlying Engine:** FastAPI market-data ingestion routes and local cache behavior.

**Portfolio Command Center**
- **Purpose:** Analyze portfolio performance, attribution effects, and benchmark-relative returns.
- **Core Outputs:** Total return, active return, Brinson-Fachler attribution effects, and risk metrics such as beta and VaR.
- **Underlying Engine:** Portfolio orchestration services plus reusable finance primitives.

**Corporate Analysis**
- **Purpose:** Perform intrinsic valuation and diagnostic cross-company comparisons.
- **Core Outputs:** Enterprise value, hurdle-rate decomposition, sensitivity views, and comparison snapshots.
- **Underlying Engine:** DCF, hurdle-rate, beta, and expected-return logic orchestrated through the backend.

**Simulation Lab**
- **Purpose:** Model uncertainty and analyze risk distribution across custom inputs.
- **Core Outputs:** Mean NPV, percentile distributions, probability-of-positive outcomes, valuation uncertainty, and correlation experiments.
- **Underlying Engine:** Browser-worker simulation flows plus selected backend and Python finance support where applicable.

### 2.2 Primary Workflows

**Company Valuation Workflow**
1. Select a target company.
2. Load or override current financial metrics.
3. Adjust valuation assumptions such as growth, margin, and WACC.
4. Run the DCF calculation.
5. Analyze intrinsic value, upside/downside, and diagnostics.

**Portfolio Analysis Workflow**
1. Load watchlist holdings and saved weights.
2. Run attribution against a benchmark.
3. Compare portfolio and benchmark exposures.
4. Analyze allocation, selection, and risk drivers.

**Simulation Workflow**
1. Define stochastic parameters such as volatility, horizon, and iterations.
2. Run Monte Carlo simulation.
3. Review distributions, paths, and percentile outcomes.
4. Evaluate uncertainty and downside risk.

### 2.3 Module Inventory

Primary modules currently include:
- Market Overview
- Portfolio Command Center
- Corporate Analysis
- Simulation Lab

Supporting infrastructure includes:
- API layer
- quant engine
- shared schema and types
- local persistence layer
- launcher and runtime utilities

---

## 3. Scope And Boundaries

### 3.1 Data Responsibility Split

**Persistent Data**
- SQLite stores canonical user state such as watchlists, target allocations, historical comparison snapshots, and overridden metrics.
- Filesystem-based storage may be used for raw extracts, temporary cache artifacts, and import/export support files.

**Transient Data**
- DCF outputs
- simulation results and path distributions
- Brinson-Fachler attribution calculations

### 3.2 Single-User Constraints And External Dependencies

**Trusted Local Environment Assumption**
MoneyView assumes it is running in a trusted local environment controlled by a single user. It does not include hardened security boundaries suitable for public network exposure.

**Single-User Implications**
- no concurrency control for independent users
- no authentication or authorization layer
- no distributed shared state

**External Dependency Clarification**
- External data providers such as Yahoo Finance and crawling sources are best-effort.
- Provider data may be missing, lagged, throttled, or inconsistent, and those limitations affect analysis quality.

### 3.3 System Boundaries

**Inside The System**
- Next.js frontend
- FastAPI backend
- `packages/core_finance`
- SQLite and local file cache
- local launcher and runtime processes

**Outside The System**
- external market/news data providers
- external Python and Node package ecosystems
- the user's operating system and local machine environment

**Not Part Of The System**
- cloud persistence
- shared multi-user backend services
- external job orchestration platforms

---

## 4. Repository Structure And Architectural Rules

### 4.1 Folder Responsibilities

`packages/core_finance/`
- **Role:** Pure computation layer.
- **Constraint:** Must not depend on FastAPI or frontend code.
- **Design Goal:** Provide deterministic, highly testable financial functions.

`apps/api/`
- **Role:** Backend orchestration layer.
- **Constraint:** Must keep HTTP handlers thin and delegate canonical finance logic appropriately.
- **Design Goal:** Marshal data safely, enforce schemas via Pydantic, and execute local persistence workflows.

`apps/web/`
- **Role:** Presentation and interactive layer.
- **Constraint:** Must not define canonical financial methodology. Frontend workers may run exploratory or performance-oriented simulations, but they do not become the primary finance specification.
- **Design Goal:** Provide responsive visualization and interaction using typed backend contracts.

`packages/shared-types/`
- **Role:** API contract synchronization.
- **Constraint:** Derived from backend schema definitions.
- **Design Goal:** Keep frontend and backend payload definitions aligned.

### 4.2 Architectural Rules

1. Frontend must not own canonical financial logic.
2. Backend routes must remain orchestration and validation boundaries.
3. Core engine code must remain framework-independent.

---

## 5. Runtime And Computation Model

### 5.1 High-Level Runtime

- MoneyView runs as a two-process local system: a Next.js frontend and a FastAPI backend.
- Frontend-backend communication happens over localhost HTTP.
- Some simulation-heavy workflows also use browser workers for responsiveness.

### 5.2 Computation Model

- **Canonical Computation:** Core financial methodology is defined in Python and backend-owned finance logic.
- **Exploratory Computation:** Some simulation workloads run in frontend web workers for responsiveness.
- **Rule:** Frontend-side simulation paths are optimization-oriented execution paths, not the authoritative source of financial model design.

---

## 6. Known Limitations And Non-Goals

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
- **No distributed scaling:** The system is bounded by local machine CPU and memory limits.
- **Partial logic duplication:** Specific Monte Carlo workloads are duplicated between Python and frontend worker code to prevent backend thread locking on massive iterations.

---

## 7. Shared Glossary

This glossary exists to keep the architecture set consistent. More specialized formulas and API terms should be defined in the engine and API documents rather than duplicated here.

- **API layer:** The FastAPI boundary that validates requests, orchestrates services, and returns typed responses.
- **Attribution:** Portfolio return decomposition into benchmark-relative effects such as allocation and selection.
- **Backend orchestration:** Service-layer coordination of storage access, provider access, and finance-engine execution.
- **Browser worker:** Frontend background execution path used for simulation-heavy UI workflows without blocking the main thread.
- **Comparison snapshot:** A persisted point-in-time materialization of corporate-comparison metrics stored for later review.
- **DCF:** Discounted cash flow valuation used to estimate intrinsic enterprise or equity value from future cash flows and discount assumptions.
- **Implied cash:** The unallocated remainder when saved positive watchlist weights do not sum to 100%.
- **Quant engine:** The reusable, framework-independent finance computation layer in `packages/core_finance`.
- **Seed artifact:** A local file used to bootstrap or import state, but not treated as the canonical mutable store after initialization.
- **Source of truth:** The authoritative storage location or implementation that other layers must follow.
