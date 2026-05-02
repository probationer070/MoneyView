# MoneyView CQRS Read/Write Separation

This note defines where MoneyView currently separates command-side writes from query-side reads, and where it should not add projection storage yet.

## Decision Rule

Use CQRS only when all of these are true:

- the write model is already a stable source of truth
- the read path repeatedly derives UI or analytics fields from unchanged source data
- the read result needs different shape, indexing, retention, or staleness metadata than the write model
- tests can prove projection creation, invalidation, stale fallback, or rebuild behavior

Do not add a read model just to move code. Request-scoped calculations should stay request-scoped when they are cheap, user-assumption-specific, or not reused across views.

## Current Endpoint Inventory

| Area | Endpoint family | Current source of truth | Repeated derivation | CQRS decision |
| --- | --- | --- | --- | --- |
| Corporate comparison | `/api/v1/corporate/comparison*` | `watchlist`, `corporate_companies`, `corporate_metrics`, market price cache | high: per-row metrics, price, DCF value, expected-return spread | keep and formalize existing snapshot read model |
| Corporate metrics and audit | `/api/v1/corporate/metrics/{ticker}*` | Yahoo statement bundle plus `corporate_metrics` fallback | medium: ROIC, growth, WACC, audit metadata | no new persisted read model yet; provider bundle cache is enough until timing shows repeated-source cost |
| Corporate DCF | `/api/v1/corporate/dcf/{ticker}*` | request assumptions plus effective metrics | high but assumption-specific | no shared projection; results depend on user inputs and should remain request-scoped unless saved scenarios are introduced |
| Portfolio attribution/report | `/api/v1/portfolio/attribution`, `/api/v1/report/*` | `watchlist`, OHLCV cache, request benchmark options | medium: attribution and report reuse | keep TTL cache only; add persisted projection only if endpoint timing shows repeated identical requests beyond cache tolerance |
| Market detail | `/api/v1/market/index/{ticker}/detail`, `/api/v1/detail/{ticker}/*` | `stocks` and `indices` OHLCV tables | medium: technical indicators from unchanged bars | no persisted projection yet; explicit OHLCV freshness plus provider cache keeps ownership simpler |
| Watchlist and company registry mutations | `/api/v1/portfolio/watchlist*`, `/api/v1/corporate/companies*` | SQLite tables | low | command-side only; query endpoints read canonical rows directly |

## Current Read Model

### Corporate Comparison Snapshot

`corporate_comparison_snapshots_v3` is the current durable query-side read model.

Command-side sources:

- `watchlist`
- `corporate_companies`
- `corporate_metrics`
- latest market price data from `MarketDataService`
- comparison request controls such as universe, benchmark ticker, custom tickers, risk-free rate, and equity risk premium

Projection path:

1. `save_corporate_comparison_snapshot()` builds the live comparison response.
2. The service writes each projected comparison row to `corporate_comparison_snapshots_v3`.
3. The row includes source controls, snapshot version, snapshot date, snapshot source, expected-return method metadata, and derived per-ticker values.
4. Retention cleanup removes rows older than the configured retention window.

Query-side owners:

- `build_corporate_comparison_response(mode="snapshot")`
- corporate comparison history queries
- snapshot-version drill-down
- stock-history timeline queries

Projection triggers:

- explicit manual refresh through `POST /api/v1/corporate/comparison/snapshot`
- on-demand scheduled materialization when snapshot mode has no current KST business-date snapshot

Consistency rule:

- comparison snapshot reads may be stale for dashboard/table continuity
- stale fallback is acceptable only when the response marks `snapshot_is_stale=true`
- same-day manual refreshes create new versions instead of overwriting earlier rows
- snapshot metadata must include version, source, date, cadence, retention, and universe controls

Existing verification:

- `tests/api/test_corporate_comparison.py` covers snapshot creation, live mode not overwriting snapshots, history, version drill-down, delete, stock history, KST business date, retention, and multiple same-day versions.

## Command-Side Ownership

Command functions are responsible for validated writes and source-of-truth changes:

- watchlist upsert/delete/sync/resync writes `watchlist`, `dataset_metadata`, and sometimes `stock_targets.json`
- corporate company add writes `corporate_companies` and default `corporate_metrics` seed rows
- corporate metric save writes `corporate_metrics`
- corporate comparison snapshot refresh writes `corporate_comparison_snapshots_v3`

Command functions should raise service or domain errors. Routes should map those errors to HTTP responses.

## Calculation Command Responsibilities

Calculation command responsibilities are narrower than "anything that calculates." A command owns source-of-truth inputs, validation, and write-side state transitions that later queries may read.

### Command-Owned Source Inputs

The command side owns these persisted or source-of-truth inputs:

| Source input | Current owner | Command responsibility |
| --- | --- | --- |
| Raw provider statements | `get_yahoo_statement_bundle()` and future provider refresh commands | preserve source fidelity, ticker identity, statement period labels, and provider timestamps before formulas consume the data |
| Ticker OHLCV snapshots | `MarketDataService` refresh/save paths | validate ticker identity, bar date, OHLCV numeric shape, provider freshness, and table ownership before rows enter `stocks` or `indices` |
| Portfolio holdings and watchlist state | portfolio watchlist routes plus `watchlist_seed.py` | normalize ticker, name, sector, group, weight, sync source, and managed-state metadata before writes |
| Corporate company registry | `corporate_metrics_service.add_company()` | normalize ticker/name/sector/source and seed default metrics without embedding UI display decisions |
| Corporate metric overrides | `corporate_metrics_service.save_metrics()` | persist user-provided metric inputs as source assumptions, keeping legacy and stable fields reproducible |
| Corporate comparison snapshots | `save_corporate_comparison_snapshot()` | materialize one versioned read projection from current source controls and derived row values |
| User valuation assumptions | DCF request models today; future saved-scenario commands if introduced | validate assumption ranges and units before calculation, but do not persist request-scoped DCF results as canonical state |
| Formula policy versions | `packages/core_finance` constants/rule tables plus API calculation-version metadata | preserve old calculation meanings and introduce new versions rather than rewriting historical semantics |

### Validation Before Calculation

Command-side validation must happen before source data becomes calculation input:

- Tickers are uppercased and stripped at write boundaries.
- Provider statements must keep annual vs quarterly periods explicit.
- Currency/unit assumptions must be preserved with the source or disclosed in audit metadata; they should not be inferred silently in a read payload.
- Missing provider fields should become explicit missing-data states, not zero-filled source facts.
- User-provided assumptions must pass Pydantic/domain bounds before DCF, attribution, or projection code consumes them.
- Formula-version changes must create versioned outputs or metadata so legacy and stable calculations can coexist.

### Error Boundary

Command services should raise domain or service errors such as `ValueError`, SQLite errors, or provider-specific failures. HTTP concerns stay at route boundaries:

- route handlers map missing snapshot versions to `404`
- watchlist sync/resync routes map command-side `ValueError` to conflict or validation HTTP responses
- report and portfolio routes map invalid request combinations to `422`

Command services should not raise `HTTPException`, return API envelopes, or decide status codes.

### Write Model Shape

Write models should preserve source fidelity and auditability:

- Store canonical identifiers and raw source controls, such as ticker, sector, snapshot version, benchmark ticker, custom ticker list, source label, and timestamp.
- Keep calculation-version metadata near formula-derived values.
- Avoid fields that exist only because a chart, badge, modal, or table needs a convenient display label.
- Keep UI-specific grouping, sorting, filtering, and display text in query services or frontend adapters.

Current acceptable exception:

- `corporate_comparison_snapshots_v3` is a query-side read model intentionally written by a projection command. It stores derived display-ready comparison values because its purpose is snapshot history and dashboard/table reads, not source-of-truth mutation.

## Query-Side Ownership

Query functions are responsible for UI and analytics response shapes:

- corporate metrics query shapes effective metric payloads and audit metadata
- corporate comparison query shapes comparison rows, snapshot metadata, history points, and stock timelines
- portfolio analytics query shapes attribution/report payloads and cache metadata
- market data query shapes OHLCV, freshness metadata, technical indicators, and market regime summaries

Query functions should not mutate canonical source-of-truth tables as a hidden side effect. The exception is an explicitly documented projection path such as corporate comparison snapshot materialization.

## Calculation Query Responsibilities

Calculation query responsibilities start after source inputs and command-side validation are settled. A query owns read-optimized calculation output, not the source facts that made the calculation possible.

### Query-Owned Calculation Outputs

The query side owns these calculation response shapes:

| Output | Current owner | Query responsibility |
| --- | --- | --- |
| Corporate metric summaries | `corporate_metrics_service.default_metrics()` and related corporate metric services | return effective ROIC, growth, margins, valuation inputs, quality flags, warnings, and calculation versions in the shape consumed by Corporate Analysis and downstream valuation flows |
| ROIC/Growth audit records | `apps/api/services/corporate_statement_metrics.py` | expose method, quality, confidence, notes, warnings, raw supporting values, legacy fields, and stable fields without changing provider source rows |
| DCF parameter and report views | `apps/api/services/corporate_dcf.py` plus corporate route response models | shape validated metric inputs and user assumptions into lightweight phase summaries, full report rows, WACC breakdowns, warnings, and calculation-version metadata |
| Corporate comparison tables | `apps/api/services/corporate_comparison.py` | shape sortable per-ticker rows, expected-return spreads, snapshot metadata, history summaries, and stock timelines from source controls and metric reads |
| Portfolio attribution summaries | portfolio attribution/report services | shape holdings, benchmark inputs, latest prices, attribution buckets, synthetic fallback metadata, and report sections for analytics reads |
| Market technical summaries | `MarketDataService` and detail route services | shape OHLCV reads into technical indicators, market regimes, freshness metadata, and chart-ready series |
| Chart-ready series | API query services or frontend adapters depending on endpoint ownership | convert calculation outputs into display-oriented points, labels, confidence states, and empty/fallback states without writing those shapes back to source models |

### Query Model Shape

Query models may optimize for UI and analytics needs:

- Sort, group, filter, and enrich rows for tables, charts, summaries, modals, and audit panels.
- Include display metadata such as quality labels, warning lists, confidence labels, source timestamps, stale flags, and calculation-version strings.
- Keep legacy and stable calculation variants side by side when the UI needs migration visibility or audit comparison.
- Precompute or cache expensive derived values only when the same source inputs are read repeatedly and the cache or projection has an explicit freshness rule.

Query models must not feed those UI shapes back into command/write models. If a query output becomes the basis for a durable projection, document it as a read model with a source write model, projection trigger, invalidation rule, and stale-read behavior.

## Calculation Projection Boundaries

These boundaries define where MoneyView may introduce or keep read projections for expensive calculation families.

| Calculation family | Source write model | Query output | Projection boundary |
| --- | --- | --- | --- |
| Corporate statements | Yahoo statement bundle plus `corporate_metrics` fallback rows | stable ROIC, Growth/CAGR, margins, leverage, quality metadata, and metric audit rows | candidate read model only after timing shows repeated provider-stable recalculation; projection key should include ticker, statement period, source timestamp, and calculation version |
| DCF | validated request assumptions plus effective corporate metric inputs | valuation parameter snapshots, scenario outputs, warnings, projection rows, WACC breakdown, and calculation-version metadata | request-scoped today; persist only if saved scenarios are introduced, keyed by ticker, assumption set, metric source version, and formula version |
| Corporate comparison | watchlist/company/metric rows, latest price data, and comparison controls | sortable comparison rows, expected-return spreads, aggregate summaries, history rows, and stock timelines | existing durable projection is `corporate_comparison_snapshots_v3`; manual refresh and scheduled materialization write versioned snapshot rows |
| Portfolio analytics | portfolio holdings/watchlist rows, transaction-like inputs where available, latest prices, and benchmark controls | attribution, exposure, risk, history, and report summaries | keep TTL/read cache until measured repeated identical reads justify storage; future projection must be scoped by account/universe, portfolio hash, benchmark, as-of date, and price freshness |
| Market detail | `stocks` and `indices` OHLCV rows plus provider freshness metadata | technical indicators, market regime summaries, freshness metadata, and chart-ready OHLCV/indicator series | no persisted projection yet; use explicit OHLCV freshness and provider-fetch caching until technical recomputation is a measured bottleneck |

Projection outputs should carry enough metadata for users and tests to understand their freshness: source timestamp, projection build timestamp, calculation version, input controls, and stale/fallback flags where applicable.

## Projection Triggers And Invalidation

Every persisted read projection must define both a build trigger and an invalidation trigger before storage is added. Invalidation may rebuild the projection immediately, mark it stale for fallback reads, or delete it so the next query rebuilds it, but the behavior must be explicit and tested.

| Projection family | Build trigger | Invalidation trigger | Required invalidation scope |
| --- | --- | --- | --- |
| Corporate statement metrics and audit | provider statement refresh, manual metric refresh, or formula-version rollout | changed Yahoo statement bundle, changed fallback `corporate_metrics` row, missing provider field classification change, or formula-policy version change | affected ticker, statement period, metric family, and calculation version |
| DCF saved scenario projection | explicit saved-scenario command if saved scenarios are introduced | user assumption change, effective metric source change, risk-free rate/equity premium policy change, or formula-version rollout | one ticker plus one assumption set/scenario id; unrelated source-data projections stay untouched |
| Corporate comparison snapshot | manual comparison refresh or scheduled/on-demand snapshot materialization | watchlist/company/metric change, benchmark/custom universe change, price refresh used by the snapshot, expected-return policy change, or formula-version rollout | one universe key, snapshot version, snapshot date, benchmark, custom ticker set, and affected ticker rows |
| Portfolio attribution projection | explicit attribution rebuild after measured repeated-read need | holding/weight change, transaction-like source change, benchmark change, latest-price refresh, synthetic fallback policy change, or formula-version rollout | one account/universe, portfolio hash, benchmark, as-of date, and affected tickers |
| Market technical projection | OHLCV refresh or explicit technical-summary rebuild | new/changed OHLCV bar, provider freshness rule change, indicator parameter change, or formula-version rollout | one ticker, table family (`stocks` or `indices`), period, latest bar date, and indicator version |

Global invalidation rules:

- Provider/source-data refresh invalidates only projections that consumed that ticker/source version.
- Formula-version changes create new versioned projections; they do not rewrite old projection rows in place.
- User assumption changes invalidate only the affected DCF/scenario projection, not corporate statement, market-detail, or portfolio projections.
- Portfolio holding or price updates invalidate only attribution and snapshot reads for the affected account, universe, date, and ticker scope.
- A query may use a stale projection only when the response exposes stale state, projection timestamp, source timestamp, and a refresh path.

## Consistency Rules For Read Models

Read models must define their acceptable consistency behavior before implementation.

| Read surface | Consistency behavior | User-visible metadata |
| --- | --- | --- |
| Decision-grade corporate metrics and audit | prefer synchronous rebuild or explicit missing/stale state when stale data would change the decision | source timestamp, calculation version, method, quality, confidence, warnings, and fallback reason |
| Corporate comparison dashboard/table | may serve stale snapshot rows for continuity when snapshot mode is selected | snapshot date, version, source, `snapshot_is_stale`, universe controls, benchmark, custom tickers, and refresh control |
| DCF saved scenarios, if introduced | saved scenarios are reproducible by assumption set and source version; current live DCF remains request-scoped | scenario id, assumption hash, source metric timestamp/version, formula version, and warnings |
| Portfolio attribution/report | may serve cache-backed or projected reads only within an explicit freshness window | as-of date, portfolio hash, benchmark, latest price timestamp, synthetic fallback flags, stale flag, and refresh control |
| Market technical summaries | may use provider/OHLCV freshness windows; stale technical projections must be obvious when latest bar data is old | latest bar date, provider freshness status, indicator version, projection timestamp, and stale/fallback flags |

Tests for any new read model must cover:

- projection build after the command-side write
- projection invalidation or rebuild after source-data refresh
- missing projection fallback behavior
- stale projection response metadata
- legacy and stable formula-version coexistence when calculation semantics change

## Route Thinness After CQRS Separation

Calculation routes should stay at the HTTP boundary after command/query responsibilities are separated.

Route handlers may:

- parse path, query, body, and request-state inputs
- call command or query services with explicit loaders, policies, or controls
- map known domain/service errors to HTTP responses
- wrap service results in API response envelopes and transport metadata
- handle transport-specific concerns such as Server-Sent Events progress logging

Route handlers should not:

- normalize, deduplicate, or fan out calculation work across a collection of inputs
- build valuation assumptions, projection rows, audit records, comparison rows, or read-model records directly
- mutate source-of-truth records as a hidden side effect of query endpoints
- return UI-specific command payloads beyond minimal mutation confirmation

Current route-thinness status:

- Corporate comparison routes delegate live/snapshot/history/version/stock-history work to `apps/api/services/corporate_comparison.py`.
- Corporate DCF summary, full report, stream, and bulk report routes delegate calculation work to `apps/api/services/corporate_dcf.py`; bulk report ticker normalization and fan-out live in `build_bulk_dcf_reports()`.
- Corporate metric routes delegate effective metrics, fallback metrics, audit, history, quarterly statements, and metric persistence to `corporate_metrics_service` or `corporate_statement_metrics`.
- Shared formula policy remains in `packages/core_finance`; API services own orchestration and API-specific projection behavior.

## Verification Gates For CQRS Calculation Updates

CQRS calculation work is complete only when the verification type matches the change type:

| Change type | Required verification |
| --- | --- |
| Pure formula or rule change | focused `tests/core_finance` coverage for valid, missing, invalid, fallback, and versioned cases |
| Route-thinness service extraction | targeted API tests proving public route behavior is unchanged plus service-level tests for moved orchestration |
| New persisted projection | service tests for build, invalidation/rebuild, missing projection fallback, stale metadata, and version coexistence |
| API contract change | API model/shared-type updates plus API tests and affected E2E mocks |
| Performance-motivated projection | before/after endpoint timing showing repeated-read cost, transfer cost, or ownership clarity improved |

Current verification status:

- Existing corporate comparison snapshot tests cover the accepted durable read model.
- DCF route-thinness extraction is covered by `tests/api/test_corporate_dcf_streaming.py` and the bulk DCF route test in `tests/api/test_corporate_comparison.py`.
- Documentation-only CQRS planning slices were verified with targeted `rg` consistency checks.
- Future persisted projections must add projection-specific service/API tests before their todo items are marked complete.

## Future Projection Candidates

### Corporate Metric Audit Projection

Potential trigger:

- Yahoo statement bundle refresh
- formula-version change
- manual corporate metric override

Potential read model:

- per-ticker, per-calculation-version metric audit rows for growth, ROIC, WACC, spread, and input source metadata

Adopt only if:

- repeated audit reads dominate endpoint timing
- projection can disclose source timestamp and calculation version
- tests cover missing projection fallback and rebuild after provider/source refresh

### Market Technical Projection

Potential trigger:

- OHLCV insert or refresh for a ticker/period

Potential read model:

- per-ticker, per-period technical indicator summary with latest bar date and calculation version

Adopt only if:

- technical calculation becomes a measured bottleneck
- invalidation can be tied cleanly to latest OHLCV date

### Portfolio Attribution Projection

Potential trigger:

- watchlist mutation
- price refresh for held tickers
- benchmark or assumption change

Potential read model:

- account/universe scoped attribution summary and risk metrics

Adopt only if:

- the in-process TTL cache is insufficient for repeated local-first workflows
- the projection can record portfolio hash, benchmark inputs, as-of date, synthetic fallback flags, and stale tolerance

## Non-Projection Decisions

- DCF results remain request-scoped because user assumptions materially change the output.
- Monte Carlo Simulation Lab results remain frontend worker state because they are exploratory and not canonical business data.
- Browser continuity caches are not read models. They are frontend-owned UX continuity state and must stay visibly stale or idle-first for heavy workflows.
