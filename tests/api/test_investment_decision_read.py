import pytest

from apps.api.services.investment_decision import list_decisions, record_decision


def _figures(ticker):
    return {
        "price_at_decision": 100.0, "dcf_value": 150.0, "dcf_implied_return": 50.0,
        "roic": 20.0, "wacc": 10.0, "source": "test",
    }


def _bars(ticker, limit=None):
    return [{"date": "2026-12-31", "close": 120.0}]


def test_each_decision_carries_an_outcome_computed_from_bars():
    record_decision(ticker="MSFT", action="buy", memo="m", figures_loader=_figures)
    rows = list_decisions(bars_loader=_bars)
    assert len(rows) == 1
    outcome = rows[0]["outcome"]
    assert outcome["price_move"] == pytest.approx(0.20)
    assert outcome["price_date"] == "2026-12-31"
    assert outcome["reason"] is None


def test_the_gap_at_decision_is_returned_beside_the_move_but_never_combined():
    """Two separately labelled figures. dcf_implied_return has no horizon and the
    move does, so no ratio, difference or accuracy score between them is emitted."""
    record_decision(ticker="MSFT", action="buy", memo="m", figures_loader=_figures)
    row = list_decisions(bars_loader=_bars)[0]
    assert row["dcf_implied_return"] == 50.0
    assert row["outcome"]["price_move"] == pytest.approx(0.20)
    # An ALLOWLIST, not a blocklist of suspicious names. The rule this protects --
    # never combine the horizonless gap with the horizoned move (spec §6) -- must
    # not depend on guessing what someone would name the combination. Any new
    # top-level key fails here, which is the point: adding a field to this
    # response should be a conscious decision someone records in this test, not
    # something that slips through because it was not on a list of five words.
    EXPECTED_KEYS = {
        "id", "ticker", "decided_at", "action", "memo",
        "price_at_decision", "dcf_value", "dcf_implied_return", "roic", "wacc",
        "risk_free_rate", "equity_risk_premium", "metric_schema_version",
        "figures_source", "figures_unavailable_reason",
        "outcome",
    }
    assert set(row) == EXPECTED_KEYS, sorted(set(row) ^ EXPECTED_KEYS)


def test_decisions_come_back_newest_first():
    record_decision(ticker="AAA", action="buy", memo="first", figures_loader=_figures)
    record_decision(ticker="BBB", action="buy", memo="second", figures_loader=_figures)
    assert [r["ticker"] for r in list_decisions(bars_loader=_bars)] == ["BBB", "AAA"]
