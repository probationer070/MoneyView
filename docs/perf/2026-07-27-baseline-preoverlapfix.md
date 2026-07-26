# Performance Baseline — 2026-07-27

## Environment
watchlist: 139 tickers · stocks: 65093 rows · db: 10.7 MB
event limit: 20000 · compute mode: in_process
git: 10f3600

## Measurement conditions
Three in-process conditions, disclosed here because they change what is being
measured, and two reports are only comparable if these match (spec 08.2):

- **OHLCV freshness frozen** (`_rows_are_fresh` and `_rows_cover_period` forced true):
  cached price rows are served without a live yfinance refetch. Without this, a stale
  local dataset makes every request refetch the whole universe, measuring network
  latency and delisted-ticker 404s instead of the DB+compute fan-out. Production, on
  current daily data, takes the frozen path.
- **Global rate limiter neutralised**: the runner fires bursts no real user would, and
  429s would otherwise truncate a scenario partway through.
- **A discarded priming pass runs before pass A.** Process-level state (the statement
  cache, SQLite page cache, lazily imported modules) outlives a single pass, so without
  priming whichever pass ran first paid first-touch costs the later ones inherited warm.
  That biased the overhead comparison enough to produce negative percentages. A residual
  ordering effect may remain, which is why a negative overhead is now stamped INVALID
  rather than PASS.
- **Statement cache TTL raised to 86400s** (default 300s) **and maxsize to
  4096** (default 48), so the untimed warm-up's 138 live Yahoo fetches survive into
  the timed iterations. At the defaults the cache scores a measured **0% hit rate** on this
  fan-out, for two independent reasons: one 138-ticker sweep takes ~357s so ticker #1
  expires before #138 is fetched, and maxsize 48 < 139 tickers so the sweep evicts its own
  first 90 entries anyway. Without both raised the timed samples measure Yahoo network
  latency, not the DB+compute fan-out. **Production still runs the defaults**, so the p50
  below is the warm-cache cost and is NOT what a user experiences today -- see ERROR-LOG.md.

## Overhead (criterion 1: <= 3%)
| scenario | p50 off | p50 on | overhead | |
| --- | --- | --- | --- | --- |
| portfolio_page_load | 524.3ms | 608.0ms | 16.0% | FAIL |
| comparison_138 | 53475.7ms | 54062.5ms | 1.1% | PASS |
| attribution_138 | 510.1ms | 608.5ms | 19.3% | FAIL |
| single_stock_detail | 51.3ms | 58.5ms | 14.0% | FAIL |
| tab_switch | 754.7ms | 843.9ms | 11.8% | FAIL |

**Why overhead varies so widely between scenarios:** instrumentation cost scales
with the number of spans emitted, not with request duration. A short request that
emits thousands of spans pays a far larger percentage than a long one that emits few.
Read each row against its span count below before concluding anything about the code.

## Scenario: portfolio_page_load
p50 608.0 ms · p95 663.0 ms · N=20
mean 615.9 ms · stdev 22.6 ms · MAD 12.8 ms · 95% CI [606.0, 625.8] ms
emitted 8760 events / 8620 spans (431 spans per iteration)

### Scope breakdown (self time) — criterion 2: unattributed <= 15%
| scope | self_ms | pct |
| --- | --- | --- |
| page_load | 11921.0 | 98.4% |
| db | 625.1 | 5.2% |
| api | 186.9 | 1.5% |
| cache | 0.0 | 0.0% |
| unattributed | 0.0 | 0.0% | PASS

### Top spans by self time
_`parent` rows are for tracing, not optimisation: a parent's self time is only what its children did not account for. See the ranked bottlenecks below, which use leaves._
| operation | kind | self_ms | count | per-call | pct of request |
| --- | --- | --- | --- | --- | --- |
| page_load.portfolio | leaf | 11921.0 | 60 | 198.7 ms | 98.4% |
| db.select_stocks | leaf | 602.7 | 2780 | 0.2 ms | 5.0% |
| api.request_start | parent | 186.9 | 80 | 2.3 ms | 1.5% |
| db.select_watchlist | leaf | 16.2 | 80 | 0.2 ms | 0.1% |
| db.select_portfolio_preferences | leaf | 2.2 | 20 | 0.1 ms | 0.0% |
| db.select_corporate_companies | leaf | 2.0 | 20 | 0.1 ms | 0.0% |
| db.select_dataset_metadata | leaf | 2.0 | 20 | 0.1 ms | 0.0% |
| cache.lookup | leaf | 0.0 | 2780 | 0.0 ms | 0.0% |
| cache.hit | leaf | 0.0 | 2780 | 0.0 ms | 0.0% |

### Critical path (slowest request)
_Self time says where CPU goes; the critical path says what determines latency. They differ wherever work overlaps — concurrent fetches can hold little CPU yet dominate elapsed time. This is the chain that has to get shorter for the request to get faster._
slowest request: 638.8 ms

api.request_start — 638.8 ms · 100% of request
  └─ page_load.portfolio — 638.8 ms · 100% of request

### Attributed self-time per ticker
_Self time attributed to spans carrying a ticker — not end-to-end latency for that stock. A ticker whose work happens inside spans that carry no ticker will read as 0.0 ms here._
139 tickers · distribution: uniform (cv 0.0)
p50 0.0 ms · p95 0.0 ms · max 0.0 ms
outliers (>p95): 0
**0 of 139 tickers carry measured self time**; the other 139 appear only in zero-duration events, which is what pulls the median toward 0.0 and inflates cv. Not an instrumentation failure, but the percentiles above are not a per-stock cost distribution.

### Cache effectiveness
| component | hits | misses | hit_rate | avg_miss_ms | est. saved_ms |
| --- | --- | --- | --- | --- | --- |
| market_data.ohlcv | 2780 | 0 | 1.0 | 0.0 | 0.0 |

_Every `avg_miss_cost_ms` is 0.0 because cache miss events carry no `duration_ms`: the miss cost and the time saved are **unmeasured, not zero**. The hit and miss counts above are real. Timing the miss path is the next span._

### Diagnostics
orphans: 0 · partial: False · truncated: False · overlap_detected: True — criterion 3: PASS
reproducibility delta 0.8% — criterion 4: PASS
**`overlap_detected: True` is bad here, and it invalidates criterion 2.** It means children's self time sums past their parent's duration, so the scope percentages above exceed 100%. The cause is that `page_load.*` spans measure the *same interval* as `api.request_*` while being nested under them, double-counting the whole request. Because spec 04.7 forces `unattributed_ms = 0` whenever overlap is detected, criterion 2 prints PASS while the true figure is not computable. Recorded in ERROR-LOG.md; not yet fixed.

## Scenario: comparison_138
p50 54062.5 ms · p95 62997.5 ms · N=10
mean 56019.0 ms · stdev 3738.3 ms · MAD 188.0 ms · 95% CI [53702.0, 58336.0] ms
emitted 12620 events / 12590 spans (1259 spans per iteration)

### Scope breakdown (self time) — criterion 2: unattributed <= 15%
| scope | self_ms | pct |
| --- | --- | --- |
| page_load | 560157.0 | 100.0% |
| external | 517571.8 | 92.4% |
| calculation | 42167.6 | 7.5% |
| db | 286.9 | 0.1% |
| metric | 0.2 | 0.0% |
| api | 0.0 | 0.0% |
| cache | 0.0 | 0.0% |
| unattributed | 0.0 | 0.0% | PASS

### Top spans by self time
_`parent` rows are for tracing, not optimisation: a parent's self time is only what its children did not account for. See the ranked bottlenecks below, which use leaves._
| operation | kind | self_ms | count | per-call | pct of request |
| --- | --- | --- | --- | --- | --- |
| page_load.corporate_comparison | leaf | 560157.0 | 10 | 56015.7 ms | 100.0% |
| external.fetch_quote | leaf | 517571.8 | 1400 | 369.7 ms | 92.4% |
| ticker.price | parent | 26309.0 | 1400 | 18.8 ms | 4.7% |
| ticker.metrics | parent | 14882.8 | 1400 | 10.6 ms | 2.7% |
| fanout.comparison | parent | 738.4 | 10 | 73.8 ms | 0.1% |
| calculation.dcf_upside | parent | 237.4 | 1400 | 0.2 ms | 0.0% |
| db.select_corporate_metrics | leaf | 144.5 | 1400 | 0.1 ms | 0.0% |
| db.select_watchlist | leaf | 136.8 | 1300 | 0.1 ms | 0.0% |
| db.select_corporate_comparison_snapshots_v3 | leaf | 2.3 | 20 | 0.1 ms | 0.0% |
| db.select_stocks | leaf | 2.2 | 10 | 0.2 ms | 0.0% |

### Critical path (slowest request)
_Self time says where CPU goes; the critical path says what determines latency. They differ wherever work overlaps — concurrent fetches can hold little CPU yet dominate elapsed time. This is the chain that has to get shorter for the request to get faster._
slowest request: 63139.5 ms

api.request_start — 63139.5 ms · 100% of request
  └─ page_load.corporate_comparison — 63139.5 ms · 100% of request

### Attributed self-time per ticker
_Self time attributed to spans carrying a ticker — not end-to-end latency for that stock. A ticker whose work happens inside spans that carry no ticker will read as 0.0 ms here._
140 tickers · distribution: skewed (cv 0.7514)
p50 3628.7 ms · p95 4325.8 ms · max 39110.7 ms
outliers (>p95): 7

### Cache effectiveness
| component | hits | misses | hit_rate | avg_miss_ms | est. saved_ms |
| --- | --- | --- | --- | --- | --- |
| corporate_statement_bundle | 1400 | 0 | 1.0 | 0.0 | 0.0 |
| market_data.ohlcv | 10 | 0 | 1.0 | 0.0 | 0.0 |

_Every `avg_miss_cost_ms` is 0.0 because cache miss events carry no `duration_ms`: the miss cost and the time saved are **unmeasured, not zero**. The hit and miss counts above are real. Timing the miss path is the next span._

### Diagnostics
orphans: 0 · partial: False · truncated: False · overlap_detected: True — criterion 3: PASS
reproducibility delta 0.2% — criterion 4: PASS
**`overlap_detected: True` is bad here, and it invalidates criterion 2.** It means children's self time sums past their parent's duration, so the scope percentages above exceed 100%. The cause is that `page_load.*` spans measure the *same interval* as `api.request_*` while being nested under them, double-counting the whole request. Because spec 04.7 forces `unattributed_ms = 0` whenever overlap is detected, criterion 2 prints PASS while the true figure is not computable. Recorded in ERROR-LOG.md; not yet fixed.

## Scenario: attribution_138
p50 608.5 ms · p95 620.8 ms · N=10
mean 614.0 ms · stdev 14.1 ms · MAD 4.6 ms · 95% CI [605.3, 622.7] ms
emitted 4290 events / 4250 spans (425 spans per iteration)

### Scope breakdown (self time) — criterion 2: unattributed <= 15%
| scope | self_ms | pct |
| --- | --- | --- |
| page_load | 6058.7 | 100.0% |
| db | 318.8 | 5.3% |
| calculation | 9.4 | 0.2% |
| api | 0.0 | 0.0% |
| cache | 0.0 | 0.0% |
| unattributed | 0.0 | 0.0% | PASS

### Top spans by self time
_`parent` rows are for tracing, not optimisation: a parent's self time is only what its children did not account for. See the ranked bottlenecks below, which use leaves._
| operation | kind | self_ms | count | per-call | pct of request |
| --- | --- | --- | --- | --- | --- |
| page_load.portfolio | leaf | 6058.7 | 20 | 302.9 ms | 100.0% |
| db.select_stocks | leaf | 313.7 | 1390 | 0.2 ms | 5.2% |
| calculation.portfolio_attribution | parent | 9.4 | 10 | 0.9 ms | 0.2% |
| db.select_watchlist | leaf | 5.1 | 20 | 0.3 ms | 0.1% |
| api.request_start | parent | 0.0 | 20 | 0.0 ms | 0.0% |
| cache.lookup | leaf | 0.0 | 1390 | 0.0 ms | 0.0% |
| cache.hit | leaf | 0.0 | 1400 | 0.0 ms | 0.0% |

### Critical path (slowest request)
_Self time says where CPU goes; the critical path says what determines latency. They differ wherever work overlaps — concurrent fetches can hold little CPU yet dominate elapsed time. This is the chain that has to get shorter for the request to get faster._
slowest request: 638.8 ms

api.request_start — 638.8 ms · 100% of request
  └─ page_load.portfolio — 638.8 ms · 100% of request

### Attributed self-time per ticker
_Self time attributed to spans carrying a ticker — not end-to-end latency for that stock. A ticker whose work happens inside spans that carry no ticker will read as 0.0 ms here._
139 tickers · distribution: uniform (cv 0.0)
p50 0.0 ms · p95 0.0 ms · max 0.0 ms
outliers (>p95): 0
**0 of 139 tickers carry measured self time**; the other 139 appear only in zero-duration events, which is what pulls the median toward 0.0 and inflates cv. Not an instrumentation failure, but the percentiles above are not a per-stock cost distribution.

### Cache effectiveness
| component | hits | misses | hit_rate | avg_miss_ms | est. saved_ms |
| --- | --- | --- | --- | --- | --- |
| market_data.ohlcv | 1390 | 0 | 1.0 | 0.0 | 0.0 |
| portfolio.attribution_cache | 10 | 0 | 1.0 | 0.0 | 0.0 |

_Every `avg_miss_cost_ms` is 0.0 because cache miss events carry no `duration_ms`: the miss cost and the time saved are **unmeasured, not zero**. The hit and miss counts above are real. Timing the miss path is the next span._

### Diagnostics
orphans: 0 · partial: False · truncated: False · overlap_detected: True — criterion 3: PASS
reproducibility delta 0.1% — criterion 4: PASS
**`overlap_detected: True` is bad here, and it invalidates criterion 2.** It means children's self time sums past their parent's duration, so the scope percentages above exceed 100%. The cause is that `page_load.*` spans measure the *same interval* as `api.request_*` while being nested under them, double-counting the whole request. Because spec 04.7 forces `unattributed_ms = 0` whenever overlap is detected, criterion 2 prints PASS while the true figure is not computable. Recorded in ERROR-LOG.md; not yet fixed.

## Scenario: single_stock_detail
p50 58.5 ms · p95 62.1 ms · N=20
mean 58.7 ms · stdev 2.4 ms · MAD 1.7 ms · 95% CI [57.7, 59.8] ms
emitted 680 events / 520 spans (26 spans per iteration)

### Scope breakdown (self time) — criterion 2: unattributed <= 15%
| scope | self_ms | pct |
| --- | --- | --- |
| page_load | 938.7 | 100.0% |
| calculation | 162.5 | 17.3% |
| metric | 87.9 | 9.4% |
| db | 4.1 | 0.4% |
| api | 0.0 | 0.0% |
| cache | 0.0 | 0.0% |
| data_quality | 0.0 | 0.0% |
| unattributed | 0.0 | 0.0% | PASS

### Top spans by self time
_`parent` rows are for tracing, not optimisation: a parent's self time is only what its children did not account for. See the ranked bottlenecks below, which use leaves._
| operation | kind | self_ms | count | per-call | pct of request |
| --- | --- | --- | --- | --- | --- |
| page_load.corporate_metrics | leaf | 938.7 | 80 | 11.7 ms | 100.0% |
| ticker.metrics | parent | 158.5 | 20 | 7.9 ms | 16.9% |
| metric.roic | leaf | 44.4 | 20 | 2.2 ms | 4.7% |
| metric.metric_audit | parent | 30.8 | 20 | 1.5 ms | 3.3% |
| metric.growth | leaf | 12.7 | 20 | 0.6 ms | 1.4% |
| db.select_corporate_metrics | leaf | 4.1 | 40 | 0.1 ms | 0.4% |
| calculation.roic_minus_wacc | leaf | 4.0 | 20 | 0.2 ms | 0.4% |
| api.request_start | parent | 0.0 | 80 | 0.0 ms | 0.0% |
| cache.lookup | leaf | 0.0 | 80 | 0.0 ms | 0.0% |
| cache.hit | leaf | 0.0 | 80 | 0.0 ms | 0.0% |

### Critical path (slowest request)
_Self time says where CPU goes; the critical path says what determines latency. They differ wherever work overlaps — concurrent fetches can hold little CPU yet dominate elapsed time. This is the chain that has to get shorter for the request to get faster._
slowest request: 25.3 ms

api.request_start — 25.3 ms · 100% of request
  └─ page_load.corporate_metrics — 25.3 ms · 100% of request

### Attributed self-time per ticker
_Self time attributed to spans carrying a ticker — not end-to-end latency for that stock. A ticker whose work happens inside spans that carry no ticker will read as 0.0 ms here._
1 tickers · distribution: uniform (cv 0.0)
p50 250.4 ms · p95 250.4 ms · max 250.4 ms
outliers (>p95): 0

### Cache effectiveness
| component | hits | misses | hit_rate | avg_miss_ms | est. saved_ms |
| --- | --- | --- | --- | --- | --- |
| corporate_statement_bundle | 80 | 0 | 1.0 | 0.0 | 0.0 |

_Every `avg_miss_cost_ms` is 0.0 because cache miss events carry no `duration_ms`: the miss cost and the time saved are **unmeasured, not zero**. The hit and miss counts above are real. Timing the miss path is the next span._

### Diagnostics
orphans: 0 · partial: False · truncated: False · overlap_detected: True — criterion 3: PASS
reproducibility delta 0.2% — criterion 4: PASS
**`overlap_detected: True` is bad here, and it invalidates criterion 2.** It means children's self time sums past their parent's duration, so the scope percentages above exceed 100%. The cause is that `page_load.*` spans measure the *same interval* as `api.request_*` while being nested under them, double-counting the whole request. Because spec 04.7 forces `unattributed_ms = 0` whenever overlap is detected, criterion 2 prints PASS while the true figure is not computable. Recorded in ERROR-LOG.md; not yet fixed.

## Scenario: tab_switch
p50 843.9 ms · p95 991.7 ms · N=20
mean 856.2 ms · stdev 75.1 ms · MAD 65.9 ms · 95% CI [823.3, 889.1] ms
emitted 9180 events / 9080 spans (454 spans per iteration)

### Scope breakdown (self time) — criterion 2: unattributed <= 15%
| scope | self_ms | pct |
| --- | --- | --- |
| page_load | 16727.5 | 98.7% |
| db | 1794.8 | 10.6% |
| api | 210.5 | 1.2% |
| cache | 0.0 | 0.0% |
| unattributed | 0.0 | 0.0% | PASS

### Top spans by self time
_`parent` rows are for tracing, not optimisation: a parent's self time is only what its children did not account for. See the ranked bottlenecks below, which use leaves._
| operation | kind | self_ms | count | per-call | pct of request |
| --- | --- | --- | --- | --- | --- |
| page_load.portfolio | leaf | 12519.6 | 20 | 626.0 ms | 73.9% |
| page_load.market_overview | leaf | 4207.9 | 20 | 210.4 ms | 24.8% |
| db.select_indices | leaf | 1127.8 | 180 | 6.3 ms | 6.7% |
| db.select_stocks | leaf | 645.4 | 2780 | 0.2 ms | 3.8% |
| api.request_start | parent | 210.5 | 60 | 3.5 ms | 1.2% |
| db.select_watchlist | leaf | 19.3 | 80 | 0.2 ms | 0.1% |
| db.select_corporate_companies | leaf | 2.3 | 20 | 0.1 ms | 0.0% |
| cache.lookup | leaf | 0.0 | 2960 | 0.0 ms | 0.0% |
| cache.hit | leaf | 0.0 | 2960 | 0.0 ms | 0.0% |

### Critical path (slowest request)
_Self time says where CPU goes; the critical path says what determines latency. They differ wherever work overlaps — concurrent fetches can hold little CPU yet dominate elapsed time. This is the chain that has to get shorter for the request to get faster._
slowest request: 754.3 ms

api.request_start — 754.3 ms · 100% of request
  └─ page_load.portfolio — 754.3 ms · 100% of request

### Attributed self-time per ticker
_Self time attributed to spans carrying a ticker — not end-to-end latency for that stock. A ticker whose work happens inside spans that carry no ticker will read as 0.0 ms here._
148 tickers · distribution: uniform (cv 0.0)
p50 0.0 ms · p95 0.0 ms · max 0.0 ms
outliers (>p95): 0
**0 of 148 tickers carry measured self time**; the other 148 appear only in zero-duration events, which is what pulls the median toward 0.0 and inflates cv. Not an instrumentation failure, but the percentiles above are not a per-stock cost distribution.

### Cache effectiveness
| component | hits | misses | hit_rate | avg_miss_ms | est. saved_ms |
| --- | --- | --- | --- | --- | --- |
| market_data.ohlcv | 2960 | 0 | 1.0 | 0.0 | 0.0 |

_Every `avg_miss_cost_ms` is 0.0 because cache miss events carry no `duration_ms`: the miss cost and the time saved are **unmeasured, not zero**. The hit and miss counts above are real. Timing the miss path is the next span._

### Diagnostics
orphans: 0 · partial: False · truncated: False · overlap_detected: True — criterion 3: PASS
reproducibility delta 8.3% — criterion 4: PASS
**`overlap_detected: True` is bad here, and it invalidates criterion 2.** It means children's self time sums past their parent's duration, so the scope percentages above exceed 100%. The cause is that `page_load.*` spans measure the *same interval* as `api.request_*` while being nested under them, double-counting the whole request. Because spec 04.7 forces `unattributed_ms = 0` whenever overlap is detected, criterion 2 prints PASS while the true figure is not computable. Recorded in ERROR-LOG.md; not yet fixed.

## Ranked bottlenecks (criterion 5)
_Leaf spans only. A parent's self time is whatever its children did not account for, so ranking parents names a call tree rather than code to change._

### portfolio_page_load — fan-out distribution: uniform
1. page_load.portfolio — 11921.0 ms self across 60 calls (198.7 ms/call, 98% of request)
2. db.select_stocks — 602.7 ms self across 2780 calls (0.2 ms/call, 5% of request)
3. db.select_watchlist — 16.2 ms self across 80 calls (0.2 ms/call, 0% of request)
4. db.select_portfolio_preferences — 2.2 ms self across 20 calls (0.1 ms/call, 0% of request)
5. db.select_corporate_companies — 2.0 ms self across 20 calls (0.1 ms/call, 0% of request)
   -> structural fix indicated (batched queries, per-ticker memoization, or parallelism); the per-stock table is not worth reading row by row

### comparison_138 — fan-out distribution: skewed
1. page_load.corporate_comparison — 560157.0 ms self across 10 calls (56015.7 ms/call, 100% of request)
2. external.fetch_quote — 517571.8 ms self across 1400 calls (369.7 ms/call, 92% of request)
3. db.select_corporate_metrics — 144.5 ms self across 1400 calls (0.1 ms/call, 0% of request)
4. db.select_watchlist — 136.8 ms self across 1300 calls (0.1 ms/call, 0% of request)
5. db.select_corporate_comparison_snapshots_v3 — 2.3 ms self across 20 calls (0.1 ms/call, 0% of request)
   -> start from the named outlier tickers in the per-stock table -- bad data, missing statements, or a slow fallback path for specific stocks

### attribution_138 — fan-out distribution: uniform
1. page_load.portfolio — 6058.7 ms self across 20 calls (302.9 ms/call, 100% of request)
2. db.select_stocks — 313.7 ms self across 1390 calls (0.2 ms/call, 5% of request)
3. db.select_watchlist — 5.1 ms self across 20 calls (0.3 ms/call, 0% of request)
4. cache.lookup — 0.0 ms self across 1390 calls (0.0 ms/call, 0% of request)
5. cache.hit — 0.0 ms self across 1400 calls (0.0 ms/call, 0% of request)
   -> structural fix indicated (batched queries, per-ticker memoization, or parallelism); the per-stock table is not worth reading row by row

### single_stock_detail — fan-out distribution: uniform
1. page_load.corporate_metrics — 938.7 ms self across 80 calls (11.7 ms/call, 100% of request)
2. metric.roic — 44.4 ms self across 20 calls (2.2 ms/call, 5% of request)
3. metric.growth — 12.7 ms self across 20 calls (0.6 ms/call, 1% of request)
4. db.select_corporate_metrics — 4.1 ms self across 40 calls (0.1 ms/call, 0% of request)
5. calculation.roic_minus_wacc — 4.0 ms self across 20 calls (0.2 ms/call, 0% of request)
   -> structural fix indicated (batched queries, per-ticker memoization, or parallelism); the per-stock table is not worth reading row by row

### tab_switch — fan-out distribution: uniform
1. page_load.portfolio — 12519.6 ms self across 20 calls (626.0 ms/call, 74% of request)
2. page_load.market_overview — 4207.9 ms self across 20 calls (210.4 ms/call, 25% of request)
3. db.select_indices — 1127.8 ms self across 180 calls (6.3 ms/call, 7% of request)
4. db.select_stocks — 645.4 ms self across 2780 calls (0.2 ms/call, 4% of request)
5. db.select_watchlist — 19.3 ms self across 80 calls (0.2 ms/call, 0% of request)
   -> structural fix indicated (batched queries, per-ticker memoization, or parallelism); the per-stock table is not worth reading row by row
