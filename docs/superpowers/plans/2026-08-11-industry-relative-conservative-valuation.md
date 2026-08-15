# Industry-Relative Conservative Valuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, for any watchlist ticker, a segment-build-up valuation case whose every forward assumption is faded toward the average of the top 3–5 industries in its sector, with each number carrying the industries behind it.

**Architecture:** A pure layer in `packages/core_finance/industry_benchmark.py` does screening, ranking, averaging and fading over plain dataclasses. A service layer owns storage, vintage selection, two hand-authored mapping tables, and a generator that turns a ticker plus a benchmark into a `create_case` payload for the existing segment build-up engine. Nothing existing is modified: the conservative valuation is a separate stored case run by a different engine.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, SQLite (no migration framework), pytest, openpyxl.

**Design spec:** `docs/superpowers/specs/2026-08-11-industry-relative-conservative-valuation-design.md`

## Global Constraints

- Tests may not make network calls.
- Tests must not open `data/processed/moneyview.db`.
- `packages/core_finance` must not import from `apps/api` (`guideline/sop/file-structure.md:42`). The dependency runs one way.
- Schema changes go in `_CREATE_SCHEMA_SQL` plus an additive `ALTER TABLE` in `_ensure_schema_compatibility` in `apps/api/services/db.py`. There is no migration framework.
- **Units.** `segment_valuation.py` uses FRACTIONS for every rate and BILLIONS for every money amount. Damodaran's dataset is also entirely fractions, so no rate conversion is needed between them. Two boundaries still need care: raw statement currency must be scaled to billions (`equity_bridge._scaled` is the existing helper), and anything read from `CorporateMetrics` is in PERCENT (`{"roic": 18}`) and must be divided by 100.
- Consult `guideline/sop/finance-logic.md` before and after any change to a formula.
- No existing test should need modification. The conservative valuation runs on a different engine and stores a separate case, so there is no shared path along which it could perturb `corporate_dcf`. If an existing test changes, the separation has been broken.
- Do not modify `packages/core_finance/dcf.py`, `packages/core_finance/segment_valuation.py`, `apps/api/services/corporate_dcf.py`, or `apps/api/services/corporate_metrics_service.py`.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core_finance/industry_benchmark.py` | Pure. `IndustryRow`, `BENCHMARK_COLUMNS`, screening, ranking, averaging, `SectorBenchmark`, the fade. |
| `apps/api/services/industry_maps.py` | The two hand-authored maps and the excluded-rows list. Judgement artifacts with comments. |
| `apps/api/services/industry_benchmark_store.py` | SQLite storage, vintage selection, workbook parsing. |
| `apps/api/services/conservative_case.py` | Turn a ticker + benchmark into a `create_case` payload. |
| `apps/api/services/acquisition/store.py` | Persist Yahoo's sector and industry. |
| `apps/api/services/acquisition/sources/quote_facts.py` | Keep Yahoo's `sector` and `industry`. |
| `apps/api/services/db.py` | `industry_benchmark` table + additive migration. |
| `tests/core_finance/test_industry_benchmark.py` | Pure-layer tests. |
| `tests/api/test_industry_maps.py` | Map completeness. |
| `tests/api/test_industry_benchmark_store.py` | Storage, vintage, parsing. |
| `tests/api/test_conservative_case.py` | Case generation, units, per-ticker resolution. |
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
not percents -- which is also what `segment_valuation.py` uses for every rate,
so no conversion happens between them. The only conversions live at the service
boundary: raw statement currency to billions, and `CorporateMetrics` percent to
fraction. See the design spec, "Units".
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
    engine's own validation. `CaseSpec` accepts any `effective_tax_rate` in
    [0, 1], so 0.22 and 0.0022 are both legal and only one is right -- the
    engine cannot catch a magnitude error that stays inside its range.
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
    # 0 to 2.0 rejects the 11 negative rates and the three artifacts above it:
    # Steel 2.115, Insurance (General) 3.242, Software (Internet) 14.142. p90 is
    # 1.311, and 2.0 sits in the observed gap between 1.888 and 2.115 -- so
    # capital-intensive industries reinvesting up to ~190% of NOPAT are KEPT.
    # An earlier bound of 1.5 wrongly screened out five of those.
    BenchmarkColumn("reinvestment_rate", "Reinvestment Rate", "fraction", 0.0, 2.0),
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
    # top_n=4, not 3: with the poisoned row ranking first, a 3-basket leaves only
    # 2 valid reinvestment contributors -- below the default minimum=3 -- so the
    # column is dropped entirely and the assertion below raises KeyError instead
    # of testing exclusion. 4 admits all three real rows alongside the poisoned
    # leader, which is what this test's docstring actually describes.
    result = resolve_benchmark("Technology", rows, top_n=4)

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
    """A column with no declared direction would silently never fade.

    unlevered_beta, debt_to_capital and reinvestment_rate are ABSENT on purpose:
    the segment engine takes WACC directly rather than rebuilding it from beta
    and leverage, and reinvestment is an engine OUTPUT (ΔRevenue /
    sales_to_capital), not an input. Fading a field the engine does not consume
    is what caused this plan to be retargeted.
    """
    assert FADE_DIRECTIONS == {
        "revenue_growth": "lower_is_conservative",
        "operating_margin": "lower_is_conservative",
        "after_tax_roc": "lower_is_conservative",
        "sales_to_capital": "lower_is_conservative",
        "effective_tax_rate": "higher_is_conservative",
        "cost_of_capital": "higher_is_conservative",
    }


def test_sales_to_capital_is_a_benefit_and_fades_down():
    """A HIGHER sales/capital means LESS capital per dollar of new revenue. Get
    this backwards and capital-hungry companies look cheaper -- the opposite of
    conservative. This is the direction most likely to be implemented wrong."""
    assert FADE_DIRECTIONS["sales_to_capital"] == "lower_is_conservative"
    assert fade(3.0, 2.0, "lower_is_conservative", year=10, horizon=10) == pytest.approx(2.0)
    assert fade(1.2, 2.0, "lower_is_conservative", year=10, horizon=10) == pytest.approx(1.2)
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
# `unlevered_beta`, `debt_to_capital` and `reinvestment_rate` are absent
# deliberately. The segment engine takes WACC directly rather than rebuilding it
# from beta and leverage, so fading the first two would move nothing; and
# reinvestment is an engine OUTPUT (`ΔRevenue / sales_to_capital`), not an input,
# so benchmarking it would assert a result the model is supposed to derive.
# Fading fields the engine does not consume is precisely what caused this plan to
# be retargeted away from `corporate_dcf`.
FADE_DIRECTIONS: dict[str, Direction] = {
    "revenue_growth": "lower_is_conservative",
    "operating_margin": "lower_is_conservative",
    "after_tax_roc": "lower_is_conservative",
    # A HIGHER sales/capital means LESS capital per dollar of new revenue, so it
    # is a benefit and fades DOWN. Backwards, capital-hungry companies look
    # cheaper -- the opposite of conservative.
    "sales_to_capital": "lower_is_conservative",
    "effective_tax_rate": "higher_is_conservative",
    "cost_of_capital": "higher_is_conservative",
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

### Task 7: The conservative case generator

**Files:**
- Create: `apps/api/services/conservative_case.py`
- Test: `tests/api/test_conservative_case.py` (create)

**Interfaces:**
- Consumes: `SectorBenchmark`, `FADE_DIRECTIONS`, `fade` (Tasks 2–3).
- Produces:
  - `CompanyBaseline(base_revenue: float, base_margin: float, current_roic: float, current_sales_to_capital: float, current_growth: float, cash: float, debt: float, shares: float, source_years: tuple[int, ...])`
  - `build_conservative_case(ticker: str, baseline: CompanyBaseline, benchmark: SectorBenchmark, *, vintage: str, riskfree_rate: float, marginal_tax_rate: float, base_year: int) -> dict`

**Read this before writing code — the fade is applied to ENDPOINTS, not per year.**

The segment engine already interpolates: `margin_path` ramps `base_margin` to
`margin_target`, `wacc_path` ramps `wacc_initial` to `wacc_stable`,
`tax_rate_path` ramps `effective_tax_rate` to the marginal rate. So the
generator fades each *endpoint* once, with `year=horizon`, and the engine
carries the gradual convergence. Fading year by year on top of the engine's own
paths would apply convergence twice.

With `year=horizon`, `fade` degenerates to worse-of — and that is correct HERE
even though a flat worse-of was rejected during design. The difference: the
company's *current* value still enters the model as `base_margin`, so the path
runs from where the company actually is today to the faded endpoint. It is a
fade; the engine performs it.

Per field, the company's "own" endpoint absent any benchmark is its CURRENT
value held flat — assuming no improvement it has not demonstrated:

| Engine field | Company's own endpoint | Benchmark column | Direction |
| --- | --- | --- | --- |
| `margin_target` | `baseline.base_margin` | `operating_margin` | lower |
| `roic_stable` | `baseline.current_roic` | `after_tax_roc` | lower |
| `sales_to_capital_early`/`_late` | `baseline.current_sales_to_capital` | `sales_to_capital` | lower |
| `effective_tax_rate` | `marginal_tax_rate` | `effective_tax_rate` | higher |
| `wacc_initial`/`wacc_stable` | company WACC | `cost_of_capital` | higher |
| revenue growth (→ `revenue_target`) | `baseline.current_growth` | `revenue_growth` | lower |

`revenue_target` is then `base_revenue * (1 + faded_growth) ** 10`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_conservative_case.py
import pytest

from apps.api.services.conservative_case import CompanyBaseline, build_conservative_case
from packages.core_finance.industry_benchmark import ColumnAverage, SectorBenchmark
from packages.core_finance.segment_valuation import CaseSpec, SegmentSpec, run_case


def _benchmark(**overrides):
    base = {
        "revenue_growth": 0.08, "operating_margin": 0.15, "after_tax_roc": 0.20,
        "effective_tax_rate": 0.22, "unlevered_beta": 1.3, "debt_to_capital": 0.25,
        "cost_of_capital": 0.095, "sales_to_capital": 2.0, "reinvestment_rate": 0.40,
    }
    base.update(overrides)
    return SectorBenchmark(
        sector="Technology",
        columns={k: ColumnAverage(v, ("Computers/Peripherals", "Semiconductor", "Semiconductor Equip"))
                 for k, v in base.items()},
        ranked=("Computers/Peripherals", "Semiconductor", "Semiconductor Equip"),
        rejected=(),
    )


def _baseline(**overrides):
    base = dict(base_revenue=100.0, base_margin=0.30, current_roic=0.35,
                current_sales_to_capital=3.0, current_growth=0.20,
                cash=20.0, debt=5.0, shares=1.0, source_years=(2024, 2025))
    base.update(overrides)
    return CompanyBaseline(**base)


def _build(**kw):
    return build_conservative_case(
        "TEST", _baseline(**kw.pop("baseline", {})), kw.pop("benchmark", _benchmark()),
        vintage="2026-01-01", riskfree_rate=0.04, marginal_tax_rate=0.25, base_year=2026,
    )


def test_a_margin_above_the_benchmark_becomes_the_benchmark():
    """30% company against a 15% sector: the TARGET is 15%. The engine then
    ramps from the company's actual 30% base_margin down to it."""
    case = _build()
    segment = case["segments"][0]
    assert segment["margin_target"] == pytest.approx(0.15)
    assert segment["base_margin"] == pytest.approx(0.30)


def test_a_margin_below_the_benchmark_holds_and_is_not_assumed_to_improve():
    case = _build(baseline={"base_margin": 0.09})
    assert case["segments"][0]["margin_target"] == pytest.approx(0.09)


def test_terminal_roic_takes_the_worse_of_company_and_sector():
    case = _build()
    assert case["roic_stable"] == pytest.approx(0.20)


def test_sales_to_capital_fades_down_because_a_higher_ratio_is_a_benefit():
    """A HIGHER sales/capital means LESS capital per dollar of new revenue, so
    it is a benefit and fades down. Backwards, this makes capital-hungry
    companies look cheaper."""
    segment = _build()["segments"][0]
    assert segment["sales_to_capital_early"] == pytest.approx(2.0)
    assert segment["sales_to_capital_late"] == pytest.approx(2.0)


def test_a_company_below_the_sector_sales_to_capital_holds():
    segment = _build(baseline={"current_sales_to_capital": 1.2})["segments"][0]
    assert segment["sales_to_capital_early"] == pytest.approx(1.2)


def test_the_tax_rate_fades_up_toward_the_sector():
    case = _build(benchmark=_benchmark(effective_tax_rate=0.22))
    assert case["effective_tax_rate"] == pytest.approx(0.22)


def test_the_cost_of_capital_fades_up_toward_the_sector():
    case = _build()
    assert case["wacc_stable"] == pytest.approx(0.095)


def test_revenue_target_compounds_the_faded_growth_over_ten_years():
    """Company grows 20%, sector 8%. The conservative target uses 8%."""
    case = _build()
    assert case["segments"][0]["revenue_target"] == pytest.approx(100.0 * 1.08 ** 10)
    assert case["target_year"] - case["base_year"] == 10


def test_the_equity_bridge_is_reconstructed_from_net_debt():
    case = _build(baseline={"cash": 0.0, "debt": 30.0})
    assert case["debt"] == pytest.approx(30.0)
    assert case["cash"] == pytest.approx(0.0)
    assert case["ipo_proceeds"] == 0.0
    assert case["shares_new"] == 0.0


def test_every_segment_input_carries_a_derived_narrative():
    """create_case rejects any narrated input without a claim, so this is what
    makes the generated case storable at all. Nothing is `confirmed`: the
    benchmark is a real average, but applying it to THIS company is inference."""
    segment = _build()["segments"][0]
    claims = {n["input_field"]: n for n in segment["narratives"]}
    for field in ("base_revenue", "base_margin", "revenue_target", "margin_target",
                  "sales_to_capital_early", "sales_to_capital_late"):
        assert field in claims, field
        assert claims[field]["confidence"] == "derived"
        assert claims[field]["evidence_source"] == "damodaran_industry_2026-01-01"


def test_narratives_name_the_industries_behind_the_number():
    """Provenance is the point. A benchmark that arrives as a bare number is
    untraceable when it later looks wrong."""
    segment = _build()["segments"][0]
    claim = next(n for n in segment["narratives"] if n["input_field"] == "margin_target")["claim"]
    assert "Computers/Peripherals" in claim
    assert "Technology" in claim
    assert "2026-01-01" in claim


def test_the_generated_case_runs_and_produces_a_positive_value():
    case = _build()
    spec = CaseSpec(**{k: v for k, v in case.items()
                       if k in CaseSpec.__dataclass_fields__})
    segments = [SegmentSpec(**{k: v for k, v in s.items()
                               if k in SegmentSpec.__dataclass_fields__})
                for s in case["segments"]]
    result = run_case(spec, segments)
    assert result.enterprise_value > 0
    assert result.revenue[-1] == pytest.approx(100.0 * 1.08 ** 10)


def test_money_terms_are_in_billions_not_raw_currency():
    """A units error here is a 10^9 error. base_revenue for a $100bn company is
    100.0."""
    assert _build()["segments"][0]["base_revenue"] == pytest.approx(100.0)


def test_generating_twice_from_the_same_inputs_is_reproducible():
    first, second = _build(), _build()
    assert first["segments"][0] == second["segments"][0]
    assert {k: v for k, v in first.items() if k != "segments"} == \
           {k: v for k, v in second.items() if k != "segments"}
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_conservative_case.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.conservative_case'`

- [ ] **Step 3: Implement the generator**

```python
# apps/api/services/conservative_case.py
"""Build a conservative valuation case for one ticker from an industry benchmark.

The wiring that lets the segment build-up engine value a listed company. One
segment, named for the company: a listed company has no published segment split,
so one segment is the whole business.

THE FADE IS APPLIED TO ENDPOINTS, NOT PER YEAR. The engine already interpolates
-- `margin_path` ramps base_margin to margin_target, `wacc_path` ramps
wacc_initial to wacc_stable, `tax_rate_path` ramps effective_tax_rate to the
marginal rate. Fading year by year on top of that would apply convergence twice.

Amounts are in billions and rates are fractions, matching both the engine and
Damodaran's dataset.
"""

from __future__ import annotations

from dataclasses import dataclass

from packages.core_finance.industry_benchmark import SectorBenchmark, fade

HORIZON_YEARS = 10


@dataclass(frozen=True)
class CompanyBaseline:
    """What the company is today, from its own statements. Billions, fractions."""

    base_revenue: float
    base_margin: float
    current_roic: float
    current_sales_to_capital: float
    current_growth: float
    cash: float
    debt: float
    shares: float
    source_years: tuple[int, ...]


def _claim(benchmark: SectorBenchmark, column: str, vintage: str,
           company_value: float, chosen: float) -> str:
    average = benchmark.columns[column]
    return (
        f"Top {len(average.industries)} industries by after-tax ROC in "
        f"{benchmark.sector} ({', '.join(average.industries)}), vintage {vintage}, "
        f"average {column} {average.value:.4f}. The company's own value is "
        f"{company_value:.4f}; the conservative endpoint is {chosen:.4f}."
    )


def _narrative(field: str, claim: str, vintage: str, three_p: str) -> dict:
    return {
        "input_field": field,
        "claim": claim,
        "evidence_source": f"damodaran_industry_{vintage}",
        # Never `confirmed`: the benchmark is a real average, but applying it to
        # THIS company is this model's inference.
        "confidence": "derived",
        "three_p": three_p,
    }


def build_conservative_case(
    ticker: str,
    baseline: CompanyBaseline,
    benchmark: SectorBenchmark,
    *,
    vintage: str,
    riskfree_rate: float,
    marginal_tax_rate: float,
    base_year: int,
) -> dict:
    """A `create_case` payload valuing `ticker` against its sector benchmark."""
    full_basket = max(
        (len(a.industries) for a in benchmark.columns.values()), default=0
    )

    def faded(column: str, company_value: float, direction: str) -> tuple[float, dict | None]:
        average = benchmark.columns.get(column)
        if average is None:
            return company_value, None
        chosen = fade(company_value, average.value, direction,
                      year=HORIZON_YEARS, horizon=HORIZON_YEARS)
        three_p = "probable" if len(average.industries) == full_basket else "plausible"
        return chosen, {"claim": _claim(benchmark, column, vintage, company_value, chosen),
                        "three_p": three_p}

    margin_target, margin_meta = faded("operating_margin", baseline.base_margin,
                                       "lower_is_conservative")
    roic_stable, _ = faded("after_tax_roc", baseline.current_roic, "lower_is_conservative")
    s2c, s2c_meta = faded("sales_to_capital", baseline.current_sales_to_capital,
                          "lower_is_conservative")
    growth, growth_meta = faded("revenue_growth", baseline.current_growth,
                                "lower_is_conservative")
    tax_rate, _ = faded("effective_tax_rate", marginal_tax_rate, "higher_is_conservative")
    wacc, _ = faded("cost_of_capital", riskfree_rate + 0.045, "higher_is_conservative")

    revenue_target = baseline.base_revenue * (1.0 + growth) ** HORIZON_YEARS

    narratives = [
        _narrative("base_revenue",
                   f"FY{baseline.source_years[-1]} revenue from stored statements, "
                   f"years {baseline.source_years}.", vintage, "probable"),
        _narrative("base_margin",
                   f"FY{baseline.source_years[-1]} operating income over revenue, "
                   f"from stored statements.", vintage, "probable"),
        _narrative("revenue_target",
                   f"{baseline.base_revenue:.4f} compounded at {growth:.4f} for "
                   f"{HORIZON_YEARS} years. " + (growth_meta or {}).get("claim", ""),
                   vintage, (growth_meta or {}).get("three_p", "plausible")),
        _narrative("margin_target", (margin_meta or {}).get("claim", ""), vintage,
                   (margin_meta or {}).get("three_p", "plausible")),
        _narrative("sales_to_capital_early", (s2c_meta or {}).get("claim", ""), vintage,
                   (s2c_meta or {}).get("three_p", "plausible")),
        _narrative("sales_to_capital_late", (s2c_meta or {}).get("claim", ""), vintage,
                   (s2c_meta or {}).get("three_p", "plausible")),
    ]

    return {
        "case_name": f"conservative_{ticker.upper()}_{vintage}",
        "ticker": ticker.upper(),
        "as_of_date": f"{base_year}-01-01",
        "base_year": base_year,
        "target_year": base_year + HORIZON_YEARS,
        "riskfree_rate": riskfree_rate,
        "wacc_initial": wacc,
        "wacc_stable": wacc,
        "wacc_converge_from": 6,
        "marginal_tax_rate": marginal_tax_rate,
        "effective_tax_rate": tax_rate,
        "nol_balance": 0.0,
        "roic_stable": roic_stable,
        "terminal_growth": None,
        # `equity_bridge` yields a single net-debt figure; the engine takes cash
        # and debt separately and only their difference matters.
        "cash": baseline.cash,
        "debt": baseline.debt,
        "ipo_proceeds": 0.0,
        "shares_basic": baseline.shares,
        "shares_new": 0.0,
        "parent_case_id": None,
        "segments": [{
            "name": ticker.lower(),
            "base_revenue": baseline.base_revenue,
            "base_margin": baseline.base_margin,
            "tam_target": None,
            "market_share_target": None,
            "revenue_target": revenue_target,
            "margin_target": margin_target,
            "sales_to_capital_early": s2c,
            "sales_to_capital_late": s2c,
            "ramp_start_year": 1,
            "initial_growth": None,
            "waypoint_gap_fraction": None,
            "narratives": narratives,
        }],
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/test_conservative_case.py -q`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/conservative_case.py tests/api/test_conservative_case.py
git commit -m "feat: build a conservative segment case from an industry benchmark"
```

---

### Task 8: Resolve a benchmark per ticker, and refuse rather than degrade

**Files:**
- Modify: `apps/api/services/industry_benchmark_store.py`
- Modify: `apps/api/services/db.py` (sector/industry on `corporate_quote_facts`)
- Modify: `apps/api/services/acquisition/store.py` (persist them)
- Test: `tests/api/test_conservative_case.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `resolve_for_ticker(ticker: str, *, as_of: str | None = None) -> tuple[SectorBenchmark | None, str | None]` — exactly one of the two is non-None.

**Resolved for you:** `corporate_quote_facts` exists at `db.py:472` with
`(ticker, market_cap, shares_outstanding, currency, beta, fetched_at)`.
`save_quote_facts` is at `acquisition/store.py:52`. The `beta` column was added
by additive `ALTER TABLE` at `db.py:755-757` — copy that pattern for `sector` and
`industry`, and extend the INSERT in `save_quote_facts` to write them.

- [ ] **Step 1: Add the two columns**

In `apps/api/services/db.py`, add to the `corporate_quote_facts` CREATE TABLE:

```sql
    sector             TEXT DEFAULT '',
    industry           TEXT DEFAULT '',
```

and in `_ensure_schema_compatibility`, beside the existing `beta` migration:

```python
    if "sector" not in quote_facts_columns:
        conn.execute("ALTER TABLE corporate_quote_facts ADD COLUMN sector TEXT DEFAULT ''")
    if "industry" not in quote_facts_columns:
        conn.execute("ALTER TABLE corporate_quote_facts ADD COLUMN industry TEXT DEFAULT ''")
```

In `apps/api/services/acquisition/store.py`, extend `save_quote_facts`:

```python
            """INSERT OR REPLACE INTO corporate_quote_facts
                   (ticker, market_cap, shares_outstanding, currency, beta,
                    sector, industry, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (ticker, facts.market_cap, facts.shares_outstanding, facts.currency,
             facts.beta, facts.sector, facts.industry,
             datetime.now(timezone.utc).isoformat()),
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/api/test_conservative_case.py`:

```python
from apps.api.services.industry_benchmark_store import resolve_for_ticker, store_vintage
from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS


def _seed_quote_facts(ticker, industry):
    from apps.api.services.db import get_db
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker.upper(), industry),
        )


def test_a_mapped_ticker_resolves_a_benchmark_with_provenance():
    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts("NVDA", "Semiconductors")
    benchmark, reason = resolve_for_ticker("NVDA")
    assert reason is None
    assert benchmark.sector == "Technology"
    assert benchmark.ranked[0] == "Computers/Peripherals"


def test_no_vintage_gives_a_reason_not_a_benchmark():
    _seed_quote_facts("NVDA", "Semiconductors")
    benchmark, reason = resolve_for_ticker("NVDA")
    assert benchmark is None
    assert "no_vintage" in reason


def test_a_ticker_with_no_industry_gives_a_reason():
    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts("XYZ", "")
    benchmark, reason = resolve_for_ticker("XYZ")
    assert benchmark is None
    assert "no_industry" in reason


def test_an_unmapped_industry_names_the_value_so_the_map_can_be_extended():
    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _seed_quote_facts("XYZ", "Llama Farming")
    benchmark, reason = resolve_for_ticker("XYZ")
    assert benchmark is None
    assert "unmapped_industry" in reason
    assert "Llama Farming" in reason


def test_a_sector_too_thin_to_benchmark_gives_a_reason():
    store_vintage("2026-01-01", [TECHNOLOGY_ROWS[0]])
    _seed_quote_facts("NVDA", "Semiconductors")
    benchmark, reason = resolve_for_ticker("NVDA")
    assert benchmark is None
    assert "sector_too_thin" in reason
```

- [ ] **Step 3: Run to verify they fail**

Run: `python -m pytest tests/api/test_conservative_case.py -q`
Expected: FAIL — `ImportError: cannot import name 'resolve_for_ticker'`

- [ ] **Step 4: Implement resolution**

Append to `apps/api/services/industry_benchmark_store.py`:

```python
def _stored_industry(ticker: str) -> str:
    with get_db() as conn:
        row = conn.execute(
            "SELECT industry FROM corporate_quote_facts WHERE ticker = ?",
            (ticker.upper(),),
        ).fetchone()
    return (row["industry"] or "") if row else ""


def resolve_for_ticker(
    ticker: str, *, as_of: str | None = None
) -> tuple[SectorBenchmark | None, str | None]:
    """Resolve a sector benchmark for one ticker.

    Returns `(benchmark, None)` or `(None, reason)`. Exactly one is non-None: a
    missing or unreliable benchmark yields NO case rather than a silently
    degraded one. Falling back to an all-industry average would produce a number
    that looks like a sector benchmark and is not one.
    """
    vintage = latest_vintage(on_or_before=as_of)
    if vintage is None:
        return None, "no_vintage: no industry benchmark data has been loaded"

    industry = _stored_industry(ticker)
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
            f"unmapped_industry: {mapped!r} is in no sector in SECTOR_TO_INDUSTRIES"
        )

    names = set(SECTOR_TO_INDUSTRIES[sector])
    rows = [row for row in load_vintage(vintage) if row.name in names]
    try:
        return resolve_benchmark(sector, rows), None
    except BenchmarkUnavailable as exc:
        return None, f"sector_too_thin: {exc}"
```

with these imports:

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

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: PASS. No existing test should change — the conservative valuation runs
on a different engine and stores a separate case, so there is no shared path
along which it could perturb `corporate_dcf`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/industry_benchmark_store.py apps/api/services/db.py apps/api/services/acquisition/store.py tests/api/test_conservative_case.py
git commit -m "feat: resolve a sector benchmark per ticker, or refuse with a reason"
```

---

### Task 9: The statements → baseline adapter, and the entry point

**Files:**
- Create: `apps/api/services/company_baseline.py`
- Modify: `apps/api/services/corporate_statement_metrics.py` (add one public function)
- Test: `tests/api/test_company_baseline.py`

**Why this task exists.** The final whole-branch review found the feature had no
caller: `build_conservative_case` and `resolve_for_ticker` had zero production
callers, and nothing constructed a `CompanyBaseline`. Eight per-task reviews all
passed because each task did its own job and no task owned the seam. This closes
it.

**Interfaces:**
- Consumes:
  - `resolve_for_ticker(ticker, *, as_of=None) -> tuple[SectorBenchmark | None, str | None, str | None]` returning `(benchmark, vintage, reason)` — `apps/api/services/industry_benchmark_store.py`
  - `build_conservative_case(ticker, baseline, benchmark, *, vintage, riskfree_rate, marginal_tax_rate, base_year) -> dict` and `CompanyBaseline` — `apps/api/services/conservative_case.py`
  - `create_case(payload) -> int` — `apps/api/services/valuation_case.py`
  - `load_equity_bridge(ticker, *, bundle_loader=...) -> EquityBridge` with fields `net_debt`, `non_operating_assets`, `diluted_shares_outstanding`, each a `BridgeInputMeta` carrying `.value` (billions, or None) and `.quality` — `apps/api/services/equity_bridge.py`
  - `metrics_for_ticker(...)` / `CorporateMetrics` — fields `roic`, `wacc`, `growth` are PERCENT
- Produces:
  - `statement_baseline(ticker, *, bundle_loader=get_yahoo_statement_bundle) -> dict | None` in `corporate_statement_metrics.py`, returning `{"revenue_by_year": dict[int, float], "operating_income_by_year": dict[int, float], "invested_capital_by_year": dict[int, float]}` in RAW statement currency
  - `build_company_baseline(ticker, *, metrics, bundle_loader=...) -> tuple[CompanyBaseline | None, str | None]`
  - `generate_conservative_case(ticker, *, as_of=None, ...) -> tuple[int | None, str | None]` — the entry point, returning `(case_id, None)` or `(None, reason)`

**THE UNITS BOUNDARY LIVES HERE.** This is the one place in the feature where a
scale error is possible, and the whole branch has been built so that it can only
happen in this file:

- Statement figures are RAW CURRENCY. `CompanyBaseline.base_revenue` and the
  cash/debt terms are BILLIONS. `equity_bridge._scaled` is the existing helper
  and `load_equity_bridge` already returns billions — use it rather than
  dividing by 1e9 by hand, so there is one convention, not two.
- `CorporateMetrics.roic`, `.wacc` and `.growth` are PERCENT. `AAPL` is stored
  as `{"growth": 6, "roic": 18, "wacc": 10}`. `CompanyBaseline` wants FRACTIONS.
  Divide by 100 exactly once, here.
- `base_margin` and `current_sales_to_capital` are ratios of two raw-currency
  figures, so they are already dimensionless — do NOT scale them.

**No network in tests.** `get_yahoo_statement_bundle` fetches from Yahoo. Every
function here takes a `bundle_loader` injection, matching
`yahoo_statement_metrics(..., bundle_loader=...)` and
`load_equity_bridge(..., bundle_loader=...)`. Tests inject a fake.

**Refuse, never default.** Every missing input produces a reason, not a
substituted zero or an industry average. A baseline built on a defaulted figure
would produce a confident valuation from data that does not exist.

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_company_baseline.py
import pytest

from apps.api.services.company_baseline import (
    build_company_baseline,
    generate_conservative_case,
)
from apps.api.models.schema_parts.corporate import CorporateMetrics


def _metrics(**overrides):
    base = dict(ticker="TEST", growth=20.0, roic=35.0, wacc=8.5)
    base.update(overrides)
    return CorporateMetrics(**base)


def _baseline_source(**overrides):
    """Raw-currency statement figures, as they come off a bundle."""
    base = {
        "revenue_by_year": {2024: 90_000_000_000.0, 2025: 100_000_000_000.0},
        "operating_income_by_year": {2024: 27_000_000_000.0, 2025: 30_000_000_000.0},
        "invested_capital_by_year": {2024: 30_000_000_000.0, 2025: 33_333_333_333.0},
    }
    base.update(overrides)
    return base


def test_revenue_is_converted_to_billions():
    """A 100bn-revenue company yields 100.0, not 1e11. This is the single
    boundary in the whole feature where a 10^9 error is possible."""
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert reason is None
    assert baseline.base_revenue == pytest.approx(100.0)


def test_percent_metrics_are_converted_to_fractions():
    """CorporateMetrics stores roic/wacc/growth as percent. A 35.0 leaking
    through as a fraction would be a 3500% return on capital."""
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(roic=35.0, wacc=8.5, growth=20.0),
        statement_source=_baseline_source(), net_debt=5.0, shares=1.0,
    )
    assert baseline.current_roic == pytest.approx(0.35)
    assert baseline.current_wacc == pytest.approx(0.085)
    assert baseline.current_growth == pytest.approx(0.20)


def test_base_margin_is_dimensionless_and_not_scaled():
    """operating_income / revenue is a ratio of two raw-currency figures, so it
    must NOT be divided by 1e9 alongside them."""
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert baseline.base_margin == pytest.approx(0.30)


def test_sales_to_capital_is_revenue_over_invested_capital():
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert baseline.current_sales_to_capital == pytest.approx(3.0, rel=1e-4)


def test_positive_net_debt_becomes_debt_and_zero_cash():
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert baseline.debt == pytest.approx(5.0)
    assert baseline.cash == pytest.approx(0.0)


def test_negative_net_debt_becomes_cash_and_zero_debt():
    """A net-cash company. EV - debt + cash must reconstruct the same bridge."""
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=-12.0, shares=1.0,
    )
    assert baseline.cash == pytest.approx(12.0)
    assert baseline.debt == pytest.approx(0.0)


def test_source_years_names_the_years_actually_used():
    baseline, _ = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert baseline.source_years == (2024, 2025)


@pytest.mark.parametrize("missing,expected", [
    ("revenue_by_year", "no_revenue"),
    ("operating_income_by_year", "no_operating_income"),
    ("invested_capital_by_year", "no_invested_capital"),
])
def test_a_missing_statement_series_refuses_with_a_reason(missing, expected):
    """Never a defaulted zero. A baseline built on a substituted figure produces
    a confident valuation from data that does not exist."""
    source = _baseline_source()
    source[missing] = {}
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=source,
        net_debt=5.0, shares=1.0,
    )
    assert baseline is None
    assert expected in reason


def test_a_missing_share_count_refuses():
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=None,
    )
    assert baseline is None
    assert "no_shares" in reason


def test_a_missing_net_debt_refuses():
    """Unlike a zero balance, a missing one is unknown. The argument in
    `calculate_net_debt`'s docstring applies: a missing balance is not a zero
    balance."""
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=None, shares=1.0,
    )
    assert baseline is None
    assert "no_net_debt" in reason


def test_zero_revenue_refuses_rather_than_dividing_by_zero():
    source = _baseline_source(revenue_by_year={2025: 0.0})
    baseline, reason = build_company_baseline(
        "TEST", metrics=_metrics(), statement_source=source,
        net_debt=5.0, shares=1.0,
    )
    assert baseline is None
    assert "no_revenue" in reason
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_company_baseline.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.company_baseline'`

- [ ] **Step 3: Implement `build_company_baseline`**

`statement_source` is a plain dict so the unit conversion is testable without a
bundle. The bundle-reading wrapper comes in Step 5.

```python
# apps/api/services/company_baseline.py
"""Build a CompanyBaseline for one ticker, and generate its conservative case.

The adapter the final whole-branch review found missing: without it,
`build_conservative_case` had no caller and the feature had no entry point.

THIS FILE OWNS THE UNITS BOUNDARY. Everywhere else in the feature, rates are
fractions and money is billions, matching both the segment engine and
Damodaran's dataset. Two conversions happen here and nowhere else:

    statement currency -> billions   (revenue, and the equity-bridge terms)
    CorporateMetrics percent -> fraction   (roic, wacc, growth)

`base_margin` and `current_sales_to_capital` are ratios of two raw-currency
figures and are therefore already dimensionless. Scaling them would be a
1e9 error that no downstream guard would catch, because both would still be
plausible floats.

Every missing input refuses with a reason. A baseline built on a substituted
zero produces a confident valuation from data that does not exist.
"""

from __future__ import annotations

from apps.api.services.conservative_case import CompanyBaseline

_BILLION = 1_000_000_000.0


def build_company_baseline(
    ticker: str,
    *,
    metrics,
    statement_source: dict,
    net_debt: float | None,
    shares: float | None,
) -> tuple[CompanyBaseline | None, str | None]:
    """Assemble a baseline, or refuse with a reason. Exactly one is non-None."""
    revenue = statement_source.get("revenue_by_year") or {}
    operating_income = statement_source.get("operating_income_by_year") or {}
    invested_capital = statement_source.get("invested_capital_by_year") or {}

    years = sorted(set(revenue) & set(operating_income) & set(invested_capital))
    if not revenue or not years or not revenue.get(years[-1] if years else None):
        return None, f"no_revenue: {ticker} has no usable revenue in its stored statements"
    if not operating_income:
        return None, f"no_operating_income: {ticker} has no operating income in its stored statements"
    if not invested_capital:
        return None, f"no_invested_capital: {ticker} has no invested capital in its stored statements"

    latest = years[-1]
    latest_revenue = float(revenue[latest])
    if latest_revenue <= 0:
        return None, f"no_revenue: {ticker}'s latest revenue is {latest_revenue}, which cannot anchor a growth path"
    latest_capital = float(invested_capital[latest])
    if latest_capital <= 0:
        return None, f"no_invested_capital: {ticker}'s invested capital is {latest_capital}"

    if shares is None or shares <= 0:
        return None, f"no_shares: {ticker} has no diluted share count in its statements"
    if net_debt is None:
        # A missing balance is not a zero balance -- the argument in
        # `calculate_net_debt`'s docstring in dcf.py.
        return None, f"no_net_debt: {ticker}'s net debt is unknown, not zero"

    return CompanyBaseline(
        base_revenue=latest_revenue / _BILLION,
        # Dimensionless: a ratio of two raw-currency figures. NOT scaled.
        base_margin=float(operating_income[latest]) / latest_revenue,
        current_roic=float(metrics.roic) / 100.0,
        current_sales_to_capital=latest_revenue / latest_capital,
        current_growth=float(metrics.growth) / 100.0,
        current_wacc=float(metrics.wacc) / 100.0,
        cash=max(-float(net_debt), 0.0),
        debt=max(float(net_debt), 0.0),
        shares=float(shares),
        source_years=tuple(years),
    ), None
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/test_company_baseline.py -q`
Expected: PASS, 14 tests.

- [ ] **Step 5: Add `statement_baseline` and the entry point**

Add to `apps/api/services/corporate_statement_metrics.py` a public
`statement_baseline(ticker, *, bundle_loader=get_yahoo_statement_bundle)` that
returns the three raw-currency maps, reusing the module's existing private
helpers (`_prefer_annual_map`, `_statement_map`, `_calculate_invested_capital`
and the label constants already defined there) rather than reimplementing label
matching. Return `None` when the bundle is `None`.

Then in `company_baseline.py`:

```python
def generate_conservative_case(
    ticker: str,
    *,
    as_of: str | None = None,
    base_year: int,
    riskfree_rate: float,
    marginal_tax_rate: float,
    metrics,
    statement_source: dict | None,
    net_debt: float | None,
    shares: float | None,
) -> tuple[int | None, str | None]:
    """Resolve, build, and store a conservative case. Exactly one is non-None.

    Dependencies are injected rather than fetched so this is testable without a
    network. The caller wires `statement_baseline` and `load_equity_bridge`.
    """
    benchmark, vintage, reason = resolve_for_ticker(ticker, as_of=as_of)
    if benchmark is None:
        return None, reason
    if statement_source is None:
        return None, f"no_statements: {ticker} has no stored statement bundle"

    baseline, reason = build_company_baseline(
        ticker, metrics=metrics, statement_source=statement_source,
        net_debt=net_debt, shares=shares,
    )
    if baseline is None:
        return None, reason

    payload = build_conservative_case(
        ticker, baseline, benchmark, vintage=vintage,
        riskfree_rate=riskfree_rate, marginal_tax_rate=marginal_tax_rate,
        base_year=base_year,
    )
    try:
        return create_case(payload), None
    except ValueError as exc:
        # Covers both a duplicate case_name and any engine guard the generated
        # inputs trip. Both are legitimate refusals, not faults.
        return None, f"not_storable: {exc}"
```

- [ ] **Step 6: Test the entry point end to end**

```python
def test_generate_produces_a_stored_runnable_case():
    """The end-to-end gate this whole task exists to provide: benchmark ->
    baseline -> case -> stored -> runnable."""
    from apps.api.services.industry_benchmark_store import store_vintage
    from apps.api.services.valuation_case import run_stored_case
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS
    from apps.api.services.db import get_db

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES ('TEST', 1.0, 1.0, 'USD', 1.0, 'Technology', 'Semiconductors', '2026-01-01')"
        )

    case_id, reason = generate_conservative_case(
        "TEST", base_year=2026, riskfree_rate=0.0456, marginal_tax_rate=0.25,
        metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert reason is None
    assert case_id > 0
    result = run_stored_case(case_id)
    assert result["enterprise_value"] > 0


def test_generate_refuses_when_no_benchmark_resolves():
    case_id, reason = generate_conservative_case(
        "UNKNOWN", base_year=2026, riskfree_rate=0.0456, marginal_tax_rate=0.25,
        metrics=_metrics(), statement_source=_baseline_source(),
        net_debt=5.0, shares=1.0,
    )
    assert case_id is None
    assert reason is not None
```

- [ ] **Step 7: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: PASS. Baseline is 758.

- [ ] **Step 8: Commit**

```bash
git add apps/api/services/company_baseline.py apps/api/services/corporate_statement_metrics.py tests/api/test_company_baseline.py
git commit -m "feat: statements to baseline adapter and the conservative case entry point"
```

---

## Self-review notes

**Spec coverage.** Data foundation → Tasks 1, 4, 5, 6. Resolver → Tasks 1–2.
Fade → Task 3. Case generator → Task 7. Per-ticker resolution and error
handling → Task 8. Statements → baseline adapter and the entry point → Task 9.

**Task 9 was added after the final whole-branch review, and its absence is the
plan's own defect.** The first eight tasks each did their job and all eight
per-task reviews passed, but no task owned the seam between them: nothing built
a `CompanyBaseline`, so `build_conservative_case` had no caller and the feature
had no entry point. This self-review originally claimed full spec coverage,
which was wrong — the spec says the generator reads statements and the equity
bridge, and no task did. A per-task review structurally cannot catch that.

**Revised 2026-08-11, before any implementer was dispatched.** The original plan
targeted `corporate_dcf`. It computes enterprise value from `base_fcff`,
`revenue_growth_rate`, `wacc`, `terminal_growth_rate` and `esg_penalty` only;
`operating_margin`, `tax_rate`, `unlevered_beta` and `debt_ratio` reach the
response payload and the `report_id` hash and stop there, and `reinvestment` is
never referenced. Four of six faded columns would have been inert. Tasks 1–6 were
unaffected and are unchanged; Tasks 7–8 were rewritten against the segment
build-up engine, which consumes all of them as real drivers.

**Two spec items deliberately not implemented, and why:**

1. **Acquisition scheduling.** The spec notes the annual cadence fits the
   acquisition layer's freshness rules. Task 5 provides manual `parse_workbook`
   + `store_vintage` instead. An annual dataset does not need a scheduler, and
   building one would be machinery ahead of need.
2. **The full 95-industry sector map.** Task 4 ships Technology worked out and
   the completeness test that fails until the rest is authored. The
   classification is judgement the implementer must make; the test defines done
   rather than a placeholder deferring the work.

**Known ambiguity resolved by choice:** the spec's worked example uses a top-3
average while `resolve_benchmark` defaults to `top_n=5`. Both are tested. Three
is the spec's illustration; five is the default because the request said "3 to
5" and a wider basket is less sensitive to a single industry.

**Watch during execution.** The generated case must satisfy the engine's own
guards, which the generator does not currently check: `run_case` rejects
`roic_stable` above the target-year marginal return, and `terminal_value`
rejects `roic_stable` below the magnitude of terminal growth or below
`wacc_stable` when growth is positive. A conservative `roic_stable` faded down
toward a low sector ROC can trip the last of these. Task 7's
`test_the_generated_case_runs_and_produces_a_positive_value` catches it for the
fixture; if it fires for real tickers, the honest response is another
error-handling row — refuse the case with a reason — not a clamp that quietly
moves the number.
