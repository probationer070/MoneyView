# Harness Optimizer SOP

Purpose: keep agent sessions focused, token-efficient, and recoverable.

## Context Rules

- Read only files needed for the task.
- Prefer targeted `rg` searches over broad file dumps.
- Summarize long documents instead of repeatedly copying them into context.
- Reference guideline files by name instead of reprinting their full contents.

## Work Rules

- Split large tasks into clear phases: inspect, edit, verify, report.
- Prefer one source of truth for contracts and schemas.
- Avoid redundant parallel investigations.
- Keep final responses focused on outcome, verification, and residual risk.

## Compaction Handoff

When context is high or work is interrupted, preserve:

- current user goal
- files already changed
- commands already run
- failing commands and exact error summaries
- remaining concrete tasks
