# Performance Instrumentation & Analysis — Design Spec

**Date:** 2026-07-25
**Status:** Design approved · implementation plan pending
**Scope:** Sub-project 1 of 4

---

## The problem

Four surfaces reported slow — portfolio first load, running an analysis, switching
tabs, selecting a single stock — plus calculation and disk read/write speed. **No
measurement existed for any of it.**

Investigation found the workload is a **138-ticker serial fan-out** over 120,647
price rows, and that MoneyView already records far more telemetry than it uses:
span trees with `parent_id`, per-statement SQL timing, cache hit/miss events, and
daily JSONL persistence — all aggregated into six scalars and otherwise discarded.

It also found that the telemetry write path costs **199.9 µs per event**, so adding
per-ticker spans without buffering first would add ~138 ms of overhead to the very
requests being measured.

## What this spec builds

Instrumentation, an analysis surface, and a reproducible baseline — so the
optimization work that follows starts from evidence rather than hypothesis. **It
changes no application behavior.**

## Reading order

| § | File | Contents |
| --- | --- | --- |
| 01 | [Context & findings](01-context-and-findings.md) | measured scale, existing instrumentation inventory, gaps, costs, scope boundary |
| 02 | [Architecture](02-architecture.md) | four layers, file placement, contracts, canonical event type, dependency rules |
| 03 | [Capture](03-capture.md) | `perf_timer` extension, span context, `closes_span_id`, buffered sink, span map, failure policy |
| 04 | [Analysis](04-analysis.md) | self vs. total time, `normalize_spans`, DTOs, `unattributed_ms`, CV classification, degradation |
| 05 | [API](05-api.md) | five endpoints, route shape, frontend client |
| 06 | [Dashboard](06-dashboard.md) | panels, layout, distribution-first per-stock design, states |
| 07 | [Testing](07-testing.md) | analysis / capture / route / frontend test matrices |
| 08 | [Baseline & success](08-baseline-and-success.md) | runner, five scenarios, report format, success criteria |

Start at 01 for the evidence, 02 for the shape, 03–04 for the substance.

---

## Decision log

Decisions taken during design, with the reasoning that produced them.

| # | Decision | Why |
| --- | --- | --- |
| D1 | Measure before optimizing | All four slow surfaces sit downstream of one fan-out. Fixing before measuring risks optimizing the wrong layer. |
| D2 | Span-tree over existing rails, not a new telemetry system | `PerformanceEvent`, `perf_timer`, `InstrumentedCursor`, cache events, and persistence already exist. `parent_id` is already populated and unused. |
| D3 | Extend `perf_timer()` rather than add `instrument_span()` | The existing helper already provides timing, mutable metadata, emit-on-exit, and correct exception re-raise. Only parent tracking was missing. |
| D4 | Buffer the JSONL writer **before** adding per-ticker spans | 199.9 µs → 4.1 µs per event (49×). Unbuffered, 690 spans cost 138 ms — the instrumentation would corrupt its own measurement. |
| D5 | `closes_span_id` in capture, not pairing heuristics in analysis | Two start/terminal conventions coexist (`perf_timer` same-name, middleware different-name). Any name-matching rule silently fails one of them. |
| D6 | Ring buffer 20,000 (33 MB); dashboard never reads disk | JSONL-per-query costs 120 ms–1.2 s *per panel refresh*, grows through the day, and forces a blocking flush that couples UI to the write path. |
| D7 | `self_ms` mandatory for all category aggregation | A 3,000 ms fan-out with 138 × 20 ms children double-counts 2,760 ms if totals are used. Most likely way to ship a confidently wrong dashboard. |
| D8 | Expose `unattributed_ms` rather than normalize it away | It is the honest measure of instrumentation blind spots, and it points at where the next span belongs. Success criterion 2 is stated in terms of it. |
| D9 | Clamp `unattributed_ms` to zero **with** `overlap_detected` | It can go legitimately negative — async siblings overlap in wall time. Silent clamping would hide real concurrency. |
| D10 | Classify fan-out `distribution` in the backend (CV) | Makes the central finding assertable by the baseline runner instead of dependent on someone reading a histogram. |
| D11 | Per-stock panel leads with distribution, not ranking | Uniform → structural fix; skewed → per-stock fix. A ranked 138-row table hides which regime you are in. |
| D12 | Analysis layer is pure; routes filter | Testable with hand-built lists, reusable by the offline runner, and impossible to accidentally couple to HTTP. |
| D13 | Separate `/dev/performance` page from `/dev/monitor` | "What is happening?" and "where is time spent?" are different jobs with different refresh semantics. |
| D14 | No cross-filtering between panels | Request picker drives all; ticker→waterfall highlighting is a cheap v2 nobody has asked for yet. |
| D15 | Streams report `bytes: null` | Buffering a `StreamingResponse` to measure it would change the behavior under measurement. |
| D16 | Per-ticker cache deferred to sub-project #2 | Likely correct, but unproven. If the fan-out is DCF-bound rather than IO-bound, a memo cache buys nothing and adds invalidation complexity. |
| D17 | Overhead budget ≤ 3%, derived from two passes | Stating overhead requires measuring with the flag off and on, not assuming instrumentation is free. |
| D18 | Timing assertions excluded from the unit suite | Flaky under load. Overhead is measured by the runner and reported, not asserted in pytest. |
| D19 | Filter order fixed and documented: `request_id` → `route` → `window` | `window` is time-relative, so ordering is observable: a named request older than the window is excluded, deliberately. Any future *selective* filter (top-N, sampling) would be order-dependent, so the chain is pinned now (§05.2.1). |
| D20 | Buffer occupancy ships on `RequestIndex`, not `APIMeta` or a client-side count | `/requests` is already fetched every load and refresh, so it costs nothing extra; and since the dashboard receives only aggregated DTOs, no client-side array corresponds to buffer contents. Occupancy also *explains* the index — a full buffer is why older requests are missing (§05.1.1). |
| D21 | A frontend fixture per diagnostic state, not just `partial` | The likely regression is one of the five getting error styling or being dropped — exactly what the diagnostic/error distinction exists to prevent. `clock_skew` and `overlap_detected` assert rendered *values* (non-negative width, non-negative percentage), since those are where the clamping rules would fail visibly (§07.4.1). |
| D22 | Environment metadata is captured by the runner, never by analysis | Watchlist size, DB counts, git SHA, and clock reads are I/O, subprocess, config, or clock — each forbidden by the Analysis contract. Putting them in a DTO would hand the analysis layer the capabilities the contract removes, and §07.1's hand-built-list tests would stop being trustworthy (§08.4.1). |

---

## Non-goals

- **No optimization.** No application behavior changes. The likely fix (per-ticker
  caching) is deferred so it lands with a measured before/after (D16).
- **No cross-panel filtering** (D14).
- **No historical query API.** Cross-session history belongs to the offline runner;
  the dashboard never reads disk (D6).
- **No changes to `/dev/monitor`.** The existing live stream keeps its job (D13).
- **No new UI primitives** except the span waterfall renderer.

---

## Sub-project sequence

| # | Sub-project | Status | Depends on |
| --- | --- | --- | --- |
| **1** | **Perf truth-finding + perf view** | **this spec** | — |
| 2 | On-demand loading (fetch-per-stock, tab switching) | deferred | #1's findings |
| 3 | UI/UX redesign | deferred | loosely #2 |
| 4 | Stock-add availability pre-check | deferred | — |

Each gets its own spec → plan → implementation cycle.

---

## References

- `docs/architecture/api-transport-observability.md` — existing request/transport logging
- `docs/architecture/compute-web-tier-split-design.md` — active tier-split track; §A-2 telemetry buckets appear in this design's waterfall for free (§02.7)
- `docs/architecture/dev-monitor-backend-foundation.md` — dev monitor foundation
- `guideline/sop/file-structure.md` — ownership boundaries
- `guideline/sop/architect.md`, `guideline/sop/planner.md` — process
