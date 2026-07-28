# 03 — Capture

Extends `apps/api/core/dev_monitor.py`. Nothing here changes application behavior.

---

## 3.1 Extend `perf_timer()`, do not replace it

`perf_timer()` (`dev_monitor.py:324`) already provides everything the design needs
except automatic parent tracking:

| Requirement | Already provided? |
| --- | --- |
| Monotonic timing (`perf_counter`) | ✅ `dev_monitor.py:355` |
| Emit once on exit with duration | ✅ `dev_monitor.py:380-390` |
| Mutable metadata for caller annotation | ✅ `yield mutable_metadata` |
| Slow-threshold classification per scope | ✅ `slow_threshold_ms_for_scope` |
| Error event **then re-raise original exception** | ✅ `dev_monitor.py:361-378` |
| Optional start event | ✅ `emit_start=False` default |
| **Automatic `parent_id` from enclosing span** | ❌ **the gap** |

Building a parallel `instrument_span()` would create a duplicate timing abstraction
competing with the existing one. The work is to close the one gap.

---

## 3.2 Span context

Add a contextvar alongside the existing `_current_request_id` (`dev_monitor.py:24`):

```python
_current_span_id: ContextVar[str | None] = ContextVar(
    "moneyview_dev_monitor_span_id", default=None
)
```

`perf_timer` sets it to the span's own id on entry and resets on exit:

```python
@contextmanager
def perf_timer(*, scope, operation, parent_id=None, emit_start=False, ...):
    span_id = uuid4().hex
    effective_parent = parent_id if parent_id is not None else _current_span_id.get()
    token = _current_span_id.set(span_id)
    try:
        ...                       # existing body, using effective_parent
    finally:
        _current_span_id.reset(token)
```

Rules:

- An explicit `parent_id=` argument always wins over the contextvar. Existing
  callers keep their current behavior.
- The emitted event's `id` **is** `span_id`, so children resolve to a real node.
- `emit()` reads the contextvar only when the event has no explicit `parent_id`.

### 3.2.2 Amendment (2026-07-27): the request span must scope the contextvar too

`perf_timer` closing the gap is not sufficient. The **request-level** span — the one
every other span in a request should hang from — is emitted by `middleware.py` through
raw `emit_performance_event`, not `perf_timer`, so it never set the contextvar. For the
whole request the ambient span id stayed `None`, and every event emitted *outside* a
`perf_timer` block (all cache events, and `db.*` from `InstrumentedCursor`) was
parented to nothing. Measured on one `GET /portfolio/watchlist`: **423 spans, 423
roots.**

That is not cosmetic. With more than one root, `breakdown_by_scope` switches to its
synthetic-root denominator — the *sum* of all root durations rather than the request's
real duration — so criterion 2 computed `unattributed_ms` against a meaningless total
and reported a flattering `0.0 / PASS`. Baseline criterion 3 also failed permanently
via `_build_tree`'s `len(roots) > 1`.

`dev_monitor` therefore exports `set_current_span_id`/`reset_current_span_id`,
mirroring the existing `set_current_request_id`/`reset_current_request_id` pair, and
middleware scopes the request span id exactly as it already scopes the request id
(`middleware.py:83`/`:270`): set immediately after `api.request_start` is emitted so it
does not parent itself, reset in the same `finally`.

### 3.2.1 Threadpool propagation — the risk that needs a test

FastAPI runs **sync** route handlers in a threadpool. The design depends on
contextvars being copied into worker threads. They are — `anyio.to_thread` copies
the context, and `get_current_request_id()` already relies on this — but the failure
mode is silent: spans lose their parent and appear as orphans, which reads as
missing data rather than as a bug.

Required regression test: a sync route handler whose nested spans retain the correct
`parent_id`. See §07.2.1.

---

## 3.3 Span pairing: `closes_span_id`

### The problem

When a start event is emitted, both the terminal event **and** every real child get
`parent_id = start_event.id` — so the terminal event is a sibling of its own span's
children. Worse, two conventions coexist:

| Emitter | Start operation | Terminal operation |
| --- | --- | --- |
| `perf_timer(emit_start=True)` | `<operation>` | `<operation>` (same name, different status) |
| `middleware.py:95` | `api.request_start` | `api.request_complete` / `api.request_error` |

Any pairing rule based on matching operation names works for one convention and
**silently fails** the other, producing waterfalls that are wrong in a way nobody
notices.

### The fix

Terminal events set `metadata.closes_span_id = <start event id>`. Three emit sites:

| Site | File | Change |
| --- | --- | --- |
| `perf_timer` success path | `dev_monitor.py:380` | add `closes_span_id` when `start_event` exists |
| `perf_timer` error path | `dev_monitor.py:363` | same |
| middleware complete + error | `middleware.py:126`, `:177` | add `closes_span_id = request_event_id` |
| **page_load complete + error** | `middleware.py` page_load terminals | add `closes_span_id = page_load_event_id` — amendment 2026-07-27 |

**Amendment (2026-07-27).** The table above originally listed only the `api.request_*`
middleware terminals, so this section's own fix covered one emit convention and left
the other open — the exact failure mode it exists to prevent. `page_load.*` emits a
start event (§3.5 row 9) whose terminal set no `closes_span_id`, so the start span
stayed `partial` forever and its terminal became a *separate* span: `page_load.portfolio`
reported 6 spans for 3 requests and double-counted its self time in the published
ranking. Both the complete and error paths now capture the page_load start event's id
and pair against it.

`normalize_spans()` then pairs exactly rather than guessing (§04.2).

### Why start events are kept

An in-flight request must be visible before it completes — that is what feeds
`active_requests` in `PerformanceSummary` and the live SSE stream at
`routes/dev_monitor.py:27`. A 3-second fan-out that emits nothing until it finishes
is invisible during exactly the window of interest.

`emit_start` stays `False` by default. It is switched on for the two fan-out spans
(§03.5), which are the long-running ones.

---

## 3.4 Buffered persistence

### Current behavior — the bottleneck

`dev_monitor.py:196`:

```python
def _append_jsonl(self, event: PerformanceEvent) -> None:
    self.log_path.parent.mkdir(parents=True, exist_ok=True)
    with self.log_path.open("a", encoding="utf-8") as handle:   # open per event
        handle.write(event.model_dump_json())
        handle.write("\n")
```

Called from inside `emit()` **while holding the lock**. Measured at 199.9 µs/event
versus 4.1 µs buffered — 49× (§01.6).

### Required behavior

```
emit()
  ├─ lock
  ├─ append to ring buffer
  ├─ append to pending write queue
  └─ unlock

background flusher (thread)
  ├─ wakes on N pending events OR T ms elapsed, whichever first
  ├─ open fd once
  ├─ write batch
  └─ close (or keep fd open, sink's choice)
```

Defaults: **N = 200 events, T = 500 ms**, both env-overridable. Buffering is an
internal detail of the sink; no caller can observe whether an event is on disk.

### Three required behaviors

| Behavior | Why |
| --- | --- |
| **`flush()` is public and blocking** | The baseline runner must call it before reading JSONL, or it measures a truncated file — silently corrupting every report. |
| **Flush on shutdown** | Otherwise the final request of a session is lost. Registered as a FastAPI shutdown handler. |
| **Synchronous mode** (constructor flag) | A background thread makes test assertions racy. Tests construct the sink with `synchronous=True`. |

### Accepted tradeoff

A hard crash loses up to one buffer's worth of events (≤ 200 events / 500 ms). For
local developer tooling this is correct — durability is not worth paying 196 µs per
span for.

---

## 3.5 Span map

**Principle: instrument at seams, never inside loop bodies.** The 138× loop at
`corporate_comparison.py:287` is not edited.

| # | Span | Seam (file:line) | Scope | `emit_start` | Metadata |
| --- | --- | --- | --- | --- | --- |
| 1 | `api.request_*` | `middleware.py:95` | `api` | yes (exists) | **+ `bytes`** |
| 2 | `db.<op>_<table>` | `services/db.py:85` | `db` | no | `rows` (exists) |
| 3 | `cache.*` | `dev_monitor.py:266` | `cache` | no | exists |
| 3b | `cache.populate` | `market_data` fill sites, `corporate_statement_metrics` fill | `cache` | no | `duration_ms`, `reason` — **added 2026-07-27** |
| 4 | `fanout.comparison` | `corporate_comparison.py:46` | `calculation` | **yes** | `fanout_size` |
| 5 | `ticker.metrics` | `routes/corporate.py` `_metrics_for_ticker` | `calculation` | no | `ticker`, `rows` |
| 6 | `ticker.price` | `routes/corporate.py` `_latest_market_price` | `calculation` | no | `ticker`, `cache_state` |
| 7 | `fanout.attribution` | attribution orchestration | `calculation` | **yes** | `fanout_size` |
| 8 | `ticker.series` | `portfolio/data_provider.py:51` | `db` | no | `ticker`, `series_points`, `bytes` |
| 9 | `page_load.*` | `middleware.py:107` + `useDevMonitorPageLoad` | `page_load` | yes (exists) | exists |
| 10 | `frontend.query.*` | `apps/web/lib/api.ts:159` | `api` | no | **+ `bytes`** |

**Six new wrap sites** (4–8, plus the two `bytes` additions). Everything else
already emits.

### 3.5.1 Loader wrapping — one edit, five call sites covered

Because the loaders are injected (§01.3), wrapping them at definition covers
`/comparison`, `/comparison/snapshot`, `/comparison/snapshot-version`, and both DCF
report routes:

```python
# apps/api/routes/corporate.py

def _metrics_for_ticker(ticker: str, **kwargs) -> CorporateMetrics:
    with perf_timer(scope="calculation", operation="ticker.metrics",
                    ticker=ticker) as meta:
        metrics = _load_metrics(ticker, **kwargs)      # existing body
        meta["rows"] = 1
        return metrics
```

`ticker.price` is wrapped identically, setting `meta["cache_state"]` from the
provider cache outcome.

### 3.5.2 Response bytes

In `middleware.py`, on the complete path:

```python
raw_length = response.headers.get("content-length")
body_bytes = int(raw_length) if raw_length is not None else None
```

**Streaming responses are excluded by design.** `corporate.py:411` (DCF stream) and
`routes/dev_monitor.py:44` (log stream) are `StreamingResponse` with no
`content-length`; buffering them to measure size would change the behavior under
measurement. They report `bytes: None`, and the dashboard shows "n/a" rather than a
wrong number. Precedent for this handling already exists at
`apps/api/core/transport_progress.py:95`.

On the frontend, `apps/web/lib/api.ts` adds the same field from the response
`content-length` header into the existing monitor metadata.

---

## 3.6 Data volume — three distinct measurements

Conflating these would produce a misleading dashboard.

| Measurement | Metadata key | Source | Answers |
| --- | --- | --- | --- |
| Rows read | `rows` | `InstrumentedCursor` (exists) | how much the DB touched |
| Bytes on the wire | `bytes` | middleware + `fetchApi` | how much crossed the boundary |
| Series footprint | `series_points` | `ticker.series` | **what this stock costs to analyze** |

Series footprint in bytes is `series_points × 8` (float64 close series). At ~862
bars per ticker this is ~6.9 KB per stock, ~950 KB across the 138-ticker universe —
the number that makes S5/S6 concrete.

---

## 3.7 Buffer sizing

```python
_RECENT_EVENT_LIMIT = 2000        # dev_monitor.py:21 — current
```

One comparison emits ~690 events, so three requests evict the first entirely: **you
could not inspect the waterfall of a request you just made.** The buffer is sized
for a live tail, not for analysis.

**Change:** default **20,000**, env-configurable via
`MONEYVIEW_DEV_MONITOR_EVENT_LIMIT`, read through a
`get_dev_monitor_event_limit() -> int` getter that follows the existing
`get_dev_monitor_retention_days()` precedent (`dev_monitor.py:42`) — same
parse-with-fallback shape, same module. Routes call this getter (§05.2).

Cost: **33 MB** measured (~1.7 KB/event). Both `_recent_events` and
`_sequenced_events` deques take the new limit.

Rejected alternative and its cost is recorded in §01.6.2.

---

## 3.8 Failure policy

> Persistence failures (disk full, permission denied, encoding error) are logged
> **once**, after which persistence self-disables for the session while the
> in-memory ring buffer continues serving the live view. No telemetry failure ever
> aborts, retries into, or slows a request. Any exception raised inside a span
> propagates the **original** application exception, never a telemetry one.

Implementation notes:

- A `_persistence_failed: bool` on the sink, set on first write failure.
- The log line is emitted once, at `error` level, naming the path and the errno.
- The live view continues; `PerformanceSummary` and all analysis endpoints keep
  working from memory.
- `flush()` becomes a no-op after self-disable and returns without raising, so the
  baseline runner degrades to memory-only rather than crashing.

"Logged once" is load-bearing: a disk-full condition that logged per event would
turn one failure into a second bottleneck — the exact class of problem this spec
exists to eliminate.

`perf_timer`'s existing error path already re-raises the original exception
(`dev_monitor.py:378`), satisfying the last sentence with no change.

---

## 3.9 Overhead budget

Target: **≤ 3% of the measured operation**, when instrumentation is enabled.

Verified by the baseline runner, which runs every scenario twice — flag off and flag
on — and reports the delta (§08.3). Not asserted in the unit test suite, because
timing assertions there are flaky (§07.2).

If overhead exceeds budget, the report declares the measurement untrustworthy rather
than publishing inflated numbers.

---

## 3.10 Acceptance checks for this section

- [ ] `perf_timer` nests: an inner span's `parent_id` equals the outer span's `id`.
- [ ] Explicit `parent_id=` still overrides the contextvar.
- [ ] Sync route handler preserves span nesting through the threadpool.
- [ ] `closes_span_id` present on terminal events from **both** conventions.
- [ ] N events produce one file-open, not N (patched `open`).
- [ ] `flush()` empties the queue and is safe to call twice.
- [ ] Shutdown flushes.
- [ ] Write failure → logged once, persistence disabled, request unaffected, ring
      buffer still serving.
- [ ] `bytes` is `None` for both `StreamingResponse` endpoints, integer elsewhere.
- [ ] Event limit honors `MONEYVIEW_DEV_MONITOR_EVENT_LIMIT`.

Added by the 2026-07-27 amendments:

- [ ] A request's waterfall has **exactly one root**, and that root is
      `api.request_start` — the check that would have caught §3.2.2 immediately. The
      original §3.10 check ("an inner span's `parent_id` equals the outer span's `id`")
      is satisfied by `perf_timer`-to-`perf_timer` nesting and does not cover directly
      emitted events, which are the majority of spans by count.
- [ ] `closes_span_id` present on `page_load.*` terminals, not only `api.request_*`.
- [ ] A point-in-time cache event is not flagged `partial` (§04.9).
- [ ] `cache.populate` carries a `duration_ms` on both the miss and stale fill paths.
