"""Every path that removes a watchlist row records a pending cleanup; every path that adds one
clears it (spec 2026-10-15 §2.3, test §4.5).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.routes import portfolio as portfolio_route
from apps.api.services import watchlist_cleanup, watchlist_seed
from apps.api.services.db import get_db
from tests.api.test_watchlist_cleanup_run import DAY, FULL, GRACE, T0, cache_counts, seed_caches
from tests.api.watchlist_sync.test_service import PC, cloud  # noqa: F401 - cloud is a pytest fixture

ITEM = {"ticker": "ZZA", "name": "Zed A", "sector": "", "group_name": "custom", "weight": 0.0}


@pytest.fixture(autouse=True)
def _no_real_acquisition(monkeypatch):
    # POST /watchlist schedules a live bars fetch for a new row (routes/portfolio.py:219-224).
    monkeypatch.setattr("apps.api.routes.portfolio.schedule_acquisition", lambda data_class, subject: None)


def pending() -> dict[str, str]:
    with get_db() as conn:
        return {r["ticker"]: r["removed_at"] for r in conn.execute("SELECT ticker, removed_at FROM cleanup_pending")}


def _seed_file(tmp_path, *tickers: str):
    path = tmp_path / "seed.json"
    targets = [{"ticker": t, "name": t, "sector": "", "weight": 0.0} for t in tickers]
    path.write_text(json.dumps({"custom": {"targets": targets}}), encoding="utf-8")
    return path


# --- P1, P2 (local routes) ----------------------------------------------------------------------

def test_deleting_a_watchlist_ticker_records_when_it_left():
    client = TestClient(app)
    assert client.post("/api/v1/portfolio/watchlist", json=ITEM).status_code == 200
    before = datetime.now(timezone.utc)
    assert client.delete("/api/v1/portfolio/watchlist/ZZA").status_code == 200
    after = datetime.now(timezone.utc)

    recorded = pending()
    assert "ZZA" in recorded, "DELETE /watchlist/{ticker} recorded no pending cleanup"
    assert before <= datetime.fromisoformat(recorded["ZZA"]) <= after


def test_re_adding_within_the_grace_period_clears_the_record_and_keeps_the_caches():
    client = TestClient(app)
    client.post("/api/v1/portfolio/watchlist", json=ITEM)
    seed_caches("ZZA")
    client.delete("/api/v1/portfolio/watchlist/ZZA")
    assert "ZZA" in pending()

    assert client.post("/api/v1/portfolio/watchlist", json=ITEM).status_code == 200
    assert "ZZA" not in pending(), "re-adding through POST /watchlist did not clear the pending record"

    watchlist_cleanup.run_cleanup(datetime.now(timezone.utc) + GRACE + DAY)
    assert cache_counts("ZZA") == FULL, "a re-added ticker lost its caches"


# --- P6 (the import) ----------------------------------------------------------------------------

def test_the_import_records_dropped_tickers_and_clears_imported_ones(tmp_path, monkeypatch):
    monkeypatch.setattr(portfolio_route, "_WATCHLIST_JSON", _seed_file(tmp_path, "ZZB"))
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name) VALUES ('ZZA', 'A')")
        watchlist_cleanup.record_pending(conn, "ZZB", now=T0)

    response = TestClient(app).post("/api/v1/portfolio/watchlist/resync")

    assert response.status_code == 200, response.text
    recorded = pending()
    assert "ZZA" in recorded, "the import dropped ZZA but recorded no pending cleanup"
    assert "ZZB" not in recorded, "the import re-added ZZB but kept its pending record"


# --- P4, P5 (seed paths) ------------------------------------------------------------------------

def test_the_seed_merge_clears_a_ticker_it_brings_back(tmp_path):
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name) VALUES ('ZZA', 'A')")
        watchlist_cleanup.record_pending(conn, "ZZB", now=T0)
    assert watchlist_seed.merge_missing_watchlist_items(_seed_file(tmp_path, "ZZB")) == ["ZZB"]
    assert "ZZB" not in pending(), "the seed merge re-added ZZB but kept its pending record"


def test_the_first_bootstrap_clears_a_pending_seed_ticker(tmp_path):
    with get_db() as conn:
        watchlist_cleanup.record_pending(conn, "ZZB", now=T0)
    watchlist_seed.bootstrap_from_seed(_seed_file(tmp_path, "ZZB"))
    with get_db() as conn:
        assert conn.execute("SELECT 1 FROM watchlist WHERE ticker = 'ZZB'").fetchone() is not None
    assert "ZZB" not in pending(), "the bootstrap added ZZB but kept its pending record"


# --- P7 (peer sync) -----------------------------------------------------------------------------

def _pending_on(pc) -> dict[str, str]:
    pc.use()
    return pending()


def test_a_peer_removal_records_the_pending_time_on_this_pc(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("ZZA")
    b.sync()
    assert "ZZA" in b.rows()

    a.delete("ZZA")
    b.sync()

    assert "ZZA" not in b.rows()
    assert "ZZA" in _pending_on(b), "a peer tombstone removed ZZA here but recorded no pending cleanup"


def test_a_peer_re_add_clears_the_pending_record_on_this_pc(tmp_path, monkeypatch, cloud):
    a, b = PC(tmp_path, "PC-A", monkeypatch), PC(tmp_path, "PC-B", monkeypatch)
    a.add("ZZA")
    b.sync()
    a.delete("ZZA")
    b.sync()
    assert "ZZA" in _pending_on(b)

    a.add("ZZA")
    b.sync()

    assert "ZZA" in b.rows()
    assert "ZZA" not in _pending_on(b), "a peer re-add arrived here but the pending record was kept"
