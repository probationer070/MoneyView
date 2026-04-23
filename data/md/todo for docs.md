# Documentation Todo

Purpose: track the active documentation plan for explaining MoneyView as a local-first financial analysis platform, including the full system, engine, calculation processes, theories, API contracts, data ownership, and module behavior.

Status snapshot: as of 2026-04-23, the next delivery slice is to consolidate the existing architecture notes in `docs/architecture/` into a complete, maintainable system-documentation set that matches the current codebase in `apps/api`, `apps/web`, and `packages/core_finance`.

## Active Tracks

Legend:
- `[ ]` not started
- `[~]` in progress
- `[x]` completed
- Remove completed items from this file after the result is merged into the permanent docs set

## Track 1: Documentation Scope, Audience, And Canonical Structure

Problem:
- MoneyView already has multiple architecture documents, but they overlap and do not yet form one clear documentation system.
- The current docs explain the product direction, but they do not yet define a canonical writing order, ownership model, or maintenance rule for keeping docs aligned with code changes.
- The repo needs a documentation roadmap that treats MoneyView as a local-first finance platform rather than a generic full-stack app.

Target outcome:
- The docs clearly define MoneyView's identity, boundaries, users, runtime model, and non-goals.
- Every major documentation topic has a canonical file in `docs/architecture/`.
- The team has one explicit roadmap describing what to write, in what order, and which source files own the truth.

Execution checklist:
- [x] Confirm the canonical documentation set for MoneyView:
  `moneyview-overview.md`
  `moneyview-system-design.md`
  `system-overview.md`
  `moneyview-api-reference.md`
  `moneyview-quant-engine.md`
  `data-flow.md`
  `storage-model.md`
  `visualization-metrics.md`
  `documentation-roadmap.md`
- [x] Define the purpose of each architecture document and remove vague overlap between overview, system design, and data-flow docs
- [x] Add an architecture index page that tells a reader where to start and what each document covers
- [x] Add documentation maintenance rules for when API contracts, finance formulas, storage behavior, or feature ownership changes
- [x] Add a glossary for platform, finance, and runtime terms used across the documentation set

Engineering notes:
- Keep product identity in one top-level doc instead of repeating it in every architecture note.
- Use existing files as anchors where possible instead of scattering new architecture notes across unrelated folders.
- Prefer one canonical explanation per concept and link to it from other docs.

Acceptance criteria:
- A new reader can identify what MoneyView is, what it is for, what it is not for, and where to find the detailed docs next.
- The architecture folder has a stable, intentional structure rather than a loose collection of notes.
- Documentation ownership rules are explicit enough to reduce drift after future code changes.

## Track 2: System Architecture, Runtime Boundaries, And Storage Ownership

Problem:
- The current docs describe the high-level architecture, but storage ownership and runtime boundaries are still spread across multiple documents and implementation files.
- Important local-first details such as SQLite ownership, cache files, seed JSON, browser workers, startup behavior, and external provider boundaries are not yet documented in one coherent system view.
- Readers can infer the runtime from code, but not quickly from the docs.

Target outcome:
- The documentation explains the full local runtime model from launcher to frontend/backend processes to storage and external providers.
- Data ownership is explicit: what is persisted, what is transient, what is cached, what is seeded, and what is authoritative.
- The docs explain failure boundaries, trusted-local assumptions, and the single-user model clearly.

Execution checklist:
- [x] Document the system context for MoneyView:
  user
  frontend
  backend
  `core_finance`
  SQLite
  filesystem cache
  external market/news data providers
- [x] Document the container/runtime view:
  Next.js frontend
  FastAPI backend
  browser workers
  local launcher/runtime scripts
  local logs
- [x] Create `docs/architecture/storage-model.md` covering:
  SQLite source-of-truth tables
  snapshot tables
  watchlist ownership
  comparison snapshot retention
  `stock_targets.json` as seed/import-export artifact
  cache/log files under `data/`
- [x] Document startup and runtime behavior from `run.cmd` and `scripts/start_local.ps1`
- [x] Document trust boundaries, non-goals, and why MoneyView is not designed for public exposure or multi-tenant use
- [x] Document reliability limits:
  no auth
  no distributed scheduler
  no websocket real-time stream
  no cloud persistence
  manual restart on process crash

Engineering notes:
- Keep runtime facts tied to current implementation, not aspirational architecture.
- Distinguish clearly between canonical persisted state and convenience artifacts.
- Do not describe browser-worker simulations as backend-owned when they are explicitly frontend-owned exploratory flows.

Acceptance criteria:
- A reader can explain where MoneyView runs, what processes exist, how they communicate, and which data stores are authoritative.
- Storage behavior for watchlist, snapshots, cache, logs, and derived calculations is unambiguous.
- The docs make the trusted-local single-user assumption impossible to miss.

## Track 3: API Contract Documentation

Problem:
- The current API reference is useful, but it is not yet a complete route-by-route contract for the full FastAPI surface.
- Some endpoint families and details are under-documented, especially side effects, persistence impact, heavy-endpoint behavior, and frontend consumers.
- The docs should match the real route surface in `apps/api/routes`, not a simplified subset.

Target outcome:
- `docs/architecture/moneyview-api-reference.md` becomes the canonical API contract document for all active route families.
- Every endpoint is documented with method, path, parameters, request/response model, auth assumption, storage side effects, and performance notes.
- The API docs explain how backend orchestration connects to services, schemas, and frontend consumers.

Execution checklist:
- [x] Inventory all active routes under:
  `apps/api/main.py`
  `apps/api/routes/portfolio.py`
  `apps/api/routes/corporate.py`
  `apps/api/routes/market.py`
  `apps/api/routes/detail.py`
  `apps/api/routes/stock.py`
  `apps/api/routes/report.py`
  `apps/api/routes/news.py`
  `apps/api/routes/monte_carlo.py`
  `apps/api/routes/diagnostic.py`
- [x] For each endpoint, document:
  method
  path
  purpose
  request schema
  response schema
  error behavior
  persistence touched
  heavy/light classification
  frontend/module consumers
- [x] Mark legacy or hybrid endpoints explicitly where frontend workers replaced older backend flows
- [x] Document response-envelope conventions and any known exceptions
- [x] Document streaming behavior for DCF/report-related endpoints where applicable
- [x] Cross-check API docs against current tests in `tests/api`

Engineering notes:
- The API reference should document the actual contract, not duplicate implementation prose from route files.
- Keep route handlers thin in the docs too: explain orchestration boundaries and point to the owning service when needed.
- Note destructive endpoints clearly, especially watchlist resync and snapshot delete behavior.

Acceptance criteria:
- A frontend engineer can build against the docs without reading route internals first.
- A reviewer can identify which endpoints mutate SQLite state and which ones are read-only or computed-only.
- The documented API surface matches the actual route definitions in the repo.

## Track 4: Quant Engine, Financial Formulas, And Theory

Problem:
- The current quant-engine doc covers major valuation formulas, but it does not yet fully cover the broader engine surface in `packages/core_finance`.
- Key theory areas such as beta transformation, expected return methodology, and module ownership need stronger treatment.
- The docs need to explain not only equations, but also assumptions, economic interpretation, constraints, and edge cases.

Target outcome:
- `docs/architecture/moneyview-quant-engine.md` becomes the formal specification for the MoneyView computation engine.
- The documentation covers formula definitions, module mapping, numerical conventions, validation rules, and theoretical limits.
- Engine ownership is explicit: canonical methodology belongs in Python, while frontend workers are optimization/exploration paths where applicable.

Execution checklist:
- [x] Expand engine coverage for:
  `dcf.py`
  `hurdle_rate.py`
  `risk_analysis.py`
  `beta.py`
  `expected_return.py`
- [x] For each formula or method, document:
  definition
  equation
  inputs
  outputs
  units
  assumptions
  edge cases
  rounding/precision expectations
  failure conditions
- [x] Document theory sections for:
  FCFF
  NPV
  sustainable growth
  terminal value
  CAPM
  country risk premium
  hurdle rate decomposition
  WACC
  levered/unlevered/bottom-up beta
  DCF-implied return
  expected return spread
  Monte Carlo percentile interpretation
- [x] Document engine-wide numerical conventions:
  decimal rates
  annual assumptions
  finite-input requirements
  deterministic vs stochastic behavior
- [x] Document what remains outside the engine because it is API-specific or frontend-specific
- [x] Cross-check formulas against tests in `tests/core_finance`

Engineering notes:
- Do not let the docs imply that exploratory frontend simulation code redefines canonical finance methodology.
- Separate pure financial theory from application-specific orchestration.
- Prefer explicit constraints over vague “best effort” language when the code raises on invalid input.

Acceptance criteria:
- A reader can understand both the theory and the implementation contract of MoneyView’s finance engine.
- The engine doc accounts for all current core-finance modules, not just DCF and WACC.
- Validation rules and model limitations are explicit enough to support future review and refactoring.

## Track 5: Calculation Pipelines And End-To-End Data Flow

Problem:
- The repo has useful data-flow notes, but the most important “how calculations happen” paths are still fragmented.
- MoneyView needs explicit documentation for its calculation pipelines, not just endpoint lists and formula definitions.
- The user asked for entire-system and calculate-process documentation, which requires step-by-step pipeline views across modules.

Target outcome:
- `docs/architecture/data-flow.md` becomes the canonical pipeline document for the major end-to-end workflows.
- The docs explain how user input, API orchestration, finance computation, persistence, cache, and UI rendering fit together.
- Each major workflow has a reproducible, implementation-grounded sequence.

Execution checklist:
- [x] Fully document the Portfolio attribution pipeline from watchlist load to chart rendering
- [x] Document watchlist mutation, sync, and destructive resync flows
- [x] Document the Corporate DCF calculation pipeline from metrics load through assumptions to valuation outputs
- [x] Document the corporate comparison pipeline:
  live mode
  snapshot mode
  universe resolution
  version history
  deletion
- [x] Document the Monte Carlo workflow across:
  page state
  shared worker
  simulation core
  valuation core
  correlation core
  progress and cancellation
- [x] Document report-generation/export flow and output rendering ownership
- [x] Document where cache is consulted, where SQLite is updated, and where outputs remain transient only

Engineering notes:
- Pipelines should show sequence and ownership, not just restate endpoints.
- Keep the distinction between persisted state and computed state visible in every flow.
- Explain where frontend adapters reshape domain responses for charts without redefining the underlying finance logic.

Acceptance criteria:
- A reader can trace any major MoneyView workflow from user action to final rendered output.
- The docs explain which stages are backend-owned, engine-owned, frontend-owned, or worker-owned.
- Calculation pipelines are detailed enough to support debugging and onboarding.

## Track 6: Feature Modules, Visualizations, And Metric Semantics

Problem:
- Feature docs exist in separate tab-focused notes, but there is no unified module-spec view for the full product.
- Chart and KPI semantics are still scattered across UI code and backend payloads.
- Readers need one place to understand what each feature does, what data it uses, and what every major metric or graph actually means.

Target outcome:
- Each primary module is documented as a mini-spec with purpose, dependencies, state, calculations, APIs, and outputs.
- Visualizations and KPIs are documented with metric definitions, filters, granularity, and drill-down rules.
- The docs distinguish clearly between canonical backend metrics and frontend presentation transforms.

Execution checklist:
- [x] Write module-spec sections for:
  Market Overview
  Portfolio Command Center
  Corporate Analysis
  Simulation Lab
  Reports/export
  News/crawling
  Diagnostics/log visibility
- [x] Create `docs/architecture/visualization-metrics.md`
- [x] For each major chart/KPI, document:
  metric meaning
  formula or source
  backend/frontend ownership
  filters and time windows
  granularity
  color or status semantics
  drill-down behavior
- [x] Cross-reference existing tab docs:
  `docs/portfolio-tab.md`
  `docs/corporate-analysis-tab.md`
  `docs/monte-carlo-tab.md`
- [x] Identify metrics or graphs whose methodology is still implicit in UI code and promote that meaning into docs

Engineering notes:
- Avoid documenting charts as purely visual components; explain the business meaning of each graph.
- If a metric is computed in backend code but reshaped in frontend code, document both roles separately.
- Keep module docs aligned with actual screen ownership in `apps/web/app`.

Acceptance criteria:
- A product or engineering reader can understand what each MoneyView module is responsible for.
- KPI and chart semantics are documented well enough to prevent silent drift in future UI changes.
- Feature/module docs connect cleanly to API, engine, and data-flow docs.

## Writing Order

Recommended execution order:
1. `documentation-roadmap.md`
2. `system-overview.md`
3. `moneyview-overview.md`
4. `moneyview-system-design.md`
5. `storage-model.md`
6. `moneyview-api-reference.md`
7. `moneyview-quant-engine.md`
8. `data-flow.md`
9. `visualization-metrics.md`
10. Final glossary, changelog, and maintenance notes

## Source Of Truth References

Primary code and document references:
- `README.md`
- `guideline/file-structure.md`
- `docs/architecture/`
- `apps/api/routes/`
- `apps/api/services/`
- `apps/api/models/`
- `packages/core_finance/`
- `packages/shared-types/`
- `apps/web/app/`
- `apps/web/components/`
- `tests/api/`
- `tests/core_finance/`

## Definition Of Done

- [x] The architecture docs describe the current MoneyView system without requiring major inference from source code
- [x] API, engine, storage, and data-flow docs agree on ownership boundaries
- [x] All core finance modules and major route families are documented
- [x] The major calculate processes are documented end to end
- [x] Visualization and metric semantics are explicit for the main screens
- [x] The docs set is maintainable, indexed, and structured for future updates
