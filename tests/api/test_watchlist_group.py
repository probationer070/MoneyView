"""Moving a ticker between groups must not touch anything else.

`POST /watchlist` is an upsert over all five columns, and `WatchlistItem.weight`
defaults to `0.0`. So a "track this" toggle built on that endpoint would silently zero
an allocation whenever the caller omitted the weight -- and `name`/`sector` would
collapse to the ticker and `""` the same way. Group membership gets its own endpoint
that writes one column.

This matters because group membership is about to become how the tile grid decides what
"Held" means, so the toggle will be clicked casually and often.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.db import get_db

client = TestClient(app)


@pytest.fixture
def _seeded():
    with get_db() as conn:
        conn.execute("DELETE FROM watchlist")
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("AAPL", "Apple", "Technology", "total", 0.25),
        )
    yield


def _row(ticker: str = "AAPL"):
    with get_db() as conn:
        return conn.execute(
            "SELECT ticker, name, sector, group_name, weight FROM watchlist WHERE ticker = ?",
            (ticker,),
        ).fetchone()


def test_changing_the_group_preserves_the_weight(_seeded):
    """The whole reason this endpoint exists."""
    response = client.post("/api/v1/portfolio/watchlist/AAPL/group", json={"group_name": "custom"})

    assert response.status_code == 200
    row = _row()
    assert row["group_name"] == "custom"
    assert row["weight"] == pytest.approx(0.25)


def test_changing_the_group_preserves_name_and_sector(_seeded):
    client.post("/api/v1/portfolio/watchlist/AAPL/group", json={"group_name": "custom"})

    row = _row()
    assert row["name"] == "Apple"
    assert row["sector"] == "Technology"


def test_the_ticker_is_normalised_like_every_other_watchlist_write(_seeded):
    response = client.post("/api/v1/portfolio/watchlist/aapl/group", json={"group_name": "custom"})

    assert response.status_code == 200
    assert _row()["group_name"] == "custom"


def test_an_unknown_ticker_is_refused_rather_than_silently_inserted(_seeded):
    response = client.post("/api/v1/portfolio/watchlist/NOSUCH/group", json={"group_name": "custom"})

    assert response.status_code == 404
    with get_db() as conn:
        assert conn.execute(
            "SELECT COUNT(*) FROM watchlist WHERE ticker = 'NOSUCH'"
        ).fetchone()[0] == 0


def test_an_empty_group_is_refused(_seeded):
    """Falling back to a default here would move the row somewhere the caller did not ask for."""
    response = client.post("/api/v1/portfolio/watchlist/AAPL/group", json={"group_name": "   "})

    assert response.status_code == 422
    assert _row()["group_name"] == "total"


def test_the_upsert_endpoint_still_clobbers_and_this_one_does_not(_seeded):
    """Pins the contrast, so nobody re-points the toggle at /watchlist later.

    Posting the ticker alone to the upsert endpoint resets weight to its 0.0 default.
    That is the documented behaviour of a full-row upsert, not a bug -- it is simply the
    wrong tool for a group toggle.
    """
    client.post("/api/v1/portfolio/watchlist", json={"ticker": "AAPL", "group_name": "custom"})
    assert _row()["weight"] == pytest.approx(0.0)

    with get_db() as conn:
        conn.execute("UPDATE watchlist SET weight = 0.25, group_name = 'total' WHERE ticker = 'AAPL'")

    client.post("/api/v1/portfolio/watchlist/AAPL/group", json={"group_name": "custom"})
    assert _row()["weight"] == pytest.approx(0.25)
