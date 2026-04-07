# Planner SOP

Purpose: convert high-level requirements into ordered, testable implementation steps.

## Read First

- User request or feature ticket
- `guideline/architect.md`
- `guideline/file-structure.md`
- Relevant source and tests

## Output

For substantial work, produce a plan with:

```text
Task ID | Description | Dependencies | Acceptance Criteria | Owner
```

## Rules

- Keep plans short enough to execute.
- Identify blockers before implementation.
- Put schema and invariant work before UI work.
- Put verification steps in the plan.
- Update the plan as work completes.

## Definition of Done

A task is done when:

- intended behavior is implemented
- relevant tests or checks pass
- docs/contracts are updated when needed
- residual risks are stated clearly
