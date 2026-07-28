from datetime import date

import pandas as pd

from apps.api.services.acquisition.sources.quote_facts import QuoteFacts
from apps.api.services.acquisition.sources.statements import StatementRow
from apps.api.services.acquisition.store import (
    load_statement_bundle,
    save_quote_facts,
    save_statements,
    statement_coverage,
)


def _rows() -> list[StatementRow]:
    return [
        StatementRow("AAPL", "income", "annual", "2024-09-30", "Total Revenue", 90.0),
        StatementRow("AAPL", "income", "annual", "2025-09-30", "Total Revenue", 100.0),
        StatementRow("AAPL", "balance", "quarterly", "2026-06-30", "Total Debt", 5.0),
    ]


def test_coverage_spans_earliest_to_latest_period():
    assert statement_coverage(_rows()) == (date(2024, 9, 30), date(2026, 6, 30))


def test_bundle_rebuilds_the_shape_metric_code_expects():
    save_statements("AAPL", _rows())
    save_quote_facts("AAPL", QuoteFacts("AAPL", 4_000.0, 100.0, "USD"))

    bundle = load_statement_bundle("AAPL")

    assert set(bundle) == {
        "ticker", "income", "balance", "cashflow",
        "quarterly_income", "quarterly_balance", "quarterly_cashflow",
        "info", "fetched_at",
    }
    assert isinstance(bundle["income"], pd.DataFrame)
    assert bundle["info"]["marketCap"] == 4_000.0


def test_periods_are_newest_first():
    """Metric code reads the first column as the latest period. Ordering is load-bearing."""
    save_statements("AAPL", _rows())

    columns = list(load_statement_bundle("AAPL")["income"].columns)

    assert columns == ["2025-09-30", "2024-09-30"]


def test_a_missing_value_round_trips_as_nan_not_zero():
    save_statements("NONE", [StatementRow("NONE", "income", "annual", "2025-09-30", "Total Revenue", None)])

    value = load_statement_bundle("NONE")["income"].loc["Total Revenue", "2025-09-30"]

    assert pd.isna(value)


def test_an_unknown_ticker_returns_none():
    assert load_statement_bundle("NOPE") is None


def test_resaving_replaces_rather_than_duplicates():
    save_statements("AAPL", _rows())
    save_statements("AAPL", [StatementRow("AAPL", "income", "annual", "2025-09-30", "Total Revenue", 111.0)])

    assert load_statement_bundle("AAPL")["income"].loc["Total Revenue", "2025-09-30"] == 111.0


def test_a_lowercase_subject_round_trips():
    """load_statement_bundle upper-cases its argument. If the writes did not, rows would be
    stored under a key that can never be read back -- while acquisition_state recorded OK."""
    save_statements("aapl", [StatementRow("aapl", "income", "annual", "2025-09-30", "Total Revenue", 100.0)])
    save_quote_facts("aapl", QuoteFacts("aapl", 4_000.0, 100.0, "USD"))

    bundle = load_statement_bundle("aapl")

    assert bundle is not None
    assert bundle["ticker"] == "AAPL"
    assert bundle["income"].loc["Total Revenue", "2025-09-30"] == 100.0
    assert bundle["info"]["marketCap"] == 4_000.0
