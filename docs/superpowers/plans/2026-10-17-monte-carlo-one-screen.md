# Monte Carlo One-Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/monte-carlo` fits one 1280×720 screen (and 390×844) on all five tabs, before and after a run. Each tab shows its key figures and main chart first. KRW amounts read correctly (`KRW 9.64M` / `964만원`, not `964 M KRW`). All screen copy comes from the en/ko catalogs. The page moves only through the motion-system pieces from PR #71.

**Architecture:**
- **Page frame:** header (title + one-line subtitle, no eyebrow), the shared `Tabs`, and a tab panel that fills the one-screen column (`/corporate` and `/` use the same column class). Tab state lives in `useTabState` under `moneyview.tab.monteCarlo.tab`, guarded to the five keys.
- **Per tab:** a 320px input rail on the left (inputs scroll, run/cancel pinned), and a result area on the right: a header row (status · figures · export menu), then the main chart area that fills the rest.
- **Pure logic** goes in `app/monte-carlo/lib/` and is tested as a Playwright model spec (no page), like `market-model.spec.ts`: `formatKrwCompact`, `krwAxis`, `formatKrwRange`, `isMonteCarloTab`, `runStatusView`, `beforeText`.
- **Worker, engine, normalization, input defaults and CSV contents do not change** (spec "범위 밖"). The page keeps owning worker and input state.

**Tech Stack:** Next.js 16, React 19, Tailwind 4 with the token CSS variables (`npm run tokens`), recharts 3.8.1, Playwright (reduced motion by default), en/ko catalogs in `apps/web/lib/i18n/messages/{en,ko}.ts`.

**Spec:** `docs/superpowers/specs/2026-10-16-monte-carlo-one-screen-design.md` (owner: "추천대로 진행해줘", 2026-10-16; §8 motion added d6dc92d). Motion pieces: `docs/superpowers/specs/2026-10-16-motion-system-design.md` and `DESIGN.md` "Motion". Paths below are under `apps/web/` unless stated.

**Branch:** `feat/monte-carlo-one-screen`, stacked on `feat/motion-system` (PR #71).
- PR #71 must be merged into `renewal` before Task 1. Then rebase this branch onto `origin/renewal`.
- The local `renewal` ref is still b833b21; PR #70 is on `origin/renewal` (adbbd44). Fetch first and rebase onto `origin/renewal`.

**Model routing** (HARNESS; Opus 5.5 is the controller and the final reviewer):

| Task | Implementer | Reviewer | Notes |
|---|---|---|---|
| 0 Owner gate | controller | — | inventory, decisions D1–D9, tokens |
| 1 Risk-tab empty charts (spec §5.3) | Sonnet | Sonnet | investigation; Opus if the root cause is unclear after one pass |
| 2 KRW formatter, axis units, ERROR-LOG | Haiku | Sonnet | edit A3 stage 1 |
| 3 Superseded-run status (D3) | Haiku | Sonnet | only if D3 is approved |
| 4 Page frame: header, Tabs, tab state | Sonnet | Sonnet | shared surface (`ScanReveal`): full suite |
| 5 Result model, layout tokens | Haiku | Sonnet | shared surface (`tokens/**`): full suite |
| 6 Path tab + shared rail/header/export | Sonnet | Sonnet | sets the pattern; edits A1, A3 stage 2, A4 |
| 7 Risk + distribution tabs | Haiku | Sonnet | edit A2; escalate to Sonnet if the fit fails twice |
| 8 Valuation tab | Haiku | Sonnet | same escalation rule |
| 9 Correlation tab | Haiku | Sonnet | same escalation rule |
| 10 One-screen lock, ko check, cleanup | Sonnet | Sonnet | shared surface (`oneScreenRoutes.ts`): full suite |
| 11 Motion wiring (spec §8) | Haiku | Sonnet | motion-on spec only |
| 12 Gates, capture, records | controller | Opus final review | |

Playwright is one run at a time on this PC (ports 3101/8110). Kill leftover node and server processes before each run (memory `stopped-playwright-run-keeps-running`). No two tasks run Playwright in parallel; tasks here are sequential.

## Global Constraints

- **Height budget at 1280×720** (spec §1): page column 632 = header 76 + tab bar 53 + **tab panel 503**. Result area: header row ≈72 + gap 12 + **main chart area ≈419**. Charts fill the chart area (flex), minimum height 200px. Nothing is fixed at 320px any more.
- **Rail:** 320px wide (`var(--component-rail-width)`). Inputs scroll inside the rail; run/cancel stay pinned at its bottom. The rail's actions are rendered **once** in the DOM (no duplicate buttons for mobile), so `getByRole("button", { name: "Run Path Simulation" })` stays unique.
- **Below `lg` (1024px), including 390×844:** the rail is collapsed behind one toggle, `data-testid="mc-rail-toggle"`, label en "Inputs" / ko "입력", `aria-expanded="false"` by default. Run/cancel sit in the toggle row and are always visible. The figures row is a 2-column grid. The result area scrolls inside the panel; the page never scrolls. At 390 only "no page scroll" and "run button visible" are checked (spec §1).
- **Panel:** `min-h-0 flex-1`, and the panel itself is not a scroll container (an `overflow-auto` panel would hide the spec §5.1 `min-h-0` mutation, because a scroll container's automatic minimum height is 0). Scrolling happens in the rail inputs, the stats tables and, below `lg`, the result column.
- **Column class:** the page root is `mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col`, the same as `app/corporate/page.tsx:901` and `MarketOverviewClient.tsx:731`. The old wrapper `space-y-6 max-w-7xl mx-auto px-4 py-6` goes.
- **Tab state:** `useTabState<string>(tabStateKey("monteCarlo", "tab"), "path")`, key `moneyview.tab.monteCarlo.tab`. Only `"path" | "risk" | "distribution" | "valuation" | "correlation"` are honoured; anything else reads as `"path"`. The first render is always `"path"` (restore runs in an effect, same as other pages). Only the active panel is mounted.
- **Ids and names kept:** `Tabs idPrefix="simulation-"`, so the tabs stay `simulation-tab-<key>` and the panel `simulation-panel-<key>`. The tablist accessible name stays "Simulation workflows" (catalog `monteCarlo.tabs.aria`). Exactly one `role="tabpanel"` on the page: in-panel view switches use `ToggleGroup` (buttons with `aria-pressed`), never `Tabs`.
- **Tab labels and the title do not change:** en "Simulation Lab", "Path Simulation", "Risk Analysis", "Return Distribution", "Corporate Valuation", "Correlation Model"; ko as today. The subtitle becomes en "Path, risk, distribution, valuation and correlation simulations", ko "경로·위험·분포·가치평가·상관 시뮬레이션", truncated with an ellipsis if it overflows at 390.
- **English copy that survives keeps its exact current text** when it moves into the catalog (button labels, field labels, chart titles and descriptions, empty and invalid texts, the price-lookup messages). That is what keeps the inventory below small. Removed copy is deleted, and its catalog keys go with it (`monteCarlo.tabs.*Description`).
- **KRW formatter** `formatKrwCompact(value, locale)` (spec §3), in `app/monte-carlo/lib/krwFormat.ts` (D6):
  - en: `|v| ≥ 1,000,000` → `KRW 9.64M` (millions, 2 decimals); below → `KRW 950,000` (integer won).
  - ko: `|v| ≥ 10,000` → `964만원` (integer 만원); `≥ 1억` → `1억 2,345만원`; an exact 억 multiple → `1억원`, never `1억 0만원`; below 10,000 → `9,500원`.
  - Rounding is half away from zero (Intl default). The unit branch is chosen on the **rounded** value, so `99,995,000` (ko) is `1억원`, and `999,999.6` (en) is `KRW 1.00M`.
  - The sign goes first: `-KRW 9.64M`, `-964만원`. A value that rounds to zero prints without a sign (`KRW 0`, `0원`).
  - `null`, `undefined`, `NaN`, `±Infinity` → `—` (`MISSING`).
  - Pinned strings: en `9_640_000` → `KRW 9.64M`, `950_000` → `KRW 950,000`, `-9_640_000` → `-KRW 9.64M`; ko `9_640_000` → `964만원`, `123_450_000` → `1억 2,345만원`, `100_000_000` → `1억원`, `9_500` → `9,500원`, `-9_640_000` → `-964만원`; common `NaN` → `—`.
- **KRW axes:** en ticks are millions (`9.6`), ko ticks are 만원 (`964`). The axis title carries the unit: en "KRW M", ko "만원" (`monteCarlo.units.krwAxis`). Applies to the two path charts and the risk terminal-percentile chart. Chart data stays in won; only ticks and tooltips format it (shown value = used value).
- `krw()` (per-share price): en stays `KRW 50,000`. ko becomes `50,000원`. This is owner decision D8, 2026-10-17, and replaces spec §3's "unchanged". Task 8 implements it.
- **Run status per tab:** idle without result → "No analysis run yet"; loading → "Running" + progress `45%`; error → "Run failed"; cancelled → "Run canceled"; idle with a result → "Results ready". Risk and distribution show the **path** run's status. Correlation has a run button only, no cancel, and never shows "Run canceled".
- **Warnings and run errors** are banners under the result header on every tab. A banner with more than one warning starts collapsed (D9).
- **Motion:** only the #71 pieces (`Tabs`, `ScanReveal`, `RollingNumber`, `BeforeAfter`, the CSS hover nudge). No hand-rolled animation. recharts keeps its default `isAnimationActive` ("auto"). Tests run with reduced motion; only `monte-carlo-motion.spec.ts` sets `test.use({ contextOptions: { reducedMotion: "no-preference" } })`.
- **Tokens only** (CLAUDE.md §10). Two new tokens, proposed for approval at Task 0 (D4): `component.rail.width` 320px and `component.chart.min-height` 200px. Figures use `type-mono`/`type-figure-*` and `formatNumber`. `rounded-full` only on dots, tracks and fills, with its comment.
- **Korean copy** is in the formal register (합니다체). Korean strings with numbers or units go to the owner by eye in Task 12.
- **Tests:** every new test is mutation-checked (CLAUDE.md §8). Each task report names the mutation and the assertion that failed. Mutations on TS/Playwright: back the file up, edit, restore the original bytes and prove it with `cmp`. Never `git stash`, `checkout --` or `--no-verify`. No `waitForTimeout` in new tests; wait on conditions.
- **Worker mock:** new page tests use one helper, `tests/e2e/helpers/monteCarloWorkerMock.ts` (Task 1), not inline mocks. The four existing specs keep their inline mocks.

## Review Focus

1. **Amounts at unit edges:** ko `9,999.6` (rounds into 만원), `99,995,000` (rounds into `1억원`), an exact 억 multiple, negatives and values that round to zero. A wrong edge misreads money by 10× or 100×, which is the bug this plan fixes. Pinned in Task 2 (`monte-carlo-model.spec.ts`).
2. **A stored tab value that is not a tab** (`"bogus"`, `"constructor"`, `"__proto__"`, a non-JSON string, a number) must open Path, not a blank panel. Pinned in Task 4 (model test plus a reload test).
3. **Risk or Distribution opened before a path run, while one is running, or after one failed:** never figures computed from nothing. No result and not running → the "run first" prompt and a button to Path; running → the running status and progress; failed with an older result → that result under "Run failed". Pinned in Task 7.
4. **A run superseded by another tab's run** (path running, then Run Valuation): the path status must leave "Running", and its Run button must be enabled again. Today it stays "loading" forever (see D3). Pinned in Task 3.
5. **A long rail scrolled to its end, and the collapsed rail at 390:** Run must stay visible and clickable in both. Path has 8 fields, valuation 11 plus the lookup message, correlation a 4×4 matrix. Pinned in Task 6 (path) and Task 9 (correlation matrix fit).

## Existing-test inventory (Task 0, owner approval required)

Checked at d6dc92d (this branch's HEAD). Line numbers are for `apps/web/tests/e2e/`. Nothing below is edited before the owner approves it.

### A. Assertions that change

| # | File:line | Old | New | Why | Applied in |
|---|---|---|---|---|---|
| A1 | `monte-carlo-chart-guard.spec.ts:86-88` (insert before :87) | `getByText(/Dropped invalid percentile-cone row 1\./)` and `/Dropped invalid histogram row 2\./` visible straight after the run | first `await page.getByTestId("mc-warnings-toggle").click();` then the same two assertions, unchanged. :86 (the title) is unchanged: the collapsed banner's summary still reads "Path output normalization warnings". | Spec §1: a long warning banner starts collapsed. This mock yields 5+ warnings. | Task 6 |
| A2 | `monte-carlo-chart-guard.spec.ts:94` (insert before) | `getByRole("heading", { name: "Terminal Value Percentiles" })` visible on opening Risk | first `await page.getByRole("group", { name: "Risk chart" }).getByRole("button", { name: "Percentiles" }).click();` then the same assertion. :93 (VaR / CVaR heading) is unchanged: it is the default view. | Spec §2: the risk chart area is a view switch (VaR/CVaR distribution \| terminal percentiles), so only one chart is visible at a time. | Task 7 |
| A3 | `monte-carlo-chart-guard.spec.ts:107-108` | comment "shown in 10,000 KRW units" and `getByText("1,000 M KRW").first()` visible before any run | **Stage 1 (Task 2):** comment "shown in 만원"; `getByText("1,000만원").first()` visible. **Stage 2 (Task 6):** `await page.getByRole("button", { name: "경로 시뮬레이션 실행" }).click();` then `await expect(page.getByTestId("mc-figure-median-value")).toHaveText(/^-?(\d{1,3}(,\d{3})*억( \d{1,3}(,\d{3})*만원|원)|\d{1,3}(,\d{3})*(만원|원))$/);` | Spec §3 unit fix. In stage 2 no pre-run figure exists any more (D1: figures read `—` before a run), so the Korean figure is checked after a real run (default inputs, seed 42). The regex accepts only the ko compact forms, so `M KRW` or a raw won number fails it. | Task 2, Task 6 |
| A4 | `responsive-accessibility.spec.ts:102` (insert before) | `getByLabel("Initial investment")` visible at 375×812 | first `await page.getByTestId("mc-rail-toggle").click();` then the same assertion. | Spec §1: below `lg` the rail starts collapsed. | Task 6 |

### B. Assertions checked and kept, and the constraint that keeps them

The implementer must not break these; the Global Constraint in the right column is what holds each one.

| File:line | Assertion | Kept by |
|---|---|---|
| `monte-carlo-chart-guard.spec.ts:82`, `monte-carlo-path-colour.spec.ts:69`, `simulation-lab-price-autofill.spec.ts:5,34`, `responsive-accessibility.spec.ts:98` | heading "Simulation Lab" | title unchanged |
| `monte-carlo-chart-guard.spec.ts:106` | heading "시뮬레이션 랩" (ko) | title unchanged |
| `monte-carlo-chart-guard.spec.ts:84`, `monte-carlo-path-colour.spec.ts:70`, `simulation-lab-price-autofill.spec.ts:36` | button "Run Path Simulation" | en label kept; the `→` nudge cell is `aria-hidden`; actions rendered once |
| `monte-carlo-chart-guard.spec.ts:89-90` | "Path chart data is invalid", "Percentile-cone data is invalid" | ChartGuard invalid titles kept |
| `monte-carlo-chart-guard.spec.ts:92,96`, `simulation-lab-price-autofill.spec.ts:6,49,64`, `responsive-accessibility.spec.ts:100,128,130-131` | tabs by name `/Risk Analysis/`, `/Return Distribution/`, `/Corporate Valuation/`, `/Correlation Model/`, `/Path Simulation/` and their `aria-selected` | tab labels unchanged; shared `Tabs` sets `aria-selected` |
| `monte-carlo-chart-guard.spec.ts:93,97,98` | headings "VaR / CVaR Risk Distribution", "Return Histogram with Fitted Normal Curve"; "CDF comparison data is invalid" | chart titles kept; VaR is the default risk view; distribution charts sit side by side |
| `monte-carlo-chart-guard.spec.ts:109-110` | ko tab `/상관관계 모형/`; columnheader "자산" | tab label kept; the asset table moves into the rail with its `BilingualLabel` header |
| `monte-carlo-path-colour.spec.ts:73-76` | 6 `path.recharts-line-curve[stroke-opacity="0.5"]`, all `var(--chart-1)` | sampled-path lines unchanged; no other half-opacity line is added |
| `simulation-lab-price-autofill.spec.ts:7,55,60,92-93,144-145,175-176,250-253` | `getByLabel("Ticker")` | label "Ticker" kept; the lookup message is a sibling under the field, not inside another label |
| `simulation-lab-price-autofill.spec.ts:96,148,150,179,256,263` | `getByLabel("Current stock price")` values | label kept; lookup still writes the field |
| `simulation-lab-price-autofill.spec.ts:35,50,65` | "No analysis run yet" | en idle status label |
| `simulation-lab-price-autofill.spec.ts:51,66` | the valuation and correlation empty-state sentences | kept as the chart-area empty text |
| `simulation-lab-price-autofill.spec.ts:61,95,149,255,264`, `:178` | "`<TICKER>` price loaded from cache.", "Ticker not found." | catalog templates with the same en text |
| `simulation-lab-price-autofill.spec.ts:147` | the server `detail_note` "No cached price was available, …" | D2: the API's `detail_note` is still shown when present |
| `simulation-lab-price-autofill.spec.ts:67` | button "Run Correlation Analysis" | en label kept |
| `responsive-accessibility.spec.ts:99,127` | tablist "Simulation workflows" | `monteCarlo.tabs.aria` |
| `responsive-accessibility.spec.ts:101,132` | the one `tabpanel`; `aria-labelledby="simulation-tab-valuation"` | one tabpanel; `idPrefix="simulation-"` |
| `responsive-accessibility.spec.ts:103` | no horizontal overflow at 375 | Tabs get `[contain:inline-size]` like `MarketPageTabs` |
| `one-screen-no-scroll.spec.ts:13,43` | every one-screen route has a `DESIGN_SCREENS` mock; it does not scroll | Task 10 adds both; not an edit, `/monte-carlo` joins automatically |
| `paper-sweep.spec.ts:23`, `design-capture.spec.ts:62` | loop over `DESIGN_SCREENS` | `/monte-carlo` joins automatically; a sweep failure is fixed in code, never in the test |
| `i18n-model.spec.ts:32-40` | every en key has a non-empty ko string | covers the new keys automatically |
| `cases.spec.ts:311-315` | the cases simulate section is not called "Monte Carlo" | unrelated (cases page) |

Searched at d6dc92d: every spec for `monte-carlo`, `Monte`, `Simulation`, `M KRW`, `10,000 KRW`, `simulation-tab-`, `simulation-panel-`, `monteCarlo`, and each removed string ("Simulation Setup", "Path Simulation Summary", "Risk Analysis Summary", "Return Distribution Summary", "Corporate Valuation Summary", "Correlation Model Summary", the `Export … CSV` button labels, "Execution mode:", the five tab descriptions, "Recovered data warnings"). No other hit. If an implementer finds one, they stop and add it here for approval.

---

### Task 0: Owner gate

- [ ] **Step 1:** Show the owner the inventory (A1–A4, and table B for information) and decisions D1–D9 below. Record "approved" with the date, and each decision's answer, in `.superpowers/sdd/2026-10-17-monte-carlo-one-screen/progress.md`. No listed test is edited before this.
- [ ] **Step 2:** PR #71 is merged (the owner runs it). `git fetch`, then rebase `feat/monte-carlo-one-screen` onto `origin/renewal`. Re-check the A-table line numbers after the rebase (they are test files #71 does not touch; a moved line is re-recorded, not re-approved).

**Decisions the spec does not settle** (recommendation first):

| # | Question | Recommendation |
|---|---|---|
| D1 | What the figures row shows before a run | `—` for every figure. Today the path cards show the principal as "median terminal" before any run, which is a number nobody computed. |
| D2 | The price-lookup `detail_note` (English text from the API) | Keep showing it when the API sends one; catalog text otherwise. It is API data, like a company name. Keeps `simulation-lab-price-autofill.spec.ts:147`. |
| D3 | Starting a run while another tab's run is in flight leaves the first tab "loading" forever (`page.tsx:429-431, 452-455, 474-477` cancel the old job but never reset its status; the old Run button stays disabled, and its Cancel then cancels the *new* job) | Fix it here (Task 3) and record it in `ERROR-LOG.md`. The spec's "path status on risk/distribution" makes the stuck state visible on three tabs. |
| D4 | New tokens `component.rail.width` 320px, `component.chart.min-height` 200px | Approve (CLAUDE.md §10 requires the proposal). |
| D5 | Normalization warnings are English strings built in `lib/resultNormalization.ts` (out of scope) | Leave English in ko for now; log a todo follow-up. |
| D6 | Where `formatKrwCompact` lives | `app/monte-carlo/lib/krwFormat.ts`, built on `formatNumber`. `lib/format.ts` is a shared surface with no second user yet; promote it when one appears. |
| D7 | `ScanReveal` needs a `bodyClassName` prop so a revealed panel can fill height | Approve the additive prop (default: same DOM as now). |
| D8 | ko shows `KRW 50,000` (per-share `krw()`, spec keeps it) beside `41,200–58,900원` (spec §2 interval) | **Owner, 2026-10-17: ko per-share also `50,000원`.** en stays `KRW 50,000`. Task 8 changes `krw()` to take the locale and pins both locales in the model spec. |
| D9 | When a warning banner counts as "long" | More than one warning: collapsed, with a "show N" toggle. |

### Task 1: Risk-tab empty charts (spec §5.3)

The spec's capture showed both risk charts empty 800ms after the tab switch. Find out whether that is animation timing or a defect.

**Files:**
- Create: `tests/e2e/helpers/monteCarloWorkerMock.ts`
- Create: `tests/e2e/monte-carlo-one-screen.spec.ts` (first describe, "risk charts draw")
- Modify only if a defect is found: `components/charts/HistogramPanel.tsx` and/or `components/charts/PercentileBandPanel.tsx` (only Monte Carlo uses them, checked at HEAD), `ERROR-LOG.md`

**Interfaces:**
- `installMonteCarloWorker(page: Page, options?: { path?: PathFixture[]; valuation?: unknown; correlation?: unknown; hold?: boolean; progress?: number }): Promise<void>`
  - Replaces `window.Worker` through `addInitScript`, as the existing specs do.
  - `run-path` answers with `path[n]` on the n-th call (the last entry repeats), so a re-run can return different numbers (Task 11). `run-valuation` and `run-correlation` answer with their fixture.
  - `progress` (default 50) is posted first. With `hold: true` the result is not sent until the page calls `window.__mcRelease()`; `cancel` messages are recorded on `window.__mcCancelled: string[]`.
  - Exports `PATH_FIXTURE` (6 times, 6 valid sample paths, terminal `p50` = 9,640,000, risk metrics as in `monte-carlo-path-colour.spec.ts`, a 6-bin histogram with 3 loss bins, a 6-row normal fit and CDF), `VALUATION_FIXTURE` (current price 50,000; p10 41,200; p90 58,900; 10-bin distribution) and `CORRELATION_FIXTURE` (4 assets, 20 frontier points with one optimal, 4 sensitivity rows, 16 heatmap cells).
  - Side effects: none outside the page.

- [ ] **Step 1:** Write the test "both risk charts draw their bars after a path run" (reduced motion, the default): install the worker, open `/monte-carlo`, run, open Risk. Wait until `.recharts-bar-rectangle` count is ≥ 6 in the VaR/CVaR panel and ≥ 7 in the percentile panel, and every bar's bounding box has height > 0. Locate each panel by its heading (`VaR / CVaR Risk Distribution`, `Terminal Value Percentiles`); both are visible in the current layout.
- [ ] **Step 2:** Run it at HEAD (`npx playwright test tests/e2e/monte-carlo-one-screen.spec.ts`).
  - **Passes:** the capture was animation timing. Record "timing, not a defect" with the evidence in the progress ledger. Keep the test as a guard; its Task 7 version locates the percentile chart through the view switch.
  - **Fails:** a defect. Root-cause before fixing (`superpowers:systematic-debugging`). Candidates to rule in or out, in order: `PercentileBandPanel`'s chart box is `flex-grow` with only `minHeight`, inside a `section` whose height is not definite, so `ResponsiveChart`'s `h-full` may measure 0; the histogram's category X axis versus the numeric `ReferenceLine x`; `ResponsiveChart` measuring before the grid cell has a width.
- [ ] **Step 3 (defect only):** Fix the root cause, run the test green, and add an `ERROR-LOG.md` record (Date, Command, Failure, Root cause, Fix, Files changed, Prevention: this test).
- [ ] **Step 4:** Mutation check (both outcomes): make the percentile chart's container `height: 0` → the test fails on the bar height. If a fix was made, also revert the fix → the test fails.
- [ ] **Step 5:** Commit: `test(web): risk charts draw after a path run` (or `fix(web): …` with the root cause in the subject).

### Task 2: KRW formatter, axis units, ERROR-LOG

**Files:**
- Create: `app/monte-carlo/lib/krwFormat.ts`
- Modify: `app/monte-carlo/components/shared.tsx` (delete `krwTenThousands` and `TEN_THOUSAND_KRW`; `krwLossFromPercent` calls `formatKrwCompact`), `PathSimulationSection.tsx` (Y ticks, tooltips, every `krwTenThousands` call, the "in 10,000 KRW units" detail), `RiskAnalysisSection.tsx` (the `:109-115` division, `:129` `valueLabel="M KRW"`, the `:74` and `:107` "10,000 KRW" copy), `components/charts/PercentileBandPanel.tsx` (new optional `yTickFormatter`, `yAxisLabel`)
- Modify: `lib/i18n/messages/{en,ko}.ts` (`monteCarlo.units.krwAxis`: en "KRW M", ko "만원"; `monteCarlo.units.terminalValue`: en "Terminal value", ko "만기 가치")
- Modify (approved A3 stage 1): `tests/e2e/monte-carlo-chart-guard.spec.ts:107-108`
- Modify: `ERROR-LOG.md`
- Test: `tests/e2e/monte-carlo-model.spec.ts` (new, pure) and a describe in `monte-carlo-one-screen.spec.ts`

**Output contract:**

| name | signature | returns | units/format | cases | example | side effects |
|---|---|---|---|---|---|---|
| `formatKrwCompact` | `(value: number \| null \| undefined, locale: FormatLocale): string` | string | Global Constraints "KRW formatter" | normal: as pinned; empty: n/a; missing/NaN/±Infinity → `—`; zero or rounds to zero → `KRW 0` / `0원` (no sign); error: never throws | `(123_450_000, "ko")` → `1억 2,345만원` | none |
| `krwAxis` | `(locale: FormatLocale): { divisor: 1_000_000 \| 10_000; tick: (won: number) => string; unitKey: "monteCarlo.units.krwAxis" }` | object | en: `formatNumber(won / 1e6, "ratio", { digits: 1 })`; ko: `formatNumber(Math.round(won / 1e4), "integer")` | non-finite tick → `—` | `krwAxis("en").tick(9_640_000)` → `9.6`; `krwAxis("ko").tick(9_640_000)` → `964` | none |
| `PercentileBandPanel` (changed) | new props `yTickFormatter?: (v: number) => string`, `yAxisLabel?: string` | JSX | when absent, renders exactly as today | — | the risk chart passes `krwAxis(locale).tick` and `t("monteCarlo.units.krwAxis")` | the Y axis shows a `label` with the unit |
| `krwLossFromPercent` (changed) | `(principal: number, lossPercent: number, locale: FormatLocale): string` | string | `formatKrwCompact(principal * lossPercent / 100, locale)` | non-finite → `—` | `(10_000_000, 6, "en")` → `KRW 600,000` | none |

The risk percentile chart's data becomes won values (no division); its tooltip is `t("monteCarlo.units.terminalValue")`: `formatKrwCompact(v)`.

- [ ] **Step 1:** Write `monte-carlo-model.spec.ts`:
  - every pinned string from Global Constraints (en 3, ko 5, `NaN`);
  - edges: ko `9_999.6` → `1만원`; ko `99_995_000` → `1억원`; en `999_999.6` → `KRW 1.00M`; en `0` → `KRW 0`; ko `-0.4` → `0원`; ko `1_234_567_890_000` → `12,345억 6,789만원`; `Infinity`, `null`, `undefined` → `—`;
  - `krwAxis` ticks as in the table, and `krwAxis("en").tick(NaN)` → `—`.
  - In `monte-carlo-one-screen.spec.ts`: after a mocked path run, the median figure reads `KRW 9.64M` (en) and `964만원` (ko, `test.use({ locale: "ko-KR" })`); the path chart's Y axis has a label "KRW M" / "만원".
- [ ] **Step 2:** Run both specs. Expect FAIL (import error; `964 M KRW` on the page).
- [ ] **Step 3:** Implement. Apply edit A3 stage 1.
- [ ] **Step 4:** Run the two new specs and the area specs (`monte-carlo-chart-guard`, `monte-carlo-path-colour`, `simulation-lab-price-autofill`, `responsive-accessibility`), then `npm run typecheck` and `npm run lint`. Expect PASS.
- [ ] **Step 5:** Mutation check, one at a time: the old `÷10,000 + " M KRW"`; the 억 branch removed; the `원` branch below 10,000 removed; the sign after the prefix (`KRW -9.64M`); the unit branch chosen on the unrounded value; `Math.floor` instead of rounding.
- [ ] **Step 6:** `ERROR-LOG.md` record: symptom `964 M KRW` for 9,640,000 won, which reads as 964 million (9억 6,400만 원), 100× the real amount; root cause `krwTenThousands` divided by 10,000 and labelled the result "M KRW", and the risk chart hard-coded `valueLabel="M KRW"`; fix: the commit below (its SHA is filled in at Task 12); prevention: `monte-carlo-model.spec.ts` pins the en and ko strings. Commit: `fix(web): Monte Carlo KRW amounts read as 9.64M / 964만원, not 964 M KRW`.

### Task 3: Superseded-run status (only if D3 is approved)

**Files:**
- Modify: `app/monte-carlo/page.tsx` (`runPathSimulation`, `runValuationSimulation`, `runCorrelationSimulation`; one helper)
- Modify: `ERROR-LOG.md`
- Test: `monte-carlo-one-screen.spec.ts` (describe "superseded run")

**Output contract:**

| name | signature | returns | cases | side effects |
|---|---|---|---|---|
| `supersedeActiveRun` (in `page.tsx`) | `(): void` | void | no active request → no-op; active `path` → posts `cancel`, `completeWorkerEvent("canceled", …)`, `setStatus("cancelled")`, `setProgress(0)`; active `valuation` → same with the valuation setters; active `correlation` → `setCorrelationStatus("idle")`, `setCorrelationProgress(0)` (correlation never shows "canceled", spec §1) | worker `cancel` message; status/progress state; one perf event |

The three `run*` functions call it in place of their inline cancel blocks (`page.tsx:429-432, 452-455, 474-477`).

- [ ] **Step 1:** Test with `installMonteCarloWorker(page, { hold: true })`: Run Path; open Corporate Valuation; Run Valuation; open Path. Expect the status text "Run canceled", the progress bar gone, and the "Run Path Simulation" button enabled. Second case: hold, Run Valuation, open Correlation, Run Correlation, open Valuation: "Run canceled", Run Valuation enabled. Third: hold, Run Correlation, open Path, Run Path, open Correlation: "No analysis run yet", never "Run canceled".
- [ ] **Step 2:** Run it at HEAD. Expect FAIL (path stays "Running", the button disabled). This is the old layout; locate status by text, not by the Task 5 testids.
- [ ] **Step 3:** Implement. **Step 4:** Run the test and the area specs; `typecheck`; `lint`.
- [ ] **Step 5:** Mutation check: drop the path branch's `setStatus`; set correlation to `"cancelled"`.
- [ ] **Step 6:** `ERROR-LOG.md` record (symptom, root cause, fix, prevention: this test). Commit: `fix(web): a superseded Monte Carlo run leaves its tab cancelled, not running forever`.

### Task 4: Page frame: header, Tabs, tab state

**Files:**
- Create: `app/monte-carlo/lib/tabs.ts`
- Modify: `app/monte-carlo/page.tsx` (root column, header, tabs, panel), `app/monte-carlo/components/shared.tsx` and `components/index.ts` (delete `TabButton`)
- Modify: `components/ui/ScanReveal.tsx` (D7: `bodyClassName?: string` on the inner body `div`)
- Modify: `lib/i18n/messages/{en,ko}.ts`: `monteCarlo.subtitle` (spec strings), add `monteCarlo.tabs.aria` (en "Simulation workflows", ko "시뮬레이션 작업"), delete the five `monteCarlo.tabs.*Description`
- Test: `monte-carlo-model.spec.ts` (append), `monte-carlo-one-screen.spec.ts` (describe "frame")

**Output contract:**

| name | signature | returns | cases | example | side effects |
|---|---|---|---|---|---|
| `MONTE_CARLO_TABS` | `readonly ["path","risk","distribution","valuation","correlation"]` | tuple, display order | — | — | none |
| `MONTE_CARLO_TAB_KEY` | `string` | `"moneyview.tab.monteCarlo.tab"` (`tabStateKey("monteCarlo","tab")`) | — | — | none |
| `isMonteCarloTab` | `(value: unknown): value is MonteCarloTab` | boolean | the five → true; `"bogus"`, `"constructor"`, `"__proto__"`, `""`, `1`, `null`, `undefined` → false; never throws | `"risk"` → true | none |
| page tab | `const [stored, setStored] = useTabState<string>(MONTE_CARLO_TAB_KEY, "path"); const activeTab = isMonteCarloTab(stored) ? stored : "path";` | — | non-JSON storage → `readTabState` returns null → `"path"` | — | writes sessionStorage on change |
| header | `<PageHeader title={t("monteCarlo.title")} subtitle={<span className="block truncate">{t("monteCarlo.subtitle")}</span>} />` | h1 "Simulation Lab" | no eyebrow | — | — |
| tabs | `<Tabs ariaLabel={t("monteCarlo.tabs.aria")} idPrefix="simulation-" className="shrink-0 [contain:inline-size]" items={MONTE_CARLO_TABS.map(k => ({ key: k, label: t(`monteCarlo.tabs.${k}`) }))} activeKey={activeTab} onChange={k => isMonteCarloTab(k) && setStored(k)} />` | tablist | arrow keys from `Tabs` | — | — |
| panel | `<section role="tabpanel" id={`simulation-panel-${activeTab}`} aria-labelledby={`simulation-tab-${activeTab}`} data-testid="mc-panel" className="flex min-h-0 flex-1 flex-col"><ScanReveal trigger={activeTab} className="flex min-h-0 flex-1 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col">…` | — | only the active section mounts | — | — |
| `ScanReveal` (changed) | `bodyClassName?: string` | — | undefined → the body `div` has no class (DOM as today) | — | — |

In this task the old section bodies render unchanged inside the new panel, so the panel is temporarily taller than 503px. `/monte-carlo` joins `ONE_SCREEN_ROUTES` only in Task 10, once every tab fits.

- [ ] **Step 1:** Tests:
  - model: `isMonteCarloTab` for every case in the table;
  - "the chosen tab survives a reload": click Return Distribution, reload, it is `aria-selected` and `sessionStorage["moneyview.tab.monteCarlo.tab"] === '"distribution"'`;
  - "an unknown stored tab opens Path": `addInitScript` sets the key to `'"bogus"'`, then to `'"constructor"'`, then to `'not json'`; each load shows Path selected and its run button;
  - "the header is one title and one subtitle line": no eyebrow element in the header, the subtitle text equals the new en string, and at 390×844 the subtitle box height equals one line (`clientHeight ≤ lineHeight + 1`) with `scrollWidth ≥ clientWidth` allowed (truncated).
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. **Step 4:** Run the new tests and the area specs, plus `tabs-keyboard`, `tab-state-persistence`, `motion` (ScanReveal), then the **full suite** (`components/ui/ScanReveal.tsx` is a shared surface). `typecheck`, `lint`.
- [ ] **Step 5:** Mutation check: the key `tabStateKey("monteCarlo", "page")`; the guard removed (`activeTab = stored as MonteCarloTab`); `bodyClassName` ignored by `ScanReveal` (no test should fail on this one alone — it is caught in Task 6's chart-fit test; say so in the report).
- [ ] **Step 6:** Commit: `feat(web): Monte Carlo page frame — one-line header, shared tabs, remembered tab`.

### Task 5: Result model and layout tokens

**Files:**
- Create: `app/monte-carlo/lib/resultModel.ts`
- Modify: `tokens/moneyview.tokens.json` (D4), then `npm run tokens`
- Modify: `lib/i18n/messages/{en,ko}.ts`: `monteCarlo.status.{empty,running,failed,cancelled,ready}`
- Test: `monte-carlo-model.spec.ts` (append)

**Output contract:**

| name | signature | returns | cases | example | side effects |
|---|---|---|---|---|---|
| `runStatusView` | `(status: RunStatus, progress: number, hasResult: boolean): RunStatusView` where `RunStatus = "idle" \| "loading" \| "error" \| "cancelled"` and `RunStatusView = { state: "empty" \| "running" \| "failed" \| "cancelled" \| "ready"; labelKey: MessageKey; progress: number \| null }` | object | `loading` → `running`, progress `Math.round` clamped to 0..100 (NaN → 0); `error` → `failed`; `cancelled` → `cancelled`; `idle` + result → `ready`; `idle` + none → `empty`; progress is `null` unless running | `("loading", 45.6, false)` → `{ state: "running", labelKey: "monteCarlo.status.running", progress: 46 }` | none |
| `beforeText` | `(previous: number \| null \| undefined, current: number \| null, format: (n: number) => string): string \| null` | the previous figure's text, or null | previous or current not finite → null; `format(previous) === format(current)` → null; else `format(previous)` | `(9_640_000, 9_800_000, n => formatKrwCompact(n, "en"))` → `"KRW 9.64M"` | none |
| token `component.rail.width` | `320px` → `--component-rail-width` | — | — | — | generated CSS/TS/doc table |
| token `component.chart.min-height` | `200px` → `--component-chart-min-height` | — | — | — | same |

Status labels: en "No analysis run yet", "Running", "Run failed", "Run canceled", "Results ready"; ko "아직 실행하지 않았습니다", "실행 중", "실행 실패", "실행 취소됨", "결과 있음".

- [ ] **Step 1:** Model tests for every case above (including progress −5 → 0, 130 → 100, NaN → 0, and `beforeText` equal-text → null).
- [ ] **Step 2:** Run. FAIL. **Step 3:** Implement; add the tokens; `npm run tokens`; `npm run tokens:check`.
- [ ] **Step 4:** Run the model spec, `typecheck`, `lint`, then the **full suite** (`tokens/**` is a shared surface).
- [ ] **Step 5:** Mutation check: `idle` + result mapped to `empty`; progress not clamped; `beforeText` returning text for equal strings.
- [ ] **Step 6:** Commit: `feat(web): Monte Carlo run-status model and rail/chart size tokens`.

### Task 6: Path tab, with the shared rail, result header and export menu

The pattern for Tasks 7–9. Judgment-heavy: fitting 503px.

**Files:**
- Create in `app/monte-carlo/components/`: `SimulationRail.tsx`, `ResultHeader.tsx`, `ExportMenu.tsx`, `WarningBanner.tsx`, `RunButton.tsx`
- Modify: `PathSimulationSection.tsx` (rewrite into rail + result area), `ChartGuard.tsx` (fill mode), `shared.tsx` (`NumericField` gains an optional `help?: string`; delete `PercentileIndicator`), `page.tsx` (pass `t`-free data; exports as items)
- Modify: `lib/i18n/messages/{en,ko}.ts`: `monteCarlo.rail.inputs`, `monteCarlo.export.{button,…}`, `monteCarlo.warnings.{show}`, and every path-tab string under `monteCarlo.path.*` (fields, execution-mode help, figures, hints, chart titles/descriptions/empty/invalid, legend)
- Modify (approved A1, A3 stage 2, A4): `monte-carlo-chart-guard.spec.ts:87,107-108`, `responsive-accessibility.spec.ts:102`
- Test: `monte-carlo-one-screen.spec.ts` (describe "path")

**Output contract:**

| name | signature | returns / DOM | cases | side effects |
|---|---|---|---|---|
| `SimulationRail` | `({ children, actions }: { children: ReactNode; actions: ReactNode })` | `<aside data-testid="mc-rail">` width `var(--component-rail-width)` at `lg`; `<div data-testid="mc-rail-inputs">` (`min-h-0 flex-1 overflow-auto`); `<div data-testid="mc-rail-actions">` (`shrink-0`, below the inputs); below `lg`, a row with `<button data-testid="mc-rail-toggle" aria-expanded aria-controls>` "Inputs" and the actions, inputs hidden until expanded | `actions` rendered once; collapsed by default below `lg` | local `expanded` state |
| `ResultHeader` | `({ status, figures, exports, source?, prompt? }: { status: RunStatusView; figures: ResultFigure[]; exports: ExportItem[]; source?: { label: string; openLabel: string; onOpen: () => void }; prompt?: { text: string; actionLabel: string; onAction: () => void } })` with `ResultFigure = { key: string; label: string; value: number \| null; format: (n: number) => string; hint?: string; previous?: string \| null }`, `ExportItem = { key: string; label: string; onSelect: () => void }` | `data-testid="mc-result-header"`; status `<span data-testid="mc-status" data-state={state}>` label, plus `<span data-testid="mc-status-progress">46%</span>` when running; each figure `<div data-testid="mc-figure-{key}" title={hint}>` caption label + `<RollingNumber testId="mc-figure-{key}-value" value format enter />` (wrapped in `BeforeAfter` when `previous` is set — wired in Task 11); `ExportMenu` at the right; `source` renders a one-line note with a link-style button `mc-source-open`; `prompt` replaces the figures with `<p data-testid="mc-run-prompt">` and `<button data-testid="mc-run-prompt-open">` | value null → `—`; no figures → no figure row; `prompt` wins over `figures` | none |
| `ExportMenu` | `({ items }: { items: ExportItem[] })` | `<button data-testid="mc-export" aria-haspopup="menu" aria-expanded>` "Export"; open → `<div role="menu">` with `<button role="menuitem" data-testid="mc-export-{key}">` | `items` empty → the button is disabled; Escape or an outside click closes; selecting an item calls `onSelect` and closes | download via the page's `downloadCsv` (unchanged) |
| `WarningBanner` | `({ title, warnings }: { title: string; warnings: string[] })` | `data-testid="mc-warnings"`; one warning → title + the line; more → title + count and `<button data-testid="mc-warnings-toggle" aria-expanded="false">`, lines hidden until expanded | `[]` → renders nothing | local state |
| `RunButton` | `({ label, onClick, running, testId }: { label: string; onClick: () => void; running: boolean; testId: string })` | brand button, `disabled` while running, spinner while running, then the label, then `<span aria-hidden="true">→</span>` that moves 4px on `group-hover`/`group-focus-visible` (`[transition:transform_var(--duration-normal)]`, `motion-reduce:transition-none`) | — | none |
| `ChartGuard` (changed) | `chartHeight?: number \| "fill"` (default 320, so other callers are unchanged) | `"fill"`: the frame is `flex h-full flex-col` and the chart box `min-h-[var(--component-chart-min-height)] flex-1` | — | — |

**Path tab content** (spec §2):
- Rail: the 8 current fields in their current order and labels; the execution-mode select gets the help line (the old helper box's two sentences, plus the promotion note when it applies). `riskFreeRate` and `seed` stay hidden. Actions: `RunButton` "Run Path Simulation" (`mc-run-path`) and Cancel (`mc-cancel-path`).
- Figures: `median` (terminal p50, `formatKrwCompact`), `expectedReturn` (`pct`), `lossProbability` (`pct`), `sharpe` (`numberText`, hint keeps "Annualized Sharpe with rf = 3.00%"). Before a run every value is `null` (D1). Hints carry the old card details (unit phrase already gone in Task 2).
- Exports (when a result exists): `summary` "Export Summary CSV", `cone` "Export Cone CSV", `paths` "Export Paths CSV", `histogram` "Export Histogram CSV" → the same four handlers.
- Banners under the header: run error (`errorMessage ?? "Worker simulation failed."`), cancelled note, then `WarningBanner` titled "Path output normalization warnings".
- Chart area: the two charts side by side (`grid lg:grid-cols-2`, each `ChartGuard chartHeight="fill"`). The cone legend absorbs the four percentile cards: each legend item is `label · lo–hi` with `formatKrwCompact`, e.g. `5%-95% · KRW 8.90M–KRW 12.30M`; Median shows one value. Before a run each chart shows its empty state.
- Deleted: the helper box, `MonteCarloTabSummary` use, the metric and percentile cards, "Simulation Setup".

- [ ] **Step 1:** Tests (1280×720 unless stated; `installMonteCarloWorker`):
  - **fits after a run:** after a run, `mc-result-header` and both chart frames (`ChartGuard` sections) have `bottom ≤ mc-panel.bottom + 1`, and each chart's `.recharts-surface` height ≥ 200.
  - **actions pinned:** `mc-rail-inputs` has `scrollHeight > clientHeight` (precondition, so the test is not vacuous). Record `mc-run-path`'s box; scroll the inputs to the end; the box is identical and inside the viewport.
  - **figures:** before a run every `mc-figure-*-value` reads `—` and `mc-status` reads "No analysis run yet"; after it, `mc-figure-median-value` reads `KRW 9.64M` and `mc-status` has `data-state="ready"`.
  - **running state:** with `hold: true`, `mc-status-progress` reads `50%` and `mc-cancel-path` is enabled; Cancel → "Run canceled".
  - **export:** for each of the four items, `page.waitForEvent("download")` after clicking `mc-export` then `mc-export-{key}` gives `summary.csv`, `percentile_cone.csv`, `sample_paths.csv`, `terminal_distribution.csv`. Before a run `mc-export` is disabled.
  - **legend ranges:** the cone legend contains `KRW` ranges with an en dash.
  - **warnings:** with the degraded fixture from `monte-carlo-chart-guard.spec.ts`, `mc-warnings-toggle` exists, the lines are hidden, and one click shows them.
  - **390×844:** `mc-rail-toggle` is `aria-expanded="false"`, `mc-run-path` is visible, the page does not scroll (`expectNoPageScroll`), and after expanding, "Initial investment" is visible.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. Apply A1, A3 stage 2, A4. Fit tuning stays inside tokens (spacing `--space-*`, type scale); if 503px cannot hold the header row plus two 200px charts, stop and report with a capture rather than shrinking type below the scale.
- [ ] **Step 4:** Run the path describe, the area specs (`monte-carlo-*`, `simulation-lab-price-autofill`, `responsive-accessibility`, `paper-sweep` is not yet covering the route), `typecheck`, `lint`, `npm run design:baseline` (no new hits in `app/monte-carlo/**`).
- [ ] **Step 5:** Mutation check, one per test: chart height back to a fixed 320 (fits test); actions moved inside `mc-rail-inputs` (pinned test); `exportSummaryCsv` filename `summary-v2.csv` (export test); `enter` figures given the principal before a run (figures test); the toggle default `expanded=true` (390 test); the warning collapse threshold 10 (warnings test).
- [ ] **Step 6:** Commit: `feat(web): Monte Carlo path tab on one screen — input rail, figures row, export menu`.

### Task 7: Risk and distribution tabs

**Files:**
- Modify: `RiskAnalysisSection.tsx`, `ReturnDistributionSection.tsx`, `components/charts/HistogramPanel.tsx` (`height?: number \| "fill"`), `PercentileBandPanel.tsx` (same), `page.tsx` (pass path status/progress and `onOpenPath={() => setStored("path")}`)
- Modify: catalogs `monteCarlo.risk.*`, `monteCarlo.distribution.*`, `monteCarlo.shared.{basedOnPath, openPath, runFirst}`
- Modify (approved A2): `monte-carlo-chart-guard.spec.ts:94`; Task 1's test switches to the view toggle
- Test: `monte-carlo-one-screen.spec.ts` (describe "risk and distribution")

**Content** (spec §2):
- No rail. `ResultHeader` gets `source` = "Based on Path tab inputs" / "Open Path tab" (ko "경로 탭 입력 기준" / "경로 탭 열기") and the **path** `runStatusView`.
- No result: if the path status is not `running`, `prompt` = en "Run the path simulation on the Path tab first." / ko "경로 탭에서 먼저 시뮬레이션을 실행하십시오.", action "Open Path tab" → selects Path. If running: status + progress, no prompt, chart area empty state. With a result and a later failure: the result under "Run failed".
- Risk figures: `var95`, `var99`, `cvar95` (`krwLossFromPercent`), `maxDrawdown`, `sortino`, `skewness`. Exports `riskSummary` → `risk_summary.csv`, `riskHistogram` → `risk_histogram.csv`, labels "Export Risk Summary CSV", "Export Risk Histogram CSV".
- Risk chart area: `grid lg:grid-cols-3`; left `lg:col-span-2` = `ToggleGroup ariaLabel="Risk chart"` with options `var` "VaR / CVaR" and `percentiles` "Percentiles" (ko "VaR / CVaR", "백분위"), then the chosen chart in fill mode; right = "Statistical Summary" table, `overflow-auto` inside its frame. The view is local state, reset to `var` on mount.
- Distribution figures: `mean`, `std`, `kurtosis`, `max`, `min`. Exports `returnHistogram` → `return_histogram.csv`, `returnCdf` → `return_cdf.csv`. Chart area: histogram and CDF side by side, fill mode.

- [ ] **Step 1:** Tests: no-result prompt on both tabs and `mc-run-prompt-open` selects Path (`aria-selected`); running state shows progress and no prompt (`hold: true`); after a run the six risk and five distribution figures are present and VaR 95 reads `formatKrwCompact(10_000_000 × 0.06)` = `KRW 600,000`; the percentile chart's Y axis label is "KRW M"; the view toggle switches charts and the stats table stays visible; the four export filenames; at 1280×720 after a run, every chart frame and the table frame end inside `mc-panel`.
- [ ] **Step 2–4:** Run (FAIL), implement, apply A2, run the area specs, `typecheck`, `lint`, `design:baseline`.
- [ ] **Step 5:** Mutation check: `onAction` a no-op (prompt test); the prompt shown while running (running test); `risk_summary.csv` renamed (export test); `HistogramPanel` back to `height=320` (fit test).
- [ ] **Step 6:** Commit: `feat(web): Monte Carlo risk and distribution tabs on one screen`.

### Task 8: Valuation tab

**Files:**
- Modify: `CorporateValuationSection.tsx`, `page.tsx` (price-lookup messages become `{ key: MessageKey; vars?: Record<string, string> } | { raw: string }`; `raw` only for the API `detail_note` (D2) and a thrown `Error.message`), `app/monte-carlo/lib/krwFormat.ts` (`formatKrwRange`)
- Modify: catalogs `monteCarlo.valuation.*`, `monteCarlo.lookup.{loading, fetching, loaded, loadedStale, notFound, failed, timedOut, manualOverride}` with the current en texts as templates (`"{ticker} price loaded from cache."` etc.)
- Test: `monte-carlo-model.spec.ts` (append), `monte-carlo-one-screen.spec.ts` (describe "valuation")
- D8 (owner, 2026-10-17): `krw(value, locale)` gives `KRW 50,000` in en and `50,000원` in ko; `formatKrwRange` matches. Model-spec cases: en `krw(50_000)` → `KRW 50,000`; ko → `50,000원`; `NaN` → `—`. Mutation: ko keeps the `KRW` prefix.

**Output contract:**

| name | signature | returns | cases | example | side effects |
|---|---|---|---|---|---|
| `formatKrwRange` | `(lo: number \| null, hi: number \| null, locale: FormatLocale): string` | string | en `KRW 41,200–58,900`; ko `41,200–58,900원` (U+2013, integer won, one prefix or suffix); either side not finite → `—` | `(41_200, 58_900, "ko")` → `41,200–58,900원` | none |
| lookup message state | `type LookupMessage = { key: MessageKey; vars?: Record<string, string> } \| { raw: string } \| null` | — | rendered as `t(key, vars)` or `raw` | `{ key: "monteCarlo.lookup.loaded", vars: { ticker: "AAPL" } }` → "AAPL price loaded from cache." | none |

**Content:** rail = Ticker (lookup message directly under it, `data-testid="mc-price-lookup"`, `role="status"`, error tone for not-found/error), then the other 10 fields as today; actions Run Valuation / Cancel. Figures: `medianFair` (`krw`), `undervaluation` (`pct`), `upside` (`pct`), `interval80` (`value` = p10, `format` = `lo => formatKrwRange(lo, p90, locale)`). Chart area: fair-value distribution `lg:col-span-2` (fill) + "Valuation Statistics" table. Exports `valuationSummary` → `valuation_summary.csv`, `valuationDistribution` → `valuation_distribution.csv`. Empty text kept verbatim.

- [ ] **Step 1:** Tests: `formatKrwRange` cases; after a mocked valuation run the interval reads `KRW 41,200–58,900` (en) and `41,200–58,900원` (ko); the lookup message sits below the Ticker input (its `top` ≥ the input's `bottom`, and above the next field); ko lookup text "AAPL 가격을 캐시에서 불러왔습니다." for the loaded case; the two export filenames; fit at 1280×720 after a run; rail actions pinned after scrolling the 11-field rail.
- [ ] **Step 2–4:** FAIL, implement, run the area specs (all of `simulation-lab-price-autofill` must stay green unedited), `typecheck`, `lint`, `design:baseline`.
- [ ] **Step 5:** Mutation check: a hyphen instead of the en dash; the prefix repeated (`KRW 41,200–KRW 58,900`); the lookup message hard-coded in English (ko test); `valuation_summary.csv` renamed.
- [ ] **Step 6:** Commit: `feat(web): Monte Carlo valuation tab on one screen; price-lookup messages from the catalog`.

### Task 9: Correlation tab

**Files:**
- Modify: `CorrelationModelSection.tsx`, `components/charts/HeatmapPanel.tsx` (fill height if it has a fixed one), catalogs `monteCarlo.correlation.*`
- Delete when unused: `MonteCarloRunPanel.tsx`, `MonteCarloTabSummary.tsx`, `MetricCard`/`WarningNotice` in `shared.tsx`, and their `index.ts` exports
- Test: `monte-carlo-one-screen.spec.ts` (describe "correlation")

**Content:** rail = the asset table (μ, σ), the 4×4 matrix, the simulation-count slider; actions = `RunButton` "Run Correlation Analysis" only (no Cancel). Figures: `optimalMu`, `portfolioSigma`, `diversification` (`${ratio}%pt` as today), `optimalSharpe`. Chart area: efficient frontier on the left (`lg:col-span-2`, fill) and, on the right, `ToggleGroup ariaLabel="Correlation detail"` with `sensitivity` "Spearman rho" / `heatmap` "Heatmap" (ko "스피어만 ρ", "히트맵"). Exports `frontier`, `sensitivity`, `heatmap` → `correlation_frontier.csv`, `correlation_sensitivity.csv`, `correlation_heatmap.csv`.

- [ ] **Step 1:** Tests: every matrix input has `scrollWidth ≤ clientWidth` and its value text fully visible; no Cancel button in the rail and `mc-status` never reads "Run canceled" after a superseding path run (with Task 3 in); the toggle switches sensitivity/heatmap; the three export filenames; fit at 1280×720 after a run; actions pinned after scrolling.
- [ ] **Step 2–4:** FAIL, implement, area specs, `typecheck`, `lint`, `design:baseline`.
- [ ] **Step 5:** Mutation check: rail width `240px` via a temporary token override (matrix test); a Cancel button added (no-cancel test); `correlation_heatmap.csv` renamed.
- [ ] **Step 6:** Commit: `feat(web): Monte Carlo correlation tab on one screen`.

### Task 10: One-screen lock, Korean check, cleanup

**Files:**
- Modify: `components/ui/oneScreenRoutes.ts` (`["/corporate", "/", "/monte-carlo"]`), `tests/e2e/helpers/designScreens.ts` (`["/monte-carlo", async () => {}]`; the page makes no API call until a ticker is left)
- Test: `monte-carlo-one-screen.spec.ts` (describe "no page scroll, all tabs"; describe "Korean")

- [ ] **Step 1:** Tests:
  - **five tabs × before/after × 1280×720 and 390×844** (20 cases, `installMonteCarloWorker` with all three fixtures): open the tab (and for after: run on the owning tab, then open the tab), wait for `document.fonts.ready`, `expectNoPageScroll`. At 1280 also: `mc-result-header` and the first chart frame end inside `mc-panel`. When `DESIGN_CAPTURE` is set, each case also saves `design-capture/$DESIGN_CAPTURE/monte-carlo-<tab>-<before|after>-<width>.png`.
  - **Korean:** with `locale: "ko-KR"`, on each tab the rail field labels, the run button and the chart titles are Korean (`/[가-힣]/`) and none equals its en string; specifically "초기 투자금", "경로 시뮬레이션 실행", "시뮬레이션 경로".
- [ ] **Step 2:** Run with the route not yet listed. The no-scroll cases pass trivially only if the page fits; the gate is the mutation in Step 5. The Korean test fails if any English literal is left.
- [ ] **Step 3:** Add the route and the screen. Remove orphans (`grep` for `krwTenThousands`, `TabButton`, `MonteCarloRunPanel`, `MonteCarloTabSummary`, `PercentileIndicator`, `CHART_INITIAL_DIMENSION` users) and catalog keys no code reads (`grep` each `monteCarlo.*` key for a reader). The reviewer reads `app/monte-carlo/components/**` for any visible English literal left in JSX text, `title`, `aria-label` or `placeholder`.
- [ ] **Step 4:** Run the **full suite** (`components/ui/oneScreenRoutes.ts` is a shared surface; `paper-sweep` and `design-capture` now cover `/monte-carlo`).
- [ ] **Step 5:** Mutation check: remove `min-h-0` from `mc-panel`. If no case fails, record why (the descendants are scroll containers with an automatic minimum of 0), and use the substitute: replace the column's `h-[calc(…)]` with `min-h-[calc(…)]` → the 1280 after-run cases fail. Also: a hard-coded "Run Path Simulation" (Korean test).
- [ ] **Step 6:** Commit: `feat(web): /monte-carlo joins the one-screen routes`.

### Task 11: Motion wiring (spec §8)

**Files:**
- Modify: `page.tsx` (run ids and the before/after state), `ResultHeader.tsx` (`BeforeAfter`), the three run-owning sections (`ScanReveal trigger={runId}` around the result area)
- Test: `tests/e2e/monte-carlo-motion.spec.ts` (new, `test.use({ contextOptions: { reducedMotion: "no-preference" } })`)

**Output contract:**

| name | shape | cases | side effects |
|---|---|---|---|
| run ids | `runIds: Record<"path" \| "valuation" \| "correlation", number>`, incremented when that kind's result arrives | `ScanReveal trigger={String(runIds.path)}` (the first value never scans) | state |
| before/after | `pending: { tab: MonteCarloTab; values: Record<string, number \| null> } \| null` set at run start from the tab's current figure values when a result exists; on result: `before = pending.tab === activeTab ? pending : null`; on any tab change: `before = null`, `pending = null` | figure `previous = before?.tab === thisTab ? beforeText(before.values[key], value, format) : null` | state only |

Tabs (`Tabs` slides on its own), the panel `ScanReveal` (Task 4), `RollingNumber enter` (Task 6) and the run-button nudge (Task 6) are already in place; this task adds the re-run pieces and verifies the set.

- [ ] **Step 1:** Tests (motion on): run path, then change "Expected annual return" and run again with the mock's second fixture (p50 9,800,000): `mc-figure-median` contains `del` with `KRW 9.64M` and `ins` with `KRW 9.80M`. Switch to Risk and back: no `del` in the figures row. A third run with an identical result shows no `del` for that figure. On run completion the result area's `scan-line` has a running animation within 100ms. Under reduced motion (a second describe): the `del`/`ins` still appear (it is information, not motion) and `scan-line` never animates.
- [ ] **Step 2–4:** FAIL, implement, run `monte-carlo-motion`, `motion`, the area specs, `typecheck`, `lint`.
- [ ] **Step 5:** Mutation check: `previous` never passed (re-run test); the tab-change reset removed (switch test); `trigger` fixed to `"result"` (scan test).
- [ ] **Step 6:** Commit: `feat(web): Monte Carlo re-runs show before → after; results scan in`.

### Task 12: Gates, capture, records

- [ ] **Gates:** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run design:baseline`, the full Playwright suite, and `pytest` (no backend change expected; run at the gate).
- [ ] **Capture:** `DESIGN_CAPTURE=monte-carlo-one-screen npx playwright test design-capture monte-carlo-one-screen` (20 tab captures plus the design screen). Add a short motion-on video of a path run, a re-run and two tab switches, saved in the scratchpad, for the owner.
- [ ] **Controller check:** re-run one Task 6 mutation (actions pinned) and the Task 2 `M KRW` mutation yourself; look at the 1280 and 390 captures.
- [ ] **Records:**
  - `guideline/sop/todo.md` Track D: the D12 M6 Monte Carlo follow-up is absorbed; `DESIGN_SCREENS` now has Monte Carlo; D5 (English normalization warnings) as a follow-up; D8 if the owner wants ko `원` for `krw()`.
  - `ERROR-LOG.md`: Task 2 and Task 3 records have their commit SHAs; Task 1's if a defect was found.
  - Korean strings with numbers or units, listed for the owner to read by eye (`monteCarlo.status.running` progress, the lookup templates, `monteCarlo.units.*`).
  - `docs/INDEX.md` if it lists plans; memory.
- [ ] **Final review** (Opus): intent against the spec, money display (every KRW path through `formatKrwCompact`, `krwLossFromPercent`, `formatKrwRange` or `krw`), regressions; then owner acceptance.

---

## Self-review

**Spec coverage.**

| Spec item | Task |
|---|---|
| §1 height budget, column class, header, subtitle, truncate | 4, 6, 10 |
| §1 tabs → shared `Tabs`, `useTabState` key, guard, first render `path` | 4 |
| §1 rail 320, pinned actions, header row, export menu, empty chart area, warning banner | 5, 6 |
| §1 390 behaviour | 6, 10 |
| §1 path status on risk/distribution; correlation run-only | 7, 9 (and 3) |
| §2 per-tab content, interval format, run-first prompt, legend with ranges, deletions, flex chart height (min 200) | 6, 7, 8, 9 |
| §3 formatter, rules, test values, axis units, `krw()` unchanged, ERROR-LOG | 2 |
| §4 i18n, lookup messages, removed keys | 4, 6–10 |
| §5.1 eight tests and their mutations | 10 (no-scroll), 6 (fit, pinned, export), 4 (persistence), 7 (prompt), 7–9 (exports), 2 (formatter), 10 (ko) |
| §5.2 existing tests, `DESIGN_SCREENS` | inventory, 10 |
| §5.3 risk empty charts | 1 |
| §6 output contracts | 2, 4, 5, 6, 8, 11 |
| §7 #71 stacking, motion pieces only, reduced-motion default | 0, 11 |
| §8 motion table and its two tests | 4, 6, 11 |

**Type consistency.** `RunStatus` and `RunStatusView` (Task 5) feed `ResultHeader` (Task 6) and Tasks 7–9. `ResultFigure.value: number | null` + `format` replaces the spec §6 `value` string, because `RollingNumber` (spec §8) needs a number and a formatter; `previous` is the string `beforeText` returns (Task 5), which `BeforeAfter.previous` takes. `ExportItem` adds a `key` to the spec's `{label, onSelect}` for the test ids. `MonteCarloTab` is the one tab type (Task 4) used by Task 11. `FormatLocale` comes from `lib/format.ts`.

**Placeholders.** None: copy that moves keeps its current en text (a rule, not a TODO), and every new string is given in en and ko except the bulk Korean translations of moved copy, which the implementer writes in the formal register and the reviewer checks against the glossary.

**Proportion.** Thirteen tasks for one page, five layouts and a money-format fix. Tasks 7–9 reuse Task 6's components, so they are mostly content. The two tasks that touch shared surfaces (4, 5) and the lock (10) carry the full-suite runs.

**Spec statements found not exact at d6dc92d:**
- `RiskAnalysisSection.tsx:109-114` divides by `TEN_THOUSAND_KRW`: it is `:109-115` (seven percentiles, P5 through P95).
- Spec §6 gives the figure value as display text; §8 needs a number and a formatter for `RollingNumber`. This plan uses `{ value: number | null; format }` (above).
- Spec §5.1's no-scroll mutation "remove `min-h-0` from the panel" may not fail if the panel's descendants are all scroll containers; Task 10 records the outcome and names a substitute.
- Spec §7 says PR #70 is merged (adbbd44): true on `origin/renewal`; the local `renewal` ref still points at b833b21, so the rebase in Task 0 uses `origin/renewal`.
