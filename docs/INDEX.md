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
| `database-relationships.md` | Table inventory, declared and logical references, write/refresh order, lifecycle, known gaps |
| `cqrs-read-write-separation.md` | Command/query ownership and projection boundaries |
| `visualization-metrics.md` | KPI and chart semantics, ownership of metric meaning |
| `documentation-roadmap.md` | Documentation structure, writing order, maintenance rules |
| `app-blueprint.md`, `system-overview.md`, `local-first-runtime.md`, `dcf-streaming.md`, `dev-monitor-backend-foundation.md`, `schema-evolution.md`, `api-transport-observability.md`, `cache-ownership-invalidation.md` | Supporting design notes for specific subsystems and past planning tracks |
| `watchlist-cleanup-and-corporate-sync.md` | Addendum: deferred cleanup of a removed ticker's caches (30-day grace; `corporate_statements` kept), corporate records-sync kinds, two-PC rollout and PR #67 merge conflicts |
| `news-crawling-guide.md` | Reference note for news crawling: Google News RSS limits measured 2026-10-25 (100 items per request, dated search, placeholder times), field normalization, bot-detection findings, the no-disguise pacing rules, and alternative sources (GDELT, Finnhub) |

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
| `MoneyView_Glossary.md` | Terms and Korean wording for UI copy |
| `redesign-2026-10/` | The 2026-10 paper redesign the tokens are built from |

## Tabs (`docs/tabs/`)

**Canonical** user-facing tab reference — identity, route, purpose, layout,
behavior, and data sources for each top-level sidebar tab. See
[`tabs/index.txt`](tabs/index.txt) for the full file list and coverage notes.

- `tabs/cases-tab.txt` — the Cases tab: forking a stored valuation case with
  stated reasons, its Shapley why-it-moved, and simulating its uncertainty.
- `tabs/signals-tab.txt` — the Macro Signals tab: weekly FRED rule verdicts, the heuristic
  A/B/C scenario probabilities, manual inputs, and the schedule and failure rules.

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
| `USER-GUIDE.md` | End-user guide: double-click shortcuts, what each screen is for, reading the valuation figures and refusals, data and backup, troubleshooting |
| `desktop-shortcuts.md` | How the MoneyView / Stop MoneyView shortcuts are built: the `.lnk` targets, the launch flow, how Stop matches only this repo's servers, reinstall/uninstall |
| `api-usage.md` | Backend API usage walkthrough and examples |
| `local-run-resources.md` | Measured RAM/CPU cost of `run MoneyView`, the `/dev/*` tool URLs and the flag they need, and operational hazards |
| `git-worktrees.md` | Using git worktrees here: creating and removing them, the editable-install import trap, e2e port collisions, per-worktree data, Windows path length |
| `dcf-valuation.md` | DCF valuation methodology, user-facing explanation |
| `metrics/README.md` | Metric reference entry point: what earns an entry, the eight-field template, seven family files, and the gaps the reference does not cover |
| `risk-return-minard.md` | Record of the removed Risk-Return Minard chart and why |
| `moneyview-analysis-and-improvements.md` | Historical analysis and improvement notes |
| `markdown-organization-design.md` | Design spec for this documentation reorganization |

## Design Specs (`docs/superpowers/specs/`)

Dated design specs produced by the brainstorming workflow, each covering one
sub-project and feeding an implementation plan.

| Spec | Topic |
| --- | --- |
| `2026-07-25-perf-instrumentation/` | Performance instrumentation, analysis API, perf dashboard, and baseline runner (sub-project 1 of 4) |
| `2026-07-27-data-acquisition-design.md` | Data acquisition registry, per-class freshness boundaries, incremental backfill, and provider recommendations (sub-project 2 of 4) |
| `2026-08-09-segment-buildup-valuation-design.md` | Segment build-up valuation engine, persistence, and API for hand-authored (private/pre-IPO) cases |
| `2026-09-03-snapshot-overhaul-design.md` | Durable decision records with outcomes, snapshot dedupe on write, and the reset that precedes them |
| `plans/2026-09-03-snapshot-overhaul-backend.md` | Task-by-task backend plan implementing the snapshot-overhaul spec |
| `plans/2026-09-04-snapshot-overhaul-frontend.md` | Task-by-task plan for the `/decisions` page: the record form, the log, and the gap-vs-move scatter |
| `2026-09-04-valuation-tab-design.md` | Track C1: the `/valuation` tab surfacing the four-row evidence panel, with per-row units and refusal-as-content |
| `plans/2026-09-04-valuation-tab.md` | Task-by-task plan for the `/valuation` tab: per-unit formatters, refusal-as-content, and no invented verdict |
| `2026-09-04-fork-and-diff-design.md` | Track C2 (first half): `/fork` a stored case and `/diff` it against its parent, attributing the difference per input by Shapley |
| `plans/2026-09-04-fork-and-diff.md` | Task-by-task plan for `/fork` and `/diff`: the pure Shapley module, the fork's narrative rule, and the cap that refuses rather than degrades |
| `2026-09-05-simulate-design.md` | Track C2 (second half): Monte Carlo over caller-stated input distributions -- percentiles conditional on the engine accepting the inputs, a 10% suppression threshold, and association rather than contribution |
| `2026-09-08-metric-reference-design.md` | The metric reference: what earns an entry, the eight-field template, and the required common-misreading field |
| `plans/2026-09-08-metric-reference.md` | Task-by-task plan for the metric reference: confirm the enumeration against source first, then a citation/symbol checker, then seven family files |
| `plans/2026-09-05-simulate.md` | Task-by-task plan for `/simulate`: numpy-only sampling and Spearman, engine-refusal codes with a tested completeness table, and suppression above a 10% refused fraction |
| `2026-09-12-theme-and-policy-spreads-design.md` | Track I-D: theme and policy relative-strength spreads on Market Overview, event-line toggles, and why acquisition is lazy through the existing OHLCV path rather than a new scheduler or watchlist entry |
| `2026-09-15-market-event-registry-design.md` | Market event registry: pluggable file, rule and user event sources, colored categories with one global filter, hover tooltips, and the `/events` page (draft) |
| `plans/2026-09-15-market-event-registry.md` | Task-by-task plan for the event registry in four PRs: registry and sourced data, write routes and SQLite, coloured lines with tooltip and one global filter, and the `/events` page |
| `2026-09-18-watchlist-peer-sync-design.md` | Watchlist sync between the owner's PCs through a cloud-synced folder: one file per PC, per-ticker last-writer-wins with tombstones, and the public seed replaced by neutral defaults |
| `2026-09-20-records-peer-sync-design.md` | Peer sync for the owner's own records - valuation cases with their segments and narratives, decisions, events and categories, portfolio settings - whole-record last-writer-wins over the same cloud folder |
| `plans/2026-09-20-records-peer-sync.md` | Task-by-task plan for records peer sync: shared peer_sync model, sync_uid and record_sync schema, kind registry, whole-record merge, record file, run_records_sync, wiring and the status line |
| `plans/2026-09-18-watchlist-peer-sync.md` | Task-by-task plan for watchlist peer sync: pure merge model, defensive peer files, run_sync under one lock, status line; the neutral seed ships as a second PR merged only after both PCs sync |
| `2026-09-24-cases-ui-design.md` | Track C2 UI: the Cases tab -- fork a stored case with stated reasons, see why it moved by Shapley, and simulate it over stated distributions, entirely on existing endpoints |
| `plans/2026-09-24-cases-ui.md` | Task-by-task plan for the Cases tab: caseFields' one percent<->fraction conversion, the case list and detail routes, the fork form, the Shapley why-it-moved section, and the simulate section |
| `plans/2026-10-12-design-system-formalization.md` | Task-by-task plan for the design-system formalization: tokens, paper migration, lint rules and the lock-down |
| `2026-10-16-market-one-screen-design.md` | Market Overview on one screen: Instruments and Spreads page tabs, a spread-figure row and a regime line (new `GET /api/market/regime`) on the first screen, and market's paper and en/ko pass |
| `plans/2026-10-16-market-one-screen.md` | Task-by-task plan for the market one-screen page: owner gate for 25 existing-test rows, `GET /api/market/regime` with an in-memory mutation harness, pure market models, page tabs and the regime line, the five-column Instruments tab with spread figures, and the paper/en-ko pass that takes the market warning cap from 295 to 0 |
| `2026-10-16-monte-carlo-one-screen-design.md` | Monte Carlo one-screen page: five tab layouts at 1280x720, the compact KRW formatter (9.64M / 964만원), run status per tab, and the motion pieces from the motion system |
| `plans/2026-10-17-monte-carlo-one-screen.md` | Task-by-task plan for the Monte Carlo one-screen page: height budget and tabs, `formatKrwCompact`, superseded-run status, pinned rail actions, per-tab content, one-screen lock and before/after motion |
| `2026-10-10-macro-signal-engine-spec.md` | Macro signal engine: FRED rule verdicts and bounded heuristic A/B/C scenario probabilities, with the implementation-plan corrections C1–C11 in its appendix (the Macro Signals tab) |
| `plans/2026-10-12-macro-signal-engine.md` | Task-by-task plan for the macro signal engine: pure rules, scenario maths, FRED fetch, rules.yaml, store, engine and API, hourly schedule, the /signals page and the docs |
| `2026-10-18-risk-signal-design.md` | Risk signal (급락 경보): the watchlist theme layer (sub-project ①) and the drawdown warning built on it, with its decisions and the evidence under `2026-10-18-risk-signal-evidence/` |
| `2026-10-20-risk-ui-design.md` | Risk signal sub-project ③: always-on signal strip on "/", overlay panel (crash / candidates / surge / yesterday's gainers decks + news), `/alerts` records page with per-theme reports and CSV; small API additions |
| `plans/2026-10-20-risk-ui.md` | Task-by-task plan for the risk signal UI (sub-project 3): API additions, hooks, signal strip, overlay panel and cards, `/alerts` records page with CSV, record reports and theme level chart, docs and gates |
| `plans/2026-10-25-news-history.md` | Task-by-task plan for risk ④-a: RSS parsing and classification, the Google News pacer, publish time and publisher storage with every caller routed through the pacer, the news loop with the daily stock sweep, past-date search with range and status APIs, records |
| `2026-10-25-news-history-design.md` | Risk signal sub-project ④-a: daily stock news sweep restored, past-date news search per ticker (auto-saved, cached), real publish times and publisher in `source`, one Google News pacer with bulk 20-60 s and interactive 3-8 s gaps, block stop and daily cap |
| `2026-10-19-surge-signal-design.md` | Risk signal sub-project ②-b: theme surge signal (magnitude, EMA slope acceleration, breadth, RSI; cap-gated banner), daily top-5 gainers record, trailing-window live evaluation; backtest under `2026-10-19-surge-signal-evidence/` |
| `plans/2026-10-19-surge-signal.md` | Task-by-task plan for the surge signal (sub-project 2b): rules, pure surge engine, storage, evaluator with the trailing live window, API, reproduction |
| `2026-10-19-risk-engine-design.md` | Risk signal sub-project ②: daily risk evaluator, alert record with backfilled past alerts, daily bar and news sweeps, topic and Korean news, `/api/v1/risk` contract; the approved thresholds and backtest scripts are under `2026-10-19-risk-engine-evidence/` |
| `plans/2026-10-19-risk-engine.md` | Task-by-task plan for the risk engine (sub-project ②): rules, pure engine, store, sweeps, backfill, live cycle, news, `/api/v1/risk`, and the backfill reproduction script |
| `plans/2026-10-18-watchlist-themes.md` | Task-by-task plan for watchlist themes: the theme list and loader, the `theme` column with its own endpoint, the optional sync field, the stock-modal picker, and the one-off apply script for the approved 250-row draft |

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
| `test-verification.md` | Prove a test fails on a broken implementation before trusting it |
| `harness-optimizer.md` | Keep agent sessions focused and token-efficient |
| `suggestion.md` | DCF valuation critique and remediation source |
| `todo.md` | Active development-track tracking |
| `HARNESS.md` | Work harness: stages, model routing, owner gates, plan output-contract rule and fixed rules for every coding task (in `guideline/`) |
| `templates/work-card.md` | Fill-in work card: purpose, scope, data definition, interfaces with output contract, test plan, risks, approvals (in `guideline/`) |
| `templates/data-definition.md` | Data definition for one table or API payload: fields, units, keys, lifecycle, sync class, consumers (in `guideline/`) |

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
| `DESIGN.md` | Design rules: token references, lint messages, what review checks |

## Out Of Scope For This Index

`data/md/` contains scratch session logs and suggestion drafts (`todo log*.md`,
`suggestion cp*.md`) — working notes, not reference documentation. They are not
indexed here and should not be treated as canonical sources.
