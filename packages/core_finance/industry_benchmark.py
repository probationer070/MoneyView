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
    # 0 to 2.0 rejects the 11 negative rates and the three genuine artifacts
    # above it in the 2026 vintage -- Steel 2.115, Insurance (General) 3.242,
    # Software (Internet) 14.142. p90 is 1.311, and 2.0 sits in the observed
    # gap between 1.888 and 2.115, so capital-intensive industries reinvesting
    # up to ~190% of NOPAT (Retail (Distributors) 1.522, Chemical (Basic)
    # 1.587, Utility (Water) 1.622, Utility (General) 1.723, Broadcasting
    # 1.888) are kept rather than screened as if they were errors.
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
