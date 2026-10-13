# UI Consolidation: Tabs for Work Areas, a Drawer for Drill-ins, One Path Per Action

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every action in `apps/web` has one home, and each piece of content uses the container that fits how it is used (U9):
- Long-lived work areas are tabs or in-page sections.
- Quick drill-ins from a list open in one shared, non-blocking detail drawer.
- Contextual "where does this number come from" references and transient confirmations stay modal.

The portfolio page's stock browser becomes a full-list table, **Stocks**. Each row shows the stock's state (held with its amount, followed) and has its own actions: add or edit a holding by amount, follow or unfollow, open detail, and remove from the watchlist.

**Architecture:** UI only. No backend route, schema, seed or sync file changes.
- **Portfolio work areas become tabs.** The rail and `SidePanel` overlay are replaced by the shared `Tabs` component: Watchlist, Stocks, Allocation, Snapshot, Attribution.
- **One shared drill-in drawer.** `components/ui/DetailDrawerLayout.tsx` carries the portfolio stock detail (from a tile or a Stocks row) and the Market Overview instrument detail.
  - At ≥ 992 px it is an in-flow right column; the list stays visible, interactive and mounted.
  - Below 992 px it is a full-height sheet.
  - It replaces `StockDetailModal`'s and `MarketDetailModal`'s use of `ModalShell`.
- **`CalculationDetailModal` stays a modal** on `ModalShell`. Its one duplicated entry point (the outer **View Full Report** button) is removed.
- **Inline sections:** `SnapshotHistoryModal` becomes an inline section of the Snapshot tab, and the attribution methodology dialog becomes a `<details>`.
- **One add path.** The four portfolio add paths and the two follow paths collapse into the Stocks table's row actions. That table calls the endpoints the page already uses: `POST /portfolio/watchlist`, `POST /portfolio/watchlist/{ticker}/group` and `DELETE /portfolio/watchlist/{ticker}`.
- **Pure logic and orphans.** Row logic lives in `app/portfolio/stockListModel.ts` and is tested on its own. Components the change orphans are deleted: `PortfolioShell`, `SidePanel`, `PortfolioCommandCenter`, `HoldingsTable`, `ModalLoadingOverlay` and the snapshot "recent list". `ModalShell` and `IconButton` stay (C1 and the drawer use them).

**Tech Stack:** Next.js 16.2 app router, React 19 (`inert` prop, `useSyncExternalStore`), Tailwind CSS 4 (container queries `@container`), @tanstack/react-query 5, Playwright (e2e and model specs), FastAPI backend unchanged.

**Spec (owner request, no separate spec doc):**

> **2026-10-13 (translated):** "Among the existing features, especially the way of adding a snapshot or adding a followed stock: simplify it and make it visual. Before, you clicked an icon and added each one directly. It would be better if, from the full list, each individual stock could be added."
>
> **Owner clarifications:**
> - "Snapshot" means the record of which stock and how much was bought: portfolio holdings / purchase records.
> - The problem also covers making a stock "Followed".
> - "Full list" means the full stock browser on the portfolio page. It becomes a table-style full list where each row has its own add actions (add as a holding with the purchase amount; follow/unfollow) and shows its current state (already held / followed).
>
> **Scope extension (2026-10-13, translated):** "Also remove every point of functional duplication, and to improve readability remove unnecessary systems — like needlessly popping up a snapshot modal — so everything can be handled with tabs."
>
> **Revision (2026-10-13, owner):** Some modals are more efficient as overlays than as tabs.
> - **Keep an overlay** for quick drill-ins from a list (open, glance, return to the same list position, often several items in a row), for contextual "where does this number come from" references opened from many entry points, and for transient confirmations.
> - **Use a tab or an in-page section** for long-lived work areas, and where several entry points duplicate one content.
> - Stock detail and market detail share one non-blocking drawer. The calculation detail stays a modal.

**Sequencing:** This plan runs **after** `2026-10-12-design-system-formalization.md` has merged, Task 14 included. It builds on that plan's components and tokens:

| From the design-system plan | Used here as |
|---|---|
| Task 8 `ActionButton` (`primary`/`secondary`/`danger`, `sm`/`md`) | every row action, the editor's Save/Cancel, Refresh news |
| Task 8 `DenseTable` with `ColumnDef.label?: LabelKey`, `align: "right"` → `type-mono` figure cells | the Stocks table |
| Task 8 `ToggleGroup` (the `mv-seg` look) | the Stocks status filter: All / Held / Followed |
| Task 8 `Tabs` restyle (brand underline, `type-mono`) | the portfolio page tabs |
| Task 8 `ModalShell` restyle (square panel, `--overlay-scrim`, hairline) | unchanged C1 modal; the drawer copies its header classes |
| Task 8 `fieldInputClass` from `InlineField.tsx` | the amount input and the unlisted-ticker form |
| Task 7 `useT()`, `useLocale()`, `en`/`ko` catalogs, `LABELS` + `BilingualLabel`, glossary | all new copy and table headers |
| Task 6 `formatNumber(value, kind, { locale })`, `MISSING` | amounts and the unallocated figure |
| Task 5 `tokens.bp.desktop` (`"992px"`, `lib/tokens.generated.ts`) | the drawer's desktop/sheet switch |
| Tokens: `--bg`, `--line`, `--grid`, `--surface`, `--ink`, `--ink-muted`, `--brand-soft`, `--brand-text`, `--status-error-ink`, `--radius-1`, `--radius-2`; utilities `type-caption`, `type-small`, `type-body`, `type-mono`, `type-panel-title`, `type-heading-5` | the class strings in the new code |
| Task 7/8 route `/dev/design` gallery | the `Tabs` keyboard test surface |

**If run before the design-system plan:**
- Use `DenseTable`'s `header: string` instead of `label`, and plain English strings in `app/portfolio/stocksCopy.ts` instead of `t(...)`.
- Use `var(--border)`, `var(--text-muted)`, `var(--bg-elevated)` and `rounded-[var(--radius)]` instead of the paper tokens, and `formatCurrencyCompact` instead of `formatNumber`.
- Use the literal `"(min-width: 1024px)"` for the drawer query (today's `lg`), and mount the Tabs keyboard test on `/portfolio` instead of `/dev/design`.
- Every behavioural test still applies unchanged. Only the class strings, the breakpoint value and the copy plumbing differ.

---

## UX decisions (decided, with the cost if wrong)

| # | Decision | Why | Cost if wrong |
|---|---|---|---|
| U1 | **Inline editor in the row's Actions cell**, not a popover. "Add holding" turns the cell into `[amount input] [Save] [Cancel]`. | A popover needs positioning inside a scrolling tab panel, outside-click and Escape handling, and focus return. The inline cell gets focus order, Escape and form submit for free, and `DenseTable` renders it through `render`. | The Actions column widens while a row is open, a one-row layout shift. Moving to a popover later is local to `StockListTable.tsx`. |
| U2 | **"Add holding" records an invested amount in dollars and nothing else.** It is stored as `weight = amount / total_investment_amount`. | The backend stores only `watchlist.weight` (0–1) and the `portfolio_preferences.total_investment_amount` preference. The Allocation editor already shows `weight × total` as "Invested Amount". There is no quantity, purchase price or date column. Adding them would be new financial semantics, a schema change and a new sync payload. | If the owner wants real purchase records (shares, price, date, lots), this needs a new backend plan (owner question Q1). The UI here would then change the input, not the layout. |
| U3 | **An amount above the unallocated money is refused**, with no request sent. The refusal names the unallocated figure and says to raise "Total investment amount" in the Allocation tab. | Saved weights above 100% pause attribution (`weightsOverflow`). Letting a row add create that state silently would break another tab. | The owner cannot record a holding bigger than the remaining budget without first raising the total, which rescales every amount (Q2). |
| U4 | **Feedback without undo.** The existing `portfolio-mutation-message` line becomes a `role="status"` live region and reports every row action. The row's state chips update after the refetch. | Every row action has a one-click opposite in the same row: unfollow, edit the amount to 0, or follow again. Undo would mean a second write path for the same row. | A wrong "Remove" loses that row's amount, as it already does today. Re-adding the row restores it, and peer sync handles a re-add after a tombstone because the newer causal stamp wins. |
| U5 | **Keyboard and screen readers in the table:** <br>• The ticker cell is a real `<button>` ("Open AAPL detail") that opens the drawer; rows are not clickable `<tr>`s. <br>• Follow is a toggle (`aria-pressed`, "Follow AAPL"). <br>• The hold button is "Add AAPL holding" or "Edit AAPL amount". <br>• The editor input takes focus on open; Escape or Cancel returns focus to the hold button. <br>• A refusal is `role="alert"`, tied by `aria-describedby`, with `aria-invalid` on the input. <br>• Tabs get Left/Right/Home/End (Task 1). | The table repeats the same actions on about 150 rows. Without per-row names, a screen reader hears "Follow, Follow, Follow…". | Low. These are additive attributes. |
| U6 | **Old add paths are removed. A reduced manual form stays only for tickers not in the list:** "Not in the list?" with Ticker, Name and Sector. It creates the row unfollowed with a 0 amount. | The universe (`GET /corporate/companies`) is seed + watchlist + manual companies, so a brand-new ticker needs one way in. The allocation % field and the "Add to Watchlist only" toggle duplicate the row actions. | An extra step for a new ticker: add it, then follow or hold it from its row. |
| U7 | **Follow lives only in the Stocks table.** The tile grid's follow button is removed; the grid is a read view that opens detail. | It duplicates the row toggle (owner: remove every duplication). | Unfollowing from the Watchlist grid takes a tab switch (Q4). Restoring it is one prop on `StockTile`. |
| U8 | **Holding and following stay independent.** Adding a holding to a stock not on the watchlist creates it unfollowed (`group_name = "total"`). | That matches the data model: group and weight are separate columns, and the existing toggle never touches weight. | A newly held stock does not appear in the default (Followed) grid filter until it is followed (Q3). |
| U9 | **The container follows the use (owner criterion, 2026-10-13).** Each overlay in the inventory is classified as one of the following. <br>• **work area** → tab or section: P1 portfolio sections, P12 snapshot history, P13 methodology. <br>• **list drill-in** → shared drawer: P7 stock detail, M1 market detail. <br>• **contextual reference** → modal: C1 calculation detail, opened from about 20 metric, slider and chart titles. <br>• **transient confirmation** → kept as is: P17 import arming. | Drill-ins are opened, glanced at and left, often for several rows in a row; a tab switch loses the list. A work area holds state for minutes; an overlay hides the page it belongs to. | If a drill-in turns out to be a work area (the owner edits sector or reads news there for minutes), the drawer still holds it, just narrower than a tab. Promoting it later is a move of one panel component. |
| U10 | **The drawer is an in-flow right column at ≥ 992 px.** The list reflows narrower beside it and nothing is covered. Below 992 px it is a full-height sheet. | A fixed overlay would cover the right side of the list. That is the Stocks table's Actions column and the right tile column, exactly what the owner reaches for next. In-flow keeps every row reachable. The tile grid already reflows by width (`auto-fill, minmax(260px, 1fr)`); market cards move to container queries (Task 7). | Opening reflows the list. Columns drop by one, so the opened row can move on screen. Position is anchored to the opener (it is kept in view, and focus returns to it on close), not to a pixel offset. If the owner wants zero reflow, switch the aside to `fixed` at ≥ 992 px in `DetailDrawerLayout` and accept the covered column. That is a one-class change. |
| U11 | **The drawer is non-modal at ≥ 992 px, modal as a sheet.** <br>• Desktop: `role="dialog"` with `aria-modal="false"`, no backdrop, no scroll lock, no focus trap. The list stays clickable, and opening another row swaps the content in place (one drawer, never stacked). <br>• Sheet: `aria-modal="true"`, the list is made `inert`, and Tab is trapped. <br>• Both: Escape and a close button close it; focus moves to the close button on open and returns to the opener on close; `aria-labelledby` names it with the item's title. | A non-blocking drawer must not take the page away; a full-screen sheet with a live page behind it would let Tab wander into invisible content. | A screen-reader user on desktop can Tab from the drawer back into the list. That is intended (non-blocking), but it differs from today's modal. |
| U12 | **The drawer is a new component, `DetailDrawerLayout`, not a `ModalShell` mode.** It reuses `ModalShell`'s internals by extraction: the focus-trap function and focusable selector move to `components/ui/focusTrap.ts`, which both import, and the drawer copies the `onCloseRef` Escape pattern (ERROR-LOG.md 2026-08-02). `ModalShell` stays for C1. | `ModalShell`'s defining behaviours (`aria-modal`, backdrop click, body scroll lock, centred layout, always-on trap) are exactly what the desktop drawer must not do. Five flags on `ModalShell` would make the C1 modal's behaviour depend on defaults. Deleting `ModalShell` is not possible while C1 stays a modal. | Two Escape listeners exist (about 15 duplicated lines). If a third overlay type arrives, fold both into one hook then, not now. |
| U13 | **The drawer's close button is named "Close detail", not "Close modal".** | On desktop the drawer is not modal, so "modal" would be announced wrongly. | Eleven `Close modal` locators in five spec files change: `market-overview` 4, `market-overview.live` 3, `responsive-accessibility` 1, `portfolio-watchlist` 2, `portfolio-snapshot-history` 1. Keeping "Close modal" would leave them unchanged but announce a false role. |

---

## Global Constraints

- Run `npm` and `npx` in `apps/web`, `git` from the repo root, and use Git Bash.
- Branch: `feat/ui-consolidation-tabs`, cut from `renewal` after the design-system plan merges. Never commit onto `feat/macro-signal-engine` or `feat/design-system-paper`. `app/signals/**`, `packages/shared-types/signals.ts`, `apps/api/services/signals/**` and `apps/api/routes/signals.py` are out of scope.
- **UI only.** No change under `apps/api/`, `packages/core_finance/`, seeds, `stock_targets.json`, or the watchlist or records sync code. If a backend endpoint becomes unused by everything, list it in Follow-ups; do not delete it. (Checked: none does.)
- `POST /portfolio/watchlist` is a **full-row upsert** whose `weight` defaults to 0. Every call from the Stocks table sends the row's current `name`, `sector`, `group_name` and `weight` and changes only the field the action is about. Follow on an existing row uses only `POST /watchlist/{ticker}/group`.
- Baseline gates after every task: `npm run typecheck`, `npm run lint`, `npm run test:unit` and the full Playwright suite. pytest is unaffected and must stay at its current count; run `python -m pytest -q` from the repo root once at Task 9.
- **CLAUDE.md §8:** every new test is shown failing against the named mutation in its task's table, then the source is restored. A run that passes is never reported as verification.
- **Existing tests.** The owner's 2026-10-13 instructions approve removing the features. The edits to the tests that pin those features are listed one by one in "Existing tests this plan changes" below; the owner approves that list before Task 3 starts. No test outside that list is edited. If a test outside the list fails, stop and report it.
- `ERROR-LOG.md` is appended by concurrent branches. On a merge conflict, keep both sides.
- SOPs: `guideline/sop/file-structure.md` (Tasks 3, 5), `test-verification.md` (all), `refactor-cleaner.md` (Tasks 3–9), `code-reviewer.md` (Task 9). `finance-logic.md` does not apply: no formula changes. `amount / total` is the unit conversion the Allocation editor already does in reverse.

---

## Review Focus

The five most likely real-world failures, each with the test that owns it:

1. **The upsert flattens a field the action did not touch.**
   - Two ways it happens: adding a holding to a followed stock sends `group_name: "total"`, or following a held stock goes through the upsert and zeroes its weight.
   - Tests: Task 2 `holdingPayload keeps the row's name, sector and group`, `followRequest uses the group endpoint for a watchlist row`. Task 4 `adding a holding to a followed stock keeps it followed and named`, `following a held stock keeps its amount and never uses the upsert`.
2. **A row add pushes saved weights above 100%,** which pauses attribution in another tab.
   - Tests: Task 2 `an amount above the unallocated money is refused with the unallocated figure`. Task 4 `an amount above the unallocated money is refused and nothing is sent`.
3. **A pending Allocation draft reverts the table's save.**
   - The Allocation editor auto-saves `weightDrafts` 450 ms after typing, from a page-level effect that keeps running when its tab is not shown.
   - Test: Task 4 `a pending allocation draft does not overwrite a holding saved from the table` (fake clock).
4. **One Escape press closes two things.**
   - With the drawer open beside the Stocks table, Escape in the inline amount editor must close only the editor. The drawer listens on `document`, and a listener that ignores `defaultPrevented` also closes the drawer and throws focus away.
   - Test: Task 5 `Escape in the amount editor closes the editor, not the drawer`.
5. **The drawer loses the user's place.**
   - Four ways: opening a second row stacks a second dialog; closing drops focus to `<body>`; the list remounts and jumps to the top; or a narrow-screen sheet leaves the hidden list in the Tab order.
   - Tests: Task 5 `opening another stock swaps the drawer, never stacks it`, `closing returns focus to the opener and the list keeps its place`, `below 992px the drawer is a modal sheet over an inert list`. Task 7 `an index opens in the drawer beside the grid, which stays usable`.

The stored-tab fallback (`an unknown stored tab falls back to Watchlist`, Task 3) is tested too, but is less likely than these five.

---

## Inventory: duplicated functions and overlays (audit of `apps/web/app/*` and shared components)

Audit date: 2026-10-13, on `feat/macro-signal-engine` at `b2190dc`. Overlays were found with `git grep -n 'ModalShell\|role="dialog"\|aria-modal\|SidePanel\|createPortal' -- apps/web/app apps/web/components`. Duplicates were found by tracing every caller of the watchlist mutations, every opener of the overlays, and every `setActiveCalculation(` call. The class column uses U9: **W** work area, **D** list drill-in, **R** contextual reference, **T** transient confirmation, **–** not an overlay. 31 rows.

| # | Item | Where it appears | Class | Duplicates / why it is an overlay | Recommendation | Tests that reference it |
|---|---|---|---|---|---|---|
| P1 | Rail + `SidePanel` slide-over (`PortfolioShell`, `SidePanel`) | `app/portfolio/components/PortfolioShell.tsx`, `SidePanel.tsx`, `page.tsx` | W | Four work areas (snapshot, attribution, allocation, holdings) open as `role="dialog"` overlays from icons; only one is visible at a time, and the page needs focus-request plumbing (`allocationFocusRequest`) to reach into them | **Remove → page tabs** (Task 3) | `portfolio-tile-grid.spec.ts` (:78, :91, :103, :129, :550, :645), `portfolio-panel-presentation.spec.ts` (all 7), `portfolio-news-failure-honesty.spec.ts`, `helpers/portfolioPanels.ts` and its callers |
| P2 | Stock browser list with `+ Add` / `Added` | `PortfolioCommandCenter.tsx` | – | An add path (group `browser`, weight 0) that can neither hold nor follow | **Merge into Stocks tab** row actions (Task 4) | `portfolio-watchlist.spec.ts` (:89–92, :118–119, :195–211), `portfolio-snapshot-history.spec.ts:72`, `high-risk-render-regression.spec.ts:114` |
| P3 | Manual Add form (ticker, name, sector, allocation %, "Add to Watchlist only") | `PortfolioCommandCenter.tsx`, `handleAddHolding` | – | The third add path; the allocation % duplicates the Allocation editor, the toggle duplicates follow | **Reduce** to "Not in the list?" (ticker, name, sector) inside Stocks (Task 4) | `portfolio-watchlist.spec.ts` helpers `addHolding`, `addHoldingWithAllocation` and their callers; `refresh-idle-state.spec.ts:551–555` |
| P4 | Holdings panel **Add** button | `page.tsx` → `requestAllocationFocus(null)` | – | The fourth add path; it only opens the Allocation panel | **Remove** (Task 4) | `portfolio-tile-grid.spec.ts:583` |
| P5 | Detail **Add To Portfolio / Review Portfolio Weight** | `StockDetailModal.tsx:476` → `handleFocusAllocationForStock` | – | The fifth add path | **Remove** (Task 5) | `portfolio-tile-grid.spec.ts:616`, `:645`; `portfolio-watchlist.spec.ts:205` |
| P6 | Detail **Remove From Watchlist** | `StockDetailModal.tsx:488` | – | The same as the Stocks row's **Remove** | **Remove** (Task 5) | `portfolio-watchlist.spec.ts:204` (asserts count 0, which still holds) |
| P7 | `StockDetailModal` (chart, metrics, audit, history, news, sector edit) | `page.tsx` dynamic import, opened from tiles, holdings rows and browser rows | D | A list drill-in, opened for several stocks in a row | **Move → shared drawer** (Task 5) | `portfolio-watchlist.spec.ts` (Close modal :135, :206), `portfolio-snapshot-history.spec.ts` (stock part of test 2), `portfolio-tile-grid.spec.ts:650`, `refresh-idle-state.spec.ts:565` — locators `portfolioModal` / `getByRole("dialog")` keep working |
| P8 | Holdings panel **card ("chart") view** + `ViewToggle` | `page.tsx` `holdingsPanelBody` | – | The same watchlist with sparklines as the main tile grid | **Remove** (Task 4) | `portfolio-watchlist.spec.ts:128` (clicks a card) |
| P9 | Holdings panel **sector-grouped table** (`HoldingsTable`) + sector chips | `page.tsx:472–572`, `:2700–2840` | – | A second watchlist table; only its metric columns and **Remove** are unique | **Merge into Stocks table** (metric columns and Remove move over; the search matches sector) (Task 4) | `portfolio-watchlist.spec.ts` (`removeButtons`, :86–101, :388–400), `portfolio-tile-grid.spec.ts:293` |
| P10 | Holdings panel **Sync** button | `page.tsx` `holdingsPanelBody` | – | Calls `syncWatchlistMutation`, the same as **Export Watchlist To JSON** | **Remove** (Task 4) | none by name |
| P11 | Tile **follow** button | `StockTile.tsx:141`, `StockTileGrid` `onToggleFollow` | – | The same action as the Stocks row's Follow | **Remove** (Task 4, U7) | `portfolio-tile-grid.spec.ts:374, :388, :479, :524` |
| P12 | Snapshot history: "Saved Snapshot List", **View All Saved Snapshots**, **Open Snapshot History**, `SnapshotHistoryModal` | `page.tsx:2320–2470`, `PortfolioSnapshotSummary.tsx:158`, `SnapshotHistoryModal.tsx` | W | Two buttons into a modal plus a partial inline copy of its list; the owner named it as needless | **Merge → one inline "Snapshot history" section** in the Snapshot tab (Task 6) | `portfolio-snapshot-history.spec.ts` (test 1, history part of test 2), `snapshot-history-metric-version.spec.ts` (6 tests via `portfolioModal`) |
| P13 | Attribution **methodology** dialog | `components/charts/AttributionWaterfall.tsx:128` | W | A hand-rolled `role="dialog"` for static text read beside the chart | **Move → inline `<details>`** (Task 6) | none |
| P14 | Rail **Refresh news** action | `page.tsx` `onRailAction` | – | Rail-only; the rail goes | **Move** to a button in the Watchlist tab (Task 3) | `portfolio-tile-grid.spec.ts:535, :550, :568`, `portfolio-news-failure-honesty.spec.ts` |
| P15 | `ModalLoadingOverlay` | `page.tsx:56` | – | A full-screen spinner for the dynamic modal imports | **Delete.** The drawer shows its own in-panel loading state (Task 5); the history modal goes (Task 6). | none |
| P16 | Export/Import JSON + sync status block | `PortfolioCommandCenter.tsx:245–290` | – | Not a duplicate once P10 goes | **Keep**, moved to the Stocks tab footer as `WatchlistFileControls` (Task 4) | `portfolio-watchlist.spec.ts:104, :285, :293`, `watchlist-peer-sync.spec.ts:99–116` (navigation only) |
| P17 | Import arming checkbox | same block | T | A transient destructive-action confirmation | **Keep** | as P16 |
| P18 | Sector edit in the detail | `StockDetailModal.tsx:413` | – | The only sector edit path | **Keep** in the drawer (Task 5) | `portfolio-watchlist.spec.ts` |
| M1 | `MarketDetailModal` | `components/market/MarketOverviewClient.tsx:357`, opened from cards and table rows | D | A list drill-in, often several instruments in a row | **Move → shared drawer** (Task 7) | `market-overview.spec.ts` (Close modal ×4), `market-overview.live.spec.ts` (×3), `responsive-accessibility.spec.ts:114`; `market-spreads`, `market-event-lines`, `event-tooltip`, `event-filter` keep their `role="dialog"` locators unchanged |
| M2 | **View Full Detail** link to `/detail/[ticker]` | the market and portfolio details | – | Not a duplicate: `/detail` has the DCF and diagnostic workbenches | **Keep** in both drawers | `responsive-accessibility.spec.ts` |
| M3 | Overview graph/table `ViewToggle` | `MarketOverviewClient.tsx` | – | Two presentations of one list | **Keep** | `market-overview.spec.ts:26` |
| C1 | `CalculationDetailModal` (audit, lineage, raw data, DCF report, CSV downloads) | `app/corporate/page.tsx:1185` | R | A "where does this number come from" reference opened from about 20 entry points: KPI titles, the slider detail buttons in `CorporateAssumptionsPanel`, graph titles and bars, comparison-table metrics | **Keep as a modal** on `ModalShell` | all corporate specs, unchanged |
| C1a | Outer **View Full Report** button | `corporate/page.tsx:976–983` | – | Opens the same `backendDcf` modal as the **Intrinsic DCF** tile (`:945`) and pre-loads the report that the modal's own **Load Full Report** button (`CalculationDetailModal.tsx:420`) loads | **Remove** (Task 8). The path becomes tile → Full DCF Report → Load Full Report. | `corporate-comparison.spec.ts:115–117`, `corporate-dcf-sensitivity.spec.ts:33`, `refresh-idle-state.spec.ts:628` |
| C1b | `crp` opened from the CRP slider (`CorporateAssumptionsPanel.tsx:169`) and the hurdle chart bar (`HurdleRateDecompositionGraph.tsx:52`) | corporate | R | The same reference from two contexts | **Keep.** Contextual references from many entry points are the reason C1 stays a modal (U9). | none |
| C2 | Comparison universe/benchmark controls on Corporate **and** on the Portfolio Snapshot tab | `corporate/page.tsx:170–175`, `page.tsx` snapshot body | – | The same `/corporate/comparison` request shape | **Keep, follow-up.** The Portfolio copy also owns the snapshot write; merging means deciding which tab owns snapshot writes. | — |
| S1 | `ModalShell` | `components/ui/ModalShell.tsx` | – | Still used by C1 | **Keep.** Its focus-trap helper is extracted to `focusTrap.ts` for the drawer (Task 5). | all corporate dialog specs |
| S2 | `IconButton` | `components/ui/IconButton.tsx` | – | Used by `ModalShell` and the drawer's close button | **Keep** | none |
| S3 | `Tabs` | `components/ui/Tabs.tsx` | – | Unused today, and keyboard-inaccessible: unselected tabs have `tabIndex=-1` and no arrow-key handler | **Fix and adopt** (Task 1) | none |
| S4 | `EventFilter` popover, `InfoTooltip` | `components/charts/EventFilter.tsx`, `components/ui/InfoTooltip.tsx` | T | Transient menus and tooltips | **Keep** | `event-filter.spec.ts` |
| S5 | DCF surfaces: `/detail` `DCFWorkbench`, Corporate DCF report, `/valuation`, Monte Carlo valuation tab, `/cases` | several | – | Related subject, different computations | **Keep, follow-up** under `finance-logic.md` | — |
| S6 | Monte Carlo five-tab layout | `app/monte-carlo/page.tsx` | – | Already tabs | **Keep** | — |

**Top removals by impact:**
1. P1, the portfolio rail and slide-over system. One overlay layer and its focus plumbing go; four work areas become tabs.
2. P2–P5, four add paths that become one per-row flow.
3. P12, four snapshot-history entry points that become one inline section.
4. P7 + M1, two content modals that become one shared non-blocking drawer.
5. P8–P10, the holdings panel's duplicate card view, second table and second export button.

---

## Existing tests this plan changes (owner approval list)

**15 files: 14 edited, 1 deleted.** Each line names the file, the edit, and what covers the removed behaviour from then on. "Navigation only" means the assertions are unchanged and only the way the spec reaches the content changes.

| File | Change | Coverage after |
|---|---|---|
| `helpers/portfolioPanels.ts` | Rewritten. `openPortfolioPanel(page, id)` clicks a tab and returns the tab panel. Ids: `watchlist`, `stocks`, `allocation`, `snapshot`, `attribution`. `portfolioRail` is deleted. `portfolioModal` stays verbatim: its selector still finds the drawer, the only dialog on the page. | Task 3 `tabs-portfolio.spec.ts` |
| `portfolio-panel-presentation.spec.ts` | **Deleted.** Its 7 tests pin slide-over behaviour that no longer exists. The design-system Task 10 Korean assertion in it moves to `tabs-portfolio.spec.ts`. | `tabs-portfolio.spec.ts` |
| `portfolio-tile-grid.spec.ts` | Delete :78 (rail Escape), :91 (one panel at a time), :129 (pinned panel), :583 (holdings Add), :616 (detail Add To Portfolio), and :374, :388, :479, :524 (tile follow). <br>:103 becomes "switching tabs performs no fetch". :550 becomes "the Refresh news button shows progress". <br>:645 becomes "the mutation message survives switching every tab", opening the drawer and closing it with "Close detail" instead of the Add To Portfolio click. <br>:43/:451 are unchanged. | Tasks 3, 4, 5 |
| `portfolio-watchlist.spec.ts` | Add helpers become `addUnlisted` + row "Add holding". `browserRow` becomes the Stocks row locator. `removeButtons` scopes to the Stocks table. `+ Add` / `Added` become row state chips. "Add To Portfolio" assertions are deleted. The card-click detail test (:128) opens detail from a tile. The Escape-with-rail test (:163) becomes "Escape closes the drawer". `Close modal` (:135, :206) becomes `Close detail`. Every value assertion (60.0%, 40.0%, 14.31%, 4.61%, saved messages, export/import texts) is unchanged. | Tasks 4, 5 |
| `portfolio-snapshot-history.spec.ts` | Test 1 asserts the inline history section (same content assertions, minus focus-on-Close and outside-click-closes). Test 2 measures overflow on the Snapshot tab and the drawer, opens detail from the Stocks row, and closes with `Close detail`. | Tasks 5, 6 |
| `snapshot-history-metric-version.spec.ts` | `portfolioModal(page)` becomes `portfolioPanel(page, "snapshot")`. Navigation only. | — |
| `refresh-idle-state.spec.ts` | :551–555 manual add becomes `addUnlisted`. :563 `openPortfolioPanel(…, "holdings")` becomes `"stocks"` plus a click on the row's detail button. :628 `View Full Report` becomes the `openFullDcfReport` helper (C1a). | Tasks 4, 8 | **Superseded: handled by the corporate one-screen plan.**
| `high-risk-render-regression.spec.ts` | :114 `"Stock Search Panel"` becomes the Stocks search box. The 9 `openPortfolioPanel` ids map `holdings` → `stocks`. | — |
| `portfolio-news-failure-honesty.spec.ts` | The rail locator becomes the Watchlist tab's Refresh news button. Navigation only. | — |
| `watchlist-peer-sync.spec.ts` | 3 × `openPortfolioPanel(…, "allocation")` → `"stocks"`, where export/import now lives. Navigation only. | — |
| `market-overview.spec.ts` | 4 × `Close modal` → `Close detail` (U13). Every `getByRole("dialog", { name })` stays. | Task 7 |
| `market-overview.live.spec.ts` | 3 × `Close modal` → `Close detail`. | Task 7 |
| `responsive-accessibility.spec.ts` | :114 `Close modal` → `Close detail`. The rest of "modal focus, keyboard navigation, and aria hooks" holds as written: focus on close on open, Tab to View Full Detail, Escape returns focus to the trigger. | Task 7 |
| `corporate-comparison.spec.ts` | :115–117 `View Full Report` click → `openFullDcfReport(page)` (tile → Full DCF Report → Load Full Report). Every dialog assertion stays. | Task 8 | **Superseded: handled by the corporate one-screen plan.**
| `corporate-dcf-sensitivity.spec.ts` | `openFullReport` (:32–37) clicks the tile, expands Full DCF Report and clicks Load Full Report instead of `View Full Report`. | Task 8 | **Superseded: handled by the corporate one-screen plan.**

**Unchanged** although they assert `role="dialog"`: `market-spreads.spec.ts`, `market-event-lines.spec.ts`, `event-tooltip.spec.ts`, `event-filter.spec.ts`, `corporate-comparison-bridge.spec.ts`, `corporate-composite-score.spec.ts`, `corporate-estimated-value-bridge.spec.ts`, `corporate-probability-labels.spec.ts`. The drawer keeps `role="dialog"` with the item's name, and C1 stays a `ModalShell` dialog.

---

## File structure

| Path | Change | Responsibility |
|---|---|---|
| `apps/web/components/ui/Tabs.tsx` | modify | Arrow/Home/End keyboard, automatic activation |
| `apps/web/components/ui/TabPanel.tsx` | create | `role="tabpanel"` labelled by its tab |
| `apps/web/components/ui/focusTrap.ts` | create | `FOCUSABLE`, `trapTab`, extracted from `ModalShell` |
| `apps/web/components/ui/ModalShell.tsx` | modify | imports `focusTrap.ts`; behaviour unchanged |
| `apps/web/components/ui/DetailDrawerLayout.tsx` | create | list + shared drill-in drawer (desktop column / mobile sheet), `DrawerHeader`, `useIsDesktop` |
| `apps/web/components/ui/ActionButton.tsx` | modify | optional `ariaLabel`, `ariaPressed` |
| `apps/web/app/dev/design/page.tsx` | modify | `gallery-tabs` sample |
| `apps/web/app/portfolio/stockListModel.ts` | create | rows, filter, amount→weight check, request payloads |
| `apps/web/app/portfolio/components/PortfolioTabs.tsx` | create | header + tabs + scroll region + drawer slot |
| `apps/web/app/portfolio/components/StockListTable.tsx` | create | the Stocks table, row editor, unlisted form |
| `apps/web/app/portfolio/components/WatchlistFileControls.tsx` | create | export/import/sync-status block moved out of `PortfolioCommandCenter` |
| `apps/web/app/portfolio/components/StockDetailPanel.tsx` | rename from `StockDetailModal.tsx` | stock detail as drawer content |
| `apps/web/app/portfolio/components/SnapshotHistorySection.tsx` | rename from `SnapshotHistoryModal.tsx` | inline history |
| `apps/web/app/portfolio/page.tsx` | modify | tabs, drawer, mutations, removed paths |
| `apps/web/app/portfolio/components/{StockTile,StockTileGrid,PortfolioSnapshotSummary}.tsx` | modify | follow removed; history button removed |
| `apps/web/app/portfolio/components/{PortfolioShell,SidePanel,PortfolioCommandCenter}.tsx` | delete | orphaned |
| `apps/web/components/charts/AttributionWaterfall.tsx` | modify | methodology inline |
| `apps/web/components/market/MarketOverviewClient.tsx` | modify | detail in the drawer; card grid on container queries |
| `apps/web/app/corporate/page.tsx` | modify | superseded (corporate one-screen plan) |
| `apps/web/lib/i18n/messages/{en,ko}.ts`, `lib/i18n/labels.ts`, `docs/design/MoneyView_Glossary.md` | modify | new copy and labels |
| `apps/web/tests/e2e/{tabs-keyboard,stock-list-model,tabs-portfolio,portfolio-stock-list,detail-drawer}.spec.ts` | create | new tests |
| `docs/USER-GUIDE.md`, `guideline/sop/todo.md` | modify | user-facing description, tracking |

---

### Task 1: Accessible `Tabs` and `TabPanel`

**Files:** Modify `components/ui/Tabs.tsx` and `app/dev/design/page.tsx`. Create `components/ui/TabPanel.tsx` and `tests/e2e/tabs-keyboard.spec.ts`.

**Interfaces:**
- Produces: `Tabs` (same props) with keyboard support.
- Produces: `TabPanel({ tabKey, children, className?, testId? })`, which renders `id="panel-<key>"` and `aria-labelledby="tab-<key>"`.

- [ ] **Step 1: Failing test** (`tests/e2e/tabs-keyboard.spec.ts`)

```ts
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/design", { waitUntil: "domcontentloaded" });
});

test("arrow keys move selection and focus between tabs; Home and End jump; ends wrap", async ({ page }) => {
  const gallery = page.getByTestId("gallery-tabs");
  const tab = (name: string) => gallery.getByRole("tab", { name, exact: true });
  await tab("One").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab("Two")).toBeFocused();
  await expect(tab("Two")).toHaveAttribute("aria-selected", "true");
  await expect(gallery.getByRole("tabpanel", { name: "Two" })).toHaveText("Panel two");
  await page.keyboard.press("End");
  await expect(tab("Three")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tab("One")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab("Three")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab("One")).toHaveAttribute("aria-selected", "true");
});

test("only the selected tab is in the tab order, and Tab moves on into its panel", async ({ page }) => {
  const gallery = page.getByTestId("gallery-tabs");
  await gallery.getByRole("tab", { name: "Two", exact: true }).click();
  await gallery.getByRole("tab", { name: "Two", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(gallery.getByRole("tabpanel", { name: "Two" })).toBeFocused();
});
```

Run `npx playwright test tests/e2e/tabs-keyboard.spec.ts`. Expected: FAIL, because `gallery-tabs` does not exist.

- [ ] **Step 2: `components/ui/TabPanel.tsx`**

```tsx
import type { ReactNode } from "react";

/** The panel for the selected `Tabs` item. Named by its tab, focusable so Tab reaches it. */
export function TabPanel({ tabKey, children, className, testId }: {
  tabKey: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div role="tabpanel" id={`panel-${tabKey}`} aria-labelledby={`tab-${tabKey}`} tabIndex={0} className={className} data-testid={testId}>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Keyboard in `Tabs.tsx`.**
- Add `import type { KeyboardEvent } from "react";`.
- Inside the component, before `return`, add:

```tsx
  // Automatic activation (WAI-ARIA tabs pattern): arrows move selection and focus together.
  // Without this, tabIndex=-1 on unselected tabs made them unreachable from the keyboard.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.key === activeKey);
    const next =
      event.key === "ArrowRight" ? (index + 1) % items.length
      : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    onChange(items[next].key);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
```

- Add `onKeyDown={handleKeyDown}` to the `role="tablist"` div.

- [ ] **Step 4: Gallery.** In `app/dev/design/page.tsx`:
- Import `Tabs` and `TabPanel`.
- Add `const [galleryTab, setGalleryTab] = useState("one");`.
- Add this after the toggle section:

```tsx
      <section data-testid="gallery-tabs">
        <Tabs
          items={[{ key: "one", label: "One" }, { key: "two", label: "Two" }, { key: "three", label: "Three" }]}
          activeKey={galleryTab}
          onChange={setGalleryTab}
          ariaLabel="Gallery tabs"
        />
        <TabPanel tabKey={galleryTab} className="p-4">{`Panel ${galleryTab}`}</TabPanel>
      </section>
```

- [ ] **Step 5: Run.** `npx playwright test tests/e2e/tabs-keyboard.spec.ts` → PASS. Then `npm run typecheck && npm run lint`.

- [ ] **Step 6: Mutation matrix**

| Mutation | Must fail |
|---|---|
| Delete `onKeyDown={handleKeyDown}` | `arrow keys move selection …` (Two never focused) |
| `(index + 1) % items.length` → `Math.min(index + 1, items.length - 1)` | `… ends wrap` (ArrowRight on Three stays) |
| Remove the `.focus()` line | `arrow keys …` (selection moves, focus does not) |
| `TabPanel` `tabIndex={0}` → removed | `only the selected tab … into its panel` |

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ui/Tabs.tsx apps/web/components/ui/TabPanel.tsx apps/web/app/dev/design/page.tsx apps/web/tests/e2e/tabs-keyboard.spec.ts
git commit -m "feat(ui): keyboard-accessible Tabs and a labelled TabPanel"
```

---

### Task 2: Stock list model (pure)

**Files:** Create `app/portfolio/stockListModel.ts` and `tests/e2e/stock-list-model.spec.ts`.

**Interfaces (produces):**
- `StockListRow` (type alias, so it satisfies `DenseTable`'s `Record<string, unknown>`)
- `buildStockListRows(companies, watchlist, followedGroup, totalAmount)`
- `filterStockListRows(rows, query, status)`
- `amountToWeight(input, { totalAmount, otherWeights, allowZero })` → `AmountCheck`
- `holdingPayload(row, weight, unfollowedGroup)`
- `followRequest(row, followedGroup, unfollowedGroup)`

- [ ] **Step 1: Failing test** (`tests/e2e/stock-list-model.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import {
  amountToWeight,
  buildStockListRows,
  filterStockListRows,
  followRequest,
  holdingPayload,
} from "../../app/portfolio/stockListModel";
import type { PortfolioStock } from "../../app/portfolio/page";

const stock = (ticker: string, group_name: string, weight: number, name = `${ticker} Inc.`, sector = "Technology"): PortfolioStock => ({
  ticker, name, sector, group_name, weight, last_close: 100, delta: { delta_pct: 1 }, sparkline: [1, 2], id: 1,
});

const companies = [
  { ticker: "AAPL", name: "Apple Inc.", sector: "Technology" },
  { ticker: "TSLA", name: "Tesla", sector: "Automotive" },
];

test("rows merge the registry with the watchlist; the watchlist wins on name and state", () => {
  const rows = buildStockListRows(companies, [stock("AAPL", "custom", 0.25, "Apple (mine)")], "custom", 10_000);
  const aapl = rows.find((row) => row.ticker === "AAPL")!;
  const tsla = rows.find((row) => row.ticker === "TSLA")!;
  expect({ name: aapl.name, followed: aapl.followed, amount: aapl.amount, onWatchlist: aapl.stock !== null })
    .toEqual({ name: "Apple (mine)", followed: true, amount: 2500, onWatchlist: true });
  expect({ followed: tsla.followed, amount: tsla.amount, onWatchlist: tsla.stock !== null })
    .toEqual({ followed: false, amount: 0, onWatchlist: false });
});

test("a watchlist ticker missing from the registry still gets a row", () => {
  const rows = buildStockListRows(companies, [stock("ZZZ", "total", 0)], "custom", 10_000);
  expect(rows.map((row) => row.ticker)).toContain("ZZZ");
});

test("filter matches ticker, name or sector, prefix matches first, and narrows by status", () => {
  const rows = buildStockListRows(
    [...companies, { ticker: "AUTO", name: "Autodesk", sector: "Software" }],
    [stock("AAPL", "custom", 0.25), stock("TSLA", "total", 0.1, "Tesla", "Automotive")],
    "custom",
    10_000,
  );
  expect(filterStockListRows(rows, "auto", "all").map((row) => row.ticker)).toEqual(["AUTO", "TSLA"]);
  expect(filterStockListRows(rows, "", "held").map((row) => row.ticker)).toEqual(["AAPL", "TSLA"]);
  expect(filterStockListRows(rows, "", "followed").map((row) => row.ticker)).toEqual(["AAPL"]);
});

test("an amount converts to a weight of the total investment amount", () => {
  expect(amountToWeight("2,500", { totalAmount: 10_000, otherWeights: 0.5, allowZero: false })).toEqual({ ok: true, weight: 0.25 });
});

test("an amount above the unallocated money is refused with the unallocated figure", () => {
  expect(amountToWeight("5000.01", { totalAmount: 10_000, otherWeights: 0.5, allowZero: false }))
    .toEqual({ ok: false, reason: "exceeds", unallocated: 5000 });
  // Exactly the remainder is allowed and never rounds the sum above 1.
  const exact = amountToWeight("5000", { totalAmount: 10_000, otherWeights: 0.5, allowZero: false });
  expect(exact.ok && exact.weight + 0.5 <= 1).toBe(true);
});

test("zero, negative, text and a zero total are refused; zero is allowed only when editing", () => {
  const base = { totalAmount: 10_000, otherWeights: 0, allowZero: false };
  expect(amountToWeight("0", base)).toMatchObject({ ok: false, reason: "invalid" });
  expect(amountToWeight("-5", base)).toMatchObject({ ok: false, reason: "invalid" });
  expect(amountToWeight("abc", base)).toMatchObject({ ok: false, reason: "invalid" });
  expect(amountToWeight("100", { ...base, totalAmount: 0 })).toMatchObject({ ok: false, reason: "no_total" });
  expect(amountToWeight("0", { ...base, allowZero: true })).toEqual({ ok: true, weight: 0 });
});

test("holdingPayload keeps the row's name, sector and group; a new row is created unfollowed", () => {
  const [followed] = buildStockListRows([], [stock("AAPL", "custom", 0, "Apple (mine)", "Tech")], "custom", 10_000);
  expect(holdingPayload(followed, 0.2, "total"))
    .toEqual({ ticker: "AAPL", name: "Apple (mine)", sector: "Tech", group_name: "custom", weight: 0.2 });
  const tsla = buildStockListRows(companies, [], "custom", 10_000).find((row) => row.ticker === "TSLA")!;
  expect(holdingPayload(tsla, 0.1, "total"))
    .toEqual({ ticker: "TSLA", name: "Tesla", sector: "Automotive", group_name: "total", weight: 0.1 });
});

test("followRequest uses the group endpoint for a watchlist row and creates a weightless row otherwise", () => {
  const [held] = buildStockListRows([], [stock("AAPL", "total", 0.3)], "custom", 10_000);
  expect(followRequest(held, "custom", "total")).toEqual({ kind: "group", ticker: "AAPL", group_name: "custom" });
  const [followed] = buildStockListRows([], [stock("AAPL", "custom", 0.3)], "custom", 10_000);
  expect(followRequest(followed, "custom", "total")).toEqual({ kind: "group", ticker: "AAPL", group_name: "total" });
  const tsla = buildStockListRows(companies, [], "custom", 10_000).find((row) => row.ticker === "TSLA")!;
  expect(followRequest(tsla, "custom", "total")).toEqual({
    kind: "create",
    payload: { ticker: "TSLA", name: "Tesla", sector: "Automotive", group_name: "custom", weight: 0 },
  });
});
```

Run `npx playwright test tests/e2e/stock-list-model.spec.ts`. Expected: FAIL, because the module does not exist.

- [ ] **Step 2: `app/portfolio/stockListModel.ts`**

```ts
import type { PortfolioStock } from "./page";

/** One company the Stocks tab can act on. `stock` is the watchlist row, or null when it has none. */
export type StockListRow = {
  ticker: string;
  name: string;
  sector: string;
  stock: PortfolioStock | null;
  followed: boolean;
  weight: number;
  /** Invested amount: weight × total investment amount, the Allocation editor's "Invested Amount". */
  amount: number;
};

export type StockListStatusFilter = "all" | "held" | "followed";

export type WatchlistUpsert = { ticker: string; name: string; sector: string; group_name: string; weight: number };

export type AmountCheck =
  | { ok: true; weight: number }
  | { ok: false; reason: "invalid" | "no_total" | "exceeds"; unallocated: number };

export type FollowRequest =
  | { kind: "group"; ticker: string; group_name: string }
  | { kind: "create"; payload: WatchlistUpsert };

export function buildStockListRows(
  companies: { ticker: string; name: string; sector?: string }[],
  watchlist: PortfolioStock[],
  followedGroup: string,
  totalAmount: number,
): StockListRow[] {
  const byTicker = new Map<string, StockListRow>();
  for (const company of companies) {
    const ticker = company.ticker.toUpperCase();
    byTicker.set(ticker, { ticker, name: company.name || ticker, sector: company.sector ?? "", stock: null, followed: false, weight: 0, amount: 0 });
  }
  for (const stock of watchlist) {
    const ticker = stock.ticker.toUpperCase();
    byTicker.set(ticker, {
      ticker,
      name: stock.name || ticker,
      sector: stock.sector,
      stock,
      followed: stock.group_name === followedGroup,
      weight: stock.weight,
      amount: stock.weight * Math.max(totalAmount, 0),
    });
  }
  return [...byTicker.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function filterStockListRows(rows: StockListRow[], query: string, status: StockListStatusFilter): StockListRow[] {
  const byStatus = rows.filter((row) => (status === "held" ? row.weight > 0 : status === "followed" ? row.followed : true));
  const needle = query.trim().toUpperCase();
  if (!needle) return byStatus;
  const starts = byStatus.filter((row) => row.ticker.startsWith(needle) || row.name.toUpperCase().startsWith(needle));
  const contains = byStatus.filter((row) => !starts.includes(row) && (
    row.ticker.includes(needle) || row.name.toUpperCase().includes(needle) || row.sector.toUpperCase().includes(needle)
  ));
  return [...starts, ...contains];
}

/**
 * The amount typed into a row becomes a weight of the total investment amount. Refused above
 * the unallocated money: saved weights over 100% pause attribution on another tab.
 */
export function amountToWeight(
  input: string,
  { totalAmount, otherWeights, allowZero }: { totalAmount: number; otherWeights: number; allowZero: boolean },
): AmountCheck {
  const room = Math.max(0, 1 - otherWeights);
  const unallocated = Math.max(0, totalAmount) * room;
  if (!(totalAmount > 0)) return { ok: false, reason: "no_total", unallocated: 0 };
  const amount = Number(input.replace(/,/g, "").trim());
  if (input.trim() === "" || !Number.isFinite(amount) || amount < 0 || (amount === 0 && !allowZero)) {
    return { ok: false, reason: "invalid", unallocated };
  }
  if (amount > unallocated + 0.005) return { ok: false, reason: "exceeds", unallocated };
  return { ok: true, weight: Math.min(amount / totalAmount, room) };
}

/** Full-row upsert body that changes only the weight. POST /watchlist resets any field it is not sent. */
export function holdingPayload(row: StockListRow, weight: number, unfollowedGroup: string): WatchlistUpsert {
  return {
    ticker: row.ticker,
    name: row.stock?.name || row.name,
    sector: row.stock?.sector ?? row.sector,
    group_name: row.stock?.group_name ?? unfollowedGroup,
    weight,
  };
}

/** A watchlist row moves group through its own endpoint, never the upsert, so its weight survives. */
export function followRequest(row: StockListRow, followedGroup: string, unfollowedGroup: string): FollowRequest {
  if (row.stock) {
    return { kind: "group", ticker: row.ticker, group_name: row.followed ? unfollowedGroup : followedGroup };
  }
  return { kind: "create", payload: { ticker: row.ticker, name: row.name, sector: row.sector, group_name: followedGroup, weight: 0 } };
}
```

- [ ] **Step 3: Run** → PASS. `npm run typecheck`.

- [ ] **Step 4: Mutation matrix**

| Mutation | Must fail |
|---|---|
| In `buildStockListRows`, iterate the watchlist **before** the companies | `rows merge … watchlist wins` |
| `amount > unallocated + 0.005` → `amount > totalAmount` | `an amount above the unallocated money is refused …` |
| Drop `Math.min(…, room)` | `… exactly the remainder … never rounds the sum above 1` (0.5 + 0.5000000000000001) **only if** float error appears; otherwise listed as unverifiable here and covered by the `exceeds` test |
| `group_name: row.stock?.group_name ?? unfollowedGroup` → `group_name: unfollowedGroup` | `holdingPayload keeps the row's … group` |
| `followRequest` always returns `kind: "create"` | `followRequest uses the group endpoint …` |
| Remove `.replace(/,/g, "")` | `an amount converts …` (`"2,500"` → invalid) |
| `starts` / `contains` order swapped | `filter … prefix matches first` |

The third row is stated honestly: if the mutation does not change any result for these inputs, record "survives, equivalent for tested inputs" in Track U rather than claiming coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/portfolio/stockListModel.ts apps/web/tests/e2e/stock-list-model.spec.ts
git commit -m "feat(portfolio): stock list model: rows, filter, amount check and upsert-safe payloads"
```

---

### Task 3: Portfolio page on tabs (rail and slide-over removed)

**Files:**
- Create: `app/portfolio/components/PortfolioTabs.tsx`, `tests/e2e/tabs-portfolio.spec.ts`
- Modify: `app/portfolio/page.tsx`, `lib/i18n/messages/{en,ko}.ts`, `docs/design/MoneyView_Glossary.md`
- Delete: `app/portfolio/components/PortfolioShell.tsx`, `app/portfolio/components/SidePanel.tsx`
- Tests (approved list): `helpers/portfolioPanels.ts` rewritten. `portfolio-panel-presentation.spec.ts` deleted. `portfolio-tile-grid.spec.ts`, `high-risk-render-regression.spec.ts`, `portfolio-news-failure-honesty.spec.ts`, `watchlist-peer-sync.spec.ts`, `refresh-idle-state.spec.ts`, `portfolio-watchlist.spec.ts` and the two snapshot specs get the navigation edits listed above.

**Interfaces:**
- Produces: `PortfolioTabKey = "watchlist" | "stocks" | "allocation" | "snapshot" | "attribution"` and `PORTFOLIO_TAB_KEYS`. Stock detail is not a tab: it opens in the drawer (Task 5, U9).
- Produces: tab-state key `tabStateKey("portfolio", "activeTab")` and test id `portfolio-scroll-region`, now on the tab panel.
- Catalog keys: `portfolio.tabs.{watchlist,stocks,allocation,snapshot,attribution,detail,ariaLabel}` and `portfolio.refreshNews`.

In this task the Stocks tab body is the existing holdings panel body, unchanged; Task 4 replaces it. The stock detail modal still opens from the tiles until Task 5 moves it into the drawer.

- [ ] **Step 1: Failing test** (`tests/e2e/tabs-portfolio.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

const TABS = ["Watchlist", "Stocks", "Allocation", "Snapshot", "Attribution"];

async function gotoPortfolio(page: import("@playwright/test").Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
}

test("the portfolio sections are tabs, not overlays", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  const list = page.getByRole("tablist", { name: "Portfolio sections" });
  await expect(list.getByRole("tab")).toHaveText(TABS);
  await expect(page.getByTestId("portfolio-rail")).toHaveCount(0);
  for (const name of TABS.slice(1)) {
    await list.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tabpanel", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("an unknown stored tab falls back to Watchlist", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await page.addInitScript(() => {
    for (const key of ["moneyview.tabState.portfolio.activeTab"]) window.sessionStorage.setItem(key, JSON.stringify("holdings"));
  });
  await gotoPortfolio(page);
  await expect(page.getByRole("tab", { name: "Watchlist", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible();
});

test("the chosen tab survives leaving the page and coming back", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  await page.getByRole("tab", { name: "Allocation", exact: true }).click();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await gotoPortfolio(page);
  await expect(page.getByRole("tab", { name: "Allocation", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("Refresh news sits in the Watchlist tab and reports its progress", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  const refresh = page.getByRole("tabpanel", { name: "Watchlist" }).getByRole("button", { name: "Refresh news" });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(page.getByText(/refreshed|current|failed/i).first()).toBeVisible();
});

test("an empty watchlist says so in every tab instead of opening blank", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { watchlist: [] });
  await gotoPortfolio(page);
  for (const name of ["Allocation", "Snapshot", "Attribution"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tabpanel", { name, exact: true })).not.toBeEmpty();
    await expect(page.getByRole("tabpanel", { name, exact: true }).getByText(/.{12,}/).first()).toBeVisible();
  }
});
```

Before Step 1 runs, confirm the session key format by reading `NAMESPACE` in `lib/tabState.ts` (`tabStateKey` returns `${NAMESPACE}.portfolio.activeTab`). Write the literal key into the test; the line above assumes `NAMESPACE = "moneyview.tabState"`.

Run → FAIL (no tablist).

- [ ] **Step 2: `app/portfolio/components/PortfolioTabs.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { TabPanel } from "@/components/ui/TabPanel";

export type PortfolioTabKey = "watchlist" | "stocks" | "allocation" | "snapshot" | "attribution";
export const PORTFOLIO_TAB_KEYS: readonly PortfolioTabKey[] = ["watchlist", "stocks", "allocation", "snapshot", "attribution"];

export function isPortfolioTabKey(value: unknown): value is PortfolioTabKey {
  return typeof value === "string" && (PORTFOLIO_TAB_KEYS as readonly string[]).includes(value);
}

interface PortfolioTabsProps {
  header: ReactNode;
  feedback: ReactNode;
  labels: Record<PortfolioTabKey, string>;
  ariaLabel: string;
  active: PortfolioTabKey;
  onChange: (key: PortfolioTabKey) => void;
  children: ReactNode;
}

/**
 * Header, tabs and one scrolling panel. The panel keeps the `portfolio-scroll-region` id the
 * grid's sticky count line and its single-scroll-region test depend on. The height is the
 * viewport minus AppShell's published padding (ERROR-LOG.md 2026-08-02), as PortfolioShell had it.
 */
export function PortfolioTabs({ header, feedback, labels, ariaLabel, active, onChange, children }: PortfolioTabsProps) {
  return (
    <div className="flex h-[calc(100vh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))] flex-col">
      <div className="px-4 pt-4">{header}</div>
      <Tabs
        className="mt-4 px-4"
        items={PORTFOLIO_TAB_KEYS.map((key) => ({ key, label: labels[key] }))}
        activeKey={active}
        onChange={(key) => onChange(key as PortfolioTabKey)}
        ariaLabel={ariaLabel}
      />
      {feedback}
      <TabPanel tabKey={active} testId="portfolio-scroll-region" className="flex-1 overflow-y-auto px-4 py-4">
        {children}
      </TabPanel>
    </div>
  );
}
```

- [ ] **Step 3: Catalog.** Add to `en.portfolio`: `tabs: { watchlist: "Watchlist", stocks: "Stocks", allocation: "Allocation", snapshot: "Snapshot", attribution: "Attribution", ariaLabel: "Portfolio sections" }, refreshNews: "Refresh news"`. Add to `ko.portfolio`: `tabs: { watchlist: "관심 종목", stocks: "전체 종목", allocation: "비중 배분", snapshot: "스냅샷", attribution: "성과 기여도", ariaLabel: "포트폴리오 구역" }, refreshNews: "뉴스 새로고침"`. Add the glossary rows first. If the glossary already fixes a different Korean term for any of these, the glossary wins.

- [ ] **Step 4: `page.tsx`.**
1. Replace the `PortfolioShell` import with `import { isPortfolioTabKey, PortfolioTabs, type PortfolioTabKey } from "./components/PortfolioTabs";`.
2. Delete the `openPanel` state, `allocationFocusRequest` state, `requestAllocationFocus` and the `useEffect` that consumes `allocationFocusRequest`. Keep `allocationSectionRef` and `weightInputRefs` only if the allocation editor still reads them; it does for double-click editing (`handleAllocationValueDoubleClick`).
3. Add:
   ```tsx
   const [storedTab, setActiveTab] = useTabState<PortfolioTabKey>(tabStateKey("portfolio", "activeTab"), "watchlist");
   const activeTab: PortfolioTabKey = isPortfolioTabKey(storedTab) ? storedTab : "watchlist";
   ```
4. Build the watchlist body from the JSX currently passed as `PortfolioShell` children below the header: the news error line plus `<StockTileGrid …/>`. Pass `statusSlot` as:
   ```tsx
   <div className="flex items-center gap-2">
     <WatchlistPeerSyncStatus status={peerSyncQuery.data} />
     <ActionButton label={t("portfolio.refreshNews")} size="sm" loading={refreshNews.isPending} onClick={() => { if (!refreshNews.isPending) refreshNews.mutate(); }} />
   </div>
   ```
   Then render `{refreshSummary ? <p …>{refreshSummary}</p> : null}` where the rail action's summary rendered before. Keep its existing element and test id.
5. Replace the `<PortfolioShell …>…</PortfolioShell>` element with:
   ```tsx
   <PortfolioTabs
     header={/* the existing <header> element, unchanged */}
     feedback={/* the existing mutation-message and comparison-message <p> elements, unchanged except role="status" aria-live="polite" on the mutation one */}
     labels={{
       watchlist: t("portfolio.tabs.watchlist"), stocks: t("portfolio.tabs.stocks"), allocation: t("portfolio.tabs.allocation"),
       snapshot: t("portfolio.tabs.snapshot"), attribution: t("portfolio.tabs.attribution"),
     }}
     ariaLabel={t("portfolio.tabs.ariaLabel")}
     active={activeTab}
     onChange={setActiveTab}
   >
     {{
       watchlist: watchlistPanelBody,
       stocks: holdingsPanelBody,
       allocation: allocationPanelBody,
       snapshot: snapshotPanelBody,
       attribution: attributionPanelBody,
     }[activeTab]}
   </PortfolioTabs>
   ```
6. The empty-watchlist copy in the allocation and attribution bodies already exists. The snapshot body's `panel-empty-state` paragraph stays. Delete the comments that refer to "panel", "rail" or "SidePanel" and rewrite them as "tab".
7. Delete the files `PortfolioShell.tsx` and `SidePanel.tsx`.

- [ ] **Step 5: Rewrite `tests/e2e/helpers/portfolioPanels.ts`** (approved list):

```ts
import { expect, type Locator, type Page } from "@playwright/test";

/** The portfolio page's sections are tabs. Id on the left, tab label on the right. */
const TABS = {
  watchlist: "Watchlist",
  stocks: "Stocks",
  allocation: "Allocation",
  snapshot: "Snapshot",
  attribution: "Attribution",
} as const;

export type PortfolioPanelId = keyof typeof TABS;

export function portfolioPanel(page: Page, id: PortfolioPanelId): Locator {
  return page.getByRole("tabpanel", { name: TABS[id], exact: true });
}

/**
 * The stock detail drawer (and, until Task 6, the snapshot history modal). Kept verbatim: with
 * the side panel gone, the drawer is the only dialog on the page, so the old selector still holds.
 */
export function portfolioModal(page: Page): Locator {
  return page.locator('[role="dialog"]:not([data-testid="portfolio-side-panel"])');
}

/** Selects `id` and returns its panel. A no-op when it is already selected. */
export async function openPortfolioPanel(page: Page, id: PortfolioPanelId) {
  await page.getByRole("tab", { name: TABS[id], exact: true }).click();
  const panel = portfolioPanel(page, id);
  await expect(panel).toBeVisible();
  return panel;
}
```

Apply the navigation edits from the approval table: `"holdings"` → `"stocks"` and the rail locators → tab or button. Delete `portfolio-panel-presentation.spec.ts`. Move the design-system Task 10 Korean assertion from it into `tabs-portfolio.spec.ts` as a `test.describe` with `test.use({ locale: "ko-KR" })`, with the same expectations and the tab label in Korean.

- [ ] **Step 6: Run.** `npm run typecheck && npm run lint && npx playwright test tests/e2e/tabs-portfolio.spec.ts tests/e2e/portfolio-*.spec.ts tests/e2e/watchlist-peer-sync.spec.ts tests/e2e/snapshot-history-*.spec.ts tests/e2e/refresh-idle-state.spec.ts tests/e2e/high-risk-render-regression.spec.ts` → PASS.

- [ ] **Step 7: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `isPortfolioTabKey(storedTab) ? storedTab : "watchlist"` → `storedTab` | `an unknown stored tab falls back to Watchlist` |
| `useTabState(…)` → `useState("watchlist")` | `the chosen tab survives leaving the page …` |
| Render the old `<SidePanel>` for `activeTab` instead of `TabPanel` | `the portfolio sections are tabs, not overlays` (dialog count 1) |
| Delete the Refresh news `ActionButton` | `Refresh news sits in the Watchlist tab …` |
| Snapshot body: delete the `!hasHoldings` paragraph | `an empty watchlist says so in every tab …` |

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/app/portfolio apps/web/lib/i18n apps/web/tests/e2e docs/design/MoneyView_Glossary.md
git commit -m "refactor(portfolio): sections are tabs; rail and slide-over removed"
```

---

### Task 4: The Stocks tab (per-row add, follow, remove; old add paths removed)

**Files:**
- Create: `app/portfolio/components/StockListTable.tsx`, `app/portfolio/components/WatchlistFileControls.tsx`, `tests/e2e/portfolio-stock-list.spec.ts`
- Modify: `app/portfolio/page.tsx`, `components/ui/ActionButton.tsx`, `app/portfolio/components/{StockTile,StockTileGrid}.tsx`, `lib/i18n/{messages/en,messages/ko,labels}.ts`, `docs/design/MoneyView_Glossary.md`
- Delete: `app/portfolio/components/PortfolioCommandCenter.tsx`
- Tests (approved list): `portfolio-watchlist.spec.ts`, `portfolio-tile-grid.spec.ts` (follow and Add tests deleted), `refresh-idle-state.spec.ts`, `high-risk-render-regression.spec.ts`

**Interfaces:**
- Produces: `StockListTable` props (below). Test ids `stock-row-<TICKER>` (on the ticker button's cell content wrapper), `stock-list-search`, `unlisted-form`.
- Produces: `ActionButton` `ariaLabel?: string`, `ariaPressed?: boolean`.
- Consumes: the model (Task 2); `persistence`: `POST /portfolio/watchlist`, `POST /portfolio/watchlist/{t}/group`, `DELETE /portfolio/watchlist/{t}`.

- [ ] **Step 1: Failing tests** (`tests/e2e/portfolio-stock-list.spec.ts`)

```ts
import { expect, test, type Page, type Request } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { openPortfolioPanel } from "./helpers/portfolioPanels";
import { portfolioPartialWeightsFixture, type PortfolioStockFixture } from "./fixtures/shared";

// Fixture weights are 0.2 × 5 = 100%. Halve them so there is $5,000 unallocated of $10,000.
const HALF: PortfolioStockFixture[] = portfolioPartialWeightsFixture.map((row) => ({ ...row, weight: 0.1 }));

async function gotoStocks(page: Page, watchlist = HALF) {
  await mockPortfolioPageApi(page, undefined, { watchlist });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  return openPortfolioPanel(page, "stocks");
}

const row = (page: Page, ticker: string) => page.getByRole("row").filter({ has: page.getByRole("button", { name: `Open ${ticker} detail` }) });

function watchlistPosts(page: Page) {
  const posts: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/portfolio\/watchlist(\/[^/]+\/group)?$/.test(new URL(request.url()).pathname)) posts.push(request);
  });
  return posts;
}

test("every company is a row that shows whether it is held and followed", async ({ page }) => {
  await gotoStocks(page);
  await expect(row(page, "AAPL")).toContainText("Held");
  await expect(row(page, "AAPL")).toContainText("$1,000.00");
  await expect(row(page, "TSLA")).not.toContainText("Held");
  await expect(row(page, "TSLA").getByRole("button", { name: "Follow TSLA" })).toHaveAttribute("aria-pressed", "false");
});

test("adding a holding from a row records its amount and shows it", async ({ page }) => {
  await gotoStocks(page);
  await row(page, "TSLA").getByRole("button", { name: "Add TSLA holding" }).click();
  const input = row(page, "TSLA").getByRole("textbox", { name: "Amount for TSLA" });
  await expect(input).toBeFocused();
  await input.fill("2,000");
  await input.press("Enter");
  await expect(row(page, "TSLA")).toContainText("$2,000.00");
  await expect(page.getByTestId("portfolio-mutation-message")).toContainText("TSLA");
  await expect(row(page, "TSLA").getByRole("button", { name: "Edit TSLA amount" })).toBeFocused();
});

test("an amount above the unallocated money is refused and nothing is sent", async ({ page }) => {
  await gotoStocks(page);
  const posts = watchlistPosts(page);
  await row(page, "TSLA").getByRole("button", { name: "Add TSLA holding" }).click();
  const input = row(page, "TSLA").getByRole("textbox", { name: "Amount for TSLA" });
  await input.fill("5000.01");
  await input.press("Enter");
  const alert = row(page, "TSLA").getByRole("alert");
  await expect(alert).toContainText("$5,000.00");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-describedby", (await alert.getAttribute("id"))!);
  expect(posts).toHaveLength(0);
});

test("Escape closes the editor and returns focus to the row's button", async ({ page }) => {
  await gotoStocks(page);
  await row(page, "TSLA").getByRole("button", { name: "Add TSLA holding" }).click();
  await page.keyboard.press("Escape");
  await expect(row(page, "TSLA").getByRole("textbox")).toHaveCount(0);
  await expect(row(page, "TSLA").getByRole("button", { name: "Add TSLA holding" })).toBeFocused();
});

test("adding a holding to a followed stock keeps it followed and named", async ({ page }) => {
  const followed = HALF.map((r) => (r.ticker === "MSFT" ? { ...r, group_name: "custom", name: "Microsoft (mine)" } : r));
  await gotoStocks(page, followed);
  const posts = watchlistPosts(page);
  await row(page, "MSFT").getByRole("button", { name: "Edit MSFT amount" }).click();
  await row(page, "MSFT").getByRole("textbox", { name: "Amount for MSFT" }).fill("1500");
  await row(page, "MSFT").getByRole("textbox", { name: "Amount for MSFT" }).press("Enter");
  await expect(row(page, "MSFT")).toContainText("$1,500.00");
  expect(posts.at(-1)!.postDataJSON()).toEqual({ ticker: "MSFT", name: "Microsoft (mine)", sector: "Technology", group_name: "custom", weight: 0.15 });
  await expect(row(page, "MSFT").getByRole("button", { name: "Follow MSFT" })).toHaveAttribute("aria-pressed", "true");
});

test("following a held stock keeps its amount and never uses the upsert", async ({ page }) => {
  await gotoStocks(page);
  const posts = watchlistPosts(page);
  await row(page, "AAPL").getByRole("button", { name: "Follow AAPL" }).click();
  await expect(row(page, "AAPL").getByRole("button", { name: "Follow AAPL" })).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, "AAPL")).toContainText("$1,000.00");
  expect(posts.map((p) => new URL(p.url()).pathname)).toEqual([expect.stringMatching(/\/watchlist\/AAPL\/group$/)]);
});

test("following a stock not on the watchlist creates it followed with no amount", async ({ page }) => {
  await gotoStocks(page);
  const posts = watchlistPosts(page);
  await row(page, "TSLA").getByRole("button", { name: "Follow TSLA" }).click();
  await expect(row(page, "TSLA").getByRole("button", { name: "Follow TSLA" })).toHaveAttribute("aria-pressed", "true");
  expect(posts[0].postDataJSON()).toMatchObject({ ticker: "TSLA", group_name: "custom", weight: 0 });
  await openPortfolioPanel(page, "watchlist");
  await expect(page.getByTestId("stock-tile-TSLA")).toBeVisible();
});

test("a pending allocation draft does not overwrite a holding saved from the table", async ({ page }) => {
  await page.clock.install();
  await gotoStocks(page);
  // Start a draft in Allocation (debounced 450 ms), then save a different amount from Stocks.
  await openPortfolioPanel(page, "allocation");
  const aapl = page.locator("tr").filter({ has: page.getByRole("cell", { name: "AAPL", exact: true }) }).first();
  await aapl.locator("td").nth(2).getByRole("button").dblclick();
  await aapl.locator("td").nth(2).locator('input[type="number"]').fill("35");
  await openPortfolioPanel(page, "stocks");
  await row(page, "AAPL").getByRole("button", { name: "Edit AAPL amount" }).click();
  await row(page, "AAPL").getByRole("textbox", { name: "Amount for AAPL" }).fill("500");
  await row(page, "AAPL").getByRole("textbox", { name: "Amount for AAPL" }).press("Enter");
  await expect(row(page, "AAPL")).toContainText("$500.00");
  await page.clock.runFor(2_000);
  await expect(row(page, "AAPL")).toContainText("$500.00");
  await expect(row(page, "AAPL")).not.toContainText("$3,500.00");
});

test("a ticker not in the list is added unfollowed with no amount, then acted on from its row", async ({ page }) => {
  await gotoStocks(page);
  const form = page.getByTestId("unlisted-form");
  await form.getByLabel("Ticker").fill("ZZZZ");
  await form.getByLabel("Name").fill("Zed Corp");
  await form.getByLabel("Sector").fill("Industrials");
  await form.getByRole("button", { name: "Add to list" }).click();
  await expect(row(page, "ZZZZ")).toBeVisible();
  await expect(row(page, "ZZZZ").getByRole("button", { name: "Follow ZZZZ" })).toHaveAttribute("aria-pressed", "false");
  await expect(row(page, "ZZZZ")).not.toContainText("Held");
});

test("remove takes a stock off the watchlist; a registry company stays listed", async ({ page }) => {
  await gotoStocks(page);
  await row(page, "AAPL").getByRole("button", { name: "Remove AAPL" }).click();
  await expect(row(page, "AAPL")).not.toContainText("Held");
  await expect(row(page, "AAPL").getByRole("button", { name: "Remove AAPL" })).toHaveCount(0);
});

test("the status filter narrows to held or followed rows", async ({ page }) => {
  await gotoStocks(page);
  await page.getByRole("group", { name: "Status filter" }).getByRole("button", { name: "Held" }).click();
  await expect(row(page, "TSLA")).toHaveCount(0);
  await expect(row(page, "AAPL")).toBeVisible();
});
```

Check the fixture first. `HALF` assumes `portfolioPartialWeightsFixture` holds AAPL, MSFT, NVDA, GOOGL and AMZN with the sector "Technology" for MSFT (`fixtures/shared.ts:472`). If MSFT's sector differs, use the fixture's value in the expected payload. TSLA is in the mock's `companyRegistry` and not on the watchlist. Run → FAIL.

- [ ] **Step 2: `ActionButton`.** Add `ariaLabel?: string; ariaPressed?: boolean;` to the props and destructuring, and `aria-label={ariaLabel}` and `aria-pressed={ariaPressed}` on the `<button>`.

- [ ] **Step 3: Labels and catalog.**

`LABELS` additions (glossary rows first):
- `sector: ["섹터", "Sector"]`
- `status: ["상태", "Status"]`
- `investedAmount: ["투자 금액", "Invested amount"]`
- `actions: ["작업", "Actions"]`

For the four metric columns, reuse the `LabelKey`s that design-system Task 10 gave `HoldingsTable`'s headers. Find them with `git grep -n "ROIC - WACC\|one-off gap\|pts per year\|Volatility" apps/web/lib/i18n/labels.ts` and use those keys. If a key is missing, add `roicMinusWacc`, `dcfGap`, `impliedVsWacc` and `volatility` with the Korean from the glossary.

`en.portfolio.stocks`:
```ts
stocks: {
  search: "Search ticker, name or sector", statusFilter: "Status filter",
  filterAll: "All", filterHeld: "Held", filterFollowed: "Followed",
  held: "Held", followed: "Followed",
  follow: "Follow", followFor: "Follow {ticker}",
  addHolding: "Add holding", addHoldingFor: "Add {ticker} holding",
  editAmount: "Edit amount", editAmountFor: "Edit {ticker} amount",
  amountFor: "Amount for {ticker}", save: "Save", cancel: "Cancel",
  remove: "Remove", removeFor: "Remove {ticker}", openDetailFor: "Open {ticker} detail",
  invalid: "Enter an amount in dollars, greater than 0.",
  invalidEdit: "Enter an amount in dollars, 0 or more. 0 stops holding it.",
  noTotal: "Set Total investment amount in the Allocation tab first.",
  exceeds: "Only {unallocated} is unallocated. Raise Total investment amount in the Allocation tab to record more.",
  savedHolding: "Saved {ticker} at {amount}.", followedMsg: "Following {ticker}.", unfollowedMsg: "Stopped following {ticker}.",
  removedMsg: "Removed {ticker} from the watchlist.",
  unlistedTitle: "Not in the list?", unlistedHint: "Add a ticker the list does not have. It is added unfollowed with no amount; use its row to follow or hold it.",
  ticker: "Ticker", name: "Name", sector: "Sector", addToList: "Add to list", addedToList: "Added {ticker} to the list.",
  tickerRequired: "Ticker is required.", empty: "No stock matches. Check the spelling, or add it below.",
},
```
`ko.portfolio.stocks`: the same keys in 합니다체, following the glossary. Read every line containing `{amount}` or `{unallocated}` by eye, per design-system M6.

- [ ] **Step 4: `app/portfolio/components/StockListTable.tsx`**

```tsx
"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { DenseTable, type ColumnDef } from "@/components/ui/DenseTable";
import { fieldInputClass } from "@/components/ui/InlineField";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { EMPTY_COMPARISON_METRICS } from "../page";
import {
  metricDisplayTitle,
  metricSubtitle,
  metricToneClass,
  volatilityToneClass,
  type PortfolioMetricValue,
  type PortfolioTickerMetrics,
} from "../portfolioMetrics";
import {
  amountToWeight,
  filterStockListRows,
  type StockListRow,
  type StockListStatusFilter,
} from "../stockListModel";

interface StockListTableProps {
  rows: StockListRow[];
  totalAmount: number;
  totalStoredWeight: number;
  comparisonMetricsByTicker: Record<string, PortfolioTickerMetrics>;
  /** Ticker whose request is in flight; its row's actions are disabled. */
  pendingTicker: string | null;
  onToggleFollow: (row: StockListRow) => void;
  /** Rejects with the server's message; the editor stays open and shows it. */
  onSaveHolding: (row: StockListRow, weight: number) => Promise<void>;
  onRemove: (row: StockListRow) => void;
  onOpenDetail: (row: StockListRow) => void;
  onAddUnlisted: (input: { ticker: string; name: string; sector: string }) => Promise<void>;
  footer: ReactNode;
}

type Editing = { ticker: string; value: string; error: string | null };

function MetricCell({ metric, tone }: { metric: PortfolioMetricValue; tone: string }) {
  const subtitle = metricSubtitle(metric);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className={tone} title={metricDisplayTitle(metric)}>{metric.displayValue}</div>
      <MetricQualityBadge quality={metric.quality} />
      {subtitle ? <div className="type-caption max-w-[12rem] text-right text-[var(--ink-muted)]">{subtitle}</div> : null}
    </div>
  );
}

export function StockListTable({
  rows, totalAmount, totalStoredWeight, comparisonMetricsByTicker, pendingTicker,
  onToggleFollow, onSaveHolding, onRemove, onOpenDetail, onAddUnlisted, footer,
}: StockListTableProps) {
  const t = useT();
  const { locale } = useLocale();
  const money = (value: number) => `$${formatNumber(value, "price", { locale })}`;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StockListStatusFilter>("all");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [unlisted, setUnlisted] = useState({ ticker: "", name: "", sector: "", error: null as string | null });
  const holdButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const visible = filterStockListRows(rows, query, status);

  const closeEditor = (ticker: string) => {
    setEditing(null);
    // After the re-render that removes the input, the hold button is back in the cell.
    requestAnimationFrame(() => holdButtons.current[ticker]?.focus());
  };

  const submit = async (event: FormEvent<HTMLFormElement>, row: StockListRow) => {
    event.preventDefault();
    if (!editing) return;
    const check = amountToWeight(editing.value, {
      totalAmount,
      otherWeights: totalStoredWeight - row.weight,
      allowZero: row.weight > 0,
    });
    if (!check.ok) {
      const error = check.reason === "no_total" ? t("portfolio.stocks.noTotal")
        : check.reason === "exceeds" ? t("portfolio.stocks.exceeds", { unallocated: money(check.unallocated) })
        : t(row.weight > 0 ? "portfolio.stocks.invalidEdit" : "portfolio.stocks.invalid");
      setEditing({ ...editing, error });
      return;
    }
    try {
      await onSaveHolding(row, check.weight);
      closeEditor(row.ticker);
    } catch (error) {
      setEditing({ ...editing, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const editor = (row: StockListRow) => {
    const errorId = `amount-error-${row.ticker}`;
    return (
      <form className="flex items-start gap-2" onSubmit={(event) => void submit(event, row)}>
        <div className="flex flex-col gap-1">
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            aria-label={t("portfolio.stocks.amountFor", { ticker: row.ticker })}
            aria-invalid={editing?.error ? true : undefined}
            aria-describedby={editing?.error ? errorId : undefined}
            value={editing?.value ?? ""}
            onChange={(event) => setEditing({ ticker: row.ticker, value: event.target.value, error: null })}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Escape") { event.preventDefault(); closeEditor(row.ticker); }
            }}
            className={`${fieldInputClass} w-32`}
          />
          {editing?.error ? <p id={errorId} role="alert" className="type-small max-w-[16rem] text-[var(--status-error-ink)]">{editing.error}</p> : null}
        </div>
        <ActionButton type="submit" label={t("portfolio.stocks.save")} variant="primary" size="sm" loading={pendingTicker === row.ticker} onClick={() => {}} />
        <ActionButton label={t("portfolio.stocks.cancel")} size="sm" onClick={() => closeEditor(row.ticker)} />
      </form>
    );
  };

  const metric = (key: keyof Pick<PortfolioTickerMetrics, "roicMinusWacc" | "dcfUpside" | "impliedVsWacc" | "volatility">) =>
    (_: unknown, row: StockListRow) => {
      const metrics = row.stock ? comparisonMetricsByTicker[row.ticker] ?? EMPTY_COMPARISON_METRICS : EMPTY_COMPARISON_METRICS;
      return <MetricCell metric={metrics[key]} tone={key === "volatility" ? volatilityToneClass(metrics[key]) : metricToneClass(metrics[key])} />;
    };

  const columns: ColumnDef<StockListRow>[] = [
    {
      key: "ticker", label: "name",
      render: (_, row) => (
        <button type="button" onClick={() => onOpenDetail(row)} aria-label={t("portfolio.stocks.openDetailFor", { ticker: row.ticker })} className="text-left">
          <span className="type-mono block text-[var(--ink)]">{row.ticker}</span>
          <span className="type-small block text-[var(--ink-muted)]">{row.name}</span>
        </button>
      ),
    },
    { key: "sector", label: "sector" },
    {
      key: "status", label: "status",
      render: (_, row) => (
        <div className="flex flex-wrap gap-1">
          {row.weight > 0 ? (
            <span className="type-caption rounded-[var(--radius-2)] bg-[var(--brand-soft)] px-2 py-0.5 text-[var(--brand-text)]">{t("portfolio.stocks.held")}</span>
          ) : null}
          {row.followed ? (
            <span className="type-caption rounded-[var(--radius-2)] border border-[var(--line)] px-2 py-0.5 text-[var(--ink)]">{t("portfolio.stocks.followed")}</span>
          ) : null}
        </div>
      ),
    },
    { key: "amount", label: "investedAmount", align: "right", render: (_, row) => (row.weight > 0 ? money(row.amount) : "—") },
    { key: "roicMinusWacc", label: "roicMinusWacc", align: "right", render: metric("roicMinusWacc") },
    { key: "dcfUpside", label: "dcfGap", align: "right", render: metric("dcfUpside") },
    { key: "impliedVsWacc", label: "impliedVsWacc", align: "right", render: metric("impliedVsWacc") },
    { key: "volatility", label: "volatility", align: "right", render: metric("volatility") },
    {
      key: "actions", label: "actions",
      render: (_, row) => {
        if (editing?.ticker === row.ticker) return editor(row);
        const busy = pendingTicker === row.ticker;
        const held = row.weight > 0;
        return (
          <div className="flex gap-2">
            <ActionButton
              size="sm"
              label={t("portfolio.stocks.follow")}
              ariaLabel={t("portfolio.stocks.followFor", { ticker: row.ticker })}
              ariaPressed={row.followed}
              variant={row.followed ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => onToggleFollow(row)}
            />
            <span ref={(element) => { holdButtons.current[row.ticker] = element?.querySelector("button") ?? null; }}>
              <ActionButton
                size="sm"
                label={t(held ? "portfolio.stocks.editAmount" : "portfolio.stocks.addHolding")}
                ariaLabel={t(held ? "portfolio.stocks.editAmountFor" : "portfolio.stocks.addHoldingFor", { ticker: row.ticker })}
                disabled={busy}
                onClick={() => setEditing({ ticker: row.ticker, value: held ? String(Math.round(row.amount * 100) / 100) : "", error: null })}
              />
            </span>
            {row.stock ? (
              <ActionButton
                size="sm"
                variant="danger"
                label={t("portfolio.stocks.remove")}
                ariaLabel={t("portfolio.stocks.removeFor", { ticker: row.ticker })}
                disabled={busy}
                onClick={() => onRemove(row)}
              />
            ) : null}
          </div>
        );
      },
    },
  ];

  const submitUnlisted = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = unlisted.ticker.trim().toUpperCase();
    if (!ticker) { setUnlisted({ ...unlisted, error: t("portfolio.stocks.tickerRequired") }); return; }
    try {
      await onAddUnlisted({ ticker, name: unlisted.name.trim() || ticker, sector: unlisted.sector.trim() });
      setUnlisted({ ticker: "", name: "", sector: "", error: null });
      setQuery(ticker);
      setStatus("all");
    } catch (error) {
      setUnlisted({ ...unlisted, error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          data-testid="stock-list-search"
          aria-label={t("portfolio.stocks.search")}
          placeholder={t("portfolio.stocks.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={`${fieldInputClass} sm:max-w-sm`}
        />
        <ToggleGroup
          ariaLabel={t("portfolio.stocks.statusFilter")}
          size="sm"
          value={status}
          onChange={(value) => setStatus(value as StockListStatusFilter)}
          options={[
            { value: "all", label: t("portfolio.stocks.filterAll") },
            { value: "held", label: t("portfolio.stocks.filterHeld") },
            { value: "followed", label: t("portfolio.stocks.filterFollowed") },
          ]}
        />
      </div>
      <DenseTable columns={columns} data={visible} emptyMessage={t("portfolio.stocks.empty")} stickyHeader />
      <form data-testid="unlisted-form" onSubmit={(event) => void submitUnlisted(event)} className="flex flex-col gap-2 border-t border-[var(--line)] pt-4">
        <h3 className="type-panel-title text-[var(--ink)]">{t("portfolio.stocks.unlistedTitle")}</h3>
        <p className="type-small text-[var(--ink-muted)]">{t("portfolio.stocks.unlistedHint")}</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {(["ticker", "name", "sector"] as const).map((field) => (
            <label key={field} className="type-label flex flex-col gap-1 text-[var(--ink)]">
              {t(`portfolio.stocks.${field}`)}
              <input type="text" value={unlisted[field]} onChange={(event) => setUnlisted({ ...unlisted, [field]: event.target.value, error: null })} className={fieldInputClass} />
            </label>
          ))}
          <div className="flex items-end">
            <ActionButton type="submit" label={t("portfolio.stocks.addToList")} onClick={() => {}} />
          </div>
        </div>
        {unlisted.error ? <p role="alert" className="type-small text-[var(--status-error-ink)]">{unlisted.error}</p> : null}
      </form>
      {footer}
    </div>
  );
}
```

Notes for the implementer:
- `DenseTable` keys rows by index. Editor state is keyed by ticker, so filtering while a row is open can only close or move the editor, never move it to another stock. If `editing.ticker` is not in `visible`, the editor simply is not shown.
- `t(\`portfolio.stocks.${field}\`)` must type-check against `MessageKey`. If the template-literal key does not narrow, map the three fields to literal keys instead.
- The `$` prefix and `formatNumber(…, "price")` must print the same text as the Allocation editor's amount. If design-system Task 10 left a different helper for that (`formatCurrencyCompact` successor), use it in both places.

- [ ] **Step 5: `WatchlistFileControls.tsx`.** Move lines 245–290 of `PortfolioCommandCenter.tsx` (the export/import block and the sync-status box) into a component. Its props are the ones that block used: `onExportWatchlist`, `exportingWatchlist`, `onImportJson`, `importingJson`, `importJsonArmed`, `setImportJsonArmed`, `importUnavailableReason`, `syncStatus`, `formatSyncTimestamp`. The JSX and copy are unchanged (after design-system Task 10 it is already on tokens and catalog keys). Then delete `PortfolioCommandCenter.tsx`.

- [ ] **Step 6: `page.tsx` wiring.**
1. `export` the `EMPTY_COMPARISON_METRICS` constant.
2. Add `const stockRows = useMemo(() => buildStockListRows(companiesQuery.data ?? [], watchlist, FOLLOWED_GROUP, totalInvestmentAmount), [companiesQuery.data, watchlist, totalInvestmentAmount]);`.
3. Mutations. Replace `addWatchlistMutation`, `toggleFollow`, `handleAddHolding` and `handleAddCandidate` with:

```tsx
  const [pendingTicker, setPendingTicker] = useState<string | null>(null);

  const runRowAction = useCallback(async (ticker: string, action: () => Promise<unknown>, message: string) => {
    setPendingTicker(ticker);
    setMutationMessage(null);
    try {
      await action();
      await refreshPortfolioQueries();
      setMutationMessage(message);
    } finally {
      setPendingTicker(null);
    }
  }, [refreshPortfolioQueries]);

  const handleSaveHolding = (row: StockListRow, weight: number) => {
    // A pending Allocation draft for this ticker would auto-save 450 ms later and overwrite
    // the amount just saved here: the draft effect runs whether or not its tab is shown.
    setWeightDrafts((current) => {
      if (!(row.ticker in current)) return current;
      const next = { ...current };
      delete next[row.ticker];
      return next;
    });
    const payload = holdingPayload(row, weight, UNFOLLOWED_GROUP);
    return runRowAction(row.ticker, () => fetchApi("/portfolio/watchlist", { method: "POST", body: JSON.stringify(payload) }),
      t("portfolio.stocks.savedHolding", { ticker: row.ticker, amount: `$${formatNumber(weight * totalInvestmentAmount, "price", { locale })}` }));
  };

  const handleToggleFollow = (row: StockListRow) => {
    const request = followRequest(row, FOLLOWED_GROUP, UNFOLLOWED_GROUP);
    const message = t(row.followed ? "portfolio.stocks.unfollowedMsg" : "portfolio.stocks.followedMsg", { ticker: row.ticker });
    void runRowAction(row.ticker, () => (request.kind === "group"
      ? fetchApi(`/portfolio/watchlist/${encodeURIComponent(request.ticker)}/group`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group_name: request.group_name }),
      })
      : fetchApi("/portfolio/watchlist", { method: "POST", body: JSON.stringify(request.payload) })), message)
      .catch((error: unknown) => setMutationMessage(error instanceof Error ? error.message : String(error)));
  };

  const handleRemove = (row: StockListRow) => {
    void runRowAction(row.ticker, () => fetchApi(`/portfolio/watchlist/${encodeURIComponent(row.ticker)}`, { method: "DELETE" }),
      t("portfolio.stocks.removedMsg", { ticker: row.ticker }))
      .catch((error: unknown) => setMutationMessage(error instanceof Error ? error.message : String(error)));
  };

  const handleAddUnlisted = ({ ticker, name, sector }: { ticker: string; name: string; sector: string }) =>
    runRowAction(ticker, () => fetchApi("/portfolio/watchlist", {
      method: "POST", body: JSON.stringify({ ticker, name, sector, group_name: UNFOLLOWED_GROUP, weight: 0 }),
    }), t("portfolio.stocks.addedToList", { ticker }));
```

   `handleAddUnlisted` on a ticker already on the watchlist would overwrite its row. Guard first: `if (watchlist.some((s) => s.ticker === ticker)) { setQuery…` is the table's concern. Implement it as an early `throw new Error(t("portfolio.stocks.alreadyListed", { ticker }))` before `runRowAction`, with catalog key `alreadyListed`: "{ticker} is already in the list." / "{ticker}은(는) 이미 목록에 있습니다.". The form shows the thrown message.
4. Delete `deleteWatchlistMutation`, `handleDeleteHolding`, `newTicker`, `newName`, `newSector`, `newWeightPercent`, `addToWatchlistOnly`, `existingTicker`, `portfolioBrowserSearch`, `browserSearchResults`, `browserCompanies`, `mergePortfolioCompanies`, `HoldingsTable`, `StockIdentity`, the page-level `MetricCell`, `holdingsView`, the resize effect that forces `"table"`, `collapsedSectors`, `sectorFilter`, `availableSectors`, `activeSectorFilter`, `filteredWatchlist`, `watchlistSectorGroups`, `buildSectorGroups` (if now unused) and `WatchlistSkeletonGrid` (if now unused). Delete the `ViewToggle`, `ChevronDown`, `ChevronRight` and `Trash2` imports if unused. Run `npm run lint`: an unused-variable error lists anything still left.
   Keep `syncWatchlistMutation` (Export), `resyncWatchlistMutation` (Import) and `handleImportJson`.
5. `stocksPanelBody` replaces `holdingsPanelBody`:

```tsx
  const stocksPanelBody = (
    <>
      {watchlistView.showError && (
        <StatusPanel title="Portfolio Data Unavailable" message="Could not load watchlist from backend. Verify backend connectivity and retry." tone="warning" />
      )}
      <StockListTable
        rows={stockRows}
        totalAmount={totalInvestmentAmount}
        totalStoredWeight={totalStoredWeight}
        comparisonMetricsByTicker={comparisonMetricsByTicker}
        pendingTicker={pendingTicker}
        onToggleFollow={handleToggleFollow}
        onSaveHolding={handleSaveHolding}
        onRemove={handleRemove}
        onOpenDetail={(row) => setSelectedStockContext({ ticker: row.ticker, fallbackStock: buildBrowserPortfolioStock(row, row.stock) })}
        onAddUnlisted={handleAddUnlisted}
        footer={(
          <WatchlistFileControls
            onExportWatchlist={() => { setMutationMessage(null); void syncWatchlistMutation.mutateAsync(); }}
            exportingWatchlist={syncWatchlistMutation.isPending}
            onImportJson={() => void handleImportJson()}
            importingJson={resyncWatchlistMutation.isPending}
            importJsonArmed={importJsonArmed}
            setImportJsonArmed={setImportJsonArmed}
            importUnavailableReason={peerSyncQuery.data?.enabled ? "Import is unavailable while watchlist sync is on." : null}
            syncStatus={syncStatusQuery.data}
            formatSyncTimestamp={formatSyncTimestamp}
          />
        )}
      />
    </>
  );
```

   `buildBrowserPortfolioStock(company, existing)` takes a `CorporateCompany`. A `StockListRow` has `ticker`, `name` and `sector`, so it satisfies that shape structurally; if `tsc` disagrees, pass `{ ticker: row.ticker, name: row.name, sector: row.sector }`.
   Until Task 5, setting `selectedStockContext` mounts the old modal; Task 5 renders the same selection in the drawer.
6. In the Allocation body, delete the `<PortfolioCommandCenter …/>` element and its grid wrapper's first column, so the allocation editor takes the full width.
7. **Tile follow (P11).**
   - `StockTile.tsx`: delete the follow `<button>` (lines ~138–157), the `followed` and `onToggleFollow` props, and the `pr-6` reservation the comment names.
   - `StockTileGrid.tsx`: delete `onToggleFollow` from its props and the pass-through.
   - Keep `followedGroup`/`unfollowedGroup`: the grid's filter labels and counts still use them.
   - `StockTileGrid.tsx:185`: the empty-followed description "Follow a stock with the + on its tile in All, or switch the filter to All." names the removed button. Change it to "Follow a stock from the Stocks tab, or switch the filter to All." (catalog key from design-system Task 10, both locales).
   - Remove the `onToggleFollow` prop from `<StockTileGrid>` in `page.tsx`.

- [ ] **Step 7: Existing specs (approved list).**
- In `portfolio-watchlist.spec.ts`, replace the helpers:

```ts
async function addUnlisted(page: Page, ticker: string, name: string, sector: string) {
  const panel = await openPortfolioPanel(page, "stocks");
  const form = panel.getByTestId("unlisted-form");
  await form.getByLabel("Ticker").fill(ticker);
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Sector").fill(sector);
  await form.getByRole("button", { name: "Add to list" }).click();
  await expect(page.getByText(`Added ${ticker} to the list.`)).toBeVisible();
}

async function addHoldingAmount(page: Page, ticker: string, amount: string) {
  const panel = await openPortfolioPanel(page, "stocks");
  const row = panel.getByRole("row").filter({ has: page.getByRole("button", { name: `Open ${ticker} detail` }) });
  await row.getByRole("button", { name: new RegExp(`^(Add ${ticker} holding|Edit ${ticker} amount)$`) }).click();
  await row.getByRole("textbox", { name: `Amount for ${ticker}` }).fill(amount);
  await row.getByRole("textbox", { name: `Amount for ${ticker}` }).press("Enter");
}

function removeButtons(page: Page) {
  return page.getByRole("tabpanel", { name: "Stocks" }).getByRole("button", { name: /^Remove [A-Z.^-]+$/ });
}
```

- `addHolding(…)` becomes `addUnlisted(…)`. `addHoldingWithAllocation(…, "60")` becomes `addUnlisted` + `addHoldingAmount(page, "AAPL", "6000")`. The total is $10,000, so 60.0% is unchanged on the Allocation tab.
- The "No Holdings Yet" assertion becomes the Stocks table's `"No stock matches"` only where the registry is empty. Otherwise it asserts `removeButtons` has count 0.
- Delete the `+ Add` / `Added` assertions and assert the row's `Held` chip instead.
- `clearAllHoldings` becomes: open Stocks, click `removeButtons(page).first()` until count 0.
- Delete the four tile-follow tests and the holdings Add test from `portfolio-tile-grid.spec.ts`. Their behaviour is covered by the new follow tests.

- [ ] **Step 8: Run.** `npm run typecheck && npm run lint && npx playwright test tests/e2e/portfolio-stock-list.spec.ts tests/e2e/stock-list-model.spec.ts tests/e2e/portfolio-*.spec.ts tests/e2e/refresh-idle-state.spec.ts tests/e2e/high-risk-render-regression.spec.ts tests/e2e/watchlist-peer-sync.spec.ts` → PASS.

- [ ] **Step 9: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `handleSaveHolding`: delete the `setWeightDrafts` block | `a pending allocation draft does not overwrite …` (row ends at $3,500.00) |
| `handleSaveHolding`: `holdingPayload(row, …)` → `{ ticker, name: row.name, sector: row.sector, group_name: UNFOLLOWED_GROUP, weight }` | `adding a holding to a followed stock keeps it followed and named` |
| `handleToggleFollow`: always use the upsert with `weight: 0` | `following a held stock keeps its amount and never uses the upsert` |
| `submit`: skip `amountToWeight` and send `Number(editing.value) / totalAmount` | `an amount above the unallocated money is refused and nothing is sent` |
| Editor input: drop `aria-describedby` | same test (attribute check) |
| `closeEditor`: drop the `requestAnimationFrame` focus | `Escape closes the editor and returns focus …` and `adding a holding … ` (focus on Edit button) |
| Follow `ActionButton`: drop `ariaPressed` | `every company is a row …` |
| `handleAddUnlisted`: `group_name: FOLLOWED_GROUP` | `a ticker not in the list is added unfollowed …` |
| `filterStockListRows` call: pass `"all"` always | `the status filter narrows …` |
| `onOpenDetail` → no-op | covered in Task 5 (`Escape in the amount editor …` opens detail from a row) |

- [ ] **Step 10: Commit**

```bash
git add -A apps/web/app/portfolio apps/web/components/ui/ActionButton.tsx apps/web/lib/i18n apps/web/tests/e2e docs/design/MoneyView_Glossary.md
git commit -m "feat(portfolio): Stocks tab adds holdings by amount and follows per row; four add paths and the tile follow removed"
```

---

### Task 5: Shared detail drawer; portfolio stock detail in it

**Files:**
- Create: `components/ui/focusTrap.ts`, `components/ui/DetailDrawerLayout.tsx`, `tests/e2e/detail-drawer.spec.ts`
- Modify: `components/ui/ModalShell.tsx` (uses `focusTrap.ts`), `app/portfolio/components/PortfolioTabs.tsx`, `app/portfolio/page.tsx`
- Rename: `app/portfolio/components/StockDetailModal.tsx` → `StockDetailPanel.tsx`
- Tests (approved list): `portfolio-watchlist.spec.ts` (`Close modal` → `Close detail`, Add To Portfolio lines), `portfolio-tile-grid.spec.ts` (:645), `portfolio-snapshot-history.spec.ts` (test 2 close)

**Interfaces (produces):**
- `FOCUSABLE: string`
- `trapTab(event, container)`
- `useIsDesktop(): boolean`
- `DrawerIds = { titleId: string }`
- `DetailDrawerLayout({ contentKey, onClose, renderDrawer, children, className? })`
- `DrawerHeader({ titleId, title, subtitle?, right?, onClose })`, with the close button named "Close detail"
- test id `detail-drawer`

`StockDetailPanel` takes the modal's props minus `onAddToPortfolio` and `onRemoveFromWatchlist`, plus `titleId`.

- [ ] **Step 1: Failing tests** (`tests/e2e/detail-drawer.spec.ts`)

```ts
import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { openPortfolioPanel } from "./helpers/portfolioPanels";
import { portfolioPartialWeightsFixture, type PortfolioStockFixture } from "./fixtures/shared";

/** Enough tiles to scroll; followed so the default grid filter shows them. */
function bulk(count: number): PortfolioStockFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    ticker: `TST${index + 1}`, name: `Test Holding ${index + 1}`, sector: "Technology", group_name: "custom",
    weight: 0.01, last_close: 100 + index, delta: { delta_pct: 0.5 }, sparkline: [95, 97, 99, 100 + index], id: index + 1,
  }));
}

async function gotoPortfolio(page: Page, watchlist?: PortfolioStockFixture[]) {
  await mockPortfolioPageApi(page, undefined, watchlist ? { watchlist } : undefined);
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
}

const drawer = (page: Page) => page.getByTestId("detail-drawer");

test.describe("desktop", () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test("a tile opens a non-blocking drawer beside the list, named by the stock", async ({ page }) => {
    await gotoPortfolio(page);
    const tile = page.getByTestId("stock-tile-AAPL");
    await tile.click();
    await expect(page.getByRole("dialog", { name: /Apple/ })).toBeVisible();
    await expect(drawer(page)).toHaveAttribute("aria-modal", "false");
    await expect(drawer(page).getByRole("button", { name: "Close detail" })).toBeFocused();
    await expect(drawer(page).getByRole("link", { name: "View Full Detail" })).toBeVisible();
    await expect(drawer(page).getByRole("button", { name: /Add To Portfolio|Review Portfolio Weight|Remove From Watchlist/ })).toHaveCount(0);
    await expect(drawer(page).getByLabel("Stock sector")).toBeVisible();
    await expect(page.locator("[inert]")).toHaveCount(0);
    // Side by side: the drawer starts where the list ends.
    const list = await page.getByTestId("portfolio-scroll-region").boundingBox();
    const box = await drawer(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(list!.x + list!.width - 1);
  });

  test("opening another stock swaps the drawer, never stacks it", async ({ page }) => {
    await gotoPortfolio(page);
    await page.getByTestId("stock-tile-AAPL").click();
    await page.getByTestId("stock-tile-MSFT").click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: /Microsoft/ })).toBeVisible();
  });

  test("after a swap, closing returns focus to the last opener", async ({ page }) => {
    await gotoPortfolio(page);
    await page.getByTestId("stock-tile-AAPL").click();
    await page.getByTestId("stock-tile-MSFT").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("stock-tile-MSFT")).toBeFocused();
  });

  test("closing returns focus to the opener and the list keeps its place", async ({ page }) => {
    await gotoPortfolio(page, bulk(40));
    const region = page.getByTestId("portfolio-scroll-region");
    await region.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const tile = page.getByTestId("stock-tile-TST40");
    await tile.click();
    await expect(drawer(page)).toBeVisible();
    await expect(tile).toBeInViewport();
    await drawer(page).getByRole("button", { name: "Close detail" }).click();
    await expect(drawer(page)).toHaveCount(0);
    await expect(tile).toBeFocused();
    await expect(tile).toBeInViewport();
    expect(await region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test("Escape closes the drawer and returns focus to the opener", async ({ page }) => {
    await gotoPortfolio(page);
    const tile = page.getByTestId("stock-tile-AAPL");
    await tile.click();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    await expect(tile).toBeFocused();
  });

  test("Escape in the amount editor closes the editor, not the drawer", async ({ page }) => {
    await gotoPortfolio(page, portfolioPartialWeightsFixture.map((row) => ({ ...row, weight: 0.1 })));
    await openPortfolioPanel(page, "stocks");
    await page.getByRole("button", { name: "Open AAPL detail" }).click();
    await expect(drawer(page)).toBeVisible();
    await page.getByRole("button", { name: "Edit MSFT amount" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Amount for MSFT" })).toHaveCount(0);
    await expect(drawer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
  });

  test("the drawer stays open across a tab switch", async ({ page }) => {
    await gotoPortfolio(page);
    await page.getByTestId("stock-tile-AAPL").click();
    await page.getByRole("tab", { name: "Allocation", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /Apple/ })).toBeVisible();
  });
});

test.describe("narrow", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("below 992px the drawer is a modal sheet over an inert list", async ({ page }) => {
    await gotoPortfolio(page);
    const tile = page.getByTestId("stock-tile-AAPL");
    await tile.click();
    await expect(drawer(page)).toHaveAttribute("aria-modal", "true");
    const box = await drawer(page).boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: 375 });
    await expect(page.locator("[inert]")).toHaveCount(1);
    for (let index = 0; index < 25; index += 1) await page.keyboard.press("Tab");
    expect(await drawer(page).evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await drawer(page).getByRole("button", { name: "Close detail" }).click();
    await expect(page.locator("[inert]")).toHaveCount(0);
    await expect(tile).toBeFocused();
  });
});
```

Check two things against the repo before running:
- `stock-tile-<TICKER>` is on the tile `<button>`, the element that receives focus. If it is on a wrapper, assert focus on `tile.getByRole("button").first()` instead.
- `mockPortfolioPageApi` with `watchlist: bulk(40)` keeps the company registry that `TST*` rows are added to through the watchlist merge.

Run `npx playwright test tests/e2e/detail-drawer.spec.ts`. Expected: FAIL (no `detail-drawer`; the modal opens instead).

- [ ] **Step 2: `components/ui/focusTrap.ts`** (extracted from `ModalShell.tsx`'s `handleDialogKeyDown` and its open effect, logic unchanged)

```ts
import type { KeyboardEvent } from "react";

export const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside `container`. Moved verbatim from ModalShell. */
export function trapTab(event: KeyboardEvent<HTMLElement>, container: HTMLElement) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
```

In `ModalShell.tsx`:
- Add `import { FOCUSABLE, trapTab } from "@/components/ui/focusTrap";`.
- Replace the selector string literal in the open effect with `FOCUSABLE`.
- Replace the body of `handleDialogKeyDown` with `if (dialogRef.current) trapTab(event, dialogRef.current);`.

Nothing else changes. The corporate modal specs are the regression check.

- [ ] **Step 3: `components/ui/DetailDrawerLayout.tsx`**

```tsx
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { trapTab } from "@/components/ui/focusTrap";
import { tokens } from "@/lib/tokens.generated";

const DESKTOP_QUERY = `(min-width: ${tokens.bp.desktop})`;

function subscribe(callback: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** Tailwind `lg` and up. The server renders desktop; the drawer is closed on first paint anyway. */
export function useIsDesktop() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP_QUERY).matches, () => true);
}

export type DrawerIds = { titleId: string };

interface DetailDrawerLayoutProps {
  /** What the drawer shows, by identity. null = closed; a different key swaps content in place. */
  contentKey: string | null;
  onClose: () => void;
  /** Drawer content. It must render a `DrawerHeader` with `ids.titleId`, so the drawer is named. */
  renderDrawer: (ids: DrawerIds) => ReactNode;
  /** The list side. Never remounted by opening, swapping or closing, so it keeps its scroll. */
  children: ReactNode;
  className?: string;
}

/**
 * A list with a drill-in drawer (design: UI consolidation plan U10-U12).
 * - >= 992px: an in-flow right column, non-modal. The list stays visible and clickable,
 *   and a click on another row swaps the content.
 * - < 992px: a full-height sheet, modal. The list is inert and Tab is trapped.
 * Focus moves to the close button on open and returns to the opener on close.
 */
export function DetailDrawerLayout({ contentKey, onClose, renderDrawer, children, className }: DetailDrawerLayoutProps) {
  const isDesktop = useIsDesktop();
  const open = contentKey !== null;
  const titleId = useId();
  const drawerRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Escape reads onClose through a ref so the listener's registration depends on `open`
  // alone (the ModalShell pattern, ERROR-LOG.md 2026-08-02).
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // An inner control that handled Escape (the Stocks amount editor) prevents default;
      // closing the drawer as well would spend one keypress on two things.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (contentKey === null) {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) {
        opener.focus();
        opener.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    // Opened or swapped. The element that had focus outside the drawer is the opener: a
    // row clicked while the drawer is open replaces the previous one.
    const active = document.activeElement;
    if (active instanceof HTMLElement && !drawerRef.current?.contains(active)) openerRef.current = active;
    drawerRef.current?.querySelector<HTMLElement>("[data-drawer-close] button")?.focus();
    // The list reflowed narrower; keep the row the user came from on screen.
    openerRef.current?.scrollIntoView({ block: "nearest" });
  }, [contentKey]);

  const sheet = open && !isDesktop;

  return (
    <div className={clsx("flex min-h-0 flex-1", className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={sheet || undefined}>
        {children}
      </div>
      {open ? (
        <aside
          ref={drawerRef}
          role="dialog"
          aria-modal={sheet ? "true" : "false"}
          aria-labelledby={titleId}
          tabIndex={-1}
          data-testid="detail-drawer"
          onKeyDown={sheet ? (event) => trapTab(event, event.currentTarget) : undefined}
          className={clsx(
            "fixed inset-0 z-50 overflow-y-auto bg-[var(--bg)]",
            "lg:static lg:z-auto lg:w-md lg:shrink-0 lg:self-start lg:border-l lg:border-[var(--line)] xl:w-lg",
            "lg:sticky lg:top-0 lg:max-h-[calc(100vh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))]",
          )}
        >
          {renderDrawer({ titleId })}
        </aside>
      ) : null}
    </div>
  );
}

/** The drawer's header: title (names the drawer), optional subtitle and right slot, close button. */
export function DrawerHeader({ titleId, title, subtitle, right, onClose }: {
  titleId: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--line)] bg-[var(--bg)] px-5 pb-4 pt-5">
      <div className="min-w-0">
        <h2 id={titleId} className="type-panel-title text-[var(--ink)]">{title}</h2>
        {subtitle ? <p className="type-small mt-0.5 text-[var(--ink-muted)]">{subtitle}</p> : null}
      </div>
      {right ? <div className="ml-auto mr-2 shrink-0 self-center text-right">{right}</div> : null}
      <span data-drawer-close className="shrink-0">
        <IconButton icon={<X className="h-4 w-4" />} onClick={onClose} label="Close detail" size="sm" />
      </span>
    </header>
  );
}
```

About `lg:static` followed by `lg:sticky`: both set `position`, and the later utility in Tailwind's generated order wins. `sticky` is emitted after `static`, so the computed position is `sticky`. Delete `lg:static` if `npm run lint`'s class-order check flags the conflict; the result is the same.

Catalog: if design-system Task 9 moved `IconButton` labels to `common.*`, use `t("common.closeDetail")` with `en` "Close detail" / `ko` "상세 닫기", and make `DrawerHeader` a client component that calls `useT()`. Otherwise keep the literal above. The tests use the English name.

- [ ] **Step 4: Stock detail content.** `git mv apps/web/app/portfolio/components/StockDetailModal.tsx apps/web/app/portfolio/components/StockDetailPanel.tsx`, then:
1. Rename the export to `StockDetailPanel` and the props interface to `StockDetailPanelProps`.
2. Add `titleId: string` to the props. Delete `onAddToPortfolio` and `onRemoveFromWatchlist`, and their destructuring. Keep `onClose`.
3. Replace the `<ModalShell open onClose={onClose} title={stock.name || stock.ticker} subtitle={stock.ticker} size="full" headerRightContent={headerRight}>` opening tag and its `</ModalShell>` with:

```tsx
    <>
      <DrawerHeader titleId={titleId} title={stock.name || stock.ticker} subtitle={stock.ticker} right={headerRight} onClose={onClose} />
      <div className="px-5 py-4">
        {/* the modal's former children, unchanged */}
      </div>
    </>
```

4. Delete the **Add To Portfolio / Review Portfolio Weight** button block (around line 476) and the **Remove From Watchlist** button block (around line 488). Keep the sector edit (`aria-label="Stock sector"`) and the **View Full Detail** link.
5. In the "Quick portfolio review" copy, change "Stay in the portfolio workflow here, or open the canonical detail route for full standalone ticker analysis." to "Open the full detail page for the price chart with technicals and the valuation workbenches."
6. Replace the `ModalShell` import with `import { DrawerHeader } from "@/components/ui/DetailDrawerLayout";`.

- [ ] **Step 5: `PortfolioTabs.tsx`.** Add a `detail` prop and wrap the panel in the layout:

```tsx
import { DetailDrawerLayout, type DrawerIds } from "@/components/ui/DetailDrawerLayout";
```

Add this to `PortfolioTabsProps`:

```tsx
  detail: { contentKey: string | null; onClose: () => void; renderDrawer: (ids: DrawerIds) => ReactNode };
```

Replace the `<TabPanel …/>` element with:

```tsx
      <DetailDrawerLayout contentKey={detail.contentKey} onClose={detail.onClose} renderDrawer={detail.renderDrawer}>
        <TabPanel tabKey={active} testId="portfolio-scroll-region" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {children}
        </TabPanel>
      </DetailDrawerLayout>
```

- [ ] **Step 6: `page.tsx`.**
1. Replace the `StockDetailModal` dynamic import with:

```tsx
const StockDetailPanel = dynamic(
  () => import("./components/StockDetailPanel").then((mod) => mod.StockDetailPanel),
  { loading: () => <LoadingState variant="spinner" label="Loading stock detail" />, ssr: false },
);
```

2. Delete the `{selectedStock && <StockDetailModal …/>}` element and `handleFocusAllocationForStock`.
3. Pass `detail` to `<PortfolioTabs>`:

```tsx
     detail={{
       contentKey: selectedStock?.ticker ?? null,
       onClose: () => setSelectedStockContext(null),
       renderDrawer: ({ titleId }) => selectedStock ? (
         <StockDetailPanel
           titleId={titleId}
           stock={selectedStock}
           isInWatchlist={selectedStockIsInWatchlist}
           comparisonMetrics={comparisonMetricsByTicker[selectedStock.ticker] ?? EMPTY_COMPARISON_METRICS}
           snapshotMeta={activeSnapshotMeta}
           comparisonUniverse={portfolioComparisonUniverse}
           comparisonBenchmarkTicker={debouncedBenchmarkTicker}
           comparisonCustomTickersInput={debouncedCustomTickersInput}
           activeSnapshotVersion={activeSnapshotMeta?.snapshot_version ?? ""}
           onUpdateSector={(stock, nextSector) => handleUpdateStockSector(stock, nextSector)}
           onClose={() => setSelectedStockContext(null)}
         />
       ) : null,
     }}
```

   `selectedStock` already falls back to `selectedStockContext.fallbackStock` when the watchlist row is gone, so removing the open stock leaves the drawer showing it rather than blank.
4. `openStockDetail` (tiles) and the Stocks table's `onOpenDetail` only call `setSelectedStockContext(…)`. Neither switches tabs.

- [ ] **Step 7: Existing specs (approved list).**
- `Close modal` → `Close detail` in `portfolio-watchlist.spec.ts` (:135, :206) and `portfolio-snapshot-history.spec.ts` test 2.
- Delete the "Add To Portfolio visible" line at `portfolio-watchlist.spec.ts:205`.
- `portfolio-watchlist.spec.ts:163`: drop the "with the holdings rail panel open" setup; the test opens detail from a tile, presses Escape and expects `portfolioModal(page)` count 0.
- `portfolio-tile-grid.spec.ts:645`: open AAPL detail, close with `Close detail`, then switch through the five tabs asserting the message count stays 1 after a sector save (`Updated sector for AAPL.`) instead of the Add To Portfolio message.

- [ ] **Step 8: Run.** `npm run typecheck && npm run lint && npx playwright test tests/e2e/detail-drawer.spec.ts tests/e2e/portfolio-*.spec.ts tests/e2e/refresh-idle-state.spec.ts tests/e2e/corporate-*.spec.ts` → PASS. The corporate specs are included because `ModalShell` changed.

- [ ] **Step 9: Mutation matrix**

| Mutation | Must fail |
|---|---|
| Escape listener without `event.defaultPrevented` | `Escape in the amount editor closes the editor, not the drawer` |
| Return-focus branch deleted (`opener.focus()`) | `closing returns focus to the opener …`, `Escape closes the drawer and returns focus …` |
| Opener captured only on the first open (`if (!openerRef.current) openerRef.current = active`) | `after a swap, closing returns focus to the last opener` (AAPL focused) |
| `aria-modal={sheet ? …}` → `"true"` always | `a tile opens a non-blocking drawer …` |
| `inert={sheet \|\| undefined}` deleted | `below 992px the drawer is a modal sheet over an inert list` |
| `onKeyDown` trap deleted | same (focus leaves the drawer within 25 Tabs) |
| Drawer moved inside the `TabPanel` (so the tab panel remounts it) | `the drawer stays open across a tab switch` |
| `lg:static … lg:sticky` → `lg:fixed lg:right-0` | `a tile opens …` (drawer `x` < list right edge, because the list is not narrowed) |
| `openerRef.current?.scrollIntoView(…)` on open deleted | `closing returns focus … keeps its place` (TST40 out of view while open) |
| `ModalShell`: `trapTab` call deleted | no new test. The existing corporate specs do not Tab through the modal, so this is listed as **uncovered**; the extraction is a pure move, reviewed in the diff. |

- [ ] **Step 10: Commit**

```bash
git add -A apps/web/components/ui apps/web/app/portfolio apps/web/tests/e2e
git commit -m "feat(ui): shared non-blocking detail drawer; portfolio stock detail in it without its add and remove duplicates"
```


---

### Task 6: Snapshot history inline; attribution methodology inline

**Files:**
- Rename: `app/portfolio/components/SnapshotHistoryModal.tsx` → `SnapshotHistorySection.tsx`
- Modify: `app/portfolio/page.tsx`, `app/portfolio/components/PortfolioSnapshotSummary.tsx`, `components/charts/AttributionWaterfall.tsx`
- Tests (approved list): `portfolio-snapshot-history.spec.ts`, `snapshot-history-metric-version.spec.ts`
- Create: tests appended to `tabs-portfolio.spec.ts`

- [ ] **Step 1: Failing tests** (append to `tabs-portfolio.spec.ts`)

```ts
test("snapshot history is a section of the Snapshot tab with one entry point", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  await page.getByRole("tab", { name: "Snapshot", exact: true }).click();
  const tab = page.getByRole("tabpanel", { name: "Snapshot" });
  await expect(tab.getByRole("heading", { name: "Snapshot History" })).toBeVisible();
  await expect(tab.getByRole("button", { name: /View All Saved Snapshots|Open Snapshot History/ })).toHaveCount(0);
  await expect(tab.getByRole("heading", { name: "Saved Snapshot List" })).toHaveCount(0);
  await tab.getByRole("button", { name: "Review Snapshot" }).first().click();
  await expect(page.getByText(/Reviewing saved snapshot from/)).toBeVisible();
  await expect(tab.getByRole("heading", { name: "Snapshot History" })).toBeVisible();
});

test("attribution methodology is a disclosure, not a dialog", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  await page.getByRole("tab", { name: "Snapshot", exact: true }).click();
  await page.getByRole("button", { name: "Refresh Analysis" }).click();
  await page.getByRole("tab", { name: "Attribution", exact: true }).click();
  const summary = page.getByRole("tabpanel", { name: "Attribution" }).locator("summary", { hasText: "Attribution Effects Methodology" });
  await summary.click();
  await expect(page.getByRole("tabpanel", { name: "Attribution" }).getByRole("heading", { name: "Allocation Effect" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
```

Before running, read `AttributionWaterfall.tsx`'s `effectDetails` and use its first effect's exact `name` in place of `"Allocation Effect"`. Run → FAIL.

- [ ] **Step 2: Snapshot section.**
1. `git mv` the file and rename the export to `SnapshotHistorySection`.
2. Delete the `onClose` prop. Replace the `<ModalShell …>` wrapper with `<section className="flex flex-col gap-4"><h3 className="type-panel-title text-[var(--ink)]">Snapshot History</h3>…</section>`, keeping the existing copy key if Task 10 moved the title into the catalog.
3. Delete the `ModalShell` import.
4. In `page.tsx`:
   - Delete the `SnapshotHistoryModal` dynamic import and element, the `snapshotHistoryOpen` state, and the whole "Saved Snapshot List" block. That block is the `div` holding the heading, the **View All Saved Snapshots** button, and the recent list with its loading, error, idle and empty branches.
   - In its place render:

```tsx
            <SnapshotHistorySection
              history={comparisonHistoryData ?? undefined}
              loading={portfolioComparisonHistoryQuery.isLoading && !comparisonHistoryData}
              error={portfolioComparisonHistoryQuery.isError && !comparisonHistoryData}
              activeSnapshotVersion={activeSnapshotMeta?.snapshot_version ?? ""}
              deletingSnapshotVersion={deleteSnapshotMutation.isPending ? deleteSnapshotMutation.variables ?? null : null}
              onSelectSnapshot={(point) => { setSelectedHistoryPoint(point); setPortfolioComparisonMode("snapshot"); }}
              onDeleteSnapshot={(point) => void handleDeleteSnapshotVersion(point.snapshot_version)}
            />
```

   - Delete `portfolioSnapshotHistoryViewState` and `snapshotHistoryView` if nothing else reads them (lint shows it).
5. `PortfolioSnapshotSummary.tsx`: delete the `setSnapshotHistoryOpen` prop and the **Open Snapshot History** button (line 158). Delete the prop at the call site.

- [ ] **Step 3: Methodology.** In `AttributionWaterfall.tsx`, delete `isDetailOpen`, its Escape `useEffect`, the opener button (line ~103) and the `role="dialog"` block. Below `</ChartPanelFrame>`, render:

```tsx
      <details className="mt-3 border border-[var(--line)] p-4">
        <summary className="type-label cursor-pointer text-[var(--ink)]">Attribution Effects Methodology</summary>
        <p className="type-small mt-2 text-[var(--ink-muted)]">
          X-axis values explain which source of active return added or detracted from benchmark-relative performance.
        </p>
        <div className="mt-4 space-y-4">
          {/* the former dialog's effectDetails.map(...) sections, unchanged */}
        </div>
      </details>
```

   `<details>`/`<summary>` give keyboard toggling and the expanded state to assistive tech natively. Delete `useState`/`useEffect` imports if unused.

- [ ] **Step 4: `ModalLoadingOverlay`** (page.tsx:56) is now unused: delete it.

- [ ] **Step 5: Existing specs (approved list).**
- `portfolio-snapshot-history.spec.ts` test 1:
  - Replace the open-button/focus/outside-click lines with `const snapshotHistory = await openPortfolioPanel(page, "snapshot");`.
  - Keep every content assertion (Locked Context, Read-only review context, Grouped By Date, both snapshot sources, 2.86%, Delete → "Deleted the selected saved snapshot.", Review Snapshot → "Reviewing saved snapshot from …", Clear History Selection).
- Test 2 measures overflow on `portfolioPanel(page, "snapshot")` and on `portfolioModal(page)` (the drawer, a full-width sheet at 375 px).
- `snapshot-history-metric-version.spec.ts`: `portfolioModal(page)` → `portfolioPanel(page, "snapshot")`.

- [ ] **Step 6: Run** `npx playwright test tests/e2e/tabs-portfolio.spec.ts tests/e2e/portfolio-snapshot-history.spec.ts tests/e2e/snapshot-history-metric-version.spec.ts tests/e2e/refresh-idle-state.spec.ts` → PASS.

- [ ] **Step 7: Mutation matrix**

| Mutation | Must fail |
|---|---|
| Keep the **View All Saved Snapshots** button | `snapshot history is a section … one entry point` |
| `onSelectSnapshot` also hides the section (`setHistoryVisible(false)`) | same test (heading gone after Review) |
| Restore the `role="dialog"` methodology block | `attribution methodology is a disclosure …` |
| Delete the `<details>` block | same test |

- [ ] **Step 8: Commit** `refactor(portfolio): snapshot history and attribution methodology inline; four history entry points become one`.

---

### Task 7: Market Overview detail in the shared drawer

**Files:**
- Modify: `components/market/MarketOverviewClient.tsx`
- Tests (approved list): `market-overview.spec.ts`, `market-overview.live.spec.ts`, `responsive-accessibility.spec.ts` (`Close modal` → `Close detail` only)
- Extend: `tests/e2e/market-overview.spec.ts` (new test appended; it is a new test, not an edit of an existing one)

- [ ] **Step 1: Failing test** (append to `market-overview.spec.ts`)

```ts
test.describe("detail drawer", () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test("an index opens in the drawer beside the grid, which stays usable", async ({ page }) => {
    await mockMarketPageApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
    const drawer = page.getByTestId("detail-drawer");
    await expect(page.getByRole("dialog", { name: "S&P 500" })).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-modal", "false");
    await expect(drawer.getByRole("link", { name: "View Full Detail" })).toHaveAttribute("href", "/detail/%5EGSPC");
    await page.getByRole("button", { name: "Open detail for Nasdaq" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "Nasdaq" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open detail for Nasdaq" })).toBeFocused();
  });
});
```

Check against the repo first:
- `mockMarketPageApi` is the helper `responsive-accessibility.spec.ts:104` imports. Import it from the same module here.
- The card opener's accessible name is `Open detail for <name>` (`responsive-accessibility.spec.ts:107`).
- The Nasdaq fixture name matches `market-overview.spec.ts:46`.

Run → FAIL (the modal is `aria-modal="true"`).

- [ ] **Step 2: Convert.**
1. Rename `MarketDetailModal` to `MarketDetailPanel`. Its props become `{ item: MarketIndexQuote; titleId: string; onClose: () => void }`.
2. Replace `<ModalShell open onClose={onClose} title={item.name} subtitle={modalSubtitle} size="xl">` and its closing tag with:

```tsx
    <>
      <DrawerHeader titleId={titleId} title={item.name} subtitle={modalSubtitle} onClose={onClose} />
      <div className="px-5 py-4">
        {/* the modal's former children, unchanged */}
      </div>
    </>
```

3. Change the "Quick market detail" copy "Stay in the overview workflow here, or open the canonical detail route for a standalone deep-dive view." to "Open the full detail page for the price chart with technicals and the valuation workbenches."
4. In `MarketOverviewClient`'s return, wrap the existing `<section className="space-y-4">…</section>` in:

```tsx
    <DetailDrawerLayout
      contentKey={selectedIndex?.ticker ?? null}
      onClose={() => setSelectedIndex(null)}
      renderDrawer={({ titleId }) => selectedIndex ? (
        <MarketDetailPanel item={selectedIndex} titleId={titleId} onClose={() => setSelectedIndex(null)} />
      ) : null}
    >
      {/* the existing <section className="space-y-4"> … </section> */}
    </DetailDrawerLayout>
```

   Then delete `{selectedIndex ? <MarketDetailModal …/> : null}` and the `ModalShell` import, and add `import { DetailDrawerLayout, DrawerHeader } from "@/components/ui/DetailDrawerLayout";`.
5. Card grid on container queries, so it reflows to the width left beside the drawer rather than to the viewport.
   - On the element wrapping the `viewMode === "chart"` grid (the `space-y-4` section), add `@container`.
   - Change `grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3` to `grid grid-cols-1 gap-6 @2xl:grid-cols-2 @5xl:grid-cols-3`.
   - With the drawer closed, this gives the same column counts as today at the e2e widths (375 → 1, 768 → 2, 1366 → 3). At 1366 with the drawer open, it gives 2 columns.
6. Change the `description` copy at line ~201 ("Use this view the same way Portfolio uses stock detail…") to "Start from the overview grid, then open an item to read it beside the list."

- [ ] **Step 3: Existing specs (approved list).** Replace `getByRole("button", { name: "Close modal" })` with `getByRole("button", { name: "Close detail" })`:
- `market-overview.spec.ts`: lines 41, 62, 71, 94
- `market-overview.live.spec.ts`: lines 22, 28, 34
- `responsive-accessibility.spec.ts`: line 114

No other line changes.

- [ ] **Step 4: Run** `npx playwright test tests/e2e/market-*.spec.ts tests/e2e/event-*.spec.ts tests/e2e/responsive-accessibility.spec.ts --grep-invert live` → PASS. Run `market-overview.live.spec.ts` once with the live harness the file documents. If the network is unavailable, record "not run, offline" in Track U; do not mark it verified.

- [ ] **Step 5: Capture and review.** `DESIGN_CAPTURE=ui-consolidation npx playwright test tests/e2e/design-capture.spec.ts && node scripts/capture-review.mjs <last design-system capture id> ui-consolidation`. The owner reviews Market Overview with the drawer closed (expected: unchanged columns) and Portfolio (expected: tabs). Record the verdict in Track U.

- [ ] **Step 6: Mutation matrix**

| Mutation | Must fail |
|---|---|
| Keep rendering `MarketDetailModal` in `ModalShell` | `an index opens in the drawer …` (`aria-modal="true"`) |
| `contentKey={selectedIndex ? "open" : null}` (no identity, so a swap does not move focus or re-capture the opener) | same test (Nasdaq opener not focused after Escape) |
| `DrawerHeader` close label back to "Close modal" | `responsive-accessibility.spec.ts` "modal focus …" (after the approved edit) |
| Card grid back to `md:grid-cols-2 lg:grid-cols-3` | none automated. The Step 5 review compares the open-drawer layout; listed as reviewed, not tested. |

- [ ] **Step 7: Commit** `refactor(market): instrument detail opens in the shared drawer beside the grid`.

---

### Task 8: Corporate: calculation detail stays a modal; its duplicate entry point goes (SUPERSEDED)

> **SUPERSEDED 2026-10-14** by `docs/superpowers/plans/2026-10-14-corporate-one-screen.md`. That plan removes the outer View Full Report button (its Task 7) and keeps `CalculationDetailModal` a `ModalShell` modal, reorganised into tabs (its Task 8). It carries this task's three test-change rows in its own inventory (#31, #33, #49). Do not run the steps below. `tests/e2e/helpers/corporateDcf.ts` already exists from that plan with different helpers; do not recreate it.

**Files:**
- Modify: `app/corporate/page.tsx`
- Tests (approved list): `corporate-comparison.spec.ts`, `corporate-dcf-sensitivity.spec.ts`, `refresh-idle-state.spec.ts` (:628)
- Create: `tests/e2e/helpers/corporateDcf.ts`; one new test appended to `corporate-comparison.spec.ts`

C1 is a contextual reference opened from about 20 places (U9), so it stays on `ModalShell` unchanged. Only C1a goes: the outer **View Full Report** button, which opens the same `backendDcf` modal as the **Intrinsic DCF** tile. C1b (`crp` from the slider and the chart) stays by U9.

- [ ] **Step 1: Shared helper** (`tests/e2e/helpers/corporateDcf.ts`)

```ts
import { expect, type Locator, type Page } from "@playwright/test";

/** Intrinsic DCF tile → Full DCF Report → Load Full Report: the one path to the full report. */
export async function openFullDcfReport(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^Intrinsic DCF(?! Value)/i }).first().click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.locator("summary").filter({ hasText: "Full DCF Report" }).click();
  await modal.getByRole("button", { name: "Load Full Report" }).click();
  return modal;
}
```

- [ ] **Step 2: Failing test** (append to `corporate-comparison.spec.ts`; reuse the file's existing mock setup from its test at :93)

```ts
test("the full DCF report has one entry point, the Intrinsic DCF tile", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  await expect(page.getByRole("button", { name: "View Full Report" })).toHaveCount(0);
  const modal = await openFullDcfReport(page);
  await expect(modal.getByText(/Full DCF Report Unavailable|Full report loaded for/)).toBeVisible();
});
```

Use the mock function and imports `corporate-comparison.spec.ts:93` already uses (`mockCorporatePageApi` or whatever that test calls). Add `import { openFullDcfReport } from "./helpers/corporateDcf";`. Run → FAIL (the count is 1).

- [ ] **Step 3: Remove C1a.** In `app/corporate/page.tsx`, delete the `<button … onClick={() => void handleViewFullDcfReport()} …>{dcfFullReportLoading ? "Loading report..." : "View Full Report"}</button>` element (lines ~976–983). Keep `handleViewFullDcfReport`: the modal's **Load Full Report** button still calls it through `onRequestDcfFullReport`. Run `npm run lint`: nothing else becomes unused.

- [ ] **Step 4: Existing specs (approved list).**
- `corporate-comparison.spec.ts:115–121`: replace the `viewFullReportButton` lines and `const dcfDialog = page.getByRole("dialog"); await expect(dcfDialog).toBeVisible(); await dcfDialog.locator("summary").filter({ hasText: "Full DCF Report" }).click();` with `const dcfDialog = await openFullDcfReport(page);`. The `Full DCF Report Unavailable` assertion stays.
- `corporate-dcf-sensitivity.spec.ts`: `openFullReport` becomes:
  ```ts
  async function openFullReport(page: Page) {
    const modal = await openFullDcfReport(page);
    await expect(modal.getByText("WACC x Terminal Growth Sensitivity")).toBeVisible({ timeout: 30_000 });
    return modal;
  }
  ```
- `refresh-idle-state.spec.ts:628`: `await page.getByRole("button", { name: "View Full Report" }).click();` → `await openFullDcfReport(page);`.

- [ ] **Step 5: Run** `npx playwright test tests/e2e/corporate-*.spec.ts tests/e2e/refresh-idle-state.spec.ts tests/e2e/dcf-workbench-refusal.spec.ts` → PASS.

- [ ] **Step 6: Mutation matrix**

| Mutation | Must fail |
|---|---|
| Keep the outer View Full Report button | `the full DCF report has one entry point …` |
| Modal's `onRequestDcfFullReport` prop removed at the call site | `the full DCF report has one entry point …`, `corporate-dcf-sensitivity.spec.ts` (no Load Full Report button) |
| `handleViewFullDcfReport` no longer sets `backendDcf` | none. The tile opens the modal itself. This is equivalent behaviour, so it is recorded as **survives** and is correct. |

- [ ] **Step 7: Commit** `refactor(corporate): one entry point to the full DCF report; calculation detail stays a modal`.

---

### Task 9: Orphans, docs, final gate

**Files:** Modify `docs/USER-GUIDE.md`, `guideline/sop/todo.md`, and `docs/design/MoneyView_Component_System.md` (if it lists `SidePanel` or the portfolio modals).

- [ ] **Step 1: Prove the orphans are gone and the keepers are used.**
  - `git grep -n "SidePanel\|PortfolioShell\|PortfolioCommandCenter\|StockDetailModal\|SnapshotHistoryModal\|MarketDetailModal\|ModalLoadingOverlay\|HoldingsTable" -- apps/web` must return nothing.
  - `git grep -ln "ModalShell" -- apps/web/app apps/web/components` must list exactly `components/ui/ModalShell.tsx` and `app/corporate/components/CalculationDetailModal.tsx`.
  - `git grep -ln "IconButton" -- apps/web/components apps/web/app` must list `IconButton.tsx`, `ModalShell.tsx` and `DetailDrawerLayout.tsx`.
- [ ] **Step 2: Overlay census.** `git grep -n 'role="dialog"\|aria-modal' -- apps/web/app apps/web/components` must list exactly `components/ui/ModalShell.tsx` and `components/ui/DetailDrawerLayout.tsx`. `EventFilter.tsx`'s comment mentions `role="dialog"` in prose; if it matches, it is the only allowed extra hit.
  - **Mutation:** add `role="dialog"` to `TabPanel`. The census must report it, and `tabs-portfolio.spec.ts` `the portfolio sections are tabs, not overlays` must fail. Restore it.
- [ ] **Step 3: Docs.**
  - `git grep -n -i "modal\|rail\|side panel\|slide-over\|Manual Add\|Add To Portfolio\|View All Saved Snapshots\|View Full Report" -- docs/USER-GUIDE.md docs/design`. Rewrite each hit that describes the portfolio, market or corporate UI: tabs for portfolio sections, "the detail drawer" for stock and market detail, the Intrinsic DCF tile for the full report. The corporate calculation detail stays "modal". Do not edit `docs/archive/`.
  - The left sidebar no longer exists (top bar, corporate one-screen plan Task 3); describe navigation as "the top bar".
  - In `docs/USER-GUIDE.md`'s portfolio section, add one paragraph covering:
    - the Stocks tab, with per-row Follow and Add holding;
    - that the amount is recorded as a share of Total investment amount, with the unallocated limit;
    - that a stock opens in a drawer beside the list.
  - In `docs/design/MoneyView_Interaction_Rules.md`, add the U9 criterion as the rule for choosing a tab, drawer or modal.
- [ ] **Step 4: Track.** In `guideline/sop/todo.md`, add "Track U: UI consolidation (tabs, drawer)". Give one line per task with its status, the Step 5 visual verdict, and the follow-ups below.
- [ ] **Step 5: Final gate.**
  - From `apps/web`: `npm run typecheck && npm run lint && npm run test:unit && npx playwright test`.
  - From the repo root: `python -m pytest -q` (count unchanged).
  - Run `guideline/sop/code-reviewer.md`'s checklist over `git diff renewal...HEAD`.
- [ ] **Step 6: Commit** `docs(ui): tabs, drawer and modal each have a stated use; user guide updated`.

---

## Follow-ups (not in this plan)

- **C2:** one owner for comparison controls and snapshot writes (Corporate vs Portfolio Snapshot tab).
- **S5:** an audit of the DCF surfaces under `finance-logic.md`.
- **Purchase records** (Q1): a backend design for quantity, price, date and lots, with a records-sync kind. New sync children must be optional.
- **One Escape hook** for `ModalShell` and `DetailDrawerLayout`, if a third overlay type arrives (U12).
- **Backend endpoints unused after this plan:** none. Checked:
  - `/portfolio/watchlist` (GET/POST/DELETE), `/watchlist/{t}/group`, `/watchlist/sync`, `/watchlist/resync`, `/watchlist/sync-status`, `/watchlist/peer-sync` and `/preferences`;
  - `/portfolio/stock/{t}`, `/corporate/companies`, `/market/index/{t}/detail`, `/corporate/dcf/{t}/report` and the corporate audit routes.

  All keep a caller. `group_name = "browser"` is no longer written. Existing rows with it still display and still sync.

## Sync safety (checked against the code)

- **Watchlist peer sync** (`apps/api/services/watchlist_sync/`) merges whole rows per ticker, last writer wins, with tombstones. It runs on every `GET /portfolio/watchlist` and after every mutation. This plan writes only through the three existing mutation endpoints, with the same row fields, so the merge sees nothing new.
- **Records sync** (`apps/api/services/records_sync/`, `KIND_PREFERENCES`) is untouched. `total_investment_amount` is only read here.
- The personal watchlist stays out of the public seed: no seed file is touched.
- No sync file gains a field, so "new sync children must be optional" is not triggered.

---

## Self-review (2026-10-13, after the overlay revision)

**Owner criterion applied (U9).** Every overlay row in the inventory carries a class:
- P1, P12 and P13 are work areas, so tabs or sections (kept from the first version).
- P7 and M1 are list drill-ins, so one shared drawer (Tasks 5, 7).
- C1 is a contextual reference, so it stays a modal; its duplicate entry point C1a is removed and C1b is kept on purpose (Task 8).
- P17 is a transient confirmation (kept).
- S1 `ModalShell` and S2 `IconButton` are kept because C1 and the drawer use them; Task 9 Step 1 proves it.

**Drawer requirements → tests:**

| Requirement | Test |
|---|---|
| right-side and non-blocking at ≥ 992 px | `a tile opens a non-blocking drawer …` (`aria-modal="false"`, no `inert`, `x` past the list) |
| full-height sheet below | `below 992px … sheet over an inert list` |
| Escape and close button | `Escape closes …`, `closing returns …` |
| focus in, then back to the opener | `… toBeFocused` on the close button, then on the tile |
| `aria-labelledby` | `getByRole("dialog", { name })` in both drawers |
| list keeps its place | `closing returns focus … keeps its place` |
| swap, never stack | `opening another stock swaps …`, `after a swap, closing returns focus to the last opener`, and the market drawer test |
| P5/P6 out, P18 and the View Full Detail link in | `a tile opens …` |

**Spec coverage (unchanged parts).**
- The full list as a table with per-row add-by-amount, follow/unfollow and state chips: Task 4.
- The duplication removals: P2–P6, P8–P11, P12, P14, C1a.
- The task mapping: P1 → T3; P2–P4, P8–P11, P16 → T4; P5–P7, P15, P18 → T5 and T6; P12, P13 → T6; M1 → T7; C1a → T8; S3 → T1.

**Placeholders.** None in the code. Several steps tell the implementer to read a value from the repo at run time, because it lives on a branch not yet merged or cannot be confirmed from here. Each names the file and line to read:
- the tabState namespace literal (T3)
- the first `effectDetails` name (T6)
- the metric `LabelKey`s from design-system Task 10 (T4)
- `mockMarketPageApi`/`mockCorporatePageApi` imports (T7, T8)
- the tile test-id element (T5)

**Type consistency.**
- `DrawerIds` flows from `DetailDrawerLayout` to both panels.
- `StockListRow` is a `type` alias, so it satisfies `DenseTable`'s constraint.
- `PortfolioTabKey` is checked at runtime before use.
- The `inert` prop is React 19's boolean.

**Stated, not hidden:**
- Coverage gaps:
  - `ModalShell`'s Tab trap after the extraction has no test; it is a reviewed pure move.
  - The market card grid's container-query column counts are reviewed visually, not asserted.
  - The `Math.min(…, room)` clamp may be unobservable for the tested inputs.
- Environment and process risks:
  - `market-overview.live.spec.ts` needs the network.
  - The design-system plan's Task 10 Korean assertion in `portfolio-panel-presentation.spec.ts` is moved to `tabs-portfolio.spec.ts` before that file is deleted, so it is not dropped.
