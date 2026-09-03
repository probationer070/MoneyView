# tests/api/test_investment_decision_store.py
from apps.api.services.db import get_db

EXPECTED_COLUMNS = {
    "id", "ticker", "decided_at", "action", "memo",
    "price_at_decision", "dcf_value", "dcf_implied_return", "roic", "wacc",
    "risk_free_rate", "equity_risk_premium", "metric_schema_version",
    "figures_source", "figures_unavailable_reason",
}


def test_the_decision_table_exists_with_every_column_the_record_needs():
    with get_db() as conn:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(investment_decision)")}
    assert columns == EXPECTED_COLUMNS, columns


def test_memo_is_required_so_a_decision_cannot_decay_into_a_snapshot():
    """A decision without a stated reason is a snapshot, and snapshots already
    exist. The NOT NULL is the only thing stopping the feature regressing."""
    import sqlite3
    import pytest

    with get_db() as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO investment_decision "
                "(ticker, decided_at, action, memo, figures_source) "
                "VALUES ('AAPL', '2026-09-03T00:00:00+00:00', 'buy', NULL, 'test')"
            )
