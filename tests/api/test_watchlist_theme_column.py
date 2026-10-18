"""Watchlist `theme` column: its own endpoint, and every other watchlist write leaves it alone.

Mutation checks (CLAUDE.md §8) are recorded per test in the task report. Each docstring names
the mutation its test is meant to catch.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.db import get_db

client = TestClient(app)

SEED_STAMP = "2026-01-01T00:00:00.000Z"


@pytest.fixture
def _seeded(monkeypatch):
    # Keeps the list route off the network; the seeded row is the only priced ticker it needs.
    from apps.api.routes import portfolio as portfolio_routes

    monkeypatch.setattr(portfolio_routes._mkt, "get_stock_ohlcv", lambda *args, **kwargs: [])
    with get_db() as conn:
        conn.execute("DELETE FROM watchlist")
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight, theme, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            ("AAPL", "Apple", "Technology", "total", 0.25, "ai_semis", SEED_STAMP),
        )
    yield


def _row(ticker: str = "AAPL"):
    with get_db() as conn:
        return conn.execute(
            "SELECT id, ticker, name, sector, group_name, weight, theme, updated_at FROM watchlist WHERE ticker = ?",
            (ticker,),
        ).fetchone()


def test_setting_a_theme_writes_only_the_theme(_seeded):
    """Catches a theme route that writes through the full-row upsert: name, sector, group or
    weight would be rewritten along with the theme."""
    before = _row()

    response = client.post("/api/v1/portfolio/watchlist/AAPL/theme", json={"theme": "memory_storage"})

    assert response.status_code == 200
    after = _row()
    assert after["theme"] == "memory_storage"
    assert (after["name"], after["sector"], after["group_name"]) == (
        before["name"], before["sector"], before["group_name"],
    )
    assert after["weight"] == pytest.approx(0.25)


def test_an_unknown_theme_is_rejected(_seeded):
    """Catches removing the theme_ids() check: the Korean label would be stored as the key."""
    response = client.post("/api/v1/portfolio/watchlist/AAPL/theme", json={"theme": "AI 반도체"})

    assert response.status_code == 422
    assert response.json()["detail"].startswith("unknown_theme:")
    assert _row()["theme"] == "ai_semis"


def test_an_unknown_ticker_is_refused(_seeded):
    """Catches a theme route that inserts a row for a ticker not on the watchlist."""
    response = client.post("/api/v1/portfolio/watchlist/NOSUCH/theme", json={"theme": "quantum"})

    assert response.status_code == 404
    assert response.json()["detail"].startswith("unknown_ticker:")
    with get_db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM watchlist WHERE ticker = 'NOSUCH'").fetchone()[0] == 0


def test_empty_theme_clears_it(_seeded):
    """Catches a validator that rejects the empty string, which is how a user clears a theme."""
    response = client.post("/api/v1/portfolio/watchlist/AAPL/theme", json={"theme": ""})

    assert response.status_code == 200
    assert response.json()["theme"] == ""
    assert _row()["theme"] == ""


def test_full_row_upsert_keeps_the_theme(_seeded):
    """Catches the upsert writing theme (or clearing it) when the body omits it: the sector
    save and the allocation auto-save both go through this path. Review Focus 1."""
    response = client.post(
        "/api/v1/portfolio/watchlist",
        json={"ticker": "AAPL", "name": "Apple", "sector": "Chips", "group_name": "total", "weight": 0.25},
    )

    assert response.status_code == 200
    row = _row()
    assert row["theme"] == "ai_semis"
    assert row["sector"] == "Chips"
    assert response.json()["theme"] == "ai_semis"


def test_upsert_ignores_an_incoming_theme(_seeded):
    """Catches the upsert writing the incoming `theme` field: WatchlistItem.theme is
    response-only, so a posted value must not change the stored theme."""
    client.post(
        "/api/v1/portfolio/watchlist",
        json={"ticker": "AAPL", "name": "Apple", "sector": "Technology", "group_name": "total",
              "weight": 0.25, "theme": "quantum"},
    )

    assert _row()["theme"] == "ai_semis"


def test_upsert_keeps_the_row_id(_seeded):
    """Catches a reverted `INSERT OR REPLACE`: REPLACE deletes and re-inserts the row, which
    resets theme to '' and changes the autoincrement id."""
    id_before = _row()["id"]

    client.post(
        "/api/v1/portfolio/watchlist",
        json={"ticker": "AAPL", "name": "Apple", "sector": "Chips", "group_name": "total", "weight": 0.25},
    )

    assert _row()["id"] == id_before


def test_group_toggle_keeps_the_theme(_seeded):
    """Catches the group route writing theme='' (or dropping it from its response). Review Focus 4."""
    response = client.post("/api/v1/portfolio/watchlist/AAPL/group", json={"group_name": "custom"})

    assert response.status_code == 200
    assert response.json()["theme"] == "ai_semis"
    assert _row()["theme"] == "ai_semis"


def test_list_returns_theme(_seeded):
    """Catches the list route dropping the theme mapping: PortfolioStock would default to ''."""
    rows = client.get("/api/v1/portfolio/watchlist").json()

    aapl = next(row for row in rows if row["ticker"] == "AAPL")
    assert aapl["theme"] == "ai_semis"


def test_theme_change_restamps_the_row(_seeded):
    """Catches a theme write that skips stamp_row (peer sync would never see the change), and a
    no-op write that restamps an unchanged row."""
    client.post("/api/v1/portfolio/watchlist/AAPL/theme", json={"theme": "memory_storage"})
    stamp_after_change = _row()["updated_at"]
    assert stamp_after_change != SEED_STAMP

    client.post("/api/v1/portfolio/watchlist/AAPL/theme", json={"theme": "memory_storage"})

    assert _row()["updated_at"] == stamp_after_change
