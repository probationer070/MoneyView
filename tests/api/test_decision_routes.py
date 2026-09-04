import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services import investment_decision
from apps.api.services.db import get_db

client = TestClient(app)


def test_posting_a_decision_returns_its_id_and_it_comes_back_on_the_list():
    response = client.post(
        "/api/v1/decisions",
        json={"ticker": "MSFT", "action": "watch", "memo": "waiting for a better price"},
    )
    assert response.status_code == 200, response.text
    decision_id = response.json()["data"]["id"]
    assert decision_id > 0

    listed = client.get("/api/v1/decisions").json()["data"]
    assert [row["id"] for row in listed] == [decision_id]
    assert listed[0]["memo"] == "waiting for a better price"


def test_the_route_refuses_figures_supplied_by_the_client():
    """The request model forbids extra fields, so a client cannot smuggle in a
    price and have it stored as what the model said."""
    response = client.post(
        "/api/v1/decisions",
        json={"ticker": "MSFT", "action": "buy", "memo": "m", "price_at_decision": 1.0},
    )
    assert response.status_code == 422, response.text


def test_an_empty_memo_is_a_422_naming_the_field():
    response = client.post(
        "/api/v1/decisions", json={"ticker": "MSFT", "action": "buy", "memo": "  "}
    )
    assert response.status_code == 422
    assert "memo" in response.text


def test_a_blank_ticker_is_a_422_naming_the_field():
    response = client.post(
        "/api/v1/decisions", json={"ticker": "   ", "action": "buy", "memo": "m"}
    )
    assert response.status_code == 422
    assert "ticker" in response.text


def test_the_gap_and_the_move_surface_as_percent_on_the_same_scale(monkeypatch):
    """Finding 2: `_dcf_snapshot` already returns dcf_implied_return multiplied
    by 100 (percent); `outcome_for` returns price_move as a raw fraction. Both
    land on the same DecisionRow and spec S6 plots them together as x and y on
    one scatter -- on the wire they must carry their unit in their name and
    sit on the same scale, or the y-axis flattens to a line at zero."""
    def fake_loader(ticker, *, risk_free_rate, equity_risk_premium):
        return {
            "price_at_decision": 100.0, "dcf_value": 150.0,
            "dcf_implied_return": 50.0, "roic": 20.0, "wacc": 10.0,
            "source": "test",
        }

    monkeypatch.setattr(investment_decision, "_default_figures_loader", fake_loader)

    response = client.post(
        "/api/v1/decisions",
        json={"ticker": "PCTGAP", "action": "buy", "memo": "percent scale check"},
    )
    assert response.status_code == 200, response.text

    with get_db() as conn:
        conn.execute(
            "INSERT INTO stocks (ticker, date, close) VALUES ('PCTGAP', '2099-01-01', 120.0)"
        )

    row = client.get("/api/v1/decisions").json()["data"][0]
    assert row["dcf_implied_return_pct"] == 50.0, row
    assert row["outcome"]["price_move_pct"] == pytest.approx(20.0), row
    # Same scale, numeric relationship visible without combining them into a
    # stored field (see Finding 4): the two percents are directly subtractable
    # by whoever is reading the response, which they could not be at 100x apart.
    assert row["dcf_implied_return_pct"] - row["outcome"]["price_move_pct"] == pytest.approx(30.0), row


def test_the_wire_response_never_combines_the_gap_and_the_move():
    """Finding 4: tests/api/test_investment_decision_read.py guards
    `list_decisions()`, a service-layer dict -- not the wire shape a client
    actually receives. A `@computed_field` on `DecisionRow` combining the two
    figures would ship while that test stayed green. Same allowlist rule
    (spec S6: never combine the horizonless gap with the horizoned move),
    enforced here against the actual HTTP response."""
    response = client.post(
        "/api/v1/decisions",
        json={"ticker": "ALLOWLIST", "action": "watch", "memo": "route-level guard"},
    )
    assert response.status_code == 200, response.text

    row = client.get("/api/v1/decisions").json()["data"][0]
    EXPECTED_KEYS = {
        "id", "ticker", "decided_at", "action", "memo",
        "price_at_decision", "dcf_value", "dcf_implied_return_pct", "roic", "wacc",
        "risk_free_rate", "equity_risk_premium", "metric_schema_version",
        "figures_source", "figures_unavailable_reason",
        "outcome",
    }
    assert set(row) == EXPECTED_KEYS, sorted(set(row) ^ EXPECTED_KEYS)
    outcome_keys = {"decided_on", "price_now", "price_date", "price_move_pct", "reason"}
    assert set(row["outcome"]) == outcome_keys, sorted(set(row["outcome"]) ^ outcome_keys)
