"""Mutation harness for the S2b tests (guideline/sop/test-verification.md).

Each case plants ONE defect in memory (never on disk) and requires the named check to FAIL with text naming the
real cause. The unmutated checks pass in test_s2b_assumptions.py / test_no_premia_literals.py.
"""
import inspect
import sys
import types

import pytest

from apps.api.services import company_baseline, corporate_comparison, corporate_dcf, fair_value
from apps.api.services import corporate_statement_metrics as csm
from apps.api.services import investment_decision
from tests.api import test_no_premia_literals as guard
from tests.api import test_s2b_assumptions as checks


def _build(real, source):
    module = types.ModuleType("mutated_" + real.__name__.rsplit(".", 1)[-1])
    sys.modules[module.__name__] = module
    exec(compile(source, module.__name__, "exec"), module.__dict__)
    return module


def _mutate(real, old, new, count=1):
    source = inspect.getsource(real)
    assert source.count(old) == count, f"mutation anchor count {source.count(old)} != {count}: {old!r}"
    return _build(real, source.replace(old, new))


# (id, module, old, new, count, check, text the failure must contain)
PURE = [
    ("dcf_breakdown_ignores_the_echo", corporate_dcf,
     "risk_free_source=assumptions.risk_free_source if assumptions is not None else None",
     'risk_free_source="owner"', 1, checks.check_dcf_breakdown_equals_the_echo, "owner"),
    ("dcf_breakdown_fabricates_a_source_for_legacy", corporate_dcf,
     "erp_source=assumptions.erp_source if assumptions is not None else None",
     'erp_source="owner"', 1, checks.check_dcf_breakdown_without_assumptions_is_legacy_null, "owner"),
    ("dcf_reads_its_own_default", corporate_dcf,
     "    equity_risk_premium: float,\n    country_risk_premium: float | None = None,",
     "    equity_risk_premium: float = 0.055,\n    country_risk_premium: float | None = None,", 3,
     checks.check_dcf_builders_have_no_premium_default, "still defaults equity_risk_premium"),
    ("bulk_drops_the_echo", corporate_dcf,
     "if assumptions is not None and isinstance(report, DCFFullReport):", "if False:", 1,
     checks.check_bulk_reports_carry_the_echo, "None, None, None, None"),
    ("comparison_key_drops_erp", corporate_comparison,
     "|erp={round(equity_risk_premium * 100, 2)}", "", 1,
     checks.check_snapshot_identity_changes_with_erp, "!="),
    ("comparison_snapshot_crashes_on_none_wacc", corporate_comparison,
     "            raise AssumptionsRefused(tuple(refusal.missing) if refusal else ())\n        current_price",
     "            pass\n        current_price", 1,
     checks.check_comparison_snapshot_refuses_without_wacc, "float() argument"),
    ("history_crp_defaults_when_missing", csm,
     "else _crp_of(assumptions)\n        ),", "else 0.8\n        ),", 1,
     checks.check_history_crp_is_null_not_a_default, "0.8 is None"),
]


@pytest.mark.parametrize(("name", "real", "old", "new", "count", "check", "expect"), PURE, ids=[m[0] for m in PURE])
def test_pure_mutation_is_caught(name, real, old, new, count, check, expect):
    mutated = _mutate(real, old, new, count)
    with pytest.raises(BaseException) as raised:
        check(mutated)
    assert expect in str(raised.value), f"{name} failed for another reason: {raised.value}"


DECISION = [
    ("decision_stores_no_as_of", "assumptions_as_of if figures else None", "None",
     checks.check_decision_stores_the_resolvers_as_of, "None == '2026-11-01'"),
    ("decision_stores_the_newer_as_of", "min(resolved.risk_free_as_of, resolved.erp_as_of)",
     "max(resolved.risk_free_as_of, resolved.erp_as_of)",
     checks.check_decision_stores_the_resolvers_as_of, "2026-11-13"),
    ("decision_resolves_even_with_explicit_rates", "if risk_free_rate is None or equity_risk_premium is None:",
     "if True:", checks.check_decision_with_explicit_rates_has_no_as_of, "the resolver must not be read"),
    ("decision_ignores_missing_assumptions", "        if isinstance(resolved, AssumptionsMissing):",
     "        if False:", checks.check_decision_with_missing_assumptions_keeps_the_memo, "no attribute 'risk_free_as_of'"),
    ("decision_does_not_catch_the_refusal", "    except AssumptionsRefused as exc:",
     "    except ZeroDivisionError as exc:", checks.check_default_loader_refusal_is_recorded_not_raised,
     "market assumptions missing"),
]


@pytest.mark.parametrize(("name", "old", "new", "check", "expect"), DECISION, ids=[m[0] for m in DECISION])
def test_decision_mutation_is_caught(name, old, new, check, expect, monkeypatch):
    mutated = _mutate(investment_decision, old, new)
    with pytest.raises(BaseException) as raised:
        check(mutated, monkeypatch)
    assert expect in str(raised.value), f"{name} failed for another reason: {raised.value}"


def test_legacy_column_not_null_is_caught():
    from apps.api.services.db import get_db

    with get_db() as conn:
        conn.execute("ALTER TABLE investment_decision DROP COLUMN assumptions_as_of")
        conn.execute("ALTER TABLE investment_decision ADD COLUMN assumptions_as_of TEXT NOT NULL DEFAULT 'unknown'")
    with pytest.raises(AssertionError) as raised:
        checks.check_legacy_null_decision_still_reads()
    assert "'unknown'" in str(raised.value)


def test_reader_that_crashes_on_null_is_caught(monkeypatch):
    from apps.api.models.schema_parts import decision as decision_schema
    from apps.api.routes import decisions as decisions_route

    class Strict(decision_schema.DecisionRow):
        assumptions_as_of: str

    monkeypatch.setattr(decisions_route, "DecisionRow", Strict)
    with pytest.raises(BaseException) as raised:
        checks.check_legacy_null_decision_still_reads()
    assert "assumptions_as_of" in str(raised.value) or "500" in str(raised.value) or "ValidationError" in str(raised.value)


GENERATORS = [
    ("fair_value_values_with_a_literal_when_missing", fair_value,
     "            return None, False, None, assumptions_missing_reason(exc)", "            riskfree_rate = 0.042",
     checks.check_fair_value_refuses_without_assumptions, "reason"),
    ("baseline_values_with_a_literal_when_missing", company_baseline,
     "            return None, assumptions_missing_reason(exc)", "            riskfree_rate = 0.042",
     checks.check_baseline_refuses_without_assumptions, "reason"),
]


@pytest.mark.parametrize(("name", "real", "old", "new", "check", "expect"), GENERATORS, ids=[m[0] for m in GENERATORS])
def test_generator_mutation_is_caught(name, real, old, new, check, expect):
    mutated = _mutate(real, old, new)
    with pytest.raises(BaseException) as raised:
        check(mutated)
    assert expect in str(raised.value) or "assumptions_missing" in str(raised.value), (
        f"{name} failed for another reason: {raised.value}"
    )


def test_fair_value_route_that_raises_instead_of_422_is_caught(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("route lost the reason")

    monkeypatch.setattr(fair_value, "generate_fair_value_case_for_ticker", boom)
    with pytest.raises(BaseException):
        checks.check_fair_value_route_says_why_without_assumptions()


@pytest.mark.parametrize("path", ["apps/api/services/corporate_dcf.py", "apps/api/services/investment_decision.py"])
def test_guard_now_covers_the_dcf_and_decision_files(path):
    sources = dict(guard.current_sources())
    sources[path] += "\nX = 0.055\n"
    hits = guard.scan(sources)
    assert hits and all(h.startswith(path) for h in hits), hits
