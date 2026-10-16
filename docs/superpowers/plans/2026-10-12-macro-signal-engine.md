# Macro Signal Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly macro signal engine that judges FRED series against rules in `rules.yaml`, merges user-entered qualitative signals, turns the result into S&P 500 scenario A/B/C probabilities, stores one snapshot per ISO week in SQLite, and shows it on a `/signals` page.

**Architecture:** Pure rule evaluation and probability math live in `packages/core_finance/macro_signals/` (no DB, no network). Configuration, FRED access, SQLite storage, orchestration and scheduling live in `apps/api/services/signals/`. A FastAPI router at `/api/v1/signals` exposes it. A client-only Next.js page at `/signals` reads it with react-query.

**Tech Stack:** Python 3.12+ (runs on the `moneyview` conda env, 3.13.12), FastAPI, pydantic 2, PyYAML, SQLite, requests; Next.js 16 app router, react-query 5, recharts 3, Playwright.

**Spec:** `MoneyView 신호 엔진 구현 명세.md` (repo root, untracked; Task 1 moves it to `docs/superpowers/specs/2026-10-10-macro-signal-engine-spec.md`). Read it together with the "Spec corrections" section below. The corrections win where they disagree with the spec.

**Independence:** This plan does not depend on `2026-10-12-design-system-formalization.md`. It uses today's CSS variables and an English copy file. If the design-system plan lands later, it migrates this page like any other.

## Spec corrections (verified 2026-10-12, before any code)

| # | Spec says | Problem (how verified) | This plan does |
|---|---|---|---|
| C1 | Clip each probability to 5–85%, then renormalize | Renormalizing after the clip pushes values back out of bounds. When all 7 B signals fire, the result is A = 4.8%, which fails the spec's own "never below 5%" test (computed with the spec's LRs). | `bounded_normalize`: pin the out-of-bound values at the bound and spread the remaining mass over the rest in proportion, repeating until every value is in bounds. |
| C2 | Monthly staleness 45 days, daily 7 days | FRED dates a monthly observation on the 1st, and CPI is published about 6 weeks later. On 2026-10-12 the newest CPI observation is 2026-08-01, 72 days old. Brent (`DCOILBRENTEU`) is updated weekly, so it is often more than 7 days old on a Saturday. | Each rule sets its own `max_age_days`: daily 7, Brent 14, monthly 80. |
| C3 | `b_fed_hike` compares against the previous snapshot | The first run has no previous snapshot, and comparing against one makes the rule read the DB, so it is no longer pure. | `level_change` compares the latest value with the series' own value `lookback_days: 7` before `as_of`. |
| C4 | Integration tests say both "11 results stored" and "a week without manual input leaves manual signals out" | Both cannot hold for the same fixture. | Two tests: with 3 manual inputs, 11 results; with none, 8 results. |
| C5 | `mom_pct` boundary: 0.250 must trigger | `(100.25/100 - 1) * 100 == 0.24999999999999467` in float. The boundary test fails without rounding (checked in Python). | Percent changes and means are rounded to 9 places before comparison. |
| C6 | Endpoints at `/api/signals/*` | Every router in this repo is mounted at `/api/v1/*`. | `/api/v1/signals/*`. |
| C7 | APScheduler | It is not installed. The app already runs background loops in `lifespan` with asyncio. | An asyncio loop checks once an hour whether a run is due. One function covers both the catch-up at startup and the Saturday 08:51 KST run. No new dependency. |
| C8 | Reuse the FRED client as-is | `FREDCollector.fetch_indicator` returns `[]` on every error (so the caller cannot tell a failure from no data), has no timeout, and logs the raw exception. A requests exception message contains the full URL, API key included. | Add `fetch_observations()` and `FredFetchError` to the same class. The new method raises, uses a timeout and redacts the key. `fetch_indicator` is left alone. |
| C9 | `signal_results` has no contribution columns | `GET /latest` must return the per-signal contributions from the run. Recomputing them later with a since-edited `rules.yaml` would show numbers the run never produced. | `signal_results` gains `contrib_a`, `contrib_b`, `contrib_c`. |
| C10 | `compound` supports AND/OR | Only AND is used, by `a_labor_core`. | Only "all conditions" is implemented. OR waits until a rule needs it (YAGNI). |
| C11 | Status labels in Korean (발동 / 근접 / 미발동 / 데이터 지연) | The app's UI is English today. The owner decided on a bilingual UI, delivered by the design-system plan. | `rules.yaml` labels carry both `ko` and `en`, and the API returns both. The page's own strings sit in one `copy.ts` in English, which the design-system plan's i18n task moves into the message catalogs. |

## Global Constraints

- Python: write for 3.12+, no syntax newer than 3.12. Run everything with `PY=C:/Users/eajwa/anaconda3/envs/moneyview/python.exe`.
- Baseline before this plan: **1883 pytest passed** (2026-10-12, `moneyview` env). That count must never drop. Never edit an existing test to make it pass; stop and report instead (spec, "주의점").
- Tests never touch the network. `tests/conftest.py::_forbid_network` already fails any non-loopback socket. FRED responses come from `tests/fixtures/fred/<SERIES_ID>.json`, in FRED's response format.
- Every threshold, near-threshold, likelihood ratio, prior, bound and weight comes from `apps/api/services/signals/rules.yaml`. No numeric rule constant in Python or TS.
- The FRED key is read from the `FRED_API_KEY` env var, which `apps/api/core/local_env.py` loads from `config/.env`. Never commit the key, and never log it.
- Prior: A 0.35, B 0.45, C 0.20. Weights: triggered 1.0, near 0.5, not_triggered/stale 0. Bounds: [0.05, 0.85]. Each week is recomputed from the prior; last week's result is never multiplied in.
- States: `triggered`, `near`, `not_triggered`, `stale`. Manual inputs accept only the first three.
- A week without a manual input leaves that manual rule out of the results and out of the probability. It is not counted as `not_triggered`.
- Times go out as UTC ISO 8601. The ISO week and the weekly schedule use Asia/Seoul, a fixed UTC+9 with no DST.
- Fixed UI copy: "These probabilities are a heuristic built from subjective likelihood ratios, not a statistical model estimate, and are not investment advice."
- Out of scope: news collection, LLM calls, market-quote APIs (`m_breadth` stays manual), trade signals.
- Per `.claude/CLAUDE.md` §8, no test counts as verified until it has been seen to fail against a named mutation. Each task lists its mutations. Apply each one, see the named test fail, then restore with `git checkout -- <file>`.
- SOPs: `guideline/sop/finance-logic.md` (Tasks 2–3), `file-structure.md` (Task 1), `test-verification.md` (all), `security-reviewer.md` (Task 4), `code-reviewer.md` (Task 10).

## Review Focus

1. **A monthly series that skips a month** (FRED revision or a shutdown gap). The month-over-month change must not be computed across two months. → Task 2 `test_mom_pct_refuses_a_gap_between_months`.
2. **Missing FRED key or FRED down, with an empty cache.** `POST /run` must return 200 with every auto rule `stale` and a `failures` list, never a 500. → Task 7 `test_run_without_a_key_is_200_and_all_auto_rules_stale`.
3. **FRED down, but the cache holds fresh data.** The rule must still be judged from the cache, and the failure must still be reported. → Task 6 `test_failed_fetch_falls_back_to_cached_observations`.
4. **A manual input saved before this week's first run.** The PUT must store it, and the next run must pick it up. → Task 7 `test_manual_input_saved_before_the_first_run_is_used_by_it`.
5. **An exception text that would contain the API key.** It must never reach a log line or a `failures` entry. → Task 4 `test_connection_error_message_never_contains_the_key`.

---

## File structure

| Path | Responsibility |
|---|---|
| `packages/core_finance/macro_signals/__init__.py` | Package marker |
| `packages/core_finance/macro_signals/rules.py` | `Observation`, `Evaluation`, the rule functions, staleness |
| `packages/core_finance/macro_signals/scenario.py` | `bounded_normalize`, `posterior`, `contributions` |
| `apps/api/services/signals/__init__.py` | Package marker |
| `apps/api/services/signals/rules.yaml` | Every signal definition and scenario parameter |
| `apps/api/services/signals/models.py` | pydantic schema for `rules.yaml`, `load_rules`/`get_rules`/`reload_rules` |
| `apps/api/services/signals/fetch.py` | `SeriesFetcher`: one fetch per series per run, cache fallback |
| `apps/api/services/signals/store.py` | SQLite reads and writes for snapshots, results, manual inputs, cache |
| `apps/api/services/signals/engine.py` | `run`, `rescore`, `evaluate_rule`, `score` |
| `apps/api/services/signals/schedule.py` | `is_due`, `weekly_cutoff`, `signal_cycle` |
| `apps/api/services/webscrap/Collector/FREDCollector.py` | + `FredFetchError`, `parse_observations`, `fetch_observations` |
| `apps/api/services/db.py` | + `_SIGNAL_SCHEMA_SQL` (4 tables) |
| `apps/api/models/schema_parts/signals.py` | API response and request models |
| `apps/api/routes/signals.py` | 5 endpoints |
| `apps/api/main.py` | Router registration, `reload_rules()` and `signal_cycle` in `lifespan` |
| `packages/shared-types/signals.ts` | TS mirror of the API models |
| `apps/web/lib/signals.ts` | Pure UI helpers (deltas, version breaks, most likely) |
| `apps/web/lib/useSignals.ts` | react-query hooks |
| `apps/web/app/signals/page.tsx`, `copy.ts`, `components/*.tsx` | The page |
| `tests/core_finance/test_macro_signal_rules.py`, `test_macro_signal_scenario.py` | Pure tests |
| `tests/api/signals/*` | Collector, config, fetch, store, engine, schedule, route tests |
| `tests/fixtures/fred/*.json` | 6 FRED responses |
| `apps/web/tests/e2e/signals-model.spec.ts`, `signals-page.spec.ts`, `helpers/signalsApiMock.ts` | Frontend tests |

---

### Task 1: Spec in place, dependency declared

**Files:**
- Move: `MoneyView 신호 엔진 구현 명세.md` → `docs/superpowers/specs/2026-10-10-macro-signal-engine-spec.md`
- Modify: `pyproject.toml`, `guideline/sop/todo.md`

**Interfaces:** None in code.

- [ ] **Step 1: Move the spec and append the corrections**

```bash
mv "MoneyView 신호 엔진 구현 명세.md" docs/superpowers/specs/2026-10-10-macro-signal-engine-spec.md
```

Append the "Spec corrections" table from this plan, verbatim, under a final heading `## 구현 계획에서 확정한 수정 사항 (2026-10-12)`.

- [ ] **Step 2: Declare PyYAML** (6.0.3 is installed, but only as a transitive dependency). In `pyproject.toml`, add it right after `"python-dotenv>=1.0.0",`:

```toml
    "pyyaml>=6.0",
```

If `uv` is on PATH, run `uv lock`. If it is not, write "uv.lock not refreshed for pyyaml" in the todo entry.

- [ ] **Step 3: Add the todo track** under `## Open work` in `guideline/sop/todo.md`:

```markdown
### Track S: Macro signal engine
Plan: `docs/superpowers/plans/2026-10-12-macro-signal-engine.md`. Spec + corrections:
`docs/superpowers/specs/2026-10-10-macro-signal-engine-spec.md`. Baseline 1883 pytest passed.
- [ ] S2 pure rules  - [ ] S3 scenario  - [ ] S4 FRED fetch  - [ ] S5 rules.yaml
- [ ] S6 store/fetcher  - [ ] S7 engine+API  - [ ] S8 schedule  - [ ] S9 page  - [ ] S10 docs
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-10-macro-signal-engine-spec.md pyproject.toml guideline/sop/todo.md
git commit -m "docs(signals): adopt the signal engine spec with verified corrections"
```

---

### Task 2: Pure rule evaluation

**Files:**
- Create: `packages/core_finance/macro_signals/__init__.py` (empty), `packages/core_finance/macro_signals/rules.py`
- Test: `tests/core_finance/test_macro_signal_rules.py`

**Interfaces:**
- Produces:
  - `Observation(date: date, value: float)`
  - `Evaluation(state, value: float|None, observed_at: date|None, threshold: float|None, note: str)`
  - `Condition(label: str, met: bool, value: float, observed_at: date)`
  - `State`, `Op`, `compare(op, left, right) -> bool`, `upto(obs, as_of) -> list[Observation]`
  - `is_stale(obs, as_of, max_age_days) -> bool`, `stale(note, observed_at=None) -> Evaluation`
  - `level_streak(obs, as_of, *, op, threshold, days, near_threshold=None, near_days=None)`
  - `rolling_mean(obs, as_of, *, window, op, threshold, near_threshold=None)`
  - `mom_pct(obs, as_of, *, op, threshold, near_threshold=None)`
  - `mom_pct_value(usable) -> tuple[float, date] | None`, `mom_diff_value(usable) -> tuple[float, date] | None`
  - `level_change(obs, as_of, *, lookback_days, op, threshold)`
  - `compound_all(conditions) -> Evaluation`

- [ ] **Step 1: Write the failing tests**

```python
"""Rule evaluation: the boundary values the spec names, and the gaps it does not."""
from datetime import date, timedelta

from packages.core_finance.macro_signals.rules import (
    Condition, Observation, compound_all, is_stale, level_change, level_streak, mom_pct,
    rolling_mean,
)

AS_OF = date(2026, 10, 9)


def daily(values, end=AS_OF):
    """One observation per weekday ending at `end`, oldest first. None = FRED's '.' (dropped)."""
    days, d = [], end
    while len(days) < len(values):
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    return [Observation(day, v) for day, v in zip(days, values) if v is not None]


def monthly(pairs):
    return [Observation(date.fromisoformat(d), v) for d, v in pairs]


STICKY = dict(op=">=", threshold=5.50, days=10, near_threshold=5.35, near_days=5)


def test_level_streak_ten_days_at_5_51_triggers():
    ev = level_streak(daily([5.0] + [5.51] * 10), AS_OF, **STICKY)
    assert ev.state == "triggered"
    assert ev.value == 5.51 and ev.observed_at == AS_OF and ev.threshold == 5.50


def test_level_streak_nine_days_is_near():
    assert level_streak(daily([5.0] + [5.51] * 9), AS_OF, **STICKY).state == "near"


def test_level_streak_missing_dot_does_not_break_the_run():
    values = [5.0] + [5.51] * 5 + [None] + [5.51] * 5   # 10 real observations, one '.'
    assert level_streak(daily(values), AS_OF, **STICKY).state == "triggered"


def test_level_streak_below_near_is_not_triggered():
    assert level_streak(daily([5.0] * 12), AS_OF, **STICKY).state == "not_triggered"


def test_level_streak_below_direction_for_relief():
    relief = dict(op="<", threshold=5.00, days=5, near_threshold=5.15)
    assert level_streak(daily([4.9] * 5), AS_OF, **relief).state == "triggered"
    assert level_streak(daily([5.1] * 5), AS_OF, **relief).state == "near"


CORE = dict(op=">=", threshold=0.25, near_threshold=0.20)


def test_mom_pct_0_250_triggers_on_the_boundary():
    ev = mom_pct(monthly([("2026-07-01", 100.0), ("2026-08-01", 100.25)]), AS_OF, **CORE)
    assert ev.state == "triggered"
    assert ev.value == 0.25


def test_mom_pct_0_249_is_near_not_triggered():
    ev = mom_pct(monthly([("2026-07-01", 100.0), ("2026-08-01", 100.249)]), AS_OF, **CORE)
    assert ev.state == "near"


def test_mom_pct_refuses_a_gap_between_months():
    ev = mom_pct(monthly([("2026-06-01", 100.0), ("2026-08-01", 101.0)]), AS_OF, **CORE)
    assert ev.state == "stale"
    assert "previous month" in ev.note


SPIKE = dict(window=5, op=">=", threshold=110.0, near_threshold=105.0)


def test_rolling_mean_exactly_110_triggers():
    assert rolling_mean(daily([90.0] + [110.0] * 5), AS_OF, **SPIKE).state == "triggered"


def test_rolling_mean_109_99_is_near():
    assert rolling_mean(daily([109.99] * 5), AS_OF, **SPIKE).state == "near"


def test_rolling_mean_with_too_few_observations_is_stale():
    assert rolling_mean(daily([120.0] * 4), AS_OF, **SPIKE).state == "stale"


def cond(met):
    return Condition("x", met, 1.0, AS_OF)


def test_compound_both_met_triggers_one_is_near_none_is_not():
    assert compound_all([cond(True), cond(True)]).state == "triggered"
    assert compound_all([cond(True), cond(False)]).state == "near"
    assert compound_all([cond(False), cond(False)]).state == "not_triggered"


def test_level_change_detects_a_hike_against_the_lookback_value():
    obs = [Observation(AS_OF - timedelta(days=d), 4.00) for d in range(10, 2, -1)]
    obs += [Observation(AS_OF - timedelta(days=d), 4.25) for d in (2, 1, 0)]
    ev = level_change(obs, AS_OF, lookback_days=7, op=">", threshold=0.0)
    assert ev.state == "triggered" and ev.value == 0.25


def test_level_change_without_a_baseline_is_stale():
    ev = level_change([Observation(AS_OF, 4.0)], AS_OF, lookback_days=7, op=">", threshold=0.0)
    assert ev.state == "stale"


def test_staleness_uses_the_latest_observation_date():
    obs = [Observation(date(2026, 8, 1), 1.0)]
    assert is_stale(obs, date(2026, 10, 10), 80) is False   # 70 days
    assert is_stale(obs, date(2026, 10, 10), 45) is True
    assert is_stale([], date(2026, 10, 10), 80) is True


def test_observations_after_as_of_are_ignored():
    obs = daily([5.0] * 12) + [Observation(AS_OF + timedelta(days=3), 6.0)]
    assert level_streak(obs, AS_OF, **STICKY).value == 5.0
```

- [ ] **Step 2: Run and confirm they fail**

Run: `$PY -m pytest tests/core_finance/test_macro_signal_rules.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'packages.core_finance.macro_signals'`.

- [ ] **Step 3: Implement `rules.py`**

```python
"""Pure evaluation of macro signal rules.

No database and no network: each function takes observations already fetched and
returns a verdict carrying the value, observation date and threshold it was decided on,
so the dashboard can show the evidence beside the state.
"""
from __future__ import annotations

import operator
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal, Sequence

State = Literal["triggered", "near", "not_triggered", "stale"]
Op = Literal[">=", ">", "<", "<="]

_OPS = {">=": operator.ge, ">": operator.gt, "<": operator.lt, "<=": operator.le}

# Unrounded float division turns 100.0 -> 100.25 into 0.24999999999999467, which would
# fail a ">= 0.25" threshold the data meets. 9 places is far below any published precision.
_PLACES = 9


@dataclass(frozen=True)
class Observation:
    date: date
    value: float


@dataclass(frozen=True)
class Evaluation:
    state: State
    value: float | None
    observed_at: date | None
    threshold: float | None
    note: str


@dataclass(frozen=True)
class Condition:
    label: str
    met: bool
    value: float
    observed_at: date


def compare(op: Op, left: float, right: float) -> bool:
    return _OPS[op](left, right)


def upto(observations: Sequence[Observation], as_of: date) -> list[Observation]:
    """Observations dated on or before `as_of`, oldest first."""
    return sorted((o for o in observations if o.date <= as_of), key=lambda o: o.date)


def is_stale(observations: Sequence[Observation], as_of: date, max_age_days: int) -> bool:
    usable = upto(observations, as_of)
    return not usable or (as_of - usable[-1].date).days > max_age_days


def stale(note: str, observed_at: date | None = None) -> Evaluation:
    return Evaluation("stale", None, observed_at, None, note)


def _grade(value, observed_at, op, threshold, near_threshold, note) -> Evaluation:
    if compare(op, value, threshold):
        state: State = "triggered"
    elif near_threshold is not None and compare(op, value, near_threshold):
        state = "near"
    else:
        state = "not_triggered"
    return Evaluation(state, value, observed_at, threshold, note)


def level_streak(observations, as_of, *, op, threshold, days, near_threshold=None, near_days=None):
    usable = upto(observations, as_of)
    if not usable:
        return stale("no observations")
    run = 0
    for obs in reversed(usable):
        if not compare(op, obs.value, threshold):
            break
        run += 1
    latest = usable[-1]
    if run >= days:
        state: State = "triggered"
    elif (near_threshold is not None and compare(op, latest.value, near_threshold)) or (
        near_days is not None and run >= near_days
    ):
        state = "near"
    else:
        state = "not_triggered"
    return Evaluation(state, latest.value, latest.date, threshold,
                      f"{run} consecutive observations {op} {threshold}")


def rolling_mean(observations, as_of, *, window, op, threshold, near_threshold=None):
    usable = upto(observations, as_of)
    if len(usable) < window:
        return stale(f"need {window} observations, have {len(usable)}",
                     usable[-1].date if usable else None)
    recent = usable[-window:]
    mean = round(sum(o.value for o in recent) / window, _PLACES)
    return _grade(mean, recent[-1].date, op, threshold, near_threshold, f"{window}-observation mean")


def _consecutive_months(prev: date, last: date) -> bool:
    return (last.year * 12 + last.month) - (prev.year * 12 + prev.month) == 1


def mom_pct_value(usable: Sequence[Observation]) -> tuple[float, date] | None:
    if len(usable) < 2 or not _consecutive_months(usable[-2].date, usable[-1].date):
        return None
    prev, last = usable[-2], usable[-1]
    return round((last.value / prev.value - 1) * 100, _PLACES), last.date


def mom_diff_value(usable: Sequence[Observation]) -> tuple[float, date] | None:
    if len(usable) < 2 or not _consecutive_months(usable[-2].date, usable[-1].date):
        return None
    return round(usable[-1].value - usable[-2].value, _PLACES), usable[-1].date


def mom_pct(observations, as_of, *, op, threshold, near_threshold=None):
    usable = upto(observations, as_of)
    point = mom_pct_value(usable)
    if point is None:
        return stale("previous month missing", usable[-1].date if usable else None)
    value, observed_at = point
    return _grade(value, observed_at, op, threshold, near_threshold, "month-over-month %")


def level_change(observations, as_of, *, lookback_days, op, threshold):
    usable = upto(observations, as_of)
    if not usable:
        return stale("no observations")
    cutoff = as_of - timedelta(days=lookback_days)
    baseline = [o for o in usable if o.date <= cutoff]
    if not baseline:
        return stale(f"no observation on or before {cutoff.isoformat()}", usable[-1].date)
    change = round(usable[-1].value - baseline[-1].value, _PLACES)
    state: State = "triggered" if compare(op, change, threshold) else "not_triggered"
    return Evaluation(state, change, usable[-1].date, threshold,
                      f"change since {baseline[-1].date.isoformat()}")


def compound_all(conditions: Sequence[Condition]) -> Evaluation:
    met = sum(c.met for c in conditions)
    state: State = "triggered" if met == len(conditions) else "near" if met else "not_triggered"
    note = "; ".join(f"{c.label}={c.value:g} ({'met' if c.met else 'not met'})" for c in conditions)
    return Evaluation(state, None, min(c.observed_at for c in conditions), None, note)
```

- [ ] **Step 4: Run and confirm they pass**

- [ ] **Step 5: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `mom_pct_value`: drop the `round(..., _PLACES)` | `test_mom_pct_0_250_triggers_on_the_boundary` |
| `run >= days` → `run > days` | `test_level_streak_ten_days_at_5_51_triggers` |
| remove the `_consecutive_months` check from `mom_pct_value` | `test_mom_pct_refuses_a_gap_between_months` |
| `usable[-window:]` → `usable[:window]` | `test_rolling_mean_exactly_110_triggers` |
| `compound_all`: `"near" if met` → `"not_triggered" if met` | `test_compound_both_met_triggers_one_is_near_none_is_not` |
| `upto` without the `o.date <= as_of` filter | `test_observations_after_as_of_are_ignored` |

- [ ] **Step 6: Commit**

```bash
git add packages/core_finance/macro_signals tests/core_finance/test_macro_signal_rules.py
git commit -m "feat(signals): pure macro rule evaluation with boundary-safe comparisons"
```

---

### Task 3: Scenario probabilities

**Files:**
- Create: `packages/core_finance/macro_signals/scenario.py`
- Test: `tests/core_finance/test_macro_signal_scenario.py`

**Interfaces:**
- Produces:
  - `ActiveSignal(rule_id: str, lr: Mapping[str, float], weight: float)`
  - `bounded_normalize(raw: Mapping[str,float], floor, cap) -> dict[str,float]`
  - `posterior(prior, signals, floor, cap) -> dict[str,float]`
  - `contributions(prior, signals, floor, cap) -> dict[str, dict[str,float]]`: rule_id → (with − without), per scenario

- [ ] **Step 1: Write the failing tests**

```python
import math

import pytest

from packages.core_finance.macro_signals.scenario import (
    ActiveSignal, bounded_normalize, contributions, posterior,
)

PRIOR = {"a": 0.35, "b": 0.45, "c": 0.20}
FLOOR, CAP = 0.05, 0.85
# The spec's initial likelihood ratios for every B-direction rule (manual ones included).
B_LRS = {
    "b_tnx_sticky": (0.7, 1.2, 1.5), "b_core_cpi_hot": (0.8, 1.2, 1.2), "b_hy_wide": (0.6, 1.1, 1.8),
    "b_brent_spike": (0.7, 1.2, 1.4), "b_fed_hike": (0.8, 1.2, 1.2),
    "m_capex_reaction": (0.7, 1.2, 1.5), "m_iran_strike": (0.7, 1.3, 1.3),
}


def sig(rule_id, lr, weight=1.0):
    return ActiveSignal(rule_id, dict(zip("abc", lr)), weight)


ALL_B = [sig(k, v) for k, v in B_LRS.items()]


def test_no_signals_returns_the_prior():
    assert posterior(PRIOR, [], FLOOR, CAP) == pytest.approx(PRIOR, abs=1e-12)


@pytest.mark.parametrize("signals", [[], ALL_B, ALL_B[:2], [sig("x", (3.0, 0.1, 0.1))]])
def test_result_sums_to_one(signals):
    assert math.isclose(sum(posterior(PRIOR, signals, FLOOR, CAP).values()), 1.0, abs_tol=1e-9)


def test_all_b_signals_stay_inside_the_bounds():
    """The spec's clip-then-renormalize gives A = 0.048 here; this is the C1 correction."""
    result = posterior(PRIOR, ALL_B, FLOOR, CAP)
    assert all(FLOOR - 1e-12 <= p <= CAP + 1e-12 for p in result.values()), result


def test_bounded_normalize_pins_the_cap_and_spreads_the_rest_proportionally():
    assert bounded_normalize({"a": 0.98, "b": 0.01, "c": 0.01}, FLOOR, CAP) == pytest.approx(
        {"a": 0.85, "b": 0.075, "c": 0.075})


def test_near_moves_less_than_triggered():
    lr = B_LRS["b_hy_wide"]
    near = posterior(PRIOR, [sig("b_hy_wide", lr, 0.5)], FLOOR, CAP)
    full = posterior(PRIOR, [sig("b_hy_wide", lr, 1.0)], FLOOR, CAP)
    assert 0 < near["c"] - PRIOR["c"] < full["c"] - PRIOR["c"]


def test_contribution_is_the_change_from_removing_that_signal():
    signals = [sig("b_hy_wide", B_LRS["b_hy_wide"]), sig("a_x", (1.5, 0.9, 0.6))]
    contrib = contributions(PRIOR, signals, FLOOR, CAP)
    with_all = posterior(PRIOR, signals, FLOOR, CAP)
    without = posterior(PRIOR, signals[1:], FLOOR, CAP)
    assert contrib["b_hy_wide"] == pytest.approx({s: with_all[s] - without[s] for s in "abc"})
    assert contrib["b_hy_wide"]["c"] > 0


def test_infeasible_bounds_are_refused():
    with pytest.raises(ValueError):
        bounded_normalize({"a": 1, "b": 1, "c": 1}, 0.4, 0.85)
```

- [ ] **Step 2: Run and confirm they fail** (`ModuleNotFoundError`)

Run: `$PY -m pytest tests/core_finance/test_macro_signal_scenario.py -q`

- [ ] **Step 3: Implement `scenario.py`**

```python
"""Heuristic scenario probabilities from subjective likelihood ratios.

P(s | signals) ∝ P0(s) × Π LR_i(s)^w_i, recomputed from the fixed prior every week.
Never chained from last week's result: a signal that stays on for weeks would otherwise
be counted once per week and drive one scenario towards certainty.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence


@dataclass(frozen=True)
class ActiveSignal:
    rule_id: str
    lr: Mapping[str, float]
    weight: float


def bounded_normalize(raw: Mapping[str, float], floor: float, cap: float) -> dict[str, float]:
    """Normalize to sum 1 with every value in [floor, cap].

    Clipping and then renormalizing pushes values back out of bounds. Instead, pin the
    violators at the bound and spread the remaining mass over the free scenarios in
    proportion to `raw`. Overshoots are pinned first: pinning a cap frees mass that can lift
    a would-be floor violator, while pinning a floor only shrinks the free values, so no new
    overshoot can appear afterwards.
    """
    n = len(raw)
    if not (n * floor <= 1.0 <= n * cap):
        raise ValueError(f"bounds [{floor}, {cap}] are infeasible for {n} scenarios")
    fixed: dict[str, float] = {}
    while True:
        free = [k for k in raw if k not in fixed]
        if not free:
            return {k: fixed[k] for k in raw}
        mass = 1.0 - sum(fixed.values())
        total = sum(raw[k] for k in free)
        probs = {k: mass * raw[k] / total for k in free}
        over = [k for k in free if probs[k] > cap]
        if over:
            fixed.update({k: cap for k in over})
            continue
        under = [k for k in free if probs[k] < floor]
        if under:
            fixed.update({k: floor for k in under})
            continue
        return {k: fixed[k] if k in fixed else probs[k] for k in raw}


def posterior(prior: Mapping[str, float], signals: Sequence[ActiveSignal],
              floor: float, cap: float) -> dict[str, float]:
    raw = {s: p * math.prod(sig.lr[s] ** sig.weight for sig in signals) for s, p in prior.items()}
    return bounded_normalize(raw, floor, cap)


def contributions(prior: Mapping[str, float], signals: Sequence[ActiveSignal],
                  floor: float, cap: float) -> dict[str, dict[str, float]]:
    """Per signal: the probability it adds to each scenario, against the same run without it."""
    full = posterior(prior, signals, floor, cap)
    out: dict[str, dict[str, float]] = {}
    for sig in signals:
        without = posterior(prior, [o for o in signals if o is not sig], floor, cap)
        out[sig.rule_id] = {s: full[s] - without[s] for s in prior}
    return out
```

- [ ] **Step 4: Run and confirm they pass**

- [ ] **Step 5: Mutation matrix**

| Mutation | Must fail |
|---|---|
| Replace the `bounded_normalize` body with clip-then-renormalize: `s=sum(raw.values()); c={k:min(max(v/s,floor),cap) for k,v in raw.items()}; t=sum(c.values()); return {k:v/t for k,v in c.items()}` | `test_all_b_signals_stay_inside_the_bounds`, `test_bounded_normalize_pins_the_cap...` |
| `sig.lr[s] ** sig.weight` → `sig.lr[s]` | `test_near_moves_less_than_triggered` |
| Check `under` before `over` | `test_bounded_normalize_pins_the_cap...` (b, c pinned at 0.05, then a at 0.85, so the sum is 0.95) |
| `contributions`: `full[s] - without[s]` → `without[s] - full[s]` | `test_contribution_is_the_change_from_removing_that_signal` |

- [ ] **Step 6: Commit**

```bash
git add packages/core_finance/macro_signals/scenario.py tests/core_finance/test_macro_signal_scenario.py
git commit -m "feat(signals): bounded heuristic scenario probabilities with per-signal contributions"
```

---

### Task 4: FRED client — a raising, redacting fetch

**Files:**
- Modify: `apps/api/services/webscrap/Collector/FREDCollector.py`
- Create: `tests/api/signals/__init__.py` (empty)
- Test: `tests/api/signals/test_fred_collector.py`

**Interfaces:**
- Produces:
  - `FredFetchError(Exception)`
  - `parse_observations(payload: dict) -> list[tuple[str, float]]` (drops `"."`, sorted ascending)
  - `FREDCollector.fetch_observations(series_id: str, start_date: str, timeout: float = 15.0) -> list[tuple[str, float]]`

- [ ] **Step 1: Write the failing tests**

```python
import logging

import pytest
import requests

from apps.api.services.webscrap.Collector import FREDCollector as fred_module
from apps.api.services.webscrap.Collector.FREDCollector import (
    FREDCollector, FredFetchError, parse_observations,
)

KEY = "abcdef0123456789abcdef0123456789"


class FakeResponse:
    def __init__(self, status, payload=None, text=""):
        self.status_code, self._payload, self.text = status, payload, text

    def json(self):
        return self._payload


def test_parse_drops_missing_dots_and_sorts_ascending():
    payload = {"observations": [
        {"date": "2026-10-02", "value": "5.5"}, {"date": "2026-10-01", "value": "."},
        {"date": "2026-09-30", "value": "5.4"}]}
    assert parse_observations(payload) == [("2026-09-30", 5.4), ("2026-10-02", 5.5)]


def test_fetch_observations_passes_a_timeout_and_asc_order(monkeypatch):
    seen = {}

    def fake_get(url, params, timeout):
        seen.update(params=params, timeout=timeout)
        return FakeResponse(200, {"observations": [{"date": "2026-10-01", "value": "1"}]})

    monkeypatch.setattr(fred_module.requests, "get", fake_get)
    assert FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01") == [("2026-10-01", 1.0)]
    assert seen["timeout"] == 15.0 and seen["params"]["sort_order"] == "asc"


def test_connection_error_message_never_contains_the_key(monkeypatch, caplog):
    def boom(url, params, timeout):
        raise requests.ConnectionError(f"Max retries exceeded with url: /x?api_key={KEY}")

    monkeypatch.setattr(fred_module.requests, "get", boom)
    caplog.set_level(logging.DEBUG)
    with pytest.raises(FredFetchError) as info:
        FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01")
    assert KEY not in str(info.value)
    assert info.value.__cause__ is None and info.value.__suppress_context__
    assert KEY not in caplog.text


def test_http_error_body_is_redacted(monkeypatch):
    monkeypatch.setattr(fred_module.requests, "get",
                        lambda url, params, timeout: FakeResponse(400, text=f"bad api_key {KEY}"))
    with pytest.raises(FredFetchError) as info:
        FREDCollector(KEY).fetch_observations("DGS10", "2026-01-01")
    assert KEY not in str(info.value) and "HTTP 400" in str(info.value)
```

- [ ] **Step 2: Run and confirm they fail** (`ImportError: cannot import name 'FredFetchError'`)

Run: `$PY -m pytest tests/api/signals/test_fred_collector.py -q`

- [ ] **Step 3: Implement.** Change the typing import to `from typing import List, Optional, Dict, Tuple`. Add these at module level, above the class:

```python
class FredFetchError(Exception):
    """A FRED request failed. The message never contains the API key."""


def parse_observations(payload: dict) -> List[Tuple[str, float]]:
    """FRED marks a missing day with '.'; it is dropped, not read as zero."""
    rows = [(o["date"], float(o["value"])) for o in payload.get("observations", []) if o["value"] != "."]
    return sorted(rows)
```

Add this method inside `class FREDCollector`. Leave `fetch_indicator` untouched.

```python
    def fetch_observations(self, series_id: str, start_date: str, timeout: float = 15.0) -> List[Tuple[str, float]]:
        """Raising variant for the signal engine: a failure must be told apart from no data.

        `from None` drops the requests exception, whose message carries the full URL and
        therefore the api_key query parameter.
        """
        params = {"series_id": series_id, "api_key": self.api_key, "file_type": "json",
                  "sort_order": "asc", "observation_start": start_date}
        try:
            response = requests.get(self.base_url, params=params, timeout=timeout)
        except requests.RequestException as exc:
            raise FredFetchError(f"{series_id}: {type(exc).__name__}") from None
        if response.status_code != 200:
            detail = response.text[:200].replace(self.api_key, "***")
            raise FredFetchError(f"{series_id}: HTTP {response.status_code} {detail}")
        return parse_observations(response.json())
```

- [ ] **Step 4: Run and confirm they pass**

- [ ] **Step 5: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `from None` → `from exc`, with message `f"{series_id}: {exc}"` | `test_connection_error_message_never_contains_the_key` |
| drop `.replace(self.api_key, "***")` | `test_http_error_body_is_redacted` |
| drop `if o["value"] != "."` | `test_parse_drops_missing_dots_and_sorts_ascending` (ValueError) |

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/webscrap/Collector/FREDCollector.py tests/api/signals
git commit -m "feat(fred): raising, key-redacting observation fetch for the signal engine"
```

---

### Task 5: rules.yaml, its schema, and fail-fast loading

**Files:**
- Create: `apps/api/services/signals/__init__.py` (empty), `apps/api/services/signals/rules.yaml`, `apps/api/services/signals/models.py`
- Test: `tests/api/signals/test_rules_config.py`

**Interfaces:**
- Produces:
  - `KNOWN_SERIES: frozenset[str]`
  - `LevelStreakRule | RollingMeanRule | MomPctRule | LevelChangeRule | CompoundRule` (`AutoRule`), `ManualRule`, `Rule` (discriminated by `kind`). Rule field names are exactly the YAML keys below.
  - `RulesFile(scenario: ScenarioConfig, rules: list[Rule])`, `LoadedRules(file: RulesFile, version: str)`
  - `RULES_PATH: Path`, `load_rules(path: Path | None = None) -> LoadedRules`, `get_rules() -> LoadedRules`, `reload_rules() -> LoadedRules`
  - `scenario.prior.a/b/c`, `scenario.floor`, `scenario.cap`, `scenario.weights.triggered/near`

- [ ] **Step 1: Write `rules.yaml`**

```yaml
# Macro signal rules. Thresholds and likelihood ratios live ONLY here.
# rules_version is the sha256 of this file's bytes, so any edit shows up as a
# dashed line on the probability trend chart.
# max_age_days: daily 7, Brent 14 (EIA publishes weekly), monthly 80 (FRED dates a
# monthly value on the 1st and it is published about six weeks later).
scenario:
  prior: {a: 0.35, b: 0.45, c: 0.20}
  floor: 0.05
  cap: 0.85
  weights: {triggered: 1.0, near: 0.5}

rules:
  - id: b_tnx_sticky
    label: {ko: "10년물 고착", en: "10Y yield sticky"}
    direction: B
    kind: level_streak
    series: [DGS10]
    max_age_days: 7
    op: ">="
    threshold: 5.50
    days: 10
    near_threshold: 5.35
    near_days: 5
    lr: {a: 0.7, b: 1.2, c: 1.5}

  - id: b_core_cpi_hot
    label: {ko: "근원 CPI 과열", en: "Core CPI hot"}
    direction: B
    kind: mom_pct
    series: [CPILFESL]
    max_age_days: 80
    op: ">="
    threshold: 0.25
    near_threshold: 0.20
    lr: {a: 0.8, b: 1.2, c: 1.2}

  - id: b_hy_wide
    label: {ko: "하이일드 스프레드 확대", en: "High-yield spread wide"}
    direction: B
    kind: level_streak          # days: 1 = the latest value alone
    series: [BAMLH0A0HYM2]
    max_age_days: 7
    op: ">="
    threshold: 3.50
    days: 1
    near_threshold: 3.20
    lr: {a: 0.6, b: 1.1, c: 1.8}

  - id: b_brent_spike
    label: {ko: "유가 급등", en: "Oil price spike"}
    direction: B
    kind: rolling_mean
    series: [DCOILBRENTEU]
    max_age_days: 14
    window: 5
    op: ">="
    threshold: 110
    near_threshold: 105
    lr: {a: 0.7, b: 1.2, c: 1.4}

  - id: b_fed_hike
    label: {ko: "연준 추가 인상", en: "Fed hikes again"}
    direction: B
    kind: level_change
    series: [DFEDTARU]
    max_age_days: 7
    lookback_days: 7
    op: ">"
    threshold: 0.0
    lr: {a: 0.8, b: 1.2, c: 1.2}

  - id: a_tnx_relief
    label: {ko: "10년물 안정", en: "10Y yield relief"}
    direction: A
    kind: level_streak
    series: [DGS10]
    max_age_days: 7
    op: "<"
    threshold: 5.00
    days: 5
    near_threshold: 5.15
    lr: {a: 1.5, b: 0.9, c: 0.6}

  - id: a_brent_relief
    label: {ko: "유가 안정", en: "Oil price relief"}
    direction: A
    kind: rolling_mean
    series: [DCOILBRENTEU]
    max_age_days: 14
    window: 5
    op: "<"
    threshold: 90
    near_threshold: 95
    lr: {a: 1.4, b: 0.9, c: 0.7}

  - id: a_labor_core
    label: {ko: "고용 반등 + 근원 둔화", en: "Jobs rebound + core cooling"}
    direction: A
    kind: compound
    series: [PAYEMS, CPILFESL]
    max_age_days: 80
    conditions:
      - {label: payrolls_change_k, series: PAYEMS, transform: mom_diff, op: ">=", threshold: 100}
      - {label: core_cpi_mom_pct, series: CPILFESL, transform: mom_pct, op: "<", threshold: 0.25}
    lr: {a: 1.3, b: 0.9, c: 0.7}

  - id: m_capex_reaction
    label: {ko: "capex 상향인데 주가 하락", en: "Capex raised, stock fell"}
    direction: B
    kind: manual
    lr: {a: 0.7, b: 1.2, c: 1.5}

  - id: m_iran_strike
    label: {ko: "이란 공습 재개", en: "Iran strikes resume"}
    direction: B
    kind: manual
    lr: {a: 0.7, b: 1.3, c: 1.3}

  - id: m_breadth
    label: {ko: "시장 폭 개선", en: "Market breadth improving"}
    direction: A
    kind: manual
    lr: {a: 1.4, b: 0.9, c: 0.7}
```

- [ ] **Step 2: Write the failing tests**

```python
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from pydantic import ValidationError

from apps.api.services.signals import models
from apps.api.services.signals.models import RULES_PATH, load_rules


def write_variant(tmp_path: Path, mutate) -> Path:
    data = yaml.safe_load(RULES_PATH.read_text(encoding="utf-8"))
    mutate(data)
    path = tmp_path / "rules.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return path


def test_shipped_rules_load_with_eight_auto_and_three_manual():
    loaded = load_rules()
    kinds = [r.kind for r in loaded.file.rules]
    assert len(kinds) == 11 and kinds.count("manual") == 3
    assert len(loaded.version) == 12


def test_unknown_series_id_is_rejected(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"][0].update(series=["DGS99"]))
    with pytest.raises(ValidationError, match="DGS99"):
        load_rules(path)


def test_typo_key_is_rejected(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"][0].update(treshold=5.5))
    with pytest.raises(ValidationError):
        load_rules(path)


def test_prior_must_sum_to_one(tmp_path):
    path = write_variant(tmp_path, lambda d: d["scenario"]["prior"].update(a=0.5))
    with pytest.raises(ValidationError, match="sum"):
        load_rules(path)


def test_duplicate_rule_ids_are_rejected(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"].append(d["rules"][0]))
    with pytest.raises(ValidationError, match="duplicate"):
        load_rules(path)


def test_version_changes_when_the_file_changes(tmp_path):
    path = write_variant(tmp_path, lambda d: d["rules"][0].update(threshold=5.6))
    assert load_rules(path).version != load_rules().version


def test_app_start_fails_on_an_invalid_rules_file(tmp_path, monkeypatch):
    """Stays red until Task 7 wires reload_rules() into lifespan."""
    from apps.api.main import app

    bad = write_variant(tmp_path, lambda d: d["rules"][0].update(series=["DGS99"]))
    monkeypatch.setattr(models, "RULES_PATH", bad)
    with pytest.raises(ValidationError):
        with TestClient(app):
            pass
```

- [ ] **Step 3: Run and confirm they fail** (`ModuleNotFoundError`)

- [ ] **Step 4: Implement `models.py`**

```python
"""Schema and loader for rules.yaml.

Validation runs at app start (`reload_rules` in main.lifespan), so a typo'd key or an
unknown series id stops the backend instead of silently dropping a signal.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal, Union

import yaml
from pydantic import BaseModel, ConfigDict, Field, PositiveFloat, PositiveInt, model_validator

RULES_PATH = Path(__file__).with_name("rules.yaml")

# The FRED series this engine knows. A new series is added here on purpose, never by a
# typo in rules.yaml.
KNOWN_SERIES = frozenset({"DGS10", "CPILFESL", "BAMLH0A0HYM2", "DCOILBRENTEU", "DFEDTARU", "PAYEMS"})

Op = Literal[">=", ">", "<", "<="]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Label(_Strict):
    ko: str
    en: str


class Likelihood(_Strict):
    a: PositiveFloat
    b: PositiveFloat
    c: PositiveFloat


class Probabilities(_Strict):
    a: PositiveFloat
    b: PositiveFloat
    c: PositiveFloat

    @model_validator(mode="after")
    def _sums_to_one(self):
        if abs(self.a + self.b + self.c - 1.0) > 1e-9:
            raise ValueError("prior must sum to 1")
        return self


class Weights(_Strict):
    triggered: PositiveFloat
    near: PositiveFloat

    @model_validator(mode="after")
    def _near_below_triggered(self):
        if self.near >= self.triggered:
            raise ValueError("near weight must be below triggered weight")
        return self


class ScenarioConfig(_Strict):
    prior: Probabilities
    floor: float = Field(ge=0, lt=1)
    cap: float = Field(gt=0, le=1)
    weights: Weights

    @model_validator(mode="after")
    def _feasible(self):
        if not (3 * self.floor <= 1.0 <= 3 * self.cap):
            raise ValueError("floor/cap are infeasible for three scenarios")
        return self


class _AutoBase(_Strict):
    id: str = Field(pattern=r"^[ab]_[a-z0-9_]+$")
    label: Label
    direction: Literal["A", "B"]
    series: list[str] = Field(min_length=1)
    max_age_days: PositiveInt
    lr: Likelihood


class LevelStreakRule(_AutoBase):
    kind: Literal["level_streak"]
    op: Op
    threshold: float
    days: PositiveInt
    near_threshold: float | None = None
    near_days: PositiveInt | None = None


class RollingMeanRule(_AutoBase):
    kind: Literal["rolling_mean"]
    window: PositiveInt
    op: Op
    threshold: float
    near_threshold: float | None = None


class MomPctRule(_AutoBase):
    kind: Literal["mom_pct"]
    op: Op
    threshold: float
    near_threshold: float | None = None


class LevelChangeRule(_AutoBase):
    kind: Literal["level_change"]
    lookback_days: PositiveInt
    op: Op
    threshold: float = 0.0


class CompoundCondition(_Strict):
    label: str
    series: str
    transform: Literal["mom_pct", "mom_diff"]
    op: Op
    threshold: float


class CompoundRule(_AutoBase):
    kind: Literal["compound"]
    conditions: list[CompoundCondition] = Field(min_length=2)


class ManualRule(_Strict):
    id: str = Field(pattern=r"^m_[a-z0-9_]+$")
    label: Label
    direction: Literal["A", "B"]
    kind: Literal["manual"]
    lr: Likelihood


AutoRule = Union[LevelStreakRule, RollingMeanRule, MomPctRule, LevelChangeRule, CompoundRule]
Rule = Annotated[
    Union[LevelStreakRule, RollingMeanRule, MomPctRule, LevelChangeRule, CompoundRule, ManualRule],
    Field(discriminator="kind"),
]


class RulesFile(_Strict):
    scenario: ScenarioConfig
    rules: list[Rule]

    @model_validator(mode="after")
    def _consistent(self):
        ids = [r.id for r in self.rules]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"duplicate rule ids: {duplicates}")
        for rule in self.rules:
            if rule.kind == "manual":
                continue
            unknown = [s for s in rule.series if s not in KNOWN_SERIES]
            if unknown:
                raise ValueError(f"{rule.id}: unknown FRED series {unknown}")
            if rule.kind == "compound":
                stray = [c.series for c in rule.conditions if c.series not in rule.series]
                if stray:
                    raise ValueError(f"{rule.id}: condition series {stray} not listed in series")
            elif len(rule.series) != 1:
                raise ValueError(f"{rule.id}: {rule.kind} takes exactly one series")
        return self


@dataclass(frozen=True)
class LoadedRules:
    file: RulesFile
    version: str


def load_rules(path: Path | None = None) -> LoadedRules:
    raw = (path or RULES_PATH).read_bytes()
    return LoadedRules(RulesFile.model_validate(yaml.safe_load(raw)), hashlib.sha256(raw).hexdigest()[:12])


_current: LoadedRules | None = None


def reload_rules() -> LoadedRules:
    global _current
    _current = load_rules()
    return _current


def get_rules() -> LoadedRules:
    return _current or reload_rules()
```

- [ ] **Step 5: Run and confirm everything passes** except `test_app_start_fails_on_an_invalid_rules_file`, which waits for Task 7.

- [ ] **Step 6: Mutation matrix**

| Mutation | Must fail |
|---|---|
| remove the `unknown` series check | `test_unknown_series_id_is_rejected` |
| `extra="forbid"` → `extra="ignore"` | `test_typo_key_is_rejected` |
| remove `_sums_to_one` | `test_prior_must_sum_to_one` |
| remove the `duplicates` check | `test_duplicate_rule_ids_are_rejected` |

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/signals tests/api/signals/test_rules_config.py
git commit -m "feat(signals): rules.yaml with a strict schema and content-hash version"
```

---

### Task 6: Schema, store, fetcher

**Files:**
- Modify: `apps/api/services/db.py`
- Create: `apps/api/services/signals/store.py`, `apps/api/services/signals/fetch.py`, `tests/fixtures/fred/*.json` (6 files)
- Test: `tests/api/signals/conftest.py`, `tests/api/signals/test_store.py`, `tests/api/signals/test_fetch.py`

**Interfaces:**
- Consumes: `Observation` (Task 2), `FREDCollector.fetch_observations`, `FredFetchError`, `parse_observations` (Task 4)
- Produces:
  - store types: `ResultRow(rule_id, state, value, observed_at: str|None, threshold, note, contribution: dict|None)`, `StoredSnapshot(id, iso_week, run_at, rules_version, probs: dict, results: tuple[ResultRow,...])`, `HistoryRow(iso_week, run_at, rules_version, a, b, c)`, `ManualInput(state, note, updated_at)`
  - store functions: `iso_week(d) -> str`, `save_snapshot(*, iso_week, run_at, rules_version, probs, results) -> None`, `load_snapshot(week)`, `latest_snapshot()`, `previous_snapshot(week)`, `history(weeks) -> list[HistoryRow]`, `get_manual_inputs(week) -> dict[str, ManualInput]`, `put_manual_input(rule_id, week, state, note, updated_at)`, `save_cache(series_id, observations, fetched_at)`, `load_cache(series_id, start) -> list[Observation]`
  - fetch: `SeriesSource = Callable[[str, date], list[Observation]]`, `FetchedSeries(observations, error: str|None, from_cache: bool)`, `SeriesFetcher(source, *, now)` with `.get_series(series_id, start) -> FetchedSeries`, `fred_source_from_env() -> SeriesSource|None`
  - tests: the `fixture_source` fixture (`fixture_source(missing=frozenset()) -> SeriesSource`) and `AS_OF = date(2026, 10, 10)` in `tests/api/signals/conftest.py`

- [ ] **Step 1: Generate the FRED fixtures.** This is a one-off; commit the JSON, not the script. At `as_of = 2026-10-10` the expected states are:
  - `b_tnx_sticky` triggered: 10 real observations at 5.55, with one `.` in between
  - `b_core_cpi_hot` triggered: +0.30%, 70 days old
  - `b_hy_wide` near: 3.30
  - `b_brent_spike` and `a_brent_relief` not_triggered: mean 100, 5 days old
  - `b_fed_hike` not_triggered: flat
  - `a_tnx_relief` not_triggered
  - `a_labor_core` near: +150k, but core 0.30 is not below 0.25

```bash
$PY - <<'EOF'
import json
from pathlib import Path
import pandas as pd

OUT = Path("tests/fixtures/fred"); OUT.mkdir(parents=True, exist_ok=True)
def payload(rows):
    obs = [{"realtime_start": "2026-10-10", "realtime_end": "2026-10-10", "date": d, "value": v} for d, v in rows]
    return {"realtime_start": "2026-10-10", "realtime_end": "2026-10-10", "observation_start": "1600-01-01",
            "observation_end": "9999-12-31", "units": "lin", "output_type": 1, "file_type": "json",
            "order_by": "observation_date", "sort_order": "asc", "count": len(obs), "offset": 0,
            "limit": 100000, "observations": obs}
bd = lambda a, b: [d.date().isoformat() for d in pd.bdate_range(a, b)]
dgs = [(d, "5.40") for d in bd("2026-08-03", "2026-09-24")] + [(d, "5.55") for d in bd("2026-09-25", "2026-10-09")]
series = {
    "DGS10": [(d, "." if d == "2026-10-01" else v) for d, v in dgs],
    "CPILFESL": [("2026-01-01", "325.00"), ("2026-02-01", "325.65"), ("2026-03-01", "326.30"),
                 ("2026-04-01", "326.95"), ("2026-05-01", "327.60"), ("2026-06-01", "328.26"),
                 ("2026-07-01", "330.00"), ("2026-08-01", "330.99")],
    "BAMLH0A0HYM2": [(d, "3.30") for d in bd("2026-08-03", "2026-10-09")],
    "DCOILBRENTEU": [(d, "100.00") for d in bd("2026-08-03", "2026-10-05")],
    "DFEDTARU": [(d.date().isoformat(), "4.00") for d in pd.date_range("2026-08-01", "2026-10-09")],
    "PAYEMS": [("2026-06-01", "159800"), ("2026-07-01", "159900"), ("2026-08-01", "160000"), ("2026-09-01", "160150")],
}
for sid, rows in series.items():
    (OUT / f"{sid}.json").write_text(json.dumps(payload(rows), indent=1) + "\n", encoding="utf-8")
EOF
```

- [ ] **Step 2: Shared test fixtures** (`tests/api/signals/conftest.py`)

```python
import json
from datetime import date
from pathlib import Path

import pytest

from apps.api.services.webscrap.Collector.FREDCollector import FredFetchError, parse_observations
from packages.core_finance.macro_signals.rules import Observation

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "fred"
AS_OF = date(2026, 10, 10)   # Saturday, ISO 2026-W41


@pytest.fixture
def fixture_source():
    def make(missing=frozenset()):
        def source(series_id: str, start: date) -> list[Observation]:
            path = FIXTURES / f"{series_id}.json"
            if series_id in missing or not path.exists():
                raise FredFetchError(f"{series_id}: fixture missing")
            rows = parse_observations(json.loads(path.read_text(encoding="utf-8")))
            return [Observation(date.fromisoformat(d), v) for d, v in rows if date.fromisoformat(d) >= start]
        return source
    return make
```

- [ ] **Step 3: Write the failing tests**

`tests/api/signals/test_store.py`:

```python
from datetime import date

from apps.api.services.db import get_db
from apps.api.services.signals import store
from apps.api.services.signals.store import ResultRow


def row(rule_id="b_hy_wide", state="near"):
    return ResultRow(rule_id, state, 3.3, "2026-10-09", 3.5, "n", {"a": -0.01, "b": 0.0, "c": 0.01})


def save(week, probs=(0.3, 0.5, 0.2), results=(row(),), run_at="2026-10-10T00:00:00+00:00"):
    store.save_snapshot(iso_week=week, run_at=run_at, rules_version="v1",
                        probs=dict(zip("abc", probs)), results=list(results))


def test_iso_week_format():
    assert store.iso_week(date(2026, 10, 10)) == "2026-W41"
    assert store.iso_week(date(2027, 1, 1)) == "2026-W53"


def test_same_week_overwrites_instead_of_adding_a_row():
    save("2026-W41", results=[row("a"), row("b")])
    save("2026-W41", probs=(0.2, 0.6, 0.2), results=[row("c")])
    with get_db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM signal_snapshots").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM signal_results").fetchone()[0] == 1
    snap = store.load_snapshot("2026-W41")
    assert snap.probs == {"a": 0.2, "b": 0.6, "c": 0.2}
    assert [r.rule_id for r in snap.results] == ["c"]
    assert snap.results[0].contribution == {"a": -0.01, "b": 0.0, "c": 0.01}


def test_history_is_oldest_first_and_limited():
    for w in ("2026-W39", "2026-W40", "2026-W41"):
        save(w)
    assert [h.iso_week for h in store.history(2)] == ["2026-W40", "2026-W41"]
    assert store.previous_snapshot("2026-W41").iso_week == "2026-W40"
    assert store.latest_snapshot().iso_week == "2026-W41"


def test_manual_inputs_are_per_week_and_overwrite():
    store.put_manual_input("m_breadth", "2026-W41", "near", "x", "t1")
    store.put_manual_input("m_breadth", "2026-W41", "triggered", "y", "t2")
    assert store.get_manual_inputs("2026-W41")["m_breadth"].state == "triggered"
    assert store.get_manual_inputs("2026-W42") == {}
```

`tests/api/signals/test_fetch.py`:

```python
from datetime import date, datetime, timezone

from apps.api.services.signals import store
from apps.api.services.signals.fetch import SeriesFetcher
from packages.core_finance.macro_signals.rules import Observation

NOW = lambda: datetime(2026, 10, 10, tzinfo=timezone.utc)
START = date(2026, 1, 1)


def test_each_series_is_fetched_once_per_run():
    calls = []

    def source(series_id, start):
        calls.append(series_id)
        return [Observation(date(2026, 10, 9), 1.0)]

    fetcher = SeriesFetcher(source, now=NOW)
    fetcher.get_series("DGS10", START)
    fetcher.get_series("DGS10", START)
    assert calls == ["DGS10"]


def test_a_successful_fetch_is_written_to_the_cache(fixture_source):
    SeriesFetcher(fixture_source(), now=NOW).get_series("PAYEMS", START)
    assert store.load_cache("PAYEMS", START)[-1] == Observation(date(2026, 9, 1), 160150.0)


def test_failed_fetch_falls_back_to_cached_observations(fixture_source):
    SeriesFetcher(fixture_source(), now=NOW).get_series("PAYEMS", START)
    result = SeriesFetcher(fixture_source(missing={"PAYEMS"}), now=NOW).get_series("PAYEMS", START)
    assert result.from_cache and "fixture missing" in result.error
    assert result.observations[-1].value == 160150.0


def test_no_key_reports_it_and_uses_the_cache():
    result = SeriesFetcher(None, now=NOW).get_series("DGS10", START)
    assert result.error == "FRED_API_KEY is not set" and result.observations == []
```

- [ ] **Step 4: Run and confirm they fail** (`ImportError ... store`)

Run: `$PY -m pytest tests/api/signals/test_store.py tests/api/signals/test_fetch.py -q`

- [ ] **Step 5: Add the schema to `db.py`.** Define it above `_CREATE_SCHEMA_SQL`. No semicolons inside its comments, because the compatibility loop below splits on `;`.

```python
# Macro signal engine (docs/superpowers/plans/2026-10-12-macro-signal-engine.md).
# One snapshot per ISO week, overwritten on re-run. contrib_* hold each signal's
# contribution as computed at run time, so a later rules.yaml edit cannot rewrite history.
_SIGNAL_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS signal_snapshots (
    id            INTEGER PRIMARY KEY,
    iso_week      TEXT NOT NULL UNIQUE,
    run_at        TEXT NOT NULL,
    rules_version TEXT NOT NULL,
    prob_a        REAL NOT NULL,
    prob_b        REAL NOT NULL,
    prob_c        REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS signal_results (
    snapshot_id   INTEGER NOT NULL REFERENCES signal_snapshots(id) ON DELETE CASCADE,
    rule_id       TEXT NOT NULL,
    state         TEXT NOT NULL CHECK (state IN ('triggered','near','not_triggered','stale')),
    value         REAL,
    observed_at   TEXT,
    threshold     REAL,
    note          TEXT,
    contrib_a     REAL,
    contrib_b     REAL,
    contrib_c     REAL,
    PRIMARY KEY (snapshot_id, rule_id)
);
CREATE TABLE IF NOT EXISTS signal_manual_inputs (
    rule_id       TEXT NOT NULL,
    iso_week      TEXT NOT NULL,
    state         TEXT NOT NULL CHECK (state IN ('triggered','near','not_triggered')),
    note          TEXT,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (rule_id, iso_week)
);
CREATE TABLE IF NOT EXISTS fred_cache (
    series_id     TEXT NOT NULL,
    obs_date      TEXT NOT NULL,
    value         REAL NOT NULL,
    fetched_at    TEXT NOT NULL,
    PRIMARY KEY (series_id, obs_date)
);
"""
```

Then:
- Append it to the end of `_CREATE_SCHEMA_SQL`: change the closing `"""` of that literal to `""" + _SIGNAL_SCHEMA_SQL`, leaving the literal's contents unchanged.
- Add the following at the end of `_ensure_schema_compatibility`. A legacy database can abort `executescript` before it reaches these statements (`init_db` catches `no such column: universe_key`), which is the same reason `industry_benchmark` is created there too.

```python
    # Additive: the create script can abort early on a legacy database (see init_db), so
    # the signal tables are created here too. Nothing to backfill.
    for statement in _SIGNAL_SCHEMA_SQL.split(";"):
        if statement.strip():
            conn.execute(statement)
```

- [ ] **Step 6: Implement `store.py`**

```python
"""SQLite reads and writes for the macro signal engine.

Same overwrite-by-key pattern as industry_benchmark_store.store_vintage, keyed by ISO week.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Mapping, Sequence

from apps.api.services.db import get_db
from packages.core_finance.macro_signals.rules import Observation


def iso_week(d: date) -> str:
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


@dataclass(frozen=True)
class ResultRow:
    rule_id: str
    state: str
    value: float | None
    observed_at: str | None
    threshold: float | None
    note: str
    contribution: dict[str, float] | None


@dataclass(frozen=True)
class StoredSnapshot:
    id: int
    iso_week: str
    run_at: str
    rules_version: str
    probs: dict[str, float]
    results: tuple[ResultRow, ...]


@dataclass(frozen=True)
class HistoryRow:
    iso_week: str
    run_at: str
    rules_version: str
    a: float
    b: float
    c: float


@dataclass(frozen=True)
class ManualInput:
    state: str
    note: str
    updated_at: str


def save_snapshot(*, iso_week: str, run_at: str, rules_version: str,
                  probs: Mapping[str, float], results: Sequence[ResultRow]) -> None:
    with get_db() as conn:
        conn.execute(
            """INSERT INTO signal_snapshots (iso_week, run_at, rules_version, prob_a, prob_b, prob_c)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(iso_week) DO UPDATE SET run_at = excluded.run_at,
                 rules_version = excluded.rules_version, prob_a = excluded.prob_a,
                 prob_b = excluded.prob_b, prob_c = excluded.prob_c""",
            (iso_week, run_at, rules_version, probs["a"], probs["b"], probs["c"]),
        )
        snapshot_id = conn.execute(
            "SELECT id FROM signal_snapshots WHERE iso_week = ?", (iso_week,)).fetchone()["id"]
        conn.execute("DELETE FROM signal_results WHERE snapshot_id = ?", (snapshot_id,))
        conn.executemany(
            """INSERT INTO signal_results (snapshot_id, rule_id, state, value, observed_at, threshold,
                 note, contrib_a, contrib_b, contrib_c) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(snapshot_id, r.rule_id, r.state, r.value, r.observed_at, r.threshold, r.note,
              *((r.contribution or {}).get(s) for s in "abc")) for r in results],
        )


def _load(conn, row) -> StoredSnapshot:
    results = conn.execute(
        "SELECT * FROM signal_results WHERE snapshot_id = ? ORDER BY rowid", (row["id"],)).fetchall()
    return StoredSnapshot(
        id=row["id"], iso_week=row["iso_week"], run_at=row["run_at"], rules_version=row["rules_version"],
        probs={"a": row["prob_a"], "b": row["prob_b"], "c": row["prob_c"]},
        results=tuple(
            ResultRow(r["rule_id"], r["state"], r["value"], r["observed_at"], r["threshold"], r["note"] or "",
                      None if r["contrib_a"] is None else {s: r[f"contrib_{s}"] for s in "abc"})
            for r in results),
    )


def _one(sql: str, params: tuple) -> StoredSnapshot | None:
    with get_db() as conn:
        row = conn.execute(sql, params).fetchone()
        return _load(conn, row) if row else None


def load_snapshot(week: str) -> StoredSnapshot | None:
    return _one("SELECT * FROM signal_snapshots WHERE iso_week = ?", (week,))


def latest_snapshot() -> StoredSnapshot | None:
    return _one("SELECT * FROM signal_snapshots ORDER BY iso_week DESC LIMIT 1", ())


def previous_snapshot(week: str) -> StoredSnapshot | None:
    return _one("SELECT * FROM signal_snapshots WHERE iso_week < ? ORDER BY iso_week DESC LIMIT 1", (week,))


def history(weeks: int) -> list[HistoryRow]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM signal_snapshots ORDER BY iso_week DESC LIMIT ?", (weeks,)).fetchall()
    return [HistoryRow(r["iso_week"], r["run_at"], r["rules_version"], r["prob_a"], r["prob_b"], r["prob_c"])
            for r in reversed(rows)]


def get_manual_inputs(week: str) -> dict[str, ManualInput]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM signal_manual_inputs WHERE iso_week = ?", (week,)).fetchall()
    return {r["rule_id"]: ManualInput(r["state"], r["note"] or "", r["updated_at"]) for r in rows}


def put_manual_input(rule_id: str, week: str, state: str, note: str, updated_at: str) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO signal_manual_inputs (rule_id, iso_week, state, note, updated_at) "
            "VALUES (?, ?, ?, ?, ?)", (rule_id, week, state, note, updated_at))


def save_cache(series_id: str, observations: Sequence[Observation], fetched_at: str) -> None:
    with get_db() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO fred_cache (series_id, obs_date, value, fetched_at) VALUES (?, ?, ?, ?)",
            [(series_id, o.date.isoformat(), o.value, fetched_at) for o in observations])


def load_cache(series_id: str, start: date) -> list[Observation]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT obs_date, value FROM fred_cache WHERE series_id = ? AND obs_date >= ? ORDER BY obs_date",
            (series_id, start.isoformat())).fetchall()
    return [Observation(date.fromisoformat(r["obs_date"]), r["value"]) for r in rows]
```

- [ ] **Step 7: Implement `fetch.py`**

```python
"""FRED access for one engine run: each series once, the cache when FRED is unreachable."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime
from typing import Callable

from apps.api.services.signals import store
from apps.api.services.webscrap.Collector.FREDCollector import FREDCollector, FredFetchError
from packages.core_finance.macro_signals.rules import Observation

SeriesSource = Callable[[str, date], list[Observation]]


@dataclass(frozen=True)
class FetchedSeries:
    observations: list[Observation]
    error: str | None
    from_cache: bool


def fred_source_from_env() -> SeriesSource | None:
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        return None
    collector = FREDCollector(key)

    def source(series_id: str, start: date) -> list[Observation]:
        return [Observation(date.fromisoformat(d), v)
                for d, v in collector.fetch_observations(series_id, start.isoformat())]
    return source


class SeriesFetcher:
    def __init__(self, source: SeriesSource | None, *, now: Callable[[], datetime]):
        self._source = source
        self._now = now
        self._memo: dict[str, FetchedSeries] = {}

    def get_series(self, series_id: str, start: date) -> FetchedSeries:
        if series_id not in self._memo:
            self._memo[series_id] = self._fetch(series_id, start)
        return self._memo[series_id]

    def _fetch(self, series_id: str, start: date) -> FetchedSeries:
        if self._source is None:
            return self._from_cache(series_id, start, "FRED_API_KEY is not set")
        try:
            observations = self._source(series_id, start)
        except FredFetchError as exc:
            return self._from_cache(series_id, start, str(exc))
        store.save_cache(series_id, observations, self._now().isoformat(timespec="seconds"))
        return FetchedSeries(observations, None, False)

    def _from_cache(self, series_id: str, start: date, reason: str) -> FetchedSeries:
        return FetchedSeries(store.load_cache(series_id, start), reason, True)
```

- [ ] **Step 8: Run**

Run: `$PY -m pytest tests/api/signals -q`. Everything passes except the deferred `test_app_start_fails...`.
Run: `$PY -m pytest -q`. Expected: 1883 + new tests pass, with only the deferred one failing.

- [ ] **Step 9: Mutation matrix**

| Mutation | Must fail |
|---|---|
| remove the `DELETE FROM signal_results` line | `test_same_week_overwrites...` (3 result rows, not 1) |
| `history`: drop `reversed(...)` | `test_history_is_oldest_first_and_limited` |
| `SeriesFetcher.get_series` without the memo | `test_each_series_is_fetched_once_per_run` |
| `_fetch`: on `FredFetchError` return `FetchedSeries([], str(exc), False)` | `test_failed_fetch_falls_back_to_cached_observations` |

- [ ] **Step 10: Commit**

```bash
git add apps/api/services/db.py apps/api/services/signals/store.py apps/api/services/signals/fetch.py tests/fixtures/fred tests/api/signals
git commit -m "feat(signals): weekly snapshot store, FRED cache and per-run fetcher"
```

---

### Task 7: Engine, API router, startup validation

**Files:**
- Create: `apps/api/services/signals/engine.py`, `apps/api/models/schema_parts/signals.py`, `apps/api/routes/signals.py`
- Modify: `apps/api/main.py`
- Test: `tests/api/signals/test_engine.py`, `tests/api/signals/test_signal_routes.py`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  - `engine.KST`, `engine.utc_now() -> datetime`, `engine.kst_today() -> date`, `engine.default_source()`, `engine.DEFAULT`
  - `engine.RunOutcome(snapshot: StoredSnapshot, failures: list[str])`
  - `engine.run(as_of: date|None = None, *, source=DEFAULT) -> RunOutcome`, `engine.rescore(week: str) -> StoredSnapshot|None`
  - `engine.evaluate_rule(rule, fetched, as_of) -> Evaluation`, `engine.score(loaded, evaluations) -> (probs, contributions)`
  - HTTP, all in the `APIResponse` envelope (`{"status","data","meta"}`): `POST /api/v1/signals/run`, `GET /latest`, `GET /history?weeks=1..260` (default 26), `GET /rules`, `PUT /manual/{rule_id}`
  - `SignalSnapshot` JSON: `{iso_week, run_at, rules_version, probs:{a,b,c}, previous_probs:{a,b,c}|null, results:[SignalResultOut], failures:[str]}`
  - `SignalResultOut`: `{rule_id, label_ko, label_en, direction, kind, state, value, observed_at, threshold, note, contribution:{a,b,c}|null}`
  - `ManualInputSaved`: `{iso_week, snapshot: SignalSnapshot|null}`

- [ ] **Step 1: Write the failing engine tests** (`tests/api/signals/test_engine.py`)

```python
import pytest

from apps.api.services.db import get_db
from apps.api.services.signals import engine, store

from .conftest import AS_OF

EXPECTED = {
    "b_tnx_sticky": "triggered", "b_core_cpi_hot": "triggered", "b_hy_wide": "near",
    "b_brent_spike": "not_triggered", "b_fed_hike": "not_triggered", "a_tnx_relief": "not_triggered",
    "a_brent_relief": "not_triggered", "a_labor_core": "near",
}


def states(snapshot):
    return {r.rule_id: r.state for r in snapshot.results}


def test_fixture_run_judges_every_auto_rule(fixture_source):
    outcome = engine.run(AS_OF, source=fixture_source())
    assert states(outcome.snapshot) == EXPECTED
    assert outcome.failures == []
    assert outcome.snapshot.iso_week == "2026-W41"


def test_with_three_manual_inputs_eleven_results_are_stored(fixture_source):
    for rule_id in ("m_capex_reaction", "m_iran_strike", "m_breadth"):
        store.put_manual_input(rule_id, "2026-W41", "near", "", "t")
    engine.run(AS_OF, source=fixture_source())
    with get_db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM signal_snapshots").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM signal_results").fetchone()[0] == 11


def test_without_manual_input_manual_rules_are_left_out(fixture_source):
    snapshot = engine.run(AS_OF, source=fixture_source()).snapshot
    assert len(snapshot.results) == 8
    store.put_manual_input("m_breadth", "2026-W41", "not_triggered", "", "t")
    with_input = engine.run(AS_OF, source=fixture_source()).snapshot
    assert len(with_input.results) == 9
    assert with_input.probs == pytest.approx(snapshot.probs)   # not_triggered has weight 0


def test_rerunning_the_same_week_keeps_one_snapshot(fixture_source):
    engine.run(AS_OF, source=fixture_source())
    engine.run(AS_OF, source=fixture_source())
    with get_db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM signal_snapshots").fetchone()[0] == 1


def test_a_missing_series_stales_only_its_rules(fixture_source):
    outcome = engine.run(AS_OF, source=fixture_source(missing={"DCOILBRENTEU"}))
    got = states(outcome.snapshot)
    assert got["b_brent_spike"] == "stale" and got["a_brent_relief"] == "stale"
    assert {k: v for k, v in got.items() if "brent" not in k} == {
        k: v for k, v in EXPECTED.items() if "brent" not in k}
    assert any("DCOILBRENTEU" in f for f in outcome.failures)


def test_last_weeks_result_is_never_multiplied_in(fixture_source):
    first = engine.run(AS_OF, source=fixture_source()).snapshot
    store.save_snapshot(iso_week="2026-W40", run_at="2026-10-03T00:00:00+00:00", rules_version="x",
                        probs={"a": 0.85, "b": 0.10, "c": 0.05}, results=[])
    again = engine.run(AS_OF, source=fixture_source()).snapshot
    assert again.probs == pytest.approx(first.probs, abs=1e-12)


def test_rescore_applies_a_manual_input_without_fetching(fixture_source):
    before = engine.run(AS_OF, source=fixture_source()).snapshot
    store.put_manual_input("m_iran_strike", "2026-W41", "triggered", "", "t")
    after = engine.rescore("2026-W41")
    assert after.probs["b"] > before.probs["b"]
    assert after.run_at == before.run_at
    assert states(after)["b_tnx_sticky"] == "triggered"


def test_contributions_are_stored_for_active_signals_only(fixture_source):
    snapshot = engine.run(AS_OF, source=fixture_source()).snapshot
    by_id = {r.rule_id: r for r in snapshot.results}
    assert by_id["b_hy_wide"].contribution["c"] > 0
    assert by_id["b_fed_hike"].contribution is None
```

- [ ] **Step 2: Write the failing route tests** (`tests/api/signals/test_signal_routes.py`)

```python
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.signals import engine

client = TestClient(app)
FIXED_NOW = datetime(2026, 10, 10, 0, 0, tzinfo=timezone.utc)   # 09:00 KST Saturday


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch, fixture_source):
    monkeypatch.setattr(engine, "utc_now", lambda: FIXED_NOW)
    monkeypatch.setattr(engine, "default_source", lambda: fixture_source())


def test_run_returns_a_snapshot_with_labels_and_evidence():
    response = client.post("/api/v1/signals/run")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["iso_week"] == "2026-W41" and data["failures"] == []
    sticky = next(r for r in data["results"] if r["rule_id"] == "b_tnx_sticky")
    assert sticky["state"] == "triggered" and sticky["label_en"] == "10Y yield sticky"
    assert sticky["label_ko"] == "10년물 고착"
    assert sticky["observed_at"] == "2026-10-09" and sticky["threshold"] == 5.5
    assert data["run_at"].endswith("+00:00")


def test_run_without_a_key_is_200_and_all_auto_rules_stale(monkeypatch):
    monkeypatch.setattr(engine, "default_source", lambda: None)
    response = client.post("/api/v1/signals/run")
    assert response.status_code == 200
    data = response.json()["data"]
    assert {r["state"] for r in data["results"]} == {"stale"}
    assert data["probs"] == pytest.approx({"a": 0.35, "b": 0.45, "c": 0.20})
    assert len(data["failures"]) == 6 and all("FRED_API_KEY is not set" in f for f in data["failures"])


def test_latest_and_history():
    assert client.get("/api/v1/signals/latest").json()["data"] is None
    client.post("/api/v1/signals/run")
    assert client.get("/api/v1/signals/latest").json()["data"]["iso_week"] == "2026-W41"
    history = client.get("/api/v1/signals/history", params={"weeks": 26}).json()["data"]
    assert [h["iso_week"] for h in history] == ["2026-W41"]
    assert client.get("/api/v1/signals/history", params={"weeks": 0}).status_code == 422


def test_rules_endpoint_exposes_thresholds_and_lrs():
    data = client.get("/api/v1/signals/rules").json()["data"]
    sticky = next(r for r in data["rules"] if r["id"] == "b_tnx_sticky")
    assert sticky["threshold"] == 5.5 and sticky["lr"] == {"a": 0.7, "b": 1.2, "c": 1.5}
    assert len(data["version"]) == 12


def test_manual_put_recomputes_the_snapshot():
    before = client.post("/api/v1/signals/run").json()["data"]["probs"]
    response = client.put("/api/v1/signals/manual/m_iran_strike", json={"state": "triggered", "note": "news"})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["snapshot"]["probs"]["b"] > before["b"]


def test_manual_input_saved_before_the_first_run_is_used_by_it():
    saved = client.put("/api/v1/signals/manual/m_breadth", json={"state": "triggered", "note": ""})
    assert saved.json()["data"]["snapshot"] is None
    data = client.post("/api/v1/signals/run").json()["data"]
    assert next(r for r in data["results"] if r["rule_id"] == "m_breadth")["state"] == "triggered"


def test_manual_put_refuses_unknown_rules_states_and_extra_fields():
    assert client.put("/api/v1/signals/manual/b_hy_wide", json={"state": "near"}).status_code == 404
    assert client.put("/api/v1/signals/manual/m_nope", json={"state": "near"}).status_code == 404
    assert client.put("/api/v1/signals/manual/m_breadth", json={"state": "stale"}).status_code == 422
    assert client.put("/api/v1/signals/manual/m_breadth",
                      json={"state": "near", "prob_a": 1}).status_code == 422
```

- [ ] **Step 3: Run and confirm they fail** (`ImportError ... engine`)

- [ ] **Step 4: Implement `engine.py`**

```python
"""One engine run: rules -> series -> evaluations -> manual merge -> probabilities -> store."""
from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Mapping

from apps.api.services.signals import store
from apps.api.services.signals.fetch import FetchedSeries, SeriesFetcher, fred_source_from_env
from apps.api.services.signals.models import LoadedRules, get_rules
from packages.core_finance.macro_signals import rules as r
from packages.core_finance.macro_signals.scenario import ActiveSignal, contributions, posterior

KST = timezone(timedelta(hours=9))   # Korea has no DST
_LOOKBACK_DAYS = 400                 # covers a 10-day streak and two months of monthly data
_RUN_LOCK = threading.Lock()         # the hourly cycle and POST /run must not interleave
DEFAULT = object()


def utc_now() -> datetime:
    return datetime.now(UTC)


def kst_today() -> date:
    return utc_now().astimezone(KST).date()


def default_source():
    return fred_source_from_env()


@dataclass(frozen=True)
class RunOutcome:
    snapshot: store.StoredSnapshot
    failures: list[str]


def evaluate_rule(rule, fetched: Mapping[str, FetchedSeries], as_of: date) -> r.Evaluation:
    for series_id in rule.series:
        series = fetched[series_id]
        if r.is_stale(series.observations, as_of, rule.max_age_days):
            usable = r.upto(series.observations, as_of)
            reason = series.error or f"latest observation older than {rule.max_age_days} days"
            return r.stale(f"{series_id}: {reason}", usable[-1].date if usable else None)
    obs = fetched[rule.series[0]].observations
    if rule.kind == "level_streak":
        return r.level_streak(obs, as_of, op=rule.op, threshold=rule.threshold, days=rule.days,
                              near_threshold=rule.near_threshold, near_days=rule.near_days)
    if rule.kind == "rolling_mean":
        return r.rolling_mean(obs, as_of, window=rule.window, op=rule.op, threshold=rule.threshold,
                              near_threshold=rule.near_threshold)
    if rule.kind == "mom_pct":
        return r.mom_pct(obs, as_of, op=rule.op, threshold=rule.threshold, near_threshold=rule.near_threshold)
    if rule.kind == "level_change":
        return r.level_change(obs, as_of, lookback_days=rule.lookback_days, op=rule.op, threshold=rule.threshold)
    conditions = []
    for c in rule.conditions:
        usable = r.upto(fetched[c.series].observations, as_of)
        point = r.mom_pct_value(usable) if c.transform == "mom_pct" else r.mom_diff_value(usable)
        if point is None:
            return r.stale(f"{c.series}: previous month missing", usable[-1].date if usable else None)
        value, observed_at = point
        conditions.append(r.Condition(c.label, r.compare(c.op, value, c.threshold), value, observed_at))
    return r.compound_all(conditions)


def score(loaded: LoadedRules, evaluations: Mapping[str, r.Evaluation]):
    cfg = loaded.file.scenario
    weights = {"triggered": cfg.weights.triggered, "near": cfg.weights.near}
    lrs = {rule.id: rule.lr.model_dump() for rule in loaded.file.rules}
    active = [ActiveSignal(rule_id, lrs[rule_id], weights[ev.state])
              for rule_id, ev in evaluations.items() if ev.state in weights and rule_id in lrs]
    prior = cfg.prior.model_dump()
    return posterior(prior, active, cfg.floor, cfg.cap), contributions(prior, active, cfg.floor, cfg.cap)


def _manual(loaded: LoadedRules, week: str) -> dict[str, r.Evaluation]:
    """Only rules the user actually set this week. An unset manual rule is left out, not
    counted as not_triggered: treating silence as 'no' would bias every probability."""
    inputs = store.get_manual_inputs(week)
    return {rule.id: r.Evaluation(inputs[rule.id].state, None, None, None, inputs[rule.id].note)
            for rule in loaded.file.rules if rule.kind == "manual" and rule.id in inputs}


def _save(loaded: LoadedRules, week: str, run_at: str, evaluations: dict[str, r.Evaluation]):
    probs, contrib = score(loaded, evaluations)
    rows = []
    for rule in loaded.file.rules:
        ev = evaluations.get(rule.id)
        if ev is None:
            continue
        rows.append(store.ResultRow(rule.id, ev.state, ev.value,
                                    ev.observed_at.isoformat() if ev.observed_at else None,
                                    ev.threshold, ev.note, contrib.get(rule.id)))
    store.save_snapshot(iso_week=week, run_at=run_at, rules_version=loaded.version, probs=probs, results=rows)
    return store.load_snapshot(week)


def run(as_of: date | None = None, *, source=DEFAULT) -> RunOutcome:
    with _RUN_LOCK:
        loaded = get_rules()
        as_of = as_of or kst_today()
        fetcher = SeriesFetcher(default_source() if source is DEFAULT else source, now=utc_now)
        start = as_of - timedelta(days=_LOOKBACK_DAYS)
        auto = [rule for rule in loaded.file.rules if rule.kind != "manual"]
        series_ids = sorted({s for rule in auto for s in rule.series})
        fetched = {sid: fetcher.get_series(sid, start) for sid in series_ids}
        week = store.iso_week(as_of)
        evaluations = {rule.id: evaluate_rule(rule, fetched, as_of) for rule in auto}
        evaluations.update(_manual(loaded, week))
        snapshot = _save(loaded, week, utc_now().isoformat(timespec="seconds"), evaluations)
        return RunOutcome(snapshot, [f.error for f in fetched.values() if f.error])


def rescore(week: str) -> store.StoredSnapshot | None:
    """Recompute a stored week after a manual input, without touching FRED. run_at is kept:
    it records when the data was fetched, which a manual edit does not change, and the
    Saturday schedule compares against it."""
    with _RUN_LOCK:
        snapshot = store.load_snapshot(week)
        if snapshot is None:
            return None
        loaded = get_rules()
        manual_ids = {rule.id for rule in loaded.file.rules if rule.kind == "manual"}
        evaluations = {
            row.rule_id: r.Evaluation(row.state, row.value,
                                      date.fromisoformat(row.observed_at) if row.observed_at else None,
                                      row.threshold, row.note)
            for row in snapshot.results if row.rule_id not in manual_ids}
        evaluations.update(_manual(loaded, week))
        return _save(loaded, week, snapshot.run_at, evaluations)
```

The no-key run reports 6 failures, one per FRED series, each `"FRED_API_KEY is not set"`. Every other fetch error already starts with the series id.

- [ ] **Step 5: Implement `apps/api/models/schema_parts/signals.py`**

```python
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ScenarioProbs(BaseModel):
    a: float
    b: float
    c: float


class SignalResultOut(BaseModel):
    rule_id: str
    label_ko: str
    label_en: str
    direction: Literal["A", "B"] | None
    kind: str | None
    state: Literal["triggered", "near", "not_triggered", "stale"]
    value: float | None
    observed_at: str | None
    threshold: float | None
    note: str
    contribution: ScenarioProbs | None


class SignalSnapshot(BaseModel):
    iso_week: str
    run_at: str
    rules_version: str
    probs: ScenarioProbs
    previous_probs: ScenarioProbs | None
    results: list[SignalResultOut]
    failures: list[str] = Field(default_factory=list)


class SignalHistoryPoint(BaseModel):
    iso_week: str
    run_at: str
    rules_version: str
    a: float
    b: float
    c: float


class SignalRules(BaseModel):
    version: str
    scenario: dict[str, Any]
    rules: list[dict[str, Any]]


class ManualInputIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    state: Literal["triggered", "near", "not_triggered"]
    note: str = Field(default="", max_length=500)


class ManualInputSaved(BaseModel):
    iso_week: str
    snapshot: SignalSnapshot | None
```

- [ ] **Step 6: Implement `apps/api/routes/signals.py`**

```python
"""Macro signal engine: weekly FRED rule verdicts and heuristic scenario probabilities.

A FRED failure never becomes a 500: the affected rules come back `stale` and the reasons
are listed in `failures`.
"""
from fastapi import APIRouter, Body, HTTPException, Query

from apps.api.models.schemas import APIResponse
from apps.api.models.schema_parts.signals import (
    ManualInputIn, ManualInputSaved, ScenarioProbs, SignalHistoryPoint, SignalResultOut, SignalRules,
    SignalSnapshot,
)
from apps.api.services.signals import engine, store
from apps.api.services.signals.models import get_rules

router = APIRouter()


def _out(snapshot: store.StoredSnapshot, failures: list[str] | None = None) -> SignalSnapshot:
    rules = {rule.id: rule for rule in get_rules().file.rules}
    previous = store.previous_snapshot(snapshot.iso_week)
    results = []
    for row in snapshot.results:
        rule = rules.get(row.rule_id)   # None if rules.yaml dropped it since the run
        results.append(SignalResultOut(
            rule_id=row.rule_id, label_ko=rule.label.ko if rule else row.rule_id,
            label_en=rule.label.en if rule else row.rule_id, direction=rule.direction if rule else None,
            kind=rule.kind if rule else None, state=row.state, value=row.value, observed_at=row.observed_at,
            threshold=row.threshold, note=row.note,
            contribution=ScenarioProbs(**row.contribution) if row.contribution else None))
    return SignalSnapshot(
        iso_week=snapshot.iso_week, run_at=snapshot.run_at, rules_version=snapshot.rules_version,
        probs=ScenarioProbs(**snapshot.probs),
        previous_probs=ScenarioProbs(**previous.probs) if previous else None,
        results=results, failures=failures or [])


@router.post("/run", response_model=APIResponse[SignalSnapshot])
def run_signals():
    outcome = engine.run()
    return APIResponse(data=_out(outcome.snapshot, outcome.failures))


@router.get("/latest", response_model=APIResponse[SignalSnapshot | None])
def latest_signals():
    snapshot = store.latest_snapshot()
    return APIResponse(data=_out(snapshot) if snapshot else None)


@router.get("/history", response_model=APIResponse[list[SignalHistoryPoint]])
def signal_history(weeks: int = Query(26, ge=1, le=260)):
    return APIResponse(data=[SignalHistoryPoint(**vars(h)) for h in store.history(weeks)])


@router.get("/rules", response_model=APIResponse[SignalRules])
def signal_rules():
    loaded = get_rules()
    return APIResponse(data=SignalRules(
        version=loaded.version, scenario=loaded.file.scenario.model_dump(),
        rules=[rule.model_dump() for rule in loaded.file.rules]))


@router.put("/manual/{rule_id}", response_model=APIResponse[ManualInputSaved])
def put_manual_signal(rule_id: str, payload: ManualInputIn = Body(...)):
    rule = next((r for r in get_rules().file.rules if r.id == rule_id), None)
    if rule is None or rule.kind != "manual":
        raise HTTPException(status_code=404, detail=f"no manual signal named {rule_id}")
    week = store.iso_week(engine.kst_today())
    store.put_manual_input(rule_id, week, payload.state, payload.note,
                           engine.utc_now().isoformat(timespec="seconds"))
    snapshot = engine.rescore(week)
    return APIResponse(data=ManualInputSaved(iso_week=week, snapshot=_out(snapshot) if snapshot else None))
```

- [ ] **Step 7: Wire into `main.py`**
  - Add `from apps.api.routes.signals import router as signals_router` next to the other route imports.
  - Add `app.include_router(signals_router, prefix="/api/v1/signals", tags=["Signals"])` after the `sync_router` line.
  - In `lifespan`, directly after `logger.info("Database ready.")`:

```python
    # Fail fast: a typo'd key or unknown series in rules.yaml must stop startup, not
    # silently drop a signal from every weekly probability.
    from apps.api.services.signals.models import reload_rules

    reload_rules()
```

- [ ] **Step 8: Run**

Run: `$PY -m pytest tests/api/signals tests/core_finance -q`. Everything passes, including the Task 5 startup test.
Run: `$PY -m pytest -q`. Expected: 1883 + new, 0 failed.

- [ ] **Step 9: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `_manual`: emit absent manual rules as `not_triggered` | `test_without_manual_input_manual_rules_are_left_out` (8 → 11) |
| `score`: use `store.previous_snapshot(...).probs` as the prior when one exists | `test_last_weeks_result_is_never_multiplied_in` |
| `evaluate_rule`: skip the staleness loop | `test_a_missing_series_stales_only_its_rules` |
| `rescore`: pass `utc_now().isoformat(...)` instead of `snapshot.run_at` | `test_rescore_applies_a_manual_input_without_fetching` |
| remove `reload_rules()` from `lifespan` | `test_app_start_fails_on_an_invalid_rules_file` |
| `run_signals`: `raise HTTPException(500)` when `outcome.failures` | `test_run_without_a_key_is_200_and_all_auto_rules_stale` |

- [ ] **Step 10: Commit**

```bash
git add apps/api/services/signals/engine.py apps/api/models/schema_parts/signals.py apps/api/routes/signals.py apps/api/main.py tests/api/signals
git commit -m "feat(signals): engine run/rescore and /api/v1/signals routes"
```

---

### Task 8: Weekly schedule with catch-up

**Files:**
- Create: `apps/api/services/signals/schedule.py`
- Modify: `apps/api/main.py` (`lifespan` background list)
- Test: `tests/api/signals/test_schedule.py`

**Interfaces:**
- Consumes: `engine.KST`, `engine.utc_now`, `engine.run`, `store.iso_week`, `store.load_snapshot`
- Produces: `weekly_cutoff(now_utc) -> datetime`, `is_due(now_utc, week_run_at: datetime|None) -> bool`, `async signal_cycle(interval_seconds=3600.0)`

- [ ] **Step 1: Write the failing tests**

```python
from datetime import datetime, timedelta, timezone

from apps.api.services.signals.schedule import is_due, weekly_cutoff

KST = timezone(timedelta(hours=9))


def kst(*args):
    return datetime(*args, tzinfo=KST).astimezone(timezone.utc)


def test_cutoff_is_saturday_08_51_kst_of_the_same_iso_week():
    assert weekly_cutoff(kst(2026, 10, 7, 12)) == kst(2026, 10, 10, 8, 51)
    assert weekly_cutoff(kst(2026, 10, 11, 23, 59)) == kst(2026, 10, 10, 8, 51)


def test_monday_just_after_midnight_kst_belongs_to_the_new_week():
    # 00:30 KST Monday is still Sunday in UTC; the week must follow Seoul, not UTC.
    assert weekly_cutoff(kst(2026, 10, 12, 0, 30)) == kst(2026, 10, 17, 8, 51)


def test_no_snapshot_this_week_is_due_at_once():
    assert is_due(kst(2026, 10, 5, 0, 30), None) is True


def test_a_run_before_the_cutoff_is_redone_after_it():
    assert is_due(kst(2026, 10, 10, 9, 0), kst(2026, 10, 9, 20)) is True


def test_not_due_before_the_cutoff_or_after_a_post_cutoff_run():
    assert is_due(kst(2026, 10, 10, 8, 0), kst(2026, 10, 9, 20)) is False
    assert is_due(kst(2026, 10, 11, 12), kst(2026, 10, 10, 9, 0)) is False
```

- [ ] **Step 2: Run and confirm they fail** (`ModuleNotFoundError`)

- [ ] **Step 3: Implement**

```python
"""When to run: once at startup if this ISO week (KST) has no snapshot, and again after
Saturday 08:51 KST, once the US Friday close is in the data.

A desktop app is not always on, so this is a catch-up check run hourly rather than a
wall-clock trigger: a machine woken on Sunday still gets the week's run.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timedelta

from apps.api.services.signals import engine, store

logger = logging.getLogger(__name__)
_SATURDAY = 5
_RUN_TIME = time(8, 51)


def weekly_cutoff(now_utc: datetime) -> datetime:
    local = now_utc.astimezone(engine.KST)
    saturday = local.date() - timedelta(days=local.weekday()) + timedelta(days=_SATURDAY)
    return datetime.combine(saturday, _RUN_TIME, tzinfo=engine.KST)


def is_due(now_utc: datetime, week_run_at: datetime | None) -> bool:
    if week_run_at is None:
        return True
    cutoff = weekly_cutoff(now_utc)
    return now_utc >= cutoff > week_run_at


async def signal_cycle(interval_seconds: float = 3600.0) -> None:
    while True:
        try:
            now = engine.utc_now()
            snapshot = store.load_snapshot(store.iso_week(now.astimezone(engine.KST).date()))
            if is_due(now, datetime.fromisoformat(snapshot.run_at) if snapshot else None):
                await asyncio.to_thread(engine.run)
        except Exception:
            logger.exception("Signal cycle failed; retrying next interval.")
        await asyncio.sleep(interval_seconds)
```

- [ ] **Step 4: Register in `lifespan`**, inside the existing `if not startup_jobs_disabled:` block, so test and e2e processes (which set `MONEYVIEW_DISABLE_STARTUP_JOBS`) never call FRED:

```python
        from apps.api.services.signals.schedule import signal_cycle

        background.append(asyncio.create_task(signal_cycle()))
```

- [ ] **Step 5: Run the file and the full suite.** It passes, and the count is not below the baseline.

- [ ] **Step 6: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `return now_utc >= cutoff > week_run_at` → `return now_utc > week_run_at` | `test_not_due_before_the_cutoff_or_after_a_post_cutoff_run` |
| `_SATURDAY = 5` → `4` | `test_cutoff_is_saturday_08_51_kst_of_the_same_iso_week` |
| `local = now_utc.astimezone(engine.KST)` → `local = now_utc` | `test_monday_just_after_midnight_kst_belongs_to_the_new_week` |

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/signals/schedule.py apps/api/main.py tests/api/signals/test_schedule.py
git commit -m "feat(signals): hourly catch-up check for the Saturday 08:51 KST run"
```

---

### Task 9: `/signals` page

**Files:**
- Create: `packages/shared-types/signals.ts`, plus the export in `packages/shared-types/index.ts`
- Create: `apps/web/lib/signals.ts`, `apps/web/lib/useSignals.ts`
- Create: `apps/web/app/signals/page.tsx`, `apps/web/app/signals/copy.ts`, `apps/web/app/signals/components/{SummaryBar,SignalTable,ProbabilityTrendChart,ManualInputPanel}.tsx`
- Modify: `apps/web/components/ui/Sidebar.tsx`
- Test: `apps/web/tests/e2e/signals-model.spec.ts`, `apps/web/tests/e2e/signals-page.spec.ts`, `apps/web/tests/e2e/helpers/signalsApiMock.ts`

**Interfaces:**
- Consumes: the HTTP contract from Task 7. `fetchApi<T>(endpoint, options)` from `@/lib/api` prefixes `/api/v1` and unwraps the envelope.
- Produces:
  - `useSignals()` → `{latest, history, manualRules, status, runNow, running, lastRunFailures, saveManual}`
  - helpers `deltaPp`, `formatDelta`, `formatProb`, `mostLikely`, `rulesVersionBreaks`
  - `SIGNALS_COPY`

- [ ] **Step 1: Shared types** (`packages/shared-types/signals.ts`); then add `export * from "./signals";` to `packages/shared-types/index.ts`

```ts
/** Mirrors `apps/api/models/schema_parts/signals.py`. */
export type SignalState = "triggered" | "near" | "not_triggered" | "stale";
export type ManualState = Exclude<SignalState, "stale">;
export interface ScenarioProbs { a: number; b: number; c: number }
export interface SignalResult {
  rule_id: string; label_ko: string; label_en: string; direction: "A" | "B" | null; kind: string | null;
  state: SignalState; value: number | null; observed_at: string | null; threshold: number | null;
  note: string; contribution: ScenarioProbs | null;
}
export interface SignalSnapshot {
  iso_week: string; run_at: string; rules_version: string; probs: ScenarioProbs;
  previous_probs: ScenarioProbs | null; results: SignalResult[]; failures: string[];
}
export interface SignalHistoryPoint { iso_week: string; run_at: string; rules_version: string; a: number; b: number; c: number }
export interface SignalRule { id: string; kind: string; direction: "A" | "B"; label: { ko: string; en: string } }
export interface SignalRules { version: string; scenario: Record<string, unknown>; rules: SignalRule[] }
export interface ManualInputSaved { iso_week: string; snapshot: SignalSnapshot | null }
```

- [ ] **Step 2: Write the failing model test** (`tests/e2e/signals-model.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import { deltaPp, formatDelta, formatProb, mostLikely, rulesVersionBreaks } from "../../lib/signals";

test("delta is in percentage points, rounded to 0.1", () => {
  expect(deltaPp(0.4512, 0.4)).toBe(5.1);
  expect(deltaPp(0.4, null)).toBeNull();
  expect(formatDelta(5.1)).toBe("▲ 5.1%p");
  expect(formatDelta(-0.4)).toBe("▼ 0.4%p");
  expect(formatDelta(0)).toBe("0.0%p");
  expect(formatDelta(null)).toBe("—");
});

test("most likely scenario and probability format", () => {
  expect(mostLikely({ a: 0.3, b: 0.5, c: 0.2 })).toBe("b");
  expect(formatProb(0.4512)).toBe("45.1%");
});

test("a rules_version break is marked on the first week of the new version only", () => {
  const point = (iso_week: string, rules_version: string) => ({ iso_week, rules_version, run_at: "", a: 0, b: 0, c: 0 });
  expect(rulesVersionBreaks([point("2026-W39", "v1"), point("2026-W40", "v1"), point("2026-W41", "v2"), point("2026-W42", "v2")]))
    .toEqual(["2026-W41"]);
  expect(rulesVersionBreaks([])).toEqual([]);
});
```

Run: `cd apps/web && npx playwright test tests/e2e/signals-model.spec.ts`. Expected FAIL: cannot resolve `../../lib/signals`.

- [ ] **Step 3: Implement `lib/signals.ts`**

```ts
import type { ScenarioProbs, SignalHistoryPoint } from "../../../packages/shared-types";

export type Scenario = keyof ScenarioProbs;

export function deltaPp(current: number, previous: number | null): number | null {
  return previous === null ? null : Math.round((current - previous) * 1000) / 10;
}

export function formatDelta(pp: number | null): string {
  if (pp === null) return "—";
  if (pp > 0) return `▲ ${pp.toFixed(1)}%p`;
  if (pp < 0) return `▼ ${Math.abs(pp).toFixed(1)}%p`;
  return "0.0%p";
}

export function formatProb(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export function mostLikely(probs: ScenarioProbs): Scenario {
  return (["a", "b", "c"] as const).reduce<Scenario>((best, s) => (probs[s] > probs[best] ? s : best), "a");
}

/** Weeks whose rules_version differs from the week before: probability moves there may come
 * from a rules.yaml edit rather than from the market. */
export function rulesVersionBreaks(history: SignalHistoryPoint[]): string[] {
  return history.filter((p, i) => i > 0 && p.rules_version !== history[i - 1].rules_version).map((p) => p.iso_week);
}
```

Re-run the model spec; it passes.

- [ ] **Step 4: Hooks** (`lib/useSignals.ts`)

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type {
  ManualInputSaved, ManualState, SignalHistoryPoint, SignalRules, SignalSnapshot,
} from "../../../packages/shared-types";

export const SIGNALS_LATEST_KEY = ["signals-latest"] as const;
export const SIGNALS_HISTORY_KEY = ["signals-history"] as const;
export const SIGNALS_RULES_KEY = ["signals-rules"] as const;

export function useSignals() {
  const queryClient = useQueryClient();
  const latest = useQuery({ queryKey: SIGNALS_LATEST_KEY, queryFn: () => fetchApi<SignalSnapshot | null>("/signals/latest"), retry: 1 });
  const history = useQuery({
    queryKey: SIGNALS_HISTORY_KEY,
    queryFn: () => fetchApi<SignalHistoryPoint[]>("/signals/history", { params: { weeks: 26 } }),
    retry: 1,
  });
  const rules = useQuery({ queryKey: SIGNALS_RULES_KEY, queryFn: () => fetchApi<SignalRules>("/signals/rules"), staleTime: Infinity, retry: 1 });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: SIGNALS_LATEST_KEY });
    void queryClient.invalidateQueries({ queryKey: SIGNALS_HISTORY_KEY });
  };
  const run = useMutation({
    mutationFn: () => fetchApi<SignalSnapshot>("/signals/run", { method: "POST" }),
    onSuccess: (snapshot) => { queryClient.setQueryData(SIGNALS_LATEST_KEY, snapshot); refresh(); },
  });
  const manual = useMutation({
    mutationFn: ({ ruleId, state, note }: { ruleId: string; state: ManualState; note: string }) =>
      fetchApi<ManualInputSaved>(`/signals/manual/${ruleId}`, { method: "PUT", body: JSON.stringify({ state, note }) }),
    onSuccess: refresh,
  });
  const queries = [latest, history, rules];
  const status: "loading" | "ready" | "unavailable" = queries.some((q) => q.isError)
    ? "unavailable"
    : queries.some((q) => q.isPending) ? "loading" : "ready";
  return {
    latest: latest.data ?? null,
    history: history.data ?? [],
    manualRules: (rules.data?.rules ?? []).filter((r) => r.kind === "manual"),
    status,
    runNow: () => run.mutate(),
    running: run.isPending,
    lastRunFailures: run.data?.failures ?? [],
    saveManual: manual.mutateAsync,
  };
}
```

- [ ] **Step 5: Copy** (`app/signals/copy.ts`). This is the one place the design-system plan's i18n task migrates.

```ts
export const SIGNALS_COPY = {
  title: "Macro Signals",
  subtitle: "Weekly FRED rule verdicts and heuristic S&P 500 scenario probabilities.",
  runNow: "Run now", running: "Running…", lastRun: "Last run", mostLikely: "Most likely",
  noSnapshot: "No snapshot yet. Run the engine to create this week's.",
  loading: "Loading signals…", unavailable: "Signals could not be loaded.", failures: "Data problems in the last run",
  states: { triggered: "Triggered", near: "Near", not_triggered: "Not triggered", stale: "Data stale" },
  table: { signal: "Signal", direction: "Dir.", state: "State", value: "Value", threshold: "Threshold", observed: "Observed", contribution: "Contribution (pp)" },
  trend: "Scenario probabilities, last 26 weeks", trendRulesChanged: "rules changed",
  manual: "Manual signals (this week)", note: "Note", save: "Save", notSet: "Not set this week",
  disclaimer: "These probabilities are a heuristic built from subjective likelihood ratios, not a statistical model estimate, and are not investment advice.",
} as const;
```

- [ ] **Step 6: Components and page**

`app/signals/components/SummaryBar.tsx`:

```tsx
"use client";

import type { SignalSnapshot } from "../../../../../packages/shared-types";
import { deltaPp, formatDelta, formatProb, mostLikely } from "@/lib/signals";
import { SIGNALS_COPY as T } from "../copy";

export function SummaryBar({ snapshot, onRun, running }: { snapshot: SignalSnapshot | null; onRun: () => void; running: boolean }) {
  return (
    <section aria-label="summary" className="flex flex-wrap items-center gap-6 rounded-[var(--radius)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
      {snapshot ? (
        <>
          <div className="text-sm">{T.mostLikely}: <strong data-testid="most-likely">{mostLikely(snapshot.probs).toUpperCase()}</strong></div>
          {(["a", "b", "c"] as const).map((s) => (
            <div key={s} className="tabular-nums text-sm" data-testid={`prob-${s}`}>
              {s.toUpperCase()} {formatProb(snapshot.probs[s])}{" "}
              <span className="text-[var(--text-secondary)]">
                {formatDelta(deltaPp(snapshot.probs[s], snapshot.previous_probs?.[s] ?? null))}
              </span>
            </div>
          ))}
          <div className="text-xs text-[var(--text-secondary)]">
            {T.lastRun}: <time dateTime={snapshot.run_at}>{new Date(snapshot.run_at).toLocaleString()}</time> · {snapshot.iso_week}
          </div>
        </>
      ) : (
        <p className="text-sm">{T.noSnapshot}</p>
      )}
      <button type="button" onClick={onRun} disabled={running}
        className="ml-auto rounded-[var(--radius-sm)] border border-[var(--border-accent)] px-3 py-1 text-sm font-semibold disabled:opacity-50">
        {running ? T.running : T.runNow}
      </button>
    </section>
  );
}
```

`app/signals/components/SignalTable.tsx`:

```tsx
"use client";

import clsx from "clsx";
import type { SignalResult } from "../../../../../packages/shared-types";
import { SIGNALS_COPY as T } from "../copy";

const fmt = (v: number | null) => (v === null ? "—" : Number(v.toFixed(4)).toString());
const pp = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}`;

export function SignalTable({ results }: { results: SignalResult[] }) {
  return (
    <table className="w-full text-sm" aria-label="signals">
      <thead className="text-left text-xs text-[var(--text-secondary)]">
        <tr>{Object.values(T.table).map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}</tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.rule_id} data-testid={`row-${r.rule_id}`} data-state={r.state}
            className={clsx("border-t border-[var(--border-soft)]", r.state === "stale" && "opacity-50")}>
            <td className="py-2 pr-3" title={r.note}>{r.label_en}</td>
            <td className="pr-3">{r.direction ?? "—"}</td>
            <td className="pr-3 font-semibold">{T.states[r.state]}</td>
            <td className="pr-3 tabular-nums">{fmt(r.value)}</td>
            <td className="pr-3 tabular-nums">{fmt(r.threshold)}</td>
            <td className="pr-3 tabular-nums">{r.observed_at ?? "—"}</td>
            <td className="pr-3 tabular-nums">
              {r.contribution ? `A ${pp(r.contribution.a)} · B ${pp(r.contribution.b)} · C ${pp(r.contribution.c)}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`app/signals/components/ProbabilityTrendChart.tsx`:

```tsx
"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SignalHistoryPoint } from "../../../../../packages/shared-types";
import { DEFAULT_AXIS_PROPS, GRID_STYLE } from "@/lib/chartConfig";
import { rulesVersionBreaks } from "@/lib/signals";
import { SIGNALS_COPY as T } from "../copy";

// Existing tokens. The design-system plan remaps these to chart.series.* with every other chart.
const SERIES = [
  { key: "a", stroke: "var(--chart-secondary)" },
  { key: "b", stroke: "var(--state-warning)" },
  { key: "c", stroke: "var(--state-error)" },
] as const;

export function ProbabilityTrendChart({ history }: { history: SignalHistoryPoint[] }) {
  const breaks = rulesVersionBreaks(history);
  return (
    <section aria-label="trend">
      <h2 className="mb-2 text-sm font-semibold">{T.trend}</h2>
      <div className="h-64" data-testid="trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="iso_week" {...DEFAULT_AXIS_PROPS} />
            <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} {...DEFAULT_AXIS_PROPS} />
            <Tooltip formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
            <Legend />
            {SERIES.map((s) => <Line key={s.key} dataKey={s.key} name={s.key.toUpperCase()} stroke={s.stroke} dot={false} isAnimationActive={false} />)}
            {breaks.map((w) => <ReferenceLine key={w} x={w} strokeDasharray="4 4" stroke="var(--border-strong)" label={T.trendRulesChanged} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
```

`app/signals/components/ManualInputPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ManualState, SignalResult, SignalRule } from "../../../../../packages/shared-types";
import { SIGNALS_COPY as T } from "../copy";

type Save = (input: { ruleId: string; state: ManualState; note: string }) => Promise<unknown>;

function ManualRow({ rule, current, onSave }: { rule: SignalRule; current?: SignalResult; onSave: Save }) {
  const [state, setState] = useState<ManualState | "">(current && current.state !== "stale" ? current.state : "");
  const [note, setNote] = useState(current?.note ?? "");
  const label = rule.label.en;
  return (
    <form data-testid={`manual-${rule.id}`} className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); if (state) void onSave({ ruleId: rule.id, state, note }); }}>
      <span className="w-56 text-sm">{label}</span>
      <select aria-label={`${label} state`} value={state} onChange={(e) => setState(e.target.value as ManualState)}
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1 text-sm">
        <option value="" disabled>{T.notSet}</option>
        {(["triggered", "near", "not_triggered"] as const).map((s) => <option key={s} value={s}>{T.states[s]}</option>)}
      </select>
      <input aria-label={`${label} ${T.note}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
        placeholder={T.note} className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1 text-sm" />
      <button type="submit" disabled={!state}
        className="rounded-[var(--radius-sm)] border border-[var(--border-accent)] px-3 py-1 text-sm disabled:opacity-50">{T.save}</button>
    </form>
  );
}

export function ManualInputPanel({ rules, results, onSave }: { rules: SignalRule[]; results: SignalResult[]; onSave: Save }) {
  return (
    <section aria-label="manual" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{T.manual}</h2>
      {rules.map((rule) => (
        <ManualRow key={rule.id} rule={rule} current={results.find((r) => r.rule_id === rule.id)} onSave={onSave} />
      ))}
    </section>
  );
}
```

`app/signals/page.tsx`:

```tsx
"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { useSignals } from "@/lib/useSignals";
import { ManualInputPanel } from "./components/ManualInputPanel";
import { ProbabilityTrendChart } from "./components/ProbabilityTrendChart";
import { SignalTable } from "./components/SignalTable";
import { SummaryBar } from "./components/SummaryBar";
import { SIGNALS_COPY as T } from "./copy";

export default function SignalsPage() {
  const { latest, history, manualRules, status, runNow, running, lastRunFailures, saveManual } = useSignals();
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title={T.title} subtitle={T.subtitle} />
      {status === "loading" ? <p className="text-sm text-[var(--text-muted)]">{T.loading}</p> : null}
      {status === "unavailable" ? <p role="alert" className="text-sm">{T.unavailable}</p> : null}
      {status === "ready" ? (
        <>
          <SummaryBar snapshot={latest} onRun={runNow} running={running} />
          {lastRunFailures.length ? (
            <div role="status" className="text-xs text-[var(--text-secondary)]">
              {T.failures}:
              <ul>{lastRunFailures.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          ) : null}
          {latest ? <SignalTable results={latest.results} /> : null}
          <ProbabilityTrendChart history={history} />
          <ManualInputPanel rules={manualRules} results={latest?.results ?? []} onSave={saveManual} />
        </>
      ) : null}
      <footer className="border-t border-[var(--border-soft)] pt-3 text-xs text-[var(--text-secondary)]" data-testid="disclaimer">
        {T.disclaimer}
      </footer>
    </div>
  );
}
```

In `components/ui/Sidebar.tsx`, add `Radar` to the lucide import and append `{ href: "/signals", label: "Macro Signals", icon: Radar },` after the Events item.

- [ ] **Step 7: Write the page test**

`tests/e2e/helpers/signalsApiMock.ts`:

```ts
import type { Page } from "@playwright/test";

const result = (rule_id: string, state: string, extra: Record<string, unknown> = {}) => ({
  rule_id, label_ko: rule_id, label_en: rule_id, direction: "B", kind: "level_streak", state,
  value: 5.55, observed_at: "2026-10-09", threshold: 5.5, note: "", contribution: null, ...extra,
});

export const SNAPSHOT = {
  iso_week: "2026-W41", run_at: "2026-10-10T00:00:00+00:00", rules_version: "v2",
  probs: { a: 0.25, b: 0.5, c: 0.25 }, previous_probs: { a: 0.3, b: 0.45, c: 0.25 }, failures: [],
  results: [
    result("b_tnx_sticky", "triggered", { contribution: { a: -0.05, b: 0.02, c: 0.03 } }),
    result("b_brent_spike", "stale", { value: null }),
  ],
};
export const HISTORY = [
  { iso_week: "2026-W39", run_at: "", rules_version: "v1", a: 0.35, b: 0.45, c: 0.2 },
  { iso_week: "2026-W40", run_at: "", rules_version: "v1", a: 0.3, b: 0.45, c: 0.25 },
  { iso_week: "2026-W41", run_at: "", rules_version: "v2", a: 0.25, b: 0.5, c: 0.25 },
];
const manualRule = (id: string, en: string) => ({ id, kind: "manual", direction: "B", label: { ko: id, en } });
const RULES = { version: "v2", scenario: {}, rules: [
  manualRule("m_capex_reaction", "Capex raised, stock fell"),
  manualRule("m_iran_strike", "Iran strikes resume"),
  manualRule("m_breadth", "Market breadth improving"),
] };

export async function mockSignalsApi(page: Page) {
  const calls = { run: 0, manual: [] as { url: string; body: unknown }[] };
  let latest: unknown = SNAPSHOT;
  const ok = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data, meta: {} }) });
  await page.route("**/api/v1/signals/latest", (r) => r.fulfill(ok(latest)));
  await page.route("**/api/v1/signals/history**", (r) => r.fulfill(ok(HISTORY)));
  await page.route("**/api/v1/signals/rules", (r) => r.fulfill(ok(RULES)));
  await page.route("**/api/v1/signals/run", (r) => { calls.run += 1; return r.fulfill(ok(SNAPSHOT)); });
  await page.route("**/api/v1/signals/manual/*", (r) => {
    calls.manual.push({ url: r.request().url(), body: r.request().postDataJSON() });
    latest = { ...SNAPSHOT, probs: { a: 0.2, b: 0.55, c: 0.25 } };
    return r.fulfill(ok({ iso_week: "2026-W41", snapshot: latest }));
  });
  return calls;
}
```

`tests/e2e/signals-page.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { mockSignalsApi } from "./helpers/signalsApiMock";

test("summary, table, trend break, manual save and disclaimer", async ({ page }) => {
  const calls = await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("most-likely")).toHaveText("B");
  await expect(page.getByTestId("prob-b")).toContainText("50.0%");
  await expect(page.getByTestId("prob-b")).toContainText("▲ 5.0%p");

  const sticky = page.getByTestId("row-b_tnx_sticky");
  await expect(sticky).toContainText("Triggered");
  await expect(sticky).toContainText("2026-10-09");
  await expect(sticky).toContainText("B +2.0");
  await expect(page.getByTestId("row-b_brent_spike")).toContainText("Data stale");
  await expect(page.getByTestId("row-b_brent_spike")).toHaveClass(/opacity-50/);

  // One dashed reference line, at the W41 rules_version change. DOM count, not pixels:
  // recharts pixel sampling reads stale coordinates during its animation.
  await expect(page.getByTestId("trend-chart").locator(".recharts-reference-line")).toHaveCount(1);

  await page.getByRole("button", { name: "Run now" }).click();
  await expect.poll(() => calls.run).toBe(1);

  const iran = page.getByTestId("manual-m_iran_strike");
  await iran.getByRole("combobox").selectOption("triggered");
  await iran.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => calls.manual.length).toBe(1);
  expect(calls.manual[0].body).toEqual({ state: "triggered", note: "" });
  await expect(page.getByTestId("prob-b")).toContainText("55.0%");

  await expect(page.getByTestId("disclaimer")).toContainText("not investment advice");
});
```

If other shell requests make the page fail under test, call `await mockMarketPageApi(page)` (from `./helpers/marketPageMock`) first, as `events-page.spec.ts` does.

- [ ] **Step 8: Run**

```bash
cd apps/web && npm run typecheck && npm run lint && npx playwright test tests/e2e/signals-model.spec.ts tests/e2e/signals-page.spec.ts
```

Expected: PASS. Afterwards, kill any leftover `:8110`/`:3101` servers; a stopped Playwright run keeps them alive.

- [ ] **Step 9: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `SignalTable`: drop `r.state === "stale" && "opacity-50"` | `toHaveClass(/opacity-50/)` |
| `useSignals`: drop `onSuccess: refresh` on `manual` | `prob-b` "55.0%" after save |
| `ProbabilityTrendChart`: render no `ReferenceLine` | `.recharts-reference-line` count 1 |
| `formatDelta`: swap ▲ and ▼ | model spec `"▲ 5.1%p"` |
| `rulesVersionBreaks`: `i > 0 &&` → `i >= 0 &&` | model spec (throws on `history[-1]`) |

- [ ] **Step 10: Live check with the real key** (owner action, needed for spec step 6)

The FRED key currently sits only in `apikey.json`, which no code reads. Create `config/.env` from `config/.env.example` and set `FRED_API_KEY`. Start the app, open `/signals` and press **Run now**. Confirm that 8 auto rows show real observation dates and that no data-problem list appears. Record the result in Track S.

- [ ] **Step 11: Commit**

```bash
git add packages/shared-types apps/web/lib/signals.ts apps/web/lib/useSignals.ts apps/web/app/signals apps/web/components/ui/Sidebar.tsx apps/web/tests/e2e/signals-model.spec.ts apps/web/tests/e2e/signals-page.spec.ts apps/web/tests/e2e/helpers/signalsApiMock.ts
git commit -m "feat(signals): /signals page with summary, verdicts, trend and manual inputs"
```

---

### Task 10: Docs and the final gate

**Files:**
- Create: `docs/tabs/signals-tab.txt` (identity, route, purpose, layout, behaviour, data sources; same format as `docs/tabs/cases-tab.txt`)
- Modify: `docs/tabs/index.txt`, `docs/architecture/moneyview-api-reference.md` (a `/api/v1/signals` section: the 5 endpoints and the 200-on-FRED-failure rule), `docs/architecture/storage-model.md` (4 tables), `docs/INDEX.md` (plan row + spec row), `guideline/sop/todo.md`

- [ ] **Step 1:** Write the docs. In the tab doc, quote the disclaimer verbatim and give one line per correction C1–C11, pointing to the spec appendix.
- [ ] **Step 2:** Run `$PY -m pytest -q`, then `cd apps/web && npm run typecheck && npm run lint && npx playwright test`. Record both counts in Track S. pytest must be ≥ 1883 + the new tests, with 0 failed.
- [ ] **Step 3:** Run the `guideline/sop/code-reviewer.md` checklist over `git diff renewal...HEAD`.
- [ ] **Step 4:** Commit with `git commit -m "docs(signals): tab reference, API, storage and tracking"`.

## Follow-ups (not in this plan)

- `m_breadth` from a quote API; news collection and LLM classification (spec: out of scope).
- `compound` OR mode, once a rule needs it (C10).
- Korean labels on the page arrive with the design-system plan's i18n task. `label_ko` is already in the API.
- Scenario names: the spec defines A (upside) and B (correction) but never names C. The page shows "A/B/C" until the owner names them.
- Sync `signal_manual_inputs` as an optional sync child, so the manual inputs follow the user across PCs (today they are local, like the snapshots).
