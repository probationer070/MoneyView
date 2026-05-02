# Development Todo

Purpose: track the active implementation plan for aligning corporate metric calculation, audit payloads, UI exposure, and follow-on optimization work.

Status snapshot: as of 2026-05-03, the ROIC/Growth implementation track is complete and verified. O1 measurement baseline is complete. O2 backend ownership cleanup, O2A CQRS read/write separation review, O2A.1 CQRS calculation planning plus route-thinness verification, the O2B refactor-candidate inventory, O2B Steps 1-7 for the first selected candidate, the O3 frontend render splits, O3 dynamic loading for selected chart/modal-heavy UI, O3 React Query cache audit, O3 high-risk render-regression coverage, first O3 command/query UI separation slice, O3 named predicate extraction, O4 cache ownership documentation, O4 browser session-cache guardrails, O4 cache-size/TTL defaults review, O4 generated-artifact exclusions, O4 read-model registry documentation, and all O5 verification gates are complete. Candidate 1 completion criteria are satisfied for `apps/api/services/corporate_statement_metrics.py`; the next active optimization work is to define the next measured optimization track if more performance or ownership work is needed.

Planning sources:
- `guideline/suggestion.md`
- `guideline/finance-logic.md`
- `guideline/CQRS Architecture.md`
- `guideline/python-dataClass.md`
- `guideline/Refactoring for Solving Complicate Spaghetti codes.md`

Implementation-track verification:
- [x] Code search confirms stable and legacy metric variants coexist in backend, frontend contracts, and E2E mocks.
- [x] Code search confirms unified corporate audit payload includes `growth`, `roic`, `wacc`, `spread`, and `dcf` entries with method, quality, confidence, warnings, and calculation-version metadata.
- [x] Targeted regression command passed on 2026-04-30: `pytest tests/core_finance/test_corporate_statement_metric_helpers.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py --basetemp=E:\MoneyView\pytest-codex-regression`
- [x] Verification result: 22 passed.

## Active Tracks

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses


## Whole-Code Optimization Plan

Principle:
- Optimize from measured bottlenecks, not broad rewrites.
- Keep route handlers thin, frontend logic in `apps/web`, and reusable finance primitives in `packages/core_finance`.
- Preserve existing API contracts unless a contract migration is explicitly planned and covered by shared types, fixtures, and E2E mocks.
- Apply CQRS selectively only where read and write requirements have clearly diverged, such as dashboard-style projections, snapshot history, audit payloads, and expensive derived corporate metrics.
- For calculation logic, treat source data writes and formula-policy changes as command-side concerns; treat derived metrics, valuation displays, comparison rows, and audit payloads as query-side concerns.
- Refactor complicated code by first locking current behavior with characterization tests, then flattening control flow, naming conditions, and converting stable rule sets into data.
- Use Python dataclasses for lightweight, self-validating domain value objects and computed result containers where Pydantic request/response schemas are not required.

Initial scan findings:
- Largest frontend composition files are `apps/web/app/portfolio/page.tsx`, `apps/web/app/corporate/page.tsx`, `apps/web/app/corporate/buildCalculationDetails.ts`, `apps/web/components/market/MarketOverviewClient.tsx`, and `apps/web/app/portfolio/components/StockDetailModal.tsx`.
- Largest backend orchestration files are `apps/api/services/corporate_statement_metrics.py`, `apps/api/services/corporate_comparison.py`, `apps/api/services/market_data.py`, `apps/api/routes/corporate.py`, and `apps/api/services/db.py`.
- Reusable ROIC/Growth helper tests now import helpers from `packages.core_finance.corporate_statement_metrics`; API service orchestration delegates those pure helper names before Yahoo statement orchestration runs.
- Pytest uses a unique repo-local temp base under `data/cache/pytest-runs` by default on Windows; explicit `--basetemp` is still supported for one-off isolated runs.









Track O5 - Verification Gates:
- [x] For backend optimization, run the narrow affected API/service tests first, then the relevant `tests/core_finance` suite.
  - Completed on 2026-05-03.
  - Narrow affected API/service tests were run first for the backend optimization surfaces touched by O2/O4: corporate metric audit, corporate growth metrics, corporate comparison snapshots, market index detail, stock price lookup, and portfolio attribution.
  - Initial sandboxed command `pytest tests/api/test_corporate_metric_audit.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_comparison.py tests/api/test_market_index_detail.py tests/api/test_stock_price_lookup.py tests/api/test_portfolio_attribution.py -q --basetemp=E:\MoneyView\pytest-o5-backend-api` hit the known Windows pytest temp cleanup `PermissionError: [WinError 5]` after test execution.
  - Escalated rerun passed: `pytest tests/api/test_corporate_metric_audit.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_comparison.py tests/api/test_market_index_detail.py tests/api/test_stock_price_lookup.py tests/api/test_portfolio_attribution.py -q --basetemp=E:\MoneyView\pytest-o5-backend-api-2` -> 51 passed.
  - Relevant core-finance suite passed after the API/service tests: `pytest tests/core_finance -q --basetemp=E:\MoneyView\pytest-o5-core-finance` -> 42 passed.
- [x] For frontend optimization, run `npm.cmd run build` and the narrow affected Playwright specs.
  - Completed on 2026-05-03.
  - Build passed from `apps/web`: `npm.cmd run build`.
  - Initial sandboxed Playwright command `npm.cmd run test:e2e -- tests/e2e/high-risk-render-regression.spec.ts tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts tests/e2e/refresh-idle-state.spec.ts` failed with local harness `spawn EPERM` before running tests.
  - Escalated rerun passed: `npm.cmd run test:e2e -- tests/e2e/high-risk-render-regression.spec.ts tests/e2e/portfolio-watchlist.spec.ts tests/e2e/corporate-comparison.spec.ts tests/e2e/refresh-idle-state.spec.ts` -> 21 passed.
- [x] For contract-affecting optimization, update `apps/api/models`, `packages/shared-types`, E2E mocks, and API tests in the same change.
  - Completed on 2026-05-03 as a contract audit gate.
  - Current optimization diff does not introduce a new `apps/api/models` or `packages/shared-types` contract change; `git diff -- apps/api/models packages/shared-types apps/web/tests/e2e/helpers tests/api` showed no pending model/shared-type diff beyond existing typed E2E helper/API test coverage.
  - Audited the current contract-bearing surfaces: corporate Growth/ROIC metadata, audit calculation-version fields, DCF stream/full-report payloads, corporate comparison snapshot/expected-return fields, portfolio attribution cache metadata, shared TypeScript exports, and E2E mock payloads.
  - Focused API contract tests first hit the known Windows pytest temp cleanup `PermissionError: [WinError 5]` with `--basetemp=E:\MoneyView\pytest-o5-contract-api`; escalated rerun passed: `pytest tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py tests/api/test_corporate_comparison.py -q --basetemp=E:\MoneyView\pytest-o5-contract-api-2` -> 32 passed.
  - TypeScript/shared-types and E2E mock compatibility check passed from `apps/web`: `npm.cmd run build`.
- [x] Do not mark an optimization track complete if performance is unmeasured, tests are failing, or the change only moves complexity between files without reducing runtime cost or ownership risk.
  - Completed on 2026-05-03 as a measurement and quality audit gate.
  - Tests are not failing for the optimization track gates already marked complete: backend/API plus core-finance gate passed with 51 API tests and 42 core-finance tests; frontend build plus balanced Playwright gate passed with 21 E2E tests; contract gate passed with 32 focused API tests plus `npm.cmd run build`.
  - Benchmark harness smoke test passed: `pytest tests/api/test_benchmark_scripts.py -q --basetemp=E:\MoneyView\pytest-o5-measurement-gate` -> 3 passed.
  - Measured finance/runtime cost with `python scripts\benchmark_finance.py --iterations 3 --monte-carlo-runs 500 --vector-size 1000 --seed 7`; representative averages included `core_finance:monte-carlo-npv-500` 4.845ms, `market:technical-indicators-1000` 1.195ms, `corporate:stable-growth-5-years` 0.023ms, and `corporate:roic-records-5-years` 0.038ms.
  - Measured API endpoint cost with `python scripts\benchmark_api.py --iterations 2`; representative averages included corporate metrics 4.406ms, DCF 2.75ms, live comparison 5.29ms, portfolio attribution 11.234ms, technicals 4.158ms, and Monte Carlo detail 9.578ms, all status 200.
  - Measured SQLite local read/write cost with `python scripts\benchmark_sqlite.py --iterations 3 --write-rows 25`; representative averages included latest stock lookup 0.239ms, indicators-by-category 0.512ms, watchlist read 0.088ms, and temp insert write 0.064ms.
  - Ownership-risk audit confirms the changes reduce ownership risk rather than only moving complexity: route handlers remain HTTP boundaries, backend orchestration/cache behavior lives in `apps/api/services`, reusable finance rules live in `packages/core_finance`, frontend render/query/cache ownership stays in `apps/web`, and `docs/architecture/cqrs-read-write-separation.md` plus `docs/architecture/cache-ownership-invalidation.md` document read-model/cache boundaries and stale-read rules.
- [x] Do not mark a CQRS-style change complete until projection correctness, stale-read behavior, and command/query ownership are tested or documented.
  - Completed on 2026-05-03 as a CQRS projection and ownership audit gate.
  - Projection correctness is tested for the current durable CQRS read model, `corporate_comparison_snapshots_v3`, including scheduled snapshot creation, manual refresh materialization, custom-universe metadata persistence, live mode not overwriting snapshots, history queries, snapshot-version drill-down, deletion, stock-history timelines, KST business-date handling, retention cleanup, multiple same-day versions, and v3 index/schema bootstrap.
  - Stale-read behavior is documented and covered by service/API behavior: `build_corporate_comparison_response()` may fall back to the latest snapshot only when `allow_stale_snapshot=True`, and stale snapshot responses expose `snapshot_is_stale` plus snapshot date/version/source/cadence/universe metadata. Browser/session stale-read rules are documented in `docs/architecture/cache-ownership-invalidation.md`.
  - Command/query ownership is documented in `docs/architecture/cqrs-read-write-separation.md`: command-side writes own source inputs and snapshot materialization, query-side services own comparison rows/history/timelines, and routes remain HTTP boundaries delegating to `apps/api/services/corporate_comparison.py`.
  - Initial sandboxed command `pytest tests/api/test_corporate_comparison.py -q --basetemp=E:\MoneyView\pytest-o5-cqrs-gate` hit the known Windows pytest temp cleanup `PermissionError: [WinError 5]`; escalated rerun passed: `pytest tests/api/test_corporate_comparison.py -q --basetemp=E:\MoneyView\pytest-o5-cqrs-gate-2` -> 12 passed.
- [x] Do not mark a spaghetti-code refactor complete until characterization tests still pass and the new structure demonstrably reduces nesting, duplicated rules, or hidden exception paths.
  - Completed on 2026-05-03 as a characterization and refactor-quality audit gate.
  - Characterization tests cover the behavior-preserving refactor surfaces: corporate statement metric helper rules, expected-return value objects, growth/ROIC metric payloads, metric audit payloads, DCF streaming/full-report behavior, market index detail, and stock price lookup.
  - Initial sandboxed command `pytest tests/core_finance/test_corporate_statement_metric_helpers.py tests/core_finance/test_expected_return.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py tests/api/test_market_index_detail.py tests/api/test_stock_price_lookup.py -q --basetemp=E:\MoneyView\pytest-o5-spaghetti-gate` hit the known Windows pytest temp cleanup `PermissionError: [WinError 5]`; escalated rerun passed with `--basetemp=E:\MoneyView\pytest-o5-spaghetti-gate-2` -> 49 passed.
  - Reduced duplicated rules: `packages/core_finance/corporate_statement_metrics.py` centralizes numeric policy in named rule/value objects such as `TAX_RATE_RULE`, `INVESTED_CAPITAL_RULE`, `ROIC_SANITY_RULE`, `REVENUE_RULE`, and `GROWTH_CAGR_RULE`; helper tests assert those rule boundaries directly.
  - Reduced hidden/implicit payload logic: `packages/core_finance/expected_return.py` exposes `ExpectedReturnInputs`, `ExpectedReturnResult`, and `calculate_expected_return_result(...)`; `apps/api/services/corporate_comparison.py` consumes the typed result instead of rebuilding the expected-return payload inline.
  - Reduced nested/hidden conditionals: corporate statement metric service uses named predicates such as `_has_valid_capital_ratio_inputs`, `_has_valid_debt_to_equity_inputs`, and `_is_decision_grade_roic` for decision branches that feed audit metadata.
  - Reduced hidden exception paths on the checked hot files: `rg -n "except Exception" apps\api\services\corporate_statement_metrics.py apps\api\services\market_data.py packages\core_finance\risk_analysis.py packages\core_finance\corporate_statement_metrics.py packages\core_finance\expected_return.py` returned no matches; market-data provider paths use `YAHOO_PROVIDER_ERRORS`.
