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
