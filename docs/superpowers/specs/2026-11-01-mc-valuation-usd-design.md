# Simulation Lab, Corporate Valuation tab: dollars instead of won

Date: 2026-11-01 · Owner: probationer070 · Path: full (bug fix + display unit change; touches an existing owner decision, D8)

## 1. Intent and the bug

The owner finds the valuation tab hard to use because the current price is in won. It is worse
than inconvenient: the price lookup (`GET /api/v1/stock/{ticker}/price`) returns the ticker's own
quote, which is **dollars** for every ticker in the universe (no `.KS`/`.KQ` tickers exist in
`data/` or `config/`). `page.tsx:390` then stores `Math.round(data.price)`, and the tab labels it 원.
A $187.42 quote becomes "187원": the unit is wrong and the cents are gone. This gets an
`ERROR-LOG.md` entry.

## 2. Decisions (owner, 2026-11-01)

| Decision | Choice |
|---|---|
| Scope | Corporate Valuation tab only. Path, Distribution and Risk stay in won (`formatKrwCompact`, untouched). |
| D8 (2026-10-17, per-share `krw()`) | Superseded for this tab: per-share values are dollars. |

My calls (owner may override when reading):

| Call | Choice | Why |
|---|---|---|
| Format | `$187.42` in both locales, `-$5.00` for negatives, range `$170.10–$205.30` | the form US quotes are read in, in Korean UIs too |
| Precision | 2 decimals everywhere: inputs, figures, statistics, tooltip | cents matter at a $5 stock |
| Defaults | ticker `SAMPLE`, current price `50.00`, EPS `3.50` | same P/E (14.3) and ratios as today's 50,000 / 3,500, so the default run's shape is unchanged |
| Input unit suffix | `USD` (ko and en) | |

## 3. Changes

1. **`lib/usdFormat.ts`** (new, beside `krwFormat.ts`):
   `usd(value: number, locale): string` and `formatUsdRange(lo: number|null, hi: number|null, locale): string`,
   built on `formatNumber(abs, "price", { locale })` (2 digits). Not finite → `—`. A value that rounds to
   0.00 prints `$0.00`, never `-$0.00`.
2. **`CorporateValuationSection.tsx`**: every `krw(` → `usd(`, `formatKrwRange` → `formatUsdRange`;
   both suffixes `t("monteCarlo.units.krw")` → `t("monteCarlo.units.usd")`; current price input `step="0.01"`;
   EPS `NumericField` `step={0.01} min={0.01}` (was `step={50} min={100}`, won-sized).
3. **`page.tsx:390`**: `Math.round(data.price ?? …)` → round to cents (`Math.round(p * 100) / 100`).
   Defaults per §2.
4. **`valuation-core.ts:63`**: `Math.max(input.baseEps, 1)` is a won-era guard; in dollars it silently
   rewrites the P/E of any stock with EPS below $1. Replace with `Math.max(input.baseEps, 0.01)`.
   EPS ≤ 0 was and is outside the model (the input's `min` blocks it); not addressed here.
5. **`krw()` and `formatKrwRange()`** become unused (only this tab called them). Per CLAUDE.md §3 they are
   removed with their tests, which needs the owner's approval of the inventory below.
6. i18n: `monteCarlo.units.usd` = `USD` (ko, en). Any valuation hint text that says 원 is updated.
7. CSV export rows for valuation (if any carry a `_krw` metric name) are renamed `_usd`.
8. `docs/tabs/monte-carlo-tab.txt`: valuation tab is in dollars; Path/Risk in won.

## 4. Output contract

| name | signature | returns | cases | example |
|---|---|---|---|---|
| `usd` | `(value: number, locale: FormatLocale) => string` | string | normal `$187.42`; negative `-$5.00`; rounds to zero `$0.00`; NaN/±Inf `—`; never throws | `usd(187.415, "ko")` → `$187.42` |
| `formatUsdRange` | `(lo, hi, locale) => string` | string | normal `$170.10–$205.30`; either side null/not finite `—`; each end keeps its sign `-$5.00–$3.00` | `formatUsdRange(41.2, 58.9, "en")` → `$41.20–$58.90` |
| price lookup apply | `page.tsx` effect | `currentPrice` set to cents | price null: keeps current | 187.4231 → 187.42 |

## 5. Tests

New: `usd`/`formatUsdRange` cases above in `monte-carlo-model.spec.ts`; a page test where the mocked
lookup returns `187.42` and the current-price input then reads `187.42` and the statistics show `$`;
a model test that EPS `0.5`, price `10` gives base P/E 20 (fails under the old floor of 1 → P/E 10).

Mutations: drop the cents rounding (→ `Math.round`): the lookup test fails; restore the EPS floor of 1:
the P/E test fails; `usd` without the minus-zero guard: the `$0.00` case fails.

### Existing-test change inventory (needs owner approval)

| # | File | Old | New | Why |
|---|---|---|---|---|
| 1 | `tests/e2e/monte-carlo-model.spec.ts:149-187` | `describe("krw and formatKrwRange")`, 5 tests | removed; replaced by the `usd` tests | functions removed, unused after the change |
| 2 | `tests/e2e/monte-carlo-model.spec.ts:6` | imports `krw, formatKrwRange` | imports drop them | same |
| 3+ | any valuation-tab spec found at implementation that asserts `원`/`KRW` on a per-share figure | — | `$` form | unit change; implementation lists each row before editing |

Run: `monte-carlo-*.spec.ts`, `one-screen-no-scroll` (the lab is a one-screen route; wider `$` figures must
still fit), `readme-capture`, `typecheck`, `lint`.

## Approval

Approved by the owner on 2026-11-02 ("1~3번 승인"), including the existing-test changes this spec lists.
