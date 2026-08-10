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

### Phase 2 - DCF Data Completeness (items 1-3 complete 2026-08-03)

Plan: `.superpowers/sdd/2026-08-03-dcf-data-completeness/`. Full rationale and worked
extraction rules are recorded in `docs/dcf-valuation.md` (`Where the bridge inputs
come from`, `Units: everything in billions`, `Bridge input quality`, `ESG and
governance stay diagnostic-only`) -- this entry is the pointer, not the duplicate.

- [x] Source net debt, non-operating assets, and diluted share count from Yahoo
      statement/profile data where available. `apps/api/services/equity_bridge.py`
      (`load_equity_bridge`) reads the local statement bundle only -- it acquires
      nothing, so metric computation stays network-free. `net_debt = Total Debt -
      Cash` (falling back to Yahoo's own `Net Debt` line); `non_operating_assets =
      Investments And Advances` (falling back to `Long Term Equity Investment`);
      `diluted_shares_outstanding = Diluted Average Shares` (falling back to
      `info["sharesOutstanding"]`). Everything is divided by `1e9` at read time so
      `equity_value / diluted_shares_outstanding` yields dollars per share with no
      further scaling. Wired into both `corporate_dcf._build_dcf_outputs` (a request
      value still wins, reported `source="request"`) and
      `corporate_comparison._dcf_snapshot`, replacing the hardcoded
      `net_debt=0.0`/`intrinsic_value=current_price` placeholders there.
- [x] Add quality metadata for each bridge input so the UI can distinguish primary,
      estimated, and missing values. `BridgeSource` and `BridgeInputMeta` (`value`,
      `source`, `quality`, `as_of`) in `apps/api/models/schema_parts/corporate.py`.
      `bridge_quality` on `DCFSummary`, `DCFFullReport`, and
      `CorporateComparisonRow` is the worst of the three input qualities. Added a
      `bridge_quality` column to `corporate_comparison_snapshots_v3` (guarded `ALTER
      TABLE`, defaults to `''` for pre-existing rows); `average_dcf_value` and
      `average_expected_return_spread` now exclude `bridge_quality = 'missing'` rows,
      `average_roic_minus_wacc` stays unfiltered. `METRIC_SCHEMA_VERSION` 1 -> 2.
- [x] Decide whether ESG/governance risk should adjust WACC, cash-flow scenarios, or
      remain diagnostic-only. **Decision: diagnostic-only, and it must stay that
      way.** `esg_penalty`/`governance` are a hash of `f"{ticker}:{sector}"`
      (`corporate_metrics_service.py:145-146`), not a measured input --
      `agency_discount` (`corporate_dcf.py:154`) is derived from that hash, reported
      in `DCFFullReport`, and never multiplied into a valuation output. Wiring either
      into WACC or cash-flow scenarios would let renaming a ticker move its intrinsic
      value. Enforced by `test_esg_penalty_moves_no_valuation_output` in
      `tests/api/test_corporate_dcf_bridge.py`, not left to memory. Revisit only if
      ESG becomes a real acquisition data class with a measured source.

  Three problems were identified closing this phase; two shipped as defects and
  are recorded in `ERROR-LOG.md` (2026-08-03), one was caught in design and never
  shipped:
  - `Total Debt`/`Net Debt` had been read as an alias pair in three sites in
    `corporate_statement_metrics.py`, understating `debt_ratio` and every WACC
    weight derived from it (`_gross_debt_map` now recovers gross debt as `Net
    Debt + cash` only where `Total Debt` itself is absent -- deliberately the
    gross expression, since `equity_bridge.py` reads the same two lines to
    produce *net* debt, where the cash term does cancel). Its own `ERROR-LOG.md`
    entry.
  - `_dcf_snapshot` in `corporate_comparison.py` passed
    `intrinsic_value=current_price` into the expected-return formula,
    structurally zeroing `dcf_implied_return`, `stock_expected_return`, and
    `expected_return_spread` for every row, alongside a hardcoded `net_debt=0.0`
    and a constant `"Bridge Incomplete"` status. Both lived in the same function
    and were fixed in the same change, so they share one `ERROR-LOG.md` entry
    rather than getting two. **Correction: the `status` part of that fix is
    internal only.** `CorporateComparisonRow` has no `status` field and never
    has, `_build_live_rows` does not read the key, and it is not persisted, so
    no consumer can observe the verdict `_dcf_snapshot` now computes — the
    `status` the UI renders belongs to `DCFSummary` on the single-ticker DCF
    endpoint. The observable fixes in the comparison table are `dcf_value`,
    `bridge_quality`, and the three expected-return columns.
  - The unit mismatch: `metrics.fcff` is stored in billions while balance-sheet
    figures and `sharesOutstanding` are raw, so an unscaled bridge would have been
    wrong by a factor of `1e9`. This one **never shipped** -- caught in design, so
    `equity_bridge.py` was written scaled from the start (the `_BILLION` divisor).
    Correctly has no `ERROR-LOG.md` entry: nothing to log when nothing broke.

  Also confirmed and now covered by tests in both `test_corporate_dcf_bridge.py` and
  `test_corporate_dcf_streaming.py`: the Phase 1 invariant that `current_price`
  informs `upside_pct` and `status` only, and never reaches a valuation input,
  survived Phase 2's wiring intact.

### Phase 2b - Comparison Value Honesty (complete 2026-08-05)

Plan and per-task reports: `.superpowers/sdd/2026-08-03-comparison-value-honesty/`.
Design: `docs/superpowers/specs/2026-08-03-comparison-value-honesty-design.md`.

Phase 2 made `bridge_quality` truthful. It did not stop the UI presenting the value the
flag was warning about. `dcf_value` carries an intrinsic value per share when the equity
bridge resolves and an **enterprise value in billions** when it does not, and every
presentation path treated the two as one number.

**The invariant this phase establishes:** every value displayed in the DCF column, used
for DCF sorting, or plotted against current price must be an intrinsic value per share.
An enterprise value is never presented as a per-share value. These are different
financial quantities, not one quantity at two scales — the argument holds regardless of
how close the numbers happen to fall, and does not depend on company size.

- [x] `bridgedDcfValue` in `apps/web/app/corporate/corporateDerivedViews.ts` is now the
      **only** place that decides whether a DCF value may be presented. It returns `null`
      for `bridge_quality === "missing"` and the value otherwise. A guard written
      `!== "ok"` is a defect: it would suppress `estimated` rows, whose numbers are real
      per-share values reached through a documented fallback input — the fallback affects
      confidence, not units. Every fixture in this phase carries an `estimated` row for
      exactly that reason. Reading `bridge_quality` to display the quality as its own
      labelled datum is different and remains fine (`CalculationDetailModal.tsx:478`).
- [x] Three consumers wired to it: the table cell (suppressed to an em dash, and the cell
      stays an enabled button because the modal behind it is where "why is there no value
      here" gets answered), the sort comparator, and both scatter builders.
- [x] Unbridged rows sort last in **both** directions. Not via a sentinel — `Number(null)`
      is `0`, which would bury them among genuinely small per-share values in one
      direction and place them at the far end in the other. The null check precedes the
      numeric comparison and is not reversed by the direction flag. The fixture's `MISS`
      row deliberately carries the largest `dcf_value` in the fixture so a broken
      suppression is detectable in both directions.
- [x] `metric_schema_version` reaches the frontend. The column had been stored per row
      since Phase 2 but the history query never selected it, so a client had no way to see
      that `average_dcf_value` means enterprise value before version 2 and intrinsic value
      per share from version 2 on. `MAX` over the snapshot's rows: they share a version by
      construction, and if that invariant ever breaks the newer definition should surface
      rather than a stale one masking a mixed snapshot.
- [x] The snapshot history marks the boundary rather than drawing it as a valuation move.
      Computed against the **flat points array**, not within a date group — the points
      arrive newest-first (`corporate_comparison.py:670`, `ORDER BY snapshot_date DESC`),
      so the chronologically preceding point is `points[index + 1]`, and the notice lands
      on the first point of the new definition rather than the last of the old. Older
      averages are still shown: hiding them would discard history the user deliberately
      saved and leave blanks with no explanation.

      **Amended 2026-08-05: the notice over-claimed at one of its two boundaries.** Version
      `0` is written only by the backfill at `db.py:672`, which added the column to rows
      computed before it existed. A `0 -> 1` edge therefore means the earlier definition was
      never recorded, not that it differed — and the shipped notice told the user it changed.
      That edge is not hypothetical: it is the *first* boundary on any install carrying
      pre-column history. A boundary whose preceding point is version `0` now reads "Metric
      definition before this point was not recorded, so whether values are comparable across
      it is unknown." The reverse direction is not handled because it cannot occur — `0` is
      only ever backfilled onto older rows. Recorded in `ERROR-LOG.md` (2026-08-05).

      The original spec fixed one sentence for a comparison that has three outcomes, not two:
      changed, unchanged, and unknown. Pinning wording is right; pinning it before the cases
      are enumerated is how a spec ends up mandating a false statement.

  Two things worth carrying forward, neither a defect:
  - **The plan's own test fixture could not catch the bug the plan was written to
    prevent.** It placed the version boundary *inside* a date group, where a within-group
    implementation and a flat-array one behave identically; only a boundary at a group
    *edge* distinguishes them. A fourth fixture point at a group edge was added during
    implementation and is what makes the rule genuinely covered. The lesson generalises:
    a fixture that exercises a rule is not the same as a fixture that discriminates
    against the rule's plausible wrong implementation.
  - **The date grouping is defensive against a payload the backend does not produce.**
    The history query keeps only `version_rank = 1` per `snapshot_date`, so at most one
    point per date can arrive today. The same-day half of the boundary rule is therefore
    currently unreachable. Correct and cheap, but do not read the code as evidence that
    same-day snapshots are returned.

  Recorded in `ERROR-LOG.md` (2026-08-05). It qualifies as a silent failure producing wrong
  output: the column rendered a plausible-looking dollar figure that was a different
  financial quantity, and no suite ever went red. The entry's Prevention names the general
  rule — a field whose meaning depends on another field is only safe if every consumer
  receives both, and the discriminator must land in every consumer's type in the same
  change that introduces the fallback.

- [x] **The same quantity is no longer unguarded under the name `estimated_value`.**
      (done 2026-08-05) Every render site now goes through `apps/web/lib/bridgeQuality.ts`,
      and `bridgedDcfValue` delegates to the same `isBridgeUnresolved` predicate, so the two
      field names carrying this quantity cannot diverge again.

      **The count in this item was wrong, and worth recording.** It said five sites; there
      were ten render expressions across six files. `buildCalculationDetails.ts` has three
      separate detail blocks (`backendDcf`, `dcfCoreModules`, `backendFairValue`), not the
      one the line numbers suggested, and `components/workbenches/DCFWorkbench.tsx:186` —
      "Implied Fair Value", live on `/detail/[ticker]` — was in none of the four reviews,
      because every earlier search had been scoped to `app/corporate/`.

      `upside_pct` was suppressed in the same pass. `corporate_dcf.py:224` sets it to `0.0`
      when the bridge fails, so an unbridged ticker rendered `+0.00%` in the positive colour:
      a fairly-valued reading for a comparison that never happened. It is a second fabricated
      quantity, not a presentation detail of the first.

      The raw-dataset CSV (`corporateDerivedViews.ts:208`) was left alone deliberately.
      `pushRecord` emits every key, so `bridge_quality`, `intrinsic_value_per_share`,
      `enterprise_value`, and `valuation_method` accompany `estimated_value` in the same
      `backend_dcf` block. That record carries its own discriminator, which is the condition
      the rule asks for; blanking a field there would remove information from a raw export.

      Coverage: `apps/web/tests/e2e/corporate-estimated-value-bridge.spec.ts`, 4 tests.
      Break/restore verified against both wrong implementations — a guard that never fires
      fails 3 of them, and one written `!== "ok"` fails the 2 that pin `estimated` as a real
      per-share value.

      **The generalisable lesson:** Phase 2b policed a *field name*. The defect is a
      *quantity*. Any rule of the form "this value must not be shown" has to be written
      against every field carrying that value, or it ships looking complete while half the
      surfaces still leak. The corollary this follow-up added: scope the search to the
      quantity too. Four reviews missed `DCFWorkbench.tsx` because they searched the
      directory where the bug was found rather than the repo.

- [x] `HistoryPoint` in `apps/web/app/portfolio/components/PortfolioSnapshotSummary.tsx`
      was a hand-copied duplicate of `CorporateComparisonHistoryPoint` in
      `apps/web/app/portfolio/page.tsx`. (done 2026-08-05) The component now imports the
      canonical type from `../page`, matching what `SnapshotHistoryModal.tsx:10` already
      did. The alias was dropped rather than kept: nothing outside the file referenced it,
      so it bought indirection and no callers.

- [x] Add a WACC versus terminal-growth sensitivity table for terminal-value
      concentration risk. (done 2026-08-05) `sensitivity_cell` / `sensitivity_grid` in
      `packages/core_finance/dcf.py`, carried on `DCFFullReport.sensitivity`, rendered by
      `apps/web/app/corporate/components/DcfSensitivityTable.tsx` inside the existing Full
      DCF Report section. 5x5, centred on the reported assumptions, +/-50bp and +/-100bp on
      both axes.

      **The table could not be built on the number the app was already showing.**
      `page.tsx:466` computed "Terminal Value Share" as
      `clamp(62 + growth x 1.8 - WACC x 1.2, 20, 88)` -- a linear function of two sliders,
      labelled as a ratio it never computed, with a clamp that made the readings a
      concentration metric exists to surface unreachable. The grid's centre cell would have
      contradicted the tile above it. `terminal_value_share_pct` is now measured on the
      backend as `PV(terminal) / enterprise value` and every surface reads it from there.
      Recorded in `ERROR-LOG.md` (2026-08-05).

      **Three properties the grid holds, each pinned by a test:**
      - Cells where WACC is not above terminal growth carry *no* numbers, not the service's
        `max(wacc - g, 0.005)` clamp — which would report ~200x the terminal cash flow where
        the Gordon model has no value. Reachable from ordinary inputs: terminal growth is
        clamped to at most `wacc - 0.005`, so the tightest possible centre is a 0.5pp spread
        and the axes reach 2pp past it.
      - The centre cell reproduces the reported enterprise value, to the grid's own rounding
        step. The two go through different code, and a centre that disagreed would bracket a
        valuation nobody ran.
      - Per-share values are suppressed across every cell when the bridge does not resolve,
        via the same `_bridge_to_per_share` helper the headline valuation uses. Enterprise
        value and the terminal share stay: concentration does not need a bridge.

      **A cell has two distinct absences and they render differently.** `n/a` means the
      model has no value at those assumptions — true for every ticker. `—` means this
      ticker has no equity bridge — true at every point in the grid. Collapsing them would
      report a per-ticker data gap as a property of the model.

      **Second defect found in the same pass:** the corporate page restores DCF results from
      `sessionStorage`, so adding a required field broke on payloads written by an earlier
      build (`pct(undefined)` threw and blanked the page). A required field on a type whose
      values can arrive from a cache older than the type is a runtime problem, not a typing
      one. Also in `ERROR-LOG.md`.

      Coverage: 18 tests in `tests/core_finance/test_dcf.py`, 11 in
      `tests/api/test_corporate_dcf_sensitivity.py`, 5 in
      `apps/web/tests/e2e/corporate-dcf-sensitivity.spec.ts`. Break/restore verified against
      three wrong implementations: inheriting the service clamp (6 backend failures,
      including `assert 21000.0 != 21000.0` — the fabricated value exactly), falling an
      unbridged cell back to enterprise value, and rendering both absences alike.

### Phase 3 - Risk-Return Minard Remediation

- [x] **Items 1, 2 and 4 closed together 2026-08-06 by removing the segment model**, which is
      the alternative item 4 already allowed. They are one object: `npv`, `successProbability`
      and the four segment constants were the same chart, and none of the three could be fixed
      by renaming.

      No calibrated probability model was introduced, so item 2's condition was not met and the
      score had no honest percent to show. Item 4's constants (`12`, `10`, `9`, `11`, `-18`,
      `-6`) had no rationale to document — writing one would have been fabrication. Item 1's
      `npv` sat on a percent-formatted axis over nothing projected and nothing discounted, so
      renaming the key would not have made the axis mean anything.

      What the segment model actually was: each segment's Y value was `spread` times a per-
      segment constant, and each segment's failure share was the page score plus a fixed offset,
      so the ranking across Inflation / FX / Demand / Margin was **the same for every ticker and
      every slider setting**. The category axis carried no per-category data.

      Removed: the `Success Probability` KPI card, the `failureProbability` and
      `riskReturnMinard` detail modals, `RiskReturnMinardGraph.tsx`, the `RiskReturnPoint` type,
      both `DetailKey` entries, and the `successProbability` / `failureProbability` /
      `risk_return_minard` entries in the downloadable raw dataset. The comparison table's
      `expected_return_spread` cell no longer opens the Minard modal — it had been explaining a
      slider-derived score for a backend per-ticker number.

      Nothing replaced it; the sensitivity grid, WACC curve and value driver matrix already
      cover assumption response with measured values. Full record in `ERROR-LOG.md` and
      `docs/risk-return-minard.md`; the honesty invariant is pinned by
      `apps/web/tests/e2e/corporate-probability-labels.spec.ts`.
- [x] Move any decision-relevant financial scoring out of `apps/web` and into backend or shared
      finance logic. Closed 2026-08-06 by removal, on the same reasoning as the item above:
      `agencyRisk`, `lifeCyclePosition` and `leveredBetaRiskScore` had no derivation to move —
      they were magic-constant formulas over the assumption sliders — and the `healthScore`
      they fed averaged terms in four different units. The Company Status radar scored them
      against a `peer` polygon of seven hardcoded constants, identical for every ticker, so its
      one comparison could not vary with the company on screen.

      Removed `CompanyStatusGraph.tsx`, the `companyStatus` detail modal and both key-type
      entries, `HealthRadarPoint`, the `includeSubjectiveHealth` toggle, all four `derived`
      fields, and the `company_status_radar` series from the downloadable raw dataset. Nothing
      replaced it. Full record in `ERROR-LOG.md` (2026-08-06, "hardcoded peer polygon"); the
      honesty invariant is pinned by `apps/web/tests/e2e/corporate-composite-score.spec.ts`,
      which checks the peer baseline is gone from the export as well as the dashboard.

      Also renamed `regionalMinard` to `regionalHurdle`: it survived the Minard removal as the
      Hurdle Rate Decomposition dataset and was carrying a deleted model's name.

## Active Track - Segment Build-Up Valuation (todo3 pieces 3a+3b)

Spec: `docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md`
Plan: `docs/superpowers/plans/2026-08-09-segment-buildup-valuation.md`
Source: `guideline/sop/todo3.md`

- [x] 3a Engine core - `packages/core_finance/segment_valuation.py`
- [x] 3b Persistence + API - 3 tables, 4 endpoints, both SpaceX cases seeded
- [ ] 3c Uncertainty + attribution - Monte Carlo, /fork, /diff, /pricing
- [ ] 3d UI - valuation tab

Known open: every `[V]` input is a placeholder pending SpaceX2026IPO.xlsx and
SpaceX2026IPOUpdated.xlsx. The enterprise-value gap against Damodaran's $1.21T /
$1.22T is recorded as a diagnostic, not a gate -- see spec section 1.2.

- [x] Terminal ROIC consistency remediation (2026-08-10) - an independent
      adversarial review found `roic_stable` shipped as an unconstrained input set
      3.5x below the model's own marginal return on capital, accounting for
      essentially the whole gap against the published valuation. Engine now computes
      marginal ROIC, rejects a terminal return above it, and reports both
      reinvestment rates. Four inputs that produced wrong numbers instead of errors
      now raise at construction.
      Spec: `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md`

- [x] Terminal ROIC consistency, second pass (2026-08-10) - a follow-up
      adversarial review found the first pass's remediation did not fix what it
      targeted: the guard was one-sided (only rejected a terminal ROIC *above*
      the marginal return, so the motivating defect -- `roic_stable=0.12`
      against a 0.408 marginal return -- still ran), and `marginal_roic` itself
      weighted by revenue instead of capital, overstating the firm's marginal
      return by +9.9% (post) / +7.2% (pre). Fixed: the guard is now two-sided
      (a terminal ROIC too far below the marginal return implies unmodelled
      capital intensity, capped at 60%, same as too far above); `marginal_roic`
      now weights by `revenue/sales_to_capital_late` (capital), which is the
      only weighting under which `ReinvRate = g/ROIC` is an identity; the two
      reported reinvestment rates (`terminal_reinvestment_rate` and
      `reinvestment_rate_target_year`) are now joined by a third,
      `explicit_reinvestment_rate_at_stable_growth`, struck at the same growth
      rate so the pair is actually comparable; the seed moved from a per-case
      erosion policy to one shared `roic_stable=0.33` and lowered pre-case
      sales-to-capital, bringing the pre/post EV ratio (0.978) closer to the
      source's 1.008 than the per-case policy's 0.908 was.

Still open from that review, deliberately out of scope:
- Case-level inputs carry no narrative rows, so `roic_stable` -- the most valuable
  number in the model -- cannot carry a claim in the data.
- Base-year off-by-one: the seed labels its revenues FY2025 while setting
  `base_year=2026`, making the horizon 10 where the figures imply 11 (~6% EV).
- Growth-path shape: the decaying curve makes year 1 always the fastest, so the model
  cannot express the slowed near-term growth todo3 R3 records as `[C]`.
- API lifecycle: no update or delete endpoint; structural validation fires at `/run`
  rather than `POST`; horizon is unbounded.

- [x] Margin-path year-1 alignment fix (2026-08-10) - `margin_path` returned
      `margin_1 == base_margin` exactly, todo3 P2's literal phi(1)=1, so
      improvement happened over `n-1` steps starting in year 2. But
      `revenue_path` applies a full year of growth in year 1 (todo3 R3, the
      seeded launch segment goes 4.1 -> 6.714), so a year-0 `base_margin` was
      being priced onto year-1 revenue. The seeded launch segment's year-1 loss
      widened 63% purely from the offset, ~64% of the seeded post case's
      negative explicit-period PV. Fixed: `margin_t = base_margin +
      (margin_target - base_margin) x t / n`, giving year 1 one step of margin
      convergence to match revenue's one step of growth; `t = n` is unchanged
      (`margin_target` exactly), so target-year totals (400.0/158.5 post,
      320.0/151.0 pre) are unaffected. Seeded launch year-1 margin: -10.00% ->
      -4.50%. Post case `pv_explicit`: -21.70 -> -7.91. Post EV: 1282.06 ->
      1295.86. Pre EV: 1310.9 -> 1323.66. This is a deliberate deviation from
      todo3 P2's literal shape -- see "Known divergences from the source" below.

### Known divergences from the source

1. **Near-term growth runs the wrong way.** The engine's consolidated year-1
   growth is **+55%** (both seeded cases) against todo3 section 4's *confirmed*
   2025 actual of **+33%**. todo3 R3 tags as `[C]` that Damodaran's headline
   revision was to **slow** near-term growth; this engine's single decaying-
   growth curve makes year 1 structurally the fastest year and cannot express
   that. Fixing it needs a second growth curve (an S-curve or logistic on
   market share). Also note the consolidated growth path is **not monotone
   decaying** -- year 7's growth rate exceeds year 6's in both cases (pre:
   34.7% -> 38.5%; post: 41.2% -> 45.2%) when the expansion segment's ramp
   switches on -- and that no test covers the consolidated path.

2. **`base_margin` contradicts its own documented contract.** `SegmentSpec`
   documents it as the R&D-adjusted operating margin, but the seeded values
   give a base EBIT of -0.232, close to todo3 section 4's *reported* operating
   loss of -2.57 rather than its R&D-adjusted EBITR of +4.0. So the margin path
   ramps from a reported basis to targets todo3 justifies specifically by the
   R&D adjustment.

3. **Case-level inputs carry no narrative rows.** `roic_stable` determines a
   terminal value that is ~100% of the seeded case's enterprise value, and
   across the guard's admitted band the enterprise value moves about 9.3% --
   yet it states no reason, because the narrative rule covers segment fields
   only. Closing this needs a schema change (a `case_narrative` table, or a
   nullable `segment_id` on `segment_narrative`). This is the structural form
   of the defect the terminal-ROIC remediation fixed.

No test asserts any explicit-period value against an independently computed
expectation: the confirmed-input gates in `test_segment_valuation_spacex.py`
are pure sums of the input literals and would pass against any revenue path,
margin path, tax schedule or discounting scheme provided year 10 lands on
target.

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

- [x] 8. Flamegraph (SVG) — **closed 2026-08-06 as won't-do.** It is a different view of a
      span tree the report already summarises three ways: the critical path (item 12), the
      ranked leaf spans (item 2), and per-ticker attribution (item 3). For a markdown
      report read locally, an SVG you have to open separately adds a rendering surface and
      a second thing to keep correct without adding information. Reopen if the report ever
      needs to show a shape those three cannot — heavy sibling overlap is the likely one,
      since the critical path deliberately descends the longest child rather than summing
      siblings.
- [x] 9. Compare against the previous baseline — trend beats absolute numbers. Reads a
      `YYYY-MM-DD-baseline.json` sidecar rather than re-parsing the markdown, and warns
      when the environment differs (spec 08.4.1 header parity).
- [x] 10. Separate CPU from wait time within `external.*` spans — done 2026-08-06.
      `perf_timer` records `cpu_ms` from `time.thread_time()` alongside the wall clock;
      wait is `duration_ms - cpu_ms`. The two answers point at opposite fixes: wait says
      cut round trips, CPU says the response parsing is the cost, and for a 138-ticker
      serial fan-out over yfinance that is the whole question.

      The measurement is only sound while a span owns its thread. `thread_time()` counts
      the thread, so a span wrapping an `await` would be charged for every other task the
      loop ran during the wait. Those report `cpu_ms=None` — the split excludes them and
      reports their count and elapsed time beside it, so a split covering 3 of 400 spans
      cannot be read as a statement about the workload. Folding them in at 0 CPU would
      have reported all of their time as wait, which is a claim, not a measurement.
      This track has twice shipped a metric that read green for a reason unrelated to
      what it measured; that is the trap being avoided here.

      `apps/api/core/dev_monitor.py` (`_cpu_ms_since`), `PerformanceEvent.cpu_ms`,
      `Span.cpu_ms`, `external_cpu_wait_split()`, and an "External time: CPU vs wait"
      section in the benchmark report. Nine tests, mutation-verified.
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
databases); rows that predate the column backfill to `0` (`db.py:672`), which is what
keeps them distinguishable from any real version. The `CREATE TABLE` default is `1`
(`db.py:428`), but every insert supplies the value explicitly, so that default is a
floor rather than an observed value.

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
