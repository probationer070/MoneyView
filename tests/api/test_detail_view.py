from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.db import get_db
from apps.api.services.detail_view import latest_movers, profile

D1, D2 = "2026-10-22", "2026-10-23"


def add_bar(ticker: str, date: str, close: float = 100.0) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT INTO stocks (ticker, date, close) VALUES (?, ?, ?)", (ticker, date, close)
        )


def add_watch(ticker: str, name: str = "", theme: str = "", sector: str = "") -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT INTO watchlist (ticker, name, sector, theme) VALUES (?, ?, ?, ?)",
            (ticker, name, sector, theme),
        )


@pytest.fixture
def seeded():
    add_watch("NVDA", "NVIDIA", theme="ai_semis", sector="Semis")
    add_watch("AAPL", "Apple")


# Prev close 100 on D1, close 100 + pct on D2.
PCTS = {"A01": 5.0, "A02": 4.0, "A03": 3.0, "A04": 2.0, "A05": 1.0, "A06": 0.5, "A07": 0.0,
        "B01": -1.0, "B02": -2.0, "B03": -3.0, "B04": -4.0, "B05": -5.123}


@pytest.fixture
def seeded12():
    for ticker, pct in PCTS.items():
        add_watch(ticker, f"Name {ticker}", theme="ai_semis" if ticker == "A01" else "")
        add_bar(ticker, D1, 100.0)
        add_bar(ticker, D2, 100.0 + pct)


def test_profile_of_watchlist_stock_has_theme_labels(seeded):
    p = profile("nvda")
    assert (p.ticker, p.in_watchlist, p.name, p.sector) == ("NVDA", True, "NVIDIA", "Semis")
    assert p.theme.id == "ai_semis"
    assert p.theme.label.ko == "AI 반도체"
    assert p.theme.label.en == "AI semiconductors"
    assert profile("AAPL").theme is None


def test_profile_of_unknown_ticker_is_not_watchlist(seeded):
    p = profile("^GSPC")
    assert (p.in_watchlist, p.name, p.theme) == (False, None, None)


def test_mover_with_unknown_theme_id_has_null_theme(seeded12):
    with get_db() as conn:
        conn.execute("UPDATE watchlist SET theme = 'not_a_theme' WHERE ticker = 'A02'")
    assert latest_movers().up[1].theme is None


def test_movers_top_and_bottom_five_sorted(seeded12):
    m = latest_movers()
    assert m.date == D2
    assert [(r.ticker, r.return_pct) for r in m.up] == [
        ("A01", 5.0), ("A02", 4.0), ("A03", 3.0), ("A04", 2.0), ("A05", 1.0)]
    assert [(r.ticker, r.return_pct) for r in m.down] == [
        ("B05", -5.12), ("B04", -4.0), ("B03", -3.0), ("B02", -2.0), ("B01", -1.0)]
    assert m.up[0].name == "Name A01" and m.up[0].theme.id == "ai_semis"
    assert (m.up[0].theme.label.en, m.up[0].theme.label.ko) == ("AI semiconductors", "AI 반도체")
    assert m.up[1].theme is None


def test_movers_use_latest_common_day(seeded12):
    add_bar("A01", "2026-10-26")  # one ticker runs a day ahead
    assert latest_movers().date == D2


def test_movers_date_stays_when_one_of_twelve_lacks_the_newest_bar(seeded12):
    for ticker in list(PCTS)[:-1]:  # 11 of 12 have 2026-10-26; B05 stops on D2
        add_bar(ticker, "2026-10-26", 101.0)
    m = latest_movers(limit=20)
    assert m.date == "2026-10-26"
    assert "B05" not in [r.ticker for r in m.up + m.down]


def test_movers_date_rolls_back_when_two_of_twelve_lack_the_newest_bar(seeded12):
    for ticker in list(PCTS)[:-2]:  # 10 of 12 have 2026-10-26
        add_bar(ticker, "2026-10-26", 101.0)
    assert latest_movers().date == D2


def test_movers_ignore_tickers_whose_bars_stopped_over_a_month_ago(seeded12):
    """Catches the count window removed: two delisted names whose last bar is 2026-09-01 would
    count toward the total (14), so 12 of 14 falls under the 90% share and no date is found."""
    for ticker in ("Z01", "Z02"):
        add_watch(ticker)
        add_bar(ticker, "2026-09-01")
    assert latest_movers().date == D2


def test_movers_return_is_between_the_two_common_days(seeded12):
    add_watch("GAP", "Gap ticker")
    add_bar("GAP", "2026-10-21", 50.0)  # no bar on D1, the previous common day
    add_bar("GAP", D2, 100.0)  # +100% against its own previous bar
    m = latest_movers(limit=20)
    assert m.date == D2
    assert "GAP" not in [r.ticker for r in m.up + m.down]


def test_movers_lists_hold_only_their_own_sign(seeded12):
    with get_db() as conn:
        conn.execute("UPDATE stocks SET close = 100 WHERE ticker LIKE 'B%' AND date = ?", (D2,))  # flat
        conn.execute("UPDATE stocks SET close = 102.5 WHERE ticker = 'B01' AND date = ?", (D2,))
        conn.execute("UPDATE stocks SET close = 90 WHERE ticker = 'A01' AND date = ?", (D2,))
    m = latest_movers()
    assert [r.ticker for r in m.up] == ["A02", "A03", "B01", "A04", "A05"]
    assert [r.ticker for r in m.down] == ["A01"]


def test_movers_up_list_holds_no_decliners(seeded12):
    with get_db() as conn:
        conn.execute("UPDATE stocks SET close = 100 WHERE ticker LIKE 'A0%' AND ticker != 'A01' AND date = ?", (D2,))
    m = latest_movers()
    assert [r.ticker for r in m.up] == ["A01"]
    assert [r.ticker for r in m.down] == ["B05", "B04", "B03", "B02", "B01"]


def test_movers_skip_ticker_without_previous_bar(seeded12):
    add_watch("NEW", "Newcomer")
    add_bar("NEW", D2, 500.0)  # only one bar: no previous close
    m = latest_movers(limit=20)
    assert "NEW" not in [r.ticker for r in m.up + m.down]
    assert m.date == D2


@pytest.fixture
def news_rows():
    with get_db() as conn:
        for i, (ticker, topic, day) in enumerate([
            (None, "theme:ai", "2026-10-20"), (None, "theme:ai", "2026-10-24"),
            (None, "theme:other", "2026-10-21"), ("NVDA", "", "2026-10-21"),
        ]):
            conn.execute(
                "INSERT INTO news (ticker, headline, hash, topic, published_date)"
                " VALUES (?, ?, ?, ?, ?)", (ticker, f"h{i}", f"x{i}", topic, day))


def test_feed_topic_filter_returns_theme_rows(news_rows):
    with TestClient(app) as client:
        rows = client.get("/api/v1/news/feed?topic=theme:ai").json()
        assert sorted(r["headline"] for r in rows) == ["h0", "h1"]
        ranged = client.get("/api/v1/news/feed?topic=theme:ai&from=2026-10-23&to=2026-10-25").json()
        assert [r["headline"] for r in ranged] == ["h1"]
        plain = client.get("/api/v1/news/feed").json()
        assert [r["headline"] for r in plain] == ["h3"]


def test_routes(seeded12):
    with TestClient(app) as client:
        m = client.get("/api/v1/detail/movers/latest")
        assert m.status_code == 200
        body = m.json()
        assert body["date"] == D2 and len(body["up"]) == 5
        assert set(body["up"][0]) == {"ticker", "name", "theme", "return_pct"}
        p = client.get("/api/v1/detail/A01/profile")
        assert p.status_code == 200
        assert p.json()["theme"]["label"]["ko"] == "AI 반도체"
        u = client.get("/api/v1/detail/ZZZZ/profile")
        assert u.status_code == 200 and u.json()["in_watchlist"] is False
