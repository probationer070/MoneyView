"""Mutation harness for the market_assumptions tests (guideline/sop/test-verification.md).

Each case reintroduces ONE defect in memory (never on disk) and requires the named test to FAIL with an
AssertionError (or the IntegrityError-guard `Failed`) whose text names the real cause. Unmutated, the
same test passes (covered by the test modules themselves).
"""
import inspect
import re
import sys
import types

import pytest

from apps.api.services import db as db_service
from apps.api.services import market_assumptions as ma
from tests.api import test_market_assumptions_resolver as resolver_tests
from tests.api import test_market_assumptions_table as table_tests

_SOURCE = inspect.getsource(ma)


def _build(source: str) -> types.ModuleType:
    module = types.ModuleType("mutated_market_assumptions")
    sys.modules["mutated_market_assumptions"] = module  # dataclasses resolves string annotations through it
    exec(compile(source, "mutated_market_assumptions", "exec"), module.__dict__)
    return module


def _mutated_module(old: str, new: str) -> types.ModuleType:
    assert _SOURCE.count(old) >= 1, f"mutation anchor not found: {old!r}"
    return _build(_SOURCE.replace(old, new, 1))


RESOLVER_MUTATIONS = [
    ("always_fallback", "fred = _fresh_fred_rf(conn, today)", "fred = None",
     resolver_tests.test_fresh_fred_wins_over_fallback, (), "4.11"),
    ("no_age_check", "> RF_MAX_AGE_DAYS", "> 10**6",
     resolver_tests.test_fred_eight_days_old_falls_to_fallback, (), "4.11"),
    ("age_ge", "> RF_MAX_AGE_DAYS", ">= RF_MAX_AGE_DAYS",
     resolver_tests.test_fred_exactly_seven_days_old_is_accepted, (), "FRED DGS10"),
    ("rf_default_not_missing", 'rf, rf_source, rf_as_of = 0.0, "", ""', 'rf, rf_source, rf_as_of = 4.2, "owner", ""',
     resolver_tests.test_both_rf_sources_missing_returns_assumptions_missing, (), "AssumptionsMissing"),
    ("erp_oldest_wins", 'WHERE key = ? ORDER BY as_of DESC', 'WHERE key = ? ORDER BY as_of ASC',
     resolver_tests.test_erp_latest_as_of_beats_older_row_inserted_later, (), "5.2"),
    ("erp_by_updated_at", 'WHERE key = ? ORDER BY as_of DESC', 'WHERE key = ? ORDER BY updated_at DESC',
     resolver_tests.test_erp_latest_as_of_beats_older_row_inserted_later, (), "5.2"),
    ("rf_stale_ge", "> RF_STALE_DAYS", ">= RF_STALE_DAYS",
     resolver_tests.test_stale_flags_at_the_90_and_120_day_boundaries, ("2026-08-18", "2026-07-19", ()), "()"),
    ("erp_stale_ge", "> ERP_STALE_DAYS", ">= ERP_STALE_DAYS",
     resolver_tests.test_stale_flags_at_the_90_and_120_day_boundaries, ("2026-08-18", "2026-07-19", ()), "erp"),
    ("stale_thresholds_swapped", "RF_STALE_DAYS = 90", "RF_STALE_DAYS = 120",
     resolver_tests.test_stale_flags_at_the_90_and_120_day_boundaries, ("2026-08-17", "2026-07-19", ("risk_free",)), "risk_free"),
    ("no_owner_range_check", 'if low <= row["value"] <= high:', "if True:",
     resolver_tests.test_out_of_range_owner_row_is_skipped, (), "50.0"),
    ("no_fred_range_check", 'if low <= row["value"] <= high:', "if True:",
     resolver_tests.test_out_of_range_fred_tries_next_latest, (), "99.0"),
]


@pytest.mark.parametrize(
    ("name", "old", "new", "test", "args", "needle"), RESOLVER_MUTATIONS, ids=[m[0] for m in RESOLVER_MUTATIONS]
)
def test_resolver_mutation_is_caught(monkeypatch, name, old, new, test, args, needle):
    # Mutations whose anchor occurs twice (the range check) target the occurrence that matters.
    if name == "no_fred_range_check":
        first = _SOURCE.index(old)
        second = _SOURCE.index(old, first + 1)
        source = _SOURCE[:second] + new + _SOURCE[second + len(old):]
        module = _build(source)
    else:
        module = _mutated_module(old, new)
    monkeypatch.setattr(resolver_tests.ma, "resolve_assumptions", module.resolve_assumptions)
    with pytest.raises(AssertionError) as caught:
        test(*args)
    assert needle in str(caught.value), f"{name}: failed, but not for the intended reason:\n{caught.value}"


def _fresh_db(monkeypatch, tmp_path, schema_sql=None, seed=None):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "mutated.db")
    if schema_sql is not None:
        monkeypatch.setattr(db_service, "_CREATE_SCHEMA_SQL", schema_sql)
    if seed is not None:
        monkeypatch.setattr(db_service, "_seed_market_assumptions", seed)
    db_service.init_db()


def test_seed_insert_or_replace_is_caught(monkeypatch, tmp_path):
    def replacing_seed(conn):
        conn.executemany(
            "INSERT OR REPLACE INTO market_assumptions (key, value, as_of, source, updated_at) "
            "VALUES (?, ?, '2026-11-16', 'owner', '2026-11-16T09:00:00Z')",
            db_service._MARKET_ASSUMPTION_SEED,
        )

    _fresh_db(monkeypatch, tmp_path)
    monkeypatch.setattr(db_service, "_seed_market_assumptions", replacing_seed)
    with pytest.raises(AssertionError) as caught:
        table_tests.test_seed_rows_and_idempotent_reinit()
    assert "edited" in str(caught.value), caught.value


def test_dropped_check_is_caught(monkeypatch, tmp_path):
    pattern = r"    CHECK \(\n        \(key = .*?\n    \)\n"
    schema = re.sub(pattern, "    CHECK (1)\n", db_service._CREATE_SCHEMA_SQL, count=1, flags=re.S)
    assert schema != db_service._CREATE_SCHEMA_SQL, "CHECK mutation anchor not found"
    _fresh_db(monkeypatch, tmp_path, schema_sql=schema)
    with pytest.raises(BaseException) as caught:
        table_tests.test_check_rejects_out_of_range_and_unknown_key()
    assert "DID NOT RAISE" in str(caught.value), caught.value


def test_dropped_primary_key_is_caught(monkeypatch, tmp_path):
    schema = db_service._CREATE_SCHEMA_SQL.replace("    PRIMARY KEY (key, as_of),\n", "", 1)
    assert schema != db_service._CREATE_SCHEMA_SQL
    _fresh_db(monkeypatch, tmp_path, schema_sql=schema)
    with pytest.raises(BaseException) as caught:
        table_tests.test_primary_key_rejects_duplicate_key_as_of()
    assert "DID NOT RAISE" in str(caught.value), caught.value


def test_route_echoing_constants_is_caught(monkeypatch):
    constant = ma.Assumptions(4.2, "owner", "2026-11-16", 5.5, "owner", "2026-11-16", 0.8, "2026-11-16")
    monkeypatch.setattr(table_tests.corporate_route, "resolve_assumptions", lambda conn, now: constant)
    with pytest.raises(AssertionError) as caught:
        table_tests.test_metrics_echo_equals_resolver_output(monkeypatch)
    assert "5.9" in str(caught.value) or "Damodaran" in str(caught.value), caught.value
