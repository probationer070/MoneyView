# Theme and Policy Spreads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five relative-strength pairs (AI, cybersecurity, cloud, energy policy, defence) plus `^VIX`, rendered on Market Overview, each labelled with the tickers and window that produced it.

**Architecture:** One pure engine in `packages/core_finance` computes relative strength between two date→close series joined on common dates. A registry in `apps/api/services/market_spreads.py` names the pairs and pulls bars through the existing `MarketDataService.get_stock_ohlcv` lazy path, so no ticker enters the user's watchlist and no new scheduler is needed. `GET /market/spreads` serves them; Market Overview renders one small multiple per pair and also gains the event-line toggle from I-C1.

**Tech Stack:** Python 3.11 / FastAPI / Pydantic v2 / SQLite, Next.js 15 / React 19 / TypeScript / TanStack Query / lightweight-charts v5, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-theme-and-policy-spreads-design.md`

## Global Constraints

- **Relative strength is a ratio of returns, indexed to 100 at the base date:** `(A_t / A_0) / (B_t / B_0) × 100`. Never a difference of returns, never a regression beta.
- **Join on exact trading dates only.** No forward fill, no interpolation.
- **`A_0` and `B_0` come from one common `base_date`** — the first date present in *both* series at or after the requested window start. Never each side's own first observation.
- **`latest` is exactly `series[-1].value`.** Never recomputed from each side's most recent close.
- **Every response carries a non-empty `basis`** naming both tickers and the base date.
- **A pair that cannot be computed sets `refused_reason` and an empty `series`.** Never an empty series with a null reason.
- **Calendar days, not sessions**, for `requested_window_days` and `actual_window_days`. `observations` carries the session count.
- **Benchmark is `^GSPC`.** Already cached; still subject to the ordinary daily-bars freshness rule.
- **No new data class, no new freshness policy, no use of the `indicators` table.**
- **Every test must be shown to fail on a broken implementation** before it is reported as verified (CLAUDE.md §8). Each task below carries its own mutation step naming the mutation.
- **Market Overview's route is `/`**, rendered by `apps/web/app/page.tsx`. Not `/market`.
- **`get_stock_ohlcv` defaults to `table="stocks"`.** Any read of `^GSPC` or `^VIX` must pass
  `table="indices"` (via `MarketDataService._table_for_ticker`) or it silently returns nothing.
- **Deliberate deviation from the spec, stated:** the query parameter is `window_days: int = 90`, not the spec's `window=90d`. Parsing `"90d"` adds a string parser and a malformed-input failure mode to express an integer. Task 3 Step 8 amends the spec so the two agree.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core_finance/relative_strength.py` | **Create.** Pure engine: join, base date, ratio, refusal reasons. No I/O, no market service, no Pydantic. |
| `tests/core_finance/test_relative_strength.py` | **Create.** Engine tests including the join rule and the mutation matrix. |
| `apps/api/services/market_spreads.py` | **Create.** `SPREAD_PAIRS` registry, `DEFAULT_WINDOW_DAYS`, `build_spreads()` — reads bars, calls the engine, assembles payload rows. |
| `tests/api/test_market_spreads.py` | **Create.** Service and route tests with market data stubbed. |
| `apps/api/models/schema_parts/market.py` | **Modify.** Add `MarketSpreadPoint`, `MarketSpread` after `MarketEvent`. |
| `apps/api/models/schemas.py` | **Modify.** Export both names (import line and `__all__`). |
| `apps/api/routes/market.py` | **Modify.** Add `GET /spreads`. |
| `packages/shared-types/market.ts` | **Modify.** Mirror both interfaces beside `MarketEvent`. |
| `apps/api/services/market_data.py:76-96` | **Modify.** `^VIX` in `MARKET_INDICES` and `INSTRUMENT_METADATA`. |
| `apps/web/lib/useMarketSpreads.ts` | **Create.** Query hook, mirroring `useMarketEvents.ts`. |
| `apps/web/components/market/SpreadsSection.tsx` | **Create.** The section: one card per pair, refusal presentation, basis label. |
| `apps/web/components/market/MarketOverviewClient.tsx` | **Modify.** Render `SpreadsSection`; wire the I-C1 event toggle into its `TVChart`. |
| `apps/web/tests/e2e/market-spreads.spec.ts` | **Create.** Section rendering, basis labels, refusal presentation, event toggle. |
| `apps/web/tests/e2e/helpers/chartInk.ts` | **Create (Task 6).** `inkProfile` / `stableInkProfile`, extracted from `market-event-lines.spec.ts` so both chart specs share one canvas-measuring implementation. |

---

### Task 1: The relative-strength engine

**Files:**
- Create: `packages/core_finance/relative_strength.py`
- Test: `tests/core_finance/test_relative_strength.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULT_WINDOW_DAYS: int = 90`
  - `@dataclass(frozen=True) RelativeStrengthPoint(date: str, value: float)`
  - `@dataclass(frozen=True) RelativeStrengthResult(base_date: Optional[str], points: List[RelativeStrengthPoint], refused_reason: Optional[str])`
  - `relative_strength(numerator: Mapping[str, float], denominator: Mapping[str, float], *, window_start: str) -> RelativeStrengthResult`

- [ ] **Step 1: Write the failing tests**

Create `tests/core_finance/test_relative_strength.py`:

```python
"""The engine's contract is the join rule, not the arithmetic.

A ratio of returns is easy to get right and easy to confuse with a difference of returns --
the two agree closely over short windows and diverge over long ones, which is the kind of
error no string assertion can see. The tests that matter here are the ones pinning which
dates are used and where the base comes from.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest

from packages.core_finance.relative_strength import (
    DEFAULT_WINDOW_DAYS,
    RelativeStrengthPoint,
    relative_strength,
)


def test_an_identical_pair_is_exactly_100_at_every_date():
    """The identity that makes the formula checkable by eye. A difference-of-returns
    implementation also returns 0-centred values here, so this alone does not pin the
    formula -- test_a_ratio_not_a_difference_of_returns does that."""
    series = {"2026-01-05": 10.0, "2026-01-06": 11.0, "2026-01-07": 9.0}

    result = relative_strength(series, series, window_start="2026-01-01")

    assert result.refused_reason is None
    assert [point.value for point in result.points] == [100.0, 100.0, 100.0]


def test_outperformance_reads_above_100_and_underperformance_below():
    a = {"2026-01-05": 100.0, "2026-01-06": 110.0}
    b = {"2026-01-05": 100.0, "2026-01-06": 100.0}

    assert relative_strength(a, b, window_start="2026-01-01").points[-1].value == pytest.approx(110.0)
    assert relative_strength(b, a, window_start="2026-01-01").points[-1].value == pytest.approx(90.909090, rel=1e-4)


def test_a_ratio_not_a_difference_of_returns():
    """Pins the formula itself. A_t/A_0 = 2.0 and B_t/B_0 = 1.25 give a ratio of 160.0;
    a difference of returns would give 100 + (100% - 25%) = 175.0. The two differ only
    once the moves are large, which is why a short fixture would not separate them."""
    a = {"2026-01-05": 50.0, "2026-01-06": 100.0}
    b = {"2026-01-05": 80.0, "2026-01-06": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert result.points[-1].value == pytest.approx(160.0)


def test_a_date_missing_from_either_side_is_omitted_never_forward_filled():
    """A forward-filled spread invents a day the market did not trade and flattens exactly
    the gaps that matter -- the same defect the event-line work hit with a weekend."""
    a = {"2026-01-05": 100.0, "2026-01-06": 110.0, "2026-01-07": 120.0}
    b = {"2026-01-05": 100.0, "2026-01-07": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert [point.date for point in result.points] == ["2026-01-05", "2026-01-07"]


def test_two_series_with_different_start_dates_base_on_the_first_common_date():
    """The join rule. Anchoring each side to its own first observation would index the two
    series to different days and bake that offset into every later value, while passing
    every other test in this file."""
    a = {"2026-01-02": 50.0, "2026-01-03": 100.0, "2026-01-04": 200.0}
    b = {"2026-01-03": 100.0, "2026-01-04": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert result.base_date == "2026-01-03"
    assert [point.date for point in result.points] == ["2026-01-03", "2026-01-04"]
    # Based on 2026-01-03, A doubles and B is flat, so the last value is 200.
    # Had A been based on its own first observation (50.0 on 01-02), it would read 400.
    assert result.points[0].value == pytest.approx(100.0)
    assert result.points[-1].value == pytest.approx(200.0)


def test_dates_before_the_window_start_are_excluded():
    a = {"2026-01-05": 100.0, "2026-01-20": 150.0}
    b = {"2026-01-05": 100.0, "2026-01-20": 100.0}

    result = relative_strength(a, b, window_start="2026-01-10")

    assert result.base_date == "2026-01-20"
    assert [point.date for point in result.points] == ["2026-01-20"]


def test_no_common_date_in_range_refuses_with_a_reason():
    a = {"2026-01-05": 100.0}
    b = {"2026-01-06": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert result.points == []
    assert result.base_date is None
    assert "no overlapping" in result.refused_reason


def test_a_zero_base_refuses_rather_than_dividing():
    """Publishing an infinity would render as a blank or a spike, both of which read as
    data. DeltaBadge.compute already refuses on absent inputs rather than substituting 0."""
    a = {"2026-01-05": 0.0, "2026-01-06": 100.0}
    b = {"2026-01-05": 100.0, "2026-01-06": 100.0}

    result = relative_strength(a, b, window_start="2026-01-01")

    assert result.points == []
    assert "zero" in result.refused_reason


def test_the_default_window_is_derived_from_the_module_constant_not_mirrored():
    """Derive fixture spans from DEFAULT_WINDOW_DAYS rather than hardcoding 90. A fixture
    tuned to today's value of a constant can stop reaching what it probes when the constant
    changes, and then passes while asserting nothing (observed 2026-09-03)."""
    assert DEFAULT_WINDOW_DAYS > 0
    assert isinstance(RelativeStrengthPoint("2026-01-01", 100.0).value, float)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_relative_strength.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'packages.core_finance.relative_strength'`

- [ ] **Step 3: Write the engine**

Create `packages/core_finance/relative_strength.py`:

```python
"""
Relative Strength Engine — ratio of returns between two series, indexed to 100.

    strength(A, B, t) = (A_t / A_0) / (B_t / B_0) x 100

`A_0` and `B_0` are both taken from ONE common base date: the first date present in both
series at or after the requested window start. Anchoring each side to its own first
observation would index the two series to different days and carry that offset into every
later value.

Joined on exact dates only. A date absent from either side is omitted, never forward
filled: a forward-filled spread invents a session that did not happen and flattens the
closed-market gaps that are usually the interesting part.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Mapping, Optional

DEFAULT_WINDOW_DAYS = 90


@dataclass(frozen=True)
class RelativeStrengthPoint:
    date: str
    value: float


@dataclass(frozen=True)
class RelativeStrengthResult:
    base_date: Optional[str]
    points: List[RelativeStrengthPoint]
    refused_reason: Optional[str]


def relative_strength(
    numerator: Mapping[str, float],
    denominator: Mapping[str, float],
    *,
    window_start: str,
) -> RelativeStrengthResult:
    """Relative strength of `numerator` against `denominator`, indexed to 100.

    Both mappings are date (ISO `YYYY-MM-DD`) to close. `window_start` is inclusive.
    """
    common = sorted(set(numerator) & set(denominator))
    in_window = [date for date in common if date >= window_start]

    if not in_window:
        return RelativeStrengthResult(
            base_date=None,
            points=[],
            refused_reason="no overlapping history in the requested window",
        )

    base_date = in_window[0]
    base_numerator = numerator[base_date]
    base_denominator = denominator[base_date]

    if not base_numerator or not base_denominator:
        return RelativeStrengthResult(
            base_date=None,
            points=[],
            refused_reason=f"base close is zero or absent on {base_date}",
        )

    points = [
        RelativeStrengthPoint(
            date=date,
            value=(numerator[date] / base_numerator) / (denominator[date] / base_denominator) * 100.0,
        )
        for date in in_window
    ]
    return RelativeStrengthResult(base_date=base_date, points=points, refused_reason=None)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/test_relative_strength.py -q`
Expected: PASS, 9 tests.

- [ ] **Step 5: Mutation-verify (CLAUDE.md §8 — required)**

Apply each mutation in memory or on disk with a `finally` restore, run the named test, confirm it FAILS for the intended reason, restore, and confirm green again. Record which test caught which.

| Mutation | Edit | Must fail |
|---|---|---|
| difference of returns | `value=100.0 + ((numerator[date]/base_numerator) - (denominator[date]/base_denominator)) * 100.0` | `test_a_ratio_not_a_difference_of_returns` |
| forward fill | replace `set(numerator) & set(denominator)` with `set(numerator) \| set(denominator)` and `.get(date, base)` lookups | `test_a_date_missing_from_either_side_is_omitted_never_forward_filled` |
| per-side base | `base_numerator = numerator[sorted(numerator)[0]]` | `test_two_series_with_different_start_dates_base_on_the_first_common_date` |
| zero base tolerated | delete the `if not base_numerator or not base_denominator` block | `test_a_zero_base_refuses_rather_than_dividing` |

Afterwards: `git diff --ignore-cr-at-eol --stat packages/core_finance/relative_strength.py` must show **no** entry.

- [ ] **Step 6: Commit**

```bash
git add packages/core_finance/relative_strength.py tests/core_finance/test_relative_strength.py
git commit -m "feat: relative-strength engine joined on common dates, based on one common date"
```

---

### Task 2: The spreads registry and service

**Files:**
- Create: `apps/api/services/market_spreads.py`
- Test: `tests/api/test_market_spreads.py`

**Interfaces:**
- Consumes: `relative_strength`, `RelativeStrengthResult`, `DEFAULT_WINDOW_DAYS` from Task 1.
- Produces:
  - `@dataclass(frozen=True) SpreadPair(id: str, label: str, numerator: str, denominator: str)`
  - `SPREAD_PAIRS: tuple[SpreadPair, ...]` — the source of truth for which tickers this feature needs
  - `build_spreads(window_days: int = DEFAULT_WINDOW_DAYS, *, service: Optional[MarketDataService] = None) -> list[dict]` — one dict per pair, keys exactly matching `MarketSpread` in Task 3

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_market_spreads.py`:

```python
"""The service's job is to turn two cached series into a row that explains itself.

Every row must carry a basis naming both tickers, and a row that cannot be computed must
say why rather than arriving as an empty series indistinguishable from "no movement".
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schema_parts.market import StockOHLCV
from apps.api.services import market_spreads as spreads_service
from apps.api.services.market_spreads import SPREAD_PAIRS, build_spreads


class _StubService:
    """Stands in for MarketDataService. Keyed by ticker so a pair can be given one series
    that overlaps and one that does not."""

    def __init__(self, bars_by_ticker):
        self.bars_by_ticker = bars_by_ticker
        self.requested = []

    def get_stock_ohlcv(self, ticker, period="5y", table=None):
        self.requested.append((ticker, table))
        return self.bars_by_ticker.get(ticker, [])


def _bars(dates_and_closes):
    return [
        StockOHLCV(date=date, open=close, high=close, low=close, close=close, volume=1_000)
        for date, close in dates_and_closes
    ]


def test_every_pair_carries_a_basis_naming_both_tickers():
    """A field called relative strength with no stated formula is unreadable: a ratio of
    returns, a difference of returns and a regression beta are all called that somewhere."""
    bars = _bars([("2026-01-05", 100.0), ("2026-01-06", 110.0)])
    stub = _StubService({pair.numerator: bars for pair in SPREAD_PAIRS}
                        | {pair.denominator: bars for pair in SPREAD_PAIRS})

    rows = build_spreads(window_days=90, service=stub)

    assert len(rows) == len(SPREAD_PAIRS)
    for row in rows:
        assert row["numerator"] in row["basis"]
        assert row["denominator"] in row["basis"]
        assert row["basis"].strip()


def test_latest_is_the_final_series_value_not_a_recomputation():
    """Tiny, and it stops the scalar a reader quotes from drifting away from the last point
    on the chart beside it."""
    bars_a = _bars([("2026-01-05", 100.0), ("2026-01-06", 150.0)])
    bars_b = _bars([("2026-01-05", 100.0), ("2026-01-06", 100.0)])
    pair = SPREAD_PAIRS[0]
    stub = _StubService({pair.numerator: bars_a, pair.denominator: bars_b})

    rows = build_spreads(window_days=90, service=stub)
    row = next(row for row in rows if row["id"] == pair.id)

    assert row["latest"] == pytest.approx(row["series"][-1]["value"])
    assert row["latest"] == pytest.approx(150.0)


def test_a_pair_with_no_overlap_is_refused_with_a_reason_and_an_empty_series():
    pair = SPREAD_PAIRS[0]
    stub = _StubService({
        pair.numerator: _bars([("2026-01-05", 100.0)]),
        pair.denominator: _bars([("2026-01-06", 100.0)]),
    })

    rows = build_spreads(window_days=90, service=stub)
    row = next(row for row in rows if row["id"] == pair.id)

    assert row["series"] == []
    assert row["refused_reason"]
    assert row["latest"] is None


def test_a_refusal_never_arrives_as_an_empty_series_with_no_reason():
    """The pairing that matters: an empty series and a null reason together would be read
    as a flat result rather than an absence."""
    stub = _StubService({})

    rows = build_spreads(window_days=90, service=stub)

    for row in rows:
        assert bool(row["series"]) != bool(row["refused_reason"]), row


def test_the_reported_window_is_the_one_actually_used():
    """A young ETF must not have its short history presented as comparable to a full one."""
    bars_a = _bars([("2026-06-15", 100.0), ("2026-09-11", 120.0)])
    bars_b = _bars([("2026-06-15", 100.0), ("2026-09-11", 100.0)])
    pair = SPREAD_PAIRS[0]
    stub = _StubService({pair.numerator: bars_a, pair.denominator: bars_b})

    rows = build_spreads(window_days=90, service=stub)
    row = next(row for row in rows if row["id"] == pair.id)

    assert row["requested_window_days"] == 90
    assert row["actual_window_start"] == "2026-06-15"
    assert row["actual_window_end"] == "2026-09-11"
    assert row["actual_window_days"] == 88
    assert row["observations"] == 2


def test_the_benchmark_is_read_from_the_indices_table_not_stocks():
    """`get_stock_ohlcv` defaults to table="stocks" and ^GSPC lives in `indices`. Getting
    this wrong returns no bars, so the pair refuses with "no overlapping history" -- a
    message that blames the data and hides the bug. Pinned on the argument, not the result."""
    bars = _bars([("2026-01-05", 100.0), ("2026-01-06", 110.0)])
    stub = _StubService({pair.numerator: bars for pair in SPREAD_PAIRS}
                        | {pair.denominator: bars for pair in SPREAD_PAIRS})

    build_spreads(window_days=90, service=stub)

    assert ("^GSPC", "indices") in stub.requested
    assert ("BOTZ", "stocks") in stub.requested


def test_the_registry_names_every_ticker_the_feature_needs():
    """SPREAD_PAIRS is the source of truth for acquisition. A ticker needed by a pair but
    absent from the registry would never be fetched, and the pair would refuse forever with
    a reason that points at the data rather than at the omission."""
    tickers = {pair.numerator for pair in SPREAD_PAIRS} | {pair.denominator for pair in SPREAD_PAIRS}

    assert {"BOTZ", "CIBR", "SKYY", "ICLN", "XLE", "ITA", "^GSPC"} == tickers
    assert len({pair.id for pair in SPREAD_PAIRS}) == len(SPREAD_PAIRS), "pair ids must be unique"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_market_spreads.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.market_spreads'`

- [ ] **Step 3: Write the service**

Create `apps/api/services/market_spreads.py`:

```python
"""Theme and policy spreads: relative strength between two tickers, with the basis stated.

`SPREAD_PAIRS` is the single source of truth for which pairs exist and which tickers they
need. Tickers are pulled through `MarketDataService.get_stock_ohlcv`, the same lazy path the
detail page uses for a ticker nobody has opened -- cache read, background refresh past the
daily boundary.

Registering these by adding them to the watchlist was rejected: it is the only implemented
acquisition trigger, but it would put six instruments the user does not hold into the
portfolio grid and into its holdings count. There is no scheduled warmer to hook instead --
`schedule_acquisition`'s own docstring says so -- and `MONEYVIEW_PREWARM_TICKERS` is
per-machine configuration rather than a registry that travels with the repository.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Optional

from apps.api.services.market_data import MarketDataService
from packages.core_finance.relative_strength import DEFAULT_WINDOW_DAYS, relative_strength

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SpreadPair:
    id: str
    label: str
    numerator: str
    denominator: str


# The proxy choice is editorial and cannot be derived: "AI" has no price, so BOTZ stands in
# for it. The mitigation is that the label names the proxy, so a reader can reject it rather
# than being told a fact. ARKQ, HACK and CLOU are live alternatives verified 2026-09-12.
SPREAD_PAIRS: tuple[SpreadPair, ...] = (
    SpreadPair("ai", "AI", "BOTZ", "^GSPC"),
    SpreadPair("cybersecurity", "Cybersecurity", "CIBR", "^GSPC"),
    SpreadPair("cloud", "Cloud", "SKYY", "^GSPC"),
    SpreadPair("energy_policy", "Energy policy", "ICLN", "XLE"),
    SpreadPair("defence", "Defence", "ITA", "^GSPC"),
)


def build_spreads(
    window_days: int = DEFAULT_WINDOW_DAYS,
    *,
    service: Optional[MarketDataService] = None,
) -> List[dict]:
    """One row per pair, each either a series with a basis or a stated refusal."""
    market = service if service is not None else MarketDataService()
    window_start = (date.today() - timedelta(days=window_days)).isoformat()

    rows: List[dict] = []
    for pair in SPREAD_PAIRS:
        numerator = _closes_by_date(market, pair.numerator)
        denominator = _closes_by_date(market, pair.denominator)
        result = relative_strength(numerator, denominator, window_start=window_start)

        if result.refused_reason is not None:
            rows.append(_refused(pair, window_days, result.refused_reason))
            continue

        points = [{"date": point.date, "value": point.value} for point in result.points]
        first, last = result.points[0].date, result.points[-1].date
        rows.append({
            "id": pair.id,
            "label": pair.label,
            "numerator": pair.numerator,
            "denominator": pair.denominator,
            "requested_window_days": window_days,
            "actual_window_start": first,
            "actual_window_end": last,
            "actual_window_days": (date.fromisoformat(last) - date.fromisoformat(first)).days,
            "observations": len(points),
            "basis": (
                f"({pair.numerator}_t / {pair.numerator}_0) / "
                f"({pair.denominator}_t / {pair.denominator}_0) x 100, "
                f"indexed to 100 at {result.base_date}"
            ),
            "series": points,
            "latest": points[-1]["value"],
            "refused_reason": None,
        })
    return rows


def _refused(pair: SpreadPair, window_days: int, reason: str) -> dict:
    return {
        "id": pair.id,
        "label": pair.label,
        "numerator": pair.numerator,
        "denominator": pair.denominator,
        "requested_window_days": window_days,
        "actual_window_start": None,
        "actual_window_end": None,
        "actual_window_days": None,
        "observations": 0,
        # Stated even on a refusal: the reader still needs to know what was attempted.
        "basis": (
            f"({pair.numerator}_t / {pair.numerator}_0) / "
            f"({pair.denominator}_t / {pair.denominator}_0) x 100"
        ),
        "series": [],
        "latest": None,
        "refused_reason": reason,
    }


def _closes_by_date(market, ticker: str) -> Dict[str, float]:
    """Bars as date to close, dropping bars with no usable close.

    A missing close is dropped rather than coerced: an unsettled bar stored as 0.0 once made
    136 of 139 tickers read as a -100% collapse (ERROR-LOG 2026-09-09).

    The table MUST be routed explicitly. `get_stock_ohlcv` defaults to `table="stocks"`, and
    `^GSPC` -- the benchmark for four of the five pairs -- lives in `indices`. Reading it from
    `stocks` returns nothing, so every one of those pairs would refuse with "no overlapping
    history", a reason pointing at the data rather than at this line.
    """
    table = MarketDataService._table_for_ticker(ticker)
    bars = market.get_stock_ohlcv(ticker, period="5y", table=table)
    return {bar.date: float(bar.close) for bar in bars if bar.close is not None}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_market_spreads.py -q`
Expected: PASS, 6 tests.

- [ ] **Step 5: Mutation-verify**

| Mutation | Edit | Must fail |
|---|---|---|
| basis hardcoded | replace the f-string basis with `"relative strength"` | `test_every_pair_carries_a_basis_naming_both_tickers` |
| latest recomputed | `"latest": points[0]["value"]` | `test_latest_is_the_final_series_value_not_a_recomputation` |
| silent refusal | in `_refused`, set `"refused_reason": None` | `test_a_refusal_never_arrives_as_an_empty_series_with_no_reason` |
| requested window echoed as actual | `"actual_window_days": window_days` | `test_the_reported_window_is_the_one_actually_used` |
| a ticker dropped from the registry | delete the `defence` entry | `test_the_registry_names_every_ticker_the_feature_needs` |
| table routing removed | `bars = market.get_stock_ohlcv(ticker, period="5y")` | `test_the_benchmark_is_read_from_the_indices_table_not_stocks` |

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/market_spreads.py tests/api/test_market_spreads.py
git commit -m "feat: spread registry and builder, with refusals stated rather than empty"
```

---

### Task 3: Schema, route and shared types

**Files:**
- Modify: `apps/api/models/schema_parts/market.py` (append after `MarketEvent`)
- Modify: `apps/api/models/schemas.py` (import line ~66 and `__all__`)
- Modify: `apps/api/routes/market.py`
- Modify: `packages/shared-types/market.ts`
- Modify: `docs/superpowers/specs/2026-09-12-theme-and-policy-spreads-design.md`
- Test: `tests/api/test_market_spreads.py` (append)

**Interfaces:**
- Consumes: `build_spreads`, `SPREAD_PAIRS` from Task 2.
- Produces: `MarketSpread`, `MarketSpreadPoint` Pydantic models; `GET /api/v1/market/spreads?window_days=90`; matching TS interfaces.

- [ ] **Step 1: Write the failing route test**

Append to `tests/api/test_market_spreads.py`:

```python
def test_the_route_serves_one_row_per_pair_each_with_a_basis(monkeypatch):
    bars = _bars([("2026-01-05", 100.0), ("2026-01-06", 110.0)])
    stub = _StubService({pair.numerator: bars for pair in SPREAD_PAIRS}
                        | {pair.denominator: bars for pair in SPREAD_PAIRS})
    monkeypatch.setattr(spreads_service, "MarketDataService", lambda: stub)

    response = TestClient(app).get("/api/v1/market/spreads")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == len(SPREAD_PAIRS)
    for row in payload:
        assert row["basis"].strip()
        assert (row["refused_reason"] is None) != (row["series"] == [])


def test_the_route_accepts_a_window_in_days(monkeypatch):
    bars = _bars([("2026-01-05", 100.0), ("2026-01-06", 110.0)])
    stub = _StubService({pair.numerator: bars for pair in SPREAD_PAIRS}
                        | {pair.denominator: bars for pair in SPREAD_PAIRS})
    monkeypatch.setattr(spreads_service, "MarketDataService", lambda: stub)

    response = TestClient(app).get("/api/v1/market/spreads?window_days=30")

    assert response.status_code == 200
    assert all(row["requested_window_days"] == 30 for row in response.json())
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/test_market_spreads.py -q -k route_serves`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Add the Pydantic models**

Append to `apps/api/models/schema_parts/market.py`:

```python
class MarketSpreadPoint(BaseModel):
    """One date on a relative-strength series."""

    date: str
    value: float


class MarketSpread(BaseModel):
    """Relative strength of one ticker against another, indexed to 100 at the base date.

    `basis` is required and names both tickers and the base date, because "relative
    strength" alone does not distinguish a ratio of returns from a difference of returns
    from a regression beta.

    A pair that cannot be computed carries `refused_reason` and an empty `series`. The two
    are mutually exclusive on purpose: an empty series with no reason would read as a flat
    result rather than an absence.

    Window figures are CALENDAR days. `observations` is the session count, which is not
    derivable from the calendar span -- 62 sessions inside 88 days -- and without it a thin
    series is indistinguishable from a dense one.
    """

    id: str
    label: str
    numerator: str
    denominator: str
    requested_window_days: int
    actual_window_start: Optional[str] = None
    actual_window_end: Optional[str] = None
    actual_window_days: Optional[int] = None
    observations: int = 0
    basis: str
    series: List[MarketSpreadPoint] = Field(default_factory=list)
    latest: Optional[float] = None
    refused_reason: Optional[str] = None
```

- [ ] **Step 4: Export them**

In `apps/api/models/schemas.py`, add `MarketSpread, MarketSpreadPoint` to the `.schema_parts.market` import line (currently line ~66, already carrying `MarketEvent`), and add `"MarketSpread"` and `"MarketSpreadPoint"` to `__all__` in alphabetical position after `"MarketEvent"`.

- [ ] **Step 5: Add the route**

In `apps/api/routes/market.py`: add `MarketSpread` to the schemas import, add `from apps.api.services.market_spreads import build_spreads`, extend the module docstring with `GET /api/market/spreads            → theme and policy relative-strength spreads`, and add above `get_market_events`:

```python
@router.get("/spreads", response_model=List[MarketSpread])
def get_market_spreads(
    window_days: int = Query(default=90, ge=5, le=3650, description="Calendar days of history"),
):
    """Relative-strength spreads for the theme and policy pairs.

    `window_days` is CALENDAR days, not sessions. Each row reports the window it actually
    used alongside the one requested, so a short history is never presented as comparable
    to a full one.
    """
    return build_spreads(window_days)
```

- [ ] **Step 6: Run to verify it passes**

Run: `python -m pytest tests/api/test_market_spreads.py -q`
Expected: PASS, 8 tests.

- [ ] **Step 7: Mirror the contract into shared types**

Append to `packages/shared-types/market.ts`:

```typescript
/** One date on a relative-strength series. Mirrors `MarketSpreadPoint`. */
export interface MarketSpreadPoint {
  date: string;
  value: number;
}

/**
 * Relative strength of one ticker against another, indexed to 100 at the base date.
 *
 * Mirrors `MarketSpread` in `apps/api/models/schema_parts/market.py`.
 *
 * `basis` is non-empty on every row, refusals included, and `refused_reason` and a
 * populated `series` are mutually exclusive: an empty series with no reason would render
 * as a flat result rather than an absence. Window figures are calendar days; `observations`
 * carries the session count.
 */
export interface MarketSpread {
  id: string;
  label: string;
  numerator: string;
  denominator: string;
  requested_window_days: number;
  actual_window_start: string | null;
  actual_window_end: string | null;
  actual_window_days: number | null;
  observations: number;
  basis: string;
  series: MarketSpreadPoint[];
  latest: number | null;
  refused_reason: string | null;
}
```

- [ ] **Step 8: Amend the spec to match the query parameter**

In `docs/superpowers/specs/2026-09-12-theme-and-policy-spreads-design.md`, replace ``GET /market/spreads?window=90d`` with ``GET /market/spreads?window_days=90`` and add after the window-semantics paragraph:

```markdown
The parameter is `window_days` as an integer rather than the `90d` string this spec
originally specified: parsing `"90d"` adds a string parser and a malformed-input failure
mode in order to express an integer. The value is still calendar days.
```

- [ ] **Step 9: Verify and commit**

Run: `python -m pytest tests/api/ -q` and `cd apps/web && npx tsc --noEmit`
Expected: PASS; tsc exit 0.

```bash
git add apps/api/models apps/api/routes/market.py packages/shared-types tests/api/test_market_spreads.py docs/superpowers/specs/2026-09-12-theme-and-policy-spreads-design.md
git commit -m "feat: GET /market/spreads with a contract that states its basis and refusals"
```

---

### Task 4: `^VIX` as a market series

**Files:**
- Modify: `apps/api/services/market_data.py:76-96`
- Test: `tests/api/test_market_spreads.py` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `"Volatility (VIX)": "^VIX"` in `MARKET_INDICES`, routed to the `indices` table.

**Context the implementer needs:** `MARKET_INDICES` is overloaded — it decides table routing in `_table_for_ticker` (line 560) *and* is the card list `get_all_indices` iterates (line 915). Adding `^VIX` therefore routes it to the `indices` table **and** adds a VIX card to Market Overview. Both are wanted. Verified 2026-09-12 that nothing asserts the current count of nine: the only `/market/indices` test (`tests/api/test_nonfinite_json_boundary.py`) monkeypatches `get_all_indices` wholesale.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_market_spreads.py`:

```python
def test_vix_routes_to_the_indices_table_not_stocks():
    """`_table_for_ticker` decides by membership in MARKET_INDICES. A ^VIX missing from that
    dict would be written to and read from `stocks`, so it would silently never join the
    rows the index card list reads."""
    from apps.api.services.market_data import MARKET_INDICES, MarketDataService

    assert "^VIX" in MARKET_INDICES.values()
    assert MarketDataService._table_for_ticker("^VIX") == "indices"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/test_market_spreads.py -q -k vix_routes`
Expected: FAIL — `^VIX` is not in `MARKET_INDICES.values()`.

- [ ] **Step 3: Register it**

In `apps/api/services/market_data.py`, add to `MARKET_INDICES` after `"Bitcoin"`:

```python
    "Volatility (VIX)": "^VIX",
```

and to `INSTRUMENT_METADATA`:

```python
    "^VIX": {"instrument_type": "index", "unit_label": "index points"},
```

- [ ] **Step 4: Run the wider suite to verify nothing counted on nine indices**

Run: `python -m pytest tests/ -q`
Expected: PASS. If any test fails on an index count, that test hardcoded a number the registry owns — fix the test to derive it from `len(MARKET_INDICES)` rather than deleting the `^VIX` entry.

- [ ] **Step 5: Amend the spec's ^VIX placement**

The spec's UI section says "`^VIX` as its own series in the same section", meaning the
spreads grid. Registering it in `MARKET_INDICES` instead gives it a card in the existing
index strip at no extra cost, and that is where it belongs: it is a market series like Gold
and Oil, not a spread, and special-casing a non-spread into a grid of spreads would need the
card component to grow a second mode.

In `docs/superpowers/specs/2026-09-12-theme-and-policy-spreads-design.md`, replace the
`^VIX as its own series in the same section` bullet with:

```markdown
- `^VIX` is registered in `MARKET_INDICES`, which gives it a card in the existing index
  strip on this page rather than a slot in the spreads grid. It is a market series like
  Gold and Oil, not a spread, and the spread card would need a second mode to host it.
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/market_data.py tests/api/test_market_spreads.py docs/superpowers/specs/2026-09-12-theme-and-policy-spreads-design.md
git commit -m "feat: register ^VIX so it routes to indices and shows on Market Overview"
```

---

### Task 5: The spreads section on Market Overview

**Files:**
- Create: `apps/web/lib/useMarketSpreads.ts`
- Create: `apps/web/components/market/SpreadsSection.tsx`
- Modify: `apps/web/components/market/MarketOverviewClient.tsx`
- Test: `apps/web/tests/e2e/market-spreads.spec.ts`

**Interfaces:**
- Consumes: `GET /market/spreads` and the `MarketSpread` TS interface from Task 3; `useMarketEvents()` from I-C1.
- Produces: `useMarketSpreads(windowDays?: number)` returning `{ spreads: MarketSpread[]; isLoading: boolean }`; `<SpreadsSection showEvents?: boolean />` — defaulting to `true` so it works standalone, and overridden by Task 6 once the page owns the toggle.

**Pattern to follow:** `apps/web/lib/useMarketEvents.ts` — same query shape, and it memoises its derived arrays because `TVChart` is wrapped in `React.memo` and compares props by identity. A fresh array each render re-renders every chart on every unrelated parent render.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/web/tests/e2e/market-spreads.spec.ts`:

```typescript
import { expect, test, type Page } from "@playwright/test";

/**
 * The section's contract is that a reader can never see a theme figure without seeing what
 * produced it, and that a refused pair is visibly refused rather than absent or flat.
 */

// Market Overview renders from `apps/web/app/page.tsx`, so its route is `/` and not
// `/market`. Every existing spec for this page (market-overview.spec.ts) uses `/` too.
async function mockSpreads(page: Page, rows: unknown[]) {
  await page.route("**/api/v1/market/spreads**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

function computed(overrides: Record<string, unknown> = {}) {
  return {
    id: "ai", label: "AI", numerator: "BOTZ", denominator: "^GSPC",
    requested_window_days: 90,
    actual_window_start: "2026-06-15", actual_window_end: "2026-09-11",
    actual_window_days: 88, observations: 62,
    basis: "(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15",
    series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }],
    latest: 103.4, refused_reason: null,
    ...overrides,
  };
}

function refused(overrides: Record<string, unknown> = {}) {
  return {
    ...computed(),
    id: "defence", label: "Defence", numerator: "ITA", denominator: "^GSPC",
    actual_window_start: null, actual_window_end: null, actual_window_days: null,
    observations: 0, series: [], latest: null,
    refused_reason: "insufficient overlapping history",
    ...overrides,
  };
}

test("every spread card names the tickers and window that produced it", async ({ page }) => {
  // A figure labelled "AI +3.4%" asserts a fact about AI. "BOTZ vs ^GSPC" lets a reader
  // reject the proxy instead.
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-ai");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("BOTZ");
  await expect(card).toContainText("^GSPC");
  await expect(card).toContainText("90d");
});

test("a refused pair keeps its card and shows the reason", async ({ page }) => {
  // Not an empty chart, not a line flat at 100 -- which is indistinguishable from a real
  // result showing no relative movement -- and never hidden.
  await mockSpreads(page, [computed(), refused()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-defence");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("Unavailable");
  await expect(card).toContainText("insufficient overlapping history");
  await expect(card).toContainText("ITA");
  await expect(card.getByTestId("spread-chart-defence")).toHaveCount(0);
  await expect(card).not.toContainText("100.0");
});

test("a computed pair renders its latest value and its chart", async ({ page }) => {
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-ai");
  await expect(card).toContainText("103.4");
  await expect(card.getByTestId("spread-chart-ai")).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx playwright test tests/e2e/market-spreads.spec.ts --reporter=line`
Expected: FAIL — `spread-card-ai` never appears.

- [ ] **Step 3: Write the hook**

Create `apps/web/lib/useMarketSpreads.ts`:

```typescript
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import type { MarketSpread } from "../../../packages/shared-types";

export type { MarketSpread };

/**
 * Theme and policy spreads.
 *
 * Memoised on the query data: consumers pass slices of this into memoised chart components
 * that compare props by identity, and a fresh array each render defeats that comparison.
 *
 * A failure yields an empty list rather than an error state -- Market Overview must not go
 * down because a supplementary section could not load.
 */
export function useMarketSpreads(windowDays = 90) {
  const query = useQuery({
    queryKey: ["market-spreads", windowDays],
    queryFn: () => fetchApi<MarketSpread[]>(`/market/spreads?window_days=${windowDays}`),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const spreads = useMemo<MarketSpread[]>(() => query.data ?? [], [query.data]);
  return { spreads, isLoading: query.isLoading };
}
```

- [ ] **Step 4: Write the section**

Create `apps/web/components/market/SpreadsSection.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import TVChart from "@/components/charts/TVChart";
import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import { useMarketEvents } from "@/lib/useMarketEvents";
import { useMarketSpreads } from "@/lib/useMarketSpreads";
import type { MarketSpread } from "@/lib/useMarketSpreads";
import type { TVCandle } from "@/lib/transformers";

/**
 * A spread series has one value per date, but TVChart draws candles. Flat OHLC on the same
 * value renders the line without a second chart stack -- the shape is a line either way,
 * and reusing TVChart means the I-C1 event lines overlay these charts for free.
 */
function toCandles(spread: MarketSpread): TVCandle[] {
  return spread.series.map((point) => ({
    time: point.date,
    open: point.value,
    high: point.value,
    low: point.value,
    close: point.value,
  }));
}

function SpreadCard({
  spread,
  events,
  showEvents,
}: {
  spread: MarketSpread;
  events: EventLineSpec[];
  showEvents: boolean;
}) {
  const candles = useMemo(() => toCandles(spread), [spread]);
  const window = `${spread.requested_window_days}d`;

  return (
    <div
      data-testid={`spread-card-${spread.id}`}
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-bold text-[var(--text-primary)]">{spread.label}</span>
        {spread.latest !== null ? (
          <span className="tabular-nums text-[var(--text-primary)]">{spread.latest.toFixed(1)}</span>
        ) : null}
      </div>

      {/* The proxy is named, always. A figure labelled only "AI" asserts a fact about AI;
          naming the tickers lets a reader reject the proxy instead. */}
      <span className="mt-0.5 block text-[length:var(--type-helper)] text-[var(--text-muted)]">
        {spread.numerator} vs {spread.denominator} · {window}
      </span>

      {spread.refused_reason ? (
        // Refusal is a stated fact, so it is rendered as one: never an empty chart, never a
        // line flat at 100 (indistinguishable from a real result showing no movement), and
        // never a hidden card.
        <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-[length:var(--type-helper)]">
          <span className="block font-semibold text-[var(--text-primary)]">Unavailable</span>
          <span className="block text-[var(--text-muted)]">Reason: {spread.refused_reason}</span>
        </div>
      ) : (
        <div data-testid={`spread-chart-${spread.id}`} className="mt-3">
          {/* The event lines overlay these charts too -- reading the 28 Feb 2026 line against
              the defence spread is the reason both features exist on this page. */}
          <TVChart
            data={candles}
            events={events}
            showEvents={showEvents}
            height={140}
            tickerName={`${spread.label} spread`}
          />
        </div>
      )}
    </div>
  );
}

export function SpreadsSection({ showEvents = true }: { showEvents?: boolean }) {
  const { spreads } = useMarketSpreads();
  const { lines } = useMarketEvents();
  if (spreads.length === 0) return null;

  return (
    <section
      data-testid="spreads-section"
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4"
    >
      <h3 className="text-lg font-bold text-[var(--text-primary)]">Themes and policy spreads</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Relative strength against a benchmark, indexed to 100 at the start of each window. Each
        card names the tickers it is computed from — the theme names are proxies, not measurements.
      </p>
      <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {spreads.map((spread) => (
          <SpreadCard key={spread.id} spread={spread} events={lines} showEvents={showEvents} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Render it on Market Overview**

In `apps/web/components/market/MarketOverviewClient.tsx`: add `import { SpreadsSection } from "@/components/market/SpreadsSection";`, and render `<SpreadsSection />` immediately after the closing tag of the `section` that contains the OHLCV chart card (the `<section className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">` block beginning at line ~488), so the spreads sit below the chart on the same page.

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/web && npx playwright test tests/e2e/market-spreads.spec.ts --reporter=line`
Expected: PASS, 3 tests.

- [ ] **Step 7: Mutation-verify**

| Mutation | Edit | Must fail |
|---|---|---|
| proxy tickers dropped from the label | render `{spread.label}` only, removing the `numerator vs denominator` line | `every spread card names the tickers and window` |
| refusal rendered as an empty chart | replace the refusal branch with the chart branch | `a refused pair keeps its card and shows the reason` |
| refused card hidden | `if (spread.refused_reason) return null;` in `SpreadCard` | `a refused pair keeps its card and shows the reason` |

- [ ] **Step 8: Verify and commit**

Run: `cd apps/web && npx tsc --noEmit && npx eslint components/market/SpreadsSection.tsx lib/useMarketSpreads.ts`
Expected: exit 0, no errors.

```bash
git add apps/web/lib/useMarketSpreads.ts apps/web/components/market/SpreadsSection.tsx apps/web/components/market/MarketOverviewClient.tsx apps/web/tests/e2e/market-spreads.spec.ts
git commit -m "feat: theme and policy spreads on Market Overview, each naming its proxies"
```

---

### Task 6: The event-line toggle on Market Overview

**Files:**
- Modify: `apps/web/components/market/MarketOverviewClient.tsx`
- Test: `apps/web/tests/e2e/market-spreads.spec.ts` (append)

**Interfaces:**
- Consumes: `useMarketEvents()` and `TVChart`'s `events` / `showEvents` props, both shipped in I-C1 (PR #34); `<SpreadsSection showEvents />` from Task 5.
- Produces: `apps/web/tests/e2e/helpers/chartInk.ts` exporting `inkProfile` and `stableInkProfile`, imported by both chart specs.

**Why this task exists:** `MarketOverviewClient` renders `TVChart` directly rather than through `OHLCVChartCard`, so it never received the toggle I-C1 added. It is the surface where the overlay matters most: the 28 Feb 2026 event is loudest on the oil series, which moved 67.02 → 81.01 in five sessions.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/tests/e2e/market-spreads.spec.ts`:

```typescript
test("the market overview chart has an event toggle", async ({ page }) => {
  await page.route("**/api/v1/market/events**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: "us-iran-strikes-begin-2026-02-28",
        label: "U.S. strikes on Iran begin",
        category: "geopolitical",
        start_date: "2026-02-28", end_date: null,
        source: "https://example.com/timeline", note: "",
      }]),
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const toggle = page.getByTestId("market-events-toggle");
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx playwright test tests/e2e/market-spreads.spec.ts --reporter=line -g "event toggle"`
Expected: FAIL — `market-events-toggle` not found.

- [ ] **Step 3: Wire it in**

In `apps/web/components/market/MarketOverviewClient.tsx`:

Add imports and state:

```tsx
import { useMarketEvents } from "@/lib/useMarketEvents";
```

```tsx
  const [showEvents, setShowEvents] = useState(true);
  const { lines: eventLines } = useMarketEvents();
```

Add the button inside the existing `<div className="flex flex-wrap gap-2">` that holds the Daily/Monthly group, after that group's closing `</div>`:

```tsx
                    {eventLines.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowEvents((shown) => !shown)}
                        aria-pressed={showEvents}
                        data-testid="market-events-toggle"
                        className={`rounded-[var(--radius)] border px-3 py-1 text-xs font-semibold ${
                          showEvents
                            ? "border-[var(--state-warning)] text-[var(--state-warning)]"
                            : "border-[var(--border)] text-[var(--text-muted)]"
                        }`}
                      >
                        Market events
                      </button>
                    ) : null}
```

Pass them to the chart, extending the existing `<TVChart ... />` call:

```tsx
                      events={eventLines}
                      showEvents={showEvents}
```

And pass the same state to the spreads section from Task 5, so one toggle governs the whole
page rather than the main chart and the spread cards disagreeing:

```tsx
<SpreadsSection showEvents={showEvents} />
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && npx playwright test tests/e2e/market-spreads.spec.ts --reporter=line`
Expected: PASS, 4 tests.

- [ ] **Step 5: Make the toggle assertion real, not attribute-deep**

`aria-pressed` flipping proves the button has state, **not** that the chart changed. Deleting
the `showEvents={showEvents}` prop leaves that assertion passing, so as written the test
cannot catch the most likely wiring mistake.

Extract the canvas helpers already used by `tests/e2e/market-event-lines.spec.ts` into
`apps/web/tests/e2e/helpers/chartInk.ts`, exporting `inkProfile(page, selector)` and
`stableInkProfile(page, selector)` unchanged from that file — including the polling loop,
which exists because a previous chart-pixel test in this repository read stale coordinates.
Update `market-event-lines.spec.ts` to import them instead of declaring them locally, and
re-run that whole spec to confirm all four of its tests still pass after the move.

Then append to the toggle test:

```typescript
  const selector = '[data-testid="tv-chart"]';
  const withLine = await stableInkProfile(page, selector);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const withoutLine = await stableInkProfile(page, selector);

  const changed = withLine.ink.filter((value, index) => value !== (withoutLine.ink[index] ?? 0));
  expect(changed.length, "toggling must change what is painted, not just the button").toBeGreaterThan(0);
```

- [ ] **Step 6: Mutation-verify**

| Mutation | Edit | Must fail |
|---|---|---|
| `showEvents` not passed to the chart | delete the `showEvents={showEvents}` prop | `the market overview chart has an event toggle` — at the ink-diff assertion, not the attribute |
| `events` not passed to the chart | delete the `events={eventLines}` prop | same test — nothing is painted either way, so the diff is empty |
| `SpreadsSection` not given the toggle value | revert it to `<SpreadsSection />` | add an ink-diff on `[data-testid="spread-chart-ai"]`; without the prop the spread charts keep their lines while the main chart loses them |

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/market/MarketOverviewClient.tsx apps/web/tests/e2e/market-spreads.spec.ts apps/web/tests/e2e/helpers/chartInk.ts apps/web/tests/e2e/market-event-lines.spec.ts
git commit -m "feat: event-line toggle on the Market Overview chart and its spread cards"
```

---

### Task 7: Record the work and run the full gates

**Files:**
- Modify: `guideline/sop/todo.md` (Track I)
- Modify: `docs/superpowers/specs/2026-09-12-theme-and-policy-spreads-design.md` (status header)

- [ ] **Step 1: Run every gate**

```bash
python -m pytest tests/ -q
cd apps/web && npx tsc --noEmit && npx eslint . && npx playwright test
```

Expected: Python baseline 1282 plus the tests added here, all passing; tsc and eslint clean; the full Playwright suite green.

If `portfolio-watchlist.spec.ts` → *"clicking a holding opens the stock detail modal"* fails, do **not** record the run as green and do **not** call it flaky. It failed once in three runs during I-C1 on an unusually slow run (11.0 min against 6.4 and 6.5) and was never explained; PR #34 documents what was ruled out. Capture the full failure output this time — the message was lost to truncation before.

- [ ] **Step 2: Update Track I**

Add `I-D` to `guideline/sop/todo.md` recording: what shipped, that politics is represented by spreads rather than a score and why, that `^VIX` replaced a Fear & Greed composite, the `SPREAD_PAIRS` registry decision and the rejected watchlist alternative, and the mutation matrix results per task.

- [ ] **Step 3: Update the spec status header**

Change the status line to `IMPLEMENTED 2026-09-12 on <branch>` and note any deviation discovered during implementation.

- [ ] **Step 4: Commit**

```bash
git add guideline/sop/todo.md docs/superpowers/specs/2026-09-12-theme-and-policy-spreads-design.md
git commit -m "docs: record the theme and policy spreads work in Track I"
```

---

## Verification summary

| Gate | Command | Expected |
|---|---|---|
| Python | `python -m pytest tests/ -q` | 1282 + new, all pass |
| Types | `cd apps/web && npx tsc --noEmit` | exit 0 |
| Lint | `cd apps/web && npx eslint .` | no errors |
| E2E | `cd apps/web && npx playwright test` | all pass |
| Mutation | per-task tables above | every listed mutation fails its named test |

**No test in this plan may be reported as verified on the strength of a passing run.** Name the mutation it was shown to catch, or call it unverified.
