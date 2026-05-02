# MoneyView Documentation Roadmap

This document defines the canonical architecture-document set for MoneyView, the responsibility of each file, the recommended writing order, and the maintenance rules that keep the docs aligned with the codebase.

## 1. Documentation Goal

MoneyView should be documented as a local-first financial analysis platform, not as a generic web application. The documentation set must explain:

1. what the product is and where its boundaries are
2. how the local runtime is structured
3. how the API and engine are separated
4. how calculations, persistence, and UI workflows connect
5. how to keep the docs current as the code evolves

## 2. Canonical Document Set

The following files are the intended long-term architecture set under `docs/architecture/`:

| File | Canonical role | Must not drift into |
| --- | --- | --- |
| `system-overview.md` | Architecture index and reading guide | deep implementation detail or duplicated theory |
| `moneyview-overview.md` | Product identity, scope, users, boundaries, non-goals, glossary | route-by-route API detail or formula derivations |
| `moneyview-system-design.md` | Runtime architecture, component boundaries, communication rules, reliability limits | full endpoint catalog or metric-by-metric chart semantics |
| `moneyview-api-reference.md` | API contract, route families, request/response behavior, side effects | product positioning or finance-theory exposition |
| `moneyview-quant-engine.md` | Canonical finance-engine specification, formulas, numerical conventions, theory | frontend presentation detail or HTTP transport discussion |
| `data-flow.md` | End-to-end workflows and calculation pipelines | top-level product framing |
| `storage-model.md` | SQLite, file cache, seed artifacts, retention, source-of-truth rules | route catalog or UI behavior detail |
| `cqrs-read-write-separation.md` | Command/query ownership, read-model adoption rules, projection boundaries | generic CQRS theory or implementation-free wish lists |
| `visualization-metrics.md` | KPI and chart semantics, filters, drill-downs, ownership of metric meaning | full component implementation walkthroughs |

## 3. Planned Additions

The following architecture files are part of the canonical set and should exist even before they are fully expanded:

- `storage-model.md`
- `visualization-metrics.md`

Additional supporting notes may exist, but they should not compete with the files above for canonical ownership.

## 4. Recommended Reading Order

For a new engineer, reviewer, or future agent, use this order:

1. `system-overview.md`
2. `moneyview-overview.md`
3. `moneyview-system-design.md`
4. `storage-model.md`
5. `cqrs-read-write-separation.md`
6. `moneyview-api-reference.md`
7. `moneyview-quant-engine.md`
8. `data-flow.md`
9. `visualization-metrics.md`

## 5. Writing Order For Documentation Work

When expanding or rebuilding the docs, write in this order:

1. `documentation-roadmap.md`
2. `system-overview.md`
3. `moneyview-overview.md`
4. `moneyview-system-design.md`
5. `storage-model.md`
6. `cqrs-read-write-separation.md`
7. `moneyview-api-reference.md`
8. `moneyview-quant-engine.md`
9. `data-flow.md`
10. `visualization-metrics.md`

The goal is to stabilize scope and boundaries before documenting contracts, formulas, and visualization semantics.

## 6. Ownership Boundaries

Use these rules to decide where a concept belongs:

- Put product identity, audience, and non-goals in `moneyview-overview.md`.
- Put runtime and component boundaries in `moneyview-system-design.md`.
- Put request/response contracts and route side effects in `moneyview-api-reference.md`.
- Put canonical formulas, engine module definitions, and numerical constraints in `moneyview-quant-engine.md`.
- Put user-action-to-output execution paths in `data-flow.md`.
- Put local persistence ownership and seed/cache behavior in `storage-model.md`.
- Put command/query ownership, read-model adoption rules, and projection boundaries in `cqrs-read-write-separation.md`.
- Put KPI meaning and chart semantics in `visualization-metrics.md`.

If a concept appears in more than one document, keep one canonical explanation and link to it from the others.

## 7. Maintenance Rules

Update the docs when any of the following change:

- a public API route, schema, or response envelope changes
- a frontend-consumed shared contract in `packages/shared-types` changes
- a finance formula or engine module changes behavior
- canonical storage ownership changes between SQLite, cache files, seed files, or transient data
- a major workflow changes its execution path between frontend, backend, worker, and engine
- a KPI or chart changes its business meaning, filter rules, or source metric
- a module changes ownership between `apps/web`, `apps/api`, and `packages/core_finance`

Recent examples that must stay aligned across the canonical set:

- when a new route such as `GET /api/v1/corporate/metrics/{ticker}/audit` is added, update `moneyview-api-reference.md`
- when a workflow begins consuming that route for UI quality badges or drill-down panels, update `data-flow.md`
- when the payload changes the visible meaning of metric quality, warnings, or fallback state, update `visualization-metrics.md`
- when worker results require normalization or guard states before rendering, update both `data-flow.md` and `visualization-metrics.md`

## 8. Update Triggers By Source Area

Use this mapping to decide which docs need review after code changes:

| Code area changed | Docs to review |
| --- | --- |
| `apps/api/routes/`, `apps/api/models/`, `apps/api/schemas/` | `moneyview-api-reference.md`, `data-flow.md` |
| `apps/api/services/` | `moneyview-system-design.md`, `data-flow.md`, `storage-model.md` |
| `packages/core_finance/` | `moneyview-quant-engine.md`, `data-flow.md` |
| `packages/shared-types/` | `moneyview-api-reference.md`, `visualization-metrics.md`, `data-flow.md` when the contract changes workflow behavior |
| `apps/web/app/`, `apps/web/components/` | `visualization-metrics.md`, `data-flow.md`, module-specific notes |
| `scripts/start_local.ps1`, `run.cmd`, runtime boot logic | `moneyview-system-design.md`, `system-overview.md` |
| SQLite schema/storage behavior | `storage-model.md`, `data-flow.md`, `moneyview-api-reference.md` where relevant |

## 9. Source-Of-Truth Inputs

Architecture docs should be grounded in these sources first:

- `README.md`
- `guideline/file-structure.md`
- `apps/api/routes/`
- `apps/api/services/`
- `apps/api/models/` and `apps/api/schemas/`
- `packages/core_finance/`
- `packages/shared-types/`
- `apps/web/app/`
- `apps/web/components/`
- `tests/api/`
- `tests/core_finance/`

## 10. Documentation Quality Bar

The architecture set is in good shape when:

- a new reader can find the right document quickly
- each concept has one obvious home
- product scope, runtime design, API behavior, engine theory, and workflow pipelines do not contradict each other
- the docs describe the current system instead of an aspirational rewrite
- future agents can tell which document must be updated after a code change

## 11. Current Alignment Notes

The current documentation pass has already aligned these areas:

- `moneyview-api-reference.md` documents the corporate metric-audit route and its quality/source semantics
- `data-flow.md` documents metric-audit consumption in the Corporate pipeline and result normalization in the Monte Carlo pipeline
- `visualization-metrics.md` documents audit-quality badge meaning plus guard-driven Monte Carlo chart states

Near-term review priorities:

- keep `documentation-roadmap.md` in sync whenever a new canonical architecture file is added or ownership moves between existing files
- review `moneyview-api-reference.md`, `data-flow.md`, and `visualization-metrics.md` together whenever corporate metric quality or frontend guard behavior changes
