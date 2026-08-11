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
