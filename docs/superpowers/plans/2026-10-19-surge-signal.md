# Surge Signal and Daily Movers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the built risk engine with three things:
- a per-theme surge signal (magnitude, EMA slope acceleration, breadth, RSI) with a cap-gated banner
- a daily "top-5 gainers" record
- trailing-window live evaluation

**Architecture:**
- **Pure layer** (new files in `packages/core_finance/risk_signals/`):
  - surge indicators and their per-theme lifecycle
  - the movers ranking
- **Wiring:** `evaluate_range` composes them next to the crash logic and carries a `SurgeState` across calls, the same way it carries `OpenAlert`.
- **Service:** it persists events and movers. Live days load only a trailing window.
- **API:** `/api/v1/risk` gains the fields and routes of spec §8.

**Tech Stack:** Python 3.11, pandas/numpy, pydantic v2, FastAPI, SQLite, pytest, TypeScript shared types.

**Spec:** `docs/superpowers/specs/2026-10-19-surge-signal-design.md`. The existing engine is in `docs/superpowers/specs/2026-10-19-risk-engine-design.md` and was built by `docs/superpowers/plans/2026-10-19-risk-engine.md`.

## Global Constraints

- **Rule values.**
  - Every surge and movers threshold lives only in `apps/api/services/risk/rules.yaml`, under the new `surge:` and `movers:` keys.
  - The crash-alert values do not change (spec S-D6).
- **Surge values (spec §3.1).**
  - EMA n = 10; accel lag k = 3; magnitude Z ≥ 2.0 over the 60-row return stdev ending 5 rows earlier (min 40 values) × √5.
  - accel_rank ≥ 0.95 against the previous 250 accel values (min 120).
  - Breadth ≥ 60% of members with a positive 5-row return.
  - RSI: Wilder 14 crossed up through 60 within the last 5 rows, and now 60..80. Overheated is RSI > 80.
  - Event gap: 10 rows. Event end: close < EMA10, or 10 rows without a new 20-row high.
  - Banner gate: themes in an event hold ≥ 20% of watchlist cap, or `^SOX` is in an event.
- **Row counting.** Indicators count each theme's valid rows. Event-end counting uses calendar rows (spec §3.1–3.2).
- **Movers:** top 5 by 1-day return, watchlist only (no benchmarks).
- **Live window:** 400 valid rows per trigger theme, extended per spec §5. FRED is never trimmed.
- **Equality** (spec §5): flags, dates and starts/ends must match exactly; numbers must match within relative 1e-9.
- **API shape:**
  - Percents are percent numbers and unrounded. Dates are `YYYY-MM-DD`.
  - Responses use `APIResponse[...]`.
  - Backfill rows are visible only when the backfill is `done` or `degraded`.
- **Inherited constraints from the risk-engine plan:**
  - Tests touch neither the network nor the real DB.
  - Every new test is mutation-checked (CLAUDE.md §8).
  - Never `git stash`, `checkout --`, `reset --hard`, or `--no-verify`.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Run affected tests per task; run the full suite at the end.

## Review Focus

1. **A theme with a <3-member gap inside the live window.** Its 250-value quantile must still come out equal to the full-history run. Pinned in Task 7, using a fixture theme with a forced gap.
2. **A surge event that started before the live window.** It must continue from stored state, not restart or vanish. Pinned in Task 7.
3. **Risk banner and surge banner on the same day.** Both flags are stored and the API serves both. Priority is ③'s concern. Pinned in Task 8.
4. **The rules version change on first start after deploy.** One recompute; the risk alert list stays identical apart from ids. Pinned in Task 7 on the fixture.
5. **Movers on a day where fewer than 5 names have both closes.** Return what exists, never pad. Pinned in Task 4.

---

### Task 1: Regenerate the chosen setting's evidence; build the long fixture

**Files:**
- Modify (scratch, not repo): `…/scratchpad/bt2/surge.py`. Add a run for the chosen setting `n10 k3 Z2.0 P5 B60 R60`, persistence off, the four components all on, gate cap20.
- Create: `docs/superpowers/specs/2026-10-19-surge-signal-evidence/report_surge_pick4.md`. It lists every event of the chosen setting from 2016 on (theme, start, end, shown, fwd5/10/20, max run-up 10d) plus its summary row.
- Modify: `scripts/risk/build_risk_fixture.py`. Add `--long`, which writes `tests/fixtures/risk_long/closes.csv.gz` (2023-01-03..2026-10-16, all watchlist tickers plus `^SOX` and `RSP`), plus `shares.csv`, `themes.csv` and `fred/*.csv` copied the same way.
- Test: `tests/core_finance/test_risk_long_fixture.py` (shape and size).

**Interfaces:**
- Produces: the event list above. Task 5's acceptance test hard-codes the 2026 `^SOX` and `chip_equipment_design` start dates from it.
- Produces: the long fixture loader `tests/core_finance/_fixture.py::load_long() -> (closes, sox, rsp, shares, themes, fred)`, in the same shapes as the existing risk acceptance loader.

- [ ] **Step 1:** Run the surge.py variant (controller-run research; no repo code). Write `report_surge_pick4.md`. Confirm its summary row equals the "without pers, 4 of 4" row in `report_surge.md` (19.3/yr, 9%, 5.7/yr, 39%, 36/591).
- [ ] **Step 2:** Add `--long` to the fixture script and run it. Assert `du -sh tests/fixtures/risk_long` ≤ 3 MB.
- [ ] **Step 3:** Test `test_long_fixture_shape`: the date range is 2023-01-03..2026-10-16, `^SOX` and `RSP` are present, ≥ 240 tickers, and the gz loads with pandas.
- [ ] **Step 4:** Commit with `test(risk): long fixture and the chosen surge setting's event list`.

### Task 2: Rules for surge and movers

**Files:**
- Modify: `packages/core_finance/risk_signals/config.py`, `apps/api/services/risk/rules.yaml`
- Test: `tests/core_finance/test_risk_rules_config.py` (extend)

**Interfaces:**
- Produces: `RiskRules.surge`, strict, with these fields:
  - `ema: 10`, `accel_lag: 3`
  - `magnitude: {window: 5, std_window: 60, std_min: 40, z: 2.0}`
  - `accel: {quantile_window: 250, quantile_min: 120, rank: 0.95}`
  - `breadth: {window: 5, min_pct: 60.0}`
  - `rsi: {period: 14, cross: 60.0, within: 5, overheated: 80.0}`
  - `event: {gap: 10, stall: 10, high_window: 20}`
  - `gate: {cap_share_pct: 20.0, sox_opens: true}`
  - `live_window_rows: 400`
- Produces: `RiskRules.movers: {count: 5}`.
- Produces: labels `{ko, en}` for the four component ids `magnitude, accel, breadth, rsi`.

- [ ] **Step 1: Write the failing tests.**
  - `test_surge_values_load`: every value listed above.
  - `test_surge_unknown_key_rejected`.
  - `test_rank_bounded`: rank 1.5 is rejected.
  - `test_version_changes_with_surge_section`.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5:** Commit with `feat(risk): surge and movers rules`.

### Task 3: Surge components (pure)

**Files:**
- Create: `packages/core_finance/risk_signals/surge.py`
- Test: `tests/core_finance/test_risk_surge_components.py`

**Interfaces:**
- Consumes: `theme_indices` levels (Task 3 of the risk plan) and member closes.
- Produces: `surge_components(levels: pd.DataFrame, closes: pd.DataFrame, themes: Mapping[str, str], sox: pd.Series, rules: RiskRules) -> SurgeComponents`.
  - `SurgeComponents` is a frozen dataclass. Each field is a DataFrame indexed by date, with columns = trigger themes plus `"^SOX"`:
    - `magnitude_z`, `accel_pct`, `accel_rank`, `breadth_pct`, `rsi`: floats, NaN when not computable
    - `on`: bool. True only where all four components are on.
    - `ema`: EMA10 of the level
    - `high_new`: bool, close ≥ the rolling 20-valid-row max
  - Every indicator runs on each column's `dropna()` series, then is reindexed back. `^SOX` breadth uses the union of the semis themes' members.
  - EMA: `ewm(span=n, adjust=False)`.
  - Wilder RSI: `ewm(alpha=1/14, adjust=False)` on gains and losses, which is the standard Wilder recursion.
  - Must equal the evidence `surge.py` component functions on equal input. Check it with one parity test on the long fixture for 3 themes.
- [ ] **Step 1: Write the failing tests.** Use hand-built series for the boundaries:
  - `test_magnitude_window_excludes_the_move`
  - `test_magnitude_needs_40_values`
  - `test_accel_rank_uses_only_past_values`
  - `test_accel_needs_120_values`
  - `test_breadth_counts_members_with_data`
  - `test_rsi_cross_within_5_and_band`
  - `test_overheated_above_80`
  - `test_on_requires_all_four`
  - `test_sox_breadth_union_of_semis`
  - `test_parity_with_evidence_surge_py`: import the evidence script functions by path and compare on 3 themes of the long fixture.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5:** Commit with `feat(risk): surge components`.

### Task 4: Surge lifecycle, banner gate, movers (pure)

**Files:**
- Modify: `packages/core_finance/risk_signals/surge.py`
- Create: `packages/core_finance/risk_signals/movers.py`
- Test: `tests/core_finance/test_risk_surge_lifecycle.py`, `tests/core_finance/test_risk_movers.py`

**Interfaces:**
- Produces:
  - `@dataclass SurgeEvent(theme: str, start: date, end: date | None, end_reason: str | None, last_high: date, overheated_on: date | None)`
  - `@dataclass SurgeState(open: dict[str, SurgeEvent], last_confirm: dict[str, date])`
- Produces: `run_surge(dates: Sequence[date], comps: SurgeComponents, levels: pd.DataFrame, cap_share: pd.DataFrame, rules: RiskRules, state: SurgeState | None = None) -> tuple[list[SurgeEvent], SurgeState, dict[date, SurgeDay]]`
  - The list holds the events closed in the range.
  - `SurgeDay(banner: bool, cap_share: float, in_event: list[str], started: list[str])`
  - Per day:
    1. End check for open events (close < EMA10, or `pos(day) − pos(last_high) ≥ stall`). Update `last_high` on `high_new`.
    2. Start check: `on`, no open event, and `pos(day) − pos(last_confirm) > gap` (or no prior confirmation).
    3. `last_confirm = day` whenever `on`.
    4. `overheated_on` is set on the first day in the event with RSI > 80.
  - Banner: Σ cap_share over themes in an event (end day inclusive) ≥ 20%, or `^SOX` in an event. `shown` is the banner state on the start day.
  - Positions come from the full shared index looked up by date, the same as `run_alerts`.
- Produces: `top_movers(closes: pd.DataFrame, day: date, count: int) -> list[Mover]`
  - `Mover(rank, ticker, return_pct, close, return5_pct, rsi)`
  - Only tickers with both closes. Ties are broken by ticker.
- [ ] **Step 1: Write the failing tests:**
  - `test_event_starts_after_gap`
  - `test_confirmations_inside_event_push_gap`
  - `test_end_below_ema`
  - `test_end_stalled_counts_from_start`
  - `test_end_then_start_same_day`
  - `test_banner_includes_end_day`
  - `test_sox_event_always_shown`
  - `test_overheated_on_first_day_over_80`
  - `test_state_carry_one_day_equals_batch`
  - `test_movers_order_and_ties`
  - `test_movers_fewer_than_five` (Review Focus 5)
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5:** Commit with `feat(risk): surge events, banner gate and daily movers`.

### Task 5: Wire into `evaluate_range`; acceptance on the long fixture

**Files:**
- Modify: `packages/core_finance/risk_signals/evaluate.py`
- Test: `tests/core_finance/test_risk_surge_acceptance.py`

**Interfaces:**
- `evaluate_range(..., state: OpenAlert | None = None, surge_state: SurgeState | None = None)`
- `DayResult` gains `surge: dict[str, dict] | None` (theme → components and on), `surge_banner: bool`, `surge_cap_share: float`, `surge_started: list[str]`, `movers: list[Mover]`.
- `EvaluationResult` gains `surge_closed: list[SurgeEvent]`, `surge_state: SurgeState`, `surge_components: SurgeComponents`.
- [ ] **Step 1: Write the failing tests** on the long fixture:
  - `test_no_semis_surge_around_2026_10_08`: no start for the 5 semis themes or `^SOX` on 2026-10-01..2026-10-16.
  - `test_april_2026_starts_match_evidence`: the `^SOX` and `chip_equipment_design` start dates equal Task 1's list.
  - `test_surge_day_by_day_equals_batch`: per-day surge maps, banner, events and movers are equal.
  - `test_crash_results_unchanged`: the existing risk acceptance tests still pass, unchanged.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass. Also run `pytest tests/core_finance -k risk`.
- [ ] **Step 5:** Commit with `feat(risk): surge and movers in evaluate_range`.

### Task 6: Storage

**Files:**
- Modify: `apps/api/services/db.py`, `apps/api/services/risk/store.py`
- Test: `tests/api/risk/test_store.py` (extend)

**Interfaces:**
- **Tables (spec §7):**
  - `surge_events`: `id` AUTOINCREMENT, `origin` CHECK in ('live','backfill'), `end_reason` CHECK in ('below_ema','stalled') or NULL.
  - `surge_state`: primary key (`rules_version`, `theme`).
  - `daily_movers`: primary key (`date`, `rules_version`, `rank`).
  - `risk_daily` gains `surge_json`, `surge_banner`, `surge_cap_share` (nullable ALTERs).
- **Store functions:**
  - `insert_surge_event(...) -> int`
  - `update_surge_event(id, *, end, end_reason, last_high, overheated_on)`
  - `fill_surge_outcome(id, outcome)`
  - `open_surge_events(version) -> list[StoredSurge]`
  - `list_surge(version, shown, theme, limit)`
  - `get_surge(id)`
  - `set_last_confirm(version, theme, day)` and `last_confirms(version) -> dict`
  - `save_movers(version, day, movers)`
  - `list_movers(version, start, end)`
  - `purge_version` also clears these tables for `backfill` rows. Live surge events are kept, exactly as for alerts.
- [ ] **Step 1: Write the failing tests:**
  - `test_surge_tables_created`
  - `test_old_risk_daily_migrates`
  - `test_purge_keeps_live_surge`
  - `test_movers_roundtrip`
  - `test_last_confirm_roundtrip`
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5:** Commit with `feat(risk): surge and movers storage`.

### Task 7: Evaluator persistence and the trailing live window

**Files:**
- Modify: `apps/api/services/risk/evaluator.py`, `apps/api/services/risk/inputs.py`
- Test: `tests/api/risk/test_evaluator.py` (extend), `tests/api/risk/test_live_window.py`

**Interfaces:**
- `load_inputs(..., since: date | None = None)` trims closes, sox and rsp to ≥ `since`. FRED is never trimmed.
- `live_window_start(inputs_full_index_or_db, rules, open_alert, open_surges) -> date`, per spec §5:
  - the earliest of the date where every trigger theme has `live_window_rows` valid rows, the open alert's earliest `last_ref`, and the open surge events' earliest start.
  - It reads the per-day valid-member counts from the DB cheaply: one query counting closes per ticker per day, or the stored `risk_daily` rows.
- **Backfill:**
  - Persist surge events (start, end, shown, components at start, leaders top 5 by 5-row return), `surge_state`, movers for every day, and the risk_daily surge columns.
  - Fill outcomes: fwd5/10/20 and max_runup10 from levels.
- **Live:**
  - Load with `since = live_window_start(...)`.
  - Rebuild `SurgeState` from the store.
  - Do the same persistence inside the existing per-day transaction.
- [ ] **Step 1: Write the failing tests:**
  - `test_backfill_persists_surge_and_movers`
  - `test_live_continues_open_surge_from_store` (Review Focus 2)
  - `test_live_window_equals_full_history`: for each of the long fixture's last 60 days, the window run and the full run agree on the flags, dates and events exactly, and on values within rel 1e-9.
  - `test_live_window_with_member_gap_theme` (Review Focus 1): force a <3-member gap in one theme 300 rows back and check equality.
  - `test_rules_version_bump_recomputes_once` (Review Focus 4): the risk alert starts and releases are equal before and after.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass. Also run `pytest tests/api/risk -q`.
- [ ] **Step 5:** Commit with `feat(risk): persist surge and movers; trailing live window`.

### Task 8: API and shared types

**Files:**
- Modify: `apps/api/models/schema_parts/risk.py`, `apps/api/routes/risk.py`, `packages/shared-types/risk.ts`
- Test: `tests/api/risk/test_routes.py` (extend)

**Interfaces:**
- Spec §8 exactly:
  - `/latest.surge` and `/latest.movers`, which are null when never evaluated.
  - `GET /surge/history?shown=all|yes&theme=&limit=` (1..500, default 50)
  - `GET /surge/events/{id}`, with 404 `unknown_surge:<id>`
  - `GET /movers?from=&to=` (default last 20 days; max 2600 days)
- Visibility follows the backfill gating of `_visible_alerts`.
- [ ] **Step 1: Write the failing tests:**
  - `test_latest_surge_and_movers_shape`
  - `test_latest_surge_themes_when_banner_off`
  - `test_both_banners_same_day` (Review Focus 3)
  - `test_surge_history_filters`
  - `test_surge_404`
  - `test_movers_range_and_default`
  - `test_never_evaluated_nulls`
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass. Also run `npm run typecheck` in `apps/web`.
- [ ] **Step 5:** Commit with `feat(risk): surge and movers API`.

### Task 9: Reproduction, docs, records

**Files:**
- Modify: `scripts/risk/reproduce_backfill.py`. Add a surge-event diff against `report_surge_pick4.md`.
- Modify: `docs/architecture/database-relationships.md`, `docs/architecture/data-flow.md`, `guideline/sop/todo.md` (Track R ②-b), `docs/INDEX.md` (add this plan)
- Test: `tests/scripts/test_reproduce_backfill.py` (extend)

- [ ] **Step 1: Write the failing tests:**
  - `test_parse_surge_events`
  - `test_surge_diff`
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5:** Update the docs.
- [ ] **Step 6:** Commit with `feat(risk): surge reproduction; docs`.
- [ ] **Step 7 (owner-gated, controller only):** run one cycle on the real DB after a backup. The rules version bump recomputes the backfill. Run the reproduction and record the diff in spec §2.
