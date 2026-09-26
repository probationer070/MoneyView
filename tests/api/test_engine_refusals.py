import ast
import pathlib

import pytest

from apps.api.services.engine_refusals import classify
from apps.api.services.case_diff import METRIC, run_case_payload
from apps.api.services.valuation_case import create_case, load_case
from packages.core_finance.refusals import ENGINE_REFUSAL_CODES, EngineRefusal
from tests.api.test_case_fork import _parent_payload


@pytest.fixture()
def parent() -> dict:
    return load_case(create_case(_parent_payload()))


# (overrides, expected code). Each entry drives the REAL engine and asserts the
# refusal it raises carries the named code -- the pin from condition to code.
_CONDITIONS = [
    ({"case.wacc_stable": 0.030, "case.terminal_growth": 0.030},
     "terminal_spread_not_positive"),
    ({"case.roic_stable": 0.050, "case.wacc_stable": 0.090},
     "roic_below_wacc"),
    ({"case.terminal_growth": 0.090}, "terminal_growth_above_riskfree"),
    ({"case.shares_basic": 0.0}, "non_positive_rate"),
    ({"case.marginal_tax_rate": 25.0}, "rate_out_of_unit_interval"),
    ({"case.nol_balance": -1.0}, "negative_balance"),
    ({"case.wacc_converge_from": 999}, "horizon_incoherent"),
    # Brief specifies 1.0e12 here; corrected to 1.0e30 -- see task-3-report.md.
    # With the real _parent_payload fixture (base_revenue=1000.0), 1.0e12 gives
    # ratio 1e9, well inside the reachable range up to ~9.9e23 at the engine's
    # explosive-growth bound, so it does NOT raise at all.
    ({"segment.Core.revenue_target": 1.0e30}, "target_revenue_unreachable"),
    # Fix round 1: five more conditions the review found with no row, all
    # reachable through fields the /simulate sampler draws directly
    # (roic_stable, terminal_growth, target_year, ramp_start_year).
    ({"case.roic_stable": 0.70}, "roic_above_marginal_return"),
    ({"case.terminal_growth": -0.20}, "roic_below_growth_magnitude"),
    ({"case.target_year": 2000}, "horizon_incoherent"),
    # Fix round 2: these two used to both map to the single `ramp_incoherent`
    # bucket; relabeled to the split codes below.
    ({"segment.Core.ramp_start_year": 0}, "ramp_start_year_below_one"),
    ({"segment.Core.ramp_start_year": 50}, "ramp_conflicts_with_base_revenue"),
    # Fix round 2 additions. `curve_conflicts_with_ramp` needs a growth curve
    # (initial_growth or waypoint_gap_fraction) combined with a delayed ramp
    # start -- neither field alone reaches it, since both guards are gated on
    # `ramp_start_year > 1` (or base_revenue == 0). Smallest combination that
    # triggers it: pin initial_growth and delay the ramp by one year.
    ({"segment.Core.initial_growth": 0.1, "segment.Core.ramp_start_year": 2},
     "curve_conflicts_with_ramp"),
    # `ramp_leaves_no_years` needs a zero-base segment (so revenue_path takes
    # the ramp branch at all) whose ramp start leaves fewer than one year to
    # reach the target within the 10-year horizon.
    ({"segment.Core.base_revenue": 0.0, "segment.Core.ramp_start_year": 11},
     "ramp_leaves_no_years"),
    ({"case.wacc_stable": -2.0}, "wacc_below_negative_one"),
    # Fix round 3.
    ({"segment.Core.initial_growth": -2.0}, "initial_growth_below_negative_one"),
    ({"segment.Core.waypoint_gap_fraction": 1.5}, "waypoint_gap_fraction_out_of_range"),
    # Found via the structural test: a stored segment's waypoint_gap_fraction
    # combined with a sampled target_year that moves the horizon off 10 years.
    ({"segment.Core.waypoint_gap_fraction": 0.4, "case.target_year": 2033},
     "gap_curve_wrong_horizon"),
    # Found via the structural test: both curve-selecting fields set at once.
    ({"segment.Core.waypoint_gap_fraction": 0.4, "segment.Core.initial_growth": 0.1},
     "two_curves_conflict"),
]


@pytest.mark.parametrize("overrides,expected", _CONDITIONS)
def test_every_engine_condition_raises_its_code(parent, overrides, expected):
    """Each condition, driven through the real engine, raises an EngineRefusal carrying
    its code. The code is stated at the raise site, so rewording a message cannot move a
    refusal into another group -- the defect the old substring table allowed."""
    with pytest.raises(EngineRefusal) as caught:
        run_case_payload(parent, overrides)[METRIC]
    assert caught.value.code == expected
    assert classify(caught.value) == expected


def test_an_error_the_engine_did_not_code_is_other_not_a_guess():
    assert classify(ValueError("something the engine has never said")) == "other"


def test_an_engine_refusal_is_still_a_value_error():
    """Every existing `except ValueError` (routes, the write-time gate, fork, diff)
    must keep catching engine refusals unchanged."""
    assert issubclass(EngineRefusal, ValueError)
    assert str(EngineRefusal("roic_below_wacc", "the message")) == "the message"


# The engine sources whose raise sites must all be coded.
_ENGINE_SOURCES = (
    "packages/core_finance/segment_valuation.py",
    "packages/core_finance/dcf.py",
)


def _raise_sites(path: str) -> list[tuple[int, str, object]]:
    """(line, callee name, first argument node) for every `raise X(...)` in a file."""
    tree = ast.parse(pathlib.Path(path).read_text(encoding="utf-8"))
    sites = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
            func = node.exc.func
            callee = getattr(func, "id", None) or getattr(func, "attr", None) or ""
            first = node.exc.args[0] if node.exc.args else None
            sites.append((node.lineno, callee, first))
    return sites


def test_every_engine_raise_is_a_coded_refusal_with_a_known_literal_code():
    """No raise in the engine may fall back to an uncoded ValueError (it would group
    as `other`), and every code must be a literal from ENGINE_REFUSAL_CODES, so a
    typo'd code fails here rather than creating a new group silently."""
    problems = []
    for path in _ENGINE_SOURCES:
        for line, callee, first in _raise_sites(path):
            name = path.split("/")[-1]
            if callee != "EngineRefusal":
                problems.append(f"{name}:{line} raises {callee or '?'}, not EngineRefusal")
            elif not (isinstance(first, ast.Constant) and isinstance(first.value, str)):
                problems.append(f"{name}:{line} passes a non-literal code")
            elif first.value not in ENGINE_REFUSAL_CODES:
                problems.append(f"{name}:{line} uses unknown code {first.value!r}")
    assert problems == [], problems


def test_every_known_code_is_raised_somewhere():
    """A code in ENGINE_REFUSAL_CODES that no raise site uses is a stale entry."""
    used = {
        first.value
        for path in _ENGINE_SOURCES
        for _line, callee, first in _raise_sites(path)
        if callee == "EngineRefusal" and isinstance(first, ast.Constant)
    }
    assert used == set(ENGINE_REFUSAL_CODES), set(ENGINE_REFUSAL_CODES) ^ used
