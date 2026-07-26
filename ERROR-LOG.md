# Error Log

Purpose: capture notable or recurring build, lint, test, and runtime failures so the same issue is not rediscovered from scratch.

Use this file when `guideline/sop/build-error-resolver.md` calls for a concise error record.

Template:

```text
Date:
Command:
Failure:
Root cause:
Fix:
Files changed:
Prevention:
```

## 2026-07-26: Full API suite fails intermittently with unrelated 429s

Date: 2026-07-26
Command: `python -m pytest tests/api -q`
Failure: Full-suite runs intermittently reported 3-5 failed instead of the documented
baseline of 1 failed (only `test_dev_monitor_foundation.py::test_market_data_emits_cache_and_provider_events`
is a known pre-existing failure). The extra failures landed on tests with no
relationship to the change under test -- e.g. `test_portfolio_attribution.py::test_post_report_export_returns_backend_static_content`
and `test_watchlist_resync.py::test_portfolio_preferences_round_trip_total_investment_amount` --
and both passed reliably when run in isolation. The failures themselves were plain
`AssertionError`s on status code (expected 200, got 429), with no log line in the
failing test's own output pointing at rate limiting; the only signal was a
`Global rate limit exceeded for testclient` warning emitted earlier in the same
session, from an unrelated test file.
Root cause: `apps/api/core/middleware.py:75` creates one process-wide
`limiter = RateLimiter(rate=10, capacity=50)` singleton, keyed by client IP.
Every `TestClient` instance in the whole pytest process reports the same IP
(`"testclient"`), so the token bucket is shared and never reset across tests
or files. `tests/conftest.py` had no fixture to reset it. Any test file that
adds enough real HTTP traffic (via `TestClient`) can deplete the shared budget
enough that later, unrelated tests intermittently get 429s instead of 200s --
timing-sensitive (token refill is wall-clock based), so the exact failing set
varied run to run. Route-specific "strict" sub-limiters
(`middleware.py:94-96`, attached lazily as `strict_<client_ip>_<path>` attributes
on the same `limiter` object) are separate `RateLimiter` instances with their
own `clients` dicts and needed clearing too.
Fix: Added an autouse `_reset_rate_limiter` fixture in `tests/conftest.py` that
clears `middleware.limiter.clients` and deletes every `strict_*` attribute on
`limiter` before and after each test. Test-only; `apps/api/core/middleware.py`
(the production rate limiter) was not changed.
Files changed: `tests/conftest.py`
Prevention: Any new test file that exercises HTTP endpoints through `TestClient`
now gets isolated rate-limiter state automatically (autouse, no per-file opt-in
needed). If a future middleware introduces another process-wide singleton keyed
by a fixed test identity (e.g. IP, session id), add a similar reset fixture
rather than working around symptoms by reducing request counts in individual
test files.

## 2026-07-26: Baseline criterion 3 can never pass — point-in-time cache events counted as unfinished spans

Date: 2026-07-26
Command: `python scripts/benchmark_scenarios.py tab_switch --iterations 3`
Failure: The generated baseline report stamps `criterion 3: FAIL` with `partial: True`
on every scenario that touches the cache, which is all of them. Criterion 3 ("no
orphans, no `partial` flags", spec §08.4) is meant to detect an undersized ring
buffer; here it fires on a healthy 918-event buffer with `orphans: 0` and
`truncated: false`. Because the runner previously hardcoded `partial=False`
(`scripts/benchmark_scenarios.py`, pre-fix), the report stamped criterion 3 PASS
unconditionally and this was invisible.
Root cause: `normalize_spans` (`apps/api/services/perf_analysis.py:106`) sets
`partial = event.duration_ms is None`, which is correct for an unpaired
`perf_timer` start event whose terminal was evicted, but wrong for **point-in-time
events that were never spans at all**. `cache.lookup` and `cache.hit` are emitted
once via `emit()` with no `duration_ms` and no `closes_span_id`, so every one of
them becomes a span flagged `partial`. Measured on a 3-iteration `tab_switch` run:
596 of 912 spans flagged partial, of which 592 were `cache.lookup`/`cache.hit` and
4 were `page_load.*` start events. A diagnostic confirmed the ring buffer is not
implicated: `terminals whose start is NOT in slice: 0` for both the cursor-sliced
window and the whole buffer, so nothing was evicted.
The same missing `duration_ms` is why `CacheRow.avg_miss_cost_ms` and
`estimated_time_saved_ms` are always 0.0 — one root cause, two symptoms.
Fix: Two fixes, both narrowing `partial` to its intended meaning:
1. `_span_from` now sets `partial = duration_ms is None and status == "start"`.
   `status="start"` is written at exactly the three start-event emit sites
   (`dev_monitor.perf_timer:461`, `middleware:114` api.request_start,
   `middleware:130` page_load), so it is a precise discriminator. The positive
   form was chosen over excluding a set of terminal statuses because
   `cache.lookup` turned out to carry `status="success"`, not `cache_miss` -- a
   `{cache_hit, cache_miss}` exclusion list would have missed 296 of 592 events.
   All ~8 existing `partial` tests still pass unchanged, since they assert on
   genuine unpaired start events.
2. `middleware.py` now sets `closes_span_id` on the `page_load.*` terminal, on
   both the complete and error paths, by capturing the page_load start event's id
   (`page_load_event_id`). It previously set it only on `api.request_complete`,
   so spec 03.3's pairing fix covered one emit convention and not the other --
   the exact failure mode 03.3 exists to prevent. Beyond `partial`, the unpaired
   page_load start meant its terminal became a *separate* span: `page_load.portfolio`
   reported 6 spans for 3 requests and double-counted its self time in the
   operation ranking the baseline report publishes (1815.3 ms across "6 calls",
   now 1919.6 ms across 3).
The remaining cause of `partial: True` is a separate and larger defect -- see the
entry below on unparented request-level spans.
Files changed: `apps/api/services/perf_analysis.py`, `apps/api/core/middleware.py`,
`scripts/benchmark_scenarios.py` (surfaces the flag instead of hardcoding it),
`tests/api/test_perf_capture.py` (3 regression tests).
Prevention: A success criterion whose inputs are hardcoded literals is not a
criterion. Any criterion the baseline report stamps must be derived from the
analysis DTO that the spec names as its source (§08.4 names `RequestWaterfall`
for criterion 3), so that a red result is reachable. Three of the five criteria
were stamped from hand-rolled or constant values before this was caught.

## 2026-07-26: Request-level spans are unparented, flattening every waterfall and invalidating criterion 2

Date: 2026-07-26
Command: `python scripts/benchmark_scenarios.py tab_switch --iterations 3`, then a
per-request root count via `normalize_spans` / `build_waterfall`.
Failure: For a single `GET /api/v1/portfolio/watchlist` request, **420 of 421 spans
are parent-less roots**: `cache.lookup` x139, `db.select_stocks` x139,
`cache.hit` x139, `db.select_watchlist` x2, and `api.request_start` x1. Only
`api.request_start` should be a root. Consequences:
- Baseline criterion 3 fails permanently via `_build_tree`
  (`perf_analysis.py:231`, `partial = partial or len(roots) > 1`), independently of
  the two `partial` causes fixed above.
- **Criterion 2 is not merely failing, it is meaningless — and reads as a
  flattering PASS.** With >1 root, `breakdown_by_scope` takes its
  `SYNTHETIC_ROOT_ID` branch (`perf_analysis.py:475-483`) and sets `total_ms` to the
  *sum of 420 unrelated root durations* instead of the request's real 587.3 ms.
  `unattributed_ms` is computed against that inflated denominator, so it reports
  0.0 / "PASS" while actually being uncomputable. A criterion that cannot go red is
  not a criterion.
- The dashboard's span-tree panel renders 420 flat siblings under a synthetic
  "(request)" node rather than a tree, and the report's "pct of request" column uses
  the same wrong denominator.
Root cause: spec 03.2 closes the automatic-parent gap by having `perf_timer` set the
`_current_span_id` contextvar, and `emit()` read it when an event has no explicit
`parent_id` (`dev_monitor.py:352`). But the request-level span — the one every other
span in a request should hang from — is emitted by `middleware.py:108` through raw
`emit_performance_event`, not `perf_timer`, so it never sets the contextvar. For the
whole request the ambient span id stays `None`, and every event emitted outside a
`perf_timer` block (all cache events, and `db.*` from `InstrumentedCursor`) is
therefore parented to nothing. The gap 03.2 identifies is closed for nested
`perf_timer` spans and left open at the request root.
Fix: Pending decision at time of writing. The shape of the fix is established by an
exact in-repo precedent: `dev_monitor` already exports
`set_current_request_id`/`reset_current_request_id`, which `middleware.py:83` and
`:270` use to scope the request id across the request. `_current_span_id` has only a
getter (`get_current_span_id:80`), so the fix is to add the matching
setter/resetter and have middleware scope the request span id the same way.
Blast radius is why this is not a drive-by change: it converts every waterfall from
flat to nested, which changes criterion 2's denominator, the dashboard's tree
rendering, and any test or fixture asserting the current flat shape.
Files changed: none yet (record only).
Prevention: The acceptance check in spec 03.10 is "an inner span's `parent_id`
equals the outer span's `id`" — satisfied by `perf_timer`-to-`perf_timer` nesting,
which is what the test asserts. It does not cover *directly emitted* events inside a
request, which is the majority of spans by count. A test asserting that a request's
waterfall has exactly one root would have caught this immediately.

## 2026-07-26: RecursionError in waterfall truncation on a deep non-bushy tree

Date: 2026-07-26
Command: `python -m pytest tests/api/test_perf_analysis.py -q`
Failure: `test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees` fails
with `RecursionError: maximum recursion depth exceeded` at
`apps/api/services/perf_analysis.py:328` in `_to_node`. Reproduces when the test
runs alone, so it is not test-ordering or stack-depth sensitive. Verified
pre-existing at commit `196c565` by stashing unrelated working-tree changes and
re-running.
Root cause: `_to_node`, `_assign_self_ms`, `_assign_offsets` and `_flatten`-style
tree walks in the waterfall builder are all plain recursion, one Python frame per
span of depth. A deep non-bushy tree (a long parent→child chain rather than a wide
fan-out) exceeds CPython's default 1000-frame limit well before
`WATERFALL_SPAN_CAP = 2000` spans is reached, so the truncation path this test
exercises raises before it can collapse anything. The cap bounds span *count*, not
tree *depth*.
Fix: Not fixed here — out of scope for Task 13, which only surfaced it while
verifying that the perf suite was green. Belongs to Task 6 (spec §04.10).
Files changed: none (record only).
Prevention: This corrects an earlier claim in this session that the full-suite
baseline was "1 known failure". Verified by stashing: `python -m pytest tests/api -q`
reports **6 pre-existing failures** at `196c565` — this one, the known
`test_market_data_emits_cache_and_provider_events`, plus
`test_corporate_companies_registry.py::test_corporate_companies_includes_all_stock_targets_json_entries`
and three in `test_stock_price_lookup.py`. Only this one lies inside the
perf-instrumentation work; the other four are unrelated and untouched. A
depth-bounded walk (explicit stack, or a
depth cap that emits `CollapsedNode` at the depth limit the same way the span cap
does) would make the truncation contract hold for chains as well as fan-outs.

## 2026-07-26: GET /api/v1/market/indices 500s on a NaN/Inf value

Date: 2026-07-26
Command: `python scripts/benchmark_scenarios.py tab_switch` (surfaced while building
the perf-instrumentation baseline runner; also reproducible via any client hitting
`GET /api/v1/market/indices` when live data yields a non-finite float).
Failure: The endpoint returned `status=500` with
`ValueError: Out of range float values are not JSON compliant`, raised from
`starlette/responses.py` `render()` → `json.dumps(..., allow_nan=False)`. The 500 is
data-dependent and transient: a later request for the same route returned 200 once
the offending index's live data no longer contained a NaN.
Root cause: The route (`apps/api/routes/market.py:18`, `get_all_indices`) returns
`_svc.get_all_indices()` through FastAPI's default `JSONResponse`, whose stdlib
`json.dumps` runs with `allow_nan=False`. When live market data produces a NaN/Inf
in any index card field (e.g. a percentage delta computed against a zero/empty
prior close, or a sparkline point with no data), serialization raises and the whole
response 500s. This is the same NaN/Inf hazard the compute-boundary serializer
(spec §A-3, `apps/api/compute/serialization.py`) was built to neutralize, but that
serializer guards only the compute-tier path -- ordinary web routes like
`/market/indices` do not pass through it and have no NaN sanitization.
Fix: Not fixed here -- out of scope for the perf-instrumentation task (Task 13),
which only surfaced it. The benchmark runner was made resilient to it via
`TestClient(app, raise_server_exceptions=False)` so a transient 500 on one surface
does not abort a whole baseline run. The underlying route bug remains open.
Files changed: none (record only). Runner hardening in
`scripts/benchmark_scenarios.py`.
Prevention: Web routes that serialize live-derived floats should sanitize NaN/Inf
before returning (reuse the A-3 sentinel serializer, or a shared response class
that replaces non-finite floats with null), rather than relying on each route to be
NaN-free. A route-level test that feeds a NaN through `/market/indices` and asserts
a 200 with nulls (not a 500) would catch regressions.
