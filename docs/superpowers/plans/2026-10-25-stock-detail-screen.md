# Stock Detail One-Screen (Risk ④-b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/detail/[ticker]` as a 1280×720 no-scroll page. It shows trend tiles, a "why it moved" chart with adjustable big-move marks and an explanation card, a stock/theme news column and watchlist up/down movers. DCF and diagnostics move behind a /corporate link.

**Architecture:**
- **Backend:** three read endpoints in `apps/api/routes/detail.py`, backed by a new `apps/api/services/detail_view.py`: profile, latest movers, and the explanation of one move. Plus a `topic` filter on `/news/feed`.
- **Frontend:** the page moves from server-side fetching to client hooks, so Playwright can mock every request. Big-move detection is a pure TypeScript module computed in the browser from daily bars. The chart gains a markers layer.

**Tech Stack:** FastAPI, SQLite, pytest; Next.js 16 App Router, React, TanStack Query, lightweight-charts 5.1, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-25-stock-detail-screen-design.md` (decisions S-D1 to S-D15).

## Global Constraints

- **Layout.** 1280×720, no page scroll. Add `/detail` to `ONE_SCREEN_ROUTES` (`apps/web/components/ui/oneScreenRoutes.ts`).
- **Design tokens.** Colours, type, radius and sizes come only from `apps/web/tokens/moneyview.tokens.json`; read `DESIGN.md` first. `npm run lint` must pass. Figures use a mono style.
- **Copy.** Every visible string goes in both `apps/web/lib/i18n/messages/en.ts` and `ko.ts` under `detail.*`. English labels must pass the i18n-model regex (`[A-Za-z0-9 .&/-]`); Korean labels must contain Hangul. Change labels, never the regex.
- **Big-move rule (S-D6/S-D7).**
  - `r_t = close_t/close_{t-1} - 1`.
  - `sd_t` = sample standard deviation of the 60 daily returns t-60..t-1. With fewer than 60, no mark.
  - `price_ratio = |r_t| / sd_t`.
  - `vol_ratio = volume_t / mean(volume_{t-20..t-1})`. With fewer than 20 days, or a mean of 0, there is no volume test.
  - ○ when `price_ratio >= price`. ● when also `vol > 0` and `vol_ratio >= vol`.
  - Inputs: price 0.5–10, volume 0–10, step 0.1. Defaults are 2.0 and 2.0.
- **Threshold storage (S-D8).** localStorage key `moneyview.detail.bigMove`, storing JSON `{"price":2,"volume":2}`. Every read and write goes in try/catch; blocked storage falls back to the defaults.
- **Periods.** The chart defaults to 6 months (126 trading days) and offers 1Y (252) and 5Y (all). Tiles: 1W = 5, 1M = 21, 6M = 126 trading days. MA20, MA50, RSI(14) with Wilder smoothing, and volume multiple = latest volume ÷ mean of the previous 20.
- **News window.** Clicked date ±2 days, inclusive, the same as ④-a. `published_at` null means no time is shown, only the date.
- **Watchlist vs not (S-D12).** A ticker not in the watchlist (`profile.in_watchlist == false`) hides name, sector, theme, peers, the news column and news search. That area shows `detail.notWatchlist`. Marks and the explanation card still work.
- **Truthful card.** A value that cannot be computed is `null` and shows "—", never 0.
- **Test rules.** Every new test is mutation-checked (CLAUDE.md §8). Only one Playwright run at a time (ports 3101/8110).

## Review Focus

1. **A ticker with fewer than 61 bars** (a recent IPO or a fresh watchlist add) must show tiles where possible and no big-move marks, with no crash or NaN. Test: Task 4 `few bars give no marks and no NaN`.
2. **The latest common trading day when one ticker already has today's bar** must not move the movers date. Test: Task 1 `test_movers_use_latest_common_day`.
3. **An index or commodity page** (`/detail/^GSPC`, `/detail/GC=F`) must render with the watchlist-only parts hidden. Test: Task 3 `a non-watchlist instrument hides theme and news`.
4. **Blocked site storage** must leave the page working with default thresholds. Test: Task 4 `blocked storage uses default thresholds`.
5. **A clicked mark on a day with no stored news and no past search** must offer the search, not claim "no news". After a search with zero results it must say so. Test: Task 5 `find-news states`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/api/services/detail_view.py` (create) | `profile`, `latest_movers`, `explain_move`: pure reads over stocks, indices, watchlist, risk store, events, news |
| `apps/api/models/schema_parts/detail.py` (create) | Pydantic response models for the three endpoints |
| `apps/api/routes/detail.py` (modify) | `GET /movers/latest`, `GET /{ticker}/profile`, `GET /{ticker}/move/{day}` |
| `apps/api/routes/news.py`, `services/news_service.py` (modify) | `topic` query param on `/feed` |
| `apps/web/app/detail/[ticker]/page.tsx` (modify) | Thin server page: passes the ticker only |
| `apps/web/app/detail/[ticker]/DetailView.tsx` (rewrite) | Client page shell and layout |
| `apps/web/components/detail/` (create) | `DetailHeader.tsx`, `TrendTiles.tsx`, `MoversColumn.tsx`, `MoveChart.tsx`, `ThresholdInputs.tsx`, `MoveCard.tsx`, `DetailNews.tsx` |
| `apps/web/lib/detail/` (create) | `metrics.ts` (tiles), `bigMoves.ts` (detection), `thresholds.ts` (storage), `useDetail.ts` (React Query hooks), `types.ts` |
| `apps/web/components/charts/TVChart.tsx`, `OHLCVChartCard.tsx` (modify) | Optional `markers` + `onMarkerClick`; a single events on/off toggle mode |
| `apps/web/app/corporate/page.tsx` (modify) | Read `?ticker=` as the initial ticker |
| `apps/web/components/ui/oneScreenRoutes.ts` (modify) | Add `/detail` |
| `apps/web/components/workbenches/` (delete) | `DCFWorkbench.tsx`, `DiagnosticWorkbench.tsx` (only DetailView uses them) |
| `apps/web/tests/e2e/helpers/detailPageMock.ts` (create) | Deterministic bars and API mocks for the detail page |
| `apps/web/tests/e2e/detail-*.spec.ts` (create) | Layout, tiles, marks, card, news, movers |

---

### Task 1: Backend reads — profile, latest movers, theme news filter

**Files:**
- Create: `apps/api/services/detail_view.py`, `apps/api/models/schema_parts/detail.py`, `tests/api/test_detail_view.py`
- Modify: `apps/api/routes/detail.py`, and `apps/api/models/schemas.py` (re-export, following the existing schema_parts pattern)
- Modify: `apps/api/routes/news.py` (`/feed` gains `topic`) and `apps/api/services/news_service.py::get_news` (`topic: str | None = None`; when given, filter `topic = ?` instead of the default `topic = ''`, with or without `ticker`)

**Interfaces:**
- Produces:
  - `ThemeRef {id: str, label: {en: str, ko: str}}`
  - `DetailProfile {ticker: str, in_watchlist: bool, name: str | None, sector: str | None, theme: ThemeRef | None}`
  - `MoverRow {ticker: str, name: str, theme: str | None, return_pct: float}`
  - `LatestMovers {date: str | None, up: list[MoverRow], down: list[MoverRow]}`
  - `profile(ticker: str) -> DetailProfile`: theme labels come from `apps.api.services.watchlist_themes.load_themes()`.
  - `latest_movers(limit: int = 5) -> LatestMovers`:
    - The date is the latest date on which at least 90% of watchlist tickers that have bars have a bar. It must not be decided by a few tickers that already have the next day. Define and comment the rule.
    - `return_pct` = close on that date ÷ that ticker's previous bar close − 1, × 100, rounded to 2 dp.
    - `up` is descending, `down` ascending. Only tickers with both bars count.
  - Routes:
    - `GET /api/v1/detail/movers/latest` returns `LatestMovers`. Declare it before the `/{ticker}` routes.
    - `GET /api/v1/detail/{ticker}/profile` returns `DetailProfile`. It never 404s: an unknown ticker gives `in_watchlist=false` and nulls.
    - `GET /api/v1/news/feed?topic=theme:ai&from&to` filters theme rows.

- [ ] **Step 1: Write the failing tests** in `tests/api/test_detail_view.py`. Seed the `watchlist` and `stocks` tables directly in the isolated DB.

```python
def test_profile_of_watchlist_stock_has_theme_labels(seeded): ...   # theme.id == "ai_semis", label.ko == "AI 반도체"
def test_profile_of_unknown_ticker_is_not_watchlist(seeded):
    p = profile("^GSPC"); assert (p.in_watchlist, p.name, p.theme) == (False, None, None)
def test_movers_top_and_bottom_five_sorted(seeded12): ...          # exact tickers and return_pct to 2 dp
def test_movers_use_latest_common_day(seeded12):
    add_bar("AAA", "2026-10-26")                                    # one ticker runs a day ahead
    assert latest_movers().date == "2026-10-23"
def test_movers_skip_ticker_without_previous_bar(seeded12): ...
def test_feed_topic_filter_returns_theme_rows(client, news_rows): ...   # topic=theme:ai returns only those rows; no topic keeps old behaviour
def test_routes(client, seeded12): ...                              # /detail/movers/latest and /detail/AAPL/profile return 200 with the shapes
```

- [ ] **Step 2:** Run `python -m pytest tests/api/test_detail_view.py -q` and confirm the failures (import error).
- [ ] **Step 3:** Implement the models, `profile`, `latest_movers`, the routes and the feed `topic` filter.
- [ ] **Step 4:** Run `python -m pytest tests/api/test_detail_view.py tests/api/news_feed -q`. Expected: all pass.
- [ ] **Step 5: Mutation check:**
  - date from the max date of any ticker;
  - `up` ascending;
  - topic filter ignored;
  - profile of an unknown ticker raises.
- [ ] **Step 6: Commit** `feat(detail): profile, latest movers and theme news filter endpoints`

---

### Task 2: Backend — explain one move

**Files:**
- Modify: `apps/api/services/detail_view.py`, `apps/api/models/schema_parts/detail.py`, `apps/api/routes/detail.py`
- Test: `tests/api/test_detail_move.py`

**Interfaces:**
- Consumes:
  - `profile()` (Task 1);
  - `apps.api.services.risk.store.list_alerts(version, origin, limit)`, `.list_surge(version, shown, theme, limit, ...)` and the `StoredAlert` / `StoredStint` / `StoredCard` / `StoredSurge` shapes;
  - `apps.api.services.risk.rules.get_rules().version`;
  - `apps.api.services.risk.inputs.load_inputs(since=, through=, fetch_fred=False)` and `packages.core_finance.risk_signals.indices.theme_indices(closes, shares, themes, min_members)` for the theme level;
  - `default_registry().events(start, end)` (`routes/market.py`);
  - `MarketDataService.get_stock_ohlcv(ticker, period, table="indices")` for ^GSPC;
  - `apps.api.services.news_feed.history.history_window(d)` and the `news_history_searches` table.
- Produces:
  - `MoveExplanation` with exactly the fields of spec §5.3:
    - `ticker`, `date`
    - `return_pct: float`
    - `price_ratio: float | None`, `volume_ratio: float | None`
    - `market: {ticker, return_pct} | None`
    - `theme: {id, label, return_pct} | None`
    - `peers: list[{ticker, name, return_pct}]`
    - `events: list[{category: str, title: str}]`
    - `alerts: list[{id: int, kind: "risk" | "surge", role: "start" | "ongoing" | "end"}]`
    - `news: {stored: int, searched: bool} | None`
  - `explain_move(ticker: str, day: date) -> MoveExplanation`:
    - **Returns** use the ticker's bar on `day` against its previous bar. `price_ratio` and `volume_ratio` follow the Global Constraints rule (60 and 20 previous bars), and are null when there is too little history.
    - **`market`:** `^GSPC` on the same day against its previous bar. Null if missing, or if the ticker is `^GSPC`.
    - **`theme.return_pct`:** the day-over-day change of the theme's cap-weighted level from `theme_indices`. Null if the theme has no level that day.
    - **`peers`:** the other watchlist tickers with the same `theme` that have bars on `day` and the previous day, sorted ascending by return.
    - **`alerts` (S-D14).**
      - Risk alerts whose window contains `day`. The window is `start_date` .. `release_date`, or open. An alert counts if the ticker's theme is in a stint active on `day`, or if the ticker appears in any card of the alert.
      - Surge events of the ticker's theme whose window contains `day`.
      - `role` is `start` if `day` equals the start, `end` if it equals the release/end, else `ongoing`.
    - **`news`:** `stored` = count of `news` rows with `ticker = T` and `topic = ''` dated within `history_window(day)`. `searched` = a row in `news_history_searches` for `(T, 'en', start, end)` of that window exists. `news` is null when not in the watchlist.
    - **Errors:** 404 when the ticker has no bars at all; 422 when it has no bar on `day`.
  - Route `GET /api/v1/detail/{ticker}/move/{day}`, where `day` is a `date` path param.

- [ ] **Step 1: Write the failing tests** with seeded bars for a 3-ticker theme, ^GSPC in `indices`, one stored alert with a stint and cards, one surge event, an events fixture, news rows and a history-search row:

```python
def test_returns_and_ratios_match_seeded_bars(seed): ...           # exact return_pct, price_ratio, volume_ratio
def test_ratios_null_with_short_history(seed_short): ...
def test_market_and_theme_returns(seed): ...
def test_peers_sorted_and_missing_bar_excluded(seed): ...
def test_alert_roles_start_ongoing_end(seed): ...                   # three days → three roles
def test_alert_unrelated_theme_not_listed(seed): ...
def test_surge_of_own_theme_listed(seed): ...
def test_news_stored_and_searched(seed): ...                        # searched flips after inserting the search row
def test_non_watchlist_instrument_has_nulls_not_404(seed): ...      # /detail/^GSPC/move/{d}: theme None, peers [], news None, market None
def test_404_no_bars_and_422_no_bar_that_day(client, seed): ...
```

- [ ] **Step 2:** Run the tests and confirm they fail.
- [ ] **Step 3:** Implement `explain_move` and the route.
- [ ] **Step 4:** Run `python -m pytest tests/api/test_detail_move.py tests/api/test_detail_view.py -q`. Expected: all pass.
- [ ] **Step 5: Mutation check:**
  - population stdev instead of sample;
  - include the day itself in the 60-bar window;
  - list every open alert regardless of theme;
  - `searched` from any language;
  - a missing `market` returned as 0.
- [ ] **Step 6: Commit** `feat(detail): explain one big move — market, theme, peers, events, alerts, news`

---

### Task 3: Frontend shell — client data, header, tiles, movers, corporate link

**Files:**
- Modify: `apps/web/app/detail/[ticker]/page.tsx` (server page renders `<DetailView ticker=... />` only, no fetch). Rewrite `DetailView.tsx`.
- Create:
  - `apps/web/lib/detail/types.ts`, `apps/web/lib/detail/useDetail.ts`, `apps/web/lib/detail/metrics.ts`
  - `apps/web/components/detail/DetailHeader.tsx`, `TrendTiles.tsx`, `MoversColumn.tsx`
  - `apps/web/tests/e2e/helpers/detailPageMock.ts`, `apps/web/tests/e2e/detail-screen.spec.ts`
- Modify: `apps/web/components/ui/oneScreenRoutes.ts` (add `/detail`), `apps/web/app/corporate/page.tsx` (initial ticker from `?ticker=` before the session value), and i18n `en.ts` / `ko.ts` (`detail.*`).
- Delete:
  - `apps/web/components/workbenches/DCFWorkbench.tsx` and `DiagnosticWorkbench.tsx` (only DetailView imports them; confirm with grep);
  - `apps/web/tests/e2e/dcf-workbench-refusal.spec.ts`.
  - In `apps/web/tests/e2e/blocked-storage.spec.ts`, replace the detail workbench test with "detail page renders when storage throws" against the new page (mocked).

**Interfaces:**
- Consumes: Task 1 endpoints; the existing `GET /detail/{ticker}/ohlcv?period=5y`, `GET /market/index/^GSPC`, `GET /risk/latest`.
- Produces:
  - `useDetailBars(ticker): {bars: Bar[] | undefined, ...}`, where `Bar = {date: string, open, high, low, close, volume: number}`, ascending.
  - `useDetailProfile(ticker)`, `useLatestMovers()`.
  - `metrics.ts`:
    - `trendReturn(bars, n): number | null` (percent);
    - `sma(bars, n): number | null`;
    - `rsi14(bars): number | null` (Wilder);
    - `volumeMultiple(bars): number | null`;
    - `pctFromHigh(bars, n): number | null`;
    - `yesterday(bars): {returnPct, high, low} | null`.
    
    Each returns null when there are too few bars.
  - `detailPageMock.ts`:
    - `export function makeBars(n: number, opts?): Bar[]`, deterministic (seeded), with planted moves on fixed dates.
    - `export async function mockDetailPage(page, ticker, options)`, which mocks ohlcv, profile, movers, the index, risk latest, events, news feed and move.

- [ ] **Step 1: Write failing Playwright tests** in `detail-screen.spec.ts`, mocked, 1280×720:

```ts
test("the detail page fits one screen", ...)                 // noPageScroll helper: no vertical or horizontal scroll
test("header shows name, sector, theme and corporate link", ...)  // link href === "/corporate?ticker=AAPL"
test("tiles show values computed from the bars", ...)        // 1W/1M/6M % and MA/RSI/volume multiple equal the values computed from makeBars in the test file
test("movers list shows five up and five down and navigates", ...)  // click INTC → URL /detail/INTC; current ticker row has aria-current
test("a non-watchlist instrument hides theme and news", ...) // /detail/^GSPC shows detail.notWatchlist; no theme or news column
test("corporate opens on the ticker from the link", ...)     // /corporate?ticker=MSFT → selected ticker MSFT
test("Korean copy", ...)                                     // ko-KR locale: tile and column titles are Korean
```

- [ ] **Step 2:** Run `cd apps/web && npx playwright test tests/e2e/detail-screen.spec.ts --reporter=line` and confirm the failures.
- [ ] **Step 3:** Implement the hooks, metrics, components, the page shell (a grid that fills the viewport like `/alerts`), the corporate `?ticker=` read, the route list and the copy. Keep a placeholder region for the chart and news, which Tasks 4 and 5 fill.
- [ ] **Step 4:** Run the spec plus `npm run lint` and `npx tsc --noEmit -p .`. Expected: pass.
- [ ] **Step 5: Mutation check:**
  - 1M uses 20 bars;
  - simple-average RSI;
  - the movers row does not navigate;
  - the watchlist parts are shown for ^GSPC;
  - corporate ignores `?ticker=`.
- [ ] **Step 6: Commit** `feat(detail): one-screen shell with trend tiles, movers and corporate link`

---

### Task 4: Big-move detection, thresholds and chart marks

**Files:**
- Create: `apps/web/lib/detail/bigMoves.ts`, `apps/web/lib/detail/thresholds.ts`, `apps/web/components/detail/MoveChart.tsx`, `apps/web/components/detail/ThresholdInputs.tsx`, `apps/web/tests/e2e/detail-moves.spec.ts`
- Modify:
  - `apps/web/components/charts/TVChart.tsx`: add optional `markers?: ChartMarker[]` and `onMarkerClick?: (date: string) => void`. Draw with lightweight-charts' `createSeriesMarkers` and hit-test with `chart.subscribeClick`. Markers update in their own effect and must not rebuild the chart; `detail-chart-stability.spec.ts` must keep passing.
  - `apps/web/components/charts/OHLCVChartCard.tsx`: add `eventToggle?: "categories" | "single"` (default `"categories"`, so other callers are unchanged). `"single"` renders one on/off switch instead of the category filter.
  - `DetailView.tsx`: mount `MoveChart`.

**Interfaces:**
- Consumes: `Bar` and `useDetailBars` (Task 3).
- Produces:
  - `BigMove {date: string, returnPct: number, priceRatio: number, volumeRatio: number | null, strong: boolean, up: boolean}`
  - `detectBigMoves(bars: Bar[], thresholds: {price: number, volume: number}, from?: string): BigMove[]`. This is exactly the Global Constraints rule; `from` limits which days are reported while history before it is still used.
  - `ChartMarker {date: string, shape: "hollow" | "filled", up: boolean}`
  - `thresholds.ts`: `readThresholds(): {price, volume}` and `writeThresholds(t): void` (try/catch, key `moneyview.detail.bigMove`, values clamped to the ranges), and `DEFAULT_THRESHOLDS = {price: 2, volume: 2}`.
  - `MoveChart` props: `{bars, selectedDate, onSelect(date | null)}`. Period buttons 6M/1Y/5Y (default 6M).
  - An accessible list (`data-testid="big-move-list"`) of the marked dates as buttons, in the same order as the chart marks, with a visible count (`detail.bigMoveCount`). Tests and keyboard users use this list.

- [ ] **Step 1: Write failing tests** in `detail-moves.spec.ts`. `makeBars` plants moves on known dates, for example 2026-08-10 at +6% with 3× volume and 2026-09-14 at −4% with 1.2× volume.

```ts
test("default thresholds mark the planted days", ...)        // list === ["2026-09-14 (hollow)", "2026-08-10 (filled)"]-equivalent; exact dates and shapes
test("raising the price threshold removes the smaller move", ...)   // price 3 → only 2026-08-10
test("volume threshold 0 makes every mark hollow", ...)
test("thresholds persist across reload", ...)
test("blocked storage uses default thresholds", ...)        // Storage methods throw; page renders; the defaults' marks appear; no pageerror
test("few bars give no marks and no NaN", ...)              // 50 bars: list empty, no "NaN" text anywhere
test("period buttons change the marked range", ...)          // 5Y shows a planted 2022 move that 6M does not
test("the event switch hides and shows event lines", ...)    // single toggle present; the category filter absent on /detail
```

- [ ] **Step 2:** Run the tests and confirm they fail.
- [ ] **Step 3:** Implement `bigMoves.ts`, `thresholds.ts`, the TVChart markers, the OHLCVChartCard `eventToggle` and `MoveChart` with `ThresholdInputs`. Inputs are numeric with step 0.1; they clamp on blur and re-render immediately.
- [ ] **Step 4:** Run `detail-moves.spec.ts`, `detail-screen.spec.ts` and `detail-chart-stability.spec.ts` (update its setup to `mockDetailPage` if it relied on server fetching, keeping its assertion that the chart is not rebuilt). Also run `npm run lint` and `tsc`. Expected: pass.
- [ ] **Step 5: Mutation check:**
  - population stdev;
  - include day t in its own window;
  - `>` instead of `>=`;
  - storage read without try/catch;
  - markers effect that rebuilds the chart (the stability spec must fail).
- [ ] **Step 6: Commit** `feat(detail): adjustable big-move marks on the chart`

---

### Task 5: Explanation card, news column, find-news and alert badge

**Files:**
- Create: `apps/web/components/detail/MoveCard.tsx`, `apps/web/components/detail/DetailNews.tsx`, `apps/web/tests/e2e/detail-card-news.spec.ts`
- Modify: `apps/web/lib/detail/useDetail.ts` (`useMoveExplanation(ticker, date)`, `useDetailNews(ticker, themeId, date | null)`, `useFindNews()` mutation), `DetailHeader.tsx` (badge) and `DetailView.tsx`.

**Interfaces:**
- Consumes:
  - `GET /detail/{ticker}/move/{date}` (Task 2);
  - `GET /news/feed?ticker&from&to` and `?topic=theme:{id}&from&to` (Task 1);
  - `POST /news/history` (④-a; response `NewsHistoryResponse`, status `searched_now | cached | blocked | daily_limit | failed`, `retry_after`);
  - `GET /risk/latest` and `GET /risk/alerts/{id}?cards=all`;
  - `selectedDate` from `MoveChart` (Task 4).
- Produces:
  - **`MoveCard`.** Shows the stock, S&P 500 and theme returns side by side ("—" for null), peer chips (at most 6 shown plus "+N"), events, alerts with kind/role copy, and the news count.
    - When `news.stored == 0 && !news.searched`: a `detail.findNews` button. When `stored == 0 && searched`: `detail.noNewsFound`.
    - Esc or a second click on the same mark closes it.
  - **`DetailNews`.** Two groups, `detail.newsStock` and `detail.newsTheme`.
    - With a date: window ±2 days. Without: latest 20.
    - Each row: headline, source, then `HH:MM` in the viewer's locale when `published_at` is set, else the date only.
  - **Find-news flow.** Button → pending state (`detail.findNewsPending`) → on success, refetch the card and news.
    - `blocked` / `daily_limit` show `detail.findNewsBlocked` with the `retry_after` time.
    - `failed` shows `detail.findNewsFailed`.
  - **Badge (S-D15).** Shown when an open alert exists and the ticker is in that alert's full crash deck (`detail.badgeCrash`) or full candidate deck (`detail.badgeCandidate`).

- [ ] **Step 1: Write failing tests** in `detail-card-news.spec.ts`:

```ts
test("clicking a mark opens the card with market, theme and peers", ...)   // exact numbers from the mocked move response; null theme shows "—"
test("the news column follows the clicked day and groups stock and theme", ...)
test("a row without published_at shows the date, not a time", ...)
test("find-news states", ...)            // button → pending → results; second mock returns zero → noNewsFound; blocked → message with retry time
test("Esc closes the card", ...)
test("badge shows for a ticker ranked 12th in the open alert's crash deck", ...)   // only in ?cards=all, not in latest's top 10
test("no badge without an open alert", ...)
```

- [ ] **Step 2:** Run the tests and confirm they fail.
- [ ] **Step 3:** Implement the card, news, find-news mutation and badge.
- [ ] **Step 4:** Run all `detail-*.spec.ts`, `blocked-storage.spec.ts`, `npm run lint` and `tsc`. Expected: pass.
- [ ] **Step 5: Mutation check:**
  - render a null theme as 0;
  - show "no news" when `searched` is false;
  - badge from `latest` only;
  - print a time for a null `published_at`.
- [ ] **Step 6: Commit** `feat(detail): why-it-moved card, dated news column, find-news and alert badge`

---

### Task 6: Records and gates

**Files:**
- Modify:
  - `docs/architecture/moneyview-api-reference.md`: the three detail endpoints and `/news/feed?topic`.
  - `docs/tabs/index.txt`: add a detail page entry if the index lists pages.
  - `guideline/sop/todo.md` Track R: R-④ (④-b) done, with spec and plan pointers.
  - `DESIGN.md` only if a new token was approved during the work.

- [ ] **Step 1:** Write the records.
- [ ] **Step 2: Full backend gate.** Run `python -m pytest -q`. Expected: only the known 18 environment failures (market events, regime, events/test_rules, records_sync). Report any other failure by name.
- [ ] **Step 3: Full Playwright gate.** Run `cd apps/web && npx playwright test --reporter=line`. Expected: no failures. Afterwards, check nothing is left listening on 3101/8110.
- [ ] **Step 4: Commit** `docs(detail): records for the stock detail screen`
