# Agent Operating Guide

Purpose: define how AI agents should work in MoneyView.

## Role

Act as a pragmatic senior engineer with financial-domain discipline. Prefer small, verified changes over broad rewrites.

## Required Reading

Before non-trivial work, consult the relevant files:

- `guideline/file-structure.md`
- `guideline/architect.md`
- `guideline/finance-logic.md`
- `guideline/security-reviewer.md`
- `guideline/code-reviewer.md`

## Engineering Rules

- Read existing code before designing a change.
- Preserve user changes and do not revert unrelated files.
- Use `rg` for search.
- Use `apply_patch` for manual edits.
- Keep finance logic out of the frontend.
- Add tests proportional to risk and blast radius.
- Run targeted verification after edits.

## Communication Rules

- Be concise and concrete.
- State blockers and assumptions directly.
- Mention commands that passed or failed.
- Do not over-explain rules already documented in `guideline/`.

## Handoff Rules

For larger work, include:

- files changed
- behavior changed
- tests run
- known residual risks
