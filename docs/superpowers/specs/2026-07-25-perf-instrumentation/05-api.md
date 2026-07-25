# 05 — API Surface

Extends `apps/api/routes/dev_monitor.py`. All new endpoints sit behind the existing
`_require_dev_monitor()` 404 gate (`routes/dev_monitor.py:15`) and return
`APIResponse[T]` with `_response_meta()`.

---

## 5.1 Endpoints

| Method | Path | Returns | Query params |
| --- | --- | --- | --- |
| GET | `/api/v1/dev/performance/requests` | `RequestIndex` | `limit` (1–200, default 50) |
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
- [ ] No new fetcher in `devMonitor.ts` passes `monitor:` to `fetchApi`.
- [ ] Existing `/performance/recent|slow|errors|summary` behavior unchanged.
