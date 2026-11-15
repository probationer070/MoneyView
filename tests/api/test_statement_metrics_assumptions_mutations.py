"""Mutation harness for the S2a tests (guideline/sop/test-verification.md).

Each case plants ONE defect in memory (never on disk) and requires the named check to FAIL with text naming
the real cause. The unmutated checks pass in test_statement_metrics_assumptions.py / test_no_premia_literals.py.
"""
import inspect
import sys
import types

import pytest

from apps.api.routes import corporate as corporate_route
from apps.api.services import corporate_metrics_service
from apps.api.services import corporate_statement_metrics as csm
from tests.api import test_no_premia_literals as guard
from tests.api import test_statement_metrics_assumptions as checks
from tests.api.seed_assumptions import SEED_ASSUMPTIONS

_SOURCE = inspect.getsource(csm)
_STATEMENT_KE = (
    "if isinstance(assumptions, Assumptions):\n"
    "        cost_of_equity = capm_cost_of_equity_pct(assumptions, levered_beta, country_risk_premium) / 100"
)
_AUDIT_KE = (
    "country_risk_premium = country_risk_premium_for(info.get(\"financialCurrency\"), assumptions.crp_non_mature)\n"
    "            cost_of_equity = capm_cost_of_equity_pct(assumptions, levered_beta, country_risk_premium) / 100"
)
_RF_ROW = ("value=round(assumptions.rf_fraction, 6), display_value=_display_percent(assumptions.risk_free_rate), "
           "source=assumptions.risk_free_source")
_REFUSAL_BRANCH = "    else:\n        cost_of_equity = None\n        wacc = None\n"
_AUDIT_REFUSAL = "            if isinstance(assumptions, AssumptionsMissing):\n                raise AssumptionsRefused(assumptions.missing)\n"

SOURCE_MUTATIONS = [
    ("A_statement_path_back_to_literals", _STATEMENT_KE,
     "if isinstance(assumptions, Assumptions):\n        cost_of_equity = (4.2 + levered_beta * 5.5 + country_risk_premium) / 100",
     checks.check_statement_path_ke_uses_assumptions, "12.2"),
    ("B_audit_path_back_to_literals", _AUDIT_KE,
     _AUDIT_KE.split("\n")[0] + "\n            cost_of_equity = (4.2 + levered_beta * 5.5 + country_risk_premium) / 100",
     checks.check_audit_path_ke_uses_assumptions, "0.122"),
    ("C_audit_row_keeps_its_own_literal", _RF_ROW,
     'value=0.042, display_value=_display_percent(4.2), source="Model policy input"',
     checks.check_audit_rows_carry_the_assumptions, "Obtained: 0.042"),
    ("D_refusal_branch_computes_with_seed", _REFUSAL_BRANCH,
     "    else:\n        cost_of_equity = (4.2 + levered_beta * 5.5 + country_risk_premium) / 100\n"
     "        wacc = (equity_weight * cost_of_equity + debt_weight * cost_of_debt * (1 - tax_rate)) * 100\n",
     checks.check_refusal_has_no_wacc, "is None"),
    ("E_audit_does_not_refuse", _AUDIT_REFUSAL,
     "            if isinstance(assumptions, AssumptionsMissing):\n"
     "                assumptions = Assumptions(4.2, 'x', 'x', 5.5, 'x', 'x', 0.8, 'x')\n",
     checks.check_audit_refuses_without_assumptions, "DID NOT RAISE"),
]


def _build(source: str) -> types.ModuleType:
    module = types.ModuleType("mutated_statement_metrics")
    sys.modules["mutated_statement_metrics"] = module
    exec(compile(source, "mutated_statement_metrics", "exec"), module.__dict__)
    return module


@pytest.mark.parametrize(("name", "old", "new", "check", "expect"), SOURCE_MUTATIONS, ids=[m[0] for m in SOURCE_MUTATIONS])
def test_source_mutation_is_caught(name, old, new, check, expect):
    assert _SOURCE.count(old) == 1, f"mutation anchor not unique: {old!r}"
    mutated = _build(_SOURCE.replace(old, new, 1))
    with pytest.raises(BaseException) as raised:
        check(mutated)
    assert expect in str(raised.value), f"{name} failed for another reason: {raised.value}"


def test_route_fed_the_seed_is_caught(monkeypatch):
    real = corporate_metrics_service.yahoo_statement_metrics
    monkeypatch.setattr(
        corporate_metrics_service, "yahoo_statement_metrics",
        lambda *a, **kw: real(*a, **{**kw, "assumptions": SEED_ASSUMPTIONS}),
    )
    with pytest.raises(AssertionError) as raised:
        checks.check_route_ke_equals_the_echoed_inputs(monkeypatch)
    assert "approx" in str(raised.value) or "==" in str(raised.value)


def test_route_that_defaults_when_missing_is_caught(monkeypatch):
    monkeypatch.setattr(corporate_route, "_fractions_or_refuse", lambda: SEED_ASSUMPTIONS)
    with pytest.raises(BaseException) as raised:
        checks.check_route_refuses_without_assumptions(monkeypatch)
    assert "unavailable" in str(raised.value) or "200" in str(raised.value) or "status" in str(raised.value)


@pytest.mark.parametrize("planted", ["X = 0.042", "X = 0.055", "DEFAULT_RISK_FREE_RATE = 1", "from a import KOREA_COUNTRY_RISK_PREMIUM"])
def test_guard_names_the_file_with_a_reintroduced_literal(planted):
    sources = dict(guard.current_sources())
    path = "apps/api/services/corporate_metrics_service.py"
    sources[path] += f"\n{planted}\n"
    hits = guard.scan(sources)
    assert hits and all(h.startswith(path) for h in hits), hits
