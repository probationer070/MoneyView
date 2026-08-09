"""The valuation tables exist with the columns the engine and service need."""

from apps.api.services.db import get_db


def _columns(conn, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def test_valuation_case_table_has_every_engine_input():
    with get_db() as conn:
        assert _columns(conn, "valuation_case") >= {
            "id", "case_name", "ticker", "as_of_date", "base_year", "target_year",
            "riskfree_rate", "wacc_initial", "wacc_stable", "wacc_converge_from",
            "marginal_tax_rate", "nol_balance", "roic_stable", "terminal_growth",
            "cash", "debt", "ipo_proceeds", "shares_basic", "shares_new",
            "parent_case_id",
        }


def test_segment_table_has_every_segment_input():
    with get_db() as conn:
        assert _columns(conn, "segment") >= {
            "id", "case_id", "name", "base_revenue", "base_margin",
            "tam_target", "market_share_target", "revenue_target", "margin_target",
            "sales_to_capital_early", "sales_to_capital_late", "ramp_start_year",
        }


def test_segment_narrative_table_binds_a_claim_to_an_input_field():
    with get_db() as conn:
        assert _columns(conn, "segment_narrative") >= {
            "segment_id", "input_field", "claim", "evidence_source",
            "confidence", "three_p",
        }


def test_case_name_is_unique():
    """UNIQUE(case_name) alone, not UNIQUE(ticker, case_name): ticker is NULL for
    a private company, and SQLite treats NULLs as distinct, so the pair would
    silently fail to constrain exactly the rows it exists to protect."""
    import pytest

    with get_db() as conn:
        conn.execute(
            "INSERT INTO valuation_case (case_name, as_of_date, base_year, target_year,"
            " riskfree_rate, wacc_initial, wacc_stable, marginal_tax_rate, roic_stable,"
            " shares_basic) VALUES ('dup', '2026-08-09', 2026, 2036, 0.04, 0.08, 0.08,"
            " 0.25, 0.12, 1.0)"
        )
        with pytest.raises(Exception, match="UNIQUE"):
            conn.execute(
                "INSERT INTO valuation_case (case_name, as_of_date, base_year, target_year,"
                " riskfree_rate, wacc_initial, wacc_stable, marginal_tax_rate, roic_stable,"
                " shares_basic) VALUES ('dup', '2026-08-09', 2026, 2036, 0.04, 0.08, 0.08,"
                " 0.25, 0.12, 1.0)"
            )


def test_deleting_a_case_cascades_to_segments_and_narratives():
    with get_db() as conn:
        conn.execute(
            "INSERT INTO valuation_case (id, case_name, as_of_date, base_year, target_year,"
            " riskfree_rate, wacc_initial, wacc_stable, marginal_tax_rate, roic_stable,"
            " shares_basic) VALUES (1, 'c', '2026-08-09', 2026, 2036, 0.04, 0.08, 0.08,"
            " 0.25, 0.12, 1.0)"
        )
        conn.execute(
            "INSERT INTO segment (id, case_id, name, base_revenue, base_margin,"
            " margin_target, sales_to_capital_early, sales_to_capital_late, revenue_target)"
            " VALUES (1, 1, 'launch', 4.1, -0.1, 0.45, 1.0, 1.5, 70.0)"
        )
        conn.execute(
            "INSERT INTO segment_narrative (segment_id, input_field, claim, confidence,"
            " three_p) VALUES (1, 'margin_target', 'reusability', 'confirmed', 'probable')"
        )
        conn.execute("DELETE FROM valuation_case WHERE id = 1")
        assert conn.execute("SELECT COUNT(*) c FROM segment").fetchone()["c"] == 0
        assert conn.execute(
            "SELECT COUNT(*) c FROM segment_narrative"
        ).fetchone()["c"] == 0
