# Implied Return Spread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unit-inconsistent `expected_return_spread` (a one-off gap minus an
annual rate) with `market_implied_return` (the annual IRR at which the comparison DCF equals
market EV) and `implied_return_spread` (that IRR minus WACC). Refused rows carry a code
instead of a number.

**Architecture:**
- **Engine:** a pure solver in `packages/core_finance/expected_return.py` (bisection over a
  fixed bracket, six ordered refusal codes).
- **Service:** `_dcf_snapshot` feeds the solver from the inputs it already has, and the
  comparison row, snapshot table, history and stock history carry three new nullable
  fields.
- **Old column:** the legacy `expected_return_spread` column stays in SQLite but is never
  read again.
- **Frontend:** `/corporate` and Portfolio read the new fields, with one shared
  refusal-label map.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic / SQLite, pytest. Next.js 16 / React 19 /
TypeScript, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-implied-return-spread-design.md` (rev 2).
Read it first; this plan argues from it.

## Global Constraints

- **Search bracket:** `r_min = g + 0.005`, `r_max = 10.0`.
- **Bisection:** a fixed 64 steps, returning the midpoint.
- **Terminal value:** `TV = FCFF_5 * (1 + g) / max(r - g, 0.005)`, with `g` held fixed at the
  WACC-derived terminal growth.
- **Market EV:** `market_ev = current_price * diluted_shares + net_debt - non_operating_assets`,
  where `non_operating_assets` is taken as `0.0` when `None`.
- **Refusal codes, in precedence order:** `no_price`, `bridge_unresolved`,
  `non_positive_fcff`, `non_positive_market_ev`, `below_model_range`,
  `above_model_range`. They are lowercase `snake_case` and never matched by text.
- **No FCFF placeholder:** the implied return uses the **unfloored** `metrics.fcff`. The
  display DCF's `max(fcff, 1.0)` floor is untouched.
- **Wire units:** `market_implied_return` is percent per year and `implied_return_spread`
  is percentage points per year, both rounded to 2 dp. They are `null` when refused
  **or** when not recorded (snapshots before metric v3).
- **Snapshot version:** `METRIC_SCHEMA_VERSION = 3`.
- **Labels:**
  - "Market-implied return (per year)";
  - "Implied return vs WACC (pts per year)";
  - "DCF value vs price (one-off gap)".

  The words "Spread", "Expected vs Market" and "DCF upside" are retired as labels for
  these fields.
- **Git:** never use `git stash`. Commit only the files a task names.
- **Test verification (CLAUDE.md §8):** every task ends with its mutation matrix. Each
  mutation is applied on disk, the named test is run and must FAIL, then the file is
  restored from a saved copy. Do not use `git checkout --` on files that hold this task's
  uncommitted work.

## Review Focus

1. **A stale saved sort key.** Session tab state still holds `"expected_return_spread"`
   from before this change. The page must fall back to the default sort, not sort by
   `NaN`. Pinned in Task 4 (e2e).
2. **A history mixing v2 and v3 snapshots.** v2 points show "not recorded before metric
   v3", and the Portfolio trend delta is not computed across `null`. Pinned in Task 5
   (e2e).
3. **`0 < fcff < 1`.** The display DCF floors this to 1.0 and the implied return does not,
   so the invariant holds against `PV(WACC)` of the **unfloored** path. The implied return
   is still produced, not refused. Pinned in Task 2.
4. **Refused rows under sorting.** They go last in both sort directions, the same rule
   `dcf_value` already follows. Pinned in Task 4 (e2e).
5. **Large net cash.** `market_ev <= 0` is refused as `non_positive_market_ev`, never
   solved. Pinned in Task 2.

---

### Task 1: Engine solver

**Files:**
- Modify: `packages/core_finance/expected_return.py`
- Modify: `packages/core_finance/__init__.py` (exports)
- Test: `tests/core_finance/test_expected_return.py`

**Interfaces:**
- Produces:
  - `IMPLIED_RETURN_REFUSAL_CODES: frozenset[str]`
  - `ImpliedReturn(rate: float | None, refusal: str | None)` (frozen dataclass)
  - `enterprise_present_value(fcff_path: Sequence[float], terminal_growth: float, rate: float) -> float`
  - `calculate_market_implied_return(fcff_path: Sequence[float], terminal_growth: float, market_ev: float) -> ImpliedReturn`
  - `ExpectedReturnResult` loses `expected_return_spread`, and
    `calculate_expected_return_spread` is deleted.

- [ ] **Step 1: Replace the spread tests with the solver tests**

In `tests/core_finance/test_expected_return.py`:
- Remove `calculate_expected_return_spread` from the import list.
- Delete `test_calculate_expected_return_spread_subtracts_market_return`.
- Delete the line `assert result.expected_return_spread == pytest.approx(0.103)`.
- Then append:

```python
from packages.core_finance.expected_return import (
    IMPLIED_RETURN_REFUSAL_CODES,
    calculate_market_implied_return,
)
from packages.core_finance.terminal_growth import TERMINAL_GROWTH_CEILING, derive_terminal_growth


def _pv(path, g, r):
    """Independent restatement of the spec's PV(r) (spec 2.1), so no assertion below is
    checked against the function under test."""
    explicit = sum(cf / (1 + r) ** t for t, cf in enumerate(path, start=1))
    terminal = path[-1] * (1 + g) / max(r - g, 0.005)
    return explicit + terminal / (1 + r) ** len(path)


def test_the_refusal_codes_are_exactly_the_specs_six():
    assert IMPLIED_RETURN_REFUSAL_CODES == {
        "no_price", "bridge_unresolved", "non_positive_fcff",
        "non_positive_market_ev", "below_model_range", "above_model_range",
    }


def test_a_flat_perpetuity_solves_to_cash_flow_over_price():
    # With growth 0 and g 0, PV(r) = CF / r exactly, so the IRR is CF / market_ev.
    assert calculate_market_implied_return([10.0] * 5, 0.0, 100.0).rate == pytest.approx(0.10, abs=1e-12)
    assert calculate_market_implied_return([10.0] * 5, 0.0, 50.0).rate == pytest.approx(0.20, abs=1e-12)


def test_the_solved_rate_reprices_market_ev():
    path = [92 * 1.06 ** t for t in range(1, 6)]
    result = calculate_market_implied_return(path, 0.03, 1560.0)
    assert result.refusal is None
    assert abs(_pv(path, 0.03, result.rate) - 1560.0) / 1560.0 < 1e-9
    # Independently bisected by hand for the comparison fixture (fcff 92, growth 6%, g 3%).
    assert result.rate == pytest.approx(0.0989840187, abs=1e-9)


@pytest.mark.parametrize("wacc", [0.06, 0.08, 0.10, 0.12])
@pytest.mark.parametrize("growth", [-0.05, 0.0, 0.06, 0.20])
@pytest.mark.parametrize("multiple", [0.5, 0.9, 1.0, 1.1, 2.0])
def test_the_implied_return_beats_wacc_exactly_when_the_dcf_beats_the_market(wacc, growth, multiple):
    g = derive_terminal_growth(company_growth=growth, wacc=wacc, ceiling=TERMINAL_GROWTH_CEILING).rate
    path = [50 * (1 + growth) ** t for t in range(1, 6)]
    market_ev = _pv(path, g, wacc) * multiple
    result = calculate_market_implied_return(path, g, market_ev)
    assert result.refusal is None
    if multiple < 1:
        assert result.rate > wacc
    elif multiple > 1:
        assert result.rate < wacc
    else:
        assert result.rate == pytest.approx(wacc, abs=1e-9)


def test_a_non_positive_cash_flow_is_refused_before_solving():
    assert calculate_market_implied_return([10.0, 0.0, 10.0, 10.0, 10.0], 0.0, 100.0).refusal == "non_positive_fcff"


def test_growth_at_or_below_minus_one_is_refused_as_non_monotone():
    alternating = [10.0 * (1 - 1.5) ** t for t in range(1, 6)]
    assert calculate_market_implied_return(alternating, 0.0, 100.0).refusal == "non_positive_fcff"


def test_non_positive_market_ev_is_refused():
    assert calculate_market_implied_return([10.0] * 5, 0.0, 0.0).refusal == "non_positive_market_ev"
    assert calculate_market_implied_return([10.0] * 5, 0.0, -5.0).refusal == "non_positive_market_ev"


def test_fcff_refusal_takes_precedence_over_market_ev_refusal():
    assert calculate_market_implied_return([-1.0] * 5, 0.0, -5.0).refusal == "non_positive_fcff"


def test_a_market_ev_above_the_bracket_is_below_model_range():
    ceiling = _pv([10.0] * 5, 0.03, 0.035)
    assert calculate_market_implied_return([10.0] * 5, 0.03, ceiling * 1.01).refusal == "below_model_range"
    at_edge = calculate_market_implied_return([10.0] * 5, 0.03, ceiling)
    assert at_edge.refusal is None and at_edge.rate == pytest.approx(0.035, abs=1e-9)


def test_a_market_ev_below_the_bracket_is_above_model_range():
    floor = _pv([10.0] * 5, 0.0, 10.0)
    assert calculate_market_implied_return([10.0] * 5, 0.0, floor * 0.99).refusal == "above_model_range"


def test_a_refused_result_carries_no_rate():
    result = calculate_market_implied_return([10.0] * 5, 0.0, 0.0)
    assert result.rate is None and result.refusal in IMPLIED_RETURN_REFUSAL_CODES
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest -q -p no:cacheprovider tests/core_finance/test_expected_return.py`
Expected: FAIL on import (`cannot import name 'IMPLIED_RETURN_REFUSAL_CODES'`).

- [ ] **Step 3: Implement**

In `packages/core_finance/expected_return.py`:
- Change the import line to `from dataclasses import dataclass` plus
  `from typing import Sequence`.
- Delete the `expected_return_spread: float` field from `ExpectedReturnResult`.
- Delete `calculate_expected_return_spread`.
- Delete the `expected_return_spread=...` argument in `calculate_expected_return_result`.
- Append:

```python
# Spec 2.4. Stable codes, never matched by text. The service checks the first two (it owns
# the price and the bridge); this module checks the rest, in this order.
IMPLIED_RETURN_REFUSAL_CODES: frozenset[str] = frozenset({
    "no_price",
    "bridge_unresolved",
    "non_positive_fcff",
    "non_positive_market_ev",
    "below_model_range",
    "above_model_range",
})

# The terminal denominator floor the comparison DCF applies; inside the solver's bracket it
# is never active, because the bracket starts this far above g.
_TERMINAL_SPREAD_FLOOR = 0.005
_RATE_CEILING = 10.0
_BISECTION_STEPS = 64


@dataclass(frozen=True)
class ImpliedReturn:
    """An annual rate, or the code saying why there is none. Exactly one is set."""

    rate: float | None
    refusal: str | None


def enterprise_present_value(fcff_path: Sequence[float], terminal_growth: float, rate: float) -> float:
    """Five-year FCFF plus a Gordon terminal value, discounted at `rate` (decimal).

    The comparison DCF's own formula: `_dcf_snapshot` values the business with this at
    WACC, and the implied return solves it for the market's EV.
    """
    explicit = sum(cash_flow / (1 + rate) ** year for year, cash_flow in enumerate(fcff_path, start=1))
    terminal_value = fcff_path[-1] * (1 + terminal_growth) / max(rate - terminal_growth, _TERMINAL_SPREAD_FLOOR)
    return explicit + terminal_value / (1 + rate) ** len(fcff_path)


def calculate_market_implied_return(
    fcff_path: Sequence[float], terminal_growth: float, market_ev: float
) -> ImpliedReturn:
    """The annual discount rate at which `enterprise_present_value` equals `market_ev`.

    Cash flows and terminal growth are held fixed; only the rate varies. A non-positive
    cash flow is refused first: with every cash flow positive, PV is strictly decreasing
    in the rate, so the root is unique, and without that guarantee it may not be.
    """
    if not fcff_path or any(cash_flow <= 0 for cash_flow in fcff_path):
        return ImpliedReturn(None, "non_positive_fcff")
    if market_ev <= 0:
        return ImpliedReturn(None, "non_positive_market_ev")
    low = terminal_growth + _TERMINAL_SPREAD_FLOOR
    high = _RATE_CEILING
    if market_ev > enterprise_present_value(fcff_path, terminal_growth, low):
        return ImpliedReturn(None, "below_model_range")
    if market_ev < enterprise_present_value(fcff_path, terminal_growth, high):
        return ImpliedReturn(None, "above_model_range")
    for _ in range(_BISECTION_STEPS):
        mid = (low + high) / 2
        if enterprise_present_value(fcff_path, terminal_growth, mid) > market_ev:
            low = mid
        else:
            high = mid
    return ImpliedReturn((low + high) / 2, None)
```

In `packages/core_finance/__init__.py`:
- In the `from .expected_return import (...)` block, replace
  `calculate_expected_return_spread,` with
  `IMPLIED_RETURN_REFUSAL_CODES, ImpliedReturn, calculate_market_implied_return, enterprise_present_value,`.
- In `__all__`, replace `"calculate_expected_return_spread",` with
  `"IMPLIED_RETURN_REFUSAL_CODES", "ImpliedReturn", "calculate_market_implied_return", "enterprise_present_value",`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest -q -p no:cacheprovider tests/core_finance/test_expected_return.py`
Expected: all pass. `apps/api` will not import yet (Task 2 fixes it). Run nothing else.

- [ ] **Step 5: Mutation matrix**

Each mutation is applied to `expected_return.py` from a saved copy, and each must make the
named test FAIL:

| Mutation | Test that must fail |
|---|---|
| bisection branch inverted (`> market_ev: high = mid` / `else: low = mid`) | `test_the_solved_rate_reprices_market_ev` |
| `any(cash_flow <= 0 ...)` → `any(cash_flow < 0 ...)` | `test_a_non_positive_cash_flow_is_refused_before_solving` |
| the two refusals swapped in order (market_ev check first) | `test_fcff_refusal_takes_precedence_over_market_ev_refusal` |
| `low = terminal_growth + _TERMINAL_SPREAD_FLOOR` → `low = terminal_growth` | `test_a_market_ev_above_the_bracket_is_below_model_range` |
| the `above_model_range` check deleted | `test_a_market_ev_below_the_bracket_is_above_model_range` |
| `(1 + terminal_growth)` → `1` in `enterprise_present_value` | `test_the_solved_rate_reprices_market_ev` |

- [ ] **Step 6: Commit**

```bash
git add packages/core_finance/expected_return.py packages/core_finance/__init__.py tests/core_finance/test_expected_return.py
git commit -m "feat(engine): market-implied return solver with ordered refusal codes; drop the unit-inconsistent spread"
```

---

### Task 2: Service and API row

**Files:**
- Modify: `apps/api/services/corporate_comparison.py` (`_dcf_snapshot`, the live row
  builder near line 340, the imports, `METRIC_SCHEMA_VERSION`)
- Modify: `apps/api/models/schema_parts/corporate.py` (`CorporateComparisonRow`)
- Test: `tests/api/test_corporate_comparison.py`

**Interfaces:**
- Consumes: Task 1's `calculate_market_implied_return`, `enterprise_present_value`,
  `ImpliedReturn`.
- Produces:
  - `_dcf_snapshot(...)` returns the keys `market_implied_return: float | None`,
    `implied_return_spread: float | None` and `implied_return_refusal: str | None`, and no
    longer returns `expected_return_spread`.
  - `CorporateComparisonRow` has `market_implied_return: float | None = None`,
    `implied_return_spread: float | None = None` and
    `implied_return_refusal: str | None = None`, and no `expected_return_spread`.
  - `METRIC_SCHEMA_VERSION == 3`.

- [ ] **Step 1: Write the failing tests**

In `tests/api/test_corporate_comparison.py`, change `_snapshot` to accept metrics:

```python
def _snapshot(bridge, *, price=100.0, metrics=None):
    return _dcf_snapshot(
        ticker="AAPL",
        metrics=metrics or _stub_metrics_loader("AAPL"),
        price_loader=lambda _t: price,
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
        bridge_loader=lambda _t: bridge,
    )
```

Append:

```python
from packages.core_finance.expected_return import enterprise_present_value


def test_the_fixture_implies_a_return_just_below_wacc():
    # market_ev = 100 * 15 + 60 = 1560 > the DCF's 1537.03, so the market pays more than
    # the DCF value: the implied return sits below WACC (10%) and the per-share DCF value
    # (98.47) below the price (100). Rate bisected independently: 0.0989840187.
    dcf = _snapshot(_resolved_bridge(net_debt=60.0, non_op=0.0, shares=15.0))
    assert dcf["implied_return_refusal"] is None
    assert dcf["market_implied_return"] == pytest.approx(9.90, abs=0.005)
    assert dcf["implied_return_spread"] == pytest.approx(-0.10, abs=0.005)
    assert "expected_return_spread" not in dcf


def test_a_price_at_the_dcf_value_implies_a_return_at_wacc():
    fair = _snapshot(_resolved_bridge())["estimated_value"]  # the per-share DCF value
    dcf = _snapshot(_resolved_bridge(), price=fair)
    assert dcf["implied_return_spread"] == pytest.approx(0.0, abs=0.01)


def test_the_spread_sign_follows_dcf_value_against_price():
    cheap = _snapshot(_resolved_bridge(), price=50.0)
    rich = _snapshot(_resolved_bridge(), price=150.0)
    assert cheap["estimated_value"] > 50.0 and cheap["implied_return_spread"] > 0
    assert rich["estimated_value"] < 150.0 and rich["implied_return_spread"] < 0


@pytest.mark.parametrize(
    ("bridge", "price", "metrics_update", "code"),
    [
        ("resolved", 0.0, {}, "no_price"),
        ("starved", 100.0, {}, "bridge_unresolved"),
        ("starved", 0.0, {}, "no_price"),                      # precedence: price first
        ("resolved", 100.0, {"fcff": 0.0}, "non_positive_fcff"),
        ("resolved", 100.0, {"growth": -150.0}, "non_positive_fcff"),
        ("net_cash", 100.0, {}, "non_positive_market_ev"),
    ],
)
def test_each_service_refusal_leaves_both_returns_null(bridge, price, metrics_update, code):
    bridges = {
        "resolved": _resolved_bridge(),
        "starved": _starved_bridge(),
        "net_cash": _resolved_bridge(net_debt=-2000.0),  # 100 * 15 - 2000 < 0
    }
    metrics = _stub_metrics_loader("AAPL").model_copy(update=metrics_update)
    dcf = _snapshot(bridges[bridge], price=price, metrics=metrics)
    assert dcf["implied_return_refusal"] == code
    assert dcf["market_implied_return"] is None and dcf["implied_return_spread"] is None


def test_a_sub_unit_fcff_is_solved_on_the_real_cash_flow_not_the_display_floor():
    # Review Focus 3: the display DCF floors fcff at 1.0; the implied return must not.
    metrics = _stub_metrics_loader("AAPL").model_copy(update={"fcff": 0.5})
    dcf = _snapshot(_resolved_bridge(net_debt=0.0, shares=1.0), price=5.0, metrics=metrics)
    assert dcf["implied_return_refusal"] is None
    real_path = [0.5 * 1.06 ** t for t in range(1, 6)]
    real_ev_at_wacc = enterprise_present_value(real_path, 0.03, 0.10)
    assert (dcf["implied_return_spread"] > 0) == (real_ev_at_wacc > 5.0)


def test_the_display_dcf_still_uses_the_shared_present_value():
    dcf = _snapshot(_starved_bridge())
    assert dcf["estimated_value"] == pytest.approx(_FIXTURE_ENTERPRISE_VALUE, abs=0.01)


def test_non_operating_assets_lower_market_ev():
    # market_ev = price * shares + net_debt - non_op: more non-operating assets means the
    # market pays less for the operating business, so the implied return rises.
    without = _snapshot(_resolved_bridge(non_op=0.0))
    with_assets = _snapshot(_resolved_bridge(non_op=100.0))
    assert with_assets["market_implied_return"] > without["market_implied_return"]
```

Also replace the assertion block in
`test_corporate_comparison_defaults_to_portfolio_plus_benchmark_snapshot` that reads
`assert aapl["stock_expected_return"] == pytest.approx(aapl["expected_return_spread"] + aapl["market_expected_return"], abs=1e-6,)`
with:

```python
    assert "expected_return_spread" not in aapl
    assert set(aapl) >= {"market_implied_return", "implied_return_spread", "implied_return_refusal"}
```

In `test_the_dcf_implied_return_is_no_longer_pinned_at_zero`, edit the comment
`expected_return_spread derived from that` to `the old spread was derived from that`. No
assertion changes there.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest -q -p no:cacheprovider tests/api/test_corporate_comparison.py -k "implies or implied or refusal or sub_unit or shared_present or defaults_to_portfolio"`
Expected: FAIL (`KeyError: 'implied_return_refusal'`, or `ImportError` from the service
importing the deleted spread symbol).

- [ ] **Step 3: Implement**

In `apps/api/models/schema_parts/corporate.py`, `CorporateComparisonRow`: delete
`expected_return_spread: float`, and add after `market_expected_return: float`:

```python
    # Spec 2026-09-26-implied-return-spread. Annual rates in percent. None when refused
    # (implied_return_refusal says why) or when read from a snapshot before metric v3
    # (refusal also None: not recorded is not a refusal).
    market_implied_return: float | None = None
    implied_return_spread: float | None = None
    implied_return_refusal: str | None = None
```

In `apps/api/services/corporate_comparison.py`:
- Set `METRIC_SCHEMA_VERSION = 3`. Above it, extend the existing comment with:
  `# 3: expected_return_spread (a one-off gap minus an annual rate) replaced by
  # market_implied_return / implied_return_spread; the old column is retired, not read.`
- Change the `packages.core_finance.expected_return` import to also bring in
  `ImpliedReturn`, `calculate_market_implied_return` and `enterprise_present_value`.
- In `_dcf_snapshot`, replace the lines from `projected_fcff = ...` through
  `enterprise_value = pv_fcff + pv_terminal` with:

```python
        projected_fcff = [base_fcff * ((1 + growth_rate) ** year) for year in range(1, 6)]
        enterprise_value = enterprise_present_value(projected_fcff, terminal_growth, wacc)
```

- After `estimated_value = (...)`, still inside the first `perf_timer`, add:

```python
        implied = _implied_return(
            fcff=float(metrics.fcff),
            growth_rate=growth_rate,
            terminal_growth=terminal_growth,
            current_price=current_price,
            net_debt=net_debt,
            non_operating_assets=non_operating_assets,
            shares=shares,
        )
```

- In the returned dict, delete the `"expected_return_spread": ...` entry and add:

```python
        "market_implied_return": None if implied.rate is None else round(implied.rate * 100, 2),
        "implied_return_spread": None if implied.rate is None else round((implied.rate - wacc) * 100, 2),
        "implied_return_refusal": implied.refusal,
```

- Add this module-level function directly after `_dcf_snapshot`:

```python
def _implied_return(
    *,
    fcff: float,
    growth_rate: float,
    terminal_growth: float,
    current_price: float,
    net_debt: float | None,
    non_operating_assets: float | None,
    shares: float | None,
) -> ImpliedReturn:
    """Spec 2.2-2.4. The first two refusals are checked here because this function owns
    the price and the bridge; the engine checks the rest, in order.

    `fcff` is the UNFLOORED statement value. The display DCF above floors it at 1.0 so a
    value exists on screen; an IRR on that placeholder would be invented.
    """
    if current_price is None or current_price <= 0:
        return ImpliedReturn(None, "no_price")
    if net_debt is None or shares is None or shares <= 0:
        return ImpliedReturn(None, "bridge_unresolved")
    fcff_path = [fcff * (1 + growth_rate) ** year for year in range(1, 6)]
    market_ev = current_price * shares + net_debt - (non_operating_assets or 0.0)
    return calculate_market_implied_return(fcff_path, terminal_growth, market_ev)
```

- In the live row builder (the `CorporateComparisonRow(...)` near line 368), replace
  `expected_return_spread=float(dcf["expected_return_spread"]),` with:

```python
                    market_implied_return=dcf["market_implied_return"],
                    implied_return_spread=dcf["implied_return_spread"],
                    implied_return_refusal=dcf["implied_return_refusal"],
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest -q -p no:cacheprovider tests/api/test_corporate_comparison.py -k "implies or implied or refusal or sub_unit or shared_present or defaults_to_portfolio or resolved_bridge or unresolved or pinned"`
Expected: PASS. Snapshot persistence tests still fail until Task 3; that is expected.

- [ ] **Step 5: Mutation matrix**

Each mutation is applied to `corporate_comparison.py` from a saved copy:

| Mutation | Test that must fail |
|---|---|
| `implied.rate - wacc` → `implied.rate - (risk_free_rate + equity_risk_premium)` | `test_the_fixture_implies_a_return_just_below_wacc` |
| `+ net_debt` → `+ 0.0` in `market_ev` | `test_the_fixture_implies_a_return_just_below_wacc` |
| `- (non_operating_assets or 0.0)` → `+ (non_operating_assets or 0.0)` | `test_non_operating_assets_lower_market_ev` |
| `fcff=float(metrics.fcff)` → `fcff=base_fcff` | `test_each_service_refusal_leaves_both_returns_null[resolved-100.0-metrics_update3-non_positive_fcff]` |
| the `no_price` and `bridge_unresolved` checks swapped | `test_each_service_refusal_leaves_both_returns_null[starved-0.0-...-no_price]` |
| `"implied_return_spread": None if ...` → `0.0 if ...` | `test_each_service_refusal_leaves_both_returns_null` |

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/corporate_comparison.py apps/api/models/schema_parts/corporate.py tests/api/test_corporate_comparison.py
git commit -m "feat(corporate): comparison rows carry the market-implied return and its spread over WACC"
```

---

### Task 3: Snapshot persistence, history and stock history

**Files:**
- Modify: `apps/api/services/db.py` (the v3 `CREATE TABLE` near line 408, and the v3
  column migration after the `bridge_quality` block near line 866)
- Modify: `apps/api/services/corporate_comparison.py` (the snapshot `INSERT` near line
  197; the two row `SELECT`s near lines 513 and 750; `_rows_to_response` near line 598;
  the history aggregate near line 691 and the point builder near 725; the stock history
  `SELECT` near 824 and its builder near 844)
- Modify: `apps/api/models/schema_parts/corporate.py` (`CorporateComparisonHistoryPoint`,
  `CorporateComparisonStockHistoryPoint`)
- Test: `tests/api/test_corporate_comparison.py`

**Interfaces:**
- Consumes: Task 2's row fields.
- Produces:
  - `CorporateComparisonHistoryPoint.average_implied_return_spread: float | None`
    (replaces `average_expected_return_spread`).
  - `CorporateComparisonStockHistoryPoint.implied_return_spread: float | None = None`
    (replaces `expected_return_spread`).
  - v3 table columns `market_implied_return REAL`, `implied_return_spread REAL` and
    `implied_return_refusal TEXT`.

- [ ] **Step 1: Rewrite the aggregate fixtures and add the persistence tests**

In `_insert_snapshot_rows`:
- The tuple becomes `(ticker, bridge_quality, dcf_value, implied_return_spread)`, where the
  last value may be `None`.
- The docstring's field name changes to match.
- In the column list, replace `expected_return_spread` with `implied_return_spread`.

Then:
- In `test_missing_rows_are_excluded_from_the_aggregates_but_estimated_rows_are_not`,
  change the missing row to `("CCC", "missing", 999999.0, None)` (a missing bridge now
  produces no implied return), and change the last assertion to
  `assert point.average_implied_return_spread == pytest.approx(4.0)`.
- In `test_an_all_missing_snapshot_reports_no_average_rather_than_zero`, pass `None` as
  each row's fourth value and assert `point.average_implied_return_spread is None`.
- In `test_legacy_rows_with_an_empty_bridge_quality_stay_in_the_aggregates`: rows inserted
  before v3 have no implied value. Change its rows' fourth value to `None`, keep its
  `average_dcf_value` assertion, and add `assert point.average_implied_return_spread is None`.
- In `test_the_metric_schema_version_is_bumped`, expect `3`.

In the direct `INSERT` inside
`test_corporate_comparison_snapshot_uses_kst_business_date_and_365_day_retention`, leave
`expected_return_spread` in the column list. It deliberately writes a legacy-shaped row.

Append:

```python
def _save_default_snapshot(tmp_path, monkeypatch, *, price=100.0):
    """A real saved snapshot with AAPL's bridge resolved.

    Monkeypatching `load_equity_bridge` does NOT work here: it is bound as
    `_dcf_snapshot`'s default argument at import time (see the docstring of
    `test_a_resolved_bridge_quality_survives_persistence_and_read_back`). So this seeds
    real statement rows, as that test does, and the unpatched loader resolves them.
    """
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _seed_watchlist()
    save_statements("AAPL", [
        StatementRow("AAPL", "balance", "annual", "2025-12-31", "Total Debt", 5_000_000_000.0),
        StatementRow("AAPL", "balance", "annual", "2025-12-31", "Cash And Cash Equivalents", 1_000_000_000.0),
        StatementRow("AAPL", "balance", "annual", "2025-12-31", "Investments And Advances", 500_000_000.0),
        StatementRow("AAPL", "income", "annual", "2025-12-31", "Diluted Average Shares", 2_000_000_000.0),
    ])
    return save_corporate_comparison_snapshot(
        snapshot_source="manual",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=_stub_metrics_loader,
        price_loader=lambda _t: price,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )


def test_a_v3_snapshot_stores_and_reloads_the_implied_return(tmp_path, monkeypatch):
    saved = _save_default_snapshot(tmp_path, monkeypatch)
    live_aapl = next(r for r in saved.rows if r.ticker == "AAPL")
    # A round trip, not a restated value: the seeded bridge's scaled units are the
    # bridge's business, and this test is about persistence.
    assert live_aapl.implied_return_refusal is None and live_aapl.market_implied_return is not None
    reloaded = load_corporate_comparison_snapshot_version(snapshot_version=saved.snapshot.snapshot_version)
    aapl = next(r for r in reloaded.rows if r.ticker == "AAPL")
    assert aapl.market_implied_return == live_aapl.market_implied_return
    assert aapl.implied_return_spread == live_aapl.implied_return_spread
    assert aapl.market_implied_return != aapl.implied_return_spread  # the two columns are not crossed
    assert aapl.implied_return_refusal is None
    with db_service.get_db() as conn:
        version = conn.execute("SELECT metric_schema_version FROM corporate_comparison_snapshots_v3 LIMIT 1").fetchone()[0]
    assert version == 3


def test_a_refusal_code_survives_persistence(tmp_path, monkeypatch):
    saved = _save_default_snapshot(tmp_path, monkeypatch, price=0.0)
    reloaded = load_corporate_comparison_snapshot_version(snapshot_version=saved.snapshot.snapshot_version)
    aapl = next(r for r in reloaded.rows if r.ticker == "AAPL")
    assert aapl.implied_return_refusal == "no_price" and aapl.implied_return_spread is None


def test_a_pre_v3_row_reloads_as_not_recorded_not_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([("AAA", "ok", 100.0, None)], metric_schema_version=2)
    with db_service.get_db() as conn:
        conn.execute("UPDATE corporate_comparison_snapshots_v3 SET expected_return_spread = 42.0")
    reloaded = load_corporate_comparison_snapshot_version(snapshot_version="v1")
    [row] = reloaded.rows
    assert row.implied_return_spread is None and row.implied_return_refusal is None
    assert "expected_return_spread" not in row.model_dump()


def test_the_stock_history_serves_the_implied_spread(tmp_path, monkeypatch):
    saved = _save_default_snapshot(tmp_path, monkeypatch)
    live_aapl = next(r for r in saved.rows if r.ticker == "AAPL")
    history = load_corporate_comparison_stock_history(
        ticker="AAPL", comparison_universe="portfolio_plus_benchmark", benchmark_ticker="^GSPC", custom_tickers=[])
    assert history.points[0].implied_return_spread == live_aapl.implied_return_spread
    assert "expected_return_spread" not in history.points[0].model_dump()


def test_a_pre_v3_stock_history_point_is_null_not_zero(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([("AAA", "ok", 100.0, None)], metric_schema_version=2)
    history = load_corporate_comparison_stock_history(
        ticker="AAA", comparison_universe="portfolio_plus_benchmark", benchmark_ticker="^GSPC", custom_tickers=[])
    assert history.points[0].implied_return_spread is None


def test_init_db_adds_the_implied_return_columns_to_an_existing_v3_table(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    with db_service.get_db() as conn:
        for column in ("market_implied_return", "implied_return_spread", "implied_return_refusal"):
            conn.execute(f"ALTER TABLE corporate_comparison_snapshots_v3 DROP COLUMN {column}")
    db_service.init_db()
    with db_service.get_db() as conn:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots_v3)")}
    assert {"market_implied_return", "implied_return_spread", "implied_return_refusal"} <= columns
```

`_seed_watchlist`, `save_statements` and `StatementRow` are already imported at the top of
this test module. Add `save_corporate_comparison_snapshot`,
`load_corporate_comparison_snapshot_version` and
`load_corporate_comparison_stock_history` to its existing
`from apps.api.services.corporate_comparison import (...)` block, if they are not already
there.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `python -m pytest -q -p no:cacheprovider tests/api/test_corporate_comparison.py`
Expected: FAIL. The new column is absent (`no such column: implied_return_spread`) and
`average_implied_return_spread` is missing.

- [ ] **Step 3: Implement**

In `apps/api/services/db.py`, in the v3 `CREATE TABLE` (near line 408), add after the
`bridge_quality` line:

```sql
    market_implied_return        REAL,
    implied_return_spread        REAL,
    implied_return_refusal       TEXT,
```

After the `if "bridge_quality" not in v3_columns:` block (near line 866), add:

```python
    # Metric v3 (spec 2026-09-26-implied-return-spread). NULL for every earlier row: their
    # FCFF path was not stored, so the value cannot be recomputed, and NULL reads as "not
    # recorded", which is what it is. expected_return_spread stays as a column so history
    # survives, but nothing reads it any more: it subtracted an annual rate from a one-off
    # gap.
    for column, sql_type in (
        ("market_implied_return", "REAL"),
        ("implied_return_spread", "REAL"),
        ("implied_return_refusal", "TEXT"),
    ):
        if column not in v3_columns:
            conn.execute(f"ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN {column} {sql_type}")
```

In `apps/api/models/schema_parts/corporate.py`:
- In `CorporateComparisonHistoryPoint`, rename `average_expected_return_spread` to
  `average_implied_return_spread` and keep `float | None = None`. Add to its comment:
  `None also for snapshots before metric v3, which recorded no implied return.`
- In `CorporateComparisonStockHistoryPoint`, replace
  `expected_return_spread: float = 0.0` with `implied_return_spread: float | None = None`.

In `apps/api/services/corporate_comparison.py`:
- **Snapshot `INSERT`:** in the column list, replace `expected_return_spread,` with
  `market_implied_return, implied_return_spread, implied_return_refusal,`. The
  `VALUES (...)` placeholder count goes from 30 to 32. In the parameter tuple, replace
  `row.expected_return_spread,` with
  `row.market_implied_return, row.implied_return_spread, row.implied_return_refusal,`.
- **Both row `SELECT`s** (in `_load_snapshot_response_for_date`-area code and
  `load_corporate_comparison_snapshot_version`): replace `expected_return_spread,` with
  `market_implied_return, implied_return_spread, implied_return_refusal,`.
- **`_rows_to_response`:** replace `expected_return_spread=float(row["expected_return_spread"]),` with:

```python
            market_implied_return=_rounded_or_none(row["market_implied_return"]),
            implied_return_spread=_rounded_or_none(row["implied_return_spread"]),
            implied_return_refusal=row["implied_return_refusal"],
```

- **History aggregate:** replace the `AVG(CASE WHEN s.group_name != ? AND s.bridge_quality != 'missing' THEN s.expected_return_spread END) AS average_expected_return_spread,`
  line with
  `AVG(CASE WHEN s.group_name != ? THEN s.implied_return_spread END) AS average_implied_return_spread,`.
  A refused or pre-v3 row is NULL and SQL `AVG` skips it; a missing bridge is always
  refused. In the point builder, replace
  `average_expected_return_spread=_rounded_or_none(row["average_expected_return_spread"]),`
  with
  `average_implied_return_spread=_rounded_or_none(row["average_implied_return_spread"]),`.
- **Stock history `SELECT`:** replace `s.expected_return_spread,` with
  `s.implied_return_spread,`. In the builder, replace
  `expected_return_spread=round(float(row["expected_return_spread"] or 0.0), 2),` with
  `implied_return_spread=_rounded_or_none(row["implied_return_spread"]),`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `python -m pytest -q -p no:cacheprovider tests/api/test_corporate_comparison.py tests/core_finance`
Expected: PASS.

- [ ] **Step 5: Mutation matrix**

| Mutation | Test that must fail |
|---|---|
| the `INSERT` writes `row.implied_return_spread` into `market_implied_return` too (swap the first two values) | `test_a_v3_snapshot_stores_and_reloads_the_implied_return` |
| `_rows_to_response` uses `float(row["implied_return_spread"] or 0.0)` | `test_a_pre_v3_row_reloads_as_not_recorded_not_refused` |
| the aggregate uses `COALESCE(s.implied_return_spread, 0)` | `test_missing_rows_are_excluded_from_the_aggregates_but_estimated_rows_are_not` |
| the `db.py` migration loop deleted | `test_init_db_adds_the_implied_return_columns_to_an_existing_v3_table` |
| the stock history builder uses `round(float(... or 0.0), 2)` | `test_a_pre_v3_stock_history_point_is_null_not_zero` |

- [ ] **Step 6: Run the whole Python suite**

Run: `python -m pytest -q -p no:cacheprovider tests`
Expected: only the 16 known `exchange_calendars` environmental failures
(`tests/api/test_market_event*.py`, `tests/api/events/test_rules.py::test_the_real_nyse*`,
`tests/api/records_sync/test_routes.py::test_get_market_events_merges_a_peer_file` and
`::test_a_records_failure_does_not_break_a_page`). Any other failure is this task's to fix.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/db.py apps/api/services/corporate_comparison.py apps/api/models/schema_parts/corporate.py tests/api/test_corporate_comparison.py
git commit -m "feat(snapshots): metric v3 persists the implied return; history and stock history read it, pre-v3 reads null"
```

---

### Task 4: Shared types and the `/corporate` page

**Files:**
- Create: `apps/web/lib/impliedReturn.ts`
- Modify: `packages/shared-types/portfolio.ts`, `packages/shared-types/generated/portfolio.ts`
- Modify: `apps/web/tests/types/shared-types-contract.ts`
- Modify: `apps/web/app/corporate/corporateTypes.ts`,
  `apps/web/app/corporate/corporateDerivedViews.ts`,
  `apps/web/app/corporate/components/CorporateComparisonTable.tsx`,
  `apps/web/app/corporate/components/TargetStockComparisonSection.tsx`,
  `apps/web/app/corporate/page.tsx`
- Modify (fixtures): `apps/web/tests/e2e/helpers/corporatePageMock.ts`,
  `apps/web/tests/e2e/fixtures/shared.ts`
- Test: `apps/web/tests/e2e/corporate-comparison-bridge.spec.ts` (new tests appended),
  and `apps/web/tests/e2e/refresh-idle-state.spec.ts` where it names the old field

**Interfaces:**
- Consumes: the wire fields from Tasks 2 and 3.
- Produces:
  - `impliedReturnRefusalText(code: string | null): string` and
    `IMPLIED_RETURN_NOT_RECORDED: string`, both in `apps/web/lib/impliedReturn.ts`.
  - `ComparisonSortKey = "roic_minus_wacc" | "dcf_value" | "implied_return_spread"`.
  - `isComparisonSortKey(value: unknown): value is ComparisonSortKey`.

- [ ] **Step 1: Create the label module**

`apps/web/lib/impliedReturn.ts`:

```ts
/**
 * Reader wording for `implied_return_refusal` (packages/core_finance/expected_return.py,
 * IMPLIED_RETURN_REFUSAL_CODES). The backend owns the vocabulary: an unrecognised code is
 * shown as sent rather than hidden, so a code added there still reaches the reader.
 */
const REFUSAL_TEXT: Record<string, string> = {
  no_price: "No current price, so there is no market value to solve against.",
  bridge_unresolved: "Net debt or the share count is missing, so the market's enterprise value cannot be built.",
  non_positive_fcff: "Free cash flow is zero or negative over the forecast, so no discount rate prices it.",
  non_positive_market_ev: "Net cash exceeds the market value, so the market's enterprise value is not positive.",
  below_model_range: "The market pays more than this model can reach at any return above terminal growth + 0.5%.",
  above_model_range: "The implied return would exceed 1000% per year.",
};

/** A snapshot from before metric v3 recorded no implied return. Not a refusal. */
export const IMPLIED_RETURN_NOT_RECORDED = "Not recorded before metric v3.";

export function impliedReturnRefusalText(code: string | null): string {
  if (code === null) return IMPLIED_RETURN_NOT_RECORDED;
  return REFUSAL_TEXT[code] ?? code;
}
```

- [ ] **Step 2: Update the types and fixtures**

- **`packages/shared-types/portfolio.ts`:** in `CorporateComparisonHistoryPoint`, rename
  `average_expected_return_spread: number | null;` to
  `average_implied_return_spread: number | null;`, and update its comment with "also null
  before metric v3".
- **`packages/shared-types/generated/portfolio.ts`:**
  - Run `python scripts/export_schema.py`, then
    `npx json2ts packages/shared-types/generated/portfolio.schema.json > packages/shared-types/generated/portfolio.ts`
    from the repo root.
  - If `json2ts` is unavailable, edit the two occurrences by hand. Near line 135, replace
    `expected_return_spread: number;` with
    `market_implied_return?: number | null; implied_return_spread?: number | null; implied_return_refusal?: string | null;`.
    Near line 175, rename `average_expected_return_spread` to
    `average_implied_return_spread`. Say so in the commit message
    (`docs/architecture/schema-evolution.md:23`).
- **`apps/web/tests/types/shared-types-contract.ts`:** replace
  `const _spreadIsNullable: CorporateComparisonHistoryPoint["average_expected_return_spread"] = null;`
  with
  `const _spreadIsNullable: CorporateComparisonHistoryPoint["average_implied_return_spread"] = null;`.
- **`apps/web/app/corporate/corporateTypes.ts`:**
  - In `CorporateComparisonRowApi`, replace `expected_return_spread: number;` with:

    ```ts
      /** Percent per year; null when refused (see implied_return_refusal) or not recorded (pre-v3). */
      market_implied_return: number | null;
      /** market_implied_return - wacc, percentage points per year. */
      implied_return_spread: number | null;
      implied_return_refusal: string | null;
    ```
  - Replace the `ComparisonSortKey` line with:

    ```ts
    export const COMPARISON_SORT_KEYS = ["implied_return_spread", "roic_minus_wacc", "dcf_value"] as const;
    export type ComparisonSortKey = (typeof COMPARISON_SORT_KEYS)[number];
    export function isComparisonSortKey(value: unknown): value is ComparisonSortKey {
      return typeof value === "string" && (COMPARISON_SORT_KEYS as readonly string[]).includes(value);
    }
    ```
- **E2E fixtures:** in `apps/web/tests/e2e/helpers/corporatePageMock.ts` and
  `apps/web/tests/e2e/fixtures/shared.ts`, each row object has
  `expected_return_spread: X`. Replace each with
  `market_implied_return: X + 9.7, implied_return_spread: X, implied_return_refusal: null`.
  The one exception is the row whose `bridge_quality` is `"missing"` (`MISS`): it gets
  `market_implied_return: null, implied_return_spread: null, implied_return_refusal: "bridge_unresolved"`,
  because a missing bridge is always refused. In `shared.ts`, rename `average_expected_return_spread` to
  `average_implied_return_spread` (keep the values).

- [ ] **Step 3: Write the failing e2e tests**

Append these to `apps/web/tests/e2e/corporate-comparison-bridge.spec.ts`. That file
already has the `rowCell`, `gotoComparison`, `sortBy`, `tickerOrder` and
`selectSimilarComparison` helpers, and its fixture holds the `MISS` row, whose bridge is
missing. So no new spec file is created.

First, change the `sortBy` key type in that file to
`"dcf_value" | "roic_minus_wacc" | "implied_return_spread"`, and add
`"Implied return vs WACC (pts per year)"` wherever a test there reads the old `"Spread"`
header.

The fixture rule from Step 2 makes `MISS` (bridge `missing`) the one refused row:
`market_implied_return: null`, `implied_return_spread: null`,
`implied_return_refusal: "bridge_unresolved"`. `ESTM` has `implied_return_spread: 10.3`,
so its `market_implied_return` is `20.0`.

```ts
test("the table shows the implied return and its spread over WACC per year", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await expect(page.getByRole("columnheader", { name: "Market-implied return (per year)" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Implied return vs WACC (pts per year)" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "DCF value vs price (one-off gap)" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Spread", exact: true })).toHaveCount(0);
  await expect(rowCell(page, "ESTM", "Market-implied return (per year)")).toHaveText("20.00%");
  await expect(rowCell(page, "ESTM", "Implied return vs WACC (pts per year)")).toHaveText("10.30%");
});

test("a refused row shows a dash with its reason, and the spread chart says it has no bar", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  const cell = page.getByTestId("implied-return-spread-MISS");
  await expect(cell).toHaveText("—");
  await expect(cell).toHaveAttribute("title", /Net debt or the share count is missing/);
  await expect(rowCell(page, "MISS", "Market-implied return (per year)")).toHaveText("—");
  // AAPL shares MISS's sector, so MISS is in the Similar Stocks peer set.
  await selectSimilarComparison(page, "AAPL");
  await expect(page.getByTestId("similar-spread-refused-note")).toContainText("MISS");
});

test("refused rows sort last in both directions", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await sortBy(page, "implied_return_spread", "desc");
  const descending = await tickerOrder(page);
  expect(descending.at(-1)).toBe("MISS");
  await sortBy(page, "implied_return_spread", "asc");
  const ascending = await tickerOrder(page);
  expect(ascending.at(-1)).toBe("MISS");
  // The non-refused rows really did reverse, so the direction control took effect.
  expect(ascending.slice(0, -1)).toEqual(descending.slice(0, -1).reverse());
});

test("a stale saved sort key falls back to the default sort", async ({ page }) => {
  // Exactly what lib/tabState.ts writes: sessionStorage["moneyview.tab.corporate.sortKey"] = JSON.
  await page.addInitScript(() => {
    window.sessionStorage.setItem("moneyview.tab.corporate.sortKey", JSON.stringify("expected_return_spread"));
  });
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await expect(page.locator('select[aria-label="Sort by"]')).toHaveValue("implied_return_spread");
  const restored = await tickerOrder(page);
  await sortBy(page, "implied_return_spread", "desc");
  expect(restored).toEqual(await tickerOrder(page));
});
```

The last test assumes the default direction is `desc` (`page.tsx`'s `sortDirection`
default). If the sort-direction tab state is also restored from a previous test, the
`addInitScript` runs on a fresh context per test, so it is not.

Run: `cd apps/web && npx playwright test tests/e2e/corporate-comparison-bridge.spec.ts --reporter=line`
Expected: FAIL (the new headers are not found; no `implied-return-spread-MISS` testid).

- [ ] **Step 4: Implement the page**

- **`corporateDerivedViews.ts`, the sort** (the function containing
  `const delta = Number(left[sortKey]) - Number(right[sortKey]);`): before that line, add
  the same null-last rule `dcf_value` uses:

  ```ts
      if (sortKey === "implied_return_spread") {
        const leftValue = left.implied_return_spread;
        const rightValue = right.implied_return_spread;
        if (leftValue === null && rightValue === null) return 0;
        if (leftValue === null) return 1;
        if (rightValue === null) return -1;
        const spreadDelta = leftValue - rightValue;
        return sortDirection === "asc" ? spreadDelta : -spreadDelta;
      }
  ```
- **`corporateDerivedViews.ts`, `buildSimilarComparisonBarData`:** replace the
  `expected_return_spread` line with `implied_return_spread: row.implied_return_spread,`
  (null stays null; Recharts draws no bar for null).
- **`corporateDerivedViews.ts`, the two scatter builders:** replace
  `expected_return_spread: Number(row.expected_return_spread.toFixed(2)),` with
  `implied_return_spread: row.implied_return_spread,`, and replace the bubble sizes with
  `bubble_size: Math.max(Math.abs(row.implied_return_spread ?? 0) * 5, 80),` (peers) and
  `..., 120)` (selected).
- **`CorporateComparisonTable.tsx`:**
  - In `ComparisonTableRow`, replace `expected_return_spread: number;` with the three
    fields typed as in `corporateTypes.ts`.
  - Headers: `DCF Return` becomes `DCF value vs price (one-off gap)`. `Spread` is replaced
    by two headers, `Market-implied return (per year)` and
    `Implied return vs WACC (pts per year)`.
  - Cells: replace the spread `<td>` and its comment with:

  ```tsx
                {/* Annual rates on the same capital as WACC (spec 2026-09-26-implied-return-spread).
                    A null is a refusal or a pre-v3 snapshot; the title says which. */}
                <td className="px-4 py-3 text-right tabular-nums" title={row.market_implied_return === null ? impliedReturnRefusalText(row.implied_return_refusal) : undefined}>
                  {row.market_implied_return === null ? "—" : formatPct2(row.market_implied_return)}
                </td>
                <td
                  data-testid={`implied-return-spread-${row.ticker}`}
                  title={row.implied_return_spread === null ? impliedReturnRefusalText(row.implied_return_refusal) : undefined}
                  className={`px-4 py-3 text-right font-bold tabular-nums ${row.implied_return_spread === null ? "text-[var(--text-muted)]" : row.implied_return_spread >= 0 ? "text-[var(--delta-up)]" : "text-[var(--delta-down)]"}`}
                >
                  {row.implied_return_spread === null ? "—" : formatPct2(row.implied_return_spread)}
                </td>
  ```

  - Import `impliedReturnRefusalText` from `@/lib/impliedReturn`.
- **`TargetStockComparisonSection.tsx`:**
  - The sort option `<option value="expected_return_spread">Expected return spread</option>`
    becomes `<option value="implied_return_spread">Implied return vs WACC</option>`.
  - Every `"expected_return_spread"` `dataKey`/`name` becomes `"implied_return_spread"`, and
    every tooltip label "Expected return spread" becomes
    "Implied return vs WACC (pts per year)".
  - The scatter description sentence's "expected-return spread" becomes "implied return
    vs WACC".
  - Under the bar chart, add:

  ```tsx
                {similarComparisonBarData.some((row) => row.implied_return_spread === null) ? (
                  <p data-testid="similar-spread-refused-note" className="mt-2 text-xs text-[var(--text-muted)]">
                    No implied return for {similarComparisonBarData.filter((row) => row.implied_return_spread === null).map((row) => row.ticker).join(", ")}; shown without a spread bar.
                  </p>
                ) : null}
  ```

  - If the local `ComparisonSortKey` type (line 20) duplicates `corporateTypes.ts`, import
    it from there instead of redefining it.
- **`page.tsx`:** change the tab-state default to `"implied_return_spread"`, and validate
  the restored value:

  ```tsx
  const [storedSortKey, setComparisonSortKey] = useTabState<ComparisonSortKey>(
    tabStateKey("corporate", "sortKey"), "implied_return_spread");
  // A key saved before metric v3 ("expected_return_spread") names a field that no longer
  // exists; sorting by it would compare undefined with undefined.
  const comparisonSortKey: ComparisonSortKey = isComparisonSortKey(storedSortKey) ? storedSortKey : "implied_return_spread";
  ```

  Import `isComparisonSortKey` from `./corporateTypes`.
- **Existing specs:** in `corporate-comparison-bridge.spec.ts` and
  `refresh-idle-state.spec.ts`, replace each `expected_return_spread` in mock rows with
  the three new fields, as in Step 2. Replace each assertion on the text "Spread" or
  "Expected return spread" with the new label.

- [ ] **Step 5: Run the checks and confirm they pass**

Run, from `apps/web`: `npx tsc --noEmit -p .`, then
`npx eslint app/corporate lib/impliedReturn.ts tests/e2e/corporate-comparison-bridge.spec.ts`,
then
`npx playwright test tests/e2e/corporate-comparison-bridge.spec.ts tests/e2e/refresh-idle-state.spec.ts --reporter=line`.
Expected: tsc and eslint clean, and all specs pass.

- [ ] **Step 6: Mutation matrix**

Strip ANSI codes from Playwright output before reading it: pipe through
`sed 's/\x1b\[[0-9;]*m//g'`.

| Mutation | Spec that must fail |
|---|---|
| the null-last block removed from the sort | "refused rows sort last in both directions" |
| `isComparisonSortKey(storedSortKey) ? storedSortKey : ...` → `storedSortKey` | "a stale saved sort key falls back to the default sort" |
| the spread cell renders `formatPct2(row.implied_return_spread ?? 0)` | "a refused row shows a dash with its reason, and the spread chart says it has no bar" |
| `impliedReturnRefusalText` returns `""` for known codes | "a refused row shows a dash with its reason, and the spread chart says it has no bar" |
| the header text reverted to `Spread` | "the table shows the implied return and its spread over WACC per year" |

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/impliedReturn.ts packages/shared-types apps/web/tests/types/shared-types-contract.ts apps/web/app/corporate apps/web/tests/e2e/helpers/corporatePageMock.ts apps/web/tests/e2e/fixtures/shared.ts apps/web/tests/e2e/corporate-comparison-bridge.spec.ts apps/web/tests/e2e/refresh-idle-state.spec.ts
git commit -m "feat(corporate-ui): market-implied return and its spread over WACC replace the old spread"
```

---

### Task 5: Portfolio page and Snapshot History

**Files:**
- Modify: `apps/web/app/portfolio/page.tsx` (the row types near lines 160 and 205; table
  headers near line 492)
- Modify: `apps/web/app/portfolio/portfolioMetrics.ts` (`expectedVsMarket` near line 233;
  outlier list near line 254)
- Modify: `apps/web/app/portfolio/components/StockDetailModal.tsx` (lines 245-270, 315,
  320, 545, 557-564, 676)
- Modify: `apps/web/app/portfolio/components/SnapshotHistoryModal.tsx` (lines 121-131)
- Modify (fixtures): `apps/web/tests/e2e/helpers/portfolioPageMock.ts`
- Test: `apps/web/tests/e2e/snapshot-history-metric-version.spec.ts`,
  `apps/web/tests/e2e/portfolio-watchlist.spec.ts` (new tests appended to both)

**Interfaces:**
- Consumes: `impliedReturnRefusalText` and `IMPLIED_RETURN_NOT_RECORDED` from
  `apps/web/lib/impliedReturn.ts` (Task 4); the wire fields from Tasks 2 and 3.
- Produces: the `PortfolioComparisonMetrics` key `impliedVsWacc` (renamed from
  `expectedVsMarket`).

- [ ] **Step 1: Update the fixtures, then write the failing tests**

Fixtures, in `apps/web/tests/e2e/helpers/portfolioPageMock.ts`:
- In each comparison row, replace `expected_return_spread: X` with
  `market_implied_return: X + 9.7, implied_return_spread: X, implied_return_refusal: null`.
- In the `nullMetricTicker` mapping (near line 266), replace
  `expected_return_spread: null,` with
  `market_implied_return: null, implied_return_spread: null, implied_return_refusal: "no_price",`.
- In the stock-history handler (near line 555), replace
  `expected_return_spread: row?.expected_return_spread ?? 0,` with
  `implied_return_spread: row?.implied_return_spread ?? null,`.

In `apps/web/tests/e2e/snapshot-history-metric-version.spec.ts`:
- Add `average_implied_return_spread?: number | null;` to the `HistoryPointSeed` type.
- In `mockPortfolioHistory`, replace `average_expected_return_spread: 2.86,` with
  `average_implied_return_spread: seed.average_implied_return_spread === undefined ? 2.86 : seed.average_implied_return_spread,`.
- Then append:

```ts
test("the history modal marks a pre-v3 average as not recorded", async ({ page }) => {
  const recorded: HistoryPointSeed = {
    as_of_date: "2026-09-26", generated_at: "2026-09-26T09:00:00Z",
    metric_schema_version: 3, average_dcf_value: 160.0, average_implied_return_spread: 1.5,
  };
  const notRecorded: HistoryPointSeed = { ...NEW_DEFINITION, average_implied_return_spread: null };
  await mockPortfolioHistory(page, [recorded, notRecorded]);
  const dialog = await openSnapshotHistory(page);
  await expect(historyItem(dialog, recorded)).toContainText("1.50%");
  await expect(historyItem(dialog, notRecorded)).toContainText("Not recorded before metric v3.");
  await expect(historyItem(dialog, notRecorded)).not.toContainText("Not available");
});
```

Append to `apps/web/tests/e2e/portfolio-watchlist.spec.ts`, which already has the
`gotoPortfolio`, `clearAllHoldings`, `addHolding` and `refreshPortfolioAnalysis` helpers.
Add `import { API_PREFIX, json } from "./helpers/mockUtils";` at the top if it is absent.

```ts
test("the holdings table shows implied return vs WACC, and a refused row says why", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { nullMetricTicker: "MSFT" });
  await gotoPortfolio(page);
  await refreshPortfolioAnalysis(page);
  await openPortfolioPanel(page, "holdings");
  await expect(page.getByRole("columnheader", { name: "Implied return vs WACC (pts per year)" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "DCF value vs price (one-off gap)" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Expected vs Market" })).toHaveCount(0);
  const msft = page.locator("tr", { hasText: "MSFT" }).first();
  await expect(msft.locator('[title*="No current price"]')).toHaveCount(1);
});

test("the trend delta is not taken across a snapshot that recorded no implied return", async ({ page }) => {
  await mockPortfolioPageApi(page);
  // Registered after the catch-all so it wins (Playwright matches in reverse order).
  await page.route(
    (url) => url.pathname === `${API_PREFIX}/corporate/comparison/stock-history`,
    (route) => json(route, {
      status: "ok",
      data: {
        ticker: "AAPL", comparison_universe: "portfolio_plus_benchmark", benchmark_ticker: "^GSPC", custom_tickers: [],
        points: [
          { as_of_date: "2026-09-26", generated_at: "2026-09-26T09:00:00Z", snapshot_version: "v3", snapshot_source: "manual",
            benchmark_ticker: "^GSPC", current_price: 210, roic_minus_wacc: 8, dcf_implied_return: 12, implied_return_spread: 2.0, market_expected_return: 9.7 },
          { as_of_date: "2026-08-03", generated_at: "2026-08-03T09:00:00Z", snapshot_version: "v2", snapshot_source: "manual",
            benchmark_ticker: "^GSPC", current_price: 200, roic_minus_wacc: 8, dcf_implied_return: 10, implied_return_spread: null, market_expected_return: 9.7 },
        ],
      },
    }),
  );
  await clearAllHoldings(page);
  await addHolding(page, "AAPL", "Apple Inc.", "Technology");
  await refreshPortfolioAnalysis(page);
  await openPortfolioPanel(page, "holdings");
  await page.locator('[role="button"]').filter({ hasText: "Apple Inc." }).first().click();
  const delta = portfolioModal(page).getByTestId("implied-spread-trend-delta");
  await expect(delta).toBeVisible();
  await expect(delta).not.toHaveText("2.00%");
  await expect(delta).toHaveText("N/A");
});
```

`formatMetricPercent(null)` returns `"N/A"` (`app/portfolio/page.tsx:589`). Step 2 adds
`data-testid="implied-spread-trend-delta"` to the trend card's value element.

Run: `cd apps/web && npx playwright test tests/e2e/portfolio-watchlist.spec.ts tests/e2e/snapshot-history-metric-version.spec.ts --reporter=line`
Expected: the three new tests FAIL.

- [ ] **Step 2: Implement**

- **`page.tsx`:**
  - In both row types, replace `expected_return_spread: number;` with
    `market_implied_return: number | null; implied_return_spread: number | null; implied_return_refusal: string | null;`
    (and `implied_return_spread: number | null;` in the stock-history point type).
  - Header `DCF Upside` becomes `DCF value vs price (one-off gap)`, and
    `Expected vs Market` becomes `Implied return vs WACC (pts per year)`.
  - Rename every `expectedVsMarket` to `impliedVsWacc` (lines 533, 649, 1567, 1571, 1575,
    1576, 1584).
- **`portfolioMetrics.ts`:**
  - Rename the key `expectedVsMarket` to `impliedVsWacc` in the type (line 27) and in the
    builder.
  - The builder reads `row.implied_return_spread`, with
    `missingReason: impliedReturnRefusalText(row.implied_return_refusal)` and
    `suspiciousReason: "Implied return vs WACC falls outside the sanity range and is excluded from ranking."`.
  - In the outlier list, replace `row?.expected_return_spread` with
    `row?.implied_return_spread`.
  - The `dcfUpside` reasons' text "DCF upside" becomes "DCF value vs price". Keep the key
    name `dcfUpside`: it is internal.
- **`StockDetailModal.tsx`:**
  - Rename `expectedVsMarket` to `impliedVsWacc` throughout.
  - Labels: `DCF Upside` → `DCF value vs price (one-off gap)`, and `Expected vs Market` →
    `Implied return vs WACC (pts per year)`.
  - The subtitle fallback at line 564 becomes
    `"The annual return today's market price implies for the whole business, minus its WACC, from the saved comparison snapshot."`.
  - The timeline metric reads `point.implied_return_spread`, with
    `missingReason: IMPLIED_RETURN_NOT_RECORDED`.
  - The "Expected Spread Trend" card: its title becomes "Implied return vs WACC trend", its
    caption becomes "Latest versus oldest saved implied return vs WACC, only between
    snapshots that recorded it.", and its value `<div>` gets
    `data-testid="implied-spread-trend-delta"`.
  - Replace the trend delta:

  ```tsx
  // Only between two points that both recorded it: a pre-v3 point has no implied return,
  // and subtracting across that boundary would compare two different quantities.
  const expectedSpreadTrendDelta = latestSnapshotTrendPoint?.implied_return_spread != null
    && earliestSnapshotTrendPoint?.implied_return_spread != null
    ? latestSnapshotTrendPoint.implied_return_spread - earliestSnapshotTrendPoint.implied_return_spread
    : null;
  ```
- **`SnapshotHistoryModal.tsx`:** the label `Avg Spread` becomes
  `Avg implied return vs WACC`. Read `point.average_implied_return_spread`. When it is
  `null` and `point.metric_schema_version < 3`, render
  `{IMPLIED_RETURN_NOT_RECORDED}`. When it is `null` at v3, keep the existing
  `Not available` with `NO_BRIDGED_ROWS_TITLE`.

- [ ] **Step 3: Run the checks and confirm they pass**

Run, from `apps/web`: `npx tsc --noEmit -p .`, then `npx eslint app/portfolio`, then
`npx playwright test tests/e2e/portfolio-watchlist.spec.ts tests/e2e/snapshot-history-metric-version.spec.ts --reporter=line`.
Expected: clean, and all pass.

- [ ] **Step 4: Mutation matrix**

| Mutation | Spec that must fail |
|---|---|
| the trend delta computed with `?? 0` on both points | "the trend delta is not taken across a snapshot that recorded no implied return" |
| the SnapshotHistoryModal v<3 branch removed (always "Not available") | "the history modal marks a pre-v3 average as not recorded" |
| `missingReason` reverted to a fixed string | "the holdings table shows implied return vs WACC, and a refused row says why" |

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/portfolio apps/web/tests/e2e/helpers/portfolioPageMock.ts apps/web/tests/e2e/snapshot-history-metric-version.spec.ts apps/web/tests/e2e/portfolio-watchlist.spec.ts
git commit -m "feat(portfolio-ui): implied return vs WACC replaces Expected vs Market; no trend delta across metric v3"
```

---

### Task 6: Records, the final grep, the full runs

**Files:**
- Modify: `docs/metrics/discount-rates-and-returns.md`, `docs/metrics/inventory.md`,
  `docs/metrics/README.md` (if it lists the metric), `docs/architecture/moneyview-quant-engine.md:501`
- Modify: `ERROR-LOG.md`, `guideline/sop/todo.md`

- [ ] **Step 1: Update the metric doc**

In `docs/metrics/discount-rates-and-returns.md`, replace the whole
`### expected_return_spread` section with two sections, `### market_implied_return` and
`### implied_return_spread`. Keep the file's existing entry shape: Source / What it is /
Why this metric / How it is calculated here / What it affects / Where it is shown / How to
read it / Common misreading / Current state. Content, taken from the spec:
- **Formula:** the solver target (§2.3), the market EV bridge (§2.2), and the six ordered
  refusal codes (§2.4).
- **Unit:** percent per year, and percentage points per year.
- **Misreading:** it is not `dcf_implied_return`. That is a one-off gap; this is a rate.
- **Retired column:** `expected_return_spread` stays as a SQLite column for history, is
  written as its `0.0` default from metric v3 on, and is read by nothing.

In `dcf_implied_return`'s entry, replace the sentence naming `expected_return_spread` as
derived from it with one naming the retirement and pointing to the new entries.

In `docs/metrics/inventory.md` and `moneyview-quant-engine.md`, replace the
`expected_return_spread` row/line with `market_implied_return` / `implied_return_spread`
and their `expected_return.py` sources.

- [ ] **Step 2: Add the ERROR-LOG entry**

Follow the template at the top of `ERROR-LOG.md`. Append; never rewrite existing entries.

- **Date:** 2026-09-26.
- **Command:** `/corporate` comparison table, Spread column; Portfolio "Expected vs Market".
- **Failure:** the spread subtracted an annual rate (`rf + ERP`) from a one-off gap
  (`value / price − 1`). A stock 9.7% below value read as "in line with the market".
  Measured range: −225 to over 6,550,000.
- **Root cause:** the units were never stated on either input, and the name
  "expected return" was used for both.
- **Fix:** the market-implied return (IRR) against WACC, with refusal codes; metric v3.
- **Files changed:** list them from `git diff --stat renewal...HEAD`.
- **Prevention:** a metric that subtracts two returns states both units in its doc entry;
  the sign invariant test pins this one.

- [ ] **Step 3: Close the todo item**

In `guideline/sop/todo.md`, rewrite the Track E line so that the annual-vs-horizonless
conflation is marked FIXED 2026-09-26 (implied return vs WACC, metric v3, spec path).
Snapshot identity and history charts stay listed as deferred.

- [ ] **Step 4: The final grep**

Run from the repo root:
`git grep -n "expected_return_spread" -- . ":(exclude)docs/superpowers" ":(exclude)ERROR-LOG.md" ":(exclude)guideline/sop/todo*.md"`

Every remaining hit must be one of:
- `apps/api/services/db.py`: column definitions, legacy table DDL and migration `INSERT`s;
- the migration tests in `tests/api/test_corporate_comparison.py` that build legacy tables
  or insert legacy-shaped rows;
- `docs/metrics/discount-rates-and-returns.md`'s retired-column note.

Anything else is a leftover reader: fix it, and rerun that task's tests.

- [ ] **Step 5: The full runs**

- `python -m pytest -q -p no:cacheprovider tests`: expect only the 16 known environmental
  failures.
- From `apps/web`: `npx tsc --noEmit -p .` and `npx eslint .`.
- From `apps/web`: the full Playwright suite,
  `npx playwright test --reporter=line 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -5`.
  Expect 0 failed. If a run is stopped, kill the node process tree and the :8110/:3101
  servers before rerunning.

- [ ] **Step 6: Commit**

```bash
git add docs/metrics docs/architecture/moneyview-quant-engine.md ERROR-LOG.md guideline/sop/todo.md
git commit -m "docs: implied return replaces the annual-vs-horizonless spread; ERROR-LOG entry; todo closed"
```
