# WACC / Ke live premia: plan S1-S4 (HARNESS stage 2 + stage 3 inventory)

Spec: `docs/superpowers/specs/2026-11-16-wacc-ke-live-premia-design.md` (owner answers in section 6, all recommendations accepted).
Rules applied: HARNESS Plan rule (output contracts), `finance-logic.md` (single formula, missing-data behaviour, reproducibility), `test-verification.md` (every test names its mutation). Model routing: Opus verifies, Sonnet writes S1-S4. Each task is sized for one agent (~100k tokens). Nothing here is run by the planner; Playwright runs only after the owner approves section 5.

## 0. Decisions fixed by this plan

| # | Decision |
|---|---|
| D1 | `market_assumptions.value` is stored in **percent points** (4.2 = 4.2 %), the unit of FRED DGS10, `/metrics` (`crp`, `wacc`, `cost_of_equity`) and the TS constants. Builders that take fractions (`corporate_dcf`, `corporate_comparison`, `investment_decision`, `company_baseline`, `fair_value`) get them from `Assumptions.rf_fraction` / `.erp_fraction` (value / 100). One conversion point, in the resolver. |
| D2 | Resolver is a pure function of (db connection, `now`): `resolve_assumptions(conn, now)`. No hidden global; no I/O in `packages/core_finance`. Routes call it once per request and pass the object down. |
| D3 | Both Ke paths call one function `capm_cost_of_equity_pct(a, levered_beta, crp_pct)` in `market_assumptions.py`. The frontend never recomputes rf/ERP; it reads `metrics.assumptions`. |
| D4 | CRP stays a rule (`country_risk_premium_for(currency)`: 0 for USD/CAD/EUR reporters, else the dated `crp_non_mature` value, seed 0.8). The 1.1 default at `db.py:495` stays a generic-default sentinel. |
| D5 | Builders keep `risk_free_rate` / `equity_risk_premium` as explicit parameters (this keeps the ~110 existing test call sites valid). Only the **defaults** are removed: the parameters become required, so a forgotten caller fails loudly instead of silently using 4.2. |

## 1. Data definition: `market_assumptions` (new SQLite table)

- Kind: SQLite table, owner record (not rebuildable, not a cache). Defined in `apps/api/services/db.py` as `CREATE TABLE IF NOT EXISTS` in the main schema block (next to `fred_cache`, db.py:271) plus an idempotent seed in `init_db()` (db.py:849). Tests use `tmp_path` or `:memory:` connections built from the same schema script; **never** `data/processed/moneyview.db`.

| field | type | unit | nullable | example | meaning |
|---|---|---|---|---|---|
| `key` | TEXT | n/a | no | `equity_risk_premium` | CHECK in (`risk_free_fallback`, `equity_risk_premium`, `crp_non_mature`) |
| `value` | REAL | percent points (5.5 = 5.5 %) | no | `5.5` | CHECK per key: rf in [-0.5, 15], ERP in [2, 12], CRP in [0, 10] |
| `as_of` | TEXT | ISO date `YYYY-MM-DD` | no | `2026-11-16` | date the value is true for (publication/decision date, not insert date; same convention as `industry_benchmark.vintage`) |
| `source` | TEXT | n/a | no | `owner` | free text, non-empty |
| `updated_at` | TEXT | ISO-8601 UTC | no | `2026-11-16T09:00:00Z` | insert time |

| Item | Definition |
|---|---|
| Primary key | `(key, as_of)` |
| Semantics | **Append-only.** Latest `as_of` per key wins. A second insert of the same `(key, as_of)` is rejected (409 at the route), never overwritten. No UPDATE or DELETE path exists in code. |
| Seed (insert-or-ignore, fixed PK, so repeat runs and the second PC are no-ops) | `risk_free_fallback` 4.2, `equity_risk_premium` 5.5, `crp_non_mature` 0.8; all `as_of 2026-11-16`, source `owner` |
| Written by | `init_db()` seed (S1); `PUT /market-assumptions` (S4) |
| Sync | Not in `records_sync` here (open point O1). Seed is identical on both PCs by migration. |
| Consumers | `market_assumptions.resolve_assumptions`, `routes/corporate.py`, drift report (S4) |
| Docs at S1 | `docs/architecture/database-relationships.md`: new row, class "owner record", synced "no" |

### Resolver contract (`apps/api/services/market_assumptions.py`)

```
Assumptions (frozen dataclass; rates in percent points)
  risk_free_rate: float        e.g. 4.2
  risk_free_source: str        "FRED DGS10" | row.source (seed: "owner")
  risk_free_as_of: str         ISO date of the observation / fallback row
  equity_risk_premium: float   e.g. 5.5
  erp_source: str ; erp_as_of: str
  crp_non_mature: float        e.g. 0.8 ; crp_as_of: str
  stale: tuple[str, ...]       subset of ("risk_free", "erp")
  rf_fraction, erp_fraction    properties, value / 100
resolve_assumptions(conn, now: datetime) -> Assumptions | AssumptionsMissing
AssumptionsMissing(code="assumptions_missing", missing: tuple of "risk_free" | "erp" | "crp")
```

| Case | Result |
|---|---|
| Latest `fred_cache` DGS10 obs, age <= 7 days (`RF_MAX_AGE_DAYS`), value in [-0.5, 15] | rf = obs, source `FRED DGS10`, as_of = obs date, not stale |
| FRED obs older than 7 days, absent, or out of range (logged; next-latest tried) | rf = latest `risk_free_fallback` row with its source and as_of; `risk_free` in `stale` when that row is older than 90 days |
| No usable FRED and no fallback row | `AssumptionsMissing(missing=("risk_free",))` |
| ERP row present | latest `as_of`; `erp` in `stale` when older than 120 days |
| No ERP row / no CRP row | `AssumptionsMissing` naming `erp` / `crp` (CRP missing only on a damaged DB, since it is seeded) |
| Row value outside CHECK range (manual SQL only) | skipped, next-latest used, one log line |
| Staleness alone | never refuses (owner answer 4) |
| Example | now 2026-11-16, DGS10 4.11 on 2026-11-13, ERP 5.5 on 2026-11-16 -> rf 4.11 "FRED DGS10" 2026-11-13, ERP 5.5 "owner" 2026-11-16, CRP 0.8, stale () |

Offline: reads only the local DB (`fred_cache` via a cache-only read like `risk/inputs.cached_fred`), never the network. Side effects: none (log lines only).

## 2. Refusal rule (owner answer 8; replaces the deferred invalid-audit display)

- Reason code: `assumptions_missing`. Backend returns HTTP 200 with `assumptions: null`, `wacc_refusal: {code: "assumptions_missing", missing: [...]}`, `cost_of_equity: null`, `wacc: null`. Never a silent 4.2, never the stored or slider value. `wacc` and `cost_of_equity` on `CorporateMetrics` (`schema_parts/corporate.py`) become `Optional[float]`; `packages/shared-types` regenerated.
- Catalog keys (en/ko in `apps/web/lib/i18n/messages/`), namespace `corporate.assumptions`:

| key | en | ko |
|---|---|---|
| `missing.title` | `WACC unavailable` | `WACC를 계산할 수 없음` |
| `missing.reason` | `No risk-free rate or equity risk premium is on file ({missing}). Enter one under Market assumptions.` | `무위험수익률 또는 주식위험프리미엄이 없습니다 ({missing}). 시장 가정에서 입력하세요.` |
| `stale.risk_free` | `Risk-free rate is older than the limit` | `무위험수익률이 기준일을 초과했습니다` |
| `stale.erp` | `ERP is older than 120 days` | `ERP가 120일을 초과했습니다` |
| `source.line` | `rf {rf}% ({rfSource}, {rfAsOf}) + beta x ERP {erp}% ({erpSource}, {erpAsOf}) + CRP {crp}%` | `rf {rf}% ({rfSource}, {rfAsOf}) + 베타 x ERP {erp}% ({erpSource}, {erpAsOf}) + CRP {crp}%` |

- When refused: WACC tile shows `missing.title` + `missing.reason` (testid `wacc-refused`) instead of a number; Ke card and the hurdle Ke segment are hidden; the DCF endpoint returns its existing "unavailable" payload with `reason: "assumptions_missing"` (nothing valued); comparison table rows show `-` in WACC-derived columns plus one note with `missing.reason`; ROIC-vs-WACC quadrant has no WACC line. The "slider value with an invalid-basis note" behaviour (todo line 79) is removed in S3, so one rule covers both.
- rf/ERP present but beta missing: existing beta-missing behaviour, not an assumptions refusal.

## 3. Tasks

### S1: table, resolver, `/metrics` echo (no behaviour change)
- Files: `apps/api/services/db.py` (table + seed), new `apps/api/services/market_assumptions.py`, `apps/api/models/schema_parts/corporate.py` (`assumptions: Optional[AssumptionsOut]`, `wacc_refusal`), `apps/api/routes/corporate.py` (`/corporate/{ticker}/metrics` resolves and echoes), `packages/shared-types/corporate.ts`, `docs/architecture/database-relationships.md`.
- Contract `AssumptionsOut` (percent): `{risk_free_rate, risk_free_source, risk_free_as_of, equity_risk_premium, erp_source, erp_as_of, crp, crp_basis, stale: string[]}`. `crp` is this ticker's CRP (0 or `crp_non_mature`); `crp_basis` is `"mature_market_rule"` or `"non_mature_rule"`. Example, KRW reporter: `crp: 0.8, crp_basis: "non_mature_rule"`. In S1 Ke is still computed from the old constants (seed equals them), so `cost_of_equity` is unchanged.
- Tests first (`tests/api/test_market_assumptions_resolver.py`, `tests/api/test_market_assumptions_table.py`), mutation each must catch:
  - fresh FRED wins: resolver always returns the fallback row.
  - FRED 8 days old falls to fallback: age check removed.
  - FRED exactly 7 days old accepted: `>=` instead of `>`.
  - both missing returns `AssumptionsMissing`: resolver returns 4.2.
  - ERP latest `as_of` beats an older row inserted later: orders by `updated_at` or picks the oldest.
  - stale flags at 90/120-day boundaries; out-of-range row skipped: range check removed.
  - seed idempotent (init twice = 3 rows; an owner-edited row survives re-init): seed written as `INSERT OR REPLACE`.
  - CHECK rejects ERP 50 and unknown key; PK rejects duplicate `(key, as_of)`: CHECK dropped.
  - `/metrics` echo equals resolver output: route echoes module constants.
- Run: `pytest tests/api/test_market_assumptions_resolver.py tests/api/test_market_assumptions_table.py -q`, the corporate route tests (confirm names with `pytest --collect-only tests/api -k corporate`), `tests/api/test_db*.py`.

### S2a: statement metrics + route plumbing (one Ke formula)
- Files: `corporate_statement_metrics.py` (delete :32-34 constants; `yahoo_statement_metrics` and the bundle/history path take required `assumptions`; :866 and :1435 both call `capm_cost_of_equity_pct`; audit rows :1590/:1592 take value and source from `assumptions` instead of the literal "Model policy input"), `routes/corporate.py` (resolve once per request; thread into :180-181, 222-223, 324-325, 346-347, 380-381, 406-407; refusal branch; drop imports :57-61), `corporate_metrics_service.py` (fallback rows get the echo, saved `wacc` as stored).
- Contract `capm_cost_of_equity_pct(a, levered_beta, crp_pct) -> float`: percent, `a.risk_free_rate + levered_beta * a.equity_risk_premium + crp_pct`. Example: rf 4.1, beta 1.2, ERP 5.8, crp 0.8 -> 11.86. Caller handles `AssumptionsMissing` first. Refused: metrics returned with `cost_of_equity=None, wacc=None, wacc_refusal={...}`; `_valuation_params_from_metrics` raises a typed `AssumptionsRefused`, which routes turn into the `assumptions_missing` payload (HTTP 200).
- Tests first: Ke on **both** paths with rf 3.0 / ERP 7.0 (mutation A: :866 restored to 4.2/5.5; mutation B: :1435 restored; each must fail alone); echo equals values used in `cost_of_equity` and audit rows (mutation: audit row keeps its own literal); refusal (no rf -> `wacc is None`; mutation: refusal branch returns fallback metrics or 4.2); no-constants guard `tests/api/test_no_premia_literals.py` scans `apps/api/**/*.py` and `packages/core_finance/**/*.py` for `0.042`, `0.055`, `DEFAULT_RISK_FREE_RATE`, `DEFAULT_EQUITY_RISK_PREMIUM`, `KOREA_COUNTRY_RISK_PREMIUM` outside the seed in `db.py` and `valuation_seed.py` (mutation: reintroduce one literal in a service file; the guard must name that file).
- Run: `pytest tests/api/test_metrics_cost_of_equity.py tests/api/test_country_risk_premium.py tests/api/test_terminal_diagnostics.py tests/api/test_market_assumptions_*.py tests/api/test_no_premia_literals.py -q`.

### S2b: DCF, comparison, decision, baseline, fair value
- Files: `corporate_dcf.py` (delete :49; :59, :85, :146 required; `DCFWaccBreakdown` gains `risk_free_source`, `risk_free_as_of`, `erp_source`, `erp_as_of`; lines :427/:431), `corporate_comparison.py` (defaults removed where present, snapshots already store rf/ERP), `investment_decision.py` (delete :72-73; :128-129 required; new nullable `assumptions_as_of TEXT` via `ALTER TABLE` in `_ensure_schema_compatibility`; old rows stay NULL), `company_baseline.py:33,173`, `fair_value.py:23,54` (`riskfree_rate` required; callers pass `assumptions.rf_fraction`; valuation-case semantics unchanged, owner answer 9), `scripts/audit_fair_value.py:66,129`, `records_sync/kinds.py` (decision kind gains optional `assumptions_as_of`).
- Contracts: `DCFWaccBreakdown` rf/ERP stay fractions (0.042) plus four new strings (null only for legacy). Decision write stores fractions as today and `assumptions_as_of` = ISO date or NULL.
- Tests first: DCF `wacc_breakdown` equals the echo for one request (mutation: DCF reads its own default); comparison identity key changes when ERP changes (mutation: key drops erp); decision stores `assumptions_as_of` and a legacy NULL row still reads (mutation: column NOT NULL, or reader crashes on NULL); the S2a no-constants guard now also covers `corporate_dcf.py` and `investment_decision.py`.
- Run: `pytest tests/api/test_corporate_comparison.py tests/api/test_corporate_dcf_*.py tests/api/test_currency_mismatch.py tests/api/test_investment_decision_*.py tests/api/test_decision_*.py tests/api/test_fair_value_case.py tests/api/test_bulk_dcf_isolation.py tests/api/records_sync -q`, then `pytest tests/api tests/core_finance -q` once.

### S3a: frontend data flow
- Files: `corporateConstants.ts` (delete `RISK_FREE_RATE` :23, `KOREA_COUNTRY_RISK_PREMIUM` :24, `EQUITY_RISK_PREMIUM` :28), `corporateUtils.ts:188,365` (`crp ?? assumptions.crp`; with no assumptions Ke is not computed), `corporateTypes.ts` (`assumptions`, `wacc_refusal`), `formulaContext.ts:28-33` (fields keep their names, filled from `metrics.assumptions`, so `substitutedFormula.ts` is untouched), `page.tsx` (:479-480, :484, :502, :821-822, :891-892, :994), `TargetStockComparisonSection.tsx:50`.
- Contract: one selector `readAssumptions(metrics) -> {a: AssumptionsOut | null, refused: boolean}` in `corporateUtils.ts`. When `a` is null no number derived from rf/ERP is rendered. Implied-ERP card stays display-only; its rf term is `a.risk_free_rate` (null -> `-`).
- Tests first (pure-function specs in the style of `corporate-model.spec.ts`): `bottomUpKe` with mock rf 3.0 gives a 3.0 formula string (mutation: `page.tsx:502` keeps 4.2); hurdle segment follows mock rf (mutation: `:821` hard-coded 4.2); missing `crp` falls to `assumptions.crp` (mutation: restore `?? 0.8`); lint-level guard that `corporateConstants.ts` exports none of the three names.
- Run: `npm run typecheck`, `npm run lint`, then `npx playwright test corporate-model i18n-corporate-calc` after owner approval.

### S3b: display, refused state, fixtures
- Files: `buildCalculationDetails.ts` (~387-425, 523-546, 622-645: replace `manualMacro`/`fredMacro`/`policyErpSource` with `source.line` text from echoed sources), `en.ts`/`ko.ts` (section 2 keys; remove old keys only if unreferenced), Ke card, hurdle chart, `SummaryTab.tsx` WACC tile (source/as-of line, stale badge with the existing badge component, refused state `wacc-refused`), e2e mocks and specs per section 5. Tokens only (CLAUDE.md section 10); the longer Ke line must keep every `ONE_SCREEN_ROUTES` page inside 1280x720.
- Tests first: stale badge shown when mock `stale: ["erp"]` (mutation: badge ignores `stale`); source line shows `FRED DGS10` and its as-of from the mock (mutation: label hard-coded `owner`); refused mock hides the Ke bar and shows `wacc-refused` in en and ko (mutation: refused state falls back to the slider value); en/ko key parity (existing parity test); one-screen spec still passes.
- Run (after owner approval): `npx playwright test corporate-model corporate-guide corporate-detail-tabs corporate-one-screen i18n-corporate-calc portfolio*` plus lint and typecheck.

### S4: owner PUT route + drift report
- Files: new `apps/api/routes/market_assumptions.py` (registered in the app), `market_assumptions.py` (`add_assumption`), new `scripts/report_wacc_drift.py` (read-only). A settings row in the UI only if the owner asks (CLI/API first).
- Contracts:
  - `GET /market-assumptions` -> `{current: AssumptionsOut-like | null, missing: [...], history: [{key, value, as_of, source, updated_at}]}` (percent). No side effects.
  - `PUT /market-assumptions` body `{key, value, as_of, source}`; 200 returns the stored row; 422 on unknown key, out-of-range value, malformed or future `as_of` (> today + 1), empty source; 409 on duplicate `(key, as_of)`. One INSERT, never UPDATE. Example: `{"key":"equity_risk_premium","value":5.2,"as_of":"2026-12-01","source":"Damodaran implied ERP Dec 2026"}`.
  - `report_wacc_drift.py [--db PATH] [--threshold 0.25]` opens SQLite `mode=ro`; prints per `corporate_metrics` row with |saved wacc - live wacc| > threshold (percent points): `ticker | saved | live | delta | saved_at`. Exit 0; exit 2 with the reason when assumptions are missing. Never writes, no auto-recompute (owner answer 6).
- Tests first: validation matrix (mutation: ERP range check removed); append-only (second PUT same PK -> 409, row unchanged; mutation: `INSERT OR REPLACE`); next `/metrics` uses the new latest row (mutation: resolver result cached at import); drift script on a temp DB lists a row with delta 0.6, omits delta 0.1, and the DB file hash is unchanged after the run (mutation: script opens read-write and commits).
- Run: `pytest tests/api/test_market_assumptions_routes.py tests/api/test_wacc_drift_report.py -q`.

## 4. Order and gates
S1 -> S2a -> S2b -> S3a -> S3b; S4 any time after S1 (placed last since nothing depends on it). Each task: work card, mutation run recorded per test, `code-reviewer.md` gate, `todo.md` updated, `ERROR-LOG.md` entry on any regression. Owner gates: this plan and the section 5 table before S2a; Playwright only after approval.

## 5. Existing-test change inventory (stage 3; owner approves before implementation)

U = passes unchanged, C = must change. Seed 4.2 / 5.5 / 0.8 and explicit builder parameters (D5) keep most sites unchanged.

### Pytest

| file:line | current (verbatim) | new | why | task | |
|---|---|---|---|---|---|
| `tests/api/test_metrics_cost_of_equity.py:59-60` | `# r_f 4.2% + beta x ERP 5.5% + CRP 0.8%, in percent.` / `assert metrics.cost_of_equity == pytest.approx(4.2 + beta * 5.5 + 0.8, abs=1e-3)` | assertion kept; the `_metrics(beta)` helper passes `assumptions=SEED_ASSUMPTIONS` (4.2/5.5/0.8). Add one case at 3.0/7.0 | `assumptions` is required | S2a | C (helper), U (assert) |
| `tests/api/test_metrics_cost_of_equity.py` (`test_the_reported_ke_is_the_ke_inside_the_wacc`) | uses the same `_metrics` helper | same helper change | same | S2a | C (helper) |
| `tests/api/test_country_risk_premium.py:67` | `assert metrics.cost_of_equity == pytest.approx(4.2 + 1.2 * 5.5 + crp, abs=1e-3)` | assertion kept; `_metrics(currency)` helper (:55-62) passes `assumptions=SEED_ASSUMPTIONS` | same | S2a | C (helper), U (assert) |
| `tests/api/test_country_risk_premium.py:96` | `risk_free_rate=0.042, equity_risk_premium=0.055,` | unchanged | explicit args | n/a | U |
| `tests/api/test_terminal_diagnostics.py:67-68` | `risk_free_rate=corporate_route.DEFAULT_RISK_FREE_RATE,` / `equity_risk_premium=corporate_route.DEFAULT_EQUITY_RISK_PREMIUM,` | `risk_free_rate=SEED_ASSUMPTIONS.rf_fraction,` / `equity_risk_premium=SEED_ASSUMPTIONS.erp_fraction,` | route no longer exports the constants | S2a | C |
| `tests/api/test_terminal_diagnostics.py:86-87` | same two lines | same replacement | same | S2a | C |
| `tests/api/test_terminal_diagnostics.py:69,88` | `country_risk_premium=corporate_route.KOREA_COUNTRY_RISK_PREMIUM,` | `country_risk_premium=SEED_ASSUMPTIONS.crp_non_mature` (keep today's unit: 0.8 passed as is; confirm on first edit) | constant deleted | S2a | C |
| `tests/api/test_corporate_comparison.py` :111-112, 351-352, 386-387, 552-553, 568-569, 610-611, 626-627, 661-662, 706-707, 722-723, 880-881, 942-943, 984-985, 1001-1002, 1233-1234, 1251-1252, 1286-1287, 1304-1305, 1324-1325, 1357-1358, 1417-1418, 1622 | `risk_free_rate=0.042,` / `equity_risk_premium=0.055,` | unchanged | explicit args | n/a | U |
| `tests/api/test_corporate_comparison.py:219, 396-397, 906-907, 1615-1616` | `taken_at, "manual", 4.2, 5.5, ...`, `assert payload["risk_free_rate"] == 4.2`, `assert payload["equity_risk_premium"] == 5.5`, docstring on `erp=0.055` | unchanged | stored values derive from the arguments | n/a | U |
| `tests/api/test_corporate_dcf_bridge.py:71-72, 111-112, 171-178, 204` | `risk_free_rate=0.042,` / `equity_risk_premium=0.055,` | unchanged | explicit args | n/a | U |
| `tests/api/test_corporate_dcf_sensitivity.py:73-74`, `test_corporate_dcf_streaming.py:192-193`, `test_currency_mismatch.py:70,94,105`, `test_investment_decision_record.py:290,297` | explicit `0.042` / `0.055` args | unchanged; S2b first runs a grep for calls that rely on the DCF defaults (`corporate_dcf.py:59/85/146`); any found become C with `SEED_ASSUMPTIONS.*_fraction` | defaults removed | S2b | U (verify) |
| `tests/api/test_bulk_dcf_isolation.py` (2 hits) | rf/ERP via route helpers | confirm no reliance on removed constants | defaults removed | S2b | U (verify) |
| `tests/api/test_fair_value_case.py:196-201` | `riskfree_rate=0.042` and `(0.10 + 0.042) / 2` | unchanged | explicit arg; case engine out of scope | n/a | U |
| `tests/api/test_case_fork.py:18`, `tests/api/records_sync/test_routes.py:85-86` | `"riskfree_rate": 0.042,` / `"risk_free_rate": 0.042, "equity_risk_premium": 0.055` | unchanged | frozen fixtures | n/a | U |
| `tests/api/test_decision_edit_delete.py`, `test_decision_routes.py`, `test_investment_decision_store.py`, `test_investment_decision_read.py` | decision rows | change only if a test pins the exact `investment_decision` column list (new nullable `assumptions_as_of`); confirmed at the first S2b run | new column | S2b | U (verify) |
| `tests/api/signals/*`, `tests/api/risk/test_inputs.py:52-59` | DGS10 fixtures `4.2`, `5.5` | unchanged | unrelated to the resolver | n/a | U |

### Playwright (apps/web/tests/e2e)
Mock payloads gain the `assumptions` object with seed values, so rendered text stays "4.2%" / "5.5%".

| file:line | current (verbatim) | new | why | task | |
|---|---|---|---|---|---|
| `helpers/corporatePageMock.ts:196, 200` | `risk_free_rate: 0.042,` / `equity_risk_premium: 0.055,` (DCF breakdown) | kept; add `risk_free_source`, `risk_free_as_of`, `erp_source`, `erp_as_of` | breakdown gains fields | S3b | C (additive) |
| `helpers/corporatePageMock.ts:285,287` (metrics audit rows) plus metrics mock root | `value: 0.042, display_value: "4.2%", source: "Model policy i...` | source text = echoed source; add `assumptions: {risk_free_rate: 4.2, risk_free_source: "owner", risk_free_as_of: "2026-11-16", equity_risk_premium: 5.5, erp_source: "owner", erp_as_of: "2026-11-16", crp: 0.8, crp_basis: "non_mature_rule", stale: []}` | page reads `metrics.assumptions` | S3b | C |
| `helpers/corporatePageMock.ts:888-889, 927-928` | `risk_free_rate: 4.2,` / `equity_risk_premium: 5.5,` (comparison) | unchanged | snapshot values | n/a | U |
| `helpers/portfolioPageMock.ts:304` | `{ field: "risk_free_rate", label: "Risk-free rate", value: 0.042, display_value: "4.2%", source: "Model policy ...` | update source text only if the portfolio page renders it (check at S3b) | audit source now echoed | S3b | C (verify) |
| `fixtures/shared.ts:539-540` | `risk_free_rate: 4.2,` / `equity_risk_premium: 5.5,` | unchanged | comparison fixture | n/a | U |
| `corporate-detail-tabs.spec.ts:287-288` | `risk_free_rate: 4.2,` / `equity_risk_premium: 5.5,` | unchanged; add `assumptions` if that mock serves `/metrics` | page needs the object | S3b | C (additive) |
| `corporate-guide.spec.ts:98, 131, 157, 171` | `...the risk-free rate, 4.2%`, `name: "Risk-free: 4.2%"`, `Either side of the 4.2% growth reference.`, `toHaveText("Long-run growth 4.2%")` | unchanged (value from mock seed; bar label format kept, source/as-of in a separate caption, O3) | echoed rf = 4.2 | S3b | U |
| `corporate-guide.spec.ts:213, 217-219, 238, 260` | `1.37 x 5.5% = 7.5%`; `re-levers with the WACC's ERP 5.5% and tax 21%`; `4.2 + 1.23 x 5.5 + 0.8 = 11.8%`; `"Ke = rf + βL × ERP + CRP = 4.2% + 1.37 × 5.5% + 0.8% = 11.9%"`; `4.2 + 1.23 x 5.5 + 0 = 11.0%` | text unchanged; the mocks used at :217 and :260 must carry `assumptions` (:260 with `crp: 0`) | strings now produced from echoed seed values | S3a/S3b | U (mock additive) |
| `corporate-model.spec.ts:114` | `riskFreeRate: 4.2, impliedErp: 5.1, impliedMarketReturn: 9.3, countryRiskPremium: 0.8, taxRate: 0.25,` | unchanged (context field names kept) | D3 | S3a | U |
| `corporate-model.spec.ts:137, 140, 218, 221` | `"Ke = ... = 4.2% + 1.12 × 5.1% + 0.8% = 10.6%"`, `"ERP = IRR − rf = 9.3% − 4.2% = 5.1%"`, `"...4.2% + 0.87 × 5.5% + 0.8% = 9.9%"`, `"ERP = IRR − rf = 8.8% − 4.2% = 4.6%"` | unchanged | pure context fixtures | n/a | U |
| `corporate-model.spec.ts` (imports from `corporateConstants`) | imports of the module | drop `RISK_FREE_RATE` / `EQUITY_RISK_PREMIUM` imports if used (confirm at S3a) | constants deleted | S3a | C (import only) |
| `i18n-corporate-calc.spec.ts:34-35` | `equityRiskPremium: 5.5,` | unchanged | context field kept | n/a | U |
| `corporate-one-screen.spec.ts:635` | `country_risk_premium: 0.8, growth_cagr: 5.5, ...` | add `assumptions` to the mocked metrics; 1280x720 assertions unchanged | page needs object | S3b | C (additive) |
| `decisionsPageMock.ts:24,34,92`, `cases-fields.spec.ts:11`, `cases-real-api.spec.ts:15`, `casesApiMock.ts:18` | `risk_free_rate: 0.042` / `riskfree_rate: 0.042` | unchanged | frozen decision / case payloads | n/a | U |
| `en.ts:1192, 1203, 1247, 1266` and `ko.ts` counterparts | `manualMacro: "Manual macro assumption"`, `policyErpSource: "Model policy input, the same ERP as the WACC"`, `fredMacro: "FRED / macro assumption"`, `erpPolicy: "ERP = model policy {erp} (implied ERP {implied} shown for reference)"` | replaced by the `corporate.assumptions.*` source line; `erpPolicy` becomes "ERP = {erp} ({source}, {asOf}) ..."; any e2e text assertion on the old strings (grep `Model policy`, `FRED / macro`, `Manual macro` at S3b) changes with it | the FRED label is false today, true only when source is FRED | S3b | C |

**Count of existing assertions/sites that must change:** pytest **6** (helper changes in `test_metrics_cost_of_equity.py` and `test_country_risk_premium.py` = 2 helpers; `test_terminal_diagnostics.py` = 4 lines across :67-69, :86-88 = 2 call blocks); e2e **8** (two mock edits in `corporatePageMock.ts`, `portfolioPageMock.ts`, `corporate-detail-tabs.spec.ts`, `corporate-one-screen.spec.ts`, one import in `corporate-model.spec.ts`, `en.ts`, `ko.ts`). None of the numeric/text expectations (4.2%, 5.5%, 11.8%, etc.) change. About 110 explicit-argument sites and all frozen fixtures stay unchanged. "verify" rows are confirmed by a read-only grep at the start of their task and any change is reported back before editing.

## 6. Rollout notes

- Frozen persisted values: `investment_decision` (own rf/ERP copies; old rows `assumptions_as_of` NULL, UI shows "as-of unknown"), `corporate_comparison_snapshots` and rows (store rf/ERP; identity key includes them), valuation-case `riskfree_rate`, Monte Carlo rf. Saved `corporate_metrics.wacc` keeps its value; the S4 drift report lists rows off by more than 0.25 pt for the owner to re-save by hand.
- Day one: before any FRED cache entry newer than 7 days, rf comes from the seeded fallback (4.2, 2026-11-16), so numbers are identical. When the weekly signals job caches DGS10, rf switches to FRED and Ke moves (intended; UI shows "FRED DGS10, <date>"). After 90 days without FRED or a new fallback row, the stale badge appears.
- Both PCs: table and seed are created by `init_db()` on app start (idempotent, fixed PK); no `records_sync` step. Rows added later through PUT are local to that PC until O1 is decided. The FRED cache is per PC, so rf can differ by up to one weekly refresh; the echoed as-of makes this visible.
- Docs on completion: `docs/architecture/database-relationships.md`; `guideline/sop/todo.md` (replace the WACC/Ke scope and the deferred invalid-audit lines with the track).

## 7. Open points for the owner

- O1: Should `market_assumptions` join `records_sync` (append-only rows keyed by `(key, as_of)`) so an ERP entered on one PC reaches the other? Plan default: no.
- O2: `company_baseline` / `fair_value` defaults are removed (parameter required, callers pass the resolver rate); case semantics unchanged. Confirm this reading of answer 9.
- O3: The hurdle bar label `Risk-free: 4.2%` keeps its format; source and as-of go in a caption. Confirm.
- O4: `CorporateMetrics.wacc` / `cost_of_equity` become nullable (regenerates shared types); S2a lists consumers by grep before editing.
