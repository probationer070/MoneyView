# Work Harness

Purpose: the one procedure every coding task follows, from intake to records. It sets
the order of work, who does each stage (model routing), and where the owner decides.
It does not repeat the SOPs. It sends you to them. Start a task by copying
[`templates/work-card.md`](templates/work-card.md).

## Stages

| # | Stage | Content | Artifact | Model | Gate |
|---|---|---|---|---|---|
| 0 | Intake | purpose, who, what decision, success criteria | work card §1 | - | - |
| 1 | Design | design, DATA DEFINITION, interfaces, out-of-scope | spec / work card §2-5 | Opus if complex, else Sonnet | OWNER APPROVAL |
| 2 | Plan | tasks, tests, mutation matrix | plan | Sonnet; Opus if architectural | - |
| 3 | Existing-test changes | inventory of existing assertions that must change: file:line, old, new, why | inventory | Sonnet | OWNER APPROVAL |
| 4 | Implement | RED first, then GREEN; mutation matrix | commits + report | Haiku | - |
| 5 | Task review | spec + quality | review | Sonnet | fix round if Important |
| 6 | Controller verification | the controller re-runs one mutation itself and looks at screenshots | ledger line | controller | - |
| 7 | Final review | intent, integration, money-impact risks, regressions | review | Opus | - |
| 8 | Acceptance | owner looks at captures; merge | - | - | OWNER APPROVAL |
| 9 | Records | `ERROR-LOG.md` (confirmed bugs), `todo.md`, docs, memory | - | Sonnet | - |

```text
0 Intake -> 1 Design --[owner]--> 2 Plan -> 3 Test inventory --[owner]--> 4 Implement
   -> 5 Task review -> (fix round?) -> 6 Controller check   (4-6 repeat per task)
   -> 7 Final review -> 8 Acceptance --[owner]--> merge -> 9 Records
```

Detail per stage: design in [`sop/architect.md`](sop/architect.md), plan in
[`sop/planner.md`](sop/planner.md), tests in
[`sop/test-verification.md`](sop/test-verification.md), reviews in
[`sop/code-reviewer.md`](sop/code-reviewer.md), records in
[`sop/build-error-resolver.md`](sop/build-error-resolver.md) and
[`sop/todo.md`](sop/todo.md). Which SOP for which change: the matrix in
[`../.claude/CLAUDE.md`](../.claude/CLAUDE.md) §5.

## Plan rule (stage 2, mandatory, owner 2026-10-15)

**No function without a declared output contract.** A plan written by any model must,
for every function, method, endpoint and component it introduces or changes, fill the
"Output contract" table in [`templates/work-card.md`](templates/work-card.md) §5:

- return type or shape (exact TS type or Python annotation; field names for objects);
- units and scale (fraction vs percent, currency, decimals) and the exact string format, e.g. `+14.3%`, `—` for missing;
- every case: normal, empty, missing/null, error, refused, and what each returns or renders;
- one concrete example, input to output;
- side effects: DB writes, network requests, state changes, rendered DOM (testids and text).

**Plan reviewer checklist:** reject any plan task whose interfaces lack an output contract.

## Model routing

| Model | Use for |
|---|---|
| Opus 5.5 | complex design, architecture, root-causing hard bugs, final whole-branch review, the controller |
| Sonnet 5.5 | moderate work: per-task review, plans for code-only work, research and analysis, docs |
| Haiku 5.5 | writing code from a plan |

Never hand a whole implementation plan to one Opus agent to execute. The controller
dispatches one task at a time. Verify by execution, not by an agent's report
([`sop/test-verification.md`](sop/test-verification.md)).

## Where each artifact lives

| Artifact | Location |
|---|---|
| Work card (small tasks) | the task's PR description or `.superpowers/sdd/<plan>/` |
| Spec | `docs/superpowers/specs/<date>-<topic>-design.md` |
| Plan (tasks, inventory, mutation matrix) | `docs/superpowers/plans/<date>-<topic>.md` |
| Ledger and task reports | `.superpowers/sdd/<plan>/progress.md`, `task-N-report.md` |
| Confirmed bugs | `ERROR-LOG.md` (template at its top) |
| Active tracks | [`sop/todo.md`](sop/todo.md) |
| Doc map | [`../docs/INDEX.md`](../docs/INDEX.md) |
| Memory | `MEMORY.md` index in the Claude project memory folder |

## Test scope (owner, 2026-10-15)

Run what the change can break, and run everything at the gates.

| When | Run |
|---|---|
| Each task (default) | New and changed tests; the specs for the area touched (e.g. `app/corporate/**` → `corporate-*.spec.ts`, `refresh-idle-state`, `terminal-diagnostics`, `high-risk-render-regression`, `tab-state-persistence`, `responsive-accessibility`); `typecheck`; `lint`. Backend: that module's `pytest` files. |
| Each task, if a shared surface changed | The full suite. Shared surfaces: `components/ui/**` (AppShell, TopNav, Tabs, PageHeader, TickerSearch), `lib/format.ts`, `lib/chartConfig.ts`, `lib/tabState.ts`, `app/layout.tsx`, `tokens/**`, `apps/api/services/db.py`, `records_sync/**`. |
| Fix rounds | The tests the fix touches and that area's specs. |
| End of plan, before merge, before PR | The full suite, always (Playwright and `pytest`). |

Pick area specs by grepping `tests/e2e` for the route and the component names you changed. List the specs you ran in the report.

## Light path

A small, bounded fix (one file, no interface change) may skip stages 1-3. It still
needs a test shown to fail first, and a mutation check unless
[`sop/test-verification.md`](sop/test-verification.md) "When This Is Overkill" applies. Features, new structure,
schema or sync changes go through every stage.

## Fixed rules

| Rule | Source |
|---|---|
| Never edit an existing test assertion without owner approval. | stage 3; "Existing-test change inventory" in each plan |
| A passing test is not evidence. Show it fails for the defect it guards. | [`CLAUDE.md`](../.claude/CLAUDE.md) §8, [`sop/test-verification.md`](sop/test-verification.md) |
| One Playwright run at a time on this PC (ports 3101/8110). Kill leftovers first. | [`docs/git-worktrees.md`](../docs/git-worktrees.md) |
| Parallel work goes in separate git worktrees. Backend uses pytest only. Read-only analysis writes to a scratchpad. | [`docs/git-worktrees.md`](../docs/git-worktrees.md) |
| Never use `git stash`, `checkout --` restores or `--no-verify`. Mutate Python in memory (monkeypatch) as `sop/test-verification.md` requires; where that is impossible (TS components, Playwright), back the file up, edit it, restore the original bytes and prove it with `cmp`, never with git. | [`sop/test-verification.md`](sop/test-verification.md) step 5 |
| Never read `config/.env` or apikey files. Tests never write to `data/processed/moneyview.db`. | [`sop/security-reviewer.md`](sop/security-reviewer.md) |
| Shown value = used value: the UI never displays a number different from what the computation used. | [`sop/finance-logic.md`](sop/finance-logic.md) |
| Korean UI copy uses the formal register (합니다체/십시오체). Glossary rows go in the glossary. | [`docs/design/MoneyView_Glossary.md`](../docs/design/MoneyView_Glossary.md) |
| Design tokens only. `rounded-full` only on a dot, track, fill or spinner, marked with its comment (see [`DESIGN.md`](../DESIGN.md)). Figures use `type-mono` and `formatNumber`. No `waitForTimeout`; wait on conditions. | [`docs/design/MoneyView_Design_Tokens.md`](../docs/design/MoneyView_Design_Tokens.md) |
| Every page in `ONE_SCREEN_ROUTES` fits 1280x720 with no page scroll. The goal is every page, rolled out page by page. | [`sop/todo.md`](sop/todo.md) (Track D) |

## How to start a task

1. Copy [`templates/work-card.md`](templates/work-card.md) and fill §1 (stage 0).
2. Pick the path: light, or every stage. Say which in the card header.
3. For any new table or payload, fill [`templates/data-definition.md`](templates/data-definition.md)
   (or work card §4). Existing tables: [`docs/architecture/database-relationships.md`](../docs/architecture/database-relationships.md).
4. Do not start stage 4 before the gates in stages 1 and 3 are recorded in §9 of the card.
