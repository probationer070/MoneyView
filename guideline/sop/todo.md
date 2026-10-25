# Development Todo

Purpose: track ACTIVE MoneyView work. Completed tracks are archived, not kept here.

**History:**
- **`guideline/sop/todo6.md`** holds every track through 2026-09-29 (F4, G2, I-C2,
  the implied return vs WACC (metric v3), the FCFF floor removal (metric v4), typed engine
  refusals, the backend-port boot fallback, the volume-ratio floor and the launcher
  shortcuts). It is a full snapshot of this file as it stood before this cleanup.
- **`guideline/sop/todo5.md`** holds every track through 2026-09-26 (A-L, including C2's
  Cases tab and `/pricing`, and the F2, F3, G5 and H8 fixes), with the reasoning, the
  rejected alternatives and the measured figures. It is a full snapshot of this file
  as it stood before this cleanup.
- **`guideline/sop/todo4.md`** holds everything through 2026-08-30.

Consult them before re-litigating a decision; they record why things are the way
they are.

Planning sources:
- `guideline/sop/suggestion.md` - primary critique and remediation source.
- `guideline/sop/finance-logic.md` - finance modeling standards.
- `guideline/sop/file-structure.md` - ownership boundaries.
- `docs/INDEX.md` - map of every documentation file in the repo.

Legend: `[ ]` not started, `[x]` complete

---

## Where things stand (2026-09-29)

`renewal` @ `ae2cc78`, with PRs through #65 merged. The only open item is Track E, which
is deferred on data (see its entry).
- **Tests:** 1865 pytest passing, plus 16 environmental failures. `exchange_calendars`
  is not installed in the local Python env, and the same 16 fail on every branch.
- **Playwright:** 299 specs passed in the last full run (2026-09-27, #61).

---

## Open work

### Track S: Macro signal engine
Plan: `docs/superpowers/plans/2026-10-12-macro-signal-engine.md`. Spec + corrections:
`docs/superpowers/specs/2026-10-10-macro-signal-engine-spec.md`. Baseline 1883 pytest passed.
- [x] S2 pure rules  - [x] S3 scenario  - [x] S4 FRED fetch  - [x] S5 rules.yaml
- [x] S6 store/fetcher  - [x] S7 engine+API  - [x] S8 schedule  - [x] S9 page  - [x] S10 docs
  - S9: the page is verified against mocked API specs only; live FRED check pending owner
    FRED_API_KEY in config/.env.
  - Tests (2026-10-13): pytest 2032 passed, 0 failed (baseline 1883); Playwright 322 passed,
    0 failed; typecheck and lint clean.

- [ ] **Deferred from the snapshot overhaul (Track E):** readable snapshot identity and
      charts over snapshot history. **Still blocked on data (re-checked 2026-09-29):**
      `corporate_comparison_snapshots_v3` holds 0 rows, because snapshots are saved only
      when you refresh the comparison yourself. The spec's reason ("it would be built and
      validated against nothing") still holds. Build the charts once history spans several
      days and metric versions. Readable identity stays cosmetic (spec §9).

### Track D: Design system (paper redesign)
Plan: `docs/superpowers/plans/2026-10-12-design-system-formalization.md`.
- [x] D1 drift rule + baseline + redesign copy  - [x] D2 token source (1:1)  - [x] D3 rename collisions (`unknownVar` check; chart cursor fixed, ERROR-LOG 2026-10-13)
- [x] D4 fonts (Host Grotesk, Pretendard, Geist Mono; OFL, vendored)  - [x] D5 paper switch (deprecatedVar 2311 warnings; Sidebar text-black → ink; full Playwright 309 passed, 7 skipped)  - [x] D6 formatNumber  - [x] D7 i18n + bilingual labels
- Follow-up (D7): Hydration guard: the i18n hydration test sits behind the AppProvider splash gate and cannot see a locale mismatch. Add an ungated or server-rendered fixture in a ko-KR browser with console capture, before screens become server-rendered.
- Known items for Tasks 8-13 (Task 5 fix round 1, not fixed there): (a) old `--brand` mint used as a tint behind text is now solid orange (`CorporateAssumptionsPanel.tsx:90,170`, thead rows); (b) ink on brand is about 4.06:1, so `--on-brand` lands in Task 8; (c) the `chart-muted` donut slice is now dark (`AllocationDonut.tsx:17`).
- Task 8 Step 4: no Card consumer has an absolute child that moved with Card's new `relative` (see task-8-report.md); the dev/monitor Card at app/dev/monitor/page.tsx:792 uses overflow-hidden, which clips its corner ticks (accepted, dev page).
- Task 9 (shared UI, charts, data, workbenches on paper tokens): design baseline 0 across the globs. `CHART_COLOR_SEQUENCE` has five series; `seriesColor` folds index 5+ into chart-4 (consumer: `app/monte-carlo/components/PathSimulationSection.tsx`, Task 13 to decide). Open: `chartConfig` `fmt*` helpers keep their output (consumers outside Task 9), the TVChart container is now transparent (fix round 1). Market overview up candles took the day-change colour (ERROR-LOG 2026-10-14, fixed). See `.superpowers/sdd/2026-10-12-design-system-formalization/task-9-report.md`.
- Follow-up (owner, 2026-10-14, option A): move workbench and chart English copy (DCFWorkbench, DiagnosticWorkbench, AttributionWaterfall, ChartPanelFrame, AppProvider, MetricAuditPanel Source/Method/Confidence) into the en/ko catalogs as its own task after D9.
- [x] D8 component layer  - [x] D9 shared UI/charts  - [x] D10 portfolio  - [x] D11 valuation/cases/decisions (corporate moved to the one-screen plan)
- D11 follow-ups (Task 11, commit 94e992a; fix round 1):
  - Owner decision: cases helpers not on formatNumber. `fmtMoney` (variable precision, pinned "8,000" and "4,946.3"), `formatWire` and `fmtPercent` (cases/caseFields.ts, `toFixed` and `toLocaleString`), `ValuationSection.tsx:31` (terminal share `toFixed(1)`), `changeRows.ts:202` and `SimulateSection.tsx:129` (run limits). Either extend formatNumber for variable precision, or keep them as named exceptions.
  - Correction to the number-format note: any value that rounds to 0.0% now prints "0.0%" without a sign, not only an exact zero (verdict percent rows, `formatNumber` `signDisplay: exceptZero`).
  - Option A, M6 leftovers for cases and decisions: ForkSection, SimulateSection, SimulateResults, PricingSection, InputsSection, WhyItMovedSection, NarrativeInputs, FieldPicker, Section.tsx, ValuationSection, cases/[id], the decisions list, form and page, and the scatter. English JSX text, aria and placeholder strings stay English until moved to `cases.*` and `decisions.*`.
  - Owner decision: U+2212 minus in `fmtSigned` (cases/format.ts) and `SimulateResults.signed`. `cases.spec.ts:167` and `:334` pin it; ASCII would break them.
- Corporate one-screen (part A): plan `docs/superpowers/plans/2026-10-14-corporate-one-screen.md`, branch `feat/corporate-one-screen` (merges back before D11).
  - [x] C1 notes  - [x] C2 owner approval of the test inventory  - [x] C3 top bar  - [x] C4 pure models  - [x] C5 first screen  - [x] C6 lower tabs
  - [x] C7 header  - [x] C7b page tabs + verdict strip (D10)  - [x] C8 modal tabs  - [x] C9 trend  - [x] C10 peers  - [x] C11 sensitivity  - [x] C12 corporate on paper tokens  - [x] C13 final gate
  - Follow-up B: sector peer data (spec D7/D8), which replaces the Peers tab's universe position.
  - Follow-up N9 residue: M5 numbers, `buildCalculationDetails` prose, bilingual headers on the pre-existing tables.
  - Follow-up N1 input: annual history for debt ratio, reinvestment, beta and innovation, which the backend must supply.
  - Owner decision pending: the WACC tile shows the slider value while the assumption table shows the audit's "N/A" when the audit is invalid.
  - [x] DS Task 14a lint/test rules (new rules at error outside market): `rounded-full` on chips (no check today; Task 12 mutant uncaught), `font-*` without a reason, figures without mono, and no page scroll at 1280×720.
  - The dvh fix (Task 7b, `min-h-dvh`) has not been tested on a real phone; only Chromium at 390×844 is covered.
  - Uppercase table-header consistency, for DS Task 11.
- One-screen principle for every page (owner, 2026-10-14): no page scroll at 1280×720. After corporate, one page at a time with its own short spec and plan: market → monte carlo → detail → signals → list pages (news, events, decisions, cases: fixed header and filters, list scrolls inside its panel). [x] Done in DS Task 14a: shared rule and automated check (`tests/e2e/one-screen-no-scroll.spec.ts`). The original request was: add a shared rule and an automated "no page scroll at 1280×720" check (DS Task 14 or a follow-up). Heights 2026-10-14: corporate 2836, market 1520, decisions 1530, events 1012.
- Motion system (2026-10-16/17): plan `docs/superpowers/plans/2026-10-16-motion-system.md`, spec `docs/superpowers/specs/2026-10-16-motion-system-design.md`, branch `feat/motion-system` (stacked on PR #70). Six owner-approved motions as shared pieces (RollingNumber, BeforeAfter, Tabs indicator, ScanReveal, mv-enter, DeltaBadge animate, Sparkline draw); market overview adopts them; Playwright defaults to reduced motion.
  - [x] T1 tokens + odometerPlan + reduced-motion default  - [x] T2 RollingNumber/BeforeAfter/bench  - [x] T3 Tabs indicator + ScanReveal  - [x] T4 DeltaBadge/Sparkline opt-ins  - [x] T5 market adoption  - [ ] T6 final review, owner acceptance
  - Gates 2026-10-17: Playwright 614 passed / 9 skipped / 0 failed; pytest 2153; unit 135/0; typecheck, lint 0, design:baseline 0. Motion video: scratchpad `motion-video/market-motion.webm`.
  - Follow-ups: Monte Carlo spec §6 must reference the motion spec (on `feat/monte-carlo-one-screen`); SparklineCard has no focus-visible border cue; redundant `waitForTimeout` in motion specs; DeltaBadge duplicate wrapper span.
- Market overview expansion (2026-10-16): plan `docs/superpowers/plans/2026-10-16-market-overview-expansion.md`, spec `docs/superpowers/specs/2026-10-16-market-overview-expansion-design.md`, branch `feat/market-overview-expansion` (from `renewal` at b833b21). 14 instruments (adds SOXX, SKYY, BOTZ, ^TNX), 1D and 1M change on cards and the two-half table, rate in bp, sector/rate modal copy; regime reads only scored tickers; OHLCV default table follows where rows are written.
  - [x] T1 month_delta  - [x] T2 14 instruments + regime set + table symmetry  - [x] T3 model + catalog  - [x] T4 cards/table  - [x] T5 modal  - [ ] T6 gates, capture, owner acceptance
  - Gates 2026-10-16 (before the table-values test): pytest 2149 passed; Playwright 586 passed, 9 skipped, 0 failed; typecheck, lint 0, unit 135/0, design:baseline 0.
  - Deferred minors: bp figure has no glyph/sr-only direction (sign text only); ko card label widths not width-checked; card sparkline fixed 32px inside a flex-1 wrapper; malformed bar date raises in get_all_indices; inner `_get_stock_ohlcv_with_metadata` None default untested directly. Old `stocks` rows for SKYY/BOTZ stay; after the load_price_bars fix nothing reads them.
- Market one-screen: plan `docs/superpowers/plans/2026-10-16-market-one-screen.md`, spec `docs/superpowers/specs/2026-10-16-market-one-screen-design.md`, branch `feat/market-one-screen` (from `feat/design-system-paper` at `7abbf74`; merges back before D14b). Takes the market part of D13.
  - [x] M1 owner approval + notes  - [x] M2 regime API  - [x] M3 pure models  - [x] M4 page frame, tabs, regime line  - [x] M5 instruments tab  - [x] M6 market on paper + en/ko (cap 295 → 0)  - [x] M7 final gate
  - M7 capture review (2026-10-16): `apps/web/design-capture/review-after-14a-vs-market-one-screen.html`, capture `market-one-screen`; `market.png` is 1280×720 (after-14a was 1280×1472). Verdicts per screen: market changed on purpose (one screen, paper); dev-design byte-identical; cases, corporate, decisions, events and valuation differ by 9–16 pixels in the active nav label (y 21–27) only, in no file this branch touches, and identical to market-paper's capture; portfolio differs by 2498 pixels in data bands (y 400–440, 620–640), and portfolio imports nothing this branch changes (SparklineCard is market-only). The Spreads tab is not in the capture; it is covered by Task 4's no-scroll test.
  - Market final-review follow-ups (2026-10-16, after `final-fix-report.md`):
    - N6 UNVERIFIED: an index fetch failure keeps the header and both tabs (`InstrumentsPanel.tsx` early returns, `MarketOverviewClient.tsx`). No test: the cards are fetched during SSR (`app/page.tsx`), `page.route` cannot reach that request, and the only server-side handle is `data/cache/moneyview_port.json` (or `API_BASE_URL_INTERNAL`), which every worker shares, so a spec cannot point one page at a dead API without breaking parallel specs. Follow-up: a pure `instrumentsPanelState(indices, fetchError)` helper with a model test, or a second web server on its own port with a dead `API_BASE_URL_INTERNAL`.
    - m3: the figure row tests `refused_reason !== null` (`spreadFigure`), while `SpreadsSection` tests truthiness. They disagree on `""`. Use one predicate.
    - m4: the modal sentence is keyed by tone (`REGIME_SUMMARY_KEY`), not by label. A future neutral-tone label would read the "mixed" sentence.
    - m5: the InstrumentsPanel error and empty states drop `SpreadFigureRow`, though the spreads do not depend on the cards.
    - `regimeView` with a NaN or undefined `equity_index_count` reads as ready (`<= 0` is false). The backend types it `int = 0`, so it cannot arrive. If wanted, use `!(count > 0)`.
    - The DS plan (`design-system-formalization.md`) has two blank lines before **Globs:** (about line 2921).
    - `isMarketPageTab`'s `typeof` guard is an equivalent mutant: `includes` already rejects non-strings, so no test can kill it.
    - The case drift on modal English (for example "Daily Volume") was accepted under R6; only Task 6's 114-literal script guards it.
  - M7 gates (2026-10-16): tokens:check, typecheck, lint clean; unit 136/0; `design:baseline` total 0, bySeverity error 0 warn 0; Playwright 534 passed, 8 skipped, 0 failed (a-c 213, d-h 69 + 8 skipped, i-m 73, n-r 114, s-z 65; `one-screen-no-scroll` on "/" passed at 1280×720 and 390×844); pytest 1890 passed (1883 + 7). One d-h run had `events-page.spec.ts:82` fail with `net::ERR_NO_BUFFER_SPACE` on `page.goto` (Windows socket exhaustion); the same chunk rerun passed in full.
  - Follow-ups: the `ViewToggle` labels in Korean (N9; shared UI, with its own test list); the drawer migration (UI-consolidation Task 7, amended); the `regimeSummary` catalog copies follow the backend if it rewords (N7).
- [x] D12 monte-carlo  - [x] D13 detail/news/events/dev (market and signals moved out)  - [x] D14a lock-down outside market  - [x] D14b aliases, theme reset and market override removed; paper-sweep covers all 8 screens (2026-10-16). Step 7 (i18n lock, `react/jsx-no-literals` and the attribute rule) stays OPEN: see "D14b step 7" below.
  - D14a (2026-10-15): `moneyview/no-raw-design-values` is `error` outside `components/market/**` and `app/page.tsx`. Market stays `warn` at 295 hits (typeScale 59, deprecatedVar 162, hex 3, paletteClass 6, lengthTypeVar 3, fontWeight 57, figureMono 3, roundedFull 2). `DESIGN.md` and CLAUDE.md §10 added. Paper-sweep escape hatch was not needed.
  - D14a gate (2026-10-15): `design:baseline` error 0, warn 295 (market only); lint 0 errors; unit 119/0; typecheck and tokens:check clean; pytest 1883 passed.
  - D14a Playwright (full, 66 spec files, --workers=2): 494 passed, 8 skipped, 0 failed after d35a1f4 (the `i18n-model.spec.ts:23` failure was a product defect from f1ce93e: English label halves `total_ms`/`self_ms`/`db_ms` renamed; test unchanged).
  - D14a captures: `after-14a` is byte-identical to `after-ds13` on all 8 screens (review page `apps/web/design-capture/review-after-ds13-vs-after-14a.html`). The four shape changes (chip, pill, badge, icon disc) sit on screens not captured, so the owner has to check them on `/dev/design` or the detail page.
  - D14b (2026-10-16): 53 deprecated tokens, the market lint override and `paper-sweep.spec.ts`'s `/` exclusion are removed; `moneyview.themeReset` resets `--color-*`, `--text-*`, `--shadow-*`, `--radius-*` (`theme-reset.spec.ts` pins the six utilities kept outside the theme). `DenseTable` `ColumnDef.label` is required. The market notes of this track are closed.
  - D14b step 7 (OPEN): `react/jsx-no-literals` count is 415 in 50 files, and the `aria-label|title|placeholder|alt` literal count is 118 in 32 files, so neither rule is added. Largest: portfolio `StockDetailModal` 50, `page.tsx` 49, `PortfolioSnapshotSummary` 23, `PortfolioCommandCenter` 22; corporate `RawDataTab` 21, `TargetStockComparisonSection` 18; `SnapshotHistoryModal` 18; monte-carlo `PathSimulationSection` 15; `PortfolioAllocationEditor` 14; `DCFWorkbench` 14; cases `ForkSection`, `SimulateResults`, `SimulateSection` 13 each; `CorporateComparisonTable` 12. The full by-file list is in `.superpowers/sdd/2026-10-12-design-system-formalization/task-14b-report.md`. Translating copy is separate work (M6 option A).
  - Final review fixes (2026-10-15, branch `feat/design-system-paper`): TVChart up candles take `--up` (`lib/candleColours.ts`); sparklines take their own window direction (`lib/sparklineTone.ts`, DESIGN.md); lint checks class constants and variant tables; `design:baseline` fails above the market cap of 295 (`scripts/design-baseline-cap.mjs`); HARNESS fixed rules aligned with DESIGN.md; candle-direction waits on a condition.
  - [x] Signals migration to paper during the PR #67 rebase (owner, 2026-10-15; done 2026-10-16 on the rebased `feat/macro-signal-engine`: 56 -> 0, copy.ts moved to the `signals` catalog namespace in en and ko, rule labels follow the locale, ko test in `signals-page.spec.ts` rejects an English manual label and an English ko title): `app/signals/**` had 56 errors under the new rule. Also add `/signals` to `components/ui/navItems.ts` (Radar icon, `nav.signals` and `navShort.signals` in en and ko) and delete `Sidebar.tsx` in the conflict; re-run topnav and one-screen-no-scroll at 390px.
  - Claude Design System in claude.ai: owner action (plan 14a step 15).
  - Minors from the final review, not yet scheduled: `DecisionList` `fmtPct` and `chartConfig` `fmtNum` / `fmtPlain` on `formatNumber`; tail-colour unification (`chartConfig` `PERCENTILE_SERIES_COLORS` vs `PathSimulationSection`); `CorrelationModelSection` optimal point colour; primary-button recipes vs `ActionButton`; eyebrow coverage and gutters; `DESIGN_SCREENS` is missing news, detail and cases-id; Pretendard 2 MB preload; `/dev/design` is ungated.
  - Known gap: no test pins the English column of `LABELS` (see the i18n-model record in ERROR-LOG.md).
- D12 follow-ups (Task 12, commit 1837913; fix round 1):
  - Option A, M6 leftovers for Monte Carlo (resolved by the Monte Carlo one-screen work: screen copy is in the en/ko catalogs): English JSX text, aria, title and placeholder strings stay English in CorporateValuationSection, CorrelationModelSection, PathSimulationSection, RiskAnalysisSection, ReturnDistributionSection, ChartGuard and shared.tsx (MonteCarloRunPanel and MonteCarloTabSummary were replaced by SimulationRail and ResultHeader) (card labels, detail copy, legends, button labels, empty states, chart titles and descriptions, table captions). Only the page title, subtitle and the five tab labels and descriptions are in `monteCarlo.*`.
  - Progress value: `formatNumber(progress, "integer")` rounds the run progress to an integer. Visible output is unchanged for integer progress; flag it if fractional progress ever arrives.
  - Copy changes with the colour change, for owner review: the Efficient Frontier description now reads "The highest-Sharpe portfolio is drawn apart from the sampled set" (was purple/green), and the Spearman description now says positive exposures are red and negative are blue (was green/red).
- Monte Carlo one-screen follow-ups (Task 12, plan `2026-10-17-monte-carlo-one-screen.md`):
  - The D12 M6 Monte Carlo English-copy follow-up above is absorbed by this plan; `DESIGN_SCREENS` now includes `/monte-carlo`.
  - D5 (open): path normalization warnings ("Dropped invalid ... row N.") stay English; they need a locale-aware path.
  - D8 (done): ko `krw()` shows 원 (50,000원); amounts go through `formatKrwCompact`.
  - Deferred minors (ledger `.superpowers/sdd/2026-10-17-monte-carlo-one-screen/progress.md`): `max-h-[40dvh]` is not a token; unused `NumericField.help` / `MetricCard`; ExportMenu active index and outside-click focus; dead `activeTabRef` guard in `page.tsx` (mutation M-B survives); `ResultFigure` carries both `previousValue` and `previousText`; valuation/correlation before-after untested beyond path; `krwAxis().divisor` unused; en axis ticks can repeat near 1M; rotated Y-axis unit label overlap checked only by the Task 12 capture; superseded-run perf event message is generic; `ScanReveal` blocks not re-indented in `page.tsx`.
  - Final-review fixes (3585d30): F1 charts overflowing their frames at 390, F2 frontier tick decimals and tooltip percent, the "HEIGHTS" debug log, `SummaryRow` nowrap and the ko median pin are done. Follow-ups left: 80% range truncated at 390 (ResultHeader truncate); risk and path money figures use the current rail principal, not the run's (store the principal with the result); VaR/CVaR ReferenceLines not visible on the category X axis; valuation X axis uses `fmtCompactThousands` (no unit); HistogramPanel tooltip is English in ko; `formatKrwRange` sign convention differs; `max-h-[40dvh]` needs a token; dead `activeTabRef` guard in `page.tsx`; correlation before to after untested; frontier X tick labels crowd at 390.
- D13 follow-ups (Task 13, detail/news/events/dev):
  - Market (`app/page.tsx` is already 0; `components/market/**` has 233 hits: typeScale 59, deprecatedVar 162, hex 3, paletteClass 6, lengthTypeVar 3) stays for its own one-screen plan. Re-measured 2026-10-16 at `1e71ea7`: 295 (typeScale 59, deprecatedVar 162, hex 3, paletteClass 6, lengthTypeVar 3, fontWeight 57, figureMono 3, roundedFull 2; `MarketOverviewClient.tsx` 264, `SpreadsSection.tsx` 31). Plan: `2026-10-16-market-one-screen.md`.
  - `app/components/RecordsSyncStatus.tsx` (events page and decision log): migrated on the paper tokens, with `records-sync-status.spec.ts:87` changed to `/status-warning-ink/` on owner approval (2026-10-15).
  - `lib/metricAudit.ts` English copy and `N/A` need a locale-aware path (option A / M5). `N/A` also conflicts with the `—` missing-value glyph.
  - Optional: precompute the volume colours in `tokens.generated.ts`, which would drop the `eslint-disable-next-line` in `lib/transformers.ts`.
  - Metric audit copy in `lib/metricAudit.ts` stays English (`formatAuditMetricValue`, `metricAuditReason`); its callers need a locale first.
  - Visible changes for owner review: the detail chart accent is paper up/down (red/blue, was mint/red); volume bars on market, detail and portfolio stock detail take the paper colours; the news "Today" article has a brand left rule, no gradient; dev-monitor missing values read "—" (were "n/a" and "N/A"); new category default colour is chart-2.
  - Korean lines with numbers or units, for the owner to read by eye: `devMonitor.slowOperations.threshold`, `devPerformance.buffer`, `devPerformance.percentiles`, `devPerformance.tickerTotal`, `devPerformance.truncated` (2,000), `detail.ma20` / `detail.ma50` (20일 / 50일).
Baseline counts (D1, 2026-10-13, `npm run design:baseline` over app/components/lib/hooks): typeScale 650, paletteClass 92 (142 class occurrences; the rule reports per string), rawRadius 47, rawShadow 13, lengthTypeVar 115, arbitraryPx 13, hex 53, colorFn 10, numericFontSize 2. Total 995.
Captures and review verdicts: D1 `before` vs `before-again`: 7 of 7 byte-identical. Mask: SparklineCard `article` on `/` (market cards are server-rendered from the live API, so they move between runs). D4 `after-rename` vs `after-font`: glyph change only, no new truncation; Corporate "Reference Method" / "Comparison Type" tiles clip at the edge in both captures (pre-existing, not a font effect).
Corporate one-screen capture review (C13, 2026-10-15): `apps/web/design-capture/corporate-one-screen/`, review page `apps/web/design-capture/review-after-corporate-vs-corporate-one-screen.html` (gitignored). corporate.png is 1280x720, so the page does not scroll. Verdicts: corporate = pass for the shell and the §2A Summary layout (header verdict strip shows the not-calculated state; Country Risk Premium label and Bottom-up Ke caption truncate; WACC tile vs table N/A is the open owner decision). market = stretch, 1472 px tall; the magenta cards are Playwright's mask on live-data cards by design. portfolio = 720, list pane scrolls inside, cards clip at the pane edge (list-page rule, later). valuation and cases = pass at 720. decisions = 1498 px and events = 972 px, both scroll (width-driven stretch, noted, DS Tasks 11-13). dev-design = 821 px (noted).

---

### Track W: Watchlist cleanup and corporate sync (G1, G2)
Plan: `docs/superpowers/plans/2026-10-15-watchlist-cleanup-and-corporate-sync.md`.
Spec: `docs/superpowers/specs/2026-10-15-watchlist-cleanup-and-corporate-sync-design.md`.
- [x] W1 `cleanup_pending` + run (30-day grace, references, savepoint per table)
- [x] W2 hooks on every watchlist add/remove path, incl. peer sync
- [x] W3 startup (gated) + daily run  - [x] W4 company list hides a deleted ticker
- [x] W5 `corporate_metrics` / `corporate_companies` records-sync kinds + write-path stamps
- [ ] W6 **Rollout:** close MoneyView on both PCs; update PC 1, start it, check Corporate; update PC 2
      the same day; confirm neither sync status shows a skipped peer file with "unknown kind". Until
      both are updated, use only the updated PC (a record changed on both keeps the later change).
      Nothing is deleted for 30 days. See `docs/architecture/watchlist-cleanup-and-corporate-sync.md`.

### Track R: Risk signal (급락 경보)
Spec: `docs/superpowers/specs/2026-10-18-risk-signal-design.md`. Plan (watchlist themes, sub-project ①):
`docs/superpowers/plans/2026-10-18-watchlist-themes.md`. Evidence: `docs/superpowers/specs/2026-10-18-risk-signal-evidence/`.
- [x] R-① watchlist themes: theme column and endpoint, optional theme sync field (`FORMAT_VERSION` unchanged), stock-modal picker
- [x] R-① **Theme apply:** `python scripts/apply_watchlist_themes.py --dry-run`, then the real run after the owner's OK.
      2026-10-18 applied on this PC: 250/250 rows themed (24 distinct themes), 5 names fixed (NRG, SCCO, MSTR, IAUM, SLV);
      sector/group/weight unchanged. The first run hit the API RateLimiter (429); the re-run was idempotent.
- [ ] R-① **Rollout:** the other PC needs updating the same day and needs the theme apply too. Sync is off on this PC,
      so themes reach the other PC only through its own run of `python scripts/apply_watchlist_themes.py` after it updates.
      Until BOTH PCs run this branch, make no watchlist edits on the un-updated PC (weight auto-save, "normalize allocations",
      sector edit, group toggle). Each re-stamps that row without a theme and, once sync is on, the updated PC takes the newer
      row and silently drops its theme.
- [ ] R-① **Open:** PSTG has no Yahoo quote ("Quote not found"). Its status (renamed, delisted or still listed) is unknown.
      The draft places it in `메모리·스토리지` pending that check.
- [x] R-① **Fixed (pre-existing defect, found 2026-10-18; fixed in risk-engine Task 1):** `apps/api/services/watchlist_cleanup.py` `_REFERENCE_QUERIES`
      did not count market-overview proxy tickers stored in `stocks` (BOTZ, SKYY, XLE, ITA, CIBR, ICLN, TSL, 143860.KS, ^KS11).
      They were enrolled in `cleanup_pending` on 2026-10-18 08:05Z, so their caches would be deleted after 30 days and then
      refetched, repeatedly. Fixed in sub-project ② with the benchmark tickers (^SOX, RSP, SPY), which hit the same path.
      Not changed in the watchlist-themes wave. Covered now: SPREAD_PAIRS tickers and the benchmarks. Not covered: TSL, 143860.KS, ^KS11,
      which no code path references any more; their `stocks` rows (if still present) are cleaned after the grace period. Owner to confirm.
- [x] R-② risk engine: built on feat/risk-engine. Real-DB backfill run 2026-10-19 (owner OK, backup in scratchpad): 11/11 past alerts reproduced; one release date differs by a day (spec §3.5). Next: PR, then ③ banner and panel UI.
      Plan: `docs/superpowers/plans/2026-10-19-risk-engine.md`. After the owner's OK: `python scripts/risk/reproduce_backfill.py`
      against the real DB and record the diff in spec §3.5.
      Final-review fixes landed 2026-10-19: acquisition covers only priced, settled bars (ERROR-LOG); FRED series read from
      the accumulated cache; backfill state "degraded" (R26) for an empty warning series or sweep failures, rerun next cycle
      with live days replayed; one coverage_wait key; cleanup deletes `deep_history:<T>`; an all-failed news sweep is retried.
- [ ] R-②-b surge signal: built on feat/surge-signal; real-DB rerun 2026-10-20 (alerts 11/11, surge 206/215 matched, spec §2). Spec:
      `docs/superpowers/specs/2026-10-19-surge-signal-design.md`. Plan: `docs/superpowers/plans/2026-10-19-surge-signal.md`.
      After the owner's OK and a DB backup: run one risk cycle (the rules version changes, so the backfill recomputes), then
      `python scripts/risk/reproduce_backfill.py` and record the surge diff in spec §2. Then PR, then ③ banner and panel UI.
- [x] R-③ signal UI: done on feat/risk-ui, pending owner merge. Signal strip on "/", overlay panel (crash, candidates, surge, yesterday's gainers + news), `/alerts` records page with per-record reports and CSV, small `/api/v1/risk` additions. Spec: `docs/superpowers/specs/2026-10-20-risk-ui-design.md`. Plan: `docs/superpowers/plans/2026-10-20-risk-ui.md`.
- [x] R-③ follow-ups (fix/blocked-storage-followups): portfolio and detail workbench storage helpers guarded (ERROR-LOG 2026-10-25); `/alerts` report rows memoised. Corporate page storage was already guarded.
- [x] R-④-a news history (feat/news-history): pacer, full-feed storage with publish time and publisher, daily stock sweep, past-date search and status routes. Spec: `docs/superpowers/specs/2026-10-25-news-history-design.md`. Plan: `docs/superpowers/plans/2026-10-25-news-history.md`. Records: ERROR-LOG 2026-10-25 (three entries). Final fix wave 1f9a59c (pacer priority during bulk gaps, STOP on shutdown, no check recorded for a refused fetch, per-ticker sweep clock, alert-queue lock, history status/lock, `/status` complete, e2e news-loop flag); four more ERROR-LOG entries.
- [ ] R-④ (screen, now ④-b) stock detail one-screen page using the news history API (next after ③ merges).
- Deferred minor findings are listed in the plan ledger (`.superpowers/sdd/2026-10-18-watchlist-themes/progress.md`) and are triaged at the final review.

## Known limits, accepted deliberately

Recorded so nobody rediscovers them as bugs.

**Verdict panel and benchmarks**
- **The peer set is a watchlist, not a sector census.** Peers are tickers this
  installation happens to store in the same industry. Every peer-based row reports
  both counts (`2 of 3`) rather than implying authority.
- **Benchmarking against the top of a sector is conservative for spotting
  undervaluation and anti-conservative for the opposite.** Each panel row names the
  basis it used. `/pricing` deliberately uses the company's own industry instead.
- **US-only.** Non-US tickers resolve to US industry benchmarks.
- **Vintage loading is manual.** An annual dataset does not need a scheduler.
- **`no_sector_pe` does not distinguish** "the vintage has no PE" from "the PE was
  screened out". Both mean no usable sector PE, and the vintage is named.
- **`SectorBenchmark.rejected`** carries about 20 no-value entries per basket for the
  four optional columns. It is read nowhere in `apps/`; diagnostic noise only.
- **A "full-history drawdown" is computed over NULL-filtered closes**, so on a sparse
  subject it means "full history of usable closes".
- **`valuation_verdict.py` builds its source sentences by positional concatenation.**
  Restructuring was decided against (Track B3). Revisit only if a fifth signal needs a
  clause the concatenation cannot express. The mutation harness in
  `tests/api/test_valuation_verdict_mutations.py` guards it.

**CAPM beta**
- **A beta relevered for CAPM does not round-trip exactly at extreme leverage.**
  `debt_ratio` is capped at 90 (D/E at most 9) and the unlevered beta is clamped to
  [0.4, 3.0]. The tax rate now matches on both sides (F2, 2026-09-26).

**Decision log**
- **The empty-memo route test passes if only the Pydantic validator is removed**,
  because `record_decision` guards independently. That redundancy is deliberate defence
  in depth, but the route test alone does not pin the request model.

**Event registry**
- User events and category edits are per machine and not synced.
- The tooltip shows a source's host, not a link.
- The XNYS calendar's coverage is fixed when the API process starts (one year ahead).
  A server left running for a year stops generating quad-witching dates past that point
  until restarted.

---

## Archived

- `guideline/sop/todo6.md` -- every track through 2026-09-29 (this file before cleanup).
- `guideline/sop/todo5.md` -- every track through 2026-09-26.
- `guideline/sop/todo4.md` -- all completed tracks through 2026-08-30.
- `guideline/sop/todo3.md`, `todo3-spreadsheet-values.md`, `todo2.md` -- earlier
  planning sources, still referenced by the archived entries.
