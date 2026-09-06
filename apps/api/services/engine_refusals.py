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
    # Bare field name, not a phrase: it also matches three OTHER engine
    # messages not covered by any test condition here (initial_growth vs.
    # ramp conflict, waypoint_gap_fraction vs. ramp conflict, and
    # insufficient years to ramp over the horizon) -- see task-3-report.md,
    # "ramp_incoherent bucket scope". All are ramp_start_year-incoherence in
    # the broad sense this code names, so the sweep is accepted, not an
    # oversight. Placed after every other row: nothing above matches
    # "ramp_start_year" and nothing below needs to run first.
    ("ramp_incoherent", "ramp_start_year"),
    ("horizon_incoherent", "must be after base_year"),
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
