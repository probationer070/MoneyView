# Architect SOP

Purpose: define the technical design before implementation and keep MoneyView's Python/TypeScript/Rust boundaries clear.

## Read First

- `guideline/file-structure.md`
- `guideline/finance-logic.md`
- Existing route, service, schema, and package files related to the task
- Existing tests for the affected area

## Deliverables

For non-trivial features, create or update a design note under `docs/architecture/`.

Each design note should include:

1. Component map: what belongs in `apps/web`, `apps/api`, `packages/core_finance`, and future `packages/simulation-rs`.
2. Data flow: source data, service layer, API contract, frontend adapter, visualization/report output.
3. API contracts: request and response schemas, including version fields when needed.
4. Performance strategy: NumPy/Pandas for normal vectorized workloads; Rust only after a measured bottleneck.
5. Storage and cache impact: SQLite tables, data files, cache keys, invalidation rules.
6. Risk controls: financial invariants, data-quality behavior, and test strategy.

## Design Rules

- Do not put financial formulas in `apps/web`.
- Keep route handlers thin; business logic belongs in services or packages.
- Keep reusable financial primitives in `packages/core_finance` when they are not API-specific.
- Keep frontend chart adapters separate from backend domain models.
- Update `packages/shared-types` when API contracts are consumed directly by TypeScript.
- Document any deliberate deviation from the canonical structure.
