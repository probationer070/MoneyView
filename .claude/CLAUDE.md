# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. SOP Consultation

**Consult the right SOP before and after every change.**

MoneyView's process specifications live in `guideline/sop/`. Each file defines a
focused checklist for one concern. Read the relevant SOP(s) before starting a
task, then run its checklist against your changes before committing. Generic
(non-project-specific) engineering references live in `guideline/reference/`.

The active project is **MoneyView**, a local-first financial analytics workspace
(FastAPI backend in `apps/api`, Next.js frontend in `apps/web`, shared finance
engine in `packages/core_finance`). Start at `docs/INDEX.md` for a map of every
documentation file in the repo — architecture, design, tabs, SOPs, and more.

**Decision matrix — which SOPs to consult:**

| Change Type | SOPs to Consult |
|-------------|-----------------|
| New design or implementation plan | `guideline/sop/architect.md`, `guideline/sop/planner.md` |
| Finance formula or engine module change | `guideline/sop/finance-logic.md` |
| File moves, new modules, ownership changes | `guideline/sop/file-structure.md` |
| Build/test/lint failure | `guideline/sop/build-error-resolver.md` |
| New or changed test, especially one asserting a label/source/attribution | `guideline/sop/test-verification.md` |
| Secrets, local data, generated reports, financial integrity | `guideline/sop/security-reviewer.md` |
| Reducing complexity without changing behavior | `guideline/sop/refactor-cleaner.md` |
| Pre-commit / final quality gate | `guideline/sop/code-reviewer.md` |
| Active task tracking | `guideline/sop/todo.md` |

## 6. Change Tracking

MoneyView tracks active work in `guideline/sop/todo.md` rather than per-change
log files. When you start or complete a significant change, update the relevant
track in that file so the next session has context without needing git blame.

## 7. Error Recording

**Confirmed bugs get a record in `ERROR-LOG.md`** (repo root).

Write a record when:
- A bug caused incorrect behavior in any environment (local, dev, or prod)
- A silent failure was discovered (wrong output, wrong data, no error raised)
- A test caught a regression introduced by a code change

Follow the template at the top of `ERROR-LOG.md`: Date, Command, Failure, Root
cause, Fix, Files changed, Prevention. `guideline/sop/build-error-resolver.md`
defines when and how to write the entry.

**This is working if:** the same class of bug never appears twice without a
prior `ERROR-LOG.md` entry that should have prevented it.

## 8. Test Verification

**A passing test is not evidence that the test works.**

A test can pass because the code is correct, or because the test never reaches
what it claims to check. A green run does not distinguish those. Before
reporting a test as verified, break the source so the defect it targets is
present, and confirm the test FAILS for the intended reason. Then restore the
source. `guideline/sop/test-verification.md` defines the procedure and when it
may be skipped.

Two rules follow from it and are not negotiable:

- **Never say a test is verified on the strength of a passing run.** Name the
  mutation it was shown to catch, or call it unverified. "All tests pass"
  answers a different question than "this test works".
- **The gate does not depend on who wrote the code.** Whether a contributor or
  any given model at any given version produced it, competence is not
  observable from inside this repo and can change without notice -- a model
  that has misread the task reports success in the same tone as one that has
  not. So the check is executed, not trusted: a test that fails the mutation
  matrix is bad no matter who wrote it, and one that passes is good no matter
  who wrote it.

**This is working if:** no test in this repo is trusted on the basis of having
been observed passing, and every attribution-asserting test can name the broken
implementation it was shown to reject.