import pytest

from apps.api.services.db import get_db
from apps.api.services.investment_decision import record_decision


def _figures_ok(ticker):
    return {
        "price_at_decision": 431.65,
        "dcf_value": 379.39,
        "dcf_implied_return": -12.11,
        "roic": 29.64,
        "wacc": 9.92,
        "source": "corporate_comparison._dcf_snapshot",
    }


def _figures_refused(ticker):
    raise ValueError(f"no usable metrics for {ticker}")


def _row(decision_id):
    with get_db() as conn:
        return dict(
            conn.execute(
                "SELECT * FROM investment_decision WHERE id = ?", (decision_id,)
            ).fetchone()
        )


def test_the_figures_are_captured_by_the_server_not_supplied_by_the_caller():
    """record_decision takes no figure arguments at all. A browser-posted number
    could be stale or rounded for display and would be stored as what the user
    believed, undetectably."""
    decision_id = record_decision(
        ticker="MSFT", action="buy", memo="cheap on FCF", figures_loader=_figures_ok
    )
    row = _row(decision_id)
    assert row["price_at_decision"] == 431.65
    assert row["dcf_value"] == 379.39
    assert row["figures_source"] == "corporate_comparison._dcf_snapshot"
    assert row["figures_unavailable_reason"] is None


def test_a_decision_is_recorded_even_when_the_model_cannot_value_the_ticker():
    """Otherwise the feature refuses to record decisions about exactly the
    companies the model finds hardest -- the ones a memo is most worth having."""
    decision_id = record_decision(
        ticker="NEWCO", action="watch", memo="pre-revenue, watching",
        figures_loader=_figures_refused,
    )
    row = _row(decision_id)
    assert row["memo"] == "pre-revenue, watching"
    assert row["price_at_decision"] is None
    assert "no usable metrics for NEWCO" in row["figures_unavailable_reason"]


def test_exactly_one_of_figures_and_refusal_is_ever_populated():
    ok = _row(record_decision(ticker="MSFT", action="buy", memo="m", figures_loader=_figures_ok))
    refused = _row(record_decision(ticker="X", action="pass", memo="m", figures_loader=_figures_refused))
    assert (ok["price_at_decision"] is None) != (ok["figures_unavailable_reason"] is None)
    assert (refused["price_at_decision"] is None) != (refused["figures_unavailable_reason"] is None)


def test_an_unknown_action_is_refused():
    with pytest.raises(ValueError, match="action"):
        record_decision(ticker="MSFT", action="hodl", memo="m", figures_loader=_figures_ok)


def test_an_empty_memo_is_refused_before_it_reaches_the_database():
    with pytest.raises(ValueError, match="memo"):
        record_decision(ticker="MSFT", action="buy", memo="   ", figures_loader=_figures_ok)
