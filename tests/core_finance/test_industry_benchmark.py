import pytest

from packages.core_finance.industry_benchmark import (
    BENCHMARK_COLUMNS,
    BenchmarkUnavailable,
    IndustryRow,
    column_by_key,
    resolve_benchmark,
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


def test_a_capital_intensive_reinvestment_rate_below_two_is_kept():
    """Utilities and broadcasters reinvesting 150-190% of NOPAT are ordinary,
    not data artifacts. An earlier bound of 1.5 screened out five such
    industries -- Retail (Distributors) 1.522, Chemical (Basic) 1.587, Utility
    (Water) 1.622, Utility (General) 1.723, Broadcasting 1.888 -- while the real
    artifacts sit above a gap at 2.115, 3.242 and 14.142."""
    column = column_by_key("reinvestment_rate")
    for plausible in (1.522, 1.587, 1.622, 1.723, 1.888):
        assert screen_value(column, plausible) is None, plausible
    for artifact in (2.115, 3.242, 14.1421393679):
        assert screen_value(column, artifact) is not None, artifact


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
    # top_n=4 (not 3): the basket must hold all four rows, or reinvestment_rate
    # would have only 2 non-poisoned survivors -- one short of the default
    # minimum of 3 -- and the column would be dropped rather than averaged.
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
