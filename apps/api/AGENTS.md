# MoneyView API Rules

Apply the repo-root `AGENTS.md` first, then these API-specific rules.

## Read Before Editing

- `guideline/file-structure.md`
- `guideline/architect.md`
- `guideline/build-error-resolver.md`
- `guideline/finance-logic.md`
- relevant notes under `docs/architecture/`

## Ownership

- `apps/api/routes` owns HTTP concerns only: request parsing, status codes, and response shaping.
- `apps/api/services` owns orchestration, data access, cache behavior, report generation, and backend workflows.
- `apps/api/models` owns Pydantic request and response schemas.
- `apps/api/core` owns backend-local middleware, logging, and helpers that are not shared finance primitives.
- Move reusable financial logic to `packages/core_finance` when it is not API-specific.

## Implementation Rules

- Keep route handlers thin.
- Prefer extending existing services before creating new top-level patterns.
- Preserve the API envelope shape when the frontend expects `APIResponse[data]`.
- If an endpoint contract changes and TypeScript consumes that contract directly, update `packages/shared-types`.
- Document cache invalidation and storage impact for non-trivial endpoint changes.

## Verification

- Prefer narrow backend verification first: targeted tests for the route, service, or schema you changed.
- Add or update regression coverage when endpoint behavior or validation changes.
- Do not mark backend work complete while the relevant tests are still failing.
