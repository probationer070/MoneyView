# Development Todo

Purpose: track the active implementation plan for aligning corporate metric calculation, audit payloads, UI exposure, and follow-on optimization work.

Status snapshot: as of 2026-05-01, the ROIC/Growth implementation track is complete and verified. O1 measurement baseline is complete. O2 backend ownership cleanup has completed the formula-helper split, corporate route thinning, technical-indicator consolidation, SQLite comparison hot-path cleanup, first expected-return value objects, provider/cache freshness review, finance-policy rule extraction, and narrower hot-path exception handling.

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

Track O1 - Measurement Baseline:
- [x] Run existing narrow test suites and `npm.cmd run build` to establish a clean pre-optimization baseline.
- [x] Run or add focused finance benchmarks for DCF, Monte Carlo, portfolio attribution, market technicals, and corporate metric extraction.
- [x] Capture frontend build output and identify route-level bundle weight, especially chart-heavy corporate, portfolio, market, and Monte Carlo screens.
- [x] Capture API endpoint timing for corporate metrics, corporate comparison, portfolio attribution, market detail, and Monte Carlo endpoints using representative local data.
- [x] Before refactoring any high-complexity service or page, add characterization tests or E2E coverage that preserves current behavior across normal, edge, and fallback paths.

Track O1 baseline results:
- Backend verification passed on 2026-04-30:
  - command: `pytest tests/core_finance tests/api/test_benchmark_scripts.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py tests/api/test_corporate_comparison.py tests/api/test_portfolio_attribution.py tests/api/test_market_index_detail.py --basetemp=E:\MoneyView\pytest-optimization-baseline-20260430b`
  - result: 83 passed, 2 warnings.
  - resolved: `apps/api/services/market_data.py` uses timezone-aware UTC timestamps for market-data quality metadata.
  - resolved: `tests/conftest.py` assigns a unique repo-local pytest temp base when `--basetemp` is not supplied, avoiding reused locked Windows temp directories.
- Frontend build passed on 2026-04-30:
  - command: `npm.cmd run build` from `apps/web`
  - result: Next.js 16.2.2 production build passed, TypeScript passed, 9 static pages generated.
  - baseline build fix required before pass: `apps/web/components/ui/MetricAuditPanel.tsx` guards nullable audit entries such as `growth`.
  - route output: static `/corporate`, `/monte-carlo`, `/news`, `/portfolio`; dynamic `/`, `/api/runtime/backend-port`, `/detail/[ticker]`, `/healthz`.
- Frontend build-size snapshot:
  - largest server app artifacts: `detail/[ticker]/page_client-reference-manifest.js` 20.2 KB, `portfolio/page_client-reference-manifest.js` 12.3 KB, `monte-carlo/page_client-reference-manifest.js` 12.3 KB, `corporate/page_client-reference-manifest.js` 12.2 KB.
  - largest static chunks: four 301.2 KB JS chunks, one 222.2 KB JS chunk, two 159.7 KB JS chunks, and one 149.2 KB JS chunk.
  - caution: `.next/dev/cache/turbopack` contains stale dev-cache `.sst` files over 200 MB and should be excluded from bundle-size interpretation.
- Finance benchmark baseline:
  - command: `python scripts\benchmark_finance.py --iterations 20 --monte-carlo-runs 5000 --vector-size 10000 --seed 42`
  - added coverage: `market:technical-indicators-*`, `corporate:stable-growth-5-years`, and `corporate:roic-records-5-years`.
  - hotspots: `core_finance:monte-carlo-npv-5000` avg 42.765 ms; `market:technical-indicators-10000` avg 7.972 ms.
  - low-cost calculation paths: corporate stable growth avg 0.006 ms; corporate ROIC records avg 0.017 ms; multi-stage DCF avg 0.006 ms; Brinson-Fachler 2000 segments avg 0.006 ms.
- API endpoint timing baseline:
  - command: `python scripts\benchmark_api.py --iterations 10`
  - benchmark uses deterministic local data, temporary SQLite under `data/cache/api_benchmarks`, and patched provider-facing route helpers to avoid network calls.
  - `GET /api/v1/corporate/metrics/AAPL`: avg 2.381 ms, median 1.856 ms, 10 iterations.
  - `POST /api/v1/corporate/dcf/AAPL`: avg 2.279 ms, median 2.085 ms, 5 iterations due heavy-endpoint rate limit.
  - `GET /api/v1/corporate/comparison?mode=live`: avg 5.580 ms, median 5.458 ms, 10 iterations.
  - `POST /api/v1/portfolio/attribution`: avg 5.743 ms, median 2.161 ms, 5 iterations due heavy-endpoint rate limit.
  - `GET /api/v1/detail/AAPL/technicals?period=5y`: avg 2.926 ms, median 2.950 ms, 10 iterations.
  - `GET /api/v1/detail/AAPL/monte-carlo?paths=1000&horizon_days=252`: avg 9.217 ms, median 9.249 ms, 5 iterations due heavy-endpoint rate limit.



Track O2 - Backend Ownership And Hot Path Cleanup:
- [x] Split pure ROIC/Growth formula helpers out of `apps/api/services/corporate_statement_metrics.py` into `packages/core_finance` with public tests, leaving Yahoo statement orchestration in `apps/api/services`.
- [x] Keep `apps/api/routes/corporate.py` as request parsing and response shaping only; move remaining orchestration-heavy helpers into services where ownership is clear.
- [x] Consolidate duplicated technical indicator logic between `apps/api/routes/detail.py` and `apps/api/services/market_data.py`.
- [x] Review SQLite read/write paths in `apps/api/services/db.py` and corporate comparison services for missing indexes, repeated full-table reads, or avoidable transaction churn.
- [x] Review provider/cache paths so repeated Yahoo or market-data fetches use explicit freshness rules and do not duplicate work across adjacent endpoints.
- [x] Introduce dataclass value objects in `packages/core_finance` for stable calculation inputs/results when they need local validation, cached derived properties, or explicit metadata without API-schema coupling.
- [x] Convert stable finance policy rules, such as sanity bounds, quality flags, and fallback classifications, into named rule tables or small predicate functions instead of nested condition chains.
- [x] Remove blanket exception handling in finance and market-data hot paths where it hides unexpected bugs; replace it with specific guards for known provider, missing-data, or invalid-input cases.



Track O2 progress results:
- ROIC/Growth helper ownership moved on 2026-04-30:
  - added `packages/core_finance/corporate_statement_metrics.py`
  - exported stable corporate helper APIs from `packages/core_finance/__init__.py`
  - updated `tests/core_finance/test_corporate_statement_metric_helpers.py` to test the package-owned helpers directly
  - updated `scripts/benchmark_finance.py` to benchmark package-owned corporate helpers
  - updated `apps/api/services/corporate_statement_metrics.py` so downstream orchestration delegates pure helper names to `packages.core_finance`
- Corporate route ownership cleanup moved on 2026-05-01:
  - added `apps/api/services/corporate_metrics_service.py` for fallback metric policy, company registry persistence, market price lookup, metric history, quarterly statement payloads, metric saves, and valuation parameter construction
  - kept route-level compatibility wrappers for existing tests and scheduled jobs that patch `_metrics_for_ticker`, `_latest_market_price`, `_get_yahoo_statement_bundle`, and `_WATCHLIST_JSON`
  - fixed console log elapsed-field formatting so zero-duration requests still emit `elapsed=0.0ms` and transport verification stays stable
- Market technical indicator ownership cleanup moved on 2026-05-01:
  - removed duplicated RSI, EMA, MACD, Bollinger, and SMA helper implementations from `apps/api/routes/detail.py`
  - made `GET /detail/{ticker}/technicals` delegate calculation to `MarketDataService._compute_technicals`
- SQLite and comparison hot-path cleanup moved on 2026-05-01:
  - made `apps/api/services/db.py` commit or rollback only when a SQLite transaction is active
  - added `corporate_comparison_snapshots_v3` indexes for universe/date and ticker/universe/date lookup paths
  - changed corporate comparison live-row construction to load company registry and watchlist rows through one company-universe data read
  - narrowed the live comparison fallback catch from blanket `Exception` to expected SQLite, value, and key errors
- Expected-return value object extraction moved on 2026-05-01:
  - added `ExpectedReturnInputs` and `ExpectedReturnResult` dataclasses in `packages/core_finance/expected_return.py`
  - added `calculate_expected_return_result()` so comparison DCF snapshots consume one stable return payload instead of recomputing related fields inline
  - updated corporate comparison and core-finance tests to cover the value object and snapshot index additions
- Provider/cache freshness review moved on 2026-05-01:
  - added explicit OHLCV freshness rules in `apps/api/services/market_data.py` so period coverage and row limits use one named policy table
  - routed synchronous live OHLCV refreshes through a short keyed provider cache, allowing adjacent detail, technical, market, and price paths to reuse a recent Yahoo result instead of duplicating work
  - kept price lookup background refresh de-duplication intact while clearing the new provider cache in focused tests
- Finance-policy rule extraction moved on 2026-05-01:
  - added named ROIC warning and quality rule tables in `packages/core_finance/corporate_statement_metrics.py`
  - kept stable sanity bounds exposed as named numeric rules and added tests for ROIC rule ordering when multiple failures match
  - replaced WACC audit quality branching in `apps/api/services/corporate_statement_metrics.py` with named audit rules for missing market cap, missing capital-structure inputs, and WACC sanity range
- Hot-path exception handling cleanup moved on 2026-05-01:
  - narrowed the sector lookup fallback in `apps/api/services/corporate_metrics_service.py` from blanket `Exception` to expected SQLite/filesystem failures
  - added characterization tests proving expected SQLite lookup failures still fall back to deterministic defaults while unexpected bugs propagate
  - confirmed focused corporate statement, market-data, and core-finance paths no longer contain blanket `except Exception` handlers
- Verification:
  - focused extraction check passed: `pytest tests/core_finance/test_corporate_statement_metric_helpers.py tests/api/test_benchmark_scripts.py --basetemp=E:\MoneyView\pytest-o2-core-finance-extract`
  - focused corporate API check passed: `pytest tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py tests/api/test_corporate_comparison.py --basetemp=E:\MoneyView\pytest-o2-corporate-service-delegation-b`
  - route ownership check passed: `pytest tests/api/test_corporate_companies_registry.py tests/api/test_watchlist_resync.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py tests/api/test_transport_progress.py tests/api/test_corporate_comparison.py -q --basetemp=E:\MoneyView\pytest-o2-route-20260501c`
  - market technical ownership check passed: `pytest tests/api/test_market_index_detail.py tests/api/test_benchmark_scripts.py -q --basetemp=E:\MoneyView\pytest-o2-detail-20260501b`
  - expected-return value-object check passed as part of `pytest tests/core_finance/test_expected_return.py tests/api/test_corporate_comparison.py -q`; current rerun reached 6 passed before `tests/api/test_corporate_comparison.py` was blocked by Windows `tmp_path` cleanup permission on `E:\MoneyView\pytest-todo-update-20260501`
  - provider/cache freshness check passed for non-`tmp_path` tests: `pytest tests/api/test_market_data_period_coverage.py tests/api/test_stock_price_lookup.py -q` (7 passed)
  - provider-cache reuse check passed via direct Python service check against a temporary SQLite DB under `data/processed`; `tests/api/test_market_index_detail.py` could not complete in pytest because this Windows session creates unreadable `tmp_path` directories during pytest cleanup
  - finance-policy rule check passed: `pytest tests/core_finance/test_corporate_statement_metric_helpers.py -q` (12 passed)
  - corporate API behavior check passed outside the sandbox after sandboxed `tmp_path` permission failures: `pytest tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py -q` (8 passed)
  - exception cleanup focused check passed: `pytest tests/api/test_corporate_growth_metrics.py::test_default_metrics_falls_back_when_sector_lookup_has_sqlite_error tests/api/test_corporate_growth_metrics.py::test_default_metrics_does_not_hide_unexpected_sector_lookup_errors -q` (2 passed)
  - exception cleanup corporate API check passed outside the sandbox: `pytest tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py -q` (10 passed)
  - exception cleanup market-data check passed: `pytest tests/api/test_market_data_period_coverage.py tests/api/test_stock_price_lookup.py -q` (7 passed)
  - broader O2 baseline passed: `pytest tests/core_finance tests/api/test_benchmark_scripts.py tests/api/test_corporate_growth_metrics.py tests/api/test_corporate_metric_audit.py tests/api/test_corporate_dcf_streaming.py tests/api/test_corporate_comparison.py tests/api/test_portfolio_attribution.py tests/api/test_market_index_detail.py --basetemp=E:\MoneyView\pytest-o2-baseline-20260430`
  - result: 83 passed, 2 warnings.
  - frontend build still passed: `npm.cmd run build` from `apps/web`.
- Follow-up cleanup:
  - remove service-local dead helper definitions from `apps/api/services/corporate_statement_metrics.py` once the next O2 finance-policy pass is underway.
  - keep the package helper behavior byte-for-byte compatible with existing API tests before converting return dictionaries into dataclass value objects.

Track O2A - CQRS Read/Write Separation:
- [x] Identify endpoints where reads perform repeated expensive derivation after writes have already established the source-of-truth state.
- [x] For qualifying endpoints, define the command-side owner, query-side owner, projection trigger, and acceptable eventual-consistency window before changing storage or cache behavior.
- [x] Keep command functions focused on validated state changes and domain errors, not HTTP response concerns.
- [x] Keep query functions optimized for UI and analytics payloads, including precomputed audit summaries, comparison rows, and dashboard aggregates where measurement justifies it.
- [x] Document any new read model or projection in `docs/architecture/` and add tests proving writes update or invalidate the corresponding read projection.

Track O2A.1 - CQRS For Calculation Logic:
- [x] Define command-side calculation responsibilities.
  - Own persisted or source-of-truth inputs such as raw provider statements, ticker snapshots, portfolio holdings, watchlist changes, source-data refreshes, user assumptions, and formula-policy version changes.
  - Validate source inputs before they become calculation inputs, including ticker identity, statement period, currency/unit assumptions, missing provider fields, and user-provided assumption ranges.
  - Raise domain/service errors from command functions and map them to HTTP responses only at the route boundary.
  - Avoid shaping command models around UI display needs; write models should preserve source fidelity and auditability.
- [x] Define query-side calculation responsibilities.
  - Own read-optimized outputs such as corporate metric summaries, ROIC/Growth audit records, DCF parameter views, comparison tables, portfolio attribution summaries, market technical summaries, and chart-ready series.
  - Precompute or cache expensive derived values when reads repeatedly recalculate the same formula from unchanged source inputs.
  - Shape query models around UI and analytics needs without feeding those shapes back into the source write model.
  - Keep legacy and stable calculation variants visible in query payloads when needed for audit, migration, or side-by-side comparison.
- [x] Define projection boundaries for each expensive calculation family.
  - Corporate statements: project normalized annual/quarterly statement rows into stable ROIC, Growth, margin, leverage, and quality metadata read models.
  - DCF: project validated metric inputs and user assumptions into valuation parameter snapshots, scenario outputs, warnings, and calculation-version metadata.
  - Corporate comparison: project per-ticker metric reads into sortable comparison rows and aggregate summaries instead of recomputing every row in the route.
  - Portfolio analytics: project transactions/holdings and latest prices into attribution, exposure, and history read models when endpoint timing shows repeated work.
  - Market detail: project provider price data into technical indicator read models when route-level reads repeatedly recompute indicators for unchanged candles.
- [x] Add projection triggers and invalidation rules.
  - Provider/source-data refresh must invalidate or rebuild affected corporate metric, DCF, comparison, and market-detail read models for that ticker.
  - Formula-version changes must keep old read projections reproducible and build new versioned projections instead of overwriting historical meaning.
  - User assumption changes should create or refresh only the affected DCF/scenario read model, not unrelated source-data projections.
  - Portfolio holding or price updates should invalidate attribution and snapshot reads for the affected account/ticker scope only.
- [x] Define acceptable consistency behavior before introducing a read model.
  - Main decision surfaces should either show the projection version/timestamp or force a synchronous refresh when stale data would mislead the user.
  - Dashboards and comparison tables may tolerate short-lived stale projections only when timestamp, source, and refresh controls make that visible.
  - Audit endpoints must disclose source timestamp, calculation version, method, quality, confidence, and warnings so users can understand stale or fallback-derived values.
  - Tests must cover stale projection handling, missing projection fallback, and projection rebuild after write-side changes.
- [x] Keep calculation routes thin after CQRS separation.
  - Routes should parse request parameters, call command or query services, and shape HTTP responses.
  - Query services should not mutate source-of-truth records as a side effect of reads unless the projection behavior is explicit and tested.
  - Command services should not return UI-specific read models except for minimal confirmation payloads; follow-up display data should come from query services.
  - Shared formula code belongs in `packages/core_finance`; API-specific projection orchestration belongs in `apps/api/services`.
- [x] Verification for CQRS calculation updates.
  - Add pure formula tests for `packages/core_finance` before projection tests.
  - Add service tests proving command writes trigger, invalidate, or rebuild the correct read projection.
  - Add API tests proving query endpoints return projected calculation values with source timestamp and calculation-version metadata.
  - Add regression tests proving legacy/stable calculation versions can coexist without overwriting prior semantics.
  - Measure endpoint timing before and after projection work; do not accept CQRS complexity unless repeated-read cost, data-transfer cost, or ownership clarity improves.

Track O2A.1 progress results:
- Calculation command-side responsibilities defined on 2026-05-01:
  - expanded `docs/architecture/cqrs-read-write-separation.md` with command-owned calculation source inputs, validation-before-calculation rules, error-boundary rules, and write-model shape rules
  - mapped current command owners for raw provider statements, OHLCV refreshes, watchlist state, corporate company registry, corporate metric overrides, comparison snapshots, user valuation assumptions, and formula-policy versions
  - clarified that command services should raise domain/service errors and routes should map those to HTTP responses
  - documented that write models preserve source fidelity and auditability, while display grouping, sorting, labels, and chart-ready shapes belong to query services or frontend adapters
  - verification: documentation consistency checked with `rg` for the new CQRS calculation sections and the completed todo marker; no runtime tests were required for this docs-only slice
- Calculation query-side responsibilities and projection boundaries defined on 2026-05-01:
  - expanded `docs/architecture/cqrs-read-write-separation.md` with query-owned calculation outputs for corporate summaries, ROIC/Growth audit records, DCF views, comparison tables, portfolio attribution summaries, market technical summaries, and chart-ready series
  - documented that query models may sort, group, filter, enrich, expose quality/confidence/stale metadata, and keep legacy/stable calculation variants side by side without feeding those display shapes back into command models
  - added projection-boundary guidance for corporate statements, DCF, corporate comparison, portfolio analytics, and market detail, including current source write models, read outputs, and adoption thresholds
  - confirmed `corporate_comparison_snapshots_v3` remains the current durable projection; DCF stays request-scoped unless saved scenarios are introduced; portfolio and market projections stay future candidates until measured repeated-read cost justifies storage complexity
  - verification: documentation consistency checked with `rg` for the new query responsibility and projection-boundary sections plus the completed todo markers; no runtime tests were required for this docs-only slice
- Projection triggers, invalidation rules, and consistency behavior defined on 2026-05-01:
  - expanded `docs/architecture/cqrs-read-write-separation.md` with build triggers, invalidation triggers, and invalidation scope for corporate statement metrics/audit, DCF saved-scenario projections, corporate comparison snapshots, portfolio attribution projections, and market technical projections
  - documented global invalidation rules so provider/source refreshes, formula-version changes, user assumption edits, and portfolio/price updates affect only the projections that consumed those inputs
  - added read-model consistency rules for decision-grade corporate metrics/audit, corporate comparison dashboards, DCF saved scenarios, portfolio attribution/report reads, and market technical summaries
  - defined required future read-model tests for projection build, source refresh invalidation, missing projection fallback, stale metadata, and legacy/stable formula-version coexistence
  - verification: documentation consistency checked with `rg` for the new trigger/invalidation and consistency sections plus the completed todo markers; no runtime tests were required for this docs-only slice
- Calculation route thinness and CQRS verification gates completed on 2026-05-01:
  - moved bulk DCF report ticker normalization, deduplication, metrics loading, valuation-parameter building, and report fan-out from `apps/api/routes/corporate.py` into `apps/api/services/corporate_dcf.py`
  - kept the route boundary responsible for request parsing, service invocation, and API envelope shaping only
  - expanded `docs/architecture/cqrs-read-write-separation.md` with route-thinness rules and verification gates for formula changes, service extractions, new persisted projections, API contracts, and performance-motivated projections
  - added service-level coverage for `build_bulk_dcf_reports()` normalization/deduplication and retained the existing bulk DCF route behavior test
  - verification: `python -m py_compile apps\api\routes\corporate.py apps\api\services\corporate_dcf.py tests\api\test_corporate_dcf_streaming.py` passed; sandbox pytest hit Windows temp cleanup `PermissionError`, then escalated `pytest tests\api\test_corporate_dcf_streaming.py tests\api\test_corporate_comparison.py::test_corporate_bulk_dcf_reports_returns_full_reports_for_requested_tickers -q` passed with 6 tests

Track O2B - Spaghetti-Code Refactoring Flow:
- [x] Build a refactor candidate inventory before editing.
  - Start with the known large orchestration and composition files listed in `Initial scan findings`.
  - Add files where code search shows deep nesting, broad `except Exception`, repeated branch conditions, duplicated rule thresholds, or mixed HTTP/service/domain responsibilities.
  - For each candidate, record owner layer, current behavior risk, existing test coverage, and the smallest useful extraction target.
- [x] Step 1: add characterization tests before changing behavior.
  - Backend candidates need tests for happy path, missing provider data, invalid numeric inputs, fallback behavior, and provider/cache errors.
  - Frontend candidates need E2E or component-level coverage for loading, empty, error, success, refresh, and mutation states.
  - For finance logic, include edge cases for zero, negative, tiny, `None`, outlier, and insufficient-history inputs.
  - Mark the candidate blocked if current behavior cannot be described well enough to test.
- [x] Step 2: flatten nested control flow with guard clauses.
  - Replace deeply nested eligibility, data-availability, and error-state branches with early returns.
  - Keep the normal path visually dominant after invalid, empty, unauthorized, stale, or unsupported states exit early.
  - Do not combine guard-clause refactors with formula or contract changes in the same commit.
- [x] Step 3: remove overly broad exception handling.
  - Search for blanket handlers such as `except Exception`, `catch (error)`, or silent fallback branches in the refactor target.
  - Preserve explicit handling for known provider failures, parse errors, missing optional data, and user-facing recoverable states.
  - Let unexpected errors surface to logs/tests instead of converting them to misleading empty data.
  - Add tests for every retained fallback branch so future broad catches do not return silently.
- [x] Step 4: extract methods that name complex conditions.
  - Move long boolean expressions into focused predicates such as `has_valid_revenue_history`, `should_use_cached_snapshot`, or `is_decision_grade_metric`.
  - Prefer pure helpers with typed inputs over helpers that read mutable route, component, or module state.
  - Use extracted names to make business intent clear without adding explanatory comments around every branch.
- [x] Step 5: simplify loops and condition checks with Python and TypeScript language features.
  - Replace manual accumulator loops with `any`, `all`, comprehensions, generator expressions, `sum`, or small reducers when they preserve readability.
  - Keep numerical finance loops explicit when vectorization, precision, or step-by-step audit metadata is important.
  - In frontend code, replace repeated null checks and filter/map chains with named derived arrays or memoized selectors where render cost is measured or readability improves.
- [x] Step 6: merge duplicated validation and rejection branches into rule lists.
  - Convert repeated `if` blocks that return the same quality state, warning, or suppression decision into ordered rule lists.
  - Each rule should expose a name, predicate, outcome, and warning/note text when that outcome is user-visible or audit-visible.
  - Preserve rule order when the first matching rule determines the final result.
  - Add tests proving the highest-priority failure wins when multiple rules match.
- [x] Step 7: convert stable rules into data.
  - Move stable thresholds, allowed enum combinations, quality classifications, and provider field mappings into named dictionaries, tuples, dataclasses, or constants.
  - Keep volatile business decisions close to service code until behavior stabilizes.
  - Do not hide complex formulas inside opaque data tables; formulas should remain named functions with tests and audit notes.
  - For finance rules, document unit conventions such as decimal-vs-percent, annual-vs-quarterly, and raw-vs-normalized values next to the data structure.
- [x] Completion criteria for each refactor candidate:
  - Characterization tests existed before structural edits.
  - Refactor keeps public API and UI behavior unchanged unless a separate contract task explicitly says otherwise.
  - Nesting, duplicated branches, or hidden exception paths are measurably reduced.
  - Route handlers stay thin, service ownership is clearer, and reusable finance logic moves toward `packages/core_finance`.
  - Narrow affected tests pass after each step, with broader verification run before marking the candidate complete.

Track O2B inventory results:
- Refactor candidate inventory built on 2026-05-01 before structural edits:
  - Candidate 1: `apps/api/services/corporate_statement_metrics.py` (`apps/api/services`, 1566 lines). Risk: high, because provider parsing, annual/quarterly statement normalization, metric assembly, audit-row shaping, WACC/ROIC/Growth fallback logic, and display formatting live together. Existing coverage: `tests/api/test_corporate_metric_audit.py`, `tests/api/test_corporate_growth_metrics.py`, and `tests/core_finance/test_corporate_statement_metric_helpers.py`. Smallest useful extraction target: move statement-series parsing/normalization and repeated audit-input/display builders into named helpers with characterization tests for missing provider data, invalid numeric values, fallback metrics, and legacy/stable metadata.
  - Candidate 2: `apps/api/services/corporate_comparison.py` (`apps/api/services`, 1002 lines). Risk: high, because live comparison generation, durable snapshot projection writes, history/version reads, stock-history reads, universe resolution, and expected-return row assembly share one module. Existing coverage: `tests/api/test_corporate_comparison.py`. Smallest useful extraction target: split universe resolution and snapshot row serialization/projection metadata into focused helpers before changing query behavior.
  - Candidate 3: `apps/api/services/market_data.py` (`apps/api/services`, 923 lines). Risk: medium-high, because provider fetching, OHLCV persistence, freshness/cache policy, technical indicator calculation, overview aggregation, and market-regime classification are coupled. Existing coverage: `tests/api/test_market_data_period_coverage.py`, `tests/api/test_market_index_detail.py`, and `tests/api/test_stock_price_lookup.py`. Smallest useful extraction target: extract market-regime classification and technical summary predicates into named rule helpers, preserving current OHLCV freshness behavior.
  - Candidate 4: `apps/web/app/portfolio/page.tsx` (`apps/web`, 2749 lines). Risk: high, because page composition, React Query ownership, browser/session cache, mutation flows, allocation autosave, snapshot review, attribution display, and table rendering are mixed. Existing coverage: `apps/web/tests/e2e/portfolio-watchlist.spec.ts`, `portfolio-snapshot-history.spec.ts`, and related Portfolio E2E specs. Smallest useful extraction target: extract command-flow hooks for watchlist/allocation/snapshot mutations or derived-view helpers for portfolio comparison/attribution before moving UI sections.
  - Candidate 5: `apps/web/app/corporate/page.tsx` (`apps/web`, 1269 lines). Risk: high, because ticker selection, assumptions, DCF streaming, comparison refresh, source-data refresh, raw dataset assembly, and page layout remain in one route component. Existing coverage: `apps/web/tests/e2e/corporate-comparison.spec.ts` plus backend DCF/comparison tests. Smallest useful extraction target: extract DCF refresh/stream state or raw-dataset assembly into focused hooks/helpers with unchanged query keys and refresh semantics.
  - Candidate 6: `apps/web/components/market/MarketOverviewClient.tsx` (`apps/web`, 760 lines). Risk: medium, because market overview cards, detail modal query, chart-series building, indicator sections, stale/freshness labels, and instrument-type behavior share one client component. Existing coverage: `apps/web/tests/e2e/market-overview.spec.ts` and backend market-detail tests. Smallest useful extraction target: extract detail modal data shaping and indicator-section builders before splitting visual components.
  - Candidate 7: `apps/web/app/portfolio/components/StockDetailModal.tsx` (`apps/web`, 683 lines). Risk: medium, because modal fetch state, corporate metric display, watchlist membership actions, and chart/detail rendering are mixed. Existing coverage: portfolio watchlist and stock-detail E2E flows. Smallest useful extraction target: extract membership/action state and metric display selectors while preserving loading, empty, error, and success states.
  - Candidate 8: `apps/api/services/corporate_metrics_service.py` (`apps/api/services`, 478 lines). Risk: medium, because fallback company/sector defaults, company registry commands, metric persistence, valuation parameter shaping, and market-price lookup are colocated. Existing coverage: `tests/api/test_corporate_growth_metrics.py`, `tests/api/test_corporate_metric_audit.py`, and DCF streaming tests. Smallest useful extraction target: convert sector default adjustments into a named rule table or predicate list, then characterize fallback behavior before changing branches.
  - Deferred candidates: `apps/api/services/news_service.py`, `apps/api/services/webscrap/*`, `apps/api/routes/portfolio.py`, and `apps/api/routes/report.py` show broad catches or route-local orchestration, but they are outside the current finance/calculation hot path; keep them for a later reliability-focused pass.
  - Verification: inventory evidence came from `rg` hotspot searches for broad catches, repeated conditions, nested branch markers, and route/service responsibility markers; line counts were captured for the selected candidates. No runtime tests were required because this slice only records the pre-edit inventory.
- O2B Step 1 characterization tests added on 2026-05-01 for Candidate 1, `apps/api/services/corporate_statement_metrics.py`:
  - added direct tests in `tests/api/test_corporate_metric_audit.py` for missing Yahoo provider bundles with saved SQLite metric fallback and deterministic default-model fallback
  - locked current audit behavior for fallback source modes, warning text, method names, calculation versions, ROIC/WACC/spread input fields, and DCF placeholder metadata before any structural refactor
  - retained existing characterization coverage in the same file for missing overlapping years, non-positive invested capital, suspicious tiny invested capital, fallback tax rate, invalid growth, and unified audit payload shape
  - verification: `python -m py_compile tests\api\test_corporate_metric_audit.py` passed; sandbox `pytest tests\api\test_corporate_metric_audit.py -q` hit Windows temp cleanup `PermissionError`, then escalated `pytest tests\api\test_corporate_metric_audit.py -q` passed with 6 tests
- O2B Step 2 guard-clause refactor completed on 2026-05-01 for Candidate 1, `apps/api/services/corporate_statement_metrics.py`:
  - extracted guard-clause helpers for ROIC record selection, ROIC basis value selection, statement debt ratio fallback, debt-to-equity fallback, capital weights, nullable record values, nullable money display, and optional reason conversion
  - flattened nested and repeated conditional expressions inside `metric_audit_for_ticker()` without changing formula policy, API contracts, audit field names, or fallback semantics
  - kept the normal Yahoo audit path visually dominant while invalid, unavailable, or fallback values exit through small helper functions
  - verification: `python -m py_compile apps\api\services\corporate_statement_metrics.py tests\api\test_corporate_metric_audit.py` passed; `pytest tests\api\test_corporate_metric_audit.py -q` passed with 6 tests; sandbox `pytest tests\api\test_corporate_growth_metrics.py -q` hit Windows temp cleanup `PermissionError`, then escalated `pytest tests\api\test_corporate_growth_metrics.py -q` passed with 6 tests
- O2B Step 3 broad-exception review completed on 2026-05-02 for Candidate 1, `apps/api/services/corporate_statement_metrics.py`:
  - confirmed the candidate has no remaining blanket `except Exception`, `except BaseException`, or frontend-style `catch (error)` handlers
  - retained only explicit provider/import guards for known Yahoo/yfinance missing-data paths and explicit numeric parse guards for statement value conversion
  - added regression tests proving known provider missing-data errors return `None`, while unexpected provider bugs are not converted into silent missing-data fallbacks
  - verification: `python -m py_compile apps\api\services\corporate_statement_metrics.py tests\api\test_corporate_metric_audit.py` passed; `pytest tests\api\test_corporate_metric_audit.py -q` passed with 8 tests; `rg` confirmed no blanket handlers in the target or focused audit test file
- O2B Step 4 condition-name extraction completed on 2026-05-02 for Candidate 1, `apps/api/services/corporate_statement_metrics.py`:
  - extracted named predicates for missing market capitalization, missing capital-structure inputs, WACC sanity bounds, valid capital-ratio inputs, valid debt-to-equity inputs, stable Growth CAGR availability, positive debt balance, and decision-grade ROIC eligibility
  - replaced inline WACC rule lambdas and repeated metric/audit branch expressions with those predicates so the business intent is visible at each call site
  - kept predicates pure and typed; no formulas, response fields, audit metadata, or fallback behavior changed
  - verification: `python -m py_compile apps\api\services\corporate_statement_metrics.py tests\api\test_corporate_metric_audit.py` passed; `pytest tests\api\test_corporate_metric_audit.py -q` passed with 8 tests; `pytest tests\api\test_corporate_growth_metrics.py -q` passed with 6 tests
- O2B Step 5 loop and condition simplification completed on 2026-05-02 for Candidate 1, `apps/api/services/corporate_statement_metrics.py`:
  - replaced repeated annual and quarterly statement parsing loops with a shared validated year/value generator and list/dict comprehensions
  - removed a duplicated revenue/Growth payload preparation block in `yahoo_statement_metrics()` so the same source statement maps are not rebuilt before the real validation branch
  - centralized current-year filtering and reused the positive-debt predicate for cost-of-debt fallback checks
  - kept this slice Python-only because the active O2B candidate is the backend service; TypeScript simplification remains in the frontend candidates recorded in the inventory
  - verification: `python -m py_compile apps\api\services\corporate_statement_metrics.py tests\api\test_corporate_metric_audit.py` passed; `pytest tests\api\test_corporate_metric_audit.py -q` passed with 8 tests; `pytest tests\api\test_corporate_growth_metrics.py -q` passed with 6 tests
- O2B Step 6 rule-list consolidation completed on 2026-05-02 for Candidate 1, `apps/api/services/corporate_statement_metrics.py` and its reusable `packages/core_finance/corporate_statement_metrics.py` helpers:
  - converted duplicated Growth rejection branches into ordered `GROWTH_QUALITY_RULES` with names, predicates, and user-visible notes
  - added `GrowthQualityContext` and `assess_growth_quality()` so `stable_growth_payload()` selects the first matching rejection rule before returning the unchanged payload shape
  - kept existing WACC and ROIC rule-list behavior intact while adding tests that expose Growth rule order and prove highest-priority Growth rejection wins when multiple rules could match
  - verification: `python -m py_compile packages\core_finance\corporate_statement_metrics.py apps\api\services\corporate_statement_metrics.py tests\core_finance\test_corporate_statement_metric_helpers.py tests\api\test_corporate_metric_audit.py` passed; `pytest tests\core_finance\test_corporate_statement_metric_helpers.py -q` passed with 13 tests; `pytest tests\api\test_corporate_metric_audit.py -q` passed with 8 tests; `pytest tests\api\test_corporate_growth_metrics.py -q` passed with 6 tests
- O2B Step 7 stable-rule data conversion and Candidate 1 completion completed on 2026-05-02:
  - converted WACC sanity bounds from standalone service constants into a named `WACC_SANITY_RULE` data object with explicit percent units, then reused that rule in WACC quality predicates
  - removed duplicate service-local stable finance threshold definitions for tax rate, invested capital, ROIC sanity, revenue, and Growth CAGR by importing the canonical values from `packages/core_finance/corporate_statement_metrics.py`
  - added API coverage that exposes WACC rule names, order, and sanity bounds, complementing core-finance coverage for tax, invested-capital, revenue, ROIC, and Growth policy data
  - Candidate 1 completion check: characterization tests existed before structural edits; public API/audit payload behavior was preserved; duplicated loops, branches, exception handling, and stable threshold copies were reduced; routes stayed thin while reusable formula policy remained in `packages/core_finance`; narrow and candidate-level regression tests passed
  - verification: `python -m py_compile packages\core_finance\corporate_statement_metrics.py apps\api\services\corporate_statement_metrics.py tests\api\test_corporate_metric_audit.py tests\core_finance\test_corporate_statement_metric_helpers.py` passed; `pytest tests\api\test_corporate_metric_audit.py -q` passed with 9 tests; `pytest tests\core_finance\test_corporate_statement_metric_helpers.py -q` passed with 13 tests; `pytest tests\api\test_corporate_growth_metrics.py -q` passed with 6 tests

Track O3 - Frontend Render And Bundle Optimization:
- [x] Break `apps/web/app/portfolio/page.tsx` into route-owned container logic plus smaller presentational sections without moving query ownership into leaf components.
- [x] Break `apps/web/app/corporate/page.tsx` and `buildCalculationDetails.ts` into feature-specific modules while preserving current UI behavior and query refresh semantics.
- [x] Dynamically load chart-heavy or modal-only UI where safe, especially Recharts/lightweight-chart sections that are not needed for initial route paint.
- [x] Audit React Query keys, `enabled` gates, `staleTime`, and mutation invalidation to remove redundant refetches after watchlist, comparison, DCF, and source-data actions.
- [x] Add focused render-regression or E2E coverage before refactoring high-risk pages with dense local state.
- [x] Separate command UI flows from query display state where pages currently mix mutation logic, optimistic updates, fetch state, and derived presentation data in one component.
- [x] Extract named predicates and derived-view helpers from dense JSX conditionals before moving component boundaries, so behavior remains reviewable.

Track O3 progress:
- O3 Portfolio render split completed on 2026-05-02:
  - extracted the attribution KPI, benchmark-methodology, allocation chart, and attribution waterfall view from `apps/web/app/portfolio/page.tsx` into `apps/web/app/portfolio/components/PortfolioAttributionSummary.tsx`
  - kept `PortfolioPage` as the owner of React Query state, cache state, attribution trigger snapshots, and derived chart data; the new component is presentational and receives already-derived props
  - removed page-local chart imports for this attribution block without changing API contracts, query keys, mutation behavior, or route ownership
  - verification: `npm.cmd run lint -- app/portfolio/page.tsx app/portfolio/components/PortfolioAttributionSummary.tsx` passed; `npm.cmd run build` passed; `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts` passed with 10 tests
- O3 Corporate render split completed on 2026-05-02:
  - extracted comparison sorting, similar-peer chart adapters, watchlist coverage, and raw dataset assembly from `apps/web/app/corporate/page.tsx` into `apps/web/app/corporate/corporateDerivedViews.ts`
  - extracted calculation-detail formatting helpers from `apps/web/app/corporate/buildCalculationDetails.ts` into `apps/web/app/corporate/calculationDetailFormatters.ts`
  - preserved `CorporateAnalysisPage` ownership of React Query keys, cache snapshots, source-data refresh, DCF stream refresh, comparison refresh tokens, and mutation-free UI state
  - verification: `npm.cmd run lint -- app/corporate/page.tsx app/corporate/buildCalculationDetails.ts app/corporate/corporateDerivedViews.ts app/corporate/calculationDetailFormatters.ts` passed; `npm.cmd run build` passed; `npm.cmd run test:e2e -- tests/e2e/corporate-comparison.spec.ts` passed with 3 tests
- O3 dynamic loading completed on 2026-05-02:
  - dynamically loaded Portfolio stock-detail and snapshot-history modals, Corporate calculation-detail modal, and Portfolio attribution Recharts panels with stable loading placeholders
  - left Corporate graph modules on the existing dynamic-loading path and preserved all route-level query keys, refresh tokens, cache snapshots, and modal open/close gates
  - verification: local Next lazy-loading docs under `apps/web/node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` were checked; `npm.cmd run lint -- app/portfolio/page.tsx app/portfolio/components/PortfolioAttributionSummary.tsx app/corporate/page.tsx` passed; `npm.cmd run build` passed; `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts` passed with 10 tests; first corporate E2E attempt hit transient Playwright web-server `EADDRINUSE` on port 3101 with only `TIME_WAIT` connections visible, then `npm.cmd run test:e2e -- tests/e2e/corporate-comparison.spec.ts` passed with 3 tests on retry
- O3 React Query cache audit completed on 2026-05-02:
  - removed the portfolio watchlist mutation path that invalidated and actively refetched `portfolio-attribution`; attribution now refreshes only through the explicit portfolio-analysis refresh token and request snapshot
  - kept watchlist mutations refreshing the portfolio watchlist and sync status while marking `portfolio-browser-companies`, `corporate-companies`, and `corporate-watchlist-holdings` stale for dependent browser/corporate views
  - kept allocation-only autosaves as watchlist-cache patches without company-registry invalidation, so repeated weight edits do not refresh unrelated company lists
  - raised Corporate Analysis company/watchlist query `staleTime` to 60 seconds and disabled focus refetch; cross-page watchlist changes now flow through explicit invalidation instead of window-focus polling
  - confirmed comparison, DCF, and source-data actions already use explicit refresh-token `queryKey`/`enabled` gates and did not need broad invalidation
  - verification: `npm.cmd run lint -- app/portfolio/page.tsx app/corporate/page.tsx tests/e2e/refresh-idle-state.spec.ts` passed; `npm.cmd run build` passed; full `npm.cmd run test:e2e -- tests/e2e/refresh-idle-state.spec.ts` had one unrelated corporate selector timeout, while the focused portfolio cache-regression rerun passed; `npm.cmd run test:e2e -- tests/e2e/corporate-comparison.spec.ts` passed with 3 tests; `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts` passed with 10 tests
- O3 high-risk render-regression coverage completed on 2026-05-02:
  - added `apps/web/tests/e2e/high-risk-render-regression.spec.ts` before further dense-state refactors
  - covered Portfolio analysis after explicit refresh, attribution chart rendering, comparison mode/universe/benchmark/custom-ticker state persistence, holdings Graph/Table switching, mobile table fallback, and allocation workspace rendering
  - covered Corporate Analysis diagnostics chart rendering, subjective-health toggle state, DCF refresh, custom comparison state, comparison chart rendering, and mobile preservation of comparison controls
  - verification: `npm.cmd run lint -- tests/e2e/high-risk-render-regression.spec.ts` passed; `npm.cmd run test:e2e -- tests/e2e/high-risk-render-regression.spec.ts` passed with 2 tests after initial sandbox `spawn EPERM` required escalation; `npm.cmd run build` passed
- O3 command/query UI separation slice completed on 2026-05-02:
  - extracted the Portfolio stock-search, manual-add, JSON export/import, and sync-status command surface from `apps/web/app/portfolio/page.tsx` into `apps/web/app/portfolio/components/PortfolioCommandCenter.tsx`
  - kept `PortfolioPage` as the owner of React Query mutations, cache invalidation, optimistic watchlist cache patches, command handlers, query display data, and derived allocation/comparison presentation data
  - left `PortfolioCommandCenter` presentational: it receives command values, pending flags, sync status, and callbacks, but does not own query keys or mutation side effects
  - verification: `npm.cmd run lint -- app/portfolio/page.tsx app/portfolio/components/PortfolioCommandCenter.tsx tests/e2e/high-risk-render-regression.spec.ts` passed; `npm.cmd run test:e2e -- tests/e2e/high-risk-render-regression.spec.ts` passed with 2 tests; `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts` passed with 10 tests; `npm.cmd run build` passed
- O3 named predicate extraction completed on 2026-05-02:
  - extracted Portfolio stale-snapshot checks into `isPortfolioComparisonSnapshotStale`, `isPortfolioComparisonHistorySnapshotStale`, and `isPortfolioAttributionSnapshotStale`
  - extracted dense Portfolio JSX branches into named view-state helpers for snapshot history, comparison summary, attribution, and watchlist rendering
  - kept the helpers local to `apps/web/app/portfolio/page.tsx` so behavior remains easy to review before any future component-boundary moves
  - verification: `npm.cmd run lint -- app/portfolio/page.tsx app/portfolio/components/PortfolioCommandCenter.tsx tests/e2e/high-risk-render-regression.spec.ts` passed; `npm.cmd run test:e2e -- tests/e2e/high-risk-render-regression.spec.ts` passed with 2 tests; `npm.cmd run test:e2e -- tests/e2e/portfolio-watchlist.spec.ts` passed with 10 tests; `npm.cmd run build` passed

Track O4 - Data, Cache, And Runtime Reliability:
- [x] Document cache ownership and invalidation for corporate metrics, DCF, comparison snapshots, portfolio attribution, market detail, and news feeds.
  - Completed on 2026-05-02 in `docs/architecture/cache-ownership-invalidation.md`.
  - Captures source-of-truth tables, frontend React Query/session keys, backend TTL/provider caches, durable comparison snapshot ownership, stale-read tolerance, and mutation invalidation scope for corporate metrics/audit, DCF, comparison snapshots, portfolio attribution/reporting, market detail/price lookup, and news feeds.
  - Verification: targeted source trace with `rg` over the owning frontend query keys and backend cache services; markdown file path confirmed with `rg`.
- [x] Add guardrails for stale or mismatched ticker snapshots wherever browser session cache is used.
  - Completed on 2026-05-02.
  - Corporate DCF session cache now suppresses cached valuation payloads when the cached snapshot ticker differs from the active ticker, keeping the Backend DCF card in the refresh-to-calculate state instead of rendering another ticker's valuation as stale data.
  - Portfolio comparison, snapshot-history, and attribution session caches now render only when their cached request snapshot still matches the active holdings signature, universe, benchmark, custom ticker input, ticker list, weights, and date filters; mismatches withhold cached payloads until a matching query result or explicit refresh exists.
  - Documentation updated in `docs/architecture/cache-ownership-invalidation.md`.
  - Verification: `npm.cmd run lint -- app/corporate/page.tsx app/portfolio/page.tsx tests/e2e/refresh-idle-state.spec.ts`; `npm.cmd run test:e2e -- tests/e2e/refresh-idle-state.spec.ts`.
- [x] Review cache size and TTL defaults for local-first usage so memory growth is bounded without making interactive paths stale too quickly.
  - Completed on 2026-05-02.
  - Corporate Yahoo statement cache is now a bounded `TTLCache` with defaults `maxsize=48`, `ttl=300`, configurable through `MONEYVIEW_YAHOO_STATEMENT_CACHE_MAXSIZE` and `MONEYVIEW_YAHOO_STATEMENT_CACHE_TTL_SECONDS`.
  - Market-data live provider fetch cache is now a bounded `TTLCache` with defaults `maxsize=96`, `ttl=30`, configurable through `MONEYVIEW_LIVE_FETCH_CACHE_MAXSIZE` and `MONEYVIEW_LIVE_FETCH_CACHE_TTL_SECONDS`.
  - Portfolio attribution/report backend caches now default to smaller local-first working sets: attribution `maxsize=128`, `ttl=180`; report `maxsize=64`, `ttl=180`, with `MONEYVIEW_ATTRIBUTION_CACHE_*` and `MONEYVIEW_REPORT_CACHE_*` overrides.
  - React Query defaults were reviewed and left at 1 minute `staleTime` plus 5 minute `gcTime` in `apps/web/components/providers/AppProvider.tsx`; heavy paths remain guarded by refresh tokens or `enabled` gates.
  - Documentation updated in `docs/architecture/cache-ownership-invalidation.md`.
  - Verification: initial sandboxed `pytest tests/api/test_stock_price_lookup.py tests/api/test_market_index_detail.py tests/api/test_corporate_metric_audit.py tests/api/test_portfolio_attribution.py -q --basetemp=E:\MoneyView\pytest-cache-ttl-review` hit the known Windows pytest temp cleanup `PermissionError`; escalated rerun with `--basetemp=E:\MoneyView\pytest-cache-ttl-review-2` passed with 33 tests.
- [x] Exclude generated runtime artifacts such as `.next`, pytest temp directories, and local DB scratch files from optimization scans and git status noise.
  - Completed on 2026-05-02.
  - `.gitignore` now covers `.next`, `apps/web/.next`, `.pytest-basetemp`, `.tmp`, `.tmp-codex-pytest`, pytest temp directories, and local SQLite/DB scratch files so new generated artifacts stay out of git status.
  - Added `.rgignore` with matching generated-runtime exclusions so optimization/code scans skip frontend build output, pytest temp trees, local data caches, and scratch DB files.
  - Removed already tracked generated DB/cache artifacts from the Git index with `git rm --cached --ignore-unmatch` without deleting local files.
  - Verification: `git ls-files "*.db" ".tmp/**" "pytest*/**" "apps/web/.next/**" "data/cache/**" "data/processed/**"` returned no tracked generated artifact paths; `rg -n "moneyview.db|phase4a_check|pytest-cache-ttl-review|cache-ownership" .` completed without temp-directory permission noise.
- [x] Treat cache-backed or stored projections as read models: define their source write model, projection path, invalidation trigger, and stale-read tolerance.
  - Completed on 2026-05-03 in `docs/architecture/cache-ownership-invalidation.md`.
  - Added a read model registry that distinguishes durable stored projections from frontend/session and backend TTL read-side optimizations.
  - Defined source write model, projection path, invalidation trigger, and stale-read tolerance for corporate comparison snapshots, corporate metric/audit cache-backed payloads, DCF session reads, portfolio comparison/history/attribution session reads, portfolio backend attribution/report TTL caches, market detail/price lookup cache-backed views, and news feed query reads.
  - Verification: targeted source trace with `rg` over CQRS/cache docs plus corporate comparison snapshot services, frontend session-cache/query invalidation paths, backend TTL caches, and cache freshness metadata.


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