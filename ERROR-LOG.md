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

**If an entry records a defect as unfixed, and it is fixed later, amend its `Fix:` line.**
Add the detail in a new paragraph by all means, but the `Fix:` line itself has to change,
because that line is what anyone asking "what is still broken?" reads. On 2026-08-06 a sweep
of this file reported three live defects that had all been fixed — one of them months
earlier. Each carried an accurate resolution paragraph further down, and each still opened
with "Not fixed". The record was wrong, not the code, and re-reading the entry could not
reveal that; only checking the code did.

An entry states what was true when it was written. Nothing updates it on its own.

## 2026-09-04: `openpyxl` missing from `pyproject.toml` blocks the API from booting on a clean checkout

Date: 2026-09-04
Command: `cd apps/web && npm.cmd run test:e2e` (the Playwright harness boots the API server
as a fixture before any spec runs).
Failure: `ModuleNotFoundError: No module named 'openpyxl'` raised while the API process
starts, which fails the harness's boot step and blocks the entire e2e suite -- not just
the one feature under test.
Root cause: `apps/api/services/industry_benchmark_store.py:17` does `import openpyxl` at
module scope, but `openpyxl` was never added to `dependencies` in `pyproject.toml`. On
the machine where this module was written, `openpyxl` happened to already be installed
(a transitive dependency of something else, or a leftover from manual testing), so the
import silently succeeded there and the gap was invisible. Any other clean checkout --
CI, a new contributor's machine, or a fresh venv -- installs only the declared
dependencies and fails at import time as soon as anything imports
`industry_benchmark_store`, including indirectly through the API app's route
registration.
Fix: added `"openpyxl"` to `dependencies` in `pyproject.toml`.
Files changed: `pyproject.toml`.
Prevention: a module-scope import of an undeclared package passes silently on whichever
one machine happens to already have it installed and fails everywhere else -- and
nothing in the test suite catches this class of bug, because the suite itself only ever
runs on that same machine. There is no test for "does a clean `pip install .` produce a
bootable app"; the only way this surfaces is someone actually trying a fresh checkout, as
this task's e2e harness boot did. When adding a new module-scope third-party import,
cross-check it against `pyproject.toml`'s `dependencies` list in the same change, since a
passing local test run cannot catch the omission.

## 2026-09-03: Corporate comparison snapshots accumulate a new version on every refresh click

Date: 2026-09-03
Command: manual inspection of `corporate_comparison_snapshots_v3` on the live database.
Failure: the live table held 8 versions of `snapshot_date = 2026-04-23`, seven of them
created within about three minutes of each other. `MSFT` and `IAUM` are byte-identical
across all 8; only the benchmark `^GSPC` moves, by pennies (`dcf_value` 6313.41 ->
6313.14 -> 6313.34 -> 6312.65 -> 6312.59). Nothing raised -- every write succeeded and
was individually correct -- so the only symptom was version bloat silently piling up on
every click of the same refresh button.
Root cause: `_snapshot_version_id` built the identity from `snapshot_taken_at`
(a wall-clock timestamp captured at the top of the request), concatenated with the
universe key. Two calls a minute apart differ only in that timestamp, so every refresh
minted a new primary-key value even when the day, universe, and CAPM assumptions were
identical -- there was no notion of "the same snapshot" to replace.
Fix: `_snapshot_version_id` now keys on INPUTS instead -- `snapshot_date`, `universe_key`,
the assumptions (in their STORED, rounded-percentage form, not the raw decimal argument,
so two equal runs cannot disagree over float noise), and `METRIC_SCHEMA_VERSION` -- with
no timestamp component. A rule comparing OUTPUT figures was considered and rejected: it
would have caught only 3 of the 8 live versions, defeated by the penny-level tick on
`^GSPC` that nobody was actually looking at. The write changed from `INSERT` to
`INSERT OR REPLACE` (the primary key is `(snapshot_version, ticker)`, so a second click
with unchanged assumptions now replaces the row in place instead of raising
`sqlite3.IntegrityError`), and a delete was added for any ticker that has left the
universe under a reused version, so a shrinking universe leaves no orphaned rows.
`snapshot_taken_at` is still recorded in its own column -- only the version *identifier*
dropped it.
Files changed: `apps/api/services/corporate_comparison.py`,
`tests/api/test_corporate_comparison.py`.
Prevention: when a dedupe/identity key is derived from data that includes both
"what changed" and "when it was observed," keying on the latter silently defeats the
former -- prefer keying on the narrowest set of inputs that actually make two writes
the same thing, verified by a test that repeats a write with unchanged inputs and
asserts the identity did not move (verified here by re-adding the timestamp component
and confirming `test_repeating_a_snapshot_with_unchanged_assumptions_does_not_add_a_version`
fails -- though on this Windows sandbox that specific test's own back-to-back calls can
land within one clock tick and coincidentally agree; two sibling tests in the same file,
one using assumptions an hour apart and one asserting the identity's format directly,
independently confirmed the mutation is caught).

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
Fix: **RESOLVED — see the "Fixed in `f1484b9`" paragraph below.** At the time of writing:
not fixed — needs a spec decision on what the server-side `page_load` span is
for. Options: (a) drop it and derive page-load grouping from the `request_group`
metadata already on the request span, since the frontend's `useDevMonitorPageLoad`
emits the real multi-request page-load span; (b) keep it as a grouping label excluded
from self-time accounting; (c) keep it and have `breakdown_by_scope` treat
same-interval parent/child pairs as one span.
Files changed: none (record only).

**Fixed in `f1484b9`** ("remove same-interval span duplication, making criterion 2
measurable") — option (a). The server-side `page_load.<component>` span is gone from
`middleware.py`; `page_load` survives only as a scope name in the allowed-scopes literal
(`schema_parts/dev_monitor.py:19`), which is what the frontend's `useDevMonitorPageLoad`
emits against, and that one measures a real multi-request interval the request span does
not cover. Verified 2026-08-06: no `page_load` emission remains anywhere in `apps/api`.
This "Fix:" line was left reading "Not fixed" for that whole period.
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
Fix: **RESOLVED — see the "Fixed in `d7ada0b`" paragraph below.** At the time of writing:
not fixed here — out of scope for Task 13, which only surfaced it while
verifying that the perf suite was green. Belongs to Task 6 (spec §04.10).
Files changed: none (record only).

**Fixed in `d7ada0b`** ("convert the remaining perf_analysis tree walkers to explicit
stacks"), as Task 6 predicted. `_to_node`, `_assign_offsets`, `_assign_self_ms` and
`_depth_map` are all explicit-stack walks now, each carrying a docstring naming this
failure, and `test_a_chain_far_deeper_than_the_recursion_limit_truncates_instead_of_raising`
pins a depth-2000 chain — past the reach of every one of them at CPython's 1000-frame
default. Verified 2026-08-06: `tests/api/test_perf_analysis.py` is 45 passed.
This "Fix:" line was left reading "Not fixed" for that whole period.
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
Fix: **RESOLVED — see the "Fixed 2026-08-06" paragraph below.** At the time of writing:
not fixed here -- out of scope for the perf-instrumentation task (Task 13),
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

**Fixed 2026-08-06, with a correction to the diagnosis above.** Writing the suggested
regression test found that `/market/indices` no longer reproduces: it declares
`response_model=List[IndexQuote]`, and FastAPI serializes those through pydantic's own
JSON writer, which emits `null` for non-finite floats and never reaches Starlette's
`json.dumps`. Whether that was true on 2026-07-26 or arrived with a later dependency bump
is not recoverable from the repo -- either way the entry's "the underlying route bug
remains open" had been false for some unknown period, and re-reading the entry could not
have revealed that. Only executing the test it asked for did.

The hazard itself was real and still live, one layer over: the protection comes from the
`response_model=`, not from the route or the data. Of 56 routes, 8 declare no
`response_model`, and 3 of those return live-derived floats -- `POST /corporate/dcf/{ticker}`,
`/corporate/metrics/{ticker}/history`, `/corporate/metrics/{ticker}/quarterly-statements`.
A NaN in any of them still 500'd, confirmed by test before the fix with the same
`ValueError: Out of range float values are not JSON compliant` traceback.

Fixed by the shared response class this entry's own Prevention section proposed:
`apps/api/core/responses.py` defines `NonFiniteSafeJSONResponse`, which replaces non-finite
floats with `null` and is now the app's `default_response_class`. That makes both kinds of
route agree instead of leaving the outcome to whether a route happens to declare a model.
`allow_nan=False` is kept in the renderer so anything the walk misses still raises rather
than emitting a bare `NaN` token.

Null, not 0.0: `guideline/sop/finance-logic.md` prohibits standing a real figure in for an
absent one, and a NaN delta rendered as 0.0% would read as "unchanged". This is also why
the web boundary does not reuse the compute boundary's sentinel encoder -- that value has
to survive a round trip back into a pydantic model, whereas this one is read by a
TypeScript client that expects a number or null.

Files changed: `apps/api/core/responses.py` (new), `apps/api/main.py`,
`tests/api/test_nonfinite_json_boundary.py` (new).
Prevention (revised): the original Prevention was right about the fix and wrong about the
verification -- it proposed testing `/market/indices`, the one route that was already
immune, so that test would have passed on day one and proved nothing. When a defect is a
serialization-boundary property rather than a route's own logic, the test has to target
what actually decides the outcome. Here that is the presence of a `response_model`, so the
regression test exercises a route without one. Both cases are pinned, so a future
dependency bump that changes either path fails a test instead of changing behaviour
silently.

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

## 2026-08-03: Yahoo's Net Debt line was silently read as Total Debt, understating WACC weights

Date: 2026-08-03
Command: `python -m pytest tests/api/test_statement_debt_extraction.py -v` (writing the
failing tests for DCF data-completeness plan task 5)
Failure: silent, and it never raised. Three sites in `corporate_statement_metrics.py`
called `_statement_map(balance, ("Total Debt", "Net Debt"))`, treating the two labels as
an alias pair - whichever one Yahoo provided was read into `debt_by_year` unchanged. But
`Net Debt` is `Total Debt` minus cash, not a synonym. For a cash-rich company the two
differ by most of the balance sheet: with total debt 100B and cash 90B, Yahoo's `Net Debt`
line reads 10B, and reading that as total debt understated `debt_ratio` by 90% of the
balance sheet (9.09% measured instead of the true 50%), corrupting every capital-structure
weight and the WACC derived from it. `test_total_debt_is_recovered_from_net_debt_plus_cash`
asserted `debt_ratio == 50.0` and observed `9.09`.
Root cause: `_statement_map`'s alias-tuple mechanism assumes every label in the tuple
denotes the same underlying quantity under a different Yahoo field name (true for most of
its other callers, e.g. `"Pretax Income"` vs `"Income Before Tax"`). `Total Debt` and
`Net Debt` do not satisfy that assumption - they are related but numerically distinct
quantities - so treating them as aliases silently substituted the wrong figure whenever
Yahoo omitted the `Total Debt` line.
Fix: added `_gross_debt_map(balance, quarterly_balance)` in
`apps/api/services/corporate_statement_metrics.py`, which reads `Total Debt` and
`Net Debt` as separate series and recovers gross debt as `Net Debt + cash` only for years
where `Total Debt` itself is absent, so coverage does not drop. This is deliberately the
gross-debt expression: the cash term does not cancel here, unlike
`apps/api/services/equity_bridge.py`, which reads the same two line items to produce NET
debt (where the cash term does cancel). The two modules were kept independent on purpose -
same inputs, two different consumers, two different expressions; no shared helper was
extracted between them. All three call sites (`yahoo_statement_metrics`,
`metric_audit_for_ticker`, `yahoo_metric_history`) now call `_gross_debt_map` instead of
aliasing the two labels through `_statement_map`/`_quarterly_balance_map` directly.
Files changed: `apps/api/services/corporate_statement_metrics.py`,
`tests/api/test_statement_debt_extraction.py`.
Prevention: an alias tuple passed to `_statement_map` must denote the same quantity under
every label, never merely a *related* quantity - a WACC input derived from a proxy value
is wrong in a way that produces a plausible number and raises no error. When two line
items are related by an inexact identity (`Net Debt = Total Debt - Cash`), the recovery
formula must be written explicitly at the point of use, keeping the sign/expression tied
to what that specific consumer needs (gross vs. net), rather than folded into a general
alias-lookup helper.

## 2026-08-03: The comparison table's expected-return columns were structurally pinned at zero

Date: 2026-08-03
Command: `python -m pytest tests/api/test_corporate_comparison.py -k "dcf_implied_return" -v`
(writing the failing tests for DCF data-completeness plan task 6)
Failure: silent, and it never raised. `_dcf_snapshot` in
`apps/api/services/corporate_comparison.py` called
`calculate_expected_return_result` with `intrinsic_value=current_price` — the same value
already passed as `current_price`. `dcf_implied_return` is a function of the gap between
intrinsic value and current price, so `f(price, price)` evaluated to `0.0` for every
ticker, every snapshot, unconditionally. `stock_expected_return` is assigned directly from
`dcf_implied_return`, and `expected_return_spread` is derived from `stock_expected_return`
minus `market_expected_return`, so the defect propagated into three columns of the
comparison table that all read as plausible percentages while carrying no signal at all.
Compounding it, `net_debt=0.0` and `non_operating_assets=0.0` were hardcoded in the same
function (rather than read from the equity bridge), so even the enterprise value produced
there was mislabeled as a per-share `estimated_value` and `status` was hardcoded to the
literal string `"Bridge Incomplete"` for every row, regardless of whether a bridge could
have resolved.
Root cause: `_dcf_snapshot` predates the equity-bridge loader built for the single-ticker
DCF endpoint (`apps/api/services/corporate_dcf.py`, task 4 of this plan) and was never
wired to it. Lacking a real net debt, share count, or non-operating-assets figure, whoever
wrote the comparison path passed the only per-share number in scope — `current_price` — as
a placeholder for intrinsic value, which zeroes the implied-return formula by
construction rather than by a bug in the formula itself.
Fix: `_dcf_snapshot` now takes a keyword-only `bridge_loader=load_equity_bridge` and calls
it per ticker, mirroring the pattern already established in
`corporate_dcf._build_dcf_outputs`. `net_debt`, `non_operating_assets`, and
`diluted_shares_outstanding` come from the resolved `EquityBridge`; `equity_value` and
`intrinsic_value_per_share` are computed for real via `calculate_equity_value` and
`calculate_intrinsic_value_per_share`, and that intrinsic value — not `current_price` — is
what feeds `calculate_expected_return_result`. `status` is now `"Undervalued"` /
`"Overvalued"` / `"Bridge Incomplete"` based on whether the bridge actually resolved.

Correction (2026-08-03, whole-branch review): **the `status` change is internal only and
no consumer can observe it.** `_dcf_snapshot` returns `"status"` in a plain dict, but
`CorporateComparisonRow` (`apps/api/models/schema_parts/corporate.py`) has no `status`
field and never has, `_build_live_rows` does not read the key, and it is not persisted to
`corporate_comparison_snapshots_v3`. The `status: str` that the UI renders belongs to
`DCFSummary`, a different model built by `corporate_dcf.py` for the single-ticker DCF
endpoint. The key was dead before this change and is still dead after it; the change
turned a constant into a computed verdict that nothing reads. **The observable fixes in
the comparison table are `dcf_value`, `bridge_quality`, and the three expected-return
columns** (`dcf_implied_return`, `stock_expected_return`, `expected_return_spread`) — not
`status`. No field was added to surface it: a verdict derivable from `dcf_value`,
`current_price` and `bridge_quality`, which the row already carries, does not need its own
column. The computation site now carries a comment saying so.
Because the aggregate averages (`average_dcf_value`, `average_expected_return_spread`) are
computed in SQL over persisted snapshot rows rather than in Python over live rows, a new
`bridge_quality` column was added to `corporate_comparison_snapshots_v3` (guarded
`ALTER TABLE`, default `''` so pre-existing rows keep reading exactly as they do today) so
those aggregates can exclude `bridge_quality = 'missing'` rows without also excluding
`'estimated'` rows, which carry a defensible number. `METRIC_SCHEMA_VERSION` was bumped
1 -> 2 so snapshots computed before and after this fix are never compared as like for like.
Files changed: `apps/api/services/corporate_comparison.py`, `apps/api/services/db.py`,
`tests/api/test_corporate_comparison.py`.
Prevention: when a formula call site is passed the same variable for two logically
distinct parameters (here, `current_price` filling both `current_price` and
`intrinsic_value`), treat it as a placeholder that was never replaced, not a valid
default — a spread/delta formula fed identical arguments always degenerates to zero or
one, and that degenerate case produces no error, just a column of numbers that all look
individually plausible. Grep for `_dcf_snapshot`-shaped functions that compute an
enterprise-to-equity bridge inline instead of calling the shared `load_equity_bridge`
loader; duplicated bridge logic is where a hardcoded `0.0` is most likely to hide.

## 2026-08-05: The comparison table presented enterprise values as intrinsic values per share

Date: 2026-08-05
Command: No failing command. Found by reading the corporate comparison table against the
DCF payload's own `bridge_quality` field; every suite was green throughout.
Failure: The "DCF Value" column rendered `dcf_value` as a dollars-per-share figure for
every row. For any ticker whose enterprise-to-equity bridge did not resolve, `dcf_value`
holds an **enterprise value in billions** instead. `AAPL` at `$240.50` and a bridgeless
ticker at `$2,438.00` sat in the same column, formatted identically, with nothing marking
the second as a different financial quantity. The same value also ranked in the DCF sort
(sorting first under "descending", since it is numerically the largest) and plotted on a
scatter axis paired with `current_price`. In the snapshot history, `average_dcf_value`
moved by an order of magnitude the day the bridge shipped, drawn as a valuation move.
Root cause: Two causes, one structural and one presentational.

`dcf_value` is deliberately a union of two quantities -- `intrinsic_value_per_share` when
the bridge resolves, `enterprise_value` when it does not (`apps/api/services/corporate_dcf.py:222`,
`corporate_comparison.py:399-403`). That fallback was introduced as a backwards-compatible
alias so no consumer broke when the bridge landed, and it is defensible on its own terms.
What was missing is that **no consumer was ever taught the difference.** `bridge_quality`
was computed, persisted, and returned on the payload, but none of the three table row
interfaces in `apps/web/app/corporate/` declared it, so nothing in the table *could*
distinguish the cases even in principle.

The scale of the two quantities is what made it survive review: they are three orders of
magnitude apart for a large-cap, which reads as an outlier rather than a unit error. That
framing is itself the trap. Enterprise value and intrinsic value per share are different
financial quantities, not one quantity at two scales -- the objection holds for a company
of any size, including one where the two numbers happen to land close enough that nothing
looks wrong at all.
Fix: `bridgedDcfValue` in `apps/web/app/corporate/corporateDerivedViews.ts` is now the
single place that decides whether a DCF value may be presented; it returns `null` for
`bridge_quality === "missing"` and the value otherwise. The table cell, the sort
comparator, and both scatter builders consume it. Suppressed rows sort last in **both**
directions -- via an explicit null branch ahead of the numeric comparison, not a sentinel,
because `Number(null)` is `0` and would bury them among genuinely small per-share values
in one direction. `metric_schema_version` now reaches the frontend and the snapshot
history marks the point where the metric definition changed.

`estimated` rows keep their number: the fallback input affects confidence, not units. A
guard written `!== "ok"` instead of `=== "missing"` is a defect, and every fixture carries
an `estimated` row so that specific wrong implementation fails a test.
Files changed: `apps/web/app/corporate/corporateDerivedViews.ts`,
`apps/web/app/corporate/corporateTypes.ts`,
`apps/web/app/corporate/components/CorporateComparisonTable.tsx`,
`apps/web/app/corporate/components/TargetStockComparisonSection.tsx`,
`apps/web/app/portfolio/components/SnapshotHistoryModal.tsx`,
`apps/web/app/portfolio/components/PortfolioSnapshotSummary.tsx`,
`apps/web/app/portfolio/page.tsx`, `apps/api/models/schema_parts/corporate.py`,
`apps/api/services/corporate_comparison.py`, plus fixtures and two new Playwright specs.
Prevention: A field whose meaning depends on another field is only safe if every consumer
receives both. When adding a fallback that changes what a value *means* rather than how
precise it is, the discriminator must be added to every consumer's type in the same
change -- not merely returned on the payload, where it is invisible to the code that
matters. Grep test: for any such field, every presentation site must reach it through one
named helper; if `grep` finds the raw field rendered anywhere outside that helper's
callers, the rule is already broken.

This entry's own scope is a live example. The rule was enforced on the field named
`dcf_value` while the identical quantity ships as `estimated_value` and is still rendered
raw on five surfaces -- one of them the modal the suppressed cell opens. Tracked in
`guideline/sop/todo.md`. Policing a value by *field name* rather than by *quantity* is how
half a fix ships looking whole.

**Remainder closed 2026-08-05.** `estimated_value` now reaches every render site through
`apps/web/lib/bridgeQuality.ts`, and `bridgedDcfValue` delegates to the same predicate so
the two field names cannot diverge again. Counting the sites first was worth doing: the
open item said five, and there were ten render expressions across six files.
`buildCalculationDetails.ts` holds three separate detail blocks rather than one, and
`components/workbenches/DCFWorkbench.tsx:186` -- "Implied Fair Value" on the live
`/detail/[ticker]` route -- had never been found by any review, because every earlier search
had been scoped to `app/corporate/`.

`upside_pct` was suppressed in the same pass. It is a second fabricated quantity, not a
presentation detail of the first: `corporate_dcf.py:224` sets it to `0.0` when the bridge
does not resolve, so an unbridged ticker rendered `+0.00%` in the positive colour -- a
fairly-valued reading for a comparison that never happened. Suppressing the value while
leaving that in place would have looked like a rendering bug rather than a fix.

The raw-dataset CSV (`corporateDerivedViews.ts:208`) was deliberately left alone.
`pushRecord` emits every key of the response, so `bridge_quality`,
`intrinsic_value_per_share`, `enterprise_value`, and `valuation_method` all land in the same
`backend_dcf` block. That record is self-describing, which is the condition the Prevention
rule above actually asks for; blanking a field there would remove information from a raw
export rather than add honesty to it. The rule is about values presented *without* their
discriminator, not about every occurrence of the number.

## 2026-08-05: Snapshot history claimed a metric definition changed when it was never recorded

Date: 2026-08-05
Command: `npx playwright test snapshot-history-metric-version` (passing -- the suite
asserted the wrong wording, so nothing was red)
Failure: The snapshot history modal printed "Metric definition changed. Values before and
after this point are not directly comparable." at every point whose `metric_schema_version`
differed from the chronologically preceding point's. That includes the `0 -> 1` edge, where
the claim is not supported by anything stored. Version `0` is written only by the migration
at `apps/api/services/db.py:672`, which added the column to rows computed before it existed
-- so a `0` means the earlier definition went **unrecorded**, not that it **differed**. It may
well have been the same definition. The notice asserted a change no stored value evidences.

The edge is not a corner case: on any install carrying pre-column history it is the first
boundary the user meets, and it sits at the oldest end of the timeline where the user is
least able to check the claim independently.
Root cause: The design spec fixed one sentence of notice wording
(`docs/superpowers/specs/2026-08-03-comparison-value-honesty-design.md:230`) before
enumerating the cases the comparison actually produces. Comparing two version numbers has
three outcomes -- changed, unchanged, and unknown -- and the spec provided text for two of
them. The implementation was faithful to the spec, and the test asserted the spec's sentence
literally, so both agreed with each other and neither agreed with the data. The version-`0`
semantics were correctly documented in three other places (`db.py:669-671`,
`corporate.py:311-314`, the fixture comment in the spec's own e2e test) and still did not
reach the sentence that reports them to the user.
Fix: `versionBoundaryIds: Set<string>` became `versionBoundaryNotices: Map<string, string>`
in `apps/web/app/portfolio/components/SnapshotHistoryModal.tsx`. A boundary whose *preceding*
point is version `0` now reads "Metric definition before this point was not recorded, so
whether values are comparable across it is unknown." Every other boundary keeps the original
sentence. The reverse direction (a newer point at `0`) is deliberately not handled: `0` is
only ever backfilled onto older rows and every write since sets `METRIC_SCHEMA_VERSION`, so
the branch would be unreachable code guarding an impossible state.

The two notices are matched literally and separately in the spec, and each is asserted to
appear exactly once against a fixture containing one boundary of each kind. Break/restore
verified against both wrong implementations: collapsing to the old single notice fails on
`CHANGED_NOTICE` count 2, and labelling every boundary "unrecorded" fails on count 0.
Files changed: `apps/web/app/portfolio/components/SnapshotHistoryModal.tsx`,
`apps/web/tests/e2e/snapshot-history-metric-version.spec.ts`,
`docs/superpowers/specs/2026-08-03-comparison-value-honesty-design.md` (amended in place,
with the original wording left visible).
Prevention: Fixing user-facing wording in a spec is right -- it is what stops the text
drifting -- but the wording can only be fixed once the cases are enumerated. Before pinning a
sentence to a computed condition, list every value that condition can take and write the
sentence for each; a sentinel value like `0`, `''`, or `-1` that means "unrecorded" is a case
of its own and never shares wording with a real value. The second half of the rule: a test
that asserts the spec's sentence verbatim cannot catch a wrong sentence. It pins drift, not
truth. Something in the loop has to check the claim against the data's own semantics, and
here that was only ever going to be a reader asking what a `0` means.


## 2026-08-05: "Terminal Value Share" was a frontend formula unrelated to any terminal value

Date: 2026-08-05
Command: none -- found while implementing the WACC x terminal-growth sensitivity table
(`guideline/sop/todo.md`, Phase 2 item 4). No suite was red.
Failure: `apps/web/app/corporate/page.tsx:466` computed

    const terminalValueShare = clamp(62 + assumptions.growth * 1.8 - assumptions.wacc * 1.2, 20, 88);

and rendered it as "Terminal Value Share" on the DCF Core Modules tile, with the tooltip
"estimates how much enterprise value comes from terminal assumptions" and a dedicated
calculation-detail modal describing a "62.0% model anchor", a "growth contribution", a
"WACC drag", and a "20.0%-88.0% terminal-value concentration guardrail".

None of that is a terminal value share. The quantity is PV(terminal value) / enterprise
value; this expression is a linear function of two assumption sliders that never touches
either. It cannot equal the real share except by coincidence, moves the wrong way in
general, and the 20-88 clamp guarantees it can never report the readings that matter most --
a valuation that is 95% perpetuity is exactly what a concentration metric exists to show,
and this one could not say so.
Root cause: A frontend "derived metrics" layer computing what looks like a financial
quantity, in the one place `guideline/sop/finance-logic.md` forbids ("Keep financial math in
`apps/api`, `apps/api/core`, or `packages/core_finance`, never in `apps/web`"). The real
inputs already existed on the backend: `corporate_dcf.py` had `pv_terminal` and
`enterprise_value` on adjacent lines, and `packages/core_finance/dcf.py:149` already computed
`tv_share_pct` in `multi_stage_dcf` -- a function nothing called.

It survived because a plausible-looking percentage in a labelled tile is indistinguishable
from a measured one. `docs/architecture/visualization-metrics.md:690` recorded its source as
"backend DCF result plus active assumptions" and its ownership as "backend DCF methodology",
which was wrong in both halves and read as confirmation.
Fix: `terminal_value_share_pct` is now measured in `corporate_dcf.py` as
`pv_terminal / enterprise_value * 100` and carried on `DCFSummary`, so the streamed payload
has it. Every frontend site reads it from there. The derived-metrics entry, its type, its
text view, and both calculation-detail blocks describing the old formula are deleted. The
tile shows "N/A" before a DCF has run: a share of enterprise value is a property of a
valuation, and the sliders alone cannot produce one -- which is what the old formula
pretended they could.

The sensitivity grid that prompted this ships alongside, in
`packages/core_finance/dcf.py` (`sensitivity_cell`, `sensitivity_grid`) and on
`DCFFullReport.sensitivity`. Cells where WACC is not above terminal growth carry no numbers
at all rather than the service's `max(wacc - g, 0.005)` clamp, which would report roughly
200x the terminal cash flow at points where the Gordon model has no value.
Files changed: `packages/core_finance/dcf.py`, `apps/api/services/corporate_dcf.py`,
`apps/api/models/schema_parts/corporate.py`, `apps/api/models/schemas.py`,
`packages/shared-types/corporate.ts`, `apps/web/app/corporate/page.tsx`,
`apps/web/app/corporate/buildCalculationDetails.ts`,
`apps/web/app/corporate/corporateDerivedViews.ts`,
`apps/web/app/corporate/components/DcfSensitivityTable.tsx` (new),
`apps/web/app/corporate/components/CalculationDetailModal.tsx`,
`apps/web/app/corporate/components/CorporateDiagnosticsSection.tsx`,
`apps/web/app/corporate/components/graphs/DcfCoreModulesGraph.tsx`, plus fixtures, two new
test files and `docs/architecture/visualization-metrics.md`.
Prevention: A label is a claim about what a number is. "Terminal Value Share" asserts a
specific ratio, and the check is whether the code computes that ratio -- not whether the
output looks reasonable, which a clamped linear function of plausible inputs always will.

The concrete rule, narrower than the SOP's placement rule and the one that would have caught
this: a frontend expression may combine values for presentation, but must not introduce
numeric constants that stand in for a modelling assumption. `62`, `1.8`, `1.2`, `20` and `88`
are all model parameters, and a model parameter in `apps/web` means a model lives there. Grep
test for the rest of this layer: any `derived.*` entry whose formula contains a literal other
than a unit conversion is a candidate, and the same file still holds `successProbability`,
`agencyRisk`, `lifeCyclePosition` and `leveredBetaRiskScore`, all built the same way. They are
tracked under Phase 3 in `guideline/sop/todo.md`; this entry is the precedent for what that
work has to establish about each of them -- either a real derivation or an honest name.

A second defect surfaced while fixing this one, and is the reason the frontend suite went red
rather than the change shipping quietly: the corporate page restores DCF results from
`sessionStorage`, so a payload written by an earlier build has no `terminal_value_share_pct`
at all and `pct(undefined)` threw, blanking the page. Adding a required field to a type whose
values can arrive from a cache older than the type is a runtime problem, not a typing one --
the render sites now check presence at runtime, and `DcfResult.terminal_value_share_pct` is
declared optional to say why.

## 2026-08-06: "Success Probability" was a slider formula, and its Minard chart ranked risks identically for every ticker

Date: 2026-08-06
Command: none -- found while closing Phase 3 items 1, 2 and 4 (`guideline/sop/todo.md`). No
suite was red.
Failure: three related claims on the Corporate Analysis dashboard, none of them computed.

1. `apps/web/app/corporate/page.tsx:466` computed

       const successProbability = clamp(55 + spread * 2.3 + assumptions.growth - assumptions.esgPenalty * 0.25, 5, 95);

   and rendered it as a "Success Probability" KPI card in bold percent, hardcoded to the
   positive colour (`text-[var(--delta-up)]`) whatever the value, captioned "Above 60% is good;
   current status is Good/Weak". Its complement was labelled "Failure Probability" and drawn as
   a distribution area. No probability model existed anywhere in the codebase to produce
   either.

2. The Risk-Return Minard chart plotted four "risk exposure segments" -- Inflation, FX, Demand,
   Margin -- with no inflation, FX or demand series anywhere in the calculation. Each segment's
   Y value was `spread` times a per-segment constant (`12`, `10`, `9`, `11`) plus an offset
   (`-18`, `-6`, `+growth`, `+roic`), and each segment's success/failure pair was the page score
   plus a fixed offset (`-12`, `-5`, `0`, `+4`). That fixed ladder made the chart's headline
   reading -- which risk hurts most -- a constant: Inflation always worst, Margin always best,
   for every ticker and every setting of every slider.

3. The Y series was named `npv`, tooltipped as approximating expected return, and plotted on a
   percent-formatted axis (`fmtPctTick`). Nothing was projected and nothing was discounted, so
   the axis showed a percent of nothing.

`CorporateComparisonTable.tsx:117` also wired the backend `expected_return_spread` cell to open
the Minard modal, so clicking a real per-ticker number opened an explanation of a frontend score
derived from the assumption sliders -- the same values for every row.
Root cause: the same defect class as the 2026-08-05 "Terminal Value Share" entry: a frontend
"derived metrics" layer introducing numeric constants that stand in for modelling assumptions,
in the one place `guideline/sop/finance-logic.md` forbids financial math. `55`, `2.3`, `0.25`,
`5`, `95`, `12`, `10`, `9`, `11`, `-18`, `-6`, `-12`, `-5` and `+4` are all model parameters.

What let it stand longer than the terminal-share defect: `docs/risk-return-minard.md` disclosed
every one of these limitations accurately, in a "Known Limitations" section, including "the
chart uses finance-heavy labels like `successProbability` and `npv` even though the underlying
calculations are simplified scenario proxies". An honest caveat in a doc does not reach the
person reading the card, and its existence made the surface look reviewed. A disclosure is not a
fix; it is a record that no fix was applied.
Fix: removed rather than relabelled, per Phase 3 item 4's own alternative. Relabelling could not
work on any of the three: a score with no model has no honest percent to show, the segment
constants had no rationale to document, and renaming a data key does not make a percent axis
mean something. Deleted the KPI card, both detail modals, the graph component and its dynamic
import, the `RiskReturnPoint` type and both `DetailKey` entries, the `successProbability` /
`failureProbability` fields and the `risk_return_minard` series from the downloadable raw
dataset, and the orphaned "Success probability penalty" step left behind in the ESG penalty
modal. The comparison table's `expected_return_spread` cell is now plain text like the two
expected-return cells before it, since it has no calculation detail of its own.

Nothing replaced it. Value response to assumptions is already covered by measured surfaces: the
WACC x terminal-growth sensitivity grid, the Beta + WACC curve, and the value driver matrix.
`ROIC - WACC` was the chart's only real input and remains as its own card, with audit quality
state attached.
Files changed: `apps/web/app/corporate/page.tsx`,
`apps/web/app/corporate/buildCalculationDetails.ts`,
`apps/web/app/corporate/corporateDerivedViews.ts`,
`apps/web/app/corporate/components/CorporateGraphs.tsx`,
`apps/web/app/corporate/components/CorporateDiagnosticsSection.tsx`,
`apps/web/app/corporate/components/CorporateComparisonTable.tsx`,
`apps/web/app/corporate/components/calculationDetailTypes.ts`,
`apps/web/app/corporate/components/graphs/shared.ts`,
`apps/web/app/corporate/components/graphs/RiskReturnMinardGraph.tsx` (deleted),
`apps/web/tests/e2e/corporate-probability-labels.spec.ts` (new),
`apps/web/tests/e2e/corporate-viewport.spec.ts`,
`apps/web/tests/e2e/responsive-accessibility.spec.ts`, `docs/risk-return-minard.md`,
`docs/architecture/visualization-metrics.md`, `docs/tabs/corporate-analysis-tab.txt`,
`docs/design/MoneyView_Chart_System.md`, `docs/INDEX.md`.
Prevention: two rules, both narrower than "keep financial math out of `apps/web`".

A metric named for a statistical object -- probability, expectation, variance, confidence --
asserts that such an object was estimated. If no distribution or observed frequency exists in
the codebase, the name is unavailable regardless of how the number is scaled or clamped. Colour
and caption carry the same weight as the label: a value hardcoded to the positive colour is a
claim that the number is good.

Second, a chart whose category axis has no per-category data is not a chart of those categories.
The test is cheap and mechanical: change one input and check whether the ranking across
categories can change. Here it could not, for any input -- which means the four segment names
were decoration over a single scalar.

`apps/web/tests/e2e/corporate-probability-labels.spec.ts` pins the absence of these labels on
both the dashboard and the exportable dataset. Each assertion first confirms the surface
rendered, because an absence check that passes against a blank page proves nothing.

Phase 3 item 3 covers the rest of this layer: `agencyRisk`, `lifeCyclePosition` and
`leveredBetaRiskScore` still feed the Company Status radar from `apps/web`, built the same
way. (Closed later the same day by the entry below, which removed all three.)

## 2026-08-06: The Company Status radar scored slider formulas against a hardcoded peer polygon

Date: 2026-08-06
Command: `npx playwright test --project=chromium` (the stale-locator half; the scoring defect
itself was found by closing Phase 3 item 3 in `guideline/sop/todo.md`, with no suite red)
Failure: the "Company Status Diagnosis" radar headlined a composite `healthScore` badge, and
neither the axes nor the baseline they were scored against were measured.

1. Three of the four default axes were browser formulas over the assumption sliders:

       lifeCyclePosition   = clamp(35 + growth * 2.5 - debtRatio * 0.3, 0, 100)
       leveredBetaRiskScore = clamp(100 - max(leveredBeta - 1, 0) * 35, 0, 100)
       agencyRisk          = clamp(100 - governance + esgPenalty, 0, 100)

   `35`, `2.5`, `0.3`, `35` and the implicit unit-equivalence of `governance` and `esgPenalty`
   are all model parameters. Nothing named a life cycle stage was observed.

2. `healthScore` averaged `growth * 2` (a percentage), `marketShare` (a 0-100 input),
   `lifeCyclePosition` and `leveredBetaRiskScore` into one number, badged green above 65.
   The four terms are not in the same unit, so the mean is not in any unit. An
   `includeSubjectiveHealth` toggle switched a further three axes in, changing the score's
   composition and therefore what the badge's threshold meant.

3. The `peer` polygon each axis was scored against was seven hardcoded constants -- 58, 62, 60,
   70, 66, 65, 62 -- the same shape for every ticker. A radar exists to make one comparison,
   and that comparison could not vary with the company being viewed.

The `company_status_radar` series, including the `peer` column, was written to the downloadable
raw dataset, so the constants left the app as data.
Root cause: the same defect class as the two entries above it -- a frontend "derived metrics"
block introducing numeric constants that stand in for modelling assumptions. This is the
remainder of the layer the 2026-08-06 Success Probability removal explicitly did not touch, and
it stood for the same reason: the surface looked reviewed because it was drawn, labelled and
documented like the measured charts beside it.

New in this one: the hardcoded `peer` baseline. A composite score at least discloses that it is
a score. A peer polygon asserts an observed comparison group, and there was none.
Fix: removed rather than rebased on real data, matching the precedent. Deleted
`CompanyStatusGraph.tsx` and its dynamic import, the `companyStatus` detail modal and both
`DetailKey` / `CalculationDetailKey` entries, the `HealthRadarPoint` type, the
`includeSubjectiveHealth` state and its toggle, the `agencyRisk` / `lifeCyclePosition` /
`leveredBetaRiskScore` / `healthScore` fields of the `derived` block, and the
`company_status_radar` series from the raw dataset. The page subtitle no longer advertises
"life cycle" or "project risk".

Nothing replaced it. Operating and leverage quality is read from the metric surfaces that carry
audit quality state, and assumption response from the sensitivity grid, WACC curve and value
driver matrix.
Files changed: `apps/web/app/corporate/page.tsx`,
`apps/web/app/corporate/buildCalculationDetails.ts`,
`apps/web/app/corporate/corporateDerivedViews.ts`,
`apps/web/app/corporate/components/CorporateGraphs.tsx`,
`apps/web/app/corporate/components/CorporateDiagnosticsSection.tsx`,
`apps/web/app/corporate/components/calculationDetailTypes.ts`,
`apps/web/app/corporate/components/graphs/shared.ts`,
`apps/web/app/corporate/components/graphs/CompanyStatusGraph.tsx` (deleted),
`apps/web/app/corporate/components/graphs/HurdleRateDecompositionGraph.tsx`,
`apps/web/tests/e2e/corporate-composite-score.spec.ts` (new),
`apps/web/tests/e2e/refresh-idle-state.spec.ts`,
`apps/web/tests/e2e/corporate-viewport.spec.ts`,
`apps/web/tests/e2e/high-risk-render-regression.spec.ts`,
`apps/web/tests/e2e/responsive-accessibility.spec.ts`,
`docs/architecture/visualization-metrics.md`, `docs/design/MoneyView_Chart_System.md`,
`docs/tabs/corporate-analysis-tab.txt`.
Prevention: a hardcoded comparison baseline is the same defect as a fabricated metric, and is
easier to miss because it hides in a prop rather than a formula. Before drawing any "vs peer",
"vs benchmark" or "vs industry" series, check that the baseline varies with the entity on
screen. If it cannot, the chart has one series, not two, and must not be drawn as a comparison.

Separately, this run found a stale test locator that the removal itself introduced:
`refresh-idle-state.spec.ts` used `/Microsoft: life cycle/i` in three places as its "the
selected company is MSFT" marker, borrowing wording from the page subtitle. Changing the
subtitle failed two tests that assert nothing about life cycles. The marker now matches the
current subtitle. The general point is that a test should locate a surface by what that test is
about; borrowing incidental copy makes an unrelated change look like a regression.

That the two failures were only discovered now is the more useful record: `952d487` was
committed with `tsc` green and the Playwright suite never run, and the entry above it says so in
its own Command line ("none -- No suite was red"). A UI-string change is exactly what a
typecheck cannot see.

## 2026-08-10: Terminal-ROIC remediation did not fix its own motivating defect

Date: 2026-08-10
Command: none -- found by an independent adversarial code review of the
2026-08-10 terminal-ROIC-consistency remediation (`guideline/sop/todo.md`
line 361), before that remediation had shipped any bug fix at all. The full
suite was green (617 passing) throughout.
Failure: two silent-wrong-output defects survived the remediation that was
supposed to fix exactly this class of bug.
1. `run_case`'s consistency guard (`packages/core_finance/segment_valuation.py`)
   only rejected `roic_stable > marginal_roic`. The defect that motivated
   writing the guard in the first place -- `roic_stable=0.12` shipped against a
   marginal return several times higher -- is a *low* terminal ROIC, which a
   one-sided ceiling can never catch. Re-running `roic_stable=0.12` after the
   "fix" still produced a valuation (EV 916.2) with no error.
2. `marginal_roic` weighted `sales_to_capital_late x margin x (1-tau)` by each
   segment's revenue. ROIC is `ΔNOPAT / ΔCapital`, a ratio of aggregates;
   weighting a ratio's combination by anything other than its own denominator
   is wrong in general, and here it silently overstated the firm's marginal
   return by +9.9% (post-prospectus case: 0.408281 shipped vs 0.371484
   correct) and +7.2% (pre-prospectus case). Because the guard in (1) compared
   `roic_stable` against this inflated number, the ceiling itself was also
   wrong by the same margin -- a case could ship with a terminal ROIC the
   *correct* marginal return would have rejected.
Root cause: (1) the guard was written to catch only the failure mode present
in the one example the author had in front of them (a suspiciously low
terminal ROIC being *accepted*), not the general property (terminal ROIC
consistent with the model's own capital-intensity assumptions in either
direction). (2) a revenue-weighted average of a per-unit-of-capital return is
the natural first thing to write and is wrong whenever `sales_to_capital`
varies across segments -- which it always does, since that variation is the
entire reason to model segments separately. No test exercised a case where
`sales_to_capital_late` differed enough across segments for the revenue- vs
capital-weighted answers to diverge visibly.
Fix: guard is now two-sided -- `_TERMINAL_CAPITAL_INTENSITY_TOLERANCE = 0.60`
caps how far `marginal_roic / roic_stable` may exceed 1 before the case is
asserting an unmodelled change in capital intensity, in either direction.
`marginal_roic` now computes `Σ(revenue×margin×(1-τ)) /
Σ(revenue/sales_to_capital_late)` -- capital-weighted, the only weighting
under which `ReinvRate = g/ROIC` is an identity under the perpetuity-growth
assumption the terminal formula already makes. The seed
(`apps/api/services/valuation_seed.py`) moved from a per-case
`roic_stable = (wacc_stable + marginal_roic) / 2` policy to a single shared
literal, `roic_stable = 0.33`, and lowered the pre-prospectus case's
`sales_to_capital_late` (the old values implied a 58% marginal return, not
credible for any business).
Files changed: `packages/core_finance/segment_valuation.py`,
`apps/api/services/valuation_case.py`, `apps/api/services/valuation_seed.py`,
`apps/api/models/schema_parts/valuation.py`, `apps/api/routes/valuation.py`,
`tests/core_finance/test_segment_valuation.py`,
`tests/core_finance/test_segment_valuation_spacex.py`,
`tests/api/test_valuation_routes.py`, `tests/api/test_valuation_seed.py`,
`tests/api/valuation_fixtures.py`.
Prevention: a one-sided guard written against a single failing example should
be checked against its own mirror case before being called a fix -- "what
does this guard NOT catch that has the same shape as the bug, just in the
other direction?" is a five-second question that would have caught (1)
immediately. For (2), any weighted-average combination of a per-unit ratio
across groups of different sizes should be checked against the
weighted-by-denominator form before shipping; the two only agree when every
group has the same denominator-to-numerator-driver ratio, which is precisely
the case that makes modelling the groups separately pointless.

## 2026-08-11: reinvestment_rate plausibility bound screened out legitimate industries

Date: 2026-08-11
Command: none -- caught by a reviewer verifying against the full 92-industry
dataset, which neither the implementer nor the first reviewer had access to
when Task 1 of the industry-relative conservative valuation feature shipped.
Failure: `BENCHMARK_COLUMNS`'s `reinvestment_rate` column
(`packages/core_finance/industry_benchmark.py`) declared a plausibility band
of `[0.0, 1.5]`. `screen_value` silently rejected any industry reinvesting
more than 150% of NOPAT as a "data artifact", with no error raised and no
test covering the boundary. Measured across all 92 industries with a numeric
reinvestment rate, 8 sit above 1.5, not the 3 the column's own comment
claimed -- and 5 of the 8 (Retail (Distributors) 1.522, Chemical (Basic)
1.587, Utility (Water) 1.622, Utility (General) 1.723, Broadcasting 1.888)
are ordinary capital-intensive reinvestment, not artifacts. Only 3 (Steel
2.115, Insurance (General) 3.242, Software (Internet) 14.142) are genuine
artifacts, sitting above a natural gap in the data at 1.888 to 2.115.
Root cause: the bound and its justifying comment were both transcribed
verbatim from the task brief, which asserted "the three above 200%" without
having measured the full dataset -- the number was wrong (8, not 3) and the
threshold was drawn well inside real data (1.5, when the actual gap is at
2.0), so the bound silently discarded good rows for entire capital-intensive
sectors (utilities, broadcasting) rather than catching a smaller and
different set of artifacts than described.
Fix: bound widened to `[0.0, 2.0]`, which sits inside the observed gap
between 1.888 and 2.115. Comment corrected to state 11 negative, 3 genuine
artifacts above the bound (naming them), and p90 = 1.311. A test,
`test_a_capital_intensive_reinvestment_rate_below_two_is_kept`, pins both
sides of the gap so the bound cannot drift back toward 1.5 or past 2.115
without a visible test failure.
Files changed: `packages/core_finance/industry_benchmark.py`,
`tests/core_finance/test_industry_benchmark.py`.
Prevention: a plausibility bound whose justification cites specific counts
("the three above 200%") is a claim about a dataset, not an opinion -- it
needs to be checked against the actual full dataset before being encoded as
a screening rule, not asserted from a brief or sampled from a 10-row
fixture. Ten rows cannot reveal where a natural gap in 92 rows actually
falls; a bound placed to look reasonable on a small sample can still cut
through the middle of a real cluster in the full one.

## 2026-08-15: create_case stored valuation cases the engine could never run

Date: 2026-08-15
Command: `generate_conservative_case("TEST", ...)` on a thin-margin,
capital-heavy company -- 3% operating margin, sales-to-capital 0.6,
`CorporateMetrics(growth=2.0, roic=4.0, wacc=9.0)` -- found by a scratch
probe and later formalized as
`test_generate_refuses_a_case_the_engine_cannot_value`.
Failure: the call returned `case_id 1, reason None` -- a success -- and the
stored row was permanently unrunnable. `run_stored_case(1)` then raised
`ValueError: roic_stable 1.3554% must exceed the magnitude of terminal
growth 4.5600%`, and would raise it identically on every future call,
since nothing about a stored case ever changes. `POST /valuation/cases`
carried the identical defect through the public API: 201 Created,
followed by a permanent 422 on every later `run`. Any caller of
`create_case` could write a case the engine would never value, be told it
succeeded, and have no way to discover the problem short of running it.
Found by a scratch probe, `tests/api/test_zz_probe2.py`, which was never
committed and was deleted once its assertion was formalized as
`test_generate_refuses_a_case_the_engine_cannot_value`.
Root cause: `_validate_runnable` documented itself as rejecting "at write
time what `run_case` would reject at read time", but only checked two
structural combinations (`waypoint_gap_fraction` vs `initial_growth`, and
the 10-year horizon). The economic guards -- including the `roic_stable`
vs terminal-growth check that fired here -- live in the engine's
`terminal_value` and fire only when a case is run. **The docstring
claimed coverage the function did not have, and that overclaim is why the
gap survived review**: a reader checking whether write time mirrored read
time had only the docstring's claim to check against, not the two `if`
statements actually beneath it.
Fix: `_validate_by_engine` builds a trial `CaseSpec`/`SegmentSpec` from
the payload and runs the real engine -- `run_case`'s own code path --
before the transaction opens, translating any `ValueError` it raises into
`case is not valuable: <engine message>`. The guard is not restated in a
second location; the same code that enforces it at run time now enforces
it at write time.
Files changed: `apps/api/services/valuation_case.py`,
`tests/api/test_valuation_case_service.py`,
`tests/api/test_company_baseline.py`.
Prevention: a validator that claims to mirror another layer must execute
that layer, not restate a fragment of it and document the fragment as the
whole. Where restating is unavoidable, the docstring's claim must be
narrowed to what is actually checked, not to what the function is meant
to check. The entry directly below this one is a distinct, later defect:
the fix for this one (`ef1a1d3`) reordered validation so engine code now
runs ahead of a database constraint that used to be the first thing to
catch a missing required field, and that reordering is what regressed.

## 2026-08-15: A missing required case field crashed with TypeError instead of a clean ValueError

Date: 2026-08-15
Command: `python -m pytest -q` (full suite, run as Step 8 of the write-time
runnability gate, `.superpowers/sdd/2026-08-15-write-time-runnability-gate/task-1-brief.md`)
Failure: `tests/api/test_valuation_case_service.py::test_missing_required_case_field_is_rejected_with_the_column_named`
failed with an unhandled `TypeError: '<=' not supported between instances of
'NoneType' and 'int'` instead of the `ValueError` naming `shares_basic` that
the test (and, before Task 1's gate, the real behavior) expects.
Root cause: Task 1 added `_validate_by_engine`, which runs `run_case` against
a trial `CaseSpec`/`SegmentSpec` built straight from the raw, unvalidated
payload -- *before* the `INSERT` that used to be the first place a missing
`NOT NULL` column (e.g. `shares_basic`) was caught, as a clean
`sqlite3.IntegrityError` translated to `ValueError`. Nothing before Task 1
ever built a `CaseSpec`/`SegmentSpec` from unvalidated input, so this path
was never reachable. `CaseSpec.__post_init__` (`packages/core_finance/segment_valuation.py:642`)
assumes required numeric fields are never `None` and does `self.shares_basic
<= 0` with no null check -- pre-existing, and out of scope to change here --
so a payload missing a required field reached that comparison first and
raised `TypeError` instead. `_validate_by_engine` only translates `ValueError`
by design (translating `TypeError` would relabel a programming/infrastructure
fault as an ordinary 422), so the `TypeError` propagated out of `create_case`
uncaught. The FastAPI route (`apps/api/routes/valuation.py:32-35`) also only
catches `ValueError`, and `apps/api/main.py` has no generic exception
handler, so any caller of `create_case` that skips Pydantic validation and
omits a required numeric field would have gotten a raw 500 where it
previously got a 422. The public API route was not affected in practice --
`ValuationCaseInput.shares_basic` is `Field(gt=0)`, non-nullable, so Pydantic
rejects a missing value before `create_case` is ever called -- but any other
direct caller of `create_case` (seed scripts, other services, or this unit
test) was exposed.
Fix: Added `_validate_required_fields` in `apps/api/services/valuation_case.py`,
called at the start of `_validate_by_engine`, before the trial spec is built.
It derives the required-field lists straight from the dataclasses
(`dataclasses.fields(CaseSpec)` / `dataclasses.fields(SegmentSpec)`, any field
with no default) rather than hand-maintaining them, and raises `ValueError`
naming every missing case-level or segment-level field found `None` in the
payload. This restores the original clean-422 behavior at the new, earlier
point without touching `segment_valuation.py` and without widening
`_validate_by_engine`'s `except ValueError` clause. Added
`test_a_segment_missing_a_required_field_is_rejected` to cover the
segment-level half of the check (`SegmentSpec` fields), alongside the
existing `test_missing_required_case_field_is_rejected_with_the_column_named`,
which now passes unmodified.
Files changed: `apps/api/services/valuation_case.py`,
`tests/api/test_valuation_case_service.py`.
Prevention: any future reordering that runs engine code earlier than a
database constraint that used to be the first line of defense should be
checked against every required-but-nullable-in-Python field, not just the
economic guards the reordering was aimed at -- `CaseSpec`/`SegmentSpec`'s
`__post_init__` guards assume presence, not just validity, and were written
assuming the database had already screened for `None`. Deriving the required
list from the dataclass, rather than hand-copying field names, keeps this
check from silently drifting out of sync if either spec gains a new
no-default field later.

## 2026-08-30: The evidence panel counted an unknown volume as zero and could publish a stale price unmarked

Date: 2026-08-30
Command: Manual review of commit `69d3808` (`apps/api/services/valuation_verdict.py`), followed by
`python -m pytest tests/api/test_valuation_verdict.py -v` and `python -m pytest -q`.
Failure: Two silent-honesty defects in the over/undervaluation evidence panel, whose stated job is
naming the provenance of every number it shows.

1. `volumes = [int(b["volume"] or 0) for b in bars]` substituted `0` for a NULL volume. Reproduced with
   two NULL volumes in a four-bar series: `{'value': 2.0, 'source': 'own bars: 2d/4d'}` -- the NULLs,
   coerced to `0`, dragged the baseline mean down and inflated the ratio, in a fallback window that gave
   no hint anything was substituted.
2. `price = closes[-1]` assumed the last entry of `closes` (NULL closes already dropped by
   `_closes_from_bars`) was the newest bar's price. When the newest bar's close is NULL, `closes[-1]` is
   an OLDER bar's close, and `dcf_gap` published it as "price" with no marker. Reproduced with the
   newest bar's close set to `None`: drawdown read `0.0` measured against `150.0`, an older bar's price,
   with nothing in the row saying so.

Root cause: both trace to `load_price_bars` (`apps/api/services/acquisition/store.py:174-177`), which
documents that `close`/`volume` pass through exactly as stored, including NULL, and that the caller must
handle it. `_closes_from_bars` handled NULL close correctly (drop it) but `volumes` used `or 0`
(truthiness, not a `None` check) instead of the same drop. And dropping NULL closes shortens `closes`
relative to `bars`, so `closes[-1]` silently stopped meaning "the newest bar's close" the moment any
recent close was NULL -- nothing re-established what index the last surviving close actually came from.
Fix: Added `_volumes_from_bars`, mirroring `_closes_from_bars`: drops `None` volumes via `is not None`,
keeping a genuinely stored `0` (which `or 0` would also keep, but only by chance -- `is not None` keeps
it by construction). Added `_dated_closes_from_bars`, returning `(date, close)` pairs with NULLs
dropped, so the latest surviving close can be reported alongside the date it actually came from rather
than assumed to be the newest bar's. Kept using the latest non-NULL close for both `drawdown` and
`dcf_gap` (refusing outright would be too aggressive -- it genuinely is the last known price) but now
carry that date into `dcf_gap`'s `comparison` string unconditionally, and into `drawdown`'s `comparison`
whenever the close actually used is not the newest bar's.
Files changed: `apps/api/services/valuation_verdict.py`, `tests/api/test_valuation_verdict.py` (three
new tests: NULL volume dropped not zeroed, a genuine `0` volume kept, and a stale price's date visible
in both `dcf_gap` and `drawdown`).
Prevention: whenever a per-row value is read by a fixed index (`closes[-1]`) after an earlier filtering
step has already dropped entries from that same sequence, check whether the index still means what the
reader assumes -- filtering changes length, and a positional assumption that held before the filter can
silently point at the wrong element after it. This is the same defect class `69d3808` already fixed for
this module (a number wearing an attribution it has not earned); it was not exhaustively swept for at
the time.

## 2026-08-30: The evidence panel's own fix round left one refusal misnamed and introduced two more

Date: 2026-08-30
Command: Manual review of `apps/api/services/valuation_verdict.py` at HEAD `96dfbe9`, followed by
`python -m pytest tests/api/test_valuation_verdict.py -v` and `python -m pytest -q`.
Failure: The round that fixed the two defects above (this file's prior 2026-08-30 entry) left one
instance of the same class standing and introduced two more, all in the volume/drawdown refusal rows.

1. `volume`'s `ratio is None` branch at `:177-178` emitted `reason=f"insufficient_history: {len(bars)}
   bars"`. Given `fallback_baseline = len(volumes)`, `volume_ratio`'s length guard
   (`len(volumes) < max(recent, baseline)`) can never trip on that call -- the only way it still
   returns `None` is `baseline_mean <= 0`, i.e. every stored volume in the window is genuinely zero.
   Reproduced with 5 bars, every volume a real `0`: `{'source': 'own bars: 2/5 bars', 'reason':
   'insufficient_history: 5 bars'}` -- the source shows a window that fit inside the data, the reason
   blames the amount of data. Reachable in production: an all-zero volume column is normal for
   illiquid/OTC tickers and for providers that write `0` for unknown.
2. The same line's count was also inconsistent with its siblings: `:130`/`:204` report
   `{usable} of {total} bars usable` (the NULL-filtered count over the raw count); `:178` reported the
   raw bar count alone, so two rows on the same panel used different denominators under an identical
   reason prefix.
3. The empty-panel case (`bars == []`) was folded into the same `no_volume` branch as "bars arrived,
   none carried volume," producing `{'source': 'own bars: 0 of 0 bars have volume', 'reason':
   'no_volume: 0 of 0 bars have volume'}` -- asserting the bars have no volume when no bars arrived at
   all, with `source` reduced to the reason string plus a prefix (zero real provenance). Before the
   prior round this case correctly said `insufficient_history: 0 bars`; the prior round's `no_volume`
   fix regressed it while fixing its neighbour (bars present, no usable volume).

Root cause: (1)/(2) -- the fallback call's `fallback_baseline` was never checked against what
`volume_ratio`'s own length guard could still reject; the `insufficient_history` reason and its raw
`len(bars)` count were inherited from an earlier version of the branch without re-deriving what could
actually still reach it after the fallback logic was added. (3) -- collapsing "no bars" and "bars with
no volume" into one `if not volumes:` branch treated both as the same absence, when the reader needs
to know which one is true (a data-collection gap vs. a genuinely volume-less instrument).
Fix: (1) new reason code `zero_volume: baseline mean 0 over {fallback_baseline} bars`, replacing the
`insufficient_history` reuse at that line -- nothing else reaches that branch, so no other case is
affected. (2) resolved as a side effect of (1): the only remaining `insufficient_history` usages
(`:130`, `:204`, and the empty-panel case below) already share the `{usable} of {total} bars usable`
shape. (3) split `if not volumes:` on `if not bars:`; the empty case now gets
`source="own bars: none stored"`, `reason="insufficient_history: 0 of 0 bars usable"`, and the
non-empty "no usable volume" case is unchanged.
Files changed: `apps/api/services/valuation_verdict.py`, `tests/api/test_valuation_verdict.py` (two new
tests -- zero-baseline volume names its real cause, empty panel names "no bars stored" -- plus a new
`comparison` assertion on the existing stale-price test closing the untested half of that contract, two
stale comments corrected, and two weak assertions pinned to exact strings).
Prevention: when a refusal branch's reachability changes because an upstream call gained a fallback
(or any other new path into it), re-derive from the callee's own guard conditions what can actually
still land there -- do not assume an old reason string is still describing the live path. And when a
`not X` guard covers two distinguishable absences (e.g. "no rows" vs. "rows with no usable value in
this column"), branch on the more specific condition explicitly rather than letting one message stand
in for both -- a reader cannot tell "nothing arrived" from "something arrived but was empty" unless the
row says which.

## 2026-09-03: A new property test asserted on the label, not the number it described

Date: 2026-09-03
Command: `python -m pytest tests/api/test_valuation_verdict.py -q` under six hand-applied
mutations of `apps/api/services/valuation_verdict.py`, then
`python -m pytest tests/api/test_valuation_verdict_mutations.py -q`.
Failure: Track B added `test_the_peer_clause_names_the_same_basis_as_the_subject_clause` to
guarantee "whatever basis the subject's `source` names, the peer clause must name the same one",
and it was reported as verified on the strength of a passing run. It asserts only on the `source`
STRING. Reintroducing the ND-12 defect -- sampling peers over their own trailing 252 positions
instead of the subject's date range -- moves the published figure from `peer mean 0.0%` to
`peer mean -90.0%` while leaving `source` byte-identical, still reading
`peers: 3 of 3 within 2024-04-06..2025-08-21`. The test passes. The todo entry that specified it
claimed that defect "would have failed such a test"; as implemented, it would not.

**No product exposure.** The pre-existing case test
`test_every_close_in_the_peer_mean_lies_inside_the_subject_window` does catch that mutation
(verified by running the HEAD version of the test file against it). This was a defect in a new
test's coverage claim, not a hole in the panel's behaviour. It is recorded because the coverage
claim was believed and stated, and because the reasoning error is the reusable part.
Root cause: the test was written to the WORDING of the Track B specification, which describes a
relation between two strings ("the peer clause must name the same one"), rather than to the
guarantee that wording exists to protect -- that the computed mean actually uses the period its
label names. A label and the computation it describes are produced by separate code paths
(`valuation_verdict.py:241-261`), so an assertion on one says nothing about the other. This is the
same defect class the module's ten review rounds were about -- an attribution not earned --
reproduced inside the test written to prevent it. Compounded by the reporting error: the test was
called verified after being observed passing, which is not evidence about a test.
Fix: added `test_the_peer_mean_is_computed_over_the_period_its_clause_names`, which asserts a
computed consequence by control vs. treatment -- a peer spike planted outside the subject's window
(on both sides, across seven subject shapes) must not move the published peer mean. The string test
is kept as the labelling layer, with a docstring noting the pair is deliberate. Added
`tests/api/test_valuation_verdict_mutations.py`, a checked-in harness that rebuilds
`valuation_verdict.py` in memory with each of six known defects reintroduced and asserts the
property test that should catch it does fail -- so this evidence is re-derived on every run instead
of resting on someone having checked once. Mutation is in-memory only; the source file is never
written to, so an interrupted run cannot leave a broken module in the tree.
Files changed: `tests/api/test_valuation_verdict.py`, `tests/api/test_valuation_verdict_mutations.py`
(new), `guideline/sop/test-verification.md` (new), `.claude/CLAUDE.md` (new section 8),
`docs/INDEX.md`. `apps/api/services/valuation_verdict.py` was NOT changed -- the panel's behaviour
was already correct.
Prevention: never report a test as verified because it passed; name the broken implementation it was
shown to reject, or call it unverified (`.claude/CLAUDE.md` section 8,
`guideline/sop/test-verification.md`). Specifically, when a test asserts on a label, a source, or any
other attribution, check whether the label and the thing it describes are produced by separate code
paths -- if they are, the string assertion cannot detect them diverging, and a second test must
assert a computed consequence: construct an input the named basis cannot reach and assert the
published figure does not move. Note also that a `-k` filter narrow enough to run only the new tests
will hide the fact that an older test already covers the case, which is how the severity here was
initially overstated; confirm against the full module before concluding a defect is undefended.

## 2026-09-03: Test fixture data was written into the real database, impersonating a real ticker AND a Damodaran vintage

Date: 2026-09-03
Command: an ad-hoc `python` script during Track A2 that imported helpers from
`tests/api/test_valuation_verdict.py` and called them directly, outside pytest.
Failure: silent, and nothing raised. 260 synthetic price bars and one
`corporate_quote_facts` row for **TGT** were written into
`data/processed/moneyview.db`. The bars were byte-for-byte the module's `_SERIES`
fixture -- first date 2024-01-01, close climbing 100 -> 200 then falling to 150,
every volume exactly 100 -- and the facts row carried the fixture's giveaway
`fetched_at='2026-01-01'` with `industry='Semiconductors'`. TGT is a REAL ticker
(Target Corp), so the fabricated series did not read as obviously synthetic: it
sat in the production store impersonating a real company, and any signal computed
for TGT would have been derived from invented prices while reporting ordinary
provenance. Discovered only by accident, when a row count taken for an unrelated
purpose (acquiring AAPL quote facts) showed `stocks` at 68,271 against the 68,011
measured earlier in the same session, and `corporate_quote_facts` at 1 where it
had been 0.

The blast radius was WIDER than that first count revealed, and the second half was
worse. `industry_benchmark` also held 10 fabricated rows -- the whole
`tests/fixtures/industry_rows_technology.py` basket under vintage `2026-01-01`,
with `_store_a_pe_vintage()`'s three round trailing PEs of 20.0 / 25.0 / 30.0.
Because a vintage was now present, the trailing-PE row STOPPED REFUSING and began
publishing: `build_verdict("AAPL")` returned a PE of 44.70 against `sector avg
25.0`, sourced as `Damodaran 2026-01-01 top-5-by-ROC sector basket (3 of 5
industries)`. Every part of that sentence was true of the stored data and false of
the world. Track A1 -- "load a Damodaran vintage" -- appeared satisfied when no
vintage had ever been obtained. This was caught only because the figures were
inspected against expectations (A1 was known to be outstanding, so a computing PE
row was impossible) rather than by any check in the code.
Root cause: every database guard in `tests/conftest.py` is a pytest FIXTURE.
`_isolated_db` monkeypatches `db_service._DB_PATH` to a tmp file; `_forbid_the_real_database`
patches `sqlite3.connect` to refuse the real path. Both are inert the moment a test
module is imported and its helpers are called from a plain script -- the fixtures
never run, `_DB_PATH` keeps its production default, and `_facts`/`_bars` write
wherever it points. The protection lived with the RUNNER rather than with the code
that performs the write, so it evaporated the moment the code was invoked any other
way. `_forbid_the_real_database`'s own docstring anticipates the general shape of
this ("a test that builds its own connection string bypasses it entirely") without
covering the case where the guard itself is simply not active.
Fix: deleted the contaminated rows -- 260 from `stocks`, 1 from
`corporate_quote_facts`, and 10 from `industry_benchmark` (the whole `2026-01-01`
vintage, confirmed identical to `TECHNOLOGY_ROWS` by name set and `after_tax_roc`
to 1e-12 before deleting). Verified `stocks` back to its original 68,011, only
AAPL remaining in `corporate_quote_facts`, `industry_benchmark` back to empty, and
AAPL's 1,701 statement rows and 1,310 bars intact. `build_verdict("AAPL")` now
correctly refuses trailing_pe with `no_vintage` again. Installed the refusal at IMPORT TIME in `tests/__init__.py`: it
wraps `sqlite3.connect` and raises on any attempt to open the real database,
armed by the same act that makes the helpers reachable rather than by the runner.
Importing any `tests.*` module executes that file, so all 20 test modules
containing INSERT are covered without each having to remember. It is not
bypassable -- no test has a legitimate reason to write to the developer's real
database, so an opt-out would only ever be reached for the wrong reason. Under
pytest nothing changes: `_isolated_db` already redirects `_DB_PATH`, so the
guarded path is never requested.

A first attempt put a plain `refuse_the_real_database()` function in
`conftest.py` and called it from `_facts`/`_bars`. That was discarded before
committing, for two reasons. It covered ONE module out of twenty. And it was
strictly weaker: it inspects `db_service._DB_PATH`, so it is blind to a test that
builds its own connection string -- the exact bypass `_forbid_the_real_database`'s
docstring already warns about. The connect-level guard catches both, verified
against a module doing each.

Verified by reproducing the incident exactly -- importing `_facts` and `_bars`
outside pytest and calling them now raises instead of writing -- and by confirming
the guard stays silent for tmp files and `:memory:`. Note the first verification
run was misleading: the explicit helper ran first and masked the new guard, so the
guard had to be re-tested through a module that did not call it.
Files changed: `tests/__init__.py`.
Prevention: a guard implemented as a pytest fixture protects the test RUN, not the
code, and evaporates the moment the code is invoked any other way. Arm safety at
import, not at fixture setup, so it cannot be skipped by the caller choosing a
different entry point -- and prefer the CHOKEPOINT the operation must pass through
(`sqlite3.connect`) over the configuration it usually reads (`_DB_PATH`), because
only the former catches the caller who bypasses that configuration. Second
lesson: synthetic fixtures that borrow REAL ticker
symbols (TGT, and this module's P1/P2/P3 do not) are undetectable once loose in a
production store -- a fixture ticker should be one that cannot be mistaken for a
listed company. Third, and most important: contamination that makes a refusing row
START COMPUTING is far more dangerous than contamination that breaks something. A
broken row gets investigated; a row that begins publishing a plausible number with
an authoritative-looking source reads as PROGRESS, and here it briefly looked like
Track A1 had been completed. When a long-refusing signal suddenly resolves, verify
the input arrived the way you think it did before believing the output.

## 2026-09-03: A decision could store fabricated figures under a captured attribution

Date: 2026-09-03
Command: `record_decision(ticker="ZZTOP", action="buy", memo="cheap on FCF")` through
the real default loader, against a fresh database holding one price bar for ZZTOP and
nothing else -- no statements, no `corporate_metrics` row, no equity bridge.
Failure: the row came back with `dcf_value=5135.11` (an ENTERPRISE VALUE, not a
per-share figure), `dcf_implied_return=0.0` (fabricated: `f(price, price) - 1`),
`roic=23.0` and `wacc=11.25` (both derived from `sum(ord(char) for char in
f"{ticker}:{sector}")`, a hash of the ticker's letters), all stamped
`figures_source='corporate_comparison._dcf_snapshot'` with
`figures_unavailable_reason` left NULL -- i.e. presented as captured model output.
`investment_decision`'s entire reason for existing is that a number and its
attribution cannot diverge; this was the DEFAULT path, not an edge case reached only
through misuse.
Root cause: `_default_figures_loader` (`apps/api/services/investment_decision.py`)
called `_dcf_snapshot` and `corporate_metrics_service.metrics_for_ticker`, but
discarded the two discriminators each already computes for exactly this situation.
`_dcf_snapshot` (`corporate_comparison.py`) returns `estimated_value =
enterprise_value` when the equity bridge does not resolve, and feeds `current_price`
in as `intrinsic_value`, so `dcf_implied_return` is 0.0 by construction -- both
survive in the comparison table only because `bridge_quality` travels beside the row
and every consumer is required to check it (see the 2026-08-05 entry below, which
this defect re-breaks in a new consumer). `_default_figures_loader` never read
`bridge_quality` and `investment_decision` has no column for it.
Separately, `corporate_metrics_service.load_fallback_metrics` already returns
`(metrics, is_real)`, and `metrics_for_ticker` (the function `_default_figures_loader`
called) discarded `is_real` at its own `fallback, _ = load_fallback_metrics(ticker)`.
Fix: added `metrics_for_ticker_with_provenance`, which returns `(metrics, is_real)`
without changing `metrics_for_ticker`'s existing behavior (it now delegates to the new
function and discards the flag itself, at the one call site that is allowed to).
`_default_figures_loader` now calls the provenance-carrying function and also reads
`_dcf_snapshot`'s `bridge_quality`, returning both alongside the figures.
`record_decision` gates on them the same way it already gated on a non-positive
price (`investment_decision.py`, the pre-existing guard this mirrors): if
`bridge_quality == "missing"` or `metrics_are_real is False`, the decision is stored
as unavailable, with a reason string naming which discriminator fired, instead of
with fabricated figures. Verified by reproducing the incident as a permanent test
(`test_a_ticker_with_no_statements_no_metrics_row_and_no_bridge_is_refused_not_fabricated`
in `tests/api/test_investment_decision_record.py`), then removing the new guard and
re-running it: it failed by reproducing the exact fabricated row from the incident
(`dcf_value=5135.11`, `dcf_implied_return=0.0`), confirming the guard is load-bearing
before restoring it.
Files changed: `apps/api/services/corporate_metrics_service.py`,
`apps/api/services/investment_decision.py`,
`tests/api/test_investment_decision_record.py`.
Prevention: this is the THIRD time this exact defect class has appeared -- 2026-08-03
(Net Debt silently misread), 2026-08-05 (enterprise value presented as a per-share
figure), and here. All three share one shape: a function computes a quality/realness
discriminator beside a headline figure, and a new caller reaches for the figure
without also reaching for its discriminator, because nothing forces the two to travel
together. Grep test for any future consumer of `_dcf_snapshot` or
`corporate_metrics_service`: if it reads `estimated_value`/`dcf_value`,
`dcf_implied_return`, `roic`, or `wacc` without also reading `bridge_quality` (or,
for the metrics path, checking realness), that is this defect recurring a fourth
time. A permanent record is the least forgiving place for this to recur, because
unlike a snapshot it never expires and is never silently superseded by the next
refresh -- a fabricated row, once written, is what "what the user believed" says
forever.

Amendment, same day, found while verifying the fix rather than the code: the guard
above is TWO guards in an `elif` chain (`bridge_quality == "missing"` and
`metrics_are_real is False`), and the ZZTOP reproduction trips BOTH at once. So the
mutation recorded above -- "removing the new guard" -- removed them together, and
each one alone could be deleted with the whole suite still green. The report read as
though the fix were pinned; it pinned only the pair. Two further mutations showed the
same for the wiring: hardcoding `bridge_quality="ok"` or `metrics_are_real=True`
inside `_default_figures_loader` also left 949 tests passing, because whichever
discriminator was still wired went on refusing ZZTOP. And
`metrics_for_ticker_with_provenance`, the function the whole fix rests on, had no
direct test at all -- its flag could be inverted unnoticed.

Closed with four tests in `tests/api/test_investment_decision_record.py`:
`test_a_missing_equity_bridge_is_refused_even_when_the_metrics_are_real` and
`test_hashed_metrics_are_refused_even_when_the_bridge_resolves` (injected loaders
setting exactly one discriminator, so each guard has a case only it can catch),
`test_the_default_loader_reports_both_discriminators_from_their_real_sources`
(asserted on the loader's returned dict, not through the guard chain, so each key is
pinned to its own source), and
`test_metrics_provenance_separates_a_stored_row_from_a_hashed_fallback`. All six
mutations above are now caught, each by a named test.

The generalisable lesson is about the mutation itself, not this fix: when a guard is
a chain of conditions, a single scenario that trips several of them proves only that
AT LEAST ONE is wired. Mutate the conditions ONE AT A TIME, and require a scenario
that isolates each -- otherwise the strongest-sounding evidence a test suite can
offer ("I broke it and the test failed") certifies less than it appears to, and does
so in exactly the confident register that stops further checking. That failure mode
is this repo's own subject matter: a verification wearing an attribution it has not
earned.

## 2026-09-04: 880 snapshot rows were deleted from the real database, unnoticed for a day

Date: 2026-09-04 (loss occurred 2026-09-03)
Command: discovered while running `python scripts/reset_snapshots.py`. The script
was expected to clear 139 + 0 + 880 rows, the figures Spec section 7 measured on
2026-09-03. It reported 139 + 0 + **0**: the live `_v3` table was already empty.
Failure: `corporate_comparison_snapshots_v3` lost all 880 rows across 20 snapshot
versions. Point-in-time snapshot rows cannot be regenerated -- their inputs have
moved -- so this is unrecoverable except from a backup. No error was raised, no
log recorded it, and nothing noticed for a day. The plan, the spec and
`guideline/sop/todo.md` all went on quoting 880 as a live figure after it was
false.

Root cause: **bounded by evidence, not fully named.** What is established:

- The 2026-09-03 14:04:33 backup (`moneyview.db.pre-tgt-cleanup-backup`) holds all
  880 rows across 20 versions; the database's next and last write before
  2026-09-04 was at 17:26:25, and by then `_v3` was empty. The loss happened
  inside that 3h22m window.
- `corporate_comparison_snapshots` (v1) kept all 139 of its rows. Whatever ran
  targeted `_v3` specifically.
- **Retention is excluded.** `SNAPSHOT_RETENTION_DAYS = 365` gives a cutoff of
  2025-09-03; the oldest of the 880 rows is dated 2026-04-12. Zero rows were
  eligible. Verified by running the predicate against the backup.
- **The orphan delete is excluded.** `corporate_comparison.py` deletes only
  `WHERE snapshot_version = ? AND ticker NOT IN (...)` -- one version, and only
  tickers absent from the live response. It cannot remove 20 versions.
- **`scripts/reset_snapshots.py`'s operator entry point is excluded.** It copies
  the database to `moneyview.db.pre-snapshot-reset` before deleting; that file's
  NTFS creation time is 2026-09-04 16:16:20. It had never existed before, so
  `__main__` had never run.
- **pytest is excluded.** `tests/conftest.py`'s autouse `_isolated_db` repoints
  `db._DB_PATH` at `tmp_path`, and `tests/__init__.py` refuses the real database at
  connect time (in place since 14:54:35 that day, before the window closed).
  `tests/scripts/__init__.py` exists, so the guard is reachable for the reset
  test specifically.

What remains consistent with every observation: an ad-hoc call to
`reset_snapshots(conn)` against a real `get_db()` connection -- outside pytest and
outside `__main__` -- during Task 1 of the snapshot-overhaul backend plan, whose
report documents mutating that module to exactly
`SNAPSHOT_TABLES = ("corporate_comparison_snapshots_v3",)` and later restoring it.
That mutation's blast radius is precisely the observed damage: v3 emptied, v1
untouched. `reset_snapshots(conn)` takes any connection and writes no backup.
**The exact command is not established** -- no shell history from that session
survives -- and this entry does not claim it as fact.

Fix: none to the data. Recovered nothing, because nothing needed recovering by the
time it was found: the snapshots were being cleared deliberately anyway (Track E7),
and `moneyview.db.pre-tgt-cleanup-backup` still holds the 880 rows if they are ever
wanted. The reset was completed on 2026-09-04 and `investment_decision` was created
by `init_db()` in the same pass.

Files changed: none. This entry is the deliverable.

Prevention: two distinct lessons.

1. **The real-database guard protects pytest and nothing else.** It is installed by
   `tests/__init__.py`, so it exists only for code that imports the test package.
   A REPL, an ad-hoc `python -c`, or any script importing `apps.api.services.db`
   directly reaches `data/processed/moneyview.db` with no guard, no confirmation
   and no backup. `reset_snapshots(conn)` in particular is a delete-everything
   function that accepts any connection and is safe only by convention -- the
   backup lives in `__main__`, which is exactly the path a careless caller skips.
   Moving the backup (or a refuse-unless-explicitly-confirmed check) into the
   function itself would close this.

2. **Mutating a destructive function leaves a loaded gun in the working tree.**
   This repo's own discipline (CLAUDE.md section 8) requires breaking the source to
   prove a test catches it. When the source under mutation *deletes data*, the
   mutated state is not merely a failing test -- for as long as it is applied, every
   invocation of that code path does different damage than the author expects. The
   mutation here narrowed a three-table delete to a one-table delete, and the one
   table it kept is the live one. Mutate destructive code paths against a copy of
   the database, or make the function inert without an explicit opt-in, so that the
   window between "mutate" and "restore" cannot cost anything.

Hardened 2026-09-04, after this entry was first written. `reset_snapshots(conn)`
now refuses a connection attached to `data/processed/moneyview.db` unless the
caller passes `allow_real_database=True`, and backs the database up itself when
they do -- so the safety no longer depends on which entry point a caller happened
to use. The backup runs through SQLite's backup API on its own read-only
connection (a file copy can miss committed pages still in the WAL sidecar, and
backing up through a connection holding an open write transaction deadlocks), and
its filename carries a microsecond timestamp so no run can clobber an earlier
copy. Five mutations verify it, each caught by a named test: guard removed;
opt-in ignored; backup skipped; fixed backup name; and `_REAL_DB` repointed at a
harmless path -- that last one because every other test monkeypatches the
constant, so without it the guard could be aimed anywhere and the suite would
stay green.

The generalisable point: a figure measured once and then quoted repeatedly becomes
an assertion about the present. Spec section 7, the backend plan and the todo all
carried "880 rows" for a day after it was zero, and each restatement made it look
better attested. Re-measure before an irreversible step, not because the number was
wrong when taken, but because nothing tells you when it stops being true.
