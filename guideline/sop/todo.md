# Development Todo

Purpose: track the active MoneyView financial-logic remediation plan, with DCF correctness as the first priority.

Status snapshot: as of 2026-05-21, the active work is the Financial Logic Remediation plan from `guideline/sop/suggestion.md`. The previous MoneyView Dev Monitor track is preserved as archived context because its core observability foundation is already present.

Planning sources:
- `guideline/sop/suggestion.md` - primary critique and remediation source.
- `guideline/sop/finance-logic.md` - finance modeling standards.
- `guideline/sop/file-structure.md` - ownership boundaries.
- `docs/dcf-valuation.md` - DCF user-facing explanation.
- `docs/risk-return-minard.md` - Risk-Return Minard calculation and limitations.

Legend:
- `[ ]` not started
- `[x]` completed
- Track status should be updated as implementation progresses.

## Active Track - Financial Logic Remediation

Principles:
- Intrinsic valuation must be derived from cash flows, discount rates, terminal value, and the enterprise-to-equity bridge.
- `current_price` may be used for upside/downside comparison only; it must not drive intrinsic DCF value.
- Do not hide missing bridge inputs behind market-price-scaled fallbacks.
- Keep reusable financial formulas in `packages/core_finance`.
- Keep backend valuation orchestration in `apps/api/services`.
- Keep frontend logic focused on display, state, and explicit quality labels.

### Phase 1 - DCF Intrinsic Value Integrity

- [x] Add reusable equity-bridge helpers:
  - `equity_value = enterprise_value - net_debt + non_operating_assets`
  - `intrinsic_value_per_share = equity_value / diluted_shares_outstanding`
- [x] Remove the market-price-dependent DCF summary formula based on `current_price`, `dcf_multiple`, `baseline_multiple`, and `fcff_scale`.
- [x] Keep `current_price` only as comparison context for `upside_pct` and status.
- [x] Add explicit DCF bridge fields to the API contract:
  - `enterprise_value`
  - `equity_value`
  - `intrinsic_value_per_share`
  - `net_debt`
  - `non_operating_assets`
  - `diluted_shares_outstanding`
  - `valuation_method`
  - `bridge_quality`
- [x] Preserve `estimated_value` as a backwards-compatible alias:
  - intrinsic per-share value when the share bridge is available
  - enterprise value fallback when the share bridge is unavailable
- [x] Mark missing bridge data explicitly with `bridge_quality = "missing"`.
- [x] Update corporate comparison DCF logic so it no longer multiplies by current market price.
- [x] Update frontend labels from generic backend fair value toward intrinsic DCF value.
- [x] Add regression tests proving DCF value does not depend on current price.
- [x] Add regression tests for explicit enterprise-to-equity bridge math.

### Phase 2 - DCF Data Completeness

- [ ] Source net debt, non-operating assets, and diluted share count from Yahoo statement/profile data where available.
- [ ] Add quality metadata for each bridge input so the UI can distinguish primary, estimated, and missing values.
- [ ] Decide whether ESG/governance risk should adjust WACC, cash-flow scenarios, or remain diagnostic-only.
- [ ] Add a WACC versus terminal-growth sensitivity table for terminal-value concentration risk.

### Phase 3 - Risk-Return Minard Remediation

- [ ] Rename `npv` to a scenario-return label in frontend data structures and chart copy.
- [ ] Rename `successProbability` to a scenario score unless a calibrated probability model is introduced.
- [ ] Move any decision-relevant financial scoring out of `apps/web` and into backend or shared finance logic.
- [ ] Replace arbitrary segment constants with documented scenario assumptions or remove the pseudo-quantitative segment model.

## Active Track - Performance Instrumentation (sub-project 1 of 4)

Design spec: `docs/superpowers/specs/2026-07-25-perf-instrumentation/`

Goal: measure where time actually goes across the four reported slow surfaces
before optimizing anything. Changes no application behavior.

Context established 2026-07-25: the watchlist holds 138 tickers over 120,647 price
rows, and `/corporate/comparison` and `/portfolio/attribution` both fan out serially
across all of them. The telemetry substrate already exists (span trees, per-statement
SQL timing, cache events, JSONL persistence) but is aggregated into six scalars and
otherwise discarded. The JSONL write path costs 199.9 us/event, so buffering is a
precondition for per-ticker spans rather than an optimization.

- [x] Buffered event sink + `flush()` + failure policy (spec 03)
- [x] Span context contextvar + `closes_span_id` pairing (spec 03)
- [x] Six fan-out wrap sites + response bytes (spec 03)
- [x] Ring buffer limit 2,000 -> 20,000, env-configurable (spec 03)
- [x] Pure analysis functions + DTOs (spec 04)
- [x] Five analysis endpoints (spec 05)
- [x] `/dev/performance` dashboard (spec 06)
- [x] Test matrices (spec 07)
- [x] Baseline runner + ranked bottleneck report (spec 08)
- [x] **A trustworthy baseline run** — `docs/perf/2026-07-27-baseline.md`, committed.
      Validated before reading: one process only, zero rate limits, and no negative
      overheads. Earlier attempts were void (three concurrent runs, then a Yahoo rate
      limit); see `ERROR-LOG.md`.

Headline findings so far (all recorded in `ERROR-LOG.md`):
- The statement cache scores a structural **0% hit rate** (0 hits / 539 misses):
  `ttl=300s` is shorter than one 138-ticker sweep and `maxsize=48` is smaller than the
  139-ticker universe. Either alone forces it. So every `mode=live` comparison performs
  ~966 sequential Yahoo round trips and discards all of it. Leading candidate for S2.
- Instrumentation defects the baseline exposed and that are now fixed: request-level
  spans were unparented (423 roots in one request), `page_load.*` terminals were never
  paired, and `partial` flagged every duration-less event.
- Hand-off to sub-project 2: `docs/superpowers/specs/2026-07-27-data-acquisition-design.md`.

## Active Track - Performance Report Review (2026-07-27)

### Resolved 2026-07-27 (post-review)

- [x] `overlap_detected` cleared, so **criterion 2 measures something for the first
      time**. Two same-interval span pairs caused it, not one: the server-side
      `page_load` span (a URL-prefix label sharing `process_time` with
      `api.request_complete`), and `cache.populate`, which was emitted in a `finally`
      *after* the fetch and so became a sibling of the span it timed rather than its
      parent. Verified: scope percentages now sum to 100.0% where they summed to 162.9%.
- [x] `/dev/monitor` Page-Load Timelines panel removed, grid collapsed so Metric Timing
      is not stranded in the narrow column.
- [x] Dev routes no longer record their own traffic (spec 06.9).
- [x] Dashboards reachable: `run MoneyView -DevMonitor`, with URLs in the startup banner.

**Baseline regenerated 2026-07-27 (post-fix).** 4 of 5 scenarios now report
`overlap_detected: False`, where all 5 were True before; every overhead is positive, so
criterion 1 is a valid measurement on all five. `single_stock_detail` still overlaps, but
marginally: its scopes sum to **100.3%**, not the 162.9% the structural duplication
produced. That residue is a different and much smaller class -- most likely a child span
measuring fractionally longer than its parent's window rather than two spans sharing an
interval -- and is unresolved.

**New finding, unresolved.** With overlap gone, `tab_switch` shows `api` self time at
**91.3%** and `db` at 8.7%. Criterion 2 passes because that time is attributed to the
`api` scope rather than to `unattributed`, but it means ~9/10 of the request happens
inside the handler with no child span naming it. Spec 08.4's guidance for a blind spot
is another span, not a published conclusion -- so sub-project 2 should not treat the
current attribution as sufficient for deciding what to optimise.


Reviewer feedback on `docs/perf/2026-07-27-baseline.md`, prioritised by the reviewer.
Verdict: no fundamental flaws; these close the gap to a professional performance report.

Two root causes underlie the three high-priority items, which makes them cheaper than
they look:
- **Cache events carry no duration** -> items 1 and 3. Zero-duration `cache.hit` spans
  carry a ticker, so 139 tickers enter the per-stock rollup contributing 0 ms, dragging
  p50 to 0.0 and inflating cv to 11.8.
- **Parent spans are counted as work** -> item 2, and the `overlap_detected` flag.
  `page_load.*` measures the same interval as `api.request_*`, so scope percentages sum
  past 100% (162.9% on `comparison_138`).

### Must fix

- [x] 1a. `cache.populate` status + `CacheRow.fills`; `cache_effectiveness` takes fill
      cost from populate spans, not from the miss event (which times *detection*)
- [x] 1b. Emit `cache.populate` with duration at both `market_data` fill sites
- [x] 1c. Emit `cache.populate` on the statement-bundle fill path
- [x] 2. Rank **leaf** spans in criterion 5, not parents — parents trace, leaves optimise
- [x] 3. Renamed to "Attributed self-time per ticker", with a line reporting how many
      tickers carry measured cost. End-to-end per-ticker latency remains future work.

### Should fix

- [x] 4. Explain `overlap_detected` in the report — currently unreadable as good or bad
- [x] 5. Add variability: std dev, MAD, 95% CI alongside p50/p95/N
- [x] 6. One sentence on why overhead varies 1%-17%: it scales with emitted span count,
      not request duration
- [x] 7. Report emitted event/span counts, which is what makes an overhead % legible

### Nice to have

- [ ] 8. Flamegraph (SVG)
- [x] 9. Compare against the previous baseline — trend beats absolute numbers. Reads a
      `YYYY-MM-DD-baseline.json` sidecar rather than re-parsing the markdown, and warns
      when the environment differs (spec 08.4.1 header parity).
- [ ] 10. Separate CPU from wait time within `external.*` spans
- [x] 11. Total emitted spans per scenario — covered by item 7's
      `emitted N events / M spans (K per iteration)` line.
- [x] 12. **Critical path** — done, and promoted out of "nice to have" because the span
      tree already carried `offset_ms` and durations, so it cost far less than its tier
      suggested. Renders between "Top spans" and "Per ticker" as the reviewer proposed.
      Descends into the longest child at each level rather than summing siblings, since
      overlapping siblings do not each add to elapsed time. Reports the slowest request
      rather than an average path, which would be a chain no request actually took.

### Explicitly not changing

- [x] Keep the long "Measurement conditions" disclaimer. The reviewer called it out as
      exactly the disclosure that makes a benchmark trustworthy. Do not trim it.

Deferred to sub-projects 2-4: on-demand loading, UI/UX redesign, stock-add
availability pre-check. The per-ticker cache is deliberately part of #2, so it lands
with a measured before/after.

## Active Track - Data Acquisition (sub-project 2 of 4)

Design spec: `docs/superpowers/specs/2026-07-27-data-acquisition-design.md`
Phase 1 plan: `docs/superpowers/plans/2026-07-27-data-acquisition-phase1.md`

Goal: reusable acquisition machinery — boundary-based freshness, an `acquisition_state`
table, a registry, and a runner — so daily bars arrive incrementally instead of being
re-downloaded on the read path. Freshness asks *"have I asked since the last boundary?"*,
never *"do I hold a bar dated >= X"*: the latter can never be satisfied on a market
holiday or for a delisted ticker, which is the existing refetch-storm bug.

### Phase 1 - complete 2026-07-27 (commits 981acc1..95c3739)

- [x] Task 1 — UTC `Daily` boundary primitive, validated at construction
- [x] Task 2 — `acquisition_state` table, accessors, `AcquisitionStatus` StrEnum
- [x] Task 3 — the boundary-based freshness rule
- [x] Task 4 — backfill (10y) versus delta range planning
- [x] Task 5 — yfinance range fetch and corporate-action probe, injected for tests
- [x] Task 6 — data-class registry (`equity_bars`, `index_bars`)
- [x] Task 7 — the runner: decide, plan, fetch, persist, record
- [x] Task 8 — watchlist add schedules a backfill; remove retires the subject
- [x] `pytest tests/api/acquisition` — 48 passed
- [x] `pytest tests/api -q` — 6 failed / 259 passed, the six pre-existing failures only

Two defects were caught in review before the phase closed, both recorded in
`ERROR-LOG.md`: the add-trigger fired on every *edit* of the upsert route (N concurrent
live fetches per bulk allocation change), and retiring a ticker stamped `last_checked_at`,
which silently suppressed re-acquisition on a same-day re-add.

**Not in Phase 1, by decision:** statements, macro rates, news and valuation ratios;
a scheduled warmer (so `index_bars` is declared but never acquired yet); replacing the
read path — `market_data.get_stock_ohlcv` still serves reads exactly as before.
Phase 2/long-term deferrals are tabled at the end of the plan with their reasoning.

## Archived Track - MoneyView Dev Monitor

Completed basis retained from the previous active plan:
- [x] `apps/api/core/middleware.py` assigns `request.state.request_id` and returns the `X-Request-ID` response header.
- [x] `apps/api/core/middleware.py` logs request completion and request failure with method, path, status, duration, client IP, and request ID.
- [x] `apps/api/core/transport_progress.py` logs truthful known-size and SSE transport progress.
- [x] `apps/api/core/logger.py` writes readable console lines and persistent JSON logs to `data/cache/logs/api-server.log` unless `API_LOG_PATH` overrides the path.
- [x] `apps/api/routes/diagnostic.py` exposes a local log-tail diagnostic endpoint for existing API log visibility.
- [x] `docs/architecture/api-transport-observability.md` documents the request and transport logging behavior.
