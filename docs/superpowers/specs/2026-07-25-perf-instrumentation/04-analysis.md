# 04 — Analysis

`apps/api/services/perf_analysis.py`. Pure functions, DTOs in
`apps/api/models/schema_parts/perf_analysis.py`.

**Contract:** no I/O, no globals, no locks, no wall-clock reads, no HTTP concepts.
Every function takes `list[PerformanceEvent]` and returns a DTO. Filtering happens
in the route before the call.

---

## 4.1 The central invariant: self time vs. total time

A fan-out span of 3,000 ms containing 138 children of 20 ms each is **2,760 ms in
children and 240 ms of its own work**. Reporting total time per scope would count
the same milliseconds twice and push percentages past 100%.

Every span carries both:

- `total_ms` — wall time including children
- `self_ms` — `total_ms` minus the sum of **direct** children's `total_ms`

> **Invariant.** Any aggregation that attributes time to a category (scope, ticker,
> component, cache) **must** use `self_ms`. `total_ms` is reserved for hierarchical
> visualization such as the waterfall.

Getting this backwards is the single most likely way to ship a confidently wrong
dashboard. Every aggregation function has a test asserting it against a
hand-constructed nested tree (§07.1).

---

## 4.2 `normalize_spans()`

Converts a flat event list into span nodes. Runs before every other function.

```python
def normalize_spans(events: list[PerformanceEvent]) -> list[Span]
```

Algorithm:

1. **Index by id.** `{event.id: event}`.
2. **Pair terminals to starts.** For each event with
   `metadata.closes_span_id == S`, merge it into the span node keyed `S`: the node
   takes the start event's `id` and structural position, and the terminal event's
   `duration_ms`, `status`, `level`, and metadata.
3. **Unpaired events with `duration_ms`** become standalone span nodes (the common
   case — `perf_timer` with `emit_start=False`).
4. **Unpaired `start` events** (terminal evicted or request still in flight) become
   span nodes with `total_ms = None` and `partial = True`.
5. **`start` events with no `duration_ms` that were paired** contribute structure
   only; they never enter timing math.

Result: one `Span` per logical operation, regardless of whether it was emitted as
one event or two.

---

## 4.3 Time reconstruction

Spans emit on exit, so `event.timestamp` is the span's **end**:

```
start_ms  = timestamp - duration_ms
offset_ms = start_ms - root.start_ms
```

Two clocks are involved: `duration_ms` comes from `perf_counter()` (monotonic),
timestamps from wall clock.

> **Durations are authoritative; offsets are advisory.** Reconstructed start times
> exist solely for visualization and ordering. Measured durations remain the source
> of truth for all calculations.

**Clamping rule.** A child whose computed bounds fall outside its parent's is
clamped to the parent's bounds and flagged `clock_skew: true`. Never rendered as a
negative-width bar, never dropped.

---

## 4.4 Definitions

- **A request** is all events sharing the same `request_id`.
- **`children[]`** is ordered by reconstructed start time, ties broken by emission
  order in the input list (which is the sink's insertion order).
- **Root** is the span in a request with no `parent_id`, or — if that event was
  evicted — a synthetic root (§04.9).

---

## 4.5 Function signatures

```python
# apps/api/services/perf_analysis.py

def normalize_spans(events: list[PerformanceEvent]) -> list[Span]
def list_requests(events: list[PerformanceEvent], limit: int,
                  buffer_limit: int) -> RequestIndex
def build_waterfall(events: list[PerformanceEvent], request_id: str) -> RequestWaterfall
def rollup_by_ticker(events: list[PerformanceEvent]) -> TickerCostTable
def breakdown_by_scope(events: list[PerformanceEvent]) -> ScopeBreakdown
def cache_effectiveness(events: list[PerformanceEvent]) -> CacheReport

# typed metadata accessors — the only readers of reserved keys
def span_rows(event) -> int | None
def span_bytes(event) -> int | None
def span_series_points(event) -> int | None
def span_cache_state(event) -> str | None
def span_fanout_size(event) -> int | None
def span_closes(event) -> str | None
```

No function takes a `route`, `window`, or filter argument. See §02.3.

### 4.5.1 Why `list_requests` takes `buffer_limit`

`buffer_limit` is **data, not an HTTP concept** — it is the ring buffer's configured
capacity, which the function cannot derive from the event list and must not read
from the sink itself (that would break purity, §02.5). The route reads it via
`get_dev_monitor_event_limit()` and passes it in.

`buffer_used` is simply `len(events)`, computed inside the function.

Together they let the dashboard state occupancy without a second request and
without touching raw events (§06.3). Occupancy is also the explanation for
`partial` and for requests missing from the index entirely: a full buffer means
older events were evicted.

---

## 4.6 DTOs

```python
class SpanNode(BaseModel):
    id: str
    parent_id: str | None
    operation: str
    scope: str
    status: str
    total_ms: float | None
    self_ms: float | None
    offset_ms: float
    clock_skew: bool = False
    orphaned: bool = False
    ticker: str | None = None
    table: str | None = None
    component: str | None = None
    rows: int | None = None
    bytes: int | None = None
    series_points: int | None = None
    cache_state: str | None = None
    children: list["SpanNode | CollapsedNode"] = []

class CollapsedNode(BaseModel):
    collapsed_count: int
    total_ms: float
    deepest_scope: str

class RequestSummaryRow(BaseModel):
    request_id: str
    route: str | None
    method: str | None
    started_at: datetime
    ended_at: datetime | None
    total_ms: float | None
    span_count: int
    ticker_count: int
    status: str
    partial: bool

class RequestIndex(BaseModel):
    requests: list[RequestSummaryRow]
    limit: int
    buffer_used: int          # len(events) passed in
    buffer_limit: int         # configured ring buffer capacity

class RequestWaterfall(BaseModel):
    request_id: str
    route: str | None
    total_ms: float | None
    span_count: int
    partial: bool = False
    truncated: bool = False
    root: SpanNode

class TickerCostRow(BaseModel):
    ticker: str
    self_ms: float
    span_count: int
    db_ms: float               # all self time
    calculation_ms: float
    external_ms: float
    cache_hits: int
    cache_misses: int
    rows_read: int
    bytes: int | None
    series_points: int | None

class TickerCostTable(BaseModel):
    rows: list[TickerCostRow]
    ticker_count: int
    total_self_ms: float
    p50_ms: float
    p95_ms: float
    max_ms: float
    cv: float
    distribution: Literal["uniform", "mixed", "skewed"]

class ScopeRow(BaseModel):
    scope: str
    self_ms: float
    pct_of_total: float
    event_count: int
    slow_count: int

class ScopeBreakdown(BaseModel):
    scopes: list[ScopeRow]
    total_ms: float
    unattributed_ms: float
    overlap_detected: bool = False

class CacheRow(BaseModel):
    component: str
    hits: int
    misses: int
    hit_rate: float
    avg_miss_cost_ms: float
    estimated_time_saved_ms: float

class CacheReport(BaseModel):
    caches: list[CacheRow]
```

---

## 4.7 `unattributed_ms`

```
unattributed_ms = root.total_ms - sum(span.self_ms for all spans)
```

The time nothing claimed: serialization, framework overhead, GC, uninstrumented
code. It is **the honest measure of how much of the picture is missing**, and it
points at where the next span belongs. A dashboard that normalized it away would
hide its own blind spots. Success criterion 2 (§08.4) is stated directly in terms of
it.

### It can go negative

Not only from rounding: **sibling spans in async code genuinely overlap in wall
time**, so `sum(self_ms)` can legitimately exceed the root's duration.

Rule:

```python
raw = root_total - sum_self
if raw < -EPSILON_MS:          # EPSILON_MS = 1.0
    overlap_detected = True
unattributed_ms = max(0.0, raw)
```

Negative unattributed time is a **signal** that spans ran concurrently — not an
error to paper over, and not something to silently clamp without saying so.

---

## 4.8 `distribution` — classifying the fan-out

Computed in `rollup_by_ticker()` from the coefficient of variation of per-ticker
`self_ms`:

```
cv = stdev(self_ms per ticker) / mean(self_ms per ticker)
```

| CV | `distribution` | Meaning | Implied fix |
| --- | --- | --- | --- |
| `< 0.15` | `uniform` | every ticker costs the same | **structural**: caching, batching, parallelism |
| `0.15 – 0.5` | `mixed` | some spread | investigate both |
| `> 0.5` | `skewed` | a few tickers dominate | **per-stock**: bad data, missing statements, fallback path |

Edge cases: fewer than 2 tickers, or `mean == 0` → `cv = 0.0`, `distribution =
"uniform"`.

**Why this is more than a statistic.** Classifying in the backend makes the central
finding **assertable** — the baseline runner can encode
`assert table.distribution == "uniform"`, so the conclusion survives into
sub-project #2 as a regression test rather than as someone's reading of a histogram.

---

## 4.9 Degradation rules

A finite ring buffer makes partial data normal, not exceptional.

| Condition | Behavior |
| --- | --- |
| **Orphaned span** — `parent_id` not present in the event set | Attach to a synthetic root, set `orphaned: true`. Never dropped, never a crash. |
| **Partial request** — some events evicted | `partial: true` on the DTO; the UI must label it. A waterfall missing a third of its spans that *looks* complete is worse than no waterfall. |
| **Unpaired start** — terminal missing or in flight | Span with `total_ms = None`, `partial: true`. Excluded from timing math. |
| **Point-in-time event** — a cache hit/miss, emitted once, complete, with no duration | `partial: false`. Amendment 2026-07-27: `partial` was originally `duration_ms is None`, which flagged every cache event as unfinished — 592 of 912 spans on a healthy buffer — and made baseline criterion 3 unreachable for any scenario touching the cache. `partial` now means *a span we expected to close that did not*, so only a start event can be partial: `duration_ms is None and status == "start"`. `status == "start"` is written at exactly the three start-event emit sites (§03.2, §03.3), which makes it an exact discriminator. |
| **`start` events** (`duration_ms = None`) | Structure only; never enter timing math. |
| **Truncated waterfall** — exceeds span cap | Deepest-first collapse; elided subtree replaced by a `CollapsedNode`; `truncated: true`. |
| **Empty input** | Valid empty DTO. Never an exception. |

### Diagnostic states, not errors

`partial`, `truncated`, `clock_skew`, `orphaned`, `overlap_detected` form a named
category. They describe the **measurement**, not a failure of the system under
measurement, and render as neutral or warning styling — never error styling (§06.7).

---

## 4.10 Waterfall truncation

Cap: **2,000 spans per waterfall** (roughly three full fan-outs).

Algorithm when exceeded:

1. Compute the depth of every node.
2. Collapse the deepest sibling groups first, since detail deep in the tree is the
   least informative at a glance.
3. Replace each collapsed group with a `CollapsedNode` carrying `collapsed_count`,
   summed `total_ms`, and the `deepest_scope` beneath it.
4. Repeat until under the cap.
5. Set `truncated: true` on the `RequestWaterfall`.

The `CollapsedNode` lives **in the DTO, not only in the UI**, so the tree is
structurally honest and the UI cannot render an absence as "no children."

---

## 4.11 `cache_effectiveness()`

Groups `scope == "cache"` events by `component`.

```
hit_rate                = hits / (hits + misses)
avg_miss_cost_ms        = mean(duration_ms of cache.populate events)   # see 4.11.1
estimated_time_saved_ms = hits × avg_miss_cost_ms
fills                   = count of timed cache.populate events
```

### 4.11.1 Amendment (2026-07-27): the fill, not the miss

The original formula averaged `duration_ms` of **miss** events, and produced
`avg_miss_cost_ms = 0.0` on every real run. A miss event is emitted at the moment the
miss is *detected*, so it can never carry the cost of the fetch it triggers — which is
precisely the cost each later hit avoids. The hit ratio was the only knowable figure.

A `cache.populate` event (status `cache_populate`, §03.5) now wraps the fill and
carries its duration. `cache_effectiveness` prefers populate durations and falls back
to a timed miss only when no populate span exists. `CacheRow.fills` reports how many
timed fills back the average, so `misses=539, fills=0` reads as *unmeasured* rather
than as a zero cost — the same distinction §4.9 draws elsewhere.

The last line is an **estimate**, and its assumption is written into the DTO
docstring:

> Assumes a miss would have cost the observed average miss cost for this cache.
> Defensible for a TTL cache over stable data; wrong if miss costs are bimodal
> (cold vs. warm SQLite page cache).

Naming the assumption is what keeps the number from being read as a measured saving.

This replaces the single global `cache_hit_rate` in `PerformanceSummary`, which
mixes four unrelated caches (attribution, report, Yahoo statements, provider fetch)
into one near-meaningless figure. The existing field is left in place for the
current `/dev/monitor` page; the new report supersedes it for analysis.

---

## 4.12 Acceptance checks for this section

- [ ] `self_ms` correct for a 3-level nested tree built by hand.
- [ ] Scope breakdown uses `self_ms`; percentages sum to ≤ 100%.
- [ ] `sum(scope.self_ms) + unattributed_ms == root.total_ms` (within epsilon).
- [ ] Overlapping siblings → `overlap_detected: true`, `unattributed_ms == 0`.
- [ ] Orphan attaches to synthetic root with `orphaned: true`; nothing dropped.
- [ ] Evicted mid-request events → `partial: true`.
- [ ] Child bounds outside parent → clamped, `clock_skew: true`, width ≥ 0.
- [ ] `children[]` ordered by reconstructed start, ties by input order.
- [ ] Span pairing works for `perf_timer` (same operation) **and** middleware
      (different operation).
- [ ] CV thresholds classify exactly at 0.15 and 0.5 boundaries.
- [ ] `cv = 0.0`, `distribution = "uniform"` for 0 or 1 ticker.
- [ ] Truncation produces `CollapsedNode` with correct `collapsed_count` and summed
      `total_ms`; `truncated: true`.
- [ ] Empty event list returns valid empty DTOs for all six functions.
- [ ] `perf_analysis.py` imports no sink, no `os`, no `datetime.now`, and no
      `subprocess` — environment metadata is the runner's job (§08.4.1).
- [ ] `list_requests` populates `buffer_used` from `len(events)` and echoes the
      `buffer_limit` argument; it never reads the sink.
