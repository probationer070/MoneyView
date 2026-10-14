# Corporate One-Screen and Tabbed Detail Modal Implementation Plan (part A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page loses the 256 px left sidebar for a fixed 48 px top bar. `/corporate` answers "is this stock cheap or expensive?" at 1280×720 without scrolling: a verdict block, four KPIs and a compact assumption table, with three lower tabs (diagnostics, DCF, comparison). The calculation detail modal is reorganised into six tabs and gains a trend, a peer position and an assumption sensitivity.

**Architecture:** Frontend only. No route, schema, service or finance-engine change.
- `components/ui/TopNav.tsx` replaces `Sidebar.tsx`. The nav item list moves to `components/ui/navItems.ts`, and `AppShell` drops `lg:ml-64`.
- The first-screen blocks are new components, `VerdictBlock`, `KpiRow`, `AssumptionTable` and `CorporateHeader`, so `page.tsx` shrinks. `CorporateAssumptionsPanel.tsx` is deleted.
- `CorporateLowerTabs` holds the three lower tabs, with `useTabState`.
- `CalculationDetailModal` becomes a tab shell over six tab components in `app/corporate/components/detail/`.
- All decision logic that tests can pin lives in pure modules, tested as Playwright model specs the way `format-model.spec.ts` is: `verdict.ts`, `assumptionRows.ts` (rows and sensitivity request bodies), `substitutedFormula.ts`, `peerRank.ts` and `detailTabs.ts`.

**Tech Stack:** Next.js 16.2 app router, React 19, Tailwind CSS 4 with the paper tokens and `type-*` utilities, recharts 3, @tanstack/react-query 5, lucide-react, Playwright (e2e and model specs), ESLint 9 with `moneyview/no-raw-design-values`.

**Spec:** `docs/superpowers/specs/2026-10-14-corporate-one-screen-design.md`. The owner approved §1–§4; §1 was replaced on 2026-10-14 by D9, the top bar (commit `fefc0c1`). Read it together with this plan. Where they differ, the "Narrowed or interpreted" table below names the difference and the reason.

**D10 (2026-10-15):** spec §2A replaces the first screen plus three lower tabs with four page tabs (Summary | Core Diagnostics | DCF | Target Stock Comparison), a header verdict strip, and a page that never scrolls at 1280×720 or 390×844. Task 7b implements it, after Task 7 and before Task 8. Where earlier text in this plan says "first screen" or "lower tabs", read "the Summary tab" or "the page tabs".

**Sequencing:**
- This plan runs on `feat/corporate-one-screen`, cut from `feat/design-system-paper` **after design-system Task 10 (Portfolio) is complete**. It merges back into `feat/design-system-paper` **before design-system Task 11**.
- It builds on that plan's Tasks 5–9: tokens, `formatNumber`/`MISSING`, `useT`/`useLocale`, `LABELS`/`BilingualLabel`/`Eyebrow`, and the restyled `Card`, `KPIBlock`, `DeltaBadge`, `Tabs`, `ActionButton`, `ModalShell`, `PageHeader`, `fieldInputClass`, `TickerSearch` and `EmptyState`/`ErrorState`. It also uses that plan's "Screen migration procedure" (M1–M7).
- It absorbs UI-consolidation Task 8 (C1a, the outer View Full Report), and it takes the corporate globs out of design-system Task 11. Task 1 writes both notes into those plan files.

---

## Narrowed or interpreted (owner-visible)

**Owner confirmed 2026-10-14:** N5 and N6 (hover zone is the menu cluster; ☰ pins), N8 (comparison charts and batch reports stay below the table), N9 (deferred migration items become a follow-up with its own test-change approval).


| # | Spec says | This plan does | Why |
|---|---|---|---|
| N1 | §4 trend tab for growth, ROIC, debt ratio, reinvestment, beta, innovation | **Growth and ROIC only.** The tab is hidden for every other key. | `GET /corporate/metrics/{t}/history` (`CorporateMetricHistoryApi`, `corporateTypes.ts:98`; built by `yahoo_metric_history`, `apps/api/services/corporate_statement_metrics.py:1660`) returns annual series for exactly two metrics: `annual_growth_rates` and `annual_roic`. The other four have no annual values in the response, and A changes no backend. |
| N2 | §4 summary: "the formula with real numbers substituted", e.g. WACC | **Substituted for 8 keys**: `spread`, `bottomUpKe`, `leveredBeta`, `sustainableGrowth`, `erp` (only when IRR ≥ rf), `wacc` (only when the metric audit carries all six inputs), `backendDcf` and `backendFairValue` (only when the bridge resolved). Every other key shows the symbolic `detail.formula` only. | Only these keys have every operand and the result already computed on the page. Growth needs first and last revenue, ROIC needs the averaged NOPAT/IC pairs, and the charts are scenario sweeps; none of these values reach the browser. `substitutedFormula.ts` formats operands; it computes nothing. `erp` is `max(IRR − rf, 0)` (`page.tsx:479`), so the identity is printed only when the clamp did not bite. WACC uses the audit's `equity_weight`, `cost_of_equity`, `debt_weight`, `cost_of_debt`, `tax_rate` and `final_wacc_value` (`corporate_statement_metrics.py:1561–1572`); the slider value can differ from the audit's, and the summary then shows both. |
| N3 | §4 summary input table "value · source · as-of" | The as-of column holds **one date per metric**: the audit entry's `as_of`, or the DCF `generated_at` for the DCF keys, else `—`. | `CalculationRow` (`calculationDetailTypes.ts:27`) has no per-row date. |
| N4 | §2.2 idle state "DCF 미계산 · [↻ DCF]" | Text only: "DCF not calculated · use Refresh DCF above". **No second button.** | A second "Refresh DCF" button would make `getByRole("button", { name: "Refresh DCF" })` ambiguous in 16 existing tests. The header button is one line above. |
| N5 | §1 hover "on the bar" opens the panel | The hover and focus zone is the **menu cluster** (icon links, ☰ and the panel), not the logo or the language toggle. | Otherwise clicking the language toggle opens the panel, and every nav link then exists twice (`i18n.spec.ts:7–12` would hit a strict-mode violation). |
| N6 | §1 ☰ toggles | **☰ pins the panel open.** A pinned panel closes on ☰, Escape, an outside click or navigation, but not on pointer leave. A hover- or focus-opened panel closes 150 ms after leave. | The pointer reaches ☰ by hovering, which already opens the panel. A plain toggle would close it on the first click. |
| N7 | — | The active nav item matches by prefix (`/cases/2` → Cases). The sidebar matched exactly. | The narrow bar shows "the current page name", which would be blank on every detail route. |
| N8 | §3.3 table "fills the remaining height" | The comparison tab is toolbar + status + table (internal scroll, 320 px). **The two comparison charts and the batch-report table stay in that tab, below the table.** Reaching them scrolls the page (after Task 7b, the tab panel; the page never scrolls). | The spec does not place them, and "no information is removed" (§ goals). Four specs read them. |
| N9 | DS M5/M6/M7 for corporate (formerly DS Task 11) | M1–M4 apply to all of `app/corporate/**` (Task 12). **M6/M7 apply to the strings, headers and labels this plan writes.** These are **not migrated here** and are listed as Follow-ups: M5 (number formatting); the English prose of `buildCalculationDetails.ts`; the titles, descriptions and headers of the modal's moved audit sections (Full DCF Report, Raw Datasets, OHLCV, Quarterly); and the headers of the pre-existing tables (comparison, batch reports, sensitivity grid, DCF report tables). | Their header text and `$x.x` figures are pinned by XPath and `columnheader` assertions in `corporate-comparison-bridge`, `corporate-estimated-value-bridge`, `corporate-dcf-sensitivity` and `corporate-comparison`. A bilingual `th` breaks `normalize-space(th)="DCF Value"`. That is a separate test-change approval. |
| N10 | §4.1 sensitivity Δ table | Implemented as written. The innovation, governance and CRP rows show "An assumption the DCF does not use directly". | `dcfRequestBody` (`corporateUtils.ts:51`) sends no innovation, governance or CRP field. |
| N11 | — | The assumption table shows innovation, governance and ESG penalty as plain scores (`82.0`), not `82.0%`. | `RangeControl` defaulted `suffix="%"` for these 0–100 scores (`CorporateAssumptionsPanel.tsx:176–178`). |
| N12 | §2A strip: "same values and rules as §2.2, including the not-calculated, calculating, refused and Bridge Incomplete states"; §2A tabs: "carry over a stored `corporate.lowerTab` value (diagnostics/dcf/comparison) once" | (a) The strip shows the bridged per-share value, the upside badge and the label when valued. Otherwise it shows one phrase: "DCF not calculated", "Calculating…" or "Not valued". A refusal's reason is in the strip's `title`, and the EV of a Bridge Incomplete valuation is not repeated; both stay in the Summary block. (b) Only `dcf` and `comparison` are carried over. A stored `diagnostics` is dropped, and the tab opens on Summary. | (a) The strip is one line, and at 390 px a refusal reason (100+ characters) or an extra EV figure would wrap it to three. The values come from the same `verdictView` as the block. (b) `useTabState` writes its value back on every mount, so every session that ever opened `/corporate` holds `diagnostics`, the old default, whether or not the reader chose it. Carrying it over would make Summary the default for no existing session. |

---

## Global Constraints

- Run `npm`/`npx`/`node` in `apps/web`, `git` from the repo root, in Git Bash. Use `python`, never `python3` (a Windows Store stub).
- Branch: `feat/corporate-one-screen` from `feat/design-system-paper` after DS Task 10. Never commit to `renewal`, `feat/macro-signal-engine` or `feat/ui-consolidation-tabs`.
- **Frontend only.** Nothing under `apps/api/`, `packages/core_finance/`, `packages/shared-types/`, seeds or sync code changes. The finance-logic SOP applies only in that no formula is added: the new pure modules format, rank or offset values the page already holds, or build request bodies with `dcfRequestBody`.
- Paper tokens only. Colours, radius and component sizes are written as `[var(--token)]`, type as `type-<style>`, spacing on Tailwind's numeric scale. No hex, no `text-xs`/`text-sm`, no `rounded-lg`, no `shadow-*`, no `text-[Npx]`. `npm run design:baseline -- <new files>` must report 0 in every category for each file a task creates.
- Up = red ▲ +, down = blue ▼ −, flat = ■, via `DeltaBadge`. Never colour alone. Missing = `MISSING` (`—`) from `@/lib/format`.
- Every new user-visible string goes into `lib/i18n/messages/en.ts` **and** `ko.ts` (`ko` is typed `Messages`, so a missing Korean key is a type error). Korean follows `docs/design/MoneyView_Glossary.md` and uses 합니다체. Small labels (eyebrows, table headers) are `BilingualLabel`/`Eyebrow` keys from `lib/i18n/labels.ts`, and each one gets a glossary row first.
- Accessible names that existing tests use stay identical in English: "Refresh DCF", "Refresh comparison", "Refresh source data", "Calculate All DCF Reports", "Verify Watchlist Sync", "Load Full Report", "Company Search", "Comparison universe", "Comparison benchmark", "Custom tickers", "Sort by", "Direction", "Close modal", and the heading "Corporate Analysis".
- Copy must not contain "probability", "NPV", "Health Score", "Life Cycle" or "Levered Beta Risk": `corporate-probability-labels.spec.ts` and `corporate-composite-score.spec.ts` assert their absence.
- **Existing tests.** Edit only the rows of the "Existing-test change inventory", only in the task that row names, and only after Task 2 records the owner's approval. If any other existing test fails, stop and report it; do not edit it.
- **CLAUDE.md §8.** Every new test is shown failing against the mutation named in its task's matrix. To mutate: create a backup directory with `bak=$(mktemp -d)` and copy the file in with `cp -p <file> "$bak"/`. Apply the one mutation with Edit, then run the named test: it must FAIL, for the named reason. Restore with `cp -p "$bak"/<basename> <file>`, and `cmp "$bak"/<basename> <file>` must print nothing. **Never** use `git checkout`, `git restore`, `git stash` or `--no-verify`, and never read `config/.env`.
- Playwright runs from `apps/web` as `npx playwright test <files> --workers=2`. It boots the API on :8110 and the web app on :3101. If a run is stopped or killed, kill both servers before the next run:
  `powershell -NoProfile -Command 'Get-NetTCPConnection -LocalPort 8110,3101 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'`
- Gates after every task: `npm run typecheck`, `npm run lint`, `npm run test:unit`, the task's specs, and every spec named in that task's inventory rows. Task 13 runs the full suite.
- **Line endings.** The index is LF for every file. `core.autocrlf=true`, so the working-tree ending varies (`git ls-files --eol <file>`, column `w/`). Keep each edited file's working-tree ending; Edit preserves it. New files are written LF. Compare with `git diff --ignore-cr-at-eol`. Files edited here that are `w/crlf`: `TargetStockComparisonSection.tsx`, `CorporateDiagnosticsSection.tsx`, `CorporateGraphs.tsx`, `CorporateComparisonTable.tsx`, `calculationDetailTypes.ts`, `corporateUtils.ts`, `corporateDerivedViews.ts`, and every `tests/e2e/*.spec.ts` in the inventory. All other files touched are `w/lf`.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pass it as a second `-m`.
- `ERROR-LOG.md` gets a record for any confirmed bug found on the way (CLAUDE.md §7). On a merge conflict there, keep both sides.
- SOPs: `file-structure.md` (Tasks 3, 5–8), `test-verification.md` (all), `refactor-cleaner.md` (Tasks 5–8, 12), `code-reviewer.md` (Task 13), `finance-logic.md` (Task 4, N2 check), `todo.md` (Tasks 1, 13).

---

## Review Focus

The five inputs the spec implies but no feature test naturally reaches, most likely first. Each is pinned by a named test in its owning task.

1. **A backend status that is an `Object.prototype` name** (`"constructor"`, `"toString"`). A plain lookup table returns a function, and the verdict then renders `function Object() { [native code] }` as its label. Expected: shown as sent. → Task 4, `verdictLabelKey reads only its own keys`.
2. **A bridge-missing comparison row in the peer distribution.** The backend hardcodes `dcf_implied_return = 0.0` when the bridge does not resolve (fixture row MISS, `corporatePageMock.ts:513`). Ranked naively, 0.0 becomes a real-looking peer. Expected: excluded like `bridgedDcfValue` excludes it. → Task 4, `an unbridged row's 0.0 upside is not a peer value`.
3. **A sensitivity step past the slider range, and float drift.** WACC 2.5 − 1.0 lands below the 2 % floor, and 1.05 − 0.10 is `0.9500000000000001`. Expected: clamped to the slider range and flagged; the body carries the rounded value. → Task 4, `a step past the slider range is clamped and flagged` and `the beta step is rounded, not drifted`.
4. **Pointer paths through the top bar.** Clicking the language toggle must not open the panel and duplicate every link. Clicking ☰ after hovering it must not close the panel the hover just opened. → Task 3, `the language toggle does not open the menu` and `clicking ☰ after hovering pins the panel open`.
5. **A remembered detail tab the next metric lacks.** For example, "Trend" was remembered and `crp` is opened. Falling back must not overwrite the stored choice: the next growth detail opens on Trend again. → Task 9, `a metric without the remembered tab opens Summary and keeps the memory`.

---

## Existing-test change inventory (owner approval required before any edit)

**Approved by the owner on 2026-10-14** (rows as listed; changes: none).

**Totals: 15 spec files edited, 57 rows.** "Insert" means a new line before the cited line; the cited line itself is unchanged.

**Line numbers are those at plan time** (`feat/design-system-paper` @ `fefc0c1`). A later row in the same file shifts by the lines an earlier task inserted, so always locate a row by the quoted code, never by the number alone. If the quoted code is not where the row says, or reads differently, stop and report it: DS Tasks 9–10 may have touched the file. Helpers are new files in `tests/e2e/helpers/corporateDcf.ts`, defined in the task that first needs them:

| Helper | Defined in | Does |
|---|---|---|
| `openLowerTab(page, name)` | Task 6 | clicks `getByRole("tab", { name })` inside `[data-testid="corporate-lower-tabs"]` and waits for `aria-selected="true"` |
| `lowerPanel(page)` | Task 6 | `page.getByTestId("corporate-lower-tabs").getByRole("tabpanel")` |
| `refreshDcf(page)` | Task 7 | clicks Refresh DCF, waits for `corporate-verdict` `data-state="valued"` |
| `loadFullDcfReportInTab(page)` | Task 7 | DCF tab → Load Full Report; returns `lowerPanel(page)` |
| `openFullDcfReportInModal(page)` | Task 7 (Task 8 adds the Raw data tab click) | Verdict detail → (Raw data tab) → "Full DCF Report" summary → Load Full Report; returns the dialog |
| `openDetailTab(dialog, name)` | Task 8 | clicks `dialog.getByRole("tab", { name })` and waits for `aria-selected="true"` |

### Task 3 (top bar)

| # | File:line | Current | Why it breaks | Replacement |
|---|---|---|---|---|
| 1 | `sidebar-contrast.spec.ts:19–46` | `#app-sidebar` links "Valuation"/"Portfolio" are bold ink; active has a background; hover equals active | `#app-sidebar` no longer exists, and in the bar inactive items are icon-only | Same assertions on the menu panel: `await page.getByTestId("topnav-menu").hover(); const sidebar = page.locator("#app-nav-panel"); await expect(sidebar).toBeVisible();` replaces line 23. Lines 24–46 are unchanged; they now resolve inside the panel. Test title → `"every menu panel label is bold ink, active or not, and the active one is still marked"`. |
| 2 | `paper-identity.spec.ts:9` | `page.locator("#app-sidebar")` visible | element removed | `page.locator("#app-topnav")` |
| 3 | `paper-identity.spec.ts:39` | same | same | `page.locator("#app-topnav")` |
| 4 | `paper-identity.spec.ts:40` | `Open navigation sidebar` button hidden at 1000 px | the mobile menu button is removed, so the assertion is vacuous | `await expect(page.locator("main")).toHaveCSS("padding-left", "32px");` (`lg:px-8` applies at ≥ 992 px, which is what this test pins) |
| 5 | `events-page.spec.ts:37` | `page.locator("#app-sidebar").getByRole("link", { name: "Events" })` | element removed | `page.locator("#app-topnav").getByRole("link", { name: "Events" })`. The bar's icon link has the full name as `aria-label`. |

### Task 5 (first screen)

| # | File:line | Current | Why it breaks | Replacement |
|---|---|---|---|---|
| 6 | `corporate-comparison.spec.ts:102` | `click "Refresh source data"` | moved into the assumption ⋯ menu (spec §2.4) | Insert `await page.getByRole("button", { name: "Assumption options" }).click();` |
| 7 | `refresh-idle-state.spec.ts:210` | same | same | Insert the same line |
| 8 | `refresh-idle-state.spec.ts:315` | `getByText("Growth Rate now stays on the stable CAGR path. …")` visible | the growth basis moved into the ⋯ menu ("성장 기준 표시") | Insert the same line before it. The text itself is unchanged. |

### Task 6 (lower tabs)

| # | File:line | Current | Why it breaks | Replacement |
|---|---|---|---|---|
| 9 | `corporate-comparison.spec.ts:18` | `getByLabel("Comparison universe")` visible | comparison controls live in a tab that is not selected by default | Insert `await openLowerTab(page, "Target Stock Comparison");` |
| 10 | `corporate-comparison.spec.ts:22–23` | "Portfolio snapshots … Portfolio page only." and "Live watchlist comparison" visible | the paragraphs and method tiles move into the tab's ⓘ (spec §2.5) | `await page.getByTestId("comparison-about").hover(); await expect(page.getByRole("tooltip")).toContainText("Portfolio snapshots and saved history are managed from the Portfolio page only."); await expect(page.getByRole("tooltip")).toContainText("Live watchlist comparison");` |
| 11 | `corporate-comparison.spec.ts:25–26` | "Watchlist Holdings Sync" box and its sentence | the box becomes one status line | `await expect(page.getByTestId("comparison-status")).toContainText(/Watchlist \d+\/\d+ synced/);` (both lines replaced by this one) |
| 12 | `corporate-comparison.spec.ts:30` | `locator("div").filter({ hasText: /^Watchlist \+ Benchmark$/ })` | the universe tile is removed; the label is a span in the status line | `await expect(page.getByTestId("comparison-status")).toContainText("Watchlist + Benchmark");` |
| 13 | `corporate-comparison.spec.ts:37` | same for `Custom Universe` | same | `await expect(page.getByTestId("comparison-status")).toContainText("Custom Universe");` |
| 14 | `corporate-comparison.spec.ts:47–48` | button "Calculate All Reports" | the two batch buttons merge into the toolbar's "Calculate All DCF Reports" (spec §2.5) | `name: "Calculate All DCF Reports"` on both lines |
| 15 | `corporate-comparison.spec.ts:63` | `selectOption` on the universe | tab not selected | Insert `await openLowerTab(page, "Target Stock Comparison");` |
| 16 | `corporate-comparison-bridge.spec.ts:28` | `gotoComparison` clicks Refresh comparison | tab not selected | Insert `await openLowerTab(page, "Target Stock Comparison");` (covers all 11 tests in the file) |
| 17 | `corporate-dcf-sensitivity.spec.ts:136` | Terminal Value Share tile on the page | DCF Core Modules moves to the DCF tab | Insert `await openLowerTab(page, "DCF");` |
| 18 | `corporate-viewport.spec.ts:35` | "DCF Core Modules" scrolled into view | moved to the DCF tab | Insert `await openLowerTab(page, "DCF");`. Line 44 then passes: the tab is remembered across the reload. |
| 19 | `corporate-composite-score.spec.ts:38` | "DCF Core Modules" visible | moved | Insert `await openLowerTab(page, "DCF");` |
| 20 | `corporate-probability-labels.spec.ts:32` | same | same | Insert `await openLowerTab(page, "DCF");` |
| 21 | `corporate-estimated-value-bridge.spec.ts:37` | `loadBulkReports` clicks Refresh comparison | tab not selected | Insert `await openLowerTab(page, "Target Stock Comparison");` |
| 22 | `terminal-diagnostics.spec.ts:23, 32, 49, 79, 87, 97, 107` | testids `terminal-share-warning` / `terminal-growth-bound` and "Terminal Value Share" | live in DCF Core Modules, now in the DCF tab | After each Refresh DCF click, insert `await openLowerTab(page, "DCF");` (7 insertions, one row) |
| 23 | `high-risk-render-regression.spec.ts:129` | `getByLabel("Comparison universe").selectOption` | tab not selected | Insert `await openLowerTab(page, "Target Stock Comparison");` |
| 24 | `high-risk-render-regression.spec.ts:135` | `locator("div").filter({ hasText: /^Custom Universe$/ })` | tile removed | `await expect(page.getByTestId("comparison-status")).toContainText("Custom Universe");` |
| 25 | `responsive-accessibility.spec.ts:86` | "DCF Core Modules" | moved | Insert `await openLowerTab(page, "DCF");` |
| 26 | `responsive-accessibility.spec.ts:91` | "Hurdle Rate Decomposition" at 375 px | the DCF tab is now selected | Insert `await openLowerTab(page, "Core Diagnostics");` |
| 27 | `tab-state-persistence.spec.ts:75` | universe `selectOption` | tab not selected | Insert `await openLowerTab(page, "Target Stock Comparison");`. After return, lines 84–85 pass because the tab is remembered. |
| 28 | `tab-state-persistence.spec.ts:100` | same | same | Insert the same line |
| 29 | `refresh-idle-state.spec.ts:47` | "Comparison stays idle on first load." | in the comparison tab | Insert `await openLowerTab(page, "Target Stock Comparison");` |
| 30 | `refresh-idle-state.spec.ts:197` | `getByText("Last updated")` count 3 and the AAPL cell | the comparison timestamp and table are in the tab | Insert `await openLowerTab(page, "Target Stock Comparison");`. All three timestamps are then rendered (header, source-data status, comparison status), so the count stays 3. |

### Task 7 (header row; View Full Report, Add Company form, Intrinsic DCF tile and idle sentence removed)

| # | File:line | Current | Why it breaks | Replacement |
|---|---|---|---|---|
| 31 | `corporate-comparison.spec.ts:115–122` | Refresh DCF → `View Full Report` → summary "Full DCF Report" | outer button removed (absorbs UI-consolidation Task 8, its row for :115–117; re-verified: the button sits at :116–118, the dialog opens at :120–122) | Keep :114–115. Replace :116–122 with `const dcfDialog = await openFullDcfReportInModal(page);`. :123 is unchanged. |
| 32 | `corporate-dcf-sensitivity.spec.ts:25–29` | `refreshDcf` waits on the Intrinsic DCF tile | tile removed | Body becomes `await refreshDcfHelper(page);` (import `refreshDcf as refreshDcfHelper` from the helper) |
| 33 | `corporate-dcf-sensitivity.spec.ts:32–38` | `openFullReport` clicks `View Full Report` and reads the grid in the modal (UI-consolidation row for :33; re-verified at :33) | button removed; the grid now shows in the DCF tab after Load Full Report (spec §3.2) | Body becomes `const panel = await loadFullDcfReportInTab(page); await expect(panel.getByText("WACC x Terminal Growth Sensitivity")).toBeVisible({ timeout: 30_000 }); return panel;`. Callers keep their `modal` variable; `modal.getByText("Base", …)` (:66, :126) now counts inside the panel. |
| 34 | `corporate-estimated-value-bridge.spec.ts:30–32` | `refreshDcf` on the tile | tile removed | Body becomes `await refreshDcfHelper(page);` |
| 35 | `corporate-estimated-value-bridge.spec.ts:62–64` | tile contains `—`, not `1,462.4` | tile removed. The verdict **does** show the EV labelled "EV $1,462.4" (spec §2.2); the invariant is that the per-share slot never holds it. | `const intrinsic = page.getByTestId("corporate-verdict").locator('[data-part="intrinsic"]'); await expect(intrinsic).toHaveText(PLACEHOLDER, { timeout: 60_000 }); await expect(intrinsic).not.toContainText("1,462.4");` |
| 36 | `corporate-estimated-value-bridge.spec.ts:69` | `tile.click()` | tile removed | `await page.getByRole("button", { name: "Verdict detail" }).click();` |
| 37 | `corporate-estimated-value-bridge.spec.ts:81–83` | tile `—` then `tile.click()` | same | `await expect(page.getByTestId("corporate-verdict").locator('[data-part="intrinsic"]')).toHaveText(PLACEHOLDER, { timeout: 60_000 }); await page.getByRole("button", { name: "Verdict detail" }).click();` |
| 38 | `corporate-estimated-value-bridge.spec.ts:99–101` | tile contains `240.5`, not `—` | same | `const intrinsic = page.getByTestId("corporate-verdict").locator('[data-part="intrinsic"]'); await expect(intrinsic).toContainText("240.5", { timeout: 60_000 }); await expect(intrinsic).not.toContainText(PLACEHOLDER);` |
| 39 | `refresh-idle-state.spec.ts:45` | "DCF stays idle on first load until you refresh it." | sentence removed; the verdict says it (spec §2.1) | `await expect(page.getByTestId("corporate-verdict")).toContainText("DCF not calculated");` |
| 40 | `refresh-idle-state.spec.ts:196` | tile contains `$199.9` | tile removed | `await expect(page.getByTestId("corporate-verdict").locator('[data-part="intrinsic"]')).toContainText("$199.9");` |
| 41 | `refresh-idle-state.spec.ts:208` | tile contains `$240.5` | same | same locator, `"$240.5"` |
| 42 | `refresh-idle-state.spec.ts:232, 237` | `getByText(/Microsoft: hurdle rate/i)` | the subtitle becomes "name · sector · price" (spec §2.1) | `await expect(page.getByTestId("corporate-company-line")).toContainText("Microsoft");` |
| 43 | `refresh-idle-state.spec.ts:238` | tile "Refresh to calculate" | tile removed | `await expect(page.getByTestId("corporate-verdict")).toContainText("DCF not calculated");` |
| 44 | `refresh-idle-state.spec.ts:311` | same as #42 | same | `await expect(page.getByTestId("corporate-company-line")).toContainText("Microsoft", { timeout: 60_000 });` |
| 45 | `refresh-idle-state.spec.ts:312–313` | tile "Refresh to calculate", not `$199.9` | tile removed | `const verdict = page.getByTestId("corporate-verdict"); await expect(verdict).toContainText("DCF not calculated"); await expect(verdict).not.toContainText("$199.9");` |
| 46 | `refresh-idle-state.spec.ts:588, 610` | tile contains `$199.9` | tile removed | `await expect(page.getByTestId("corporate-verdict").locator('[data-part="intrinsic"]')).toContainText("$199.9");` |
| 47 | `refresh-idle-state.spec.ts:594` | tile contains no `$` | tile removed | `await expect(page.getByTestId("corporate-verdict")).not.toContainText("$");` (a refused verdict shows no price either) |
| 48 | `refresh-idle-state.spec.ts:621` | tile not `$199.9` | tile removed | `await expect(page.getByTestId("corporate-verdict")).not.toContainText("$199.9");` |
| 49 | `refresh-idle-state.spec.ts:628` | click `View Full Report` (UI-consolidation row for :628; re-verified at :628) | button removed | `await openLowerTab(page, "DCF"); await lowerPanel(page).getByRole("button", { name: "Load Full Report" }).click();` |

### Task 8 (modal tabs)

| # | File:line | Current | Why it breaks | Replacement |
|---|---|---|---|---|
| 50 | `corporate-comparison.spec.ts:89` | subtitle "Calculation transparency and data lineage" | the header now pins ticker · value (spec §4) | `await expect(calculationDialog).toContainText("AAPL · ");` |
| 51 | `corporate-comparison.spec.ts:90` | "Download CSV: Analysis" | export lives in the Raw data tab | Insert `await openDetailTab(calculationDialog, "Raw data");` |
| 52 | `corporate-comparison.spec.ts:107` | heading "ROIC - WACC Audit" | the audit lives in the Calculation steps tab | Insert `await openDetailTab(calculationDialog, "Calculation steps");` |
| 53 | `corporate-comparison.spec.ts:109` | OHLCV / Quarterly summaries | in the Raw data tab | Insert `await openDetailTab(calculationDialog, "Raw data");` |
| 54 | `corporate-composite-score.spec.ts:54` | heading "Raw Datasets" | in the Raw data tab | Insert `await openDetailTab(modal, "Raw data");` |
| 55 | `corporate-probability-labels.spec.ts:50` | same | same | Insert `await openDetailTab(modal, "Raw data");` |

Rows 56–57 are the helper-file imports, counted so that nothing is edited unlisted:

| # | File | Change | Task |
|---|---|---|---|
| 56 | the 12 corporate/nav-dependent spec files above | add `import { … } from "./helpers/corporateDcf";` with the helpers each file uses | the task of the file's first row |
| 57 | `corporate-dcf-sensitivity.spec.ts`, `corporate-estimated-value-bridge.spec.ts` | the local `refreshDcf` functions keep their names; only their bodies change (#32, #34) | 7 |

**Per-file count:**

| Spec | Rows | Tasks |
|---|---|---|
| `corporate-comparison.spec.ts` | 14 (#6, 9–15, 31, 50–53, import) | 5, 6, 7, 8 |
| `refresh-idle-state.spec.ts` | 16 (#7, 8, 29, 30, 39–49, import) | 5, 6, 7 |
| `corporate-estimated-value-bridge.spec.ts` | 7 (#21, 34–38, import) | 6, 7 |
| `corporate-dcf-sensitivity.spec.ts` | 4 (#17, 32, 33, import) | 6, 7 |
| `terminal-diagnostics.spec.ts` | 2 (#22, import) | 6 |
| `corporate-composite-score.spec.ts` | 3 (#19, 54, import) | 6, 8 |
| `corporate-probability-labels.spec.ts` | 3 (#20, 55, import) | 6, 8 |
| `high-risk-render-regression.spec.ts` | 3 (#23, 24, import) | 6 |
| `responsive-accessibility.spec.ts` | 3 (#25, 26, import) | 6 |
| `tab-state-persistence.spec.ts` | 3 (#27, 28, import) | 6 |
| `corporate-comparison-bridge.spec.ts` | 2 (#16, import) | 6 |
| `corporate-viewport.spec.ts` | 2 (#18, import) | 6 |
| `paper-identity.spec.ts` | 3 (#2–4) | 3 |
| `sidebar-contrast.spec.ts` | 1 (#1) | 3 |
| `events-page.spec.ts` | 1 (#5) | 3 |

**Checked and unaffected:**
- **Nav links stay single.** `i18n.spec.ts` (7–12, 20, 62–65), `cases.spec.ts:14`, `decisions.spec.ts:13` and `valuation.spec.ts:13` query nav links by name. Each bar icon link carries the full name as `aria-label`, and the closed panel is `hidden`, so there is one link per name. N5 keeps the panel closed when the language toggle is clicked.
- **`paper-identity.spec.ts:26`** (Tab to a probe prepended before the bar) is unaffected.
- **`responsive-accessibility.spec.ts:42–77, 103–135`** (market, news, portfolio modal focus) is unaffected.
- **Not corporate, or not this page's layout.** `dcf-workbench-refusal.spec.ts` is `/detail`. `dev-monitor.spec.ts` only names `/corporate` as a link target. `portfolio-watchlist.spec.ts` and `snapshot-history-metric-version.spec.ts` use corporate API paths, not the page. `components-paper.spec.ts` uses the `/dev/design` gallery. `design-capture.spec.ts` asserts nothing; it is recaptured.
- **`corporate-comparison.spec.ts` lines needing no edit:** 16–17 (heading; the tab is labelled "Target Stock Comparison"), 19 (the status line keeps "Selected benchmark preset: S&P 500 (^GSPC)."), 24 ("Open Portfolio Testing" stays in the status line), 38 ("Benchmark: ^GSPC." stays), 39–46, 49–55, 83–88 (summary tab: "Calculation Formula" and "Result Summary: value, inputs used" keep their English text), 103 ("ROIC - WACC" KPI is a `role="button"`), 108 (the reason also shows on the summary tab, `.first()`) and 111–114.
- **`corporate-estimated-value-bridge.spec.ts:72–74, 88–89`** (modal `—`, no `1,462.4`; the Upside / Downside row read by XPath) holds: the summary tab is the default and renders `detail.summary` as label/value `td` pairs.
- **`corporatePageMock.ts` and `designScreens.ts`** are unchanged.

### Addendum: Task 7b (page tabs and verdict strip, D10, 2026-10-15)

**Not yet approved.** Task 7b Step 1 presents this addendum, and Step 2 records the answer.

**Line numbers** are at `21362c1`. None of the specs below changed after `a8dba14`. Locate each row by the quoted code, as above.

**What breaks, and why.** Task 7b makes Summary the default page tab and mounts only the active panel. Two kinds of assertion break:
- assertions that expect the diagnostics charts on first load, because diagnostics was the old default;
- assertions that read the verdict, the KPIs, the assumption table or the source-data status after another tab was opened. Before 7b, those blocks were always on screen above the tabs.

Every file below already imports `openLowerTab` (and `refresh-idle-state.spec.ts` also imports `lowerPanel`), so there is no import row.

| # | File:line | Current | Why it breaks | Replacement |
|---|---|---|---|---|
| 58 | `corporate-composite-score.spec.ts:38` | `await expect(page.getByText("Hurdle Rate Decomposition").first()).toBeVisible({ timeout: 60_000 });` | The positive control expects the diagnostics charts on first load. Summary is the default now, and the diagnostics panel is not mounted. | Insert `await openLowerTab(page, "Core Diagnostics");` |
| 59 | `corporate-probability-labels.spec.ts:32` | same line | same | Insert `await openLowerTab(page, "Core Diagnostics");` |
| 60 | `corporate-viewport.spec.ts:32` | same line, at 390×844 (:33–34 read the other two charts) | same | Insert `await openLowerTab(page, "Core Diagnostics");`. Lines 36–46 then pass: line 37's `scrollIntoViewIfNeeded` scrolls the panel, and after the reload the DCF tab is remembered. |
| 61 | `high-risk-render-regression.spec.ts:127` | `await expectChartPanelRendered(page, "Hurdle Rate Decomposition");` | same | Insert `await openLowerTab(page, "Core Diagnostics");` |
| 62 | `refresh-idle-state.spec.ts:199–200` | `await openLowerTab(page, "Target Stock Comparison");` then `await expect(page.getByText("Last updated")).toHaveCount(3);` | The three timestamps were the header's DCF time, the source-data status and the comparison status. The source-data status is in the assumption table, on the Summary tab, so it is unmounted once the comparison tab opens. The count becomes 2. | Insert before :199 `await expect(page.getByTestId("source-data-status")).toContainText("Last updated");`. Change :200 to `await expect(page.getByText("Last updated")).toHaveCount(2); // the header's DCF time and the comparison status`. All three cached timestamps are still asserted. |
| 63 | `refresh-idle-state.spec.ts:211` | `await expect(page.getByTestId("corporate-verdict").locator('[data-part="intrinsic"]')).toContainText("$240.5");` | The comparison tab is still open from :199, so the verdict block is unmounted. :213–214 ("Assumption options", "Refresh source data") break for the same reason. | Insert `await openLowerTab(page, "Summary");` (this covers :211–214) |
| 64 | `refresh-idle-state.spec.ts:219` | `await page.getByRole("button", { name: "Refresh comparison" }).click();` | After #63, the Summary tab is open, and the button is in the comparison tab | Insert `await openLowerTab(page, "Target Stock Comparison");` |
| 65 | `refresh-idle-state.spec.ts:636` | `await expect(page.getByTestId("dcf-refusal")).toContainText("zero or negative over the forecast");` | A full-report refusal sets the page's refusal, which the verdict block shows (`dcf-refusal`). The block is on the Summary tab, and :634 opened the DCF tab. The strip shows only "Not valued", with the reason in `title` (N12). | Insert `await openLowerTab(page, "Summary");` |

**Per-file count (addendum):**

| Spec | Rows |
|---|---|
| `refresh-idle-state.spec.ts` | 4 (#62–#65) |
| `corporate-composite-score.spec.ts` | 1 (#58) |
| `corporate-probability-labels.spec.ts` | 1 (#59) |
| `corporate-viewport.spec.ts` | 1 (#60) |
| `high-risk-render-regression.spec.ts` | 1 (#61) |

**Total: 8 rows in 5 spec files.**

**Plan-owned test files changed by Task 7b** (written by this plan, so outside the approval rule; listed so that nothing is edited unlisted):

| # | File | Change |
|---|---|---|
| P1 | `helpers/corporateDcf.ts` | The testid becomes `corporate-page-tabs`. `LowerTabName` gains `"Summary"`. `refreshDcf` waits on `corporate-verdict-strip` instead of the block, so it works on any tab. |
| P2 | `corporate-one-screen.spec.ts:214–236` | The "the lower tabs" describe becomes "the page tabs". The first two tests change from "diagnostics is the default" to "Summary is the default" and from the `lowerTab` "bogus" fallback to the `pageTab` one. A migration test is added. |
| P3 | `corporate-one-screen.spec.ts:301–340` | The Task 7 fit test changes. Its box assertions now refer to the Summary tab: the Summary blocks must end inside the panel, and the header, strip and tab bar inside 720 px. `window.scrollY` is replaced by the no-page-scroll check. |
| P4 | `corporate-one-screen.spec.ts:417` | `corporate-lower-tabs` → `corporate-page-tabs` |
| P5 | `corporate-model.spec.ts` | appends `verdictView` and `migrateLowerTab` tests |
| P6 | `corporate-one-screen.spec.ts` | appends the no-page-scroll tests (both sizes, four tabs) and the verdict strip tests |

**Checked and unaffected by Task 7b (19 specs):**
- **`corporate-comparison.spec.ts`.**
  - :18 still finds one "Target Stock Comparison" (the tab label).
  - :19–94 open the comparison tab first. :86's `getByRole("button", { name: "240.5" })` runs with no DCF, so the strip reads "DCF not calculated".
  - :105–107 run on the default Summary tab.
  - :119–120 refresh on Summary, and `openFullDcfReportInModal` clicks the block's "Verdict detail".
- **`corporate-comparison-bridge.spec.ts`.** `gotoComparison` opens the comparison tab. The XPath tables, `plottedTickers` (attribute reads) and `selectSimilarComparison` do not depend on page scroll.
- **`corporate-dcf-sensitivity.spec.ts`.** :139 refreshes on the DCF tab, and it passes **only because** P1's `refreshDcf` reads the strip (Task 7b mutation 19). `gridCell`'s page-wide XPath finds no other table with a "WACC" header, because the assumption table is unmounted.
- **`corporate-estimated-value-bridge.spec.ts`.** The block reads at :62–101 run on Summary, the default. "Verdict detail" stays unique, because the strip's name does not contain it.
- **`terminal-diagnostics.spec.ts`.** It reads only DCF-tab testids, after `openLowerTab(page, "DCF")`.
- **`responsive-accessibility.spec.ts`.** :86 finds the tab label "Core Diagnostics". :87–95 open tabs explicitly.
- **`tab-state-persistence.spec.ts`.** At :86–87 the comparison tab is remembered under `pageTab`. At :119 the corporate keys still exist (`pageTab` is written).
- **`corporate-model.spec.ts`.** Its existing tests are unchanged; P5 only appends.
- **`design-capture.spec.ts`.** It asserts nothing. The `/corporate` capture becomes exactly 1280×720 (Task 13 checks that).
- **Not this page's layout:**
  - `dev-monitor.spec.ts` (a link only);
  - `dcf-workbench-refusal.spec.ts` (`/detail`);
  - `portfolio-watchlist.spec.ts` and `snapshot-history-metric-version.spec.ts` (corporate API paths only);
  - `topnav.spec.ts` (`/valuation`; its scroll test pads `body` itself).
- **`PageHeader`'s new prop and `Tabs`' new prop are optional, and without them the DOM is byte-identical:** `valuation.spec.ts`, `decisions.spec.ts`, `i18n.spec.ts`, `paper-identity.spec.ts` and `components-paper.spec.ts`.
- **Strict-mode collisions searched for, none found.**
  - No spec reads `delta-badge`, "Undervalued", "DCF not calculated", "Not valued", a verdict figure or `[data-part=…]` page-wide. Every such read is scoped to `corporate-verdict`, a gallery or a tile.
  - No spec queries `getByRole("tab")` unscoped on `/corporate`. The modal's "Summary" tab (Task 8) is always reached through `detailTabs`/`openDetailTab`.
  - No other spec reads `document`/`window` scroll on `/corporate`. `scrollIntoViewIfNeeded` (viewport :37, responsive :88, high-risk :147) scrolls the panel.

---

## File structure

| Path | Change | Responsibility |
|---|---|---|
| `apps/web/components/ui/navItems.ts` | create | the nav list (href, full-name key, short-label key, icon) and `activeNavItem` |
| `apps/web/components/ui/TopNav.tsx` | create | fixed 48 px bar, hover/focus/☰ panel, narrow layout |
| `apps/web/components/ui/Sidebar.tsx` | delete | replaced by TopNav |
| `apps/web/components/ui/AppShell.tsx` | modify | TopNav, no left margin, `pt` 4rem, `lg:px-8` |
| `apps/web/components/ui/PageHeader.tsx` | modify | optional `subtitleTestId`; optional `subtitleAside` (Task 7b) |
| `apps/web/components/ui/TickerSearch.tsx` | modify | optional `noMatchAction` (the "not in list → add" entry) |
| `apps/web/app/corporate/verdict.ts` | create | `verdictLabelKey(status)` |
| `apps/web/app/corporate/assumptionRows.ts` | create | `ASSUMPTION_ROWS`, `assumptionRow`, `formatAssumption`, `formatDelta`, `sensitivityPlan` |
| `apps/web/app/corporate/substitutedFormula.ts` | create | `substitutedFormula(key, ctx)` |
| `apps/web/app/corporate/peerRank.ts` | create | `peerRank(rows, field, ticker)` |
| `apps/web/app/corporate/detailTabs.ts` | create | `DetailTabKey`, `TREND_FIELDS`, `PEER_FIELDS`, `availableDetailTabs`, `resolveDetailTab` |
| `apps/web/app/corporate/components/VerdictBlock.tsx` | create | verdict block and `VerdictStatusLabel` |
| `apps/web/app/corporate/components/KpiRow.tsx` | create | four KPI tiles |
| `apps/web/app/corporate/components/AssumptionTable.tsx` | create | rows, one-row ✎ slider, ⓘ, ⋯ menu, status line |
| `apps/web/app/corporate/components/CorporateAssumptionsPanel.tsx` | delete | replaced |
| `apps/web/app/corporate/components/CorporateHeader.tsx` | create | title, search with the inline add form, DCF time, Refresh DCF, company line |
| `apps/web/app/corporate/components/CorporateLowerTabs.tsx` | create | three lower tabs, remembered |
| `apps/web/app/corporate/components/CorporatePageTabs.tsx` | rename of the above (Task 7b) | four page tabs, remembered; the panel scrolls inside itself |
| `apps/web/app/corporate/pageTabs.ts` | create (Task 7b) | `PAGE_TABS`, `PAGE_TAB_KEY`, `isPageTab`, `migrateLowerTab` |
| `apps/web/app/corporate/verdict.ts` | modify (Task 7b) | `verdictView`, shared by `VerdictBlock` and `VerdictStrip` |
| `apps/web/components/ui/Tabs.tsx` | modify (Task 7b) | optional `idPrefix` |
| `apps/web/app/corporate/components/DcfTab.tsx` | create | DCF core values plus the grid or Load Full Report |
| `apps/web/app/corporate/components/CorporateDiagnosticsSection.tsx` | modify (crlf) | three charts in one row, ⓘ |
| `apps/web/app/corporate/components/CorporateGraphs.tsx` | modify (crlf) | loading cards without the 4-column spans |
| `apps/web/app/corporate/components/graphs/{HurdleRateDecomposition,BetaWaccCurve,ValueDriverMatrix,DcfCoreModules}Graph.tsx` | modify | no `lg:col-span-*`; chart height 224 px |
| `apps/web/app/corporate/components/TargetStockComparisonSection.tsx` | modify (crlf) | toolbar, status line, scroll table, ⓘ |
| `apps/web/app/corporate/components/CorporateComparisonTable.tsx` | modify (crlf) | sticky header |
| `apps/web/app/corporate/components/CalculationDetailModal.tsx` | rewrite | header plus six tabs, remembered |
| `apps/web/app/corporate/components/detail/{detailParts,SummaryTab,StepsTab,RawDataTab,TrendTab,PeersTab,SensitivityTab}.tsx` | create | one file per tab, plus shared table/section pieces |
| `apps/web/app/corporate/page.tsx` | modify | composition only; it must end shorter than its 1,242 lines |
| `apps/web/lib/i18n/messages/{en,ko}.ts`, `lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md` | modify | `topnav`, `navShort`, `corporate` namespaces; new labels |
| `apps/web/tests/e2e/{topnav,corporate-model,corporate-one-screen,corporate-detail-tabs}.spec.ts` | create | new tests |
| `apps/web/tests/e2e/helpers/corporateDcf.ts` | create | shared corporate navigation helpers |
| `docs/superpowers/plans/2026-10-12-design-system-formalization.md`, `docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md` | modify | Task 11 trimmed; Task 8 superseded; Sidebar → TopNav note |
| `docs/USER-GUIDE.md`, `docs/design/MoneyView_{Component_System,Interaction_Rules}.md`, `guideline/sop/todo.md` | modify | sidebar → top bar wording; tracking |

**Expected `page.tsx` line counts:** 1,242 now, ~1,215 after Task 5, ~1,225 after Task 6, ~1,100 after Task 7 (measured 1,092), ~1,091 after Task 7b (gate ≤ 1,092), ~1,135 after Task 11. Every task ends at < 1,242 (`wc -l`), and Task 13 gates ≤ 1,150. Task 7 is where it shrinks: about 125 lines of header JSX and the add-company state move out.

**First-screen height budget at 1280×720** (Task 5 and Task 7 tests measure each block's bounding box; nothing uses `scrollHeight`). **Superseded by Task 7b:** the tab bar moves under the header, the Summary blocks sit in a panel of about 403 px (y ≈ 237–640), and the page is checked with `scrollHeight <= innerHeight`; see Task 7b Step 14.

| Block | Top (px) | Height budget | Bottom |
|---|---|---|---|
| TopNav | 0 | 48 | 48 |
| `main` top padding (`--main-pad-top: 4rem`) | 48 | 16 | 64 |
| Header: `PageHeader` (eyebrow, h1, company line; actions = search + DCF line) + `mb-6` | 64 | ≤ 92 + 24 | ≤ 180 |
| Verdict (left 2/3) | ≤ 180 | ≤ 130 | ≤ 310 |
| KPI row (gap 12) | ≤ 322 | ≤ 110 | ≤ 432 |
| Assumption section (right 1/3): head 40 + scroll region **capped at 288** (`max-h-72`) + status ≈ 40 | ≤ 180 | ≤ 368 | ≤ 548 |
| Tab bar (gap 16) | ≤ 564 | 44 | ≤ 608 |

The real table does not fit the cap. It has 10 rows (growth, ROIC, WACC, debt ratio, unlevered beta, CRP, reinvestment, innovation, governance, ESG): about 10 × 32 + 28 ≈ 348 px, more with a ✎ row open. So it **scrolls inside its 288 px region**, as spec §2.4 allows, and the page does not scroll. That leaves 112 px of slack for a wrapped company line or an open add-company form.

---

### Task 1: Branch, sibling-plan notes, tracking

**Files:**
- Modify: `docs/superpowers/plans/2026-10-12-design-system-formalization.md` (Task 11 heading and body; a note under Task 8's Sidebar row; Follow-ups)
- Modify: `docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md` (Task 8 heading and body; inventory rows; file-structure row; Task 9 note)
- Modify: `guideline/sop/todo.md` (Track D)
- Add: this plan file

**Interfaces:** none (docs only).

- [ ] **Step 1: Confirm the start point.** From the repo root:

```bash
git switch feat/design-system-paper
git status --short
grep -n "D10 portfolio" guideline/sop/todo.md
```

Expected: `D10` is checked (`- [x] D10 portfolio`). If it is not, stop: this plan runs after DS Task 10. `git status --short` may list untracked files (`data/error/…`, `design-sample/`, plan drafts); leave them alone. If a tracked file is modified, stop and report it.

- [ ] **Step 2: Create the branch.**

```bash
git switch -c feat/corporate-one-screen
```

- [ ] **Step 3: Trim DS Task 11.** In `docs/superpowers/plans/2026-10-12-design-system-formalization.md`, replace the block from `### Task 11: Corporate, valuation, cases, decisions` through the end of its single checklist item with:

```markdown
### Task 11: Valuation, cases, decisions

> **2026-10-14:** corporate moved out of this task. `docs/superpowers/plans/2026-10-14-corporate-one-screen.md`, run between Tasks 10 and 11 and merged back here, rebuilds `app/corporate/**` on the paper tokens. Its Task 12 applies M1–M4 to every corporate file and M6/M7 to what it wrote. Still open from the corporate side, listed under Follow-ups: M5 numbers in corporate, the English prose of `buildCalculationDetails.ts`, and the bilingual headers of the pre-existing corporate tables (pinned by XPath/columnheader assertions). `LABELS.verdict = ["판정", "Verdict"]` already exists (added there): reuse it.

**Globs:** `app/valuation/**/*.{ts,tsx}`, `app/cases/**/*.{ts,tsx}`, `app/decisions/**/*.{ts,tsx}`, `lib/dcfRefusal.ts`, `lib/bridgeQuality.ts`, `lib/impliedReturn.ts`.
**Specs:** `valuation*.spec.ts`, `cases*.spec.ts`, `decisions.spec.ts`, `dcf-workbench-refusal.spec.ts`.
**Korean assertion:** in `tests/e2e/cases.spec.ts`.

- [ ] Run the procedure, steps 1–8. Refusal and verdict texts move to `valuation.*` and keep their evidence figures through `{param}` interpolation, as the glossary's verdict rule requires. The verdict column header uses the existing `LABELS.verdict`.
```

In the same file, after the last row of the Task 8 mapping table (the row starting ``| `StatusBadge` styles map``), add:

```markdown

> **2026-10-14:** `Sidebar.tsx` was replaced by `components/ui/TopNav.tsx` (corporate-one-screen plan, Task 3), which carries this paper look over. Later tasks that name `Sidebar` apply to `TopNav`.
```

Append to that file's `## Follow-ups (not in this plan)` list:

```markdown
- Corporate residue of the paper migration (from `2026-10-14-corporate-one-screen.md`, N9): M5 (`moneyText`/`pct`/`numberText` → `formatNumber`) across `app/corporate/**`; the English prose in `buildCalculationDetails.ts` → `corporate.*` catalog keys; bilingual headers for the comparison, batch-report, sensitivity-grid and DCF-report tables, which need their own approved test-change list (they are pinned by XPath/`columnheader` assertions).
```

- [ ] **Step 4: Mark UI-consolidation Task 8 superseded.** In `docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md`:
  - Change the heading `### Task 8: Corporate: calculation detail stays a modal; its duplicate entry point goes` by appending ` (SUPERSEDED)`.
  - Insert directly under that heading:

```markdown
> **SUPERSEDED 2026-10-14** by `docs/superpowers/plans/2026-10-14-corporate-one-screen.md`. That plan removes the outer View Full Report button (its Task 7) and keeps `CalculationDetailModal` a `ModalShell` modal, reorganised into tabs (its Task 8). It carries this task's three test-change rows in its own inventory (#31, #33, #49). Do not run the steps below. `tests/e2e/helpers/corporateDcf.ts` already exists from that plan with different helpers; do not recreate it.
```

  - In "Existing tests this plan changes", append ` **Superseded: handled by the corporate one-screen plan.**` to the end of the `corporate-comparison.spec.ts` and `corporate-dcf-sensitivity.spec.ts` rows, and to the `refresh-idle-state.spec.ts` row.
  - In "File structure", change the `apps/web/app/corporate/page.tsx` row's responsibility to `superseded (corporate one-screen plan)`.
  - In Task 9 Step 1, after the bullet that starts `` `git grep -n -i "modal\|rail\| ``, add the bullet: `The left sidebar no longer exists (top bar, corporate one-screen plan Task 3); describe navigation as "the top bar".`

- [ ] **Step 5: Track the work.** In `guideline/sop/todo.md`, under `### Track D: Design system (paper redesign)`, after the line that starts `- [ ] D8 component layer`, add:

```markdown
- Corporate one-screen (part A): plan `docs/superpowers/plans/2026-10-14-corporate-one-screen.md`, branch `feat/corporate-one-screen` (merges back before D11).
  - [x] C1 notes  - [ ] C2 owner approval of the test inventory  - [ ] C3 top bar  - [ ] C4 pure models  - [ ] C5 first screen  - [ ] C6 lower tabs
  - [ ] C7 header  - [ ] C8 modal tabs  - [ ] C9 trend  - [ ] C10 peers  - [ ] C11 sensitivity  - [ ] C12 corporate on paper tokens  - [ ] C13 final gate
```

- [ ] **Step 6: Commit.**

```bash
git add docs/superpowers/plans/2026-10-14-corporate-one-screen.md docs/superpowers/plans/2026-10-12-design-system-formalization.md docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md guideline/sop/todo.md
git commit -m "docs(plan): corporate one-screen plan; DS Task 11 drops corporate; UI-consolidation Task 8 superseded" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Owner approval gate for existing-test changes

**Files:** this plan (one approval line), `guideline/sop/todo.md`.

**Interfaces:** none.

- [ ] **Step 1: Present the inventory.** The controller shows the owner the section "Existing-test change inventory" verbatim: the 57 rows, the per-file count table and the "Checked and unaffected" list. Also show the "Narrowed or interpreted" table (N1–N11), because N4, N5, N6 and N8 shape several rows.

- [ ] **Step 2: STOP.** Do not dispatch Task 3 or any later task until the owner answers. If the owner rejects or changes a row, edit that row (and the task step that applies it) in this plan, and present the changed rows again.

- [ ] **Step 3: Record the approval.** Directly under the heading `## Existing-test change inventory (owner approval required before any edit)`, insert `**Approved by the owner on <YYYY-MM-DD>** (rows as listed; changes: <none | list>).` In `todo.md`, mark `C2` checked.

- [ ] **Step 4: Commit.**

```bash
git add docs/superpowers/plans/2026-10-14-corporate-one-screen.md guideline/sop/todo.md
git commit -m "docs(plan): owner approved the corporate one-screen test-change inventory" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Top bar replaces the left sidebar (spec §1, D9)

**Files:**
- Create: `apps/web/components/ui/navItems.ts`, `apps/web/components/ui/TopNav.tsx`, `apps/web/tests/e2e/topnav.spec.ts`
- Modify: `apps/web/components/ui/AppShell.tsx` (full replacement), `apps/web/lib/i18n/messages/en.ts`, `apps/web/lib/i18n/messages/ko.ts`, `docs/design/MoneyView_Glossary.md`, `guideline/sop/todo.md`
- Delete: `apps/web/components/ui/Sidebar.tsx`
- Approved test edits: inventory #1–#5 (`sidebar-contrast.spec.ts`, `paper-identity.spec.ts`, `events-page.spec.ts`)

**Interfaces:**
- Consumes: `LanguageToggle`, `useT`, `MessageKey` (`lib/i18n/translate.ts`), `tokens.bp.tablet` (`"768px"`), lucide icons.
- Produces:
  - `NAV_ITEMS: readonly NavItem[]`, `interface NavItem { href: string; key: MessageKey; shortKey: MessageKey; icon: LucideIcon }`, `activeNavItem(pathname: string): NavItem | null` (`components/ui/navItems.ts`)
  - `TopNav()` with: `#app-topnav` (the `<header>`), `[data-testid="topnav-menu"]` (hover/focus zone), `nav[aria-label="Primary"]` (icon links), `[data-testid="topnav-current"]` (narrow-screen page name), the button named "Menu" (`aria-expanded`, `aria-controls="app-nav-panel"`), `#app-nav-panel` (`hidden` when closed)
  - catalog keys `topnav.primary|full|menu|poweredBy`, `navShort.market|portfolio|news|corporate|monteCarlo|decisions|valuation|cases|events`
  - `AppShell` `<main>`: `--main-pad-top: 4rem` (= `pt-16`), `lg:px-8`, no left margin. **Main content width at 1280 px: 1,216 px.**

- [ ] **Step 1: Write the failing test** (`apps/web/tests/e2e/topnav.spec.ts`)

```ts
import { expect, test, type Page } from "@playwright/test";
import { mockValuationApi } from "./helpers/valuationPageMock";

// Spec 2026-10-14 §1 (D9) and §7 test 6: a fixed 48px top bar replaces the left sidebar.
const bar = (page: Page) => page.locator("#app-topnav");
const panel = (page: Page) => page.locator("#app-nav-panel");
const menuButton = (page: Page) => bar(page).getByRole("button", { name: "Menu", exact: true });
const primary = (page: Page) => bar(page).getByRole("navigation", { name: "Primary" });

async function gotoValuation(page: Page) {
  await mockValuationApi(page);
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(bar(page)).toBeVisible({ timeout: 60_000 });
}

test.describe("the top bar at 1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("is 48px tall at the top, content starts below it, and it stays put on scroll", async ({ page }) => {
    await gotoValuation(page);
    expect(await bar(page).boundingBox()).toMatchObject({ y: 0, height: 48 });
    const first = await page.locator("main > *").first().boundingBox();
    expect(first, "main has content").not.toBeNull();
    expect(first!.y, "content is not under the bar").toBeGreaterThanOrEqual(48);
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
      window.scrollTo(0, 800);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect((await bar(page).boundingBox())!.y).toBe(0);
  });

  test("only the current page shows a label; every item is a link named in full", async ({ page }) => {
    await gotoValuation(page);
    await expect(primary(page).getByRole("link")).toHaveCount(9);
    const current = primary(page).getByRole("link", { name: "Valuation" });
    await expect(current).toHaveText("Valuation");
    await expect(current).toHaveAttribute("aria-current", "page");
    const other = primary(page).getByRole("link", { name: "Portfolio" });
    await expect(other).toHaveText("");
    await expect(other).toHaveAttribute("title", "Portfolio");
  });

  test("hover opens the panel, and leaving closes it after a short delay", async ({ page }) => {
    await gotoValuation(page);
    await expect(panel(page)).toBeHidden();
    await page.getByTestId("topnav-menu").hover();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByText("Powered by FastAPI & Next.js")).toBeVisible();
    await page.mouse.move(640, 650);
    await page.waitForTimeout(60);
    await expect(panel(page), "still open inside the 150ms grace").toBeVisible();
    await expect(panel(page)).toBeHidden({ timeout: 2_000 });
  });

  test("keyboard focus entering the menu opens it", async ({ page }) => {
    await gotoValuation(page);
    await primary(page).getByRole("link").first().focus();
    await expect(panel(page)).toBeVisible();
  });

  test("clicking ☰ after hovering pins the panel open; clicking again closes it", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).hover();
    await expect(panel(page)).toBeVisible();
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    await page.mouse.move(640, 650);
    await page.waitForTimeout(400);
    await expect(panel(page), "a pinned panel ignores pointer leave").toBeVisible();
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
  });

  test("Escape and an outside click close it", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await menuButton(page).click();
    await expect(panel(page)).toBeVisible();
    await page.mouse.click(640, 650);
    await expect(panel(page)).toBeHidden();
  });

  test("navigating from the panel closes it", async ({ page }) => {
    await gotoValuation(page);
    await menuButton(page).click();
    await panel(page).getByRole("link", { name: "Cases" }).click();
    await expect(page).toHaveURL(/\/cases$/, { timeout: 60_000 });
    await expect(panel(page)).toBeHidden();
  });

  test("the language toggle does not open the menu", async ({ page }) => {
    await gotoValuation(page);
    await page.getByRole("button", { name: "한국어" }).click();
    await expect(page.getByRole("link", { name: "가치평가" })).toBeVisible();
    await page.waitForTimeout(200);
    await expect(panel(page)).toBeHidden();
  });
});

test.describe("below 768px", () => {
  test.use({ viewport: { width: 600, height: 800 } });

  test("the bar shows the page name and ☰; hover does not open the menu, ☰ does", async ({ page }) => {
    await gotoValuation(page);
    await expect(primary(page)).toBeHidden();
    await expect(page.getByTestId("topnav-current")).toHaveText("Valuation");
    await page.getByTestId("topnav-menu").hover();
    await page.waitForTimeout(200);
    await expect(panel(page)).toBeHidden();
    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page).getByRole("link", { name: "Portfolio" })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `npx playwright test tests/e2e/topnav.spec.ts --workers=2`. Expected: every test FAILS on `#app-topnav` not being visible.

- [ ] **Step 3: Catalog entries.** In `lib/i18n/messages/en.ts`, after the `nav: { … },` block, add:

```ts
  navShort: {
    market: "Market", portfolio: "Portfolio", news: "News", corporate: "Corporate", monteCarlo: "Monte Carlo",
    decisions: "Decisions", valuation: "Valuation", cases: "Cases", events: "Events",
  },
  topnav: { primary: "Primary", full: "All pages", menu: "Menu", poweredBy: "Powered by FastAPI & Next.js" },
```

In `ko.ts`, after `nav: { … },`, add:

```ts
  navShort: {
    market: "시장", portfolio: "포트폴리오", news: "뉴스", corporate: "기업 분석", monteCarlo: "몬테카를로",
    decisions: "의사결정", valuation: "가치평가", cases: "케이스", events: "이벤트",
  },
  topnav: { primary: "주 메뉴", full: "전체 페이지", menu: "메뉴", poweredBy: "Powered by FastAPI & Next.js" },
```

In `docs/design/MoneyView_Glossary.md`, after the row `| Events | 이벤트 | nav |`, add:

```markdown
| Menu | 메뉴 | top bar ☰ button |
| Primary | 주 메뉴 | top bar icon-link landmark |
| All pages | 전체 페이지 | top bar panel landmark |
| Market / Corporate / Decisions (short) | 시장 / 기업 분석 / 의사결정 | top bar current-page label |
```

- [ ] **Step 4: Shared nav list** (`apps/web/components/ui/navItems.ts`)

```ts
import type { LucideIcon } from "lucide-react";
import { Building2, CalendarDays, GitFork, LayoutDashboard, Newspaper, NotebookPen, Orbit, PieChart, Scale } from "lucide-react";
import type { MessageKey } from "@/lib/i18n/translate";

export interface NavItem {
  href: string;
  /** Full name: aria-label and title on the bar icon, text in the panel. */
  key: MessageKey;
  /** Short label shown next to the current page's icon. */
  shortKey: MessageKey;
  icon: LucideIcon;
}

// Same list, order, paths and icons as the old Sidebar (spec 2026-10-14 §1).
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", key: "nav.market", shortKey: "navShort.market", icon: LayoutDashboard },
  { href: "/portfolio", key: "nav.portfolio", shortKey: "navShort.portfolio", icon: PieChart },
  { href: "/news", key: "nav.news", shortKey: "navShort.news", icon: Newspaper },
  { href: "/corporate", key: "nav.corporate", shortKey: "navShort.corporate", icon: Building2 },
  { href: "/monte-carlo", key: "nav.monteCarlo", shortKey: "navShort.monteCarlo", icon: Orbit },
  { href: "/decisions", key: "nav.decisions", shortKey: "navShort.decisions", icon: NotebookPen },
  { href: "/valuation", key: "nav.valuation", shortKey: "navShort.valuation", icon: Scale },
  { href: "/cases", key: "nav.cases", shortKey: "navShort.cases", icon: GitFork },
  { href: "/events", key: "nav.events", shortKey: "navShort.events", icon: CalendarDays },
];

/** Prefix match, so /cases/2 is still "Cases" (plan N7). "/" matches only itself. */
export function activeNavItem(pathname: string): NavItem | null {
  return NAV_ITEMS.find((item) => (
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
  )) ?? null;
}
```

- [ ] **Step 5: The bar** (`apps/web/components/ui/TopNav.tsx`)

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FocusEvent, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import clsx from "clsx";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { NAV_ITEMS, activeNavItem } from "@/components/ui/navItems";
import { useT } from "@/lib/i18n/locale";
import { tokens } from "@/lib/tokens.generated";

/** Spec §1/§9: the panel closes this long after the pointer leaves; it opens with no delay. */
const CLOSE_DELAY_MS = 150;
const WIDE_QUERY = `(min-width: ${tokens.bp.tablet})`;

/** `path` keys the open state to the page it was opened on, so navigating closes it without an
 *  effect. `pinned` = opened with ☰ (plan N6): pointer leave does not close it. */
type MenuState = { path: string; pinned: boolean } | null;

const PANEL_LINK = "flex items-center gap-3 rounded-[var(--radius-1)] px-3 py-2 type-body font-bold text-[var(--ink)] hover:bg-[var(--surface-raised)]";

export function TopNav() {
  const pathname = usePathname();
  const t = useT();
  const [menu, setMenu] = useState<MenuState>(null);
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const open = menu !== null && menu.path === pathname;
  const pinned = open && menu.pinned;
  const current = activeNavItem(pathname);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Hover and focus open it only on wide screens; below 768px only ☰ does (spec §1).
  const openTransient = () => {
    if (!window.matchMedia(WIDE_QUERY).matches) return;
    cancelClose();
    setMenu((m) => (m !== null && m.path === pathname ? m : { path: pathname, pinned: false }));
  };
  const closeSoon = () => {
    if (pinned) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setMenu((m) => (m?.pinned ? m : null));
    }, CLOSE_DELAY_MS);
  };
  const close = () => {
    cancelClose();
    setMenu(null);
  };
  const toggle = () => {
    cancelClose();
    setMenu(pinned ? null : { path: pathname, pinned: true });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (zoneRef.current && !zoneRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  return (
    <header id="app-topnav" className="fixed inset-x-0 top-0 z-40 h-12 border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="flex h-full items-center gap-4 px-4 lg:px-8">
        <div className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 bg-[var(--brand)]" />
          <span className="type-panel-title text-[var(--ink)]">MoneyView</span>
        </div>

        {/* The hover/focus zone is the menu cluster only (plan N5): the logo and the language
            toggle stay outside it, so clicking the toggle never opens the panel. */}
        <div
          ref={zoneRef}
          data-testid="topnav-menu"
          className="relative flex h-full min-w-0 flex-1 items-center gap-2"
          onMouseEnter={openTransient}
          onMouseLeave={closeSoon}
          onFocus={openTransient}
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeSoon();
          }}
        >
          <nav aria-label={t("topnav.primary")} className="hidden h-full items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = item.href === current?.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={t(item.key)}
                  title={t(item.key)}
                  aria-current={isActive ? "page" : undefined}
                  onClick={close}
                  className={clsx(
                    "flex h-8 items-center gap-2 rounded-[var(--radius-1)] px-2 text-[var(--ink)] hover:bg-[var(--surface-raised)]",
                    isActive && "bg-[var(--surface-raised)]",
                  )}
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />
                  {isActive && <span className="type-caption font-bold uppercase">{t(item.shortKey)}</span>}
                </Link>
              );
            })}
          </nav>
          <span data-testid="topnav-current" className="type-body font-bold text-[var(--ink)] md:hidden">
            {current ? t(current.shortKey) : ""}
          </span>
          <button
            type="button"
            aria-label={t("topnav.menu")}
            aria-expanded={open}
            aria-controls="app-nav-panel"
            onClick={toggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-1)] text-[var(--ink)] hover:bg-[var(--surface-raised)]"
          >
            <Menu aria-hidden="true" className="h-4 w-4" />
          </button>

          {/* Overlay, no scrim. `hidden` when closed keeps it out of the a11y tree and out of the
              pointer's way (spec §9). The links keep the old sidebar's look (DS Task 8). */}
          <div
            id="app-nav-panel"
            hidden={!open}
            className="absolute left-0 top-full z-40 w-64 border border-[var(--line)] bg-[var(--surface)] p-4"
          >
            <nav aria-label={t("topnav.full")} className="flex flex-col gap-2">
              {NAV_ITEMS.map((item) => {
                const isActive = item.href === current?.href;
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={close} className={clsx(PANEL_LINK, isActive && "bg-[var(--surface-raised)]")}>
                    {isActive && <span aria-hidden="true" className="h-4 w-0.5 bg-[var(--brand)]" />}
                    <Icon aria-hidden="true" className="h-5 w-5" />
                    {t(item.key)}
                  </Link>
                );
              })}
            </nav>
            <div className="type-caption mt-4 text-[var(--ink-muted)]">{t("topnav.poweredBy")}</div>
          </div>
        </div>

        <div className="shrink-0">
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 6: The shell.** Replace `apps/web/components/ui/AppShell.tsx` with:

```tsx
"use client";

import type { ReactNode } from "react";
import { TopNav } from "@/components/ui/TopNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopNav />
      {/* The vertical padding is published as custom properties because a page that wants
          to fill the viewport has to subtract it, and a descendant cannot measure this box
          in CSS. PortfolioShell reads both. Top = the 48px bar + 16px (spec §1: pt-16). */}
      <main className="px-4 pt-[var(--main-pad-top)] pb-[var(--main-pad-bottom)] [--main-pad-bottom:1rem] [--main-pad-top:4rem] lg:px-8 lg:[--main-pad-bottom:5rem]">
        {children}
      </main>
    </div>
  );
}
```

Delete `apps/web/components/ui/Sidebar.tsx`. Then run `git grep -n "Sidebar\|setSidebarOpen" -- apps/web/app apps/web/components apps/web/lib`. Expected: no hits.

- [ ] **Step 7: Run the new tests.** `npx playwright test tests/e2e/topnav.spec.ts --workers=2`. Expected: PASS (9 tests).

- [ ] **Step 8: Approved edits #1–#5.** Apply exactly the replacements in inventory rows #1–#5. Then run `npx playwright test tests/e2e/sidebar-contrast.spec.ts tests/e2e/paper-identity.spec.ts tests/e2e/events-page.spec.ts tests/e2e/i18n.spec.ts tests/e2e/cases.spec.ts tests/e2e/decisions.spec.ts tests/e2e/valuation.spec.ts tests/e2e/responsive-accessibility.spec.ts --workers=2`. Expected: PASS. The last five are on the "unaffected" list; if one fails, stop and report it.

- [ ] **Step 9: Gates.** `npm run typecheck && npm run lint && npm run test:unit`, then `npm run design:baseline -- components/ui/TopNav.tsx components/ui/navItems.ts components/ui/AppShell.tsx`. Expected: 0 in every category.

- [ ] **Step 10: Mutation matrix** (back up and restore as in Global Constraints)

| Mutation (one at a time) | Must fail |
|---|---|
| `const open = menu !== null;` (ignores the path) **and** both `onClick={close}` removed | `navigating from the panel closes it` |
| `CLOSE_DELAY_MS = 0` | `hover opens the panel, and leaving closes it…` ("still open inside the 150ms grace") |
| `closeSoon` body reduced to `return;` | `hover opens the panel…` (final `toBeHidden`) |
| `onFocus={openTransient}` removed | `keyboard focus entering the menu opens it` |
| `toggle` body → `setMenu(open ? null : { path: pathname, pinned: true });` | `clicking ☰ after hovering pins the panel open…` |
| `onMouseEnter`/`onMouseLeave` moved from the zone `div` to `<header>` | `the language toggle does not open the menu` |
| `openTransient` without the `matchMedia` guard | `below 768px …` |
| `onKey` body emptied | `Escape and an outside click close it` |
| `AppShell` `[--main-pad-top:4rem]` → `[--main-pad-top:2rem]` | `is 48px tall … content starts below it` |
| `{isActive && <span …shortKey…>}` → always rendered | `only the current page shows a label…` |
| `<header … fixed …>` → `absolute` | `… it stays put on scroll` |

- [ ] **Step 11: Commit.** Mark `C3` in `todo.md`.

```bash
git add apps/web/components/ui apps/web/lib/i18n apps/web/tests/e2e/topnav.spec.ts apps/web/tests/e2e/sidebar-contrast.spec.ts apps/web/tests/e2e/paper-identity.spec.ts apps/web/tests/e2e/events-page.spec.ts docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(shell): fixed top bar with a hover/focus/menu panel replaces the left sidebar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pure corporate models (verdict label, assumption rows and sensitivity bodies, substituted formula, peer rank, detail tabs)

**Files:**
- Create: `apps/web/app/corporate/verdict.ts`, `apps/web/app/corporate/assumptionRows.ts`, `apps/web/app/corporate/substitutedFormula.ts`, `apps/web/app/corporate/peerRank.ts`, `apps/web/app/corporate/detailTabs.ts`, `apps/web/tests/e2e/corporate-model.spec.ts`
- Modify: `apps/web/lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md`, `guideline/sop/todo.md`

**Interfaces:**
- Consumes: `dcfRequestBody(snapshot: DcfRequestSnapshot)` (`corporateUtils.ts:51`), `DcfRequestSnapshot`, `CorporateAssumptions`, `CorporateComparisonRowApi` (`corporateTypes.ts`), `CalculationDetailKey` (`components/calculationDetailTypes.ts`), `CorporateMetricAuditEntry` (`packages/shared-types`), `isBridgeUnresolved` (`@/lib/bridgeQuality`), `LabelKey`.
- Produces:
  - `verdictLabelKey(status: string): LabelKey | null`; labels `undervalued`, `overvalued`, `bridgeIncomplete`
  - `type AssumptionKey`, `type AssumptionField`, `interface AssumptionRowDef { key; field: AssumptionField | null; min; max; step; suffix: "%" | ""; dcf: { field: DcfField; snapshotField: SnapshotField; delta: number } | null }`, `ASSUMPTION_ROWS`, `assumptionRow(key): AssumptionRowDef | null`, `formatAssumption(row, value): string`, `formatDelta(row): string`, `interface SensitivitySide { value: number; clamped: boolean; body: DcfRequestBody }`, `interface SensitivityPlan { field; current; delta; down; up }`, `sensitivityPlan(snapshot, key): SensitivityPlan | null`
  - `interface FormulaContext`, `substitutedFormula(key, ctx): string | null`
  - `type PeerField = "roic" | "wacc" | "roic_minus_wacc" | "dcf_implied_return"`, `type PeerRank`, `peerRank(rows, field, ticker): PeerRank`
  - `DETAIL_TABS`, `type DetailTabKey = "summary" | "steps" | "trend" | "peers" | "sensitivity" | "raw"`, `TREND_FIELDS`, `PEER_FIELDS`, `availableDetailTabs(key): DetailTabKey[]`, `resolveDetailTab(stored: unknown, available): DetailTabKey`

Finance-logic SOP check: none of these modules introduces a formula. `sensitivityPlan` offsets one assumption and calls the existing `dcfRequestBody`. `substitutedFormula` prints operands and results the page already computed. `peerRank` sorts. State this in the commit body.

- [ ] **Step 1: Write the failing model spec** (`apps/web/tests/e2e/corporate-model.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import { verdictLabelKey } from "../../app/corporate/verdict";
import { ASSUMPTION_ROWS, assumptionRow, formatDelta, sensitivityPlan } from "../../app/corporate/assumptionRows";
import { substitutedFormula, type FormulaContext } from "../../app/corporate/substitutedFormula";
import { peerRank } from "../../app/corporate/peerRank";
import { availableDetailTabs, resolveDetailTab } from "../../app/corporate/detailTabs";
import { dcfRequestBody } from "../../app/corporate/corporateUtils";
import type { CorporateComparisonRowApi, DcfRequestSnapshot } from "../../app/corporate/corporateTypes";

test.describe("verdictLabelKey", () => {
  test("maps the three backend statuses and nothing else", () => {
    expect(verdictLabelKey("Undervalued")).toBe("undervalued");
    expect(verdictLabelKey("Overvalued")).toBe("overvalued");
    expect(verdictLabelKey("Bridge Incomplete")).toBe("bridgeIncomplete");
    expect(verdictLabelKey("Fairly Valued")).toBeNull();
    expect(verdictLabelKey("undervalued")).toBeNull();
  });

  test("verdictLabelKey reads only its own keys", () => {
    for (const inherited of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(verdictLabelKey(inherited), inherited).toBeNull();
    }
  });
});

const SNAPSHOT: DcfRequestSnapshot = {
  ticker: "AAPL", growth: 6, roic: 18, wacc: 10, debtRatio: 18, unleveredBeta: 1.05,
  crp: 0.8, reinvestment: 34, fcff: 92, esgPenalty: 22,
};

test.describe("sensitivityPlan (spec §4.1)", () => {
  const cases = [
    ["growth", "revenue_growth_rate", 0.05, 0.07],
    ["roic", "operating_margin", 0.16, 0.2],
    ["wacc", "wacc", 0.09, 0.11],
    ["reinvestment", "reinvestment", 24, 44],
    ["unleveredBeta", "unlevered_beta", 0.95, 1.15],
    ["debtRatio", "debt_ratio", 8, 28],
    ["esgPenalty", "esg_penalty", 12, 32],
  ] as const;

  for (const [key, field, down, up] of cases) {
    test(`${key} moves only ${field}, by its spec delta`, () => {
      const base = dcfRequestBody(SNAPSHOT) as Record<string, number>;
      const plan = sensitivityPlan(SNAPSHOT, key);
      expect(plan, key).not.toBeNull();
      expect(plan!.field).toBe(field);
      const downBody = plan!.down.body as Record<string, number>;
      const upBody = plan!.up.body as Record<string, number>;
      expect(downBody[field]).toBeCloseTo(down, 10);
      expect(upBody[field]).toBeCloseTo(up, 10);
      for (const other of Object.keys(base).filter((name) => name !== field)) {
        expect(downBody[other], `${key} down leaves ${other}`).toBe(base[other]);
        expect(upBody[other], `${key} up leaves ${other}`).toBe(base[other]);
      }
    });
  }

  test("a step past the slider range is clamped and flagged", () => {
    const wacc = assumptionRow("wacc")!;
    const plan = sensitivityPlan({ ...SNAPSHOT, wacc: wacc.min + 0.5 }, "wacc")!;
    expect(plan.down).toMatchObject({ value: wacc.min, clamped: true });
    expect(plan.up).toMatchObject({ value: wacc.min + 1.5, clamped: false });
    const esg = assumptionRow("esgPenalty")!;
    const high = sensitivityPlan({ ...SNAPSHOT, esgPenalty: esg.max - 5 }, "esgPenalty")!;
    expect(high.up).toMatchObject({ value: esg.max, clamped: true });
  });

  test("the beta step is rounded, not drifted", () => {
    const plan = sensitivityPlan(SNAPSHOT, "unleveredBeta")!;
    expect(plan.down.value).toBe(0.95);
    expect((plan.down.body as Record<string, number>).unlevered_beta).toBe(0.95);
  });

  test("assumptions the DCF does not use have no plan", () => {
    for (const key of ["innovation", "governance", "crp", "spread", "backendDcf"] as const) {
      expect(sensitivityPlan(SNAPSHOT, key), key).toBeNull();
    }
  });

  test("the step is printed in the assumption's own unit", () => {
    expect(formatDelta(assumptionRow("growth")!)).toBe("1.0%p");
    expect(formatDelta(assumptionRow("unleveredBeta")!)).toBe("0.10");
    expect(formatDelta(assumptionRow("esgPenalty")!)).toBe("10");
    expect(ASSUMPTION_ROWS.map((row) => row.key)).toEqual([
      "growth", "roic", "wacc", "debtRatio", "unleveredBeta", "crp", "reinvestment", "innovation", "governance", "esgPenalty",
    ]);
  });
});

const CTX: FormulaContext = {
  roic: 21.3, wacc: 9.4, reinvestment: 34, unleveredBeta: 1.05,
  spread: 11.9, bottomUpKe: 10.6, leveredBeta: 1.12, sustainableGrowth: 7.2, debtToEquity: 0.22,
  riskFreeRate: 4.2, impliedErp: 5.1, impliedMarketReturn: 9.3, countryRiskPremium: 0.8, taxRate: 0.25,
  waccAudit: null,
  dcf: { intrinsic: 240.5, price: 210.4, upside: 14.31 },
};

const WACC_AUDIT = {
  value: 8.8, display_value: "8.8%", method: "latest_capital_structure", quality: "ok" as const, reason: null,
  warnings: [], confidence: 0.9, source: "test", as_of: "2025-12-31", calculation_version: "wacc_v2",
  inputs_used: [
    { field: "equity_weight", label: "Equity weight", value: 0.82, display_value: "82.0%", source: "t" },
    { field: "cost_of_equity", label: "Cost of equity", value: 0.1, display_value: "10.0%", source: "t" },
    { field: "debt_weight", label: "Debt weight", value: 0.18, display_value: "18.0%", source: "t" },
    { field: "cost_of_debt", label: "Cost of debt", value: 0.041, display_value: "4.1%", source: "t" },
    { field: "tax_rate", label: "Tax rate", value: 0.21, display_value: "21.0%", source: "t" },
    { field: "final_wacc_value", label: "Final WACC value", value: 8.8, display_value: "8.8%", source: "t" },
  ],
};

test.describe("substitutedFormula (plan N2)", () => {
  test("each operand lands in its own slot", () => {
    expect(substitutedFormula("spread", CTX)).toBe("ROIC − WACC = 21.3% − 9.4% = 11.9%");
    expect(substitutedFormula("bottomUpKe", CTX)).toBe("Ke = rf + βL × ERP + CRP = 4.2% + 1.12 × 5.1% + 0.8% = 10.6%");
    expect(substitutedFormula("leveredBeta", CTX)).toBe("βL = βU × [1 + (1 − t) × D/E] = 1.05 × [1 + (1 − 25.0%) × 0.22] = 1.12");
    expect(substitutedFormula("sustainableGrowth", CTX)).toBe("g = reinvestment × ROIC = 34.0% × 21.3% = 7.2%");
    expect(substitutedFormula("erp", CTX)).toBe("ERP = IRR − rf = 9.3% − 4.2% = 5.1%");
    expect(substitutedFormula("backendFairValue", CTX)).toBe("Upside = intrinsic ÷ price − 1 = $240.5 ÷ $210.4 − 1 = +14.3%");
  });

  test("prints the page's result, never recomputes it", () => {
    // Inconsistent on purpose: a formatter that recomputed ROIC − WACC would print 8.0%.
    expect(substitutedFormula("spread", { ...CTX, roic: 18, wacc: 10, spread: 7.7 })).toBe("ROIC − WACC = 18.0% − 10.0% = 7.7%");
  });

  test("WACC uses the audit's six inputs and needs all of them", () => {
    expect(substitutedFormula("wacc", { ...CTX, waccAudit: WACC_AUDIT }))
      .toBe("WACC = E/V × Ke + D/V × Kd × (1 − t) = 82.0% × 10.0% + 18.0% × 4.1% × (1 − 21.0%) = 8.8%");
    const missingKd = { ...WACC_AUDIT, inputs_used: WACC_AUDIT.inputs_used.filter((input) => input.field !== "cost_of_debt") };
    expect(substitutedFormula("wacc", { ...CTX, waccAudit: missingKd })).toBeNull();
    expect(substitutedFormula("wacc", CTX)).toBeNull();
  });

  test("the ERP identity is withheld when the zero floor bit", () => {
    expect(substitutedFormula("erp", { ...CTX, impliedMarketReturn: 3.9, impliedErp: 0 })).toBeNull();
  });

  test("an unbridged DCF has no substituted formula", () => {
    expect(substitutedFormula("backendDcf", { ...CTX, dcf: { intrinsic: null, price: 210.4, upside: null } })).toBeNull();
    expect(substitutedFormula("backendDcf", { ...CTX, dcf: null })).toBeNull();
  });

  test("metrics whose operands are not on the page get none", () => {
    for (const key of ["growth", "roic", "debtRatio", "crp", "hurdleDecomposition", "terminalValueShare"] as const) {
      expect(substitutedFormula(key, CTX), key).toBeNull();
    }
  });
});

function row(ticker: string, over: Partial<CorporateComparisonRowApi> = {}): CorporateComparisonRowApi {
  return {
    ticker, name: ticker, sector: "Technology", group_name: "core", weight: 0.1,
    roic: 10, wacc: 9, roic_minus_wacc: 1, dcf_value: 100, current_price: 90, dcf_implied_return: 5,
    capm_expected_return: 9, stock_expected_return: null, market_expected_return: 9.7,
    market_implied_return: null, implied_return_spread: null, implied_return_refusal: null, dcf_refusal: null,
    stock_expected_return_source: "test", has_price_data: true, bridge_quality: "ok", ...over,
  };
}

test.describe("peerRank", () => {
  test("ranks high to low among non-benchmark rows, with the band and position", () => {
    const rows = [row("A", { roic: 20 }), row("B", { roic: 10 }), row("C", { roic: 15 }), row("^GSPC", { group_name: "benchmark", roic: 99 })];
    expect(peerRank(rows, "roic", "c")).toEqual({ state: "ranked", value: 15, rank: 2, count: 3, min: 10, max: 20, position: 0.5 });
  });

  test("an unbridged row's 0.0 upside is not a peer value", () => {
    const rows = [row("A", { dcf_implied_return: 12 }), row("MISS", { bridge_quality: "missing", dcf_implied_return: 0 }), row("B", { dcf_implied_return: -4 })];
    expect(peerRank(rows, "dcf_implied_return", "A")).toMatchObject({ rank: 1, count: 2, min: -4, max: 12 });
    expect(peerRank(rows, "dcf_implied_return", "MISS")).toEqual({ state: "noValue" });
  });

  test("a refused row's null is left out, and a ticker outside the universe is absent", () => {
    const rows = [row("A", { dcf_implied_return: 3 }), row("BURN", { dcf_implied_return: null })];
    expect(peerRank(rows, "dcf_implied_return", "A")).toMatchObject({ count: 1, position: 0.5 });
    expect(peerRank(rows, "dcf_implied_return", "ZZZ")).toEqual({ state: "absent" });
  });
});

test.describe("detail tabs", () => {
  test("each metric gets only the tabs it has data for", () => {
    expect(availableDetailTabs("growth")).toEqual(["summary", "steps", "trend", "sensitivity", "raw"]);
    expect(availableDetailTabs("roic")).toEqual(["summary", "steps", "trend", "peers", "sensitivity", "raw"]);
    expect(availableDetailTabs("crp")).toEqual(["summary", "steps", "sensitivity", "raw"]);
    expect(availableDetailTabs("spread")).toEqual(["summary", "steps", "peers", "raw"]);
    expect(availableDetailTabs("hurdleDecomposition")).toEqual(["summary", "steps", "raw"]);
  });

  test("a stored tab the metric lacks resolves to summary", () => {
    expect(resolveDetailTab("trend", availableDetailTabs("crp"))).toBe("summary");
    expect(resolveDetailTab("peers", availableDetailTabs("spread"))).toBe("peers");
    for (const junk of [null, 42, "bogus", "constructor"]) {
      expect(resolveDetailTab(junk, availableDetailTabs("roic"))).toBe("summary");
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `npx playwright test tests/e2e/corporate-model.spec.ts --workers=2`. Expected: FAIL to load, because the module `../../app/corporate/verdict` cannot be found.

- [ ] **Step 3: Labels.** In `lib/i18n/labels.ts`, add inside `LABELS`:

```ts
  undervalued: ["저평가", "Undervalued"],
  overvalued: ["고평가", "Overvalued"],
  bridgeIncomplete: ["주당가치 산출 불가", "Per-share value unavailable"],
```

Glossary rows (after the `| Change | 등락률 | … |` row):

```markdown
| Undervalued | 저평가 | label (DCF status "Undervalued"; translated, never re-thresholded) |
| Overvalued | 고평가 | label (DCF status "Overvalued") |
| Per-share value unavailable | 주당가치 산출 불가 | label (DCF status "Bridge Incomplete") |
```

- [ ] **Step 4: `apps/web/app/corporate/verdict.ts`**

```ts
import type { LabelKey } from "@/lib/i18n/labels";

// The backend's DCF status (corporate_dcf.py:321-323), translated only (spec D5): the frontend
// adds no threshold. Anything else is shown as sent.
const STATUS_LABELS: Record<string, LabelKey> = {
  Undervalued: "undervalued",
  Overvalued: "overvalued",
  "Bridge Incomplete": "bridgeIncomplete",
};

export function verdictLabelKey(status: string): LabelKey | null {
  // Own keys only: a status of "constructor" must not resolve to Object's prototype.
  return Object.hasOwn(STATUS_LABELS, status) ? STATUS_LABELS[status] : null;
}
```

- [ ] **Step 5: `apps/web/app/corporate/assumptionRows.ts`**

```ts
import type { CalculationDetailKey } from "./components/calculationDetailTypes";
import type { CorporateAssumptions, DcfRequestSnapshot } from "./corporateTypes";
import { dcfRequestBody } from "./corporateUtils";

export type AssumptionKey =
  | "growth" | "roic" | "wacc" | "debtRatio" | "unleveredBeta" | "crp"
  | "reinvestment" | "innovation" | "governance" | "esgPenalty";
export type AssumptionField = Exclude<keyof CorporateAssumptions, "ticker" | "crp" | "fcff" | "marketShare">;
export type DcfRequestBody = ReturnType<typeof dcfRequestBody>;
type DcfField = keyof DcfRequestBody;
type SnapshotField = Exclude<keyof DcfRequestSnapshot, "ticker">;

export interface AssumptionRowDef {
  key: AssumptionKey;
  /** The assumption its slider edits; null for the fixed country risk premium. */
  field: AssumptionField | null;
  min: number;
  max: number;
  step: number;
  suffix: "%" | "";
  /** The DCF request field it feeds and its sensitivity step, in slider units (spec §4.1). */
  dcf: { field: DcfField; snapshotField: SnapshotField; delta: number } | null;
}

// Slider ranges are the ones CorporateAssumptionsPanel used (deleted in Task 5).
export const ASSUMPTION_ROWS: readonly AssumptionRowDef[] = [
  { key: "growth", field: "growth", min: -5, max: 20, step: 0.5, suffix: "%", dcf: { field: "revenue_growth_rate", snapshotField: "growth", delta: 1 } },
  { key: "roic", field: "roic", min: -5, max: 45, step: 0.5, suffix: "%", dcf: { field: "operating_margin", snapshotField: "roic", delta: 2 } },
  { key: "wacc", field: "wacc", min: 2, max: 24, step: 0.25, suffix: "%", dcf: { field: "wacc", snapshotField: "wacc", delta: 1 } },
  { key: "debtRatio", field: "debtRatio", min: 0, max: 90, step: 1, suffix: "%", dcf: { field: "debt_ratio", snapshotField: "debtRatio", delta: 10 } },
  { key: "unleveredBeta", field: "unleveredBeta", min: 0.4, max: 2.5, step: 0.05, suffix: "", dcf: { field: "unlevered_beta", snapshotField: "unleveredBeta", delta: 0.1 } },
  { key: "crp", field: null, min: 0, max: 0, step: 0, suffix: "%", dcf: null },
  { key: "reinvestment", field: "reinvestment", min: 0, max: 90, step: 1, suffix: "%", dcf: { field: "reinvestment", snapshotField: "reinvestment", delta: 10 } },
  { key: "innovation", field: "innovation", min: 0, max: 100, step: 1, suffix: "", dcf: null },
  { key: "governance", field: "governance", min: 0, max: 100, step: 1, suffix: "", dcf: null },
  { key: "esgPenalty", field: "esgPenalty", min: 0, max: 100, step: 1, suffix: "", dcf: { field: "esg_penalty", snapshotField: "esgPenalty", delta: 10 } },
];

export function assumptionRow(key: CalculationDetailKey): AssumptionRowDef | null {
  return ASSUMPTION_ROWS.find((row) => row.key === key) ?? null;
}

/** How the table and the slider print a value: percent 1 dp, beta 2 dp, scores 1 dp (plan N11). */
export function formatAssumption(row: AssumptionRowDef, value: number): string {
  if (row.suffix === "%") return `${value.toFixed(1)}%`;
  return row.key === "unleveredBeta" ? value.toFixed(2) : value.toFixed(1);
}

/** The sensitivity step in the assumption's unit: "1.0%p", "0.10", "10". */
export function formatDelta(row: AssumptionRowDef): string {
  const delta = row.dcf?.delta ?? 0;
  if (row.suffix === "%") return `${delta.toFixed(1)}%p`;
  return row.key === "unleveredBeta" ? delta.toFixed(2) : delta.toFixed(0);
}

export interface SensitivitySide {
  value: number;
  /** True when the step crossed the slider range and the value was pulled back to it. */
  clamped: boolean;
  body: DcfRequestBody;
}

export interface SensitivityPlan {
  field: DcfField;
  current: number;
  delta: number;
  down: SensitivitySide;
  up: SensitivitySide;
}

// 1.05 - 0.1 is 0.9500000000000001 in floating point; the request must carry 0.95.
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** The two DCF request bodies of the sensitivity tab: only this assumption moves, by ±delta,
 *  clamped to its slider range; every other field is the current snapshot's (spec §4.1). */
export function sensitivityPlan(snapshot: DcfRequestSnapshot, key: CalculationDetailKey): SensitivityPlan | null {
  const row = assumptionRow(key);
  const dcf = row?.dcf;
  if (!row || !dcf) return null;
  const current = snapshot[dcf.snapshotField];
  const side = (raw: number): SensitivitySide => {
    const target = round6(raw);
    const value = Math.min(Math.max(target, row.min), row.max);
    return { value, clamped: value !== target, body: dcfRequestBody({ ...snapshot, [dcf.snapshotField]: value }) };
  };
  return { field: dcf.field, current, delta: dcf.delta, down: side(current - dcf.delta), up: side(current + dcf.delta) };
}
```

- [ ] **Step 6: `apps/web/app/corporate/substitutedFormula.ts`**

```ts
import type { CorporateMetricAuditEntry } from "../../../../packages/shared-types";
import type { CalculationDetailKey } from "./components/calculationDetailTypes";

/** Values the page already computed (page.tsx `derived`, constants, the WACC audit, the DCF). */
export interface FormulaContext {
  roic: number;
  wacc: number;
  reinvestment: number;
  unleveredBeta: number;
  spread: number;
  bottomUpKe: number;
  leveredBeta: number;
  sustainableGrowth: number;
  debtToEquity: number;
  riskFreeRate: number;
  impliedErp: number;
  impliedMarketReturn: number;
  countryRiskPremium: number;
  /** A fraction: 0.25. */
  taxRate: number;
  waccAudit: CorporateMetricAuditEntry | null;
  /** Bridged values only (bridgedEstimatedValue / bridgedUpsidePct); null where suppressed. */
  dcf: { intrinsic: number | null; price: number; upside: number | null } | null;
}

const p = (value: number) => `${value.toFixed(1)}%`;
const n2 = (value: number) => value.toFixed(2);
const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

function auditInput(entry: CorporateMetricAuditEntry | null, field: string): number | null {
  const value = entry?.inputs_used.find((input) => input.field === field)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The formula with the page's own numbers substituted (spec §4 summary tab, plan N2). It formats
 * operands and the result the page already holds and computes nothing; null when an operand is
 * not on the page, and the summary then shows only the symbolic formula.
 */
export function substitutedFormula(key: CalculationDetailKey, c: FormulaContext): string | null {
  switch (key) {
    case "spread":
      return `ROIC − WACC = ${p(c.roic)} − ${p(c.wacc)} = ${p(c.spread)}`;
    case "bottomUpKe":
      return `Ke = rf + βL × ERP + CRP = ${p(c.riskFreeRate)} + ${n2(c.leveredBeta)} × ${p(c.impliedErp)} + ${p(c.countryRiskPremium)} = ${p(c.bottomUpKe)}`;
    case "leveredBeta":
      return `βL = βU × [1 + (1 − t) × D/E] = ${n2(c.unleveredBeta)} × [1 + (1 − ${p(c.taxRate * 100)}) × ${n2(c.debtToEquity)}] = ${n2(c.leveredBeta)}`;
    case "sustainableGrowth":
      return `g = reinvestment × ROIC = ${p(c.reinvestment)} × ${p(c.roic)} = ${p(c.sustainableGrowth)}`;
    case "erp":
      // impliedErp is max(IRR − rf, 0) (page.tsx): the identity holds only when the floor did not bite.
      return c.impliedMarketReturn - c.riskFreeRate < 0
        ? null
        : `ERP = IRR − rf = ${p(c.impliedMarketReturn)} − ${p(c.riskFreeRate)} = ${p(c.impliedErp)}`;
    case "wacc": {
      const equityWeight = auditInput(c.waccAudit, "equity_weight");
      const costOfEquity = auditInput(c.waccAudit, "cost_of_equity");
      const debtWeight = auditInput(c.waccAudit, "debt_weight");
      const costOfDebt = auditInput(c.waccAudit, "cost_of_debt");
      const tax = auditInput(c.waccAudit, "tax_rate");
      const result = auditInput(c.waccAudit, "final_wacc_value");
      if (equityWeight === null || costOfEquity === null || debtWeight === null || costOfDebt === null || tax === null || result === null) {
        return null;
      }
      return `WACC = E/V × Ke + D/V × Kd × (1 − t) = ${p(equityWeight * 100)} × ${p(costOfEquity * 100)} + ${p(debtWeight * 100)} × ${p(costOfDebt * 100)} × (1 − ${p(tax * 100)}) = ${p(result)}`;
    }
    case "backendDcf":
    case "backendFairValue":
      if (!c.dcf || c.dcf.intrinsic === null || c.dcf.upside === null) return null;
      return `Upside = intrinsic ÷ price − 1 = ${money(c.dcf.intrinsic)} ÷ ${money(c.dcf.price)} − 1 = ${signed(c.dcf.upside)}`;
    default:
      return null;
  }
}
```

- [ ] **Step 7: `apps/web/app/corporate/peerRank.ts`**

```ts
import { isBridgeUnresolved } from "@/lib/bridgeQuality";
import type { CorporateComparisonRowApi } from "./corporateTypes";

export type PeerField = "roic" | "wacc" | "roic_minus_wacc" | "dcf_implied_return";

export type PeerRank =
  | { state: "absent" }
  | { state: "noValue" }
  | { state: "ranked"; value: number; rank: number; count: number; min: number; max: number; position: number };

function peerValue(row: CorporateComparisonRowApi, field: PeerField): number | null {
  // An unresolved bridge makes the backend send dcf_implied_return = 0.0 (a hardcoded value,
  // corporate_comparison.py), not a measured upside: never rank it (lib/bridgeQuality.ts).
  if (field === "dcf_implied_return" && isBridgeUnresolved(row.bridge_quality)) return null;
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Where `ticker` sits among the non-benchmark rows of the current comparison, high to low. */
export function peerRank(rows: readonly CorporateComparisonRowApi[], field: PeerField, ticker: string): PeerRank {
  const peers = rows.filter((row) => row.group_name !== "benchmark");
  const self = peers.find((row) => row.ticker.toUpperCase() === ticker.toUpperCase());
  if (!self) return { state: "absent" };
  const value = peerValue(self, field);
  if (value === null) return { state: "noValue" };
  const values = peers.map((row) => peerValue(row, field)).filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    state: "ranked",
    value,
    rank: values.filter((v) => v > value).length + 1,
    count: values.length,
    min,
    max,
    position: max === min ? 0.5 : (value - min) / (max - min),
  };
}
```

- [ ] **Step 8: `apps/web/app/corporate/detailTabs.ts`**

```ts
import type { CalculationDetailKey } from "./components/calculationDetailTypes";
import { ASSUMPTION_ROWS } from "./assumptionRows";
import type { PeerField } from "./peerRank";

export const DETAIL_TABS = ["summary", "steps", "trend", "peers", "sensitivity", "raw"] as const;
export type DetailTabKey = (typeof DETAIL_TABS)[number];

/** Plan N1: /corporate/metrics/{t}/history carries annual values for these two only. */
export const TREND_FIELDS: Partial<Record<CalculationDetailKey, "annual_growth_rates" | "annual_roic">> = {
  growth: "annual_growth_rates",
  roic: "annual_roic",
};

/** The comparison-row field each metric is positioned on in the Peers tab (spec §4, part A). */
export const PEER_FIELDS: Partial<Record<CalculationDetailKey, PeerField>> = {
  roic: "roic",
  wacc: "wacc",
  spread: "roic_minus_wacc",
  backendDcf: "dcf_implied_return",
  backendFairValue: "dcf_implied_return",
};

export function availableDetailTabs(key: CalculationDetailKey): DetailTabKey[] {
  return DETAIL_TABS.filter((tab) => {
    if (tab === "trend") return Object.hasOwn(TREND_FIELDS, key);
    if (tab === "peers") return Object.hasOwn(PEER_FIELDS, key);
    if (tab === "sensitivity") return ASSUMPTION_ROWS.some((row) => row.key === key);
    return true;
  });
}

/** The remembered tab when this metric has it, else Summary (spec §4). It never writes the memory. */
export function resolveDetailTab(stored: unknown, available: readonly DetailTabKey[]): DetailTabKey {
  return typeof stored === "string" && (available as readonly string[]).includes(stored) ? (stored as DetailTabKey) : "summary";
}
```

- [ ] **Step 9: Run.** `npx playwright test tests/e2e/corporate-model.spec.ts --workers=2`. Expected: PASS. If the spec cannot load `corporateUtils` because of an import side effect, stop and report it; do not restructure `corporateUtils.ts`.

- [ ] **Step 10: Gates.** `npm run typecheck && npm run lint && npm run test:unit`.

- [ ] **Step 11: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `verdictLabelKey`: `return STATUS_LABELS[status] ?? null;` | `verdictLabelKey reads only its own keys` |
| `"Bridge Incomplete": "bridgeIncomplete"` entry removed | `maps the three backend statuses and nothing else` |
| `peerValue` without the `isBridgeUnresolved` line | `an unbridged row's 0.0 upside is not a peer value` |
| `peerRank` without the benchmark filter | `ranks high to low among non-benchmark rows…` |
| `side`: `const value = target;` (no clamp) | `a step past the slider range is clamped and flagged` |
| `side`: `const target = raw;` (no `round6`) | `the beta step is rounded, not drifted` |
| `side` body built from `dcfRequestBody(snapshot)` (unchanged snapshot) | every `… moves only …, by its spec delta` |
| `ASSUMPTION_ROWS` `wacc` delta `1` → `0.25` | `wacc moves only wacc, by its spec delta` |
| `"spread"` branch ends `= ${p(c.roic - c.wacc)}` | `prints the page's result, never recomputes it` |
| `"erp"` branch without the `< 0` guard | `the ERP identity is withheld when the zero floor bit` |
| WACC branch: missing inputs default to `0` instead of returning null | `WACC uses the audit's six inputs and needs all of them` |
| DCF branch without `c.dcf.upside === null` | `an unbridged DCF has no substituted formula` |
| `availableDetailTabs`: `if (tab === "trend") return true;` | `each metric gets only the tabs it has data for` |
| `resolveDetailTab` returns `stored as DetailTabKey` unchecked | `a stored tab the metric lacks resolves to summary` |

- [ ] **Step 12: Commit.** Mark `C4` in `todo.md`.

```bash
git add apps/web/app/corporate/verdict.ts apps/web/app/corporate/assumptionRows.ts apps/web/app/corporate/substitutedFormula.ts apps/web/app/corporate/peerRank.ts apps/web/app/corporate/detailTabs.ts apps/web/lib/i18n/labels.ts apps/web/tests/e2e/corporate-model.spec.ts docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(corporate): pure models for the verdict label, sensitivity bodies, substituted formulas, peer rank and detail tabs" -m "No new finance logic: the modules translate, offset one assumption through dcfRequestBody, format values the page already computed, or sort." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: First screen: verdict block, KPI row, assumption table (spec §2.2–§2.4)

**Files:**
- Create: `apps/web/app/corporate/components/VerdictBlock.tsx`, `apps/web/app/corporate/components/KpiRow.tsx`, `apps/web/app/corporate/components/AssumptionTable.tsx`, `apps/web/tests/e2e/corporate-one-screen.spec.ts`
- Modify: `apps/web/app/corporate/page.tsx`, `apps/web/lib/i18n/messages/{en,ko}.ts`, `apps/web/lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md`, `guideline/sop/todo.md`
- Delete: `apps/web/app/corporate/components/CorporateAssumptionsPanel.tsx`
- Approved test edits: inventory #6–#8, plus the helper import row #56 where it applies (none in this task: #6–#8 need no helper)

**Interfaces:**
- Consumes: Task 4 `verdictLabelKey`, `ASSUMPTION_ROWS`, `formatAssumption`, `AssumptionField`, `AssumptionRowDef`; DS components `Card`, `KPIBlock`, `DeltaBadge`, `Eyebrow`, `BilingualLabel`, `ActionButton`, `MetricQualityBadge`, `fieldInputClass`; existing `RangeControl`, `formatAuditMetricValue` (`@/lib/metricAudit`), `bridgedEstimatedValue`, `bridgedUpsidePct`, `UNBRIDGED_REASON`, `moneyText`, `pct`, `numberText2`, `dateTimeText`.
- Produces:
  - `VerdictBlock({ dcf: DcfSummary | null; streaming: boolean; refusalText: string | null; onOpenDetail: () => void })`. DOM: `[data-testid="corporate-verdict"][data-state="idle|streaming|valued|refused"]`, `[data-part="intrinsic"]`, `[data-part="price"]`, `[data-part="ev"]` (only when unbridged), `[data-part="label"]`, a `DeltaBadge`, `[data-testid="dcf-refusal"]` (refused), and the button "Verdict detail".
  - `VerdictStatusLabel({ status: string })` (reused by the modal in Task 8)
  - `KpiRow({ spread; bottomUpKe; wacc; leveredBeta; onOpenDetail: (key: CalculationDetailKey) => void })`. DOM: `[data-testid="corporate-kpis"]` with four `role="button"` tiles named "ROIC - WACC…", "Bottom-up Ke…", "WACC…", "Levered Beta…".
  - `AssumptionTable(props: AssumptionTableProps)` (interface in Step 6). DOM: `[data-testid="assumption-table"]`, `[data-testid="assumption-scroll"]` (the 288 px scroll region), `[data-testid="assumption-row-<key>"]`, `[data-testid="assumption-slider-<key>"]`, buttons "Edit <label>", "<label> detail", "Assumption options", "Assumptions detail", `[data-testid="assumption-menu"]`, `[data-testid="source-data-status"]`
  - catalog keys `corporate.verdict.*`, `corporate.kpi.*`, `corporate.assumptions.*`, `corporate.assumption.<AssumptionKey>`; labels `verdict`, `assumptions`, `item`, `value`, `status`

- [ ] **Step 1: Write the failing tests** (`apps/web/tests/e2e/corporate-one-screen.spec.ts`; later tasks append to it)

```ts
import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi, type CorporatePageMockStats } from "./helpers/corporatePageMock";

// Spec 2026-10-14 §2 and §7 tests 1-5.
const SUMMARY = {
  report_id: "verdict-1", ticker: "AAPL", estimated_value: 240.5, intrinsic_value_per_share: 240.5 as number | null,
  enterprise_value: 1462.4, equity_value: 1300.2, valuation_method: "fcff_equity_bridge", bridge_quality: "ok",
  current_price: 210.4, upside_pct: 14.31, terminal_value_share_pct: 70.71, wacc_minus_terminal_growth: null,
  terminal_growth_binding_constraint: null, status: "Undervalued", generated_at: "2026-10-14T00:00:00Z",
};

/** The SSE body the page's DCF stream reads, with one summary. */
function dcfStream(overrides: Partial<typeof SUMMARY>) {
  const summary = { ...SUMMARY, ...overrides };
  return [
    "event: phase1", `data: ${JSON.stringify({ phase: "phase1", summary })}`, "",
    "event: complete", `data: ${JSON.stringify({ phase: "complete", report_id: summary.report_id, generated_at: summary.generated_at })}`, "", "",
  ].join("\n");
}

function newStats(): CorporatePageMockStats {
  return {
    dcfRequests: 0, dcfFullReportRequests: 0, dcfBulkReportRequests: 0, comparisonRequests: 0,
    metricSaveRequests: 0, metricHistoryRequests: 0, quarterlyRequests: 0, ohlcvRequests: 0,
  };
}

async function gotoCorporate(page: Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}

const verdict = (page: Page) => page.getByTestId("corporate-verdict");

test.describe("the verdict block", () => {
  const cases = [
    { name: "Undervalued", overrides: { status: "Undervalued", upside_pct: 14.31 }, label: "Undervalued", dir: "up", glyph: "▲", value: "+14.3%", intrinsic: "$240.5" },
    { name: "Overvalued", overrides: { status: "Overvalued", estimated_value: 190.2, intrinsic_value_per_share: 190.2, upside_pct: -9.6 }, label: "Overvalued", dir: "down", glyph: "▼", value: "-9.6%", intrinsic: "$190.2" },
    { name: "Bridge Incomplete", overrides: { status: "Bridge Incomplete", bridge_quality: "missing", intrinsic_value_per_share: null, estimated_value: 1462.4, upside_pct: 0 }, label: "Per-share value unavailable", dir: "flat", glyph: "■", value: "—", intrinsic: "—" },
    { name: "an unknown status", overrides: { status: "Fairly Valued", upside_pct: 0.4 }, label: "Fairly Valued", dir: "up", glyph: "▲", value: "+0.4%", intrinsic: "$240.5" },
  ] as const;

  for (const c of cases) {
    test(`${c.name} reads "${c.label}" with ${c.glyph} ${c.value}`, async ({ page }) => {
      await mockCorporatePageApi(page);
      await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) =>
        route.fulfill({ status: 200, contentType: "text/event-stream", body: dcfStream(c.overrides) }));
      await gotoCorporate(page);
      await page.getByRole("button", { name: "Refresh DCF" }).click();
      await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
      await expect(verdict(page).locator('[data-part="label"]')).toContainText(c.label);
      await expect(verdict(page).locator('[data-part="intrinsic"]')).toHaveText(c.intrinsic);
      const badge = verdict(page).getByTestId("delta-badge");
      await expect(badge).toHaveAttribute("data-dir", c.dir);
      await expect(badge.locator('[aria-hidden="true"]')).toHaveText(c.glyph);
      await expect(badge.locator('[data-part="value"]')).toHaveText(c.value);
    });
  }

  test("an unbridged verdict puts the EV beside the empty per-share slot, labelled as EV", async ({ page }) => {
    await mockCorporatePageApi(page);
    await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) => route.fulfill({
      status: 200, contentType: "text/event-stream",
      body: dcfStream({ status: "Bridge Incomplete", bridge_quality: "missing", intrinsic_value_per_share: null, estimated_value: 1462.4, upside_pct: 0 }),
    }));
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page).locator('[data-part="ev"]')).toHaveText("EV $1,462.4", { timeout: 30_000 });
    await expect(verdict(page).locator('[data-part="intrinsic"]')).not.toContainText("1,462.4");
  });

  test("before any DCF it says DCF not calculated, never N/A, and asks for nothing", async ({ page }) => {
    const stats = newStats();
    await mockCorporatePageApi(page, stats);
    await gotoCorporate(page);
    await expect(verdict(page)).toHaveAttribute("data-state", "idle");
    await expect(verdict(page)).toContainText("DCF not calculated");
    await expect(verdict(page)).not.toContainText("N/A");
    await expect(page.getByTestId("corporate-kpis")).not.toContainText("N/A");
    await page.waitForTimeout(300);
    expect(stats.dcfRequests).toBe(0);
  });

  test("a refusal is shown inside the verdict block as content", async ({ page }) => {
    await mockCorporatePageApi(page);
    await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) => route.fulfill({
      status: 422, contentType: "application/json",
      body: JSON.stringify({ detail: { code: "non_positive_fcff", message: "Free cash flow is zero or negative over the forecast, so the model cannot value it." } }),
    }));
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "refused");
    await expect(verdict(page).getByTestId("dcf-refusal")).toContainText("zero or negative over the forecast");
  });

  test("Verdict detail opens the Intrinsic DCF calculation", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Verdict detail" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /Apple Intrinsic DCF$/ })).toBeVisible();
  });
});

test("the four KPI tiles open their own details", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  const kpis = page.getByTestId("corporate-kpis");
  await expect(kpis.getByRole("button")).toHaveCount(4);
  for (const [tile, heading] of [
    [/^ROIC - WACC/, /ROIC - WACC Spread/],
    [/^Bottom-up Ke/, /Bottom-up Ke/],
    [/^WACC/, /Apple WACC$/],
    [/^Levered Beta/, /Apple Levered Beta/],
  ] as const) {
    await kpis.getByRole("button", { name: tile }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: heading })).toBeVisible();
    await dialog.getByRole("button", { name: "Close modal" }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test.describe("the assumption table", () => {
  test("✎ opens one row's slider at a time, and moving it saves like before", async ({ page }) => {
    const stats = newStats();
    await mockCorporatePageApi(page, stats);
    await gotoCorporate(page);
    const table = page.getByTestId("assumption-table");
    await expect(table.getByRole("slider")).toHaveCount(0);
    await table.getByRole("button", { name: "Edit Growth Rate" }).click();
    await expect(page.getByTestId("assumption-slider-growth")).toBeVisible();
    await table.getByRole("button", { name: "Edit WACC" }).click();
    await expect(page.getByTestId("assumption-slider-wacc")).toBeVisible();
    await expect(page.getByTestId("assumption-slider-growth")).toHaveCount(0);
    await expect(table.getByRole("slider")).toHaveCount(1);
    await table.getByRole("button", { name: "Edit WACC" }).click();
    await expect(table.getByRole("slider")).toHaveCount(0);

    await table.getByRole("button", { name: "Edit Growth Rate" }).click();
    await page.getByTestId("assumption-slider-growth").getByRole("slider").fill("8");
    await expect(page.getByTestId("assumption-row-growth")).toContainText("8.0%");
    await expect.poll(() => stats.metricSaveRequests).toBe(1);
  });

  test("the fixed country risk premium has no slider, and ⓘ opens a row's detail", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    const table = page.getByTestId("assumption-table");
    await expect(table.getByRole("button", { name: "Edit Country Risk Premium" })).toHaveCount(0);
    await table.getByRole("button", { name: "Debt Ratio detail" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /Apple Debt Ratio/ })).toBeVisible();
  });

  test("the ⋯ menu holds the source refresh, the ROIC basis and the growth basis", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await expect(page.getByRole("button", { name: "Refresh source data" })).toHaveCount(0);
    await page.getByRole("button", { name: "Assumption options" }).click();
    const menu = page.getByTestId("assumption-menu");
    await expect(menu.getByRole("button", { name: "Refresh source data" })).toBeVisible();
    await expect(menu.getByLabel("ROIC Basis")).toBeVisible();
    await expect(menu.getByText("Growth Basis")).toBeVisible();
    await expect(page.getByTestId("source-data-status")).toContainText("Source data stays idle on first load until refreshed.");
  });
});
```

- [ ] **Step 2: Run to see them fail.** `npx playwright test tests/e2e/corporate-one-screen.spec.ts --workers=2`. Expected: FAIL; `corporate-verdict`, `corporate-kpis` and `assumption-table` are not found.

- [ ] **Step 3: Labels and glossary.** In `lib/i18n/labels.ts`, add inside `LABELS`:

```ts
  verdict: ["판정", "Verdict"],
  assumptions: ["가정", "Assumptions"],
  item: ["항목", "Item"],
  value: ["값", "Value"],
  status: ["상태", "Status"],
```

Glossary rows:

```markdown
| Verdict | 판정 | label (corporate verdict block) |
| Assumptions | 가정 | label (corporate assumption table) |
| Item / Value / Status | 항목 / 값 / 상태 | label (table headers) |
| Intrinsic value per share unavailable | 주당가치 산출 불가 | verdict, Bridge Incomplete |
| DCF not calculated | DCF 미계산 | verdict idle state |
| Value creation / Value destruction | 가치 창출 / 가치 훼손 | ROIC - WACC caption |
| Levered beta / Unlevered beta | 레버리지 베타 / 비레버리지 베타 | |
| Country risk premium | 국가위험프리미엄 | |
| Reinvestment rate | 재투자율 | |
| Source data | 원천 데이터 | |
```

- [ ] **Step 4: Catalog.** In `en.ts`, add a top-level `corporate` namespace (later tasks add keys inside it):

```ts
  corporate: {
    verdict: {
      detail: "Verdict detail", intrinsic: "Intrinsic value", vs: "vs", current: "Current price",
      idle: "DCF not calculated · use Refresh DCF above", streaming: "Calculating…",
      refused: "Not valued: {reason}", ev: "EV {value}",
    },
    kpi: {
      spread: "ROIC - WACC", ke: "Bottom-up Ke", wacc: "WACC", beta: "Levered Beta",
      spreadUp: "Value creation", spreadDown: "Value destruction",
      keCaption: "rf + beta x implied ERP + CRP", waccCaption: "Discount rate in the DCF", betaCaption: "Hamada adjusted",
    },
    assumptions: {
      detail: "Assumptions detail", menu: "Assumption options", edit: "Edit {label}", info: "{label} detail", actions: "Actions",
      refreshSource: "Refresh source data", roicBasis: "ROIC Basis", roicYear: "ROIC Year",
      basisRecent: "Recent multi-year average", basisAll: "All available years average", basisAnnual: "Select annual value",
      yearUnavailable: "Unavailable", growthBasis: "Growth Basis",
      growthDefault: "Growth Rate now stays on the stable CAGR path. Annual growth rates remain available in View Details for context.",
      updated: "Last updated {time}", notLoaded: "Not loaded yet",
      sourceIdle: "Source data stays idle on first load until refreshed.",
      staleSource: "Cached source data is for {cached}. Refresh for {ticker}.",
      fixed: "Fixed",
    },
    assumption: {
      growth: "Growth Rate", roic: "ROIC", wacc: "WACC", debtRatio: "Debt Ratio", unleveredBeta: "Unlevered Beta",
      crp: "Country Risk Premium", reinvestment: "Reinvestment Rate", innovation: "Innovation Index",
      governance: "Governance Quality", esgPenalty: "ESG / Agency Penalty",
    },
  },
```

In `ko.ts`:

```ts
  corporate: {
    verdict: {
      detail: "판정 상세", intrinsic: "내재가치", vs: "대비", current: "현재가",
      idle: "DCF 미계산 · 위의 DCF 새로고침을 누르세요", streaming: "계산 중…",
      refused: "평가하지 않음: {reason}", ev: "기업가치(EV) {value}",
    },
    kpi: {
      spread: "ROIC - WACC", ke: "상향식 Ke", wacc: "WACC", beta: "레버리지 베타",
      spreadUp: "가치 창출", spreadDown: "가치 훼손",
      keCaption: "무위험수익률 + 베타 × 내재 ERP + CRP", waccCaption: "DCF 할인율", betaCaption: "하마다 조정",
    },
    assumptions: {
      detail: "가정 상세", menu: "가정 옵션", edit: "{label} 편집", info: "{label} 상세", actions: "동작",
      refreshSource: "원천 데이터 새로고침", roicBasis: "ROIC 기준", roicYear: "ROIC 연도",
      basisRecent: "최근 다년 평균", basisAll: "전체 연도 평균", basisAnnual: "연도별 값 선택",
      yearUnavailable: "없음", growthBasis: "성장 기준",
      growthDefault: "성장률은 안정 CAGR 기준을 씁니다. 연도별 성장률은 상세 보기에서 볼 수 있습니다.",
      updated: "갱신 {time}", notLoaded: "아직 불러오지 않았습니다",
      sourceIdle: "원천 데이터는 새로고침할 때까지 불러오지 않습니다.",
      staleSource: "저장된 원천 데이터는 {cached} 기준입니다. {ticker}로 새로고침하세요.",
      fixed: "고정",
    },
    assumption: {
      growth: "성장률", roic: "ROIC", wacc: "WACC", debtRatio: "부채비율", unleveredBeta: "비레버리지 베타",
      crp: "국가위험프리미엄", reinvestment: "재투자율", innovation: "혁신지수",
      governance: "지배구조 품질", esgPenalty: "ESG/대리인 페널티",
    },
  },
```

- [ ] **Step 5: `apps/web/app/corporate/components/VerdictBlock.tsx`**

```tsx
"use client";

import { Info } from "lucide-react";
import type { DcfSummary } from "../../../../../packages/shared-types";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { bridgedEstimatedValue, bridgedUpsidePct, UNBRIDGED_REASON } from "@/lib/bridgeQuality";
import { MISSING } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import { moneyText } from "../corporateUtils";
import { verdictLabelKey } from "../verdict";

/** The DCF status, translated only (spec D5); an unknown status is shown as sent. */
export function VerdictStatusLabel({ status }: { status: string }) {
  const key = verdictLabelKey(status);
  return (
    <span data-part="label" className="type-caption inline-flex rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-0.5 uppercase text-[var(--ink)]">
      {key ? <BilingualLabel k={key} /> : status}
    </span>
  );
}

interface VerdictBlockProps {
  dcf: DcfSummary | null;
  streaming: boolean;
  refusalText: string | null;
  onOpenDetail: () => void;
}

// Spec §2.2: intrinsic value vs price and the upside, under the backend's own status label.
export function VerdictBlock({ dcf, streaming, refusalText, onOpenDetail }: VerdictBlockProps) {
  const t = useT();
  const state = refusalText !== null ? "refused" : dcf ? "valued" : streaming ? "streaming" : "idle";
  const intrinsic = dcf ? bridgedEstimatedValue(dcf) : null;
  const upside = dcf ? bridgedUpsidePct(dcf) : null;
  // A value restored from an older session cache can lack enterprise_value.
  const enterpriseValue = dcf && typeof dcf.enterprise_value === "number" ? dcf.enterprise_value : null;

  return (
    <section data-testid="corporate-verdict" data-state={state}>
      <Card padding="sm" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow label="verdict" />
          <button
            type="button"
            onClick={onOpenDetail}
            aria-label={t("corporate.verdict.detail")}
            title={t("corporate.verdict.detail")}
            className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-1)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            <Info aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {state === "refused" ? (
          <p data-testid="dcf-refusal" className="type-body text-[var(--ink-secondary)]">
            {t("corporate.verdict.refused", { reason: refusalText ?? "" })}
          </p>
        ) : state === "idle" ? (
          <p className="type-body text-[var(--ink-muted)]">{t("corporate.verdict.idle")}</p>
        ) : state === "streaming" || !dcf ? (
          <p className="type-body text-[var(--ink-muted)]">{t("corporate.verdict.streaming")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="type-small text-[var(--ink-muted)]">{t("corporate.verdict.intrinsic")}</span>
              <span data-part="intrinsic" className="type-figure-md text-[var(--ink)]" title={intrinsic === null ? UNBRIDGED_REASON : undefined}>
                {intrinsic === null ? MISSING : moneyText(intrinsic)}
              </span>
              <span className="type-small text-[var(--ink-muted)]">{t("corporate.verdict.vs")} {t("corporate.verdict.current")}</span>
              <span data-part="price" className="type-mono text-[var(--ink)]">{moneyText(dcf.current_price)}</span>
            </div>
            {intrinsic === null && enterpriseValue !== null ? (
              <span data-part="ev" className="type-small text-[var(--ink-muted)]">
                {t("corporate.verdict.ev", { value: moneyText(enterpriseValue) })}
              </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <DeltaBadge value={upside} />
              <VerdictStatusLabel status={dcf.status} />
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
```

- [ ] **Step 6: `apps/web/app/corporate/components/KpiRow.tsx`**

```tsx
"use client";

import { Card } from "@/components/ui/Card";
import { KPIBlock } from "@/components/ui/KPIBlock";
import { useT } from "@/lib/i18n/locale";
import { numberText2, pct } from "../corporateUtils";
import type { CalculationDetailKey } from "./calculationDetailTypes";

interface KpiRowProps {
  spread: number;
  bottomUpKe: number;
  wacc: number;
  leveredBeta: number;
  onOpenDetail: (key: CalculationDetailKey) => void;
}

// Spec §2.3: ROIC - WACC, Bottom-up Ke, WACC, levered beta; one-line caption; the tile opens
// its detail. The numbers behind each caption are in the detail's substituted formula.
export function KpiRow({ spread, bottomUpKe, wacc, leveredBeta, onOpenDetail }: KpiRowProps) {
  const t = useT();
  const tiles: { key: CalculationDetailKey; label: string; value: string; caption: string }[] = [
    { key: "spread", label: t("corporate.kpi.spread"), value: pct(spread), caption: t(spread >= 0 ? "corporate.kpi.spreadUp" : "corporate.kpi.spreadDown") },
    { key: "bottomUpKe", label: t("corporate.kpi.ke"), value: pct(bottomUpKe), caption: t("corporate.kpi.keCaption") },
    { key: "wacc", label: t("corporate.kpi.wacc"), value: pct(wacc), caption: t("corporate.kpi.waccCaption") },
    { key: "leveredBeta", label: t("corporate.kpi.beta"), value: numberText2(leveredBeta), caption: t("corporate.kpi.betaCaption") },
  ];
  return (
    <div data-testid="corporate-kpis" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.key} padding="sm" hoverable>
          <KPIBlock label={tile.label} value={tile.value} size="sm" onClick={() => onOpenDetail(tile.key)} />
          <p className="type-small mt-1 truncate text-[var(--ink-muted)]">{tile.caption}</p>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: `apps/web/app/corporate/components/AssumptionTable.tsx`**

```tsx
"use client";

import { Fragment, useState } from "react";
import { Info, MoreHorizontal, Pencil } from "lucide-react";
import clsx from "clsx";
import type { CorporateDerivedMetricMeta, CorporateMetricAuditEntry, MetricQuality } from "../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { fieldInputClass } from "@/components/ui/InlineField";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";
import { useT } from "@/lib/i18n/locale";
import { formatAuditMetricValue } from "@/lib/metricAudit";
import { ASSUMPTION_ROWS, formatAssumption, type AssumptionField, type AssumptionKey, type AssumptionRowDef } from "../assumptionRows";
import { KOREA_COUNTRY_RISK_PREMIUM } from "../corporateConstants";
import type { CorporateAssumptions, RoicBasis } from "../corporateTypes";
import { dateTimeText, pct } from "../corporateUtils";
import type { CalculationDetailKey } from "./calculationDetailTypes";
import { RangeControl } from "./RangeControl";

export interface AssumptionTableProps {
  assumptions: CorporateAssumptions;
  onChange: (field: AssumptionField, value: number) => void;
  onOpenDetail: (key: CalculationDetailKey) => void;
  growthMeta: CorporateDerivedMetricMeta | null;
  roicMeta: CorporateDerivedMetricMeta | null;
  roicAudit: CorporateMetricAuditEntry | null;
  waccAudit: CorporateMetricAuditEntry | null;
  sourceTicker: string;
  sourceUpdatedAt: string | null;
  staleSourceTickers: string[];
  sourceIsFetching: boolean;
  hasSourceData: boolean;
  roicYearUnavailableMessage: string;
  onRefreshSourceData: () => void;
  roicBasis: RoicBasis;
  roicYear: string;
  annualRoicValues: { year: number | string; value: number | null }[];
  onRoicBasisChange: (basis: RoicBasis) => void;
  onRoicYearChange: (year: string) => void;
  growthBasisLabel: string;
  className?: string;
}

const ICON_BUTTON = "inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-1)] text-[var(--ink-muted)] hover:text-[var(--ink)]";
const TH = "type-caption px-2 py-1 uppercase text-[var(--ink-muted)]";

function metricMetaReason(meta: CorporateDerivedMetricMeta | null) {
  if (!meta) return "";
  return meta.reason ?? meta.warnings[0] ?? "";
}

// Spec §2.4: one row per assumption (name · value · status · ✎ · ⓘ). ✎ opens that row's slider
// and closes any other; the table scrolls inside a 288px region so the page does not.
export function AssumptionTable(props: AssumptionTableProps) {
  const {
    assumptions, onChange, onOpenDetail, growthMeta, roicMeta, roicAudit, waccAudit,
    sourceTicker, sourceUpdatedAt, staleSourceTickers, sourceIsFetching, hasSourceData, roicYearUnavailableMessage,
    onRefreshSourceData, roicBasis, roicYear, annualRoicValues, onRoicBasisChange, onRoicYearChange, growthBasisLabel, className,
  } = props;
  const t = useT();
  const [expanded, setExpanded] = useState<AssumptionKey | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const display = (row: AssumptionRowDef) => {
    if (row.field === null) return pct(KOREA_COUNTRY_RISK_PREMIUM);
    if (row.key === "roic" && roicAudit) return formatAuditMetricValue(roicAudit);
    if (row.key === "wacc" && waccAudit) return formatAuditMetricValue(waccAudit);
    return formatAssumption(row, assumptions[row.field]);
  };
  const quality = (row: AssumptionRowDef): MetricQuality | null => {
    if (row.key === "growth") return growthMeta?.quality ?? null;
    if (row.key === "roic") return roicAudit?.quality ?? roicMeta?.quality ?? null;
    if (row.key === "wacc") return waccAudit?.quality ?? null;
    return null;
  };

  return (
    <section data-testid="assumption-table" className={clsx("flex min-w-0 flex-col border border-[var(--line)] bg-[var(--surface-raised)]", className)}>
      <div className="relative flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <Eyebrow label="assumptions" />
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t("corporate.assumptions.detail")} title={t("corporate.assumptions.detail")} onClick={() => onOpenDetail("realtime")} className={ICON_BUTTON}>
            <Info aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("corporate.assumptions.menu")}
            title={t("corporate.assumptions.menu")}
            aria-expanded={menuOpen}
            aria-controls="assumption-menu"
            onClick={() => setMenuOpen((open) => !open)}
            className={ICON_BUTTON}
          >
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {menuOpen ? (
          <div id="assumption-menu" data-testid="assumption-menu" className="absolute right-0 top-full z-30 mt-1 flex w-72 flex-col gap-3 rounded-[var(--radius-2)] border border-[var(--line)] bg-[var(--bg)] p-3">
            <ActionButton label={t("corporate.assumptions.refreshSource")} size="sm" variant="secondary" disabled={sourceIsFetching} onClick={onRefreshSourceData} />
            <label className="type-label flex flex-col gap-1 text-[var(--ink)]">
              {t("corporate.assumptions.roicBasis")}
              <select value={roicBasis} onChange={(event) => onRoicBasisChange(event.target.value as RoicBasis)} className={fieldInputClass}>
                <option value="recent_average">{t("corporate.assumptions.basisRecent")}</option>
                <option value="all_year_average">{t("corporate.assumptions.basisAll")}</option>
                <option value="annual">{t("corporate.assumptions.basisAnnual")}</option>
              </select>
            </label>
            {roicBasis === "annual" ? (
              <label className="type-label flex flex-col gap-1 text-[var(--ink)]">
                {t("corporate.assumptions.roicYear")}
                <select value={roicYear} onChange={(event) => onRoicYearChange(event.target.value)} className={fieldInputClass}>
                  {annualRoicValues.map((point) => (
                    <option key={point.year} value={point.year}>
                      {point.year}: {point.value == null ? t("corporate.assumptions.yearUnavailable") : pct(point.value)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="type-label text-[var(--ink)]">{t("corporate.assumptions.growthBasis")}</span>
              <span className="type-body flex items-center gap-2 text-[var(--ink)]">
                {growthBasisLabel}
                {growthMeta ? <MetricQualityBadge quality={growthMeta.quality} /> : null}
              </span>
              <span className="type-small text-[var(--ink-muted)]">{metricMetaReason(growthMeta) || t("corporate.assumptions.growthDefault")}</span>
            </div>
          </div>
        ) : null}
      </div>

      <div data-testid="assumption-scroll" className="max-h-72 overflow-y-auto">
        <table className="w-full table-fixed">
          <thead className="sticky top-0 z-10 bg-[var(--surface-raised)]">
            <tr>
              <th scope="col" className={clsx(TH, "text-left")}><BilingualLabel k="item" /></th>
              <th scope="col" className={clsx(TH, "w-20 text-right")}><BilingualLabel k="value" /></th>
              <th scope="col" className={clsx(TH, "w-24 text-left")}><BilingualLabel k="status" /></th>
              <th scope="col" className="w-16 px-2 py-1"><span className="sr-only">{t("corporate.assumptions.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {ASSUMPTION_ROWS.map((row) => {
              const label = t(`corporate.assumption.${row.key}`);
              const rowQuality = quality(row);
              const field = row.field;
              const isOpen = expanded === row.key && field !== null;
              return (
                <Fragment key={row.key}>
                  <tr data-testid={`assumption-row-${row.key}`} className="border-t border-[var(--grid)]">
                    <th scope="row" className="type-small truncate px-3 py-1.5 text-left font-normal text-[var(--ink)]">{label}</th>
                    <td className="type-mono px-2 py-1.5 text-right text-[var(--ink)]">{display(row)}</td>
                    <td className="px-2 py-1.5">
                      {rowQuality ? <MetricQualityBadge quality={rowQuality} /> : field === null ? <span className="type-small text-[var(--ink-muted)]">{t("corporate.assumptions.fixed")}</span> : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-1">
                        {field !== null ? (
                          <button
                            type="button"
                            aria-label={t("corporate.assumptions.edit", { label })}
                            aria-expanded={isOpen}
                            aria-controls={`assumption-slider-${row.key}`}
                            onClick={() => setExpanded((current) => (current === row.key ? null : row.key))}
                            className={ICON_BUTTON}
                          >
                            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button type="button" aria-label={t("corporate.assumptions.info", { label })} title={t("corporate.assumptions.info", { label })} onClick={() => onOpenDetail(row.key)} className={ICON_BUTTON}>
                          <Info aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && field !== null ? (
                    <tr id={`assumption-slider-${row.key}`} data-testid={`assumption-slider-${row.key}`}>
                      <td colSpan={4} className="px-3 pb-2">
                        <RangeControl
                          label={label}
                          value={assumptions[field]}
                          valueDisplay={display(row)}
                          min={row.min}
                          max={row.max}
                          step={row.step}
                          suffix={row.suffix}
                          onChange={(value) => onChange(field, value)}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div data-testid="source-data-status" className="type-small flex flex-wrap gap-x-2 gap-y-1 border-t border-[var(--line)] px-3 py-2 text-[var(--ink-muted)]">
        <span>{sourceUpdatedAt ? t("corporate.assumptions.updated", { time: dateTimeText(sourceUpdatedAt) }) : t("corporate.assumptions.notLoaded")}</span>
        {staleSourceTickers.length > 0 ? (
          <span className="text-[var(--status-warning-ink)]">
            {t("corporate.assumptions.staleSource", { cached: staleSourceTickers.join(", "), ticker: sourceTicker })}
          </span>
        ) : null}
        {!hasSourceData && !sourceIsFetching ? <span>{t("corporate.assumptions.sourceIdle")}</span> : null}
        {roicYearUnavailableMessage ? <span className="text-[var(--status-error-ink)]">{roicYearUnavailableMessage}</span> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Wire `page.tsx`.** Make these edits; anchors are quoted from the file.
  1. Imports: delete `import { CorporateAssumptionsPanel } from "./components/CorporateAssumptionsPanel";`. Add:
     ```ts
     import { AssumptionTable } from "./components/AssumptionTable";
     import { KpiRow } from "./components/KpiRow";
     import { VerdictBlock } from "./components/VerdictBlock";
     ```
  2. Replace the three lines that define `sourceDataStaleMessage` (they start `const sourceDataStaleMessage = sourceDataIsStale`) with:
     ```ts
     const staleSourceTickers = Array.from(new Set(staleSourceDataTickers));
     ```
  3. In the header JSX, delete the refusal chip `{dcfRefusal && ( <span data-testid="dcf-refusal" …>Not valued: {dcfRefusal.readerText}</span> )}`. The verdict shows it now (spec §6).
  4. Replace everything from `{/* Main analysis grid: assumption controls on the left, valuation cards and charts on the right. */}` up to and including the `</section>` that closes it (just before `{/* Calculation detail modal is mounted only when …`) with the block below. The two elements in the `space-y-4` div are the existing `<CorporateDiagnosticsSection>` and `<TargetStockComparisonSection>`, with their props unchanged:

```tsx
      {/* First screen (spec §2): verdict and KPIs on the left 2/3, the assumption table on the right 1/3. */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
          <VerdictBlock
            dcf={dcfData}
            streaming={dcfStreamStatus === "streaming"}
            refusalText={dcfRefusal?.readerText ?? null}
            onOpenDetail={() => setActiveCalculation("backendDcf")}
          />
          <KpiRow
            spread={derived.spread}
            bottomUpKe={derived.bottomUpKe}
            wacc={assumptions.wacc}
            leveredBeta={derived.leveredBeta}
            onOpenDetail={setActiveCalculation}
          />
        </div>
        <AssumptionTable
          assumptions={assumptions}
          onChange={update}
          onOpenDetail={setActiveCalculation}
          growthMeta={growthMeta}
          roicMeta={roicMeta}
          roicAudit={metricAuditQuery.data?.roic ?? null}
          waccAudit={metricAuditQuery.data?.wacc ?? null}
          sourceTicker={sourceDataTicker}
          sourceUpdatedAt={sourceDataDisplayLastUpdatedAt}
          staleSourceTickers={staleSourceTickers}
          sourceIsFetching={metricsHistoryQuery.isFetching || quarterlyStatementsQuery.isFetching || historicalPricesQuery.isFetching}
          hasSourceData={Boolean(metricsHistoryData) || Boolean(quarterlyStatementsData) || historicalPricesData.length > 0}
          roicYearUnavailableMessage={roicYearUnavailableMessage}
          onRefreshSourceData={handleRefreshSourceData}
          roicBasis={roicBasis}
          roicYear={roicYear}
          annualRoicValues={annualRoicValues}
          onRoicBasisChange={(next) => {
            setRoicBasis(next);
            applyMetricHistorySelection({ nextRoicBasis: next, nextRoicYear: roicYear });
          }}
          onRoicYearChange={(next) => {
            setRoicYear(next);
            applyMetricHistorySelection({ nextRoicYear: next });
          }}
          growthBasisLabel={growthBasisLabel}
        />
      </section>

      <div className="space-y-4">
        <CorporateDiagnosticsSection
          companyName={companyName}
          hurdleBars={hurdleBars}
          regionalHurdle={regionalHurdle}
          assumptionsDebtRatio={assumptions.debtRatio}
          betaTreemapProxy={betaTreemapProxy}
          waccCurve={waccCurve}
          valueMatrix={valueMatrix}
          sustainableGrowth={derived.sustainableGrowth}
          fcff={assumptions.fcff}
          dcfResult={dcfData ?? undefined}
          onOpenDetail={setActiveCalculation}
        />
        <TargetStockComparisonSection
          comparisonData={comparisonData}
          comparisonDisplayLastUpdatedAt={comparisonDisplayLastUpdatedAt}
          comparisonIsStale={comparisonIsStale}
          comparisonUniverse={comparisonUniverse}
          comparisonBenchmarkTicker={comparisonBenchmarkTicker}
          comparisonBenchmarkOptions={PORTFOLIO_BENCHMARK_PRESETS}
          comparisonCustomTickersInput={comparisonCustomTickersInput}
          comparisonSortKey={comparisonSortKey}
          comparisonSortDirection={comparisonSortDirection}
          onComparisonUniverseChange={setComparisonUniverse}
          onComparisonBenchmarkTickerChange={setComparisonBenchmarkTicker}
          onComparisonCustomTickersInputChange={setComparisonCustomTickersInput}
          onComparisonSortKeyChange={setComparisonSortKey}
          onComparisonSortDirectionChange={setComparisonSortDirection}
          onRefreshComparison={handleRefreshComparison}
          onVerifyWatchlistSync={() => {
            void companiesQuery.refetch();
            void watchlistQuery.refetch();
          }}
          onOpenPortfolio={() => router.push("/portfolio")}
          watchlistCoverage={watchlistCoverage}
          watchlistSyncLoading={watchlistQuery.isFetching || companiesQuery.isFetching}
          comparisonIsLoading={comparisonQuery.isLoading}
          comparisonIsFetching={comparisonQuery.isFetching}
          comparisonIsError={comparisonQuery.isError}
          sortedComparisonRows={sortedComparisonRows}
          selectedComparisonTicker={selectedComparisonRow?.ticker ?? ""}
          selectedComparisonSector={selectedComparisonSector}
          similarComparisonBarData={similarComparisonBarData}
          similarComparisonScatterPeers={similarComparisonScatterPeers}
          similarComparisonScatterSelected={similarComparisonScatterSelected}
          currentTicker={assumptions.ticker}
          onSelectTicker={selectTicker}
          onOpenCalculationForTicker={selectTickerAndOpenCalculation}
          bulkDcfReportsLoading={bulkDcfReportsLoading}
          bulkDcfReportsError={bulkDcfReportsError}
          bulkDcfReports={bulkDcfReports}
          bulkDcfReportsLastUpdatedAt={bulkDcfReportsLastUpdatedAt}
          bulkDcfSkipped={bulkDcfSkipped}
          onCalculateAllDcfReports={() => void handleCalculateAllDcfReports()}
          formatPct2={pct2}
          formatMoney={moneyText}
          formatDateTime={dateTimeText}
          formatComparisonUniverseLabel={comparisonUniverseLabel}
        />
      </div>
```

  5. Delete `apps/web/app/corporate/components/CorporateAssumptionsPanel.tsx`.
  6. `npm run lint`. Remove any import this made unused in `page.tsx` (for example `numberText2` if nothing else uses it). Do not remove anything else.

- [ ] **Step 9: Run.** `npx playwright test tests/e2e/corporate-one-screen.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 10: Approved edits #6–#8.** Apply them. Then run `npx playwright test tests/e2e/corporate-*.spec.ts tests/e2e/refresh-idle-state.spec.ts tests/e2e/terminal-diagnostics.spec.ts tests/e2e/high-risk-render-regression.spec.ts tests/e2e/tab-state-persistence.spec.ts tests/e2e/responsive-accessibility.spec.ts --workers=2`. Expected: PASS. No other row is due yet: the tile, View Full Report and the charts are where they were.

- [ ] **Step 11: Gates.** `npm run typecheck && npm run lint && npm run test:unit`. Run `npm run design:baseline -- app/corporate/components/VerdictBlock.tsx app/corporate/components/KpiRow.tsx app/corporate/components/AssumptionTable.tsx`: 0 in every category. `wc -l app/corporate/page.tsx` must print less than 1242.

- [ ] **Step 12: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `VerdictStatusLabel` renders `{status}` always (no label key) | `Bridge Incomplete reads "Per-share value unavailable"…`, `Undervalued reads…` |
| `VerdictBlock`: `const upside = dcf ? dcf.upside_pct : null;` | `Bridge Incomplete reads … ■ —` (value prints `0.0%`) |
| `VerdictBlock` intrinsic slot prints `moneyText(dcf.estimated_value)` | `Bridge Incomplete reads…` and `an unbridged verdict puts the EV beside…` |
| idle branch prints `"N/A"` | `before any DCF it says DCF not calculated, never N/A…` |
| `state` ignores `refusalText` | `a refusal is shown inside the verdict block as content` |
| `KpiRow` WACC tile `key: "spread"` | `the four KPI tiles open their own details` |
| `AssumptionTable` `expanded` becomes a `Set` that adds without removing others | `✎ opens one row's slider at a time…` |
| `RangeControl` `onChange={() => {}}` in the table | `… and moving it saves like before` |
| CRP row gets an Edit button (`field !== null` check removed) | `the fixed country risk premium has no slider…` |
| growth-basis block removed from the menu | `the ⋯ menu holds the source refresh, the ROIC basis and the growth basis` |

- [ ] **Step 13: Commit.** Mark `C5` in `todo.md`.

```bash
git add apps/web/app/corporate apps/web/lib/i18n apps/web/tests/e2e/corporate-one-screen.spec.ts apps/web/tests/e2e/corporate-comparison.spec.ts apps/web/tests/e2e/refresh-idle-state.spec.ts docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(corporate): first screen answers cheap or expensive: verdict, four KPIs, compact assumption table" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Lower tabs: diagnostics, DCF, comparison (spec §3)

**Files:**
- Create: `apps/web/app/corporate/components/CorporateLowerTabs.tsx`, `apps/web/app/corporate/components/DcfTab.tsx`, `apps/web/tests/e2e/helpers/corporateDcf.ts`
- Modify: `apps/web/app/corporate/page.tsx`; `apps/web/app/corporate/components/CorporateDiagnosticsSection.tsx` (crlf, full replacement); `CorporateGraphs.tsx` (crlf); `graphs/HurdleRateDecompositionGraph.tsx`, `graphs/BetaWaccCurveGraph.tsx`, `graphs/ValueDriverMatrixGraph.tsx`, `graphs/DcfCoreModulesGraph.tsx`; `TargetStockComparisonSection.tsx` (crlf); `CorporateComparisonTable.tsx` (crlf); `apps/web/app/corporate/corporateUtils.ts` (crlf; delete `comparisonUniverseLabel`); `lib/i18n/messages/{en,ko}.ts`; `docs/design/MoneyView_Glossary.md`; `apps/web/tests/e2e/corporate-one-screen.spec.ts` (append); `guideline/sop/todo.md`
- Approved test edits: inventory #9–#30, plus import row #56 for the files they touch

**Interfaces:**
- Consumes: `Tabs` (`items`, `activeKey`, `onChange`, `ariaLabel`; it renders `id="tab-<key>"` and `aria-controls="panel-<key>"`), `useTabState`/`tabStateKey`, `DcfCoreModulesGraph`, `DcfSensitivityTable`, `InfoTooltip`, `ActionButton`, `fieldInputClass`, `EmptyState`, `ErrorState`, `LoadingState`.
- Produces:
  - `CorporateLowerTabs({ panels: Record<LowerTabKey, ReactNode> })`, `LOWER_TABS`, `type LowerTabKey = "diagnostics" | "dcf" | "comparison"`. Stored under `moneyview.tab.corporate.lowerTab`. DOM: `[data-testid="corporate-lower-tabs"]`, tablist "Corporate analysis sections", one `role="tabpanel"`. Only the active panel is mounted.
  - `DcfTab(props: DcfTabProps)` (Step 5). Its button is "Load Full Report".
  - `TargetStockComparisonSection` DOM: `[data-testid="comparison-tab"]`, `[data-testid="comparison-about"]`, `[data-testid="comparison-toolbar"]`, `[data-testid="comparison-status"]`, `[data-testid="comparison-table-scroll"]`. Prop `formatComparisonUniverseLabel` removed.
  - `page.tsx`: `loadFullDcfReport(): Promise<void>` loads the report **without** opening the modal. `handleViewFullDcfReport` = open the `backendDcf` modal, then load; Task 7 deletes it.
  - helpers `openLowerTab(page, name: "Core Diagnostics" | "DCF" | "Target Stock Comparison")`, `lowerPanel(page): Locator`
  - catalog keys `corporate.tabs.*`, `corporate.dcfTab.*`, `corporate.comparison.*`

- [ ] **Step 1: Test helpers** (`apps/web/tests/e2e/helpers/corporateDcf.ts`)

```ts
import { expect, type Locator, type Page } from "@playwright/test";

/** The three lower tabs of /corporate (corporate one-screen plan, Task 6). */
export type LowerTabName = "Core Diagnostics" | "DCF" | "Target Stock Comparison";

export async function openLowerTab(page: Page, name: LowerTabName): Promise<void> {
  const tab = page.getByTestId("corporate-lower-tabs").getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** The selected lower tab's panel (never the modal's). */
export function lowerPanel(page: Page): Locator {
  return page.getByTestId("corporate-lower-tabs").getByRole("tabpanel");
}
```

- [ ] **Step 2: Write the failing tests.** Add `import { lowerPanel, openLowerTab } from "./helpers/corporateDcf";` to `corporate-one-screen.spec.ts`, and append:

```ts
test.describe("the lower tabs", () => {
  test("diagnostics is the default, each tab mounts only its own content, and the choice survives leaving the page", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    const tabs = page.getByTestId("corporate-lower-tabs");
    await expect(tabs.getByRole("tab", { name: "Core Diagnostics" })).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page).getByText("Hurdle Rate Decomposition", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("DCF Core Modules")).toHaveCount(0);
    await openLowerTab(page, "DCF");
    await expect(lowerPanel(page).getByText("DCF Core Modules").first()).toBeVisible();
    await expect(page.getByText("Hurdle Rate Decomposition", { exact: true })).toHaveCount(0);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await gotoCorporate(page);
    await expect(tabs.getByRole("tab", { name: "DCF" })).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page).getByText("DCF Core Modules").first()).toBeVisible();
  });

  test("an unknown stored tab falls back to diagnostics", async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem("moneyview.tab.corporate.lowerTab", JSON.stringify("bogus")));
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await expect(page.getByTestId("corporate-lower-tabs").getByRole("tab", { name: "Core Diagnostics" })).toHaveAttribute("aria-selected", "true");
  });

  test("the DCF tab loads the full report only on request, in place, and shows the sensitivity grid", async ({ page }) => {
    const stats = newStats();
    await mockCorporatePageApi(page, stats);
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await openLowerTab(page, "DCF");
    await page.waitForTimeout(300);
    expect(stats.dcfFullReportRequests).toBe(0);
    await lowerPanel(page).getByRole("button", { name: "Load Full Report" }).click();
    await expect(lowerPanel(page).getByText("WACC x Terminal Growth Sensitivity")).toBeVisible({ timeout: 30_000 });
    expect(stats.dcfFullReportRequests).toBe(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the comparison tab is a toolbar, one status line and a scrolling table", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await openLowerTab(page, "Target Stock Comparison");
    await expect(lowerPanel(page).getByText("Comparison stays idle on first load.")).toBeVisible();
    const toolbar = page.getByTestId("comparison-toolbar");
    await expect(toolbar.getByRole("button", { name: "Calculate All DCF Reports" })).toBeDisabled();
    await toolbar.getByRole("button", { name: "Refresh comparison" }).click();
    const status = page.getByTestId("comparison-status");
    await expect(status).toContainText(/Watchlist \d+\/\d+ synced/);
    await expect(status).toContainText("Benchmark: ^GSPC.");
    const scroll = page.getByTestId("comparison-table-scroll");
    await expect(scroll.getByRole("cell", { name: "GOOGL" }).first()).toBeVisible({ timeout: 30_000 });
    expect(await scroll.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    await expect(toolbar.getByRole("button", { name: "Calculate All DCF Reports" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Calculate All/ })).toHaveCount(1);
  });
});
```

- [ ] **Step 3: Run to see them fail.** `npx playwright test tests/e2e/corporate-one-screen.spec.ts -g "the lower tabs" --workers=2`. Expected: FAIL; `corporate-lower-tabs` is not found.

- [ ] **Step 4: Catalog.** Inside `corporate: { … }` in `en.ts` add:

```ts
    tabs: {
      aria: "Corporate analysis sections", diagnostics: "Core Diagnostics", dcf: "DCF", comparison: "Target Stock Comparison",
      about: "About this tab",
      diagnosticsAbout: "Hurdle Rate Decomposition, Bottom-up Beta + WACC U-Curve and the 4-Quadrant Value Driver Matrix. Tap any chart title or bar to open its detailed formula view.",
      dcfAbout: "Left: the four DCF core values. Right: the WACC x terminal growth grid from the full DCF report. The projection rows and CSV exports stay in the calculation detail, Raw data tab.",
    },
    dcfTab: {
      loadReport: "Load Full Report", loading: "Loading full DCF report...", unavailable: "Full DCF Report Unavailable",
      empty: "The grid appears after the full report loads.",
    },
    comparison: {
      universe: "Universe", universeAria: "Comparison universe", benchmarkLabel: "Benchmark", benchmarkAria: "Comparison benchmark",
      customLabel: "Custom tickers", customAria: "Custom tickers", sortLabel: "Sort by", sortAria: "Sort by",
      directionLabel: "Direction", directionAria: "Direction",
      sortImplied: "Implied return vs WACC", sortSpread: "ROIC - WACC", sortDcf: "DCF value", desc: "High to low", asc: "Low to high",
      universeLabel: { portfolio_plus_benchmark: "Portfolio + Benchmark", watchlist_plus_benchmark: "Watchlist + Benchmark", custom: "Custom Universe" },
      refresh: "Refresh comparison", calculateAll: "Calculate All DCF Reports", calculatingAll: "Calculating all DCF reports...",
      verifySync: "Verify Watchlist Sync", verifying: "Verifying the watchlist…",
      synced: "Watchlist {n}/{m} synced", missing: "Missing from Corporate Analysis: {tickers}.",
      benchmark: "Benchmark: {ticker}.", preset: "Selected benchmark preset: {label} ({ticker}).",
      custom: "Custom tickers: {tickers}.", none: "None", notCalculated: "Not calculated yet", stale: "Stale",
      openPortfolio: "Open Portfolio Testing", loading: "Loading comparison rows...",
      errorTitle: "Target Stock Comparison Unavailable", errorBody: "Target stock comparison is currently unavailable.",
      idleTitle: "Comparison stays idle on first load.", idleBody: "Choose the universe, then click Refresh comparison.",
      about: "Lightweight watchlist comparison for tracked names and ad-hoc custom universes. Live watchlist comparison: this tab stays in live mode. Market expected return = risk-free rate {riskFree} + equity risk premium {erp} = {marketReturn}. Stock return method: {stockMethod}. Reference method: {referenceMethod}. Generated live at {generatedAt}. Corporate Analysis checks the live Watchlist Holdings feed against the company registry on each refresh, so mismatches show before you compare names. Weighted portfolio testing, implied cash, snapshots and saved history live on the Portfolio page. Portfolio snapshots and saved history are managed from the Portfolio page only.",
    },
```

In `ko.ts`:

```ts
    tabs: {
      aria: "기업 분석 구역", diagnostics: "진단 차트", dcf: "DCF", comparison: "종목 비교",
      about: "이 탭 설명",
      diagnosticsAbout: "허들레이트 분해, 상향식 베타와 WACC U-커브, 4분면 가치동인 매트릭스입니다. 차트 제목이나 막대를 누르면 계산 상세가 열립니다.",
      dcfAbout: "왼쪽은 DCF 핵심값 네 가지, 오른쪽은 전체 DCF 리포트의 WACC × 영구성장률 민감도표입니다. 예측 행과 CSV 내보내기는 계산 상세의 원천 데이터 탭에 있습니다.",
    },
    dcfTab: {
      loadReport: "리포트 불러오기", loading: "전체 DCF 리포트를 불러오는 중…", unavailable: "전체 DCF 리포트를 불러오지 못했습니다",
      empty: "전체 리포트를 불러오면 민감도표가 보입니다.",
    },
    comparison: {
      universe: "유니버스", universeAria: "비교 유니버스", benchmarkLabel: "벤치마크", benchmarkAria: "비교 벤치마크",
      customLabel: "사용자 지정 티커", customAria: "사용자 지정 티커", sortLabel: "정렬", sortAria: "정렬 기준",
      directionLabel: "방향", directionAria: "정렬 방향",
      sortImplied: "내재수익률 대비 WACC", sortSpread: "ROIC - WACC", sortDcf: "DCF 가치", desc: "높은 순", asc: "낮은 순",
      universeLabel: { portfolio_plus_benchmark: "포트폴리오 + 벤치마크", watchlist_plus_benchmark: "관심종목 + 벤치마크", custom: "사용자 지정 유니버스" },
      refresh: "비교 새로고침", calculateAll: "전체 DCF 계산", calculatingAll: "전체 DCF 계산 중…",
      verifySync: "관심종목 동기화 확인", verifying: "관심종목을 확인하는 중…",
      synced: "관심종목 {n}/{m} 동기화", missing: "기업 분석에 없는 종목: {tickers}.",
      benchmark: "벤치마크: {ticker}.", preset: "선택한 벤치마크: {label} ({ticker}).",
      custom: "사용자 지정 티커: {tickers}.", none: "없음", notCalculated: "아직 계산하지 않았습니다", stale: "오래됨",
      openPortfolio: "포트폴리오에서 테스트", loading: "비교 행을 불러오는 중…",
      errorTitle: "종목 비교를 불러오지 못했습니다", errorBody: "지금은 종목 비교를 쓸 수 없습니다.",
      idleTitle: "종목 비교는 처음 열 때 계산하지 않습니다.", idleBody: "유니버스를 고른 뒤 비교 새로고침을 누르세요.",
      about: "추적 중인 종목과 임시 사용자 지정 유니버스를 가볍게 비교합니다. 이 탭은 실시간 비교만 합니다. 시장 기대수익률 = 무위험수익률 {riskFree} + 주식위험프리미엄 {erp} = {marketReturn}. 종목 수익률 방식: {stockMethod}. 기준 방식: {referenceMethod}. 계산 시각: {generatedAt}. 새로고침할 때마다 관심종목과 기업 목록을 대조하므로, 비교 전에 빠진 종목이 보입니다. 비중 테스트, 현금, 스냅샷과 저장 이력은 포트폴리오 화면에서 관리합니다.",
    },
```

Glossary rows:

```markdown
| Core Diagnostics | 진단 차트 | corporate lower tab |
| Target Stock Comparison | 종목 비교 | corporate lower tab |
| Universe | 유니버스 | comparison universe |
| Watchlist | 관심종목 | |
| Benchmark | 벤치마크 | |
| Load Full Report | 리포트 불러오기 | button |
```

- [ ] **Step 5: `apps/web/app/corporate/components/CorporateLowerTabs.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { tabStateKey, useTabState } from "@/lib/tabState";

export const LOWER_TABS = ["diagnostics", "dcf", "comparison"] as const;
export type LowerTabKey = (typeof LOWER_TABS)[number];

const isLowerTab = (value: unknown): value is LowerTabKey =>
  typeof value === "string" && (LOWER_TABS as readonly string[]).includes(value);

// Spec §3: three tabs under the first screen; the choice is kept per browser tab (lib/tabState).
// Only the active panel is mounted, so a hidden tab's charts and requests do not run.
export function CorporateLowerTabs({ panels }: { panels: Record<LowerTabKey, ReactNode> }) {
  const t = useT();
  const [stored, setStored] = useTabState<string>(tabStateKey("corporate", "lowerTab"), "diagnostics");
  const active: LowerTabKey = isLowerTab(stored) ? stored : "diagnostics";
  return (
    <section data-testid="corporate-lower-tabs" className="flex flex-col gap-4">
      <Tabs
        ariaLabel={t("corporate.tabs.aria")}
        activeKey={active}
        onChange={setStored}
        items={[
          { key: "diagnostics", label: t("corporate.tabs.diagnostics") },
          { key: "dcf", label: t("corporate.tabs.dcf") },
          { key: "comparison", label: t("corporate.tabs.comparison") },
        ]}
      />
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} className="min-w-0">
        {panels[active]}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: `apps/web/app/corporate/components/DcfTab.tsx`**

```tsx
"use client";

import type { DcfFullReport } from "../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useT } from "@/lib/i18n/locale";
import { numberText, pct } from "../corporateUtils";
import { DcfCoreModulesGraph } from "./CorporateGraphs";
import { DcfSensitivityTable } from "./DcfSensitivityTable";
import type { DcfResult, DetailKey } from "./graphs/shared";

export interface DcfTabProps {
  sustainableGrowth: number;
  fcff: number;
  dcfResult?: DcfResult;
  onOpenDetail: (key: DetailKey) => void;
  report: DcfFullReport | null;
  reportLoading: boolean;
  reportError: string | null;
  canLoadReport: boolean;
  onLoadReport: () => void;
}

// Spec §3.2: the DCF core values on the left; the 5x5 grid on the right once the full report is
// loaded, which happens only when asked (the page's idle-on-load rule).
export function DcfTab({ sustainableGrowth, fcff, dcfResult, onOpenDetail, report, reportLoading, reportError, canLoadReport, onLoadReport }: DcfTabProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <span className="type-small self-start text-[var(--ink-muted)]">
        <InfoTooltip label={t("corporate.tabs.about")} description={t("corporate.tabs.dcfAbout")} />
      </span>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DcfCoreModulesGraph sustainableGrowth={sustainableGrowth} fcff={fcff} dcfResult={dcfResult} onOpenDetail={onOpenDetail} />
        <Card padding="md" className="min-w-0">
          {report ? (
            <DcfSensitivityTable sensitivity={report.sensitivity} formatNumber={numberText} formatPct={pct} />
          ) : (
            <div className="flex flex-col items-start gap-3">
              {reportLoading ? (
                <EmptyState title={t("corporate.dcfTab.loading")} />
              ) : reportError ? (
                <ErrorState title={t("corporate.dcfTab.unavailable")} message={reportError} />
              ) : (
                <EmptyState title={t("corporate.dcfTab.empty")} />
              )}
              <ActionButton label={t("corporate.dcfTab.loadReport")} size="sm" variant="secondary" disabled={!canLoadReport || reportLoading} onClick={onLoadReport} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Diagnostics in one row.** Replace `CorporateDiagnosticsSection.tsx` (keep CRLF) with:

```tsx
"use client";

import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useT } from "@/lib/i18n/locale";
import { BetaWaccCurveGraph, HurdleRateDecompositionGraph, ValueDriverMatrixGraph } from "./CorporateGraphs";
import type { BetaPoint, DetailKey, HurdleBarPoint, RegionalHurdlePoint, ValueMatrixPoint, WaccCurvePoint } from "./graphs/shared";

// Spec §3.1: three charts in one row (2 below 992px, 1 below 768px). DCF Core Modules moved to
// the DCF tab; the explanatory box became this tab's ⓘ.
export function CorporateDiagnosticsSection({
  companyName,
  hurdleBars,
  regionalHurdle,
  assumptionsDebtRatio,
  betaTreemapProxy,
  waccCurve,
  valueMatrix,
  onOpenDetail,
}: {
  companyName: string;
  hurdleBars: HurdleBarPoint[];
  regionalHurdle: RegionalHurdlePoint[];
  assumptionsDebtRatio: number;
  betaTreemapProxy: BetaPoint[];
  waccCurve: WaccCurvePoint[];
  valueMatrix: ValueMatrixPoint[];
  onOpenDetail: (key: DetailKey) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <span data-testid="diagnostics-about" className="type-small self-start text-[var(--ink-muted)]">
        <InfoTooltip label={t("corporate.tabs.about")} description={t("corporate.tabs.diagnosticsAbout")} />
      </span>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <HurdleRateDecompositionGraph hurdleBars={hurdleBars} regionalHurdle={regionalHurdle} onOpenDetail={onOpenDetail} />
        <BetaWaccCurveGraph assumptionsDebtRatio={assumptionsDebtRatio} betaTreemapProxy={betaTreemapProxy} waccCurve={waccCurve} onOpenDetail={onOpenDetail} />
        <ValueDriverMatrixGraph companyName={companyName} valueMatrix={valueMatrix} onOpenDetail={onOpenDetail} />
      </div>
    </div>
  );
}
```

Graph roots (exact edits):
- `graphs/HurdleRateDecompositionGraph.tsx`, `graphs/BetaWaccCurveGraph.tsx` and `graphs/ValueDriverMatrixGraph.tsx`: on the root `<div className="lg:col-span-2 …">`, delete `lg:col-span-2 `. Replace `h-72 min-h-72` with `h-56 min-h-56` (one occurrence each).
- `graphs/DcfCoreModulesGraph.tsx`: on the root `<div className="lg:col-span-4 …">`, delete `lg:col-span-4 `.
- `CorporateGraphs.tsx`: in the four `loading: () => <GraphLoadingCard className="…"` lines, replace `className="lg:col-span-2"` and `className="lg:col-span-4"` with `className=""`, and the default `chartHeightClassName = "h-72"` with `"h-56"`.

- [ ] **Step 8: Comparison tab layout.** In `TargetStockComparisonSection.tsx` (keep CRLF):
  1. Add imports:
     ```ts
     import { ActionButton } from "@/components/ui/ActionButton";
     import { fieldInputClass } from "@/components/ui/InlineField";
     import { MISSING } from "@/lib/format";
     import { useT } from "@/lib/i18n/locale";
     ```
  2. Remove `formatComparisonUniverseLabel` from the destructured props and from the props type.
  3. Replace everything from the line `  return (` (the component's return; at plan time line 167) up to, but not including, the line `      {comparisonData && sortedComparisonRows.length > 0 && (` with:

```tsx
  const t = useT();
  const universeShown = comparisonData?.snapshot.comparison_universe ?? comparisonUniverse;
  const customTickers = (comparisonData?.snapshot.custom_tickers
    ?? comparisonCustomTickersInput.split(",").map((ticker) => ticker.trim()).filter(Boolean)).join(", ");
  const syncedCount = watchlistCoverage.liveWatchlistCount - watchlistCoverage.missingTickers.length;
  const hasNonBenchmarkRows = sortedComparisonRows.some((row) => row.group_name !== "benchmark");
  // Spec §2.5: the three explanatory paragraphs and the method tiles live in this ⓘ now.
  const about = t("corporate.comparison.about", {
    riskFree: comparisonData ? formatPct2(comparisonData.risk_free_rate) : MISSING,
    erp: comparisonData ? formatPct2(comparisonData.equity_risk_premium) : MISSING,
    marketReturn: comparisonData ? formatPct2(comparisonData.market_expected_return) : MISSING,
    stockMethod: comparisonData ? comparisonData.stock_expected_return_method.replaceAll("_", " ") : MISSING,
    referenceMethod: comparisonData ? comparisonData.comparison_reference_return_method.replaceAll("_", " ") : MISSING,
    generatedAt: comparisonData ? formatDateTime(comparisonData.snapshot.generated_at) : MISSING,
  });
  const fieldLabel = "type-label flex w-40 flex-col gap-1 text-[var(--ink-muted)]";

  return (
    <div data-testid="comparison-tab" className="flex flex-col gap-3">
      <span data-testid="comparison-about" className="type-small self-start text-[var(--ink-muted)]">
        <InfoTooltip label={t("corporate.tabs.about")} description={about} />
      </span>

      {/* Spec §3.3 toolbar: universe · benchmark · sort · direction | refresh · all DCF · sync check. */}
      <div data-testid="comparison-toolbar" className="flex flex-wrap items-end gap-2">
        <label className={fieldLabel}>
          {t("corporate.comparison.universe")}
          <select
            aria-label={t("corporate.comparison.universeAria")}
            value={comparisonUniverse}
            onChange={(event) => onComparisonUniverseChange(event.target.value as ComparisonUniverse)}
            className={fieldInputClass}
          >
            <option value="watchlist_plus_benchmark">{t("corporate.comparison.universeLabel.watchlist_plus_benchmark")}</option>
            <option value="custom">{t("corporate.comparison.universeLabel.custom")}</option>
          </select>
        </label>
        <label className={fieldLabel}>
          {t("corporate.comparison.benchmarkLabel")}
          <select
            aria-label={t("corporate.comparison.benchmarkAria")}
            value={comparisonBenchmarkTicker}
            onChange={(event) => onComparisonBenchmarkTickerChange(event.target.value)}
            className={fieldInputClass}
          >
            {comparisonBenchmarkOptions.map((preset) => (
              <option key={preset.id} value={preset.ticker}>{preset.label}</option>
            ))}
          </select>
        </label>
        {comparisonUniverse === "custom" ? (
          <label className={fieldLabel}>
            {t("corporate.comparison.customLabel")}
            <input
              aria-label={t("corporate.comparison.customAria")}
              value={comparisonCustomTickersInput}
              onChange={(event) => onComparisonCustomTickersInputChange(event.target.value.toUpperCase())}
              placeholder="AAPL, MSFT, NVDA"
              className={fieldInputClass}
            />
          </label>
        ) : null}
        <label className={fieldLabel}>
          {t("corporate.comparison.sortLabel")}
          <select
            aria-label={t("corporate.comparison.sortAria")}
            value={comparisonSortKey}
            onChange={(event) => onComparisonSortKeyChange(event.target.value as ComparisonSortKey)}
            className={fieldInputClass}
          >
            <option value="implied_return_spread">{t("corporate.comparison.sortImplied")}</option>
            <option value="roic_minus_wacc">{t("corporate.comparison.sortSpread")}</option>
            <option value="dcf_value">{t("corporate.comparison.sortDcf")}</option>
          </select>
        </label>
        <label className={fieldLabel}>
          {t("corporate.comparison.directionLabel")}
          <select
            aria-label={t("corporate.comparison.directionAria")}
            value={comparisonSortDirection}
            onChange={(event) => onComparisonSortDirectionChange(event.target.value as "desc" | "asc")}
            className={fieldInputClass}
          >
            <option value="desc">{t("corporate.comparison.desc")}</option>
            <option value="asc">{t("corporate.comparison.asc")}</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton size="sm" variant="secondary" label={t("corporate.comparison.refresh")} onClick={onRefreshComparison} disabled={comparisonIsFetching} />
          <ActionButton
            size="sm"
            variant="secondary"
            label={t(bulkDcfReportsLoading ? "corporate.comparison.calculatingAll" : "corporate.comparison.calculateAll")}
            onClick={onCalculateAllDcfReports}
            disabled={bulkDcfReportsLoading || !hasNonBenchmarkRows}
          />
          <ActionButton size="sm" variant="secondary" label={t("corporate.comparison.verifySync")} onClick={onVerifyWatchlistSync} disabled={watchlistSyncLoading} />
        </div>
      </div>

      {/* Spec §3.3 status line: the sync box, benchmark and timestamp in one line. */}
      <div data-testid="comparison-status" className="type-small flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--ink-muted)]">
        <span>{t(`corporate.comparison.universeLabel.${universeShown}`)}</span>
        <span aria-hidden="true">·</span>
        <span>
          {watchlistSyncLoading
            ? t("corporate.comparison.verifying")
            : watchlistCoverage.isSynchronized
              ? t("corporate.comparison.synced", { n: syncedCount, m: watchlistCoverage.liveWatchlistCount })
              : t("corporate.comparison.missing", { tickers: watchlistCoverage.missingTickers.join(", ") })}
        </span>
        <span aria-hidden="true">·</span>
        <span>{t("corporate.comparison.benchmark", { ticker: comparisonData?.snapshot.benchmark_ticker ?? comparisonBenchmarkTicker })}</span>
        <span>{t("corporate.comparison.preset", { label: selectedBenchmarkLabel, ticker: comparisonBenchmarkTicker })}</span>
        {universeShown === "custom" ? <span>{t("corporate.comparison.custom", { tickers: customTickers || t("corporate.comparison.none") })}</span> : null}
        <span aria-hidden="true">·</span>
        <span>
          {comparisonDisplayLastUpdatedAt
            ? t("corporate.assumptions.updated", { time: formatDateTime(comparisonDisplayLastUpdatedAt) })
            : t("corporate.comparison.notCalculated")}
        </span>
        {comparisonIsStale ? (
          <span className="type-caption rounded-[var(--radius-2)] bg-[var(--status-warning-surface)] px-2 py-0.5 uppercase text-[var(--status-warning-ink)]">
            {t("corporate.comparison.stale")}
          </span>
        ) : null}
        <button type="button" onClick={onOpenPortfolio} className="type-small text-[var(--brand-text)] underline decoration-dotted underline-offset-4">
          {t("corporate.comparison.openPortfolio")}
        </button>
      </div>

      {comparisonIsLoading && !comparisonData ? <LoadingState variant="spinner" label={t("corporate.comparison.loading")} /> : null}
      {comparisonIsError ? <ErrorState title={t("corporate.comparison.errorTitle")} message={t("corporate.comparison.errorBody")} /> : null}
      {!comparisonData && !comparisonIsFetching && !comparisonIsError ? (
        <EmptyState title={t("corporate.comparison.idleTitle")} description={t("corporate.comparison.idleBody")} />
      ) : null}

```

  4. Inside the `{comparisonData && sortedComparisonRows.length > 0 && (` block:
     - Cut the `<CorporateComparisonTable … />` element. Paste it as the first child of the block's `<>` fragment, wrapped as `<div data-testid="comparison-table-scroll" className="max-h-80 overflow-y-auto">…</div>`.
     - Delete the `<div className="mt-4">` that holds the `{bulkDcfReportsLoading ? "Calculating all reports..." : "Calculate All Reports"}` button. The toolbar button replaces it (spec §2.5).
     - Keep the spread-chart grid and the batch-report section exactly as they are (plan N8).
  5. Change the component's final `    </section>` to `    </div>`.

  In `CorporateComparisonTable.tsx`, add `sticky top-0 z-10 ` at the start of the `<thead className="…">` class string.

- [ ] **Step 9: Wire `page.tsx`.**
  1. Imports: add `import { CorporateLowerTabs } from "./components/CorporateLowerTabs";` and `import { DcfTab } from "./components/DcfTab";`. Remove `comparisonUniverseLabel,` from the `./corporateUtils` import, and delete the `comparisonUniverseLabel` function from `corporateUtils.ts`; nothing else uses it.
  2. Rename `const handleViewFullDcfReport = async () => {` to `const loadFullDcfReport = async () => {` and delete its first statement line, `setActiveCalculation("backendDcf");`. Directly after that function, add:
     ```ts
     const handleViewFullDcfReport = async () => {
       setActiveCalculation("backendDcf");
       await loadFullDcfReport();
     };
     ```
     In the modal props, change `onRequestDcfFullReport={() => void handleViewFullDcfReport()}` to `onRequestDcfFullReport={() => void loadFullDcfReport()}`.
  3. In the header, delete the `<button … onClick={() => void handleCalculateAllDcfReports()} …>` element, the one whose text is `{bulkDcfReportsLoading ? "Calculating all DCF reports..." : "Calculate All DCF Reports"}`.
  4. Replace the `<div className="space-y-4">…</div>` added in Task 5 with:

```tsx
      <CorporateLowerTabs
        panels={{
          diagnostics: (
            <CorporateDiagnosticsSection
              companyName={companyName}
              hurdleBars={hurdleBars}
              regionalHurdle={regionalHurdle}
              assumptionsDebtRatio={assumptions.debtRatio}
              betaTreemapProxy={betaTreemapProxy}
              waccCurve={waccCurve}
              valueMatrix={valueMatrix}
              onOpenDetail={setActiveCalculation}
            />
          ),
          dcf: (
            <DcfTab
              sustainableGrowth={derived.sustainableGrowth}
              fcff={assumptions.fcff}
              dcfResult={dcfData ?? undefined}
              onOpenDetail={setActiveCalculation}
              report={dcfFullReport}
              reportLoading={dcfFullReportLoading}
              reportError={dcfFullReportError}
              canLoadReport={dcfRefusal === null && !(!dcfData && dcfStreamStatus === "idle")}
              onLoadReport={() => void loadFullDcfReport()}
            />
          ),
          comparison: (
            <TargetStockComparisonSection
              comparisonData={comparisonData}
              comparisonDisplayLastUpdatedAt={comparisonDisplayLastUpdatedAt}
              comparisonIsStale={comparisonIsStale}
              comparisonUniverse={comparisonUniverse}
              comparisonBenchmarkTicker={comparisonBenchmarkTicker}
              comparisonBenchmarkOptions={PORTFOLIO_BENCHMARK_PRESETS}
              comparisonCustomTickersInput={comparisonCustomTickersInput}
              comparisonSortKey={comparisonSortKey}
              comparisonSortDirection={comparisonSortDirection}
              onComparisonUniverseChange={setComparisonUniverse}
              onComparisonBenchmarkTickerChange={setComparisonBenchmarkTicker}
              onComparisonCustomTickersInputChange={setComparisonCustomTickersInput}
              onComparisonSortKeyChange={setComparisonSortKey}
              onComparisonSortDirectionChange={setComparisonSortDirection}
              onRefreshComparison={handleRefreshComparison}
              onVerifyWatchlistSync={() => {
                void companiesQuery.refetch();
                void watchlistQuery.refetch();
              }}
              onOpenPortfolio={() => router.push("/portfolio")}
              watchlistCoverage={watchlistCoverage}
              watchlistSyncLoading={watchlistQuery.isFetching || companiesQuery.isFetching}
              comparisonIsLoading={comparisonQuery.isLoading}
              comparisonIsFetching={comparisonQuery.isFetching}
              comparisonIsError={comparisonQuery.isError}
              sortedComparisonRows={sortedComparisonRows}
              selectedComparisonTicker={selectedComparisonRow?.ticker ?? ""}
              selectedComparisonSector={selectedComparisonSector}
              similarComparisonBarData={similarComparisonBarData}
              similarComparisonScatterPeers={similarComparisonScatterPeers}
              similarComparisonScatterSelected={similarComparisonScatterSelected}
              currentTicker={assumptions.ticker}
              onSelectTicker={selectTicker}
              onOpenCalculationForTicker={selectTickerAndOpenCalculation}
              bulkDcfReportsLoading={bulkDcfReportsLoading}
              bulkDcfReportsError={bulkDcfReportsError}
              bulkDcfReports={bulkDcfReports}
              bulkDcfReportsLastUpdatedAt={bulkDcfReportsLastUpdatedAt}
              bulkDcfSkipped={bulkDcfSkipped}
              onCalculateAllDcfReports={() => void handleCalculateAllDcfReports()}
              formatPct2={pct2}
              formatMoney={moneyText}
              formatDateTime={dateTimeText}
            />
          ),
        }}
      />
```

  These are the props the element had before, minus `formatComparisonUniverseLabel`.

- [ ] **Step 10: Run.** `npx playwright test tests/e2e/corporate-one-screen.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 11: Approved edits #9–#30**, and the helper import (#56) in each file they touch. Run:
`npx playwright test tests/e2e/corporate-*.spec.ts tests/e2e/refresh-idle-state.spec.ts tests/e2e/terminal-diagnostics.spec.ts tests/e2e/high-risk-render-regression.spec.ts tests/e2e/responsive-accessibility.spec.ts tests/e2e/tab-state-persistence.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 12: Gates.** `npm run typecheck && npm run lint && npm run test:unit`; `npm run design:baseline -- app/corporate/components/CorporateLowerTabs.tsx app/corporate/components/DcfTab.tsx app/corporate/components/CorporateDiagnosticsSection.tsx` reports 0; `wc -l app/corporate/page.tsx` < 1242.

- [ ] **Step 13: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `CorporateLowerTabs`: `useTabState(…)` → `useState("diagnostics")` | `diagnostics is the default … survives leaving the page` |
| `active` without the `isLowerTab` guard (`stored as LowerTabKey`) | `an unknown stored tab falls back to diagnostics` |
| all three panels rendered, inactive ones with `hidden` | `… each tab mounts only its own content …` (`DCF Core Modules` count 0) |
| `DcfTab` `onLoadReport={() => void handleViewFullDcfReport()}` in `page.tsx` | `the DCF tab loads the full report … in place …` (a dialog opens) |
| `DcfTab` calls `onLoadReport()` in a `useEffect` on mount | `… only on request …` (`dcfFullReportRequests` is 1 before the click) |
| `comparison-table-scroll` without `overflow-y-auto` | `the comparison tab is a toolbar, one status line and a scrolling table` |
| the inner "Calculate All Reports" button kept | same test (`/Calculate All/` count 1) |

- [ ] **Step 14: Commit.** Mark `C6` in `todo.md`.

```bash
git add apps/web/app/corporate apps/web/lib/i18n apps/web/tests/e2e docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(corporate): diagnostics, DCF and comparison move into remembered lower tabs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Header row: search with inline add, Refresh DCF, company line; duplicate entry points removed (spec §2.1, §2.5)

**Files:**
- Create: `apps/web/app/corporate/components/CorporateHeader.tsx`
- Modify: `apps/web/components/ui/PageHeader.tsx` (optional `subtitleTestId`), `apps/web/components/ui/TickerSearch.tsx` (optional `noMatchAction`), `apps/web/app/corporate/page.tsx`, `apps/web/lib/i18n/messages/{en,ko}.ts`, `apps/web/lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md`, `apps/web/tests/e2e/helpers/corporateDcf.ts`, `apps/web/tests/e2e/corporate-one-screen.spec.ts` (append), `guideline/sop/todo.md`
- Approved test edits: inventory #31–#49, plus import row #56 for the files they touch

**Interfaces:**
- Consumes: `PageHeader` (`title`, `subtitle`, `eyebrow: { label: LabelKey }`, `actions`), `TickerSearch`, `ActionButton` (`icon`, `type`), `fieldInputClass`, `MISSING`.
- Produces:
  - `PageHeader` prop `subtitleTestId?: string`, rendered as `data-testid` on the subtitle `<p>`
  - `TickerSearch` prop `noMatchAction?: { label: string; onSelect: (query: string) => void }`. It is offered as the listbox's only option when the typed text matches nothing.
  - `CorporateHeader(props: CorporateHeaderProps)` (Step 5). DOM: heading "Corporate Analysis", `[data-testid="corporate-company-line"]`, `[data-testid="dcf-updated"]`, the button "Refresh DCF", `[data-testid="add-company-form"]` (inputs "Company name" and "Symbol", submit "Add for Analysis", button "Cancel").
  - `page.tsx`: `addCompany({ ticker, name }): Promise<void>`. `handleViewFullDcfReport` is deleted.
  - helpers `refreshDcf(page)`, `loadFullDcfReportInTab(page): Promise<Locator>`, `openFullDcfReportInModal(page): Promise<Locator>`
  - catalog keys `corporate.title`, `corporate.search.*`, `corporate.add.*`, `corporate.header.*`; label `corporate`

- [ ] **Step 1: Extend the helpers** (append to `tests/e2e/helpers/corporateDcf.ts`)

```ts
/** Refresh DCF, then wait until the verdict holds a valuation (bridged or not). */
export async function refreshDcf(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  await expect(page.getByTestId("corporate-verdict")).toHaveAttribute("data-state", "valued", { timeout: 60_000 });
}

/** DCF tab → Load Full Report (spec §3.2). Returns the DCF tab panel, where the grid shows. */
export async function loadFullDcfReportInTab(page: Page): Promise<Locator> {
  await openLowerTab(page, "DCF");
  const panel = lowerPanel(page);
  await panel.getByRole("button", { name: "Load Full Report" }).click();
  return panel;
}

/** Verdict detail → Full DCF Report → Load Full Report, inside the calculation modal. */
export async function openFullDcfReportInModal(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Verdict detail" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("summary").filter({ hasText: "Full DCF Report" }).click();
  await dialog.getByRole("button", { name: "Load Full Report" }).click();
  return dialog;
}
```

- [ ] **Step 2: Write the failing tests.** In `corporate-one-screen.spec.ts`, change the first import to `import { expect, test, type Locator, type Page } from "@playwright/test";` and append:

```ts
test.describe("at 1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  // Spec §7 test 1: element positions, not scrollHeight. Budget: plan "First-screen height budget".
  async function expectAboveTheFold(page: Page) {
    const blocks: [string, Locator][] = [
      ["title", page.getByRole("heading", { name: /Corporate Analysis/i })],
      ["company line", page.getByTestId("corporate-company-line")],
      ["verdict", page.getByTestId("corporate-verdict")],
      ["KPI row", page.getByTestId("corporate-kpis")],
      ["assumption table", page.getByTestId("assumption-table")],
      ["tab bar", page.getByRole("tablist", { name: "Corporate analysis sections" })],
    ];
    for (const [name, locator] of blocks) {
      const box = await locator.boundingBox();
      expect(box, `${name} is rendered`).not.toBeNull();
      expect(box!.y, `${name} starts below the 48px bar`).toBeGreaterThanOrEqual(48);
      expect(box!.y + box!.height, `${name} ends inside 720px`).toBeLessThanOrEqual(720);
    }
    await expect(page.getByTestId("corporate-kpis").getByRole("button")).toHaveCount(4);
    const scroll = await page.getByTestId("assumption-scroll").boundingBox();
    expect(scroll!.height, "the assumption table scrolls inside its 288px budget").toBeLessThanOrEqual(288);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  }

  test("header, verdict, four KPIs, the assumption table and the tab bar fit without scrolling", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await expectAboveTheFold(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await expectAboveTheFold(page);
    await page.getByTestId("assumption-table").getByRole("button", { name: "Edit WACC" }).click();
    await expect(page.getByTestId("assumption-slider-wacc")).toBeVisible();
    await expectAboveTheFold(page);
  });
});

test.describe("the header row", () => {
  test("a company not in the list is added from the search's last entry", async ({ page }) => {
    await mockCorporatePageApi(page);
    let posted: unknown = null;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/corporate/companies")) posted = request.postDataJSON();
    });
    await gotoCorporate(page);
    await expect(page.getByTestId("add-company-form")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add for Analysis" })).toHaveCount(0);
    await page.getByLabel("Company Search").fill("zzzq");
    await page.getByRole("option", { name: "Not in the list → add" }).click();
    const form = page.getByTestId("add-company-form");
    await expect(form.getByLabel("Symbol")).toHaveValue("ZZZQ");
    await form.getByLabel("Company name").fill("Zed Quartz");
    await form.getByRole("button", { name: "Add for Analysis" }).click();
    await expect.poll(() => posted).toEqual({ ticker: "ZZZQ", name: "Zed Quartz", source: "manual" });
    await expect(page.getByTestId("corporate-company-line")).toContainText("Zed Quartz");
    await expect(form).toHaveCount(0);
  });

  test("a listed match never offers the add entry", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await page.getByLabel("Company Search").fill("Micro");
    await expect(page.getByRole("option", { name: /Microsoft/ })).toBeVisible();
    await expect(page.getByRole("option", { name: "Not in the list → add" })).toHaveCount(0);
  });

  test("the page has one way to the full report and no idle sentence", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "View Full Report" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Intrinsic DCF/ })).toHaveCount(0);
    await expect(page.getByText("DCF stays idle on first load until you refresh it.")).toHaveCount(0);
    await expect(page.getByTestId("dcf-updated")).toContainText("Last updated");
    await expect(page.getByTestId("corporate-company-line")).toHaveText(/^Apple · .+ · \$210\.4$/);
  });
});

test.describe("in Korean", () => {
  test.use({ locale: "ko-KR" });

  test("title, verdict, a figure and a bilingual header read in Korean", async ({ page }) => {
    await mockCorporatePageApi(page);
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "기업 분석" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("corporate-verdict")).toContainText("DCF 미계산");
    await expect(page.getByTestId("corporate-kpis")).toContainText("10.0%");
    await expect(page.getByRole("columnheader", { name: "항목", exact: true })).toBeVisible();
    await expect(page.getByTestId("corporate-lower-tabs").getByRole("tab", { name: "종목 비교" })).toBeVisible();
  });
});
```

- [ ] **Step 3: Run to see them fail.** `npx playwright test tests/e2e/corporate-one-screen.spec.ts -g "1280x720|header row|Korean" --workers=2`. Expected: FAIL. `corporate-company-line` and `add-company-form` are not found, and "View Full Report" has a count of 1.

- [ ] **Step 4: Shared components.**
  - `PageHeader.tsx`: add `subtitleTestId?: string;` to the props interface and to the destructuring. On the subtitle `<p>`, add `data-testid={subtitleTestId}`.
  - `TickerSearch.tsx`: add to `TickerSearchProps`:
    ```ts
      /** Offered as the list's only entry when the typed text matches nothing ("not in the list → add"). */
      noMatchAction?: { label: string; onSelect: (query: string) => void };
    ```
    Destructure `noMatchAction`. After `const matches = useMemo(…);`, add:
    ```ts
      const showNoMatch = Boolean(noMatchAction) && value.trim() !== "" && matches.length === 0;
    ```
    Change `aria-expanded={open && matches.length > 0}` to `aria-expanded={open && (matches.length > 0 || showNoMatch)}`. Change the listbox condition `{open && matches.length > 0 ? (` to `{open && (matches.length > 0 || showNoMatch) ? (`.

    The match option's `className` is a template literal that branches on `item.ticker === selectedTicker`. Move that expression, unchanged, into a module-level function above the component: `function optionClass(selected: boolean) { return \`…\`; }`, with `item.ticker === selectedTicker` replaced by `selected`. Then use `className={optionClass(item.ticker === selectedTicker)}` on the match option. Inside the listbox `div`, after `{matches.map(…)}`, add:
    ```tsx
              {showNoMatch && noMatchAction ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setOpen(false);
                    noMatchAction.onSelect(value.trim());
                  }}
                  className={optionClass(false)}
                >
                  {noMatchAction.label}
                </button>
              ) : null}
    ```

- [ ] **Step 5: `apps/web/app/corporate/components/CorporateHeader.tsx`**

```tsx
"use client";

import { type FormEvent, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ActionButton } from "@/components/ui/ActionButton";
import { fieldInputClass } from "@/components/ui/InlineField";
import { PageHeader } from "@/components/ui/PageHeader";
import { TickerSearch } from "@/components/ui/TickerSearch";
import { MISSING } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import type { CorporateCompany } from "../corporateTypes";

export interface CorporateHeaderProps {
  companies: CorporateCompany[];
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
  /** POST /corporate/companies, then select it; rejects when the request fails. */
  onAddCompany: (company: { ticker: string; name: string }) => Promise<void>;
  companyName: string;
  sector: string | null;
  /** Formatted current price, or null before a DCF has run. */
  priceText: string | null;
  /** Formatted time of the shown DCF, or null when none has run. */
  dcfUpdatedText: string | null;
  dcfStreaming: boolean;
  dcfIsStale: boolean;
  dcfStreamError: string | null;
  onRefreshDcf: () => void;
}

// Spec §2.1: title, search, DCF time and Refresh DCF; below them "name · sector · price". The old
// Add Company form became the search's "not in the list → add" entry and this inline form.
export function CorporateHeader({
  companies, selectedTicker, onSelectTicker, onAddCompany, companyName, sector, priceText,
  dcfUpdatedText, dcfStreaming, dcfIsStale, dcfStreamError, onRefreshDcf,
}: CorporateHeaderProps) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<{ name: string; symbol: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const ticker = draft.symbol.trim().toUpperCase();
    const name = draft.name.trim();
    if (!ticker || !name) return;
    setAdding(true);
    setAddError(null);
    try {
      await onAddCompany({ ticker, name });
      setDraft(null);
      setSearch("");
    } catch {
      setAddError(t("corporate.add.failed", { ticker }));
    } finally {
      setAdding(false);
    }
  };

  return (
    <PageHeader
      title={t("corporate.title")}
      eyebrow={{ label: "corporate" }}
      subtitle={[companyName, sector || MISSING, priceText ?? MISSING].join(" · ")}
      subtitleTestId="corporate-company-line"
      actions={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
          <div className="flex w-full flex-wrap items-end gap-2 sm:justify-end">
            <TickerSearch
              id="company-search"
              label={t("corporate.search.label")}
              value={search}
              onChange={setSearch}
              onSelect={(ticker) => {
                onSelectTicker(ticker);
                setSearch("");
                setDraft(null);
              }}
              items={companies}
              selectedTicker={selectedTicker}
              placeholder={t("corporate.search.placeholder")}
              noMatchAction={{
                label: t("corporate.search.notListed"),
                onSelect: (query) => {
                  setDraft({ name: "", symbol: query.toUpperCase() });
                  setAddError(null);
                },
              }}
              className="w-full sm:w-72"
            />
            <ActionButton
              label={t("corporate.header.refreshDcf")}
              size="sm"
              variant="secondary"
              icon={<RefreshCw aria-hidden="true" className={dcfStreaming ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />}
              disabled={dcfStreaming}
              onClick={onRefreshDcf}
            />
          </div>
          <div className="type-small flex flex-wrap items-center gap-2 text-[var(--ink-muted)] sm:justify-end">
            <span data-testid="dcf-updated">
              {dcfUpdatedText ? t("corporate.assumptions.updated", { time: dcfUpdatedText }) : t("corporate.header.notCalculated")}
            </span>
            {dcfIsStale ? (
              <span className="type-caption rounded-[var(--radius-2)] bg-[var(--status-warning-surface)] px-2 py-0.5 uppercase text-[var(--status-warning-ink)]">
                {t("corporate.comparison.stale")}
              </span>
            ) : null}
            {dcfStreamError ? <span role="alert" className="text-[var(--status-error-ink)]">{dcfStreamError}</span> : null}
          </div>
          {draft ? (
            <form data-testid="add-company-form" onSubmit={(event) => void submit(event)} className="flex w-full flex-wrap items-end gap-2 sm:justify-end">
              <div className="w-48">
                <input
                  aria-label={t("corporate.add.name")}
                  placeholder={t("corporate.add.name")}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className={fieldInputClass}
                />
              </div>
              <div className="w-28">
                <input
                  aria-label={t("corporate.add.symbol")}
                  placeholder={t("corporate.add.symbol")}
                  value={draft.symbol}
                  onChange={(event) => setDraft({ ...draft, symbol: event.target.value.toUpperCase() })}
                  className={fieldInputClass}
                />
              </div>
              <ActionButton
                type="submit"
                label={t("corporate.add.submit")}
                size="sm"
                disabled={adding || !draft.name.trim() || !draft.symbol.trim()}
                onClick={() => {}}
              />
              <ActionButton label={t("corporate.add.cancel")} size="sm" variant="secondary" onClick={() => setDraft(null)} />
              {addError ? <span role="alert" className="type-small text-[var(--status-error-ink)]">{addError}</span> : null}
            </form>
          ) : null}
        </div>
      }
    />
  );
}
```

- [ ] **Step 6: Catalog, label, glossary.** Inside `corporate: { … }` in `en.ts`:

```ts
    title: "Corporate Analysis",
    search: { label: "Company Search", placeholder: "Type a company name", notListed: "Not in the list → add" },
    add: { name: "Company name", symbol: "Symbol", submit: "Add for Analysis", cancel: "Cancel", failed: "Could not add {ticker}." },
    header: { refreshDcf: "Refresh DCF", notCalculated: "Not calculated yet" },
```

`ko.ts`:

```ts
    title: "기업 분석",
    search: { label: "기업 검색", placeholder: "회사명을 입력하세요", notListed: "목록에 없음 → 추가" },
    add: { name: "회사명", symbol: "심볼", submit: "분석에 추가", cancel: "취소", failed: "{ticker}을(를) 추가하지 못했습니다." },
    header: { refreshDcf: "DCF 새로고침", notCalculated: "아직 계산하지 않았습니다" },
```

`labels.ts`: `corporate: ["기업 분석", "Corporate"],`. Glossary rows:

```markdown
| Corporate | 기업 분석 | label (corporate eyebrow) |
| Not in the list → add | 목록에 없음 → 추가 | search entry |
| Add for Analysis | 분석에 추가 | button |
| Refresh DCF | DCF 새로고침 | button |
```

- [ ] **Step 7: Wire `page.tsx`.**
  1. Delete the states `companySearch`, `newCompanyName` and `newCompanySymbol`, and the `setCompanySearch("");` line in `selectTicker`.
  2. Replace the whole `addCompany` function with:
     ```ts
     const addCompany = async ({ ticker, name }: { ticker: string; name: string }) => {
       const saved = await fetchApi<CorporateCompany>("/corporate/companies", {
         method: "POST",
         body: JSON.stringify({ ticker, name, source: "manual" }),
       });
       queryClient.setQueryData<CorporateCompany[]>(["corporate-companies"], (current = []) => {
         const next = current.filter((company) => company.ticker.toUpperCase() !== saved.ticker.toUpperCase());
         return [...next, saved];
       });
       selectTicker(saved.ticker.toUpperCase());
     };
     ```
  3. Delete `handleViewFullDcfReport` (the two-line wrapper added in Task 6). Nothing calls it once the header goes.
  4. Change the root `<div className="space-y-6 max-w-7xl mx-auto px-4 py-6">` to `<div className="mx-auto max-w-7xl space-y-4">`. Replace the whole `<header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"> … </header>` element, from its opening comment `{/* Page header: …` through `</header>`, with:

```tsx
      <CorporateHeader
        companies={companies}
        selectedTicker={assumptions.ticker}
        onSelectTicker={selectTicker}
        onAddCompany={addCompany}
        companyName={companyName}
        sector={activeCompany.sector ?? null}
        priceText={dcfData ? moneyText(dcfData.current_price) : null}
        dcfUpdatedText={dcfDisplayLastUpdatedAt ? dateTimeText(dcfDisplayLastUpdatedAt) : null}
        dcfStreaming={dcfStreamStatus === "streaming"}
        dcfIsStale={dcfIsStale}
        dcfStreamError={dcfStreamError}
        onRefreshDcf={handleRefreshDcf}
      />
```

  5. Add `import { CorporateHeader } from "./components/CorporateHeader";`. Run `npm run lint` and remove the imports and constants this made unused, and only those: expected `FormEvent`, `RefreshCw`, `TickerSearch`, `InfoTooltip`, `PageHeader`, `bridgedEstimatedValue`/`UNBRIDGED_PLACEHOLDER`/`UNBRIDGED_REASON`, and the `bridgedFairValue` constant.
  6. `wc -l app/corporate/page.tsx`. Expected about 1,100, and below 1,242.

- [ ] **Step 8: Run.** `npx playwright test tests/e2e/corporate-one-screen.spec.ts tests/e2e/topnav.spec.ts tests/e2e/valuation.spec.ts tests/e2e/decisions.spec.ts --workers=2`. Expected: PASS. Valuation and Decisions use `TickerSearch` without `noMatchAction`, so their behaviour is unchanged.

  If the fit test fails, read the failing block's name and box from the message. Fix the layout (paddings, the `max-h-72` cap, `md:grid-cols-4`). Do not loosen the test. Record the measured box of each block in the task report.

- [ ] **Step 9: Approved edits #31–#49**, and the helper imports (#56). Run `npx playwright test tests/e2e/corporate-*.spec.ts tests/e2e/refresh-idle-state.spec.ts tests/e2e/terminal-diagnostics.spec.ts tests/e2e/high-risk-render-regression.spec.ts tests/e2e/responsive-accessibility.spec.ts tests/e2e/tab-state-persistence.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 10: Gates.** `npm run typecheck && npm run lint && npm run test:unit`; `npm run design:baseline -- app/corporate/components/CorporateHeader.tsx components/ui/PageHeader.tsx components/ui/TickerSearch.tsx` reports 0.

- [ ] **Step 11: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `AssumptionTable` scroll region `max-h-72` removed | `header, verdict, four KPIs … fit without scrolling` (scroll height > 288) |
| `KpiRow` grid `grid-cols-2 md:grid-cols-4` → `grid-cols-1` | `… fit without scrolling` (KPI row and tab bar end below 720) |
| `AppShell` `[--main-pad-top:4rem]` → `[--main-pad-top:2rem]` | `… fit without scrolling` (title starts above 48) |
| `TickerSearch`: `const showNoMatch = false;` | `a company not in the list is added from the search's last entry` |
| `showNoMatch` without `matches.length === 0` | `a listed match never offers the add entry` |
| `submit` sends `{ ticker: name, name: ticker }` | `a company not in the list is added…` (posted body) |
| keep a `View Full Report` button in the header | `the page has one way to the full report and no idle sentence` |
| company line omits the sector | same test (the company-line regex needs two ` · ` separators) |
| `ko.ts` `corporate.title` → `"Corporate Analysis"` | `title, verdict, a figure and a bilingual header read in Korean` |

- [ ] **Step 12: Commit.** Mark `C7` in `todo.md`.

```bash
git add apps/web/app/corporate apps/web/components/ui/PageHeader.tsx apps/web/components/ui/TickerSearch.tsx apps/web/lib/i18n apps/web/tests/e2e docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(corporate): header row with inline add; the outer View Full Report, Add Company form and idle DCF tile are gone" -m "Absorbs UI-consolidation Task 8 (C1a)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7b: Page tabs and verdict strip (spec §2A, D10)

> **Owner decision D10, 2026-10-15.** The page never scrolls, at 1280×720 or at 390×844. Before this task, Tasks 5–7 built a first screen with three lower tabs under it, and at 1280×720 the document was 1106 px tall (Task 7 report). This task changes that:
> - Four page tabs sit directly under the header: Summary | Core Diagnostics | DCF | Target Stock Comparison.
> - The Summary tab holds the verdict block, the KPIs and the assumption table.
> - A one-line verdict strip sits beside the company line, so the verdict shows on every tab.
> - The tab panel fills the rest of the viewport and scrolls inside itself.
>
> Start from the commit that closed Task 7 (`21362c1` or later). The anchors below quote the files as they are at that commit.

**Files:**
- Create: `apps/web/app/corporate/pageTabs.ts` (LF)
- Rename and rewrite: `apps/web/app/corporate/components/CorporateLowerTabs.tsx` → `CorporatePageTabs.tsx` (`git mv`, LF)
- Modify:
  - `apps/web/app/corporate/verdict.ts` (crlf; adds `verdictView`)
  - `apps/web/app/corporate/components/VerdictBlock.tsx` (block takes a `VerdictView`; adds `VerdictStrip`)
  - `apps/web/components/ui/Tabs.tsx` (optional `idPrefix`)
  - `apps/web/components/ui/PageHeader.tsx` (optional `subtitleAside`)
  - `apps/web/app/corporate/components/CorporateHeader.tsx` (`verdictStrip` prop)
  - `apps/web/app/corporate/page.tsx`
  - `apps/web/lib/i18n/messages/{en,ko}.ts`, `docs/design/MoneyView_Glossary.md`, `guideline/sop/todo.md`
- Tests:
  - `apps/web/tests/e2e/helpers/corporateDcf.ts` (plan-owned, P1)
  - `apps/web/tests/e2e/corporate-one-screen.spec.ts` (crlf; plan-owned, P2–P4 and P6)
  - `apps/web/tests/e2e/corporate-model.spec.ts` (crlf; plan-owned, P5)
- Approved test edits: inventory addendum #58–#65, only after Step 2 records the approval. No import row is needed: every file they touch already imports the helpers it uses.

**Interfaces:**
- Consumes:
  - `bridgedEstimatedValue`, `bridgedUpsidePct` (`@/lib/bridgeQuality`)
  - `useTabState`, `tabStateKey` (`@/lib/tabState`, keys `moneyview.tab.<tab>.<concern>`, JSON values in `sessionStorage`)
  - `Tabs`, `DeltaBadge`, `VerdictStatusLabel`, `PageHeader`
  - AppShell's `--main-pad-top` / `--main-pad-bottom`, which PortfolioShell already subtracts
- Produces:
  - `verdict.ts`: `type VerdictState = "idle" | "streaming" | "valued" | "refused"`, `interface VerdictView`, and `verdictView(dcf: DcfSummary | null, streaming: boolean, refusalText: string | null): VerdictView`. It is the one place that decides the verdict's state, bridged value, upside, EV, price, status and refusal. Both the block and the strip render what it returns.
  - `pageTabs.ts`: `PAGE_TABS`, `type PageTabKey`, `PAGE_TAB_KEY` (`moneyview.tab.corporate.pageTab`), `LEGACY_LOWER_TAB_KEY` (`moneyview.tab.corporate.lowerTab`), `isPageTab`, and `migrateLowerTab(storage)`.
  - `CorporatePageTabs({ panels: Record<PageTabKey, ReactNode> })`. DOM:
    - `[data-testid="corporate-page-tabs"]`, the tablist "Corporate analysis sections", and tab ids `corporate-tab-<key>`;
    - one `role="tabpanel"` with id `corporate-panel-<key>` and `flex-1 min-h-0 overflow-auto`;
    - only the active panel is mounted.
  - `VerdictBlock({ view, onOpenDetail })`, with the same DOM as before, and `VerdictStrip({ view, onOpenDetail })`. The strip's DOM:
    - a `<button data-testid="corporate-verdict-strip" data-state=…>`;
    - when valued: `[data-part="intrinsic"]`, a `DeltaBadge` and `[data-part="label"]`;
    - otherwise one text: "DCF not calculated", "Calculating…" or "Not valued". When refused, the reason is in `title`.
  - `Tabs` prop `idPrefix?: string` (default `""`). `PageHeader` prop `subtitleAside?: ReactNode`. `CorporateHeader` prop `verdictStrip?: ReactNode`.
  - Catalog keys: `corporate.tabs.summary` and `corporate.verdictStrip.{idle,refused}`.

**Decisions this task makes (owner-visible in the addendum and N12):**
1. **Restructure without duplicating logic.**
   - `CorporateLowerTabs` is renamed to `CorporatePageTabs` and gains the `summary` key. Its testid becomes `corporate-page-tabs`, because the tabs are no longer "lower". Only plan-owned files read the old testid: the helper and `corporate-one-screen.spec.ts` lines 218, 235 and 417. So the rename costs no approval row.
   - The helper names `openLowerTab`, `lowerPanel` and `LowerTabName` **stay**, with a doc comment that says why. 11 approved spec files call them about 35 times, and a rename would add 11 import rows and edit every call for a name alone. The tablist name "Corporate analysis sections" and the tab labels stay.
2. **One verdict computation.** `page.tsx` computes `const verdict = verdictView(…)` once and passes it to both `VerdictBlock` and `VerdictStrip`. The block keeps its testids and `data-part`s, so Task 5's tests pin the shared helper through the block.
3. **Height model.**
   - The page root becomes `mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col`. This is the PortfolioShell formula, with `dvh` in place of `vh`.
   - The document height is then pad-top + root + pad-bottom = `100dvh`, and the `fixed` TopNav and modals add nothing.
   - `CorporatePageTabs` is `flex min-h-0 flex-1 flex-col gap-3`, its tab strip is `shrink-0 [contain:inline-size]`, and the panel is `min-h-0 min-w-0 flex-1 overflow-auto`.
   - AppShell keeps `w-full min-w-0` (ERROR-LOG 2026-10-14, both 390 px entries). No new flex row with `overflow-x-auto` is added outside the contained tab strip.
4. **Tab state.**
   - The state is `useTabState(PAGE_TAB_KEY, "summary")`. An unknown stored value falls back to Summary.
   - `migrateLowerTab` runs in an effect declared **before** `useTabState` in the same component. Effects run in declaration order, so it has moved the old value before `useTabState`'s restore effect reads the new key.
   - It removes the old key, so it runs once. A page tab that is already stored wins.
   - It carries `dcf` and `comparison` only (N12). `useTabState` writes its value back on every mount, so every session that ever opened `/corporate` holds `"diagnostics"` whether or not the reader chose it.
5. **Tab ids.** Task 8's modal `Tabs` also has a `summary` key. Without a prefix, the page and an open modal would both render `id="tab-summary"` and `id="panel-summary"`, and `aria-labelledby` would resolve to the wrong tab. So the page tabs pass `idPrefix="corporate-"`.
6. **Strip accessible name.** The strip's name comes from its content ("Intrinsic value $240.5 …"). It must not contain "Verdict detail", which 4 specs click by name (Playwright matches names as substrings). It must not start with "Intrinsic DCF", which one test asserts has count 0. It must not reuse `dcf-refusal`, `corporate-verdict` or any other testid the block has.

- [ ] **Step 1: Approval gate.** The controller shows the owner the addendum to the existing-test inventory verbatim:
  - rows #58–#65, with the per-file count;
  - the plan-owned table P1–P6;
  - the "Checked and unaffected" list;
  - row N12.

  **STOP.** Do not edit any existing spec, and do not dispatch this task, until the owner answers. If the owner changes a row, edit the row and this task's step that applies it, then present the changed rows again.

- [ ] **Step 2: Record the approval.** Directly under the heading `### Addendum: Task 7b`, replace `**Not yet approved.**` with `**Approved by the owner on <YYYY-MM-DD>** (rows as listed; changes: <none | list>).`. Commit:

```bash
git add docs/superpowers/plans/2026-10-14-corporate-one-screen.md
git commit -m "docs(plan): owner approved the Task 7b test-change addendum" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Helpers (P1).** In `tests/e2e/helpers/corporateDcf.ts`, replace the block from `/** The three lower tabs of /corporate` through the end of `lowerPanel` with:

```ts
/**
 * The four page tabs of /corporate (spec §2A, plan Task 7b). They were three lower tabs until D10.
 * The helper names stayed "lower" so the approved specs that call them need no rename.
 */
export type LowerTabName = "Summary" | "Core Diagnostics" | "DCF" | "Target Stock Comparison";

export async function openLowerTab(page: Page, name: LowerTabName): Promise<void> {
  const tab = page.getByTestId("corporate-page-tabs").getByRole("tab", { name });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** The selected page tab's panel (never the modal's). */
export function lowerPanel(page: Page): Locator {
  return page.getByTestId("corporate-page-tabs").getByRole("tabpanel");
}
```

Replace `refreshDcf` with the version below. It now reads the strip, so a spec that refreshes while another tab is open still works (`corporate-dcf-sensitivity.spec.ts:139` does this on the DCF tab):

```ts
/** Refresh DCF, then wait until the verdict holds a valuation. Reads the header strip, which every page tab shows. */
export async function refreshDcf(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  await expect(page.getByTestId("corporate-verdict-strip")).toHaveAttribute("data-state", "valued", { timeout: 60_000 });
}
```

- [ ] **Step 4: Write the failing tests.**

  **P5, `corporate-model.spec.ts`.**
  - Change the import `import { verdictLabelKey } from "../../app/corporate/verdict";` to `import { verdictLabelKey, verdictView } from "../../app/corporate/verdict";`.
  - Add `import { LEGACY_LOWER_TAB_KEY, migrateLowerTab, PAGE_TAB_KEY } from "../../app/corporate/pageTabs";` and `import type { DcfSummary } from "../../../../packages/shared-types";`.
  - Append:

```ts
const DCF: DcfSummary = {
  report_id: "m-1", ticker: "AAPL", estimated_value: 240.5, intrinsic_value_per_share: 240.5,
  enterprise_value: 1462.4, equity_value: 1300.2, valuation_method: "fcff_equity_bridge", bridge_quality: "ok",
  current_price: 210.4, upside_pct: 14.31, terminal_value_share_pct: 70.71, wacc_minus_terminal_growth: null,
  terminal_growth_binding_constraint: null, status: "Undervalued", generated_at: "2026-10-14T00:00:00Z",
};

test.describe("verdictView", () => {
  test("a bridged valuation carries its per-share value, upside, price and status", () => {
    expect(verdictView(DCF, false, null)).toMatchObject({
      state: "valued", intrinsic: 240.5, upside: 14.31, currentPrice: 210.4, status: "Undervalued",
    });
  });

  test("an unbridged valuation withholds value and upside, and keeps the EV aside", () => {
    const view = verdictView({ ...DCF, bridge_quality: "missing", estimated_value: 1462.4, upside_pct: 0 }, false, null);
    expect(view).toMatchObject({ state: "valued", intrinsic: null, upside: null, enterpriseValue: 1462.4 });
  });

  test("a refusal wins over a value and over a running stream", () => {
    expect(verdictView(DCF, true, "reason").state).toBe("refused");
    expect(verdictView(null, false, "reason")).toMatchObject({ state: "refused", refusalText: "reason", intrinsic: null });
  });

  test("streaming without a value is streaming; with a cached value it stays valued", () => {
    expect(verdictView(null, true, null).state).toBe("streaming");
    expect(verdictView(DCF, true, null)).toMatchObject({ state: "valued", streaming: true });
    expect(verdictView(null, false, null).state).toBe("idle");
  });
});

/** A sessionStorage stand-in that records what was written. */
function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

test.describe("migrateLowerTab", () => {
  test("a chosen DCF or comparison tab moves to the page-tab key, and the old key is dropped", () => {
    for (const tab of ["dcf", "comparison"]) {
      const storage = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: JSON.stringify(tab) });
      migrateLowerTab(storage);
      expect(storage.map.get(PAGE_TAB_KEY)).toBe(JSON.stringify(tab));
      expect(storage.map.has(LEGACY_LOWER_TAB_KEY)).toBe(false);
    }
  });

  test("diagnostics, the old default that useTabState wrote back on every visit, is not carried", () => {
    const storage = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: JSON.stringify("diagnostics") });
    migrateLowerTab(storage);
    expect(storage.map.has(PAGE_TAB_KEY)).toBe(false);
    expect(storage.map.has(LEGACY_LOWER_TAB_KEY)).toBe(false);
  });

  test("a stored page tab wins, and junk is dropped without a throw", () => {
    const chosen = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: JSON.stringify("dcf"), [PAGE_TAB_KEY]: JSON.stringify("summary") });
    migrateLowerTab(chosen);
    expect(chosen.map.get(PAGE_TAB_KEY)).toBe(JSON.stringify("summary"));
    const junk = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: "{not json" });
    expect(() => migrateLowerTab(junk)).not.toThrow();
    expect([...junk.map.keys()]).toEqual([]);
  });

  test("it runs once: a second call finds nothing to move", () => {
    const storage = memoryStorage({ [LEGACY_LOWER_TAB_KEY]: JSON.stringify("comparison") });
    migrateLowerTab(storage);
    storage.map.set(PAGE_TAB_KEY, JSON.stringify("summary"));
    migrateLowerTab(storage);
    expect(storage.map.get(PAGE_TAB_KEY)).toBe(JSON.stringify("summary"));
  });
});
```

  **P2, `corporate-one-screen.spec.ts`, "the lower tabs".**
  - Change the import `import { lowerPanel, openLowerTab } from "./helpers/corporateDcf";` to `import { loadFullDcfReportInTab, lowerPanel, openLowerTab, refreshDcf } from "./helpers/corporateDcf";`.
  - Replace the line `test.describe("the lower tabs", () => {` and its first two tests, from `test("diagnostics is the default` through the end of `test("an unknown stored tab falls back to diagnostics"`, with the code below. The DCF and comparison tests that follow stay unchanged.

```ts
test.describe("the page tabs", () => {
  test("Summary is the default, each tab mounts only its own content, and the choice survives leaving the page", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    const tabs = page.getByTestId("corporate-page-tabs");
    await expect(tabs.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    // Prefixed ids: the detail modal's own Summary tab (Task 8) must not share an id with this one.
    await expect(page.locator("#corporate-tab-summary")).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page)).toHaveAttribute("aria-labelledby", "corporate-tab-summary");
    await expect(lowerPanel(page).getByTestId("corporate-verdict")).toBeVisible();
    await expect(page.getByText("Hurdle Rate Decomposition", { exact: true })).toHaveCount(0);
    await openLowerTab(page, "DCF");
    await expect(lowerPanel(page).getByText("DCF Core Modules").first()).toBeVisible();
    await expect(page.getByTestId("corporate-verdict")).toHaveCount(0);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await gotoCorporate(page);
    await expect(tabs.getByRole("tab", { name: "DCF" })).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page).getByText("DCF Core Modules").first()).toBeVisible();
  });

  test("an unknown stored tab falls back to Summary", async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem("moneyview.tab.corporate.pageTab", JSON.stringify("bogus")));
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    // The restore runs in an effect after hydration; let it run before reading the selection.
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("corporate-page-tabs").getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page).getByTestId("corporate-verdict")).toBeVisible();
  });

  test("a pre-D10 lower-tab choice is carried over, and the old key is dropped", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    // An older session: only the lower-tab key, written before the page had page tabs. Seeded once,
    // not via addInitScript, which would re-seed on the reload.
    await page.evaluate(() => {
      window.sessionStorage.removeItem("moneyview.tab.corporate.pageTab");
      window.sessionStorage.setItem("moneyview.tab.corporate.lowerTab", JSON.stringify("comparison"));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("corporate-page-tabs").getByRole("tab", { name: "Target Stock Comparison" }))
      .toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("moneyview.tab.corporate.lowerTab"))).toBeNull();
  });
```

  **P3, the fit test.**
  - Add the function below at module level, directly above `test.describe("at 1280x720", () => {`.
  - Replace that describe's `expectAboveTheFold` function and the test that calls it with the code that follows.

```ts
// Spec §2A: the document never scrolls; overflow belongs to the tab panel. Sideways is checked too,
// because both 390 px regressions (ERROR-LOG 2026-10-14) widened the page rather than lengthening it.
async function expectNoPageScroll(page: Page, where: string) {
  const size = await page.evaluate(() => ({
    height: document.scrollingElement!.scrollHeight,
    innerHeight: window.innerHeight,
    width: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.height, `${where}: the page does not scroll`).toBeLessThanOrEqual(size.innerHeight);
  expect(size.width, `${where}: the page is not wider than the viewport`).toBeLessThanOrEqual(size.clientWidth + 1);
}
```

```ts
  // Spec §2A and §7 test 1. The header, the verdict strip and the tab bar end inside 720px. The Summary
  // blocks end inside the Summary panel, so the answer needs neither a page scroll nor a panel scroll.
  async function expectSummaryFits(page: Page) {
    const panel = await lowerPanel(page).boundingBox();
    expect(panel, "the Summary panel is rendered").not.toBeNull();
    const panelBottom = panel!.y + panel!.height;
    const blocks: [string, Locator, number][] = [
      // The eyebrow sits above the title and is the header's top edge: the title alone can clear
      // the bar on a lower top padding, because the eyebrow pushes it down.
      ["header eyebrow", page.getByRole("heading", { name: /Corporate Analysis/i }).locator("xpath=preceding-sibling::div[1]"), 720],
      ["title", page.getByRole("heading", { name: /Corporate Analysis/i }), 720],
      ["company line", page.getByTestId("corporate-company-line"), 720],
      ["verdict strip", page.getByTestId("corporate-verdict-strip"), 720],
      ["tab bar", page.getByRole("tablist", { name: "Corporate analysis sections" }), 720],
      ["verdict", page.getByTestId("corporate-verdict"), panelBottom],
      ["KPI row", page.getByTestId("corporate-kpis"), panelBottom],
      ["assumption table", page.getByTestId("assumption-table"), panelBottom],
    ];
    for (const [name, locator, bottom] of blocks) {
      const box = await locator.boundingBox();
      expect(box, `${name} is rendered`).not.toBeNull();
      expect(box!.y, `${name} starts below the 48px bar`).toBeGreaterThanOrEqual(48);
      expect(box!.y + box!.height, `${name} ends by ${Math.round(bottom)}px`).toBeLessThanOrEqual(bottom);
    }
    await expect(page.getByTestId("corporate-kpis").getByRole("button")).toHaveCount(4);
    const scroll = await page.getByTestId("assumption-scroll").boundingBox();
    expect(scroll!.height, "the assumption table scrolls inside its 288px budget").toBeLessThanOrEqual(288);
    await expectNoPageScroll(page, "Summary");
  }

  test("header, strip, tab bar and the whole Summary tab fit with no scroll of any kind", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await expectSummaryFits(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await expectSummaryFits(page);
    await page.getByTestId("assumption-table").getByRole("button", { name: "Edit WACC" }).click();
    await expect(page.getByTestId("assumption-slider-wacc")).toBeVisible();
    await expectSummaryFits(page);
  });
```

  **P4, Korean.** In "title, verdict, a figure and a bilingual header read in Korean", change `page.getByTestId("corporate-lower-tabs")` to `page.getByTestId("corporate-page-tabs")`.

  **P6, new tests.** Append to `corporate-one-screen.spec.ts`:

```ts
for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test.describe(`at ${viewport.width}x${viewport.height}, on every page tab`, () => {
    test.use({ viewport });

    test("the page never scrolls; the panel takes the overflow", async ({ page }) => {
      await mockCorporatePageApi(page);
      await gotoCorporate(page);
      await refreshDcf(page);
      await expectNoPageScroll(page, "Summary");
      await openLowerTab(page, "Core Diagnostics");
      await expect(lowerPanel(page).getByText("Hurdle Rate Decomposition", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expectNoPageScroll(page, "Core Diagnostics");
      const report = await loadFullDcfReportInTab(page);
      await expect(report.getByText("WACC x Terminal Growth Sensitivity")).toBeVisible({ timeout: 30_000 });
      await expectNoPageScroll(page, "DCF");
      await openLowerTab(page, "Target Stock Comparison");
      await lowerPanel(page).getByRole("button", { name: "Refresh comparison" }).click();
      await expect(lowerPanel(page).getByText("Price Vs Fair Value Map")).toBeVisible({ timeout: 30_000 });
      await expectNoPageScroll(page, "Target Stock Comparison");
      // The comparison tab is taller than its panel at both sizes: the panel, not the page, scrolls.
      const panel = await lowerPanel(page).evaluate((element) => ({
        overflows: element.scrollHeight > element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
      }));
      expect(panel).toEqual({ overflows: true, overflowY: "auto" });
    });
  });
}

test.describe("the verdict strip", () => {
  const strip = (page: Page) => page.getByTestId("corporate-verdict-strip");

  const valuedCases = [
    { name: "a bridged valuation", overrides: {}, intrinsic: "$240.5", dir: "up", value: "+14.3%", label: "Undervalued" },
    {
      name: "an unbridged valuation",
      overrides: { status: "Bridge Incomplete", bridge_quality: "missing", intrinsic_value_per_share: null, estimated_value: 1462.4, upside_pct: 0 },
      intrinsic: "—", dir: "flat", value: "—", label: "Per-share value unavailable",
    },
  ] as const;

  for (const c of valuedCases) {
    test(`${c.name}: the strip shows what the Summary block shows`, async ({ page }) => {
      await mockCorporatePageApi(page);
      await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) =>
        route.fulfill({ status: 200, contentType: "text/event-stream", body: dcfStream(c.overrides) }));
      await gotoCorporate(page);
      await page.getByRole("button", { name: "Refresh DCF" }).click();
      for (const target of [verdict(page), strip(page)]) {
        await expect(target).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
        await expect(target.locator('[data-part="intrinsic"]')).toHaveText(c.intrinsic);
        await expect(target.getByTestId("delta-badge")).toHaveAttribute("data-dir", c.dir);
        await expect(target.getByTestId("delta-badge").locator('[data-part="value"]')).toHaveText(c.value);
        await expect(target.locator('[data-part="label"]')).toContainText(c.label);
      }
      await expect(strip(page)).not.toContainText("1,462.4");
    });
  }

  test("idle and refused: the strip carries the block's state and never a number", async ({ page }) => {
    await mockCorporatePageApi(page);
    await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) => route.fulfill({
      status: 422, contentType: "application/json",
      body: JSON.stringify({ detail: { code: "non_positive_fcff", message: "Free cash flow is zero or negative over the forecast, so the model cannot value it." } }),
    }));
    await gotoCorporate(page);
    await expect(verdict(page)).toHaveAttribute("data-state", "idle");
    await expect(strip(page)).toHaveAttribute("data-state", "idle");
    await expect(strip(page)).toHaveText("DCF not calculated");
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "refused");
    await expect(strip(page)).toHaveAttribute("data-state", "refused");
    await expect(strip(page)).toContainText("Not valued");
    await expect(strip(page)).toHaveAttribute("title", /zero or negative over the forecast/);
    await expect(strip(page)).not.toContainText("$");
  });

  test("every page tab shows the strip, and it opens the Intrinsic DCF detail", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await refreshDcf(page);
    for (const tab of ["Core Diagnostics", "DCF", "Target Stock Comparison", "Summary"] as const) {
      await openLowerTab(page, tab);
      await expect(strip(page), tab).toBeVisible();
      await expect(strip(page).locator('[data-part="intrinsic"]'), tab).toHaveText("$240.5");
      await expect(strip(page).locator('[data-part="label"]'), tab).toContainText("Undervalued");
    }
    await openLowerTab(page, "DCF");
    await strip(page).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /Apple Intrinsic DCF$/ })).toBeVisible();
  });
});
```

- [ ] **Step 5: Run to see them fail.** From `apps/web`, run the two specs separately, because the model spec cannot load until the modules exist:
  - `npx playwright test tests/e2e/corporate-model.spec.ts --workers=2`. Expected: FAIL to load; `../../app/corporate/pageTabs` is not found and `verdictView` is not exported.
  - `npx playwright test tests/e2e/corporate-one-screen.spec.ts --workers=2`. Expected: FAIL:
    - `corporate-page-tabs` and `corporate-verdict-strip` are not found, so every test that opens a tab or reads the strip times out;
    - the no-page-scroll checks report a document height of about 1106 at 1280×720.
  - Record each failing test and its reason in the task report. If a run is stopped, kill :8110/:3101 (Global Constraints) before the next one.

- [ ] **Step 6: `apps/web/app/corporate/pageTabs.ts`** (new, LF)

```ts
import { tabStateKey } from "@/lib/tabState";

// Spec §2A (D10): the corporate page's four tabs, in order.
export const PAGE_TABS = ["summary", "diagnostics", "dcf", "comparison"] as const;
export type PageTabKey = (typeof PAGE_TABS)[number];

export const PAGE_TAB_KEY = tabStateKey("corporate", "pageTab");
/** Where the three lower tabs kept their choice before D10 (plan Task 6). */
export const LEGACY_LOWER_TAB_KEY = tabStateKey("corporate", "lowerTab");

export const isPageTab = (value: unknown): value is PageTabKey =>
  typeof value === "string" && (PAGE_TABS as readonly string[]).includes(value);

/**
 * Moves a pre-D10 lower-tab choice to the page-tab key, once: the old key is always removed.
 * Only "dcf" and "comparison" move. "diagnostics" was the old default, and useTabState writes its
 * value back on every mount, so a stored "diagnostics" does not mean the reader chose it (plan N12).
 * A page tab that is already stored wins.
 */
export function migrateLowerTab(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  const legacy = storage.getItem(LEGACY_LOWER_TAB_KEY);
  if (legacy === null) return;
  storage.removeItem(LEGACY_LOWER_TAB_KEY);
  if (storage.getItem(PAGE_TAB_KEY) !== null) return;
  let value: unknown;
  try {
    value = JSON.parse(legacy);
  } catch {
    return; // written by an older shape; Summary is the honest default
  }
  if (value === "dcf" || value === "comparison") storage.setItem(PAGE_TAB_KEY, legacy);
}
```

- [ ] **Step 7: `verdictView` in `apps/web/app/corporate/verdict.ts`** (keep CRLF). Add at the top: `import type { DcfSummary } from "../../../../packages/shared-types";` and `import { bridgedEstimatedValue, bridgedUpsidePct } from "@/lib/bridgeQuality";`. Append:

```ts
export type VerdictState = "idle" | "streaming" | "valued" | "refused";

/** Everything the verdict block and the header strip show, decided once (spec §2.2, §2A). */
export interface VerdictView {
  state: VerdictState;
  streaming: boolean;
  /** Intrinsic value per share; null when the bridge did not resolve or nothing is valued. */
  intrinsic: number | null;
  /** Upside in percent against that per-share value; null on the same conditions. */
  upside: number | null;
  /** Enterprise value, shown only beside an empty per-share slot. A value restored from an older session cache can lack it. */
  enterpriseValue: number | null;
  currentPrice: number | null;
  /** The backend's status, translated by VerdictStatusLabel; "" unless valued. */
  status: string;
  refusalText: string | null;
}

export function verdictView(dcf: DcfSummary | null, streaming: boolean, refusalText: string | null): VerdictView {
  const state: VerdictState = refusalText !== null ? "refused" : dcf ? "valued" : streaming ? "streaming" : "idle";
  const shown = state === "valued" ? dcf : null; // a refusal hides any value still held
  return {
    state,
    streaming,
    intrinsic: shown ? bridgedEstimatedValue(shown) : null,
    upside: shown ? bridgedUpsidePct(shown) : null,
    enterpriseValue: shown && typeof shown.enterprise_value === "number" ? shown.enterprise_value : null,
    currentPrice: shown ? shown.current_price : null,
    status: shown ? shown.status : "",
    refusalText,
  };
}
```

- [ ] **Step 8: `Tabs` id prefix** (`components/ui/Tabs.tsx`):
  - Add `idPrefix?: string;` to `TabsProps`, with the comment `/** Prefixes tab and panel ids, so two tab sets on one page (page tabs and a modal's) never share an id. */`.
  - Destructure `idPrefix = "",`.
  - Change `id={\`tab-${item.key}\`}` to `id={\`${idPrefix}tab-${item.key}\`}`, and change `aria-controls={\`panel-${item.key}\`}` to `aria-controls={\`${idPrefix}panel-${item.key}\`}`.

  No other caller passes the prop, so every other tab set renders unchanged.

- [ ] **Step 9: `CorporatePageTabs`.** From the repo root, run `git mv apps/web/app/corporate/components/CorporateLowerTabs.tsx apps/web/app/corporate/components/CorporatePageTabs.tsx`, then write the file as:

```tsx
"use client";

import { type ReactNode, useEffect } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { useTabState } from "@/lib/tabState";
import { isPageTab, migrateLowerTab, PAGE_TAB_KEY, PAGE_TABS, type PageTabKey } from "../pageTabs";

// Spec §2A (D10): four tabs directly under the header. The panel fills what the page column leaves
// and scrolls inside itself, so the page never scrolls. Only the active panel is mounted, so a hidden
// tab's charts and requests do not run.
export function CorporatePageTabs({ panels }: { panels: Record<PageTabKey, ReactNode> }) {
  const t = useT();
  // Declared before useTabState on purpose: effects run in declaration order, so the old lower-tab
  // value has moved before useTabState's restore effect reads the page-tab key.
  useEffect(() => {
    try {
      migrateLowerTab(window.sessionStorage);
    } catch {
      // Blocked storage: the default tab is the honest answer.
    }
  }, []);
  const [stored, setStored] = useTabState<string>(PAGE_TAB_KEY, "summary");
  const active: PageTabKey = isPageTab(stored) ? stored : "summary";
  return (
    <section data-testid="corporate-page-tabs" className="flex min-h-0 flex-1 flex-col gap-3">
      <Tabs
        ariaLabel={t("corporate.tabs.aria")}
        activeKey={active}
        onChange={setStored}
        idPrefix="corporate-"
        className="shrink-0 [contain:inline-size]"
        items={PAGE_TABS.map((key) => ({ key, label: t(`corporate.tabs.${key}`) }))}
      />
      <div
        role="tabpanel"
        id={`corporate-panel-${active}`}
        aria-labelledby={`corporate-tab-${active}`}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        {panels[active]}
      </div>
    </section>
  );
}
```

- [ ] **Step 10: The block and the strip** (`VerdictBlock.tsx`).
  - Imports: delete `import type { DcfSummary } …`. Change the `@/lib/bridgeQuality` import to `import { UNBRIDGED_REASON } from "@/lib/bridgeQuality";`, and the `../verdict` import to `import { verdictLabelKey, type VerdictView } from "../verdict";`.
  - Replace everything from `interface VerdictBlockProps {` to the end of the file with:

```tsx
interface VerdictProps {
  view: VerdictView;
  onOpenDetail: () => void;
}

// Spec §2.2: intrinsic value vs price and the upside, under the backend's own status label.
export function VerdictBlock({ view, onOpenDetail }: VerdictProps) {
  const t = useT();
  const { state, streaming, intrinsic, upside, enterpriseValue, currentPrice, status, refusalText } = view;

  return (
    <section data-testid="corporate-verdict" data-state={state} data-busy={streaming ? "true" : undefined}>
      <Card padding="sm" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow label="verdict" />
          {streaming && state === "valued" ? (
            <span data-part="busy" className="type-caption mr-auto text-[var(--ink-muted)]">{t("corporate.verdict.streaming")}</span>
          ) : null}
          <button
            type="button"
            onClick={onOpenDetail}
            aria-label={t("corporate.verdict.detail")}
            title={t("corporate.verdict.detail")}
            className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-1)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            <Info aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {state === "refused" ? (
          <p data-testid="dcf-refusal" className="type-body text-[var(--ink-secondary)]">
            {t("corporate.verdict.refused", { reason: refusalText ?? "" })}
          </p>
        ) : state === "idle" ? (
          <p className="type-body text-[var(--ink-muted)]">{t("corporate.verdict.idle")}</p>
        ) : state === "streaming" ? (
          <p className="type-body text-[var(--ink-muted)]">{t("corporate.verdict.streaming")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="type-small text-[var(--ink-muted)]">{t("corporate.verdict.intrinsic")}</span>
              <span data-part="intrinsic" className="type-figure-md text-[var(--ink)]" title={intrinsic === null ? UNBRIDGED_REASON : undefined}>
                {intrinsic === null ? MISSING : moneyText(intrinsic)}
              </span>
              <span className="type-small text-[var(--ink-muted)]">{t("corporate.verdict.vs")} {t("corporate.verdict.current")}</span>
              <span data-part="price" className="type-mono text-[var(--ink)]">{currentPrice === null ? MISSING : moneyText(currentPrice)}</span>
            </div>
            {intrinsic === null && enterpriseValue !== null ? (
              <span data-part="ev" className="type-small text-[var(--ink-muted)]">
                {t("corporate.verdict.ev", { value: moneyText(enterpriseValue) })}
              </span>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <DeltaBadge value={upside} />
              <VerdictStatusLabel status={status} />
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

const STRIP_TEXT = {
  idle: "corporate.verdictStrip.idle",
  streaming: "corporate.verdict.streaming",
  refused: "corporate.verdictStrip.refused",
} as const;

/**
 * Spec §2A: the verdict in one line beside the company line, so every page tab shows the answer.
 * It renders the same VerdictView as the block. Its accessible name comes from its content and must not
 * contain "Verdict detail" (the block's ⓘ, clicked by name in four specs); it reuses none of the
 * block's testids.
 */
export function VerdictStrip({ view, onOpenDetail }: VerdictProps) {
  const t = useT();
  return (
    <button
      type="button"
      data-testid="corporate-verdict-strip"
      data-state={view.state}
      onClick={onOpenDetail}
      title={view.state === "refused" ? t("corporate.verdict.refused", { reason: view.refusalText ?? "" }) : undefined}
      className="type-small inline-flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-1)] text-left text-[var(--ink-secondary)] hover:text-[var(--ink)]"
    >
      {view.state === "valued" ? (
        <>
          <span>{t("corporate.verdict.intrinsic")}</span>
          <span data-part="intrinsic" className="type-mono text-[var(--ink)]">{view.intrinsic === null ? MISSING : moneyText(view.intrinsic)}</span>
          <DeltaBadge value={view.upside} />
          <VerdictStatusLabel status={view.status} />
        </>
      ) : (
        <span>{t(STRIP_TEXT[view.state])}</span>
      )}
    </button>
  );
}
```

  `VerdictStatusLabel` above it is unchanged. The block keeps its old `streaming && dcf` busy rule as `streaming && state === "valued"`: a refusal clears `dcf` (`setDcfStreamResult(null)`), so the two rules agree.

- [ ] **Step 11: Header slot.**
  - In `components/ui/PageHeader.tsx`:
    - Add `subtitleAside?: ReactNode;` to the props interface, with the comment `/** Beside the subtitle on wide screens, under it on narrow ones (the corporate verdict strip). */`, and add `subtitleAside` to the destructuring.
    - Replace the line `{subtitle && <p data-testid={subtitleTestId} className="type-body mt-1 text-[var(--ink-secondary)]">{subtitle}</p>}` with the block below. Pages that do not pass the prop render the same DOM as before.

```tsx
        {subtitle && !subtitleAside && <p data-testid={subtitleTestId} className="type-body mt-1 text-[var(--ink-secondary)]">{subtitle}</p>}
        {subtitleAside && (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            {subtitle && <p data-testid={subtitleTestId} className="type-body text-[var(--ink-secondary)]">{subtitle}</p>}
            {subtitleAside}
          </div>
        )}
```

  - In `CorporateHeader.tsx`:
    - Change the React import to `import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";`.
    - Add `/** The one-line verdict beside the company line (spec §2A). */ verdictStrip?: ReactNode;` to `CorporateHeaderProps`, and `verdictStrip` to the destructuring.
    - Add `subtitleAside={verdictStrip}` directly after `subtitleTestId="corporate-company-line"`.

    The company line `<p>` keeps its text exactly, so `toHaveText(/^Apple · .+ · \$210\.4$/)` still holds.

- [ ] **Step 12: Catalog and glossary.**
  - In `en.ts`, inside `corporate.tabs`, add `summary: "Summary",` after `aria: …,`. After the `verdict: { … },` block, add `verdictStrip: { idle: "DCF not calculated", refused: "Not valued" },`.
  - In `ko.ts`, add `summary: "요약",` and `verdictStrip: { idle: "DCF 미계산", refused: "평가하지 않음" },`.
  - Add these glossary rows:

```markdown
| Summary | 요약 | corporate page tab |
| Not valued | 평가하지 않음 | verdict strip, refused DCF |
```

- [ ] **Step 13: Wire `page.tsx`.** Anchors are quoted from the file at `21362c1`, 1,092 lines.
  1. Imports:
     - `import { CorporateLowerTabs } from "./components/CorporateLowerTabs";` → `import { CorporatePageTabs } from "./components/CorporatePageTabs";`
     - `import { VerdictBlock } from "./components/VerdictBlock";` → `import { VerdictBlock, VerdictStrip } from "./components/VerdictBlock";`
     - add `import { verdictView } from "./verdict";`
  2. After the line `const canLoadFullReport = dcfRefusal === null && !(!dcfData && dcfStreamStatus === "idle");`, add:
     ```ts
       const verdict = verdictView(dcfData, dcfStreamStatus === "streaming", dcfRefusal?.readerText ?? null); // block + strip, spec §2A
     ```
  3. The root: `<div className="mx-auto max-w-7xl space-y-4">` → `<div className="mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col">`.
  4. In `<CorporateHeader …>`, after `onRefreshDcf={handleRefreshDcf}`, add `verdictStrip={<VerdictStrip view={verdict} onOpenDetail={() => setActiveCalculation("backendDcf")} />}`.
  5. Move the first-screen section into the tabs.
     - Delete the JSX comment `{/* First screen (spec §2): … */}`.
     - Cut the `<section className="grid grid-cols-1 gap-4 lg:grid-cols-3">…</section>` that follows it, delete the blank line after it, and change `<CorporateLowerTabs` to `<CorporatePageTabs`.
     - Make the first entry of `panels={{` the block below. Inside it, the `<section>` is the cut element, unchanged except that its six-line `<VerdictBlock … />` becomes the one line shown:

```tsx
          // Summary (spec §2A): verdict and KPIs on the left 2/3, the assumption table on the right 1/3.
          summary: (
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-3 lg:col-span-2">
                <VerdictBlock view={verdict} onOpenDetail={() => setActiveCalculation("backendDcf")} />
                <KpiRow … unchanged … />
              </div>
              <AssumptionTable … unchanged … />
            </section>
          ),
```

  6. Run `npm run lint`. Remove only the imports this made unused; none are expected, because `dcfRefusal` and `dcfStreamStatus` are still read.
  7. Run `wc -l app/corporate/page.tsx`. Expected: **about 1,091**. The changes are: imports +1 net, the `verdict` line +1, the strip prop +1, `summary: (` and `),` +2, the block call −5 and the deleted blank line −1, for −1 in all. Gate: **≤ 1,092**. The page must not grow.

- [ ] **Step 14: Run.** `npx playwright test tests/e2e/corporate-model.spec.ts tests/e2e/corporate-one-screen.spec.ts tests/e2e/corporate-detail-tabs.spec.ts --workers=2` (the last only if Task 8 has created it). Expected: PASS.
  - If the fit test fails, read the failing block and box from the message. Fix the layout; do not loosen the test.
  - The measured budget at 1280×720 is tight:
    - The root runs from y=64 to y=640.
    - The header ends at about 160, plus `mb-6` → 184.
    - The tab bar is 41 px → 225, plus `gap-3` → the panel starts at about 237.
    - That leaves a panel of about 403 px for the 388 px assumption table.
  - Levers, in order: the tabs' `gap-3` → `gap-2`; the strip's `gap-2` → `gap-1.5`. Do not touch AppShell or the 288 px cap.
  - Record the measured boxes in the task report.

- [ ] **Step 15: Approved edits #58–#65.**
  - First run the five affected specs unedited against the new code. Each row's line must fail for the reason the row gives. Record each one.
  - Then apply the rows, and run `npx playwright test tests/e2e/corporate-*.spec.ts tests/e2e/refresh-idle-state.spec.ts tests/e2e/terminal-diagnostics.spec.ts tests/e2e/high-risk-render-regression.spec.ts tests/e2e/responsive-accessibility.spec.ts tests/e2e/tab-state-persistence.spec.ts --workers=2`. Expected: PASS.
  - If any other existing assertion fails, stop and report it.

- [ ] **Step 16: Gates.**
  - `npm run typecheck && npm run lint && npm run test:unit`.
  - `npm run design:baseline -- app/corporate/pageTabs.ts app/corporate/components/CorporatePageTabs.tsx app/corporate/components/VerdictBlock.tsx components/ui/Tabs.tsx components/ui/PageHeader.tsx app/corporate/components/CorporateHeader.tsx` must report 0 in every category.
  - `wc -l app/corporate/page.tsx` must print ≤ 1092.
  - `git ls-files --eol` must show the new `pageTabs.ts` as `w/lf`, and each edited file must keep its working-tree ending.

- [ ] **Step 17: Mutation matrix** (Global Constraints procedure: `mktemp -d` backup, one Edit, the named test FAILS for the named reason, restore with `cp -p`, `cmp` prints nothing)

| # | Mutation | Must fail |
|---|---|---|
| 1 | `CorporatePageTabs`: `useTabState(PAGE_TAB_KEY, "diagnostics")` and fallback `"diagnostics"` | `Summary is the default…` (Summary not selected) |
| 2 | `idPrefix="corporate-"` removed | same test (`#corporate-tab-summary` not found) |
| 3 | `active` without the `isPageTab` guard (`stored as PageTabKey`) | `an unknown stored tab falls back to Summary` (no tab selected, no verdict) |
| 4 | migration `useEffect` moved below `useTabState` | `a pre-D10 lower-tab choice is carried over…` (Summary stays selected: the write-back overwrites the migrated value) |
| 5 | `migrateLowerTab` without `storage.removeItem(LEGACY_LOWER_TAB_KEY)` | model `a chosen DCF or comparison tab moves…` and e2e `…the old key is dropped` (poll never null) |
| 6 | `migrateLowerTab` carries any page tab (`if (isPageTab(value))`) | model `diagnostics … is not carried` |
| 7 | the "page tab already stored wins" line removed | model `a stored page tab wins…` and `it runs once…` |
| 8 | `verdictView` intrinsic `valued ? dcf.estimated_value : null` | model `an unbridged valuation withholds…`; e2e `an unbridged valuation: the strip shows…` (`$1,462.4`) |
| 9 | `verdictView` state ignores `refusalText` | model `a refusal wins…`; e2e `idle and refused…` |
| 10 | `VerdictStrip` renders `{view.status}` instead of `VerdictStatusLabel` | `an unbridged valuation: the strip shows…` (label "Bridge Incomplete") |
| 11 | `VerdictStrip` `onClick={() => {}}` | `every page tab shows the strip, and it opens…` (no dialog) |
| 12 | `page.tsx`: the strip moved from `verdictStrip=` into the summary panel | `every page tab shows the strip…` (count 0 on Core Diagnostics) |
| 13 | tabpanel without `overflow-auto` | `the page never scrolls; the panel takes the overflow` at both sizes |
| 14 | root height without `_-_var(--main-pad-bottom,0px)` | same test at 1280×720 (scrollHeight 800 > 720) |
| 15 | root `h-[calc(…)]` removed | same test, and the fit test (`assumption table ends by …`) |
| 16 | `AssumptionTable` `max-h-72` removed | fit test (`assumption table ends by <panel bottom>` or the 288 check) |
| 17 | `AppShell` `[--main-pad-top:4rem]` → `2rem` | fit test (`header eyebrow starts below the 48px bar`) |
| 18 | `PageHeader` ignores `subtitleAside` | fit test (`verdict strip is rendered`) and every strip test |
| 19 | helper `refreshDcf` waits on `corporate-verdict` again | `corporate-dcf-sensitivity.spec.ts` "the Terminal Value Share tile reports the backend measurement" (block unmounted on the DCF tab). This shows P1 is what keeps that spec unedited. |

  A mutation that does not make its test fail is reported as a survivor, with the reason, and is not reported as passing (CLAUDE.md §8).

- [ ] **Step 18: Commit.** In `todo.md` Track D, change `- [x] C7 header  - [ ] C8 modal tabs` to `- [x] C7 header  - [x] C7b page tabs + verdict strip (D10)  - [ ] C8 modal tabs`.

```bash
git add apps/web/app/corporate apps/web/components/ui/Tabs.tsx apps/web/components/ui/PageHeader.tsx apps/web/lib/i18n apps/web/tests/e2e docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(corporate): four page tabs and a header verdict strip; the page never scrolls (D10)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Calculation detail modal in six tabs: shell, Summary, Calculation steps, Raw data (spec §4)

**Files:**
- Create: `apps/web/app/corporate/components/detail/detailParts.tsx`, `detail/SummaryTab.tsx`, `detail/StepsTab.tsx`, `detail/RawDataTab.tsx`, `apps/web/tests/e2e/corporate-detail-tabs.spec.ts`
- Rewrite: `apps/web/app/corporate/components/CalculationDetailModal.tsx` (682 → about 110 lines)
- Modify: `apps/web/app/corporate/page.tsx`, `apps/web/lib/i18n/messages/{en,ko}.ts`, `apps/web/lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md`, `apps/web/tests/e2e/helpers/corporateDcf.ts`, `guideline/sop/todo.md`
- Approved test edits: inventory #50–#55, plus import row #56

> **After Task 7b:** the KPIs, the assumption table and the "Verdict detail" button are on the Summary page tab, which is the default; this task's tests open them from a fresh load, so none changes. The modal's `Tabs` keeps the default `idPrefix` (`tab-summary`); the page tabs carry `corporate-`, so the two never share an id. A test here that opens another page tab first must call `openLowerTab(page, "Summary")` before using them.

The old modal had 13 sections. This task places them as follows:

| Old section (CalculationDetailModal.tsx at plan time) | New tab |
|---|---|
| metric audit (289–305) | Calculation steps |
| Audit Actions (306–333) and Export Affordances (651–678), duplicates | Raw data (one export row) |
| four metric cards (335–344) | Summary (big value, status, meaning) |
| Formula Explanation (346–372) | Summary (formula + substituted); the result and time-horizon boxes → Calculation steps |
| Result Summary table (374–381) | Summary (with an as-of column, N3) |
| Data Lineage, Supporting Rows, Raw Data Access (383–408) | Calculation steps |
| Full DCF Report (410–511), Raw Datasets (513–549), OHLCV (551–601), Quarterly (603–649) | Raw data |

**Interfaces:**
- Consumes: Task 4 `availableDetailTabs`, `resolveDetailTab`, `DetailTabKey`, `substitutedFormula`, `FormulaContext`; Task 5 `VerdictStatusLabel`; `Tabs`, `ModalShell`, `MetricAuditPanel`, `MetricQualityBadge`, `StatusBadge`, `ActionButton`, `EmptyState`, `ErrorState`, `BilingualLabel`, `DcfSensitivityTable`, `useTabState`.
- Produces:
  - `CalculationDetailModal` props: everything it had, plus `detailKey: CalculationDetailKey`, `substitutedFormula: string | null`, `dcfStatus: string | null`, `dcfGeneratedAt: string | null`. The subtitle is `"<ticker> · <detail.result>"`. The tablist is "Calculation detail sections", with tabs Summary / Calculation steps / Trend / Peers / Sensitivity / Raw data. The choice is stored under `moneyview.tab.corporate.detailTab` and never overwritten by a fallback.
  - `BUILT_TABS` in `CalculationDetailModal.tsx`. Tasks 9–11 each add one key.
  - `detailParts.tsx`: `SectionCard`, `DenseRowsTable({ rows, columns: [LabelKey, LabelKey, LabelKey], asOf?, emptyTitle, emptyDescription })`, `RawDatasetSection`, `statusFromText`, and the class constants `TABLE`, `THEAD`, `TR`, `TD`, `TD_FIGURE`
  - `SummaryTab`, `StepsTab`, `RawDataTab` (props in Steps 6–8). DOM: `[data-testid="detail-result"]`, `[data-testid="substituted-formula"]`
  - helper `openDetailTab(dialog: Locator, name: string)`. `openFullDcfReportInModal` now opens Raw data first.
  - labels `dataPoint`, `source`, `asOf`; catalog `corporate.detail.*` (including 24 `meaning.<key>` lines)

- [ ] **Step 1: Helpers** (`tests/e2e/helpers/corporateDcf.ts`). Append:

```ts
/** A tab inside the calculation detail modal (plan Task 8). */
export async function openDetailTab(dialog: Locator, name: string): Promise<void> {
  const tab = dialog.getByRole("tablist", { name: "Calculation detail sections" }).getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
```

In `openFullDcfReportInModal`, insert `await openDetailTab(dialog, "Raw data");` directly after `await expect(dialog).toBeVisible();`.

- [ ] **Step 2: Write the failing tests** (`apps/web/tests/e2e/corporate-detail-tabs.spec.ts`)

```ts
import { expect, test, type Page } from "@playwright/test";
import type { CorporateMetricAudit, CorporateMetricAuditEntry } from "../../../../packages/shared-types";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { openDetailTab } from "./helpers/corporateDcf";

// Spec 2026-10-14 §4 and §7 test 7.
async function gotoCorporate(page: Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}
const dialog = (page: Page) => page.getByRole("dialog");
const detailTabs = (page: Page) => dialog(page).getByRole("tablist", { name: "Calculation detail sections" });

async function openKpi(page: Page, name: RegExp) {
  await page.getByTestId("corporate-kpis").getByRole("button", { name }).click();
  await expect(dialog(page)).toBeVisible();
}
async function openAssumptionDetail(page: Page, label: string) {
  await page.getByTestId("assumption-table").getByRole("button", { name: `${label} detail` }).click();
  await expect(dialog(page)).toBeVisible();
}
async function closeDetail(page: Page) {
  await dialog(page).getByRole("button", { name: "Close modal" }).click();
  await expect(dialog(page)).toHaveCount(0);
}

function auditEntry(value: number, inputs: CorporateMetricAuditEntry["inputs_used"]): CorporateMetricAuditEntry {
  return {
    value, display_value: `${value.toFixed(1)}%`, method: "test", quality: "ok", reason: null, warnings: [], confidence: 0.9,
    inputs_used: inputs, source: "test audit", as_of: "2025-12-31", calculation_version: "test",
  };
}

test("the header pins ticker and value; Summary, Calculation steps and Raw data split the old sections", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openKpi(page, /^ROIC - WACC/);
  await expect(dialog(page)).toContainText("AAPL · 8.0%");
  await expect(detailTabs(page).getByRole("tab", { name: "Summary", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(dialog(page).getByTestId("substituted-formula")).toHaveText("ROIC − WACC = 18.0% − 10.0% = 8.0%");
  await expect(dialog(page).getByText("Result Summary: value, inputs used")).toBeVisible();
  await expect(dialog(page).getByRole("columnheader", { name: "As of" })).toBeVisible();
  await expect(dialog(page).getByRole("cell", { name: "2025-12-31" }).first()).toBeVisible();

  await openDetailTab(dialog(page), "Calculation steps");
  await expect(dialog(page).getByRole("heading", { name: "ROIC - WACC Audit" })).toBeVisible();
  await expect(dialog(page).getByText("Result Summary: value, inputs used")).toHaveCount(0);

  await openDetailTab(dialog(page), "Raw data");
  await expect(dialog(page).getByRole("button", { name: "Download CSV: Analysis" })).toHaveCount(1);
  await expect(dialog(page).getByRole("heading", { name: "Raw Datasets" })).toBeVisible();
});

test("WACC substitutes the audit's weights and costs when all six inputs are present", async ({ page }) => {
  await mockCorporatePageApi(page);
  const wacc = auditEntry(8.8, [
    { field: "equity_weight", label: "Equity weight", value: 0.82, display_value: "82.0%", source: "t" },
    { field: "cost_of_equity", label: "Cost of equity", value: 0.1, display_value: "10.0%", source: "t" },
    { field: "debt_weight", label: "Debt weight", value: 0.18, display_value: "18.0%", source: "t" },
    { field: "cost_of_debt", label: "Cost of debt", value: 0.041, display_value: "4.1%", source: "t" },
    { field: "tax_rate", label: "Tax rate", value: 0.21, display_value: "21.0%", source: "t" },
    { field: "final_wacc_value", label: "Final WACC value", value: 8.8, display_value: "8.8%", source: "t" },
  ]);
  const audit: CorporateMetricAudit = {
    ticker: "AAPL", source_mode: "yahoo_finance", generated_at: "2026-10-14T00:00:00Z", growth: null,
    roic: auditEntry(18, []), wacc, spread: auditEntry(8, []), dcf: null,
  };
  await page.route((url) => url.pathname.endsWith("/corporate/metrics/AAPL/audit"), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(audit) }));
  await gotoCorporate(page);
  await openKpi(page, /^WACC/);
  await expect(dialog(page).getByTestId("substituted-formula"))
    .toHaveText("WACC = E/V × Ke + D/V × Kd × (1 − t) = 82.0% × 10.0% + 18.0% × 4.1% × (1 − 21.0%) = 8.8%");
});

test("without the audit's inputs WACC shows only the symbolic formula", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openKpi(page, /^WACC/);
  await expect(dialog(page).getByText("WACC = E/V x Ke + D/V x Kd x (1 - tax)")).toBeVisible();
  await expect(dialog(page).getByTestId("substituted-formula")).toHaveCount(0);
});

test("the last tab is remembered across metrics", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openAssumptionDetail(page, "Growth Rate");
  await openDetailTab(dialog(page), "Raw data");
  await closeDetail(page);
  await openKpi(page, /^Levered Beta/);
  await expect(detailTabs(page).getByRole("tab", { name: "Raw data" })).toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Step 3: Run to see them fail.** `npx playwright test tests/e2e/corporate-detail-tabs.spec.ts --workers=2`. Expected: FAIL. "AAPL · 8.0%" is missing, and the tablist "Calculation detail sections" is not found.

- [ ] **Step 4: Labels, glossary, catalog.** `labels.ts`:

```ts
  dataPoint: ["데이터", "Data point"],
  source: ["출처", "Source"],
  asOf: ["기준일", "As of"],
```

Glossary rows:

```markdown
| Data point / Source / As of | 데이터 / 출처 / 기준일 | label (detail tables) |
| Summary | 요약 | detail tab |
| Calculation steps | 계산 과정 | detail tab |
| Raw data | 원천 데이터 | detail tab |
| Calculation Formula | 계산 공식 | |
| With current values | 현재 값 대입 | substituted formula |
```

Inside `corporate: { … }` in `en.ts`:

```ts
    detail: {
      tabsAria: "Calculation detail sections",
      tab: { summary: "Summary", steps: "Calculation steps", trend: "Trend", peers: "Peers", sensitivity: "Sensitivity", raw: "Raw data" },
      formula: "Calculation Formula", substituted: "With current values",
      inputsTitle: "Result Summary: value, inputs used",
      noInputs: "No summary rows available", noInputsBody: "This calculation does not currently expose summary inputs.",
      resultLabel: "Result", horizonLabel: "Time Horizon",
      lineage: "Data Lineage", lineageBody: "Trace the path from source systems to transformed values and final output.",
      supporting: "Supporting Rows", supportingBody: "Detailed components and arithmetic steps underlying the final result.",
      rawAccess: "Raw Data Access", rawAccessBody: "How each calculation step connects to its source and time period.",
      noRows: "No rows available", noRowsBody: "This calculation does not expose these rows yet.",
      auditTitle: "Calculation Audit", auditLoading: "Loading calculation audit...",
      auditUnavailable: "Calculation Audit Unavailable", auditError: "Could not load the metric audit for {ticker}.",
      exportAnalysis: "Download CSV: Analysis", exportOhlcv: "Download CSV: OHLCV", exportStatements: "Download CSV: Statements", print: "Print",
      meaning: {
        realtime: "The assumption set every figure on this page is computed from.",
        growth: "Revenue growth the forecast assumes each year.",
        roic: "After-tax operating return on the capital invested in the business.",
        wacc: "The blended cost of equity and debt; the DCF's discount rate.",
        debtRatio: "Debt as a share of debt plus equity.",
        unleveredBeta: "Business risk against the market, before debt.",
        leveredBeta: "Equity risk against the market after debt; 1.0 is the market.",
        crp: "Extra return required for country risk; fixed for South Korea.",
        erp: "Market return implied by index prices, minus the risk-free rate.",
        reinvestment: "Share of after-tax operating profit put back into the business.",
        innovation: "R&D intensity scaled to a 0-100 score.",
        governance: "Governance quality score, 0-100.",
        esgPenalty: "Penalty score for agency and ESG execution risk, 0-100.",
        spread: "Positive means the business earns more than its capital costs.",
        bottomUpKe: "The return shareholders require, built from rf, beta, ERP and CRP.",
        backendDcf: "Intrinsic value per share from the DCF, against the market price.",
        sustainableGrowth: "Growth the business can fund itself: reinvestment times ROIC.",
        hurdleDecomposition: "The parts that add up to the cost of equity.",
        betaWaccCurve: "How beta and WACC move as debt rises.",
        valueDriverMatrix: "Growth against the ROIC - WACC spread.",
        dcfCoreModules: "The four figures the DCF rests on.",
        terminalValueShare: "Share of enterprise value that comes from the terminal value.",
        fcffMagnitude: "Free cash flow to the firm fed into the DCF.",
        backendFairValue: "Intrinsic value per share from the DCF engine.",
      },
    },
```

`ko.ts`:

```ts
    detail: {
      tabsAria: "계산 상세 구역",
      tab: { summary: "요약", steps: "계산 과정", trend: "추이", peers: "동종업 비교", sensitivity: "민감도", raw: "원천 데이터" },
      formula: "계산 공식", substituted: "현재 값 대입",
      inputsTitle: "주요 입력: 값 · 출처 · 기준일",
      noInputs: "요약 행이 없습니다", noInputsBody: "이 계산은 요약 입력을 아직 제공하지 않습니다.",
      resultLabel: "결과", horizonLabel: "기간",
      lineage: "데이터 리니지", lineageBody: "원천에서 변환 값, 최종 결과까지의 경로입니다.",
      supporting: "근거 행", supportingBody: "최종 결과를 이루는 구성 요소와 계산 단계입니다.",
      rawAccess: "원천 데이터 연결", rawAccessBody: "각 계산 단계가 어느 출처와 기간에 연결되는지 보여 줍니다.",
      noRows: "행이 없습니다", noRowsBody: "이 계산은 아직 이 행을 제공하지 않습니다.",
      auditTitle: "계산 감사", auditLoading: "계산 감사를 불러오는 중…",
      auditUnavailable: "계산 감사를 불러오지 못했습니다", auditError: "{ticker}의 지표 감사를 불러오지 못했습니다.",
      exportAnalysis: "CSV 받기: 분석", exportOhlcv: "CSV 받기: OHLCV", exportStatements: "CSV 받기: 재무제표", print: "인쇄",
      meaning: {
        realtime: "이 화면의 모든 수치를 계산하는 가정 묶음입니다.",
        growth: "예측이 매년 가정하는 매출 성장률입니다.",
        roic: "사업에 투입된 자본에 대한 세후 영업이익률입니다.",
        wacc: "자기자본과 부채의 가중 비용이며 DCF 할인율입니다.",
        debtRatio: "부채와 자기자본 합계 중 부채의 비중입니다.",
        unleveredBeta: "부채를 빼고 본 시장 대비 사업 위험입니다.",
        leveredBeta: "부채를 반영한 시장 대비 주식 위험이며 1.0이 시장 평균입니다.",
        crp: "국가 위험에 대한 추가 요구수익률이며 한국 기준으로 고정입니다.",
        erp: "지수 가격이 함축하는 시장수익률에서 무위험수익률을 뺀 값입니다.",
        reinvestment: "세후 영업이익 중 사업에 다시 투자하는 비중입니다.",
        innovation: "연구개발 강도를 0-100으로 환산한 점수입니다.",
        governance: "지배구조 품질 점수(0-100)입니다.",
        esgPenalty: "대리인·ESG 실행 위험에 대한 벌점(0-100)입니다.",
        spread: "양수면 사업이 자본비용보다 더 많이 법니다.",
        bottomUpKe: "무위험수익률, 베타, ERP, CRP로 쌓은 주주 요구수익률입니다.",
        backendDcf: "DCF로 구한 주당 내재가치를 현재가와 비교합니다.",
        sustainableGrowth: "재투자율과 ROIC의 곱으로, 스스로 감당할 수 있는 성장률입니다.",
        hurdleDecomposition: "자기자본비용을 이루는 구성 요소입니다.",
        betaWaccCurve: "부채가 늘 때 베타와 WACC가 움직이는 모습입니다.",
        valueDriverMatrix: "성장률과 ROIC - WACC 스프레드의 위치입니다.",
        dcfCoreModules: "DCF가 기대는 네 가지 수치입니다.",
        terminalValueShare: "기업가치 중 잔존가치가 차지하는 비중입니다.",
        fcffMagnitude: "DCF에 들어가는 기업잉여현금흐름입니다.",
        backendFairValue: "DCF 엔진이 낸 주당 내재가치입니다.",
      },
    },
```

- [ ] **Step 5: `detail/detailParts.tsx`** (shared pieces, moved from the old modal and restyled per M1–M3)

```tsx
"use client";

import type { ReactNode } from "react";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, type StatusVariant } from "@/components/ui/StatusBadge";
import { MISSING } from "@/lib/format";
import type { LabelKey } from "@/lib/i18n/labels";
import type { CalculationRow } from "../calculationDetailTypes";

export const TABLE = "w-full min-w-[42rem] table-fixed text-left";
export const THEAD = "bg-[var(--surface)] type-caption uppercase text-[var(--ink-muted)]";
export const TR = "border-t border-[var(--grid)]";
export const TD = "max-w-80 break-words px-3 py-2 type-small text-[var(--ink)]";
export const TD_FIGURE = "px-3 py-2 type-mono text-[var(--ink)]";

export function SectionCard({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="type-panel-title text-[var(--ink)]">{title}</h3>
          {description ? <p className="type-small mt-1 text-[var(--ink-muted)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** label · value · source rows; `asOf` adds one as-of column (plan N3: one date per metric). */
export function DenseRowsTable({
  rows,
  columns,
  asOf,
  emptyTitle,
  emptyDescription,
}: {
  rows: CalculationRow[];
  columns: [LabelKey, LabelKey, LabelKey];
  asOf?: string | null;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  const withAsOf = asOf !== undefined;
  return (
    <div className="overflow-x-auto border border-[var(--line)]">
      <table className={TABLE}>
        <thead className={THEAD}>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2"><BilingualLabel k={column} /></th>
            ))}
            {withAsOf ? <th scope="col" className="px-3 py-2"><BilingualLabel k="asOf" /></th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.label}-${row.source}-${index}`} className={TR}>
              <td className={TD}>{row.label}</td>
              <td className="max-w-72 break-words px-3 py-2 type-mono text-[var(--ink)]">{row.value}</td>
              <td className={TD}>{row.source}</td>
              {withAsOf ? <td className={TD}>{asOf ?? MISSING}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RawDatasetSection({
  title,
  description,
  status,
  statusVariant,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  status: string;
  statusVariant: StatusVariant;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="border border-[var(--line)] bg-[var(--surface-raised)]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3">
        <div>
          <h3 className="type-panel-title text-[var(--ink)]">{title}</h3>
          <p className="type-small mt-1 text-[var(--ink-muted)]">{description}</p>
        </div>
        <StatusBadge status={statusVariant} label={status} className="shrink-0" />
      </summary>
      <div className="border-t border-[var(--line)] p-4">{children}</div>
    </details>
  );
}

export function statusFromText(status: string | null | undefined): StatusVariant {
  const normalized = status?.toLowerCase() ?? "";
  if (normalized.includes("loading")) return "loading";
  if (normalized.includes("unavailable")) return "error";
  if (normalized.includes("not loaded")) return "idle";
  if (normalized.includes("refresh")) return "idle";
  return "saved";
}
```

- [ ] **Step 6: `detail/SummaryTab.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/locale";
import type { CalculationDetail, CalculationDetailKey } from "../calculationDetailTypes";
import { DenseRowsTable } from "./detailParts";

// Spec §4 Summary: big value, status, one-line meaning, the formula with current values, inputs.
export function SummaryTab({
  detail,
  detailKey,
  status,
  substituted,
  asOf,
}: {
  detail: CalculationDetail;
  detailKey: CalculationDetailKey;
  status: ReactNode;
  substituted: string | null;
  asOf: string | null;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="detail-result" className="type-figure-md text-[var(--ink)]">{detail.result}</span>
        {status}
      </div>
      <p className="type-body text-[var(--ink-secondary)]">{t(`corporate.detail.meaning.${detailKey}`)}</p>
      <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="type-caption uppercase text-[var(--ink-muted)]">{t("corporate.detail.formula")}</div>
        <p className="type-mono mt-2 whitespace-pre-wrap text-[var(--ink)]">{detail.formula}</p>
        {substituted ? (
          <>
            <div className="type-caption mt-3 uppercase text-[var(--ink-muted)]">{t("corporate.detail.substituted")}</div>
            <p data-testid="substituted-formula" className="type-mono mt-2 text-[var(--ink)]">{substituted}</p>
          </>
        ) : null}
      </div>
      <section className="flex flex-col gap-2">
        <h3 className="type-panel-title text-[var(--ink)]">{t("corporate.detail.inputsTitle")}</h3>
        <DenseRowsTable
          rows={detail.summary}
          columns={["dataPoint", "value", "source"]}
          asOf={asOf}
          emptyTitle={t("corporate.detail.noInputs")}
          emptyDescription={t("corporate.detail.noInputsBody")}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 7: `detail/StepsTab.tsx`**

```tsx
"use client";

import type { CorporateMetricAudit } from "../../../../../../packages/shared-types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { MetricAuditPanel } from "@/components/ui/MetricAuditPanel";
import { useT } from "@/lib/i18n/locale";
import type { CalculationDetail, CalculationRow } from "../calculationDetailTypes";
import { DenseRowsTable, SectionCard } from "./detailParts";

// Spec §4 "Calculation steps": the audit (Step 1..N), data lineage and supporting rows.
export function StepsTab({
  detail,
  ticker,
  metricAudit,
  metricAuditIsLoading,
  metricAuditIsError,
}: {
  detail: CalculationDetail;
  ticker: string;
  metricAudit: CorporateMetricAudit | null;
  metricAuditIsLoading: boolean;
  metricAuditIsError: boolean;
}) {
  const t = useT();
  const lineageRows = [...detail.sourcing, ...detail.summary.slice(0, 3)];
  const rawAccessRows: CalculationRow[] = [
    ...detail.simulation.map((row) => ({ label: `Step ${row.label}`, value: row.value, source: `Output: ${row.source}; Data Period: ${detail.timeHorizon}` })),
    ...detail.sourcing.map((row) => ({ label: row.label, value: row.value, source: `${row.source}; Data Period: ${detail.timeHorizon}` })),
  ];
  const tables: { title: string; description: string; rows: CalculationRow[] }[] = [
    { title: t("corporate.detail.lineage"), description: t("corporate.detail.lineageBody"), rows: lineageRows },
    { title: t("corporate.detail.supporting"), description: t("corporate.detail.supportingBody"), rows: [...detail.components, ...detail.simulation] },
    { title: t("corporate.detail.rawAccess"), description: t("corporate.detail.rawAccessBody"), rows: rawAccessRows },
  ];
  return (
    <div className="flex flex-col gap-4">
      {detail.auditMetric ? (
        metricAuditIsLoading ? (
          <SectionCard title={t("corporate.detail.auditTitle")}>
            <EmptyState title={t("corporate.detail.auditLoading")} />
          </SectionCard>
        ) : metricAuditIsError ? (
          <SectionCard title={t("corporate.detail.auditTitle")}>
            <ErrorState title={t("corporate.detail.auditUnavailable")} message={t("corporate.detail.auditError", { ticker })} />
          </SectionCard>
        ) : (
          <MetricAuditPanel
            audit={metricAudit}
            metric={detail.auditMetric}
            title={detail.auditMetric === "spread" ? "ROIC - WACC Audit" : detail.auditMetric === "growth" ? "Growth Audit" : `${detail.auditMetric.toUpperCase()} Audit`}
          />
        )
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">{t("corporate.detail.resultLabel")}</div>
          <p className="type-body mt-2 text-[var(--ink)]">{detail.result}</p>
        </div>
        <div className="border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="type-caption uppercase text-[var(--ink-muted)]">{t("corporate.detail.horizonLabel")}</div>
          <p className="type-body mt-2 text-[var(--ink)]">{detail.timeHorizon}</p>
        </div>
      </div>
      {tables.map((table) => (
        <SectionCard key={table.title} title={table.title} description={table.description}>
          <DenseRowsTable rows={table.rows} columns={["dataPoint", "value", "source"]} emptyTitle={t("corporate.detail.noRows")} emptyDescription={t("corporate.detail.noRowsBody")} />
        </SectionCard>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: `detail/RawDataTab.tsx`.** The four collapsible sections move from the old modal with their English titles and descriptions unchanged; specs pin "Full DCF Report", "Raw Datasets", "Historical OHLCV Dataset", "Quarterly Financial Statements" and "Full DCF Report Unavailable" (plan N9). Their classes follow the M1–M3 constants in `detailParts.tsx`.

```tsx
"use client";

import type { DcfFullReport } from "../../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useT } from "@/lib/i18n/locale";
import type { CalculationDetail, RawDatasetRow } from "../calculationDetailTypes";
import { DcfSensitivityTable } from "../DcfSensitivityTable";
import { RawDatasetSection, statusFromText, TABLE, TD, TD_FIGURE, THEAD, TR } from "./detailParts";

export interface StockPriceRow { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface QuarterlyStatementRow { ticker: string; statement: string; period: string; metric: string; value: number }

export interface RawDataTabProps {
  detail: CalculationDetail;
  ticker: string;
  rawDatasetRows: RawDatasetRow[];
  historicalPrices: StockPriceRow[];
  historicalStatus: string;
  historicalIsLoading: boolean;
  historicalIsError: boolean;
  quarterlyStatementRows: QuarterlyStatementRow[];
  quarterlyStatementStatus: string;
  quarterlyStatementsIsLoading: boolean;
  quarterlyStatementsIsError: boolean;
  dcfFullReport: DcfFullReport | null;
  dcfFullReportStatus: string | null;
  dcfFullReportIsLoading: boolean;
  dcfFullReportIsError: boolean;
  onRequestDcfFullReport?: (() => void) | null;
  onDownloadRawDatasetCsv: () => void;
  onDownloadHistoricalPriceCsv: () => void;
  onDownloadQuarterlyStatementsCsv: () => void;
  onPrint: () => void;
  formatNumber: (value: number) => string;
  formatNumber2: (value: number) => string;
  formatPct: (value: number) => string;
}

// Spec §4 "Raw data": OHLCV, quarterly statements, the full DCF report (5x5 grid included), CSV.
export function RawDataTab(props: RawDataTabProps) {
  const {
    detail, ticker, rawDatasetRows, historicalPrices, historicalStatus, historicalIsLoading, historicalIsError,
    quarterlyStatementRows, quarterlyStatementStatus, quarterlyStatementsIsLoading, quarterlyStatementsIsError,
    dcfFullReport, dcfFullReportStatus, dcfFullReportIsLoading, dcfFullReportIsError, onRequestDcfFullReport,
    onDownloadRawDatasetCsv, onDownloadHistoricalPriceCsv, onDownloadQuarterlyStatementsCsv, onPrint,
    formatNumber, formatNumber2, formatPct,
  } = props;
  const t = useT();
  const showDcfFullReport = detail.title.includes("Backend DCF") || detail.title.includes("Backend Fair Value") || detail.title.includes("Intrinsic DCF");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton label={t("corporate.detail.exportAnalysis")} onClick={onDownloadRawDatasetCsv} variant="secondary" size="sm" />
        <ActionButton label={t("corporate.detail.exportOhlcv")} onClick={onDownloadHistoricalPriceCsv} disabled={historicalPrices.length === 0} variant="secondary" size="sm" />
        <ActionButton label={t("corporate.detail.exportStatements")} onClick={onDownloadQuarterlyStatementsCsv} disabled={quarterlyStatementRows.length === 0} variant="secondary" size="sm" />
        <ActionButton label={t("corporate.detail.print")} onClick={onPrint} variant="secondary" size="sm" />
      </div>

      {showDcfFullReport ? (
        <RawDatasetSection
          title="Full DCF Report"
          description="Expanded DCF projection, terminal-value, and WACC breakdown. This stays behind an explicit open action to preserve progressive disclosure."
          status={dcfFullReportStatus ?? "Full report not loaded yet."}
          statusVariant={dcfFullReportIsError ? "error" : statusFromText(dcfFullReportStatus)}
          defaultOpen={Boolean(dcfFullReport)}
        >
          <div className="flex flex-col gap-4">
            {onRequestDcfFullReport ? (
              <ActionButton label={dcfFullReport ? "Refresh Full Report" : "Load Full Report"} onClick={onRequestDcfFullReport} variant="secondary" size="sm" className="self-start" />
            ) : null}
            {dcfFullReportIsLoading && !dcfFullReport ? (
              <EmptyState title="Loading full DCF report..." description="Fetching the expanded projection rows and WACC breakdown for this ticker." />
            ) : dcfFullReportIsError && !dcfFullReport ? (
              <ErrorState title="Full DCF Report Unavailable" message={dcfFullReportStatus ?? "Could not load the expanded DCF report for this ticker."} />
            ) : dcfFullReport ? (
              <>
                <div className="overflow-x-auto border border-[var(--line)]">
                  <table className={TABLE}>
                    <thead className={THEAD}>
                      <tr>
                        <th className="px-3 py-2">Year</th>
                        <th className="px-3 py-2">Projected FCFF</th>
                        <th className="px-3 py-2">Discount Factor</th>
                        <th className="px-3 py-2">Present Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dcfFullReport.projection_rows.map((row) => (
                        <tr key={`${ticker}-projection-${row.year}`} className={TR}>
                          <td className={TD}>{row.year}</td>
                          <td className={TD_FIGURE}>{formatNumber(row.projected_fcff)}</td>
                          <td className={TD_FIGURE}>{formatNumber2(row.discount_factor)}</td>
                          <td className={TD_FIGURE}>{formatNumber(row.present_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="overflow-x-auto border border-[var(--line)]">
                  <table className={TABLE}>
                    <thead className={THEAD}>
                      <tr>
                        <th className="px-3 py-2">Breakdown</th>
                        <th className="px-3 py-2">Value</th>
                        <th className="px-3 py-2">Context</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Terminal Cash Flow", formatNumber(dcfFullReport.terminal_cash_flow), "Year 5 FCFF grown by terminal growth"],
                        ["Terminal Value", formatNumber(dcfFullReport.terminal_value), "Gordon growth terminal value"],
                        ["PV of Terminal", formatNumber(dcfFullReport.present_value_of_terminal), "Discounted terminal value"],
                        ["PV of FCFF", formatNumber(dcfFullReport.present_value_of_fcff), "Discounted phase-one FCFF rows"],
                        ["Enterprise Value", formatNumber(dcfFullReport.enterprise_value), "PV of FCFF plus PV of terminal value"],
                        ["Equity Value", dcfFullReport.equity_value == null ? "Unavailable" : formatNumber(dcfFullReport.equity_value), "Enterprise value minus net debt plus non-operating assets"],
                        ["Intrinsic Value / Share", dcfFullReport.intrinsic_value_per_share == null ? "Unavailable" : formatNumber(dcfFullReport.intrinsic_value_per_share), "Equity value divided by diluted shares"],
                        ["Bridge Quality", dcfFullReport.bridge_quality, dcfFullReport.valuation_method],
                        ["Net Debt", dcfFullReport.net_debt == null ? "Unavailable" : formatNumber(dcfFullReport.net_debt), "Enterprise-to-equity bridge input"],
                        ["Non-operating Assets", dcfFullReport.non_operating_assets == null ? "Unavailable" : formatNumber(dcfFullReport.non_operating_assets), "Enterprise-to-equity bridge input"],
                        ["Diluted Shares", dcfFullReport.diluted_shares_outstanding == null ? "Unavailable" : formatNumber(dcfFullReport.diluted_shares_outstanding), "Per-share bridge input"],
                        ["Agency Discount", formatNumber2(dcfFullReport.agency_discount), "Diagnostic only; not applied to intrinsic value"],
                        ["Risk-free Rate", formatPct(dcfFullReport.wacc_breakdown.risk_free_rate * 100), "Full-report WACC breakdown"],
                        ["Equity Risk Premium", formatPct(dcfFullReport.wacc_breakdown.equity_risk_premium * 100), "Full-report WACC breakdown"],
                        ["Country Risk Premium", formatPct(dcfFullReport.wacc_breakdown.country_risk_premium * 100), "Full-report WACC breakdown"],
                      ].map(([label, value, source]) => (
                        <tr key={`${ticker}-dcf-breakdown-${label}`} className={TR}>
                          <td className={TD}>{label}</td>
                          <td className={TD_FIGURE}>{value}</td>
                          <td className={TD}>{source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <DcfSensitivityTable sensitivity={dcfFullReport.sensitivity} formatNumber={formatNumber} formatPct={formatPct} />
              </>
            ) : (
              <EmptyState title="Full DCF report not loaded yet" description="Use the load action above to fetch the projection rows and WACC breakdown for this ticker." />
            )}
          </div>
        </RawDatasetSection>
      ) : null}

      <RawDatasetSection
        title="Raw Datasets"
        description="Collapsed by default so the modal stays readable while keeping full source evidence available on demand."
        status={`${rawDatasetRows.length} analysis rows`}
        statusVariant={rawDatasetRows.length > 0 ? "saved" : "idle"}
      >
        {rawDatasetRows.length > 0 ? (
          <div className="max-h-80 overflow-auto border border-[var(--line)]">
            <table className="w-full min-w-[52rem] table-fixed text-left">
              <thead className={`sticky top-0 ${THEAD}`}>
                <tr>
                  <th className="px-3 py-2">Dataset</th>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {rawDatasetRows.map((row, index) => (
                  <tr key={`${row.dataset}-${row.field}-${index}`} className={TR}>
                    <td className={`${TD} max-w-64`}>{row.dataset}</td>
                    <td className={`${TD} max-w-48`}>{row.field}</td>
                    <td className={TD_FIGURE}>{row.value}</td>
                    <td className={TD}>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No raw dataset rows available" description="Analysis dataset exports will appear here once the selected audit surface exposes them." />
        )}
      </RawDatasetSection>

      <RawDatasetSection
        title="Historical OHLCV Dataset"
        description="Underlying five-year price history used for price-linked context and export."
        status={historicalStatus}
        statusVariant={historicalIsError ? "error" : statusFromText(historicalStatus)}
      >
        {historicalIsLoading && historicalPrices.length === 0 ? (
          <EmptyState title="Loading historical OHLCV dataset..." description="Fetching the five-year price history used for this audit layer." />
        ) : historicalIsError && historicalPrices.length === 0 ? (
          <ErrorState title="Historical OHLCV Unavailable" message={historicalStatus} />
        ) : historicalPrices.length > 0 ? (
          <div className="max-h-80 overflow-auto border border-[var(--line)]">
            <table className="w-full min-w-[48rem] table-fixed text-left">
              <thead className={`sticky top-0 ${THEAD}`}>
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Open</th>
                  <th className="px-3 py-2">High</th>
                  <th className="px-3 py-2">Low</th>
                  <th className="px-3 py-2">Close</th>
                  <th className="px-3 py-2">Volume</th>
                </tr>
              </thead>
              <tbody>
                {historicalPrices.map((row) => (
                  <tr key={`${ticker}-${row.date}`} className={TR}>
                    <td className={TD}>{row.date}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.open)}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.high)}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.low)}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.close)}</td>
                    <td className={TD_FIGURE}>{Math.round(row.volume).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Historical stock price rows are not available" description="Refresh source data from the Corporate page to populate the OHLCV export surface." />
        )}
      </RawDatasetSection>

      <RawDatasetSection
        title="Quarterly Financial Statements"
        description="Quarterly balance sheet, income statement, and cash-flow rows used to support the current audit view."
        status={quarterlyStatementStatus}
        statusVariant={quarterlyStatementsIsError ? "error" : statusFromText(quarterlyStatementStatus)}
      >
        {quarterlyStatementsIsLoading && quarterlyStatementRows.length === 0 ? (
          <EmptyState title="Loading quarterly financial statements..." description="Fetching the supporting quarterly balance-sheet, income, and cash-flow rows." />
        ) : quarterlyStatementsIsError && quarterlyStatementRows.length === 0 ? (
          <ErrorState title="Quarterly Financial Statements Unavailable" message={quarterlyStatementStatus} />
        ) : quarterlyStatementRows.length > 0 ? (
          <div className="max-h-96 overflow-auto border border-[var(--line)]">
            <table className="w-full min-w-[56rem] table-fixed text-left">
              <thead className={`sticky top-0 ${THEAD}`}>
                <tr>
                  <th className="px-3 py-2">Statement</th>
                  <th className="px-3 py-2">Quarter</th>
                  <th className="px-3 py-2">Metric</th>
                  <th className="px-3 py-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {quarterlyStatementRows.map((row, index) => (
                  <tr key={`${row.statement}-${row.period}-${row.metric}-${index}`} className={TR}>
                    <td className={TD}>{row.statement}</td>
                    <td className={TD}>{row.period}</td>
                    <td className={TD}>{row.metric}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Quarterly statement rows are not available" description="Refresh source data from the Corporate page to populate this supporting dataset." />
        )}
      </RawDatasetSection>
    </div>
  );
}
```

  The English titles, descriptions and table headers are the old modal's, unchanged (plan N9; specs pin several of them).

- [ ] **Step 9: The modal shell.** Replace `CalculationDetailModal.tsx` with:

```tsx
"use client";

import type { CorporateMetricAudit, DcfFullReport } from "../../../../../packages/shared-types";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";
import { ModalShell } from "@/components/ui/ModalShell";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { tabStateKey, useTabState } from "@/lib/tabState";
import { availableDetailTabs, resolveDetailTab, type DetailTabKey } from "../detailTabs";
import type { CalculationDetail, CalculationDetailKey, RawDatasetRow } from "./calculationDetailTypes";
import { RawDataTab, type QuarterlyStatementRow, type StockPriceRow } from "./detail/RawDataTab";
import { StepsTab } from "./detail/StepsTab";
import { SummaryTab } from "./detail/SummaryTab";
import { VerdictStatusLabel } from "./VerdictBlock";

/** Tabs built so far. Task 9 adds "trend", Task 10 "peers", Task 11 "sensitivity". */
const BUILT_TABS: readonly DetailTabKey[] = ["summary", "steps", "raw"];

interface CalculationDetailModalProps {
  detail: CalculationDetail;
  detailKey: CalculationDetailKey;
  ticker: string;
  substitutedFormula: string | null;
  dcfStatus: string | null;
  dcfGeneratedAt: string | null;
  metricAudit: CorporateMetricAudit | null;
  metricAuditIsLoading: boolean;
  metricAuditIsError: boolean;
  rawDatasetRows: RawDatasetRow[];
  historicalPrices: StockPriceRow[];
  historicalStatus: string;
  historicalIsLoading: boolean;
  historicalIsError: boolean;
  quarterlyStatementRows: QuarterlyStatementRow[];
  quarterlyStatementStatus: string;
  quarterlyStatementsIsLoading: boolean;
  quarterlyStatementsIsError: boolean;
  dcfFullReport: DcfFullReport | null;
  dcfFullReportStatus: string | null;
  dcfFullReportIsLoading: boolean;
  dcfFullReportIsError: boolean;
  onRequestDcfFullReport?: (() => void) | null;
  onClose: () => void;
  onDownloadRawDatasetCsv: () => void;
  onDownloadHistoricalPriceCsv: () => void;
  onDownloadQuarterlyStatementsCsv: () => void;
  onPrint: () => void;
  formatNumber: (value: number) => string;
  formatNumber2: (value: number) => string;
  formatPct: (value: number) => string;
}

// Spec §4: still a ModalShell modal (U9), its sections split into tabs. The last tab chosen is
// remembered; a metric without it opens Summary and the memory is left as it was.
export function CalculationDetailModal(props: CalculationDetailModalProps) {
  const { detail, detailKey, ticker, substitutedFormula, dcfStatus, dcfGeneratedAt, metricAudit, metricAuditIsLoading, metricAuditIsError, onClose } = props;
  const t = useT();
  const [storedTab, setStoredTab] = useTabState<string>(tabStateKey("corporate", "detailTab"), "summary");
  const available = availableDetailTabs(detailKey).filter((tab) => BUILT_TABS.includes(tab));
  const active = resolveDetailTab(storedTab, available);
  const auditEntry = detail.auditMetric && metricAudit ? metricAudit[detail.auditMetric] : null;
  const isDcfKey = detailKey === "backendDcf" || detailKey === "backendFairValue";
  const status = auditEntry ? (
    <>
      <MetricQualityBadge quality={auditEntry.quality} />
      {auditEntry.reason ? <span className="type-small text-[var(--ink-muted)]">{auditEntry.reason}</span> : null}
    </>
  ) : isDcfKey && dcfStatus ? (
    <VerdictStatusLabel status={dcfStatus} />
  ) : null;
  const asOf = auditEntry?.as_of ?? (isDcfKey ? dcfGeneratedAt : null);

  return (
    <ModalShell open onClose={onClose} title={detail.title} subtitle={`${ticker} · ${detail.result}`} size="xl">
      <div className="flex flex-col gap-4">
        <Tabs
          ariaLabel={t("corporate.detail.tabsAria")}
          activeKey={active}
          onChange={setStoredTab}
          items={available.map((tab) => ({ key: tab, label: t(`corporate.detail.tab.${tab}`) }))}
        />
        <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
          {active === "summary" ? (
            <SummaryTab detail={detail} detailKey={detailKey} status={status} substituted={substitutedFormula} asOf={asOf} />
          ) : null}
          {active === "steps" ? (
            <StepsTab detail={detail} ticker={ticker} metricAudit={metricAudit} metricAuditIsLoading={metricAuditIsLoading} metricAuditIsError={metricAuditIsError} />
          ) : null}
          {active === "raw" ? <RawDataTab {...props} /> : null}
        </div>
      </div>
    </ModalShell>
  );
}
```

- [ ] **Step 10: Wire `page.tsx`.**
  1. Imports: `import { substitutedFormula } from "./substitutedFormula";` and `import { bridgedEstimatedValue, bridgedUpsidePct } from "@/lib/bridgeQuality";` (merge with an existing `@/lib/bridgeQuality` import if Task 7 left one).
  2. After `const activeCalculationDetail = …;` add:
     ```ts
     const activeSubstitutedFormula = activeCalculation
       ? substitutedFormula(activeCalculation, {
         roic: assumptions.roic,
         wacc: assumptions.wacc,
         reinvestment: assumptions.reinvestment,
         unleveredBeta: assumptions.unleveredBeta,
         spread: derived.spread,
         bottomUpKe: derived.bottomUpKe,
         leveredBeta: derived.leveredBeta,
         sustainableGrowth: derived.sustainableGrowth,
         debtToEquity: derived.debtToEquity,
         riskFreeRate: RISK_FREE_RATE,
         impliedErp,
         impliedMarketReturn,
         countryRiskPremium: KOREA_COUNTRY_RISK_PREMIUM,
         taxRate: TAX_RATE,
         waccAudit: metricAuditQuery.data?.wacc ?? null,
         dcf: dcfData ? { intrinsic: bridgedEstimatedValue(dcfData), price: dcfData.current_price, upside: bridgedUpsidePct(dcfData) } : null,
       })
       : null;
     ```
  3. Change `{activeCalculationDetail && (` to `{activeCalculation && activeCalculationDetail && (`. Add these props to `<CalculationDetailModal`:
     ```tsx
          detailKey={activeCalculation}
          substitutedFormula={activeSubstitutedFormula}
          dcfStatus={dcfData?.status ?? null}
          dcfGeneratedAt={dcfData?.generated_at ?? null}
     ```

- [ ] **Step 11: Run.** `npx playwright test tests/e2e/corporate-detail-tabs.spec.ts tests/e2e/corporate-one-screen.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 12: Approved edits #50–#55**, and the helper imports (#56). Run `npx playwright test tests/e2e/corporate-*.spec.ts tests/e2e/refresh-idle-state.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 13: Gates.** `npm run typecheck && npm run lint && npm run test:unit`; `npm run design:baseline -- app/corporate/components/CalculationDetailModal.tsx 'app/corporate/components/detail/*.tsx'` reports 0; `wc -l app/corporate/page.tsx` < 1242.

- [ ] **Step 14: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `useTabState(…)` → `useState("summary")` in the modal | `the last tab is remembered across metrics` |
| `subtitle` back to `"Calculation transparency and data lineage"` | `the header pins ticker and value…` |
| `SummaryTab` without the substituted block | `the header pins …` (`substituted-formula`) and `WACC substitutes…` |
| page passes `waccAudit: null` | `WACC substitutes the audit's weights and costs…` |
| `SummaryTab` drops `asOf` (passes `undefined`) | `the header pins …` ("As of" column) |
| `StepsTab` also renders the summary table | `the header pins …` (count 0 on the steps tab) |
| `RawDataTab` renders the export row twice | `the header pins …` (`Download CSV: Analysis` count 1) |
| `substitutedFormula` WACC branch returns a string with zero-filled inputs | `without the audit's inputs WACC shows only the symbolic formula` |

- [ ] **Step 15: Commit.** Mark `C8` in `todo.md`.

```bash
git add apps/web/app/corporate apps/web/lib/i18n apps/web/tests/e2e docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(corporate): calculation detail in tabs: summary with substituted formula, steps, raw data; last tab remembered" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Trend tab (spec §4 "추이", §7 test 9; plan N1)

**Files:**
- Create: `apps/web/app/corporate/components/detail/TrendTab.tsx`
- Modify: `CalculationDetailModal.tsx` (`BUILT_TABS` and four props), `page.tsx` (pass them), `lib/i18n/messages/{en,ko}.ts`, `lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md`, `apps/web/tests/e2e/corporate-detail-tabs.spec.ts` (append), `guideline/sop/todo.md`

**Interfaces:**
- Consumes: `TREND_FIELDS`, `AnnualMetricPoint` (`corporateTypes.ts`), `pct`, the chart helpers in `@/lib/chartConfig` (`GRID_STYLE`, `fmtPctTick`, `withAxisProps`, `withCategoryAxisProps`, `withTooltipProps`), `ResponsiveChart`, `THEAD`/`TR`/`TD`/`TD_FIGURE`, `handleRefreshSourceData` (page).
- Produces:
  - `TrendTab({ detailKey; history: { annual_growth_rates: AnnualMetricPoint[]; annual_roic: AnnualMetricPoint[] } | null; isFetching: boolean; isError: boolean; onLoad: () => void })`. DOM: `[data-testid="trend-table"]`, button "Load source data".
  - modal props `history`, `historyIsFetching`, `historyIsError`, `onLoadHistory`; `BUILT_TABS` gains `"trend"`
  - label `year`; catalog `corporate.detail.trend.*`

**Key → field mapping (N1):** `growth` → `annual_growth_rates`; `roic` → `annual_roic`. No other `CalculationDetailKey` has annual values in `CorporateMetricHistoryApi`, so the tab is hidden for all of them (`detailTabs.ts`, Task 4).

- [ ] **Step 1: Write the failing tests.** In `corporate-detail-tabs.spec.ts`, add `type CorporatePageMockStats` to the `./helpers/corporatePageMock` import, then append:

```ts
function newStats(): CorporatePageMockStats {
  return {
    dcfRequests: 0, dcfFullReportRequests: 0, dcfBulkReportRequests: 0, comparisonRequests: 0,
    metricSaveRequests: 0, metricHistoryRequests: 0, quarterlyRequests: 0, ohlcvRequests: 0,
  };
}

test("growth and ROIC have a Trend tab; CRP and debt ratio do not", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  for (const [label, count] of [["Growth Rate", 1], ["ROIC", 1], ["Country Risk Premium", 0], ["Debt Ratio", 0]] as const) {
    await openAssumptionDetail(page, label);
    await expect(detailTabs(page).getByRole("tab", { name: "Trend" }), label).toHaveCount(count);
    await closeDetail(page);
  }
});

test("the trend asks for nothing until Load source data, then shows the annual values", async ({ page }) => {
  const stats = newStats();
  await mockCorporatePageApi(page, stats);
  const historyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/corporate/metrics/AAPL/history")) historyRequests.push(request.url());
  });
  await gotoCorporate(page);
  await openAssumptionDetail(page, "Growth Rate");
  await openDetailTab(dialog(page), "Trend");
  await page.waitForTimeout(500);
  expect(historyRequests).toEqual([]);
  expect(stats.metricHistoryRequests).toBe(0);
  await dialog(page).getByRole("button", { name: "Load source data" }).click();
  const table = dialog(page).getByTestId("trend-table");
  await expect(table).toContainText("2025", { timeout: 30_000 });
  await expect(table).toContainText("6.0%");
  expect(historyRequests).toHaveLength(1);
});

test("a metric without the remembered tab opens Summary and keeps the memory", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openAssumptionDetail(page, "Growth Rate");
  await openDetailTab(dialog(page), "Trend");
  await closeDetail(page);
  await openAssumptionDetail(page, "Country Risk Premium");
  await expect(detailTabs(page).getByRole("tab", { name: "Summary", exact: true })).toHaveAttribute("aria-selected", "true");
  await closeDetail(page);
  await openAssumptionDetail(page, "ROIC");
  await expect(detailTabs(page).getByRole("tab", { name: "Trend" })).toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Step 2: Run to see them fail.** `npx playwright test tests/e2e/corporate-detail-tabs.spec.ts -g "Trend|trend|remembered tab" --workers=2`. Expected: FAIL; no "Trend" tab.

- [ ] **Step 3: Catalog and label.** `labels.ts`: `year: ["연도", "Year"],`. Glossary rows: `| Year | 연도 | label |` and `| Trend | 추이 | detail tab |`. Inside `corporate.detail` in `en.ts`:

```ts
      trend: {
        idle: "Annual values load with the source data. Nothing is requested until you ask.",
        load: "Load source data", loading: "Loading source data…",
        empty: "No annual values for this metric.", error: "Source data unavailable",
        errorBody: "The annual history could not be loaded.", title: "{label} by year",
      },
```

`ko.ts`:

```ts
      trend: {
        idle: "연도별 값은 원천 데이터와 함께 불러옵니다. 요청하기 전에는 불러오지 않습니다.",
        load: "원천 데이터 불러오기", loading: "원천 데이터를 불러오는 중…",
        empty: "이 지표의 연도별 값이 없습니다.", error: "원천 데이터를 불러오지 못했습니다",
        errorBody: "연도별 이력을 불러오지 못했습니다.", title: "연도별 {label}",
      },
```

- [ ] **Step 4: `detail/TrendTab.tsx`**

```tsx
"use client";

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ActionButton } from "@/components/ui/ActionButton";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtPctTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { MISSING } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import type { AnnualMetricPoint } from "../../corporateTypes";
import { pct } from "../../corporateUtils";
import { TREND_FIELDS } from "../../detailTabs";
import type { CalculationDetailKey } from "../calculationDetailTypes";
import { TD, TD_FIGURE, THEAD, TR } from "./detailParts";

export interface TrendHistory {
  annual_growth_rates: AnnualMetricPoint[];
  annual_roic: AnnualMetricPoint[];
}

// Spec §4 "추이": a line chart and a year table from /corporate/metrics/{t}/history. It is never
// requested on its own: the button runs the page's source-data refresh (§7 test 9).
export function TrendTab({
  detailKey,
  history,
  isFetching,
  isError,
  onLoad,
}: {
  detailKey: CalculationDetailKey;
  history: TrendHistory | null;
  isFetching: boolean;
  isError: boolean;
  onLoad: () => void;
}) {
  const t = useT();
  const field = TREND_FIELDS[detailKey];
  if (!field) return null;
  const label = t(detailKey === "growth" ? "corporate.assumption.growth" : "corporate.assumption.roic");

  if (!history) {
    if (isError) return <ErrorState title={t("corporate.detail.trend.error")} message={t("corporate.detail.trend.errorBody")} />;
    return (
      <div className="flex flex-col items-start gap-3">
        <EmptyState title={t(isFetching ? "corporate.detail.trend.loading" : "corporate.detail.trend.idle")} />
        <ActionButton label={t("corporate.detail.trend.load")} size="sm" variant="secondary" disabled={isFetching} onClick={onLoad} />
      </div>
    );
  }

  const rows = [...history[field]].sort((a, b) => a.year - b.year);
  if (rows.length === 0) return <EmptyState title={t("corporate.detail.trend.empty")} />;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="type-panel-title text-[var(--ink)]">{t("corporate.detail.trend.title", { label })}</h3>
      <ResponsiveChart className="h-56" minWidth={1} minHeight={1}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="year" {...withCategoryAxisProps()} />
          <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0), width: 48 })} />
          <Tooltip {...withTooltipProps()} formatter={(value) => [value == null ? MISSING : pct(Number(value)), label]} />
          <Line type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={1.5} connectNulls={false} />
        </LineChart>
      </ResponsiveChart>
      <div className="overflow-x-auto border border-[var(--line)]">
        <table data-testid="trend-table" className="w-full text-left">
          <thead className={THEAD}>
            <tr>
              <th scope="col" className="px-3 py-2"><BilingualLabel k="year" /></th>
              <th scope="col" className="px-3 py-2 text-right"><BilingualLabel k="value" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.year} className={TR}>
                <td className={TD}>{row.year}</td>
                <td className={`${TD_FIGURE} text-right`}>{row.value == null ? MISSING : pct(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire it.** In `CalculationDetailModal.tsx`:
  - `const BUILT_TABS: readonly DetailTabKey[] = ["summary", "steps", "trend", "raw"];`
  - Add `import { TrendTab, type TrendHistory } from "./detail/TrendTab";`.
  - Add these props: `history: TrendHistory | null; historyIsFetching: boolean; historyIsError: boolean; onLoadHistory: () => void;`.
  - Inside the tabpanel, after the steps line, add:
    ```tsx
          {active === "trend" ? (
            <TrendTab detailKey={detailKey} history={props.history} isFetching={props.historyIsFetching} isError={props.historyIsError} onLoad={props.onLoadHistory} />
          ) : null}
    ```

  In `page.tsx`, add to `<CalculationDetailModal`:

```tsx
          history={metricsHistoryData}
          historyIsFetching={metricsHistoryQuery.isFetching}
          historyIsError={metricsHistoryQuery.isError}
          onLoadHistory={handleRefreshSourceData}
```

  `metricsHistoryData` is already null when the cached history belongs to another ticker (`page.tsx`, `metricsHistorySnapshot === sourceDataTicker`).

- [ ] **Step 6: Run.** `npx playwright test tests/e2e/corporate-detail-tabs.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 7: Gates.** `npm run typecheck && npm run lint`; `npm run design:baseline -- app/corporate/components/detail/TrendTab.tsx` reports 0.

- [ ] **Step 8: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `TREND_FIELDS` gains `crp: "annual_roic"` | `growth and ROIC have a Trend tab; CRP and debt ratio do not` |
| `BUILT_TABS` without `"trend"` | the same test, and `a metric without the remembered tab …` |
| `TrendTab` calls `onLoad()` in a `useEffect` when `history` is null | `the trend asks for nothing until Load source data…` |
| `TrendTab` reads `history.annual_roic` for every key | `… then shows the annual values` (table shows 18.0%) |
| modal adds `useEffect(() => setStoredTab(active), [active])` | `a metric without the remembered tab opens Summary and keeps the memory` |

- [ ] **Step 9: Commit.** Mark `C9` in `todo.md`.

```bash
git add apps/web/app/corporate apps/web/lib/i18n apps/web/tests/e2e/corporate-detail-tabs.spec.ts docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(corporate): trend tab for growth and ROIC, loaded only on request" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Peers tab: rank and band within the current comparison (spec §4 "동종업 비교", part A)

**Files:**
- Create: `apps/web/app/corporate/components/detail/PeersTab.tsx`
- Modify: `CalculationDetailModal.tsx`, `page.tsx`, `lib/i18n/messages/{en,ko}.ts`, `docs/design/MoneyView_Glossary.md`, `apps/web/tests/e2e/corporate-detail-tabs.spec.ts` (append), `guideline/sop/todo.md`

**Interfaces:**
- Consumes: Task 4 `peerRank`, `PEER_FIELDS`; `CorporateComparisonRowApi`; helper `openLowerTab`.
- Produces: `PeersTab({ detailKey; ticker; rows: readonly CorporateComparisonRowApi[] | null })`. DOM: `[data-testid="peer-position"]`, `[data-testid="peer-marker"]` with an inline `left: <n>%`. Modal prop `comparisonRows: CorporateComparisonRowApi[] | null`, where null means not computed. `BUILT_TABS` gains `"peers"`. Catalog `corporate.detail.peers.*`.

**Fixture facts the tests rely on** (`corporatePageMock.ts`, universe `watchlist_plus_benchmark`, the default): the non-benchmark `roic_minus_wacc` values are AAPL 8, MSFT 13, ESTM 5, MISS 2, BURN −15 and GOOGL 10.5. AAPL therefore ranks 3 of 6, the band runs −15.0 % to 13.0 %, and the marker sits at (8 + 15) / 28 = 82.1 %. For `dcf_implied_return`: AAPL 14.31, MSFT 10.81, ESTM 20, GOOGL 5.94. MISS (bridge missing, 0.0) and BURN (null) are excluded, so AAPL ranks 2 of 4.

- [ ] **Step 1: Write the failing tests.** Add `import { openLowerTab } from "./helpers/corporateDcf";` (merge with the existing import) and append:

```ts
async function refreshComparison(page: Page) {
  await openLowerTab(page, "Target Stock Comparison");
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.getByRole("cell", { name: "GOOGL" }).first()).toBeVisible({ timeout: 30_000 });
  // Task 7b: the KPIs and Verdict detail live on the Summary page tab; go back before opening them.
  await openLowerTab(page, "Summary");
}

test("Peers waits for the comparison, then ranks this ticker inside the universe", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openKpi(page, /^ROIC - WACC/);
  await openDetailTab(dialog(page), "Peers");
  await expect(dialog(page)).toContainText("Shown after the comparison is calculated in the Target Stock Comparison tab.");
  await closeDetail(page);
  await refreshComparison(page);
  await openKpi(page, /^ROIC - WACC/);
  const position = dialog(page).getByTestId("peer-position");
  await expect(position).toContainText("Rank 3 of 6, high to low");
  await expect(position).toContainText("Low -15.0%");
  await expect(position).toContainText("High 13.0%");
  await expect(position.getByTestId("peer-marker")).toHaveAttribute("style", /left: 82\.1%/);
});

test("the upside position leaves out the unbridged row and the refused one", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await refreshComparison(page);
  await page.getByRole("button", { name: "Verdict detail" }).click();
  await openDetailTab(dialog(page), "Peers");
  await expect(dialog(page).getByTestId("peer-position")).toContainText("Rank 2 of 4, high to low");
});
```

- [ ] **Step 2: Run to see them fail.** `npx playwright test tests/e2e/corporate-detail-tabs.spec.ts -g "Peers|upside position" --workers=2`. Expected: FAIL; no "Peers" tab.

- [ ] **Step 3: Catalog.** Inside `corporate.detail` in `en.ts`:

```ts
      peers: {
        idle: "Shown after the comparison is calculated in the Target Stock Comparison tab.",
        absent: "{ticker} is not in the current comparison universe.",
        noValue: "No value for {ticker} in this comparison.",
        rank: "Rank {rank} of {count}, high to low", low: "Low", high: "High",
        note: "Position within the current comparison universe. A sector peer table replaces this in part B.",
      },
```

`ko.ts`:

```ts
      peers: {
        idle: "종목 비교 탭에서 비교를 계산하면 보입니다.",
        absent: "{ticker}은(는) 현재 비교 유니버스에 없습니다.",
        noValue: "이 비교에서 {ticker}의 값이 없습니다.",
        rank: "{count}개 중 {rank}위(높은 순)", low: "최저", high: "최고",
        note: "현재 비교 유니버스 안의 위치입니다. 이후 동종업 비교표(B)로 바뀝니다.",
      },
```

Glossary: `| Peers | 동종업 비교 | detail tab |`.

- [ ] **Step 4: `detail/PeersTab.tsx`**

```tsx
"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n/locale";
import type { CorporateComparisonRowApi } from "../../corporateTypes";
import { pct } from "../../corporateUtils";
import { PEER_FIELDS } from "../../detailTabs";
import { peerRank } from "../../peerRank";
import type { CalculationDetailKey } from "../calculationDetailTypes";

// Spec §4 "동종업 비교", part A: rank and spread band inside the comparison already computed.
// Nothing is requested here; part B replaces this with a sector peer table.
export function PeersTab({ detailKey, ticker, rows }: { detailKey: CalculationDetailKey; ticker: string; rows: readonly CorporateComparisonRowApi[] | null }) {
  const t = useT();
  const field = PEER_FIELDS[detailKey];
  if (!field) return null;
  if (!rows) return <EmptyState title={t("corporate.detail.peers.idle")} />;
  const result = peerRank(rows, field, ticker);
  if (result.state === "absent") return <EmptyState title={t("corporate.detail.peers.absent", { ticker })} />;
  if (result.state === "noValue") return <EmptyState title={t("corporate.detail.peers.noValue", { ticker })} />;
  return (
    <div data-testid="peer-position" className="flex flex-col gap-3">
      <p className="type-body text-[var(--ink)]">{t("corporate.detail.peers.rank", { rank: result.rank, count: result.count })}</p>
      <span className="type-figure-md text-[var(--ink)]">{pct(result.value)}</span>
      <div className="relative h-2 bg-[var(--surface)]">
        <span
          data-testid="peer-marker"
          aria-hidden="true"
          className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-[var(--brand)]"
          style={{ left: `${(result.position * 100).toFixed(1)}%` }}
        />
      </div>
      <div className="type-caption flex justify-between uppercase text-[var(--ink-muted)]">
        <span>{t("corporate.detail.peers.low")} {pct(result.min)}</span>
        <span>{t("corporate.detail.peers.high")} {pct(result.max)}</span>
      </div>
      <p className="type-small text-[var(--ink-muted)]">{t("corporate.detail.peers.note")}</p>
    </div>
  );
}
```

- [ ] **Step 5: Wire it.** In `CalculationDetailModal.tsx`, set `BUILT_TABS` to `["summary", "steps", "trend", "peers", "raw"]`. Import `PeersTab` and `type CorporateComparisonRowApi` (from `../corporateTypes`). Add the prop `comparisonRows: CorporateComparisonRowApi[] | null;`, and in the tabpanel:

```tsx
          {active === "peers" ? <PeersTab detailKey={detailKey} ticker={ticker} rows={props.comparisonRows} /> : null}
```

In `page.tsx`, pass `comparisonRows={comparisonData?.rows ?? null}`.

- [ ] **Step 6: Run.** `npx playwright test tests/e2e/corporate-detail-tabs.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 7: Gates.** `npm run typecheck && npm run lint`; `npm run design:baseline -- app/corporate/components/detail/PeersTab.tsx` reports 0.

- [ ] **Step 8: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `page.tsx` passes `comparisonData?.rows ?? []` (no null) | `Peers waits for the comparison…` (shows "not in the universe") |
| `PEER_FIELDS.backendDcf` → `"roic"` | `the upside position leaves out the unbridged row and the refused one` |
| marker `left` uses `(1 - result.position)` | `Peers waits …` (`left: 82.1%`) |
| `BUILT_TABS` without `"peers"` | both tests |

- [ ] **Step 9: Commit.** Mark `C10` in `todo.md`.

```bash
git add apps/web/app/corporate apps/web/lib/i18n apps/web/tests/e2e/corporate-detail-tabs.spec.ts docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(corporate): peers tab ranks the metric inside the current comparison" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Sensitivity tab: two DCF runs at ±Δ (spec §4, §4.1, §6, §7 test 8)

**Files:**
- Create: `apps/web/app/corporate/components/detail/SensitivityTab.tsx`
- Modify: `CalculationDetailModal.tsx`, `page.tsx`, `lib/i18n/messages/{en,ko}.ts`, `lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md`, `apps/web/tests/e2e/corporate-detail-tabs.spec.ts` (append), `guideline/sop/todo.md`

**Interfaces:**
- Consumes: Task 4 `sensitivityPlan`, `assumptionRow`, `formatAssumption`, `formatDelta`; `postDcf`, `DcfRefusalError` (`@/lib/dcfRefusal`); `bridgedEstimatedValue`, `bridgedUpsidePct`; `DeltaBadge`; `DcfRequestSnapshot`; `DcfSummaryResponse`.
- Produces:
  - `SensitivityTab({ detailKey; ticker; snapshot: DcfRequestSnapshot; base: { intrinsic: number | null; upside: number | null } | null })`. DOM: `[data-testid="sensitivity-table"]` and `[data-testid="sensitivity-row-current|down|up"]`; a failed side holds a `role="alert"` cell; the button is "Calculate".
  - modal props `dcfSnapshot: DcfRequestSnapshot`, `baseDcf: { intrinsic: number | null; upside: number | null } | null`; `BUILT_TABS` is complete
  - labels `scenario`, `intrinsicValue`, `upside`; catalog `corporate.detail.sensitivity.*`

The requests are sent from the tab, only on click, and only to the existing `POST /corporate/dcf/{t}`. Their results are transient and are not cached. This follows the file-structure SOP's "endpoint triggers near query ownership", because the page owns no query for them. Say so in the commit body.

- [ ] **Step 1: Write the failing tests** (append to `corporate-detail-tabs.spec.ts`)

```ts
const isSingleDcf = (url: URL) => url.pathname.endsWith("/corporate/dcf/AAPL");

test("Calculate sends exactly two DCF requests that move only WACC by ±1.0%p", async ({ page }) => {
  await mockCorporatePageApi(page);
  const bodies: Record<string, number>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && isSingleDcf(new URL(request.url()))) bodies.push(request.postDataJSON());
  });
  await gotoCorporate(page);
  const stream = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/corporate/dcf/AAPL/stream"));
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  const base = (await stream).postDataJSON() as Record<string, number>;
  await expect(page.getByTestId("corporate-verdict")).toHaveAttribute("data-state", "valued", { timeout: 30_000 });

  await openAssumptionDetail(page, "WACC");
  await openDetailTab(dialog(page), "Sensitivity");
  await page.waitForTimeout(300);
  expect(bodies, "nothing is sent before Calculate").toHaveLength(0);
  await dialog(page).getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("$240.5", { timeout: 30_000 });
  await expect(dialog(page).getByTestId("sensitivity-row-down")).toContainText("$240.5");
  expect(bodies).toHaveLength(2);
  const [down, up] = [...bodies].sort((a, b) => a.wacc - b.wacc);
  expect(down.wacc).toBeCloseTo(base.wacc - 0.01, 10);
  expect(up.wacc).toBeCloseTo(base.wacc + 0.01, 10);
  expect({ ...down, wacc: base.wacc }).toEqual(base);
  expect({ ...up, wacc: base.wacc }).toEqual(base);
  await expect(dialog(page).getByTestId("sensitivity-row-down")).toContainText("9.0%");
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("11.0%");
});

test("when one of the two runs fails, the other still shows and the failed one says so", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.route((url) => isSingleDcf(url), async (route) => {
    const body = route.request().postDataJSON() as { wacc: number };
    if (body.wacc < 0.1) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "Mock DCF failure" }) });
    }
    return route.fallback();
  });
  await gotoCorporate(page);
  await openAssumptionDetail(page, "WACC");
  await openDetailTab(dialog(page), "Sensitivity");
  await dialog(page).getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(dialog(page).getByTestId("sensitivity-row-up")).toContainText("$240.5", { timeout: 30_000 });
  await expect(dialog(page).getByTestId("sensitivity-row-down").getByRole("alert")).toContainText("This run failed");
});

test("an assumption the DCF does not use says so and offers nothing to run", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  await openAssumptionDetail(page, "Innovation Index");
  await openDetailTab(dialog(page), "Sensitivity");
  await expect(dialog(page)).toContainText("An assumption the DCF does not use directly.");
  await expect(dialog(page).getByRole("button", { name: "Calculate", exact: true })).toHaveCount(0);
});
```

- [ ] **Step 2: Run to see them fail.** `npx playwright test tests/e2e/corporate-detail-tabs.spec.ts -g "Calculate|runs fail|does not use" --workers=2`. Expected: FAIL; no "Sensitivity" tab.

- [ ] **Step 3: Labels, catalog, glossary.** `labels.ts`:

```ts
  scenario: ["시나리오", "Scenario"],
  intrinsicValue: ["내재가치", "Intrinsic value"],
  upside: ["상승여력", "Upside"],
```

Inside `corporate.detail` in `en.ts`:

```ts
      sensitivity: {
        notDcf: "An assumption the DCF does not use directly.",
        intro: "Runs the DCF twice with {label} moved by ±{delta}; every other input stays as it is now.",
        run: "Calculate", running: "Calculating…", current: "Current", minus: "−{delta}", plus: "+{delta}",
        clamped: "clamped to the slider range", failed: "This run failed: {message}",
      },
```

`ko.ts`:

```ts
      sensitivity: {
        notDcf: "DCF에 직접 쓰이지 않는 가정입니다.",
        intro: "{label}만 ±{delta} 바꿔 DCF를 두 번 계산합니다. 나머지 입력은 지금 값 그대로입니다.",
        run: "계산", running: "계산 중…", current: "현재", minus: "−{delta}", plus: "+{delta}",
        clamped: "슬라이더 범위로 잘림", failed: "이 계산은 실패했습니다: {message}",
      },
```

Glossary rows: `| Sensitivity | 민감도 | detail tab |`, `| Scenario / Intrinsic value / Upside | 시나리오 / 내재가치 / 상승여력 | label |`, `| Calculate | 계산 | button |`.

- [ ] **Step 4: `detail/SensitivityTab.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { DcfSummaryResponse } from "../../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { bridgedEstimatedValue, bridgedUpsidePct } from "@/lib/bridgeQuality";
import { DcfRefusalError, postDcf } from "@/lib/dcfRefusal";
import { MISSING } from "@/lib/format";
import { useT } from "@/lib/i18n/locale";
import { assumptionRow, formatAssumption, formatDelta, sensitivityPlan, type DcfRequestBody } from "../../assumptionRows";
import type { DcfRequestSnapshot } from "../../corporateTypes";
import { moneyText } from "../../corporateUtils";
import type { CalculationDetailKey } from "../calculationDetailTypes";
import { TD, TD_FIGURE, THEAD, TR } from "./detailParts";

type SideResult =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; intrinsic: number | null; upside: number | null }
  | { state: "error"; message: string };

// Spec §4.1: only the DCF inputs, a fixed Δ per assumption, two runs on request. Each run settles
// on its own, so one failure leaves the other result on screen (§6).
export function SensitivityTab({
  detailKey,
  ticker,
  snapshot,
  base,
}: {
  detailKey: CalculationDetailKey;
  ticker: string;
  snapshot: DcfRequestSnapshot;
  base: { intrinsic: number | null; upside: number | null } | null;
}) {
  const t = useT();
  const [results, setResults] = useState<{ down: SideResult; up: SideResult }>({ down: { state: "idle" }, up: { state: "idle" } });
  const row = assumptionRow(detailKey);
  const plan = sensitivityPlan(snapshot, detailKey);
  if (!row || !plan) return <EmptyState title={t("corporate.detail.sensitivity.notDcf")} />;

  const runOne = async (body: DcfRequestBody): Promise<SideResult> => {
    try {
      const summary = await postDcf<DcfSummaryResponse>(`/corporate/dcf/${ticker}`, body);
      return { state: "done", intrinsic: bridgedEstimatedValue(summary), upside: bridgedUpsidePct(summary) };
    } catch (error) {
      const message = error instanceof DcfRefusalError ? error.readerText : error instanceof Error ? error.message : String(error);
      return { state: "error", message };
    }
  };
  const run = async () => {
    setResults({ down: { state: "loading" }, up: { state: "loading" } });
    const [down, up] = await Promise.all([runOne(plan.down.body), runOne(plan.up.body)]);
    setResults({ down, up });
  };
  const running = results.down.state === "loading" || results.up.state === "loading";
  const label = t(`corporate.assumption.${row.key}`);
  const delta = formatDelta(row);

  return (
    <div className="flex flex-col gap-3">
      <p className="type-body text-[var(--ink-secondary)]">{t("corporate.detail.sensitivity.intro", { label, delta })}</p>
      <ActionButton
        label={t(running ? "corporate.detail.sensitivity.running" : "corporate.detail.sensitivity.run")}
        size="sm"
        variant="secondary"
        disabled={running}
        onClick={() => void run()}
        className="self-start"
      />
      <div className="overflow-x-auto border border-[var(--line)]">
        <table data-testid="sensitivity-table" className="w-full text-left">
          <thead className={THEAD}>
            <tr>
              <th scope="col" className="px-3 py-2"><BilingualLabel k="scenario" /></th>
              <th scope="col" className="px-3 py-2 text-right"><BilingualLabel k="value" /></th>
              <th scope="col" className="px-3 py-2 text-right"><BilingualLabel k="intrinsicValue" /></th>
              <th scope="col" className="px-3 py-2 text-right"><BilingualLabel k="upside" /></th>
            </tr>
          </thead>
          <tbody>
            <tr data-testid="sensitivity-row-current" className={TR}>
              <td className={TD}>{t("corporate.detail.sensitivity.current")}</td>
              <td className={`${TD_FIGURE} text-right`}>{formatAssumption(row, plan.current)}</td>
              <td className={`${TD_FIGURE} text-right`}>{base?.intrinsic == null ? MISSING : moneyText(base.intrinsic)}</td>
              <td className="px-3 py-2 text-right"><DeltaBadge value={base?.upside ?? null} /></td>
            </tr>
            {(["down", "up"] as const).map((side) => {
              const step = plan[side];
              const result = results[side];
              return (
                <tr key={side} data-testid={`sensitivity-row-${side}`} className={TR}>
                  <td className={TD}>{t(side === "down" ? "corporate.detail.sensitivity.minus" : "corporate.detail.sensitivity.plus", { delta })}</td>
                  <td className={`${TD_FIGURE} text-right`}>
                    {formatAssumption(row, step.value)}
                    {step.clamped ? <span className="type-caption ml-1 text-[var(--status-warning-ink)]">{t("corporate.detail.sensitivity.clamped")}</span> : null}
                  </td>
                  {result.state === "done" ? (
                    <>
                      <td className={`${TD_FIGURE} text-right`}>{result.intrinsic === null ? MISSING : moneyText(result.intrinsic)}</td>
                      <td className="px-3 py-2 text-right"><DeltaBadge value={result.upside} /></td>
                    </>
                  ) : result.state === "error" ? (
                    <td colSpan={2} role="alert" className="type-small px-3 py-2 text-right text-[var(--status-error-ink)]">
                      {t("corporate.detail.sensitivity.failed", { message: result.message })}
                    </td>
                  ) : (
                    <td colSpan={2} className={`${TD} text-right`}>
                      {result.state === "loading" ? t("corporate.detail.sensitivity.running") : MISSING}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire it.** In `CalculationDetailModal.tsx`, set `BUILT_TABS` to `["summary", "steps", "trend", "peers", "sensitivity", "raw"]` (now equal to `DETAIL_TABS`). Import `SensitivityTab` and `type DcfRequestSnapshot` (`../corporateTypes`). Add the props `dcfSnapshot: DcfRequestSnapshot; baseDcf: { intrinsic: number | null; upside: number | null } | null;`, and in the tabpanel:

```tsx
          {active === "sensitivity" ? <SensitivityTab detailKey={detailKey} ticker={ticker} snapshot={props.dcfSnapshot} base={props.baseDcf} /> : null}
```

In `page.tsx`, pass:

```tsx
          dcfSnapshot={activeDcfSnapshot}
          baseDcf={dcfData ? { intrinsic: bridgedEstimatedValue(dcfData), upside: bridgedUpsidePct(dcfData) } : null}
```

- [ ] **Step 6: Run.** `npx playwright test tests/e2e/corporate-detail-tabs.spec.ts tests/e2e/corporate-model.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 7: Gates.** `npm run typecheck && npm run lint`; `npm run design:baseline -- app/corporate/components/detail/SensitivityTab.tsx` reports 0; `wc -l app/corporate/page.tsx` ≤ 1150.

- [ ] **Step 8: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `run` sends `plan.down.body` twice | `Calculate sends exactly two DCF requests that move only WACC by ±1.0%p` |
| `useEffect(() => { void run(); }, [])` added | the same test ("nothing is sent before Calculate") |
| `runOne` without its `try/catch` (one rejection rejects `Promise.all`) | `when one of the two runs fails, the other still shows…` |
| early return for `!plan` removed (the table renders for innovation) | `an assumption the DCF does not use says so…` |
| page passes `dcfSnapshot={{ ...activeDcfSnapshot, growth: 0 }}` | the first test (`revenue_growth_rate` differs from the stream body) |

- [ ] **Step 9: Commit.** Mark `C11` in `todo.md`.

```bash
git add apps/web/app/corporate apps/web/lib/i18n apps/web/tests/e2e/corporate-detail-tabs.spec.ts docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(corporate): sensitivity tab runs the DCF at minus and plus the spec's step, on request" -m "Requests go to the existing POST /corporate/dcf/{t} from the tab, only on click; results are transient." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Corporate on paper tokens (the corporate share of DS Task 11; plan N9)

**Globs:** `app/corporate/**/*.{ts,tsx}`.
**Specs:** `tests/e2e/corporate-*.spec.ts`, `refresh-idle-state.spec.ts`, `terminal-diagnostics.spec.ts`, `high-risk-render-regression.spec.ts`, `tab-state-persistence.spec.ts`, `responsive-accessibility.spec.ts`.
**Korean assertion:** already in `corporate-one-screen.spec.ts` ("in Korean", Task 7).

**Files:** the corporate files still carrying pre-paper classes or hex values. At plan time these are `page.tsx` (`CalculationModalLoadingOverlay`; the `hurdleBars` fills `#9DA5A2`, `#60CAAD`, `#444444`), `RangeControl.tsx`, `DcfSensitivityTable.tsx`, `CorporateComparisonTable.tsx`, the chart and batch-report parts of `TargetStockComparisonSection.tsx`, `CorporateGraphs.tsx` and `graphs/*.tsx`.

**Interfaces:** none new. Rendering only; text, labels and numbers are unchanged.

- [ ] **Step 1:** `npm run design:baseline -- 'app/corporate/**/*.{ts,tsx}'`. Record the counts in Track D.
- [ ] **Step 2:** Apply M1–M4 from the design-system plan's "Screen migration procedure" to every hit. Fixed choices for the known hex values:

| Where | From | To |
|---|---|---|
| `page.tsx` `hurdleBars` | `#9DA5A2` / `#60CAAD` / `#444444` | `"var(--chart-4)"` / `"var(--chart-1)"` / `"var(--ink)"` |
| `TargetStockComparisonSection` spread bars, `roic_minus_wacc` | selected `#0F766E`, others `#60CAAD` | `"var(--chart-1)"`, `"var(--chart-4)"` |
| same, `implied_return_spread` | selected `#1D4ED8`, others `#94A3B8` | `"var(--chart-2)"`, `"var(--chart-3)"` |
| price-vs-value scatter | peers `#94A3B8`, selected `#0F766E` | `"var(--chart-4)"`, `"var(--chart-1)"` |
| `CalculationModalLoadingOverlay` | `bg-black/50`, `rounded-[var(--radius)]`, `shadow-2xl`, `bg-[var(--surface-muted)]` | `bg-[var(--overlay-scrim)]`, none, none (add `border border-[var(--line)]`), `bg-[var(--surface)]` |

  Do not change M5 numbers, M6 prose in `buildCalculationDetails.ts`, or the header text of the comparison, batch, grid or DCF-report tables (N9).
- [ ] **Step 3:** `npm run design:baseline -- 'app/corporate/**/*.{ts,tsx}'`. Every category must be 0, including `deprecatedVar` and `unknownVar`. Then `npm run typecheck && npm run lint`.
- [ ] **Step 4:** Run the specs listed above with `--workers=2`. Expected: PASS. If an assertion encodes an old rendered value, stop and list it for the owner; none is expected, because no corporate spec reads a colour or class.
- [ ] **Step 5: Mutation.** Put `#60CAAD` back in `hurdleBars`. `npm run design:baseline -- app/corporate/page.tsx` must report `hex: 1`. Restore the file from the backup and confirm with `cmp`.
- [ ] **Step 6: Commit.** Mark `C12` in `todo.md`.

```bash
git add apps/web/app/corporate guideline/sop/todo.md
git commit -m "refactor(design): corporate on paper tokens (colour, type, radius, chart series)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: i18n and glossary sweep, docs, capture review, full suite, merge back

**Files:** `docs/USER-GUIDE.md`, `docs/design/MoneyView_Component_System.md`, `docs/design/MoneyView_Interaction_Rules.md`, `guideline/sop/todo.md`; `ERROR-LOG.md` if a bug was found on the way.

- [ ] **Step 1: Catalog parity.** `npm run typecheck` (a key in `en` but missing in `ko` fails). Then list the corporate and topnav keys and check that each has a glossary-consistent Korean value:

```bash
node -e "const s=require('fs').readFileSync('lib/i18n/messages/ko.ts','utf8'); for (const m of s.matchAll(/:\s*\"([^\"]*[A-Za-z]{4,}[^\"]*)\"/g)) console.log(m[1])"
```

  Expected output: only strings that are English by design ("Powered by FastAPI & Next.js", "ROIC - WACC", "WACC", "ROIC", "DCF", "AAPL, MSFT, NVDA"-style examples). Translate any other line.

- [ ] **Step 2: New-file literal sweep.** Run the command below. Every hit must be an aria-hidden glyph or an English-by-design string listed in N9 (the modal's moved audit titles). Move anything else to the catalog.

```bash
git grep -n -E '>[A-Z][a-z]+( [a-z]+){1,}<' -- app/corporate/components/{VerdictBlock,KpiRow,AssumptionTable,CorporateHeader,CorporatePageTabs,DcfTab}.tsx app/corporate/components/detail/{SummaryTab,StepsTab,TrendTab,PeersTab,SensitivityTab}.tsx components/ui/TopNav.tsx
```

- [ ] **Step 3: Docs.** Run `git grep -n -i "sidebar\|left nav\|View Full Report\|Add Company" -- docs/USER-GUIDE.md docs/design/MoneyView_Component_System.md docs/design/MoneyView_Interaction_Rules.md`. Rewrite each hit that describes the current UI:
  - navigation is "the top bar (icons; hover, focus or ☰ opens the full menu)"
  - the full DCF report is reached from the DCF tab's Load Full Report or the calculation detail's Raw data tab
  - a company not in the list is added from the search's "Not in the list → add" entry
  - the corporate page is four tabs (Summary, Core Diagnostics, DCF, Target Stock Comparison) under a one-line verdict, and it never scrolls; a long tab scrolls inside itself

  Do not edit `docs/archive/` or other plans.

- [ ] **Step 4: Capture review.** From `apps/web`:

```bash
DESIGN_CAPTURE=corporate-one-screen npx playwright test tests/e2e/design-capture.spec.ts --workers=2
node scripts/capture-review.mjs <the label DS Task 10 captured, from Track D> corporate-one-screen
```

  The owner reviews every screen: the top bar replaces the sidebar and the body is about 350 px wider (spec §9). For `/corporate`, check the Summary tab against spec §2A's diagram. The full-page capture must be exactly the viewport, because the page does not scroll: `python -c "import struct; f=open('design-capture/corporate-one-screen/corporate.png','rb'); f.read(16); print(struct.unpack('>II', f.read(8)))"` must print `(1280, 720)`. Any other height means the page scrolls: stop and report it. The other three tabs are not in the capture; the owner opens them in the running app or reads Task 7b's no-page-scroll test. Record the review page path and one verdict line per screen in Track D. Width-driven stretch on other screens is noted, not fixed here; DS Tasks 11–13 adjust it.

- [ ] **Step 5: Full gates.** `npm run typecheck && npm run lint && npm run test:unit && npx playwright test --workers=2`, then from the repo root `python -m pytest -q` (unchanged count; a frontend-only branch must not move it). `wc -l apps/web/app/corporate/page.tsx` ≤ 1150. The full run includes Task 7b's `the page never scrolls; the panel takes the overflow` at 1280×720 and 390×844; it must pass, not be skipped. If a Playwright run is interrupted, kill :8110/:3101 (Global Constraints) before rerunning.

- [ ] **Step 6: Review.** Run the `code-reviewer.md` checklist over `git diff feat/design-system-paper...HEAD`. Every new test must have its matrix row executed. A test whose mutation did not make it fail is reported as unverified, not as passing (CLAUDE.md §8).

- [ ] **Step 7: Tracking.** In `todo.md`, mark `C13`. Add Follow-ups:
  - B: sector peer data (spec D7/D8), which replaces the Peers tab's universe position
  - the N9 residue (M5 numbers, `buildCalculationDetails` prose, bilingual headers on the pre-existing tables)
  - annual history for debt ratio, reinvestment, beta and innovation, which N1 needs from the backend

  Commit:

```bash
git add docs/USER-GUIDE.md docs/design guideline/sop/todo.md
git commit -m "docs: top bar and corporate one-screen in the user guide and design docs; tracking" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Merge back, after the owner accepts the capture review.**

```bash
git switch feat/design-system-paper
git merge --no-ff feat/corporate-one-screen -m "merge: corporate one-screen (part A) before DS Task 11" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

  On an `ERROR-LOG.md` conflict, keep both sides' records. Then DS Task 11 (valuation, cases, decisions) may start.

---

## Self-review (2026-10-14)

- **Spec coverage.**

  | Spec section | Task |
  |---|---|
  | §1 top bar, D9 | 3 |
  | §2.1 header | 7 |
  | §2.2 verdict | 5 (label rule in 4) |
  | §2.3 KPIs | 5 |
  | §2.4 assumption table | 5 |
  | §2A page tabs, verdict strip, no page scroll (D10) | 7b |
  | §2.5 move/remove list | 5 (refusal chip), 6 (Calculate All DCF, diagnostics box, comparison paragraphs, sync box, idle box), 7 (View Full Report, Add Company, Intrinsic DCF tile, idle sentence) |
  | §3.1 diagnostics tab | 6 |
  | §3.2 DCF tab | 6 |
  | §3.3 comparison tab | 6 |
  | §4 modal shell and memory | 8 |
  | §4 summary | 8 (+4) |
  | §4 steps and raw data | 8 |
  | §4 trend | 9 (N1) |
  | §4 peers | 10 |
  | §4 sensitivity and §4.1 | 11 (+4) |
  | §5 i18n | each task + 13 |
  | §6 error and empty states | 5 (refusal), 6 (DCF tab error), 9 (history error), 11 (partial failure) |
  | §7 tests | 1 → Task 7; 2–3 → Task 5; 4 → Task 5; 5 → Task 6; 6 → Task 3; 7 → Tasks 8 and 9; 8 → Task 11; 9 → Task 9 |
  | §8 sequencing | 1, 13 |
  | §9 risks | the budget table, Task 7's fit test, Task 13's capture review, and the page.tsx line gates |

- **Placeholders.** No "TBD" or "similar to Task N". The verbatim moves are written out in full in Tasks 5, 6 and 8.
- **Type consistency.** These names are used identically in every task: `AssumptionField`, `AssumptionKey`, `DcfRequestBody`, `DetailTabKey`, `PeerField`, `TrendHistory`, `BUILT_TABS`, `loadFullDcfReport`, `openLowerTab`, `lowerPanel`, `openDetailTab`, `refreshDcf`, `loadFullDcfReportInTab`, `openFullDcfReportInModal`, and (Task 7b) `verdictView`, `VerdictView`, `PageTabKey`, `PAGE_TAB_KEY` and `migrateLowerTab`. Each catalog key a component reads is added in the same task, in both `en` and `ko`.
- **Review Focus.** All five items have tests: Task 4 (1, 2, 3), Task 3 (4) and Task 9 (5).
