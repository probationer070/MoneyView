# Market Overview Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` shows 14 instruments (adding semiconductors, cloud, AI and the US 10-year yield). Each instrument shows its 1-day and its 1-month change, in the cards and in the table, on one 1280×720 screen.

**Architecture:**
- **Backend:**
  - `MARKET_INDICES` grows to 14 entries, in display order.
  - A pure function, `month_delta(bars)`, computes the new `IndexQuote.month_delta` from the 5-year bars already cached.
  - The regime builder reads only the tickers it scores (`REGIME_TICKERS`).
- **Frontend:**
  - Pure logic goes in `components/market/marketModel.ts`: `changeFigure`, `formatBp`, `instrumentNameKey`. It is tested as a Playwright model spec, like `market-model.spec.ts`.
  - `InstrumentsPanel` and `SparklineCard` render the figures:
    - cards in 7 columns from `xl`;
    - the table as two halves of 7 rows.
  - The detail modal gains the `sector` and `rate` types.

**Tech Stack:** FastAPI + pydantic + pytest. Next.js 16 app router, React 19, Tailwind 4 with the paper tokens, Playwright, and the en/ko catalogs in `apps/web/lib/i18n/messages/{en,ko}.ts`.

**Spec:** `docs/superpowers/specs/2026-10-16-market-overview-expansion-design.md`. The owner approved it on 2026-10-16 ("추천대로"). Read it with this plan. All paths below are relative to the repo root.

**Branch:** `feat/market-overview-expansion` from `renewal` at b833b21.

**Model routing** (HARNESS; Opus 5.5 is the controller and the final reviewer):

| Task | Implementer | Reviewer | Notes |
|---|---|---|---|
| 0 Owner gate: existing-test inventory | controller | — | the owner approves the table below |
| 1 `month_delta` + `IndexQuote.month_delta` | Haiku | Sonnet | pytest only |
| 2 Instrument list, metadata, `REGIME_TICKERS` | Haiku | Sonnet | pytest only; approved edits 1–3 |
| 3 Frontend model + catalog names | Haiku | Sonnet | model spec, no page |
| 4 Instruments panel: cards, table, subtitle | Sonnet | Sonnet | fit tuning against the 503px panel; approved edits 4–7 |
| 5 Detail modal: `sector` and `rate` | Haiku | Sonnet | |
| 6 Gates, capture, records | controller | Opus final review | |

Tasks 1 and 2 are backend-only and run under pytest, so they may run in parallel with Task 3. Playwright is one run at a time (ports 3101/8110).

## Global Constraints

- The regime label, its counts and its rules do not change (spec §1.6, §3). `EQUITY_INDEX_TICKERS` is unchanged.
- `SPREAD_PAIRS`, the Spreads tab and `DeltaBadge.compute` are unchanged.
- Order and tickers are exactly spec §1.1:
  `^GSPC, ^DJI, ^IXIC, ^KS200, SOXX, SKYY, BOTZ, ^TNX, GC=F, CL=F, NG=F, KRW=X, BTC-USD, ^VIX`.
- 1-month anchor (spec §1.3):
  - Take the last bar's date minus one calendar month, with the day clamped to the month's last day.
  - The base is the latest bar dated on or before the anchor that has a close.
  - With no such bar, the result is `None`/`null`.
- Rate display (spec §1.4):
  - The value prints as `4.12%` (2 decimals).
  - A change prints as `round(delta_abs × 100)` with a sign and `bp`: `+10bp`, `-3bp`, `0bp` (never `-0bp`).
  - A rate never shows a % change.
- A missing figure prints `—` (`MISSING` in `lib/format.ts`).
- All new visible copy goes in both `en.ts` and `ko.ts`. No raw colours or sizes (CLAUDE.md §10). Figures use a mono style.
- One-screen at 1280×720 and 390×844: there is no page scroll, and the panel takes any overflow.
- Tests never write the real DB `data/processed/moneyview.db`.
- Every new test is mutation-checked (CLAUDE.md §8). Each task's report names the mutation and the failing assertion.

## Review Focus

1. **A new or short-history instrument** has `month_delta: null`. It must render `—`, never `0.0%` or `+0bp`. Pinned in Task 1 (pytest) and Task 3 (`changeFigure`).
2. **A rate whose `delta_abs` is null** must read `—`, not `0bp`. Pinned in Task 3.
3. **A tiny negative yield move** (`-0.004`) must read `0bp`, not `-0bp`. Pinned in Task 3.
4. **An `instrument_type` the frontend does not know** (a future type) must fall back to the % figure and the index modal, not crash. Pinned in Task 3 (`changeFigure`) and Task 5 (`normalizeInstrumentType`).
5. **Month-end anchors:**
   - 2026-03-31 must anchor to 2026-02-28, and 2024-03-31 to 2024-02-29.
   - An anchor on a holiday takes the bar before it, never the one after.
   - Pinned in Task 1.

## Existing-test inventory (Task 0, owner approval required)

Checked at b833b21. The assertions' intent does not change; only the subject or the expected string does.

| # | File:line | Old | New | Why |
|---|---|---|---|---|
| 1 | `tests/api/test_market_regime_route.py:71` | `requested` == one `(t, "1mo", "indices")` per `MARKET_INDICES` ticker | the same, per `REGIME_TICKERS` ticker | E-D7: the regime reads only the tickers it scores |
| 2 | `tests/api/test_market_spreads.py:134` | `("BOTZ", "stocks") in stub.requested` | `("CIBR", "stocks") in stub.requested` and `("BOTZ", "indices") in stub.requested` | BOTZ joins `MARKET_INDICES`, so it routes to `indices`. CIBR keeps the "a numerator is read from stocks" intent. |
| 3 | `tests/api/test_background_refresh.py:50-130` (BOTZ ×12) | ticker `"BOTZ"` | ticker `"CIBR"`, **only if** these fail after Task 2 | The tests are about refresh mechanics on a stock ticker. BOTZ stops being a stock ticker. |
| 4 | `apps/web/tests/e2e/market-one-screen.spec.ts:187`, `:191` | `Daily closes · indices, commodities, FX, crypto` / `일별 종가 · 지수, 원자재, 환율, 암호화폐` | `Daily closes · indices, sectors, rates, commodities, FX, crypto` / `일별 종가 · 지수, 섹터, 금리, 원자재, 환율, 암호화폐` | the spec §2.3 subtitle |
| 5 | `apps/web/tests/e2e/market-overview.spec.ts:13` | the old en subtitle | the new en subtitle | same |
| 6 | `apps/web/tests/e2e/market-overview.live.spec.ts:7` | the old en subtitle | the new en subtitle | same |
| 7 | `apps/web/tests/e2e/market-one-screen.spec.ts:337` | `table.getByRole("columnheader")` count 4 | `table.locator("table")` count 2, and `table.locator("table").first().getByRole("columnheader")` count 4 | The table becomes two halves (spec §2.2). Each half still has the 4 columns Instrument / Price / 1D / 1M. |

No other spec asserts the card count, the five-column grid or the "Abs change" header (searched at b833b21). If an implementer finds one, they stop and add it here for approval.

---

### Task 0: Owner gate

- [ ] **Step 1:** Show the owner the inventory table above. Record "approved" with the date in `.superpowers/sdd/market-overview-expansion/progress.md`. Do not edit any listed test before this.

### Task 1: `month_delta` and `IndexQuote.month_delta`

**Files:**
- Modify: `apps/api/services/market_data.py` (new module-level function near `DeltaBadge` usage; `get_all_indices` at ~1235)
- Modify: `apps/api/models/schema_parts/market.py:73-82`
- Test: `tests/api/test_market_month_delta.py` (new)

**Interfaces:**
- Produces:
  - `month_delta(bars: list[StockOHLCV]) -> DeltaBadge | None` in `apps/api.services.market_data`. It is pure. `bars` are ascending by date. A `date` is an ISO string, and only its first 10 characters are read.
  - `IndexQuote.month_delta: Optional[DeltaBadge] = None`.

- [ ] **Step 1: Write the failing tests** in `tests/api/test_market_month_delta.py`, with bars built as `StockOHLCV(date=..., open=c, high=c, low=c, close=c, volume=1)`:
  - `test_base_is_the_close_one_calendar_month_earlier`: last bar 2026-10-15 (close 110), a bar on 2026-09-15 (close 100), bars before and after it. Expect `delta_pct == 10.0` and `prev_value == 100`.
  - `test_a_holiday_anchor_takes_the_bar_before_not_after`: no bar on 2026-09-15; bars on 09-14 (close 100) and 09-16 (close 200). Expect `prev_value == 100`.
  - `test_month_end_clamps_to_the_last_day_of_the_shorter_month`: last 2026-03-31, a bar on 2026-02-28 (100) and one on 2026-03-02 (300). Expect `prev_value == 100`. The same for 2024-03-31 → 2024-02-29.
  - `test_less_than_a_month_of_history_is_none`: bars 2026-09-20..2026-10-15 only. Expect `None`.
  - `test_a_base_bar_without_a_close_is_skipped`: 09-15 has `close=None` and 09-14 has 100. Expect `prev_value == 100`.
  - `test_get_all_indices_sends_month_delta`: monkeypatch `MarketDataService.get_stock_ohlcv` to return the first test's bars for every ticker. Expect every quote's `month_delta.delta_pct == 10.0`.
- [ ] **Step 2:** Run `python -m pytest tests/api/test_market_month_delta.py -q`. Expect FAIL (an ImportError on `month_delta`).
- [ ] **Step 3:** Implement `month_delta`.
  - Anchor: subtract one month, and clamp the day with `calendar.monthrange`.
  - Walk the bars from the end.
  - Return `DeltaBadge.compute(last_close, base_close)`.
  - Add the field to `IndexQuote`, and set `month_delta=month_delta(bars)` in `get_all_indices`.
- [ ] **Step 4:** Run the same command. Expect PASS. Then run `python -m pytest tests/api/test_nonfinite_json_boundary.py tests/api/test_market_index_detail.py -q`. Expect PASS.
- [ ] **Step 5:** Mutation check. Apply these mutations one at a time and record which test fails:
  - the base taken as `bars[-22]`;
  - the first bar after the anchor;
  - no clamp;
  - the oldest bar as the fallback.

  Restore the source after each one.
- [ ] **Step 6:** Commit: `feat(api): 1-month change on market index quotes`.

### Task 2: 14 instruments, their metadata, and `REGIME_TICKERS`

**Files:**
- Modify: `apps/api/services/market_data.py:76-112` (`MARKET_INDICES`, `INSTRUMENT_METADATA`, `EQUITY_INDEX_TICKERS` stays, `INDEX_DB_ALIASES`) and `_build_market_regime_context` (~983)
- Modify (approved edits 1–3): `tests/api/test_market_regime_route.py:71`, `tests/api/test_market_spreads.py:134`, `tests/api/test_background_refresh.py` (if failing)
- Test: `tests/api/test_market_instruments.py` (new)

**Interfaces:**
- Consumes: Task 1's `month_delta`. The order is not needed.
- Produces:
  - `REGIME_TICKERS: tuple[str, ...] = EQUITY_INDEX_TICKERS + ("GC=F", "KRW=X", "BTC-USD")`, at module level in `market_data.py`.
  - `INSTRUMENT_METADATA` entries:
    - `"SOXX"`, `"SKYY"`, `"BOTZ"`: `{"instrument_type": "sector", "unit_label": "USD per share"}`;
    - `"^TNX"`: `{"instrument_type": "rate", "unit_label": "percent yield"}`.

- [ ] **Step 1: Write the failing tests** in `tests/api/test_market_instruments.py`:
  - `test_the_overview_lists_fourteen_instruments_in_display_order`: `list(MARKET_INDICES.values())` equals the Global Constraints order, and the names for the new four are `"Semiconductors"`, `"Cloud"`, `"AI"`, `"US 10Y Yield"`.
  - `test_new_instruments_carry_their_type_and_unit`: `_instrument_metadata_for_ticker` gives `sector`/`USD per share` for the three ETFs and `rate`/`percent yield` for `^TNX`.
  - `test_the_regime_reads_only_the_tickers_it_scores`: stub `get_stock_ohlcv` (like `_stub_bars` in `test_market_regime_route.py`) and record the calls. The set of requested tickers equals `set(REGIME_TICKERS)`.
  - `test_new_instruments_do_not_move_the_regime`: build the regime with `RISK_ON`-style deltas. Then add +50% deltas for SOXX/SKYY/BOTZ/^TNX and build it again. Both responses are equal.
  - `test_sector_etfs_are_not_equity_indices`: `{"SOXX", "SKYY", "BOTZ"}.isdisjoint(EQUITY_INDEX_TICKERS)`.
- [ ] **Step 2:** Run `python -m pytest tests/api/test_market_instruments.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement the dict changes in spec §1.1 order. `INDEX_DB_ALIASES` gets `"SOXX": ["SOXX"]` and so on. Add `REGIME_TICKERS`, and make the regime loop iterate `(name, ticker)` over `MARKET_INDICES.items()` filtered to `REGIME_TICKERS`, keeping the name lookup.
- [ ] **Step 4:** Apply approved edits 1 and 2. Run `python -m pytest tests/api/test_market_instruments.py tests/api/test_market_regime_route.py tests/api/test_market_regime_mutations.py tests/api/test_market_spreads.py tests/api/test_background_refresh.py tests/api/test_market_month_delta.py -q`. Expect PASS, except the 2 known environmental regime-mutation failures (the route count on this PC; see memory, baseline). If `test_background_refresh.py` fails because BOTZ now routes to `indices`, apply edit 3 and re-run.
- [ ] **Step 5:** Mutation check, one at a time:
  - add `"SOXX"` to `EQUITY_INDEX_TICKERS`;
  - make the regime loop iterate all of `MARKET_INDICES`;
  - swap SOXX and SKYY in the dict;
  - drop the `^TNX` metadata.
- [ ] **Step 6:** Run `python scripts/seed_e2e_market_cache.py` against a temp `DB_PATH` (scratchpad) and confirm 14 tickers in `indices`. The seed iterates `MARKET_INDICES`, so it needs no edit.
- [ ] **Step 7:** Commit: `feat(api): sectors and the US 10Y yield on the market overview; regime reads only scored tickers`.

### Task 3: Frontend model: change figures, bp, instrument names

**Files:**
- Modify: `apps/web/components/market/marketModel.ts`
- Modify: `apps/web/lib/i18n/messages/en.ts`, `ko.ts` (the `market` namespace)
- Test: `apps/web/tests/e2e/market-model.spec.ts` (append; pure functions, no page)

**Interfaces:**
- Produces (all in `marketModel.ts`):
  - `MarketIndexQuote` gains `month_delta?: { delta_pct: number; delta_abs?: number | null } | null`.
  - `type ChangeFigure = { kind: "pct"; pct: number } | { kind: "bp"; bp: number } | { kind: "missing" }`.
  - `changeFigure(delta: { delta_pct: number; delta_abs?: number | null } | null | undefined, instrumentType: string | undefined): ChangeFigure`:
    - with `delta` null or undefined → `missing`;
    - with `instrumentType === "rate"`: if `delta_abs` is a finite number → `bp` = `Math.round(delta_abs * 100)` normalised so `-0` is `0`; otherwise → `missing`;
    - any other type, an unknown one included: if `delta_pct` is finite → `pct`; otherwise → `missing`.
  - `formatBp(bp: number): string`: `10` → `"+10bp"`, `-3` → `"-3bp"`, `0` → `"0bp"`.
  - `instrumentNameKey(ticker: string): MessageKey | null`. It maps each §1.1 ticker to `market.names.<id>`, where the ids are `sp500, dow, nasdaq, kospi200, semis, cloud, ai, us10y, gold, wti, natgas, usdkrw, bitcoin, vix`. An unknown ticker gives `null`, and the caller then shows the API name.
- Catalog (exact). en values equal the API names. ko values:

| id | en | ko |
|---|---|---|
| sp500 | S&P 500 | S&P 500 |
| dow | Dow Jones | 다우존스 |
| nasdaq | Nasdaq | 나스닥 |
| kospi200 | KOSPI 200 | KOSPI 200 |
| semis | Semiconductors | 반도체 |
| cloud | Cloud | 클라우드 |
| ai | AI | AI |
| us10y | US 10Y Yield | 미 10년물 금리 |
| gold | Gold | 금 |
| wti | Oil (WTI) | 원유(WTI) |
| natgas | Natural Gas | 천연가스 |
| usdkrw | USD/KRW | 원/달러 |
| bitcoin | Bitcoin | 비트코인 |
| vix | Volatility (VIX) | 변동성(VIX) |

  Also add `market.change.day` ("1D" / "1일") and `market.change.month` ("1M" / "1개월"). Change `market.subtitle` to the spec §2.3 strings.

- [ ] **Step 1: Write the failing tests**, appended to `market-model.spec.ts`:
  - `changeFigure` cases:

    | Input | Expected |
    |---|---|
    | `({delta_pct: 1.24, delta_abs: 3}, "index")` | `{kind:"pct", pct:1.24}` |
    | `(null, "index")` | `{kind:"missing"}` |
    | `({delta_pct: 2.5, delta_abs: 0.1}, "rate")` | `{kind:"bp", bp:10}` |
    | `({delta_pct: -1, delta_abs: -0.004}, "rate")` | `{kind:"bp", bp:0}`, with `Object.is(bp, 0)` |
    | `({delta_pct: 1, delta_abs: null}, "rate")` | `{kind:"missing"}` |
    | `({delta_pct: 1.5}, "future_type")` | `{kind:"pct", pct:1.5}` |
    | `({delta_pct: NaN}, "index")` | `{kind:"missing"}` |

  - `formatBp(10) === "+10bp"`, `formatBp(-3) === "-3bp"`, `formatBp(0) === "0bp"`.
  - `instrumentNameKey("SOXX") === "market.names.semis"`, `instrumentNameKey("^TNX") === "market.names.us10y"`, `instrumentNameKey("XYZ") === null`.
  - Every one of the 14 tickers maps to a key, and the 14 keys are distinct.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/market-model.spec.ts` from `apps/web`. Expect FAIL (an import error).
- [ ] **Step 3:** Implement the functions and the catalog entries.
- [ ] **Step 4:** Run the same command, then `npm run typecheck` and `npm run lint`. Expect PASS and 0 errors.
- [ ] **Step 5:** Mutation check: the rate case returning pct, `-0` not normalised, the null delta mapped to `pct: 0`, the unknown type mapped to missing.
- [ ] **Step 6:** Commit: `feat(web): market change figures, bp format and catalog instrument names`.

### Task 4: Instruments panel: 7-column cards, two-half table, subtitle

**Files:**
- Modify: `apps/web/components/data/SparklineCard.tsx`
- Modify: `apps/web/components/market/InstrumentsPanel.tsx`
- Create: `apps/web/components/market/ChangeFigureText.tsx`
- Modify: `apps/web/lib/i18n/labels.ts` (add `change1d: ["1일", "1D"]`, `change1m: ["1개월", "1M"]`; remove `absChange`, which this task leaves unused)
- Modify (approved edits 4–7): `market-one-screen.spec.ts:187,191,337`, `market-overview.spec.ts:13`, `market-overview.live.spec.ts:7`
- Test: `apps/web/tests/e2e/market-overview-expansion.spec.ts` (new)

**Interfaces:**
- Consumes: Task 3's `changeFigure`, `formatBp`, `instrumentNameKey`, and `MarketIndexQuote.month_delta`.
- Produces:
  - `ChangeFigureText({ figure }: { figure: ChangeFigure }): JSX.Element`. It renders:
    - `pct` → `<DeltaBadge value={pct} />`;
    - `bp` → a `type-mono` span with `data-testid="change-bp"`, the up/down/flat tone by sign, and the `formatBp` text;
    - `missing` → a `type-mono` span `—` in muted ink.
  - New `SparklineCard` props: `day: ChangeFigure`, `month: ChangeFigure`, replacing `deltaPct`. The `value` string is still formatted by the caller. Each change renders as `<span data-testid="change-1d">` / `change-1m`, containing the catalog label and a `ChangeFigureText`.
- Rendering rules:
  - **Card layout:** stacked, top to bottom: title (truncate), `ticker · period`, value, the 1D/1M row, then the sparkline. The sparkline is the flex-1 item, minimum 24px. Keep the `article` and the `aria-label` from `market.card.open`.
  - **Display name:** `t(instrumentNameKey(ticker))`, or `quote.name` when the key is null. It is used in the card title, the table and the aria-labels.
  - **Rate value:** `formatNumber(last_close / 100, "percent", { digits: 2, locale })`. Other values keep `formatNumber(…, "price", { digits: 1, locale })`.
  - **Grid:** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7`.
  - **Table:** `data-testid="market-table"` wraps `grid gap-3 xl:grid-cols-2` holding two `<table>`s, built from quotes 0–6 and 7–13 (`indices.slice(0, 7)`, `slice(7)`). The columns are Instrument (name + ticker), Price, `change1d`, `change1m`. The cells use `ChangeFigureText`. The `printedSign`/`SIGN_TONE` helpers move into `ChangeFigureText` for the bp tone, or are deleted if unused.

- [ ] **Step 1: Write the failing tests** in `market-overview-expansion.spec.ts`. Use `mockMarketPageApi` for the client requests. The cards are SSR from the seeded e2e API, so read the expected figures with `request.get("http://127.0.0.1:8110/api/v1/market/indices")`.
  - `every card shows a 1D and a 1M figure matching the API`: for each quote, the card's `change-1d` and `change-1m` text equal what `changeFigure` + `formatBp`/the DeltaBadge percent text produce for that quote. Assert on at least `^GSPC`, `SOXX` and `^TNX`.
  - `the rate card reads bp and never a percent change`: the `^TNX` card's `change-1d` matches `/^1D\s*[+-]?\d+bp$/`, and neither change cell contains `%`. The value ends in `%`.
  - `at 1280x720 the cards are two rows of seven`: there are 14 `article`s. Cards 0–6 share one `y`, cards 7–13 share another, and the last card and the spread figures end at or above the panel bottom (reuse `expectEndsBy` from `market-one-screen.spec.ts`, or copy the 6-line helper).
  - `the table is two halves of seven with the 1M column`: two tables, 7 body rows each. The headers include `1D` and `1M`.
  - `Korean names and labels`: under `test.use({ locale: "ko-KR" })`, the texts `반도체`, `미 10년물 금리` and `1개월` are visible.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/market-overview-expansion.spec.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. Apply the approved edits 4–7.
- [ ] **Step 4:** Run the area specs: `npx playwright test market-overview-expansion market-one-screen market-overview market-model market-spreads one-screen-no-scroll design-capture responsive-accessibility event-filter events-page`. Then run `npm run typecheck`, `npm run lint` and `npm run design:baseline`. Expect PASS, 0 errors, and baseline total 0. `labels.ts` and `SparklineCard` are not on the shared-surface list. If `lib/format.ts` was touched, run the full suite.
- [ ] **Step 5:** Mutation check, one at a time:
  - 1M rendered from `delta`;
  - the rate rendered with `DeltaBadge`;
  - `xl:grid-cols-5`;
  - the table as one table;
  - an English label hard-coded.
- [ ] **Step 6:** Commit: `feat(web): 14 instruments with 1D and 1M change; 7-column cards, two-half table`.

### Task 5: Detail modal: the `sector` and `rate` types

**Files:**
- Modify: `apps/web/components/market/MarketOverviewClient.tsx:99-200` (`InstrumentType`, `instrumentLabel`, `normalizeInstrumentType`, `buildInstrumentContext`), `:215-264` (`INDICATOR_KEYS`), `:388` (warnings)
- Modify: `en.ts`, `ko.ts` (the `market.detail` namespace)
- Test: append to `apps/web/tests/e2e/market-overview.spec.ts`

**Interfaces:**
- `InstrumentType = "index" | "commodity" | "fx" | "crypto" | "sector" | "rate"`. `normalizeInstrumentType` passes the two new values through; anything unknown is still `"index"`.
- `INDICATOR_KEYS.sector` and `INDICATOR_KEYS.rate` are the same object as `INDICATOR_KEYS.index`. Hoist it to a `const INDEX_INDICATOR_KEYS`.
- Catalog (exact). The fourth bullet of both new types reuses `market.detail.context.index.daily`.

| Key | en | ko |
|---|---|---|
| `detail.instrument.sector` | Sector ETF | 섹터 ETF |
| `detail.instrument.rate` | Rate | 금리 |
| `detail.context.sector.title` | Sector Context | 섹터 맥락 |
| `detail.context.sector.description` | A sector card prices one ETF that stands in for the theme. Read its move as the theme's, not as one company's. | 섹터 카드는 그 테마를 대신하는 ETF 하나의 가격입니다. 한 기업이 아니라 테마의 움직임으로 읽습니다. |
| `detail.context.sector.proxy` | Proxy: {ticker} is the ETF that stands in for this sector. | 대리 종목: {ticker}는 이 섹터를 대신하는 ETF입니다. |
| `detail.context.sector.up` | Directional move: the sector is advancing in the current snapshot. | 방향성: 현재 스냅샷에서 섹터가 오르고 있습니다. |
| `detail.context.sector.down` | Directional move: the sector is declining in the current snapshot. | 방향성: 현재 스냅샷에서 섹터가 내리고 있습니다. |
| `detail.context.sector.interpretation` | Interpretation: compare with the S&P 500 card or the Spreads tab before reading the move as sector strength. | 해석: 섹터 강세로 읽기 전에 S&P 500 카드나 스프레드 탭과 비교하십시오. |
| `detail.context.rate.title` | Rate Context | 금리 맥락 |
| `detail.context.rate.description` | The value is a yield in percent. Changes read in basis points: 4.00% to 4.10% is +10bp. | 값은 퍼센트 단위의 수익률입니다. 변화는 bp로 읽습니다. 4.00%에서 4.10%로 오르면 +10bp입니다. |
| `detail.context.rate.reference` | Benchmark: the US 10-year Treasury yield, a base rate for discounting and for borrowing costs. | 기준: 미국 10년물 국채 수익률로, 할인율과 차입 비용의 기준 금리입니다. |
| `detail.context.rate.up` | Directional move: yields are rising, so bond prices are falling. | 방향성: 수익률이 올라 채권 가격은 내리고 있습니다. |
| `detail.context.rate.down` | Directional move: yields are falling, so bond prices are rising. | 방향성: 수익률이 내려 채권 가격은 오르고 있습니다. |
| `detail.warnings.rateVolume` | Daily volume is not provided for this yield, so volume metrics are shown as unavailable. | 이 수익률은 일별 거래량이 제공되지 않아 거래량 지표를 사용 불가로 표시합니다. |

- `buildInstrumentContext` needs the ticker for `proxy`. Add an `item.ticker` parameter.
- The `rateVolume` warning has the same condition as `fxVolume`, with `"rate"` in place of `"fx"`.

- [ ] **Step 1: Write the failing test** `market overview detail uses sector and rate copy`. Register a `page.route` for `**/market/index/SOXX/detail` and `**/market/index/%5ETNX/detail` (also match the raw `^TNX`). Each returns `{ ...marketIndexDetailFixture["^GSPC"], ticker, instrument_type, unit_label, market_regime: null }`. For `^TNX`, also set `volume_summary.latest_volume: 0`.
  - SOXX: the dialog shows the heading "Sector Context", the text "Proxy: SOXX is the ETF that stands in for this sector." and a subtitle containing "Sector ETF".
  - ^TNX: the dialog shows "Rate Context", a subtitle containing "Rate", and the `rateVolume` warning text.
  - The cards' aria-labels use the display names: "Open detail for Semiconductors", "Open detail for US 10Y Yield".
- [ ] **Step 2:** Run it. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx playwright test market-overview market-one-screen`, `npm run typecheck`, `npm run lint`. Expect PASS.
- [ ] **Step 5:** Mutation check: `normalizeInstrumentType` without `sector`, the warning condition left on `"fx"` only.
- [ ] **Step 6:** Commit: `feat(web): sector and rate context in the market detail modal`.

### Task 6: Gates, capture, records

- [ ] **Step 1: Full gates.**
  - pytest (`python -m pytest -q`). Expect the baseline of 18 environmental failures, and no new ones.
  - `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run design:baseline` (total 0).
  - The full Playwright suite. Run it in chunks if needed, one run at a time.
- [ ] **Step 2: Capture.** Run the design capture at 1280×720 for `/` (cards and table) and compare it with the market-one-screen capture. The controller looks at the screenshots and writes a verdict per screen in the ledger.
- [ ] **Step 3: Controller check.** Re-run one Task 1 and one Task 4 mutation yourself and record the failing assertion.
- [ ] **Step 4: Records.**
  - In `guideline/sop/todo.md` Track D, add a line for this plan with its status and gates.
  - In `docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md:2016`, replace `lg:grid-cols-5` / `1 / 2 / 5 columns at 375 / 768 / 1280` with `xl:grid-cols-7` / `1 / 2 / 7 columns at 375 / 768 / 1280`.
  - In `docs/architecture/moneyview-api-reference.md`, add `month_delta` to the `/market/indices` row and the two new `instrument_type` values.
  - Update the memory.
- [ ] **Step 5: Final review** (Opus) of the whole branch against the spec. Then the owner looks at the captures (HARNESS stage 8).
