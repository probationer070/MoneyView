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
from packages.core_finance.risk_signals.movers import Mover

V = get_rules().version
START = date(2026, 10, 8)
DETAIL_KEYS = {
    "id", "origin", "rules_version", "status", "start_date", "release_date", "w1_proxy", "trigger_themes",
    "themes", "warnings_at_start", "crash", "candidates", "start_snapshot", "outcome", "news",
    "macro_figures", "news_shortfall", "news_note"}
SUMMARY_KEYS = {
    "id", "origin", "rules_version", "status", "start_date", "release_date", "days", "trigger_themes",
    "theme_count", "warnings_at_start", "primary_theme", "fwd5", "fwd10", "fwd20", "useful", "w1_proxy",
    "max_dd10", "trigger_labels"}


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


def test_latest_fred_errors_read_from_state():
    """Catches /latest hard-coding fred_errors to [] instead of reading the cycle's stored value."""
    store.set_state(f"backfill:{V}", "done")
    store.save_day(_day(), V, "live", 0.98, "2026-10-09T01:12:40+00:00")
    store.set_state("fred_errors", '["BAA10Y: timeout"]')
    assert _data("/latest")["data"]["fred_errors"] == ["BAA10Y: timeout"]


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


def test_latest_backfill_degraded_is_visible():
    """Catches /latest not echoing "degraded" (the response model rejecting it is a 500), or a degraded
    version's backfill day, open alert and released alerts hidden as if the backfill were unfinished."""
    store.set_state(f"backfill:{V}", "degraded")
    store.save_day(_day(date(2020, 3, 2)), V, "backfill", 1.0, "t")
    released = _alert(origin="backfill", start=date(2019, 1, 2), release=date(2019, 1, 9))
    data = _data("/latest")
    assert data["backfill"] == "degraded"
    assert data["as_of"] == "2020-03-02" and data["alert"] is None
    assert data["last_alert"]["id"] == released
    assert [a["id"] for a in _data("/history")] == [released]
    opened = _alert(origin="backfill", start=date(2020, 3, 2))
    assert _data("/latest")["alert"]["id"] == opened


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


# ---- surge and movers ----
COMP = {"magnitude_z": 2.4, "accel_pct": 0.31, "accel_rank": 0.97, "breadth_pct": 72.0, "rsi": 66.1,
        "magnitude_on": True, "on": True}
SURGE_KEYS = {"id", "origin", "rules_version", "theme", "label", "start_date", "end_date", "end_reason", "shown",
              "components", "overheated_on", "fwd5", "fwd10", "fwd20", "max_runup10", "leaders"}


def _surge_day(d=START, surge=None, banner=True, share=0.23, origin="live"):
    surge = {"ai_semis": dict(COMP)} if surge is None else surge
    store.save_day(DayResult(d, {}, False, 0, {}, False, 0.0, False, surge=surge, surge_banner=banner,
                             surge_cap_share=share), V, origin, 1.0, "t")


def _event(theme="ai_semis", start=START, shown=True, origin="live", version=V, **kw):
    return store.insert_surge_event(version, origin, theme, start, shown=shown, components=COMP,
                                    leaders=[{"ticker": "MU", "return5_pct": 12.5}], last_high=start, **kw)


def _movers(d=START, version=V, n=2):
    store.save_movers(version, d, [Mover(i + 1, t, 6.4 - i, 171.2, 9.8, 71.0)
                                   for i, t in enumerate(["MU", "AMAT", "NVDA"][:n])],
                      {"MU": "memory_storage", "AMAT": "chip_equipment_design", "NVDA": "ai_semis"})


def test_latest_surge_and_movers_shape():
    """Catches a renamed/missing surge or movers field, names or labels not joined, event fields taken
    from the wrong source, and a banner/cap_share swap."""
    _seed_watchlist()
    store.set_state(f"backfill:{V}", "done")
    _surge_day()
    _event(start=date(2026, 10, 6))
    _movers()
    data = _data("/latest")
    assert data["surge"]["banner"] is True and data["surge"]["cap_share"] == 0.23
    theme = data["surge"]["themes"][0]
    assert set(theme) == {"theme", "label", "event_id", "start_date", "shown", "components", "overheated",
                          "leaders"}
    assert theme["label"] == {"ko": "AI 반도체", "en": "AI semiconductors"}
    assert theme["start_date"] == "2026-10-06" and theme["shown"] is True and theme["overheated"] is False
    assert theme["components"] == {"magnitude_z": 2.4, "accel_pct": 0.31, "accel_rank": 0.97,
                                   "breadth_pct": 72.0, "rsi": 66.1}
    assert data["movers"]["as_of"] == "2026-10-08"
    assert data["movers"]["items"][0] == {"rank": 1, "ticker": "MU", "name": "Micron", "theme": "memory_storage",
                                          "return_pct": 6.4, "close": 171.2, "return5_pct": 9.8, "rsi": 71.0}
    assert [m["ticker"] for m in data["movers"]["items"]] == ["MU", "AMAT"]


def test_latest_surge_themes_when_banner_off():
    """Catches themes emptied when the banner is off, closed events listed, components read from the
    event instead of the latest day, and overheated judged at the wrong threshold (80 exactly is not hot)."""
    store.set_state(f"backfill:{V}", "done")
    _surge_day(surge={"ai_semis": {**COMP, "rsi": 80.5}, "memory_storage": {**COMP, "rsi": 80.0}},
               banner=False, share=0.05)
    _event(shown=False)
    _event("memory_storage", shown=False)
    _event("^SOX", end=date(2026, 10, 7), end_reason="below_ema")
    surge = _data("/latest")["surge"]
    assert surge["banner"] is False
    by = {t["theme"]: t for t in surge["themes"]}
    assert set(by) == {"ai_semis", "memory_storage"}
    assert by["ai_semis"]["overheated"] is True and by["memory_storage"]["overheated"] is False
    assert by["ai_semis"]["components"]["rsi"] == 80.5 and by["ai_semis"]["shown"] is False


def test_both_banners_same_day():
    """Catches the surge block being dropped, or the crash alert/surge banner overwriting each other,
    when both are on the same day."""
    _seed_watchlist()
    store.set_state(f"backfill:{V}", "done")
    _surge_day()
    _event()
    _alert()
    data = _data("/latest")
    assert data["alert"]["id"] and data["alert"]["status"] == "open"
    assert data["surge"]["banner"] is True and len(data["surge"]["themes"]) == 1


def test_surge_history_filters():
    """Catches ignored shown/theme/limit filters, wrong order, other versions or hidden backfill leaking,
    a rules_changed end reason rejected by the model, and an unbounded limit."""
    _seed_watchlist()
    store.set_state(f"backfill:{V}", "running")
    a = _event(start=date(2026, 10, 1), shown=True, end=date(2026, 10, 5), end_reason="rules_changed")
    b = _event("memory_storage", start=date(2026, 10, 6), shown=False)
    _event(start=date(2020, 3, 2), origin="backfill")
    _event(start=date(2026, 10, 7), version="oldvers1")
    rows = _data("/surge/history")
    assert [r["id"] for r in rows] == [b, a]
    assert set(rows[0]) == SURGE_KEYS
    assert rows[1]["end_reason"] == "rules_changed"
    assert rows[1]["leaders"] == [{"ticker": "MU", "name": "Micron", "return5_pct": 12.5}]
    assert [r["id"] for r in _data("/surge/history?shown=yes")] == [a]
    assert [r["id"] for r in _data("/surge/history?theme=memory_storage")] == [b]
    assert [r["id"] for r in _data("/surge/history?limit=1")] == [b]
    assert _get("/surge/history?limit=0").status_code == 422
    assert _get("/surge/history?limit=501").status_code == 422
    assert _get("/surge/history?shown=no").status_code == 422
    store.set_state(f"backfill:{V}", "degraded")
    assert len(_data("/surge/history")) == 3


def test_surge_404():
    """Catches an unknown id returning 200/null, a different detail string, and a hidden backfill event
    being served by id."""
    _seed_watchlist()
    store.set_state(f"backfill:{V}", "running")
    hidden = _event(origin="backfill")
    live = _event(start=date(2026, 10, 9))
    response = _get("/surge/events/999")
    assert response.status_code == 404 and response.json()["detail"] == "unknown_surge:999"
    assert _get(f"/surge/events/{hidden}").status_code == 404
    assert _data(f"/surge/events/{live}")["id"] == live
    old = _event(version="oldvers1")
    assert _get(f"/surge/events/{old}").status_code == 404
    sox = _event("^SOX", start=date(2026, 10, 10))
    assert _data(f"/surge/events/{sox}")["label"] == {"ko": "필라델피아 반도체(SOX)",
                                                        "en": "Philadelphia Semiconductor (SOX)"}
    store.set_state(f"backfill:{V}", "done")
    assert _data(f"/surge/events/{hidden}")["id"] == hidden


def test_movers_range_and_default():
    """Catches a default other than the latest 20 evaluated days, from/to bounds off by one, a missing 422
    for from>to, hidden backfill days leaking, and an old version leaking."""
    _seed_watchlist()
    store.set_state(f"backfill:{V}", "done")
    days = [date.fromordinal(date(2026, 8, 3).toordinal() + i) for i in range(25)]
    for d in days:
        _surge_day(d)
        _movers(d)
    _movers(date(2026, 8, 1), version="oldvers1")
    got = _data("/movers")
    assert [r["date"] for r in got] == [d.isoformat() for d in days[-20:]]
    assert [m["ticker"] for m in got[0]["items"]] == ["MU", "AMAT"] and got[0]["items"][0]["name"] == "Micron"
    got = _data("/movers?from=2026-08-05&to=2026-08-07")
    assert [r["date"] for r in got] == ["2026-08-05", "2026-08-06", "2026-08-07"]
    assert [r["date"] for r in _data("/movers?to=2026-08-04")] == ["2026-08-03", "2026-08-04"]
    assert _get("/movers?from=2026-08-07&to=2026-08-05").status_code == 422
    assert _get("/movers?from=notadate").status_code == 422
    store.set_state(f"backfill:{V}", "running")
    _surge_day(date(2026, 7, 1), origin="backfill")
    _movers(date(2026, 7, 1))
    assert _data("/movers?from=2026-07-01&to=2026-08-04")[0]["date"] == "2026-08-03"
    store.set_state(f"backfill:{V}", "done")
    assert _data("/movers?from=2026-07-01&to=2026-08-04")[0]["date"] == "2026-07-01"


def test_movers_range_limit():
    """Catches a missing 2600-day cap (2601 evaluated days is rejected, 2600 is served)."""
    store.set_state(f"backfill:{V}", "done")
    base = date(2000, 1, 1).toordinal()
    with get_db() as conn:
        conn.executemany(
            "INSERT INTO risk_daily (date, rules_version, origin, warnings_json, confirming_json, sox_confirming,"
            " cap_share, bars_coverage, evaluated_at) VALUES (?, ?, 'live', '{}', '{}', 0, 0, 1, 't')",
            [(date.fromordinal(base + i).isoformat(), V) for i in range(2601)])
    assert _get("/movers?from=2000-01-01").status_code == 422
    assert _get("/movers?from=2000-01-02").status_code == 200


def test_never_evaluated_nulls():
    """Catches surge/movers invented (or an error) when nothing was evaluated, or for a day saved
    before surge existed / without movers."""
    data = _data("/latest")
    assert data["surge"] is None and data["movers"] is None
    store.set_state(f"backfill:{V}", "done")
    store.save_day(_day(), V, "live", 1.0, "t")
    data = _data("/latest")
    assert data["surge"] is None and data["movers"] is None
    assert _data("/surge/history") == [] and _data("/movers") == []


# ---- additions for the signal screens ----
def test_alert_cards_all():
    """Catches ?cards=all still capped at 10, the default no longer capped, a deck total that changes with
    the option, and an unknown option value accepted."""
    _seed_watchlist()
    aid = _alert()
    store.replace_cards(aid, "latest", "crash", [CrashCard(f"T{i}", -10.0 - i, date(2026, 9, 25), 2.0, 1.0, [1.0])
                                                  for i in range(12)], START)
    store.replace_cards(aid, "latest", "candidate", [CandidateCard(f"C{i}", -0.7, 0.85, "MU") for i in range(13)],
                        START)
    default = _data(f"/alerts/{aid}")
    assert len(default["crash"]["cards"]) == 10 and len(default["candidates"]["cards"]) == 10
    full = _data(f"/alerts/{aid}?cards=all")
    assert len(full["crash"]["cards"]) == 12 and len(full["candidates"]["cards"]) == 13
    assert full["crash"]["total"] == 12 and full["candidates"]["total"] == 13
    assert _get(f"/alerts/{aid}?cards=some").status_code == 422


def test_latest_surge_leaders_and_components_info():
    """Catches leaders missing or unnamed on latest themes, components_info out of order or not taken from
    the rules text, and components_info missing on the single-event endpoint (or leaking into history)."""
    _seed_watchlist()
    store.set_state(f"backfill:{V}", "done")
    _surge_day()
    event = _event()
    surge = _data("/latest")["surge"]
    assert surge["themes"][0]["leaders"] == [{"ticker": "MU", "name": "Micron", "return5_pct": 12.5}]
    rules = get_rules().rules
    info = surge["components_info"]
    assert [i["id"] for i in info] == ["magnitude", "accel", "breadth", "rsi"]
    assert info[0] == {"id": "magnitude", "label": rules.surge_labels.magnitude.model_dump(),
                       "rule": rules.surge_rule_text.magnitude.model_dump()}
    assert info[3]["rule"] == rules.surge_rule_text.rsi.model_dump()
    assert _data(f"/surge/events/{event}")["components_info"] == info
    assert "components_info" not in _data("/surge/history")[0]


def test_banner_since_run_and_null():
    """Catches banner_since taken as the first banner day ever (not the current run), a run that ignores a
    gap day, hidden backfill days counted, another rules version counted, and non-null while the banner is off."""
    store.set_state(f"backfill:{V}", "running")
    d = [date(2026, 10, n) for n in (1, 2, 5, 6, 7)]
    _surge_day(d[0], banner=True, origin="backfill")
    _surge_day(d[1], banner=False)
    _surge_day(d[2], banner=True, origin="backfill")
    _surge_day(d[3], banner=True)
    _surge_day(d[4], banner=True)
    _event()
    assert _data("/latest")["surge"]["banner_since"] == "2026-10-06"  # the hidden backfill day 5 does not count
    store.set_state(f"backfill:{V}", "done")
    assert _data("/latest")["surge"]["banner_since"] == "2026-10-05"  # day 2 broke the run
    store.save_day(DayResult(date(2026, 10, 8), {}, False, 0, {}, False, 0.0, False, surge={}, surge_banner=False,
                             surge_cap_share=0.0), "oldvers1", "live", 1.0, "t")
    assert _data("/latest")["surge"]["banner_since"] == "2026-10-05"
    _surge_day(date(2026, 10, 8), banner=False)
    assert _data("/latest")["surge"]["banner_since"] is None


def test_summary_max_dd10_and_labels():
    """Catches max_dd10 taken from a non-primary stint, trigger_labels out of trigger order or unnamed,
    and ^SOX losing its API name."""
    store.set_state(f"backfill:{V}", "done")
    aid = store.insert_alert(START, ["memory_storage", "^SOX"], V, "live", "^SOX", False)
    for theme, dd in (("memory_storage", -7.5), ("^SOX", -2.0)):
        store.upsert_stint(aid, ThemeStint(theme, "theme", START, None, START), -6.0,
                           {"fwd5": None, "fwd10": None, "fwd20": None, "max_dd10": dd})
    row = _data("/history")[0]
    assert row["max_dd10"] == -2.0  # the primary (^SOX) stint, not the last-sorted one
    assert row["trigger_labels"] == [
        {"id": "memory_storage", "label": {"ko": "메모리·스토리지", "en": "Memory & storage"}},
        {"id": "^SOX", "label": {"ko": "필라델피아 반도체(SOX)", "en": "Philadelphia Semiconductor (SOX)"}}]
    other = _alert(start=date(2026, 10, 1), max_dd10=None)
    assert [r for r in _data("/history") if r["id"] == other][0]["max_dd10"] is None


def _seed_levels(days=10, sox=False):
    """ai_semis = NVDA, A1, A2 with equal shares, each closing 1% above the day before."""
    start = date(2025, 1, 1).toordinal()
    members = {"NVDA": 100.0, "A1": 200.0, "A2": 300.0}
    with get_db() as conn:
        for t, base in members.items():
            conn.execute("INSERT OR REPLACE INTO watchlist (ticker, name, theme) VALUES (?, ?, 'ai_semis')", (t, t))
            conn.execute("INSERT OR REPLACE INTO corporate_quote_facts (ticker, shares_outstanding, fetched_at) "
                         "VALUES (?, 10, 't')", (t,))
            conn.execute("DELETE FROM stocks WHERE ticker = ?", (t,))
            conn.executemany("INSERT INTO stocks (ticker, date, close) VALUES (?, ?, ?)",
                             [(t, date.fromordinal(start + i).isoformat(), base * 1.01 ** i) for i in range(days)])
        if sox:
            conn.execute("INSERT OR REPLACE INTO watchlist (ticker, name, theme) VALUES ('^SOX', 'SOX', '')")
            conn.executemany("INSERT INTO stocks (ticker, date, close) VALUES ('^SOX', ?, ?)",
                             [(date.fromordinal(start + i).isoformat(), 5000.0 * 1.02 ** i) for i in range(days)])
    return [date.fromordinal(start + i).isoformat() for i in range(days)]


def test_theme_level_rebased_and_bounds():
    """Catches a level not rebased to 100 at the first returned day, from/to ignored or off by one, a default
    window other than 120 trading days, a missing 400-day cap (401 rejected, 400 served), and from>to."""
    days = _seed_levels(130)
    got = _data("/themes/ai_semis/level?from=" + days[3] + "&to=" + days[6])
    assert [p["date"] for p in got] == days[3:7]
    assert [round(p["level"], 6) for p in got] == [round(100 * 1.01 ** i, 6) for i in range(4)]
    default = _data("/themes/ai_semis/level")
    assert [p["date"] for p in default] == days[-120:] and default[0]["level"] == 100.0
    assert round(default[-1]["level"], 6) == round(100 * 1.01 ** 119, 6)
    assert _get("/themes/ai_semis/level?from=" + days[6] + "&to=" + days[3]).status_code == 422

    long_days = _seed_levels(405)
    assert len(_data("/themes/ai_semis/level?from=" + long_days[5])) == 400
    response = _get("/themes/ai_semis/level?from=" + long_days[4])
    assert response.status_code == 422 and response.json()["detail"] == "range_too_long"


def test_theme_level_unknown_404():
    """Catches an unknown theme returning 200/[] or a different detail string."""
    _seed_levels(5)
    response = _get("/themes/nope/level")
    assert response.status_code == 404 and response.json()["detail"] == "unknown_theme:nope"


def test_theme_level_sox():
    """Catches ^SOX unknown (404), ^SOX served from a theme index instead of its own closes, or not rebased."""
    days = _seed_levels(10, sox=True)
    got = _data("/themes/%5ESOX/level?from=" + days[2])
    assert [p["date"] for p in got] == days[2:]
    assert [round(p["level"], 6) for p in got] == [round(100 * 1.02 ** i, 6) for i in range(8)]
