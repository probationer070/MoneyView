# FX conversion for currency_mismatch tickers (design draft, HARNESS stage 1)

Status: draft for owner review. Read-only research 2026-11-16; nothing run, nothing edited.
Rule base: finance-logic.md ("explicit assumptions for currency", "currency and FX policy", "missing data", tests must cover "currency mismatches"). Style follows `2026-11-16-wacc-ke-live-premia-design.md` (reuse `market_assumptions` and `fred_cache`).

## 1. Inventory

### 1.1 Where the refusal is decided
| Where | What |
|---|---|
| `corporate_statement_metrics.py:705-722` `statement_currency_mismatch(ticker)` | the one check: `info.financialCurrency` vs `info.currency` from the stored bundle; returns a reason string or None (None also when the bundle or either field is missing) |
| `corporate_dcf.py:177-178` (bulk loop), `:226-228` (`_build_dcf_outputs`) | `EngineRefusal("currency_mismatch", reason)` before anything is valued |
| `corporate_comparison.py:402` (param), `:427-432`, `:465` | row: `dcf_refusal` and `ImpliedReturn.refusal = "currency_mismatch"`, no value |
| `relative_pricing.py:156,165-167` | `RelativePricingRefused("currency_mismatch: ...")` |
| `fair_value.py:78-83` | own inline copy of the same test (does not call the shared function) |
| `routes/corporate.py:348,372,408,436` | inject `statement_currency_mismatch` for single, report, bulk, stream DCF |
| Frontend | `RelativePricingCard.tsx:30`, `lib/i18n/messages/{en,ko}.ts` (en 238, 929; ko 241, 932), `lib/dcfRefusal.ts`, `corporate/page.tsx` |

### 1.2 Reporting vs trading currency
- Reporting currency (statements stored verbatim, scaled to billions in `equity_bridge.py`): revenue, operating income, tax, FCFF (`metrics.fcff`), total/net debt, cash, investments (the bridge, `equity_bridge.py:170-187`), invested capital, EPS, book value, and `Diluted Average Shares` (a count of ORDINARY shares, db.py:664-669).
- Trading currency: price (`current_price_loader`, `load_price_bars`), `market_cap` and `sharesOutstanding` from `corporate_quote_facts` (already listing units: TSM 5.19bn is ADR-equivalent; ordinary would be about 25.9bn).
- Currency-free, need no conversion: ROIC, margins, growth, terminal growth, beta, tax rate, WACC rates.
- Mixed today and so wrong for these 13: value per share, equity weight in WACC (E in USD, D in reporting currency), EV/Sales vs price, net-debt bridge, any money figure shown beside a price.

### 1.3 The 13 tickers (read-only query on `corporate_quote_facts`, `financial_currency != currency`)
- CAD reporter, USD price (10): CCJ, DNN, FTS, FURY, NAK, NXE, TECK, TGB, TRP, WRN.
- EUR: ASML. KRW: KEP. TWD: TSM. All trade in USD.
- Share ratio other than 1: TSM (1 ADR = 5 ordinary), KEP (1 ADR = 0.5 ordinary, to verify). The CAD names are US-listed ordinary shares and ASML trades as NY registry shares: ratio 1. So 2 of 13 need a real ratio; all 13 still get a row so "no row" means refuse, not "assume 1" (Q3).
- ERROR-LOG 2026-11-03: TSM 11x, ASML 0.32x, TGB 0.38x, CCJ 0.76x, TRP negative; eight others were already refused for other reasons.

## 2. FX data

- Source: FRED H.10 daily series through the existing `SeriesFetcher` and `fred_cache` (`signals/fetch.py:44-60`, `signals/store.py:132`). Offline: no `FRED_API_KEY` or a fetch error serves the cache with a reason. The resolver reads the cache only, never the network, like `market_assumptions._fresh_fred_rf`.
- Series for the 13: DEXTAUS (TWD per 1 USD), DEXKOUS (KRW per USD), DEXCAUS (CAD per USD), DEXUSEU (USD per 1 EUR, inverted quote). Later: DEXJPUS (JPY per USD), DEXCHUS (CNY per USD), DEXUSUK (USD per GBP, inverted), DEXSZUS (CHF per USD). DKK is not confirmed as an H.10 series: treat as unsupported until checked. IDs are from memory; S1 verifies each with one live fetch before adding it to `KNOWN_SERIES` (`signals/models.py:20`, an explicit allow-list).
- Quote direction: a code mapping `{ccy: (series_id, quote)}` with quote in {`per_usd`, `usd_per`}; `convert` normalises to "USD per 1 unit of ccy". The mapping is a fact about FRED, not an owner choice, so it is code, not a table.
- Today `fred_cache` holds none of these (DGS10, BAA10Y, BAMLH0A0HYM2, CPI, PAYEMS, DFEDTARU, Brent only). The weekly signals run (`signals/schedule.py`) would fetch them; about 250 rows per series per year.
- Cadence: H.10 is weekly with a lag, daily values have holiday gaps. Rule: latest observation within `FX_MAX_AGE_DAYS = 10`; older is `fx_stale` and refuses.
- Flows vs stocks (standard practice): income and cash-flow items (revenue, FCFF, EBIT, EPS) at the average of daily rates over the fiscal period; balance-sheet items (debt, cash, investments, book value) at the period-end rate (nearest earlier observation, at most 5 days back). Forward DCF value is converted at the latest spot (Q2 recommends one spot rate for the whole valuation and average/period-end only for displayed history).
- As-of shown to the user: rate, rate date (or "average of start..end"), series ID.

## 3. ADR ratios

- Home: new owner-maintained table `adr_ratios(ticker PK, ordinary_per_adr REAL, source TEXT, as_of TEXT)` beside `market_assumptions` (same pattern: validated range 0 < r <= 100, source and as_of required, owner PUT route, no code constants). Seed 13 rows: 10 CAD x 1.0, ASML 1.0, KEP 0.5 (verify), TSM 5.0 (verify). Yahoo supplies no ratio.
- Conversion: the DCF divides equity value by DILUTED ORDINARY shares (`equity_bridge.py:140`, "Diluted Average Shares"); the price is per ADR. So `value_per_adr = equity_value_in_usd / diluted_ordinary_shares * ordinary_per_adr`.
- Trap: the fallback share source `info.sharesOutstanding` (`equity_bridge.py:152`) is already ADR-equivalent for TSM. The ratio applies only when the source is `DILUTED_AVERAGE_SHARES` (`BridgeSource` already tells which).
- Guard: `abs(market_cap / (price * adr_shares) - 1) > 25%` refuses `adr_ratio_inconsistent` (market cap and price are both quote-side, no FX needed).

## 4. Recommended design

### 4.1 Data definition
`fx_series` mapping in code; `adr_ratios` table (owner-maintained); `market_assumptions` untouched. Responses echo the rate used; saved decisions may freeze `fx_rate`, `fx_as_of` later (Q9).

### 4.2 One function (new `apps/api/services/fx.py`)
`convert(amount, from_ccy, to_ccy, *, kind, period=None, conn) -> Converted`
- `amount`: float in major units; billions stay billions (a scalar rate does not change units). `kind`: `"flow"` (average over `period=(start, end)`), `"stock"` (rate at `period_end`), `"spot"` (latest). Result `Converted(value, rate, rate_date_or_range, series_id, quote, kind)`, rate = to_ccy per 1 from_ccy.
- Pure, local DB only, no network. Same currency: rate 1.0, no lookup. Pivots through USD, so any two supported currencies work.
- Refusals (exception with `.code`, like `AssumptionsRefused`): `fx_unsupported_currency`, `fx_missing`, `fx_stale`, `fx_out_of_range` (rate <= 0 or non-finite), `adr_ratio_missing`, `adr_ratio_inconsistent`. Reason text names the currency and what is missing. Never fall back to 1.0 or to an old rate.
- `statement_currency_mismatch` becomes a status function (None or the two currencies); callers decide convert or refuse. `fair_value.py:78` stops duplicating it.

### 4.3 Where it plugs in (one seam, before valuation)
- DCF single, report, stream, bulk (`corporate_dcf.py:177,226`): on mismatch build an FX context (spot rate, ADR ratio) or raise `EngineRefusal(code, reason)`. Convert `base_fcff`, `net_debt`, non-operating assets; divide by shares x ratio. Growth, terminal growth, WACC rates unchanged. Output carries `fx: {from, to, rate, rate_date, series_id, kind, adr_ratio}`; reporting-currency figures stay visible.
- WACC: convert debt before the market-cap weights (E is USD today, D is not).
- Comparison (`corporate_comparison.py:427-466`): same context; `dcf_refusal` and `ImpliedReturn.refusal` carry the fx code instead of `currency_mismatch`.
- Bulk: `skipped` reason carries the code; per-ticker skip as today.
- Relative pricing (`relative_pricing.py:165`) and fair value (`fair_value.py:78`): convert revenue, net debt and shares-per-ADR the same way, via the shared function.
- Policy statement to put in finance-logic.md: valuation at one spot rate; history shown at flow/stock rates.

### 4.4 UI
- Converted figure plus a note: "converted at 31.5 TWD/USD (FRED DEXTAUS, 2026-11-12); 1 ADR = 5 ordinary shares". Reporting-currency original in calculation details. i18n keys in `en.ts` and `ko.ts` (formal Korean), existing mono figure style, no new tokens.
- Refusal reasons per code in `lib/dcfRefusal.ts` and the `refusedReason` maps; `currency_mismatch` text stays for an unsupported pair.
- Rate 5 to 10 days old shows its date in the existing stale style; over 10 days refuses.

### 4.5 Test plan with mutation targets (test-verification.md)
1. `convert` quote direction (TWD per USD vs USD per EUR). M1: invert `usd_per` -> fails.
2. Flow vs stock vs spot with distinct rates on three dates. M2: spot for flows -> fails.
3. Missing, stale, out-of-range FX; missing ratio: each its exact code. M3: fall back to 1.0 on missing -> fails.
4. TSM value per ADR = equity / ordinary x 5. M4: drop the ratio; M5: apply the ratio to the `sharesOutstanding` source -> both fail.
5. Same-currency ticker unchanged, no `fred_cache` read. M6: always look up FX -> fails.
6. Each surface (DCF single, report, stream, bulk, comparison, relative pricing, fair value) converts TSM and refuses on missing FX. M7: remove conversion from one surface -> that surface's test fails.
7. Regression magnitude: TSM value within 0.5x to 2x of price on a plausible fixture (the 11x bug); ASML (0.32x bug).
8. Mocked e2e: rate note renders; DCF card still fits 1280x720 (run only when approved).

## 5. Existing-test change inventory
| file:line | current | new | why |
|---|---|---|---|
| `tests/api/test_currency_mismatch.py:30-41` | `statement_currency_mismatch` returns reason for TWD/USD, None for missing bundle | unchanged if the function keeps its name; renamed with the status function otherwise | one decision site |
| `:60-80` | `_build_dcf_outputs` raises `currency_mismatch` | converts with an FX fixture; refusal tests become `fx_missing` and `fx_unsupported_currency` | conversion is the default |
| `:94-118` | comparison row `dcf_refusal` / `implied_return_refusal == "currency_mismatch"` | value plus fx echo; refusal case carries the fx code | same |
| `:127-141` | route 422 `currency_mismatch` (single, report, stream), bulk skip | monkeypatch the FX resolver; 422 code `fx_missing`; bulk skip carries the code | same |
| `tests/api/test_fair_value.py:82-84` | `reason.startswith("currency_mismatch:")` | converts with fixture; refusal `fx_missing:` | same |
| `tests/api/test_relative_pricing.py:170-173, 210-217` | refuses `currency_mismatch: TESTCO reports in TWD`; route 422 prefix | converts; route test mocks `fx_missing:` | same |
| `tests/api/test_s2b_assumptions.py:221`, `test_country_risk_premium.py:57`, `test_statement_metrics_assumptions*.py` | `financialCurrency` only for CRP | unchanged | CRP keyed to reporting currency |
| `tests/api/acquisition/test_store.py`, `test_quote_facts_source.py` | financial_currency stored | unchanged | storage untouched |
| `tests/api/test_portfolio_attribution.py` (`test_currency_mismatch_rejected_for_unsupported_currency`) | portfolio rule | unchanged | name collision only |
| `apps/web/tests/e2e/valuation.spec.ts:42-47` | mocked 422 "No fair value: currency_mismatch: TSM ..." | unchanged; add an `fx_missing` case | UI maps codes |
| `apps/web/tests/e2e/corporate-guide.spec.ts:315, 414` | mocked `currency_mismatch` 422 | unchanged; add one converted-figure test | same |
`docs/reports/2026-11-fair-value-*.md` (13 `currency_mismatch` rows) are dated output: regenerate after S2, do not edit.

## 6. Open questions for the owner
1. Convert at all, given the 2026-11-03 "keep the refusal"? Recommended: yes, only when FX and ratio rows exist; otherwise refuse with the new code.
2. One spot rate for the whole valuation, or flows at period average and balance sheet at period end? Recommended: spot for the valuation (one auditable policy); average/period-end for displayed history only.
3. Missing ADR ratio treated as 1.0 for the CAD names? Recommended: no; seed explicit 1.0 rows so an unlisted ticker refuses.
4. Who verifies ratios (TSM 5, KEP 0.5) and how often? Recommended: owner enters with source and as-of via a PUT route; no auto-fetch.
5. FRED only, or a second FX source for gaps (DKK)? Recommended: FRED only; unsupported currency refuses.
6. Freshness limit 10 days, refuse beyond it? Recommended: yes, same offline behaviour as the risk-free rate.
7. Convert WACC debt weights in the same change? Recommended: yes.
8. Slices? Recommended: S1 FX series + `fx.py` + `adr_ratios` + tests; S2 DCF/comparison/bulk; S3 relative pricing + fair value; S4 UI note and decision freeze.
9. Freeze `fx_rate` and `fx_as_of` on saved decisions? Recommended: yes in S4 (decisions are frozen records).
