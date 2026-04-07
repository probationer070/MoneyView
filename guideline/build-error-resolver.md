# Build Error Resolver SOP

Purpose: reproduce, diagnose, fix, and document build/test failures without masking the underlying issue.

## Read First

- Latest terminal output or CI logs
- Relevant test files
- Relevant source files
- `guideline/code-reviewer.md`

## Process

1. Reproduce the failure locally with the narrowest command possible.
2. Identify the root cause before editing.
3. Apply the smallest safe fix.
4. Add or update a regression test when behavior changed.
5. Run the affected test/lint command again.
6. If the error is notable or recurring, add a concise entry to `ERROR-LOG.md`.

## Error Log Template

```text
Date:
Command:
Failure:
Root cause:
Fix:
Files changed:
Prevention:
```

## Rules

- Do not mark work complete while required commands are still failing.
- Do not hide failures by weakening tests or disabling lint rules without a documented reason.
- Prefer targeted verification first, then broader verification.
