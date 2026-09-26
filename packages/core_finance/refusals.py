"""Engine refusals that carry a stable code.

A refusal used to be a bare ValueError, and `/simulate` grouped refusals by matching
substrings of the message. A reworded message could then drop its own phrase, gain
another row's, and be counted under the wrong code with every test still passing.
Now each raise site states its code, and the message stays free prose the engine owns.

`EngineRefusal` subclasses ValueError, so every existing `except ValueError` (routes,
the write-time gate, fork, diff) still catches it unchanged, and `str(exc)` is still the
message.
"""
from __future__ import annotations

# Every code an engine raise site may use. `tests/api/test_engine_refusals.py` checks
# that each raise in the engine uses one of these, as a literal, and that each is used.
ENGINE_REFUSAL_CODES: frozenset[str] = frozenset({
    "roic_below_wacc",
    "terminal_spread_not_positive",
    "terminal_growth_above_riskfree",
    "target_revenue_unreachable",
    "rate_out_of_unit_interval",
    "negative_balance",
    "horizon_incoherent",
    "non_positive_rate",
    "roic_above_marginal_return",
    "roic_below_growth_magnitude",
    "ramp_start_year_below_one",
    "ramp_conflicts_with_base_revenue",
    "curve_conflicts_with_ramp",
    "ramp_leaves_no_years",
    "wacc_below_negative_one",
    "initial_growth_below_negative_one",
    "waypoint_gap_fraction_out_of_range",
    "gap_curve_wrong_horizon",
    "two_curves_conflict",
    "missing_required_field",
    "no_revenue_target",
    "no_segments",
    "non_positive_target_capital",
    "rate_schedule_length_mismatch",
    "wacc_not_above_growth",
    "non_positive_shares",
})


class EngineRefusal(ValueError):
    """A model refusal with a stable `code`. The message is prose for a reader."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
