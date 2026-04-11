# Planner SOP

Purpose: convert high-level requirements into ordered, testable implementation steps.

## Read First

- User request or feature ticket
- `guideline/architect.md`
- `guideline/file-structure.md`
- Relevant source and tests
- check `guideline/todo.md` for existing tasks

## Output

For substantial work, produce a plan with:

```text
Task ID | Description | Dependencies | Acceptance Criteria | Owner
```

Also produce a short execution checklist when the work spans backend, frontend, DB, or docs:

```text
- current state
- target behavior
- data/contracts affected
- implementation order
- verification steps
```

## Rules

- Keep plans short enough to execute.
- Identify blockers before implementation.
- Put schema and invariant work before UI work.
- Prefer the database or persisted contract as the source of truth when a feature touches UI state and backend state.
- Treat fallback data as bootstrap-only unless the user explicitly wants generated defaults to overwrite persisted state.
- Separate plan items by layer when needed: backend, frontend, persistence, migration/seed, docs, verification.
- Call out missing seed files, missing env/config, or legacy fallback paths before implementation.
- Put verification steps in the plan.
- Update the plan as work completes.

## Execution Checklist Guidance

When writing the checklist:

- Start with what is broken now.
- State what must remain unchanged.
- List each mutation path explicitly when data can be created, updated, or deleted.
- Include failure and empty-state behavior, not only happy paths.
- Keep each item actionable enough to implement directly.

Example:

```text
- current state: portfolio page reads watchlist but no seed file exists
- target behavior: portfolio works with DB-backed holdings and safe default seed data
- data/contracts affected: GET/POST/DELETE watchlist endpoints, watchlist table, frontend query cache
- implementation order: backend fallback -> backend delete -> frontend add/delete -> verification
- verification steps: empty DB bootstrap, add holding, delete holding, reload persistence
```

## Definition of Done

A task is done when:

- intended behavior is implemented
- relevant tests or checks pass
- docs/contracts are updated when needed
- residual risks are stated clearly
- update `guideline/todo.md` with new tasks
- check `guideline/security/` for security issues and update if needed
- update `guideline/security-review.md` if needed
