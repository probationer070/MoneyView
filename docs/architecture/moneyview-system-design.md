# MoneyView System Design

> **Document Scope**
> This document defines the structural and behavioral design of the MoneyView system. It should be read alongside the Product Overview, API Reference, and Quant Engine documentation for full system understanding.

## 0. System Identity (Architectural Context)

MoneyView is a **local-first analytical system**, not a distributed application.  
It must be understood as:
- a **single-node system**
- with **separated UI and computation layers**
- communicating over **localhost HTTP boundaries**

---

## 1. System Architecture

MoneyView operates on a local-first, single-node, dual-process architecture. Both the frontend and backend run concurrently on the same local machine.

### 1.1 System Boundaries
- **Internal:** Frontend (Next.js), Backend (FastAPI), Core Finance Engine (`packages/core_finance`), SQLite database.
- **External:** Market data providers (e.g., Yahoo Finance).
- **Excluded:** Authentication systems, Cloud services, Distributed processing.

### 1.2 Data Ownership
- **Persistent (SQLite):** Watchlist holdings, corporate snapshots, overridden metrics.
- **Transient (Computed per request):** DCF outputs, attribution results, Monte Carlo simulations.

### 1.3 Security Model
- The system assumes a **trusted local environment**.
- No authentication or authorization is implemented.
- No protection against malicious local actors exists.
- Not intended to be exposed to public networks.

### 1.4 Core Engine Relationship
- The `core_finance` package is the **single source of truth** for financial computations.
- Backend services act only as orchestrators.
- The engine:
  - does not depend on FastAPI.
  - does not access the database.
  - does not maintain state.

### 1.5 Communication Constraints
- All frontend-backend communication must occur via HTTP API.
- No direct database access from the frontend.
- No shared memory between processes.

---

## 2. Frontend Design (`apps/web`)

The frontend acts as the presentation and interaction layer.
- **Constraint:** The frontend must **not** implement core financial calculations. It only transforms data for visualization.
- **State Management:** Uses React Query for caching, background refetching, and invalidation. No global state managers (e.g., Redux) are used.

### Visualizations & Charting
- **Performance Considerations:** Large datasets require downsampling. Recharts performance may degrade with high-frequency OHLCV arrays.
- **Data Contract:** The backend returns pure domain models. Frontend adapters flatten this data for chart libraries.

---

## 3. Backend Design (`apps/api`)

The backend is an orchestrator and computation engine.
- **Routing (`routes/`):** Thin HTTP handlers.
- **Services (`services/`):** The orchestration layer. Services coordinate DB calls and Core Engine calls. They do **not** contain core financial formulas themselves.
- **Execution Model:**
  - **CPU-bound tasks:** Executed synchronously.
  - **I/O-bound tasks:** Executed asynchronously via `asyncio`.

---

## 4. Data and Computation Flow

### 4.1 Computation Flow (General Pattern)
1. **Frontend** sends HTTP request.
2. **Backend** validates input via Pydantic.
3. **Service** orchestrates data retrieval (from SQLite/cache) and delegates to `core_finance`.
4. **Engine** returns:
   - deterministic outputs for rule-based calculations (DCF, attribution).
   - stochastic outputs for simulation-based models (Monte Carlo).
5. **Backend** wraps the response in an `APIResponse[T]`.
6. **Frontend** receives the payload and renders the visualization.

### 4.2 Data Lifecycle
Data traverses the following lifecycle:
1. Ingested from external providers.
2. Normalized into domain models.
3. Optionally persisted in SQLite.
4. Used in computations.
5. Returned to the frontend for visualization.
*(Note: Some data, like simulation outputs, exists only transiently.)*

### 4.3 Cache Strategy
- **Frontend Cache:** Managed by React Query; controls refetching and UI state.
- **Backend Cache:** May include SQLite persistence or file-based caching. There is no dedicated in-memory cache layer (e.g., Redis).

### 4.4 Module Interaction
- **Portfolio Module** depends on: watchlist data, attribution engine.
- **Corporate Module** depends on: financial metrics, DCF engine.
- **Simulation Module** depends on: stochastic engine, frontend worker execution.

---

## 5. Runtime, Reliability, & Scale

### 5.1 Failure Modes
- **External API failure** → Fallback to cached data or return explicit error.
- **Backend failure** → Frontend request fails cleanly.
- **Frontend failure** → UI becomes unresponsive.
- **Process crash** → Manual restart required (no process supervisor).

### 5.2 Reliability
- **Missing Components:** There is no retry/backoff strategy, no persistent job queue, no state recovery after crash, and no audit/log replay system. The system relies entirely on the stability of the trusted local environment stack.

### 5.3 Scalability Boundaries
- **Designed for:** Single-user workloads, moderate dataset sizes.
- **Not designed for:** Concurrent multi-user access, large-scale distributed simulations, or high-frequency real-time data ingestion.

### 5.4 Performance Optimization Strategy
- Offload specific exploratory simulations to Web Workers in the frontend.
- Utilize NumPy vectorization on the backend.
- A planned Rust bridge (`simulation-rs`) for iterations exceeding 100k.

---

## 6. Known Constraints & Limitations

- **No WebSocket / real-time streaming.**
- **No distributed scaling.** Bounded tightly to the local machine's compute capacity.
- **Tight coupling to local environment.** (Assumes a local Python/Node setup).
- **External data reliability is not guaranteed.** Missing or lagged vendor data directly degrades system accuracy.

### 6.1 Non-Goals
The system is **not** designed to:
- operate as a multi-user or multi-tenant backend.
- provide real-time streaming or trading execution.
- serve as a production-grade cloud API.
- support distributed or horizontally scaled computation.

---

## 7. Architectural Rules

- **Frontend** must not implement financial logic.
- **Backend** must remain thin (no heavy business logic in routes or services).
- **Core engine** must remain web-framework independent (pure Python).
- **Data flow** must pass through API boundaries.

## 8. Terminology

- **Module:** A feature-level system (e.g., portfolio, corporate, simulation).
- **Engine:** The core computation layer (`core_finance`).
- **Service:** A backend computation orchestration unit.
- **Adapter:** A frontend transformation layer bridging domain payloads to chart inputs.
