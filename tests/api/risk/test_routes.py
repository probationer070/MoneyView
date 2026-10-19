"""GET /api/v1/risk/*. Each docstring names the mutation its test catches."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schemas import NewsArticle
from apps.api.services.db import get_db
from apps.api.services.news_service import NewsService
from apps.api.services.risk import store
from apps.api.services.risk.rules import get_rules
from packages.core_finance.risk_signals.alerts import ThemeStint
from packages.core_finance.risk_signals.decks import CandidateCard, CrashCard
from packages.core_finance.risk_signals.evaluate import DayResult

V = get_rules().version
START = date(2026, 10, 8)
DETAIL_KEYS = {
    "id", "origin", "rules_version", "status", "start_date", "release_date", "w1_proxy", "trigger_themes",
    "themes", "warnings_at_start", "crash", "candidates", "start_snapshot", "outcome", "news",
    "macro_figures", "news_shortfall", "news_note"}
SUMMARY_KEYS = {
    "id", "origin", "rules_version", "status", "start_date", "release_date", "days", "trigger_themes",
    "theme_count", "warnings_at_start", "primary_theme", "fwd5", "fwd10", "fwd20", "useful", "w1_proxy"}


def _day(d=START, warnings=None):
    warnings = warnings or {"W1": ("on", 3.24, date(2026, 10, 7)), "W2": ("off", 4.0, date(2026, 10, 7))}
    return DayResult(d, warnings, False, sum(1 for s, _, _ in warnings.values() if s == "on"),
                     {"ai_semis": "theme"}, False, 0.25, True)


def _seed_watchlist():
    with get_db() as conn:
        for ticker, name, theme in [("MU", "Micron", "memory_storage"), ("AMAT", "Applied Materials", "chip_equipment_design"),
                                    ("NVDA", "NVIDIA", "ai_semis")]:
            conn.execute("INSERT OR REPLACE INTO watchlist (ticker, name, theme) VALUES (?, ?, ?)", (ticker, name, theme))


def _alert(origin="live", start=START, release=None, max_dd10=None, trigger=("ai_semis",), version=V):
    aid = store.insert_alert(start, trigger, version, origin, trigger[0], False)
    for theme in trigger:
        store.upsert_stint(aid, ThemeStint(theme, "theme", start, None, start), -6.1,
                           {"fwd5": 0.2, "fwd10": None, "fwd20": None, "max_dd10": max_dd10})
    if release:
        store.close_alert(aid, release, "all_themes_out")
    return aid


def _get(path):
    with TestClient(app) as client:
        return client.get(f"/api/v1/risk{path}")


def _data(path):
    response = _get(path)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_latest_never_evaluated():
    """Catches /latest raising or inventing a day when risk_daily is empty (spec 6.1 table row 1)."""
    data = _data("/latest")
    assert data["as_of"] is None and data["warnings"] == [] and data["alert"] is None
    assert data["last_alert"] is None and data["warnings_on"] == 0 and data["warnings_total"] == 6
    assert data["rules_version"] == V and data["backfill"] == "pending"


def test_latest_open_alert_shape():
    """Catches a renamed/missing field, cards not capped at 10, or a wrong total."""
    _seed_watchlist()
    store.set_state(f"backfill:{V}", "done")
    store.save_day(_day(), V, "live", 0.98, "2026-10-09T01:12:40+00:00")
    aid = _alert()
    store.replace_cards(aid, "latest", "crash", [
        CrashCard("MU" if i == 0 else f"T{i}", -18.6 - i, date(2026, 9, 25), 210.4, 171.2, [201.1, 203.5])
        for i in range(12)], START)
    store.replace_cards(aid, "latest", "candidate", [CandidateCard("AMAT", -0.7, 0.85, "MU")], START)
    store.replace_cards(aid, "start", "candidate", [CandidateCard("AMAT", -0.7, 0.85, "MU")], START)
    store.update_card_outcomes(aid, "start", "candidate", "AMAT", {"fwd5": -8.1})
    for i, lang in enumerate(["en", "ko", "en"]):
        NewsService().save_article(NewsArticle(ticker="MU", headline=f"MU news {i}", url=f"https://x/{i}",
                                               published_date=f"2026-10-0{i + 5}", lang=lang))

    data = _data("/latest")

    assert data["as_of"] == "2026-10-08" and data["backfill"] == "done"
    assert data["data"] == {"bars_coverage": 0.98, "fred_errors": []}
    assert [w["id"] for w in data["warnings"]] == ["W1", "W2"]
    assert set(data["warnings"][0]) == {"id", "label", "state", "value", "unit", "rule", "observed_at"}
    assert data["warnings"][0]["label"] == {"ko": "하이일드 스프레드", "en": "High-yield spread"}
    assert data["warnings_on"] == 1 and data["last_alert"] is None
    alert = data["alert"]
    assert set(alert) == DETAIL_KEYS
    assert alert["crash"]["total"] == 12 and len(alert["crash"]["cards"]) == 10
    mu = alert["crash"]["cards"][0]
    assert mu["name"] == "Micron" and mu["theme"] == "memory_storage" and mu["closes_30d"] == [201.1, 203.5]
    assert (mu["high_close"], mu["close"], mu["drawdown_pct"]) == (210.4, 171.2, -18.6)
    assert [h["title"] for h in mu["headlines"]] == ["MU news 2", "MU news 1"]  # newest 2, any lang
    cand = alert["candidates"]["cards"][0]
    assert cand["corr_with_name"] == "Micron" and cand["name"] == "Applied Materials"
    assert alert["start_snapshot"]["candidates"] == [{"ticker": "AMAT", "fwd5": -8.1, "fwd10": None, "fwd20": None}]
    assert alert["themes"][0]["label"] == {"ko": "AI 반도체", "en": "AI semiconductors"}
    assert alert["warnings_at_start"][0] == {"id": "W1", "state": "on", "value": 3.24}
    assert alert["outcome"]["primary_theme"] == "ai_semis" and alert["outcome"]["fwd5"] == 0.2


def test_latest_no_alert_has_last_alert():
    """Catches last_alert missing when nothing is open, or the open-alert fallback pointing at an open one."""
    store.set_state(f"backfill:{V}", "done")
    store.save_day(_day(), V, "live", 1.0, "t")
    old = _alert(start=date(2026, 9, 1), release=date(2026, 9, 10))
    newer = _alert(start=date(2026, 9, 20), release=date(2026, 9, 25))
    data = _data("/latest")
    assert data["alert"] is None
    assert data["last_alert"]["id"] == newer != old
    assert set(data["last_alert"]) == SUMMARY_KEYS and data["last_alert"]["status"] == "released"


@pytest.mark.parametrize("state", ["running", "failed"])
def test_latest_backfill_running(state):
    """Catches partial backfill alerts/days leaking while the backfill is unfinished (and a missing state echo)."""
    store.set_state(f"backfill:{V}", state)
    store.save_day(_day(date(2020, 3, 2)), V, "backfill", 1.0, "t")
    _alert(origin="backfill", start=date(2020, 3, 2))  # open, partial
    _alert(origin="backfill", start=date(2019, 1, 2), release=date(2019, 1, 9))
    data = _data("/latest")
    assert data["backfill"] == state
    assert data["as_of"] is None and data["alert"] is None and data["last_alert"] is None
    assert _data("/history") == []


def test_latest_unknown_warning_value_null():
    """Catches an unknown warning leaking its stored number instead of null."""
    store.set_state(f"backfill:{V}", "done")
    store.save_day(_day(warnings={"W1": ("unknown", 3.0, None), "W4": ("off", 40.0, date(2026, 5, 1))}),
                   V, "live", 1.0, "t")
    warnings = {w["id"]: w for w in _data("/latest")["warnings"]}
    assert warnings["W1"]["state"] == "unknown" and warnings["W1"]["value"] is None
    assert warnings["W4"]["value"] == 40.0 and warnings["W4"]["unit"] == "days"


def test_history_filters_and_limit_bounds():
    """Catches ignored origin/limit/rules_version filters, unbounded limit, and old versions leaking."""
    store.set_state(f"backfill:{V}", "done")
    live = _alert(origin="live", start=date(2026, 10, 1))
    back = _alert(origin="backfill", start=date(2020, 3, 2), release=date(2020, 3, 9))
    _alert(origin="live", start=date(2026, 9, 1), version="oldvers1")
    assert [a["id"] for a in _data("/history")] == [live, back]
    assert [a["id"] for a in _data("/history?origin=backfill")] == [back]
    assert [a["id"] for a in _data("/history?origin=live")] == [live]
    assert [a["id"] for a in _data("/history?limit=1")] == [live]
    assert len(_data("/history?rules_version=oldvers1")) == 1
    assert _get("/history?limit=0").status_code == 422
    assert _get("/history?limit=501").status_code == 422
    assert _get("/history?limit=500").status_code == 200
    assert set(_data("/history")[0]) == SUMMARY_KEYS


def test_history_days_and_warnings_at_start():
    """Catches days counted from the wrong range and warnings_at_start listing off warnings."""
    store.set_state(f"backfill:{V}", "done")
    for d in (date(2026, 10, 7), date(2026, 10, 8), date(2026, 10, 9), date(2026, 10, 12)):
        store.save_day(_day(d), V, "live", 1.0, "t")
    _alert(start=date(2026, 10, 8), release=date(2026, 10, 9))
    summary = _data("/history")[0]
    assert summary["days"] == 2 and summary["warnings_at_start"] == ["W1"]


@pytest.mark.parametrize("dd, expected", [
    ({"ai_semis": -6.0, "memory_storage": None}, True),
    ({"ai_semis": -5.0, "memory_storage": -1.0}, True),
    ({"ai_semis": -1.0, "memory_storage": -4.9}, False),
    ({"ai_semis": -1.0, "memory_storage": None}, None),
])
def test_useful_derivation(dd, expected):
    """Catches a wrong threshold side (-5 exactly counts), None treated as false, or ignoring a trigger theme."""
    store.set_state(f"backfill:{V}", "done")
    aid = store.insert_alert(START, list(dd), V, "live", "ai_semis", False)
    for theme, value in dd.items():
        store.upsert_stint(aid, ThemeStint(theme, "theme", START, None, START), -6.0,
                           {"fwd5": None, "fwd10": None, "fwd20": None, "max_dd10": value})
    assert _data("/history")[0]["useful"] is expected
    assert _data(f"/alerts/{aid}")["outcome"]["useful"] is expected


def test_headlines_window_and_cap():
    """Catches headlines outside the alert's news window or more than two."""
    _seed_watchlist()
    aid = _alert(release=date(2026, 10, 10))
    store.replace_cards(aid, "latest", "crash", [CrashCard("MU", -18.6, date(2026, 9, 25), 210.4, 171.2, [1.0])], START)
    for i, day in enumerate(["2026-09-30", "2026-10-02", "2026-10-09", "2026-10-11"]):
        NewsService().save_article(NewsArticle(ticker="MU", headline=f"h{i}", url=f"https://x/{i}", published_date=day))
    cards = _data(f"/alerts/{aid}")["crash"]["cards"]
    assert [h["title"] for h in cards[0]["headlines"]] == ["h2", "h1"]  # h3 after release, h0 before the window


def test_alert_404():
    """Catches an unknown id returning 200/null or a different detail string."""
    response = _get("/alerts/999")
    assert response.status_code == 404 and response.json()["detail"] == "unknown_alert:999"
