"""Risk-alert record tables and store. Each docstring names the mutation its test catches."""
from __future__ import annotations

import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services import db as db_service
from apps.api.services.db import get_db
from apps.api.services.risk import store
from packages.core_finance.risk_signals.alerts import ThemeStint
from packages.core_finance.risk_signals.decks import CandidateCard, CrashCard
from packages.core_finance.risk_signals.evaluate import DayResult
from packages.core_finance.risk_signals.movers import Mover

V = "aaaa1111"
OUTCOME = {"fwd5": -1.0, "fwd10": -2.0, "fwd20": -3.0, "max_dd10": -4.0}


def _day(d=date(2026, 10, 8)):
    return DayResult(d, {"W1": ("on", 1.5, d), "W2": ("off", None, None)}, True, 1,
                     {"ai_semis": "theme"}, False, 0.25, True)


def _alert(version=V, origin="live", start=date(2026, 10, 8)):
    return store.insert_alert(start, ["W1", "W2"], version, origin, "ai_semis", True)


def test_tables_created_on_init():
    """Catches a missing table or a missing news column in the schema SQL."""
    with TestClient(app):
        pass
    with get_db() as conn:
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        news = {r["name"] for r in conn.execute("PRAGMA table_info(news)")}
    assert {"risk_daily", "risk_alerts", "risk_alert_themes", "risk_alert_cards", "risk_state"} <= tables
    assert {"lang", "topic"} <= news


@pytest.mark.virgin_db
def test_old_news_table_migrates_lang_topic(tmp_path, monkeypatch):
    """Catches removing the news ALTERs: an old news table keeps no lang/topic columns."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """CREATE TABLE news (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, headline TEXT NOT NULL,
               url TEXT DEFAULT '', source TEXT DEFAULT '', published_date TEXT DEFAULT '',
               sentiment TEXT DEFAULT 'neutral', importance INTEGER DEFAULT 1, hash TEXT UNIQUE)""")
        conn.execute("INSERT INTO news (ticker, headline, hash) VALUES ('AAPL', 'Old headline', 'h1')")

    db_service.init_db()
    db_service.init_db()  # idempotent

    with sqlite3.connect(str(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM news WHERE hash = 'h1'").fetchone()
    assert (row["headline"], row["lang"], row["topic"]) == ("Old headline", "en", "")


def test_purge_version_keeps_live():
    """Catches a purge that ignores origin (live alert lost) or leaves backfill children/daily rows."""
    live, back = _alert(origin="live"), _alert(origin="backfill", start=date(2020, 3, 1))
    other = _alert(version="bbbb2222", origin="backfill")
    for aid in (live, back, other):
        store.upsert_stint(aid, ThemeStint("ai_semis", "theme", date(2026, 10, 8), None, date(2026, 10, 8)), -5.0, OUTCOME)
        store.replace_cards(aid, "start", "crash", [CrashCard("NVDA", -20.0, date(2026, 9, 1), 100.0, 80.0, [80.0])], date(2026, 10, 8))
    store.save_day(_day(), V, "live", 1.0, "t")

    store.purge_version(V)

    assert store.get_alert(live) is not None and store.get_alert(back) is None
    assert store.get_alert(other) is not None
    with get_db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM risk_alert_themes WHERE alert_id = ?", (back,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM risk_alert_cards WHERE alert_id = ?", (back,)).fetchone()[0] == 0
    assert store.last_evaluated(V) is None
    assert len(store.get_alert(live).stints) == 1

    store.purge_version(V, include_live=True)
    assert store.get_alert(live) is None


def test_rejoin_stint_two_rows():
    """Catches a stint key without joined_date: the re-entry would overwrite the first stint. Also
    that re-saving the same stint updates in place."""
    aid = _alert()
    first = ThemeStint("ai_semis", "theme", date(2026, 10, 8), date(2026, 10, 12), date(2026, 10, 12))
    again = ThemeStint("ai_semis", "sox", date(2026, 10, 20), None, date(2026, 10, 20))
    store.upsert_stint(aid, first, -5.0, OUTCOME)
    store.upsert_stint(aid, again, -7.0, {})
    store.upsert_stint(aid, ThemeStint("ai_semis", "theme", date(2026, 10, 8), date(2026, 10, 13), date(2026, 10, 13)), -5.0, OUTCOME)

    stints = store.get_alert(aid).stints
    assert [(s.joined_date, s.left_date, s.via) for s in stints] == [
        (date(2026, 10, 8), date(2026, 10, 13), "theme"), (date(2026, 10, 20), None, "sox")]
    assert stints[0].fwd10 == -2.0 and stints[1].fwd10 is None and stints[1].dd20_at_join == -7.0


def test_cards_latest_overwritten_start_kept():
    """Catches replace_cards deleting by alert only (start lost), or appending instead of replacing."""
    aid = _alert()
    d1, d2 = date(2026, 10, 8), date(2026, 10, 9)
    crash = lambda t, dd: CrashCard(t, dd, date(2026, 9, 1), 100.0, 90.0, [90.0, 91.0])
    store.replace_cards(aid, "start", "crash", [crash("NVDA", -10.0), crash("AMD", -9.0)], d1)
    store.replace_cards(aid, "start", "candidate", [CandidateCard("TSM", -3.0, 0.8, "NVDA")], d1)
    store.replace_cards(aid, "latest", "crash", [crash("NVDA", -10.0), crash("AMD", -9.0)], d1)
    store.replace_cards(aid, "latest", "crash", [crash("MU", -15.0)], d2)

    cards = store.get_alert(aid).cards
    assert [c.ticker for c in cards[("start", "crash")]] == ["NVDA", "AMD"]
    assert [c.ticker for c in cards[("latest", "crash")]] == ["MU"]
    assert cards[("latest", "crash")][0].as_of == d2
    assert cards[("latest", "crash")][0].payload == {"high_close": 100.0, "close": 90.0, "closes_30d": [90.0, 91.0]}
    cand = cards[("start", "candidate")][0]
    assert (cand.pct_from_high63, cand.corr, cand.corr_with, cand.payload) == (-3.0, 0.8, "NVDA", None)


def test_day_roundtrip_and_alert_lifecycle():
    """Catches lost warnings fields (on_count, w1_proxy, observed_at), a wrong latest_day order, and
    a close that does not release or leaves open_alert returning it."""
    store.save_day(_day(date(2026, 10, 7)), V, "backfill", 0.9, "t0")
    store.save_day(_day(), V, "live", 1.0, "t1")
    day = store.latest_day(V)
    assert day.date == date(2026, 10, 8) and store.last_evaluated(V) == date(2026, 10, 8)
    assert day.warnings["W1"] == {"state": "on", "value": 1.5, "observed_at": "2026-10-08"}
    assert (day.on_count, day.w1_proxy, day.confirming, day.sox_confirming, day.cap_share) == (1, True, {"ai_semis": "theme"}, False, 0.25)

    aid = _alert()
    assert store.open_alert(V).id == aid and store.open_alert("zzzz") is None
    store.close_alert(aid, date(2026, 10, 15), "all_themes_out")
    got = store.get_alert(aid)
    assert (got.status, got.release_date, got.release_reason, got.trigger) == ("released", date(2026, 10, 15), "all_themes_out", ("W1", "W2"))
    assert store.open_alert(V) is None
    assert [a.id for a in store.list_alerts(V, "live", 10)] == [aid]
    assert store.list_alerts(V, "backfill", 10) == []


def test_state_roundtrip():
    """Catches set_state that appends instead of replacing."""
    assert store.get_state("k") is None
    store.set_state("k", "1")
    store.set_state("k", "2")
    assert store.get_state("k") == "2"


def test_update_card_outcomes_one_card_only():
    """Catches an UPDATE that ignores snapshot, deck or ticker (other cards overwritten), or one that
    does not write all three horizons."""
    aid = _alert()
    d = date(2026, 10, 8)
    crash = lambda t: CrashCard(t, -12.0, date(2026, 9, 1), 100.0, 88.0, [88.0])
    store.replace_cards(aid, "start", "crash", [crash("NVDA"), crash("AMD")], d)
    store.replace_cards(aid, "latest", "crash", [crash("NVDA")], d)
    store.replace_cards(aid, "start", "candidate", [CandidateCard("NVDA", -3.0, 0.8, "^SOX")], d)

    store.update_card_outcomes(aid, "start", "crash", "NVDA", {"fwd5": 1.5, "fwd10": -2.5, "fwd20": 3.5})

    cards = store.get_alert(aid).cards
    nvda, amd = cards[("start", "crash")]
    assert (nvda.fwd5, nvda.fwd10, nvda.fwd20) == (1.5, -2.5, 3.5)
    assert (amd.fwd5, amd.fwd10, amd.fwd20) == (None, None, None)
    assert cards[("latest", "crash")][0].fwd5 is None
    assert cards[("start", "candidate")][0].fwd5 is None


def test_stint_last_ref_roundtrip():
    """Catches upsert_stint not writing last_ref, or not updating it on conflict, or _hydrate dropping it."""
    aid = _alert()
    stint = ThemeStint("ai_semis", "theme", date(2026, 10, 8), None, date(2026, 10, 8))
    store.upsert_stint(aid, stint, -5.0, {})
    assert store.get_alert(aid).stints[0].last_ref == date(2026, 10, 8)
    stint.last_ref = date(2026, 10, 14)
    store.upsert_stint(aid, stint, -5.0, {})
    assert store.get_alert(aid).stints[0].last_ref == date(2026, 10, 14)


def test_versions_from_alerts_and_days():
    """Catches versions() missing either table."""
    _alert(version="alrt0000")
    store.save_day(_day(), "days0000", "backfill", 1.0, "t")
    assert store.versions() == {"alrt0000", "days0000"}


@pytest.mark.virgin_db
def test_old_stint_table_migrates_last_ref(tmp_path, monkeypatch):
    """Catches removing the last_ref ALTER: a stint table created before it keeps no last_ref column."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """CREATE TABLE risk_alert_themes (alert_id INTEGER NOT NULL, theme TEXT NOT NULL, via TEXT NOT NULL,
               joined_date TEXT NOT NULL, left_date TEXT, dd20_at_join REAL, fwd5 REAL, fwd10 REAL, fwd20 REAL,
               max_dd10 REAL, PRIMARY KEY (alert_id, theme, joined_date))""")

    db_service.init_db()
    db_service.init_db()  # idempotent

    with sqlite3.connect(str(db_path)) as conn:
        columns = {r[1] for r in conn.execute("PRAGMA table_info(risk_alert_themes)")}
    assert "last_ref" in columns


# ---- surge and movers storage ----

SURGE_COMPONENTS = {"magnitude_z": 2.5, "accel_pct": 1.2, "accel_rank": 0.9, "breadth_pct": 80.0, "rsi": 71.0}
LEADERS = [{"ticker": "NVDA", "return5_pct": 12.5}, {"ticker": "AMD", "return5_pct": 9.0}]


def _surge(version=V, origin="live", theme="ai_semis", start=date(2026, 10, 8), shown=True, **kw):
    return store.insert_surge_event(version, origin, theme, start, shown=shown, components=SURGE_COMPONENTS,
                                    leaders=LEADERS, last_high=start, **kw)


def test_surge_tables_created():
    """Catches a missing surge table or risk_daily column in the schema SQL, and an events table whose
    CHECK lets an unknown origin or end_reason in."""
    with TestClient(app):
        pass
    with get_db() as conn:
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        daily = {r["name"] for r in conn.execute("PRAGMA table_info(risk_daily)")}
    assert {"surge_events", "surge_state", "daily_movers"} <= tables
    assert {"surge_json", "surge_banner", "surge_cap_share"} <= daily
    with pytest.raises(sqlite3.IntegrityError):
        _surge(origin="other")
    with pytest.raises(sqlite3.IntegrityError):
        _surge(end=date(2026, 10, 9), end_reason="bogus")


@pytest.mark.virgin_db
def test_old_risk_daily_migrates(tmp_path, monkeypatch):
    """Catches removing the risk_daily surge ALTERs: an old table keeps no surge columns, and an old
    row must read back with surge fields None and still save a new day."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """CREATE TABLE risk_daily (date TEXT NOT NULL, rules_version TEXT NOT NULL, origin TEXT NOT NULL,
               warnings_json TEXT NOT NULL, confirming_json TEXT NOT NULL, sox_confirming INTEGER NOT NULL,
               cap_share REAL NOT NULL, bars_coverage REAL NOT NULL, evaluated_at TEXT NOT NULL,
               PRIMARY KEY (date, rules_version))""")
        conn.execute(
            """INSERT INTO risk_daily VALUES ('2026-10-07', 'aaaa1111', 'live',
               '{"warnings": {}, "on_count": 0, "w1_proxy": false}', '{}', 0, 0.0, 1.0, 't')""")

    db_service.init_db()
    db_service.init_db()  # idempotent

    with sqlite3.connect(str(db_path)) as conn:
        columns = {r[1] for r in conn.execute("PRAGMA table_info(risk_daily)")}
    assert {"surge_json", "surge_banner", "surge_cap_share"} <= columns
    old = store.get_day(V, date(2026, 10, 7))
    assert (old.surge, old.surge_banner, old.surge_cap_share) == (None, None, None)
    store.save_day(DayResult(date(2026, 10, 8), {}, False, 0, {}, False, 0.0, False,
                             surge={"ai_semis": {"on": True, "rsi": None}}, surge_banner=True,
                             surge_cap_share=0.3), V, "live", 1.0, "t")
    assert store.get_day(V, date(2026, 10, 8)).surge_cap_share == 0.3


def test_day_surge_roundtrip():
    """Catches save_day dropping a surge field, a banner stored inverted, None floats lost in the JSON,
    and a day without surge reading back as a False banner / 0.0 share instead of None."""
    d = date(2026, 10, 8)
    surge = {"ai_semis": {"magnitude_z": 2.5, "rsi": None, "on": True, "overheated": False}}
    store.save_day(DayResult(d, {}, False, 0, {}, False, 0.0, False, surge=surge, surge_banner=True,
                             surge_cap_share=0.25), V, "live", 1.0, "t")
    got = store.get_day(V, d)
    assert (got.surge, got.surge_banner, got.surge_cap_share) == (surge, True, 0.25)
    store.save_day(DayResult(d, {}, False, 0, {}, False, 0.0, False, surge={}), V, "live", 1.0, "t")
    assert store.get_day(V, d).surge_banner is False
    store.save_day(_day(d), V, "live", 1.0, "t")
    got = store.get_day(V, d)
    assert (got.surge, got.surge_banner, got.surge_cap_share) == (None, None, None)


def test_surge_event_lifecycle():
    """Catches shown not stored, leaders/components lost, update not closing the event, outcome keys
    not written, and the filters in list_surge / open_surge_events."""
    a = _surge(shown=True)
    b = _surge(theme="^SOX", start=date(2026, 10, 9), shown=False)
    c = _surge(version="bbbb2222")
    assert {e.id for e in store.open_surge_events(V)} == {a, b}
    got = store.get_surge(a)
    assert (got.shown, got.components, got.leaders, got.end_date, got.fwd5) == (True, SURGE_COMPONENTS, LEADERS, None, None)

    store.update_surge_event(a, end=date(2026, 10, 14), end_reason="below_ema",
                             last_high=date(2026, 10, 12), overheated_on=date(2026, 10, 11))
    store.fill_surge_outcome(a, {"fwd5": 1.0, "fwd10": 2.0, "fwd20": 3.0, "max_runup10": 4.0})
    got = store.get_surge(a)
    assert (got.end_date, got.end_reason, got.last_high_date, got.overheated_on) == (
        date(2026, 10, 14), "below_ema", date(2026, 10, 12), date(2026, 10, 11))
    assert (got.fwd5, got.fwd10, got.fwd20, got.max_runup10) == (1.0, 2.0, 3.0, 4.0)
    assert [e.id for e in store.open_surge_events(V)] == [b]

    assert [e.id for e in store.list_surge(V, None, None, 10)] == [b, a]  # newest start first
    assert [e.id for e in store.list_surge(V, True, None, 10)] == [a]
    assert [e.id for e in store.list_surge(V, False, None, 10)] == [b]
    assert [e.id for e in store.list_surge(V, None, "^SOX", 10)] == [b]
    assert len(store.list_surge(V, None, None, 1)) == 1
    assert store.get_surge(c).rules_version == "bbbb2222" and store.get_surge(9999) is None


def test_purge_keeps_live_surge():
    """Catches a purge that deletes live surge events, leaves backfill events, last confirmations or
    movers, or reaches into another version."""
    live, back = _surge(origin="live"), _surge(origin="backfill", start=date(2020, 3, 2))
    other = _surge(version="bbbb2222", origin="backfill")
    for v in (V, "bbbb2222"):
        store.set_last_confirm(v, "ai_semis", date(2026, 10, 8))
        store.save_movers(v, date(2026, 10, 8), [Mover(1, "NVDA", 5.0, 100.0, 9.0, 60.0)])

    store.purge_version(V)

    assert store.get_surge(live) is not None and store.get_surge(back) is None
    assert store.get_surge(other) is not None
    assert store.last_confirms(V) == {} and store.last_confirms("bbbb2222") != {}
    assert store.list_movers(V, date(2026, 1, 1), date(2026, 12, 31)) == []
    assert len(store.list_movers("bbbb2222", date(2026, 1, 1), date(2026, 12, 31))) == 1

    store.purge_version(V, include_live=True)
    assert store.get_surge(live) is None and store.get_surge(other) is not None


def test_movers_roundtrip():
    """Catches a lost field, a wrong order (day then rank), a range that excludes an end day, a
    re-save that appends instead of replacing, a missing theme and a None turned into a number."""
    d1, d2, d3 = date(2026, 10, 7), date(2026, 10, 8), date(2026, 10, 9)
    store.save_movers(V, d2, [Mover(1, "NVDA", 5.0, 100.0, 9.0, 60.0), Mover(2, "AMD", 4.0, 50.0, None, None)],
                      {"NVDA": "ai_semis", "AMD": "ai_semis"})
    store.save_movers(V, d1, [Mover(1, "MU", 3.0, 80.0, 1.0, 55.0), Mover(2, "TSM", 2.0, 90.0, 1.0, 55.0)],
                      {"MU": "memory", "TSM": "ai_semis"})
    store.save_movers(V, d3, [Mover(1, "XYZ", 2.0, 10.0, 1.0, 50.0)])
    assert [(m.ticker, m.return5_pct, m.rsi) for m in store.list_movers(V, d2, d2)][1] == ("AMD", None, None)
    store.save_movers(V, d2, [Mover(1, "NVDA", 6.0, 101.0, 9.5, 61.0), Mover(2, "AMD", 4.0, 50.0, None, None)],
                      {"NVDA": "ai_semis", "AMD": "ai_semis"})  # replaces d2

    got = store.list_movers(V, d1, d2)
    assert [(m.date, m.rank, m.ticker, m.theme) for m in got] == [
        (d1, 1, "MU", "memory"), (d1, 2, "TSM", "ai_semis"), (d2, 1, "NVDA", "ai_semis"), (d2, 2, "AMD", "ai_semis")]
    assert (got[2].return_pct, got[2].close, got[2].return5_pct, got[2].rsi) == (6.0, 101.0, 9.5, 61.0)
    assert store.list_movers(V, d3, d3)[0].theme == ""


def test_last_confirm_roundtrip():
    """Catches set_last_confirm appending instead of replacing, mixing versions, or returning strings."""
    store.set_last_confirm(V, "ai_semis", date(2026, 10, 7))
    store.set_last_confirm(V, "ai_semis", date(2026, 10, 8))
    store.set_last_confirm(V, "^SOX", date(2026, 10, 5))
    store.set_last_confirm("bbbb2222", "memory", date(2020, 1, 2))
    assert store.last_confirms(V) == {"ai_semis": date(2026, 10, 8), "^SOX": date(2026, 10, 5)}
    assert store.last_confirms("zzzz") == {}


def test_surge_writes_join_transaction():
    """Catches a surge write that opens its own connection: it would commit despite the rollback."""
    with pytest.raises(RuntimeError):
        with store.transaction():
            _surge()
            store.set_last_confirm(V, "ai_semis", date(2026, 10, 8))
            store.save_movers(V, date(2026, 10, 8), [Mover(1, "NVDA", 5.0, 100.0, 9.0, 60.0)])
            raise RuntimeError
    assert store.open_surge_events(V) == [] and store.last_confirms(V) == {}
    assert store.list_movers(V, date(2026, 1, 1), date(2026, 12, 31)) == []


@pytest.mark.virgin_db
def test_surge_end_reason_check_migrates(tmp_path, monkeypatch):
    """S8. Catches an old surge_events table whose end_reason CHECK rejects 'rules_changed' left in place
    (closing an old version's live event at a rules change would fail), or a rebuild that loses its rows
    or its index."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    old_sql = db_service._SURGE_EVENTS_SQL.replace("'below_ema','stalled','rules_changed'", "'below_ema','stalled'")
    assert old_sql != db_service._SURGE_EVENTS_SQL
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(old_sql)
        conn.execute("INSERT INTO surge_events (rules_version, origin, theme, start_date, shown, components_json, "
                     "last_high_date, leaders_json, created_at) "
                     "VALUES ('aaaa1111', 'live', 'ai_semis', '2026-10-08', 1, '{}', '2026-10-08', '[]', 't')")

    db_service.init_db()
    db_service.init_db()  # idempotent

    [kept] = store.open_surge_events(V)
    store.update_surge_event(kept.id, end=date(2026, 10, 9), end_reason="rules_changed",
                             last_high=kept.last_high_date, overheated_on=None)
    assert store.get_surge(kept.id).end_reason == "rules_changed"
    with sqlite3.connect(str(db_path)) as conn:
        indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
    assert "idx_surge_events_version" in indexes
