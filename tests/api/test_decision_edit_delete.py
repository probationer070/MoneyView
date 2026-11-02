"""Correcting a decision: PATCH action/memo with an edited_at mark, DELETE with a tombstone.

Spec: docs/superpowers/specs/2026-11-01-decision-edit-delete-design.md. The captured figures and
decided_at must never move: the log records what was believed and when; only what the owner typed
can be corrected, and a correction is visible.
"""
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services import investment_decision
from apps.api.services.db import get_db

client = TestClient(app)

FIGURE_COLUMNS = (
    "ticker", "decided_at", "price_at_decision", "dcf_value", "dcf_implied_return", "roic", "wacc",
    "risk_free_rate", "equity_risk_premium", "metric_schema_version", "figures_source",
    "figures_unavailable_reason", "sync_uid",
)


def _record(monkeypatch, action="buy", memo="thesis intact") -> int:
    def fake_loader(ticker, *, risk_free_rate, equity_risk_premium):
        return {"price_at_decision": 100.0, "dcf_value": 150.0, "dcf_implied_return": 50.0,
                "roic": 20.0, "wacc": 10.0, "source": "test"}

    monkeypatch.setattr(investment_decision, "_default_figures_loader", fake_loader)
    response = client.post("/api/v1/decisions", json={"ticker": "MSFT", "action": action, "memo": memo})
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _row(decision_id: int) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM investment_decision WHERE id = ?", (decision_id,)).fetchone()
    return dict(row) if row else None


def test_an_edit_changes_action_and_memo_and_marks_the_row_edited(monkeypatch):
    decision_id = _record(monkeypatch)
    response = client.patch(f"/api/v1/decisions/{decision_id}", json={"action": "sell", "memo": "thesis broke"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["action"], data["memo"]) == ("sell", "thesis broke")
    assert data["edited_at"] is not None
    assert client.get("/api/v1/decisions").json()["data"][0]["edited_at"] == data["edited_at"]


def test_an_edit_leaves_every_captured_figure_and_the_decision_time_unchanged(monkeypatch):
    decision_id = _record(monkeypatch)
    before = _row(decision_id)
    client.patch(f"/api/v1/decisions/{decision_id}", json={"action": "pass", "memo": "changed my mind"})
    after = _row(decision_id)
    assert {c: after[c] for c in FIGURE_COLUMNS} == {c: before[c] for c in FIGURE_COLUMNS}


def test_an_unchanged_save_is_not_an_edit(monkeypatch):
    decision_id = _record(monkeypatch, action="buy", memo="thesis intact")
    response = client.patch(f"/api/v1/decisions/{decision_id}", json={"action": "buy", "memo": "thesis intact"})
    assert response.status_code == 200, response.text
    assert response.json()["data"]["edited_at"] is None
    assert _row(decision_id)["edited_at"] is None


def test_an_edit_may_not_carry_a_figure_or_a_ticker(monkeypatch):
    decision_id = _record(monkeypatch)
    for extra in ({"price_at_decision": 1.0}, {"ticker": "AAPL"}):
        response = client.patch(f"/api/v1/decisions/{decision_id}", json={"action": "sell", "memo": "m", **extra})
        assert response.status_code == 422, (extra, response.text)
    assert _row(decision_id)["action"] == "buy"


def test_an_edit_refuses_a_blank_memo_and_an_unknown_action(monkeypatch):
    decision_id = _record(monkeypatch)
    assert client.patch(f"/api/v1/decisions/{decision_id}", json={"action": "sell", "memo": "  "}).status_code == 422
    assert client.patch(f"/api/v1/decisions/{decision_id}", json={"action": "hodl", "memo": "m"}).status_code == 422
    assert _row(decision_id)["edited_at"] is None


def test_editing_or_deleting_a_missing_decision_is_a_404():
    assert client.patch("/api/v1/decisions/999", json={"action": "sell", "memo": "m"}).status_code == 404
    assert client.delete("/api/v1/decisions/999").status_code == 404


def test_an_edit_stamps_the_record_for_sync(monkeypatch):
    decision_id = _record(monkeypatch)
    uid = _row(decision_id)["sync_uid"]
    with get_db() as conn:
        before = conn.execute("SELECT updated_at FROM record_sync WHERE kind = 'investment_decision' AND uid = ?",
                              (uid,)).fetchone()[0]
    client.patch(f"/api/v1/decisions/{decision_id}", json={"action": "sell", "memo": "thesis broke"})
    with get_db() as conn:
        after = conn.execute("SELECT updated_at FROM record_sync WHERE kind = 'investment_decision' AND uid = ?",
                             (uid,)).fetchone()[0]
    assert after > before


def test_a_delete_removes_the_row():
    with get_db() as conn:
        conn.execute("INSERT INTO investment_decision (ticker, decided_at, action, memo, figures_source) "
                     "VALUES ('MSFT', '2026-01-01T00:00:00+00:00', 'buy', 'm', 'test')")
        decision_id = conn.execute("SELECT id FROM investment_decision").fetchone()[0]
    assert client.delete(f"/api/v1/decisions/{decision_id}").status_code == 204
    assert _row(decision_id) is None


def test_with_sync_on_a_delete_leaves_a_tombstone(monkeypatch, tmp_path):
    # Records-sync spec: with MONEYVIEW_SYNC_DIR unset there are no tombstones, so this needs it set.
    (tmp_path / "cloud").mkdir()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "cloud"))
    decision_id = _record(monkeypatch)
    uid = _row(decision_id)["sync_uid"]
    response = client.delete(f"/api/v1/decisions/{decision_id}")
    assert response.status_code == 204, response.text
    assert _row(decision_id) is None
    assert client.get("/api/v1/decisions").json()["data"] == []
    with get_db() as conn:
        removed_at = conn.execute("SELECT removed_at FROM record_sync WHERE kind = 'investment_decision' AND uid = ?",
                                  (uid,)).fetchone()[0]
    assert removed_at is not None
