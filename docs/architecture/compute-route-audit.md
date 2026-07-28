# Compute Route Audit (Spec §A-1)

Rule: each browser request must map to exactly ONE compute call. Fan-out lives
inside compute-service, never in a BFF route loop.

Verdicts used below:
- **COARSE** — 0-1 real (substantive) service/compute calls at the route, no
  route-level loop over service calls, no direct DB access. OK as-is for now.
- **OFFENDER** — the route makes ≥2 substantive service calls (chained or
  looped) to assemble one response, or loops over a service call per row/item.
  Must be coarsened into a single compute op.
- **BFF-DB-violation** — the route touches `get_db()` (or DB-backed
  helpers) directly instead of going through a service.

Idempotent bootstrap/seed calls (`ensure_watchlist_bootstrapped`,
`seed_watchlist_from_json_if_empty`) are noted but not counted toward the
≥2-calls threshold — they gate a single real service call, they don't fan out
per item. Internal fan-out done *inside* a service function (e.g. a
`metrics_loader` callback invoked once per ticker inside
`build_corporate_comparison_response`) is server-side and does not violate the
rule; it's exactly the shape Slice 2+ should replicate.

## portfolio.py

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| POST /portfolio/attribution (portfolio.py:203-214) | 1 (`build_attribution`) | no | COARSE — OK as-is | `build_attribution` (Slice 1) |
| GET /portfolio/watchlist (portfolio.py:43-83) | N (`get_stock_ohlcv` per row, line 57) + `get_db` | YES (line 55 `for row in rows`) | OFFENDER — must coarsen | new `list_watchlist_with_quotes` (Slice 2) |
| GET /portfolio/stock/{ticker} (portfolio.py:130-140) | 2 (`_mkt.get_stock_ohlcv` + `_news.get_news`) | no | OFFENDER — 2 calls composed at route | new `build_stock_detail` op combining prices+news server-side |
| GET/PUT /portfolio/preferences (portfolio.py:86-127) | direct `get_db()` at route | no | BFF-DB violation | `get/set_preferences` (Slice 2) |
| POST /portfolio/watchlist, DELETE, resync, sync, sync-status | direct `get_db()` / seed helpers at route | no | BFF-DB violation | watchlist mutation ops (Slice 2) |

## corporate.py

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| GET /corporate/companies (corporate.py:141-144) | 1 (`list_companies`) | no | COARSE | `list_companies` |
| POST /corporate/companies (corporate.py:147-150) | 1 (`add_company`) | no | COARSE | `add_company` |
| GET /corporate/comparison (corporate.py:153-178) | seed (uncounted) + 1 (`build_corporate_comparison_response`, per-ticker fan-out via `metrics_loader`/`price_loader` happens inside the service) | no (route level) | COARSE — server-side fan-out | `build_corporate_comparison_response` |
| POST /corporate/comparison/snapshot (corporate.py:181-205) | seed (uncounted) + 1 (`save_corporate_comparison_snapshot`, same internal fan-out shape) | no (route level) | COARSE — server-side fan-out | `save_corporate_comparison_snapshot` |
| GET /corporate/comparison/history (corporate.py:208-228) | seed (uncounted) + 1 (`load_corporate_comparison_history`) | no | COARSE | `load_corporate_comparison_history` |
| GET /corporate/comparison/snapshot-version (corporate.py:231-241) | 1 (`load_corporate_comparison_snapshot_version`) | no | COARSE | `load_corporate_comparison_snapshot_version` |
| DELETE /corporate/comparison/snapshot-version (corporate.py:244-257) | 1 (`delete_corporate_comparison_snapshot_version`) | no | COARSE | `delete_corporate_comparison_snapshot_version` |
| GET /corporate/comparison/stock-history (corporate.py:260-282) | seed (uncounted) + 1 (`load_corporate_comparison_stock_history`) | no | COARSE | `load_corporate_comparison_stock_history` |
| POST /corporate/dcf/{ticker} (corporate.py:285-303) | 1 (`build_dcf_summary`) | no | COARSE | `build_dcf_summary` |
| POST /corporate/dcf/{ticker}/report (corporate.py:306-322) | 1 (`build_dcf_full_report`) | no | COARSE | `build_dcf_full_report` |
| POST /corporate/dcf/reports/bulk (corporate.py:325-342, `build_bulk_dcf_reports`) | 1 at route, fan-out inside service | no | COARSE — OK (server-side fan-out) | `build_bulk_dcf_reports` (later) |
| POST /corporate/dcf/{ticker}/stream (corporate.py:345-411) | 1 (`build_dcf_summary`, then phases relayed over SSE) | no | COARSE — but SSE transport needs its own review when the process boundary moves | `build_dcf_summary` (streaming relay across BFF↔compute needs design) |
| GET /corporate/metrics/{ticker} (corporate.py:414-437) | 1 (`_metrics_for_ticker` → `metrics_for_ticker`) | no | COARSE | `metrics_for_ticker` |
| GET /corporate/metrics/{ticker}/audit (corporate.py:440-461) | 2 (`_load_fallback_metrics` → `load_fallback_metrics`, then `metric_audit_for_ticker`) | no | OFFENDER — 2 substantive calls composed at route | new `get_metric_audit` op folding fallback+audit server-side |
| GET /corporate/metrics/{ticker}/history (corporate.py:464-468) | 1 (`metric_history`) | no | COARSE | `metric_history` |
| GET /corporate/metrics/{ticker}/quarterly-statements (corporate.py:471-475) | 1 (`quarterly_statement_payload`) | no | COARSE | `quarterly_statement_payload` |
| PUT /corporate/metrics/{ticker} (corporate.py:478-480) | 1 (`save_metrics`) | no | COARSE | `save_metrics` |
| GET /corporate/diagnostic/{ticker}/radar (corporate.py:483-497) | 0 — hardcoded static payload | no | COARSE | none (static demo data, no service) |
| GET /corporate/diagnostic/{ticker}/tornado (corporate.py:500-512) | 0 — hardcoded static payload | no | COARSE | none (static demo data, no service) |

## market.py

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| GET /market/indices (market.py:18-24) | 1 (`get_all_indices`) | no | COARSE | `get_all_indices` |
| GET /market/index/{ticker} (market.py:27-33) | 1 (`get_stock_ohlcv`) | no | COARSE | `get_stock_ohlcv` |
| GET /market/index/{ticker}/detail (market.py:36-42) | 1 (`get_index_detail`) | no | COARSE | `get_index_detail` |

## detail.py

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| GET /detail/{ticker}/ohlcv (detail.py:27-32) | 1 (`get_stock_ohlcv`) | no | COARSE | `get_stock_ohlcv` |
| GET /detail/{ticker}/technicals (detail.py:35-40) | 2 (`get_stock_ohlcv` then `_compute_technicals`, a private method reached through by the route) | no | OFFENDER — 2 calls composed at route (also a private-method smell) | new `get_technicals` op that fetches bars + computes internally |
| GET /detail/{ticker}/monte-carlo (detail.py:59-106) | 1 (`get_stock_ohlcv`); the GBM simulation itself (lines 78-105) runs inline in the route using NumPy, not delegated to a service | no route-level loop over service calls | COARSE by call-count, but flagged: compute logic lives in the BFF route, not a service — candidate for its own compute op later | keep `get_stock_ohlcv` coarse; extract the simulation body into a `run_monte_carlo_gbm` compute-service op in a later slice |

## news.py

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| GET /news/feed (news.py:18-26) | 1 (`get_news`) | no | COARSE | `get_news` |
| POST /news/crawl (news.py:29-36) | 1 (`crawl_and_save`) | no | COARSE | `crawl_and_save` |
| POST /news/crawl/stock (news.py:39-47) | 1 (`crawl_stock_and_save`) | no | COARSE | `crawl_stock_and_save` |

## monte_carlo.py

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| POST /analyze (monte_carlo.py:263-307, `analyze_monte_carlo`) | 0 — no separate service is called; the entire GBM + jump-diffusion + valuation + correlation simulation is implemented inline in this router file (helper functions in the same module, several internal `for` loops at lines 75, 109, 111, 121, 138, 194, 237, 246, 279) | loops exist, but internal to one computation, not fan-out over service calls per browser request | COARSE by the fan-out rule (one request → one response, no N+1 service pattern) — but this route IS the compute engine, just not living in `services/` or compute-service yet | relocate the whole function body to compute-service as `run_monte_carlo_analysis`; no route-side fan-out to fix, just a placement/tier move |

## report.py

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| POST /report/summary (report.py:20-29) | 1 (`build_report`) | no | COARSE | `build_report` |
| POST /report/export (report.py:32-41) | 1 (`build_report_export`) | no | COARSE | `build_report_export` |

## stock.py

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| GET /stock/{ticker}/price (stock.py:11-19) | 1 (`get_stock_price_lookup`) | no | COARSE | `get_stock_price_lookup` |

## diagnostic.py

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| GET /diagnostic/logs/api-tail (diagnostic.py:11-22) | 0 — reads the local log file via `core.logger` helpers (`read_log_tail`, `get_log_path`), not a `services/` call | no | COARSE | none (dev/ops tooling, not compute-tier) |

## dev_monitor.py

Not in the brief's router list but present under `apps/api/routes/`; included per
task scope. All handlers here read/write the in-process dev-monitor sink
(`apps/api/core/dev_monitor.py`), which is dev/debug tooling gated by
`is_dev_monitor_enabled()`, not a `services/` compute call and not part of the
compute-service migration surface.

| Route | Service calls | In a loop? | Verdict | Target compute op |
|-------|---------------|-----------|---------|-------------------|
| GET /log-stream (dev_monitor.py:27-44) | 0 — SSE stream reading `get_dev_monitor_sink()`; the `while True` at line 34 is the lifetime of one open streaming connection polling the in-memory sink, not a per-row service fan-out | streaming loop, not a fan-out loop | COARSE — dev-only SSE tail, not compute-tier | none (dev tooling) |
| GET /performance/recent (dev_monitor.py:47-51) | 1 (`sink.recent`) | no | COARSE | none (dev tooling) |
| GET /performance/slow (dev_monitor.py:54-58) | 1 (`sink.slow`) | no | COARSE | none (dev tooling) |
| GET /performance/errors (dev_monitor.py:61-65) | 1 (`sink.errors`) | no | COARSE | none (dev tooling) |
| GET /performance/summary (dev_monitor.py:68-72) | 1 (`sink.summary`) | no | COARSE | none (dev tooling) |
| POST /performance/client-event (dev_monitor.py:75-97) | 1 (`emit_performance_event`) | no | COARSE | none (dev tooling) |

Slice 1 migrates ONLY `/portfolio/attribution`. Everything else is listed here
so the boundary is drawn coarse before those routes are touched later.
