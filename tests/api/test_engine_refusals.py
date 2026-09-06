import ast
import pathlib

import pytest

from apps.api.services.engine_refusals import REFUSAL_CODES, classify
from apps.api.services.case_diff import METRIC, run_case_payload
from apps.api.services.valuation_case import create_case, load_case
from tests.api.test_case_fork import _parent_payload


@pytest.fixture()
def parent() -> dict:
    return load_case(create_case(_parent_payload()))


# (overrides, expected code). Each entry drives the REAL engine and asserts the
# message it produces maps to the named code.
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
def test_every_engine_condition_maps_to_its_code(parent, overrides, expected):
    """Completeness is TESTED, not assumed. Codes are assigned by matching engine
    text, so an engine message reworded next month would silently degrade its
    group to `other` and no other test would notice. This drives each condition
    through the real engine and asserts the code."""
    with pytest.raises(ValueError) as caught:
        run_case_payload(parent, overrides)[METRIC]
    assert classify(str(caught.value)) == expected


@pytest.mark.parametrize("overrides,_expected", _CONDITIONS)
def test_no_engine_condition_falls_through_to_other(parent, overrides, _expected):
    """The complement of the test above, stated separately so the failure names
    the right problem: a message reaching `other` means the table needs a row,
    not that a code is wrong."""
    with pytest.raises(ValueError) as caught:
        run_case_payload(parent, overrides)[METRIC]
    assert classify(str(caught.value)) != "other"


def test_an_unrecognised_message_is_other_not_a_guess():
    assert classify("something the engine has never said") == "other"


def test_the_first_matching_row_wins_and_the_table_is_ordered():
    """`roic_stable ... must exceed wacc_stable` also contains 'must exceed',
    which the spread row could match. Order is load-bearing, so it is asserted
    rather than left to reading order."""
    codes = [code for code, _ in REFUSAL_CODES]
    assert codes.index("roic_below_wacc") < codes.index("terminal_spread_not_positive")


def _raise_message_fragments(path: str) -> list[tuple[int, list[str]]]:
    """Every `raise ValueError(...)` in the engine, as (line number, literal
    fragments). An f-string's interpolations are dropped and its literal parts
    kept separately -- checking per-fragment rather than joined, so no marker can
    accidentally match across an interpolation boundary."""
    tree = ast.parse(pathlib.Path(path).read_text(encoding="utf-8"))
    found = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call)):
            continue
        if getattr(node.exc.func, "id", None) != "ValueError" or not node.exc.args:
            continue
        arg = node.exc.args[0]
        if isinstance(arg, ast.JoinedStr):
            parts = [v.value for v in arg.values
                     if isinstance(v, ast.Constant) and isinstance(v.value, str)]
        elif isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            parts = [arg.value]
        else:
            parts = []
        if parts:
            found.append((node.lineno, parts))
    return found


# Raise sites deliberately NOT classified, each with the reason it cannot be
# reached by perturbing a numeric input of an already-valid stored case.
_UNCLASSIFIED_BY_DESIGN = {
    570: (
        "tax_path's rate_schedule/ebit length-mismatch guard. Its one call site "
        "(run_case, segment_valuation.py:921) always builds rate_schedule via "
        "tax_rate_path with the identical horizon n that produced ebit "
        "(segment_valuation.py:915-920), so the two lengths cannot diverge "
        "through any override run_case_payload exposes -- there is no input that "
        "controls rate_schedule's length independently of ebit's. Defensive "
        "guard against a hypothetical future caller of tax_path with a "
        "hand-built schedule, not a case-input validation."
    ),
    811: (
        "marginal_roic's empty-segments guard. run_case (segment_valuation.py:890) "
        "already raises 'a valuation case needs at least one segment' before "
        "marginal_roic is ever called (segment_valuation.py:927), and "
        "create_case refuses to store a case with no segments in the first "
        "place -- run_case_payload can only override fields of a stored case's "
        "EXISTING segments, never remove a segment from the list. Reachable only "
        "by calling marginal_roic() directly with an empty list, bypassing "
        "run_case entirely."
    ),
    822: (
        "marginal_roic's non-positive-capital guard. total_capital sums "
        "revenue_i / sales_to_capital_late_i across segments; revenue_i > 0 is "
        "already guaranteed by revenue_path's own target-revenue guard "
        "(segment_valuation.py:407-408, run for every segment before "
        "marginal_roic is called) and sales_to_capital_late_i > 0 by "
        "SegmentSpec.__post_init__ (segment_valuation.py:129-133). With at "
        "least one segment (see line 811's entry above), a sum of strictly "
        "positive terms cannot be <= 0 through any override this module "
        "exposes."
    ),
    890: (
        "run_case's own empty-segments guard. create_case (valuation_case.py) "
        "refuses to store a case with no segments, and run_case_payload only "
        "overrides fields of a stored case's EXISTING segments -- it copies "
        "base_case['segments'] and mutates entries by name, never adds or "
        "removes one. No numeric override can make an already-valid stored "
        "case's segment list empty."
    ),
    114: (
        "SegmentSpec's None-value guard for its required fields (name, "
        "base_revenue, base_margin, margin_target, sales_to_capital_early, "
        "sales_to_capital_late, ramp_start_year). A None here means a field was "
        "REMOVED, not that a number moved to an implausible value -- distinct "
        "from every magnitude guard this table classifies. /simulate perturbs "
        "distributions over already-set numeric fields; it does not null them."
    ),
    183: (
        "target_revenue()'s None-value guard: fires only when revenue_target "
        "is None AND (tam_target is None or market_share_target is None). "
        "create_case's _validate_by_engine (valuation_case.py) runs this exact "
        "engine path at write time, so any STORED case already has one of "
        "these three endpoint fields resolvable -- reaching this guard needs "
        "revenue_target to be NULLED on a segment that already has it set, not "
        "a numeric value perturbed. Same category as line 114 above."
    ),
    678: (
        "CaseSpec's None-value guard for its required fields (base_year, "
        "target_year, riskfree_rate, wacc_initial, wacc_stable, "
        "wacc_converge_from, marginal_tax_rate, nol_balance, roic_stable, cash, "
        "debt, ipo_proceeds, shares_basic, shares_new). Same category as line "
        "114: a None means a field was removed, not a number perturbed to an "
        "implausible magnitude."
    ),
}


def test_every_engine_raise_site_is_classified_or_explicitly_excluded():
    """Completeness by CONSTRUCTION rather than by imagination.

    The parametrized tests above check the conditions we thought to try; they
    cannot fail for a message nobody has imagined. Three review rounds each
    found another uncovered message that way. This test reads the engine's own
    source, so a new `raise ValueError` added tomorrow fails here until someone
    either gives it a row or records why it needs none."""
    for line, fragments in _raise_message_fragments(
        "packages/core_finance/segment_valuation.py"
    ):
        if line in _UNCLASSIFIED_BY_DESIGN:
            continue
        matched = any(marker in fragment
                      for fragment in fragments
                      for _, marker in REFUSAL_CODES)
        assert matched, (
            f"segment_valuation.py:{line} raises a message no row matches: "
            f"{fragments!r}. Add a row, or add the line to "
            "_UNCLASSIFIED_BY_DESIGN with the reason it is unreachable."
        )
