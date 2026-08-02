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
- [x] `pytest tests/api/acquisition` — 56 passed
- [x] `pytest tests/api -q` — 6 failed / 267 passed at the time; superseded, see the
      hermetic-test-suite track below: the baseline is now 0 failed / 274 passed

Four defects were caught in review before the phase closed, all recorded in
`ERROR-LOG.md`. Two in Task 8: the add-trigger fired on every *edit* of the upsert route
(N concurrent live fetches per bulk allocation change), and retiring a ticker stamped
`last_checked_at`, which silently suppressed re-acquisition on a same-day re-add. Two more
in the closing whole-subsystem review, both on the corporate-action path: the full refetch
started at `today - 10y` rather than at `covered_from`, so the head of the series kept the
old adjustment factor while the tail was rewritten with the new one; and `fetch_bars` left
`dividends`/`stock_splits` at their model defaults, which `INSERT OR REPLACE` then wrote
over the stored values — erasing the record of the very split that triggered the refetch.

That review also confirmed three things clean, worth not re-deriving: `_save_ohlcv_rows`
uses `INSERT OR REPLACE` against `UNIQUE(ticker, date)`, so a refetch replaces rather than
duplicates; the runner writes to the `stocks` table `get_stock_ohlcv` reads, so Phase 1
does not acquire into a void; and saving before `record_success` is the safe crash
ordering. The suite now also exercises the delta path and the production
fetcher/probe/saver defaults end-to-end, which nothing did before.

**Not in Phase 1, by decision:** statements, macro rates, news and valuation ratios;
a scheduled warmer (so `index_bars` is declared but never acquired yet); replacing the
read path — `market_data.get_stock_ohlcv` still serves reads exactly as before.
Phase 2/long-term deferrals are tabled at the end of the plan with their reasoning.

## Follow-ups - Portfolio Tile Grid and News Acquisition (2026-08-02)

Plan: `docs/superpowers/plans/2026-07-31-portfolio-tile-grid-and-news-acquisition.md`.
Branch `feat-statements-acquisition`. The plan's twelve tasks are complete. Five follow-ups
were left open at the end of the run because each needed a change outside the plan's scope;
**all five are now closed** (2026-08-02), each with a test written before the fix. The two
that were true defects keep their full write-ups in `ERROR-LOG.md`.

- [x] **`ModalShell` lost the Escape keypress when another `document` keydown listener
  closed above it.** Its effect depended on `onClose`'s identity and every caller passes an
  inline arrow, so it re-subscribed on every render; a listener re-added mid-dispatch is not
  in the DOM's snapshot for that keypress. Affected every `ModalShell` caller - it just
  needed a second overlay to become observable. Fixed in the component with a ref-held
  `onClose`, so registration depends on `open` alone. `portfolio-watchlist.spec.ts` now
  presses Escape with a rail panel open behind the modal instead of clicking Close.
- [x] **`/portfolio` scrolled 96px at the document level.** `PortfolioShell` was
  `h-[calc(100vh-4rem)]` inside an `AppShell` `<main>` padded `p-4 pt-20 lg:p-20`. `AppShell`
  now publishes that padding as `--main-pad-top` / `--main-pad-bottom` and uses those same
  variables for its own utilities, and the shell subtracts them - so the constant is gone
  rather than corrected. The spec asserts `documentElement.scrollHeight - clientHeight === 0`,
  which is what "one scrolling region" means to a user; counting scroll *containers* passed
  the whole time.
- [x] **`StockTile` nested `<div>`s inside its `<button>`.** The recorded fix - let
  `DeltaBadge` and the chart wrapper render a `<span>` - could not work: `ResponsiveContainer`
  and the chart wrapper are rendered by recharts itself, so no prop of ours reaches them.
  `DeltaBadge` is now a `<span>` (it was already `inline-flex`, so the box is unchanged) and
  the tile draws its sparkline as one inline `<svg>` (`TileSparkline`), which is phrasing
  content and needs no `ResizeObserver`. The shared recharts `Sparkline` is untouched for the
  four sites that render it in flow content. A spec counts flow elements inside the tile
  button, since a browser renders the invalid nesting perfectly and never complains.
- [x] **Two e2e specs asserted accessible names production no longer emits.** Both queries
  were wrong, not the pages. The Simulation Lab tab strip is a real tablist - `TabButton`
  renders `role="tab"` - so `getByRole("button", …)` could never match; that one helper gated
  all five `simulation-lab-price-autofill` tests, not just the one line originally noted. The
  market detail dialog is a `ModalShell`, whose close control is labelled `"Close modal"`.
- [x] **`PortfolioAllocationEditor.tsx` cloned the `PortfolioStock` type** instead of
  importing it. Replaced with `import type { PortfolioStock } from "../page"`, which is
  erased at compile time and so adds no runtime cycle; `StockTile` already did this.

## Completed Track - Hermetic Test Suite (2026-07-28)

Plan: `docs/superpowers/plans/2026-07-28-hermetic-test-suite.md`.
Spec: `docs/superpowers/specs/2026-07-28-test-suite-failures-design.md`.

**The baseline is now 0 failed / 274 passed, and must not be re-inherited.** A "6 known
failures" baseline had been carried across branches undiagnosed. Runtime dropped from 403s
to ~20s. Verified over three consecutive full runs, one reverse-file-order run, and each
formerly order-sensitive test in isolation; `data/processed/moneyview.db` mtime is unchanged
across a full run.

Three root causes, none of them the tests they were blamed on:

- **A hardcoded `E:\MoneyView` temp root.** Four tests had never executed on any machine
  without that drive — they errored in setup, so their assertions had never run at all.
  Replaced with `tmp_path` (Task 1).
- **Recursive tree walkers in `apps/api/services/perf_analysis.py`.** `_to_node`,
  `_assign_self_ms`, `_assign_offsets` and `_depth_map` are now explicit stacks, so a deep
  span tree truncates instead of raising `RecursionError` (Tasks 2-3, `ERROR-LOG.md`
  2026-07-28). **`_subtree_size` was deliberately left recursive** — it is only ever invoked
  on already-collapsed subtrees and measured depth 1 on the failing input. Do not "fix" it
  from reading the diff alone.
- **Tests sharing the developer's real database.** `tests/conftest.py::_isolated_db` is
  autouse and points `db._DB_PATH` at `tmp_path`, so a test asserting "this fetch was live"
  no longer passes or fails on machine state. The `virgin_db` marker opts out of schema
  creation only, never out of path isolation; its one legitimate use is the migration test
  in `test_corporate_comparison.py` (Tasks 4-5).

Two consequences worth knowing before touching this again:

- `MONEYVIEW_DISABLE_STARTUP_JOBS` gates `stock_prewarm_cycle` in `apps/api/main.py`'s
  lifespan -- the only job it still covers, since Task 8 deleted
  `corporate_snapshot_cycle`. It is read at call time and is
  inert unless set to `1`/`true`/`yes`, so production startup is unchanged. `wal_flush_cycle`
  is not gated. The surviving `asyncio.to_thread` prewarm worker still cannot be cancelled —
  a CPython constraint, documented rather than fixed; the real remedy is a cooperative stop
  flag inside `prewarm_configured_tickers`. `tests/api/test_startup_jobs_gate.py` covers the
  un-gated branch that the rest of the suite never takes (conftest disables startup jobs
  session-wide), including that shutdown does not block on that uncancellable worker.
- Isolating the database made cold-cache network fetches visible where a warm real database
  had hidden them. `tests/api/test_perf_capture.py` now serves the watchlist from canned
  bars: one request against an empty database emitted 3,889 dev-monitor events instead of
  440, evicting `api.request_start` from the fixed `recent(limit=N)` windows two tests read.

Known, out of scope, still open: `/dev/perf` returns 500 on a deep span tree.
`RequestWaterfall.model_dump_json()` hits pydantic's "Circular reference detected (depth
exceeded)" at a chain depth of roughly 50, and `apps/api/routes/dev_monitor.py:162` returns
that model through FastAPI. `perf_analysis` itself no longer raises `RecursionError`, but the
endpoint fails earlier for a different reason. Pre-existing and unaffected by this work.

## Completed Track - Statements Acquisition and Manual Snapshots (2026-07-29)

Design: `docs/superpowers/specs/2026-07-28-statements-acquisition-and-manual-snapshots-design.md`
Plan: `docs/superpowers/plans/2026-07-28-statements-acquisition-and-manual-snapshots.md`

Nine tasks, all committed. **Statements and market cap are now acquisition data
classes** (`"statements"` under a `Weekly` boundary, `"market_cap"` under `Daily`),
declared in `apps/api/services/acquisition/registry.py` alongside the two bar classes,
fetched via `fetch_statements`/`fetch_quote_facts` and persisted to
`corporate_statements`/`corporate_quote_facts` through `acquire_point_in_time`. **Metric
computation is network-free** -- `load_statement_bundle` reads only the local store, so
`corporate_metrics_service` never touches the network; acquisition is the only step that
does, and it only runs from the one place a network call is wanted.

**`POST /comparison/snapshot` is the one button** (`apps/api/services/corporate_comparison.py:
acquire_comparison_datasets`, wired in `apps/api/routes/corporate.py:
refresh_corporate_comparison_snapshot`): it acquires only the datasets whose freshness
boundary has expired, then computes and persists. One action, not two -- a separate
fetch button would let a snapshot be generated from statements the user forgot to
refresh. Idempotent: pressing it twice in a row does no network work the second time and
persists a new immutable row from unchanged local data.

**Snapshots are manual-only and immutable.** The scheduled daily snapshot cycle is gone;
a snapshot exists only because a user asked for one. Once persisted a snapshot row is
never updated -- `save_corporate_comparison_snapshot` always does a plain `INSERT` (never
`INSERT OR REPLACE`) against `corporate_comparison_snapshots_v3`, so a new observation is
always a new row, and a `snapshot_version` collision would raise rather than silently
overwrite history.

**`METRIC_SCHEMA_VERSION` must be bumped by hand whenever metric semantics change** -- a
formula, a fallback, an input source. It is not a database schema version and not a
payload format version; it exists so two snapshots computed by different metric code are
never silently compared as like for like. Stored per row in the new
`metric_schema_version` column (guarded `ALTER TABLE` migration for pre-existing
databases); old rows default to `1`.

- [x] **The price path no longer fetches during metric computation.** `latest_market_price`
      previously reached `get_latest_stock_price`, which tries a live `yf.Ticker().fast_info`
      quote per ticker before falling back to local OHLCV, feeding `dcf_implied_return`,
      `stock_expected_return` and `expected_return_spread`. It now calls
      `MarketDataService.get_latest_stored_price`, a direct bars-table read.
      `get_stock_ohlcv` was not usable either — it refreshes from the provider when local
      bars are stale. **Deliberate visible change: the comparison and DCF now show the last
      stored close, not a live intraday quote.** That is what makes a snapshot reproducible.
      Prices refresh when acquisition runs, not when someone opens the page. The stock price
      lookup endpoint still serves live quotes; only the metric path changed.

Deferred, not oversights:
- **A filing-aware boundary.** `Weekly` bounds statement staleness to seven days; it does
  not model each company's actual filing cadence.
- **`needs_acquisition` distinguishing `FAILED` from `EMPTY`.** A failure currently
  advances `last_checked_at`, so a transient provider error suppresses retry for a whole
  boundary window. Fixing it changes freshness for every data class, not just these two.
- **The `snapshot_version` to `snapshot_id` rename.** The field's business-date component
  is gone -- snapshots are manual, so there is no day for the old name to describe -- but
  the *name* was kept deliberately: it is a query parameter on two routes (`GET
  /comparison/snapshot-version`, `DELETE /comparison/snapshot-version`) and an identity key
  across five frontend files (`corporateTypes.ts`, `SnapshotHistoryModal.tsx`,
  `StockDetailModal.tsx`, `portfolioMetrics.ts`, `PortfolioSnapshotSummary.tsx`). The
  rename must move all seven call sites in one change or it ships a broken snapshot-history
  modal, delete flow, and stock-detail timeline.
- **`snapshot_is_stale` is now always `False`** from every backend construction site --
  manual-only snapshots have no cadence to be late for. The frontend's stale-warning
  banner (`apps/web/app/portfolio/components/PortfolioSnapshotSummary.tsx:160`,
  `apps/web/app/portfolio/portfolioMetrics.ts:198`) is therefore permanently inert. Left
  in place rather than removed: it is dead code, not misleading code, and removing it is a
  presentational decision outside this task's scope.
- **`SNAPSHOT_CADENCE = "daily_kst_0000"` is now a false statement.** Emitted on every
  snapshot response (`corporate_comparison.py:33`, used at `:132, :232, :277, :550`) and
  defaulted in the model at `schema_parts/corporate.py:238`. Snapshots are manual-only;
  there is no daily KST cadence. Unlike `snapshot_is_stale`, which is merely inert, this is
  an assertion about system behaviour that is untrue — it is only Minor because the
  frontend declares the field without rendering it. Removing it changes the API contract,
  so it belongs with the `snapshot_version` rename in one deliberate contract change.
- **The generated shared types are stale.** Dropping `snapshot_versions_for_day` from the
  backend models left `packages/shared-types/generated/portfolio.schema.json` and
  `portfolio.ts` still declaring it. Confirmed inert -- nothing in `apps/web` imports the
  corporate-comparison types from the generated file. Not regenerated here because the two
  artifacts must move together and only half can be produced offline:
  `python scripts/export_schema.py` works, but the second step
  (`npx json2ts packages/shared-types/generated/portfolio.schema.json > .../portfolio.ts`)
  needs a network install. Regenerating only the JSON would leave the pair inconsistent,
  which is worse than the current consistent staleness. The JSON regeneration also carries
  a large unrelated Pydantic-version reformatting (`allOf` wrappers and redundant `const`
  keys disappear under Pydantic 2.13), so it belongs in its own commit.

## Archived Track - MoneyView Dev Monitor

Completed basis retained from the previous active plan:
- [x] `apps/api/core/middleware.py` assigns `request.state.request_id` and returns the `X-Request-ID` response header.
- [x] `apps/api/core/middleware.py` logs request completion and request failure with method, path, status, duration, client IP, and request ID.
- [x] `apps/api/core/transport_progress.py` logs truthful known-size and SSE transport progress.
- [x] `apps/api/core/logger.py` writes readable console lines and persistent JSON logs to `data/cache/logs/api-server.log` unless `API_LOG_PATH` overrides the path.
- [x] `apps/api/routes/diagnostic.py` exposes a local log-tail diagnostic endpoint for existing API log visibility.
- [x] `docs/architecture/api-transport-observability.md` documents the request and transport logging behavior.
