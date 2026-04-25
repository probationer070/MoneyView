# System Overview

This document is the architecture entry point for MoneyView. Read it first to understand the documentation set, then continue into the product, system, API, engine, and workflow documents as needed.

## What MoneyView Is

MoneyView is a local-first financial analysis platform built as a single-user workspace. It combines a Next.js frontend, a FastAPI backend, a Python finance engine, SQLite-backed local persistence, and browser-worker simulation flows into one localhost runtime.

## Canonical Architecture Set

Use the following files as the canonical architecture set under `docs/architecture/`:

| Document | Role | Read when you need |
| --- | --- | --- |
| `moneyview-overview.md` | Product identity, scope, users, boundaries, non-goals, and glossary | product framing and system-boundary questions |
| `moneyview-system-design.md` | Runtime architecture, component relationships, communication rules, and reliability limits | system structure and runtime understanding |
| `moneyview-api-reference.md` | API contract across active route families | endpoint, payload, and orchestration questions |
| `moneyview-quant-engine.md` | Canonical finance-engine specification | formulas, theory, and numerical-convention questions |
| `data-flow.md` | End-to-end workflows and calculation pipelines | how data and computation move through the system |
| `storage-model.md` | Local persistence, cache, and source-of-truth rules | SQLite, files, seeds, retention, and cache questions |
| `visualization-metrics.md` | KPI, chart, and metric semantics | graph meaning, filters, and ownership of metric meaning |
| `documentation-roadmap.md` | Documentation structure, writing order, and maintenance rules | planning future documentation work |

## How To Use This Set

Read across the set by ownership boundary rather than by feature name:

- use `moneyview-api-reference.md` when a question is about routes, payloads, response envelopes, shared contracts, or route side effects
- use `data-flow.md` when a question is about how a user action turns into backend work, worker execution, persistence reads/writes, or UI state transitions
- use `visualization-metrics.md` when a question is about what a KPI means, why a badge/warning is visible, or when a chart should render `empty`, `invalid-data`, or a valid view
- use `documentation-roadmap.md` when a change touches more than one of those boundaries and you need to know which docs must move together

## Current Runtime Components

- `apps/api`: FastAPI backend for data access, finance calculations, attribution, reporting, and validation.
- `apps/web`: Next.js frontend for interaction, visualization, browser-driven downloads/print, and worker-local simulation flows.
- `packages/core_finance`: reusable Python finance primitives that are not API-specific.
- `packages/shared-types`: generated TypeScript contracts derived from backend Pydantic schemas.
- `data`: local SQLite/data lake/cache storage. Runtime data is not committed.
- `config`: environment templates and local-only secrets.

## Quick Ownership Map

- `Portfolio` is the backend-heavy workflow for watchlist state, saved weights, implied cash, attribution, report export, and persisted comparison snapshots.
- `Corporate Analysis` is the ticker-centric workflow for live assumption tuning, backend DCF requests, diagnostics, live cross-stock comparison, and audit-qualified valuation metrics.
- `Simulation Lab` is primarily frontend-compute and worker-driven for path simulation, risk analysis, return distribution, valuation uncertainty, and correlation experiments, with page-level normalization between raw worker output and rendered chart state.

## Current Cross-Document Alignment

The current architecture set is intended to stay aligned on these recent responsibilities:

- the corporate metric-audit route belongs to `moneyview-api-reference.md` as an API contract
- the fact that Corporate and Portfolio flows consume that audit payload belongs to `data-flow.md`
- the visible meaning of audit quality badges, warnings, and fallback state belongs to `visualization-metrics.md`
- Monte Carlo worker result normalization and guard-driven chart states are split between `data-flow.md` for execution flow and `visualization-metrics.md` for rendering semantics

## Boundary Rules

- Backend Pydantic models are the source of truth for API contracts.
- Frontend TypeScript types are generated or mirrored from backend schema exports.
- No canonical financial formulas belong in `apps/web`.
- Reproducible report rendering belongs behind `apps/api`.
- Frontend chart adapters may reshape domain payloads for visualization, but they do not redefine financial methodology.
- Frontend worker-local simulation logic is acceptable when the workflow is exploratory, browser-contained, and does not require backend persistence.
- Shared contract changes that affect both backend and frontend should be reviewed across `packages/shared-types`, `moneyview-api-reference.md`, `data-flow.md`, and `visualization-metrics.md` together rather than updated in isolation.
