# Refactor Cleaner SOP

Purpose: reduce complexity without changing behavior.

## Read First

- Existing tests and lint output
- Code paths affected by the refactor
- `guideline/sop/file-structure.md`
- `guideline/sop/code-reviewer.md`

## Refactor Rules

- Do not mix broad refactors with unrelated feature work.
- Preserve public API behavior unless a contract change is explicitly requested.
- Prefer functions for stateless logic and classes for stateful services.
- Use typed data objects when many related values travel together.
- Use `pathlib.Path` for filesystem paths.
- Use structured logging instead of `print`.
- Remove dead code, unused imports, and commented-out code.

## Verification

After refactoring:

- run targeted tests for affected modules
- run lint/type checks where available
- summarize any behavior intentionally left unchanged

## Stop Conditions

Stop and reassess when:

- tests start failing in unrelated areas
- the refactor crosses ownership boundaries
- the change requires a new architecture decision
