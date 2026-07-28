# 07 — Testing Strategy

Test files land in `tests/api/`, alongside the existing
`test_dev_monitor_foundation.py`. Frontend tests use the configured Playwright setup
(`apps/web/playwright.config.ts`).

| File | Covers | New/Modified |
| --- | --- | --- |
| `tests/api/test_perf_analysis.py` | pure analysis functions | **new** |
| `tests/api/test_perf_capture.py` | span context, pairing, sink behavior | **new** |
| `tests/api/test_perf_routes.py` | endpoint gating, filtering, passthrough | **new** |
| `tests/api/test_dev_monitor_foundation.py` | existing behavior still holds | modified |
| `tests/api/test_benchmark_scripts.py` | benchmark runner importable/runnable | modified |
| `apps/web/tests/perf-dashboard.spec.ts` | dashboard states | **new** |

---

## 7.1 Analysis tests — where most tests live

Pure functions over hand-built event lists. **No server, no sink, no database, no
clock.** A helper builds events:

```python
def ev(op, scope, ms=None, *, id=None, parent=None, ticker=None,
       status="success", closes=None, ts=None, **meta) -> PerformanceEvent
```

Table-driven cases:

| # | Case | Asserts |
| --- | --- | --- |
| 1 | 3-level nested tree | `self_ms` = own minus direct children at every level |
| 2 | Scope breakdown of that tree | uses `self_ms`; percentages ≤ 100% |
| 3 | Conservation | `sum(scope.self_ms) + unattributed_ms == root.total_ms ± ε` |
| 4 | Overlapping siblings (sum > root) | `overlap_detected: true`, `unattributed_ms == 0` |
| 5 | Rounding-only negative (< ε) | `overlap_detected: false`, `unattributed_ms == 0` |
| 6 | Child with missing parent | attached to synthetic root, `orphaned: true`, not dropped |
| 7 | Request with events removed mid-tree | `partial: true` |
| 8 | Child bounds outside parent | clamped, `clock_skew: true`, width ≥ 0 |
| 9 | Children emitted out of order | `children[]` ordered by reconstructed start |
| 10 | Two children with identical start | tie broken by input order |
| 11 | **Pairing: `perf_timer` convention** | start + terminal share `operation`; `closes_span_id` resolves; one span produced |
| 12 | **Pairing: middleware convention** | `api.request_start` + `api.request_complete` (different names); `closes_span_id` resolves; one span produced |
| 13 | Unpaired start | span with `total_ms = None`, `partial: true`, excluded from timing |
| 14 | CV = 0.14 / 0.15 / 0.5 / 0.51 | `uniform` / `mixed` / `mixed` / `skewed` |
| 15 | 0 tickers, 1 ticker, mean 0 | `cv == 0.0`, `distribution == "uniform"` |
| 16 | Cache rows | `hit_rate`, `avg_miss_cost_ms`, `estimated_time_saved_ms = hits × avg_miss_cost_ms` |
| 17 | Waterfall over 2,000 spans | `truncated: true`; `CollapsedNode.collapsed_count` and summed `total_ms` correct; deepest collapsed first |
| 18 | Empty event list | all six functions return valid empty DTOs, no exception |
| 19 | Metadata accessors on absent/wrong-typed keys | return `None`, never raise |

**Purity guard (test 20):** assert `perf_analysis.py` imports no sink,
no `os`, and no `datetime.now` — a static check over the module's AST. If purity
breaks, every test above stops being trustworthy.

Cases 11 and 12 are the ones that justify `closes_span_id` (§03.3). Without both,
the fix is unverified for one of the two conventions.

---

## 7.2 Capture tests — behavior, not timing

**Timing assertions do not belong in the unit suite.** They are flaky under load and
would produce failures unrelated to correctness. Overhead percentages are measured
by the baseline runner (§08.3) and reported, never asserted here.

What is asserted instead:

| # | Case | Method |
| --- | --- | --- |
| 1 | Nested `perf_timer` sets `parent_id` | inner span's `parent_id == outer.id` |
| 2 | Explicit `parent_id=` overrides contextvar | existing callers unaffected |
| 3 | Contextvar reset on exception | span stack unwinds; sibling after a raising span has correct parent |
| 4 | **N events → one file-open** | patch `Path.open`, assert call count == 1 for N=200 |
| 5 | `flush()` empties the queue | pending count 0 after; safe to call twice |
| 6 | Shutdown flushes | shutdown handler drains the queue |
| 7 | Synchronous mode bypasses the thread | events on disk immediately after `emit()` |
| 8 | **Write failure → self-disable** | patched `open` raising `OSError`; assert logged once, persistence disabled, `emit()` still returns, ring buffer still serves |
| 9 | Failure logs exactly once | 100 subsequent emits produce no further log records |
| 10 | Original exception propagates | `perf_timer` around a raising body re-raises the *application* exception type |
| 11 | `closes_span_id` on `perf_timer` terminal events | success and error paths |
| 12 | `closes_span_id` on middleware terminal events | complete and error paths |
| 13 | Event limit honors env var | `MONEYVIEW_DEV_MONITOR_EVENT_LIMIT=500` → deque maxlen 500 |
| 14 | `bytes` is `None` for `StreamingResponse` | both stream endpoints |
| 15 | `bytes` is an integer for JSON responses | any normal route |

### 7.2.1 The threadpool regression test

Called out separately because the failure is silent:

```python
def test_span_parent_survives_threadpool():
    """FastAPI runs sync handlers in a threadpool; contextvars must propagate.

    Failure mode is silent: spans lose their parent and appear as orphans,
    which reads as missing data rather than as a bug.
    """
```

A **sync** (`def`, not `async def`) route handler that opens a `perf_timer` inside
the request, asserting the emitted span's `parent_id` equals the request span's id.

---

## 7.3 Route tests

| # | Case | Asserts |
| --- | --- | --- |
| 1 | All five endpoints, flag off | 404 |
| 2 | All five endpoints, empty buffer | 200 + empty DTO |
| 3 | `waterfall/{unknown}` | 404 |
| 4 | `limit=0`, `limit=201`, `window=0`, `window=3601` | 422 |
| 5 | Each handler calls its analysis function **once** | patch the function, assert call count |
| 6 | Handler passes **pre-filtered** events | patched function receives only matching `request_id` |
| 7 | `_filter_events` location | lives in the route module, not `perf_analysis.py` |
| 8 | Existing endpoints unchanged | `/recent`, `/slow`, `/errors`, `/summary` behavior identical |
| 9 | **Filter order** (§05.2.1) | `request_id` → `route` → `window`; a request older than `window` is excluded even when its `request_id` is given |
| 10 | `waterfall/{request_id}` ignores age | an old request still resolves; endpoint accepts no `window` |
| 11 | `RequestIndex.buffer_used / buffer_limit` | populated from `len(events)` and `get_dev_monitor_event_limit()`; not hard-coded |

---

## 7.4 Frontend tests

`apps/web/tests/perf-dashboard.spec.ts`:

| # | Case | Asserts |
| --- | --- | --- |
| 1 | API returns 404 | `EmptyState` with the enable instruction; **not** `ErrorState` |
| 2 | API returns empty DTOs | `EmptyState` "no requests recorded yet" |
| 3 | Fixture DTOs | all six panels render |
| 4 | Fixture with `CollapsedNode` | renders "⋯ N spans collapsed", not an empty node |
| 5 | Per-stock panel order | distribution + percentiles + histogram appear before the table; table collapsed |
| 6 | No self-instrumentation | dashboard fetches emit no `POST /performance/client-event` |
| 7 | `buffer_used >= buffer_limit` fixture | header shows "buffer full — older events evicted" badge |

### 7.4.1 Diagnostic-state fixtures — one per state

§06.7 defines five diagnostic states and requires each to render as a **non-error**
indicator. Testing only `partial` would leave four untested, and the likely
regression is precisely that one of them gets styled as an error or silently
dropped — which is what the diagnostic/error distinction exists to prevent.

One fixture per state, each asserting the indicator is present **and** carries
non-error styling:

| # | Fixture | Renders | Asserts |
| --- | --- | --- | --- |
| a | `RequestWaterfall.partial: true` | `StatusBadge` variant `stale` on the affected panel | visible; **not** `ErrorState`, not error variant |
| b | `RequestWaterfall.truncated: true` | inline "truncated at 2,000 spans" note | visible; waterfall still renders its retained spans |
| c | `SpanNode.clock_skew: true` on one child | marker on that bar + tooltip | marker present; **bar width ≥ 0** (never negative) |
| d | `SpanNode.orphaned: true` | span grouped under "orphaned spans" with tooltip | grouped, not dropped from the tree |
| e | `ScopeBreakdown.overlap_detected: true` | note beside unattributed: "spans overlapped (concurrent execution)" | visible; `unattributed_ms` renders as `0`, not negative |

Fixtures c and e are the two that would fail loudly in production if the clamping
rules in §04.3 and §04.7 were implemented wrong — a negative-width bar and a
negative percentage respectively — so they assert the rendered *value*, not just the
presence of a badge.

---

## 7.5 Regression protection for existing behavior

`test_dev_monitor_foundation.py` is extended, not replaced. The buffered writer and
the raised event limit change observable behavior of the existing sink, so:

- Existing assertions about JSONL content must now `flush()` first.
- Existing assertions about `recent()` limits must account for the configurable
  maximum.

Both are mechanical, but skipping them would leave the existing suite passing for
the wrong reason.

---

## 7.6 What is deliberately not tested

| Not tested | Why |
| --- | --- |
| Absolute timing / overhead % | flaky in a unit suite; measured by the runner instead (§08.3) |
| Thread scheduling order of the flusher | implementation detail; behavior is asserted via `flush()` |
| Exact JSONL byte layout | persistence format is an internal detail of the sink (§02.3) |
| Visual appearance of charts | fixture-driven render tests only |
