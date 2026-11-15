"""Deleting a valuation case: children go with it, forks block it, and with records sync on the
tombstone keeps a peer from sending it back (records-sync spec, same rule as delete_decision)."""

import contextlib

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services import valuation_case
from apps.api.services.db import get_db
from tests.api.records_sync.test_service import PC
from tests.api.valuation_fixtures import _case_payload

client = TestClient(app)


@pytest.fixture
def cloud(tmp_path, monkeypatch):
    root = tmp_path / "cloud"
    root.mkdir()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(root))
    return root


def _count(sql, *args):
    with get_db() as conn:
        return conn.execute(sql, args).fetchone()[0]


def _create(name):
    response = client.post("/api/v1/valuation/cases", json=_case_payload(case_name=name))
    assert response.status_code == 200
    return response.json()["data"]["id"]


def _no_cascade_get_db():
    """get_db with foreign keys off, so a child row only disappears if the code deletes it."""
    @contextlib.contextmanager
    def wrapper():
        with get_db() as conn:
            conn.execute("PRAGMA foreign_keys=OFF")
            try:
                yield conn
            finally:
                conn.execute("PRAGMA foreign_keys=ON")
    return wrapper


def test_delete_removes_the_case_and_its_segment_and_narrative_rows():
    case_id = _create("del-me")
    assert _count("SELECT COUNT(*) FROM segment WHERE case_id = ?", case_id) > 0
    response = client.delete(f"/api/v1/valuation/cases/{case_id}")
    assert response.status_code == 200
    assert response.json()["data"] == {"deleted": True}
    assert _count("SELECT COUNT(*) FROM valuation_case WHERE id = ?", case_id) == 0
    assert _count("SELECT COUNT(*) FROM segment WHERE case_id = ?", case_id) == 0
    assert client.get(f"/api/v1/valuation/cases/{case_id}").status_code == 404


def test_children_are_deleted_by_the_code_not_only_by_cascade(monkeypatch):
    case_id = _create("del-explicit")
    monkeypatch.setattr(valuation_case, "get_db", _no_cascade_get_db())
    assert valuation_case.delete_valuation_case(case_id) is True
    assert _count("SELECT COUNT(*) FROM segment WHERE case_id = ?", case_id) == 0
    assert _count("SELECT COUNT(*) FROM case_narrative WHERE case_id = ?", case_id) == 0
    assert _count("SELECT COUNT(*) FROM segment_narrative WHERE segment_id NOT IN (SELECT id FROM segment)") == 0


def test_unknown_id_is_404():
    assert client.delete("/api/v1/valuation/cases/987654").status_code == 404
    assert valuation_case.delete_valuation_case(987654) is False


def test_a_case_with_forks_is_409_and_nothing_is_deleted():
    parent = _create("fork-parent")
    with get_db() as conn:
        conn.execute("UPDATE valuation_case SET parent_case_id = ? WHERE id = ?", (parent, _create("fork-child")))
    response = client.delete(f"/api/v1/valuation/cases/{parent}")
    assert response.status_code == 409
    assert "fork" in response.json()["detail"]
    assert _count("SELECT COUNT(*) FROM valuation_case WHERE id = ?", parent) == 1
    assert _count("SELECT COUNT(*) FROM segment WHERE case_id = ?", parent) > 0


def test_with_records_sync_on_the_tombstone_keeps_the_peer_from_sending_it_back(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.sync(); b.sync()
    a.add_case("Doomed Case")
    b.sync()
    b.use()
    case_id = b.cases()["Doomed Case"]["id"]
    assert valuation_case.delete_valuation_case(case_id) is True
    assert any(kind == "valuation_case" for kind, _ in b.tombstones())
    b.sync(); a.sync()
    assert "Doomed Case" not in a.cases()
    b.sync()
    assert "Doomed Case" not in b.cases()
