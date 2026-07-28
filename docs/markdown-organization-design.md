# Design — Markdown Organization And Foreign-Content Cleanup

Date: 2026-06-08
Status: Approved

## Problem Summary

MoneyView's markdown is spread across `docs/`, `guideline/`, root, and agent-config
files with three concrete problems:

1. **Foreign content**: `docs/changelog/`, `docs/error/`, `docs/superpowers/`,
   and `.agents/` are untracked directories containing material from an unrelated
   Astro-based blog project (paths like `src/components/Header.astro`,
   `astro:page-load`, "Study Card" — none of which exist in MoneyView, a
   FastAPI + Next.js + SQLite app). `.claude/CLAUDE.md` is similarly templated
   from a different project ("active project is P4 (AI Chatbot)", an
   AWS/Terraform/IAM agent-orchestration matrix that doesn't apply here).
2. **Duplicated tab docs**: `docs/{corporate-analysis-tab,monte-carlo-tab,
   portfolio-tab}.md` duplicate `docs/tabs/*.txt` with different, likely-stale
   content — an abandoned parallel effort.
3. **Mixed-purpose `guideline/`**: 12 MoneyView-specific SOPs sit alongside 4
   generic engineering guides that aren't project-specific, with no separation.

There is also no single entry point that tells a future agent (or person) what
markdown exists, where, and which copy is canonical.

## A. Cleanup

- Delete `docs/changelog/`, `docs/error/`, `docs/superpowers/`, `.agents/` —
  foreign content, all untracked, safe to remove.
- Rewrite `.claude/CLAUDE.md`: keep the generic good-practice sections
  (think-before-coding, simplicity, surgical changes, goal-driven execution —
  these are project-agnostic and useful), but replace the parts that reference
  things that don't exist in MoneyView:
  - "Agent Orchestration" (pointing at deleted `.agents/` + an AWS/Terraform/IAM
    matrix) → point at `guideline/sop/*.md`
  - "active project is P4 (AI Chatbot)" → MoneyView framing
  - "Change Logging" / "Error Recording" (pointing at deleted `docs/changelog/`
    and `docs/error/`) → point at MoneyView's actual mechanisms
    (`ERROR-LOG.md`, `guideline/sop/todo.md`)

## B. `docs/` Reorganization

- `docs/architecture/`, `docs/design/` — unchanged (already canonical, governed
  by `docs/architecture/documentation-roadmap.md`)
- `docs/tabs/*.txt` — kept as the canonical tab reference (per its own
  `index.txt` mandate to consolidate tab docs)
- `docs/{corporate-analysis-tab,monte-carlo-tab,portfolio-tab}.md` → moved to
  `docs/archive/` (superseded duplicates, preserved not deleted)
- `docs/{api-usage,dcf-valuation,risk-return-minard,
  moneyview-analysis-and-improvements}.md` — left in place; labeled in the new
  index as supplementary topic notes (no canonical-set counterpart)

## C. `guideline/` Split

- `guideline/sop/` — the 12 MoneyView-specific process docs: `architect.md`,
  `build-error-resolver.md`, `code-reviewer.md`, `file-structure.md`,
  `finance-logic.md`, `GEMINI.md`, `harness-optimizer.md`, `planner.md`,
  `refactor-cleaner.md`, `security-reviewer.md`, `todo.md`, `suggestion.md`
- `guideline/reference/` — the 4 generic engineering guides:
  `12 steps of Production Preparation.md`, `CQRS Architecture.md`,
  `python-dataClass.md`, `Refactoring for Solving Complicate Spaghetti codes.md`
- Update every cross-reference to the moved SOP paths (`guideline/X.md` →
  `guideline/sop/X.md`) in: `AGENTS.md`, `apps/api/AGENTS.md`,
  `apps/web/AGENTS.md`, `ERROR-LOG.md`, `docs/architecture/
  documentation-roadmap.md`, `docs/architecture/dev-monitor-backend-foundation.md`,
  `docs/dcf-valuation.md`, and the SOP files' own internal cross-links
  (`architect.md`, `planner.md`, `code-reviewer.md`, `refactor-cleaner.md`,
  `GEMINI.md`, `todo.md`, `build-error-resolver.md`).
- `data/md/*` files also reference `guideline/suggestion.md` etc., but that
  zone is explicitly out of scope (scratch/session dumps) — left untouched.

## D. Master Index

- New file `docs/INDEX.md` — single entry point mapping every doc zone
  (architecture, design, tabs, archive, supplementary notes, guideline/sop,
  guideline/reference, root agent files) → purpose → when to read it, in the
  same table style as `docs/architecture/system-overview.md`.
- `AGENTS.md` and `.claude/CLAUDE.md` each get one line pointing to
  `docs/INDEX.md` as the documentation map.

## Out Of Scope

- `data/md/` (todo log1–19, suggestion cp1–7, todo for docs.md) — scratch/session
  dumps, explicitly excluded by the user.
- `docs/architecture/`, `docs/design/`, `docs/tabs/` content — already canonical,
  not restructured, only referenced from the new index.
- `.claude/skills/`, `.claude/settings*.json` — normal Claude Code config, not
  MoneyView documentation.

## Verification

- `git status` shows the foreign untracked directories gone and no unintended
  deletions of tracked files.
- `rg "guideline/(architect|build-error-resolver|code-reviewer|file-structure|finance-logic|GEMINI|harness-optimizer|planner|refactor-cleaner|security-reviewer|suggestion|todo)\.md"` 
  inside in-scope files returns only `guideline/sop/...` paths (excluding `data/md/`).
- `docs/INDEX.md` link targets all resolve to real files.
