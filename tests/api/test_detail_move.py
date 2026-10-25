from __future__ import annotations

import statistics
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.models.schemas import MarketEvent
from apps.api.services import detail_view
from apps.api.services.db import get_db
from apps.api.services.detail_view import NoBarOnDay, NoBars, explain_move
from apps.api.services.risk import store
from apps.api.services.risk.rules import get_rules
from packages.core_finance.risk_signals.alerts import ThemeStint
from packages.core_finance.risk_signals.decks import CandidateCard

N = 70
D = date(2026, 10, 9)  # last seeded bar
FIRST = D - timedelta(days=N - 1)
THEME = "ai_semis"
BASE = {"AAA": 100.0, "BBB": 200.0, "CCC": 50.0}
LAST_RET = {"AAA": -0.06, "BBB": -0.04, "CCC": 0.03}


def day_of(i: int) -> str:
    return (FIRST + timedelta(days=i)).isoformat()


def closes_for(base: float, last_ret: float) -> list[float]:
    out = [base]
    for i in range(1, N - 1):
        out.append(out[-1] * (1.01 if i % 2 else 0.99))
    out.append(out[-1] * (1 + last_ret))
    return out


def volumes_for() -> list[int]:
    vols = [1000 + 10 * i for i in range(N - 1)]
    vols.append(5000)
    return vols


def add_watch(ticker: str, name: str, theme: str) -> None:
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name, theme) VALUES (?, ?, ?)", (ticker, name, theme))
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'T', 'I', '2026-01-01')", (ticker,))


def add_bars(ticker: str, closes: list[float], volumes: list[int] | None = None, table: str = "stocks") -> None:
    """Closes end on D; a shorter list covers only the last days."""
    offset = N - len(closes)
    with get_db() as conn:
        for k, c in enumerate(closes):
            v = None if volumes is None else volumes[k]
            if table == "stocks":
                conn.execute("INSERT INTO stocks (ticker, date, close, volume) VALUES (?, ?, ?, ?)",
                             (ticker, day_of(offset + k), c, v))
            else:
                conn.execute("INSERT INTO indices (name, ticker, date, close, volume) VALUES (?, ?, ?, ?, ?)",
                             (ticker, ticker, day_of(offset + k), c, v))


class NoEvents:
    def events(self, start, end):
        return []


@pytest.fixture(autouse=True)
def no_events(monkeypatch):
    """The real registry needs exchange_calendars and committed event files; tests pin it."""
    monkeypatch.setattr(detail_view, "default_registry", lambda: NoEvents())


@pytest.fixture
def seed():
    for t in BASE:
        add_watch(t, f"Name {t}", THEME)
    add_bars("AAA", closes_for(BASE["AAA"], LAST_RET["AAA"]), volumes_for())
    add_bars("BBB", closes_for(BASE["BBB"], LAST_RET["BBB"]))
    add_bars("CCC", closes_for(BASE["CCC"], LAST_RET["CCC"]))
    gspc = [5000.0] * (N - 1) + [4950.0]
    add_bars("^GSPC", gspc, table="indices")


def alert(start: date, release: date | None, theme: str = THEME, cards: tuple[str, ...] = ()) -> int:
    version = get_rules().version
    alert_id = store.insert_alert(start, (theme,), version, "live", theme, False)
    store.upsert_stint(alert_id, ThemeStint(theme=theme, via="trigger", joined=start, left=None, last_ref=start),
                       None, {})
    if cards:
        store.replace_cards(alert_id, "start", "candidate",
                            [CandidateCard(ticker=t, pct_from_high63=-5.0, corr=0.5, corr_with="X") for t in cards],
                            start)
    if release is not None:
        store.close_alert(alert_id, release, "all_themes_out")
    return alert_id


def test_returns_and_ratios_match_seeded_bars(seed):
    closes, vols = closes_for(BASE["AAA"], LAST_RET["AAA"]), volumes_for()
    rets = [closes[i] / closes[i - 1] - 1 for i in range(1, N)]
    sd = statistics.stdev(rets[-61:-1])  # the 60 returns before the day
    m = explain_move("aaa", D)
    assert m.date == D.isoformat()
    assert m.return_pct == round(rets[-1] * 100, 2) == -6.0
    assert m.price_ratio == round(abs(rets[-1]) / sd, 2)
    assert m.volume_ratio == round(5000 / (sum(vols[-21:-1]) / 20), 2)


def test_ratios_null_with_short_history(seed):
    add_watch("NEW", "Newcomer", "")
    add_bars("NEW", [100.0 + i for i in range(10)], [1000] * 10)
    m = explain_move("NEW", D)
    assert m.return_pct == round((109 / 108 - 1) * 100, 2)
    assert m.price_ratio is None and m.volume_ratio is None


def test_market_and_theme_returns(seed):
    prev = {t: closes_for(BASE[t], LAST_RET[t])[-2] for t in BASE}
    expected = sum(prev[t] * LAST_RET[t] for t in BASE) / sum(prev.values()) * 100
    m = explain_move("AAA", D)
    assert (m.market.ticker, m.market.return_pct) == ("^GSPC", -1.0)
    assert m.theme.id == THEME and m.theme.label.en == "AI semiconductors"
    assert m.theme.return_pct == round(expected, 2)


def test_market_missing_is_null_not_zero(seed):
    with get_db() as conn:
        conn.execute("DELETE FROM indices WHERE ticker = '^GSPC' AND date = ?", (D.isoformat(),))
    assert explain_move("AAA", D).market is None


def test_peers_sorted_and_missing_bar_excluded(seed):
    add_watch("GONE", "No bar today", THEME)
    with get_db() as conn:  # GONE has bars on D-2 and D-1 only
        for i, c in ((N - 3, 100.0), (N - 2, 101.0)):
            conn.execute("INSERT INTO stocks (ticker, date, close) VALUES ('GONE', ?, ?)", (day_of(i), c))
    add_watch("OTHER", "Other theme", "other_theme")
    add_bars("OTHER", closes_for(10.0, 0.5))
    m = explain_move("AAA", D)
    assert [(p.ticker, p.name, p.return_pct) for p in m.peers] == [
        ("BBB", "Name BBB", -4.0), ("CCC", "Name CCC", 3.0)]


def test_alert_roles_start_ongoing_end(seed):
    aid = alert(D - timedelta(days=2), D)
    roles = [explain_move("AAA", D - timedelta(days=k)).alerts for k in (2, 1, 0)]
    assert [[(a.id, a.kind, a.role) for a in r] for r in roles] == [
        [(aid, "risk", "start")], [(aid, "risk", "ongoing")], [(aid, "risk", "end")]]
    assert explain_move("AAA", D - timedelta(days=3)).alerts == []


def test_alert_unrelated_theme_not_listed(seed):
    add_watch("UNREL", "Unrelated", "other_theme")
    add_bars("UNREL", closes_for(10.0, 0.5))
    add_watch("CARDED", "In a card", "other_theme")
    add_bars("CARDED", closes_for(10.0, 0.5))
    aid = alert(D - timedelta(days=2), None, cards=("CARDED",))  # open alert on THEME
    day = D - timedelta(days=1)
    assert explain_move("UNREL", day).alerts == []
    assert [(a.id, a.role) for a in explain_move("CARDED", day).alerts] == [(aid, "ongoing")]
    assert [(a.id, a.role) for a in explain_move("AAA", day).alerts] == [(aid, "ongoing")]


def test_surge_of_own_theme_listed(seed):
    add_watch("UNREL", "Unrelated", "other_theme")
    add_bars("UNREL", closes_for(10.0, 0.5))
    version = get_rules().version
    sid = store.insert_surge_event(version, "live", THEME, D - timedelta(days=1), shown=True,
                                   components={}, leaders=[], last_high=D - timedelta(days=1))
    store.insert_surge_event(version, "live", "other_theme", D - timedelta(days=1), shown=True,
                             components={}, leaders=[], last_high=D - timedelta(days=1))
    assert [(a.id, a.kind, a.role) for a in explain_move("AAA", D - timedelta(days=1)).alerts] == [
        (sid, "surge", "start")]
    assert [(a.id, a.kind, a.role) for a in explain_move("AAA", D).alerts] == [(sid, "surge", "ongoing")]
    assert [a.kind for a in explain_move("UNREL", D).alerts] == ["surge"]
    assert explain_move("UNREL", D).alerts[0].id != sid


def test_events_on_the_day(seed, monkeypatch):
    seen = []

    class Registry:
        def events(self, start, end):
            seen.append((start, end))
            return [MarketEvent(id="x", label="Rate decision", category="policy", start_date=D.isoformat())]

    monkeypatch.setattr(detail_view, "default_registry", lambda: Registry())
    m = explain_move("AAA", D)
    assert [(e.category, e.title) for e in m.events] == [("policy", "Rate decision")]
    assert seen == [(D, D)]


def add_news(ticker: str, published: str, topic: str, n: int) -> None:
    with get_db() as conn:
        conn.execute("INSERT INTO news (ticker, headline, hash, topic, published_date) VALUES (?, 'h', ?, ?, ?)",
                     (ticker, f"h{n}", topic, published))


def test_news_stored_and_searched(seed):
    start, end = D - timedelta(days=2), D + timedelta(days=2)
    add_news("AAA", f"{start.isoformat()}T10:00:00", "", 1)
    add_news("AAA", end.isoformat(), "", 2)
    add_news("AAA", (end + timedelta(days=1)).isoformat(), "", 3)  # outside
    add_news("AAA", (start - timedelta(days=1)).isoformat(), "", 4)  # outside
    add_news("AAA", D.isoformat(), "theme:ai", 5)  # a theme item, not this ticker's own
    add_news("BBB", D.isoformat(), "", 6)  # another ticker
    assert (explain_move("AAA", D).news.stored, explain_move("AAA", D).news.searched) == (2, False)

    def search(lang: str) -> None:
        with get_db() as conn:
            conn.execute('INSERT INTO news_history_searches (ticker, lang, start, "end", searched_at, found) '
                         "VALUES ('AAA', ?, ?, ?, 'now', 0)", (lang, start.isoformat(), end.isoformat()))

    search("ko")
    assert explain_move("AAA", D).news.searched is False
    search("en")
    assert explain_move("AAA", D).news.searched is True


def test_non_watchlist_instrument_has_nulls_not_404(seed):
    with TestClient(app) as client:
        r = client.get(f"/api/v1/detail/^GSPC/move/{D.isoformat()}")
    assert r.status_code == 200
    body = r.json()
    assert body["return_pct"] == -1.0
    assert (body["theme"], body["peers"], body["news"], body["market"]) == (None, [], None, None)


def test_404_no_bars_and_422_no_bar_that_day(seed):
    with TestClient(app) as client:
        assert client.get(f"/api/v1/detail/ZZZ/move/{D.isoformat()}").status_code == 404
        assert client.get(f"/api/v1/detail/AAA/move/{(D + timedelta(days=1)).isoformat()}").status_code == 422
        assert client.get(f"/api/v1/detail/AAA/move/{(FIRST - timedelta(days=5)).isoformat()}").status_code == 422
        assert client.get(f"/api/v1/detail/AAA/move/{FIRST.isoformat()}").status_code == 422  # no previous bar
        assert client.get(f"/api/v1/detail/AAA/move/{D.isoformat()}").status_code == 200
    with pytest.raises(NoBars):
        explain_move("ZZZ", D)
    with pytest.raises(NoBarOnDay):
        explain_move("AAA", D + timedelta(days=1))
