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
Fix: Added `set_current_span_id`/`reset_current_span_id` to `dev_monitor.py`,
mirroring the existing `set_current_request_id`/`reset_current_request_id` pair, and
`middleware.py` now scopes the request span id across the request the same way
`middleware.py:83`/`:270` already scope the request id — set immediately after the
`api.request_start` event is emitted (so it does not parent itself), reset in the
same `finally`. Verified: a `/portfolio/watchlist` request went from 423 roots to
exactly 1, and `RequestWaterfall.partial` from `True` to `False`, so baseline
criterion 3 passes. Full suite unchanged at the same 6 pre-existing failures, 199
passed — the flat-to-nested change broke no existing test or fixture.
Files changed: `apps/api/core/dev_monitor.py`, `apps/api/core/middleware.py`,
`tests/api/test_perf_capture.py` (`test_request_waterfall_has_exactly_one_root`).
Prevention: The acceptance check in spec 03.10 is "an inner span's `parent_id`
equals the outer span's `id`" — satisfied by `perf_timer`-to-`perf_timer` nesting,
which is what the test asserts. It does not cover *directly emitted* events inside a
request, which is the majority of spans by count. A test asserting that a request's
waterfall has exactly one root would have caught this immediately.

## 2026-07-27: `next dev` reached 5 GB and never bound its port — observed once, NOT reproducible

Date: 2026-07-27
Command: `cd apps/web && NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8111 npm.cmd exec -- next dev --port 3111`
Failure: The dev server logged `✓ Ready in 1184ms` but never listened on the port
(`curl` returned `http 000`, `Get-NetTCPConnection` showed nothing on 3111). The node
process grew to **5,081 MB**. Free system RAM fell from 7.3 GB to **2.6 GB** and
returned to 7.5 GB the instant the process was killed, so the memory was real and
attributable, not an accounting artifact.
Root cause: **unknown — not reproducible.** Four hypotheses were tested and each was
disproven by measurement:

| Hypothesis | Test | Result |
| --- | --- | --- |
| `/dev/performance` is expensive to compile | clean start, request the page | **OK**, 1,379 MB, served in <3 s |
| Restarting on a just-killed port | kill the listener, restart immediately on the same port | **OK**, bound fine, 1,329 MB |
| `NEXT_PUBLIC_*` change invalidates the build cache and forces a cold rebuild | start with the env var set, request the page | **OK**, 1,474 MB, served in <4 s |
| A `tailwindcss` resolution failure seen in one log | compare logs across runs | **Investigator artifact.** The error appeared only in a run launched via PowerShell `Start-Process`, which ignores `Set-Location`, so npm ran from the repo root and Next resolved from `apps/` instead of `apps/web`. No bash-launched run logged it. |

Leading remaining explanation, untested: two dev servers briefly sharing the single
1.2 GB `.next` cache during a kill-then-restart sequence, or a one-off Turbopack
pathology. Recorded rather than guessed at further.
Fix: None — there is no confirmed defect in this repository to fix. What is confirmed
is an **operational hazard**: a `next dev` that fails to bind does not exit. It keeps
running, holds gigabytes, and is invisible unless you check, because the log still
says "Ready".
Files changed: none (record only).
Prevention: After starting the dev server, assert something is actually listening on
the port rather than trusting the "Ready" line — they are not the same claim. When
killing dev servers, verify the process count afterwards; `taskkill //F //PID` via
`ps -W` has silently failed in this environment, whereas
`Get-Process node | Stop-Process -Force` works. A `run moneyview` preflight that
detects and clears orphaned `next dev` processes would turn this from a silent
multi-gigabyte leak into a startup message.
Correction to earlier figures in this session: `next dev` steady state is **~1.3-1.5 GB**
across its four processes, not the ~940 MB first reported from a home-page-only
measurement. Backend (uvicorn + app) is ~156 MB, plus up to ~128 MB when the dev
monitor ring buffer fills.

## 2026-07-27: Concurrent baseline runs silently overwrite one report, producing a plausible but false baseline

Date: 2026-07-27
Command: `python scripts/benchmark_scenarios.py` (three overlapping invocations)
Failure: Three full baseline runs executed concurrently and all wrote to the same
`docs/perf/2026-07-27-baseline.md`, last writer winning. The surviving report looked
complete and well-formed, with every criterion stamped — but every timing figure in it
was measured while one or two identical benchmarks contended for the same CPU, network
and SQLite file. Detected by reading the same file twice minutes apart and getting
different numbers for one scenario: `comparison_138` showed
`247.2ms -> 245.2ms -> -0.8%` and then `252.2ms -> 239.1ms -> -5.2%`. A report that
changes when nothing re-ran it is not a baseline.
Root cause: two independent gaps.
1. `main()` writes to a date-stamped path with no lock, no uniqueness and no
   check for a running instance, so concurrent runs clobber each other in silence.
2. Operator error compounded it: `taskkill //F //PID` via `ps -W | awk '{print $1}'`
   did not actually terminate the runs. The kill reported
   `killed; remaining: 2`, which was misread as unrelated leftover processes rather
   than as the kill having failed. Two runs believed to be dead ran to completion
   (both `EXIT=1`). `Get-Process python | Stop-Process -Force` worked where taskkill
   did not.
Fix: Not yet fixed in the runner. Immediate remedy was to kill all Python processes
via PowerShell, verify a count of exactly 0, relaunch a single run, and verify a count
of exactly 1 before trusting anything.
What survived the contamination: structural properties of the span tree are unaffected
by CPU contention, so these findings stand — criterion 3 PASS on all five scenarios
(orphans 0, partial False), `overlap_detected: True` on all five, scope percentages
summing to 162.9% on `comparison_138`, and the statement cache hit rate of 94%
(223 hits / 14 misses). Only the millisecond values are void.
Files changed: none yet (record only).
Prevention: A benchmark that writes a committed artifact must refuse to run
concurrently — an exclusive lockfile, or a PID/started-at header the reader can check.
Separately: after issuing a kill, assert the process count is zero rather than reading
a non-zero remainder as unrelated. "Probably not mine" is not verification.

## 2026-07-27: Two-pass overhead yields negative percentages because in-process caches carry across passes

Date: 2026-07-27
Command: `python scripts/benchmark_scenarios.py`
Failure: Criterion 1 reported **negative overhead** — `comparison_138` at -0.8% then
-5.2%, `tab_switch` at -0.8%, `attribution_138` at -11.4% on an earlier run. The
report stamped these as `PASS`, since -5.2% is comfortably under the 3% budget.
Instrumented code cannot be faster than uninstrumented code; a negative figure means
the measurement is invalid, yet it reads as the best possible result.
Root cause: spec 08.3 defines `overhead_pct = (p50_B - p50_A) / p50_A * 100` with pass
A (flag off) run before pass B (flag on). Both passes run in **one process**, and the
process holds caches that outlive a pass: `_YAHOO_STATEMENT_CACHE`,
`_provider_fetch_cache`, SQLite page cache, and imported-module state. Pass A therefore
pays cold-cache costs that pass B inherits warm, so the ordering alone biases B faster.
The per-pass warm-up call reduces this but cannot remove it, because the warm-up only
warms what that one scenario touches, and the first pass of the first scenario warms
the process for everything after it. The formula assumes the two passes are independent
samples; sequential passes sharing a process are not.
Fix: Not yet fixed. Recommended: keep one warm-up before both passes, then
**interleave** iterations A/B/A/B rather than running all of A then all of B, so any
monotonic drift (cache warming, thermal, background load) cancels between the two
arms instead of accruing entirely to the first. Running each pass in a fresh
subprocess is the stricter alternative but pays the ~6 min cold statement sweep twice.
Files changed: none yet (record only).
Prevention: A criterion whose failure mode is a *better-looking* number is dangerous.
Guard the sign as well as the magnitude: a negative overhead should stamp the
measurement invalid rather than PASS, in the same way spec 08.4 treats an over-budget
overhead as making the report untrustworthy.

## 2026-07-26: Statement cache has TWO independent 0%-hit-rate causes — TTL shorter than the sweep, and maxsize smaller than the universe

Date: 2026-07-26
Command: `python scripts/benchmark_scenarios.py` (full baseline; surfaced while
measuring `comparison_138`)
Failure: The Yahoo statement cache achieved **587 misses and 0 hits** across a full
baseline run — a 0% hit rate, with not one `cache_hit=true` line in 4.7 MB of logs.
Every iteration of `GET /corporate/comparison?mode=live` re-fetched all 138 tickers
live from Yahoo at ~2.5 s each.
Root cause: arithmetic, not a bug in the cache itself — and there are **two
independent causes, either one sufficient on its own** to force 0%:

**(1) TTL (300 s) is shorter than one sweep (357 s).**
`YAHOO_STATEMENT_CACHE_TTL_SECONDS` defaults to **300 s**
(`corporate_statement_metrics.py:29`), and `_YAHOO_STATEMENT_CACHE` is a module-level
`TTLCache` (`:31`) checked again by hand against the same 300 s (`:122`). But one
serial sweep of the 138-ticker watchlist takes **357 s** — measured from the first to
the 138th `cache_hit=false` line, 23:04:24 to 23:10:21. The sweep is 57 s longer than
the TTL, so ticker #1's entry has already expired by the time ticker #138 is fetched,
and the next request misses on all 138 again.

**(2) `maxsize` (48) is smaller than the universe (139).**
`YAHOO_STATEMENT_CACHE_MAXSIZE` defaults to **48** (`:30`). A 138-ticker sweep
therefore evicts its own first ~90 entries before it finishes, so capacity alone
defeats any TTL however long. This was found only after raising the TTL to 86400 s
produced *still* 0 hits / 539 misses — proof the two causes are independent.
Verified at runtime: `TTL=86400, MAXSIZE=48`.

**The cache cannot produce a hit for a full-universe fan-out; it is structurally
impossible at these defaults, not mistuned.** It only ever helps a single-ticker
request repeated inside 5 minutes. Neither `48` nor `300` was ever derived from the
universe size or the sweep duration.
With both raised (`ttl=86400`, `maxsize=4096`) the same fan-out measured a **94% hit
rate — 223 hits / 14 misses**, and `comparison_138` fell from a ~357 s cold sweep into
the hundreds of milliseconds warm.
This is a production defect, not a benchmark artifact, and it is a strong candidate
for the root cause of reported symptom S2 (spec 01.1): every `mode=live` comparison
costs 138 serial live fetches, ~6 minutes, with zero cache benefit no matter how
often it is called.
Fix: Partially fixed 2026-07-28 — option (a), applied to the defaults rather than left to
an env var, because the defaults are what production runs. TTL 300s -> 86400s and maxsize
48 -> 4096, both now carrying the derivation in a comment: TTL must exceed the 357s sweep,
maxsize must exceed the 139-ticker watchlist. Two tests in
`tests/api/test_corporate_metric_audit.py` pin those invariants and were verified to fail
at the old values.

Fully resolved 2026-07-28 by moving statements into the acquisition layer: the TTLCache
is deleted and the local store is the only cache, so the two-layers-with-different-
invalidation problem no longer exists. Options (b) and (c) are both satisfied -- bundles
persist to SQLite and survive restarts, and the comparison fan-out no longer requires
live statements.
**What this does not fix** (written 2026-07-28 against the partial fix; superseded by the
paragraph above, and kept for the record rather than as a statement of current behaviour):
the cache is a module-level `TTLCache`, so a process restart still costs one cold ~357s
sweep. Options (b) persist statement bundles to SQLite and (c) make the comparison fan-out
not require live statements remain open, and both belong to sub-project 2, which owns the
per-ticker cache and on-demand loading.
**What the longer TTL costs:** the bundle carries yfinance `info`, and `market_cap` is read
from it (`corporate_statement_metrics.py:1483`) into the WACC capital-structure weights
(`:1170`), so those weights can now be built from a market cap up to a day old. Accepted
because every price input in this app is a daily bar, so finance-logic.md's "use market
values for capital structure" is still satisfied with yesterday's close. The clean fix is
to split statements (quarterly) from quote-derived fields (intraday) into separate
freshness classes; bundling them is what forces one TTL to serve both.
Files changed: `apps/api/services/corporate_statement_metrics.py`,
`tests/api/test_corporate_metric_audit.py`.
Prevention: A TTL cache in front of a serial fan-out must have a TTL longer than the
fan-out takes to complete, or its hit rate is zero by construction. Any TTL guarding
a batch operation should be asserted against the measured duration of that batch. A
hit-rate assertion on `cache_effectiveness` output for the comparison path would have
caught this — and would have been visible from day one had the baseline runner's cache
section (spec 08.1, omitted until today) been present.

## 2026-07-26: page_load spans duplicate the api.request interval, so criterion 2 reports a sentinel as a PASS

Date: 2026-07-26
Command: `python scripts/benchmark_scenarios.py tab_switch --iterations 3`
Failure: With the waterfall correctly nested (see the entry above), the baseline
report shows `overlap_detected: True` and scope percentages that sum to 110.8%
(`page_load` 98.8% + `db` 10.9% + `api` 1.1%), violating spec 04.12's "percentages
sum to <= 100%". Because spec 04.7 forces `unattributed_ms = 0` whenever overlap is
detected, **criterion 2 prints `unattributed 0.0 / PASS` when the true figure is not
computable.** This is the same trap as the hardcoded `partial=False`: a criterion
that reads green for a reason unrelated to the thing it measures. Criterion 2 has now
been un-trustworthy for three distinct reasons in one session, each hidden by the
previous one.
Root cause: `middleware.py` emits a `page_load.<component>` span whose duration is
computed from the same `process_time` as `api.request_complete` — the two spans cover
the *identical* interval for the same request — and parents page_load under
`api.request_start`. Self time is total minus children's totals, so a child that is
exactly as long as its parent's whole window consumes the entire budget: `page_load`
takes ~100% of self time, and the `db.*` spans (siblings of page_load, also children
of the request) add their self time on top, pushing the sum past the root total.
`api.request_*` and `page_load.*` are two labels for one interval, not a parent and a
child. Spec 03.5 lists them as separate span rows (#1 and #9) without noting that the
server-side page_load event measures nothing the request span does not.
This was previously masked: before the request span became the ambient parent, 420 of
421 spans were roots, so `breakdown_by_scope` used its synthetic-root denominator
(the sum of all root durations) — a number large enough that no overlap was ever
detected. Fixing the parenting made a pre-existing double-count visible.
Fix: Not fixed — needs a spec decision on what the server-side `page_load` span is
for. Options: (a) drop it and derive page-load grouping from the `request_group`
metadata already on the request span, since the frontend's `useDevMonitorPageLoad`
emits the real multi-request page-load span; (b) keep it as a grouping label excluded
from self-time accounting; (c) keep it and have `breakdown_by_scope` treat
same-interval parent/child pairs as one span.
Files changed: none (record only).
Prevention: Two spans that measure the same interval will always break self-time
accounting, whatever their nesting. A span map should state, per span, which interval
it owns exclusively — and spec 04.12's "percentages sum to <= 100%" check should run
against a real captured request, not only hand-built fixtures, since the hand-built
trees in the unit tests never contained a same-interval pair.

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

## 2026-07-27: Watchlist upsert scheduled a live acquisition on every metadata/weight edit

Date: 2026-07-27
Command: code review of Task 8 (`git diff 1eb6d5d..754f3b4`); no test failed
Failure: Silent. `POST /api/v1/portfolio/watchlist` spawned an unbounded daemon thread
(`apps/api/services/acquisition/runner.py:120`) on **every** call, each thread making two
live provider calls (`latest_action_date` + `fetch_bars`). Nothing errored -- the route
returned 200 immediately after its SQLite write, and the fan-out happened after the
response.
Root cause: the endpoint is named and documented as "add or update" and is an
`INSERT OR REPLACE` upsert, but the trigger was wired as if it were an add-only route.
The web client uses the same endpoint for pure metadata and weight edits
(`apps/web/app/portfolio/page.tsx:1497` `persistWatchlistItem`), including two loops that
POST once per holding: "normalize allocations" (`:1714`) and the allocation auto-save
(`:1789`). One bulk allocation edit on an N-holding portfolio therefore became N
concurrent live fetches -- against a rule `apps/api/services/acquisition/sources/bars.py:3-5`
states explicitly, because concurrent live fetching had already earned a Yahoo rate limit
that invalidated a day of measurements during sub-project 1.
Fix: `upsert_watchlist_item` now SELECTs the ticker inside the existing transaction before
the `INSERT OR REPLACE` and schedules acquisition only when the row is genuinely new.
Regression test: two POSTs for one ticker (the second changing weight) must schedule
exactly once, and must still persist the edit.
Files changed: `apps/api/routes/portfolio.py`, `tests/api/acquisition/test_triggers.py`
(commit 95c3739).
Prevention: when attaching a side effect to an HTTP route, check what the **client**
actually calls it for, not what the route is named. An upsert reached by an edit loop is a
fan-out multiplier. Any new trigger that spawns a thread per request needs a test that
calls the route twice and asserts the side effect fired once.

## 2026-07-27: Retiring a watchlist ticker advanced the freshness clock, silently suppressing re-acquisition

Date: 2026-07-27
Command: code review of Task 8 (`git diff 1eb6d5d..754f3b4`); no test failed
Failure: Silent, and only observable a boundary window later. Remove a ticker, re-add it
the same UTC day, and acquisition reported `skipped=True` and fetched nothing, while
`acquisition_state.status` still read `'retired'` for a ticker that was back on the
watchlist. Worst case: add a new ticker -> the background `acquire` raises before writing
any state (swallowed at `runner.py:117`) -> delete -> re-add -> the ticker holds zero bars
until the next 00:00 UTC, with nothing asking again.
Root cause: `retire_subject` called `record_check`, which stamps `last_checked_at = now`
(`apps/api/services/acquisition/state.py:84-93`). `needs_acquisition`
(`apps/api/services/acquisition/freshness.py:18-20`) reads nothing but `last_checked_at`,
so the stamp is indistinguishable from a successful ask. Semantic mismatch: `record_check`
means "we asked the provider", and retiring is not an ask -- it was reused because it was
the only writer that set a status without touching coverage.
Fix: added `record_retired(data_class, subject)` to `state.py`, an upsert that sets
`status = RETIRED` and `detail = NULL` and touches none of `last_checked_at`,
`last_success_at`, `covered_from`, `covered_to`. `retire_subject` calls it. Three
regression tests: the timestamp is unchanged after a prior check; a never-seen subject
still reports `needs_acquisition is True`; a prior success keeps its coverage.
Files changed: `apps/api/services/acquisition/state.py`,
`apps/api/services/acquisition/runner.py`, `tests/api/acquisition/test_state.py`
(commit 95c3739).
Prevention: the boundary-based design makes `last_checked_at` the single input to every
freshness decision, so any writer that sets it is asserting "the provider was asked".
Before reusing a recorder, check whether its *name* is true of the new caller. When a
field governs a decision alone, its writers should be enumerable and each one justified.

## 2026-07-27: Corporate-action refetch started at today-10y, leaving the head of the series on the old adjustment factor

Date: 2026-07-27
Command: whole-subsystem review of the Phase 1 acquisition path; no test failed
Failure: Silent and progressive. On a split or dividend, `acquire` correctly chose a full
refetch over a delta append, but the refetch did not reach the start of the stored series.
Every day between the original backfill and the corporate action, the un-refetched head
grew by one day. Those rows kept the pre-action adjustment factor while everything after
them was rewritten with the post-action one, so a single series held two adjustment bases
with no marker at the seam. `record_success`'s `MIN()` then preserved the older
`covered_from`, so the state row went on asserting a continuous, consistently-adjusted
series over rows that were not. It degrades returns, volatility, and every DCF input built
on them, and it looks like data rather than like an error.
Root cause: `plan_range` returned `FetchRange(_backfill_start(today, backfill_years), ...)`
for the `full_refetch` branch, ignoring `state.covered_from`. `_backfill_start` is relative
to *today*, but `covered_from` was `today - 10y` as of the day of the ORIGINAL backfill, so
the two drift apart by exactly the age of the stored series.
Fix: the `full_refetch` branch now starts at
`min(state.covered_from, _backfill_start(today, backfill_years))` -- `min` rather than
`covered_from` alone so a subject with shallower-than-ten-year coverage is still refetched
to the full backfill depth rather than truncated to whatever happens to be stored. Two
regression tests cover both directions. `test_runner.py`'s existing corporate-action test
had encoded the bug: its fixture seeded `covered_from=2016-01-01` while asserting the
refetch started at `2016-07-27`; the assertion was corrected, not the fixture.
Files changed: `apps/api/services/acquisition/ranges.py`,
`tests/api/acquisition/test_ranges.py`, `tests/api/acquisition/test_runner.py`.
Prevention: when a code path exists to restore a global invariant (here: one adjustment
basis per series), its range must be derived from what is stored, never from a window
recomputed against the current date. A test whose fixture and assertion disagree about the
same quantity is asserting the implementation, not the intent -- treat that mismatch as a
finding rather than reading past it.

## 2026-07-27: fetch_bars zeroed dividends and stock_splits, erasing them on every acquisition

Date: 2026-07-27
Command: whole-subsystem review of the Phase 1 acquisition path; no test failed
Failure: Silent data destruction on the write path. `stocks.dividends` and
`stocks.stock_splits` were reset to `0.0` for every date an acquisition touched. Worst
case is the exact case this subsystem cares about: a split triggers a full refetch, the
refetch rewrites the whole series, and the record of the split that caused it is wiped
from every row in the process.
Root cause: `fetch_bars` built each `StockOHLCV` from Open/High/Low/Close/Volume only and
left `dividends` and `stock_splits` at their schema defaults of `0.0`
(`apps/api/models/schema_parts/market.py:34-35`), even though `yfinance.Ticker.history()`
returns `Dividends` and `Stock Splits` columns in the same frame. `_save_ohlcv_rows`
(`apps/api/services/market_data.py:980-990`) writes both columns with `INSERT OR REPLACE`
against `UNIQUE(ticker, date)`, so the whole row is replaced -- the defaults were persisted
over real values rather than being ignored as unset.
Fix: `fetch_bars` now carries `Dividends` and `Stock Splits` through, defaulting to `0.0`
only when the columns are genuinely absent (index frames have neither). Two regression
tests: values are carried through, and an action-free frame still yields zeros without
raising.
Files changed: `apps/api/services/acquisition/sources/bars.py`,
`tests/api/acquisition/test_bars_source.py`.
Prevention: a model default is not "leave this alone" when the persister uses
`INSERT OR REPLACE` -- it is a value that gets written. When adding a producer for an
existing table, enumerate every column the persister writes and confirm the producer
populates each one, not just the ones the new feature reads.

## 2026-07-28: Deep span trees crashed /dev/perf analysis instead of truncating

Date: 2026-07-28
Command: `python -m pytest tests/api -q`
Failure: `test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees` failed with
`RecursionError: maximum recursion depth exceeded` at `apps/api/services/perf_analysis.py:335`.
The user-visible defect: a request producing a deep, narrow span tree crashed waterfall
analysis rather than truncating it -- the exact outcome the truncation path exists to
produce. The test had been carried as a known failure across several branches without being
diagnosed.
Root cause: `perf_analysis.py` contained five recursive tree walkers. `_to_node` spent two
Python frames per level -- the call plus its list comprehension's own frame -- so a 668-level
chain reached ~1,336 frames against CPython's 1,000-frame default. `_assign_self_ms`,
`_assign_offsets` and `_depth_map` walk the same depth at one frame per level and merely had
not reached their own ceiling yet; measured max depth on the failing input was 701 for each.
Fix: all four converted to explicit-stack iterative traversals, preserving each one's
sequencing contract -- post-order with an overlap accumulator for `_assign_self_ms`,
pre-order for `_assign_offsets`, and exact DFS append order for `_depth_map`, which
`_truncate` consumes positionally. `_subtree_size` was left recursive: it is only ever
invoked on already-collapsed subtrees, measured at depth 1. Regression test builds a
depth-2,000 chain, which fails on all four walkers before the change.
Files changed: `apps/api/services/perf_analysis.py`, `tests/api/test_perf_analysis.py`.
Prevention: recursion depth in a tree walker is bounded by input, not by code review.
When a module walks user- or telemetry-shaped trees, frames-per-level is the number that
matters and it is not visible from reading one function -- the comprehension inside
`_to_node` doubled it invisibly. Prefer explicit stacks for any traversal whose depth is
attacker- or workload-determined, and measure depth rather than assuming it.

## 2026-07-28: Four tests never executed on any machine without an `E:` drive

Date: 2026-07-28
Command: `python -m pytest tests/api -q`
Failure: Four tests in `test_corporate_companies_registry.py` and
`test_stock_price_lookup.py` errored in setup rather than failing an assertion, and were
carried in the branch baseline as part of "6 known failures". Because they died before
reaching their bodies, their assertions had never run -- on any machine, including the one
where the path existed, nothing verified that the code under test was correct. A setup
error and a real failure look nearly identical in a `-q` summary line, which is why this
survived several branches.
Root cause: both files built their temp directory under a hardcoded `E:\MoneyView` root via
private helpers that also called `tempfile._get_candidate_names()`. The drive letter is one
developer's machine; the private tempfile API is not a supported interface.
Fix: both files take pytest's `tmp_path` fixture. The private helpers and the `tempfile`
import were deleted.
Files changed: `tests/api/test_corporate_companies_registry.py`,
`tests/api/test_stock_price_lookup.py`.
Prevention: an errored test is not a failing test -- it is an *unrun* test, and a baseline
that counts the two together hides how much of the suite is dead. Never hardcode an absolute
path in a test; `tmp_path` exists for exactly this. When adopting an inherited baseline of
known failures, check whether each one fails in its body or dies in setup before agreeing to
carry it.

## 2026-07-28: The API test suite read the developer's real database, so results depended on the machine

Date: 2026-07-28
Command: `python -m pytest tests/api -q`
Failure: `test_dev_monitor_foundation.py::test_market_data_emits_cache_and_provider_events`
and two tests in `test_perf_capture.py` traded places depending on execution order -- one
set passed only when the other ran first. Every failure was a plain assertion error with no
indication that machine state was involved. The suite took 403 seconds.
Root cause: nothing pointed `apps/api/services/db.py`'s `_DB_PATH` away from
`data/processed/moneyview.db`, so every test read one developer's real data -- 142 tickers
and 1,307 AAPL rows, empty on a fresh clone. A test asserting "this fetch was live" then
passed or failed on whether some earlier test had warmed that shared cache, not on the code.
The same shared cache also hid real network traffic: once the database was isolated, a
single `/api/v1/portfolio/watchlist` request in `test_perf_capture.py` missed cache on every
ticker and fetched live yfinance data, emitting 3,889 dev-monitor events instead of 440 and
evicting `api.request_start` from the fixed `recent(limit=N)` windows two tests read.
Fix: `tests/conftest.py` gained an autouse `_isolated_db` fixture pointing `_DB_PATH` at
`tmp_path`, with a `virgin_db` marker for the one migration test that needs an isolated but
uninitialised file. `test_perf_capture.py` serves the watchlist from canned bars.
`MONEYVIEW_DISABLE_STARTUP_JOBS` stops the lifespan's live-data warmers under pytest.
Files changed: `tests/conftest.py`, `pyproject.toml`, `tests/api/test_corporate_comparison.py`,
`tests/api/test_perf_capture.py`, `apps/api/main.py`, `tests/api/test_startup_jobs_gate.py`.
Prevention: the diagnosis here took far longer than the fix because the evidence -- a 403s
runtime and two failures that alternated -- was ambient rather than reported. Both invariants
are now enforced in `tests/conftest.py` instead of trusted: `_forbid_the_real_database`
fails any test that opens the production SQLite file, and `_forbid_network` fails any test
that resolves or connects to a non-loopback host. Both were verified against a deliberately
violating test before being committed. Checking a file's mtime by hand after a run, or
inferring hermeticity from wall-clock time, is not a control.

## 2026-07-29: The suite's network guard was blind to yfinance's actual transport

Date: 2026-07-29
Command: `python -m pytest tests/api/test_corporate_metric_audit.py -q` (the RED step of
Task 7 of the statements-acquisition plan)
Failure: Silent, and the worst shape -- no failure at all. A test that called the old
`get_yahoo_statement_bundle` reached the **live Yahoo API** and came back with a real HTTP
404, while `tests/conftest.py`'s session-scoped `_forbid_network` fixture was active and
reported nothing. The fixture exists precisely to make "no test may make a network call"
enforced rather than asserted, and it had been treated as proof: on 2026-07-28 a 274-test
run under a throwaway no-network plugin reported "0 blocked attempts", which was read as
evidence that no test touches the network. It was evidence of no test touching a **socket**.
Root cause: `_forbid_network` patches `socket.socket.connect`, `socket.socket.connect_ex`
and `socket.getaddrinfo`. yfinance 1.2.0 does not use any of them -- its HTTP transport is
`curl_cffi` 0.13/0.15, which drives libcurl through cffi and never enters Python's `socket`
module. Every one of the three patches is structurally incapable of seeing a yfinance
request. The guard was not weak, it was aimed at the wrong layer, and nothing in a green
suite could reveal that: the guard's silence is identical whether no call was made or a
call was made through a path it cannot observe.
Fix: patch `curl_cffi.Curl.perform` in the same fixture and refuse it outright. Nothing in
this project uses curl_cffi for anything local, so no allowlist is needed -- any call
through it is a network call. Guarded with `try: from curl_cffi import Curl / except
ImportError` since curl_cffi arrives only as a yfinance dependency, and restored after
`yield`.

**Correction, 2026-07-31.** This entry originally claimed `perform` was "the single
chokepoint every curl_cffi request funnels through, sync or async, so it covers
`requests.Session`, `AsyncSession` and raw `Curl` alike." That was asserted, not verified,
and it is false. In curl_cffi 0.13.0 `Curl.perform` is called only from the **sync**
`Session` (`requests/session.py:593,640`) and `websockets.py:358`; `AsyncSession` (which
begins at `session.py:685`) dispatches through `AsyncCurl.add_handle`
(`session.py:1025,1069` -> `aio.py:237`) and never calls `perform`. The async path was
therefore still open, and libcurl opens its socket in C so the three socket patches could
not see it either. The fixture now also patches `AsyncCurl.add_handle`, and
`test_an_async_curl_cffi_request_is_refused` pins it -- mutation-verified: with the
`add_handle` patch removed the test fails and the request goes out. Note what happened
here: this entry's own closing lesson is "confirm the code you mean to block actually
travels through the layer you patched," and the Fix paragraph directly above it then made
exactly that unverified claim about a second layer.
Files changed: `tests/conftest.py`, `tests/api/test_suite_guards.py` (new).
Prevention: the guards are now tested rather than assumed. `tests/api/test_suite_guards.py`
asserts that a public-host socket connect, a public-host DNS resolution, and a `curl_cffi`
request are each refused, and that loopback still works (`find_available_port` in
`apps/api/main.py` depends on it). The curl_cffi test was mutation-verified: with
`Curl.perform = guarded_perform` removed from the fixture, it fails with "DID NOT RAISE"
and the request goes out to the network, so it cannot pass vacuously.
The general lesson is broader than curl_cffi: a guard that patches a *mechanism* only
covers callers that use that mechanism. Before trusting one as proof of an invariant,
confirm the code you mean to block actually travels through the layer you patched --
"nothing was blocked" and "nothing was attempted" are indistinguishable from the outside.

## 2026-07-31: The local statement store's frames were unreadable by the metric layer

Date: 2026-07-31
Command: `python -m pytest tests/core_finance/ tests/api/ -q` (376 passed -- the suite was
green throughout, which is the point of this entry)
Failure: Silent, and total. After the statements-acquisition branch rewired corporate
metrics to read the local store instead of a live provider fetch, every statement-derived
metric -- growth, ROIC, WACC, debt ratio, reinvestment, FCFF, innovation -- silently fell
back to deterministic assumptions for every ticker, no matter how much data acquisition
had correctly stored. Nothing raised. The metric audit continued to report
`source_mode="yahoo_finance"`, claiming statement provenance for figures that were entirely
fallback. Reproduced end to end with a five-year store round trip: `revenue_years=[]` while
the rows sat correctly in SQLite.
Root cause: `apps/api/services/acquisition/store.py:_frame` labelled DataFrame columns with
`period_end`, which SQLite returns as TEXT. The metric layer takes the period off the column
label with `_safe_statement_year`'s `int(getattr(date_index, "year", 0))`
(`corporate_statement_metrics.py:149-153`). A `str` has no `.year`, so it returned `0`, and
`_statement_year_value_items` then dropped every row as older than
`YAHOO_STATEMENT_START_YEAR`. The pre-branch bundle came straight from yfinance, whose
frames carry `pd.Timestamp` columns; the source converts Timestamp to string on the way in
and nothing converted back on the way out.
Fix: `_frame` now sets `frame.columns = pd.to_datetime(frame.columns)`, with a comment
naming the `getattr(col, "year", 0)` coupling that makes the label type load-bearing.
Files changed: `apps/api/services/acquisition/store.py`,
`tests/api/test_corporate_metric_audit.py`, `tests/api/acquisition/test_store.py`
Prevention: The real defect was a missing test seam, and it was specified that way in the
plan. Every metric test injected `bundle_loader=` with frames built by `pd.Timestamp(period)`,
and the three tests that did exercise the store asserted only at frame level
(`bundle["income"].loc["Total Revenue", "2025-09-30"] == 42.0`), which passes with string
columns. No test anywhere ran the metric layer over a bundle the store had actually
produced. `test_stored_statements_actually_drive_the_metric_layer` now does, calling
`yahoo_statement_metrics` with no `bundle_loader` argument so it must use the production
default. The general rule: when a task replaces the implementation behind a seam, at least
one test must cross that seam with the production wiring -- a test that injects at the same
boundary the change moved cannot see the change. Note also that
`test_periods_are_newest_first` asserted the string column form and therefore encoded the
bug; a test that pins an incidental representation will defend it.

## 2026-07-31: Quick Start failed -- 2,619 orphaned postcss workers saturated the machine

Date: 2026-07-31
Command: `run moneyview` (`scripts/start_local.ps1`)
Failure: `Quick Start failed. The frontend process did not become healthy within 45 seconds
for http://localhost:3000.` The log looked contradictory: Next reported `Ready in 453ms` and
then `Compiling / ...`, with no error. Raising the timeout would not have helped -- the
compile never finished. Fifteen minutes later `/` still had not compiled, and the dev
server's own log (`apps/web/.next/dev/logs/next-development.log`) held exactly two lines, the
second being `Compiling / ...` at t+4s.
Root cause: Turbopack's PostCSS transform spawns a separate node process per invocation
(`apps/web/.next/dev/build/postcss.js <n>`) and, against the stale 1.3 GB `.next` cache
present at the time, never reaped them. `Get-Process node` showed **2,631 node processes
holding 58 GB of working set**, all spawned inside the twelve minutes since startup, 2,619 of
them that postcss worker. The machine had no capacity left, so the first page compile could
not progress. The health check was reporting a real failure; its message just pointed at the
timeout rather than the cause.
Fix: kill the orphaned workers and delete the stale build cache.
```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*MoneyViewpps\web*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item -Recurse -Force apps\web\.next
```
With a clean cache the same `npm run dev` served `/` with HTTP 200 in under 10 seconds and
held steady at 4 node processes. `/` 5.4s, `/corporate` 1.5s, `/portfolio` 1.0s.
Files changed: none -- environment state only. Nothing in the repository was at fault, and
the branch under test had changed four lines of frontend code, none CSS-related.
Prevention: when a Next dev server reports `Ready` and then hangs on `Compiling`, count node
processes before touching the timeout -- `(Get-Process node).Count` in the low thousands is
the signal, and the process command line names the culprit transform. The general trap: a
health-check timeout names the symptom it observed, never the resource exhaustion that caused
it, so a "did not become healthy in N seconds" message is not evidence that N is too small.
Two orphan classes are worth checking after any failed start, because `start_local.ps1` tears
down the process it launched but not the workers that process spawned: node workers under
`apps/web`, and a stray `npm exec -- next dev` wrapper holding port 3000.

## 2026-08-02: Escape never reaches the stock detail modal when a rail panel is open behind it

Date: 2026-08-02
Command: `cd apps/web && npx playwright test portfolio-watchlist.spec.ts` (test `clicking a
holding opens the stock detail modal`)
Failure: open the Watchlist Holdings rail panel, click a holding card, press Escape. The
side panel closes and the stock detail modal stays open. A second Escape closes the modal.
With no panel open, one Escape closes the modal as it always did. Not caught before Task 12
because the same spec was already failing earlier, at `gotoPortfolio`, so the Escape
assertion never ran.
Root cause: both `SidePanel` and `ModalShell` register a `keydown` listener on `document`.
`SidePanel`'s `handleKeyDown` is stable (`onClose` is a `useCallback` in `PortfolioShell`),
so it is registered once. `ModalShell`'s `handleEscape` is `useCallback([onClose])` and every
caller passes an inline arrow (`onClose={() => setSelectedStockContext(null)}`), so its
effect re-runs on every render and re-subscribes each time. During the Escape dispatch the
SidePanel handler runs first and closes the panel; React 19 flushes that discrete update
synchronously, `ModalShell`'s effect re-runs mid-dispatch and calls
`removeEventListener` + `addEventListener`. Per the DOM dispatch algorithm a listener removed
during dispatch is skipped and a listener added during dispatch is not in the snapshot, so
the modal's handler is never invoked for that keypress. Verified by wrapping
`document.addEventListener` in a Playwright init script and logging invocations: with a panel
open the Escape produced `["sidepanel"]` only.
Fix: APPLIED 2026-08-02. `ModalShell` now reads `onClose` from a ref, so `handleEscape` is
`useCallback([])` and the effect depends on `open` alone. Registration no longer moves when a
caller re-renders, so nothing is added or removed mid-dispatch. Fixed in the component rather
than by memoising `onClose` at each call site, because the defect belongs to every
`ModalShell` caller and a per-site fix leaves the next one broken.
Files changed: `apps/web/components/ui/ModalShell.tsx` (fix),
`apps/web/tests/e2e/portfolio-watchlist.spec.ts` (the spec now presses Escape with the
holdings rail panel open behind the modal — the exact configuration that reproduced it —
instead of clicking Close).
Prevention: a `document`-level key handler whose effect depends on a prop callback is only
safe while it is the sole such handler. `SidePanel` already carries a comment about keeping
`onClose` stable; `ModalShell` needs the same property, and it is not enough to fix one call
site because the defect is in the component. When two overlay layers both listen on
`document`, assert both close paths in a test that has both layers open.

## 2026-08-02: The apply-to-snapshot confirmation renders in a panel the user is not looking at

Date: 2026-08-02
Command: `cd apps/web && npx playwright test portfolio-watchlist.spec.ts` (test `weight
editing and sync or import controls are visible and actionable`)
Failure: with `Apply allocation changes to snapshot` checked, editing a weight in the
allocation panel saves and updates the snapshot, but the confirmation
`Saved allocation changes and updated the <date> snapshot.` never appears. The action is
performed from the Portfolio Allocation Workspace panel; the message is written to
`portfolioComparisonMessage`, which is rendered only inside `snapshotPanelBody`
(`apps/web/app/portfolio/page.tsx:2354`). Only one panel mounts at a time, so the message
exists but is unmounted at the moment it is set. The failure mode on the error path is worse:
`Failed to update the snapshot after saving allocation changes.` is equally invisible.
Root cause: Task 11 moved the stacked sections into single-mount rail panels and lifted
`mutationMessage` to the shell for exactly this reason (see the comment at
`apps/web/app/portfolio/page.tsx:2848`), but `portfolioComparisonMessage` was left behind in
the snapshot panel while one of its writers stayed in the allocation panel.
Fix: APPLIED in `8d80c1c` after the report. The sole render site inside `snapshotPanelBody`
was removed and `portfolioComparisonMessage` now renders at the shell level next to
`portfolio-mutation-message`, with `data-testid="portfolio-comparison-message"`. The spec's
workaround - switching to the snapshot panel to read it - is now unnecessary but still
passes, since the message is visible from every panel.
Files changed: `apps/web/tests/e2e/portfolio-watchlist.spec.ts` (spec, in `8f0cac5`),
`apps/web/app/portfolio/page.tsx` (fix, in `8d80c1c`).
Prevention: when a panel body writes user feedback, check which panel renders the state it
writes to. Anything written by more than one panel, or by a modal, belongs in the shell.

## 2026-08-02: The portfolio page still scrolls at the document level despite its single scroll region

Date: 2026-08-02
Command: `cd apps/web && npx playwright test portfolio-tile-grid.spec.ts` (test `the grid
scroll region is the only vertically scrolling region on the page`)
Failure: `document.documentElement.scrollHeight` is 816 against a `clientHeight` of 720 on
`/portfolio` at 1280x720 - the page scrolls 96px behind the shell. Exactly one *scroll
container* exists (`portfolio-scroll-region`, the acceptance criterion as written), but the
document is a second vertically scrolling surface, so the rail and the grid can be scrolled
partly out of view.
Root cause: `PortfolioShell`'s root is `h-[calc(100vh-4rem)]`, which subtracts the 4rem
header, but the app shell's `<main>` wraps it in `p-4 pt-20 lg:p-20`. On `lg` that is 80px of
padding above and below a 656px block inside a 720px viewport: 816px total, 96px over. Below
`lg` the padding is 80px/16px, which still overflows. The `4rem` in the calc does not
correspond to any single measurement in the surrounding layout.
Fix: APPLIED 2026-08-02. `AppShell`'s `<main>` now publishes its vertical padding as
`--main-pad-top` / `--main-pad-bottom` and consumes those same variables for its own
`pt-`/`pb-` utilities, so the numbers exist in one place. `PortfolioShell` is
`h-[calc(100vh - var(--main-pad-top,0px) - var(--main-pad-bottom,0px))]`. Chosen over
`h-full` on a viewport-height `<main>`, which would have made every page's `<main>` a
fixed-height box and moved the scrolling surface for all of them. The fallbacks keep the
shell sane if it is ever rendered outside `AppShell`. Verified at 1280x720 (the reported
case, `lg`: 80px + 80px) and below `lg` (80px + 16px), where the old constant was also
wrong, by a different amount.
Files changed: `apps/web/components/ui/AppShell.tsx`,
`apps/web/app/portfolio/components/PortfolioShell.tsx`,
`apps/web/tests/e2e/portfolio-tile-grid.spec.ts`.
Prevention: `100vh - <constant>` is a guess about an ancestor's box. Assert the containment
instead of trusting the arithmetic: `documentElement.scrollHeight <= clientHeight` is one
line and it is what "one scrolling region" actually means to a user.

## 2026-08-02: StockNewsCrawler reported every provider failure as "no news"

Date: 2026-08-02
Command: `python -m pytest tests/api/acquisition/test_news_source.py -q` (writing the
FAILED-vs-EMPTY tests for the news acquisition source, plan task 2)
Failure: silent, and it never raised. `StockNewsCrawler.crawl()` wrapped its whole body in
`except Exception: logger.warning(...)` and then fell through to `return results`, so a
network error, a 429, or a malformed feed all returned `[]` - byte-identical to a ticker that
genuinely has no news. Through the new `fetch_news` acquisition source that would have been
recorded as a successful acquisition of zero articles: `last_checked_at` advanced, the tile
said "checked, no news", and the freshness boundary then suppressed retries for an hour. The
user would be told there is no news when in fact nobody could reach the provider.
Root cause: two compounding defects. (1) The broad `except Exception` around the entire method
converted every failure into the empty-success value instead of propagating. (2) `feedparser`
does not raise at all - on a fetch or parse error it sets `bozo=True`, stores the cause in
`bozo_exception`, and returns an object with `entries == []`. So even after removing the broad
catch, the feedparser path still silently produced `[]`; the flag has to be read explicitly.
Fix: `apps/api/services/webscrap/Crawler/StockNewsCrawler.py` - raise `bozo_exception` when
`parsed.bozo` is true and `parsed.entries` is empty (that conjunction is what distinguishes a
failed fetch from a feed that merely has a non-fatal quirk), and re-raise from the `urllib`
fallback rather than returning a partial list. `ImportError` still falls through to the
fallback, which is the one case where continuing is correct. Commits `67975ed`, `3ba2d43`.
The pre-existing caller `NewsService.crawl_stock_and_save` (`news_service.py:216-218`) has its
own `except Exception -> return []`, so its behaviour is deliberately unchanged; only the
acquisition source sees the exception, which is the point.
Files changed: `apps/api/services/webscrap/Crawler/StockNewsCrawler.py`,
`tests/api/acquisition/test_news_source.py`.
Prevention: a fetch function must never use its empty-success value as its error value - the
caller cannot tell them apart, and here the difference decides whether a retry ever happens.
When wrapping a third-party parser, check how IT reports failure before deciding you have
handled failure: `feedparser` reports through a flag, not an exception, so a correct-looking
`try/except` around it catches nothing. The tests now assert the FAILED path by injecting a
crawler that raises AND one that returns a bozo result, because only the second would have
caught defect (2).
