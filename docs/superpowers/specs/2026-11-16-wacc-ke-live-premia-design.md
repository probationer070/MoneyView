# WACC / Ke rebuild: live or dated risk-free and ERP (design draft, HARNESS stage 1)

Status: draft for owner approval. Read-only research 2026-11-16; nothing run, nothing edited.
Rule base: finance-logic.md "Corporate Valuation" and "Data Quality" (every pipeline defines missing-data behaviour, source priority, a reproducibility key). The SOP has no rf/ERP rule today.

## 1. Inventory

### 1.1 Definitions (three copies of rf and ERP, one of CRP)
| Where | What |
|---|---|
| `apps/api/services/corporate_statement_metrics.py:32-34` | `DEFAULT_RISK_FREE_RATE = 0.042`, `DEFAULT_EQUITY_RISK_PREMIUM = 0.055` (fractions), `KOREA_COUNTRY_RISK_PREMIUM = 0.8` (percent) |
| `apps/api/services/investment_decision.py:72-73` | duplicate 0.042 / 0.055 (own copy) |
| `apps/api/services/corporate_dcf.py:49` | duplicate `DEFAULT_EQUITY_RISK_PREMIUM = 0.055` (used as parameter default, :59, :85, :146) |
| `apps/web/app/corporate/corporateConstants.ts:23,24,28` | `RISK_FREE_RATE = 4.2`, `KOREA_COUNTRY_RISK_PREMIUM = 0.8`, `EQUITY_RISK_PREMIUM = 5.5` (percent) |
| `apps/api/models/schema_parts/corporate.py:246` | `crp: float = 0.8` default on the metrics model; `db.py:495` column default 1.1 (generic-default sentinel, `corporate_metrics_service.py:164`) |
| `apps/api/services/valuation_seed.py:258` | seed case `riskfree_rate: 0.0420` (a dated case input as of 2026-04-01; leave) |
| `apps/api/routes/monte_carlo.py:25`, `apps/web/app/monte-carlo/page.tsx:45` | separate user-input rf (0.04 / 3), Sharpe only. Out of scope. |

CRP is a rule, not a premium table: `country_risk_premium_for(currency)` (`corporate_statement_metrics.py:43`) gives 0 for USD/CAD/EUR reporters, else 0.8.

### 1.2 Reads (backend)
- Ke formula: `corporate_statement_metrics.py:866` (single-ticker metrics) and `:1435` (second path, history/bundle); both `rf + levered_beta * ERP + crp/100`.
- Audit rows "Model policy input": `:1590,1592` (rf, ERP), source string literal.
- `routes/corporate.py:57-58` import; `:180-181, 222-223, 324-325, 346-347, 380-381, 406-407` pass the two constants into comparison, DCF and decision builders.
- `company_baseline.py:33,173` and `fair_value.py:23,54`: `riskfree_rate` parameter default is the constant (case/valuation engine).
- `corporate_comparison.py`: threads `risk_free_rate`/`equity_risk_premium` through ~25 signatures; `_market_expected_return_pct` :551; identity key `rf=..|erp=..` :1165-1171.
- `corporate_dcf.py:427,431`: `DCFWaccBreakdown` carries rf, ERP, CRP out to the frontend (`RawDataTab.tsx:126-127`).
- `packages/core_finance/hurdle_rate.py:59` takes `crp` argument; `calculate_market_expected_return` is the rf+ERP sum.

### 1.3 Reads (frontend)
- `page.tsx:479-480` (implied-ERP inputs: rf and stable growth both = RISK_FREE_RATE), `:484` implied ERP = implied return - rf, `:502` `bottomUpKe` fallback when metrics lack `levered_beta`/`cost_of_equity`, `:821-822` hurdle bar segments, `:891-892` formula context, `:994` growthReference.
- `formulaContext.ts:28-33`, `buildCalculationDetails.ts` (lines ~387-425, 523-546, 622-645; sources labelled `bottomUpKe.manualMacro`, `hurdle.fredMacro`, `policyErpSource`), `substitutedFormula.ts:55,66`.
- `corporateUtils.ts:188,365`: `crp ?? KOREA_COUNTRY_RISK_PREMIUM` (the 0.8 fallback the todo mentions).
- `corporateTypes.ts:54` `riskFreeRate`; `TargetStockComparisonSection.tsx:50` consumes comparison `risk_free_rate`.
- Note: `fredMacro` label already claims FRED as the rf source; today it is false (constant).

### 1.4 Persisted values that go stale
| Store | Column(s) | Written by | Staleness |
|---|---|---|---|
| `corporate_metrics` (db.py:488) | `wacc`, `crp` | `corporate_metrics_service.py:370` (INSERT OR IGNORE of defaults), `:452` (INSERT OR REPLACE from the user's PUT) | Saved `wacc` is a percent computed under 4.2/5.5 whenever the owner saved it. Live `/metrics` recomputes Ke from stored statements (not persisted), so the table only matters for saved/fallback rows (`load_fallback_metrics`, no `levered_beta`/`cost_of_equity`). Also synced via `records_sync/kinds.py:187`. |
| `corporate_comparison_snapshots` (+ `_rows`, db.py:524,555,587,937-1030) | `risk_free_rate`, `equity_risk_premium` (percent, rounded) per snapshot and per row | `corporate_comparison.py:203-222` | Already self-describing: each snapshot stores the rf/ERP it was built with, and the identity key includes them (:1165). A changed rf/ERP creates a new identity, so old snapshots stay readable, labelled with old values. |
| `investment_decisions` copies (db.py:722-723) | `wacc`, `dcf_implied_return`, `risk_free_rate`, `equity_risk_premium` | `investment_decision.py:213-227` | Designed as a frozen record ("decisions never expire", decision.py:80). Do NOT migrate; only add an as-of column if wanted. |
| `records_sync/kinds.py:138` | same decision columns | sync | follows above |
| Valuation cases (`valuation_seed.py:258`, `tests/api/test_case_fork.py:18`) | `riskfree_rate` inside case payload | user/seed | Dated by `as_of_date`; leave. |
No persisted `/metrics` cache exists; statement bundles are stored raw (`get_yahoo_statement_bundle` reads local store only), so there is nothing else to recompute.

### 1.5 Tests pinning today's values (will change)
- `tests/api/test_corporate_comparison.py`: ~30 call sites pass `risk_free_rate=0.042`; `:219,:396,:906` pin 4.2 / 5.5 in stored rows. These pass the value as an argument, so they survive a rebuild unchanged if the builders keep taking rf/ERP as parameters (recommended).
- `tests/api/records_sync/test_routes.py:85`, `tests/api/test_case_fork.py:18`: fixture data only.
- `apps/web/tests/e2e/corporate-model.spec.ts:114-116` (rf 4.2, ERP 5.1 fixture), `i18n-corporate-calc.spec.ts:34-35`, plus mocks `helpers/corporatePageMock.ts` and the one-screen, detail-tabs, guide specs. Any asserting "4.2%" or "5.5%" text on Ke or hurdle needs updating once the page reads from the API.
- No test pins `country_risk_premium` per currency beyond `tests/api/test_country_risk_premium.py`.

## 2. Data sources available today

- FRED: `apps/api/services/signals/fetch.py` (`fred_source_from_env` needs `FRED_API_KEY`; `SeriesFetcher.get_series` writes success to `fred_cache` and falls back to cache on error or missing key, returning `from_cache=True` plus a reason). Store: `signals/store.py:132-146`, table `fred_cache(series_id, obs_date, value, fetched_at)` (db.py:271). DGS10 is already cached: `signals/models.py:20` KNOWN_SERIES, `risk/constants.py:11` RISK_FRED_SERIES, used by rules `b_tnx_sticky` and one A rule (`rules.yaml:19,78`, `max_age_days: 7`). Values are percent (4.2 means 4.2%). Refresh happens in the weekly signals run (`signals/schedule.py`) and `risk/inputs.py:load_inputs(fetch_fred=True)`; `cached_fred()` (inputs.py:53) is the cache-only reader. Offline: empty key means cache only, no network, no error.
- Gap: the cache holds whatever DGS10 history has been pulled (risk engine starts 2014-01-01); freshness depends on the weekly job having run. FRED DGS10 has holiday gaps (no value), so "latest observation" is the rule.
- Damodaran: `data/raw/damodaran/pedata-2026-01.xls(x)` loaded into `industry_benchmark` (db.py:777, PK `vintage, industry_name`; columns: growth, margins, ROC, unlevered_beta, D/C, cost_of_capital, PE, ...). It has NO implied ERP and no country/ERP rows, so it is not an ERP source. (The vintage column does show how dated data is modelled here: publication date, not fetch date. Reuse that convention.)
- Implied ERP in the repo: frontend only. `page.tsx:473-485` solves implied market return from S&P 500 last close (`sp500Query`) with hard-coded dividend yield, buyback yield, growth path (`IMPLIED_ERP_*` constants) and rf = 4.2; ERP = return - rf. It does not feed Ke (the Ke card uses 5.5 policy ERP; implied ERP is shown beside it, `hurdle.erpPolicy`). No backend implied ERP.
- No FRED series for ERP exists (Damodaran's monthly implied ERP is published as a spreadsheet, not FRED; BAA10Y/BAMLH0A0HYM2 are credit spreads, not ERP).

## 3. Options

### Risk-free
| | Option | Pros | Cons | Offline |
|---|---|---|---|---|
| R1 | Latest cached DGS10 close, with obs date | Source exists, already refreshed weekly, honest label ("FRED DGS10, 2026-11-13") | Only as fresh as the last job run; needs a stale rule | cache only; if empty or older than N days, fall to R2 or refuse |
| R2 | Owner-set rf with as-of date (a record in DB/config) | Deterministic, works offline, reproducible | Goes stale silently unless an age warning exists | always |
| R3 | R1 with R2 as dated fallback | Live when possible, dated when not; always shows which | Two sources to explain | yes |

### ERP
| | Option | Pros | Cons | Offline |
|---|---|---|---|---|
| E1 | Owner-set ERP with source note and as-of date (e.g. Damodaran's monthly implied ERP, typed in) | Simple; no new fetch; dated; matches how the 5.5% policy was always a judgement | Manual; ages | always |
| E2 | Damodaran implied ERP file import (new vintage table like `industry_benchmark`) | Dated vintage, reproducible, same pattern as existing loader | Needs a parser and a file the owner drops; the existing xls has no ERP | yes after load |
| E3 | Use the existing frontend implied ERP | No new data | Depends on hard-coded dividend/buyback/growth inputs and on rf itself; mixes ERP into Ke circularly; moves volatile with the S&P close; not backend-computable today | needs sp500 query |
| E4 | Live-computed implied ERP on backend | Fully live | Needs earnings/growth input data the repo does not hold; high effort and false precision | no |

### Keeping shown = used
One backend resolver returns a single object `{risk_free_rate, risk_free_source, risk_free_as_of, equity_risk_premium, erp_source, erp_as_of, stale_flags}`. Every consumer (Ke at statement_metrics :866/:1435, DCF breakdown, comparison, decision, company_baseline, fair_value) takes it as a parameter or reads it once per request. `/metrics` echoes it. The frontend deletes its constants and reads the echoed values; hurdle bars, Ke card, formula text, implied-ERP card (rf term) all draw from the one `metrics.assumptions` object. Persisted comparison rows already store the pair, and decisions already store the pair, so only an as-of must be added.

## 4. Recommended design

Choose R3 (DGS10 cache, dated fallback) + E1 (owner-set ERP with source and as-of); keep E2 as a later upgrade behind the same resolver.

1. Data definition: new table `market_assumptions(key TEXT, value REAL, as_of TEXT, source TEXT, updated_at TEXT, PRIMARY KEY(key, as_of))` holding keys `equity_risk_premium` and `risk_free_fallback` (append-only; latest `as_of` wins; history preserved). Seeded once with today's values: rf 4.2, ERP 5.5, `as_of = 2026-11-16`, `source = "owner policy"` (the honest provenance of the current numbers). CRP stays rule-based (see Q5). A single module `apps/api/services/market_assumptions.py` owns `resolve_assumptions(now)`; the three duplicate constants and the TS constants are deleted. `packages/core_finance` stays pure (receives rf/ERP as arguments, no I/O).
2. Resolver rule for rf: latest `fred_cache` DGS10 observation within `RF_MAX_AGE_DAYS` (default 7, mirroring `rules.yaml`) -> source "FRED DGS10", as_of = observation date; else latest `risk_free_fallback` row with its as_of and `rf_stale=true` when older than 90 days. ERP: latest row; `erp_stale=true` when older than 120 days (Damodaran updates monthly; owner to confirm).
3. API shape: `/corporate/{ticker}/metrics` adds `assumptions: {risk_free_rate, risk_free_source, risk_free_as_of, equity_risk_premium, erp_source, erp_as_of, crp, crp_basis, stale: [..]}` (percent, matching the existing `crp` and `wacc` percent convention in that payload; the DCF breakdown keeps fractions as today). `DCFWaccBreakdown` and the comparison response gain `*_as_of`. New `GET/PUT /market-assumptions` to read and set ERP/fallback rf (PUT appends a dated row; owner action only). Comparison identity key (:1165) already includes rf/ERP, so no change. Decision copies get an `assumptions_as_of` column (nullable), not a migration of old rows.
4. UI: Ke card and hurdle chart show "rf 4.1% (FRED DGS10, 11-13) + beta x ERP 5.5% (owner, 11-16) + CRP", with a stale badge when flagged; the substituted formula and calculation-details sources read the echoed source strings (replacing `manualMacro`/`fredMacro` literals so they are true). Implied-ERP card keeps working off the echoed rf instead of 4.2. Frontend fallback when metrics lack `assumptions` (saved/default rows): do not substitute constants; show "assumptions unavailable" and hide the Ke bar (same refusal posture as the deferred invalid-audit decision, todo line 79).
5. Migration of persisted values: (a) `corporate_metrics.wacc` rows from user saves: leave values, add `assumptions_as_of` shown as "saved under rf/ERP as of X" is optional; recommend instead a one-time report script (read-only) listing saved rows whose wacc differs from live by > 0.25 pt, owner decides re-save. (b) comparison snapshots: no migration, already tagged. (c) decisions: frozen by design, no migration. (d) seed `market_assumptions` as above, so behaviour is identical on day one (4.2/5.5 shown as dated owner policy until FRED cache supplies rf).
6. Refusal and fallback: rf resolves from FRED, else dated fallback, else refuse (HTTP 200 with `wacc: null`, reason `assumptions_missing`; never a silent 4.2). ERP missing -> same refusal. rf outside [-0.5%, 15%] or ERP outside [2%, 12%] -> rejected at PUT and ignored at read (log, use next-latest). WACC <= terminal growth check is unchanged (finance-logic rule).
7. Test plan (pytest, per test-verification.md; each with a named mutation):
   - `test_market_assumptions_resolver`: FRED fresh wins; FRED older than 7 days falls to fallback with `rf_stale`; both missing refuses; ERP latest-as_of wins. Mutations: use oldest row; drop the age check; return 4.2 when empty.
   - `test_ke_uses_resolved_assumptions`: Ke at :866 and :1435 equals rf + beta*ERP + crp for non-default rf/ERP (mutation: restore the constant in either of the two paths; the two-path split is the likely regression, see ERROR-LOG's "same formula twice" class).
   - `test_metrics_echoes_assumptions_as_shown`: `/metrics` assumptions equal the values used in `cost_of_equity` and in the DCF `wacc_breakdown` for the same request (mutation: let DCF read its own default).
   - no-constants guard: a grep-style test that fails if `0.042`/`0.055` literals reappear outside the seed and tests (mutation: reintroduce one).
   - PUT validation and append-only history; comparison identity changes when ERP changes (existing key test extended).
   - Playwright (after owner approval; do not run now): Ke card and hurdle chart text shows the as-of date and source from a mocked `/metrics`; changing the mocked rf changes both card and bar (mutation: hard-code 4.2 in `page.tsx:502` or `:821`); stale badge appears when `stale` lists `erp`; missing assumptions hides the bar. Update the fixtures listed in 1.5 for new payload field; one-screen 1280x720 check for the longer Ke line (no new tokens needed; use existing mono/ink styles).
8. Staging (small, each independently shippable): S1 resolver + table + seed + echo in `/metrics` (no behaviour change); S2 backend consumers switch (statement metrics both paths, DCF, comparison, decision, baseline, fair_value); S3 frontend switch + as-of display + fixtures; S4 PUT route and owner entry UI (can be a settings row, or CLI script first). Model routing per HARNESS: Opus plans and verifies; Sonnet writes S1-S3.

## 5. Open questions for the owner

1. Risk-free source: DGS10 (10-year US Treasury) as rf for all tickers, including KRW/TWD reporters? Recommended: yes, DGS10 for all, since cash flows are modelled in USD and CRP carries the country risk. A local-currency rf would double count.
2. ERP source: owner-typed value with source and date (E1) now, Damodaran file import (E2) later? Recommended: E1 now. What value and as-of do you want seeded: keep 5.5% as dated 2026-11-16, or enter the current Damodaran implied ERP?
3. Should the existing frontend implied-ERP card stay a display-only cross-check (recommended) or become the ERP used in Ke (not recommended: circular, volatile, inputs hard-coded)?
4. Staleness thresholds: rf cache older than 7 days falls back; ERP older than 120 days shows a stale badge. Recommended: accept these; refuse nothing on staleness alone (only on missing), because a refused WACC blocks the whole corporate page.
5. CRP: keep the rule (0 for USD/CAD/EUR reporters, else 0.8%) with 0.8 dated as "owner assumption" in the same table, or import Damodaran country premiums? Recommended: keep the rule, move 0.8 into `market_assumptions` so it carries an as-of; revisit import later. Also confirm the legacy 1.1 default (db.py:495) stays only as the generic-default sentinel.
6. Saved `corporate_metrics.wacc` rows: re-save by owner after the report script (recommended), or auto-recompute on read? Auto-recompute would silently overwrite owner-edited values.
7. Decisions and comparison snapshots: confirm they stay frozen with their own rf/ERP (recommended), only gaining an as-of display.
8. When assumptions are missing (no FRED cache, no fallback row): refuse WACC with a visible reason (recommended) or show the last stored value with an "unverified" note? This is also the open point of the deferred invalid-audit decision (todo line 79); recommend one rule for both.
9. Scope: Monte Carlo rf input (separate user field, Sharpe only) and the valuation-case `riskfree_rate` (dated by `as_of_date`) stay untouched. Confirm.
10. Sequencing: do this before or together with the deferred "invalid audit shows slider value" rebuild? Recommended: together, since both change what the WACC tile shows when inputs are unusable.


## 6. Owner answers (2026-11-16: "추천대로", all recommendations accepted)

1. DGS10 is the risk-free rate for every ticker.
2. ERP is owner-entered with source and as-of date; seeded 5.5% as of 2026-11-16 (so day-one numbers are unchanged).
3. The frontend implied-ERP card stays display-only.
4. rf older than 7 days falls back to the owner-set value; ERP older than 120 days shows a stale badge; staleness alone never refuses.
5. CRP keeps its rule (0 for USD/CAD/EUR reporters, else 0.8%), with the 0.8% dated in `market_assumptions`.
6. Saved WACC rows that drift: a report lists them and the owner re-saves; no auto-recompute.
7. Decisions and comparison snapshots keep their frozen rf/ERP.
8. No rf/ERP at all (no cache, no fallback row): WACC is refused with a visible reason; the same rule replaces the deferred "invalid audit shows the slider value" decision.
9. Monte Carlo rf and valuation-case rf are out of scope.
10. Done together with the WACC tile / invalid-audit rebuild.
