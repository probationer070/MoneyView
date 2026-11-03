"""The aggregate P/E column: parsed from Damodaran's P/E workbook and stored into an existing vintage.

The conftest's autouse fixture points _DB_PATH at tmp_path, so these tests never open the real
database. The workbook is built here rather than shipped, so no network or binary is needed.
"""

import openpyxl
import pytest

from apps.api.services import db as db_service
from apps.api.services.industry_benchmark_store import (
    load_vintage,
    parse_pe_workbook,
    store_column,
    store_vintage,
)
from packages.core_finance.industry_benchmark import IndustryRow

AGGREGATE_HEADER = "Aggregate Mkt Cap/ Trailing Net Income (only money making firms)"


def _pe_workbook(tmp_path, *, aggregate_header=AGGREGATE_HEADER):
    """Rows 1-7 are title rows, row 8 the header, data from row 9, as in the published sheet."""
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Industry Averages"
    for title in range(1, 8):
        sheet.append([f"title row {title}"])
    sheet.append(["Industry Name", "Number of firms", "Trailing PE", aggregate_header])
    sheet.append(["Software (System & Application)", 309, 81.0, 30.5])
    sheet.append(["Computers/Peripherals", 36, 90.0, 34.0])
    sheet.append(["Retail (Online)", 40, 12.0, "n/a"])
    sheet.append(["Total Market", 5994, 25.0, 19.0])
    path = tmp_path / "pedata.xlsx"
    book.save(path)
    return str(path)


def test_parse_reads_the_aggregate_column_by_header_and_skips_the_rest(tmp_path):
    values = parse_pe_workbook(_pe_workbook(tmp_path))
    assert values == {
        "Software (System & Application)": 30.5,
        "Computers/Peripherals": 34.0,
    }


def test_parse_raises_when_the_aggregate_header_is_missing(tmp_path):
    path = _pe_workbook(tmp_path, aggregate_header="Something Else")
    with pytest.raises(ValueError, match="missing"):
        parse_pe_workbook(path)


def _full_row(name, **overrides):
    values = {
        "revenue_growth": 0.1, "operating_margin": 0.2, "after_tax_roc": 0.15,
        "effective_tax_rate": 0.18, "unlevered_beta": 1.1, "debt_to_capital": 0.05,
        "cost_of_capital": 0.09, "sales_to_capital": 1.5, "reinvestment_rate": 0.4,
        "trailing_pe": 81.0, "price_to_book": 6.0, "ev_sales": 5.0, "stdev_price": 0.5,
    }
    values.update(overrides)
    return IndustryRow(name, 309, values)


def test_store_column_updates_only_the_named_column_for_matching_rows():
    store_vintage("2026-01-01", [_full_row("Software (System & Application)")])
    store_vintage("2025-01-01", [_full_row("Software (System & Application)")])
    before = load_vintage("2026-01-01")[0]

    updated, unmatched = store_column("2026-01-01", "aggregate_pe", {
        "Software (System & Application)": 30.5,
        "Not In Any Vintage": 1.0,
    })

    assert updated == 1
    assert unmatched == ["Not In Any Vintage"]
    after = load_vintage("2026-01-01")
    # The unmatched name is never inserted.
    assert [row.name for row in after] == ["Software (System & Application)"]
    stored = after[0]
    assert stored.values["aggregate_pe"] == pytest.approx(30.5)
    # Every other figure, and the firm count, is exactly as stored before.
    assert stored.firms == before.firms
    for key, value in before.values.items():
        if key != "aggregate_pe":
            assert stored.values[key] == pytest.approx(value), key
    # Another vintage with the same industry is not touched.
    assert load_vintage("2025-01-01")[0].values["aggregate_pe"] is None


def test_store_column_rejects_a_key_that_is_not_a_value_column():
    with pytest.raises(ValueError, match="unknown benchmark column"):
        store_column("2026-01-01", "firms; DROP TABLE industry_benchmark", {})


def test_a_fresh_database_has_the_aggregate_pe_column():
    with db_service.get_db() as conn:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(industry_benchmark)")}
    assert "aggregate_pe" in columns
