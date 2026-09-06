"""Map an engine refusal message to a stable code.

`/fork` passes the engine's refusal through VERBATIM, because the engine owns
that wording. Grouping is different: `/simulate` counts refusals into buckets,
and a client keying a histogram off
"terminal spread is not positive: wacc 3.0000% must exceed growth 3.0000%"
breaks the moment anyone reformats a percentage. So a group carries a stable
code to branch on AND the engine's verbatim message to read.

The rows are DERIVED by enumerating `raise ValueError` sites in
`packages/core_finance/segment_valuation.py` and `dcf.py`, not invented, and
their completeness is pinned by `tests/api/test_engine_refusals.py` -- which
drives each condition through the real engine.

If `other` starts appearing in practice, the fix is typed refusals in
`core_finance` (the move `DuplicateCaseName` made in the fork/diff work), not a
larger match table.
"""
from __future__ import annotations

# (code, distinguishing substring). ORDER MATTERS: the first match wins.
# `roic_below_wacc` and `terminal_spread_not_positive` are NOT actually
# ambiguous against each other -- their substrings are the full phrases
# "must exceed wacc_stable" and "terminal spread is not positive", and neither
# message contains the other's substring (confirmed directly: reordering them
# in mutation testing left `roic_below_wacc` classifying correctly either way).
# The order between this pair is defensive insurance, not currently
# load-bearing -- it would become load-bearing only if one of the two
# substrings were later weakened toward the other (e.g. down to a bare
# "must exceed").
REFUSAL_CODES: tuple[tuple[str, str], ...] = (
    ("roic_below_wacc", "must exceed wacc_stable"),
    ("terminal_spread_not_positive", "terminal spread is not positive"),
    ("terminal_growth_above_riskfree", "perpetual growth is capped there"),
    ("target_revenue_unreachable", "target revenue ratio"),
    ("rate_out_of_unit_interval", "must be a decimal fraction between 0 and 1"),
    ("negative_balance", "must not be negative"),
    ("horizon_incoherent", "converge_from must be between"),
    ("non_positive_rate", "must be positive"),
    ("roic_above_marginal_return", "exceeds the target-year marginal return"),
    ("roic_below_growth_magnitude", "must exceed the magnitude of terminal growth"),
    # Fix round 2: `ramp_incoherent` (a bare "ramp_start_year" marker) used to
    # cover this whole group under one code and one reported message, but it
    # actually swept five distinct raise sites into that one bucket -- a
    # count wearing a label it had not earned. Split on the phrase each
    # message uses to name ITS OWN cause. `"is incoherent with base_revenue"`
    # (revenue_path) and `"is incoherent with a ramped segment"`
    # (SegmentSpec.__post_init__) look similar but are disjoint phrases from
    # disjoint raise sites -- neither is a substring of the other, confirmed
    # directly against both real messages; see task-3-report.md.
    ("ramp_start_year_below_one", "ramp_start_year must be at least 1"),
    ("ramp_conflicts_with_base_revenue", "is incoherent with base_revenue"),
    # One row, two raise sites (initial_growth vs. ramp, and
    # waypoint_gap_fraction vs. ramp): both use this identical phrase for the
    # same underlying conflict -- a growth curve that assumes revenue already
    # exists clashing with a ramp that starts it at zero -- so one code is
    # correct here, not an oversight the other three rows had to fix.
    ("curve_conflicts_with_ramp", "is incoherent with a ramped segment"),
    ("ramp_leaves_no_years", "leaves no years to ramp over"),
    ("horizon_incoherent", "must be after base_year"),
    ("wacc_below_negative_one", "wacc must exceed -100%"),
    # Not shortened to "must exceed -100%": that would collide with
    # `wacc_below_negative_one`'s message, which contains the identical bare
    # phrase for a different field.
    ("initial_growth_below_negative_one", "initial_growth must exceed -100%"),
    ("waypoint_gap_fraction_out_of_range", "must lie strictly between 0 and 1"),
    # Found by the structural test (fix round 3): reachable by combining a
    # stored segment's waypoint_gap_fraction with a sampled target_year/
    # base_year that changes the horizon away from the 10-year, two-5-year-
    # block shape the gap-closing curve is hardcoded for.
    ("gap_curve_wrong_horizon", "the gap-closing curve is defined for a"),
    # Found by the structural test: setting BOTH curve-selecting fields at
    # once on a stored segment (both numeric, both real values) is a
    # reachable combination, same pattern as `curve_conflicts_with_ramp`.
    ("two_curves_conflict", "are different revenue curves and cannot both be set"),
)


def classify(message: str) -> str:
    """Return the stable code for an engine refusal message, or `other`.

    `other` is deliberately not a guess: an unmatched message keeps its verbatim
    text in the response and signals that this table needs a row.
    """
    for code, marker in REFUSAL_CODES:
        if marker in message:
            return code
    return "other"
