# 08 — Baseline Runner & Success Criteria

`scripts/benchmark_scenarios.py`, modeled on the existing
`scripts/benchmark_compute_hop.py` (warm-up call, N iterations, `statistics` for
percentiles) and covered by the existing `tests/api/test_benchmark_scripts.py`
pattern.

---

## 8.1 Purpose

Produce the deliverable: **a ranked, numbered bottleneck report** for each of the
four reported slow surfaces, reproducible enough that sub-project #2 can prove its
optimizations worked.

The runner consumes the **same public analysis functions** the routes use
(`build_waterfall`, `rollup_by_ticker`, `breakdown_by_scope`,
`cache_effectiveness`). A report and the dashboard therefore cannot disagree,
because there is exactly one implementation of every calculation.

---

## 8.2 Scenarios

Each maps to a reported symptom (§01.1).

| Scenario | Symptom | Exercises | N |
| --- | --- | --- | --- |
| `portfolio_page_load` | S1 | the 4 mount queries: `/portfolio/watchlist`, `/corporate/companies`, `/portfolio/watchlist/sync-status`, `/portfolio/preferences` | 20 |
| `comparison_138` | S2 | `GET /corporate/comparison?mode=live`, full 138-ticker universe | 10 |
| `attribution_138` | S2 | `POST /portfolio/attribution`, 138 tickers, stored weights, 5y | 10 |
| `single_stock_detail` | S4 | `/corporate/metrics/{t}`, `/history`, `/quarterly-statements`, `/audit` for one ticker | 20 |
| `tab_switch` | S3 | the route sequence behind a tab change (market → portfolio → corporate) | 20 |

N is lower for the fan-out scenarios because each run is expensive; 10 iterations
still gives a usable p50 and a rough p95.

### Fixed inputs

Scenarios read the **real** watchlist (138 tickers) rather than a fixture. Measuring
against a 3-ticker fixture would measure a different program (§01.2). The runner
records the watchlist size and DB row counts in the report header so a later run
against a changed dataset is not silently compared.

`comparison_138` uses `mode=live` deliberately — `mode=snapshot` may return a cached
snapshot and would measure the cache, not the fan-out. Both are worth recording;
live is the one that exposes the bottleneck.

---

## 8.3 Two-pass measurement

Every scenario runs **twice**:

| Pass | `MONEYVIEW_DEV_MONITOR` | Yields |
| --- | --- | --- |
| A | unset | true uninstrumented cost |
| B | `true` | instrumented cost + full span data |

```
overhead_pct = (p50_B - p50_A) / p50_A × 100
```

This is the only honest way to state the overhead figure — deriving it from the
difference rather than assuming instrumentation is free. Pass A also gives the
baseline that sub-project #2 must beat.

The runner calls `sink.flush()` before reading any persisted events (§03.4), or it
would measure a truncated file.

Warm-up: one untimed call per scenario before each pass, matching the existing
`benchmark_compute_hop.py` pattern, so cold SQLite page cache and lazy imports do
not distort the first sample.

---

## 8.4 Success criteria

| # | Criterion | Measured by | Failure meaning |
| --- | --- | --- | --- |
| 1 | **Overhead ≤ 3%** of uninstrumented time, per scenario | pass A vs. pass B | measurement is untrustworthy; report says so rather than publishing inflated numbers |
| 2 | **`unattributed_ms` ≤ 15% of root**, per scenario | `ScopeBreakdown` | instrumentation has a blind spot; the next span goes there |
| 3 | **No orphans, no `partial` flags**, per scenario | `RequestWaterfall` | the 20,000 buffer is undersized for the real workload |
| 4 | **Two consecutive runs agree within 10% at p50** | back-to-back runs | the baseline cannot prove an optimization worked, making the spec pointless |
| 5 | **Ranked bottleneck report** naming, with numbers, the top contributors per surface, plus each fan-out's `distribution` | the report itself | — |

**Criterion 5 is the deliverable. 1–4 exist to make it trustworthy.**

Criterion 2 deserves emphasis: it is the quality bar for the instrumentation itself.
If we cannot account for 85% of a request's time, we do not yet know where time
goes, and the correct response is another span — not a published conclusion.

---

## 8.5 Report format

Written to `docs/perf/YYYY-MM-DD-baseline.md`, committed.

```markdown
# Performance Baseline — 2026-07-25

## Environment
watchlist: 138 tickers · stocks: 120,647 rows · moneyview.db: 27 MB
event limit: 20,000 · compute mode: in_process
git: <sha>

## Overhead (criterion 1)
| scenario             | p50 off | p50 on  | overhead |
| comparison_138       | 3,180ms | 3,271ms |    2.9% ✅ |
...

## Scenario: comparison_138
p50 3,180 ms · p95 3,410 ms · N=10

### Scope breakdown (self time)
| scope       | self_ms | pct  |
| db          |   1,570 | 46%  |
| calculation |   1,058 | 31%  |
| external    |     307 |  9%  |
| unattributed|     273 |  8%  ✅ (criterion 2: ≤15%)

### Per-stock cost
138 tickers · distribution: uniform (cv 0.09)
p50 18.2 ms · p95 24.1 ms · max 31.0 ms
outliers (>p95): 7

### Top spans by self time
| operation                    | self_ms | count | per-call |
| db.select_corporate_metrics  |     892 |   138 |   6.5 ms |
| ticker.price                 |     418 |   138 |   3.0 ms |
...

### Diagnostics
orphans: 0 ✅ · partial: false ✅ · truncated: false · overlap_detected: false

## Ranked bottlenecks (criterion 5)
1. db.select_corporate_metrics — 892 ms (28% of request), 138 calls, uniform
   → structural fix indicated (batching or per-ticker memoization)
2. ...

## Reproducibility (criterion 4)
run 1 p50 3,180 ms · run 2 p50 3,244 ms · delta 2.0% ✅
```

Every criterion is stamped ✅/❌ in the report so pass/fail is not a judgment call.

---

## 8.6 Runner structure

```python
# scripts/benchmark_scenarios.py

SCENARIOS: dict[str, Scenario]          # name → callable + N

def run_pass(scenario, *, instrumented: bool, iterations: int) -> PassResult
def collect_events(request_id: str) -> list[PerformanceEvent]   # sink, post-flush
def analyse(events) -> dict             # calls the SAME public analysis functions
def render_report(results) -> str       # markdown
def main(argv) -> int                   # writes docs/perf/<date>-baseline.md
```

Usage:

```
python scripts/benchmark_scenarios.py                 # all scenarios
python scripts/benchmark_scenarios.py comparison_138  # one scenario
python scripts/benchmark_scenarios.py --iterations 5
```

Exit code is non-zero if any of criteria 1–4 fail, so the runner is usable as a
gate later without modification.

---

## 8.7 What the report feeds

The `distribution` classification per fan-out is the hand-off to sub-project #2:

| Result | Sub-project #2 starts from |
| --- | --- |
| `uniform` | a **structural** fix — per-ticker memoization, batched queries, or parallelism. The per-stock table is not worth reading row by row. |
| `skewed` | the named outlier tickers — bad data, missing statements, or a slow fallback path for specific stocks. |
| `mixed` | both, ranked by the top-spans table. |

This is why the classification lives in the backend rather than in a histogram
someone interprets by eye (§04.8): the conclusion survives as an assertion, not as a
memory.

---

## 8.8 Acceptance checks for this section

- [ ] Runner executes all five scenarios end to end.
- [ ] Both passes run; overhead derived from the difference, not assumed.
- [ ] `flush()` called before reading persisted events.
- [ ] Warm-up call precedes each timed pass.
- [ ] Report written to `docs/perf/` with every criterion stamped ✅/❌.
- [ ] Runner uses the public analysis functions — no duplicated calculation.
- [ ] Non-zero exit when criteria 1–4 fail.
- [ ] Report header records watchlist size, DB row counts, and git sha.
