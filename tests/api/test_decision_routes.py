from fastapi.testclient import TestClient

from apps.api.main import app

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
