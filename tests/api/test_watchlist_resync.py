import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.services import db as db_service


def _write_watchlist_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def test_watchlist_resync_replaces_existing_rows_from_json(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    json_path = tmp_path / "stock_targets.json"
    _write_watchlist_json(
        json_path,
        {
            "growth": {
                "targets": [
                    {"ticker": "NVDA", "name": "NVIDIA", "sector": "Semiconductors", "weight": 0.6},
                    {"ticker": "MSFT", "name": "Microsoft", "sector": "Technology", "weight": 0.4},
                ]
            }
        },
    )

    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    from apps.api.routes import portfolio as portfolio_route

    monkeypatch.setattr(portfolio_route, "_WATCHLIST_JSON", json_path)
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("AAPL", "Apple", "Technology", "manual", 1.0),
        )

    client = TestClient(app)
    response = client.post("/api/v1/portfolio/watchlist/resync")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["item_count"] == 2
    assert payload["tickers"] == ["NVDA", "MSFT"]
    assert payload["source"] == "manual_json_resync"
    assert payload["json_path"] == str(json_path)

    with db_service.get_db() as conn:
        rows = conn.execute(
            "SELECT ticker, name, sector, group_name, weight FROM watchlist ORDER BY ticker"
        ).fetchall()
        state = conn.execute(
            "SELECT source FROM dataset_metadata WHERE dataset_name = ?",
            ("watchlist_state",),
        ).fetchone()

    assert [tuple(row) for row in rows] == [
        ("MSFT", "Microsoft", "Technology", "growth", 0.4),
        ("NVDA", "NVIDIA", "Semiconductors", "growth", 0.6),
    ]
    assert state is not None
    assert state["source"] == "manual_json_resync"


def test_watchlist_resync_updates_corporate_companies_source_from_portfolio(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    json_path = tmp_path / "stock_targets.json"
    _write_watchlist_json(
        json_path,
        {
            "energy": {
                "targets": [
                    {"ticker": "XOM", "name": "Exxon Mobil", "sector": "Energy", "weight": 1.0},
                ]
            }
        },
    )

    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    from apps.api.routes import corporate as corporate_route
    from apps.api.routes import portfolio as portfolio_route

    monkeypatch.setattr(portfolio_route, "_WATCHLIST_JSON", json_path)
    monkeypatch.setattr(corporate_route, "_WATCHLIST_JSON", json_path)

    client = TestClient(app)
    resync = client.post("/api/v1/portfolio/watchlist/resync")
    companies = client.get("/api/v1/corporate/companies")

    assert resync.status_code == 200
    assert companies.status_code == 200

    xom = next(company for company in companies.json() if company["ticker"] == "XOM")
    assert xom["name"] == "Exxon Mobil"
    assert xom["sector"] == "Energy"
    assert xom["source"] == "portfolio"


def test_watchlist_resync_rejects_empty_json(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    json_path = tmp_path / "stock_targets.json"
    json_path.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    from apps.api.routes import portfolio as portfolio_route

    monkeypatch.setattr(portfolio_route, "_WATCHLIST_JSON", json_path)

    client = TestClient(app)
    response = client.post("/api/v1/portfolio/watchlist/resync")

    assert response.status_code == 409
    assert "no valid watchlist items found" in response.json()["detail"]


def test_watchlist_sync_exports_db_weights_to_json(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    json_path = tmp_path / "stock_targets.json"

    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    from apps.api.routes import portfolio as portfolio_route

    monkeypatch.setattr(portfolio_route, "_WATCHLIST_JSON", json_path)
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("AAPL", "Apple", "Technology", "core", 0.35),
        )
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("MSFT", "Microsoft", "Technology", "core", 0.25),
        )

    client = TestClient(app)
    response = client.post("/api/v1/portfolio/watchlist/sync")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["item_count"] == 2
    assert payload["source"] == "watchlist_db_sync"
    assert payload["preserved_weights"] is True
    assert payload["json_path"] == str(json_path)

    exported = json.loads(json_path.read_text(encoding="utf-8"))
    assert exported["core"]["targets"] == [
        {"ticker": "AAPL", "name": "Apple", "sector": "Technology", "weight": 0.35},
        {"ticker": "MSFT", "name": "Microsoft", "sector": "Technology", "weight": 0.25},
    ]


def test_watchlist_sync_status_tracks_last_explicit_action(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    json_path = tmp_path / "stock_targets.json"
    _write_watchlist_json(
        json_path,
        {
            "growth": {
                "targets": [
                    {"ticker": "NVDA", "name": "NVIDIA", "sector": "Semiconductors", "weight": 1.0},
                ]
            }
        },
    )

    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    from apps.api.routes import portfolio as portfolio_route

    monkeypatch.setattr(portfolio_route, "_WATCHLIST_JSON", json_path)
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("AAPL", "Apple", "Technology", "core", 0.35),
        )

    client = TestClient(app)

    sync_response = client.post("/api/v1/portfolio/watchlist/sync")
    assert sync_response.status_code == 200

    status_after_sync = client.get("/api/v1/portfolio/watchlist/sync-status")
    assert status_after_sync.status_code == 200
    sync_payload = status_after_sync.json()["data"]
    assert sync_payload["source"] == "watchlist_db_sync"
    assert sync_payload["json_path"] == str(json_path)
    assert sync_payload["last_updated_at"]

    import_response = client.post("/api/v1/portfolio/watchlist/resync")
    assert import_response.status_code == 200

    status_after_import = client.get("/api/v1/portfolio/watchlist/sync-status")
    assert status_after_import.status_code == 200
    import_payload = status_after_import.json()["data"]
    assert import_payload["source"] == "manual_json_resync"
    assert import_payload["json_path"] == str(json_path)
    assert import_payload["last_updated_at"]
