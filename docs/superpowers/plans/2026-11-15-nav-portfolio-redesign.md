# Top nav and portfolio redesign (2026-11-15)

Owner-approved design: canvas https://claude.ai/artifact/JJGAT9GVWbevpFKm1n6rP8
(boards `Main`, `Panel`, `PortfolioLean`; copies in `.superpowers/sdd/2026-11-15-nav-portfolio/design/`).
Test inventories: `.superpowers/sdd/2026-11-15-nav-portfolio/topnav-inventory.md`,
`portfolio-inventory.md`.

## Owner decisions (2026-11-15)

| # | Decision |
|---|---|
| D1 | Top bar >=768px: icon row; hover or keyboard focus slides the label out to the right of that icon and pushes the others (duration-normal, easing-emphasized; none under reduced motion). The current page's label is always shown. Hover/focus no longer opens the panel. |
| D2 | ☰ is click-only at every width. The panel lists 4 groups: 시장 (market, news, events), 신호 (signals, alerts), 기업·가치평가 (corporate, valuation, cases), 포트폴리오 (portfolio, monte-carlo, decisions). Hover, click or focus on a group shows its pages in a flyout; the current page's group is expanded when the panel opens. |
| D3 | Portfolio: the right icon rail, SidePanel, the snapshot panel and the holdings panel are removed. |
| D4 | Header: title, one-line subtitle (stock count, weight total), one `내보내기 ▾` menu (PDF 인쇄 first, then CSV, JSON, Markdown). |
| D5 | Page tabs 종목 / 비중 / 성과 기여. |
| D6 | 종목 tab: card/table icon toggle; table = old holdings table content plus a follow (☆) column, honouring the group filter and search. Sector filter, sector grouping, Sync and per-row delete are dropped (delete stays in the stock detail modal). |
| D7 | Adding a stock: a dashed "+ 종목 추가" card at the end of the grid (and a row in the table) opens a modal reusing PortfolioCommandCenter's search and Add. |
| D8 | News refreshes automatically once on load; a quiet "뉴스 N분 전 갱신" button refreshes again. |
| D9 | 성과 기여 is kept (it does not depend on snapshots; it only shared the snapshot panel's refresh button). Its tab holds one `기간 ▾` control (holding start date, return end date, benchmark) and its own calculate button. |
| D10 | Every snapshot feature is deleted with its code: Save Current As Snapshot, snapshot history modal, snapshot summary, comparison history and snapshot-version calls. Saves used by the 비중 tab stay. |
| D11 | /portfolio joins ONE_SCREEN_ROUTES (1280x720, no page scroll). |
| D12 | Existing-test changes approved as listed in the two inventories, including deleting tests of removed features and the one-screen expectations in corporate-one-screen:614, market-model:120, one-screen-no-scroll:17. Every changed assertion is recorded (file:line, old, new) in the task report. |

| D13 | (owner, after P3a) `portfolio-watchlist.spec.ts` `removeButtons` helper counts holdings as tiles or table rows instead of Remove buttons (476bc15). Approved. |
| D14 | Weights tab sliders and checkboxes get a hit area of at least 24px; the `test.fixme` "controls inside a panel are big enough to hit" is revived. |
| D15 | The table view has no news column (news stays on the cards). |

| D16 | (owner 2026-11-16) The 성과 기여 (Attribution) tab is removed with its code: the tab, PeriodControl (dates and benchmark), the attribution query and calculate button, PortfolioAttributionSummary, AttributionWaterfall and their catalog keys. The export menu keeps working with the default window and benchmark. Tests that only exercise the removed feature are deleted; any other assertion change needs the owner. Supersedes D9 and D14's attribution part. |

## Tasks (one at a time; each runs only its own specs; the controller runs the wide regression)

| Task | Scope | Specs |
|---|---|---|
| N1 | TopNav D1-D2 + topnav/sidebar-contrast test changes + new tests | topnav, sidebar-contrast, events-page, risk-records, paper-identity, cases, i18n, responsive-accessibility |
| P1 | Export menu D4 (ExportButton -> menu) + new portfolio-export-menu spec | new spec, blocked-storage, page-guides, tab-state-persistence |
| P2 | Tabs D5, remove rail/panels D3, snapshot deletion D10, calculate button in 성과 기여, one-screen D11; rewrite `tests/e2e/helpers/portfolioPanels.ts` to tabs; delete obsolete tests | every spec in portfolio-inventory §A + one-screen-no-scroll, corporate-one-screen, market-model, page-guides |
| P3 | 종목 tab D6-D8 (toggle, table + follow, add modal, news auto-refresh) | tile-grid, news-failure-honesty, tab-state-persistence, watchlist, peer-sync + new specs |
| P4 | 기간 control D9 | watchlist 303-386, refresh-idle-state, high-risk-render-regression |
