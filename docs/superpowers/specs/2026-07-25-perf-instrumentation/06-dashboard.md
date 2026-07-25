# 06 — Dashboard

New route `apps/web/app/dev/performance/page.tsx`, sibling to the existing
`apps/web/app/dev/monitor/page.tsx`.

**Why a separate page rather than a tab on the existing one:**

| Page | Question | Behavior |
| --- | --- | --- |
| `/dev/monitor` | "What is happening right now?" | live SSE stream, auto-scrolling event log |
| `/dev/performance` | "Where is time spent in *this* run?" | static analysis of a selected request |

Different jobs. The existing monitor works and is not rewritten.

---

## 6.1 Component reuse — no new primitives

Everything composes from the existing kit in `apps/web/components/ui/` and
`apps/web/components/charts/`:

`PageHeader` · `Card` · `SectionHeader` · `KPIBlock` · `DenseTable<T>` ·
`FilterBar` · `ToggleGroup` · `StatusBadge` · `InfoTooltip` · `Sparkline` ·
`EmptyState` · `ErrorState` · `LoadingState` · `ChartPanelFrame`

Plus the 84 CSS custom properties in `apps/web/app/globals.css`
(`--text-primary`, `--text-muted`, `--state-error`, `--state-warning`, …).
Recharts 3.8 and lightweight-charts 5.1 are already installed.

### The one custom component

`SpanWaterfall` — nested spans positioned by `offset_ms` and width
`total_ms / root.total_ms`. This is a CSS/flexbox job with absolute positioning,
not a charting-library job:

- Recharts has no span-timeline primitive.
- `components/charts/AttributionWaterfall.tsx` is a **financial** waterfall
  (contribution bars stepping to a total) — same word, unrelated shape. Do not
  reuse it.

---

## 6.2 Panels — each answers exactly one question

| Panel | Question | DTO | Component |
| --- | --- | --- | --- |
| KPI row | "How bad is it?" | `RequestIndex` | `KPIBlock` ×4 |
| Request picker | "Which run am I inspecting?" | `RequestIndex` | `FilterBar` + `DenseTable` |
| Scope breakdown | "Where does time go?" | `ScopeBreakdown` | stacked bar + unattributed callout |
| Waterfall | "What is the shape of this request?" | `RequestWaterfall` | `SpanWaterfall` |
| Per-stock cost | "Which stocks are expensive?" | `TickerCostTable` | histogram + `DenseTable` |
| Cache effectiveness | "Is the cache working?" | `CacheReport` | `DenseTable` + `KPIBlock` |

One question, one DTO, one component. A panel that would answer two questions gets
split.

---

## 6.3 Layout

```
┌─ PageHeader ─────────────────────────────────────────────────────┐
│ Performance Analysis        [Refresh]  buffer 6,842 / 20,000     │
├─ KPI row ────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│ │ slowest  │ │ p95 API  │ │ unattrib │ │ cache    │              │
│ │ 3,412 ms │ │ 890 ms   │ │ 8.2%     │ │ 41% hit  │              │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘              │
├─ Request picker ─────────────────────────────────────────────────┤
│ [route filter ▾] [window ▾]                                      │
│ route                     total_ms  spans  tickers  state        │
│ ▸ /corporate/comparison    3,412      691     138   ok           │
│   /portfolio/attribution   2,180      423     138   ok           │
│   /portfolio/watchlist        34        4       0   ok           │
├─ Scope breakdown ────────────────────────────────────────────────┤
│ [███ db 46% ███][██ calculation 31% ██][█ ext 9%][ unattrib 8% ] │
│ db 1,570 ms · calculation 1,058 ms · external 307 ms · … 273 ms  │
├─ Waterfall ──────────────────────────────────────────────────────┤
│ api.request                    ████████████████████████  3,412   │
│   fanout.comparison             ███████████████████████  3,301   │
│     ticker.metrics AAPL          ██                         21   │
│       db.select_corporate_metrics █                         12   │
│     ticker.price AAPL            █                           7   │
│     ⋯ 27 spans collapsed · 340 ms                                │
├─ Per-stock cost ─────────────────────────────────────────────────┤
│ 138 tickers · 2,847 ms total    uniform (cv 0.09)                │
│ p50 18.2 ms   p95 24.1 ms   max 31.0 ms                          │
│ [▁▂▃▅▇▇▇▅▃▂▁]                                                    │
│ Outliers (>p95): 7 tickers  ▸ expand                             │
│ Full table ▸                                                     │
├─ Cache effectiveness ────────────────────────────────────────────┤
│ component                hits  misses  rate   avg miss  saved    │
│ portfolio.attribution_cache 12       4  75%     412 ms   4,944ms │
│ market.provider_fetch      308     138  69%      31 ms   9,548ms │
└──────────────────────────────────────────────────────────────────┘
```

### 6.3.1 Where the header's buffer figure comes from

`buffer 6,842 / 20,000` is read from **`RequestIndex.buffer_used` and
`RequestIndex.buffer_limit`** on the `/performance/requests` response (§05.1.1).

It is **not** inferred client-side. The dashboard never receives raw events
(§06.5), so no array it holds corresponds to buffer contents — any figure derived
from a payload length would be measuring the DTO, not the buffer.

The header is the right place for it because occupancy is the *precondition* for
trusting everything below: a full buffer is why older requests are missing from the
picker and why some are flagged `partial`. When `buffer_used >= buffer_limit`, the
header adds a `StatusBadge` reading "buffer full — older events evicted", which is a
diagnostic state, not an error (§06.7).

---

## 6.4 Per-stock panel: distribution first, not rank first

The obvious design — a sortable 138-row table — answers the wrong question first.

Every ticker in a fan-out runs the **same code path**, so there are two regimes
calling for opposite fixes:

| Regime | Looks like | Finding | Fix |
| --- | --- | --- | --- |
| **Uniform** (`cv < 0.15`) | all 138 cost ~20 ms | "138 × 20 ms, evenly" | **structural**: caching, batching, parallelism |
| **Skewed** (`cv > 0.5`) | 130 cost 5 ms, 8 cost 400 ms | those 8 tickers | **per-stock**: bad data, missing statements, fallback path |

A ranked table in the uniform regime shows 138 nearly identical rows and hides the
insight entirely.

So the panel leads with the backend `distribution` classification (§04.8), then the
percentile summary, then the histogram, then outliers, and only then the full table
— collapsed by default.

**138 rows needs no virtualization.** `DenseTable` renders that fine; collapsing the
full table is a readability decision, not a performance one.

Outliers are defined as `self_ms > p95`, expanded inline as `DenseTable` rows.

---

## 6.5 The dashboard must not become the thing it measures

**Raw events never cross the wire.** Every endpoint returns a server-aggregated DTO:

| Payload | Approx size |
| --- | --- |
| `TickerCostTable` | 138 rows |
| `ScopeBreakdown` | ~12 rows |
| `RequestIndex` | 50 rows |
| `RequestWaterfall` | ≤ 2,000 spans (capped, §04.10) |
| ~~raw events~~ | ~~20,000 × 577 B = 11 MB~~ — never sent |

**Auto-refresh is off by default.** `/dev/monitor` streams because its job is
watching. This page inspects a *specific* run; background repolling would churn the
ring buffer and change the data mid-analysis. A manual `[Refresh]` control in the
header re-fetches all panels.

**The dashboard's own requests are not instrumented** (§05.3) — no `monitor:` on its
fetchers, so the analysis tool does not pollute its own dataset.

---

## 6.6 Panel interaction

**The request picker drives all panels. Panels do not cross-filter.**

Selecting a row in the picker sets `request_id` for the waterfall, scope breakdown,
and per-stock panels. Clicking a ticker does *not* filter the waterfall; clicking a
scope does *not* filter anything.

This is a deliberate non-goal. Ticker→waterfall highlighting is the obvious v2 and
is cheap to add once someone actually wants it; building it now adds cross-panel
state for a need nobody has demonstrated.

---

## 6.7 States

### Instrumentation disabled

`MONEYVIEW_DEV_MONITOR` unset → every endpoint 404s. The page renders `EmptyState`:

> **Instrumentation disabled**
> Set `MONEYVIEW_DEV_MONITOR=true` and restart the API server.

Not `ErrorState`. The existing monitor page already has `isNotFoundError()`
(`app/dev/monitor/page.tsx:38`) for exactly this distinction — reuse it.

### Empty buffer

200 with empty DTOs → `EmptyState`: "No requests recorded yet. Exercise the app,
then refresh."

### Diagnostic states

`partial`, `truncated`, `clock_skew`, `orphaned`, `overlap_detected` are
**diagnostic states, not errors** — they describe the *measurement*, not a failure
of the system under measurement.

| Flag | Rendering |
| --- | --- |
| `partial` | `StatusBadge` variant `stale` on the affected panel: "partial — some spans evicted" |
| `truncated` | inline note on the waterfall: "truncated at 2,000 spans" |
| `clock_skew` | subtle marker on the affected bar + tooltip |
| `orphaned` | span grouped under "orphaned spans" with a tooltip |
| `overlap_detected` | note beside unattributed: "spans overlapped (concurrent execution)" |

Never error styling. Never hidden.

### Genuine failure

Network error or 500 → `ErrorState` with retry, matching the existing monitor page.

---

## 6.8 Accessibility

- All visual encodings carry textual values. The histogram shows counts; the stacked
  bar shows labelled milliseconds and percentages; the waterfall shows numeric
  durations beside every bar.
- No information is conveyed by color alone — diagnostic states pair color with a
  `StatusBadge` label or icon.
- `DenseTable` sort controls are keyboard-reachable (existing component behavior).

---

## 6.9 Acceptance checks for this section

- [ ] Page renders `EmptyState` (not `ErrorState`) when the flag is off.
- [ ] Page renders `EmptyState` on an empty buffer.
- [ ] Every panel renders from fixture DTOs without a backend.
- [ ] No new UI primitive was created except `SpanWaterfall`.
- [ ] `CollapsedNode` renders as "⋯ N spans collapsed · X ms", never as absence.
- [ ] `partial` / `truncated` surface visibly on the affected panel.
- [ ] Per-stock panel shows distribution + percentiles + histogram **before** the
      table, with the table collapsed by default.
- [ ] Auto-refresh is off; `[Refresh]` re-fetches all panels.
- [ ] Dashboard fetchers emit no performance events of their own.
- [ ] Header buffer figure reads `RequestIndex.buffer_used` / `buffer_limit`, never
      a client-side array length.
- [ ] `buffer_used >= buffer_limit` shows the "buffer full" badge as a diagnostic
      state, not an error.
- [ ] All five diagnostic states render with non-error styling (§07.4.1).
