# 02 — Architecture

Four layers, strictly ordered. Each knows only about the layer below it.

---

## 2.1 Layer diagram

```
┌─ Baseline runner ──────── scripts/benchmark_scenarios.py
│    replays fixed scenarios → consumes the SAME analysis API → dated report
│
├─ View ───────────────── apps/web/app/dev/performance/
│    waterfall · per-stock cost · scope breakdown · cache effectiveness
│    consumes DTOs only; never raw events
│
├─ Analysis ───────────── apps/api/services/perf_analysis.py
│    PURE: list[PerformanceEvent] → DTO
│    no I/O · no globals · no locks · no clock · no HTTP concepts
│    └─ adapters/perf_jsonl.py — load_events_from_jsonl()  (the only I/O)
│
└─ Capture ────────────── apps/api/core/dev_monitor.py (extended)
     perf_timer() + span context
     EventSink
       ├── ring buffer          (live, in-memory)
       └── persistence backend  (durable; today JSONL)
```

---

## 2.2 File placement

Per `guideline/sop/file-structure.md` ownership rules.

| Path | Owns | New / Modified |
| --- | --- | --- |
| `apps/api/core/dev_monitor.py` | capture, sink, span context | **modified** |
| `apps/api/core/middleware.py` | request spans, response bytes | **modified** |
| `apps/api/services/db.py` | SQL spans | unchanged |
| `apps/api/services/perf_analysis.py` | pure analysis functions | **new** |
| `apps/api/services/adapters/perf_jsonl.py` | JSONL reader | **new** |
| `apps/api/models/schema_parts/perf_analysis.py` | analysis DTOs | **new** |
| `apps/api/routes/dev_monitor.py` | HTTP endpoints | **modified** |
| `apps/api/routes/corporate.py` | loader wrap sites | **modified** |
| `apps/api/services/portfolio/data_provider.py` | series span | **modified** |
| `apps/web/app/dev/performance/page.tsx` | dashboard | **new** |
| `apps/web/lib/devMonitor.ts` | client types + fetchers | **modified** |
| `scripts/benchmark_scenarios.py` | baseline runner | **new** |
| `tests/api/test_perf_analysis.py` | analysis unit tests | **new** |
| `tests/api/test_perf_capture.py` | capture behavior tests | **new** |
| `docs/perf/` | generated baseline reports | **new dir** |

`apps/api/core` is the correct home for capture: the SOP assigns middleware,
logging, and backend-local helpers there, and `dev_monitor.py` already lives in it.
Analysis is orchestration over API-local data, so it belongs in
`apps/api/services`. Neither contains finance formulas, so `packages/core_finance`
is untouched.

---

## 2.3 Layer contracts

### Capture

**Public surface:** `perf_timer()`, `emit_performance_event()`, `get_dev_monitor_sink()`,
`sink.flush()`.

The sink speaks *events*, not *JSONL*. Ring buffer and persistence backend are both
internals; **whether an event has reached disk is unobservable to callers**.
Replacing JSONL with SQLite later touches one class and no caller.

Capture never imports from Analysis, Routes, or View.

### Analysis

**Contract:** every function takes `list[PerformanceEvent]` and returns a DTO.

- No I/O
- No global state
- No locks
- No wall-clock reads (all timing comes from the events themselves)
- No HTTP concepts — filtering happens in the route *before* the call

The last point matters: `rollup_by_ticker(events)` takes no `request_id`, `route`,
or `window` parameter. Routes filter, then call, in a documented order (§05.2.1).
This keeps the analysis layer testable with hand-built lists and reusable by the
offline benchmark runner.

**Corollary — environment metadata is never analysis output.** Watchlist size, DB
row counts, git SHA, compute mode, and wall-clock timestamps are I/O, subprocess
calls, configuration, or clock reads. Each is forbidden by the contract above, so
none appears in an analysis DTO. Capturing them is the **runner's** responsibility
(§08.4.1). The one value a caller passes *in* rather than an analysis function
reading it out is `buffer_limit` — plain data, supplied by the route (§04.5.1).

The JSONL reader is an **adapter**, not analysis code:
`load_events_from_jsonl(day_range) -> list[PerformanceEvent]`. It re-validates into
the same model, so analysis never learns where events came from.

### Routes

Three lines each:

```python
events = get_dev_monitor_sink().recent(limit=BUFFER_LIMIT)
events = [e for e in events if e.request_id == request_id]   # filtering lives here
return APIResponse(data=build_waterfall(events, request_id), meta=_response_meta())
```

No transformation, no calculation, no formatting.

### View

Consumes DTOs only. **Raw events never cross the wire** (§06.5).

### Baseline runner

Imports and calls the same public analysis functions the routes use. A report and
the dashboard therefore cannot disagree, because there is exactly one
implementation of every calculation.

---

## 2.4 Single canonical event type

`PerformanceEvent` flows end to end:

```
perf_timer() ──► emit() ──► ring buffer ──────────────► analysis
                       └──► persistence ──► reader ──► analysis
```

The JSONL reader **re-validates into `PerformanceEvent`**, so analysis never sees a
dict, a partially-typed record, or a second shape. There is no "wire format" and no
"analysis format" — one model, three transports.

### Reserved metadata keys

New measurements live in `metadata` rather than as top-level fields, avoiding a
schema migration. They are treated as a contract, documented in one place, and read
**only** through typed accessors in the analysis layer — never as raw dictionary
lookups scattered through the code.

| Key | Type | Set by | Meaning |
| --- | --- | --- | --- |
| `rows` | `int` | `InstrumentedCursor`, `ticker.metrics` | rows read or affected |
| `bytes` | `int \| None` | middleware, `fetchApi`, `ticker.series` | payload size; `None` for streams |
| `series_points` | `int` | `ticker.series` | close-series length |
| `cache_state` | `"hit" \| "miss" \| "n/a"` | `ticker.price`, cache sites | cache outcome for this span |
| `fanout_size` | `int` | `fanout.*` spans | number of iterations |
| `closes_span_id` | `str` | `perf_timer`, middleware | id of the `start` event this event terminates |

Accessors live in `perf_analysis.py`:

```python
def span_rows(event: PerformanceEvent) -> int | None
def span_bytes(event: PerformanceEvent) -> int | None
def span_series_points(event: PerformanceEvent) -> int | None
def span_cache_state(event: PerformanceEvent) -> str | None
def span_fanout_size(event: PerformanceEvent) -> int | None
def span_closes(event: PerformanceEvent) -> str | None
```

Each returns `None` on absent or wrong-typed values. Nothing else in the codebase
reads these keys directly.

---

## 2.5 Dependency rules

| Layer | May import |
| --- | --- |
| Capture | models only |
| Analysis | models, capture's **model** (not its sink) |
| Adapters | models, capture's log-path helper |
| Routes | capture (sink), analysis, models |
| View | its own client module |
| Runner | capture (sink + flush), analysis, models, httpx |

Enforced by review, not tooling. The one rule worth watching in code review:
**Analysis must never import `get_dev_monitor_sink`.** If it does, purity is gone
and the tests stop being trustworthy.

---

## 2.6 Feature gating

Everything sits behind `is_dev_monitor_enabled()` (`MONEYVIEW_DEV_MONITOR=true`,
`dev_monitor.py:27`), which is **off by default**. Consequences:

- Zero overhead on the default path — spans are not created, not just not persisted.
- All new endpoints return 404 when disabled, via the existing `_require_dev_monitor()`.
- The dashboard must render a *disabled* state, not an error state (§06.7).
- The baseline runner sets the flag itself for its instrumented pass.

---

## 2.7 Interaction with the active compute/web tier-split track

`docs/architecture/compute-web-tier-split-design.md` §A-2 defines three telemetry
buckets — **serialization / wire / compute** — already emitted on the HTTP compute
hop (commit `d2e4f8c`).

Those events use the same `PerformanceEvent` model and the same sink, so they appear
in this design's waterfall and scope breakdown **with no additional work**. Two
consequences:

1. `ScopeBreakdown` will show compute-hop buckets automatically once
   `MONEYVIEW_COMPUTE_MODE=http` is active. No special-casing.
2. This spec must not redefine or rename those buckets. Where the tier-split spec
   has already fixed a term, this spec adopts it.
