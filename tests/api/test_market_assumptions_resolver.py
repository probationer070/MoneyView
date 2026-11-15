"""resolve_assumptions (plan 2026-11-16-wacc-ke-live-premia section 1).

Each test names the mutation it must catch; tests/api/test_market_assumptions_mutations.py runs them.
The autouse _isolated_db fixture gives every test its own seeded DB (never data/processed).
"""
from datetime import datetime, timezone

import pytest

from apps.api.services import market_assumptions as ma
from apps.api.services.db import get_db

NOW = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)


def _fred(conn, obs_date, value):
    conn.execute(
        "INSERT OR REPLACE INTO fred_cache (series_id, obs_date, value, fetched_at) VALUES ('DGS10', ?, ?, 'x')",
        (obs_date, value),
    )


def _row(conn, key, value, as_of, source="owner", updated_at="2026-11-16T09:00:00Z"):
    conn.execute(
        "INSERT INTO market_assumptions (key, value, as_of, source, updated_at) VALUES (?, ?, ?, ?, ?)",
        (key, value, as_of, source, updated_at),
    )


def resolve():
    with get_db() as conn:
        return ma.resolve_assumptions(conn, NOW)


def test_fresh_fred_wins_over_fallback():
    # mutation: resolver always returns the fallback row
    with get_db() as conn:
        _fred(conn, "2026-11-13", 4.11)
    a = resolve()
    assert (a.risk_free_rate, a.risk_free_source, a.risk_free_as_of) == (4.11, "FRED DGS10", "2026-11-13")
    assert (a.equity_risk_premium, a.erp_source, a.erp_as_of) == (5.5, "owner", "2026-11-16")
    assert (a.crp_non_mature, a.stale) == (0.8, ())


def test_fred_eight_days_old_falls_to_fallback():
    # mutation: age check removed
    with get_db() as conn:
        _fred(conn, "2026-11-08", 4.11)
    a = resolve()
    assert (a.risk_free_rate, a.risk_free_source, a.risk_free_as_of) == (4.2, "owner", "2026-11-16")


def test_fred_exactly_seven_days_old_is_accepted():
    # mutation: `>=` instead of `>` in the age check
    with get_db() as conn:
        _fred(conn, "2026-11-09", 4.11)
    assert resolve().risk_free_source == "FRED DGS10"


def test_out_of_range_fred_tries_next_latest():
    with get_db() as conn:
        _fred(conn, "2026-11-13", 99.0)
        _fred(conn, "2026-11-12", 4.0)
    a = resolve()
    assert (a.risk_free_rate, a.risk_free_as_of) == (4.0, "2026-11-12")


def test_both_rf_sources_missing_returns_assumptions_missing():
    # mutation: resolver returns 4.2 instead of AssumptionsMissing
    with get_db() as conn:
        conn.execute("DELETE FROM market_assumptions WHERE key = 'risk_free_fallback'")
    r = resolve()
    assert isinstance(r, ma.AssumptionsMissing)
    assert (r.code, r.missing) == ("assumptions_missing", ("risk_free",))


def test_missing_erp_and_crp_are_named():
    with get_db() as conn:
        conn.execute("DELETE FROM market_assumptions WHERE key IN ('equity_risk_premium', 'crp_non_mature')")
    assert resolve().missing == ("erp", "crp")


def test_erp_latest_as_of_beats_older_row_inserted_later():
    # mutation: ordered by updated_at (or the oldest row picked)
    with get_db() as conn:
        _row(conn, "equity_risk_premium", 4.9, "2026-01-01", "old", updated_at="2026-12-31T00:00:00Z")
        _row(conn, "equity_risk_premium", 5.2, "2026-11-20", "newest", updated_at="2026-11-01T00:00:00Z")
    a = resolve()
    assert (a.equity_risk_premium, a.erp_source, a.erp_as_of) == (5.2, "newest", "2026-11-20")


@pytest.mark.parametrize(
    ("rf_asof", "erp_asof", "expected"),
    [
        ("2026-08-18", "2026-07-19", ()),                 # exactly 90 / 120 days: not stale
        ("2026-08-17", "2026-07-19", ("risk_free",)),     # 91 days
        ("2026-08-18", "2026-07-18", ("erp",)),           # 121 days
        ("2026-08-17", "2026-07-18", ("risk_free", "erp")),
    ],
)
def test_stale_flags_at_the_90_and_120_day_boundaries(rf_asof, erp_asof, expected):
    # mutation: `>` becomes `>=`, or the thresholds are swapped
    with get_db() as conn:
        conn.execute("DELETE FROM market_assumptions WHERE key IN ('risk_free_fallback', 'equity_risk_premium')")
        _row(conn, "risk_free_fallback", 4.2, rf_asof)
        _row(conn, "equity_risk_premium", 5.5, erp_asof)
    a = resolve()
    assert a.stale == expected


def test_fresh_fred_is_never_stale_even_with_old_fallback():
    with get_db() as conn:
        conn.execute("UPDATE market_assumptions SET as_of = '2025-01-01' WHERE key = 'risk_free_fallback'")
        _fred(conn, "2026-11-16", 4.0)
    assert "risk_free" not in resolve().stale


def test_out_of_range_owner_row_is_skipped():
    # mutation: range check removed from _latest_row
    with get_db() as conn:
        conn.execute("PRAGMA ignore_check_constraints = ON")
        _row(conn, "equity_risk_premium", 50.0, "2026-12-01", "bad")
        conn.execute("PRAGMA ignore_check_constraints = OFF")
    a = resolve()
    assert (a.equity_risk_premium, a.erp_as_of) == (5.5, "2026-11-16")


def test_fraction_properties_are_percent_over_100():
    a = resolve()
    assert (a.rf_fraction, a.erp_fraction) == (pytest.approx(0.042), pytest.approx(0.055))
