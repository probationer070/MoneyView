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
