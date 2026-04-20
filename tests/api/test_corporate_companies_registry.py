import json
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.services import db as db_service


def _workspace_temp_path(name: str) -> Path:
    temp_root = Path(r"E:\MoneyView\data\processed")
    temp_root.mkdir(parents=True, exist_ok=True)
    return temp_root / f"{name}-{next(tempfile._get_candidate_names())}"


def _write_watchlist_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def test_corporate_companies_includes_all_stock_targets_json_entries(monkeypatch):
    db_path = _workspace_temp_path("companies-registry.db")
    json_path = _workspace_temp_path("stock-targets.json")
    _write_watchlist_json(
        json_path,
        {
            "custom": {
                "targets": [
                    {"ticker": "AAPL", "name": "Apple", "sector": "Technology"},
                ]
            },
            "total": {
                "targets": [
                    {"ticker": "IONQ", "name": "IonQ", "sector": "Quantum"},
                    {"ticker": "RGTI", "name": "Rigetti", "sector": "Quantum"},
                ]
            },
        },
    )

    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()

    from apps.api.routes import corporate as corporate_route

    monkeypatch.setattr(corporate_route, "_WATCHLIST_JSON", json_path)

    client = TestClient(app)
    response = client.get("/api/v1/corporate/companies")

    assert response.status_code == 200
    companies = response.json()
    tickers = {company["ticker"] for company in companies}

    assert "AAPL" in tickers
    assert "IONQ" in tickers
    assert "RGTI" in tickers

    ionq = next(company for company in companies if company["ticker"] == "IONQ")
    assert ionq["name"] == "IonQ"
    assert ionq["sector"] == "Quantum"
    assert ionq["source"] in {"portfolio", "watchlist"}
