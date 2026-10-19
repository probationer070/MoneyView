# Risk Engine and News Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the daily risk-signal evaluator, its alert record (live alerts plus alerts backfilled from 2016), the daily bar, quote-fact and news sweeps it depends on, topic and Korean news, and the `/api/v1/risk` API.

**Architecture:**
- **Pure evaluation** lives in `packages/core_finance/risk_signals/`. It takes pandas frames of closes, shares, theme assignments, FRED observations and a validated rules object. It knows no DB and no network.
- **The service layer** lives in `apps/api/services/risk/`:
  - It loads inputs from SQLite.
  - It runs the backfill and then evaluates live days with the same pure functions.
  - It persists alerts, sweeps data hourly from a `risk_cycle` task, and selects news per alert.
- **Routes** live in `apps/api/routes/risk.py`.

**Tech Stack:** Python 3.11, FastAPI, SQLite, pandas/numpy, pydantic v2, yfinance (through the existing acquisition layer), feedparser and Google News RSS, pytest, TypeScript shared types.

**Spec:** `docs/superpowers/specs/2026-10-19-risk-engine-design.md`. Its parent is `docs/superpowers/specs/2026-10-18-risk-signal-design.md`. Section numbers below (§3.4 and so on) refer to the risk-engine spec.

## Global Constraints

- Every threshold lives only in `apps/api/services/risk/rules.yaml`. No number from spec §3 may appear in code.
- The rules version is the first 8 hex characters of the sha256 of the rules file bytes.
- Warning ids are `W1, W2, W3, W4, W5, W7`. There is no W6. `warnings_total` is 6.
- The semis themes are `ai_semis, memory_storage, chip_equipment_design, optical_connectivity, analog_power_chips`. The excluded theme is `defensives_other`. The minimum is 3 members.
- The benchmark tickers are `^SOX`, `RSP`, `SPY`. They are stored in `stocks` and never added to `MARKET_INDICES`.
- The engine's FRED series are `BAMLH0A0HYM2, BAA10Y, DGS10, DCOILBRENTEU, DFEDTARU, CPILFESL, PCEPILFE, CPIAUCSL, PCEPI, PAYEMS`. Do not touch `signals/models.py` `KNOWN_SERIES` or `signals/rules.yaml`.
- Percent values in the API are percent numbers (`-18.6` means −18.6%) and are not rounded. Dates are `YYYY-MM-DD`. Timestamps are UTC ISO 8601.
- All responses use the `APIResponse[...]` envelope from `apps.api.models.schemas`.
- Background work is gated by `MONEYVIEW_DISABLE_STARTUP_JOBS` in the same way as `signal_cycle`.
- Network calls are paced sequentially:
  - 0.5 s between bar fetches
  - `NEWS_CRAWL_DELAY_SECONDS` (from `apps/api/routes/news.py`) between feed fetches
- A failure is logged and skipped, never raised into the cycle.
- Tests never touch the network or the real DB (`tests/conftest.py` guards both). Every new test is mutation-checked (CLAUDE.md §8). Each task's report names the mutation each test was shown to catch.
- Never `git stash`, `git checkout --`, or `--no-verify`. Do not commit `data/error/`, `design-sample/`, `.superpowers/`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Per task, run only the affected tests. The full `pytest` runs at plan end. 18 failures are this PC's known environment baseline (16 need `exchange_calendars`, 2 are regime route-count tests).

## Review Focus

1. **A ticker split inside the window.** Adjusted history is rewritten, so the index chain must still use only same-day-pair returns. Pinned in Task 3: a member whose close series is rescaled by 10× on every date leaves the index unchanged.
2. **A day where `^SOX` has a bar but most members do not** (the provider lags). Live evaluation must wait, not evaluate on 30% coverage. Pinned in Task 11: coverage 0.5 means no evaluation; coverage 0.5 after 24 h means evaluation with `bars_coverage` = 0.5 recorded.
3. **The app restarted mid-backfill.** Backfill must restart cleanly, not leave half a version's alerts. Pinned in Task 11: a crash injected after 100 days, then a rerun, gives the same alert list as one clean run.
4. **FRED unreachable and the cache empty for a series.** That warning becomes `unknown`, is not counted, and `/latest` still returns 200. Pinned in Task 4 (pure) and Task 13 (route).
5. **The general news feed after topic rows exist.** `GET /api/v1/news` with no ticker must not start showing macro and theme rows. Pinned in Task 12.

---

### Task 1: Cleanup keeps proxy and benchmark tickers; record the stalled-data defect

**Files:**
- Modify: `apps/api/services/watchlist_cleanup.py` (`referenced_tickers`, near `_REFERENCE_QUERIES` at :59)
- Create: `apps/api/services/risk/__init__.py` (empty), `apps/api/services/risk/constants.py`
- Modify: `ERROR-LOG.md` (new entry at the top, using the file's template), `guideline/sop/todo.md` (Track R: mark the cleanup defect fixed by this task)
- Test: `tests/api/test_watchlist_cleanup_references.py`

**Interfaces:**
- Produces: `apps.api.services.risk.constants`:
  - `BENCHMARK_TICKERS: tuple[str, ...] = ("^SOX", "RSP", "SPY")`
  - `RISK_FRED_SERIES: tuple[str, ...]` (the ten series from Global Constraints, in that order)
- Produces: `referenced_tickers(conn)` also returns:
  - every `numerator` and `denominator` of `apps.api.services.market_spreads.SPREAD_PAIRS`
  - every `BENCHMARK_TICKERS` entry

  It imports them lazily inside the function, the same way `acquisition/store.py` does, so the cleanup module stays light.

- [ ] **Step 1: Write the failing tests**
  - `test_spread_proxies_are_referenced`: on an empty isolated DB, `referenced_tickers(conn)` ⊇ `{"BOTZ","CIBR","SKYY","ICLN","XLE","ITA","^GSPC"}`.
  - `test_benchmarks_are_referenced`: ⊇ `{"^SOX","RSP","SPY"}`.
  - `test_pending_proxy_is_dropped_on_next_run`:
    - Insert `cleanup_pending('BOTZ', <31 days ago>)` and a `stocks` row for BOTZ.
    - Run `run_cleanup` (the function at :154 that reads `referenced`).
    - Assert that the BOTZ pending row is gone and the BOTZ `stocks` row remains.
- [ ] **Step 2:** Run `pytest tests/api/test_watchlist_cleanup_references.py -v`. Expect FAIL (BOTZ missing from the set).
- [ ] **Step 3:** Implement the constants module and the `referenced_tickers` addition. Do not add a SQL query for these: they are code constants.
- [ ] **Step 4:** Run the test file plus `pytest tests/api -k cleanup -q`. Expect PASS.
- [ ] **Step 5: Write the ERROR-LOG entry** (Date 2026-10-19).
  - **Failure:** daily bars for existing watchlist tickers and all news stopped at 2026-09-29 with no on-screen staleness signal.
  - **Root cause:** no scheduled sweep exists. Bars refresh only when a screen reads the ticker, and news only on a detail click. `acquisition/runner.py` `schedule_acquisition` says the registry warmer "arrives with the later phases".
  - **Fix:** this plan's Task 9 and Task 12 add the sweeps.
  - **Prevention:** `risk_daily.bars_coverage` and `/latest.data` expose coverage.
- [ ] **Step 6: Commit**
  - `git add` the files above.
  - `git commit -m "fix(cleanup): count market spread proxies and risk benchmarks as referenced"`

### Task 2: Rules file, strict model, loader

**Files:**
- Create: `packages/core_finance/risk_signals/__init__.py`, `packages/core_finance/risk_signals/config.py`
- Create: `apps/api/services/risk/rules.yaml`, `apps/api/services/risk/rules.py`
- Test: `tests/core_finance/test_risk_rules_config.py`

**Interfaces:**
- Produces: `config.RiskRules`, a pydantic model with `extra="forbid"` and `frozen=True` (the same `_Strict` base pattern as `signals/models.py`). Fields:
  - `price: {drop_pct: 4.0, down_days: 2, window: 20}`
  - `warnings_required: 3`
  - `w1: {series: BAMLH0A0HYM2, rise_pp: 0.30, rise_window: 10, level: 3.50, hy_from: 2023-11-06, proxy: {series: BAA10Y, rise_pp: 0.10, level: 1.9095}}`
  - `w2: {series: DGS10, level: 5.00, rise_pp: 0.40, rise_window: 20}`
  - `w3: {series: DCOILBRENTEU, rise_pct: 15.0, window: 20}`
  - `w4: {series: DFEDTARU, days: 60}`
  - `w5: {cpi_series: CPILFESL, pce_series: PCEPILFE, mm_pct: 0.30, cpi_known_day: 15}` (PCE is known at the end of M+1, which is fixed, not configurable)
  - `w7: {ratio_drop_pct: 5.0, sox_within_pct: 5.0, window: 60}`
  - `open_gate: {cap_share_pct: 20.0, sox_opens: true}`
  - `theme_exit: {recover_within_pct: 3.0, quiet_days: 5}`
  - `semis_themes: [...5 ids]`, `excluded_themes: [defensives_other]`, `min_members: 3`
  - `eval_start: 2016-01-04`, `history_start: 2015-06-01`
  - `crash_deck: {drop_pct: 10.0, window: 20, api_cards: 10}`
  - `candidates: {within_high_pct: 10.0, high_window: 63, corr_min: 0.6, corr_window: 63, crashed_drop_pct: 20.0, api_cards: 10}`
  - `news: {min_items: 10, max_items: 30, days_before: 7}`
  - `coverage: {min_share: 0.90, wait_hours: 24}`
  - `labels:` per warning id `{ko, en}`, and `rule_text:` per warning id `{ko, en}` (used by the API)

  All percents are positive numbers. Validators:
  - every number > 0
  - `semis_themes` and `excluded_themes` are subsets of `watchlist_themes.theme_ids()`. This check runs in the apps-side loader, because core must not import apps.
- Produces: `apps.api.services.risk.rules`:
  - `load_rules(path: Path | None = None) -> LoadedRules`, where `LoadedRules` is a frozen dataclass of `rules: RiskRules` and `version: str` (8 hex characters)
  - `get_rules() -> LoadedRules`, cached
  - `reload_rules() -> LoadedRules`
  - An invalid file raises `ValueError` naming the key.

- [ ] **Step 1: Write the failing tests**
  - `test_checked_in_rules_load`: `version` matches `^[0-9a-f]{8}$`, `rules.price.drop_pct == 4.0`, `rules.price.down_days == 2`, `rules.warnings_required == 3`, `rules.open_gate.cap_share_pct == 20.0`, `rules.theme_exit.quiet_days == 5`.
  - `test_unknown_key_rejected`: a YAML copy with `price.extra: 1` raises `ValueError`.
  - `test_unknown_theme_rejected`: `semis_themes: [nope]` raises `ValueError` mentioning `nope`.
  - `test_version_changes_with_content`: changing one byte of the file changes `version`.
  - `test_no_w6`: the model has no `w6` field, and a YAML with a `w6:` key is rejected.
- [ ] **Step 2:** Run `pytest tests/core_finance/test_risk_rules_config.py -v`. Expect FAIL (import error).
- [ ] **Step 3:** Implement the model, the YAML (values above verbatim) and the loader.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit with `feat(risk): rules file and strict loader`.

### Task 3: Theme indices and price shapes (pure)

**Files:**
- Create: `packages/core_finance/risk_signals/indices.py`
- Test: `tests/core_finance/test_risk_indices.py`

**Interfaces:**
- Produces: `theme_indices(closes: pd.DataFrame, shares: Mapping[str, float], themes: Mapping[str, str], min_members: int) -> pd.DataFrame`
  - Input: index = trading dates, columns = tickers, NaN where there is no bar. `themes` maps a ticker to its theme id.
  - Output: index = dates, columns = theme ids, level 100.0 on the first valid day, NaN on days with fewer than `min_members` members having both t−1 and t closes.
  - Day return = Σ(shareᵢ·closeᵢ,ₜ₋₁·rᵢ)/Σ(shareᵢ·closeᵢ,ₜ₋₁) over members with both closes. Tickers without shares are skipped.
  - After a NaN gap the level resumes from the last valid level. Gap returns are skipped.
- Produces: `theme_cap_share(closes, shares, themes) -> pd.DataFrame`
  - Per date and theme: the theme cap divided by the total cap over every ticker with shares and a close that day.
  - Cap = share × close of that day. The denominator includes excluded themes.
- Produces: `@dataclass(frozen=True) Shapes`, with fields `dd: pd.Series` (fraction ≤ 0 versus the rolling `window` max, including the day), `down: pd.Series` (int, consecutive down closes ending that day), `new_low: pd.Series` (bool, close ≤ rolling `window` min), `valid: pd.Series`.
- Produces: `price_shapes(level: pd.Series, window: int) -> Shapes`
  - The rolling functions use `min_periods=window` counted on non-NaN values, so dd and new_low are NaN or False until `window` valid values exist.
  - `down` counts `diff < 0`. A NaN diff resets it to 0.

- [ ] **Step 1: Write the failing tests**, each using small hand-built frames:
  - `test_chain_link_member_enters`: theme {A, B, C}. D enters on day 3 with a large price. The level change on day 3 equals the cap-weighted return of A, B, C only, plus D's return weighted by D's day-2 cap. If D has no day-2 close, it is excluded on day 3.
  - `test_split_rescale_does_not_move_index` (Review Focus 1): multiplying one member's entire close history by 10 leaves the theme level identical (`assert_series_equal`).
  - `test_below_min_members_is_nan_and_resumes`: 3 members, one missing on day 5. Day 5 is NaN, and day 6 resumes from day 4's level times day 6's return.
  - `test_no_shares_ticker_skipped`.
  - `test_cap_share_denominator_includes_excluded_theme`: the `defensives_other` cap is in the denominator.
  - `test_price_shapes_window`: with window 3 on `[10, 9, 8, 8.5, 7]`, `dd` at the last day is `7/9 - 1`, `down` is `[0, 1, 2, 0, 1]`, and `new_low` is True on the last day.
  - `test_shapes_need_full_window_after_gap`: after a NaN, `dd` stays NaN until `window` valid values exist.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement with pandas vectorised operations. The level loop over days may be a Python loop, as in the evidence `backtest.theme_indices`.
- [ ] **Step 4:** Expect PASS.
- [ ] **Step 5:** Commit with `feat(risk): cap-weighted theme indices and price shapes`.

### Task 4: Warnings (pure)

**Files:**
- Create: `packages/core_finance/risk_signals/warnings.py`
- Test: `tests/core_finance/test_risk_warnings.py`

**Interfaces:**
- Consumes: `RiskRules` (Task 2).
- Produces: `market_warnings(cal: pd.DatetimeIndex, fred: Mapping[str, pd.Series], sox: pd.Series, rsp: pd.Series, rules: RiskRules) -> WarningFrame`
  - `fred` maps a series id to an observation series (index = observation date, float values). A missing or empty series means `unknown`.
- Produces: `WarningFrame`, a frozen dataclass with:
  - `state: pd.DataFrame`: columns W1, W2, W3, W4, W5, W7; values `"on"`, `"off"`, `"unknown"`
  - `value: pd.DataFrame`: the float shown for each warning
    - W1: HY or BAA level
    - W2: DGS10
    - W3: Brent 20-day percent change
    - W4: days since the last hike, or NaN
    - W5: max(core CPI m/m, core PCE m/m) in percent
    - W7: ratio drop in percent
  - `observed_at: pd.DataFrame` of dates
  - `w1_proxy: pd.Series[bool]`
  - `on_count: pd.Series[int]` (counts `"on"` only)
- Rules, exact (spec §3.1):
  - **Daily series** (all but DFEDTARU): the value known at trading day t is the last observation dated ≤ t − 1 business day.
  - **W4:** on when a `DFEDTARU` increase has its observation date d with d ≤ t ≤ d + `days` calendar days, inclusive. There is no lag.
  - **Monthly series:** m/m of month M is known from day `cpi_known_day` of M+1 (CPI). For PCE it is known from the last calendar day of M+1.
  - **W1:**
    - For t ≥ `hy_from`, use HY: on when the 10-trading-day change ≥ `rise_pp` or the level ≥ `level`.
    - For t < `hy_from`, use the BAA proxy with the proxy thresholds, and set `w1_proxy` True.
    - For t ≥ `hy_from` with no HY value known, the state is `unknown`.
  - **W7:** on when sox/rsp ≤ (1 − 5%) × its 60-day max, and sox ≥ (1 − 5%) × its 60-day max. Both windows need 60 values.
  - Threshold comparisons use a 1e-9 tolerance, as the evidence does.

- [ ] **Step 1: Write the failing tests** with synthetic series:
  - `test_daily_lag_one_business_day`: a DGS10 observation of 5.10 dated Monday is not seen at Monday's evaluation and is seen Tuesday (W2 on).
  - `test_w4_no_lag_and_inclusive_60_days`: a hike dated 2026-09-16 gives W4 on for 2026-09-16 and 2026-11-15, and off for 2026-11-16.
  - `test_cpi_known_from_15th`: September m/m of 0.65 is first visible on 2026-10-15, not on 10-14.
  - `test_pce_known_from_month_end`: August PCE is first visible on 2026-09-30.
  - `test_w1_proxy_before_hy_from`: for a date before `hy_from`, a BAA level of 1.95 gives W1 on with `w1_proxy=True`. After `hy_from` with HY missing, the state is `unknown` and `on_count` excludes it (Review Focus 4).
  - `test_w7_breadth`: a ratio 6% below its max with SOX 2% below its max gives on. SOX 7% below gives off.
  - `test_missing_series_unknown`: `fred` without `DCOILBRENTEU` makes W3 `unknown` on every day.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS.
- [ ] **Step 5:** Commit with `feat(risk): six market warnings with release-time rules`.

### Task 5: Confirmation and alert lifecycle (pure)

**Files:**
- Create: `packages/core_finance/risk_signals/alerts.py`
- Test: `tests/core_finance/test_risk_alerts.py`

**Interfaces:**
- Consumes: `Shapes` and `price_shapes` (Task 3), `WarningFrame.on_count` (Task 4).
- Produces: `confirmations(theme_shapes: Mapping[str, Shapes], sox_shapes: Shapes, on_count: pd.Series, rules: RiskRules) -> Confirmations`
  - `Confirmations` is a frozen dataclass:
    - `theme: pd.DataFrame[bool]` over the trigger themes, meaning every theme with an index minus `excluded_themes`
    - `via: pd.DataFrame[str]` with `"theme"`, `"sox"` or `""`
    - `sox: pd.Series[bool]`
  - **Price test:** `dd ≤ −drop_pct/100` and `down ≥ down_days` and `valid`.
  - A semis theme also passes when the SOX price test passes and its own index is valid that day. `via="sox"` applies only when its own test fails.
  - Both tests additionally need `on_count ≥ warnings_required`.
- Produces:
  - `@dataclass ThemeStint(theme: str, via: str, joined: date, left: date | None, last_ref: date)`
  - `@dataclass OpenAlert(start: date, trigger: tuple[str, ...], stints: list[ThemeStint])`
  - `@dataclass AlertRecord(start: date, release: date | None, trigger: tuple[str, ...], stints: list[ThemeStint], reason: str | None)`
  - `run_alerts(dates: Sequence[date], conf: Confirmations, cap_share: pd.DataFrame, theme_shapes: Mapping[str, Shapes], rules: RiskRules, state: OpenAlert | None = None) -> tuple[list[AlertRecord], OpenAlert | None]`
    - It walks `dates` in order.
    - Trading-day distance is the position in the full `theme_shapes` index, not in `dates`, so a one-day call and a batch call agree.
- Exact lifecycle (spec §3.4):
  - **Open** when state is None, at least one theme is firing, and either (sum of `cap_share` over firing ≥ `cap_share_pct/100`) or (`sox_opens` and `sox` confirming that day). Every firing theme becomes a stint with `joined = last_ref = day`. No exit check is made on the open day.
  - **On later days, in this order:**
    1. Add a stint for each firing theme that has no active stint.
    2. For each active stint whose theme set a new low that day, set `last_ref = day`.
    3. For each active stint whose theme is not firing, close it (`left = day`) if `dd > −recover_within_pct/100` strictly, or if `pos(day) − pos(last_ref) ≥ quiet_days`.
  - **Close** the alert on the same day when no active stint remains, with `release = day` and `reason = "all_themes_out"`. A new alert may open on the next date, never the same one.

- [ ] **Step 1: Write the failing tests** with hand-built inputs:
  - `test_price_test_needs_both_drop_and_down_days`.
  - `test_semis_via_sox_requires_own_index_valid`.
  - `test_warning_count_gate`: `on_count` 2 means no confirmation.
  - `test_open_by_cap_share`: one theme firing with share 0.25 opens. With 0.19 and no SOX, nothing opens.
  - `test_open_by_sox_ignores_cap_share`.
  - `test_join_and_rejoin_make_two_stints`.
  - `test_quiet_exit_at_five_days`: with no new low after joining at position 10, the stint is still active at position 14 and left at position 15.
  - `test_new_low_resets_quiet_clock`.
  - `test_recover_exit_strict`: dd = −0.03 exactly stays. dd = −0.0299 leaves.
  - `test_still_firing_never_leaves`.
  - `test_close_then_reopen_next_day_not_same_day`.
  - `test_excluded_theme_never_fires`: a `defensives_other` frame never appears in `Confirmations.theme`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS.
- [ ] **Step 5:** Commit with `feat(risk): theme confirmation and alert lifecycle`.

### Task 6: Decks and outcomes (pure)

**Files:**
- Create: `packages/core_finance/risk_signals/decks.py`
- Test: `tests/core_finance/test_risk_decks.py`

**Interfaces:**
- Produces: `crash_deck(closes: pd.DataFrame, day: date, rules: RiskRules) -> list[CrashCard]`
  - `CrashCard(ticker, drawdown_pct: float, high_date: date, high_close: float, close: float, closes_30d: list[float])`
  - It includes every ticker whose close is ≤ (1 − 10%) × its 20-day max including the day, with a full window.
  - Sorted by `drawdown_pct` ascending (most negative first), then ticker.
- Produces: `candidates(closes: pd.DataFrame, sox: pd.Series, day: date, rules: RiskRules) -> list[CandidateCard]`
  - `CandidateCard(ticker, pct_from_high63: float, corr: float, corr_with: str)`
  - Universe: tickers with close ≥ (1 − 10%) × their 63-day max.
  - Partners: `"^SOX"`, plus tickers ≤ (1 − 20%) × their 63-day max, never the ticker itself.
  - Correlation is computed on the last 63 daily returns, using pairwise rows with both values. At least 40 pairs are needed, else that partner is skipped.
  - Keep tickers whose best partner has corr ≥ 0.6. Sort by corr descending, then ticker.
- Produces: `forward_returns(level: pd.Series, day: date, horizons=(5, 10, 20)) -> dict[str, float | None]`
  - Keys `fwd5`, `fwd10`, `fwd20` are percent changes from `day`'s close to the close h valid rows later.
  - The key `max_dd10` is the minimum over the next 10 rows of (close / day close − 1) × 100.
  - A value is `None` when the horizon is beyond the data.
- Produces: `primary_theme(trigger: Sequence[str], dd_on_start: Mapping[str, float]) -> str` (the deepest dd; ties broken by theme id).
- Produces: `is_useful(trigger: Sequence[str], levels: pd.DataFrame, start: date) -> bool | None` (True if any trigger theme's `max_dd10 ≤ −5.0`; None if any trigger theme has fewer than 10 rows after start and none is already ≤ −5.0).

- [ ] **Step 1: Write the failing tests:**
  - `test_crash_threshold_and_order`.
  - `test_candidate_universe_and_partner_exclusion`: a ticker is never its own partner, and a crashed ticker is not in the universe.
  - `test_candidate_corr_threshold`.
  - `test_forward_returns_none_beyond_data`.
  - `test_primary_theme_deepest`.
  - `test_useful_needs_ten_days`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS.
- [ ] **Step 5:** Commit with `feat(risk): crash and candidate decks and forward outcomes`.

### Task 7: Fixture, acceptance and equality tests

**Files:**
- Create: `scripts/risk/build_risk_fixture.py`
- Create: `tests/fixtures/risk/closes.csv` (wide: `date` plus one column per ticker including `^SOX` and `RSP`, 2026-01-02..2026-10-16), `shares.csv` (`ticker,shares`), `themes.csv` (`ticker,theme`), `fred/<SERIES>.csv` (`date,value`, from 2025-01-01)
- Create: `packages/core_finance/risk_signals/evaluate.py`
- Test: `tests/core_finance/test_risk_acceptance.py`

**Interfaces:**
- Consumes: Tasks 2 to 6.
- Produces: `evaluate_range(closes: pd.DataFrame, sox: pd.Series, rsp: pd.Series, shares: Mapping[str, float], themes: Mapping[str, str], fred: Mapping[str, pd.Series], rules: RiskRules, *, start: date, end: date, state: OpenAlert | None = None) -> EvaluationResult`
  - It is the one entry point the service uses for both backfill and live.
  - `EvaluationResult`:
    - `days: list[DayResult]`
    - `closed: list[AlertRecord]`
    - `open: OpenAlert | None`
    - `levels: pd.DataFrame` (theme indices, used by outcomes)
  - `DayResult(day: date, warnings: dict[str, tuple[str, float | None, date | None]], w1_proxy: bool, on_count: int, confirming: dict[str, str], sox_confirm: bool, cap_share: float, opened: bool)`
  - Inputs before `start` are used only for windows. Days are evaluated from `start` to `end` inclusive, over the dates where `sox` has a value.
- **The fixture script** reads the evidence pipeline's cache:
  - `cache/yf_close.csv` merged with `db_close.csv` the same way `backtest.load_prices` does
  - `cache/shares.csv`, `cache/watchlist.csv`, `cache/fred_*.csv`

  Its argument is `--cache <dir>`, default `C:\Users\eajwa\AppData\Local\Temp\claude\C--Learn-Economy-MoneyView\eff61464-eb4c-4371-838d-2002f30d8aaa\scratchpad\bt2\cache`. If the cache is gone, rerun `docs/superpowers/specs/2026-10-19-risk-engine-evidence/fetch_data.py` from a copy outside the repo. It writes the trimmed CSVs above and never writes anything else. It is run once and its output is committed.

- [ ] **Step 1:** Run `python scripts/risk/build_risk_fixture.py` and commit the fixture files. Check that the total fixture size is under 3 MB (`du -sh tests/fixtures/risk`).
- [ ] **Step 2: Write the failing tests**, loading the fixture and calling `evaluate_range(start=2026-06-01, end=2026-10-16)`:
  - `test_alert_opens_2026_10_08`: the `DayResult` for 10-08 has `opened=True`, and the open alert's trigger ⊇ the five semis themes.
  - `test_nothing_up_on_10_01_and_10_02`: no alert is open or closed spanning those days.
  - `test_warnings_on_10_08`: W1, W2, W3, W4 are `"on"` and W5, W7 are `"off"`. If the fixture computes otherwise, follow spec §8 item 3: data wins. Fix the spec text in the same commit and say so in the report. Do not bend the code.
  - `test_day_by_day_equals_batch`: calling `evaluate_range` one day at a time (passing `state` forward, with every input truncated to ≤ that day) yields the same closed alerts, the same open alert and the same `DayResult.confirming` per day as one call. This pins no look-ahead.
- [ ] **Step 3:** Run the tests. Expect FAIL (no `evaluate_range`).
- [ ] **Step 4:** Implement `evaluate.py`, which composes Tasks 3 to 6.
- [ ] **Step 5:** Expect PASS.
- [ ] **Step 6:** Commit with `test(risk): 2026-10-08 acceptance on a fixed fixture; batch equals day-by-day`.

### Task 8: Storage and news columns

**Files:**
- Modify: `apps/api/services/db.py`
  - Add the risk tables to the schema SQL next to `fred_cache` (~:247).
  - Add the `news.lang` and `news.topic` migrations next to the `watchlist.theme` ALTER (~:1006).
- Create: `apps/api/services/risk/store.py`
- Test: `tests/api/risk/__init__.py`, `tests/api/risk/test_store.py`

**Interfaces:**
- Tables: exactly spec §7, plus:
  - `risk_alerts.id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `risk_alerts.release_reason TEXT NULL` with values `all_themes_out` and `rules_changed`
  - `status CHECK IN ('open','released')`
  - `origin CHECK IN ('live','backfill')`
  - `risk_alert_cards.snapshot CHECK IN ('start','latest')`
  - `risk_alert_cards.deck CHECK IN ('crash','candidate')`
  - `risk_daily` primary key `(date, rules_version)`
  - `risk_alert_themes` primary key `(alert_id, theme, joined_date)`
  - `risk_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)`
- `news` gets `lang TEXT NOT NULL DEFAULT 'en'` and `topic TEXT NOT NULL DEFAULT ''`.
- Produces, in `apps.api.services.risk.store`:
  - `save_day(result: DayResult, version: str, origin: str, coverage: float, evaluated_at: str) -> None`
  - `last_evaluated(version: str) -> date | None`
  - `insert_alert(start: date, trigger: Sequence[str], version: str, origin: str, primary_theme: str, w1_proxy: bool) -> int`
  - `close_alert(alert_id: int, release: date, reason: str) -> None`
  - `upsert_stint(alert_id: int, stint: ThemeStint, dd_at_join: float | None, outcome: Mapping[str, float | None]) -> None`
  - `replace_cards(alert_id: int, snapshot: str, deck: str, cards: Sequence[CrashCard | CandidateCard], as_of: date) -> None`
  - `open_alert(version: str) -> StoredAlert | None`
  - `list_alerts(version: str | None, origin: str, limit: int) -> list[StoredAlert]`
  - `get_alert(alert_id: int) -> StoredAlert | None`
  - `latest_day(version: str) -> StoredDay | None`
  - `get_state(key: str) -> str | None`, `set_state(key: str, value: str) -> None`
  - `purge_version(version: str, *, include_live: bool = False) -> None`: deletes `backfill` alerts with their themes and cards, plus `risk_daily` rows, for that version. It keeps `live` alerts unless asked.
  - `StoredAlert` mirrors the `risk_alerts` row plus `stints: list` and `cards: dict[(snapshot, deck), list]`. `StoredDay` mirrors a `risk_daily` row with parsed JSON.
- State keys:
  - `live_start:<version>` (ISO date)
  - `backfill:<version>` (`running`, `done` or `failed`)
  - `news_swept_at` (ISO timestamp)
  - `news_last_sweep_failed` (`"1"` or `"0"`)
  - `deep_history:<ticker>` (ISO date)
  - `coverage_wait:<date>` (ISO timestamp of the first wait)

- [ ] **Step 1: Write the failing tests:**
  - `test_tables_created_on_init` (via `with TestClient(app)`).
  - `test_old_news_table_migrates_lang_topic`: create the old `news` schema in a temp DB, call `init_db`, and the rows keep their data with `lang='en'` and `topic=''`.
  - `test_purge_version_keeps_live`.
  - `test_rejoin_stint_two_rows`.
  - `test_cards_latest_overwritten_start_kept`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS. Also run `pytest tests/api -k "news or db" -q`.
- [ ] **Step 5:** Commit with `feat(risk): alert record tables and news lang/topic columns`.

### Task 9: Daily sweep, deep history and quote facts

**Files:**
- Create: `apps/api/services/risk/sweep.py`
- Test: `tests/api/risk/test_sweep.py`

**Interfaces:**
- Consumes: `acquisition.runner.acquire` and `acquire_point_in_time`, `acquisition.sources.bars.fetch_bars`, `acquisition.ranges.FetchRange`, the quote-facts fetcher, saver and coverage used at `corporate_comparison.py:1206`, `BENCHMARK_TICKERS`, `risk.store` state.
- Produces: `SweepReport(attempted: int, fetched: int, failed: list[str])`, a frozen dataclass. A failure never raises.
- Produces: `sweep_bars(now: datetime, *, tickers: Sequence[str] | None = None, fetcher=fetch_bars, sleep=time.sleep) -> SweepReport`
  - `tickers` defaults to the watchlist plus `BENCHMARK_TICKERS`.
  - It calls `acquire("equity_bars", t, now=now, fetcher=fetcher)` per ticker, in order, and sleeps 0.5 s before each call after one that reached the provider (`result.reason != "fresh"`).
- Produces: `ensure_deep_history(tickers: Sequence[str], *, history_start: date, today: date, fetcher=fetch_bars, saver=None, sleep=time.sleep) -> SweepReport`
  - For tickers without `deep_history:<t>`: find the first stored bar date f.
  - If f is None or f > `history_start`, fetch `FetchRange(history_start, f or today + 1 day, "deep_history")` and save with the default saver (`runner._default_saver`).
  - Then set `deep_history:<t>` to today. A ticker with no rows returned is still marked, because it was listed later.
- Produces: `ensure_quote_facts(tickers: Sequence[str], now: datetime) -> SweepReport`: for tickers with no `shares_outstanding`, call `acquire_point_in_time("market_cap", ...)` exactly as `corporate_comparison.py:1206` does.

- [ ] **Step 1: Write the failing tests** with an injected fetcher and an isolated DB:
  - `test_sweep_includes_benchmarks`: the fetcher is called for `^SOX`, `RSP`, `SPY` plus the watchlist rows.
  - `test_sweep_fresh_skips_and_no_sleep`: a second call at the same `now` makes no fetcher calls and no sleeps.
  - `test_deep_history_fetches_before_first_bar_once`: the stored first bar is 2016-09-15. The fetcher gets start 2015-06-01 and end 2016-09-15. A second call makes no fetch.
  - `test_failed_ticker_reported_not_raised`.
  - `test_quote_facts_only_missing_shares`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS. Also run `pytest tests/api/acquisition -q`.
- [ ] **Step 5:** Commit with `feat(risk): daily bar sweep, deep history and missing quote facts`.

### Task 10: Inputs loader

**Files:**
- Create: `apps/api/services/risk/inputs.py`
- Test: `tests/api/risk/test_inputs.py`

**Interfaces:**
- Consumes: `signals.fetch.SeriesFetcher` and `fred_source_from_env`, `signals.store.load_cache`, `RISK_FRED_SERIES`, `BENCHMARK_TICKERS`, `risk.rules.get_rules`.
- Produces: `RiskInputs(closes: pd.DataFrame, sox: pd.Series, rsp: pd.Series, shares: dict[str, float], themes: dict[str, str], names: dict[str, str], fred: dict[str, pd.Series], fred_errors: list[str])`
- Produces: `load_inputs(*, through: date | None = None, fetch_fred: bool = True, now: datetime | None = None) -> RiskInputs`
  - `closes` covers watchlist tickers from `stocks`, from `history_start` through `through`. `sox` and `rsp` come from `stocks`.
  - `shares` comes from `corporate_quote_facts.shares_outstanding`, excluding NULL.
  - `themes` comes from `watchlist.theme`, excluding empty.
  - `fred`:
    - With `fetch_fred`, it fetches each series through `SeriesFetcher(fred_source_from_env(), now=...)` from 2014-01-01, which writes `fred_cache`.
    - Otherwise it reads `load_cache`.
    - A fetch error is recorded in `fred_errors` and the cache is used.
- Produces: `coverage(closes: pd.DataFrame, themes: Mapping[str, str], day: date, rules: RiskRules) -> float`: the share of trigger-theme tickers (themes not in `excluded_themes`) with a close on `day`.

- [ ] **Step 1: Write the failing tests:**
  - `test_loads_closes_shares_themes` (seeded isolated DB).
  - `test_fred_from_cache_when_no_key` (`fred_errors` names the key reason).
  - `test_coverage_counts_only_trigger_themes` (a `defensives_other` ticker missing a bar does not lower coverage).
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS.
- [ ] **Step 5:** Commit with `feat(risk): load evaluation inputs from the local DB and FRED cache`.

### Task 11: Evaluator service (backfill, live, rules change)

**Files:**
- Create: `apps/api/services/risk/evaluator.py`
- Test: `tests/api/risk/test_evaluator.py`

**Interfaces:**
- Consumes: Tasks 6 to 10.
- Produces: `evaluable_day(inputs: RiskInputs, day: date, now: datetime, rules: RiskRules) -> tuple[bool, float]`
  - It returns (ok, coverage).
  - **ok** when `sox` and `rsp` have a bar on `day` and `coverage ≥ min_share`, or when `coverage_wait:<day>` is older than `wait_hours`.
  - Otherwise it records the wait start if absent and returns (False, coverage).
- Produces: `run_backfill(now: datetime, *, inputs: RiskInputs | None = None) -> None`
  - It calls `apply_rules_change(now)` first. It returns at once when `backfill:<v>` is `done`.
  - Otherwise:
    1. Set `running` and call `purge_version(v)`.
    2. On a fresh install, run `ensure_deep_history` and `ensure_quote_facts` (Task 9) and reload inputs.
    3. Set `live_start:<v>` if unset to the latest trading day for which `evaluable_day` is ok.
    4. `evaluate_range(eval_start, live_start − 1)` and persist every day and alert with origin `backfill` (stints, start and latest cards, outcomes, primary theme, `w1_proxy`).
    5. Persist the still-open alert, if any, as `status=open`.
    6. Set `done`.
  - Any exception sets `failed` and logs.
- Produces: `evaluate_pending(now: datetime, *, inputs: RiskInputs | None = None) -> list[int]`
  - It does nothing unless `backfill:<v> == done`.
  - For each trading day after `last_evaluated(v)` (or from `live_start`) up to the latest day where `evaluable_day` is ok, in order, it calls `evaluate_range(day, day, state=<open alert from store>)` and persists with origin `live`.
  - It continues an open `backfill` alert, keeping its origin.
  - It refreshes `latest` cards each day an alert is open.
  - It fills `None` forward-return fields of stints and start cards whose horizon has now passed (current version only).
  - It returns the ids of alerts opened during this call.
- Produces: `apply_rules_change(now: datetime) -> None`
  - If the current version has no `live_start`, close every `open` alert of another version with `release_date` = that version's last evaluated day and `release_reason = "rules_changed"`.
  - Then call `purge_version(old)` for every other version (`backfill` rows and `risk_daily`, keeping `live`).

- [ ] **Step 1: Write the failing tests** with a fixture-seeded isolated DB (load `tests/fixtures/risk` into `stocks`, `corporate_quote_facts`, `watchlist`, `fred_cache`):
  - `test_backfill_then_live_continue_open_alert`: with `live_start` forced to 2026-10-12 and `eval_start` overridden to 2026-06-01 through a rules fixture, the 10-08 alert is `origin=backfill` and still open after `evaluate_pending` covers 10-12..10-16.
  - `test_backfill_idempotent`.
  - `test_restart_mid_backfill_same_result` (Review Focus 3): monkeypatch `store.save_day` to raise after 100 calls, rerun, and compare `list_alerts` with a clean run.
  - `test_coverage_wait_then_evaluate_after_24h` (Review Focus 2).
  - `test_rules_change_closes_old_live_and_rebackfills`.
  - `test_outcomes_filled_later`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS.
- [ ] **Step 5:** Commit with `feat(risk): backfill and live evaluation with rules-change handling`.

### Task 12: Topic, theme and Korean news; alert news selection

**Files:**
- Create: `apps/api/services/risk/news_queries.yaml`, `apps/api/services/risk/news.py`
- Modify: `apps/api/services/webscrap/Crawler/StockNewsCrawler.py`
  - `crawl` gains `lang: str = "en"`. `"ko"` uses `hl=ko&gl=KR&ceid=KR:ko`.
  - It gains `query: str | None = None` to search a raw query instead of "<name> stock news".
- Modify: `apps/api/services/news_service.py`. The no-ticker and keyword paths of `get_news` add `WHERE topic = ''`. `save_article` writes `lang` and `topic`. The identity hash uses `topic` when `ticker` is empty.
- Modify: the `NewsArticle` schema (find it under `apps/api/models/`) to add optional `lang: str = "en"` and `topic: str = ""`.
- Test: `tests/api/risk/test_news.py`

**Interfaces:**
- **YAML:**
  - `topics:` a list of `{id, ko, en, queries: {en: [...], ko: [...]}, series: [...]}` for `cpi, pce, fomc, jobs, treasury, credit, oil`, with the series from spec §5.1.
  - `themes:` maps a theme id to `{en: "...", ko: "..."}` for all 24 themes.
  - `ko_names:` maps a ticker to its Korean name. Use the top 5 by current market cap of each semis theme and `big_tech`, chosen by one read-only query over the real DB's `corporate_quote_facts` (the controller supplies the list in the dispatch). It is about 30 entries.
  - It is validated strictly. Theme ids must be in `theme_ids()` and series in `RISK_FRED_SERIES`.
- Produces: `sweep_news(now: datetime, *, crawler=None, sleep=time.sleep, tickers: Sequence[str] = ()) -> SweepReport`
  - Every topic × language, then every theme × language, then the given tickers in English, plus Korean when they have a `ko_names` entry.
  - Rows are saved with `ticker=''`, `topic='macro:<id>'` or `'theme:<id>'`, and `lang`.
  - It sets `news_swept_at`, and `news_last_sweep_failed` to `"1"` when every feed failed.
- Produces: `select_alert_news(alert: StoredAlert, today: date, rules: RiskRules) -> AlertNews`
  - `AlertNews(items: list[NewsItem], shortfall: int, note: str | None)`
  - `NewsItem(title, url, source, published_date, lang, kind: "macro" | "industry", topic: str | None, theme: str | None, ticker: str | None)`
  - Window: `[start − days_before, release or today]` on `published_date`.
  - Order: macro by topic order, newest first within a topic; then the alert's theme rows; then crash-deck tickers (latest snapshot).
  - Dedupe by URL or normalised title (lowercase, strip a trailing `" - <source>"`, collapse whitespace), keeping the first.
  - Cap at `max_items`. `shortfall = max(0, min_items − len)`.
  - `note`: `"before_collection"` if the window ends before the earliest news row; `"feed_failed"` if `news_last_sweep_failed == "1"`; else None.
- Produces: `macro_figures(alert: StoredAlert, fred: Mapping[str, pd.Series], as_of: date) -> list[MacroFigure]`
  - `MacroFigure(topic, series, label: {ko, en}, kind: "mm_pct" | "level", latest: {period, value}, prior: {period, value})`
  - Per topic series, the latest two values known at `as_of`: monthly m/m percent through the release rules of Task 4; daily level.

- [ ] **Step 1: Write the failing tests** with a fake crawler:
  - `test_topic_rows_saved_with_topic_and_lang`.
  - `test_general_feed_excludes_topic_rows` (Review Focus 5): after saving one ticker row and one topic row, `NewsService().get_news()` returns only the ticker row.
  - `test_ko_only_for_ko_names`.
  - `test_select_order_macro_first_and_dedupe`.
  - `test_shortfall_when_under_ten`.
  - `test_before_collection_note`.
  - `test_macro_figure_respects_release_day`.
  - `test_crawler_ko_url` (the URL contains `hl=ko&gl=KR&ceid=KR:ko`; use a fake feed parser).
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS. Also run `pytest tests/api -k news -q`.
- [ ] **Step 5:** Commit with `feat(risk): topic, theme and Korean news with alert news selection`.

### Task 13: API routes, schemas, shared types

**Files:**
- Create: `apps/api/models/schema_parts/risk.py`, `apps/api/routes/risk.py`, `packages/shared-types/risk.ts`
- Modify: `apps/api/main.py`. Register `risk_router` with prefix `/api/v1/risk` and tag `Risk`, after `signals_router`.
- Modify: `packages/shared-types/index.ts` to add `export * from "./risk";`.
- Test: `tests/api/risk/test_routes.py`

**Interfaces:**
- Pydantic models: `RiskLatest`, `RiskWarning`, `RiskAlertDetail`, `RiskAlertSummary`, `ThemeStintOut`, `CrashCardOut`, `CandidateCardOut`, `DeckOut`, `NewsItemOut`, `MacroFigureOut`, `OutcomeOut`.
  - Fields are exactly spec §6.1 to §6.3.
  - Theme `label` `{ko, en}` comes from `watchlist_themes.load_themes()`.
  - Warning `label` and `rule` come from `rules.yaml` `labels` and `rule_text` (Task 2).
  - `name` on cards comes from `watchlist.name`.
  - `headlines` on crash cards are the newest 0 to 2 `news` rows for that ticker (any `lang`) inside the alert's news window.
- Routes:
  - `GET /latest -> APIResponse[RiskLatest]`
  - `GET /history -> APIResponse[list[RiskAlertSummary]]`
    - `origin: Literal["all","live","backfill"] = "all"`
    - `limit: int = Query(50, ge=1, le=500)`
    - `rules_version: str | None = None` (default: the current version)
  - `GET /alerts/{alert_id} -> APIResponse[RiskAlertDetail]`. An unknown id gives 404 with detail `unknown_alert:<id>`.
- Every case in the spec §6.1 table must be reachable: never evaluated, no open alert, backfill running, backfill failed.
- `risk.ts` mirrors the Python models one-to-one. Its header comment is `/** Mirrors apps/api/models/schema_parts/risk.py. */`.

- [ ] **Step 1: Write the failing tests** with `with TestClient(app)` and a seeded DB:
  - `test_latest_never_evaluated`: 200, `as_of` null, `warnings` [], `alert` null.
  - `test_latest_open_alert_shape`: keys match spec §6.2, cards ≤ 10, `total` correct.
  - `test_latest_no_alert_has_last_alert`.
  - `test_latest_backfill_running`.
  - `test_latest_unknown_warning_value_null` (Review Focus 4).
  - `test_history_filters_and_limit_bounds` (`limit=0` and `501` give 422).
  - `test_alert_404`.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS. Also run `npm run typecheck` in `apps/web`.
- [ ] **Step 5:** Commit with `feat(risk): /api/v1/risk latest, history and alert detail`.

### Task 14: `risk_cycle` schedule and app wiring

**Files:**
- Create: `apps/api/services/risk/schedule.py`
- Modify: `apps/api/main.py`. In the lifespan, run `risk.rules.reload_rules()` next to the signals `reload_rules`. Inside the `if not startup_jobs_disabled:` block, append `asyncio.create_task(risk_cycle())`.
- Test: `tests/api/risk/test_schedule.py`

**Interfaces:**
- Produces: `run_once(now: datetime) -> list[int]`, which runs, in order:
  1. `sweep_bars(now)`.
  2. `run_backfill(now)`.
  3. `evaluate_pending(now)`.
  4. `sweep_news(now)` if `news_swept_at` is older than 12 h.
  5. For each newly opened id, `sweep_news(now, tickers=<crash-deck top 10 of that alert>)`.

  It returns the new ids. Each step's exception is logged and the next step still runs.
- Produces: `async def risk_cycle(interval_seconds: float = 3600.0) -> None`: it loops `await asyncio.to_thread(run_once, utc_now())`, then sleeps. An exception is logged and the loop continues. This mirrors `signals/schedule.signal_cycle`.

- [ ] **Step 1: Write the failing tests:**
  - `test_run_once_order`: with monkeypatched functions, the call order is sweep, backfill, evaluate, news.
  - `test_news_skipped_within_12h`.
  - `test_new_alert_triggers_ticker_news`.
  - `test_step_exception_does_not_stop_later_steps`.
  - `test_cycle_not_started_when_jobs_disabled`: the lifespan under the test conftest creates no `risk_cycle` task.
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS.
- [ ] **Step 5:** Commit with `feat(risk): hourly risk cycle wired into the app lifespan`.

### Task 15: Backfill reproduction script, records and docs

**Files:**
- Create: `scripts/risk/reproduce_backfill.py`
- Modify: `docs/architecture/database-relationships.md` and `docs/architecture/data-flow.md` (replace the planned §3.3 and §12 risk sections with the built tables and flow), `guideline/sop/todo.md` (Track R: ② status), `docs/INDEX.md` (add the plan)
- Test: `tests/scripts/test_reproduce_backfill.py`

**Interfaces:**
- Script:
  - `python scripts/risk/reproduce_backfill.py [--db PATH] [--compare docs/superpowers/specs/2026-10-19-risk-engine-evidence/report3.md]`
  - It opens the DB read-only (`file:...?mode=ro`), loads inputs with `fetch_fred=False`, runs `evaluate_range(eval_start, last day)` in memory, and prints a table of alerts (start, release, trigger, warnings on).
  - It also prints a diff against the 11 alerts parsed from the report's "Pick: every alert" table: matched (same start date), missing and extra.
  - It never writes.
- Produces: `parse_report_alerts(md: str) -> list[ExpectedAlert]` with `ExpectedAlert(start: date, release: date | None, trigger: tuple[str, ...])`, and `diff_alerts(expected, actual) -> AlertDiff(matched, missing, extra)`.

- [ ] **Step 1: Write the failing tests:**
  - `test_parse_report_alerts_reads_eleven` (on the committed `report3.md`; the first start is 2019-01-29 and the last is 2026-10-08 with release None).
  - `test_diff_alerts_matched_missing_extra`.
  - `test_script_is_read_only` (the DB file's bytes are unchanged after running on a temp DB copy).
- [ ] **Step 2:** Run the tests. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Expect PASS.
- [ ] **Step 5:** Update the docs listed above.
- [ ] **Step 6:** Commit with `feat(risk): backfill reproduction script; docs for the built risk engine`.
- [ ] **Step 7 (owner-gated, controller only, not the implementer):**
  - Running deep history and the sweeps against the owner's real DB writes about 10 years of bars and quote facts into it. Ask the owner first.
  - After OK: back up `data/processed/moneyview.db` to the scratchpad. Run one `run_once` in-process with `with TestClient(app)`. Then run `reproduce_backfill.py`.
  - Record the diff in spec §3.5 (data wins, R-B6), and say what differed.
