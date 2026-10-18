"""Watchlist theme list: the endpoint's 24 ids in display order, and the loader's validation.

Mutation checks (CLAUDE.md §8):
- test_themes_endpoint_lists_24_in_order: catches swapping two entries in
  apps/api/services/watchlist_themes.yaml (the order assertion fails).
- test_loader_rejects_duplicate_ids: catches removing the duplicate-id check in
  load_themes (no ValueError is raised).
- test_loader_rejects_non_slug_id: catches removing the slug regex check in
  load_themes (no ValueError is raised for "AI 반도체").
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.watchlist_themes import load_themes

client = TestClient(app)

EXPECTED_IDS = [
    "ai_semis",
    "optical_connectivity",
    "memory_storage",
    "chip_equipment_design",
    "analog_power_chips",
    "ai_servers_network",
    "ai_cloud_datacenter",
    "big_tech",
    "software_internet",
    "cybersecurity",
    "power_equipment",
    "nuclear_uranium",
    "power_producers",
    "regulated_utilities",
    "oil_gas",
    "gold_silver",
    "copper_metals",
    "battery_rare_earth",
    "quantum",
    "crypto",
    "defense_aerospace",
    "space_comms",
    "financials_payments",
    "defensives_other",
]


def test_themes_endpoint_lists_24_in_order():
    response = client.get("/api/v1/portfolio/watchlist/themes")

    assert response.status_code == 200
    body = response.json()
    assert [t["id"] for t in body] == EXPECTED_IDS
    assert body[0] == {"id": "ai_semis", "ko": "AI 반도체", "en": "AI semiconductors"}


def test_loader_rejects_duplicate_ids(tmp_path):
    path = tmp_path / "themes.yaml"
    path.write_text(
        "themes:\n"
        "  - {id: quantum, ko: 양자컴퓨팅, en: Quantum computing}\n"
        "  - {id: quantum, ko: 양자, en: Quantum again}\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="quantum"):
        load_themes(path)


def test_loader_rejects_non_slug_id(tmp_path):
    path = tmp_path / "themes.yaml"
    path.write_text(
        "themes:\n"
        "  - {id: 'AI 반도체', ko: AI 반도체, en: AI semiconductors}\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError):
        load_themes(path)
