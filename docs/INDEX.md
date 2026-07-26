# Documentation Index

This is the entry point for every markdown document in MoneyView. Use it to find
the right file before searching the tree — each concept should have one obvious
home. For deep architecture reading order, continue into
[`architecture/system-overview.md`](architecture/system-overview.md) once you've
located the right zone here.

## Architecture (`docs/architecture/`)

Canonical system documentation. Governed by
[`documentation-roadmap.md`](architecture/documentation-roadmap.md) — read that
file before adding or moving any architecture doc.

| Document | Role |
| --- | --- |
| `system-overview.md` | Architecture entry point and reading guide |
| `moneyview-overview.md` | Product identity, scope, users, boundaries, glossary |
| `moneyview-system-design.md` | Runtime architecture, component boundaries, reliability limits |
| `moneyview-api-reference.md` | API contract, route families, request/response behavior |
| `moneyview-quant-engine.md` | Canonical finance-engine specification and formulas |
| `data-flow.md` | End-to-end workflows and calculation pipelines |
| `storage-model.md` | SQLite, file cache, seed artifacts, retention rules |
| `cqrs-read-write-separation.md` | Command/query ownership and projection boundaries |
| `visualization-metrics.md` | KPI and chart semantics, ownership of metric meaning |
| `documentation-roadmap.md` | Documentation structure, writing order, maintenance rules |
| `app-blueprint.md`, `system-overview.md`, `local-first-runtime.md`, `dcf-streaming.md`, `dev-monitor-backend-foundation.md`, `schema-evolution.md`, `api-transport-observability.md`, `cache-ownership-invalidation.md` | Supporting design notes for specific subsystems and past planning tracks |

## Design (`docs/design/`)

Visual and interaction design specification — tokens, components, charts, page
wireframes, and the spec addendum. Read when working on frontend layout,
styling, or interaction behavior.

| Document | Role |
| --- | --- |
| `MoneyView_Design_Tokens.md` | Color, spacing, typography tokens |
| `MoneyView_Component_System.md` | Reusable component inventory and contracts |
| `MoneyView_Chart_System.md` | Chart types, states, and rendering rules |
| `MoneyView_Interaction_Rules.md` | Interaction and behavior conventions |
| `MoneyView_Page_Wireframes.md` | Page-level layout wireframes |
| `MoneyView_Spec_Addendum.md` | Addenda and clarifications to the above |

## Tabs (`docs/tabs/`)

**Canonical** user-facing tab reference — identity, route, purpose, layout,
behavior, and data sources for each top-level sidebar tab. See
[`tabs/index.txt`](tabs/index.txt) for the full file list and coverage notes.

## Archive (`docs/archive/`)

Superseded documents preserved for history. `corporate-analysis-tab.md`,
`monte-carlo-tab.md`, and `portfolio-tab.md` here are an earlier, abandoned
parallel effort at tab documentation — **do not use as reference**; the
canonical versions are in `docs/tabs/`.

## Supplementary Notes (`docs/`)

Standalone topic notes that aren't part of the canonical architecture set and
have no `docs/tabs/` counterpart. Useful for deep dives on a specific subject,
but check `docs/architecture/` first for the authoritative system description.

| Document | Topic |
| --- | --- |
| `api-usage.md` | Backend API usage walkthrough and examples |
| `local-run-resources.md` | Measured RAM/CPU cost of `run MoneyView`, the `/dev/*` tool URLs and the flag they need, and operational hazards |
| `dcf-valuation.md` | DCF valuation methodology, user-facing explanation |
| `risk-return-minard.md` | Risk-Return Minard calculation and limitations |
| `moneyview-analysis-and-improvements.md` | Historical analysis and improvement notes |
| `markdown-organization-design.md` | Design spec for this documentation reorganization |

## Design Specs (`docs/superpowers/specs/`)

Dated design specs produced by the brainstorming workflow, each covering one
sub-project and feeding an implementation plan.

| Spec | Topic |
| --- | --- |
| `2026-07-25-perf-instrumentation/` | Performance instrumentation, analysis API, perf dashboard, and baseline runner (sub-project 1 of 4) |
| `2026-07-27-data-acquisition-design.md` | Data acquisition registry, per-class freshness boundaries, incremental backfill, and provider recommendations (sub-project 2 of 4) |

## Process SOPs (`guideline/sop/`)

MoneyView-specific operating procedures for AI agents and contributors. Read
the relevant SOP before starting non-trivial work; see the decision matrix in
[`.claude/CLAUDE.md`](../.claude/CLAUDE.md) for which SOP applies to which
change type.

| Document | Purpose |
| --- | --- |
| `GEMINI.md` | Top-level agent operating guide and required-reading list |
| `architect.md` | Technical design before implementation |
| `planner.md` | Convert requirements into ordered, testable steps |
| `file-structure.md` | Canonical repository structure and ownership |
| `finance-logic.md` | Financial modeling standards |
| `code-reviewer.md` | Final quality gate — correctness, security, performance |
| `security-reviewer.md` | Secrets, local data, generated reports, financial integrity |
| `refactor-cleaner.md` | Reduce complexity without changing behavior |
| `build-error-resolver.md` | Reproduce, diagnose, fix, and document build/test failures |
| `harness-optimizer.md` | Keep agent sessions focused and token-efficient |
| `suggestion.md` | DCF valuation critique and remediation source |
| `todo.md` | Active development-track tracking |

## Generic References (`guideline/reference/`)

General engineering material that isn't MoneyView-specific — background reading,
not project conventions.

| Document | Topic |
| --- | --- |
| `12 steps of Production Preparation.md` | Production-readiness checklist |
| `CQRS Architecture.md` | CQRS pattern theory |
| `python-dataClass.md` | Advanced Python dataclass patterns |
| `Refactoring for Solving Complicate Spaghetti codes.md` | General refactoring strategy |

## Root & Agent Entry Points

| File | Purpose |
| --- | --- |
| `README.md` | Project overview and quick links |
| `AGENTS.md` | Repo-wide agent behavior rules |
| `apps/api/AGENTS.md`, `apps/web/AGENTS.md` | Per-app agent rules (extend root `AGENTS.md`) |
| `.claude/CLAUDE.md` | Claude-specific operating guidelines and SOP decision matrix |
| `ERROR-LOG.md` | Confirmed-bug record (see `guideline/sop/build-error-resolver.md`) |

## Out Of Scope For This Index

`data/md/` contains scratch session logs and suggestion drafts (`todo log*.md`,
`suggestion cp*.md`) — working notes, not reference documentation. They are not
indexed here and should not be treated as canonical sources.
