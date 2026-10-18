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

# Exact id/ko/en rows from global-constraints.md, in display order.
EXPECTED_THEMES = [
    {"id": "ai_semis", "ko": "AI 반도체", "en": "AI semiconductors"},
    {"id": "optical_connectivity", "ko": "광통신·연결 칩", "en": "Optical & connectivity chips"},
    {"id": "memory_storage", "ko": "메모리·스토리지", "en": "Memory & storage"},
    {"id": "chip_equipment_design", "ko": "반도체 장비·설계", "en": "Chip equipment & design"},
    {"id": "analog_power_chips", "ko": "아날로그·전력 반도체", "en": "Analog & power chips"},
    {"id": "ai_servers_network", "ko": "AI 서버·네트워크", "en": "AI servers & networking"},
    {"id": "ai_cloud_datacenter", "ko": "AI 클라우드·데이터센터", "en": "AI cloud & data centers"},
    {"id": "big_tech", "ko": "빅테크", "en": "Big tech"},
    {"id": "software_internet", "ko": "소프트웨어·인터넷", "en": "Software & internet"},
    {"id": "cybersecurity", "ko": "사이버보안", "en": "Cybersecurity"},
    {"id": "power_equipment", "ko": "전력 장비·저장", "en": "Power equipment & storage"},
    {"id": "nuclear_uranium", "ko": "원전·우라늄", "en": "Nuclear & uranium"},
    {"id": "power_producers", "ko": "발전사", "en": "Power producers"},
    {"id": "regulated_utilities", "ko": "규제 유틸리티", "en": "Regulated utilities"},
    {"id": "oil_gas", "ko": "석유·가스", "en": "Oil & gas"},
    {"id": "gold_silver", "ko": "금·은", "en": "Gold & silver"},
    {"id": "copper_metals", "ko": "구리·산업금속", "en": "Copper & industrial metals"},
    {"id": "battery_rare_earth", "ko": "배터리·희토류 소재", "en": "Battery & rare-earth materials"},
    {"id": "quantum", "ko": "양자컴퓨팅", "en": "Quantum computing"},
    {"id": "crypto", "ko": "크립토", "en": "Crypto"},
    {"id": "defense_aerospace", "ko": "방산·항공", "en": "Defense & aerospace"},
    {"id": "space_comms", "ko": "우주·통신", "en": "Space & communications"},
    {"id": "financials_payments", "ko": "금융·결제", "en": "Financials & payments"},
    {"id": "defensives_other", "ko": "경기방어·기타", "en": "Defensives & other"},
]


def test_themes_endpoint_lists_24_in_order():
    response = client.get("/api/v1/portfolio/watchlist/themes")

    assert response.status_code == 200
    assert response.json() == EXPECTED_THEMES


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
