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


def test_a_workbook_without_the_optional_columns_still_parses(tmp_path):
    """The four price columns were added after several vintages were published."""
    import openpyxl

    from apps.api.services.industry_benchmark_store import parse_workbook
    from packages.core_finance.industry_benchmark import BENCHMARK_COLUMNS

    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Industry Averages"
    required = [c for c in BENCHMARK_COLUMNS if c.required]
    sheet.append(["Industry Name", "Number of firms"] + [c.source_header for c in required])
    sheet.append(["Semiconductor", 50] + [0.1] * len(required))
    path = tmp_path / "old_vintage.xlsx"
    book.save(path)

    rows = parse_workbook(path, sheet="Industry Averages")
    assert len(rows) == 1
    assert rows[0].values.get("trailing_pe") is None
