from datetime import date, datetime, timezone

import pandas as pd

from apps.api.models.schemas import NewsArticle
from apps.api.services.acquisition.sources.quote_facts import QuoteFacts
from apps.api.services.acquisition.sources.statements import StatementRow
from apps.api.services.acquisition.store import (
    load_statement_bundle,
    news_coverage,
    save_news,
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


def test_periods_are_newest_first_and_are_timestamps():
    """Metric code reads the first column as the latest period. Ordering is load-bearing.

    So is the label TYPE: the metric layer takes the year off the column with
    getattr(col, "year", 0), so a str label yields year 0 and every row is silently
    discarded. This test asserted the str form until 2026-07-31 and so encoded the bug.
    """
    save_statements("AAPL", _rows())

    columns = list(load_statement_bundle("AAPL")["income"].columns)

    assert columns == [pd.Timestamp("2025-09-30"), pd.Timestamp("2024-09-30")]
    assert [column.year for column in columns] == [2025, 2024]


def test_a_missing_value_round_trips_as_nan_not_zero():
    save_statements("NONE", [StatementRow("NONE", "income", "annual", "2025-09-30", "Total Revenue", None)])

    value = load_statement_bundle("NONE")["income"].loc["Total Revenue", "2025-09-30"]

    assert pd.isna(value)


def test_beta_round_trips_into_the_bundle_info():
    """corporate_statement_metrics reads info["beta"] for the levered beta behind WACC.
    Before this was stored, the bundle's info carried only three keys, so info.get("beta")
    was always None and every ticker's cost of equity quietly used the derived fallback."""
    save_statements("BETA", [StatementRow("BETA", "income", "annual", "2025-09-30", "Total Revenue", 1.0)])
    save_quote_facts("BETA", QuoteFacts("BETA", 4_000.0, 100.0, "USD", beta=1.21))

    assert load_statement_bundle("BETA")["info"]["beta"] == 1.21


def test_sector_and_industry_round_trip_through_save_quote_facts():
    """save_quote_facts writes sector/industry; without this the columns are fetched but
    never persisted, leaving the benchmark feature half-built."""
    save_quote_facts("SECT", QuoteFacts("SECT", 4_000.0, 100.0, "USD", sector="Technology",
                                         industry="Semiconductors"))

    from apps.api.services.db import get_db as db_get_db
    with db_get_db() as conn:
        row = conn.execute(
            "SELECT sector, industry FROM corporate_quote_facts WHERE ticker = 'SECT'"
        ).fetchone()

    assert row["sector"] == "Technology"
    assert row["industry"] == "Semiconductors"


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


def test_save_news_persists_and_dedupes_by_hash():
    articles = [
        NewsArticle(ticker="AAPL", headline="Same headline", url="https://x/1",
                    source="s", published_date="2026-07-31"),
        NewsArticle(ticker="AAPL", headline="Same headline", url="https://x/1",
                    source="s", published_date="2026-07-31"),
        NewsArticle(ticker="AAPL", headline="Other", url="https://x/2",
                    source="s", published_date="2026-07-30"),
    ]

    save_news("AAPL", articles)
    save_news("AAPL", articles)  # a second acquisition of the same articles

    from apps.api.services.db import get_db as db_get_db
    with db_get_db() as conn:
        rows = conn.execute("SELECT headline FROM news WHERE ticker = 'AAPL'").fetchall()

    assert len(rows) == 2


def test_save_news_normalises_the_subject_ticker():
    """The subject is the authority, as in save_statements. If writes stored 'aapl' while
    reads upper-case, rows would be unreadable while acquisition_state said OK."""
    save_news("aapl", [NewsArticle(ticker="whatever", headline="H", url="u",
                                   source="s", published_date="2026-07-31")])

    from apps.api.services.db import get_db as db_get_db
    with db_get_db() as conn:
        assert conn.execute(
            "SELECT COUNT(*) AS n FROM news WHERE ticker = 'AAPL'"
        ).fetchone()["n"] == 1


def test_news_coverage_spans_the_published_dates():
    articles = [
        NewsArticle(ticker="A", headline="a", url="1", source="s", published_date="2026-07-28"),
        NewsArticle(ticker="A", headline="b", url="2", source="s", published_date="2026-07-31"),
    ]

    assert news_coverage(articles) == (date(2026, 7, 28), date(2026, 7, 31))


def test_news_coverage_falls_back_to_today_when_no_article_is_dated():
    """An undated batch still happened today. Returning a wrong date range would corrupt
    the coverage record that a later range-planning class may depend on."""
    today = datetime.now(timezone.utc).date()
    articles = [NewsArticle(ticker="A", headline="a", url="1", source="s", published_date="")]

    assert news_coverage(articles) == (today, today)
