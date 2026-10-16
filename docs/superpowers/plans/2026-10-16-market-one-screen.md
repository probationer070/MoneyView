# Market Overview One-Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` (Market Overview) answers "how is the market today?" at 1280×720 without a page scroll. One regime line sits in the header. Below it are two page tabs. **Instruments** shows the instrument cards in five columns (or the table), with a one-line row of theme-spread figures underneath. **Spreads** holds the five spread charts at full width. The page, its cards and the detail modal move to the paper tokens and the en/ko catalogs, and the market lint warning cap goes from 295 to 0.

**Architecture:**
- **Backend:** one read-only route, `GET /api/v1/market/regime`. It is a public wrapper, `MarketDataService.get_market_regime()`, over the existing `_build_market_regime_context()`. The regime logic does not change.
- **Pure frontend logic** lives in `components/market/marketModel.ts`, tested as a Playwright model spec the way `corporate-model.spec.ts` is:
  - the page-tab list and its guard;
  - `regimeView`, which maps a regime label to a catalog key and a tone;
  - `withFigures`, which sets figures inside a sentence in mono;
  - `spreadFigure`.
- **The page column** follows `/corporate`:
  - `app/page.tsx` only fetches the cards;
  - `MarketOverviewClient` renders `MarketHeader` (title, subtitle, `MarketRegimeLine`) and `MarketPageTabs`;
  - `MarketPageTabs` is a `useTabState` tab set that mounts only the active panel;
  - the Instruments panel is `InstrumentsPanel`, with `SpreadFigureRow` under the cards or table;
  - the Spreads panel is the existing `SpreadsSection`.
- **The regime** comes from `lib/useMarketRegime.ts`, fetched in the browser so that `page.route` can answer it.

**Tech Stack:** Next.js 16.2 app router, React 19, Tailwind CSS 4 with the paper tokens and `type-*` utilities, @tanstack/react-query 5, lightweight-charts (TVChart), recharts 3 (Sparkline), Playwright (e2e and model specs), ESLint 9 with `moneyview/no-raw-design-values`, FastAPI and pytest for the route.

**Spec:** `docs/superpowers/specs/2026-10-16-market-one-screen-design.md`. The owner approved §1–§5. Read it together with this plan. Where they differ, the "Narrowed or interpreted" table below names the difference and the reason. The "Spec statements found false at HEAD" list records what was checked against `1e71ea7`.

**Sequencing:**
- This plan runs on `feat/market-one-screen`, cut from `feat/design-system-paper` at `7abbf74` (PR #69). It merges back into `feat/design-system-paper` before DS Task 14b.
- It takes the market part of DS Task 13 and the market half of DS Task 14b's precondition (market warnings 0). Task 1 writes both notes into the DS plan and Track D.
- It amends UI-consolidation Tasks 5 and 7, in docs only (Task 1).
- PR #67 (signals) shares no file with this branch.

**Model routing** (HARNESS "Model routing"; Opus 5.5 is the controller and does the final review):

| Task | Implementer | Reviewer | Why |
|---|---|---|---|
| 1 Owner gate, sibling-plan notes, tracking | controller (gate) + Haiku (docs, exact text given) | Sonnet | docs only |
| 2 `GET /api/market/regime` (**parallel-safe**: pytest only, own worktree) | Haiku | Sonnet | exact code given |
| 3 Pure market models, regime hook, shared type | Haiku | Sonnet | exact code given |
| 4 Page frame, page tabs, regime line, approved test edits | Haiku | Sonnet | exact code given; layout passes by panel scroll |
| 5 Instruments tab: five columns, card trim, table, spread figures | Sonnet | Sonnet | fit tuning against the measured budget |
| 6 Market on paper tokens and en/ko catalogs; cap 295 → 0 | Sonnet | Sonnet | ~250 class edits and Korean copy need judgment |
| 7 Docs, capture review, full suite, merge back | controller + Sonnet (docs) | Opus (final) | gate |

---

## Narrowed or interpreted (owner-visible)

Task 1's approval gate presents this table with the inventory. A row the owner changes is edited here and in the task step that applies it.

| # | Spec says | This plan does | Why |
|---|---|---|---|
| N1 | §1 diagram: title "마켓 개요" | Korean title **"시장 개요"**, English "Market Overview" (unchanged). | The glossary fixes "Market Overview → 시장 개요" (it is the nav label). A term is translated one way everywhere. |
| N2 | §1 header 76 px: title, subtitle, regime line | **No eyebrow** above the title. | Measured: `type-heading-5` is a 34 px line, the subtitle 22 px, and `PageHeader` adds `mb-6`. That is about 84 px, the spec's 76 within tolerance. An eyebrow (`mb-2` + caption) adds 24 px. The table view then needs about 480 px, and its 471 px panel would scroll. |
| N3 | §1 diagram: "[종목 INSTRUMENTS] [스프레드 SPREADS]" | Tab labels are **single-language** catalog strings, `market.tabs.instruments` / `.spreads` ("Instruments"/"종목", "Spreads"/"스프레드"). | `Tabs` takes a string label, and the corporate page tabs are single-language too. A bilingual tab label would need a `Tabs` change, and `Tabs` is a shared surface. |
| N4 | §2.5 display "지수 {adv}/{count} 상승 · 선호 {on} / 회피 {off}" | English: **"Risk-on · Indices up 3/4 · Signals on 5 / off 0"**. Korean: "위험선호 · 지수 3/4 상승 · 선호 5 / 회피 0". | The spec gives only the Korean. `market-overview.spec.ts:33–34` reads the modal's "3/4 advancers" and "5 risk-on / 0 risk-off" page-wide with `getByText` (substring, case-insensitive). If the header repeated either phrase, both would hit a strict-mode violation. |
| N5 | §2.3 per pair: name, latest value, ticker pair, window | The ticker pair and the value are shown **per pair**. The window is shown **once**, in the row caption: "Themes vs benchmark (90d)". | Every pair comes from one request (`useMarketSpreads`, `window_days=90`), so the requested window is the same for all of them by construction. Repeating it five times costs a second line. |
| N6 | — | The **header and both tabs render even when the index fetch fails** or returns nothing. The error or empty state sits inside the Instruments panel. | Today `MarketOverviewClient` returns early, which also hid the spreads section. That was a side effect of the early return, not a decision, and the spreads do not depend on the index cards. |
| N7 | §2.5 "`regime_summary` is never rendered"; §2.6 "the modal only moves to tokens and catalogs" | The modal's Regime tile shows the catalog label (the same mapping as the header). Its sentence comes from **catalog keys keyed by the label**: `market.detail.regimeSummary.{riskOn,mixed,riskOff,unknown}`. The English is byte-identical to the backend's four sentences, so `regime_summary` itself is rendered nowhere. | Without this, the Korean modal would show an English backend sentence. Cost: if the backend reworded its sentence, the catalog would not follow. The four strings are copied in Task 6 with their source line (`market_data.py:1023–1032`). |
| N8 | §2.2 "keep the period label" | Kept, moved beside the ticker ("^GSPC · Snapshot"). It always reads the fallback, "Snapshot" / "스냅샷". | `IndexQuote` (`GET /market/indices`) has no `period` field, so `MarketIndexQuote.period` is always undefined. |
| N9 | §3 en/ko pass for the market | `ViewToggle` ("Graph" / "Table") stays English in Korean. **Follow-up.** | It is in `components/ui/`, a shared surface, and `responsive-accessibility.spec.ts:54–55` and `market-overview.spec.ts:44` click it by its English name. Translating it is a shared-UI change with its own test list. |
| N10 | §6 `useMarketRegime` "fetches once on mount" | `retry: false`, `staleTime` 15 min, `refetchOnWindowFocus: false`. | "Once" taken literally. The app default (`retry: 3`) would also make the error state take about 7 s to appear. A transient failure shows "Regime could not be loaded." until the next mount. |
| N11 | §2.5 `regime_label: "risk_on" \| "mixed" \| "risk_off" \| "unknown"` | Typed **`string`** in TS, with the four values documented. Any other value renders "Regime unavailable" (Review Focus 1). | The backend types it as `str` (`MarketRegimeContext.regime_label: str = ""`). A TS union would claim a guarantee the API does not make. |
| N12 | §3 tile labels in the modal ("CURRENT VALUE", "LATEST VOLUME", …) | The labels move to `market.detail.*` as **single-language** strings (M6). M7's bilingual labels apply to the instruments table's `<th>`s only. | They are figure captions inside tiles, not eyebrows above a title, as `KPIBlock` labels are. Making about 20 of them bilingual would add 20 `LABELS` and glossary rows that the spec does not ask for. |
| N13 | §3 "the cap 295 → 0" | Tasks 4–5 only remove market hits. The cap goes **295 → 0 in one step**, at the end of Task 6. | `design:baseline` must stay ≤ 295 meanwhile. It does: new files are lint-clean, and edited files only lose hits. |
| N14 | — | `mockMarketPageApi` gains a default `/market/regime` answer: the `^GSPC` detail fixture's `market_regime` (risk_on, 3/4, 5/0). This is inventory row #21. | Without it, the regime request falls through `route.continue()` to the e2e API, which may refresh 10 tickers live. That would make every spec using the helper network-dependent, the thing the helper's own comment forbids. |
| N15 | — | `paper-sweep.spec.ts` keeps its `"/"` exclusion. | The DS plan gives its removal to Task 14b step 5. Editing it here would be an unlisted test edit. |

---

## Spec statements found false at HEAD (`1e71ea7`)

1. **§4.2 "Other specs that visit `/`: no edit".** False for two existing tests:
   - `tests/e2e/corporate-model.spec.ts:370` and `:374` assert that `"/"` is **not** a one-screen route.
   - `apps/web/scripts/design-baseline-cap.test.mjs:5–18` pins the cap at 295.

   Both are in the inventory (#18–#19, #22–#25). The shared mock helper also needs a regime branch (#21, N14).
2. **§2.1 `useTabState("market.pageTab", "instruments")`.** `useTabState` takes the full storage key. The key is `tabStateKey("market", "pageTab")`, which is `"moneyview.tab.market.pageTab"`.
3. **§2.5 path `GET /api/market/regime`.** The router is mounted at `/api/v1/market` (`apps/api/main.py:195`), so the URL is `/api/v1/market/regime`. The routes docstring writes paths without `/v1`, and this plan keeps that convention there.
4. **§2.5 "`MarketRegimeContext` at `schema_parts/market.py:151`".** The class is at `:150`.
5. **§1 "remove `py-6`".** The wrapper is `max-w-7xl mx-auto px-4 py-6`. The 1216 px content width also needs the `px-4` removed, since `main` already pads `lg:px-8`.
6. **§2.2 "keep the period label".** It is always the "Snapshot" fallback (N8).
7. **§3 Korean header "마켓 개요".** The glossary says "시장 개요" (N1).
8. **The plan request says the market route tests live in `apps/api/tests`.** They do not. pytest's `testpaths = ["tests"]`, and the market route tests are `tests/api/test_market_spreads.py` and `tests/api/test_market_index_detail.py`. The autouse isolated-DB and no-network fixtures are in `tests/conftest.py`.
9. **DS Task 13 already says market moved out** (note of 2026-10-15). Its globs, specs and Korean-assertion lines still name market, and Task 1 trims them. Track D's D13 follow-up still says "233 hits". At HEAD it is 295: typeScale 59, deprecatedVar 162, hex 3, paletteClass 6, lengthTypeVar 3, fontWeight 57, figureMono 3, roundedFull 2. Measured: `MarketOverviewClient.tsx` 264, `SpreadsSection.tsx` 31, `app/page.tsx` 0. `components/data/SparklineCard.tsx` is 0, already at `error` level.

---

## Global Constraints

- **Where commands run.** `npm`/`npx`/`node` run in `apps/web`. `git` runs from the repo root, in Git Bash. Python is `C:/Users/eajwa/anaconda3/envs/moneyview/python.exe`; never `python3`, which is a Windows Store stub.
- **Branch.** `feat/market-one-screen` (already checked out). Never commit to `renewal`, `feat/design-system-paper` (except Task 7's merge, after the owner accepts), `feat/macro-signal-engine` or `feat/watchlist-cleanup-corporate-sync`.
- **Backend scope.** The only backend change is Task 2:
  - the wrapper method, the route, its docstring line, the API reference line, and two new test files;
  - no change to `_build_market_regime_context`, `EQUITY_INDEX_TICKERS`, `MARKET_INDICES`, schemas, `packages/core_finance/`, seeds or sync code.

  `guideline/sop/finance-logic.md` applies only in that no formula is added. The frontend shows the backend's counts as sent and counts nothing itself (spec §2.5).
- **Design tokens only** (`DESIGN.md`):
  - colours, radius and component sizes are `[var(--token)]`; type is `type-<style>`; spacing is Tailwind's numeric scale;
  - no hex, `text-xs`/`text-sm`, `rounded-lg`, `shadow-*`, `text-[Npx]`, or `font-*` without an `M2:` comment;
  - `rounded-full` only on a dot, track, fill or spinner, with its comment;
  - figures use `formatNumber` and a mono style.

  Every file a task creates must report 0 in every category under `npm run design:baseline -- <file>`.
- **Directions.** Up is `--up` red with ▲ and +, down is `--down` blue with ▼ and −, flat is `--flat` with ■, via `DeltaBadge`. Colour is never the only signal. A missing value is `MISSING` (`—`) from `@/lib/format`.
- **Strings.** Every new user-visible string goes into `lib/i18n/messages/en.ts` **and** `ko.ts`. `ko` is typed `Messages`, so a missing Korean key is a type error. `i18n-model.spec.ts` also rejects an empty `ko` leaf, so no catalog value may be `""`.
  - Korean follows `docs/design/MoneyView_Glossary.md`, in 합니다체 for sentences.
  - Table headers are `BilingualLabel` keys from `lib/i18n/labels.ts`. Each gets a glossary row first, and the English half must match `/^[A-Za-z0-9 .&/-]+$/`.
- **English that tests pin stays byte-identical.** Every string below must stay exactly as written in `en.ts` after Tasks 4–6:
  - "Market Overview" (h1, `exact`), "Open detail for {name}", "Open detail for {name} from table", "Instrument" (columnheader), "Graph", "Table", "Monthly" (button), "View Full Detail", "Close modal" (ModalShell, unchanged);
  - "Quick market detail" (`market-overview.spec.ts:32` reads "Market Detail" as a substring), "3/4 advancers", "5 risk-on / 0 risk-off", "Daily Volume", "Daily Indicators", "Monthly Indicators", "Monthly Crypto Signals", "Monthly bars", "Commodity Context", "Daily Commodity Signals", "Trend Spread", "Upper Range Band", "FX Context", "Daily FX Signals", "Pair Momentum", "20D Pair Average", "Crypto Context", "Daily Crypto Signals", "Momentum Spread", "Upper Volatility Band", "Data Quality", "Detail Warnings", "Market Detail Unavailable";
  - the bullets "Unit framing: {unit} matter more than stock-style benchmark framing.", "{pair} reads as quote-currency value per base-currency unit.", "Unit framing: {unit} can move with outsized volatility relative to traditional macro assets." and "Daily first, monthly second: use daily indicators for tactical inspection and monthly indicators for regime-level confirmation.";
  - the three warning sentences in `market-overview.spec.ts:135–137`;
  - spreads: "Unavailable", "Reason: {reason}" (the reason text), "{days}d", "could not be loaded", "Events · …" (EventFilter, unchanged).
- **Strict mode on `/`.** No new element may repeat these texts or ids, because existing specs read them page-wide:
  - "S&P 500", "Nasdaq", "^GSPC" (exact), "Market Detail", "3/4 advancers", "5 risk-on / 0 risk-off", "Monthly";
  - testids `spreads-loading`, `spreads-empty`, `spreads-section` and the prefix `spread-card-`.

  The spread-figure row uses `spread-figures` and `spread-figure-<id>`. Its ticker pair is one text node, `BOTZ/^GSPC`.
- **Existing tests.**
  - Edit only the rows of the "Existing-test change inventory", only in the task that row names, and only after Task 1 records the owner's approval.
  - Assertions are never weakened: an inserted "open the tab" line, a subtitle string and the reversals listed are the only changes.
  - If any other existing test fails, stop and report it; do not edit it.
- **CLAUDE.md §8: mutations.**
  - **Python:** mutate in memory (monkeypatch). Task 2's harness file does it and is committed.
  - **TS / Playwright:** create a backup with `bak=$(mktemp -d)` and `cp -p <file> "$bak"/`. Apply the one mutation with Edit, then run the named test: it must FAIL, for the named reason. Restore with `cp -p "$bak"/<basename> <file>`, and `cmp "$bak"/<basename> <file>` must print nothing.

  A mutation that does not make its test fail is a survivor. Report it with the reason; never report it as passing.
- **Forbidden.**
  - **Never** use `git stash`, `git checkout -- <file>`, `git restore`, `--no-verify`, `git commit --amend` or `page.waitForTimeout`; wait on conditions.
  - **Never** read `config/.env` or `apikey.json`.
  - Tests never write to `data/processed/moneyview.db`.
- **Playwright.**
  - Run from `apps/web` as `npx playwright test <files> --workers=2`, in the foreground, and only one run at a time on this PC. It boots the API on :8110 and the web app on :3101.
  - If a run is stopped or killed, kill both servers before the next run:
    `powershell -NoProfile -Command 'Get-NetTCPConnection -LocalPort 8110,3101 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'`
- **Test scope** (HARNESS "Test scope").
  - Each task runs its new and changed tests, the area specs it names, `npm run typecheck` and `npm run lint`.
  - **Task 4 changes `components/ui/oneScreenRoutes.ts`, a shared surface, so Task 4 runs the full Playwright suite.**
  - Task 7 runs everything.
  - Area specs for `/`: `market-*.spec.ts`, `event-filter.spec.ts`, `events-page.spec.ts`, `candle-colour.spec.ts`, `candle-direction.spec.ts`, `font.spec.ts`, `i18n.spec.ts`, `responsive-accessibility.spec.ts`, `tab-state-persistence.spec.ts`, `one-screen-no-scroll.spec.ts`, `market-one-screen.spec.ts`, `market-model.spec.ts`.
- **Line endings.** The index is LF for every file. `core.autocrlf=true`, so the working-tree ending varies; check it with `git ls-files --eol <file>`, column `w/`.
  - Keep each edited file's working-tree ending; Edit preserves it. New files are written LF. Compare with `git diff --ignore-cr-at-eol`.
  - `w/crlf` files this plan edits: `app/page.tsx`, `components/data/SparklineCard.tsx`, `components/market/SpreadsSection.tsx`, `components/ui/oneScreenRoutes.ts`, `lib/useMarketSpreads.ts`, `packages/shared-types/market.ts`, `apps/api/routes/market.py`, `apps/api/services/market_data.py`, `docs/architecture/moneyview-api-reference.md`, `scripts/design-baseline-cap.mjs`, `scripts/design-baseline-cap.test.mjs`, `guideline/sop/todo.md`, the DS and UI-consolidation plans, and every `tests/e2e/*.spec.ts` and `helpers/marketPageMock.ts` in the inventory.
  - `lib/i18n/messages/en.ts` and `ko.ts` are `w/mixed`: edit with Edit only.
  - `MarketOverviewClient.tsx`, `labels.ts`, `DESIGN.md`, the glossary, `docs/INDEX.md` and `docs/tabs/market-overview-tab.txt` are `w/lf`.
- **Commits.** Each commit ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the executing model's name), passed as a second `-m`. Never amend; a fix is a new commit.
- **Records.** `ERROR-LOG.md` gets a record for any confirmed bug found on the way (CLAUDE.md §7). On a merge conflict there, keep both sides.
- **SOPs:** `test-verification.md` (all tasks), `file-structure.md` (Tasks 3–5), `security-reviewer.md` (Task 2: read-only route, no new table), `refactor-cleaner.md` (Tasks 5–6), `code-reviewer.md` (Task 7), `todo.md` (Tasks 1, 7).

---

## Review Focus

These are the five inputs the spec implies but no feature test naturally reaches, most likely first. Each is pinned by a named test in its owning task.

1. **A regime label that is an `Object.prototype` name or empty** (`"constructor"`, `"__proto__"`, `""`). A plain lookup returns a function or `undefined`, and the line renders `undefined` or crashes. Expected: "Regime unavailable". → Task 3, `regimeView reads only its own labels`.
2. **A known label with zero equity indices** (`"mixed"`, `equity_index_count: 0`). Rendered naively it reads "Mixed · Indices up 0/0". Expected: "Regime unavailable". → Task 3, `no equity index means unknown, whatever the label`.
3. **`^VIX` bars present.** VIX is in `MARKET_INDICES` but must not count as an equity index; the exclusion lives only in `EQUITY_INDEX_TICKERS`. → Task 2, `test_vix_bars_are_not_counted_as_an_equity_index`.
4. **A remembered page tab that is not a tab** (`"constructor"`, or a value from an older shape). Unguarded, `panels["constructor"]` is `Object`, so no tab is selected and the panel is blank. Expected: Instruments. → Task 3, `isMarketPageTab accepts the two tabs and rejects prototype names and junk`; Task 4, `an unknown stored tab falls back to Instruments`.
5. **The regime request resolving after first paint.** If the loading line has no height, the tab bar jumps down when the regime arrives. Expected: same line height and the same tab-bar `y` in both states. → Task 4, `while loading, the regime line keeps its height and the tab bar does not move`.

---

## Existing-test change inventory (owner approval required before any edit)

**Not yet approved.** Task 1 Step 2 presents this section verbatim, with the "Narrowed or interpreted" table.

**Totals: 25 rows in 8 files.** "Insert" means a new line directly after (or before, where stated) the cited line. The cited line itself is unchanged.

**Line numbers are those at plan time** (`feat/market-one-screen` @ `1e71ea7`). Earlier inserts in the same file shift later rows, so always locate a row by the quoted code, never by the number alone. If the quoted code is not where the row says, or reads differently, stop and report it.

The helpers are in a new, plan-owned file, `tests/e2e/helpers/marketTabs.ts`, defined in Task 4:

| Helper | Does |
|---|---|
| `openMarketTab(page, name: "Instruments" \| "Spreads")` | Clicks `getByRole("tab", { name, exact: true })` inside `[data-testid="market-page-tabs"]` and waits for `aria-selected="true"`. It retries the click inside `expect(…).toPass({ timeout: 60_000 })`: the tab bar is server-rendered, so a click that lands before hydration does nothing. There is no fixed sleep. |
| `marketPanel(page)` | `page.getByTestId("market-page-tabs").getByRole("tabpanel")` |

**Why these break.** Task 4 puts the spreads section on its own tab and mounts only the active panel. A spec that reads a spread card, a spread chart or the spreads filter right after `goto("/")` no longer finds it. A spec that then opens an index card needs the Instruments tab again. Adding `"/"` to `ONE_SCREEN_ROUTES` reverses two assertions that pinned its absence. Task 6 moves the warning cap from 295 to 0.

### Task 4 (page tabs, header, one-screen route)

| # | File:line | Current | Why it breaks | Replacement |
|---|---|---|---|---|
| 1 | `market-spreads.spec.ts:4` | `import { GEOPOLITICAL, mockEventsApi, setAllEventCategories, type MockEvent } from "./helpers/eventsApiMock";` | rows #2–#9 call the helper | Insert after it: `import { openMarketTab } from "./helpers/marketTabs";` |
| 2 | `market-spreads.spec.ts:47` | `await page.goto("/", { waitUntil: "domcontentloaded" });` ("every spread card names the tickers and window that produced it") | `spread-card-ai` is on the Spreads tab | Insert after it: `await openMarketTab(page, "Spreads");` |
| 3 | `market-spreads.spec.ts:60` | same line ("a refused pair keeps its card and shows the reason") | same | same insert |
| 4 | `market-spreads.spec.ts:73` | same line ("a computed pair renders its latest value and its chart") | same | same insert |
| 5 | `market-spreads.spec.ts:105` | same line ("the spreads section's event filter changes what is painted") | `spreads-events-filter` and the chart are on the Spreads tab | same insert |
| 6 | `market-spreads.spec.ts:126` | same line ("a spread chart is not rebuilt when the event filter changes") | same | same insert |
| 7 | `market-spreads.spec.ts:230` | same line ("a failed spreads request is shown as a failure, not as an empty page") | `spreads-section` is on the Spreads tab | same insert. `:234` (`/^spread-card-/` count 0) still holds. |
| 8 | `market-spreads.spec.ts:246` | same line ("a slow spreads request shows it is loading instead of nothing") | `spreads-loading` is on the Spreads tab | same insert. The request is held, so the query is still loading when the tab mounts. |
| 9 | `market-spreads.spec.ts:256` | same line ("an empty spreads list says so, and is not an error") | `spreads-section` is on the Spreads tab | same insert |
| 10 | `event-filter.spec.ts:5` | `import { addedColumns } from "./helpers/lineColor";` | rows #11–#12 | Insert after it: `import { openMarketTab } from "./helpers/marketTabs";` |
| 11 | `event-filter.spec.ts:28` | `await page.goto("/", { waitUntil: "domcontentloaded" });` (in `openOverview`, used by all 4 tests) | `spread-chart-ai` (`:29`) is on the Spreads tab | Insert after it: `await openMarketTab(page, "Spreads");`. After the reload at `:61` the Spreads tab is remembered, so `:62–65` pass. |
| 12 | `event-filter.spec.ts:67` | `await page.getByRole("button", { name: "Open detail for S&P 500" }).click();` | the card is on the Instruments tab; Spreads is still open | Insert **before** it: `await openMarketTab(page, "Instruments");`. The modal's shared filter (`:68`) is unchanged. |
| 13 | `events-page.spec.ts:5` | `import { addedColumns } from "./helpers/lineColor";` | row #14 | Insert after it: `import { openMarketTab } from "./helpers/marketTabs";` |
| 14 | `events-page.spec.ts:70` | `await page.goto("/", { waitUntil: "domcontentloaded" });` ("an added event is listed and then drawn on a chart") | `spread-chart-ai` (`:72`) is on the Spreads tab | Insert after it: `await openMarketTab(page, "Spreads");` |
| 15 | `market-overview.spec.ts:13` | `await expect(page.getByText("Real-time snapshot of major global and domestic indices")).toBeVisible();` | subtitle changed (spec §3, M-D5) | `await expect(page.getByText("Daily closes · indices, commodities, FX, crypto")).toBeVisible();` |
| 16 | `market-overview.live.spec.ts:7` | same line | same | same replacement |
| 17 | `market-overview.spec.ts` (no line) | — | — | **No edit.** Listed so that the file's other lines are known to be checked (see "Checked and unaffected"). |
| 18 | `corporate-model.spec.ts:370` | `expect(ONE_SCREEN_ROUTES).not.toContain("/");` | `"/"` joins the list (spec §2.1) | `expect(ONE_SCREEN_ROUTES).toContain("/");` |
| 19 | `corporate-model.spec.ts:374` | `expect(isOneScreenRoute("/")).toBe(false);` | same | `expect(isOneScreenRoute("/")).toBe(true);`. The intent the old line guarded is that `"/"` must not make every path one-screen. It moves to Task 4's new `market-model.spec.ts` test, which asserts `"/portfolio"`, `"/news"` and `"/detail/AAPL"` are false. |
| 20 | `corporate-model.spec.ts:368` | the test title `"the listed route and the paths under it are one-screen; a longer name is not"` | — | **No edit.** It is still true. |
| 21 | `helpers/marketPageMock.ts:62–64` | the `market/event-categories` branch, then `return route.continue();` | the header now requests `/market/regime`; without a branch it reaches the e2e API (N14) | Insert after the event-categories branch: `// The header's regime line (market one-screen plan, N14).` then `if (pathname === \`${API_PREFIX}/market/regime\` && method === "GET") { return json(route, cloneFixture(marketIndexDetailFixture["^GSPC"].market_regime)); }`. With no other change, every other path behaves as before. |

### Task 6 (cap 295 → 0)

| # | File:line | Current | Why it breaks | Replacement |
|---|---|---|---|---|
| 22 | `scripts/design-baseline-cap.test.mjs:5–6` | `test("the market warning cap is the recorded 295", …)` / `assert.equal(MARKET_WARN_CAP, 295);` | the cap becomes 0 (spec §3) | `test("the market warning cap is 0 after the market one-screen plan", …)` / `assert.equal(MARKET_WARN_CAP, 0);` |
| 23 | `scripts/design-baseline-cap.test.mjs:10` | `assert.equal(warnCapExceeded(295), false);` ("exactly at the cap passes") | at cap 0, 295 is over | `assert.equal(warnCapExceeded(0), false);`. It is the same property, at the new cap. |
| 24 | `scripts/design-baseline-cap.test.mjs:14` | `assert.equal(warnCapExceeded(296), true);` ("one warning over the cap fails") | cap + 1 is now 1 | `assert.equal(warnCapExceeded(1), true);` |
| 25 | `scripts/design-baseline-cap.test.mjs:18` | `assert.equal(warnCapExceeded(0), false);` ("fewer warnings than the cap pass") | at cap 0 nothing is fewer than the default cap | `assert.equal(warnCapExceeded(0, 5), false);`. This exercises the explicit `cap` parameter, so "fewer than the cap" is still asserted. |

**Per-file count:**

| File | Rows | Task |
|---|---|---|
| `tests/e2e/market-spreads.spec.ts` | 9 (#1–#9: 8 inserts + import) | 4 |
| `tests/e2e/event-filter.spec.ts` | 3 (#10–#12) | 4 |
| `tests/e2e/events-page.spec.ts` | 2 (#13–#14) | 4 |
| `tests/e2e/market-overview.spec.ts` | 1 edit (#15); #17 is a no-edit marker | 4 |
| `tests/e2e/market-overview.live.spec.ts` | 1 (#16) | 4 |
| `tests/e2e/corporate-model.spec.ts` | 2 edits (#18, #19); #20 is a no-edit marker | 4 |
| `tests/e2e/helpers/marketPageMock.ts` | 1 (#21) | 4 |
| `apps/web/scripts/design-baseline-cap.test.mjs` | 4 (#22–#25) | 6 |

That makes 23 edited lines plus two no-edit markers, 25 rows.

**Searched for and absent.** No existing test asserts the removed copy.
- `git grep -n "Market Dashboard\|Scan the market\|Detail available\|Market snapshot API\|columnheader\", { name: \"Source\"" -- apps/web/tests` finds nothing. The only `"Source"` hits are the corporate audit tables and the market modal's Data Quality tile, which stays.
- `responsive-accessibility.spec.ts:63` reads the columnheader "Instrument". It is kept as `BilingualLabel k="instrument"`, whose accessible name in English is "Instrument".

**Checked and unaffected** (re-grepped at `1e71ea7`: every spec that visits `/` or reads a market block):
- **`market-spreads.spec.ts:147–181` and `:183–221`** (monthly event placement; modal filter). They open an index card on the default Instruments tab. No edit.
- **`market-overview.spec.ts`.**
  - `:12` heading "Market Overview" (`exact`) is still the h1.
  - `:14–17`: "S&P 500", "^GSPC" (exact), "Nasdaq" and "^IXIC" each still match one element. The card ticker is its own `<span>`; the regime line and the spread row repeat none of them, and that test's spreads are `[]`.
  - `:23` awaits the spreads response. `SpreadFigureRow` on the default tab now fires it.
  - `:26–147`: every modal string is kept byte-identical (Global Constraints).
- **`market-overview.live.spec.ts:13–40`.** Modal-only; the strings are kept.
- **`candle-colour.spec.ts:31–33`, `candle-direction.spec.ts:31–33`.** They open S&P 500 on the default tab and read `[role="dialog"] canvas`. The modal chart keeps `var(--up)`/`var(--down)` (Task 6 maps `--delta-up` → `--up`, the same value).
- **`responsive-accessibility.spec.ts:43–64, 106–122`.** "Graph", "Table" and "Open detail for S&P 500" stay on the default tab. `toBeVisible` holds inside a scrolled panel. The "Instrument" columnheader is kept. Modal focus order (Close modal → View Full Detail) is unchanged.
- **`i18n.spec.ts`.** It queries nav **links** by name; the h1 "시장 개요" is a heading, not a link. The ko-browser hydration test is safe because every new string goes through `useT` (server snapshot `en`). No `toLocaleString(undefined)` remains after Task 6 (M5).
- **`font.spec.ts`.** It measures fonts only.
- **`tab-state-persistence.spec.ts:27, 81`.** It visits `/` only to navigate away. `:114–120` filters `moneyview.tab.portfolio.*` / `moneyview.tab.corporate.*`; the new `moneyview.tab.market.pageTab` is outside both.
- **`corporate-one-screen.spec.ts:251`.** It visits `/` only to navigate away.
- **`one-screen-no-scroll.spec.ts`.** It covers `/` automatically once it is listed. `DESIGN_SCREENS` already has `"/"` with `mockMarketPageApi`, so `:14` holds. Its coverage grows; the file is not edited.
- **`paper-sweep.spec.ts`.** It skips `/` until DS 14b (N15).
- **`design-capture.spec.ts`.** It asserts nothing. Its mask `article:has(button[aria-label^="Open detail for"])` still matches every card, because the English aria-label is kept.
- **`events-table-headers.spec.ts`, `records-sync-status.spec.ts`** (`/events` and `/decisions`), **`market-event-lines.spec.ts`** and **`sparkline-window-colour.spec.ts`** (`/portfolio`). None of them is this page's layout. `SparklineCard` is used only on `/`, so the portfolio sparkline spec does not render it.
- **`tests/api/test_market_index_detail.py`, `tests/api/test_market_spreads.py`.** The regime logic is unchanged and no existing Python test is edited.

---

## File structure

| Path | Change | Responsibility |
|---|---|---|
| `apps/api/services/market_data.py` | modify (crlf) | `get_market_regime()` public wrapper |
| `apps/api/routes/market.py` | modify (crlf) | `GET /regime` route and its docstring line |
| `docs/architecture/moneyview-api-reference.md` | modify (crlf) | one bullet for the route |
| `tests/api/test_market_regime_route.py` | create | route shape, unknown with 200, VIX not counted |
| `tests/api/test_market_regime_mutations.py` | create | in-memory mutation harness for the three route tests |
| `packages/shared-types/market.ts` | modify (crlf) | `MarketRegimeContext` |
| `apps/web/lib/useMarketRegime.ts` | create | `useMarketRegime()` |
| `apps/web/lib/useMarketSpreads.ts` | modify (crlf) | exports `DEFAULT_SPREAD_WINDOW_DAYS` (Task 5) |
| `apps/web/components/market/marketModel.ts` | create | `MarketIndexQuote`, `MARKET_PAGE_TABS`, `MARKET_PAGE_TAB_KEY`, `isMarketPageTab`, `regimeView`, `withFigures`, `spreadFigure` |
| `apps/web/components/market/FigureText.tsx` | create | renders `withFigures` parts, figures in mono |
| `apps/web/components/market/MarketRegimeLine.tsx` | create | the header's regime line |
| `apps/web/components/market/MarketHeader.tsx` | create | `PageHeader` with title, subtitle and the regime line |
| `apps/web/components/market/MarketPageTabs.tsx` | create | `useMarketPageTab`, `MarketPageTabs` |
| `apps/web/components/market/InstrumentsPanel.tsx` | create (Task 5) | toolbar, five-column cards or table, `SpreadFigureRow`; error and empty states |
| `apps/web/components/market/SpreadFigureRow.tsx` | create (Task 5) | one row of spread figures under the cards |
| `apps/web/components/market/MarketOverviewClient.tsx` | modify (lf) | page column, tabs, modal; paper and catalogs (Task 6) |
| `apps/web/components/market/SpreadsSection.tsx` | modify (crlf) | grid min 220 px (Task 4); paper and catalogs (Task 6) |
| `apps/web/components/data/SparklineCard.tsx` | modify (crlf) | about 233×134 card, no "Detail available", catalog aria-label |
| `apps/web/app/page.tsx` | modify (crlf) | fetch only; no wrapper and no header |
| `apps/web/components/ui/oneScreenRoutes.ts` | modify (crlf) | `"/"` added |
| `apps/web/lib/i18n/messages/{en,ko}.ts`, `lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md` | modify | `market.*` namespace; `instrument` and `absChange` labels; glossary rows |
| `apps/web/scripts/design-baseline-cap.mjs` | modify (crlf) | `MARKET_WARN_CAP = 0` |
| `DESIGN.md` | modify (lf) | the "Known exception" bullet states cap 0 |
| `apps/web/tests/e2e/helpers/marketTabs.ts` | create | `openMarketTab`, `marketPanel` |
| `apps/web/tests/e2e/market-model.spec.ts` | create | model tests (Tasks 3–4) |
| `apps/web/tests/e2e/market-one-screen.spec.ts` | create | page tests (Tasks 4–6) |
| `docs/superpowers/plans/2026-10-12-design-system-formalization.md`, `docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md`, `guideline/sop/todo.md` | modify (crlf) | Task 1 notes; Task 7 tracking |
| `docs/tabs/market-overview-tab.txt`, `docs/USER-GUIDE.md`, `docs/design/MoneyView_Interaction_Rules.md` | modify (Task 7) | the page as it now is |

**Height budget at 1280×720.** Measured inputs: `type-heading-5` has a 34 px line; the root runs from y=64 to y=696 (pad-top 4rem; one-screen pad-bottom 1.5rem).

| Block | Height | Bottom (y) |
|---|---|---|
| `PageHeader` (h1 34 + `mt-1` 4 + subtitle 22; regime line on the right, `min-h-6`) + `mb-6` | ≈ 84 | ≈ 148 |
| Tab bar (`Tabs` `min-h-10` + border) + `gap-3` | ≈ 53 | ≈ 201 |
| **Panel** | **≈ 495** | 696 |
| Instruments, graph: toolbar ≈ 30 + `gap-3` + cards 2 × 134 + 12 + `gap-3` + figure row ≈ 52 | ≈ 386 | inside the panel |
| Instruments, table: toolbar 30 + 12 + header 32 + 10 × 33 + 12 + 52 | ≈ 468 | inside the panel |
| Spreads: section padding + title + description + one row of five 214 px cards | ≈ 340 | inside the panel |

Task 5's fit test measures these boxes, and Task 5 Step 7 records the measured values.

---

### Task 1: Owner approval gate, sibling-plan notes, tracking

**Model:** the controller runs Steps 1–3. Haiku writes Steps 4–7 (exact text). Sonnet reviews.

**Files:**
- Modify: this plan (approval line), `docs/superpowers/plans/2026-10-12-design-system-formalization.md`, `docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md`, `guideline/sop/todo.md`

**Output contracts:** none (docs only). No test is edited in this task.

- [ ] **Step 1: Confirm the start point.** From the repo root:

```bash
git branch --show-current
git status --short
git log --oneline -1
```

Expected: the branch is `feat/market-one-screen`, and HEAD is the commit that added this plan (child of `1e71ea7`). `git status --short` may list untracked `data/error/…` and `design-sample/`; leave them alone. If a tracked file is modified, stop and report it.

- [ ] **Step 2: Present the inventory (OWNER APPROVAL GATE).** The controller shows the owner, verbatim:
  - the section "Existing-test change inventory": 25 rows, the per-file count, the "Searched for and absent" note and the "Checked and unaffected" list;
  - the "Narrowed or interpreted" table, N1–N15. The owner's decision is wanted on N2, N6 and N7 in particular; the plan recommends them as written.

  **STOP.** Do not dispatch Task 2 or any later task until the owner answers. If the owner rejects or changes a row, edit that row, and the task step that applies it, in this plan. Then present the changed rows again.

- [ ] **Step 3: Record the approval.** Under the heading `## Existing-test change inventory (owner approval required before any edit)`, replace `**Not yet approved.** Task 1 Step 2 presents this section verbatim, with the "Narrowed or interpreted" table.` with `**Approved by the owner on <YYYY-MM-DD>** (rows as listed; changes: <none | list>).`

- [ ] **Step 4: DS Task 13 drops market.** In `docs/superpowers/plans/2026-10-12-design-system-formalization.md`, under `### Task 13: Detail, news, events, dev (market and signals moved out)`, after the paragraph that starts `> **2026-10-15 (owner):** the market overview`, insert:

```markdown

> **2026-10-16:** the market part is `docs/superpowers/plans/2026-10-16-market-one-screen.md` (spec `docs/superpowers/specs/2026-10-16-market-one-screen-design.md`). It applies M1–M7 to `app/page.tsx`, `components/market/**` and `components/data/SparklineCard.tsx`, adds the market Korean assertion to `tests/e2e/market-one-screen.spec.ts`, and lowers the `design:baseline` market cap from 295 to 0 (`scripts/design-baseline-cap.mjs`). The market globs, specs and Korean assertion are struck from this task below.
```

  In the same task:
  - In the `**Globs:**` line, delete `` `app/page.tsx`, `components/market/**/*.tsx`, ``.
  - In the `**Specs:**` line, delete `` `market-*.spec.ts`, ``.
  - Change `**Korean assertion:** in `tests/e2e/market-overview.spec.ts`.` to `**Korean assertion:** in `tests/e2e/news-*.spec.ts` (or `detail-*`), per the 2026-10-15 note; the market's is in the market one-screen plan.`

  In `### Task 14b: Aliases removed, market override removed, final gate`, after the line that starts `> **Start only after the market one-screen plan has merged`, insert:

```markdown

> **2026-10-16:** that plan is `docs/superpowers/plans/2026-10-16-market-one-screen.md`. Its Task 7 records `design:baseline` warn 0 and `ONE_SCREEN_ROUTES` containing `"/"`, which are this task's preconditions 1–3. It does not touch `paper-sweep.spec.ts`; step 5 here still removes the `/` exclusion and fixes any computed-style violation it finds in the market files.
```

- [ ] **Step 5: UI-consolidation Tasks 5 and 7.** In `docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md`:
  - Directly under `### Task 5: Shared detail drawer; portfolio stock detail in it`, insert:

```markdown

> **2026-10-16 (market one-screen plan, Task 1):** pages in `ONE_SCREEN_ROUTES` (`/corporate`, `/`) never scroll, so the aside's `lg:sticky lg:top-0 lg:max-h-[calc(100vh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))]` in Step 3 assumes a scrolling page and is taller than a one-screen column. Where the layout's parent has a fixed height, use `lg:self-stretch lg:max-h-full` in place of `lg:self-start` and the sticky `max-h`: the aside then fills its parent and scrolls inside itself. Pages that scroll keep Step 3's classes. Re-run the Step 3 mutation row for `lg:sticky` against whichever classes are used.
```

  - Directly under `### Task 7: Market Overview detail in the shared drawer`, insert:

```markdown

> **2026-10-16 (market one-screen plan):** `/` is now a one-screen page with two page tabs (Instruments | Spreads). Read this task with these changes:
> - `DetailDrawerLayout` wraps the tab area (`MarketPageTabs`: the tab bar and its panel), not the whole page and not only the card grid. `MarketHeader` stays outside it. The aside uses the one-screen classes from the Task 5 note.
> - The card grid is `InstrumentsPanel`'s `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`. Recompute the container-query columns for it. With the drawer closed, keep 1 / 2 / 5 columns at 375 / 768 / 1280. With the drawer open at 1280, pick the count that keeps each card at least 220 px wide.
> - Switching page tabs closes the drawer (`MarketPageTabs`' `onChange` also clears `selectedIndex`).
> - The copy edits in Step 2 (items 3 and 6) are catalog edits now: `market.detail.*` in `lib/i18n/messages/en.ts`, with the `ko.ts` entry. They are not JSX literals.
> - The line numbers in Step 3 have moved. Locate each `Close modal` line by its code and re-verify the list against HEAD before editing.
```

- [ ] **Step 6: Track the work.** In `guideline/sop/todo.md`, under `### Track D: Design system (paper redesign)`, directly before the line that starts `- [x] D12 monte-carlo`, add:

```markdown
- Market one-screen: plan `docs/superpowers/plans/2026-10-16-market-one-screen.md`, spec `docs/superpowers/specs/2026-10-16-market-one-screen-design.md`, branch `feat/market-one-screen` (from `feat/design-system-paper` at `7abbf74`; merges back before D14b). Takes the market part of D13.
  - [x] M1 owner approval + notes  - [ ] M2 regime API  - [ ] M3 pure models  - [ ] M4 page frame, tabs, regime line  - [ ] M5 instruments tab  - [ ] M6 market on paper + en/ko (cap 295 → 0)  - [ ] M7 final gate
```

  In the line that starts `  - Market (`app/page.tsx` is already 0; `components/market/**` has 233 hits`, append: ` Re-measured 2026-10-16 at `1e71ea7`: 295 (typeScale 59, deprecatedVar 162, hex 3, paletteClass 6, lengthTypeVar 3, fontWeight 57, figureMono 3, roundedFull 2; `MarketOverviewClient.tsx` 264, `SpreadsSection.tsx` 31). Plan: `2026-10-16-market-one-screen.md`.`

- [ ] **Step 7: Commit.**

```bash
git add docs/superpowers/plans/2026-10-16-market-one-screen.md docs/superpowers/plans/2026-10-12-design-system-formalization.md docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md guideline/sop/todo.md
git commit -m "docs(plan): owner approved the market one-screen test inventory; DS Task 13 drops market; UI-consolidation Tasks 5 and 7 amended" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `GET /api/market/regime` (spec §2.5, M-D3)

**Model:** Haiku implements; Sonnet reviews.

**Parallel-safe.** pytest only, so no Playwright port is used. It can run in its own worktree while Tasks 3–6 run in the main checkout. From the repo root:

```bash
git worktree add .claude/worktrees/market-regime -b feat/market-regime-api feat/market-one-screen
```

Work and commit in `.claude/worktrees/market-regime`. In each shell there, set `PYTHONPATH` to the worktree root (`docs/git-worktrees.md` §4) and use `python -m pytest`, never `python <script>`. After the review, the controller brings the commit back from the main checkout with `git cherry-pick <sha>` on `feat/market-one-screen`, then runs `git worktree remove .claude/worktrees/market-regime` and `git branch -d feat/market-regime-api`. This must happen before Task 7.

**Files:**
- Modify: `apps/api/services/market_data.py` (crlf), `apps/api/routes/market.py` (crlf), `docs/architecture/moneyview-api-reference.md` (crlf)
- Create: `tests/api/test_market_regime_route.py`, `tests/api/test_market_regime_mutations.py` (LF)

**Output contracts:**

| name | signature | returns | units / format | cases | example | side effects |
|---|---|---|---|---|---|---|
| `MarketDataService.get_market_regime` (`market_data.py`) | `(self) -> MarketRegimeContext` | `MarketRegimeContext`: `regime_label: str`, `regime_summary: str`, `equity_advancers: int`, `equity_decliners: int`, `breadth_ratio: float \| None`, `equity_index_count: int`, `risk_on_signals: int`, `risk_off_signals: int`, `signal_count: int` | counts are whole numbers. `breadth_ratio` is a **fraction** (advancers / equity indices, 2 dp: `0.75`). `regime_label` is `"risk_on"`, `"mixed"`, `"risk_off"` or `"unknown"`. `regime_summary` is English prose. | **normal:** what `_build_market_regime_context()` returns, unchanged. **no bars / no equity index:** `regime_label="unknown"`, `breadth_ratio=None`, counts 0; not an exception. **`^VIX` bars:** never counted in `equity_*` (only `EQUITY_INDEX_TICKERS` = `^GSPC ^DJI ^IXIC ^KS200` are). **provider failure:** `get_stock_ohlcv` returns cached or empty bars as today, so this returns `unknown` or a partial count; it never raises for missing data. | deltas `^GSPC +0.8 ^DJI −0.2 ^IXIC +1.1 ^KS200 +0.4 GC=F −0.5 KRW=X −0.3 BTC-USD +2.0` → `{"regime_label": "risk_on", "equity_advancers": 3, "equity_decliners": 1, "breadth_ratio": 0.75, "equity_index_count": 4, "risk_on_signals": 5, "risk_off_signals": 0, "signal_count": 5, …}` | Calls `get_stock_ohlcv(ticker, period="1mo", table="indices")` once per `MARKET_INDICES` entry (10). A stale cache may be refreshed from Yahoo and written to `indices`, the same path as `GET /market/index/{t}/detail`. No new table, no other write. |
| `GET /api/v1/market/regime` (`routes/market.py`) | no parameters | `200`, `MarketRegimeContext` JSON | as above | **normal / unknown:** 200 (unknown is not an error). **server exception:** FastAPI's default 500, unchanged. **unknown parameters:** ignored. | `{"regime_label": "mixed", "regime_summary": "Breadth and cross-asset signals are mixed, …", "equity_advancers": 3, "equity_decliners": 1, "breadth_ratio": 0.75, "equity_index_count": 4, "risk_on_signals": 3, "risk_off_signals": 2, "signal_count": 5}` | as above, via the module-level `_svc` |

- [ ] **Step 1: Write the failing tests.** `tests/api/test_market_regime_route.py`:

```python
"""GET /api/v1/market/regime: the Market Overview header's regime line (market one-screen plan, Task 2).

Every test stubs get_stock_ohlcv on the route's own service instance, so no test reads a real
database or the network. tests/conftest.py also isolates the database and blocks sockets.
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schemas import StockOHLCV
from apps.api.routes import market as market_routes
from apps.api.services.market_data import EQUITY_INDEX_TICKERS, MARKET_INDICES

URL = "/api/v1/market/regime"
FIELDS = {
    "regime_label": str,
    "regime_summary": str,
    "equity_advancers": int,
    "equity_decliners": int,
    "breadth_ratio": (float, type(None)),
    "equity_index_count": int,
    "risk_on_signals": int,
    "risk_off_signals": int,
    "signal_count": int,
}
LABELS = {"risk_on", "mixed", "risk_off", "unknown"}

# The deltas of test_market_index_detail.py's builder test: risk_on, 3 of 4 equity indices up, 5 signals on.
RISK_ON = {"^GSPC": 0.8, "^DJI": -0.2, "^IXIC": 1.1, "^KS200": 0.4, "GC=F": -0.5, "CL=F": 0.3, "NG=F": -0.1, "KRW=X": -0.3, "BTC-USD": 2.0}


def _two_closes(delta_pct: float) -> list[StockOHLCV]:
    latest = date(2026, 4, 11)
    prev, last = 100.0, 100.0 * (1 + delta_pct / 100)
    return [
        StockOHLCV(date=(latest - timedelta(days=1)).isoformat(), open=prev, high=prev, low=prev, close=prev, volume=1),
        StockOHLCV(date=latest.isoformat(), open=prev, high=last, low=prev, close=last, volume=1),
    ]


def _stub_bars(monkeypatch, deltas: dict[str, float]) -> list[tuple[str, str, str]]:
    """Answers get_stock_ohlcv on the route's service from `deltas`; any other ticker gets no bars."""
    requested: list[tuple[str, str, str]] = []

    def fake(ticker, period="5y", table="stocks", refresh="inline"):
        requested.append((ticker, period, table))
        return _two_closes(deltas[ticker]) if ticker in deltas else []

    monkeypatch.setattr(market_routes._svc, "get_stock_ohlcv", fake)
    return requested


def test_the_route_returns_the_regime_context_with_every_field_typed(monkeypatch):
    requested = _stub_bars(monkeypatch, RISK_ON)

    response = TestClient(app).get(URL)

    assert response.status_code == 200, f"status {response.status_code}: {response.text}"
    body = response.json()
    assert set(body) == set(FIELDS), f"fields {sorted(body)}"
    for name, kind in FIELDS.items():
        assert isinstance(body[name], kind), f"{name} is {body[name]!r}"
    assert body["regime_label"] in LABELS, f"regime_label {body['regime_label']!r}"
    assert (body["regime_label"], body["equity_advancers"], body["equity_decliners"], body["equity_index_count"]) == ("risk_on", 3, 1, 4), body
    assert (body["risk_on_signals"], body["risk_off_signals"], body["signal_count"], body["breadth_ratio"]) == (5, 0, 5, 0.75), body
    # The side effect the contract names: one 1mo read of the indices table per registered instrument.
    assert sorted(requested) == sorted((ticker, "1mo", "indices") for ticker in MARKET_INDICES.values()), requested


def test_no_bars_is_an_unknown_regime_with_200_not_an_error(monkeypatch):
    _stub_bars(monkeypatch, {})

    response = TestClient(app).get(URL)

    assert response.status_code == 200, f"status {response.status_code}: {response.text}"
    body = response.json()
    assert body["regime_label"] == "unknown", f"regime_label {body['regime_label']!r}"
    assert (body["equity_index_count"], body["signal_count"], body["breadth_ratio"]) == (0, 0, None), body


def test_vix_bars_are_not_counted_as_an_equity_index(monkeypatch):
    # The precondition that makes the case meaningful: VIX is fetched with the indices but is not an equity index.
    assert "^VIX" in MARKET_INDICES.values() and "^VIX" not in EQUITY_INDEX_TICKERS
    _stub_bars(monkeypatch, {"^VIX": 5.0, "^GSPC": 0.8})

    body = TestClient(app).get(URL).json()

    assert body["equity_index_count"] == 1, f"equity_index_count {body['equity_index_count']}: ^VIX was counted"
    assert (body["equity_advancers"], body["equity_decliners"]) == (1, 0), body
```

- [ ] **Step 2: Run to see them fail.** From the repo (or worktree) root:

```bash
C:/Users/eajwa/anaconda3/envs/moneyview/python.exe -m pytest tests/api/test_market_regime_route.py -q
```

Expected: 3 failures.
- The shape and no-bars tests fail with `status 404: {"detail":"Not Found"}`.
- The VIX test fails with `KeyError: 'equity_index_count'`, because the 404 body has no such key.

Record them in the task report.

- [ ] **Step 3: The wrapper.** In `apps/api/services/market_data.py`, directly above `    def _build_market_regime_context(self) -> MarketRegimeContext:`, insert:

```python
    def get_market_regime(self) -> MarketRegimeContext:
        """Breadth and cross-asset regime for the Market Overview header (GET /api/v1/market/regime).

        The same computation the index detail embeds; this only makes it public. Too little data
        is not an error: the builder returns regime_label="unknown" with zero counts.
        """
        return self._build_market_regime_context()

```

- [ ] **Step 4: The route.** In `apps/api/routes/market.py`:
  1. In the module docstring, after the line `GET /api/market/spreads            → theme and policy relative-strength spreads`, add the line `GET /api/market/regime             → breadth and cross-asset regime for the overview header`.
  2. In the `from apps.api.models.schemas import (` list, add `    MarketRegimeContext,` after `    MarketIndexDetail,`.
  3. Directly after the `get_all_indices` route function (it ends with `    return _svc.get_all_indices()`), insert:

```python


@router.get("/regime", response_model=MarketRegimeContext)
def get_market_regime():
    """Breadth and cross-asset regime from the tracked indices' last two closes.

    Always 200: with too few bars the label is "unknown". Reading may refresh a stale `indices`
    cache through get_stock_ohlcv, the same path the index detail takes.
    """
    return _svc.get_market_regime()
```

- [ ] **Step 5: Run.** The same command as Step 2. Expected: 3 passed.

- [ ] **Step 6: The mutation harness.** Create `tests/api/test_market_regime_mutations.py`:

```python
"""Mutation harness for test_market_regime_route.py (CLAUDE.md §8, guideline/sop/test-verification.md).

Each case breaks the code in memory with monkeypatch, runs one route test with the same
monkeypatch, and requires it to fail for the named reason. Nothing here writes a source file.
"""

from __future__ import annotations

import inspect
import textwrap

import pytest

from apps.api.main import app
from apps.api.models.schemas import MarketRegimeContext
from apps.api.services import market_data
from apps.api.services.market_data import MarketDataService
from tests.api import test_market_regime_route as route_tests

_EMPTY_GUARD = "round(equity_advancers / len(equity_quotes), 2) if equity_quotes else None"


def _builder_without_the_empty_guard():
    """The builder as it would be if the `if equity_quotes else None` guard were dropped."""
    source = textwrap.dedent(inspect.getsource(MarketDataService._build_market_regime_context))
    assert source.count(_EMPTY_GUARD) == 1, "anchor moved: re-verify the no-bars test against the new builder"
    namespace = dict(vars(market_data))
    exec(compile(source.replace(_EMPTY_GUARD, "round(equity_advancers / len(equity_quotes), 2)"), market_data.__file__, "exec"), namespace)
    return namespace["_build_market_regime_context"]


def test_a_wrapper_that_skips_the_builder_fails_the_shape_test(monkeypatch):
    monkeypatch.setattr(MarketDataService, "get_market_regime", lambda self: MarketRegimeContext())
    with pytest.raises(AssertionError, match="regime_label ''"):
        route_tests.test_the_route_returns_the_regime_context_with_every_field_typed(monkeypatch)


def test_an_unregistered_route_fails_the_shape_test(monkeypatch):
    kept = [route for route in app.router.routes if getattr(route, "path", None) != route_tests.URL]
    assert len(kept) == len(app.router.routes) - 1, "the route is registered exactly once"
    monkeypatch.setattr(app.router, "routes", kept)
    with pytest.raises(AssertionError, match="status 404"):
        route_tests.test_the_route_returns_the_regime_context_with_every_field_typed(monkeypatch)


def test_a_builder_without_the_empty_guard_fails_the_no_bars_test(monkeypatch):
    monkeypatch.setattr(MarketDataService, "_build_market_regime_context", _builder_without_the_empty_guard())
    with pytest.raises(ZeroDivisionError):
        route_tests.test_no_bars_is_an_unknown_regime_with_200_not_an_error(monkeypatch)


def test_counting_vix_as_an_equity_index_fails_the_vix_test(monkeypatch):
    monkeypatch.setattr(market_data, "EQUITY_INDEX_TICKERS", (*market_data.EQUITY_INDEX_TICKERS, "^VIX"))
    with pytest.raises(AssertionError, match="equity_index_count 2"):
        route_tests.test_vix_bars_are_not_counted_as_an_equity_index(monkeypatch)
```

- [ ] **Step 7: Run the harness and the market module's tests.**

```bash
C:/Users/eajwa/anaconda3/envs/moneyview/python.exe -m pytest tests/api/test_market_regime_route.py tests/api/test_market_regime_mutations.py tests/api/test_market_index_detail.py tests/api/test_market_spreads.py -q
```

Expected: all pass. That means 4 harness cases, each proving its route test fails for the named reason.
- If a harness case fails because the target test **passed** under its mutation, that route test is unverified. Report it, and fix the test, not the harness.
- `git diff --ignore-cr-at-eol --stat apps/api/services/market_data.py` must show only the wrapper's lines: the harness writes no file.

- [ ] **Step 8: API reference.** In `docs/architecture/moneyview-api-reference.md`, after the bullet ``- `GET /api/v1/market/index/{ticker}` returns `List[StockOHLCV]` ``, add ``- `GET /api/v1/market/regime` returns `MarketRegimeContext` (always 200; `regime_label` "unknown" when there is too little data)``.

- [ ] **Step 9: Full pytest.** From the worktree root: `C:/Users/eajwa/anaconda3/envs/moneyview/python.exe -m pytest -q`. Expected: the D14a count (1883 passed) plus 7.

- [ ] **Step 10: Commit** (in the worktree). In the main checkout's `todo.md`, the controller ticks `M2` after the cherry-pick.

```bash
git add apps/api/services/market_data.py apps/api/routes/market.py docs/architecture/moneyview-api-reference.md tests/api/test_market_regime_route.py tests/api/test_market_regime_mutations.py
git commit -m "feat(market): GET /api/market/regime serves the existing regime context" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure market models, the regime hook, the shared type

**Model:** Haiku implements; Sonnet reviews.

**Files:**
- Create: `apps/web/components/market/marketModel.ts`, `apps/web/lib/useMarketRegime.ts`, `apps/web/tests/e2e/market-model.spec.ts` (LF)
- Modify: `packages/shared-types/market.ts` (crlf), `apps/web/components/market/MarketOverviewClient.tsx` (type moves only), `apps/web/lib/i18n/messages/{en,ko}.ts`, `docs/design/MoneyView_Glossary.md`

**Output contracts:**

| name | signature | returns | units / format | cases | example | side effects |
|---|---|---|---|---|---|---|
| `MarketRegimeContext` (`packages/shared-types/market.ts`) | interface | the nine fields of the Task 2 contract; `regime_label: string` (N11) | as Task 2 | — | — | none |
| `useMarketRegime` (`lib/useMarketRegime.ts`) | `(): MarketRegimeState` where `MarketRegimeState = { status: "loading" \| "ready" \| "error"; regime: MarketRegimeContext \| null }` | the state | — | **loading:** no data yet (also the server render) → `{ status: "loading", regime: null }`. **ready:** 200 → `{ status: "ready", regime }`. **error:** non-2xx or network → `{ status: "error", regime: null }`, not retried (N10). **empty:** n/a, always one object. | 200 with the Task 2 example → `{ status: "ready", regime: { regime_label: "mixed", … } }` | One `GET /api/v1/market/regime` per mount while the cache (key `["market-regime"]`, 15 min) is stale. No refetch on focus. No write. |
| `MARKET_PAGE_TABS`, `MarketPageTab`, `MARKET_PAGE_TAB_KEY` (`marketModel.ts`) | `readonly ["instruments", "spreads"]`; union; `string` | — | key `"moneyview.tab.market.pageTab"`, JSON value (`'"spreads"'`) | — | — | none |
| `isMarketPageTab` | `(value: unknown): value is MarketPageTab` | `boolean` | — | `"instruments"`/`"spreads"` → true. `"constructor"`, `"toString"`, `"summary"`, `""`, `null`, `undefined`, `0` → false. Never throws. | `"spreads"` → `true` | none |
| `regimeView` | `(state: MarketRegimeState): RegimeView` where `RegimeView = { kind: "loading" } \| { kind: "error" } \| { kind: "unknown" } \| { kind: "ready"; labelKey: MessageKey; tone: "up" \| "down" \| "neutral"; advancers: number; indexCount: number; riskOn: number; riskOff: number }` | the view | the counts are the backend's integers, unchanged | **loading** → `{kind:"loading"}`. **error** → `{kind:"error"}`. **ready** with label `risk_on` / `mixed` / `risk_off` and `equity_index_count > 0` → `ready` with `market.regime.riskOn` + `up` / `market.regime.mixed` + `neutral` / `market.regime.riskOff` + `down`. **ready** with `unknown`, any other label (including `"constructor"`, `""`), `equity_index_count ≤ 0`, or `regime: null` → `{kind:"unknown"}`. Never throws. | `{status:"ready", regime:{regime_label:"risk_on", equity_advancers:3, equity_index_count:4, risk_on_signals:5, risk_off_signals:0, …}}` → `{kind:"ready", labelKey:"market.regime.riskOn", tone:"up", advancers:3, indexCount:4, riskOn:5, riskOff:0}` | none |
| `withFigures` | `(template: string, figures: Record<string, string>): FigurePart[]` where `FigurePart = { kind: "text" \| "figure"; text: string }` | parts in template order | figures are already formatted strings | **normal:** each `{name}` with an own value → a `figure` part, and the text between → `text` parts. **missing value** (including prototype names) → the placeholder stays as a `text` part `"{name}"`, visible like `translate`'s unknown key. **no placeholder** → one `text` part. **empty template** → `[]`. | `("Indices up {breadth}", { breadth: "3/4" })` → `[{kind:"text", text:"Indices up "}, {kind:"figure", text:"3/4"}]` | none |
| `spreadFigure` | `(spread: MarketSpread): SpreadFigure` where `SpreadFigure = { id: string; label: string; pair: string; latest: number \| null; refused: boolean }` | the figure | `latest` is the series' last value, indexed to 100 at the window start (103.4 means +3.4 % relative); `pair` is `"<numerator>/<denominator>"` | **computed** (`refused_reason === null`) → `latest` as sent (it can be `null`), `refused: false`. **refused** → `latest: null` even if a value was sent, `refused: true`. | `{id:"ai", label:"AI", numerator:"BOTZ", denominator:"^GSPC", latest:103.4, refused_reason:null, …}` → `{id:"ai", label:"AI", pair:"BOTZ/^GSPC", latest:103.4, refused:false}` | none |
| `MarketIndexQuote` (moved to `marketModel.ts`) | interface, unchanged fields | — | `last_close` in instrument units; `delta.delta_pct` in **percent** (1.24 = +1.24 %); `delta.delta_abs` in instrument units | — | — | `MarketOverviewClient` re-exports it, so `app/page.tsx`'s import still resolves |

- [ ] **Step 1: Shared type.** Append to `packages/shared-types/market.ts` (keep CRLF):

```ts

/**
 * Breadth and cross-asset regime from the tracked indices' last two closes. Mirrors
 * `MarketRegimeContext` in `apps/api/models/schema_parts/market.py`; served by GET /api/v1/market/regime.
 *
 * `regime_label` is "risk_on" | "mixed" | "risk_off" | "unknown" today. It is typed as a string
 * because the backend types it so, and the UI reads any other value as unknown. `regime_summary` is
 * English prose and is never rendered (spec §2.5). Counts are whole numbers; `breadth_ratio` is a
 * fraction (0.75 = three of four equity indices up), null when no equity index had two closes.
 */
export interface MarketRegimeContext {
  regime_label: string;
  regime_summary: string;
  equity_advancers: number;
  equity_decliners: number;
  breadth_ratio: number | null;
  equity_index_count: number;
  risk_on_signals: number;
  risk_off_signals: number;
  signal_count: number;
}
```

- [ ] **Step 2: Catalog and glossary.** Task 4 renders these keys; `regimeView` references the three label keys by type.
  - In `lib/i18n/messages/en.ts`, directly before the line `  news: {`, add:

```ts
  market: {
    title: "Market Overview",
    subtitle: "Daily closes · indices, commodities, FX, crypto",
    tabs: { aria: "Market sections", instruments: "Instruments", spreads: "Spreads" },
    regime: {
      riskOn: "Risk-on",
      mixed: "Mixed",
      riskOff: "Risk-off",
      breadth: "Indices up {breadth}",
      signals: "Signals on {on} / off {off}",
      unknown: "Regime unavailable",
      error: "Regime could not be loaded.",
    },
  },
```

  - In `ko.ts`, directly before `  news: {`, add:

```ts
  market: {
    title: "시장 개요",
    subtitle: "일별 종가 · 지수, 원자재, 환율, 암호화폐",
    tabs: { aria: "시장 화면 구분", instruments: "종목", spreads: "스프레드" },
    regime: {
      riskOn: "위험선호",
      mixed: "혼조",
      riskOff: "위험회피",
      breadth: "지수 {breadth} 상승",
      signals: "선호 {on} / 회피 {off}",
      unknown: "국면 판단 불가",
      error: "국면을 불러오지 못했습니다.",
    },
  },
```

  - Append to the glossary table in `docs/design/MoneyView_Glossary.md`:

```markdown
| Instruments | 종목 | market page tab |
| Spreads | 스프레드 | market page tab; a theme's relative strength against a benchmark |
| Risk-on / Mixed / Risk-off | 위험선호 / 혼조 / 위험회피 | market regime label |
| Regime unavailable | 국면 판단 불가 | market regime with too little data |
| Daily closes | 일별 종가 | market subtitle |
| Commodities / FX / Crypto | 원자재 / 환율 / 암호화폐 | market subtitle and instrument types |
```

- [ ] **Step 3: Write the failing model tests.** `apps/web/tests/e2e/market-model.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import type { MarketRegimeContext, MarketSpread } from "../../../../packages/shared-types";
import {
  isMarketPageTab,
  MARKET_PAGE_TAB_KEY,
  MARKET_PAGE_TABS,
  regimeView,
  spreadFigure,
  withFigures,
} from "../../components/market/marketModel";

const REGIME: MarketRegimeContext = {
  regime_label: "risk_on",
  regime_summary: "Most tracked equity indices are advancing and cross-asset signals lean toward pro-cyclical risk appetite.",
  equity_advancers: 3,
  equity_decliners: 1,
  breadth_ratio: 0.75,
  equity_index_count: 4,
  risk_on_signals: 5,
  risk_off_signals: 0,
  signal_count: 5,
};
const ready = (overrides: Partial<MarketRegimeContext> = {}) => ({ status: "ready" as const, regime: { ...REGIME, ...overrides } });

test.describe("regimeView", () => {
  test("each known label maps to its catalog key and tone, with the backend's counts as sent", () => {
    expect(regimeView(ready())).toEqual({
      kind: "ready", labelKey: "market.regime.riskOn", tone: "up", advancers: 3, indexCount: 4, riskOn: 5, riskOff: 0,
    });
    expect(regimeView(ready({ regime_label: "mixed" }))).toMatchObject({ kind: "ready", labelKey: "market.regime.mixed", tone: "neutral" });
    expect(regimeView(ready({ regime_label: "risk_off" }))).toMatchObject({ kind: "ready", labelKey: "market.regime.riskOff", tone: "down" });
  });

  test("unknown is its own state, never mixed", () => {
    expect(regimeView(ready({ regime_label: "unknown" }))).toEqual({ kind: "unknown" });
  });

  test("regimeView reads only its own labels", () => {
    for (const label of ["constructor", "toString", "__proto__", "hasOwnProperty", "", "RISK_ON"]) {
      expect(regimeView(ready({ regime_label: label })), label).toEqual({ kind: "unknown" });
    }
  });

  test("no equity index means unknown, whatever the label", () => {
    expect(regimeView(ready({ regime_label: "mixed", equity_index_count: 0, equity_advancers: 0 }))).toEqual({ kind: "unknown" });
  });

  test("loading and error carry no regime; ready without a payload is unknown", () => {
    expect(regimeView({ status: "loading", regime: null })).toEqual({ kind: "loading" });
    expect(regimeView({ status: "error", regime: null })).toEqual({ kind: "error" });
    expect(regimeView({ status: "ready", regime: null })).toEqual({ kind: "unknown" });
  });
});

test.describe("withFigures", () => {
  test("splits a template so each figure is its own part, in either word order", () => {
    expect(withFigures("Indices up {breadth}", { breadth: "3/4" })).toEqual([
      { kind: "text", text: "Indices up " },
      { kind: "figure", text: "3/4" },
    ]);
    expect(withFigures("지수 {breadth} 상승", { breadth: "3/4" })).toEqual([
      { kind: "text", text: "지수 " },
      { kind: "figure", text: "3/4" },
      { kind: "text", text: " 상승" },
    ]);
  });

  test("a placeholder with no value stays visible as text", () => {
    expect(withFigures("Signals on {on} / off {off}", { on: "5" })).toEqual([
      { kind: "text", text: "Signals on " },
      { kind: "figure", text: "5" },
      { kind: "text", text: " / off " },
      { kind: "text", text: "{off}" },
    ]);
  });

  test("no placeholder is one text part; a prototype name is not a value; an empty template is nothing", () => {
    expect(withFigures("Regime unavailable", {})).toEqual([{ kind: "text", text: "Regime unavailable" }]);
    expect(withFigures("{constructor}", {})).toEqual([{ kind: "text", text: "{constructor}" }]);
    expect(withFigures("", {})).toEqual([]);
  });
});

test("isMarketPageTab accepts the two tabs and rejects prototype names and junk", () => {
  expect(MARKET_PAGE_TABS).toEqual(["instruments", "spreads"]);
  expect(MARKET_PAGE_TAB_KEY).toBe("moneyview.tab.market.pageTab");
  for (const tab of MARKET_PAGE_TABS) expect(isMarketPageTab(tab), tab).toBe(true);
  for (const junk of ["constructor", "toString", "summary", "", null, undefined, 0]) {
    expect(isMarketPageTab(junk), String(junk)).toBe(false);
  }
});

const SPREAD: MarketSpread = {
  id: "ai", label: "AI", numerator: "BOTZ", denominator: "^GSPC", requested_window_days: 90,
  actual_window_start: "2026-06-15", actual_window_end: "2026-09-11", actual_window_days: 88, observations: 62,
  basis: "(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15",
  series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }],
  latest: 103.4, refused_reason: null,
};

test.describe("spreadFigure", () => {
  test("a computed pair carries its value and both tickers", () => {
    expect(spreadFigure(SPREAD)).toEqual({ id: "ai", label: "AI", pair: "BOTZ/^GSPC", latest: 103.4, refused: false });
  });

  test("a refused pair has no value, even if one is sent", () => {
    expect(spreadFigure({ ...SPREAD, refused_reason: "insufficient overlapping history", latest: 100, series: [] }))
      .toEqual({ id: "ai", label: "AI", pair: "BOTZ/^GSPC", latest: null, refused: true });
  });
});
```

- [ ] **Step 4: Run to see it fail.** `npx playwright test tests/e2e/market-model.spec.ts --workers=2`. Expected: FAIL to load; `../../components/market/marketModel` is not found.

- [ ] **Step 5: `apps/web/components/market/marketModel.ts`** (new, LF):

```ts
import type { MarketSpread } from "../../../../packages/shared-types";
import type { MessageKey } from "@/lib/i18n/translate";
import { tabStateKey } from "@/lib/tabState";
import type { MarketRegimeState } from "@/lib/useMarketRegime";

/** One instrument card: GET /api/v1/market/indices (IndexQuote). `delta.delta_pct` is in percent (1.24 = +1.24%). */
export interface MarketIndexQuote {
  name: string;
  ticker: string;
  instrument_type?: string;
  last_close: number | null;
  delta: {
    delta_pct: number;
    delta_abs?: number | null;
  };
  sparkline: number[];
  /** Not sent by IndexQuote today, so cards show the "Snapshot" fallback (plan N8). */
  period?: string | null;
}

// Spec §2.1: the overview's two page tabs, in order.
export const MARKET_PAGE_TABS = ["instruments", "spreads"] as const;
export type MarketPageTab = (typeof MARKET_PAGE_TABS)[number];
/** sessionStorage key "moneyview.tab.market.pageTab"; useTabState stores the value as JSON. */
export const MARKET_PAGE_TAB_KEY = tabStateKey("market", "pageTab");

export const isMarketPageTab = (value: unknown): value is MarketPageTab =>
  typeof value === "string" && (MARKET_PAGE_TABS as readonly string[]).includes(value);

export type RegimeTone = "up" | "down" | "neutral";

// Spec §2.5: risk-on is the up colour, risk-off the down colour, mixed plain ink. "unknown" is not
// here on purpose: it has its own state and is never drawn as mixed.
const REGIME_LABELS = {
  risk_on: { key: "market.regime.riskOn", tone: "up" },
  mixed: { key: "market.regime.mixed", tone: "neutral" },
  risk_off: { key: "market.regime.riskOff", tone: "down" },
} as const satisfies Record<string, { key: MessageKey; tone: RegimeTone }>;

export type RegimeView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "unknown" }
  | { kind: "ready"; labelKey: MessageKey; tone: RegimeTone; advancers: number; indexCount: number; riskOn: number; riskOff: number };

/**
 * What the header's regime line shows. The counts are the backend's, as sent: the frontend counts
 * nothing, because which tickers are equity indices (^VIX is not) is decided only in the backend.
 * Own keys only, so a label such as "constructor" reads as unknown instead of reaching Object.prototype.
 */
export function regimeView({ status, regime }: MarketRegimeState): RegimeView {
  if (status === "loading") return { kind: "loading" };
  if (status === "error") return { kind: "error" };
  if (regime === null || regime.equity_index_count <= 0 || !Object.hasOwn(REGIME_LABELS, regime.regime_label)) {
    return { kind: "unknown" };
  }
  const { key, tone } = REGIME_LABELS[regime.regime_label as keyof typeof REGIME_LABELS];
  return {
    kind: "ready",
    labelKey: key,
    tone,
    advancers: regime.equity_advancers,
    indexCount: regime.equity_index_count,
    riskOn: regime.risk_on_signals,
    riskOff: regime.risk_off_signals,
  };
}

export type FigurePart = { kind: "text" | "figure"; text: string };

/**
 * Splits a translated template on its {name} placeholders, so each figure can be set in mono
 * (DESIGN.md: a figure inside a sentence is wrapped in type-mono). The word order stays the
 * catalog's. A placeholder with no own value is kept as text, so a missing figure is visible.
 */
export function withFigures(template: string, figures: Record<string, string>): FigurePart[] {
  const parts: FigurePart[] = [];
  let last = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: "text", text: template.slice(last, at) });
    parts.push(Object.hasOwn(figures, match[1]) ? { kind: "figure", text: figures[match[1]] } : { kind: "text", text: match[0] });
    last = at + match[0].length;
  }
  if (last < template.length) parts.push({ kind: "text", text: template.slice(last) });
  return parts;
}

/** One spread on the first screen (spec §2.3): the tickers are always named, and a refused pair has no value. */
export interface SpreadFigure {
  id: string;
  label: string;
  /** "BOTZ/^GSPC": the proxy is named every time a figure is. */
  pair: string;
  /** The latest value, indexed to 100 at the window start; null when refused or not sent. */
  latest: number | null;
  refused: boolean;
}

export function spreadFigure(spread: MarketSpread): SpreadFigure {
  const refused = spread.refused_reason !== null;
  return {
    id: spread.id,
    label: spread.label,
    pair: `${spread.numerator}/${spread.denominator}`,
    latest: refused ? null : spread.latest,
    refused,
  };
}
```

- [ ] **Step 6: `apps/web/lib/useMarketRegime.ts`** (new, LF):

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type { MarketRegimeContext } from "../../../packages/shared-types";

export type MarketRegimeStatus = "loading" | "ready" | "error";

export interface MarketRegimeState {
  status: MarketRegimeStatus;
  /** The payload when status is "ready"; null otherwise. */
  regime: MarketRegimeContext | null;
}

/**
 * The regime line in the Market Overview header (spec §2.5). Fetched in the browser, not on the
 * server, so a Playwright page.route can answer it. One request per mount while the cache is stale.
 * A failure is not retried (plan N10): the line says so instead of waiting through three retries.
 */
export function useMarketRegime(): MarketRegimeState {
  const query = useQuery({
    queryKey: ["market-regime"],
    queryFn: () => fetchApi<MarketRegimeContext>("/market/regime"),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (query.isError) return { status: "error", regime: null };
  if (query.data === undefined) return { status: "loading", regime: null };
  return { status: "ready", regime: query.data };
}
```

- [ ] **Step 7: Move the two types out of `MarketOverviewClient.tsx`** (keep LF):
  1. Delete the block from `export interface MarketIndexQuote {` through its closing `}` (13 lines).
  2. Delete the block from `interface MarketRegimeContext {` through its closing `}` (11 lines).
  3. After the last import line (`import { useMarketEvents } from "@/lib/useMarketEvents";`), add:

```ts
import type { MarketRegimeContext } from "../../../../packages/shared-types";
import type { MarketIndexQuote } from "@/components/market/marketModel";

export type { MarketIndexQuote };
```

  `app/page.tsx` still imports `type MarketIndexQuote` from `MarketOverviewClient`. Nothing else changes.

- [ ] **Step 8: Run.** `npx playwright test tests/e2e/market-model.spec.ts tests/e2e/i18n-model.spec.ts --workers=2`. Expected: PASS. Then `npm run typecheck && npm run lint && npm run test:unit`, and `npm run design:baseline -- components/market/marketModel.ts lib/useMarketRegime.ts`, which must report 0 in every category.

- [ ] **Step 9: Mutation matrix** (Global Constraints procedure)

| # | Mutation (in `marketModel.ts` unless named) | Must fail |
|---|---|---|
| 1 | `!Object.hasOwn(REGIME_LABELS, regime.regime_label)` → `!(regime.regime_label in REGIME_LABELS)` | `regimeView reads only its own labels` ("constructor" gives a `ready` view with `labelKey` undefined) |
| 2 | delete `regime.equity_index_count <= 0 \|\| ` | `no equity index means unknown, whatever the label` |
| 3 | add `unknown: { key: "market.regime.mixed", tone: "neutral" },` to `REGIME_LABELS` | `unknown is its own state, never mixed` |
| 4 | `risk_on` tone `"up"` → `"down"` | `each known label maps to its catalog key and tone…` |
| 5 | in `withFigures`, `{ kind: "text", text: match[0] }` → `{ kind: "figure", text: figures[match[1]] ?? "" }` | `a placeholder with no value stays visible as text` |
| 6 | `isMarketPageTab` body → `typeof value === "string" && value in { instruments: 1, spreads: 1 }` | `isMarketPageTab accepts the two tabs and rejects prototype names and junk` ("constructor" → true) |
| 7 | `latest: refused ? null : spread.latest` → `latest: spread.latest` | `a refused pair has no value, even if one is sent` |
| 8 | ``pair: `${spread.numerator}/${spread.denominator}` `` → `pair: spread.label` | `a computed pair carries its value and both tickers` |
| 9 | `tabStateKey("market", "pageTab")` → `tabStateKey("market", "tab")` | `isMarketPageTab accepts…` (the key assertion) |

- [ ] **Step 10: Commit.** In `todo.md` Track D, tick `M3`.

```bash
git add apps/web/components/market/marketModel.ts apps/web/components/market/MarketOverviewClient.tsx apps/web/lib/useMarketRegime.ts apps/web/lib/i18n packages/shared-types/market.ts apps/web/tests/e2e/market-model.spec.ts docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(market): pure models for the page tabs, the regime line and spread figures; useMarketRegime" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Page frame, page tabs, regime line, one-screen route (spec §1, §2.1, §2.4, §2.5)

**Model:** Haiku implements; Sonnet reviews. **This task changes `components/ui/oneScreenRoutes.ts`, a shared surface, so it runs the full Playwright suite (Step 12).**

**Files:**
- Create: `apps/web/components/market/FigureText.tsx`, `MarketRegimeLine.tsx`, `MarketHeader.tsx`, `MarketPageTabs.tsx`, `apps/web/tests/e2e/helpers/marketTabs.ts`, `apps/web/tests/e2e/market-one-screen.spec.ts` (all LF)
- Modify: `apps/web/app/page.tsx` (crlf), `apps/web/components/market/MarketOverviewClient.tsx` (lf), `apps/web/components/market/SpreadsSection.tsx` (crlf, one line), `apps/web/components/ui/oneScreenRoutes.ts` (crlf), `apps/web/tests/e2e/market-model.spec.ts` (plan-owned, append)
- Approved test edits: inventory #1–#21, only after Task 1 recorded the approval

**Output contracts:**

| name | signature | returns / renders | units / format | cases | example | side effects |
|---|---|---|---|---|---|---|
| `isOneScreenRoute` (`oneScreenRoutes.ts`) | `(pathname: string): boolean` | `boolean` | — | `"/"` → true. `"/corporate"`, `"/corporate/x"` → true. `"/portfolio"`, `"/news"`, `"/detail/AAPL"`, `"/corporate-xyz"` → false. `""` → false. | `"/"` → `true` | `AppShell` gives `/` the 24 px lg bottom pad |
| `FigureText` | `({ parts }: { parts: FigurePart[] }) => JSX` | one `<span>` per part; a figure part gets `className="type-mono"` | — | `[]` → nothing | `[{text "Indices up "}, {figure "3/4"}]` → `<span>Indices up </span><span class="type-mono">3/4</span>` | none |
| `MarketRegimeLine` | `() => JSX` | `<p data-testid="market-regime" data-state="loading\|ready\|unknown\|error" class="… min-h-6 …">` | integers via `formatNumber(n, "integer", { locale })`, in mono | **loading:** empty `<p>`, height `min-h-6` (24 px), nothing rendered inside. **ready:** `<span data-part="label" data-tone="up\|down\|neutral">` + "·" + `<span data-part="breadth">` ("Indices up 3/4") + "·" + `<span data-part="signals">` ("Signals on 5 / off 0"). **unknown:** "Regime unavailable". **error:** "Regime could not be loaded.". `regime_summary` is never rendered, not even as a `title`. | risk_on 3/4 5/0 → "Risk-on · Indices up 3/4 · Signals on 5 / off 0"; ko → "위험선호 · 지수 3/4 상승 · 선호 5 / 회피 0" | one `GET /market/regime` (through the hook) |
| `MarketHeader` | `() => JSX` | `PageHeader` with title `market.title`, subtitle `market.subtitle`, `actions={<MarketRegimeLine />}`; **no eyebrow** (N2) | — | the server render is English (useT's server snapshot) | en: h1 "Market Overview", subtitle "Daily closes · indices, commodities, FX, crypto" | none |
| `useMarketPageTab` (`MarketPageTabs.tsx`) | `(): [MarketPageTab, (tab: MarketPageTab) => void]` | the active tab and its setter | — | **nothing stored:** `"instruments"`. **stored tab:** restored after mount. **stored non-tab** (`"constructor"`, `"bogus"`): `"instruments"`. **blocked storage:** `"instruments"` (useTabState swallows it). | stored `'"spreads"'` → `["spreads", set]` | writes `moneyview.tab.market.pageTab` (sessionStorage, JSON) after mount and on every change |
| `MarketPageTabs` | `({ active, onChange, instruments, spreads }: { active: MarketPageTab; onChange: (tab: MarketPageTab) => void; instruments: ReactNode; spreads: ReactNode }) => JSX` | `<section data-testid="market-page-tabs" class="flex min-h-0 flex-1 flex-col gap-3">`; a tablist "Market sections" with ids `market-tab-instruments` / `market-tab-spreads`; **one** `<div role="tabpanel" id="market-panel-<key>" aria-labelledby="market-tab-<key>" class="min-h-0 min-w-0 flex-1 overflow-auto">` | — | only the active panel's node is mounted. A key from `Tabs` that is not a tab is ignored. Arrow, Home and End keys come from `Tabs`. | — | none of its own |
| `MarketOverviewClient` | `({ indices, fetchError }: { indices: MarketIndexQuote[]; fetchError?: string \| null }) => JSX` | `<div data-testid="market-page" class="mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col">` holding `MarketHeader` and `MarketPageTabs`; the modal sits outside it | — | **fetchError:** the Instruments panel holds `ErrorState`; the header and tabs still render (N6). **no indices:** `EmptyState` in the panel. **normal:** the existing card/table section (Task 5 replaces it). | — | the dev-monitor page-load event (unchanged) |
| `app/page.tsx` `MarketOverview` | `() => Promise<JSX>` | `<MarketOverviewClient indices fetchError />` only | — | fetch failure → `fetchError` = the error message, or the English fallback string (server-side data, unchanged) | — | one server `GET /market/indices` (unchanged) |

- [ ] **Step 1: Helpers** (`tests/e2e/helpers/marketTabs.ts`, new, LF):

```ts
import { expect, type Locator, type Page } from "@playwright/test";

/** The page tabs of "/" (market one-screen plan, Task 4), by their English labels. */
export type MarketTabName = "Instruments" | "Spreads";

/**
 * Opens a page tab on "/" and waits until it is selected. The click is retried: the tab bar is
 * server-rendered, so a click that lands before hydration does nothing. Each try waits on
 * aria-selected; there is no fixed sleep.
 */
export async function openMarketTab(page: Page, name: MarketTabName): Promise<void> {
  const tab = page.getByTestId("market-page-tabs").getByRole("tab", { name, exact: true });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

/** The selected page tab's panel on "/". */
export function marketPanel(page: Page): Locator {
  return page.getByTestId("market-page-tabs").getByRole("tabpanel");
}
```

- [ ] **Step 2: Write the failing tests.**

  **Model, append to `market-model.spec.ts`.** Add `import { isOneScreenRoute, ONE_SCREEN_ROUTES } from "../../components/ui/oneScreenRoutes";` to the imports, and append:

```ts
test.describe("isOneScreenRoute with the overview listed", () => {
  test("'/' is one-screen, and listing it does not make every path one-screen", () => {
    expect(ONE_SCREEN_ROUTES).toContain("/");
    expect(isOneScreenRoute("/")).toBe(true);
    for (const path of ["/portfolio", "/news", "/detail/AAPL", "/corporate-xyz", ""]) {
      expect(isOneScreenRoute(path), path).toBe(false);
    }
    expect(isOneScreenRoute("/corporate/x")).toBe(true);
  });
});
```

  **Page, `apps/web/tests/e2e/market-one-screen.spec.ts`** (new, LF):

```ts
import { expect, test, type Page } from "@playwright/test";
import { tokens } from "../../lib/tokens.generated";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { marketPanel, openMarketTab } from "./helpers/marketTabs";
import { expectNoPageScroll } from "./helpers/noPageScroll";

// Spec docs/superpowers/specs/2026-10-16-market-one-screen-design.md; plan Tasks 4-6.
const REGIME = {
  regime_label: "risk_on",
  regime_summary: "Most tracked equity indices are advancing and cross-asset signals lean toward pro-cyclical risk appetite.",
  equity_advancers: 3,
  equity_decliners: 1,
  breadth_ratio: 0.75,
  equity_index_count: 4,
  risk_on_signals: 5,
  risk_off_signals: 0,
  signal_count: 5,
};

/** Registered after mockMarketPageApi, so it answers first (Playwright tries the last route first). */
async function mockRegime(page: Page, body: unknown, status = 200) {
  await page.route("**/api/v1/market/regime", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
}

async function gotoMarket(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Market Overview", exact: true })).toBeVisible({ timeout: 60_000 });
}

const regime = (page: Page) => page.getByTestId("market-regime");
const cards = (page: Page) => page.locator('article:has(button[aria-label^="Open detail for"])');
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("the page never scrolls, on either tab or view; the panel takes the overflow", async ({ page }) => {
      await mockMarketPageApi(page);
      await gotoMarket(page);
      await expect(cards(page).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectNoPageScroll(page, "Instruments, graph");
      await page.getByRole("button", { name: "Table" }).click();
      await expect(page.getByRole("button", { name: "Open detail for S&P 500 from table" })).toBeVisible();
      await expectNoPageScroll(page, "Instruments, table");
      await openMarketTab(page, "Spreads");
      await expect(marketPanel(page).getByTestId("spreads-section")).toBeVisible();
      await expectNoPageScroll(page, "Spreads");
    });
  });
}

test.describe("the bottom pad", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("the overview is a one-screen route: 24px under its panel", async ({ page }) => {
    await mockMarketPageApi(page);
    await gotoMarket(page);
    expect(await page.locator("main").evaluate((element) => getComputedStyle(element).paddingBottom)).toBe("24px");
    const panel = await marketPanel(page).boundingBox();
    expect(panel, "the tab panel is rendered").not.toBeNull();
    expect(720 - (panel!.y + panel!.height), "the gap under the panel").toBeLessThanOrEqual(24 + 1);
  });
});

test.describe("the page tabs", () => {
  test("Instruments is the default, only the active panel is mounted, and a chosen tab survives a reload under its key", async ({ page }) => {
    await mockMarketPageApi(page);
    await gotoMarket(page);
    const tabs = page.getByTestId("market-page-tabs");
    await expect(tabs.getByRole("tab", { name: "Instruments" })).toHaveAttribute("aria-selected", "true");
    await expect(marketPanel(page)).toHaveAttribute("aria-labelledby", "market-tab-instruments");
    await expect(cards(page).first()).toBeVisible();
    await expect(page.getByTestId("spreads-section")).toHaveCount(0);
    await openMarketTab(page, "Spreads");
    await expect(marketPanel(page).getByTestId("spreads-section")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("moneyview.tab.market.pageTab"))).toBe('"spreads"');
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(tabs.getByRole("tab", { name: "Spreads" })).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(marketPanel(page).getByTestId("spreads-section")).toBeVisible();
  });

  test("an unknown stored tab falls back to Instruments", async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem("moneyview.tab.market.pageTab", JSON.stringify("constructor")));
    await mockMarketPageApi(page);
    // The restore runs in an effect after hydration; let it run before reading the selection.
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByTestId("market-page-tabs").getByRole("tab", { name: "Instruments" })).toHaveAttribute("aria-selected", "true");
    await expect(marketPanel(page).locator('article:has(button[aria-label^="Open detail for"])').first()).toBeVisible();
  });
});

test.describe("the regime line", () => {
  test("ready: the backend's label, breadth and signal counts, figures in mono, never its summary", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockRegime(page, REGIME);
    await gotoMarket(page);
    await expect(regime(page)).toHaveAttribute("data-state", "ready");
    const label = regime(page).locator('[data-part="label"]');
    await expect(label).toHaveText("Risk-on");
    await expect(label).toHaveAttribute("data-tone", "up");
    await expect(label).toHaveCSS("color", rgb(tokens.up._));
    await expect(regime(page).locator('[data-part="breadth"]')).toHaveText("Indices up 3/4");
    await expect(regime(page).locator('[data-part="breadth"] .type-mono')).toHaveText("3/4");
    await expect(regime(page).locator('[data-part="signals"]')).toHaveText("Signals on 5 / off 0");
    await expect(page.getByText(REGIME.regime_summary)).toHaveCount(0);
    await expect(page.locator('[title*="equity indices are advancing"]')).toHaveCount(0);
  });

  test("risk-off is the down colour; colour is never the only signal", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockRegime(page, {
      ...REGIME, regime_label: "risk_off", equity_advancers: 0, equity_decliners: 4, breadth_ratio: 0, risk_on_signals: 0, risk_off_signals: 5,
    });
    await gotoMarket(page);
    const label = regime(page).locator('[data-part="label"]');
    await expect(label).toHaveText("Risk-off");
    await expect(label).toHaveAttribute("data-tone", "down");
    await expect(label).toHaveCSS("color", rgb(tokens.down._));
    await expect(regime(page).locator('[data-part="breadth"]')).toHaveText("Indices up 0/4");
  });

  test("unknown says the regime is unavailable and is not drawn as mixed", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockRegime(page, {
      ...REGIME, regime_label: "unknown", regime_summary: "Regime context is unavailable because there were not enough current market signals.",
      equity_advancers: 0, equity_decliners: 0, breadth_ratio: null, equity_index_count: 0, risk_on_signals: 0, risk_off_signals: 0, signal_count: 0,
    });
    await gotoMarket(page);
    await expect(regime(page)).toHaveAttribute("data-state", "unknown");
    await expect(regime(page)).toHaveText("Regime unavailable");
    await expect(regime(page)).not.toContainText("Mixed");
  });

  test("a failed request says so; the line is not left empty", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockRegime(page, { detail: "boom" }, 500);
    await gotoMarket(page);
    await expect(regime(page)).toHaveAttribute("data-state", "error");
    await expect(regime(page)).toHaveText("Regime could not be loaded.");
  });

  test("while loading, the regime line keeps its height and the tab bar does not move", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await mockMarketPageApi(page);
    await page.route("**/api/v1/market/regime", async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REGIME) });
    });
    await gotoMarket(page);
    await expect(regime(page)).toHaveAttribute("data-state", "loading");
    const tabBar = page.getByRole("tablist", { name: "Market sections" });
    const loading = await regime(page).boundingBox();
    const barLoading = await tabBar.boundingBox();
    release();
    await expect(regime(page)).toHaveAttribute("data-state", "ready");
    const ready = await regime(page).boundingBox();
    const barReady = await tabBar.boundingBox();
    expect(loading, "the line is rendered while loading").not.toBeNull();
    expect(loading!.height, "the loading line has height").toBeGreaterThan(0);
    expect(loading!.height, "same height loading and ready").toBe(ready!.height);
    expect(barLoading!.y, "the tab bar does not move").toBe(barReady!.y);
  });
});

test("switching to Korean relabels the title, the subtitle, the regime and the tabs", async ({ page }) => {
  await mockMarketPageApi(page);
  await mockRegime(page, REGIME);
  await gotoMarket(page);
  await expect(page.getByText("Daily closes · indices, commodities, FX, crypto")).toBeVisible();
  await expect(regime(page).locator('[data-part="label"]')).toHaveText("Risk-on");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("heading", { name: "시장 개요", exact: true })).toBeVisible();
  await expect(page.getByText("일별 종가 · 지수, 원자재, 환율, 암호화폐")).toBeVisible();
  await expect(regime(page).locator('[data-part="label"]')).toHaveText("위험선호");
  await expect(regime(page).locator('[data-part="breadth"]')).toHaveText("지수 3/4 상승");
  await expect(regime(page).locator('[data-part="signals"]')).toHaveText("선호 5 / 회피 0");
  await expect(page.getByTestId("market-page-tabs").getByRole("tab", { name: "스프레드" })).toBeVisible();
});
```

- [ ] **Step 3: Run to see them fail.**
  - Run `npx playwright test tests/e2e/market-model.spec.ts --workers=2`. Expected: the new describe FAILS (`ONE_SCREEN_ROUTES` lacks `"/"`); the Task 3 tests pass.
  - Run `npx playwright test tests/e2e/market-one-screen.spec.ts --workers=2`. Expected: FAIL.
    - `market-page-tabs` and `market-regime` are not found, so the tab and regime tests time out.
    - The no-scroll checks report a document height of about 1,470 at 1280×720.
    - The pad test reads `80px`.
    - The Korean test does not find "시장 개요".
  - Record each failing test and its reason. If a run is stopped, kill :8110/:3101 before the next one.

- [ ] **Step 4: `oneScreenRoutes.ts`** (keep CRLF). Replace the whole file body with:

```ts
// Pages that must not scroll (spec §2A, D10; market one-screen spec §2.1). Each keeps a 24px bottom pad
// at lg and up, so the tab panel reaches the viewport edge. A later one-screen page joins by adding its route here.
export const ONE_SCREEN_ROUTES = ["/corporate", "/"];

/**
 * True for a listed route and the paths under it. "/corporate-x" is a different page, so it is false.
 * "/" lists only the overview: the prefix it would match is "//", which no app path starts with.
 */
export function isOneScreenRoute(pathname: string): boolean {
  return ONE_SCREEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
```

- [ ] **Step 5: `FigureText.tsx`** (new, LF):

```tsx
import type { FigurePart } from "./marketModel";

/** Renders withFigures() parts. Each figure is set in mono (DESIGN.md: figures inside a sentence). */
export function FigureText({ parts }: { parts: FigurePart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className={part.kind === "figure" ? "type-mono" : undefined}>{part.text}</span>
      ))}
    </>
  );
}
```

- [ ] **Step 6: `MarketRegimeLine.tsx`** (new, LF):

```tsx
"use client";

import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { useMarketRegime } from "@/lib/useMarketRegime";
import { FigureText } from "./FigureText";
import { regimeView, withFigures, type RegimeTone } from "./marketModel";

const TONE_CLASS: Record<RegimeTone, string> = {
  up: "text-[var(--up)]",
  down: "text-[var(--down)]",
  neutral: "text-[var(--ink)]",
};

/**
 * Spec §2.5: the regime in one line beside the title. The label, the equity breadth and the
 * cross-asset signal counts come from GET /api/v1/market/regime as sent; nothing is counted here.
 * regime_summary is English prose and is never rendered, not even as a title. The line keeps its
 * height while loading (min-h-6), so the tab bar does not move when the regime arrives.
 */
export function MarketRegimeLine() {
  const t = useT();
  const { locale } = useLocale();
  const view = regimeView(useMarketRegime());
  const integer = (value: number) => formatNumber(value, "integer", { locale });

  return (
    <p
      data-testid="market-regime"
      data-state={view.kind}
      className="type-small flex min-h-6 flex-wrap items-center gap-x-2 text-[var(--ink-secondary)]"
    >
      {view.kind === "ready" ? (
        <>
          <span data-part="label" data-tone={view.tone} className={TONE_CLASS[view.tone]}>{t(view.labelKey)}</span>
          <span aria-hidden="true">·</span>
          <span data-part="breadth">
            <FigureText parts={withFigures(t("market.regime.breadth"), { breadth: `${integer(view.advancers)}/${integer(view.indexCount)}` })} />
          </span>
          <span aria-hidden="true">·</span>
          <span data-part="signals">
            <FigureText parts={withFigures(t("market.regime.signals"), { on: integer(view.riskOn), off: integer(view.riskOff) })} />
          </span>
        </>
      ) : view.kind === "unknown" ? (
        <span>{t("market.regime.unknown")}</span>
      ) : view.kind === "error" ? (
        <span>{t("market.regime.error")}</span>
      ) : null}
    </p>
  );
}
```

- [ ] **Step 7: `MarketHeader.tsx`** (new, LF):

```tsx
"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { useT } from "@/lib/i18n/locale";
import { MarketRegimeLine } from "./MarketRegimeLine";

// Spec §1 and §3: title, the corrected subtitle and the regime line. A client component because
// app/page.tsx is a server component and the copy comes from the en/ko catalogs through useT, the
// way every other page sets its header. No eyebrow: the 1280x720 budget has no room for it (plan N2).
export function MarketHeader() {
  const t = useT();
  return <PageHeader title={t("market.title")} subtitle={t("market.subtitle")} actions={<MarketRegimeLine />} />;
}
```

- [ ] **Step 8: `MarketPageTabs.tsx`** (new, LF):

```tsx
"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { useTabState } from "@/lib/tabState";
import { isMarketPageTab, MARKET_PAGE_TAB_KEY, MARKET_PAGE_TABS, type MarketPageTab } from "./marketModel";

/** The remembered page tab (sessionStorage, this browser tab only). A stored value that is not a tab reads as Instruments. */
export function useMarketPageTab(): [MarketPageTab, (tab: MarketPageTab) => void] {
  const [stored, setStored] = useTabState<string>(MARKET_PAGE_TAB_KEY, "instruments");
  return [isMarketPageTab(stored) ? stored : "instruments", setStored];
}

interface MarketPageTabsProps {
  active: MarketPageTab;
  onChange: (tab: MarketPageTab) => void;
  instruments: ReactNode;
  spreads: ReactNode;
}

// Spec §2.1: two tabs under the header. The panel fills what the page column leaves and scrolls
// inside itself, so the page never scrolls. Only the active panel is mounted, so the spread charts
// do not draw while Instruments is open. Ids are prefixed so the modal's own tabs never collide.
export function MarketPageTabs({ active, onChange, instruments, spreads }: MarketPageTabsProps) {
  const t = useT();
  const panels: Record<MarketPageTab, ReactNode> = { instruments, spreads };
  return (
    <section data-testid="market-page-tabs" className="flex min-h-0 flex-1 flex-col gap-3">
      <Tabs
        ariaLabel={t("market.tabs.aria")}
        activeKey={active}
        onChange={(key) => {
          if (isMarketPageTab(key)) onChange(key);
        }}
        idPrefix="market-"
        className="shrink-0 [contain:inline-size]"
        items={MARKET_PAGE_TABS.map((key) => ({ key, label: t(`market.tabs.${key}`) }))}
      />
      <div
        role="tabpanel"
        id={`market-panel-${active}`}
        aria-labelledby={`market-tab-${active}`}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        {panels[active]}
      </div>
    </section>
  );
}
```

- [ ] **Step 9: Wire the page.**
  1. **`app/page.tsx`** (keep CRLF):
     - Delete `import { PageHeader } from "@/components/ui/PageHeader";`.
     - Replace the `return (` … `);` block, from `    <div className="max-w-7xl mx-auto px-4 py-6">` to `    </div>`, with:

```tsx
  // The header, the tabs and the regime line are client components (MarketOverviewClient), so their
  // copy comes from the en/ko catalogs (spec §3). This server component only fetches the cards.
  return <MarketOverviewClient indices={indices} fetchError={fetchError} />;
```

  2. **`MarketOverviewClient.tsx`** (keep LF):
     - Add these imports after `import { SpreadsSection } from "@/components/market/SpreadsSection";`:

```ts
import { MarketHeader } from "@/components/market/MarketHeader";
import { MarketPageTabs, useMarketPageTab } from "@/components/market/MarketPageTabs";
```

     - Replace everything from `export function MarketOverviewClient({` to the end of the file with the code below. `<EXISTING SECTION>` stands for the current `<section className="space-y-4">` … `</section>` block, from the `Market Dashboard` card through the end of the table. It is moved byte for byte; re-indent only.

```tsx
export function MarketOverviewClient({
  indices,
  fetchError = null,
}: {
  indices: MarketIndexQuote[];
  fetchError?: string | null;
}) {
  useDevMonitorPageLoad({ component: "market" });
  const [pageTab, setPageTab] = useMarketPageTab();
  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const [selectedIndex, setSelectedIndex] = useState<MarketIndexQuote | null>(null);

  // Spec §1: the page column is the viewport minus AppShell's pads. The header and the tab bar keep
  // their height; the tab panel takes the rest and scrolls inside itself. A failed or empty index
  // fetch is stated inside the Instruments panel, and the Spreads tab stays reachable (plan N6).
  return (
    <>
      <div
        data-testid="market-page"
        className="mx-auto flex h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] max-w-7xl flex-col"
      >
        <MarketHeader />
        <MarketPageTabs
          active={pageTab}
          onChange={setPageTab}
          instruments={
            fetchError ? (
              <ErrorState title="Market Overview Unavailable" message={fetchError} />
            ) : indices.length === 0 ? (
              <EmptyState title="No market data available" description="Ensure the FastAPI backend is running and discoverable." />
            ) : (
              <EXISTING SECTION>
            )
          }
          spreads={<SpreadsSection />}
        />
      </div>

      {selectedIndex ? <MarketDetailModal item={selectedIndex} onClose={() => setSelectedIndex(null)} /> : null}
    </>
  );
}
```

     - The old early returns for `fetchError` and `indices.length === 0`, and the old `<SpreadsSection />` line, are gone: they are now the ternary's branches and the `spreads` prop. The two strings stay English literals here; Task 5 moves them to the catalog.
  3. **`SpreadsSection.tsx`** (keep CRLF): change `minmax(240px, 1fr)` to `minmax(220px, 1fr)` (spec §2.4: five charts fit one row at 1216 px).
  4. Run `npm run lint`. Remove only the imports this made unused; none are expected.

- [ ] **Step 10: Run the new tests.** `npx playwright test tests/e2e/market-model.spec.ts tests/e2e/market-one-screen.spec.ts --workers=2`. Expected: PASS. If the no-scroll test fails, read the problem string. A horizontal problem at 390 means a flex row widened the page (ERROR-LOG 2026-10-14): find the row and add `min-w-0`, without loosening the test.

- [ ] **Step 11: Approved edits #1–#21.**
  - First run the affected specs unedited against the new code: `npx playwright test tests/e2e/market-spreads.spec.ts tests/e2e/event-filter.spec.ts tests/e2e/events-page.spec.ts tests/e2e/market-overview.spec.ts tests/e2e/corporate-model.spec.ts --workers=2`. Each row's line must fail for the reason the row gives:
    - spread cards, charts and filters are not found;
    - the old subtitle is not found;
    - `not.toContain("/")` and `toBe(false)` fail.

    Record each one. `market-overview.live.spec.ts` is in the full suite; `:7` fails the same way.
  - Then apply rows #1–#21 exactly as written, and rerun the same command plus `market-overview.live.spec.ts`. Expected: PASS.
  - If any other existing assertion fails, stop and report it.

- [ ] **Step 12: Gates (shared surface: full suite).**
  - Run `npm run typecheck && npm run lint && npm run test:unit`.
  - Run `npm run design:baseline -- components/market/FigureText.tsx components/market/MarketRegimeLine.tsx components/market/MarketHeader.tsx components/market/MarketPageTabs.tsx components/ui/oneScreenRoutes.ts`. Every category must be 0.
  - Run `npm run design:baseline`. It must exit 0, with warn ≤ 295.
  - Run the full Playwright suite in five foreground chunks, each with `--workers=2`, one at a time. If a chunk passes 10 minutes, split it by first letter.

```bash
npx playwright test tests/e2e/[a-c]*.spec.ts --workers=2
npx playwright test tests/e2e/[d-h]*.spec.ts --workers=2
npx playwright test tests/e2e/[i-m]*.spec.ts --workers=2
npx playwright test tests/e2e/[n-r]*.spec.ts --workers=2
npx playwright test tests/e2e/[s-z]*.spec.ts --workers=2
```

  Expected: every chunk passes, with the D14a skip count. Record the counts per chunk. A failure outside the inventory stops the task.

- [ ] **Step 13: Mutation matrix** (Global Constraints procedure)

| # | Mutation | Must fail |
|---|---|---|
| 1 | `MarketPageTabs` panel: delete `min-h-0` from `min-h-0 min-w-0 flex-1 overflow-auto` | `the page never scrolls…` at both sizes |
| 2 | `MarketOverviewClient` root: delete `h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))]` | same, at both sizes |
| 3 | `useMarketPageTab`: `useTabState<string>(MARKET_PAGE_TAB_KEY, "instruments")` → `useState<string>("instruments")` (import `useState`) | `Instruments is the default…survives a reload…` (Instruments after the reload) |
| 4 | `marketModel.ts`: `tabStateKey("market", "pageTab")` → `tabStateKey("market", "tab")` | same test (the poll on `moneyview.tab.market.pageTab` stays null) |
| 5 | `useMarketPageTab`: `isMarketPageTab(stored) ? stored : "instruments"` → `stored as MarketPageTab` | `an unknown stored tab falls back to Instruments` |
| 6 | `MarketPageTabs`: `{panels[active]}` → `{instruments}{spreads}` | `Instruments is the default…` (`spreads-section` count 1, not 0) |
| 7 | `marketModel.ts`: add `unknown: { key: "market.regime.mixed", tone: "neutral" },` to `REGIME_LABELS` | `unknown says the regime is unavailable and is not drawn as mixed` |
| 8 | `MarketRegimeLine`: `<span>{t("market.regime.error")}</span>` → `null` | `a failed request says so…` |
| 9 | `MarketRegimeLine`: insert `if (view.kind === "loading") return null;` before `return (` | `while loading, the regime line keeps its height…` (no `data-state="loading"`) |
| 10 | `MarketRegimeLine`: delete `min-h-6` | same test (loading height 0, or the tab bar moves) |
| 11 | `MarketRegimeLine`: the `<p>` gets `title={useMarketRegime().regime?.regime_summary}` (call the hook once, above, into a variable) | `ready: …never its summary` (the `[title*=…]` count is 1) |
| 12 | `TONE_CLASS.down` → `"text-[var(--ink)]"` | `risk-off is the down colour…` |
| 13 | `MarketHeader`: `subtitle={t("market.subtitle")}` → `subtitle="Daily closes · indices, commodities, FX, crypto"` | `switching to Korean relabels…` (Korean subtitle not found) |
| 14 | `oneScreenRoutes.ts`: `["/corporate", "/"]` → `["/corporate"]` | `the overview is a one-screen route: 24px…` (80px) and model `'/' is one-screen…` |
| 15 | `isOneScreenRoute`: ``pathname.startsWith(`${route}/`)`` → `pathname.startsWith(route)` | model `'/' is one-screen, and listing it does not make every path one-screen` ("/portfolio" true) |
| 16 | `openMarketTab`: delete the `toPass` wrapper (single click + assert) | none required. Record whether `market-spreads.spec.ts` flakes in 3 runs; this documents why the retry exists and is not a correctness test. |

  A mutation that does not make its test fail is reported as a survivor, with the reason.

- [ ] **Step 14: Commit.** In `todo.md`, tick `M4`.

```bash
git add apps/web/app/page.tsx apps/web/components/market apps/web/components/ui/oneScreenRoutes.ts apps/web/tests/e2e guideline/sop/todo.md
git commit -m "feat(market): one-screen overview with Instruments and Spreads page tabs and a header regime line" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Instruments tab: five columns, card trim, table, spread figures (spec §2.2, §2.3)

**Model:** Sonnet implements (fit tuning); Sonnet reviews.

**Files:**
- Create: `apps/web/components/market/InstrumentsPanel.tsx`, `apps/web/components/market/SpreadFigureRow.tsx` (LF)
- Modify: `apps/web/components/data/SparklineCard.tsx` (crlf, full replacement), `apps/web/components/market/MarketOverviewClient.tsx`, `apps/web/lib/useMarketSpreads.ts` (crlf), `apps/web/lib/i18n/messages/{en,ko}.ts`, `apps/web/lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md`
- Tests: `apps/web/tests/e2e/market-one-screen.spec.ts` (plan-owned, append)

**Output contracts:**

| name | signature | returns / renders | units / format | cases | example | side effects |
|---|---|---|---|---|---|---|
| `DEFAULT_SPREAD_WINDOW_DAYS` (`useMarketSpreads.ts`) | `90` | — | **calendar** days | the hook's default parameter now reads it; query key unchanged (`["market-spreads", 90]`) | — | none |
| `SparklineCard` | `(props: { title: string; ticker: string; value: string; deltaPct: number; sparkline: number[]; periodLabel?: string \| null; onOpen: () => void }) => JSX` | `<article>` (`Card padding="sm" hoverable`) holding one `<button aria-label="Open detail for {title}">`: the title (h3, truncates), the ticker span + "·" + the period span, the value (`type-figure-md`), a `DeltaBadge`, a 40 px `Sparkline` | `value` is preformatted by the caller; `deltaPct` in percent | **no period:** "Snapshot" / "스냅샷" (always, N8). **empty sparkline:** a blank 40 px box (Sparkline). **null value:** the caller passes `—`. | S&P 500 → about 233 × 134 px at 1280 | none |
| `SpreadFigureRow` | `({ onOpenSpreads }: { onOpenSpreads: () => void }) => JSX` | `<section data-testid="spread-figures" data-state="loading\|error\|empty\|ready">`: a caption "Themes vs benchmark (90d)", then the state's line, or one `<button data-testid="spread-figure-<id>" data-state="computed\|refused">` per pair, holding `[data-part="value"]` and `[data-part="pair"]` | value `formatNumber(latest, "price", { digits: 1, locale })` (`103.4`) in mono; pair `BOTZ/^GSPC`; the window is calendar days | **loading:** `role="status"` "Loading spreads…". **error:** `role="alert"` "The spreads could not be loaded.". **empty:** "No spreads were returned.". **refused pair:** value "Unavailable" / "이용 불가". **computed, `latest` null:** `—`. | `[ai 103.4, cyber 98.1, defence refused]` → "AI 103.4 BOTZ/^GSPC · Cybersecurity 98.1 CIBR/^GSPC · Defence Unavailable ITA/^GSPC" | shares `useMarketSpreads()`'s query with `SpreadsSection` (one request). Click → `onOpenSpreads()`. |
| `InstrumentsPanel` | `(props: { indices: MarketIndexQuote[]; fetchError: string \| null; viewMode: ViewMode; onViewModeChange: (mode: ViewMode) => void; onOpenDetail: (quote: MarketIndexQuote) => void; onOpenSpreads: () => void }) => JSX` | `<div data-testid="market-instruments">`: a toolbar (`market-instruments-toolbar`: "{n} instruments" + `ViewToggle`), then the cards (`market-cards`, `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3`) or the table (`market-table`), then `SpreadFigureRow` | price `formatNumber(v, "price", { digits: 1, locale })` ("6,512.3"); abs change the same with `signed: true` ("+12.4", "-3.1", "0.0"), coloured up/down/flat by its printed sign; pct via `DeltaBadge` | **fetchError:** `ErrorState` (title "Market Overview Unavailable", message = fetchError). **no indices:** `EmptyState`. **null price / abs:** `—`. **table:** 4 columns (Instrument, Price, Abs change, Change), bilingual headers; no Source column. | 10 SSR quotes → 10 cards in 2 rows of 5 at 1280 | none; `onOpenDetail` opens the modal (unchanged) |

- [ ] **Step 1: Catalog, labels, glossary.**
  - In `en.ts`, inside `market: {`, after the `regime: { … },` block, add:

```ts
    unavailableTitle: "Market Overview Unavailable",
    emptyTitle: "No market data available",
    emptyDescription: "Ensure the FastAPI backend is running and discoverable.",
    instruments: { count: "{count} instruments" },
    card: { open: "Open detail for {title}", snapshot: "Snapshot" },
    table: { open: "Open detail for {name} from table" },
    spreads: {
      figuresCaption: "Themes vs benchmark ({days}d)",
      loading: "Loading spreads…",
      error: "The spreads could not be loaded.",
      empty: "No spreads were returned.",
      unavailable: "Unavailable",
    },
```

  - In `ko.ts`, in the same place:

```ts
    unavailableTitle: "시장 개요를 불러올 수 없습니다",
    emptyTitle: "시장 데이터가 없습니다",
    emptyDescription: "FastAPI 백엔드가 실행 중이고 연결 가능한지 확인하십시오.",
    instruments: { count: "종목 {count}개" },
    card: { open: "{title} 상세 열기", snapshot: "스냅샷" },
    table: { open: "표에서 {name} 상세 열기" },
    spreads: {
      figuresCaption: "테마 대비 기준 지수 ({days}일)",
      loading: "스프레드를 불러오는 중…",
      error: "스프레드를 불러오지 못했습니다.",
      empty: "받은 스프레드가 없습니다.",
      unavailable: "이용 불가",
    },
```

  - In `labels.ts`, after `change: ["등락률", "Change"],`, add `instrument: ["종목", "Instrument"],` and `absChange: ["등락폭", "Abs change"],`.
  - Append these glossary rows:

```markdown
| Instrument | 종목 | label (market table header) |
| Abs change | 등락폭 | label (market table header, change in instrument units) |
| Unavailable | 이용 불가 | a refused spread pair |
| Snapshot | 스냅샷 | market card period fallback |
| Themes vs benchmark | 테마 대비 기준 지수 | market spread-figure row caption |
```

- [ ] **Step 2: Write the failing tests.** Append to `market-one-screen.spec.ts`. Add `type Locator` to the `@playwright/test` import.

```ts
function spread(id: string, label: string, numerator: string, latest: number | null, refused_reason: string | null = null) {
  const refused = refused_reason !== null;
  return {
    id, label, numerator, denominator: "^GSPC", requested_window_days: 90,
    actual_window_start: refused ? null : "2026-06-15", actual_window_end: refused ? null : "2026-09-11",
    actual_window_days: refused ? null : 88, observations: refused ? 0 : 62,
    basis: `(${numerator}_t / ${numerator}_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15`,
    series: refused ? [] : [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: latest }],
    latest, refused_reason,
  };
}
const SPREADS = [
  spread("ai", "AI", "BOTZ", 103.4),
  spread("cyber", "Cybersecurity", "CIBR", 98.1),
  spread("defence", "Defence", "ITA", null, "insufficient overlapping history"),
];

async function mockSpreads(page: Page, body: unknown, status = 200) {
  await page.route("**/api/v1/market/spreads**", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
}

const figures = (page: Page) => page.getByTestId("spread-figures");

test.describe("at 1280x720, the first screen", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  async function expectEndsBy(blocks: [string, Locator, number][]) {
    for (const [name, locator, bottom] of blocks) {
      const box = await locator.boundingBox();
      expect(box, `${name} is rendered`).not.toBeNull();
      expect(box!.y + box!.height, `${name} ends by ${Math.round(bottom)}px`).toBeLessThanOrEqual(bottom);
    }
  }

  test("header, tab bar, every card and the spread figures fit, in both views, without scrolling the panel", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, SPREADS);
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "ready");
    await page.evaluate(() => document.fonts.ready);
    // Cards are server-rendered from the e2e API, so page.route cannot set their count: find the last one.
    expect(await cards(page).count(), "the e2e API served instrument cards").toBeGreaterThan(0);
    const panel = await marketPanel(page).boundingBox();
    const panelBottom = panel!.y + panel!.height;
    expect(panelBottom, "the panel ends inside the viewport").toBeLessThanOrEqual(720);
    await expectEndsBy([
      ["title", page.getByRole("heading", { name: "Market Overview", exact: true }), 720],
      ["regime line", regime(page), 720],
      ["tab bar", page.getByRole("tablist", { name: "Market sections" }), 720],
      ["last card", cards(page).last(), panelBottom],
      ["spread figures", figures(page), panelBottom],
    ]);
    await expectNoPageScroll(page, "graph view");

    await page.getByRole("button", { name: "Table" }).click();
    const rows = page.getByTestId("market-table").locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    await expectEndsBy([
      ["last table row", rows.last(), panelBottom],
      ["spread figures", figures(page), panelBottom],
    ]);
    await expectNoPageScroll(page, "table view");
  });
});

test.describe("the spread figures", () => {
  test("each pair names its tickers; a refused pair says Unavailable, never a number", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, SPREADS);
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "ready");
    await expect(figures(page)).toContainText("Themes vs benchmark (90d)");
    const ai = page.getByTestId("spread-figure-ai");
    await expect(ai.locator('[data-part="value"]')).toHaveText("103.4");
    await expect(ai.locator('[data-part="pair"]')).toHaveText("BOTZ/^GSPC");
    await expect(page.getByTestId("spread-figure-cyber").locator('[data-part="pair"]')).toHaveText("CIBR/^GSPC");
    const defence = page.getByTestId("spread-figure-defence");
    await expect(defence).toHaveAttribute("data-state", "refused");
    await expect(defence.locator('[data-part="value"]')).toHaveText("Unavailable");
    await expect(defence.locator('[data-part="pair"]')).toHaveText("ITA/^GSPC");
    // The figures are not chart cards: market-spreads.spec.ts counts charts by this prefix.
    await expect(page.getByTestId(/^spread-card-/)).toHaveCount(0);
  });

  test("loading is stated, and gives way to the figures", async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await mockMarketPageApi(page);
    await page.route("**/api/v1/market/spreads**", async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SPREADS) });
    });
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "loading");
    await expect(figures(page).getByRole("status")).toHaveText("Loading spreads…");
    release();
    await expect(figures(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  });

  test("a failed request is stated as a failure", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, { detail: "boom" }, 500);
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "error", { timeout: 30_000 });
    await expect(figures(page).getByRole("alert")).toContainText("could not be loaded");
  });

  test("an empty list is stated, and is not an error", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, []);
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "empty");
    await expect(figures(page)).toContainText("No spreads were returned.");
    await expect(figures(page).getByRole("alert")).toHaveCount(0);
  });

  test("a figure opens the Spreads tab", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, SPREADS);
    await gotoMarket(page);
    // Client-fetched, so "ready" means hydrated: one click is enough.
    await expect(figures(page)).toHaveAttribute("data-state", "ready");
    await page.getByTestId("spread-figure-ai").click();
    await expect(page.getByTestId("market-page-tabs").getByRole("tab", { name: "Spreads" })).toHaveAttribute("aria-selected", "true");
    await expect(marketPanel(page).getByTestId("spread-card-ai")).toBeVisible();
  });
});

test("the Market Dashboard card, Detail available and the Source column are gone", async ({ page }) => {
  await mockMarketPageApi(page);
  await gotoMarket(page);
  await expect(cards(page).first()).toBeVisible();
  await expect(page.getByText("Market Dashboard")).toHaveCount(0);
  await expect(page.getByText("Detail available")).toHaveCount(0);
  await page.getByRole("button", { name: "Table" }).click();
  const table = page.getByTestId("market-table");
  await expect(table.getByRole("columnheader")).toHaveCount(4);
  await expect(table.getByRole("columnheader", { name: "Instrument" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Source" })).toHaveCount(0);
  await expect(page.getByText("Market snapshot API")).toHaveCount(0);
});
```

- [ ] **Step 3: Run to see them fail.** `npx playwright test tests/e2e/market-one-screen.spec.ts --workers=2`. Expected: the Task 4 tests pass, and the new ones FAIL:
  - `spread-figures` is not found;
  - "Market Dashboard" and "Detail available" have count 1+;
  - `market-table` is not found;
  - the fit test fails on `last card ends by …`, because the 3-column grid is about 1,100 px.

- [ ] **Step 4: `useMarketSpreads.ts`** (keep CRLF):
  - Above the doc comment of `useMarketSpreads`, add `/** The spreads' requested window in CALENDAR days; the route's default too (`Query(default=90)`). */` and `export const DEFAULT_SPREAD_WINDOW_DAYS = 90;`.
  - Change `export function useMarketSpreads(windowDays = 90) {` to `export function useMarketSpreads(windowDays = DEFAULT_SPREAD_WINDOW_DAYS) {`.

- [ ] **Step 5: `SparklineCard.tsx`** (keep CRLF). Replace the file with:

```tsx
"use client";

import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { Sparkline } from "@/components/ui/Sparkline";
import { useT } from "@/lib/i18n/locale";

interface SparklineCardProps {
  title: string;
  ticker: string;
  /** Preformatted by the caller (formatNumber); "—" when missing. */
  value: string;
  /** Percent units: 1.24 means +1.24%. */
  deltaPct: number;
  sparkline: number[];
  periodLabel?: string | null;
  onOpen: () => void;
}

// Market spec §2.2: about 233x134 in the overview's five-column grid. The whole card is the button,
// so the "Detail available" footer is gone; the period label sits beside the ticker. The English
// aria-label "Open detail for …" is what tests and the design-capture mask find the cards by.
export function SparklineCard({ title, ticker, value, deltaPct, sparkline, periodLabel, onOpen }: SparklineCardProps) {
  const t = useT();
  return (
    <Card padding="sm" hoverable as="article" className="h-full">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full w-full flex-col gap-2 rounded-[var(--radius-1)] text-left"
        aria-label={t("market.card.open", { title })}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate type-panel-title text-[var(--ink)]">{title}</h3>
            <div className="type-caption flex items-baseline gap-1 uppercase text-[var(--ink-muted)]">
              <span>{ticker}</span>
              <span aria-hidden="true">·</span>
              <span>{periodLabel ?? t("market.card.snapshot")}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="type-figure-md text-[var(--ink)]">{value}</div>
            <DeltaBadge value={deltaPct} className="mt-1" />
          </div>
        </div>
        <div className="mt-auto border-t border-[var(--grid)] pt-2">
          <Sparkline data={sparkline} />
        </div>
      </button>
    </Card>
  );
}
```

- [ ] **Step 6: `SpreadFigureRow.tsx`** and **`InstrumentsPanel.tsx`** (new, LF).

`SpreadFigureRow.tsx`:

```tsx
"use client";

import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { DEFAULT_SPREAD_WINDOW_DAYS, useMarketSpreads } from "@/lib/useMarketSpreads";
import { FigureText } from "./FigureText";
import { spreadFigure, withFigures } from "./marketModel";

/**
 * Spec §2.3: the latest theme spreads in one row under the cards, each with the tickers it is
 * computed from. Loading, failed, empty and refused are four different facts, and each is stated,
 * by the same rules as SpreadsSection. A figure opens the Spreads tab. Test ids never start with
 * "spread-card-": market-spreads.spec.ts counts the chart cards by that prefix.
 */
export function SpreadFigureRow({ onOpenSpreads }: { onOpenSpreads: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { spreads, isLoading, isError } = useMarketSpreads();
  const state = isLoading ? "loading" : isError ? "error" : spreads.length === 0 ? "empty" : "ready";

  return (
    <section data-testid="spread-figures" data-state={state} className="flex flex-col gap-1 border-t border-[var(--line)] pt-3">
      <p className="type-caption uppercase text-[var(--ink-muted)]">
        <FigureText parts={withFigures(t("market.spreads.figuresCaption"), { days: formatNumber(DEFAULT_SPREAD_WINDOW_DAYS, "integer", { locale }) })} />
      </p>
      {state === "loading" ? (
        <p role="status" className="type-small text-[var(--ink-muted)]">{t("market.spreads.loading")}</p>
      ) : state === "error" ? (
        <p role="alert" className="type-small text-[var(--status-error-ink)]">{t("market.spreads.error")}</p>
      ) : state === "empty" ? (
        <p className="type-small text-[var(--ink-muted)]">{t("market.spreads.empty")}</p>
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {spreads.map(spreadFigure).map((figure) => (
            <button
              key={figure.id}
              type="button"
              data-testid={`spread-figure-${figure.id}`}
              data-state={figure.refused ? "refused" : "computed"}
              onClick={onOpenSpreads}
              className="inline-flex items-baseline gap-2 rounded-[var(--radius-1)] text-left text-[var(--ink-secondary)] hover:text-[var(--ink)]"
            >
              <span className="type-label">{figure.label}</span>
              <span data-part="value" className="type-mono text-[var(--ink)]">
                {figure.refused ? t("market.spreads.unavailable") : figure.latest === null ? MISSING : formatNumber(figure.latest, "price", { digits: 1, locale })}
              </span>
              <span data-part="pair" className="type-caption text-[var(--ink-muted)]">{figure.pair}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
```

`InstrumentsPanel.tsx`:

```tsx
"use client";

import clsx from "clsx";
import { SparklineCard } from "@/components/data/SparklineCard";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ViewToggle, type ViewMode } from "@/components/ui/ViewToggle";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { FigureText } from "./FigureText";
import { withFigures, type MarketIndexQuote } from "./marketModel";
import { SpreadFigureRow } from "./SpreadFigureRow";

interface InstrumentsPanelProps {
  indices: MarketIndexQuote[];
  fetchError: string | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenDetail: (quote: MarketIndexQuote) => void;
  onOpenSpreads: () => void;
}

const SIGN_TONE = {
  up: "text-[var(--up)]",
  down: "text-[var(--down)]",
  flat: "text-[var(--flat)]",
} as const;

/** The direction of a figure as printed at one decimal, like DeltaBadge: -0.04 prints "0.0" and is flat. */
function printedSign(value: number | null | undefined): keyof typeof SIGN_TONE {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.round(Math.abs(value) * 10) === 0) return "flat";
  return value > 0 ? "up" : "down";
}

// Spec §2.2: a toolbar (count + Graph|Table), the cards in five columns or a four-column table, and
// the spread figures under either. Sized for the 1280x720 panel (plan "Height budget").
export function InstrumentsPanel({ indices, fetchError, viewMode, onViewModeChange, onOpenDetail, onOpenSpreads }: InstrumentsPanelProps) {
  const t = useT();
  const { locale } = useLocale();
  if (fetchError) return <ErrorState title={t("market.unavailableTitle")} message={fetchError} />;
  if (indices.length === 0) return <EmptyState title={t("market.emptyTitle")} description={t("market.emptyDescription")} />;
  const price = (value: number | null | undefined) => formatNumber(value, "price", { digits: 1, locale });

  return (
    <div data-testid="market-instruments" className="flex flex-col gap-3">
      <div data-testid="market-instruments-toolbar" className="flex items-center justify-between gap-3">
        <p className="type-small text-[var(--ink-secondary)]">
          <FigureText parts={withFigures(t("market.instruments.count"), { count: formatNumber(indices.length, "integer", { locale }) })} />
        </p>
        <ViewToggle value={viewMode} onChange={onViewModeChange} />
      </div>

      {viewMode === "chart" ? (
        <div data-testid="market-cards" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {indices.map((quote) => (
            <SparklineCard
              key={quote.ticker}
              title={quote.name}
              ticker={quote.ticker}
              value={price(quote.last_close)}
              deltaPct={quote.delta.delta_pct}
              sparkline={quote.sparkline}
              periodLabel={quote.period}
              onOpen={() => onOpenDetail(quote)}
            />
          ))}
        </div>
      ) : (
        <div data-testid="market-table" className="overflow-x-auto border border-[var(--line)] bg-[var(--surface-raised)]">
          <table className="min-w-full">
            <thead className="bg-[var(--surface)]">
              <tr className="type-caption text-[var(--ink-muted)]">
                <th className="h-8 px-3 text-left"><BilingualLabel k="instrument" /></th>
                <th className="h-8 px-3 text-right"><BilingualLabel k="price" /></th>
                <th className="h-8 px-3 text-right"><BilingualLabel k="absChange" /></th>
                <th className="h-8 px-3 text-right"><BilingualLabel k="change" /></th>
              </tr>
            </thead>
            <tbody>
              {indices.map((quote) => (
                <tr key={quote.ticker} className="h-8 border-t border-[var(--grid)] hover:bg-[var(--surface)]">
                  <td className="px-3">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(quote)}
                      aria-label={t("market.table.open", { name: quote.name })}
                      className="flex items-baseline gap-2 rounded-[var(--radius-1)] text-left"
                    >
                      <span className="type-body text-[var(--ink)]">{quote.name}</span>
                      <span className="type-caption uppercase text-[var(--ink-muted)]">{quote.ticker}</span>
                    </button>
                  </td>
                  <td className="type-mono px-3 text-right text-[var(--ink)]">{price(quote.last_close)}</td>
                  <td className={clsx("type-mono px-3 text-right", SIGN_TONE[printedSign(quote.delta.delta_abs)])}>
                    {formatNumber(quote.delta.delta_abs, "price", { digits: 1, signed: true, locale })}
                  </td>
                  <td className="px-3 text-right"><DeltaBadge value={quote.delta.delta_pct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SpreadFigureRow onOpenSpreads={onOpenSpreads} />
    </div>
  );
}
```

- [ ] **Step 7: Wire it, then measure.**
  - In `MarketOverviewClient.tsx`:
    - Add `import { InstrumentsPanel } from "@/components/market/InstrumentsPanel";`.
    - Replace the whole `instruments={ … }` ternary (the `fetchError`, empty and `<section className="space-y-4">` branches) with:

```tsx
          instruments={
            <InstrumentsPanel
              indices={indices}
              fetchError={fetchError}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onOpenDetail={setSelectedIndex}
              onOpenSpreads={() => setPageTab("spreads")}
            />
          }
```

    - Run `npm run lint` and delete only the imports this made unused. Expected: `SectionHeader`, `SparklineCard` and `EmptyState`. Keep `ViewMode` (state type), `Card`, `DeltaBadge` and `ErrorState`, which the modal uses.
  - Run `npx playwright test tests/e2e/market-one-screen.spec.ts --workers=2`. Expected: PASS.
  - If the fit test fails, read the failing block and its bottom from the message, and fix the layout; do not loosen the test. Levers, in order:
    - the panel's `gap-3` → `gap-2`;
    - `SpreadFigureRow` `pt-3` → `pt-2`;
    - table rows `h-8` → `h-7` (only if the table view is the one failing).

    Do not touch `AppShell`, `Tabs` or `PageHeader`; they are shared surfaces.
  - Record in the task report the measured bottoms of the title, regime line, tab bar, panel, last card, last table row and figure row, in both views.

- [ ] **Step 8: Gates.**
  - Run `npm run typecheck && npm run lint && npm run test:unit`.
  - Run `npm run design:baseline -- components/market/InstrumentsPanel.tsx components/market/SpreadFigureRow.tsx components/data/SparklineCard.tsx`. Every category must be 0.
  - Run `npm run design:baseline`. It must exit 0, with warn ≤ 295 (it falls: the old table and grid classes are gone).
  - Run the area specs: `npx playwright test tests/e2e/market-*.spec.ts tests/e2e/event-filter.spec.ts tests/e2e/events-page.spec.ts tests/e2e/candle-colour.spec.ts tests/e2e/candle-direction.spec.ts tests/e2e/responsive-accessibility.spec.ts tests/e2e/i18n.spec.ts tests/e2e/i18n-model.spec.ts tests/e2e/one-screen-no-scroll.spec.ts tests/e2e/font.spec.ts --workers=2`. Expected: PASS.

- [ ] **Step 9: Mutation matrix** (Global Constraints procedure)

| # | Mutation | Must fail |
|---|---|---|
| 1 | `InstrumentsPanel`: `lg:grid-cols-5` → `lg:grid-cols-3` | the fit test (`last card ends by …`) |
| 2 | `InstrumentsPanel`: the row button's `flex items-baseline gap-2` → `flex flex-col` (name and ticker stacked) | the fit test, table view (`last table row ends by …`) |
| 3 | `SpreadFigureRow`: delete the `[data-part="pair"]` span | `each pair names its tickers…` |
| 4 | `SpreadFigureRow`: the value expression → `formatNumber(figure.latest, "price", { digits: 1, locale })` (refused drawn as a number) | `each pair names its tickers; a refused pair says Unavailable…` (value "—") |
| 5 | `SpreadFigureRow`: `isLoading ? "loading" : ` deleted | `loading is stated…` (state "empty" while held) |
| 6 | `SpreadFigureRow`: `isError ? "error" : ` deleted | `a failed request is stated as a failure` (state "empty") |
| 7 | `SpreadFigureRow`: `onClick={onOpenSpreads}` deleted | `a figure opens the Spreads tab` |
| 8 | `SpreadFigureRow`: ``data-testid={`spread-figure-${figure.id}`}`` → ``data-testid={`spread-card-${figure.id}`}`` | `each pair names its tickers…` (`/^spread-card-/` count 3) |
| 9 | `SparklineCard`: add `<span>Detail available</span>` after the sparkline div | `the Market Dashboard card, Detail available and the Source column are gone` |
| 10 | `InstrumentsPanel`: add `<th className="h-8 px-3 text-left">Source</th>` as the last header | same test (columnheader count 5) |

- [ ] **Step 10: Commit.** In `todo.md`, tick `M5`.

```bash
git add apps/web/components/market apps/web/components/data/SparklineCard.tsx apps/web/lib/useMarketSpreads.ts apps/web/lib/i18n apps/web/tests/e2e/market-one-screen.spec.ts docs/design/MoneyView_Glossary.md guideline/sop/todo.md
git commit -m "feat(market): instruments tab in five columns with a spread-figure row; table without the Source column" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Market on paper tokens and en/ko catalogs; cap 295 → 0 (spec §3; DS M1–M7)

**Model:** Sonnet implements (about 250 class decisions and Korean copy); Sonnet reviews. The owner reads the `ko.ts` diff, and every line with a number, unit or sign is read by eye (DS M6).

**Globs:** `app/page.tsx`, `components/market/**/*.{ts,tsx}`, `components/data/SparklineCard.tsx`.

**Files:**
- Modify: `apps/web/components/market/MarketOverviewClient.tsx` (the modal and its builders), `apps/web/components/market/SpreadsSection.tsx`, `apps/web/lib/i18n/messages/{en,ko}.ts`, `docs/design/MoneyView_Glossary.md`, `apps/web/scripts/design-baseline-cap.mjs` (crlf), `DESIGN.md`
- Tests: `apps/web/tests/e2e/market-one-screen.spec.ts` (plan-owned, append: the Korean assertion)
- Approved test edits: inventory #22–#25 (`scripts/design-baseline-cap.test.mjs`)

**Output contracts** (rendering only; the structure, testids and English text are unchanged):

| name | signature | change | cases | side effects |
|---|---|---|---|---|
| `buildInstrumentContext` | `(detail: MarketIndexDetail \| undefined, deltaPct: number, t: Translate) => { title: string; description: string; bullets: string[] }`, where `Translate = (key: MessageKey, params?: Record<string, string \| number>) => string` | takes `t`; every string comes from `market.detail.context.<type>.*`; English output byte-identical | `commodity` / `fx` / `crypto` / other → `index`, as today; `unit_label` missing → the catalog fallback ("Commodity price units", "Crypto quote units", "FX pair") | none |
| `buildIndicatorSection` | `(instrumentType: InstrumentType, timeframe: "daily" \| "monthly", indicators: TechnicalIndicators, t: Translate) => { title: string; description: string; rows: { label: string; value: number \| null }[] }` | takes `t`; titles are `"{timeframe} Indicators"`-style templates; window labels use `{window}` ("20D", "50M") | four instrument types × two timeframes, as today | none |
| `MarketDetailModal` | unchanged props | M1–M5 classes and numbers; M6 strings; regime tile per N7 | `null` figures render `—` (was "N/A"); `volume_vs_20d_pct` is **percent** units, so it is formatted as `formatNumber(v / 100, "percent", { digits: 2, signed: true, locale })` ("+12.34%"); `breadth_ratio` is a **fraction**: `formatNumber(r, "percent", { digits: 0, locale })` ("75%"); `trendSummary.changePct` is percent: `formatNumber(c / 100, "percent", { signed: true, locale })` | one detail request (unchanged) |
| `SpreadsSection` | unchanged | M1–M3 classes; M5 `latest.toFixed(1)` → `formatNumber(latest, "price", { digits: 1, locale })`; M6 strings into `market.spreads.*` | loading / error / empty / refused, as today | none |
| `MARKET_WARN_CAP` (`design-baseline-cap.mjs`) | `0` | was 295 | `warnCapExceeded(0) === false`, `warnCapExceeded(1) === true` | `design:baseline` exits 1 on any market warning |

- [ ] **Step 1: Baseline.** `npm run design:baseline -- "components/market/**/*.{ts,tsx}" app/page.tsx components/data/SparklineCard.tsx`. Record the counts in the task report. Expected: below 295, because Tasks 4–5 removed the old grid and table.

- [ ] **Step 2: Apply M1–M5** (the DS plan's "Screen migration procedure" mapping tables, `docs/superpowers/plans/2026-10-12-design-system-formalization.md`) to every hit in the globs. These choices are fixed:

| Where | From | To |
|---|---|---|
| modal MA series (`MARKET_MOVING_AVERAGE_COLORS`) | `#F97316` / `#10B981` / `#3B82F6` | `tokens.chart["1"]` / `tokens.chart["2"]` / `tokens.chart["3"]` (`import { tokens } from "@/lib/tokens.generated"`; the portfolio precedent, `app/portfolio/page.tsx:354`) |
| modal `chartColor` | `var(--delta-up)` / `var(--delta-down)` | `var(--up)` / `var(--down)` (the same values; `candle-colour.spec.ts` guards them) |
| modal MA legend chips | `rounded-full border … px-2 py-1` | `rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-1` (a chip, M3). The dot inside keeps `rounded-full` with `{/* rounded-full: dot */}`. |
| "Detail Warnings" and "Data Quality" boxes | `border-amber-300 bg-amber-50`, `text-amber-950` | `border-[var(--status-warning-border)] bg-[var(--status-warning-surface)]`, `text-[var(--status-warning-ink)]` |
| "View Full Detail" link | `rounded-[var(--radius-md)] border-[var(--border-default)] … font-medium … focus-visible:*` | `rounded-[var(--radius-1)] border border-[var(--line)] type-label text-[var(--ink)] hover:bg-[var(--surface)]`; the focus classes are deleted (M3) |
| Daily/Monthly toggle | the hand-made `rounded-[calc(var(--radius)-4px)] … font-semibold` buttons | `SEGMENT_CONTAINER` / `SEGMENT_BUTTON` / `SEGMENT_SELECTED` / `SEGMENT_UNSELECTED` from `components/ui/ToggleGroup`. The button text stays "Daily" / "Monthly" (`market-overview.spec.ts:89–90` clicks "Monthly"). |
| tile figures (`text-3xl font-black`, `text-lg font-bold tabular-nums`) | — | `type-figure-md` (headline tiles) / `type-mono` (small tiles) |
| local `formatNumber`, `formatSignedNumber`, `formatInteger` | — | `formatNumber` from `@/lib/format` with `{ locale }` (M5). Then delete the three helpers. `formatInteger(v)` → `formatNumber(v, "integer", { locale })` (`1,340,000,000` stays). `formatNumber(v, 2)` → `formatNumber(v, "price", { digits: 2, locale })`. |

- [ ] **Step 3: M6, strings.** Move every JSX text node and every `aria-label`, `title` and `placeholder` literal in the globs into `en.ts`, inside `market: {`, as two new groups. `spreads` merges into the group Task 5 added.
  - `market.detail.*` covers `MarketDetailModal`, `IndicatorGrid`, `buildInstrumentContext`, `buildIndicatorSection`, `instrumentLabel` and the warnings.
  - `market.spreads.*` covers `SpreadsSection`: title, description, pair line `"{numerator} vs {denominator} · {window}"`, window `"{days}d"`, `"Unavailable"` (reuse the key), `"Reason: {reason}"`; reuse `loading`, `error` and `empty`.

  Rules:
  1. **Every English value is the current literal, character for character.** `${expr}` becomes `{name}`. The Global Constraints list names the strings tests pin. After this step, `git diff` of the rendered English must be empty: Step 5 proves it with the unedited `market-overview.spec.ts`.
  2. `buildInstrumentContext` and `buildIndicatorSection` take `t` as their last parameter. Their call sites pass the component's `t`. Wrap the `useMemo` that calls `buildInstrumentContext` with `t` in its dependency list.
  3. **The regime tile (N7).**
     - The label becomes `t(view.labelKey)` from `regimeView({ status: "ready", regime: detail.market_regime })`, with the same `TONE_CLASS` colouring as the header. Import `regimeView` from `./marketModel`, and export `TONE_CLASS` from `MarketRegimeLine.tsx` for reuse.
     - The sentence under it becomes `t(\`market.detail.regimeSummary.${key}\`)`, keyed by `riskOn` / `mixed` / `riskOff` / `unknown`. The four English values are copied from `apps/api/services/market_data.py:1023, 1026, 1029, 1032`.
     - `detail.market_regime.regime_summary` is no longer read anywhere. Check: `git grep -n "regime_summary" -- apps/web/components apps/web/app` prints nothing.
  4. The "Breadth" tile text stays `"{breadth} advancers"` with `breadth` = `"3/4"`, and the "Cross-Asset Signals" tile stays `"{on} risk-on / {off} risk-off"`. `market-overview.spec.ts:33–34` reads them.
  5. Backend values (`data_quality.source`, `freshness_status`, `last_updated`, `detail_note`, `unit_label`, `base_asset`) are data. They are shown as sent, in either locale. `"unknown"` as the freshness fallback becomes `t("market.detail.freshnessUnknown")`.
  6. `app/page.tsx` keeps its server-side fallback `"Failed to load market indices."`. It is error data passed as `fetchError`, not JSX, and the server has no locale.
  7. These Korean values are fixed, because tests read them. Add each glossary row first.

| Key | en | ko |
|---|---|---|
| `market.detail.dailyVolume` | Daily Volume | 일별 거래량 |
| `market.detail.dataQuality` | Data Quality | 데이터 품질 |
| `market.detail.quick` | Quick market detail | 빠른 시장 상세 |
| `market.detail.viewFull` | View Full Detail | 전체 상세 보기 |

  8. Every other Korean value follows the glossary. An LLM may draft it with the instruction "terms in the glossary are fixed" (DS M6). Sentences are 합니다체.

- [ ] **Step 4: M7.** The instruments table headers are already bilingual (Task 5). The modal has no `<th>` and no eyebrow (N12). Nothing else.

- [ ] **Step 5: Run the existing specs, unedited.** Run `npx playwright test tests/e2e/market-overview.spec.ts tests/e2e/market-spreads.spec.ts tests/e2e/candle-colour.spec.ts tests/e2e/candle-direction.spec.ts tests/e2e/responsive-accessibility.spec.ts tests/e2e/event-filter.spec.ts --workers=2`. Expected: PASS. An assertion that fails here means an English string drifted. Fix the catalog, not the test. If an assertion encodes an old rendered value that M5 changes on purpose ("N/A" → "—", for example), stop and list it for the owner; none is expected (checked by grep: no market spec reads "N/A").

- [ ] **Step 6: The Korean assertion (DS step 5).** Append to `market-one-screen.spec.ts`:

```ts
test.describe("in Korean", () => {
  test.use({ locale: "ko-KR" });

  test("title, a figure, a bilingual header and the detail modal read in Korean", async ({ page }) => {
    await mockMarketPageApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "시장 개요", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("market-regime").locator('[data-part="breadth"] .type-mono')).toHaveText("3/4");
    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.getByRole("columnheader", { name: "종목", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "표에서 S&P 500 상세 열기" }).click();
    const dialog = page.getByRole("dialog", { name: "S&P 500" });
    await expect(dialog.getByRole("heading", { name: "일별 거래량" })).toBeVisible();
    await expect(dialog.getByText("1,340,000,000")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "전체 상세 보기" })).toBeVisible();
  });
});
```

  Run it. Expected: PASS.

- [ ] **Step 7: Cap, design note and the approved edits #22–#25.**
  - **The cap.** In `scripts/design-baseline-cap.mjs` (keep CRLF):
    - Change `export const MARKET_WARN_CAP = 295;` to `export const MARKET_WARN_CAP = 0;`.
    - Replace the three comment lines above it with:

```js
// The market exception's warning cap. The market one-screen plan (docs/superpowers/plans/2026-10-16-market-one-screen.md)
// moved components/market/** and app/page.tsx to paper, so the cap is 0: any market warning fails the baseline.
// DS Task 14b removes the exception itself (docs/superpowers/plans/2026-10-12-design-system-formalization.md). It never rises.
```

  - **The approved edits.** First run `npm run test:unit` unedited. Expected: `the market warning cap is the recorded 295` and `exactly at the cap passes` fail. Then apply rows #22–#25, and run `npm run test:unit`. Expected: PASS.
  - **`DESIGN.md`.** Replace the bullet that starts `- Known exception, until the market one-screen plan lands:` with:

```markdown
- Known exception, until DS Task 14b: the lint rule is still `warn` (not `error`) in `components/market/**` and
  `app/page.tsx`, with 0 hits since the market one-screen plan, and `tests/e2e/paper-sweep.spec.ts` still skips the
  `/` route. `npm run design:baseline` exits non-zero on any warning: the cap in `apps/web/scripts/design-baseline-cap.mjs` is 0.
```

- [ ] **Step 8: Gates.**
  - Run `npm run design:baseline -- "components/market/**/*.{ts,tsx}" app/page.tsx components/data/SparklineCard.tsx`. `total` must be 0.
  - Run `npm run design:baseline`. `bySeverity` must be `{ "error": 0, "warn": 0 }`, and it must exit 0.
  - Run `npx eslint components/market app/page.tsx components/data/SparklineCard.tsx --max-warnings 0`. It must exit 0: no warning from any rule in the market files.
  - Run `npm run typecheck && npm run lint && npm run test:unit`.
  - Run the area specs (Task 5 Step 8 list) plus `market-one-screen.spec.ts` and `market-model.spec.ts`. Expected: PASS.

- [ ] **Step 9: Mutation matrix** (DS step 7, plus the cap)

| # | Mutation | Must fail |
|---|---|---|
| 1 | `SpreadsSection.tsx`: put `text-[var(--text-muted)]` back on the description `<p>` | `npm run design:baseline -- "components/market/**/*.{ts,tsx}"` reports `deprecatedVar: 1` and exits 1 |
| 2 | `ko.ts`: delete the `dailyVolume` entry (Playwright transpiles without a typecheck) | `in Korean: title, a figure…` (the heading reads `market.detail.dailyVolume`) |
| 3 | `design-baseline-cap.mjs`: `MARKET_WARN_CAP = 1` | `npm run test:unit`: `the market warning cap is 0 after the market one-screen plan` |
| 4 | `en.ts`: `dailyVolume: "Daily Volume"` → `"Daily volume"` | `market-overview.spec.ts` "market overview opens and closes detail…". This proves the English byte-identity is guarded by the existing spec. |
| 5 | `MarketOverviewClient.tsx`: the regime tile reads `detail.market_regime.regime_summary` again | Step 3's `git grep` check prints a line (manual check; recorded as such, not a test) |

  Restore each mutation.

- [ ] **Step 10: Capture (DS step 6).** Run `DESIGN_CAPTURE=market-paper npx playwright test tests/e2e/design-capture.spec.ts --workers=2`, then `node scripts/capture-review.mjs after-14a market-paper`. Put the review page path in the task report; the owner's verdict is taken in Task 7.

- [ ] **Step 11: Commit.** In `todo.md`, tick `M6`.

```bash
git add apps/web/components/market apps/web/app/page.tsx apps/web/lib/i18n apps/web/scripts/design-baseline-cap.mjs apps/web/scripts/design-baseline-cap.test.mjs apps/web/tests/e2e/market-one-screen.spec.ts docs/design/MoneyView_Glossary.md DESIGN.md guideline/sop/todo.md
git commit -m "refactor(design): market on paper tokens, formatNumber and en/ko strings; market warning cap 0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, capture review, full suite, merge back

**Model:** the controller (Opus) runs the gates; Sonnet writes the docs; **Opus does the final whole-branch review**.

**Files:** `docs/tabs/market-overview-tab.txt`, `docs/USER-GUIDE.md`, `docs/design/MoneyView_Interaction_Rules.md` (crlf), `guideline/sop/todo.md`; `ERROR-LOG.md` if a bug was found on the way.

- [ ] **Step 1: Task 2 is in.** `git log --oneline` on `feat/market-one-screen` must contain the cherry-picked `feat(market): GET /api/market/regime …` commit. If it is missing, stop.

- [ ] **Step 2: Catalog parity.** Run `npm run typecheck` (a key in `en` that is missing in `ko` fails), then:

```bash
node -e "const s=require('fs').readFileSync('lib/i18n/messages/ko.ts','utf8'); const m=s.slice(s.indexOf('  market: {'), s.indexOf('  news: {')); for (const x of m.matchAll(/:\s*\"([^\"]*[A-Za-z]{4,}[^\"]*)\"/g)) console.log(x[1])"
```

  Expected output: only English-by-design strings (backend unit and ticker examples such as "{unit}" templates, "MACD", "RSI-14", "OHLCV"). Translate any other line.

- [ ] **Step 3: Docs.**
  - In `docs/tabs/market-overview-tab.txt`:
    - Replace the subtitle line with `` - Subtitle: `Daily closes · indices, commodities, FX, crypto` ``.
    - Replace the `Market Dashboard` section description with the page as it now is: header regime line; tabs Instruments (five-column cards or table, spread figures) and Spreads (five charts); the detail modal unchanged.
  - In `docs/USER-GUIDE.md:48`, the Market Overview row reads: `See indices, commodities, FX and crypto on one screen: a regime line, the instrument cards and the theme-spread figures; the spread charts with their event lines are on the Spreads tab.`
  - In `docs/design/MoneyView_Interaction_Rules.md:242`, the Market Overview row reads `Single-column card stack | 5-column card grid; two page tabs; no page scroll`.
  - Do not edit `docs/archive/` or other plans.

- [ ] **Step 4: Capture review.** From `apps/web`:

```bash
DESIGN_CAPTURE=market-one-screen npx playwright test tests/e2e/design-capture.spec.ts --workers=2
node scripts/capture-review.mjs after-14a market-one-screen
python -c "import struct; f=open('design-capture/market-one-screen/market.png','rb'); f.read(16); print(struct.unpack('>II', f.read(8)))"
```

  - The last line must print `(1280, 720)`. Any other height means the page scrolls: stop and report it.
  - The owner reviews `/` against spec §1's diagram. The magenta boxes are the mask over the live-data cards, by design. The Spreads tab is not in the capture: the owner opens it in the running app, or reads Task 4's no-scroll test.
  - The other seven screens must be byte-identical to `after-14a`, apart from shared-shell changes that this branch does not make.
  - Record the review page path and one verdict line per screen in Track D.

- [ ] **Step 5: Full gates.**

```bash
cd apps/web && npm run tokens:check && npm run typecheck && npm run lint && npm run test:unit && npm run design:baseline
npx playwright test tests/e2e/[a-c]*.spec.ts --workers=2
npx playwright test tests/e2e/[d-h]*.spec.ts --workers=2
npx playwright test tests/e2e/[i-m]*.spec.ts --workers=2
npx playwright test tests/e2e/[n-r]*.spec.ts --workers=2
npx playwright test tests/e2e/[s-z]*.spec.ts --workers=2
cd ../.. && C:/Users/eajwa/anaconda3/envs/moneyview/python.exe -m pytest -q
```

  Run each Playwright chunk in the foreground, one at a time; split a chunk that passes 10 minutes. If a run is interrupted, kill :8110/:3101 before rerunning. Expected:
  - `design:baseline` total 0 and `bySeverity` `{ "error": 0, "warn": 0 }`;
  - Playwright at the D14a count (494 passed, 8 skipped) plus this plan's new tests, 0 failed. This includes `one-screen-no-scroll.spec.ts` on `/` at both sizes, which must pass, not be skipped;
  - pytest at 1883 + 7 passed.

  Record the counts in Track D.

- [ ] **Step 6: Review.** Run the `guideline/sop/code-reviewer.md` checklist over `git diff feat/design-system-paper...HEAD`, as the Opus final review. Every new test must have its matrix row executed. A test whose mutation did not make it fail is reported as unverified, not as passing (CLAUDE.md §8).

  Check in particular:
  - no number on screen is computed in the frontend that the backend computes (the regime counts);
  - `regime_summary` is unread;
  - the five Review Focus tests exist and were mutated.

- [ ] **Step 7: Tracking and 14b.**
  - In `todo.md`, tick `M7`.
  - Add these follow-ups under the market block:
    - the `ViewToggle` labels in Korean (N9; shared UI, with its own test list);
    - the drawer migration (UI-consolidation Task 7, amended);
    - the `regimeSummary` catalog copies follow the backend if it rewords (N7).
  - In the D14b line, append ` Unblocked once feat/market-one-screen merges into feat/design-system-paper: market warn 0 and ONE_SCREEN_ROUTES has "/". Its step 5 (paper-sweep on "/") is still to run.`
  - Commit:

```bash
git add docs/tabs/market-overview-tab.txt docs/USER-GUIDE.md docs/design/MoneyView_Interaction_Rules.md guideline/sop/todo.md
git commit -m "docs: market overview on one screen in the tab reference, user guide and interaction rules; tracking" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Merge back, after the owner accepts the capture review.**

```bash
git switch feat/design-system-paper
git merge --no-ff feat/market-one-screen -m "merge: market overview one-screen before DS Task 14b" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

  On an `ERROR-LOG.md` conflict, keep both sides' records. Do not push. DS Task 14b may start after this merge: its preconditions 1–3 then hold.

---

## Self-review (2026-10-16)

- **Spec coverage.**

  | Spec section | Task |
  |---|---|
  | Completion: no page scroll at 1280×720 and 390×844, both tabs | 4 (no-scroll test), 5 (fit test), 7 (capture 1280×720) |
  | Completion: the first screen answers "today's market" | 4 (regime line), 5 (cards, spread figures) |
  | §1 height budget, `py-6` removed, page column formula | 4 (root, `page.tsx`), 5 (measured boxes) |
  | §2.1 `ONE_SCREEN_ROUTES`, `isOneScreenRoute("/")`, `MarketPageTabs`, `useTabState`, fallback, active panel only, `Tabs` keys | 4 (+3 for the guard and key) |
  | §2.2 toolbar, five columns, "Detail available" removed, `article` + "Open detail for", table without Source | 5 |
  | §2.3 spread figures, states, tickers always, `spread-figure-<id>`, click → Spreads | 5 (+3 for `spreadFigure`) |
  | §2.4 Spreads tab, `minmax(220px, 1fr)` | 4 |
  | §2.5 backend route, wrapper, unknown = 200, VIX | 2 |
  | §2.5 hook, display states, tone, mono, no summary, no frontend counting | 3 (`regimeView`, hook), 4 (line) |
  | §2.6 modal unchanged in structure | 6 (tokens and catalogs only; N7) |
  | §3 deletions, subtitle, header i18n via a client wrapper | 4 (subtitle, header), 5 (deletions), 6 (catalogs) |
  | §3 paper and en/ko for page, market and SparklineCard; lint 0; cap 295 → 0 | 5 (new files clean), 6 |
  | §3 / §5 DS Task 13 drops market; 14b after | 1 (notes), 7 (unblock line) |
  | §4.1 e2e tests and mutations | 4, 5, 6 (each table maps the spec's mutation: `min-h-0` → T4 #1; 3 columns → T5 #1; key → T4 #4; ticker / refused → T5 #3–#4; click → T5 #7; unknown → mixed → T4 #7; error → empty → T4 #8; English literal → T4 #13) |
  | §4.1 unit test `isOneScreenRoute` | 4 (`market-model.spec.ts`) |
  | §4.1 pytest | 2 |
  | §4.2 approval list | inventory; 1 (gate); applied in 4 and 6 |
  | §4.3 gates | each task's gates; 7 |
  | §5 UI-consolidation Tasks 5 and 7 amendments | 1 |
  | §6 output contracts | the Output contracts table in Tasks 2–6 |

- **Placeholders.**
  - No "TBD" or "similar to Task N".
  - Task 4's `<EXISTING SECTION>` is a named, byte-for-byte move of a block the step locates by its opening and closing tags.
  - Task 6's catalog is specified by rules plus the fixed pinned strings, not by an exhaustive key list. Its English values are the current literals by rule 1, and Step 5 proves them with the unedited specs.
- **Type consistency.** These names are used identically in every task:
  - `MarketRegimeContext`, `MarketRegimeState`, `MarketRegimeStatus`, `RegimeView`, `RegimeTone`, `FigurePart`, `SpreadFigure`;
  - `MarketPageTab`, `MARKET_PAGE_TABS`, `MARKET_PAGE_TAB_KEY`, `isMarketPageTab`, `regimeView`, `withFigures`, `spreadFigure`, `MarketIndexQuote`;
  - `useMarketRegime`, `useMarketPageTab`, `MarketPageTabs`, `MarketHeader`, `MarketRegimeLine`, `FigureText`, `InstrumentsPanel`, `SpreadFigureRow`, `DEFAULT_SPREAD_WINDOW_DAYS`, `TONE_CLASS`;
  - `openMarketTab`, `marketPanel`;
  - the testids `market-page`, `market-page-tabs`, `market-regime`, `market-instruments`, `market-cards`, `market-table`, `spread-figures`, `spread-figure-<id>`;
  - the catalog keys `market.title`, `market.subtitle`, `market.tabs.*`, `market.regime.*`, `market.card.*`, `market.table.open`, `market.instruments.count`, `market.spreads.*`, `market.detail.*`.

  Each catalog key a component reads is added in the same task or an earlier one, in both `en` and `ko`.
- **Review Focus.** All five items have tests: Task 3 (1, 2, 4), Task 2 (3) and Task 4 (4, 5).
