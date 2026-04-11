# MoneyView Agent Rules

Use this file for repo-wide behavior. More specific `AGENTS.md` files in subdirectories override or extend these rules for their subtree.

## Primary Workflow

- Build context before editing. Start with `rg --files`, `rg`, and targeted file reads.
- Read `guideline/file-structure.md` before proposing file moves, new modules, or ownership changes.
- Keep route handlers thin, frontend logic in `apps/web`, and business logic in backend services or shared packages.
- Prefer targeted verification first, then broader verification.

## File Structure Reading

- When asked to understand the repo, identify the owning layer first: `apps/api`, `apps/web`, `packages`, `tests`, `guideline`, or `docs`.
- For structure questions, prefer concise maps of responsibilities over file-by-file dumps.
- Use existing docs before inferring architecture from scattered implementation details:
  - `guideline/file-structure.md`
  - `docs/architecture/`
  - relevant local `AGENTS.md`

## Code Review

- Default to a review mindset when the user asks for a review.
- Findings come first.
- Focus on bugs, regressions, risky assumptions, contract mismatches, missing tests, and incorrect ownership boundaries.
- Order findings by severity and include file/line references.
- Keep summary and change overview secondary.

## Subagent Guidance

- Use `explorer` agents for bounded codebase reading tasks such as file structure analysis, ownership tracing, and finding where a feature lives.
- Use `worker` agents for bounded implementation tasks with a clear write scope.
- Do not spawn subagents unless the user explicitly asks for delegation, subagents, or parallel agent work.

## Recommended Defaults

- File structure reading:
  - agent type: `explorer`
  - model: `gpt-5.4-mini`
  - reasoning: `medium`
- Code review:
  - agent type: `explorer` or main agent
  - model: `gpt-5.4`
  - reasoning: `high`
- Small bounded implementation:
  - agent type: `worker`
  - model: `gpt-5.4-mini`
  - reasoning: `medium`
- Complex cross-cutting implementation:
  - agent type: `worker` or main agent
  - model: `gpt-5.4`
  - reasoning: `high`

## Command Preferences

- Prefer `rg` over slower search tools.
- On this Windows PowerShell workspace, prefer `npm.cmd` when `npm.ps1` is blocked by execution policy.
- Do not use destructive git commands unless explicitly requested.

## Verification

- Run the narrowest relevant lint/test command for the files you changed.
- Do not mark work complete while required verification is still failing.
- Do not silence lint or test failures without documenting the reason.

## Explanation Requirement

- Whenever fixing code or resolving errors, always include an explanation of how the issue was resolved.
