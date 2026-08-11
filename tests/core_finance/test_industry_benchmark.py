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
