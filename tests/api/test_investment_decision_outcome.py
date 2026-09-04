import pytest

from apps.api.services.investment_decision import outcome_for


def _bars(pairs):
    return [{"date": d, "close": c} for d, c in pairs]


def test_the_move_is_measured_from_the_decision_price_and_names_both_dates():
    outcome = outcome_for(
        decided_at="2026-01-10T00:00:00+00:00",
        price_at_decision=100.0,
        bars=_bars([("2026-01-09", 90.0), ("2026-01-12", 110.0), ("2026-02-01", 120.0)]),
    )
    assert outcome["reason"] is None, outcome
    assert outcome["price_now"] == 120.0
    assert outcome["price_date"] == "2026-02-01"
    assert outcome["price_move"] == pytest.approx(0.20)
    # The period must be stated, not implied: a bare percentage invites the
    # reader to supply a horizon the number does not have.
    assert outcome["decided_on"] == "2026-01-10"


def test_a_bar_before_the_decision_cannot_be_the_outcome():
    """The only bar is older than the decision, so there is no move to report.
    Returning the stale close would date the outcome before its own cause."""
    outcome = outcome_for(
        decided_at="2026-01-10T00:00:00+00:00",
        price_at_decision=100.0,
        bars=_bars([("2026-01-09", 90.0)]),
    )
    assert outcome["price_move"] is None
    assert "no bar" in outcome["reason"]


def test_no_outcome_without_a_decision_price():
    """A decision recorded with figures_unavailable_reason has no price to
    measure from, so it refuses rather than reporting a move against zero."""
    outcome = outcome_for(
        decided_at="2026-01-10T00:00:00+00:00",
        price_at_decision=None,
        bars=_bars([("2026-02-01", 120.0)]),
    )
    assert outcome["price_move"] is None
    assert "no price" in outcome["reason"]


def test_a_null_close_is_skipped_rather_than_ending_the_series():
    """load_price_bars passes NULL closes through verbatim; the newest bar may
    carry one, and float(None) would raise inside the panel."""
    outcome = outcome_for(
        decided_at="2026-01-10T00:00:00+00:00",
        price_at_decision=100.0,
        bars=_bars([("2026-02-01", 120.0), ("2026-02-02", None)]),
    )
    assert outcome["price_now"] == 120.0
    assert outcome["price_date"] == "2026-02-01"


def test_a_genuine_zero_move_is_reported_as_zero_not_as_a_refusal():
    """The other half of the refusal rule. A decision whose price has not moved
    is a real reading of 0.0, and must be distinguishable from "no bar after the
    decision", which refuses. Collapsing the two would make a flat result and a
    missing result look identical -- the exact confusion the reason field exists
    to prevent."""
    outcome = outcome_for(
        decided_at="2026-01-10T00:00:00+00:00",
        price_at_decision=100.0,
        bars=_bars([("2026-02-01", 100.0)]),
    )
    assert outcome["price_move"] == 0.0
    assert outcome["price_move"] is not None
    assert outcome["reason"] is None
    assert outcome["price_date"] == "2026-02-01"
