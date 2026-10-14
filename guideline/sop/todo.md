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
- [x] D8 component layer  - [x] D9 shared UI/charts  - [x] D10 portfolio  - [ ] D11 valuation/cases/decisions (corporate moved to the one-screen plan)
- Corporate one-screen (part A): plan `docs/superpowers/plans/2026-10-14-corporate-one-screen.md`, branch `feat/corporate-one-screen` (merges back before D11).
  - [x] C1 notes  - [x] C2 owner approval of the test inventory  - [x] C3 top bar  - [x] C4 pure models  - [x] C5 first screen  - [x] C6 lower tabs
  - [x] C7 header  - [x] C7b page tabs + verdict strip (D10)  - [ ] C8 modal tabs  - [ ] C9 trend  - [ ] C10 peers  - [ ] C11 sensitivity  - [ ] C12 corporate on paper tokens  - [ ] C13 final gate
- One-screen principle for every page (owner, 2026-10-14): no page scroll at 1280×720. After corporate, one page at a time with its own short spec and plan: market → monte carlo → detail → signals → list pages (news, events, decisions, cases: fixed header and filters, list scrolls inside its panel). Add a shared rule and an automated "no page scroll at 1280×720" check (DS Task 14 or a follow-up). Heights 2026-10-14: corporate 2836, market 1520, decisions 1530, events 1012.
- [ ] D12 monte-carlo  - [ ] D13 market/detail/news/events/dev/signals  - [ ] D14 lock-down
Baseline counts (D1, 2026-10-13, `npm run design:baseline` over app/components/lib/hooks): typeScale 650, paletteClass 92 (142 class occurrences; the rule reports per string), rawRadius 47, rawShadow 13, lengthTypeVar 115, arbitraryPx 13, hex 53, colorFn 10, numericFontSize 2. Total 995.
Captures and review verdicts: D1 `before` vs `before-again`: 7 of 7 byte-identical. Mask: SparklineCard `article` on `/` (market cards are server-rendered from the live API, so they move between runs). D4 `after-rename` vs `after-font`: glyph change only, no new truncation; Corporate "Reference Method" / "Comparison Type" tiles clip at the edge in both captures (pre-existing, not a font effect).

---

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
