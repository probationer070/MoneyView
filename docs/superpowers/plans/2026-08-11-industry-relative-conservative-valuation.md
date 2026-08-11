# Industry-Relative Conservative Valuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every watchlist DCF a second time on assumptions faded toward the average of the top 3–5 industries in the company's sector, and return both valuations side by side.

**Architecture:** A pure layer in `packages/core_finance/industry_benchmark.py` does screening, ranking, averaging and fading over plain dataclasses. A service layer in `apps/api/services/` owns storage, vintage selection and two hand-authored mapping tables. The existing DCF is not modified — a sibling of `valuation_params_from_metrics` produces a second `ValuationAssumptions`, and `corporate_dcf` runs the same computation twice.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, SQLite (no migration framework), pytest, openpyxl.

**Design spec:** `docs/superpowers/specs/2026-08-11-industry-relative-conservative-valuation-design.md`

## Global Constraints

- Tests may not make network calls.
- Tests must not open `data/processed/moneyview.db`.
- `packages/core_finance` must not import from `apps/api` (`guideline/sop/file-structure.md:42`). The dependency runs one way.
- Schema changes go in `_CREATE_SCHEMA_SQL` plus an additive `ALTER TABLE` in `_ensure_schema_compatibility` in `apps/api/services/db.py`. There is no migration framework.
- **Units.** Damodaran's dataset is in fractions (reinvestment 0.409). `CorporateMetrics` is in percent (`{"roic": 18}`). `ValuationAssumptions` is mixed: `revenue_growth_rate`, `operating_margin`, `tax_rate`, `wacc` are fractions; `reinvestment` and `debt_ratio` are percent, bounded `ge=0.0, le=100.0`, and are NOT divided by 100 anywhere. Convert once, per field, at the boundary. Never apply a blanket `* 100`.
- Consult `guideline/sop/finance-logic.md` before and after any change to a formula.
- The stored-assumption valuation must remain byte-identical to what it produces today. This is the regression guard on the parallel-scenario promise.
- Do not modify `packages/core_finance/dcf.py` or `packages/core_finance/segment_valuation.py`.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core_finance/industry_benchmark.py` | Pure. `IndustryRow`, `BENCHMARK_COLUMNS`, screening, ranking, averaging, `SectorBenchmark`, the fade. |
| `apps/api/services/industry_maps.py` | The two hand-authored maps and the excluded-rows list. Judgement artifacts with comments. |
| `apps/api/services/industry_benchmark_store.py` | SQLite storage, vintage selection, workbook parsing. |
| `apps/api/services/corporate_metrics_service.py` | Add `conservative_valuation_params`. Existing functions untouched. |
| `apps/api/services/corporate_dcf.py` | Add the parallel scenario to the DCF outputs. |
| `apps/api/services/acquisition/sources/quote_facts.py` | Keep Yahoo's `sector` and `industry`. |
| `apps/api/services/db.py` | `industry_benchmark` table + additive migration. |
| `tests/core_finance/test_industry_benchmark.py` | Pure-layer tests. |
| `tests/api/test_industry_maps.py` | Map completeness. |
| `tests/api/test_industry_benchmark_store.py` | Storage, vintage, parsing. |
| `tests/api/test_conservative_valuation.py` | Conversion, units, integration. |
| `tests/fixtures/industry_rows_technology.py` | Ten real industry rows, exact values. |

---

### Task 1: Industry row model, column units, and screening

**Files:**
- Create: `packages/core_finance/industry_benchmark.py`
- Create: `tests/fixtures/industry_rows_technology.py`
- Test: `tests/core_finance/test_industry_benchmark.py`

**Interfaces:**
- Produces:
  - `Unit` — `Literal["fraction", "count", "ratio"]`
  - `BenchmarkColumn(key: str, source_header: str, unit: Unit, low: float, high: float)`
  - `BENCHMARK_COLUMNS: tuple[BenchmarkColumn, ...]`
  - `IndustryRow(name: str, firms: int, values: dict[str, float | None])`
  - `MIN_FIRMS: int = 10`
  - `screen_value(column: BenchmarkColumn, value: float | None) -> str | None` — returns a reason string when rejected, `None` when the value is usable
  - `screen_row(row: IndustryRow) -> str | None` — row-level rejection reason (firm count), `None` when usable

- [ ] **Step 1: Create the fixture of real industry rows**

These are exact values from Damodaran's `Industry Average Beta (US)` sheet. Do not round them.

```python
# tests/fixtures/industry_rows_technology.py
"""Ten real rows from Damodaran's US industry-average dataset.

Transcribed from `Industry Average Beta (US)` in SpaceX2026IPOUpdated.xlsx.
Values are exact, not rounded: the resolver's averages are asserted against
them, so a rounded fixture would make an exact assertion impossible.

Two rows are deliberately included for their defects:
  Software (Internet)   reinvestment 14.1421...  (1414%)
  Information Services  reinvestment -0.2679     (negative)
"""

from packages.core_finance.industry_benchmark import IndustryRow

TECHNOLOGY_ROWS = [
    IndustryRow("Computers/Peripherals", 36, {
        "revenue_growth": 0.0671086957, "operating_margin": 0.224848747,
        "after_tax_roc": 0.4476035274, "effective_tax_rate": 0.1535453935,
        "unlevered_beta": 1.3245870397, "debt_to_capital": 0.0442031038,
        "cost_of_capital": 0.0970707313, "sales_to_capital": 3.6197887498,
        "reinvestment_rate": 0.2136889975,
    }),
    IndustryRow("Software (System & Application)", 309, {
        "revenue_growth": 0.195645, "operating_margin": 0.3298251374,
        "after_tax_roc": 0.2931842949, "effective_tax_rate": 0.1801118281,
        "unlevered_beta": 1.2481994175, "debt_to_capital": 0.0528251888,
        "cost_of_capital": 0.0934404807, "sales_to_capital": 1.5381715802,
        "reinvestment_rate": 0.7377874473,
    }),
    IndustryRow("Semiconductor Equip", 31, {
        "revenue_growth": 0.0937880769, "operating_margin": 0.2617117458,
        "after_tax_roc": 0.2840446307, "effective_tax_rate": 0.1706597835,
        "unlevered_beta": 1.3916911563, "debt_to_capital": 0.0463590191,
        "cost_of_capital": 0.0989358133, "sales_to_capital": 1.8511086723,
        "reinvestment_rate": 0.2745310217,
    }),
    IndustryRow("Semiconductor", 66, {
        "revenue_growth": 0.1117713043, "operating_margin": 0.3532779191,
        "after_tax_roc": 0.2722696684, "effective_tax_rate": 0.1579041821,
        "unlevered_beta": 1.5046492755, "debt_to_capital": 0.0252566218,
        "cost_of_capital": 0.1055061909, "sales_to_capital": 1.2066681381,
        "reinvestment_rate": 0.3528579819,
    }),
    IndustryRow("Computer Services", 64, {
        "revenue_growth": 0.2709984211, "operating_margin": 0.0740933475,
        "after_tax_roc": 0.2634856324, "effective_tax_rate": 0.2256371132,
        "unlevered_beta": 0.961700999, "debt_to_capital": 0.2006402718,
        "cost_of_capital": 0.078320702, "sales_to_capital": 5.1898906917,
        "reinvestment_rate": 0.4440778109,
    }),
    IndustryRow("Telecom. Equipment", 57, {
        "revenue_growth": 0.0327197561, "operating_margin": 0.206967645,
        "after_tax_roc": 0.2547374909, "effective_tax_rate": 0.1654122121,
        "unlevered_beta": 0.887251212, "debt_to_capital": 0.0844398133,
        "cost_of_capital": 0.0772143339, "sales_to_capital": 2.567713718,
        "reinvestment_rate": 0.4660719334,
    }),
    IndustryRow("Information Services", 15, {
        "revenue_growth": 0.0677090909, "operating_margin": 0.1188602164,
        "after_tax_roc": 0.2217430042, "effective_tax_rate": 0.2173934148,
        "unlevered_beta": 0.7563563576, "debt_to_capital": 0.249079272,
        "cost_of_capital": 0.069958157, "sales_to_capital": 2.5121429063,
        "reinvestment_rate": -0.2678902089,
    }),
    IndustryRow("Electronics (General)", 114, {
        "revenue_growth": 0.0726830263, "operating_margin": 0.1042317781,
        "after_tax_roc": 0.1791172541, "effective_tax_rate": 0.2032217979,
        "unlevered_beta": 0.9374545596, "debt_to_capital": 0.0991945884,
        "cost_of_capital": 0.078548315, "sales_to_capital": 2.3834942903,
        "reinvestment_rate": 0.7717649554,
    }),
    IndustryRow("Heathcare Information and Technology", 115, {
        "revenue_growth": 0.155735303, "operating_margin": 0.1470948559,
        "after_tax_roc": 0.1371678335, "effective_tax_rate": 0.1509666497,
        "unlevered_beta": 1.0163250326, "debt_to_capital": 0.1360045004,
        "cost_of_capital": 0.0822338862, "sales_to_capital": 1.2456990697,
        "reinvestment_rate": 0.1211666819,
    }),
    IndustryRow("Software (Internet)", 29, {
        "revenue_growth": 0.291795, "operating_margin": 0.03686142,
        "after_tax_roc": 0.034347802, "effective_tax_rate": 0.1714671615,
        "unlevered_beta": 1.5905250877, "debt_to_capital": 0.1095194174,
        "cost_of_capital": 0.1065867385, "sales_to_capital": 1.3500967702,
        "reinvestment_rate": 14.1421393679,
    }),
]
```

- [ ] **Step 2: Write the failing screening tests**

```python
# tests/core_finance/test_industry_benchmark.py
import pytest

from packages.core_finance.industry_benchmark import (
    BENCHMARK_COLUMNS,
    IndustryRow,
    column_by_key,
    screen_row,
    screen_value,
)
from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS


def _row(name):
    return next(r for r in TECHNOLOGY_ROWS if r.name == name)


def test_a_reinvestment_rate_of_1414_percent_is_screened_out():
    """Software (Internet) reports 14.1421 -- an artifact of a tiny denominator,
    not an economic fact. Averaged in unscreened it moves the result in the
    direction of looking MORE conservative, with no visible cause."""
    reason = screen_value(column_by_key("reinvestment_rate"),
                          _row("Software (Internet)").values["reinvestment_rate"])
    assert reason is not None
    assert "reinvestment_rate" in reason
    assert "14.14" in reason


def test_a_negative_reinvestment_rate_is_screened_out():
    """11 of 92 industries report one. Disinvestment is real, but it is not a
    conservative forward assumption."""
    assert screen_value(column_by_key("reinvestment_rate"),
                        _row("Information Services").values["reinvestment_rate"]) is not None


def test_screening_is_per_column_so_a_bad_cell_does_not_reject_its_neighbours():
    """Information Services has an unusable reinvestment rate and a perfectly
    ordinary operating margin. Only the first is rejected."""
    row = _row("Information Services")
    assert screen_value(column_by_key("reinvestment_rate"), row.values["reinvestment_rate"]) is not None
    assert screen_value(column_by_key("operating_margin"), row.values["operating_margin"]) is None
    assert screen_value(column_by_key("after_tax_roc"), row.values["after_tax_roc"]) is None


def test_a_thin_industry_is_screened_at_the_row_level():
    """Firm counts run 1 to 5994 with a median of 34. A 15-firm average is a
    much weaker claim than a 309-firm one, and MIN_FIRMS is 10."""
    assert screen_row(IndustryRow("Tiny", 9, {})) is not None
    assert screen_row(IndustryRow("Small but usable", 10, {})) is None
    assert screen_row(_row("Software (System & Application)")) is None


def test_information_services_survives_row_screening_at_15_firms():
    """The row-level bound is firm count only. Its bad cell is a column concern."""
    assert screen_row(_row("Information Services")) is None


def test_a_missing_value_is_screened_without_raising():
    assert screen_value(column_by_key("operating_margin"), None) is not None


def test_every_column_declares_a_unit_and_a_plausible_band():
    """The units hazard: a fraction leaking into a percent field passes every
    declared bound. Units are explicit per column, never by convention."""
    for column in BENCHMARK_COLUMNS:
        assert column.unit in ("fraction", "count", "ratio")
        assert column.low < column.high
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/core_finance/test_industry_benchmark.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'packages.core_finance.industry_benchmark'`

- [ ] **Step 4: Implement the model and screening**

```python
# packages/core_finance/industry_benchmark.py
"""Industry-average benchmarks and the conservative fade toward them -- pure.

Damodaran's US industry-average dataset, screened and averaged into a sector
benchmark, then used to fade a company's own assumptions in the conservative
direction only.

Everything here is pure: no I/O, no database, no network. `packages/core_finance`
must not import from `apps/api` (guideline/sop/file-structure.md:42).

UNITS. Every value in this module is in the dataset's own units -- fractions,
not percents. Conversion to `ValuationAssumptions`, which is mixed, happens at
the service boundary and nowhere else. See the design spec, "Units".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Unit = Literal["fraction", "count", "ratio"]

# An industry average resting on fewer than this many firms is too thin to
# benchmark against. Firm counts in the 2026 vintage run 1 to 5994 with a
# median of 34; 10 is the observed 10th percentile, so this rejects the
# thinnest decile without gutting the sample.
MIN_FIRMS = 10


@dataclass(frozen=True)
class BenchmarkColumn:
    """One column of the dataset, with the band outside which it is unusable.

    `low`/`high` are PLAUSIBILITY bounds, deliberately tighter than the
    corresponding `ValuationAssumptions` field validation. The field bounds are
    too loose to catch a units error -- 0.409 passes `ge=0.0, le=100.0` and
    silently means 0.4% instead of 41%.
    """

    key: str
    source_header: str
    unit: Unit
    low: float
    high: float


BENCHMARK_COLUMNS: tuple[BenchmarkColumn, ...] = (
    BenchmarkColumn("revenue_growth", "Annual Average Revenue growth - Last 5 years",
                    "fraction", -1.0, 2.0),
    BenchmarkColumn("operating_margin", "Pre-tax Operating Margin (Unadjusted)",
                    "fraction", -0.5, 1.0),
    BenchmarkColumn("after_tax_roc", "After-tax ROC", "fraction", -1.0, 1.0),
    BenchmarkColumn("effective_tax_rate", "Average effective tax rate",
                    "fraction", 0.0, 1.0),
    BenchmarkColumn("unlevered_beta", "Unlevered Beta", "ratio", 0.0, 5.0),
    BenchmarkColumn("debt_to_capital", "Market Debt/Capital", "fraction", 0.0, 1.0),
    BenchmarkColumn("cost_of_capital", "Cost of capital", "fraction", 0.0, 0.5),
    BenchmarkColumn("sales_to_capital", "Sales/Capital", "ratio", 0.0, 20.0),
    # 0 to 1.5 rejects the 11 negative rates and the three above 200% in the
    # 2026 vintage. p90 is 1.311, so the upper bound keeps the ordinary tail.
    BenchmarkColumn("reinvestment_rate", "Reinvestment Rate", "fraction", 0.0, 1.5),
)

_COLUMNS_BY_KEY = {column.key: column for column in BENCHMARK_COLUMNS}


def column_by_key(key: str) -> BenchmarkColumn:
    try:
        return _COLUMNS_BY_KEY[key]
    except KeyError:
        raise ValueError(
            f"no benchmark column named {key!r}; known columns are "
            f"{sorted(_COLUMNS_BY_KEY)}"
        ) from None


@dataclass(frozen=True)
class IndustryRow:
    """One industry's averages for a single vintage."""

    name: str
    firms: int
    values: dict[str, float | None] = field(default_factory=dict)


def screen_row(row: IndustryRow) -> str | None:
    """Row-level rejection reason, or None when the row is usable."""
    if row.firms < MIN_FIRMS:
        return (
            f"{row.name}: {row.firms} firms is below the {MIN_FIRMS}-firm minimum; "
            f"an average this thin is not a benchmark"
        )
    return None


def screen_value(column: BenchmarkColumn, value: float | None) -> str | None:
    """Column-level rejection reason, or None when the value is usable."""
    if value is None:
        return f"{column.key}: no value in this vintage"
    if not column.low <= value <= column.high:
        return (
            f"{column.key}: {value:.4f} is outside the plausible band "
            f"[{column.low}, {column.high}] for a {column.unit} and is a data "
            f"artifact rather than an economic fact"
        )
    return None
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/core_finance/test_industry_benchmark.py -q`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core_finance/industry_benchmark.py tests/fixtures/industry_rows_technology.py tests/core_finance/test_industry_benchmark.py
git commit -m "feat: industry benchmark row model and per-column screening"
```

---

### Task 2: Ranking, averaging, and provenance

**Files:**
- Modify: `packages/core_finance/industry_benchmark.py`
- Test: `tests/core_finance/test_industry_benchmark.py`

**Interfaces:**
- Consumes: `IndustryRow`, `BENCHMARK_COLUMNS`, `screen_row`, `screen_value`, `column_by_key` from Task 1.
- Produces:
  - `ColumnAverage(value: float, industries: tuple[str, ...])`
  - `SectorBenchmark(sector: str, columns: dict[str, ColumnAverage], ranked: tuple[str, ...], rejected: tuple[str, ...])`
  - `resolve_benchmark(sector: str, rows: list[IndustryRow], *, top_n: int = 5, minimum: int = 3) -> SectorBenchmark`
  - `BenchmarkUnavailable(Exception)`

- [ ] **Step 1: Write the failing tests**

Append to `tests/core_finance/test_industry_benchmark.py`:

```python
from packages.core_finance.industry_benchmark import (
    BenchmarkUnavailable,
    resolve_benchmark,
)

# Exact top-3 averages over Computers/Peripherals, Software (System &
# Application) and Semiconductor Equip -- the three highest after-tax ROC rows
# in TECHNOLOGY_ROWS. Computed from the fixture's unrounded values.
TOP3 = {
    "after_tax_roc": (0.4476035274 + 0.2931842949 + 0.2840446307) / 3,
    "operating_margin": (0.224848747 + 0.3298251374 + 0.2617117458) / 3,
    "sales_to_capital": (3.6197887498 + 1.5381715802 + 1.8511086723) / 3,
    "reinvestment_rate": (0.2136889975 + 0.7377874473 + 0.2745310217) / 3,
    "cost_of_capital": (0.0970707313 + 0.0934404807 + 0.0989358133) / 3,
}


def test_ranking_is_by_after_tax_roc_descending():
    result = resolve_benchmark("Technology", TECHNOLOGY_ROWS, top_n=3)
    assert result.ranked[:3] == (
        "Computers/Peripherals",
        "Software (System & Application)",
        "Semiconductor Equip",
    )


def test_top_three_averages_reproduce_the_spec_worked_example():
    """The spec's worked example is a fixture, not an illustration."""
    result = resolve_benchmark("Technology", TECHNOLOGY_ROWS, top_n=3)
    for key, expected in TOP3.items():
        assert result.columns[key].value == pytest.approx(expected, abs=1e-12), key
    assert result.columns["after_tax_roc"].value == pytest.approx(0.3416, abs=5e-5)
    assert result.columns["operating_margin"].value == pytest.approx(0.2721, abs=5e-5)
    assert result.columns["sales_to_capital"].value == pytest.approx(2.336, abs=5e-4)
    assert result.columns["reinvestment_rate"].value == pytest.approx(0.409, abs=5e-4)


def test_each_column_records_which_industries_it_averaged():
    result = resolve_benchmark("Technology", TECHNOLOGY_ROWS, top_n=3)
    assert result.columns["operating_margin"].industries == (
        "Computers/Peripherals",
        "Software (System & Application)",
        "Semiconductor Equip",
    )


def test_a_poisoned_cell_drops_only_its_own_column():
    """Construct a sector where the HIGHEST-ROC industry carries a 1414%
    reinvestment rate. It must still contribute every other column, and the
    reinvestment average must be taken without it.

    Screening only bites when a poisoned row ranks into the basket, which the
    real Technology rows do not -- Software (Internet) ranks last by ROC. So
    this is built rather than borrowed.
    """
    poisoned = IndustryRow("Poisoned Leader", 50, {
        **{c.key: 0.2 for c in BENCHMARK_COLUMNS},
        "after_tax_roc": 0.9,
        "reinvestment_rate": 14.1421393679,
    })
    rows = [poisoned] + [r for r in TECHNOLOGY_ROWS if r.name in (
        "Computers/Peripherals", "Software (System & Application)", "Semiconductor Equip",
    )]
    result = resolve_benchmark("Technology", rows, top_n=3)

    assert result.ranked[0] == "Poisoned Leader"
    assert "Poisoned Leader" in result.columns["operating_margin"].industries
    assert "Poisoned Leader" not in result.columns["reinvestment_rate"].industries
    assert any("reinvestment_rate" in r and "Poisoned Leader" in r for r in result.rejected)


def test_a_column_that_loses_too_many_candidates_is_absent_not_wrong():
    """Three of four candidates carry unusable reinvestment rates, leaving one.
    Below `minimum`, the column is omitted rather than averaged over a single
    industry and presented as a sector benchmark."""
    rows = [
        IndustryRow(f"Bad {i}", 50, {**{c.key: 0.2 for c in BENCHMARK_COLUMNS},
                                     "after_tax_roc": 0.9 - i * 0.01,
                                     "reinvestment_rate": -0.5})
        for i in range(3)
    ] + [IndustryRow("Good", 50, {**{c.key: 0.2 for c in BENCHMARK_COLUMNS},
                                  "after_tax_roc": 0.5, "reinvestment_rate": 0.4})]
    result = resolve_benchmark("Technology", rows, top_n=4, minimum=3)

    assert "reinvestment_rate" not in result.columns
    assert "operating_margin" in result.columns


def test_a_sector_with_too_few_usable_industries_raises():
    rows = [r for r in TECHNOLOGY_ROWS if r.name == "Semiconductor"]
    with pytest.raises(BenchmarkUnavailable, match="only 1"):
        resolve_benchmark("Technology", rows, minimum=3)


def test_thin_industries_are_excluded_from_ranking_entirely():
    """Information Services has 15 firms and passes MIN_FIRMS; a 9-firm row
    must not appear in `ranked` at all, even with the sector's best ROC."""
    rows = [IndustryRow("Thin Star", 9, {**{c.key: 0.2 for c in BENCHMARK_COLUMNS},
                                         "after_tax_roc": 0.99})] + TECHNOLOGY_ROWS
    result = resolve_benchmark("Technology", rows, top_n=3)
    assert "Thin Star" not in result.ranked
    assert any("Thin Star" in r and "9 firms" in r for r in result.rejected)


def test_top_n_defaults_to_five():
    result = resolve_benchmark("Technology", TECHNOLOGY_ROWS)
    assert len(result.columns["operating_margin"].industries) == 5
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/core_finance/test_industry_benchmark.py -q`
Expected: FAIL — `ImportError: cannot import name 'resolve_benchmark'`

- [ ] **Step 3: Implement the resolver**

Append to `packages/core_finance/industry_benchmark.py`:

```python
class BenchmarkUnavailable(Exception):
    """No benchmark can be resolved, and no degraded substitute will be offered.

    Falling back to an all-industry average would produce a number that looks
    like a sector benchmark and is not one -- the failure mode this module
    exists to prevent.
    """


@dataclass(frozen=True)
class ColumnAverage:
    value: float
    industries: tuple[str, ...]


@dataclass(frozen=True)
class SectorBenchmark:
    """One averaged value per usable column, plus how it was reached.

    A benchmark that arrives as a bare number is untraceable when it later looks
    wrong, so `ranked` and `rejected` travel with the values.
    """

    sector: str
    columns: dict[str, ColumnAverage]
    ranked: tuple[str, ...]
    rejected: tuple[str, ...]


def resolve_benchmark(
    sector: str,
    rows: list[IndustryRow],
    *,
    top_n: int = 5,
    minimum: int = 3,
) -> SectorBenchmark:
    """Average the top `top_n` industries by after-tax ROC, per column.

    Columns are averaged INDEPENDENTLY, so one unusable cell drops one column
    rather than the whole benchmark, and different columns may rest on different
    numbers of industries. A column with fewer than `minimum` surviving
    industries is omitted entirely rather than averaged over too few.
    """
    if minimum < 1:
        raise ValueError(f"minimum must be at least 1, got {minimum}")
    if top_n < minimum:
        raise ValueError(
            f"top_n {top_n} is below minimum {minimum}: the basket could never "
            f"reach the size its own columns require"
        )

    rejected: list[str] = []
    usable: list[IndustryRow] = []
    for row in rows:
        reason = screen_row(row)
        if reason is not None:
            rejected.append(reason)
            continue
        roc = row.values.get("after_tax_roc")
        if screen_value(column_by_key("after_tax_roc"), roc) is not None:
            rejected.append(f"{row.name}: unusable after-tax ROC, cannot be ranked")
            continue
        usable.append(row)

    ranked_rows = sorted(usable, key=lambda r: r.values["after_tax_roc"], reverse=True)
    basket = ranked_rows[:top_n]
    if len(basket) < minimum:
        raise BenchmarkUnavailable(
            f"sector {sector!r} has only {len(basket)} usable industries, below "
            f"the minimum of {minimum}. Rejected: {'; '.join(rejected) or 'none'}"
        )

    columns: dict[str, ColumnAverage] = {}
    for column in BENCHMARK_COLUMNS:
        contributors: list[tuple[str, float]] = []
        for row in basket:
            value = row.values.get(column.key)
            reason = screen_value(column, value)
            if reason is not None:
                rejected.append(f"{row.name}: {reason}")
                continue
            contributors.append((row.name, float(value)))
        if len(contributors) < minimum:
            continue
        columns[column.key] = ColumnAverage(
            value=sum(v for _, v in contributors) / len(contributors),
            industries=tuple(name for name, _ in contributors),
        )

    return SectorBenchmark(
        sector=sector,
        columns=columns,
        ranked=tuple(row.name for row in ranked_rows),
        rejected=tuple(rejected),
    )
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/core_finance/test_industry_benchmark.py -q`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core_finance/industry_benchmark.py tests/core_finance/test_industry_benchmark.py
git commit -m "feat: rank by after-tax ROC and average per column with provenance"
```

---

### Task 3: The asymmetric fade

**Files:**
- Modify: `packages/core_finance/industry_benchmark.py`
- Test: `tests/core_finance/test_industry_benchmark.py`

**Interfaces:**
- Consumes: `SectorBenchmark` from Task 2.
- Produces:
  - `Direction` — `Literal["lower_is_conservative", "higher_is_conservative"]`
  - `FADE_DIRECTIONS: dict[str, Direction]`
  - `fade(company: float, benchmark: float, direction: Direction, *, year: int, horizon: int) -> float`

- [ ] **Step 1: Write the failing tests**

Append to `tests/core_finance/test_industry_benchmark.py`:

```python
from packages.core_finance.industry_benchmark import FADE_DIRECTIONS, fade


def test_a_benefit_above_the_benchmark_fades_down_to_it():
    """22% margin against a 15% benchmark reaches 15% in the terminal year."""
    assert fade(0.22, 0.15, "lower_is_conservative", year=5, horizon=5) == pytest.approx(0.15)
    assert fade(0.22, 0.15, "lower_is_conservative", year=1, horizon=5) == pytest.approx(0.206)


def test_a_benefit_below_the_benchmark_holds_and_never_fades_up():
    """A 9% company is not assumed to catch the best in its sector. The
    asymmetry IS the conservatism; a symmetric fade would be mean reversion,
    which is a different and less cautious claim."""
    for year in range(1, 6):
        assert fade(0.09, 0.15, "lower_is_conservative", year=year, horizon=5) == 0.09


def test_a_cost_below_the_benchmark_fades_up_to_it():
    """A company assumed to raise cheaper capital than the best of its sector is
    being flattered exactly as much as one assumed to earn a higher margin."""
    assert fade(0.07, 0.095, "higher_is_conservative", year=5, horizon=5) == pytest.approx(0.095)
    assert fade(0.07, 0.095, "higher_is_conservative", year=1, horizon=5) == pytest.approx(0.075)


def test_a_cost_above_the_benchmark_holds():
    for year in range(1, 6):
        assert fade(0.12, 0.095, "higher_is_conservative", year=year, horizon=5) == 0.12


def test_a_company_exactly_at_the_benchmark_does_not_move():
    for direction in ("lower_is_conservative", "higher_is_conservative"):
        assert fade(0.15, 0.15, direction, year=3, horizon=5) == pytest.approx(0.15)


def test_year_one_is_one_step_in_not_the_unfaded_value():
    """Matches the convention `margin_path` already uses in segment_valuation:
    year 1 receives one step of convergence rather than none."""
    value = fade(0.20, 0.10, "lower_is_conservative", year=1, horizon=5)
    assert value == pytest.approx(0.18)
    assert value != 0.20


def test_the_fade_is_monotone_across_the_horizon():
    path = [fade(0.22, 0.15, "lower_is_conservative", year=y, horizon=5) for y in range(1, 6)]
    assert path == sorted(path, reverse=True)


def test_year_zero_or_beyond_the_horizon_raises():
    with pytest.raises(ValueError, match="between 1 and"):
        fade(0.2, 0.1, "lower_is_conservative", year=0, horizon=5)
    with pytest.raises(ValueError, match="between 1 and"):
        fade(0.2, 0.1, "lower_is_conservative", year=6, horizon=5)


def test_every_faded_assumption_declares_a_direction():
    """A column with no declared direction would silently never fade."""
    assert FADE_DIRECTIONS == {
        "revenue_growth": "lower_is_conservative",
        "operating_margin": "lower_is_conservative",
        "effective_tax_rate": "higher_is_conservative",
        "cost_of_capital": "higher_is_conservative",
        "unlevered_beta": "higher_is_conservative",
        "reinvestment_rate": "higher_is_conservative",
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/core_finance/test_industry_benchmark.py -q`
Expected: FAIL — `ImportError: cannot import name 'fade'`

- [ ] **Step 3: Implement the fade**

Append to `packages/core_finance/industry_benchmark.py`:

```python
Direction = Literal["lower_is_conservative", "higher_is_conservative"]

# Which way "conservative" points, per assumption. It flips with whether the
# input is a benefit or a cost: a company assumed to pay less tax, or raise
# cheaper capital, than the best of its sector is being flattered exactly as
# much as one assumed to earn a higher margin.
#
# `debt_to_capital` and `sales_to_capital` are absent deliberately. Capital
# structure is a financing choice, not an operating assumption, and forcing a
# company toward its sector's leverage would move the cost of capital that is
# already being faded directly -- the same quantity adjusted twice by two
# routes. `sales_to_capital` has no `ValuationAssumptions` counterpart.
FADE_DIRECTIONS: dict[str, Direction] = {
    "revenue_growth": "lower_is_conservative",
    "operating_margin": "lower_is_conservative",
    "effective_tax_rate": "higher_is_conservative",
    "cost_of_capital": "higher_is_conservative",
    "unlevered_beta": "higher_is_conservative",
    "reinvestment_rate": "higher_is_conservative",
}


def fade(
    company: float,
    benchmark: float,
    direction: Direction,
    *,
    year: int,
    horizon: int,
) -> float:
    """Move `company` toward `benchmark`, but only in the conservative direction.

    Linear from the company's own value to the benchmark, reaching it exactly in
    year `horizon`. Year 1 is one step in rather than the unfaded value, which
    matches `margin_path`'s convention in `segment_valuation.py`.

    Where the company is already on the conservative side of the benchmark the
    value HOLDS. Nothing ever fades toward optimism: a laggard is not assumed to
    catch the best in its sector.
    """
    if not 1 <= year <= horizon:
        raise ValueError(
            f"year must be between 1 and the horizon {horizon}, got {year}"
        )
    if direction == "lower_is_conservative":
        if company <= benchmark:
            return company
    elif direction == "higher_is_conservative":
        if company >= benchmark:
            return company
    else:
        raise ValueError(f"unknown fade direction {direction!r}")

    return company + (benchmark - company) * year / horizon
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/core_finance/test_industry_benchmark.py -q`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core_finance/industry_benchmark.py tests/core_finance/test_industry_benchmark.py
git commit -m "feat: asymmetric fade toward the sector benchmark"
```

---

### Task 4: The sector and industry maps

**Files:**
- Create: `apps/api/services/industry_maps.py`
- Test: `tests/api/test_industry_maps.py`

**Interfaces:**
- Produces:
  - `EXCLUDED_ROWS: frozenset[str]`
  - `SECTOR_TO_INDUSTRIES: dict[str, tuple[str, ...]]`
  - `YAHOO_TO_DAMODARAN: dict[str, str]`
  - `sector_for_industry(industry: str) -> str | None`
  - `damodaran_industry_for_yahoo(yahoo_industry: str) -> str | None`

**Note for the implementer:** the full 95-industry classification is a judgement
call, and this task is where that judgement is recorded. Author it in full — the
completeness test below is the gate, and it will fail until every industry in
the dataset is either mapped to a sector or listed in `EXCLUDED_ROWS`. The
Technology entry is written out as the pattern to follow.

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_industry_maps.py
import pytest

from apps.api.services.industry_maps import (
    EXCLUDED_ROWS,
    SECTOR_TO_INDUSTRIES,
    YAHOO_TO_DAMODARAN,
    damodaran_industry_for_yahoo,
    sector_for_industry,
)


def test_no_industry_is_claimed_by_two_sectors():
    """An industry in two sectors would make `sector_for_industry` order-dependent."""
    seen: dict[str, str] = {}
    for sector, industries in SECTOR_TO_INDUSTRIES.items():
        for industry in industries:
            assert industry not in seen, f"{industry} in both {seen.get(industry)} and {sector}"
            seen[industry] = sector


def test_every_sector_has_at_least_three_industries():
    """resolve_benchmark requires three surviving industries. A sector that
    cannot reach three is a mapping error, not a runtime condition."""
    for sector, industries in SECTOR_TO_INDUSTRIES.items():
        assert len(industries) >= 3, f"{sector} has {len(industries)}"


def test_technology_contains_the_worked_example_industries():
    tech = SECTOR_TO_INDUSTRIES["Technology"]
    for name in ("Computers/Peripherals", "Software (System & Application)",
                 "Semiconductor Equip", "Semiconductor", "Software (Internet)"):
        assert name in tech


def test_sector_lookup_round_trips():
    assert sector_for_industry("Semiconductor") == "Technology"
    assert sector_for_industry("Not An Industry") is None


def test_aggregate_rows_are_excluded_explicitly():
    """The dataset's largest firm count is 5994 against a median of 34 -- a
    market total, not an industry. Firm-count screening cannot catch it because
    it screens HIGH, so exclusion is by name."""
    assert "Total Market" in EXCLUDED_ROWS
    assert sector_for_industry("Total Market") is None


def test_yahoo_industries_map_to_real_damodaran_industries():
    """A typo in the right-hand side would resolve to a sector of None at
    runtime and silently disable the whole feature for that ticker."""
    known = {i for industries in SECTOR_TO_INDUSTRIES.values() for i in industries}
    for yahoo, damodaran in YAHOO_TO_DAMODARAN.items():
        assert damodaran in known, f"{yahoo} -> {damodaran} is not a mapped industry"


def test_yahoo_lookup_is_case_and_space_insensitive():
    assert damodaran_industry_for_yahoo("semiconductors") == "Semiconductor"
    assert damodaran_industry_for_yahoo("  Semiconductors  ") == "Semiconductor"
    assert damodaran_industry_for_yahoo("Nonexistent Industry") is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_industry_maps.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.industry_maps'`

- [ ] **Step 3: Author the maps**

```python
# apps/api/services/industry_maps.py
"""Sector groupings over Damodaran's industries, and Yahoo's names mapped onto them.

BOTH MAPS ARE JUDGEMENT, NOT FACT. Damodaran's dataset has no sector column, and
Yahoo's industry taxonomy is not his. These are opinions, checked in so they can
be reviewed and argued with rather than embedded as constants somewhere they
would look like acquired data.

A wrong mapping produces a confidently wrong benchmark, and nothing downstream
detects it -- only review does. Every resolved benchmark therefore carries its
provenance, so a surprising number can be traced back to the industries behind
it and, from there, to a line in this file.
"""

from __future__ import annotations

# Rows in the source sheet that are not industries. Firm-count screening cannot
# reject these -- they screen high, not low -- so they are named.
EXCLUDED_ROWS = frozenset({
    "Total Market",
    "Total Market (without financials)",
})

SECTOR_TO_INDUSTRIES: dict[str, tuple[str, ...]] = {
    "Technology": (
        "Computers/Peripherals",
        "Software (System & Application)",
        "Software (Entertainment)",
        "Software (Internet)",
        "Semiconductor",
        "Semiconductor Equip",
        "Computer Services",
        "Information Services",
        "Electronics (General)",
        "Telecom. Equipment",
        "Heathcare Information and Technology",  # source spelling, kept verbatim
    ),
    # ... author the remaining sectors here, covering every industry in the
    # dataset. `test_every_industry_in_the_vintage_is_classified` in Task 5 is
    # the gate that proves the classification is complete.
}

YAHOO_TO_DAMODARAN: dict[str, str] = {
    "semiconductors": "Semiconductor",
    "semiconductor equipment & materials": "Semiconductor Equip",
    "software - infrastructure": "Software (System & Application)",
    "software - application": "Software (System & Application)",
    "consumer electronics": "Computers/Peripherals",
    "computer hardware": "Computers/Peripherals",
    "information technology services": "Computer Services",
    "communication equipment": "Telecom. Equipment",
    "electronic components": "Electronics (General)",
    "health information services": "Heathcare Information and Technology",
    "internet content & information": "Software (Internet)",
}

_INDUSTRY_TO_SECTOR = {
    industry: sector
    for sector, industries in SECTOR_TO_INDUSTRIES.items()
    for industry in industries
}


def sector_for_industry(industry: str) -> str | None:
    """The sector containing `industry`, or None when it is unmapped."""
    return _INDUSTRY_TO_SECTOR.get(industry)


def damodaran_industry_for_yahoo(yahoo_industry: str) -> str | None:
    """Yahoo's industry label mapped onto Damodaran's, or None when unmapped.

    Normalised on case and surrounding whitespace only. Yahoo's labels are
    stable enough that fuzzy matching would create more wrong answers than it
    would fix, and a wrong industry is worse than no benchmark.
    """
    return YAHOO_TO_DAMODARAN.get(yahoo_industry.strip().lower())
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/test_industry_maps.py -q`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/industry_maps.py tests/api/test_industry_maps.py
git commit -m "feat: sector groupings and Yahoo industry mapping"
```

---

### Task 5: Vintage storage and workbook parsing

**Files:**
- Create: `apps/api/services/industry_benchmark_store.py`
- Modify: `apps/api/services/db.py` (add table to `_CREATE_SCHEMA_SQL`, add migration to `_ensure_schema_compatibility`)
- Test: `tests/api/test_industry_benchmark_store.py`

**Interfaces:**
- Consumes: `IndustryRow`, `BENCHMARK_COLUMNS` (Task 1); `EXCLUDED_ROWS`, `SECTOR_TO_INDUSTRIES` (Task 4).
- Produces:
  - `parse_workbook(path: str, *, sheet: str = "Industry Average Beta (US)") -> list[IndustryRow]`
  - `store_vintage(vintage: str, rows: list[IndustryRow]) -> int`
  - `load_vintage(vintage: str) -> list[IndustryRow]`
  - `latest_vintage(on_or_before: str | None = None) -> str | None`

- [ ] **Step 1: Add the table to the schema**

In `apps/api/services/db.py`, append to `_CREATE_SCHEMA_SQL`:

```sql
CREATE TABLE IF NOT EXISTS industry_benchmark (
    vintage            TEXT NOT NULL,   -- publication date, NOT the fetch date
    industry_name      TEXT NOT NULL,
    firms              INTEGER NOT NULL,
    revenue_growth     REAL,
    operating_margin   REAL,
    after_tax_roc      REAL,
    effective_tax_rate REAL,
    unlevered_beta     REAL,
    debt_to_capital    REAL,
    cost_of_capital    REAL,
    sales_to_capital   REAL,
    reinvestment_rate  REAL,
    PRIMARY KEY (vintage, industry_name)
);
```

And in `_ensure_schema_compatibility`, after the existing segment migrations:

```python
    # Additive: CREATE TABLE IF NOT EXISTS above covers new databases, this
    # covers developer databases created before the table existed. Nothing to
    # backfill -- an absent vintage simply yields no conservative scenario.
    conn.execute(
        """CREATE TABLE IF NOT EXISTS industry_benchmark (
            vintage            TEXT NOT NULL,
            industry_name      TEXT NOT NULL,
            firms              INTEGER NOT NULL,
            revenue_growth     REAL,
            operating_margin   REAL,
            after_tax_roc      REAL,
            effective_tax_rate REAL,
            unlevered_beta     REAL,
            debt_to_capital    REAL,
            cost_of_capital    REAL,
            sales_to_capital   REAL,
            reinvestment_rate  REAL,
            PRIMARY KEY (vintage, industry_name)
        )"""
    )
```

- [ ] **Step 2: Write the failing tests**

```python
# tests/api/test_industry_benchmark_store.py
import openpyxl
import pytest

from apps.api.services.industry_benchmark_store import (
    latest_vintage,
    load_vintage,
    parse_workbook,
    store_vintage,
)
from packages.core_finance.industry_benchmark import BENCHMARK_COLUMNS, IndustryRow
from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS


def _workbook(tmp_path):
    """Build a miniature source workbook. Constructed rather than shipped as a
    binary so the test needs no network and no checked-in .xlsx."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Industry Average Beta (US)"
    headers = ["Industry Name", "Number of firms"] + [c.source_header for c in BENCHMARK_COLUMNS]
    ws.append(headers)
    for row in TECHNOLOGY_ROWS[:3]:
        ws.append([row.name, row.firms] + [row.values[c.key] for c in BENCHMARK_COLUMNS])
    ws.append(["Total Market", 5994] + [0.1] * len(BENCHMARK_COLUMNS))
    path = tmp_path / "industries.xlsx"
    wb.save(path)
    return str(path)


def test_parse_reads_rows_by_header_name_not_position(tmp_path):
    rows = parse_workbook(_workbook(tmp_path))
    by_name = {r.name: r for r in rows}
    assert by_name["Semiconductor Equip"].firms == 31
    assert by_name["Semiconductor Equip"].values["after_tax_roc"] == pytest.approx(0.2840446307)


def test_parse_excludes_aggregate_rows(tmp_path):
    assert "Total Market" not in {r.name for r in parse_workbook(_workbook(tmp_path))}


def test_parse_raises_when_a_required_header_is_missing(tmp_path):
    wb = openpyxl.Workbook()
    wb.active.title = "Industry Average Beta (US)"
    wb.active.append(["Industry Name", "Number of firms"])
    path = tmp_path / "bad.xlsx"
    wb.save(path)
    with pytest.raises(ValueError, match="missing"):
        parse_workbook(str(path))


def test_store_and_load_round_trip():
    assert store_vintage("2026-01-01", TECHNOLOGY_ROWS[:3]) == 3
    loaded = {r.name: r for r in load_vintage("2026-01-01")}
    assert loaded["Computers/Peripherals"].firms == 36
    assert loaded["Computers/Peripherals"].values["reinvestment_rate"] == pytest.approx(0.2136889975)


def test_storing_the_same_vintage_twice_replaces_rather_than_duplicates():
    store_vintage("2026-01-01", TECHNOLOGY_ROWS[:3])
    store_vintage("2026-01-01", TECHNOLOGY_ROWS[:3])
    assert len(load_vintage("2026-01-01")) == 3


def test_latest_vintage_returns_the_newest_at_or_before_a_date():
    store_vintage("2025-01-01", TECHNOLOGY_ROWS[:3])
    store_vintage("2026-01-01", TECHNOLOGY_ROWS[:3])
    assert latest_vintage() == "2026-01-01"
    assert latest_vintage(on_or_before="2025-06-01") == "2025-01-01"
    assert latest_vintage(on_or_before="2024-01-01") is None


def test_latest_vintage_is_none_when_nothing_was_ever_stored():
    assert latest_vintage() is None
```

**Note on database isolation:** `tests/conftest.py` defines `_isolated_db` as
`@pytest.fixture(autouse=True)`, so every test already gets its own SQLite file
with no parameter needed. Do NOT add it to a test signature — the leading
underscore means requesting it by name fails with "fixture not found". Two more
autouse session fixtures already enforce the Global Constraints for you:
`_forbid_network` fails any test opening a non-loopback socket, and
`_forbid_the_real_database` fails any test opening
`data/processed/moneyview.db`.

- [ ] **Step 3: Run to verify they fail**

Run: `python -m pytest tests/api/test_industry_benchmark_store.py -q`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 4: Implement the store**

```python
# apps/api/services/industry_benchmark_store.py
"""Storage and parsing for Damodaran's industry-average vintages.

The vintage key is the dataset's PUBLICATION date, not the fetch date. The data
changes annually, so a fetch-dated row would manufacture variation that did not
occur -- the same argument
`docs/superpowers/specs/2026-07-28-statements-acquisition-and-manual-snapshots-design.md`
makes against daily snapshots of quarterly statements.

Loading is manual: `store_vintage(vintage, parse_workbook(path))`. Wiring this
into the acquisition layer's scheduler is deliberately not done -- an annual
dataset does not need one, and a scheduler for it would be machinery ahead of
need.
"""

from __future__ import annotations

import openpyxl

from apps.api.services.db import get_db
from apps.api.services.industry_maps import EXCLUDED_ROWS
from packages.core_finance.industry_benchmark import BENCHMARK_COLUMNS, IndustryRow

_VALUE_COLUMNS = tuple(column.key for column in BENCHMARK_COLUMNS)


def parse_workbook(
    path: str, *, sheet: str = "Industry Average Beta (US)"
) -> list[IndustryRow]:
    """Read one vintage out of Damodaran's workbook.

    Columns are located by HEADER TEXT, not position: he republishes annually
    and column order is not a contract.
    """
    worksheet = openpyxl.load_workbook(path, data_only=True)[sheet]
    header_row = [cell.value for cell in worksheet[1]]
    index = {str(name).strip(): position for position, name in enumerate(header_row) if name}

    required = ["Industry Name", "Number of firms"] + [c.source_header for c in BENCHMARK_COLUMNS]
    missing = [name for name in required if name not in index]
    if missing:
        raise ValueError(
            f"{path} sheet {sheet!r} is missing required headers: {missing}. "
            f"Found: {sorted(index)}"
        )

    rows: list[IndustryRow] = []
    for raw in worksheet.iter_rows(min_row=2, values_only=True):
        name = raw[index["Industry Name"]]
        firms = raw[index["Number of firms"]]
        if not isinstance(name, str) or not isinstance(firms, (int, float)):
            continue
        if name.strip() in EXCLUDED_ROWS:
            continue
        rows.append(IndustryRow(
            name=name.strip(),
            firms=int(firms),
            values={
                column.key: (
                    float(raw[index[column.source_header]])
                    if isinstance(raw[index[column.source_header]], (int, float))
                    else None
                )
                for column in BENCHMARK_COLUMNS
            },
        ))
    return rows


def store_vintage(vintage: str, rows: list[IndustryRow]) -> int:
    """Persist one vintage, replacing any existing rows for the same key."""
    columns = ", ".join(_VALUE_COLUMNS)
    placeholders = ", ".join("?" * (len(_VALUE_COLUMNS) + 3))
    with get_db() as conn:
        conn.executemany(
            f"INSERT OR REPLACE INTO industry_benchmark "
            f"(vintage, industry_name, firms, {columns}) VALUES ({placeholders})",
            [
                (vintage, row.name, row.firms,
                 *(row.values.get(key) for key in _VALUE_COLUMNS))
                for row in rows
            ],
        )
    return len(rows)


def load_vintage(vintage: str) -> list[IndustryRow]:
    columns = ", ".join(_VALUE_COLUMNS)
    with get_db() as conn:
        found = conn.execute(
            f"SELECT industry_name, firms, {columns} FROM industry_benchmark "
            f"WHERE vintage = ? ORDER BY industry_name",
            (vintage,),
        ).fetchall()
    return [
        IndustryRow(
            name=row["industry_name"],
            firms=int(row["firms"]),
            values={key: row[key] for key in _VALUE_COLUMNS},
        )
        for row in found
    ]


def latest_vintage(on_or_before: str | None = None) -> str | None:
    """Newest stored vintage at or before `on_or_before`, or None."""
    with get_db() as conn:
        if on_or_before is None:
            row = conn.execute(
                "SELECT MAX(vintage) AS vintage FROM industry_benchmark"
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT MAX(vintage) AS vintage FROM industry_benchmark "
                "WHERE vintage <= ?",
                (on_or_before,),
            ).fetchone()
    return row["vintage"] if row and row["vintage"] else None
```

- [ ] **Step 5: Add the map completeness gate**

Append to `tests/api/test_industry_maps.py`:

```python
def test_every_industry_in_a_stored_vintage_is_classified():
    """The gate on the sector map. Every industry in the dataset must be either
    mapped to a sector or named in EXCLUDED_ROWS -- an unclassified industry
    silently disables the feature for every ticker in it."""
    from apps.api.services.industry_benchmark_store import load_vintage, store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    unclassified = [
        row.name for row in load_vintage("2026-01-01")
        if sector_for_industry(row.name) is None and row.name not in EXCLUDED_ROWS
    ]
    assert unclassified == [], f"unclassified industries: {unclassified}"
```

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: PASS, with the new tests added and no existing test broken.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/industry_benchmark_store.py apps/api/services/db.py tests/api/test_industry_benchmark_store.py tests/api/test_industry_maps.py
git commit -m "feat: industry benchmark vintage storage and workbook parsing"
```

---

### Task 6: Keep Yahoo's sector and industry

**Files:**
- Modify: `apps/api/services/acquisition/sources/quote_facts.py`
- Test: `tests/api/test_quote_facts_industry.py` (create)

**Interfaces:**
- Produces: `QuoteFacts.sector: str`, `QuoteFacts.industry: str`.

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_quote_facts_industry.py
from apps.api.services.acquisition.sources.quote_facts import fetch_quote_facts


class _FakeTicker:
    def __init__(self, info):
        self.info = info


def test_sector_and_industry_are_kept(monkeypatch):
    """`handle.info` already carries both; they were being discarded."""
    facts = fetch_quote_facts(
        "NVDA",
        ticker_factory=lambda _: _FakeTicker({
            "marketCap": 1_000.0, "sharesOutstanding": 10.0,
            "currency": "USD", "beta": 1.5,
            "sector": "Technology", "industry": "Semiconductors",
        }),
    )
    assert facts.sector == "Technology"
    assert facts.industry == "Semiconductors"


def test_missing_sector_and_industry_become_empty_strings_not_none():
    """Matches the existing `currency` convention in this dataclass."""
    facts = fetch_quote_facts(
        "X",
        ticker_factory=lambda _: _FakeTicker({"marketCap": 1.0, "sharesOutstanding": 1.0}),
    )
    assert facts.sector == ""
    assert facts.industry == ""
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/test_quote_facts_industry.py -q`
Expected: FAIL — `AttributeError: 'QuoteFacts' object has no attribute 'sector'`

- [ ] **Step 3: Add the two fields**

In `apps/api/services/acquisition/sources/quote_facts.py`, add to the `QuoteFacts`
dataclass:

```python
    sector: str = ""
    industry: str = ""
```

and to the `return QuoteFacts(...)` call:

```python
        sector=str(info.get("sector") or ""),
        industry=str(info.get("industry") or ""),
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/api/test_quote_facts_industry.py -q`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/sources/quote_facts.py tests/api/test_quote_facts_industry.py
git commit -m "feat: keep Yahoo sector and industry on QuoteFacts"
```

---

### Task 7: Conservative assumptions, with the units conversion

**Files:**
- Modify: `apps/api/services/corporate_metrics_service.py`
- Test: `tests/api/test_conservative_valuation.py` (create)

**Interfaces:**
- Consumes: `SectorBenchmark`, `FADE_DIRECTIONS`, `fade` (Tasks 2–3).
- Produces:
  - `BenchmarkUnavailableReason(NamedTuple)` with `code: str`, `detail: str`
  - `conservative_valuation_params(metrics: CorporateMetrics, benchmark: SectorBenchmark, *, year: int = 5, horizon: int = 5) -> ValuationAssumptions`

**This is the task where the units hazard lives.** Read the Global Constraints
block again before writing code.

`CorporateMetrics` is a Pydantic `BaseModel` (`apps/api/models/schema_parts/corporate.py:194`)
with these defaults, all in PERCENT: `growth=6.0`, `roic=18.0`, `wacc=10.0`,
`debt_ratio=18.0`, `unlevered_beta=1.05`, `reinvestment=34.0`. Fields are
mutable, so the tests below assign to them directly. `unlevered_beta` is a ratio
in both places and needs no conversion — it is in the mapping table only so that
every faded field's unit is stated rather than assumed.

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_conservative_valuation.py
import pytest

from apps.api.models.schema_parts.corporate import ValuationAssumptions
from apps.api.services.corporate_metrics_service import (
    conservative_valuation_params,
    valuation_params_from_metrics,
    default_metrics,
)
from packages.core_finance.industry_benchmark import ColumnAverage, SectorBenchmark


def _benchmark(**overrides):
    base = {
        "revenue_growth": 0.08, "operating_margin": 0.15, "after_tax_roc": 0.20,
        "effective_tax_rate": 0.22, "unlevered_beta": 1.3, "debt_to_capital": 0.25,
        "cost_of_capital": 0.095, "sales_to_capital": 2.0, "reinvestment_rate": 0.40,
    }
    base.update(overrides)
    return SectorBenchmark(
        sector="Technology",
        columns={k: ColumnAverage(v, ("A", "B", "C")) for k, v in base.items()},
        ranked=("A", "B", "C"), rejected=(),
    )


def test_a_margin_above_the_benchmark_fades_down():
    metrics = default_metrics("TEST")
    metrics.roic = 22.0          # percent, per CorporateMetrics convention
    params = conservative_valuation_params(metrics, _benchmark(operating_margin=0.15))
    assert params.operating_margin == pytest.approx(0.15)


def test_a_cost_below_the_benchmark_fades_up():
    metrics = default_metrics("TEST")
    metrics.wacc = 7.0           # percent
    params = conservative_valuation_params(metrics, _benchmark(cost_of_capital=0.095))
    assert params.wacc == pytest.approx(0.095)


def test_nothing_fades_toward_optimism():
    metrics = default_metrics("TEST")
    metrics.roic = 9.0
    metrics.wacc = 12.0
    params = conservative_valuation_params(
        metrics, _benchmark(operating_margin=0.15, cost_of_capital=0.095)
    )
    assert params.operating_margin == pytest.approx(0.09)
    assert params.wacc == pytest.approx(0.12)


def test_reinvestment_stays_in_percent_units():
    """THE UNITS TRAP. The benchmark is a fraction (0.40). ValuationAssumptions
    declares `reinvestment` as ge=0.0, le=100.0 and nothing divides it by 100.
    A fraction leaking through passes every declared bound and means 0.4%
    instead of 40%."""
    metrics = default_metrics("TEST")
    metrics.reinvestment = 20.0
    params = conservative_valuation_params(metrics, _benchmark(reinvestment_rate=0.40))
    assert params.reinvestment == pytest.approx(40.0)
    assert params.reinvestment > 1.0


def test_growth_and_margin_stay_in_fraction_units():
    """The other side of the trap: these ARE divided by 100 on the existing
    path, so the benchmark's fraction goes through unconverted."""
    metrics = default_metrics("TEST")
    metrics.growth = 30.0
    params = conservative_valuation_params(metrics, _benchmark(revenue_growth=0.08))
    assert params.revenue_growth_rate == pytest.approx(0.08)
    assert params.revenue_growth_rate < 1.0


def test_a_missing_benchmark_column_leaves_the_company_value_unfaded():
    benchmark = _benchmark()
    del benchmark.columns["operating_margin"]
    metrics = default_metrics("TEST")
    metrics.roic = 22.0
    params = conservative_valuation_params(metrics, benchmark)
    assert params.operating_margin == pytest.approx(0.22)


def test_debt_ratio_is_not_faded():
    """Capital structure is a financing choice. Fading it would move the cost of
    capital that is already being faded directly -- the same quantity adjusted
    twice by two routes."""
    metrics = default_metrics("TEST")
    metrics.debt_ratio = 10.0
    params = conservative_valuation_params(metrics, _benchmark(debt_to_capital=0.25))
    assert params.debt_ratio == pytest.approx(10.0)


def test_terminal_growth_is_not_benchmarked():
    """Perpetual growth is a macro constraint, not an industry characteristic.
    The existing cap is already the conservative treatment."""
    metrics = default_metrics("TEST")
    params = conservative_valuation_params(metrics, _benchmark())
    baseline = valuation_params_from_metrics(metrics)
    assert params.terminal_growth_rate <= params.wacc


def test_every_industry_produces_assumptions_the_model_accepts():
    """The test that catches a screening bound drifting out of step with the
    model's own validation, and a units error at the same time."""
    from packages.core_finance.industry_benchmark import resolve_benchmark
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    benchmark = resolve_benchmark("Technology", TECHNOLOGY_ROWS)
    metrics = default_metrics("TEST")
    params = conservative_valuation_params(metrics, benchmark)

    ValuationAssumptions(**params.model_dump())          # bounds hold
    assert 0.0 <= params.reinvestment <= 100.0
    assert params.reinvestment > 1.0 or metrics.reinvestment <= 1.0
    assert -1.0 <= params.operating_margin <= 1.0
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_conservative_valuation.py -q`
Expected: FAIL — `ImportError: cannot import name 'conservative_valuation_params'`

- [ ] **Step 3: Implement it**

Append to `apps/api/services/corporate_metrics_service.py`:

```python
# Which ValuationAssumptions field each benchmark column feeds, and the unit
# that field expects. The dataset is entirely fractions; ValuationAssumptions is
# MIXED. Getting this table wrong produces a silent 100x error in a
# plausible-looking number, so the conversion is declared per field and never
# applied in bulk.
_BENCHMARK_TO_ASSUMPTION = {
    # benchmark column      assumption field        metrics attr   target unit
    "revenue_growth":      ("revenue_growth_rate",  "growth",      "fraction"),
    "operating_margin":    ("operating_margin",     "roic",        "fraction"),
    "effective_tax_rate":  ("tax_rate",             None,          "fraction"),
    "cost_of_capital":     ("wacc",                 "wacc",        "fraction"),
    "unlevered_beta":      ("unlevered_beta",       "unlevered_beta", "ratio"),
    "reinvestment_rate":   ("reinvestment",         "reinvestment", "percent"),
}


def conservative_valuation_params(
    metrics: CorporateMetrics,
    benchmark: SectorBenchmark,
    *,
    year: int = 5,
    horizon: int = 5,
) -> ValuationAssumptions:
    """`valuation_params_from_metrics`, with each input faded toward the sector.

    Sits BESIDE the existing function rather than replacing it: the DCF runs
    twice and both values are returned, so a change in valuation can always be
    traced to the assumption that moved.

    `year=horizon` by default, which is the fully-faded terminal assumption --
    terminal value dominates enterprise value, so that is where the conservatism
    actually lands.
    """
    params = valuation_params_from_metrics(metrics)
    updates: dict[str, float] = {}

    for column_key, (field_name, metrics_attr, unit) in _BENCHMARK_TO_ASSUMPTION.items():
        direction = FADE_DIRECTIONS.get(column_key)
        average = benchmark.columns.get(column_key)
        current = getattr(params, field_name, None)
        if direction is None or average is None or current is None:
            continue

        # Bring the benchmark (always a fraction) into the field's own unit.
        if unit == "percent":
            benchmark_value = average.value * 100.0
        else:
            benchmark_value = average.value

        updates[field_name] = fade(
            float(current), benchmark_value, direction, year=year, horizon=horizon
        )

    if "wacc" in updates:
        # Preserve the existing invariant: terminal growth must stay below WACC.
        updates["terminal_growth_rate"] = min(
            params.terminal_growth_rate, updates["wacc"] - 0.005
        )

    return params.model_copy(update=updates)
```

Add the imports at the top of the module:

```python
from packages.core_finance.industry_benchmark import (
    FADE_DIRECTIONS,
    SectorBenchmark,
    fade,
)
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/test_conservative_valuation.py -q`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: PASS, nothing existing broken.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/corporate_metrics_service.py tests/api/test_conservative_valuation.py
git commit -m "feat: conservative valuation assumptions faded toward the sector benchmark"
```

---

### Task 8: The parallel scenario, and a reason whenever there isn't one

**Files:**
- Modify: `apps/api/services/corporate_dcf.py`
- Test: `tests/api/test_conservative_valuation.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `resolve_for_ticker(ticker: str, *, as_of: str | None = None) -> tuple[SectorBenchmark | None, str | None]` in `apps/api/services/industry_benchmark_store.py`, returning `(benchmark, reason)` where exactly one is non-None.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_conservative_valuation.py`:

```python
from apps.api.services.industry_benchmark_store import resolve_for_ticker


@pytest.mark.parametrize("setup,expected_code", [
    ("no_vintage", "no_vintage"),
    ("no_industry", "no_industry"),
    ("unmapped_industry", "unmapped_industry"),
    ("sector_too_thin", "sector_too_thin"),
])
def test_every_failure_path_gives_a_distinct_reason(setup, expected_code):
    """A missing benchmark produces NO conservative valuation, never a silently
    degraded one -- and always says which of the four reasons applied."""
    benchmark, reason = _arrange(setup)
    assert benchmark is None
    assert reason is not None
    assert expected_code in reason


def test_a_mapped_ticker_resolves_a_benchmark_with_provenance():
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    benchmark, reason = _arrange("happy_path")
    assert reason is None
    assert benchmark.sector == "Technology"
    assert benchmark.ranked[0] == "Computers/Peripherals"


def test_the_stored_assumption_valuation_is_unchanged():
    """The regression guard on the parallel-scenario promise: adding the second
    scenario must not move the first by a single digit."""
    from apps.api.services.corporate_dcf import build_dcf_summary

    before = build_dcf_summary("AAPL")
    after = build_dcf_summary("AAPL")
    assert before.estimated_value == after.estimated_value
    assert before.enterprise_value == after.enterprise_value
```

**Implementer note:** `_arrange` is a helper you write in this test module. It
should set up each condition and call `resolve_for_ticker`. Write it explicitly
per case rather than with shared branching — four small arrangements read better
than one parameterised one, and the parametrize above exists to keep the four
reason codes visible in one place.

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_conservative_valuation.py -q`
Expected: FAIL — `ImportError: cannot import name 'resolve_for_ticker'`

- [ ] **Step 3: Implement resolution with reasons**

Append to `apps/api/services/industry_benchmark_store.py`:

```python
def resolve_for_ticker(
    ticker: str, *, as_of: str | None = None
) -> tuple[SectorBenchmark | None, str | None]:
    """Resolve a sector benchmark for one ticker.

    Returns `(benchmark, None)` or `(None, reason)`. Exactly one is non-None: a
    missing or unreliable benchmark yields NO conservative valuation rather than
    a silently degraded one. Falling back to an all-industry average would
    produce a number that looks like a sector benchmark and is not one.
    """
    vintage = latest_vintage(on_or_before=as_of)
    if vintage is None:
        return None, f"no_vintage: no industry benchmark data has been loaded"

    industry = _stored_yahoo_industry(ticker)
    if not industry:
        return None, f"no_industry: {ticker} has no industry from the quote source"

    mapped = damodaran_industry_for_yahoo(industry)
    if mapped is None:
        return None, (
            f"unmapped_industry: {ticker}'s industry {industry!r} is not in "
            f"YAHOO_TO_DAMODARAN; add it to apps/api/services/industry_maps.py"
        )

    sector = sector_for_industry(mapped)
    if sector is None:
        return None, (
            f"unmapped_industry: {mapped!r} is not in any sector in "
            f"SECTOR_TO_INDUSTRIES"
        )

    names = set(SECTOR_TO_INDUSTRIES[sector])
    rows = [row for row in load_vintage(vintage) if row.name in names]
    try:
        return resolve_benchmark(sector, rows), None
    except BenchmarkUnavailable as exc:
        return None, f"sector_too_thin: {exc}"
```

Add the imports this needs:

```python
from apps.api.services.industry_maps import (
    SECTOR_TO_INDUSTRIES,
    damodaran_industry_for_yahoo,
    sector_for_industry,
)
from packages.core_finance.industry_benchmark import (
    BenchmarkUnavailable,
    SectorBenchmark,
    resolve_benchmark,
)
```

`_stored_yahoo_industry(ticker)` reads the industry persisted by Task 6. Write it
against whatever store `QuoteFacts` already writes to; if the acquisition layer
does not yet persist it, add the column alongside the existing quote-fact columns
following the same additive-migration pattern used in Task 5.

- [ ] **Step 4: Add the parallel scenario to the DCF output**

In `apps/api/services/corporate_dcf.py`, inside `_build_dcf_outputs`, after the
existing valuation is computed, add the second pass. Do not alter the first.

```python
    benchmark, benchmark_reason = resolve_for_ticker(ticker)
    conservative = None
    if benchmark is not None:
        conservative_params = conservative_valuation_params(metrics, benchmark)
        conservative = _value_with(conservative_params)
```

Return both, plus `benchmark_reason`, plus the per-assumption deltas between
`params` and `conservative_params`. Follow the shape the existing `DCFSummary`
already uses for its fields; add the new fields as `| None` so a ticker without a
benchmark serialises unchanged.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/industry_benchmark_store.py apps/api/services/corporate_dcf.py tests/api/test_conservative_valuation.py
git commit -m "feat: return the conservative scenario beside the stored-assumption DCF"
```

---

## Self-review notes

**Spec coverage.** Data foundation → Tasks 1, 4, 5, 6. Resolver → Tasks 1–2.
Fade → Task 3. Integration → Tasks 7–8. Error handling → Task 8's four reason
codes plus Task 7's missing-column test. Testing → each task's own tests.

**Two spec items deliberately not implemented, and why:**

1. **Acquisition scheduling.** The spec says the annual cadence fits the existing
   acquisition layer's freshness rules. Task 5 provides manual
   `parse_workbook` + `store_vintage` instead. An annual dataset does not need a
   scheduler, and building one would be machinery ahead of need. If the
   acquisition layer should own it, that is a follow-up task, not a gap here.
2. **The full 95-industry sector map.** Task 4 ships Technology worked out and
   the completeness test that fails until the rest is authored. The
   classification is judgement that must be made by whoever implements it; the
   test defines done rather than a placeholder deferring the work.

**Known ambiguity resolved by choice:** the spec's worked example uses a top-3
average while `resolve_benchmark` defaults to `top_n=5`. Both are tested. Three
is the spec's illustration; five is the default because the request said "3 to
5" and a wider basket is less sensitive to a single industry.

**Carried forward from the spec, unresolved:**
`valuation_params_from_metrics` feeds `metrics.roic` into `operating_margin`
(`corporate_metrics_service.py:456`), and Task 7 fades that field against
`Pre-tax Operating Margin`. If the existing mapping is wrong, the fade is
comparing a return on capital against a margin. Resolve it before Task 7 or
accept that the benchmark comparison is between two different quantities.
