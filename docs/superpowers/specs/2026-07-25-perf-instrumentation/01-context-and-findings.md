# 01 — Context & Measured Findings

Evidence gathered 2026-07-25. Every number here was measured on this machine against
the real database, not estimated. Later sections depend on these figures; if the
workload changes materially, re-measure before trusting the design decisions.

---

## 1.1 Reported symptoms

Four surfaces reported slow, plus two cross-cutting concerns:

| # | Symptom | Maps to scenario |
| --- | --- | --- |
| S1 | Portfolio page first load | `portfolio_page_load` |
| S2 | Running an analysis (attribution / comparison) | `comparison_138`, `attribution_138` |
| S3 | Switching between tabs | `tab_switch` |
| S4 | Selecting a single stock | `single_stock_detail` |
| S5 | Calculation speed | scope `calculation` in every scenario |
| S6 | Disk read/write speed | scope `db` in every scenario |

No measurement existed for any of them prior to this spec.

---

## 1.2 Workload scale

Queried directly from `data/processed/moneyview.db`:

| Quantity | Value |
| --- | --- |
| `watchlist` rows | **138** |
| …with non-zero weight | **138** (all real positions) |
| `watchlist` groups | `total` 133, `custom` 4, `browser` 1 |
| `stocks` rows | **120,647** |
| Distinct tickers in `stocks` | 140 |
| Bars per ticker (mean) | ~862 |
| Price history span | 2021-04-08 → 2026-07-24 |
| `corporate_comparison_snapshots_v3` | 750 |
| `corporate_metrics` | 44 |
| `indicators` | 59,722 |
| `indices` | 17,354 |
| `news` | 564 |
| Database file size | **27 MB** |

**Implication.** This is not a toy dataset. `/corporate/comparison` and
`/portfolio/attribution` each fan out across 138 tickers, and every reported slow
surface sits downstream of one of those fan-outs. Any measurement performed against
a 3-ticker fixture would be measuring a different program.

---

## 1.3 The fan-out, precisely

`apps/api/services/corporate_comparison.py:287`

```python
rows: list[CorporateComparisonRow] = []
for row in universe_rows:                      # 138 iterations
    ticker = str(row["ticker"] or "").upper().strip()
    if not ticker:
        continue
    metrics = metrics_loader(ticker)           # DB read, uninstrumented per-ticker
    dcf = _dcf_snapshot(                       # calls price_loader(ticker) internally
        ticker=ticker,
        metrics=metrics,
        price_loader=price_loader,
        ...
    )
    rows.append(CorporateComparisonRow(...))
```

Serial. No batching. No per-ticker memoization.

**Critical structural property:** `metrics_loader` and `price_loader` are
**injected callables** (`corporate_comparison.py:52-53`), supplied by the route:

| Call site | Loaders |
| --- | --- |
| `apps/api/routes/corporate.py:112` | `_metrics_for_ticker`, `_latest_market_price` |
| `apps/api/routes/corporate.py:169` | same |
| `apps/api/routes/corporate.py:196` | same |
| `apps/api/routes/corporate.py:293` | `_metrics_for_ticker`, `current_price_loader` |
| `apps/api/routes/corporate.py:313` | same |

This means per-ticker instrumentation requires **zero edits to the fan-out logic** —
wrapping the two loader functions covers all five call sites at once. See §03.5.

The equivalent seam on the attribution side is
`apps/api/services/portfolio/data_provider.py:51` (`load_close_series`).

---

## 1.4 Instrumentation that already exists

This was the biggest surprise of the investigation: the raw signal is largely
already collected and then discarded.

| Capability | Location | State |
| --- | --- | --- |
| `PerformanceEvent` model | `apps/api/models/schema_parts/dev_monitor.py:38` | 12 scopes, `request_id`, `parent_id`, `ticker`, `table`, `provider`, `component`, `duration_ms`, `metadata` |
| `perf_timer()` context manager | `apps/api/core/dev_monitor.py:324` | times, yields mutable metadata, emits on exit, re-raises original exception |
| Per-statement SQL timing | `apps/api/services/db.py:85` (`InstrumentedCursor`) | duration, table, row count — **every** statement |
| Cache hit/miss events | `emit_cache_event`, `dev_monitor.py:266` | component, ticker, duration |
| `parent_id` population | `apps/api/core/middleware.py:111` | span trees **already recorded** |
| Ring buffer + JSONL persistence | `dev_monitor.py:120-201` | 2,000 events; daily JSONL; 7-day retention |
| SSE live stream | `apps/api/routes/dev_monitor.py:27` | `events_after(sequence)` |
| Client-side event ingress | `apps/api/routes/dev_monitor.py:75` | `fetchApi` monitor → `/performance/client-event` |
| Env gate | `is_dev_monitor_enabled()`, `dev_monitor.py:27` | `MONEYVIEW_DEV_MONITOR=true`, off by default |

Existing emit-site coverage by scope:

```
metric        7        page_load     3
external      5        api           3
calculation   5        db            1  (InstrumentedCursor — covers all SQL)
                       cache         1  (emit_cache_event — covers all caches)
                       data_quality  1
```

Existing caches (all `cachetools.TTLCache`, all already emitting hit/miss):

| Cache | Location | TTL |
| --- | --- | --- |
| Attribution results | `services/portfolio/cache_service.py:20` | 180 s |
| Report payloads | `services/portfolio/cache_service.py:21` | 180 s |
| Yahoo statements | `services/corporate_statement_metrics.py:31` | env |
| Provider fetches | `services/market_data.py:120` | env |

**Note for sub-project #2:** caching exists at *whole-request* granularity. The
138× inner loop is uncached. That is a candidate fix, deliberately out of scope
here — see §01.7.

---

## 1.5 Gaps this spec closes

1. **No aggregation.** `/dev/performance/summary` returns six scalars
   (`active_requests`, `avg_api_latency_ms`, `p95_api_latency_ms`, `slow_operations`,
   `errors`, `cache_hit_rate`). The recorded `parent_id` tree is never assembled into
   a waterfall, per-ticker rollup, or scope breakdown. The data is collected and
   thrown away.
2. **No data volume.** Nothing records payload bytes or per-stock data footprint.
   Symptom S5/S6 have no signal behind them today.
3. **JSONL is write-only.** `_append_jsonl` writes; nothing ever reads back. No
   cross-session baseline exists, so no optimization can be proven to have worked.
4. **Fan-out is dark.** The 138× loops emit nothing at ticker granularity.
5. **`cache_hit_rate` is a single global number** mixing four unrelated caches —
   near-meaningless as a diagnostic.
6. **The persistence write path is itself a bottleneck** — see §01.6.

---

## 1.6 Measured costs

Method: construct a representative `PerformanceEvent` (per-ticker span with
`rows`, `series_points`, `bytes`, `cache_state`, `fanout_index` metadata), then
measure serialization, write, and read paths.

| Measurement | Result |
| --- | --- |
| Event serialized (JSON) | **577 bytes** |
| Event in memory (`tracemalloc`) | **~1.7 KB** (1,722 B — indicative, drifts with fields) |
| Write: open/write/close per event (**current behavior**) | **199.9 µs/event** |
| Write: single fd, batched | **4.1 µs/event** |
| **Write speedup from buffering** | **49×** |
| Read + `model_validate_json` | 8.5 µs/event |
| Read + `json.loads` only | 5.2 µs/event |

### 1.6.1 Why buffering is a precondition, not an optimization

One `/corporate/comparison` at 138 tickers emits roughly:

```
138 × (metrics span + price span + ~3 underlying db events) ≈ 690 events
```

At the current unbuffered cost:

```
690 events × 199.9 µs = 138 ms of pure telemetry overhead
```

Against a 3% overhead budget, the request would have to take **4.6 seconds** before
that were acceptable. Buffered, the same instrumentation costs **2.8 ms**, which
fits a 3% budget for anything taking longer than ~95 ms.

**Conclusion:** per-ticker spans cannot be added until the write path is buffered.
Doing otherwise would corrupt the measurement with the act of measuring.

### 1.6.2 Ring buffer sizing

| Option | Cost |
| --- | --- |
| In-memory 2,000 events (current) | 3.3 MB — **one comparison consumes ~35%; three requests evict the first** |
| In-memory 20,000 events (chosen) | **33 MB**, query cost single-digit ms |
| Small buffer + read JSONL per query | 120 ms (light) → 300 ms (typical) → **1.2 s (heavy)** *per panel refresh* |

The JSONL-read option additionally grows monotonically through the day (7-day
retention does not shrink *today's* file) and forces a blocking `flush()` before
every read, coupling the UI to the write path.

**Decision:** memory serves live queries; JSONL serves offline baselines only.

---

## 1.7 Scope boundary

The original request covered four independent projects. This spec is **#1**.

| # | Sub-project | Status | Depends on |
| --- | --- | --- | --- |
| **1** | **Perf truth-finding + perf view** | **this spec** | — |
| 2 | On-demand loading (fetch-per-stock, tab switching) | deferred | #1's findings |
| 3 | UI/UX redesign | deferred | loosely #2 |
| 4 | Stock-add availability pre-check | deferred | — |

**Why the per-ticker cache is deferred to #2**, despite being a likely fix: if the
fan-out turns out to be dominated by DCF arithmetic rather than repeated SQLite
reads, a memo cache buys nothing and adds invalidation complexity. One baseline run
resolves it. If measurement confirms the hypothesis, the fix then lands with a
number attached proving it worked — which is the entire purpose of building the
baseline first.

### 1.7.1 Also noted, deliberately not fixed

- `data/processed/` contains ~90 test artifacts (`test-*.db`,
  `companies-registry.db-*`, `stock-targets.json-*`) alongside the real
  `moneyview.db`. Pre-existing clutter, unrelated to this spec.
- `packages/shared-types` exists but nothing in `apps/web` imports it, contradicting
  `guideline/sop/file-structure.md`. See §05.4.
- `apps/web/app/portfolio/page.tsx` is 2,728 lines. Relevant to sub-project #3.

---

## 1.8 What was ruled out

Worth recording so it is not re-investigated:

- **"The web view loads all data at once"** — partly false. `portfolio/page.tsx`
  fires 4 queries on mount (`watchlist`, `companies`, `sync-status`, `preferences`),
  but the expensive analyses are already gated behind `enabled:` plus explicit
  refresh tokens (`page.tsx:1149`, `:1175`, `:1222`). Corporate is already
  per-selected-ticker (`page.tsx:274`, `:290`, `:308`). The problem is **fan-out
  width**, not eager fetching of every panel.
- **A brand-new telemetry system** — unnecessary. The event model, timing helper,
  SQL instrumentation, cache instrumentation, persistence, and live stream all
  already exist. This spec adds aggregation, per-ticker granularity, data volume,
  and a buffered write path.
