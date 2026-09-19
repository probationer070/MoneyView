"""Routes and startup (spec §2, §3)."""

import json

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.routes import portfolio as portfolio_routes
from apps.api.services import watchlist_seed
from apps.api.services.db import get_db
from apps.api.services.watchlist_sync import files, model, service

client = TestClient(app)
BASE = "/api/v1/portfolio/watchlist"


def _quiet_prices(monkeypatch):
    monkeypatch.setattr(portfolio_routes._mkt, "get_stock_ohlcv", lambda *a, **k: [])


def _enable(tmp_path, monkeypatch):
    root = tmp_path / "cloud"
    root.mkdir()
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(root))
    _quiet_prices(monkeypatch)
    return root


def test_get_watchlist_merges_a_peer_file(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    (root / "MoneyView").mkdir()
    (root / "MoneyView" / "watchlist.PC-PEER-0001.json").write_text(json.dumps({
        "format_version": 1, "pc_id": "PC-PEER-0001", "written_at": "2026-09-18T10:00:00.000Z",
        "watchlist": [{"ticker": "PEER", "name": "Peer", "sector": "", "group_name": "custom", "weight": 0.0,
                       "updated_at": "2026-09-18T10:00:00.000Z", "updated_by": "PC-PEER-0001"}],
        "removed": []}), encoding="utf-8")

    tickers = {row["ticker"] for row in client.get(BASE).json()}

    assert "PEER" in tickers


def test_get_watchlist_does_not_revive_a_seed_ticker_deleted_on_another_pc(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"custom": {"targets": [{"ticker": "SEED", "name": "Seed", "sector": "", "weight": 0.0}]}}), encoding="utf-8")
    monkeypatch.setattr(portfolio_routes, "_WATCHLIST_JSON", seed)
    client.post(BASE, json={"ticker": "KEEP", "name": "Keep", "sector": "", "group_name": "custom", "weight": 0.0})
    (root / "MoneyView" / "watchlist.PC-PEER-0001.json").write_text(json.dumps({
        "format_version": 1, "pc_id": "PC-PEER-0001", "written_at": "2026-09-18T10:00:00.000Z",
        "watchlist": [],
        "removed": [{"ticker": "SEED", "removed_at": "2026-09-18T10:00:00.000Z", "removed_by": "PC-PEER-0001"}]}),
        encoding="utf-8")

    tickers = {row["ticker"] for row in client.get(BASE).json()}

    assert "SEED" not in tickers, "the git-seed merge must not run while sync is on"


def test_a_missing_folder_still_serves_the_watchlist_and_reports_the_error(tmp_path, monkeypatch):
    _quiet_prices(monkeypatch)
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "gone"))

    response = client.get(BASE)

    assert response.status_code == 200
    assert client.get(f"{BASE}/peer-sync").json()["data"]["last_error"]


def test_peer_sync_is_read_only(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    client.get(BASE)
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
        before_rows = [tuple(r) for r in conn.execute("SELECT * FROM watchlist ORDER BY ticker")]
    own = files.own_file_path(root, pc_id)
    before_mtime = own.stat().st_mtime_ns

    client.get(f"{BASE}/peer-sync")

    with get_db() as conn:
        assert [tuple(r) for r in conn.execute("SELECT * FROM watchlist ORDER BY ticker")] == before_rows
    assert own.stat().st_mtime_ns == before_mtime


def test_a_local_edit_is_stamped_and_published(tmp_path, monkeypatch):
    root = _enable(tmp_path, monkeypatch)
    client.post(BASE, json={"ticker": "NVDA", "name": "NVIDIA", "sector": "Semis", "group_name": "custom", "weight": 0.1})
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
        row = conn.execute("SELECT updated_by FROM watchlist WHERE ticker = 'NVDA'").fetchone()
    published = json.loads(files.own_file_path(root, pc_id).read_text(encoding="utf-8"))

    assert row["updated_by"] == pc_id
    assert "NVDA" in {r["ticker"] for r in published["watchlist"]}


def test_an_unchanged_upsert_keeps_the_timestamp(tmp_path, monkeypatch):
    _enable(tmp_path, monkeypatch)
    body = {"ticker": "NVDA", "name": "NVIDIA", "sector": "Semis", "group_name": "custom", "weight": 0.1}
    client.post(BASE, json=body)
    with get_db() as conn:
        first = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]
    client.post(BASE, json=body)
    with get_db() as conn:
        second = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]
    assert first == second


def test_a_group_change_is_stamped(tmp_path, monkeypatch):
    _enable(tmp_path, monkeypatch)
    client.post(BASE, json={"ticker": "NVDA", "name": "NVIDIA", "sector": "", "group_name": "custom", "weight": 0.1})
    with get_db() as conn:
        first = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]
    client.post(f"{BASE}/NVDA/group", json={"group_name": "total"})
    with get_db() as conn:
        second = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]
    assert second > first


def test_a_delete_records_a_tombstone_only_while_sync_is_on(tmp_path, monkeypatch):
    _quiet_prices(monkeypatch)
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    client.post(BASE, json={"ticker": "OFF", "name": "Off", "sector": "", "group_name": "custom", "weight": 0.0})
    client.delete(f"{BASE}/OFF")
    _enable(tmp_path, monkeypatch)
    client.post(BASE, json={"ticker": "ON", "name": "On", "sector": "", "group_name": "custom", "weight": 0.0})
    client.delete(f"{BASE}/ON")
    with get_db() as conn:
        tombs = {r["ticker"] for r in conn.execute("SELECT ticker FROM watchlist_removed")}
    assert tombs == {"ON"}


def test_timestamps_are_kept_while_sync_is_off(tmp_path, monkeypatch):
    _quiet_prices(monkeypatch)
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    client.post(BASE, json={"ticker": "OFF", "name": "Off", "sector": "", "group_name": "custom", "weight": 0.0})
    with get_db() as conn:
        row = conn.execute("SELECT updated_at, updated_by FROM watchlist WHERE ticker = 'OFF'").fetchone()
    assert row["updated_at"] and row["updated_by"]


def test_import_is_refused_while_sync_is_on_even_without_the_ui(tmp_path, monkeypatch):
    _enable(tmp_path, monkeypatch)
    response = client.post(f"{BASE}/resync")
    assert response.status_code == 409
    assert "unavailable while watchlist sync is on" in response.text


def test_export_writes_the_personal_file_never_the_committed_seed(tmp_path, monkeypatch):
    _quiet_prices(monkeypatch)
    # A regression that has Export write to _WATCHLIST_JSON (mutation 6, task-6-report.md) must
    # never be able to reach the real committed seed even while this test is proving it -- so
    # _WATCHLIST_JSON and SEED_JSON are redirected to a private copy, not the real file. The
    # session-wide guard in tests/conftest.py (_guard_the_committed_seed) is the last resort;
    # this test does not depend on it.
    seed_copy = tmp_path / "stock_targets.json"
    seed_copy.write_bytes(watchlist_seed.SEED_JSON.read_bytes())
    monkeypatch.setattr(portfolio_routes, "_WATCHLIST_JSON", seed_copy)
    monkeypatch.setattr(watchlist_seed, "SEED_JSON", seed_copy)
    export = tmp_path / "exports" / "watchlist-export.json"
    monkeypatch.setattr(watchlist_seed, "EXPORT_JSON", export)
    seed_before = seed_copy.read_bytes()
    client.post(BASE, json={"ticker": "NVDA", "name": "NVIDIA", "sector": "", "group_name": "custom", "weight": 0.1})

    for sync_dir in (None, tmp_path / "cloud"):
        if sync_dir is None:
            monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
        else:
            sync_dir.mkdir(exist_ok=True)
            monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(sync_dir))
        response = client.post(f"{BASE}/sync")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["json_path"] == str(export)

    assert "NVDA" in export.read_text(encoding="utf-8")
    assert seed_copy.read_bytes() == seed_before


def test_upsert_runs_sync_after_its_own_transaction_commits(tmp_path, monkeypatch):
    """Guards the no-self-deadlock rule: run_sync must run only after the route's own
    `with get_db()` block has committed. Called from inside that block instead, run_sync's
    `BEGIN IMMEDIATE` would wait out SQLite's ~5s busy timeout against the still-open write
    lock and record "database is locked" as last_error, instead of publishing.
    """
    root = _enable(tmp_path, monkeypatch)

    response = client.post(BASE, json={"ticker": "DEADLOCK", "name": "Deadlock", "sector": "",
                                        "group_name": "custom", "weight": 0.0})

    assert response.status_code == 200
    assert service.current_status().last_error is None
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
    published = json.loads(files.own_file_path(root, pc_id).read_text(encoding="utf-8"))
    assert "DEADLOCK" in {r["ticker"] for r in published["watchlist"]}


def test_group_change_runs_sync_after_its_own_transaction_commits(tmp_path, monkeypatch):
    """Same no-self-deadlock guard as the upsert test (fix round 1, I2), for set_watchlist_group."""
    root = _enable(tmp_path, monkeypatch)
    client.post(BASE, json={"ticker": "NVDA", "name": "NVIDIA", "sector": "", "group_name": "custom", "weight": 0.1})

    response = client.post(f"{BASE}/NVDA/group", json={"group_name": "total"})

    assert response.status_code == 200
    assert service.current_status().last_error is None
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
    published = json.loads(files.own_file_path(root, pc_id).read_text(encoding="utf-8"))
    row = next(r for r in published["watchlist"] if r["ticker"] == "NVDA")
    assert row["group_name"] == "total"


def test_delete_runs_sync_after_its_own_transaction_commits(tmp_path, monkeypatch):
    """Same no-self-deadlock guard as the upsert test (fix round 1, I2), for delete_watchlist_item."""
    root = _enable(tmp_path, monkeypatch)
    client.post(BASE, json={"ticker": "GONE", "name": "Gone", "sector": "", "group_name": "custom", "weight": 0.0})

    response = client.delete(f"{BASE}/GONE")

    assert response.status_code == 200
    assert service.current_status().last_error is None
    with get_db() as conn:
        pc_id = service.local_pc_id(conn)
    published = json.loads(files.own_file_path(root, pc_id).read_text(encoding="utf-8"))
    assert "GONE" not in {r["ticker"] for r in published["watchlist"]}
    assert "GONE" in {r["ticker"] for r in published["removed"]}


def test_reposting_the_same_group_does_not_restamp(tmp_path, monkeypatch):
    """set_watchlist_group must stamp only when the group actually changes (fix round 1, I3)."""
    _enable(tmp_path, monkeypatch)
    client.post(BASE, json={"ticker": "NVDA", "name": "NVIDIA", "sector": "", "group_name": "custom", "weight": 0.1})
    client.post(f"{BASE}/NVDA/group", json={"group_name": "total"})
    with get_db() as conn:
        first = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]

    client.post(f"{BASE}/NVDA/group", json={"group_name": "total"})

    with get_db() as conn:
        second = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'NVDA'").fetchone()[0]
    assert first == second


def test_startup_with_an_unavailable_folder_still_starts(tmp_path, monkeypatch):
    monkeypatch.setenv("MONEYVIEW_SYNC_DIR", str(tmp_path / "gone"))
    monkeypatch.setenv("MONEYVIEW_DISABLE_STARTUP_JOBS", "1")
    with TestClient(app) as started:
        assert started.get("/api/v1/healthz").status_code == 200


FUTURE = "2099-01-01T00:00:00.000Z"


def _plant_future_peer(root, rows=(), removed=()):
    """A peer whose clock is far ahead of this PC's (or this PC's clock stepped back)."""
    (root / "MoneyView").mkdir(exist_ok=True)
    (root / "MoneyView" / "watchlist.PC-AHEAD-0001.json").write_text(json.dumps({
        "format_version": 1, "pc_id": "PC-AHEAD-0001", "written_at": FUTURE,
        "watchlist": [{"ticker": t, "name": t, "sector": "", "group_name": "custom", "weight": 0.1,
                       "updated_at": FUTURE, "updated_by": "PC-AHEAD-0001"} for t in rows],
        "removed": [{"ticker": t, "removed_at": FUTURE, "removed_by": "PC-AHEAD-0001"} for t in removed]}),
        encoding="utf-8")


def _isolate_stamp_clock(monkeypatch):
    # These tests issue stamps past 2099; restore the process clock at teardown so later tests
    # still see stamps near the real time.
    monkeypatch.setattr(model, "_last_issued", model._last_issued)


@pytest.mark.parametrize("edit", ["group route", "upsert"])
def test_a_local_edit_outranks_the_peer_version_it_replaced_even_from_a_clock_ahead(tmp_path, monkeypatch, edit):
    _isolate_stamp_clock(monkeypatch)
    root = _enable(tmp_path, monkeypatch)
    _plant_future_peer(root, rows=["AHEAD"])
    assert "AHEAD" in {row["ticker"] for row in client.get(BASE).json()}

    if edit == "group route":
        client.post(f"{BASE}/AHEAD/group", json={"group_name": "total"})
    else:
        client.post(BASE, json={"ticker": "AHEAD", "name": "AHEAD", "sector": "", "group_name": "total", "weight": 0.1})

    with get_db() as conn:
        row = conn.execute("SELECT group_name, updated_at FROM watchlist WHERE ticker = 'AHEAD'").fetchone()
    assert service.current_status().last_error is None
    assert row["group_name"] == "total", "the route's sync restored the peer's older-in-intent version"
    assert row["updated_at"] > FUTURE


def test_a_local_delete_outranks_the_peer_row_it_removed_even_from_a_clock_ahead(tmp_path, monkeypatch):
    _isolate_stamp_clock(monkeypatch)
    root = _enable(tmp_path, monkeypatch)
    _plant_future_peer(root, rows=["AHEAD"])
    client.get(BASE)

    client.delete(f"{BASE}/AHEAD")

    with get_db() as conn:
        present = conn.execute("SELECT 1 FROM watchlist WHERE ticker = 'AHEAD'").fetchone()
        tomb = conn.execute("SELECT removed_at FROM watchlist_removed WHERE ticker = 'AHEAD'").fetchone()
    assert service.current_status().last_error is None
    assert present is None, "the route's sync resurrected a ticker the user deleted"
    assert tomb["removed_at"] > FUTURE


def test_re_adding_a_ticker_outranks_its_tombstone_even_from_a_clock_ahead(tmp_path, monkeypatch):
    _isolate_stamp_clock(monkeypatch)
    root = _enable(tmp_path, monkeypatch)
    _plant_future_peer(root, removed=["AHEAD"])
    client.get(BASE)

    client.post(BASE, json={"ticker": "AHEAD", "name": "AHEAD", "sector": "", "group_name": "custom", "weight": 0.1})

    with get_db() as conn:
        row = conn.execute("SELECT updated_at FROM watchlist WHERE ticker = 'AHEAD'").fetchone()
    assert row is not None, "the route's sync applied the older-in-intent tombstone over the re-add"
    assert row["updated_at"] > FUTURE
