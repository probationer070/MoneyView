# DCF FCFF Floor Removal (metric v4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `max(fcff, 1.0)` floor from both DCF valuation paths. A DCF value
exists only when every forecast FCFF is positive. Otherwise the DCF refuses with
`non_positive_fcff`, end to end: comparison row, snapshot, history, stock history,
decision log, single-ticker routes and UI.

**Architecture:**
- **Admissibility.** One predicate, `fcff_path_is_admissible`, lives in
  `packages/core_finance/dcf.py`. Three consumers use it: the comparison DCF, the
  single-ticker DCF (through a raising twin, `require_admissible_fcff_path`) and the
  implied-return solver.
- **Comparison path.** It returns `None` values plus a `dcf_refusal` code.
- **Snapshots.** They keep their `NOT NULL` columns. A refused row writes the `0.0`
  default, and the reader maps it back to `None` via `dcf_refusal`.
- **Single-ticker routes.** They map the typed `EngineRefusal` to 422
  `{code, message}`, and the frontend renders it as content.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic / SQLite, pytest. Next.js 16 / React 19 /
TypeScript, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-dcf-fcff-floor-removal-design.md`. Read it
first.

## Global Constraints

- **Admissible path:** `FCFF_t = fcff * (1 + growth)^t, t = 1..5`. It is admissible iff
  every `FCFF_t` is finite and `> 0`. The refusal code is exactly `non_positive_fcff`.
- **No FCFF floor or clamp in any valuation path.** In particular, no `max(... fcff ...,
  1.0)` and no `max(... fcff ..., 0.0)`. Task 6's grep enforces this.
- **Separate fields.** `dcf_refusal` and `implied_return_refusal` are separate fields,
  even when both carry the same code.
- **`METRIC_SCHEMA_VERSION = 4`.**
- **Refused-row persistence.**
  - A refused row writes `0.0` to `dcf_value`, `dcf_implied_return` and
    `stock_expected_return`, which are `NOT NULL DEFAULT 0.0`, plus `dcf_refusal` = the
    code.
  - The reader maps `dcf_refusal IS NOT NULL` → those three fields `None`.
  - `average_dcf_value` adds `AND s.dcf_refusal IS NULL`.
- **Single-ticker refusal.** It is HTTP 422 with body
  `{"detail": {"code": "non_positive_fcff", "message": "..."}}`.
- **Wording, shared through the frontend map in `apps/web/lib/impliedReturn.ts`
  (`non_positive_fcff`):**
  - `non_positive_fcff`: "Free cash flow is zero or negative over the forecast, so no
    discount rate prices it."
  - The v4 history notice: "DCF values before this point used a $1B minimum FCFF, which
    overstated companies with FCFF under $1B and valued cash-burning companies at +$1B.
    Values across this point are not comparable for those companies."
  - The v3 history notice: "Implied return vs WACC starts here; earlier snapshots did not
    record it."
- **Python gate (allowlist).** A full `pytest tests` run passes when every failing ID
  matches one of:
  - `events/test_rules.py::test_the_real_nyse_calendar`;
  - `records_sync/test_routes.py::test_a_records_failure_does_not_break_a_page`;
  - `records_sync/test_routes.py::test_get_market_events_merges_a_peer_file`;
  - `test_market_event_routes.py::`;
  - `test_market_events.py::`.

  Check it with:
  `python -m pytest -q -p no:cacheprovider tests 2>&1 | grep "^FAILED" | sed 's/ - .*//' | grep -v -e "events/test_rules.py::test_the_real_nyse_calendar" -e "records_sync/test_routes.py::test_a_records_failure_does_not_break_a_page" -e "records_sync/test_routes.py::test_get_market_events_merges_a_peer_file" -e "test_market_event_routes.py::" -e "test_market_events.py::"`.
  The output must be empty.
- **Test verification (CLAUDE.md §8).**
  - Every task ends with its mutation matrix: apply each mutation from a saved copy, run
    the named test, confirm it FAILS, restore.
  - A mutation harness must require a passing baseline, and must treat pytest exit code
    5 (no tests collected) as an error, never as "caught".
- **Git.** Never use `git stash`. Commit only the files a task names.

## Review Focus

1. **A cached single-ticker DCF result from before this change.** The `/corporate` DCF
   panel reads `sessionStorage` (`DCF_CACHE_KEY`). A stale cached floored value for a
   now-refused ticker is still shown as cached, labelled "Cached". Expected: refreshing
   replaces it with the refusal. Pinned in Task 5 (e2e: refresh shows the refusal, not the
   cached value).
2. **A snapshot history mixing v2, v3 and v4 points.** Each boundary shows the notices
   for every version it crosses, not one generic line. Pinned in Task 5.
3. **Negative FCFF from the metrics default-params builder.** `ValuationAssumptions.fcff` is
   `ge=0`, so a negative metrics FCFF must reach the engine as a refusal, not as a
   pydantic `ValidationError`. Pinned in Task 4 (the bulk skip reason starts with
   `non_positive_fcff`).
4. **A refused row under the `dcf_value` sort and in the price-vs-value scatter.** It sorts
   last and is not plotted. Pinned in Task 5.
5. **Recording a decision on a refused ticker.** It stores `figures_unavailable_reason`,
   never `0.0`. Pinned in Task 2.

---

### Task 1: One admissibility definition in the engine

**Files:**
- Modify: `packages/core_finance/dcf.py`, `packages/core_finance/refusals.py`,
  `packages/core_finance/expected_return.py`, `packages/core_finance/__init__.py`
- Test: `tests/core_finance/test_dcf_admissibility.py` (new), plus the existing
  `tests/api/test_engine_refusals.py` and `tests/core_finance/test_expected_return.py`

**Interfaces:**
- Produces:
  - `fcff_path_is_admissible(fcff_path: Sequence[float]) -> bool`
  - `require_admissible_fcff_path(fcff_path: Sequence[float]) -> None`, which raises
    `EngineRefusal("non_positive_fcff", ...)`
  - `"non_positive_fcff" in ENGINE_REFUSAL_CODES`

- [ ] **Step 1: Write the failing tests** in `tests/core_finance/test_dcf_admissibility.py`:

```python
import math

import pytest

from packages.core_finance.dcf import fcff_path_is_admissible, require_admissible_fcff_path
from packages.core_finance.refusals import EngineRefusal


def test_every_positive_finite_path_is_admissible():
    assert fcff_path_is_admissible([0.5 * 1.06 ** t for t in range(1, 6)])


@pytest.mark.parametrize("path", [
    [],
    [1.0, 1.0, 0.0, 1.0, 1.0],
    [1.0, -0.1, 1.0, 1.0, 1.0],
    [0.5 * (1 - 1.5) ** t for t in range(1, 6)],   # positive base, growth -150%
    [1.0, math.nan, 1.0, 1.0, 1.0],
    [1.0, math.inf, 1.0, 1.0, 1.0],
])
def test_an_empty_non_positive_or_non_finite_path_is_not(path):
    assert not fcff_path_is_admissible(path)


def test_the_raising_twin_refuses_with_the_code():
    with pytest.raises(EngineRefusal) as excinfo:
        require_admissible_fcff_path([-0.5] * 5)
    assert excinfo.value.code == "non_positive_fcff"


def test_the_raising_twin_passes_an_admissible_path():
    require_admissible_fcff_path([1.0] * 5)
```

Run: `python -m pytest -q -p no:cacheprovider tests/core_finance/test_dcf_admissibility.py`
Expected: FAIL (ImportError).

- [ ] **Step 2: Implement**

`packages/core_finance/refusals.py`: add `"non_positive_fcff",` to `ENGINE_REFUSAL_CODES`.

`packages/core_finance/dcf.py`: add at module level. Import `isfinite` from `math`,
`Sequence` from `typing`, and `EngineRefusal` from `.refusals` if not already imported.

```python
def fcff_path_is_admissible(fcff_path: Sequence[float]) -> bool:
    """Whether a DCF may value this forecast: every year finite and strictly positive.

    The single definition shared by the comparison DCF, the single-ticker DCF and the
    implied-return solver (spec 2026-09-26-dcf-fcff-floor-removal §2). Base FCFF alone is
    not enough: a positive base with growth <= -100% turns later years non-positive.
    `isfinite` first, because `nan <= 0` is False.
    """
    return bool(fcff_path) and all(isfinite(cash_flow) and cash_flow > 0 for cash_flow in fcff_path)


def require_admissible_fcff_path(fcff_path: Sequence[float]) -> None:
    """Raise the typed refusal when `fcff_path_is_admissible` is False."""
    if not fcff_path_is_admissible(fcff_path):
        raise EngineRefusal(
            "non_positive_fcff",
            "Free cash flow is zero or negative over the forecast, so the model cannot value it.",
        )
```

`packages/core_finance/expected_return.py`, in `calculate_market_implied_return`: replace
`if not fcff_path or any(not isfinite(cash_flow) or cash_flow <= 0 for cash_flow in fcff_path):`
with `if not fcff_path_is_admissible(fcff_path):`. Import it with
`from packages.core_finance.dcf import fcff_path_is_admissible`, or the package-relative
form the module already uses. Keep the comment above it, reworded to point at the shared
predicate.

`packages/core_finance/__init__.py`: export `fcff_path_is_admissible` and
`require_admissible_fcff_path` (import list and `__all__`).

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `python -m pytest -q -p no:cacheprovider tests/core_finance tests/api/test_engine_refusals.py`
Expected: PASS. `test_every_known_code_is_raised_somewhere` passes because `dcf.py` (in
`_ENGINE_SOURCES`) now raises `non_positive_fcff` with a literal.

- [ ] **Step 4: Mutation matrix**

| Mutation | Test that must fail |
|---|---|
| `cash_flow > 0` → `cash_flow >= 0` | `test_an_empty_non_positive_or_non_finite_path_is_not[path1]` |
| `isfinite(cash_flow) and` removed | `test_an_empty_non_positive_or_non_finite_path_is_not[path4]` |
| `bool(fcff_path) and` removed | `test_an_empty_non_positive_or_non_finite_path_is_not[path0]` |
| the solver's predicate call replaced by `if False:` | `tests/core_finance/test_expected_return.py::test_a_non_positive_cash_flow_is_refused_before_solving` |

- [ ] **Step 5: Commit**

```bash
git add packages/core_finance tests/core_finance/test_dcf_admissibility.py
git commit -m "feat(engine): one FCFF-path admissibility predicate shared by both DCFs and the implied return"
```

---

### Task 2: Comparison DCF refuses; decision log honours it

**Files:**
- Modify: `apps/api/services/corporate_comparison.py` (`_dcf_snapshot`, the live row
  builder, `METRIC_SCHEMA_VERSION`)
- Modify: `apps/api/models/schema_parts/corporate.py` (`CorporateComparisonRow`)
- Modify: `apps/api/services/investment_decision.py` (`_default_figures_loader`,
  `record_decision`)
- Test: `tests/api/test_corporate_comparison.py`,
  `tests/api/test_investment_decision_record.py`

**Interfaces:**
- Consumes: Task 1's `fcff_path_is_admissible`.
- Produces:
  - `_dcf_snapshot` returns `estimated_value: float | None`,
    `dcf_implied_return: float | None`, `stock_expected_return: float | None` and a new
    `dcf_refusal: str | None`.
  - `CorporateComparisonRow`: `dcf_value: float | None`, `dcf_implied_return: float | None`,
    `stock_expected_return: float | None`, all required, and `dcf_refusal: str | None`,
    required.
  - `_default_figures_loader` returns a `dcf_refusal` key.

- [ ] **Step 1: Write the failing tests**

In `tests/api/test_corporate_comparison.py`, **delete**
`test_a_sub_unit_fcff_is_solved_on_the_real_cash_flow_not_the_display_floor`. Its premise
(the two paths deliberately differ) is gone. Append:

```python
def _metrics_with(**update):
    return _stub_metrics_loader("AAPL").model_copy(update=update)


def test_a_small_positive_fcff_is_valued_on_its_real_cash_flow():
    # fcff 0.5 (billions): the enterprise value is the 0.5 path's, not the 1.0 path's.
    dcf = _snapshot(_starved_bridge(), metrics=_metrics_with(fcff=0.5))  # starved: estimated_value = EV
    real = enterprise_present_value([0.5 * 1.06 ** t for t in range(1, 6)], 0.03, 0.10)
    floored = enterprise_present_value([1.0 * 1.06 ** t for t in range(1, 6)], 0.03, 0.10)
    assert dcf["dcf_refusal"] is None
    assert dcf["estimated_value"] == pytest.approx(real, abs=0.01)
    assert abs(dcf["estimated_value"] - floored) > 1.0


@pytest.mark.parametrize("fcff", [0.0, -0.5])
def test_a_non_positive_fcff_refuses_both_calculations(fcff):
    dcf = _snapshot(_resolved_bridge(), metrics=_metrics_with(fcff=fcff))
    assert dcf["estimated_value"] is None and dcf["dcf_implied_return"] is None
    assert dcf["stock_expected_return"] is None
    assert dcf["dcf_refusal"] == "non_positive_fcff"
    assert dcf["implied_return_spread"] is None
    assert dcf["implied_return_refusal"] == "non_positive_fcff"


def test_a_forecast_path_turning_negative_refuses_both_calculations():
    dcf = _snapshot(_resolved_bridge(), metrics=_metrics_with(fcff=5.0, growth=-150.0))
    assert dcf["dcf_refusal"] == "non_positive_fcff"
    assert dcf["implied_return_refusal"] == "non_positive_fcff"


@pytest.mark.parametrize("fcff", [0.2, 0.5, 1.0, 5.0, 50.0])
@pytest.mark.parametrize("price_multiple", [0.5, 0.9, 1.1, 2.0])
def test_the_dcf_gap_and_the_implied_return_agree_in_sign(fcff, price_multiple):
    # Only where BOTH produce a value: the implied return can refuse for range reasons
    # while the DCF is valid, and that is not a disagreement.
    fair = _snapshot(_resolved_bridge(net_debt=0.0, non_op=0.0, shares=1.0), metrics=_metrics_with(fcff=fcff))
    assert fair["estimated_value"] is not None
    price = fair["estimated_value"] * price_multiple
    dcf = _snapshot(_resolved_bridge(net_debt=0.0, non_op=0.0, shares=1.0), price=price, metrics=_metrics_with(fcff=fcff))
    if dcf["estimated_value"] is None or dcf["implied_return_spread"] is None:
        return
    assert (dcf["estimated_value"] > price) == (dcf["implied_return_spread"] > 0)
```

In `tests/api/test_investment_decision_record.py`, append:

```python
def test_a_refused_dcf_is_recorded_as_unavailable_never_as_a_value():
    row = _row(
        record_decision(
            ticker="BURNCO", action="watch", memo="burning cash",
            figures_loader=_figures_with(dcf_value=None, dcf_implied_return=None, dcf_refusal="non_positive_fcff"),
        )
    )
    assert row["figures_unavailable_reason"] is not None
    assert "zero or negative" in row["figures_unavailable_reason"]
    assert row["dcf_value"] is None and row["price_at_decision"] is None
```

Run: `python -m pytest -q -p no:cacheprovider tests/api/test_corporate_comparison.py tests/api/test_investment_decision_record.py -k "small_positive or non_positive_fcff or forecast_path or agree_in_sign or refused_dcf"`
Expected: FAIL (`KeyError: 'dcf_refusal'`, or the value equals the floored one).

- [ ] **Step 2: Implement**

`apps/api/services/corporate_comparison.py`:
- `METRIC_SCHEMA_VERSION = 4`. Extend the comment with:
  `# 4: the DCF no longer floors FCFF at 1.0 ($1B); a non-positive forecast refuses (dcf_refusal).`
- Import `fcff_path_is_admissible` from `packages.core_finance.dcf`.
- In `_dcf_snapshot`, replace `base_fcff = max(float(metrics.fcff), 1.0)` with nothing.
  Replace:

```python
        projected_fcff = [base_fcff * ((1 + growth_rate) ** year) for year in range(1, 6)]
        enterprise_value = enterprise_present_value(projected_fcff, terminal_growth, wacc)
```

with:

```python
        # The real FCFF, no floor: max(fcff, 1.0) valued every company under $1B as if it
        # earned $1B and every cash-burning one at +$1B (ERROR-LOG 2026-09-26). A path that
        # is not admissible is refused, not valued.
        projected_fcff = [float(metrics.fcff) * ((1 + growth_rate) ** year) for year in range(1, 6)]
        dcf_refusal = None if fcff_path_is_admissible(projected_fcff) else "non_positive_fcff"
        enterprise_value = (
            enterprise_present_value(projected_fcff, terminal_growth, wacc) if dcf_refusal is None else None
        )
```

- Guard every consumer of `enterprise_value`:
  - `equity_value = (... ) if net_debt is not None and enterprise_value is not None else None`;
  - `estimated_value = intrinsic_value_per_share if intrinsic_value_per_share is not None else enterprise_value`
    (already `None`-safe once `enterprise_value` is `None`).
- In the returned dict:

```python
        "estimated_value": None if estimated_value is None else round(float(estimated_value), 2),
        "dcf_implied_return": None if dcf_refusal else round(float(expected_returns.dcf_implied_return * 100), 2),
        "stock_expected_return": None if dcf_refusal else round(float(expected_returns.stock_expected_return * 100), 2),
        "dcf_refusal": dcf_refusal,
```

  In `status`, add a first branch: `"Refused" if dcf_refusal else ...`.
- Live row builder: `dcf_value=dcf["estimated_value"]`,
  `dcf_implied_return=dcf["dcf_implied_return"]`,
  `stock_expected_return=dcf["stock_expected_return"]`, `dcf_refusal=dcf["dcf_refusal"]`
  (no `float(...)` wrapping). Also change `has_price_data=float(dcf["current_price"]) > 0`
  as is.

`apps/api/models/schema_parts/corporate.py`, `CorporateComparisonRow`:
- `dcf_value: float | None`, `dcf_implied_return: float | None` and
  `stock_expected_return: float | None`, all required with no default.
- Add after `implied_return_refusal`:

```python
    # Why dcf_value / dcf_implied_return / stock_expected_return are None: the DCF itself
    # refused (spec 2026-09-26-dcf-fcff-floor-removal). Separate from implied_return_refusal
    # even when both carry the same code -- two calculations, each declining.
    dcf_refusal: str | None
```

`apps/api/services/investment_decision.py`:
- `_default_figures_loader`: `"dcf_value": dcf["estimated_value"]`,
  `"dcf_implied_return": dcf["dcf_implied_return"]`, and add
  `"dcf_refusal": dcf["dcf_refusal"]`.
- `record_decision`: add a branch **before** the `bridge_quality` one:

```python
        elif figures.get("dcf_refusal"):
            unavailable = (
                f"free cash flow for {ticker} is zero or negative over the forecast "
                f"({figures['dcf_refusal']}): the model cannot value it"
            )
            figures = None
```

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `python -m pytest -q -p no:cacheprovider tests/api/test_corporate_comparison.py tests/api/test_investment_decision_record.py tests/core_finance`
Expected: every new test passes. Snapshot-persistence tests may fail until Task 3. Note
which ones in the ledger.

- [ ] **Step 4: Mutation matrix**

| Mutation | Test that must fail |
|---|---|
| `float(metrics.fcff)` → `max(float(metrics.fcff), 1.0)` in the path | `test_a_small_positive_fcff_is_valued_on_its_real_cash_flow` |
| admissibility on base only: `fcff_path_is_admissible([float(metrics.fcff)])` | `test_a_forecast_path_turning_negative_refuses_both_calculations` |
| `"dcf_implied_return": None if dcf_refusal` → always the number | `test_a_non_positive_fcff_refuses_both_calculations` |
| the decision-log `dcf_refusal` branch removed | `test_a_refused_dcf_is_recorded_as_unavailable_never_as_a_value` |

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/corporate_comparison.py apps/api/models/schema_parts/corporate.py apps/api/services/investment_decision.py tests/api/test_corporate_comparison.py tests/api/test_investment_decision_record.py
git commit -m "fix(corporate): the comparison DCF values real FCFF and refuses a non-positive forecast; decisions record the refusal"
```

---

### Task 3: Snapshot persistence, history and stock history (v4)

**Files:**
- Modify: `apps/api/services/db.py` (the v3 `CREATE TABLE` and the column-migration loop
  added in #59)
- Modify: `apps/api/services/corporate_comparison.py` (the snapshot `INSERT`; the two row
  `SELECT`s; `_rows_to_response`; the history aggregate; the stock-history `SELECT` and
  builder)
- Modify: `apps/api/models/schema_parts/corporate.py`
  (`CorporateComparisonStockHistoryPoint`)
- Test: `tests/api/test_corporate_comparison.py`

**Interfaces:**
- Consumes: Task 2's row fields.
- Produces:
  - v3 table column `dcf_refusal TEXT`;
  - `CorporateComparisonStockHistoryPoint.dcf_implied_return: float | None` and
    `dcf_refusal: str | None`, both required.

- [ ] **Step 1: Write the failing tests** (append):

```python
def _save_refused_snapshot(tmp_path, monkeypatch):
    """AAPL seeded with a resolved bridge but zero FCFF, so its DCF refuses."""
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _seed_watchlist()
    save_statements("AAPL", [
        StatementRow("AAPL", "balance", "annual", "2025-12-31", "Total Debt", 5_000_000_000.0),
        StatementRow("AAPL", "balance", "annual", "2025-12-31", "Cash And Cash Equivalents", 1_000_000_000.0),
        StatementRow("AAPL", "income", "annual", "2025-12-31", "Diluted Average Shares", 2_000_000_000.0),
    ])
    return save_corporate_comparison_snapshot(
        snapshot_source="manual", comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC", custom_tickers=[],
        metrics_loader=lambda t: _stub_metrics_loader(t).model_copy(update={"fcff": 0.0}) if t == "AAPL" else _stub_metrics_loader(t),
        price_loader=lambda _t: 100.0, default_companies={},
        risk_free_rate=0.042, equity_risk_premium=0.055,
    )


def test_a_refused_row_persists_its_code_and_reloads_as_none_not_zero(tmp_path, monkeypatch):
    saved = _save_refused_snapshot(tmp_path, monkeypatch)
    reloaded = load_corporate_comparison_snapshot_version(snapshot_version=saved.snapshot.snapshot_version)
    aapl = next(r for r in reloaded.rows if r.ticker == "AAPL")
    assert aapl.dcf_refusal == "non_positive_fcff"
    assert aapl.dcf_value is None and aapl.dcf_implied_return is None and aapl.stock_expected_return is None
    with db_service.get_db() as conn:
        stored = conn.execute("SELECT dcf_value, metric_schema_version FROM corporate_comparison_snapshots_v3 WHERE ticker = 'AAPL'").fetchone()
    assert stored["dcf_value"] == 0.0            # the NOT NULL default, never served
    assert stored["metric_schema_version"] == 4


def test_the_dcf_average_excludes_refused_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([("AAA", "ok", 100.0, None), ("BBB", "ok", 200.0, None)], metric_schema_version=4)
    with db_service.get_db() as conn:
        conn.execute("UPDATE corporate_comparison_snapshots_v3 SET dcf_value = 0.0, dcf_refusal = 'non_positive_fcff' WHERE ticker = 'BBB'")
    assert _history_point().average_dcf_value == pytest.approx(100.0)


def test_an_all_refused_snapshot_averages_to_none(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([("AAA", "ok", 0.0, None)], metric_schema_version=4)
    with db_service.get_db() as conn:
        conn.execute("UPDATE corporate_comparison_snapshots_v3 SET dcf_refusal = 'non_positive_fcff'")
    assert _history_point().average_dcf_value is None


def test_the_stock_history_carries_the_dcf_refusal(tmp_path, monkeypatch):
    _save_refused_snapshot(tmp_path, monkeypatch)
    history = load_corporate_comparison_stock_history(
        ticker="AAPL", comparison_universe="portfolio_plus_benchmark", benchmark_ticker="^GSPC", custom_tickers=[])
    assert history.points[0].dcf_refusal == "non_positive_fcff"
    assert history.points[0].dcf_implied_return is None


def test_init_db_adds_the_dcf_refusal_column_to_an_existing_table(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    with db_service.get_db() as conn:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 DROP COLUMN dcf_refusal")
    db_service.init_db()
    with db_service.get_db() as conn:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots_v3)")}
    assert "dcf_refusal" in columns
```

Also update `test_the_metric_schema_version_is_bumped` to expect `4`.

Run: `python -m pytest -q -p no:cacheprovider tests/api/test_corporate_comparison.py`
Expected: FAIL (`no such column: dcf_refusal`).

- [ ] **Step 2: Implement**

`db.py`:
- Add `    dcf_refusal                  TEXT,` after `implied_return_refusal TEXT,` in the v3
  `CREATE TABLE`.
- Add `("dcf_refusal", "TEXT"),` to the migration loop's tuple from #59.

`corporate_comparison.py`:
- **Snapshot `INSERT`:**
  - Add `dcf_refusal` to the column list after `implied_return_refusal` (33
    placeholders).
  - In values, write `row.dcf_value if row.dcf_value is not None else 0.0`,
    `row.dcf_implied_return if row.dcf_implied_return is not None else 0.0` and
    `row.stock_expected_return if row.stock_expected_return is not None else 0.0` in their
    existing positions, with a comment: `# NOT NULL columns; a refused row's 0.0 is never
    served (the reader maps dcf_refusal to None).`
  - Add `row.dcf_refusal` after `row.implied_return_refusal`.
- **Both row `SELECT`s:** add `dcf_refusal` after `implied_return_refusal`.
- **`_rows_to_response`:** add `refused = row["dcf_refusal"] is not None` at the top of the
  comprehension body (convert the comprehension to a loop if needed), then:

```python
            dcf_value=None if refused else float(row["dcf_value"]),
            dcf_implied_return=None if refused else float(row["dcf_implied_return"] or row["stock_expected_return"] or 0.0),
            stock_expected_return=None if refused else float(row["stock_expected_return"]),
            dcf_refusal=row["dcf_refusal"],
```

- **History aggregate:** the `average_dcf_value` line becomes
  `AVG(CASE WHEN s.group_name != ? AND s.bridge_quality != 'missing' AND s.dcf_refusal IS NULL THEN s.dcf_value END) AS average_dcf_value,`.
- **Stock history:** in the `SELECT`, add `s.dcf_refusal,` after `s.implied_return_refusal,`.
  In the builder:
  - `dcf_implied_return=None if row["dcf_refusal"] else round(float(row["dcf_implied_return"] or 0.0), 2),`
  - `dcf_refusal=row["dcf_refusal"],`

`corporate.py`, `CorporateComparisonStockHistoryPoint`:
- `dcf_implied_return: float | None` (required);
- add `dcf_refusal: str | None` (required), with a one-line comment.

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `python -m pytest -q -p no:cacheprovider tests/api/test_corporate_comparison.py tests/api/test_investment_decision_record.py tests/core_finance`
Expected: PASS. Then run the allowlist check from Global Constraints; its output must be
empty.

- [ ] **Step 4: Mutation matrix**

| Mutation | Test that must fail |
|---|---|
| the reader ignores `dcf_refusal` (`refused = False`) | `test_a_refused_row_persists_its_code_and_reloads_as_none_not_zero` |
| `AND s.dcf_refusal IS NULL` removed | `test_the_dcf_average_excludes_refused_rows` |
| the migration tuple entry removed | `test_init_db_adds_the_dcf_refusal_column_to_an_existing_table` |
| the stock-history builder drops the `None` mapping | `test_the_stock_history_carries_the_dcf_refusal` |

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/db.py apps/api/services/corporate_comparison.py apps/api/models/schema_parts/corporate.py tests/api/test_corporate_comparison.py
git commit -m "feat(snapshots): metric v4 stores dcf_refusal; refused rows reload as None and leave the DCF average"
```

---

### Task 4: Single-ticker DCF refuses as 422

**Files:**
- Modify: `apps/api/services/corporate_dcf.py` (`_build_dcf_outputs`)
- Modify: `apps/api/services/corporate_metrics_service.py`
  (`valuation_params_from_metrics`, near line 529)
- Modify: `apps/api/routes/corporate.py` (`dynamic_dcf_model`, `get_dcf_full_report`,
  `stream_dcf_summary`)
- Test: `tests/api/test_corporate_dcf_bridge.py` (add),
  `tests/api/test_corporate_dcf_streaming.py` (add), `tests/api/test_bulk_dcf_isolation.py`
  (add)

**Interfaces:**
- Consumes: Task 1's `require_admissible_fcff_path`.
- Produces: the three routes return 422 with `detail = {"code": "non_positive_fcff",
  "message": str}`.

- [ ] **Step 1: Write the failing tests**

In `tests/api/test_corporate_dcf_bridge.py`, append (it already has `_params`, `_bridge`,
`_outputs`, `_metrics`):

```python
from packages.core_finance.refusals import EngineRefusal


def test_a_small_positive_fcff_is_valued_on_its_real_cash_flow_single_ticker():
    # DCFAssumptionSummary.fcff_used records the FCFF the valuation ran on.
    _summary, assumptions, _report = _outputs(_params(fcff=0.5), _bridge())
    assert assumptions.fcff_used == pytest.approx(0.5)


def test_a_zero_fcff_is_refused_not_floored():
    with pytest.raises(EngineRefusal) as excinfo:
        _outputs(_params(fcff=0.0), _bridge())
    assert excinfo.value.code == "non_positive_fcff"


def test_a_negative_stored_fcff_is_refused_when_the_request_leaves_it_to_the_store():
    with pytest.raises(EngineRefusal):
        _build_dcf_outputs(
            ticker="TEST", params=_params(fcff=None),
            current_price_loader=lambda t: 100.0,
            metrics_loader=lambda t: _metrics(t).model_copy(update={"fcff": -0.5}),
            risk_free_rate=0.042, equity_risk_premium=0.055, country_risk_premium=0.008,
            bridge_loader=lambda t: _bridge(),
        )
```

In `tests/api/test_corporate_dcf_streaming.py`, append a route test. Reuse that file's
TestClient and its monkeypatch of the metrics/price loaders. Read its top first:

```python
@pytest.mark.parametrize("path", ["/api/v1/corporate/dcf/TEST", "/api/v1/corporate/dcf/TEST/report", "/api/v1/corporate/dcf/TEST/stream"])
def test_a_refused_dcf_is_a_422_with_its_code_on_every_route(path, client):
    body = {"revenue_growth_rate": 0.06, "operating_margin": 0.25, "tax_rate": 0.21, "wacc": 0.10, "fcff": 0.0}
    response = client.post(path, json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "non_positive_fcff"
```

Adapt `client` to the file's existing fixture name or setup. If that file has no client
fixture, construct `TestClient(app)` and patch `corporate_route._metrics_for_ticker` and
`_latest_market_price` as `tests/api/test_corporate_comparison.py::_patch_comparison_sources`
does.

In `tests/api/test_bulk_dcf_isolation.py`, append a test that calls `build_bulk_dcf_reports`
with a metrics loader returning `fcff=-0.5` for one ticker, using the real
`valuation_params_from_metrics` as `valuation_params_builder`. Assert that the ticker is
in `skipped`, and that its `reason` starts with `"EngineRefusal: "` and contains `"zero or
negative"` (not `ValidationError`). Model it on that file's existing isolation test.

Run the three files. Expected: FAIL (the zero-FCFF case is valued at 1.0; the routes
return 200).

- [ ] **Step 2: Implement**

`corporate_dcf.py`, `_build_dcf_outputs`:
- Replace
  `base_fcff = max(float(params.fcff if params.fcff is not None else metrics.fcff), 1.0)`
  with `base_fcff = float(params.fcff if params.fcff is not None else metrics.fcff)`.
- Directly after `growth_used = float(params.revenue_growth_rate)`, add:

```python
    # No floor (spec 2026-09-26-dcf-fcff-floor-removal): the same admissibility test the
    # comparison DCF and the implied return use. A refused path raises the typed refusal,
    # which the routes return as 422 and the bulk batch lists under `skipped`.
    require_admissible_fcff_path([base_fcff * ((1 + growth_used) ** year) for year in range(1, 6)])
```

  Import `require_admissible_fcff_path` from `packages.core_finance.dcf`.

`corporate_metrics_service.valuation_params_from_metrics`: replace
`fcff=max(float(metrics.fcff), 0.0),` with:

```python
        # Not clamped: ValuationAssumptions.fcff is ge=0, so a non-positive stored value is
        # passed as None and the DCF reads the real (negative) figure from the store, which
        # refuses it as non_positive_fcff instead of valuing a clamped zero or failing
        # validation.
        fcff=float(metrics.fcff) if float(metrics.fcff) > 0 else None,
```

`routes/corporate.py`:
- Import `EngineRefusal` from `packages.core_finance.refusals`.
- Add a helper:

```python
def _refusal_422(exc: EngineRefusal) -> HTTPException:
    """A DCF the model declines to produce is content for the caller, not a 500."""
    return HTTPException(status_code=422, detail={"code": exc.code, "message": str(exc)})
```

- Wrap the `build_dcf_summary(...)` call in `dynamic_dcf_model`, and the
  `build_dcf_full_report(...)` call in `get_dcf_full_report`, in
  `try: ... except EngineRefusal as exc: raise _refusal_422(exc) from exc`.
- In `stream_dcf_summary`: move the `build_dcf_summary(...)` call **out** of
  `event_stream()`, before it, inside the same `try/except EngineRefusal` → 422, so a
  refusal is a 422 response, not a stream that dies after its 200 headers.
  `event_stream()` then closes over `summary` and `assumption_summary`.

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `python -m pytest -q -p no:cacheprovider tests/api/test_corporate_dcf_bridge.py tests/api/test_corporate_dcf_streaming.py tests/api/test_bulk_dcf_isolation.py tests/api/test_engine_refusals.py`
Expected: PASS. Then run the allowlist check.

- [ ] **Step 4: Mutation matrix**

| Mutation | Test that must fail |
|---|---|
| the floor restored in `_build_dcf_outputs` | `test_a_zero_fcff_is_refused_not_floored` |
| the stream route's `except EngineRefusal` removed | `test_a_refused_dcf_is_a_422_with_its_code_on_every_route[/api/v1/corporate/dcf/TEST/stream]` |
| `valuation_params_from_metrics` passes `fcff=float(metrics.fcff)` unguarded (negative) | the bulk test: the reason becomes `ValidationError: ...`, not `EngineRefusal: ...` |

A clamp back to `max(fcff, 0.0)` behaves identically (0 is refused with the same code), so no
test can tell it apart. Task 6's grep invariant forbids it instead.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/corporate_dcf.py apps/api/services/corporate_metrics_service.py apps/api/routes/corporate.py tests/api/test_corporate_dcf_bridge.py tests/api/test_corporate_dcf_streaming.py tests/api/test_bulk_dcf_isolation.py
git commit -m "fix(dcf): the single-ticker DCF values real FCFF and refuses a non-positive forecast as 422"
```

---

### Task 5: Frontend: comparison, DCF panel, workbench, Portfolio, history notices

**Files:**
- Modify: `packages/shared-types/generated/portfolio.ts` (regenerate:
  `python scripts/export_schema.py`, then
  `npx --yes json-schema-to-typescript@15 --unreachableDefinitions packages/shared-types/generated/portfolio.schema.json`,
  prepending the file's existing header)
- Modify: `apps/web/lib/impliedReturn.ts` (the shared refusal map gains a DCF-panel
  message helper), new `apps/web/lib/dcfRefusal.ts`
- Modify: `apps/web/app/corporate/corporateTypes.ts`,
  `apps/web/app/corporate/corporateDerivedViews.ts` (`bridgedDcfValue`),
  `apps/web/app/corporate/components/CorporateComparisonTable.tsx`,
  `apps/web/app/corporate/components/TargetStockComparisonSection.tsx` (row type),
  `apps/web/app/corporate/corporateUtils.ts` (`streamCorporateDcfSummary`),
  `apps/web/app/corporate/page.tsx` (DCF stream catch and render),
  `apps/web/components/workbenches/DCFWorkbench.tsx`
- Modify: `apps/web/app/portfolio/page.tsx` (row and stock-history types),
  `apps/web/app/portfolio/portfolioMetrics.ts` (`dcfUpside` reason),
  `apps/web/app/portfolio/components/SnapshotHistoryModal.tsx` (notices)
- Modify (fixtures): `apps/web/tests/e2e/helpers/corporatePageMock.ts`,
  `apps/web/tests/e2e/fixtures/shared.ts`, `apps/web/tests/e2e/helpers/portfolioPageMock.ts`,
  `apps/web/tests/e2e/refresh-idle-state.spec.ts` (each comparison row gains
  `dcf_refusal: null`)
- Test: `apps/web/tests/e2e/corporate-comparison-bridge.spec.ts`,
  `apps/web/tests/e2e/snapshot-history-metric-version.spec.ts`, and a DCF-panel test in
  `apps/web/tests/e2e/refresh-idle-state.spec.ts`

**Interfaces:**
- Consumes: the wire fields from Tasks 2–4.
- Produces:
  - `DcfRefusalError(code: string, message: string)`
  - `readDcfRefusal(response: Response): Promise<DcfRefusalError | null>`
  - `postDcf<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>`

- [ ] **Step 1: Types and fixtures**

- Regenerate the generated types as above. Stop if the command cannot run; never
  hand-edit.
- `corporateTypes.ts`, `CorporateComparisonRowApi`: `dcf_value: number | null;`,
  `dcf_implied_return: number | null;`, `stock_expected_return: number | null;`, and add
  `dcf_refusal: string | null;`. Do the same in `CorporateComparisonTable.tsx`'s
  `ComparisonTableRow` and in `TargetStockComparisonSection.tsx`'s `ComparisonRow`
  (without `stock_expected_return` where absent).
- `portfolio/page.tsx`: the row type gets `dcf_value: number | null;`,
  `dcf_implied_return: number | null;` and `dcf_refusal: string | null;`. The stock-history
  point type gets `dcf_implied_return: number | null;` and `dcf_refusal: string | null;`.
- **Fixtures:** every mock comparison row gains `dcf_refusal: null,` (next to
  `implied_return_refusal`). Every mock stock-history point gains `dcf_refusal: null,`.
- **The `MISS` row in `corporatePageMock.ts`** stays a missing-bridge row, not a refused
  one. Add a new row `BURN`: sector "Technology", `bridge_quality: "ok"`,
  `dcf_value: null`, `dcf_implied_return: null`, `stock_expected_return: null`,
  `dcf_refusal: "non_positive_fcff"`, `market_implied_return: null`,
  `implied_return_spread: null`, `implied_return_refusal: "non_positive_fcff"`,
  `current_price: 12.0`. Add `BURN: 12.0` to `CORPORATE_COMPARISON_CURRENT_PRICES`.

- [ ] **Step 2: Write the failing e2e tests**

Append to `corporate-comparison-bridge.spec.ts`:

```ts
test("a refused DCF shows a dash with its reason in both DCF cells, sorts last and is not plotted", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  const value = rowCell(page, "BURN", "DCF Value");
  await expect(value).toHaveText("—");
  await expect(value.locator("[title]").first()).toHaveAttribute("title", /zero or negative over the forecast/);
  await expect(rowCell(page, "BURN", "DCF value vs price (one-off gap)")).toHaveText("—");
  await sortBy(page, "dcf_value", "desc");
  expect((await tickerOrder(page)).slice(-2)).toContain("BURN");
  await sortBy(page, "dcf_value", "asc");
  expect((await tickerOrder(page)).slice(-2)).toContain("BURN");
  await selectSimilarComparison(page, "AAPL");
  expect(await plottedTickers(page)).not.toContain("BURN");
});
```

`slice(-2)` holds because the null-last group is `{MISS, BURN}`.

Append to `snapshot-history-metric-version.spec.ts`:

```ts
test("each boundary names what changed: v3 adds the implied return, v4 drops the FCFF floor", async ({ page }) => {
  const v4: HistoryPointSeed = { as_of_date: "2026-09-27", generated_at: "2026-09-27T09:00:00Z", metric_schema_version: 4, average_dcf_value: 150.0 };
  const v3: HistoryPointSeed = { as_of_date: "2026-09-26", generated_at: "2026-09-26T09:00:00Z", metric_schema_version: 3, average_dcf_value: 160.0 };
  const v2: HistoryPointSeed = { ...NEW_DEFINITION, average_implied_return_spread: null };
  await mockPortfolioHistory(page, [v4, v3, v2]);
  const dialog = await openSnapshotHistory(page);
  await expect(historyItem(dialog, v4)).toContainText("$1B minimum FCFF");
  await expect(historyItem(dialog, v3)).toContainText("Implied return vs WACC starts here");
  await expect(historyItem(dialog, v4)).not.toContainText("Implied return vs WACC starts here");
});
```

Append to `refresh-idle-state.spec.ts`. Reuse that file's corporate page setup; read its
first corporate test for the DCF refresh flow first.

```ts
test("a refused single-ticker DCF shows the refusal as content, not an error or a number", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.route("**/api/v1/corporate/dcf/*/stream", (route) =>
    route.fulfill({ status: 422, contentType: "application/json",
      body: JSON.stringify({ detail: { code: "non_positive_fcff", message: "Free cash flow is zero or negative over the forecast, so the model cannot value it." } }) }));
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  const refusal = page.getByTestId("dcf-refusal");
  await expect(refusal).toContainText("zero or negative over the forecast");
  await expect(page.getByText(/DCF stream failed/)).toHaveCount(0);
  // No number stands in for the refused value, including a cached floored one.
  await expect(page.getByRole("button", { name: /^Intrinsic DCF(?! Value)/i })).not.toContainText("$");
});
```

The route registered after `mockCorporatePageApi` wins, because Playwright matches routes in
reverse registration order.

Run: `cd apps/web && npx playwright test tests/e2e/corporate-comparison-bridge.spec.ts tests/e2e/snapshot-history-metric-version.spec.ts tests/e2e/refresh-idle-state.spec.ts --reporter=line`
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**

**`apps/web/lib/dcfRefusal.ts`** (new):

```ts
import { getApiBaseUrl } from "@/lib/api";
import { impliedReturnRefusalText } from "@/lib/impliedReturn";

/**
 * A DCF the backend declined to produce (HTTP 422 {detail: {code, message}}), e.g.
 * non_positive_fcff. Content for the reader, not a failure: callers render it in place of
 * the value rather than as an error state.
 */
export class DcfRefusalError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DcfRefusalError";
  }

  /** The reader's sentence, from the same map the comparison table uses. */
  get readerText(): string {
    return impliedReturnRefusalText(this.code);
  }
}

export async function readDcfRefusal(response: Response): Promise<DcfRefusalError | null> {
  if (response.status !== 422) return null;
  try {
    const body = await response.clone().json();
    const detail = body?.detail;
    if (detail && typeof detail.code === "string") return new DcfRefusalError(detail.code, String(detail.message ?? detail.code));
  } catch {
    // Not a refusal body (e.g. a pydantic validation 422): fall through to the caller's error path.
  }
  return null;
}

export async function postDcf<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const refusal = await readDcfRefusal(response);
  if (refusal) throw refusal;
  if (!response.ok) throw new Error(`DCF request failed: ${response.status}`);
  const payload = await response.json();
  return (payload?.data ?? payload) as T;
}
```

Check how `fetchApi` unwraps `APIResponse` (`data`) and mirror it exactly.

**`corporateUtils.ts`, `streamCorporateDcfSummary`:** before
`if (!response.ok || !response.body)`, add
`const refusal = await readDcfRefusal(response); if (refusal) throw refusal;`.

**`corporate/page.tsx`:**
- Add state `const [dcfRefusal, setDcfRefusal] = useState<DcfRefusalError | null>(null);`.
  Clear it where `setDcfStreamError(null)` is called.
- In the stream `.catch`: `if (error instanceof DcfRefusalError) { setDcfRefusal(error); setDcfStreamResult(null); setDcfStreamStatus("complete"); return; }`
  goes before the error branch. Clearing `setDcfStreamResult(null)` also drops a stale
  cached floored value (Review Focus 1). Use the actual setter name for the displayed
  result; if the cached value is held separately, clear that too.
- Render, next to the existing `dcfStreamError` pill:

```tsx
                {dcfRefusal && (
                  <span data-testid="dcf-refusal" className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[length:var(--type-caption)] font-bold text-[var(--text-secondary)]">
                    Not valued: {dcfRefusal.readerText}
                  </span>
                )}
```

- The full-report button: add `|| dcfRefusal !== null` to its `disabled` condition.

**`DCFWorkbench.tsx`:**
- Replace the `fetchApi(`/corporate/dcf/${ticker}`, {...})` call with
  `postDcf<DCFResult>(`/corporate/dcf/${ticker}`, <the same body object>, signal)`.
- Destructure `error` from `useQuery`.
- In the `isError` branch, render `error instanceof DcfRefusalError ? <p data-testid="dcf-workbench-refusal">Not valued: {error.readerText}</p> : <existing error UI>`.

**`corporateDerivedViews.ts`, `bridgedDcfValue`:** the signature becomes
`(row: { dcf_value: number | null; bridge_quality?: string })`, returning
`isBridgeUnresolved(row.bridge_quality) || row.dcf_value === null ? null : row.dcf_value`.

**`CorporateComparisonTable.tsx`:**
- In the DCF Value cell, the title becomes
  `row.dcf_refusal ? impliedReturnRefusalText(row.dcf_refusal) : bridged === null ? UNBRIDGED_REASON-text-it-uses-today : undefined`.
- In the "DCF value vs price" cell, render
  `row.dcf_implied_return === null ? "—" : formatPct2(row.dcf_implied_return)`, with the same
  refusal title.

**`TargetStockComparisonSection.tsx` and anything else that reads `row.dcf_value` or
`row.dcf_implied_return`** as a number: run
`grep -rn "\.dcf_value\|\.dcf_implied_return\|stock_expected_return" apps/web/app apps/web/lib apps/web/components`.
Each hit either goes through `bridgedDcfValue` or null-checks. `tsc` lists any that don't.

**`portfolioMetrics.ts`, `dcfUpside`:** `missingReason: row.dcf_refusal ? impliedReturnRefusalText(row.dcf_refusal) : "Missing DCF output for this ticker."`.
The positive-DCF count in `portfolio/page.tsx` (`positiveDcfCount`) is not rendered
anywhere (grep `positiveDcfCount` in the components). If that holds, leave it, and note it
in the ledger rather than change it.

**`SnapshotHistoryModal.tsx`:** replace the notice construction with per-version notices.

```ts
// What each version changed, so a boundary says why values are not comparable rather
// than only that they are not. Versions a boundary crosses all get their line.
const VERSION_NOTICES: Record<number, string> = {
  2: "Metric definition changed. Values before and after this point are not directly comparable.",
  3: "Implied return vs WACC starts here; earlier snapshots did not record it.",
  4: "DCF values before this point used a $1B minimum FCFF, which overstated companies with FCFF under $1B and valued cash-burning companies at +$1B. Values across this point are not comparable for those companies.",
};
```

Inside the loop:

```ts
      if (previous.metric_schema_version === 0) {
        notices.set(point.snapshot_version, "Metric definition before this point was not recorded, so whether values are comparable across it is unknown.");
        return;
      }
      const lines = [];
      for (let v = previous.metric_schema_version + 1; v <= point.metric_schema_version; v += 1) {
        if (VERSION_NOTICES[v]) lines.push(VERSION_NOTICES[v]);
      }
      notices.set(point.snapshot_version, lines.length ? lines.join(" ") : VERSION_NOTICES[2]);
```

Crossing 1→2 keeps the exact existing sentence, so the current `CHANGED_NOTICE` regex
tests stay green.

- [ ] **Step 4: Run the checks and confirm they pass**

Run, from `apps/web`: `npx tsc --noEmit -p .`, then `npx eslint app lib components`, then
the three spec files, then the full Playwright suite
(`npx playwright test --reporter=line`). Strip ANSI codes before reading the counts.
Expected: all green. If the full run fails with "Timed out waiting ... config.webServer",
check `:8110`/`:3101` for leftover servers and rerun once.

- [ ] **Step 5: Mutation matrix**

| Mutation | Spec that must fail |
|---|---|
| `bridgedDcfValue` ignores `dcf_value === null` | "a refused DCF shows a dash with its reason…" |
| the DCF-vs-price cell renders `formatPct2(row.dcf_implied_return ?? 0)` | "a refused DCF shows a dash with its reason…" |
| `VERSION_NOTICES[4]` removed | "each boundary names what changed…" |
| `readDcfRefusal` returns `null` always | "a refused single-ticker DCF shows the refusal as content…" |

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types apps/web
git commit -m "feat(ui): a refused DCF reads as content everywhere; history names the v3 and v4 changes"
```

---

### Task 6: Records, the grep invariant, the full runs

**Files:** `ERROR-LOG.md`, `docs/metrics/discount-rates-and-returns.md`,
`docs/superpowers/specs/2026-09-26-implied-return-spread-design.md`,
`guideline/sop/todo.md`

- [ ] **Step 1: The grep invariant**

Run from the repo root:
`git grep -nE "max\([^)]*fcff[^)]*,\s*(1|0)\.0\)" -- apps packages`
Expected: no output. Any hit is a floor or clamp left in a valuation path: remove it, and
rerun that task's tests.

- [ ] **Step 2: ERROR-LOG**

In the 2026-09-26 entry "the comparison DCF floors FCFF at $1B", change the `Fix:` line from
"Not fixed. ..." to:

```text
Fix: removed in both valuation paths (metric v4); a DCF exists only when every forecast FCFF
is positive, else it refuses as non_positive_fcff (row, snapshot, history, decision log, 422
on the single-ticker routes). Spec docs/superpowers/specs/2026-09-26-dcf-fcff-floor-removal-design.md.
```

Update `Files changed:` to list the files from `git diff --name-only renewal...HEAD`,
excluding `docs/superpowers/`. The file's own rule requires the `Fix:` line to change, not
only an appended paragraph.

- [ ] **Step 3: Metric doc and spec pointer**

- In `docs/metrics/discount-rates-and-returns.md`:
  - delete the implied-return entry's "**Exception: FCFF between 0 and 1**" paragraph;
  - in the `dcf_implied_return` entry's "How it is calculated here", add one sentence: "From
    metric v4 it is `None` with `dcf_refusal = non_positive_fcff` when any forecast FCFF is
    zero or negative; the DCF no longer floors FCFF."
- In the v3 spec's §2.3 note about `fcff >= 1`, append: "Resolved by metric v4
  (`2026-09-26-dcf-fcff-floor-removal-design.md`)."

- [ ] **Step 4: Todo**

In `guideline/sop/todo.md`, mark the FCFF-floor item `[x]`, FIXED 2026-09-26, citing the
spec and metric v4.

- [ ] **Step 5: The full runs**

- The allowlist check: its output must be empty.
- From `apps/web`: `npx tsc --noEmit -p .`, `npx eslint .`, and
  `npx playwright test --reporter=line`, expecting 0 failed.

- [ ] **Step 6: Commit**

```bash
git add ERROR-LOG.md docs/metrics/discount-rates-and-returns.md docs/superpowers/specs/2026-09-26-implied-return-spread-design.md guideline/sop/todo.md
git commit -m "docs: the FCFF floor is removed (metric v4); ERROR-LOG Fix line amended; todo closed"
```
