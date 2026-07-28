# 05 — API Surface

Extends `apps/api/routes/dev_monitor.py`. All new endpoints sit behind the existing
`_require_dev_monitor()` 404 gate (`routes/dev_monitor.py:15`) and return
`APIResponse[T]` with `_response_meta()`.

---

## 5.1 Endpoints

| Method | Path | Returns | Query params |
| --- | --- | --- | --- |
| GET | `/api/v1/dev/performance/requests` | `RequestIndex` (incl. `buffer_used` / `buffer_limit`) | `limit` (1–200, default 50) |
| GET | `/api/v1/dev/performance/waterfall/{request_id}` | `RequestWaterfall` | — |
| GET | `/api/v1/dev/performance/by-ticker` | `TickerCostTable` | `request_id?`, `route?`, `window?` |
| GET | `/api/v1/dev/performance/breakdown` | `ScopeBreakdown` | `request_id?` |
| GET | `/api/v1/dev/performance/cache` | `CacheReport` | `window?` |

Existing endpoints are unchanged: `/performance/recent`, `/performance/slow`,
`/performance/errors`, `/performance/summary`, `/performance/client-event`,
`/log-stream`.

### Parameter semantics

- **`request_id` omitted** on `by-ticker` and `breakdown` means "across the whole
  buffer" — how patterns become visible rather than one-offs.
- **`route`** filters to events whose `route` matches exactly (e.g.
  `/api/v1/corporate/comparison`).
- **`window`** is a duration in seconds (default 300, max 3600), filtering by
  `timestamp`. Bounds the aggregate views to recent activity.

### Status codes

| Code | Condition |
| --- | --- |
| 200 | success, including empty results |
| 404 | `MONEYVIEW_DEV_MONITOR` not enabled (all endpoints) |
| 404 | `waterfall/{request_id}` where no events carry that `request_id` |
| 422 | parameter out of range (FastAPI `Query` validation) |

An empty buffer returns **200 with an empty DTO**, not 404 — "nothing recorded yet"
is a valid answer and the dashboard renders it as an empty state.

### 5.1.1 Buffer occupancy is supplied by `/requests`

The dashboard header displays ring buffer occupancy (§06.3). That figure comes from
**`RequestIndex.buffer_used` / `RequestIndex.buffer_limit`** on the
`/performance/requests` response — not from `APIMeta`, not from
`/performance/summary`, and never inferred client-side from array lengths.

Rationale:

- `/requests` is already fetched on page load and on every manual refresh, so
  occupancy costs no additional request.
- Inferring it from a payload length would be wrong by construction: the dashboard
  receives aggregated DTOs, never raw events (§06.5), so no client-side array
  corresponds to buffer contents.
- Occupancy belongs with the request index specifically because it **explains** that
  index: a full buffer is why older requests are absent and why some are `partial`.

The route supplies `buffer_limit` from `get_dev_monitor_event_limit()`; the analysis
function computes `buffer_used` as `len(events)` (§04.5.1).

---

## 5.2 Route implementation shape

Every handler is the same three lines. Filtering lives here; calculation does not.

```python
@router.get("/performance/waterfall/{request_id}",
            response_model=APIResponse[RequestWaterfall])
async def get_performance_waterfall(request_id: str):
    _require_dev_monitor()
    events = get_dev_monitor_sink().recent(limit=get_dev_monitor_event_limit())
    scoped = [event for event in events if event.request_id == request_id]
    if not scoped:
        raise HTTPException(status_code=404, detail=f"unknown request_id: {request_id}")
    return APIResponse(data=build_waterfall(scoped, request_id), meta=_response_meta())
```

```python
@router.get("/performance/by-ticker", response_model=APIResponse[TickerCostTable])
async def get_performance_by_ticker(
    request_id: str | None = Query(default=None),
    route: str | None = Query(default=None),
    window: int = Query(default=300, ge=1, le=3600),
):
    _require_dev_monitor()
    events = get_dev_monitor_sink().recent(limit=get_dev_monitor_event_limit())
    scoped = _filter_events(events, request_id=request_id, route=route, window=window)
    return APIResponse(data=rollup_by_ticker(scoped), meta=_response_meta())
```

`_filter_events()` is a small private helper in the route module — **not** in
`perf_analysis.py`, which must stay free of HTTP concepts (§02.3).

### 5.2.1 Filter application order

Filters apply in a **fixed order**, narrowest-scope first:

```
1. request_id   (exact match on PerformanceEvent.request_id)
2. route        (exact match on PerformanceEvent.route)
3. window       (timestamp >= now - window seconds)
```

```python
def _filter_events(
    events: list[PerformanceEvent],
    *,
    request_id: str | None = None,
    route: str | None = None,
    window: int | None = None,
) -> list[PerformanceEvent]:
    """Apply filters in the documented order: request_id, then route, then window."""
```

The order is documented because it is **not** always commutative, and future
filters could make that worse:

- `request_id` and `route` are pure conjunctive predicates — order between them
  does not change the result set.
- `window` is time-relative. Applying it *after* `request_id` means a specific
  request older than the window is **excluded**. That is deliberate: `window`
  bounds the aggregate views to recent activity, and a caller asking for both a
  specific request and a window is asking for their intersection, not for
  `request_id` to override.
- Any filter that is **selective rather than conjunctive** — a top-N, a sample, a
  "slowest request only" — would produce different results depending on where it
  sits in the chain. Fixing the order now means such a filter must state its
  position explicitly rather than inheriting an accidental one.

Rule for adding a filter: append it to the end of the chain unless it is
selective, in which case its position must be argued for in this section and
covered by a test asserting the order.

**Note on `window` and `request_id` together:** callers wanting a specific request
regardless of age should omit `window`. The `waterfall/{request_id}` endpoint takes
no `window` parameter for exactly this reason — inspecting a named request must
never depend on how long ago it ran.

### `recent()` limit note

`recent()` currently clamps to `self._recent_limit` (`dev_monitor.py:140`). With the
limit raised to 20,000 (§03.7), analysis endpoints pass the configured limit rather
than the 500 cap used by `/performance/recent`. The existing event-list endpoints
keep their 500 cap — they are a live tail, not an analysis source.

---

## 5.3 Frontend client

Extends `apps/web/lib/devMonitor.ts`, which already hand-mirrors `PerformanceEvent`
and exposes `fetchPerformanceRecent` / `Slow` / `Errors` / `Summary`. Following the
established pattern rather than introducing a second one.

```typescript
// apps/web/lib/devMonitor.ts — additions

export interface SpanNode { /* mirrors §04.6 */ }
export interface CollapsedNode { collapsed_count: number; total_ms: number; deepest_scope: string; }
export interface RequestIndex { requests: RequestSummaryRow[]; limit: number; }
export interface RequestWaterfall { /* … */ }
export interface TickerCostTable { /* … */ }
export interface ScopeBreakdown { /* … */ }
export interface CacheReport { /* … */ }

export async function fetchPerformanceRequests(limit = 50): Promise<RequestIndex>
export async function fetchPerformanceWaterfall(requestId: string): Promise<RequestWaterfall>
export async function fetchPerformanceByTicker(opts?: {
  requestId?: string; route?: string; window?: number;
}): Promise<TickerCostTable>
export async function fetchPerformanceBreakdown(requestId?: string): Promise<ScopeBreakdown>
export async function fetchPerformanceCache(window?: number): Promise<CacheReport>
```

Discriminating `SpanNode` from `CollapsedNode` in `children[]`: `CollapsedNode` has
`collapsed_count`, `SpanNode` does not. A type guard in the renderer.

**These fetchers must not pass `monitor:`** to `fetchApi`. Instrumenting the
performance dashboard's own requests would inject events into the buffer being
analyzed — the analysis tool polluting its own dataset. The existing
`fetchPerformance*` functions already omit it; the new ones follow.

---

## 5.4 `packages/shared-types` — noted, not fixed

`guideline/sop/file-structure.md` requires updating `packages/shared-types` when
frontend-consumed API schemas change. That package exists (`corporate.ts`,
`portfolio.ts`, `generated/portfolio.ts`, `generated/portfolio.schema.json`) but
**nothing in `apps/web` imports it** — no reference in `apps/web/package.json` or
`apps/web/tsconfig.json`.

The SOP describes an intent the codebase does not currently honor. This spec follows
actual practice (types declared in `apps/web/lib/devMonitor.ts`) and leaves the gap
alone. Whether that package is live or dead deserves its own decision, out of scope
here.

---

## 5.5 Acceptance checks for this section

- [ ] All five endpoints return 404 with `MONEYVIEW_DEV_MONITOR` unset.
- [ ] All five return 200 + empty DTO on an empty buffer.
- [ ] `waterfall/{unknown}` returns 404.
- [ ] `limit`, `window` out of range → 422.
- [ ] Each handler calls its analysis function exactly once, with pre-filtered
      events (assert via patch).
- [ ] `_filter_events` lives in the route module, not `perf_analysis.py`.
- [ ] Filters apply in the documented order: `request_id` → `route` → `window`.
- [ ] A request older than `window` is excluded even when its `request_id` is given.
- [ ] `waterfall/{request_id}` accepts no `window` and resolves regardless of age.
- [ ] `RequestIndex` carries `buffer_used` and `buffer_limit`, sourced from
      `len(events)` and `get_dev_monitor_event_limit()`.
- [ ] No new fetcher in `devMonitor.ts` passes `monitor:` to `fetchApi`.
- [ ] Existing `/performance/recent|slow|errors|summary` behavior unchanged.
